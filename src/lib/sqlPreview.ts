/**
 * The Preview over a SQL Server database's own shapes (2026-11-09, the SQL
 * Server programme, batch DF, checklist items 27 and 28).
 *
 * Until now the Preview's rows were AI test data typed by what the values
 * looked like, which reads a product code "00123" as the integer 123 and a
 * price "12.5" as a decimal of scale 1 where SQL Server's `decimal(10,2)`
 * hands DevExpress 12.50. With a database's layout, each field is typed as
 * SqlClient delivers it to DevExpress (`hintOf`): integers, a decimal at its
 * declared scale (money at four places), a float, a date, a bit, text. The
 * rows themselves are the database's own sample rows, from Forma's sample
 * script, when the user ran it; otherwise the AI's, typed the same way.
 *
 * What the database would do before DevExpress sees a row is done here or
 * handed to the paginator: the query's joins over the sample rows (a left
 * outer join keeping a row with no match, an inner one dropping it), its sort,
 * distinct and Top; its filter, which reads the parameters the reader types
 * in the Preview, as `sourceFilter`; a detail report's rows for each master,
 * by the relation's keys, as `related`; and each parameter's lookup list, its
 * cascade evaluated over the lookup's sample rows (`choicesFor`).
 *
 * The sample rows are a few rows of each table taken on their own, so a join
 * can find no match where the database would; that is said rather than hidden.
 */
import type { SqlColumn, SqlSchema } from './sqlSchema';
import { findObject, queryFields, type ReportQuery } from './sqlQuery';
import { readRepxDataSources } from './repxSqlDataSource';
import { evaluate, isTrue, parseCriteria } from './criteria';
import { expandMultiValue, rowEnv, typeRows } from './reportData';

export type RecordValues = Record<string, string>;

const full = (o: { schema: string; name: string }) => `${o.schema}.${o.name}`;

/** A sample value as the Preview's string rows hold it. */
const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

/**
 * How a SQL type reaches DevExpress through SqlClient, as `typeRows` takes a
 * hint: `int`, `decimal:<scale>`, `double`, `date`, `bool` or `string`. A
 * `time` or `datetimeoffset` stays text, as their result-schema type was
 * measured `Unknown` (batch DD).
 */
export function hintOf(column: Pick<SqlColumn, 'type' | 'scale'>): string {
  switch (column.type) {
    case 'int': case 'bigint': case 'smallint': case 'tinyint':
      return 'int';
    case 'decimal': case 'numeric':
      return `decimal:${column.scale ?? 0}`;
    case 'money': case 'smallmoney':
      return 'decimal:4';
    case 'float': case 'real':
      return 'double';
    case 'date': case 'datetime': case 'datetime2': case 'smalldatetime':
      return 'date';
    case 'bit':
      return 'bool';
    // Measured (2026-11-09): a DateTimeOffset prints "1/5/2026 1:45:00 PM +05:30", a Guid in lower case.
    case 'datetimeoffset':
      return 'dto';
    case 'uniqueidentifier':
      return 'guid';
    default:
      return 'string';
  }
}

/** Every field a query returns, with its type hint; a detail's fields too. */
export function fieldHints(schema: SqlSchema, query: ReportQuery): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of queryFields(schema, query)) if (!(f.name in out)) out[f.name] = hintOf(f.column);
  if (query.kind === 'table') {
    for (const d of query.details ?? []) {
      for (const c of findObject(schema, d.table)?.columns ?? []) if (!(c.name in out)) out[c.name] = hintOf(c);
    }
  }
  return out;
}

/** The SQL type of each field, as the AI is told it when it writes test data. */
export function fieldTypes(schema: SqlSchema, query: ReportQuery): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of queryFields(schema, query)) if (!(f.name in out)) out[f.name] = f.column.type ? `${f.column.type}${f.column.scale !== undefined ? `(${f.column.precision ?? ''},${f.column.scale})` : f.column.length ? `(${f.column.length})` : ''}` : 'unknown';
  return out;
}

/** A filter with its table names taken off, `[Customers.Region]` to `[Region]`: the rows carry fields by name. */
export function unqualified(filter: string): string {
  return filter.replace(/\[(?:[^\]]*\.)?([^\].]+)\]/g, '[$1]');
}

function compare(a: string, b: string, hint: string): number {
  if (a === b) return 0;
  if (a === '') return -1;
  if (b === '') return 1;
  if (hint === 'int' || hint === 'double' || hint.startsWith('decimal')) return Number(a) - Number(b);
  return a < b ? -1 : 1;
}

/**
 * A built query's rows over the database's sample rows (item 27), as SQL
 * Server would return them before its filter: the joins, then the sort,
 * distinct and Top. Null when the query is a procedure or custom SQL, which
 * only running them could sample, or when its table has no sample rows.
 */
export function sampleRows(schema: SqlSchema, query: ReportQuery): { rows: RecordValues[]; note: string } | null {
  if (query.kind !== 'table') return null;
  const base = findObject(schema, query.object);
  const own = base ? schema.samples?.[full(base)] : undefined;
  if (!base || !own?.length) return null;
  let rows: Record<string, unknown>[] = own.map((r) => ({ ...r }));
  const unmatched: string[] = [];
  for (const join of query.joins) {
    const other = findObject(schema, join.table);
    const theirs = other ? schema.samples?.[full(other)] ?? [] : [];
    let missed = 0;
    rows = rows.flatMap((row) => {
      const hits = theirs.filter((o) => join.on.every((k) => text(row[k.from]) === text(o[k.to])));
      if (hits.length) return hits.map((hit) => ({ ...hit, ...row }));
      missed++;
      // A left outer join keeps the row, its joined columns empty; an inner one drops it.
      return join.type === 'LeftOuter' ? [{ ...Object.fromEntries((other?.columns ?? []).map((c) => [c.name, null])), ...row }] : [];
    });
    if (missed) unmatched.push(`${missed} of the sample rows found no match in ${join.table}${theirs.length ? '' : ', which has no sample rows'}`);
  }
  const fields = queryFields(schema, query);
  const hints = fieldHints(schema, query);
  let out = rows.map((r) => Object.fromEntries(fields.map((f) => [f.name, text(r[f.name])])) as RecordValues);
  for (const s of [...(query.sort ?? [])].reverse()) {
    const name = s.column.replace(/^.*\./, '');
    out = [...out].sort((a, b) => compare(a[name] ?? '', b[name] ?? '', hints[name] ?? 'string') * (s.descending ? -1 : 1));
  }
  if (query.distinct) {
    const seen = new Set<string>();
    out = out.filter((r) => {
      const key = JSON.stringify(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (query.top) out = out.slice(0, query.top);
  const note = `${out.length} sample row${out.length === 1 ? '' : 's'} of ${query.object}${unmatched.length ? `; ${unmatched.join('; ')} (the sample rows were taken table by table)` : ''}`;
  return { rows: out, note };
}

/**
 * A detail report's rows for one master record (item 28): its `DataMember`
 * names a relation of the report's data source, whose detail query's table
 * has sample rows, kept where every key column matches the master's.
 */
export function relatedRows(schema: SqlSchema, repx: string): ((dataMember: string, master: RecordValues) => RecordValues[] | null) | undefined {
  const sources = readRepxDataSources(repx);
  const relations = sources.flatMap((s) => s.relations);
  if (!relations.length) return undefined;
  const queries = sources.flatMap((s) => s.queries);
  return (dataMember, master) => {
    const relation = relations.find((r) => r.name === dataMember.split('.').pop());
    const table = relation ? queries.find((q) => q.name === relation.detail)?.tables[0] : undefined;
    const obj = table ? findObject(schema, table) : undefined;
    if (!relation || !obj) return null;
    return (schema.samples?.[full(obj)] ?? [])
      .filter((r) => relation.keys.every((k) => text(r[k.detail]) === (master[k.master] ?? '')))
      .map((r) => Object.fromEntries(obj.columns.map((c) => [c.name, text(r[c.name])])) as RecordValues);
  };
}

const attrOf = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&') : undefined;
};

/** A parameter's lookup list, as `DynamicListLookUpSettings` names it (batch DD). */
export interface ParameterLookup {
  parameter: string;
  dataMember: string;
  valueMember: string;
  filter: string;
}

export function parameterLookups(repx: string): ParameterLookup[] {
  const block = /<Parameters>([\s\S]*?)<\/Parameters>/.exec(repx)?.[1] ?? '';
  const storage = /<ObjectStorage>([\s\S]*?)<\/ObjectStorage>/.exec(repx)?.[1] ?? '';
  const out: ParameterLookup[] = [];
  for (const m of block.matchAll(/<Item\d+\s[^>]*>/g)) {
    const ref = /ValueSourceSettings="#Ref-(\d+)"/.exec(m[0])?.[1];
    const name = attrOf(m[0], 'Name');
    if (!ref || !name) continue;
    const item = [...storage.matchAll(/<Item\d+\s[^>]*>/g)].map((s) => s[0]).find((s) => new RegExp(`\\sRef="${ref}"`).test(s) && /DynamicListLookUpSettings/.test(s));
    if (!item) continue;
    out.push({ parameter: name, dataMember: attrOf(item, 'DataMember') ?? '', valueMember: attrOf(item, 'ValueMember') ?? '', filter: attrOf(item, 'FilterString') ?? '' });
  }
  return out;
}

/**
 * Each parameter's choices (item 28): its lookup query's table's sample
 * values, distinct and in order, kept by the lookup's filter when it has one,
 * which reads the other parameters' current values: a cascade.
 */
export function choicesFor(
  schema: SqlSchema,
  repx: string,
  values: Readonly<Record<string, string>>,
  multi: ReadonlySet<string> = new Set(),
): Record<string, string[]> {
  const lookups = parameterLookups(repx);
  if (!lookups.length) return {};
  const queries = readRepxDataSources(repx).flatMap((s) => s.queries);
  const out: Record<string, string[]> = {};
  for (const l of lookups) {
    const table = queries.find((q) => q.name === l.dataMember)?.tables[0];
    const obj = table ? findObject(schema, table) : undefined;
    const rows = obj ? (schema.samples?.[full(obj)] ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, text(v)])) as RecordValues) : [];
    let kept = rows;
    if (l.filter) {
      try {
        const lists = new Map([...multi].map((name) => [name, { type: 'System.String', values: (values[name] ?? '').split(',').map((v) => v.trim()).filter(Boolean) }]));
        const node = parseCriteria(expandMultiValue(unqualified(l.filter), lists));
        const typed = typeRows(rows);
        const param = (name: string) => values[name] ?? null;
        kept = rows.filter((_, i) => {
          try {
            return isTrue(evaluate(node, rowEnv(typed[i], param)));
          } catch {
            return false;
          }
        });
      } catch {
        kept = rows;
      }
    }
    out[l.parameter] = [...new Set(kept.map((r) => r[l.valueMember] ?? '').filter(Boolean))];
  }
  return out;
}

/** Everything the Preview takes from a database at once. */
export interface SqlPreview {
  rows: RecordValues[] | null;
  note: string;
  hints: Record<string, string>;
  sourceFilter: string | null;
  related?: (dataMember: string, master: RecordValues) => RecordValues[] | null;
}

/**
 * The Preview's data from a database: the query chosen (or, failing that, the
 * report's own data source's first table), its sample rows if any, its types,
 * its filter and its detail rows.
 */
export function sqlPreview(repx: string | undefined | null, schema: SqlSchema, query: ReportQuery | null): SqlPreview | null {
  const xml = repx ?? '';
  const own = readRepxDataSources(xml)[0]?.queries[0];
  const chosen: ReportQuery | null = query ?? (own?.type === 'SelectQuery' && own.tables[0] ? { kind: 'table', object: own.tables[0], columns: [], joins: [], ...(own.filter ? { filter: own.filter } : {}) } : null);
  if (!chosen) return null;
  const sampled = sampleRows(schema, chosen);
  const filter = chosen.kind === 'table' && chosen.filter ? unqualified(chosen.filter) : null;
  return {
    rows: sampled?.rows ?? null,
    note: sampled?.note ?? (chosen.kind === 'table' ? `${chosen.object} has no sample rows: run Forma’s sample script for it, or use AI test data` : 'a stored procedure or custom SQL cannot be sampled without running it, so its test data is the AI’s, typed from its columns'),
    hints: fieldHints(schema, chosen),
    sourceFilter: filter,
    related: relatedRows(schema, xml),
  };
}
