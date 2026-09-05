import { describe, it, expect } from 'vitest';
import {
  createQueue, nextPending, markRunning, markDone, markFailed,
  cancelPending, retryUnfinished, summarise, verdict, outputName,
  type BatchItem,
} from './batchQueue';

const files = ['invoice.png', 'delivery-note.pdf', 'old-report.repx'];
const fresh = () => createQueue(files);
const ok = { title: 'Invoice', repxContent: '<x/>', bands: 3, errors: 0, warnings: 0 };

describe('building the queue', () => {
  it('makes one pending item per file, keeping the source name', () => {
    const queue = fresh();
    expect(queue).toHaveLength(3);
    expect(queue.map((i) => i.sourceName)).toEqual(files);
    expect(queue.every((i) => i.status === 'pending')).toBe(true);
  });

  it('gives stable ids, so a re-run keeps the same React keys', () => {
    expect(createQueue(files).map((i) => i.id)).toEqual(fresh().map((i) => i.id));
  });

  it('distinguishes two files with the same name', () => {
    const queue = createQueue(['a.png', 'a.png']);
    expect(queue[0].id).not.toBe(queue[1].id);
  });

  it('is empty for no files', () => {
    expect(createQueue([])).toEqual([]);
    expect(nextPending([])).toBeNull();
  });
});

describe('running through it', () => {
  it('takes the first pending item, in order', () => {
    const queue = fresh();
    expect(nextPending(queue)!.sourceName).toBe('invoice.png');
    expect(nextPending(markDone(queue, queue[0].id, ok))!.sourceName).toBe('delivery-note.pdf');
  });

  it('returns null once nothing is pending', () => {
    let queue = fresh();
    for (const item of queue) queue = markDone(queue, item.id, ok);
    expect(nextPending(queue)).toBeNull();
    expect(summarise(queue).finished).toBe(true);
  });

  it('does not hand out an item that is already running', () => {
    const queue = markRunning(fresh(), '0:invoice.png');
    expect(nextPending(queue)!.sourceName).toBe('delivery-note.pdf');
  });

  it('records the outcome on the right item and leaves the others alone', () => {
    const queue = markDone(fresh(), '1:delivery-note.pdf', { ...ok, title: 'Delivery', warnings: 2 });
    expect(queue[1]).toMatchObject({ status: 'done', title: 'Delivery', warnings: 2 });
    expect(queue[0].status).toBe('pending');
    expect(queue[2].status).toBe('pending');
  });

  it('keeps the failure message', () => {
    const queue = markFailed(fresh(), '0:invoice.png', 'exceeded your Gemini API quota');
    expect(queue[0]).toMatchObject({ status: 'failed', message: 'exceeded your Gemini API quota' });
  });

  it('clears a stale message when an item is retried into running', () => {
    let queue = markFailed(fresh(), '0:invoice.png', 'timed out');
    queue = retryUnfinished(queue);
    queue = markRunning(queue, '0:invoice.png');
    expect(queue[0].message).toBe('');
  });

  it('never mutates the queue it was given', () => {
    const queue = fresh();
    const snapshot = JSON.stringify(queue);
    markDone(queue, queue[0].id, ok);
    markFailed(queue, queue[0].id, 'x');
    cancelPending(queue);
    expect(JSON.stringify(queue)).toBe(snapshot);
  });
});

describe('stopping', () => {
  it('cancels what has not started and leaves the running item alone', () => {
    // The in-flight request is already being billed to the user's key, so
    // discarding its answer costs them the call and returns nothing.
    let queue = markDone(fresh(), '0:invoice.png', ok);
    queue = markRunning(queue, '1:delivery-note.pdf');
    queue = cancelPending(queue);
    expect(queue.map((i) => i.status)).toEqual(['done', 'running', 'cancelled']);
  });

  it('says why a cancelled item never ran', () => {
    expect(cancelPending(fresh())[0].message).toMatch(/stopped before this file started/);
  });

  it('puts failed and cancelled items back, keeping what succeeded', () => {
    let queue = markDone(fresh(), '0:invoice.png', ok);
    queue = markFailed(queue, '1:delivery-note.pdf', 'network');
    queue = cancelPending(queue);
    const retried = retryUnfinished(queue);
    expect(retried.map((i) => i.status)).toEqual(['done', 'pending', 'pending']);
    // ...and the successful one keeps its result rather than being regenerated.
    expect(retried[0].repxContent).toBe('<x/>');
  });
});

describe('summarising', () => {
  it('counts every state and what could be archived', () => {
    let queue = markDone(fresh(), '0:invoice.png', ok);
    queue = markDone(queue, '1:delivery-note.pdf', { ...ok, repxContent: '', title: 'Empty' });
    queue = markFailed(queue, '2:old-report.repx', 'bad XML');
    expect(summarise(queue)).toMatchObject({
      total: 3, pending: 0, running: 0, done: 2, failed: 1, cancelled: 0,
      downloadable: 1, finished: true,
    });
  });

  it('separates files with errors from files with only warnings', () => {
    let queue = markDone(fresh(), '0:invoice.png', { ...ok, errors: 2, warnings: 1 });
    queue = markDone(queue, '1:delivery-note.pdf', { ...ok, warnings: 3 });
    queue = markDone(queue, '2:old-report.repx', ok);
    expect(summarise(queue)).toMatchObject({ withErrors: 1, withWarnings: 1 });
  });

  it('is not finished while anything is pending or running', () => {
    expect(summarise(fresh()).finished).toBe(false);
    expect(summarise(markRunning(fresh(), '0:invoice.png')).finished).toBe(false);
  });
});

describe('the verdict per row', () => {
  const item = (patch: Partial<BatchItem>): BatchItem => ({ ...fresh()[0], ...patch });

  it('names what the audit found rather than only that the job finished', () => {
    expect(verdict(item({ status: 'done', repxContent: '<x/>' }))).toBe('clean');
    expect(verdict(item({ status: 'done', repxContent: '<x/>', warnings: 1 }))).toBe('1 warning');
    expect(verdict(item({ status: 'done', repxContent: '<x/>', warnings: 4 }))).toBe('4 warnings');
    expect(verdict(item({ status: 'done', repxContent: '<x/>', errors: 1, warnings: 9 })))
      .toBe('1 error — content will be lost');
  });

  it('reports a finished job that produced no file', () => {
    expect(verdict(item({ status: 'done' }))).toBe('no REPX was produced');
  });

  it('prefers the real message for a failure', () => {
    expect(verdict(item({ status: 'failed', message: 'quota exceeded' }))).toBe('quota exceeded');
    expect(verdict(item({ status: 'failed' }))).toBe('failed');
  });

  it('covers the waiting states', () => {
    expect(verdict(item({ status: 'pending' }))).toBe('waiting');
    expect(verdict(item({ status: 'running' }))).toContain('generating');
  });
});

describe('naming the output', () => {
  it('uses the report title, because that is what the user will look for', () => {
    expect(outputName({ ...fresh()[0], title: 'Sales by Region' })).toBe('Sales by Region.repx');
  });

  it('falls back to the source name with its extension replaced', () => {
    expect(outputName(fresh()[0])).toBe('invoice.repx');
    expect(outputName(fresh()[1])).toBe('delivery-note.repx');
  });

  it('falls back again when there is nothing to go on', () => {
    expect(outputName({ ...fresh()[0], sourceName: '' })).toBe('report.repx');
  });
});
