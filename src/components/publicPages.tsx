import { lazy, useState, type ComponentType, type ReactElement } from 'react';
import type { PageProps } from './InfoPage';
import type { InfoRoute } from './infoPages';

/**
 * Which page a public route draws (2026-11-08, the site audit's batch SJ).
 * App and PublicSite each had the same chain of routes to pages, and every new
 * page was a change to both; seven arrived at once with this batch. The home
 * page (`HomePage`, lazy here since 2026-11-12), the 404 and a shared report
 * stay with each caller, which draws them with what it alone has. Each page is
 * lazy, so a visitor downloads the one they open.
 */

/**
 * A lazy page that can be fetched ahead of its first draw (2026-11-11, full
 * audit PR-02). The built page already shows the page's words, and the app
 * draws over them; with a plain `lazy` the first draw found the chunk not yet
 * there and put up the Suspense fallback, which is nothing, so /docs, /faq and
 * the rest went white for the length of a fetch and came back. Now `main.tsx`
 * awaits `preloadPublicRoute` before its first draw, and a page whose chunk
 * has arrived is drawn as itself, without passing through `lazy` at all,
 * which would suspend once even on a finished promise.
 *
 * Which of the two a page is drawn as is decided once per mount, so a page
 * that mounted lazily is not remounted, and its state lost, when the chunk
 * lands and the next draw could use it directly.
 */
function preloadable<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  let ready: ComponentType<P> | null = null;
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const preload = () =>
    (pending ??= load().then(
      (module) => {
        ready = module.default;
        return module;
      },
      (err: unknown) => {
        pending = null;
        throw err;
      },
    ));
  const Lazy = lazy(preload) as unknown as ComponentType<P>;
  function Page(props: P) {
    const [Drawn] = useState<ComponentType<P>>(() => ready ?? Lazy);
    return <Drawn {...props} />;
  }
  return { Page, preload };
}

const Features = preloadable(() => import('./FeaturesPage'));
const Docs = preloadable(() => import('./DocsPage'));
const Contact = preloadable(() => import('./ContactPage'));
const Legal = preloadable(() => import('./LegalPage'));
const Changelog = preloadable(() => import('./ChangelogPage'));
const Info = preloadable(() => import('./InfoRoutePage'));
/*
 * The home page, lazy like the rest since 2026-11-12 (owner decision 18 of the
 * 2026-11-11 audit). It had stayed in the entry chunk on 2026-09-05's reasoning,
 * that deferring it put a second round trip before the home page's first paint.
 * The built pages (2026-11-08) and the preloads (2026-11-11, PR-02) answered that:
 * the first paint is the built page, and its head names this chunk as a
 * modulepreload, fetched beside the entry. The entry chunk fell 388,437 ->
 * 298,570 B (-89,867): the page and what only it pulled into the entry (the
 * header, footer, icons and menus, now shared chunks each page's head
 * preloads), which every visitor to /docs or /workspace downloaded first. That
 * is what made room in the entry for React 19.3 and motion 12.43.
 */
const Landing = preloadable(() => import('./LandingPage'));

const FeaturesPage = Features.Page;
const DocsPage = Docs.Page;
const ContactPage = Contact.Page;
const LegalPage = Legal.Page;
const ChangelogPage = Changelog.Page;
const InfoRoutePage = Info.Page;
/** The home page, which each caller draws itself where `publicPageFor` answers null. */
export const HomePage = Landing.Page;

/**
 * The routes drawn on the home page: `/`, and the sign-in card's two, which
 * open over it. The build preloads its chunk for each (prerender.tsx,
 * `pageModuleOf`), and `main.tsx` waits for it before the first draw.
 */
export const HOME_ROUTES: readonly string[] = ['/', '/login', '/signup'];

/** The pages SJ added, drawn by InfoRoutePage from infoPages.tsx; the same list as INFO_DOCS's keys, which a test holds. */
export const INFO_ROUTES: readonly InfoRoute[] = ['/security', '/pricing', '/examples', '/compare', '/about', '/self-host', '/download', '/faq'];

/** The chunk a route's page comes in, fetched; null for a route this file does not draw. */
export function preloadPublicRoute(route: string): Promise<unknown> | null {
  if (HOME_ROUTES.includes(route)) return Landing.preload();
  switch (route) {
    case '/features':
      return Features.preload();
    case '/docs':
      return Docs.preload();
    case '/contact':
      return Contact.preload();
    case '/changelog':
      return Changelog.preload();
    case '/terms':
    case '/privacy':
    case '/accessibility':
      return Legal.preload();
  }
  return (INFO_ROUTES as readonly string[]).includes(route) ? Info.preload() : null;
}

export function publicPageFor(route: string, page: PageProps): ReactElement | null {
  switch (route) {
    case '/features':
      return <FeaturesPage {...page} />;
    case '/docs':
      return <DocsPage {...page} />;
    case '/contact':
      return <ContactPage {...page} />;
    case '/changelog':
      return <ChangelogPage {...page} />;
    case '/terms':
      return <LegalPage doc="terms" {...page} />;
    case '/privacy':
      return <LegalPage doc="privacy" {...page} />;
    case '/accessibility':
      return <LegalPage doc="accessibility" {...page} />;
  }
  return (INFO_ROUTES as readonly string[]).includes(route) ? <InfoRoutePage route={route as InfoRoute} {...page} /> : null;
}
