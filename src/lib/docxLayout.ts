/**
 * A Word template's layout as a draft the AI corrects (2026-11-11, the full
 * audit's CP-11). Until then a .docx went to the AI as its words alone
 * (lib/dataFiles.ts), so a report asked for "from this template" was designed
 * from nothing, its paper, margins, column widths and type sizes guessed.
 *
 * Read in the browser from the file's own XML, with no library:
 * - `word/document.xml`'s last `w:sectPr`: the page (`w:pgSz`) and margins
 *   (`w:pgMar`), in twips;
 * - its paragraphs, in order: the words, the size (`w:sz`, half-points),
 *   bold and italic, and the alignment (`w:jc`);
 * - its first table: the column widths (`w:gridCol`), the row heights
 *   (`w:trHeight`) and each cell's words;
 * - `word/header1.xml` and `word/footer1.xml`, the page header and footer;
 * - `word/styles.xml`'s document defaults, the face and size a run without
 *   its own takes.
 *
 * The result is written in the box reader's draft format (lib/draftText.ts)
 * by `templateDraft`, which lib/xlsxLayout.ts shares, so the AI corrects a
 * measured draft and Forma builds the report from it, as for a picture. The
 * paragraphs before the table are the report header, the table's first row
 * the column headings on every page, its second row the record (a merge
 * placeholder such as «Name», {{Name}} or [Name] names its field, else the
 * heading above does), and the paragraphs after it the report footer.
 */
import { unzip } from './dataFiles';
import { draftToText } from './draftText';
import { paperName, type ReportSkeleton, type SkeletonBand, type SkeletonCell, type SkeletonControl, type SkeletonRole } from './reportSkeleton';
import { noneGiven, placeKey } from './skeletonRepx';
import { unescapeXml } from './xmlEscape';

/** A run of text as a template lays it out; lengths in hundredths of an inch, sizes in points. */
export interface TemplateText {
  text: string;
  family: string;
  size: number;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  /** From the printable area's left edge; the whole width when absent. */
  x?: number;
  w?: number;
}

export interface TemplateTable {
  x: number;
  /** Each column's width. */
  widths: number[];
  rows: { cells: TemplateText[]; height: number }[];
}

/** A template's page and what is on it, in hundredths of an inch. */
export interface TemplatePage {
  width: number;
  height: number;
  margins: { top: number; bottom: number; left: number; right: number };
  /** Printed once, before the table. */
  before: TemplateText[];
  table: TemplateTable | null;
  /** Printed once, after the table. */
  after: TemplateText[];
  header: TemplateText[];
  footer: TemplateText[];
}

/** A line's height for a size in points, in hundredths of an inch: the size and a half, as a word processor sets single spacing. */
export const lineHeight = (points: number) => Math.round((points * 1.5 * 100) / 72);

const MERGE_FIELD = /^\s*(?:«|\{\{|\[|<<|\{)\s*([\p{L}\p{N}_ .]+?)\s*(?:»|\}\}|\]|>>|\})\s*$/u;

/** The field a record's cell prints: its merge placeholder's name, else the heading above it as a name. */
export function fieldOf(cell: string, heading: string): string {
  const placeholder = MERGE_FIELD.exec(cell)?.[1];
  const from = placeholder ?? heading;
  return from.replace(/[^\p{L}\p{N}_]+/gu, ' ').trim().split(/\s+/).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
}

/** The template's page as Forma's draft text (lib/draftText.ts's format), or null when it holds nothing to lay out. */
export function templateDraft(page: TemplatePage): string | null {
  const printable = Math.max(1, page.width - page.margins.left - page.margins.right);
  const given = noneGiven();
  const bands: SkeletonBand[] = [{ kind: 'TopMargin', height: page.margins.top, groupFields: 0, controls: [] }];
  const font = (t: TemplateText) => ({ family: t.family, size: t.size, bold: t.bold, italic: t.italic });

  /** Labels stacked down a band, one per paragraph; the band's height is theirs. */
  const stack = (texts: readonly TemplateText[], role: (t: TemplateText, n: number) => SkeletonRole): { controls: SkeletonControl[]; height: number } => {
    let y = 0;
    const controls: SkeletonControl[] = [];
    texts.forEach((t, n) => {
      const h = lineHeight(t.size);
      const x = Math.max(0, Math.min(printable - 1, t.x ?? 0));
      const w = Math.max(1, Math.min(printable - x, t.w ?? printable));
      given.words.set(placeKey(bands.length, controls.length), t.text);
      controls.push({ kind: 'label', role: role(t, n), x, y, w, h, font: font(t), align: t.align, borders: 0, chars: Math.min(200, t.text.length) });
      y += h;
    });
    return { controls, height: y };
  };
  const addBand = (kind: SkeletonBand['kind'], texts: readonly TemplateText[], role: (t: TemplateText, n: number) => SkeletonRole = () => 'caption') => {
    if (!texts.length) return;
    const { controls, height } = stack(texts, role);
    bands.push({ kind, height, groupFields: 0, controls });
  };

  // The first paragraph of the report header is its title when it is set larger than the rest.
  const sizes = [...page.before, ...page.after].map((t) => t.size).sort((a, b) => a - b);
  const typical = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  addBand('ReportHeader', page.before, (t, n) => (n === 0 && (t.size >= typical + 1.5 || t.size >= 14) ? 'title' : 'caption'));

  const table = page.table;
  const headings = table?.rows[0];
  if (table && headings && table.widths.length) {
    const columns = Math.min(table.widths.length, Math.max(...table.rows.map((r) => r.cells.length)));
    const widths = table.widths.slice(0, columns);
    const total = widths.reduce((s, w) => s + w, 0);
    const x = Math.max(0, Math.min(printable - 1, table.x));
    const w = Math.max(1, Math.min(printable - x, total));
    type Row = TemplateTable['rows'][number];
    const rowHeight = (row: Row) => Math.max(row.height, lineHeight(Math.max(8, ...row.cells.map((c) => c.size))));
    /** One row of the table as a table control at `y`: headings as captions, a record as values bound to fields. */
    const tableControl = (row: Row, role: SkeletonRole, bi: number, ci: number, y: number, h: number): SkeletonControl => {
      const cells: SkeletonCell[] = widths.map((cw, k) => {
        const t = row.cells[k];
        const text = t?.text ?? '';
        if (role === 'caption' && text) given.words.set(placeKey(bi, ci, 0, k), text);
        if (role === 'value') given.fields.set(placeKey(bi, ci, 0, k), fieldOf(text, headings.cells[k]?.text ?? '') || `Column${k + 1}`);
        return {
          weight: Math.round((cw / total) * columns * 100) / 100,
          role: role === 'caption' && !text ? 'decoration' : role,
          align: t?.align ?? 'left',
          chars: role === 'caption' ? Math.min(200, text.length) : 0,
          font: t ? font(t) : null,
        };
      });
      return { kind: 'table', role: 'value', x, y, w, h, font: row.cells[0] ? font(row.cells[0]) : null, align: 'left', borders: 0, chars: 0, rows: [cells] };
    };
    // The page header: its paragraphs, then the column headings under them.
    const hi = bands.length;
    const head = stack(page.header, () => 'caption');
    const hh = rowHeight(headings);
    head.controls.push(tableControl(headings, 'caption', hi, head.controls.length, head.height, hh));
    bands.push({ kind: 'PageHeader', height: head.height + hh, groupFields: 0, controls: head.controls });
    // The record: the table's second row, or a row of values under the headings.
    const record = table.rows[1] ?? { cells: headings.cells.map((c) => ({ ...c, text: '', bold: false })), height: headings.height };
    const rh = rowHeight(record);
    bands.push({ kind: 'Detail', height: rh, groupFields: 0, controls: [tableControl(record, 'value', bands.length, 0, 0, rh)] });
  } else {
    addBand('PageHeader', page.header);
  }
  addBand('ReportFooter', page.after);
  addBand('PageFooter', page.footer);
  bands.push({ kind: 'BottomMargin', height: page.margins.bottom, groupFields: 0, controls: [] });
  if (!bands.some((b) => b.controls.length)) return null;

  const { paper, landscape } = paperName(page.width, page.height);
  const skeleton: ReportSkeleton = { paper, landscape, width: page.width, height: page.height, margins: page.margins, bands };
  return draftToText(skeleton, given);
}

/* ------------------------------------------------------------------ *
 * Word
 * ------------------------------------------------------------------ */

/** Twips (a twentieth of a point) in hundredths of an inch. */
const twips = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined ? Math.round(n / 14.4) : fallback;
};
const attr = (xml: string, tag: string, name: string) => new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`).exec(xml)?.[1];
/** A switch such as `w:b`, on unless its value says off. */
const on = (rPr: string, tag: string) => {
  const m = new RegExp(`<${tag}(?=[\\s/>])([^>]*)>`).exec(rPr);
  return !!m && !/w:val="(?:0|false|off)"/.test(m[1]);
};

interface WordDefaults {
  family: string;
  size: number;
}

/** One paragraph as a template text, or null when it holds no words. */
export function wordParagraph(p: string, defaults: WordDefaults): TemplateText | null {
  const text = unescapeXml(
    [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g)].map((m) => m[1] ?? ' ').join(''),
  ).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const firstRun = /<w:r(?=[\s>])[\s\S]*?<\/w:r>/.exec(p)?.[0] ?? '';
  const rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(firstRun)?.[0] ?? /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p)?.[0] ?? '';
  const half = Number(attr(rPr, 'w:sz', 'w:val'));
  const jc = attr(/<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p)?.[0] ?? '', 'w:jc', 'w:val');
  return {
    text,
    family: attr(rPr, 'w:rFonts', 'w:ascii') ?? defaults.family,
    size: Number.isFinite(half) && half > 0 ? half / 2 : defaults.size,
    bold: on(rPr, 'w:b'),
    italic: on(rPr, 'w:i'),
    align: jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left',
  };
}

/** The paragraphs of a part, outside any table, in order. */
const paragraphs = (xml: string, defaults: WordDefaults) =>
  [...xml.matchAll(/<w:p(?=[\s>])[\s\S]*?<\/w:p>/g)].flatMap((m) => wordParagraph(m[0], defaults) ?? []);

/** A table's columns, rows and cells. */
function wordTable(tbl: string, defaults: WordDefaults): TemplateTable {
  const widths = [...tbl.matchAll(/<w:gridCol\b[^>]*\sw:w="(\d+)"/g)].map((m) => twips(m[1], 0));
  const rows = [...tbl.matchAll(/<w:tr(?=[\s>])[\s\S]*?<\/w:tr>/g)].map((tr) => {
    const cells = [...tr[0].matchAll(/<w:tc(?=[\s>])[\s\S]*?<\/w:tc>/g)].map((tc) => {
      const ps = paragraphs(tc[0], defaults);
      const first = ps[0] ?? { text: '', family: defaults.family, size: defaults.size, bold: false, italic: false, align: 'left' as const };
      return { ...first, text: ps.map((p) => p.text).join(' ') };
    });
    return { cells, height: twips(attr(tr[0], 'w:trHeight', 'w:val'), 0) };
  });
  return { x: twips(attr(tbl, 'w:tblInd', 'w:w'), 0), widths: widths.length ? widths : [], rows };
}

/** The body with its first top-level table cut out: what comes before it, the table, and what comes after. */
function splitAtTable(body: string): { before: string; table: string | null; after: string } {
  const open = /<w:tbl(?=[\s>])|<\/w:tbl>/g;
  let depth = 0;
  let start = -1;
  for (const m of body.matchAll(open)) {
    if (m[0] !== '</w:tbl>') {
      if (depth++ === 0) start = m.index!;
    } else if (--depth === 0 && start >= 0) {
      const end = m.index! + m[0].length;
      return { before: body.slice(0, start), table: body.slice(start, end), after: body.slice(end).replace(/<w:tbl(?=[\s>])[\s\S]*<\/w:tbl>/g, '') };
    }
  }
  return { before: body, table: null, after: '' };
}

/** A Word document's page as a template, or null when it is not one Forma can read. */
export async function readDocxTemplate(bytes: Uint8Array): Promise<TemplatePage | null> {
  const parts = await unzip(bytes, (n) => /^word\/(document|header1|footer1|styles)\.xml$/.test(n));
  const read = (name: string) => new TextDecoder().decode(parts.get(name) ?? new Uint8Array());
  const document = read('word/document.xml');
  if (!document) return null;
  const styles = /<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(read('word/styles.xml'))?.[0] ?? '';
  const half = Number(attr(styles, 'w:sz', 'w:val'));
  const defaults: WordDefaults = { family: attr(styles, 'w:rFonts', 'w:ascii') ?? 'Calibri', size: Number.isFinite(half) && half > 0 ? half / 2 : 11 };
  const sections = [...document.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)];
  const sect = sections[sections.length - 1]?.[0] ?? '';
  const body = (/<w:body>([\s\S]*)<\/w:body>/.exec(document)?.[1] ?? '').replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g, '');
  const { before, table, after } = splitAtTable(body);
  return {
    // Letter, with Word's own one-inch margins, when the file says nothing.
    width: twips(attr(sect, 'w:pgSz', 'w:w'), 850),
    height: twips(attr(sect, 'w:pgSz', 'w:h'), 1100),
    margins: {
      top: Math.max(0, twips(attr(sect, 'w:pgMar', 'w:top'), 100)),
      bottom: Math.max(0, twips(attr(sect, 'w:pgMar', 'w:bottom'), 100)),
      left: twips(attr(sect, 'w:pgMar', 'w:left'), 100),
      right: twips(attr(sect, 'w:pgMar', 'w:right'), 100),
    },
    before: paragraphs(before, defaults),
    table: table ? wordTable(table, defaults) : null,
    after: paragraphs(after, defaults),
    header: paragraphs(read('word/header1.xml'), defaults),
    footer: paragraphs(read('word/footer1.xml'), defaults),
  };
}

/** A Word document's layout as Forma's draft text, or null when it has nothing to lay out or will not read. */
export async function docxDraft(bytes: Uint8Array): Promise<string | null> {
  try {
    const page = await readDocxTemplate(bytes);
    return page ? templateDraft(page) : null;
  } catch {
    return null;
  }
}
