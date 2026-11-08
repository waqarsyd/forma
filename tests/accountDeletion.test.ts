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
  deleteReportAndVersions,
  vaultDocRef,
  reportsCollectionRef,
  versionsCollectionRef,
  VAULT_DOC_ID,
  VERSIONS_COLLECTION,
  SHARES_COLLECTION,
  shareDocRef,
  writeShare,
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

/**
 * Version history, and the one thing about it that is not obvious.
 *
 * **Firestore does not delete a subcollection when its parent document is
 * deleted.** A report removed with a plain `deleteDoc` leaves its whole history
 * behind — under an account that may itself be gone — reachable by nobody and
 * visible to nobody, including the person who asked to be forgotten. That is
 * the same stranding this module was written to prevent for the vault, and it
 * is why `deleteReportAndVersions` exists and why nothing may call
 * `deleteDoc(reportDocRef(...))` directly.
 *
 * These tests assert the absence, which is the only way that failure is
 * visible: everything about it looks like a successful delete.
 */
const validVersion = (id: string, reportId: string, uid: string) => ({
  id,
  reportId,
  label: 'Refined',
  timestamp: Date.now(),
  snapshot: '{"content":"# spec","repxContent":"<x/>","title":"R"}',
  userId: uid,
});

/** Past the rules, for the reason given above `countReports`. */
const countVersions = async (uid: string, reportId: string): Promise<number> => {
  let size = -1;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDocs(
      collection(ctx.firestore(), 'users', uid, 'reports', reportId, VERSIONS_COLLECTION),
    );
    size = snap.size;
  });
  return size;
};

const seedReportWithHistory = async (uid: string, reportId: string, versions: number) => {
  await seed(['users', uid, 'reports', reportId], validReport(reportId, uid));
  for (let i = 1; i <= versions; i++) {
    await seed(
      ['users', uid, 'reports', reportId, VERSIONS_COLLECTION, `v${i}`],
      validVersion(`v${i}`, reportId, uid),
    );
  }
};

describe('deleting a report takes its history with it', () => {
  it('removes every version', async () => {
    await seedReportWithHistory(ALICE, 'r1', 3);
    expect(await countVersions(ALICE, 'r1')).toBe(3);

    await deleteReportAndVersions(asUser(ALICE), ALICE, 'r1');

    expect(await countVersions(ALICE, 'r1')).toBe(0);
    expect(await countReports(ALICE)).toBe(0);
  });

  it('leaves another report\'s history alone', async () => {
    await seedReportWithHistory(ALICE, 'r1', 2);
    await seedReportWithHistory(ALICE, 'r2', 2);

    await deleteReportAndVersions(asUser(ALICE), ALICE, 'r1');

    expect(await countVersions(ALICE, 'r1')).toBe(0);
    expect(await countVersions(ALICE, 'r2')).toBe(2);
  });

  it('succeeds for a report that has no history', async () => {
    await seed(['users', ALICE, 'reports', 'r1'], validReport('r1', ALICE));
    await deleteReportAndVersions(asUser(ALICE), ALICE, 'r1');
    expect(await countReports(ALICE)).toBe(0);
  });
});

describe('deleting an account takes every history with it', () => {
  it('removes the versions of every report, not just the reports', async () => {
    // The regression this pins: deleteAccountData used a plain deleteDoc per
    // report, which would leave all six versions below addressable by nobody.
    await seedReportWithHistory(ALICE, 'r1', 3);
    await seedReportWithHistory(ALICE, 'r2', 3);
    await seed(['users', ALICE, 'vault', VAULT_DOC_ID], validVault());

    await deleteAccountData(asUser(ALICE), ALICE);

    expect(await countReports(ALICE)).toBe(0);
    expect(await countVersions(ALICE, 'r1')).toBe(0);
    expect(await countVersions(ALICE, 'r2')).toBe(0);
    expect(await vaultExists(ALICE)).toBe(false);
  });

  it('leaves another account\'s history untouched', async () => {
    await seedReportWithHistory(ALICE, 'r1', 2);
    await seedReportWithHistory(BOB, 'r1', 2);

    await deleteAccountData(asUser(ALICE), ALICE);

    expect(await countVersions(ALICE, 'r1')).toBe(0);
    expect(await countVersions(BOB, 'r1')).toBe(2);
  });
});

/**
 * Shared copies (2026-11-06). Unlike everything above they live outside
 * users/{uid}, at the top level, because other people read them; so nothing
 * about the account's own paths would find them, and a share left behind is
 * a copy of someone's report still readable by whoever holds its link.
 */
const validShare = (id: string, owner: string, reportId: string) => ({
  id,
  ownerId: owner,
  reportId,
  name: 'Quarterly Invoice',
  result: '{"title":"Q","repxContent":"<x/>"}',
  access: 'link',
  emails: [],
  timestamp: Date.now(),
});

const shareExists = async (id: string): Promise<boolean> => {
  let exists: boolean | null = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    exists = (await getDoc(doc(ctx.firestore(), SHARES_COLLECTION, id))).exists();
  });
  return exists as unknown as boolean;
};

describe('shared copies go with what they were shared from', () => {
  it("deleting a project removes its shares, and no other project's", async () => {
    await seedReportWithHistory(ALICE, 'r1', 1);
    await seed(['users', ALICE, 'reports', 'r2'], validReport('r2', ALICE));
    await seed([SHARES_COLLECTION, 'ShareOfR1xxxxxxxxxxxxx'], validShare('ShareOfR1xxxxxxxxxxxxx', ALICE, 'r1'));
    await seed([SHARES_COLLECTION, 'ShareOfR2xxxxxxxxxxxxx'], validShare('ShareOfR2xxxxxxxxxxxxx', ALICE, 'r2'));

    await deleteReportAndVersions(asUser(ALICE), ALICE, 'r1');

    expect(await shareExists('ShareOfR1xxxxxxxxxxxxx')).toBe(false);
    expect(await shareExists('ShareOfR2xxxxxxxxxxxxx')).toBe(true);
  });

  it("deleting an account removes every share it made, even one whose project is gone, and nobody else's", async () => {
    await seed(['users', ALICE, 'reports', 'r1'], validReport('r1', ALICE));
    await seed([SHARES_COLLECTION, 'AliceShareOfR1xxxxxxxx'], validShare('AliceShareOfR1xxxxxxxx', ALICE, 'r1'));
    await seed([SHARES_COLLECTION, 'AliceShareOrphanxxxxxx'], validShare('AliceShareOrphanxxxxxx', ALICE, 'gone'));
    await seed([SHARES_COLLECTION, 'BobSharexxxxxxxxxxxxxx'], validShare('BobSharexxxxxxxxxxxxxx', BOB, 'r1'));

    await deleteAccountData(asUser(ALICE), ALICE);

    expect(await shareExists('AliceShareOfR1xxxxxxxx')).toBe(false);
    expect(await shareExists('AliceShareOrphanxxxxxx')).toBe(false);
    expect(await shareExists('BobSharexxxxxxxxxxxxxx')).toBe(true);
  });

  it('pins the shares path the rules match', () => {
    expect(shareDocRef(asUser(ALICE), 'abc').path).toBe('shares/abc');
  });

  it("removes a project's index entry with it, and every entry with the account (2026-11-08, site audit item 63)", async () => {
    const entry = (id: string) => ({ id, name: 'Invoice', timestamp: Date.now(), search: '', notes: 0, userId: ALICE });
    await seed(['users', ALICE, 'reports', 'r1'], validReport('r1', ALICE));
    await seed(['users', ALICE, 'reports', 'r2'], validReport('r2', ALICE));
    await seed(['users', ALICE, 'reportIndex', 'r1'], entry('r1'));
    await seed(['users', ALICE, 'reportIndex', 'r2'], entry('r2'));
    await seed(['users', ALICE, 'reportIndex', 'orphan'], entry('orphan'));
    const indexIds = async () => {
      let ids: string[] = [];
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        ids = (await getDocs(collection(ctx.firestore(), 'users', ALICE, 'reportIndex'))).docs.map((d) => d.id);
      });
      return ids.sort();
    };

    await deleteReportAndVersions(asUser(ALICE), ALICE, 'r1');
    expect(await indexIds()).toEqual(['orphan', 'r2']);

    await deleteAccountData(asUser(ALICE), ALICE);
    expect(await indexIds()).toEqual([]);
  });

  it('removes shares made through the count, and the count itself (2026-11-08, site audit item 57)', async () => {
    const verified = testEnv.authenticatedContext(ALICE, { email: 'alice@example.com', email_verified: true }).firestore() as unknown as Firestore;
    await seed(['users', ALICE, 'reports', 'r1'], validReport('r1', ALICE));
    await seed(['users', ALICE, 'reports', 'r2'], validReport('r2', ALICE));
    // Made the way ShareDialog makes them, so the rules' count is in play.
    await writeShare(verified, ALICE, validShare('CountedShareOneXxxxxxxx', ALICE, 'r1'), true);
    await writeShare(verified, ALICE, validShare('CountedShareTwoXxxxxxxx', ALICE, 'r2'), true);
    // And one from before the count, which it never saw.
    await seed([SHARES_COLLECTION, 'LegacyShareXxxxxxxxxxxx'], validShare('LegacyShareXxxxxxxxxxxx', ALICE, 'r1'));

    await deleteAccountData(asUser(ALICE), ALICE);

    expect(await shareExists('CountedShareOneXxxxxxxx')).toBe(false);
    expect(await shareExists('CountedShareTwoXxxxxxxx')).toBe(false);
    expect(await shareExists('LegacyShareXxxxxxxxxxxx')).toBe(false);
    let quotaLeft = true;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      quotaLeft = (await getDoc(doc(ctx.firestore(), 'users', ALICE, 'meta', 'quota'))).exists();
    });
    expect(quotaLeft).toBe(false);
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

  /**
   * The versions path has to match the `match` block in `firestore.rules`
   * segment for segment, and neither can see the other. A rename on this side
   * makes every write fail the rule; a rename on that side makes every write
   * land somewhere the global deny covers. Both look like "saving is broken".
   */
  it('nests versions under the report they belong to', () => {
    expect(versionsCollectionRef(asUser(ALICE), ALICE, 'r1').path)
      .toBe(`users/${ALICE}/reports/r1/versions`);
  });
});
