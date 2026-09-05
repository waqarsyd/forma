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
import type { Revision, RevisionSnapshot } from './revisions';
import {
  MAX_PERSISTED_REVISIONS,
  VERSION_BUDGET_BYTES,
  versionDocId,
  toVersionDocument,
  fromVersionDocument,
  fromVersionDocuments,
  planVersionWrites,
  type VersionDocument,
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

describe('versionDocId', () => {
  it('pairs the timestamp with the session counter', () => {
    expect(versionDocId(revision(3, 1_700_000_000_000))).toBe('1700000000000-3');
  });

  /**
   * The reason it is not just `revision.id`. That counter restarts at 1 in
   * every session, so saving, reloading and saving again would file the new
   * first revision on top of the old one — losing a version with no error
   * anywhere. Two sessions producing id 1 must not collide.
   */
  it('separates the same counter in two sessions', () => {
    expect(versionDocId(revision(1, 1_700_000_000_000)))
      .not.toBe(versionDocId(revision(1, 1_700_000_060_000)));
  });

  /**
   * `isValidId` in firestore.rules is `^[a-zA-Z0-9_\-]+$` and 128 characters.
   * A document id that fails it is rejected by the rule, not by the SDK, so the
   * failure arrives as a permission error and reads like a rules bug.
   */
  it('produces an id the rules will accept', () => {
    const id = versionDocId(revision(12, Date.now()));
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(id.length).toBeLessThanOrEqual(128);
  });
});

describe('toVersionDocument', () => {
  it('writes the six fields the rules pin, and no others', () => {
    const document = toVersionDocument(revision(1, 1_700_000_000_000), 'rep-1', 'uid-1');
    expect(Object.keys(document).sort()).toEqual(
      ['id', 'label', 'reportId', 'snapshot', 'timestamp', 'userId'].sort(),
    );
  });

  it('carries the report id on the document as well as in the path', () => {
    // The rule pins this against the {reportId} wildcard, so a version cannot
    // claim to belong to a report other than the one it is filed under.
    expect(toVersionDocument(revision(1, 1), 'rep-1', 'uid-1').reportId).toBe('rep-1');
  });

  it('serialises the snapshot as a string, like the report document does', () => {
    const document = toVersionDocument(revision(1, 1), 'rep-1', 'uid-1');
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
    const back = fromVersionDocument(toVersionDocument(original, 'rep-1', 'uid-1'), 0);
    expect(back?.label).toBe('Bound to data');
    expect(back?.at).toBe(original.at);
    expect(back?.snapshot).toEqual(original.snapshot);
  });

  /**
   * The id comes from the caller, not the document. The stored id is a document
   * key — `1700000000000-1` — and the in-memory one is a number.
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

  it('writes everything when nothing is stored', () => {
    const plan = planVersionWrites(list, [], 'rep-1', 'uid-1');
    expect(plan.toWrite.map((d) => d.id)).toEqual(['300-3', '200-2', '100-1']);
    expect(plan.toDelete).toEqual([]);
  });

  /**
   * The point of planning at all. A save that adds one revision should cost one
   * write; rewriting all ten every time is nine wasted round trips and nothing
   * in the result would look different.
   */
  it('writes only what is new', () => {
    const plan = planVersionWrites(list, ['200-2', '100-1'], 'rep-1', 'uid-1');
    expect(plan.toWrite.map((d) => d.id)).toEqual(['300-3']);
  });

  it('plans nothing when a save adds nothing', () => {
    const plan = planVersionWrites(list, ['300-3', '200-2', '100-1'], 'rep-1', 'uid-1');
    expect(plan.toWrite).toEqual([]);
    expect(plan.toDelete).toEqual([]);
  });

  it('deletes what has fallen out of the history', () => {
    const plan = planVersionWrites(list, ['300-3', '050-0'], 'rep-1', 'uid-1');
    expect(plan.toDelete).toEqual(['050-0']);
  });

  /**
   * The in-memory list holds twenty and the stored one holds ten, so a long
   * session always presents more than the cap. The overflow must be dropped
   * from the oldest end, not the newest — the recent versions are the ones
   * anyone returns to.
   */
  it('stores at most the cap, newest first', () => {
    const many = Array.from({ length: 20 }, (_, i) => revision(20 - i, (20 - i) * 100));
    const plan = planVersionWrites(many, [], 'rep-1', 'uid-1');
    expect(plan.toWrite).toHaveLength(MAX_PERSISTED_REVISIONS);
    expect(plan.toWrite[0].id).toBe('2000-20');
    expect(plan.toWrite.at(-1)?.id).toBe('1100-11');
  });

  it('prunes a version that has aged past the cap', () => {
    const many = Array.from({ length: 12 }, (_, i) => revision(12 - i, (12 - i) * 100));
    const plan = planVersionWrites(many, ['100-1'], 'rep-1', 'uid-1');
    expect(plan.toDelete).toEqual(['100-1']);
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
    expect(plan.tooLarge).toEqual(['900-9']);
    expect(plan.toWrite.map((d) => d.id)).toEqual(['300-3', '200-2', '100-1']);
  });

  it('does not promote an older version into the slot an oversized one vacated', () => {
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
    expect(plan.tooLarge).toEqual(['900-9']);
    expect(plan.toWrite.map((d) => d.id)).toEqual(['300-3']);
  });

  it('leaves an empty history planning nothing', () => {
    const plan = planVersionWrites([], [], 'rep-1', 'uid-1');
    expect(plan).toEqual({ toWrite: [], toDelete: [], tooLarge: [] });
  });

  it('deletes every stored version when the history is emptied', () => {
    expect(planVersionWrites([], ['300-3', '200-2'], 'rep-1', 'uid-1').toDelete)
      .toEqual(['300-3', '200-2']);
  });
});
