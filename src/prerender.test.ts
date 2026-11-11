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
import { existsSync, readFileSync } from 'node:fs';
import { PRELOADED_FONTS, PRERENDERED, pageModuleOf, renderRoute, withPreloads } from './prerender';
import { ROUTES } from './lib/router';
import { COPYRIGHT } from './components/SiteFooter';

const pages = new Map<string, string>(PRERENDERED.map((route) => [route, renderRoute(route)]));
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const attrs = (html: string, name: string) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map((m) => decode(m[1]));
const tags = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map((m) => m[0]);
const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** What the build writes beside the pages, or Hosting answers by rewrite (vite.config.ts, appRoutes.ts). */
const BUILT = new Set(['/licenses.txt', '/changelog.xml', '/sitemap.xml', '/robots.txt', '/sw.js', '/security.txt', '/.well-known/security.txt']);

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

  /*
   * Visible before any script runs (2026-11-11, full audit PR-01 and PS-13):
   * the built home page carried 75 blocks at `opacity:0`, its h1 among them,
   * waiting for an animation only the bundle could start.
   */
  it('hides nothing behind an animation that only script would start', () => {
    // One exception, by name: the hero's demonstration ends by showing the
    // three files it made, and the built page draws the demonstration at its
    // start, as the app's first draw does, so the page does not blink from a
    // finished figure to an empty one. index.html's <noscript> style shows
    // them to a reader whose browser runs no script.
    const rest = html.replace(/<span[^>]*style="opacity:0;[^"]*">(report\.repx|mockup|spec\.md)<\/span>/g, '');
    expect(rest).not.toMatch(/opacity:\s*0(?![.\d])/);
  });

  it('names the chunk of its page, which the build preloads', () => {
    const pageModule = pageModuleOf(route);
    if (route === '/') expect(pageModule).toBeNull();
    else expect(pageModule && existsSync(pageModule)).toBeTruthy();
  });
});

/*
 * The stat strips say their figures in the built page (PS-13): each Stat
 * counted up from a 0 in state, effects do not run in a build, and every
 * figure on the home page and Features was written as 0.
 */
describe('the stat strips, as the build draws them', () => {
  // A Stat's figure is the only 28px tabular number in the secondary colour.
  const figures = (html: string) => [...html.matchAll(/text-\[28px\][^"]*tabular-nums text-secondary">(\d+)/g)].map((m) => Number(m[1]));
  const authored = (file: string) => [...readFileSync(file, 'utf8').matchAll(/<Stat to=\{(\d+)\}/g)].map((m) => Number(m[1]));

  it.each([
    ['/', 'src/components/LandingPage.tsx'],
    ['/features', 'src/components/FeaturesPage.tsx'],
  ])('%s shows the figures its source gives', (route, file) => {
    const want = authored(file);
    expect(want.filter((n) => n > 0).length).toBeGreaterThan(0);
    expect(figures(pages.get(route)!)).toEqual(want);
  });
});

/*
 * What a page's head asks for ahead of its script (2026-11-11, full audit
 * PR-02 and PR-21): vite.config.ts writes these with the bundle's names, so
 * what is held here is the writer and the names it is given.
 */
describe('the preloads the build writes into a page head', () => {
  const shell = '<html><head><title>x</title></head><body><div id="root"></div></body></html>';

  it('puts a modulepreload for /docs before the head closes', () => {
    expect(pageModuleOf('/docs')).toBe('src/components/DocsPage.tsx');
    const html = withPreloads(shell, { modules: ['/assets/DocsPage-abc12345.js'] });
    expect(html).toContain('<link rel="modulepreload" crossorigin href="/assets/DocsPage-abc12345.js">');
    expect(html.indexOf('modulepreload')).toBeLessThan(html.indexOf('</head>'));
  });

  it('preloads the two typefaces the first paint sets, as fonts fetched in CORS mode', () => {
    const css = readFileSync('src/index.css', 'utf8');
    for (const name of PRELOADED_FONTS) {
      expect(existsSync(`src/fonts/${name}`)).toBe(true);
      expect(css).toContain(`./fonts/${name}`);
    }
    const html = withPreloads(shell, { fonts: ['/assets/inter-latin-AbCd1234.woff2'] });
    expect(html).toContain('<link rel="preload" as="font" type="font/woff2" crossorigin href="/assets/inter-latin-AbCd1234.woff2">');
  });

  it('leaves a page with nothing to preload as it was', () => {
    expect(withPreloads(shell, {})).toBe(shell);
  });
});
