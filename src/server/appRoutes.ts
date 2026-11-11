/**
 * Which paths are the app's (2026-11-07, site audit items 1 and 52), for both
 * ways Forma is served: firebase.json's rewrites, which `hostingConfig.test.ts`
 * derives from `hostingRewrites`, and `npm start`'s fallback in server.ts,
 * which asks `isAppPath`.
 *
 * Until then both answered every path with the app and a 200. An unknown
 * address was a "soft 404" a search engine indexes as a copy of the home page,
 * and a chunk from the deploy before, asked for by a tab still open, came back
 * as HTML with a 200, cached for a year as immutable: the tab broke on its
 * next lazy load, and stayed broken. Now only the routes the router knows,
 * and a shared report's /s/{id}, are the app; anything else is a 404, which
 * Firebase answers with dist/404.html (written by vite.config.ts) and the app
 * draws as Not found. A stale chunk is a 404 too, which the page notices and
 * reloads for once (src/lib/staleChunks.ts).
 */
import { ROUTES } from '../lib/router';
import { sharedReportId } from '../lib/routes';
import { pageFile } from '../lib/seo';

/** Whether the app answers this path: a route, or a shared report. */
export function isAppPath(path: string): boolean {
  return (ROUTES as readonly string[]).includes(path) || sharedReportId(path) !== null;
}

/**
 * firebase.json's rewrites: each route to the page the build wrote for it
 * (`pageFile`, since 2026-11-08: `features.html` for /features, each with its
 * own head and, for a marketing page, its words), and one segment under /s/
 * to `share.html`. Firebase serves a file that exists before any rewrite, and
 * dist/404.html for whatever is neither.
 */
export function hostingRewrites(): { source: string; destination: string }[] {
  return [
    ...ROUTES.map((source) => ({ source, destination: `/${pageFile(source)}` })),
    { source: '/s/*', destination: `/${pageFile('/s/xxxxxxxxxxxxxxxx')}` },
    SECURITY_TXT,
  ];
}

/**
 * Where RFC 9116 says a security contact lives, and the file that answers it
 * (2026-11-08, site audit item 110). The file is `security.txt` at the root
 * (written by the build from src/lib/seo.ts since 2026-11-11, and
 * public/security.txt before that) rather than under `.well-known/` because Firebase Hosting's
 * `ignore` drops every dot-path from a deploy (`**\/.*`), and `npm start`'s
 * express.static ignores dotfiles too: so Hosting rewrites the address to the
 * file and server.ts does the same.
 */
export const SECURITY_TXT = { source: '/.well-known/security.txt', destination: '/security.txt' } as const;

/**
 * Headers by path that keep a page out of search results (2026-11-08, site
 * audit item 38): a shared report is the author's to pass on, not the web's
 * to index. Its page says noindex too; the header holds for any client that
 * reads headers and not the page. firebase.json derives its rule from this,
 * and server.ts sends the same.
 */
export const NOINDEX_HEADER = { key: 'X-Robots-Tag', value: 'noindex' } as const;
export const NOINDEX_SOURCES = ['/s/**'] as const;

/** Whether `npm start` sends NOINDEX_HEADER for a path. */
export function isNoindexPath(path: string): boolean {
  return path.startsWith('/s/');
}
