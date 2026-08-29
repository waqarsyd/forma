import { useEffect, useRef, useState } from 'react';

/**
 * The drafting rule down the left margin: tick marks every 12px with a labelled
 * major every CSS inch, read out in report units — the same hundredths-of-an-inch
 * grid the product works in.
 *
 * **The rule measures the document, not the window.** The strip is `fixed`, but
 * its grid is anchored to the page: the ticks slide as you scroll, and a label
 * reading `800` marks the point eight inches down the *document*. That is the
 * whole contract, and it is what lets the labels agree with the `Eyebrow`
 * coordinates printed in the page beside them — both are `toSheetUnits` of a
 * document offset, and there is now exactly one scale on screen.
 *
 * It did not always work that way, and the history is the reason for the rule:
 *
 *  - Originally the marker chip stored its own scroll state while the ticks used
 *    a viewport scale and the marker's position used a third — a fraction of the
 *    document mapped onto the viewport. Three coordinate systems in one
 *    component. Measured over six pages and four scroll positions: **0 of 22
 *    agreed, worst by 8,669 units on /docs**, where the chip read 9,509 on a
 *    rule whose largest label was 900. Nothing threw; each number was correct in
 *    a system the other two were not using.
 *  - Deriving the chip from the tick scale fixed *that*, and the chip and its
 *    ticks then agreed everywhere. But it reconciled the component with itself
 *    and not with the page: the section eyebrows were hardcoded literals
 *    stepping in 420s, so a reader saw `Y 1260 SCOPE` in the copy and `y 0280`
 *    on the rule beside it. **6 of 17 agreed, and all six were reading zero**,
 *    which is where any two scales agree for free.
 *  - Both are now document coordinates. The eyebrows measure their own layout
 *    position; these labels measure the offset at each tick.
 *
 * Four things it must not do:
 *
 * 1. **Carry a background of its own.** It is fixed, so any fill follows the
 *    scroll and paints a pale strip straight down the dark CTA band. Ticks only.
 * 2. **Sit under the content.** The landing page scopes its measure to 1180px,
 *    so from xl (1280px) the outer margin is at least 50px and the 44px rule
 *    clears the copy. Widening that measure puts the rule back on top of it.
 * 3. **Paint anything solid while it is behind `SiteHeader`.** This is the
 *    subtle one, and it shipped broken. The header is `sticky top-0 z-50` with
 *    `backdrop-filter: blur(16px) saturate(1.5)` over `bg-surface/[0.84]`, so it
 *    does not *hide* what is beneath it — it *smears* it. The old marker sat at
 *    top 0 at rest, which put solid brand orange under that blur and painted a
 *    shapeless orange stain into the top-left corner of every page the rule
 *    renders on, on every load, before any scrolling. **A translucent blurred
 *    header is not an occluder** — anything drawn under one has to hide itself.
 *    The marker is gone, but the hazard is not: the ticks now travel upward
 *    through that band instead of sitting still below it, so each one carries
 *    its own `HEADER_CLEARANCE` fade.
 * 4. **Introduce a second scale.** Everything here is `toSheetUnits` of a
 *    document offset. A readout derived from anything else — a scroll fraction,
 *    a viewport position, a hardcoded literal — is how all three of the bugs
 *    above happened, and none of them threw.
 */

const TICK_GAP = 12;
/*
 * Module-private on purpose. `toSheetUnits` below is the only thing anything
 * outside needs, and exporting these two put `UNITS_PER_INCH` on the public
 * surface as a plain number while `reportGeometry.ts` already has a private
 * constant of the same name that is a Record of unit -> scale. Two unrelated
 * things under one name is how the wrong one gets imported, and in a codebase
 * whose worst historical bug class is unit conversions that is not a collision
 * worth leaving lying around.
 */
const MAJOR_EVERY = 96; // one CSS inch
const UNITS_PER_INCH = 100;

/**
 * CSS pixels to the sheet's own hundredths-of-an-inch.
 *
 * Exported because `Eyebrow` in `sections.tsx` prints coordinates in this same
 * scale, and the two must not each carry their own copy of 96 and 100. That is
 * not hypothetical here: the section eyebrows were hardcoded literals stepping
 * in 420s, and they disagreed with this rule by up to 1,909 units — measured
 * across 17 eyebrows on six pages, of which only the six reading zero agreed,
 * and zero is where every scale agrees for free. One function, one scale.
 */
export function toSheetUnits(px: number): number {
  return Math.round((px / MAJOR_EVERY) * UNITS_PER_INCH);
}

/**
 * How far down a tick has to be before it is clear of `SiteHeader`.
 *
 * The header measures 69px (its `py-[22px]` plus the 25px lockup and a 1px
 * border). 76 gives it a few pixels of daylight so the fade finishes before the
 * bar emerges rather than during. If the header's height changes, this changes
 * with it — there is no shared token for it, and getting it wrong reintroduces
 * the smear described above rather than throwing.
 *
 * This used to gate the marker alone, which was the only thing that moved.
 * Now every tick and label slides under the header on the way up, so the fade
 * applies to all of them.
 */
const HEADER_CLEARANCE = 76;

export default function SheetRuler() {
  const [height, setHeight] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const [overDark, setOverDark] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const measure = () => setHeight(window.innerHeight);
    measure();

    // The document offset at the top edge of the viewport. That is the only
    // thing the rule needs: every tick's coordinate is this plus its own screen
    // position, so there is one input and one scale.
    const onScroll = () => setScrollY(window.scrollY);
    onScroll();

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Stand down once the dark band reaches the rule — dark ticks on a dark
  // ground read as dirt, and a light rule over it reads as a seam.
  useEffect(() => {
    const band = document.querySelector('[data-dark-band]');
    if (!band) return;
    const io = new IntersectionObserver((entries) => setOverDark(entries[0].isIntersecting), {
      rootMargin: '-45% 0px 0px 0px',
    });
    io.observe(band);
    return () => io.disconnect();
  }, []);

  /**
   * The ticks, in DOCUMENT coordinates.
   *
   * The grid is anchored to the document, not the viewport: `firstTick` is the
   * first multiple of `TICK_GAP` at or below the top edge, so as the page
   * scrolls the ticks slide upward and a major always lands on a round hundred.
   * That is what makes a label mean something — `800` marks the point 8 inches
   * down the page, on every viewport size, rather than 8 inches down the window.
   *
   * One extra tick is drawn so the strip stays filled as the grid slides.
   */
  const firstTick = Math.ceil(scrollY / TICK_GAP) * TICK_GAP;
  const count = height ? Math.ceil(height / TICK_GAP) + 1 : 0;

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`u-transition pointer-events-none fixed inset-y-0 left-0 z-40 hidden w-11 border-r border-outline-variant xl:block ${
        overDark ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {Array.from({ length: count }, (_, i) => {
        const docY = firstTick + i * TICK_GAP;
        const screenY = docY - scrollY;
        const major = docY % MAJOR_EVERY === 0;

        // See HEADER_CLEARANCE. Everything now travels under the header rather
        // than sitting still below it, so each tick carries its own fade in and
        // nothing solid is left to smear through the blur.
        const fade = Math.max(0, Math.min(1, screenY / HEADER_CLEARANCE));

        return (
          <div key={docY} style={{ opacity: fade }}>
            <span
              className={`absolute right-0 h-px ${major ? 'w-3 bg-on-surface-variant/90' : 'w-1.5 bg-outline-variant'}`}
              style={{ top: screenY }}
            />
            {major && docY > 0 && (
              <span
                className="absolute right-4 -translate-y-1/2 font-code-sm text-[8.5px] tabular-nums text-on-surface-variant/70"
                style={{ top: screenY }}
              >
                {toSheetUnits(docY)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
