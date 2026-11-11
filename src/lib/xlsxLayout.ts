/**
 * An Excel template's layout as a draft the AI corrects (2026-11-11, the full
 * audit's CP-11), beside lib/docxLayout.ts, whose `templateDraft` writes it.
 * Until then a workbook went to the AI as its first rows of data alone
 * (lib/dataFiles.ts), which is still what it is given as data.
 *
 * Read from the first worksheet's own XML, with no library:
 * - `<cols>`: each column's width, in characters of the workbook's default
 *   font, as Excel draws them (`7 * width + 5` pixels at 96 dpi);
 * - `<row ht>`: a row's height in points, 15 when it sets none;
 * - `<mergeCells>`: a title merged across columns spans them;
 * - the cell's style (`s`) through `xl/styles.xml`'s `cellXfs` to its font:
 *   bold, italic, size and face, and its horizontal alignment;
 * - `<pageSetup>` and `<pageMargins>`: the paper, its orientation and the
 *   margins in inches.
 *
 * The heading row is the first that has text in two or more columns; the
 * rows above it are the report header, and the row under it is the record
 * (a placeholder such as {{Name}} names its field, else the heading does).
 * Rows of data further down are data, not layout, and are left out.
 */
import { MAX_SHEET_COLUMNS, firstSheet, unzip, zipNames } from './dataFiles';
import { lineHeight, templateDraft, type TemplatePage, type TemplateText } from './docxLayout';
import { pageSizeInUnits } from './reportGeometry';
import { unescapeXml } from './xmlEscape';

/** Excel's paper sizes Forma names, by `paperSize`. */
const PAPERS: Record<string, string> = { '1': 'Letter', '5': 'Legal', '7': 'Executive', '8': 'A3', '9': 'A4', '11': 'A5' };

/** A column's letters as its index: A is 0, Z 25, AA 26. */
const columnIndex = (letters: string) => [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
/** A width in characters as hundredths of an inch. */
const charsWide = (chars: number) => Math.round(((Math.trunc(chars * 7 + 5)) * 100) / 96);
const attr = (xml: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(xml)?.[1];

interface CellStyle {
  family: string;
  size: number;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
}

/** Each `cellXfs` entry's font and alignment. */
function readStyles(styles: string): CellStyle[] {
  const fonts = [...(/<fonts\b[\s\S]*?<\/fonts>/.exec(styles)?.[0] ?? '').matchAll(/<font(?=[\s>])[\s\S]*?<\/font>|<font\s*\/>/g)].map((m) => ({
    family: /<name\s+val="([^"]*)"/.exec(m[0])?.[1] ?? 'Calibri',
    size: Number(/<sz\s+val="([^"]*)"/.exec(m[0])?.[1]) || 11,
    bold: /<b\s*\/>|<b\s+val="(?:1|true)"/.test(m[0]),
    italic: /<i\s*\/>|<i\s+val="(?:1|true)"/.test(m[0]),
  }));
  const plain = fonts[0] ?? { family: 'Calibri', size: 11, bold: false, italic: false };
  return [...(/<cellXfs\b[\s\S]*?<\/cellXfs>/.exec(styles)?.[0] ?? '').matchAll(/<xf\b([^>]*?)(?:\/>|>([\s\S]*?)<\/xf>)/g)].map((m) => {
    const horizontal = attr(m[2] ?? '', 'horizontal');
    return {
      ...(fonts[Number(attr(m[1], 'fontId'))] ?? plain),
      align: horizontal === 'center' || horizontal === 'centerContinuous' ? 'center' : horizontal === 'right' ? 'right' : 'left',
    };
  });
}

/** A workbook's first worksheet as a template, or null when it is not one Forma can read. */
export async function readXlsxTemplate(bytes: Uint8Array): Promise<TemplatePage | null> {
  // The first sheet alone is inflated (2026-11-11, the re-audit's R5-07): every
  // sheet was, then all but one set aside, so a workbook of many large sheets
  // cost the tab all of them to read one.
  const sheetName = firstSheet(zipNames(bytes));
  if (!sheetName) return null;
  const parts = await unzip(bytes, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/styles.xml' || n === sheetName);
  const decode = (name: string) => new TextDecoder().decode(parts.get(name) ?? new Uint8Array());
  const sheet = decode(sheetName);
  const shared = [...decode('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescapeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const styles = readStyles(decode('xl/styles.xml'));
  const plain: CellStyle = styles[0] ?? { family: 'Calibri', size: 11, bold: false, italic: false, align: 'left' };

  // Column widths, in hundredths of an inch.
  const defaultChars = Number(attr(/<sheetFormatPr\b[^>]*>/.exec(sheet)?.[0] ?? '', 'defaultColWidth')) || 8.43;
  const widthOf = new Map<number, number>();
  for (const m of sheet.matchAll(/<col\b([^>]*)\/?>/g)) {
    const [min, max, w] = [Number(attr(m[1], 'min')), Number(attr(m[1], 'max')), Number(attr(m[1], 'width'))];
    if (!min || !max || !w) continue;
    for (let c = min; c <= Math.min(max, min + 256); c++) widthOf.set(c - 1, charsWide(w));
  }
  const colWidth = (c: number) => widthOf.get(c) ?? charsWide(defaultChars);
  // Where each column starts, summed once as far as asked (R5-07): summing
  // from column A on every call made a wide sheet's cells cost the square of
  // its width.
  const starts = [0];
  const colX = (c: number) => {
    for (let i = starts.length - 1; i < c; i++) starts.push(starts[i] + colWidth(i));
    return starts[c];
  };

  // Merged ranges, by their top left cell; a reference past Excel's last column is not one.
  const merges = new Map<string, number>();
  for (const m of sheet.matchAll(/<mergeCell\s+ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g)) {
    const [from, to] = [columnIndex(m[1]), columnIndex(m[3])];
    if (from < MAX_SHEET_COLUMNS && to < MAX_SHEET_COLUMNS) merges.set(`${m[2]}:${from}`, to);
  }

  // Rows with their cells' text and style.
  const rows: { r: number; height: number; cells: { col: number; text: string; style: CellStyle }[] }[] = [];
  // A formatted empty row is written self-closing (<row r="3" ht="5"/>); read
  // as an open tag it swallowed the next row's cells under its number.
  for (const row of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(attr(row[1], 'r')) || rows.length + 1;
    const cells = [...(row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].flatMap((c) => {
      const ref = /\br="([A-Z]+)\d+"/.exec(c[1])?.[1];
      const type = attr(c[1], 't');
      const inner = c[2] ?? '';
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
      const text = (type === 's' ? shared[Number(raw)] ?? '' : type === 'inlineStr' ? unescapeXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? '') : unescapeXml(raw)).trim();
      if (!text || !ref || columnIndex(ref) >= MAX_SHEET_COLUMNS) return [];
      return [{ col: columnIndex(ref), text, style: styles[Number(attr(c[1], 's'))] ?? plain }];
    });
    const ht = Number(attr(row[1], 'ht'));
    rows.push({ r, height: Math.round(((ht > 0 ? ht : 15) * 100) / 72), cells });
  }
  const filled = rows.filter((r) => r.cells.length);
  if (!filled.length) return null;

  const asText = (c: { text: string; style: CellStyle }, x: number, w: number): TemplateText => ({ text: c.text, ...c.style, x, w });
  const headingAt = filled.findIndex((r) => r.cells.length >= 2);
  const above = headingAt === -1 ? filled : filled.slice(0, headingAt);
  const before: TemplateText[] = above.flatMap((row) =>
    row.cells.map((c) => {
      const last = merges.get(`${row.r}:${c.col}`);
      const x = colX(c.col);
      return asText(c, x, last !== undefined ? colX(last + 1) - x : colWidth(c.col));
    }),
  );
  let table: TemplatePage['table'] = null;
  if (headingAt !== -1) {
    const heading = filled[headingAt];
    const first = Math.min(...heading.cells.map((c) => c.col));
    const last = Math.max(...heading.cells.map((c) => c.col));
    const columns = Array.from({ length: last - first + 1 }, (_, i) => first + i);
    const rowOf = (row: typeof heading) => ({
      cells: columns.map((col) => {
        const c = row.cells.find((x) => x.col === col);
        return c ? asText(c, colX(col), colWidth(col)) : { text: '', ...plain };
      }),
      height: Math.max(row.height, lineHeight(plain.size)),
    });
    const next = filled[headingAt + 1];
    table = {
      x: colX(first),
      widths: columns.map(colWidth),
      rows: [rowOf(heading), ...(next && next.r === heading.r + 1 ? [rowOf(next)] : [])],
    };
  }

  const setup = /<pageSetup\b[^>]*>/.exec(sheet)?.[0] ?? '';
  const paper = PAPERS[attr(setup, 'paperSize') ?? '1'] ?? 'Letter';
  const size = pageSizeInUnits(paper, 'HundredthsOfAnInch');
  const landscape = attr(setup, 'orientation') === 'landscape';
  const marginsAt = /<pageMargins\b[^>]*>/.exec(sheet)?.[0] ?? '';
  // Excel's own margins when the sheet sets none: 0.7 in at the sides, 0.75 in above and below.
  const inch = (name: string, fallback: number) => Math.round((Number(attr(marginsAt, name) ?? fallback) || fallback) * 100);
  return {
    width: landscape ? size.height : size.width,
    height: landscape ? size.width : size.height,
    margins: { top: inch('top', 0.75), bottom: inch('bottom', 0.75), left: inch('left', 0.7), right: inch('right', 0.7) },
    before,
    table,
    after: [],
    header: [],
    footer: [],
  };
}

/** A workbook's layout as Forma's draft text, or null when it has nothing to lay out or will not read. */
export async function xlsxDraft(bytes: Uint8Array): Promise<string | null> {
  try {
    const page = await readXlsxTemplate(bytes);
    return page ? templateDraft(page) : null;
  } catch {
    return null;
  }
}
