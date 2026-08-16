import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROUTES } from './router';
import { ROUTE_TITLES, titleForRoute, viewForRoute, routesWithoutABranch } from './routes';

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

  it('falls back to the home title for anything unrecognised', () => {
    expect(titleForRoute('/nope')).toBe(ROUTE_TITLES['/']);
    expect(titleForRoute('/docs')).toBe('Docs — Forma');
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
    for (const path of ['/features', '/docs', '/contact', '/terms', '/privacy']) {
      expect(viewForRoute(path)).toEqual({
        showWorkspace: false,
        showLogin: false,
        loginMode: null,
        lastViewPath: path,
      });
    }
  });

  it('falls back to the home page for an unknown path', () => {
    expect(viewForRoute('/nope')).toEqual({
      showWorkspace: false,
      showLogin: false,
      loginMode: null,
      lastViewPath: '/',
    });
  });

  /* `/` has no case of its own and is served by `default`. That is intentional,
     and this pins it so the fallback cannot be changed without noticing. */
  it('serves the home page through the same fallback', () => {
    expect(viewForRoute('/')).toEqual(viewForRoute('/nope'));
  });
});
