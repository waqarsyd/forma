/**
 * Totals checked against the figures the page prints (2026-11-11, the full
 * audit's CC-05).
 *
 * Forma's AI totalled a "Margin %" column as `sumSum([Margin])` and printed
 * 82.7, 111.3, 54.3 and 248.3 where the page shows 28.7, 28.9, 28.1 and 28.5,
 * and Forma's own builder wrote every total as a sum. A percentage, a rate or
 * an average is never summed; the page's own total says what it is, and it
 * is in OCR's reading of the page.
 *
 * - **`sum-of-ratio`** (a warning, with or without records): a `sumSum` in a
 *   footer under a caption that says it is a ratio (`%`, percent, pct, ratio,
 *   average), or over a field named so. `saysRatio`, not the wider `isRatio`
 *   (2026-11-11, wave 6): a sales report's "Gross Margin" is money beside
 *   Revenue and Cost, and summing it is right, so "margin" and "rate" alone
 *   draw no warning, exactly as the builder does not average them.
 * - **`total-disagrees-with-page`** (with the page's records, `pageRows.ts`):
 *   each total evaluated by `criteria.ts` over its scope's records, the
 *   group's for a group footer and the report's for the report footer, and
 *   compared with the figure the page prints under the same column, after
 *   rounding both to the decimals the page prints: the parser's arithmetic
 *   gives 0.5950000000000001 for `7 * 0.085m`. An error only for a ratio
 *   totalled outside the range of its own values; a warning otherwise.
 * - **The repair** (`repairTotals`) changes a total only when exactly one of
 *   the candidates reproduces the page's figure in every group and the
 *   report's: the sum, the average, or the average weighted by one money
 *   column (`sumSum([Revenue] * [MarginPct]) / sumSum([Revenue])`). Two that
 *   fit, or none, and the total is left as it was and reported.
 *
 * The page's figures in the Claude Code reference's sales case are made-up
 * numbers no weighting reproduces except West's, so there the check reports
 * and the repair leaves it alone; that is the behaviour wanted, not a gap.
 */
import { parseReportStructure, type PreviewBand, type PreviewControl } from './reportPreview';
import { aggregate, rowEnv, typeRows, type TypedRow } from './reportData';
import { evaluateText, toNumber, type Value } from './criteria';
import { saysRatio, valueOfText } from './formatFromText';
import { escapeXmlAttribute, unescapeXml } from './xmlEscape';
import type { PageRows } from './pageRows';
import type { RepxFinding } from './repxAudit';

const FOOTERS = new Set(['GroupFooter', 'ReportFooter', 'PageFooter']);
const HEADERS = ['PageHeader', 'GroupHeader', 'ReportHeader'];

/** One place that prints text, across its band: a label, or one cell of a table's row. */
interface Place {
  band: PreviewBand;
  left: number;
  right: number;
  /** The `Text` binding, or null for a literal. */
  expression: string | null;
  text: string;
}

function placesOf(band: PreviewBand): Place[] {
  const out: Place[] = [];
  const add = (c: PreviewControl) => {
    const left = c.x + c.offsetX;
    if (c.type === 'XRTable') {
      for (const row of c.rows) {
        const total = row.cells.reduce((s, cell) => s + Math.max(0.01, cell.weight), 0) || 1;
        let x = left;
        for (const cell of row.cells) {
          const w = (c.width * Math.max(0.01, cell.weight)) / total;
          out.push({ band, left: x, right: x + w, expression: cell.data.expression, text: cell.text });
          x += w;
        }
      }
      return;
    }
    out.push({ band, left, right: left + c.width, expression: c.data.expression, text: c.text });
  };
  band.controls.filter((c) => c.visible).forEach(add);
  return out;
}

const centre = (p: { left: number; right: number }) => (p.left + p.right) / 2;
const SUM_OF_FIELD = /^sumSum\(\s*\[([^\][]+)\]\s*\)$/i;

/** Every total in a footer, with the caption over its column and the Detail field printed there. */
function totalsOf(xml: string) {
  const structure = parseReportStructure(xml);
  const bands = structure.bands;
  const captions = HEADERS.flatMap((kind) => bands.filter((b) => b.kind === kind).flatMap(placesOf)).filter((p) => !p.expression && p.text.trim() && p.text.length <= 40);
  const detail = bands.filter((b) => b.kind === 'Detail').flatMap(placesOf).filter((p) => p.expression && /^\[[^\][]+\]$/.test(p.expression.trim()));
  return bands
    .filter((b) => FOOTERS.has(b.kind))
    .flatMap(placesOf)
    .filter((p) => p.expression && /\bsum\w+\s*\(/i.test(p.expression))
    .map((p) => {
      const at = centre(p);
      const caption = captions.find((c) => c.left <= at && at <= c.right)?.text.trim() ?? '';
      const under = detail
        .filter((d) => d.left <= at && at <= d.right)
        .sort((a, b) => Math.abs(centre(a) - at) - Math.abs(centre(b) - at))[0];
      return { place: p, caption, column: under ? under.expression!.trim().slice(1, -1) : null };
    });
}

/** `sum-of-ratio`: a sum over a column the page calls a ratio. Needs no records. */
export function sumOfRatio(xml: string): RepxFinding[] {
  const found = totalsOf(xml).filter((t) => {
    const field = SUM_OF_FIELD.exec(t.place.expression!.trim())?.[1];
    return field && (saysRatio(t.caption) || saysRatio(field));
  });
  if (!found.length) return [];
  const named = [...new Set(found.map((t) => t.caption || SUM_OF_FIELD.exec(t.place.expression!.trim())![1]))];
  return [
    {
      severity: 'warning',
      code: 'sum-of-ratio',
      message: `${named.map((n) => `"${n}"`).join(', ')} ${named.length === 1 ? 'is' : 'are'} totalled as a sum, but a percentage, ratio or average is never added up. ` +
        'Use its average (sumAvg) or an average weighted by the amount it is a share of.',
    },
  ];
}

/** The decimals a page figure prints with. */
const decimalsOf = (text: string) => /\.(\d+)/.exec(text.replace(/,/g, ''))?.[1].length ?? 0;
const round = (x: number, d: number) => Math.round(x * 10 ** d + 1e-9 * Math.sign(x)) / 10 ** d;

/** A total evaluated over some records, as a number, or null when it is not one. */
function evaluateOver(expression: string, records: readonly TypedRow[]): number | null {
  if (!records.length) return null;
  const params = () => null;
  const value: Value = evaluateText(expression, rowEnv(records[records.length - 1], params, (name, args) => aggregate(name, args, records, records.length - 1, params)));
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || value instanceof Date) return null;
  const n = toNumber(value);
  return Number.isFinite(n) ? n : null;
}

/** Whether a total reproduces every figure the page prints for it. */
function reproduces(expression: string, scopes: readonly { records: TypedRow[]; figure: string }[]): boolean {
  return scopes.every((s) => {
    const want = Number(valueOfText(s.figure));
    const got = evaluateOver(expression, s.records);
    if (!Number.isFinite(want) || got === null) return false;
    const d = decimalsOf(valueOfText(s.figure));
    return round(got, d) === round(want, d);
  });
}

interface Judged {
  band: string;
  expression: string;
  column: string;
  caption: string;
  scopes: { records: TypedRow[]; figure: string }[];
  /** What the total prints over each scope, for the message. */
  printed: (number | null)[];
  agrees: boolean;
}

/** Each footer total the page shows a figure for, judged against it. */
function judge(xml: string, page: PageRows): Judged[] {
  const typed = typeRows(page.rows);
  const out: Judged[] = [];
  for (const t of totalsOf(xml)) {
    if (!t.column || t.place.band.kind === 'PageFooter') continue;
    const forGroups = t.place.band.kind === 'GroupFooter';
    const figures = page.totals.filter((p) => (forGroups ? p.group !== null : p.group === null) && p.figures[t.column!]);
    if (!figures.length) continue;
    const scopes = figures.map((f) => ({
      records: f.group === null ? typed : (page.groups[f.group] ?? []).map((i) => typed[i]),
      figure: f.figures[t.column!],
    }));
    const expression = t.place.expression!.trim();
    out.push({
      band: t.place.band.name,
      expression,
      column: t.column,
      caption: t.caption,
      scopes,
      printed: scopes.map((s) => evaluateOver(expression, s.records)),
      agrees: reproduces(expression, scopes),
    });
  }
  return out;
}

/**
 * `total-disagrees-with-page`: a total that works out differently from the
 * page's own figure. An error, which sends the report back, only when it is
 * plainly the wrong kind of total: a percentage, ratio or average column whose
 * total falls outside the smallest and largest of the values it totals, as a
 * sum of percentages does and an average cannot (CC-05's own measure). Any
 * other difference is a warning: a figure OCR misread, or a page whose
 * figures no formula gives, as the reference's sales page had, would
 * otherwise spend a request on a report that is right.
 */
export function checkTotals(xml: string, page: PageRows | null): RepxFinding[] {
  if (!page) return [];
  return judge(xml, page)
    .filter((j) => !j.agrees)
    .map((j) => {
      const i = j.printed.findIndex((n, k) => n === null || round(n, decimalsOf(j.scopes[k].figure)) !== round(Number(valueOfText(j.scopes[k].figure)), decimalsOf(j.scopes[k].figure)));
      const k = Math.max(0, i);
      const printed = j.printed[k];
      const outside = j.scopes.some((s, n) => {
        const values = s.records.map((r) => (r[j.column] === null || r[j.column] === undefined ? NaN : toNumber(r[j.column]))).filter(Number.isFinite);
        const got = j.printed[n];
        return got !== null && values.length > 0 && (got < Math.min(...values) - 1e-9 || got > Math.max(...values) + 1e-9);
      });
      return {
        severity: (saysRatio(j.caption) || saysRatio(j.column)) && outside ? ('error' as const) : ('warning' as const),
        code: 'total-disagrees-with-page',
        message: `The total under "${j.caption || j.column}" prints ${printed === null ? 'nothing' : round(printed, decimalsOf(j.scopes[k].figure))} where the page shows ${j.scopes[k].figure}.`,
      };
    });
}

/** The money columns of the records: every field whose values are all numbers. */
function numericFields(page: PageRows): string[] {
  const fields = [...new Set(page.rows.flatMap((r) => Object.keys(r)))];
  return fields.filter((f) => page.rows.every((r) => r[f] === undefined || r[f] === '' || /^-?\d+(\.\d+)?$/.test(r[f])) && page.rows.some((r) => r[f]));
}

/**
 * Each total the page disagrees with, rewritten when exactly one candidate
 * reproduces every figure the page prints for it; the others are left alone.
 */
export function repairTotals(xml: string, page: PageRows | null): { xml: string; applied: boolean; reason: string } {
  if (!page) return { xml, applied: false, reason: 'no records read from the page' };
  const numbers = numericFields(page);
  let out = xml;
  const did: string[] = [];
  for (const j of judge(xml, page)) {
    if (j.agrees) continue;
    const others = numbers.filter((f) => f !== j.column);
    const candidates = [`sumSum([${j.column}])`, `sumAvg([${j.column}])`, ...others.map((m) => `sumSum([${m}] * [${j.column}]) / sumSum([${m}])`)].filter((c) => c !== j.expression);
    const fit = candidates.filter((c) => reproduces(c, j.scopes));
    if (fit.length !== 1) continue;
    const next = replaceInBand(out, j.band, j.expression, fit[0]);
    if (next !== out) {
      out = next;
      did.push(`${j.expression} -> ${fit[0]} in ${j.band}`);
    }
  }
  return did.length ? { xml: out, applied: true, reason: `totals made to print the page's figures: ${did.join('; ')}` } : { xml, applied: false, reason: 'no total had exactly one form that prints the page' };
}

/** One band's part of the file, by its Name, with the Text binding whose expression is `from` rewritten. */
function replaceInBand(xml: string, band: string, from: string, to: string): string {
  const open = new RegExp(`<Item\\d+\\b[^>]*\\sControlType="\\w+Band"[^>]*\\sName="${band.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`).exec(xml);
  if (!open) return xml;
  const start = open.index + open[0].length;
  const rest = xml.slice(start);
  const next = rest.search(/<Item\d+\b[^>]*\sControlType="\w+Band"|<\/Bands>/);
  const end = start + (next < 0 ? rest.length : next);
  const part = xml.slice(start, end).replace(/(<Item\d+\b(?=[^>]*\sPropertyName="Text")[^>]*\sExpression=")([^"]*)(")/g, (whole, a: string, value: string, b: string) =>
    unescapeXml(value).trim() === from ? `${a}${escapeXmlAttribute(to)}${b}` : whole,
  );
  return xml.slice(0, start) + part + xml.slice(end);
}
