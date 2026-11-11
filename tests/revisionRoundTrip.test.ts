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
  setLogLevel,
  type Firestore,
} from 'firebase/firestore';
import fs from 'node:fs';
import { reportDocRef, versionsCollectionRef, versionDocRef } from '../src/lib/accountData';
import {
  saveRevisions,
  loadRevisions,
  storedVersion,
  versionKey,
  MAX_PERSISTED_REVISIONS,
  VERSION_BUDGET_BYTES,
  VERSION_SLOTS,
  type VersionIo,
  type VersionDocument,
} from '../src/lib/revisionStore';
import type { Revision } from '../src/lib/revisions';

// The denials this file expects are also logged by the SDK as PERMISSION_DENIED
// warnings, noise that hid real ones (2026-11-11, the full audit, TC-13).
setLogLevel('silent');

const ALICE = 'alice-uid';
const BOB = 'bob-uid';
const REPORT = 'report-1';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'forma-roundtrip-test',
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
      // Where `firebase emulators:exec` started it, which it tells this process;
      // 8181, as firebase.json sets it, when run some other way (2026-11-06; 8080 until 2026-11-08).
      host: (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8181').split(':')[0],
      port: Number((process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8181').split(':')[1]),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // A version is filed only under a report the account holds (2026-11-11, the
  // re-audit's R5-01), as App writes the report before its history.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(reportDocRef(ctx.firestore() as unknown as Firestore, ALICE, REPORT), { id: REPORT, name: 'Quarterly Invoice', timestamp: Date.now(), messages: '[]', result: '{}', userId: ALICE });
  });
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
    list: async () => (await getDocs(collectionRef)).docs.map((entry) => storedVersion(entry.id, entry.data() as Partial<VersionDocument>)),
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
   * id, and since 2026-11-11 a version's id is its slot, v0..v9, which says
   * nothing of its age: a slot reused for the newest version can sort first or
   * last. Without the `orderBy`, whichever document comes back first takes the
   * highest number.
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

    // Into the first free slot: v0 and v1 hold the first two.
    expect(secondOutcome.written).toEqual(['v2']);
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

  it('prunes what has aged past the cap, by writing over its slot', async () => {
    const db = asUser(ALICE);
    await saveRevisions(io(db, ALICE), history(MAX_PERSISTED_REVISIONS), REPORT, ALICE);

    // One more revision arrives; the oldest falls off the end, and the newest
    // takes its slot rather than an eleventh document (SA-01).
    const grown = history(MAX_PERSISTED_REVISIONS + 1);
    const outcome = await saveRevisions(io(db, ALICE), grown, REPORT, ALICE);

    expect(outcome.written).toHaveLength(1);
    expect(outcome.deleted).toHaveLength(0);
    const back = await loadRevisions(io(db, ALICE));
    expect(back).toHaveLength(MAX_PERSISTED_REVISIONS);
    expect(back.map((r) => r.label)).not.toContain('Step 1');
    expect(back[0].label).toBe(`Step ${MAX_PERSISTED_REVISIONS + 1}`);
  });

  it('moves a history saved before the slots into them at the next save', async () => {
    const db = asUser(ALICE);
    // As a version was written before 2026-11-11: under `<at>-<id>`. The rule
    // no longer takes that write from the client, so it is seeded around it.
    const old = history(2);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const admin = ctx.firestore() as unknown as Firestore;
      for (const r of old) {
        const id = `${r.at}-${r.id}`;
        await setDoc(versionDocRef(admin, ALICE, REPORT, id), { id, reportId: REPORT, label: r.label, timestamp: r.at, snapshot: JSON.stringify(r.snapshot), userId: ALICE });
      }
    });

    const outcome = await saveRevisions(io(db, ALICE), old, REPORT, ALICE);

    expect(outcome.written.sort()).toEqual(['v0', 'v1']);
    expect(outcome.deleted.sort()).toEqual(['1000-1', '2000-2']);
    const ids = (await getDocs(versionsCollectionRef(db, ALICE, REPORT))).docs.map((d) => d.id).sort();
    expect(ids).toEqual(['v0', 'v1']);
    expect((await loadRevisions(io(db, ALICE))).map((r) => versionKey(r))).toEqual(old.map((r) => versionKey(r)));
  });
});

describe('the ten slots, enforced by the rules (SA-01)', () => {
  it('refuses a version written anywhere but v0..v9', async () => {
    const db = asUser(ALICE);
    const doc = { id: '1700000000000-3', reportId: REPORT, label: 'Generated', timestamp: 1, snapshot: '{"repxContent":"<x/>"}', userId: ALICE };
    await assertFails(setDoc(versionDocRef(db, ALICE, REPORT, doc.id), doc));
    await assertFails(setDoc(versionDocRef(db, ALICE, REPORT, 'v10'), { ...doc, id: 'v10' }));
    for (const slot of VERSION_SLOTS) await setDoc(versionDocRef(db, ALICE, REPORT, slot), { ...doc, id: slot });
    expect((await getDocs(versionsCollectionRef(db, ALICE, REPORT))).size).toBe(VERSION_SLOTS.length);
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

    expect(outcome.tooLarge).toEqual([versionKey(huge)]);
    const back = await loadRevisions(io(db, ALICE));
    expect(back.map((r) => r.label)).toEqual(['Step 2', 'Step 1']);
  });
});
