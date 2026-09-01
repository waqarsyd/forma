import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  sendEmailVerification,
  EmailAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  updatePassword,
  verifyBeforeUpdateEmail,
  deleteUser,
  type User,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { deleteAccountData } from '../lib/accountData';
import { OperationType, type FirestoreErrorInfo } from '../lib/firestoreOps';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
// Bound to `app` explicitly. A bare getAuth() resolves the *default* app, which
// only happens to be this one because nothing else calls initializeApp — add a
// second app and the auth instance silently points at the wrong project.
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const signInWithEmail = async (email: string, password: string) => {
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
};

export const signUpWithEmail = async (email: string, password: string, displayName?: string) => {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName && result.user) {
    await updateProfile(result.user, { displayName });
  }

  // Sent here rather than left to the caller, so every account created through
  // this app gets one. Deliberately not awaited into the failure path: a mail
  // service having a bad minute must not turn a successful sign-up into an
  // error, and the account page can resend.
  sendEmailVerification(result.user).catch((error) => {
    console.warn('Could not send the verification email:', error);
  });

  return result.user;
};

/** Resend, from the account panel, when the first one never arrived. */
export const sendVerificationEmail = async (user: User) => {
  await sendEmailVerification(user);
};

/**
 * Whether this account signs in with a password at all.
 *
 * A Google account has no password to re-enter, and asking for one would be a
 * field nobody can fill. Everything below branches on this rather than assuming
 * one provider.
 */
export const hasPasswordProvider = (user: User) =>
  user.providerData.some((p) => p.providerId === 'password');

/**
 * Firebase requires a recent sign-in before a password change, an email change
 * or account deletion, and refuses with `auth/requires-recent-login` otherwise.
 * Password accounts re-enter their password; Google accounts go back through
 * the popup.
 */
export const reauthenticate = async (user: User, password?: string) => {
  if (hasPasswordProvider(user)) {
    if (!user.email) throw new Error('This account has no email address to re-authenticate with.');
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password ?? ''));
    return;
  }
  await reauthenticateWithPopup(user, googleProvider);
};

export const changePassword = async (user: User, currentPassword: string, nextPassword: string) => {
  await reauthenticate(user, currentPassword);
  await updatePassword(user, nextPassword);
};

/**
 * `verifyBeforeUpdateEmail`, not `updateEmail`: the address only changes once
 * the new one has been clicked through, so a typo cannot lock someone out of
 * their own account, and Firebase rejects the direct call outright when email
 * enumeration protection is on.
 */
export const requestEmailChange = async (user: User, newEmail: string, password?: string) => {
  await reauthenticate(user, password);
  await verifyBeforeUpdateEmail(user, newEmail);
};

export const setDisplayName = async (user: User, displayName: string) => {
  await updateProfile(user, { displayName });
};

/**
 * Delete the account **and everything stored under it**.
 *
 * Order matters and is not interchangeable: the documents live under
 * `users/{uid}/…` and `firestore.rules` only lets the signed-in owner touch
 * them, so they have to go while that account still exists. Deleting the user
 * first would leave the reports and the encrypted key behind with no one able
 * to reach them — orphaned data that the person asking to be forgotten cannot
 * get rid of.
 *
 * What gets deleted lives in `src/lib/accountData.ts`, which takes the
 * Firestore instance as an argument so the emulator can supply its own — that
 * is what lets `tests/accountDeletion.test.ts` prove both collections really go.
 * This function owns only the ordering, which is the part that cannot be tested
 * without the Auth emulator.
 */
export const deleteAccountAndData = async (user: User, password?: string) => {
  await reauthenticate(user, password);
  await deleteAccountData(db, user.uid);
  await deleteUser(user);
};

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error: any) {
    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
      // Just throw to let the UI handle it without logging an error
      throw error;
    }
    console.error('Error signing in with Google:', error);
    throw error;
  }
};

/**
 * Send a password-reset email. Callers must NOT report whether the address was
 * found: Firebase resolves `auth/user-not-found` here, and surfacing that turns
 * the form into an account-enumeration oracle. Report the same "if an account
 * exists…" wording either way.
 */
export const sendPasswordReset = async (email: string) => {
  await sendPasswordResetEmail(auth, email);
};

export const logOut = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Error signing out', error);
    throw error;
  }
};

/**
 * Re-exported, not defined here. `OperationType` moved to `lib/firestoreOps.ts`
 * because it is an enum: a caller writing `OperationType.GET` makes a *value*
 * reference, and while that value lived in this file it pulled the entire
 * Firebase SDK into the caller's chunk — defeating the lazy load in
 * `lib/firebaseClient.ts` on its own. `handleFirestoreError` below stays here
 * because it reads `auth.currentUser`.
 */
export { OperationType };
export type { FirestoreErrorInfo };

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/*
 * A `testConnection()` ran here at import time until 2026-09-01, reading
 * `test/connection` with `getDocFromServer`. Recover it with
 * `git log -S'testConnection' -- src/services/firebase.ts`.
 *
 * It was a Firestore round-trip **guaranteed to fail** — no rule matches that
 * path, so the global deny in `firestore.rules` rejected every one — made once
 * per page load, for every visitor, including the ones who only ever read the
 * landing page. What it bought was one `console.error` in the single case where
 * the failure message happened to contain "the client is offline"; every other
 * failure, the permission denial included, was caught and dropped. So it spent a
 * request and a logged error on every session to detect a condition the next
 * real Firestore call would surface anyway, with a better message.
 *
 * Do not add a connectivity probe back. If Firebase is misconfigured, the first
 * genuine read says so through `handleFirestoreError`, which has the operation
 * and the path a probe cannot know.
 */
