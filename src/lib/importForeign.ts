/**
 * Another tool's report file opened as a DevExpress report (2026-11-11, the
 * full audit's CP-08): an SSRS report definition (.rdl, .rdlc) and a
 * FastReport report (.frx), both XML, converted in the browser to the REPX
 * Forma writes, which the repairs then make DevExpress's own and the
 * workspace opens as an uploaded .repx. Until then an .rdl went to the AI as
 * text to reproduce (PIPE1's interim) and an .frx was refused, so a report
 * from SQL Server Reporting Services or FastReport lost its exact positions,
 * fields and totals, or had to be printed to PDF and read back as a picture.
 *
 * ## SSRS (RDL 2005 to 2016)
 *
 * - Sizes are written with their unit ("2.5in", "1cm", "12pt"), each read
 *   through `lengthToPoints` and written in hundredths of an inch.
 * - The page header and footer become the page header and footer bands. The
 *   body's first table (a `Tablix`, or a 2005 `Table`) is the data region:
 *   what sits above it, and its heading rows, the report header; its detail
 *   rows the Detail band; its group rows group headers and footers on the
 *   group's field, nested by `Level` (the innermost 0); its total rows and
 *   what sits below it the report footer. Any other table is drawn where it
 *   stands, as text.
 * - A text box is a label; a line a line; a rectangle a panel holding what it
 *   holds; an image a picture box, its picture left out (an SSRS picture is
 *   bytes or a URL a browser cannot fetch for the report).
 * - An expression: `Fields!X.Value` is `[X]`, `Parameters!P.Value` is `?P`,
 *   `Sum(Fields!X.Value)` is `sumSum([X])` with a running scope for its
 *   band, `&` is `+`, a string is quoted as DevExpress quotes it, and the page
 *   number and total pages are a page-information control. What does not
 *   convert (custom code, `ReportItems!`, a function DevExpress lacks) prints
 *   as the text it is, and is counted, so the user is told to look at it.
 *
 * ## FastReport
 *
 * The mapping `scripts/model/fastreport.ts` used for training since
 * 2026-11-10 (batch AE), moved here with the text kept, which it already
 * was: the script reads it from here now. One change came with the move: a
 * page's size and margins are written whole, as DevExpress 20.1 keeps them,
 * so the skeletons the script writes now differ from the ones it wrote
 * before, and a dataset packed from the old ones is stale until both are
 * run again.
 *
 * Pure, so the tests read made-up files under Node.
 */
import { escapeXmlAttribute, xmlSafeText } from './xmlEscape';
import { lengthToPoints, pointsToUnits, pxToUnits } from './reportGeometry';

const UNIT = 'HundredthsOfAnInch';

/* ------------------------------------------------------------- a small XML reader */

/** An element: its name as written (prefix and all), attributes, children and its own text. */
export interface XmlEl {
  name: string;
  attrs: Record<string, string>;
  children: XmlEl[];
  /** The text directly inside it, CDATA included, entities decoded. */
  text: string;
}

/**
 * A character reference's character, or U+FFFD for one no XML may hold
 * (2026-11-11, the re-audit's R5-07): `&#x110000;` made `String.fromCodePoint`
 * throw, which the drop's loop did not catch, so one bad reference in one file
 * lost every file dropped after it. Every character XML 1.0 cannot hold (a
 * control other than tab and line breaks, a surrogate half, U+FFFE, U+FFFF,
 * anything past U+10FFFF) is refused the same way.
 */
const character = (n: number) =>
  Number.isInteger(n) && (n === 0x9 || n === 0xa || n === 0xd || (n >= 0x20 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff))
    ? String.fromCodePoint(n)
    : String.fromCharCode(0xfffd);

/**
 * Text and attribute values decoded, with any raw character XML cannot hold
 * taken out as well: what is converted never carries one into the REPX, and
 * the placeholders below (`\u0001ref\u0001`) can never be met in a file's text.
 */
const decode = (s: string) =>
  xmlSafeText(
    s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
      if (e[0] === '#') return character(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()];
    }),
  );

/** Elements, attributes and text; comments, declarations and processing instructions are skipped. */
export function parseXml(xml: string): XmlEl | null {
  const src = xml.replace(/^﻿/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  const token = /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const attr = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const stack: XmlEl[] = [];
  let root: XmlEl | null = null;
  for (const m of src.matchAll(token)) {
    const [, cdata, closing, name, attrText, selfClosing, text] = m;
    const top = stack[stack.length - 1];
    if (cdata !== undefined) {
      if (top) top.text += xmlSafeText(cdata);
      continue;
    }
    if (text !== undefined) {
      if (top) top.text += decode(text);
      continue;
    }
    if (closing) {
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of (attrText ?? '').matchAll(attr)) attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
    const el: XmlEl = { name, attrs, children: [], text: '' };
    if (top) top.children.push(el);
    else root ??= el;
    if (!selfClosing) stack.push(el);
  }
  return root;
}

/* ------------------------------------------------------------- what is written */

const esc = escapeXmlAttribute;
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Hundredths of an inch per FastReport pixel (96 to the inch) and per millimetre. */
const PX = pxToUnits(1, UNIT);
const MM = pointsToUnits(lengthToPoints('1mm')!, UNIT);

type Kind = 'ReportHeader' | 'PageHeader' | 'GroupHeader' | 'Detail' | 'GroupFooter' | 'ReportFooter' | 'PageFooter';
const BAND_ORDER: Kind[] = ['ReportHeader', 'PageHeader', 'GroupHeader', 'Detail', 'GroupFooter', 'ReportFooter', 'PageFooter'];

/**
 * Where a control's item number goes, filled in once its band is known. A
 * control character rather than `{i}`, which a text "{i}" in a report took
 * for one (2026-11-11, the re-audit's R3-01): `decode` keeps every control
 * character out of what is read.
 */
const ITEM = '\u0001i\u0001';

/** A band being built: controls are written with `ITEM` where their item number goes. */
interface Band {
  kind: Kind;
  level: number;
  field: string | null;
  height: number;
  controls: string[];
}

/** The page a converted report prints on, in hundredths of an inch. */
interface Page {
  width: number;
  height: number;
  margins: [left: number, right: number, top: number, bottom: number];
  landscape?: boolean;
  paperKind?: string;
}

/** The report's name as an identifier: a file name's letters and digits. */
export function reportName(file: string): string {
  const base = file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+|_+$/g, '');
  return /^[\p{L}_]/u.test(base) ? base : `Report_${base || '1'}`;
}

/** The bands as a REPX, the margins outside them, in DevExpress's print order. */
function writeRepx(name: string, page: Page, bands: Band[], next: () => number): string {
  const groupCount = bands.filter((b) => b.kind === 'GroupHeader').length;
  const sorted = [...bands].sort(
    (x, y) => BAND_ORDER.indexOf(x.kind) - BAND_ORDER.indexOf(y.kind) || (x.kind === 'GroupFooter' ? y.level - x.level : x.level - y.level),
  );
  let item = 0;
  const xml = [
    `<Item${++item} Ref="${next()}" ControlType="TopMarginBand" Name="TopMargin" HeightF="${r2(page.margins[2])}" />`,
    ...sorted.map((b, bi) => {
      const controls = b.controls.map((c, ci) => c.replace(/\u0001i\u0001/g, String(ci + 1)));
      const group = b.kind === 'GroupHeader' && b.field ? `<GroupFields><Item1 Ref="${next()}" FieldName="${esc(b.field)}" /></GroupFields>` : '';
      // Level 0 is the innermost group, as DevExpress nests them (gemini.md, Grouping).
      const level = b.kind === 'GroupHeader' || b.kind === 'GroupFooter' ? ` Level="${Math.max(0, groupCount - 1 - b.level)}"` : '';
      return `<Item${++item} Ref="${next()}" ControlType="${b.kind}Band" Name="${b.kind}${bi + 1}" HeightF="${r2(Math.max(1, b.height))}"${level}>${group}${controls.length ? `<Controls>${controls.join('')}</Controls>` : ''}</Item${item}>`;
    }),
    `<Item${++item} Ref="${next()}" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="${r2(page.margins[3])}" />`,
  ];
  const [l, r, t, b] = page.margins.map((v) => Math.round(v));
  const paper = page.paperKind ? ` PaperKind="${page.paperKind}"` : '';
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="${esc(name)}" ReportUnit="${UNIT}" Margins="${l}, ${r}, ${t}, ${b}"${paper} PageWidth="${Math.round(page.width)}" PageHeight="${Math.round(page.height)}"${page.landscape ? ' Landscape="true"' : ''} Version="20.1">` +
    `<Bands>${xml.join('')}</Bands></XtraReportsLayoutSerializer>`
  );
}

/* ------------------------------------------------------------- FastReport */

/**
 * A FastReport total as DevExpress sums it: the function its `TotalType`
 * names and the expression it sums, each field by its own name; null for one
 * whose expression holds more than fields, numbers and arithmetic, which the
 * text naming it then prints as written.
 */
export interface FrxTotal {
  fn: string;
  expression: string;
}
export type FrxTotals = ReadonlyMap<string, FrxTotal | null>;

const FRX_TOTAL_TYPES: Record<string, string> = { sum: 'sumSum', count: 'sumCount', avg: 'sumAvg', min: 'sumMin', max: 'sumMax', countdistinct: 'sumDCount' };

/** A FastReport field reference, `Source.Field`, as DevExpress names the field. */
const frxField = (ref: string) => ref.split('.').pop()!.replace(/[^\p{L}\p{N}_ ]/gu, '').trim() || 'Field';
const FRX_FIELD = /^[\p{L}_][\p{L}\p{N}_ ]*(?:\.[\p{L}\p{N}_ ]+)*$/u;

/** A total's expression with its fields as DevExpress names them, or null when it holds anything else. */
function frxExpression(expression: string): string | null {
  const fields: string[] = [];
  const rest = expression.replace(/\[([^\]]+)\]/g, (_, ref: string) => `\u0000${fields.push(frxField(ref.trim())) - 1}\u0000`);
  if (!/^[\s\d.+\-*/()\u0000]*$/.test(rest)) return null;
  return rest.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `[${fields[Number(i)]}]`).trim();
}

/**
 * The totals a FastReport report's dictionary declares, by name (2026-11-11,
 * the re-audit's R3-01): each summed over the field its `Expression` names,
 * with the function its `TotalType` names (Sum when it names none). Until
 * then a total was written as `sumSum([<the total's name>])`, a field no data
 * source has, so every imported total printed blank.
 */
export function frxTotals(root: XmlEl): Map<string, FrxTotal | null> {
  const out = new Map<string, FrxTotal | null>();
  const dictionary = root.children.find((c) => c.name === 'Dictionary');
  for (const t of dictionary?.children ?? []) {
    if (t.name !== 'Total' || !t.attrs.Name) continue;
    const fn = FRX_TOTAL_TYPES[(t.attrs.TotalType ?? 'Sum').toLowerCase()];
    const expression = fn ? frxExpression(t.attrs.Expression ?? '') : null;
    // A count needs nothing to count; every other total needs its field.
    out.set(t.attrs.Name, fn && expression !== null && (expression || fn === 'sumCount') ? { fn, expression } : null);
  }
  return out;
}

/**
 * FastReport's page variables in a text that holds nothing else, as a page
 * information control's format: the page number is {0}, the total pages {1}.
 * `PageN` and `PageNofM` are FastReport's own "Page 1" and "Page 1 of 5".
 */
const FRX_PAGE: Record<string, string> = { page: '{0}', 'page#': '{0}', pagen: 'Page {0}', totalpages: '{1}', 'totalpages#': '{1}', pagenofm: 'Page {0} of {1}' };
/** The date and time variables, as a date control's format, and as an expression beside other words. */
const FRX_DATE: Record<string, { format: string; expression: string }> = {
  date: { format: '{0:d}', expression: "FormatString('{0:d}', Today())" },
  time: { format: '{0:t}', expression: "FormatString('{0:t}', Now())" },
  now: { format: '{0:g}', expression: "FormatString('{0:g}', Now())" },
};
/**
 * Whether a table above holds a name as its own key. `in` also finds
 * Object.prototype's, so a FastReport text `[constructor]` was taken for a page
 * variable and wrote `function Object() { [native code] }` as its format
 * (2026-11-12, the review of R3-01).
 */
const own = (table: object, name: string) => Object.prototype.hasOwnProperty.call(table, name);
/** Braces in words a format carries, doubled so they print as written. */
const braces = (words: string) => words.replace(/[{}]/g, (b) => b + b);
/** Words as a DevExpress string. */
const quoted = (words: string) => `'${words.replace(/'/g, "''")}'`;

/**
 * A text's binding, as FastReport writes it: page information, the date, or
 * an expression of its words, fields and totals (2026-11-11, the re-audit's
 * R3-01). Until then a text with a field kept the field alone, so
 * "Customer: [Customers.Name]" lost "Customer: ", and [Date], [Time] and
 * [Now] were taken for page numbers. A reference that is none of these (an
 * expression, a variable FastReport has and DevExpress lacks) leaves the
 * whole text printing as written.
 */
function frxText(text: string, totals: FrxTotals): { type: 'XRPageInfo' | 'XRLabel'; attrs: string; inner: string } {
  const literal = { type: 'XRLabel' as const, attrs: ` Text="${esc(text)}"`, inner: '' };
  // Even places are words, odd ones what sat inside brackets.
  const parts = text.split(/\[([^\]]+)\]/);
  const refs = parts.filter((_, i) => i % 2 === 1).map((r) => r.trim());
  if (!refs.length) return literal;
  const key = (r: string) => r.toLowerCase();
  const format = (of: (ref: string) => string) => parts.map((p, i) => (i % 2 ? of(key(p.trim())) : braces(p))).join('');
  if (refs.every((r) => own(FRX_PAGE, key(r)))) {
    const written = format((r) => FRX_PAGE[r]);
    const total = written.includes('{1}');
    const plain = !total && written === '{0}';
    return { type: 'XRPageInfo', attrs: ` PageInfo="${total ? 'NumberOfTotal' : 'Number'}"${plain ? '' : ` TextFormatString="${esc(written)}"`}`, inner: '' };
  }
  if (refs.every((r) => own(FRX_DATE, key(r)))) {
    return { type: 'XRPageInfo', attrs: ` PageInfo="DateTime" TextFormatString="${esc(format((r) => FRX_DATE[r].format))}"`, inner: '' };
  }
  const pieces: string[] = [];
  let summed = false;
  for (const [i, part] of parts.entries()) {
    if (i % 2 === 0) {
      if (part) pieces.push(quoted(part));
      continue;
    }
    const ref = part.trim();
    if (totals.has(ref)) {
      const total = totals.get(ref);
      if (!total) return literal;
      pieces.push(`${total.fn}(${total.expression})`);
      summed = true;
    } else if (own(FRX_DATE, key(ref))) pieces.push(FRX_DATE[key(ref)].expression);
    else if (own(FRX_PAGE, key(ref)) || !FRX_FIELD.test(ref)) return literal;
    else pieces.push(`[${frxField(ref)}]`);
  }
  const binding = `<ExpressionBindings><Item1 Ref="${REF}" EventName="BeforePrint" PropertyName="Text" Expression="${esc(pieces.join(' + '))}" /></ExpressionBindings>`;
  return { type: 'XRLabel', attrs: '', inner: summed ? `${binding}<Summary Ref="${REF}" Running="${RUNNING}" />` : binding };
}

/**
 * Where a text's inner XML takes a new Ref and its band's running scope.
 * Control characters, which `decode` keeps out of every text read, so words
 * such as "{ref}" in a report are never taken for one (they were, until the
 * re-audit's R3-01 put the words into the expression).
 */
const REF = '\u0001ref\u0001';
const RUNNING = '\u0001running\u0001';
const fillInner = (inner: string, next: () => number, running: string) => inner.replace(/\u0001ref\u0001/g, () => String(next())).replace(/\u0001running\u0001/g, () => running);

const FRX_ALIGN: Record<string, string> = { Left: 'Left', Center: 'Center', Right: 'Right', Justify: 'Justify' };
const FRX_VALIGN: Record<string, string> = { Top: 'Top', Center: 'Middle', Bottom: 'Bottom' };

function frxLooks(a: Record<string, string>): string {
  const parts: string[] = [];
  if (a.Font) parts.push(` Font="${esc(a.Font)}"`);
  const h = a.HorzAlign && own(FRX_ALIGN, a.HorzAlign) ? FRX_ALIGN[a.HorzAlign] : 'Left';
  const v = a.VertAlign && own(FRX_VALIGN, a.VertAlign) ? FRX_VALIGN[a.VertAlign] : 'Top';
  if (a.HorzAlign || a.VertAlign) parts.push(` TextAlignment="${v}${h}"`);
  const lines = a['Border.Lines'];
  if (lines && lines !== 'None') parts.push(` Borders="${esc(lines === 'All' ? 'All' : lines)}"`);
  return parts.join('');
}

const FRX_OBJECTS: Record<string, string> = {
  LineObject: 'XRLine',
  ShapeObject: 'XRShape',
  PolygonObject: 'XRShape',
  PolyLineObject: 'XRShape',
  PictureObject: 'XRPictureBox',
  SVGObject: 'XRPictureBox',
  CheckBoxObject: 'XRCheckBox',
  BarcodeObject: 'XRBarCode',
  MSChartObject: 'XRChart',
  SubreportObject: 'XRSubreport',
  RichObject: 'XRRichText',
};

const num = (v: string | undefined, d = 0) => (v === undefined || v === '' ? d : Number(v.replace(',', '.')) || d);

/** The controls of one FastReport band element, its child bands' stacked below. */
function frxControls(band: XmlEl, totals: FrxTotals, kind: Kind, dy: number, out: string[], next: () => number): number {
  let height = num(band.attrs.Height) * PX;
  const running = kind === 'GroupFooter' ? 'Group' : 'Report';
  const place = (a: Record<string, string>, ox = 0, oy = 0) =>
    ` LocationFloat="${r2(num(a.Left) * PX + ox)}, ${r2(num(a.Top) * PX + oy + dy)}" SizeF="${r2(Math.max(1, num(a.Width) * PX))}, ${r2(Math.max(1, num(a.Height) * PX))}"`;
  const walk = (el: XmlEl, ox: number, oy: number) => {
    for (const c of el.children) {
      if (c.name === 'TextObject' || c.name === 'CellularTextObject' || c.name === 'HtmlObject') {
        const t = frxText(c.attrs.Text ?? '', totals);
        const ref = next();
        out.push(`<Item${ITEM} Ref="${ref}" ControlType="${t.type}" Name="c${ref}"${t.attrs}${place(c.attrs, ox, oy)}${frxLooks(c.attrs)}>${fillInner(t.inner, next, running)}</Item${ITEM}>`);
      } else if (c.name === 'TableObject') {
        const widths = c.children.filter((k) => k.name === 'TableColumn').map((k) => num(k.attrs.Width, 1));
        const rows = c.children.filter((k) => k.name === 'TableRow');
        const tableRef = next();
        const rowXml = rows.map((row, ri) => {
          let col = 0;
          const cells = row.children.filter((k) => k.name === 'TableCell').map((cell, ci) => {
            const span = Math.max(1, num(cell.attrs.ColSpan, 1));
            const weight = widths.slice(col, col + span).reduce((a, w) => a + w, 0) || 1;
            col += span;
            const t = frxText(cell.attrs.Text ?? '', totals);
            const ref = next();
            return `<Item${ci + 1} Ref="${ref}" ControlType="XRTableCell" Name="t${ref}"${t.type === 'XRLabel' ? t.attrs : ''} Weight="${r2(weight)}"${frxLooks(cell.attrs)}>${t.type === 'XRLabel' ? fillInner(t.inner, next, running) : ''}</Item${ci + 1}>`;
          });
          return `<Item${ri + 1} Ref="${next()}" ControlType="XRTableRow" Name="r${tableRef}_${ri}" Weight="${r2(num(row.attrs.Height, 18.9))}"><Cells>${cells.join('')}</Cells></Item${ri + 1}>`;
        });
        out.push(`<Item${ITEM} Ref="${tableRef}" ControlType="XRTable" Name="t${tableRef}"${place(c.attrs, ox, oy)}><Rows>${rowXml.join('')}</Rows></Item${ITEM}>`);
      } else if (FRX_OBJECTS[c.name]) {
        const ref = next();
        out.push(`<Item${ITEM} Ref="${ref}" ControlType="${FRX_OBJECTS[c.name]}" Name="o${ref}"${place(c.attrs, ox, oy)} />`);
      } else if (c.name === 'ContainerObject') {
        walk(c, ox + num(c.attrs.Left) * PX, oy + num(c.attrs.Top) * PX);
      }
    }
  };
  walk(band, 0, 0);
  for (const child of band.children.filter((k) => k.name === 'ChildBand')) {
    height += frxControls(child, totals, kind, dy + height, out, next);
  }
  return height;
}

/**
 * One FastReport page as a DevExpress REPX, or why it was left out.
 *
 * The mapping, FastReport to DevExpress:
 * - bands: the report title to the report header; the page header, a column
 *   header and a data header (the column captions above the records) to the
 *   page header; a group header with its condition's field to a group header,
 *   nested by depth; the data band to Detail; a group footer to a group
 *   footer; a data footer and the report summary to the report footer; the
 *   page and column footers to the page footer. A child band is stacked under
 *   its parent, and two bands that map to one are stacked in order.
 * - objects: text, a table (its columns' widths as cell weights), a line, a
 *   shape or polygon, a picture or SVG, a check box, a barcode, a chart, a
 *   subreport and rich text, each to its DevExpress control; a matrix, a map
 *   and a sparkline are left out, having none to map to here.
 * - units: FastReport's are pixels at 96 to the inch and its paper
 *   millimetres; the REPX's are hundredths of an inch.
 * A page whose data band holds another (master and detail) is left out,
 * rather than mapped to a guess.
 */
export function frxPageToRepx(page: XmlEl, totals: FrxTotals, name: string): { repx: string } | { skipped: string } {
  let ref = 1;
  const next = () => ++ref;
  const bands: Band[] = [];
  const add = (kind: Kind, el: XmlEl, level = 0, field: string | null = null) => {
    let b = bands.find((x) => x.kind === kind && x.level === level && kind !== 'GroupHeader' && kind !== 'GroupFooter');
    if (!b) bands.push((b = { kind, level, field, height: 0, controls: [] }));
    b.height += frxControls(el, totals, kind, b.height, b.controls, next);
  };
  let nested = false;
  let depth = 0;
  const walkBands = (el: XmlEl, inData: boolean) => {
    for (const c of el.children) {
      switch (c.name) {
        case 'ReportTitleBand':
          add('ReportHeader', c);
          break;
        case 'PageHeaderBand':
        case 'ColumnHeaderBand':
        case 'DataHeaderBand':
          add('PageHeader', c);
          break;
        case 'GroupHeaderBand': {
          const level = depth++;
          const m = /\[([^\]]+)\]/.exec(c.attrs.Condition ?? '');
          add('GroupHeader', c, level, m ? m[1].split('.').pop()!.trim() : null);
          walkBands(c, inData);
          depth--;
          break;
        }
        case 'DataBand':
          if (inData) nested = true;
          else {
            add('Detail', c);
            walkBands(c, true);
          }
          break;
        case 'GroupFooterBand':
          add('GroupFooter', c, depth - 1);
          break;
        case 'DataFooterBand':
        case 'ReportSummaryBand':
          add('ReportFooter', c);
          break;
        case 'PageFooterBand':
        case 'ColumnFooterBand':
          add('PageFooter', c);
          break;
      }
    }
  };
  walkBands(page, false);
  if (nested) return { skipped: 'a data band inside another (master and detail)' };
  if (!bands.some((b) => b.kind === 'Detail')) return { skipped: 'no data band' };

  const a = page.attrs;
  let width = num(a.PaperWidth, 210) * MM;
  let height = num(a.PaperHeight, 297) * MM;
  if (a.Landscape === 'true' && width < height) [width, height] = [height, width];
  const m = [num(a.LeftMargin, 10), num(a.RightMargin, 10), num(a.TopMargin, 10), num(a.BottomMargin, 10)].map((v) => r2(v * MM));
  const repx = writeRepx(name, { width: r2(width), height: r2(height), margins: [m[0], m[1], m[2], m[3]], landscape: a.Landscape === 'true', paperKind: 'Custom' }, bands, next);
  return { repx };
}

/** A FastReport file's first page that converts, or why none did. */
export function frxToRepx(xml: string, name: string): { repx: string } | { skipped: string } {
  const root = parseXml(xml);
  if (!root || root.name !== 'Report') return { skipped: 'not a FastReport report' };
  const totals = frxTotals(root);
  let why = 'no page';
  for (const page of root.children.filter((c) => c.name === 'ReportPage')) {
    const made = frxPageToRepx(page, totals, name);
    if ('repx' in made) return made;
    why = made.skipped;
  }
  return { skipped: why };
}

/* ------------------------------------------------------------- SSRS */

const local = (el: XmlEl) => el.name.replace(/^.*:/, '');
const child = (el: XmlEl | undefined, name: string) => el?.children.find((c) => local(c) === name);
const childrenNamed = (el: XmlEl | undefined, name: string) => el?.children.filter((c) => local(c) === name) ?? [];
const textOf = (el: XmlEl | undefined, name: string) => child(el, name)?.text.trim() ?? '';
/** A written length in hundredths of an inch, 0 when absent. */
const lengthOf = (el: XmlEl | undefined, name: string, fallback = 0) => {
  const points = lengthToPoints(textOf(el, name));
  return points === null ? fallback : pointsToUnits(points, UNIT);
};

/** What an SSRS value becomes: a text, an expression (and whether it totals), or page information. */
export type RdlValue =
  | { text: string }
  | { expression: string; aggregate: boolean }
  | { pageInfo: 'Number' | 'NumberOfTotal' | 'DateTime'; format?: string }
  | { unconverted: string };

const AGGREGATES: Record<string, string> = { sum: 'sumSum', avg: 'sumAvg', count: 'sumCount', min: 'sumMin', max: 'sumMax', countdistinct: 'sumDCount' };

/** The functions a converted expression may call, by DevExpress's names, lower case. */
const DX_FUNCTIONS = new Set(
  ['Iif', 'Upper', 'Lower', 'Trim', 'Len', 'Substring', 'Concat', 'Replace', 'Round', 'Abs', 'Floor', 'Ceiling', 'Max', 'Min', 'IsNull', 'IsNullOrEmpty', 'ToStr', 'GetYear', 'GetMonth', 'GetDay', 'Now', 'Today', 'FormatString', ...Object.values(AGGREGATES)].map((f) => f.toLowerCase()),
);

/** The page globals SSRS writes, as a page information control's format: the page {0}, the total pages {1}. */
const RDL_PAGE_GLOBALS: Record<string, string> = { pagenumber: '{0}', overallpagenumber: '{0}', totalpages: '{1}', overalltotalpages: '{1}' };

/**
 * The pieces of an expression joined by `&`, outside strings and brackets, or
 * null when it does not read as one: each piece a string ("Page "), a global
 * (Globals!PageNumber), or such a join in brackets.
 */
function rdlConcatenation(body: string): string[] | null {
  const pieces: string[] = [];
  let depth = 0;
  let inString = false;
  let current = '';
  for (const ch of body) {
    if (ch === '"') inString = !inString;
    else if (!inString && ch === '(') depth++;
    else if (!inString && ch === ')') depth--;
    if (depth < 0) return null;
    if (ch === '&' && !inString && depth === 0) {
      pieces.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (inString || depth !== 0) return null;
  pieces.push(current.trim());
  const out: string[] = [];
  for (const piece of pieces) {
    if (/^\(.*\)$/s.test(piece)) {
      const inner = rdlConcatenation(piece.slice(1, -1).trim());
      if (!inner) return null;
      out.push(...inner);
    } else out.push(piece);
  }
  return out;
}

/**
 * A page number, the total pages or the time printed, with the words around
 * them, as a page information control (2026-11-11, the re-audit's R3-03):
 * `="Page " & Globals!PageNumber` is "Page {0}", and the words of a page of a
 * total kept as written ("Seite {0} von {1}"). Until then the first printed
 * the formula itself and the second was always "Page {0} of {1}". Null for
 * anything else joined in, which then prints as written and is counted.
 */
function rdlPageInfo(body: string): RdlValue | null {
  const pieces = rdlConcatenation(body);
  if (!pieces) return null;
  let format = '';
  let page = false;
  let total = false;
  let time = false;
  for (const piece of pieces) {
    const words = /^"((?:[^"]|"")*)"$/.exec(piece);
    if (words) {
      format += braces(words[1].replace(/""/g, '"'));
      continue;
    }
    const global = /^Globals!(\w+)$/i.exec(piece)?.[1].toLowerCase();
    if (global && own(RDL_PAGE_GLOBALS, global)) {
      format += RDL_PAGE_GLOBALS[global];
      if (global.endsWith('totalpages')) total = true;
      else page = true;
    } else if (global === 'executiontime') {
      format += '{0}';
      time = true;
    } else return null;
  }
  if (time) return page || total ? null : format === '{0}' ? { pageInfo: 'DateTime' } : { pageInfo: 'DateTime', format };
  if (total) return { pageInfo: 'NumberOfTotal', format };
  return page ? (format === '{0}' ? { pageInfo: 'Number' } : { pageInfo: 'Number', format }) : null;
}

/**
 * An SSRS value as DevExpress writes it. A value without a leading `=` is
 * text. One with is an expression, converted as the module comment says, or
 * `unconverted` when anything is left that DevExpress would not read.
 */
export function rdlValue(value: string): RdlValue {
  const v = value.trim();
  if (!v.startsWith('=')) return { text: value };
  const body = v.slice(1).trim();
  if (/\bGlobals!(?:Overall)?(?:PageNumber|TotalPages)\b|\bGlobals!ExecutionTime\b/i.test(body)) {
    const page = rdlPageInfo(body);
    if (page) return page;
  }
  // Strings first, so nothing inside one is converted: "a & b" stays as written.
  const strings: string[] = [];
  let out = body.replace(/"((?:[^"]|"")*)"/g, (_, s: string) => `\u0000${strings.push(s.replace(/""/g, '"')) - 1}\u0000`);
  let aggregate = false;
  out = out
    .replace(/\bFields!([\p{L}_][\p{L}\p{N}_]*)\.Value\b/gu, (_, f: string) => `[${f}]`)
    .replace(/\bParameters!([\p{L}_][\p{L}\p{N}_]*)\.Value\b/gu, (_, p: string) => `?${p}`)
    .replace(/\b(Sum|Avg|Count|Min|Max|CountDistinct)\s*\(\s*(\[[^\]]+\])\s*(?:,\s*\u0000\d+\u0000\s*)?\)/gi, (_, fn: string, field: string) => {
      aggregate = true;
      return `${AGGREGATES[fn.toLowerCase()]}(${field})`;
    })
    .replace(/\bIIf\s*\(/gi, 'Iif(')
    .replace(/\bUCase\s*\(/gi, 'Upper(')
    .replace(/\bLCase\s*\(/gi, 'Lower(')
    .replace(/&/g, '+');
  if (/!|\bCode\.|\.Value\b|\bMe\.|\bNothing\b/.test(out)) return { unconverted: value };
  // A function DevExpress lacks would print nothing there: said instead.
  if ([...out.matchAll(/([\p{L}_][\p{L}\p{N}_]*)\s*\(/gu)].some((m) => !DX_FUNCTIONS.has(m[1].toLowerCase()))) return { unconverted: value };
  const expression = out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `'${strings[Number(i)].replace(/'/g, "''")}'`);
  return { expression, aggregate };
}

/** A colour as DevExpress writes one: a name as it is, `#RRGGBB` as "r, g, b". */
function colourOf(written: string): string | null {
  const c = written.trim();
  if (!c || c.startsWith('=') || /^transparent$/i.test(c)) return null;
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  if (hex) return `${parseInt(hex[1], 16)}, ${parseInt(hex[2], 16)}, ${parseInt(hex[3], 16)}`;
  return /^[A-Za-z]+$/.test(c) ? c : null;
}

/** Which sides of a box SSRS draws: `Border` for all, a side's own border over it. */
function bordersOf(style: XmlEl | undefined): string {
  const drawn = (el: XmlEl | undefined) => {
    const s = textOf(el, 'Style');
    return s ? !/^none$/i.test(s) : null;
  };
  const all = drawn(child(style, 'Border')) ?? false;
  const sides = (['Left', 'Top', 'Right', 'Bottom'] as const).filter((side) => drawn(child(style, `${side}Border`)) ?? all);
  if (sides.length === 4) return ' Borders="All"';
  return sides.length ? ` Borders="${sides.join(', ')}"` : '';
}

/** SSRS's alignments, by their lower-case names, as DevExpress's. */
const RDL_ACROSS: Record<string, string> = { center: 'Center', right: 'Right', left: 'Left' };
const RDL_DOWN: Record<string, string> = { middle: 'Middle', bottom: 'Bottom' };

/** A text box's look: its first run's font, its paragraph's alignment, its box's colours and borders. */
function rdlLooks(box: XmlEl): string {
  const paragraph = child(child(box, 'Paragraphs'), 'Paragraph');
  const run = child(child(paragraph, 'TextRuns'), 'TextRun');
  const boxStyle = child(box, 'Style');
  // RDL 2005 keeps everything on the text box's own style.
  const fontStyle = child(run, 'Style') ?? boxStyle;
  const family = textOf(fontStyle, 'FontFamily') || 'Arial';
  const size = lengthToPoints(textOf(fontStyle, 'FontSize')) ?? 10;
  const flags = [/^(bold|bolder|semibold|extrabold|heavy|black)$/i.test(textOf(fontStyle, 'FontWeight')) && 'Bold', /^italic$/i.test(textOf(fontStyle, 'FontStyle')) && 'Italic'].filter(Boolean);
  const parts = [` Font="${esc(`${family}, ${r2(size)}pt${flags.length ? `, style=${flags.join(', ')}` : ''}`)}"`];
  const across = (textOf(child(paragraph, 'Style'), 'TextAlign') || textOf(boxStyle, 'TextAlign')).toLowerCase();
  const down = textOf(boxStyle, 'VerticalAlign').toLowerCase();
  const h = own(RDL_ACROSS, across) ? RDL_ACROSS[across] : 'Left';
  const v = own(RDL_DOWN, down) ? RDL_DOWN[down] : 'Top';
  if (h !== 'Left' || v !== 'Top') parts.push(` TextAlignment="${v}${h}"`);
  const fore = colourOf(textOf(fontStyle, 'Color'));
  if (fore && !/^black$/i.test(fore)) parts.push(` ForeColor="${esc(fore)}"`);
  const back = colourOf(textOf(boxStyle, 'BackgroundColor'));
  if (back) parts.push(` BackColor="${esc(back)}"`);
  parts.push(bordersOf(boxStyle));
  return parts.join('');
}

/** A text box's value: its runs joined (RDL 2008 and later), or its `Value` (2005). */
function boxValue(box: XmlEl): string {
  const paragraphs = childrenNamed(child(box, 'Paragraphs'), 'Paragraph');
  if (!paragraphs.length) return textOf(box, 'Value');
  const runs = paragraphs.map((p) => childrenNamed(child(p, 'TextRuns'), 'TextRun').map((r) => child(r, 'Value')?.text ?? ''));
  const all = runs.flat();
  if (all.length === 1) return all[0];
  if (all.every((r) => !r.trim().startsWith('='))) return runs.map((r) => r.join('')).join('\n');
  // Several runs, some of them expressions: one expression of them all.
  const pieces = runs.map((r) => r.map((x) => (x.trim().startsWith('=') ? `(${x.trim().slice(1)})` : `"${x.replace(/"/g, '""')}"`)).join(' & '));
  return `=${pieces.join(' & "\n" & ')}`;
}

/** What converting an SSRS file met that the user should know of. */
interface RdlState {
  next: () => number;
  /** Expressions that print as written. */
  unconverted: number;
  /** Charts, maps, gauges, subreports and 2005 matrices, which are not converted. */
  dropped: number;
}

/** A text's binding and control type, with the summary a total needs in its band. */
function textControl(value: string, running: string, state: RdlState): { type: string; attrs: string; inner: string } {
  const v = rdlValue(value);
  if ('pageInfo' in v) {
    return { type: 'XRPageInfo', attrs: ` PageInfo="${v.pageInfo}"${v.format ? ` TextFormatString="${esc(v.format)}"` : ''}`, inner: '' };
  }
  if ('text' in v) return { type: 'XRLabel', attrs: v.text ? ` Text="${esc(v.text)}"${/\n/.test(v.text) ? ' Multiline="true"' : ''}` : '', inner: '' };
  if ('unconverted' in v) {
    state.unconverted++;
    return { type: 'XRLabel', attrs: ` Text="${esc(v.unconverted)}"`, inner: '' };
  }
  const binding = `<ExpressionBindings><Item1 Ref="${state.next()}" EventName="BeforePrint" PropertyName="Text" Expression="${esc(v.expression)}" /></ExpressionBindings>`;
  return { type: 'XRLabel', attrs: '', inner: v.aggregate ? `${binding}<Summary Ref="${state.next()}" Running="${running}" />` : binding };
}

/** One report item as a control placed at `dx`, `dy` inside its band, or null for one not converted. */
function rdlItem(item: XmlEl, dx: number, dy: number, running: string, state: RdlState): string | null {
  const kind = local(item);
  const x = lengthOf(item, 'Left') + dx;
  const y = lengthOf(item, 'Top') + dy;
  const w = Math.max(1, lengthOf(item, 'Width', 100));
  const h = Math.max(1, lengthOf(item, 'Height', 25));
  const ref = state.next();
  const name = esc(item.attrs.Name || `c${ref}`);
  const place = ` LocationFloat="${r2(x)}, ${r2(y)}" SizeF="${r2(w)}, ${r2(h)}"`;
  if (kind === 'Textbox') {
    const t = textControl(boxValue(item), running, state);
    return `<Item${ITEM} Ref="${ref}" ControlType="${t.type}" Name="${name}"${t.attrs}${place}${rdlLooks(item)}>${t.inner}</Item${ITEM}>`;
  }
  if (kind === 'Line') {
    // A line's height or width is 0 along it; DevExpress draws one inside its box.
    const vertical = Math.abs(lengthOf(item, 'Width')) < Math.abs(lengthOf(item, 'Height'));
    return `<Item${ITEM} Ref="${ref}" ControlType="XRLine" Name="${name}"${vertical ? ' LineDirection="Vertical"' : ''} LocationFloat="${r2(x)}, ${r2(y)}" SizeF="${r2(vertical ? 2 : w)}, ${r2(vertical ? h : 2)}" />`;
  }
  if (kind === 'Image') return `<Item${ITEM} Ref="${ref}" ControlType="XRPictureBox" Name="${name}"${place} />`;
  if (kind === 'Rectangle') {
    // A rectangle holds its items at positions inside it, as a panel does.
    const controls = itemsOf(child(item, 'ReportItems'), 0, 0, running, state).map((c, ci) => c.replace(/\u0001i\u0001/g, String(ci + 1)));
    return `<Item${ITEM} Ref="${ref}" ControlType="XRPanel" Name="${name}"${place}${bordersOf(child(item, 'Style'))}>${controls.length ? `<Controls>${controls.join('')}</Controls>` : ''}</Item${ITEM}>`;
  }
  if (kind === 'Tablix' || kind === 'Table' || kind === 'Matrix' || kind === 'List') {
    const grid = gridOf(item);
    if (grid) return tableXml(grid.rows, grid.widths, x, y, item.attrs.Name || `t${ref}`, running, state);
    // A 2005 matrix, which has no rows to read: said, as a chart is, not lost silently (R3-11).
  }
  state.dropped++;
  return null;
}

/** Every item of a `ReportItems` element, placed. */
function itemsOf(items: XmlEl | undefined, dx: number, dy: number, running: string, state: RdlState): string[] {
  return (items?.children ?? []).flatMap((item) => rdlItem(item, dx, dy, running, state) ?? []);
}

/** A grid's row: its height, its cells (each a text box and how many columns it spans) and what it is. */
interface GridRow {
  height: number;
  cells: { box: XmlEl | null; span: number }[];
  role: 'header' | 'detail' | 'footer' | { group: string; depth: number; header: boolean };
}

/**
 * The rows and column widths of a Tablix (2008 and later) or a Table (2005),
 * each row placed by the row hierarchy: inside the details group, a group's
 * own rows (before the details its header, after them its footer), or
 * outside every group (the table's heading before, its totals after).
 */
function gridOf(table: XmlEl): { rows: GridRow[]; widths: number[] } | null {
  const body = child(table, 'TablixBody');
  if (body) {
    const widths = childrenNamed(child(body, 'TablixColumns'), 'TablixColumn').map((c) => lengthOf(c, 'Width', 100));
    const raw = childrenNamed(child(body, 'TablixRows'), 'TablixRow');
    const roles = leafRoles(child(child(table, 'TablixRowHierarchy'), 'TablixMembers'));
    const firstDetail = roles.findIndex((r) => r.details);
    const rows = raw.map((row, i): GridRow => {
      const cells = childrenNamed(child(row, 'TablixCells'), 'TablixCell').map((cell) => {
        const contents = child(cell, 'CellContents');
        return { box: child(contents, 'Textbox') ?? null, span: Math.max(1, Number(textOf(contents, 'ColSpan')) || 1) };
      });
      const leaf = roles[i];
      const role: GridRow['role'] = !leaf
        ? 'detail'
        : leaf.details
          ? 'detail'
          : leaf.groups.length
            ? { group: leaf.groups[leaf.groups.length - 1], depth: leaf.groups.length - 1, header: firstDetail < 0 || i < firstDetail }
            : firstDetail < 0 || i < firstDetail
              ? 'header'
              : 'footer';
      return { height: lengthOf(row, 'Height', 25), cells, role };
    });
    return rows.length && widths.length ? { rows, widths } : null;
  }
  // RDL 2005: <Table> with <TableColumns>, <Header>, <Details>, <TableGroups>, <Footer>.
  const widths = childrenNamed(child(table, 'TableColumns'), 'TableColumn').map((c) => lengthOf(c, 'Width', 100));
  const rowsOf = (el: XmlEl | undefined, role: GridRow['role']): GridRow[] =>
    childrenNamed(child(el, 'TableRows'), 'TableRow').map((row) => ({
      height: lengthOf(row, 'Height', 25),
      cells: childrenNamed(child(row, 'TableCells'), 'TableCell').map((cell) => ({
        box: child(child(cell, 'ReportItems'), 'Textbox') ?? null,
        span: Math.max(1, Number(textOf(cell, 'ColSpan')) || 1),
      })),
      role,
    }));
  const groups = childrenNamed(child(table, 'TableGroups'), 'TableGroup');
  const groupField = (g: XmlEl) => /Fields!([\p{L}_][\p{L}\p{N}_]*)\.Value/u.exec(textOf(child(child(g, 'Grouping'), 'GroupExpressions'), 'GroupExpression'))?.[1] ?? '';
  const rows = [
    ...rowsOf(child(table, 'Header'), 'header'),
    ...groups.flatMap((g, depth) => rowsOf(child(g, 'Header'), { group: groupField(g), depth, header: true })),
    ...rowsOf(child(table, 'Details'), 'detail'),
    ...groups
      .map((g, depth) => rowsOf(child(g, 'Footer'), { group: groupField(g), depth, header: false }))
      .reverse()
      .flat(),
    ...rowsOf(child(table, 'Footer'), 'footer'),
  ];
  return rows.length && widths.length ? { rows, widths } : null;
}

/** Each leaf of a row hierarchy, in row order: the groups around it and whether it is inside the details. */
function leafRoles(members: XmlEl | undefined, groups: string[] = [], details = false): { groups: string[]; details: boolean }[] {
  const out: { groups: string[]; details: boolean }[] = [];
  for (const member of childrenNamed(members, 'TablixMember')) {
    const group = child(member, 'Group');
    const expression = textOf(child(group, 'GroupExpressions'), 'GroupExpression');
    const field = /Fields!([\p{L}_][\p{L}\p{N}_]*)\.Value/u.exec(expression)?.[1];
    const inDetails = details || (!!group && !expression);
    const around = field ? [...groups, field] : groups;
    const inner = child(member, 'TablixMembers');
    if (inner) out.push(...leafRoles(inner, around, inDetails));
    else out.push({ groups: around, details: inDetails });
  }
  return out;
}

/** Rows of a grid as one XRTable at `x`, `y`, its columns' widths as its cells' weights. */
function tableXml(rows: GridRow[], widths: number[], x: number, y: number, name: string, running: string, state: RdlState): string {
  const tableRef = state.next();
  const total = widths.reduce((a, w) => a + w, 0);
  const height = rows.reduce((a, r) => a + r.height, 0);
  const rowXml = rows.map((row, ri) => {
    let col = 0;
    const cells = row.cells.map((cell, ci) => {
      const weight = widths.slice(col, col + cell.span).reduce((a, w) => a + w, 0) || 1;
      col += cell.span;
      const ref = state.next();
      const t = cell.box ? textControl(boxValue(cell.box), running, state) : { type: 'XRLabel', attrs: '', inner: '' };
      // A cell is not a page-information control: it prints the formula as
      // written, and the import's notice counts it (2026-11-12, the review of
      // R3-03; since rdlPageInfo read "Page " & PageNumber, such a cell was
      // left blank and nothing said so).
      let attrs = t.attrs;
      if (t.type !== 'XRLabel' && cell.box) {
        state.unconverted++;
        attrs = ` Text="${esc(boxValue(cell.box))}"`;
      }
      const cellName = esc(cell.box?.attrs.Name || `cell${ref}`);
      return `<Item${ci + 1} Ref="${ref}" ControlType="XRTableCell" Name="${cellName}"${attrs} Weight="${r2(weight)}"${cell.box ? rdlLooks(cell.box) : ''}>${t.type === 'XRLabel' ? t.inner : ''}</Item${ci + 1}>`;
    });
    return `<Item${ri + 1} Ref="${state.next()}" ControlType="XRTableRow" Name="${esc(name)}Row${ri + 1}" Weight="${r2(row.height)}"><Cells>${cells.join('')}</Cells></Item${ri + 1}>`;
  });
  return `<Item${ITEM} Ref="${tableRef}" ControlType="XRTable" Name="${esc(name)}" LocationFloat="${r2(x)}, ${r2(y)}" SizeF="${r2(total)}, ${r2(height)}"><Rows>${rowXml.join('')}</Rows></Item${ITEM}>`;
}

/** The kinds of report item that are a data region. */
const isGrid = (item: XmlEl) => ['Tablix', 'Table', 'Matrix', 'List'].includes(local(item));

/** The data region and where it sits: the rectangles around it, outermost first, and their offset. */
interface FoundRegion {
  region: XmlEl;
  grid: { rows: GridRow[]; widths: number[] };
  containers: XmlEl[];
  dx: number;
  dy: number;
}

/**
 * The body's data region (2026-11-11, the re-audit's R3-11): the highest grid
 * on the page with rows that print text, searched inside rectangles as well
 * as among the body's own items. Until then only the body's own items were
 * searched, so a table inside a rectangle was drawn once, rows and all, in
 * the report header, with no Detail; and the highest grid was taken whether
 * or not it could be read, so a 2005 matrix above a table lost the table.
 */
function dataRegion(items: readonly XmlEl[]): FoundRegion | null {
  const candidates: Omit<FoundRegion, 'grid'>[] = [];
  const walk = (list: readonly XmlEl[], containers: XmlEl[], dx: number, dy: number) => {
    for (const item of list) {
      if (isGrid(item)) candidates.push({ region: item, containers, dx, dy });
      else if (local(item) === 'Rectangle') {
        walk(child(item, 'ReportItems')?.children ?? [], [...containers, item], dx + lengthOf(item, 'Left'), dy + lengthOf(item, 'Top'));
      }
    }
  };
  walk(items, [], 0, 0);
  candidates.sort((a, b) => a.dy + lengthOf(a.region, 'Top') - (b.dy + lengthOf(b.region, 'Top')));
  const readable: FoundRegion[] = [];
  for (const candidate of candidates) {
    const grid = gridOf(candidate.region);
    // A list's cell holds a rectangle rather than a text box: no rows that print.
    if (grid && grid.rows.some((r) => r.cells.some((c) => c.box))) readable.push({ ...candidate, grid });
  }
  // One with a row per record before one without (2026-11-12, the review of
  // R3-11): a one-row information grid in a heading rectangle sits above the
  // main table, and taking the highest made the table print once, as static
  // content. Among the same kind, the highest still wins.
  return readable.find((r) => r.grid.rows.some((row) => row.role === 'detail')) ?? readable[0] ?? null;
}

/**
 * The body's items, each with the offset its position is read at: the
 * rectangles that hold the data region give up their items to the body, at
 * their own positions on the page, since what they held now prints across
 * several bands. Every other item stays as it is, a rectangle a panel.
 */
function placedAround(items: readonly XmlEl[], containers: readonly XmlEl[], depth = 0, dx = 0, dy = 0): { item: XmlEl; dx: number; dy: number }[] {
  return items.flatMap((item) =>
    item === containers[depth]
      ? placedAround(child(item, 'ReportItems')?.children ?? [], containers, depth + 1, dx + lengthOf(item, 'Left'), dy + lengthOf(item, 'Top'))
      : [{ item, dx, dy }],
  );
}

/**
 * An SSRS report definition as a DevExpress REPX, with what the user should
 * know of it, or why it could not be read.
 */
export function rdlToRepx(xml: string, file: string): { repx: string; unconverted: number; dropped: number } | { skipped: string } {
  const root = parseXml(xml);
  if (!root || local(root) !== 'Report') return { skipped: 'not a report definition' };
  const section = child(child(root, 'ReportSections'), 'ReportSection');
  // 2010 and later: body and page under a section; 2008: body and page on the
  // report itself; 2005: the body, and the page's sizes, on the report. Until
  // the re-audit's R3-02 a 2008 file's <Page> was not read, so its page header,
  // footer, paper and margins were lost.
  const body = child(section ?? root, 'Body');
  if (!body) return { skipped: 'no body' };
  const pageEl = child(section, 'Page') ?? child(root, 'Page') ?? root;
  let ref = 1;
  const state: RdlState = { next: () => ++ref, unconverted: 0, dropped: 0 };
  const bands: Band[] = [];
  const band = (kind: Kind, level = 0, field: string | null = null) => {
    let b = bands.find((x) => x.kind === kind && x.level === level && x.field === field);
    if (!b) bands.push((b = { kind, level, field, height: 0, controls: [] }));
    return b;
  };
  const put = (b: Band, controls: string[], bottom: number) => {
    b.controls.push(...controls);
    b.height = Math.max(b.height, bottom);
  };

  for (const [name, kind] of [['PageHeader', 'PageHeader'], ['PageFooter', 'PageFooter']] as const) {
    const el = child(pageEl, name);
    if (!el) continue;
    put(band(kind), itemsOf(child(el, 'ReportItems'), 0, 0, 'Report', state), lengthOf(el, 'Height', 25));
  }

  const items = child(body, 'ReportItems')?.children ?? [];
  const found = dataRegion(items);
  if (!found) {
    // No data region: the body is the report header, and an empty Detail band beside it.
    put(band('ReportHeader'), itemsOf(child(body, 'ReportItems'), 0, 0, 'Report', state), lengthOf(body, 'Height', 100));
    band('Detail');
  } else {
    const { region, grid } = found;
    const top = found.dy + lengthOf(region, 'Top');
    const bottom = top + grid.rows.reduce((a, r) => a + r.height, 0);
    const x = found.dx + lengthOf(region, 'Left');
    const name = region.attrs.Name || 'table';
    const header = band('ReportHeader');
    const footer = band('ReportFooter');
    const footerRowsHeight = grid.rows.filter((r) => r.role === 'footer').reduce((a, r) => a + r.height, 0);
    for (const { item, dx, dy } of placedAround(items, found.containers)) {
      if (item === region) continue;
      const itemTop = dy + lengthOf(item, 'Top');
      const above = itemTop < top;
      // Below the table, an item keeps its distance from it, under the table's
      // total rows; one beside the table (its top inside it) goes straight
      // under them, never above the footer's top (the review of CP-08).
      const footerTop = footerRowsHeight + Math.max(0, itemTop - bottom);
      const control = rdlItem(item, dx, dy + (above ? 0 : footerTop - itemTop), 'Report', state);
      if (!control) continue;
      if (above) put(header, [control], itemTop + lengthOf(item, 'Height', 25));
      else put(footer, [control], footerTop + lengthOf(item, 'Height', 25));
    }
    // The grid's rows, each run of rows of one role a table in its band.
    const runs: { role: GridRow['role']; rows: GridRow[] }[] = [];
    for (const row of grid.rows) {
      const last = runs[runs.length - 1];
      if (last && JSON.stringify(last.role) === JSON.stringify(row.role)) last.rows.push(row);
      else runs.push({ role: row.role, rows: [row] });
    }
    let footerY = 0;
    for (const [ri, run] of runs.entries()) {
      const h = run.rows.reduce((a, r) => a + r.height, 0);
      const runName = `${name}${runs.length > 1 ? ri + 1 : ''}`;
      if (run.role === 'header') {
        const y = Math.max(top, header.height);
        put(header, [tableXml(run.rows, grid.widths, x, y, runName, 'Report', state)], y + h);
      } else if (run.role === 'detail') {
        const b = band('Detail');
        put(b, [tableXml(run.rows, grid.widths, x, b.height, runName, 'Report', state)], b.height + h);
      } else if (run.role === 'footer') {
        put(footer, [tableXml(run.rows, grid.widths, x, footerY, runName, 'Report', state)], footerY + h);
        footerY += h;
      } else {
        // A group's footer needs its header, which carries the field it groups on.
        const head = band('GroupHeader', run.role.depth, run.role.group);
        const b = run.role.header ? head : band('GroupFooter', run.role.depth, null);
        put(b, [tableXml(run.rows, grid.widths, x, b.height, runName, 'Group', state)], b.height + h);
      }
    }
    band('Detail');
    if (!header.controls.length) bands.splice(bands.indexOf(header), 1);
    if (!footer.controls.length) bands.splice(bands.indexOf(footer), 1);
  }

  const width = lengthOf(pageEl, 'PageWidth', 850);
  const height = lengthOf(pageEl, 'PageHeight', 1100);
  const margins: Page['margins'] = [
    lengthOf(pageEl, 'LeftMargin', 100),
    lengthOf(pageEl, 'RightMargin', 100),
    lengthOf(pageEl, 'TopMargin', 100),
    lengthOf(pageEl, 'BottomMargin', 100),
  ];
  // No PaperKind: the paper repair names it from the size (repxPaper.ts).
  const repx = writeRepx(reportName(file), { width, height, margins, landscape: width > height }, bands, state.next);
  return { repx, unconverted: state.unconverted, dropped: state.dropped };
}

/* ------------------------------------------------------------- the way in */

/** Whether a file is another tool's report this module opens. */
export function isForeignReport(name: string): boolean {
  return /\.(rdlc?|frx)$/i.test(name);
}

/**
 * Another tool's report as a REPX, with what to tell the user, or null when
 * it could not be read as one: the caller sends its text to the AI instead.
 */
export function importForeign(name: string, xml: string): { repx: string; notices: string[] } | null {
  if (/\.frx$/i.test(name)) {
    const made = frxToRepx(xml, reportName(name));
    // The paper is named by the repair from the size, as for an SSRS file.
    return 'repx' in made ? { repx: made.repx.replace(' PaperKind="Custom"', ''), notices: [] } : null;
  }
  const made = rdlToRepx(xml, name);
  if ('skipped' in made) return null;
  const notices: string[] = [];
  if (made.unconverted) {
    notices.push(
      `"${name}": ${made.unconverted === 1 ? 'one formula prints' : `${made.unconverted} formulas print`} as written, because DevExpress has no direct equivalent; check ${made.unconverted === 1 ? 'it' : 'them'} in the report.`,
    );
  }
  if (made.dropped) {
    notices.push(`"${name}": ${made.dropped === 1 ? 'a chart, matrix, map or subreport was' : `${made.dropped} charts, matrices, maps or subreports were`} left out; ask for ${made.dropped === 1 ? 'it' : 'them'} to be added.`);
  }
  return { repx: made.repx, notices };
}
