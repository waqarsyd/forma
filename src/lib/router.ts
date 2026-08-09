/**
 * Minimal path router.
 *
 * The app used `window.location.hash`, so every page showed a `#` in the address
 * bar — `/#features`, and a bare `/#` on the home page. Hash routing exists for
 * static hosts that cannot serve an SPA fallback; this one can. Vite runs with
 * `appType: "spa"` in development and `server.ts` has an `app.get('*')` fallback
 * in production, so a deep link to `/features` returns index.html and the client
 * takes it from there.
 *
 * No router library: the whole surface is one string of state plus a listener,
 * and pulling in react-router to replace six routes would be a heavier
 * dependency than the problem deserves.
 */

/** Everything the app answers on. `/` is the marketing home page. */
export const ROUTES = ['/', '/features', '/docs', '/contact', '/login', '/signup', '/workspace'] as const;
export type Route = (typeof ROUTES)[number];

/**
 * pushState does not emit an event — only the back/forward buttons fire
 * `popstate`. This is how a programmatic navigate tells the app to re-render.
 */
const ROUTE_CHANGE = 'forma:routechange';

/** Current path, normalised so a trailing slash never creates a second route. */
export function currentPath(): string {
  const p = window.location.pathname || '/';
  return p !== '/' && p.endsWith('/') ? p.slice(0, -1) : p;
}

export function navigate(to: string, options?: { replace?: boolean }): void {
  const next = to.startsWith('/') ? to : `/${to}`;
  if (options?.replace) {
    window.history.replaceState({}, '', next);
  } else {
    window.history.pushState({}, '', next);
  }
  window.dispatchEvent(new Event(ROUTE_CHANGE));
}

/** Subscribe to both programmatic navigation and the browser's back/forward. */
export function onRouteChange(handler: () => void): () => void {
  window.addEventListener('popstate', handler);
  window.addEventListener(ROUTE_CHANGE, handler);
  return () => {
    window.removeEventListener('popstate', handler);
    window.removeEventListener(ROUTE_CHANGE, handler);
  };
}

/**
 * Rewrite an old `#hash` URL to the equivalent path, once, before first paint.
 *
 * Anyone holding a bookmark or a shared link from the hash era would otherwise
 * land on the home page with a stray fragment. `replaceState` is deliberate —
 * this should not add a history entry the back button has to step through.
 * A bare `#` with nothing after it is also stripped, which is what the home page
 * was left showing after `location.hash = ''`.
 */
export function migrateLegacyHashUrl(): void {
  const raw = window.location.hash;
  const search = window.location.search;

  // A URL ending in a bare `#` reports `location.hash === ''`, so this cannot be
  // folded into the check below — it has to be read off `href`. That trailing
  // `#` is what `location.hash = ''` used to leave on the home page.
  if (!raw) {
    if (window.location.href.endsWith('#')) {
      window.history.replaceState({}, '', `${window.location.pathname}${search}`);
    }
    return;
  }

  const name = raw.replace(/^#/, '');

  const target = `/${name}`;
  if ((ROUTES as readonly string[]).includes(target)) {
    window.history.replaceState({}, '', `${target}${search}`);
  } else {
    // An unknown fragment is not a route; drop it rather than 404 on it.
    window.history.replaceState({}, '', `${window.location.pathname}${search}`);
  }
}
