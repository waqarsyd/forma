/**
 * How closely a report prints where its page printed, and the geometry moved
 * until it does, with no AI (2026-11-11, the full audit's CC-07).
 *
 * The Claude Code reference compared each print of its reports with the page,
 * line by line, and moved what measured wrong: on the invoice everything from
 * BILL TO down printed 3 to 4 px low, so it took the report header from 229
 * to 227; on the sales report everything from the table down was 7 px low and
 * the footer 4 px high. Each change was kept because it measured better, and
 * agreement went from 93.7% to 97.4% and from 68.7% to 95.6%. Forma compared
 * text presence only (`readCoverage.ts`), and its AI's invoice sat 0.25 in
 * right of the page, the margin declared and drawn too, which a position check
 * finds at once.
 *
 * - **Agreement is by text, not ink**, so it runs in Node and the browser
 *   without drawing anything: each text OCR read on the page (`PageText`,
 *   its ink's box on the paper, as Forma's draft is written from) is paired
 *   with the same words on the report's first printed page (`paginate`, with
 *   the page's own records), and a pair agrees when it sits within
 *   `tolerance`, 3 px of the picture by default (150 dpi when its dpi is
 *   not known). Recall over the page's
 *   texts, precision over the printed ones, and their harmonic mean.
 * - **Down the page, by the middle of the ink.** PaddleOCR grows its boxes
 *   past the ink by the same on every side, so their tops read 3 to 5 px high
 *   on the invoice and by more for larger text, but their middles stay where
 *   the ink's is. A printed line's ink middle is worked out from its font as
 *   OCR's own sizes are (`fontFromInk`): capitals stand about 0.72 of the em
 *   below the ascent, a descender adds about 0.21. Across, by the left edge
 *   of the ink, which OCR reads well; for a printed text aligned right or
 *   centred only when its width can be measured in its face.
 * - **The fit** (`fitGeometry`) tries, in print order, each band whose texts
 *   sit off: the height of the band printed before it, which moves this one
 *   and everything after (the reference's own fix on both pages), or moving
 *   its controls by its offset; and, when the whole page sits across from
 *   where it printed, every control by that much. A change is kept only when
 *   agreement rises, at most three passes, and never a margin band's height,
 *   which is the margin, or a Detail band's, which is every record's.
 */
import { insetsPt, paginate, parseReportStructure, type Appearance, type PreviewControl, type PaginatedReport, type RecordValues } from './reportPreview';
import { pointsToUnits, unitsPerInch } from './reportGeometry';
import { linesHeightPt, lineSpacingPt, wrapText, type MeasureText } from './textMeasure';
import { faceWidths, type FaceWidth } from './ocrLayout';
import type { PageText } from './skeletonRepx';

/** One text where it sits on the page: its ink's left edge (null where it cannot be known) and its ink's middle, in report units. */
export interface PlacedText {
  text: string;
  /** The text compared: no markup, no case, one space between words. */
  key: string;
  x: number | null;
  y: number;
  /** The band it printed in; null for the page's own. */
  band: string | null;
}

export interface Agreement {
  /** The harmonic mean of recall and precision, 0 to 1. */
  score: number;
  recall: number;
  precision: number;
  /** Texts paired by their words, and of those, how many sit within the tolerance. */
  paired: number;
  within: number;
  /** Each band's median vertical offset from the page, in report units: + prints low. */
  bands: Record<string, number>;
  /** The bands in the order they print on the first page. */
  order: string[];
  /** The median horizontal offset, + prints right of the page; null when no left edge could be compared. */
  dx: number | null;
}

export interface AgreementOptions {
  /** The page's records, which the Detail band prints. */
  rows?: readonly RecordValues[] | null;
  /** How text is measured as it prints; by default the faces' own widths (`measurerFrom`), null for none. */
  measure?: MeasureText | null;
  /** How a text's width is measured, for one aligned right or centred; `faceWidths()` by default. */
  widthOf?: FaceWidth;
  /** Within this, in report units, a pair agrees: 3 px of the picture by default. */
  tolerance?: number;
  /** The picture's dots per inch, for the default tolerance; 150 when not known. */
  dpi?: number;
}

const keyOf = (text: string) => text.replace(/<[^>]+>/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The default tolerance: 3 px at the picture's dpi, in the report's unit, so
 * a 300 dpi scan is held to half the distance a 150 dpi one is. 150 when the
 * dpi is not known or not a usable number: the draft's texts reach here in
 * hundredths of an inch, without it (2026-11-11).
 */
export const defaultTolerance = (unit: string, dpi?: number) =>
  (unitsPerInch(unit) * 3) / (dpi && Number.isFinite(dpi) && dpi > 0 ? dpi : 150);

/** The texts OCR read on the first page, each by its ink's left edge and middle, on the paper. */
export function sourceTexts(texts: readonly PageText[] | null | undefined): PlacedText[] {
  return (texts ?? []).flatMap((t) => {
    const key = keyOf(t.text);
    return key ? [{ text: t.text, key, x: t.x, y: t.y + t.h / 2, band: null }] : [];
  });
}

/**
 * Where a printed line's ink sits under its top, in ems, as `fontFromInk`
 * reads OCR's: the ascent about 0.905 of the em (Arial's), capitals and
 * ascenders 0.716 of it, lowercase alone half, a descender 0.21 below.
 */
function inkMiddle(text: string, em: number): number {
  const tall = /[A-Z0-9bdfhklt]/.test(text);
  const top = (0.905 - (tall ? 0.716 : 0.519)) * em;
  const bottom = (0.905 + (/[gjpqy,;]/.test(text) ? 0.21 : 0)) * em;
  return (top + bottom) / 2;
}

/**
 * Lines broken by a face's own widths, for a print where no canvas measures
 * (Node): without it nothing grows, and the Claude Code reference's sales
 * report printed its table 7 px lower in DevExpress than an unmeasured print
 * puts it, because its heading grew. Null when the faces cannot be measured.
 */
export function measurerFrom(widthOf: FaceWidth): MeasureText | null {
  if (widthOf('Ab', { family: 'Arial', bold: false }) === null) return null;
  return (text, font, maxPt) => wrapText(text, (s) => (widthOf(s, { family: font.family, bold: font.bold, italic: font.italic }) ?? s.length * 0.55) * font.sizePt, maxPt);
}

/** The report printed with the page's records, and each text on its first page where it prints. */
export function printedTexts(xml: string, options: AgreementOptions = {}): { texts: PlacedText[]; report: PaginatedReport | null } {
  const structure = parseReportStructure(xml);
  if (!structure.bands.length) return { texts: [], report: null };
  const rows = options.rows?.length ? [...options.rows] : null;
  const widthOf = options.widthOf ?? faceWidths();
  const measure = options.measure !== undefined ? options.measure : measurerFrom(widthOf);
  const report = paginate(structure, rows?.length ?? 1, { rows, measure, maxPages: 3 });
  const page = report.pages[0];
  if (!page) return { texts: [], report };
  const unit = structure.unit;
  const units = (pt: number) => pointsToUnits(pt, unit);
  const out: PlacedText[] = [];

  /** One text in its box: where its left edge and its first line's top fall. */
  const place = (
    text: string | null | undefined,
    box: { left: number; top: number; width: number; height: number },
    look: { align: 'left' | 'center' | 'right'; vAlign: 'top' | 'middle' | 'bottom'; appearance: Appearance; borders: PreviewControl['borders']; fontFamily: string | null; fontSize: number | null; bold: boolean; italic: boolean },
    lines: readonly string[] | null,
    band: string,
  ) => {
    const all = (lines ?? [text ?? '']).filter((l) => keyOf(l));
    if (!all.length) return;
    const inset = insetsPt(look.appearance, look.borders);
    const [l, r, t, b] = [inset.left, inset.right, inset.top, inset.bottom].map(units);
    const size = look.fontSize ?? 9;
    const style = { bold: look.bold, italic: look.italic };
    const tall = units(linesHeightPt(all.length, look.fontFamily, size, true, style));
    const room = box.height - t - b;
    const top = box.top + t + (look.vAlign === 'middle' ? (room - tall) / 2 : look.vAlign === 'bottom' ? room - tall : 0);
    const spacing = units(lineSpacingPt(look.fontFamily, size, style));
    all.forEach((line, i) => {
      let x: number | null = box.left + l;
      if (look.align !== 'left') {
        const at1 = widthOf(line.replace(/<[^>]+>/g, ''), { family: look.fontFamily ?? 'Arial', bold: look.bold, italic: look.italic });
        const w = at1 === null ? null : units(at1 * size);
        x = w === null ? null : look.align === 'right' ? box.left + box.width - r - w : box.left + l + (box.width - l - r - w) / 2;
      }
      const key = keyOf(line);
      if (key) out.push({ text: line, key, x, y: top + i * spacing + inkMiddle(line.replace(/<[^>]+>/g, ''), units(size)), band });
    });
  };

  for (const placed of page.bands) {
    const band = placed.band.name;
    for (const pc of placed.controls) {
      const c = pc.control;
      if (!c.visible) continue;
      const left = placed.left + c.x + c.offsetX;
      const top = placed.top + pc.y;
      if (c.type === 'XRTable') {
        const texts = pc.cellTexts ?? [];
        const heights = pc.rowHeights ?? texts.map(() => c.height / Math.max(1, c.rows.length));
        let y = top;
        texts.forEach((cells, r) => {
          const row = c.rows[pc.rowStart + r];
          if (row) {
            const total = row.cells.reduce((s, cell) => s + Math.max(0.01, cell.weight), 0) || 1;
            let x = left;
            row.cells.forEach((cell, k) => {
              const w = (c.width * Math.max(0.01, cell.weight)) / total;
              place(cells[k], { left: x, top: y, width: w, height: heights[r] ?? 0 }, cell, null, band);
              x += w;
            });
          }
          y += heights[r] ?? 0;
        });
        continue;
      }
      if (pc.text === null) continue;
      place(pc.text, { left, top, width: c.width, height: pc.height }, c, pc.lines, band);
    }
  }
  return { texts: out, report };
}

/** Pair each page text with the nearest unpaired printed one of the same words. */
function pair(source: readonly PlacedText[], printed: readonly PlacedText[]): { s: PlacedText; p: PlacedText }[] {
  const byKey = new Map<string, PlacedText[]>();
  for (const p of printed) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);
  const candidates: { s: PlacedText; p: PlacedText; d: number }[] = [];
  for (const s of source) {
    for (const p of byKey.get(s.key) ?? []) {
      candidates.push({ s, p, d: Math.abs(p.y - s.y) + (s.x !== null && p.x !== null ? Math.abs(p.x - s.x) : 0) });
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  const usedS = new Set<PlacedText>();
  const usedP = new Set<PlacedText>();
  const out: { s: PlacedText; p: PlacedText }[] = [];
  for (const c of candidates) {
    if (usedS.has(c.s) || usedP.has(c.p)) continue;
    usedS.add(c.s);
    usedP.add(c.p);
    out.push(c);
  }
  return out;
}

/** How closely the printed texts sit where the page's do. */
export function agreementOf(source: readonly PlacedText[], printed: readonly PlacedText[], tolerance: number): Agreement {
  const pairs = pair(source, printed);
  const within = pairs.filter(({ s, p }) => Math.abs(p.y - s.y) <= tolerance && (s.x === null || p.x === null || Math.abs(p.x - s.x) <= tolerance)).length;
  const recall = source.length ? within / source.length : 0;
  const precision = printed.length ? within / printed.length : 0;
  const order: string[] = [];
  for (const p of printed) if (p.band && !order.includes(p.band)) order.push(p.band);
  const bands: Record<string, number> = {};
  for (const name of order) {
    const m = median(pairs.filter(({ p }) => p.band === name).map(({ s, p }) => p.y - s.y));
    if (m !== null) bands[name] = m;
  }
  return {
    score: recall + precision ? (2 * recall * precision) / (recall + precision) : 0,
    recall,
    precision,
    paired: pairs.length,
    within,
    bands,
    order,
    dx: median(pairs.flatMap(({ s, p }) => (s.x !== null && p.x !== null ? [p.x - s.x] : []))),
  };
}

/**
 * How closely a report prints where the page OCR read did; null when either
 * side has no text. `texts` are the page's in the report's own unit, as
 * Forma's draft carries them.
 */
export function sourceAgreement(xml: string, texts: readonly PageText[] | null | undefined, options: AgreementOptions = {}): Agreement | null {
  const unit = parseReportStructure(xml).unit;
  const source = sourceTexts(texts);
  const printed = printedTexts(xml, options).texts;
  if (!source.length || !printed.length) return null;
  return agreementOf(source, printed, options.tolerance ?? defaultTolerance(unit, options.dpi));
}

/* ---------------------------------------------------------------- the fit */

const num = (n: number) => String(Math.round(n * 100) / 100);

/** `xml` with each control's LocationFloat moved by `dx`, `dy` (file units), or null when one would leave its band. */
function moveControls(xml: string, controls: readonly PreviewControl[], dx: number, dy: number, room: { width: number; height: number; scale: number }): string | null {
  const edits: { start: number; end: number; tag: string }[] = [];
  for (const c of controls) {
    const tag = xml.slice(c.openStart, c.openEnd + 1);
    const at = /(\sLocationFloat=")([^"]*)(")/.exec(tag);
    const [x, y] = (at?.[2] ?? '0,0').split(',').map((v) => Number.parseFloat(v.trim()) || 0);
    const scale = c.dpiScale ?? room.scale;
    const nx = x + dx / scale;
    const ny = y + dy / scale;
    if (nx < -0.5 || ny < -0.5) return null;
    if (dx > 0 && (nx * scale + c.width) > room.width + 0.5) return null;
    if (dy > 0 && (ny * scale + c.height) > room.height + 0.5) return null;
    const value = `${num(Math.max(0, nx))},${num(Math.max(0, ny))}`;
    const next = at ? tag.replace(at[0], () => `${at[1]}${value}${at[3]}`) : tag.replace(/\s*(\/?>)$/, (_m, end: string) => ` LocationFloat="${value}"${end === '/>' ? ' />' : '>'}`);
    edits.push({ start: c.openStart, end: c.openEnd + 1, tag: next });
  }
  let out = xml;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.tag + out.slice(e.end);
  return out;
}

/** `xml` with one band's height changed by `dy` (report units), or null when it would cut into what it holds. */
function resizeBand(xml: string, name: string, dy: number): string | null {
  const band = parseReportStructure(xml).bands.find((b) => b.name === name);
  if (!band) return null;
  const scale = band.dpiScale ?? 1;
  const lowest = Math.max(0, ...band.controls.filter((c) => c.panel === undefined).map((c) => c.y + c.height));
  const height = band.height + dy;
  if (height <= 0 || height < lowest - 0.5) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const open = new RegExp(`<Item\\d+\\b[^>]*\\sControlType="\\w*Band"[^>]*\\sName="${escaped}"[^>]*>`).exec(xml);
  if (!open) return null;
  const tag = open[0];
  const value = num(height / scale);
  const next = /\sHeightF="[^"]*"/.test(tag) ? tag.replace(/(\sHeightF=")[^"]*(")/, (_m, a: string, b: string) => `${a}${value}${b}`) : tag.replace(/\s*(\/?>)$/, (_m, end: string) => ` HeightF="${value}"${end === '/>' ? ' />' : '>'}`);
  return xml.slice(0, open.index) + next + xml.slice(open.index + tag.length);
}

const MARGIN_BANDS = new Set(['TopMargin', 'BottomMargin']);

export interface GeometryFit {
  xml: string;
  applied: boolean;
  reason: string;
  /** Agreement before and after, 0 to 1; null when it could not be measured. */
  before: number | null;
  after: number | null;
}

/**
 * The report's bands and controls moved until it prints where the page did,
 * each change kept only when agreement rises (see the module comment); at
 * most `passes` passes. Unchanged when fewer than three texts pair up.
 */
export function fitGeometry(xml: string, texts: readonly PageText[] | null | undefined, options: AgreementOptions & { passes?: number } = {}): GeometryFit {
  const unit = parseReportStructure(xml).unit;
  const source = sourceTexts(texts);
  const tolerance = options.tolerance ?? defaultTolerance(unit, options.dpi);
  const measure = (candidate: string) => {
    const printed = printedTexts(candidate, options).texts;
    return printed.length ? agreementOf(source, printed, tolerance) : null;
  };
  const start = source.length ? measure(xml) : null;
  if (!start || start.paired < 3) return { xml, applied: false, reason: 'too few of the page\'s texts print to compare', before: start?.score ?? null, after: start?.score ?? null };

  let current = xml;
  let best = start;
  const done: string[] = [];
  const better = (candidate: string | null) => {
    if (!candidate || candidate === current) return false;
    const a = measure(candidate);
    if (!a || a.score <= best.score + 1e-9) return false;
    current = candidate;
    best = a;
    return true;
  };

  for (let pass = 0; pass < (options.passes ?? 3); pass++) {
    let changed = false;
    // Across: the whole page, when it sits off by more than the tolerance and a twentieth of an inch.
    if (best.dx !== null && Math.abs(best.dx) > Math.max(tolerance, unitsPerInch(unit) / 20)) {
      const structure = parseReportStructure(current);
      const width = structure.page.width - structure.margins.left - structure.margins.right;
      const dx = -best.dx;
      let moved: string | null = current;
      // Each band's top-level controls, from the last band so earlier offsets stay true.
      for (const band of [...structure.bands].reverse()) {
        if (!moved) break;
        const top = band.controls.filter((c) => c.panel === undefined);
        if (top.length) moved = moveControls(moved, top, dx, 0, { width, height: band.height, scale: band.dpiScale ?? 1 });
      }
      if (better(moved)) {
        changed = true;
        done.push(`moved everything ${num(Math.abs(dx))} ${dx < 0 ? 'left' : 'right'}`);
      }
    }
    // Down: each band off by more than the tolerance, in print order.
    for (const name of best.order) {
      const off = best.bands[name];
      if (off === undefined || Math.abs(off) <= tolerance) continue;
      const structure = parseReportStructure(current);
      const band = structure.bands.find((b) => b.name === name);
      if (!band || MARGIN_BANDS.has(band.kind)) continue;
      const width = structure.page.width - structure.margins.left - structure.margins.right;
      const top = band.controls.filter((c) => c.panel === undefined);
      // The band printed before it, whose height moves this one and everything after.
      const before = best.order[best.order.indexOf(name) - 1];
      const previous = before ? structure.bands.find((b) => b.name === before) : undefined;
      const tries = [
        previous && !MARGIN_BANDS.has(previous.kind) && previous.kind !== 'Detail' ? { what: `${before}'s height`, xml: resizeBand(current, before, -off) } : null,
        top.length ? { what: `${name}'s contents`, xml: moveControls(current, top, 0, -off, { width, height: band.height, scale: band.dpiScale ?? 1 }) } : null,
      ];
      for (const t of tries) {
        if (t && better(t.xml)) {
          changed = true;
          done.push(`${t.what} by ${num(-off)}`);
          break;
        }
      }
    }
    if (!changed) break;
  }
  return done.length
    ? { xml: current, applied: true, reason: `fitted to the page: ${done.join('; ')} (agreement ${Math.round(start.score * 100)}% -> ${Math.round(best.score * 100)}%)`, before: start.score, after: best.score }
    : { xml, applied: false, reason: 'no change printed closer to the page', before: start.score, after: start.score };
}
