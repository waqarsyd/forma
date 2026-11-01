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
import { unitsPerInch } from './reportGeometry';
import { layoutContinuous } from './csvExport';
import { argb, reportItems, type ExportItem } from './exportItems';
import { paginate, type PaginateOptions, type ReportStructure } from './reportPreview';

type Item = ExportItem;

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

/**
 * A report's `ExportOptions.Xlsx` (parity row 74, 2026-11-01), as DevExpress
 * 20.1 wrote and honoured them in s62a to s62h:
 *
 * - `ExportMode`: `SingleFile`, the default, one sheet laid out as one
 *   continuous page; `SingleFilePageByPage`, a sheet per printed page, each
 *   with its page header and footer and its own page number ("Page 1 of 2");
 *   `DifferentFiles`, the same pages each as a workbook of its own,
 *   `report1.xlsx`, `report2.xlsx` and so on.
 * - `SheetName`: the one sheet's name, "Sheet" by default; page by page,
 *   either way, the name and the page's number: "Sheet1", or "Sales1".
 * - `TextExportMode="Text"`: every cell the text it printed, formatted as
 *   text, where by default a number stays a number.
 * - `ShowGridLines="true"`: the sheet shows Excel's grid; by default it is
 *   turned off.
 */
export interface XlsxOptions {
  mode: 'SingleFile' | 'SingleFilePageByPage' | 'DifferentFiles';
  text: boolean;
  sheetName: string;
  gridLines: boolean;
}

export const DEFAULT_XLSX: XlsxOptions = { mode: 'SingleFile', text: false, sheetName: 'Sheet', gridLines: false };

/** The file's `<Xlsx>` export options, DevExpress's defaults where it writes none. */
export function xlsxOptionsOf(repx: string | null | undefined): XlsxOptions {
  const tag = /<Xlsx\b[^>]*>/.exec(repx ?? '')?.[0] ?? '';
  const attr = (name: string) => {
    const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
    return m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&') : null;
  };
  const mode = attr('ExportMode');
  return {
    mode: mode === 'SingleFilePageByPage' || mode === 'DifferentFiles' ? mode : 'SingleFile',
    text: attr('TextExportMode') === 'Text',
    sheetName: attr('SheetName') || 'Sheet',
    gridLines: (attr('ShowGridLines') ?? '').toLowerCase() === 'true',
  };
}

/** The items of each sheet: the continuous layout's, or each printed page's. */
function sheetItems(structure: ReportStructure, recordCount: number, options: PaginateOptions, paged: boolean): Item[][] {
  // Whole points only: DevExpress wrote the default 9.75pt as 9.
  const whole = (items: Item[]) => items.map((i) => ({ ...i, font: { ...i.font, size: Math.trunc(i.font.size) } }));
  if (!paged) return [whole(reportItems(layoutContinuous(structure, recordCount, options)))];
  const report = paginate(structure, recordCount, options);
  const items = whole(reportItems(report));
  return report.pages.map((_, i) => items.filter((it) => it.page === i));
}

/** One workbook of `sheets`, each a sheet laid out from its items. */
function workbook(structure: ReportStructure, sheets: { name: string; items: Item[] }[], xlsx: XlsxOptions): Uint8Array {
  const perInch = unitsPerInch(structure.unit);
  const px = (u: number) => Math.round((u / perInch) * 96);
  const key = (n: number) => Math.round(n * 100) / 100;

  // Styles, deduplicated across the workbook.
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

  const written = sheets.map(({ items }) => {
    // The sheet starts at the content's top-left corner, not at the first
    // control: DevExpress's workbook of s26, one label at 50,20, opened with a
    // half-inch column and a 20-unit row before it, and s23's cross-tab at y=10
    // with a 10-unit row. Every earlier case had a control at both edges. A top
    // margin band that prints is content too, and it starts at the page's top
    // edge: in s29m its label at 10 sat in row 2, after a 10-unit row (row 38).
    const marginTop = structure.bands.some((b) => b.kind === 'TopMargin' && b.controls.length);
    const origin = { x: key(structure.margins.left), y: marginTop ? 0 : key(structure.margins.top) };
    const xs = [...new Set([origin.x, ...items.flatMap((i) => [key(i.left), key(i.right)])])].sort((a, b) => a - b);
    const ys = [...new Set([origin.y, ...items.flatMap((i) => [key(i.top), key(i.bottom)])])].sort((a, b) => a - b);

    /*
     * A cell with no value of its own -- a literal label, or a page number --
     * takes the number format of the first such cell with its look, top to
     * bottom (parity row 43). That first one is General for a literal and text
     * for a page number. Printed in s29m to s29m11: a page number after a
     * literal of the same font and alignment was General, a literal after a
     * page number was text, and a page number with a look of its own was text.
     * A bound field neither gives its format nor takes one: a literal after
     * bound text stayed General, and a page number after bound numbers was
     * text. Until this row every page number was text, which held for every
     * case measured before s29m because none followed a literal of its look.
     */
    const lookOf = (item: Item) => JSON.stringify([item.font, item.fill, item.h, item.v]);
    const unvalued = items.filter((i) => i.value === undefined && i.text).sort((a, b) => a.top - b.top || a.left - b.left);
    const lookFormat = new Map<string, string>();
    for (const item of unvalued) if (!lookFormat.has(lookOf(item))) lookFormat.set(lookOf(item), item.pageNumber ? '@' : 'General');

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
      if (xlsx.text) {
        // Text mode (s62d): every cell what it printed, every cell text.
        cell = item.text
          ? `<c r="${ref}" t="s" s="${styleOf(item, '@')}"><v>${stringId(item.text)}</v></c>`
          : `<c r="${ref}" s="${styleOf(item, '@')}"/>`;
      } else if (typeof value === 'bigint' || typeof value === 'number' || value instanceof NetDecimal) {
        const n = value instanceof NetDecimal ? value.toNumber() : Number(value);
        cell = `<c r="${ref}" s="${styleOf(item, excelFormat(item.format, 'number'))}"><v>${n}</v></c>`;
      } else if (value instanceof Date) {
        cell = `<c r="${ref}" s="${styleOf(item, excelFormat(item.format, 'date'))}"><v>${serial(value)}</v></c>`;
      } else if (typeof value === 'string') {
        cell = value === '' && !item.format
          ? `<c r="${ref}" s="${styleOf(item, '@')}"/>`
          : `<c r="${ref}" t="s" s="${styleOf(item, excelFormat(item.format, 'text'))}"><v>${stringId(value)}</v></c>`;
      } else if (value === undefined && item.text) {
        // A literal label, a page number, or no test data: the printed text, in
        // the format the first such cell of its look set.
        cell = `<c r="${ref}" t="s" s="${styleOf(item, lookFormat.get(lookOf(item)) ?? 'General')}"><v>${stringId(item.text)}</v></c>`;
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
      // The grid is off unless the file turns it on (s62f).
      `<sheetViews><sheetView workbookViewId="0"${xlsx.gridLines ? '' : ' showGridLines="0"'}/></sheetViews>` +
      (cols.length ? `<cols>${cols.join('')}</cols>` : '') +
      `<sheetData>${sheetRows.join('')}</sheetData>` +
      (merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '') +
      (links.length ? `<hyperlinks>${links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rId${i + 1}"/>`).join('')}</hyperlinks>` : '') +
      '</worksheet>';
    return { sheet, links };
  });

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
  const n = sheets.length;

  const entries = [
    {
      name: '[Content_Types].xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
    },
    { name: '_rels/.rels', content: rels([rel('rId1', 'officeDocument', 'xl/workbook.xml')]) },
    {
      name: 'xl/workbook.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: rels([
        ...sheets.map((_, i) => rel(`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`)),
        rel(`rId${n + 1}`, 'styles', 'styles.xml'),
        rel(`rId${n + 2}`, 'sharedStrings', 'sharedStrings.xml'),
      ]),
    },
    ...written.map((w, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: w.sheet })),
    { name: 'xl/styles.xml', content: styles },
    { name: 'xl/sharedStrings.xml', content: shared },
    ...written.flatMap((w, i) =>
      w.links.length ? [{ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, content: rels(w.links.map((l, k) => rel(`rId${k + 1}`, 'hyperlink', l.url, true))) }] : [],
    ),
  ];
  const zip = buildZip(entries, new Date(), { keepPaths: true });
  if (!zip.bytes) throw new Error(`The workbook could not be written: ${zip.reason}.`);
  return zip.bytes;
}

/**
 * The report as one .xlsx workbook: one continuous sheet, or, page by page, a
 * sheet per printed page. `DifferentFiles` asks for a workbook per page,
 * which is `reportToXlsxFiles`'s; asked of this, it is one workbook page by page.
 */
export function reportToXlsx(structure: ReportStructure, recordCount: number, options: PaginateOptions = {}, xlsx: XlsxOptions = DEFAULT_XLSX): Uint8Array {
  const paged = xlsx.mode !== 'SingleFile';
  const sheets = sheetItems(structure, recordCount, options, paged).map((items, i) => ({ name: paged ? `${xlsx.sheetName}${i + 1}` : xlsx.sheetName, items }));
  return workbook(structure, sheets, xlsx);
}

/**
 * Every workbook the options ask for, each with the number DevExpress gave
 * its file: one, numbered '' , unless `DifferentFiles` asks for one per page,
 * numbered from 1 as `report1.xlsx` was, each holding that page's sheet.
 */
export function reportToXlsxFiles(
  structure: ReportStructure,
  recordCount: number,
  options: PaginateOptions = {},
  xlsx: XlsxOptions = DEFAULT_XLSX,
): { number: string; bytes: Uint8Array }[] {
  if (xlsx.mode !== 'DifferentFiles') return [{ number: '', bytes: reportToXlsx(structure, recordCount, options, xlsx) }];
  return sheetItems(structure, recordCount, options, true).map((items, i) => ({
    number: String(i + 1),
    bytes: workbook(structure, [{ name: `${xlsx.sheetName}${i + 1}`, items }], xlsx),
  }));
}
