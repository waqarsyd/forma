/**
 * How tall a piece of text prints, the way DevExpress measures it.
 *
 * DevExpress grows a control to fit its text (`CanGrow` and `WordWrap` both
 * default to true) and pages break wherever that leaves them, so the Preview
 * cannot place a single page correctly without knowing how many lines each
 * text takes. Everything here was measured by printing through DevExpress 20.1
 * with `RepxProbe render` on 2026-10-30 (rows 7 and 8 of
 * `docs/proposals/devexpress-parity.md`):
 *
 * - **Lines break greedily at spaces** against the text area's width: a 216pt
 *   wide Arial 9pt label broke "...two vehicles because" at 203.1pt and fitted
 *   "...and the customer" at exactly 216.0pt.
 * - **The line spacing is a fixed ratio of the font size, per font**: Arial
 *   and Times New Roman 1.1499, Verdana 1.2153, Tahoma 1.207, Segoe UI
 *   1.3301, Calibri 1.2207, Georgia 1.1362, Courier New 1.1328, Microsoft
 *   Sans Serif 1.1318, Trebuchet MS 1.1611. Bold does not change it. One
 *   line of Arial or Times New Roman is shorter, 1.1172 and 1.1074 (row 51).
 * - **A grown control is the lines plus 1.5pt**, plus its vertical padding and
 *   its top and bottom borders: three lines of Arial 9pt printed 32.544pt
 *   against 3 x 10.35 + 1.5 = 32.55; ten hundredths of padding and a 3px
 *   border each added exactly their own height.
 * - **A control that shrinks prints exactly as tall as one that grows**, and
 *   an empty one shrinks to nothing (s38, parity row 52). Row 8 had fitted
 *   1.17pt in place of 1.5pt to one-line Arial labels, which is row 51's
 *   shorter single line seen from the other side: one line of Verdana 10pt
 *   shrank to 13.653pt, where 1.17pt would have given 13.32.
 *
 * The browser measures the words with a canvas in the same font. On Windows,
 * where DevExpress itself runs, that is the same font file; elsewhere a
 * metric-compatible substitute (Liberation Sans for Arial) keeps the widths.
 */

export interface FontSpec {
  family: string;
  sizePt: number;
  bold: boolean;
  italic: boolean;
}

/** Lines a text breaks into at a width, in points. */
export type MeasureText = (text: string, font: FontSpec, widthPt: number) => string[];

/** Added to the lines of a control that grows or shrinks. Measured: 1.5pt at every font and size. */
export const GROW_EXTRA_PT = 1.5;

/*
 * Line spacing over font size, by family, as DevExpress printed each one:
 * every font from 6 to 36pt in s37 (parity row 51), one, two and three
 * lines, each a straight line through the sizes. To six places each ratio
 * is a whole number of 2048ths, the grid these fonts are designed on, so
 * that is how it is written; four places left a 1/300-inch error after
 * fourteen grown rows.
 */
const LINE_SPACING: Record<string, number> = {
  'arial': 2355 / 2048,
  'times new roman': 2355 / 2048,
  'verdana': 2489 / 2048,
  'tahoma': 2472 / 2048,
  'segoe ui': 2724 / 2048,
  'calibri': 2500 / 2048,
  'georgia': 2327 / 2048,
  'courier new': 2320 / 2048,
  'microsoft sans serif': 2318 / 2048,
  'trebuchet ms': 2378 / 2048,
};

/*
 * A label of one line in these fonts printed shorter than one line of
 * several: without the gap the font sets between lines (s37). Arial 14pt
 * printed 17.14pt where 1.15 gives 17.6 (s31e). Two lines were twice the
 * line spacing, not one of these and one of it. Every other font measured
 * has no such gap, so its one line is its spacing.
 */
const ONE_LINE: Record<string, number> = {
  'arial': 2288 / 2048,
  'times new roman': 2268 / 2048,
};

const fontKey = (family: string | null | undefined) => {
  const key = (family ?? '').trim().toLowerCase();
  return key in LINE_SPACING ? key : 'arial';
};

/** One line's height in points. An unmeasured family takes Arial's. */
export function lineSpacingPt(family: string | null | undefined, sizePt: number): number {
  return LINE_SPACING[fontKey(family)] * sizePt;
}

/**
 * How tall `count` lines print, in points, before the 1.5pt a grown control
 * adds: one line at its own height, more at the line spacing each (row 51).
 */
export function linesHeightPt(count: number, family: string | null | undefined, sizePt: number): number {
  const key = fontKey(family);
  return count === 1 ? (ONE_LINE[key] ?? LINE_SPACING[key]) * sizePt : count * LINE_SPACING[key] * sizePt;
}

/**
 * Break text into lines no wider than `maxPt`, greedily at spaces.
 *
 * A word wider than the whole line is broken between characters, so nothing
 * is ever wider than the area. Explicit line breaks are kept, and an empty text
 * is no lines at all, which is what lets an empty `CanShrink` control collapse.
 */
export function wrapText(text: string, widthOf: (s: string) => number, maxPt: number): string[] {
  if (!text) return [];
  /*
   * Strictly narrower than the area, with one part in ten thousand to spare.
   * DevExpress measures unrounded glyph advances: 36 Courier New characters at
   * 10pt are 216.035pt, so they did not fit a 216pt area, while the browser,
   * which snaps that font's advances to whole pixels, made them exactly 216.
   * The margin absorbs that rounding; Arial's line that fitted at 215.97pt
   * still fits. Measured over 18 texts in 9 fonts against DevExpress's PDFs:
   * all 18 break identically with it, 17 without.
   */
  const fits = (s: string) => widthOf(s) * 1.0001 < maxPt;
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    /*
     * Break opportunities: at spaces, and after a hyphen inside a word.
     * DevExpress printed "...missed the cut-" with "off," on the next line in
     * Verdana and Arial Bold, so "cut-off," is two pieces, the second joining
     * the first without a space.
     */
    const pieces: { text: string; spaced: boolean }[] = [];
    for (const word of paragraph.split(/ +/).filter(Boolean)) {
      word.split(/(?<=-)(?=[^-])/).forEach((part, i) => pieces.push({ text: part, spaced: i === 0 }));
    }
    let line = '';
    for (const piece of pieces) {
      const candidate = line ? `${line}${piece.spaced ? ' ' : ''}${piece.text}` : piece.text;
      if (fits(candidate)) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      // A piece that cannot fit on a line of its own is broken by characters.
      let rest = piece.text;
      while (rest && !fits(rest)) {
        let cut = 1;
        while (cut < rest.length && fits(rest.slice(0, cut + 1))) cut++;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  // A trailing empty paragraph from a final newline prints nothing.
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** The CSS font string for a canvas, in points as the report writes them. */
export function cssFont(font: FontSpec): string {
  return `${font.italic ? 'italic ' : ''}${font.bold ? 'bold ' : ''}${font.sizePt}pt "${font.family}"`;
}

/**
 * A measurer backed by a canvas, or null where there is none.
 *
 * Null under jsdom as well as under Node, because jsdom's canvas is a stub
 * that logs an error and measures nothing; the Preview then lays text out at
 * its designed size, which is what it did before rows 7 and 8.
 *
 * It measures kerned, as a canvas does by default, though DevExpress draws
 * unkerned (row 53). DevExpress does not break lines by its drawn widths:
 * in s39b six fonts kept a line wider unkerned than its box, and the kerned
 * widths here predicted six of those seven breaks and all 18 of row 7's.
 * What DevExpress does break by is a proposed row of its own.
 */
export function canvasMeasurer(): MeasureText | null {
  const context = canvasContext();
  if (!context) return null;
  const cache = new Map<string, number>();
  return (text, font, widthPt) => {
    const css = cssFont(font);
    const widthOf = (s: string) => {
      const key = `${css}\u0000${s}`;
      let width = cache.get(key);
      if (width === undefined) {
        context.font = css;
        // Canvas measures in CSS pixels; a point is three quarters of one.
        width = context.measureText(s).width * 0.75;
        cache.set(key, width);
      }
      return width;
    };
    return wrapText(text, widthOf, widthPt);
  };
}

/** A canvas to measure on, or null under Node and jsdom, as for `canvasMeasurer`. */
function canvasContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return null;
  const context = document.createElement('canvas').getContext('2d');
  return context && typeof context.measureText === 'function' ? context : null;
}

let lineContext: CanvasRenderingContext2D | null | undefined;

/**
 * One line's width in points as it is drawn, unkerned, measured on a canvas;
 * null where there is none. For a turned label (parity row 49), whose turned
 * line the pane aligns in the label's box by its bounding box, so it needs
 * the length the line prints at. DevExpress draws text unkerned (row 53, s39):
 * s31c's turned line printed 101.2 units long, Edge's unkerned width, and
 * sat 2.2 short of it while this measured it kerned.
 */
export function lineWidthPt(text: string, font: FontSpec): number | null {
  if (lineContext === undefined) {
    lineContext = canvasContext();
    if (lineContext && 'fontKerning' in lineContext) lineContext.fontKerning = 'none';
  }
  if (!lineContext) return null;
  lineContext.font = cssFont(font);
  return lineContext.measureText(text).width * 0.75;
}
