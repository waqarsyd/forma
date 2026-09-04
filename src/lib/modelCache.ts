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
  try {
    sessionStorage.removeItem(MODEL_CACHE_KEY);
    sessionStorage.removeItem(MODEL_SET_CACHE_KEY);
  } catch {
    /* nothing to clear */
  }
}
