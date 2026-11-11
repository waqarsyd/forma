/**
 * The Data tab's database (2026-11-08, the SQL Server programme, batch DC,
 * checklist items 11 to 14): a SQL Server database's layout to browse, as
 * DevExpress's Field List and Power BI's Navigator show one, what the report
 * reads chosen from it, and its fields bound to what is selected on the
 * Preview.
 *
 * Nothing here connects: the layout came from Forma's script or an SSMS file
 * (lib/sqlSchema.ts) and is kept on this device (lib/sqlSchemaStore.ts). The
 * query chosen here is `ReportQuery` (lib/sqlQuery.ts), which batch DD writes
 * into the .repx as DevExpress's SqlDataSource, connection by name only.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DataField } from '../lib/dataSource';
import type { CalcType, DataSourceSpec } from '../lib/repxSqlWriter';
import type { SqlObject, SqlProcedure, SqlSchema } from '../lib/sqlSchema';
import { resultFix, summarizeSchema, typeLabel } from '../lib/sqlSchema';
import { SCHEMA_SCRIPT, sampleScript } from '../lib/sqlSchemaScript';
import { checkSqlAgainstSchema } from '../lib/databaseAi';
import { driftOf, mainQueryOf, mergeLayouts, queryFromRepx, refreshDataSource } from '../lib/sqlDrift';
import { schemaFromRepx, type RepxQuery } from '../lib/repxSqlDataSource';
import { parseParameters } from '../lib/repxParameters';
import { companionConnections, companionLayout, companionReachableFrom, companionSamples, type CompanionConnection } from '../lib/sqlCompanion';
import {
  checkCustomSql,
  describeQuery,
  duplicateFields,
  findObject,
  fieldKind,
  queryFields,
  queryParameters,
  suggestJoins,
  type QueryJoin,
  type ReportQuery,
} from '../lib/sqlQuery';

interface Props {
  database: SqlSchema | null;
  /** The databases kept on this device, newest first. */
  recent: string[];
  onSwitch: (name: string) => void;
  onForget: (name: string) => void;
  query: ReportQuery | null;
  onQuery: (query: ReportQuery | null) => void;
  /** What is selected on the Preview, for "Bind": a name, or empty. */
  selectionLabel: string;
  onBindField: (field: string) => void;
  onCopy: (text: string) => Promise<boolean>;
  /** The chosen query's fields, as the Data tab's mapping reads fields, whenever they change. */
  onFieldsChange?: (fields: DataField[], label: string) => void;
  /**
   * Writes the chosen query into the report as DevExpress's SqlDataSource
   * (batch DD): App runs `writeSqlDataSource` with the layout and the query,
   * and returns the line to show.
   */
  onWrite?: (options: WriteOptions) => Promise<string>;
  /**
   * Whether the layout's names and sample values go to the AI with a
   * generation, a chat turn about the report, and a sentence turned into SQL
   * (2026-11-09, batch DE). On when the user attached the export; off for a
   * layout pasted here or chosen from those kept, until ticked.
   */
  shared?: boolean;
  onShare?: (on: boolean) => void;
  /** Custom SQL from a sentence (item 26): the AI writes it over the layout, and this panel holds it to the layout. */
  onAskSql?: (sentence: string) => Promise<{ sql: string; name: string; explanation: string }>;
  /** The open report, whose own data source is shown and checked (batch DG). */
  repx?: string | null;
  /** A REPX changed here (a drift fixed), for App to apply with a revision. */
  onApplyRepx?: (xml: string, reason: string) => void;
  /** A layout to make the active database: the report's own, or one with the report's tables kept. */
  onAdopt?: (schema: SqlSchema) => void;
  /** Layout or sample output read through the companion (Phase 2), for App to read as a pasted one; the line to show. */
  onLayoutText?: (text: string) => Promise<string | null>;
}

export type WriteOptions = Pick<DataSourceSpec, 'connectionName' | 'multiValue' | 'lookups' | 'calculatedFields'>;

const CALC_TYPES: CalcType[] = ['String', 'Decimal', 'Int32', 'Double', 'DateTime', 'Boolean'];

/* `.dbx-input` carries `outline: none` (2026-11-11, audit FB-2): with no author
   outline, its twelve fields drew Chrome's own dark ring on every click; the
   workspace's keyboard ring still wins for the keyboard. Warnings are ink, never
   the light `--warn`, which was #d9a95f on white (audit FB-11). */
const CSS = `
.dbx { display: grid; gap: 14px; margin-bottom: 22px; }
.dbx-card { border: 1px solid var(--paper-rule, #d7dee7); border-radius: 10px; padding: 14px 16px; background: var(--surface-container-lowest, #fff); }
.dbx-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.dbx-head h3 { margin: 0; font-size: 14px; }
.dbx-sub { font-size: 12.5px; opacity: .78; }
.dbx-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dbx-btn { padding: 5px 10px; border-radius: 999px; border: 1px solid var(--paper-rule, #d7dee7); background: none; color: inherit; font: inherit; font-size: 12.5px; cursor: pointer; }
.dbx-btn:hover:not(:disabled) { background: var(--track, rgba(0,0,0,.05)); }
.dbx-btn:disabled { opacity: .5; cursor: default; }
.dbx-btn--solid { background: var(--ink, #1b2430); color: var(--panel, #fff); border-color: transparent; }
.dbx-input { width: 100%; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--paper-rule, #d7dee7); background: var(--surface-container-lowest, #fff); color: inherit; font: inherit; font-size: 13px; outline: none; }
.dbx-group { margin-top: 10px; }
.dbx-group > h4 { margin: 0 0 4px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; opacity: .7; }
.dbx-item { border-top: 1px solid var(--paper-rule, #e6ebf1); }
.dbx-item > button { display: flex; width: 100%; justify-content: space-between; gap: 8px; padding: 6px 2px; border: 0; background: none; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.dbx-item > button:hover { background: var(--track, rgba(0,0,0,.04)); }
.dbx-cols { margin: 2px 0 8px 12px; display: grid; gap: 2px; font-size: 12.5px; }
.dbx-col { display: flex; gap: 8px; }
.dbx-col code { font-size: 12px; opacity: .8; }
.dbx-badge { font-size: 10.5px; padding: 0 5px; border-radius: 4px; background: var(--track, rgba(0,0,0,.06)); }
.dbx-warn { font-size: 12.5px; color: var(--warn-ink, #8a5a00); }
.dbx-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px; }
.dbx-field { display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid var(--paper-rule, #e6ebf1); border-radius: 8px; font-size: 12.5px; }
.dbx-field code { font-size: 11.5px; opacity: .75; }
.dbx textarea.dbx-input { min-height: 110px; font-family: var(--mono, ui-monospace, monospace); font-size: 12px; }
`;

const fullName = (o: { schema: string; name: string }) => `${o.schema}.${o.name}`;

function matches(text: string, o: SqlObject | SqlProcedure): boolean {
  if (!text) return true;
  const t = text.toLowerCase();
  if (fullName(o).toLowerCase().includes(t)) return true;
  const columns = 'columns' in o ? o.columns : [...o.parameters, ...o.result];
  return columns.some((c) => c.name.toLowerCase().includes(t));
}

/**
 * The report's own SQL data source (2026-11-09, the SQL Server programme,
 * batch DG, items 29 and 30): its connection, queries, relations, fields and
 * parameters as the file holds them, read back by `lib/sqlDrift.ts`. With a
 * layout imported, it is checked against it, and each difference is said with
 * its fix: a renamed column renamed, the source written again for a changed
 * type or a procedure's parameters, or the report's own copy of what the
 * export left out kept in the layout. With none, the layout it uses can be
 * browsed as the database.
 */
function ReportSource({ repx, database, onQuery, onApplyRepx, onAdopt }: {
  repx: string;
  database: SqlSchema | null;
  onQuery: (query: ReportQuery | null) => void;
  onApplyRepx?: (xml: string, reason: string) => void;
  onAdopt?: (schema: SqlSchema) => void;
}) {
  const main = useMemo(() => mainQueryOf(repx), [repx]);
  const own = useMemo(() => schemaFromRepx(repx), [repx]);
  const drift = useMemo(() => (database && main && database.source !== 'repx' ? driftOf(repx, database) : []), [repx, database, main]);
  const [done, setDone] = useState('');
  if (!main) return null;
  const { ds } = main;
  const parameters = parseParameters(repx);
  const fields = ds.views.find((v) => v.name === main.query.name)?.fields ?? [];
  const describe = (q: RepxQuery) =>
    q.type === 'StoredProcQuery'
      ? `stored procedure ${q.procName}${q.parameters.length ? ` (${q.parameters.map((p) => p.name).join(', ')})` : ''}`
      : q.type === 'CustomSqlQuery'
        ? 'custom SQL'
        : `${q.tables.join(' with ')}${q.filter ? `, filtered by ${q.filter}` : ''}${q.sort.length ? `, sorted by ${q.sort.map((s) => `${s.name}${s.descending ? ' descending' : ''}`).join(', ')}` : ''}${q.top ? `, top ${q.top}` : ''}${q.distinct ? ', distinct rows' : ''}`;
  const apply = (out: { xml: string; applied: boolean; reason: string }) => {
    if (out.applied) onApplyRepx?.(out.xml, out.reason);
    setDone(out.applied ? `${out.reason}.` : `Not changed: ${out.reason}.`);
  };
  const renames = drift.filter((d) => d.rename).map((d) => d.rename!);
  const rewrite = drift.some((d) => d.kind === 'retyped' || d.kind === 'output-param' || d.kind === 'missing-param' || d.kind === 'new-param');
  return (
    <section className="dbx-card" aria-label="The report’s own data source">
      <div className="dbx-head">
        <h3>The report’s data source</h3>
        <span className="dbx-sub">connection “{ds.connectionName}”{ds.fromAppConfig ? ', by name' : ''}</span>
        <span style={{ flex: 1 }} />
        {database && <button type="button" className="dbx-btn" onClick={() => onQuery(queryFromRepx(repx, database))}>Use it as what the report reads</button>}
        {!database && own && onAdopt && <button type="button" className="dbx-btn dbx-btn--solid" onClick={() => onAdopt(own)}>Browse the layout it uses</button>}
      </div>
      <ul className="dbx-sub" style={{ margin: '8px 0', paddingLeft: 18, lineHeight: 1.6 }}>
        {ds.queries.map((q) => (
          <li key={q.name}><strong>{q.name}</strong>{q.name === main.query.name ? ' (the report reads it)' : ''}: {describe(q)}</li>
        ))}
        {ds.relations.map((r) => (
          <li key={r.name}>{r.master} to {r.detail}, a detail band, on {r.keys.map((k) => `${k.master} = ${k.detail}`).join(' and ')}</li>
        ))}
      </ul>
      {fields.length > 0 && (
        <div className="dbx-fields">
          {fields.map((f) => <span className="dbx-field" key={f.name}>{f.name} <code>{f.type}</code></span>)}
        </div>
      )}
      {parameters.length > 0 && (
        <p className="dbx-sub" style={{ margin: '8px 0 0' }}>
          Parameters: {parameters.map((p) => `${p.name} (${(p.resolvedType ?? p.type).replace('System.', '')}${p.multiValue ? ', several values' : ''})`).join(', ')}
        </p>
      )}
      {database && database.source !== 'repx' && (drift.length === 0 ? (
        <p className="dbx-sub" role="status" style={{ margin: '8px 0 0' }}>Every table, column and procedure it reads is in {database.database || 'this layout'}, with the same types.</p>
      ) : (
        <div className="dbx-group" aria-label="Against the layout">
          <h4>Against the layout of {database.database || 'this database'} ({drift.length})</h4>
          {drift.map((d, i) => (
            <p key={i} className="dbx-warn" style={{ margin: '2px 0' }}>
              {d.message}
              {d.rename && onApplyRepx && (
                <> <button type="button" className="dbx-btn" onClick={() => apply(refreshDataSource(repx, database, [d.rename!]))}>Rename to {d.rename.to}</button></>
              )}
            </p>
          ))}
          <div className="dbx-row" style={{ marginTop: 6 }}>
            {renames.length > 1 && onApplyRepx && <button type="button" className="dbx-btn" onClick={() => apply(refreshDataSource(repx, database, renames))}>Rename all {renames.length}</button>}
            {rewrite && onApplyRepx && <button type="button" className="dbx-btn dbx-btn--solid" onClick={() => apply(refreshDataSource(repx, database))}>Write the data source again from this layout</button>}
            {drift.some((d) => d.kind === 'missing-object') && onAdopt && own && (
              <button type="button" className="dbx-btn" onClick={() => onAdopt(mergeLayouts(database, own))}>Keep the report’s own copy of what this layout lacks</button>
            )}
          </div>
        </div>
      ))}
      {done && <p className="dbx-sub" role="status" style={{ margin: '8px 0 0' }}>{done}</p>}
    </section>
  );
}

/**
 * Read from my SQL Server (2026-11-09, the SQL Server programme, Phase 2,
 * item 36): with Forma served from this PC and the companion running, its
 * connections are listed and the layout or sample rows read through it, as
 * the scripts would read them, with no copy and paste. Anywhere else, the
 * deployed site above all, the page never calls 127.0.0.1 and says how.
 */
function CompanionCard({ onLayoutText, sampleObjects }: { onLayoutText: (text: string) => Promise<string | null>; sampleObjects: string[] }) {
  const reachable = typeof window !== 'undefined' && companionReachableFrom(window.location.origin);
  const [connections, setConnections] = useState<CompanionConnection[] | null | undefined>(undefined);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState('');
  if (!reachable) {
    return (
      <p className="dbx-sub" style={{ margin: '10px 0 0' }}>
        Forma on your own PC, with its companion running, reads your SQL Server directly, with no script to copy:{' '}
        <a href="/docs#sql" style={{ color: 'inherit' }}>how</a>. This page cannot reach your PC, so it does not try.
      </p>
    );
  }
  const run = async (what: () => Promise<string>) => {
    setBusy(true);
    setLine('');
    try {
      setLine((await onLayoutText(await what())) ?? 'Read, but it did not look like Forma’s layout or sample output.');
    } catch (err) {
      setLine(err instanceof Error ? err.message : 'The companion could not read it.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dbx-group" aria-label="Read from my SQL Server">
      <h4>Read from my SQL Server</h4>
      {connections === undefined ? (
        <button
          type="button"
          className="dbx-btn"
          onClick={async () => {
            const found = await companionConnections();
            setConnections(found);
            if (found?.length) setChosen(found[0].name);
          }}
        >
          Look for the companion on this PC
        </button>
      ) : connections === null ? (
        <p className="dbx-sub" style={{ margin: 0 }}>No companion answered. Start <code>RepxDesigner.exe --serve</code> on this PC, then look again.</p>
      ) : connections.length === 0 ? (
        <p className="dbx-sub" style={{ margin: 0 }}>The companion keeps no connections yet. Add one from its tray menu, <em>SQL Server connections</em>: a login’s password is typed there and stays on this PC.</p>
      ) : (
        <div className="dbx-row">
          <select className="dbx-input" style={{ width: 'auto' }} aria-label="Connection on this PC" value={chosen} onChange={(e) => setChosen(e.target.value)}>
            {connections.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.database})</option>)}
          </select>
          <button type="button" className="dbx-btn dbx-btn--solid" disabled={busy || !chosen} onClick={() => run(() => companionLayout(chosen))}>{busy ? 'Reading…' : 'Read the layout'}</button>
          <button type="button" className="dbx-btn" disabled={busy || !chosen || !sampleObjects.length} title={sampleObjects.length ? undefined : 'Choose what the report reads first'} onClick={() => run(() => companionSamples(chosen, sampleObjects))}>Read sample rows</button>
        </div>
      )}
      {line && <p className="dbx-sub" role="status" style={{ margin: '6px 0 0' }}>{line}</p>}
    </div>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function DatabasePanel({ database, recent, onSwitch, onForget, query, onQuery, selectionLabel, onBindField, onCopy, onFieldsChange, onWrite, shared = false, onShare, onAskSql, repx, onApplyRepx, onAdopt, onLayoutText }: Props) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('Query');
  const [customSql, setCustomSql] = useState('');
  // What goes into the report with the query (batch DD).
  const [connection, setConnection] = useState('');
  const [multi, setMulti] = useState<string[]>([]);
  const [lookups, setLookups] = useState<Record<string, { source: string; dependsOn: string }>>({});
  const [calcs, setCalcs] = useState<{ name: string; expression: string; type: CalcType }[]>([]);
  const [written, setWritten] = useState('');
  const [writing, setWriting] = useState(false);
  // Custom SQL from a sentence (item 26).
  const [sentence, setSentence] = useState('');
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState('');

  const copy = async (label: string, text: string) => setCopied((await onCopy(text)) ? `${label} copied.` : `Copy did not work here; use Download instead.`);

  const fields = useMemo(() => (database && query ? queryFields(database, query) : []), [database, query]);
  const duplicates = useMemo(() => duplicateFields(fields), [fields]);
  const params = useMemo(() => (database && query ? queryParameters(database, query) : []), [database, query]);
  const custom = useMemo(() => checkCustomSql(customSql), [customSql]);
  // Held to the layout too (item 26): a table or column it does not have is refused, not run.
  const unknownNames = useMemo(() => (database && customSql.trim() ? checkSqlAgainstSchema(customSql, database) : []), [customSql, database]);

  // The mapping below the panel reads these as it reads a pasted sample's fields.
  useEffect(() => {
    onFieldsChange?.(
      fields.map((f) => {
        // The layout's sample values, so the mapping can match a column by what it shows (item 23).
        const samples = (database?.samples?.[f.source] ?? []).map((r) => r[f.name]).filter((v) => v !== null && v !== undefined && v !== '').map(String).slice(0, 10);
        return { name: f.name, type: fieldKind(f.column), sample: samples[0] ?? '', samples };
      }),
      query ? describeQuery(query) : '',
    );
    // Keyed on the fields alone: App passes a new onFieldsChange on every render.
  }, [fields]);

  if (!database) {
    return (
      <div className="dbx">
        <style>{CSS}</style>
        <section className="dbx-card" aria-label="Your SQL Server database">
          <div className="dbx-head"><h3>Your SQL Server database</h3></div>
          <ol className="dbx-sub" style={{ margin: '8px 0', paddingLeft: 18, lineHeight: 1.6 }}>
            <li>Copy Forma&apos;s layout script. It only reads SQL Server&apos;s catalog: no rows, no logins, nothing changed.</li>
            <li>Run it in SSMS on your database, click the one result cell (it opens in full), select all and copy.</li>
            <li>Paste it in the box below, or drop the file into the chat. Forma never connects to your server.</li>
          </ol>
          <div className="dbx-row">
            <button type="button" className="dbx-btn dbx-btn--solid" onClick={() => copy('The layout script', SCHEMA_SCRIPT)}>Copy the layout script</button>
            <button type="button" className="dbx-btn" onClick={() => download('forma-schema.sql', SCHEMA_SCRIPT)}>Download it (.sql)</button>
            {copied && <span className="dbx-sub" role="status">{copied}</span>}
          </div>
          {recent.length > 0 && (
            <div className="dbx-row" style={{ marginTop: 10 }}>
              <span className="dbx-sub">Kept in this browser:</span>
              {recent.map((name) => (
                <button key={name} type="button" className="dbx-btn" onClick={() => onSwitch(name)}>{name}</button>
              ))}
            </div>
          )}
          {onLayoutText && <CompanionCard onLayoutText={onLayoutText} sampleObjects={[]} />}
        </section>
        {repx && <ReportSource repx={repx} database={null} onQuery={onQuery} onApplyRepx={onApplyRepx} onAdopt={onAdopt} />}
      </div>
    );
  }

  const tables = database.objects.filter((o) => o.kind === 'table' && matches(search, o));
  const views = database.objects.filter((o) => o.kind === 'view' && matches(search, o));
  const procedures = database.procedures.filter((p) => matches(search, p));
  const fkOf = (o: SqlObject) => {
    const map = new Map<string, string>();
    for (const f of database.foreignKeys) if (f.table === fullName(o)) for (const c of f.columns) map.set(c.column, `${f.references}.${c.referencedColumn}`);
    return map;
  };
  const tablesInQuery = query?.kind === 'table' ? [query.object, ...query.joins.map((j) => j.table)] : [];

  const objectRow = (o: SqlObject) => {
    const key = fullName(o);
    const fk = fkOf(o);
    return (
      <div className="dbx-item" key={key}>
        <button type="button" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
          <span>{key}</span>
          <span className="dbx-sub">{o.columns.length} columns</span>
        </button>
        {open === key && (
          <div className="dbx-cols">
            {o.columns.map((c) => (
              <div className="dbx-col" key={c.name}>
                <span>{c.name}</span>
                <code>{typeLabel(c) || '?'}</code>
                {o.primaryKey.includes(c.name) && <span className="dbx-badge">key</span>}
                {fk.has(c.name) && <span className="dbx-badge" title={`refers to ${fk.get(c.name)}`}>{`→ ${fk.get(c.name)}`}</span>}
                {c.nullable === false && <span className="dbx-sub">required</span>}
              </div>
            ))}
            <div className="dbx-row" style={{ marginTop: 6 }}>
              <button type="button" className="dbx-btn dbx-btn--solid" onClick={() => onQuery({ kind: 'table', object: key, columns: [], joins: [] })}>Use {o.kind === 'view' ? 'this view' : 'this table'}</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const procRow = (p: SqlProcedure) => {
    const key = fullName(p);
    return (
      <div className="dbx-item" key={key}>
        <button type="button" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
          <span>{key}</span>
          <span className="dbx-sub">{p.resultError ? 'result unknown' : `${p.result.length} columns`}</span>
        </button>
        {open === key && (
          <div className="dbx-cols">
            {p.parameters.length > 0 && <div className="dbx-sub">Takes: {p.parameters.map((x) => `${x.name} ${typeLabel(x)}${x.defaultValue !== undefined ? ` = ${x.defaultValue}` : ''}${x.output ? ' OUTPUT' : ''}`).join(', ')}</div>}
            {p.result.map((c) => (
              <div className="dbx-col" key={c.name}><span>{c.name}</span><code>{typeLabel(c)}</code></div>
            ))}
            {p.resultError && (
              <p className="dbx-warn" style={{ margin: '4px 0' }}>
                {p.resultError.message || 'Its result cannot be read without running it.'} {resultFix(p.resultError.type)}
              </p>
            )}
            <div className="dbx-row" style={{ marginTop: 6 }}>
              <button type="button" className="dbx-btn dbx-btn--solid" onClick={() => onQuery({ kind: 'procedure', procedure: key })}>Use this procedure</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const setTableQuery = (patch: Partial<Extract<ReportQuery, { kind: 'table' }>>) => {
    if (query?.kind === 'table') onQuery({ ...query, ...patch });
  };
  // A table pointing back (an order's lines) is a detail band, not a join, which would repeat the order once per line.
  const toggleJoin = (join: QueryJoin, detail: boolean) => {
    if (query?.kind !== 'table') return;
    if (detail) {
      const list = query.details ?? [];
      const has = list.some((j) => j.table === join.table);
      setTableQuery({ details: has ? list.filter((j) => j.table !== join.table) : [...list, join] });
      return;
    }
    const has = query.joins.some((j) => j.table === join.table);
    setTableQuery({ joins: has ? query.joins.filter((j) => j.table !== join.table) : [...query.joins, join] });
  };
  const sortable = query?.kind === 'table' ? fields : [];

  return (
    <div className="dbx">
      <style>{CSS}</style>
      <section className="dbx-card" aria-label="Your SQL Server database">
        <div className="dbx-head">
          <h3>{database.database || 'Database'}</h3>
          <span className="dbx-sub">{summarizeSchema(database).replace(/^[^:]*:\s*/, '')}</span>
          <span style={{ flex: 1 }} />
          {recent.length > 1 && (
            <select className="dbx-input" style={{ width: 'auto' }} aria-label="Database" value={database.database} onChange={(e) => onSwitch(e.target.value)}>
              {recent.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          )}
          <button type="button" className="dbx-btn" onClick={() => onForget(database.database)}>Forget</button>
        </div>
        <p className="dbx-sub" style={{ margin: '6px 0 10px' }}>Read from {database.source === 'repx' ? 'the report' : database.source === 'script' ? 'an SSMS script' : 'Forma’s layout script'}; kept in this browser, never connected to.</p>
        {onShare && (
          /* The owner's rule (2026-11-08): names and sample values go to the AI only when the user says so. */
          <label className="dbx-row" style={{ margin: '0 0 10px', fontSize: 13 }}>
            <input type="checkbox" checked={shared} onChange={(e) => onShare(e.target.checked)} />
            <span>
              Send names and sample values to the AI
              <span className="dbx-sub" style={{ display: 'block' }}>
                {shared
                  ? 'On: a report generated or changed in the chat binds to these columns, and Forma writes the data source. Never a login: Forma has none.'
                  : 'Off: the AI sees none of this database, and binding stays on this tab.'}
              </span>
            </span>
          </label>
        )}
        <input className="dbx-input" type="search" placeholder="Find a table, view, procedure or column" aria-label="Find in the database" value={search} onChange={(e) => setSearch(e.target.value)} />
        {[['Tables', tables.map(objectRow)], ['Views', views.map(objectRow)], ['Stored procedures', procedures.map(procRow)]].map(([label, rows]) => (
          <div className="dbx-group" key={label as string}>
            <h4>{label as string} ({(rows as ReactNode[]).length})</h4>
            {rows as ReactNode[]}
          </div>
        ))}
        <div className="dbx-row" style={{ marginTop: 10 }}>
          <button type="button" className="dbx-btn" aria-expanded={customOpen} onClick={() => setCustomOpen(!customOpen)}>Write custom SQL</button>
          <button type="button" className="dbx-btn" onClick={() => copy('The layout script', SCHEMA_SCRIPT)}>Copy the layout script again</button>
          {copied && <span className="dbx-sub" role="status">{copied}</span>}
        </div>
        {onLayoutText && (
          <CompanionCard
            onLayoutText={onLayoutText}
            sampleObjects={query?.kind === 'table' ? [query.object, ...query.joins.map((j) => j.table), ...(query.details ?? []).map((d) => d.table)] : []}
          />
        )}
        {customOpen && (
          <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
            <p className="dbx-sub" style={{ margin: 0 }}>A SELECT only. The report runs it with whatever rights its connection has, so give the report a read-only login, as DevExpress and Telerik advise.</p>
            {onAskSql && (
              /* Text-to-SQL (item 26): the AI writes it over the layout; the checks below hold it to the layout. */
              <div className="dbx-row">
                <input className="dbx-input" style={{ flex: 1, minWidth: 220 }} aria-label="Describe the query" placeholder="Or describe it: orders from last month with the customer's city" value={sentence} onChange={(e) => setSentence(e.target.value)} />
                <button
                  type="button"
                  className="dbx-btn"
                  disabled={!shared || !sentence.trim() || asking}
                  title={shared ? undefined : 'Tick “Send names and sample values to the AI” first: the sentence goes to the AI with the layout.'}
                  onClick={async () => {
                    setAsking(true);
                    setAsked('');
                    try {
                      const out = await onAskSql(sentence);
                      setCustomSql(out.sql);
                      setCustomName(out.name);
                      setAsked(out.explanation || 'Written. Check it below before using it.');
                    } catch (err) {
                      setAsked(err instanceof Error ? err.message : 'The SQL could not be written.');
                    } finally {
                      setAsking(false);
                    }
                  }}
                >
                  {asking ? 'Writing…' : 'Write the SQL'}
                </button>
              </div>
            )}
            {onAskSql && !shared && <p className="dbx-sub" style={{ margin: 0 }}>Writing it from a sentence sends the sentence and this layout to the AI, so it needs “Send names and sample values to the AI”.</p>}
            {asked && <p className="dbx-sub" role="status" style={{ margin: 0 }}>{asked}</p>}
            <input className="dbx-input" aria-label="Query name" value={customName} onChange={(e) => setCustomName(e.target.value.replace(/[^\w]/g, ''))} />
            <textarea className="dbx-input" aria-label="Custom SQL" value={customSql} onChange={(e) => setCustomSql(e.target.value)} placeholder="SELECT o.OrderID, c.CompanyName FROM dbo.Orders o JOIN dbo.Customers c ON c.CustomerID = o.CustomerID WHERE c.Region = @Region" spellCheck={false} />
            {customSql && [...custom.problems, ...unknownNames].map((p) => <p key={p} className="dbx-warn" style={{ margin: 0 }}>{p}</p>)}
            {customSql && custom.ok && custom.parameters.length > 0 && <p className="dbx-sub" style={{ margin: 0 }}>Parameters: {custom.parameters.join(', ')}, each a report parameter.</p>}
            <div><button type="button" className="dbx-btn dbx-btn--solid" disabled={!custom.ok || unknownNames.length > 0} onClick={() => onQuery({ kind: 'custom', name: customName || 'Query', sql: customSql.trim() })}>Use this SQL</button></div>
          </div>
        )}
      </section>

      {repx && <ReportSource repx={repx} database={database} onQuery={onQuery} onApplyRepx={onApplyRepx} onAdopt={onAdopt} />}

      {query && (
        <section className="dbx-card" aria-label="What the report reads">
          <div className="dbx-head">
            <h3>The report reads</h3>
            <span className="dbx-sub">{describeQuery(query)}</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="dbx-btn" onClick={() => onQuery(null)}>Clear</button>
          </div>
          {query.kind === 'table' && (
            <>
              {suggestJoins(database, query.object).length > 0 && (
                <div className="dbx-group">
                  <h4>Join, from its foreign keys</h4>
                  {suggestJoins(database, query.object).map((s) => (
                    <label key={s.join.table} className="dbx-row dbx-sub" style={{ gap: 6 }}>
                      <input type="checkbox" checked={s.direction === 'referencedBy' ? !!query.details?.some((j) => j.table === s.join.table) : query.joins.some((j) => j.table === s.join.table)} onChange={() => toggleJoin(s.join, s.direction === 'referencedBy')} />
                      {s.label}
                      {s.direction === 'referencedBy' && <span className="dbx-badge" title="Many rows for each of yours: printed as a detail band under each row, not joined">detail band</span>}
                    </label>
                  ))}
                </div>
              )}
              <div className="dbx-group" style={{ display: 'grid', gap: 6 }}>
                <h4>Options</h4>
                <input className="dbx-input" aria-label="Filter" placeholder="Filter, as [Customers.Region] = ?Region (a ?name becomes a report parameter)" value={query.filter ?? ''} onChange={(e) => setTableQuery({ filter: e.target.value || undefined })} />
                <div className="dbx-row">
                  <select className="dbx-input" style={{ width: 'auto' }} aria-label="Sort by" value={query.sort?.[0]?.column ?? ''} onChange={(e) => setTableQuery({ sort: e.target.value ? [{ column: e.target.value, descending: query.sort?.[0]?.descending }] : undefined })}>
                    <option value="">No sort</option>
                    {sortable.map((f) => <option key={`${f.source}.${f.name}`} value={`${f.source}.${f.name}`}>{`Sort by ${f.name}`}</option>)}
                  </select>
                  <label className="dbx-sub"><input type="checkbox" checked={!!query.sort?.[0]?.descending} disabled={!query.sort?.length} onChange={(e) => setTableQuery({ sort: query.sort?.length ? [{ ...query.sort[0], descending: e.target.checked }] : undefined })} /> descending</label>
                  <input className="dbx-input" style={{ width: 110 }} type="number" min={0} aria-label="Top" placeholder="Top (all)" value={query.top ?? ''} onChange={(e) => setTableQuery({ top: Number(e.target.value) > 0 ? Math.floor(Number(e.target.value)) : undefined })} />
                  <label className="dbx-sub"><input type="checkbox" checked={!!query.distinct} onChange={(e) => setTableQuery({ distinct: e.target.checked || undefined })} /> distinct rows</label>
                </div>
                <p className="dbx-sub" style={{ margin: 0 }}>Filter at the source, so fewer rows travel; group and total in the report.</p>
              </div>
            </>
          )}
          {params.length > 0 && <p className="dbx-sub">Report parameters: {params.map((p) => `${p.name}${p.type ? ` (${p.type})` : ''}${p.defaultValue !== undefined ? ` = ${p.defaultValue}` : ''}`).join(', ')}</p>}
          <div className="dbx-group">
            <h4>Fields ({fields.length})</h4>
            {fields.length === 0 && <p className="dbx-warn">This query has no columns Forma can read yet{query.kind === 'procedure' ? ': see why under the procedure above.' : '.'}</p>}
            {duplicates.length > 0 && <p className="dbx-warn">{duplicates.join(', ')} {duplicates.length === 1 ? 'comes' : 'come'} from more than one table: pick the columns, or a join may print the wrong one.</p>}
            <div className="dbx-fields">
              {fields.map((f) => (
                <div className="dbx-field" key={`${f.source}.${f.name}`}>
                  <span title={f.source}>{f.name} <code>{typeLabel(f.column)}</code></span>
                  <button type="button" className="dbx-btn" disabled={!selectionLabel} title={selectionLabel ? `Bind ${selectionLabel} to [${f.name}]` : 'Select a control on the Preview first'} onClick={() => onBindField(f.name)}>Bind</button>
                </div>
              ))}
            </div>
            <p className="dbx-sub">{selectionLabel ? `Bind sets what ${selectionLabel}, last selected on the Preview, prints.` : 'Select a control on the Preview, then Bind a field to it. Or map a table’s columns below.'}</p>
          </div>
          {onWrite && (
            <div className="dbx-group" style={{ display: 'grid', gap: 8 }} aria-label="Into the report">
              <h4>Into the report</h4>
              <label className="dbx-sub" style={{ display: 'grid', gap: 4 }}>
                Connection name, as your application’s &lt;connectionStrings&gt; knows it (never a password)
                <input className="dbx-input" aria-label="Connection name" value={connection || database.database} onChange={(e) => setConnection(e.target.value.replace(/[;=]/g, ''))} />
              </label>
              {params.map((p) => {
                const lk = lookups[p.name] ?? { source: '', dependsOn: '' };
                const lookupObject = lk.source ? findObject(database, lk.source.split('.').slice(0, -1).join('.')) : undefined;
                const others = params.filter((o) => o.name !== p.name && lookupObject?.columns.some((c) => c.name === o.name));
                return (
                  <div key={p.name} className="dbx-row" style={{ gap: 10 }}>
                    <span className="dbx-sub" style={{ minWidth: 90 }}>{p.name}</span>
                    <label className="dbx-sub"><input type="checkbox" checked={multi.includes(p.name)} onChange={(e) => setMulti(e.target.checked ? [...multi, p.name] : multi.filter((m) => m !== p.name))} /> several values</label>
                    <select className="dbx-input" style={{ width: 'auto' }} aria-label={`Values of ${p.name} from`} value={lk.source} onChange={(e) => setLookups({ ...lookups, [p.name]: { source: e.target.value, dependsOn: '' } })}>
                      <option value="">Typed in</option>
                      {database.objects.flatMap((o) => o.columns.map((c) => `${o.schema}.${o.name}.${c.name}`)).map((v) => <option key={v} value={v}>{`Values from ${v}`}</option>)}
                    </select>
                    {others.length > 0 && (
                      <select className="dbx-input" style={{ width: 'auto' }} aria-label={`${p.name} depends on`} value={lk.dependsOn} onChange={(e) => setLookups({ ...lookups, [p.name]: { ...lk, dependsOn: e.target.value } })}>
                        <option value="">For every value</option>
                        {others.map((o) => <option key={o.name} value={o.name}>{`Only those for the ${o.name} chosen`}</option>)}
                      </select>
                    )}
                  </div>
                );
              })}
              <div style={{ display: 'grid', gap: 6 }}>
                {calcs.map((c, i) => (
                  <div className="dbx-row" key={i}>
                    <input className="dbx-input" style={{ width: 140 }} aria-label="Calculated field name" placeholder="Name" value={c.name} onChange={(e) => setCalcs(calcs.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^\w]/g, '') } : x)))} />
                    <input className="dbx-input" style={{ flex: 1, minWidth: 180 }} aria-label="Calculated field expression" placeholder="[Qty] * [UnitPrice]" value={c.expression} onChange={(e) => setCalcs(calcs.map((x, j) => (j === i ? { ...x, expression: e.target.value } : x)))} />
                    <select className="dbx-input" style={{ width: 'auto' }} aria-label="Calculated field type" value={c.type} onChange={(e) => setCalcs(calcs.map((x, j) => (j === i ? { ...x, type: e.target.value as CalcType } : x)))}>
                      {CALC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <button type="button" className="dbx-btn" onClick={() => setCalcs(calcs.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                ))}
                <div><button type="button" className="dbx-btn" onClick={() => setCalcs([...calcs, { name: '', expression: '', type: 'Decimal' }])}>Add a calculated field</button></div>
              </div>
              <div className="dbx-row">
                <button
                  type="button"
                  className="dbx-btn dbx-btn--solid"
                  disabled={writing || !fields.length}
                  onClick={async () => {
                    setWriting(true);
                    try {
                      const chosen = Object.entries(lookups).filter(([, l]) => l.source);
                      setWritten(
                        await onWrite({
                          connectionName: (connection || database.database).trim(),
                          multiValue: multi,
                          lookups: chosen.map(([parameter, l]) => {
                            const parts = l.source.split('.');
                            const column = parts.pop()!;
                            return { parameter, object: parts.join('.'), valueColumn: column, ...(l.dependsOn ? { filter: `[${l.dependsOn}] ${multi.includes(l.dependsOn) ? 'In (?' + l.dependsOn + ')' : '= ?' + l.dependsOn}` } : {}) };
                          }),
                          calculatedFields: calcs.filter((c) => c.name && c.expression),
                        }),
                      );
                    } finally {
                      setWriting(false);
                    }
                  }}
                >
                  Write into the report
                </button>
                {written && <span className="dbx-sub" role="status">{written}</span>}
              </div>
              <p className="dbx-sub" style={{ margin: 0 }}>The report then names the connection, never a login, and opens in the designer with its fields listed, no connection needed.</p>
            </div>
          )}
          {tablesInQuery.length > 0 && (
            <div className="dbx-row">
              <button type="button" className="dbx-btn" onClick={() => copy('The sample script', sampleScript(tablesInQuery.map((t) => findObject(database, t)).filter((o): o is SqlObject => !!o).map((o) => ({ schema: o.schema, name: o.name }))))}>Copy a sample script for these tables</button>
              <span className="dbx-sub">A few rows help the AI match columns to fields.</span>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
