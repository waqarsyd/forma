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
import { doc, getDoc, setDoc, deleteDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
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

const aliceDb = () => testEnv.authenticatedContext(ALICE).firestore();
const bobDb = () => testEnv.authenticatedContext(BOB).firestore();
const anonDb = () => testEnv.unauthenticatedContext().firestore();

/** Seed a document past the rules, so read/update/delete tests have something to act on. */
const seed = (path: string[], data: unknown) =>
  testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path.join('/')), data as any);
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
