/**
 * Turning a Gemini SDK error into something a user can act on.
 *
 * Found by testing against the live API with a **valid** key on 2026-08-27: a
 * malformed request came back as HTTP 400 INVALID_ARGUMENT, and the app told
 * the user *"That Gemini API key is not valid. Check for a typo or paste it
 * again in Settings."*
 *
 * The mapping was `status === 400 || message.includes("API_KEY_INVALID") || …`.
 * The two message checks are the correct discriminators; the bare status was
 * over-reach. Google returns 400 INVALID_ARGUMENT for an unsupported mime type,
 * an oversized payload, a bad generationConfig — `geminiService.ts` already
 * documents one such case, a model rejecting `thinkingBudget: 0` with a bare
 * 400 — and for a genuinely malformed key. Only the last is a key problem.
 *
 * The cost of getting this wrong is not a bad error string. It is a diagnostic
 * dead end: the user is told to fix the one thing that is not broken, replaces
 * a working key with another working key, and hits the same wall.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { classifyGeminiError, dailyLimitOf, isOffline, isOverloadedError, isQuotaExhausted, parseRetryDelayMs , quotaKind, quotaWaitMs, msUntilPacificMidnight } from './geminiErrors';

// The day's limit Google states in a spent daily quota, for Settings' Usage today (2026-11-05).
describe('dailyLimitOf', () => {
  it("reads the day's limit from a daily quota, and nothing from a per-minute one or another error", () => {
    expect(dailyLimitOf({ status: 429, message: "Quota exceeded for quota metric 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', limit: 20, model: gemini-2.5-flash" })).toBe(20);
    expect(dailyLimitOf({ status: 429, message: "Quota exceeded for metric 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', limit: 10" })).toBeNull();
    expect(dailyLimitOf({ status: 503, message: 'overloaded' })).toBeNull();
  });
});

/** Shaped like what @google/genai throws. */
const sdkError = (status: number | string | undefined, message: string) =>
  Object.assign(new Error(message), { status });

describe('isQuotaExhausted', () => {
  it('recognises the status and the code', () => {
    expect(isQuotaExhausted({ status: 429 })).toBe(true);
    expect(isQuotaExhausted({ status: 'RESOURCE_EXHAUSTED' })).toBe(true);
    expect(isQuotaExhausted({ message: 'got 429 back' })).toBe(true);
    expect(isQuotaExhausted({ message: 'RESOURCE_EXHAUSTED' })).toBe(true);
  });

  // A rate limit and a capacity outage need opposite handling: one waits a
  // stated time, the other moves to a different model.
  it('is not confused by an overload', () => {
    expect(isQuotaExhausted({ status: 503, message: 'model is overloaded' })).toBe(false);
    expect(isQuotaExhausted({ message: 'This model is currently experiencing high demand.' })).toBe(false);
  });

  it('says no to an empty error', () => {
    expect(isQuotaExhausted({})).toBe(false);
    expect(isQuotaExhausted(undefined)).toBe(false);
  });
});

/*
 * A 429 carries the answer to "how long should I wait" and the app was throwing
 * it away. Both spellings appear: the prose form Google puts in the message, and
 * a `retryDelay` field on the structured error. Observed 2026-09-08 on a
 * free-tier key limited to five requests per minute per model.
 */
describe('parseRetryDelayMs', () => {
  it('reads the prose form Google puts in the message', () => {
    expect(parseRetryDelayMs({ message: 'Quota exceeded. Please retry in 2.049434999s.' })).toBe(2049);
    expect(parseRetryDelayMs({ message: 'Please retry in 54.915754206s.' })).toBe(54916);
  });

  // Seconds, not milliseconds: rounding 2.049s to 2000 would send the retry
  // fractionally early, which is exactly when it gets refused again.
  it('keeps fractional seconds', () => {
    expect(parseRetryDelayMs({ message: 'Please retry in 1.5s' })).toBe(1500);
  });

  it('reads a structured retryDelay field', () => {
    expect(parseRetryDelayMs({ retryDelay: '54s' })).toBe(54000);
    expect(parseRetryDelayMs({ details: { retryDelay: '7s' } })).toBe(7000);
  });

  it('reads the field when it is embedded in the message JSON', () => {
    expect(parseRetryDelayMs({ message: '{"error":{"retryDelay":"30s"}}' })).toBe(30000);
  });

  it('returns null when nothing says', () => {
    expect(parseRetryDelayMs({ message: 'You have exceeded your quota.' })).toBeNull();
    expect(parseRetryDelayMs({})).toBeNull();
    expect(parseRetryDelayMs(undefined)).toBeNull();
  });

  // A nonsense value would park a model for the rest of the session and read as
  // the fallback having stopped working. Rejected rather than clamped.
  it('refuses an implausible delay rather than trusting it', () => {
    expect(parseRetryDelayMs({ retryDelay: '99999s' })).toBeNull();
    expect(parseRetryDelayMs({ message: 'Please retry in 0s' })).toBeNull();
  });
});

describe('classifyGeminiError', () => {
  describe('400 — only a key problem when it says so', () => {
    it('reports a genuinely invalid key from the message, not the status', () => {
      const e = classifyGeminiError(sdkError(400, 'API key not valid. Please pass a valid API key.'));
      expect(e.message).toMatch(/key is not valid/i);
    });

    it('recognises API_KEY_INVALID', () => {
      const e = classifyGeminiError(sdkError(400, '{"error":{"status":"API_KEY_INVALID"}}'));
      expect(e.message).toMatch(/key is not valid/i);
    });

    /**
     * "Does not blame the key" is the property, and it is not the same as "does
     * not contain the word key" — the message deliberately says the key is
     * fine, which is the reassurance that stops someone re-pasting a working
     * one. What must never appear is the instruction to go and change it.
     */
    const BLAMES_THE_KEY = /key is not valid|check for a typo|paste it again|key was rejected/i;

    it('does NOT blame the key for a malformed request', () => {
      // The exact error observed against the live API with a valid key.
      const e = classifyGeminiError(
        sdkError(400, "* GenerateContentRequest.contents[0].parts[1].data: required oneof field 'data' must have one initialized field")
      );
      expect(e.message).not.toMatch(BLAMES_THE_KEY);
      expect(e.message).toMatch(/rejected the request/i);
      expect(e.message).toMatch(/API key is fine/i);
    });

    it('does NOT blame the key for an unsupported file type', () => {
      const e = classifyGeminiError(sdkError(400, 'Unsupported MIME type: application/x-msdownload'));
      expect(e.message).not.toMatch(BLAMES_THE_KEY);
      expect(e.message).toMatch(/uploaded file/i);
    });

    it('does NOT blame the key for an oversized request', () => {
      const e = classifyGeminiError(sdkError(400, 'The request payload size exceeds the limit.'));
      expect(e.message).not.toMatch(BLAMES_THE_KEY);
    });

    it('surfaces the provider\'s own wording so the real cause is visible', () => {
      const e = classifyGeminiError(sdkError(400, 'Unsupported MIME type: image/tiff'));
      expect(e.message).toContain('Unsupported MIME type: image/tiff');
    });
  });

  describe('the branches that were already right', () => {
    it('429 is a quota problem', () => {
      expect(classifyGeminiError(sdkError(429, 'RESOURCE_EXHAUSTED')).message).toMatch(/quota/i);
    });

    // The number that makes the message actionable was in the error all along.
    it('429 says when to try again, when Google says', () => {
      const msg = classifyGeminiError(sdkError(429, 'Quota exceeded. Please retry in 54.9s.')).message;
      expect(msg).toMatch(/try again in about 55s/i);
    });

    it('429 without a stated delay still reads as a rate limit, not a billing failure', () => {
      const msg = classifyGeminiError(sdkError(429, 'RESOURCE_EXHAUSTED')).message;
      expect(msg).not.toMatch(/try again in about/i);
      expect(msg).toMatch(/per minute per model/i);
    });

    it('403 is a rejected key', () => {
      expect(classifyGeminiError(sdkError(403, 'PERMISSION_DENIED')).message).toMatch(/rejected/i);
    });

    it('403 with "leaked" says so specifically', () => {
      const e = classifyGeminiError(sdkError(403, 'API key was reported as leaked'));
      expect(e.message).toMatch(/published somewhere public/i);
    });

    it('404 means no model this key can reach', () => {
      expect(classifyGeminiError(sdkError(404, 'NOT_FOUND')).message).toMatch(/no gemini model/i);
    });

    it('503 says the fault is Google\'s, not the user\'s', () => {
      const e = classifyGeminiError(sdkError(503, 'The model is overloaded. UNAVAILABLE'));
      expect(e.message).toMatch(/busy/i);
      expect(e.message).toMatch(/nothing is wrong with your API key/i);
    });
  });

  describe('unwrapping', () => {
    it('pulls the human-readable part out of the provider\'s raw JSON', () => {
      const raw = '{"error":{"code":500,"message":"Internal error encountered.","status":"INTERNAL"}}';
      const e = classifyGeminiError(sdkError(500, raw));
      expect(e.message).toContain('Internal error encountered.');
      expect(e.message).not.toContain('{');
    });

    it('falls back to the message as given when it is not JSON', () => {
      expect(classifyGeminiError(sdkError(500, 'something broke')).message).toContain('something broke');
    });

    it('never produces an empty message', () => {
      for (const e of [sdkError(undefined, ''), sdkError(500, ''), new Error('')]) {
        expect(classifyGeminiError(e).message.trim().length).toBeGreaterThan(0);
      }
    });
  });

  /* The agent audit's batch E (2026-11-07). */
  describe('in the terms of what failed', () => {
    afterEach(() => vi.unstubAllGlobals());

    // Item 15: a local model's failure never names Google or the Gemini key.
    it('says a Local AI or OpenRouter failure in its own words, never Gemini’s', () => {
      const local = { provider: 'local' as const, where: 'http://localhost:11434/v1', model: 'qwen3:8b' };
      const unreachable = classifyGeminiError(new TypeError('Failed to fetch'), local);
      expect(unreachable.message).toMatch(/could not reach the local AI at http:\/\/localhost:11434\/v1/);
      expect(unreachable.message).toContain('OLLAMA_ORIGINS');
      expect(classifyGeminiError(sdkError(404, 'the local AI at x answered 404: model not found'), local).message).toMatch(/has no model qwen3:8b/);
      const router = classifyGeminiError(sdkError(401, 'OpenRouter answered 401: No auth credentials'), { provider: 'openrouter', model: 'm:free' });
      expect(router.message).toMatch(/OpenRouter rejected the key/);
      for (const e of [unreachable, router]) expect(e.message).not.toMatch(/Gemini|Google/);
    });

    // Item 83: a pinned model's spent allowance does not claim the others were tried.
    it('says a chosen model was the only one tried when its daily allowance is spent', () => {
      const daily = sdkError(429, "Quota exceeded for metric 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' model: gemini-2.5-pro");
      expect(classifyGeminiError(daily).message).toMatch(/Forma tried the other models/);
      const pinned = classifyGeminiError(daily, { triedOthers: false }).message;
      expect(pinned).not.toMatch(/tried the other models/);
      expect(pinned).toMatch(/only one Forma tries; choose Auto/);
    });

    // Item 44: offline is said as offline.
    it('says offline when the browser is offline, before reading the failure as a closed stream', () => {
      vi.stubGlobal('navigator', { onLine: false });
      expect(isOffline()).toBe(true);
      expect(classifyGeminiError(new TypeError('Failed to fetch')).message).toMatch(/^You are offline/);
    });

    // Item 93: one test for an overload.
    it('reads an overload one way, "high demand" included', () => {
      expect(isOverloadedError(sdkError(undefined, 'This model is currently experiencing high demand'))).toBe(true);
      expect(isOverloadedError({ status: 'UNAVAILABLE', message: '' })).toBe(true);
      expect(classifyGeminiError(sdkError(undefined, 'This model is currently experiencing high demand')).message).toMatch(/busy/);
      expect(isOverloadedError(sdkError(400, 'bad request'))).toBe(false);
    });

    it('keeps the provider’s own error as the cause', () => {
      const raw = sdkError(503, 'UNAVAILABLE');
      expect((classifyGeminiError(raw) as Error & { cause?: unknown }).cause).toBe(raw);
    });
  });
});

describe('which quota a 429 is (2026-11-02)', () => {
  it('tells the daily allowance from the per-minute limit by the quota Google names', () => {
    expect(quotaKind({ status: 429, message: "Quota exceeded for quota metric 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'" })).toBe('daily');
    expect(quotaKind({ status: 429, message: 'Quota exceeded: GenerateRequestsPerMinutePerProjectPerModel-FreeTier' })).toBe('per-minute');
    expect(quotaKind({ status: 429, message: 'Please retry in 21s.' })).toBe('per-minute');
    expect(quotaKind({ status: 429, message: 'Resource exhausted' })).toBe('unknown');
  });

  it('counts to midnight Pacific time, when daily quotas reset', () => {
    // 2026-11-02 is in Pacific standard time, UTC-8.
    expect(msUntilPacificMidnight(new Date('2026-11-02T08:00:00Z'))).toBe(24 * 3600 * 1000);
    expect(msUntilPacificMidnight(new Date('2026-11-02T20:30:00Z'))).toBe(11.5 * 3600 * 1000);
    expect(quotaWaitMs({ status: 429, message: 'PerDay' }, new Date('2026-11-02T20:30:00Z'))).toBe(11.5 * 3600 * 1000);
    expect(quotaWaitMs({ status: 429, message: 'Please retry in 2s.' })).toBe(2000);
  });

  it('says a spent daily allowance is daily, and what works meanwhile', () => {
    const e = classifyGeminiError({ status: 429, message: "Quota exceeded for quota metric 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', model: gemini-2.5-flash" });
    expect(e.message).toMatch(/daily allowance for gemini-2\.5-flash is used up/);
    expect(e.message).toMatch(/midnight Pacific time, in about \d+ hours?/);
    expect(e.message).toContain('a local AI or OpenRouter');
  });
});