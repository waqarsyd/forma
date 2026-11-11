/**
 * A batch kept in this browser (2026-11-10, the AI accuracy programme, batch
 * AG item 23). The IndexedDB half is tested since 2026-11-11 (the full
 * audit's PL-13), over a fresh in-memory IndexedDB from `fake-indexeddb` per
 * case, loaded through a computed specifier as `sqlSchemaStore.test.ts`
 * explains: a node_modules without it skips those cases, CI never does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearKept, keepFiles, keepItems, keepQueue, keptNote, readKept, restoredQueue, resultFromKept, stopsTheBatch, BATCH_DB } from './batchCheckpoint';
import { appendQueue, createQueue, markDone, markRunning, type BatchItem } from './batchQueue';

const FAKE_IDB = 'fake-indexeddb';
const fakeIdb = (await import(/* @vite-ignore */ FAKE_IDB).catch(() => null)) as { IDBFactory: new () => IDBFactory } | null;
if (!fakeIdb && process.env.CI) throw new Error('fake-indexeddb is a devDependency and is not installed: run npm ci.');

const done = { title: 'R', repxContent: '<x/>', bands: 3, errors: 0, warnings: 0 };

describe('a batch opened again', () => {
  it('does again the file that was running when the tab went, and keeps what was done', () => {
    let q = createQueue(['a.png', 'b.png', 'c.png']);
    q = markDone(markRunning(q, q[0].id), q[0].id, done);
    q = markRunning(q, q[1].id);
    expect(restoredQueue(q).map((i) => i.status)).toEqual(['done', 'pending', 'pending']);
    expect(restoredQueue(q)[0].repxContent).toBe('<x/>');
  });

  it('says what it kept and from when', () => {
    let q = createQueue(['a.png', 'b.png', 'c.png']);
    q = markDone(markRunning(q, q[0].id), q[0].id, done);
    const now = new Date(2026, 10, 10, 15, 0).getTime();
    expect(keptNote(q, new Date(2026, 10, 10, 9, 30).getTime(), now)).toMatch(/^Kept in this browser from today at .+: 1 of 3 done, 2 to go\. Retry carries on from there; Clear removes it\.$/);
    expect(keptNote(q.map((i) => ({ ...i, status: 'done' as const })), new Date(2026, 10, 9).getTime(), now)).toMatch(/^Kept in this browser from .+: all 3 done\. Clear removes it\.$/);
  });
});

describe('a failure every file would meet', () => {
  it('is a limit, or the key; anything else lets the next file try', () => {
    expect(stopsTheBatch('This key’s free daily allowance is used up.', true)).toBe('limit');
    expect(stopsTheBatch('Your Gemini API key was rejected.', false)).toBe('key');
    expect(stopsTheBatch('OpenRouter rejected the key. Check it in Settings.', false)).toBe('key');
    expect(stopsTheBatch('The PDF could not be read.', false)).toBeNull();
  });
});

describe('a finished row kept from an earlier visit', () => {
  it('opens as a report read off its REPX, and a row with none opens nothing', () => {
    const repx = '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Invoice" PageWidth="850" PageHeight="1100" Version="20.1" Dpi="100"><Bands><Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="25" Dpi="100" /></Bands></XtraReportsLayoutSerializer>';
    const opened = resultFromKept({ title: 'Invoice', repxContent: repx })!;
    expect(opened.title).toBe('Invoice');
    expect(opened.repxContent).toBe(repx);
    expect(opened.layout).toBeTruthy();
    expect(typeof opened.content).toBe('string');
    expect(resultFromKept({ title: 'x', repxContent: '' })).toBeNull();
  });
});

/** Every record of one store, by key, read straight from the database. */
async function storeOf(name: string): Promise<Map<string, unknown>> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(BATCH_DB);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    const tx = db.transaction(name, 'readonly');
    const ask = <T>(req: IDBRequest<T>) => new Promise<T>((resolve) => { req.onsuccess = () => resolve(req.result); });
    const [keys, values] = await Promise.all([ask(tx.objectStore(name).getAllKeys()), ask(tx.objectStore(name).getAll())]);
    return new Map(keys.map((k, i) => [String(k), values[i]]));
  } finally {
    db.close();
  }
}

// One record per item, its REPX apart and written once (2026-11-11, the full audit's PL-13).
describe.runIf(fakeIdb)('the batch kept in IndexedDB', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new fakeIdb!.IDBFactory());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const changed = (items: readonly BatchItem[], ids: readonly string[], repx: readonly string[] = []) =>
    items.flatMap((item, order) => (ids.includes(item.id) ? [{ item, order, repx: repx.includes(item.id) }] : []));

  it('saves each item on its own, and its REPX once, apart from it', async () => {
    let q = createQueue(['a.png', 'b.png', 'c.png'], 'in German');
    await keepQueue(q, 1_000);
    await keepFiles(new Map(q.map((i) => [i.id, new File([i.sourceName], i.sourceName, { type: 'image/png' })])));
    q = markDone(markRunning(q, q[0].id), q[0].id, done);
    await keepItems(changed(q, [q[0].id], [q[0].id]), 2_000);

    const items = await storeOf('items');
    expect([...items.keys()].sort()).toEqual(q.map((i) => i.id).sort());
    expect((items.get(q[0].id) as BatchItem).repxContent).toBe('');
    expect((items.get(q[0].id) as BatchItem).status).toBe('done');
    expect([...(await storeOf('repx')).entries()]).toEqual([[q[0].id, '<x/>']]);
  });

  it('opens it again in order, with each REPX and file, and from when', async () => {
    let q = createQueue(['a.png', 'b.png']);
    await keepQueue(q, 1_000);
    await keepFiles(new Map([[q[0].id, new File(['A'], 'a.png')], [q[1].id, new File(['B'], 'b.png')]]));
    q = markRunning(markDone(markRunning(q, q[0].id), q[0].id, done), q[1].id);
    await keepItems(changed(q, [q[0].id], [q[0].id]), 2_000);
    await keepItems(changed(q, [q[1].id]), 3_000);

    const kept = (await readKept())!;
    expect(kept.legacy).toBe(false);
    expect(kept.savedAt).toBe(3_000);
    expect(kept.items.map((i) => [i.sourceName, i.status, i.repxContent])).toEqual([['a.png', 'done', '<x/>'], ['b.png', 'running', '']]);
    expect(restoredQueue(kept.items).map((i) => i.status)).toEqual(['done', 'pending']);
    expect([...kept.files.keys()]).toEqual(q.map((i) => i.id));
    expect(await kept.files.get(q[1].id)!.text()).toBe('B');
  });

  it('adds files to a batch with work left, and a new batch replaces the last', async () => {
    const q = createQueue(['a.png']);
    await keepQueue(q, 1_000);
    await keepFiles(new Map([[q[0].id, new File(['A'], 'a.png')]]));
    const more = appendQueue(q, ['b.png']);
    await keepItems(changed(more, [more[1].id]), 2_000);
    await keepFiles(new Map([[more[1].id, new File(['B'], 'b.png')]]), false);
    expect((await readKept())!.items.map((i) => i.sourceName)).toEqual(['a.png', 'b.png']);
    expect((await readKept())!.files.size).toBe(2);

    const next = createQueue(['z.png']);
    await keepQueue(next, 3_000);
    await keepFiles(new Map([[next[0].id, new File(['Z'], 'z.png')]]));
    const kept = (await readKept())!;
    expect(kept.items.map((i) => i.sourceName)).toEqual(['z.png']);
    expect([...kept.files.keys()]).toEqual([next[0].id]);
  });

  it('forgets everything on Clear', async () => {
    const q = markDone(markRunning(createQueue(['a.png']), '0:a.png'), '0:a.png', done);
    await keepQueue(q);
    await keepFiles(new Map([['0:a.png', new File(['A'], 'a.png')]]));
    await clearKept();
    expect(await readKept()).toBeNull();
    for (const store of ['items', 'files', 'repx']) expect((await storeOf(store)).size).toBe(0);
  });

  it('reads a batch kept in the shape before 2026-11-11', async () => {
    const q = markDone(markRunning(createQueue(['a.png', 'b.png']), '0:a.png'), '0:a.png', done);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(BATCH_DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('items');
        req.result.createObjectStore('files');
      };
      req.onsuccess = () => {
        const tx = req.result.transaction('items', 'readwrite');
        tx.objectStore('items').put({ savedAt: 5_000, items: q }, 'current');
        tx.oncomplete = () => { req.result.close(); resolve(); };
      };
      req.onerror = () => reject(req.error);
    });
    const kept = (await readKept())!;
    expect(kept.legacy).toBe(true);
    expect(kept.savedAt).toBe(5_000);
    expect(kept.items[0].repxContent).toBe('<x/>');
    // Written again in the new shape, the old record goes.
    await keepQueue(kept.items, 6_000);
    expect((await storeOf('items')).has('current')).toBe(false);
    expect((await readKept())!.items[0].repxContent).toBe('<x/>');
  });
});
