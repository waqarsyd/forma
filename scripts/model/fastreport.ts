/**
 * FastReport's demo reports as Forma skeletons (2026-11-10, the owner's AI
 * accuracy programme, batch AE, item 16), so the box reader learns from report
 * layouts beyond one company's.
 *
 *   npx tsx scripts/model/fastreport.ts --frx <dir> --out <dir>
 *
 * The reports are FastReport's own demos (github.com/FastReports/FastReport,
 * Demos/Reports, MIT; the licence and the commit are kept beside them). Each
 * page of a report is written as a minimal DevExpress REPX and read by
 * Forma's own parser and `skeletonOf`, so a FastReport text gets its role
 * exactly as a company report's does: a field with a running total is a
 * total, a field a value, words a caption, page numbers page information. The
 * skeletons go to `<out>/skeletons/<n>.json` as `npm run model:train` writes
 * them, for `npm run model:dataset` to pack beside the company's sets. A
 * skeleton keeps no words, so nothing a demo says is learned either.
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
 *   millimetres; a skeleton's are hundredths of an inch.
 * A report whose data band holds another (master and detail) is left out and
 * counted, rather than mapped to a guess.
 *
 * The folders must be outside the repository. Prints counts only.
 *
 * Pure ASCII, as every script here.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseReportStructure } from '../../src/lib/reportPreview';
import { skeletonOf } from '../../src/lib/reportSkeleton';

const argv = process.argv.slice(2);
const valueOf = (flag: string) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : undefined);
const frxDir = valueOf('--frx');
const outDir = valueOf('--out');
if (!frxDir || !outDir) {
  console.error('--frx and --out are required. See the doc comment of scripts/model/fastreport.ts.');
  process.exit(2);
}
for (const p of [frxDir, outDir]) {
  const rel = relative(resolve('.'), resolve(p));
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    console.error('--frx and --out must be outside the repository.');
    process.exit(2);
  }
}

// ------------------------------------------------------------- a small XML reader

interface El {
  name: string;
  attrs: Record<string, string>;
  children: El[];
}

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()];
  });

/** Elements and attributes only: text nodes, CDATA, comments and declarations are skipped. */
export function parseXml(xml: string): El | null {
  const src = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  const tag = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const attr = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const stack: El[] = [];
  let root: El | null = null;
  for (const m of src.matchAll(tag)) {
    const [, closing, name, attrText, selfClosing] = m;
    if (closing) {
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of attrText.matchAll(attr)) attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
    const el: El = { name, attrs, children: [] };
    if (stack.length) stack[stack.length - 1].children.push(el);
    else root ??= el;
    if (!selfClosing) stack.push(el);
  }
  return root;
}

// ------------------------------------------------------------- the mapping

const PX = 100 / 96;
const MM = 100 / 25.4;
const num = (v: string | undefined, d = 0) => (v === undefined || v === '' ? d : Number(v.replace(',', '.')) || d);
const r2 = (v: number) => Math.round(v * 100) / 100;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r?\n/g, '&#xD;&#xA;');

type Kind = 'ReportHeader' | 'PageHeader' | 'GroupHeader' | 'Detail' | 'GroupFooter' | 'ReportFooter' | 'PageFooter';

interface Band {
  kind: Kind;
  level: number;
  field: string | null;
  height: number;
  controls: string[];
}

/** A text's binding, as FastReport writes it: page information, a total, a field, or words. */
function textControl(text: string, totals: Set<string>): { type: 'XRPageInfo' | 'XRLabel'; attrs: string; inner: string } {
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

const ALIGN: Record<string, string> = { Left: 'Left', Center: 'Center', Right: 'Right', Justify: 'Justify' };
const VALIGN: Record<string, string> = { Top: 'Top', Center: 'Middle', Bottom: 'Bottom' };

function looks(a: Record<string, string>): string {
  const parts: string[] = [];
  if (a.Font) parts.push(` Font="${esc(a.Font)}"`);
  const h = ALIGN[a.HorzAlign ?? 'Left'] ?? 'Left';
  const v = VALIGN[a.VertAlign ?? 'Top'] ?? 'Top';
  if (a.HorzAlign || a.VertAlign) parts.push(` TextAlignment="${v}${h}"`);
  const lines = a['Border.Lines'];
  if (lines && lines !== 'None') parts.push(` Borders="${esc(lines === 'All' ? 'All' : lines)}"`);
  return parts.join('');
}

const OBJECTS: Record<string, string> = {
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

/** The controls of one FastReport band element, its child bands' stacked below. */
function controlsOf(band: El, totals: Set<string>, kind: Kind, dy: number, out: string[], next: () => number): number {
  let height = num(band.attrs.Height) * PX;
  const running = kind === 'GroupFooter' ? 'Group' : 'Report';
  const place = (a: Record<string, string>, ox = 0, oy = 0) =>
    ` LocationFloat="${r2(num(a.Left) * PX + ox)}, ${r2(num(a.Top) * PX + oy + dy)}" SizeF="${r2(Math.max(1, num(a.Width) * PX))}, ${r2(Math.max(1, num(a.Height) * PX))}"`;
  const walk = (el: El, ox: number, oy: number) => {
    for (const c of el.children) {
      if (c.name === 'TextObject' || c.name === 'CellularTextObject' || c.name === 'HtmlObject') {
        const t = textControl(c.attrs.Text ?? '', totals);
        const ref = next();
        out.push(`<Item{i} Ref="${ref}" ControlType="${t.type}" Name="c${ref}"${t.attrs}${place(c.attrs, ox, oy)}${looks(c.attrs)}>${t.inner.replace(/\{ref\}/g, () => String(next())).replace('{running}', running)}</Item{i}>`);
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
            const t = textControl(cell.attrs.Text ?? '', totals);
            const ref = next();
            return `<Item${ci + 1} Ref="${ref}" ControlType="XRTableCell" Name="t${ref}"${t.type === 'XRLabel' ? t.attrs : ''} Weight="${r2(weight)}"${looks(cell.attrs)}>${t.type === 'XRLabel' ? t.inner.replace(/\{ref\}/g, () => String(next())).replace('{running}', running) : ''}</Item${ci + 1}>`;
          });
          return `<Item${ri + 1} Ref="${next()}" ControlType="XRTableRow" Name="r${tableRef}_${ri}" Weight="${r2(num(row.attrs.Height, 18.9))}"><Cells>${cells.join('')}</Cells></Item${ri + 1}>`;
        });
        out.push(`<Item{i} Ref="${tableRef}" ControlType="XRTable" Name="t${tableRef}"${place(c.attrs, ox, oy)}><Rows>${rowXml.join('')}</Rows></Item{i}>`);
      } else if (OBJECTS[c.name]) {
        const ref = next();
        out.push(`<Item{i} Ref="${ref}" ControlType="${OBJECTS[c.name]}" Name="o${ref}"${place(c.attrs, ox, oy)} />`);
      } else if (c.name === 'ContainerObject') {
        walk(c, ox + num(c.attrs.Left) * PX, oy + num(c.attrs.Top) * PX);
      }
    }
  };
  walk(band, 0, 0);
  for (const child of band.children.filter((k) => k.name === 'ChildBand')) {
    height += controlsOf(child, totals, kind, dy + height, out, next);
  }
  return height;
}

/** One FastReport page as a DevExpress REPX, or why it was left out. */
export function pageToRepx(page: El, totals: Set<string>, name: string): { repx: string } | { skipped: string } {
  let ref = 1;
  const next = () => ++ref;
  const bands: Band[] = [];
  const add = (kind: Kind, el: El, level = 0, field: string | null = null) => {
    let b = bands.find((x) => x.kind === kind && x.level === level && kind !== 'GroupHeader' && kind !== 'GroupFooter');
    if (!b) bands.push((b = { kind, level, field, height: 0, controls: [] }));
    b.height += controlsOf(el, totals, kind, b.height, b.controls, next);
  };
  let nested = false;
  let depth = 0;
  const walkBands = (el: El, inData: boolean) => {
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
  const depthOf = (b: Band) => bands.filter((x) => x.kind === 'GroupHeader').length - 1 - b.level;
  const order: Kind[] = ['ReportHeader', 'PageHeader', 'GroupHeader', 'Detail', 'GroupFooter', 'ReportFooter', 'PageFooter'];
  const sorted = [...bands].sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind) || (x.kind === 'GroupFooter' ? y.level - x.level : x.level - y.level));
  let item = 0;
  const xmlBands = [
    `<Item${++item} Ref="${next()}" ControlType="TopMarginBand" Name="TopMargin" HeightF="${m[2]}" />`,
    ...sorted.map((b, bi) => {
      const controls = b.controls.map((c, ci) => c.replace(/\{i\}/g, String(ci + 1)));
      const group = b.kind === 'GroupHeader' && b.field ? `<GroupFields><Item1 Ref="${next()}" FieldName="${esc(b.field)}" /></GroupFields>` : '';
      const level = b.kind === 'GroupHeader' || b.kind === 'GroupFooter' ? ` Level="${depthOf(b)}"` : '';
      return `<Item${++item} Ref="${next()}" ControlType="${b.kind}Band" Name="${b.kind}${bi + 1}" HeightF="${r2(Math.max(1, b.height))}"${level}>${group}${controls.length ? `<Controls>${controls.join('')}</Controls>` : ''}</Item${item}>`;
    }),
    `<Item${++item} Ref="${next()}" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="${m[3]}" />`,
  ];
  const repx =
    `<?xml version="1.0" encoding="utf-8"?>\n<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="${esc(name)}" ReportUnit="HundredthsOfAnInch" Margins="${m[0]}, ${m[1]}, ${m[2]}, ${m[3]}" PaperKind="Custom" PageWidth="${r2(width)}" PageHeight="${r2(height)}"${a.Landscape === 'true' ? ' Landscape="true"' : ''} Version="20.1">` +
    `<Bands>${xmlBands.join('')}</Bands></XtraReportsLayoutSerializer>`;
  return { repx };
}

// ------------------------------------------------------------- the run

const files = readdirSync(frxDir).filter((f) => f.toLowerCase().endsWith('.frx')).sort();
mkdirSync(join(outDir, 'skeletons'), { recursive: true });
mkdirSync(join(outDir, 'repx'), { recursive: true });
const skipped = new Map<string, number>();
const roles = new Map<string, number>();
let written = 0;
let unreadable = 0;
for (const file of files) {
  const root = parseXml(readFileSync(join(frxDir, file), 'utf8'));
  if (!root || root.name !== 'Report') {
    unreadable++;
    continue;
  }
  const dictionary = root.children.find((c) => c.name === 'Dictionary');
  const totals = new Set((dictionary?.children ?? []).filter((c) => c.name === 'Total').map((c) => c.attrs.Name).filter(Boolean));
  const pages = root.children.filter((c) => c.name === 'ReportPage');
  for (const [pi, page] of pages.entries()) {
    const made = pageToRepx(page, totals, `fr${written + 1}`);
    if ('skipped' in made) {
      skipped.set(made.skipped, (skipped.get(made.skipped) ?? 0) + 1);
      continue;
    }
    const structure = parseReportStructure(made.repx);
    if (!structure.bands.length) {
      skipped.set('no band Forma could read', (skipped.get('no band Forma could read') ?? 0) + 1);
      continue;
    }
    const skeleton = skeletonOf(structure);
    for (const b of skeleton.bands) for (const c of b.controls) for (const role of [c.role, ...(c.rows ?? []).flat().map((x) => x.role)]) roles.set(role, (roles.get(role) ?? 0) + 1);
    written++;
    writeFileSync(join(outDir, 'skeletons', `${written}.json`), JSON.stringify({ category: null, skeleton }));
    writeFileSync(join(outDir, 'repx', `${written}.repx`), made.repx);
    void pi;
  }
}
console.log(`${files.length} reports, ${unreadable} unreadable; ${written} pages written as skeletons to ${join(outDir, 'skeletons')}`);
for (const [why, n] of skipped) console.log(`  left out: ${n} page(s), ${why}`);
console.log(`  roles: ${[...roles].map(([r, n]) => `${r} ${n}`).join(', ')}`);
