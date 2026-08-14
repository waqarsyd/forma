import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { tokenizeXml } from '../../lib/repx';
import { transition } from '../../lib/motion';
import { IconReplay } from './icons';
import Logo from '../Logo';

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

/**
 * The whole figure is drawn in **report units** — hundredths of an inch, origin
 * top-left, exactly what `LocationFloat` and `SizeF` carry — on the 850 × 1100
 * page the XML declares. Percentages are derived; nothing here is a percentage
 * anyone typed.
 *
 * That is not tidiness. The figure's entire claim is that a scanned page yields
 * *these coordinates*, which become *this XML* — and before this it was three
 * sets of numbers that disagreed. The picture region was labelled `160,90` (8.2%
 * of the page) and drawn 14.2% tall; the table declared `SizeF="770,124"` (11.3%)
 * and was drawn across 27.4%; the total was labelled `570,770` and drawn at
 * 61.8%, 74% instead of 67.1%, 70%. Every box asserted a number it did not
 * honour, in a figure whose subject is coordinates being read correctly.
 *
 * So these five rectangles are the single source: the page is laid out from
 * them and the XML below is built from them, which is what stops a coordinate
 * drifting from the file that claims it.
 *
 * They were also drawn on the page as outlined regions with coordinate captions
 * — the "detected" overlay. That is gone (2026-08-14, on request): it covered
 * the document it was pointing at, and once the page was properly typeset the
 * overlay was the only thing still making the figure look like a diagram rather
 * than a scan. The sweep and the XML typing carry the same story without
 * annotating over the invoice. **The rectangles stay** — they are geometry, not
 * decoration, and the XML is generated from them.
 */
const PAGE = { w: 850, h: 1100 };

/** Unit → CSS percentage, per axis. */
const px = (v: number) => `${(v / PAGE.w) * 100}%`;
const py = (v: number) => `${(v / PAGE.h) * 100}%`;

const PICTURE = { x: 40, y: 40, w: 160, h: 90 };
const TITLE = { x: 210, y: 45, w: 320, h: 34 };
const BILL_TO = { x: 40, y: 225, w: 250, h: 110 };
const TABLE = { x: 40, y: 424, w: 770, h: 170 };
const TOTAL = { x: 570, y: 770, w: 240, h: 40 };

/**
 * The page is typeset, not suggested.
 *
 * It was grey bars standing in for words — "geometry rather than art", which is
 * defensible in the abstract and wrong here. A hero figure whose whole job is to
 * say *this reads real documents and writes real files* cannot show a
 * placeholder: bars read as unfinished, and unfinished reads as "does this
 * actually work?".
 *
 * The type is small because it is at true scale. 850 units of page shown 240px
 * wide is 28px to the inch, so 10pt body copy really is about 4px — that is what
 * a document thumbnail looks like, and it is exactly why this now reads as a
 * page rather than a wireframe of one. The words are there for anyone who leans
 * in, and the texture is right for everyone who does not.
 *
 * Sizes are `cqw` against the sheet's own inline size (`container-type` is set
 * on it), so every glyph scales with the page instead of pinning itself to a
 * pixel size the sheet may not have.
 */
const RIGHT = 810; // the right margin every right-aligned figure ends on
const CELL_RIGHT = RIGHT - 20; // inside the table's right border, where its cells end
const fs = (units: number) => `${((units / PAGE.w) * 100).toFixed(3)}cqw`;

const STRONG = 'text-on-paper/90';
const BODY = 'text-on-paper/70';
const FAINT = 'text-on-paper/45';

type Mark = {
  x: number; y: number; text: string; size: number; tone: string;
  w?: number; align?: 'right'; mono?: boolean; heading?: boolean; weight?: number;
};

/** A figure given by the right edge of its column, as money always is. */
const fig = (right: number, y: number, text: string, tone: string, w = 130): Mark =>
  ({ x: right - w, y, text, size: 15, tone, w, align: 'right', mono: true });

/** The small uppercase mono heading the rest of the app uses for the same job. */
const head = (x: number, y: number, text: string): Mark =>
  ({ x, y, text, size: 12, tone: FAINT, mono: true, heading: true });

const MARKS: Mark[] = [
  // masthead
  { x: TITLE.x, y: 48, text: 'INVOICE', size: 30, tone: STRONG, weight: 800 },
  { x: TITLE.x, y: 93, text: 'Invoice  INV-2043', size: 15, tone: BODY, mono: true },
  { x: TITLE.x, y: 114, text: 'Issued  14 Aug 2026', size: 15, tone: BODY, mono: true },
  { x: RIGHT - 260, y: 44, w: 260, align: 'right', text: 'Northwind Traders Ltd', size: 17, tone: STRONG, weight: 600 },
  { x: RIGHT - 260, y: 70, w: 260, align: 'right', text: '12 Harbour Road, Bristol', size: 15, tone: BODY },
  { x: RIGHT - 260, y: 90, w: 260, align: 'right', text: 'BS1 4QA, United Kingdom', size: 15, tone: BODY },
  { x: RIGHT - 260, y: 110, w: 260, align: 'right', text: 'VAT GB 431 8827 55', size: 15, tone: FAINT, mono: true },
  // the two addressed parties
  /* 233, not 225: the detected region starts at the control's own top edge, and
     text sitting exactly on it renders under the box's border and its caption.
     A label's glyphs begin a few units inside its bounds, as they do in print. */
  /* Inset from the region's left edge for the same reason as the amounts above:
     text flush against `BILL_TO.x` is drawn under the detected box's border, and
     every line in the block lost its first character to it. */
  head(BILL_TO.x + 10, 233, 'Bill to'),
  { x: BILL_TO.x + 10, y: 257, text: 'Cavendish & Co.', size: 16, tone: STRONG, weight: 600 },
  { x: BILL_TO.x + 10, y: 280, text: '18 Mill Lane, Leeds', size: 15, tone: BODY },
  { x: BILL_TO.x + 10, y: 302, text: 'LS1 5EX', size: 15, tone: BODY },
  head(340, 233, 'Ship to'),
  { x: 340, y: 257, text: 'Cavendish Warehouse', size: 16, tone: STRONG, weight: 600 },
  { x: 340, y: 280, text: 'Unit 7, Dock Road, Hull', size: 15, tone: BODY },
  { x: 340, y: 302, text: 'HU1 2BE', size: 15, tone: BODY },
  // table header, on the three rails the rows use
  head(60, 434, 'Description'),
  head(470, 434, 'Qty'),
  /* Right-aligned to 790, not to the 810 margin: 810 is where the table's own
     right border is, and a figure set flush against it was clipped by it. Cells
     have padding; this is that padding. */
  { x: CELL_RIGHT - 130, y: 434, w: 130, align: 'right', text: 'Amount', size: 12, tone: FAINT, mono: true, heading: true },
  // payment terms, opposite the totals
  head(40, 640, 'Payment terms'),
  { x: 40, y: 665, text: 'Net 30 days from the date of issue.', size: 15, tone: BODY },
  { x: 40, y: 687, text: 'Bank transfer, account 4471 9920.', size: 15, tone: BODY },
  { x: 40, y: 709, text: 'Late payment charged at 4% APR.', size: 15, tone: FAINT },
  // totals
  { x: 560, y: 639, text: 'Subtotal', size: 15, tone: BODY },
  fig(RIGHT, 639, '7,500.00', BODY),
  { x: 560, y: 681, text: 'VAT at 20%', size: 15, tone: BODY },
  fig(RIGHT, 681, '1,500.00', BODY),
  // footer
  { x: 40, y: 1012, text: 'Registered in England · 4471992', size: 13, tone: FAINT },
  { x: RIGHT - 150, y: 1012, w: 150, align: 'right', text: 'Page 1 of 1', size: 13, tone: FAINT, mono: true },
];

/** Four line items, on the header's rails. */
const ROWS = [
  { y: 469, desc: 'Site survey and measurement', qty: '4', amount: '1,200.00' },
  { y: 503, desc: 'Report template build', qty: '12', amount: '3,600.00' },
  { y: 537, desc: 'Data source integration', qty: '6', amount: '1,800.00' },
  { y: 571, desc: 'Training and handover', qty: '3', amount: '900.00' },
];

/** Rules: the table's own grid, the totals divider, and the footer line. */
const RULES = [
  { y: TABLE.y, x: 40, w: 770 },
  { y: TABLE.y + 34, x: 40, w: 770 },
  { y: TABLE.y + 68, x: 40, w: 770 },
  { y: TABLE.y + 102, x: 40, w: 770 },
  { y: TABLE.y + 136, x: 40, w: 770 },
  { y: TABLE.y + TABLE.h, x: 40, w: 770 },
  { y: 745, x: 560, w: 250 },
  { y: 1000, x: 40, w: 770 },
];

/**
 * Eighteen lines, and the count is a layout constraint rather than a preference.
 *
 * This column sets the card's height, and the page in the other column cannot
 * grow past the column's width — so every line here is dotted background around
 * the sheet. At 23 lines the card was 516 tall against a 343 sheet-plus-padding,
 * leaving 82px of empty bed above and below it. Folding the element name onto
 * the same line as its `<ItemN` (which is how anyone actually reads REPX) takes
 * it to 18 without dropping a single attribute — `SizeF`, `LocationFloat`,
 * `Font` and the page size all still type out.
 *
 * Nothing here may exceed ~42 characters: the pane wraps at that width and a
 * wrapped line costs the same as a written one.
 */
const XML = `<?xml version="1.0"?>
<XtraReportsLayoutSerializer
  SerializerVersion="24.1.3"
  PageWidth="${PAGE.w}" PageHeight="${PAGE.h}">
 <Bands>
  <Item1 ControlType="DetailBand"
    HeightF="1020">
   <Controls>
    <Item1 ControlType="XRPictureBox"
      SizeF="${PICTURE.w},${PICTURE.h}"
      LocationFloat="${PICTURE.x},${PICTURE.y}" />
    <Item2 ControlType="XRLabel"
      Text="INVOICE" SizeF="${TITLE.w},${TITLE.h}"
      LocationFloat="${TITLE.x},${TITLE.y}"
      Font="Hanken, 22pt, Bold" />
    <Item3 ControlType="XRTable"
      SizeF="${TABLE.w},${TABLE.h}"
      LocationFloat="${TABLE.x},${TABLE.y}">
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
  /** Whether *this* run is animating, which is not the same as the preference. */
  const [animating, setAnimating] = useState(false);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  /**
   * `force` is what makes the Replay button a button.
   *
   * Reduced motion used to short-circuit every run, including one the user had
   * just asked for by clicking — so on any machine reporting the preference the
   * control was dead: measured, the typed length stayed at its final 502
   * characters across eight samples after a click, while the same click on a
   * no-preference machine reset it to 0 and re-typed. **Windows reports the
   * preference whenever "Show animations in Windows" is off**, which is the
   * default on Server editions, so this was not an edge case — it is what
   * anyone on such a machine saw, and they never saw the animation at all.
   *
   * Automatic motion still obeys the preference: arriving at the page animates
   * nothing. Motion the user explicitly asks for is the standing exception in
   * WCAG's guidance, and a control that visibly does nothing is worse for
   * trust than the motion it was avoiding.
   */
  const run = useCallback((force = false) => {
    clearTimers();
    const animated = force || !prefersReduced;
    setAnimating(animated);
    setDone(false);
    setTyped(0);
    setRunning(false);

    if (!animated) {
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
          /* `() => run(true)`, never `run` itself: as a handler it would receive
             the click event as `force`, which is truthy — right answer, wrong
             reason, and it would break the moment anything else called it. */
          onClick={() => run(true)}
          className="u-transition-fast u-press u-focus-ring inline-flex items-center gap-[5px] rounded-full border border-outline-variant px-[11px] py-1 font-code-sm text-[9.5px] leading-[1.62] font-medium tracking-[0.11em] uppercase text-[color:var(--ink-faint)] hover:text-secondary hover:border-secondary cursor-pointer"
        >
          <IconReplay size={10} />
          Replay
        </button>
      </div>

      {/* The floor is the sheet plus its padding, not a round number: below
          that the page would be cropped, above it the column just adds bed. */}
      <div className="grid grid-cols-1 min-[460px]:grid-cols-2 min-h-[344px]">
        {/* the page being read */}
        {/* The page is the subject of this figure and was losing to the space
            around it: 212 × 274 inside a 273 × 474 pane, 200px of dotted
            background, 58% of the column's height — while the code pane beside
            it ran edge to edge. Tighter padding and a cap that lets the sheet
            take the column's width put ~30% more page on screen at the same
            card height. The scale rises with it, from 0.25 to 0.28 of a report
            unit per pixel, which is what makes the ruled table read as a table. */}
        <div className="hero-scanpane grid place-items-center p-4 border-b min-[460px]:border-b-0 min-[460px]:border-r border-outline-variant">
          {/* `container-type: inline-size` is what lets the type on the page be
              sized in `cqw` — every glyph then scales with the sheet, at any
              column width, without a resize observer. */}
          <div
            className="relative w-full max-w-[248px] aspect-[850/1100] bg-paper text-on-paper rounded-[3px] border border-[color:var(--paper-rule)] shadow-[0_1px_2px_rgba(8,24,43,0.12),0_14px_30px_rgba(8,24,43,0.16)] overflow-hidden"
            style={{ containerType: 'inline-size' }}
          >
            {/* The real mark, filling the picture region the way an image
                control holds a letterhead logo.

                It was a hand-drawn stand-in — a dark rounded square with a
                clipped triangle inside it — because `Logo` swaps to its white
                variant under `.dark` and would have vanished against a sheet
                that is white in both themes. At 24px that stand-in read as a
                dark blob with an orange corner. The fix is not to avoid the
                mark but to pin its variant: this is the light-mode file
                directly, so the theme cannot reach it, and the artwork is the
                real one. `object-left` keeps it against the box's left edge,
                where a letterhead puts it, rather than centred in 160 units of
                picture box. */}
            <div
              className="absolute"
              style={{ left: px(PICTURE.x), top: py(PICTURE.y), width: px(PICTURE.w), height: py(PICTURE.h) }}
            >
              <Logo pin="light" fill className="h-full w-full" />
            </div>

            {MARKS.map((m, i) => (
              <div
                key={`m${i}`}
                className={`absolute whitespace-nowrap ${m.mono ? 'font-code-sm' : 'font-body-lg'} ${m.tone} ${
                  m.heading ? 'uppercase' : ''
                }`}
                style={{
                  left: px(m.x),
                  top: py(m.y),
                  width: m.w ? px(m.w) : undefined,
                  textAlign: m.align,
                  fontSize: fs(m.size),
                  fontWeight: m.weight,
                  letterSpacing: m.heading ? '0.14em' : undefined,
                  lineHeight: 1,
                }}
              >
                {m.text}
              </div>
            ))}

            {/* The total is a filled row, so its region and its ink are the same
                rectangle — the one place on the page where that is true. */}
            <div
              className="absolute flex items-center justify-between rounded-[1px] bg-on-paper/90 text-paper"
              style={{
                left: px(TOTAL.x),
                top: py(TOTAL.y),
                width: px(TOTAL.w),
                height: py(TOTAL.h),
                paddingLeft: px(14),
                paddingRight: px(14),
                fontSize: fs(16),
                lineHeight: 1,
              }}
            >
              <span className="font-code-sm uppercase tracking-[0.14em]">Total</span>
              <span className="font-code-sm font-medium">9,000.00</span>
            </div>

            {RULES.map((rule, i) => (
              <div
                key={`r${i}`}
                className="absolute bg-on-paper/22"
                style={{ left: px(rule.x), top: py(rule.y), width: px(rule.w), height: 1 }}
              />
            ))}

            {ROWS.map((row, i) => (
              <div key={`row${i}`} style={{ fontSize: fs(15), lineHeight: 1 }}>
                <div className={`absolute whitespace-nowrap font-body-lg ${BODY}`} style={{ left: px(60), top: py(row.y), fontSize: 'inherit', lineHeight: 1 }}>
                  {row.desc}
                </div>
                <div className={`absolute whitespace-nowrap font-code-sm ${BODY}`} style={{ left: px(470), top: py(row.y), fontSize: 'inherit', lineHeight: 1 }}>
                  {row.qty}
                </div>
                <div
                  className={`absolute whitespace-nowrap text-right font-code-sm ${BODY}`}
                  style={{ left: px(CELL_RIGHT - 130), top: py(row.y), width: px(130), fontSize: 'inherit', lineHeight: 1 }}
                >
                  {row.amount}
                </div>
              </div>
            ))}

            {/* The sweep is the whole of the reading now: no outlined regions,
                no coordinate captions over the page. The coordinates are still
                what the figure is about — they are in the XML beside it, and
                the page is laid out from the same numbers. */}
            {running && animating && <div className="hero-sweep" aria-hidden="true" />}
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

          {/* `min-h` is the finished block's height, reserved up front. The
              pane grows a line at a time as the XML types, and without it the
              whole card — and the hero beside it — stepped taller eighteen
              times during the animation. Its value is the line count above
              times 9.5px × 1.6. */}
          <pre className="m-0 flex-1 min-h-[276px] whitespace-pre-wrap break-words font-code-sm text-[9.5px] leading-[1.6] text-[color:var(--code-ink)]">
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
                transition={{ ...transition.slow, delay: animating ? i * 0.09 : 0 }}
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
