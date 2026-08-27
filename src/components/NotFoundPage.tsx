import { User } from 'firebase/auth';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import SheetRuler from './landing/SheetRuler';

/**
 * Nowhere.
 *
 * There was no such page until 2026-08-27 (audit UX-002): an unknown path fell
 * through to the home page, so a typo, a dead link or a stale bookmark rendered
 * a working site under a URL that does not exist. The address bar kept the
 * mistake, the tab said "Forma — Screenshot to DevExpress .repx", and search
 * engines received a 200 for every non-existent path — a soft 404, which they
 * penalise.
 *
 * The SPA fallback in `server.ts` still returns `index.html` at the HTTP level;
 * that is how a client-routed app has to work. Telling the visitor is the
 * client's job, and this is it.
 *
 * Same chrome as every other marketing page on purpose. Someone who lands here
 * from a broken link should still be able to get where they were going, and a
 * bare error page with no header is a dead end.
 */
export default function NotFoundPage({
  onEnterWorkspace,
  onSignIn,
  onSignUp,
  user,
  logOut,
  isDarkMode,
  setIsDarkMode,
}: {
  onEnterWorkspace: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  user: User | null;
  logOut: () => void;
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
}) {
  return (
    <div className="landing font-body-lg text-[16px] leading-[1.62] bg-surface text-on-surface min-h-screen flex flex-col">
      <SheetRuler />
      <SiteHeader
        active="none"
        onEnterWorkspace={onEnterWorkspace}
        onSignIn={onSignIn}
        onSignUp={onSignUp}
        user={user}
        logOut={logOut}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
      />

      <main className="flex-grow sheet-grid pt-[76px] pb-[104px]">
        <div className="max-w-container-max mx-auto px-margin-desktop">
          <div className="flex items-center gap-3 font-code-sm text-[11px] font-medium leading-[1.62] tracking-[0.15em] uppercase text-[color:var(--ink-faint)]">
            <b className="font-medium text-secondary">x 000 · y 0000</b>
            Error 404
            <span className="h-px flex-1 bg-gradient-to-r from-outline-variant to-transparent" />
          </div>

          <h1 className="mt-[22px] font-display-lg text-display-lg md:text-[56px] font-extrabold leading-[1.04] tracking-[-0.038em] text-on-surface">
            This page does not exist
          </h1>

          <div className="mt-11 max-w-[68ch]">
            <p className="font-body-lg text-[15.5px] leading-[1.65] text-on-surface-variant">
              The address you followed does not match anything here. It may have been mistyped, or
              it may have pointed at a page that has since moved.
            </p>

            {/* Real destinations rather than a bare "go home": someone arriving
                from a dead link usually wanted one specific thing. */}
            <div className="mt-9 flex flex-wrap gap-3">
              <a
                href="/"
                className="u-transition u-press u-focus-ring inline-flex cursor-pointer items-center gap-2 rounded-full bg-secondary px-5 py-2.5 font-body-lg text-[14px] font-semibold text-on-secondary"
              >
                Back to the home page
              </a>
              <a
                href="/docs"
                className="u-transition u-press u-focus-ring inline-flex cursor-pointer items-center gap-2 rounded-full border border-outline-variant bg-surface-container-low px-5 py-2.5 font-body-lg text-[14px] font-semibold text-on-surface hover:border-secondary hover:text-secondary"
              >
                Read the docs
              </a>
              <a
                href="/workspace"
                className="u-transition u-press u-focus-ring inline-flex cursor-pointer items-center gap-2 rounded-full border border-outline-variant bg-surface-container-low px-5 py-2.5 font-body-lg text-[14px] font-semibold text-on-surface hover:border-secondary hover:text-secondary"
              >
                Open the workspace
              </a>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
