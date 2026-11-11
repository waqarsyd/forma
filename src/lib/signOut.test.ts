/**
 * What a sign-out removes from the tab (2026-11-08, the site audit's batch
 * SG): the public site and App share the list, and each key on it is the one
 * its own module writes.
 */
import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { forgetAccountLocally, forgetDevice, forgetLocal, forgetSession, FIRESTORE_CACHE_PREFIX, SIGNED_OUT_DATABASES, SIGNED_OUT_LOCAL_KEYS, SIGNED_OUT_SESSION_KEYS } from './signOut';
import { closeFirebase } from './firebaseClient';

vi.mock('./firebaseClient', () => ({ closeFirebase: vi.fn(async () => undefined) }));

/** A localStorage over a Map, with the `key`/`length` walk `forgetLocal` uses. */
function fakeLocal(entries: [string, string][]) {
  const map = new Map(entries);
  return {
    map,
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
  };
}

describe('forgetSession', () => {
  it('removes every session key the workspace keeps, and nothing else', () => {
    const store = new Map<string, string>([...SIGNED_OUT_SESSION_KEYS.map((k) => [k, 'x'] as [string, string]), ['darkMode', 'true']]);
    forgetSession({ removeItem: (k: string) => void store.delete(k) }, null);
    expect([...store.keys()]).toEqual(['darkMode']);
  });

  it('survives storage that throws', () => {
    expect(() => forgetSession({ removeItem: () => { throw new Error('blocked'); } }, null)).not.toThrow();
  });

  // The SA-18 review (2026-11-11): a sign-out on the public site left a terminated database for the next sign-in in that tab.
  it('closes the database this tab opened, on the public site as in App', () => {
    vi.mocked(closeFirebase).mockClear();
    forgetSession({ removeItem: () => undefined }, null);
    expect(closeFirebase).toHaveBeenCalledTimes(1);
  });

  // The full audit (2026-11-11, SA-07): what lasts in localStorage goes too, and the preferences that are not a person's stay.
  it('removes the pins, the archive, the house-style ticks and every account\'s project check, and nothing else', () => {
    const local = fakeLocal([
      ['forma:pinnedProjects', '["a"]'],
      ['forma:archivedProjects', '["b"]'],
      ['libraryCanonical', '["Invoice.repx"]'],
      ['forma:indexCheckedAt:alice', '1'],
      ['forma:indexCheckedAt:bob', '2'],
      ['darkMode', 'true'],
      ['forma.memory:alice', '{}'],
    ]);
    forgetSession({ removeItem: () => undefined }, local);
    expect([...local.map.keys()]).toEqual(['darkMode', 'forma.memory:alice']);
  });

  it('survives localStorage that throws, or none', () => {
    const throwing = { length: 1, key: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(() => forgetLocal(throwing)).not.toThrow();
    expect(() => forgetLocal(null)).not.toThrow();
  });

  it('names each lasting key as App writes it', () => {
    const app = readFileSync('src/App.tsx', 'utf8').replace(/"/g, "'");
    for (const key of SIGNED_OUT_LOCAL_KEYS) expect(app).toContain(`'${key}'`);
    expect(app).toContain('`forma:indexCheckedAt:${uid}`');
  });

  it('names each key as the module that writes it does', () => {
    const src = (f: string) => readFileSync(`src/${f}`, 'utf8').replace(/"/g, "'");
    expect(src('services/keyVault.ts')).toContain("'geminiApiKey:session'");
    expect(src('lib/aiProvider.ts')).toContain("'openRouterKey:session'");
    expect(src('lib/composerStore.ts')).toContain("'forma:drafts'");
    expect(src('lib/composerStore.ts')).toContain("'forma:queue'");
    expect(src('App.tsx')).toContain("'forma:openProject'");
    expect(src('lib/replyChanges.ts')).toContain("'forma:replyChanges'");
  });
});

/* The database layouts kept on this device (2026-11-09, the SQL Server programme, item 32). */
describe('the device', () => {
  it('loses the SQL Server layouts and sample rows on sign-out, by the name the store uses', () => {
    const deleted: string[] = [];
    forgetDevice({ deleteDatabase: (name: string) => { deleted.push(name); return {} as IDBOpenDBRequest; } });
    expect(deleted).toEqual(['forma-databases', 'forma-batch', 'forma-learning', 'forma-library']);
    expect(readFileSync('src/lib/sqlSchemaStore.ts', 'utf8')).toContain(`const DB_NAME = '${SIGNED_OUT_DATABASES[0]}'`);
  });

  // Batch AG, item 23 (2026-11-10): the batch kept to carry on after a limit holds files and reports too.
  it('loses the kept batch on sign-out, by the name its store uses', () => {
    expect(readFileSync('src/lib/batchCheckpoint.ts', 'utf8')).toContain(`export const BATCH_DB = '${SIGNED_OUT_DATABASES[1]}'`);
  });

  // The full audit (2026-11-10): the learning events kept on the device may hold whole reports on the opt-in tier.
  it('loses the learning events on sign-out, by the name their store uses', () => {
    expect(readFileSync('src/lib/learning.ts', 'utf8')).toContain(`export const LEARNING_DB_NAME = '${SIGNED_OUT_DATABASES[2]}'`);
  });

  // The full audit (2026-11-11, WS-28, SE-17): the report library held the last person's reports and fed their house style to the next one's AI.
  it('loses the report library on sign-out, by the name its store uses', () => {
    expect(readFileSync('src/lib/libraryDb.ts', 'utf8')).toContain(`export const LIBRARY_DB_NAME = '${SIGNED_OUT_DATABASES[3]}'`);
  });

  it('survives IndexedDB that throws, or none', () => {
    expect(() => forgetDevice({ deleteDatabase: () => { throw new Error('blocked'); } })).not.toThrow();
    expect(() => forgetDevice(null)).not.toThrow();
  });

  // The full audit's SA-18 (2026-11-11): the account's projects kept by Firestore in this browser go too.
  it("deletes Firestore's own copy of the account, by the prefix its names start with, and nothing else of the browser's", async () => {
    const deleted: string[] = [];
    forgetDevice({
      deleteDatabase: (name: string) => {
        deleted.push(name);
        return {} as IDBOpenDBRequest;
      },
      databases: async () => [{ name: 'firestore/[DEFAULT]/forma-201ba.ai-studio-db/main', version: 1 }, { name: 'someone-elses-site-db', version: 1 }, { version: 1 }],
    });
    // The listing answers later; let it.
    await new Promise((settled) => setTimeout(settled, 0));
    expect(deleted).toEqual([...SIGNED_OUT_DATABASES, 'firestore/[DEFAULT]/forma-201ba.ai-studio-db/main']);
    expect(() => forgetDevice({ deleteDatabase: () => ({}) as IDBOpenDBRequest, databases: () => Promise.reject(new Error('blocked')) })).not.toThrow();
    await new Promise((settled) => setTimeout(settled, 0));
  });

  it('names the prefix the Firestore SDK builds its names with', () => {
    // The browser build: its entry and the shared chunk it imports, whatever its hashed name.
    const dist = 'node_modules/@firebase/firestore/dist';
    const files = ['index.esm.js', ...readdirSync(dist).filter((f) => /^common-.*\.esm\.js$/.test(f))];
    expect(files.some((f) => readFileSync(`${dist}/${f}`, 'utf8').includes(`"${FIRESTORE_CACHE_PREFIX}" + `))).toBe(true);
  });
});

/* A deleted account (2026-11-11, the full audit, a wave-4 follow-up): what this browser kept that names it. */
describe('forgetAccountLocally', () => {
  function store(entries: [string, string][]) {
    const map = new Map(entries);
    return { map, getItem: (k: string) => map.get(k) ?? null, removeItem: (k: string) => void map.delete(k) };
  }

  it("removes the account's memory, its project check and learning switches that name it, and leaves everyone else's", () => {
    const local = store([
      ['forma.memory:alice', '{}'],
      ['forma.memory:bob', '{}'],
      ['forma.memory', '{}'],
      ['forma:indexCheckedAt:alice', '1'],
      ['forma:learning', JSON.stringify({ uid: 'alice', structure: true, full: true })],
    ]);
    forgetAccountLocally('alice', local);
    expect([...local.map.keys()]).toEqual(['forma.memory:bob', 'forma.memory']);
  });

  it("keeps learning switches that are another account's, and survives storage that throws", () => {
    const local = store([['forma:learning', JSON.stringify({ uid: 'bob', structure: false, full: false })]]);
    forgetAccountLocally('alice', local);
    expect(local.map.has('forma:learning')).toBe(true);
    expect(() => forgetAccountLocally('alice', { getItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } })).not.toThrow();
  });

  it('names each key as the module that writes it does', () => {
    expect(readFileSync('src/lib/memory.ts', 'utf8')).toContain("const STORAGE_KEY = 'forma.memory'");
    expect(readFileSync('src/lib/memory.ts', 'utf8')).toContain('`${STORAGE_KEY}:${uid}`');
    expect(readFileSync('src/lib/learning.ts', 'utf8')).toContain("const SETTINGS_KEY = 'forma:learning'");
  });
});