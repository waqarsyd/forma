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
import { unescapeXml as decodeEntities } from './xmlEscape';

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
  /**
   * A built query's joins, sort, Top and distinct (2026-11-09, batch DG), as
   * DevExpress 20.1 wrote them in batch DA: a `<Relation Type Parent Nested>`
   * with its `<KeyColumn>`s inside `<Tables>`, `<Sorting>`'s columns, and
   * `Top` and `Distinct` on the query. Enough to rebuild the query a report
   * already reads (`queryFromRepx` in sqlDrift.ts).
   */
  joins: { type: string; parent: string; nested: string; keys: { parent: string; nested: string }[] }[];
  sort: { table: string; name: string; descending: boolean }[];
  top?: number;
  distinct?: boolean;
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

/**
 * XML's entities and character references, back to characters: since the
 * 2026-11-11 audit (RH-04) the one decoder in `xmlEscape.ts`, under the name
 * this module's callers know it by.
 */
export { decodeEntities };

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
    joins: [...tablesBlock.matchAll(/<Relation\s([^>]*?)>([\s\S]*?)<\/Relation>/g)].map((m) => ({
      type: attr(` ${m[1]}`, 'Type') ?? 'Inner',
      parent: attr(` ${m[1]}`, 'Parent') ?? '',
      nested: attr(` ${m[1]}`, 'Nested') ?? '',
      keys: [...m[2].matchAll(/<KeyColumn\s([^>]*?)\/>/g)].map((k) => ({ parent: attr(` ${k[1]}`, 'Parent') ?? '', nested: attr(` ${k[1]}`, 'Nested') ?? '' })),
    })),
    sort: [...(/<Sorting>([\s\S]*?)<\/Sorting>/.exec(body)?.[1] ?? '').matchAll(/<Column\s([^>]*?)\/>/g)].map((m) => ({
      table: attr(` ${m[1]}`, 'Table') ?? '',
      name: attr(` ${m[1]}`, 'Name') ?? '',
      descending: attr(` ${m[1]}`, 'Descending') === 'true',
    })),
  };
  const top = Number(attr(open, 'Top'));
  if (top > 0) q.top = top;
  if (attr(open, 'Distinct') === 'true') q.distinct = true;
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

/**
 * The report's own ComponentStorage: the first one outside every subreport's
 * `ReportSource`. DevExpress 20.1 writes an embedded subreport's own storage
 * inside its `ReportSource`, before the root's (measured with SaveLayoutToXml
 * on 2026-11-24, the wave-4 review of the MCP server, REV4-1), so the first
 * storage in the file is not always the report's.
 */
function rootComponentStorage(repx: string): string {
  let depth = 0;
  for (const m of repx.matchAll(/<ReportSource\b[^>]*?(\/?)>|<\/ReportSource>|<ComponentStorage(?:\s[^>/]*)?>([\s\S]*?)<\/ComponentStorage>/g)) {
    if (m[0].startsWith('</')) depth--;
    else if (m[0].startsWith('<ReportSource')) depth += m[1] ? 0 : 1;
    else if (depth <= 0) return m[2];
  }
  return '';
}

/**
 * Every SqlDataSource a report carries in its own ComponentStorage, the
 * collection the report's `DataSource="#Ref-N"` and this module's writers
 * name. A `Ref` that is not a number is kept as '' (REV4-2 of the same
 * review): every Ref DevExpress writes is one, and callers build patterns
 * from it. Every data source stored anywhere, a subreport's and one kept in
 * ObjectStorage included, is `readEveryDataSource`.
 */
export function readRepxDataSources(repx: string): RepxDataSource[] {
  const storage = rootComponentStorage(repx);
  const out: RepxDataSource[] = [];
  for (const item of storage.matchAll(/<Item\d+\s[^>]*>/g)) {
    const tag = item[0];
    if (!/ObjectType="DevExpress\.DataAccess\.Sql\.SqlDataSource/.test(tag)) continue;
    const b64 = attr(tag, 'Base64');
    if (!b64) continue;
    const ref = attr(tag, 'Ref') ?? '';
    try {
      out.push(readSqlDataSourceXml(decodeBase64(b64), /^\d+$/.test(ref) ? ref : ''));
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

/** The parameters a data source uses: its queries' `?Name`s, and those whose lookup list it fills (2026-11-09). */
export function sourceParameters(repx: string, ds: { ref: string; queries: { filter?: string; parameters: { value: string }[] }[] }): Set<string> {
  const names = new Set(ds.queries.flatMap((q) => [q.filter ?? '', ...q.parameters.map((p) => p.value)]).flatMap((s) => [...s.matchAll(/\?([A-Za-z_]\w*)/g)].map((m) => m[1])));
  const storage = /<ObjectStorage>([\s\S]*?)<\/ObjectStorage>/.exec(repx)?.[1] ?? '';
  const lookups = new Set([...storage.matchAll(/<Item\d+\s[^>]*>/g)].map((m) => m[0]).filter((t) => /DynamicListLookUpSettings/.test(t) && t.includes(`DataSource="#Ref-${ds.ref}"`)).map((t) => /\sRef="(\d+)"/.exec(t)?.[1]));
  const block = /<Parameters>([\s\S]*?)<\/Parameters>/.exec(repx)?.[1] ?? '';
  for (const m of block.matchAll(/<Item\d+\s[^>]*>/g)) {
    const lookup = /ValueSourceSettings="#Ref-(\d+)"/.exec(m[0])?.[1];
    const name = /\sName="([^"]*)"/.exec(m[0])?.[1];
    if (name && lookup && lookups.has(lookup)) names.add(name);
  }
  return names;
}

const maxRefIn = (xml: string) => Math.max(0, ...[...xml.matchAll(/\sRef="(\d+)"/g)].map((m) => Number(m[1])));

/** Appends items to a top-level block, numbering them on from its last, or creates it before `before`. */
function appendItems(xml: string, block: string, items: string[], before: RegExp): string {
  if (!items.length) return xml;
  const found = new RegExp(`<${block}>([\\s\\S]*?)</${block}>`).exec(xml);
  const count = found ? topLevelItems(found[1]) : 0;
  const numbered = items.map((it, i) => it.replace(/^<Item\d+/, `<Item${count + i + 1}`)).join('');
  // A function, not a replacement string: the items carry data, and `$&` or `$'` in one is a pattern there (2026-11-11, PX-02b).
  if (found) return xml.replace(`</${block}>`, () => `${numbered}</${block}>`);
  const at = before.exec(xml);
  const index = at ? at.index : xml.lastIndexOf('</XtraReportsLayoutSerializer>');
  return `${xml.slice(0, index)}<${block}>${numbered}</${block}>${xml.slice(index)}`;
}

/**
 * A report's SQL data source carried through a redesign (2026-11-09, the SQL
 * Server programme, batch DG, item 29). A redesign is a new REPX the AI wrote
 * from the old one, and a model asked to keep a Base64 blob it cannot read
 * drops or garbles it; the report then opens bound to nothing. When the old
 * report had a source the new one lacks, the old one is put back as it was:
 * its `ComponentStorage` item, the report's `DataSource` and `DataMember`, and
 * the parameters its queries use with their lifted types and lookup lists,
 * each under a fresh `Ref` where the new report already uses its number. A
 * new report with a source of its own (the chat's data edit, or the query
 * the AI named) keeps that one.
 *
 * "Of its own" means one that names a connection and reads a query
 * (2026-11-11, full audit SD-16). A garbled Base64 still decodes to
 * something, and was counted as the new report's source until then, so the
 * old one was never carried and the report opened bound to nothing. A source
 * that says neither is removed, with anything that pointed at it pointed at
 * the source carried instead. So is one beside a source of the new report's
 * own (the 2026-11-11 audit's follow-up to SD-16): that one is kept, and
 * what pointed at the garbled one points at it.
 */
export function carryDataSource(before: string, after: string): { xml: string; applied: boolean; reason: string } {
  if (!/<XtraReportsLayoutSerializer\b/.test(after)) {
    return { xml: after, applied: false, reason: readRepxDataSources(before).length ? 'there is no new report' : 'the report had no data source' };
  }
  const own = readRepxDataSources(after).filter((ds) => ds.connectionName && ds.queries.length);
  const ownRefs = new Set(own.map((ds) => ds.ref));
  const garbled: string[] = [];
  const cleaned = after.replace(/<ComponentStorage>([\s\S]*?)<\/ComponentStorage>/, (_whole, inner: string) => {
    const kept = inner.replace(/\s*<Item\d+\s[^>]*?ObjectType="DevExpress\.DataAccess\.Sql\.SqlDataSource[^>]*?(?:\/>|>[\s\S]*?<\/Item\d+>)/g, (item: string) => {
      const ref = /\sRef="(\d+)"/.exec(item)?.[1] ?? '';
      if (ownRefs.has(ref)) return item;
      garbled.push(ref);
      return '';
    });
    // What is left numbered Item1, Item2... again, as the serializer reads a collection; only flat items, the kind it holds.
    let n = 0;
    const flat = !/<\/Item\d+>/.test(kept);
    return `<ComponentStorage>${flat ? kept.replace(/<Item\d+(?=\s)/g, () => `<Item${++n}`) : kept}</ComponentStorage>`;
  });
  if (own.length) {
    if (!garbled.length) return { xml: after, applied: false, reason: 'the new report has a data source of its own' };
    // The report's own pointer, where it names one of its sources, else the first.
    const pointer = /\sDataSource="#Ref-(\d+)"/.exec(/<XtraReportsLayoutSerializer\b[^>]*>/.exec(cleaned)?.[0] ?? '')?.[1];
    const main = pointer && ownRefs.has(pointer) ? pointer : own[0].ref;
    let xml = cleaned;
    for (const ref of garbled) if (ref) xml = xml.split(`DataSource="#Ref-${ref}"`).join(`DataSource="#Ref-${main}"`);
    return { xml, applied: true, reason: 'removed a damaged copy of the data source beside the report\'s own' };
  }
  const old = readRepxDataSources(before);
  if (!old.length) return { xml: after, applied: false, reason: 'the report had no data source' };
  after = cleaned;
  let next = Math.max(maxRefIn(after), maxRefIn(before)) + 1;
  const remap = new Map<string, string>();
  const fresh = (ref: string) => {
    if (!remap.has(ref)) remap.set(ref, new RegExp(`\\sRef="${ref}"`).test(after) ? String(next++) : ref);
    return remap.get(ref)!;
  };
  const tagsOf = (xml: string, block: string) => [...(new RegExp(`<${block}>([\\s\\S]*?)</${block}>`).exec(xml)?.[1] ?? '').matchAll(/<Item\d+\s[^>]*?\/>/g)].map((m) => m[0]);
  const withRefs = (tag: string) => tag.replace(/\sRef="(\d+)"/, (_, r: string) => ` Ref="${fresh(r)}"`).replace(/"#Ref-(\d+)"/g, (_, r: string) => `"#Ref-${fresh(r)}"`);

  let xml = after;
  const sources = tagsOf(before, 'ComponentStorage').filter((t) => /DevExpress\.DataAccess\.Sql\.SqlDataSource/.test(t));
  xml = appendItems(xml, 'ComponentStorage', sources.map(withRefs), /<ObjectStorage>|<\/XtraReportsLayoutSerializer>/);

  // The report reads the source by reference and the query by name, as before.
  const rootBefore = /<XtraReportsLayoutSerializer\b[^>]*>/.exec(before)?.[0] ?? '';
  const pointer = /\sDataSource="#Ref-(\d+)"/.exec(rootBefore)?.[1];
  const member = /\sDataMember="([^"]*)"/.exec(rootBefore)?.[1];
  if (pointer) {
    xml = xml.replace(/<XtraReportsLayoutSerializer\b[^>]*>/, (open) =>
      open.replace(/\sDataSource="[^"]*"/, '').replace(/\sDataMember="[^"]*"/, '').replace(/\s*>$/, () => `${member ? ` DataMember="${member}"` : ''} DataSource="#Ref-${fresh(pointer)}">`),
    );
  }
  // A detail report the redesign kept still names the old source by its old number.
  for (const ds of old) if (remap.get(ds.ref) !== ds.ref) xml = xml.split(`DataSource="#Ref-${ds.ref}"`).join(`DataSource="#Ref-${remap.get(ds.ref)}"`);
  // And what named the garbled source by a number of its own now names the one carried.
  const main = fresh(pointer ?? old[0].ref);
  for (const ref of garbled) if (ref && !old.some((ds) => ds.ref === ref)) xml = xml.split(`DataSource="#Ref-${ref}"`).join(`DataSource="#Ref-${main}"`);

  // The parameters its queries use, and what they point at in ObjectStorage.
  const have = new Set(tagsOf(xml, 'Parameters').map((t) => /\sName="([^"]*)"/.exec(t)?.[1]));
  const wanted = new Set(old.flatMap((ds) => [...sourceParameters(before, ds)]));
  const params = tagsOf(before, 'Parameters').filter((t) => {
    const name = /\sName="([^"]*)"/.exec(t)?.[1];
    return name && wanted.has(name) && !have.has(name);
  });
  const pointed = new Set(params.flatMap((t) => [...t.matchAll(/"#Ref-(\d+)"/g)].map((m) => m[1])));
  const storage = tagsOf(before, 'ObjectStorage').filter((t) => pointed.has(/\sRef="(\d+)"/.exec(t)?.[1] ?? ''));
  xml = appendItems(xml, 'Parameters', params.map(withRefs), /<CalculatedFields>|<Bands>/);
  xml = appendItems(xml, 'ObjectStorage', storage.map(withRefs), /<\/XtraReportsLayoutSerializer>/);

  const names = old.flatMap((ds) => ds.queries.map((q) => q.name)).join(', ');
  const kept = params.length ? `, with parameter${params.length === 1 ? '' : 's'} ${params.map((t) => /\sName="([^"]*)"/.exec(t)![1]).join(', ')}` : '';
  return { xml, applied: true, reason: `kept the data source (${names} on connection "${old[0].connectionName}") through the redesign${kept}` };
}

/* ------------------------------------------- stored logins, wherever kept */

/**
 * Base64 decoded as forgivingly as a person could decode it: every character
 * outside the alphabet dropped and the length made whole. A value atob
 * refuses (and DevExpress with it) still has its bytes in the file, so it is
 * still read.
 */
function forgivingDecode(b64: string): string {
  let s = b64.replace(/[^A-Za-z0-9+/]/g, '');
  if (s.length % 4 === 1) s = s.slice(0, -1);
  while (s.length % 4) s += '=';
  return decodeBase64(s);
}

/** How much of a Base64 value is decoded first, to see whether it holds an XML document: 600 characters, 450 bytes. */
const HEAD = 600;

const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\r' || c === '\n';

/**
 * Every XML document a report keeps as a Base64 attribute value, with the
 * value's place in the text (2026-11-24, the wave-4 review of Forma's MCP
 * server, REV4-1 and REV4-2). DevExpress 20.1 keeps a SqlDataSource as one
 * of these in more places than the root's ComponentStorage, measured with
 * SaveLayoutToXml: in ObjectStorage, when the report was given its source in
 * code and never had it added to ComponentStorage, and in an embedded
 * subreport's own ComponentStorage, inside its ReportSource, which is written
 * before the root's. So every `Base64` attribute is read, on any element, in
 * any attribute order and either quote, scanning forward once; a value whose
 * start decodes to `<` is decoded whole, and a picture's is not. No pattern
 * is built from the file's text, and no item is found by its Ref.
 */
function storedDocuments(xml: string): { start: number; end: number; doc: string }[] {
  const out: { start: number; end: number; doc: string }[] = [];
  let at = 0;
  for (;;) {
    const name = xml.indexOf('Base64', at);
    if (name < 0) break;
    at = name + 6;
    if (!isSpace(xml[name - 1])) continue;
    let i = at;
    while (isSpace(xml[i])) i++;
    if (xml[i] !== '=') continue;
    i++;
    while (isSpace(xml[i])) i++;
    const quote = xml[i];
    if (quote !== '"' && quote !== "'") continue;
    const end = xml.indexOf(quote, i + 1);
    if (end < 0) break;
    at = end + 1;
    const value = xml.slice(i + 1, end);
    if (!forgivingDecode(value.slice(0, HEAD)).replace(/^[\uFEFF\s]+/, '').startsWith('<')) continue;
    out.push({ start: i + 1, end, doc: forgivingDecode(value) });
  }
  return out;
}

/** A `<Connection>` element of a decoded data source, as it is rewritten. */
const CONNECTION = /<Connection(?=[\s/>])[^>]*?(?:\/>|>[\s\S]*?<\/Connection>)/g;
const CLOSE = '</Connection>';

/**
 * The text of every `<Connection>` in a decoded document, from its start to
 * its end, or to the document's end when it never closes: what is searched
 * for a login, so one inside a connection left open is still found.
 */
function connectionSpans(doc: string): string[] {
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const start = doc.indexOf('<Connection', at);
    if (start < 0) break;
    at = start + 11;
    if (at < doc.length && !/[\s/>]/.test(doc[at])) continue;
    let end = doc.length;
    const open = doc.indexOf('>', at);
    if (open >= 0 && doc[open - 1] === '/') end = open + 1;
    else if (open >= 0) {
      const close = doc.indexOf(CLOSE, open);
      if (close >= 0) end = close + CLOSE.length;
    }
    out.push(doc.slice(start, end));
    at = end;
  }
  return out;
}

/** A connection's `userid` or `password` parameter, in either quote. */
const LOGIN_PARAMETER = /<Parameter(?=[\s/>])[^>]*?\sName\s*=\s*(?:"(?:password|userid)"|'(?:password|userid)')/i;
/** A password given a value inside an attribute's value, bare or quoted: `password=x`, `Pwd = "a;b"`. */
const PASSWORD_SET = /(?:^|[;\s])(?:password|pwd)\s*=\s*(?:"[^"]*[^"\s]|'[^']*[^'\s]|[^;"'\s])/i;
const ATTRIBUTE_VALUE = /\s[\w.:-]+\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * True when a connection keeps a login: a `userid` or `password` among its
 * parameters, or a password with a value in any of its attributes, a custom
 * connection string's (the PIPE1 review) or any other's, read with its
 * entities decoded, so `password=&quot;a;b&quot;` is one (REV4-1).
 */
function keepsLogin(connection: string): boolean {
  if (LOGIN_PARAMETER.test(connection)) return true;
  for (const m of connection.matchAll(ATTRIBUTE_VALUE)) if (PASSWORD_SET.test(decodeEntities(m[1] ?? m[2]))) return true;
  return false;
}

/** One attribute of a connection's opening tag, either quote, its entities decoded. */
function connectionAttr(open: string, name: 'Name' | 'FromAppConfig'): string | undefined {
  const m = (name === 'Name' ? /\sName\s*=\s*(?:"([^"]*)"|'([^']*)')/ : /\sFromAppConfig\s*=\s*(?:"([^"]*)"|'([^']*)')/).exec(open);
  return m ? decodeEntities(m[1] ?? m[2]) : undefined;
}

/**
 * Every stored connection that keeps a login, or is stored with more than
 * its name, rewritten to the same connection by name, which is what 20.1
 * writes with StoreConnectionNameOnly; spliced in by position, the last
 * value first, so the places found stay true.
 */
function byNameOnly(repx: string): { xml: string; hadLogin: boolean; names: string[] } {
  let hadLogin = false;
  const names: string[][] = [];
  let xml = repx;
  for (const stored of storedDocuments(repx).reverse()) {
    if (!stored.doc.includes('<Connection')) continue;
    if (connectionSpans(stored.doc).some(keepsLogin)) hadLogin = true;
    const here: string[] = [];
    // A function, not a replacement string: a connection named with `$&` or `$'` is data, not a pattern (2026-11-11, PX-02b).
    const doc = stored.doc.replace(CONNECTION, (element) => {
      const open = /^<Connection[^>]*/.exec(element)![0];
      if (!keepsLogin(element) && connectionAttr(open, 'FromAppConfig')?.toLowerCase() === 'true') return element;
      const name = connectionAttr(open, 'Name') || 'Database';
      here.push(name);
      return `<Connection Name="${attrOf(name)}" FromAppConfig="true" />`;
    });
    names.unshift(here);
    if (doc !== stored.doc) xml = `${xml.slice(0, stored.start)}${encodeBase64(doc)}${xml.slice(stored.end)}`;
  }
  return { xml, hadLogin, names: names.flat() };
}

/**
 * A report's text with every stored connection kept by name only, whether
 * it had kept a login (a login and password stored as the connection's
 * parameters, or a password inside a custom connection string, the PIPE1
 * review), and whether one is still there. The one reading every caller
 * makes before anything else sees an uploaded or opened report (2026-11-11,
 * SE-01): the web app's intake (`repxAttachment`) and, since 2026-11-24,
 * every tool of Forma's MCP server (finding SEC-3 of the MCP design audit),
 * which is why it lives here and not in repxIntake.ts, a module the MCP
 * server must not reach.
 *
 * Since the wave-4 review (REV4-1) it reads every data source the file keeps,
 * wherever DevExpress put it (`storedDocuments`), and then reads the result
 * again: `loginLeft` is a login still found there, a connection the rewrite
 * could not reach (one left open, say), and the caller then refuses the
 * report rather than pass it on. `hadLogin` comes from the same reading the
 * rewrite makes, never from a second parser that could see less.
 */
export function withoutStoredLogin(repx: string): { xml: string; hadLogin: boolean; loginLeft: boolean } {
  const out = byNameOnly(repx);
  const loginLeft = storedDocuments(out.xml).some((d) => connectionSpans(d.doc).some(keepsLogin));
  return { xml: out.xml, hadLogin: out.hadLogin || loginLeft, loginLeft };
}

/**
 * The repair for a stored login (checklist item 20), in `REPAIR_ORDER` as
 * `logins`: every stored connection that keeps a login or more than its name
 * rewritten to the same connection by name, so no password leaves in a
 * report Forma produced. Applied only when a connection was rewritten.
 */
export function stripStoredCredentials(repx: string): { xml: string; applied: boolean; reason: string } {
  const out = byNameOnly(repx);
  if (!out.names.length) return { xml: repx, applied: false, reason: 'no data source stores a login' };
  return { xml: out.xml, applied: true, reason: `the connection${out.names.length === 1 ? '' : 's'} ${out.names.map((n) => `"${n}"`).join(', ')} now stored by name only, with no login or password` };
}

/**
 * Every SqlDataSource a report stores anywhere, in the order written: its own
 * ComponentStorage, an embedded subreport's, and ObjectStorage, where 20.1
 * keeps a source assigned in code (REV4-1). Each without its Ref, which no
 * caller of this one needs.
 */
export function readEveryDataSource(repx: string): RepxDataSource[] {
  return storedDocuments(repx)
    .filter((d) => /^[\uFEFF\s]*(?:<\?xml[^>]*\?>\s*)?<SqlDataSource\b/.test(d.doc))
    .map((d) => readSqlDataSourceXml(d.doc));
}

/** The `<connectionStrings>` entry the application needs for a report's connection names (checklist item 21). */
export function connectionStringsSnippet(names: readonly string[], database = ''): string {
  const lines = [...new Set(names)].map((n) => `    <add name="${attrOf(n)}" providerName="System.Data.SqlClient" connectionString="Data Source=YOUR_SERVER;Initial Catalog=${attrOf(database || n)};Integrated Security=True" />`);
  return `<connectionStrings>\n${lines.join('\n')}\n</connectionStrings>`;
}

/* ------------------------------------------------------------- the audit */

/**
 * The span of every `DetailReportBand` item, with its DataMember, innermost
 * spans found by position (`memberAt`). Exported on 2026-11-11 (the full
 * audit's SD-26, batch PXB) with the two below, so sqlDrift.ts's `queryAt`
 * walks the report as the field check here does instead of keeping a copy.
 */
export function detailRegions(xml: string): { start: number; end: number; member: string }[] {
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

/** The DataMember read at an offset: the innermost detail report's holding it, else `rootMember`. */
export function memberAt(regions: readonly { start: number; end: number; member: string }[], at: number, rootMember: string): string {
  const inside = regions.filter((r) => r.start <= at && at < r.end).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  return inside ? inside.member : rootMember;
}

/**
 * What a DataMember path reads: its first part when `roots` has it (a query,
 * or a query's view), then each relation's detail along the path; null when
 * a part names nothing the sources hold.
 */
export function resolveMember(member: string, roots: { has(name: string): boolean }, relations: ReadonlyMap<string, string>): string | null {
  const path = member.split('.');
  let at: string | null = roots.has(path[0]) ? path[0] : null;
  for (let i = 1; i < path.length && at; i++) at = relations.get(path[i]) ?? null;
  return at;
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
  const regions = detailRegions(xml);
  const reported = new Set<string>();
  // Every field an expression prints, and a group's FieldName (2026-11-09: a group on a field the query lacks prints one empty group).
  for (const m of xml.matchAll(/\s(Expression|FieldName)="([^"]*)"/g)) {
    const view = resolveMember(memberAt(regions, m.index!, rootMember), views, relations);
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
