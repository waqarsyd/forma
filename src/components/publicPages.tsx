import { lazy, useState, type ComponentType, type ReactElement } from 'react';
import type { PageProps } from './InfoPage';
import type { InfoRoute } from './infoPages';

/**
 * Which page a public route draws (2026-11-08, the site audit's batch SJ).
 * App and PublicSite each had the same chain of routes to pages, and every new
 * page was a change to both; seven arrived at once with this batch. The home
 * page, the 404 and a shared report stay with each caller, which draws them
 * with what it alone has. Each page is lazy, so a visitor downloads the one
 * they open.
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

const FeaturesPage = Features.Page;
const DocsPage = Docs.Page;
const ContactPage = Contact.Page;
const LegalPage = Legal.Page;
const ChangelogPage = Changelog.Page;
const InfoRoutePage = Info.Page;

/** The pages SJ added, drawn by InfoRoutePage from infoPages.tsx; the same list as INFO_DOCS's keys, which a test holds. */
export const INFO_ROUTES: readonly InfoRoute[] = ['/security', '/pricing', '/examples', '/compare', '/about', '/self-host', '/download', '/faq'];

/** The chunk a route's page comes in, fetched; null for a route this file does not draw. */
export function preloadPublicRoute(route: string): Promise<unknown> | null {
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
