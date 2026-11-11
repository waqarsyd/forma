/**
 * The record mapping, which is the part that outlives the code that wrote it.
 *
 * A stored record is read by every version of the app that comes after the one
 * that wrote it, so the cases worth testing are the malformed ones: a field that
 * is missing, a field that is the wrong type, and the one state that cannot repair
 * itself — a vector with no model naming the space it belongs to.
 *
 * The IndexedDB calls are tested since 2026-11-11 (batch LRN2, when a second
 * store, the reports a person keeps, joined the first): over a fresh in-memory
 * IndexedDB from `fake-indexeddb` per case, given to the store rather than put
 * in the global, loaded through a computed specifier as `sqlSchemaStore.test.ts`
 * explains.
 *
 * As elsewhere in this suite the loops sit inside a single case, so the grep and the
 * run agree.
 */
import { describe, it, expect } from 'vitest';
import {
  fromRecord,
  toRecord,
  fromKeptRecord,
  createKeptStorage,
  createLibraryStorage,
  KEPT_STORE,
  LIBRARY_DB_NAME,
  LIBRARY_DB_VERSION,
  LIBRARY_STORE,
  type KeptRecord,
} from './libraryDb';
import { addChunks, searchable, entriesToEmbed, type LibraryEntry } from './embedStore';
import type { RepxChunk } from './repxChunks';

const chunk: RepxChunk = {
  kind: 'control',
  controlType: 'XRLabel',
  band: 'DetailBand',
  caption: 'label in the detail band',
  xml: '<Item1 ControlType="XRLabel" Text="{text}" />',
  source: 'a.repx',
  redacted: 1,
  start: 0,
};

const entry = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: 'abc123',
  chunk,
  vector: [1, 0, 0],
  model: 'embed-1',
  addedAt: 1700000000000,
  ...over,
});

describe('toRecord', () => {
  it('narrows the vector to binary, which is the reason for IndexedDB at all', () => {
    const record = toRecord(entry());
    expect(record.vector).toBeInstanceOf(Float32Array);
    expect(Array.from(record.vector!)).toEqual([1, 0, 0]);
  });

  it('keeps a null vector null rather than inventing an empty one', () => {
    // An empty Float32Array would read as "embedded, dimension 0" downstream.
    expect(toRecord(entry({ vector: null, model: '' })).vector).toBeNull();
  });

  it('accepts a Float32Array it is already given', () => {
    const record = toRecord(entry({ vector: new Float32Array([0.5, 0.25]) }));
    expect(Array.from(record.vector!)).toEqual([0.5, 0.25]);
  });

  it('round-trips through fromRecord unchanged', () => {
    const original = entry();
    const back = fromRecord(toRecord(original));
    expect(back?.id).toBe(original.id);
    expect(back?.model).toBe(original.model);
    expect(back?.addedAt).toBe(original.addedAt);
    expect(back?.chunk).toEqual(original.chunk);
    expect(Array.from(back!.vector as Float32Array)).toEqual([1, 0, 0]);
  });
});

describe('fromRecord', () => {
  it('rejects anything that is not a usable record', () => {
    const rubbish: unknown[] = [
      null,
      undefined,
      42,
      'a string',
      {},
      { id: '', chunk, addedAt: 1 },
      { id: 'a', addedAt: 1 },
      { id: 'a', chunk: null, addedAt: 1 },
      { id: 'a', chunk: { caption: 'no xml' }, addedAt: 1 },
      { id: 'a', chunk, addedAt: 'yesterday' },
      { id: 'a', chunk, addedAt: NaN },
    ];
    for (const record of rubbish) {
      expect(fromRecord(record), JSON.stringify(record)).toBeNull();
    }
  });

  it('drops one bad record without taking the library with it', () => {
    const records: unknown[] = [toRecord(entry({ id: 'good1' })), { broken: true }, toRecord(entry({ id: 'good2' }))];
    const kept = records.map(fromRecord).filter(Boolean);
    expect(kept).toHaveLength(2);
  });

  it('treats a missing model as unembedded rather than as an empty-string space', () => {
    expect(fromRecord({ id: 'a', chunk, addedAt: 1, vector: new Float32Array([1]) })?.model).toBe('');
  });

  it('sends a vector with no model back to pending, the one state that repairs itself', () => {
    // searchable() matches on model, so such a vector can never be searched; and
    // entriesToEmbed() only looks for a missing vector or a different model, so it
    // would never be re-embedded either. Dropping the vector fixes both.
    const recovered = fromRecord({ id: 'a', chunk, addedAt: 1, vector: new Float32Array([1, 0]), model: '' });
    expect(recovered?.vector).toBeNull();
    expect(searchable([recovered!], 'embed-1')).toEqual([]);
    expect(entriesToEmbed([recovered!], 'embed-1')).toHaveLength(1);
  });

  it('accepts a plain array vector, because an older record may hold one', () => {
    const recovered = fromRecord({ id: 'a', chunk, addedAt: 1, vector: [1, 0], model: 'embed-1' });
    expect(recovered?.vector).toEqual([1, 0]);
  });

  it('ignores a vector of the wrong type instead of storing it', () => {
    for (const bad of ['1,0', { 0: 1 }, 7]) {
      const recovered = fromRecord({ id: 'a', chunk, addedAt: 1, vector: bad, model: 'embed-1' });
      expect(recovered?.vector, JSON.stringify(bad)).toBeNull();
    }
  });

  it('survives a whole library written by addChunks', () => {
    const { entries } = addChunks([], [chunk, { ...chunk, xml: '<Item1 ControlType="XRLine" />' }]);
    const back = entries.map(toRecord).map(fromRecord);
    expect(back.every(Boolean)).toBe(true);
    expect(back.map((e) => e!.id)).toEqual(entries.map((e) => e.id));
  });
});

describe('the store it writes to', () => {
  it('names a database and an object store, so a migration can find them', () => {
    expect(LIBRARY_DB_NAME).toBe('forma-library');
    expect(LIBRARY_STORE).toBe('entries');
    expect(KEPT_STORE).toBe('kept');
    expect(LIBRARY_DB_VERSION).toBe(2);
  });
});

const kept = (over: Partial<KeptRecord> = {}): KeptRecord => ({
  id: 'project-1',
  owner: 'alice',
  name: 'Invoice',
  at: 1700000000000,
  features: [1, 2, 3],
  category: 'invoice',
  face: 'Tahoma',
  titleSize: 15,
  chunks: [chunk],
  ...over,
});

describe('fromKeptRecord', () => {
  it('reads a kept report back, and refuses one it cannot trust', () => {
    expect(fromKeptRecord(kept())).toEqual(kept());
    const rubbish: unknown[] = [null, 7, {}, kept({ id: '' }), { ...kept(), at: 'today' }, { ...kept(), features: [1, NaN] }, { ...kept(), chunks: 'x' }];
    for (const record of rubbish) expect(fromKeptRecord(record), JSON.stringify(record)).toBeNull();
    // A missing look or category is read as none, and a broken part is dropped.
    const loose = fromKeptRecord({ ...kept(), category: 3, face: null, titleSize: 'big', chunks: [chunk, { no: 'xml' }] });
    expect(loose).toMatchObject({ category: null, face: '', titleSize: null, chunks: [chunk] });
    // An owner that is not a uid is the signed-out one (the LRN2 review).
    expect(fromKeptRecord({ ...kept(), owner: 7 })?.owner).toBeNull();
    expect(fromKeptRecord({ ...kept(), owner: '' })?.owner).toBeNull();
  });
});

const FAKE_IDB = 'fake-indexeddb';
const fakeIdb = (await import(/* @vite-ignore */ FAKE_IDB).catch(() => null)) as { IDBFactory: new () => IDBFactory } | null;
if (!fakeIdb && process.env.CI) throw new Error('fake-indexeddb is a devDependency and is not installed: run npm ci.');

describe.runIf(fakeIdb)('the two stores on this device (D2)', () => {
  it('keeps the added reports and the kept ones apart, each read back as written', async () => {
    const idb = new fakeIdb!.IDBFactory();
    const library = createLibraryStorage(idb);
    const keptStore = createKeptStorage(idb);
    await library.save([entry({ id: 'e1' })]);
    await keptStore.save([kept(), kept({ id: 'project-2', name: 'Stock' })]);
    expect((await library.load()).map((e) => e.id)).toEqual(['e1']);
    expect((await keptStore.load()).map((r) => r.name)).toEqual(['Invoice', 'Stock']);
    // A save replaces the store, and leaves the other alone.
    await keptStore.save([kept({ id: 'project-2', name: 'Stock' })]);
    expect((await keptStore.load()).map((r) => r.id)).toEqual(['project-2']);
    expect(await library.load()).toHaveLength(1);
  });

  it('opens a database written before the kept reports, keeps its entries and gains the store', async () => {
    const idb = new fakeIdb!.IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const req = idb.open(LIBRARY_DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(LIBRARY_STORE, { keyPath: 'id' }).put(toRecord(entry({ id: 'old' })));
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    expect((await createLibraryStorage(idb).load()).map((e) => e.id)).toEqual(['old']);
    expect(await createKeptStorage(idb).load()).toEqual([]);
    await createKeptStorage(idb).save([kept()]);
    expect(await createKeptStorage(idb).load()).toHaveLength(1);
  });

  it('reads nothing, rather than failing, where there is no IndexedDB', async () => {
    const none = createKeptStorage(undefined);
    // Node has no global indexedDB, so this is the browser that has none.
    if (typeof indexedDB === 'undefined') {
      expect(await none.load()).toEqual([]);
      await expect(none.save([kept()])).rejects.toThrow(/IndexedDB/);
    }
  });
});
