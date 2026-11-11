/**
 * What the persistence layer for revisions has to get right.
 *
 * Three of these encode a failure that is silent rather than loud, which is the
 * bar this project sets for a test being worth writing:
 *
 *   - a document id that repeats across sessions overwrites an unrelated
 *     version, and the history simply reads short;
 *   - a plan that rewrites every revision on every save costs ten writes where
 *     one was needed, and nothing about the result looks wrong;
 *   - a snapshot that will not parse throws inside a map and takes the whole
 *     history down with it, when losing one entry would have been fine.
 *
 * The emulator is not needed here: none of this touches Firestore. The writes
 * these plans describe are exercised by `tests/firestore.rules.test.ts`, which
 * runs under the other config.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Revision, RevisionSnapshot } from './revisions';
import {
  MAX_PERSISTED_REVISIONS,
  VERSION_BUDGET_BYTES,
  VERSION_SLOTS,
  isVersionSlot,
  versionKey,
  toVersionDocument,
  fromVersionDocument,
  fromVersionDocuments,
  planVersionWrites,
  saveRevisions,
  storedVersion,
  type StoredVersion,
  type VersionDocument,
  type VersionIo,
} from './revisionStore';

const snapshot = (repx = '<XtraReportsLayoutSerializer />'): RevisionSnapshot => ({
  content: '# Spec',
  repxContent: repx,
  title: 'Quarterly Invoice',
  layout: { bands: [] },
});

const revision = (id: number, at: number, label = 'Generated'): Revision => ({
  id,
  label,
  at,
  snapshot: snapshot(`<r n="${id}" />`),
});

/**
 * The slots (2026-11-11, the full audit's SA-01). The rule accepts a version
 * written to v0..v9 and nothing else, so the cap of ten is the database's and
 * not only this file's. A slot list and a rule that disagree fail as a
 * permission error on the first save past the shorter one, which reads like a
 * rules bug: so the rule's list is read here and held to `VERSION_SLOTS`.
 */
describe('the version slots', () => {
  it('are v0 to v9, one per version kept, and the rules accept exactly those', () => {
    expect(VERSION_SLOTS).toEqual(['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9']);
    expect(VERSION_SLOTS).toHaveLength(MAX_PERSISTED_REVISIONS);
    const rules = readFileSync('firestore.rules', 'utf8');
    const listed = /versionId in \[([^\]]*)\]/.exec(rules)?.[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    expect(listed).toEqual(VERSION_SLOTS);
    expect(isVersionSlot('v3')).toBe(true);
    expect(isVersionSlot('1700000000000-3')).toBe(false);
  });

  /**
   * Which revision a slot holds is read off the document, since the slot says
   * nothing. `Revision.id` restarts at 1 in every session, so it cannot be it:
   * two sessions' first revisions must not read as the same one.
   */
  it('know a revision by its time and label, not the session counter', () => {
    expect(versionKey(revision(1, 1_700_000_000_000))).not.toBe(versionKey(revision(1, 1_700_000_060_000)));
    expect(versionKey(revision(1, 100, 'A'))).toBe(versionKey(revision(7, 100, 'A')));
  });
});

describe('toVersionDocument', () => {
  it('writes the six fields the rules pin, and no others', () => {
    const document = toVersionDocument(revision(1, 1_700_000_000_000), 'rep-1', 'uid-1', 'v0');
    expect(Object.keys(document).sort()).toEqual(
      ['id', 'label', 'reportId', 'snapshot', 'timestamp', 'userId'].sort(),
    );
    // The rule holds the id field to the document's own id, the slot.
    expect(document.id).toBe('v0');
  });

  it('carries the report id on the document as well as in the path', () => {
    // The rule pins this against the {reportId} wildcard, so a version cannot
    // claim to belong to a report other than the one it is filed under.
    expect(toVersionDocument(revision(1, 1), 'rep-1', 'uid-1', 'v0').reportId).toBe('rep-1');
  });

  it('serialises the snapshot as a string, like the report document does', () => {
    const document = toVersionDocument(revision(1, 1), 'rep-1', 'uid-1', 'v0');
    expect(typeof document.snapshot).toBe('string');
    expect(JSON.parse(document.snapshot).title).toBe('Quarterly Invoice');
  });
});

describe('fromVersionDocument', () => {
  const stored = (over: Partial<VersionDocument> = {}): VersionDocument => ({
    id: '1700000000000-1',
    reportId: 'rep-1',
    label: 'Refined',
    timestamp: 1_700_000_000_000,
    snapshot: JSON.stringify(snapshot()),
    userId: 'uid-1',
    ...over,
  });

  it('round-trips a revision', () => {
    const original = revision(4, 1_700_000_000_000, 'Bound to data');
    const back = fromVersionDocument(toVersionDocument(original, 'rep-1', 'uid-1', 'v4'), 0);
    expect(back?.label).toBe('Bound to data');
    expect(back?.at).toBe(original.at);
    expect(back?.snapshot).toEqual(original.snapshot);
  });

  /**
   * The id comes from the caller, not the document. The stored id is a document
   * key — a slot, `v3`, or `1700000000000-1` before the slots — and the
   * in-memory one is a number.
   */
  it('takes its in-memory id from the caller', () => {
    expect(fromVersionDocument(stored(), 7)?.id).toBe(7);
  });

  it('returns null for a snapshot that will not parse', () => {
    expect(fromVersionDocument(stored({ snapshot: 'not json' }), 0)).toBeNull();
  });

  it('returns null for a snapshot with no REPX in it', () => {
    // Restoring this would put the app in a state with no report to show.
    expect(fromVersionDocument(stored({ snapshot: '{"content":"x"}' }), 0)).toBeNull();
  });

  it('falls back rather than throwing on a missing label or timestamp', () => {
    const back = fromVersionDocument(
      stored({ label: undefined as unknown as string, timestamp: undefined as unknown as number }),
      0,
    );
    expect(back?.label).toBe('Version');
    expect(back?.at).toBe(0);
  });
});

describe('fromVersionDocuments', () => {
  const doc = (id: string, label: string, timestamp: number, snap = JSON.stringify(snapshot())): VersionDocument =>
    ({ id, reportId: 'rep-1', label, timestamp, snapshot: snap, userId: 'uid-1' });

  /**
   * The one that would be a silent, wrong-version-restored bug.
   *
   * `pushRevision` reads the next id off `list[0]`. If loading numbers the
   * newest 1, the next refinement is also handed 2 — two rows with the same
   * React key, and "Restore" on one opening the other. Numbering downwards from
   * the newest is what keeps `list[0].id` the maximum.
   */
  it('numbers downwards, so the newest holds the highest id', () => {
    const revisions = fromVersionDocuments([
      doc('c', 'Newest', 300),
      doc('b', 'Middle', 200),
      doc('a', 'Oldest', 100),
    ]);
    expect(revisions.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(revisions[0].label).toBe('Newest');
  });

  it('gives pushRevision a next id that collides with nothing', () => {
    const loaded = fromVersionDocuments([doc('c', 'C', 300), doc('b', 'B', 200)]);
    const next = (loaded[0]?.id ?? 0) + 1;
    expect(loaded.map((r) => r.id)).not.toContain(next);
  });

  it('drops a corrupt version and keeps the numbering contiguous', () => {
    const revisions = fromVersionDocuments([
      doc('c', 'Newest', 300),
      doc('b', 'Corrupt', 200, 'not json'),
      doc('a', 'Oldest', 100),
    ]);
    expect(revisions.map((r) => r.label)).toEqual(['Newest', 'Oldest']);
    expect(revisions.map((r) => r.id)).toEqual([2, 1]);
  });

  it('reads an empty history as an empty list', () => {
    expect(fromVersionDocuments([])).toEqual([]);
  });
});

describe('planVersionWrites', () => {
  const list = [revision(3, 300), revision(2, 200), revision(1, 100)];
  /** A stored version holding `r`, in `slot`. */
  const at = (slot: string, r: Revision): StoredVersion => ({ id: slot, timestamp: r.at, label: r.label });
  /** Which revision each planned write carries, by its time, slot by slot. */
  const writes = (plan: ReturnType<typeof planVersionWrites>) => plan.toWrite.map((d) => `${d.id}:${d.timestamp}`);

  it('writes everything when nothing is stored, into the first slots', () => {
    const plan = planVersionWrites(list, [], 'rep-1', 'uid-1');
    expect(writes(plan)).toEqual(['v0:300', 'v1:200', 'v2:100']);
    expect(plan.toDelete).toEqual([]);
  });

  /**
   * The point of planning at all. A save that adds one revision should cost one
   * write; rewriting all ten every time is nine wasted round trips and nothing
   * in the result would look different.
   */
  it('writes only what is new, into a free slot', () => {
    const plan = planVersionWrites(list, [at('v0', list[1]), at('v1', list[2])], 'rep-1', 'uid-1');
    expect(writes(plan)).toEqual(['v2:300']);
    expect(plan.toDelete).toEqual([]);
  });

  it('plans nothing when a save adds nothing', () => {
    const plan = planVersionWrites(list, [at('v5', list[0]), at('v0', list[1]), at('v9', list[2])], 'rep-1', 'uid-1');
    expect(plan.toWrite).toEqual([]);
    expect(plan.toDelete).toEqual([]);
  });

  it('writes a new version over one that has fallen out of the history, rather than deleting it', () => {
    const gone = revision(0, 50);
    const plan = planVersionWrites(list, [at('v0', list[0]), at('v1', gone)], 'rep-1', 'uid-1');
    expect(writes(plan)).toEqual(['v1:200', 'v2:100']);
    expect(plan.toDelete).toEqual([]);
  });

  it('deletes a slot whose version has gone when nothing new needs it', () => {
    const plan = planVersionWrites([list[0]], [at('v0', list[0]), at('v1', revision(0, 50))], 'rep-1', 'uid-1');
    expect(plan.toWrite).toEqual([]);
    expect(plan.toDelete).toEqual(['v1']);
  });

  /**
   * Versions saved before the slots sit under their own ids, which the rule no
   * longer accepts a write to. Each is deleted, and the revision it held, when
   * still kept, is written again into a slot, so a report's history moves into
   * the slots at its next save and loses nothing.
   */
  it('moves a version stored before the slots into one, and deletes the old id', () => {
    const plan = planVersionWrites(list, [at('300-3', list[0]), at('100-1', list[2])], 'rep-1', 'uid-1');
    expect(writes(plan)).toEqual(['v0:300', 'v1:200', 'v2:100']);
    expect(plan.toDelete).toEqual(['300-3', '100-1']);
    // Each only once its slot's write has landed (R3-07).
    expect(plan.movedFrom).toEqual({ '300-3': 'v0', '100-1': 'v2' });
  });

  /**
   * The re-audit's R3-07. An old id whose version is kept but cannot be
   * written into a slot, over budget or with a time the rules refuse (a
   * document read back with none has 0), is the only copy there is: it stays.
   * One whose version is no longer kept, or already sits in a slot, goes.
   */
  it('keeps an old id whose kept version cannot move, and deletes one whose version is gone or moved already', () => {
    const huge: Revision = { id: 9, label: 'Huge', at: 900, snapshot: snapshot('x'.repeat(VERSION_BUDGET_BYTES + 1)) };
    const timeless: Revision = { ...revision(8, 0, 'Old'), at: 0 };
    const plan = planVersionWrites(
      [huge, timeless, ...list],
      [at('900-9', huge), at('0-8', timeless), at('v4', list[0]), at('300-3', list[0]), at('50-0', revision(0, 50))],
      'rep-1',
      'uid-1',
    );
    expect(writes(plan)).toEqual(['v0:200', 'v1:100']);
    expect(plan.toDelete).toEqual(['300-3', '50-0']);
    expect(plan.movedFrom).toEqual({});
    // The timeless one is not kept in the account either, and the save says so.
    expect(plan.tooLarge).toEqual([versionKey(huge), versionKey(timeless)]);
  });

  /**
   * The in-memory list holds twenty and the stored one holds ten, so a long
   * session always presents more than the cap. The overflow must be dropped
   * from the oldest end, not the newest — the recent versions are the ones
   * anyone returns to.
   */
  it('stores at most the cap, newest first, and never past the tenth slot', () => {
    const many = Array.from({ length: 20 }, (_, i) => revision(20 - i, (20 - i) * 100));
    const plan = planVersionWrites(many, [], 'rep-1', 'uid-1');
    expect(plan.toWrite).toHaveLength(MAX_PERSISTED_REVISIONS);
    expect(plan.toWrite[0].timestamp).toBe(2000);
    expect(plan.toWrite.at(-1)?.timestamp).toBe(1100);
    expect(plan.toWrite.every((d) => isVersionSlot(d.id))).toBe(true);
    // A larger cap asked for is still ten: there are ten slots.
    expect(planVersionWrites(many, [], 'rep-1', 'uid-1', 15).toWrite).toHaveLength(MAX_PERSISTED_REVISIONS);
  });

  it('reuses the slot of a version that has aged past the cap', () => {
    const many = Array.from({ length: 11 }, (_, i) => revision(11 - i, (11 - i) * 100));
    // Ten stored, the oldest (100) in v3; the newest (1100) arrives.
    const stored = many.slice(1).map((r, i) => at(`v${(i + 3) % 10}`, r));
    const oldest = stored.find((s) => s.timestamp === 100)!;
    const plan = planVersionWrites(many, stored, 'rep-1', 'uid-1');
    expect(writes(plan)).toEqual([`${oldest.id}:1100`]);
    expect(plan.toDelete).toEqual([]);
  });

  it('honours a caller-supplied cap', () => {
    expect(planVersionWrites(list, [], 'rep-1', 'uid-1', 2).toWrite).toHaveLength(2);
  });

  /**
   * One oversized version is skipped and the rest still go. Failing the whole
   * save because one snapshot is large would lose the history a person could
   * have had, to protect them from a limit that only affects one entry.
   */
  it('skips a version over budget and keeps the others', () => {
    const huge: Revision = {
      id: 9,
      label: 'Huge',
      at: 900,
      snapshot: snapshot('x'.repeat(VERSION_BUDGET_BYTES + 1)),
    };
    const plan = planVersionWrites([huge, ...list], [], 'rep-1', 'uid-1');
    expect(plan.tooLarge).toEqual([versionKey(huge)]);
    expect(writes(plan)).toEqual(['v0:300', 'v1:200', 'v2:100']);
  });

  it('does not promote an older version into the place an oversized one vacated', () => {
    // The cap is applied to the history, then the budget to what survived. So a
    // skipped version leaves a gap rather than pulling an older one forward:
    // the stored history stays a prefix of the real one, which is what makes
    // "the last N versions" an honest description of the panel.
    const huge: Revision = {
      id: 9,
      label: 'Huge',
      at: 900,
      snapshot: snapshot('x'.repeat(VERSION_BUDGET_BYTES + 1)),
    };
    const plan = planVersionWrites([huge, ...list], [], 'rep-1', 'uid-1', 2);
    expect(plan.tooLarge).toEqual([versionKey(huge)]);
    expect(writes(plan)).toEqual(['v0:300']);
  });

  it('leaves an empty history planning nothing', () => {
    const plan = planVersionWrites([], [], 'rep-1', 'uid-1');
    expect(plan).toEqual({ toWrite: [], toDelete: [], movedFrom: {}, tooLarge: [] });
  });

  it('deletes every stored version when the history is emptied', () => {
    expect(planVersionWrites([], [at('v0', list[0]), at('300-3', list[0])], 'rep-1', 'uid-1').toDelete)
      .toEqual(['v0', '300-3']);
  });

  /**
   * The re-audit's R3-07: writes and deletes went out together, so a slot
   * write that failed lost the old copy it was replacing. Now the writes
   * settle first, and an old id goes only once its version's slot is written.
   */
  it('deletes after writing, and keeps the old copy of a version whose slot write failed', async () => {
    const events: string[] = [];
    const io: VersionIo = {
      list: async () => [at('300-3', list[0]), at('200-2', list[1]), at('7-7', revision(7, 7))],
      read: async () => [],
      write: async (d) => {
        events.push(`write ${d.id}`);
        await Promise.resolve();
        if (d.timestamp === 200) throw new Error('refused');
        events.push(`wrote ${d.id}`);
      },
      remove: async (id) => {
        events.push(`remove ${id}`);
      },
    };
    await expect(saveRevisions(io, list, 'rep-1', 'uid-1')).rejects.toThrow('refused');
    // The version at 200 failed to land in v1, so its only copy, 200-2, stays.
    expect(events.filter((e) => e.startsWith('remove')).sort()).toEqual(['remove 300-3', 'remove 7-7']);
    // Every remove after every write settled.
    const lastWrite = Math.max(...events.map((e, i) => (e.startsWith('write') || e.startsWith('wrote') ? i : -1)));
    expect(events.findIndex((e) => e.startsWith('remove'))).toBeGreaterThan(lastWrite);
  });

  it('reads a stored document as what it holds, whatever is missing', () => {
    expect(storedVersion('v2', { timestamp: 5, label: 'X' })).toEqual({ id: 'v2', timestamp: 5, label: 'X' });
    expect(storedVersion('v2', undefined)).toEqual({ id: 'v2', timestamp: 0, label: '' });
  });
});
