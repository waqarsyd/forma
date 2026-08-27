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
