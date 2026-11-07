/**
 * Where an account's data lives, and how to remove all of it.
 *
 * ## Why this is one module
 *
 * The layout was spelled out as string literals wherever it was needed:
 * `doc(db, 'users', uid, 'vault', 'geminiKey')` in `App.tsx`, the same path
 * again in `firebase.ts`'s deletion path, and `collection(db, 'users', uid,
 * 'reports')` in three places. Two independent copies of a document's identity,
 * one of them in the code responsible for erasing it.
 *
 * That is worse than ordinary duplication because of a deliberate decision in
 * `firestore.rules`: the vault has **no `list` clause**, on the grounds that the
 * app only ever addresses one document there. Deletion therefore cannot
 * discover the vault — it has to already know the id. Rename it in `App.tsx`
 * and the app keeps working perfectly while every stored key becomes
 * undeletable, unreachable, and invisible to the person who asked to be
 * forgotten. Nothing would fail, and nothing would say so.
 *
 * So the layout lives here once, and `tests/accountDeletion.test.ts` pins it.
 *
 * ## Why it takes a `Firestore` rather than importing one
 *
 * `services/firebase.ts` creates the app singleton at import time. A test that
 * imported it would be talking to the real project config; passing the instance
 * in means the emulator can supply its own, with the production rules loaded
 * and enforced. That is what makes this testable at all.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Query,
} from 'firebase/firestore';
import { MAX_SHARES } from './shares';

/** Everything for one account hangs off `users/{uid}`. */
export const USERS_COLLECTION = 'users';

/** Saved projects. `firestore.rules` allows `list` here, scoped to the owner. */
export const REPORTS_COLLECTION = 'reports';

/** The encrypted key vault. No `list` rule — see the note above. */
export const VAULT_COLLECTION = 'vault';

/**
 * Revision history, one document per version, beneath its report.
 *
 * A subcollection because a saved report is size-budgeted and a `result` runs
 * 50–200 kB; ten of those inline would break the budget several times over.
 * See `lib/revisionStore.ts`.
 *
 * **This is the collection that makes deletion non-obvious.** Firestore does
 * not delete a subcollection when its parent document is deleted — the parent
 * is not even required to exist for children to. So a report deleted without
 * its versions leaves them behind, reachable by nobody and invisible to
 * everybody, which is exactly the stranding this module exists to prevent for
 * the vault. `deleteReportAndVersions` is the only way a report should be
 * removed.
 */
export const VERSIONS_COLLECTION = 'versions';

/**
 * The one document the vault ever holds.
 *
 * Pinned by a test. If this ever needs to change, the migration has to delete
 * the old document *before* the new id ships, because afterwards nothing will
 * be able to find it.
 */
export const VAULT_DOC_ID = 'geminiKey';

/**
 * Shared copies of reports (2026-11-06, lib/shares.ts), top level because
 * people other than the owner read them. Each names its owner and the project
 * it came from, and **is removed with that project and with the account**:
 * a share left behind is a copy of someone's report still readable by
 * whoever holds its link, after they asked for it to be gone.
 */
export const SHARES_COLLECTION = 'shares';

export function shareDocRef(db: Firestore, shareId: string): DocumentReference {
  return doc(db, SHARES_COLLECTION, shareId);
}

/** The owner's shares, of one project or of all of them; the rules allow `list` only by a query naming the owner. */
export function ownedShares(db: Firestore, uid: string, reportId?: string): Query {
  const owned = where('ownerId', '==', uid);
  return reportId ? query(collection(db, SHARES_COLLECTION), owned, where('reportId', '==', reportId)) : query(collection(db, SHARES_COLLECTION), owned);
}

/**
 * The account's share count (2026-11-08, site audit item 57), at
 * `users/{uid}/meta/quota`: `{ shares, last }`. `firestore.rules` lets it move
 * only by one, in the same batch as the share it counts, and caps shares at
 * `MAX_SHARES`; so a share is created and deleted only through `writeShare`
 * and `deleteShare` below, one at a time.
 */
export const META_COLLECTION = 'meta';
export const QUOTA_DOC_ID = 'quota';
// MAX_SHARES lives in shares.ts (2026-11-08), which loads no Firestore, so the
// public Security page can state the limit without pulling the SDK in.

export function quotaDocRef(db: Firestore, uid: string): DocumentReference {
  return doc(db, USERS_COLLECTION, uid, META_COLLECTION, QUOTA_DOC_ID);
}

/** Thrown when an account already has `MAX_SHARES` shares. */
export class ShareLimitError extends Error {
  constructor() {
    super(`An account can share up to ${MAX_SHARES} reports at once. Stop sharing one to share another.`);
    this.name = 'ShareLimitError';
  }
}

async function sharesCounted(db: Firestore, uid: string): Promise<number> {
  const quota = await getDoc(quotaDocRef(db, uid));
  const n = quota.exists() ? Number(quota.data().shares) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Write a share: a new one with the count raised in the same batch, an existing one as it is. */
export async function writeShare(db: Firestore, uid: string, share: DocumentData & { id: string }, isNew: boolean): Promise<void> {
  if (!isNew) {
    await setDoc(shareDocRef(db, share.id), share);
    return;
  }
  const count = await sharesCounted(db, uid);
  if (count >= MAX_SHARES) throw new ShareLimitError();
  const batch = writeBatch(db);
  batch.set(shareDocRef(db, share.id), share);
  batch.set(quotaDocRef(db, uid), { shares: count + 1, last: share.id });
  await batch.commit();
}

/** Delete a share, lowering the count in the same batch while there is one to lower. */
export async function deleteShare(db: Firestore, uid: string, shareId: string): Promise<void> {
  const count = await sharesCounted(db, uid);
  if (count === 0) {
    await deleteDoc(shareDocRef(db, shareId));
    return;
  }
  const batch = writeBatch(db);
  batch.delete(shareDocRef(db, shareId));
  batch.set(quotaDocRef(db, uid), { shares: count - 1, last: shareId });
  await batch.commit();
}

/** Delete shares one at a time, as the count requires. */
async function deleteShares(db: Firestore, uid: string, shareIds: string[]): Promise<void> {
  for (const id of shareIds) await deleteShare(db, uid, id);
}

export function reportsCollectionRef(db: Firestore, uid: string): CollectionReference {
  return collection(db, USERS_COLLECTION, uid, REPORTS_COLLECTION);
}

/**
 * One saved project.
 *
 * `firestore.rules` requires `incoming().id == reportId` on create and pins
 * both on update, so the document id and the `id` field are the same value by
 * rule. Building the ref here keeps that pairing in one place.
 */
export function reportDocRef(db: Firestore, uid: string, reportId: string): DocumentReference {
  return doc(db, USERS_COLLECTION, uid, REPORTS_COLLECTION, reportId);
}

/**
 * The account's index of its projects (2026-11-08, site audit item 63): one
 * small document per project, `lib/savedReport.ts`'s `StoredReportIndex`,
 * which the list listens to instead of the projects themselves. Written beside
 * the project on every save, and deleted with it and with the account.
 */
export const REPORT_INDEX_COLLECTION = 'reportIndex';

export function reportIndexCollectionRef(db: Firestore, uid: string): CollectionReference {
  return collection(db, USERS_COLLECTION, uid, REPORT_INDEX_COLLECTION);
}

export function reportIndexDocRef(db: Firestore, uid: string, reportId: string): DocumentReference {
  return doc(db, USERS_COLLECTION, uid, REPORT_INDEX_COLLECTION, reportId);
}

export function vaultDocRef(db: Firestore, uid: string): DocumentReference {
  return doc(db, USERS_COLLECTION, uid, VAULT_COLLECTION, VAULT_DOC_ID);
}

export function versionsCollectionRef(db: Firestore, uid: string, reportId: string): CollectionReference {
  return collection(db, USERS_COLLECTION, uid, REPORTS_COLLECTION, reportId, VERSIONS_COLLECTION);
}

export function versionDocRef(
  db: Firestore,
  uid: string,
  reportId: string,
  versionId: string,
): DocumentReference {
  return doc(db, USERS_COLLECTION, uid, REPORTS_COLLECTION, reportId, VERSIONS_COLLECTION, versionId);
}

/**
 * Delete one report AND its version history.
 *
 * Versions first, then the report. The order matters for the same reason the
 * account-deletion order does: while the report exists the path to its versions
 * is ordinary, and a failure part-way leaves a report whose history is short
 * rather than an orphaned history with no report. The reverse order, on a
 * failure, leaves documents nobody can enumerate a route to.
 *
 * Never call `deleteDoc(reportDocRef(...))` directly. Firestore leaves the
 * subcollection behind, silently, and the result looks exactly like a
 * successful delete.
 */
export async function deleteReportAndVersions(
  db: Firestore,
  uid: string,
  reportId: string,
): Promise<void> {
  // Its shared copies first (2026-11-06): they are readable by others, so a
  // deleted project must not leave one behind.
  const shares = await getDocs(ownedShares(db, uid, reportId));
  await deleteShares(db, uid, shares.docs.map((entry) => entry.id));
  const versions = await getDocs(versionsCollectionRef(db, uid, reportId));
  await Promise.all(versions.docs.map((entry) => deleteDoc(entry.ref)));
  await deleteDoc(reportDocRef(db, uid, reportId));
  // Its index entry last (2026-11-08): a report gone and still listed opens
  // to nothing, which is better than one gone from the list and still stored.
  await deleteDoc(reportIndexDocRef(db, uid, reportId)).catch((error) => {
    console.warn('Could not remove the project from the index:', error);
  });
}

/**
 * Remove every document stored under an account.
 *
 * Called while the account still exists and is signed in, which is not
 * negotiable: `firestore.rules` only lets the owner touch these paths, so
 * deleting the Firebase Auth user first would strand the data with nobody able
 * to reach it. `deleteAccountAndData` in `services/firebase.ts` owns that
 * ordering; this function owns what gets deleted.
 *
 * The vault delete tolerates failure. Most accounts never stored a key, and
 * `deleteDoc` on a missing document is a no-op rather than an error — but a
 * rules edge on one optional document must not block the erasure the user
 * actually asked for. The reports delete is not tolerated: if those fail, the
 * caller needs to know before the account disappears.
 */
export async function deleteAccountData(db: Firestore, uid: string): Promise<void> {
  const reports = await getDocs(reportsCollectionRef(db, uid));
  // Through deleteReportAndVersions, not deleteDoc: a report's version history
  // is a subcollection, and Firestore does not remove those with the parent.
  // Deleting the reports directly here would leave every version behind, under
  // an account that no longer exists, addressable by nobody -- the precise
  // outcome the ordering in `deleteAccountAndData` exists to avoid.
  // One report at a time since 2026-11-08: each deletes its shares through
  // the share count, which moves by one per batch and so cannot be raced.
  for (const entry of reports.docs) await deleteReportAndVersions(db, uid, entry.id);
  // And any share whose project had already gone (2026-11-06): nothing else
  // would ever find it once the account does.
  const shares = await getDocs(ownedShares(db, uid));
  await deleteShares(db, uid, shares.docs.map((entry) => entry.id));
  // And any index entry whose project had already gone (2026-11-08);
  // tolerated, since the index is a copy of what the deletions above removed.
  await getDocs(reportIndexCollectionRef(db, uid))
    .then((index) => Promise.all(index.docs.map((entry) => deleteDoc(entry.ref))))
    .catch((error) => console.warn('Could not clear the projects index while deleting the account:', error));
  // The count itself, at zero now (2026-11-08); tolerated like the vault.
  await deleteDoc(quotaDocRef(db, uid)).catch((error) => {
    console.warn('Could not remove the share count while deleting the account:', error);
  });

  await deleteDoc(vaultDocRef(db, uid)).catch((error) => {
    console.warn('Could not remove the stored key while deleting the account:', error);
  });
}
