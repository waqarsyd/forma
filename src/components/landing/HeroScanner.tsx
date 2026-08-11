import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { tokenizeXml } from '../../lib/repx';
import { snapInVariants, transition } from '../../lib/motion';
import { IconReplay } from './icons';

/**
 * The landing page's signature moment: a page is scanned, regions are detected
 * with their coordinates, and the DevExpress XML types itself out. It is the
 * whole product in about five seconds.
 *
 * Three things are deliberate:
 *
 * 1. **It runs once, on scroll into view, with a Replay control.** No looping —
 *    the same rule that removed three infinite animations from FeaturesPage.
 * 2. **The XML is coloured with `tokenizeXml` from src/lib/repx**, the same
 *    helper the real REPX viewer uses. It returns tokens rather than an HTML
 *    string, so this can never inject markup.
 * 3. **The sheet is drawn against --paper / --on-paper**, which are identical in
 *    both themes, exactly as ReportMockup does. A rendered report looks the same
 *    in light and dark; using a flipping token here would be a bug.
 */

/* Storyboard beats in ms. These are narrative timing, not design tokens — the
   transitions themselves come from src/lib/motion. The sweep's own start and
   duration live with its keyframes in index.css (.hero-sweep); the box delays
   below are timed against them. */
const TYPE_START = 2300;
const TYPE_TICK = 14;
const CHARS_PER_TICK = 3;

/** The page being read, drawn as geometry on a fixed grid rather than as art. */
const BARS: Array<{ l?: string; r?: string; t: string; w: string; h: string; tone: string }> = [
  // masthead
  { l: '25%', t: '6.4%', w: '27%', h: '2.8%', tone: 'bg-on-paper/80' },
  { l: '25%', t: '10.2%', w: '17%', h: '1.6%', tone: 'bg-on-paper/30' },
  { r: '7%', t: '5.4%', w: '21%', h: '3.4%', tone: 'bg-on-paper/80' },
  { r: '7%', t: '10.2%', w: '15%', h: '1.5%', tone: 'bg-on-paper/15' },
  { r: '7%', t: '12.8%', w: '12%', h: '1.5%', tone: 'bg-on-paper/15' },
  // two addressed parties
  { l: '7%', t: '21%', w: '11%', h: '1.5%', tone: 'bg-on-paper/30' },
  { l: '7%', t: '24.2%', w: '25%', h: '1.5%', tone: 'bg-on-paper/15' },
  { l: '7%', t: '27.2%', w: '21%', h: '1.5%', tone: 'bg-on-paper/15' },
  { l: '7%', t: '30.2%', w: '23%', h: '1.5%', tone: 'bg-on-paper/15' },
  { l: '40%', t: '21%', w: '11%', h: '1.5%', tone: 'bg-on-paper/30' },
  { l: '40%', t: '24.2%', w: '24%', h: '1.5%', tone: 'bg-on-paper/15' },
  { l: '40%', t: '27.2%', w: '19%', h: '1.5%', tone: 'bg-on-paper/15' },
  { l: '40%', t: '30.2%', w: '22%', h: '1.5%', tone: 'bg-on-paper/15' },
  // grid header
  { l: '8.5%', t: '40.8%', w: '16%', h: '1.5%', tone: 'bg-on-paper/30' },
  { l: '48%', t: '40.8%', w: '8%', h: '1.5%', tone: 'bg-on-paper/30' },
  { r: '8.5%', t: '40.8%', w: '13%', h: '1.5%', tone: 'bg-on-paper/30' },
  // totals
  { r: '24%', t: '68%', w: '11%', h: '1.5%', tone: 'bg-on-paper/15' },
  { r: '8.5%', t: '68%', w: '13%', h: '1.5%', tone: 'bg-on-paper/15' },
  { r: '24%', t: '71.4%', w: '9%', h: '1.5%', tone: 'bg-on-paper/15' },
  { r: '8.5%', t: '71.4%', w: '13%', h: '1.5%', tone: 'bg-on-paper/15' },
  { r: '8.5%', t: '75%', w: '28.5%', h: '3%', tone: 'bg-on-paper/80' },
  // footer
  { l: '7%', t: '91.4%', w: '26%', h: '1.4%', tone: 'bg-on-paper/15' },
  { r: '7%', t: '91.4%', w: '11%', h: '1.4%', tone: 'bg-on-paper/15' },
];

/** Four line-item rows on the same three rails as the header above. */
const ROWS = [
  { t: '45.6%', w: '30%' },
  { t: '50.8%', w: '25%' },
  { t: '56%', w: '33%' },
  { t: '61.2%', w: '22%' },
];

/** Horizontal rules that make the grid a grid. */
const RULES = ['39.4%', '44%', '49.2%', '54.4%', '59.6%', '64.8%', '89.5%'];

/** Detected regions, in the order the sweep reaches them. */
const BOXES: Array<{
  label: string; delay: number; l?: string; r?: string; t: string; w: string; h: string;
  below?: boolean; alignRight?: boolean;
}> = [
  { label: 'picture 40,40', delay: 620, l: '5.2%', t: '3.4%', w: '18.6%', h: '14.2%' },
  { label: 'label 210,45', delay: 880, l: '24.3%', t: '5%', w: '29.2%', h: '8.6%', below: true, alignRight: true },
  { label: 'label 40,225', delay: 1120, l: '5.2%', t: '19.8%', w: '29%', h: '13.2%' },
  { label: 'table 40,424 · 4 rows', delay: 1420, l: '5.2%', t: '38.6%', w: '89.6%', h: '27.4%' },
  { label: 'label 570,770', delay: 1720, r: '6.2%', t: '74%', w: '32%', h: '5.2%', below: true, alignRight: true },
];

const XML = `<?xml version="1.0"?>
<XtraReportsLayoutSerializer
  SerializerVersion="24.1.3"
  PageWidth="850"
  PageHeight="1100">
 <Bands>
  <Item1 ControlType="DetailBand"
    HeightF="1020">
   <Controls>
    <Item1
      ControlType="XRPictureBox"
      SizeF="160,90"
      LocationFloat="40,40" />
    <Item2
      ControlType="XRLabel"
      Text="INVOICE"
      SizeF="320,34"
      LocationFloat="210,45"
      Font="Hanken, 22pt, Bold" />
    <Item3
      ControlType="XRTable"
      SizeF="770,124"
      LocationFloat="40,424">
`;

/**
 * The pane is dark in both themes, so these pin the app's syntax hues to their
 * dark-surface variants rather than using App.tsx's theme-flipping map.
 */
const TOKEN_CLASS: Record<string, string> = {
  tag: 'text-[#7fb2ff]',
  attr: 'text-[#ffb066]',
  value: 'text-[#86e0a4]',
  punct: 'text-[#6b87a6]',
  meta: 'text-[#6b87a6] italic',
};

const CHIPS = ['spec.md', 'layout.json', 'report.repx'];

export default function HeroScanner() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const prefersReduced = useReducedMotion();

  const [running, setRunning] = useState(false);
  const [typed, setTyped] = useState(0);
  const [done, setDone] = useState(false);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const run = useCallback(() => {
    clearTimers();
    setDone(false);
    setTyped(0);
    setRunning(false);

    if (prefersReduced) {
      setRunning(true);
      setTyped(XML.length);
      setDone(true);
      return;
    }

    // A frame at zero before re-arming, so a Replay restarts the CSS sweep
    // instead of resuming a finished animation.
    timers.current.push(window.setTimeout(() => setRunning(true), 20));
    timers.current.push(
      window.setTimeout(() => {
        const tick = () => {
          setTyped((n) => {
            const next = Math.min(n + CHARS_PER_TICK, XML.length);
            if (next < XML.length) timers.current.push(window.setTimeout(tick, TYPE_TICK));
            else setDone(true);
            return next;
          });
        };
        tick();
      }, TYPE_START),
    );
  }, [prefersReduced]);

  useEffect(() => {
    if (inView) run();
    return clearTimers;
  }, [inView, run]);

  const lines = XML.slice(0, typed).split('\n');

  return (
    <div
      ref={ref}
      className="rounded-[14px] border border-outline-variant bg-surface-container-lowest dark:bg-card shadow-[var(--shadow-lg),var(--inset-hi)] overflow-hidden"
    >
      {/* title bar */}
      <div className="h-10 flex items-center gap-2.5 px-3 border-b border-outline-variant bg-surface-container-low">
        <span className="flex gap-[5px]" aria-hidden="true">
          <span className="w-2 h-2 rounded-full bg-outline" />
          <span className="w-2 h-2 rounded-full bg-outline" />
          <span className="w-2 h-2 rounded-full bg-outline" />
        </span>
        <span className="font-code-sm text-[10.5px] leading-[1.62] font-medium tracking-[0.09em] uppercase text-[color:var(--ink-faint)]">
          invoice-scan.pdf
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={run}
          className="u-transition-fast u-press u-focus-ring inline-flex items-center gap-[5px] rounded-full border border-outline-variant px-[11px] py-1 font-code-sm text-[9.5px] leading-[1.62] font-medium tracking-[0.11em] uppercase text-[color:var(--ink-faint)] hover:text-secondary hover:border-secondary cursor-pointer"
        >
          <IconReplay size={10} />
          Replay
        </button>
      </div>

      <div className="grid grid-cols-1 min-[460px]:grid-cols-2 min-h-[396px]">
        {/* the page being read */}
        <div className="hero-scanpane grid place-items-center p-[22px] border-b min-[460px]:border-b-0 min-[460px]:border-r border-outline-variant">
          <div className="relative w-full max-w-[212px] aspect-[850/1100] bg-paper text-on-paper rounded-[3px] border border-[color:var(--paper-rule)] shadow-[0_1px_2px_rgba(8,24,43,0.12),0_14px_30px_rgba(8,24,43,0.16)] overflow-hidden">
            {/* a mark on the page — deliberately not the Forma logo, which would
                swap to white here and vanish against the always-white sheet */}
            <div
              className="absolute rounded-sm bg-on-paper/85"
              style={{ left: '7%', top: '4.6%', width: '15%', aspectRatio: '1 / 1' }}
            >
              <div
                className="absolute bg-secondary-container"
                style={{ left: '22%', top: '24%', width: '52%', height: '52%', clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
              />
            </div>

            {BARS.map((b, i) => (
              <div
                key={`b${i}`}
                className={`absolute rounded-[1px] ${b.tone}`}
                style={{ left: b.l, right: b.r, top: b.t, width: b.w, height: b.h }}
              />
            ))}

            {RULES.map((t, i) => (
              <div key={`r${i}`} className="absolute bg-on-paper/15" style={{ left: '7%', top: t, width: '86%', height: 1 }} />
            ))}

            {ROWS.map((row, i) => (
              <div key={`row${i}`}>
                <div className="absolute rounded-[1px] bg-on-paper/15" style={{ left: '8.5%', top: row.t, width: row.w, height: '1.5%' }} />
                <div className="absolute rounded-[1px] bg-on-paper/15" style={{ left: '48%', top: row.t, width: '8%', height: '1.5%' }} />
                <div className="absolute rounded-[1px] bg-on-paper/15" style={{ right: '8.5%', top: row.t, width: '13%', height: '1.5%' }} />
              </div>
            ))}

            {/* detected regions */}
            {BOXES.map((box) => (
              <motion.div
                key={box.label}
                className="absolute rounded-[2px] border-[1.5px] border-secondary-container bg-[color:var(--accent-wash)]"
                style={{ left: box.l, right: box.r, top: box.t, width: box.w, height: box.h }}
                variants={snapInVariants}
                initial="hidden"
                animate={running ? 'visible' : 'hidden'}
                transition={{ ...transition.snap, delay: prefersReduced ? 0 : box.delay / 1000 }}
              >
                <span
                  className={`absolute whitespace-nowrap rounded-[2px] bg-secondary-container px-[3px] py-px font-code-sm text-[6px] font-medium leading-[1.62] tracking-[0.02em] text-white ${
                    box.below ? '-bottom-3' : '-top-3'
                  } ${box.alignRight ? '-right-px' : '-left-px'}`}
                >
                  {box.label}
                </span>
              </motion.div>
            ))}

            {running && !prefersReduced && <div className="hero-sweep" aria-hidden="true" />}
          </div>
        </div>

        {/* the XML coming out */}
        <div className="flex flex-col gap-2.5 bg-[color:var(--code-bg)] px-[15px] pt-[15px] pb-4 min-w-0">
          <div className="flex items-center gap-2 border-b border-[color:var(--code-rule)] pb-[9px] font-code-sm text-[9.5px] leading-[1.62] font-medium tracking-[0.13em] uppercase text-[#6b87a6]">
            repxContent
            <span
              className={`ml-auto inline-flex items-center gap-[5px] text-[#34d399] u-transition ${done ? 'opacity-100' : 'opacity-0'}`}
            >
              <span className="w-[5px] h-[5px] rounded-full bg-[#34d399] shadow-[0_0_0_3px_rgba(52,211,153,0.2)]" />
              valid
            </span>
          </div>

          <pre className="m-0 flex-1 min-h-0 whitespace-pre-wrap break-words font-code-sm text-[9.5px] leading-[1.72] text-[color:var(--code-ink)]">
            {lines.map((line, i) => (
              <span key={i}>
                {tokenizeXml(line).map((tok, j) => (
                  <span key={j} className={tok.kind ? TOKEN_CLASS[tok.kind] : undefined}>
                    {tok.text}
                  </span>
                ))}
                {i < lines.length - 1 && '\n'}
              </span>
            ))}
            {!done && typed > 0 && <span className="hero-caret" aria-hidden="true" />}
          </pre>

          <div className="flex flex-wrap gap-1.5">
            {CHIPS.map((chip, i) => (
              <motion.span
                key={chip}
                className="rounded-full border border-[color:var(--code-rule)] px-[9px] py-[3px] font-code-sm text-[8.5px] leading-[1.62] font-medium tracking-[0.09em] uppercase text-[#9db4cd]"
                initial={{ opacity: 0, y: 6 }}
                animate={done ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
                transition={{ ...transition.slow, delay: prefersReduced ? 0 : i * 0.09 }}
              >
                {chip}
              </motion.span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
