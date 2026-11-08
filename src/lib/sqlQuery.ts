/**
 * What a report reads from a SQL Server database (2026-11-08, the SQL Server
 * programme, checklist items 12 to 14): a table or view with the joins its
 * foreign keys suggest, a stored procedure, or custom SQL, and the options a
 * built query carries. Pure, so the Data tab's browser and the writer that
 * puts it into the .repx (batch DD, `repxSqlDataSource.ts`) agree on one
 * shape. Its DevExpress form was measured in batch DA: a SelectQuery's
 * tables, columns, relations, filter, sort and Top; a StoredProcQuery's
 * parameters; a CustomSqlQuery's text.
 *
 * Custom SQL is opt-in and checked, as DevExpress's own designer keeps it off
 * by default and allows SELECT only (its docs call the default validator "not
 * safe", and warn of injection): one statement, a SELECT (or WITH ... SELECT),
 * and none of the words that write, run or grant. It is a guard against a
 * mistake, not a sandbox; the report runs with whatever rights its
 * connection has, which is why DevExpress and Telerik both advise a
 * read-only login.
 */
import type { SqlColumn, SqlSchema } from './sqlSchema';
import { stripComments, typeLabel } from './sqlSchema';

export interface QueryJoin {
  /** `dbo.Customers`. */
  table: string;
  /** Pairs of columns: the first table's, then the joined table's. */
  on: { from: string; to: string }[];
  /** DevExpress writes Inner or LeftOuter. */
  type: 'Inner' | 'LeftOuter';
}

export type ReportQuery =
  | {
      kind: 'table';
      /** `dbo.Orders`: a table or a view. */
      object: string;
      /** Columns to select, `table.column`; empty selects every column of every table. */
      columns: string[];
      joins: QueryJoin[];
      /** A DevExpress criteria string, `[Customers.Region] = ?Region`. */
      filter?: string;
      sort?: { column: string; descending?: boolean }[];
      top?: number;
      distinct?: boolean;
      /**
       * Tables pointing back at this one (an order's lines), each printed as a
       * master-detail band rather than joined, which would repeat the order
       * once per line (batch DD writes the relation and the band).
       */
      details?: QueryJoin[];
    }
  | { kind: 'procedure'; procedure: string }
  | { kind: 'custom'; name: string; sql: string };

export interface QueryField {
  name: string;
  /** Where it comes from: `dbo.Orders`, a procedure's name, or the custom query's. */
  source: string;
  column: SqlColumn;
}

const full = (o: { schema: string; name: string }) => `${o.schema}.${o.name}`;

/** The table or view by `schema.name`, or by bare name when it is unique. */
export function findObject(schema: SqlSchema, name: string) {
  const exact = schema.objects.find((o) => full(o).toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  const bare = schema.objects.filter((o) => o.name.toLowerCase() === name.replace(/^.*\./, '').toLowerCase());
  return bare.length === 1 ? bare[0] : undefined;
}

export function findProcedure(schema: SqlSchema, name: string) {
  return schema.procedures.find((p) => full(p).toLowerCase() === name.toLowerCase()) ?? schema.procedures.find((p) => p.name.toLowerCase() === name.replace(/^.*\./, '').toLowerCase());
}

/**
 * The joins a table's foreign keys suggest, both ways: the tables it points
 * at (an order's customer) and the tables pointing at it (an order's lines,
 * which DevExpress would rather have as a master-detail relation, batch DD).
 */
export function suggestJoins(schema: SqlSchema, object: string): { join: QueryJoin; direction: 'references' | 'referencedBy'; label: string }[] {
  const out: { join: QueryJoin; direction: 'references' | 'referencedBy'; label: string }[] = [];
  const me = object.toLowerCase();
  for (const fk of schema.foreignKeys) {
    if (fk.table.toLowerCase() === me) {
      out.push({
        direction: 'references',
        join: { table: fk.references, type: fk.columns.length && isNullable(schema, fk.table, fk.columns[0].column) ? 'LeftOuter' : 'Inner', on: fk.columns.map((c) => ({ from: c.column, to: c.referencedColumn })) },
        label: `${fk.references} on ${fk.columns.map((c) => `${c.column} = ${c.referencedColumn}`).join(' and ')}`,
      });
    } else if (fk.references.toLowerCase() === me) {
      out.push({
        direction: 'referencedBy',
        join: { table: fk.table, type: 'Inner', on: fk.columns.map((c) => ({ from: c.referencedColumn, to: c.column })) },
        label: `${fk.table} on ${fk.columns.map((c) => `${c.referencedColumn} = ${c.column}`).join(' and ')}`,
      });
    }
  }
  return out;
}

/** A nullable foreign key joins as a left outer join, so rows without a match still print. */
function isNullable(schema: SqlSchema, table: string, column: string): boolean {
  return findObject(schema, table)?.columns.find((c) => c.name === column)?.nullable === true;
}

/** What a query returns, in order, with types, as the Field List will show it. */
export function queryFields(schema: SqlSchema, query: ReportQuery): QueryField[] {
  if (query.kind === 'procedure') {
    const proc = findProcedure(schema, query.procedure);
    return (proc?.result ?? []).map((column) => ({ name: column.name, source: proc ? full(proc) : query.procedure, column }));
  }
  if (query.kind === 'custom') {
    return selectedNames(query.sql).map((name) => ({ name, source: query.name, column: { name, type: '' } }));
  }
  const tables = [query.object, ...query.joins.map((j) => j.table)];
  const out: QueryField[] = [];
  for (const table of tables) {
    const obj = findObject(schema, table);
    if (!obj) continue;
    for (const column of obj.columns) {
      const key = `${full(obj)}.${column.name}`;
      if (query.columns.length && !query.columns.some((c) => c.toLowerCase() === key.toLowerCase() || c.toLowerCase() === `${obj.name}.${column.name}`.toLowerCase())) continue;
      out.push({ name: column.name, source: full(obj), column });
    }
  }
  return out;
}

/** Field names selected twice across a join, which the report cannot tell apart by name. */
export function duplicateFields(fields: readonly QueryField[]): string[] {
  const seen = new Map<string, number>();
  for (const f of fields) seen.set(f.name.toLowerCase(), (seen.get(f.name.toLowerCase()) ?? 0) + 1);
  return [...new Set(fields.filter((f) => (seen.get(f.name.toLowerCase()) ?? 0) > 1).map((f) => f.name))];
}

/** The column names a simple SELECT list gives, for a custom query's field list before DevExpress reads it. */
export function selectedNames(sql: string): string[] {
  const clean = stripComments(sql);
  const select = /\bSELECT\s+(?:DISTINCT\s+)?(?:TOP\s*\(?\s*[@\w]+\s*\)?\s*(?:PERCENT\s+)?)?([\s\S]*?)\bFROM\b/i.exec(clean);
  if (!select) return [];
  return select[1]
    .split(/,(?![^(]*\))/)
    .map((expr) => {
      const alias = /\bAS\s+\[?([\w ]+?)\]?\s*$/i.exec(expr.trim()) ?? /^\[?([\w ]+?)\]?\s*=/.exec(expr.trim());
      if (alias) return alias[1].trim();
      const last = /(\[[^\]]+\]|[A-Za-z_]\w*)\s*$/.exec(expr.trim());
      return last && !/\)\s*$/.test(expr) ? last[1].replace(/^\[|\]$/g, '') : '';
    })
    .filter((n) => n && n !== '*');
}

const WRITES = /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|DENY|REVOKE|BACKUP|RESTORE|SHUTDOWN|DBCC|OPENROWSET|OPENDATASOURCE|xp_\w+|sp_\w+)\b/i;

/** Text with the inside of string literals blanked, so a word in a string is not read as SQL. */
function withoutStrings(sql: string): string {
  return sql.replace(/N?'(?:[^']|'')*'/g, "''");
}

/**
 * Custom SQL's check: one SELECT statement, nothing that writes, runs or
 * grants, and the `@parameters` it names, which become query parameters.
 */
export function checkCustomSql(sql: string): { ok: boolean; problems: string[]; parameters: string[] } {
  const code = withoutStrings(stripComments(sql)).trim();
  const problems: string[] = [];
  if (!code) problems.push('Write a SELECT statement.');
  else {
    if (!/^(\(?\s*SELECT\b|WITH\b[\s\S]*\bSELECT\b)/i.test(code)) problems.push('Only a SELECT (or WITH ... SELECT) can feed a report.');
    const statements = code.split(';').map((s) => s.trim()).filter(Boolean);
    if (statements.length > 1) problems.push('One statement only: a report reads one result.');
    const word = WRITES.exec(code);
    if (word) problems.push(`"${word[1]}" is not allowed in a report’s query: it writes, runs or grants.`);
    if (/\bSELECT\b[^;]*\bINTO\b/i.test(code)) problems.push('SELECT ... INTO creates a table; a report only reads.');
  }
  const parameters = [...new Set([...code.matchAll(/(?<![@\w])@([A-Za-z_]\w*)/g)].map((m) => `@${m[1]}`))];
  return { ok: problems.length === 0, problems, parameters };
}

/** The report parameters a query needs: a procedure's inputs, a filter's `?names`, custom SQL's `@names`. */
export function queryParameters(schema: SqlSchema, query: ReportQuery): { name: string; type: string; defaultValue?: string }[] {
  if (query.kind === 'procedure') {
    const proc = findProcedure(schema, query.procedure);
    return (proc?.parameters ?? []).filter((p) => !p.output).map((p) => ({ name: p.name.replace(/^@/, ''), type: typeLabel(p), ...(p.defaultValue !== undefined ? { defaultValue: p.defaultValue } : {}) }));
  }
  if (query.kind === 'custom') return checkCustomSql(query.sql).parameters.map((p) => ({ name: p.slice(1), type: '' }));
  const names = [...new Set([...(query.filter ?? '').matchAll(/\?([A-Za-z_]\w*)/g)].map((m) => m[1]))];
  return names.map((name) => ({ name, type: '' }));
}

/** The query's name in the report, DevExpress's `DataMember`: the object's name, a procedure's without its `usp_`. */
export function queryName(query: ReportQuery): string {
  if (query.kind === 'custom') return query.name || 'Query';
  const name = (query.kind === 'table' ? query.object : query.procedure).replace(/^.*\./, '');
  return query.kind === 'procedure' ? name.replace(/^(usp|sp|proc)_/i, '') || name : name;
}

/** A one-line description: "dbo.Orders with dbo.Customers, filtered, sorted by OrderDate, top 500". */
export function describeQuery(query: ReportQuery): string {
  if (query.kind === 'procedure') return `stored procedure ${query.procedure}`;
  if (query.kind === 'custom') return `custom SQL "${query.name}"`;
  const parts = [query.object + (query.joins.length ? ` with ${query.joins.map((j) => j.table).join(', ')}` : '')];
  if (query.filter) parts.push('filtered');
  if (query.sort?.length) parts.push(`sorted by ${query.sort.map((s) => `${s.column.replace(/^.*\./, '')}${s.descending ? ' descending' : ''}`).join(', ')}`);
  if (query.top) parts.push(`top ${query.top}`);
  if (query.distinct) parts.push('distinct rows');
  if (query.details?.length) parts.push(`each with its ${query.details.map((d) => d.table).join(', ')}`);
  return parts.join(', ');
}

/** The field type the Data tab's mapping uses, from a SQL column. */
export function fieldKind(column: SqlColumn): 'string' | 'number' | 'date' | 'boolean' {
  if (/^(int|bigint|smallint|tinyint|decimal|numeric|money|smallmoney|float|real)$/.test(column.type)) return 'number';
  if (/^(date|datetime|datetime2|smalldatetime|datetimeoffset|time)$/.test(column.type)) return 'date';
  if (column.type === 'bit') return 'boolean';
  return 'string';
}
