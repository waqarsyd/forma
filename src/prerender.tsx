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
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import LandingPage from './components/LandingPage';
import FeaturesPage from './components/FeaturesPage';
import DocsPage from './components/DocsPage';
import ContactPage from './components/ContactPage';
import ChangelogPage from './components/ChangelogPage';
import LegalPage from './components/LegalPage';
import InfoRoutePage from './components/InfoRoutePage';
import { HOME_ROUTES, INFO_ROUTES } from './components/publicPages';
import { PrerenderContext } from './components/landing/sections';
import type { InfoRoute } from './components/infoPages';

const noop = () => {};
const common = { onEnterWorkspace: noop, onSignIn: noop, onSignUp: noop, user: null, logOut: noop, isDarkMode: false, setIsDarkMode: noop };

/** The routes drawn here; the app's own routes (the workspace, sign-in) are not pages to read. */
export const PRERENDERED = ['/', '/features', '/docs', '/contact', '/changelog', '/terms', '/privacy', '/accessibility', '/security', '/pricing', '/examples', '/compare', '/about', '/self-host', '/download', '/faq'] as const;

/** One page's markup, for the build to put inside `<div id="root">`. */
export function renderRoute(route: (typeof PRERENDERED)[number]): string {
  const page =
    route === '/features' ? <FeaturesPage {...common} />
      : route === '/docs' ? <DocsPage {...common} />
        : route === '/contact' ? <ContactPage {...common} />
          : route === '/changelog' ? <ChangelogPage {...common} />
            : route === '/terms' ? <LegalPage doc="terms" {...common} />
              : route === '/privacy' ? <LegalPage doc="privacy" {...common} />
                : route === '/accessibility' ? <LegalPage doc="accessibility" {...common} />
                  : (INFO_ROUTES as readonly string[]).includes(route) ? <InfoRoutePage route={route as InfoRoute} {...common} />
                    : <LandingPage {...common} />;
  // Every Reveal drawn at its final state (2026-11-11, full audit PR-01): the
  // page here is read before any script runs, so nothing may wait for one.
  // The figures' own motion elements too: under `AnimatePresence
  // initial={false}` a motion element is drawn as its `animate` names, and
  // one that only reveals on scroll (`whileInView`) as its plain style.
  return renderToString(
    <PrerenderContext.Provider value>
      <LazyMotion features={domAnimation} strict>
        <MotionConfig reducedMotion="user">
          <AnimatePresence initial={false}>{page}</AnimatePresence>
        </MotionConfig>
      </LazyMotion>
    </PrerenderContext.Provider>,
  );
}

/**
 * The module a route's page comes from in the app, by its path from the
 * project root (2026-11-11, full audit PR-02). The build finds the chunk Rollup
 * made of it and names that chunk in the route's head as a modulepreload, so
 * the browser fetches it alongside the entry rather than after it has run,
 * and `main.tsx`, which waits for it before drawing, waits for nothing. The
 * home page too since 2026-11-12, when it left the entry chunk: for `/` and
 * for the sign-in card's two routes, which draw it behind the card
 * (`HOME_ROUTES`, components/publicPages.tsx).
 */
export function pageModuleOf(route: string): string | null {
  if (HOME_ROUTES.includes(route)) return 'src/components/LandingPage.tsx';
  switch (route) {
    case '/features':
      return 'src/components/FeaturesPage.tsx';
    case '/docs':
      return 'src/components/DocsPage.tsx';
    case '/contact':
      return 'src/components/ContactPage.tsx';
    case '/changelog':
      return 'src/components/ChangelogPage.tsx';
    case '/terms':
    case '/privacy':
    case '/accessibility':
      return 'src/components/LegalPage.tsx';
  }
  return (INFO_ROUTES as readonly string[]).includes(route) ? 'src/components/InfoRoutePage.tsx' : null;
}

/**
 * The two faces the first paint of a public page sets text in (2026-11-11,
 * full audit PR-21), as their files are named in src/fonts: Inter for the body
 * and Hanken Grotesk for the headings. The stylesheet names them, so the
 * browser found them only once it had fetched and parsed the CSS; preloaded,
 * they are fetched beside it. JetBrains Mono is set small and late, and the
 * latin-ext files load only for a page that needs them, so neither is here.
 */
export const PRELOADED_FONTS = ['inter-latin.woff2', 'hanken-grotesk-latin.woff2'] as const;

/**
 * `html` with a preload for each of `modules` (script chunks) and `fonts`
 * (woff2 files) before its `</head>`. `crossorigin` on both, as Vite writes it
 * on the entry: a module and a font are fetched in CORS mode, and a preload
 * made in another mode is not reused, so the file would be fetched twice.
 */
export function withPreloads(html: string, { modules = [], fonts = [] }: { modules?: readonly string[]; fonts?: readonly string[] }): string {
  const links = [
    ...fonts.map((href) => `<link rel="preload" as="font" type="font/woff2" crossorigin href="${href}">`),
    ...modules.map((href) => `<link rel="modulepreload" crossorigin href="${href}">`),
  ];
  if (!links.length) return html;
  const at = html.indexOf('</head>');
  if (at < 0) return html;
  return `${html.slice(0, at)}${links.map((l) => `  ${l}\n`).join('')}${html.slice(at)}`;
}
