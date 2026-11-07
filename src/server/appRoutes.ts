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

/** Whether the app answers this path: a route, or a shared report. */
export function isAppPath(path: string): boolean {
  return (ROUTES as readonly string[]).includes(path) || sharedReportId(path) !== null;
}

/**
 * firebase.json's rewrites: each route, and one segment under /s/, to the
 * app. Firebase serves a file that exists before any rewrite, and dist/404.html
 * for whatever is neither.
 */
export function hostingRewrites(): { source: string; destination: string }[] {
  return [...ROUTES.map((source) => ({ source, destination: '/index.html' })), { source: '/s/*', destination: '/index.html' }];
}
