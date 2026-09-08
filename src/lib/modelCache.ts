/**
 * The session's resolved model, remembered so a page does not re-probe.
 *
 * ## Why this is its own module
 *
 * It lived in `geminiService.ts` until 2026-09-04, and moved out for exactly the
 * reason `lib/firestoreOps.ts` stayed put when Firebase was deferred: it is the
 * one piece of that service the eager bundle genuinely needs, and leaving it
 * there would have dragged the rest back in.
 *
 * `App.tsx` clears the cache from a `useEffect` when the key changes -- a
 * synchronous callback. With `clearCachedModel` behind the dynamic import it
 * would have had to become `void loadGemini().then(m => m.clearCachedModel())`,
 * which trades a 19 kB prompt for a race: the clear lands a tick later than the
 * key change that caused it, and a generation started in between would use a
 * model resolved for the previous key. Sixty lines of `sessionStorage` access
 * with no dependencies do not belong behind a chunk boundary.
 *
 * `geminiService.ts` re-exports `readCachedModel` and `clearCachedModel` so
 * `modelResolution.test.ts` keeps importing them from where they have always
 * been; the module state lives here, and ES modules are singletons, so both
 * routes reach the same values.
 *
 * ## In-memory first, storage second
 *
 * Both readers prefer the module-level copy and fall back to `sessionStorage`,
 * and every access is wrapped: storage throws in Node and in a browser with
 * site data disabled, and a model choice is not worth failing a render over.
 */

const MODEL_CACHE_KEY = 'geminiModel:session';

/**
 * Every model the probe found this key *can* call, not just the winner. The
 * probes already ran and their results were being thrown away; keeping them is
 * what lets an overloaded generation fall back to a different model instead of
 * failing (see the 503 path in `analyzeReportDesign`).
 */
const MODEL_SET_CACHE_KEY = 'geminiModels:session';

let resolvedModel: string | null = null;
let resolvedModelSet: string[] | null = null;

/** Exported so the debug console can report the detected model without re-probing. */
export function readCachedModel(): string | null {
  if (resolvedModel) return resolvedModel;
  try {
    return sessionStorage.getItem(MODEL_CACHE_KEY);
  } catch {
    return null; // Node, or storage disabled
  }
}

export function cacheModel(model: string, usable?: string[]): void {
  resolvedModel = model;
  try {
    sessionStorage.setItem(MODEL_CACHE_KEY, model);
  } catch {
    /* in-memory copy still applies for this page */
  }
  if (usable) {
    resolvedModelSet = usable;
    try {
      sessionStorage.setItem(MODEL_SET_CACHE_KEY, JSON.stringify(usable));
    } catch {
      /* in-memory copy still applies for this page */
    }
  }
}

/**
 * Models this key can call, in preference order, or `null` if that has not been
 * established this session. Never probes: a caller that needs it to be
 * populated should have gone through `resolveModel` first.
 */
export function readCachedModelSet(): string[] | null {
  if (resolvedModelSet) return resolvedModelSet;
  try {
    const raw = sessionStorage.getItem(MODEL_SET_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.every((m) => typeof m === 'string') ? parsed : null;
  } catch {
    return null; // Node, storage disabled, or a corrupt entry
  }
}

/** Drop the cached choice — called when a model 404s mid-flight, or the key changes. */
export function clearCachedModel(): void {
  resolvedModel = null;
  resolvedModelSet = null;
  overloadedAt.clear();
  try {
    sessionStorage.removeItem(MODEL_CACHE_KEY);
    sessionStorage.removeItem(MODEL_SET_CACHE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/* ------------------------------------------------------------------ *
 * Overload cooldown
 *
 * A model that has just returned 503 is out of capacity, and both request
 * paths already handle that *within* one request: retry twice, then move to
 * the next model the key can call. Neither caches the fallback, deliberately —
 * `analyzeReportDesign` says why, and it is right: the preferred model should
 * be tried again once capacity returns, not abandoned for the session because
 * it was busy for ten seconds.
 *
 * The gap was between requests. During a sustained outage every new turn
 * started again on the model Google had just refused, spent both retries and
 * roughly six seconds of backoff rediscovering that, and only then fell back.
 * Reported from a real session on 2026-09-08 whose console carried the same
 * "stayed overloaded ... falling back" line once per message.
 *
 * A short cooldown is the middle of those two positions and keeps the stated
 * intent: the model is skipped while it is known to be busy, and tried first
 * again as soon as the window passes. It is memory-only and per-tab — this is
 * a fact about the last minute, not about the key, and writing it to
 * `sessionStorage` would carry a stale outage into a reload.
 * ------------------------------------------------------------------ */

/** Long enough to outlast a burst, short enough that recovery is not waited on. */
export const OVERLOAD_COOLDOWN_MS = 60_000;

const overloadedAt = new Map<string, number>();

/** Record that a model exhausted its retries with an overload. */
export function noteModelOverloaded(model: string, now: number = Date.now()): void {
  overloadedAt.set(model, now);
}

/** Was this model refused for capacity recently enough to skip it for now? */
export function isModelInCooldown(model: string, now: number = Date.now()): boolean {
  const at = overloadedAt.get(model);
  if (at === undefined) return false;
  if (now - at < OVERLOAD_COOLDOWN_MS) return true;
  // Expired: forget it, so the map cannot grow without bound across a long
  // session and the model competes on equal terms again.
  overloadedAt.delete(model);
  return false;
}

/**
 * Which model a new request should start on.
 *
 * `preferred` unless it is cooling down and something else is available. Falls
 * back to `preferred` when every candidate is cooling down — better to retry a
 * busy model than to refuse to send anything, and the per-request fallback
 * still runs from there.
 */
export function startingModel(
  preferred: string,
  candidates: string[] | null,
  now: number = Date.now()
): string {
  if (!isModelInCooldown(preferred, now)) return preferred;
  const free = (candidates ?? []).find((m) => m !== preferred && !isModelInCooldown(m, now));
  return free ?? preferred;
}
