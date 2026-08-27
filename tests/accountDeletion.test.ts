/**
 * Deleting an account has to take everything stored under it with it.
 *
 * Nothing verified this until now (audit DATA-001, the last remaining P1). The
 * rules suite beside this file proves a delete is *permitted*; it never proved
 * the application *performs* both of them. The consequence of a miss is not a
 * crash — it is an encrypted API key and a set of documents left behind after
 * someone asked to be forgotten, with no one able to reach them afterwards and
 * no way for them to find out.
 *
 * Two things make that miss plausible rather than theoretical:
 *
 *   - the vault document's id was written out as the literal 'geminiKey' in two
 *     unrelated files, one of which is the deletion path; and
 *   - the vault collection has **no `list` rule**, deliberately, so deletion
 *     cannot enumerate it and must know the id. A rename in one place would
 *     silently orphan every stored key.
 *
 * Run by `npm run test:rules`, which starts the emulator around this file. The
 * rules are enforced here exactly as in production — deletion runs through an
 * authenticated context, not with rules disabled, so a rules change that blocks
 * it fails this test too.
 *
 * What is NOT covered: `deleteUser`, the Firebase Auth half. That needs the Auth
 * emulator, which `firebase.json` does not configure. The data half is the half
 * that leaves residue.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, collection, getDocs, type Firestore } from 'firebase/firestore';
import fs from 'node:fs';
import {
  deleteAccountData,
  vaultDocRef,
  reportsCollectionRef,
  VAULT_DOC_ID,
} from '../src/lib/accountData';

const ALICE = 'alice-uid';
const BOB = 'bob-uid';

let testEnv: RulesTestEnvironment;

const validReport = (id: string, uid: string) => ({
  id,
  name: 'Quarterly Invoice',
  timestamp: Date.now(),
  messages: '[]',
  result: '{}',
  userId: uid,
});

const validVault = () => ({
  v: 1,
  ciphertext: 'Y2lwaGVydGV4dA==',
  iv: 'aXYtYnl0ZXM=',
  salt: 'c2FsdC1ieXRlcw==',
  iterations: 310000,
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'forma-deletion-test',
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

const asUser = (uid: string) => testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;

const seed = (path: string[], data: unknown) =>
  testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path.join('/')), data as any);
  });

/**
 * Read past the rules, so an assertion cannot be satisfied by a *denied* read —
 * "no documents" and "not allowed to look" would otherwise be indistinguishable,
 * and this test would pass against code that deletes nothing.
 *
 * `withSecurityRulesDisabled` insists its callback resolve to void, hence the
 * captured variable rather than a returned value.
 */
const countReports = async (uid: string): Promise<number> => {
  let size = -1;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDocs(collection(ctx.firestore(), 'users', uid, 'reports'));
    size = snap.size;
  });
  return size;
};

const vaultExists = async (uid: string): Promise<boolean> => {
  let exists: boolean | null = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), 'users', uid, 'vault', VAULT_DOC_ID));
    exists = snap.exists();
  });
  return exists as unknown as boolean;
};

describe('deleteAccountData', () => {
  it('removes every report', async () => {
    for (const id of ['r1', 'r2', 'r3']) await seed(['users', ALICE, 'reports', id], validReport(id, ALICE));
    expect(await countReports(ALICE)).toBe(3);

    await assertSucceeds(deleteAccountData(asUser(ALICE), ALICE));

    expect(await countReports(ALICE)).toBe(0);
  });

  it('removes the encrypted key vault', async () => {
    await seed(['users', ALICE, 'vault', VAULT_DOC_ID], validVault());
    expect(await vaultExists(ALICE)).toBe(true);

    await assertSucceeds(deleteAccountData(asUser(ALICE), ALICE));

    expect(await vaultExists(ALICE)).toBe(false);
  });

  it('removes both in one call — the case the finding is about', async () => {
    await seed(['users', ALICE, 'reports', 'r1'], validReport('r1', ALICE));
    await seed(['users', ALICE, 'vault', VAULT_DOC_ID], validVault());

    await deleteAccountData(asUser(ALICE), ALICE);

    expect(await countReports(ALICE)).toBe(0);
    expect(await vaultExists(ALICE)).toBe(false);
  });

  it('leaves another account untouched', async () => {
    await seed(['users', ALICE, 'reports', 'r1'], validReport('r1', ALICE));
    await seed(['users', BOB, 'reports', 'r1'], validReport('r1', BOB));
    await seed(['users', BOB, 'vault', VAULT_DOC_ID], validVault());

    await deleteAccountData(asUser(ALICE), ALICE);

    expect(await countReports(BOB)).toBe(1);
    expect(await vaultExists(BOB)).toBe(true);
  });

  it('succeeds when there is no vault — most accounts never store a key', async () => {
    await seed(['users', ALICE, 'reports', 'r1'], validReport('r1', ALICE));
    await expect(deleteAccountData(asUser(ALICE), ALICE)).resolves.toBeUndefined();
    expect(await countReports(ALICE)).toBe(0);
  });

  it('succeeds when the account is empty', async () => {
    await expect(deleteAccountData(asUser(ALICE), ALICE)).resolves.toBeUndefined();
  });

  it('deletes more reports than fit a single default page', async () => {
    // getDocs has no implicit limit, but a future change to paginate would
    // silently leave the tail behind, and nobody would look.
    const ids = Array.from({ length: 30 }, (_, i) => `r${i}`);
    for (const id of ids) await seed(['users', ALICE, 'reports', id], validReport(id, ALICE));
    expect(await countReports(ALICE)).toBe(30);

    await deleteAccountData(asUser(ALICE), ALICE);

    expect(await countReports(ALICE)).toBe(0);
  });
});

describe('the account document layout', () => {
  /**
   * The vault has no `list` rule, so deletion cannot discover the document — it
   * has to know the id. Pinning it here means a rename breaks a test rather
   * than silently orphaning every stored key.
   */
  it('pins the vault document id', () => {
    expect(VAULT_DOC_ID).toBe('geminiKey');
  });

  it('builds the same paths the app writes to', () => {
    const db = asUser(ALICE);
    expect(vaultDocRef(db, ALICE).path).toBe(`users/${ALICE}/vault/geminiKey`);
    expect(reportsCollectionRef(db, ALICE).path).toBe(`users/${ALICE}/reports`);
  });
});
