/**
 * Forma drafts and the AI corrects (2026-11-05): the real `analyzeReportDesign`
 * against a stubbed network. What matters is what is sent, because that is
 * the saving: the short rules and Forma's draft with the picture, not the
 * mega-prompt and not OCR's text; thinking capped; and a report built by
 * Forma from what came back. And when the draft must not be used, it is not.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeReportDesign, DRAFT_THINKING_BUDGET, type DraftRequest, type ReportConfig } from './geminiService';
import { resetGenAIForTests } from '../lib/genai';
import { cacheModel, clearCachedModel } from '../lib/modelCache';

const KEY = 'test-key-not-a-real-credential';
const config: ReportConfig = { customApiKey: KEY, version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'Letter' };
const picture = { inlineData: { data: 'AAAA', mimeType: 'image/png' } };
const ocrText = { text: 'TEXT READ BY OCR ... "Chai" at 0,0' };

const draft: DraftRequest = {
  text: 'page Letter portrait 850 1100 75 75 75 75\nband ReportHeader 60 0\nlabel title 0 0 300 30 Arial:18b l 0 9 "| NVO | C E"',
  texts: [],
  title: 'invoice',
  readBy: "Forma's box reader, corrected by the AI",
};

const CORRECTED = [
  'page Letter portrait 850 1100 75 75 75 75',
  'band ReportHeader 60 0',
  'label title 0 0 300 30 Arial:18b l 0 7 "INVOICE"',
  'band PageHeader 20 0',
  'table caption 0 0 700 20 Arial:9b l 4 0',
  'row caption 3 Arial:9b l 11 "Description" | caption 1 Arial:9b r 6 "Amount"',
  'band Detail 20 0',
  'table value 0 0 700 20 Arial:9 l 0 0',
  'row value 3 Arial:9 l 0 [Description] | value 1 Arial:9 r 0 [Amount]',
].join('\n');

const sse = (text: string, finishReason?: string) =>
  `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }], role: 'model' }, ...(finishReason ? { finishReason } : {}) }] })}\r\n\r\n`;

const streamOf = (text: string) =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse(text, 'STOP')));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

const REPX = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" DisplayName="Designed" ReportUnit="HundredthsOfAnInch" Margins="0, 0, 0, 0" PageWidth="850" PageHeight="1100" Version="20.1"><Bands><Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="20" /></Bands></XtraReportsLayoutSerializer>`;

function stub(answer: string) {
  const mock = vi.fn(async (_url: unknown, _init?: unknown) => streamOf(answer));
  vi.stubGlobal('fetch', mock);
  return mock;
}

const bodyOf = (mock: ReturnType<typeof stub>) => JSON.parse(String((mock.mock.calls[0][1] as RequestInit).body));

beforeAll(async () => {
  await import('@google/genai');
}, 60_000);

beforeEach(() => {
  resetGenAIForTests();
  clearCachedModel();
  cacheModel('model-a', ['model-a']);
  for (const level of ['log', 'debug', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetGenAIForTests();
  clearCachedModel();
});

describe('a first generation from a picture with Forma\'s draft', () => {
  it('sends the rules, the draft and the picture, not the mega-prompt or OCR\'s text, with thinking capped', async () => {
    const mock = stub(CORRECTED);
    await analyzeReportDesign('', [ocrText, picture], config, undefined, undefined, undefined, { draft });
    const body = bodyOf(mock);
    const parts = body.contents[0].parts;
    expect(parts[0].text).toContain("You are correcting Forma's draft");
    expect(parts[0].text).toContain(`FORMA'S DRAFT:\n${draft.text}`);
    expect(parts[0].text).not.toContain('DEVEXPRESS CHEAT SHEET');
    expect(parts.slice(1)).toEqual([picture]);
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(DRAFT_THINKING_BUDGET);
  });

  it('builds the report from the corrected draft, its words and fields, and says so', async () => {
    stub(CORRECTED);
    const result = await analyzeReportDesign('', [picture], config, undefined, undefined, undefined, { draft });
    expect(result.fromDraft).toBe(true);
    expect(result.repxContent).toContain('Text="INVOICE"');
    expect(result.repxContent).toContain('Expression="[Amount]"');
    expect(result.layout.title).toBe('INVOICE');
    expect(result.layout.sections.map((s) => s.name)).toEqual(['Report header', 'Page header', 'Detail, once per record']);
  });

  it('keeps a budget the user set', async () => {
    const mock = stub(CORRECTED);
    await analyzeReportDesign('', [picture], { ...config, thinkingBudget: 512 }, undefined, undefined, undefined, { draft });
    expect(bodyOf(mock).generationConfig.thinkingConfig.thinkingBudget).toBe(512);
  });

  it('says so when the answer is not a draft, rather than building an empty report', async () => {
    stub('I could not read the picture.');
    await expect(analyzeReportDesign('', [picture], config, undefined, undefined, undefined, { draft })).rejects.toThrow(/correction of Forma's draft could not be read/);
  });
});

describe('when the draft is not used', () => {
  it('designs as before for a refinement, or for a report in another unit than the builder writes', async () => {
    const cases: Array<[ReportConfig, Parameters<typeof analyzeReportDesign>[3]]> = [
      [config, { repxContent: REPX }],
      [{ ...config, unit: 'TenthsOfAMillimeter' }, undefined],
    ];
    for (const [c, previous] of cases) {
      const mock = stub(REPX);
      const result = await analyzeReportDesign('', [picture], c, previous, undefined, undefined, { draft });
      expect(bodyOf(mock).contents[0].parts[0].text).toContain('DEVEXPRESS CHEAT SHEET');
      expect(result.fromDraft).toBeUndefined();
      vi.unstubAllGlobals();
    }
  });
});

/*
 * The output checked against what Forma read (2026-11-10, the AI accuracy
 * programme, batch AD; lib/readCoverage.ts): a report that left out enough of
 * the draft's captions is asked for once more, naming them, and the better of
 * the two is kept.
 */
describe('a report that left out what Forma read', () => {
  const READ: DraftRequest = {
    ...draft,
    text: [
      'page Letter portrait 850 1100 75 75 75 75',
      'band ReportHeader 60 0',
      'label title 0 0 300 30 Arial:18b l 0 7 "INVOICE"',
      'band PageHeader 20 0',
      'table caption 0 0 700 20 Arial:9b l 4 0',
      'row caption 2 Arial:9b l 11 "Description" | caption 1 Arial:9b r 3 "Qty" | caption 1 Arial:9b r 10 "Unit Price" | caption 1 Arial:9b r 6 "Amount"',
      'band Detail 20 0',
      'table value 0 0 700 20 Arial:9 l 0 0',
      'row value 2 Arial:9 l 0 [Description] | value 1 Arial:9 r 0 [Qty] | value 1 Arial:9 r 0 [UnitPrice] | value 1 Arial:9 r 0 [Amount]',
    ].join('\n'),
  };
  const SHORT = [
    'page Letter portrait 850 1100 75 75 75 75',
    'band ReportHeader 60 0',
    'label title 0 0 300 30 Arial:18b l 0 7 "INVOICE"',
    'band PageHeader 20 0',
    'table caption 0 0 700 20 Arial:9b l 4 0',
    'row caption 3 Arial:9b l 11 "Description" | caption 1 Arial:9b r 6 "Total"',
    'band Detail 20 0',
    'table value 0 0 700 20 Arial:9 l 0 0',
    'row value 3 Arial:9 l 0 [Description] | value 1 Arial:9 r 0 [Amount]',
  ].join('\n');
  const WHOLE = READ.text;

  function stubInTurn(...answers: string[]) {
    let call = 0;
    const mock = vi.fn(async (_url: unknown, _init?: unknown) => streamOf(answers[Math.min(call++, answers.length - 1)]));
    vi.stubGlobal('fetch', mock);
    return mock;
  }
  const textOf = (mock: ReturnType<typeof stubInTurn>, n: number) => JSON.parse(String((mock.mock.calls[n][1] as RequestInit).body)).contents[0].parts[0].text as string;

  it('asks once more, naming what was missing, and keeps the answer that kept more', async () => {
    const mock = stubInTurn(SHORT, WHOLE);
    const result = await analyzeReportDesign('', [picture], config, undefined, undefined, undefined, { draft: READ });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(textOf(mock, 0)).not.toContain('A FIRST ANSWER LEFT OUT');
    expect(textOf(mock, 1)).toContain('A FIRST ANSWER LEFT OUT TEXT THE PAGE SHOWS');
    expect(textOf(mock, 1)).toContain('"Qty", "Unit Price", "Amount"');
    expect(result.coverage).toMatchObject({ captions: 5, kept: 5, missing: [] });
    expect(result.repxContent).toContain('Text="Unit Price"');
  });

  it('keeps the first answer when the second kept no more, and never asks a third time', async () => {
    const mock = stubInTurn(SHORT, SHORT, WHOLE);
    const result = await analyzeReportDesign('', [picture], config, undefined, undefined, undefined, { draft: READ });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(result.coverage).toMatchObject({ kept: 2 });
  });

  it('asks once only when it is worth it', async () => {
    const mock = stubInTurn(WHOLE);
    const result = await analyzeReportDesign('', [picture], config, undefined, undefined, undefined, { draft: READ });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(result.coverage).toMatchObject({ captions: 5, kept: 5 });
  });
});