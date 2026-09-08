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
import { cacheModel, clearCachedModel } from '../lib/modelCache';

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
  // The parameters are declared, unused, so `mock.calls` is typed as the
  // arguments `fetch` actually received. Without them the call tuple is `[]`
  // and reading `calls[n][0]` to see which model was requested does not compile.
  const mock = vi.fn(async (_url: unknown, _init?: unknown) => {
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
  /*
   * Each advance releases one backoff; three is more than the two retries need.
   *
   * **This is known to be rarely flaky and two attempts to fix it made things
   * worse (2026-09-08).** Recorded so the third person does not start where
   * the first two did:
   *
   *  - Raising the count to 20 with settled-tracking failed *more* often. The
   *    failure is `Test timed out in 5000ms`, which is vitest's REAL-time
   *    budget, not the simulated clock — each `advanceTimersByTimeAsync` costs
   *    real milliseconds, so more iterations means less headroom, not more.
   *  - `await vi.runAllTimersAsync()` fails deterministically, here and in
   *    isolation. Draining every timer at once is not equivalent to releasing
   *    them one backoff at a time for this chain.
   *
   * Observed rate is roughly one full-suite run in ten, always this first
   * case, always a timeout rather than a wrong value; it has never failed
   * running this file alone. So the next attempt should start by finding out
   * what is still pending when the budget expires, rather than by adjusting
   * how the clock is advanced. `turn.catch` above is load-bearing — removing
   * it turns a later test's rejection into this test's failure, which is
   * exactly what happened while trying the two ideas above.
   */
  for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(10_000);
  return turn;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetGenAIForTests();
  /*
   * Fix the model, so `resolveModel` never runs.
   *
   * Two reasons, and the second is why this appeared with the fallback tests.
   * Probing spends a catalogue request and one per candidate, which lands in
   * the same `fetch` mock the call-count assertions below read — so without a
   * cached model, "does not spend a second request on a bad key" counts the
   * probes too. And the cache is a module-level variable shared by every test
   * in this file, so before this existed, whichever model the first test
   * happened to settle on silently decided what the rest of them called.
   *
   * One model, so there is nothing to fall back to: the tests that are about
   * falling back seed their own set.
   */
  clearCachedModel();
  cacheModel('model-a', ['model-a']);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetGenAIForTests();
  clearCachedModel();
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

/*
 * Reported from a real session on 2026-09-08. The console read:
 *
 *   Auto-selected Gemini model: gemini-flash-latest (6 more available as
 *   fallbacks: gemini-2.5-flash, gemini-flash-lite-latest, ...)
 *   ... streamGenerateContent 503 (Service Unavailable)
 *   Chat turn failed (overloaded). Retrying in 2083ms - attempt 1 of 2.
 *   Chat turn failed (stream ended early). Retrying in 3430ms - attempt 2 of 2.
 *
 * Two retries against the same overloaded model, then the turn was lost, with
 * six probed alternatives sitting unused in the session cache. `analyzeReport-
 * Design` has always moved to the next model here; the chat path was given the
 * retry loop on 2026-09-05 and not the fallback, and this file's own header
 * said so ("a generation hitting the same outage retried twice and changed
 * model") without anyone noticing chat still did not.
 */
describe('a chat turn on a model that stays overloaded', () => {
  it('moves to the next model the key can call, rather than losing the turn', async () => {
    cacheModel('model-a', ['model-a', 'model-b']);
    const fetchMock = stubSequence(
      () => failure(503, 'This model is currently experiencing high demand.'),
      () => failure(503, 'This model is currently experiencing high demand.'),
      () => failure(503, 'This model is currently experiencing high demand.'),
      () => reply('Answered by the fallback.')
    );

    await expect(runTurn()).resolves.toMatchObject({ reply: 'Answered by the fallback.' });

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('model-a'))).toBe(true);
    expect(urls.some((u) => u.includes('model-b'))).toBe(true);
  });

  it('stops once every alternative has been tried', async () => {
    cacheModel('model-a', ['model-a', 'model-b']);
    stubSequence(() => failure(503, 'This model is currently experiencing high demand.'));
    await expect(runTurn()).rejects.toThrow(/high demand/i);
  });

  /*
   * The half the first fix left behind, and the one the user actually felt.
   *
   * Falling back is per-request, and deliberately not cached as the session's
   * model. So during a sustained outage every new message opened by spending
   * both retries and ~6s of backoff rediscovering the same 503 before falling
   * back again — the console carried one "stayed overloaded ... falling back"
   * line per message. The cooldown in `modelCache.ts` is what stops the second
   * turn repeating the first turn's homework.
   */
  it('does not re-discover the same outage on the next turn', async () => {
    cacheModel('model-a', ['model-a', 'model-b']);

    const urls: string[] = [];
    const mock = vi.fn(async (url: unknown) => {
      urls.push(String(url));
      return String(url).includes('model-a')
        ? failure(503, 'This model is currently experiencing high demand.')
        : reply('Answered by the fallback.');
    });
    vi.stubGlobal('fetch', mock);

    await expect(runTurn()).resolves.toMatchObject({ reply: 'Answered by the fallback.' });
    const afterFirstTurn = urls.length;
    expect(urls.some((u) => u.includes('model-a'))).toBe(true);

    // Second turn, same session: model-a is still cooling down.
    const second = chatReply(history, config);
    second.catch(() => undefined);
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(10_000);
    await expect(second).resolves.toMatchObject({ reply: 'Answered by the fallback.' });

    const secondTurnUrls = urls.slice(afterFirstTurn);
    expect(secondTurnUrls.length).toBeGreaterThan(0);
    expect(secondTurnUrls[0]).toContain('model-b');
    expect(secondTurnUrls.some((u) => u.includes('model-a'))).toBe(false);
  });

  // A model the user pinned in config is a choice, not a suggestion; silently
  // answering on a different one would make the setting a lie.
  it('does not wander off a model the user pinned', async () => {
    cacheModel('model-a', ['model-a', 'model-b']);
    const fetchMock = stubSequence(() => failure(503, 'This model is currently experiencing high demand.'));

    const turn = chatReply(history, { customApiKey: KEY, modelName: 'model-pinned' } as any);
    turn.catch(() => undefined);
    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(10_000);
    await expect(turn).rejects.toThrow(/high demand/i);

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => u.includes('model-pinned'))).toBe(true);
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
