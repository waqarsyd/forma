/**
 * Sign-in's domain and App Check, both prepared and off until the owner's
 * console steps are done (2026-11-08, site audit items 98 and 56).
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
     script and frame, and its token exchange, enter the CSP with it, and
     nothing else does. Sign-in's own hosts are still unlisted. */
  it('App Check is on, with exactly its origins in the CSP; sign-in still on the default host', () => {
    expect(OWN_AUTH_HOSTS).toEqual([]);
    expect(APP_CHECK_SITE_KEY).toMatch(/^6L[\w-]{38}$/);
    const csp = buildContentSecurityPolicy(false);
    expect(csp).toMatch(/script-src [^;]*https:\/\/www\.google\.com\/recaptcha\/ https:\/\/www\.gstatic\.com\/recaptcha\//);
    expect(csp).toMatch(/frame-src [^;]*https:\/\/www\.google\.com\/recaptcha\/ https:\/\/recaptcha\.google\.com\/recaptcha\//);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/content-firebaseappcheck\.googleapis\.com/);
    expect(csp).toMatch(/frame-src https:\/\/\*\.firebaseapp\.com/);
  });
});
