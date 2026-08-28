// @vitest-environment jsdom
// Real history/location, which is the whole point of this file. Must stay
// line 1; see vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ROUTES, currentPath, navigate, onRouteChange, migrateLegacyHashUrl } from './router';

/**
 * Routing has no test-visible output — it moves the address bar and fires an
 * event, and every failure here looks like a page that simply rendered
 * something else. The two that matter are silent by construction: a route
 * missing from `ROUTES` sends an old link to the home page rather than erroring
 * (which is how `/terms` and `/privacy` sat outside the list unnoticed), and a
 * `pushState` where `replaceState` was meant leaves a history entry the back
 * button has to step through, which nobody notices until they press it twice.
 */

/** jsdom starts at `http://localhost:3000/`; each case sets its own URL. */
function setUrl(url: string): void {
  window.history.replaceState({}, '', url);
}

beforeEach(() => {
  setUrl('/');
});

describe('ROUTES', () => {
  /* The regression this file exists for. Both shipped answered by App.tsx's
     route effect while `ROUTES` still stopped at `/workspace`. */
  it('carries the legal pages, which were absent from it for a day', () => {
    expect(ROUTES).toContain('/terms');
    expect(ROUTES).toContain('/privacy');
  });

  it('is absolute paths only, with no duplicates', () => {
    expect(ROUTES.every((r) => r.startsWith('/'))).toBe(true);
    expect(new Set(ROUTES).size).toBe(ROUTES.length);
  });
});

describe('currentPath', () => {
  it('reads the pathname', () => {
    setUrl('/features');
    expect(currentPath()).toBe('/features');
  });

  /* A trailing slash must not become a second route: `/docs/` and `/docs` are
     the same page, and the route effect matches on an exact string. */
  it('normalises a trailing slash away', () => {
    setUrl('/docs/');
    expect(currentPath()).toBe('/docs');
  });

  it('leaves the root alone, which is the one path that is a slash', () => {
    setUrl('/');
    expect(currentPath()).toBe('/');
  });
});

describe('navigate', () => {
  it('moves the URL and tells the app, since pushState fires no event', () => {
    const handler = vi.fn();
    const stop = onRouteChange(handler);

    navigate('/contact');

    expect(currentPath()).toBe('/contact');
    expect(handler).toHaveBeenCalledTimes(1);
    stop();
  });

  it('accepts a path without its leading slash', () => {
    navigate('docs');
    expect(currentPath()).toBe('/docs');
  });

  /* The login modal's cancel path replaces rather than pushes, so dismissing it
     does not leave an entry the back button walks into. */
  it('replaces instead of pushing when asked', () => {
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');

    navigate('/login', { replace: true });

    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(currentPath()).toBe('/login');

    push.mockRestore();
    replace.mockRestore();
  });
});

describe('onRouteChange', () => {
  it('hears the back button as well as a programmatic navigate', () => {
    const handler = vi.fn();
    const stop = onRouteChange(handler);

    window.dispatchEvent(new Event('popstate'));
    expect(handler).toHaveBeenCalledTimes(1);

    navigate('/features');
    expect(handler).toHaveBeenCalledTimes(2);

    stop();
  });

  it('unsubscribes from both, not just one', () => {
    const handler = vi.fn();
    onRouteChange(handler)();

    window.dispatchEvent(new Event('popstate'));
    navigate('/docs');

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('migrateLegacyHashUrl', () => {
  let push: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    push = vi.spyOn(window.history, 'pushState');
  });

  afterEach(() => {
    push.mockRestore();
  });

  it('rewrites a known fragment to its path', () => {
    setUrl('/#features');
    migrateLegacyHashUrl();
    expect(currentPath()).toBe('/features');
    expect(window.location.hash).toBe('');
  });

  /* Fails before `/terms` joined ROUTES: the fragment was unknown, so this
     landed on the home page instead. */
  it('rewrites the fragments that were missing from ROUTES', () => {
    setUrl('/#terms');
    migrateLegacyHashUrl();
    expect(currentPath()).toBe('/terms');

    setUrl('/#privacy');
    migrateLegacyHashUrl();
    expect(currentPath()).toBe('/privacy');
  });

  it('drops a fragment that is not a route rather than 404ing on it', () => {
    setUrl('/#nonsense');
    migrateLegacyHashUrl();
    expect(currentPath()).toBe('/');
    expect(window.location.hash).toBe('');
  });

  it('keeps the query string on both paths', () => {
    setUrl('/?ref=x#features');
    migrateLegacyHashUrl();
    expect(currentPath()).toBe('/features');
    expect(window.location.search).toBe('?ref=x');

    setUrl('/?ref=x#nonsense');
    migrateLegacyHashUrl();
    expect(window.location.search).toBe('?ref=x');
  });

  /* A URL ending in a bare `#` reports `location.hash === ''`, which is why the
     source reads that case off `href` instead of folding it into the check
     above. The first assertion is the precondition: if the environment
     normalises the `#` away on its own, this test proves nothing. */
  it('strips a bare trailing hash', () => {
    setUrl('/docs#');
    expect(window.location.href.endsWith('#')).toBe(true);

    migrateLegacyHashUrl();

    expect(window.location.href.endsWith('#')).toBe(false);
    expect(currentPath()).toBe('/docs');
  });

  it('leaves a clean URL untouched', () => {
    setUrl('/docs');
    migrateLegacyHashUrl();
    expect(currentPath()).toBe('/docs');
  });

  /* Migration must not cost a history entry — the back button should reach
     wherever the visitor came from, not the pre-migration URL. */
  it('never pushes a history entry', () => {
    setUrl('/#features');
    migrateLegacyHashUrl();
    expect(push).not.toHaveBeenCalled();
  });
});
