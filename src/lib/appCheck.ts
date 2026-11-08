/**
 * Firebase App Check (2026-11-08, the site audit's batch SH, item 56).
 * On since 2026-11-08 (release 1.1.1), with the reCAPTCHA Enterprise
 * provider; enforcement (step 3) waits on a week of metrics.
 *
 * Without it any program holding the public Firebase key can call the
 * database's REST API as if it were this site: sign up, write, read link
 * shares. App Check has each request carry a token that only a page served by
 * this site can obtain, here from reCAPTCHA. With the key set, the token is
 * fetched only where the database is used (signed in, or a shared report
 * opened), never on a public page read signed out.
 *
 * Enterprise, not v3 (the same day): this was written for the reCAPTCHA v3
 * provider, which registers the key's secret, and the Firebase console now
 * steers a new registration to reCAPTCHA Enterprise, as Firebase's own docs
 * do ("You should use reCAPTCHA Enterprise for new integrations"). The owner
 * registered the app there, so the v3 provider's tokens were refused (403)
 * until this switched. Enterprise registers the key itself, no secret; a key
 * made in the reCAPTCHA admin inside the project's Cloud project serves as
 * one. Free up to reCAPTCHA's no-cost monthly allowance (10,000 assessments
 * when this was written); a project without billing gets errors past it,
 * which with enforcement on would lock people out, so watch the count.
 *
 * The owner's steps, in order:
 * 1. A score-based Web key (no checkbox challenge) in the Firebase project's
 *    own Cloud project, for openforma.web.app and forma-201ba.web.app. Firebase
 *    advises against localhost on a production key: take it off before step 3,
 *    and use App Check's debug provider for local work after that.
 * 2. Firebase console, App Check, Apps: register the web app with the
 *    reCAPTCHA Enterprise provider and that key, then put the key below and
 *    deploy. The CSP gains reCAPTCHA's origins (src/server/securityHeaders.ts)
 *    and the privacy policy names it, both from this same constant.
 * 3. Watch App Check's metrics for a week, then turn enforcement on for
 *    Firestore. Enforcing before step 2 has reached every visitor locks them
 *    out of their saved projects.
 */
// Created by the owner on 2026-11-08 in the Forma-Dev project (forma-201ba). A
// reCAPTCHA key is public by design: every page that uses it carries it.
export const APP_CHECK_SITE_KEY = '6LdJrhYuAAAAAEuymM54-Xzf0YbXljEetcJ6GxIV';

/** What the CSP must allow once the key is set: reCAPTCHA's script and frame, and App Check's token exchange. */
export const APP_CHECK_ORIGINS = {
  // enterprise.js and its frames live under /recaptcha/ on both hosts.
  script: ['https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'],
  frame: ['https://www.google.com/recaptcha/', 'https://recaptcha.google.com/recaptcha/'],
  // reCAPTCHA's own script also posts under /recaptcha/ from the page, which
  // the CSP refused when the key was first set (2026-11-08); a refused call
  // can lower its score, and App Check turns a low score away.
  connect: ['https://content-firebaseappcheck.googleapis.com', 'https://www.google.com/recaptcha/'],
} as const;

/** Starts App Check for the app once, when the key is set; nothing otherwise. */
let started: Promise<void> | null = null;
export function startAppCheck(app: import('firebase/app').FirebaseApp): Promise<void> {
  if (!APP_CHECK_SITE_KEY) return Promise.resolve();
  if (!started) {
    started = import('firebase/app-check').then(({ initializeAppCheck, ReCaptchaEnterpriseProvider }) => {
      initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
    });
  }
  return started;
}
