/**
 * A report's own SQL data source, read back, kept and checked (2026-11-09,
 * the SQL Server programme, batch DG, checklist items 29 and 30).
 *
 * A .repx that arrives with a SqlDataSource carries what it reads: its
 * queries, their joins, filter, sort and Top, its relations, its parameters
 * and their lookup lists, and a result schema. `queryFromRepx` reads that
 * back into the Data tab's `ReportQuery`, so the tab shows it, the AI and the
 * Preview can use it, and it can be written again. `carryDataSource` (in the
 * reader, where the service reaches it) keeps it through a redesign.
 *
 * **Drift** is the report against a newer export of the database's layout: a
 * table, column or procedure it reads that is gone; a column renamed (the
 * likeliest of the table's columns the report does not read, by name and the
 * same type, `fieldMatch.ts`); a column whose type changed since the result
 * schema was written; a procedure parameter the layout now says is OUTPUT
 * (which a .repx alone cannot tell, item 20) or that it no longer takes; and
 * custom SQL naming what the layout lacks. A rename is fixed by rewriting the
 * source with the new name and renaming the field everywhere the report
 * prints or groups by it; the rest by writing the source again from the
 * layout, which is batch DD's measured writer.
 */
import type { SqlSchema } from './sqlSchema';
import { findObject, findProcedure, fieldKind, type QueryJoin, type ReportQuery } from './sqlQuery';
import { readRepxDataSources, type RepxDataSource, type RepxQuery } from './repxSqlDataSource';
import { resultTypeOf, writeSqlDataSource, type DataSourceSpec } from './repxSqlWriter';
import { parseParameters } from './repxParameters';
import { renameField, scoreMatch } from './fieldMatch';
import { checkSqlAgainstSchema } from './databaseAi';
import { unescapeXml } from './xmlEscape';

const full = (o: { schema: string; name: string }) => `${o.schema}.${o.name}`;
const qualified = (name: string) => (name.includes('.') ? name : `dbo.${name}`);

/** The source the report reads, and the query its `DataMember` names (the first when it names none). */
export function mainQueryOf(repx: string): { ds: RepxDataSource; query: RepxQuery } | null {
  const ds = readRepxDataSources(repx)[0];
  if (!ds?.queries.length) return null;
  const member = /<XtraReportsLayoutSerializer\b[^>]*\sDataMember="([^"]*)"/.exec(repx)?.[1]?.split('.')[0];
  return { ds, query: ds.queries.find((q) => q.name === member) ?? ds.queries[0] };
}

/**
 * The report's main query as the Data tab's `ReportQuery`, its tables named
 * as the layout spells them when one is given: a built query with its joins,
 * columns, filter, sort, Top and distinct and its master-detail relations as
 * details; a procedure; custom SQL.
 */
export function queryFromRepx(repx: string, schema?: SqlSchema | null): ReportQuery | null {
  const main = mainQueryOf(repx);
  if (!main) return null;
  const { ds, query: q } = main;
  const name = (table: string) => {
    const obj = schema ? findObject(schema, table) : undefined;
    return obj ? full(obj) : qualified(table);
  };
  if (q.type === 'StoredProcQuery' && q.procName) {
    const proc = schema ? findProcedure(schema, q.procName) : undefined;
    return { kind: 'procedure', procedure: proc ? full(proc) : qualified(q.procName) };
  }
  if (q.type === 'CustomSqlQuery' && q.sql) return { kind: 'custom', name: q.name, sql: q.sql };
  if (!q.tables[0]) return null;
  const details: QueryJoin[] = [];
  for (const r of ds.relations.filter((x) => x.master === q.name)) {
    const table = ds.queries.find((x) => x.name === r.detail)?.tables[0];
    if (table) details.push({ table: name(table), type: 'Inner', on: r.keys.map((k) => ({ from: k.master, to: k.detail })) });
  }
  return {
    kind: 'table',
    object: name(q.tables[0]),
    columns: q.allColumns ? [] : q.columns.map((c) => `${name(c.table)}.${c.name}`),
    joins: q.joins.map((j) => ({ table: name(j.nested), type: j.type === 'LeftOuter' ? 'LeftOuter' : 'Inner', on: j.keys.map((k) => ({ from: k.parent, to: k.nested })) })),
    ...(q.filter ? { filter: q.filter } : {}),
    ...(q.sort.length ? { sort: q.sort.map((s) => ({ column: `${name(s.table)}.${s.name}`, ...(s.descending ? { descending: true } : {}) })) } : {}),
    ...(q.top ? { top: q.top } : {}),
    ...(q.distinct ? { distinct: true } : {}),
    ...(details.length ? { details } : {}),
  };
}

/** Everything the writer needs to write the report's own source again over a layout: its connection, parameters and lookups. */
export function specFor(repx: string, schema: SqlSchema, query: ReportQuery): DataSourceSpec {
  const main = mainQueryOf(repx);
  const storage = /<ObjectStorage>([\s\S]*?)<\/ObjectStorage>/.exec(repx)?.[1] ?? '';
  const block = /<Parameters>([\s\S]*?)<\/Parameters>/.exec(repx)?.[1] ?? '';
  const lookups: NonNullable<DataSourceSpec['lookups']> = [];
  for (const m of block.matchAll(/<Item\d+\s[^>]*>/g)) {
    const parameter = /\sName="([^"]*)"/.exec(m[0])?.[1];
    const ref = /ValueSourceSettings="#Ref-(\d+)"/.exec(m[0])?.[1];
    const item = ref ? [...storage.matchAll(/<Item\d+\s[^>]*>/g)].map((s) => s[0]).find((s) => s.includes(` Ref="${ref}"`) && /DynamicListLookUpSettings/.test(s)) : undefined;
    const table = item ? main?.ds.queries.find((q) => q.name === /\sDataMember="([^"]*)"/.exec(item)?.[1])?.tables[0] : undefined;
    const valueColumn = item ? /\sValueMember="([^"]*)"/.exec(item)?.[1] : undefined;
    if (!parameter || !table || !valueColumn) continue;
    const obj = findObject(schema, table);
    const raw = /\sFilterString="([^"]*)"/.exec(item!)?.[1];
    const filter = raw === undefined ? undefined : unescapeXml(raw);
    lookups.push({ parameter, object: obj ? full(obj) : qualified(table), valueColumn, displayColumn: /\sDisplayMember="([^"]*)"/.exec(item!)?.[1], ...(filter ? { filter } : {}) });
  }
  return {
    connectionName: main?.ds.connectionName || schema.database || 'Database',
    schema,
    query,
    multiValue: parseParameters(repx).filter((p) => p.multiValue).map((p) => p.name),
    lookups,
  };
}

/**
 * An imported layout with what the report reads besides (item 29): the
 * export's objects first, its types and keys being the fuller, and any table
 * or procedure only the report names added, so the Data tab browses both.
 */
export function mergeLayouts(imported: SqlSchema, fromReport: SqlSchema | null): SqlSchema {
  if (!fromReport) return imported;
  const known = new Set([...imported.objects, ...imported.procedures].map((o) => full(o).toLowerCase()));
  return {
    ...imported,
    objects: [...imported.objects, ...fromReport.objects.filter((o) => !known.has(full(o).toLowerCase()))],
    procedures: [...imported.procedures, ...fromReport.procedures.filter((p) => !known.has(full(p).toLowerCase()))],
  };
}

export type DriftKind = 'missing-object' | 'missing-column' | 'renamed' | 'retyped' | 'output-param' | 'missing-param' | 'new-param' | 'custom-sql';

export interface DriftItem {
  kind: DriftKind;
  /** The query of the report it is in. */
  query: string;
  message: string;
  /** For `renamed`: the table, the name the report reads, and the likeliest new one. */
  rename?: { table: string; from: string; to: string };
}

/**
 * The report's data source against a layout (item 30): what it reads that is
 * gone, renamed or retyped, and a procedure's parameters that changed.
 */
export function driftOf(repx: string, schema: SqlSchema): DriftItem[] {
  const out: DriftItem[] = [];
  const db = schema.database || 'the layout';
  for (const ds of readRepxDataSources(repx)) {
    for (const q of ds.queries) {
      const view = ds.views.find((v) => v.name === q.name)?.fields ?? [];
      const viewType = (name: string) => view.find((f) => f.name.toLowerCase() === name.toLowerCase())?.type;
      /** A column the report reads, against the columns the layout has for it now. */
      const checkColumn = (owner: string, columns: { name: string; type: string; scale?: number; precision?: number; length?: number }[], name: string, read: Set<string>) => {
        const now = columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
        const was = viewType(name);
        if (now) {
          const type = resultTypeOf(now.type);
          if (was && was !== 'Unknown' && type !== 'Unknown' && was !== type) {
            out.push({ kind: 'retyped', query: q.name, message: `${owner}.${name} was ${was} when the report was written and is ${type} (${now.type}) in ${db}.` });
          }
          return;
        }
        // The likeliest new name: a column the report does not read, alike in name and of the same type.
        const candidates = columns
          .filter((c) => !read.has(c.name.toLowerCase()) && (!was || resultTypeOf(c.type) === was))
          .map((c) => ({ c, score: scoreMatch({ heading: name }, { name: c.name, type: fieldKind(c) }).score }))
          .filter((x) => x.score >= 0.6)
          .sort((a, b) => b.score - a.score);
        // Measured (2026-11-09, sql-fill over FormaSample with a column renamed): a built query naming a
        // column the database lacks fails ("One or more queries have failed to validate") and nothing prints.
        const cost = q.type === 'SelectQuery' ? 'DevExpress refuses the query and the report prints nothing' : 'a field bound to it prints blank';
        if (candidates.length) {
          out.push({ kind: 'renamed', query: q.name, message: `${owner}.${name} is not in ${db}, so ${cost}; it looks renamed to ${candidates[0].c.name}.`, rename: { table: owner, from: name, to: candidates[0].c.name } });
        } else {
          out.push({ kind: 'missing-column', query: q.name, message: `${owner}.${name} is not in ${db}, so ${cost}.` });
        }
      };

      if (q.type === 'SelectQuery') {
        const tables = q.tables.map((t) => ({ t, obj: findObject(schema, t) }));
        for (const { t, obj } of tables) if (!obj) out.push({ kind: 'missing-object', query: q.name, message: `The query ${q.name} reads ${t}, which this layout of ${db} does not have: it is gone, or the export left it out.` });
        const read = new Set([...q.columns.map((c) => c.name.toLowerCase()), ...view.map((f) => f.name.toLowerCase())]);
        // The columns it names, or, for every column of one table, the fields its result schema lists.
        const named = q.allColumns ? view.map((f) => ({ table: q.tables[0], name: f.name })) : q.columns;
        for (const c of named) {
          const obj = tables.find((x) => x.t.replace(/^.*\./, '').toLowerCase() === c.table.replace(/^.*\./, '').toLowerCase())?.obj;
          if (obj) checkColumn(obj.name, obj.columns, c.name, read);
        }
      } else if (q.type === 'StoredProcQuery' && q.procName) {
        const proc = findProcedure(schema, q.procName);
        if (!proc) {
          out.push({ kind: 'missing-object', query: q.name, message: `The query ${q.name} runs ${q.procName}, which ${db} does not have.` });
          continue;
        }
        const supplied = new Set(q.parameters.map((p) => p.name.toLowerCase()));
        for (const p of q.parameters) {
          const now = proc.parameters.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
          if (!now) out.push({ kind: 'missing-param', query: q.name, message: `${proc.name} no longer takes ${p.name}, which the report passes.` });
          else if (now.output) out.push({ kind: 'output-param', query: q.name, message: `${p.name} is an OUTPUT parameter of ${proc.name}; DevExpress passes it as an input, so the report should not supply it.` });
        }
        for (const p of proc.parameters) {
          if (!p.output && p.defaultValue === undefined && !supplied.has(p.name.toLowerCase())) out.push({ kind: 'new-param', query: q.name, message: `${proc.name} now takes ${p.name}, with no default, which the report does not supply.` });
        }
        if (proc.result.length) {
          const read = new Set(view.map((f) => f.name.toLowerCase()));
          for (const f of view) checkColumn(proc.name, proc.result, f.name, read);
        }
      } else if (q.type === 'CustomSqlQuery' && q.sql) {
        for (const problem of checkSqlAgainstSchema(q.sql, schema)) out.push({ kind: 'custom-sql', query: q.name, message: `The custom SQL of ${q.name}: ${problem}.` });
      }
    }
  }
  return out;
}

function renameInQuery(query: ReportQuery, r: { table: string; from: string; to: string }): ReportQuery {
  if (query.kind !== 'table') return query;
  const owns = (ref: string) => ref.replace(/\.[^.]*$/, '').replace(/^.*\./, '').toLowerCase() === r.table.replace(/^.*\./, '').toLowerCase();
  const col = (ref: string) => (owns(ref) && ref.replace(/^.*\./, '').toLowerCase() === r.from.toLowerCase() ? `${ref.replace(/\.[^.]*$/, '')}.${r.to}` : ref);
  const key = (k: { from: string; to: string }, joined: string) => ({
    from: owns(`${query.object}.x`) && k.from.toLowerCase() === r.from.toLowerCase() ? r.to : k.from,
    to: owns(`${joined}.x`) && k.to.toLowerCase() === r.from.toLowerCase() ? r.to : k.to,
  });
  return {
    ...query,
    columns: query.columns.map(col),
    joins: query.joins.map((j) => ({ ...j, on: j.on.map((k) => key(k, j.table)) })),
    ...(query.filter ? { filter: query.filter.replace(new RegExp(`\\[(${r.table.replace(/^.*\./, '')}\\.)?${r.from}\\]`, 'gi'), (_, t: string | undefined) => `[${t ?? ''}${r.to}]`) } : {}),
    ...(query.sort ? { sort: query.sort.map((s) => ({ ...s, column: col(s.column) })) } : {}),
    ...(query.details ? { details: query.details.map((d) => ({ ...d, on: d.on.map((k) => key(k, d.table)) })) } : {}),
  };
}

/**
 * Which query each place in the report reads (2026-11-11, the full audit,
 * SD-26): given an offset, the query its innermost DetailReportBand's
 * DataMember resolves to through the source's relations, or the report's own
 * DataMember (its main query when it names none) outside every detail band.
 * null when the member names no query this report's sources hold.
 *
 * The same walk as `auditDataSources`' field check in repxSqlDataSource.ts,
 * which keeps its own copy private; the two answer the same question and
 * must agree.
 */
function queryAt(xml: string): (at: number) => string | null {
  const sources = readRepxDataSources(xml);
  const queries = new Set(sources.flatMap((d) => d.queries.map((q) => q.name)));
  const relations = new Map(sources.flatMap((d) => d.relations.map((r) => [r.name, r.detail] as const)));
  const root = /<XtraReportsLayoutSerializer\b[^>]*>/.exec(xml)?.[0] ?? '';
  const rootMember = /\sDataMember="([^"]*)"/.exec(root)?.[1] || mainQueryOf(xml)?.query.name || '';
  const resolve = (member: string): string | null => {
    const path = member.split('.');
    let query: string | null = queries.has(path[0]) ? path[0] : null;
    for (let i = 1; i < path.length && query; i++) query = relations.get(path[i]) ?? null;
    return query;
  };
  // The span of every DetailReportBand, with its DataMember.
  const regions: { start: number; end: number; member: string }[] = [];
  for (const open of xml.matchAll(/<(Item\d+)\s[^>]*ControlType="DetailReportBand"[^>]*>/g)) {
    const tag = /<(\/?)Item\d+\b[^>]*?(\/?)>/g;
    tag.lastIndex = open.index!;
    let depth = 0;
    let end = xml.length;
    for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
      if (m[1]) {
        if (--depth === 0) {
          end = m.index + m[0].length;
          break;
        }
      } else if (!m[2]) depth++;
    }
    regions.push({ start: open.index!, end, member: /\sDataMember="([^"]*)"/.exec(open[0])?.[1] ?? '' });
  }
  return (at) => {
    const inside = regions.filter((r) => r.start <= at && at < r.end).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
    return resolve(inside ? inside.member : rootMember);
  };
}

const bare = (name: string) => name.replace(/^.*\./, '').toLowerCase();

/**
 * The report's source written again from a layout (item 30's fix): the query
 * read back, any renames applied to it, its parameters and lookups kept, and
 * each renamed field renamed wherever the report prints or groups by it from
 * a query that reads the renamed table (2026-11-11, SD-26: until then every
 * `[Old]` in the report, a detail band reading another table's field of the
 * same name included). A place whose query cannot be told is renamed, as before.
 */
export function refreshDataSource(repx: string, schema: SqlSchema, renames: readonly { table: string; from: string; to: string }[] = []): { xml: string; applied: boolean; reason: string } {
  let query = queryFromRepx(repx, schema);
  if (!query) return { xml: repx, applied: false, reason: 'the report has no data source Forma can read back' };
  for (const r of renames) query = renameInQuery(query, r);
  const done = writeSqlDataSource(repx, specFor(repx, schema, query));
  if (!done.applied) return { xml: repx, applied: false, reason: done.reason };
  let xml = done.xml;
  const renamed: string[] = [];
  for (const r of renames) {
    // The queries that read the renamed table (or run the renamed procedure), in the source as written now.
    const readers = new Set(
      readRepxDataSources(xml)
        .flatMap((d) => d.queries)
        .filter((q) => q.tables.some((t) => bare(t) === bare(r.table)) || (q.procName !== undefined && bare(q.procName) === bare(r.table)))
        .map((q) => q.name),
    );
    const at = queryAt(xml);
    const out = renameField(xml, r.from, r.to, (offset) => {
      const query = at(offset);
      return query === null || readers.has(query);
    });
    xml = out.xml;
    renamed.push(`[${r.from}] to [${r.to}]${out.count ? ` in ${out.count} place${out.count === 1 ? '' : 's'}` : ''}`);
  }
  // What the layout no longer has is no longer read, and said: a field bound to it prints blank.
  const fieldsOf = (x: string) => new Set(readRepxDataSources(x).flatMap((d) => d.views.flatMap((v) => v.fields.map((f) => f.name))));
  const after = fieldsOf(xml);
  const lost = [...fieldsOf(repx)].filter((f) => !after.has(f) && !renames.some((r) => r.from.toLowerCase() === f.toLowerCase()));
  const tail = lost.length ? `; it no longer reads ${lost.join(', ')}, which the layout does not have` : '';
  return { xml, applied: true, reason: `${renamed.length ? `${done.reason}; renamed ${renamed.join(', ')}` : `${done.reason}, from the layout of ${schema.database || 'the database'}`}${tail}` };
}
