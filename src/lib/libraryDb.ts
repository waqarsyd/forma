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
 * jsdom provides no IndexedDB, and `fake-indexeddb` was declined here at first
 * as a devDependency for one adapter. There are four such stores now (this
 * one, the learning events, the database layouts and the batch checkpoint), so
 * on 2026-11-11 (the full audit, TC-07) it became a devDependency. Both stores
 * here take the `IDBFactory` to use (the browser's when none is given), and
 * `libraryDb.test.ts` runs them over a fresh in-memory one per case (batch
 * LRN2, the same day).
 *
 * ## The reports a person keeps, beside the ones they add (2026-11-11, D2)
 *
 * A report the person keeps, by exporting it, saving it or opening it in the
 * designer, joins their library on its own, in a second object store,
 * `kept`: one record per report, its parts cut and stripped exactly as an
 * imported file's are (`chunkRepx`), the numbers its shape is compared by,
 * and its name, which never leaves this browser. Apart from `entries` on
 * purpose: those are embedded through the person's key and searched on a
 * refine, and a kept report is neither. It is compared by its shape, here,
 * and nothing of it is sent anywhere for that (services/library.ts).
 *
 * ## It belongs to whoever is signed in, and goes when they sign out
 *
 * Since 2026-11-11 (the full audit's WS-28 and SE-17) a sign-out deletes this
 * database (`SIGNED_OUT_DATABASES` in lib/signOut.ts, which names it rather
 * than importing it). It held the last person's reports cut into examples, and
 * its ticked files went to the next person's AI as their house style. Keeping
 * an `owner` on every record would have kept the library across a sign-out,
 * at the cost of a migration and a filter on every read; deleting it costs a
 * re-import, and the files are the person's own to import again.
 */
import type { LibraryEntry, LibraryStorage } from './embedStore';
import type { RepxChunk } from './repxChunks';

export const LIBRARY_DB_NAME = 'forma-library';
export const LIBRARY_STORE = 'entries';
/** The reports the person kept (D2), one record each. */
export const KEPT_STORE = 'kept';
/** 2 since 2026-11-11, when `kept` joined `entries`; an older database gains it on opening. */
export const LIBRARY_DB_VERSION = 2;

/**
 * A report the person kept, as the library holds it: never its words. Its
 * `name` is the report's own title, shown in the Library panel and in the
 * reply that says a report was laid out like it; it is not sent to an AI.
 */
export interface KeptRecord {
  /** The project's id, or a hash of its shape when it has none: keeping it again replaces it. */
  id: string;
  /**
   * Who kept it: the account's uid, or null signed out (2026-11-11, the LRN2
   * review). The memory is per account and only a sign-out deletes this
   * database, so without it one person's kept reports were the next person's
   * examples on a shared browser. Read and listed for its owner only, and a
   * report kept by anyone else clears it out (services/library.ts).
   */
  owner: string | null;
  name: string;
  /** When it was last kept, epoch ms; the oldest goes first. */
  at: number;
  /** `skeletonFeatures` of its skeleton: what it is compared with a new request by. */
  features: number[];
  /** A `CATEGORY_WORDS` key its name points to, or null. */
  category: string | null;
  /** The face most of its text is in, and its title's size in points (null without a title). */
  face: string;
  titleSize: number | null;
  /** Its parts, data stripped (`chunkRepx`): what the AI is shown as a formatting example. */
  chunks: RepxChunk[];
}

/** A kept record read back, or null when it cannot be trusted (as `fromRecord`). */
export function fromKeptRecord(record: unknown): KeptRecord | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Partial<KeptRecord>;
  if (typeof r.id !== 'string' || !r.id || typeof r.name !== 'string') return null;
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return null;
  if (!Array.isArray(r.features) || !r.features.every((f) => typeof f === 'number' && Number.isFinite(f))) return null;
  if (!Array.isArray(r.chunks)) return null;
  const chunks = r.chunks.filter((c): c is RepxChunk => !!c && typeof c === 'object' && typeof (c as RepxChunk).xml === 'string');
  return {
    id: r.id,
    owner: typeof r.owner === 'string' && r.owner ? r.owner : null,
    name: r.name,
    at: r.at,
    features: r.features,
    category: typeof r.category === 'string' ? r.category : null,
    face: typeof r.face === 'string' ? r.face : '',
    titleSize: typeof r.titleSize === 'number' && Number.isFinite(r.titleSize) ? r.titleSize : null,
    chunks,
  };
}

/** The kept reports on disk: whole-store reads and writes, as the entries'. */
export interface KeptStorage {
  load(): Promise<KeptRecord[]>;
  save(records: readonly KeptRecord[]): Promise<void>;
}

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

/** The browser's IndexedDB, or undefined where there is none (Node, some private modes). */
const browserIdb = (): IDBFactory | undefined => (typeof indexedDB === 'undefined' ? undefined : indexedDB);

function open(idb: IDBFactory | undefined = browserIdb()): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!idb) {
      reject(new Error('IndexedDB is not available in this browser context'));
      return;
    }

    const req = idb.open(LIBRARY_DB_NAME, LIBRARY_DB_VERSION);
    req.onupgradeneeded = () => {
      // Each store made when missing, so a version-1 database keeps its entries and gains `kept`.
      for (const name of [LIBRARY_STORE, KEPT_STORE]) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB could not be opened'));
    // Another tab holding an old version open. Failing is better than hanging:
    // the caller degrades to an empty library rather than waiting forever.
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
}

/** Every record of one store, each read through `read`; [] when the store cannot be opened or read. */
async function loadAll<T>(idb: IDBFactory | undefined, store: string, read: (record: unknown) => T | null): Promise<T[]> {
  let db: IDBDatabase;
  try {
    db = await open(idb);
  } catch {
    return [];
  }
  try {
    const tx = db.transaction(store, 'readonly');
    const raw = await request<unknown[]>(tx.objectStore(store).getAll());
    const out: T[] = [];
    for (const record of raw) {
      const item = read(record);
      if (item) out.push(item);
    }
    return out;
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/** One store replaced by `records` in a single transaction; rejects, as the header says a save must. */
async function saveAll(idb: IDBFactory | undefined, store: string, records: readonly unknown[]): Promise<void> {
  const db = await open(idb);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      os.clear();
      for (const record of records) os.put(record);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write was aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    });
  } finally {
    db.close();
  }
}

/** The `LibraryStorage` the rest of the feature talks to; `idb` is the browser's unless a test gives one. */
export function createLibraryStorage(idb?: IDBFactory): LibraryStorage {
  return {
    load: () => loadAll(idb ?? browserIdb(), LIBRARY_STORE, fromRecord),
    save: (entries) => saveAll(idb ?? browserIdb(), LIBRARY_STORE, entries.map(toRecord)),
  };
}

/** The kept reports' store (D2), in the same database. */
export function createKeptStorage(idb?: IDBFactory): KeptStorage {
  return {
    load: () => loadAll(idb ?? browserIdb(), KEPT_STORE, fromKeptRecord),
    save: (records) => saveAll(idb ?? browserIdb(), KEPT_STORE, records),
  };
}
