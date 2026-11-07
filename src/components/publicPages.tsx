import { lazy, type ReactElement } from 'react';
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
const FeaturesPage = lazy(() => import('./FeaturesPage'));
const DocsPage = lazy(() => import('./DocsPage'));
const ContactPage = lazy(() => import('./ContactPage'));
const LegalPage = lazy(() => import('./LegalPage'));
const ChangelogPage = lazy(() => import('./ChangelogPage'));
const InfoRoutePage = lazy(() => import('./InfoRoutePage'));

/** The pages SJ added, drawn by InfoRoutePage from infoPages.tsx; the same list as INFO_DOCS's keys, which a test holds. */
export const INFO_ROUTES: readonly InfoRoute[] = ['/security', '/pricing', '/examples', '/compare', '/about', '/self-host', '/faq'];

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
