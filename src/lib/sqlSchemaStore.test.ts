/**
 * The database layouts kept on this device, read and written through IndexedDB
 * (2026-11-11, the full audit, TC-07). A layout is the company's structure and
 * may carry sample rows of real values, so keeping, replacing and forgetting
 * have to do exactly what Settings and the Data tab say they do. `keepRecent`,
 * the pure half, is tested in `sqlSchema.test.ts`; this file is the storage.
 *
 * A fresh in-memory IndexedDB from `fake-indexeddb` per case, put where the
 * store looks for it (the global `indexedDB`). It is loaded through a computed
 * specifier, so that a node_modules installed before the devDependency arrived
 * skips these cases by name instead of failing to load the file; CI installs
 * from the lockfile, so there a missing package is an error, never a skip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlSchema } from './sqlSchema';
import { forgetDatabase, loadDatabases, MAX_DATABASES, saveDatabase } from './sqlSchemaStore';

const FAKE_IDB = 'fake-indexeddb';
const fakeIdb = (await import(/* @vite-ignore */ FAKE_IDB).catch(() => null)) as { IDBFactory: new () => IDBFactory } | null;
if (!fakeIdb && process.env.CI) throw new Error('fake-indexeddb is a devDependency and is not installed: run npm ci.');

const schema = (database: string, samples?: SqlSchema['samples']): SqlSchema => ({
  source: 'script',
  database,
  objects: [],
  foreignKeys: [],
  procedures: [],
  ...(samples ? { samples } : {}),
});

describe.runIf(fakeIdb)('the layouts kept on this device', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new fakeIdb!.IDBFactory());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps a layout and reads it back, newest first', async () => {
    await saveDatabase(schema('Sales'), 1_000);
    const returned = await saveDatabase(schema('Stock'), 2_000);

    const read = await loadDatabases();
    expect(read.map((d) => d.name)).toEqual(['Stock', 'Sales']);
    expect(read).toEqual(returned);
    expect(read[1]).toEqual({ name: 'Sales', savedAt: 1_000, schema: schema('Sales') });
  });

  it('replaces a database imported again, keeping the sample rows the new import lacks', async () => {
    const rows = { 'dbo.Orders': [{ Id: 1 }] };
    await saveDatabase(schema('Sales', rows), 1_000);
    await saveDatabase(schema('Sales'), 2_000);

    const read = await loadDatabases();
    expect(read).toHaveLength(1);
    expect(read[0].savedAt).toBe(2_000);
    expect(read[0].schema.samples).toEqual(rows);
  });

  it(`keeps at most ${MAX_DATABASES}, dropping the oldest from storage too`, async () => {
    for (let n = 0; n <= MAX_DATABASES; n++) await saveDatabase(schema(`Db${n}`), 1_000 + n);

    const read = await loadDatabases();
    expect(read).toHaveLength(MAX_DATABASES);
    expect(read.some((d) => d.name === 'Db0')).toBe(false);
    expect(read[0].name).toBe(`Db${MAX_DATABASES}`);
  });

  it('forgets one layout and leaves the others', async () => {
    await saveDatabase(schema('Sales'), 1_000);
    await saveDatabase(schema('Stock'), 2_000);
    await forgetDatabase('Sales');

    expect((await loadDatabases()).map((d) => d.name)).toEqual(['Stock']);
    await expect(forgetDatabase('Nothing kept')).resolves.toBeUndefined();
  });

  it('keeps a nameless layout as "Database"', async () => {
    await saveDatabase(schema('  '), 1_000);
    expect((await loadDatabases()).map((d) => d.name)).toEqual(['Database']);
  });
});

describe('a browser with no IndexedDB', () => {
  it('reads nothing, still answers a save with the list, and forgets without failing', async () => {
    vi.stubGlobal('indexedDB', undefined);
    try {
      expect(await loadDatabases()).toEqual([]);
      const next = await saveDatabase(schema('Sales'), 1_000);
      expect(next.map((d) => d.name)).toEqual(['Sales']);
      await expect(forgetDatabase('Sales')).resolves.toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
