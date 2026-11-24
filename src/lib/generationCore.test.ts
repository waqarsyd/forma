import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportConfig } from '../services/geminiService';
import type { GenerationDeps, IntakeDeps, PageRead, SentPage } from './generationCore';
import type { KeptChoice } from './learningLoop';
import type { ReportQuery } from './sqlQuery';

/*
 * The generation core (2026-11-24, the MCP work's wave 6): the one way a
 * report is made, which the workspace and Batch call and the MCP server's AI
 * tools call (src/mcp/genJobs.ts). Every part it is handed is stood in for, and
 * every module that would ask an AI, read a page or build a report; what is
 * checked is what it asks of each part, and in what order. No key: the
 * request is a stub. App.tsx has no tests, so these cases are what hold the
 * parts the workspace hands in (the page reader, a shared database, the
 * vision model) to being used, and Batch's differences (the core's header)
 * to being kept on purpose.
 */
const h = vi.hoisted(() => ({
  analyzeReportDesign: vi.fn(),
  askWithChain: vi.fn(),
  fixUntilPrints: vi.fn(),
  buildWithReader: vi.fn(),
  buildFromRead: vi.fn(),
  templateCorrection: vi.fn(),
  languageToTranslate: vi.fn(),
  languageAsked: vi.fn(),
  translateReportXml: vi.fn(),
  visionDraft: vi.fn(),
  pages: {} as Record<string, number>,
  drawings: [] as unknown[],
  signals: [] as (AbortSignal | undefined)[],
  onIngest: null as ((name: string) => void) | null,
}));

vi.mock('./repxIntake', () => ({
  // A file becomes as many pictures as `h.pages` says (one by default), all of one upload.
  ingestFile: async (file: File, uploadId: string, _unit: string, drawing: unknown, signal?: AbortSignal) => (h.drawings.push(drawing), h.signals.push(signal), h.onIngest?.(file.name), {
    images: Array.from({ length: h.pages[file.name] ?? 1 }, () => 'data:image/png;base64,AAAA'),
    imageMeta: Array.from({ length: h.pages[file.name] ?? 1 }, (_, page) => ({ uploadId, file: file.name, page })),
    texts: [],
    notices: file.name.endsWith('.pdf') ? [`"${file.name}" had a page that could not be drawn.`] : [],
  }),
  inUnit: <T,>(texts: T[]) => texts,
  templateCorrection: h.templateCorrection,
  pictureKey: () => 'pic-1',
}));
vi.mock('./ocrAttach', () => ({
  sourceLayoutOf: () => ({ title: 'as read', sections: [] }),
  buildWithReader: h.buildWithReader,
  buildFromRead: h.buildFromRead,
  ocrTexts: (read: PageRead[]) => read.map((r) => ({ file: r.meta.file, page: (r.meta.page ?? 0) + 1, uploadId: r.meta.uploadId, text: r.read.ocr.lines.map((l) => l.text).join('\n') })),
}));
vi.mock('./formaTeam', () => ({
  draftBrief: () => 'BRIEF',
  readerCorrection: () => ({ text: 'DRAFT', texts: [], title: 'Invoice' }),
}));
vi.mock('./visionDraft', () => ({ visionDraft: h.visionDraft }));
vi.mock('./geminiClient', () => ({
  loadGemini: async () => ({ analyzeReportDesign: h.analyzeReportDesign, REQUEST_BUDGET: 6 }),
  isMissingApiKey: (err: unknown) => (err as { name?: string })?.name === 'MissingApiKeyError',
}));
vi.mock('./fallbackChain', () => ({ askWithChain: h.askWithChain }));
vi.mock('./printCheck', () => ({ fixUntilPrints: h.fixUntilPrints }));
vi.mock('./repxTranslate', () => ({
  languageToTranslate: h.languageToTranslate,
  languageAsked: h.languageAsked,
  translateReportXml: h.translateReportXml,
  rightToLeftFor: (xml: string) => xml,
}));
vi.mock('./repairChain', () => ({ repairRepx: (xml: string) => ({ xml: `${xml}<!--repaired-->` }) }));
// Each turn marks the file, so what was turned, and in what order, shows in it.
vi.mock('./repxRtl', () => ({ toLogicalRtl: (xml: string) => `${xml}<!--as seen, turned round-->`, makeRightToLeft: (xml: string) => `${xml}<!--right to left-->` }));
vi.mock('./repxViews', () => ({ specFromRepx: (xml: string) => `spec of ${xml}`, layoutFromRepx: (_: string, title: string) => ({ title, sections: [] }) }));

const config = { version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'A4', customApiKey: 'stand-in' } as ReportConfig;
const ANSWER = { repxContent: '<AI/>', markdown: '# Invoice', layout: { title: 'Invoice', sections: [] } };
const BUILT = { skeleton: {}, layout: { title: 'Invoice', sections: [] }, markdown: '# Invoice', title: 'Invoice', repxContent: '<Reader/>', pageReading: { page: 'the first, in numbers' } };
const LIMIT = () => new Error('Gemini\'s free limit is used up.');

/** Every page read, its one line naming it. */
const readAll = (pages: readonly SentPage[]): PageRead[] =>
  pages.map((p) => ({ meta: p.meta, read: { ocr: { width: 850, height: 1100, lines: [{ text: `${p.meta.file} p${p.meta.page}` }] } } as unknown as PageRead['read'] }));

function deps(): GenerationDeps & IntakeDeps {
  return {
    drawing: { what: 'the drawing handed in' } as unknown as IntakeDeps['drawing'],
    detect: vi.fn(() => ({ version: '23.2', unit: 'HundredthsOfAnInch', pageSize: 'Letter', rtl: false, reasons: [] })),
    readPages: vi.fn(async (pages: readonly SentPage[], _s: AbortSignal, _c: ReportConfig, now?: readonly SentPage[]) => readAll(now ?? pages)),
    readLater: vi.fn(async (pages: readonly SentPage[]) => readAll(pages)),
    visionModel: () => null,
    loadReader: async () => ({}) as never,
    designFromWords: vi.fn(async () => ({ design: { title: 'Customers', repx: '<Offline/>', layout: { title: 'Customers', sections: [] }, markdown: '# Customers' } as never })),
    recordLearning: vi.fn(),
    beforeGeneration: vi.fn(async () => ({ remembered: 'Always A4.', kept: null as KeptChoice | null })),
    onProgress: vi.fn(),
  };
}

const png = () => [{ file: new File(['a'], 'scan.png'), uploadId: 'u1' }];
const pdf = (pages: number) => {
  h.pages['scan.pdf'] = pages;
  return [{ file: new File(['a'], 'scan.pdf'), uploadId: 'u1' }];
};
const PAGE: SentPage = { src: 'data:image/png;base64,AAAA', meta: { uploadId: 'u1', file: 'scan.png', page: 1 } };
const REPX = { id: 'x', uploadId: 'u2', file: 'invoice.repx', text: '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0"/>' };
const CSV = { id: 'c', uploadId: 'u3', file: 'rows.csv', text: 'Name,Total' };

/*
 * The modules a source loads before its body runs: its value imports and
 * re-exports. A whole `import type` is erased and loads nothing;
 * `import { a, type B }` still loads its module. Read from the source, as
 * src/mcp/boundaries.test.ts reads src/mcp, because a load in this file
 * would go through the stand-ins above.
 */
const STATIC_IMPORTS = [
  /\bimport\s+(type\s+)?[\w*{}\s,$]+?\s+from\s*['"]([^'"]+)['"]/g,
  /\bexport\s+(type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s*['"]([^'"]+)['"]/g,
  /\bimport()\s*['"]([^'"]+)['"]/g,
];
const LIB = dirname(fileURLToPath(import.meta.url));

/** Every module a load of `entry` evaluates, by its path from src/lib, and every package. */
function staticGraph(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const source = readFileSync(file, 'utf8');
    for (const re of STATIC_IMPORTS) {
      for (const [, typeOnly, spec] of source.matchAll(re)) {
        if (typeOnly) continue;
        if (!spec.startsWith('.')) {
          packages.add(spec);
          continue;
        }
        const base = resolve(dirname(file), spec);
        const found = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), base].find((p) => /\.tsx?$/.test(p) && existsSync(p));
        if (!found) throw new Error(`${file} imports ${spec}, which is not a source here`);
        visit(found);
      }
    }
  };
  visit(entry);
  return { files: [...files].map((f) => relative(LIB, f).split(sep).join('/')).sort(), packages: [...packages].sort() };
}

describe('the generation core: one way a report is made', () => {
  beforeEach(() => {
    for (const fn of [h.analyzeReportDesign, h.askWithChain, h.fixUntilPrints, h.buildWithReader, h.buildFromRead, h.templateCorrection, h.languageToTranslate, h.languageAsked, h.translateReportXml, h.visionDraft]) fn.mockReset();
    for (const k of Object.keys(h.pages)) delete h.pages[k];
    h.drawings.length = 0;
    h.signals.length = 0;
    h.onIngest = null;
    h.analyzeReportDesign.mockResolvedValue(ANSWER);
    h.askWithChain.mockImplementation(async (c: ReportConfig, ask: (c: ReportConfig) => Promise<unknown>) => ({ value: await ask(c), config: c, by: 'gemini', note: '' }));
    h.fixUntilPrints.mockImplementation(async (first: { usage?: unknown }) => ({ answer: first, spent: first.usage ?? null, findings: [] }));
    h.buildWithReader.mockReturnValue(null);
    h.buildFromRead.mockReturnValue({ markdown: '# Page', title: 'Page', layout: { title: 'Page', sections: [] }, repxContent: '<Ocr/>' });
    h.templateCorrection.mockReturnValue(null);
    h.languageToTranslate.mockReturnValue(null);
    h.languageAsked.mockReturnValue(null);
  });

  it('imports at its top only modules that load in Node as they are; the rest it loads when needed, or as types', () => {
    // Not a document, a worker or storage among them (the header): a Node caller can pass its own parts.
    // A lazy import made static fails here, though it would load in this file through the stand-ins.
    expect(staticGraph(join(LIB, 'generationCore.ts'))).toEqual({
      files: ['attachmentParts.ts', 'autoConfig.ts', 'dataSource.ts', 'geminiClient.ts', 'generationCore.ts', 'promptToReport.ts', 'reportFile.ts', 'reportGeometry.ts'],
      packages: [],
    });
  });

  it('makes a first report from a picture by having the AI correct Forma\'s draft', async () => {
    const { makeReport } = await import('./generationCore');
    h.buildWithReader.mockReturnValue(BUILT);
    const findings = [{ code: 'missing-text', severity: 'warning', message: 'A line the page has is not in the report.' }];
    h.analyzeReportDesign.mockResolvedValue({ ...ANSWER, usage: { totalTokens: 10 }, evidenceFindings: findings });
    h.fixUntilPrints.mockImplementationOnce(async (first: unknown) => ({ answer: first, spent: { totalTokens: 25 }, findings: [] }));
    const kept = { name: 'Last invoice', face: 'Arial', titleSize: 18, block: 'KEPT' };
    const d = { ...deps(), houseStyle: vi.fn(async () => 'STYLE') };
    vi.mocked(d.beforeGeneration).mockResolvedValueOnce({ remembered: 'Always A4.', kept });
    const made = await makeReport({ files: png(), words: 'an invoice', config, signal: new AbortController().signal }, d);
    expect(made).toMatchObject({ ok: true, repxContent: '<AI/>', note: '', by: 'gemini', standIn: null, pictures: 1, kept, team: { reading: BUILT.pageReading } });
    // Every answer this report cost, the fix's too, and what Forma's reading found, keyed to the file it was found in.
    expect(made).toMatchObject({ spent: { totalTokens: 25 }, evidence: { findings, on: 'pic-1' } });
    // The settings from the words and the file, which the pages are read with, then again from what was read.
    expect(vi.mocked(d.detect)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(d.readPages).mock.calls[0][2]).toMatchObject({ pageSize: 'Letter', version: '23.2' });
    expect(vi.mocked(d.detect).mock.calls[1][0]).toMatchObject({ words: 'an invoice\nscan.png p0' });
    const [words, parts, asked, previous, , onProgress, options] = h.analyzeReportDesign.mock.calls[0];
    expect(words).toBe('an invoice');
    expect(parts).toEqual([{ text: 'scan.png p0' }, { inlineData: { data: 'AAAA', mimeType: 'image/png' } }]);
    expect(asked).toMatchObject({ pageSize: 'Letter', version: '23.2' });
    expect(previous).toBeUndefined();
    expect(onProgress).toBe(d.onProgress);
    expect(options).toMatchObject({ draft: { text: 'DRAFT' }, formaBrief: 'BRIEF', remembered: 'Always A4.', evidence: { title: 'as read' } });
    // OCR's text is what the draft is written from, not a file attached beside it.
    expect(options.extras).toEqual([]);
    // The house style is found by the open report, and there is none.
    expect(d.houseStyle).not.toHaveBeenCalled();
    expect(vi.mocked(d.beforeGeneration)).toHaveBeenCalledWith(expect.objectContaining({ first: true, drafting: true }));
    // The fix: from the answer's usage, told the draft, and asked with the page's evidence and the progress.
    const fix = h.fixUntilPrints.mock.calls[0][1];
    expect(fix).toMatchObject({ described: false, fromReport: false, draftText: 'DRAFT', spent: { totalTokens: 10 } });
    await fix.ask('Fix this.', '<AI/>');
    const [, , , , , fixProgress, fixOptions] = h.analyzeReportDesign.mock.calls[1];
    expect(fixProgress).toBe(d.onProgress);
    expect(fixOptions).toMatchObject({ evidence: { title: 'as read' } });
  });

  it('asks the AI it is handed, the fix as well, and hands the intake the drawing it is given', async () => {
    // The MCP server's mock and Node's drawing come in this way (2026-11-24, wave 7): never an environment read in the service.
    const { makeReport } = await import('./generationCore');
    h.buildWithReader.mockReturnValue(BUILT);
    const ask = vi.fn(async (..._args: unknown[]) => ANSWER);
    const d = { ...deps(), ask: ask as unknown as GenerationDeps['ask'] };
    const made = await makeReport({ files: png(), words: 'an invoice', config, signal: new AbortController().signal }, d);
    expect(made).toMatchObject({ ok: true, repxContent: '<AI/>' });
    expect(h.drawings).toEqual([d.drawing]);
    expect(ask.mock.calls[0][6]).toMatchObject({ draft: { text: 'DRAFT' }, formaBrief: 'BRIEF' });
    await h.fixUntilPrints.mock.calls[0][1].ask('Fix this.', '<AI/>');
    expect(ask).toHaveBeenCalledTimes(2);
    expect(h.analyzeReportDesign).not.toHaveBeenCalled();
  });

  it('reads only the first and last page of a long upload first, and the pages between when the AI designs it instead', async () => {
    const { makeReport } = await import('./generationCore');
    const d = deps();
    // The box reader builds nothing: there is no draft to correct.
    const made = await makeReport({ files: pdf(4), words: '', config, signal: new AbortController().signal }, d);
    const [sent, , , now] = vi.mocked(d.readPages).mock.calls[0];
    expect(sent.map((p) => p.meta.page)).toEqual([0, 1, 2, 3]);
    expect(now!.map((p) => p.meta.page)).toEqual([0, 3]);
    expect(vi.mocked(d.readLater!).mock.calls[0][0].map((p) => p.meta.page)).toEqual([1, 2]);
    expect(made!.ok && made!.texts.map((t) => t.text)).toEqual(['scan.pdf p0', 'scan.pdf p3', 'scan.pdf p1', 'scan.pdf p2']);
    expect(made!.notices).toEqual(['"scan.pdf" had a page that could not be drawn.']);

    // With a draft to correct, the pages between are never read.
    h.buildWithReader.mockReturnValue(BUILT);
    const again = deps();
    await makeReport({ files: pdf(4), words: '', config, signal: new AbortController().signal }, again);
    expect(again.readLater).not.toHaveBeenCalled();
  });

  it('reads with the settings the workspace worked out, and never a page whose text came with it', async () => {
    const { readRequest } = await import('./generationCore');
    const d = deps();
    const settings = { ...config, pageSize: 'Legal' } as ReportConfig;
    const meta = (page: number) => ({ uploadId: 'u1', file: 'scan.pdf', page });
    const layer = { id: 't2', uploadId: 'u1', file: 'scan.pdf', page: 2, text: 'the text layer of page 2' };
    const read = await readRequest(
      { images: [PAGE.src, PAGE.src], imageMeta: [meta(1), meta(2)], texts: [layer], words: '', open: false, config, settings, signal: new AbortController().signal },
      d,
    );
    // Worked out once, from what was read: the workspace's own came with the request.
    expect(vi.mocked(d.detect)).toHaveBeenCalledTimes(1);
    const [sent, , readWith] = vi.mocked(d.readPages).mock.calls[0];
    expect(sent.map((p) => p.meta.page)).toEqual([1]);
    expect(readWith).toBe(settings);
    expect(read!.texts.map((t) => t.text)).toEqual(['the text layer of page 2', 'scan.pdf p1']);
  });

  it('reads the pages with the page reader beside OCR, and sends what it read as readings, never as files', async () => {
    const { makeReport } = await import('./generationCore');
    const pageReader = vi.fn(async (pages: readonly SentPage[]) =>
      pages.map((p) => ({ id: `reader-${p.meta.page}`, uploadId: p.meta.uploadId, file: p.meta.file, page: p.meta.page, text: `reader p${p.meta.page}`, readByReader: true as const })),
    );
    const made = await makeReport({ files: pdf(4), words: '', config, signal: new AbortController().signal }, { ...deps(), pageReader });
    // The first and last page with OCR's, the pages between once the AI designs from every page.
    expect(pageReader.mock.calls.map(([pages]) => pages.map((p) => p.meta.page))).toEqual([[0, 3], [1, 2]]);
    expect(made!.ok && made!.texts.filter((t) => t.readByReader).map((t) => t.text)).toEqual(['reader p0', 'reader p3', 'reader p1', 'reader p2']);
    const options = h.analyzeReportDesign.mock.calls[0][6];
    expect(options.readings).toEqual(['reader p0', 'reader p3', 'reader p1', 'reader p2']);
    expect(options.extras).toEqual([]);
  });

  it('takes the vision model\'s draft when one is set up, and a stop while it reads is a stop', async () => {
    const { makeReport } = await import('./generationCore');
    const vision = { baseUrl: 'http://127.0.0.1:1234/v1', model: 'forma-vision' };
    const visionModel = vi.fn(() => vision);
    const result = { content: '# Vision', timestamp: new Date(), title: 'Vision', repxContent: '<Vision/>', usage: null };
    h.visionDraft.mockResolvedValueOnce({ brief: 'VISION BRIEF', correct: { text: 'VISION DRAFT', texts: [], title: 'Vision' }, skeleton: { shape: 'vision' }, result });
    const d = { ...deps(), visionModel };
    const made = await makeReport({ files: pdf(3), words: '', config, signal: new AbortController().signal }, d);
    expect(made).toMatchObject({ ok: true });
    expect(visionModel).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 'Letter' }));
    // The first page and the upload's last, the pages read, and the settings worked out.
    const [asked, first, last, read, settings] = h.visionDraft.mock.calls[0];
    expect(asked).toBe(vision);
    expect([first.meta.page, last.meta.page]).toEqual([0, 2]);
    expect(read.map((r: PageRead) => r.meta.page)).toEqual([0, 2]);
    expect(settings).toMatchObject({ pageSize: 'Letter', version: '23.2' });
    expect(h.buildWithReader).not.toHaveBeenCalled();
    expect(h.analyzeReportDesign.mock.calls[0][6]).toMatchObject({ formaBrief: 'VISION BRIEF', draft: { text: 'VISION DRAFT' } });
    expect(vi.mocked(d.beforeGeneration)).toHaveBeenCalledWith(expect.objectContaining({ shape: { shape: 'vision' } }));

    // Stopped while it reads: no box reader in its place, and nothing asked.
    const stopping = new AbortController();
    h.visionDraft.mockImplementationOnce(async () => {
      stopping.abort();
      throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    });
    expect(await makeReport({ files: png(), words: '', config, signal: stopping.signal }, { ...deps(), visionModel })).toBeNull();
    expect(h.buildWithReader).not.toHaveBeenCalled();
    expect(h.analyzeReportDesign).toHaveBeenCalledTimes(1);
  });

  it('corrects a Word or Excel template\'s layout when the words ask for a report from it', async () => {
    const { generateReport } = await import('./generationCore');
    h.templateCorrection.mockReturnValue({ text: 'TEMPLATE', texts: [], title: 'Form' });
    const texts = [{ id: 'f', uploadId: 'u1', file: 'form.docx', text: 'Name Date', layout: 'TEMPLATE' }];
    await generateReport({ words: 'a report from the template', images: [], texts, settings: config, signal: new AbortController().signal }, deps());
    expect(h.templateCorrection).toHaveBeenCalledWith(texts, 'a report from the template');
    expect(h.analyzeReportDesign.mock.calls[0][6].draft).toEqual({ text: 'TEMPLATE', texts: [], title: 'Form' });
  });

  it('designs a report from a description: the house style is its brief, and the fix may send it back', async () => {
    const { makeReport } = await import('./generationCore');
    const d = { ...deps(), houseBrief: vi.fn(async () => 'HOUSE') };
    const description = { description: 'A customer list grouped by country with balance totals', title: 'Customers' };
    const made = await makeReport({ words: '', description, config, signal: new AbortController().signal }, d);
    expect(made).toMatchObject({ ok: true, pictures: 0, notices: [] });
    expect(vi.mocked(d.detect)).toHaveBeenCalledWith({ words: 'A customer list grouped by country with balance totals\nCustomers' });
    expect(d.readPages).not.toHaveBeenCalled();
    const [words, parts, , previous, , , options] = h.analyzeReportDesign.mock.calls[0];
    expect([words, parts, previous]).toEqual(['', [], undefined]);
    expect(options).toMatchObject({ description, formaBrief: 'HOUSE', draft: null });
    const fix = h.fixUntilPrints.mock.calls[0][1];
    expect(fix).toMatchObject({ described: true });
    // The fix is told it was described, so the audit's errors are what it is asked about.
    await fix.ask('Fix this.', '<AI/>');
    expect(h.analyzeReportDesign.mock.calls[1][6]).toMatchObject({ description });
    expect(vi.mocked(d.beforeGeneration)).toHaveBeenCalledWith(expect.objectContaining({ first: true, drafting: false, description: description.description }));
  });

  it('redesigns an open report: it goes with the request, never Forma\'s draft, and nothing stands in when the AI fails', async () => {
    const { generateReport, readRequest } = await import('./generationCore');
    h.buildWithReader.mockReturnValue(BUILT);
    const d = { ...deps(), houseStyle: vi.fn(async () => 'STYLE') };
    const signal = new AbortController().signal;
    const open = { repxContent: '<Open/>' };
    const sent = await readRequest({ images: [PAGE.src], imageMeta: [PAGE.meta], texts: [], words: 'match this', open: true, config, signal }, d);
    // The pages still unread are read for a redesign, which no draft of Forma's is sent for.
    const readRest = vi.fn(async () => [{ id: 'r', uploadId: 'u1', file: 'scan.png', page: 2, text: 'scan.png p2', readByOcr: true as const }]);
    const made = await generateReport({ words: 'match this', images: [PAGE.src], texts: sent!.texts, settings: sent!.settings, team: { ...sent!.team!, readRest }, open, signal }, d);
    expect(made).toMatchObject({ ok: true, startedFromReport: true });
    expect(readRest).toHaveBeenCalledWith(signal);
    expect(made!.ok && made!.texts.map((t) => t.text)).toEqual(['scan.png p1', 'scan.png p2']);
    expect(d.houseStyle).toHaveBeenCalledWith('<Open/>', 'match this', expect.anything(), signal);
    const [, , , previous, , , options] = h.analyzeReportDesign.mock.calls[0];
    expect(previous).toEqual({ repxContent: '<Open/>', houseStyle: 'STYLE' });
    expect(options.draft).toBeNull();
    expect(h.fixUntilPrints.mock.calls[0][1]).toMatchObject({ fromReport: true });
    expect(vi.mocked(d.beforeGeneration)).toHaveBeenCalledWith(expect.objectContaining({ first: false }));
    // An open report is never translated whole as a first report is.
    expect(h.languageToTranslate).not.toHaveBeenCalled();

    h.askWithChain.mockRejectedValueOnce(LIMIT());
    const failed = await generateReport({ words: 'match this', images: [], texts: [], settings: config, team: sent!.team, open, signal }, d);
    expect(failed).toMatchObject({ ok: false, standIn: null });

    // The house style is found by the open report's file; a report open with none asks for none.
    const asked = d.houseStyle.mock.calls.length;
    await generateReport({ words: 'match this', images: [], texts: [], settings: config, open: {}, signal }, d);
    expect(d.houseStyle).toHaveBeenCalledTimes(asked);
  });

  it('builds on a report attached as on an open one: never a first report, the fix sent without it, and nothing standing in', async () => {
    const { generateReport } = await import('./generationCore');
    h.buildWithReader.mockReturnValue(BUILT);
    const d = deps();
    const signal = new AbortController().signal;
    const request = { words: 'add a total', images: [PAGE.src], texts: [REPX, CSV], settings: config, team: { read: readAll([PAGE]) }, signal };
    const made = await generateReport(request, d);
    expect(made).toMatchObject({ ok: true, startedFromReport: true });
    expect(vi.mocked(d.beforeGeneration)).toHaveBeenCalledWith(expect.objectContaining({ first: false }));
    const fix = h.fixUntilPrints.mock.calls[0][1];
    expect(fix.fromReport).toBe(true);
    // With the texts the person attached, not the report it is built on (R2-06).
    await fix.ask('Fix this.', '<AI/>');
    expect(h.analyzeReportDesign.mock.calls[1][1]).toEqual([{ text: 'Name,Total' }]);

    h.askWithChain.mockRejectedValueOnce(LIMIT());
    expect(await generateReport(request, d)).toMatchObject({ ok: false, standIn: null });
  });

  it('stands Forma\'s draft in when every AI fails, built and configured as a report from the page', async () => {
    const { makeReport } = await import('./generationCore');
    h.buildWithReader.mockReturnValue(BUILT);
    const error = LIMIT();
    h.askWithChain.mockRejectedValueOnce(error);
    const made = await makeReport({ files: png(), words: '', config, signal: new AbortController().signal }, deps());
    expect(made).toMatchObject({ ok: false, error, standIn: { source: 'reader', result: { title: 'Invoice', repxContent: '<Reader/><!--repaired-->' } } });

    // With no box reader's draft, OCR's own build.
    h.buildWithReader.mockReturnValue(null);
    h.askWithChain.mockRejectedValueOnce(error);
    const ocr = await makeReport({ files: png(), words: '', config, signal: new AbortController().signal }, deps());
    expect(ocr).toMatchObject({ ok: false, standIn: { source: 'ocr', result: { repxContent: '<Ocr/><!--repaired-->' } } });

    // A description's is Forma's own model's design, a learning event of its own.
    h.askWithChain.mockRejectedValueOnce(error);
    const d = deps();
    const words = await makeReport({ words: '', description: { description: 'A customer list grouped by country' }, config, signal: new AbortController().signal }, d);
    expect(words).toMatchObject({ ok: false, standIn: { source: 'offline', result: { repxContent: '<Offline/><!--repaired-->' } } });
    expect(vi.mocked(d.recordLearning)).toHaveBeenCalledWith(expect.objectContaining({ ai: 'forma', draft: 'offline' }));
  });

  it('turns a report right to left where its source is: one from a page as the page is seen, a description\'s and a brought report\'s as written', async () => {
    const { generateReport } = await import('./generationCore');
    const settings = { ...config, rtl: true } as ReportConfig;
    const signal = new AbortController().signal;
    const fromPage = { words: '', images: [PAGE.src], texts: [], settings, team: { read: readAll([PAGE]) }, signal };
    expect(await generateReport(fromPage, deps())).toMatchObject({ ok: true, repxContent: '<AI/><!--as seen, turned round--><!--right to left-->' });
    // Changed from a report, which is laid out right to left already: never turned round (the PIPE1 review).
    expect(await generateReport({ words: '', images: [], texts: [REPX], settings, signal }, deps())).toMatchObject({ ok: true, repxContent: '<AI/><!--right to left-->' });

    // Standing in, the box reader's draft is the page as seen; Forma's own model's design is not (PL-04b).
    h.buildWithReader.mockReturnValue(BUILT);
    h.askWithChain.mockRejectedValueOnce(LIMIT());
    expect(await generateReport(fromPage, deps())).toMatchObject({
      ok: false,
      standIn: { source: 'reader', result: { repxContent: '<Reader/><!--repaired--><!--as seen, turned round--><!--right to left-->' } },
    });
    h.askWithChain.mockRejectedValueOnce(LIMIT());
    const description = { description: 'A customer list, in Arabic' };
    expect(await generateReport({ words: '', images: [], texts: [], settings, description, team: { read: [], described: description }, signal }, deps())).toMatchObject({
      ok: false,
      standIn: { source: 'offline', result: { repxContent: '<Offline/><!--repaired--><!--right to left-->' } },
    });
  });

  it('stands nothing in for a missing AI: that is a setup step, not a failure', async () => {
    const { makeReport } = await import('./generationCore');
    const missing = Object.assign(new Error('Set up an AI.'), { name: 'MissingApiKeyError' });
    h.askWithChain.mockRejectedValueOnce(missing);
    const made = await makeReport({ files: png(), words: '', config, signal: new AbortController().signal }, deps());
    expect(made).toMatchObject({ ok: false, error: missing, standIn: null });
    expect(h.buildFromRead).not.toHaveBeenCalled();
  });

  it('carries the note that another AI answered on a limit, and asks the fix of that AI', async () => {
    const { makeReport } = await import('./generationCore');
    const switched = { ...config, provider: 'openrouter' } as ReportConfig;
    h.askWithChain.mockImplementationOnce(async (_c: ReportConfig, ask: (c: ReportConfig) => Promise<unknown>) => ({
      value: await ask(switched),
      config: switched,
      by: 'openrouter',
      note: "Gemini's free limit is used up for now, so OpenRouter answered this one.",
    }));
    const made = await makeReport({ files: png(), words: '', config, signal: new AbortController().signal }, deps());
    expect(made).toMatchObject({ ok: true, by: 'openrouter', note: "Gemini's free limit is used up for now, so OpenRouter answered this one.", answering: switched });
    // One budget: the fix spends from the allowance the answer had.
    const fix = h.fixUntilPrints.mock.calls[0][1];
    await fix.ask('Fix this.', '<AI/>');
    const [, , asked, previous, , , options] = h.analyzeReportDesign.mock.calls[1];
    expect([asked, previous]).toEqual([switched, { repxContent: '<AI/>' }]);
    expect(options.budget).toBe(h.analyzeReportDesign.mock.calls[0][6].budget);
  });

  it('translates a first report into the language its words name, with the settings the answer came from', async () => {
    const { makeReport } = await import('./generationCore');
    // Another AI answered on a limit, on other settings than the request's (R2-01): the translation is that AI's.
    const switched = { ...config, provider: 'openrouter', pageSize: 'A3' } as ReportConfig;
    h.askWithChain.mockImplementationOnce(async (_c: ReportConfig, ask: (c: ReportConfig) => Promise<unknown>) => ({ value: await ask(switched), config: switched, by: 'openrouter', note: 'OpenRouter answered.' }));
    h.languageToTranslate.mockReturnValue('German');
    h.translateReportXml.mockResolvedValue({ xml: '<AI lang="de"/>', bilingual: false });
    const made = await makeReport({ files: png(), words: 'make it in German', config, signal: new AbortController().signal }, deps());
    expect(h.languageToTranslate).toHaveBeenCalledWith('<AI/>', 'make it in German');
    // geminiService's translation, unless one is handed in: the MCP server's mock hands in its own (the wave-7 review's W7R-1).
    expect(h.translateReportXml).toHaveBeenCalledWith('<AI/>', 'German', expect.anything(), 'make it in German', switched, undefined);
    expect(made).toMatchObject({ ok: true, repxContent: '<AI lang="de"/>', translated: { language: 'German', bilingual: false } });
    const translateTexts = vi.fn() as unknown as GenerationDeps['translateTexts'];
    await makeReport({ files: png(), words: 'make it in German', config, signal: new AbortController().signal }, { ...deps(), translateTexts });
    expect(h.translateReportXml.mock.calls[1][5]).toBe(translateTexts);
  });

  it("hands the intake the request's signal, and takes no file in once stopped", async () => {
    // A PDF stops between its pages with it (lib/repxIntake.ts), and no file after the stop is opened (the wave-7 review's NODE7-PDF-HEAP).
    const { makeReport } = await import('./generationCore');
    const stopping = new AbortController();
    h.onIngest = () => stopping.abort();
    const files = [{ file: new File(['a'], 'first.png'), uploadId: 'u1' }, { file: new File(['b'], 'second.png'), uploadId: 'u2' }];
    const d = deps();
    expect(await makeReport({ files, words: '', config, signal: stopping.signal }, d)).toBeNull();
    expect(h.signals).toEqual([stopping.signal]);
    expect(d.readPages).not.toHaveBeenCalled();
  });

  it('writes a shared database\'s source from the answer, and asks the fix with its section', async () => {
    const { makeReport } = await import('./generationCore');
    const query = { kind: 'procedure', name: 'dbo.SalesByMonth' } as unknown as ReportQuery;
    const write = vi.fn(() => ({ xml: '<Bound/>', note: 'It reads from dbo.SalesByMonth.', query }));
    const chosen = vi.fn();
    const database = vi.fn(async () => ({ section: 'DATABASE', write, chosen }));
    h.analyzeReportDesign.mockResolvedValue({ ...ANSWER, dataQuery: { procedure: 'dbo.SalesByMonth' } });
    const made = await makeReport({ files: png(), words: 'sales by month', config, signal: new AbortController().signal }, { ...deps(), database });
    // Found by the words, the team's brief and every text the request carries.
    expect(database).toHaveBeenCalledWith('sales by month\n\nscan.png p0');
    expect(h.analyzeReportDesign.mock.calls[0][6].database).toBe('DATABASE');
    await h.fixUntilPrints.mock.calls[0][1].ask('Fix this.', '<AI/>');
    expect(h.analyzeReportDesign.mock.calls[1][6].database).toBe('DATABASE');
    // Written in the version worked out, the query chosen, and the views read again from the file written.
    expect(write).toHaveBeenCalledWith('<AI/>', { procedure: 'dbo.SalesByMonth' }, '23.2');
    expect(chosen).toHaveBeenCalledWith(query);
    expect(made).toMatchObject({ ok: true, dataNote: 'It reads from dbo.SalesByMonth.', repxContent: '<Bound/>', response: { markdown: 'spec of <Bound/>' } });
  });

  it('stops when told: nothing is asked after a stop, and nothing stands in for a stopped request', async () => {
    const { makeReport } = await import('./generationCore');
    const reading = new AbortController();
    const d = deps();
    vi.mocked(d.readPages).mockImplementationOnce(async () => {
      reading.abort();
      return [];
    });
    expect(await makeReport({ files: png(), words: '', config, signal: reading.signal }, d)).toBeNull();
    expect(h.analyzeReportDesign).not.toHaveBeenCalled();

    const asking = new AbortController();
    h.analyzeReportDesign.mockImplementationOnce(async () => {
      asking.abort();
      throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    });
    expect(await makeReport({ files: png(), words: '', config, signal: asking.signal }, deps())).toBeNull();
    expect(h.buildFromRead).not.toHaveBeenCalled();

    // Stopped as the answer came: it is not sent back to be fixed.
    const answered = new AbortController();
    h.analyzeReportDesign.mockImplementationOnce(async () => {
      answered.abort();
      return ANSWER;
    });
    expect(await makeReport({ files: png(), words: '', config, signal: answered.signal }, deps())).toBeNull();
    expect(h.fixUntilPrints).not.toHaveBeenCalled();
  });

  it('throws a Batch file\'s failure, with nothing standing in, and reads every page first', async () => {
    const { makeReport } = await import('./generationCore');
    const error = LIMIT();
    h.askWithChain.mockRejectedValueOnce(error);
    const d = deps();
    await expect(makeReport({ files: pdf(4), words: '', config, signal: new AbortController().signal, batchFile: true }, d)).rejects.toBe(error);
    expect(vi.mocked(d.readPages).mock.calls[0][3]).toBeUndefined();
    expect(h.buildFromRead).not.toHaveBeenCalled();
  });

  it('makes a Batch file as Batch made it: no other files, readings, template or draft text, and the file\'s own translation', async () => {
    const { generateReport } = await import('./generationCore');
    h.buildWithReader.mockReturnValue(BUILT);
    h.languageAsked.mockReturnValue('German');
    h.translateReportXml.mockResolvedValue({ xml: '<AI lang="de"/>', bilingual: false });
    h.analyzeReportDesign.mockResolvedValue({ ...ANSWER, evidenceFindings: [{ code: 'missing-text', severity: 'warning', message: 'A line is missing.' }] });
    const signal = new AbortController().signal;
    const settings = { ...config, pageSize: 'Legal' } as ReportConfig;
    const reading = { id: 'r', uploadId: 'u1', file: 'scan.png', page: 1, text: 'reader p1', readByReader: true as const };
    const file = { words: 'in German', images: [PAGE.src], texts: [CSV, reading], settings, team: { read: readAll([PAGE]) }, batchFile: true };
    const made = await generateReport({ ...file, signal }, deps());
    const options = h.analyzeReportDesign.mock.calls[0][6];
    expect(options).toMatchObject({ draft: { text: 'DRAFT' } });
    expect(options.extras).toBeUndefined();
    expect(options.readings).toBeUndefined();
    expect(h.fixUntilPrints.mock.calls[0][1].draftText).toBeUndefined();
    // Translated whole, with no words and the file's own settings, whatever the report already reads in.
    expect(h.languageToTranslate).not.toHaveBeenCalled();
    expect(h.languageAsked).toHaveBeenCalledWith('in German');
    expect(h.translateReportXml).toHaveBeenCalledWith('<AI/>', 'German', signal, '', settings, undefined);
    // The row counts what Forma's reading found; the REPX pane's key is a single report's.
    expect(made).toMatchObject({ ok: true, repxContent: '<AI lang="de"/>', evidence: null });

    // With no draft of Forma's, a template's layout is still not taken as one.
    h.buildWithReader.mockReturnValue(null);
    h.templateCorrection.mockReturnValue({ text: 'TEMPLATE', texts: [], title: 'Form' });
    const form = { id: 't', uploadId: 'u4', file: 'form.docx', text: 'Name Date', layout: 'TEMPLATE' };
    await generateReport({ words: 'a report from the template', images: [], texts: [form], settings, signal, batchFile: true }, deps());
    expect(h.templateCorrection).not.toHaveBeenCalled();
    expect(h.analyzeReportDesign.mock.lastCall![6].draft).toBeNull();

    // Stopped once its translation is done, the file still finishes.
    h.buildWithReader.mockReturnValue(BUILT);
    const stopping = new AbortController();
    h.translateReportXml.mockImplementationOnce(async () => {
      stopping.abort();
      return { xml: '<AI lang="de"/>', bilingual: false };
    });
    expect(await generateReport({ ...file, signal: stopping.signal }, deps())).toMatchObject({ ok: true, repxContent: '<AI lang="de"/>' });
  });
});
