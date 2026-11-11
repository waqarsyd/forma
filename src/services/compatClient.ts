/**
 * Local AI and OpenRouter, through the OpenAI-compatible chat API, in the
 * shape of Gemini's SDK (2026-11-02, milestone 3 of docs/proposals/own-model.md).
 *
 * Ollama, LM Studio and OpenRouter all speak OpenAI's `/chat/completions`.
 * Rather than a second generation path, which would drift from the first as
 * the chat and generation paths have drifted three times (gemini.md), this
 * adapter answers the two calls geminiService.ts makes, `generateContent`
 * and `generateContentStream`, so every retry, runaway check, repair and
 * audit there runs unchanged for any provider:
 * - **The request:** text parts become text, inline images become data URLs,
 *   and the response schema is sent as a JSON schema. A server that refuses
 *   a schema is asked for a JSON object, then for plain text, since the
 *   prompt describes the shape too.
 * - **The answer:** `.text`, a finish reason in Gemini's words (`length` is
 *   `MAX_TOKENS`, which the truncation checks read) and usage in Gemini's
 *   fields.
 * - **An HTTP error** keeps its `status`, so a 429 is still a quota and a 503
 *   an overload.
 * Gemini-only settings such as `thinkingConfig` are dropped.
 *
 * Loaded only when a provider other than Gemini is chosen.
 */

export interface CompatEndpoint {
  kind: 'local' | 'openrouter';
  /** Up to and including `/v1`, no trailing slash. */
  baseUrl: string;
  apiKey?: string;
  model: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: { data: string; mimeType: string };
}
interface GeminiContent {
  role?: string;
  parts?: GeminiPart[];
}
interface GeminiRequest {
  model: string;
  contents: GeminiContent[] | GeminiContent | string;
  config?: {
    abortSignal?: AbortSignal;
    temperature?: number;
    maxOutputTokens?: number;
    responseMimeType?: string;
    responseSchema?: unknown;
    systemInstruction?: unknown;
    [other: string]: unknown;
  };
}

/** One answer, or one streamed piece of it, in the shape geminiService reads. */
export interface CompatChunk {
  text: string;
  candidates?: { finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
}

type OpenAiContent = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/** Gemini contents as OpenAI chat messages. */
export function toMessages(contents: GeminiRequest['contents'], system?: unknown): { role: string; content: string | OpenAiContent[] }[] {
  const list: GeminiContent[] = typeof contents === 'string' ? [{ parts: [{ text: contents }] }] : Array.isArray(contents) ? contents : [contents];
  const messages: { role: string; content: string | OpenAiContent[] }[] = [];
  const systemText = typeof system === 'string' ? system : ((system as GeminiContent | undefined)?.parts ?? []).map((p) => p.text ?? '').join('\n');
  if (systemText) messages.push({ role: 'system', content: systemText });
  for (const c of list) {
    const content: OpenAiContent[] = (c.parts ?? []).flatMap((p): OpenAiContent[] =>
      p.inlineData ? [{ type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } }] : p.text ? [{ type: 'text', text: p.text }] : [],
    );
    const textOnly = content.every((x) => x.type === 'text');
    messages.push({ role: c.role === 'model' ? 'assistant' : 'user', content: textOnly ? content.map((x) => (x as { text: string }).text).join('\n') : content });
  }
  return messages;
}

/** A Gemini response schema (its `Type` names in capitals) as a JSON Schema. */
export function toJsonSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof s.type === 'string') out.type = s.type.toLowerCase();
  if (s.description) out.description = s.description;
  if (Array.isArray(s.enum)) out.enum = s.enum;
  if (Array.isArray(s.required)) out.required = s.required;
  if (s.items) out.items = toJsonSchema(s.items);
  if (s.properties && typeof s.properties === 'object') {
    out.properties = Object.fromEntries(Object.entries(s.properties as Record<string, unknown>).map(([k, v]) => [k, toJsonSchema(v)]));
  }
  if (s.nullable && typeof out.type === 'string') out.type = [out.type, 'null'];
  return out;
}

const FINISH: Record<string, string> = { length: 'MAX_TOKENS', stop: 'STOP', content_filter: 'SAFETY', tool_calls: 'STOP' };

function usageOf(u: Record<string, any> | undefined): CompatChunk['usageMetadata'] {
  if (!u) return undefined;
  return {
    promptTokenCount: u.prompt_tokens,
    candidatesTokenCount: u.completion_tokens,
    thoughtsTokenCount: u.completion_tokens_details?.reasoning_tokens ?? 0,
    totalTokenCount: u.total_tokens,
  };
}

/** An HTTP failure as an Error carrying its status, which geminiErrors.ts classifies. */
async function failure(res: Response, endpoint: CompatEndpoint): Promise<Error> {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || body?.message || JSON.stringify(body).slice(0, 300);
  } catch {
    detail = res.statusText;
  }
  const where = endpoint.kind === 'local' ? `the local AI at ${endpoint.baseUrl}` : 'OpenRouter';
  return Object.assign(new Error(`${where} answered ${res.status}: ${detail}`), { status: res.status });
}

/**
 * The response formats to try, best first: the schema, a JSON object, then
 * nothing. A server that does not know one answers 400 and the next is tried.
 */
function formats(req: GeminiRequest): (Record<string, unknown> | undefined)[] {
  if (req.config?.responseMimeType !== 'application/json') return [undefined];
  const schema = req.config.responseSchema ? toJsonSchema(req.config.responseSchema) : null;
  return [...(schema ? [{ type: 'json_schema', json_schema: { name: 'response', schema, strict: false } }] : []), { type: 'json_object' }, undefined];
}

/**
 * The least room an answer is given (2026-11-07, agent audit item 17). A
 * reasoning model (qwen3, deepseek-r1, gpt-oss) counts its thinking against
 * `max_tokens`, so the chat turn's 512 went on thinking and the answer came
 * back empty. Local models and OpenRouter's free ones cost nothing per token.
 */
export const MIN_COMPAT_OUTPUT_TOKENS = 4096;

/**
 * Whether a 400 is about the response format, and so worth asking again in
 * the next one (2026-11-07, agent audit item 94). Every 400 was taken so, and
 * a model id the server does not have cost three requests a call, six a turn
 * with the chat's retry.
 */
export function refusesFormat(body: string): boolean {
  return /response_format|json_schema|json_object|structured output|schema|grammar/i.test(body);
}

async function post(endpoint: CompatEndpoint, req: GeminiRequest, stream: boolean): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (endpoint.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`;
  if (endpoint.kind === 'openrouter') headers['X-Title'] = 'Forma';
  let last: Response | null = null;
  for (const format of formats(req)) {
    const body = {
      model: endpoint.model,
      messages: toMessages(req.contents, req.config?.systemInstruction),
      ...(req.config?.maxOutputTokens ? { max_tokens: Math.max(req.config.maxOutputTokens, MIN_COMPAT_OUTPUT_TOKENS) } : {}),
      ...(typeof req.config?.temperature === 'number' ? { temperature: req.config.temperature } : {}),
      ...(format ? { response_format: format } : {}),
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    };
    const res = await fetch(`${endpoint.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: req.config?.abortSignal });
    if (res.status !== 400 || !format) return res;
    // Only a refusal of the format is asked again in the next one.
    if (!refusesFormat(await res.clone().text().catch(() => ''))) return res;
    last = res;
  }
  return last!;
}

/** Characters of text a request sends, for the context check below. */
function promptChars(req: GeminiRequest): number {
  const list = typeof req.contents === 'string' ? [{ parts: [{ text: req.contents }] }] : Array.isArray(req.contents) ? req.contents : [req.contents];
  return list.reduce((n, c) => n + (c.parts ?? []).reduce((m, p) => m + (p.text?.length ?? 0), 0), 0);
}

/**
 * A local server that read much less of the request than was sent
 * (2026-11-07, agent audit item 18). Ollama's default context is a few
 * thousand tokens and it drops the head of anything longer without a word,
 * the head being the instructions, so the answer is made blind. Its own
 * count of the prompt says so; text is about four characters a token, and
 * under half of that is not a tokenizer's difference.
 */
export function contextTooSmall(endpoint: Pick<CompatEndpoint, 'kind' | 'model'>, chars: number, promptTokens: number | undefined): Error | null {
  if (endpoint.kind !== 'local' || !promptTokens) return null;
  const expected = chars / 4;
  if (expected < 3000 || promptTokens >= expected * 0.5) return null;
  return new Error(
    `The local AI read only ${promptTokens.toLocaleString()} of about ${Math.round(expected).toLocaleString()} tokens of the request: ` +
      `${endpoint.model}'s context window is too small, so it never saw the instructions. ` +
      'For Ollama, start it with OLLAMA_CONTEXT_LENGTH=32768 (or set num_ctx in the model); in LM Studio, raise the context length when loading the model.',
  );
}

/**
 * A reasoning model that thought its whole answer away (agent audit item 17):
 * the stream ended at the length limit with reasoning and no answer.
 */
function thoughtOnly(endpoint: CompatEndpoint): Error {
  return new Error(
    `${endpoint.model} spent its whole answer reasoning and wrote none of it. ` +
      'Choose a model that does not reason, or turn its thinking off, in Settings under AI.',
  );
}

/**
 * How long a stream may say nothing (2026-11-11, the full audit, PL-16): two
 * minutes for OpenRouter's first bytes, ten for a local server's, then one
 * minute between pieces. A stalled connection or a server that hung showed
 * the working dots for ever, and the user had to guess to press Stop. A local
 * server writes nothing while it loads the model and reads the prompt, and a
 * generation's prompt is some 13,000 tokens, minutes on a computer's own
 * processor; once it writes, reasoning included, pieces come steadily. On
 * expiry the read is cancelled and the stream fails with "network error",
 * which geminiService's retry and fallback already take.
 */
export const STREAM_FIRST_BYTES_MS = 120_000;
export const LOCAL_FIRST_BYTES_MS = 600_000;
export const STREAM_BETWEEN_PIECES_MS = 60_000;

/** One read of the body, or a stall error once `ms` pass without one. */
async function readWithin(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Rejected before the cancel, which settles the pending read at once as done.
      reject(new Error(`network error: the answer stopped arriving for ${Math.round(ms / 1000)} seconds`));
      reader.cancel().catch(() => {});
    }, ms);
  });
  try {
    return await Promise.race([reader.read(), stalled]);
  } finally {
    clearTimeout(timer);
  }
}

/** The lines of a server-sent event stream, as they arrive. */
async function* eventLines(res: Response, firstMs: number): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let wait = firstMs;
  for (;;) {
    const { done, value } = await readWithin(reader, wait);
    wait = STREAM_BETWEEN_PIECES_MS;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

/** A client with the two calls of Gemini's SDK that geminiService.ts makes. */
export function compatClient(endpoint: CompatEndpoint) {
  return {
    models: {
      async generateContent(req: GeminiRequest): Promise<CompatChunk> {
        const res = await post(endpoint, req, false);
        if (!res.ok) throw await failure(res, endpoint);
        const body = await res.json();
        const choice = body?.choices?.[0];
        const small = contextTooSmall(endpoint, promptChars(req), body?.usage?.prompt_tokens);
        if (small) throw small;
        const text: string = choice?.message?.content ?? '';
        const reasoning = choice?.message?.reasoning ?? choice?.message?.reasoning_content ?? '';
        if (!text.trim() && reasoning && choice?.finish_reason === 'length') throw thoughtOnly(endpoint);
        return {
          text,
          candidates: [{ finishReason: FINISH[choice?.finish_reason] ?? choice?.finish_reason }],
          usageMetadata: usageOf(body?.usage),
        };
      },
      async generateContentStream(req: GeminiRequest): Promise<AsyncGenerator<CompatChunk>> {
        const res = await post(endpoint, req, true);
        if (!res.ok) throw await failure(res, endpoint);
        const chars = promptChars(req);
        return (async function* () {
          let wrote = false;
          let thought = false;
          for await (const line of eventLines(res, endpoint.kind === 'local' ? LOCAL_FIRST_BYTES_MS : STREAM_FIRST_BYTES_MS)) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') return;
            let event: any;
            try {
              event = JSON.parse(data);
            } catch {
              continue;
            }
            if (event?.error) throw Object.assign(new Error(event.error.message || 'The model reported an error.'), { status: event.error.code });
            const small = contextTooSmall(endpoint, chars, event?.usage?.prompt_tokens);
            if (small) throw small;
            const choice = event?.choices?.[0];
            const reason = choice?.finish_reason;
            const text: string = choice?.delta?.content ?? '';
            // Reasoning arrives in its own field and is never the answer.
            if (choice?.delta?.reasoning || choice?.delta?.reasoning_content) thought = true;
            if (text) wrote = true;
            if (reason === 'length' && thought && !wrote) throw thoughtOnly(endpoint);
            yield {
              text,
              candidates: reason ? [{ finishReason: FINISH[reason] ?? reason }] : undefined,
              usageMetadata: usageOf(event?.usage),
            };
          }
        })();
      },
    },
  };
}

/**
 * The models an endpoint offers, for the settings: every model a local
 * server has, or OpenRouter's free ones (an id ending `:free`), those that
 * read images first.
 */
export async function listModels(endpoint: Pick<CompatEndpoint, 'kind' | 'baseUrl' | 'apiKey'>, signal?: AbortSignal): Promise<{ id: string; vision: boolean }[]> {
  const headers: Record<string, string> = endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {};
  const res = await fetch(`${endpoint.baseUrl}/models`, { headers, signal });
  if (!res.ok) throw await failure(res, { ...endpoint, model: '' });
  const body = await res.json();
  const models: { id: string; vision: boolean }[] = (body?.data ?? []).map((m: any) => ({
    id: String(m.id),
    vision: Array.isArray(m.architecture?.input_modalities) ? m.architecture.input_modalities.includes('image') : /vision|vl\b|llava|gemma3|qwen2\.5vl|qwen3-vl|minicpm-v|llama3\.2-vision/i.test(String(m.id)),
  }));
  const offered = endpoint.kind === 'openrouter' ? models.filter((m) => m.id.endsWith(':free')) : models;
  return offered.sort((a, b) => Number(b.vision) - Number(a.vision) || a.id.localeCompare(b.id));
}
