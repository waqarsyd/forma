/**
 * Forma's draft of a report as text the AI corrects (2026-11-05).
 *
 * The owner's design: once the key opens the workspace, OCR, the box reader
 * or the vision model, Forma's own model and the AI work together, so that a
 * report burns fewer of the user's tokens. Forma drafts the report and the AI
 * corrects the draft, instead of the AI designing it from nothing. Written as
 * the REPX, a draft is thousands of tokens each way; written as this, it is
 * one short line per control, and Forma builds the REPX from the corrected
 * draft with the builder its vision model's skeletons already go through
 * (skeletonRepx.ts).
 *
 * The format is the skeleton text the vision model writes (skeletonText.ts),
 * one line per band and per control, with what a skeleton deliberately leaves
 * out added after a control or a cell:
 *
 *   page Letter portrait 850 1100 75 75 75 75
 *   band ReportHeader 160 0
 *   label title 0 0 300 30 Arial:18b l 0 17 "Northwind Traders" ink=#1F3864
 *   band GroupHeader 25 1 [Region]
 *   label value 0 0 200 20 Arial:10b l 0 0 [Region]
 *   band Detail 20 0
 *   table value 0 0 700 20 Arial:9 l 0 0
 *   row value 1 Arial:9 l 0 [Item] | value 3 Arial:9 l 0 [Description]
 *   band ReportFooter 40 0
 *   label caption 450 5 100 20 Arial:9b r 0 9 "Total Due" fill=#F2F2F2
 *   label total 560 5 140 20 Arial:9b r 0 0 [Amount]
 *
 * - a title or a caption's words, in double quotes;
 * - the field a value prints or a total sums, in square brackets;
 * - `fill=` and `ink=`, a background and a text colour as `#RRGGBB`;
 * - on a group header's band line, the fields it groups by.
 * A skeleton never carries words, because what the vision model learns from
 * must not hold the owner's clients' words (own-model.md, *Structure only*).
 * A draft is made from the user's own upload and goes to the AI the user
 * chose, the way the upload itself does, so it can.
 *
 * Reading is tolerant, as the skeleton's is: a line it cannot understand is
 * skipped and named in `problems`, a length left out is taken as 0, and a
 * total written as `sumSum([Amount])` still sums `[Amount]`.
 */
import { fontToken, isBandKind, isControlKind, readCell, readControl, readPage } from './skeletonText';
import { noneGiven, placeKey, type DraftGiven } from './skeletonRepx';
import type { ReportSkeleton, SkeletonBand, SkeletonRole } from './reportSkeleton';

const ALIGN = { left: 'l', center: 'c', right: 'r' } as const;
const num = (v: number) => String(Math.round(v * 100) / 100);
const whole = (v: number) => String(Math.round(v));
const BOUND: readonly SkeletonRole[] = ['value', 'total'];

/** What follows a control or a cell: its words or its field, and its colours. */
function extrasOf(key: string, role: SkeletonRole, given: DraftGiven): string {
  const parts: string[] = [];
  if (BOUND.includes(role)) {
    const field = given.fields.get(key);
    if (field) parts.push(`[${field}]`);
  } else if (role !== 'decoration') {
    const words = given.words.get(key);
    if (words) parts.push(JSON.stringify(words));
  }
  const colours = given.colours.get(key);
  if (colours?.fill) parts.push(`fill=${colours.fill}`);
  if (colours?.ink) parts.push(`ink=${colours.ink}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/** A draft as the text the AI is given to correct: the skeleton, with its words, fields and colours. */
export function draftToText(k: ReportSkeleton, given: DraftGiven): string {
  const m = k.margins;
  const lines = [`page ${k.paper} ${k.landscape ? 'landscape' : 'portrait'} ${whole(k.width)} ${whole(k.height)} ${whole(m.top)} ${whole(m.bottom)} ${whole(m.left)} ${whole(m.right)}`];
  k.bands.forEach((b, bi) => {
    const groups = given.groups.get(bi) ?? [];
    lines.push(`band ${b.kind} ${whole(b.height)} ${Math.max(b.groupFields, groups.length)}${groups.map((g) => ` [${g}]`).join('')}`);
    b.controls.forEach((c, ci) => {
      const key = placeKey(bi, ci);
      const chars = given.words.get(key)?.length ?? c.chars;
      lines.push(`${c.kind} ${c.role} ${whole(c.x)} ${whole(c.y)} ${whole(c.w)} ${whole(c.h)} ${fontToken(c.font)} ${ALIGN[c.align]} ${c.borders} ${chars}${extrasOf(key, c.role, given)}`);
      (c.rows ?? []).forEach((row, ri) => {
        const cells = row.map((cell, k2) => {
          const cellKey = placeKey(bi, ci, ri, k2);
          const cellChars = given.words.get(cellKey)?.length ?? cell.chars;
          return `${cell.role} ${num(cell.weight)} ${fontToken(cell.font)} ${ALIGN[cell.align]} ${cellChars}${extrasOf(cellKey, cell.role, given)}`;
        });
        lines.push(`row ${cells.join(' | ')}`);
      });
    });
  });
  return lines.join('\n');
}

export interface DraftReading {
  /** Null only when the text has no page line. */
  skeleton: ReportSkeleton | null;
  given: DraftGiven;
  /** One entry per line, or per cell, that was skipped. */
  problems: string[];
}

/** A quoted text, a bracketed field, a cell separator, or any other run of characters. */
const TOKEN = /"(?:[^"\\]|\\.)*"|\[[^\]]*\]|\||[^\s|"[\]]+/g;

const isExtra = (t: string) => t.startsWith('"') || t.startsWith('[') || /^(fill|ink)=/.test(t);
const HEX = /^#[0-9a-fA-F]{6}$/;
const isNum = (t: string | undefined) => t !== undefined && t !== '' && Number.isFinite(Number(t));

/** Put what follows a control or a cell into `given`, as its role allows. */
function readExtras(tokens: readonly string[], key: string, role: SkeletonRole, given: DraftGiven): void {
  for (const t of tokens) {
    if (t.startsWith('"')) {
      if (BOUND.includes(role) || role === 'decoration') continue;
      try {
        const words = String(JSON.parse(t)).replace(/\s+/g, ' ').trim();
        if (words) given.words.set(key, words);
      } catch {
        // A quote the model did not close properly: its words stay OCR's.
      }
    } else if (t.startsWith('[')) {
      const field = t.slice(1, -1).trim();
      if (field && BOUND.includes(role)) given.fields.set(key, field);
    } else {
      const [name, value] = t.split('=');
      if (!HEX.test(value ?? '')) continue;
      const colours = given.colours.get(key) ?? {};
      if (name === 'fill') colours.fill = value.toUpperCase();
      if (name === 'ink') colours.ink = value.toUpperCase();
      given.colours.set(key, colours);
    }
  }
}

/**
 * The plain tokens of a control or a cell, up to `count`, and what follows
 * them. A length left out before the extras is taken as 0.
 */
function split(tokens: readonly string[], count: number): { base: string[]; extras: string[] } {
  const first = tokens.findIndex(isExtra);
  const plain = first < 0 ? [...tokens] : tokens.slice(0, first);
  const extras = first < 0 ? [] : tokens.slice(first).filter(isExtra);
  if (plain.length === count - 1) plain.push('0');
  return { base: plain.slice(0, count), extras };
}

/** The draft the AI wrote back, read as a skeleton and what it says outright. Tolerant: see the module comment. */
export function textToDraft(text: string): DraftReading {
  const problems: string[] = [];
  const given = noneGiven();
  let page: Omit<ReportSkeleton, 'bands'> | null = null;
  const bands: SkeletonBand[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const at = `line ${i + 1}`;
    if (!line || line.startsWith('```')) continue;
    const tokens = line.match(TOKEN) ?? [];
    const head = tokens[0];
    if (head === 'page') {
      const read = readPage(tokens.slice(0, 9));
      if (read) page = read;
      else problems.push(`${at}: a page line needs a paper, an orientation and six numbers`);
    } else if (head === 'band') {
      if (!isBandKind(tokens[1] ?? '') || !isNum(tokens[2])) {
        problems.push(`${at}: a band line needs a band kind and a height`);
        continue;
      }
      const groups = tokens.slice(3).filter((t) => t.startsWith('[')).map((t) => t.slice(1, -1).trim()).filter(Boolean);
      const count = isNum(tokens[3]) ? Number(tokens[3]) : 0;
      bands.push({ kind: tokens[1] as SkeletonBand['kind'], height: Number(tokens[2]), groupFields: Math.max(count, groups.length), controls: [] });
      if (groups.length) given.groups.set(bands.length - 1, groups);
    } else if (head === 'row') {
      const band = bands.length - 1;
      const table = bands[band]?.controls.at(-1);
      if (!table || table.kind !== 'table') {
        problems.push(`${at}: a row line must follow a table`);
        continue;
      }
      const row = table.rows!.length;
      const cellTokens: string[][] = [[]];
      for (const t of tokens.slice(1)) {
        if (t === '|') cellTokens.push([]);
        else cellTokens.at(-1)!.push(t);
      }
      const cells = [];
      for (const [k2, ct] of cellTokens.entries()) {
        const { base, extras } = split(ct, 5);
        const cell = readCell(base);
        if (!cell) {
          problems.push(`${at}: cell ${k2 + 1} needs a role, a weight, a font, an alignment and a length`);
          cells.length = 0;
          break;
        }
        readExtras(extras, placeKey(band, bands[band].controls.length - 1, row, cells.length), cell.role, given);
        const words = given.words.get(placeKey(band, bands[band].controls.length - 1, row, cells.length));
        if (words) cell.chars = words.length;
        cells.push(cell);
      }
      if (cells.length) table.rows!.push(cells);
    } else if (isControlKind(head ?? '')) {
      const band = bands.length - 1;
      if (band < 0) {
        problems.push(`${at}: a control before any band`);
        continue;
      }
      const { base, extras } = split(tokens, 10);
      const control = readControl(base);
      if (!control) {
        problems.push(`${at}: a control needs a kind, a role, four numbers, a font, an alignment, borders and a length`);
        continue;
      }
      const key = placeKey(band, bands[band].controls.length);
      readExtras(extras, key, control.role, given);
      const words = given.words.get(key);
      if (words) control.chars = words.length;
      bands[band].controls.push(control);
    } else {
      problems.push(`${at}: not understood`);
    }
  }
  if (!page) return { skeleton: null, given, problems: [...problems, 'no page line'] };
  return { skeleton: { ...page, bands }, given, problems };
}

/**
 * What the AI is told about the format and about a good draft, ahead of the
 * draft itself (geminiService.ts builds the request). Short on purpose: the
 * mega-prompt that designs a REPX from nothing is about 13,000 tokens, and
 * the point of this path is not to send it. What the REPX needs beyond the
 * draft, the builder writes: Refs, Dpi, PaperKind, bindings and summaries.
 */
export const CORRECTION_RULES = `You are correcting Forma's draft of a DevExpress report, made from the attached picture of a report page.
Forma read the page with OCR and put each text in a band with a role. That draft is below. It is a starting point and is often wrong: compare it with the picture and write the corrected draft of the whole page. Answer with the draft format alone: no XML, no JSON, no explanation, no code fences.

THE FORMAT, one line each. Lengths are whole hundredths of an inch. A control's x and y are measured from its band's top left corner, and x starts at the left margin.
page PAPER ORIENTATION WIDTH HEIGHT TOP BOTTOM LEFT RIGHT
  PAPER is A4, Letter, Legal, A5, A3, Executive or Custom; ORIENTATION is portrait or landscape; the last four are the margins.
band KIND HEIGHT GROUPS [Field]...
  KIND, in print order: TopMargin, ReportHeader, PageHeader, GroupHeader, Detail, GroupFooter, ReportFooter, PageFooter, BottomMargin. GROUPS is how many fields a GroupHeader breaks on, 0 for any other band, followed by those fields.
CONTROL ROLE X Y W H FONT ALIGN BORDERS LENGTH, then "words" or [Field], then fill=#RRGGBB and ink=#RRGGBB when coloured
  CONTROL: label, table, line, pageInfo, picture, shape, barcode, chart, checkbox.
  ROLE: title, caption (fixed words), value (a field of the record), total (sums its field over its band), pageInfo, decoration.
  FONT: family:points, then b for bold and i for italic, spaces in the family as _: Arial:9, Times_New_Roman:12b. A dash for none.
  ALIGN: l, c or r. BORDERS: top 1 + right 2 + bottom 4 + left 8, 0 for none. LENGTH: how many characters its words have, 0 for a field.
  A title or a caption carries its "words" in double quotes. A value or a total carries its [Field]: letters and digits, no spaces, named after its column heading or caption (Amount, UnitPrice, InvoiceNo).
row CELL | CELL | ...   one line per row of the table just above it
  CELL: ROLE WEIGHT FONT ALIGN LENGTH, then "words" or [Field]. WEIGHT is the cell's share of the table's width.

WHAT A GOOD DRAFT IS:
- Repeating rows (line items, a list of customers) are ONE record: a Detail band holding one table of ONE row of values, each with its [Field]. Their column headings are a PageHeader table of ONE row of captions with the same x, width and cell weights, so the columns line up. Never list the source's rows one by one.
- Fixed text above the records, titles, addresses and the labels of an invoice's details, goes in ReportHeader. Text that changes from one document to the next, an invoice number or a customer's name and address, is a value with a [Field].
- Subtotals, tax, totals and closing text after the records go in ReportFooter; a total of a Detail column is role total with that column's [Field]. Rows broken into runs by a shared value get a GroupHeader with GROUPS 1 and its [Field], and a GroupFooter for totals per group, only when the picture shows the break.
- A page number or a printed date is a pageInfo in PageFooter.
- Keep OCR's words where they are right and correct what it misread from the picture. Leave out text the page does not show.
- Add what OCR cannot see: rules as line, boxed areas as BORDERS, shaded areas as fill=, coloured text as ink=, logos, stamps and signatures as picture.
- FONT is the em size in points, not the height of the ink: capitals stand about 70% of it. Body text in a printed business document is usually 9 to 11pt.
- Every control fits inside its band and the printable width, and every band is as tall as what it holds.`;

/** How many controls a skeleton holds, tables counted once. */
export const controlCount = (k: ReportSkeleton | null): number => (k ? k.bands.reduce((s, b) => s + b.controls.length, 0) : 0);
