/**
 * Which domain Google sign-in runs on (2026-11-08, the site audit's batch SH,
 * item 98). On since 2026-11-12 for the two web.app sites.
 *
 * Firebase's default `authDomain` is `forma-201ba.firebaseapp.com`, so the
 * Google pop-up names that address, not the site the person is on, and a
 * redirect sign-in (the fallback when a browser blocks pop-ups) would need
 * storage on that other domain, which browsers increasingly refuse. Firebase
 * Hosting serves the same sign-in handler at `/__/auth/` on each of the
 * project's own sites, so `authDomain` can be the site itself, once Google's
 * OAuth client accepts that site's handler as a redirect.
 *
 * The console step this waited for (Google Cloud console, APIs & Services,
 * Credentials, the web client Firebase made, Authorised redirect URIs) was
 * found already done on 2026-11-12: Google answers an authorisation request
 * from that client for `https://openforma.web.app/__/auth/handler` or
 * `https://forma-201ba.web.app/__/auth/handler` with its sign-in page, and one
 * for any other path on the same hosts with `redirect_uri_mismatch`. Firebase
 * adds an authorised domain's handler to the client it made. Both sites'
 * `/__/auth/` pages are Firebase's own, served without this site's CSP,
 * X-Frame-Options or COOP, so nothing here stands in their way.
 *
 * A host added to this list needs the same check first, or Google sign-in on
 * it fails with `redirect_uri_mismatch`. The firebaseapp.com twins are not
 * listed and keep the default, as does every other host, a fork's included.
 */
export const OWN_AUTH_HOSTS: readonly string[] = ['openforma.web.app', 'forma-201ba.web.app'];

/** The `authDomain` for a page on `hostname`: the page's own host when it is listed, else the default. */
export function authDomainFor(hostname: string | undefined, fallback: string, hosts: readonly string[] = OWN_AUTH_HOSTS): string {
  return hostname && hosts.includes(hostname) ? hostname : fallback;
}

/** Whether a redirect sign-in can come back to this page: only when sign-in runs on the page's own host. */
export function canRedirectSignIn(authDomain: string, hostname: string | undefined): boolean {
  return !!hostname && authDomain === hostname;
}
