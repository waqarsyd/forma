/**
 * Prompt-to-Report: designing a report from a written description, with no
 * source document.
 *
 * ## Where the shape comes from
 *
 * DevExpress's own designer has had this since v24.2 as the *AI Prompt-to-
 * Report* page of its Report Wizard. On 2026-10-28 its Web Report Designer
 * demo was captured with REA and the wizard read out of the designer's own
 * localisation table: a *Select a Data Source Option* page (No Data Source /
 * Add Data Source), an *Enter Report Description* page with *Predefined
 * prompts*, a *Data source structure* panel and the placeholder *Type in a
 * detailed report description*, then *Analyzing the request...*, *Building
 * your report...*, and a *Submit* for the answers when the model asks follow-up
 * questions. Its documentation adds the options behind that: a structured
 * workflow of intent clarification, input validation, layout planning and
 * output verification; `FixLayoutErrors` resolving overlapping controls; and
 * `RetryAttemptCount` (default 3) for a layout the model got wrong.
 *
 * Forma already generated from a bare description: a message with no
 * attachment goes to the chat turn, and `wantsReport` falls through to the
 * same generation as an upload. What it lacked was everything around that:
 * the prompt still opened with "analyze the provided image(s)", there was no
 * place to supply a data source, nobody asked a clarifying question, and a
 * layout with overlapping controls shipped as drawn. This module is the pure
 * half of closing that gap -- the catalogue, the brief the model is given, the
 * question-and-answer merge and the retry decision -- so each piece can be
 * tested without a key. `geminiService.ts` carries the request framing and the
 * clarification call; `repxOverlaps.ts` is the FixLayoutErrors half;
 * `DescribeReportDialog.tsx` is the wizard.
 *
 * ## What is deliberately different
 *
 * DevExpress attaches a live data source and sends its metadata. Forma has no
 * connection and will not have one (PRD section 6), so the data source here is
 * what the Data tab already accepts: a pasted JSON row, a CSV export, a CREATE
 * TABLE or a list of names, read by `dataSource.ts` into typed fields. The
 * brief tells the model those are the only field names it may bind to, which
 * is the same rule DevExpress's wizard applies with a real connection.
 */
import { parseDataSource, type DataSource } from './dataSource';
import type { RepxAudit } from './repxAudit';

/** One of the wizard's built-in suggestions. */
export interface PredefinedPrompt {
  id: string;
  title: string;
  text: string;
}

/**
 * The catalogue the dialog offers. Each is a complete description on its own,
 * written the way the DevExpress documentation says a good prompt is written:
 * layout, calculations, grouping and the visual type, so the model assumes
 * less. Users edit them before sending; the text is a start, not a template.
 */
export const PREDEFINED_PROMPTS: readonly PredefinedPrompt[] = Object.freeze([
  {
    id: 'invoice',
    title: 'Invoice',
    text:
      'An invoice. Company name, address and logo placeholder top left; the word INVOICE, the invoice number, ' +
      'invoice date and due date top right. A "Bill To" block with the customer name and address. A line-item table ' +
      'with columns Item, Description, Qty, Unit Price and Amount, with a bold heading row and right-aligned numbers. ' +
      'Below it, right-aligned: Subtotal, Tax, Shipping and a bold Total Due. Payment terms and a thank-you line at ' +
      'the bottom, and the page number in the footer.',
  },
  {
    id: 'customer-list',
    title: 'Customer list',
    text:
      'A customer listing. A title "Customer List" with the run date beside it. One table with columns Customer ID, ' +
      'Company, Contact, City, Country and Balance, with a ruled heading row that repeats on every page and ' +
      'right-aligned balances. Sorted by Customer ID. Page number in the footer.',
  },
  {
    id: 'sales-by-region',
    title: 'Sales by region',
    text:
      'A sales summary grouped by Region. For each region a group header with the region name, then rows of ' +
      'Salesperson, Orders, Revenue and Average Order, and a group footer with the region subtotal in bold. ' +
      'A grand total at the end of the report. A bar chart of revenue by region in the report header.',
  },
  {
    id: 'employee-directory',
    title: 'Employee directory',
    text:
      'An employee directory grouped by Department. Each row shows a photo placeholder, Name, Title, Email, Phone ' +
      'and Start Date. Department name in the group header with the head count, and the department on every page ' +
      'header. Page X of Y in the footer.',
  },
  {
    id: 'purchase-order',
    title: 'Purchase order',
    text:
      'A purchase order. Buyer name and address top left, "PURCHASE ORDER" with the PO number and date top right, ' +
      'a Vendor block and a Ship To block side by side, then a table with columns Line, Part Number, Description, ' +
      'Quantity, Unit Cost and Extended Cost. Subtotal, tax and total at the bottom right, an authorised-by ' +
      'signature line at the bottom left.',
  },
  {
    id: 'inventory',
    title: 'Inventory status',
    text:
      'An inventory status report grouped by Warehouse. Columns SKU, Product, On Hand, Reserved, Available and ' +
      'Reorder Level, with rows whose Available is below Reorder Level shown in red. Warehouse totals in each group ' +
      'footer and a company total in the report footer. Report date in the header and page number in the footer.',
  },
]);

/** What the dialog collects. The page size and unit come from the report configuration. */
export interface ReportDescriptionRequest {
  /** The user's description, edited from a predefined prompt or typed. */
  description: string;
  /** Optional. When absent the model names the report from the description. */
  title?: string;
  /** Optional pasted data: a JSON row, CSV, CREATE TABLE or a list of names. */
  dataSchema?: string;
  /** Follow-up answers, appended by `withAnswers`. */
  answers?: ClarificationAnswer[];
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  /** A suggested answer the user can accept as-is. */
  suggestion?: string;
}

export interface ClarificationAnswer {
  id: string;
  question: string;
  answer: string;
}

/** Collapse whitespace; an empty description is a request for nothing. */
export function normalizeDescription(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

export function isDescribable(request: ReportDescriptionRequest): boolean {
  return normalizeDescription(request.description).length >= 12;
}

/** The data source the request carries, parsed, or null when it has none. */
export function requestDataSource(request: ReportDescriptionRequest): DataSource | null {
  const text = (request.dataSchema ?? '').trim();
  if (!text) return null;
  const source = parseDataSource(text);
  return source.fields.length ? source : null;
}

/**
 * The data source structure as the model is shown it: one field per line with
 * its type, the way DevExpress's wizard panel lists them.
 */
export function describeDataSource(source: DataSource): string {
  return source.fields.map((f) => `- ${f.name} (${f.type})`).join('\n');
}

/** Append the user's answers so the next call carries them. */
export function withAnswers(request: ReportDescriptionRequest, answers: ClarificationAnswer[]): ReportDescriptionRequest {
  const kept = answers.filter((a) => a.answer.trim());
  return { ...request, answers: [...(request.answers ?? []), ...kept] };
}

/**
 * The block the generation prompt opens with in description mode, replacing
 * "analyze the provided image(s)".
 *
 * Three rules are stated here rather than left to the cheat sheet, because
 * each is a failure the image path never has: there is nothing to measure, so
 * the model must plan positions from the page size; there is no source whose
 * strings must survive, so the description's own words are the text; and with
 * a data source given, a field name that is not in it is a binding that fails
 * when the report runs.
 */
export function buildDescriptionBrief(request: ReportDescriptionRequest, source: DataSource | null = requestDataSource(request)): string {
  const lines: string[] = [];
  lines.push('THE REPORT TO DESIGN');
  lines.push('There is no source document. Design the report from this description, planning every band and control from the page size and the report unit given below. Nothing is to be measured from an image, because there is none.');
  lines.push('');
  lines.push(`DESCRIPTION: "${normalizeDescription(request.description)}"`);
  if (request.title?.trim()) lines.push(`TITLE: "${request.title.trim()}" (use it as the report title and the layout title)`);

  if (request.answers?.length) {
    lines.push('');
    lines.push('The user answered these follow-up questions; the answers are part of the description:');
    for (const a of request.answers) lines.push(`- Q: ${a.question} A: ${a.answer.trim()}`);
  }

  if (source) {
    lines.push('');
    lines.push(`DATA SOURCE STRUCTURE (${source.kind}). These are the ONLY field names this report may bind to:`);
    lines.push(describeDataSource(source));
    lines.push('Bind every data-bearing cell in the Detail band to one of these fields with an ExpressionBindings item (PropertyName="Text", Expression="[FieldName]"), and never invent a field. A label that shows a value not in this list is a literal, not a binding.');
  } else {
    lines.push('');
    lines.push('NO DATA SOURCE was given. Write the Detail band as ONE representative row with plausible placeholder values in Text=, and do not write ExpressionBindings against field names you invented.');
  }

  lines.push('');
  lines.push('Make the layout sensible rather than minimal: real margins, a heading treatment, consistent fonts of at least 9pt, numbers right-aligned, and controls that do not overlap. Where the description is silent, follow common practice for that kind of report rather than asking.');
  return lines.join('\n');
}

/** How many times a report with structural errors is regenerated. DevExpress's default is 3 attempts; one more after the first is enough here, each being a full generation. */
export const MAX_FIX_ATTEMPTS = 2;

/**
 * Whether to send the report back for repair.
 *
 * Only ERRORS count: a warning is a worse report, not a broken one, and asking
 * for another generation over a warning trades a usable report for a different
 * one. `attempt` is how many generations have already run.
 */
export function shouldRetryForErrors(audit: Pick<RepxAudit, 'errors'>, attempt: number, max: number = MAX_FIX_ATTEMPTS): boolean {
  return audit.errors > 0 && attempt < max;
}

/**
 * The instruction for a repair pass, built from the audit so the model is told
 * exactly what is wrong rather than asked to try again.
 */
export function fixInstruction(audit: Pick<RepxAudit, 'findings'>): string {
  const errors = audit.findings.filter((f) => f.severity === 'error');
  const list = errors.map((f) => `- [${f.code}] ${f.message}`).join('\n');
  return (
    'The previous report has structural errors that a designer will refuse or silently lose content over. ' +
    'Keep the layout exactly as it is and fix ONLY these:\n' +
    list +
    '\nReturn the complete report again with every band and control present.'
  );
}
