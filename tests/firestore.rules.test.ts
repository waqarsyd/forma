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
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, updateDoc, collection, getDocs, query, where, writeBatch } from 'firebase/firestore';
import fs from 'node:fs';

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

/** Exactly what lib/shares.ts's shareDocument writes (2026-11-06). */
const validShare = (id: string, owner: string, extra: Record<string, unknown> = {}) => ({
  id,
  ownerId: owner,
  reportId: 'r1',
  name: 'Quarterly Invoice',
  result: '{"title":"Quarterly Invoice","repxContent":"<x/>"}',
  access: 'restricted',
  emails: ['bob@example.com'],
  timestamp: Date.now(),
  ...extra,
});
const SHARE = 'Sh4r3dR3p0rtIdOfTwentyTwo';
/** Bob signed in with an email address, verified or not. */
const bobWithEmail = (email: string, verified: boolean) =>
  testEnv.authenticatedContext(BOB, { email, email_verified: verified }).firestore();

/** Alice with her address verified, which creating or changing a share needs since 2026-11-08 (site audit item 57). */
const aliceVerified = () => testEnv.authenticatedContext(ALICE, { email: 'alice@example.com', email_verified: true }).firestore();
/** Her project r1, which a share must name (item 57). */
const seedAliceReport = () =>
  seed(['users', ALICE, 'reports', 'r1'], { id: 'r1', name: 'Invoice', timestamp: Date.now(), messages: '[]', result: '{}', userId: ALICE });
/** A share and the raised count in one batch, as lib/accountData.ts's writeShare writes them. */
const createShare = (db: ReturnType<typeof aliceDb>, id: string, data: unknown, countBefore = 0, owner = ALICE) => {
  const batch = writeBatch(db);
  batch.set(doc(db, 'shares', id), data as any);
  batch.set(doc(db, 'users', owner, 'meta', 'quota'), { shares: countBefore + 1, last: id });
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
    await assertFails(createShare(aliceVerified(), SHARE, validShare(SHARE, ALICE, { emails: 'bob@example.com' })));
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
    batch.set(doc(db, 'users', ALICE, 'meta', 'quota'), { shares: 0, last: SHARE });
    await assertSucceeds(batch.commit());
    await assertSucceeds(deleteDoc(doc(aliceDb(), 'users', ALICE, 'meta', 'quota')));
  });

  it('lets anyone read a link share, signed in or not', async () => {
    await seed(['shares', SHARE], validShare(SHARE, ALICE, { access: 'link', emails: [] }));
    await assertSucceeds(getDoc(doc(anonDb(), 'shares', SHARE)));
    await assertSucceeds(getDoc(doc(bobDb(), 'shares', SHARE)));
  });

  it('lets only the owner and a verified invitee read a restricted share, whatever the letter case', async () => {
    await seed(['shares', SHARE], validShare(SHARE, ALICE));
    await assertSucceeds(getDoc(doc(aliceDb(), 'shares', SHARE)));
    await assertFails(getDoc(doc(anonDb(), 'shares', SHARE)));
    await assertFails(getDoc(doc(bobDb(), 'shares', SHARE)));
    await assertSucceeds(getDoc(doc(bobWithEmail('Bob@Example.com', true), 'shares', SHARE)));
    // An email-and-password account can claim any address until it is verified.
    await assertFails(getDoc(doc(bobWithEmail('bob@example.com', false), 'shares', SHARE)));
    await assertFails(getDoc(doc(bobWithEmail('carol@example.com', true), 'shares', SHARE)));
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
  it('accepts the exact shape handleSaveReport writes', async () => {
    await assertSucceeds(
      setDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1'), validReport('r1', ALICE))
    );
  });

  it('rejects extra fields — the reason hasOnly replaced size() >= 6', async () => {
    await assertFails(
      setDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1'), {
        ...validReport('r1', ALICE),
        smuggled: 'x'.repeat(1000),
      })
    );
  });

  it('rejects a missing required field', async () => {
    const { result, ...withoutResult } = validReport('r1', ALICE);
    await assertFails(setDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1'), withoutResult));
  });

  it('rejects a userId that is not the caller — no writing reports as someone else', async () => {
    await assertFails(
      setDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1'), validReport('r1', BOB))
    );
  });

  it('rejects a document id that disagrees with its path', async () => {
    await assertFails(
      setDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1'), validReport('different', ALICE))
    );
  });

  it('rejects wrong field types', async () => {
    await assertFails(
      setDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1'), {
        ...validReport('r1', ALICE),
        timestamp: 'not-a-number',
      })
    );
    await assertFails(
      setDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1'), {
        ...validReport('r1', ALICE),
        messages: [],
      })
    );
  });

  it('rejects an implausible timestamp', async () => {
    await assertFails(
      setDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1'), {
        ...validReport('r1', ALICE),
        timestamp: -1,
      })
    );
    await assertFails(
      setDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1'), {
        ...validReport('r1', ALICE),
        timestamp: 99999999999999,
      })
    );
  });

  it('rejects an over-long name', async () => {
    await assertFails(
      setDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1'), {
        ...validReport('r1', ALICE),
        name: 'x'.repeat(257),
      })
    );
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
  const write = (data: unknown, versionId = 'v2') =>
    setDoc(doc(aliceDb(), 'users', ALICE, 'reports', 'r1', 'versions', versionId), data as any);

  it('accepts exactly what the app writes', async () => {
    await assertSucceeds(write(validVersion('v2', 'r1', ALICE)));
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
