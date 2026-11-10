/**
 * A plan before a heavy job (2026-11-10, the AI accuracy programme, batch AG
 * item 22).
 */
import { describe, expect, it } from 'vitest';
import { filesForBatch, keptAttachments, keptFiles, planFiles, planFor, planOutcome, planReply, planSteps, toggleFile } from './jobPlan';

const pages = (uploadId: string, file: string, n: number) => Array.from({ length: n }, () => ({ uploadId, file }));

describe('which messages are planned first', () => {
  it('lists each file once, with its pages, a text-only one with none', () => {
    const files = planFiles([...pages('1', 'scan.pdf', 3), ...pages('2', 'photo.png', 1)], [{ uploadId: '1', file: 'scan.pdf' }, { uploadId: '3', file: 'old.repx' }]);
    expect(files).toEqual([
      { uploadId: '1', file: 'scan.pdf', pages: 3 },
      { uploadId: '2', file: 'photo.png', pages: 1 },
      { uploadId: '3', file: 'old.repx', pages: 0 },
    ]);
  });

  it('plans three files or nine pages, and lets one document of eight pages go straight on', () => {
    expect(planFor(planFiles(pages('1', 'a.pdf', 8), []))).toBeNull();
    expect(planFor(planFiles([...pages('1', 'a.png', 1), ...pages('2', 'b.png', 1)], []))).toBeNull();
    expect(planFor(planFiles([...pages('1', 'a.png', 1), ...pages('2', 'b.png', 1), ...pages('3', 'c.png', 1)], []))).toMatchObject({ mode: 'one', skip: [] });
    expect(planFor(planFiles([...pages('1', 'a.pdf', 8), ...pages('2', 'b.pdf', 1)], []))).not.toBeNull();
  });
});

describe('the plan, as it is changed', () => {
  const plan = planFor(planFiles([...pages('1', 'invoice.pdf', 4), ...pages('2', 'statement.png', 1), ...pages('3', 'notes.png', 1)], []))!;

  it('says what it would do, and that nothing is sent before Start', () => {
    expect(planReply(plan)).toBe('That is 3 files and 6 pages. Here is the plan: change it if you like, then start. Nothing is read or sent until you do.');
    expect(planSteps(plan, 'Gemini')).toEqual([
      'Read 6 pages with OCR, in this browser; nothing leaves it for this.',
      'Design one report from 3 files with Gemini: 1 request, 2 if the report leaves out text it should keep.',
    ]);
  });

  it('leaves a file out, and counts again', () => {
    const fewer = toggleFile(plan, '3');
    expect(keptFiles(fewer).map((f) => f.file)).toEqual(['invoice.pdf', 'statement.png']);
    expect(planSteps(fewer, 'Gemini')[0]).toBe('Read 5 pages with OCR, in this browser; nothing leaves it for this.');
    expect(keptFiles(toggleFile(fewer, '3')).length).toBe(3);
    expect(planSteps({ ...plan, skip: ['1', '2', '3'] }, 'Gemini')).toEqual(['Nothing is ticked, so nothing would be made.']);
  });

  it('makes a report for each in Batch, with what that costs', () => {
    const each = { ...plan, mode: 'each' as const };
    expect(planSteps(each, 'OpenRouter')).toEqual([
      'Open Batch with the 3 files, each its own report.',
      'Design them one at a time with OpenRouter: 3 to 6 requests. A limit pauses the batch, and it carries on from where it stopped.',
    ]);
    expect(planOutcome(each, true)).toBe('Started: 3 reports in Batch.');
    expect(planOutcome(plan, true)).toBe('Started: one report from 3 files.');
    expect(planOutcome(plan, false)).toBe('Not started.');
  });
});

describe('a plan started', () => {
  const plan = { files: [{ uploadId: '1', file: 'a.pdf', pages: 2 }, { uploadId: '2', file: 'b.png', pages: 1 }, { uploadId: '3', file: 'c.png', pages: 1 }], mode: 'each' as const, skip: ['3'] };
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const job = {
    images: ['p1', 'p2', png, 'p4'],
    imageMeta: [{ uploadId: '1' }, { uploadId: '1' }, { uploadId: '2' }, { uploadId: '3' }],
    texts: [{ uploadId: '1', text: 'layer' }, { uploadId: '3', text: 'left out' }],
    files: new Map([['1', new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })]]),
  };

  it('sends on the pages and texts of the files it keeps, for one report', () => {
    expect(keptAttachments(plan, job)).toEqual({ images: ['p1', 'p2', png], imageMeta: [{ uploadId: '1' }, { uploadId: '1' }, { uploadId: '2' }], texts: [{ uploadId: '1', text: 'layer' }] });
  });

  it('hands Batch the files themselves, or a picture rebuilt from its page', async () => {
    const files = await filesForBatch(plan, job);
    expect(files.map((f) => [f.name, f.type])).toEqual([['a.pdf', 'application/pdf'], ['b.png', 'image/png']]);
  });
});
