#!/usr/bin/env node
/**
 * The built pages, checked against the policy that will serve them
 * (2026-11-11, the full audit, TC-14).
 *
 * `securityHeaders.test.ts` hashes the one inline script of the SOURCE
 * `index.html` and checks the policy allows it. The build then draws every
 * public page (`src/prerender.tsx`), each with its own copy of that script,
 * and nothing read those copies. A page whose inline script came out different
 * is blocked by the Content-Security-Policy in production and throws nothing:
 * the theme script simply does not run, and the flash of light theme it exists
 * to prevent comes back. The same is true of the self-hosted server
 * (`npm start`, `node dist/server.cjs`), which CI built on every push and never
 * started.
 *
 * So this reads every `.html` under `dist/`, takes each inline script a CSP
 * governs (not a `src=` script, and not a JSON data block such as JSON-LD,
 * which is never executed), hashes it, and requires the hash in the
 * script policy of:
 *
 *   - every site in `firebase.json`'s `hosting` array, which is what the
 *     deployed site sends; and
 *   - with `--server <url>`, the header a running self-hosted server actually
 *     sends for that url. The fetch is retried for a while, because CI starts
 *     the server in the background just before.
 *
 * The script policy is `script-src-elem` when the policy has one, else
 * `script-src`, else `default-src`, which is the order a browser applies to a
 * script element.
 *
 * Only `'sha256-...'` sources are read, because sha256 is what
 * securityHeaders.ts writes. A policy moved to sha384 or sha512 hashes would
 * make every page fail here, loudly, until this reads those too; it can never
 * make a blocked page pass.
 *
 * It runs in CI only, after `npm run build`, like `npm ci`, so the local list
 * of seven checks stays seven. To run it by hand: `npm run build`, then
 * `node scripts/check-dist.mjs`. `--dist <dir>` reads another folder, which is
 * how a deliberately edited copy of a page is shown to fail without touching
 * the real build. Exits 1 naming each page and hash that is not allowed, and
 * also when it finds no page at all, so a build that never ran cannot pass.
 *
 * Pure ASCII, as every script here is (see check-encoding.mjs).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const root = process.cwd();
const dist = resolve(root, option('--dist') ?? 'dist');
const serverUrl = option('--server');

/** Every .html file under a folder, recursively. */
function pagesUnder(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...pagesUnder(path));
    else if (name.endsWith('.html')) found.push(path);
  }
  return found;
}

/** The sha256 sources of the directive a browser applies to a script element. */
function scriptHashes(policy) {
  const directives = new Map();
  for (const part of policy.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), values);
  }
  const values = directives.get('script-src-elem') ?? directives.get('script-src') ?? directives.get('default-src') ?? [];
  return new Set(values.map((v) => /^'sha256-([A-Za-z0-9+/=]+)'$/.exec(v)?.[1]).filter(Boolean));
}

/** Inline scripts a CSP governs: no src, and not a data block. */
function inlineScripts(html) {
  const scripts = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = match[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    // An import map and speculation rules are governed by script-src as well.
    if (type && !['module', 'importmap', 'speculationrules'].includes(type) && !/javascript|ecmascript/.test(type)) continue;
    scripts.push(match[2]);
  }
  return scripts;
}

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('base64');

async function serverPolicy(url) {
  const deadline = Date.now() + 20_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      const policy = res.headers.get('content-security-policy');
      if (!policy) throw Object.assign(new Error(`${url} answered ${res.status} with no Content-Security-Policy header`), { final: true });
      return policy;
    } catch (err) {
      if (err.final) throw err;
      lastError = err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`${url} did not answer within 20 seconds (${lastError?.cause?.code ?? lastError?.message ?? 'no error'})`);
}

const policies = [];
const hosting = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8')).hosting ?? [];
for (const site of Array.isArray(hosting) ? hosting : [hosting]) {
  const values = (site.headers ?? []).flatMap((rule) => rule.headers ?? [])
    .filter((h) => String(h.key).toLowerCase() === 'content-security-policy')
    .map((h) => h.value);
  if (values.length === 0) {
    console.error(`check-dist: firebase.json's site ${site.site ?? '(unnamed)'} sends no Content-Security-Policy.`);
    process.exit(1);
  }
  for (const value of values) policies.push({ name: `firebase.json site ${site.site ?? '(unnamed)'}`, hashes: scriptHashes(value) });
}
if (policies.length === 0) {
  console.error('check-dist: firebase.json has no hosting site to check against.');
  process.exit(1);
}

if (serverUrl) {
  try {
    policies.push({ name: `the server at ${serverUrl}`, hashes: scriptHashes(await serverPolicy(serverUrl)) });
  } catch (err) {
    console.error(`check-dist: ${err.message}`);
    process.exit(1);
  }
}

let pages;
try {
  pages = pagesUnder(dist);
} catch {
  pages = [];
}
if (pages.length === 0) {
  console.error(`check-dist: no .html page under ${relative(root, dist) || dist}. Run \`npm run build\` first.`);
  process.exit(1);
}

let scripts = 0;
const failures = [];
for (const page of pages) {
  for (const script of inlineScripts(readFileSync(page, 'utf8'))) {
    scripts++;
    const hash = sha256(script);
    for (const policy of policies) {
      if (!policy.hashes.has(hash)) failures.push(`${relative(root, page)}: inline script sha256-${hash} is not allowed by ${policy.name}`);
    }
  }
}

if (failures.length) {
  console.error(`check-dist: ${failures.length} inline script(s) would be blocked:`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`check-dist: ${pages.length} page(s), ${scripts} inline script(s), every one allowed by ${policies.map((p) => p.name).join(', ')}.`);
