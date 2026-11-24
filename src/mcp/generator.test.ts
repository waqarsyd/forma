/**
 * Where the MCP server's AI tools run (2026-11-24, the MCP work's wave 8):
 * the progress that only goes up (PROTO-3), the queue of one (OD7,
 * PROTO-7), and the worker thread's bounds (PROTO-4, GAP3-3), on stand-ins:
 * a clock the test moves, a generator the test answers, and worker threads
 * started from a few lines of script, so no AI and no model is involved.
 */
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenDone, GenEvent, GenJob } from './genJobs';
import { GEN_LIMITS, PROGRESS_TOTAL, STAGES, genTooLong, genTooMuchMemory, jobOf, oneAtATime, progressReporter, workerGenerator, type Generator, type Progress } from './generator';
import { ToolRefusal } from './toolShape';

afterEach(() => vi.useRealTimers());

const JOB = { kind: 'revise', config: { version: '', unit: '', pageSize: '' }, request: 'x', name: 'x', text: '' } as GenJob;

describe('progressReporter', () => {
  const reporter = (options: { heartbeatMs?: number; gapMs?: number } = {}) => {
    let clock = 0;
    const sent: Progress[] = [];
    const r = progressReporter((p) => sent.push(p), { now: () => clock, ...options });
    return { ...r, sent, tick: (ms: number) => (clock += ms) };
  };

  it('sends each stage as it starts, inside its own part, the values only rising and every one naming the total', () => {
    const r = reporter();
    for (const stage of ['starting', 'reading', 'drafting', 'asking', 'checking', 'writing'] as const) r.tell({ stage });
    r.stop();
    expect(r.sent.map((p) => p.message)).toEqual(['Starting.', 'Reading the files.', "Making Forma's draft.", 'Waiting for the AI.', 'Checking the report.', 'Writing the report.']);
    expect(r.sent.map((p) => p.progress)).toEqual([2, 4, 15, 25, 85, 97]);
    for (const p of r.sent) expect(p.total).toBe(PROGRESS_TOTAL);
  });

  it("moves within the AI's part as its answer streams, and sends nothing when a retry starts its count again until it passes the mark", () => {
    const r = reporter({ gapMs: 0 });
    r.tell({ stage: 'asking' });
    for (const percent of [10, 40, 80, 5, 20, 60, 90, 95, 95]) {
      r.tick(10);
      r.tell({ stage: 'asking', percent });
    }
    // The print check's fix asks again, after the answer was checked: never back down.
    r.tell({ stage: 'checking' });
    r.tell({ stage: 'asking' });
    r.tell({ stage: 'asking', percent: 50 });
    r.tell({ stage: 'checking' });
    r.stop();
    const values = r.sent.map((p) => p.progress);
    for (let i = 1; i < values.length; i++) expect(values[i], `notification ${i}`).toBeGreaterThan(values[i - 1]);
    expect(Math.max(...values)).toBeLessThan(STAGES.writing.from);
    expect(values.filter((v) => v < STAGES.checking.from).length).toBe(6);
  });

  it('sends at most one a second while the answer streams, a stage starting aside', () => {
    const r = reporter();
    r.tell({ stage: 'asking' });
    for (let percent = 1; percent <= 90; percent++) {
      r.tick(100);
      r.tell({ stage: 'asking', percent });
    }
    r.stop();
    // 9 seconds of streaming: the stage's start and one a second after it.
    expect(r.sent.length).toBe(10);
  });

  it('raises the value a little after each silence, so a host that counts silence sees the call alive, and sends nothing once stopped', () => {
    vi.useFakeTimers();
    let clock = 0;
    const sent: Progress[] = [];
    const r = progressReporter((p) => sent.push(p), { now: () => clock, heartbeatMs: 15_000 });
    r.tell({ stage: 'asking' });
    for (let i = 0; i < 12; i++) {
      clock += 5000;
      vi.advanceTimersByTime(5000);
    }
    // A minute of silence: a beat every 15 seconds, each above the last and still inside the AI's part.
    expect(sent.map((p) => p.message)).toEqual(['Waiting for the AI.', 'Waiting for the AI.', 'Waiting for the AI.', 'Waiting for the AI.', 'Waiting for the AI.']);
    const values = sent.map((p) => p.progress);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    expect(values[values.length - 1]).toBeLessThan(STAGES.asking.to);
    r.stop();
    clock += 60_000;
    vi.advanceTimersByTime(60_000);
    r.tell({ stage: 'checking' });
    expect(sent.length).toBe(5);
  });

  it('sends nothing at all, and keeps no timer, when the request carried no progressToken', () => {
    const r = progressReporter(null);
    r.tell({ stage: 'asking' });
    r.tell({ stage: 'asking', percent: 50 });
    r.stop();
  });
});

/** A generator the test answers: each run waits until `finish` is called with its index. */
function heldGenerator() {
  const runs: { events: GenEvent[]; finish(value?: GenDone | null): void; signal: AbortSignal }[] = [];
  let started: () => void = () => {};
  const inner: Generator = {
    run: (_job, signal, tell) =>
      new Promise((resolve) => {
        const events: GenEvent[] = [];
        runs.push({ events, signal, finish: (value = null) => resolve(value) });
        tell({ stage: 'reading' });
        started();
      }),
    close: async () => {},
  };
  return { inner, runs, nextStart: () => new Promise<void>((done) => (started = done)) };
}

describe('oneAtATime', () => {
  it('runs one call at a time in the order they came, a second told it waits for the report before it', async () => {
    const held = heldGenerator();
    const queue = oneAtATime(held.inner);
    const told: GenEvent[][] = [[], [], []];
    const first = queue.run(JOB, new AbortController().signal, (e) => told[0].push(e));
    const second = queue.run(JOB, new AbortController().signal, (e) => told[1].push(e));
    const third = queue.run(JOB, new AbortController().signal, (e) => told[2].push(e));
    await Promise.resolve();
    expect(held.runs.length).toBe(1);
    expect(queue.busy).toBe(true);
    expect(queue.waiting).toBe(2);
    expect(told[1][0]).toEqual({ stage: 'waiting' });
    expect(told[2][0]).toEqual({ stage: 'waiting' });
    let start = held.nextStart();
    held.runs[0].finish();
    await first;
    await start;
    expect(held.runs.length).toBe(2);
    start = held.nextStart();
    held.runs[1].finish();
    await second;
    await start;
    held.runs[2].finish();
    await third;
    expect(queue.busy).toBe(false);
    expect(told[1]).toEqual([{ stage: 'waiting' }, { stage: 'starting' }, { stage: 'reading' }]);
  });

  it('lets a call cancelled while it waits leave the queue and never run, and the next still runs', async () => {
    const held = heldGenerator();
    const queue = oneAtATime(held.inner);
    const first = queue.run(JOB, new AbortController().signal, () => {});
    const cancelled = new AbortController();
    const second = queue.run(JOB, cancelled.signal, () => {});
    const third = queue.run(JOB, new AbortController().signal, () => {});
    cancelled.abort();
    expect(await second).toBeNull();
    expect(queue.waiting).toBe(1);
    const start = held.nextStart();
    held.runs[0].finish();
    await first;
    await start;
    expect(held.runs.length).toBe(2);
    held.runs[1].finish();
    await third;
    expect(held.runs.length).toBe(2);
    expect(queue.busy).toBe(false);
  });

  it('gives the turn back when a run throws', async () => {
    const queue = oneAtATime({ run: async () => Promise.reject(new Error('boom')), close: async () => {} });
    await expect(queue.run(JOB, new AbortController().signal, () => {})).rejects.toThrow('boom');
    expect(queue.busy).toBe(false);
  });

  it("makes a job given as a function only once the call has its turn, so a call that waits holds no file's bytes, and gives the turn back when making it is refused (W8C-6)", async () => {
    const held = heldGenerator();
    const queue = oneAtATime({ run: async (source, signal, tell) => held.inner.run(await jobOf(source), signal, tell), close: async () => {} });
    const made: string[] = [];
    const source = (name: string) => () => {
      made.push(name);
      return JOB;
    };
    const first = queue.run(source('first'), new AbortController().signal, () => {});
    const second = queue.run(source('second'), new AbortController().signal, () => {});
    await vi.waitFor(() => expect(held.runs.length).toBe(1));
    expect(made).toEqual(['first']);
    const start = held.nextStart();
    held.runs[0].finish();
    await first;
    await start;
    expect(made).toEqual(['first', 'second']);
    held.runs[1].finish();
    await second;
    const refused = queue.run(() => Promise.reject(new ToolRefusal('The file was moved.')), new AbortController().signal, () => {});
    await expect(refused).rejects.toThrow('The file was moved.');
    expect(queue.busy).toBe(false);
  });
});

/** A worker thread from a few lines of script, its stdout its own as the server's are. */
const scripted = (body: string) => () => new Worker(`const { parentPort } = require('node:worker_threads');\n${body}`, { eval: true, stdout: true, stderr: true });

describe('workerGenerator', () => {
  it("relays the work's events, answers with its result, and keeps the thread for the next call", async () => {
    const spawned: Worker[] = [];
    const spawn = scripted("parentPort.on('message', ({ id }) => { parentPort.postMessage({ id, event: { stage: 'asking' } }); console.log('a line from the work'); parentPort.postMessage({ id, ok: true, value: { kind: 'revise', id } }); });");
    const logged: string[] = [];
    const gen = workerGenerator({ setup: { mock: true }, log: (l) => logged.push(l), spawn: () => spawned[spawned.push(spawn()) - 1] });
    const events: GenEvent[] = [];
    expect(await gen.run(JOB, new AbortController().signal, (e) => events.push(e))).toEqual({ kind: 'revise', id: 1 });
    expect(await gen.run(JOB, new AbortController().signal, () => {})).toEqual({ kind: 'revise', id: 2 });
    expect(events).toEqual([{ stage: 'asking' }]);
    expect(spawned.length).toBe(1);
    await vi.waitFor(() => expect(logged).toContain('a line from the work'));
    await gen.close();
  });

  it('ends the thread at once on a cancellation, answering with nothing, and starts another for the next call', async () => {
    let starts = 0;
    const exits: number[] = [];
    const gen = workerGenerator({
      setup: { mock: true },
      log: () => {},
      spawn: () => {
        starts++;
        const w = scripted("parentPort.on('message', ({ id }) => { if (id > 1) parentPort.postMessage({ id, ok: true, value: null }); });")();
        w.on('exit', (code) => exits.push(code));
        return w;
      },
    });
    const stop = new AbortController();
    const running = gen.run(JOB, stop.signal, () => {});
    setTimeout(() => stop.abort(), 50);
    expect(await running).toBeNull();
    await vi.waitFor(() => expect(exits.length).toBe(1));
    expect(await gen.run(JOB, new AbortController().signal, () => {})).toBeNull();
    expect(starts).toBe(2);
    await gen.close();
  });

  it("moves a job's files to the thread rather than copying them, and copies a view over a buffer it does not own (W8C-6)", async () => {
    const gen = workerGenerator({
      setup: { mock: true },
      log: () => {},
      spawn: scripted("parentPort.on('message', ({ id, job }) => parentPort.postMessage({ id, ok: true, value: { kind: 'generate', got: job.files.map((f) => Array.from(f.bytes)) } }));"),
    });
    const own = new Uint8Array([1, 2, 3, 4]);
    const shared = new Uint8Array(new ArrayBuffer(8), 2, 3).fill(9);
    const job = { kind: 'generate', config: JOB.config, words: '', files: [{ name: 'a.png', bytes: own }, { name: 'b.csv', bytes: shared }] } as GenJob;
    const done = (await gen.run(() => job, new AbortController().signal, () => {})) as unknown as { got: number[][] };
    expect(done.got).toEqual([[1, 2, 3, 4], [9, 9, 9]]);
    // Moved: this thread no longer holds the file's bytes. Not moved: the view over a larger buffer is intact.
    expect(own.byteLength).toBe(0);
    expect(Array.from(shared)).toEqual([9, 9, 9]);
    await gen.close();
  });

  it('refuses in plain words past its deadline, and turns a refusal from the work into one', async () => {
    const slow = workerGenerator({ setup: { mock: true }, log: () => {}, limits: { deadlineMs: 100 }, spawn: scripted("parentPort.on('message', () => {});") });
    await expect(slow.run(JOB, new AbortController().signal, () => {})).rejects.toThrow(new ToolRefusal(genTooLong(100)));
    await slow.close();
    const refusing = workerGenerator({ setup: { mock: true }, log: () => {}, spawn: scripted("parentPort.on('message', ({ id }) => parentPort.postMessage({ id, ok: false, refusal: 'No, in plain words.' }));") });
    const refused = refusing.run(JOB, new AbortController().signal, () => {});
    await expect(refused).rejects.toBeInstanceOf(ToolRefusal);
    await expect(refused).rejects.toThrow('No, in plain words.');
    await refusing.close();
  });

  it('keeps a failure inside the work for the log, and names the bounds a generation runs within', async () => {
    const failing = workerGenerator({ setup: { mock: true }, log: () => {}, spawn: scripted("parentPort.on('message', ({ id }) => parentPort.postMessage({ id, ok: false, error: 'Error: inside\\n    at work' }));") });
    const error = await failing.run(JOB, new AbortController().signal, () => {}).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ToolRefusal);
    expect((error as Error).stack).toContain('at work');
    await failing.close();
    expect(GEN_LIMITS.deadlineMs).toBe(15 * 60_000);
    expect(genTooMuchMemory(GEN_LIMITS.heapMb)).toMatch(/^Forma stopped working on this report when it needed more than 2048 MB of memory.*Nothing was written\.$/);
    await expect(workerGenerator({ setup: { mock: true }, log: () => {} }).close()).resolves.toBeUndefined();
  });
});
