/**
 * What a sign-out removes from the tab (2026-11-08, the site audit's batch
 * SG): the public site and App share the list, and each key on it is the one
 * its own module writes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { forgetDevice, forgetLocal, forgetSession, SIGNED_OUT_DATABASES, SIGNED_OUT_LOCAL_KEYS, SIGNED_OUT_SESSION_KEYS } from './signOut';

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
});