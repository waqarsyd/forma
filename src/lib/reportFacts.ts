/**
 * The facts of the open report, counted in code (2026-11-10, the owner's AI
 * accuracy programme, batch AG, items 21 and 24).
 *
 * A model asked "how many fields does this print?" counts what it was shown,
 * and counts wrong often enough to matter; asked to bind a column, it will
 * name one the data does not have as readily as one it does. So the numbers
 * and names are Forma's, read off the file:
 * - **Answered with no AI at all** (`answerFromFacts`): a plain question
 *   about the report's fields, totals, groups, bands, parameters, controls or
 *   paper is answered from these facts in the reply, and costs no request.
 *   This is "Forma's own model when it is enough": the cheapest route that is
 *   also the exact one. Anything else, or anything that asks for a change,
 *   goes to the AI as before.
 * - **Told to the AI** (`factsBlock`): beside the outline, the counts and
 *   names it must use rather than work out.
 * - **Held to the data** (`dataFieldsOf`, `inventedFields`): when the report
 *   declares its data, a bind or group to a field the data lacks is declined
 *   (lib/agentEdit.ts), and a reply that names one says so. The data is what
 *   the report's own data source returns (its result schema, or the columns
 *   its queries select), its calculated fields, and any fields App knows from
 *   a database shared on the Data tab. With none of those, the fields the
 *   report prints are all that is known, and nothing is declined.
 */
import { parseReportStructure, type PreviewControl } from './reportPreview';
import { readRepxDataSources } from './repxSqlDataSource';
import { plainKind } from './plainKind';

/** One total the report prints. */
export interface TotalFact {
  control: string;
  band: string;
  /** The aggregate, as DevExpress names it: Sum, Count, Avg, Max, Min, ... */
  func: string;
  field: string | null;
  /** The `<Summary>` scope: Group, Report or Page; null with none. */
  scope: string | null;
}

export interface ReportFacts {
  title: string;
  unit: string;
  paper: string;
  landscape: boolean;
  /** Each band's kind, in print order. */
  bands: string[];
  /** Fields grouped on, outermost first. */
  groups: string[];
  controls: number;
  /** Controls by DevExpress type, `XRLabel` and the rest. */
  byType: Record<string, number>;
  /** Every field the report prints or computes from, as written. */
  printed: string[];
  totals: TotalFact[];
  parameters: string[];
  calculated: string[];
  /**
   * The fields the report's data has, when it declares any (its data source
   * or a database App knows), its calculated fields among them; null when
   * nothing says what the data is.
   */
  dataFields: string[] | null;
}

const ROOT = /<XtraReportsLayoutSerializer\b([^>]*)>/;
const attr = (attrs: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1];
const SUMMARY = /^\s*sum(Sum|Count|Avg|Max|Min|Median|Var|VarP|StdDev|StdDevP|DSum|DAvg|DCount|DVar|DVarP|DStdDev|DStdDevP|RecordNumber|Percentage|RunningSum|WAvg)\s*\(\s*(?:\[([^\]]+)\])?/i;

/** The `[Field]` names an expression reads; a parameter (`?Name`, `[Parameters.Name]`) is not one. */
export function fieldsInExpression(expression: string): string[] {
  const out: string[] = [];
  for (const m of expression.replace(/'(?:[^']|'')*'/g, "''").matchAll(/\[([^\][]+)\]/g)) {
    const name = m[1].trim();
    if (name && !/^Parameters\./i.test(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

function addAll(into: string[], names: readonly string[]) {
  for (const n of names) if (n && !into.includes(n)) into.push(n);
}

function controlFields(c: PreviewControl): string[] {
  const out: string[] = [];
  if (c.field) out.push(c.field);
  if (c.data?.expression) addAll(out, fieldsInExpression(c.data.expression));
  for (const row of c.rows) for (const cell of row.cells) {
    if (cell.field) addAll(out, [cell.field]);
    if (cell.data?.expression) addAll(out, fieldsInExpression(cell.data.expression));
  }
  return out;
}

/**
 * The fields the report's data has: its data sources' result schema, or the
 * columns their queries select, its calculated fields, and `extra` (a shared
 * database's chosen query). Null when none of them says anything.
 */
export function dataFieldsOf(xml: string, extra: readonly string[] = []): string[] | null {
  const out: string[] = [];
  for (const ds of readRepxDataSources(xml)) {
    for (const view of ds.views) addAll(out, view.fields.map((f) => f.name));
    for (const q of ds.queries) addAll(out, q.columns.map((c) => c.name));
  }
  addAll(out, [...extra]);
  if (!out.length) return null;
  addAll(out, parseReportStructure(xml).calculatedFields.map((f) => f.name));
  return out;
}

/** The facts of a report, from its file; `extraFields` are fields App knows the data has. */
export function reportFacts(xml: string, extraFields: readonly string[] = []): ReportFacts {
  const s = parseReportStructure(xml);
  const root = ROOT.exec(xml)?.[1] ?? '';
  const printed: string[] = [];
  const totals: TotalFact[] = [];
  const byType: Record<string, number> = {};
  const groups: string[] = [];
  let controls = 0;
  for (const band of s.bands) {
    if (band.kind === 'GroupHeader') addAll(groups, band.fields.map((f) => f.field));
    for (const c of band.controls) {
      controls++;
      byType[c.type] = (byType[c.type] ?? 0) + 1;
      addAll(printed, controlFields(c));
      const cells = [{ name: c.name, data: c.data }, ...c.rows.flatMap((r) => r.cells.map((cell) => ({ name: c.name, data: cell.data })))];
      for (const { name, data } of cells) {
        const m = data?.expression ? SUMMARY.exec(data.expression) : null;
        if (m) totals.push({ control: name, band: band.kind, func: m[1][0].toUpperCase() + m[1].slice(1), field: m[2]?.trim() ?? null, scope: data!.running && data!.running !== 'None' ? data!.running : null });
      }
    }
  }
  return {
    title: attr(root, 'DisplayName') ?? attr(root, 'Name') ?? 'the report',
    unit: s.unit,
    paper: attr(root, 'PaperKind') ?? 'Letter',
    landscape: (attr(root, 'Landscape') ?? '').toLowerCase() === 'true',
    bands: s.bands.map((b) => b.kind),
    groups,
    controls,
    byType,
    printed,
    totals,
    parameters: s.parameters.map((p) => p.name),
    calculated: s.calculatedFields.map((f) => f.name),
    dataFields: dataFieldsOf(xml, extraFields),
  };
}

const list = (names: readonly string[], max = 30) =>
  names.length > max ? `${names.slice(0, max).map((n) => `[${n}]`).join(', ')} and ${names.length - max} more` : names.map((n) => `[${n}]`).join(', ');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SCOPE: Record<string, string> = { Group: 'each group', Report: 'the whole report', Page: 'each page' };
// A total with no running scope in plain words (2026-11-11, the full audit's
// CV-08): "with no running scope (it prints blank)" until then.
const totalWords = (t: TotalFact) => `${t.func === 'Count' ? 'the count' : `the ${t.func.toLowerCase()}`}${t.field ? ` of [${t.field}]` : ''} in the ${bandWords(t.band)}${t.scope ? `, over ${SCOPE[t.scope] ?? t.scope.toLowerCase()}` : ', but it is not set to add anything up, so it prints blank'}`;

/** The kinds whose one and many the rule below gets wrong ("a character boxes", "2 table of contentses"). */
const ODD_COUNTS: Readonly<Record<string, readonly [string, string]>> = {
  'character boxes': ['a set of character boxes', 'sets of character boxes'],
  'table of contents': ['a table of contents', 'tables of contents'],
};

/**
 * The parts of a report by kind, as a person counts them (2026-11-11, the
 * full audit's CV-08): "6 texts and a page number", where it said "6 Label,
 * 1 PageInfo", DevExpress's class names. A label is a text here, as the
 * person reads it on the page; every other kind is `plainKind`'s.
 */
function partsWords(byType: Readonly<Record<string, number>>): string {
  const kinds = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => {
      const kind = type.replace(/^DevExpress\.XtraReports\.UI\./, '') === 'XRLabel' ? 'text' : plainKind(type);
      const odd = ODD_COUNTS[kind];
      if (odd) return n === 1 ? odd[0] : `${n} ${odd[1]}`;
      if (n === 1) return `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}`;
      return `${n} ${/(s|x|ch|sh)$/.test(kind) ? (/es$/.test(kind) ? kind : `${kind}es`) : `${kind}s`}`;
    });
  return kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}` : kinds.join('');
}
const bandWords = (kind: string) => kind.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

/** Bands by kind, as "a report header, 2 group headers, the detail band, ...". */
function bandList(kinds: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].map(([k, n]) => (n === 1 ? bandWords(k) : `${n} ${bandWords(k)}s`)).join(', ');
}

/** The data's fields the report does not print, when the data is known. */
const unprinted = (f: ReportFacts) => (f.dataFields ? f.dataFields.filter((d) => !f.printed.some((p) => p.toLowerCase() === d.toLowerCase()) && !f.calculated.includes(d)) : []);

/** What the AI is told beside the outline: the numbers and names to use rather than count. */
export function factsBlock(f: ReportFacts): string {
  const lines = [
    'FACTS, counted from the file by Forma. Use these numbers and names; do not count again.',
    `- ${plural(f.bands.length, 'band')}: ${bandList(f.bands)}; ${plural(f.controls, 'control')}.`,
    `- Fields printed or computed from: ${f.printed.length ? list(f.printed) : 'none'}.`,
    f.dataFields
      ? `- The data's fields: ${list(f.dataFields)}. Name no other field: one the data lacks prints nothing.`
      : '- The report declares no data source, so the data is not known: a field it does not print yet may not exist.',
    `- Totals: ${f.totals.length ? f.totals.map(totalWords).join('; ') : 'none'}.`,
    `- Grouped by: ${f.groups.length ? list(f.groups) : 'nothing'}.`,
    `- Parameters: ${f.parameters.length ? f.parameters.join(', ') : 'none'}.`,
  ];
  if (f.calculated.length) lines.push(`- Calculated fields: ${list(f.calculated)}.`);
  return lines.join('\n');
}

/** A request for a change, which facts cannot answer. */
const CHANGE = /\b(add|remove|delete|change|make|move|set|bind|put|rename|replace|resize|redesign|create|build|fix|export|insert|align|turn|hide|increase|decrease|swap|sort|filter|group by|translate|convert)\b/i;
const QUESTION = /\?\s*$|^\s*(how many|what|which|list|tell me|does|do|is|are|has|have)\b/i;

/**
 * A plain question about the report answered from its facts, with no AI: its
 * fields, totals, groups, bands, parameters, controls or paper. Null for
 * anything else, a change above all, which the AI answers as before.
 */
export function answerFromFacts(message: string, f: ReportFacts): string | null {
  const text = message.trim();
  if (!text || text.length > 160 || !QUESTION.test(text) || CHANGE.test(text)) return null;
  const parts: string[] = [];
  /*
   * A question about the set, never about one of it (2026-11-10, found by the
   * chat judge's dry run, batch AH): "What does the Margin column show?" was
   * answered with the report's fields, since "column" alone was the test. The
   * set is a plural, or a count or list of one.
   */
  const about = (plural: RegExp, one: RegExp) => plural.test(text) || new RegExp(`\\b(how many|which|what|list|any|a)\\s+${one.source}\\b`, 'i').test(text);
  if (about(/\b(fields|columns)\b/i, /(fields?|columns?)/)) {
    if (!f.printed.length) parts.push('It prints no fields: every text in it is typed.');
    else parts.push(`It prints ${plural(f.printed.length, 'field')}: ${list(f.printed)}.`);
    if (f.dataFields) {
      const left = unprinted(f);
      parts.push(`Its data has ${plural(f.dataFields.length, 'field')}${left.length ? `; not printed: ${list(left)}` : ', all of them printed'}.`);
    }
  }
  if (about(/\b(totals|sums|subtotals|summaries|averages)\b/i, /(totals?|sums?|subtotals?)/)) {
    parts.push(f.totals.length ? `${f.totals.length === 1 ? 'One total' : `${f.totals.length} totals`}: ${f.totals.map(totalWords).join('; ')}.` : 'It has no totals.');
  }
  if (/\b(grouped|groups|grouping)\b/i.test(text)) parts.push(f.groups.length ? `It is grouped by ${list(f.groups)}${f.groups.length > 1 ? ', outermost first' : ''}.` : 'It is not grouped.');
  if (about(/\b(bands|sections)\b/i, /(bands?|sections?)/)) parts.push(`It has ${plural(f.bands.length, 'band')}: ${bandList(f.bands)}.`);
  if (about(/\bparameters\b/i, /parameters?/)) parts.push(f.parameters.length ? `${plural(f.parameters.length, 'parameter')}: ${f.parameters.join(', ')}.` : 'It has no parameters.');
  if (/\b(controls?|labels?|tables?|elements?|pictures?|images?)\b/i.test(text) && /\bhow many\b/i.test(text)) {
    parts.push(`It has ${plural(f.controls, 'part')}: ${partsWords(f.byType)}.`);
  }
  if (/\b(paper|page size|landscape|portrait|orientation)\b/i.test(text)) parts.push(`It prints on ${f.paper}, ${f.landscape ? 'landscape' : 'portrait'}.`);
  if (!parts.length) return null;
  // The answer alone (2026-11-11, the full audit's CV-08): it ended "Counted
  // from the report file by Forma, with no AI." until then.
  return parts.join(' ');
}

/**
 * The fields a reply names in brackets that the report's data does not have,
 * when the data is known; nothing when it is not, since then any name may be
 * a column the person means to add.
 */
export function inventedFields(reply: string, f: ReportFacts): string[] {
  if (!f.dataFields) return [];
  const known = new Set([...f.dataFields, ...f.printed, ...f.calculated].map((n) => n.toLowerCase()));
  return fieldsInExpression(reply).filter((n) => !/\s{2,}|^\d+$/.test(n) && !known.has(n.toLowerCase()));
}

/** The line a reply carries when it names fields the data does not have. */
export function inventedNote(names: readonly string[]): string {
  return names.length
    ? `Note: this report's data has no ${names.length === 1 ? 'field' : 'fields'} ${list(names)}, so ${names.length === 1 ? 'it' : 'they'} would print nothing.`
    : '';
}

/**
 * The reply when a redesign or a new report would hinge on a field the data
 * does not have (2026-11-10, the full audit; the chat judge's one serious
 * finding: "add a column for the customer's email address" went to a whole
 * rebuild around a field the facts said was not there). An answer instead:
 * what the data has, and what to do.
 */
export function declinedForFields(names: readonly string[], f: ReportFacts): string {
  const has = f.dataFields?.length ? ` It has ${list(f.dataFields)}.` : '';
  return (
    `This report's data has no ${names.length === 1 ? 'field' : 'fields'} ${list(names)}, so I have not redesigned it: that column would print nothing.${has}` +
    ' Say which of those to use instead, or share a database that has it under Data.'
  );
}
