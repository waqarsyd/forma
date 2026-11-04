/**
 * Does a generation survive the two output failures the benchmark found?
 *
 * `chatRetry.test.ts` proves the chat path retries a stream that ends early.
 * This drives the real `analyzeReportDesign` against a stubbed network and
 * asks the same of the generation path, plus the one only generation hits: a
 * model that begins repeating itself part-way through the report
 * (lib/runawayOutput.ts). Found on 2026-10-28 by the fidelity benchmark, where
 * a twenty-row list looped on a number in three runs out of five, each running
 * four minutes to the output ceiling before anything noticed.
 *
 * No fake timers: neither path backs off, because the server was not busy.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { analyzeReportDesign, CAPPED_THINKING_BUDGET, type ReportConfig } from './geminiService';
import { resetGenAIForTests } from '../lib/genai';
import { cacheModel, clearCachedModel } from '../lib/modelCache';
import { RUNAWAY_WINDOW } from '../lib/runawayOutput';

const KEY = 'test-key-not-a-real-credential';
const config: ReportConfig = { customApiKey: KEY, version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'Letter' };
const parts = [{ inlineData: { data: 'AAAA', mimeType: 'image/png' } }];

/** A complete, valid response: the REPX is finished, so no rewrite request follows. */
const REPX = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" ReportUnit="HundredthsOfAnInch" Margins="0, 0, 0, 0" PageWidth="850" PageHeight="1100" Version="20.1">
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="0" />
    <Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="40">
      <Controls>
        <Item1 Ref="3" ControlType="XRLabel" Name="label1" Text="Recovered" LocationFloat="0,0" SizeF="200,20" Font="Arial, 9pt" />
      </Controls>
    </Item2>
    <Item3 Ref="4" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="0" />
  </Bands>
</XtraReportsLayoutSerializer>`;

const GOOD = JSON.stringify({
  markdown: '# Recovered',
  layout: {
    title: 'Recovered',
    pageWidth: 850,
    sections: [{ id: 'detail', name: 'Detail', type: 'detail', height: 40, elements: [] }],
  },
  repxContent: REPX,
});

/** One server-sent event carrying a model chunk, as the SDK reads them. */
const sse = (text: string, finishReason?: string) =>
  `data: ${JSON.stringify({
    candidates: [{ content: { parts: [{ text }], role: 'model' }, ...(finishReason ? { finishReason } : {}) }],
  })}\r\n\r\n`;

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

const good = () => streamOf(sse(GOOD, 'STOP'));

/** The loop the benchmark found: a response that starts well and then emits zeros until the ceiling. */
const runaway = () =>
  streamOf(
    sse('{"markdown":"# Customer List","layout":{"title":"Customer List","pageWidth":850,"sections":[]},"repxContent":"<Item1 Text=\\"Balance\\" Value=\\"1,240.5'),
    ...Array.from({ length: 12 }, () => sse('0'.repeat(Math.ceil(RUNAWAY_WINDOW / 4)))),
    sse('0'.repeat(Math.ceil(RUNAWAY_WINDOW / 4)), 'MAX_TOKENS'),
  );

/** A chunk that stops inside the JSON: the SDK's reader raises "Incomplete JSON segment at the end". */
const truncated = () => streamOf('data: {"candidates":[{"content":{"parts":[{"text":"{\\"markdown\\":\\"par');

const failure = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { code: status, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function stubSequence(...responses: Array<() => Response>) {
  let call = 0;
  const mock = vi.fn(async (_url: unknown, _init?: unknown) => {
    const next = responses[Math.min(call, responses.length - 1)];
    call++;
    return next();
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const urlsOf = (mock: ReturnType<typeof stubSequence>) => mock.mock.calls.map((c) => String(c[0]));

// Pay for the SDK import outside any test's budget; see chatRetry.test.ts.
beforeAll(async () => {
  await import('@google/genai');
}, 60_000);

beforeEach(() => {
  resetGenAIForTests();
  clearCachedModel();
  cacheModel('model-a', ['model-a']);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetGenAIForTests();
  clearCachedModel();
});

describe('a generation whose model begins repeating itself', () => {
  it('cuts the stream off and succeeds on the retry', async () => {
    const fetchMock = stubSequence(runaway, good);
    const result = await analyzeReportDesign('', parts, config);
    expect(result.layout.title).toBe('Recovered');
    expect(result.repxContent).toContain('Text="Recovered"');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up readably once the retries are spent and no other model remains', async () => {
    const fetchMock = stubSequence(runaway);
    await expect(analyzeReportDesign('', parts, config)).rejects.toThrow(/repeating itself/i);
    // The first attempt and two retries, no more: every further request would loop the same way.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('moves to the next model the key can call, as it does for an overload', async () => {
    cacheModel('model-a', ['model-a', 'model-b']);
    const fetchMock = stubSequence(runaway, runaway, runaway, good);
    const result = await analyzeReportDesign('', parts, config);
    expect(result.layout.title).toBe('Recovered');
    const urls = urlsOf(fetchMock);
    expect(urls.slice(0, 3).every((u) => u.includes('model-a'))).toBe(true);
    expect(urls[3]).toContain('model-b');
  });

  it('asks the retry with a little sampling, since at temperature 0 the same request loops the same way (2026-11-04)', async () => {
    cacheModel('model-a', ['model-a', 'model-b']);
    const fetchMock = stubSequence(runaway, runaway, runaway, good);
    await analyzeReportDesign('', parts, config);
    const temperatures = fetchMock.mock.calls.map((c) => /"temperature":([\d.]+)/.exec(String((c[1] as RequestInit | undefined)?.body))?.[1]);
    // model-a at 0, then its two retries sampled; model-b starts again at 0.
    expect(temperatures).toEqual(['0', '0.4', '0.4', '0']);
  });

  it('does not sample on the retry of a stream that merely ended early', async () => {
    const fetchMock = stubSequence(truncated, good);
    await analyzeReportDesign('', parts, config);
    const temperatures = fetchMock.mock.calls.map((c) => /"temperature":([\d.]+)/.exec(String((c[1] as RequestInit | undefined)?.body))?.[1]);
    expect(temperatures).toEqual(['0', '0']);
  });

  it('does not wander off a model the user pinned', async () => {
    cacheModel('model-a', ['model-a', 'model-b']);
    const fetchMock = stubSequence(runaway);
    await expect(analyzeReportDesign('', parts, { ...config, modelName: 'model-pinned' })).rejects.toThrow(/repeating itself/i);
    expect(urlsOf(fetchMock).every((u) => u.includes('model-pinned'))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('a generation whose stream ends mid-object', () => {
  it('retries the whole request rather than failing, as the chat path has since 2026-09-05', async () => {
    const fetchMock = stubSequence(truncated, good);
    const result = await analyzeReportDesign('', parts, config);
    expect(result.layout.title).toBe('Recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops after the retries and reports the failure', async () => {
    const fetchMock = stubSequence(truncated);
    await expect(analyzeReportDesign('', parts, config)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('a generation that fails for a reason retrying cannot fix', () => {
  it('does not spend a second request on a bad key', async () => {
    const fetchMock = stubSequence(() => failure(400, 'API key not valid. Please pass a valid API key.'));
    await expect(analyzeReportDesign('', parts, config)).rejects.toThrow(/API key/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('what the generation prompt says about text read by OCR', () => {
  it('calls it measured rather than exact, with its tables as tables and its unsure strings read from the image', async () => {
    const fetchMock = stubSequence(good);
    await analyzeReportDesign('', parts, config);
    const body = String((fetchMock.mock.calls[0][1] as RequestInit | undefined)?.body);
    expect(body).toContain('Text READ BY OCR is a third kind');
    expect(body).toContain('write one XRTable with those columns and rows');
    expect(body).toContain('A string marked LOW CONFIDENCE may be misread');
  });
});

/** Gemini's own 429 for a spent daily allowance, as it names the quota. */
const dailyQuota = (model: string) => () =>
  failure(429, `Quota exceeded for quota metric 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', limit: 20, model: ${model}`);

/** An answer cut off because thinking took the output limit: the owner's certificate, 2026-11-02. */
const thoughtOut = () =>
  streamOf(
    `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"markdown":"# Cert' }], role: 'model' }, finishReason: 'MAX_TOKENS' }],
      usageMetadata: { promptTokenCount: 16341, candidatesTokenCount: 13490, thoughtsTokenCount: 51930, totalTokenCount: 81761 },
    })}\r\n\r\n`,
  );

describe('a generation whose model is out of its free daily allowance (2026-11-02)', () => {
  it('moves to the next model the key can call, whose allowance is its own', async () => {
    cacheModel('model-a', ['model-a', 'model-b']);
    const fetchMock = stubSequence(dailyQuota('model-a'), good);
    const result = await analyzeReportDesign('', parts, config);
    expect(result.layout.title).toBe('Recovered');
    const urls = urlsOf(fetchMock);
    expect(urls[0]).toContain('model-a');
    expect(urls[1]).toContain('model-b');
  });

  it('says it is the daily allowance, when it resets, and what works meanwhile, once every model is out', async () => {
    cacheModel('model-a', ['model-a', 'model-b']);
    stubSequence(dailyQuota('model-a'), dailyQuota('model-b'));
    await expect(analyzeReportDesign('', parts, config)).rejects.toThrow(/daily allowance.*midnight Pacific.*Forma Offline/s);
  });
});

describe('a generation cut off because thinking took the output limit (2026-11-02)', () => {
  it('is asked once more with thinking capped, and succeeds', async () => {
    const fetchMock = stubSequence(thoughtOut, good);
    const result = await analyzeReportDesign('', parts, config);
    expect(result.layout.title).toBe('Recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = String((fetchMock.mock.calls[1][1] as RequestInit | undefined)?.body ?? '');
    expect(second).toContain(`"thinkingBudget":${CAPPED_THINKING_BUDGET}`);
  });

  it('is not repeated when the user set a thinking budget of their own', async () => {
    const fetchMock = stubSequence(thoughtOut, good);
    await expect(analyzeReportDesign('', parts, { ...config, thinkingBudget: 2048 })).rejects.toThrow(/cut off/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});