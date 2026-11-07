import {StrictMode, Component, ErrorInfo, ReactNode, lazy, Suspense, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MotionConfig} from 'motion/react';
import PublicSite from './PublicSite';
import OfflineBanner from './components/OfflineBanner';
import './index.css';
import {isStaleChunkError, reloadForStaleChunk, watchForStaleChunks} from './lib/staleChunks';
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

class ErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // A lazy component whose chunk a deploy removed: reload once for the new
    // build rather than show this page (site audit item 1).
    if (isStaleChunkError(error) && reloadForStaleChunk()) return;
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6">
          <div className="bg-card border border-border rounded-xl shadow-lg p-8 max-w-xl w-full text-center">
            <h1 className="text-2xl font-bold text-error mb-4">Something went wrong.</h1>
            <p className="text-muted-foreground mb-6">An unexpected error occurred in the application view.</p>
            <div className="bg-muted p-4 rounded-lg text-left overflow-auto text-xs font-mono max-h-40">
               {this.state.error?.message || "Unknown error"}
            </div>
            <button 
              onClick={() => window.location.reload()} 
              className="mt-6 px-6 py-2 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// reducedMotion="user" makes every Framer animation in the app honour the OS
// preference: transform and layout animations are dropped, opacity is kept, so
// content still arrives without sliding. The CSS media query in index.css only
// reaches CSS transitions — Framer drives inline styles and needs this. It also
// covers ContactPage and DocsPage, which never called useReducedMotion at all.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <ErrorBoundary>
        <Root />
      </ErrorBoundary>
      <OfflineBanner />
    </MotionConfig>
  </StrictMode>,
);
