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
 *    apart. A segment is a label or a cell.
 * 2. **Units.** Each segment's pixel box is placed on the page by
 *    `placeImage` in reportGeometry.ts, the only place a conversion is
 *    written: a rendered PDF page by its resolution, a screenshot fitted to
 *    the printable width.
 * 3. **Rows.** Segments whose vertical middles overlap form a row.
 * 4. **Tables.** Two or more consecutive rows, close together, each holding
 *    two or more segments that fall into the same columns, are a table: an
 *    XRTable with a row per row and a cell per column. Columns are the
 *    horizontal ranges the rows' segments share.
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
  /** Below this a word is flagged; 60 by default, where Tesseract's misreads begin to dominate. */
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

/** A recognized line split into segments at gaps wider than the line is tall. */
function segmentsOf(line: OcrPage['lines'][number]): Segment[] {
  const words = [...line.words].sort((a, b) => a.box.x0 - b.box.x0);
  const height = line.box.y1 - line.box.y0;
  const out: Segment[] = [];
  for (const w of words) {
    const last = out[out.length - 1];
    if (last && w.box.x0 - last.box.x1 <= height) {
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

function tableFrom(rows: DetectedText[][], cols: [number, number][]): DetectedTable {
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
 * The layout of OCR'd pages: tables and labels in page coordinates, with the
 * margins chosen so that nothing lies outside them. A rendered PDF page keeps
 * its own size; a screenshot is put on Letter with half-inch margins and fitted
 * to the printable width.
 */
export function detectLayout(sources: readonly LayoutSource[], options: LayoutOptions = {}): DetectedLayout {
  const unit = options.unit ?? 'HundredthsOfAnInch';
  const minConfidence = options.minConfidence ?? 60;
  const perInch = unitsPerInch(unit);
  let total = 0;
  let flagged = 0;
  let ignoredCount = 0;
  const pages = sources.map(({ ocr, page }) => {
    const half = perInch / 2;
    const fitted = { left: half, right: half, top: half, bottom: half };
    const at = placeImage(ocr, { width: page.width, margins: fitted }, unit);
    const read = ocr.lines.flatMap(segmentsOf).map((s) => detected(s, at, unit, minConfidence));
    // A chart's bars and a logo come back as "words" read at almost no
    // confidence, often far taller than any text: in s23-gen's PNG the bars
    // read as "- HB : ||" at 0, 168 units tall. They are pictures, and left in,
    // their boxes swallow the rows around them.
    const heights = read.map((r) => r.ink.h).sort((a, b) => a - b);
    const typical = heights[Math.floor(heights.length / 2)] ?? 0;
    const isPicture = (r: DetectedText) => r.confidence < 20 || (r.ink.h > 4 * typical && r.confidence < 50);
    const ignored = read.filter(isPicture);
    const texts = read.filter((r) => !isPicture(r));
    const rows = rowsOf(texts);
    const tables: DetectedTable[] = [];
    const labels: DetectedText[] = [];
    // Runs of consecutive multi-segment rows, close together, tried as tables.
    let i = 0;
    while (i < rows.length) {
      let j = i;
      while (
        j + 1 < rows.length && rows[j].length >= 2 && rows[j + 1].length >= 2 &&
        Math.min(...rows[j + 1].map((t) => t.y)) - Math.max(...rows[j].map((t) => t.y + t.h)) <= 1.5 * Math.max(...rows[j].map((t) => t.h))
      ) j++;
      const run = rows.slice(i, j + 1);
      const cols = run.length >= 2 ? tableColumns(run) : null;
      if (cols) {
        tables.push(tableFrom(run, cols));
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
