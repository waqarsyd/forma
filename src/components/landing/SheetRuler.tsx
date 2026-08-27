import { useEffect, useRef, useState } from 'react';

/**
 * The drafting rule down the left margin: tick marks every 12px with a labelled
 * major every CSS inch, read out in report units — the same hundredths-of-an-inch
 * grid the product works in.
 *
 * The marker riding it is the one piece of chrome here that is live rather than
 * decorative: it tracks scroll position and reads it out in the same units.
 *
 * Three things it must not do:
 *
 * 1. **Carry a background of its own.** It is fixed, so any fill follows the
 *    scroll and paints a pale strip straight down the dark CTA band. Ticks only.
 * 2. **Sit under the content.** The landing page scopes its measure to 1180px,
 *    so from xl (1280px) the outer margin is at least 50px and the 44px rule
 *    clears the copy. Widening that measure puts the rule back on top of it.
 * 3. **Let the marker paint while it is behind `SiteHeader`.** This is the
 *    subtle one, and it shipped broken. The header is `sticky top-0 z-50` with
 *    `backdrop-filter: blur(16px) saturate(1.5)` over `bg-surface/[0.84]`, so it
 *    does not *hide* what is beneath it — it *smears* it. At scroll 0 the marker
 *    sits at top 0, which put solid brand orange directly under that blur and
 *    painted a shapeless orange stain into the top-left corner of every page the
 *    rule renders on (all six), on every load, before any scrolling. It read as
 *    a rendering fault rather than as chrome. `HEADER_CLEARANCE` below is the
 *    fix: the marker fades out while it is inside the header band and fades back
 *    in the moment it clears. **A translucent blurred header is not an occluder**
 *    — anything drawn under one has to hide itself.
 */

const TICK_GAP = 12;
const MAJOR_EVERY = 96; // one CSS inch
const UNITS_PER_INCH = 100;

/**
 * How far down the marker has to be before it is clear of `SiteHeader`.
 *
 * The header measures 69px (its `py-[22px]` plus the 25px lockup and a 1px
 * border). 76 gives it a few pixels of daylight so the fade finishes before the
 * bar emerges rather than during. If the header's height changes, this changes
 * with it — there is no shared token for it, and getting it wrong reintroduces
 * the smear described above rather than throwing.
 */
const HEADER_CLEARANCE = 76;

export default function SheetRuler() {
  const [height, setHeight] = useState(0);
  const [top, setTop] = useState(0);
  const [units, setUnits] = useState(0);
  const [overDark, setOverDark] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const measure = () => setHeight(window.innerHeight);
    measure();

    const onScroll = () => {
      const max = Math.max(1, document.body.scrollHeight - window.innerHeight);
      setTop(Math.min(1, window.scrollY / max) * (window.innerHeight - 4));
      setUnits(Math.round((window.scrollY / MAJOR_EVERY) * UNITS_PER_INCH));
    };
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

  const ticks = height ? Math.ceil(height / TICK_GAP) : 0;

  // See HEADER_CLEARANCE. Opacity rather than unmounting, so the marker fades
  // rather than blinking out of existence at the threshold.
  const tucked = top < HEADER_CLEARANCE;

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`u-transition pointer-events-none fixed inset-y-0 left-0 z-40 hidden w-11 border-r border-outline-variant xl:block ${
        overDark ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {Array.from({ length: ticks }, (_, i) => {
        const y = i * TICK_GAP;
        const major = y % MAJOR_EVERY === 0;
        return (
          <div key={y}>
            <span
              className={`absolute right-0 h-px ${major ? 'w-3 bg-on-surface-variant/90' : 'w-1.5 bg-outline-variant'}`}
              style={{ top: y }}
            />
            {major && y > 0 && (
              <span
                className="absolute right-4 -translate-y-1/2 font-code-sm text-[8.5px] tabular-nums text-on-surface-variant/70"
                style={{ top: y }}
              >
                {(y / MAJOR_EVERY) * UNITS_PER_INCH}
              </span>
            )}
          </div>
        );
      })}

      <span
        className={`u-transition absolute inset-x-0 h-0.5 bg-secondary-container ${
          tucked ? 'opacity-0' : 'opacity-100'
        }`}
        style={{ top }}
      >
        <span className="absolute right-0.5 top-1.5 whitespace-nowrap rounded-sm bg-secondary-container px-1 py-px font-code-sm text-[8.5px] font-medium tabular-nums text-white">
          y {String(units).padStart(4, '0')}
        </span>
      </span>
    </div>
  );
}
