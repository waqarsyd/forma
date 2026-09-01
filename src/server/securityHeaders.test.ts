/**
 * The response headers are a security control, so they are pinned rather than
 * eyeballed once.
 *
 * The audit (SEC-001) found the server sending no security headers at all and
 * advertising `X-Powered-By: Express`. Three of the missing ones are
 * load-bearing for this app specifically: `/login` and `/signup` render a
 * sign-in form and had no framing policy, the workspace renders
 * model-generated markdown while holding a live API key in `sessionStorage`,
 * and outbound links leaked the full referring URL.
 *
 * Testing this at all requires the header set to be data rather than a series
 * of `res.setHeader` calls buried in a listener, which is why
 * `securityHeaders.ts` exists as its own module. That shape is also what makes
 * the CSP question tractable later: a policy is a string in a table, not an
 * edit to `server.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  SECURITY_HEADERS,
  securityHeadersFor,
  buildContentSecurityPolicy,
  THEME_SCRIPT_HASH,
} from './securityHeaders';

/** Parse a policy string back into directive -> sources, for asserting on. */
const parse = (csp: string): Record<string, string[]> =>
  Object.fromEntries(
    csp.split(';').map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );

describe('SECURITY_HEADERS', () => {
  it('blocks MIME sniffing', () => {
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
  });

  it('refuses framing outright, because the app renders a sign-in form', () => {
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
  });

  it('does not leak the full URL to third parties on outbound links', () => {
    // `no-referrer` would also pass a naive check but breaks same-origin
    // analytics and some CDNs; strict-origin-when-cross-origin is the value
    // that keeps the path internal and sends only the origin outward.
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('turns off device APIs the app never uses', () => {
    const policy = SECURITY_HEADERS['Permissions-Policy'];
    for (const feature of ['camera', 'microphone', 'geolocation']) {
      expect(policy).toContain(`${feature}=()`);
    }
  });

  it('does not advertise the server framework', () => {
    // Express sets this itself; the fix is `app.disable('x-powered-by')`, so
    // what is asserted here is that we are not adding it back.
    const names = Object.keys(SECURITY_HEADERS).map((n) => n.toLowerCase());
    expect(names).not.toContain('x-powered-by');
  });
});

describe('securityHeadersFor', () => {
  /**
   * HSTS over plain HTTP is not merely useless, it is a trap: a browser that
   * receives it on `http://localhost` will refuse plain-HTTP localhost for the
   * max-age, which breaks every other project on the machine. It is therefore
   * opt-in on the deployment actually terminating TLS.
   */
  it('omits HSTS by default', () => {
    expect(securityHeadersFor({})).not.toHaveProperty('Strict-Transport-Security');
  });

  it('adds HSTS only when TLS is declared', () => {
    const headers = securityHeadersFor({ https: true });
    expect(headers['Strict-Transport-Security']).toMatch(/max-age=\d+/);
  });

  it('carries the base set through either way', () => {
    for (const options of [{}, { https: true }]) {
      const headers = securityHeadersFor(options);
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['X-Frame-Options']).toBe('DENY');
    }
  });

  it('returns a fresh object so a caller cannot mutate the shared table', () => {
    const headers = securityHeadersFor({});
    headers['X-Frame-Options'] = 'SAMEORIGIN';
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
  });

  it('always sends a CSP, in either mode', () => {
    for (const options of [{}, { development: true }, { https: true }]) {
      expect(securityHeadersFor(options)['Content-Security-Policy']).toContain('default-src');
    }
  });
});

/**
 * The CSP is the control that makes the app's central claim true -- that a
 * user's Gemini key cannot leave their machine. `connect-src` is the part
 * doing that work: injected script can read `sessionStorage` whatever we do,
 * but it cannot post what it reads to an origin the policy does not name.
 *
 * So these tests are deliberately about *absence*: no wildcard, no
 * `'unsafe-inline'` on script in production, no attacker-controlled origin.
 */
describe('buildContentSecurityPolicy', () => {
  const prod = parse(buildContentSecurityPolicy(false));
  const dev = parse(buildContentSecurityPolicy(true));

  it('locks the exfiltration boundary to a known list', () => {
    // The assertion that matters. If this list ever grows, it should be
    // because someone decided to send user data somewhere new.
    expect(prod['connect-src']).toEqual([
      "'self'",
      'https://generativelanguage.googleapis.com',
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com',
      'https://firestore.googleapis.com',
      'https://www.googleapis.com',
      'https://formsubmit.co',
      'http://127.0.0.1:7317',
    ]);
  });

  /**
   * Google sign-in was broken for the entire life of this policy and no test
   * noticed, because every test here read the header and none of them clicked
   * the button.
   *
   * `signInWithPopup` loads `https://apis.google.com/js/api.js` — the gapi relay
   * that carries the OAuth result back from the auth domain — before it opens
   * anything. `frame-src` already named the popup and the iframe, so the policy
   * *looked* complete; the script was blocked by `script-src`, and Firebase
   * reported the failure as `auth/internal-error`, which reads like a console
   * misconfiguration rather than a header of ours.
   *
   * Both environments are asserted. The dev policy is looser everywhere else, so
   * it would be easy to assume it is covered — it is not, `'unsafe-inline'` says
   * nothing about which *origins* may serve a script, and the bug reproduces in
   * development exactly as in production.
   */
  it('lets the Firebase auth helper load, or Google sign-in dies', () => {
    for (const [name, policy] of [['production', prod], ['development', dev]] as const) {
      expect(
        policy['script-src'],
        `${name}: script-src must allow https://apis.google.com. Without it ` +
          `signInWithPopup fails with auth/internal-error and the Google button ` +
          `does nothing — verified as "script-src-elem <- ` +
          `https://apis.google.com/js/api.js".`
      ).toContain('https://apis.google.com');
    }
  });

  it('does not open script-src to anything wider than that one origin', () => {
    for (const policy of [prod, dev]) {
      expect(policy['script-src']).not.toContain('*');
      expect(policy['script-src']).not.toContain('https:');
      // 'unsafe-inline' is a development-only relaxation; production carries the
      // theme script's hash instead. This pins that split.
      expect(prod['script-src']).not.toContain("'unsafe-inline'");
      expect(prod['script-src']).not.toContain("'unsafe-eval'");
    }
  });

  it('never allows connecting to an arbitrary origin', () => {
    for (const policy of [prod, dev]) {
      expect(policy['connect-src']).not.toContain('*');
      expect(policy['connect-src']).not.toContain('https:');
      expect(policy['connect-src']).not.toContain('http:');
    }
  });

  it('keeps the designer companion reachable', () => {
    // Loopback, plain http, cross-origin. Omitting it breaks "Open in
    // designer" silently -- the fetch just never resolves.
    expect(prod['connect-src']).toContain('http://127.0.0.1:7317');
  });

  it('runs no inline or eval script in production', () => {
    expect(prod['script-src']).not.toContain("'unsafe-inline'");
    expect(prod['script-src']).not.toContain("'unsafe-eval'");
  });

  it('relaxes script only for the dev server, which binds to loopback', () => {
    expect(dev['script-src']).toContain("'unsafe-inline'");
    expect(dev['script-src']).toContain("'unsafe-eval'");
    // ...and the HMR socket, which is the other thing Vite needs.
    expect(dev['connect-src'].some((s) => s.startsWith('ws://'))).toBe(true);
    expect(prod['connect-src'].some((s) => s.startsWith('ws://'))).toBe(false);
  });

  /**
   * Regression: the first version of this policy allowed `ws://localhost:3000`,
   * reasoning that the HMR socket shares the server's port. It does not -- Vite
   * in middleware mode opens its own listener, 24678 by default. Every hot
   * reload was blocked while every page still rendered correctly, so nothing
   * looked wrong until you edited a file and waited.
   *
   * `vite.config.ts` passes `hmr` as a boolean, so there is no port to read
   * here. Wildcarding it is the fix; pinning any number reintroduces the bug the
   * next time Vite changes its default.
   */
  it('does not pin the HMR socket to a port it cannot know', () => {
    const sockets = dev['connect-src'].filter((s) => s.startsWith('ws://'));
    expect(sockets.length).toBeGreaterThan(0);
    for (const s of sockets) {
      expect(s).toMatch(/:\*$/);
      // Loopback only -- a wildcard port must not come with a wildcard host.
      expect(s).toMatch(/^ws:\/\/(localhost|127\.0\.0\.1):/);
    }
  });

  it('forbids plugins and rebasing, and refuses to be framed', () => {
    expect(prod['object-src']).toEqual(["'none'"]);
    expect(prod['base-uri']).toEqual(["'self'"]);
    expect(prod['frame-ancestors']).toEqual(["'none'"]);
  });

  it('lets the contact form post only to the endpoint it documents', () => {
    expect(prod['form-action']).toEqual(["'self'", 'https://formsubmit.co']);
  });

  it('names no third-party origin for fonts or styles', () => {
    // The families are self-hosted (src/index.css). Re-adding either Google
    // origin would hand every visitor's IP and Referer back to a third party on
    // page load, which is a privacy change, not a styling one.
    expect(prod['style-src'].join(' ')).not.toContain('fonts.googleapis.com');
    expect(prod['font-src'].join(' ')).not.toContain('fonts.gstatic.com');
    expect(prod['font-src']).toEqual(["'self'", 'data:']);
  });

  it('allows the pdf.js worker and the object URLs App.tsx creates', () => {
    expect(prod['worker-src']).toContain('blob:');
    expect(prod['img-src']).toContain('blob:');
    expect(prod['img-src']).toContain('data:');
  });

  it('does not pin the Firebase auth domain to one project', () => {
    // The README documents bringing your own Firebase project, so a literal
    // `forma-201ba.firebaseapp.com` here would break every fork that followed
    // it -- and the failure would be an auth popup that does nothing.
    expect(prod['frame-src']).toContain('https://*.firebaseapp.com');
    expect(prod['frame-src'].join(' ')).not.toContain('forma-201ba');
  });
});

/**
 * `index.html`'s theme script must run before first paint, so it cannot move to
 * a module -- it is allowed by hash instead of `'unsafe-inline'`. The hash is a
 * constant in `securityHeaders.ts` and the script is in another file, which
 * fails silently when they drift: a blocked theme script throws nothing, it
 * just brings back the flash of light theme it exists to prevent.
 *
 * Reading `index.html` off disk is how `routes.test.ts` and
 * `legalDisclosure.test.ts` already pin facts that live in that file.
 */
describe('the inline theme script hash', () => {
  const html = readFileSync('index.html', 'utf8');
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];

  it('finds exactly one inline script to account for', () => {
    // A second one would be silently blocked in production: the policy allows
    // one hash and nothing else.
    expect(inline).toHaveLength(1);
  });

  it('matches what index.html actually contains', () => {
    const digest = createHash('sha256').update(inline[0][1], 'utf8').digest('base64');
    expect(THEME_SCRIPT_HASH).toBe(`'sha256-${digest}'`);
  });

  it('is the hash the production policy sends', () => {
    expect(parse(buildContentSecurityPolicy(false))['script-src']).toContain(THEME_SCRIPT_HASH);
  });
});
