/**
 * The SQL data source inside a .repx (2026-11-08, the SQL Server programme).
 *
 * DevExpress keeps a report's `SqlDataSource` as a `ComponentStorage` item
 * whose `Base64` attribute is an XML document of its own. Its form was
 * measured, not read off the API docs: `RepxProbe emit-sql` wrote one over a
 * made-up LocalDB database, and docs/notes/gemini.md, *The SQL data source,
 * measured*, has it verbatim. This file reads that form (checklist item 8);
 * the writer joins it in batch DD.
 *
 * Plain string work, no DOMParser: it runs in the suite's node environment and
 * in the browser alike, and the decoded document's shape is fixed.
 */
import type { SqlColumn, SqlObject, SqlParameter, SqlProcedure, SqlSchema } from './sqlSchema';
import { parseQualifiedName } from './sqlSchema';

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
        const name = parseQualifiedName(q.procName);
        if (procedures.some((p) => p.schema === name.schema && p.name === name.name)) continue;
        const parameters: SqlParameter[] = q.parameters.map((p) => ({ name: p.name, type: SQL_OF_DOTNET[(/\(System\.(\w+)\)/.exec(p.value)?.[1] ?? p.type.replace(/^System\./, ''))] ?? '', output: false }));
        procedures.push({ ...name, parameters, result: (view?.fields ?? []).map((f) => columnOf(f, f.name)) });
      } else if (q.type === 'SelectQuery') {
        for (const table of q.tables) {
          const name = parseQualifiedName(table);
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
