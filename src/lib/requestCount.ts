/**
 * How many requests each Gemini model has been sent today (2026-11-05), for
 * the chat box's model picker, as Gemini shows the model in its box. The
 * free tier's limits are per model per day and reset at midnight Pacific
 * time (`msUntilPacificMidnight` in `geminiErrors.ts`), so the count is kept
 * per Pacific day and starts again at zero on the next.
 *
 * Counted where every Gemini request leaves (`clientFor` in
 * `geminiService.ts`), in this browser only: another tab or device using the
 * same key is not seen, so the number is "sent from here", never "left on the
 * key". Google does not say what is left. Kept in localStorage, since a day
 * outlasts a tab; it holds model names and counts, nothing of the key.
 */

const KEY = 'forma:requestsToday';

/** The calendar day in Pacific time, as YYYY-MM-DD. */
export function pacificDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

interface Stored {
  day: string;
  counts: Record<string, number>;
}

function read(storage: Pick<Storage, 'getItem'>, now: Date): Record<string, number> {
  try {
    const stored = JSON.parse(storage.getItem(KEY) ?? 'null') as Stored | null;
    return stored && stored.day === pacificDay(now) && stored.counts && typeof stored.counts === 'object' ? stored.counts : {};
  } catch {
    return {};
  }
}

/**
 * The browser's localStorage, or null where there is none: a test under
 * node, a worker. The service counts on every request, so this must never
 * throw (the first draft defaulted to `localStorage` itself, and 41 of the
 * service's node tests failed on the ReferenceError).
 */
function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Requests sent from this browser today, by model. */
export function requestsToday(storage: Pick<Storage, 'getItem'> | null = browserStorage(), now: Date = new Date()): Record<string, number> {
  return storage ? { ...read(storage, now) } : {};
}

/** One more request to `model` today. A storage that refuses changes nothing. */
export function noteRequest(model: string | undefined, storage: Pick<Storage, 'getItem' | 'setItem'> | null = browserStorage(), now: Date = new Date()): void {
  if (!model || !storage) return;
  const counts = read(storage, now);
  counts[model] = (counts[model] ?? 0) + 1;
  try {
    storage.setItem(KEY, JSON.stringify({ day: pacificDay(now), counts } satisfies Stored));
  } catch {
    /* storage blocked or full: the count is a courtesy */
  }
}
