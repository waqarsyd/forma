/**
 * From OCR to a report layout (2026-11-01): which recognized text becomes a
 * table and which a label, where each lands in report units, and which text
 * the engine was unsure of. Pure, so every rule here is under test.
 *
 * The steps, page by page:
 *
 * 1. **Segments.** A recognized line is split where the gap between two words
 *    is wider than the line is tall: in a table row Tesseract often reads
 *    several cells as one line, and the gap between cells is what tells them
 *    apart. Two amounts side by side are split however close (2026-11-04).
 *    A segment is a label or a cell.
 * 2. **Units.** Each segment's pixel box is placed on the page by
 *    `placeImage` in reportGeometry.ts, the only place a conversion is
 *    written: a rendered PDF page by its resolution, a screenshot fitted to
 *    the printable width.
 * 3. **Rows.** Segments whose vertical middles overlap form a row.
 * 4. **Tables.** Two or more consecutive rows, close together and lined up,
 *    each holding two or more segments that fall into the same columns, are
 *    a table: an XRTable with a row per row and a cell per column. Columns are
 *    the horizontal ranges the rows' segments share. Text printed on what was
 *    set aside as a picture, a chart's values, is never a cell.
 * 5. **Labels.** Everything else is an XRLabel at its own box.
 *
 * A word below `minConfidence` is flagged, and so is any label or cell that
 * holds one, so that the preview can show it and the user decide, rather
 * than the report taking it silently.
 */
import { pixelBoxToUnits, placeImage, unitsPerInch, unitsToPoints, type ImagePlacement, type PixelBox } from './reportGeometry';
import type { OcrPage, OcrWord } from './ocr';

/**
 * Text the layout places: a label, or a table's cell. `x`, `y`, `w`, `h` are
 * the control's box, from the font's ascent to a line of its height; `ink` is
 * where the text itself was seen, which the preview draws over the source.
 * Both are page coordinates in report units.
 */
export interface DetectedText {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ink: { x: number; y: number; w: number; h: number };
  /** Its estimated font size, in points. */
  fontSize: number;
  /** Its least confident word's confidence, 0 to 100. */
  confidence: number;
  flagged: boolean;
  words: { text: string; confidence: number; flagged: boolean }[];
}

export interface DetectedTable {
  x: number;
  y: number;
  /** Each column's width, left to right. */
  columns: number[];
  rows: { y: number; h: number; cells: (DetectedText | null)[] }[];
}

export interface DetectedPage {
  width: number;
  height: number;
  margins: { left: number; right: number; top: number; bottom: number };
  labels: DetectedText[];
  tables: DetectedTable[];
  /**
   * What was read but set aside as a picture rather than text: a chart's bars or
   * a logo, read at almost no confidence or far taller than the page's text.
   * Shown in the preview, never written into the report.
   */
  ignored: DetectedText[];
}

export interface DetectedLayout {
  unit: string;
  pages: DetectedPage[];
  /** Labels and cells, and how many of them hold a low-confidence word. */
  total: number;
  flagged: number;
  /** How many readings were set aside as pictures. */
  ignored: number;
}

export interface LayoutOptions {
  unit?: string;
  /**
   * Below this a word is flagged. By default each page's own engine's
   * (`OcrPage.unsureBelow`), and 60 when it names none, where Tesseract's
   * misreads begin to dominate.
   */
  minConfidence?: number;
}

/** One OCR page, and the report page it is a picture of, in report units. */
export interface LayoutSource {
  ocr: OcrPage;
  page: { width: number; height: number };
}

interface Segment {
  text: string;
  box: PixelBox;
  words: OcrWord[];
}

/** An amount or a count, as a column of figures prints one. */
const AMOUNT = /^[-+(]?[$€£₹]?\d[\d,]*(?:[.,]\d+)?\)?%?$/;
/** Digits written with a space between thousands: "1 250.00" is one number. */
const THOUSANDS = (a: string, b: string) => /^\d{1,3}$/.test(a) && /^\d{3}(?:[.,]\d+)?$/.test(b);

/**
 * A recognized line split into segments at gaps wider than the line is tall,
 * and between two amounts side by side (2026-11-04): a column of figures sits
 * closer than that, and "894 213,086.00 184,088.14" read as one text put
 * three cells in one label, which Forma's box reader then could not call
 * totals.
 */
function segmentsOf(line: OcrPage['lines'][number]): Segment[] {
  const words = [...line.words].sort((a, b) => a.box.x0 - b.box.x0);
  const height = line.box.y1 - line.box.y0;
  const out: Segment[] = [];
  for (const w of words) {
    const last = out[out.length - 1];
    const before = last?.words[last.words.length - 1]?.text ?? '';
    const twoAmounts = AMOUNT.test(before) && AMOUNT.test(w.text) && !THOUSANDS(before, w.text);
    if (last && w.box.x0 - last.box.x1 <= height && !twoAmounts) {
      last.words.push(w);
      last.text += ` ${w.text}`;
      last.box = { x0: Math.min(last.box.x0, w.box.x0), y0: Math.min(last.box.y0, w.box.y0), x1: Math.max(last.box.x1, w.box.x1), y1: Math.max(last.box.y1, w.box.y1) };
    } else {
      out.push({ text: w.text, box: { ...w.box }, words: [w] });
    }
  }
  return out;
}

/**
 * A text's font, from how tall its ink is (2026-11-01, measured on
 * DevExpress's own PNG of s54a at 96 dpi). A capital or a digit stands about
 * 0.7 of the em and a descender adds about 0.21; text with neither stands at
 * its x-height, about half the em. So "Customer 01", 9 pixels of ink, is a
 * 12.9-pixel em, 9.75pt, and "Sales report", 12 pixels with its descender,
 * 13.2. Returns the size in half points from 6 to 48, the em in report units,
 * and how far the font's ascent sits above the ink's top.
 */
export function fontFromInk(text: string, inkHeight: number, unit: string): { size: number; em: number; above: number } {
  const tall = /[A-Z0-9bdfhkl]/.test(text) || /t/.test(text);
  const ratio = (tall ? 0.7 : 0.5) + (/[gjpqy,;]/.test(text) ? 0.21 : 0);
  const em = inkHeight / ratio;
  const pt = unitsToPoints(em, unit);
  return { size: Math.min(48, Math.max(6, Math.round(pt * 2) / 2)), em, above: (tall ? 0.22 : 0.4) * em };
}

/**
 * A text's font size in half points from how WIDE its ink is: the em widths
 * of its characters, between Arial's and Times New Roman's, summed. Rougher
 * than the height, since the face is unknown, but a cell's grid lines run
 * across it and never widen it. In s23-gen's cross-tab, read at 96 dpi, 28 of
 * 34 words came back as tall as their cells, 24.5pt by their height, and the
 * printed 9.75pt by their width.
 */
export function fontFromWidth(text: string, inkWidth: number, unit: string): number {
  const ems = [...text].reduce(
    (s, c) => s + (/[0-9]/.test(c) ? 0.53 : /[A-Z]/.test(c) ? 0.68 : /[a-z]/.test(c) ? 0.47 : /\s/.test(c) ? 0.26 : 0.33),
    0,
  );
  const pt = ems > 0 ? unitsToPoints(inkWidth, unit) / ems : 48;
  return Math.min(48, Math.max(6, Math.round(pt * 2) / 2));
}

function detected(seg: Segment, at: ImagePlacement, unit: string, minConfidence: number): DetectedText {
  const ink = pixelBoxToUnits(seg.box, at);
  const font = fontFromInk(seg.text, ink.h, unit);
  const words = seg.words.map((w) => ({ text: w.text, confidence: Math.round(w.confidence), flagged: w.confidence < minConfidence }));
  return {
    text: seg.text,
    x: ink.x,
    y: ink.y - font.above,
    w: ink.w,
    h: font.em * 1.2,
    ink,
    fontSize: font.size,
    confidence: Math.round(Math.min(...seg.words.map((w) => w.confidence))),
    flagged: words.some((w) => w.flagged),
    words,
  };
}
/** Segments grouped into rows by overlapping vertical middles, top to bottom. */
function rowsOf(texts: DetectedText[]): DetectedText[][] {
  const sorted = [...texts].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows: DetectedText[][] = [];
  for (const t of sorted) {
    const row = rows[rows.length - 1];
    const mid = t.y + t.h / 2;
    if (row && row.some((r) => mid >= r.y && mid <= r.y + r.h)) row.push(t);
    else rows.push([t]);
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x));
}

/**
 * Whether the next row continues a table: at least two of each row's texts
 * overlap one of the other's across, and at most one of either is left over,
 * which allows an empty cell. Being close is not enough. On a chart a row of
 * bar values sits just above the cross-tab printed under it, and in s23-gen
 * the two were read as one table until rows had to line up as well.
 */
function linesUp(a: DetectedText[], b: DetectedText[]): boolean {
  const across = (s: DetectedText, t: DetectedText) => Math.min(s.x + s.w, t.x + t.w) > Math.max(s.x, t.x);
  const inA = a.filter((s) => b.some((t) => across(s, t))).length;
  const inB = b.filter((t) => a.some((s) => across(s, t))).length;
  return Math.min(inA, inB) >= 2 && a.length - inA <= 1 && b.length - inB <= 1;
}

/** Whether most of a text's ink lies inside a reading set aside as a picture: a value printed on a chart's bar. */
function inPicture(t: DetectedText, pictures: readonly DetectedText[]): boolean {
  const area = Math.max(1e-6, t.ink.w * t.ink.h);
  return pictures.some((p) => {
    const w = Math.min(t.ink.x + t.ink.w, p.ink.x + p.ink.w) - Math.max(t.ink.x, p.ink.x);
    const h = Math.min(t.ink.y + t.ink.h, p.ink.y + p.ink.h) - Math.max(t.ink.y, p.ink.y);
    return w > 0 && h > 0 && w * h > area / 2;
  });
}
/** The horizontal ranges a run of rows' segments share: overlapping ranges merged into one column. */
function columnsOf(rows: DetectedText[][]): [number, number][] {
  const ranges = rows.flat().map((t) => [t.x, t.x + t.w] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}

/** Whether a run of rows reads as a table: two or more columns, no row with two segments in one. */
function tableColumns(rows: DetectedText[][]): [number, number][] | null {
  if (rows.length < 2) return null;
  const cols = columnsOf(rows);
  if (cols.length < 2) return null;
  for (const row of rows) {
    const used = row.map((t) => cols.findIndex(([a, b]) => t.x >= a - 1e-6 && t.x <= b));
    if (new Set(used).size !== used.length) return null;
  }
  return cols;
}

function tableFrom(rows: DetectedText[][], cols: [number, number][], unit: string): DetectedTable {
  // One font for the table, the median of its cells'. Each cell's is the
  // smaller of its height's and its width's: where Tesseract's boxes take in
  // the cell borders, as in s23-gen's cross-tab, the height reads far too tall
  // and the width does not.
  const sizes = rows
    .flat()
    .map((t) => Math.min(t.fontSize, fontFromWidth(t.text, t.ink.w, unit)))
    .sort((a, b) => a - b);
  const size = sizes[Math.floor(sizes.length / 2)];
  rows = rows.map((row) => row.map((t) => ({ ...t, fontSize: size })));
  // Cell edges halfway between columns, the outer ones at the columns' own.
  const edges = [cols[0][0], ...cols.slice(1).map(([a], i) => (cols[i][1] + a) / 2), cols[cols.length - 1][1]];
  const top = (row: DetectedText[]) => Math.min(...row.map((t) => t.y));
  const bottom = (row: DetectedText[]) => Math.max(...row.map((t) => t.y + t.h));
  return {
    x: edges[0],
    y: top(rows[0]),
    columns: edges.slice(1).map((e, i) => e - edges[i]),
    rows: rows.map((row, i) => {
      const y = top(row);
      const next = rows[i + 1];
      return {
        y,
        h: next ? top(next) - y : bottom(row) - y,
        cells: cols.map(([a, b]) => row.find((t) => t.x >= a - 1e-6 && t.x <= b) ?? null),
      };
    }),
  };
}

/**
 * Where a page image lands on its report page: a rendered PDF page by its
 * resolution, a screenshot with its page's shape across the whole page
 * (2026-11-03), any other screenshot fitted to the printable width inside
 * half-inch margins. `detectLayout` places every text by it, and the preview
 * draws the image by it, so the two always agree.
 */
export function placementFor(ocr: OcrPage, page: { width: number; height?: number }, unit: string): ImagePlacement {
  const half = unitsPerInch(unit) / 2;
  return placeImage(ocr, { width: page.width, height: page.height, margins: { left: half, right: half, top: half } }, unit);
}

/**
 * The layout of OCR'd pages: tables and labels in page coordinates, with the
 * margins chosen so that nothing lies outside them. A rendered PDF page keeps
 * its own size; a screenshot with a paper's shape is that whole page, and any
 * other is put on the configured paper with half-inch margins and fitted to
 * the printable width (`pageForImage` and `placeImage` in reportGeometry.ts).
 */
export function detectLayout(sources: readonly LayoutSource[], options: LayoutOptions = {}): DetectedLayout {
  const unit = options.unit ?? 'HundredthsOfAnInch';
  const perInch = unitsPerInch(unit);
  let total = 0;
  let flagged = 0;
  let ignoredCount = 0;
  const pages = sources.map(({ ocr, page }) => {
    const half = perInch / 2;
    const fitted = { left: half, right: half, top: half, bottom: half };
    const at = placementFor(ocr, page, unit);
    const minConfidence = options.minConfidence ?? ocr.unsureBelow ?? 60;
    const read = ocr.lines.flatMap(segmentsOf).map((s) => detected(s, at, unit, minConfidence));
    // A chart's bars and a logo come back as "words" read at almost no
    // confidence, often far taller than any text: in s23-gen's PNG the bars
    // read as "- HB : ||" at 0, 168 units tall. They are pictures, and left in,
    // their boxes swallow the rows around them.
    const heights = read.map((r) => r.ink.h).sort((a, b) => a - b);
    const typical = heights[Math.floor(heights.length / 2)] ?? 0;
    // A reading with no letter or digit in it, read without confidence, is a
    // rule, a tick mark or a border: in s23-gen the axis ticks read as "|]".
    // So is a character or two standing far taller than the page's text: the
    // same chart's bars read as "B" and "|" at three times its height.
    const isPicture = (r: DetectedText) =>
      r.confidence < 20 ||
      (r.ink.h > 4 * typical && r.confidence < 50) ||
      (r.ink.h > 2.5 * typical && r.text.replace(/\s/g, '').length <= 2) ||
      (!/[\p{L}\p{N}]/u.test(r.text) && r.confidence < 60);
    const ignored = read.filter(isPicture);
    const texts = read.filter((r) => !isPicture(r));
    // Text printed on a picture, a chart's values, stays a label: it is not a table.
    const onPicture = texts.filter((r) => inPicture(r, ignored));
    const rows = rowsOf(texts.filter((r) => !onPicture.includes(r)));
    const tables: DetectedTable[] = [];
    const labels: DetectedText[] = [...onPicture];
    // Runs of consecutive multi-segment rows, close together and lined up, tried as tables.
    let i = 0;
    while (i < rows.length) {
      let j = i;
      while (
        j + 1 < rows.length && rows[j].length >= 2 && rows[j + 1].length >= 2 &&
        Math.min(...rows[j + 1].map((t) => t.y)) - Math.max(...rows[j].map((t) => t.y + t.h)) <= 1.5 * Math.max(...rows[j].map((t) => t.h)) &&
        linesUp(rows[j], rows[j + 1])
      ) j++;
      const run = rows.slice(i, j + 1);
      const cols = run.length >= 2 ? tableColumns(run) : null;
      if (cols) {
        tables.push(tableFrom(run, cols, unit));
        i = j + 1;
      } else {
        labels.push(...rows[i]);
        i++;
      }
    }
    const all = [...labels, ...tables.flatMap((t) => t.rows.flatMap((r) => r.cells.filter((c): c is DetectedText => !!c)))];
    total += all.length;
    flagged += all.filter((t) => t.flagged).length;
    // Margins no wider than the content allows: a word half an inch from the
    // edge cannot sit inside a one-inch margin.
    const minX = Math.min(...all.map((t) => t.x), ...tables.map((t) => t.x));
    const maxX = Math.max(...all.map((t) => t.x + t.w), ...tables.map((t) => t.x + t.columns.reduce((s, w) => s + w, 0)));
    const minY = Math.min(...all.map((t) => t.y));
    const maxY = Math.max(...all.map((t) => t.y + t.h));
    const fit = (want: number, room: number) => Math.max(0, Math.min(want, Number.isFinite(room) ? Math.floor(room) : want));
    const margins = all.length
      ? { left: fit(half, minX), right: fit(half, page.width - maxX), top: fit(half, minY), bottom: fit(half, page.height - maxY) }
      : fitted;
    ignoredCount += ignored.length;
    return { width: page.width, height: page.height, margins, labels, tables, ignored };
  });
  return { unit, pages, total, flagged, ignored: ignoredCount };
}

/**
 * A detected page as text for the model, sent the way a PDF's text layer is:
 * every string with its box in report units from the paper's top-left corner,
 * so the model places it where OCR saw it rather than estimating again from
 * the pixels. Unlike a text layer this was measured from an image, and the
 * header says so: a size is estimated from the letters, and a string marked
 * LOW CONFIDENCE is to be read from the image. Tables are listed as tables, so
 * the model writes an XRTable rather than a grid of labels. What was set aside
 * as a picture is left out.
 */
export function layoutText(page: DetectedPage, pageNumber: number, unit: string, file: string): string {
  const r = (v: number) => Math.round(v);
  const one = (t: DetectedText) =>
    `"${t.text.replace(/"/g, "'")}" x=${r(t.x)} y=${r(t.y)} w=${r(t.w)} h=${r(t.h)} size=${t.fontSize}pt` +
    (t.flagged ? ` LOW CONFIDENCE (${Math.round(t.confidence)})` : '');
  const lines = [
    `${file}, page ${pageNumber}: text READ BY OCR from the page image, in the browser. ` +
      `Positions were measured from the image and are in report units (${unit}), origin at the top-left of the paper; ` +
      `x/y/w/h is each string's control box, from the top of its font to a line's height, and size is its font size in points, estimated from the height of its letters.`,
    `Page is ${r(page.width)} x ${r(page.height)} report units.`,
    ...[...page.labels].sort((a, b) => a.y - b.y || a.x - b.x).map(one),
  ];
  page.tables.forEach((table, i) => {
    const columns = table.columns.map(r).join(', ');
    lines.push(`Table ${i + 1}: x=${r(table.x)} y=${r(table.y)}, ${table.columns.length} columns of widths ${columns}, ${table.rows.length} rows:`);
    for (const row of table.rows) {
      lines.push(`  row y=${r(row.y)} h=${r(row.h)}: ` + row.cells.map((c) => (c ? one(c) : '(empty)')).join(' | '));
    }
  });
  return lines.join('\n');
}