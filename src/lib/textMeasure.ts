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
 *   and Times New Roman 1.15, Verdana 1.2153, Tahoma 1.207, Segoe UI 1.33,
 *   Calibri 1.221, Georgia 1.1363, Courier New 1.1328. Bold does not change it.
 * - **A grown control is the lines plus 1.5pt**, plus its vertical padding and
 *   its top and bottom borders: three lines of Arial 9pt printed 32.544pt
 *   against 3 x 10.35 + 1.5 = 32.55; ten hundredths of padding and a 3px
 *   border each added exactly their own height.
 * - **A control that shrinks uses 1.17pt rather than 1.5pt**, measured at
 *   9pt and 10pt, and an empty one shrinks to nothing.
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

/** Added to the lines of a control that GROWS. Measured: 1.5pt at every font and size. */
export const GROW_EXTRA_PT = 1.5;

/** Added to the lines of a control that SHRINKS. Measured at 9pt and 10pt Arial. */
export const SHRINK_EXTRA_PT = 1.17;

/** Line spacing over font size, by family, as DevExpress printed each one. */
const LINE_SPACING: Record<string, number> = {
  'arial': 1.15,
  'times new roman': 1.15,
  'verdana': 1.2153,
  'tahoma': 1.207,
  'segoe ui': 1.33,
  'calibri': 1.221,
  'georgia': 1.1363,
  'courier new': 1.1328,
};

/** One line's height in points. An unmeasured family takes Arial's 1.15. */
export function lineSpacingPt(family: string | null | undefined, sizePt: number): number {
  return (LINE_SPACING[(family ?? '').trim().toLowerCase()] ?? 1.15) * sizePt;
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
 * One line's width in points, measured on a canvas; null where there is none.
 * For a turned label (parity row 49), whose turned line the pane aligns in the
 * label's box by its bounding box, so it needs the line's length.
 */
export function lineWidthPt(text: string, font: FontSpec): number | null {
  if (lineContext === undefined) lineContext = canvasContext();
  if (!lineContext) return null;
  lineContext.font = cssFont(font);
  return lineContext.measureText(text).width * 0.75;
}
