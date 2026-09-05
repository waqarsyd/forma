/**
 * Save a history, read it back, and get the same history.
 *
 * ## Why this is not covered by the two suites that already exist
 *
 * `src/lib/revisionStore.test.ts` proves the planning and the numbering against
 * arrays. `tests/firestore.rules.test.ts` proves the rules admit and reject the
 * right documents. Neither runs the two together, and the round trip is where
 * they can disagree: a plan that is correct in memory and a rule that is correct
 * in isolation still produce nothing useful if the write shape and the rule's
 * shape differ by one field, or if the read comes back in an order the numbering
 * did not expect.
 *
 * That last one is the specific defect this file exists for. `fromVersionDocuments`
 * numbers **downwards from the newest** because `pushRevision` takes the next id
 * from `list[0]`. Read the collection unordered and the highest id goes to
 * whichever document Firestore happened to return first — the list still renders,
 * the diffs still compute, and the next refinement collides with an existing id.
 * Nothing throws. An array test cannot see it, because an array test supplies its
 * own order.
 *
 * ## What it does and does not cover
 *
 * It drives `saveRevisions` and `loadRevisions` — the same functions `App.tsx`
 * calls — through a `VersionIo` built from the real Firestore SDK, against the
 * emulator, **with the production rules enforced through an authenticated
 * context**. So a rules change that blocks a version write fails here.
 *
 * It does not cover the React layer: that `handleSaveReport` calls one and
 * `handleLoadReport` calls the other, and that the panel renders what comes
 * back. Those are four lines in `App.tsx` and they are checked by reading, or by
 * driving the real app. The data path is the half that fails quietly.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  getDocs,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  type Firestore,
} from 'firebase/firestore';
import fs from 'node:fs';
import { versionsCollectionRef, versionDocRef } from '../src/lib/accountData';
import {
  saveRevisions,
  loadRevisions,
  versionDocId,
  MAX_PERSISTED_REVISIONS,
  VERSION_BUDGET_BYTES,
  type VersionIo,
  type VersionDocument,
} from '../src/lib/revisionStore';
import type { Revision } from '../src/lib/revisions';

const ALICE = 'alice-uid';
const BOB = 'bob-uid';
const REPORT = 'report-1';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'forma-roundtrip-test',
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

const asUser = (uid: string) =>
  testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;

/**
 * The same four operations `App.tsx` builds from `loadFirebase()`, built here
 * from the SDK directly. Keeping them identical is the point — a divergence
 * would mean this file tests something the app does not do.
 */
const io = (db: Firestore, uid: string, reportId = REPORT): VersionIo => {
  const collectionRef = versionsCollectionRef(db, uid, reportId);
  const docRef = (id: string) => versionDocRef(db, uid, reportId, id);
  return {
    list: async () => (await getDocs(collectionRef)).docs.map((entry) => entry.id),
    read: async () =>
      (await getDocs(query(collectionRef, orderBy('timestamp', 'desc')))).docs.map(
        (entry) => entry.data() as VersionDocument,
      ),
    write: async (document) => { await setDoc(docRef(document.id), document); },
    remove: async (id) => { await deleteDoc(docRef(id)); },
  };
};

const revision = (id: number, at: number, label = 'Generated'): Revision => ({
  id,
  label,
  at,
  snapshot: {
    content: `# Spec ${id}`,
    repxContent: `<XtraReportsLayoutSerializer Ref="${id}" />`,
    title: 'Quarterly Invoice',
    layout: { bands: [{ name: 'Detail' }] },
  },
});

/** Newest first, which is the order the in-memory list is always kept in. */
const history = (n: number): Revision[] =>
  Array.from({ length: n }, (_, i) => revision(n - i, (n - i) * 1000, `Step ${n - i}`));

describe('a history survives the trip to Firestore and back', () => {
  it('comes back with the same labels, times and snapshots', async () => {
    const db = asUser(ALICE);
    const original = history(3);

    await saveRevisions(io(db, ALICE), original, REPORT, ALICE);
    const back = await loadRevisions(io(db, ALICE));

    expect(back).toHaveLength(3);
    expect(back.map((r) => r.label)).toEqual(['Step 3', 'Step 2', 'Step 1']);
    expect(back.map((r) => r.at)).toEqual([3000, 2000, 1000]);
    expect(back.map((r) => r.snapshot)).toEqual(original.map((r) => r.snapshot));
  });

  /**
   * The defect this file exists for. Firestore's natural document order is by
   * id, and `versionDocId` is `${at}-${id}` — so ids sort lexicographically and
   * "1000-1" sorts before "3000-3". Without the `orderBy`, the oldest version
   * comes back first and takes the highest number.
   */
  it('numbers the newest highest, so the next revision cannot collide', async () => {
    const db = asUser(ALICE);
    await saveRevisions(io(db, ALICE), history(3), REPORT, ALICE);

    const back = await loadRevisions(io(db, ALICE));

    expect(back[0].label).toBe('Step 3');
    expect(back[0].id).toBe(Math.max(...back.map((r) => r.id)));
    const nextId = back[0].id + 1;
    expect(back.map((r) => r.id)).not.toContain(nextId);
  });

  it('reads an empty history as an empty list, not an error', async () => {
    expect(await loadRevisions(io(asUser(ALICE), ALICE))).toEqual([]);
  });
});

describe('saving twice', () => {
  it('writes only what is new the second time', async () => {
    const db = asUser(ALICE);
    const first = history(2);
    const firstOutcome = await saveRevisions(io(db, ALICE), first, REPORT, ALICE);
    expect(firstOutcome.written).toHaveLength(2);

    const second = [revision(3, 3000, 'Step 3'), ...first];
    const secondOutcome = await saveRevisions(io(db, ALICE), second, REPORT, ALICE);

    expect(secondOutcome.written).toEqual([versionDocId(second[0])]);
    expect(secondOutcome.deleted).toEqual([]);
    expect(await loadRevisions(io(db, ALICE))).toHaveLength(3);
  });

  it('is idempotent — saving an unchanged history writes nothing', async () => {
    const db = asUser(ALICE);
    const list = history(3);
    await saveRevisions(io(db, ALICE), list, REPORT, ALICE);

    const again = await saveRevisions(io(db, ALICE), list, REPORT, ALICE);

    expect(again).toEqual({ written: [], deleted: [], tooLarge: [] });
    expect(await loadRevisions(io(db, ALICE))).toHaveLength(3);
  });

  it('prunes what has aged past the cap', async () => {
    const db = asUser(ALICE);
    await saveRevisions(io(db, ALICE), history(MAX_PERSISTED_REVISIONS), REPORT, ALICE);

    // One more revision arrives; the oldest falls off the end.
    const grown = history(MAX_PERSISTED_REVISIONS + 1);
    const outcome = await saveRevisions(io(db, ALICE), grown, REPORT, ALICE);

    expect(outcome.written).toHaveLength(1);
    expect(outcome.deleted).toHaveLength(1);
    const back = await loadRevisions(io(db, ALICE));
    expect(back).toHaveLength(MAX_PERSISTED_REVISIONS);
    expect(back.map((r) => r.label)).not.toContain('Step 1');
  });
});

describe('what the rules do to a real save', () => {
  /**
   * The write shape and the rule's shape have to agree exactly. `hasOnly` means
   * one extra field on the document is a permission denial, not a warning — and
   * the app would report "history could not be synced" while everything looked
   * correct in the console.
   */
  it('accepts the document `toVersionDocument` actually produces', async () => {
    const outcome = await saveRevisions(io(asUser(ALICE), ALICE), history(1), REPORT, ALICE);
    expect(outcome.written).toHaveLength(1);
  });

  it('refuses a version written into another account', async () => {
    // Alice's authenticated context, Bob's path. The rule pins userId to the
    // caller, so this is the isolation guarantee reaching the real save path.
    await assertFails(saveRevisions(io(asUser(ALICE), BOB), history(1), REPORT, BOB));
  });

  it('refuses a version whose userId is not the caller', async () => {
    await assertFails(saveRevisions(io(asUser(ALICE), ALICE), history(1), REPORT, BOB));
  });
});

describe('a version too large to store', () => {
  it('is skipped, and the rest of the history still arrives', async () => {
    const db = asUser(ALICE);
    const huge: Revision = {
      id: 9,
      label: 'Huge',
      at: 9000,
      snapshot: {
        content: '# Spec',
        repxContent: 'x'.repeat(VERSION_BUDGET_BYTES + 1),
        title: 'Quarterly Invoice',
      },
    };

    const outcome = await saveRevisions(io(db, ALICE), [huge, ...history(2)], REPORT, ALICE);

    expect(outcome.tooLarge).toEqual([versionDocId(huge)]);
    const back = await loadRevisions(io(db, ALICE));
    expect(back.map((r) => r.label)).toEqual(['Step 2', 'Step 1']);
  });
});
