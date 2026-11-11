import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import LandingPage from './components/LandingPage';
import { publicPageFor } from './components/publicPages';
import { useTheme } from './components/useTheme';
import { useLinkNavigation } from './components/useLinkNavigation';
import { currentPath, migrateLegacyHashUrl, navigate, onRouteChange, scrollToHash } from './lib/router';
import { sharedReportId, viewForRoute } from './lib/routes';
import { applyHead, headFor } from './lib/seo';
import { loadAuth, type AuthClient } from './lib/firebaseClient';
import { forgetSession } from './lib/signOut';

const NotFoundPage = lazy(() => import('./components/NotFoundPage'));
const SharedReportPage = lazy(() => import('./components/SharedReportPage'));
const LoginPage = lazy(() => import('./components/LoginPage'));

/**
 * The public site without the workspace (2026-11-08, the site audit's batch
 * SG, item 42). Every visitor to the home page downloaded the whole workspace
 * first — App.tsx and everything it imports, the entry chunk at 567 kB —
 * before a word of the page they came for. This draws every public page,
 * the sign-in dialog and a shared report's page with what they need and
 * nothing else; `main.tsx` loads App only when the route is /workspace, and
 * App then keeps the tab, drawing the public pages itself as it always did.
 *
 * What it shares with App rather than copies: the theme (`useTheme`), the
 * in-page links (`useLinkNavigation`), the route's head (`applyHead`), the
 * route's view (`viewForRoute`) and what a sign-out clears (`forgetSession`).
 * What App does on these pages and this does not: nothing a public page can
 * show, since the workspace's state does not exist until App does.
 */
export default function PublicSite() {
  const [route, setRoute] = useState(currentPath());
  const [showLogin, setShowLogin] = useState(false);
  const [loginMode, setLoginMode] = useState<'signin' | 'signup'>('signin');
  const [lastViewPath, setLastViewPath] = useState('/');
  const [user, setUser] = useState<User | null>(null);
  const { isDarkMode, setTheme } = useTheme();
  useLinkNavigation();

  // Route -> view, as App's route effect does, from the same lib/routes.ts.
  useEffect(() => {
    migrateLegacyHashUrl();
    const applyRoute = () => {
      const path = currentPath();
      setRoute(path);
      applyHead(document, headFor(path));
      const view = viewForRoute(path);
      setShowLogin(view.showLogin);
      if (view.loginMode !== null) setLoginMode(view.loginMode);
      if (view.lastViewPath !== null) setLastViewPath(view.lastViewPath);
    };
    const onHashChange = () => {
      migrateLegacyHashUrl();
      applyRoute();
    };
    window.addEventListener('hashchange', onHashChange);
    const unsubscribe = onRouteChange(applyRoute);
    applyRoute();
    if (window.location.hash) scrollToHash(window.location.hash);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      unsubscribe();
    };
  }, []);

  // Who is signed in, for the header. Auth alone, never the database.
  const [auth, setAuth] = useState<AuthClient | null>(null);
  useEffect(() => {
    let alive = true;
    loadAuth().then(
      (client) => alive && setAuth(client),
      (err) => console.warn('Firebase could not be loaded; staying local-only.', err),
    );
    return () => {
      alive = false;
    };
  }, []);
  const previousUid = useRef<string | null>(null);
  useEffect(() => {
    if (!auth) return;
    return auth.service.auth.onAuthStateChanged((u) => {
      const wasSignedIn = previousUid.current !== null;
      previousUid.current = u?.uid ?? null;
      setUser(u);
      // Signed out in another tab: this tab's session goes with the account.
      if (!u && wasSignedIn) forgetSession();
    });
  }, [auth]);

  const logOut = useCallback(async () => {
    try {
      await (await loadAuth()).service.logOut();
    } catch (err) {
      console.error(err);
    }
    setUser(null);
    forgetSession();
  }, []);

  // The other pages' chunks, fetched while the visitor reads this one.
  useEffect(() => {
    const warm = () => {
      void import('./components/FeaturesPage').catch(() => {});
      void import('./components/DocsPage').catch(() => {});
      void import('./components/ContactPage').catch(() => {});
      void import('./components/LegalPage').catch(() => {});
      void import('./components/ChangelogPage').catch(() => {});
    };
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (ric) {
      const id = ric(warm);
      return () => (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(id);
  }, []);

  const common = {
    onEnterWorkspace: () => navigate('/workspace'),
    onSignIn: () => navigate('/login'),
    onSignUp: () => navigate('/signup'),
    user,
    logOut,
    isDarkMode,
    setIsDarkMode: setTheme,
  };
  const closeLogin = () => {
    navigate(lastViewPath || '/');
    setShowLogin(false);
  };

  // What the sign-in card hands on as it closes (2026-11-11, full audit PS-17):
  // after an email sign-up, that a verification link was sent, which sharing
  // needs. Said in a live region that is always in the page, so a screen
  // reader announces it when it fills, and kept until it is dismissed.
  const [afterSignIn, setAfterSignIn] = useState<string | null>(null);

  const view = viewForRoute(route);
  const shared = sharedReportId(route);

  return (
    <>
      {/* `inert` while the sign-in dialog is open, as in App: the page stays
          mounted behind it, so closing returns to the same scroll. */}
      <div className="h-full w-full" inert={showLogin || undefined}>
        <Suspense fallback={null}>
          {shared ? (
            <SharedReportPage
              id={shared}
              user={user ? { uid: user.uid, email: user.email } : null}
              onSignIn={() => navigate('/login')}
              onHome={() => navigate('/')}
            />
          ) : view.notFound ? (
            <NotFoundPage {...common} />
          ) : (
            // Every other public page, through the switch App shares (components/publicPages.tsx).
            publicPageFor(route, common) ?? <LandingPage {...common} />
          )}
        </Suspense>
      </div>
      {showLogin && (
        <Suspense fallback={null}>
          <LoginPage
            initialMode={loginMode}
            onClose={closeLogin}
            onSuccess={(notice) => {
              setShowLogin(false);
              setAfterSignIn(notice ?? null);
              navigate(lastViewPath || '/');
            }}
            isDarkMode={isDarkMode}
            setIsDarkMode={setTheme}
          />
        </Suspense>
      )}
      <div role="status" aria-live="polite" className="landing pointer-events-none fixed inset-x-0 bottom-6 z-[90] flex justify-center px-4">
        {afterSignIn && (
          <div className="pointer-events-auto flex max-w-[520px] items-start gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card px-4 py-3.5 font-body-lg text-[13.5px] leading-[1.55] text-on-surface-variant shadow-[var(--shadow-lg)]">
            <span>{afterSignIn}</span>
            <button
              type="button"
              onClick={() => setAfterSignIn(null)}
              className="u-focus-ring shrink-0 cursor-pointer rounded-full px-2 font-semibold text-secondary hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </>
  );
}
