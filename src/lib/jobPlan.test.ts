/**
 * A plan before a heavy job (2026-11-10, the AI accuracy programme, batch AG
 * item 22).
 */
import { describe, expect, it } from 'vitest';
import { filesForBatch, keptAttachments, keptFiles, modeFromWords, planFiles, planFor, planOutcome, planReply, planSteps, toggleFile } from './jobPlan';

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

  // Started at once since the full audit (2026-11-10): the words decide what Start used to.
  it('says what it is doing, and reads "one report each" from the words', () => {
    expect(planReply(plan)).toBe('That is 3 files and 6 pages: I\'m making one report from all of them. Say "one report each" if they are different reports. Stop stops it.');
    expect(modeFromWords('Rebuild these as they are')).toBe('one');
    expect(modeFromWords('One report each, please')).toBe('each');
    expect(modeFromWords('separate reports for these')).toBe('each');
    const each = planFor(plan.files, 'a report per file')!;
    expect(each.mode).toBe('each');
    expect(planReply(each)).toBe("That is 3 files and 6 pages: I'm making a report from each, in Batch. Stop pauses it.");
    expect(planSteps(plan, 'Gemini')).toEqual(['Design one report from 3 files with Gemini.']);
  });

  it('leaves a file out, and says the steps again', () => {
    const fewer = toggleFile(plan, '3');
    expect(keptFiles(fewer).map((f) => f.file)).toEqual(['invoice.pdf', 'statement.png']);
    expect(planSteps(fewer, 'Gemini')).toEqual(['Design one report from 2 files with Gemini.']);
    expect(keptFiles(toggleFile(fewer, '3')).length).toBe(3);
    // Nothing kept is no steps: "Nothing is ticked" went with the ticks (2026-11-11).
    expect(planSteps({ ...plan, skip: ['1', '2', '3'] }, 'Gemini')).toEqual([]);
  });

  it('makes a report for each in Batch', () => {
    const each = { ...plan, mode: 'each' as const };
    expect(planSteps(each, 'OpenRouter')).toEqual([
      'Open Batch with the 3 files, each its own report.',
      'Design them one at a time with OpenRouter. A limit pauses the batch, and it carries on from where it stopped.',
    ]);
    // The full audit (2026-11-11): what a step is, never what it costs or how it is done.
    for (const p of [plan, each, toggleFile(plan, '3')]) {
      for (const step of planSteps(p, 'Gemini')) expect(step).not.toMatch(/\brequests?\b|\bOCR\b|\bticked\b/);
    }
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
