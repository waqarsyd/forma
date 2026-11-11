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
import { escapeXmlAttribute } from './xmlEscape';
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

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()];
  });

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
      if (top) top.text += cdata;
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

/** A band being built: controls are written with `{i}` where their item number goes. */
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
      const controls = b.controls.map((c, ci) => c.replace(/\{i\}/g, String(ci + 1)));
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

/** A text's binding, as FastReport writes it: page information, a total, a field, or words. */
function frxText(text: string, totals: Set<string>): { type: 'XRPageInfo' | 'XRLabel'; attrs: string; inner: string } {
  const refs = [...text.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
  const PAGE = /^(Page#?|PageN|TotalPages#?|PageNofM|Date|Time|Now)$/i;
  if (refs.length && refs.every((r) => PAGE.test(r))) return { type: 'XRPageInfo', attrs: '', inner: '' };
  const total = refs.find((r) => totals.has(r));
  if (total) {
    return {
      type: 'XRLabel',
      attrs: '',
      inner: `<ExpressionBindings><Item1 Ref="{ref}" EventName="BeforePrint" PropertyName="Text" Expression="sumSum([${esc(total)}])" /></ExpressionBindings><Summary Ref="{ref}" Running="{running}" />`,
    };
  }
  const field = refs.find((r) => !PAGE.test(r) && /^[A-Za-z_]/.test(r));
  if (field) {
    const name = field.split('.').pop()!.replace(/[^\w ]/g, '').trim() || 'Field';
    return { type: 'XRLabel', attrs: '', inner: `<ExpressionBindings><Item1 Ref="{ref}" EventName="BeforePrint" PropertyName="Text" Expression="[${esc(name)}]" /></ExpressionBindings>` };
  }
  return { type: 'XRLabel', attrs: ` Text="${esc(text)}"`, inner: '' };
}

const FRX_ALIGN: Record<string, string> = { Left: 'Left', Center: 'Center', Right: 'Right', Justify: 'Justify' };
const FRX_VALIGN: Record<string, string> = { Top: 'Top', Center: 'Middle', Bottom: 'Bottom' };

function frxLooks(a: Record<string, string>): string {
  const parts: string[] = [];
  if (a.Font) parts.push(` Font="${esc(a.Font)}"`);
  const h = FRX_ALIGN[a.HorzAlign ?? 'Left'] ?? 'Left';
  const v = FRX_VALIGN[a.VertAlign ?? 'Top'] ?? 'Top';
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
function frxControls(band: XmlEl, totals: Set<string>, kind: Kind, dy: number, out: string[], next: () => number): number {
  let height = num(band.attrs.Height) * PX;
  const running = kind === 'GroupFooter' ? 'Group' : 'Report';
  const place = (a: Record<string, string>, ox = 0, oy = 0) =>
    ` LocationFloat="${r2(num(a.Left) * PX + ox)}, ${r2(num(a.Top) * PX + oy + dy)}" SizeF="${r2(Math.max(1, num(a.Width) * PX))}, ${r2(Math.max(1, num(a.Height) * PX))}"`;
  const walk = (el: XmlEl, ox: number, oy: number) => {
    for (const c of el.children) {
      if (c.name === 'TextObject' || c.name === 'CellularTextObject' || c.name === 'HtmlObject') {
        const t = frxText(c.attrs.Text ?? '', totals);
        const ref = next();
        out.push(`<Item{i} Ref="${ref}" ControlType="${t.type}" Name="c${ref}"${t.attrs}${place(c.attrs, ox, oy)}${frxLooks(c.attrs)}>${t.inner.replace(/\{ref\}/g, () => String(next())).replace('{running}', running)}</Item{i}>`);
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
            return `<Item${ci + 1} Ref="${ref}" ControlType="XRTableCell" Name="t${ref}"${t.type === 'XRLabel' ? t.attrs : ''} Weight="${r2(weight)}"${frxLooks(cell.attrs)}>${t.type === 'XRLabel' ? t.inner.replace(/\{ref\}/g, () => String(next())).replace('{running}', running) : ''}</Item${ci + 1}>`;
          });
          return `<Item${ri + 1} Ref="${next()}" ControlType="XRTableRow" Name="r${tableRef}_${ri}" Weight="${r2(num(row.attrs.Height, 18.9))}"><Cells>${cells.join('')}</Cells></Item${ri + 1}>`;
        });
        out.push(`<Item{i} Ref="${tableRef}" ControlType="XRTable" Name="t${tableRef}"${place(c.attrs, ox, oy)}><Rows>${rowXml.join('')}</Rows></Item{i}>`);
      } else if (FRX_OBJECTS[c.name]) {
        const ref = next();
        out.push(`<Item{i} Ref="${ref}" ControlType="${FRX_OBJECTS[c.name]}" Name="o${ref}"${place(c.attrs, ox, oy)} />`);
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
export function frxPageToRepx(page: XmlEl, totals: Set<string>, name: string): { repx: string } | { skipped: string } {
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
  const dictionary = root.children.find((c) => c.name === 'Dictionary');
  const totals = new Set((dictionary?.children ?? []).filter((c) => c.name === 'Total').map((c) => c.attrs.Name).filter(Boolean));
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

/**
 * An SSRS value as DevExpress writes it. A value without a leading `=` is
 * text. One with is an expression, converted as the module comment says, or
 * `unconverted` when anything is left that DevExpress would not read.
 */
export function rdlValue(value: string): RdlValue {
  const v = value.trim();
  if (!v.startsWith('=')) return { text: value };
  const body = v.slice(1).trim();
  const page = /Globals!PageNumber/i.test(body);
  const total = /Globals!TotalPages/i.test(body);
  if (page && total) return { pageInfo: 'NumberOfTotal', format: 'Page {0} of {1}' };
  if (/^Globals!PageNumber$/i.test(body)) return { pageInfo: 'Number' };
  if (/^Globals!ExecutionTime$/i.test(body)) return { pageInfo: 'DateTime' };
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
  const h = ({ center: 'Center', right: 'Right', left: 'Left' } as Record<string, string>)[(textOf(child(paragraph, 'Style'), 'TextAlign') || textOf(boxStyle, 'TextAlign')).toLowerCase()] ?? 'Left';
  const v = ({ middle: 'Middle', bottom: 'Bottom' } as Record<string, string>)[textOf(boxStyle, 'VerticalAlign').toLowerCase()] ?? 'Top';
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
  /** Charts, maps, gauges and subreports, which are not converted. */
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
    return `<Item{i} Ref="${ref}" ControlType="${t.type}" Name="${name}"${t.attrs}${place}${rdlLooks(item)}>${t.inner}</Item{i}>`;
  }
  if (kind === 'Line') {
    // A line's height or width is 0 along it; DevExpress draws one inside its box.
    const vertical = Math.abs(lengthOf(item, 'Width')) < Math.abs(lengthOf(item, 'Height'));
    return `<Item{i} Ref="${ref}" ControlType="XRLine" Name="${name}"${vertical ? ' LineDirection="Vertical"' : ''} LocationFloat="${r2(x)}, ${r2(y)}" SizeF="${r2(vertical ? 2 : w)}, ${r2(vertical ? h : 2)}" />`;
  }
  if (kind === 'Image') return `<Item{i} Ref="${ref}" ControlType="XRPictureBox" Name="${name}"${place} />`;
  if (kind === 'Rectangle') {
    // A rectangle holds its items at positions inside it, as a panel does.
    const controls = itemsOf(child(item, 'ReportItems'), 0, 0, running, state).map((c, ci) => c.replace(/\{i\}/g, String(ci + 1)));
    return `<Item{i} Ref="${ref}" ControlType="XRPanel" Name="${name}"${place}${bordersOf(child(item, 'Style'))}>${controls.length ? `<Controls>${controls.join('')}</Controls>` : ''}</Item{i}>`;
  }
  if (kind === 'Tablix' || kind === 'Table' || kind === 'Matrix' || kind === 'List') {
    const grid = gridOf(item);
    return grid ? tableXml(grid.rows, grid.widths, x, y, item.attrs.Name || `t${ref}`, running, state) : null;
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
      // A cell is not a page-information control; it prints its text.
      const attrs = t.type === 'XRLabel' ? t.attrs : '';
      const cellName = esc(cell.box?.attrs.Name || `cell${ref}`);
      return `<Item${ci + 1} Ref="${ref}" ControlType="XRTableCell" Name="${cellName}"${attrs} Weight="${r2(weight)}"${cell.box ? rdlLooks(cell.box) : ''}>${t.type === 'XRLabel' ? t.inner : ''}</Item${ci + 1}>`;
    });
    return `<Item${ri + 1} Ref="${state.next()}" ControlType="XRTableRow" Name="${esc(name)}Row${ri + 1}" Weight="${r2(row.height)}"><Cells>${cells.join('')}</Cells></Item${ri + 1}>`;
  });
  return `<Item{i} Ref="${tableRef}" ControlType="XRTable" Name="${esc(name)}" LocationFloat="${r2(x)}, ${r2(y)}" SizeF="${r2(total)}, ${r2(height)}"><Rows>${rowXml.join('')}</Rows></Item{i}>`;
}

/** The kinds of report item that are a data region. */
const isGrid = (item: XmlEl) => ['Tablix', 'Table', 'Matrix', 'List'].includes(local(item));

/**
 * An SSRS report definition as a DevExpress REPX, with what the user should
 * know of it, or why it could not be read.
 */
export function rdlToRepx(xml: string, file: string): { repx: string; unconverted: number; dropped: number } | { skipped: string } {
  const root = parseXml(xml);
  if (!root || local(root) !== 'Report') return { skipped: 'not a report definition' };
  const section = child(child(root, 'ReportSections'), 'ReportSection');
  // 2008 and later: body and page under a section; 2005: on the report itself.
  const body = child(section ?? root, 'Body');
  if (!body) return { skipped: 'no body' };
  const pageEl = child(section, 'Page') ?? root;
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
  const region = items.filter(isGrid).sort((a, b) => lengthOf(a, 'Top') - lengthOf(b, 'Top'))[0];
  const grid = region ? gridOf(region) : null;
  if (!region || !grid) {
    // No data region: the body is the report header, and an empty Detail band beside it.
    put(band('ReportHeader'), itemsOf(child(body, 'ReportItems'), 0, 0, 'Report', state), lengthOf(body, 'Height', 100));
    band('Detail');
  } else {
    const top = lengthOf(region, 'Top');
    const bottom = top + grid.rows.reduce((a, r) => a + r.height, 0);
    const x = lengthOf(region, 'Left');
    const name = region.attrs.Name || 'table';
    const header = band('ReportHeader');
    const footer = band('ReportFooter');
    const footerRowsHeight = grid.rows.filter((r) => r.role === 'footer').reduce((a, r) => a + r.height, 0);
    for (const item of items) {
      if (item === region) continue;
      const itemTop = lengthOf(item, 'Top');
      const above = itemTop < top;
      // Below the table, an item keeps its distance from it, under the table's
      // total rows; one beside the table (its top inside it) goes straight
      // under them, never above the footer's top (the review of CP-08).
      const footerTop = footerRowsHeight + Math.max(0, itemTop - bottom);
      const control = rdlItem(item, 0, above ? 0 : footerTop - itemTop, 'Report', state);
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
    notices.push(`"${name}": ${made.dropped === 1 ? 'a chart, map or subreport was' : `${made.dropped} charts, maps or subreports were`} left out; ask for ${made.dropped === 1 ? 'it' : 'them'} to be added.`);
  }
  return { repx: made.repx, notices };
}
