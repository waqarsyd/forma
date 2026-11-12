// @vitest-environment jsdom
/**
 * What search engines, link previews and crawlers are told (2026-11-08, the
 * site audit's batch SB). Each page has its own head; the private pages are
 * not indexed; the files crawlers ask for say what is true.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROUTES } from './router';
import { ROUTE_TITLES } from './routes';
import { applyHead, headFor, INDEXED_ROUTES, isOtherHost, llmsTxt, pageFile, robotsTxt, ROUTE_DESCRIPTIONS, securityTxt, SITE_ORIGIN, SITE_ORIGINS, sitemapXml, softwareJsonLd, withHead } from './seo';
import { DESIGNER_SITE_ORIGINS } from './designerBridge';

const shell = readFileSync('index.html', 'utf8');

describe('headFor', () => {
  it('gives every route its own title and a description, and the home page index.html\'s own', () => {
    for (const route of ROUTES) {
      const head = headFor(route);
      expect(head.title, route).toBe(ROUTE_TITLES[route]);
      expect(head.description.length, route).toBeGreaterThan(30);
    }
    expect(new Set(ROUTES.map((r) => headFor(r).description)).size).toBe(ROUTES.length);
    expect(shell).toContain(`content="${ROUTE_DESCRIPTIONS['/']}"`);
  });

  it('says what Forma is now in one sentence everywhere: index.html, the manifest and the title (full audit PS-10)', () => {
    const home = ROUTE_DESCRIPTIONS['/'];
    expect(home).toMatch(/^Turn a picture, a PDF, a \.repx or a few sentences into a DevExpress report/);
    expect(home).not.toMatch(/screenshot|written spec|mockup/i);
    // The description appears three times in index.html: the page's, og's and twitter's.
    expect(shell.split(`content="${home}"`).length - 1).toBe(3);
    expect(shell.split(`content="${ROUTE_TITLES['/']}"`).length - 1).toBe(2);
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as { name: string; description: string };
    expect(manifest.name).toBe(ROUTE_TITLES['/']);
    expect(manifest.description).toBe(home);
    expect(llmsTxt()).toContain(`> ${home} `);
    expect(softwareJsonLd()).toContain(home);
    expect(ROUTE_DESCRIPTIONS['/features']).toMatch(/translat/);
    expect(ROUTE_DESCRIPTIONS['/features']).toMatch(/shar/);
  });

  it('indexes the public pages at their canonical address, and keeps the app, sign-in, shares and missing pages out', () => {
    for (const route of INDEXED_ROUTES) expect(headFor(route)).toMatchObject({ canonical: `${SITE_ORIGIN}${route}`, robots: 'index, follow' });
    for (const path of ['/workspace', '/login', '/signup', '/s/AbCdEfGhIjKlMnOp1234', '/no-such-page']) {
      expect(headFor(path), path).toMatchObject({ canonical: null, robots: 'noindex' });
    }
  });
});

describe('pageFile', () => {
  it('names the file the build writes for each path', () => {
    expect(pageFile('/')).toBe('index.html');
    expect(pageFile('/features')).toBe('features.html');
    expect(pageFile('/s/AbCdEfGhIjKlMnOp1234')).toBe('share.html');
    expect(pageFile('/nope')).toBe('404.html');
  });
});

describe('withHead', () => {
  it("writes a page's title, words, canonical address and robots into index.html, and its body", () => {
    const page = withHead(shell, headFor('/docs'), { body: '<main>How Forma works</main>' });
    expect(page).toContain('<title>Docs — Forma</title>');
    expect(page.match(/<meta\s+name="description"\s+content="([^"]*)"/)?.[1]).toBe(ROUTE_DESCRIPTIONS['/docs']);
    expect(page).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/docs" />`);
    expect(page).toContain(`<meta property="og:url" content="${SITE_ORIGIN}/docs" />`);
    expect(page).toContain('<meta name="robots" content="index, follow" />');
    expect(page.match(/<meta property="og:title" content="([^"]*)"/)?.[1]).toBe('Docs — Forma');
    expect(page).toContain('<div id="root"><main>How Forma works</main></div>');
  });

  it("writes a value holding $ patterns as it is, never as a replacement pattern", () => {
    const head = { title: "Costs $& and $' — Forma", description: "Pay $1 or $` or $$ now", canonical: `${SITE_ORIGIN}/$'x`, robots: 'index, follow' as const };
    const page = withHead(shell, head, { body: "<p>$' and $&amp;</p>", extraHead: "<meta name=\"x\" content=\"$`\">" });
    expect(page).toContain("<title>Costs $&amp; and $' — Forma</title>");
    expect(page.match(/<meta\s+name="description"\s+content="([^"]*)"/)?.[1]).toBe('Pay $1 or $` or $$ now');
    expect(page.match(/<meta property="og:title" content="([^"]*)"/)?.[1]).toBe("Costs $&amp; and $' — Forma");
    expect(page).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/$'x" />`);
    expect(page).toContain("<div id=\"root\"><p>$' and $&amp;</p></div>");
    expect(page).toContain("<meta name=\"x\" content=\"$`\">\n</head>");
    // "$'" in a replacement string would have pasted the rest of the page in again.
    expect(page.match(/<\/head>/g)).toHaveLength(1);
    expect(page.match(/<div id="root">/g)).toHaveLength(1);
  });

  it('takes the canonical address and og:url out of a page not to be indexed', () => {
    const page = withHead(shell, headFor('/workspace'));
    expect(page).not.toContain('rel="canonical"');
    expect(page).not.toContain('og:url');
    expect(page).toContain('<meta name="robots" content="noindex" />');
  });

  it("carries the home page's structured data, which cannot close its own element", () => {
    const ld = softwareJsonLd();
    expect(JSON.parse(ld.replace(/^\s*<script type="application\/ld\+json">|<\/script>$/g, ''))).toMatchObject({ '@type': 'SoftwareApplication', offers: { price: '0' } });
    expect(ld.slice(0, -'</script>'.length)).not.toContain('</');
    expect(withHead(shell, headFor('/'), { extraHead: ld })).toContain('application/ld+json');
  });
});

describe('applyHead', () => {
  it('keeps the live page\'s head with the route, adding and removing what a page needs', () => {
    document.head.innerHTML = '<title>x</title><meta name="description" content="x"><link rel="canonical" href="x">';
    applyHead(document, headFor('/features'));
    expect(document.title).toBe('Features — Forma');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${SITE_ORIGIN}/features`);
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('index, follow');
    applyHead(document, headFor('/workspace'));
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('meta[property="og:url"]')).toBeNull();
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(ROUTE_DESCRIPTIONS['/workspace']);
  });
});

describe('the files crawlers ask for', () => {
  it('lists the indexed pages in the sitemap and names it in robots.txt', () => {
    const sitemap = sitemapXml('2026-11-08');
    expect(sitemap.match(/<loc>/g)).toHaveLength(INDEXED_ROUTES.length);
    expect(sitemap).toContain(`<loc>${SITE_ORIGIN}/features</loc><lastmod>2026-11-08</lastmod>`);
    expect(sitemap).not.toContain('/workspace');
    expect(robotsTxt()).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`);
  });

  it('gives security.txt the public contact address, never the git one, and a year to expire', () => {
    const text = securityTxt(new Date('2026-11-08T00:00:00Z'));
    expect(text).toContain('Contact: mailto:waqarsayyed.official@gmail.com');
    expect(text).not.toMatch(/waqarshaikh/);
    expect(text).toContain('Expires: 2027-11-08T00:00:00Z');
    expect(text).toContain(`Canonical: ${SITE_ORIGIN}/.well-known/security.txt`);
    // Both sites serve the same file (2026-11-11, PS-24), so both are canonical.
    expect(text).toContain('Canonical: https://forma-201ba.web.app/.well-known/security.txt');
  });

  it('names a canonical address for every site firebase.json deploys', () => {
    const hosting = JSON.parse(readFileSync('firebase.json', 'utf8')) as { hosting: { site: string }[] };
    const text = securityTxt(new Date());
    for (const { site } of hosting.hosting) expect(text).toContain(`Canonical: https://${site}.web.app/.well-known/security.txt`);
  });

  it('describes every public page in llms.txt', () => {
    const text = llmsTxt();
    expect(text.startsWith('# Forma\n\n> ')).toBe(true);
    for (const route of INDEXED_ROUTES.filter((r) => r !== '/')) expect(text).toContain(`(${SITE_ORIGIN}${route})`);
  });
});

/*
 * Where the note on Forma's main address shows (2026-11-12, the owner's
 * decision 9 of the 2026-11-11 audit; components/OtherHostNotice.tsx): every
 * host that serves the build under another address, and nowhere else.
 */
describe('isOtherHost', () => {
  it('is true on the second site and on either site\'s firebaseapp.com twin, and false on the known address', () => {
    for (const host of ['forma-201ba.web.app', 'forma-201ba.firebaseapp.com', 'openforma.firebaseapp.com']) expect(isOtherHost(host), host).toBe(true);
    expect(isOtherHost(new URL(SITE_ORIGIN).hostname)).toBe(false);
  });

  it('is false anywhere else: this PC, a preview channel, another site', () => {
    for (const host of ['localhost', '127.0.0.1', 'forma-201ba--preview-abc123.web.app', 'openforma.web.app.example.com', 'example.com', '']) {
      expect(isOtherHost(host), host).toBe(false);
    }
  });

  it('knows the sites firebase.json deploys, the same two Forma Designer answers', () => {
    const hosting = JSON.parse(readFileSync('firebase.json', 'utf8')) as { hosting: { site: string }[] };
    expect(hosting.hosting.map(({ site }) => `https://${site}.web.app`).sort()).toEqual([...SITE_ORIGINS].sort());
    expect([...DESIGNER_SITE_ORIGINS].sort()).toEqual([...SITE_ORIGINS].sort());
    expect(SITE_ORIGINS[0]).toBe(SITE_ORIGIN);
  });
});
