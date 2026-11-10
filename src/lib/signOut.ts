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
 * Named here, not imported, so the public site's bundle does not take the
 * stores; `signOut.test.ts` holds each name to its store's.
 */
export const SIGNED_OUT_DATABASES = ['forma-databases', 'forma-batch', 'forma-learning'] as const;

/** Deletes them; a browser without IndexedDB, or one that refuses, keeps nothing to delete. */
export function forgetDevice(idb: Pick<IDBFactory, 'deleteDatabase'> | null = typeof indexedDB === 'undefined' ? null : indexedDB): void {
  if (!idb) return;
  for (const name of SIGNED_OUT_DATABASES) {
    try {
      idb.deleteDatabase(name);
    } catch {
      /* IndexedDB blocked: nothing kept there */
    }
  }
}

/** Removes the signed-out person's session keys, and what `forgetDevice` deletes; storage that throws is left as it is. */
export function forgetSession(storage: Pick<Storage, 'removeItem'> | null = typeof sessionStorage === 'undefined' ? null : sessionStorage): void {
  forgetDevice();
  if (!storage) return;
  for (const key of SIGNED_OUT_SESSION_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      /* storage blocked: nothing kept there to clear */
    }
  }
}
