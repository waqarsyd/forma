/**
 * What each route *means* — its document title, and the view state it implies.
 *
 * Extracted from `App.tsx` on 2026-08-16 for the same reason `repx.ts` and
 * `sourceRect.ts` were: both halves are pure, both had failure modes that render
 * a page rather than throwing, and neither could be reached by a test while it
 * sat inside a component that imports pdf.js and Firebase.
 *
 * This is deliberately *not* in `router.ts`. That file holds routing mechanics —
 * `currentPath`, `navigate`, the legacy-hash migration — and is title-free on
 * purpose; copy and app view state do not belong in it.
 */

import { ROUTES } from './router';

/**
 * Per-route document titles.
 *
 * `index.html` can only carry one title, so every route used to show the home
 * page's — a browser with six Forma tabs open showed six identical ones, and a
 * bookmark or history entry recorded nothing about which page it came from.
 *
 * Two things here are deliberate:
 *
 * 1. **`/` must stay byte-identical to the `<title>` in `index.html`.** That tag
 *    is what search engines and link-preview scrapers read (they do not run this
 *    code), and it is also what paints before the bundle loads. Any difference
 *    would rewrite the title a moment after first paint for no reason. If you
 *    change one, change both — same rule as the theme bootstrap. `routes.test.ts`
 *    now reads `index.html` and asserts it, so this is enforced rather than
 *    remembered.
 *
 * 2. **The page name leads, the brand trails.** Tab strips truncate the end, so
 *    "Docs — Forma" survives being narrowed to a favicon-plus-two-words while
 *    "Forma — Docs" degrades to "Forma…" on every tab. The names match the
 *    header nav and the login page's own tab labels rather than inventing
 *    synonyms.
 *
 * An unrecognised path falls back to `/`, which is what `viewForRoute` renders
 * for the same input.
 */
export const ROUTE_TITLES: Record<string, string> = {
  '/': 'Forma — Screenshot to DevExpress .repx',
  '/features': 'Features — Forma',
  '/docs': 'Docs — Forma',
  '/contact': 'Contact — Forma',
  '/changelog': 'Changelog — Forma',
  '/login': 'Sign in — Forma',
  '/signup': 'Create account — Forma',
  '/workspace': 'Workspace — Forma',
  '/terms': 'Terms of use — Forma',
  '/privacy': 'Privacy policy — Forma',
  '/accessibility': 'Accessibility — Forma',
  '/security': 'Security — Forma',
  '/pricing': 'Pricing — Forma',
  '/examples': 'Examples — Forma',
  '/compare': 'Compare and migrate — Forma',
  '/about': 'About — Forma',
  '/self-host': 'Self-hosting — Forma',
  '/download': 'Download Forma Designer — Forma',
  '/faq': 'FAQ — Forma',
};

/**
 * Shown when the path is not a route. Named rather than borrowing the home
 * page's, so a tab, a bookmark and a history entry all say what happened.
 */
export const NOT_FOUND_TITLE = 'Page not found — Forma';

/**
 * The share id a path names, `/s/{id}` (2026-11-06, a report shared from the
 * workspace; lib/shares.ts builds the link). Here rather than in lib/shares
 * because App reads it on every route and this module is already in the entry
 * chunk; importing lib/shares there would put all of sharing in it.
 */
export function sharedReportId(path: string): string | null {
  const m = /^\/s\/([A-Za-z0-9_-]{16,64})$/.exec(path);
  return m ? m[1] : null;
}

/** A shared report's tab, before its own name is known. */
export const SHARED_REPORT_TITLE = 'Shared report — Forma';

/** The title for a path. Anything unknown is named as such, not disguised. */
export function titleForRoute(path: string): string {
  return ROUTE_TITLES[path] ?? (sharedReportId(path) ? SHARED_REPORT_TITLE : NOT_FOUND_TITLE);
}

/** What finished unseen: a report, a reply, a question for the person, or a failure. */
export type ReadyWhat = 'Report ready' | 'Reply ready' | 'Question waiting' | 'Request failed';

/**
 * The tab's title while something finished in it unseen (2026-11-05): a
 * report built or a reply written while the person was in another tab, so
 * the tab strip says so. The route's title comes back when they return.
 * Since 2026-11-07 (agent audit item 63) a question waiting and a request
 * that failed say so too: the title changed for success only, so a tab
 * waiting on the person looked as idle as one with nothing to do.
 */
export function readyTitle(what: ReadyWhat): string {
  if (what === 'Question waiting') return '? A question for you — Forma';
  if (what === 'Request failed') return '! Request failed — Forma';
  return `✓ ${what} — Forma`;
}

/**
 * What a route asks the shell to show.
 *
 * `null` means *leave that piece of state alone*, and it is load-bearing rather
 * than a convenience: `/login` and `/signup` deliberately do not touch
 * `showWorkspace`, because the sign-in modal renders over whatever is behind it
 * — the single `loginModal` appears in both the landing and workspace trees.
 * Forcing it to `false` would close the workspace behind the modal, and the user
 * would land on the marketing page after signing in. They leave `lastViewPath`
 * alone for the matching reason: a sign-in screen is not somewhere to return
 * *to*, and overwriting the remembered path there is what would send someone who
 * signed in from `/docs` somewhere they never asked to go.
 */
export interface RouteView {
  /** `null` leaves the workspace as it was — see above. */
  showWorkspace: boolean | null;
  showLogin: boolean;
  /** Only set by the two sign-in routes. */
  loginMode: 'signin' | 'signup' | null;
  /** `null` leaves the remembered path alone. */
  lastViewPath: string | null;
  /**
   * This path is not a route.
   *
   * Distinct from "render the home page", which is what an unknown path used to
   * do: the address bar kept the typo, the tab kept the home title, and the
   * visitor was shown a working page instead of being told they were nowhere.
   * Search engines received a 200 for every non-existent path — a soft 404,
   * which they penalise.
   *
   * The SPA fallback must keep returning `index.html` at the HTTP level; that
   * is how a client-routed app works. This is the client's job.
   */
  notFound: boolean;
}

export function viewForRoute(path: string): RouteView {
  switch (path) {
    case '/workspace':
      return { showWorkspace: true, showLogin: false, loginMode: null, lastViewPath: '/workspace', notFound: false };
    case '/login':
      return { showWorkspace: null, showLogin: true, loginMode: 'signin', lastViewPath: null, notFound: false };
    case '/signup':
      return { showWorkspace: null, showLogin: true, loginMode: 'signup', lastViewPath: null, notFound: false };
    case '/':
    case '/features':
    case '/docs':
    case '/contact':
    case '/changelog':
    case '/terms':
    case '/privacy':
    case '/accessibility':
    case '/security':
    case '/pricing':
    case '/examples':
    case '/compare':
    case '/about':
    case '/self-host':
    case '/download':
    case '/faq':
      return { showWorkspace: false, showLogin: false, loginMode: null, lastViewPath: path, notFound: false };
    default:
      // A shared report (2026-11-06): a page of its own, and signing in from
      // it comes back to it, since that is how a restricted share is opened.
      if (sharedReportId(path)) return { showWorkspace: false, showLogin: false, loginMode: null, lastViewPath: path, notFound: false };
      // Not a route. `lastViewPath` stays `/` so signing in from here returns
      // somewhere that exists, rather than back to the typo.
      return { showWorkspace: false, showLogin: false, loginMode: null, lastViewPath: '/', notFound: true };
  }
}

/**
 * Routes with no branch of their own, which therefore fall through to the
 * `default` case and render the home page.
 *
 * The point of naming them is that the list must stay **empty**: a new entry in
 * `ROUTES` without a branch here is the third of the three edits a route needs,
 * and it is the one that fails silently — the page simply renders as `/` with a
 * correct-looking URL. `routes.test.ts` asserts this is empty.
 */
export function routesWithoutABranch(): string[] {
  return ROUTES.filter((route) => {
    const view = viewForRoute(route);
    // Since the not-found branch exists, this is a one-field check: a real
    // route that fell through would be marked as not a route at all. The
    // `route !== '/'` exclusion the old comparison needed is gone with it,
    // because `/` now has a case of its own rather than sharing the default.
    return view.notFound;
  });
}
