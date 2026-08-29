/**
 * The response headers `server.ts` sends, as data.
 *
 * The server sent none of these until the 2026-08-27 audit (SEC-001), which is
 * defensible for a browser-only app right up until it is public: `/login` and
 * `/signup` render a sign-in form with no framing policy, and the workspace
 * renders model-generated markdown while a live Gemini key sits in
 * `sessionStorage`. React's escaping is currently the only thing between a
 * future mistake there and that key leaving the machine.
 *
 * They live here rather than inline in `server.ts` for one reason: a header set
 * that is an object can be asserted, and a series of `res.setHeader` calls
 * inside a listener cannot. `server.ts` has no test and is awkward to give one
 * -- it binds a port on import -- so the testable part is separated out and the
 * file keeps only the wiring.
 *
 * ## What is deliberately not here
 *
 * **`Content-Security-Policy`.** It is the header this app would benefit from
 * most and the one most likely to break it silently, so it is a considered
 * change rather than a line added in passing. Whoever adds it needs to
 * allowlist, at minimum: `fonts.googleapis.com` and `fonts.gstatic.com` for the
 * two stylesheets in `index.html` (or self-host the fonts and drop both --
 * audit PERF-002), `generativelanguage.googleapis.com` for the browser-side
 * Gemini call, the Firebase Auth and Firestore endpoints, `formsubmit.co` for
 * the contact form, and -- the one that will be forgotten -- `connect-src
 * http://127.0.0.1:7317` for the designer companion, which is a loopback fetch
 * from a page served over a different origin. Ship it `Content-Security-Policy-
 * Report-Only` first and read the reports before enforcing.
 */

/**
 * Sent on every response, over any scheme.
 *
 * `X-Frame-Options: DENY` rather than `SAMEORIGIN`: nothing in this app frames
 * anything of its own, so the stricter value costs nothing and the looser one
 * would be a guess about a future need.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Only the features worth naming. An exhaustive list ages badly -- browsers
  // add features faster than this file gets revisited -- and these three are
  // the ones a report designer has no business asking for.
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
});

export interface SecurityHeaderOptions {
  /**
   * Is this deployment actually terminating TLS?
   *
   * HSTS over plain HTTP is worse than absent. A browser that receives it on
   * `http://localhost` will refuse plain-HTTP localhost for the whole max-age,
   * which breaks every other project on that machine and is remembered long
   * after the header is taken away again. So it is opt-in, and the opt-in
   * belongs to the deployment rather than to this file.
   */
  https?: boolean;
}

/** One year, with subdomains. The usual value; not preload, which is one-way. */
const HSTS = 'max-age=31536000; includeSubDomains';

/**
 * The headers for a given deployment. Returns a fresh object each call, so a
 * caller that mutates the result cannot reach into the shared table.
 */
export function securityHeadersFor(options: SecurityHeaderOptions = {}): Record<string, string> {
  const headers: Record<string, string> = { ...SECURITY_HEADERS };
  if (options.https) headers['Strict-Transport-Security'] = HSTS;
  return headers;
}
