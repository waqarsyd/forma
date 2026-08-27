/**
 * Picking a model the user's key can actually call.
 *
 * `geminiService.ts` exported ten things and two were tested (audit TEST-002).
 * The eight that were not included the whole of model resolution — the code
 * that decides, on the first generation of every session, which model the user
 * pays for. Its failure modes are all quiet ones:
 *
 *   - a bad *order* silently spends the user's money on a pro tier, because
 *     every candidate answers and the most expensive one happens to be first;
 *   - a bad *filter* sends a report to an embedding model;
 *   - a broken *cache* re-probes on every generation, which is ten live
 *     requests each time rather than once a session;
 *   - and the three "nothing worked" paths differ only in which sentence the
 *     user is shown, which is the difference between them topping up their
 *     billing and creating a new key.
 *
 * Driven entirely by stubbed HTTP against the response shapes observed from the
 * live API on 2026-08-27 — the catalogue returned 52 entries, 38 supporting
 * generateContent. No key, no network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveModel,
  validateApiKey,
  readCachedModel,
  clearCachedModel,
  analyzeReportDesign,
  chatReply,
  MissingApiKeyError,
  MODEL_PREFERENCE,
} from './geminiService';

const KEY = 'test-key-not-a-real-one';
const CATALOGUE_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200';

/** One catalogue entry, shaped as `GET /v1beta/models` really returns them. */
const entry = (name: string, methods = ['generateContent']) => ({
  name: `models/${name}`,
  supportedGenerationMethods: methods,
});

/** The names the live catalogue actually carried, trimmed to what matters here. */
const REAL_CATALOGUE = [
  entry('gemini-2.5-flash'),
  entry('gemini-2.5-pro'),
  entry('gemini-flash-latest'),
  entry('gemini-flash-lite-latest'),
  entry('gemini-pro-latest'),
  entry('gemini-3.7-flash'),
  entry('gemini-3.5-flash'),
  entry('text-embedding-004', ['embedContent']),
  entry('imagen-3.0-generate-002'),
];

type ProbeVerdict = number | 'ok';

/**
 * Stand in for the network.
 *
 * `catalogue` answers the discovery GET; `probe` decides each model's POST by
 * name, defaulting to 200. Returns the mock so a test can assert on the calls.
 */
function stubNetwork(options: {
  catalogue?: unknown[] | { status: number };
  probe?: (model: string) => ProbeVerdict;
} = {}) {
  const probe = options.probe ?? (() => 'ok' as const);

  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === CATALOGUE_URL) {
      const cat = options.catalogue ?? REAL_CATALOGUE;
      if (!Array.isArray(cat)) return new Response('{}', { status: cat.status });
      return new Response(JSON.stringify({ models: cat }), { status: 200 });
    }

    const match = /\/models\/([^:]+):generateContent/.exec(url);
    const model = match?.[1] ?? '';
    const verdict = probe(model);
    if (verdict === 'ok') return new Response('{}', { status: 200 });
    return new Response('{}', { status: verdict });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Which models were actually probed, in the order they were requested. */
const probedModels = (mock: ReturnType<typeof stubNetwork>): string[] =>
  mock.mock.calls
    .map(([url]) => /\/models\/([^:]+):generateContent/.exec(url as string)?.[1])
    .filter((m): m is string => !!m);

beforeEach(() => {
  clearCachedModel();
  try { sessionStorage.clear(); } catch { /* jsdom always has it */ }
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearCachedModel();
});

describe('MODEL_PREFERENCE', () => {
  it('leads with an alias, which is the one id that cannot go stale', () => {
    // Google retires models "for new users", so a pinned id works for existing
    // projects and 404s for every new key. An alias is repointed instead.
    expect(MODEL_PREFERENCE[0]).toMatch(/-latest$/);
  });

  it('puts cheap tiers before expensive ones', () => {
    const firstPro = MODEL_PREFERENCE.findIndex((m) => /pro/.test(m));
    const firstFlash = MODEL_PREFERENCE.findIndex((m) => /flash/.test(m));
    expect(firstFlash).toBeGreaterThanOrEqual(0);
    expect(firstPro === -1 || firstFlash < firstPro).toBe(true);
  });
});

describe('resolveModel', () => {
  it('returns the first preferred model the key can call', async () => {
    stubNetwork();
    await expect(resolveModel(KEY)).resolves.toBe(MODEL_PREFERENCE[0]);
  });

  it('skips models the key cannot call and takes the next', async () => {
    // 404 is what a retired-for-new-users model returns.
    const mock = stubNetwork({ probe: (m) => (m === MODEL_PREFERENCE[0] ? 404 : 'ok') });
    await expect(resolveModel(KEY)).resolves.toBe(MODEL_PREFERENCE[1]);
    // Every candidate is probed concurrently, so the first is still attempted.
    expect(probedModels(mock)).toContain(MODEL_PREFERENCE[0]);
  });

  it('probes the curated list before anything discovery added', async () => {
    const mock = stubNetwork();
    await resolveModel(KEY);
    const probed = probedModels(mock);
    expect(probed.slice(0, MODEL_PREFERENCE.length)).toEqual([...MODEL_PREFERENCE]);
  });

  it('never probes a model that cannot generate a report', async () => {
    const mock = stubNetwork();
    await resolveModel(KEY);
    const probed = probedModels(mock);
    expect(probed).not.toContain('text-embedding-004');
    expect(probed).not.toContain('imagen-3.0-generate-002');
  });

  it('caches the winner so the next call costs nothing', async () => {
    const mock = stubNetwork();
    await resolveModel(KEY);
    const callsAfterFirst = mock.mock.calls.length;

    await expect(resolveModel(KEY)).resolves.toBe(MODEL_PREFERENCE[0]);
    expect(mock.mock.calls.length).toBe(callsAfterFirst);
    expect(readCachedModel()).toBe(MODEL_PREFERENCE[0]);
  });

  it('survives the catalogue being unavailable — discovery can only ever add', async () => {
    // A blocked or failing models.list must not stop a key that can reach the
    // curated list.
    stubNetwork({ catalogue: { status: 403 } });
    await expect(resolveModel(KEY)).resolves.toBe(MODEL_PREFERENCE[0]);
  });

  it('reaches a model only discovery knows about when the curated list is dead', async () => {
    const mock = stubNetwork({ probe: (m) => (MODEL_PREFERENCE.includes(m) ? 404 : 'ok') });
    const chosen = await resolveModel(KEY);
    expect(MODEL_PREFERENCE).not.toContain(chosen);
    expect(probedModels(mock)).toContain(chosen);
  });

  describe('when nothing answers, the message decides what the user does next', () => {
    it('blames the key when every probe is a key rejection', async () => {
      // A key-level rejection repeats for every candidate, so it is the real
      // cause and outranks the quota message.
      stubNetwork({ probe: () => 403 });
      await expect(resolveModel(KEY)).rejects.toThrow(/key was rejected/i);
    });

    it('sends the user to billing when every probe is over quota', async () => {
      stubNetwork({ probe: () => 429 });
      await expect(resolveModel(KEY)).rejects.toThrow(/over quota/i);
    });

    it('sends the user to make a new key when nothing is available at all', async () => {
      stubNetwork({ probe: () => 404 });
      await expect(resolveModel(KEY)).rejects.toThrow(/no gemini model is available/i);
    });

    /**
     * Offline is not the same as "your key has no models", and until this test
     * was written it produced that exact message: the user was told to create a
     * new key in AI Studio, which was both untrue and impossible — they had no
     * connection to create one with. Both `discoverModels` and `probeModel`
     * swallowed the network error, so `validateApiKey`'s own connectivity
     * branch was unreachable code.
     */
    it('says the connection failed when no request reached Google at all', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
      await expect(resolveModel(KEY)).rejects.toThrow(/could not reach google/i);
    });

    it('does not blame the key when the machine is offline', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
      let message = '';
      try { await resolveModel(KEY); } catch (e: any) { message = e.message; }
      expect(message).not.toMatch(/create a new key|no gemini model is available|over quota/i);
      expect(message).toMatch(/has not been tested/i);
    });

    it('still blames the key when some requests did arrive', async () => {
      // A mix means the network works; what came back is the better clue.
      let n = 0;
      const fetchMock = vi.fn(async (url: string) => {
        if (url === CATALOGUE_URL) return new Response(JSON.stringify({ models: REAL_CATALOGUE }), { status: 200 });
        if (n++ % 2 === 0) throw new TypeError('Failed to fetch');
        return new Response('{}', { status: 403 });
      });
      vi.stubGlobal('fetch', fetchMock);
      await expect(resolveModel(KEY)).rejects.toThrow(/key was rejected/i);
    });

    it('prefers the key message over the quota one when both appear', async () => {
      let n = 0;
      stubNetwork({ probe: () => (n++ === 0 ? 403 : 429) });
      await expect(resolveModel(KEY)).rejects.toThrow(/key was rejected/i);
    });

    it('caches nothing on failure', async () => {
      stubNetwork({ probe: () => 404 });
      await expect(resolveModel(KEY)).rejects.toThrow();
      expect(readCachedModel()).toBeNull();
    });
  });
});

describe('readCachedModel / clearCachedModel', () => {
  it('starts empty', () => {
    expect(readCachedModel()).toBeNull();
  });

  it('forgets the resolved model, in memory and in storage', async () => {
    stubNetwork();
    await resolveModel(KEY);
    expect(readCachedModel()).not.toBeNull();

    clearCachedModel();
    expect(readCachedModel()).toBeNull();
    expect(sessionStorage.getItem('geminiModel:session')).toBeNull();
  });
});

describe('validateApiKey', () => {
  it('refuses an empty key without touching the network', async () => {
    const mock = stubNetwork();
    await expect(validateApiKey('')).resolves.toEqual({ valid: false, message: 'Enter a key first.' });
    await expect(validateApiKey('   ')).resolves.toMatchObject({ valid: false });
    expect(mock).not.toHaveBeenCalled();
  });

  it('reports the model it settled on, so the user can see what they are paying for', async () => {
    stubNetwork();
    const result = await validateApiKey(KEY);
    expect(result.valid).toBe(true);
    expect(result.model).toBe(MODEL_PREFERENCE[0]);
    expect(result.message).toContain(MODEL_PREFERENCE[0]);
  });

  it('trims the key, because a pasted one usually carries whitespace', async () => {
    stubNetwork();
    await expect(validateApiKey(`  ${KEY}\n`)).resolves.toMatchObject({ valid: true });
  });

  it('re-probes rather than trusting a choice made for a different key', async () => {
    // Deliberate: a different key can have different model access. It costs a
    // second round of probes and that is the correct trade.
    const mock = stubNetwork();
    await resolveModel(KEY);
    const afterResolve = mock.mock.calls.length;

    await validateApiKey('a-different-key');
    expect(mock.mock.calls.length).toBeGreaterThan(afterResolve);
  });

  it('passes the underlying reason through rather than a generic failure', async () => {
    stubNetwork({ probe: () => 429 });
    await expect(validateApiKey(KEY)).resolves.toMatchObject({
      valid: false,
      message: expect.stringMatching(/over quota/i),
    });
  });

  it('names a connectivity failure as one, not as a bad key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const result = await validateApiKey(KEY);
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/could not reach google/i);
    // The distinction that matters: it must not send them to AI Studio, which
    // they cannot reach either.
    expect(result.message).not.toMatch(/create a new key/i);
  });

  it('never returns valid:true with no model', async () => {
    stubNetwork();
    const result = await validateApiKey(KEY);
    if (result.valid) expect(result.model).toBeTruthy();
  });
});

/**
 * The guard that runs before any request.
 *
 * `MissingApiKeyError` is a distinct type rather than a message because the UI
 * branches on it: it opens the config modal instead of showing a failure. A
 * refactor that flattened it into a plain Error would look harmless and would
 * leave a first-time user staring at "something went wrong" with no way to
 * discover that the app needs their key.
 */
describe('no key means no request', () => {
  const configWithoutKey = {
    version: '23.2',
    pageSize: 'Letter',
    unit: 'HundredthsOfAnInch',
    header: {},
    footer: {},
  };

  it('analyzeReportDesign refuses, as a type the caller can branch on', async () => {
    const mock = stubNetwork();
    await expect(analyzeReportDesign('draw this', [], configWithoutKey)).rejects.toBeInstanceOf(
      MissingApiKeyError
    );
    expect(mock).not.toHaveBeenCalled();
  });

  it('chatReply refuses the same way', async () => {
    // chatReply takes the history first — there is no separate prompt argument.
    const mock = stubNetwork();
    await expect(
      chatReply([{ role: 'user', text: 'hello' }], configWithoutKey)
    ).rejects.toBeInstanceOf(MissingApiKeyError);
    expect(mock).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only key as absent', async () => {
    stubNetwork();
    await expect(
      analyzeReportDesign('draw this', [], { ...configWithoutKey, customApiKey: '   ' })
    ).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it('carries a message that tells the user what to do', async () => {
    const error = new MissingApiKeyError();
    expect(error.name).toBe('MissingApiKeyError');
    expect(error.message).toMatch(/api key/i);
  });
});

/**
 * A probe that never answers must not gate the rest (audit REL-003).
 *
 * The probes run concurrently behind Promise.all, so before the timeout one
 * unresponsive endpoint held up the whole generation -- the user saw "starting"
 * with no progress and no explanation, on an operation that already takes a
 * minute.
 */
describe('a hung probe does not gate the others', () => {
  it('gives up on a model that never answers and uses one that does', async () => {
    vi.useFakeTimers();
    const hanging = new Set([MODEL_PREFERENCE[0]]);
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url === CATALOGUE_URL) return Promise.resolve(new Response(JSON.stringify({ models: REAL_CATALOGUE }), { status: 200 }));
      const model = /\/models\/([^:]+):generateContent/.exec(url)?.[1] ?? '';
      if (!hanging.has(model)) return Promise.resolve(new Response('{}', { status: 200 }));
      return new Promise<Response>((_r, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
        });
      });
    }));

    const pending = resolveModel(KEY);
    await vi.advanceTimersByTimeAsync(30_000);
    const chosen = await pending;

    // The first choice hung; resolution still completed on a later candidate.
    expect(chosen).not.toBe(MODEL_PREFERENCE[0]);
    expect(chosen).toBeTruthy();
  });

  it('still lets a user cancellation through', async () => {
    // A timeout and a cancellation both surface as AbortError. Only the
    // caller's signal distinguishes them, and Stop must still stop.
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === CATALOGUE_URL) return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
      controller.abort();
      const e = new Error('aborted'); e.name = 'AbortError';
      return Promise.reject(e);
    }));

    await expect(resolveModel(KEY, controller.signal)).rejects.toThrow();
  });
});