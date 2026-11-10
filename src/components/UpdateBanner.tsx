import { useEffect, useState } from 'react';

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

export default function UpdateBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => watchForUpdate(() => setReady(true)), []);
  if (!ready) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-16 z-[400] flex justify-center px-4">
      <p className="pointer-events-auto flex max-w-[560px] items-center gap-3 rounded-full bg-[#08182b] py-2 pl-4 pr-2 font-body-lg text-[13px] leading-[1.45] text-white shadow-[0_8px_24px_rgba(8,24,43,0.28)] dark:bg-[#e8eef8] dark:text-[#08182b]">
        <span>Forma has a new version.</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="cursor-pointer rounded-full bg-white/15 px-3 py-1 font-semibold text-white hover:bg-white/25 dark:bg-[#08182b]/10 dark:text-[#08182b] dark:hover:bg-[#08182b]/20"
        >
          Reload
        </button>
      </p>
    </div>
  );
}
