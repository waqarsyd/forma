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
 * - **A line's width is Windows GDI's, kerned as GDI kerns it**, though the
 *   page draws it unkerned (parity row 59, s43a to s43l): boxes stepping a
 *   thousandth of a unit at a time wrapped exactly where GDI's width of the
 *   text left the box, in ten fonts, four styles and five sizes. GDI leaves
 *   56 installed families and Segoe UI's italics unkerned, Tahoma among them,
 *   which the browser kerns all the same (row 61).
 * - **One line is short only when it fits unkerned**: a line that fits its
 *   box kerned but not unkerned printed at the full line spacing (s39b, s43).
 * - **A synthesized bold is its regular, widened**: a family with no bold face,
 *   such as Microsoft Sans Serif, broke its bold at its regular width plus
 *   41/2048 of an em for every character but a space (row 60, s44a).
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
export interface MeasureText {
  (text: string, font: FontSpec, widthPt: number): string[];
  /**
   * Whether a line is no wider than `widthPt` unkerned, which decides whether
   * one line of Arial or Times New Roman prints at its shorter height (row
   * 59). Absent, every line counts as fitting, as before that row.
   */
  fitsUnkerned?(text: string, font: FontSpec, widthPt: number): boolean;
}

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
 * has no such gap, so its one line is its spacing. A line that fits its box
 * only kerned prints at the full spacing all the same (row 59): in s43 Arial
 * 20pt "AVATAR Wave To LT Yo" was one line from 293.342 units wide, its
 * kerned width, and short only from 311.822, its unkerned one.
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
 * `short` false is one line that fits its box only kerned, which takes the
 * full spacing (row 59).
 */
export function linesHeightPt(count: number, family: string | null | undefined, sizePt: number, short = true): number {
  const key = fontKey(family);
  return count === 1 && short ? (ONE_LINE[key] ?? LINE_SPACING[key]) * sizePt : count * LINE_SPACING[key] * sizePt;
}

/*
 * How far past its box a line may reach and still fit, as a fraction of the
 * box. Texts with nothing to kern pin it, in every font, size and style of
 * s43 (row 59): 111 labels within a ten-thousandth of their box agreed on
 * between 22.3 and 22.8 millionths, Courier New 10pt's 166.6938-unit line
 * wrapping in a 166.69 box. Kerned texts scatter around it by a few
 * millionths, DevExpress's kerning rounding a little differently from the
 * browser's: Calibri 9pt's 111.853 fitted 111.85, and Arial 20pt's 293.349
 * fitted 293.342 but not 293.341 (s43j, a thousandth of a unit at a time).
 */
const FIT_SLACK = 1 + 22.5e-6;

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
   * No wider than the area, give or take FIT_SLACK. DevExpress measures
   * unrounded glyph advances: 36 Courier New characters at 10pt are
   * 216.035pt, so they did not fit a 216pt area, while Arial's line of
   * 215.97pt did. Until row 59 this asked for a line strictly narrower by one
   * part in ten thousand, which absorbed the browser rounding the font size
   * at 10pt (see canvasMeasurer) and wrapped a line that fitted by less.
   */
  const fits = (s: string) => widthOf(s) <= maxPt * FIT_SLACK;
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

/*
 * The font size the canvas measures at, in pixels, scaled down after. A whole
 * number of pixels because the browser rounds a fractional font size down to
 * a hundredth of a pixel: 10pt is 13.333px and measured as 13.33, a quarter
 * of a thousandth short, which at 20pt is 0.08 units on a 300-unit line and
 * was enough to fit Trebuchet MS's 267.022-unit line in a 267.0 box. At 2048px
 * every advance of a 2048-unit font is a whole pixel, and in Chrome every
 * width of s43 came out within a thousandth of a unit of GDI's.
 */
const MEASURE_PX = 2048;

/*
 * Families Windows GDI does not kern in any style, though the browser kerns
 * them (parity rows 59 and 61): every family on the measuring machine whose
 * text GDI laid out at its plain advances while Chrome kerned it, 151 faces
 * in all. Tahoma was measured in s43a; Century and Franklin Gothic Book
 * Bold in s44a; and in s45a Arial Narrow, Garamond, Gill Sans MT, Bodoni MT,
 * Goudy Old Style, Leelawadee UI, Franklin Gothic Book, Rockwell and Tw Cen
 * MT, regular, bold, italic and bold italic among them, each wrapped until its
 * box reached its unkerned width, to a hundredth of a unit.
 */
const GDI_UNKERNED = new Set([
  'arial narrow', 'bell mt', 'bernard mt condensed', 'bodoni mt', 'bodoni mt black',
  'bodoni mt condensed', 'broadway', 'brush script mt', 'buxton sketch', 'calisto mt',
  'castellar', 'centaur', 'century', 'colonna mt', 'cooper black',
  'copperplate gothic light', 'curlz mt', 'engravers mt', 'felix titling',
  'footlight mt light', 'forte', 'franklin gothic book', 'franklin gothic heavy',
  'french script mt', 'garamond', 'gill sans mt', 'gill sans mt condensed',
  'goudy old style', 'juice itc', 'leelawadee ui', 'maiandra gd', 'malgun gothic',
  'matura mt script capitals', 'microsoft himalaya', 'microsoft jhenghei',
  'microsoft jhenghei ui', 'microsoft yahei', 'microsoft yahei light', 'microsoft yahei ui',
  'microsoft yahei ui light', 'mongolian baiti', 'ms reference sans serif',
  'old english text mt', 'onyx', 'perpetua', 'perpetua titling mt', 'rockwell',
  'rockwell condensed', 'segoe marker', 'segoe ui emoji', 'segoe ui historic',
  'segoe ui symbol', 'snap itc', 'tahoma', 'tw cen mt', 'tw cen mt condensed',
]);

/* Families GDI kerns upright and not in italic. */
const GDI_UNKERNED_ITALIC = new Set(['segoe ui', 'segoe ui light', 'segoe ui semibold']);

/**
 * Whether Windows GDI kerns a face, which DevExpress breaks lines by. It
 * kerned every face measured but those listed above, which the browser
 * kerns: in s43k Segoe UI Italic's line wrapped until its box reached 286.14,
 * its unkerned width, where Chrome kerns it to 272.90. A family the machine
 * did not have is taken to be kerned, as most measured families are.
 */
export function gdiKerns(font: FontSpec): boolean {
  const family = font.family.trim().toLowerCase();
  if (GDI_UNKERNED.has(family)) return false;
  return !(font.italic && GDI_UNKERNED_ITALIC.has(family));
}

/*
 * Families with no bold face, whose bold Windows synthesizes (parity row 60):
 * every family on the Windows Server 2019 machine DevExpress was measured on
 * whose bold GDI+ widened every character by the same share of the em, which
 * a drawn bold face never does. Not the Chinese, Japanese and Korean ones,
 * such as MS Gothic and SimSun, whose bold DevExpress widened by about a
 * sixth of that in s44b. The browser cannot tell these apart itself: given a
 * bold of Cambria Math it measures another face's bold, and it widens no
 * synthesized bold at all.
 */
const SYNTHESIZED_BOLD = new Set([
  '3 of 9 barcode', 'algerian', 'arial unicode ms', 'baskerville old face', 'bauhaus 93',
  'bernard mt condensed', 'blackadder itc', 'bradley hand itc', 'broadway', 'buxton sketch',
  'cambria math', 'castellar', 'centaur', 'century', 'chiller', 'code39azaleanarrow1',
  'code39azaleanarrow2', 'code39azaleanarrow3', 'code39azalearegular1',
  'code39azalearegular2', 'code39azalearegular3', 'code39azaleawide1', 'code39azaleawide2',
  'code39azaleawide3', 'colonna mt', 'curlz mt', 'edwardian script itc', 'elephant',
  'engravers mt', 'felix titling', 'forte', 'franklin gothic book', 'freestyle script',
  'french script mt', 'gabriola', 'gigi', 'gill sans mt condensed',
  'gloucester mt extra condensed', 'goudy stout', 'haettenschweiler', 'harrington',
  // Imprint MT's shadowed face, its last word escaped: Tailwind's scan of the
  // source took the word for its utility class of that name and generated
  // 244 bytes of CSS that nothing uses, caught by check:size.
  'high tower text', 'impact', 'imprint mt s\u0068adow', 'informal roman', 'ink free',
  'javanese text', 'jokerman', 'juice itc', 'kristen itc', 'kunstler script',
  'lucida console', 'lucida sans unicode', 'maiandra gd', 'matura mt script capitals',
  'microsoft himalaya', 'microsoft sans serif', 'microsoft yi baiti', 'mistral',
  'modern no. 20', 'mongolian baiti', 'ms outlook', 'ms reference sans serif',
  'ms reference specialty', 'mv boli', 'niagara engraved', 'niagara solid',
  'ocr a extended', 'old english text mt', 'onyx', 'papyrus', 'parchment', 'playbill',
  'poor richard', 'pristina', 'ravie', 'segoe marker', 'segoe mdl2 assets',
  'segoe ui emoji', 'segoe ui historic', 'segoe ui symbol', 'showcard gothic',
  'sketchflow print', 'snap itc', 'stencil', 'sylfaen', 'symbol', 'tempus sans itc',
  'viner hand itc', 'vladimir script', 'webdings', 'wide latin', 'wingdings', 'wingdings 2',
  'wingdings 3',
]);

/*
 * How far a synthesized bold widens each character but a space, as a share of
 * the em: 41/2048, GDI+'s at every size from 8 to 20pt (row 60). A space is
 * not widened. A font designed on 1000 units widens by 20 of them, which is
 * within a thousandth of this.
 */
const SYNTHESIZED_BOLD_EM = 41 / 2048;

/** Whether a font's bold is synthesized, so measured as its regular widened. */
export function synthesizedBold(font: FontSpec): boolean {
  return font.bold && SYNTHESIZED_BOLD.has(font.family.trim().toLowerCase());
}

/** Points a synthesized bold adds to a text's regular width; 0 for any other font. */
export function boldWideningPt(text: string, font: FontSpec): number {
  if (!synthesizedBold(font)) return 0;
  return [...text].filter((ch) => ch !== ' ').length * SYNTHESIZED_BOLD_EM * font.sizePt;
}

/** The CSS font string a measuring canvas uses: MEASURE_PX pixels. */
function measureFont(font: FontSpec): string {
  return `${font.italic ? 'italic ' : ''}${font.bold ? 'bold ' : ''}${MEASURE_PX}px "${font.family}"`;
}

/**
 * A measurer backed by a canvas, or null where there is none.
 *
 * Null under jsdom as well as under Node, because jsdom's canvas is a stub
 * that logs an error and measures nothing; the Preview then lays text out at
 * its designed size, which is what it did before rows 7 and 8.
 *
 * It breaks lines by widths kerned as GDI kerns, though DevExpress draws
 * unkerned (row 53), and answers `fitsUnkerned` from the unkerned widths it
 * draws at (row 59). Both are measured at MEASURE_PX and scaled to the size.
 * A synthesized bold is its regular widened (row 60): in s44a Impact Bold's
 * line fitted from 246.92 units, GDI's kerned regular plus the widening.
 */
export function canvasMeasurer(): MeasureText | null {
  const context = canvasContext();
  if (!context) return null;
  const cache = new Map<string, number>();
  // A width in points: at MEASURE_PX pixels an em is MEASURE_PX wide, and at
  // the font's size it is that many points.
  const widthPt = (s: string, font: FontSpec, kerned: boolean) => {
    const synthesized = synthesizedBold(font);
    const css = measureFont(synthesized ? { ...font, bold: false } : font);
    const key = `${css}\u0000${kerned ? 'k' : 'u'}\u0000${s}`;
    let width = cache.get(key);
    if (width === undefined) {
      context.font = css;
      if ('fontKerning' in context) context.fontKerning = kerned ? 'normal' : 'none';
      width = context.measureText(s).width;
      cache.set(key, width);
    }
    return (width * font.sizePt) / MEASURE_PX + boldWideningPt(s, font);
  };
  const measure: MeasureText = (text, font, maxPt) => {
    const kerned = gdiKerns(font);
    return wrapText(text, (s) => widthPt(s, font, kerned), maxPt);
  };
  /*
   * Exact, with no slack: in s43j Arial's 311.822-unit line was short in a
   * 311.822 box and not in 311.821, and Times New Roman's 307.020-unit line
   * in a 307.021 box and not in 307.020.
   */
  measure.fitsUnkerned = (text, font, maxPt) => widthPt(text, font, false) <= maxPt * (1 + 1e-9);
  return measure;
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
