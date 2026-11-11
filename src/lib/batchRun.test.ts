import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportConfig } from '../services/geminiService';
import type { BatchRunDeps } from './batchRun';

// Everything the run loads is stood in for: what is checked is what it asks of each part.
const { readPage, analyzeReportDesign, fileTexts } = vi.hoisted(() => ({ readPage: vi.fn(), analyzeReportDesign: vi.fn(), fileTexts: [] as { file: string; text: string }[] }));
vi.mock('./repxIntake', () => ({
  ingestFile: async (file: File, uploadId: string) => ({
    images: ['data:image/png;base64,AAAA'],
    imageMeta: [{ uploadId, file: file.name, page: 0 }],
    texts: fileTexts.map((t) => ({ ...t, id: t.file, uploadId })),
    notices: ['"scan.pdf" had a page that could not be drawn.'],
  }),
  inUnit: <T,>(texts: T[]) => texts,
}));
vi.mock('./ocrAttach', () => ({ readPage }));
vi.mock('./geminiClient', () => ({ loadGemini: async () => ({ analyzeReportDesign, REQUEST_BUDGET: 6 }) }));
vi.mock('./fallbackChain', () => ({
  askWithChain: async (config: ReportConfig, ask: (c: ReportConfig) => Promise<unknown>) => ({ value: await ask(config), config, by: 'gemini', note: '' }),
}));
vi.mock('./autoConfig', () => ({ applyDetected: (config: ReportConfig) => config, detectSettings: () => ({}) }));
vi.mock('./attachmentParts', () => ({ toAttachmentParts: (_: unknown, texts: { text: string }[]) => texts.map((t) => ({ text: t.text })) }));
vi.mock('./memory', () => ({ readMemory: () => ({}), instructionsOf: () => '' }));
vi.mock('./repxAudit', () => ({ auditRepx: () => ({ errors: 0, warnings: 1, findings: [] }) }));

const BLANK = { severity: 'error', code: 'bound-cell-blank', message: 'cellAmount ([Amount]) prints nothing.' };

const config = { unit: 'HundredthsOfAnInch', pageSize: 'A4' } as ReportConfig;

function deps(): BatchRunDeps {
  return {
    config,
    detectInput: () => ({}) as never,
    visionPages: () => [0],
    prepareTeam: vi.fn(async () => ({ brief: '' })),
    ocrAttachments: vi.fn(async () => []),
    asConfigured: vi.fn(async (xml: string) => xml),
    translateXml: vi.fn(async (xml: string) => ({ xml })),
    recordLearning: vi.fn(),
    aiKindOf: (by) => by,
    uid: null,
  };
}

describe('runBatchFile: one Batch file, made as a single report is', () => {
  beforeEach(() => {
    readPage.mockReset();
    fileTexts.length = 0;
    analyzeReportDesign.mockReset();
    analyzeReportDesign.mockResolvedValue({ repxContent: '<R/>', markdown: '', layout: { title: 'Invoice', sections: [{}, {}] } });
  });

  // A later batch's file in the same place has the same row id (2026-11-11): its page is read again, never reused.
  it('reads each file\'s pages afresh, so a later batch never gets an earlier file\'s text', async () => {
    const { runBatchFile } = await import('./batchRun');
    readPage.mockResolvedValueOnce({ ocr: { width: 10, height: 10, lines: [{ text: 'first' }] } });
    readPage.mockResolvedValueOnce({ ocr: { width: 10, height: 10, lines: [{ text: 'second' }] } });
    const signal = new AbortController().signal;
    const one = deps();
    await runBatchFile(new File(['a'], 'scan0001.png'), signal, '0:scan0001.png', '', one);
    const two = deps();
    await runBatchFile(new File(['b'], 'scan0001.png'), signal, '0:scan0001.png', '', two);
    expect(readPage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(two.ocrAttachments).mock.calls[0][0][0].read.ocr.lines[0].text).toBe('second');
  });

  it('goes on without a page it could not read, and tries it again next time', async () => {
    const { runBatchFile } = await import('./batchRun');
    readPage.mockRejectedValueOnce(new Error('no worker'));
    const d = deps();
    const out = await runBatchFile(new File(['a'], 'scan.png'), new AbortController().signal, '1:scan.png', '', d);
    expect(out.repxContent).toBe('<R/>');
    expect(vi.mocked(d.ocrAttachments).mock.calls[0][0]).toEqual([]);
    readPage.mockResolvedValueOnce({ ocr: { width: 10, height: 10, lines: [] } });
    await runBatchFile(new File(['a'], 'scan.png'), new AbortController().signal, '1:scan.png', '', deps());
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  it('puts the reading\'s notices on the row, and files its learning event under no project', async () => {
    const { runBatchFile } = await import('./batchRun');
    readPage.mockResolvedValue({ ocr: { width: 10, height: 10, lines: [] } });
    const d = deps();
    const out = await runBatchFile(new File(['a'], 'scan.pdf'), new AbortController().signal, '2:scan.pdf', 'in landscape', d);
    expect(out).toMatchObject({ title: 'Invoice', bands: 2, errors: 0, warnings: 1, notes: '"scan.pdf" had a page that could not be drawn.' });
    expect(analyzeReportDesign.mock.calls[0][0]).toBe('in landscape');
    expect(vi.mocked(d.recordLearning)).toHaveBeenCalledWith(expect.objectContaining({ request: 'batch', projectId: null, prompt: 'in landscape' }));
  });

  it('stops before asking the AI when the batch is stopped', async () => {
    const { runBatchFile } = await import('./batchRun');
    const controller = new AbortController();
    readPage.mockImplementation(async () => {
      controller.abort();
      throw new Error('aborted');
    });
    await expect(runBatchFile(new File(['a'], 'scan.png'), controller.signal, '3:scan.png', '', deps())).rejects.toThrow(/stopped/);
    expect(analyzeReportDesign).not.toHaveBeenCalled();
  });

  // 2026-11-11, the re-audit's R2-05: a Batch report skipped the print check, and one that printed wrong counted as clean.
  it('sends a report that prints wrong back once, from the file\'s own allowance, with the fields and the files\' texts', async () => {
    const { runBatchFile } = await import('./batchRun');
    readPage.mockResolvedValue({ ocr: { width: 10, height: 10, lines: [] } });
    fileTexts.push({ file: 'orders.csv', text: 'Id,Amount' });
    analyzeReportDesign.mockResolvedValueOnce({ repxContent: '<R/>', markdown: '', layout: { title: 'Invoice', sections: [] }, printFindings: [BLANK] });
    analyzeReportDesign.mockResolvedValueOnce({ repxContent: '<Fixed/>', markdown: '', layout: { title: 'Invoice', sections: [] } });
    const d = { ...deps(), fields: ['Id', 'Amount'] };
    const out = await runBatchFile(new File(['a'], 'scan.png'), new AbortController().signal, '4:scan.png', '', d);
    expect(analyzeReportDesign).toHaveBeenCalledTimes(2);
    const [instruction, parts, , previous, , , options] = analyzeReportDesign.mock.calls[1];
    expect(instruction).toContain('[bound-cell-blank]');
    expect(parts).toEqual([{ text: 'Id,Amount' }]);
    expect(previous).toEqual({ repxContent: '<R/>' });
    expect(options.fields).toEqual(['Id', 'Amount']);
    // One allowance, the first answer's and the fix's.
    expect(options.budget).toBe(analyzeReportDesign.mock.calls[0][6].budget);
    expect(analyzeReportDesign.mock.calls[0][6].fields).toEqual(['Id', 'Amount']);
    expect(out).toMatchObject({ repxContent: '<Fixed/>', errors: 0 });
  });

  it('counts what the print still shows on the row when the allowance is spent, and a grid drawn as loose texts', async () => {
    const { runBatchFile } = await import('./batchRun');
    readPage.mockResolvedValue({ ocr: { width: 10, height: 10, lines: [] } });
    analyzeReportDesign.mockImplementationOnce(async (...args: unknown[]) => {
      (args[6] as { budget: { left: number } }).budget.left = 0;
      return {
        repxContent: '<R/>',
        markdown: '',
        layout: { title: 'Invoice', sections: [] },
        printFindings: [BLANK, { severity: 'warning', code: 'value-unformatted', message: '' }],
        evidenceFindings: [{ severity: 'warning', code: 'grid-not-a-table', message: '' }],
      };
    });
    const out = await runBatchFile(new File(['a'], 'scan.png'), new AbortController().signal, '5:scan.png', '', deps());
    expect(analyzeReportDesign).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ errors: 1, warnings: 2 });
  });

  // R3-08: an SSRS or FastReport file arrives converted to a .repx, and is a report as on the single path.
  it('treats a converted .rdl as the report it builds on, not as a picture\'s', async () => {
    const { runBatchFile } = await import('./batchRun');
    readPage.mockResolvedValue({ ocr: { width: 10, height: 10, lines: [] } });
    fileTexts.push({ file: 'orders.rdl', text: 'Existing DevExpress report (orders.rdl).\n\n<XtraReportsLayoutSerializer Ref="0" />' });
    const d = deps();
    await runBatchFile(new File(['a'], 'orders.rdl'), new AbortController().signal, '6:orders.rdl', '', d);
    // Kept as written (not turned as a page seen), and counted as a report brought.
    expect(vi.mocked(d.asConfigured).mock.calls[0][1]).toBe(false);
    expect(vi.mocked(d.recordLearning)).toHaveBeenCalledWith(expect.objectContaining({ sourceCounts: expect.objectContaining({ repx: 1 }) }));
  });
});
