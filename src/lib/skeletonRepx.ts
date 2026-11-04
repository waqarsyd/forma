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
 *   report and the page footer's over the page.
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
import { pointsToUnits } from './reportGeometry';
import type { DetectedLayout } from './ocrLayout';
import type { BandKind } from './reportPreview';
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
    if (recorded || !(HEADERS.includes(b.kind) || b.kind === 'Detail')) return null;
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

/**
 * The report a skeleton describes, its words from `texts` where they were read.
 * `title` names the report when no title was read. `readBy` names what read
 * the layout, for the spec: the vision model unless said otherwise.
 */
export function skeletonToDesign(k: ReportSkeleton, options: { texts?: readonly PageText[]; title?: string; readBy?: string } = {}): SkeletonDesign {
  const texts = options.texts ?? [];
  const places = placesOf(k);

  // The words of each title and caption, read where the page printed them.
  const words = new Map<string, string>();
  let read = 0;
  let placeholders = 0;
  for (const p of places) {
    if (p.role !== 'title' && p.role !== 'caption') continue;
    const found = p.box ? textIn(texts, p.box) : '';
    if (found) read++;
    else placeholders++;
    const kind = k.bands[p.band].kind;
    words.set(key(p), found || (p.role === 'title' ? options.title?.trim() || 'Report' : FOOTERS.includes(kind) ? 'Total' : 'Caption'));
  }
  const title = places.filter((p) => p.role === 'title').map((p) => words.get(key(p))!)[0] ?? options.title?.trim() ?? 'Report';

  // Each value's field, from the caption over its column in a header band.
  const captions = places.filter((p) => p.role === 'caption' && HEADERS.includes(k.bands[p.band].kind));
  const fields: string[] = [];
  const fieldOf = new Map<string, string>();
  const unique = (base: string) => {
    let name = base || `Field${fields.length + 1}`;
    for (let i = 2; fields.includes(name); i++) name = `${base || 'Field'}${i}`;
    fields.push(name);
    return name;
  };
  const values = places.filter((p) => p.role === 'value');
  for (const v of values) {
    const above = captions
      .filter((c) => c.box === null || v.box === null || c.box.y < v.box.y)
      .map((c) => ({ c, o: overlap(c, v) }))
      .filter((x) => x.o > 0)
      .sort((a, b) => b.o - a.o)[0];
    fieldOf.set(key(v), unique(above ? fieldFromCaption(words.get(key(above.c)) ?? '') : ''));
  }
  // A total sums the value in its column; one with none above it gets a field of its own.
  for (const t of places.filter((p) => p.role === 'total')) {
    const under = values
      .map((v) => ({ v, o: overlap(v, t) }))
      .filter((x) => x.o > 0)
      .sort((a, b) => b.o - a.o)[0];
    fieldOf.set(key(t), under ? fieldOf.get(key(under.v))! : unique(''));
  }

  let ref = 0;
  const next = () => ++ref;
  const binding = (expression: string) =>
    `<ExpressionBindings><Item1 Ref="${next()}" EventName="BeforePrint" PropertyName="Text" Expression="${attr(expression)}" /></ExpressionBindings>`;
  const content = (p: Pick<Place, 'band' | 'control' | 'row' | 'cell'>, role: SkeletonRole, kind: BandKind) => {
    const field = fieldOf.get(key(p));
    if (role === 'value') return { text: undefined, inner: binding(`[${field}]`), shown: `[${field}]` };
    if (role === 'total')
      return { text: undefined, inner: `<Summary Ref="${next()}" Running="${SCOPE[kind] ?? 'Report'}" />${binding(`sumSum([${field}])`)}`, shown: `sum [${field}]` };
    const text = words.get(key(p)) ?? '';
    return { text, inner: '', shown: text };
  };

  const bandsXml: { kind: BandKind; xml: string }[] = [];
  const sections: ReportSection[] = [];
  const unitSize = (f: SkeletonFont | null) => (f ? Math.round(pointsToUnits(f.size, 'HundredthsOfAnInch') * 100) / 100 : undefined);
  let groupCount = 0;

  k.bands.forEach((b, bi) => {
    const type = BAND_TYPE[b.kind];
    if (!type) return;
    const controls: string[] = [];
    const elements: ReportElement[] = [];
    b.controls.forEach((c, ci) => {
      const item = `Item${controls.length + 1}`;
      const at = ` LocationFloat="${n(c.x)},${n(c.y)}" SizeF="${n(c.w)},${n(c.h)}"`;
      const look = `${fontAttr(c.font)}${bordersAttr(c.borders)}`;
      const name = `${c.kind}${bi + 1}_${ci + 1}`;
      const flags = { borderTop: !!(c.borders & 1), borderRight: !!(c.borders & 2), borderBottom: !!(c.borders & 4), borderLeft: !!(c.borders & 8) };
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
                  `${got.text !== undefined ? ` Text="${attr(got.text)}"` : ''}${fontAttr(cell.font)} TextAlignment="${ALIGN[cell.align]}" Padding="2,2,0,0,100">${got.inner}</Item${k2 + 1}>`,
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
          const got = c.role === 'decoration' ? { text: '', inner: '', shown: '' } : content(self, c.role, b.kind);
          const control = c.kind === 'checkbox' ? 'XRCheckBox' : 'XRLabel';
          const multiline = c.kind === 'richText' ? ' Multiline="true" WordWrap="true"' : '';
          const text = got.text !== undefined && got.text !== '' ? ` Text="${attr(got.text)}"` : '';
          controls.push(
            `<${item} Ref="${next()}" ControlType="${control}" Name="${name}"${text} TextAlignment="${ALIGN[c.align]}"${multiline}${at}${look} Padding="2,2,0,0,100">${got.inner}</${item}>`,
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
          controls.push(`<${item} Ref="${next()}" ControlType="XRPanel" Name="${name}"${at}${bordersAttr(c.borders)} />`);
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
    if (b.kind === 'GroupHeader' && b.groupFields > 0) {
      const own = places.filter((p) => p.band === bi && p.role === 'value').map((p) => fieldOf.get(key(p))!);
      const names = Array.from({ length: b.groupFields }, (_, i) => own[i] ?? `Group${++groupCount}`);
      groupXml = `<GroupFields>${names.map((f, i) => `<Item${i + 1} Ref="${next()}" FieldName="${attr(f)}" />`).join('')}</GroupFields>`;
    }
    const height = b.kind === 'TopMargin' ? k.margins.top : b.kind === 'BottomMargin' ? k.margins.bottom : b.height;
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
  const m = k.margins;
  const xml =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    `<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a"` +
    ` Name="${attr(name)}" ReportUnit="HundredthsOfAnInch" Margins="${n(m.left)}, ${n(m.right)}, ${n(m.top)}, ${n(m.bottom)}"` +
    ` PageWidth="${n(k.width)}" PageHeight="${n(k.height)}" Version="20.1" Font="Arial, 9pt"><Bands>${bandItems.join('')}</Bands></XtraReportsLayoutSerializer>`;
  let repx = xml;
  for (const pass of [ensureUniqueRefs, repairDpi, repairPaper]) {
    const r = pass(repx);
    if (r.applied) repx = r.xml;
  }

  const controlCount = k.bands.reduce((s, b) => s + b.controls.length, 0);
  const markdown = [
    `# ${title}`,
    '',
    `Read from the picture by ${options.readBy ?? "Forma's vision model"}: ${k.paper}${k.landscape ? ' landscape' : ''}, ${k.bands.length} bands, ${controlCount} controls.`,
    '',
    texts.length
      ? `${read} of ${read + placeholders} titles and captions took their words from the page's text; ${placeholders ? `${placeholders} kept a placeholder to replace.` : 'none kept a placeholder.'}`
      : `No text was read from the page, so its ${placeholders} titles and captions are placeholders to replace.`,
    '',
    fields.length ? '| Field | Printed as |\n| --- | --- |\n' + fields.map((f) => `| \`[${f}]\` | a value |`).join('\n') : 'No field is bound.',
    '',
    options.readBy
      ? 'Bind real data in the Data tab. The bands and roles are a reading of the picture; check them in the Preview.'
      : 'Bind real data in the Data tab. The positions are the model\'s reading of the picture; check them in the Preview.',
  ].join('\n');

  return { title, repx, layout: { title, pageWidth: k.width, sections }, markdown, fields, read, placeholders };
}
