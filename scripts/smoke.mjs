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
 *   release (2026-11-10);
 * - an unknown path or a missing chunk is not a 404 (site audit items 1 and
 *   52), on every build that carries its version in the page;
 * - the offline worker (/sw.js) is not JavaScript that revalidates, or
 *   /.well-known/security.txt, /robots.txt, /sitemap.xml or /licenses.txt is
 *   missing (2026-11-11, the full audit, SA-17);
 * - an example share, when there is one, cannot be read from Firestore.
 *
 * The 404 promises were only warnings unless the live build was main, until
 * 2026-11-11 (SA-17): main moves ahead of the live site with every commit, so
 * the monitor went soft on the day after each deploy, and a live site that
 * lost them would have passed. Every build since the version meta was added
 * (2026-11-07) keeps them, so a page that carries a version is held to them.
 * A site running an older build than `--expect` still says so as a warning:
 * the deploy is the owner's, and a site behind main is news, not a broken
 * site. .github/workflows/live.yml runs this every three hours.
 *
 * The example share is read over Firestore's REST API as a visitor's browser
 * reads it, with no token: 200 is up, and so is 403, which is what App Check
 * answers once the owner enforces it (and what a share that is gone answers
 * too, so a 403 is reported as a note, not proof); anything else fails. The id
 * is `--share <id>`, or the first of EXAMPLE_SHARES in
 * src/components/infoPages.tsx; with neither, the check says it had nothing
 * to read.
 *
 * Read-only: it sends GETs and changes nothing. Pure ASCII, as every script
 * here (CLAUDE.md, the PowerShell encoding trap).
 */
import { readFileSync, appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const expectAt = args.indexOf('--expect');
const expected = expectAt >= 0 ? args.splice(expectAt, 2)[1] : '';
const shareAt = args.indexOf('--share');
const shareArg = shareAt >= 0 ? args.splice(shareAt, 2)[1] : '';
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

  // What every build has promised since the version was first written into
  // the page (2026-11-07): a build that carries one is held to it (SA-17).
  const promise = version ? fail : warn;
  const unknown = await get(`${base}/no-such-page-${Date.now()}`);
  if (unknown.status !== 404) promise(base, `an unknown path answered ${unknown.status}, not 404`);
  const stale = await get(`${base}/assets/index-STALE000.js`);
  if (stale.status !== 404) promise(base, `a missing chunk answered ${stale.status}, not 404`);

  // The files beside the pages (SA-17): the offline worker must revalidate,
  // or a deploy never reaches a returning visitor's worker.
  const worker = await get(`${base}/sw.js`);
  if (worker.status !== 200 || !/javascript/.test(worker.headers.get('content-type') ?? '')) promise(base, `/sw.js answered ${worker.status} ${worker.headers.get('content-type')}`);
  else if (!/no-cache/.test(worker.headers.get('cache-control') ?? '')) promise(base, `/sw.js is cacheable (${worker.headers.get('cache-control')}); it must revalidate`);
  for (const [path, type] of FILES) {
    const file = await get(`${base}${path}`);
    if (file.status !== 200 || !type.test(file.headers.get('content-type') ?? '')) promise(base, `${path} answered ${file.status} ${file.headers.get('content-type')}`);
  }
  if (expected && version !== expected) warn(base, `the live site runs ${version || 'an older build'}, not ${expected.slice(0, 12)} (main); deploying is the owner's`);
}

/** The files the build writes beside the pages, and the type each must come as. */
const FILES = [
  ['/.well-known/security.txt', /text\/plain/],
  ['/robots.txt', /text\/plain/],
  ['/sitemap.xml', /xml/],
  ['/licenses.txt', /text\/plain/],
];

/** The example share to read: --share, or the first of EXAMPLE_SHARES (infoPages.tsx), or ''. */
function exampleShare() {
  if (shareArg) return shareArg;
  try {
    const source = readFileSync(new URL('../src/components/infoPages.tsx', import.meta.url), 'utf8');
    const list = /export const EXAMPLE_SHARES[^=]*=\s*\[([\s\S]*?)\];/.exec(source)?.[1] ?? '';
    return /id:\s*'([A-Za-z0-9_-]+)'/.exec(list)?.[1] ?? '';
  } catch {
    return '';
  }
}

/**
 * One share read as a visitor's browser reads it (SA-17): Firestore's REST
 * API, no token. 200 and 403 (App Check enforced) are up; anything else is
 * Firestore failing.
 */
async function checkShare(id) {
  const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
  const database = encodeURIComponent(config.firestoreDatabaseId || '(default)');
  const url = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${database}/documents/shares/${id}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'forma-smoke/1 (+https://github.com/waqarsyd/forma)' } });
  // A share that is gone answers 403 too, not 404: the rules read the
  // document to decide, and refuse one that is not there (measured
  // 2026-11-11). So 403 is "up" only in the sense the plan asks for, and is
  // said as it is; 200 is the proof, until App Check is enforced.
  if (res.status === 200) notes.push(`the example share ${id} reads from Firestore`);
  else if (res.status === 403) notes.push(`the example share ${id}: Firestore answered 403 (App Check enforced, or the share is no longer public)`);
  else fail('Firestore', `reading the example share ${id} answered ${res.status}`);
}

for (const base of bases) {
  try {
    await check(base);
  } catch (err) {
    fail(base, `could not be reached: ${err.message}`);
  }
}
const share = exampleShare();
if (!share) notes.push('no example share to read from Firestore (EXAMPLE_SHARES is empty; --share <id> names one)');
else {
  try {
    await checkShare(share);
  } catch (err) {
    fail('Firestore', `could not be reached: ${err.message}`);
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
