/**
 * The records a page shows, read without AI, for printing a report with them
 * before it is answered (2026-11-11, the full audit's CC-01).
 *
 * The Claude Code reference printed every version of three reports through
 * DevExpress with the records the source page shows, and every defect in
 * Forma's answers was visible in one such print: two pages for a one-page
 * invoice, a title cut to "INVO", one group with a blank heading, 248.3 under
 * "Margin %", "1763.0" for "1,763.00". Forma owns a printer (`paginate`) but
 * ran it only when the person opened the Preview, and with no records unless
 * they asked the AI for test data. The records were on the page all along, in
 * OCR's reading of it, which the generation already has as its evidence.
 *
 * - **The page's biggest grid is its records**, one row per record, as the
 *   audit's `grid-not-a-table` reads the same reading. Its first row is the
 *   heading when it holds no number; a row of one text is a group's heading;
 *   a row that opens with "Total" or "Subtotal" is a total, kept apart, unless
 *   what follows the word names something new ("Total Gym", `isTotalLabel`);
 *   a label and a figure after a total ("Tax 8.50") is neither.
 * - **Each column goes to the field the report prints over it**: by its
 *   heading first (`matchColumns`, as the Data tab matches a column to a
 *   field), else by its place across the page, measured on each side from its
 *   own first column to its last, since the reading and the report need not
 *   share a margin.
 * - **A value is kept as the data would hold it**: "1,763.00" is 1763.00 and
 *   "14 Oct 2026" is 2026-10-14 (`formatFromText.ts`), and the page's own text
 *   is kept beside it, for the format a value prints in.
 * - **A group the page shows by its headings** ("Region: North") gives the
 *   report's group field its value, when no column carries it and the
 *   group's header prints that field: the page prints the region once above
 *   its records, not on every row.
 *
 * Nothing here judges the report; `printCheck.ts` and `totalsCheck.ts` do.
 */
import { parseReportStructure, decodeXmlText, type RecordValues } from './reportPreview';
import { matchColumns } from './fieldMatch';
import { formatFor, isPlain, valueOfText } from './formatFromText';
import type { ReportLayout, ReportElement } from './reportTypes';

export interface PageTotal {
  /** The row's first text, "Total" or "Subtotal North". */
  label: string;
  /** The figure under each field's column, as the page printed it. */
  figures: Record<string, string>;
  /** The group it closes, by index into `groups`; null for the whole report's. */
  group: number | null;
}

export interface PageRows {
  /** Every record the grid shows, by the field the report prints over each column. */
  rows: RecordValues[];
  /** Each field's texts as the page printed them, in record order. */
  samples: Record<string, string[]>;
  /** The page's own totals, in page order. */
  totals: PageTotal[];
  /** The records of each group the page shows, by index into `rows`; one run when it shows no groups. */
  groups: number[][];
  /** How many pages the reading holds. */
  pages: number;
  /** The field each column of the grid was given, null where none was; for the console. */
  columns: (string | null)[];
}

const TOTAL = /^(grand\s+)?(sub-?\s?)?totals?\b|^(sum|balance due|amount due)\b/i;
const hasDigit = (s: string) => /\d/.test(s);

/** Words a total's label carries after "Total" that name no record: "Total amount", "Total due". */
const TOTAL_TAIL = /^(amount|due|payable|value|net|gross|price|cost|qty|quantity)$/i;
/** A currency code after "Total", "Total USD": capitals only, or "Gym" would be one. */
const CURRENCY_TAIL = /^[A-Z]{3}$/;

/**
 * Whether a row's first text labels a total. "Total", "Subtotal", "Grand
 * total", "Total:", "Total (USD)", "Total for North", and "Total North" when
 * North is a group or a value the page has shown: what follows the word has
 * to name nothing new. "Total Gym" is a product, a record like any other
 * (2026-11-11, the review of CC-01), and taking it for a total dropped it
 * from the records and checked its figures as a total's.
 */
function isTotalLabel(first: string, known: ReadonlySet<string>): boolean {
  const m = TOTAL.exec(first);
  if (!m) return false;
  const tail = first
    .slice(m[0].length)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^[\s:,.\-]+|[\s:,.\-]+$/g, '')
    .replace(/^(for|of)\s+/i, '')
    .trim();
  return !tail || TOTAL_TAIL.test(tail) || CURRENCY_TAIL.test(tail) || known.has(tail.toLowerCase());
}

/** A table cell's or a label's single field, `[Amount]` alone; null for anything else. */
const singleField = (expression: string | null | undefined) => /^\[([^\][]+)\]$/.exec((expression ?? '').trim())?.[1] ?? null;

/** Every field the report's Detail band prints alone in one place, with where across the band it prints. */
function detailPlaces(xml: string): { field: string; centre: number }[] {
  const structure = parseReportStructure(xml);
  const calculated = new Set(structure.calculatedFields.map((f) => f.name));
  const out: { field: string; centre: number }[] = [];
  for (const band of structure.bands.filter((b) => b.kind === 'Detail')) {
    for (const c of band.controls) {
      if (!c.visible) continue;
      const left = c.x + c.offsetX;
      if (c.type === 'XRTable') {
        // The table's last row: a heading may sit above the values inside the same table.
        const row = c.rows[c.rows.length - 1];
        const total = row?.cells.reduce((s, cell) => s + Math.max(0.01, cell.weight), 0) || 1;
        let x = left;
        for (const cell of row?.cells ?? []) {
          const w = (c.width * Math.max(0.01, cell.weight)) / total;
          const field = singleField(cell.data.expression);
          if (field && !calculated.has(field)) out.push({ field, centre: x + w / 2 });
          x += w;
        }
        continue;
      }
      const field = singleField(c.data.expression);
      if (field && !calculated.has(field)) out.push({ field, centre: left + c.width / 2 });
    }
  }
  const seen = new Set<string>();
  return out.filter((p) => !seen.has(p.field) && seen.add(p.field)).sort((a, b) => a.centre - b.centre);
}

/** Every field an expression reads, outside its string literals. */
const fieldsRead = (expression: string | null | undefined) =>
  [...(expression ?? '').replace(/'(?:[^']|'')*'/g, "''").matchAll(/\[([^\][]+)\]/g)].map((m) => m[1].trim());

/**
 * The report's outermost group's fields that its header prints (the higher
 * `Level`, and between equals the later in the file), alone or in an
 * expression such as `'Region: ' + [Region]`: the ones a heading on the page
 * can stand for. A group field the header does not print is not filled from
 * the page, so a group on a field nothing holds still prints as the one group
 * the data would give it.
 */
function outerGroupFields(xml: string): string[] {
  const headers = parseReportStructure(xml).bands.filter((b) => b.kind === 'GroupHeader');
  const outer = headers.reduce<(typeof headers)[number] | null>((best, b) => (!best || b.level >= best.level ? b : best), null);
  if (!outer) return [];
  const printed = new Set(outer.controls.flatMap((c) => (c.type === 'XRTable' ? c.rows.flatMap((r) => r.cells.flatMap((cell) => fieldsRead(cell.data.expression))) : fieldsRead(c.data.expression))));
  return outer.fields.map((f) => decodeXmlText(f.field)).filter((f) => printed.has(f));
}

/** The biggest grid of the reading: the most rows, then the most columns. */
function biggestGrid(evidence: ReportLayout): ReportElement | null {
  let best: ReportElement | null = null;
  for (const section of evidence.sections) {
    for (const e of section.elements) {
      if (e.type !== 'table' || (e.rows?.length ?? 0) < 2) continue;
      const cols = (t: ReportElement) => Math.max(0, ...(t.rows ?? []).map((r) => r.cells.length));
      if (!best || e.rows!.length > best.rows!.length || (e.rows!.length === best.rows!.length && cols(e) > cols(best))) best = e;
    }
  }
  return best;
}

/** Each column's centre across the grid, from its cells' weights (widths in the reading). */
function columnCentres(grid: ReportElement, count: number): number[] {
  const row = (grid.rows ?? []).find((r) => r.cells.length === count) ?? grid.rows![0];
  const weights = Array.from({ length: count }, (_, i) => Math.max(0.01, row.cells[i]?.weight ?? 1));
  const total = weights.reduce((s, w) => s + w, 0);
  const out: number[] = [];
  let x = grid.x;
  for (const w of weights) {
    const width = (grid.width * w) / total;
    out.push(x + width / 2);
    x += width;
  }
  return out;
}

/** Positions from 0 to 1 across a set's own span, so two sets with different margins compare. */
const spread = (xs: readonly number[]) => {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return xs.map((x) => (hi > lo ? (x - lo) / (hi - lo) : 0.5));
};

/**
 * The records the page's biggest grid shows, by the fields the report prints
 * them in; null when the reading holds no grid of two rows or more, or the
 * report's Detail band prints no field.
 */
export function rowsFromEvidence(evidence: ReportLayout | null | undefined, repx: string | null | undefined): PageRows | null {
  if (!evidence || !repx) return null;
  const grid = biggestGrid(evidence);
  if (!grid?.rows) return null;
  const places = detailPlaces(repx);
  if (!places.length) return null;
  const count = Math.max(...grid.rows.map((r) => r.cells.length));
  const texts = grid.rows.map((r) => Array.from({ length: count }, (_, i) => (r.cells[i]?.content ?? '').trim()));
  const filled = (row: string[]) => row.filter(Boolean).length;
  const heading = texts.length > 2 && filled(texts[0]) >= 2 && !texts[0].some(hasDigit) && texts.slice(1).some((r) => r.some(hasDigit)) ? texts[0] : null;

  // Each column's field: by its heading first, then by its place across the page.
  const columns: (string | null)[] = new Array(count).fill(null);
  const recordRows = texts.slice(heading ? 1 : 0);
  const used = (i: number) => recordRows.some((r) => r[i] && !TOTAL.test(r[0] || r.find(Boolean) || ''));
  if (heading) {
    const matched = matchColumns(
      heading.map((h) => ({ heading: h })),
      places.map((p) => ({ name: p.field, type: 'string' as const })),
    );
    matched.forEach((m, i) => {
      if (m.field && (m.level === 'high' || m.level === 'medium')) columns[i] = m.field;
    });
  }
  const freeColumns = Array.from({ length: count }, (_, i) => i).filter((i) => columns[i] === null && used(i));
  const freeFields = places.filter((p) => !columns.includes(p.field));
  if (freeColumns.length && freeFields.length) {
    const centres = columnCentres(grid, count);
    const at = spread(freeColumns.map((i) => centres[i]));
    const want = spread(freeFields.map((p) => p.centre));
    if (freeColumns.length === freeFields.length) freeColumns.forEach((col, k) => (columns[col] = freeFields[k].field));
    else {
      // Fewer of one than the other: each field takes the nearest column still free.
      const taken = new Set<number>();
      freeFields.forEach((p, k) => {
        let pick = -1;
        freeColumns.forEach((col, j) => {
          if (taken.has(col)) return;
          if (pick < 0 || Math.abs(at[j] - want[k]) < Math.abs(at[freeColumns.indexOf(pick)] - want[k])) pick = col;
        });
        if (pick >= 0 && Math.abs(at[freeColumns.indexOf(pick)] - want[k]) <= 0.2) {
          taken.add(pick);
          columns[pick] = p.field;
        }
      });
    }
  }
  if (!columns.some(Boolean)) return null;

  // The group field the page names in its headings, when no column carries it.
  const groupField = outerGroupFields(repx).find((f) => !columns.includes(f)) ?? null;

  const rows: RecordValues[] = [];
  const samples: Record<string, string[]> = {};
  const totals: PageTotal[] = [];
  const groups: number[][] = [[]];
  let groupValue: string | null = null;
  let closed = false;
  /** The texts the page has shown so far, lowercased, which a total's label may name. */
  const known = new Set((heading ?? []).filter(Boolean).map((t) => t.toLowerCase()));
  /** The most texts a record has filled: a row with fewer after a total is a summary line. */
  let widest = 0;
  const figuresOf = (row: string[]) => {
    const figures: Record<string, string> = {};
    row.forEach((text, i) => {
      if (text && columns[i] && hasDigit(text)) figures[columns[i]!] = text;
    });
    return figures;
  };
  const newGroup = () => {
    if (groups[groups.length - 1].length) groups.push([]);
    closed = false;
  };
  for (const row of recordRows) {
    const first = row.find(Boolean) ?? '';
    if (!first) continue;
    if (isTotalLabel(first, known)) {
      const current = groups[groups.length - 1];
      // A group's own total, or, once the group has one, the report's.
      const group = current.length && !closed ? groups.length - 1 : null;
      totals.push({ label: first, figures: figuresOf(row), group });
      if (group !== null) closed = true;
      continue;
    }
    if (filled(row) === 1 && count > 2 && row[0] && !hasDigit(row[0]) && (groupField !== null || /:/.test(row[0]))) {
      // A group's heading: "Region: North", or "North" alone when the report
      // groups. Not any one-text row: a description wrapped onto a second
      // line is one too, and it is skipped below as no record.
      newGroup();
      groupValue = first.replace(/^[^:]{1,30}:\s*/, '').trim();
      known.add(groupValue.toLowerCase());
      continue;
    }
    /*
     * A label and a figure after a total, "Tax 8.50" or "Shipping 12.00"
     * between an invoice's subtotal and its total, is a summary line, not the
     * first record of a new group: read as one, it made the total that follows
     * a group's and never the report's, and one record too many (2026-11-11,
     * the review of CC-01). A record after a subtotal fills as many places as
     * the records before it.
     */
    if (closed && count > 2 && filled(row) <= 2 && filled(row) < widest && !hasDigit(first)) continue;
    if (closed) newGroup();
    if (filled(row) < Math.min(2, count)) continue;
    widest = Math.max(widest, filled(row));
    for (const text of row) if (text) known.add(text.toLowerCase());
    const record: RecordValues = {};
    row.forEach((text, i) => {
      const field = columns[i];
      if (!field) return;
      record[field] = text ? valueOfText(text) : '';
      if (text) (samples[field] ??= []).push(text);
    });
    if (groupField && groupValue !== null) record[groupField] = groupValue;
    groups[groups.length - 1].push(rows.length);
    rows.push(record);
  }
  if (!rows.length) return null;
  // A report total written as the last group's, when the page shows one group: it is the report's.
  if (groups.length === 1) for (const t of totals) t.group = null;
  return { rows, samples, totals, groups: groups.filter((g) => g.length), pages: evidence.sections.length, columns };
}

/**
 * Each field's format as the page prints it, for `applyFormats`: a value's
 * unless it is a whole number printed plain (`isPlain`), a total's always,
 * since a total works out to more decimals than the page prints.
 */
export function pageFormats(page: PageRows): { values: Record<string, string>; totals: Record<string, string> } {
  const values: Record<string, string> = {};
  for (const [field, texts] of Object.entries(page.samples)) {
    const found = formatFor(texts);
    if (found && !isPlain(found)) values[field] = found.format;
  }
  const totals: Record<string, string> = {};
  const byField = new Map<string, string[]>();
  for (const t of page.totals) for (const [field, text] of Object.entries(t.figures)) byField.set(field, [...(byField.get(field) ?? []), text]);
  for (const [field, texts] of byField) {
    const found = formatFor(texts);
    if (found) totals[field] = found.format;
  }
  return { values, totals };
}
