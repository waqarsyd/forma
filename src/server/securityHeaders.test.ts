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
import { SECURITY_HEADERS, securityHeadersFor } from './securityHeaders';

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
});
