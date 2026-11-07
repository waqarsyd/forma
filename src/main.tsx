import {StrictMode, lazy, Suspense, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MotionConfig} from 'motion/react';
import PublicSite from './PublicSite';
import OfflineBanner from './components/OfflineBanner';
import './index.css';
import {watchForStaleChunks} from './lib/staleChunks';
import ErrorBoundary from './components/ErrorBoundary';
import {currentPath, onRouteChange} from './lib/router';

/*
 * The workspace loads when it is opened, not before (2026-11-08, the site
 * audit's batch SG, item 42). Every visitor used to download App.tsx and all
 * it imports to read the home page; the public pages now draw from
 * PublicSite.tsx, and App arrives on /workspace. Once it has, it keeps the
 * tab and draws the public pages itself, as it always has, so going back and
 * forth costs nothing more.
 */
const App = lazy(() => import('./App.tsx'));
const isWorkspace = () => currentPath() === '/workspace';

function Root() {
  const [workspace, setWorkspace] = useState(isWorkspace);
  useEffect(() => {
    if (workspace) return;
    return onRouteChange(() => {
      if (isWorkspace()) setWorkspace(true);
    });
  }, [workspace]);
  return workspace ? (
    <Suspense
      fallback={
        <div role="status" className="grid min-h-screen place-items-center bg-surface font-body-lg text-[14px] text-on-surface-variant">
          Opening the workspace…
        </div>
      }
    >
      <App />
    </Suspense>
  ) : (
    <PublicSite />
  );
}

// Every content-security violation, in one line (2026-11-08, site audit item
// 93): the enforced policy's blocks and the Trusted Types trial's reports
// (securityHeaders.ts). There is no endpoint to send them to; the console of
// whoever meets one is where they are read.
document.addEventListener('securitypolicyviolation', (e) => {
  console.warn(`[CSP${e.disposition === 'report' ? ', report only' : ''}] ${e.effectiveDirective} refused ${e.blockedURI || 'an inline use'} at ${e.sourceFile || 'the page'}:${e.lineNumber}`);
});

// The offline worker (2026-11-08, site audit item 55): the build's own pages
// and files kept for the next visit and for a lost connection. Production
// only, so development never serves a cached module.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('The offline worker did not register.', err));
  });
}

// A tab open across a deploy reloads once for the new build rather than break
// on its next lazy load (2026-11-07, site audit item 1; lib/staleChunks.ts).
watchForStaleChunks();

// reducedMotion="user" makes every Framer animation in the app honour the OS
// preference: transform and layout animations are dropped, opacity is kept, so
// content still arrives without sliding. The CSS media query in index.css only
// reaches CSS transitions — Framer drives inline styles and needs this. It also
// covers ContactPage and DocsPage, which never called useReducedMotion at all.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      {/* The whole app's last resort; each workspace area has its own (site audit item 64). */}
      <ErrorBoundary area="Forma" layout="page">
        <Root />
      </ErrorBoundary>
      <OfflineBanner />
    </MotionConfig>
  </StrictMode>,
);
