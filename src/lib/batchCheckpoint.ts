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
 * lib/signOut.ts). One batch is kept: a new one replaces it.
 *
 * The pure half is tested; the IndexedDB half is thin and is not, as
 * `libraryDb.ts`'s is not, since jsdom has no IndexedDB.
 */
import type { BatchItem } from './batchQueue';
import { layoutFromRepx, reportTitleOf, specFromRepx } from './repxViews';

export const BATCH_DB = 'forma-batch';
const ITEMS = 'items';
const FILES = 'files';

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
 * A finished row kept from an earlier visit, as a report to open: its REPX
 * alone was kept, so the Mockup and the Spec are read off it.
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

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BATCH_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(ITEMS);
      req.result.createObjectStore(FILES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function write(store: string, fill: (s: IDBObjectStore) => void): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      fill(tx.objectStore(store));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** The queue as it stands, after each change. A failure to keep it costs only the keeping. */
export async function keepItems(items: readonly BatchItem[]): Promise<void> {
  try {
    await write(ITEMS, (s) => s.put({ savedAt: Date.now(), items }, 'current'));
  } catch {
    /* IndexedDB blocked or full: the batch runs, unkept */
  }
}

/** The source files, once, when a batch is made; they replace the last batch's. */
export async function keepFiles(files: ReadonlyMap<string, File>): Promise<void> {
  try {
    await write(FILES, (s) => {
      s.clear();
      for (const [id, file] of files) s.put(file, id);
    });
  } catch {
    /* as above */
  }
}

/** The batch kept in this browser, or null when there is none or IndexedDB is not there. */
export async function readKept(): Promise<{ items: BatchItem[]; files: Map<string, File>; savedAt: number } | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await open();
    try {
      const tx = db.transaction([ITEMS, FILES], 'readonly');
      const get = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const state = await get(tx.objectStore(ITEMS).get('current') as IDBRequest<{ savedAt: number; items: BatchItem[] } | undefined>);
      if (!state?.items?.length) return null;
      const keys = await get(tx.objectStore(FILES).getAllKeys());
      const values = await get(tx.objectStore(FILES).getAll() as IDBRequest<File[]>);
      return { items: state.items, savedAt: state.savedAt, files: new Map(keys.map((k, i) => [String(k), values[i]])) };
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
    await write(ITEMS, (s) => s.clear());
    await write(FILES, (s) => s.clear());
  } catch {
    /* nothing kept */
  }
}
