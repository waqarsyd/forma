import { useEffect, useState, useSyncExternalStore } from 'react';
import { currentPath, onRouteChange } from '../lib/router';

/**
 * Says when the browser has lost the network, and when it is back (2026-11-08,
 * the site audit's batch SG, item 89). Without it a request simply failed, and
 * the reason was a line in the reply, after the fact. Drawn once, in
 * `main.tsx`, over both the public site and the workspace, so neither can lose
 * it; a dark pill at the foot of the window, as Gmail and Google Docs show
 * theirs, with no border (the workspace's rule on orange edges).
 *
 * `navigator.onLine` is a hint, not a promise: true means a network interface
 * is up, not that Google answers. So the words claim only what it knows.
 *
 * The one offline notice since 2026-11-11 (the full audit's WS-21 and SA-26):
 * the workspace said it a second time, in another voice, as an error over
 * the message box. That went, and its one fact the pill lacked, that what is
 * typed is kept, is the pill's in the workspace; kept, not queued, since
 * nothing sends it on its own when the network returns (a message sent
 * offline is answered "send it again once you are back", geminiErrors.ts),
 * so the pill says to send it then. There the pill sits
 * at the top, since the box is at the foot of a phone's screen and the pill
 * covered it.
 */

/** Whether the page is the workspace, where the notices sit at the top. */
export function useInWorkspace(): boolean {
  return useSyncExternalStore(
    onRouteChange,
    () => currentPath() === '/workspace',
    () => false,
  );
}

/** What the pill says, offline or just back, in the workspace or on the public site. */
export function offlineText(online: boolean, showBack: boolean, inWorkspace: boolean): string {
  if (!online) {
    return inWorkspace
      ? 'You are offline. What is open stays here, and what you write is kept; send it once you are back.'
      : 'You are offline. What is open stays here; anything that needs the network waits until it is back.';
  }
  return showBack ? 'Back online.' : '';
}

/**
 * A word that stays until it is dismissed, as the public site says a sign-up's
 * "we sent a link" (PublicSite.tsx): the same pill for the workspace, which
 * dropped that word until 2026-11-11 (the full audit, a wave-4 follow-up).
 * At the top in the workspace, clear of the box. Here, in the page's entry
 * chunk beside the other pills drawn over every page, rather than in App's.
 */
export function NoticePill({ text, onDismiss, atTop }: { text: string; onDismiss: () => void; atTop: boolean }) {
  return (
    <div role="status" aria-live="polite" className={`landing pointer-events-none fixed inset-x-0 z-[90] flex justify-center px-4 ${atTop ? 'top-3' : 'bottom-6'}`}>
      <div className="pointer-events-auto flex max-w-[520px] items-start gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card px-4 py-3.5 font-body-lg text-[13.5px] leading-[1.55] text-on-surface-variant shadow-[var(--shadow-lg)]">
        <span>{text}</span>
        {/* The public site's orange ring on a public page; in the workspace a grey
            one, for the keyboard only, as every focus there is (no orange edges). */}
        <button
          type="button"
          onClick={onDismiss}
          className={`shrink-0 cursor-pointer rounded-full px-2 font-semibold text-secondary hover:underline ${atTop ? 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8a94a3]' : 'u-focus-ring'}`}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** Whether the browser reports a network, and true where nothing can tell (the build's prerender). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

const BACK_ONLINE_MS = 3000;

export default function OfflineBanner() {
  const online = useOnline();
  const inWorkspace = useInWorkspace();
  const [wasOffline, setWasOffline] = useState(false);
  const [showBack, setShowBack] = useState(false);

  useEffect(() => {
    if (!online) {
      setWasOffline(true);
      setShowBack(false);
      return;
    }
    if (!wasOffline) return;
    setShowBack(true);
    const timer = window.setTimeout(() => {
      setShowBack(false);
      setWasOffline(false);
    }, BACK_ONLINE_MS);
    return () => window.clearTimeout(timer);
  }, [online, wasOffline]);

  const text = offlineText(online, showBack, inWorkspace);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 z-[400] flex justify-center px-4 ${inWorkspace ? 'top-3' : 'bottom-4'}`}
    >
      {text && (
        <p className="pointer-events-auto max-w-[560px] rounded-full bg-[#08182b] px-4 py-2 text-center font-body-lg text-[13px] leading-[1.45] text-white shadow-[0_8px_24px_rgba(8,24,43,0.28)] dark:bg-[#e8eef8] dark:text-[#08182b]">
          {text}
        </p>
      )}
    </div>
  );
}
