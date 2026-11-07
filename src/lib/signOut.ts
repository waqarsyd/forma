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

/** Removes the signed-out person's session keys; storage that throws is left as it is. */
export function forgetSession(storage: Pick<Storage, 'removeItem'> | null = typeof sessionStorage === 'undefined' ? null : sessionStorage): void {
  if (!storage) return;
  for (const key of SIGNED_OUT_SESSION_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      /* storage blocked: nothing kept there to clear */
    }
  }
}
