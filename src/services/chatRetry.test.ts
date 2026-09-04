/**
 * Does a chat turn actually survive the failures that killed three of them?
 *
 * `geminiService.test.ts` pins the two predicates — whether an error is worth
 * retrying. This drives the real `chatReply` against a stubbed network and
 * asks the question those cannot: that the retry loop exists, restarts the
 * whole turn, and stops when it should.
 *
 * Both failures come from a session on 2026-09-05: a 503 arriving as "This
 * model is currently experiencing high demand", and the SDK's SSE reader
 * raising "Incomplete JSON segment at the end" when a stream ended between
 * chunks. Neither was retried; a generation hitting the same outage retried
 * twice and changed model.
 *
 * Fake timers throughout, because the backoff is ~1.5s and ~3s. Without them
 * this file alone would take longer than the rest of the suite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chatReply } from './geminiService';
import { resetGenAIForTests } from '../lib/genai';

const KEY = 'test-key-not-a-real-credential';
const config = { customApiKey: KEY } as any;
const history = [{ role: 'user' as const, text: 'hello' }];

/** One server-sent event carrying a model chunk, as the SDK reads them. */
const sse = (text: string) =>
  `data: ${JSON.stringify({
    candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: 'STOP' }],
  })}\r\n\r\n`;

const streamOf = (body: string) =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  );

const reply = (text: string, wantsReport = false) =>
  streamOf(sse(JSON.stringify({ reply: text, wantsReport })));

const failure = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { code: status, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Queue one outcome per call, so a test states exactly what the network does. */
function stubSequence(...responses: Array<() => Response | Promise<never>>) {
  let call = 0;
  const mock = vi.fn(async () => {
    const next = responses[Math.min(call, responses.length - 1)];
    call++;
    return next();
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/**
 * Run a chat turn to completion while letting the backoff timers fire.
 *
 * The `.catch` is not decoration: the turn is started before the timers are
 * advanced, so a rejection lands while this function is still awaiting them and
 * vitest reports it as an unhandled rejection before the assertion ever sees
 * it. Attaching a handler immediately marks it handled; the original promise is
 * still what gets returned, so `.rejects` works as written.
 */
async function runTurn() {
  const turn = chatReply(history, config);
  turn.catch(() => undefined);
  // Each advance releases one backoff; three is more than the two retries need.
  for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(10_000);
  return turn;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetGenAIForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetGenAIForTests();
});

describe('a chat turn that hits a 503', () => {
  it('retries and returns the reply instead of failing', async () => {
    const fetchMock = stubSequence(
      () => failure(503, 'This model is currently experiencing high demand.'),
      () => reply('Hello there.')
    );

    await expect(runTurn()).resolves.toMatchObject({ reply: 'Hello there.' });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('gives up after the retries and reports the failure readably', async () => {
    // Overloaded every time: the user should get the provider's message, not a
    // wall of JSON, and not an infinite wait.
    stubSequence(() => failure(503, 'This model is currently experiencing high demand.'));
    await expect(runTurn()).rejects.toThrow(/high demand/i);
  });
});

describe('a chat turn whose stream ends mid-object', () => {
  it('retries the whole turn rather than salvaging half a JSON object', async () => {
    const fetchMock = stubSequence(
      // A chunk that stops inside the JSON: the SDK's reader raises
      // "Incomplete JSON segment at the end" on a body it cannot finish.
      () => streamOf('data: {"candidates":[{"content":{"parts":[{"text":"{\\"reply\\":\\"par'),
      () => reply('Recovered.')
    );

    const outcome = await runTurn();
    expect(outcome.reply).toBe('Recovered.');
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('a chat turn that fails for a reason retrying cannot fix', () => {
  it('does not spend a second request on a bad key', async () => {
    const fetchMock = stubSequence(() => failure(400, 'API key not valid. Please pass a valid API key.'));
    await expect(runTurn()).rejects.toThrow(/API key not valid/i);
    // The one request, and no more: three attempts would show the same error
    // three times as slowly.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a model that does not exist', async () => {
    const fetchMock = stubSequence(() => failure(404, 'models/whatever is not found.'));
    await expect(runTurn()).rejects.toThrow(/not found/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('a chat turn the user cancels', () => {
  it('is never retried', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(chatReply(history, config, controller.signal)).rejects.toThrow(/abort/i);
  });
});
