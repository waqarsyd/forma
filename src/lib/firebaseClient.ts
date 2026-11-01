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
    ]).then(([{ service }, sdk, paths]) => ({ service, sdk, paths, db: sdk.getFirestore(service.app, service.firestoreDatabaseId) }));
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
