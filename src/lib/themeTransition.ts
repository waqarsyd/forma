/**
 * The theme swap, as a circle that opens from the control you pressed.
 *
 * Built on the View Transitions API: `startViewTransition` snapshots the page,
 * applies the DOM change, then cross-fades old to new. We replace that
 * cross-fade with a `clip-path` circle growing from the toggle, so the incoming
 * theme wipes across the page from wherever the user clicked.
 *
 * Three things this has to get right, and each one is a way it can look broken:
 *
 * 1. **The radius must reach the furthest corner, not the nearest.** The toggle
 *    sits in the top-right of the header, so the far corner is bottom-left. Size
 *    the circle off the near edge and the wipe stops short and snaps.
 * 2. **The origin has to come from the control**, and the control is not passed
 *    down — `setIsDarkMode` is typed `(val: boolean) => void` through eight
 *    components. `document.activeElement` is the button at the moment it is
 *    activated, by pointer or by keyboard, which is exactly the element the
 *    animation should start from. Anything unexpected falls back to the centre
 *    of the viewport, which still reads as a deliberate wipe.
 * 3. **It must degrade to an instant swap.** The API is Chromium and Safari 18+;
 *    Firefox has it behind a flag at time of writing. Everywhere else, and under
 *    `prefers-reduced-motion: reduce`, the callback simply runs. A theme toggle
 *    that does nothing on Firefox would be a far worse bug than one that does
 *    not animate.
 *
 * Timing comes from `motion.ts` rather than a literal — `index.css` states the
 * rule for the cross-fade this replaces: "No new timing values."
 */

import { DURATION, EASE } from './motion';

/** The View Transitions API, which `lib.dom` does not describe in this TS version. */
interface ViewTransition {
  ready: Promise<void>;
  finished: Promise<void>;
}
type StartViewTransition = (callback: () => void) => ViewTransition;

/**
 * Distance from (x, y) to the furthest corner of a `w` by `h` box.
 *
 * The circle has to cover the whole viewport from an off-centre origin, so each
 * axis contributes whichever side is further away.
 */
export function coverRadius(x: number, y: number, w: number, h: number): number {
  return Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
}

/**
 * Where the wipe starts: the centre of `el`, or the centre of the viewport.
 *
 * A zero-sized rect counts as absent — that is what a detached or
 * `display: none` element reports, and a wipe from 0,0 looks like a glitch
 * rather than a decision.
 */
export function originOf(
  el: Element | null,
  w: number,
  h: number,
): { x: number; y: number } {
  const r = el?.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) return { x: w / 2, y: h / 2 };
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Whether the animated path is available at all. Exported for the tests. */
export function canAnimateSwap(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  if (typeof (document as { startViewTransition?: StartViewTransition }).startViewTransition !== 'function') return false;
  // A full-screen wipe is exactly the kind of motion the preference is about.
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Apply `swap` behind a circular wipe, and report whether it animated.
 *
 * The caller uses the return value to decide whether to also run the CSS
 * cross-fade: running both paints the fade *inside* the expanding circle and
 * the edge of the wipe turns to mush.
 *
 * `swap` must make its DOM change synchronously — the API snapshots before and
 * after this callback, so anything deferred lands outside the transition and
 * flashes in afterwards.
 */
export function circularThemeSwap(swap: () => void): boolean {
  if (!canAnimateSwap()) {
    swap();
    return false;
  }

  const { innerWidth: w, innerHeight: h } = window;
  const { x, y } = originOf(document.activeElement, w, h);
  const r = coverRadius(x, y, w, h);

  const start = (document as unknown as { startViewTransition: StartViewTransition })
    .startViewTransition;

  const transition = start.call(document, swap);

  transition.ready
    .then(() => {
      document.documentElement.animate(
        {
          clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`],
        },
        {
          duration: DURATION.snap * 1000,
          easing: `cubic-bezier(${EASE.standard.join(',')})`,
          // Only the incoming snapshot is clipped; the outgoing one is left to
          // sit underneath it, which is what makes this read as a reveal rather
          // than as a hole being cut in the page.
          pseudoElement: '::view-transition-new(root)',
        },
      );
    })
    .catch(() => {
      /* A transition can be skipped — by a second click, or by the page being
         hidden. The DOM change has already been applied either way, so there is
         nothing to repair and nothing worth logging. */
    });

  return true;
}
