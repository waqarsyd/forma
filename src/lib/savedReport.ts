/**
 * The two shapes a saved project has, and the conversion between them.
 *
 * Signed out, a report is kept in `localStorage` as it exists in memory:
 * `timestamp` an ISO string, `messages` an array, `result` an object. Signed
 * in, it becomes a Firestore document: `timestamp` an epoch number, `messages`
 * and `result` JSON strings, plus a `userId`.
 *
 * That divergence is deliberate on both ends. `firestore.rules` pins the cloud
 * document to exactly six fields with those types — `isValidSavedReport` uses
 * `hasOnly` **and** `hasAll`, so a nested array cannot be written at all — and
 * a React state object has no business being re-parsed on every render.
 *
 * What was missing was anywhere that said so. The conversion lived inline in
 * two `App.tsx` branches several hundred lines apart, and nothing asserted they
 * agreed. The failure that guards against is not a bug that exists today; it is
 * one a future edit to either side introduces silently, and whose symptom is a
 * saved report that reopens blank rather than an error anyone can see.
 *
 * The payload types are deliberately opaque here. This module converts *shape*;
 * what a message or a result contains is `App.tsx`'s business, and importing
 * those types would drag the component's world into a file whose whole purpose
 * is to be reachable without it.
 */

/** A report as the app holds it, and as `localStorage` keeps it. */
export interface SavedReportLike<M = unknown, R = unknown> {
  id: string;
  name: string;
  /** ISO 8601. The list sorts on this. */
  timestamp: string;
  messages: M[];
  result: R | null;
}

/** A report as Firestore stores it — the exact shape `firestore.rules` allows. */
export interface StoredReportDocument {
  id: string;
  name: string;
  /** Epoch milliseconds. The rules bound this to 0 < t < 4102444800000. */
  timestamp: number;
  /** JSON. */
  messages: string;
  /** JSON. `null` is stored as the string "null", not as an empty string. */
  result: string;
  userId: string;
}

/** `firestore.rules` bounds `name` at 256 characters; the UI wants far less. */
const NAME_LIMIT = 30;

/**
 * The name shown in the projects list.
 *
 * Both save branches computed this separately, which is how the same report
 * saved signed out and signed in could have ended up under two different names.
 */
export function reportDisplayName(raw: string | undefined | null): string {
  const name = (raw ?? '').trim();
  if (!name) return 'Untitled Report';
  return name.length > NAME_LIMIT ? `${name.substring(0, NAME_LIMIT)}...` : name;
}

export function toFirestoreDocument<M, R>(
  report: SavedReportLike<M, R>,
  userId: string
): StoredReportDocument {
  return {
    id: report.id,
    name: reportDisplayName(report.name).substring(0, 256),
    timestamp: new Date(report.timestamp).getTime(),
    messages: JSON.stringify(report.messages),
    // Note this is "null" for an absent result, not "". The read side relies on
    // JSON.parse handling that; an empty string would be a parse error.
    result: JSON.stringify(report.result ?? null),
    userId,
  };
}

/** Where the signed-out copy lives. */
export const LOCAL_REPORTS_KEY = 'savedReports';

/**
 * Succeeded, or failed with something worth showing the user.
 *
 * This was an interface with an optional `message` for two commits, because
 * without strictness flags `!outcome.ok` did not narrow away the success arm
 * and every read of `message` was a type error. `strict` is on now (audit
 * ARC-004), so the shape that was always correct compiles: a failure carries a
 * message and a success cannot be read for one.
 */
export type LocalSaveOutcome = { ok: true } | { ok: false; message: string };

/**
 * Write the signed-out copy of the projects list.
 *
 * This was the **only** unguarded `localStorage.setItem` in the app. The others
 * write a panel width, a collapsed flag, a theme — small, bounded, and every
 * one of them inside a try/catch. This one writes reports carrying the user's
 * uploads inline as base64, which is the only write here that can plausibly
 * exhaust the quota, and it had no guard at all. The *delete* path writing this
 * same key did.
 *
 * Measured before fixing: four reports of 1.2 MB each threw
 * `QuotaExceededError: The 5000000-code unit storage quota has been exceeded`.
 * Because the call sat inside a `setSavedReports` updater, the exception
 * escaped into React instead of becoming a message — and the signed-in path
 * that refuses an oversized project points the user here, saying "Save Project
 * while signed out keeps it on this device".
 *
 * On failure the previously stored list is left exactly as it was. A save that
 * cannot complete must not also destroy what was already there — that would
 * turn "could not save this one" into losing all of them.
 */
export function saveReportsLocally<M, R>(reports: Array<SavedReportLike<M, R>>): LocalSaveOutcome {
  let previous: string | null = null;
  try {
    previous = localStorage.getItem(LOCAL_REPORTS_KEY);
  } catch {
    // Storage unreadable — private mode, or site data blocked. The write below
    // will fail too; there is simply nothing to restore.
  }

  try {
    localStorage.setItem(LOCAL_REPORTS_KEY, JSON.stringify(reports));
    return { ok: true };
  } catch {
    // Some browsers clear the key before throwing, so put back what was there.
    try {
      if (previous === null) localStorage.removeItem(LOCAL_REPORTS_KEY);
      else localStorage.setItem(LOCAL_REPORTS_KEY, previous);
    } catch {
      /* nothing more to be done */
    }

    return {
      ok: false,
      message:
        'There is not enough space left in this browser to save the project on this device. ' +
        'Uploaded images take up most of it — deleting an older project frees space, ' +
        'and signing in stores projects in your account instead.',
    };
  }
}

/**
 * Read the signed-out projects list.
 *
 * **This must not throw**, and until 2026-08-27 it could (audit DATA-002). All
 * three read sites were a bare `JSON.parse(localStorage.getItem(...) || '[]')`,
 * and one of them is a `useState` initialiser — so a corrupted entry did not
 * cost the user a panel, it threw during the first render and took the entire
 * application to the error boundary, with a message that says nothing about
 * storage. The only way out was clearing site data, which nobody would guess.
 *
 * The cloud side has had a strict contract since it existed: `firestore.rules`
 * pins six fields with types and bounds. This side had none at all, which is
 * backwards — it is the copy with no server-side authority behind it.
 *
 * Individual malformed entries are dropped and the rest are kept. Losing one
 * unreadable row is better than losing the list, and far better than losing the
 * app.
 */
export function loadReportsLocally<M = unknown, R = unknown>(): Array<SavedReportLike<M, R>> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LOCAL_REPORTS_KEY);
  } catch {
    return []; // storage blocked — private mode, or site data disabled
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.filter(isUsableReport) as Array<SavedReportLike<M, R>>;
}

/**
 * Enough of a report to list, open and delete.
 *
 * Deliberately loose about `messages` and `result`: an older build may have
 * stored a shape this one does not expect, and refusing to list a project
 * because its transcript looks unfamiliar would be worse than showing it. What
 * is required is what the list itself needs — an id to delete by, a name to
 * show, and a timestamp to sort on.
 */
function isUsableReport(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    typeof r.name === 'string' &&
    typeof r.timestamp === 'string' &&
    !Number.isNaN(new Date(r.timestamp).getTime())
  );
}

/** Parse or give up quietly — never throw, see `fromFirestoreDocument`. */
function parseOr<T>(json: string | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/**
 * Read a stored document back into a report.
 *
 * **This must not throw.** It runs inside an `onSnapshot` callback, which the
 * `try`/`catch` around the subscription does not cover — the callback fires
 * long after that block has returned. One malformed document would therefore
 * take out the entire projects panel rather than one row of it, and the user
 * would see every project disappear.
 *
 * The rules make a malformed document unwritable by any client, so this is
 * defence against a document that predates them or arrives another way. Bad
 * input degrades to an empty conversation and no result: the row still lists,
 * still carries its name, and can still be deleted.
 */
export function fromFirestoreDocument<M = unknown, R = unknown>(
  data: Partial<StoredReportDocument>
): SavedReportLike<M, R> {
  const millis = Number(data.timestamp);
  const timestamp = Number.isFinite(millis) && millis > 0 ? new Date(millis) : new Date(0);

  return {
    id: String(data.id ?? ''),
    name: String(data.name ?? ''),
    timestamp: timestamp.toISOString(),
    messages: parseOr<M[]>(data.messages, []),
    result: parseOr<R | null>(data.result, null),
  };
}
