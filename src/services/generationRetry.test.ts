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
import { analyzeReportDesign, type ReportConfig } from './geminiService';
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
