import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
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
  type ActionCodeSettings,
  type User,
} from 'firebase/auth';
import { OperationType, type FirestoreErrorInfo } from '../lib/firestoreOps';
import firebaseConfig from '../../firebase-applet-config.json';
import { authDomainFor, canRedirectSignIn } from '../lib/authDomain';
import { AUTH_EMULATOR_URL, loadFirebase, usesEmulators } from '../lib/firebaseClient';
import { forgetAccountLocally } from '../lib/signOut';

/*
 * Auth only: Firestore is not imported here (2026-11-01). It was, with `db`
 * opened at import, and that made every visitor of every page download and
 * parse 395 KB of database SDK to learn whether they were signed in, which is
 * all the site's header needs. `loadFirebase` in lib/firebaseClient.ts opens
 * the database from `app` and `firestoreDatabaseId` when something first
 * reads or writes it; account deletion loads it below when it runs.
 */
const pageHost = typeof window === 'undefined' ? undefined : window.location.hostname;
/** Sign-in on the site's own host where it is listed (lib/authDomain.ts, site audit item 98, on since 2026-11-12). */
const authDomain = authDomainFor(pageHost, firebaseConfig.authDomain);
export const app = initializeApp({ ...firebaseConfig, authDomain });
/** The Firestore database this project's data lives in; `loadFirebase` opens it. */
export const firestoreDatabaseId = firebaseConfig.firestoreDatabaseId;
// Bound to `app` explicitly. A bare getAuth() resolves the *default* app, which
// only happens to be this one because nothing else calls initializeApp — add a
// second app and the auth instance silently points at the wrong project.
export const auth = getAuth(app);
// The local Auth emulator in development when asked (2026-11-11, the full
// audit's SA-11a; lib/firebaseClient.ts connects Firestore's beside it).
if (usesEmulators()) connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true });
const googleProvider = new GoogleAuthProvider();

/**
 * Where the link in an account email brings the person back to (2026-11-11,
 * the full audit, SA-09). Without it Firebase's own page on the project's
 * firebaseapp.com domain verified the address or set the password and then
 * stopped, with no button back, on a domain some people read as phishing.
 * A reset returns to the sign-in page, a verification or an address change
 * to the workspace. What the email itself says, and from whom, is set in the
 * Firebase console (the owner's; see the README's Firebase steps).
 */
function returnTo(path: '/login' | '/workspace'): ActionCodeSettings | undefined {
  if (typeof window === 'undefined') return undefined;
  return { url: `${window.location.origin}${path}` };
}

/**
 * Send an account email with the way back, and without it when Firebase
 * refuses this host as a destination: a self-hosted copy whose domain is not
 * on the project's authorised list still gets its email, as before, rather
 * than a sign-up that cannot verify and a reset that never arrives.
 */
async function sendWithReturn(path: '/login' | '/workspace', send: (settings?: ActionCodeSettings) => Promise<void>): Promise<void> {
  const settings = returnTo(path);
  if (!settings) return send();
  try {
    await send(settings);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code !== 'auth/unauthorized-continue-uri' && code !== 'auth/invalid-continue-uri') throw error;
    await send();
  }
}

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
  sendWithReturn('/workspace', (settings) => sendEmailVerification(result.user, settings)).catch((error) => {
    console.warn('Could not send the verification email:', error);
  });

  return result.user;
};

/** Resend, from the account panel, when the first one never arrived. */
export const sendVerificationEmail = async (user: User) => {
  await sendWithReturn('/workspace', (settings) => sendEmailVerification(user, settings));
};

/**
 * Whether the account's address is verified, as the database will see it
 * (2026-11-11, the full audit, SA-08).
 *
 * Two copies of that fact go stale on their own. `emailVerified` on the User
 * changes only when the user is reloaded, so someone who clicks the link in
 * another tab and comes back is still "unverified" here; and the rules read
 * `email_verified` from the ID token, which is refreshed hourly, so even after
 * a page reload the first share is refused for up to an hour. So: reload the
 * user when it says unverified, and when it is verified but the token still
 * says otherwise, fetch a fresh token. A verified account whose token already
 * agrees costs nothing but a local decode.
 */
export const refreshVerification = async (user: User | null = auth.currentUser): Promise<boolean> => {
  if (!user) return false;
  // reload() updates this same object in place, as auth.currentUser is.
  if (!user.emailVerified) await user.reload();
  if (!user.emailVerified) return false;
  const token = await user.getIdTokenResult();
  if (token.claims.email_verified !== true) await user.getIdToken(true);
  return true;
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
const reauthenticate = async (user: User, password?: string) => {
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
  await sendWithReturn('/workspace', (settings) => verifyBeforeUpdateEmail(user, newEmail, settings));
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
  // Loaded here rather than at import: see the note on `app` above. The
  // database the app opens, not one of its own (2026-11-11, the SA-11a
  // review): `loadFirebase` starts App Check first (SA-25: once enforcement
  // is on, a deletion run before anything had loaded the database would be
  // refused), and connects the emulator in development, where a plain
  // `getFirestore` here deleted from the live database instead.
  const { db, paths } = await loadFirebase();
  await paths.deleteAccountData(db, user.uid);
  await deleteUser(user);
  // And what this browser kept for the account (2026-11-11, the full audit,
  // a wave-4 follow-up): its memory and its learning switches, which name it.
  // The sign-out that follows clears the rest, as any sign-out does.
  forgetAccountLocally(user.uid);
};

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error: any) {
    // A blocked pop-up goes by redirect instead (site audit item 98), once
    // sign-in runs on this site's own host, which is what lets the redirect
    // come back here with the session; until then the dialog asks for pop-ups.
    if (error.code === 'auth/popup-blocked' && canRedirectSignIn(authDomain, pageHost)) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
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
  await sendWithReturn('/login', (settings) => sendPasswordResetEmail(auth, email, settings));
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
  // The details stay in the console; what is thrown carries no account
  // (2026-11-08, site audit item 62): its text was this same JSON, uid and
  // email included, and a caller that showed an error's message showed them.
  throw new Error(`Firestore ${operationType} failed${path ? ` on ${path.replace(/users\/[^/]+/, 'users/{uid}')}` : ''}: ${errInfo.error}`);
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
