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
import type { SqlObject, SqlProcedure, SqlSchema } from '../lib/sqlSchema';
import { resultFix, summarizeSchema, typeLabel } from '../lib/sqlSchema';
import { SCHEMA_SCRIPT, sampleScript } from '../lib/sqlSchemaScript';
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
}

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
.dbx-input { width: 100%; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--paper-rule, #d7dee7); background: var(--surface-container-lowest, #fff); color: inherit; font: inherit; font-size: 13px; }
.dbx-group { margin-top: 10px; }
.dbx-group > h4 { margin: 0 0 4px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; opacity: .7; }
.dbx-item { border-top: 1px solid var(--paper-rule, #e6ebf1); }
.dbx-item > button { display: flex; width: 100%; justify-content: space-between; gap: 8px; padding: 6px 2px; border: 0; background: none; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.dbx-item > button:hover { background: var(--track, rgba(0,0,0,.04)); }
.dbx-cols { margin: 2px 0 8px 12px; display: grid; gap: 2px; font-size: 12.5px; }
.dbx-col { display: flex; gap: 8px; }
.dbx-col code { font-size: 12px; opacity: .8; }
.dbx-badge { font-size: 10.5px; padding: 0 5px; border-radius: 4px; background: var(--track, rgba(0,0,0,.06)); }
.dbx-warn { font-size: 12.5px; color: var(--warn, #9a4a00); }
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

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function DatabasePanel({ database, recent, onSwitch, onForget, query, onQuery, selectionLabel, onBindField, onCopy, onFieldsChange }: Props) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('Query');
  const [customSql, setCustomSql] = useState('');

  const copy = async (label: string, text: string) => setCopied((await onCopy(text)) ? `${label} copied.` : `Copy did not work here; use Download instead.`);

  const fields = useMemo(() => (database && query ? queryFields(database, query) : []), [database, query]);
  const duplicates = useMemo(() => duplicateFields(fields), [fields]);
  const params = useMemo(() => (database && query ? queryParameters(database, query) : []), [database, query]);
  const custom = useMemo(() => checkCustomSql(customSql), [customSql]);

  // The mapping below the panel reads these as it reads a pasted sample's fields.
  useEffect(() => {
    onFieldsChange?.(
      fields.map((f) => ({ name: f.name, type: fieldKind(f.column), sample: '' })),
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
        </section>
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
  const toggleJoin = (join: QueryJoin) => {
    if (query?.kind !== 'table') return;
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
        {customOpen && (
          <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
            <p className="dbx-sub" style={{ margin: 0 }}>A SELECT only. The report runs it with whatever rights its connection has, so give the report a read-only login, as DevExpress and Telerik advise.</p>
            <input className="dbx-input" aria-label="Query name" value={customName} onChange={(e) => setCustomName(e.target.value.replace(/[^\w]/g, ''))} />
            <textarea className="dbx-input" aria-label="Custom SQL" value={customSql} onChange={(e) => setCustomSql(e.target.value)} placeholder="SELECT o.OrderID, c.CompanyName FROM dbo.Orders o JOIN dbo.Customers c ON c.CustomerID = o.CustomerID WHERE c.Region = @Region" spellCheck={false} />
            {customSql && custom.problems.map((p) => <p key={p} className="dbx-warn" style={{ margin: 0 }}>{p}</p>)}
            {customSql && custom.ok && custom.parameters.length > 0 && <p className="dbx-sub" style={{ margin: 0 }}>Parameters: {custom.parameters.join(', ')}, each a report parameter.</p>}
            <div><button type="button" className="dbx-btn dbx-btn--solid" disabled={!custom.ok} onClick={() => onQuery({ kind: 'custom', name: customName || 'Query', sql: customSql.trim() })}>Use this SQL</button></div>
          </div>
        )}
      </section>

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
                      <input type="checkbox" checked={query.joins.some((j) => j.table === s.join.table)} onChange={() => toggleJoin(s.join)} />
                      {s.label}
                      {s.direction === 'referencedBy' && <span className="dbx-badge" title="Many rows for each of yours: usually a detail band, not a join">detail</span>}
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
