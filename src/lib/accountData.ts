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
  getDocs,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';

/** Everything for one account hangs off `users/{uid}`. */
export const USERS_COLLECTION = 'users';

/** Saved projects. `firestore.rules` allows `list` here, scoped to the owner. */
export const REPORTS_COLLECTION = 'reports';

/** The encrypted key vault. No `list` rule — see the note above. */
export const VAULT_COLLECTION = 'vault';

/**
 * The one document the vault ever holds.
 *
 * Pinned by a test. If this ever needs to change, the migration has to delete
 * the old document *before* the new id ships, because afterwards nothing will
 * be able to find it.
 */
export const VAULT_DOC_ID = 'geminiKey';

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

export function vaultDocRef(db: Firestore, uid: string): DocumentReference {
  return doc(db, USERS_COLLECTION, uid, VAULT_COLLECTION, VAULT_DOC_ID);
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
  await Promise.all(reports.docs.map((entry) => deleteDoc(entry.ref)));

  await deleteDoc(vaultDocRef(db, uid)).catch((error) => {
    console.warn('Could not remove the stored key while deleting the account:', error);
  });
}
