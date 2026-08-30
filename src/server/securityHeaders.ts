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
 * ## Content-Security-Policy
 *
 * Added 2026-08-30, ahead of making this repository public. The paragraph that
 * stood here previously listed what a CSP would have to allowlist and deferred
 * the work; the note above is why deferring stopped being reasonable. This app
 * holds a live third-party API key in `sessionStorage` and renders
 * model-generated markdown a few components away from it. Without a CSP the
 * only thing standing between an injection and that key reaching an attacker's
 * server is React's escaping -- one contributor's `dangerouslySetInnerHTML`, or
 * one compromised transitive dependency, and it is gone.
 *
 * **`connect-src` is the directive that matters** and the reason this exists.
 * Everything else is hardening; `connect-src` is what makes exfiltration fail
 * even if injection succeeds, because a stolen key is worthless to script that
 * cannot post it anywhere. Read any change to that list as a change to the
 * app's central security claim, and add an origin to it only knowing that.
 *
 * `script-src` carries no `'unsafe-inline'` in production. `index.html` has
 * exactly one inline script -- the pre-paint theme resolver, which must stay
 * inline to do its job -- so it is allowed by SHA-256 hash instead. That hash
 * is a constant here and the script lives in another file, which is a drift
 * risk with a silent failure mode: a blocked theme script does not throw, it
 * just restores the flash of light theme it exists to prevent. So
 * `securityHeaders.test.ts` recomputes it from `index.html` and fails if the
 * two disagree, in the same read-the-file-off-disk style as
 * `legalDisclosure.test.ts` and `routes.test.ts`.
 *
 * Development needs a looser policy and gets one, gated on an explicit flag
 * rather than inferred: Vite injects its HMR client and React Fast Refresh
 * preamble as inline script, and its transform pipeline needs `eval`. Both
 * relaxations are confined to the dev server, which binds to loopback
 * (`bindHost.ts`), so they are never reachable from another machine.
 */

/**
 * SHA-256 of the inline theme script in `index.html`, base64, as CSP wants it.
 *
 * Regenerate after editing that script -- the test tells you the new value.
 * It covers the bytes between `<script>` and `</script>` exactly, whitespace
 * and all, so even a re-indent changes it.
 */
export const THEME_SCRIPT_HASH = "'sha256-RswoUqjMy7el2m555ElIwd42BKWUQv8ssqXpJL6feXQ='";

/**
 * Where the browser is allowed to send data. The exfiltration boundary.
 *
 *   generativelanguage  the browser-side Gemini call -- the whole point of the
 *                       bring-your-own-key design is that the key goes here and
 *                       nowhere else
 *   identitytoolkit     Firebase Auth sign-in, sign-up, password reset
 *   securetoken         Firebase Auth ID-token refresh
 *   firestore           saved reports and the encrypted key vault
 *   googleapis (www)    the Firebase SDK's installations/config calls
 *   formsubmit.co       the contact form, which posts a name, an email and a
 *                       message and nothing else -- see contactSubmit.ts
 *   127.0.0.1:7317      the RepxDesigner companion. Loopback, plain http, and a
 *                       cross-origin fetch from a page served elsewhere, so it
 *                       needs naming explicitly or "Open in designer" silently
 *                       stops working. This is the one everybody forgets.
 */
const CONNECT_SRC = [
  "'self'",
  'https://generativelanguage.googleapis.com',
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
  'https://firestore.googleapis.com',
  'https://www.googleapis.com',
  'https://formsubmit.co',
  'http://127.0.0.1:7317',
];

/**
 * The policy, as directive -> source list.
 *
 * `style-src` keeps `'unsafe-inline'`, and that is not laziness: Framer Motion
 * animates by writing the `style` attribute on every frame, which CSP counts as
 * an inline style. Removing it would mean removing the animation library. Style
 * injection is a far weaker primitive than script injection, and `connect-src`
 * still bounds what any of it could send.
 *
 * `*.firebaseapp.com` in `frame-src` is a wildcard on purpose: the auth domain
 * is per-project and this app is documented as bring-your-own-Firebase, so
 * pinning `forma-201ba` here would break every fork that followed the README.
 */
function directives(development: boolean): Record<string, string[]> {
  return {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    // Belt and braces with X-Frame-Options above: that header is what old
    // browsers honour, this directive is what current ones actually read.
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'", 'https://formsubmit.co'],
    'script-src': development
      ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
      : ["'self'", THEME_SCRIPT_HASH],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
    // data: for uploaded screenshots and the model's own image crops; blob: for
    // the object URLs App.tsx creates when previewing a file.
    'img-src': ["'self'", 'data:', 'blob:'],
    // pdf.js runs its parser in a worker, bundled same-origin by Vite.
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'media-src': ["'self'", 'blob:', 'data:'],
    // signInWithPopup opens a window rather than a frame, but the Firebase Auth
    // SDK also mounts a hidden iframe on the auth domain to carry the result.
    'frame-src': ['https://*.firebaseapp.com', 'https://accounts.google.com'],
    // The HMR socket is NOT on the server's port. Vite in middleware mode opens
    // its own listener -- 24678 by default -- and `vite.config.ts` passes `hmr`
    // as a boolean, so there is no port here to read even if we wanted one.
    // Naming 3000 blocked every hot reload while the pages still rendered
    // perfectly, which is the worst shape a bug can have: nothing looks broken
    // until you edit a file and nothing happens.
    //
    // So the port is wildcarded rather than guessed. Still loopback, still
    // development only, and now immune to Vite moving its default.
    'connect-src': development
      ? [...CONNECT_SRC, 'ws://localhost:*', 'ws://127.0.0.1:*']
      : CONNECT_SRC,
  };
}

/** Serialise to the header's `name a b; name c` form. */
export function buildContentSecurityPolicy(development = false): string {
  return Object.entries(directives(development))
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

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
  /**
   * Loosen `script-src` and `connect-src` for Vite's HMR client and its
   * `eval`-based transform. Explicit rather than read from NODE_ENV here, so
   * the relaxation is a decision the caller makes and a test can pin.
   */
  development?: boolean;
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
  headers['Content-Security-Policy'] = buildContentSecurityPolicy(options.development === true);
  return headers;
}
