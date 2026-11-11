/**
 * Security-rule tests for `firestore.rules`, run against the Firestore emulator.
 *
 * These rules are the only thing standing between one user's account and
 * another's — the client-side `user.uid` checks in App.tsx are convenience, not
 * enforcement, and anyone can talk to Firestore directly with the (public)
 * Firebase web API key. Until now nothing exercised them at all.
 *
 * Run with `npm run test:rules`, which starts the emulator around this file.
 * Deliberately not part of `npm test`: that suite must stay dependency-free and
 * instant, while this one needs Java and a running emulator.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, deleteField, updateDoc, collection, getDocs, query, where, writeBatch, setLogLevel, increment, serverTimestamp, Timestamp, type Firestore } from 'firebase/firestore';
import fs from 'node:fs';
import { MAX_FULL_EVENTS_A_DAY, deleteReportAndVersions, writeLearning, writeReport } from '../src/lib/accountData';
import { learningEvent, LEARNING_AIS, LEARNING_DRAFTS, LEARNING_DROPPED, LEARNING_HOWS, LEARNING_KINDS, LEARNING_REQUESTS, LEARNING_SOURCES } from '../src/lib/learning';

// Every denial this file expects is also logged by the SDK as a
// PERMISSION_DENIED warning, which buried a real one under dozens of expected
// ones (2026-11-11, the full audit, TC-13). The assertions say what was denied.
setLogLevel('silent');

const ALICE = 'alice-uid';
const BOB = 'bob-uid';

let testEnv: RulesTestEnvironment;

/** Exactly what handleSaveReport writes — the shape the rules are pinned to. */
const validReport = (id: string, uid: string) => ({
  id,
  name: 'Quarterly Invoice',
  timestamp: Date.now(),
  messages: '[]',
  result: '{}',
  userId: uid,
});

/** Exactly what revisionStore.toVersionDocument writes. */
const validVersion = (id: string, reportId: string, uid: string) => ({
  id,
  reportId,
  label: 'Refined',
  timestamp: Date.now(),
  snapshot: '{"content":"# spec","repxContent":"<x/>","title":"R"}',
  userId: uid,
});

/** Exactly what keyVault.encryptApiKey produces. */
const validVault = () => ({
  v: 1,
  ciphertext: 'Y2lwaGVydGV4dA==',
  iv: 'aXYtYnl0ZXM=',
  salt: 'c2FsdC1ieXRlcw==',
  iterations: 310000,
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'forma-rules-test',
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
});

const aliceDb = () => testEnv.authenticatedContext(ALICE).firestore();
const bobDb = () => testEnv.authenticatedContext(BOB).firestore();
const anonDb = () => testEnv.unauthenticatedContext().firestore();

/** Seed a document past the rules, so read/update/delete tests have something to act on. */
const seed = (path: string[], data: unknown) =>
  testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path.join('/')), data as any);
  });

/**
 * Exactly the document lib/accountData.ts's writeShare writes (2026-11-06):
 * since 2026-11-11 (SE-04) without the invitees, which go to the access list.
 */
const validShare = (id: string, owner: string, extra: Record<string, unknown> = {}) => ({
  id,
  ownerId: owner,
  reportId: 'r1',
  name: 'Quarterly Invoice',
  result: '{"title":"Quarterly Invoice","repxContent":"<x/>"}',
  access: 'restricted',
  timestamp: Date.now(),
  ...extra,
});
/** A share written before 2026-11-11, its invitees in the document itself. */
const legacyShare = (id: string, owner: string, extra: Record<string, unknown> = {}) => ({ ...validShare(id, owner), emails: ['bob@example.com'], ...extra });
/** The access list beside it, as writeShare writes it. */
const validAcl = (owner: string, list: string[] = ['bob@example.com']) => ({ ownerId: owner, list });
const SHARE = 'Sh4r3dR3p0rtIdOfTwentyTwo';
const aclOf = (db: ReturnType<typeof aliceDb>, id: string) => doc(db, 'shares', id, 'acl', 'emails');
/** Bob signed in with an email address, verified or not. */
const bobWithEmail = (email: string, verified: boolean) =>
  testEnv.authenticatedContext(BOB, { email, email_verified: verified }).firestore();

/** Alice with her address verified, which creating or changing a share needs since 2026-11-08 (site audit item 57). */
const aliceVerified = () => testEnv.authenticatedContext(ALICE, { email: 'alice@example.com', email_verified: true }).firestore();
/** Her project r1, which a share must name (item 57). */
const seedAliceReport = () =>
  seed(['users', ALICE, 'reports', 'r1'], { id: 'r1', name: 'Invoice', timestamp: Date.now(), messages: '[]', result: '{}', userId: ALICE });
/** A share, its access list and the raised count in one batch, as lib/accountData.ts's writeShare writes them. */
const createShare = (db: ReturnType<typeof aliceDb>, id: string, data: unknown, countBefore = 0, owner = ALICE) => {
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', owner, 'meta', 'quota'), { shares: countBefore + 1, last: id });
  batch.set(doc(db, 'shares', id), data as any);
  batch.set(aclOf(db, id), validAcl(owner));
  return batch.commit();
};

describe('shares (2026-11-06)', () => {
  it('lets the owner create a share, and nobody else create one in their name', async () => {
    await seedAliceReport();
    await assertSucceeds(createShare(aliceVerified(), SHARE, validShare(SHARE, ALICE)));
    await assertFails(createShare(bobWithEmail('bob@example.com', true), 'AnotherShareIdOfTwentyTwo', validShare('AnotherShareIdOfTwentyTwo', ALICE), 0, BOB));
    await assertFails(setDoc(doc(anonDb(), 'shares', 'ThirdShareIdOfTwentyTwoX'), validShare('ThirdShareIdOfTwentyTwoX', ALICE)));
  });

  it('pins the shape: no extra field, a known access, the id it is filed under', async () => {
    await seedAliceReport();
    await assertFails(createShare(aliceVerified(), SHARE, validShare(SHARE, ALICE, { userId: ALICE })));
    await assertFails(createShare(aliceVerified(), SHARE, validShare(SHARE, ALICE, { access: 'public' })));
    await assertFails(createShare(aliceVerified(), SHARE, validShare('SomeOtherId', ALICE)));
    // The invitees never go back into the document anyone may read (SE-04).
    await assertFails(createShare(aliceVerified(), SHARE, validShare(SHARE, ALICE, { emails: ['bob@example.com'] })));
  });

  it('needs a verified address, a project of the account and the count raised in the same batch (site audit item 57)', async () => {
    await seedAliceReport();
    await assertFails(createShare(aliceDb(), SHARE, validShare(SHARE, ALICE))); // unverified
    await assertFails(createShare(aliceVerified(), SHARE, validShare(SHARE, ALICE, { reportId: 'notHers' })));
    await assertFails(setDoc(doc(aliceVerified(), 'shares', SHARE), validShare(SHARE, ALICE))); // not counted
    await assertSucceeds(createShare(aliceVerified(), SHARE, validShare(SHARE, ALICE)));
    // The next one must count from where the first left it.
    await assertFails(createShare(aliceVerified(), 'SecondShareIdOfTwentyTwo', validShare('SecondShareIdOfTwentyTwo', ALICE), 0));
    await assertSucceeds(createShare(aliceVerified(), 'SecondShareIdOfTwentyTwo', validShare('SecondShareIdOfTwentyTwo', ALICE), 1));
  });

  it('caps an account at 100 shares', async () => {
    await seedAliceReport();
    await seed(['users', ALICE, 'meta', 'quota'], { shares: 100, last: 'Earlier' });
    await assertFails(createShare(aliceVerified(), SHARE, validShare(SHARE, ALICE), 100));
  });

  it('moves the count only with a share: no lowering to make room, no deleting it above zero', async () => {
    await seedAliceReport();
    await assertSucceeds(createShare(aliceVerified(), SHARE, validShare(SHARE, ALICE)));
    await assertFails(setDoc(doc(aliceVerified(), 'users', ALICE, 'meta', 'quota'), { shares: 0, last: SHARE }));
    await assertFails(setDoc(doc(aliceVerified(), 'users', ALICE, 'meta', 'quota'), { shares: 2, last: 'Invented' }));
    await assertFails(deleteDoc(doc(aliceVerified(), 'users', ALICE, 'meta', 'quota')));
    await assertFails(getDoc(doc(bobDb(), 'users', ALICE, 'meta', 'quota')));
    // A counted share goes with the count lowered in the same batch, and then the count may go.
    await assertFails(deleteDoc(doc(aliceDb(), 'shares', SHARE)));
    const db = aliceDb();
    const batch = writeBatch(db);
    batch.delete(doc(db, 'shares', SHARE));
    batch.delete(aclOf(db, SHARE));
    batch.set(doc(db, 'users', ALICE, 'meta', 'quota'), { shares: 0, last: SHARE });
    await assertSucceeds(batch.commit());
    await assertSucceeds(deleteDoc(doc(aliceDb(), 'users', ALICE, 'meta', 'quota')));
  });

  it('lets anyone read a link share, signed in or not, and hands them no invitee', async () => {
    await seedAliceReport();
    await assertSucceeds(createShare(aliceVerified(), SHARE, validShare(SHARE, ALICE, { access: 'link' })));
    const read = await assertSucceeds(getDoc(doc(anonDb(), 'shares', SHARE)));
    expect(read.data()).not.toHaveProperty('emails');
    expect(JSON.stringify(read.data())).not.toContain('bob@example.com');
    await assertSucceeds(getDoc(doc(bobDb(), 'shares', SHARE)));
    // The access list is the owner's: not a link holder's, not an invitee's.
    await assertFails(getDoc(aclOf(anonDb(), SHARE)));
    await assertFails(getDoc(aclOf(bobWithEmail('bob@example.com', true), SHARE)));
    await assertSucceeds(getDoc(aclOf(aliceDb(), SHARE)));
  });

  it('lets only the owner and a verified invitee read a restricted share, whatever the letter case', async () => {
    await seed(['shares', SHARE], validShare(SHARE, ALICE));
    await seed(['shares', SHARE, 'acl', 'emails'], validAcl(ALICE));
    await assertSucceeds(getDoc(doc(aliceDb(), 'shares', SHARE)));
    await assertFails(getDoc(doc(anonDb(), 'shares', SHARE)));
    await assertFails(getDoc(doc(bobDb(), 'shares', SHARE)));
    await assertSucceeds(getDoc(doc(bobWithEmail('Bob@Example.com', true), 'shares', SHARE)));
    // An email-and-password account can claim any address until it is verified.
    await assertFails(getDoc(doc(bobWithEmail('bob@example.com', false), 'shares', SHARE)));
    await assertFails(getDoc(doc(bobWithEmail('carol@example.com', true), 'shares', SHARE)));
  });

  it('still opens a restricted share from before the access list, for its invitee only (Owner decision 7)', async () => {
    await seed(['shares', SHARE], legacyShare(SHARE, ALICE));
    await assertSucceeds(getDoc(doc(bobWithEmail('bob@example.com', true), 'shares', SHARE)));
    await assertFails(getDoc(doc(bobWithEmail('carol@example.com', true), 'shares', SHARE)));
    await assertFails(getDoc(doc(anonDb(), 'shares', SHARE)));
    // Its owner may read the list it does not have yet, so the dialog opens it.
    await assertSucceeds(getDoc(aclOf(aliceDb(), SHARE)));
    await assertFails(getDoc(aclOf(bobDb(), SHARE)));
    // And the owner's next write moves the addresses out of the document.
    const db = aliceVerified();
    const batch = writeBatch(db);
    batch.set(doc(db, 'shares', SHARE), validShare(SHARE, ALICE));
    batch.set(aclOf(db, SHARE), validAcl(ALICE));
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(doc(bobWithEmail('bob@example.com', true), 'shares', SHARE)));
  });

  it("writes an access list only for the caller's own share, verified, in its shape", async () => {
    await seed(['shares', SHARE], validShare(SHARE, ALICE));
    await assertSucceeds(setDoc(aclOf(aliceVerified(), SHARE), validAcl(ALICE, ['bob@example.com', 'carol@example.com'])));
    // Unverified, as changing who may read a share needs (item 57).
    await assertFails(setDoc(aclOf(aliceDb(), SHARE), validAcl(ALICE)));
    // Not someone else's share, under either owner's name.
    await assertFails(setDoc(aclOf(bobWithEmail('bob@example.com', true), SHARE), validAcl(BOB)));
    await assertFails(setDoc(aclOf(bobWithEmail('bob@example.com', true), SHARE), validAcl(ALICE)));
    // Nothing but the owner and the list, at most 50, and at no other id.
    await assertFails(setDoc(aclOf(aliceVerified(), SHARE), { ...validAcl(ALICE), note: 'x' }));
    await assertFails(setDoc(aclOf(aliceVerified(), SHARE), validAcl(ALICE, Array.from({ length: 51 }, (_, i) => `p${i}@example.com`))));
    await assertFails(setDoc(doc(aliceVerified(), 'shares', SHARE, 'acl', 'other'), validAcl(ALICE)));
    // Not without a share to belong to.
    await assertFails(setDoc(aclOf(aliceVerified(), 'NoSuchShareIdOfTwentyTwo'), validAcl(ALICE)));
    // Deleted by its owner alone.
    await assertFails(deleteDoc(aclOf(bobDb(), SHARE)));
    await assertSucceeds(deleteDoc(aclOf(aliceDb(), SHARE)));
  });

  it("lists the owner's own shares only, by a query that says so", async () => {
    await seed(['shares', SHARE], validShare(SHARE, ALICE));
    await assertSucceeds(getDocs(query(collection(aliceDb(), 'shares'), where('ownerId', '==', ALICE), where('reportId', '==', 'r1'))));
    await assertFails(getDocs(query(collection(bobDb(), 'shares'), where('ownerId', '==', ALICE))));
    await assertFails(getDocs(collection(aliceDb(), 'shares')));
  });

  it('lets the owner update and delete a share, but not move it to another project or owner', async () => {
    // A share from before the count (seeded, no quota document).
    await seed(['shares', SHARE], validShare(SHARE, ALICE));
    await assertSucceeds(setDoc(doc(aliceVerified(), 'shares', SHARE), validShare(SHARE, ALICE, { access: 'link' })));
    // Changing who may read it needs a verified address (item 57).
    await assertFails(setDoc(doc(aliceDb(), 'shares', SHARE), validShare(SHARE, ALICE, { access: 'restricted' })));
    await assertFails(setDoc(doc(aliceVerified(), 'shares', SHARE), validShare(SHARE, ALICE, { reportId: 'r2' })));
    await assertFails(setDoc(doc(bobDb(), 'shares', SHARE), validShare(SHARE, BOB)));
    await assertFails(deleteDoc(doc(bobDb(), 'shares', SHARE)));
    // Stopping it is always the owner's, verified or not.
    await assertSucceeds(deleteDoc(doc(aliceDb(), 'shares', SHARE)));
  });
});

/** Exactly what lib/savedReport.ts's toIndexDocument writes (2026-11-08, site audit item 63). */
const validIndex = (id: string, owner: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: 'Quarterly Invoice',
  timestamp: Date.now(),
  search: 'an invoice by region',
  notes: 3,
  userId: owner,
  ...extra,
});

describe('the projects index (2026-11-08, site audit item 63)', () => {
  // An entry is for a project the account holds (the re-audit's R5-01).
  beforeEach(() => seed(['users', ALICE, 'reports', 'r1'], validReport('r1', ALICE)));

  it('lets the owner write, list and delete their entries, and nobody else touch them', async () => {
    await assertSucceeds(setDoc(doc(aliceDb(), 'users', ALICE, 'reportIndex', 'r1'), validIndex('r1', ALICE)));
    await assertSucceeds(getDocs(collection(aliceDb(), 'users', ALICE, 'reportIndex')));
    await assertFails(getDocs(collection(bobDb(), 'users', ALICE, 'reportIndex')));
    await assertFails(setDoc(doc(bobDb(), 'users', ALICE, 'reportIndex', 'r2'), validIndex('r2', ALICE)));
    await assertFails(deleteDoc(doc(bobDb(), 'users', ALICE, 'reportIndex', 'r1')));
    await assertSucceeds(deleteDoc(doc(aliceDb(), 'users', ALICE, 'reportIndex', 'r1')));
  });

  it('pins the shape, as the project it describes is pinned', async () => {
    await assertFails(setDoc(doc(aliceDb(), 'users', ALICE, 'reportIndex', 'r1'), validIndex('r1', ALICE, { messages: '[]' })));
    await assertFails(setDoc(doc(aliceDb(), 'users', ALICE, 'reportIndex', 'r1'), validIndex('other', ALICE)));
    await assertFails(setDoc(doc(aliceDb(), 'users', ALICE, 'reportIndex', 'r1'), validIndex('r1', BOB)));
    await assertFails(setDoc(doc(aliceDb(), 'users', ALICE, 'reportIndex', 'r1'), validIndex('r1', ALICE, { search: 'x'.repeat(4001) })));
    await assertFails(setDoc(doc(aliceDb(), 'users', ALICE, 'reportIndex', 'r1'), validIndex('r1', ALICE, { notes: -1 })));
    await assertFails(setDoc(doc(aliceDb(), 'users', ALICE, 'reportIndex', 'r1'), validIndex('r1', ALICE, { timestamp: 4102444800001 })));
  });

  it('renames a project by its name alone, keeping everything else the rules require', async () => {
    await seed(['users', ALICE, 'reports', 'r1'], { id: 'r1', name: 'Invoice', timestamp: Date.now(), messages: '[]', result: '{}', userId: ALICE });
    await assertSucceeds(updateDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1'), { name: 'Renamed' }));
  });

  /**
   * The re-audit's R5-01: entries for made-up ids were not counted, so the
   * index was unbounded whatever the projects cap said. One is taken in the
   * batch that saves its project, as well as after it.
   */
  it('refuses an entry for a project the account does not hold, and takes one saved with its project', async () => {
    await assertFails(setDoc(doc(aliceDb(), 'users', ALICE, 'reportIndex', 'made-up'), validIndex('made-up', ALICE)));
    const db = aliceDb();
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', ALICE, 'reports', 'r2'), validReport('r2', ALICE));
    batch.set(doc(db, 'users', ALICE, 'meta', 'usage'), { reports: increment(1), report: 'r2' }, { merge: true });
    batch.set(doc(db, 'users', ALICE, 'reportIndex', 'r2'), validIndex('r2', ALICE));
    await assertSucceeds(batch.commit());
  });
});

describe('global deny', () => {
  it('refuses a path no rule matches, even when signed in', async () => {
    await assertFails(getDoc(doc(aliceDb(), 'test/connection')));
    await assertFails(setDoc(doc(aliceDb(), 'anything/else'), { a: 1 }));
  });
});

describe('reports — isolation between accounts', () => {
  it('lets a user read their own report', async () => {
    await seed(['users', ALICE, 'reports', 'r1'], validReport('r1', ALICE));
    await assertSucceeds(getDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1')));
  });

  it("refuses to read another user's report", async () => {
    await seed(['users', ALICE, 'reports', 'r1'], validReport('r1', ALICE));
    await assertFails(getDoc(doc(bobDb(), 'users', ALICE, 'reports', 'r1')));
  });

  it("refuses to list another user's reports", async () => {
    await seed(['users', ALICE, 'reports', 'r1'], validReport('r1', ALICE));
    await assertFails(getDocs(collection(bobDb(), 'users', ALICE, 'reports')));
    await assertSucceeds(getDocs(collection(aliceDb(), 'users', ALICE, 'reports')));
  });

  it("refuses to write into another user's collection", async () => {
    await assertFails(
      setDoc(doc(bobDb(), 'users', ALICE, 'reports', 'r9'), validReport('r9', ALICE))
    );
  });

  it("refuses to delete another user's report", async () => {
    await seed(['users', ALICE, 'reports', 'r1'], validReport('r1', ALICE));
    await assertFails(deleteDoc(doc(bobDb(), 'users', ALICE, 'reports', 'r1')));
    await assertSucceeds(deleteDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1')));
  });

  it('refuses everything to an unauthenticated caller', async () => {
    await seed(['users', ALICE, 'reports', 'r1'], validReport('r1', ALICE));
    await assertFails(getDoc(doc(anonDb(), 'users', ALICE, 'reports', 'r1')));
    await assertFails(setDoc(doc(anonDb(), 'users', ALICE, 'reports', 'r2'), validReport('r2', ALICE)));
    await assertFails(deleteDoc(doc(anonDb(), 'users', ALICE, 'reports', 'r1')));
  });
});

describe('reports — document shape', () => {
  /** A new project as writeReport saves it: the count raised in the same batch (SA-01), so a refusal here is the shape's. */
  const createReport = (data: unknown) => {
    const db = aliceDb();
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', ALICE, 'reports', 'r1'), data as any);
    batch.set(doc(db, 'users', ALICE, 'meta', 'usage'), { reports: increment(1), report: 'r1' }, { merge: true });
    return batch.commit();
  };

  it('accepts the exact shape handleSaveReport writes', async () => {
    await assertSucceeds(createReport(validReport('r1', ALICE)));
  });

  it('rejects extra fields — the reason hasOnly replaced size() >= 6', async () => {
    await assertFails(createReport({ ...validReport('r1', ALICE), smuggled: 'x'.repeat(1000) }));
  });

  it('rejects a missing required field', async () => {
    const { result, ...withoutResult } = validReport('r1', ALICE);
    await assertFails(createReport(withoutResult));
  });

  it('rejects a userId that is not the caller — no writing reports as someone else', async () => {
    await assertFails(createReport(validReport('r1', BOB)));
  });

  it('rejects a document id that disagrees with its path', async () => {
    await assertFails(createReport(validReport('different', ALICE)));
  });

  it('rejects wrong field types', async () => {
    await assertFails(createReport({ ...validReport('r1', ALICE), timestamp: 'not-a-number' }));
    await assertFails(createReport({ ...validReport('r1', ALICE), messages: [] }));
  });

  it('rejects an implausible timestamp', async () => {
    await assertFails(createReport({ ...validReport('r1', ALICE), timestamp: -1 }));
    await assertFails(createReport({ ...validReport('r1', ALICE), timestamp: 99999999999999 }));
  });

  it('rejects an over-long name', async () => {
    await assertFails(createReport({ ...validReport('r1', ALICE), name: 'x'.repeat(257) }));
  });
});

describe('reports — updates cannot re-home a document', () => {
  beforeEach(() => seed(['users', ALICE, 'reports', 'r1'], validReport('r1', ALICE)));

  it('allows an owner to update their own report', async () => {
    await assertSucceeds(
      setDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1'), {
        ...validReport('r1', ALICE),
        name: 'Renamed',
      })
    );
  });

  it('refuses to change userId on an existing document', async () => {
    await assertFails(
      updateDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1'), { userId: BOB })
    );
  });

  it('refuses to change the id on an existing document', async () => {
    await assertFails(
      updateDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1'), { id: 'r2' })
    );
  });
});

/**
 * Revision history, added 2026-09-05.
 *
 * A subcollection under a report, and therefore a new place an account's data
 * can be reached, written to, or left behind. The last of those is the one
 * worth testing hardest: Firestore does not delete a subcollection with its
 * parent, so `list` has to work for the owner or nothing can ever clean up.
 */
describe('report versions — isolation between accounts', () => {
  const path = (uid: string, reportId = 'r1', versionId = 'v1') =>
    ['users', uid, 'reports', reportId, 'versions', versionId];

  beforeEach(async () => {
    await seed(['users', ALICE, 'reports', 'r1'], validReport('r1', ALICE));
    await seed(path(ALICE), validVersion('v1', 'r1', ALICE));
  });

  it('lets the owner read one version', async () => {
    await assertSucceeds(getDoc(doc(aliceDb(), path(ALICE).join('/'))));
  });

  it('refuses another account', async () => {
    await assertFails(getDoc(doc(bobDb(), path(ALICE).join('/'))));
    await assertFails(setDoc(doc(bobDb(), path(ALICE, 'r1', 'v9').join('/')), validVersion('v9', 'r1', ALICE)));
    await assertFails(deleteDoc(doc(bobDb(), path(ALICE).join('/'))));
  });

  it('refuses an anonymous visitor', async () => {
    await assertFails(getDoc(doc(anonDb(), path(ALICE).join('/'))));
  });

  it('lets the owner list a history, and nobody else', async () => {
    // list is what loading a report's history needs, and what deleting one
    // needs in order to remove what Firestore leaves behind.
    await assertSucceeds(getDocs(collection(aliceDb(), 'users', ALICE, 'reports', 'r1', 'versions')));
    await assertFails(getDocs(collection(bobDb(), 'users', ALICE, 'reports', 'r1', 'versions')));
  });

  it('lets the owner delete one, which is how cleanup happens', async () => {
    await assertSucceeds(deleteDoc(doc(aliceDb(), path(ALICE).join('/'))));
  });
});

describe('report versions — document shape', () => {
  const write = (data: unknown, versionId = 'v2', reportId = 'r1') =>
    setDoc(doc(aliceDb(), 'users', ALICE, 'reports', reportId, 'versions', versionId), data as any);

  // A version is filed under a project the account holds (the re-audit's R5-01).
  beforeEach(() => seed(['users', ALICE, 'reports', 'r1'], validReport('r1', ALICE)));

  it('accepts exactly what the app writes', async () => {
    await assertSucceeds(write(validVersion('v2', 'r1', ALICE)));
  });

  /**
   * The re-audit's R5-01: the ten slots were per report and the report need
   * not exist, so made-up report ids held ten versions each without end, and
   * deleting the account, which finds versions through the reports, left them.
   */
  it('refuses a version under a report the account does not hold', async () => {
    await assertFails(write(validVersion('v2', 'made-up', ALICE), 'v2', 'made-up'));
  });

  it('refuses an extra field, so this cannot become general storage', async () => {
    await assertFails(write({ ...validVersion('v2', 'r1', ALICE), smuggled: 'x' }));
  });

  it('refuses a missing field', async () => {
    const { snapshot, ...withoutSnapshot } = validVersion('v2', 'r1', ALICE);
    void snapshot;
    await assertFails(write(withoutSnapshot));
  });

  it('refuses a document id that disagrees with the id field', async () => {
    await assertFails(write(validVersion('v2', 'r1', ALICE), 'somethingElse'));
  });

  it('refuses a version filed under a report it does not claim', async () => {
    // Without the reportId pin a client could write a version into one
    // report's history that claims to belong to another, and the loader would
    // believe it.
    await assertFails(write(validVersion('v2', 'r-other', ALICE)));
  });

  it('refuses another account as the owner', async () => {
    await assertFails(write(validVersion('v2', 'r1', BOB)));
  });

  it('refuses a far-future timestamp', async () => {
    await assertFails(write({ ...validVersion('v2', 'r1', ALICE), timestamp: 4102444800001 }));
  });

  it('refuses a non-string snapshot', async () => {
    await assertFails(write({ ...validVersion('v2', 'r1', ALICE), snapshot: { a: 1 } }));
  });
});

describe('key vault', () => {
  /**
   * The regression test for the bug this suite was written to catch. The rule
   * used to be a single `allow read, write` ending in
   * `request.method == 'delete' || isValidKeyVault(incoming())`. `incoming()` is
   * `request.resource.data`, which exists only on writes — so on a read the
   * expression errored and the read was denied. App.tsx calls getDoc here on
   * every load to see whether a synced key exists, swallowed the failure, and
   * reported "no stored key" to users who had one.
   */
  it('lets a user read their own stored key', async () => {
    await seed(['users', ALICE, 'vault', 'geminiKey'], validVault());
    await assertSucceeds(getDoc(doc(aliceDb(), 'users', ALICE, 'vault', 'geminiKey')));
  });

  it('lets a user read when no key is stored yet (the empty case App.tsx hits first)', async () => {
    await assertSucceeds(getDoc(doc(aliceDb(), 'users', ALICE, 'vault', 'geminiKey')));
  });

  it("refuses to read another user's stored key", async () => {
    await seed(['users', ALICE, 'vault', 'geminiKey'], validVault());
    await assertFails(getDoc(doc(bobDb(), 'users', ALICE, 'vault', 'geminiKey')));
  });

  it('refuses an unauthenticated read', async () => {
    await seed(['users', ALICE, 'vault', 'geminiKey'], validVault());
    await assertFails(getDoc(doc(anonDb(), 'users', ALICE, 'vault', 'geminiKey')));
  });

  it('accepts a well-formed encrypted record', async () => {
    await assertSucceeds(
      setDoc(doc(aliceDb(), 'users', ALICE, 'vault', 'geminiKey'), validVault())
    );
  });

  it('rejects a weakened iteration count from a tampered client', async () => {
    await assertFails(
      setDoc(doc(aliceDb(), 'users', ALICE, 'vault', 'geminiKey'), {
        ...validVault(),
        iterations: 1000,
      })
    );
  });

  /**
   * The floor was 100,000 until 2026-08-27 — a third of the 310,000 that
   * `keyVault.ts` uses and calls OWASP's floor, so the rule that exists to stop
   * a weakening stopped it in the wrong place (audit SEC-005).
   */
  it('rejects the old 100,000 floor, which is below what the client uses', async () => {
    await assertFails(
      setDoc(doc(aliceDb(), 'users', ALICE, 'vault', 'geminiKey'), {
        ...validVault(),
        iterations: 100000,
      })
    );
  });

  it('accepts the count keyVault.ts actually writes', async () => {
    await assertSucceeds(
      setDoc(doc(aliceDb(), 'users', ALICE, 'vault', 'geminiKey'), {
        ...validVault(),
        iterations: 310000,
      })
    );
  });

  it('accepts a stronger count, so raising it later needs no rules change', async () => {
    await assertSucceeds(
      setDoc(doc(aliceDb(), 'users', ALICE, 'vault', 'geminiKey'), {
        ...validVault(),
        iterations: 600000,
      })
    );
  });

  it('rejects extra keys — this path must not become general storage', async () => {
    await assertFails(
      setDoc(doc(aliceDb(), 'users', ALICE, 'vault', 'geminiKey'), {
        ...validVault(),
        plaintext: 'AIzaSyWhoops',
      })
    );
  });

  it('rejects ciphertext beyond the size bound', async () => {
    await assertFails(
      setDoc(doc(aliceDb(), 'users', ALICE, 'vault', 'geminiKey'), {
        ...validVault(),
        ciphertext: 'x'.repeat(2049),
      })
    );
  });

  it('rejects an empty ciphertext', async () => {
    await assertFails(
      setDoc(doc(aliceDb(), 'users', ALICE, 'vault', 'geminiKey'), {
        ...validVault(),
        ciphertext: '',
      })
    );
  });

  // The re-audit's R5-01: any id was taken, and account deletion removes geminiKey by name.
  it('writes the one vault document the app uses, and no other', async () => {
    await assertFails(setDoc(doc(aliceDb(), 'users', ALICE, 'vault', 'spare'), validVault()));
    await assertSucceeds(setDoc(doc(aliceDb(), 'users', ALICE, 'vault', 'geminiKey'), validVault()));
  });

  it("refuses to write into another user's vault", async () => {
    await assertFails(
      setDoc(doc(bobDb(), 'users', ALICE, 'vault', 'geminiKey'), validVault())
    );
  });

  it('lets a user delete their own stored key, but not another user’s', async () => {
    await seed(['users', ALICE, 'vault', 'geminiKey'], validVault());
    await assertFails(deleteDoc(doc(bobDb(), 'users', ALICE, 'vault', 'geminiKey')));
    await assertSucceeds(deleteDoc(doc(aliceDb(), 'users', ALICE, 'vault', 'geminiKey')));
  });
});

/**
 * What lib/learning.ts's learningEvent builds, with the userId writeLearning
 * adds (LM-27a, 2026-11-11): built by the code rather than by hand, so a
 * field the code adds and the rules do not take fails here. Stamped now, on
 * the server's day, which the rules require (LM-26).
 */
const validLearning = (id: string, uid: string, extra: Record<string, unknown> = {}) => ({
  ...learningEvent(
    { id, kind: 'generation', source: 'image', request: 'new', ai: 'gemini', skeleton: { paper: 'A4', landscape: false, width: 827, height: 1169, margins: { top: 50, bottom: 50, left: 50, right: 50 }, bands: [] }, findings: [{ severity: 'warning' }, { severity: 'warning' }] },
    { structure: true, full: false },
  ),
  userId: uid,
  ...extra,
});
const EVENT = 'm3k9x1-abc123';
/** Alice and Bob with verified addresses, which a learning event needs (SA-01). */
const aliceMail = () => testEnv.authenticatedContext(ALICE, { email: 'alice@example.com', email_verified: true }).firestore();
const bobMail = () => testEnv.authenticatedContext(BOB, { email: 'bob@example.com', email_verified: true }).firestore();
const usageOf = (db: ReturnType<typeof aliceDb>, uid = ALICE) => doc(db, 'users', uid, 'meta', 'usage');
const today = () => new Date().toISOString().slice(0, 10);
/** An event and the day's count in one batch, as writeLearning writes them; `count` is what the batch sets. */
const sendEvent = (db: ReturnType<typeof aliceDb>, data: Record<string, unknown>, uid = ALICE, count: Record<string, unknown> = { events: 1, eventDay: today() }, filedAs = String(data.id)) => {
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', uid, 'learning', filedAs), data as any);
  batch.set(usageOf(db, uid), { ...count, eventAt: serverTimestamp(), event: filedAs }, { merge: true });
  return batch.commit();
};

describe('learning events (2026-11-10, the full audit)', () => {
  it('lets a user keep an event under their own account, and nobody else under it', async () => {
    await assertSucceeds(sendEvent(aliceMail(), validLearning(EVENT, ALICE)));
    await assertFails(sendEvent(bobMail(), validLearning('other-1', ALICE)));
    await assertFails(sendEvent(bobMail(), validLearning('other-2', BOB)));
    await assertFails(sendEvent(anonDb(), validLearning('other-3', ALICE)));
  });

  it('pins the shape: every field, no extra one, the id it is filed under, the lists the code has, sizes', async () => {
    const write = (data: Record<string, unknown>) => sendEvent(aliceMail(), data);
    await assertFails(write(validLearning(EVENT, ALICE, { extra: 1 })));
    const { prompt: _dropped, ...missing } = validLearning(EVENT, ALICE);
    await assertFails(write(missing));
    await assertFails(sendEvent(aliceMail(), validLearning(EVENT, ALICE, { id: 'some-other-id' }), ALICE, undefined, EVENT));
    await assertFails(write(validLearning(EVENT, ALICE, { kind: 'telemetry' })));
    await assertFails(write(validLearning(EVENT, ALICE, { source: 'camera' })));
    await assertFails(write(validLearning(EVENT, ALICE, { ai: 'gpt' })));
    await assertFails(write(validLearning(EVENT, ALICE, { rating: 'great' })));
    await assertFails(write(validLearning(EVENT, ALICE, { ops: 'font' })));
    await assertFails(write(validLearning(EVENT, ALICE, { ops: ['font'], roles: [] })));
    await assertFails(write(validLearning(EVENT, ALICE, { errors: -1 })));
    await assertFails(write(validLearning(EVENT, ALICE, { prompt: 'p'.repeat(4001) })));
    await assertFails(write(validLearning(EVENT, ALICE, { ref: 'r'.repeat(65) })));
    await assertFails(write(validLearning(EVENT, ALICE, { how: 'fax' })));
    await assertFails(write(validLearning(EVENT, ALICE, { project: 'not-a-hash' })));
    // A rating carries no skeleton (LM-10a), and only a rating carries a rating.
    await assertFails(write(validLearning(EVENT, ALICE, { kind: 'rating', rating: 'good' })));
    await assertFails(write(validLearning(EVENT, ALICE, { rating: 'good' })));
    await assertSucceeds(write(validLearning(EVENT, ALICE, { kind: 'rating', rating: 'good', skeleton: '', ref: 'm3k9x0-rated1' })));
  });

  it('takes the server day only, so a made-up time never reaches the pull (LM-26)', async () => {
    await assertFails(sendEvent(aliceMail(), validLearning(EVENT, ALICE, { at: '9999-01-01T00:00:00.000Z', day: '9999-01-01' })));
    await assertFails(sendEvent(aliceMail(), validLearning(EVENT, ALICE, { at: '2020-01-01T00:00:00.000Z' })));
    await assertFails(sendEvent(aliceMail(), validLearning(EVENT, ALICE, { at: `${today()}T00:00:00.000Z+junk` })));
  });

  it('needs a verified address, and the day counted in the same batch', async () => {
    await assertFails(sendEvent(aliceDb(), validLearning(EVENT, ALICE)));
    await assertFails(setDoc(doc(aliceMail(), 'users', ALICE, 'learning', EVENT), validLearning(EVENT, ALICE)));
    await assertFails(sendEvent(aliceMail(), validLearning(EVENT, ALICE), ALICE, { events: 5, eventDay: today() }));
  });

  it('takes at most 300 a day, two seconds apart, and starts again the next day', async () => {
    const recent = Timestamp.fromMillis(Date.now() - 500);
    const earlier = Timestamp.fromMillis(Date.now() - 60_000);
    await seed(['users', ALICE, 'meta', 'usage'], { events: 300, eventDay: today(), eventAt: earlier, event: 'before' });
    await assertFails(sendEvent(aliceMail(), validLearning(EVENT, ALICE), ALICE, { events: 301 }));
    await seed(['users', ALICE, 'meta', 'usage'], { events: 3, eventDay: today(), eventAt: recent, event: 'before' });
    await assertFails(sendEvent(aliceMail(), validLearning(EVENT, ALICE), ALICE, { events: 4 }));
    await seed(['users', ALICE, 'meta', 'usage'], { events: 3, eventDay: today(), eventAt: earlier, event: 'before' });
    await assertSucceeds(sendEvent(aliceMail(), validLearning(EVENT, ALICE), ALICE, { events: 4 }));
    await seed(['users', ALICE, 'meta', 'usage'], { events: 300, eventDay: '2020-01-01', eventAt: earlier, event: 'before' });
    await assertSucceeds(sendEvent(aliceMail(), validLearning('next-day-1', ALICE)));
  });

  /**
   * The re-audit's R5-05: 300 events a day of up to 700,000 characters each
   * was about 210 MB a day from one account on a free plan every visitor
   * shares. The whole report rides on the first 20 of a day; the 21st goes
   * as its shape alone, and lib/accountData.ts sends it that way.
   */
  it('takes a whole report on the first 20 events of a day only', async () => {
    const earlier = Timestamp.fromMillis(Date.now() - 60_000);
    const whole = (id: string) => validLearning(id, ALICE, { full: '<XtraReportsLayoutSerializer />' });
    await seed(['users', ALICE, 'meta', 'usage'], { events: 19, eventDay: today(), eventAt: earlier, event: 'before' });
    await assertSucceeds(sendEvent(aliceMail(), whole('full-20'), ALICE, { events: 20 }));
    await seed(['users', ALICE, 'meta', 'usage'], { events: 20, eventDay: today(), eventAt: earlier, event: 'before' });
    await assertFails(sendEvent(aliceMail(), whole('full-21'), ALICE, { events: 21 }));
    await assertSucceeds(sendEvent(aliceMail(), validLearning('shape-21', ALICE, { dropped: 'full' }), ALICE, { events: 21 }));
    // A new day starts the count again.
    await seed(['users', ALICE, 'meta', 'usage'], { events: 200, eventDay: '2020-01-01', eventAt: earlier, event: 'before' });
    await assertSucceeds(sendEvent(aliceMail(), whole('full-new-day')));
  });

  it('is sent without the whole report past the 20th event of the day', async () => {
    const earlier = Timestamp.fromMillis(Date.now() - 60_000);
    await seed(['users', ALICE, 'meta', 'usage'], { events: MAX_FULL_EVENTS_A_DAY, eventDay: today(), eventAt: earlier, event: 'before' });
    const { userId: _added, ...event } = validLearning('late-1', ALICE, { full: '<XtraReportsLayoutSerializer />' });
    await writeLearning(aliceMail() as unknown as Firestore, ALICE, event);
    const stored = (await getDoc(doc(aliceDb(), 'users', ALICE, 'learning', 'late-1'))).data();
    expect(stored).toMatchObject({ full: '', dropped: 'full' });
  });

  it('is listed and deleted by its owner only, and never changed', async () => {
    await seed(['users', ALICE, 'learning', EVENT], validLearning(EVENT, ALICE));
    await assertSucceeds(getDocs(collection(aliceDb(), 'users', ALICE, 'learning')));
    await assertFails(getDocs(collection(bobDb(), 'users', ALICE, 'learning')));
    await assertFails(updateDoc(doc(aliceMail(), 'users', ALICE, 'learning', EVENT), { rating: 'bad' }));
    await assertFails(deleteDoc(doc(bobDb(), 'users', ALICE, 'learning', EVENT)));
    await assertSucceeds(deleteDoc(doc(aliceDb(), 'users', ALICE, 'learning', EVENT)));
  });

  // The PRIV review (2026-11-11): a write that landed but was never marked sent is sent again at the
  // next flush. The rules refuse it as an update; writeLearning reads it back and answers it as sent.
  it('takes an event the account already holds as sent, and still refuses one it does not', async () => {
    const { userId: _added, ...event } = validLearning(EVENT, ALICE);
    const db = aliceMail() as unknown as Firestore;
    await writeLearning(db, ALICE, event);
    await expect(writeLearning(db, ALICE, event)).resolves.toBeUndefined();
    await expect(writeLearning(db, ALICE, { ...event, id: 'other-4', kind: 'telemetry' })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('takes every value of every list lib/learning.ts has, and the rules name each', () => {
    const rules = fs.readFileSync('firestore.rules', 'utf8');
    for (const list of [LEARNING_KINDS, LEARNING_SOURCES, LEARNING_REQUESTS, LEARNING_AIS, LEARNING_HOWS, LEARNING_DRAFTS, LEARNING_DROPPED]) {
      const quoted = list.map((v) => `'${v}'`).join(', ');
      expect(rules, `firestore.rules must list [${quoted}]`).toContain(`[${quoted}]`);
    }
  });
});

/* The write counts (2026-11-11, the full audit's SA-01): projects capped, moved only with what they count. */
describe('the write counts', () => {
  it('lets a project be added through writeReport and removed through deleteReportAndVersions, the count moving with it', async () => {
    const db = aliceDb() as unknown as Firestore;
    await writeReport(db, ALICE, 'r1', validReport('r1', ALICE), true);
    await writeReport(db, ALICE, 'r2', validReport('r2', ALICE), false);
    await writeReport(db, ALICE, 'r1', { ...validReport('r1', ALICE), name: 'Renamed' }, true);
    expect((await getDoc(usageOf(aliceDb()))).data()).toMatchObject({ reports: 2 });
    await deleteReportAndVersions(db, ALICE, 'r1');
    expect((await getDoc(usageOf(aliceDb()))).data()).toMatchObject({ reports: 1, report: 'r1' });
  });

  it('refuses a new project without the count, or past 1,000', async () => {
    await assertFails(setDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1'), validReport('r1', ALICE)));
    await seed(['users', ALICE, 'meta', 'usage'], { reports: 1000, report: 'last' });
    const db = aliceDb();
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', ALICE, 'reports', 'r1'), validReport('r1', ALICE));
    batch.set(usageOf(db), { reports: increment(1), report: 'r1' }, { merge: true });
    await assertFails(batch.commit());
    await expect(writeReport(aliceDb() as unknown as Firestore, ALICE, 'r1', validReport('r1', ALICE), true)).rejects.toMatchObject({ name: 'ReportLimitError' });
    // A project the account holds still saves at the limit, though guessed new.
    await seed(['users', ALICE, 'reports', 'held'], validReport('held', ALICE));
    await writeReport(aliceDb() as unknown as Firestore, ALICE, 'held', { ...validReport('held', ALICE), name: 'Renamed' }, true);
    expect((await getDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'held'))).data()).toMatchObject({ name: 'Renamed' });
  });

  it('cannot be moved without what it counts, nor lowered to make room, nor read by anyone else', async () => {
    await seed(['users', ALICE, 'meta', 'usage'], { reports: 5, report: 'r5' });
    await assertFails(setDoc(usageOf(aliceDb()), { reports: 0, report: 'r5' }));
    await assertFails(setDoc(usageOf(aliceDb()), { reports: 6, report: 'r6' }));
    await assertFails(setDoc(usageOf(aliceDb()), { reports: 5, report: 'r5', smuggled: 1 }));
    await assertFails(deleteDoc(usageOf(aliceDb())));
    await assertFails(getDoc(usageOf(bobDb(), ALICE)));
    await assertSucceeds(getDoc(usageOf(aliceDb())));
    // A project deleted while the count stands lowers it in the same batch.
    await seed(['users', ALICE, 'reports', 'r5'], validReport('r5', ALICE));
    await assertFails(deleteDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r5')));
  });

  it('is deleted at zero projects on a day with no event sent, and kept on one with', async () => {
    await seed(['users', ALICE, 'meta', 'usage'], { reports: 0, report: 'r1', events: 2, eventDay: today(), eventAt: Timestamp.now(), event: 'e' });
    await assertFails(deleteDoc(usageOf(aliceDb())));
    await seed(['users', ALICE, 'meta', 'usage'], { reports: 0, report: 'r1', events: 2, eventDay: '2020-01-01', eventAt: Timestamp.now(), event: 'e' });
    await assertSucceeds(deleteDoc(usageOf(aliceDb())));
  });

  it('gives up its two ids at zero projects, and nothing else with them', async () => {
    const counted = { events: 2, eventDay: today(), eventAt: Timestamp.now(), event: 'e' };
    await seed(['users', ALICE, 'meta', 'usage'], { reports: 1, report: 'r1', ...counted });
    await assertFails(updateDoc(usageOf(aliceDb()), { report: deleteField(), event: deleteField() }));
    await seed(['users', ALICE, 'meta', 'usage'], { reports: 0, report: 'r1', ...counted });
    await assertFails(updateDoc(usageOf(aliceDb()), { report: deleteField(), event: deleteField(), events: 0 }));
    await assertFails(updateDoc(usageOf(aliceDb()), { report: 'other' }));
    await assertSucceeds(updateDoc(usageOf(aliceDb()), { report: deleteField(), event: deleteField() }));
  });
});

/* The learning switches kept with the account (2026-11-11, the full audit, LM-01 and SA-13). */
describe('the learning switches', () => {
  const prefs = (db: ReturnType<typeof aliceDb>, uid = ALICE) => doc(db, 'users', uid, 'meta', 'learning');

  it('are read and written by their owner, two booleans and nothing else', async () => {
    await assertSucceeds(setDoc(prefs(aliceDb()), { structure: false, full: false }));
    await assertSucceeds(getDoc(prefs(aliceDb())));
    await assertSucceeds(setDoc(prefs(aliceDb()), { structure: true, full: true }));
    await assertFails(setDoc(prefs(aliceDb()), { structure: true }));
    await assertFails(setDoc(prefs(aliceDb()), { structure: true, full: 'yes' }));
    await assertFails(setDoc(prefs(aliceDb()), { structure: true, full: false, uid: ALICE }));
    await assertSucceeds(deleteDoc(prefs(aliceDb())));
  });

  it('are nobody else\'s to read or change', async () => {
    await seed(['users', ALICE, 'meta', 'learning'], { structure: true, full: false });
    await assertFails(getDoc(prefs(bobDb())));
    await assertFails(setDoc(prefs(bobDb()), { structure: true, full: true }));
    await assertFails(deleteDoc(prefs(bobDb())));
    await assertFails(getDoc(prefs(anonDb())));
  });

  it('give the share count nothing: the quota keeps its own rules', async () => {
    await assertFails(setDoc(doc(aliceDb(), 'users', ALICE, 'meta', 'quota'), { structure: true, full: false }));
    await assertFails(setDoc(doc(aliceDb(), 'users', ALICE, 'meta', 'other'), { structure: true, full: false }));
  });
});
