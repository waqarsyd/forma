/**
 * Which paths are the app's (2026-11-07, site audit items 1 and 52): a route
 * or a shared report gets the app, and anything else, a stale chunk included,
 * is a 404 rather than the home page with a 200.
 */
import { describe, expect, it } from 'vitest';
import { ROUTES } from '../lib/router';
import { hostingRewrites, isAppPath, isNoindexPath } from './appRoutes';

describe('isAppPath', () => {
  it('takes every route and a shared report', () => {
    for (const route of ROUTES) expect(isAppPath(route), route).toBe(true);
    expect(isAppPath('/s/AbCdEfGhIjKlMnOp1234')).toBe(true);
  });

  it('refuses an unknown page, a stale chunk, a file and a malformed share', () => {
    for (const path of ['/pricing-old', '/assets/index-OLDHASH1.js', '/favicon.ico', '/s/short', '/s/AbCdEfGhIjKlMnOp1234/more', '/docs/']) {
      expect(isAppPath(path), path).toBe(false);
    }
  });
});

describe('hostingRewrites', () => {
  it("rewrites each route to its own page and one segment under /s/ to the share page, and nothing else", () => {
    const rewrites = hostingRewrites();
    expect(rewrites.map((r) => r.source)).toEqual([...ROUTES, '/s/*']);
    expect(rewrites.find((r) => r.source === '/')?.destination).toBe('/index.html');
    expect(rewrites.find((r) => r.source === '/features')?.destination).toBe('/features.html');
    expect(rewrites.at(-1)?.destination).toBe('/share.html');
    expect(rewrites.some((r) => r.source.includes('**'))).toBe(false);
  });
});

describe('isNoindexPath', () => {
  it('keeps a shared report out of search results, and nothing else by header', () => {
    expect(isNoindexPath('/s/AbCdEfGhIjKlMnOp1234')).toBe(true);
    expect(isNoindexPath('/workspace')).toBe(false);
    expect(isNoindexPath('/')).toBe(false);
  });
});
