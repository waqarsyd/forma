/**
 * The report as an Excel workbook, the way DevExpress 20.1 exports one.
 *
 * Read out of the .xlsx files DevExpress exported for the parity cases on
 * 2026-10-30 (row 19 of `docs/proposals/devexpress-parity.md`), and compared
 * cell by cell with what this writes:
 *
 * - **One sheet, laid out as one continuous page**, as CSV is: page header and
 *   footer once, nothing broken (see `layoutContinuous`).
 * - **The grid is the layout.** A column boundary at every control's left and
 *   right edge, a row boundary at every top and bottom, each sized from the
 *   positions rounded to whole pixels -- which is why DevExpress's spacer rows
 *   alternate 3.75pt and 3pt -- and a column's width given in Excel's unit,
 *   seven pixels. A control covering several cells is a merged range: c05's
 *   99 lines needed 373 merges.
 * - **Values stay values.** A number is a number and a date an Excel serial,
 *   the format string converted: `{0:c2}` becomes `[$$-0409]#,##0.00` in all
 *   four sections, negatives bracketed; a literal prefix becomes a quoted
 *   prefix in each section, so `Region: {0}` over text is `"Region: "@`;
 *   `{0:dd MMM yyyy}` becomes `dd\ MMM\ yyyy`. A bound string is text-formatted
 *   (`@`), a literal label General.
 * - Each cell has its control's font, colour, fill and alignment, and a link
 *   stays a link.
 */
import { buildZip } from './zip';
import { NetDecimal } from './netDecimal';
import type { Value } from './criteria';
import { unitsPerInch } from './reportGeometry';
import { layoutContinuous, placedControls } from './csvExport';
import { cssColor, fontDecoration, pageInfoText, type Appearance, type PaginateOptions, type PreviewControl, type ReportStructure } from './reportPreview';

/** Controls that print no text of their own make no cell. */
const TEXTLESS = new Set(['XRLine', 'XRShape', 'XRPictureBox', 'XRBarCode', 'XRChart', 'XRCrossTab', 'XRGauge', 'XRSparkline', 'XRPanel', 'XRRichText', 'XRSubreport']);

interface Item {
  left: number;
  top: number;
  right: number;
  bottom: number;
  text: string;
  value: Value | null | undefined;
  format: string | null;
  font: { name: string; size: number; bold: boolean; italic: boolean; underline: boolean; color: string };
  fill: string | null;
  h: 'left' | 'center' | 'right';
  v: 'top' | 'center' | 'bottom';
  url: string | null;
  /** A page-info control, which DevExpress wrote as text. */
  pageNumber?: boolean;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `#RRGGBB` or `rgb(r, g, b)` as Excel's `FFRRGGBB`. */
function argb(css: string | undefined | null, fallback: string): string {
  if (!css) return fallback;
  const hex = /^#([0-9a-f]{6})$/i.exec(css);
  if (hex) return `FF${hex[1].toUpperCase()}`;
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(css);
  if (rgb) return 'FF' + [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  return fallback;
}

function fontOf(c: { fontFamily: string | null; fontSize: number | null; bold: boolean; italic: boolean }, look: Appearance) {
  return {
    name: c.fontFamily ?? 'Times New Roman',
    // DevExpress wrote the default 9.75pt as 9: whole points only.
    size: Math.trunc(c.fontSize ?? 9.75),
    bold: c.bold,
    italic: c.italic,
    underline: (fontDecoration(look.Font) ?? '').includes('underline'),
    color: argb(cssColor(look.ForeColor), 'FF000000'),
  };
}

const horizontal = (a: string): Item['h'] => (a === 'center' ? 'center' : a === 'right' ? 'right' : 'left');
const vertical = (a: string): Item['v'] => (a === 'middle' ? 'center' : a === 'bottom' ? 'bottom' : 'top');

function itemsOf(structure: ReportStructure, recordCount: number, options: PaginateOptions): Item[] {
  const report = layoutContinuous(structure, recordCount, options);
  const out: Item[] = [];
  for (const { page, bandLeft, bandTop, pc } of placedControls(report)) {
    const c: PreviewControl = pc.control;
    if (TEXTLESS.has(c.type)) continue;
    const left = bandLeft + c.x + c.offsetX;
    const top = bandTop + pc.y;
    if (c.type === 'XRTable') {
      const heights = pc.rowHeights ?? c.rows.map(() => c.height / Math.max(1, c.rows.length));
      let y = top;
      heights.forEach((h, r) => {
        const row = c.rows[pc.rowStart + r];
        if (!row) return;
        const total = row.cells.reduce((s, cell) => s + cell.weight, 0) || 1;
        let x = left;
        row.cells.forEach((cell, i) => {
          const w = (c.width * cell.weight) / total;
          out.push({
            left: x, top: y, right: x + w, bottom: y + h,
            text: pc.cellTexts?.[pc.rowStart + r]?.[i] ?? cell.text,
            value: pc.cellValues?.[pc.rowStart + r]?.[i],
            format: cell.data.format,
            font: fontOf(cell, cell.appearance),
            fill: cssColor(cell.appearance.BackColor) ?? null,
            h: horizontal(cell.align), v: vertical(cell.vAlign), url: null,
          });
          x += w;
        });
        y += h;
      });
      continue;
    }
    out.push({
      left, top, right: left + c.width, bottom: top + pc.height,
      text: c.pageInfo ? pageInfoText(c.pageInfo, page.number, report.pages.length) : pc.text ?? c.text,
      value: c.pageInfo ? undefined : pc.value,
      format: c.data.format,
      font: fontOf(c, c.appearance),
      fill: cssColor(c.appearance.BackColor) ?? null,
      h: horizontal(c.align), v: vertical(c.vAlign), url: pc.url ?? null,
      pageNumber: !!c.pageInfo,
    });
  }
  return out;
}

// ------------------------------------------------------------- formats

const BUILTIN: Record<string, number> = { General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10, '@': 49 };

/** `prefix{0:spec}suffix` split into its parts; null when there is no `{0...}`. */
function composite(format: string): { prefix: string; spec: string; suffix: string } | null {
  const m = /^([\s\S]*?)\{0(?:,[-\d]+)?(?::([^}]*))?\}([\s\S]*)$/.exec(format);
  if (!m) return null;
  const literal = (s: string) => s.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
  return { prefix: literal(m[1]), spec: m[2] ?? '', suffix: literal(m[3]) };
}

const quoted = (s: string) => (s ? `"${s.replace(/"/g, '\\"')}"` : '');
const decimals = (digits: string, fallback: number) => {
  const d = digits === '' ? fallback : Number(digits);
  return d > 0 ? `.${'0'.repeat(d)}` : '';
};

/** A .NET date pattern as Excel's: the same tokens, every literal character escaped. */
function dateCode(spec: string): string {
  const standard: Record<string, string> = { d: 'm/d/yyyy', D: 'dddd, mmmm d, yyyy', g: 'm/d/yyyy h:mm AM/PM', G: 'm/d/yyyy h:mm:ss AM/PM', t: 'h:mm AM/PM', T: 'h:mm:ss AM/PM' };
  if (standard[spec]) return standard[spec];
  let out = '';
  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i];
    if (/[dMyHhmsf]/.test(ch)) out += ch;
    else if (ch === 't') { while (spec[i + 1] === 't') i++; out += 'AM/PM'; }
    else if (ch === "'" || ch === '"') { const end = spec.indexOf(ch, i + 1); out += quoted(spec.slice(i + 1, end === -1 ? undefined : end)); i = end === -1 ? spec.length : end; }
    else if (ch === '\\') { out += `\\${spec[i + 1] ?? ''}`; i++; }
    // Printed: yyyy-MM-dd kept its dashes bare (c09), dd MMM yyyy escaped its spaces (c05).
    else if ('-/:'.includes(ch)) out += ch;
    else out += `\\${ch}`;
  }
  return out;
}

/** A TextFormatString as an Excel number format code for a value of this kind. */
export function excelFormat(format: string | null, kind: 'number' | 'date' | 'text'): string {
  if (!format) return kind === 'text' ? '@' : 'General';
  const parts = composite(format);
  if (!parts) return kind === 'text' ? '@' : 'General';
  const p = quoted(parts.prefix);
  const s = quoted(parts.suffix);
  const wrap = (body: string) => `${p}${body}${s}`;
  if (kind === 'text') return wrap('@');
  const spec = parts.spec;
  if (kind === 'date') return wrap(dateCode(spec || 'G'));
  // Printed: "{0} orders" over a count was `@" orders"`, text as the body.
  if (!spec) return p || s ? wrap('@') : 'General';
  const std = /^([cCnNfFpPdDeE])(\d{0,2})$/.exec(spec);
  if (std) {
    const letter = std[1].toLowerCase();
    if (letter === 'c') {
      const body = `[$$-0409]#,##0${decimals(std[2], 2)}`;
      return `${wrap(body)};${p}(${body})${s};${wrap(body)};${wrap('@')}`;
    }
    if (letter === 'n') return wrap(`#,##0${decimals(std[2], 2)}`);
    if (letter === 'f') return wrap(`0${decimals(std[2], 2)}`);
    if (letter === 'p') return wrap(`0${decimals(std[2], 2)}%`);
    if (letter === 'd') return wrap('0'.repeat(Math.max(1, Number(std[2] || 1))));
    return wrap(`0${decimals(std[2], 6)}E+00`);
  }
  // A custom numeric pattern carries over section by section.
  return spec.split(';').map((section) => wrap(section)).join(';');
}

/** A JavaScript date as an Excel serial: days since 1899-12-30, local time. */
const serial = (d: Date) =>
  (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - Date.UTC(1899, 11, 30)) / 86_400_000;

// ---------------------------------------------------------------- writer

const columnName = (n: number) => {
  let s = '';
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};

/** Lay the report out on one continuous page and write it as an .xlsx workbook. */
export function reportToXlsx(structure: ReportStructure, recordCount: number, options: PaginateOptions = {}): Uint8Array {
  const items = itemsOf(structure, recordCount, options);
  const perInch = unitsPerInch(structure.unit);
  const px = (u: number) => Math.round((u / perInch) * 96);
  const key = (n: number) => Math.round(n * 100) / 100;
  const xs = [...new Set(items.flatMap((i) => [key(i.left), key(i.right)]))].sort((a, b) => a - b);
  const ys = [...new Set(items.flatMap((i) => [key(i.top), key(i.bottom)]))].sort((a, b) => a - b);

  // Styles, deduplicated.
  const numFmts: string[] = [];
  const fmtId = (code: string) => {
    if (code in BUILTIN) return BUILTIN[code];
    let i = numFmts.indexOf(code);
    if (i < 0) i = numFmts.push(code) - 1;
    return 164 + i;
  };
  const fonts = ['<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const indexOf = (list: string[], entry: string) => {
    const i = list.indexOf(entry);
    return i >= 0 ? i : list.push(entry) - 1;
  };
  const styleOf = (item: Item, code: string) => {
    const f = item.font;
    const font = `<font>${f.bold ? '<b/>' : ''}${f.italic ? '<i/>' : ''}${f.underline ? '<u/>' : ''}<sz val="${f.size}"/><color rgb="${f.color}"/><name val="${xml(f.name)}"/></font>`;
    const fill = item.fill ? `<fill><patternFill patternType="solid"><fgColor rgb="${argb(item.fill, 'FFFFFFFF')}"/></patternFill></fill>` : null;
    const xf =
      `<xf numFmtId="${fmtId(code)}" fontId="${indexOf(fonts, font)}" fillId="${fill ? indexOf(fills, fill) : 0}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"${fill ? ' applyFill="1"' : ''} applyAlignment="1">` +
      // Bottom is Excel's default, and DevExpress left it unwritten (c01).
      `<alignment horizontal="${item.h}"${item.v === 'bottom' ? '' : ` vertical="${item.v}"`} wrapText="1"/></xf>`;
    return indexOf(xfs, xf);
  };

  const strings: string[] = [];
  const stringId = (s: string) => indexOf(strings, s);
  const rows: Map<number, string[]> = new Map();
  const merges: string[] = [];
  const links: { ref: string; url: string }[] = [];

  for (const item of items) {
    const r0 = ys.indexOf(key(item.top));
    const r1 = ys.indexOf(key(item.bottom)) - 1;
    const c0 = xs.indexOf(key(item.left));
    const c1 = xs.indexOf(key(item.right)) - 1;
    if (r1 < r0 || c1 < c0) continue;
    const ref = `${columnName(c0)}${r0 + 1}`;
    if (r1 > r0 || c1 > c0) merges.push(`${ref}:${columnName(c1)}${r1 + 1}`);
    const value = item.value;
    let cell: string;
    if (typeof value === 'bigint' || typeof value === 'number' || value instanceof NetDecimal) {
      const n = value instanceof NetDecimal ? value.toNumber() : Number(value);
      cell = `<c r="${ref}" s="${styleOf(item, excelFormat(item.format, 'number'))}"><v>${n}</v></c>`;
    } else if (value instanceof Date) {
      cell = `<c r="${ref}" s="${styleOf(item, excelFormat(item.format, 'date'))}"><v>${serial(value)}</v></c>`;
    } else if (typeof value === 'string') {
      cell = value === '' && !item.format
        ? `<c r="${ref}" s="${styleOf(item, '@')}"/>`
        : `<c r="${ref}" t="s" s="${styleOf(item, excelFormat(item.format, 'text'))}"><v>${stringId(value)}</v></c>`;
    } else if (value === undefined && item.text) {
      // A literal label, or no test data: the printed text, General; a page number is text.
      cell = `<c r="${ref}" t="s" s="${styleOf(item, item.pageNumber ? '@' : 'General')}"><v>${stringId(item.text)}</v></c>`;
    } else {
      cell = `<c r="${ref}" s="${styleOf(item, 'General')}"/>`;
    }
    if (!rows.has(r0)) rows.set(r0, []);
    rows.get(r0)!.push(`${c0.toString().padStart(5, '0')}${cell}`);
    if (item.url) links.push({ ref, url: item.url });
  }

  const cols = xs.slice(0, -1).map((x, i) => {
    const width = Math.round(((px(xs[i + 1]) - px(x)) / 7) * 100) / 100;
    return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
  });
  const sheetRows = ys.slice(0, -1).map((y, i) => {
    const height = (px(ys[i + 1]) - px(y)) * 0.75;
    const cells = (rows.get(i) ?? []).sort().map((c) => c.slice(5)).join('');
    return cells ? `<row r="${i + 1}" ht="${height}" customHeight="1">${cells}</row>` : `<row r="${i + 1}" ht="${height}" customHeight="1"/>`;
  });
  const sheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>' +
    (cols.length ? `<cols>${cols.join('')}</cols>` : '') +
    `<sheetData>${sheetRows.join('')}</sheetData>` +
    (merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '') +
    (links.length ? `<hyperlinks>${links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rId${i + 1}"/>`).join('')}</hyperlinks>` : '') +
    '</worksheet>';
  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    (numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((code, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xml(code)}"/>`).join('')}</numFmts>` : '') +
    `<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
    `<fills count="${fills.length}">${fills.join('')}</fills>` +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
  const shared =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((s) => `<si><t xml:space="preserve">${xml(s)}</t></si>`).join('') +
    '</sst>';
  const rel = (id: string, type: string, target: string, external = false) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${xml(target)}"${external ? ' TargetMode="External"' : ''}/>`;
  const rels = (list: string[]) =>
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + list.join('') + '</Relationships>';

  const entries = [
    {
      name: '[Content_Types].xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
    },
    { name: '_rels/.rels', content: rels([rel('rId1', 'officeDocument', 'xl/workbook.xml')]) },
    {
      name: 'xl/workbook.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Sheet" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    { name: 'xl/_rels/workbook.xml.rels', content: rels([rel('rId1', 'worksheet', 'worksheets/sheet1.xml'), rel('rId2', 'styles', 'styles.xml'), rel('rId3', 'sharedStrings', 'sharedStrings.xml')]) },
    { name: 'xl/worksheets/sheet1.xml', content: sheet },
    { name: 'xl/styles.xml', content: styles },
    { name: 'xl/sharedStrings.xml', content: shared },
    ...(links.length ? [{ name: 'xl/worksheets/_rels/sheet1.xml.rels', content: rels(links.map((l, i) => rel(`rId${i + 1}`, 'hyperlink', l.url, true))) }] : []),
  ];
  const zip = buildZip(entries, new Date(), { keepPaths: true });
  if (!zip.bytes) throw new Error(`The workbook could not be written: ${zip.reason}.`);
  return zip.bytes;
}
