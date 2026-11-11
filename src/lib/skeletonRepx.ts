/**
 * A skeleton made into a report again (2026-11-03, milestone 6 of
 * docs/proposals/own-model.md).
 *
 * Forma's vision model looks at a picture of a report page and writes its
 * skeleton (skeletonText.ts): the paper, the bands, and each control's kind,
 * place, size, font and role, but none of its words. Forma's box reader
 * (boxReader.ts, 2026-11-04) writes one from OCR's reading of the page
 * instead. This module writes the .repx, the Mockup's layout and the spec
 * from either.
 * - **Words** come from what OCR read on the same page, matched by place. A
 *   title or a caption takes the text printed inside its box. One with
 *   nothing read keeps a placeholder: "Total" in a footer, "Caption"
 *   anywhere else.
 * - **A value** is bound to a field named after the caption printed over its
 *   column, so `[Amount]` rather than `[Field3]` wherever a caption was read.
 * - **A total** sums the field of the value in its column, running over its
 *   band: a group footer's for each group, the report footer's over the
 *   report and the page footer's over the page. A column whose caption or
 *   field names a percentage, a rate, a margin or an average is averaged
 *   instead (2026-11-11, CC-05).
 * - **A value or a total prints as the page printed it**: the format that
 *   gives the page's own text back exactly, "1,763.00" or "14 Oct 2026",
 *   when one does (2026-11-11, CC-06, formatFromText.ts).
 * Only the bands whose place on the page does not depend on how many records
 * print are matched against the reading. Those are the margins, the report
 * and page headers, the group headers above the first record, the first
 * record and the page footer. A group or report footer prints wherever the
 * records end, so its captions are placeholders.
 *
 * The file goes through the passes every generated report goes through:
 * unique Refs, Dpi and PaperKind. Read back by the Preview's parser and made
 * a skeleton again, it gives the skeleton it was written from, which the
 * tests check.
 */
import { ensureUniqueRefs } from './repxRefs';
import { repairDpi } from './repxDpi';
import { repairPaper } from './repxPaper';
import { wholeMargins } from './repxMargins';
import { formatFor, isPlain, saysRatio, valueOfText } from './formatFromText';
import { pointsToUnits } from './reportGeometry';
import type { DetectedLayout } from './ocrLayout';
import { decodeXmlText, parseReportStructure, type BandKind } from './reportPreview';
import type { PageRows } from './pageRows';
import type { ReportSkeleton, SkeletonControl, SkeletonFont, SkeletonRole } from './reportSkeleton';
import type { ReportElement, ReportLayout, ReportSection } from './reportTypes';

/** A text read from the page, its box in hundredths of an inch from the page's top left corner. */
export interface PageText {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * What a draft says outright, by place (`placeKey`), over what the reading
 * would give (2026-11-05, lib/draftText.ts): the AI that corrects Forma's
 * draft writes each text's words and each value's field, and a fill or ink
 * the reading cannot see.
 */
export interface DraftGiven {
  /** A title's or caption's words. */
  words: Map<string, string>;
  /** The field a value prints or a total sums. */
  fields: Map<string, string>;
  /** A group header's fields, by band index. */
  groups: Map<number, string[]>;
  /** A control's fill and text colour, as `#RRGGBB`. */
  colours: Map<string, { fill?: string; ink?: string }>;
}

export const noneGiven = (): DraftGiven => ({ words: new Map(), fields: new Map(), groups: new Map(), colours: new Map() });

export interface SkeletonDesign {
  title: string;
  repx: string;
  layout: ReportLayout;
  markdown: string;
  /** The fields its values and totals are bound to, in the order they were named. */
  fields: string[];
  /** How many titles and captions took their text from the reading, and how many kept a placeholder. */
  read: number;
  placeholders: number;
  /** The words, fields and groups the report was written with, by place: what a draft of it says. */
  used: DraftGiven;
}

const BAND_TYPE: Partial<Record<BandKind, string>> = {
  TopMargin: 'TopMarginBand',
  ReportHeader: 'ReportHeaderBand',
  PageHeader: 'PageHeaderBand',
  GroupHeader: 'GroupHeaderBand',
  Detail: 'DetailBand',
  GroupFooter: 'GroupFooterBand',
  ReportFooter: 'ReportFooterBand',
  PageFooter: 'PageFooterBand',
  BottomMargin: 'BottomMarginBand',
};

const SECTION: Partial<Record<BandKind, { type: ReportSection['type']; name: string }>> = {
  ReportHeader: { type: 'header', name: 'Report header' },
  PageHeader: { type: 'header', name: 'Page header' },
  GroupHeader: { type: 'group', name: 'Group header' },
  Detail: { type: 'detail', name: 'Detail' },
  GroupFooter: { type: 'group', name: 'Group footer' },
  ReportFooter: { type: 'footer', name: 'Report footer' },
  PageFooter: { type: 'footer', name: 'Page footer' },
};

const HEADERS: BandKind[] = ['ReportHeader', 'PageHeader', 'GroupHeader'];
const FOOTERS: BandKind[] = ['GroupFooter', 'ReportFooter', 'PageFooter'];
const SCOPE: Partial<Record<BandKind, string>> = { GroupFooter: 'Group', ReportFooter: 'Report', PageFooter: 'Page' };
const ALIGN = { left: 'MiddleLeft', center: 'MiddleCenter', right: 'MiddleRight' } as const;

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => String(Math.round(v * 100) / 100);

const fontAttr = (f: SkeletonFont | null) =>
  f ? ` Font="${attr(f.family)}, ${n(f.size)}pt${f.bold || f.italic ? `, style=${[f.bold && 'Bold', f.italic && 'Italic'].filter(Boolean).join(', ')}` : ''}"` : '';

/** `Borders` as DevExpress writes it, from a skeleton's mask: top 1, right 2, bottom 4, left 8. */
function bordersAttr(mask: number): string {
  if (!mask) return '';
  if ((mask & 15) === 15) return ' Borders="All"';
  const sides = [mask & 8 && 'Left', mask & 1 && 'Top', mask & 2 && 'Right', mask & 4 && 'Bottom'].filter(Boolean);
  return ` Borders="${sides.join(', ')}"`;
}

/** The order DevExpress prints a report's band kinds in, top to bottom. */
const PRINT_ORDER: readonly BandKind[] = ['TopMargin', 'ReportHeader', 'PageHeader', 'GroupHeader', 'Detail', 'DetailReport', 'GroupFooter', 'ReportFooter', 'PageFooter', 'BottomMargin'];

/**
 * One report's skeleton from the skeletons of several of its pages
 * (2026-11-04). The vision model reads one page at a time, and a report's
 * pages show different parts of it: the first its report header, the last
 * its group and report footers and the totals in them. So the first page's
 * skeleton stands, with its paper, margins and bands, and a band of a kind it
 * does not show is taken from the first later page that does, in the place
 * DevExpress prints that kind. A kind the first page shows is never replaced:
 * the page header and the records repeat on every page, and the first
 * page's are the ones its words are read from.
 */
export function mergePageSkeletons(first: ReportSkeleton, ...later: readonly ReportSkeleton[]): ReportSkeleton {
  const bands = [...first.bands];
  for (const page of later) {
    for (const band of page.bands) {
      if (bands.some((b) => b.kind === band.kind)) continue;
      const rank = PRINT_ORDER.indexOf(band.kind);
      const at = bands.findIndex((b) => PRINT_ORDER.indexOf(b.kind) > rank);
      bands.splice(at < 0 ? bands.length : at, 0, band);
    }
  }
  return { ...first, bands };
}

/** Every text read on the page, labels and table cells alike, where its ink was seen. */
export function pageTextsOf(layout: DetectedLayout, page = 0): PageText[] {
  const p = layout.pages[page];
  if (!p) return [];
  const cells = p.tables.flatMap((t) => t.rows.flatMap((r) => r.cells.filter((c): c is NonNullable<typeof c> => !!c)));
  return [...p.labels, ...cells].map((t) => ({ text: t.text, ...t.ink }));
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One place that can hold text: a control, or one cell of a table. */
interface Place {
  band: number;
  control: number;
  row: number;
  cell: number;
  role: SkeletonRole;
  kind: SkeletonControl['kind'];
  /** On the page, or null in a band whose place depends on the records. */
  box: Box | null;
  /** Across the page, always known. */
  left: number;
  right: number;
}

/**
 * Where each band starts on the first page, or null where that depends on how
 * many records print. Headers stack from the top margin down to the first
 * record; the page footer sits on the bottom margin.
 */
function bandTops(k: ReportSkeleton): (number | null)[] {
  const footer = k.bands.filter((b) => b.kind === 'PageFooter').reduce((s, b) => s + b.height, 0);
  let y = k.margins.top;
  let fy = k.height - k.margins.bottom - footer;
  let recorded = false;
  return k.bands.map((b) => {
    if (b.kind === 'TopMargin') return 0;
    if (b.kind === 'BottomMargin') return k.height - k.margins.bottom;
    if (b.kind === 'PageFooter') {
      const top = fy;
      fy += b.height;
      return top;
    }
    // A footer read off a picture knows where it was (`pageTop`); one from a file is not placed.
    if (recorded || !(HEADERS.includes(b.kind) || b.kind === 'Detail')) return b.pageTop ?? null;
    const top = y;
    y += b.height;
    if (b.kind === 'Detail') recorded = true;
    return top;
  });
}

function placesOf(k: ReportSkeleton): Place[] {
  const tops = bandTops(k);
  const out: Place[] = [];
  k.bands.forEach((b, bi) => {
    const top = tops[bi];
    b.controls.forEach((c, ci) => {
      const x = k.margins.left + c.x;
      if (c.kind === 'table' && c.rows?.length) {
        const rh = c.h / c.rows.length;
        c.rows.forEach((row, ri) => {
          const total = row.reduce((s, cell) => s + Math.max(0.01, cell.weight), 0) || 1;
          let cx = x;
          row.forEach((cell, k2) => {
            const cw = (c.w * Math.max(0.01, cell.weight)) / total;
            out.push({
              band: bi,
              control: ci,
              row: ri,
              cell: k2,
              role: cell.role,
              kind: 'table',
              box: top === null ? null : { x: cx, y: top + c.y + ri * rh, w: cw, h: rh },
              left: cx,
              right: cx + cw,
            });
            cx += cw;
          });
        });
        return;
      }
      out.push({ band: bi, control: ci, row: -1, cell: -1, role: c.role, kind: c.kind, box: top === null ? null : { x, y: top + c.y, w: c.w, h: c.h }, left: x, right: x + c.w });
    });
  });
  return out;
}

/** The text printed inside a box, in reading order; empty when nothing was read there. */
function textIn(texts: readonly PageText[], box: Box): string {
  const pad = 4;
  const inside = texts.filter((t) => {
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    return cx >= box.x - pad && cx <= box.x + box.w + pad && cy >= box.y - pad && cy <= box.y + box.h + pad;
  });
  inside.sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) / 2 ? a.y - b.y : a.x - b.x));
  return inside
    .map((t) => t.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A field name from a caption: its words run together, letters and digits only. */
export function fieldFromCaption(caption: string): string {
  const words = caption.match(/[\p{L}\p{N}]+/gu) ?? [];
  const name = words.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join('');
  return /^\p{L}/u.test(name) ? name : name ? `F${name}` : '';
}

const overlap = (a: { left: number; right: number }, b: { left: number; right: number }) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));

const key = (p: Pick<Place, 'band' | 'control' | 'row' | 'cell'>) => `${p.band}:${p.control}:${p.row}:${p.cell}`;

/** A place's key: band and control by index, and a table cell's row and cell, -1 for a control's own. */
export const placeKey = (band: number, control: number, row = -1, cell = -1) => key({ band, control, row, cell });

/**
 * The report a skeleton describes, its words from `texts` where they were read.
 * `title` names the report when no title was read. (`readBy` named what read
 * the layout, for the spec, until 2026-11-11, and went once nothing passed
 * it.) `given`
 * says words, fields, groups and colours outright, over the reading
 * (2026-11-05). `version` is the DevExpress version to write, 20.1 unless said.
 */
export function skeletonToDesign(
  k: ReportSkeleton,
  options: { texts?: readonly PageText[]; title?: string; given?: DraftGiven; version?: string } = {},
): SkeletonDesign {
  const texts = options.texts ?? [];
  const places = placesOf(k);
  const given = options.given ?? noneGiven();

  // The words of each title and caption: the draft's, else read where the page printed them.
  const words = new Map<string, string>();
  let read = 0;
  let placeholders = 0;
  for (const p of places) {
    if (p.role !== 'title' && p.role !== 'caption') continue;
    const found = given.words.get(key(p))?.trim() || (p.box ? textIn(texts, p.box) : '');
    if (found) read++;
    else placeholders++;
    const kind = k.bands[p.band].kind;
    words.set(key(p), found || (p.role === 'title' ? options.title?.trim() || 'Report' : FOOTERS.includes(kind) ? 'Total' : 'Caption'));
  }
  const title = places.filter((p) => p.role === 'title').map((p) => words.get(key(p))!)[0] ?? options.title?.trim() ?? 'Report';

  /*
   * Each value's field, from the caption that heads it in a header band
   * (2026-11-11, the full audit's CC-09). Forma's own drafts bound
   * `[QuarterlySalesByRegion2]` and `[INVOICE2]` to `[INVOICE6]` and grouped on
   * the title, so no data could ever fill them, because any caption over a
   * value named it, the title included, and a repeat was numbered. Now:
   * - a caption on the value's own line, to its left, names it first, as a
   *   key names its value in an invoice's meta block;
   * - else the nearest caption over its column, never a ReportHeader caption
   *   over a value in another band, nor one sized like a title;
   * - a caption worded like data (an address, an e-mail, a number) or the
   *   value's own words never names it;
   * - a name already taken gives `Field<n>` rather than a numbered copy.
   */
  const fontOf = (p: Place) => {
    const c = k.bands[p.band].controls[p.control];
    return (p.row >= 0 ? c.rows?.[p.row]?.[p.cell]?.font?.size : c.font?.size) ?? 0;
  };
  const headerCaptions = places.filter((p) => p.role === 'caption' && HEADERS.includes(k.bands[p.band].kind));
  const sizes = headerCaptions.map(fontOf).filter((s) => s > 0).sort((a, b) => a - b);
  const usualSize = sizes[Math.floor(sizes.length / 2)] ?? 0;
  const looksLikeData = (words: string) => /@|\d{3,}|https?:|www\./i.test(words) || words.split(/\s+/).length > 5;
  const titleSized = (p: Place) => k.bands[p.band].kind === 'ReportHeader' && usualSize > 0 && fontOf(p) >= usualSize * 1.5;
  const captions = headerCaptions.filter((p) => !titleSized(p) && !looksLikeData(words.get(key(p)) ?? ''));
  const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const fields: string[] = [];
  const fieldOf = new Map<string, string>();
  const unique = (base: string) => {
    let name = base || `Field${fields.length + 1}`;
    for (let i = 2; fields.includes(name); i++) name = `${base || 'Field'}${i}`;
    fields.push(name);
    return name;
  };
  // A field the draft names is the data's own name, so it is kept as written,
  // however many places print it: a group header's [Region] and a record's.
  const named = (place: Place) => {
    const f = fieldFromCaption(given.fields.get(key(place)) ?? '');
    if (f && !fields.includes(f)) fields.push(f);
    return f;
  };
  const values = places.filter((p) => p.role === 'value');
  /** The caption over each value's column, by place, for how its total adds up. */
  const captionOf = new Map<string, string>();
  for (const v of values) {
    const own = named(v);
    if (own) {
      fieldOf.set(key(v), own);
      continue;
    }
    const self = v.box ? squash(textIn(texts, v.box)) : '';
    const usable = captions.filter((c) => (k.bands[c.band].kind !== 'ReportHeader' || c.band === v.band) && (!self || squash(words.get(key(c)) ?? '') !== self));
    const mid = (b: Box) => b.y + b.h / 2;
    const vb = v.box;
    const beside = vb
      ? usable
          .filter((c) => c.band === v.band && c.box && c.box.x + c.box.w <= vb.x + 2 && Math.abs(mid(c.box) - mid(vb)) <= Math.max(c.box.h, vb.h) / 2)
          .sort((a, b) => b.box!.x - a.box!.x)[0]
      : undefined;
    const above = usable
      .filter((c) => (c.box === null || vb === null || c.box.y < vb.y) && overlap(c, v) > 0)
      .sort((a, b) => {
        const da = a.box && vb ? vb.y - a.box.y : Number.POSITIVE_INFINITY;
        const db = b.box && vb ? vb.y - b.box.y : Number.POSITIVE_INFINITY;
        return da - db || overlap(b, v) - overlap(a, v);
      })[0];
    const heading = beside ?? above;
    if (heading) captionOf.set(key(v), words.get(key(heading)) ?? '');
    const base = heading ? fieldFromCaption(words.get(key(heading)) ?? '') : '';
    if (base && !fields.includes(base)) {
      fields.push(base);
      fieldOf.set(key(v), base);
    } else {
      fieldOf.set(key(v), unique(''));
    }
  }
  /*
   * The format each value and total prints in, read off the page's own text
   * where it printed (2026-11-11, the full audit's CC-06, formatFromText.ts):
   * "14 Oct 2026" is `{0:dd MMM yyyy}` and "1,763.00" `{0:n2}`, where
   * DevExpress's default printed "10/14/2026 12:00 AM" and "1763.0". Only a
   * format that prints the page's text back exactly is written.
   */
  const formatOf = new Map<string, string>();
  const readFormat = (p: Place) => {
    const found = p.box ? formatFor(textIn(texts, p.box)) : null;
    return found && !isPlain(found) ? found.format : undefined;
  };
  for (const v of values) {
    const format = readFormat(v);
    if (format) formatOf.set(key(v), format);
  }
  /*
   * A total sums the value in its column; one with none above it gets a field
   * of its own. A column the page shows to be a ratio is averaged, never summed
   * (2026-11-11, CC-05): the builder summed every total, and a "Margin %"
   * column added up to 248.3. Only on evidence, which is a caption or field
   * that says percent, ratio or average (`saysRatio`), or a "%" printed in the
   * column or its total: a bare "Margin" or "Rate" is as often money that
   * really is summed (the review of CC-05), and nothing after the builder
   * would put a sum back.
   */
  const percentIn = (p: Place | undefined) => !!p?.box && textIn(texts, p.box).includes('%');
  const averaged = new Set<string>();
  for (const t of places.filter((p) => p.role === 'total')) {
    const own = named(t);
    const under = values
      .map((v) => ({ v, o: overlap(v, t) }))
      .filter((x) => x.o > 0)
      .sort((a, b) => b.o - a.o)[0];
    const field = own || (under ? fieldOf.get(key(under.v))! : unique(''));
    fieldOf.set(key(t), field);
    if (saysRatio(field) || (under && saysRatio(captionOf.get(key(under.v)) ?? '')) || percentIn(under?.v) || percentIn(t)) averaged.add(key(t));
    const format = readFormat(t) ?? (under ? formatOf.get(key(under.v)) : undefined);
    if (format) formatOf.set(key(t), format);
  }

  let ref = 0;
  const next = () => ++ref;
  const binding = (expression: string) =>
    `<ExpressionBindings><Item1 Ref="${next()}" EventName="BeforePrint" PropertyName="Text" Expression="${attr(expression)}" /></ExpressionBindings>`;
  const content = (p: Pick<Place, 'band' | 'control' | 'row' | 'cell'>, role: SkeletonRole, kind: BandKind) => {
    const field = fieldOf.get(key(p));
    const format = formatOf.get(key(p));
    const formatted = format ? ` TextFormatString="${attr(format)}"` : '';
    if (role === 'value') return { text: undefined, inner: binding(`[${field}]`), shown: `[${field}]`, formatted };
    if (role === 'total') {
      const sum = averaged.has(key(p)) ? 'sumAvg' : 'sumSum';
      return { text: undefined, inner: `<Summary Ref="${next()}" Running="${SCOPE[kind] ?? 'Report'}" />${binding(`${sum}([${field}])`)}`, shown: `${sum === 'sumAvg' ? 'average' : 'sum'} [${field}]`, formatted };
    }
    const text = words.get(key(p)) ?? '';
    return { text, inner: '', shown: text, formatted: '' };
  };

  const bandsXml: { kind: BandKind; xml: string }[] = [];
  const sections: ReportSection[] = [];
  const unitSize = (f: SkeletonFont | null) => (f ? Math.round(pointsToUnits(f.size, 'HundredthsOfAnInch') * 100) / 100 : undefined);
  let groupCount = 0;
  const usedGroups = new Map<number, string[]>();
  // Whole numbers, or DevExpress drops the margins and prints sides of 100
  // (2026-11-11, CC-03, repxMargins.ts): the margin bands take the same.
  const whole = wholeMargins(k.margins);
  // A band read as the page's full height is held to what the whole margins
  // leave: rounding a fractional top and bottom up can take up to two units
  // from the page, and a band that much taller prints a near-empty page after
  // it (2026-11-11, the review of CC-03). Only that much: a band taller by
  // more was read that way, and band-taller-than-page names it.
  const printable = Math.round(k.height) - whole.top - whole.bottom;
  const fitted = (h: number) => (h > printable && h - printable < 2 ? printable : h);

  k.bands.forEach((b, bi) => {
    const type = BAND_TYPE[b.kind];
    if (!type) return;
    const controls: string[] = [];
    const elements: ReportElement[] = [];
    b.controls.forEach((c, ci) => {
      const item = `Item${controls.length + 1}`;
      const at = ` LocationFloat="${n(c.x)},${n(c.y)}" SizeF="${n(c.w)},${n(c.h)}"`;
      // A fill or ink the draft names; the reading sees neither (2026-11-05).
      const paint = given.colours.get(placeKey(bi, ci)) ?? {};
      const colours = `${paint.fill ? ` BackColor="${attr(paint.fill)}"` : ''}${paint.ink ? ` ForeColor="${attr(paint.ink)}"` : ''}`;
      const look = `${fontAttr(c.font)}${bordersAttr(c.borders)}${colours}`;
      const name = `${c.kind}${bi + 1}_${ci + 1}`;
      const flags = {
        borderTop: !!(c.borders & 1),
        borderRight: !!(c.borders & 2),
        borderBottom: !!(c.borders & 4),
        borderLeft: !!(c.borders & 8),
        ...(paint.fill ? { backgroundColor: paint.fill } : {}),
        ...(paint.ink ? { color: paint.ink } : {}),
      };
      const typeface = c.font ? { fontSize: unitSize(c.font), bold: c.font.bold, italic: c.font.italic, fontFamily: c.font.family } : {};
      const element = (type2: ReportElement['type'], shown: string): ReportElement => ({
        id: name,
        type: type2,
        content: shown,
        x: c.x,
        y: c.y,
        width: c.w,
        height: c.h,
        textAlign: c.align,
        ...typeface,
        ...flags,
      });
      const self = { band: bi, control: ci, row: -1, cell: -1 };
      switch (c.kind) {
        case 'table': {
          const rows = (c.rows ?? []).map((row, ri) => {
            const cells = row.map((cell, k2) => {
              const got = content({ band: bi, control: ci, row: ri, cell: k2 }, cell.role, b.kind);
              return {
                xml:
                  `<Item${k2 + 1} Ref="${next()}" ControlType="XRTableCell" Name="${name}_${ri + 1}_${k2 + 1}" Weight="${n(cell.weight)}"` +
                  `${got.text !== undefined ? ` Text="${attr(got.text)}"` : ''}${got.formatted}${fontAttr(cell.font)} TextAlignment="${ALIGN[cell.align]}" Padding="2,2,0,0,100">${got.inner}</Item${k2 + 1}>`,
                shown: got.shown,
                weight: cell.weight,
              };
            });
            return {
              xml: `<Item${ri + 1} Ref="${next()}" ControlType="XRTableRow" Name="${name}_${ri + 1}" Weight="1"><Cells>${cells.map((x) => x.xml).join('')}</Cells></Item${ri + 1}>`,
              cells,
            };
          });
          controls.push(`<${item} Ref="${next()}" ControlType="XRTable" Name="${name}"${at}${look}><Rows>${rows.map((r) => r.xml).join('')}</Rows></${item}>`);
          elements.push({ ...element('table', ''), rows: rows.map((r) => ({ weight: 1, cells: r.cells.map((x) => ({ content: x.shown, weight: x.weight })) })) });
          return;
        }
        case 'label':
        case 'richText':
        case 'checkbox': {
          const got = c.role === 'decoration' ? { text: '', inner: '', shown: '', formatted: '' } : content(self, c.role, b.kind);
          const control = c.kind === 'checkbox' ? 'XRCheckBox' : 'XRLabel';
          const multiline = c.kind === 'richText' ? ' Multiline="true" WordWrap="true"' : '';
          const text = got.text !== undefined && got.text !== '' ? ` Text="${attr(got.text)}"` : '';
          controls.push(
            `<${item} Ref="${next()}" ControlType="${control}" Name="${name}"${text}${got.formatted} TextAlignment="${ALIGN[c.align]}"${multiline}${at}${look} Padding="2,2,0,0,100">${got.inner}</${item}>`,
          );
          elements.push(element(c.kind === 'checkbox' ? 'checkbox' : 'label', got.shown));
          return;
        }
        case 'pageInfo': {
          const box = places.find((p) => p.band === bi && p.control === ci)?.box;
          const seen = box ? textIn(texts, box) : '';
          const dated = /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(seen);
          const format = dated ? ' PageInfo="DateTime" TextFormatString="{0:dd/MM/yyyy}"' : ' TextFormatString="Page {0} of {1}"';
          controls.push(`<${item} Ref="${next()}" ControlType="XRPageInfo" Name="${name}"${format} TextAlignment="${ALIGN[c.align]}"${at}${look} />`);
          elements.push(element('label', dated ? 'dd/mm/yyyy' : 'Page 1 of 1'));
          return;
        }
        case 'line': {
          const vertical = c.h > c.w ? ' LineDirection="Vertical"' : '';
          controls.push(`<${item} Ref="${next()}" ControlType="XRLine" Name="${name}"${vertical}${at} />`);
          elements.push(element('line', ''));
          return;
        }
        case 'picture':
          controls.push(`<${item} Ref="${next()}" ControlType="XRPictureBox" Name="${name}" Sizing="ZoomImage"${at}${bordersAttr(c.borders)} />`);
          elements.push(element('image', ''));
          return;
        case 'barcode':
          controls.push(`<${item} Ref="${next()}" ControlType="XRBarCode" Name="${name}" Text="123456"${at} />`);
          elements.push(element('barcode', '123456'));
          return;
        case 'chart':
          controls.push(`<${item} Ref="${next()}" ControlType="XRChart" Name="${name}"${at}${bordersAttr(c.borders)} />`);
          elements.push(element('chart', ''));
          return;
        case 'panel':
          controls.push(`<${item} Ref="${next()}" ControlType="XRPanel" Name="${name}"${at}${bordersAttr(c.borders)}${colours} />`);
          elements.push(element('label', ''));
          return;
        case 'shape':
          controls.push(`<${item} Ref="${next()}" ControlType="XRShape" Name="${name}"${at} />`);
          elements.push(element('label', ''));
          return;
        case 'subreport':
          controls.push(`<${item} Ref="${next()}" ControlType="XRSubreport" Name="${name}"${at} />`);
          elements.push(element('label', ''));
          return;
        default:
          return;
      }
    });

    // A group header groups by the fields of the values it prints, or by a field of its own.
    let groupXml = '';
    const groupNames = (given.groups.get(bi) ?? []).map(fieldFromCaption).filter(Boolean);
    if (b.kind === 'GroupHeader' && (b.groupFields > 0 || groupNames.length)) {
      const own = places.filter((p) => p.band === bi && p.role === 'value').map((p) => fieldOf.get(key(p))!);
      const names = groupNames.length ? groupNames : Array.from({ length: b.groupFields }, (_, i) => own[i] ?? `Group${++groupCount}`);
      usedGroups.set(bi, names);
      groupXml = `<GroupFields>${names.map((f, i) => `<Item${i + 1} Ref="${next()}" FieldName="${attr(f)}" />`).join('')}</GroupFields>`;
    }
    const height = b.kind === 'TopMargin' ? whole.top : b.kind === 'BottomMargin' ? whole.bottom : fitted(b.height);
    const inner = `${groupXml}${controls.length ? `<Controls>${controls.join('')}</Controls>` : ''}`;
    bandsXml.push({ kind: b.kind, xml: `<Band Ref="${next()}" ControlType="${type}" Name="${b.kind}${bi + 1}" HeightF="${n(height)}"${inner ? `>${inner}</Band>` : ' />'}` });
    const section = SECTION[b.kind];
    if (section) sections.push({ id: `${b.kind}-${bi + 1}`, name: section.name, type: section.type, height: b.height, elements });
  });
  // DevExpress expects a Detail band. A page read with none gets an empty one
  // after its headers, where a Detail band prints.
  if (!bandsXml.some((b) => b.kind === 'Detail')) {
    const at = bandsXml.findIndex((b) => FOOTERS.includes(b.kind) || b.kind === 'BottomMargin');
    bandsXml.splice(at < 0 ? bandsXml.length : at, 0, { kind: 'Detail', xml: `<Band Ref="${next()}" ControlType="DetailBand" Name="Detail" HeightF="0" />` });
  }

  const bandItems = bandsXml.map((b, i) => b.xml.replace(/^<Band/, `<Item${i + 1}`).replace(/<\/Band>$/, `</Item${i + 1}>`));
  const name = fieldFromCaption(title) || 'VisionReport';
  const m = whole;
  // The version asked for, as the AI's own REPX would carry it (X.Y.3.0, gemini.md).
  const v = /^\d{2}\.\d$/.test(options.version ?? '') ? options.version! : '20.1';
  const xml =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    `<XtraReportsLayoutSerializer SerializerVersion="${v}.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v${v}, Version=${v}.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a"` +
    ` Name="${attr(name)}" DisplayName="${attr(title)}" ReportUnit="HundredthsOfAnInch" Margins="${n(m.left)}, ${n(m.right)}, ${n(m.top)}, ${n(m.bottom)}"` +
    ` PageWidth="${Math.round(k.width)}" PageHeight="${Math.round(k.height)}" Version="${v}" Font="Arial, 9pt"><Bands>${bandItems.join('')}</Bands></XtraReportsLayoutSerializer>`;
  let repx = xml;
  for (const pass of [ensureUniqueRefs, repairDpi, repairPaper]) {
    const r = pass(repx);
    if (r.applied) repx = r.xml;
  }

  // The Spec says what the report is, in the user's terms (2026-11-11, the
  // full audit, PL-07): it said which part of Forma read the picture and how
  // many captions "took their words from the page's text" until then, which
  // is machinery nobody asked about.
  const controlCount = k.bands.reduce((s, b) => s + b.controls.length, 0);
  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const markdown = [
    `# ${title}`,
    '',
    `${k.paper}${k.landscape ? ' landscape' : ''}, ${count(k.bands.length, 'band')}, ${count(controlCount, 'part')}.` +
      (placeholders ? ` ${placeholders === 1 ? '1 caption still needs its words' : `${placeholders} captions still need their words`}.` : '') +
      ' Check the figures and fonts against the page in the Preview.',
    '',
    fields.length ? '| Field | Printed as |\n| --- | --- |\n' + fields.map((f) => `| \`[${f}]\` | a value |`).join('\n') : 'No field is bound.',
    '',
    'Bind real data in the Data tab.',
  ].join('\n');

  const usedFields = new Map(places.filter((p) => fieldOf.has(key(p))).map((p) => [key(p), fieldOf.get(key(p))!] as const));
  return {
    title,
    repx,
    layout: { title, pageWidth: k.width, sections },
    markdown,
    fields,
    read,
    placeholders,
    used: { words, fields: usedFields, groups: usedGroups, colours: given.colours },
  };
}

/**
 * Two of the page's values in order, each read as the data would hold it
 * (`valueOfText`): "$5" and "1,200" as the numbers 5 and 1200, a printed date
 * as its ISO form, which sorts as text; words as text, case aside. Compared as
 * printed, "$5" came after "1,200".
 */
function compareValues(a: string, b: string): number {
  const va = valueOfText(a);
  const vb = valueOfText(b);
  const x = Number(va);
  const y = Number(vb);
  if (va !== '' && vb !== '' && Number.isFinite(x) && Number.isFinite(y)) return x - y;
  return va.localeCompare(vb, 'en', { sensitivity: 'base' });
}

/**
 * The order one field's values run in within every group the page shows, or
 * null when they run both ways in any group, or the page shows too few steps
 * to say: three at least, so two records that happen to be in order are not
 * taken for a sort.
 */
function orderOf(field: string, page: PageRows): 'Ascending' | 'Descending' | null {
  let up = 0;
  let down = 0;
  for (const group of page.groups) {
    const values = group.map((i) => page.rows[i]?.[field] ?? '').filter((v) => v.trim() !== '');
    for (let i = 1; i < values.length; i++) {
      const c = compareValues(values[i - 1], values[i]);
      if (c < 0) up++;
      else if (c > 0) down++;
    }
    if (up && down) return null;
  }
  if (up >= 3 && !down) return 'Ascending';
  if (down >= 3 && !up) return 'Descending';
  return null;
}

/**
 * The page's record order kept inside its groups (2026-11-11, the full
 * audit's CC-12). The Claude Code reference fed its FastReport list twenty
 * products in no order and wrote `<SortFields>` on Detail, so each letter's
 * products printed in order, as the page shows them; Forma wrote the
 * grouping and never the sort, and its answer printed in whatever order the
 * data came. When the page's records (`pageRows.ts`) run in one direction of
 * one column within every group, the Detail band sorts by it, in the
 * serializer's own form (`RepxProbe emit-sort`: inside Detail, before its
 * controls; ascending writes no `SortOrder`). The leftmost column only, which
 * is the one a reader sorts by; never a group's own field, and never over a
 * Detail band that sorts already, or a report with no group, whose records
 * print in the order the data gives them as the page's did.
 */
export function keepPageOrder(xml: string, page: PageRows | null): { xml: string; applied: boolean; reason: string } {
  const no = (reason: string) => ({ xml, applied: false, reason });
  if (!page || page.rows.length < 4) return no('too few records on the page to read an order from');
  const structure = parseReportStructure(xml);
  const detail = structure.bands.find((b) => b.kind === 'Detail');
  if (!detail) return no('the report has no Detail band');
  if (detail.fields.length) return no('the Detail band sorts already');
  const grouped = new Set(structure.bands.filter((b) => b.kind === 'GroupHeader').flatMap((b) => b.fields.map((f) => decodeXmlText(f.field))));
  if (!grouped.size) return no('the report has no group to keep an order inside');
  /*
   * The leftmost column alone (2026-11-11, the review of CC-12). Trying each
   * column in turn took a figure such as Units or Amount that happened to
   * rise across a small page for the sort, and the sort is then applied to
   * the person's real data; a reader sorts a list by its leftmost column.
   */
  const field = page.columns.find((f): f is string => Boolean(f) && !grouped.has(f!));
  if (field) {
    const order = orderOf(field, page);
    if (!order) return no(`the records do not run in one order of ${field}, the leftmost column, within every group`);
    const open = /<Item\d+\b[^>]*\sControlType="DetailBand"[^>]*?(\/?)>/.exec(xml);
    if (!open) return no('the Detail band could not be found in the file');
    const refs = [...xml.matchAll(/\sRef="(\d+)"/g)].map((m) => Number(m[1]));
    const ref = Math.max(0, ...refs) + 1;
    const sort = `<SortFields><Item1 Ref="${ref}" FieldName="${attr(field)}"${order === 'Descending' ? ' SortOrder="Descending"' : ''} /></SortFields>`;
    const tag = open[0];
    const opened = open[1] ? `${tag.slice(0, -2).trimEnd()}>` : tag;
    const close = open[1] ? `</${/^<(Item\d+)/.exec(tag)![1]}>` : '';
    return {
      xml: xml.slice(0, open.index) + opened + sort + close + xml.slice(open.index + tag.length),
      applied: true,
      reason: `kept the page's order of the records by ${field}${order === 'Descending' ? ', descending' : ''}, inside each group`,
    };
  }
  return no('no column of the page is bound to a field');
}
