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

/** Storage, in the parts this module uses. */
export type ModelStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/*
 * Where the choice is kept beyond the module's own copy (2026-11-24, the MCP
 * work's wave 7, findings NODE-7 and TST-12): the browser's sessionStorage
 * and localStorage, reached only when a reader or writer below runs, as
 * always. A Node process has neither, and Node 26 defines both and throws on
 * a read without a file, so every new MCP server probed five models again,
 * out of the per-model daily allowances a free key lives on. The MCP server
 * keeps the day's choice in a file of Forma's own instead, outside the
 * repository and the user's project, and the session's in memory alone
 * (src/mcp/nodeGeneration.ts).
 */
let sessionStore: () => ModelStorage | null = () => sessionStorage;
let dayStore: () => ModelStorage | null = () => localStorage;

/**
 * Keep the choice in these, never the browser's storage: the session's (null:
 * memory only) and the day's; and a limit's parks in `parks` as well as in
 * memory (the cooldown section below), where one is handed in.
 */
export function keepModelChoiceIn(stores: { session: ModelStorage | null; day: ModelStorage | null; parks?: ParkStore | null }): void {
  sessionStore = () => stores.session;
  dayStore = () => stores.day;
  parkStore = stores.parks ?? null;
}

/*
 * Who is told when the cache moves (2026-11-09). The chat box's model menu is
 * read from this cache, and the key check fills it after the key was typed, so
 * until then the menu said nothing about the key's models until a reload. A
 * listener runs after the change, never during a render: every writer here is
 * a request, a check or an effect.
 */
const listeners = new Set<() => void>();

/** Calls `listener` whenever the cached model or model list changes; returns the unsubscribe. */
export function onModelCacheChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function announce(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* one listener failing does not stop the others */
    }
  }
}

/** Exported so the debug console can report the detected model without re-probing. */
export function readCachedModel(): string | null {
  if (resolvedModel) return resolvedModel;
  try {
    return sessionStore()?.getItem(MODEL_CACHE_KEY) ?? null;
  } catch {
    return null; // Node, or storage disabled
  }
}

export function cacheModel(model: string, usable?: string[]): void {
  resolvedModel = model;
  try {
    sessionStore()?.setItem(MODEL_CACHE_KEY, model);
  } catch {
    /* in-memory copy still applies for this page */
  }
  if (usable) {
    resolvedModelSet = usable;
    try {
      sessionStore()?.setItem(MODEL_SET_CACHE_KEY, JSON.stringify(usable));
    } catch {
      /* in-memory copy still applies for this page */
    }
  }
  announce();
}

/**
 * Models this key can call, in preference order, or `null` if that has not been
 * established this session. Never probes: a caller that needs it to be
 * populated should have gone through `resolveModel` first.
 */
export function readCachedModelSet(): string[] | null {
  if (resolvedModelSet) return resolvedModelSet;
  try {
    const raw = sessionStore()?.getItem(MODEL_SET_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.every((m) => typeof m === 'string') ? parsed : null;
  } catch {
    return null; // Node, storage disabled, or a corrupt entry
  }
}

/**
 * Drop the cached choice — called when a model 404s mid-flight, or the key
 * changes. A store's kept parks stay: they are a key's, by its tag, so a
 * 404's re-detect lays them in again (`restoreParks`) and another key's tag
 * has none of them.
 */
export function clearCachedModel(): void {
  resolvedModel = null;
  resolvedModelSet = null;
  coolingUntil.clear();
  try {
    const session = sessionStore();
    session?.removeItem(MODEL_CACHE_KEY);
    session?.removeItem(MODEL_SET_CACHE_KEY);
    dayStore()?.removeItem(DAILY_KEY);
  } catch {
    /* nothing to clear */
  }
  announce();
}

/* ------------------------------------------------------------------ *
 * A day's choice, across tabs (2026-11-02)
 *
 * The session cache above made every new tab probe every model again, a
 * request on each out of the per-model daily allowances a free key lives on.
 * The choice now also lasts a day in localStorage, for the same key only: it
 * is stored with a 32-bit fingerprint of the key (FNV-1a), which tells two
 * keys apart and cannot give the key back. Clearing the cache clears it too.
 * ------------------------------------------------------------------ */

const DAILY_KEY = 'geminiModel:day';
export const DAILY_TTL_MS = 24 * 60 * 60 * 1000;

/** A key's fingerprint: FNV-1a over its characters, as eight hex digits. */
export function keyTag(apiKey: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < apiKey.length; i++) {
    h ^= apiKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function cacheDailyModel(apiKey: string, model: string, usable: string[], now: number = Date.now()): void {
  try {
    dayStore()?.setItem(DAILY_KEY, JSON.stringify({ tag: keyTag(apiKey.trim()), model, usable, at: now }));
  } catch {
    /* storage disabled: the session cache still applies */
  }
}

/** The model chosen for this key in the last day, made this page's choice too; null otherwise. */
export function readDailyModel(apiKey: string, now: number = Date.now()): string | null {
  try {
    const saved = JSON.parse(dayStore()?.getItem(DAILY_KEY) || 'null') as { tag?: string; model?: string; usable?: unknown; at?: number } | null;
    if (!saved || saved.tag !== keyTag(apiKey.trim()) || typeof saved.model !== 'string' || typeof saved.at !== 'number' || now - saved.at > DAILY_TTL_MS) return null;
    const usable = Array.isArray(saved.usable) && saved.usable.every((m) => typeof m === 'string') ? (saved.usable as string[]) : [saved.model];
    cacheModel(saved.model, usable);
    return saved.model;
  } catch {
    return null;
  }
}

/**
 * The model for a small call (the chat turn, a clarification, an expression,
 * test data): a Flash-Lite this key can call, when the probe found one, else
 * `fallback` (2026-11-02). Each model has its own free daily allowance, so the
 * small calls drawing on Flash-Lite's leaves the main model's for reports.
 */
export function lightModel(fallback: string): string {
  const set = readCachedModelSet();
  return set?.find((m) => /flash-lite/i.test(m)) ?? fallback;
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
 *
 * A limit's park (a 429, through `noteModelLimited`) is the one kept beyond
 * memory, and only where a store is handed in (2026-11-24, the CLI and Forma
 * Designer work's wave 3, GAP3-1): Node's, a file in Forma's own folder
 * (src/mcp/modelParks.ts). A limit is a fact about the key, for the minute
 * or until midnight Pacific; the MCP server's thread ends on a cancellation,
 * a deadline or a crash, and the command line is to make each file of a
 * batch in a thread of its own, so with memory alone a new thread began on
 * the model the last one had spent, a request each out of the file's budget.
 * Each one is kept as it happens, by the key's tag and never the key, and
 * laid into memory again whenever a model is resolved for that key
 * (`restoreParks`), so a thread started afresh honours what one before it
 * learned. An overload's park stays in memory, as above. The browser hands
 * in no store: there both are memory-only and per-tab, as they always were.
 * ------------------------------------------------------------------ */

/** Long enough to outlast a burst, short enough that recovery is not waited on. */
export const OVERLOAD_COOLDOWN_MS = 60_000;

/** Model → the instant it becomes worth trying again. */
const coolingUntil = new Map<string, number>();

/**
 * Park a model for a while.
 *
 * `forMs` exists because the two reasons carry different information. A 503 is
 * capacity and says nothing about when it returns, so it gets the default
 * minute. A 429 is the rate limit and Google states the wait exactly — "Please
 * retry in 2.049s", or 54s — and honouring that number is the difference
 * between waiting the right amount and burning another request to be told
 * again. On the free tier's five-per-minute that request is 20% of the budget.
 */
export function noteModelOverloaded(
  model: string,
  now: number = Date.now(),
  forMs: number = OVERLOAD_COOLDOWN_MS
): void {
  coolingUntil.set(model, now + forMs);
}

/** A limit's park as a store keeps it: the model, which limit (geminiErrors.ts `quotaKind`), and the instant it lifts. */
export type ModelPark = { model: string; kind: 'daily' | 'per-minute' | 'unknown'; until: number };

/** Where a key's limit parks are kept beyond memory, by the key's tag: Node's file (src/mcp/modelParks.ts); the browser has none. */
export interface ParkStore {
  /** The parks kept for this tag that have not lifted by `now`. */
  read(tag: string, now: number): ModelPark[];
  /** Keep one more, as it happens. */
  add(tag: string, park: ModelPark, now: number): void;
  /**
   * The instant a day's limit lifts, where the store's side knows it better
   * than the wait it is handed: Node's reads midnight Pacific on the zone's
   * own calendar, which the browser's count misses by an hour on the two days
   * a year the clocks change (src/mcp/modelParks.ts, *The day's reset*).
   */
  dailyReset?(now: number): number;
}

let parkStore: ParkStore | null = null;

/**
 * Park a model on a limit (a 429): in memory exactly as `noteModelOverloaded`
 * parks it, and in the store when one is kept, by the key's tag (the section's
 * header). A store that fails leaves the park in memory, as before it existed.
 * Where the store says when a day's limit lifts (`dailyReset`), the park is
 * kept until then, in memory as in the store; with no store, as in the
 * browser, nothing here differs from an overload's park.
 */
export function noteModelLimited(model: string, apiKey: string, kind: ModelPark['kind'], forMs: number | undefined, now: number = Date.now()): void {
  noteModelOverloaded(model, now, forMs);
  if (!parkStore) return;
  try {
    const until = kind === 'daily' && parkStore.dailyReset ? parkStore.dailyReset(now) : now + (forMs ?? OVERLOAD_COOLDOWN_MS);
    coolingUntil.set(model, until);
    parkStore.add(keyTag(apiKey.trim()), { model, kind, until }, now);
  } catch {
    /* kept in memory still */
  }
}

/** The parks kept for this key beyond memory and not yet lifted; none without a store, as in the browser. */
export function keptParks(apiKey: string, now: number = Date.now()): ModelPark[] {
  try {
    return parkStore?.read(keyTag(apiKey.trim()), now) ?? [];
  } catch {
    return []; // a store that will not read keeps nothing
  }
}

/** Lays this key's kept parks into memory, each for as long as it lasts: a thread started afresh skips what one before it learned. */
export function restoreParks(apiKey: string, now: number = Date.now()): void {
  if (!parkStore) return;
  for (const park of keptParks(apiKey, now)) if (park.until > (coolingUntil.get(park.model) ?? 0)) coolingUntil.set(park.model, park.until);
}

/** Is this model parked right now? */
export function isModelInCooldown(model: string, now: number = Date.now()): boolean {
  const until = coolingUntil.get(model);
  if (until === undefined) return false;
  if (now < until) return true;
  // Expired: forget it, so the map cannot grow without bound across a long
  // session and the model competes on equal terms again.
  coolingUntil.delete(model);
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
