/**
 * The report library on disk, in IndexedDB.
 *
 * The implementation of `LibraryStorage` that `embedStore.ts` deliberately left
 * open. Measured against the real corpus before choosing: 19 production reports
 * chunk to 341 entries, 568 kB of text and — at 768 dimensions — about 1.05 MB of
 * vectors. **1.6 MB, and it grows with every import.**
 *
 * ## Why not `localStorage`, which everything else here uses
 *
 * Because this project has already exhausted it. `savedReport.ts` carries the
 * error verbatim — `QuotaExceededError: The 5000000-code unit storage quota has
 * been exceeded` — and `docs/notes/persistence.md` records that the signed-out
 * save path has **no budget**, so saved reports are already an unbounded consumer
 * of those 5 MB, alongside the API key, the theme, the report config and the panel
 * geometry. A library that grows every time someone imports a file would be the
 * second unbounded consumer of a pool that broke once with one.
 *
 * IndexedDB also removes the problem that forced the choice. `localStorage` holds
 * strings, so a vector costs ~13 characters a dimension as JSON and the library
 * only fits after being quantised to 8-bit integers. **IndexedDB stores a
 * `Float32Array` natively through structured clone** — 4 bytes a dimension, full
 * precision, no codec to write and no accuracy to trade away. The quantisation
 * step that `localStorage` would have required is simply not needed.
 *
 * ## Whole-corpus read and write, and when that stops being right
 *
 * `load()` is one `getAll` and `save()` is one clear-and-put inside a single
 * transaction. At 341 entries that is a few milliseconds and the simplest thing
 * that can be correct. It stops being right when rewriting the corpus to add one
 * entry becomes noticeable — somewhere in the tens of thousands, far past what a
 * house style is. Keyed writes are the change when it comes, and the interface
 * does not move.
 *
 * ## Failure is asymmetric, on purpose
 *
 * **`load()` resolves to `[]` when the database cannot be opened or read.**
 * IndexedDB is unavailable in some private-browsing modes and can be disabled
 * outright; a library that cannot be read means retrieval has nothing to offer,
 * which is a feature quietly doing less rather than an app that will not start.
 *
 * **`save()` rejects.** A failed import must be visible: the person chose those
 * files and will expect them next time. Swallowing that error would lose work
 * silently, which is the one outcome worse than an error message.
 *
 * ## What is tested and what is not
 *
 * `toRecord` and `fromRecord` are pure and carry the tests, including the
 * malformed-record guards — stored data outlives the code that wrote it, so a
 * record from an older shape has to be survivable rather than fatal.
 *
 * The IndexedDB calls themselves have no unit test yet. jsdom provides no
 * IndexedDB, and `fake-indexeddb` was declined here at first as a devDependency
 * for one adapter. There are four such stores now (this one, the learning
 * events, the database layouts and the batch checkpoint), so on 2026-11-11 (the
 * full audit, TC-07) it became a devDependency, and `learning.test.ts` and
 * `sqlSchemaStore.test.ts` show the pattern: a fresh `IDBFactory` per case, put
 * where the store looks for it. This adapter is next in line; until then,
 * exercise it in the running app.
 */
import type { LibraryEntry, LibraryStorage } from './embedStore';
import type { RepxChunk } from './repxChunks';

export const LIBRARY_DB_NAME = 'forma-library';
export const LIBRARY_STORE = 'entries';
export const LIBRARY_DB_VERSION = 1;

/**
 * An entry as it sits in the object store.
 *
 * Structurally identical to `LibraryEntry` today. It is a separate type because
 * the two are free to diverge and one of them is persistent: changing
 * `LibraryEntry` is a code change, changing this is a migration.
 */
export interface LibraryRecord {
  id: string;
  chunk: RepxChunk;
  vector: Float32Array | null;
  model: string;
  addedAt: number;
}

/** An entry on its way into the store. Vectors are narrowed to binary here. */
export function toRecord(entry: LibraryEntry): LibraryRecord {
  return {
    id: entry.id,
    chunk: entry.chunk,
    vector: entry.vector ? Float32Array.from(entry.vector) : null,
    model: entry.model,
    addedAt: entry.addedAt,
  };
}

/**
 * A record on its way out, or `null` if it cannot be trusted.
 *
 * Every field is checked rather than asserted. This data is written by one version
 * of the code and read by every version after it, so a record missing a field, or
 * holding a vector without the model that produced it, is an ordinary thing to
 * meet rather than an impossible one. Returning `null` drops that entry and keeps
 * the rest of the library usable — the alternative is one bad record making the
 * whole thing unreadable.
 */
export function fromRecord(record: unknown): LibraryEntry | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Partial<LibraryRecord>;

  if (typeof r.id !== 'string' || r.id === '') return null;
  if (!r.chunk || typeof r.chunk !== 'object') return null;
  if (typeof r.chunk.xml !== 'string') return null;
  if (typeof r.addedAt !== 'number' || !Number.isFinite(r.addedAt)) return null;

  const model = typeof r.model === 'string' ? r.model : '';
  const vector = r.vector instanceof Float32Array || Array.isArray(r.vector) ? r.vector : null;

  // A vector with no model cannot be searched -- `searchable` matches on model --
  // and would never be re-embedded either, because `entriesToEmbed` only looks for
  // a missing vector or a different model. Dropping it back to pending is the one
  // state that repairs itself.
  if (vector && model === '') {
    return { id: r.id, chunk: r.chunk as RepxChunk, vector: null, model: '', addedAt: r.addedAt };
  }

  return { id: r.id, chunk: r.chunk as RepxChunk, vector, model, addedAt: r.addedAt };
}

/** Promisify one request. IndexedDB predates promises and every call is an event pair. */
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

    const req = indexedDB.open(LIBRARY_DB_NAME, LIBRARY_DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(LIBRARY_STORE)) {
        req.result.createObjectStore(LIBRARY_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB could not be opened'));
    // Another tab holding an old version open. Failing is better than hanging:
    // the caller degrades to an empty library rather than waiting forever.
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
}

/** The `LibraryStorage` the rest of the feature talks to. */
export function createLibraryStorage(): LibraryStorage {
  return {
    async load(): Promise<LibraryEntry[]> {
      let db: IDBDatabase;
      try {
        db = await open();
      } catch {
        return [];
      }

      try {
        const tx = db.transaction(LIBRARY_STORE, 'readonly');
        const raw = await request<unknown[]>(tx.objectStore(LIBRARY_STORE).getAll());
        const entries: LibraryEntry[] = [];
        for (const record of raw) {
          const entry = fromRecord(record);
          if (entry) entries.push(entry);
        }
        return entries;
      } catch {
        return [];
      } finally {
        db.close();
      }
    },

    async save(entries: readonly LibraryEntry[]): Promise<void> {
      const db = await open();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(LIBRARY_STORE, 'readwrite');
          const store = tx.objectStore(LIBRARY_STORE);
          store.clear();
          for (const entry of entries) store.put(toRecord(entry));

          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write was aborted'));
          tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
        });
      } finally {
        db.close();
      }
    },
  };
}
