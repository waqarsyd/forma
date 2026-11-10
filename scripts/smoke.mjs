#!/usr/bin/env node
/**
 * Does the deployed site work? (2026-11-07, site audit item 102.)
 *
 *   node scripts/smoke.mjs [--expect <commit>] [base URL ...]
 *   npm run smoke
 *
 * With no URL it checks both hosted sites, https://openforma.web.app and
 * https://forma-201ba.web.app. For each it asks, over the network, only what
 * a visitor's browser asks, and fails (exit 1) when:
 *
 * - a route does not answer 200 with a page (a route main added after the live
 *   build only warns), or the page carries no CSP,
 *   or the document is cacheable (it must revalidate, or a deploy never
 *   reaches a returning visitor);
 * - the entry chunk the page names does not load, or is not immutable;
 * - the changelog's feed is missing;
 * - the Forma Designer download the live build links is not on its GitHub
 *   release (2026-11-10).
 *
 * And, once the live site is the build `--expect` names (the page carries its
 * commit in <meta name="forma-version">, written by vite.config.ts), the
 * promises made since: an unknown path and a missing chunk are 404s, not the
 * home page with a 200 (site audit items 1 and 52). A site running another
 * build gets a warning instead of a failure for those, and says which build
 * it runs: the deploy is the owner's, and a site behind main is news, not a
 * broken site. .github/workflows/live.yml runs this every day.
 *
 * Read-only: it sends GETs and changes nothing. Pure ASCII, as every script
 * here (CLAUDE.md, the PowerShell encoding trap).
 */
import { readFileSync, appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const expectAt = args.indexOf('--expect');
const expected = expectAt >= 0 ? args.splice(expectAt, 2)[1] : '';
const bases = (args.length ? args : ['https://openforma.web.app', 'https://forma-201ba.web.app']).map((b) => b.replace(/\/+$/, ''));

/** The routes a router.ts declares. */
const routesIn = (source) => JSON.parse(source.match(/export const ROUTES = (\[[^\]]*\])/)[1].replace(/'/g, '"'));

/** The router's routes, read from the source so a new page is checked without editing this. */
const routes = routesIn(readFileSync(new URL('../src/lib/router.ts', import.meta.url), 'utf8'));

/**
 * The routes the live build was made with, read from its own commit in the
 * public repository, or null when that cannot be read (2026-11-10). A page main
 * added after the live build answers 404 there until the owner deploys, which
 * is news like the build itself, not a broken site: the daily check failed on
 * /download for exactly that while 1.3.0 waited to be deployed.
 */
async function routesOf(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit)) return null;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/waqarsyd/forma/${commit}/src/lib/router.ts`);
    return res.ok ? routesIn(await res.text()) : null;
  } catch {
    return null;
  }
}

/**
 * The Forma Designer download a build links, read from its manifest
 * (src/lib/designerRelease.ts) at that commit, or null when that cannot be
 * read. The download page links the zip on the GitHub release the manifest
 * names, whatever build is live, so the live build's manifest is the one to
 * ask. Added 2026-11-10, the day 1.4.0 was deployed: the manifest named
 * v1.3.0, a release never made because 1.3.0 shipped inside 1.4.0, and
 * /download linked a 404 while every other check here passed.
 */
async function designerDownloadOf(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit)) return null;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/waqarsyd/forma/${commit}/src/lib/designerRelease.ts`);
    if (!res.ok) return null;
    const source = await res.text();
    const field = (name) => (new RegExp(`\\n  ${name}: '([^']*)'`).exec(source) || [])[1];
    return field('tag') && field('file') ? `https://github.com/waqarsyd/forma/releases/download/${field('tag')}/${field('file')}` : null;
  } catch {
    return null;
  }
}

const failures = [];
const warnings = [];
const notes = [];
const fail = (base, what) => failures.push(`${base}: ${what}`);
const warn = (base, what) => warnings.push(`${base}: ${what}`);

async function get(url) {
  const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'forma-smoke/1 (+https://github.com/waqarsyd/forma)' } });
  const body = await res.text();
  return { status: res.status, headers: res.headers, body };
}

async function check(base) {
  const home = await get(`${base}/`);
  if (home.status !== 200) return fail(base, `/ answered ${home.status}`);
  const version = /<meta name="forma-version" content="([^"]+)"/.exec(home.body)?.[1] ?? '';
  notes.push(`${base} runs ${version || 'a build from before 2026-11-07 (no version in the page)'}`);
  if (!/content-security-policy/i.test([...home.headers.keys()].join(' '))) fail(base, '/ carries no Content-Security-Policy');
  if (!/no-cache/.test(home.headers.get('cache-control') ?? '')) fail(base, `/ is cacheable (${home.headers.get('cache-control')}); it must revalidate`);

  const live = expected && version !== expected ? await routesOf(version) : null;
  for (const route of routes) {
    const page = await get(`${base}${route}`);
    if (page.status === 200 && /<div id="root">/.test(page.body)) continue;
    const what = `${route} answered ${page.status}${page.status === 200 ? ' without the app' : ''}`;
    if (live && !live.includes(route)) warn(base, `${what}: main added it after the live build`);
    else fail(base, what);
  }

  const entry = /<script type="module" crossorigin src="(\/assets\/[^"]+\.js)"/.exec(home.body)?.[1];
  if (!entry) fail(base, 'the page names no entry chunk');
  else {
    const chunk = await get(`${base}${entry}`);
    if (chunk.status !== 200 || !/javascript/.test(chunk.headers.get('content-type') ?? '')) fail(base, `${entry} answered ${chunk.status} ${chunk.headers.get('content-type')}`);
    if (!/immutable/.test(chunk.headers.get('cache-control') ?? '')) fail(base, `${entry} is not immutable (${chunk.headers.get('cache-control')})`);
  }

  const feed = await get(`${base}/changelog.xml`);
  if (feed.status !== 200 || !/<feed/.test(feed.body)) warn(base, `/changelog.xml answered ${feed.status}`);

  // GitHub answers a HEAD for a release's file with 302 to its store, and 404 when it is not there.
  const download = await designerDownloadOf(version);
  if (download) {
    const zip = await fetch(download, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': 'forma-smoke/1 (+https://github.com/waqarsyd/forma)' } });
    if (zip.status !== 302 && zip.status !== 200) fail(base, `the Forma Designer download the live build links answered ${zip.status}: ${download}`);
  }

  // What main has promised since the version was first written into the page.
  const current = expected && version === expected;
  const promise = current ? fail : warn;
  const unknown = await get(`${base}/no-such-page-${Date.now()}`);
  if (unknown.status !== 404) promise(base, `an unknown path answered ${unknown.status}, not 404`);
  const stale = await get(`${base}/assets/index-STALE000.js`);
  if (stale.status !== 404) promise(base, `a missing chunk answered ${stale.status}, not 404`);
  if (expected && version !== expected) warn(base, `the live site runs ${version || 'an older build'}, not ${expected.slice(0, 12)} (main); deploying is the owner's`);
}

for (const base of bases) {
  try {
    await check(base);
  } catch (err) {
    fail(base, `could not be reached: ${err.message}`);
  }
}

const lines = [
  '## Live site',
  ...notes.map((n) => `- ${n}`),
  ...(warnings.length ? ['', '### Warnings', ...warnings.map((w) => `- ${w}`)] : []),
  ...(failures.length ? ['', '### Failures', ...failures.map((f) => `- ${f}`)] : ['', 'Every check passed.']),
];
console.log(lines.join('\n'));
for (const w of warnings) console.log(`::warning::${w}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
process.exit(failures.length ? 1 : 0);
