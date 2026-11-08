/**
 * Writing a SQL Server data source into a .repx (2026-11-08, the SQL Server
 * programme, batch DD, checklist items 15 to 20).
 *
 * Every form here was measured, not read off the docs: `RepxProbe emit-sql`
 * (the source, queries, relations, result schema; batch DA) and
 * `emit-sql-params` (the result schema's type names, report parameters,
 * lookups and cascading, multi-value into a filter and into a procedure, a
 * left outer join, distinct, a descending sort). What it writes was then run
 * by DevExpress itself: `RepxProbe sql-fill` loaded reports this wrote over
 * the made-up FormaSample on LocalDB and filled every query (docs/notes/
 * gemini.md, *The SQL data source, measured*).
 *
 * The connection is always its name: 20.1 writes the login and password in
 * plain text otherwise, so `stripStoredCredentials` is also the repair for a
 * report that arrives carrying them.
 */
import type { SqlSchema } from './sqlSchema';
import { findObject, findProcedure, queryFields, queryName, type QueryField, type ReportQuery } from './sqlQuery';
import { escapeXmlAttribute } from './xmlEscape';
import { liftParameterTypes, parameterReferences } from './repxParameters';
import { ensureUniqueRefs } from './repxRefs';
import { encodeBase64, readRepxDataSources, sourceParameters, topLevelItems } from './repxSqlDataSource';
export { connectionStringsSnippet, encodeBase64, stripStoredCredentials } from './repxSqlDataSource';

/** What a report reads, to be written into it as a SqlDataSource. */
export interface DataSourceSpec {
  /** The name the application's `<connectionStrings>` knows the database by. Never a connection string. */
  connectionName: string;
  schema: SqlSchema;
  /** The report's own query: its DataMember. */
  query: ReportQuery;
  /** Master-detail: a detail query and the key columns that tie it to the report's query. */
  details?: { query: ReportQuery; keys: { master: string; detail: string }[]; name?: string }[];
  /** Report parameters taking more than one value; into a filter as `In`, into a procedure joined with commas. */
  multiValue?: string[];
  /** A parameter's values offered from a table's column, and, for cascading, filtered by another parameter. */
  lookups?: { parameter: string; object: string; valueColumn: string; displayColumn?: string; filter?: string }[];
  calculatedFields?: { name: string; expression: string; type: CalcType; dataMember?: string }[];
}

export type CalcType = 'String' | 'Int32' | 'Decimal' | 'Double' | 'DateTime' | 'Boolean';

/**
 * A SQL type's name in the result schema, as `RepxProbe emit-sql-params`
 * measured 20.1 writing it: `time`, `datetimeoffset` and `binary` are
 * `Unknown`, `varbinary` and `image` are `ByteArray`.
 */
export function resultTypeOf(sqlType: string): string {
  const t = sqlType.toLowerCase();
  if (t === 'int') return 'Int32';
  if (t === 'bigint') return 'Int64';
  if (t === 'smallint') return 'Int16';
  if (t === 'tinyint') return 'Byte';
  if (t === 'bit') return 'Boolean';
  if (/^(decimal|numeric|money|smallmoney)$/.test(t)) return 'Decimal';
  if (t === 'float') return 'Double';
  if (t === 'real') return 'Single';
  if (/^(date|datetime|datetime2|smalldatetime)$/.test(t)) return 'DateTime';
  if (/^(char|varchar|nchar|nvarchar|text|ntext|xml|sysname)$/.test(t)) return 'String';
  if (t === 'uniqueidentifier') return 'Guid';
  if (/^(varbinary|image)$/.test(t)) return 'ByteArray';
  return 'Unknown';
}

/** A SQL type as the .NET type a report parameter is declared with. */
export function parameterTypeOf(sqlType: string): string {
  const t = resultTypeOf(sqlType);
  return t === 'Unknown' || t === 'ByteArray' ? 'System.String' : `System.${t}`;
}

/** The array type exactly as 20.1 writes it inside a multi-value query parameter's expression. */
const STRING_ARRAY = 'System.String[], mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089';

const text = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attrOf = (value: string) => escapeXmlAttribute(value);

/** A table's name as a SelectQuery writes it: `Orders` for dbo, `sales.Targets` otherwise. */
function tableRef(object: { schema: string; name: string }): string {
  return object.schema.toLowerCase() === 'dbo' ? object.name : `${object.schema}.${object.name}`;
}

/** A T-SQL default as a parameter's `ValueInfo`; null when there is none, or it is NULL or an expression. */
export function defaultValueInfo(defaultValue: string | undefined, sqlType: string): string | null {
  if (defaultValue === undefined) return null;
  const v = defaultValue.trim();
  if (/^null$/i.test(v)) return null;
  const quoted = /^N?'((?:[^']|'')*)'$/i.exec(v);
  if (quoted) return quoted[1].replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(v)) return sqlType.toLowerCase() === 'bit' ? (Number(v) ? 'True' : 'False') : v;
  return null;
}

interface ParamNeed {
  name: string;
  type: string;
  valueInfo: string | null;
  allowNull: boolean;
  multi: boolean;
}

/** The ?names a criteria string uses, each with the type of the column it is compared with. */
function filterParameters(schema: SqlSchema, query: Extract<ReportQuery, { kind: 'table' }>, multi: Set<string>): ParamNeed[] {
  const filter = query.filter ?? '';
  const out: ParamNeed[] = [];
  for (const m of filter.matchAll(/\?([A-Za-z_]\w*)/g)) {
    const name = m[1];
    if (out.some((p) => p.name === name)) continue;
    const before = filter.slice(0, m.index);
    const column = /\[([\w ]+)\.([\w ]+)\]\s*(?:=|<>|!=|<=|>=|<|>|In\s*\(|Like)\s*$/i.exec(before);
    const sqlType = column ? findObject(schema, column[1])?.columns.find((c) => c.name === column[2])?.type ?? '' : '';
    const isIn = /In\s*\(\s*$/i.test(before);
    out.push({ name, type: sqlType ? parameterTypeOf(sqlType) : 'System.String', valueInfo: null, allowNull: false, multi: isIn || multi.has(name) });
  }
  return out;
}

function procedureParameters(schema: SqlSchema, query: Extract<ReportQuery, { kind: 'procedure' }>, multi: Set<string>): ParamNeed[] {
  const proc = findProcedure(schema, query.procedure);
  return (proc?.parameters ?? [])
    .filter((p) => !p.output)
    .map((p) => {
      const name = p.name.replace(/^@/, '');
      const valueInfo = defaultValueInfo(p.defaultValue, p.type);
      return { name, type: parameterTypeOf(p.type), valueInfo, allowNull: /^null$/i.test(p.defaultValue?.trim() ?? ''), multi: multi.has(name) };
    });
}

function customParameters(query: Extract<ReportQuery, { kind: 'custom' }>, multi: Set<string>): ParamNeed[] {
  return [...new Set([...query.sql.replace(/N?'(?:[^']|'')*'/g, "''").matchAll(/(?<![@\w])@([A-Za-z_]\w*)/g)].map((m) => m[1]))].map((name) => ({ name, type: 'System.String', valueInfo: null, allowNull: false, multi: multi.has(name) }));
}

/** The report parameters every query in the spec needs, first come first kept. */
export function parametersFor(spec: DataSourceSpec): ParamNeed[] {
  spec = withDetails(spec);
  const multi = new Set(spec.multiValue ?? []);
  const all: ParamNeed[] = [];
  for (const q of [spec.query, ...(spec.details ?? []).map((d) => d.query)]) {
    const found = q.kind === 'table' ? filterParameters(spec.schema, q, multi) : q.kind === 'procedure' ? procedureParameters(spec.schema, q, multi) : customParameters(q, multi);
    for (const p of found) if (!all.some((a) => a.name === p.name)) all.push(p);
  }
  return all;
}

function parameterXml(name: string, need: ParamNeed | undefined, proc: boolean): string {
  const type = need?.type ?? 'System.String';
  let expression: string;
  if (need?.multi) expression = proc ? `(System.String)(Join(?${name}, ','))` : `(${STRING_ARRAY})(?${name})`;
  else expression = `(${type})(?${name})`;
  return `<Parameter Name="${attrOf(proc ? `@${name}` : name)}" Type="DevExpress.DataAccess.Expression">${text(expression)}</Parameter>`;
}

/** The fields a SelectQuery returns: every column, a joined table's minus the names already taken. */
function selectFields(schema: SqlSchema, query: Extract<ReportQuery, { kind: 'table' }>): QueryField[] {
  const fields = queryFields(schema, query);
  if (query.columns.length) return fields;
  const seen = new Set<string>();
  return fields.filter((f) => {
    const key = f.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function queryXml(spec: DataSourceSpec, query: ReportQuery, needs: ParamNeed[]): string {
  const name = queryName(query);
  const byName = (n: string) => needs.find((p) => p.name === n);
  if (query.kind === 'procedure') {
    const proc = findProcedure(spec.schema, query.procedure);
    const params = (proc?.parameters ?? []).filter((p) => !p.output).map((p) => parameterXml(p.name.replace(/^@/, ''), byName(p.name.replace(/^@/, '')), true));
    const procName = proc ? `${proc.schema}.${proc.name}` : query.procedure;
    return `<Query Type="StoredProcQuery" Name="${attrOf(name)}">${params.join('')}<ProcName>${text(procName)}</ProcName></Query>`;
  }
  if (query.kind === 'custom') {
    const params = customParameters(query, new Set(spec.multiValue ?? [])).map((p) => `<Parameter Name="${attrOf(`@${p.name}`)}" Type="DevExpress.DataAccess.Expression">${text(`(${byName(p.name)?.type ?? 'System.String'})(?${p.name})`)}</Parameter>`);
    return `<Query Type="CustomSqlQuery" Name="${attrOf(name)}">${params.join('')}<Sql>${text(query.sql)}</Sql></Query>`;
  }
  const main = findObject(spec.schema, query.object);
  const mainRef = main ? tableRef(main) : query.object.replace(/^dbo\./i, '');
  const joined = query.joins.map((j) => ({ join: j, obj: findObject(spec.schema, j.table) }));
  const tables = [`<Table Name="${attrOf(mainRef)}" />`, ...joined.map(({ join, obj }) => `<Table Name="${attrOf(obj ? tableRef(obj) : join.table)}" />`)];
  const relations = joined.map(({ join, obj }) => `<Relation Type="${join.type}" Parent="${attrOf(mainRef)}" Nested="${attrOf(obj ? tableRef(obj) : join.table)}">${join.on.map((k) => `<KeyColumn Parent="${attrOf(k.from)}" Nested="${attrOf(k.to)}" />`).join('')}</Relation>`);
  const fields = selectFields(spec.schema, query);
  const tableOf = (source: string) => {
    const obj = findObject(spec.schema, source);
    return obj ? tableRef(obj) : source;
  };
  const columns = !query.joins.length && !query.columns.length ? '<AllColumns />' : fields.map((f) => `<Column Table="${attrOf(tableOf(f.source))}" Name="${attrOf(f.name)}" />`).join('');
  const sorting = query.sort?.length
    ? `<Sorting>${query.sort
        .map((s) => {
          const parts = s.column.split('.');
          const column = parts.pop() ?? s.column;
          const owner = parts.length ? tableOf(parts.join('.')) : mainRef;
          return `<Column Table="${attrOf(owner)}" Name="${attrOf(column)}"${s.descending ? ' Descending="true"' : ''} />`;
        })
        .join('')}</Sorting>`
    : '';
  const params = filterParameters(spec.schema, query, new Set(spec.multiValue ?? [])).map((p) => parameterXml(p.name, byName(p.name) ?? p, false));
  const head = `<Query Type="SelectQuery" Name="${attrOf(name)}"${query.top ? ` Top="${query.top}"` : ''}${query.distinct ? ' Distinct="true"' : ''}>`;
  return `${head}${params.join('')}<Tables>${tables.join('')}${relations.join('')}</Tables><Columns>${columns}</Columns>${sorting}${query.filter ? `<Filter>${text(query.filter)}</Filter>` : ''}</Query>`;
}

function lookupQuery(spec: DataSourceSpec, lookup: NonNullable<DataSourceSpec['lookups']>[number]): ReportQuery {
  const columns = [...new Set([lookup.valueColumn, lookup.displayColumn ?? lookup.valueColumn, ...((lookup.filter ?? '').match(/\[([\w ]+)\]/g) ?? []).map((c) => c.slice(1, -1))])];
  const obj = findObject(spec.schema, lookup.object);
  return { kind: 'table', object: obj ? `${obj.schema}.${obj.name}` : lookup.object, columns: columns.map((c) => `${obj ? `${obj.schema}.${obj.name}` : lookup.object}.${c}`), joins: [], distinct: true };
}

const lookupName = (parameter: string) => `${parameter}List`;

/** The result schema's view for a query: its fields with 20.1's type names. */
function viewXml(spec: DataSourceSpec, query: ReportQuery, name = queryName(query)): string {
  const fields = query.kind === 'table' ? selectFields(spec.schema, query) : queryFields(spec.schema, query);
  return `<View Name="${attrOf(name)}">${fields.map((f) => `<Field Name="${attrOf(f.name)}" Type="${f.column.type ? resultTypeOf(f.column.type) : 'Unknown'}" />`).join('')}</View>`;
}

function relationName(spec: DataSourceSpec, detail: NonNullable<DataSourceSpec['details']>[number]): string {
  return detail.name || `${queryName(detail.query)}Of${queryName(spec.query)}`;
}

/**
 * The spec with a table query's `details` (the tables pointing back at it,
 * chosen on the Data tab) as master-detail relations, unless the spec names
 * its own.
 */
export function withDetails(spec: DataSourceSpec): DataSourceSpec {
  if (spec.details || spec.query.kind !== 'table' || !spec.query.details?.length) return spec;
  return {
    ...spec,
    details: spec.query.details.map((d) => ({
      query: { kind: 'table' as const, object: d.table, columns: [], joins: [] },
      keys: d.on.map((k) => ({ master: k.from, detail: k.to })),
    })),
  };
}

/** The decoded `<SqlDataSource>` document, in the order 20.1 writes its parts. */
export function sqlDataSourceXml(spec: DataSourceSpec, name = 'sqlDataSource1'): string {
  spec = withDetails(spec);
  const needs = parametersFor(spec);
  const lookups = spec.lookups ?? [];
  const queries = [spec.query, ...(spec.details ?? []).map((d) => d.query)];
  const master = queryName(spec.query);
  const relations = (spec.details ?? []).map((d) => {
    const rel = relationName(spec, d);
    const keys = d.keys.map((k) => `<KeyColumn Master="${attrOf(k.master)}" Detail="${attrOf(k.detail)}" />`).join('');
    return { inner: `<Relation Master="${attrOf(master)}" Detail="${attrOf(queryName(d.query))}" Name="${attrOf(rel)}">${keys}</Relation>`, schema: `<Relation Name="${attrOf(rel)}" Master="${attrOf(master)}" Detail="${attrOf(queryName(d.query))}">${keys}</Relation>` };
  });
  const lookupQueries = lookups.map((l) => ({ query: lookupQuery(spec, l), name: lookupName(l.parameter) }));
  const body = [
    `<Connection Name="${attrOf(spec.connectionName)}" FromAppConfig="true" />`,
    ...queries.map((q) => queryXml(spec, q, needs)),
    ...lookupQueries.map((l) => queryXml(spec, l.query, needs).replace(/^<Query Type="SelectQuery" Name="[^"]*"/, `<Query Type="SelectQuery" Name="${attrOf(l.name)}"`)),
    ...relations.map((r) => r.inner),
    `<ResultSchema><DataSet Name="${attrOf(name)}">${[...queries.map((q) => viewXml(spec, q)), ...lookupQueries.map((l) => viewXml(spec, l.query, l.name)), ...relations.map((r) => r.schema)].join('')}</DataSet></ResultSchema>`,
    '<ConnectionOptions CloseConnection="true" />',
  ];
  return `<SqlDataSource Name="${attrOf(name)}">${body.join('')}</SqlDataSource>`;
}

function maxRef(xml: string): number {
  let max = 0;
  for (const m of xml.matchAll(/\sRef="(\d+)"/g)) max = Math.max(max, Number(m[1]));
  return max;
}

export interface WriteResult {
  xml: string;
  applied: boolean;
  reason: string;
  /** The report parameters added for the queries. */
  parameters: string[];
}

/**
 * Writes a SqlDataSource into a report (checklist items 15 to 19): the
 * ComponentStorage item, the report's DataSource and DataMember, the report
 * parameters its queries need (typed, defaults from the procedure, AllowNull
 * for a NULL default, multi-value and lookups with cascading), the master-
 * detail relation with a detail band when the report has none for it, and
 * calculated fields. The connection is its name only. An existing SqlDataSource
 * is replaced in place, keeping its Ref.
 */
export function writeSqlDataSource(repx: string, spec: DataSourceSpec, version = '20.1'): WriteResult {
  spec = withDetails(spec);
  if (!/<XtraReportsLayoutSerializer\b/.test(repx)) return { xml: repx, applied: false, reason: 'there is no report to write into', parameters: [] };
  const connection = spec.connectionName.trim();
  if (!connection || /[;=]/.test(connection)) return { xml: repx, applied: false, reason: 'the connection needs a name, as in your application’s <connectionStrings>, not a connection string', parameters: [] };
  const fields = queryFields(spec.schema, spec.query);
  if (!fields.length) return { xml: repx, applied: false, reason: `${queryName(spec.query)} has no columns Forma can read, so the report would have nothing to print`, parameters: [] };

  let xml = repx;
  const existing = readRepxDataSources(xml)[0];
  const ref = existing?.ref || String(maxRef(xml) + 1);
  const b64 = encodeBase64(sqlDataSourceXml({ ...spec, connectionName: connection }));
  const item = `<Item1 Ref="${ref}" ObjectType="DevExpress.DataAccess.Sql.SqlDataSource,DevExpress.DataAccess.v20.1" Name="sqlDataSource1" Base64="${b64}" />`;

  if (existing) {
    xml = xml.replace(new RegExp(`(<Item\\d+\\s[^>]*?Ref="${ref}"[^>]*?)Base64="[^"]*"`), `$1Base64="${b64}"`);
  } else if (/<ComponentStorage>/.test(xml)) {
    const count = (/<ComponentStorage>([\s\S]*?)<\/ComponentStorage>/.exec(xml)?.[1].match(/<Item\d+\s/g) ?? []).length;
    xml = xml.replace('</ComponentStorage>', `${item.replace('<Item1', `<Item${count + 1}`)}</ComponentStorage>`);
  } else {
    const at = xml.indexOf('<ObjectStorage>') >= 0 ? xml.indexOf('<ObjectStorage>') : xml.lastIndexOf('</XtraReportsLayoutSerializer>');
    xml = `${xml.slice(0, at)}<ComponentStorage>${item}</ComponentStorage>${xml.slice(at)}`;
  }

  // The report reads the source by reference and the query by name.
  xml = xml.replace(/<XtraReportsLayoutSerializer\b[^>]*>/, (open) => {
    let tag = open.replace(/\sDataSource="[^"]*"/, '').replace(/\sDataMember="[^"]*"/, '');
    tag = tag.replace(/\s*>$/, ` DataMember="${attrOf(queryName(spec.query))}" DataSource="#Ref-${ref}">`);
    return tag;
  });

  // Report parameters, typed inline and lifted into ObjectStorage below, as the serializer does.
  const needs = parametersFor(spec);
  const present = new Set([...(/<Parameters>([\s\S]*?)<\/Parameters>/.exec(xml)?.[1] ?? '').matchAll(/\sName="([^"]*)"/g)].map((m) => m[1]));
  const added: string[] = [];
  let next = maxRef(xml) + 1;
  const lookupRefs = new Map<string, number>();
  const objectStorage: string[] = [];
  const parameterTag = (name: string) =>
    [...(/<Parameters>([\s\S]*?)<\/Parameters>/.exec(xml)?.[1] ?? '').matchAll(/<Item\d+\s[^>]*?\/>/g)].map((m) => m[0]).find((t) => new RegExp(`\\sName="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(t));
  for (const l of spec.lookups ?? []) {
    const settings = `ObjectType="DevExpress.XtraReports.Parameters.DynamicListLookUpSettings, DevExpress.Printing.v20.1.Core" DataSource="#Ref-${ref}" DataMember="${attrOf(lookupName(l.parameter))}" ValueMember="${attrOf(l.valueColumn)}" DisplayMember="${attrOf(l.displayColumn ?? l.valueColumn)}"${l.filter ? ` FilterString="${attrOf(l.filter)}"` : ''}`;
    // A parameter already there (a source written again, 2026-11-09): its own lookup entry
    // is rewritten in place, or a new one attached to it, rather than a second nothing points at.
    const tag = present.has(l.parameter) ? parameterTag(l.parameter) : undefined;
    const current = tag ? /ValueSourceSettings="#Ref-(\d+)"/.exec(tag)?.[1] : undefined;
    const entry = current ? new RegExp(`<Item(\\d+)(?=[^>]*\\sRef="${current}")[^>]*?DynamicListLookUpSettings[^>]*?/>`).exec(xml) : null;
    if (entry) {
      xml = xml.replace(entry[0], `<Item${entry[1]} Ref="${current}" ${settings} />`);
      continue;
    }
    const r = next++;
    lookupRefs.set(l.parameter, r);
    objectStorage.push(`<Item1 Ref="${r}" ${settings} />`);
    // One ValueSourceSettings, whatever the tag held: a second is an XML error the loader refuses (measured 2026-11-09).
    if (tag) xml = xml.replace(tag, tag.replace(/\sValueSourceSettings="[^"]*"/, '').replace(/\s*\/>$/, ` ValueSourceSettings="#Ref-${r}" />`));
  }
  const items: string[] = [];
  for (const p of needs) {
    if (present.has(p.name)) continue;
    const lookup = lookupRefs.get(p.name);
    const attrs = [
      `Ref="${next++}"`,
      `Description="${attrOf(p.name)}"`,
      lookup ? `ValueSourceSettings="#Ref-${lookup}"` : '',
      p.valueInfo !== null ? `ValueInfo="${attrOf(p.valueInfo)}"` : '',
      p.multi ? 'MultiValue="true"' : '',
      p.allowNull ? 'AllowNull="true"' : '',
      `Name="${attrOf(p.name)}"`,
      p.type !== 'System.String' ? `Type="${p.type}"` : '',
    ].filter(Boolean);
    items.push(`<Item1 ${attrs.join(' ')} />`);
    added.push(p.name);
  }
  if (items.length) {
    const block = /<Parameters>([\s\S]*?)<\/Parameters>/.exec(xml);
    const count = block ? (block[1].match(/<Item\d+\s/g) ?? []).length : 0;
    const numbered = items.map((it, i) => it.replace('<Item1', `<Item${count + i + 1}`)).join('');
    xml = block ? xml.replace('</Parameters>', `${numbered}</Parameters>`) : xml.replace(/(<XtraReportsLayoutSerializer\b[^>]*>)/, `$1<Parameters>${numbered}</Parameters>`);
  }
  if (objectStorage.length) {
    const block = /<ObjectStorage>([\s\S]*?)<\/ObjectStorage>/.exec(xml);
    const count = block ? (block[1].match(/<Item\d+\s/g) ?? []).length : 0;
    const numbered = objectStorage.map((it, i) => it.replace('<Item1', `<Item${count + i + 1}`)).join('');
    xml = block ? xml.replace('</ObjectStorage>', `${numbered}</ObjectStorage>`) : xml.replace('</XtraReportsLayoutSerializer>', `<ObjectStorage>${numbered}</ObjectStorage></XtraReportsLayoutSerializer>`);
  }

  // Calculated fields on the source (the emit-calc measurement).
  for (const cf of spec.calculatedFields ?? []) {
    if (!cf.name.trim() || new RegExp(`<CalculatedFields>[\\s\\S]*?\\sName="${cf.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(xml)) continue;
    const entry = `<Item1 Ref="${maxRef(xml) + 1}" Name="${attrOf(cf.name)}" FieldType="${cf.type}" Expression="${attrOf(cf.expression)}" DataMember="${attrOf(cf.dataMember ?? queryName(spec.query))}" />`;
    const block = /<CalculatedFields>([\s\S]*?)<\/CalculatedFields>/.exec(xml);
    if (block) xml = xml.replace('</CalculatedFields>', `${entry.replace('<Item1', `<Item${topLevelItems(block[1]) + 1}`)}</CalculatedFields>`);
    else if (xml.includes('</Parameters>')) xml = xml.replace('</Parameters>', `</Parameters><CalculatedFields>${entry}</CalculatedFields>`);
    else xml = xml.replace(/(<XtraReportsLayoutSerializer\b[^>]*>)/, `$1<CalculatedFields>${entry}</CalculatedFields>`);
  }

  // A detail band for each master-detail relation the report does not print yet.
  for (const d of spec.details ?? []) {
    const path = `${queryName(spec.query)}.${relationName(spec, d)}`;
    if (new RegExp(`DataMember="${path.replace(/\./g, '\\.')}"`).test(xml)) continue;
    xml = addDetailBand(xml, ref, path, queryFields(spec.schema, d.query));
  }

  xml = liftParameterTypes(xml, version).xml;
  // A replaced source's parameters that nothing uses any more, with their lookups (2026-11-09, batch DG).
  const dropped = existing ? dropUnusedParameters(xml, sourceParameters(repx, existing)) : { xml, dropped: [] };
  xml = ensureUniqueRefs(dropped.xml).xml;
  const what = `${existing ? 'Replaced' : 'Wrote'} the data source: ${queryName(spec.query)} on connection "${connection}"`;
  const withAdded = added.length ? `${what}, with parameter${added.length === 1 ? '' : 's'} ${added.join(', ')}` : what;
  return { xml, applied: true, reason: dropped.dropped.length ? `${withAdded}; removed ${dropped.dropped.join(', ')}, which only the old one used` : withAdded, parameters: added };
}

/** `<Item…>` children of a block renumbered from Item1, in order: a collection finds its members by that name. */
function renumber(xml: string, block: 'Parameters' | 'ObjectStorage'): string {
  return xml.replace(new RegExp(`<${block}>([\\s\\S]*?)</${block}>`), (_whole, inner: string) => {
    let n = 0;
    // A self-closing item, or one with content up to its own close; these collections do not nest items.
    const body = inner.replace(/<Item\d+(\s[^>]*?)\/>|<Item\d+(\s[^>]*?)>([\s\S]*?)<\/Item\d+>/g, (_m, selfAttrs: string | undefined, attrs: string | undefined, content: string | undefined) => {
      n++;
      return selfAttrs !== undefined ? `<Item${n}${selfAttrs}/>` : `<Item${n}${attrs}>${content ?? ''}</Item${n}>`;
    });
    return body.trim() ? `<${block}>${body}</${block}>` : '';
  });
}

/**
 * Removes candidates nothing references any more: a report parameter, its
 * lookup entry, and its lifted type when no other parameter shares it. Run
 * until nothing more goes, since a removed lookup's filter may have been the
 * last use of another parameter.
 */
function dropUnusedParameters(xml: string, candidates: ReadonlySet<string>): { xml: string; dropped: string[] } {
  const dropped: string[] = [];
  for (let pass = 0; pass < 4; pass++) {
    const used = new Set([
      ...parameterReferences(xml.replace(/<ComponentStorage>[\s\S]*?<\/ComponentStorage>/, '')),
      ...readRepxDataSources(xml).flatMap((d) => d.queries.flatMap((q) => [q.filter ?? '', ...q.parameters.map((p) => p.value)])).flatMap((s) => [...s.matchAll(/\?([A-Za-z_]\w*)/g)].map((m) => m[1])),
    ]);
    const block = /<Parameters>([\s\S]*?)<\/Parameters>/.exec(xml)?.[1] ?? '';
    const gone = [...block.matchAll(/<Item\d+\s[^>]*?\/>/g)].map((m) => m[0]).filter((tag) => {
      const name = /\sName="([^"]*)"/.exec(tag)?.[1] ?? '';
      return candidates.has(name) && !used.has(name) && !dropped.includes(name);
    });
    if (!gone.length) break;
    for (const tag of gone) {
      dropped.push(/\sName="([^"]*)"/.exec(tag)![1]);
      xml = xml.replace(tag, '');
      const lookup = /ValueSourceSettings="#Ref-(\d+)"/.exec(tag)?.[1];
      if (lookup) xml = xml.replace(new RegExp(`<Item\\d+(?=[^>]*\\sRef="${lookup}")[^>]*?/>`), '');
      const type = /\sType="#Ref-(\d+)"/.exec(tag)?.[1];
      if (type && !xml.includes(`"#Ref-${type}"`)) xml = xml.replace(new RegExp(`<Item\\d+(?=[^>]*\\sRef="${type}")[^>]*?/>`), '');
    }
    xml = renumber(renumber(xml, 'Parameters'), 'ObjectStorage');
  }
  return { xml, dropped };
}

/**
 * A DetailReportBand for a relation (checklist item 18): one row of cells
 * bound to the detail's fields, and a footer totalling the first number with
 * `Running="Report"`, the scope a detail report's own footer needs (a total
 * with no running scope prints blank: gemini.md).
 */
function addDetailBand(xml: string, ref: string, path: string, fields: QueryField[]): string {
  let r = maxRef(xml) + 1;
  const shown = fields.slice(0, 6);
  const width = 650;
  const cellWidth = Math.floor(width / Math.max(1, shown.length));
  const cells = shown.map((f, i) => `<Item${i + 1} Ref="${r++}" ControlType="XRTableCell" Name="cellDetail${i + 1}" Weight="1" Text="${attrOf(f.name)}"><ExpressionBindings><Item1 Ref="${r++}" EventName="BeforePrint" PropertyName="Text" Expression="[${attrOf(f.name)}]" /></ExpressionBindings></Item${i + 1}>`).join('');
  const table = `<Item1 Ref="${r++}" ControlType="XRTable" Name="tableDetailLines" SizeF="${cellWidth * shown.length},20" LocationFloat="25,0"><Rows><Item1 Ref="${r++}" ControlType="XRTableRow" Name="rowDetailLines" Weight="1"><Cells>${cells}</Cells></Item1></Rows></Item1>`;
  // An amount before a count, and never a key or a line number, which nobody totals.
  const keyLike = (name: string) => /(id|no|num|number|code|key|line)$/i.test(name) || /^line/i.test(name);
  const number =
    fields.find((f) => /^(decimal|numeric|money|smallmoney|float|real)$/.test(f.column.type) && !keyLike(f.name)) ??
    fields.find((f) => /^(int|bigint|smallint|tinyint)$/.test(f.column.type) && !keyLike(f.name));
  const footer = number
    ? `<Item2 Ref="${r++}" ControlType="ReportFooterBand" Name="DetailLinesFooter" HeightF="22"><Controls><Item1 Ref="${r++}" ControlType="XRLabel" Name="labelDetailTotal" SizeF="150,20" LocationFloat="${25 + cellWidth * (shown.indexOf(number) >= 0 ? shown.indexOf(number) : 0)},0" TextAlignment="TopRight"><Summary Ref="${r++}" Running="Report" /><ExpressionBindings><Item1 Ref="${r++}" EventName="BeforePrint" PropertyName="Text" Expression="sumSum([${attrOf(number.name)}])" /></ExpressionBindings></Item1></Controls></Item2>`
    : '';
  const bands = /<Bands>([\s\S]*)<\/Bands>/.exec(xml);
  const count = bands ? topLevelItems(bands[1]) : 0;
  const band = `<Item${count + 1} Ref="${r++}" ControlType="DetailReportBand" Name="DetailReport${path.split('.').pop()}" Level="0" DataMember="${attrOf(path)}" DataSource="#Ref-${ref}"><Bands><Item1 Ref="${r++}" ControlType="DetailBand" Name="DetailLines" HeightF="22"><Controls>${table}</Controls></Item1>${footer}</Bands></Item${count + 1}>`;
  const close = xml.lastIndexOf('</Bands>', xml.indexOf('<ComponentStorage>') >= 0 ? xml.indexOf('<ComponentStorage>') : xml.length);
  return close < 0 ? xml : xml.slice(0, close) + band + xml.slice(close);
}
