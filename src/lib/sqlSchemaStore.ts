/**
 * The database layouts a person has given Forma, kept on this device
 * (2026-11-08, the SQL Server programme, checklist item 10).
 *
 * In IndexedDB, as the report library is (`libraryDb.ts`), and nowhere else:
 * a layout can run to hundreds of objects, and it is the company's structure,
 * so it does not travel with every saved project into the cloud. A project
 * remembers only which database it was designed against (its name), and from
 * batch DD the .repx carries the part of the layout it uses. There is never a
 * connection string to keep: the model has no field for one.
 *
 * The newest `MAX_DATABASES` are kept, one per database name; importing the
 * same database again replaces its layout and keeps any sample rows the new
 * import does not bring.
 */
import type { SqlSchema } from './sqlSchema';

export const MAX_DATABASES = 5;
const DB_NAME = 'forma-databases';
const DB_VERSION = 1;
const STORE = 'layouts';

export interface StoredDatabase {
  /** The database's name, the key. */
  name: string;
  savedAt: number;
  schema: SqlSchema;
}

/** The kept list after adding `entry`: one per name, newest first, at most `max`. */
export function keepRecent(list: readonly StoredDatabase[], entry: StoredDatabase, max = MAX_DATABASES): StoredDatabase[] {
  const previous = list.find((d) => d.name === entry.name);
  const merged: StoredDatabase = previous?.schema.samples && !entry.schema.samples
    ? { ...entry, schema: { ...entry.schema, samples: previous.schema.samples } }
    : entry;
  return [merged, ...list.filter((d) => d.name !== entry.name)].sort((a, b) => b.savedAt - a.savedAt).slice(0, max);
}

/** The name a layout is kept under; a nameless one is "Database". */
export function storedName(schema: SqlSchema): string {
  return schema.database.trim() || 'Database';
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser context'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'name' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB could not be opened'));
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
}

/** Every kept layout, newest first; empty when storage is unavailable. */
export async function loadDatabases(): Promise<StoredDatabase[]> {
  try {
    const db = await open();
    try {
      const rows = await request<StoredDatabase[]>(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
      return rows.filter((r) => r && typeof r.name === 'string' && r.schema).sort((a, b) => b.savedAt - a.savedAt);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/** Keeps a layout and returns the list as it now stands. Storage failing is not fatal: the layout still works for this session. */
export async function saveDatabase(schema: SqlSchema, now = Date.now()): Promise<StoredDatabase[]> {
  const current = await loadDatabases();
  const next = keepRecent(current, { name: storedName(schema), savedAt: now, schema });
  try {
    const db = await open();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const old of current) if (!next.some((d) => d.name === old.name)) store.delete(old.name);
      for (const entry of next) store.put(entry);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      });
    } finally {
      db.close();
    }
  } catch {
    // Private windows and blocked storage: the caller keeps the layout in memory.
  }
  return next;
}

/** Forgets one kept layout. */
export async function forgetDatabase(name: string): Promise<void> {
  try {
    const db = await open();
    try {
      await request(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(name));
    } finally {
      db.close();
    }
  } catch {
    // Nothing kept, nothing to forget.
  }
}
