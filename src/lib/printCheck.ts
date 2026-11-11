/**
 * The report printed with the page's own records before it is answered
 * (2026-11-11, the full audit's CC-01), and the one bounded loop that sends
 * a report back to the AI over what the print shows.
 *
 * The Claude Code reference printed each report through DevExpress with the
 * records the source shows and read the print back: Forma's answers printed
 * on two pages where the page has one, titled "INVO", made one group with a
 * blank heading out of thirteen letters, and printed "1763.0". The file
 * checks (`repxAudit.ts`) passed every one of them, because the audit asks
 * whether a designer will open the file and "deliberately does not judge
 * fidelity". This does, with Forma's own printer (`paginate`, the Preview's),
 * so it runs in the browser and in Node, needs no DevExpress and spends
 * nothing.
 *
 * What it finds, each only when the page's records can say so:
 * - `prints-extra-pages`: more pages than the page shows, with only its records;
 * - `clipped-at-margin`: a control printed past the printable width, on the
 *   page DevExpress loads (whole margins, CC-03), which is cut off there or
 *   carried onto a page of its own;
 * - `bound-cell-blank`: a bound text that prints nothing over records whose
 *   fields all hold a value, the mark of an expression DevExpress cannot read
 *   or a field the data does not have;
 * - `group-collapses`: one group where the page shows several, or one group
 *   per record;
 * - `value-unformatted` (a warning): a date or number the page prints in a
 *   form `formatFromText.ts` reproduces, printed in .NET's default instead.
 *
 * In Node nothing measures text, so a print there does not grow; the browser
 * passes `canvasMeasurer`, which the Preview matched to GDI.
 *
 * `fixUntilPrints` is the loop that was `runGeneration`'s for a report
 * designed from words (DevExpress's Prompt-to-Report retries a layout the
 * model got wrong), opened to every run for what the print shows. The
 * deterministic repairs run first, in the generation; only what they leave
 * comes here, at most `MAX_FIX_ATTEMPTS` answers in all, and the better of
 * each pair is kept.
 */
import { paginate, parseReportStructure, type RecordValues } from './reportPreview';
import { auditRepx, type RepxFinding } from './repxAudit';
import { formatFor, isPlain } from './formatFromText';
import { formatComposite } from './netFormat';
import { addUsage, type TokenUsage } from './tokenUsage';
import { MAX_FIX_ATTEMPTS } from './promptToReport';
import type { MeasureText } from './textMeasure';
import type { ReportLayout } from './reportTypes';

export interface PrintCheckOptions {
  /** How many pages the source shows; no page count is judged without it. */
  pagesShown?: number;
  /** How many groups the source shows, when it shows them (`PageRows.groups`). */
  groupsShown?: number;
  /** Each field's texts as the page printed them, for `value-unformatted`. */
  samples?: Readonly<Record<string, readonly string[]>>;
  measure?: MeasureText | null;
}

/** Every field an expression reads, outside its string literals; parameters are not fields. */
const fieldsRead = (expression: string) =>
  [...expression.replace(/'(?:[^']|'')*'/g, "''").matchAll(/\[([^\][]+)\]/g)].map((m) => m[1].trim()).filter((f) => f && !/^Parameters\./i.test(f));

const listed = (names: readonly string[]) => `${names.slice(0, 4).join(', ')}${names.length > 4 ? ', ...' : ''}`;

/** Print a report with the page's records and say what came out wrong. */
export function printCheck(repx: string | null | undefined, rows: readonly RecordValues[], options: PrintCheckOptions = {}): RepxFinding[] {
  if (!repx || !rows.length) return [];
  const structure = parseReportStructure(repx);
  if (!structure.bands.length) return [];
  const report = paginate(structure, rows.length, { rows: [...rows], measure: options.measure ?? null, maxPages: 60 });
  const findings: RepxFinding[] = [];
  const add = (severity: RepxFinding['severity'], code: string, message: string) => findings.push({ severity, code, message });

  if (options.pagesShown && report.pages.length > options.pagesShown) {
    add(
      'error',
      'prints-extra-pages',
      `Printed with the ${rows.length} records the page shows, the report runs to ${report.pages.length} pages where the page has ${options.pagesShown}.`,
    );
  }

  // Controls past the printable width, on their own page (an added page for what runs over is shifted left).
  const right = report.content.left + report.content.width + 0.5;
  const clipped = new Set<string>();
  const blank = new Set<string>();
  const filled = (field: string) => rows.every((r) => (r[field] ?? '').trim() !== '');
  const shouldPrint = (expression: string | null, running: string | null) => {
    if (!expression?.trim()) return false;
    // An aggregate with no running scope prints blank by design; the audit names it (summary-no-running).
    if (/\bsum\w+\s*\(/i.test(expression) && (running === null || running === 'None')) return false;
    const fields = fieldsRead(expression);
    return fields.length > 0 && fields.every(filled);
  };
  for (const page of report.pages) {
    for (const band of page.bands) {
      for (const pc of band.controls) {
        const c = pc.control;
        if (!c.visible) continue;
        if (band.left >= report.content.left && band.left + c.x + c.offsetX + c.width > right) clipped.add(c.name);
        if (c.type === 'XRTable') {
          (pc.cellTexts ?? []).forEach((cells, r) =>
            cells.forEach((text, k) => {
              const cell = c.rows[pc.rowStart + r]?.cells[k];
              if (cell && shouldPrint(cell.data.expression, cell.data.running) && !(text ?? '').trim()) blank.add(`${c.name} (${cell.data.expression})`);
            }),
          );
        } else if (pc.text !== null && shouldPrint(c.data.expression, c.data.running) && !pc.text.trim()) {
          blank.add(`${c.name} (${c.data.expression})`);
        }
      }
    }
  }
  if (clipped.size) {
    add('error', 'clipped-at-margin', `${listed([...clipped])} ${clipped.size === 1 ? 'prints' : 'print'} past the right margin, so part of it is cut off or carried onto a page of its own.`);
  }
  if (blank.size) {
    add('error', 'bound-cell-blank', `${listed([...blank])} ${blank.size === 1 ? 'prints' : 'print'} nothing over records that hold every field ${blank.size === 1 ? 'it reads' : 'they read'}: an expression DevExpress cannot read, or a field the data does not have.`);
  }

  // The outer group: the higher Level, and between equals the later in the file (s19).
  const headers = structure.bands.filter((b) => b.kind === 'GroupHeader');
  const outer = headers.reduce<(typeof headers)[number] | null>((best, b) => (!best || b.level >= best.level ? b : best), null);
  if (outer && rows.length >= 5) {
    const starts = new Set<number | string>();
    report.pages.forEach((page, p) =>
      page.bands.forEach((band, i) => {
        // A group's first record names it, so a header repeated on each page
        // counts once; only a header that printed with no records at all
        // falls back to where it printed.
        if (band.band === outer) starts.add(band.scope?.row ?? band.scope?.group?.[0] ?? `${p}:${i}`);
      }),
    );
    const groups = starts.size;
    const shown = options.groupsShown ?? 0;
    if (groups === 1 && shown >= 2) {
      add('error', 'group-collapses', `The report prints all ${rows.length} records in one group where the page shows ${shown} groups: it groups on a field the records do not hold.`);
    } else if (groups === rows.length && shown < rows.length) {
      add('error', 'group-collapses', `The report prints each of the ${rows.length} records as a group of its own: it groups on a field that differs on every record.`);
    }
  }

  // A value the page prints in a form a format reproduces, printed in .NET's default.
  const unformatted = new Set<string>();
  for (const [field, texts] of Object.entries(options.samples ?? {})) {
    const found = formatFor(texts);
    if (!found || isPlain(found)) continue;
    const printedDefault = formatComposite('{0}', [found.values[0]]);
    if (printedDefault === texts[0]) continue;
    for (const band of structure.bands) {
      for (const c of band.controls) {
        const places = c.type === 'XRTable' ? c.rows.flatMap((r) => r.cells.map((cell) => cell.data)) : [c.data];
        if (places.some((d) => d.expression?.trim() === `[${field}]` && !d.format)) unformatted.add(field);
      }
    }
  }
  if (unformatted.size) {
    add('warning', 'value-unformatted', `[${[...unformatted].join('], [')}] ${unformatted.size === 1 ? 'prints' : 'print'} in .NET's default form where the page shows another, such as "${options.samples![[...unformatted][0]][0]}".`);
  }
  return findings;
}

/* ------------------------------------------------------------- the loop */

/** What a print shows that one more answer can put right. */
const PRINT_FIX = new Set(['prints-extra-pages', 'clipped-at-margin', 'bound-cell-blank', 'group-collapses', 'total-disagrees-with-page']);

/** An answer the loop can judge: the report, and what the generation found printing it. */
export interface FixableAnswer {
  repxContent: string;
  layout: ReportLayout;
  usage?: TokenUsage | null;
  dataQuery?: unknown;
  printFindings?: RepxFinding[];
  evidenceFindings?: RepxFinding[];
}

/**
 * What sends an answer back. A report designed from words goes back over any
 * audit error, as it always did; any other run over what its print shows, an
 * expression DevExpress cannot read (CC-04), and a grid the page shows drawn
 * as loose texts (PL-11b), each of which the model can be talked out of. Not
 * any other audit error on a picture: there it is more often a repair that
 * declined than a layout the model got wrong. `grid-not-a-table` is the one
 * warning that sends an answer back; no other does.
 *
 * Not `expression-invalid` when the run started from a report (the open one,
 * or a `.repx` attached): its expressions are the person's own, DevExpress
 * already accepted them, and one Forma's own parser cannot read would spend a
 * request on every turn asking the AI to rewrite them (2026-11-11, the review
 * of CC-01).
 */
export function findingsToFix(answer: FixableAnswer, options: { described: boolean; fields?: readonly string[]; fromReport?: boolean }): RepxFinding[] {
  const audit = auditRepx(answer.repxContent, answer.layout, { fields: options.fields });
  const errors = audit.findings.filter((f) => f.severity === 'error' && (options.described || (f.code === 'expression-invalid' && !options.fromReport)));
  const printed = (answer.printFindings ?? []).filter((f) => f.severity === 'error' && PRINT_FIX.has(f.code));
  const grid = (answer.evidenceFindings ?? []).filter((f) => f.code === 'grid-not-a-table');
  return [...errors, ...printed, ...grid];
}

/** The instruction for one more answer, naming exactly what to put right. */
export function fixInstructionFor(findings: readonly RepxFinding[]): string {
  return (
    'The previous report has problems a designer refuses or loses content over, or prints differently from the source. ' +
    'Keep the layout exactly as it is and fix ONLY these:\n' +
    findings.map((f) => `- [${f.code}] ${f.message}`).join('\n') +
    '\nReturn the complete report again with every band and control present.'
  );
}

export interface FixLoop<R extends FixableAnswer> {
  answer: R;
  /** Every answer's usage, the first's included. */
  spent: TokenUsage | null;
  /** What is still to fix in the answer kept. */
  findings: RepxFinding[];
}

/**
 * Send the answer back while something is left to fix, at most
 * `MAX_FIX_ATTEMPTS` answers in all, each from what this click may still
 * spend. The better of each pair is kept: fewer things to fix, and never
 * more. An answer that fails, on a limit above all, keeps the one before it
 * (the AI accuracy programme's batch AG item 23). Null when the person
 * stopped it.
 */
export async function fixUntilPrints<R extends FixableAnswer>(
  first: R,
  options: {
    described: boolean;
    fields?: readonly string[];
    /** The run started from a report, whose own expressions are not sent back (`findingsToFix`). */
    fromReport?: boolean;
    spent: TokenUsage | null;
    /** Requests this click may still make. */
    left: () => number;
    ask: (instruction: string, repx: string) => Promise<R>;
    aborted: () => boolean;
  },
): Promise<FixLoop<R> | null> {
  let answer = first;
  let spent = options.spent;
  let findings = findingsToFix(answer, options);
  for (let attempt = 1; findings.length && attempt < MAX_FIX_ATTEMPTS; ) {
    if (options.left() <= 0) {
      console.warn(`The report has ${findings.length} thing(s) to fix, and this request's allowance is spent; keeping it as it is.`);
      break;
    }
    attempt += 1;
    console.warn(`The report has ${findings.length} thing(s) to fix after repairs (${[...new Set(findings.map((f) => f.code))].join(', ')}); asking for a fix (attempt ${attempt}).`);
    let fixed: R;
    try {
      fixed = await options.ask(fixInstructionFor(findings), answer.repxContent);
    } catch (err) {
      if (options.aborted()) throw err;
      console.warn(`The fix (attempt ${attempt}) did not answer; keeping the report as it was.`, err);
      break;
    }
    if (options.aborted()) return null;
    spent = addUsage(spent, fixed.usage);
    const next = findingsToFix(fixed, options);
    if (next.length > findings.length) {
      console.warn(`The fix had ${next.length} thing(s) to fix against ${findings.length}; keeping the earlier report.`);
      break;
    }
    // The query the first answer named stands unless the fix names another (batch DE).
    answer = { ...fixed, dataQuery: fixed.dataQuery ?? answer.dataQuery };
    findings = next;
  }
  return { answer, spent, findings };
}
