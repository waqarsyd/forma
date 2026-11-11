/**
 * A plan before a heavy job (2026-11-10, the AI accuracy programme, batch AG
 * item 22).
 */
import { describe, expect, it } from 'vitest';
import { batchReadyNote, batchWords, filesForBatch, keptAttachments, keptFiles, modeFromWords, planFiles, planFor, planOutcome, planReply, planSteps, toggleFile } from './jobPlan';

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
  // What it is making, from what (2026-11-11, the full audit's PL-14): no counts of pages, no "Stop pauses it".
  it('says what it is doing, and reads "one report each" from the words', () => {
    expect(planReply(plan)).toBe('Making one report from these 3 files. If they\'re different reports, say "one report each".');
    expect(modeFromWords('Rebuild these as they are')).toBe('one');
    expect(modeFromWords('One report each, please')).toBe('each');
    expect(modeFromWords('separate reports for these')).toBe('each');
    const each = planFor(plan.files, 'a report per file')!;
    expect(each.mode).toBe('each');
    expect(planReply(each)).toBe('Making a report from each of these 3 files, one after another, in Batch.');
    expect(planSteps(plan, 'Gemini')).toEqual(['Design one report from 3 files with Gemini.']);
    const pictures = planFor(planFiles([...pages('1', 'a.png', 1), ...pages('2', 'b.jpg', 1), ...pages('3', 'c.png', 1)], []), 'one report each')!;
    expect(planReply(pictures)).toBe('Making a report from each of these 3 pictures, one after another, in Batch.');
    expect(planReply({ ...pictures, mode: 'one' })).toBe('Making one report from these 3 pictures. If they\'re different reports, say "one report each".');
    for (const p of [plan, each, pictures]) expect(planReply(p)).not.toMatch(/\bStop\b|\bpages?\b/);
  });

  // Only words about reports or files send a request to Batch (PL-08); the cases are the audit's.
  it('reads "each", "every" and "per page" about anything else as one report', () => {
    for (const words of [
      'Rebuild these pages as one invoice, keep every line',
      'Make a report where each customer is a group',
      'Show the totals per page',
      'Every row should have a border',
      'Keep the logo separate',
      'Add a separate band for the totals',
    ]) expect(modeFromWords(words)).toBe('one');
    for (const words of [
      'one report each, in German, landscape',
      'Make a separate report for each file',
      'a report for every picture',
      'each file as its own report',
      'run these in batch',
      'Do them separately',
      'make one per file',
      'per file, in landscape',
      'Make separate files of these',
    ]) expect(modeFromWords(words)).toBe('each');
  });

  // What else was asked goes to each file (PL-15), less the words that sent it to Batch.
  it('keeps what else a request asked of each file', () => {
    expect(batchWords('one report each, in German, landscape')).toBe('in German, landscape');
    expect(batchWords('Make separate reports for these in French')).toBe('Make in French');
    expect(batchWords('Make a report for each file')).toBe('');
    expect(batchWords('Landscape, a report per file please')).toBe('Landscape, please');
    expect(batchWords('in batch')).toBe('');
    expect(batchWords('Make one per file, in German')).toBe('in German');
  });

  // One report takes at most twenty pages, the first of each file (PL-22).
  it('says which pages one report from many used', () => {
    const many = planFor(planFiles([...pages('1', 'a.pdf', 8), ...pages('2', 'b.pdf', 8), ...pages('3', 'c.pdf', 8)], []))!;
    expect(planReply(many)).toBe('Making one report from these 3 PDFs. I used the first 20 pages of the 24, the first pages of each file. If they\'re different reports, say "one report each".');
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
    // Not what was made a second time (the re-audit's R1-12): the reply above says that.
    expect(planOutcome(each, true)).toBe('Started.');
    expect(planOutcome(plan, true)).toBe('Started.');
    expect(planOutcome(plan, false)).toBe('Not started.');
    expect(planReply(plan)).toMatch(/^Making one report from these 3/);
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

  // PL-22: twenty pages at most, the first of each file, each page's text with it.
  it('sends one report the first twenty pages, the first of each file', () => {
    const big = { files: [{ uploadId: 'a', file: 'a.pdf', pages: 8 }, { uploadId: 'b', file: 'b.pdf', pages: 8 }, { uploadId: 'c', file: 'c.pdf', pages: 8 }], mode: 'one' as const, skip: [] };
    const meta = big.files.flatMap((f) => Array.from({ length: 8 }, (_, i) => ({ uploadId: f.uploadId, page: i + 1 })));
    const sent = keptAttachments(big, {
      images: meta.map((m) => `${m.uploadId}${m.page}`),
      imageMeta: meta,
      texts: [...meta.map((m): { uploadId: string; page?: number; text: string } => ({ uploadId: m.uploadId, page: m.page, text: 't' })), { uploadId: 'c', text: 'no page' }],
      files: new Map(),
    });
    expect(sent.images).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
    expect(sent.texts.filter((t) => t.page !== undefined).map((t) => `${t.uploadId}${t.page}`)).toEqual(sent.images);
    expect(sent.texts.some((t) => t.text === 'no page')).toBe(true);
  });
});

describe('the reports a request sent to Batch, made', () => {
  const item = (title: string, sourceName: string, status: string) => ({ title, sourceName, status });

  // PL-14: the thread says what is ready and what to do with it.
  it('names what is ready, and what was not made', () => {
    expect(batchReadyNote([item('A', 'a.png', 'done'), item('B', 'b.png', 'done'), item('', 'scans/c.png', 'done')])).toBe('3 reports are ready in Batch: A, B, c. Open one, or download them all as a .zip.');
    expect(batchReadyNote([item('A', 'a.png', 'done')])).toBe('1 report is ready in Batch: A. Open it, or download it as a .repx.');
    expect(batchReadyNote([item('A', 'a.png', 'done'), item('', 'b.png', 'failed')])).toBe('1 report is ready in Batch: A. Open it, or download it as a .repx. One was not made; Retry in Batch makes it.');
    expect(batchReadyNote([item('', 'a.png', 'failed'), item('', 'b.png', 'cancelled')])).toBe('None of the 2 reports was made. Retry in Batch makes them.');
  });
});
