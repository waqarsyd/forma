/**
 * Firebase App Check (2026-11-08, the site audit's batch SH, item 56).
 * Prepared, and off until the owner sets the key below.
 *
 * Without it any program holding the public Firebase key can call the
 * database's REST API as if it were this site: sign up, write, read link
 * shares. App Check has each request carry a token that only a page served by
 * this site can obtain, here from reCAPTCHA v3, which is free. With the key
 * set, the token is fetched only where the database is used (signed in, or a
 * shared report opened), never on a public page read signed out.
 *
 * The owner's steps, in order:
 * 1. Create a reCAPTCHA v3 key at https://www.google.com/recaptcha/admin for
 *    openforma.web.app, forma-201ba.web.app and localhost.
 * 2. Firebase console, App Check: register the web app with that key's
 *    secret, as the reCAPTCHA (not Enterprise) provider.
 * 3. Put the site key below and deploy. The CSP gains reCAPTCHA's origins
 *    (src/server/securityHeaders.ts) and the privacy policy names it, both
 *    from this same constant.
 * 4. Watch App Check's metrics for a week, then turn enforcement on for
 *    Firestore. Enforcing before step 3 has reached every visitor locks them
 *    out of their saved projects.
 */
export const APP_CHECK_SITE_KEY = '';

/** What the CSP must allow once the key is set: reCAPTCHA's script and frame, and App Check's token exchange. */
export const APP_CHECK_ORIGINS = {
  script: ['https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'],
  frame: ['https://www.google.com/recaptcha/', 'https://recaptcha.google.com/recaptcha/'],
  connect: ['https://content-firebaseappcheck.googleapis.com'],
} as const;

/** Starts App Check for the app once, when the key is set; nothing otherwise. */
let started: Promise<void> | null = null;
export function startAppCheck(app: import('firebase/app').FirebaseApp): Promise<void> {
  if (!APP_CHECK_SITE_KEY) return Promise.resolve();
  if (!started) {
    started = import('firebase/app-check').then(({ initializeAppCheck, ReCaptchaV3Provider }) => {
      initializeAppCheck(app, { provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
    });
  }
  return started;
}
