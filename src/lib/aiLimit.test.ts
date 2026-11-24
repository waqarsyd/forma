/**
 * Which limit, and when it lifts (2026-11-24, the CLI and Forma Designer
 * work's wave 3, GAP3-2 and GAP3-5): read where the error itself is held, the
 * MCP server's and the command line's work, from the classified error and
 * the provider's own under it, as the service throws them. In
 * fallbackChain.test.ts until the wave's review moved `limitOf` to a module
 * of its own, which the browser never loads (W3-BROWSER-1).
 */
import { describe, expect, it, vi } from 'vitest';
import { DAILY_RESET_MS, limitOf, msUntilPacificReset } from './aiLimit';
import { askWithChain, isLimit } from './fallbackChain';
import { classifyGeminiError, msUntilPacificMidnight, quotaKind } from './geminiErrors';
import type { ReportConfig } from '../services/geminiService';

const base: ReportConfig = { version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'A4', customApiKey: 'k' };
const router = { openRouterKey: 'sk-or', openRouterModel: 'google/gemma-4-31b-it:free' };

describe('which limit an error is, and when it lifts', () => {
  // 12:00 in the afternoon, Pacific: Google's daily reset is twelve hours off.
  const now = new Date('2026-11-24T20:00:00Z');
  /** Google's own 429, as the SDK throws it: the body's JSON in its message, the quota named, and RetryInfo when Google gives one. */
  const google = (quotaId: string, retryDelay?: string) =>
    Object.assign(
      new Error(
        JSON.stringify({
          error: {
            code: 429,
            message: 'You exceeded your current quota, please check your plan and billing details.',
            status: 'RESOURCE_EXHAUSTED',
            details: [
              { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId }] },
              ...(retryDelay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] : []),
            ],
          },
        }),
      ),
      { status: 429 },
    );

  it("reads a minute's limit and its wait off Google's own error, under a classified one whose words say neither", () => {
    const classified = classifyGeminiError(google('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '41s'));
    // The finding's measurement: the sentence alone is a limit of no known kind, with no wait.
    expect(quotaKind(classified)).toBe('unknown');
    expect(limitOf(classified, 'gemini', now)).toEqual({ kind: 'per-minute', waitMs: 41_000, provider: 'gemini' });
  });

  it("reads the day's limit, until midnight Pacific when Google resets it, and from the classified words alone, which isLimit misses", () => {
    const classified = classifyGeminiError(google('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '30s'));
    const day = { kind: 'daily', waitMs: msUntilPacificReset(now), provider: 'gemini' };
    expect(day.waitMs).toBe(12 * 3600 * 1000);
    expect(limitOf(classified, 'gemini', now)).toEqual(day);
    const wordsAlone = new Error(classified.message);
    expect(isLimit(wordsAlone)).toBe(false);
    expect(limitOf(wordsAlone, 'gemini', now)).toEqual(day);
  });

  it('says a limit that names neither kind nor wait is of no known kind, with no wait', () => {
    expect(limitOf(classifyGeminiError(Object.assign(new Error('Too Many Requests'), { status: 429 })), 'gemini', now)).toEqual({ kind: 'unknown', waitMs: null, provider: 'gemini' });
  });

  it('is nothing for what is not a limit: an overload, a loop, a refused key, a refused request, nothing', () => {
    expect(limitOf(classifyGeminiError(Object.assign(new Error('The model is overloaded.'), { status: 503 })))).toBeNull();
    expect(limitOf(new Error('The AI kept repeating itself while writing this report, even after trying again.'))).toBeNull();
    expect(limitOf(classifyGeminiError(Object.assign(new Error('API key not valid. Please pass a valid API key.'), { status: 400 })))).toBeNull();
    expect(limitOf(Object.assign(new Error('OpenRouter answered 400: no images'), { status: 400, provider: 'openrouter' }))).toBeNull();
    expect(limitOf(null)).toBeNull();
    expect(limitOf(undefined)).toBeNull();
  });

  it("reads a 429's headers first: a window spent until a reset hours off is the day's, a short one the minute's", () => {
    const at = now.getTime();
    const routed = (headers: object) => classifyGeminiError(Object.assign(new Error('OpenRouter answered 429: Rate limit exceeded'), { status: 429, provider: 'openrouter', ...headers }), { provider: 'openrouter', model: 'x:free' });
    expect(limitOf(routed({ rateLimit: { remaining: 0, resetAt: at + 6 * 3600_000 } }), 'gemini', now)).toEqual({ kind: 'daily', waitMs: 6 * 3600_000, provider: 'openrouter' });
    expect(limitOf(routed({ retryAfterMs: 20_000, rateLimit: { remaining: 0, resetAt: at + 20_000 } }), 'gemini', now)).toEqual({ kind: 'per-minute', waitMs: 20_000, provider: 'openrouter' });
    expect(limitOf(routed({ retryAfterMs: 45_000 }), 'gemini', now)).toEqual({ kind: 'per-minute', waitMs: 45_000, provider: 'openrouter' });
    // A wait past any minute's window is not one to sit out.
    expect(limitOf(routed({ retryAfterMs: DAILY_RESET_MS + 1 }), 'gemini', now)).toMatchObject({ kind: 'daily' });
    // Requests left in the window: the reset says nothing of this limit, and with no other word it is of no known kind.
    expect(limitOf(routed({ rateLimit: { remaining: 3, resetAt: at + 6 * 3600_000 } }), 'gemini', now)).toEqual({ kind: 'unknown', waitMs: null, provider: 'openrouter' });
    // No headers at all, and words that name no limit: unknown.
    expect(limitOf(routed({}), 'gemini', now)).toEqual({ kind: 'unknown', waitMs: null, provider: 'openrouter' });
  });

  /*
   * The wave's review (W3R-2): OpenRouter's body names the limit
   * (services/compatClient.ts `bodyLimit` keeps it as `limitKind`), and that
   * is read before the headers' arithmetic, which takes a short wait for the
   * minute's.
   */
  it("takes the limit the provider's answer named before the headers' arithmetic, with the wait the headers give, or none", () => {
    const at = now.getTime();
    const routed = (said: object) => classifyGeminiError(Object.assign(new Error('OpenRouter answered 429: Rate limit exceeded: free-models-per-day. '), { status: 429, provider: 'openrouter', ...said }), { provider: 'openrouter', model: 'x:free' });
    expect(limitOf(routed({ limitKind: 'daily', rateLimit: { remaining: 0, resetAt: at + 30_000 } }), 'gemini', now)).toEqual({ kind: 'daily', waitMs: 30_000, provider: 'openrouter' });
    expect(limitOf(routed({ limitKind: 'per-minute', rateLimit: { remaining: 0, resetAt: at + 40_000 } }), 'gemini', now)).toEqual({ kind: 'per-minute', waitMs: 40_000, provider: 'openrouter' });
    expect(limitOf(routed({ limitKind: 'daily' }), 'gemini', now)).toEqual({ kind: 'daily', waitMs: null, provider: 'openrouter' });
    // Anything else on the error is not a kind.
    expect(limitOf(routed({ limitKind: 'weekly' }), 'gemini', now)).toEqual({ kind: 'unknown', waitMs: null, provider: 'openrouter' });
  });

  it("has no reset for another provider's day said only in words: midnight Pacific is Google's", () => {
    const local = Object.assign(new Error('the local AI at http://localhost:11434/v1 answered 429: requests per day used up'), { status: 429, provider: 'local' });
    expect(limitOf(local, 'local', now)).toEqual({ kind: 'daily', waitMs: null, provider: 'local' });
  });

  it('names the AI chosen when the error names none, since the chain throws the limit that started it (PL-27)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const day = classifyGeminiError(google('GenerateRequestsPerDayPerProjectPerModel-FreeTier'));
      const refused = Object.assign(new Error('OpenRouter answered 400: this model does not take images'), { status: 400, provider: 'openrouter' });
      const thrown = await askWithChain({ ...base, ...router }, async (c) => {
        throw c.provider === 'openrouter' ? refused : day;
      }).catch((e: unknown) => e);
      expect(limitOf(thrown, 'gemini', now)).toEqual({ kind: 'daily', waitMs: msUntilPacificReset(now), provider: 'gemini' });
      // OpenRouter chosen, its own limit: named by the error, whatever the caller supposes.
      const routed = Object.assign(new Error('OpenRouter answered 429: Rate limit exceeded'), { status: 429, provider: 'openrouter', retryAfterMs: 9_000 });
      expect(limitOf(routed, 'gemini', now)).toMatchObject({ provider: 'openrouter' });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('follows a cause chain that loops back on itself without hanging, and is plain data that crosses to another thread as it is', () => {
    const looped: { message: string; status: number; cause?: unknown } = { message: 'quota', status: 429 };
    looped.cause = { message: 'again', cause: looped };
    const limit = limitOf(looped, 'gemini', now);
    expect(limit).toEqual({ kind: 'unknown', waitMs: null, provider: 'gemini' });
    expect(structuredClone(limit)).toEqual(limit);
  });
});

/*
 * The wave's review (W3R-3): Google resets a day's allowance at midnight in
 * Los Angeles, and the browser's count, 24 hours less the time since
 * midnight, is an hour out on the two days a year the clocks change. Node's
 * reading is on the zone's own calendar.
 */
describe("when Google's day ends, on the zone's own calendar", () => {
  const at = (iso: string) => new Date(iso);
  const hours = (ms: number) => ms / 3_600_000;

  it('is 22.5 hours off at half past midnight on the day the clocks go forward, where the old count said 23.5', () => {
    const now = at('2026-03-08T08:30:00Z');
    expect(hours(msUntilPacificReset(now))).toBe(22.5);
    expect(now.getTime() + msUntilPacificReset(now)).toBe(Date.parse('2026-03-09T07:00:00Z'));
    expect(hours(msUntilPacificMidnight(now))).toBe(23.5);
  });

  it('is 24.5 hours off at half past midnight on the day the clocks go back, where the old count said 23.5', () => {
    const now = at('2026-11-01T07:30:00Z');
    expect(hours(msUntilPacificReset(now))).toBe(24.5);
    expect(now.getTime() + msUntilPacificReset(now)).toBe(Date.parse('2026-11-02T08:00:00Z'));
    expect(hours(msUntilPacificMidnight(now))).toBe(23.5);
  });

  it('agrees with the old count on any other day, to the millisecond, and is never nothing at midnight itself', () => {
    for (const iso of ['2026-11-24T20:00:00.250Z', '2026-07-04T06:59:59.999Z', '2026-01-15T08:00:00Z', '2026-03-09T07:00:00Z']) {
      const now = at(iso);
      const reset = msUntilPacificReset(now);
      expect(reset, iso).toBe(msUntilPacificMidnight(now) - (now.getTime() % 1000));
      expect(reset, iso).toBeGreaterThan(0);
    }
    // At midnight itself the next reset is a whole day off.
    expect(hours(msUntilPacificReset(at('2026-01-15T08:00:00Z')))).toBe(24);
    // A minute before the clocks go forward's midnight, the reset is a minute off.
    expect(msUntilPacificReset(at('2026-03-08T07:59:00Z'))).toBe(60_000);
  });
});
