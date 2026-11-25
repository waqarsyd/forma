/**
 * A database's layout on Forma's MCP server (2026-11-25, the CLI and Forma
 * Designer work's wave 7; findings D1-2, D1-6, D1-10, D1-11, SEC-6, D2-11
 * and MCP-1 of its design audit,
 * `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`, and the
 * owner's decisions OC1, OC6 and OC7). The command line was handed a layout
 * with each call since that work's wave 5 and read one through Forma
 * Designer since its wave 6; this is the server's half, on the same calls:
 *
 * - **The arguments** (`databaseArgs`): `database`, a layout file judged as
 *   every file is; `connection`, a Forma Designer connection read through
 *   its verbs (designerVerbs.ts) in its place; `connectionName`, the name a
 *   report is written with; and on the two AI tools `procedure`, `object` or
 *   `query`, what the report reads pinned before the AI is asked, and the
 *   sample rows (`samples`, files beside a layout file; `sampleObjects` and
 *   `rows`, tables read through a connection). repx_edit takes the first
 *   three for its `data` edit, and repx_convert for binding a converted
 *   SSRS report to what its own DataSet reads; neither asks an AI.
 * - **The person's own switches, in the server's entry** (OC6, SEC-6). In
 *   the MCP the one asking is the host's model, which a file it read can
 *   steer, and many hosts run tools pre-approved, so neither a connection
 *   nor a sample value rests on a tool argument alone. A `connection` is
 *   only a name the person lists in FORMA_DATABASE_CONNECTIONS; sample rows
 *   go to the AI only while FORMA_DATABASE_SAMPLES is 1, and are refused
 *   otherwise in words that name the switch as the person's to set. Both are
 *   read in stdio.ts alone (`readDatabaseSettings`), as every variable of
 *   the server is. A layout file without values is judged like any data
 *   file, under the folders in effect, with no switch: the AI tools already
 *   send the data files a call names (the design audit's SEC-6, skeptic).
 * - **A connection read on the thread that answers, before the job**
 *   (`connectionDatabase`, D2-6): Forma Designer is never started from a
 *   worker thread, since ending a worker leaves the children it started
 *   running; its layout is read once the call's paths are judged and handed
 *   to the job as the bytes a layout file's would be, within
 *   `DESIGNER_MCP_SECONDS` (two minutes, Forma Designer's own default: a
 *   host's cap, about four minutes on Claude Desktop, is the whole call's,
 *   and the AI keeps the rest), with a progress stage of its own and the
 *   beat a host that counts silence needs (generator.ts `progressReporter`).
 *   A host's cancellation kills it, and nothing is written.
 * - **database_connections** (`registerConnections`, D2-11): the listed
 *   names Forma Designer keeps for this Windows user, how each signs in and,
 *   apart under fromFile, its database (`sql-list`, which opens no
 *   connection), and whether the person turned sample rows on. Registered
 *   on every platform, since the tool list never changes after start-up, and
 *   refusing in words off Windows, without a Forma Designer that has the
 *   verbs (1.2.0, which the owner packs), or with no name listed.
 * - **The layout script as a resource** (`LAYOUT_SCRIPT_URI`, D1-6): Forma's
 *   read-only script (lib/sqlSchemaScript.ts `SCHEMA_SCRIPT`, the Data tab's
 *   and the command line's sql-script), so nobody copies it from the web
 *   page. The sample script is not served (decided in that wave): it needs
 *   the tables' names, its rows go to the AI only under the person's switch,
 *   and the person who turns that on has the command line's
 *   `sql-script --sample` and the Data tab, which print it with every name
 *   quoted; a resource template would put SQL composed from names a host's
 *   model chose on the protocol for a route only the person can take.
 *
 * Every name read from a layout, Forma Designer's `sql` and `failed` words
 * and the binding go back only under fromFile (D1-10: nodeDatabase.ts,
 * designerVerbs.ts and reportCalls.ts carry them so); the refusals here
 * repeat no value they judged but the names the person listed.
 *
 * Pure ASCII.
 */
import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { QueryJson } from '../lib/databaseAi';
import { CallStopped, ToolRefusal } from './caller';
import { DESIGNER_MAX_OBJECTS, DesignerRefusal, designerConnections, designerRead, type DesignerObject, type DesignerSetup, type DesignerUnread } from './designerVerbs';
import type { GenEvent } from './genJobs';
import type { LayoutBytes } from './nodeDatabase';
import { describePath, type PathSystem } from './paths';
import type { DatabaseInput } from './reportCalls';
import type { ToolEntry } from './toolList';
import { NO_AI, defineTool, type ToolDeps } from './toolShape';

/** The variables of the server's entry this module's settings come from, beside the AI's (aiSettings.ts): read in stdio.ts alone. */
export const DATABASE_ENV_NAMES = ['FORMA_DATABASE_CONNECTIONS', 'FORMA_DATABASE_SAMPLES', 'FORMA_DESIGNER'] as const;

/** Where the layout script is read. */
export const LAYOUT_SCRIPT_URI = 'forma://sql/layout-script';

/** The seconds each of Forma Designer's verbs is given from the server (the header): its own default, so a host's cap leaves the AI its time. */
export const DESIGNER_MCP_SECONDS = 120;

/** The rows of each table read through a connection when the call names none, and the most (lib/sqlSchema.ts MAX_SAMPLE_ROWS, the most Forma keeps). */
export const SAMPLE_ROWS_DEFAULT = 5;
export const SAMPLE_ROWS_MOST = 10;

/** What the person allowed in the server's entry: the connections it may read, by name, and whether sample rows may go to the AI. */
export interface DatabaseSettings {
  connections: readonly string[];
  samples: boolean;
  /** What was wrong with either variable, a line each for stderr, never repeating a value. */
  problems: string[];
}

/** What the server's database arguments are given: the person's settings, and Forma Designer as the entry found it (designerVerbs.ts). */
export interface DatabaseOptions {
  settings: DatabaseSettings;
  designer: DesignerSetup;
}

/** No connection listed, no sample rows, Forma Designer not looked for: a server made with none (a test's). */
export const NO_DATABASE_OPTIONS: DatabaseOptions = {
  settings: { connections: [], samples: false, problems: [] },
  designer: { place: { ok: false, reason: 'Forma Designer was not looked for by this server.' }, env: {} },
};

/**
 * The person's two switches, from the values the entry read (the header):
 * FORMA_DATABASE_CONNECTIONS, names separated by `;` or `,`, each held to
 * Forma Designer's own rule (lib/databaseAi.ts `DESIGNER_NAME`), and
 * FORMA_DATABASE_SAMPLES, `1` or `true` for on. Anything else is said on
 * stderr and leaves the connection out or the samples off, never repeated:
 * a key pasted under the wrong name must not reach a log in full.
 */
export async function readDatabaseSettings(given: { connections?: string; samples?: string }): Promise<DatabaseSettings> {
  const { DESIGNER_NAME } = await import('../lib/databaseAi');
  const problems: string[] = [];
  const connections: string[] = [];
  let refused = 0;
  for (const raw of (given.connections ?? '').split(/[;,]/)) {
    const name = raw.trim();
    if (!name) continue;
    if (!DESIGNER_NAME.test(name)) refused += 1;
    else if (!connections.some((c) => c.toLowerCase() === name.toLowerCase())) connections.push(name);
  }
  if (refused) {
    problems.push(
      `FORMA_DATABASE_CONNECTIONS lists ${refused === 1 ? 'a name' : `${refused} names`} Forma Designer could not keep (letters, digits, _, . and -, beginning with a letter, a digit or _), left out.`,
    );
  }
  const switched = (given.samples ?? '').trim().toLowerCase();
  const samples = switched === '1' || switched === 'true';
  if (switched && !samples && switched !== '0' && switched !== 'false') problems.push('FORMA_DATABASE_SAMPLES is neither 1 nor 0, so sample rows stay off.');
  return { connections, samples, problems };
}

/** The way on when a connection cannot be read: the layout as a file. */
const LAYOUT_INSTEAD = `Send the database's layout as a file with database instead: the resource ${LAYOUT_SCRIPT_URI} is the script that reads it.`;

/** Said when sample rows are asked for while the person has not turned them on (OC6). */
export const SAMPLES_OFF =
  "Sample rows go to the AI only when the person turns them on for this server: FORMA_DATABASE_SAMPLES=1 in this server's entry in the host's MCP configuration, then the host restarted. Without them the layout's names alone go. Nothing was asked of the AI, and nothing written.";

/** Said when a connection is asked for and the person listed none. */
export const NONE_LISTED =
  "No Forma Designer connection is listed for this server: the person lists the ones it may read in FORMA_DATABASE_CONNECTIONS in this server's entry in the host's MCP configuration (names separated by ;), then restarts the host.";

/** Said when a connection is asked for that the person did not list; the names listed are the person's own, from the entry. */
const notListed = (listed: readonly string[]) =>
  `connection names a Forma Designer connection the person has not listed for this server, so it was not read: the ones listed are ${listed.join(', ')} (FORMA_DATABASE_CONNECTIONS in this server's entry). Nothing was asked of the AI, and nothing written.`;

/** The arguments the database's part of a tool takes, as the handler receives them. */
export interface DatabaseArgs {
  database?: string;
  connection?: string;
  connectionName?: string;
  procedure?: string;
  object?: string;
  query?: Record<string, unknown>;
  samples?: string[];
  sampleObjects?: string[];
  rows?: number;
}

/**
 * The database's arguments of a tool: `bind` (repx_edit, repx_convert) the
 * layout, a connection in its place and the connection's name; `ai` (the
 * two AI tools) those and what the report reads pinned, and the sample rows.
 */
export function databaseArgs(sys: PathSystem, which: 'bind' | 'ai'): Record<string, z.ZodType> {
  const bind = {
    database: z
      .string()
      .optional()
      .describe(
        describePath(
          sys.path,
          `A database's layout, to bind the report to: the answer of Forma's layout script (the resource ${LAYOUT_SCRIPT_URI}) saved as a file, an SSMS Generate Scripts file, or a .repx whose data source is the part of the database it reads. Its names go to the AI only where the tool asks one.`,
        ),
      ),
    connection: z
      .string()
      .optional()
      .describe(
        "In place of database: a Forma Designer connection the person listed for this server (database_connections lists them), whose layout Forma Designer reads on this Windows computer. The report names it as Forma Designer keeps it, unless connectionName names another.",
      ),
    connectionName: z
      .string()
      .optional()
      .describe("The connection a report is written with when it names none: the name the application knows the database by, never a server or a login."),
  };
  if (which === 'bind') return bind;
  return {
    ...bind,
    procedure: z.string().optional().describe('What the report reads, pinned before the AI is asked: a stored procedure, such as dbo.usp_Sales, which the layout says what it returns. At most one of procedure, object and query.'),
    object: z.string().optional().describe('What the report reads, pinned: a table or view, such as dbo.Orders.'),
    query: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('What the report reads, pinned, as JSON: {"table":"dbo.Orders","joins":[{"table":"dbo.Customers"}],"filter":"[Orders.Freight] > ?Min"}, or {"procedure":"dbo.usp_Sales"}, or {"name":"Q","sql":"SELECT ..."}. Every name must be in the layout.'),
    samples: z
      .array(z.string())
      .optional()
      .describe(
        describePath(
          sys.path,
          "Beside database: files of sample rows of the same database (the answer of Forma's sample script), whose values go to the AI with the layout. Only when the person has turned sample rows on for this server; refused otherwise. Each a full path.",
        ),
      ),
    sampleObjects: z
      .array(z.string())
      .optional()
      .describe(`Beside connection: tables or views, each schema.name, at most ${DESIGNER_MAX_OBJECTS}, whose rows Forma Designer reads and sends to the AI with the layout. Only when the person has turned sample rows on for this server; refused otherwise.`),
    rows: z.number().optional().describe(`The rows read of each of sampleObjects, 1 to ${SAMPLE_ROWS_MOST}; ${SAMPLE_ROWS_DEFAULT} when left out.`),
  };
}

/** A call's database, judged from its arguments before anything is read: none, a layout file (and sample files), or a connection to read once the paths are judged. */
export type DatabaseCall =
  | { kind: 'none' }
  | { kind: 'file'; input: DatabaseInput }
  | { kind: 'connection'; name: string; samples: { objects: DesignerObject[]; rows: number } | null; query: QueryJson | null; connectionName?: string };

const given = (value: unknown) => value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0) && value !== '';

/** A table or view as sampleObjects names it: `schema.name`, a part bracketed as SSMS writes it, `dbo` when only a name is given. */
function objectOf(text: string): DesignerObject {
  const names = [...text.trim().matchAll(/\[((?:[^\]]|\]\])+)\]|([^.[\]]+)/g)].map((m) => (m[1] !== undefined ? m[1].replace(/\]\]/g, ']') : m[2].trim())).filter(Boolean);
  if (!names.length || names.length > 2) throw new ToolRefusal('sampleObjects names tables or views as schema.name, such as dbo.Orders; one of them is not one. Nothing was asked of the AI, and nothing written.');
  return names.length === 1 ? { schema: 'dbo', name: names[0] } : { schema: names[0], name: names[1] };
}

/**
 * Judges a call's database arguments (the header), before any path is
 * judged or file read: one of database and connection; what the report
 * reads pinned at most once, and only with one of them; sample rows only
 * while the person's switch is on, as files beside a layout file or tables
 * read through a connection; a connection only one the person listed.
 * Throws a `ToolRefusal`.
 */
export function judgeDatabaseArgs(args: DatabaseArgs, settings: DatabaseSettings): DatabaseCall {
  const pins = (['procedure', 'object', 'query'] as const).filter((k) => given(args[k]));
  const has = (k: keyof DatabaseArgs) => given(args[k]);
  if (pins.length > 1) throw new ToolRefusal('Name what the report reads once: procedure, object or query, never more than one. Nothing was asked of the AI, and nothing written.');
  if (has('database') && has('connection')) throw new ToolRefusal("Send database or connection, not both: each is the database's layout. Nothing was asked of the AI, and nothing written.");
  if (!has('database') && !has('connection')) {
    const without = [...pins, ...(['connectionName', 'samples', 'sampleObjects', 'rows'] as const).filter(has)];
    if (without.length) throw new ToolRefusal(`${without.join(', ')} ${without.length === 1 ? 'needs' : 'need'} the database's layout: send database, or a connection listed for this server. Nothing was asked of the AI, and nothing written.`);
    return { kind: 'none' };
  }
  if (has('samples') && !has('database')) throw new ToolRefusal("samples are files of sample rows beside a layout file (database); with connection, name the tables in sampleObjects. Nothing was asked of the AI, and nothing written.");
  if (has('sampleObjects') && !has('connection')) throw new ToolRefusal("sampleObjects are tables read through a connection; beside a layout file, send the sample script's answer as samples. Nothing was asked of the AI, and nothing written.");
  if (has('rows') && !has('sampleObjects')) throw new ToolRefusal('rows goes with sampleObjects, the tables whose rows Forma Designer reads. Nothing was asked of the AI, and nothing written.');
  if ((has('samples') || has('sampleObjects')) && !settings.samples) throw new ToolRefusal(SAMPLES_OFF);
  const query: QueryJson | null = args.procedure !== undefined && args.procedure !== '' ? { procedure: args.procedure.trim() } : args.object !== undefined && args.object !== '' ? { table: args.object.trim() } : args.query ? (args.query as QueryJson) : null;
  const named = args.connectionName !== undefined ? { connectionName: args.connectionName } : {};
  if (has('database')) return { kind: 'file', input: { layout: args.database as string, samples: args.samples ?? [], query, ...named } };
  const wanted = (args.connection as string).trim();
  if (!settings.connections.length) throw new ToolRefusal(`${NONE_LISTED} Nothing was asked of the AI, and nothing written.`);
  const listed = settings.connections.find((c) => c.toLowerCase() === wanted.toLowerCase());
  if (!listed) throw new ToolRefusal(notListed(settings.connections));
  let samples: { objects: DesignerObject[]; rows: number } | null = null;
  if (has('sampleObjects')) {
    const objects = (args.sampleObjects ?? []).map(objectOf);
    if (objects.length > DESIGNER_MAX_OBJECTS) throw new ToolRefusal(`sampleObjects names ${objects.length} tables or views; Forma Designer reads at most ${DESIGNER_MAX_OBJECTS} at a time. Nothing was asked of the AI, and nothing written.`);
    const rows = args.rows ?? SAMPLE_ROWS_DEFAULT;
    if (!Number.isInteger(rows) || rows < 1 || rows > SAMPLE_ROWS_MOST) throw new ToolRefusal(`rows is a whole number from 1 to ${SAMPLE_ROWS_MOST}, the most of each table Forma keeps. Nothing was asked of the AI, and nothing written.`);
    samples = { objects, rows };
  }
  return { kind: 'connection', name: listed, samples, query, ...named };
}

/**
 * What a connection's layout gave a call: the database as a call takes it (text already read, never a file, so a
 * call's plan takes it as judged), what its notices say, and the tables left out, for fromFile: those SQL Server could
 * not read, and those named that the database does not have (W7-MCP-4).
 */
export interface ConnectionRead {
  input: { layout: LayoutBytes; samples: LayoutBytes[]; query: QueryJson | null; connectionName: string };
  notices: string[];
  unread: DesignerUnread[];
  notFound: string[];
}

/** How a connection is read: the call's signal, where its progress goes, and the server's log. */
export interface ConnectionRun {
  signal: AbortSignal;
  tell(event: GenEvent): void;
  log(line: string): void;
}

/**
 * A connection's layout, and the sample rows of the tables named when the
 * person allowed them, read through Forma Designer on the thread that
 * answers (the header): what a layout file's bytes would be, under the name
 * `<connection> in Forma Designer`, and the report's connection named as
 * Forma Designer keeps it unless the call named another (D2-10). Throws a
 * `ToolRefusal` in Forma Designer's words (its SQL Server words under
 * fromFile.designer: designerVerbs.ts), or `CallStopped`.
 */
export async function connectionDatabase(call: Extract<DatabaseCall, { kind: 'connection' }>, options: DatabaseOptions, run: ConnectionRun): Promise<ConnectionRead> {
  const setup = options.designer;
  if (!setup.place.ok) throw new ToolRefusal(`${setup.place.reason} ${LAYOUT_INSTEAD}`);
  run.tell({ stage: 'designer' });
  let read;
  try {
    read = await designerRead(setup, call.name, { voice: 'mcp', signal: run.signal, seconds: DESIGNER_MCP_SECONDS, log: run.log }, call.samples ?? undefined);
  } catch (error) {
    if (error instanceof CallStopped || run.signal.aborted) throw error instanceof CallStopped ? error : new CallStopped();
    // A Forma Designer that cannot be started or has no verbs: the layout file is the way on; a refusal of its own (a sign-in,
    // a server not reached) is the person's to fix in Forma Designer, and its words stand as they are.
    if (error instanceof DesignerRefusal && error.problem === null) throw new ToolRefusal(`${error.message} ${LAYOUT_INSTEAD}`, error.fromFile);
    throw error;
  }
  const bytes = (text: string) => new TextEncoder().encode(text);
  const as = `${read.connection} in Forma Designer`;
  const some = (count: number) => (count === 1 ? 'one of the tables or views named' : `${count} of the tables or views named`);
  const notices = [
    ...(read.unread.length ? [`SQL Server could not read sample rows of ${some(read.unread.length)}, so their rows were left out (fromFile.unread names them).`] : []),
    // Forma Designer leaves out a table the catalog lacks with no word, so a name the model sent may have sent no rows (W7-MCP-4).
    ...(read.notFound.length === 1 ? ['One of the tables or views named is not in the database, so no rows of it were read (fromFile.notFound names it).'] : []),
    ...(read.notFound.length > 1 ? [`${read.notFound.length} of the tables or views named are not in the database, so no rows of them were read (fromFile.notFound names them).`] : []),
  ];
  return {
    input: {
      layout: { name: as, bytes: bytes(read.layout) },
      samples: read.samples === null ? [] : [{ name: as, bytes: bytes(read.samples) }],
      query: call.query,
      connectionName: call.connectionName ?? read.connection,
    },
    notices,
    unread: read.unread,
    notFound: read.notFound,
  };
}

/** The layout script as a resource, on `server` (the header). */
export function registerLayoutScript(server: McpServer): void {
  server.registerResource(
    'sql-layout-script',
    LAYOUT_SCRIPT_URI,
    {
      title: "Forma's database layout script",
      description:
        "Forma's read-only SQL Server script that reads a database's layout: its tables and views with their columns and keys, and its stored procedures with their parameters and the columns they return, described without running them; no rows of data, no logins. The person runs it in SSMS against their database and saves the one cell it answers as a file, which database then takes (Forma's command line, sql-script --sqlcmd, prints a sqlcmd line that writes it whole; sqlcmd run plainly cuts the cell and loses letters outside the code page). SQL Server 2016 or later.",
      mimeType: 'application/sql',
    },
    async (uri) => {
      const { SCHEMA_SCRIPT } = await import('../lib/sqlSchemaScript');
      return { contents: [{ uri: uri.href, mimeType: 'application/sql', text: SCHEMA_SCRIPT }] };
    },
  );
}

/** database_connections (the header), on `server`. */
export function registerConnections(server: McpServer, deps: ToolDeps, entry: ToolEntry, options: DatabaseOptions): void {
  defineTool(
    server,
    deps,
    {
      name: entry.name,
      title: 'List database connections',
      description: `Lists the Forma Designer connections this server may read: those the person listed in its entry (FORMA_DATABASE_CONNECTIONS) that Forma Designer keeps for this Windows user, each by name with how it signs in (Windows or a saved SQL Server login), the database it opens under fromFile, and whether the person turned sample rows on (FORMA_DATABASE_SAMPLES). The AI tools, repx_edit and repx_convert take one as connection, in place of a layout file. Forma Designer reads one file on this computer and opens no connection for the list; it never prints a server, a login or a password. On Windows, with Forma Designer 1.2.0 or later; elsewhere, without it, or with no name listed, it says so. ${NO_AI}`,
      annotations: { readOnlyHint: entry.readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: entry.openWorld },
      input: {},
      output: {
        connections: z.array(z.looseObject({ name: z.string(), signIn: z.enum(['windows', 'login']) })),
        notKept: z.array(z.string()),
        samplesAllowed: z.boolean(),
      },
    },
    async (_args, tc) => {
      const { settings, designer } = options;
      if (!designer.place.ok) throw new ToolRefusal(`${designer.place.reason} ${LAYOUT_INSTEAD}`);
      if (!settings.connections.length) throw new ToolRefusal(NONE_LISTED);
      let kept;
      try {
        kept = await designerConnections(designer, { voice: 'mcp', signal: tc.signal, log: (line) => deps.log(deps.redact(line)) });
      } catch (error) {
        if (error instanceof DesignerRefusal && error.problem === null) throw new ToolRefusal(`${error.message} ${LAYOUT_INSTEAD}`, error.fromFile);
        throw error;
      }
      // Only the names the person listed: a connection Forma Designer keeps and the entry does not name is never said.
      const found = settings.connections.flatMap((name) => kept.filter((c) => c.name.toLowerCase() === name.toLowerCase()).slice(0, 1));
      const notKept = settings.connections.filter((name) => !found.some((c) => c.name.toLowerCase() === name.toLowerCase()));
      const connections = found.map((c) => ({ name: c.name, signIn: c.signIn }));
      const listed = settings.connections.length;
      const summary = found.length
        ? `Forma Designer keeps ${found.length === listed ? (listed === 1 ? 'the connection' : `all ${listed} connections`) : `${found.length} of the ${listed} connections`} listed for this server: ${found.map((c) => c.name).join(', ')}; fromFile.databases names the database each opens.`
        : `Forma Designer keeps none of the ${listed === 1 ? 'connection' : `${listed} connections`} listed for this server.`;
      return {
        summary: `${summary} Sample rows ${settings.samples ? 'may go to the AI with a layout: the person turned them on.' : 'stay off: the person has not turned them on.'}`,
        data: { connections, notKept, samplesAllowed: settings.samples },
        ...(found.length ? { fromFile: { databases: found.map((c) => ({ connection: c.name, database: c.database })) } } : {}),
      };
    },
  );
}
