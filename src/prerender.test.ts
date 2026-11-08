/**
 * Every public page as a visitor's browser first receives it (2026-11-08,
 * site audit item 88): drawn by `renderRoute`, the function the build writes
 * into `dist/<page>.html`, so these read the markup that ships rather than a
 * test's idea of it. Before this the public pages were almost untested, and
 * nothing checked a link: a section renamed on one page left every `#name`
 * pointing at it scrolling nowhere, without an error anywhere.
 *
 * Plain markup read with patterns, in the node environment: renderToString
 * needs no DOM, and a page's links and ids are attributes, which a pattern
 * reads exactly.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { PRERENDERED, renderRoute } from './prerender';
import { ROUTES } from './lib/router';
import { COPYRIGHT } from './components/SiteFooter';

const pages = new Map<string, string>(PRERENDERED.map((route) => [route, renderRoute(route)]));
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const attrs = (html: string, name: string) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map((m) => decode(m[1]));
const tags = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map((m) => m[0]);
const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** What the build writes beside the pages, or Hosting answers by rewrite (vite.config.ts, appRoutes.ts). */
const BUILT = new Set(['/licenses.txt', '/changelog.xml', '/sitemap.xml', '/robots.txt', '/sw.js', '/.well-known/security.txt']);

/** Whether a site path is something this site serves: a route, a shared report, a file in public/ or one the build writes. */
function served(path: string): boolean {
  if ((ROUTES as readonly string[]).includes(path) || /^\/s\/[\w-]+$/.test(path) || BUILT.has(path)) return true;
  return existsSync(`public${path}`);
}

describe.each([...PRERENDERED])('%s, as the build draws it', (route) => {
  const html = pages.get(route)!;

  it('has one heading, the main landmark its skip link names, real words and the footer', () => {
    expect(tags(html, 'h1')).toHaveLength(1);
    expect(attrs(html, 'id')).toContain('main');
    expect(attrs(html, 'href')).toContain('#main');
    expect(textOf(html).length).toBeGreaterThan(400);
    expect(textOf(html)).toContain(COPYRIGHT);
  });

  it('gives no two elements the same id', () => {
    const ids = attrs(html, 'id');
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('links only to sections, pages and files that exist', () => {
    const broken: string[] = [];
    const ids = new Set(attrs(html, 'id'));
    for (const href of attrs(html, 'href')) {
      if (href === '#' || /^(https?:|mailto:)/.test(href)) continue;
      if (href.startsWith('#')) {
        if (!ids.has(href.slice(1))) broken.push(href);
        continue;
      }
      const [beforeHash, hash] = href.split('#');
      const path = beforeHash.split('?')[0] || route;
      if (!served(path)) {
        broken.push(href);
        continue;
      }
      const target = pages.get(path);
      if (hash && target && !attrs(target, 'id').includes(hash)) broken.push(href);
    }
    expect(broken).toEqual([]);
  });

  it('opens every link to another site safely, and gives every image a text alternative', () => {
    for (const a of tags(html, 'a').filter((t) => /target="_blank"/.test(t))) expect(a).toMatch(/rel="[^"]*noopener/);
    for (const img of tags(html, 'img')) expect(img).toMatch(/\salt="/);
  });
});
