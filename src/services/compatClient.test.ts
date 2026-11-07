/**
 * Local AI and OpenRouter in the shape of Gemini's SDK (milestone 3 of
 * docs/proposals/own-model.md), against a fake OpenAI-compatible server: the
 * request it is sent, the answer read back in Gemini's words, the schema
 * falling back for a server that refuses it, a streamed answer, and an HTTP
 * error keeping the status the quota and overload checks read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compatClient, contextTooSmall, listModels, MIN_COMPAT_OUTPUT_TOKENS, refusesFormat, toJsonSchema, toMessages, type CompatEndpoint } from './compatClient';
import { compatEndpoint } from './geminiService';

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
