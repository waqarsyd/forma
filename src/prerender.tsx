/**
 * The marketing pages as HTML, written into the built pages at build time
 * (2026-11-08, site audit item 54), so a crawler or a link preview that runs
 * no script reads the page rather than an empty `<div id="root">`. Loaded by
 * `vite.config.ts` through Vite's SSR loader in `closeBundle`; nothing in the
 * app imports it, and the app does not hydrate what it writes: `createRoot`
 * replaces it with the same page once the bundle runs.
 *
 * Each page is drawn signed out, in the light theme, with nothing to click
 * through to: a page here is words and links, not state.
 */
import { renderToString } from 'react-dom/server';
import { MotionConfig } from 'motion/react';
import LandingPage from './components/LandingPage';
import FeaturesPage from './components/FeaturesPage';
import DocsPage from './components/DocsPage';
import ContactPage from './components/ContactPage';
import ChangelogPage from './components/ChangelogPage';
import LegalPage from './components/LegalPage';

const noop = () => {};
const common = { onEnterWorkspace: noop, onSignIn: noop, onSignUp: noop, user: null, logOut: noop, isDarkMode: false, setIsDarkMode: noop };

/** The routes drawn here; the app's own routes (the workspace, sign-in) are not pages to read. */
export const PRERENDERED = ['/', '/features', '/docs', '/contact', '/changelog', '/terms', '/privacy'] as const;

/** One page's markup, for the build to put inside `<div id="root">`. */
export function renderRoute(route: (typeof PRERENDERED)[number]): string {
  const page =
    route === '/features' ? <FeaturesPage {...common} />
      : route === '/docs' ? <DocsPage {...common} />
        : route === '/contact' ? <ContactPage {...common} />
          : route === '/changelog' ? <ChangelogPage {...common} />
            : route === '/terms' ? <LegalPage doc="terms" {...common} />
              : route === '/privacy' ? <LegalPage doc="privacy" {...common} />
                : <LandingPage {...common} />;
  return renderToString(<MotionConfig reducedMotion="user">{page}</MotionConfig>);
}
