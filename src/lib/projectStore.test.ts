// @vitest-environment jsdom
/**
 * The projects kept in this browser while signed out, in IndexedDB since
 * 2026-11-11 (the full audit's PR-15, batch BW2): moved once from local
 * storage, one record written per save, the list's order kept, a failed write
 * changing nothing, and local storage used where there is no IndexedDB.
 *
 * Over a fresh in-memory IndexedDB from `fake-indexeddb` per case, loaded
 * through a computed specifier as `batchCheckpoint.test.ts` explains: a
 * node_modules without it skips those cases, CI never does. jsdom for
 * localStorage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteProjects, loadProjects, putProjects, resetProjectStore, PROJECTS_DB } from './projectStore';
import { LOCAL_REPORTS_KEY, type SavedReportLike } from './savedReport';

const FAKE_IDB = 'fake-indexeddb';
const fakeIdb = (await import(/* @vite-ignore */ FAKE_IDB).catch(() => null)) as { IDBFactory: new () => IDBFactory; IDBObjectStore: { prototype: IDBObjectStore } } | null;
if (!fakeIdb && process.env.CI) throw new Error('fake-indexeddb is a devDependency and is not installed: run npm ci.');

const project = (id: string, name = `Project ${id}`, at = `2026-11-1${id.length}T09:00:00.000Z`): SavedReportLike =>
  ({ id, name, timestamp: at, messages: [{ role: 'user', text: `about ${name}` }], result: null });

afterEach(() => {
  resetProjectStore();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe.runIf(fakeIdb)('the projects kept in IndexedDB', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new fakeIdb!.IDBFactory());
  });

  it('moves the old local storage list in once, in its order, and removes the key', async () => {
    localStorage.setItem(LOCAL_REPORTS_KEY, JSON.stringify([project('b'), project('a')]));
    expect((await loadProjects()).map((r) => r.id)).toEqual(['b', 'a']);
    expect(localStorage.getItem(LOCAL_REPORTS_KEY)).toBeNull();
    // Read again, from IndexedDB alone.
    resetProjectStore();
    expect((await loadProjects()).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('keeps both when an old tab wrote local storage after the move', async () => {
    await putProjects([project('a')]);
    localStorage.setItem(LOCAL_REPORTS_KEY, JSON.stringify([project('a', 'Old copy'), project('z')]));
    const list = await loadProjects();
    expect(list.map((r) => r.id)).toEqual(['a', 'z']);
    // What IndexedDB held wins over the old copy of the same project.
    expect(list[0].name).toBe('Project a');
    expect(localStorage.getItem(LOCAL_REPORTS_KEY)).toBeNull();
  });

  it('puts a save at the top, keeps a rename where it was, and deletes', async () => {
    await putProjects([project('a')]);
    await putProjects([project('b')]);
    await putProjects([project('c')]);
    expect((await loadProjects()).map((r) => r.id)).toEqual(['c', 'b', 'a']);
    await putProjects([project('a', 'Renamed')], false);
    const renamed = await loadProjects();
    expect(renamed.map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(renamed[2].name).toBe('Renamed');
    await putProjects([project('a', 'Saved again')]);
    expect((await loadProjects()).map((r) => r.id)).toEqual(['a', 'c', 'b']);
    expect(await deleteProjects(['c', 'missing'])).toEqual({ ok: true });
    expect((await loadProjects()).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('writes one record a save, never the whole list', async () => {
    await putProjects([project('a'), project('b')]);
    const put = vi.spyOn(fakeIdb!.IDBObjectStore.prototype, 'put');
    await putProjects([project('c')]);
    // The project, and the order: nothing of a or b is written again.
    const keys = put.mock.calls.map((call) => call[1]);
    expect(keys).toEqual(['c', 'ids']);
    put.mockRestore();
  });

  it('two saves close together both keep their project', async () => {
    await Promise.all([putProjects([project('a')]), putProjects([project('b')]), deleteProjects(['nothing'])]);
    expect((await loadProjects()).map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('changes nothing when a write fails, and says so in plain words', async () => {
    await putProjects([project('a')]);
    // A value the browser cannot store: the transaction is given up whole.
    const outcome = await putProjects([project('b'), { ...project('c'), result: (() => 1) as never }]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toMatch(/^There is not enough space left in this browser/);
    expect((await loadProjects()).map((r) => r.id)).toEqual(['a']);
  });

  it('lists a project the order does not name, newest first, and skips one it cannot list', async () => {
    await putProjects([project('a')]);
    await new Promise<void>((resolve) => {
      const req = indexedDB.open(PROJECTS_DB);
      req.onsuccess = () => {
        const tx = req.result.transaction(['projects'], 'readwrite');
        tx.objectStore('projects').put(project('n', 'Newer', '2026-12-01T00:00:00.000Z'), 'n');
        tx.objectStore('projects').put({ id: 'bad' }, 'bad');
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
      };
    });
    resetProjectStore();
    expect((await loadProjects()).map((r) => r.id)).toEqual(['a', 'n']);
  });
});

describe('a browser without IndexedDB', () => {
  it('keeps the projects in local storage, as before', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await putProjects([project('a')]);
    await putProjects([project('b')]);
    await putProjects([project('a', 'Renamed')], false);
    expect(JSON.parse(localStorage.getItem(LOCAL_REPORTS_KEY)!).map((r: { id: string }) => r.id)).toEqual(['b', 'a']);
    expect((await loadProjects()).map((r) => r.name)).toEqual(['Project b', 'Renamed']);
    await deleteProjects(['b']);
    expect((await loadProjects()).map((r) => r.id)).toEqual(['a']);
  });
});
