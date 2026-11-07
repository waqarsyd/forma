import { useEffect, useState, useSyncExternalStore } from 'react';

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
 */
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

  const text = !online
    ? 'You are offline. What is open stays here; anything that needs the network waits until it is back.'
    : showBack
      ? 'Back online.'
      : '';

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[400] flex justify-center px-4"
    >
      {text && (
        <p className="pointer-events-auto max-w-[560px] rounded-full bg-[#08182b] px-4 py-2 text-center font-body-lg text-[13px] leading-[1.45] text-white shadow-[0_8px_24px_rgba(8,24,43,0.28)] dark:bg-[#e8eef8] dark:text-[#08182b]">
          {text}
        </p>
      )}
    </div>
  );
}
