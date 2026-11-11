/**
 * Two shared projects deleted in a row (2026-11-11, the full audit's WS-27).
 *
 * Each `deleteReportAndVersions` deletes the project's shares through
 * `deleteShare`, which reads the account's share count and writes it one
 * lower in the same batch; `firestore.rules` lets the count move by exactly
 * one per write. App's "Clear all" ran the deletions side by side, so both
 * read the same count and the second write was refused: "That project could
 * not be deleted" for a project the person had asked to delete. App now runs
 * them one after another (lib/deferredDelete.ts), and this is that order
 * against the rules as they are enforced in production.
 *
 * Measured before the fix, against the same emulator: the two deletions run
 * side by side settled as one fulfilled and one rejected, leaving the second
 * project, its share and a count of 1. Not kept as a test, because which of
 * the two loses depends on timing.
 *
 * Run by `npm run test:rules`, which starts the emulator around this file.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, setLogLevel, type Firestore } from 'firebase/firestore';
import fs from 'node:fs';
import { deleteReportAndVersions, writeShare, SHARES_COLLECTION } from '../src/lib/accountData';

// A refusal the rules are expected to make is logged by the SDK too; the assertions say what failed.
setLogLevel('silent');

const ALICE = 'alice-uid';
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const at = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8181').split(':');
  testEnv = await initializeTestEnvironment({
    projectId: 'forma-project-deletes-test',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: at[0], port: Number(at[1]) },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

const report = (id: string) => ({ id, name: 'Invoice', timestamp: Date.now(), messages: '[]', result: '{}', userId: ALICE });
const share = (id: string, reportId: string) => ({
  id,
  ownerId: ALICE,
  reportId,
  name: 'Invoice',
  result: '{"title":"Q","repxContent":"<x/>"}',
  access: 'link' as const,
  emails: [] as string[],
  timestamp: Date.now(),
});

/** Read past the rules, so a denied read cannot pass for a missing document. */
const read = async (path: string[]): Promise<Record<string, unknown> | null> => {
  let data: Record<string, unknown> | null = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), path.join('/')));
    data = snap.exists() ? snap.data() : null;
  });
  return data;
};

/** Two projects, each shared once through the count, as ShareDialog shares them. */
const twoSharedProjects = async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    for (const id of ['r1', 'r2']) await setDoc(doc(ctx.firestore(), 'users', ALICE, 'reports', id), report(id));
  });
  const verified = testEnv.authenticatedContext(ALICE, { email: 'alice@example.com', email_verified: true }).firestore() as unknown as Firestore;
  await writeShare(verified, ALICE, share('ShareOfOneXxxxxxxxxxxxx', 'r1'), true);
  await writeShare(verified, ALICE, share('ShareOfTwoXxxxxxxxxxxxx', 'r2'), true);
  expect((await read(['users', ALICE, 'meta', 'quota']))?.shares).toBe(2);
};

describe('deleting shared projects one after another (WS-27)', () => {
  it('deletes both, their shares with them, and brings the count down to nothing', async () => {
    await twoSharedProjects();
    const db = testEnv.authenticatedContext(ALICE).firestore() as unknown as Firestore;

    for (const id of ['r1', 'r2']) await deleteReportAndVersions(db, ALICE, id);

    expect(await read(['users', ALICE, 'reports', 'r1'])).toBeNull();
    expect(await read(['users', ALICE, 'reports', 'r2'])).toBeNull();
    expect(await read([SHARES_COLLECTION, 'ShareOfOneXxxxxxxxxxxxx'])).toBeNull();
    expect(await read([SHARES_COLLECTION, 'ShareOfTwoXxxxxxxxxxxxx'])).toBeNull();
    expect((await read(['users', ALICE, 'meta', 'quota']))?.shares).toBe(0);
  });
});
