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
 * clarification call; `repxOverlaps.ts` is the FixLayoutErrors half. The
 * wizard is the chat box since 2026-11-01: `describeFromChat` in `App.tsx`
 * asks the questions in the thread. The dialog it replaced is recoverable from
 * the commit that removed it, with `git log -- src/components/DescribeReportDialog.tsx`.
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

/*
 * PREDEFINED_PROMPTS, six complete descriptions offered as chips in an empty
 * conversation, went on 2026-11-05 when the owner asked for the chat to show
 * none of that (`git log -S"PREDEFINED_PROMPTS"`).
 */

/** What the dialog collects. The page size and unit come from the report configuration. */
export interface ReportDescriptionRequest {
  /** The user's description, as typed. */
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

/**
 * A message typed into the chat, as a Prompt-to-Report request (2026-11-01).
 *
 * The dialog this replaced had a field of its own for a data source; the chat
 * has one box. So a fenced code block (three backticks) holding a JSON row,
 * a CSV header or a `CREATE TABLE`, or a bare `CREATE TABLE` statement, is
 * taken as the data source, and the rest of the message is the description.
 * A plain list of names counts only on lines of its own in a fence, since any
 * sentence would otherwise read as one. Anything else stays in the
 * description, where the model can still read it.
 */
export function describedRequest(message: string): ReportDescriptionRequest {
  // A language tag only when a line break follows it: "```a nice header```" has none.
  const fenced = /```(?:[\w-]*\n)?([\s\S]*?)```/.exec(message);
  if (fenced) {
    const source = parseDataSource(fenced[1]);
    const structured = source.kind !== 'list' || fenced[1].trim().split(/\r?\n/).length > 1;
    if (source.fields.length && structured) {
      return { description: normalizeDescription(message.replace(fenced[0], ' ')), dataSchema: fenced[1].trim() };
    }
  }
  const create = createTableIn(message);
  if (create && parseDataSource(create).fields.length) {
    return { description: normalizeDescription(message.replace(create, ' ')), dataSchema: create.trim() };
  }
  return { description: normalizeDescription(message) };
}

/** A `CREATE TABLE` statement to its balancing parenthesis, `decimal(10,2)` and all, with any `;`. */
function createTableIn(message: string): string | null {
  const start = /\bcreate\s+table\b[^(]*\(/i.exec(message);
  if (!start) return null;
  let depth = 0;
  for (let i = start.index + start[0].length - 1; i < message.length; i++) {
    if (message[i] === '(') depth++;
    else if (message[i] === ')' && --depth === 0) {
      const end = message[i + 1] === ';' ? i + 2 : i + 1;
      return message.slice(start.index, end);
    }
  }
  return null;
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
