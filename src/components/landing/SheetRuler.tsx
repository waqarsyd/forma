import { useEffect, useRef, useState } from 'react';

/**
 * The drafting rule down the left margin: tick marks every 12px with a labelled
 * major every CSS inch, read out in report units — the same hundredths-of-an-inch
 * grid the product works in.
 *
 * Three things it must not do:
 *
 * 1. **Carry a background of its own.** It is fixed, so any fill follows the
 *    scroll and paints a pale strip straight down the dark CTA band. Ticks only.
 * 2. **Sit under the content.** The landing page scopes its measure to 1180px,
 *    so from xl (1280px) the outer margin is at least 50px and the 44px rule
 *    clears the copy. Widening that measure puts the rule back on top of it.
 * 3. **Paint anything in the accent colour.** It used to carry a live scroll
 *    marker — a 2px `bg-secondary-container` bar with a `y 0000` chip riding it,
 *    positioned by scroll progress. At scroll 0 that put solid brand orange at
 *    the very top-left of the viewport, directly behind `SiteHeader`, whose
 *    `backdrop-filter: blur(16px) saturate(1.5)` smeared it into a shapeless
 *    orange stain in the corner of **every** marketing page on load — the rule
 *    renders on all six. It read as a rendering fault rather than as chrome,
 *    which is what got it removed on 2026-08-27. If a live readout is ever
 *    wanted back, it has to hide itself while it is under the header rather
 *    than rely on the header being opaque, because it is not.
 */

const TICK_GAP = 12;
const MAJOR_EVERY = 96; // one CSS inch
const UNITS_PER_INCH = 100;

export default function SheetRuler() {
  const [height, setHeight] = useState(0);
  const [overDark, setOverDark] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const measure = () => setHeight(window.innerHeight);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
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
    </div>
  );
}
