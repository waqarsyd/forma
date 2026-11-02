/**
 * A report designed by Forma's own model, with no AI service, no key and no
 * quota (2026-11-02, milestone 2 of docs/proposals/own-model.md).
 *
 * A request's words choose what kind of report it is, and the model's house
 * style decides how it looks:
 * - **Reading the words** (`readRequest`): the category they name (invoice,
 *   payroll, stock…), the columns they list or the fields of a pasted schema,
 *   what they group by, whether they total, whether the page turns.
 * - **Choosing the pattern**: the model's archetypes ranked by
 *   `rankArchetypes`. The best one gives the paper and orientation, the
 *   bands a report of its kind has (a title, a page footer with page
 *   numbers), and whether its heading is ruled.
 * - **Writing the report**: a title, a heading row of captions, a record row
 *   of bound values, and when asked a group header and footer and a grand
 *   total. Sizes, faces and boldness come from the house style the model
 *   learned, the margins from its paper's median. The columns share the
 *   printable width by what they hold, text wider than numbers.
 *
 * The result fills every pane a generated report does: the `.repx`, the
 * Mockup's layout and the spec. It is honest about its limits: it designs a
 * new report from words, and does not read a picture's design (OCR does) or
 * refine an open report.
 */
import { categoryOf, rankArchetypes, type Archetype, type FormaModel } from './formaModel';
import { ensureUniqueRefs } from './repxRefs';
import { repairDpi } from './repxDpi';
import { repairPaper } from './repxPaper';
import { pointsToUnits } from './reportGeometry';
import type { ReportElement, ReportLayout, ReportSection } from './reportTypes';

export type OfflineFieldType = 'text' | 'number' | 'date' | 'boolean';

export interface OfflineField {
  name: string;
  type: OfflineFieldType;
}

export interface OfflineRequest {
  /** The words of the request. */
  description: string;
  title?: string;
  /** A pasted schema's fields, which win over any the words list. */
  fields?: OfflineField[];
  /** Remembered preferences (the memory feature): these win over the pattern. */
  preferences?: { paper?: string; landscape?: boolean; fontFamily?: string; sizes?: Partial<Record<'title' | 'caption' | 'value' | 'total', number>> };
}

export interface OfflineDesign {
  title: string;
  repx: string;
  layout: ReportLayout;
  markdown: string;
  archetype: { id: string; label: string };
  fields: OfflineField[];
  groupBy: string | null;
  totals: string[];
}

/**
 * With no key, the words that make a message a report request for Forma's own
 * model; anything else is answered with OFFLINE_HELP, since there is no model
 * to talk to. Here rather than in App.tsx, so the entry chunk carries none of it.
 */
const OFFLINE_REQUEST = /\b(create|build|make|design|generate|produce|draft|prepare|report|list|register|invoice|statement|label|labels|payslip|ledger|columns?|fields?|grouped|table)\b/i;

export const isOfflineRequest = (message: string) => OFFLINE_REQUEST.test(message);

export const OFFLINE_HELP =
  "Forma is working offline, with its own model and no AI key. It designs a report from your words, " +
  'for example "a stock register grouped by warehouse with totals", or "an invoice with columns item, quantity, price and amount", ' +
  "and builds one from an image's text, read by OCR in your browser. To ask questions or to have a picture's design read by AI, add a free Gemini key in Settings.";

export const OFFLINE_NEEDS_MODEL =
  "Without an AI key, Forma builds a report from an image's text, read by OCR in your browser, and designs one from your words. " +
  "A PDF's text and an attached .repx need an AI provider: add a free Gemini key in Settings.";

/** What the thread says of a report designed offline. */
export function designedReply(design: OfflineDesign): string {
  const columns = design.fields.filter((f) => f.name !== design.groupBy).length;
  return (
    `Designed "${design.title}" with Forma's own model, offline and with no key: the pattern of its ${design.archetype.label.toLowerCase()} reports, ` +
    `${columns} column${columns === 1 ? '' : 's'}${design.groupBy ? `, grouped by ${design.groupBy}` : ''}${design.totals.length ? ', with totals' : ''}. ` +
    'Bind your data in the Data tab. For a design read from a picture or a PDF, add a free Gemini key in Settings.'
  );
}

/** Words that name a kind of report rather than a thing it lists. */
const REPORT_KINDS = /^(stock|inventory|payroll|salary|sales|account|accounts|ledger|invoice|invoices|label|labels|cheque|cheques|catalogue|catalog|production|manufacturing|document|documents|purchase|order|orders)$/i;

/** What a request's words ask for. */
export interface RequestReading {
  category: string | null;
  /** Columns the words list, or a list's subject and measures; empty when they list none. */
  columns: string[];
  /** The group field and measures the words name, which join a category's usual columns. */
  extras: string[];
  groupBy: string | null;
  totals: boolean;
  landscape: boolean | null;
  label: boolean;
}

/** The fields a report of a category usually has, when the request names none. Forma's own vocabulary. */
const DEFAULT_FIELDS: Record<string, string[]> = {
  document: ['Item', 'Description', 'Quantity', 'Unit Price', 'Amount'],
  payroll: ['Employee', 'Department', 'Basic Salary', 'Allowances', 'Deductions', 'Net Pay'],
  stock: ['Item', 'Warehouse', 'Opening', 'Received', 'Issued', 'Balance'],
  sales: ['Date', 'Customer', 'Product', 'Quantity', 'Amount'],
  accounts: ['Date', 'Account', 'Description', 'Debit', 'Credit', 'Balance'],
  manufacturing: ['Job Number', 'Item', 'Quantity', 'Weight', 'Status'],
  label: ['Name', 'Code', 'Price'],
  cheque: ['Payee', 'Amount', 'Date'],
  catalogue: ['Item', 'Description', 'Price'],
};
const FALLBACK_FIELDS = ['Name', 'Description', 'Value'];

/** A field name as a report binds it: words joined, each capitalised, nothing but letters and digits. */
export function fieldName(words: string): string {
  const name = words
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  return /^\p{N}/u.test(name) ? `F${name}` : name || 'Field';
}

/** A field's caption: its name's words, spaced. */
export function captionOf(name: string): string {
  return name.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
}

/** What a field holds, guessed from its name. */
export function guessType(name: string): OfflineFieldType {
  const n = name.toLowerCase();
  if (/date|day\b|month|year|time|period/.test(n)) return 'date';
  if (/amount|total|price|qty|quantity|balance|debit|credit|weight|rate|tax|cost|value|net|gross|salary|pay\b|allowance|deduction|opening|received|issued|count|percent|discount|sum|stock\b/.test(n)) return 'number';
  if (/^(is|has)[A-Z]|active|paid\b|approved/.test(name)) return 'boolean';
  return 'text';
}

const LEADING = /^(please\s+)?(create|build|make|design|generate|produce|draft|prepare|give me|i need|i want|show)\s+(me\s+)?(a|an|the)?\s*/i;

/** Read a request's words. */
export function readRequest(description: string): RequestReading {
  const d = description.trim();
  const lower = d.toLowerCase();
  const group = /\b(?:grouped|group|sorted|broken down|split)\s+(?:by|per)\s+([\p{L}\p{N} ]+?)(?=[,.;]|\s+(?:with|and|showing|including|listing)\b|$)/iu.exec(d) ?? /\bper\s+([\p{L}]+)/iu.exec(d);
  const list = /\b(?:columns?|fields?|showing|listing|including|with)\s*:?\s+([^.;\n]+)/i.exec(d);
  let columns: string[] = [];
  if (list) {
    columns = list[1]
      .replace(/^(the\s+)?(columns?|fields?)\s*:?\s+/i, '')
      .replace(/\b(grouped|group|sorted)\s+(by|per)\b.*$/i, '')
      .replace(/\b(a|an|the|each|its|their)\s+/gi, '')
      .split(/\s*,\s*|\s+and\s+|\s*&\s*/)
      .map((s) => s.replace(/\b(total|totals|subtotals?)\b.*$/i, '').trim())
      .filter((s) => s && s.split(/\s+/).length <= 4 && !/^(a|per|by)$/i.test(s) && !/^(our|my|all|every|some)\b/i.test(s));
    // One item is a phrase, not a list of columns ("listing our orders").
    if (columns.length < 2) columns = [];
  }
  const groupBy = group ? group[1].trim().replace(/^(the|each)\s+/i, '') : null;
  // What the words name besides a list: the field they group by and the
  // measures they mention, which a category's usual columns are joined by.
  const measures = [...lower.matchAll(/\b(balance|amount|quantity|qty|price|salary|weight|debit|credit|date|address|email|phone|status|code|description|department|warehouse|value)\b/g)].map((m) => m[1]);
  const unique = (words: string[]) => [...new Map(words.map((w) => [w.toLowerCase(), w])).values()];
  const extras = unique([...(groupBy ? [groupBy] : []), ...measures]);
  if (!columns.length) {
    // No list: the thing the report is a list of, and the measures the words
    // name ("a customer list with each balance" is Customer and Balance). A
    // subject that is a kind of report ("a stock register") is not a column:
    // that kind's usual columns are, joined by the extras.
    const subject = /\b([\p{L}]+)\s+(?:list|register|listing|directory)\b/iu.exec(d)?.[1];
    const vague = /^(a|an|the|our|my|price|report|full|complete|simple|daily|weekly|monthly|yearly|annual|new)$/i;
    if (subject && !vague.test(subject) && !REPORT_KINDS.test(subject)) {
      const named = unique([subject, ...extras]);
      if (named.length >= 2) columns = named;
    }
  }
  return {
    category: categoryOf(lower),
    columns,
    extras,
    groupBy,
    totals: /\b(total|totals|sum|subtotal|grand total)\b/.test(lower),
    landscape: /\blandscape\b|\bwide\b/.test(lower) ? true : /\bportrait\b/.test(lower) ? false : null,
    label: /\b(label|labels|sticker|tag)\b/.test(lower),
  };
}

/**
 * A title from the words when the request gives none: what comes before the
 * first "grouped by", "with", "showing"…, up to eight words, capitalised. A
 * bare "Report" takes what it lists ("a report listing our orders" is
 * "Orders Report").
 */
export function titleFrom(description: string): string {
  const head = description
    .replace(LEADING, '')
    .replace(/^(a|an|the)\s+/i, '')
    .split(/[.,;:\n]/)[0]
    .replace(/\s+(grouped|sorted|with|showing|listing|including|containing|for each|per|that|which)\b.*$/i, '')
    .trim();
  const listed = /\blisting\s+(?:our|all|the|my)?\s*([\p{L}]+(?:\s[\p{L}]+)?)/iu.exec(description)?.[1];
  const words = (/^reports?$/i.test(head) && listed ? `${listed} report` : head).split(/\s+/).slice(0, 8);
  const title = words.map((w, i) => (i > 0 && /^(of|by|for|and|per|with|the|a|an|in|on)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  return title || 'Report';
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = (v: number) => String(Math.round(v * 100) / 100);

interface Style {
  family: string;
  title: { size: number; bold: boolean };
  caption: { size: number; bold: boolean };
  value: { size: number; bold: boolean };
  total: { size: number; bold: boolean };
  page: { size: number; bold: boolean };
}

function styleOf(model: FormaModel, prefs?: OfflineRequest['preferences']): Style {
  const r = model.style.roles;
  // A remembered size (memory.ts) wins over the house style's.
  const role = (k: keyof typeof r, size: number, bold: boolean) => ({
    size: prefs?.sizes?.[k as 'title'] ?? r[k]?.size ?? size,
    bold: r[k] ? r[k]!.bold >= 0.5 : bold,
  });
  return {
    family: prefs?.fontFamily || r.value?.family || model.style.fonts[0]?.family || 'Arial',
    title: role('title', 14, true),
    caption: role('caption', 9, true),
    value: role('value', 8, false),
    total: role('total', 8, true),
    page: role('pageInfo', 8, false),
  };
}

/** The page of a paper name, hundredths of an inch, turned when landscape. */
function pageOf(paper: string, landscape: boolean, fallback: { width: number; height: number }) {
  const sizes: Record<string, [number, number]> = { A4: [827, 1169], Letter: [850, 1100], Legal: [850, 1400], A5: [583, 827], A3: [1169, 1654], Executive: [725, 1050] };
  const s = sizes[paper];
  if (!s) return fallback;
  return landscape ? { width: s[1], height: s[0] } : { width: s[0], height: s[1] };
}

/** Does the archetype rule a line under its heading: a line, or a bottom border, in a report or page header? */
const rulesHeading = (a: Archetype) =>
  a.skeleton.bands.some((b) => (b.kind === 'ReportHeader' || b.kind === 'PageHeader') && b.controls.some((c) => c.kind === 'line' || (c.borders & 4) !== 0));

/** Does the archetype print page information (a page number, a date)? */
const printsPageInfo = (a: Archetype) => a.skeleton.bands.some((b) => b.controls.some((c) => c.kind === 'pageInfo'));

/** Each column's share of the printable width, by what it holds. */
function columnWidths(fields: OfflineField[], width: number): number[] {
  const weight = (f: OfflineField) =>
    f.type === 'number' ? 1 : f.type === 'date' ? 1.1 : f.type === 'boolean' ? 0.6 : /description|name|address|remark|note|customer|employee|item|product|payee/i.test(f.name) ? 2.4 : 1.6;
  const total = fields.reduce((s, f) => s + weight(f), 0) || 1;
  const widths = fields.map((f) => Math.floor((weight(f) / total) * width * 100) / 100);
  widths[widths.length - 1] = Math.round((width - widths.slice(0, -1).reduce((s, w) => s + w, 0)) * 100) / 100;
  return widths;
}

/** Design a report from a request with the model alone. */
export function generateOffline(model: FormaModel, request: OfflineRequest): OfflineDesign {
  const reading = readRequest(request.description);
  const usual = DEFAULT_FIELDS[reading.category ?? ''] ?? FALLBACK_FIELDS;
  const named = reading.columns.length
    ? reading.columns
    : [...usual, ...reading.extras.filter((e) => !usual.some((u) => fieldName(u).toLowerCase() === fieldName(e).toLowerCase()))];
  const fields: OfflineField[] = request.fields?.length
    ? request.fields
    : named.map((c) => {
        const name = fieldName(c);
        return { name, type: guessType(name) };
      });
  let groupBy: string | null = null;
  if (reading.groupBy) {
    const wanted = fieldName(reading.groupBy);
    groupBy = fields.find((f) => f.name.toLowerCase() === wanted.toLowerCase() || f.name.toLowerCase().includes(wanted.toLowerCase()))?.name ?? wanted;
  }
  const lineFields = fields.filter((f) => f.name !== groupBy);
  const totals = reading.totals || groupBy ? lineFields.filter((f) => f.type === 'number' && !/price|rate|percent|opening/i.test(f.name)).map((f) => f.name) : [];

  const archetype = rankArchetypes(model, {
    category: reading.category,
    grouped: groupBy !== null,
    totals: totals.length > 0,
    landscape: reading.landscape ?? undefined,
    label: reading.label || undefined,
    columns: lineFields.length,
  })[0];
  const style = styleOf(model, request.preferences);
  const paper = request.preferences?.paper ?? archetype.skeleton.paper;
  const landscape = request.preferences?.landscape ?? reading.landscape ?? (lineFields.length > 7 ? true : archetype.skeleton.landscape);
  const page = pageOf(paper, landscape, { width: archetype.skeleton.width, height: archetype.skeleton.height });
  const margins = model.style.margins[paper] ?? archetype.skeleton.margins;
  const printable = Math.max(200, page.width - margins.left - margins.right);
  const title = request.title?.trim() || titleFrom(request.description);
  const rowH = Math.max(18, Math.min(30, Math.round(model.style.rowHeight)));
  const widths = columnWidths(lineFields, printable);
  const font = (s: { size: number; bold: boolean }) => `${style.family}, ${n2(s.size)}pt${s.bold ? ', style=Bold' : ''}`;
  const lineHeight = (s: { size: number }) => Math.round(pointsToUnits(s.size, 'HundredthsOfAnInch') * 1.6 + 4);

  let ref = 0;
  const next = () => ++ref;
  const binding = (expression: string) => `<ExpressionBindings><Item1 Ref="${next()}" EventName="BeforePrint" PropertyName="Text" Expression="${attr(expression)}" /></ExpressionBindings>`;
  const format = (f: OfflineField) => (f.type === 'number' ? ' TextFormatString="{0:n2}"' : f.type === 'date' ? ' TextFormatString="{0:dd/MM/yyyy}"' : '');
  const align = (f: OfflineField) => (f.type === 'number' ? 'MiddleRight' : f.type === 'boolean' ? 'MiddleCenter' : 'MiddleLeft');

  const tableRow = (name: string, height: number, cells: string[], y = 0, borders = '') =>
    `<Item1 Ref="${next()}" ControlType="XRTable" Name="${name}Table" LocationFloat="0,${n2(y)}" SizeF="${n2(printable)},${n2(height)}"${borders}><Rows><Item1 Ref="${next()}" ControlType="XRTableRow" Name="${name}Row" Weight="1"><Cells>${cells.map((c, k) => c.replace('<Cell', `<Item${k + 1}`).replace('</Cell>', `</Item${k + 1}>`)).join('')}</Cells></Item1></Rows></Item1>`;
  const cell = (name: string, k: number, inner: { text?: string; expression?: string; summary?: 'Group' | 'Report'; field?: OfflineField; role: { size: number; bold: boolean }; alignTo?: string }) =>
    `<Cell Ref="${next()}" ControlType="XRTableCell" Name="${name}${k + 1}" Weight="${n2(widths[k])}"` +
    `${inner.text !== undefined ? ` Text="${attr(inner.text)}"` : ''} Font="${font(inner.role)}" TextAlignment="${inner.alignTo ?? (inner.field ? align(inner.field) : 'MiddleLeft')}" Padding="4,4,0,0,100"` +
    `${inner.field && inner.expression ? format(inner.field) : ''}>` +
    `${inner.summary ? `<Summary Ref="${next()}" Running="${inner.summary}" />` : ''}${inner.expression ? binding(inner.expression) : ''}</Cell>`;

  const bands: string[] = [];
  const sections: ReportSection[] = [];
  const add = (xml: string) => bands.push(xml.replace('<Band', `<Item${bands.length + 1}`).replace('</Band>', `</Item${bands.length + 1}>`).replace(/<Band(\s[^>]*)\/>/, `<Item${bands.length + 1}$1/>`));
  const unitSize = (s: { size: number }) => Math.round(pointsToUnits(s.size, 'HundredthsOfAnInch') * 100) / 100;

  // Report header: the title, ruled when the pattern rules its heading.
  const titleH = lineHeight(style.title) + 6;
  const ruled = rulesHeading(archetype);
  const headerH = titleH + (ruled ? 8 : 4);
  add(`<Band Ref="${next()}" ControlType="TopMarginBand" Name="TopMargin" HeightF="${n2(margins.top)}" />`);
  add(
    `<Band Ref="${next()}" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="${n2(headerH)}"><Controls>` +
      `<Item1 Ref="${next()}" ControlType="XRLabel" Name="titleLabel" Text="${attr(title)}" Font="${font(style.title)}" TextAlignment="MiddleCenter" LocationFloat="0,0" SizeF="${n2(printable)},${n2(titleH)}" Padding="2,2,0,0,100" />` +
      (ruled ? `<Item2 Ref="${next()}" ControlType="XRLine" Name="titleRule" LocationFloat="0,${n2(titleH + 2)}" SizeF="${n2(printable)},4" />` : '') +
      `</Controls></Band>`,
  );
  sections.push({
    id: 'report-header',
    name: 'Report header',
    type: 'header',
    height: headerH,
    elements: [
      { id: 'titleLabel', type: 'label', content: title, x: 0, y: 0, width: printable, height: titleH, fontSize: unitSize(style.title), bold: style.title.bold, textAlign: 'center', fontFamily: style.family },
      ...(ruled ? [{ id: 'titleRule', type: 'line' as const, content: '', x: 0, y: titleH + 2, width: printable, height: 4 }] : []),
    ],
  });

  // Page header: a caption over each column, ruled beneath.
  const headH = Math.max(rowH, lineHeight(style.caption));
  add(
    `<Band Ref="${next()}" ControlType="PageHeaderBand" Name="PageHeader" HeightF="${n2(headH)}"><Controls>` +
      tableRow('heading', headH, lineFields.map((f, k) => cell('headingCell', k, { text: captionOf(f.name), role: style.caption, alignTo: f.type === 'number' ? 'MiddleRight' : 'MiddleLeft' })), 0, ' Borders="Bottom"') +
      `</Controls></Band>`,
  );
  const tableElement = (id: string, height: number, contents: string[], s: { size: number; bold: boolean }): ReportElement => ({
    id,
    type: 'table',
    content: '',
    x: 0,
    y: 0,
    width: printable,
    height,
    fontSize: unitSize(s),
    bold: s.bold,
    fontFamily: style.family,
    rows: [{ weight: 1, cells: contents.map((content, k) => ({ content, weight: widths[k] })) }],
  });
  sections.push({ id: 'page-header', name: 'Page header', type: 'header', height: headH, elements: [{ ...tableElement('headingTable', headH, lineFields.map((f) => captionOf(f.name)), style.caption), borderBottom: true }] });

  // A group header naming the group, when the words group.
  if (groupBy) {
    const groupH = Math.max(rowH, lineHeight(style.caption)) + 4;
    const caption = `${captionOf(groupBy)}:`;
    const capW = Math.min(printable / 3, Math.max(80, caption.length * 7));
    add(
      `<Band Ref="${next()}" ControlType="GroupHeaderBand" Name="GroupHeader1" HeightF="${n2(groupH)}"><GroupFields><Item1 Ref="${next()}" FieldName="${attr(groupBy)}" /></GroupFields><Controls>` +
        `<Item1 Ref="${next()}" ControlType="XRLabel" Name="groupCaption" Text="${attr(caption)}" Font="${font(style.caption)}" TextAlignment="MiddleLeft" LocationFloat="0,2" SizeF="${n2(capW)},${n2(groupH - 4)}" Padding="4,4,0,0,100" />` +
        `<Item2 Ref="${next()}" ControlType="XRLabel" Name="groupValue" Font="${font({ size: style.caption.size, bold: true })}" TextAlignment="MiddleLeft" LocationFloat="${n2(capW)},2" SizeF="${n2(printable - capW)},${n2(groupH - 4)}" Padding="4,4,0,0,100">${binding(`[${groupBy}]`)}</Item2>` +
        `</Controls></Band>`,
    );
    sections.push({
      id: 'group-header',
      name: `Group header: ${captionOf(groupBy)}`,
      type: 'group',
      height: groupH,
      elements: [
        { id: 'groupCaption', type: 'label', content: caption, x: 0, y: 2, width: capW, height: groupH - 4, fontSize: unitSize(style.caption), bold: true, fontFamily: style.family },
        { id: 'groupValue', type: 'label', content: `[${groupBy}]`, x: capW, y: 2, width: printable - capW, height: groupH - 4, fontSize: unitSize(style.caption), bold: true, fontFamily: style.family },
      ],
    });
  }

  // Detail: a bound value in each column.
  add(
    `<Band Ref="${next()}" ControlType="DetailBand" Name="Detail" HeightF="${n2(rowH)}"><Controls>` +
      tableRow('detail', rowH, lineFields.map((f, k) => cell('valueCell', k, { expression: `[${f.name}]`, field: f, role: style.value }))) +
      `</Controls></Band>`,
  );
  sections.push({ id: 'detail', name: 'Detail', type: 'detail', height: rowH, elements: [tableElement('detailTable', rowH, lineFields.map((f) => `[${f.name}]`), style.value)] });

  // Totals: a row under each group and one at the end of the report.
  const totalCells = (name: string, scope: 'Group' | 'Report', caption: string) =>
    lineFields.map((f, k) =>
      totals.includes(f.name)
        ? cell(name, k, { expression: `sumSum([${f.name}])`, summary: scope, field: f, role: style.total })
        : cell(name, k, { text: k === 0 ? caption : '', role: style.total }),
    );
  const totalContents = (caption: string) => lineFields.map((f, k) => (totals.includes(f.name) ? `sum [${f.name}]` : k === 0 ? caption : ''));
  if (groupBy && totals.length) {
    add(`<Band Ref="${next()}" ControlType="GroupFooterBand" Name="GroupFooter1" HeightF="${n2(rowH + 4)}"><Controls>${tableRow('groupTotal', rowH, totalCells('groupTotalCell', 'Group', 'Total'), 2, ' Borders="Top"')}</Controls></Band>`);
    sections.push({ id: 'group-footer', name: 'Group footer', type: 'group', height: rowH + 4, elements: [{ ...tableElement('groupTotalTable', rowH, totalContents('Total'), style.total), borderTop: true }] });
  }
  if (totals.length) {
    add(`<Band Ref="${next()}" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="${n2(rowH + 8)}"><Controls>${tableRow('grandTotal', rowH, totalCells('grandTotalCell', 'Report', 'Grand total'), 4, ' Borders="Top,Bottom"')}</Controls></Band>`);
    sections.push({ id: 'report-footer', name: 'Report footer', type: 'footer', height: rowH + 8, elements: [{ ...tableElement('grandTotalTable', rowH, totalContents('Grand total'), style.total), borderTop: true, borderBottom: true }] });
  }

  // Page footer: always the page number, and the date too when reports of
  // this kind print page information.
  {
    const pageH = lineHeight(style.page) + 4;
    const half = printable / 2;
    const dated = printsPageInfo(archetype);
    add(
      `<Band Ref="${next()}" ControlType="PageFooterBand" Name="PageFooter" HeightF="${n2(pageH)}"><Controls>` +
        (dated ? `<Item1 Ref="${next()}" ControlType="XRPageInfo" Name="printedOn" PageInfo="DateTime" TextFormatString="{0:dd/MM/yyyy}" Font="${font(style.page)}" TextAlignment="MiddleLeft" LocationFloat="0,2" SizeF="${n2(half)},${n2(pageH - 4)}" />` : '') +
        `<Item2 Ref="${next()}" ControlType="XRPageInfo" Name="pageNumber" TextFormatString="Page {0} of {1}" Font="${font(style.page)}" TextAlignment="MiddleRight" LocationFloat="${n2(half)},2" SizeF="${n2(half)},${n2(pageH - 4)}" />` +
        `</Controls></Band>`,
    );
    sections.push({
      id: 'page-footer',
      name: 'Page footer',
      type: 'footer',
      height: pageH,
      elements: [
        ...(dated ? [{ id: 'printedOn', type: 'label' as const, content: 'dd/mm/yyyy', x: 0, y: 2, width: half, height: pageH - 4, fontSize: unitSize(style.page), fontFamily: style.family }] : []),
        { id: 'pageNumber', type: 'label', content: 'Page 1 of 1', x: half, y: 2, width: half, height: pageH - 4, fontSize: unitSize(style.page), textAlign: 'right', fontFamily: style.family },
      ],
    });
  }
  add(`<Band Ref="${next()}" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="${n2(margins.bottom)}" />`);

  const xml =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    `<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a"` +
    ` Name="${attr(fieldName(title))}" ReportUnit="HundredthsOfAnInch" Margins="${n2(margins.left)}, ${n2(margins.right)}, ${n2(margins.top)}, ${n2(margins.bottom)}"` +
    ` PageWidth="${n2(page.width)}" PageHeight="${n2(page.height)}" Version="20.1" Font="${font(style.value)}"><Bands>${bands.join('')}</Bands></XtraReportsLayoutSerializer>`;
  let repx = xml;
  for (const pass of [ensureUniqueRefs, repairDpi, repairPaper]) {
    const r = pass(repx);
    if (r.applied) repx = r.xml;
  }

  const markdown = [
    `# ${title}`,
    '',
    `Designed by Forma's own model, with no AI service: the pattern of its **${archetype.label.toLowerCase()}** reports` +
      ` (${Math.round(archetype.share * 100)}% of the reports it learned from) in their house style, on ${paper}${landscape ? ' landscape' : ''}.`,
    '',
    '| Column | Field | Holds |',
    '| --- | --- | --- |',
    ...lineFields.map((f) => `| ${captionOf(f.name)} | \`[${f.name}]\` | ${f.type}${totals.includes(f.name) ? ', totalled' : ''} |`),
    '',
    groupBy ? `Grouped by \`[${groupBy}]\`${totals.length ? ', with a total under each group' : ''}.` : 'Not grouped.',
    totals.length ? `A grand total of ${totals.map((t) => captionOf(t)).join(', ')} ends the report.` : '',
    '',
    'Bind real data in the Data tab, or describe a change and add an AI provider to have it redesigned.',
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n');

  return {
    title,
    repx,
    layout: { title, pageWidth: page.width, sections },
    markdown,
    archetype: { id: archetype.id, label: archetype.label },
    fields,
    groupBy,
    totals,
  };
}
