/**
 * Firebase, loaded when the app first needs an account — not when the page does.
 *
 * `App.tsx` opened with `import { auth, db, ... } from './services/firebase'`
 * plus a direct `firebase/firestore` import, so the SDK was in the eager bundle:
 * **471.91 kB raw, 110.52 kB gzipped, 42% of the entry chunk**, in front of every
 * visitor to the landing page, the features page and the privacy policy. None of
 * those pages can sign anyone in, and the app is fully usable signed out —
 * projects go to `localStorage` and generation never touches Firebase at all.
 *
 * This is the same shape as `lib/pdf.ts` and `lib/genai.ts`, for the same reason,
 * with one extra wrinkle: three separate modules had to move together or the SDK
 * came back through whichever one was left behind.
 *
 *   - `services/firebase.ts`   the app singleton and auth helpers (`db` until 2026-11-01)
 *   - `firebase/firestore`     the document operations `App.tsx` calls directly
 *   - `lib/accountData.ts`     the path builders, which import `collection`/`doc`
 *
 * `lib/firestoreOps.ts` deliberately stays eager: it is a bare enum and an
 * interface with no `firebase/*` import, and `OperationType.GET` is a value
 * reference that would otherwise drag the SDK back in on its own.
 *
 * ## Session restore is one tick later than it was
 *
 * `onAuthStateChanged` now subscribes after this promise resolves rather than on
 * the first render. A signed-in user is briefly `null` — the same state a
 * signed-out visitor is in — so anything reading `user` must already tolerate it,
 * and it did: that null is what every visitor got before Firebase answered
 * anyway. What changed is how long it lasts, not that it happens.
 *
 * ## Auth first, Firestore only once someone is signed in (2026-11-01)
 *
 * Every page still loaded all three modules at start, for the auth state the
 * header shows, and Firestore was 64% of it: 395 KB of the 619 KB chunk,
 * parsed by every visitor, signed in or not. `loadAuth` now loads the app and
 * auth alone, which is what the auth subscription needs; `loadFirebase` adds
 * Firestore and the path builders, and opens the database, when something
 * first reads or writes it, which in the app is once a user has signed in.
 */
import { startAppCheck } from './appCheck';

type FirebaseService = typeof import('../services/firebase');
type FirestoreSdk = typeof import('firebase/firestore');
type AccountData = typeof import('./accountData');

/** What the auth state needs: the app singleton and its auth helpers. */
export interface AuthClient {
  /** The app singleton, auth helpers, `handleFirestoreError`. */
  service: FirebaseService;
}

export interface FirebaseClient extends AuthClient {
  /** `onSnapshot`, `query`, `getDoc`, `setDoc`, `deleteDoc`. */
  sdk: FirestoreSdk;
  /** `reportsCollectionRef`, `reportDocRef`, `vaultDocRef`. */
  paths: AccountData;
  /** The project's Firestore database, opened when this client first loads. */
  db: import('firebase/firestore').Firestore;
}

let pendingAuth: Promise<AuthClient> | null = null;
let pending: Promise<FirebaseClient> | null = null;

/*
 * Development against the emulators (2026-11-11, the full audit's SA-11a).
 * Every build talked to the live project, so a test session wrote its canned
 * projects, shares and learning into real accounts. With
 * `VITE_FIREBASE_EMULATORS=true` (.env.example) Auth and Firestore are the
 * local emulators instead, on the ports `firebase.json` gives them.
 *
 * In development only, checked rather than hoped: Vite loads `.env` for a
 * production build too, so the flag left in a developer's `.env` would ship a
 * build whose sign-in and saves went to 127.0.0.1 and failed for everyone
 * (the SA-11a review). `DEV` is false in every `vite build`.
 */
export const AUTH_EMULATOR_URL = 'http://127.0.0.1:9099';
export const FIRESTORE_EMULATOR = { host: '127.0.0.1', port: 8181 } as const;

/** Whether this build talks to the local emulators: a development build with the flag set. */
export function usesEmulators(env: Record<string, unknown> | undefined = import.meta.env as unknown as Record<string, unknown> | undefined): boolean {
  return env?.DEV === true && env.VITE_FIREBASE_EMULATORS === 'true';
}

/**
 * The project's database, kept in this browser as well as in memory
 * (2026-11-11, the full audit's SA-18). With the memory cache alone, a
 * signed-in person's change made offline, or in the second before the tab
 * closed, was gone: the save could not reach Google and nothing held it.
 * Firestore's own cache in IndexedDB keeps the write and sends it when the
 * tab next opens online, across every open tab. A sign-out deletes it
 * (`closeFirebase`, lib/signOut.ts), so the next person at the browser finds
 * none of it.
 *
 * Kept only for someone signed in: a signed-out visitor reading a shared
 * report has no work of their own to keep, and a copy of someone else's
 * report has no business outliving the tab. Opened once per app, and only
 * here: account deletion opened it plainly with `getFirestore` until the
 * SA-11a review (2026-11-11), which in emulator mode reached the live
 * database, so it goes through `loadFirebase` now. Should anything open it
 * some other way first, that one is used as it is; the emulator cannot be
 * connected to a database already started.
 */
export function openDatabase(
  sdk: Pick<FirestoreSdk, 'initializeFirestore' | 'getFirestore' | 'memoryLocalCache' | 'persistentLocalCache' | 'persistentMultipleTabManager' | 'connectFirestoreEmulator'>,
  app: import('firebase/app').FirebaseApp,
  databaseId: string,
  { signedIn, emulators = usesEmulators() }: { signedIn: boolean; emulators?: boolean },
): import('firebase/firestore').Firestore {
  let db: import('firebase/firestore').Firestore;
  try {
    const localCache = signedIn ? sdk.persistentLocalCache({ tabManager: sdk.persistentMultipleTabManager() }) : sdk.memoryLocalCache();
    db = sdk.initializeFirestore(app, { localCache }, databaseId);
  } catch {
    return sdk.getFirestore(app, databaseId);
  }
  if (emulators) sdk.connectFirestoreEmulator(db, FIRESTORE_EMULATOR.host, FIRESTORE_EMULATOR.port);
  return db;
}

/**
 * Closes the database and deletes what it kept in this browser, at sign-out;
 * the next `loadFirebase` opens a fresh one. A failure leaves the copy to
 * `forgetDevice`, which deletes Firestore's stores by name as well.
 */
export async function closeFirebase(): Promise<void> {
  const open = pending;
  if (!open) return;
  pending = null;
  try {
    const { sdk, db } = await open;
    await sdk.terminate(db);
    await sdk.clearIndexedDbPersistence(db);
  } catch (err) {
    console.warn('The database kept in this browser could not be cleared here; it is deleted with the rest.', err);
  }
}

/** Load the app and auth alone, as every page does for the signed-in state. Memoised like `loadFirebase`. */
export function loadAuth(): Promise<AuthClient> {
  if (!pendingAuth) pendingAuth = import('../services/firebase').then((service) => ({ service }));
  return pendingAuth;
}

/**
 * Load Firebase with Firestore.
 *
 * Memoised on the promise rather than the module, like `loadGenAI`: a cloud
 * save, the projects list and a vault read can all be the first caller, and
 * on a fast connection two of them routinely overlap.
 */
export function loadFirebase(): Promise<FirebaseClient> {
  if (!pending) {
    pending = Promise.all([
      loadAuth(),
      import('firebase/firestore'),
      import('./accountData'),
    ])
      // App Check first, when it has a key (lib/appCheck.ts, site audit item
      // 56): the database is the one thing it guards, and this is the only
      // way to the database, so a signed-out reader never loads reCAPTCHA.
      .then(async ([client, sdk, paths]) => {
        await startAppCheck(client.service.app);
        return [client, sdk, paths] as const;
      })
      .then(([{ service }, sdk, paths]) => ({
        service,
        sdk,
        paths,
        db: openDatabase(sdk, service.app, service.firestoreDatabaseId, { signedIn: Boolean(service.auth?.currentUser) }),
      }));
  }
  return pending;
}

/* `lib/genai.ts` ends with a `resetGenAIForTests()` seam and this file had a
   matching `resetFirebaseForTests()` for one day, copied from it. Removed
   2026-09-01: knip reported it, and it was true — nothing imported it, because
   there is no test for this module to reset. The one it was copied from is
   equally unused, but it is grandfathered into the seven unused exports the
   Phase 4 pass measured at exactly zero shipped bytes, whereas this one was new
   and CONTRIBUTING.md's definition of done says not to add those. Add it back
   the day a test needs it; `git log -S'resetFirebaseForTests'` has the shape. */
