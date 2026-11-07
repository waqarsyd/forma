/**
 * What a sign-out removes from the tab (2026-11-08, the site audit's batch
 * SG): the public site and App share the list, and each key on it is the one
 * its own module writes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { forgetSession, SIGNED_OUT_SESSION_KEYS } from './signOut';

describe('forgetSession', () => {
  it('removes every session key the workspace keeps, and nothing else', () => {
    const store = new Map<string, string>([...SIGNED_OUT_SESSION_KEYS.map((k) => [k, 'x'] as [string, string]), ['darkMode', 'true']]);
    forgetSession({ removeItem: (k: string) => void store.delete(k) });
    expect([...store.keys()]).toEqual(['darkMode']);
  });

  it('survives storage that throws', () => {
    expect(() => forgetSession({ removeItem: () => { throw new Error('blocked'); } })).not.toThrow();
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
