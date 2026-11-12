/**
 * Sign-in's domain and App Check (2026-11-08, site audit items 98 and 56):
 * App Check on since 2026-11-08, sign-in on the sites' own hosts since
 * 2026-11-12.
 */
import { describe, expect, it } from 'vitest';
import { authDomainFor, canRedirectSignIn, OWN_AUTH_HOSTS } from './authDomain';
import { APP_CHECK_SITE_KEY } from './appCheck';
import { buildContentSecurityPolicy } from '../server/securityHeaders';

describe('authDomainFor', () => {
  it('keeps the default until a host is listed, then uses the page\'s own host', () => {
    expect(authDomainFor('openforma.web.app', 'forma-201ba.firebaseapp.com', [])).toBe('forma-201ba.firebaseapp.com');
    expect(authDomainFor('openforma.web.app', 'forma-201ba.firebaseapp.com', ['openforma.web.app'])).toBe('openforma.web.app');
    expect(authDomainFor('localhost', 'forma-201ba.firebaseapp.com', ['openforma.web.app'])).toBe('forma-201ba.firebaseapp.com');
    expect(authDomainFor(undefined, 'forma-201ba.firebaseapp.com', ['openforma.web.app'])).toBe('forma-201ba.firebaseapp.com');
  });

  it('allows a redirect sign-in only where it can come back with the session', () => {
    expect(canRedirectSignIn('openforma.web.app', 'openforma.web.app')).toBe(true);
    expect(canRedirectSignIn('forma-201ba.firebaseapp.com', 'openforma.web.app')).toBe(false);
  });
});

describe('what is on today, and the policy says no more than that', () => {
  /* App Check since 2026-11-08, when the owner created the reCAPTCHA key: its
     script and frame, and its token exchange, enter the CSP with it. Sign-in
     on the two web.app sites' own hosts since 2026-11-12, once Google's OAuth
     client was found to accept both handlers: 'self' enters frame-src with it,
     for the /__/auth/ iframe, and nothing else does. */
  it("App Check and sign-in on the sites' own hosts are on, each with exactly its sources in the CSP", () => {
    expect(OWN_AUTH_HOSTS).toEqual(['openforma.web.app', 'forma-201ba.web.app']);
    expect(APP_CHECK_SITE_KEY).toMatch(/^6L[\w-]{38}$/);
    const csp = buildContentSecurityPolicy(false);
    expect(csp).toMatch(/script-src [^;]*https:\/\/www\.google\.com\/recaptcha\/ https:\/\/www\.gstatic\.com\/recaptcha\//);
    expect(csp).toMatch(/frame-src [^;]*https:\/\/www\.google\.com\/recaptcha\/ https:\/\/recaptcha\.google\.com\/recaptcha\//);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/content-firebaseappcheck\.googleapis\.com/);
    expect(csp).toMatch(/frame-src 'self' https:\/\/\*\.firebaseapp\.com/);
    expect(csp).toMatch(/connect-src 'self' https:\/\/generativelanguage/);
  });
});
