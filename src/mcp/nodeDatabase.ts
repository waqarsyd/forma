/**
 * A database's layout on Forma's Node side (2026-11-24, the CLI and Forma
 * Designer work's wave 5; findings D1-2, D1-7, D1-9, D1-10, D1-11 and GAP1-5
 * of its design audit, `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`,
 * and the owner's decisions OC6 and OC7). The browser shares a database on
 * its Data tab; a caller in Node hands the layout in with the call, and this
 * is what its work threads do with it: genJobs.ts when the AI makes or
 * changes a report, pipeline.ts when a report is bound or converted with no
 * AI. Every function here runs in a work thread, on data that crossed to it
 * by structured clone (`DatabaseJob`: the files' bytes, never a parsed layout
 * or a function), so a layout built to be slow or large costs its own
 * thread, within that thread's bounds, never the one that answers.
 *
 * - **One reader** (`readDatabase`): lib/layoutFile.ts `layoutFromFile`,
 *   the reader the fidelity benchmark and the browser's intake share (BOM,
 *   an export cut short refused, a report's own source), with the sample
 *   rows a caller passed beside it. Sample rows reach the AI only when the
 *   person passed them (OC6: the command line's `--samples` is that act);
 *   a layout file that holds rows too sends its names alone.
 * - **The query a caller pins** (`--procedure`, `--query`, `--object`):
 *   read by databaseAi.ts `queryFromJson` against the layout, every part of
 *   it held there or the whole refused, and a stored procedure whose result
 *   the layout does not describe refused before any AI is asked, with what
 *   would let SQL Server describe it (sqlSchema.ts `resultFix`, D1-7): until
 *   then the AI was told "Its fields, exactly as named: ." and the binding
 *   refused only after its answer had spent the quota.
 * - **The binding, as data** (`bindingOf`, D1-9): read back from the report
 *   as written, after every repair and translation, so it is what the file
 *   holds, never what was meant: bound, with the query (databaseAi.ts's
 *   JSON form), the connection by name, the report parameters its query reads
 *   and what of the AI's query was left out; or not bound, and why. A CI step
 *   can gate on it (the command line's `--require-binding`); the names in it
 *   are the layout's and the report's, so the MCP server returns them only
 *   under `fromFile` (D1-10) and the command line prints them through its
 *   control-character strip.
 * - **Binding with no AI** (`bindReport`, D1-11): the query pinned written
 *   as the report's SQL data source by the same writer a generation uses
 *   (databaseAi.ts `databaseStep`, its `writeFromAnswer`), DevExpress 20.1's
 *   measured shape, the connection by name only.
 * - **A converted SSRS report bound** (`bindConverted`, GAP1-5): the query a
 *   batch pinned, else the RDL's own DataSet read (lib/importForeign.ts drops
 *   it): its stored procedure or table when the layout holds it, never
 *   another object when it does not (the wave-5 review, BT-9); its SQL when
 *   the layout holds every name it reads (written as a custom query), else
 *   only an object holding every field it prints; and a report whose source
 *   names nothing, the object holding most of them. A Field whose query
 *   column has another name is renamed in the report to that column, so the
 *   report prints what the query returns. The RDL's connection string is
 *   never read.
 * - **A report a batch repairs bound** (`bindRepaired`, since the CLI and
 *   Forma Designer work's wave-8 review, W8R-1): the query pinned, else the
 *   SQL data source it already reads, held to the layout and never
 *   rewritten, else the object holding most of the fields it prints.
 *
 * The words where the person chooses what a report reads are the caller's
 * (`WHERE`, databaseAi.ts `DatabaseWhere`): the command line's options, and
 * since the CLI and Forma Designer work's wave 7 (2026-11-25) the MCP
 * server's arguments (`procedure`, `object`, `query`), with sample rows only
 * as the person allows them in the server's entry (OC6).
 *
 * **Names from the files stay apart for the server** (that wave, D1-10): a
 * refusal in the server's voice names no table, view, procedure or database
 * the layout or the query holds (`pinnedQuery`, `readDatabase`), and carries
 * them as the refusal's `fromFile` (caller.ts `ToolRefusal`), which
 * toolShape.ts returns as data; the command line's words name them, as a
 * person reads a refusal whole.
 *
 * Pure ASCII.
 */
import type { DatabaseWhere, QueryJson, WrittenSource } from '../lib/databaseAi';
import type { XmlEl } from '../lib/importForeign';
import type { ReportQuery } from '../lib/sqlQuery';
import type { SqlSchema } from '../lib/sqlSchema';
import { ToolRefusal, type Voice } from './caller';

/** A file given as a layout or as sample rows: its name (its extension tells a report's own source) and its bytes. */
export interface LayoutBytes {
  name: string;
  bytes: Uint8Array;
}

/** A database's layout as a job carries it to a work thread: plain data. */
export interface DatabaseJob {
  layout: LayoutBytes;
  /** Sample rows of the same database, passed by the person (OC6); their values go to the AI. */
  samples: LayoutBytes[];
  /** The query the caller pinned, as JSON (databaseAi.ts `QueryJson`), read against the layout in the thread; null when the AI chooses. */
  query: QueryJson | null;
  /** The connection a report is written with when it names none (databaseAi.ts `connectionFor`, D1-5). */
  connectionName?: string;
}

/**
 * The largest layout or sample file read, lib/layoutFile.ts's
 * `MAX_LAYOUT_BYTES` (nodeDatabase.test.ts holds the two equal), named here
 * so the thread that judges paths need not load the reader to know it.
 */
export const MAX_LAYOUT_FILE_BYTES = 64 * 1024 * 1024;

/** The kinds of file a layout is read from: the layout script's answer, an SSMS script, a report's own source. */
export const LAYOUT_FILE_EXTENSIONS = ['.txt', '.json', '.xml', '.sql', '.rpt', '.repx', '.vsrepx'] as const;
/** The kinds of file sample rows are read from: the sample script's answer. */
export const SAMPLE_FILE_EXTENSIONS = ['.txt', '.json', '.xml', '.rpt'] as const;

/**
 * Where the person chooses what a report reads, in each caller's words (databaseAi.ts `DatabaseWhere`). The server's
 * words for sample rows name no route a host's model could take itself (2026-11-25, the wave-5 review, W5-PB-9): they
 * named the command line's --samples, which a host with a shell can run, and there the flag is the person's consent.
 * OC6 makes samples over MCP the person's switch in the server's entry, FORMA_DATABASE_SAMPLES, which the server reads
 * since the CLI and Forma Designer work's wave 7: the words name it as the person's to set, beside the tool's own
 * argument, which the server refuses while the switch is off.
 */
export const WHERE: Record<Voice, DatabaseWhere> = {
  mcp: {
    chose: 'as the user chose',
    choose: 'by naming it with procedure, object or query',
    samples: "when they are passed as samples beside a layout passed as database, and the person has turned sample rows on in this server's entry (FORMA_DATABASE_SAMPLES=1)",
  },
  cli: {
    chose: 'as the user chose',
    choose: 'with --procedure, --query or --object',
    // Since the CLI work's wave 6, rows Forma Designer reads through --connection are named with --sample-objects, the same act.
    samples: 'when they are given with --samples, or named with --sample-objects',
  },
};

/** What binding a report did, read back from the report as written (the header). */
export type Binding =
  | {
      bound: true;
      /** The database, as the layout names it. */
      database: string;
      /** What the report reads, as databaseAi.ts `queryToJson` writes it. */
      query: QueryJson;
      /** The connection the report names, its name only. */
      connection: string;
      /**
       * Whether Forma Designer can fill that connection (databaseAi.ts `designerCanFill`, D1-5): a name it would refuse
       * is never filled, for Live rows or in the designer, and `notes` says so (the wave-5 review, BT-7, W5-PB-12).
       */
      designerFills: boolean;
      /** The report parameters its SQL data source reads (repxSqlDataSource.ts `sourceParameters`). */
      parameters: string[];
      /** What of the AI's query was left out, each as the note says it. */
      leftOut: string[];
      /**
       * What else the binding says, each a sentence: a connection Forma Designer cannot fill, the report's own connection
       * kept, a converted report's fields renamed, a detail report moved or removed. Names from the files, so a caller
       * keeps them with the binding, never in its plain notices (D1-10; the wave-5 review, W5-PB-11).
       */
      notes: string[];
    }
  | { bound: false; database: string; reason: string; notes: string[] };

/** A layout read in a work thread, with the query the caller pinned. */
export interface DatabaseRead {
  schema: SqlSchema;
  /** What was read, a line each: the database and its objects, then each file of sample rows (names and counts, never a value). */
  said: string[];
  /** What the files held that was not read. */
  notices: string[];
  /** The query pinned, held to the layout; null when the AI chooses. */
  query: ReportQuery | null;
}

/** The phrases of this module that a host's model and a person are told differently (caller.ts `Voice`, CLI-10). */
const full = (o: { schema: string; name: string }) => `${o.schema}.${o.name}`;

/**
 * The phrases of this module that a host's model and a person are told differently (caller.ts `Voice`, CLI-10). Since the
 * CLI work's wave 7 (D1-10) the server's name nothing a layout or a query holds: what a pinned query lacks is carried
 * apart, as the refusal's fromFile (`apart`), and the person's words name it.
 */
const SAY = {
  mcp: {
    asked: 'Nothing was asked of the AI, and nothing written.',
    pin: 'name another with procedure, object or query',
    lacks: (_problems: readonly string[]) => 'it cannot be held to the database layout given (fromFile.query says why)',
    partOf: (_problems: readonly string[]) => 'part of it (fromFile.query says which)',
    procedure: (_p: { schema: string; name: string }) => 'the stored procedure given',
    query: (_name: string) => 'The query given',
    apart: true,
  },
  cli: {
    asked: 'Nothing was asked of the AI, and nothing written.',
    pin: 'give another with --procedure, --query or --object',
    lacks: (problems: readonly string[]) => problems.join('; '),
    partOf: (problems: readonly string[]) => problems.join('; '),
    procedure: (p: { schema: string; name: string }) => `the stored procedure ${full(p)}`,
    query: (name: string) => `The query ${name}`,
    apart: false,
  },
} as const satisfies Record<Voice, Record<string, unknown>>;

/**
 * The query a caller pinned, held to the layout: every part of it there, or
 * the whole refused (a part left out of a query the person named would bind
 * something they did not ask for), and a stored procedure whose result the
 * layout does not describe refused with what would describe it (D1-7).
 * Throws a `ToolRefusal`, before any AI is asked.
 */
export async function pinnedQuery(json: QueryJson, schema: SqlSchema, voice: Voice): Promise<ReportQuery> {
  const [{ queryFromJson }, { findProcedure, queryName }, { resultFix }] = await Promise.all([import('../lib/databaseAi'), import('../lib/sqlQuery'), import('../lib/sqlSchema')]);
  const say = SAY[voice];
  const read = queryFromJson(json, schema);
  // The problems quote the layout's names and its database's: the server's words name none of them (D1-10), and carry them apart.
  const apart = say.apart && read.problems.length ? { query: read.problems } : undefined;
  if (!read.query) throw new ToolRefusal(`The query given cannot be bound: ${read.problems.length ? say.lacks(read.problems) : 'it names nothing to read'}; ${say.pin}. ${say.asked}`, apart);
  if (read.problems.length) throw new ToolRefusal(`Part of the query given is not in the layout, so it was not bound: left out ${say.partOf(read.problems)}; ${say.pin}. ${say.asked}`, apart);
  if (read.query.kind === 'procedure') {
    const p = findProcedure(schema, read.query.procedure);
    if (p && !p.result.length) throw new ToolRefusal(`The layout does not say what ${say.procedure(p)} returns, so a report cannot be bound to it: ${resultFix(p.resultError?.type ?? '')} ${say.asked}`);
  }
  if (read.query.kind === 'custom' && !read.query.sql) throw new ToolRefusal(`${say.query(queryName(read.query))} holds no SQL. ${say.asked}`);
  return read.query;
}

/**
 * A job's database read in its work thread (the header): the layout and the
 * sample rows passed with it, by lib/layoutFile.ts's one reader, the
 * connection name checked, and the query pinned held to the layout. Throws
 * a `ToolRefusal` in the reader's words, which name the file and the fix,
 * before any AI is asked.
 */
export async function readDatabase(job: DatabaseJob, voice: Voice): Promise<DatabaseRead> {
  const [{ layoutFromFile }, { connectionNameProblem }] = await Promise.all([import('../lib/layoutFile'), import('../lib/databaseAi')]);
  // In the server's voice a database's name read from the files is carried apart, never in the words (D1-10).
  const read = layoutFromFile(job.layout.bytes, job.layout.name, job.samples, { namesApart: voice === 'mcp' });
  if (!read.ok) throw new ToolRefusal(`${read.reason} ${SAY[voice].asked}`, read.named ? { databases: read.named } : undefined);
  if (job.connectionName !== undefined) {
    const problem = connectionNameProblem(job.connectionName);
    if (problem) throw new ToolRefusal(`${problem} ${SAY[voice].asked}`);
  }
  const query = job.query ? await pinnedQuery(job.query, read.schema, voice) : null;
  return { schema: read.schema, said: read.said, notices: read.notices, query };
}

/**
 * What a report binds, read back from it as written (D1-9): its first SQL
 * data source and the query it reads, held to the layout. `written`, what
 * the last write of its source did, gives why when nothing was bound and
 * what of the AI's query was left out when it was; `notes`, what else a
 * caller has to say of it. Not bound when a detail report reads a member
 * the source lacks (repxSqlDataSource.ts `unknownBandMembers`, the wave-5
 * review, BT-2): DevExpress then prints nothing of the report, so a CI step
 * gating on `--require-binding` must not pass it. A connection Forma
 * Designer cannot fill is said (BT-7, W5-PB-12), for every caller alike,
 * since it is read from the report written.
 */
export async function bindingOf(xml: string, schema: SqlSchema, written?: WrittenSource | null, notes: readonly string[] = []): Promise<Binding> {
  const [{ readRepxDataSources, sourceParameters, unknownBandMembers }, { queryFromRepx }, { designerCanFill, designerNote, queryFromJson, queryToJson }, { queryName }] = await Promise.all([
    import('../lib/repxSqlDataSource'),
    import('../lib/sqlDrift'),
    import('../lib/databaseAi'),
    import('../lib/sqlQuery'),
  ]);
  const database = schema.database;
  const named = database || 'the database';
  // Each said once, whichever writes said it.
  const said = [...new Set(notes)];
  const source = readRepxDataSources(xml)[0];
  const query = source ? queryFromRepx(xml, schema) : null;
  if (!source || !query) {
    if (written && !written.query) return { bound: false, database, reason: written.note, notes: said };
    return { bound: false, database, reason: source ? 'Its SQL data source reads no query Forma can read.' : 'The report reads no SQL data source.', notes: said };
  }
  const held = queryFromJson(queryToJson(query), schema);
  if (!held.query) return { bound: false, database, reason: `It reads ${queryName(query)}, which ${named} does not have: ${held.problems.join('; ')}.`, notes: said };
  const stale = unknownBandMembers(xml);
  if (stale.length) {
    const what = stale.map((u) => `the detail report ${u.band} reads ${u.member}`).join('; ');
    return { bound: false, database, reason: `${what}, which its data source has no query or relation for, so the report cannot be printed.`, notes: said };
  }
  const designerFills = designerCanFill(source.connectionName);
  if (!designerFills && !said.includes(designerNote(source.connectionName))) said.push(designerNote(source.connectionName));
  return {
    bound: true,
    database,
    query: queryToJson(query),
    connection: source.connectionName,
    designerFills,
    parameters: [...sourceParameters(xml, source)],
    leftOut: written?.query ? [...written.leftOut] : [],
    notes: said,
  };
}

/**
 * What each write of a report's source did, kept for the binding read back
 * after (databaseAi.ts `DatabaseStepOptions`' `onWritten`): the last write
 * and the layout it was held to, whichever step made it (the one handed in,
 * the core's for a layout among the files, or a pinned query's binding with
 * no AI), and what those writes had to say of it (`note`).
 */
export function recordWrites(): {
  onWritten(written: WrittenSource, schema: SqlSchema): void;
  /** Something the binding is to say: the report's own connection kept, a pinned query that could not be written. */
  note(...lines: string[]): void;
  /** The binding of `xml`, held to the layout of the last write, else to `schema`; null with neither. */
  bindingOf(xml: string, schema: SqlSchema | null): Promise<Binding | null>;
} {
  let last: { written: WrittenSource; schema: SqlSchema } | null = null;
  const notes: string[] = [];
  return {
    onWritten: (written, schema) => {
      last = { written, schema };
    },
    note: (...lines) => {
      for (const line of lines) if (line && !notes.includes(line)) notes.push(line);
    },
    bindingOf: async (xml, schema) => {
      const held = last as { written: WrittenSource; schema: SqlSchema } | null;
      if (held) return bindingOf(xml, held.schema, held.written, [...notes, ...(held.written.query ? held.written.details ?? [] : [])]);
      return schema ? bindingOf(xml, schema, null, notes) : null;
    },
  };
}

/** Whether two queries are the same, as their JSON says them. */
export async function sameQuery(a: ReportQuery | null, b: ReportQuery | null): Promise<boolean> {
  if (!a || !b) return a === b;
  const { queryToJson } = await import('../lib/databaseAi');
  return JSON.stringify(queryToJson(a)) === JSON.stringify(queryToJson(b));
}

/**
 * What binding a report with no AI did: the report (unchanged when nothing was bound), the note, and the binding,
 * whose `notes` say the rest (a caller's plain notices never carry a name from the files: the wave-5 review, W5-PB-11).
 */
export interface BoundReport {
  xml: string;
  note: string;
  binding: Binding;
  /** What the write did, for a caller that keeps the binding read back after it (`recordWrites`). */
  written: WrittenSource;
}

/** The phrase said when a connection name was given and the report keeps its own. */
const KEPT_CONNECTION = {
  mcp: (name: string) => `The report already names its connection ${JSON.stringify(name)}, which is kept; connectionName names the connection of a report that names none.`,
  cli: (name: string) => `The report already names its connection "${name}", which is kept; --connection-name names the connection of a report that names none.`,
} as const satisfies Record<Voice, (name: string) => string>;

/**
 * A report bound to `query` with no AI (D1-11): the same writer a
 * generation's data source goes through (databaseAi.ts `databaseStep`), at
 * the report's own version, the connection the report already names kept
 * (said in the binding's notes, when another was given), else the one
 * given, else the database's.
 */
export async function bindReport(
  xml: string,
  schema: SqlSchema,
  query: ReportQuery | null,
  options: { connectionName?: string; version: string; voice: Voice; notes?: readonly string[] },
): Promise<BoundReport> {
  const [{ databaseStep }, { readRepxDataSources }] = await Promise.all([import('../lib/databaseAi'), import('../lib/repxSqlDataSource')]);
  const notes = [...(options.notes ?? [])];
  const own = readRepxDataSources(xml)[0]?.connectionName;
  const given = options.connectionName?.trim();
  if (own && given && own !== given) notes.push(KEPT_CONNECTION[options.voice](own));
  const step = await databaseStep(schema, { query, connectionName: given || undefined, where: WHERE[options.voice] })('');
  const out = step.write(xml, undefined, options.version);
  const written = out.query ? out.xml : xml;
  // The writer's own account of a detail report moved or removed (BT-2) is said with the binding.
  return { xml: written, note: out.note, binding: await bindingOf(written, schema, out, [...notes, ...(out.details ?? [])]), written: out };
}

/* ------------------------------------------------------------ an SSRS report's own DataSet (GAP1-5) */

/** An SSRS DataSet: its name, how its query runs, the query's text, and each field with the query column it reads. */
export interface RdlDataSet {
  name: string;
  commandType: 'StoredProcedure' | 'TableDirect' | 'Text';
  commandText: string;
  fields: { name: string; dataField: string }[];
}

const localName = (el: XmlEl) => el.name.replace(/^.*:/, '');
const childOf = (el: XmlEl | undefined, name: string) => el?.children.find((c) => localName(c) === name);
const textOf = (el: XmlEl | undefined, name: string) => childOf(el, name)?.text.trim() ?? '';

/** The first element named one of `names`, in document order, under `el`. */
function firstNamed(el: XmlEl, names: readonly string[]): XmlEl | undefined {
  for (const c of el.children) {
    if (names.includes(localName(c))) return c;
    const deeper = firstNamed(c, names);
    if (deeper) return deeper;
  }
  return undefined;
}

/**
 * An SSRS report's DataSets, and the one its first table reads (the data
 * region the converter makes the Detail band of): the query's command type
 * (`Text` when it names none, as SSRS reads it), its text, and each field
 * with the query column it reads (`DataField`). Never its data source, whose
 * connection string can hold a login. Empty for a file that is not RDL.
 */
export async function rdlDataSets(rdl: string): Promise<{ sets: RdlDataSet[]; region: string | null }> {
  const { parseXml } = await import('../lib/importForeign');
  const root = parseXml(rdl);
  if (!root || localName(root) !== 'Report') return { sets: [], region: null };
  const sets: RdlDataSet[] = [];
  for (const ds of childOf(root, 'DataSets')?.children ?? []) {
    if (localName(ds) !== 'DataSet') continue;
    const query = childOf(ds, 'Query');
    const type = textOf(query, 'CommandType');
    const fields = (childOf(ds, 'Fields')?.children ?? [])
      .filter((f) => localName(f) === 'Field' && f.attrs.Name)
      .map((f) => ({ name: f.attrs.Name, dataField: textOf(f, 'DataField') || f.attrs.Name }));
    sets.push({ name: ds.attrs.Name ?? '', commandType: type === 'StoredProcedure' || type === 'TableDirect' ? type : 'Text', commandText: textOf(query, 'CommandText'), fields });
  }
  const section = childOf(childOf(root, 'ReportSections'), 'ReportSection');
  const body = childOf(section ?? root, 'Body');
  const region = body ? firstNamed(body, ['Tablix', 'Table']) : undefined;
  return { sets, region: region ? textOf(region, 'DataSetName') || null : null };
}

/**
 * The fields a report prints renamed to the query columns they read: in
 * every expression (`[Amount]` to `[SalesAmount]`) and every group's field.
 * A column whose name holds a bracket is left as it is.
 */
export async function renameFields(xml: string, renames: ReadonlyMap<string, string>): Promise<string> {
  if (!renames.size) return xml;
  const { escapeXmlAttribute } = await import('../lib/xmlEscape');
  const swap = (expression: string) => expression.replace(/\[([^\]]+)\]/g, (whole, field: string) => (renames.has(field) ? `[${escapeXmlAttribute(renames.get(field)!)}]` : whole));
  return xml
    .replace(/(\sExpression=")([^"]*)(")/g, (_m, open: string, expression: string, close: string) => `${open}${swap(expression)}${close}`)
    .replace(/(\sFieldName=")([^"]*)(")/g, (_m, open: string, field: string, close: string) => `${open}${renames.has(field) ? escapeXmlAttribute(renames.get(field)!) : field}${close}`);
}

/** How a converted report's query was chosen: the query the caller pinned, its DataSet's procedure, table or SQL, or the object holding its fields. */
export type ChosenBy = 'pinned' | 'procedure' | 'table' | 'sql' | 'fields';

/** What binding a converted report did, and how its query was chosen (null when nothing was bound). */
export interface BoundConverted extends BoundReport {
  chosenBy: ChosenBy | null;
}

/** What a result says of how a converted report's query was chosen. */
export const CHOSEN_WORDS: Readonly<Record<ChosenBy, string>> = {
  pinned: 'the table, view, procedure or query given for every report',
  procedure: "the stored procedure the SSRS report's own DataSet runs",
  table: "the table the SSRS report's own DataSet reads",
  sql: "the SQL the SSRS report's own DataSet runs, every name it reads found in the layout",
  fields: 'the table, view or procedure holding the fields the report prints',
};

/** How far a converted report may be bound to an object its source does not name: most of its fields, every one, or not at all. */
type Fallback = 'most' | 'every' | 'none';

/**
 * A converted report bound with no AI (GAP1-5, the header). A query the
 * caller pinned binds every report (a batch's `--procedure`, `--object` or
 * `--query`, the wave-5 review's BT-4: it was read, checked and announced,
 * and every converted file bound elsewhere), a field renamed to the column
 * its DataSet reads it from where the query returns that column. Else an
 * SSRS report's DataSet's procedure or table when the layout holds it, its
 * SQL when the layout holds every name it reads, and otherwise:
 *
 * - a DataSet naming a procedure or table the layout lacks, or one the
 *   layout cannot describe, is left unbound, and why (BT-9): the RDL names
 *   its true source, so a layout without it is more likely the wrong layout
 *   than a reason to guess, and a guess read another object with fields
 *   printing blank, counted bound under `--require-binding`;
 * - a DataSet whose SQL cannot be held binds only an object holding every
 *   field the report prints;
 * - a report whose source names nothing (FastReport's is not read, an RDL
 *   with no DataSet) binds the object holding most of its fields.
 *
 * What it did is in the binding's notes, with the files' names, never in a
 * plain notice (W5-PB-11).
 */
export async function bindConverted(
  xml: string,
  source: { file: string; text: string },
  schema: SqlSchema,
  options: { connectionName?: string; voice: Voice; query?: ReportQuery | null },
): Promise<BoundConverted> {
  const [{ guessQuery, queryFromJson }, { findObject, findProcedure, queryFields }, { readBoundFields }] = await Promise.all([
    import('../lib/databaseAi'),
    import('../lib/sqlQuery'),
    import('../lib/repxBindingPlan'),
  ]);
  const notes: string[] = [];
  const named = schema.database || 'the database';
  const { sets, region } = /\.rdlc?$/i.test(source.file) ? await rdlDataSets(source.text) : { sets: [], region: null };
  const set = sets.find((s) => s.name === region) ?? sets[0];
  let query: ReportQuery | null = null;
  let chosenBy: ChosenBy | null = null;
  let fallback: Fallback = 'most';
  /** Why the source the report names cannot be bound, when it cannot. */
  let why = '';
  if (options.query) {
    [query, chosenBy, fallback] = [options.query, 'pinned', 'none'];
  } else if (set?.commandText) {
    const of = `The SSRS report's DataSet ${set.name}`;
    if (set.commandType === 'StoredProcedure') {
      const p = findProcedure(schema, set.commandText);
      if (p) [query, chosenBy] = [{ kind: 'procedure', procedure: full(p) }, 'procedure'];
      else why = `${of} runs the stored procedure ${set.commandText}, which the layout of ${named} does not have: give the layout of the database it runs in.`;
      fallback = 'none';
    } else if (set.commandType === 'TableDirect') {
      const o = findObject(schema, set.commandText);
      if (o) [query, chosenBy] = [{ kind: 'table', object: full(o), columns: [], joins: [] }, 'table'];
      else why = `${of} reads the table ${set.commandText}, which the layout of ${named} does not have: give the layout of the database it reads.`;
      fallback = 'none';
    } else {
      const read = queryFromJson({ sql: set.commandText, name: set.name }, schema);
      if (read.query) [query, chosenBy] = [read.query, 'sql'];
      else notes.push(`${of} runs SQL the layout of ${named} cannot hold (${read.problems.join('; ')}).`);
      fallback = 'every';
    }
  }
  if (why) return { xml, note: why, binding: { bound: false, database: schema.database, reason: why, notes }, written: { xml, query: null, note: why, leftOut: [] }, chosenBy: null };
  // The report prints each field under its SSRS name; with a query bound it reads the column its DataSet reads it from,
  // which a pinned query must return for the field to be renamed.
  const returns = new Set(query ? queryFields(schema, query).map((f) => f.name.toLowerCase()) : []);
  const renames = new Map(
    (query && set ? set.fields : [])
      .filter((f) => f.dataField !== f.name && !/[[\]]/.test(f.dataField) && (chosenBy !== 'pinned' || returns.has(f.dataField.toLowerCase())))
      .map((f) => [f.name, f.dataField] as const),
  );
  const renamed = await renameFields(xml, renames);
  const said = renames.size ? [`Renamed ${renames.size === 1 ? 'a field' : `${renames.size} fields`} to the column${renames.size === 1 ? '' : 's'} the query returns: ${[...renames].map(([from, to]) => `${from} to ${to}`).join(', ')}.`] : [];
  if (query) {
    const bound = await bindReport(renamed, schema, query, { connectionName: options.connectionName, version: '20.1', voice: options.voice, notes: [...notes, ...said] });
    // Bound, or the query the report names could not be written (a procedure the layout does not describe): said, never a guess.
    if (bound.binding.bound || fallback === 'none') return { ...bound, chosenBy: bound.binding.bound ? chosenBy : null };
    notes.push(bound.note);
  }
  // The fields it prints decide: most of them, or, after SQL the layout could not hold, every one.
  const fields = readBoundFields(xml);
  const guess = guessQuery(schema, fields);
  const covers = guess !== null && fields.every((f) => queryFields(schema, guess).some((c) => c.name.toLowerCase() === f.toLowerCase()));
  if (!guess || (fallback === 'every' && !covers)) {
    const reason = guess ? `no table, view or procedure of ${named} holds every field the report prints, so it was not bound to one in place of its own SQL.` : `no table, view or procedure of ${named} has most of the fields the report prints.`;
    return { xml, note: reason, binding: { bound: false, database: schema.database, reason: reason.charAt(0).toUpperCase() + reason.slice(1), notes }, written: { xml, query: null, note: reason, leftOut: [] }, chosenBy: null };
  }
  const bound = await bindReport(xml, schema, guess, { connectionName: options.connectionName, version: '20.1', voice: options.voice, notes });
  return { ...bound, chosenBy: bound.binding.bound ? 'fields' : null };
}

/* ------------------------------------------------------------ a report a batch repairs (W8R-1) */

/** How a repaired report's query was chosen: the query the caller pinned, the SQL data source it already reads, or the object holding its fields. */
export type RepairChosenBy = 'pinned' | 'own' | 'fields';

/** What a result says of how a repaired report's query was chosen. */
export const REPAIR_CHOSEN_WORDS: Readonly<Record<RepairChosenBy, string>> = {
  pinned: CHOSEN_WORDS.pinned,
  own: 'the SQL data source the report already reads, found in the layout',
  fields: CHOSEN_WORDS.fields,
};

/**
 * A report the command line's batch repairs, bound with no AI to the
 * database it was given (the CLI and Forma Designer work's wave-8 review,
 * W8R-1: the repair route took `--database` and `--connection` and bound
 * nothing, with no binding on its row, so `--require-binding` passed every
 * repaired report unbound while the help said each report was bound). At the
 * report's own version, as `bind` writes one:
 *
 * - a query the caller pinned binds it, as it binds every report the batch
 *   converts (BT-4);
 * - else a report that already reads a SQL data source keeps it, held to the
 *   layout and said bound or not, and why: its source names what it was
 *   written for, so a layout without it is more likely the wrong layout than
 *   a reason to bind another object, as an SSRS DataSet is read (BT-9), and
 *   its own query is never rewritten;
 * - else, a report that reads none, the object holding most of the fields it
 *   prints, as a FastReport report converted is bound.
 */
export async function bindRepaired(
  xml: string,
  schema: SqlSchema,
  options: { connectionName?: string; voice: Voice; query?: ReportQuery | null; version: string },
): Promise<BoundReport & { chosenBy: RepairChosenBy | null }> {
  const { connectionName, voice, version } = options;
  if (options.query) {
    const bound = await bindReport(xml, schema, options.query, { connectionName, version, voice });
    return { ...bound, chosenBy: bound.binding.bound ? 'pinned' : null };
  }
  const [{ readRepxDataSources }, { guessQuery }, { readBoundFields }] = await Promise.all([import('../lib/repxSqlDataSource'), import('../lib/databaseAi'), import('../lib/repxBindingPlan')]);
  const own = readRepxDataSources(xml)[0];
  if (own) {
    const given = connectionName?.trim();
    const notes = own.connectionName && given && own.connectionName !== given ? [KEPT_CONNECTION[voice](own.connectionName)] : [];
    const binding = await bindingOf(xml, schema, null, notes);
    const note = binding.bound ? '' : binding.reason;
    return { xml, note, binding, written: { xml, query: null, note, leftOut: [] }, chosenBy: binding.bound ? 'own' : null };
  }
  const guess = guessQuery(schema, readBoundFields(xml));
  if (!guess) {
    const reason = `No table, view or procedure of ${schema.database || 'the database'} has most of the fields the report prints.`;
    return { xml, note: reason, binding: { bound: false, database: schema.database, reason, notes: [] }, written: { xml, query: null, note: reason, leftOut: [] }, chosenBy: null };
  }
  const bound = await bindReport(xml, schema, guess, { connectionName, version, voice });
  return { ...bound, chosenBy: bound.binding.bound ? 'fields' : null };
}
