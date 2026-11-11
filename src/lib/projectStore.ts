/**
 * The projects saved in this browser while signed out, kept in IndexedDB
 * (2026-11-11, the full audit's PR-15, built in batch BW2).
 *
 * They were one JSON string under `savedReports` in local storage, which is
 * five megabytes for the whole site and synchronous: four projects with
 * pictures filled it, and every autosave rewrote every project, pictures and
 * all, on the main thread. IndexedDB holds far more, writes off the page's
 * thread, and keeps each project as its own record, so a save writes the one
 * project that changed.
 *
 * - **Two stores.** `projects` holds each project under its id; `order` holds
 *   the list's order as one array of ids under `ids`, since the list is newest
 *   first and a save moves its project to the top.
 * - **Operations, not lists.** App asks for a project put (at the top, or
 *   where it was), projects deleted, or the device's list read. Each runs in
 *   one transaction that reads the stored order and writes the new one, so two
 *   saves close together, or two tabs, cannot write back a list that has lost
 *   the other's project, as rewriting the whole list could.
 * - **A failed write changes nothing.** A transaction that fails (the browser
 *   out of room) is rolled back whole, so "could not save this one" never
 *   costs the projects already kept, as `saveReportsLocally` promised.
 * - **Moved once.** The first read finds the old local storage list, adds the
 *   projects it does not hold yet, and removes the key once they are stored.
 * - **No IndexedDB** (a private window in some browsers, storage blocked): the
 *   same operations run on the local storage list, as before.
 *
 * Kept in this browser alone, and not deleted by a sign-out: these are the
 * signed-out person's own projects, as the local storage list was. The privacy
 * policy names the store (LegalPage.tsx, legalDisclosure.test.ts).
 */
import {
  DEVICE_FULL,
  LOCAL_REPORTS_KEY,
  isUsableReport,
  loadReportsLocally,
  saveReportsLocally,
  type LocalSaveOutcome,
  type SavedReportLike,
} from './savedReport';

export const PROJECTS_DB = 'forma-projects';
const PROJECTS = 'projects';
const ORDER = 'order';
const ORDER_RECORD = 'ids';

let opening: Promise<IDBDatabase | null> | null = null;

/** The database, opened once; null where IndexedDB is missing or refuses. */
function database(): Promise<IDBDatabase | null> {
  if (!opening) {
    opening = new Promise((resolve) => {
      let req: IDBOpenDBRequest;
      try {
        if (typeof indexedDB === 'undefined') return resolve(null);
        req = indexedDB.open(PROJECTS_DB, 1);
      } catch {
        return resolve(null);
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS);
        if (!db.objectStoreNames.contains(ORDER)) db.createObjectStore(ORDER);
      };
      req.onsuccess = () => {
        const db = req.result;
        // A later version opened in another tab: let it, and open again next time.
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }
  return opening;
}

/** Forgets the open connection, for a test's fresh IndexedDB. */
export function resetProjectStore(): void {
  void opening?.then((db) => db?.close());
  opening = null;
}

/** The ids in the stored order, then any project the order does not name, newest first. */
function arranged<M, R>(records: SavedReportLike<M, R>[], order: unknown): SavedReportLike<M, R>[] {
  const ids = Array.isArray(order) ? order.filter((x): x is string => typeof x === 'string') : [];
  const byId = new Map(records.map((r) => [r.id, r]));
  const listed = ids.map((id) => byId.get(id)).filter((r): r is SavedReportLike<M, R> => !!r);
  const named = new Set(ids);
  const rest = records.filter((r) => !named.has(r.id)).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return [...listed, ...rest];
}

/**
 * Runs `work` in one read-write transaction over both stores, with the stored
 * order, and writes back the order it returns. Resolves once it is on disk.
 */
function change(db: IDBDatabase, work: (projects: IDBObjectStore, order: string[]) => string[]): Promise<LocalSaveOutcome> {
  return new Promise((resolve) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction([PROJECTS, ORDER], 'readwrite');
    } catch {
      return resolve({ ok: false, message: DEVICE_FULL });
    }
    tx.oncomplete = () => resolve({ ok: true });
    tx.onabort = () => resolve({ ok: false, message: DEVICE_FULL });
    const orderStore = tx.objectStore(ORDER);
    const read = orderStore.get(ORDER_RECORD);
    read.onsuccess = () => {
      const was = Array.isArray(read.result) ? (read.result as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      try {
        orderStore.put(work(tx.objectStore(PROJECTS), was), ORDER_RECORD);
      } catch {
        // A value the browser cannot store: nothing of this change is kept.
        tx.abort();
      }
    };
  });
}

/** Every project and the stored order, read in one transaction. */
function readAll<M, R>(db: IDBDatabase): Promise<SavedReportLike<M, R>[] | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([PROJECTS, ORDER], 'readonly');
      const all = tx.objectStore(PROJECTS).getAll();
      const order = tx.objectStore(ORDER).get(ORDER_RECORD);
      tx.oncomplete = () => resolve(arranged((all.result as unknown[]).filter(isUsableReport) as SavedReportLike<M, R>[], order.result));
      tx.onabort = () => resolve(null);
      tx.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Whether the old local storage list is there to move. */
function legacyKept(): boolean {
  try {
    return localStorage.getItem(LOCAL_REPORTS_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * The projects kept in this browser, newest first; never throws. The first
 * read moves the old local storage list in, keeping both where they differ,
 * and removes the key once that is stored.
 */
export async function loadProjects<M = unknown, R = unknown>(): Promise<SavedReportLike<M, R>[]> {
  const db = await database();
  if (!db) return loadReportsLocally<M, R>();
  const stored = await readAll<M, R>(db);
  if (!stored) return loadReportsLocally<M, R>();
  if (!legacyKept()) return stored;
  const have = new Set(stored.map((r) => r.id));
  const moving = loadReportsLocally<M, R>().filter((r) => !have.has(r.id));
  const outcome = moving.length
    ? await change(db, (projects, order) => {
        for (const r of moving) projects.put(r, r.id);
        // After what is stored, in the old list's own order.
        return [...order, ...moving.map((r) => r.id).filter((id) => !order.includes(id))];
      })
    : ({ ok: true } as const);
  if (!outcome.ok) return [...stored, ...moving];
  try {
    localStorage.removeItem(LOCAL_REPORTS_KEY);
  } catch {
    /* blocked: moved again, harmlessly, next time */
  }
  return [...stored, ...moving];
}

/**
 * Projects stored: each replaces its earlier save; `top` puts them first in
 * the list, as a save and a copy do, and otherwise each keeps its place (a
 * rename), a new one going first.
 */
export async function putProjects<M, R>(reports: readonly SavedReportLike<M, R>[], top = true): Promise<LocalSaveOutcome> {
  if (reports.length === 0) return { ok: true };
  const db = await database();
  const ids = reports.map((r) => r.id);
  if (!db) {
    const list = loadReportsLocally<M, R>();
    const byId = new Map(reports.map((r) => [r.id, r]));
    const kept = list.map((r) => byId.get(r.id) ?? r);
    const fresh = reports.filter((r) => !list.some((x) => x.id === r.id));
    return saveReportsLocally(top ? [...reports, ...list.filter((r) => !byId.has(r.id))] : [...fresh, ...kept]);
  }
  return change(db, (projects, order) => {
    for (const r of reports) projects.put(r, r.id);
    if (top) return [...ids, ...order.filter((id) => !ids.includes(id))];
    return [...ids.filter((id) => !order.includes(id)), ...order];
  });
}

/** Projects deleted from this browser; an id not kept is no failure. */
export async function deleteProjects(ids: readonly string[]): Promise<LocalSaveOutcome> {
  if (ids.length === 0) return { ok: true };
  const db = await database();
  if (!db) {
    const list = loadReportsLocally();
    const left = list.filter((r) => !ids.includes(r.id));
    return left.length === list.length ? { ok: true } : saveReportsLocally(left);
  }
  return change(db, (projects, order) => {
    for (const id of ids) projects.delete(id);
    return order.filter((id) => !ids.includes(id));
  });
}
