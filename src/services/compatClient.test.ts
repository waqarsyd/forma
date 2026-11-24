/**
 * Local AI and OpenRouter in the shape of Gemini's SDK (milestone 3 of
 * docs/proposals/own-model.md), against a fake OpenAI-compatible server: the
 * request it is sent, the answer read back in Gemini's words, the schema
 * falling back for a server that refuses it, a streamed answer, and an HTTP
 * error keeping the status the quota and overload checks read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyLimit, compatClient, contextTooSmall, listModels, LOCAL_FIRST_BYTES_MS, MIN_COMPAT_OUTPUT_TOKENS, rateLimitHeaders, refusesFormat, STREAM_BETWEEN_PIECES_MS, STREAM_FIRST_BYTES_MS, toJsonSchema, toMessages, type CompatEndpoint } from './compatClient';
import { compatEndpoint, isTruncatedStream } from './geminiService';
import { limitOf } from '../lib/aiLimit';
import { classifyGeminiError } from '../lib/geminiErrors';

const LOCAL: CompatEndpoint = { kind: 'local', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5vl:7b' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sse = (lines: string[]) =>
  new Response(new ReadableStream({ start(c) { for (const l of lines) c.enqueue(new TextEncoder().encode(`${l}\n\n`)); c.close(); } }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe('the request', () => {
  it('turns text and inline images into chat messages, with the system text first', () => {
    const messages = toMessages([{ parts: [{ text: 'Read this' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] }], 'Be exact.');
    expect(messages).toEqual([
      { role: 'system', content: 'Be exact.' },
      { role: 'user', content: [{ type: 'text', text: 'Read this' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
    ]);
    expect(toMessages('just words')).toEqual([{ role: 'user', content: 'just words' }]);
  });

  it("writes Gemini's response schema as a JSON Schema", () => {
    const schema = { type: 'OBJECT', properties: { reply: { type: 'STRING' }, rows: { type: 'ARRAY', items: { type: 'NUMBER' } }, note: { type: 'STRING', nullable: true } }, required: ['reply'] };
    expect(toJsonSchema(schema)).toEqual({
      type: 'object',
      properties: { reply: { type: 'string' }, rows: { type: 'array', items: { type: 'number' } }, note: { type: ['string', 'null'] } },
      required: ['reply'],
    });
  });
});

describe('compatClient', () => {
  it('asks for the schema, and reads the answer back in Gemini’s words', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ choices: [{ message: { content: '{"reply":"hi"}' }, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    vi.stubGlobal('fetch', fetch);
    const out = await compatClient({ ...LOCAL, kind: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-test' }).models.generateContent({
      model: 'ignored',
      contents: [{ parts: [{ text: 'q' }] }],
      config: { maxOutputTokens: 512, temperature: 0, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { reply: { type: 'STRING' } } }, thinkingConfig: { thinkingBudget: 0 } },
    });
    expect(out).toEqual({ text: '{"reply":"hi"}', candidates: [{ finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 0, totalTokenCount: 15 } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-or-test');
    const body = JSON.parse(init.body);
    // At least MIN_COMPAT_OUTPUT_TOKENS since 2026-11-07: a reasoning model thinks inside the cap.
    expect(body).toMatchObject({ model: 'qwen2.5vl:7b', max_tokens: MIN_COMPAT_OUTPUT_TOKENS, temperature: 0, response_format: { type: 'json_schema' } });
    expect(body.thinkingConfig).toBeUndefined();
  });

  it('asks a server that refuses the schema for a JSON object, then for plain text', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ error: { message: 'json_schema not supported' } }, 400))
      .mockResolvedValueOnce(json({ error: { message: 'response_format not supported' } }, 400))
      .mockResolvedValueOnce(json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }));
    vi.stubGlobal('fetch', fetch);
    const out = await compatClient(LOCAL).models.generateContent({ model: 'm', contents: 'q', config: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' } } });
    expect(out.candidates).toEqual([{ finishReason: 'STOP' }]);
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body).response_format?.type ?? 'none')).toEqual(['json_schema', 'json_object', 'none']);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('streams the answer in pieces, then its finish and usage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([
      'data: {"choices":[{"delta":{"content":"{\\"re"}}]}',
      'data: {"choices":[{"delta":{"content":"ply\\":1}"},"finish_reason":"stop"}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}',
      'data: [DONE]',
    ])));
    const stream = await compatClient(LOCAL).models.generateContentStream({ model: 'm', contents: 'q' });
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    expect(chunks.map((c) => c.text).join('')).toBe('{"reply":1}');
    expect(chunks[1].candidates).toEqual([{ finishReason: 'STOP' }]);
    expect(chunks[2].usageMetadata).toMatchObject({ promptTokenCount: 3, totalTokenCount: 7 });
  });

  it('keeps an error’s status, so a 429 is still a quota and a 503 an overload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { message: 'Rate limit exceeded: free-models-per-day' } }, 429)));
    await expect(compatClient(LOCAL).models.generateContent({ model: 'm', contents: 'q' })).rejects.toMatchObject({ status: 429, message: expect.stringContaining('free-models-per-day') });
  });

  /*
   * 2026-11-24, the CLI and Forma Designer work's wave 3 (GAP3-5): OpenRouter
   * opens its words with "Rate limit exceeded" for its minute's limit and its
   * day's alike, and says which it is, and when it lifts, in its headers, and
   * since the wave's review (W3R-2) in its body too, which a browser can
   * always read. A stubbed Response carries them; no request leaves the
   * process.
   */
  describe('what a 429 says of its limit', () => {
    const ROUTER: CompatEndpoint = { kind: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-test', model: 'x:free' };
    const limited = (headers: Record<string, string>, status = 429) =>
      new Response(JSON.stringify({ error: { message: 'Rate limit exceeded', metadata: { error_type: 'rate_limit_exceeded' } } }), { status, headers: { 'Content-Type': 'application/json', ...headers } });
    const failed = async (response: Response, endpoint: CompatEndpoint = ROUTER) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
      return compatClient(endpoint)
        .models.generateContent({ model: 'm', contents: 'q' })
        .then(
          () => {
            throw new Error('the 429 was answered');
          },
          (e: unknown) => e as Error & Record<string, unknown>,
        );
    };

    it("keeps Retry-After and the window's requests left and reset on the error, with the provider, and limitOf tells the day's from the minute's", async () => {
      const resetAt = Date.now() + 6 * 3600_000;
      const day = await failed(limited({ 'X-RateLimit-Limit': '50', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(resetAt) }));
      expect(day).toMatchObject({ status: 429, provider: 'openrouter', rateLimit: { remaining: 0, resetAt } });
      expect(limitOf(classifyGeminiError(day, { provider: 'openrouter', model: 'x:free' }))).toMatchObject({ kind: 'daily', provider: 'openrouter' });

      const minute = await failed(limited({ 'Retry-After': '20', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(Date.now() + 20_000) }));
      expect(minute).toMatchObject({ retryAfterMs: 20_000, rateLimit: { remaining: 0 } });
      expect(limitOf(classifyGeminiError(minute, { provider: 'openrouter', model: 'x:free' }))).toMatchObject({ kind: 'per-minute', waitMs: 20_000, provider: 'openrouter' });
    });

    it('keeps nothing when the 429 has no such header, and the limit is of no known kind, as before', async () => {
      const bare = await failed(limited({}));
      expect(bare).toMatchObject({ status: 429, provider: 'openrouter' });
      expect(bare.retryAfterMs).toBeUndefined();
      expect(bare.rateLimit).toBeUndefined();
      expect(limitOf(classifyGeminiError(bare, { provider: 'openrouter', model: 'x:free' }))).toEqual({ kind: 'unknown', waitMs: null, provider: 'openrouter' });
    });

    /*
     * The wave-3 review (W3R-2): OpenRouter's own 429, as its rate-limit
     * tutorial shows it, carries the headers and the limit's source in its
     * body; with no HTTP header at all, the body alone tells the minute's
     * limit from the day's.
     */
    const documented = (message: string, limitSource: string, reset: number) =>
      new Response(
        JSON.stringify({
          error: {
            message,
            code: 429,
            metadata: { headers: { 'X-RateLimit-Limit': '20', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(reset) }, limit_source: limitSource, provider_name: null },
          },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      );

    it("reads the limit and its reset off the body when the response's headers say nothing, as OpenRouter documents it", async () => {
      const inAMinute = Date.now() + 40_000;
      const minute = await failed(documented('Rate limit exceeded: free-models-per-min. ', 'openrouter_free_tier_per_minute', inAMinute));
      expect(minute).toMatchObject({ status: 429, provider: 'openrouter', limitKind: 'per-minute', rateLimit: { remaining: 0, resetAt: inAMinute } });
      expect(limitOf(classifyGeminiError(minute, { provider: 'openrouter', model: 'x:free' }))).toMatchObject({ kind: 'per-minute', provider: 'openrouter' });
      expect(limitOf(classifyGeminiError(minute, { provider: 'openrouter', model: 'x:free' }))!.waitMs).toBeGreaterThan(30_000);

      const tonight = Date.now() + 5 * 3600_000;
      const day = await failed(documented('Rate limit exceeded: free-models-per-day. ', 'openrouter_free_tier_daily', tonight));
      expect(day).toMatchObject({ limitKind: 'daily', rateLimit: { remaining: 0, resetAt: tonight } });
      expect(limitOf(classifyGeminiError(day, { provider: 'openrouter', model: 'x:free' }))).toMatchObject({ kind: 'daily', provider: 'openrouter' });
      // The words alone name it too, with no wait known.
      const words = await failed(new Response(JSON.stringify({ error: { message: 'Rate limit exceeded: free-models-per-day. ', code: 429 } }), { status: 429 }));
      expect(limitOf(classifyGeminiError(words, { provider: 'openrouter', model: 'x:free' }))).toEqual({ kind: 'daily', waitMs: null, provider: 'openrouter' });
      // The sentence a person reads is the one it always was.
      expect(classifyGeminiError(day, { provider: 'openrouter', model: 'x:free' }).message).toBe(
        "OpenRouter refused the request for its rate limit. OpenRouter's free models allow a few requests a minute and a number a day; another free model has a limit of its own.",
      );
    });

    it("takes the response's own headers before the body's, and the limit the body names before the headers' arithmetic", async () => {
      const resetAt = Date.now() + 30_000;
      const both = new Response(
        JSON.stringify({ error: { message: 'Rate limit exceeded: free-models-per-day. ', metadata: { headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(Date.now() + 9 * 3600_000) }, limit_source: 'openrouter_free_tier_daily' } } }),
        { status: 429, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(resetAt) } },
      );
      const e = await failed(both);
      expect(e).toMatchObject({ limitKind: 'daily', rateLimit: { remaining: 0, resetAt } });
      // Thirty seconds by the headers, which alone would make it the minute's; the body says the day's.
      expect(limitOf(e)).toMatchObject({ kind: 'daily', provider: 'openrouter' });
    });

    it("reads the same off a stream's error event, and nothing off a body that names no limit", async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([`data: ${JSON.stringify({ error: { code: 429, message: 'Rate limit exceeded: free-models-per-min. ', metadata: { limit_source: 'openrouter_free_tier_per_minute' } } })}`])));
      const thrown = await (async () => {
        for await (const chunk of await compatClient(ROUTER).models.generateContentStream({ model: 'm', contents: 'q' })) void chunk;
      })().catch((err: unknown) => err as Record<string, unknown>);
      expect(thrown).toMatchObject({ status: 429, provider: 'openrouter', limitKind: 'per-minute' });
      expect(bodyLimit({ message: 'Rate limit exceeded', metadata: { error_type: 'rate_limit_exceeded' } })).toEqual({});
      expect(bodyLimit(null)).toEqual({});
      expect(bodyLimit({ metadata: { headers: { 'x-ratelimit-remaining': 'none' }, limit_source: 'upstream_provider_shared_pool' } })).toEqual({});
    });

    it('reads only a 429, and the words a failure is said in are as they were', async () => {
      const busy = await failed(limited({ 'Retry-After': '20' }, 503));
      expect(busy.retryAfterMs).toBeUndefined();
      expect(busy).toMatchObject({ status: 503, provider: 'openrouter' });
      const said = classifyGeminiError(await failed(limited({ 'Retry-After': '20' })), { provider: 'openrouter', model: 'x:free' }).message;
      expect(said).toBe("OpenRouter refused the request for its rate limit. OpenRouter's free models allow a few requests a minute and a number a day; another free model has a limit of its own.");
      expect(await failed(limited({}), LOCAL)).toMatchObject({ status: 429, provider: 'local' });
    });

    it('reads Retry-After as seconds or a date, the reset as milliseconds or seconds since the epoch, and refuses the rest', () => {
      const now = Date.parse('2026-11-24T20:00:00Z');
      const h = (entries: Record<string, string>) => new Headers(entries);
      expect(rateLimitHeaders(h({ 'retry-after': '1.5' }), now)).toEqual({ retryAfterMs: 1500 });
      expect(rateLimitHeaders(h({ 'retry-after': new Date(now + 60_000).toUTCString() }), now)).toEqual({ retryAfterMs: 60_000 });
      expect(rateLimitHeaders(h({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((now + 60_000) / 1000) }), now)).toEqual({ rateLimit: { remaining: 0, resetAt: now + 60_000 } });
      // A reset in the past, nonsense, or days off is not kept; nor is a wait of none.
      expect(rateLimitHeaders(h({ 'retry-after': '0', 'x-ratelimit-reset': String(now - 1000) }), now)).toEqual({});
      expect(rateLimitHeaders(h({ 'retry-after': 'soon', 'x-ratelimit-reset': 'tomorrow', 'x-ratelimit-remaining': 'none' }), now)).toEqual({});
      expect(rateLimitHeaders(h({ 'retry-after': String(3 * 24 * 3600) }), now)).toEqual({});
      expect(rateLimitHeaders(h({}), now)).toEqual({});
    });
  });

  it('names the model the server says answered, as Gemini names its own, and nothing when it names none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ model: 'google/gemma-4-31b-it:free', choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] })));
    expect(await compatClient(LOCAL).models.generateContent({ model: 'm', contents: 'q' })).toMatchObject({ text: 'hi', modelVersion: 'google/gemma-4-31b-it:free' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([
      'data: {"model":"qwen3.5:9b","choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}',
      'data: [DONE]',
    ])));
    const chunks = [];
    for await (const c of await compatClient(LOCAL).models.generateContentStream({ model: 'm', contents: 'q' })) chunks.push(c);
    expect(chunks.map((c) => c.modelVersion)).toEqual(['qwen3.5:9b', undefined]);
    expect('modelVersion' in chunks[1]).toBe(false);
  });

  // Agent audit item 94: a 400 for a model the server does not have is not a schema it refuses.
  it('asks again in the next format only when the 400 is about the format', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ error: { message: 'model "qwen9:1b" not found, try pulling it first' } }, 400));
    vi.stubGlobal('fetch', fetch);
    await expect(compatClient(LOCAL).models.generateContent({ model: 'm', contents: 'q', config: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' } } })).rejects.toMatchObject({ status: 400 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(refusesFormat('response_format is not supported')).toBe(true);
    expect(refusesFormat('model not found')).toBe(false);
  });

  // Agent audit item 17: a reasoning model that thought its answer away is named, not an empty reply.
  it('says when a reasoning model spent its whole answer thinking', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([
      'data: {"choices":[{"delta":{"reasoning_content":"Let me think about the layout..."}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
      'data: [DONE]',
    ])));
    const stream = await compatClient(LOCAL).models.generateContentStream({ model: 'm', contents: 'q' });
    await expect((async () => { for await (const c of stream) void c; })()).rejects.toThrow(/spent its whole answer reasoning/);
  });

  // The full audit (2026-11-11, PL-16): a stream that stops arriving ends, as a stream that ended early.
  it('ends a stream that says nothing for two minutes (ten for a local server), or for a minute between pieces', async () => {
    vi.useFakeTimers();
    try {
      let cancelled = 0;
      const silent = (first?: string) =>
        new Response(new ReadableStream({
          start(c) { if (first) c.enqueue(new TextEncoder().encode(`${first}\n\n`)); },
          cancel() { cancelled++; },
        }), { status: 200 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(silent()).mockResolvedValueOnce(silent()).mockResolvedValueOnce(silent('data: {"choices":[{"delta":{"content":"<?xml"}}]}')));
      const OPENROUTER: CompatEndpoint = { kind: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'x:free' };

      const never = await compatClient(OPENROUTER).models.generateContentStream({ model: 'm', contents: 'q' });
      const first = (async () => { for await (const c of never) void c; })();
      const firstFails = expect(first).rejects.toThrow(/network error: the answer stopped arriving for 120 seconds/);
      await vi.advanceTimersByTimeAsync(STREAM_FIRST_BYTES_MS - 1);
      await vi.advanceTimersByTimeAsync(1);
      await firstFails;

      // A local server loading a model and reading a long prompt has ten minutes.
      let localDone = false;
      const local = await compatClient(LOCAL).models.generateContentStream({ model: 'm', contents: 'q' });
      const localRead = (async () => { for await (const c of local) void c; })().catch((e: Error) => { localDone = true; return e; });
      await vi.advanceTimersByTimeAsync(STREAM_FIRST_BYTES_MS);
      expect(localDone).toBe(false);
      await vi.advanceTimersByTimeAsync(LOCAL_FIRST_BYTES_MS - STREAM_FIRST_BYTES_MS);
      expect(((await localRead) as Error).message).toMatch(/stopped arriving for 600 seconds/);

      const stalls = await compatClient(OPENROUTER).models.generateContentStream({ model: 'm', contents: 'q' });
      const pieces: string[] = [];
      const second = (async () => { for await (const c of stalls) pieces.push(c.text); })();
      const secondFails = expect(second).rejects.toThrow(/stopped arriving for 60 seconds/);
      await vi.advanceTimersByTimeAsync(STREAM_BETWEEN_PIECES_MS);
      await secondFails;
      expect(pieces).toEqual(['<?xml']);
      expect(cancelled).toBe(3);
      expect(isTruncatedStream(new Error('network error: the answer stopped arriving for 60 seconds'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // Agent audit item 18: Ollama's small default context drops the head of the request.
  it("says when a local server read far less of the request than was sent, and only then", () => {
    const small = contextTooSmall(LOCAL, 40_000, 2048);
    expect(small?.message).toMatch(/read only 2,048 of about 10,000 tokens/);
    expect(small?.message).toContain('OLLAMA_CONTEXT_LENGTH=32768');
    expect(contextTooSmall(LOCAL, 40_000, 9_000)).toBeNull();
    expect(contextTooSmall(LOCAL, 8_000, 500)).toBeNull();
    expect(contextTooSmall({ ...LOCAL, kind: 'openrouter' }, 40_000, 2048)).toBeNull();
  });
});

describe('listModels', () => {
  it("offers OpenRouter's free models, those that read images first", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: [
      { id: 'paid/model', architecture: { input_modalities: ['text', 'image'] } },
      { id: 'b/text:free', architecture: { input_modalities: ['text'] } },
      { id: 'a/vision:free', architecture: { input_modalities: ['text', 'image'] } },
    ] })));
    expect(await listModels({ kind: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' })).toEqual([
      { id: 'a/vision:free', vision: true },
      { id: 'b/text:free', vision: false },
    ]);
  });

  it("offers every model a local server has, guessing which read images by name", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: [{ id: 'llama3.1:8b' }, { id: 'qwen2.5vl:7b' }] })));
    expect(await listModels({ kind: 'local', baseUrl: 'http://localhost:11434/v1' })).toEqual([
      { id: 'qwen2.5vl:7b', vision: true },
      { id: 'llama3.1:8b', vision: false },
    ]);
  });
});

describe('compatEndpoint', () => {
  it('names the endpoint of a chosen provider with a model, and nothing for Gemini', () => {
    expect(compatEndpoint({ version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'A4', provider: 'local', localUrl: 'http://127.0.0.1:1234/v1/', localModel: 'gemma3' })).toEqual({ kind: 'local', baseUrl: 'http://127.0.0.1:1234/v1', model: 'gemma3' });
    expect(compatEndpoint({ version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'A4', provider: 'openrouter', openRouterKey: ' k ', openRouterModel: 'x:free' })).toEqual({ kind: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'x:free' });
    expect(compatEndpoint({ version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'A4', provider: 'local' })).toBeNull();
    expect(compatEndpoint({ version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'A4', customApiKey: 'AIza' })).toBeNull();
  });
});
