/**
 * Settings' "Download everything (.zip)" (lib/downloadEverything.ts), signed
 * out, over this browser's projects and memory, with the save itself caught.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const kept = vi.hoisted(() => ({ projects: [] as unknown[], memory: { memories: [] as unknown[], kept: [] as unknown[], ledger: [] as unknown[] }, saved: [] as string[] }));

vi.mock('./projectStore', () => ({ loadProjects: async () => kept.projects }));
vi.mock('./memory', () => ({ readMemory: () => kept.memory }));
vi.mock('./download', () => ({ saveBlob: (name: string) => kept.saved.push(name) }));
vi.mock('./firebaseClient', () => ({ loadFirebase: async () => { throw new Error('not signed in here'); } }));

const { downloadEverything, holdsExtras } = await import('./downloadEverything');

beforeEach(() => {
  kept.projects = [];
  kept.memory = { memories: [], kept: [], ledger: [] };
  kept.saved = [];
});

describe('downloadEverything', () => {
  it('saves nothing, and says so, when there is nothing to keep', async () => {
    expect(await downloadEverything(null)).toEqual({ projects: 0, saved: false });
    expect(kept.saved).toEqual([]);
  });

  /** The re-audit's R3-13: memories with no projects returned before the archive was built. */
  it('saves what Forma remembers with no projects at all', async () => {
    kept.memory = { memories: [{ id: 'm1', text: 'Totals in bold' }], kept: [], ledger: [] };
    expect(await downloadEverything(null)).toEqual({ projects: 0, saved: true });
    expect(kept.saved).toHaveLength(1);
  });

  it('counts the projects it saved', async () => {
    kept.projects = [{ id: 'p1', name: 'Invoice', timestamp: '2026-11-11T09:00:00.000Z', messages: [], result: null }];
    expect(await downloadEverything(null)).toEqual({ projects: 1, saved: true });
  });

  it('counts memory, learning and shares as something to keep, and versions alone as not', () => {
    expect(holdsExtras({})).toBe(false);
    expect(holdsExtras({ learning: [], shares: [], revisions: { p1: [] } })).toBe(false);
    expect(holdsExtras({ learning: [{}] })).toBe(true);
    expect(holdsExtras({ shares: [{ id: 's', name: 'n', access: 'link', invited: [] } as never] })).toBe(true);
    expect(holdsExtras({ memory: { memories: [] } })).toBe(true);
  });
});
