/**
 * Which limit an AI met, and when it lifts (2026-11-24, the CLI and Forma
 * Designer work's wave 3; findings GAP3-2 and GAP3-5 of its design audit,
 * `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`).
 *
 * For a caller that holds the error itself: the MCP server's and the command
 * line's work, in its own thread (src/mcp/genJobs.ts), and the parks Node
 * keeps (src/mcp/modelParks.ts). No module the browser loads imports it. It
 * was written into lib/fallbackChain.ts first, and the wave's review found
 * that chunk carrying it to every visitor (877 bytes more, on every chat turn
 * and every generation): a module the browser imports at run time keeps
 * every export, used or not, so Node's reading of a limit has a module of
 * its own, which only Node reaches.
 *
 * Pure ASCII.
 */
import { isLimit } from './fallbackChain';
import { quotaKind, quotaWaitMs } from './geminiErrors';
import type { EffectiveProvider } from './aiProvider';

/** Which limit an AI met, and when it lifts. Plain data, so it crosses to another thread as it is. */
export type AiLimit = {
  /** The day's allowance, the minute's, or a limit that said neither. */
  kind: 'per-minute' | 'daily' | 'unknown';
  /** Milliseconds until it lifts, when the AI said so or the reset is known; null otherwise. */
  waitMs: number | null;
  /** The AI that met it. */
  provider: EffectiveProvider;
};

/** The AIs an error can name (lib/fallbackChain.ts asks them in this order). */
const PROVIDERS: readonly EffectiveProvider[] = ['gemini', 'openrouter', 'local'];

/**
 * A wait longer than this is not a minute's window: a limit that lifts only
 * later is the day's, to be stopped at rather than waited out. Google's own
 * stated waits are held to the same ten minutes (geminiErrors.ts).
 */
export const DAILY_RESET_MS = 10 * 60 * 1000;

type ErrorLike = {
  message?: string;
  status?: unknown;
  cause?: unknown;
  provider?: unknown;
  retryAfterMs?: unknown;
  rateLimit?: { remaining?: unknown; resetAt?: unknown } | null;
  /** The limit the provider's own answer named (services/compatClient.ts: OpenRouter's `limit_source`, or its words). */
  limitKind?: unknown;
};

/** The error and each cause under it, outermost first, every one once. */
function causeChain(err: unknown): ErrorLike[] {
  const chain: ErrorLike[] = [];
  for (let e = err; e && typeof e === 'object' && !chain.includes(e as ErrorLike) && chain.length < 8; e = (e as ErrorLike).cause) chain.push(e as ErrorLike);
  return chain;
}

/**
 * What a 429's headers say (services/compatClient.ts keeps them on the
 * error: OpenRouter's X-RateLimit-Remaining and -Reset, from the response or
 * from its body, and Retry-After), or null when it kept none. A window spent
 * (`remaining` 0, or not said) until a reset further off than
 * `DAILY_RESET_MS` is the day's; a shorter wait, the minute's.
 */
function fromHeaders(e: ErrorLike, now: number): { kind: AiLimit['kind']; waitMs: number } | null {
  const waits: number[] = [];
  if (typeof e.retryAfterMs === 'number' && e.retryAfterMs > 0) waits.push(e.retryAfterMs);
  const remaining = e.rateLimit?.remaining;
  const resetAt = e.rateLimit?.resetAt;
  if (typeof resetAt === 'number' && resetAt > now && (remaining === 0 || remaining === null || remaining === undefined)) waits.push(resetAt - now);
  if (!waits.length) return null;
  const waitMs = Math.max(...waits);
  return { kind: waitMs > DAILY_RESET_MS ? 'daily' : 'per-minute', waitMs };
}

/** The wall clock in Los Angeles at `at`, read as if it were UTC: its difference from `at` is the zone's offset there. */
function pacificWallClock(at: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(at))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/**
 * Milliseconds from `now` to the next midnight in Los Angeles, when Google
 * resets a day's allowance, on the zone's own calendar (the wave-3 review,
 * W3R-3). geminiErrors.ts `msUntilPacificMidnight` counts 24 hours less the
 * time gone since midnight, which on the two days a year the clocks change
 * is an hour out: on 2026-03-08 a park made at 00:30 lasted 23.5 hours where
 * Google reset after 22.5, and on 2026-11-01 one said 23.5 where it took
 * 24.5, so a batch would ask an hour early and spend a 429 a model. Here the
 * next day's date is taken in Los Angeles, its midnight placed at the zone's
 * offset at that instant, and the offset read again there, once, since a
 * change of offset falls at 2 in the morning and never moves midnight off
 * its day. The browser keeps the old count, whose only use there is a park
 * in memory and the hours a sentence rounds to; this is Node's, for the
 * limit a batch waits on and the parks it keeps on disk.
 */
export function msUntilPacificReset(now: Date = new Date()): number {
  const at = Math.floor(now.getTime() / 1000) * 1000;
  const wall = new Date(pacificWallClock(at));
  const nextMidnight = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1);
  const guess = nextMidnight - (pacificWallClock(nextMidnight) - nextMidnight);
  const reset = nextMidnight - (pacificWallClock(guess) - guess);
  return reset - now.getTime();
}

/**
 * The limit an error is, worked out from the error itself and every cause
 * under it, as `isLimit` reads them, or null when it is not one. For a caller
 * that holds the error (the MCP server's and the command line's work, in its
 * own thread: src/mcp/genJobs.ts), never one that has only its words: the
 * classified error's sentence says neither the kind of a minute's limit nor
 * its wait, which only the provider's own error, its cause, carries.
 *
 * - **Which AI**: the one a compatible provider's error names
 *   (compatClient.ts sets `provider`), else `chosen`, the AI the request was
 *   asked of: the chain throws the limit that started it (PL-27), so the AI
 *   chosen is the one that met it. A Gemini error names none.
 * - **Which limit, and the wait**: the limit the provider's answer named
 *   first, when it named one (OpenRouter's body: `limit_source`, or "per-day"
 *   and "per-min" in its words; `limitKind` on the error), with the wait its
 *   headers give; else a 429's headers, when the provider sent them
 *   (OpenRouter, as HTTP headers or in its body); else the words of the
 *   deepest error that names a kind (`quotaKind`: Google's quota id, "per
 *   day", "daily", "per minute", or a stated wait), with its wait: Google's
 *   RetryInfo, or for Google's daily limit the time to midnight Pacific, when
 *   it resets (`msUntilPacificReset`). Another provider's daily limit said
 *   only in words has no known reset (null). Neither said: `unknown`, with
 *   no wait.
 * - A classified daily limit is one even when only its words are left, which
 *   `isLimit` alone misses ("Today's free daily allowance ... is used up"
 *   names no quota: the browser's Batch met it on 2026-11-10).
 *
 * Plain data, so it crosses to another thread as it is.
 */
export function limitOf(err: unknown, chosen: EffectiveProvider = 'gemini', now: Date = new Date()): AiLimit | null {
  const chain = causeChain(err);
  if (!chain.length || !(isLimit(err) || chain.some((e) => quotaKind(e) === 'daily'))) return null;
  const named = chain.find((e) => (PROVIDERS as readonly unknown[]).includes(e.provider))?.provider as EffectiveProvider | undefined;
  const provider = named ?? chosen;
  const stated = chain.find((e) => e.limitKind === 'daily' || e.limitKind === 'per-minute')?.limitKind as 'daily' | 'per-minute' | undefined;
  for (const e of chain) {
    const said = fromHeaders(e, now.getTime());
    if (said) return { kind: stated ?? said.kind, waitMs: said.waitMs, provider };
  }
  if (stated) return { kind: stated, waitMs: null, provider };
  for (const e of [...chain].reverse()) {
    const kind = quotaKind(e);
    if (kind === 'unknown') continue;
    const waitMs = kind === 'daily' ? (provider === 'gemini' ? msUntilPacificReset(now) : null) : quotaWaitMs(e, now) ?? null;
    return { kind, waitMs, provider };
  }
  return { kind: 'unknown', waitMs: null, provider };
}
