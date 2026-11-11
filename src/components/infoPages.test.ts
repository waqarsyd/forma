/**
 * The pages the site audit found missing (2026-11-08, batch SJ): each route is
 * a page, a title, a description, a prerendered file, a sitemap entry and a
 * hosting rewrite, and a page missing from one of those lists renders as the
 * 404, unindexed or untitled, without an error anywhere.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { INFO_DOCS, EXAMPLE_SHARES } from './infoPages';
import { INFO_ROUTES } from './publicPages';
import { ROUTES } from '../lib/router';
import { INDEXED_ROUTES, ROUTE_DESCRIPTIONS } from '../lib/seo';
import { titleForRoute, viewForRoute } from '../lib/routes';
import { PRERENDERED } from '../prerender';
import { STARTING_POINTS } from '../lib/startingPoints';
import { MAX_SHARES } from '../lib/shares';

describe('the pages SJ added', () => {
  it('are one list, drawn by InfoRoutePage', () => {
    expect([...INFO_ROUTES].sort()).toEqual(Object.keys(INFO_DOCS).sort());
  });

  it.each([...INFO_ROUTES])('%s is a route, titled, described, indexed, prerendered and rewritten', (route) => {
    expect(ROUTES as readonly string[]).toContain(route);
    expect(viewForRoute(route).notFound).toBe(false);
    expect(titleForRoute(route)).toMatch(/ — Forma$/);
    expect(ROUTE_DESCRIPTIONS[route as keyof typeof ROUTE_DESCRIPTIONS]).toBeTruthy();
    expect(INDEXED_ROUTES as readonly string[]).toContain(route);
    expect(PRERENDERED as readonly string[]).toContain(route);
    const hosting = JSON.parse(readFileSync('firebase.json', 'utf8')) as { hosting: { rewrites: { source: string }[] }[] };
    for (const site of hosting.hosting) expect(site.rewrites.map((r) => r.source)).toContain(route);
  });

  it('says what the code does: the share limit, the six starting points, no shares shown until there are some', () => {
    const security = readFileSync('src/components/infoPages.tsx', 'utf8');
    expect(security).toContain('{MAX_SHARES}');
    expect(MAX_SHARES).toBe(100);
    expect(readFileSync('firestore.rules', 'utf8')).toContain('.data.shares <= 100');
    expect(INFO_DOCS['/examples']().sections.filter((s) => s.id).map((s) => s.id)).toEqual(STARTING_POINTS.map((p) => p.id));
    expect(EXAMPLE_SHARES).toEqual([]);
  });

  /*
   * Self-hosting builds what the site serves (2026-11-11, full audit PS-14):
   * without fetch:paddle a build reads pictures with Tesseract alone, and
   * without its own App Check key a fork loads this site's, which reCAPTCHA
   * refuses on any other domain. Both commands are package.json's.
   */
  it('has a self-hoster fetch the picture reader and set their own App Check key', () => {
    const src = readFileSync('src/components/infoPages.tsx', 'utf8');
    const page = src.slice(src.indexOf('export const SELF_HOST'), src.indexOf('export const DOWNLOAD'));
    const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts['fetch:paddle']).toBeTruthy();
    expect(page.match(/npm run fetch:paddle/g)).toHaveLength(2);
    expect(page.indexOf('npm run fetch:paddle\nnpm run build')).toBeGreaterThan(0);
    expect(page).toContain('APP_CHECK_SITE_KEY');
    expect(readFileSync('src/lib/appCheck.ts', 'utf8')).toMatch(/export const APP_CHECK_SITE_KEY = /);
  });

  /*
   * security.txt (item 110). RFC 9116 makes Contact and Expires required, and
   * an expired file is one a scanner ignores. This fails once the date has
   * passed, on purpose: that is the only way anyone hears it is due. Renew by
   * moving Expires on a year.
   */
  it('publishes a security.txt that is valid and current, with the contact SECURITY.md gives', () => {
    const txt = readFileSync('public/security.txt', 'utf8');
    const fields = (name: string) => [...txt.matchAll(new RegExp(`^${name}: (.+)$`, 'gm'))].map((m) => m[1]);
    expect(fields('Contact')).toContain('mailto:waqarsayyed.official@gmail.com');
    expect(readFileSync('SECURITY.md', 'utf8')).toContain('waqarsayyed.official@gmail.com');
    const [expires] = fields('Expires');
    expect(Date.parse(expires)).toBeGreaterThan(Date.now());
    expect(Date.parse(expires) - Date.now()).toBeLessThan(400 * 86_400_000);
    for (const url of fields('Canonical')) expect(url).toMatch(/^https:\/\/[\w-]+\.web\.app\/\.well-known\/security\.txt$/);
    expect(fields('Policy')).toEqual(['https://github.com/waqarsyd/forma/blob/main/SECURITY.md']);
  });
});
