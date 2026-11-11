/**
 * `firebase.json`'s hosting headers must be what this codebase would send.
 *
 * ## Why this test is the whole point of the file it checks
 *
 * A static host serves files; it does not run `server.ts`. So every header
 * `securityHeaders.ts` exists to send has to be restated in `firebase.json`,
 * and that is a second copy of **the app's central security claim** — the
 * `connect-src` list that makes a stolen Gemini key worthless to injected
 * script. A copy nobody checks is a copy that drifts, and this one drifts
 * silently: a policy that has quietly lost an origin does not throw, it just
 * stops defending, and the only symptom is an attack that would have failed
 * now succeeding.
 *
 * This project has been bitten by hand-mirrored duplicates repeatedly — the
 * design tokens, the version list across seven files, the test counts. The
 * answer each time was a check rather than a convention, so: the deployed
 * headers are **derived here and asserted**, and `firebase.json` is the
 * generated artifact rather than the source.
 *
 * ## When this fails
 *
 * It prints the exact JSON to paste back. That is deliberate — the same trick
 * `legalDisclosure.test.ts` uses for its hash. A failure should hand you the
 * fix, not send you to work it out, because the tempting alternative when it
 * does not is to edit the assertion until it passes.
 *
 * ## A header rule matches the REQUEST path, not the file that is served
 *
 * This cost a real defect, found only by fetching the deployed site on
 * 2026-09-09. The config had a `/index.html` rule carrying `no-cache`, which
 * looked correct and tested clean — but every rewritten route (`/`, `/workspace`,
 * `/docs`, …) is *requested* as itself and only *served* from `index.html`, so
 * the rule matched nothing a visitor ever asks for. `/index.html` came back
 * `no-cache`; `/` came back with Firebase's default `max-age=3600`.
 *
 * The document naming the current hashed bundle was therefore cacheable for an
 * hour, which is the exact failure `staticCache.ts` exists to prevent: a deploy
 * that never reaches a returning visitor. So `no-cache` now lives on `**` and
 * `/assets/**` overrides it — **last matching rule wins**, which is why the
 * immutable rule is last in the array and must stay there.
 *
 * ## Only the app's paths are rewritten (2026-11-07, site audit items 1 and 52)
 *
 * This said, until that day, that Firebase could not 404 a stale `/assets/*`
 * hash because "its rewrites always answer 200". True of a `**` rewrite, which
 * this config had: every unknown path, and every chunk a deploy removed, came
 * back as the home page with a 200, the chunk cached for a year as immutable.
 * The rewrites now name the router's routes and a shared report's `/s/*`
 * (`hostingRewrites` in appRoutes.ts), so anything else falls through to
 * Firebase's own 404 handling, which serves `dist/404.html` with a 404 status,
 * and a page that asks for a stale chunk reloads once (lib/staleChunks.ts).
 *
 * `Strict-Transport-Security` is asserted here but **cannot be observed on
 * `*.web.app`**: Firebase replaces it with its own preloaded value. The
 * configured one applies on a custom domain, so it is still worth pinning.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { securityHeadersFor } from './securityHeaders';
import { IMAGE_CACHE, IMAGE_EXTENSIONS, IMMUTABLE, REVALIDATE, VERSIONED_DIRS } from './staticCache';
import { hostingRewrites, NOINDEX_HEADER, NOINDEX_SOURCES } from './appRoutes';

/** Read off disk rather than imported, so the committed file is what is tested. */
const config = JSON.parse(readFileSync('firebase.json', 'utf8'));

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };
type HostingEntry = { site?: string; public?: string; rewrites?: unknown; ignore?: string[]; headers?: HeaderRule[] };

/*
 * `hosting` became an ARRAY on 2026-09-10, one entry per site, when
 * openforma.web.app was added beside the original forma-201ba.web.app. Firebase
 * has no way to share one block between sites, so the entries are duplicates --
 * which is precisely the hand-mirrored copy this file exists to distrust. The
 * duplication is therefore generated rather than typed, and asserted below.
 */
const sites: HostingEntry[] = Array.isArray(config.hosting) ? config.hosting : [config.hosting];
const primary: HostingEntry = sites[0] ?? {};

const rules: HeaderRule[] = primary.headers ?? [];
const ruleFor = (source: string) => rules.find((r) => r.source === source);
const asMap = (rule: HeaderRule | undefined) =>
  Object.fromEntries((rule?.headers ?? []).map((h) => [h.key, h.value]));

/** Everything except the site name, which is the only field allowed to differ. */
const body = (h: HostingEntry) => {
  const copy: HostingEntry = JSON.parse(JSON.stringify(h));
  delete copy.site;
  return JSON.stringify(copy);
};

describe('firebase.json hosting', () => {
  it('exists at all, with dist as the public directory', () => {
    expect(config.hosting, 'no hosting block in firebase.json').toBeTruthy();
    for (const s of sites) expect(s.public, `site ${s.site}`).toBe('dist');
  });

  /*
   * Every site must serve the same app with the same headers. A second site
   * that quietly loses an origin from connect-src, or the immutable rule, is a
   * defect nobody would see -- both URLs keep working and one of them is worse.
   */
  it('serves every site from one identical configuration', () => {
    expect(sites.length, 'expected at least one hosting entry').toBeGreaterThan(0);
    const names = sites.map((s) => s.site ?? '(default)');
    expect(new Set(names).size, `duplicate site names: ${names.join(', ')}`).toBe(names.length);
    for (const s of sites.slice(1)) {
      if (body(s) === body(primary)) continue;
      expect.fail(
        `hosting entry "${s.site}" differs from "${primary.site}" by more than its site name.\n` +
          'Regenerate rather than hand-editing: every site must serve identical headers.'
      );
    }
  });

  /*
   * The SPA fallback. Every route in this app is a real path (see lib/router),
   * so a deep link to /docs must serve index.html rather than 404, and a path
   * that is no route must not (site audit item 52): the rewrites are the
   * router's routes and /s/*, derived, so a new route is a failure here that
   * prints what to paste.
   */
  it('serves index.html for the routes and shared reports, and nothing else', () => {
    const expected = hostingRewrites();
    for (const s of sites) {
      if (JSON.stringify(s.rewrites) === JSON.stringify(expected)) continue;
      expect.fail(`site ${s.site}'s rewrites are not the app's routes. Paste this as "rewrites":\n${JSON.stringify(expected, null, 2)}`);
    }
  });

  it('sends exactly the security headers this codebase builds, with HSTS', () => {
    // https: true because Firebase Hosting always terminates TLS. That is the
    // condition securityHeaders.ts requires before HSTS may be sent at all.
    const expected = securityHeadersFor({ https: true });
    // Cache-Control also lives on this rule, for the request-path reason in the
    // header comment. It is asserted separately rather than compared here.
    const { 'Cache-Control': _cache, ...actual } = asMap(ruleFor('**'));

    for (const [key, value] of Object.entries(expected)) {
      if (actual[key] === value) continue;
      expect.fail(
        `firebase.json's "${key}" does not match securityHeadersFor({ https: true }).\n\n` +
          `  expected: ${value}\n\n` +
          `  actual:   ${actual[key] ?? '(header absent)'}\n\n` +
          `Paste this into the "**" headers block:\n` +
          JSON.stringify({ key, value }, null, 2)
      );
    }

    // And nothing extra: an unexplained header on a public deployment is
    // something to notice, not to shrug at.
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  });

  /*
   * Every cache rule after the catch-all, derived from staticCache.ts: the
   * pictures (item 90, the one rule that was firebase.json's alone), the
   * versioned folders (item 91), and the hashed assets last, which must win.
   */
  it('carries the same cache policy staticCache.ts applies, in that order', () => {
    const expected = [
      // A shared report kept out of search results (site audit item 38), from appRoutes.ts.
      ...NOINDEX_SOURCES.map((source) => ({ source, headers: [{ ...NOINDEX_HEADER }] })),
      { source: `**/*.@(${IMAGE_EXTENSIONS.join('|')})`, headers: [{ key: 'Cache-Control', value: IMAGE_CACHE }] },
      ...VERSIONED_DIRS.map((dir) => ({ source: `/${dir}/**`, headers: [{ key: 'Cache-Control', value: IMMUTABLE }] })),
      { source: '/assets/**', headers: [{ key: 'Cache-Control', value: IMMUTABLE }] },
    ];
    const actual = rules.slice(1);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      expect.fail(`the cache rules after "**" are not staticCache.ts's. Paste these after the "**" rule:\n${JSON.stringify(expected, null, 2)}`);
    }
    expect(asMap(ruleFor('**'))['Cache-Control']).toBe(REVALIDATE);
  });

  /*
   * The one that would be easy to lose, and the one that was actually lost.
   * The document must NOT inherit the immutable policy: it names the current
   * hashed bundle, so a hard-cached copy pins a visitor to an old deploy with
   * no way to reach them. Asserted on `**` because that is the rule that
   * matches `/` and every rewritten route -- a `/index.html` rule passes this
   * test while protecting a path no visitor requests.
   */
  it('never lets the served document be cached', () => {
    const docPolicy = asMap(ruleFor('**'))['Cache-Control'] ?? '';
    expect(docPolicy).not.toMatch(/immutable/);
    expect(docPolicy).not.toMatch(/max-age=[1-9]/);
  });

  /*
   * Last matching rule wins in Firebase Hosting, so `**` carrying no-cache
   * would defeat the immutable policy if it came after it. Ordering is load
   * bearing and invisible; pin it.
   */
  it('lets the immutable asset rule override the catch-all', () => {
    const catchAll = rules.findIndex((r) => r.source === '**');
    const assets = rules.findIndex((r) => r.source === '/assets/**');
    expect(catchAll).toBeGreaterThanOrEqual(0);
    expect(assets).toBeGreaterThan(catchAll);
  });

  /*
   * dist/ holds the esbuild server bundle beside the client, because one build
   * writes both. Firebase served it at /server.cjs until 2026-09-09. It is not
   * a secret -- the repository is public -- but a static host has no business
   * publishing the server, and a file nobody meant to ship is worth excluding
   * by name.
   */
  it('does not deploy the server bundle', () => {
    for (const s of sites) expect(s.ignore, `site ${s.site}`).toContain('server.cjs');
  });

  it('keeps the emulator and rules config the other suites depend on', () => {
    expect(config.firestore?.rules).toBe('firestore.rules');
    expect(config.emulators?.firestore?.port).toBe(8181);
  });

  /*
   * The owner's learning pull (scripts/model/pull-learning.ts) is a
   * collection-group query over every account's `learning`, filtered on `day`
   * and ordered by `day`, `at` and the name (lib/learningPipeline.ts,
   * `pullQuery`). Firestore refuses such a query without its index, and no
   * index file existed until 2026-11-11 (the full audit, LM-04), so the pull
   * would have stopped at its first page. The file is deployed with the rules
   * (scripts/deploy.mjs). A field override replaces a field's automatic
   * indexes, so each keeps all three collection-scope ones (ascending,
   * descending and array-contains) beside its own: harmless to drop the
   * last for string fields, but an override that keeps every default is one
   * nobody has to reason about.
   */
  it('declares the indexes the learning pull queries on, and deploys them', () => {
    expect(config.firestore?.indexes).toBe('firestore.indexes.json');
    const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')) as {
      indexes: { collectionGroup: string; queryScope: string; fields: { fieldPath: string; order: string }[] }[];
      fieldOverrides: { collectionGroup: string; fieldPath: string; indexes: { order?: string; arrayConfig?: string; queryScope: string }[] }[];
    };
    expect(indexes.indexes).toContainEqual({
      collectionGroup: 'learning',
      queryScope: 'COLLECTION_GROUP',
      fields: [
        { fieldPath: 'day', order: 'ASCENDING' },
        { fieldPath: 'at', order: 'ASCENDING' },
      ],
    });
    for (const field of ['at', 'day']) {
      const override = indexes.fieldOverrides.find((o) => o.collectionGroup === 'learning' && o.fieldPath === field);
      expect(override?.indexes, field).toEqual([
        { order: 'ASCENDING', queryScope: 'COLLECTION' },
        { order: 'DESCENDING', queryScope: 'COLLECTION' },
        { arrayConfig: 'CONTAINS', queryScope: 'COLLECTION' },
        { order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' },
      ]);
    }
    expect(readFileSync('scripts/deploy.mjs', 'utf8')).toContain("'hosting,firestore:rules,firestore:indexes'");
  });
});
