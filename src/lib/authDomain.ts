/**
 * Which domain Google sign-in runs on (2026-11-08, the site audit's batch SH,
 * item 98). Prepared, and off until the owner's console step is done.
 *
 * Firebase's default `authDomain` is `forma-201ba.firebaseapp.com`, so the
 * Google pop-up names that address, not the site the person is on, and a
 * redirect sign-in (the fallback when a browser blocks pop-ups) would need
 * storage on that other domain, which browsers increasingly refuse. Firebase
 * Hosting serves the same sign-in handler at `/__/auth/` on each of the
 * project's own sites, so `authDomain` can be the site itself, once Google's
 * OAuth client accepts that site's handler as a redirect.
 *
 * The owner's step: Google Cloud console, APIs & Services, Credentials, the
 * web client Firebase made, Authorised redirect URIs: add
 * `https://openforma.web.app/__/auth/handler` and
 * `https://forma-201ba.web.app/__/auth/handler`. Then list those hosts here.
 * Until then the list is empty and sign-in is exactly as it was.
 */
export const OWN_AUTH_HOSTS: readonly string[] = [];

/** The `authDomain` for a page on `hostname`: the page's own host when it is listed, else the default. */
export function authDomainFor(hostname: string | undefined, fallback: string, hosts: readonly string[] = OWN_AUTH_HOSTS): string {
  return hostname && hosts.includes(hostname) ? hostname : fallback;
}

/** Whether a redirect sign-in can come back to this page: only when sign-in runs on the page's own host. */
export function canRedirectSignIn(authDomain: string, hostname: string | undefined): boolean {
  return !!hostname && authDomain === hostname;
}
