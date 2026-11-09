/**
 * What search engines, link previews and crawlers are told about each page
 * (2026-11-08, the site audit's batch SB: items 36, 37, 38, 53, 54, 73, 74,
 * 118). Pure, so the build writes it into every page and its files, the app
 * applies the same head as it moves between routes (`applyHead`), and a test
 * holds both.
 *
 * Until then every route was one `index.html`: the home page's title,
 * description and preview card on /docs and /privacy, no canonical address
 * across the four hosts that serve the site, relative preview images, an
 * empty body for anything that runs no script, the workspace, the sign-in
 * pages and every shared report open to indexing, and no robots.txt, sitemap
 * or security.txt (each answered with the home page).
 */
import { ROUTES } from './router';
import { NOT_FOUND_TITLE, ROUTE_TITLES, SHARED_REPORT_TITLE, sharedReportId } from './routes';

/**
 * The address the site is known by. Four hosts serve it (openforma and
 * forma-201ba, each on web.app and firebaseapp.com); this is the one the
 * README and the changelog's feed give, so every page names it as canonical.
 * A fork deploying elsewhere changes it here.
 */
export const SITE_ORIGIN = 'https://openforma.web.app';
export const SITE_NAME = 'Forma';
/** The 1200x630 card every page previews with, by absolute URL as Open Graph asks. */
export const OG_IMAGE = `${SITE_ORIGIN}/og-card.png`;
export const REPOSITORY = 'https://github.com/waqarsyd/forma';
/** The project's public contact address (SECURITY.md); never the git address. */
export const CONTACT_EMAIL = 'waqarsayyed.official@gmail.com';

/** The pages a search engine may index: the public ones. */
export const INDEXED_ROUTES = ['/', '/features', '/pricing', '/docs', '/faq', '/examples', '/compare', '/security', '/self-host', '/download', '/about', '/contact', '/changelog', '/terms', '/privacy', '/accessibility'] as const;

/** One sentence per route, for search results and link previews. The home page's is index.html's own. */
export const ROUTE_DESCRIPTIONS: Record<string, string> = {
  '/': 'Upload a screenshot, a PDF, or an existing .repx. Forma returns a written spec, a live mockup, and valid DevExpress XML you can open in the designer.',
  '/features': 'Everything Forma does: a screenshot, a PDF or a description to a DevExpress .repx, a print preview with exports, a chat that edits the report in place, and OCR in your browser.',
  '/docs': 'How to use Forma: add your own Gemini key, attach a design or describe one, read the checks, edit in the chat, preview and export, and open the result in the DevExpress designer.',
  '/contact': 'Questions, bug reports and security issues for Forma, by email or on GitHub.',
  '/changelog': 'What is new in Forma, release by release, with an Atom feed.',
  '/terms': 'The terms of use for Forma, a free and open-source DevExpress report designer.',
  '/privacy': 'How Forma handles your data, your Gemini key and the files you upload.',
  '/accessibility': 'What Forma does to be usable by everyone, what still falls short, and how to tell us.',
  '/security': 'How Forma keeps your API key and your reports safe: bring your own key, a strict content policy, owner-only data and how to report a vulnerability.',
  '/pricing': 'Forma is free, with no plans. What the AI costs: Google’s free Gemini tier, a free local AI, or OpenRouter’s free models.',
  '/examples': 'Six example reports to start from in Forma, from an invoice to an inventory report, each opened in the workspace with one click.',
  '/compare': 'Forma beside DevExpress’s own AI features, and how to move Crystal Reports and SSRS reports to DevExpress for free.',
  '/about': 'Forma, an open-source AI report designer for DevExpress: who makes it, what it is built with, and a press kit.',
  '/self-host': 'Run Forma yourself: on your own computer, or with your own Firebase project for a team.',
  '/download': 'Download Forma Designer for Windows, free: open your Forma reports in the DevExpress report designer with one click. Version, size, SHA-256 and install steps.',
  '/faq': 'Answers to the questions people ask about Forma: cost, files, privacy, languages and moving your projects.',
  '/login': 'Sign in to Forma to keep your reports in your account.',
  '/signup': 'Create a free Forma account to keep your reports in your account.',
  '/workspace': 'The Forma workspace: a screenshot, a PDF or a description to a DevExpress report.',
};

const SHARED_DESCRIPTION = 'A report designed in Forma and shared by its author.';
const NOT_FOUND_DESCRIPTION = 'This page does not exist. Forma turns a screenshot, a PDF or a description into a DevExpress report.';

export interface Head {
  title: string;
  description: string;
  /** The page's canonical address; null for a page not to be indexed. */
  canonical: string | null;
  robots: 'index, follow' | 'noindex';
}

/** The head of the page at `path`: a route, a shared report, or a page that is not there. */
export function headFor(path: string): Head {
  if ((ROUTES as readonly string[]).includes(path)) {
    const indexed = (INDEXED_ROUTES as readonly string[]).includes(path);
    return {
      title: ROUTE_TITLES[path],
      description: ROUTE_DESCRIPTIONS[path],
      canonical: indexed ? `${SITE_ORIGIN}${path}` : null,
      robots: indexed ? 'index, follow' : 'noindex',
    };
  }
  if (sharedReportId(path)) return { title: SHARED_REPORT_TITLE, description: SHARED_DESCRIPTION, canonical: null, robots: 'noindex' };
  return { title: NOT_FOUND_TITLE, description: NOT_FOUND_DESCRIPTION, canonical: null, robots: 'noindex' };
}

/**
 * The file the build writes for a path, which firebase.json and `npm start`
 * serve for it: `index.html` for the home page, `features.html` for
 * /features, `share.html` for any /s/{id}, `404.html` for anything else.
 */
export function pageFile(path: string): string {
  if (path === '/') return 'index.html';
  if ((ROUTES as readonly string[]).includes(path)) return `${path.slice(1)}.html`;
  if (sharedReportId(path)) return 'share.html';
  return '404.html';
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Replaces the content of the one `<meta>` naming `key` (name= or property=). */
function setMeta(html: string, attr: 'name' | 'property', key: string, value: string): string {
  const re = new RegExp(`(<meta\\s+${attr}="${key.replace(/[.:]/g, '\\$&')}"\\s+content=")[^"]*(")`);
  return html.replace(re, `$1${escapeAttr(value)}$2`);
}

/**
 * The built page with `head` in it, for the build: the title, the
 * description and the preview card's words, the canonical address and
 * og:url (taken out for a page not to be indexed), and the robots meta.
 * `extraHead` goes in before `</head>` (the home page's JSON-LD); `body`, a
 * page drawn at build (src/prerender.tsx), goes inside `<div id="root">`.
 */
export function withHead(html: string, head: Head, extra: { body?: string; extraHead?: string } = {}): string {
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeText(head.title)}</title>`);
  out = setMeta(out, 'name', 'description', head.description);
  out = setMeta(out, 'property', 'og:title', head.title);
  out = setMeta(out, 'property', 'og:description', head.description);
  out = setMeta(out, 'name', 'twitter:title', head.title);
  out = setMeta(out, 'name', 'twitter:description', head.description);
  out = setMeta(out, 'name', 'robots', head.robots);
  if (head.canonical) {
    out = out.replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/, `$1${escapeAttr(head.canonical)}$2`);
    out = setMeta(out, 'property', 'og:url', head.canonical);
  } else {
    out = out.replace(/\s*<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/, '').replace(/\s*<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/, '');
  }
  if (extra.extraHead) out = out.replace('</head>', `${extra.extraHead}\n</head>`);
  if (extra.body) out = out.replace('<div id="root"></div>', `<div id="root">${extra.body}</div>`);
  return out;
}

/**
 * The same head on the live page as the app moves between routes, which a
 * crawler that runs script, or a person sharing the address they are on,
 * reads. The build wrote it for the page that loaded; this keeps it right
 * after navigating.
 */
export function applyHead(doc: Document, head: Head): void {
  doc.title = head.title;
  const meta = (attr: 'name' | 'property', key: string, value: string | null) => {
    let el = doc.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
    if (value === null) {
      el?.remove();
      return;
    }
    if (!el) {
      el = doc.createElement('meta');
      el.setAttribute(attr, key);
      doc.head.appendChild(el);
    }
    el.content = value;
  };
  meta('name', 'description', head.description);
  meta('property', 'og:title', head.title);
  meta('property', 'og:description', head.description);
  meta('name', 'twitter:title', head.title);
  meta('name', 'twitter:description', head.description);
  meta('name', 'robots', head.robots);
  meta('property', 'og:url', head.canonical);
  let link = doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!head.canonical) link?.remove();
  else {
    if (!link) {
      link = doc.createElement('link');
      link.rel = 'canonical';
      doc.head.appendChild(link);
    }
    link.href = head.canonical;
  }
}

/** The home page's structured data: what Forma is, for a search result's rich card. */
export function softwareJsonLd(): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    url: `${SITE_ORIGIN}/`,
    description: ROUTE_DESCRIPTIONS['/'],
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web browser',
    image: OG_IMAGE,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    license: 'https://www.apache.org/licenses/LICENSE-2.0',
    isAccessibleForFree: true,
    codeRepository: REPOSITORY,
  };
  // `<` written as an escape, so the JSON cannot close its own script element.
  return `  <script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

/** sitemap.xml: the indexed pages, each last changed on `lastmod` (the newest release's date). */
export function sitemapXml(lastmod: string): string {
  const urls = INDEXED_ROUTES.map((route) => `  <url><loc>${SITE_ORIGIN}${route}</loc><lastmod>${lastmod}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/**
 * robots.txt: everything may be crawled, and the sitemap is named. The
 * workspace, the sign-in pages and shared reports are kept out of results
 * by their own noindex (and a shared report's X-Robots-Tag), which a
 * crawler can only read on a page it is allowed to fetch, so nothing is
 * disallowed here.
 */
export function robotsTxt(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
}

/** /.well-known/security.txt (RFC 9116), valid for a year from `now`; each build renews it. */
export function securityTxt(now: Date): string {
  const expires = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return [
    `Contact: mailto:${CONTACT_EMAIL}`,
    `Contact: ${REPOSITORY}/security/advisories/new`,
    `Expires: ${expires}`,
    'Preferred-Languages: en',
    `Policy: ${REPOSITORY}/blob/main/SECURITY.md`,
    `Canonical: ${SITE_ORIGIN}/.well-known/security.txt`,
    '',
  ].join('\n');
}

/** llms.txt (the proposed convention): what Forma is and where its pages are, for a language model reading the site. */
export function llmsTxt(): string {
  const pages = INDEXED_ROUTES.filter((r) => r !== '/').map((r) => `- [${ROUTE_TITLES[r].replace(/ — Forma$/, '')}](${SITE_ORIGIN}${r}): ${ROUTE_DESCRIPTIONS[r]}`);
  return [
    `# ${SITE_NAME}`,
    '',
    `> ${ROUTE_DESCRIPTIONS['/']} Free and open source (Apache-2.0); it runs in the browser with the visitor's own Gemini API key, or a local AI.`,
    '',
    '## Pages',
    '',
    ...pages,
    '',
    '## Source',
    '',
    `- [Repository](${REPOSITORY}): the code, the README and the issue tracker.`,
    `- [Changelog feed](${SITE_ORIGIN}/changelog.xml): every release, as Atom.`,
    '',
  ].join('\n');
}
