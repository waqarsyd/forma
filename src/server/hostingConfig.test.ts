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
 * ## What is deliberately NOT mirrored
 *
 * `server.ts` returns **404** for a stale `/assets/*` hash rather than falling
 * through to `index.html`. Firebase Hosting cannot express that: its rewrites
 * always answer 200 and there is no "404 this pattern" on the free plan. The
 * difference is accepted rather than hidden, and it is small because
 * `index.html` is `no-cache` — a returning visitor revalidates the document
 * before it can ever ask for a chunk that has been deleted. Cloudflare Pages
 * *can* express it, with an `/assets/*` rule above the SPA catch-all, if this
 * ever moves.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { securityHeadersFor } from './securityHeaders';
import { IMMUTABLE, REVALIDATE } from './staticCache';

/** Read off disk rather than imported, so the committed file is what is tested. */
const config = JSON.parse(readFileSync('firebase.json', 'utf8'));

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };

const rules: HeaderRule[] = config.hosting?.headers ?? [];
const ruleFor = (source: string) => rules.find((r) => r.source === source);
const asMap = (rule: HeaderRule | undefined) =>
  Object.fromEntries((rule?.headers ?? []).map((h) => [h.key, h.value]));

describe('firebase.json hosting', () => {
  it('exists at all, with dist as the public directory', () => {
    expect(config.hosting, 'no hosting block in firebase.json').toBeTruthy();
    expect(config.hosting.public).toBe('dist');
  });

  /*
   * The SPA fallback. Every route in this app is a real path (see lib/router),
   * so a deep link to /docs must serve index.html rather than 404.
   */
  it('serves index.html for any path, so deep links work', () => {
    expect(config.hosting.rewrites).toEqual([{ source: '**', destination: '/index.html' }]);
  });

  it('sends exactly the security headers this codebase builds, with HSTS', () => {
    // https: true because Firebase Hosting always terminates TLS. That is the
    // condition securityHeaders.ts requires before HSTS may be sent at all.
    const expected = securityHeadersFor({ https: true });
    const actual = asMap(ruleFor('**'));

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

  it('carries the same cache policy staticCache.ts applies', () => {
    expect(asMap(ruleFor('/assets/**'))['Cache-Control']).toBe(IMMUTABLE);
    expect(asMap(ruleFor('/index.html'))['Cache-Control']).toBe(REVALIDATE);
  });

  /*
   * The one that would be easy to lose. index.html must NOT inherit the
   * immutable policy: it names the current hashed bundle, so a hard-cached copy
   * pins a visitor to an old deploy with no way to reach them.
   */
  it('never lets index.html be cached immutably', () => {
    const indexPolicy = asMap(ruleFor('/index.html'))['Cache-Control'] ?? '';
    expect(indexPolicy).not.toMatch(/immutable/);
    expect(indexPolicy).not.toMatch(/max-age=[1-9]/);
  });

  it('keeps the emulator and rules config the other suites depend on', () => {
    expect(config.firestore?.rules).toBe('firestore.rules');
    expect(config.emulators?.firestore?.port).toBe(8080);
  });
});
