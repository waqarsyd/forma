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
  /**
   * Listed from the account's index, its content not fetched (2026-11-08,
   * site audit item 63): `messages` is empty and `result` null until the
   * project is opened, so nothing may write this entry back as a project.
   */
  stub?: boolean;
  /** The index's search text, for a listed project's search before it is opened. */
  search?: string;
  /** How many messages it holds, for the row's count before it is opened. */
  notes?: number;
}

/**
 * One project in the account's index, `users/{uid}/reportIndex/{id}`
 * (2026-11-08, site audit item 63): what the list shows and searches, without
 * the conversation, the images or the report. The list listened to the whole
 * projects, so every visit downloaded every project in full, images
 * included, and every autosave (about 1 MB a turn) went to every open tab;
 * on the free plan's daily egress that is the first limit a real account
 * meets. Written beside the project on every save.
 */
export interface StoredReportIndex {
  id: string;
  name: string;
  /** Epoch milliseconds, as the project's. */
  timestamp: number;
  /** What a search reads: the person's words and Forma's questions, capped. */
  search: string;
  /** How many messages the conversation holds, which the list's row shows. */
  notes: number;
  userId: string;
}

/** `firestore.rules` bounds the index's search text at this many characters. */
export const SEARCH_TEXT_LIMIT = 4000;

/** The words of a conversation a project search matches: the person's messages and Forma's questions. */
export function searchTextOf(messages: readonly unknown[]): string {
  const parts: string[] = [];
  for (const raw of messages) {
    const m = raw as { role?: unknown; text?: unknown; clarify?: { questions?: { question?: unknown }[] } };
    if (m?.role === 'user' && typeof m.text === 'string') parts.push(m.text);
    for (const q of m?.clarify?.questions ?? []) if (typeof q?.question === 'string') parts.push(q.question);
  }
  return parts.join('\n').slice(0, SEARCH_TEXT_LIMIT);
}

/** The index entry for a project as it is saved. */
export function toIndexDocument<M, R>(report: SavedReportLike<M, R>, userId: string): StoredReportIndex {
  const millis = new Date(report.timestamp).getTime();
  return {
    id: report.id,
    // The name exactly as the project's own document stores it (toFirestoreDocument).
    name: reportDisplayName(report.name).substring(0, 256),
    timestamp: Number.isFinite(millis) && millis > 0 ? millis : Date.now(),
    search: report.stub ? (report.search ?? '').slice(0, SEARCH_TEXT_LIMIT) : searchTextOf(report.messages),
    notes: report.stub ? Math.max(0, Math.floor(report.notes ?? 0)) : report.messages.length,
    userId,
  };
}

/** A listed project from its index entry. Never throws, as `fromFirestoreDocument` never does. */
export function fromIndexDocument<M = unknown, R = unknown>(data: Partial<StoredReportIndex>): SavedReportLike<M, R> {
  const millis = Number(data.timestamp);
  const timestamp = Number.isFinite(millis) && millis > 0 ? new Date(millis) : new Date(0);
  return {
    id: String(data.id ?? ''),
    name: String(data.name ?? ''),
    timestamp: timestamp.toISOString(),
    messages: [],
    result: null,
    stub: true,
    search: typeof data.search === 'string' ? data.search : '',
    notes: Number.isFinite(Number(data.notes)) ? Math.max(0, Math.floor(Number(data.notes))) : 0,
  };
}

/**
 * The list from the index, keeping a project's content where it is already
 * here and unchanged (the same save), and newest first.
 */
export function mergeIndexed<M, R>(rows: ReadonlyArray<SavedReportLike<M, R>>, before: ReadonlyArray<SavedReportLike<M, R>>): Array<SavedReportLike<M, R>> {
  const held = new Map(before.filter((r) => !r.stub).map((r) => [r.id, r]));
  return rows
    .map((row) => {
      const full = held.get(row.id);
      return full && full.timestamp === row.timestamp ? { ...full, name: row.name } : row;
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * What the Projects panel says, signed in, while projects made in this
 * browser before signing in are kept here and not in the account
 * (2026-11-11, the full audit's SA-04). Adding them is
 * `copyProjectsToAccount` in lib/projectExport.ts, which loads when asked.
 */
export function deviceProjectsLine(count: number): string {
  return count === 1
    ? '1 project is saved in this browser, not in your account.'
    : `${count} projects are saved in this browser, not in your account.`;
}

/**
 * A database refusal in words the person can act on (2026-11-11, the full
 * audit's SA-21), or null for any other failure, which keeps the caller's
 * own sentence. Every save failure said "try again in a moment", which is
 * untrue for both of these: the free plan's daily allowance does not come
 * back in a moment, and a refused sign-in does not get better by retrying.
 * `permission-denied` is read on the person's own paths only, which are the
 * callers of this, where the rules refuse only a sign-in the database no
 * longer accepts (a token from before App Check, or one gone stale).
 *
 * `saving` is the open project's own save, the one call that retries with
 * the next change; every other caller (the list, opening, renaming,
 * deleting, sharing) is told to try again after the reset instead
 * (2026-11-11, the SA-21 review: they were all told their project saves).
 */
export function plainFirestoreRefusal(err: unknown, { saving = false }: { saving?: boolean } = {}): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'resource-exhausted') {
    return saving
      ? "Forma's free database allowance for today is used up. Your project is still open here, and it saves with your next change once the allowance resets at midnight Pacific time."
      : "Forma's free database allowance for today is used up; try again after midnight Pacific time.";
  }
  if (code === 'permission-denied') return 'Your sign-in needs refreshing; sign out and in again.';
  return null;
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

/**
 * What a save of the open session keeps, as one string (2026-11-05): two
 * equal signatures mean nothing a save records has changed. The workspace
 * saves on its own when this moves and a turn has settled, as ChatGPT keeps
 * every conversation, and the Save button reads "Saved" while it matches
 * the last save.
 *
 * The REPX and every message's words are hashed rather than measured,
 * because dragging a control from x=10 to x=20 changes neither length.
 * Pictures are covered by the message ids, which are new for every message.
 * The result's timestamp is left out on purpose: a reloaded project gives it
 * back as a string where the session held a Date, and the same report must
 * sign the same.
 */
export function sessionSignature(
  messages: ReadonlyArray<{ id: string; text: string; rating?: string; error?: string; clarify?: { answered: boolean } }>,
  result: { title?: string; content?: string; repxContent?: string } | null,
): string {
  const parts = messages.map((m) => `${m.id}|${hash(m.text)}|${m.rating ?? ''}|${m.error ? 'e' : ''}|${m.clarify ? (m.clarify.answered ? 'a' : 'q') : ''}`);
  const report = result ? `${result.title ?? ''}|${hash(result.content ?? '')}|${hash(result.repxContent ?? '')}` : 'none';
  return `${parts.join(';')}#${report}`;
}

/** FNV-1a over UTF-16 code units, as eight hex digits: cheap, stable, not a security hash. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * A project's name (2026-11-05): kept once it has one, so a name chosen
 * later is not undone by the next save; an untitled one takes the report's
 * title, or else the first thing the person said, as ChatGPT names a chat.
 *
 * A name taken from the first words stands in until there is a report
 * (2026-11-07, agent audit item 95): a project that began with "hello" was
 * still called "hello" holding an invoice. Once a report has a title, a name
 * that is still exactly the first words gives way to it; one the person typed
 * is theirs and stays.
 */
export function projectName(existing: string | undefined, title: string | undefined, firstWords: string | undefined): string {
  const fromWords = firstWords?.trim() ? reportDisplayName(firstWords.trim().split('\n')[0]) : undefined;
  const standIn = !existing || existing === 'Untitled Report' || (!!title?.trim() && existing === fromWords);
  if (!standIn) return existing!;
  return reportDisplayName(title?.trim() || firstWords?.trim().split('\n')[0]);
}

/**
 * The projects as the list shows them (2026-11-05): pinned first, in the
 * order they were saved, then the rest; archived ones only when the archive
 * is open, and then only they. Pins and the archive are kept on this device
 * (`readIdList`), at the owner's choice, so they need no change to the
 * shape `firestore.rules` pins; a name syncs, since `name` is already one of
 * the six fields.
 */
export function arrangeProjects<T extends { id: string }>(reports: readonly T[], pinned: readonly string[], archived: readonly string[], showArchived: boolean): T[] {
  const archive = new Set(archived);
  const pins = new Set(pinned);
  const shown = reports.filter((r) => archive.has(r.id) === showArchived);
  return [...shown.filter((r) => pins.has(r.id)), ...shown.filter((r) => !pins.has(r.id))];
}

/** A list of project ids kept on this device; an unreadable one is empty. */
export function readIdList(key: string, storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): string[] {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** The same list written back; a storage that refuses keeps it for the page. */
export function writeIdList(key: string, ids: readonly string[], storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try {
    storage?.setItem(key, JSON.stringify([...new Set(ids)]));
  } catch {
    /* blocked or full */
  }
}

/** `id` added to the list, or taken out when it is there. */
export const toggleId = (ids: readonly string[], id: string): string[] => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

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

/**
 * Where the signed-out copy lived until 2026-11-11 (the full audit's PR-15),
 * and where it still lives in a browser with no IndexedDB. Since then the
 * projects are kept in IndexedDB (lib/projectStore.ts), which moves this
 * key's list there once and removes it: local storage's five megabytes held
 * about four projects with pictures, and every save rewrote all of them.
 */
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
 * that refuses an oversized project points the user here, saying "Save while
 * signed out keeps it on this device" ("Save Project" until 2026-11-06, the
 * button's name before it became Save).
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

    return { ok: false, message: DEVICE_FULL };
  }
}

/** What a save that the browser has no room for says, from either store (lib/projectStore.ts). */
export const DEVICE_FULL =
  'There is not enough space left in this browser to save the project on this device. ' +
  'Uploaded images take up most of it — deleting an older project frees space, ' +
  'and signing in stores projects in your account instead.';

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
export function isUsableReport(value: unknown): boolean {
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
