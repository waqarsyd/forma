import { closeFirebase } from './firebaseClient';

/**
 * What a sign-out takes out of the tab's session storage (2026-11-08, the site
 * audit's batch SG). Signing out clears the workspace, not only the
 * credential, so the next person at the browser finds none of the last one's
 * work; App's `forgetSignedOut` does that for everything it holds in memory.
 * Since the public pages stopped loading App, a sign-out there (the header's
 * menu, or another tab) had no App to do it, so the session's own keys are
 * listed here once and both the public site and App remove them.
 */
export const SIGNED_OUT_SESSION_KEYS = [
  'geminiApiKey:session', // the Gemini key (services/keyVault.ts)
  'openRouterKey:session', // the OpenRouter key (lib/aiProvider.ts)
  'forma:drafts', // each project's unsent words (lib/composerStore.ts)
  'forma:queue', // messages waiting to be sent (lib/composerStore.ts)
  'forma:openProject', // the project open in the workspace
  'forma:replyChanges', // what a reply's Undo can take back (lib/replyChanges.ts)
] as const;

/**
 * IndexedDB databases a sign-out deletes (2026-11-09, the SQL Server
 * programme, item 32): the SQL Server layouts and sample rows kept on this
 * device (lib/sqlSchemaStore.ts), which carry a company's table names and
 * real values. Since 2026-11-10 (the AI accuracy programme, batch AG item
 * 23) also the batch kept so it carries on after a limit or a reload
 * (lib/batchCheckpoint.ts), which holds its source files and their reports.
 * Since 2026-11-10 (the full audit) also the learning events kept on the
 * device (lib/learning.ts), which on the full tier hold whole reports.
 * Since 2026-11-11 (the full audit's WS-28, LM-18, SA-07 and SE-17) also the
 * report library (lib/libraryDb.ts), which holds the last person's reports cut
 * into examples and sent their house style to the next person's AI.
 * Named here, not imported, so the public site's bundle does not take the
 * stores; `signOut.test.ts` holds each name to its store's.
 */
export const SIGNED_OUT_DATABASES = ['forma-databases', 'forma-batch', 'forma-learning', 'forma-library'] as const;

/**
 * What a sign-out removes from the browser's lasting storage (2026-11-11, the
 * full audit's SA-07): which projects were pinned and archived, which library
 * files were ticked as house style (they name the last person's reports, and
 * the library they point into goes above), and, by prefix, when each account's
 * project list was last checked. `localStorage`, so they outlived the tab
 * where the session keys above do not. The memory is not here: it is kept per
 * account since the same day (lib/memory.ts), so the next person reads their
 * own and the last person finds theirs again on signing back in.
 */
export const SIGNED_OUT_LOCAL_KEYS = [
  'forma:pinnedProjects', // App.tsx, PINNED_PROJECTS_KEY
  'forma:archivedProjects', // App.tsx, ARCHIVED_PROJECTS_KEY
  'libraryCanonical', // App.tsx, CANONICAL_KEY: the library's house-style ticks
] as const;
export const SIGNED_OUT_LOCAL_PREFIXES = ['forma:indexCheckedAt:'] as const;

/** Removes those keys; storage that throws is left as it is. */
export function forgetLocal(storage: Pick<Storage, 'removeItem' | 'key' | 'length'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  if (!storage) return;
  try {
    const named: string[] = [...SIGNED_OUT_LOCAL_KEYS];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && SIGNED_OUT_LOCAL_PREFIXES.some((prefix) => key.startsWith(prefix))) named.push(key);
    }
    for (const key of named) storage.removeItem(key);
  } catch {
    /* storage blocked: nothing kept there to clear */
  }
}

/**
 * The start of every IndexedDB name Firestore's own cache uses (2026-11-11,
 * the full audit's SA-18): `firestore/<app>/<project>[.<database>]/...`, as
 * the SDK builds it. Signed in, the account's projects are kept there so a
 * change made offline survives a closed tab (lib/firebaseClient.ts); a
 * sign-out closes the database and clears it (`closeFirebase`, run by
 * `forgetSession`), and this deletes it by name as well, for a copy left by
 * a tab that is no longer open and for one whose clearing failed. Matched by prefix, not named, since the
 * names carry the project and database ids.
 */
export const FIRESTORE_CACHE_PREFIX = 'firestore/';

/** Deletes them; a browser without IndexedDB, or one that refuses, keeps nothing to delete. */
export function forgetDevice(
  idb: (Pick<IDBFactory, 'deleteDatabase'> & Partial<Pick<IDBFactory, 'databases'>>) | null = typeof indexedDB === 'undefined' ? null : indexedDB,
): void {
  if (!idb) return;
  for (const name of SIGNED_OUT_DATABASES) {
    try {
      idb.deleteDatabase(name);
    } catch {
      /* IndexedDB blocked: nothing kept there */
    }
  }
  // Listing is a promise, and a browser without it (Firefox before 126) leaves
  // the cache to closeFirebase, which clears it through the SDK.
  try {
    void idb
      .databases?.()
      .then((found) => {
        for (const { name } of found) {
          if (name?.startsWith(FIRESTORE_CACHE_PREFIX)) {
            try {
              idb.deleteDatabase(name);
            } catch {
              /* refused: closeFirebase cleared it, or nothing more can */
            }
          }
        }
      })
      .catch(() => undefined);
  } catch {
    /* IndexedDB blocked */
  }
}

/**
 * What this browser kept for one account, when the account itself is
 * deleted (2026-11-11, the full audit; a wave-4 follow-up): its memory,
 * `forma.memory:<uid>`, the time its projects were last checked, and the
 * learning switches when they name it. A plain sign-out leaves the memory,
 * which is the person's to find again on signing back in; a deleted account
 * will never sign back in. The rest of the browser's copy goes with the
 * sign-out that follows the deletion.
 */
export function forgetAccountLocally(
  uid: string,
  storage: Pick<Storage, 'getItem' | 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): void {
  if (!storage || !uid) return;
  try {
    storage.removeItem(`forma.memory:${uid}`); // lib/memory.ts, memoryKey
    storage.removeItem(`forma:indexCheckedAt:${uid}`); // App.tsx, the projects index
    const learning = storage.getItem('forma:learning'); // lib/learning.ts, SETTINGS_KEY
    if (learning && (JSON.parse(learning) as { uid?: unknown } | null)?.uid === uid) storage.removeItem('forma:learning');
  } catch {
    /* storage blocked, or a copy that is not JSON: nothing of the account readable there */
  }
}

/**
 * Removes the signed-out person's session keys, and what `forgetDevice` and
 * `forgetLocal` remove; storage that throws is left as it is.
 *
 * And closes the database this tab opened (`closeFirebase`), on the public
 * site as in App (2026-11-11, the SA-18 review). Deleting Firestore's stores
 * while they are open makes the SDK terminate that client, and only App
 * closed it: someone signed in on a shared report (/s/{id}) who signed out
 * from the public header, signed back in and went on to /workspace in the
 * same tab was handed the terminated client by `loadFirebase`, and every
 * read and save failed until a reload. Closing it here clears the memo, so
 * the next sign-in opens a fresh one; App's own close then finds nothing
 * left to do.
 */
export function forgetSession(
  storage: Pick<Storage, 'removeItem'> | null = typeof sessionStorage === 'undefined' ? null : sessionStorage,
  local: Pick<Storage, 'removeItem' | 'key' | 'length'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): void {
  void closeFirebase();
  forgetDevice();
  forgetLocal(local);
  if (!storage) return;
  for (const key of SIGNED_OUT_SESSION_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      /* storage blocked: nothing kept there to clear */
    }
  }
}
