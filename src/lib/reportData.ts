/**
 * The Preview's data: test rows typed as DevExpress would type them, the
 * environment an expression is evaluated in, and the aggregates a summary
 * computes.
 *
 * Test data arrives as strings. DevExpress reads a data table whose columns
 * have types, and the types decide what prints: a decimal keeps its scale, an
 * integer divides by truncating, a date prints in the general pattern. So each
 * column is typed by what all of its values look like -- whole numbers, numbers
 * with a point, ISO dates, true/false -- the way `RepxProbe render` types a
 * data source.
 *
 * The aggregates are the ones DevExpress printed in case s16 of
 * `docs/proposals/devexpress-parity.md` (2026-10-30): over six prices the sum
 * was `163.323` and the average `27.2205`, both exact; the average of six
 * integers was the 28-place decimal `5.3333333333333333333333333333`; the
 * median of 1, 3, 4, 6, 8 and 10 was `5`; the distinct count of six booleans
 * was `2`; and a running sum and a record number counted 1, 5, 11 ... and
 * 1, 2, 3 ... down the records.
 */
import { NetDecimal } from './netDecimal';
import { compareValues, evaluate, evaluateText, parseDate, toNumber, valueText, type Env, type Node, type Value } from './criteria';
import { formatComposite } from './netFormat';

export type TypedRow = Record<string, Value>;

type ColumnType = 'int' | 'decimal' | 'date' | 'bool' | 'string';

const INT = /^-?\d+$/;
const DECIMAL = /^-?\d*\.?\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/;
const BOOL = /^(true|false)$/i;

function columnType(values: string[]): ColumnType {
  const present = values.map((v) => v.trim()).filter(Boolean);
  if (!present.length) return 'string';
  if (present.every((v) => INT.test(v) && Math.abs(Number(v)) <= 2 ** 31)) return 'int';
  if (present.every((v) => DECIMAL.test(v))) return 'decimal';
  if (present.every((v) => ISO_DATE.test(v))) return 'date';
  if (present.every((v) => BOOL.test(v))) return 'bool';
  return 'string';
}

function typed(text: string | undefined, type: ColumnType): Value {
  if (text === undefined || text.trim() === '') return null;
  switch (type) {
    case 'int': return BigInt(text.trim());
    case 'decimal': return NetDecimal.parse(text);
    case 'date': return parseDate(text);
    case 'bool': return text.trim().toLowerCase() === 'true';
    default: return text;
  }
}

/** Type every column of string rows by what all of its values look like. */
export function typeRows(rows: readonly Record<string, string>[]): TypedRow[] {
  const fields = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const types = Object.fromEntries(fields.map((f) => [f, columnType(rows.map((r) => r[f] ?? ''))]));
  return rows.map((r) => Object.fromEntries(fields.map((f) => [f, typed(r[f], types[f])])));
}

/** A calculated field, as the report declares it. */
export interface CalculatedField {
  name: string;
  expression: string;
}

/**
 * Add each calculated field to each row, in declaration order, so a later one
 * may use an earlier one. Printed: `[Total]` declared as `[Qty] * [Price]`
 * printed exactly what the expression did, `4.0` included.
 */
export function withCalculatedFields(rows: TypedRow[], fields: readonly CalculatedField[], params: (name: string) => Value): TypedRow[] {
  if (!fields.length) return rows;
  return rows.map((row) => {
    const out: TypedRow = { ...row };
    for (const f of fields) out[f.name] = evaluateText(f.expression, rowEnv(out, params));
    return out;
  });
}

/** An environment that reads one row's fields; a field it lacks is null. */
export function rowEnv(row: TypedRow | null, params: (name: string) => Value, aggregate?: Env['aggregate']): Env {
  return {
    field: (name) => (row && name in row ? row[name] : null),
    param: params,
    aggregate,
  };
}

// --------------------------------------------------------------- aggregates

const isInt = (v: Value): v is bigint => typeof v === 'bigint';
const isDec = (v: Value): v is NetDecimal => v instanceof NetDecimal;

/** Sum in the values' own type: integers stay integers, any decimal makes a decimal. */
function sum(values: Value[]): Value {
  const nums = values.filter((v) => v !== null);
  if (!nums.length) return null;
  if (nums.every(isInt)) return (nums as bigint[]).reduce((a, b) => a + b, 0n);
  if (nums.every((v) => isInt(v) || isDec(v))) {
    return nums.reduce<NetDecimal>((a, b) => a.add(isDec(b) ? b : NetDecimal.fromInt(b as bigint)), new NetDecimal(0n, 0));
  }
  return nums.reduce<number>((a, b) => a + toNumber(b), 0);
}

/** An average: a decimal division for integers and decimals, as DevExpress printed. */
function average(values: Value[]): Value {
  const nums = values.filter((v) => v !== null);
  if (!nums.length) return null;
  const total = sum(nums);
  if (isInt(total)) return NetDecimal.fromInt(total).div(NetDecimal.fromInt(BigInt(nums.length)));
  if (isDec(total)) return total.div(NetDecimal.fromInt(BigInt(nums.length)));
  return toNumber(total) / nums.length;
}

const distinct = (values: Value[]) => {
  const seen: Value[] = [];
  for (const v of values) if (v !== null && !seen.some((s) => compareValues(s, v) === 0)) seen.push(v);
  return seen;
};

/**
 * Evaluate an aggregate over `scope` -- the records the summary runs over --
 * with `position` the current record's index in it, for the running kinds.
 */
export function aggregate(
  name: string,
  args: Node[],
  scope: readonly TypedRow[],
  position: number,
  params: (name: string) => Value,
): Value {
  const of = (rows: readonly TypedRow[]) =>
    args.length ? rows.map((row) => evaluate(args[0], rowEnv(row, params))) : rows.map(() => 1n as Value);
  switch (name) {
    case 'sumsum': return sum(of(scope));
    case 'sumrunningsum': return sum(of(scope.slice(0, position + 1)));
    case 'sumcount': return BigInt(of(scope).filter((v) => v !== null).length);
    case 'sumavg': return average(of(scope));
    case 'summin': return of(scope).filter((v) => v !== null).reduce<Value>((a, b) => (a === null || (compareValues(b, a) ?? 0) < 0 ? b : a), null);
    case 'summax': return of(scope).filter((v) => v !== null).reduce<Value>((a, b) => (a === null || (compareValues(b, a) ?? 0) > 0 ? b : a), null);
    case 'sumdcount': return BigInt(distinct(of(scope)).length);
    case 'sumdsum': return sum(distinct(of(scope)));
    case 'sumdavg': return average(distinct(of(scope)));
    case 'sumrecordnumber': return BigInt(position + 1);
    case 'summedian': {
      const sorted = of(scope).filter((v) => v !== null).sort((a, b) => compareValues(a, b) ?? 0);
      if (!sorted.length) return null;
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : average([sorted[mid - 1], sorted[mid]]);
    }
    case 'sumpercentage': {
      const total = sum(of(scope));
      const here = of(scope.slice(position, position + 1))[0];
      if (here === null || total === null || toNumber(total) === 0) return null;
      return toNumber(here) / toNumber(total);
    }
  }
  return null;
}

/** How a value prints with no format, re-exported for the renderer. */
export { valueText };

// ------------------------------------------------------------ band text

/**
 * What a control or cell prints from data, read from the file.
 *
 * `expression` is the whole `Text` binding -- not just its first field -- so
 * `'Order ' + [OrderID]` and `sumSum([Amount])` print what they compute.
 * `running` is the `<Summary>` scope: `Group`, `Report` or `Page`; `None` for a
 * `<Summary>` with no scope; null for no `<Summary>` at all. Both of the last
 * two make an aggregate print nothing, as DevExpress printed.
 */
export interface TextData {
  expression: string | null;
  running: string | null;
  /** `TextFormatString`, decoded. */
  format: string | null;
}

/**
 * Which records one printed band reads, as indices into the report's records
 * in print order.
 *
 * Measured in case s17 of `docs/proposals/devexpress-parity.md` (2026-10-30),
 * 50 records in three groups over three pages, every scope in every band:
 *
 * - **a total is the whole scope's, wherever it prints**: `sumSum` with
 *   `Running="Group"` printed the group's total on every Detail record and in
 *   the group HEADER too; `Page` printed the whole page's total in the page
 *   header, before the page's records;
 * - **a page is every record with any part on it**: a record split across a
 *   page break counted on both pages, and every part of it read the page it
 *   finished on -- the part left on page 1 printed page 2's total;
 * - **a running summary runs to the end of the band's extent**: through the
 *   current record in Detail, through the group's last record in a group header
 *   or footer, the page's in a page header or footer, the report's in the
 *   report header or footer;
 * - **a bound field reads the extent's first record in a header and its last in
 *   a footer**: `[Qty]` printed 1, 16, 36 in the group headers and 15, 35, 50
 *   in the footers;
 * - **`Group` outside the group bands and Detail prints `?`**, format or not,
 *   and so does `Group` in Detail when the report has no group bands (s17b).
 */
export interface TextScope {
  /** The record a bound field reads; null when there is none. */
  row: number | null;
  /** A running summary runs through this record; null when there is none. */
  anchor: number | null;
  report: readonly number[];
  /** Null outside the group bands and Detail. */
  group: readonly number[] | null;
  /** Null until the page is known, when the report stands in for it. */
  page: readonly number[] | null;
}

const AGGREGATE_CALL = /\bsum\w+\s*\(/i;
const isRunningKind = (name: string) => name === 'sumrunningsum' || name === 'sumrecordnumber';

/** A parameter's default, typed by its declared type or, when lifted, by its look. */
function parameterValue(type: string, text: string): Value {
  switch (type) {
    case 'System.Int16': case 'System.Int32': case 'System.Int64':
      return INT.test(text.trim()) ? BigInt(text.trim()) : null;
    case 'System.Decimal': return NetDecimal.parse(text);
    case 'System.Double': case 'System.Single': return text.trim() === '' ? null : Number(text);
    case 'System.DateTime': return parseDate(text);
    case 'System.Boolean': return text.trim().toLowerCase() === 'true';
    case 'System.String': return text;
  }
  return typed(text, columnType([text]));
}

/** Records up to and including `anchor` in an ascending list, less one: a position. */
function positionOf(indices: readonly number[], anchor: number | null): number {
  if (anchor === null) return -1;
  let lo = 0;
  let hi = indices.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (indices[mid] <= anchor) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * The Preview's data: typed records, parameter values, and the text a bound
 * control prints. Aggregates are cached per scope, and a running sum is one
 * prefix pass rather than a sum per record, so a long report costs a pass per
 * summary rather than a pass per record per summary.
 */
export class ReportData {
  private readonly params: Map<string, Value>;
  private readonly cache = new WeakMap<readonly number[], Map<string, Map<Node[], Value | Value[]>>>();
  private readonly scopeRows = new WeakMap<readonly number[], TypedRow[]>();

  private constructor(readonly records: TypedRow[], params: Map<string, Value>) {
    this.params = params;
  }

  /**
   * From the Preview's string rows: typed by column, record n reading row
   * (n modulo the row count), with the report's calculated fields added.
   */
  static from(
    rows: readonly Record<string, string>[],
    count: number,
    calculated: readonly CalculatedField[],
    parameters: readonly { name: string; type: string; value: string }[],
  ): ReportData {
    const params = new Map(parameters.map((p) => [p.name, parameterValue(p.type, p.value)] as const));
    const lookup = (name: string) => params.get(name) ?? null;
    const typedRows = withCalculatedFields(typeRows(rows), calculated, lookup);
    const records = typedRows.length ? Array.from({ length: count }, (_, i) => typedRows[i % typedRows.length]) : [];
    return new ReportData(records, params);
  }

  readonly param = (name: string): Value => this.params.get(name) ?? null;

  /** What a control bound to `data` prints in `scope`; null when it has no binding. */
  text(data: TextData, scope: TextScope): string | null {
    if (data.expression === null) return null;
    if (AGGREGATE_CALL.test(data.expression)) {
      // Printed: no <Summary>, or one with no scope, is blank; Group outside a group is "?".
      if (data.running === null || data.running === 'None') return '';
      if (data.running === 'Group' && !scope.group) return '?';
    }
    const extent =
      data.running === 'Group' ? scope.group! : data.running === 'Page' ? scope.page ?? scope.report : scope.report;
    const row = scope.row === null ? null : this.records[scope.row] ?? null;
    const env = rowEnv(row, this.param, (name, args) => this.aggregate(name, args, extent, scope.anchor));
    const value = evaluateText(data.expression, env);
    // Printed: a null prints nothing, even inside "Total: {0:c2}".
    if (value === null) return '';
    return data.format !== null ? formatComposite(data.format, [value]) : valueText(value);
  }

  private rowsOf(indices: readonly number[]): TypedRow[] {
    let rows = this.scopeRows.get(indices);
    if (!rows) {
      rows = indices.map((i) => this.records[i]);
      this.scopeRows.set(indices, rows);
    }
    return rows;
  }

  private aggregate(name: string, args: Node[], indices: readonly number[], anchor: number | null): Value {
    const position = positionOf(indices, anchor);
    if (name === 'sumrecordnumber') return position < 0 ? null : BigInt(position + 1);
    let byName = this.cache.get(indices);
    if (!byName) this.cache.set(indices, (byName = new Map()));
    let byArgs = byName.get(name);
    if (!byArgs) byName.set(name, (byArgs = new Map()));
    let cached = byArgs.get(args);
    if (cached === undefined) {
      const rows = this.rowsOf(indices);
      if (isRunningKind(name)) {
        // One pass: the running sum at every position.
        const prefix: Value[] = [];
        let total: Value = null;
        for (const row of rows) {
          const v = args.length ? evaluate(args[0], rowEnv(row, this.param)) : 1n;
          total = v === null ? total : total === null ? v : sum([total, v]);
          prefix.push(total);
        }
        cached = prefix;
      } else {
        cached = aggregate(name, args, rows, rows.length - 1, this.param);
      }
      byArgs.set(args, cached);
    }
    if (Array.isArray(cached)) return position < 0 ? null : cached[Math.min(position, cached.length - 1)] ?? null;
    return cached;
  }
}
