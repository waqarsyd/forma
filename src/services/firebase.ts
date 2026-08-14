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
import { getFirestore, doc, getDocFromServer, collection, getDocs, deleteDoc } from 'firebase/firestore';
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
 * The vault delete is tolerated failing: most accounts never stored a key, and
 * `deleteDoc` on a missing document is a no-op rather than an error, but a
 * rules edge should not block the deletion the user actually asked for.
 */
export const deleteAccountAndData = async (user: User, password?: string) => {
  await reauthenticate(user, password);

  const reports = await getDocs(collection(db, 'users', user.uid, 'reports'));
  await Promise.all(reports.docs.map((entry) => deleteDoc(entry.ref)));

  await deleteDoc(doc(db, 'users', user.uid, 'vault', 'geminiKey')).catch((error) => {
    console.warn('Could not remove the stored key while deleting the account:', error);
  });

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

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

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

// Test connection
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();
