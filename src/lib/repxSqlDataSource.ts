/**
 * The SQL data source inside a .repx (2026-11-08, the SQL Server programme).
 *
 * DevExpress keeps a report's `SqlDataSource` as a `ComponentStorage` item
 * whose `Base64` attribute is an XML document of its own. Its form was
 * measured, not read off the API docs: `RepxProbe emit-sql` wrote one over a
 * made-up LocalDB database, and docs/notes/gemini.md, *The SQL data source,
 * measured*, has it verbatim. This file reads that form (checklist item 8)
 * and, from batch DD, writes it (items 15 to 19), with the second measurement,
 * RepxProbe emit-sql-params, for parameters, lookups and type names.
 *
 * Plain string work, no DOMParser: it runs in the suite's node environment and
 * in the browser alike, and the decoded document's shape is fixed.
 */
import type { SqlColumn, SqlObject, SqlParameter, SqlProcedure, SqlSchema } from './sqlSchema';

export interface RepxQueryParameter {
  name: string;
  /** `DevExpress.DataAccess.Expression` when bound, otherwise a .NET type such as `System.Int32`. */
  type: string;
  /** The expression text, `(System.String)(?Region)`, or the static value as written (a DateTime is ticks). */
  value: string;
}

export interface RepxQuery {
  type: string;
  name: string;
  procName?: string;
  sql?: string;
  tables: string[];
  columns: { table: string; name: string }[];
  /** True when the query selects every column (`<AllColumns />`). */
  allColumns: boolean;
  filter?: string;
  parameters: RepxQueryParameter[];
}

export interface RepxRelation {
  name: string;
  master: string;
  detail: string;
  keys: { master: string; detail: string }[];
}

export interface RepxView {
  name: string;
  /** The .NET short type name DevExpress writes: `String`, `Int32`, `Decimal`, `DateTime`. */
  fields: { name: string; type: string }[];
}

export interface RepxDataSource {
  /** The ComponentStorage item's Ref, which the report's `DataSource="#Ref-N"` names. */
  ref: string;
  name: string;
  connectionName: string;
  /** The connection is stored by name, resolved from the application's config. */
  fromAppConfig: boolean;
  /** A login or password is stored in the report, which Forma never writes. */
  storesCredentials: boolean;
  queries: RepxQuery[];
  relations: RepxRelation[];
  /** The result schema; empty when the report was saved without one. */
  views: RepxView[];
}

/** XML's five entities, back to characters. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** Base64 to text, as UTF-8: DevExpress writes the decoded document in UTF-8. */
export function decodeBase64(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeEntities(m[1]) : undefined;
}

function readQuery(open: string, body: string): RepxQuery {
  const parameters: RepxQueryParameter[] = [];
  for (const p of body.matchAll(/<Parameter\s([^>]*?)(?:\/>|>([\s\S]*?)<\/Parameter>)/g)) {
    parameters.push({ name: attr(` ${p[1]}`, 'Name') ?? '', type: attr(` ${p[1]}`, 'Type') ?? '', value: decodeEntities(p[2] ?? '') });
  }
  const tablesBlock = /<Tables>([\s\S]*?)<\/Tables>/.exec(body)?.[1] ?? '';
  const columnsBlock = /<Columns>([\s\S]*?)<\/Columns>/.exec(body)?.[1] ?? '';
  const q: RepxQuery = {
    type: attr(open, 'Type') ?? '',
    name: attr(open, 'Name') ?? '',
    tables: [...tablesBlock.matchAll(/<Table\s[^>]*?Name="([^"]*)"/g)].map((m) => decodeEntities(m[1])),
    columns: [...columnsBlock.matchAll(/<Column\s([^>]*?)\/>/g)].map((m) => ({ table: attr(` ${m[1]}`, 'Table') ?? '', name: attr(` ${m[1]}`, 'Name') ?? '' })),
    allColumns: /<AllColumns\s*\/>/.test(columnsBlock),
    parameters,
  };
  const proc = /<ProcName>([\s\S]*?)<\/ProcName>/.exec(body);
  if (proc) q.procName = decodeEntities(proc[1]);
  const sql = /<Sql>([\s\S]*?)<\/Sql>/.exec(body);
  if (sql) q.sql = decodeEntities(sql[1]);
  const filter = /<Filter>([\s\S]*?)<\/Filter>/.exec(body);
  if (filter) q.filter = decodeEntities(filter[1]);
  return q;
}

/** One decoded `<SqlDataSource>` document into its parts. */
export function readSqlDataSourceXml(xml: string, ref = ''): RepxDataSource {
  const connection = /<Connection\s[^>]*?(?:\/>|>[\s\S]*?<\/Connection>)/.exec(xml)?.[0] ?? '';
  const schema = /<ResultSchema>([\s\S]*?)<\/ResultSchema>/.exec(xml)?.[1] ?? '';
  // Relations outside the result schema are the source's own; inside it they are restated.
  const outside = schema ? xml.replace(/<ResultSchema>[\s\S]*?<\/ResultSchema>/, '') : xml;
  return {
    ref,
    name: attr(/<SqlDataSource[^>]*>/.exec(xml)?.[0] ?? '', 'Name') ?? '',
    connectionName: attr(connection, 'Name') ?? '',
    fromAppConfig: attr(connection, 'FromAppConfig') === 'true',
    storesCredentials: /Name="(password|userid)"/i.test(connection),
    queries: [...outside.matchAll(/(<Query\s[^>]*>)([\s\S]*?)<\/Query>/g)].map((m) => readQuery(m[1], m[2])),
    relations: [...outside.matchAll(/(<Relation\s[^>]*>)([\s\S]*?)<\/Relation>/g)]
      .filter((m) => attr(m[1], 'Master') !== undefined)
      .map((m) => ({
        name: attr(m[1], 'Name') ?? '',
        master: attr(m[1], 'Master') ?? '',
        detail: attr(m[1], 'Detail') ?? '',
        keys: [...m[2].matchAll(/<KeyColumn\s([^>]*?)\/>/g)].map((k) => ({ master: attr(` ${k[1]}`, 'Master') ?? '', detail: attr(` ${k[1]}`, 'Detail') ?? '' })),
      })),
    views: [...schema.matchAll(/<View\s+Name="([^"]*)">([\s\S]*?)<\/View>/g)].map((v) => ({
      name: decodeEntities(v[1]),
      fields: [...v[2].matchAll(/<Field\s([^>]*?)\/>/g)].map((f) => ({ name: attr(` ${f[1]}`, 'Name') ?? '', type: attr(` ${f[1]}`, 'Type') ?? '' })),
    })),
  };
}

/** Every SqlDataSource a report carries in its ComponentStorage. */
export function readRepxDataSources(repx: string): RepxDataSource[] {
  const storage = /<ComponentStorage>([\s\S]*?)<\/ComponentStorage>/.exec(repx)?.[1] ?? '';
  const out: RepxDataSource[] = [];
  for (const item of storage.matchAll(/<Item\d+\s[^>]*>/g)) {
    const tag = item[0];
    if (!/ObjectType="DevExpress\.DataAccess\.Sql\.SqlDataSource/.test(tag)) continue;
    const b64 = attr(tag, 'Base64');
    if (!b64) continue;
    try {
      out.push(readSqlDataSourceXml(decodeBase64(b64), attr(tag, 'Ref') ?? ''));
    } catch {
      // A Base64 that does not decode is not a data source this can describe.
    }
  }
  return out;
}

/** `dbo.usp_X` or `usp_X` into `{ schema, name }`, `dbo` when unqualified. */
function splitName(text: string): { schema: string; name: string } {
  const parts = text.split('.').map((p) => p.trim().replace(/^\[|\]$/g, ''));
  return parts.length >= 2 ? { schema: parts[parts.length - 2], name: parts[parts.length - 1] } : { schema: 'dbo', name: parts[0] };
}

/** DevExpress's .NET type names, back to the SQL type a column most likely has. */
const SQL_OF_DOTNET: Record<string, string> = {
  String: 'nvarchar', Int32: 'int', Int64: 'bigint', Int16: 'smallint', Byte: 'tinyint', Boolean: 'bit',
  Decimal: 'decimal', Double: 'float', Single: 'real', DateTime: 'datetime', DateTimeOffset: 'datetimeoffset',
  TimeSpan: 'time', Guid: 'uniqueidentifier',
};

function columnOf(field: { name: string; type: string } | undefined, name: string): SqlColumn {
  return { name, type: field ? SQL_OF_DOTNET[field.type] ?? '' : '' };
}

/**
 * The part of the database an existing report already uses, as the layout
 * model (checklist item 8): the tables its built queries read, with the
 * columns they select, and its stored procedures with their parameters and
 * result columns. Types come from the result schema, mapped back from .NET.
 */
export function schemaFromRepx(repx: string): SqlSchema | null {
  const sources = readRepxDataSources(repx);
  if (!sources.length) return null;
  const objects: SqlObject[] = [];
  const procedures: SqlProcedure[] = [];
  for (const ds of sources) {
    for (const q of ds.queries) {
      const view = ds.views.find((v) => v.name === q.name);
      if (q.type === 'StoredProcQuery' && q.procName) {
        const name = splitName(q.procName);
        if (procedures.some((p) => p.schema === name.schema && p.name === name.name)) continue;
        const parameters: SqlParameter[] = q.parameters.map((p) => ({ name: p.name, type: SQL_OF_DOTNET[(/\(System\.(\w+)\)/.exec(p.value)?.[1] ?? p.type.replace(/^System\./, ''))] ?? '', output: false }));
        procedures.push({ ...name, parameters, result: (view?.fields ?? []).map((f) => columnOf(f, f.name)) });
      } else if (q.type === 'SelectQuery') {
        for (const table of q.tables) {
          const name = splitName(table);
          let target = objects.find((o) => o.schema === name.schema && o.name === name.name);
          if (!target) {
            target = { ...name, kind: 'table', columns: [], primaryKey: [] };
            objects.push(target);
          }
          const wanted = q.allColumns && q.tables.length === 1 ? (view?.fields ?? []).map((f) => f.name) : q.columns.filter((c) => c.table === table).map((c) => c.name);
          for (const col of wanted) if (!target.columns.some((c) => c.name === col)) target.columns.push(columnOf(view?.fields.find((f) => f.name === col), col));
        }
      }
    }
  }
  return { source: 'repx', database: sources[0].connectionName, objects, foreignKeys: [], procedures };
}

/* ------------------------------------------------ small writes, read-side */

/** An attribute value with XML's five characters escaped. */
function attrOf(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Text to Base64 as UTF-8, the inverse of `decodeBase64`. */
export function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** How many `ItemN` children sit directly in a collection's inner text, nested ones not counted. */
export function topLevelItems(inner: string): number {
  let depth = 0;
  let count = 0;
  for (const m of inner.matchAll(/<(\/?)Item\d+\b[^>]*?(\/?)>/g)) {
    if (m[1]) depth--;
    else {
      if (depth === 0) count++;
      if (!m[2]) depth++;
    }
  }
  return count;
}

/**
 * The repair for a stored login (checklist item 20): a SqlDataSource whose
 * connection carries parameters is rewritten to the same connection by name,
 * which is what 20.1 writes with StoreConnectionNameOnly, so no password
 * leaves in a report Forma produced.
 */
export function stripStoredCredentials(repx: string): { xml: string; applied: boolean; reason: string } {
  const sources = readRepxDataSources(repx).filter((d) => d.storesCredentials || !d.fromAppConfig);
  if (!sources.length) return { xml: repx, applied: false, reason: 'no data source stores a login' };
  let xml = repx;
  for (const ds of sources) {
    const tag = new RegExp(`(<Item\\d+\\s[^>]*?Ref="${ds.ref}"[^>]*?Base64=")([^"]*)(")`).exec(xml);
    if (!tag) continue;
    const decoded = decodeBase64(tag[2]).replace(/<Connection\s[^>]*?(?:\/>|>[\s\S]*?<\/Connection>)/, `<Connection Name="${attrOf(ds.connectionName || 'Database')}" FromAppConfig="true" />`);
    xml = xml.replace(tag[0], `${tag[1]}${encodeBase64(decoded)}${tag[3]}`);
  }
  return { xml, applied: true, reason: `the connection${sources.length === 1 ? '' : 's'} ${sources.map((s) => `"${s.connectionName}"`).join(', ')} now stored by name only, with no login or password` };
}

/** The `<connectionStrings>` entry the application needs for a report's connection names (checklist item 21). */
export function connectionStringsSnippet(names: readonly string[], database = ''): string {
  const lines = [...new Set(names)].map((n) => `    <add name="${attrOf(n)}" providerName="System.Data.SqlClient" connectionString="Data Source=YOUR_SERVER;Initial Catalog=${attrOf(database || n)};Integrated Security=True" />`);
  return `<connectionStrings>\n${lines.join('\n')}\n</connectionStrings>`;
}

/* ------------------------------------------------------------- the audit */

/** The span of every `DetailReportBand` item, with its DataMember, innermost spans found by position. */
function detailRegions(xml: string): { start: number; end: number; member: string }[] {
  const regions: { start: number; end: number; member: string }[] = [];
  const opens = [...xml.matchAll(/<(Item\d+)\s[^>]*ControlType="DetailReportBand"[^>]*>/g)];
  for (const open of opens) {
    const member = attr(open[0], 'DataMember') ?? '';
    let depth = 0;
    const tag = /<(\/?)Item\d+\b[^>]*?(\/?)>/g;
    tag.lastIndex = open.index!;
    let end = xml.length;
    for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
      if (m[1]) {
        depth--;
        if (depth === 0) {
          end = m.index + m[0].length;
          break;
        }
      } else if (!m[2]) depth++;
    }
    regions.push({ start: open.index!, end, member });
  }
  return regions;
}

/**
 * The SQL data source's own checks (2026-11-08, the SQL Server programme,
 * checklist item 20), for `auditRepx`: a stored login, a report or query
 * reading a query the source does not have, a query parameter with no report
 * parameter, a binding to a field its band's query does not return, and a
 * source with no result schema. What each costs is measured: 20.1 writes a
 * stored password in plain text, and a field the schema lacks prints blank.
 */
export function auditDataSources(xml: string): { severity: 'error' | 'warning'; code: string; message: string }[] {
  const out: { severity: 'error' | 'warning'; code: string; message: string }[] = [];
  const sources = readRepxDataSources(xml);
  if (!sources.length) return out;
  const root = /<XtraReportsLayoutSerializer\b[^>]*>/.exec(xml)?.[0] ?? '';
  const rootMember = attr(root, 'DataMember') ?? '';
  const reportParams = new Set([...(/<Parameters>([\s\S]*?)<\/Parameters>/.exec(xml)?.[1] ?? '').matchAll(/\sName="([^"]*)"/g)].map((m) => m[1]));
  const calculated = new Set([...(/<CalculatedFields>([\s\S]*?)<\/CalculatedFields>/.exec(xml)?.[1] ?? '').matchAll(/\sName="([^"]*)"/g)].map((m) => m[1]));
  const views = new Map<string, Set<string>>();
  const relations = new Map<string, string>();
  for (const ds of sources) {
    if (ds.storesCredentials) out.push({ severity: 'error', code: 'connection-has-credentials', message: `The data source "${ds.name}" stores a login or password for "${ds.connectionName}", in plain text inside the report. Store the connection by name only, as your application's <connectionStrings> knows it.` });
    if (!ds.views.length) out.push({ severity: 'warning', code: 'schema-missing', message: `The data source "${ds.name}" has no result schema, so the designer lists no fields until it connects to the database.` });
    for (const v of ds.views) views.set(v.name, new Set(v.fields.map((f) => f.name)));
    for (const r of ds.relations) relations.set(r.name, r.detail);
    const queryNames = new Set(ds.queries.map((q) => q.name));
    for (const q of ds.queries) {
      for (const p of q.parameters) {
        for (const m of p.value.matchAll(/\?([A-Za-z_]\w*)/g)) {
          if (!reportParams.has(m[1])) out.push({ severity: 'error', code: 'query-param-unbound', message: `The query "${q.name}" takes ?${m[1]}, and the report has no parameter of that name, so the query cannot run.` });
        }
      }
    }
    if (rootMember && attr(root, 'DataSource') === `#Ref-${ds.ref}` && !queryNames.has(rootMember.split('.')[0])) {
      out.push({ severity: 'error', code: 'datamember-unknown', message: `The report reads "${rootMember}", which the data source "${ds.name}" has no query for.` });
    }
  }
  if (!views.size) return out;

  // Each binding against the view of its band: a detail report reads its relation's detail query.
  const viewOf = (member: string): string | null => {
    const path = member.split('.');
    let view: string | null = views.has(path[0]) ? path[0] : null;
    for (let i = 1; i < path.length && view; i++) view = relations.get(path[i]) ?? null;
    return view;
  };
  const regions = detailRegions(xml);
  const reported = new Set<string>();
  // Every field an expression prints, and a group's FieldName (2026-11-09: a group on a field the query lacks prints one empty group).
  for (const m of xml.matchAll(/\s(Expression|FieldName)="([^"]*)"/g)) {
    const at = m.index!;
    const inside = regions.filter((r) => r.start <= at && at < r.end).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
    const member = inside ? inside.member : rootMember;
    const view = viewOf(member);
    if (!view) continue;
    const named = m[1] === 'FieldName' ? [decodeEntities(m[2])] : [...decodeEntities(m[2]).matchAll(/\[([^\[\]]+)\]/g)].map((f) => f[1]);
    for (const field of named) {
      if (/^(Parameters|DataSource|ReportItems)\./.test(field) || calculated.has(field) || views.get(view)!.has(field)) continue;
      const key = `${view}.${field}`;
      if (reported.has(key)) continue;
      reported.add(key);
      out.push({ severity: 'warning', code: 'field-not-in-schema', message: `[${field}] is bound in a band reading "${view}", which returns no field of that name, so it prints blank.` });
    }
  }
  return out;
}
