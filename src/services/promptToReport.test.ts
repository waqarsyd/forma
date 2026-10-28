/**
 * Prompt-to-Report through the real service against a stubbed network.
 *
 * Three things the pure tests cannot prove: that a description run sends no
 * image and opens its prompt with the description instead of "analyze the
 * provided image(s)"; that overlapping controls come back resolved in that
 * mode and untouched otherwise; and that the clarification call turns the
 * model's answer into questions, and a failure into "ready".
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { analyzeReportDesign, clarifyReportRequest, type ReportConfig } from './geminiService';
import { resetGenAIForTests } from '../lib/genai';
import { cacheModel, clearCachedModel } from '../lib/modelCache';
import { findOverlaps } from '../lib/repxOverlaps';

const KEY = 'test-key-not-a-real-credential';
const config: ReportConfig = { customApiKey: KEY, version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'Letter' };
const image = [{ inlineData: { data: 'AAAA', mimeType: 'image/png' } }];

/** Two labels sharing area in the Detail band, otherwise sound. */
const OVERLAPPING_REPX = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" ReportUnit="HundredthsOfAnInch" Margins="0, 0, 0, 0" PageWidth="850" PageHeight="1100" Version="20.1">
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="0" />
    <Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="100">
      <Controls>
        <Item1 Ref="3" ControlType="XRLabel" Name="label1" Text="One" LocationFloat="0,0" SizeF="200,30" Font="Arial, 12pt" />
        <Item2 Ref="4" ControlType="XRLabel" Name="label2" Text="Two" LocationFloat="50,20" SizeF="200,30" Font="Arial, 12pt" />
      </Controls>
    </Item2>
    <Item3 Ref="5" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="0" />
  </Bands>
</XtraReportsLayoutSerializer>`;

const GOOD = JSON.stringify({
  markdown: '# Designed',
  layout: { title: 'Designed', pageWidth: 850, sections: [{ id: 'detail', name: 'Detail', type: 'detail', height: 100, elements: [] }] },
  repxContent: OVERLAPPING_REPX,
});

const sse = (text: string, finishReason?: string) =>
  `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }], role: 'model' }, ...(finishReason ? { finishReason } : {}) }] })}\r\n\r\n`;

const streamOf = (...events: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const e of events) controller.enqueue(new TextEncoder().encode(e));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

/** A non-streaming generateContent reply, as clarifyReportRequest reads it. */
const jsonReply = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: 'STOP' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const mock = vi.fn(async (url: unknown, init?: unknown) => handler(String(url), init as RequestInit));
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** The prompt text of the last request the stub saw. */
const promptOf = (mock: ReturnType<typeof stubFetch>, call = 0) => {
  const init = mock.mock.calls[call][1] as RequestInit | undefined;
  const body = JSON.parse(String(init?.body ?? '{}'));
  const parts = body.contents?.[0]?.parts ?? [];
  return { text: parts.filter((p: any) => p.text).map((p: any) => p.text).join('\n'), inline: parts.filter((p: any) => p.inlineData).length };
};

beforeAll(async () => {
  await import('@google/genai');
}, 60_000);

beforeEach(() => {
  resetGenAIForTests();
  clearCachedModel();
  cacheModel('model-a', ['model-a']);
  for (const m of ['log', 'debug', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetGenAIForTests();
  clearCachedModel();
});

describe('a generation from a description', () => {
  it('sends no image, opens with the description, and lists the data source fields', async () => {
    const mock = stubFetch(() => streamOf(sse(GOOD, 'STOP')));
    await analyzeReportDesign('', [], config, undefined, undefined, undefined, {
      description: { description: 'A customer list with balances, sorted by Customer ID', dataSchema: 'CustomerId, Company, Balance' },
    });
    const { text, inline } = promptOf(mock);
    expect(inline).toBe(0);
    expect(text).toContain('A COMPLETE, WELL-LAID-OUT REPORT FROM A WRITTEN DESCRIPTION');
    expect(text).toContain('THE REPORT TO DESIGN');
    expect(text).toContain('DESCRIPTION: "A customer list with balances, sorted by Customer ID"');
    expect(text).toContain('- Balance (string)');
    expect(text).not.toContain('EXACT PIXEL-PERFECT UI MATCH');
    expect(text).toContain('the description under THE REPORT TO DESIGN is the whole specification');
  });

  it('resolves overlapping controls in description mode and leaves them in image mode', async () => {
    stubFetch(() => streamOf(sse(GOOD, 'STOP')));
    const designed = await analyzeReportDesign('', [], config, undefined, undefined, undefined, { description: { description: 'Two labels' } });
    expect(findOverlaps(designed.repxContent)).toEqual([]);

    stubFetch(() => streamOf(sse(GOOD, 'STOP')));
    const copied = await analyzeReportDesign('', image, config);
    expect(findOverlaps(copied.repxContent)).toHaveLength(1);
  });

  it('keeps the image framing when there is no description', async () => {
    const mock = stubFetch(() => streamOf(sse(GOOD, 'STOP')));
    await analyzeReportDesign('', image, config);
    expect(promptOf(mock).text).toContain('EXACT PIXEL-PERFECT UI MATCH');
    expect(promptOf(mock).text).not.toContain('THE REPORT TO DESIGN');
  });
});

describe('clarifyReportRequest', () => {
  it('returns the questions the model asked, capped at three, with suggestions', async () => {
    stubFetch(() =>
      jsonReply(JSON.stringify({
        ready: false,
        questions: [
          { id: 'cols', question: 'Which columns?', suggestion: 'Name, Qty, Price' },
          { id: 'grp', question: 'Group by?' },
          { id: 'x', question: 'Third?' },
          { id: 'y', question: 'Fourth?' },
          { id: 'blank', question: '   ' },
        ],
      })),
    );
    const outcome = await clarifyReportRequest({ description: 'A sales report' }, config);
    expect(outcome.ready).toBe(false);
    expect(outcome.questions).toHaveLength(3);
    expect(outcome.questions[0]).toEqual({ id: 'cols', question: 'Which columns?', suggestion: 'Name, Qty, Price' });
    expect(outcome.questions[1].suggestion).toBeUndefined();
  });

  it('is ready when the model says so or asks nothing', async () => {
    stubFetch(() => jsonReply(JSON.stringify({ ready: true, questions: [] })));
    expect(await clarifyReportRequest({ description: 'A detailed invoice with everything stated' }, config)).toEqual({ ready: true, questions: [] });
  });

  it('is ready, not failed, when the call breaks', async () => {
    stubFetch(() => new Response('nope', { status: 503 }));
    const outcome = await clarifyReportRequest({ description: 'A sales report' }, config);
    expect(outcome.ready).toBe(true);
    expect(outcome.questions).toEqual([]);
  });

  it('refuses without a key, like every other call', async () => {
    stubFetch(() => jsonReply('{}'));
    await expect(clarifyReportRequest({ description: 'A sales report' }, { ...config, customApiKey: '' })).rejects.toThrow(/API key/i);
  });
});
