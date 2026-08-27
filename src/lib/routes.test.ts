import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROUTES } from './router';
import { ROUTE_TITLES, NOT_FOUND_TITLE, titleForRoute, viewForRoute, routesWithoutABranch } from './routes';

/**
 * A route needs three edits: `ROUTES`, a branch in the view mapping, and a
 * title. Only the first has ever failed loudly. A missing branch renders the
 * home page under the new route's URL, and a missing title shows the home
 * page's in the tab — both look like a page that works.
 */

describe('ROUTE_TITLES', () => {
  it('covers every route, so none silently falls back to the home title', () => {
    const missing = ROUTES.filter((route) => !(route in ROUTE_TITLES));
    expect(missing).toEqual([]);
  });

  it('has no title for a path that is not a route', () => {
    const orphans = Object.keys(ROUTE_TITLES).filter(
      (path) => !(ROUTES as readonly string[]).includes(path),
    );
    expect(orphans).toEqual([]);
  });

  /* The documented "change one, change both" rule, previously enforced by
     nothing. `index.html` is what scrapers read and what paints before the
     bundle loads; a difference rewrites the title just after first paint. */
  it('keeps `/` byte-identical to the <title> in index.html', () => {
    // Read from the project root rather than relative to this module: Vite
    // rewrites `import.meta.url` to an http:// URL during transform, which
    // `readFileSync` refuses. Vitest runs with the repo root as cwd.
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];

    expect(title).toBeDefined();
    expect(ROUTE_TITLES['/']).toBe(title);
  });

  /* Tab strips truncate the end, so the page name has to lead. */
  it('leads with the page name and trails the brand', () => {
    for (const [path, title] of Object.entries(ROUTE_TITLES)) {
      if (path === '/') continue;
      expect(title.endsWith(' — Forma')).toBe(true);
      expect(title.startsWith('Forma')).toBe(false);
    }
  });

  /**
   * This used to assert an unrecognised path got the *home* title. That was the
   * bug (audit UX-002): a typo showed a working page with the home page's name
   * in the tab, so a bookmark or a history entry recorded nothing about having
   * gone nowhere.
   */
  it('names an unrecognised path as not found rather than disguising it', () => {
    expect(titleForRoute('/nope')).toBe(NOT_FOUND_TITLE);
    expect(titleForRoute('/nope')).not.toBe(ROUTE_TITLES['/']);
    expect(titleForRoute('/docs')).toBe('Docs — Forma');
  });

  it('gives the not-found title the same shape as every other', () => {
    // Page name leads, brand trails — tab strips truncate the end.
    expect(NOT_FOUND_TITLE.endsWith(' — Forma')).toBe(true);
    expect(NOT_FOUND_TITLE.startsWith('Forma')).toBe(false);
  });
});

describe('viewForRoute', () => {
  /* The silent one: a route in ROUTES with no branch renders as the home page
     under its own URL. This list must stay empty. */
  it('gives every route a branch of its own', () => {
    expect(routesWithoutABranch()).toEqual([]);
  });

  it('opens the workspace and remembers it as somewhere to return to', () => {
    expect(viewForRoute('/workspace')).toEqual({
      showWorkspace: true,
      showLogin: false,
      loginMode: null,
      lastViewPath: '/workspace',
      notFound: false,
    });
  });

  /* Both sign-in routes leave `showWorkspace` alone so the modal renders over
     whatever is behind it. Forcing false here would close the workspace behind
     the modal and drop the user on the marketing page after signing in. */
  it('never closes the workspace behind the sign-in modal', () => {
    expect(viewForRoute('/login').showWorkspace).toBeNull();
    expect(viewForRoute('/signup').showWorkspace).toBeNull();
  });

  /* A sign-in screen is not somewhere to return to. Overwriting the remembered
     path here is what sent someone who signed in from /docs to the wrong page. */
  it('never records a sign-in route as the place to return to', () => {
    expect(viewForRoute('/login').lastViewPath).toBeNull();
    expect(viewForRoute('/signup').lastViewPath).toBeNull();
  });

  it('picks the sign-in mode from the path', () => {
    expect(viewForRoute('/login')).toMatchObject({ showLogin: true, loginMode: 'signin' });
    expect(viewForRoute('/signup')).toMatchObject({ showLogin: true, loginMode: 'signup' });
  });

  it('treats the marketing pages alike and remembers each as itself', () => {
    for (const path of ['/', '/features', '/docs', '/contact', '/terms', '/privacy']) {
      expect(viewForRoute(path)).toEqual({
        showWorkspace: false,
        showLogin: false,
        loginMode: null,
        lastViewPath: path,
        notFound: false,
      });
    }
  });

  /**
   * `/` used to have no case of its own and share the `default` branch with
   * every unknown path, and a test here pinned that as intentional. It was the
   * bug (audit UX-002): sharing meant a typo could not be told apart from the
   * home page, so the app rendered a working page under a URL that does not
   * exist. `/` now has its own case and the default means "nowhere".
   */
  it('marks an unknown path as not a route, rather than as the home page', () => {
    expect(viewForRoute('/nope')).toEqual({
      showWorkspace: false,
      showLogin: false,
      loginMode: null,
      lastViewPath: '/',
      notFound: true,
    });
  });

  it('no longer confuses the home page with nowhere', () => {
    expect(viewForRoute('/').notFound).toBe(false);
    expect(viewForRoute('/nope').notFound).toBe(true);
    expect(viewForRoute('/')).not.toEqual(viewForRoute('/nope'));
  });

  it('sends someone signing in from a dead URL back somewhere that exists', () => {
    // lastViewPath is where they return to after the modal closes. Returning
    // them to the typo would be worse than the 404 they came from.
    expect(viewForRoute('/nope').lastViewPath).toBe('/');
  });

  it('marks no real route as not found', () => {
    for (const route of ROUTES) expect(viewForRoute(route).notFound).toBe(false);
  });
});
