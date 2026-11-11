/**
 * A batch kept in this browser, so it carries on after a limit, a failure or
 * a reload (2026-11-10, the owner's AI accuracy programme, batch AG, item 23).
 *
 * A batch of forty reports on a free key meets a limit: the minute's, and on
 * a long one the day's, which resets at midnight Pacific time. Until now it
 * stopped there and lived only in the open tab, so closing the tab, or
 * waiting for the reset, lost the files and every report made. Now the queue,
 * each finished report and the source files are kept in IndexedDB as the
 * batch goes, and the Batch panel opens on them again: Retry carries on from
 * the first file not finished, with the free chain's next AI or after the
 * reset, and Clear removes it.
 *
 * Kept in this browser alone, never sent anywhere, and deleted by a sign-out
 * with the rest of what this browser holds (`SIGNED_OUT_DATABASES` in
 * lib/signOut.ts). One batch is kept; files added while it has work left
 * join it (2026-11-11, the full audit's PL-14), and a new one replaces it
 * only once everything in it is done and downloaded.
 *
 * ## One record per item (2026-11-11, the full audit's PL-13)
 *
 * The whole queue, every finished REPX in it, was written under one key on
 * each change: three changes a file, so the last file of five hundred wrote
 * some fifty megabytes, again and again. Now each item is its own record,
 * written when it changes, and its REPX sits in a store of its own, written
 * once, when the item is done. A batch kept before that (one `current`
 * record) is still read, and rewritten in the new shape when it is opened.
 *
 * Writes go one after another (`queued`), since each opens its own
 * connection and a running item's record must not land after its done one.
 */
import type { BatchItem } from './batchQueue';
import { layoutFromRepx, reportTitleOf, specFromRepx } from './repxViews';

export const BATCH_DB = 'forma-batch';
const ITEMS = 'items';
const FILES = 'files';
const REPX = 'repx';
/** The key the whole queue was kept under until 2026-11-11. */
const LEGACY = 'current';

/** The queue as it is opened again: a file that was running when the tab went is to do again. */
export function restoredQueue(items: readonly BatchItem[]): BatchItem[] {
  return items.map((item) => (item.status === 'running' ? { ...item, status: 'pending', message: '' } : item));
}

/** What the panel says over a batch it opened again. */
export function keptNote(items: readonly BatchItem[], savedAt: number, now = Date.now()): string {
  const done = items.filter((i) => i.status === 'done').length;
  const left = items.length - done;
  const when = new Date(savedAt);
  const sameDay = new Date(now).toDateString() === when.toDateString();
  const at = sameDay ? when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : when.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return left
    ? `Kept in this browser from ${sameDay ? 'today at ' : ''}${at}: ${done} of ${items.length} done, ${left} to go. Retry carries on from there; Clear removes it.`
    : `Kept in this browser from ${sameDay ? 'today at ' : ''}${at}: all ${items.length} done. Clear removes it.`;
}

/**
 * A finished row as a report to open: its REPX alone is kept, so the Mockup
 * and the Spec are read off it, as they are for every report since
 * 2026-11-05. The one way a row opens since 2026-11-11 (PL-13): App kept a
 * second, full copy of each result for the session as well.
 */
export function resultFromKept(item: Pick<BatchItem, 'title' | 'repxContent'>) {
  if (!item.repxContent) return null;
  const title = item.title || reportTitleOf(item.repxContent);
  return { content: specFromRepx(item.repxContent, title), timestamp: new Date(), title, layout: layoutFromRepx(item.repxContent, title), repxContent: item.repxContent, usage: null };
}

/** Whether a failure is one that every file after it would meet: a limit, or the key. */
export function stopsTheBatch(message: string, limit: boolean): 'limit' | 'key' | null {
  if (limit) return 'limit';
  return /api key|permission|denied|not valid|rejected the key/i.test(message) ? 'key' : null;
}

/* ------------------------------------------------------------ IndexedDB */

/** An item as its record is kept: its place in the queue and when, without its REPX. */
interface ItemRecord extends BatchItem {
  order: number;
  savedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BATCH_DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of [ITEMS, FILES, REPX]) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    /*
     * Another tab holding the old version open blocks the upgrade, and the
     * request waits until it closes (2026-11-11): the panel waited with it,
     * so files the chat handed over were never started. Given up on at once,
     * as if nothing were kept; a connection that opens after is closed.
     */
    let blocked = false;
    req.onblocked = () => {
      blocked = true;
      reject(new Error('the kept batch is open in another tab'));
    };
    req.onsuccess = () => {
      const db = req.result;
      if (blocked) return db.close();
      // And never the one blocking a later version.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

let queued: Promise<unknown> = Promise.resolve();

/** One write over `stores`, after every write asked for before it. */
function write(stores: string[], fill: (tx: IDBTransaction) => void): Promise<void> {
  const run = async () => {
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(stores, 'readwrite');
        fill(tx);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  };
  const done = queued.then(run, run);
  queued = done.catch(() => undefined);
  return done;
}

/** What changed in the queue: each item with its place, and whether its REPX is new. */
export interface KeptChange {
  item: BatchItem;
  order: number;
  /** True once, when the item is done with a REPX it did not have before. */
  repx: boolean;
}

function putChanges(tx: IDBTransaction, changes: readonly KeptChange[], now: number) {
  const items = tx.objectStore(ITEMS);
  const repx = tx.objectStore(REPX);
  for (const { item, order, repx: withRepx } of changes) {
    const record: ItemRecord = { ...item, repxContent: '', order, savedAt: now };
    items.put(record, item.id);
    if (withRepx && item.repxContent) repx.put(item.repxContent, item.id);
  }
}

/** The items that changed, each in its own record. A failure to keep them costs only the keeping. */
export async function keepItems(changes: readonly KeptChange[], now = Date.now()): Promise<void> {
  if (!changes.length) return;
  try {
    await write([ITEMS, REPX], (tx) => putChanges(tx, changes, now));
  } catch {
    /* IndexedDB blocked or full: the batch runs, unkept */
  }
}

/** A queue that replaces the one kept: everything kept is cleared first, its files apart. */
export async function keepQueue(items: readonly BatchItem[], now = Date.now()): Promise<void> {
  try {
    await write([ITEMS, REPX], (tx) => {
      tx.objectStore(ITEMS).clear();
      tx.objectStore(REPX).clear();
      putChanges(tx, items.map((item, order) => ({ item, order, repx: item.status === 'done' })), now);
    });
  } catch {
    /* as above */
  }
}

/**
 * The source files, by item id, when they are added. `replace` clears the
 * last batch's first; files joining a batch that has work left are added to it.
 */
export async function keepFiles(files: ReadonlyMap<string, File>, replace = true): Promise<void> {
  try {
    await write([FILES], (tx) => {
      const store = tx.objectStore(FILES);
      if (replace) store.clear();
      for (const [id, file] of files) store.put(file, id);
    });
  } catch {
    /* as above */
  }
}

/**
 * The batch kept in this browser, or null when there is none or IndexedDB is
 * not there. `legacy` is a batch kept in the shape before 2026-11-11, which
 * the panel writes again in the new one.
 */
export async function readKept(): Promise<{ items: BatchItem[]; files: Map<string, File>; savedAt: number; legacy: boolean } | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    await queued;
    const db = await open();
    try {
      const tx = db.transaction([ITEMS, FILES, REPX], 'readonly');
      const get = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const [itemKeys, itemValues, fileKeys, fileValues, repxKeys, repxValues] = await Promise.all([
        get(tx.objectStore(ITEMS).getAllKeys()),
        get(tx.objectStore(ITEMS).getAll() as IDBRequest<unknown[]>),
        get(tx.objectStore(FILES).getAllKeys()),
        get(tx.objectStore(FILES).getAll() as IDBRequest<File[]>),
        get(tx.objectStore(REPX).getAllKeys()),
        get(tx.objectStore(REPX).getAll() as IDBRequest<string[]>),
      ]);
      const files = new Map(fileKeys.map((k, i) => [String(k), fileValues[i]]));
      const legacyAt = itemKeys.findIndex((k) => k === LEGACY);
      if (legacyAt >= 0) {
        const state = itemValues[legacyAt] as { savedAt: number; items: BatchItem[] } | undefined;
        if (!state?.items?.length) return null;
        return { items: state.items, savedAt: state.savedAt, files, legacy: true };
      }
      const records = (itemValues as ItemRecord[]).filter((r) => r && typeof r.id === 'string').sort((a, b) => a.order - b.order);
      if (!records.length) return null;
      const repx = new Map(repxKeys.map((k, i) => [String(k), repxValues[i]]));
      const items = records.map(({ order: _order, savedAt: _savedAt, ...item }) => ({ ...item, repxContent: repx.get(item.id) ?? '' }));
      return { items, savedAt: Math.max(...records.map((r) => r.savedAt || 0)), files, legacy: false };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** Forgets the kept batch. */
export async function clearKept(): Promise<void> {
  try {
    await write([ITEMS, FILES, REPX], (tx) => {
      for (const store of [ITEMS, FILES, REPX]) tx.objectStore(store).clear();
    });
  } catch {
    /* nothing kept */
  }
}
