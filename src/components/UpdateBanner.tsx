import { useEffect, useState } from 'react';
import { isStaleWaiting, onStaleWaiting } from '../lib/staleChunks';
import { useInWorkspace } from './OfflineBanner';

/**
 * Says when a newer Forma has taken over the tab (2026-11-10, the full
 * audit, batch FE). The offline worker (`lib/serviceWorker.ts`) installs a
 * new build with `skipWaiting` and claims every open tab at once, silently:
 * the tab kept running the old chunks, and the first lazy load after a deploy
 * found its file gone and reloaded the page (`lib/staleChunks.ts`), without a
 * word. Gmail, Linear and Vercel's apps say "a new version is available" with
 * a reload instead, so the person chooses the moment. Drawn once, in
 * `main.tsx`, over the public site and the workspace, as the offline pill is.
 *
 * `controllerchange` also fires the first time a worker takes a page that had
 * none, on a first visit; that is not an update, so the pill shows only when
 * the tab already had a worker when it loaded.
 *
 * Since 2026-11-11 (the full audit's SA-16, WS-21 and WS-47) it also says
 * when a new build was found while Forma was working, and that the tab
 * reloads when the work finishes (`lib/staleChunks.ts` holds the reload until
 * then); it can be dismissed; it sits under the dialogs (z-index 55, the
 * workspace's dialogs being 60), which it covered at 400; and in the
 * workspace it sits at the top, where it cannot cover the message box.
 */
export function watchForUpdate(onUpdate: () => void, container: { controller: unknown; addEventListener: (type: string, fn: () => void) => void; removeEventListener: (type: string, fn: () => void) => void } | undefined = navigator.serviceWorker): () => void {
  if (!container) return () => undefined;
  const had = Boolean(container.controller);
  const on = () => {
    if (had) onUpdate();
  };
  container.addEventListener('controllerchange', on);
  return () => container.removeEventListener('controllerchange', on);
}

/** How often an open tab asks whether there is a newer build. */
export const UPDATE_CHECK_MS = 30 * 60_000;

/**
 * Asks the worker's registration for a newer build every half hour and
 * whenever the tab is shown again (2026-11-11, the full audit's SA-16). The
 * browser checks only on a navigation, and the workspace is one page that is
 * left open for days, so a deploy reached it only when a lazy load found its
 * file gone. Returns the way to stop.
 */
export function checkForUpdates(registration: { update: () => Promise<unknown> }, win: Pick<Window, 'setInterval' | 'clearInterval'> = window, doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> = document): () => void {
  const check = () => void registration.update().catch(() => undefined);
  const timer = win.setInterval(check, UPDATE_CHECK_MS);
  const onShown = () => {
    if (doc.visibilityState === 'visible') check();
  };
  doc.addEventListener('visibilitychange', onShown);
  return () => {
    win.clearInterval(timer);
    doc.removeEventListener('visibilitychange', onShown);
  };
}

type Shown = 'none' | 'ready' | 'waiting';

export default function UpdateBanner() {
  const [shown, setShown] = useState<Shown>(() => (isStaleWaiting() ? 'waiting' : 'none'));
  const [dismissed, setDismissed] = useState(false);
  const inWorkspace = useInWorkspace();
  useEffect(() => watchForUpdate(() => setShown((now) => (now === 'waiting' ? now : 'ready'))), []);
  useEffect(
    () =>
      onStaleWaiting(() => {
        setShown('waiting');
        setDismissed(false);
      }),
    [],
  );
  if (shown === 'none' || dismissed) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 z-[55] flex justify-center px-4 ${inWorkspace ? 'top-14' : 'bottom-16'}`}
    >
      <p className="pointer-events-auto flex max-w-[560px] items-center gap-3 rounded-full bg-[#08182b] py-2 pl-4 pr-2 font-body-lg text-[13px] leading-[1.45] text-white shadow-[0_8px_24px_rgba(8,24,43,0.28)] dark:bg-[#e8eef8] dark:text-[#08182b]">
        <span>{shown === 'waiting' ? 'Forma has a new version. It reloads when this finishes.' : 'Forma has a new version.'}</span>
        {/* Waiting, it reloads on its own; the button is for someone who would rather not wait. */}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="cursor-pointer rounded-full bg-white/15 px-3 py-1 font-semibold text-white hover:bg-white/25 dark:bg-[#08182b]/10 dark:text-[#08182b] dark:hover:bg-[#08182b]/20"
        >
          {shown === 'waiting' ? 'Reload now' : 'Reload'}
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={() => setDismissed(true)}
          className="cursor-pointer rounded-full px-2 py-1 text-white/80 hover:bg-white/15 hover:text-white dark:text-[#08182b]/70 dark:hover:bg-[#08182b]/10 dark:hover:text-[#08182b]"
        >
          ×
        </button>
      </p>
    </div>
  );
}
