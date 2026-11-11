import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { m, useInView, useReducedMotion } from 'motion/react';
import { fadeInUpVariants, respectReducedMotion, staggerContainer } from '../../lib/motion';
import { toSheetUnits } from './SheetRuler';

/**
 * Shared furniture for the landing page's sections, so LandingPage.tsx stays a
 * readable list of content rather than a wall of repeated wrappers.
 *
 * The eyebrows are sheet coordinates rather than 01/02/03 because the page is
 * set as a drafting sheet — they mark where you are down the page, which is
 * information, where a generic counter would be decoration.
 */

/**
 * Type scale, transcribed from the source design rather than approximated.
 * h2 is clamp(29px, 3.5vw, 45px) and the lede clamp(17px, 1.45vw, 19.5px);
 * both cap out at the page's 1180px measure, so the caps are what render.
 */
export const H2 =
  'font-display-lg text-[clamp(29px,3.5vw,45px)] font-extrabold leading-[1.08] tracking-[-0.032em] text-on-surface text-balance';
export const LEDE =
  'font-body-lg text-[clamp(17px,1.45vw,19.5px)] leading-[1.55] tracking-[-0.008em] text-on-surface-variant max-w-[62ch]';
export const BODY = 'font-body-lg text-[15.5px] leading-[1.65] text-on-surface-variant';
/* `SMALL` sat here until 2026-08-28 — a typography class-string constant that,
   unlike its four siblings, neither LandingPage nor FeaturesPage imported. It
   was `'font-body-lg text-[13.5px] leading-[1.55] text-[color:var(--ink-faint)]'`;
   recover it from `ea37ed0~1` if a small-print style is wanted again. */

/**
 * True while src/prerender.tsx draws a page into the built HTML (2026-11-11,
 * full audit PR-01 and PS-13). Every Reveal started at `opacity:0`, and the
 * build wrote that state into the page: dist/index.html carried 75 hidden
 * blocks, the hero's h1 among them, so the first paint was a header over an
 * empty page until the bundle ran, and a reader with no script never saw the
 * words at all. Drawn inside this, a Reveal renders its final state.
 */
export const PrerenderContext = createContext(false);

/**
 * Reveals its children once, on scroll into view. `eager` is for a block above
 * the fold (the hero), which is on screen from the first paint and so has
 * nothing to wait for: it renders as it is, with no fade, in the built page
 * and in the app alike, so the page the bundle draws over the built one does
 * not blink.
 */
export function Reveal({
  children,
  className = '',
  delay = 0,
  eager = false,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  eager?: boolean;
}) {
  const prefersReduced = useReducedMotion();
  const prerendering = useContext(PrerenderContext);
  return (
    <m.div
      className={className}
      variants={respectReducedMotion(fadeInUpVariants, prefersReduced)}
      initial={eager || prerendering ? false : 'hidden'}
      whileInView="visible"
      viewport={{ once: true, amount: 0.15 }}
      transition={{ delay: prefersReduced ? 0 : delay }}
    >
      {children}
    </m.div>
  );
}

/**
 * A list whose items arrive one after another. `eager` as on Reveal; its
 * items take the group's `initial`, so they need no flag of their own.
 */
export function RevealGroup({
  children,
  className = '',
  stagger = 0.06,
  eager = false,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  eager?: boolean;
}) {
  const prefersReduced = useReducedMotion();
  const prerendering = useContext(PrerenderContext);
  return (
    <m.div
      className={className}
      variants={respectReducedMotion(staggerContainer(prefersReduced ? 0 : stagger), prefersReduced)}
      initial={eager || prerendering ? false : 'hidden'}
      whileInView="visible"
      viewport={{ once: true, amount: 0.1 }}
    >
      {children}
    </m.div>
  );
}

/** One item inside a RevealGroup. */
export function RevealItem({ children, className = '' }: { children: ReactNode; className?: string }) {
  const prefersReduced = useReducedMotion();
  return (
    <m.div className={className} variants={respectReducedMotion(fadeInUpVariants, prefersReduced)}>
      {children}
    </m.div>
  );
}

/**
 * One figure in the stat strip. Counts up once on scroll into view; a target of
 * zero and reduced motion both land on the value immediately — "0 API keys" is
 * the point, and animating up to nothing is silly.
 *
 * It starts at its value, not at 0 (2026-11-11, full audit PS-13): effects do
 * not run when the build draws the page, so a count that began at 0 wrote
 * "0 export formats" and "0 pages / PDF" into every built page, which is all a
 * crawler, a link preview or a reader without script ever saw. The count drops
 * to 0 on the first frame of its animation instead, so the built page and the
 * app's first draw both say the real figure.
 */
export function Stat({ to, unit, label }: { to: number; unit?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const prefersReduced = useReducedMotion();
  const [n, setN] = useState(to);

  useEffect(() => {
    if (!inView) return;
    if (prefersReduced || to === 0) {
      setN(to);
      return;
    }
    let raf = 0;
    let t0 = -1;
    const tick = (now: number) => {
      if (t0 < 0) {
        t0 = now;
        setN(0);
        raf = requestAnimationFrame(tick);
        return;
      }
      const p = Math.min(1, (now - t0) / 900);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, prefersReduced, to]);

  return (
    <div ref={ref}>
      <div className="flex items-baseline gap-[7px] font-code-sm text-[28px] leading-[1.62] font-medium tracking-[-0.03em] tabular-nums text-secondary">
        {n}
        {unit && (
          <span className="text-[13px] font-normal tracking-normal text-[color:var(--ink-faint)]">{unit}</span>
        )}
      </div>
      <div className="mt-1 font-body-lg text-[12.5px] leading-[1.62] text-[color:var(--ink-faint)]">{label}</div>
    </div>
  );
}

/**
 * `x 000 · y 0840  Output` — the sheet coordinate and the section's name.
 *
 * **The coordinate is measured, not authored.** It used to be a literal passed
 * in per section, stepping in tidy 420s (`y 0840`, `y 1260`, `y 1680`…), which
 * meant the number described nothing — while the comment at the top of this file
 * claimed these "mark where you are down the page, which is information". They
 * were decoration wearing a measurement's clothes, and they contradicted the
 * `SheetRuler` chip on screen beside them by as much as 1,909 units.
 *
 * Three details that matter if you change this:
 *
 * 1. **The offsetTop chain, not `getBoundingClientRect`.** These sit inside
 *    `Reveal`, which animates `translateY`. A rect includes that transform, so
 *    measuring one mid-reveal reads a position the section never occupies and
 *    the number would settle to something different from what it flashed.
 *    `offsetTop` is layout-only and immune to it.
 * 2. **Re-measure on reflow.** Web fonts land after first paint and move
 *    everything below them, so a single measurement at mount is stale by the
 *    time anyone reads it. A `ResizeObserver` on the document element covers
 *    reflow and viewport changes; `document.fonts.ready` covers the font swap,
 *    which does not necessarily change the document's height and so can slip
 *    past the observer.
 * 3. **`x` stays `000`, and that is a measurement too.** Every section begins at
 *    the content column's left edge, which is the sheet's own x origin. It is
 *    zero because it is zero, not because nobody filled it in.
 *
 * `coord` remains as an override for the one caller that is not a page section:
 * the workspace canvas card, which is not positioned down a document and whose
 * coordinate is legitimately fixed.
 *
 * Two changes on 2026-11-08 (the site audit's batch SF). The coordinate is
 * `aria-hidden`: a screen reader read "x 000 · y 0840" before every section's
 * name (item 75), and it is a drawing's mark, not a word of the page. And the
 * eyebrows share one `ResizeObserver` (item 80): each made its own on the same
 * element, so a page of twelve sections ran twelve observers and twelve layout
 * reads on every reflow.
 */
const reflowReaders = new Set<() => void>();
let reflowObserver: ResizeObserver | null = null;

/** Calls `read` on every reflow of the document, through one observer shared by every caller. */
function onReflow(read: () => void): () => void {
  reflowReaders.add(read);
  if (!reflowObserver && typeof ResizeObserver !== 'undefined') {
    reflowObserver = new ResizeObserver(() => reflowReaders.forEach((r) => r()));
    reflowObserver.observe(document.documentElement);
  }
  return () => {
    reflowReaders.delete(read);
    if (!reflowReaders.size && reflowObserver) {
      reflowObserver.disconnect();
      reflowObserver = null;
    }
  };
}

export function Eyebrow({ coord, children }: { coord?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState('');

  useLayoutEffect(() => {
    if (coord) return;
    const el = ref.current;
    if (!el) return;
    let live = true;

    const read = () => {
      if (!live) return;
      let y = 0;
      for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
      const next = `x 000 · y ${String(toSheetUnits(y)).padStart(4, '0')}`;
      setMeasured((prev) => (prev === next ? prev : next));
    };
    read();

    const stop = onReflow(read);
    document.fonts?.ready.then(read).catch(() => {});

    return () => {
      live = false;
      stop();
    };
  }, [coord]);

  return (
    <div
      ref={ref}
      className="flex items-center gap-3 font-code-sm text-[11px] leading-[1.62] font-medium tracking-[0.15em] uppercase text-[color:var(--ink-faint)]"
    >
      <b aria-hidden="true" className="font-medium text-secondary">{coord ?? measured}</b>
      {children}
      <span className="h-px flex-1 bg-gradient-to-r from-outline-variant to-transparent" />
    </div>
  );
}

/** Section heading block: eyebrow, title, optional lede. */
export function SectionHead({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
}) {
  return (
    <div className="max-w-[730px] mb-[54px]">
      <Reveal>
        <Eyebrow>{eyebrow}</Eyebrow>
      </Reveal>
      <Reveal delay={0.06}>
        <h2 className={`mt-[18px] ${H2}`}>{title}</h2>
      </Reveal>
      {lede && (
        <Reveal delay={0.12}>
          <p className={`mt-[17px] ${LEDE}`}>{lede}</p>
        </Reveal>
      )}
    </div>
  );
}
