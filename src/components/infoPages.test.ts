/**
 * The pages the site audit found missing (2026-11-08, batch SJ): each route is
 * a page, a title, a description, a prerendered file, a sitemap entry and a
 * hosting rewrite, and a page missing from one of those lists renders as the
 * 404, unindexed or untitled, without an error anywhere.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { INFO_DOCS, EXAMPLE_SHARES } from './infoPages';
import { INFO_ROUTES } from './publicPages';
import { ROUTES } from '../lib/router';
import { INDEXED_ROUTES, ROUTE_DESCRIPTIONS, securityTxt } from '../lib/seo';
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
   * /compare current (2026-11-11, full audit CP-09): the day it was reviewed
   * is a real date, not in the future, and the page says the two differences
   * that matter most and names the other tools, each linked to its vendor.
   */
  it('dates its comparison and states what it was missing', () => {
    const compare = INFO_DOCS['/compare']();
    expect(compare.reviewed).toMatch(/^\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/);
    const when = Date.parse(`${compare.reviewed} UTC`);
    expect(Number.isNaN(when)).toBe(false);
    expect(when).toBeLessThanOrEqual(Date.now());
    expect(when).toBeGreaterThanOrEqual(Date.parse('11 November 2026 UTC'));
    const src = readFileSync('src/components/infoPages.tsx', 'utf8');
    const page = src.slice(src.indexOf('export const COMPARE'), src.indexOf('export const ABOUT'));
    for (const said of ['Works with the version you have.', 'Reads a picture without a cloud account.', 'ActiveReports', 'Telerik', 'Stimulsoft', 'RDL and RDLC']) {
      expect(page, said).toContain(said);
    }
    expect(page).not.toMatch(/still a preview/);
    expect(page).toContain('https://docs.devexpress.com/XtraReports/405279');
  });

  /*
   * security.txt (item 110). RFC 9116 makes Contact and Expires required, and
   * an expired file is one a scanner ignores. Since 2026-11-11 (the full
   * audit's PS-24) the build writes it (vite.config.ts, `securityTxt`), a year
   * from the day it is built, so a deploy renews it; the hand-written
   * public/security.txt it replaces would have expired on 2027-11-08 unless
   * someone remembered.
   */
  it('publishes a security.txt that is valid and current, with the contact SECURITY.md gives', () => {
    expect(existsSync('public/security.txt'), 'a second, hand-written copy would shadow the built one').toBe(false);
    expect(readFileSync('vite.config.ts', 'utf8')).toMatch(/'security\.txt': \{[^}]*securityTxt\(new Date\(\)\)/);
    const txt = securityTxt(new Date());
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
