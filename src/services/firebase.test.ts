/**
 * The account emails and the deletion order (2026-11-11, the full audit),
 * with Firebase replaced at the module boundary: what the rules allow is the
 * emulator suite's to prove, and the Auth half needs an Auth emulator this
 * project does not run. What is checked here is what this module asks of
 * Firebase.
 *
 * - SA-09: every account email carries the way back to Forma, the sign-in
 *   page for a reset and the workspace otherwise, and is still sent without
 *   it when Firebase refuses the host as a destination.
 * - SA-08: a verification made in another tab reaches the token the rules
 *   read, without a reload of the page.
 * - SA-25: deleting an account starts App Check before it opens the database.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const calls: string[] = [];
const auth = {
  sendEmailVerification: vi.fn(async (..._args: unknown[]) => undefined),
  sendPasswordResetEmail: vi.fn(async (..._args: unknown[]) => undefined),
  verifyBeforeUpdateEmail: vi.fn(async (..._args: unknown[]) => undefined),
  reauthenticateWithCredential: vi.fn(async () => undefined),
  reauthenticateWithPopup: vi.fn(async () => undefined),
  deleteUser: vi.fn(async () => {
    calls.push('deleteUser');
  }),
};

vi.mock('firebase/app', () => ({ initializeApp: () => ({ name: 'app' }) }));
vi.mock('firebase/auth', () => ({
  connectAuthEmulator: vi.fn(),
  getAuth: () => ({ currentUser: null }),
  GoogleAuthProvider: class {},
  EmailAuthProvider: { credential: () => ({}) },
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  updateProfile: vi.fn(),
  updatePassword: vi.fn(),
  sendEmailVerification: (...args: unknown[]) => auth.sendEmailVerification(...args),
  sendPasswordResetEmail: (...args: unknown[]) => auth.sendPasswordResetEmail(...args),
  verifyBeforeUpdateEmail: (...args: unknown[]) => auth.verifyBeforeUpdateEmail(...args),
  reauthenticateWithCredential: () => auth.reauthenticateWithCredential(),
  reauthenticateWithPopup: () => auth.reauthenticateWithPopup(),
  deleteUser: () => auth.deleteUser(),
}));
vi.mock('../lib/appCheck', () => ({
  startAppCheck: vi.fn(async () => {
    calls.push('appCheck');
  }),
}));
/* The database lib/firebaseClient opens, as the rest of the app does (the
   SA-11a review): deletion no longer opens one of its own. */
vi.mock('firebase/firestore', () => ({
  initializeFirestore: () => {
    calls.push('openDatabase');
    return {};
  },
  getFirestore: () => {
    calls.push('getFirestore');
    return {};
  },
  memoryLocalCache: () => ({}),
  persistentLocalCache: () => ({}),
  persistentMultipleTabManager: () => ({}),
  connectFirestoreEmulator: vi.fn(),
}));
vi.mock('../lib/accountData', () => ({
  deleteAccountData: vi.fn(async () => {
    calls.push('deleteAccountData');
  }),
}));
vi.mock('../lib/signOut', () => ({
  forgetAccountLocally: vi.fn((uid: string) => {
    calls.push(`forgetAccountLocally:${uid}`);
  }),
}));

type Service = typeof import('./firebase');
let service: Service;

beforeAll(async () => {
  // The module reads the page's host when it loads, and the return address
  // from the page's origin, so the page exists before it is imported.
  vi.stubGlobal('window', { location: { hostname: 'openforma.web.app', origin: 'https://openforma.web.app' } });
  service = await import('./firebase');
});

beforeEach(() => {
  calls.length = 0;
  for (const fn of Object.values(auth)) fn.mockClear();
});

const passwordUser = (over: Record<string, unknown> = {}) =>
  ({ uid: 'alice', email: 'alice@example.com', emailVerified: false, providerData: [{ providerId: 'password' }], ...over }) as never;

describe('the account emails bring the person back to Forma (SA-09)', () => {
  it('sends a reset back to the sign-in page', async () => {
    await service.sendPasswordReset('alice@example.com');
    expect(auth.sendPasswordResetEmail.mock.calls[0][2]).toEqual({ url: 'https://openforma.web.app/login' });
  });

  it('sends a verification and an address change back to the workspace', async () => {
    await service.sendVerificationEmail(passwordUser());
    expect(auth.sendEmailVerification.mock.calls[0][1]).toEqual({ url: 'https://openforma.web.app/workspace' });
    await service.requestEmailChange(passwordUser(), 'new@example.com', 'secret');
    expect(auth.verifyBeforeUpdateEmail.mock.calls[0][2]).toEqual({ url: 'https://openforma.web.app/workspace' });
  });

  it('still sends the email when Firebase will not send people to this host', async () => {
    auth.sendPasswordResetEmail.mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'auth/unauthorized-continue-uri' }));
    await service.sendPasswordReset('alice@example.com');
    expect(auth.sendPasswordResetEmail).toHaveBeenCalledTimes(2);
    expect(auth.sendPasswordResetEmail.mock.calls[1][2]).toBeUndefined();
  });

  it('does not resend on any other failure', async () => {
    auth.sendPasswordResetEmail.mockRejectedValueOnce(Object.assign(new Error('slow down'), { code: 'auth/too-many-requests' }));
    await expect(service.sendPasswordReset('alice@example.com')).rejects.toThrow('slow down');
    expect(auth.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });
});

describe('a verification made elsewhere reaches the token (SA-08)', () => {
  it('reloads an unverified user, and refreshes a token that still says unverified', async () => {
    const getIdToken = vi.fn(async () => 'fresh');
    const user = {
      emailVerified: false,
      reload: vi.fn(async () => {
        user.emailVerified = true;
      }),
      getIdTokenResult: vi.fn(async () => ({ claims: { email_verified: false } })),
      getIdToken,
    };
    expect(await service.refreshVerification(user as never)).toBe(true);
    expect(user.reload).toHaveBeenCalled();
    expect(getIdToken).toHaveBeenCalledWith(true);
  });

  it('says false, and refreshes nothing, while the address is still unverified', async () => {
    const user = { emailVerified: false, reload: vi.fn(async () => undefined), getIdTokenResult: vi.fn(), getIdToken: vi.fn() };
    expect(await service.refreshVerification(user as never)).toBe(false);
    expect(user.getIdToken).not.toHaveBeenCalled();
  });

  it('leaves a verified account whose token agrees alone', async () => {
    const user = { emailVerified: true, reload: vi.fn(), getIdTokenResult: vi.fn(async () => ({ claims: { email_verified: true } })), getIdToken: vi.fn() };
    expect(await service.refreshVerification(user as never)).toBe(true);
    expect(user.reload).not.toHaveBeenCalled();
    expect(user.getIdToken).not.toHaveBeenCalled();
  });

  it('says false with nobody signed in', async () => {
    expect(await service.refreshVerification(null)).toBe(false);
  });
});

describe('deleting an account (SA-25)', () => {
  // And, since 2026-11-11 (a wave-4 follow-up), what this browser kept for the account, once it is gone.
  it('starts App Check before it opens the database, deletes the user after the data, and then what this browser kept for it', async () => {
    await service.deleteAccountAndData(passwordUser({ emailVerified: true }), 'secret');
    expect(calls).toEqual(['appCheck', 'openDatabase', 'deleteAccountData', 'deleteUser', 'forgetAccountLocally:alice']);
  });
});
