import { useState, useSyncExternalStore } from 'react';
import { currentPath, onRouteChange } from '../lib/router';
import { SITE_ORIGIN } from '../lib/seo';
import { useInWorkspace } from './OfflineBanner';

/**
 * A note on Forma's other addresses (2026-11-12, the owner's decision 9 of
 * the 2026-11-11 audit, SA-27). forma-201ba.web.app, and each site's
 * firebaseapp.com twin, serve the same app as openforma.web.app, but each is
 * an origin of its own, so what the browser keeps for one is not there on
 * another: projects kept while signed out stay on the address they were made
 * on, while a signed-in account's projects follow it anywhere. Someone who
 * came in by the second address would find their work missing on the first,
 * or the other way round, and not know why.
 *
 * So, there and nowhere else, one line says which address is Forma's own and
 * why it matters, with a link to the same page there. `main.tsx` decides after
 * the first draw, from the address (`isOtherHost` in lib/seo.ts), and loads
 * this module only then: both sites serve the same prerendered files, so the
 * built pages carry nothing of it, and openforma.web.app draws nothing.
 * Dismissed, it stays closed on this device (`CLOSED_KEY`). Drawn as the
 * notice pill that stays until dismissed (`NoticePill` in OfflineBanner.tsx),
 * at the foot of a public page and at the top of the workspace, clear of the
 * message box, under the dialogs as the update pill is; no `motion.*`, as
 * nothing in the public tree has.
 */

/** Set once the note is dismissed, so it stays closed on this device. */
export const CLOSED_KEY = 'forma:otherHostNoticeClosed';

function wasClosed(): boolean {
  try {
    return localStorage.getItem(CLOSED_KEY) === '1';
  } catch {
    return false;
  }
}

export default function OtherHostNotice() {
  const [closed, setClosed] = useState(wasClosed);
  const inWorkspace = useInWorkspace();
  const path = useSyncExternalStore(onRouteChange, currentPath, () => '/');
  if (closed) return null;
  const close = () => {
    setClosed(true);
    try {
      localStorage.setItem(CLOSED_KEY, '1');
    } catch {
      /* storage blocked: closed for this visit only */
    }
  };
  // The public site's ring on a public page; in the workspace a grey one, for the keyboard only (no orange edges).
  const ring = inWorkspace ? 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8a94a3]' : 'u-focus-ring';
  return (
    <div role="region" aria-label="Forma's main address" className={`landing pointer-events-none fixed inset-x-0 z-[55] flex justify-center px-4 ${inWorkspace ? 'top-3' : 'bottom-6'}`}>
      <p className="pointer-events-auto m-0 flex max-w-[560px] items-start gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card px-4 py-3 font-body-lg text-[13.5px] leading-[1.55] text-on-surface-variant shadow-[var(--shadow-lg)]">
        <span>
          Forma&apos;s main address is{' '}
          {/* The same page there; a new tab from the workspace, so the work open here is not left mid-task. */}
          <a
            href={`${SITE_ORIGIN}${path}`}
            target={inWorkspace ? '_blank' : undefined}
            rel={inWorkspace ? 'noopener noreferrer' : undefined}
            className={`rounded font-semibold text-secondary underline underline-offset-2 ${ring}`}
          >
            {new URL(SITE_ORIGIN).host}
          </a>
          . Projects kept in this browser while you&apos;re signed out stay on this address; signed-in projects follow your account.
        </span>
        <button type="button" onClick={close} className={`shrink-0 cursor-pointer rounded-full px-2 font-semibold text-secondary hover:underline ${ring}`}>
          Dismiss
        </button>
      </p>
    </div>
  );
}
