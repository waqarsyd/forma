/**
 * A database's layout, read from a file (2026-11-24, the CLI and Forma
 * Designer work's wave 5; findings D1-8, D1-3, D1-4, D1-1 and OC6 of its
 * design audit, `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`).
 *
 * **One way to read one.** `layoutFromFile` is what a caller with a file in
 * hand uses (the fidelity benchmark's case, and the command line's and the
 * MCP server's `database`): its bytes decoded by their byte order mark
 * (sqlSchema.ts `decodeText`: UTF-8, UTF-16LE as sqlcmd's `-u` and Windows
 * PowerShell's `>` write it, UTF-16BE), refused in words that name the fix
 * when characters were lost on the way; read by `readDatabaseText`, which
 * reads Forma's layout script's answer, an SSMS "Generate Scripts" file or
 * any CREATE text, and refuses Forma's own export cut short rather than
 * reading it as a script (D1-3); or, for a report (`.repx`, `.vsrepx`), its
 * own data source (repxSqlDataSource.ts `schemaFromRepx`), which is the part
 * of the database that report reads, and said so. Sample rows are a file of
 * their own, put beside the layout only when they are of the same database,
 * and refused otherwise, as the workspace refuses them (App's
 * `takeDatabase`). The browser's intake reads a file it is given the same way
 * (repxIntake.ts, through `readDatabaseBytes`), so a UTF-16 layout attached
 * in the box is read there too.
 *
 * **A layout among a report's files** (`stepFromFiles`, D1-1, a blocker of
 * the design audit). The generation core's `makeReport` took a layout in
 * with the rest of a request's files and dropped it with no word: a person
 * who passed their layout to the MCP server's generate_report as data got a
 * report bound to nothing. Now a layout among the files becomes the
 * request's database step when the caller handed in none, built by
 * databaseAi.ts `databaseStep`, the one builder, and in every other case a
 * notice says what was not read and why. Sample rows among the files go
 * with it only when the caller says the person allowed them (`samples`):
 * the owner's decision OC6 makes that the person's own act, never a file a
 * host's model chose.
 *
 * Nothing here opens a connection, keeps a file, or reads a login: a layout
 * is names and types, and a report's own source is read for its names
 * alone.
 */
import { databaseStep, ON_THE_DATA_TAB, type DatabaseStepOptions, type DatabaseWhere } from './databaseAi';
import type { AskDeps } from './generationCore';
import { schemaFromRepx } from './repxSqlDataSource';
import type { ReportQuery } from './sqlQuery';
import { decodeText, encodingProblem, namesLost, readDatabaseBytes, readDatabaseText, readSampleBytes, summarizeSamples, summarizeSchema, withSamples, type DatabaseText, type SqlSchema } from './sqlSchema';

/**
 * The largest layout file read. The design audit's largest measured layout,
 * 800 tables and 1,500 procedures, was 5.1 MB; this leaves an ERP's catalog
 * room and keeps a file that is no layout from being parsed whole.
 */
export const MAX_LAYOUT_BYTES = 64 * 1024 * 1024;

/** A file given as a database's layout or its sample rows: its bytes and its name. */
export interface LayoutInput {
  bytes: Uint8Array;
  name: string;
}

/** A layout read, or why not. */
export type LayoutRead =
  | {
      ok: true;
      schema: SqlSchema;
      /** What was read, a line each: the database and its objects, then each file of sample rows (names and counts, never a value). */
      said: string[];
      /** What the files held that was not read. */
      notices: string[];
    }
  | {
      ok: false;
      reason: string;
      /**
       * With `namesApart`, the databases' names the reason would have said, read from the files (since the CLI and
       * Forma Designer work's wave 7, D1-10): the MCP server returns them as data, never in its words.
       */
      named?: { samples: string; layout: string };
    };

/** How `layoutFromFile` says what it refuses: `namesApart`, no name read from inside a file in the reason (the MCP server's). */
export interface LayoutFileOptions {
  namesApart?: boolean;
}

/** The file's own name, without the folders a path gives it. */
const fileName = (name: string) => name.replace(/^.*[\\/]/, '');
const isReport = (name: string) => /\.(repx|vsrepx)$/i.test(name);
/** Two databases' names as SQL Server matches them: case aside, a blank one as the reader names it. */
const sameDatabase = (a: string, b: string) => (a.trim() || 'Database').toLowerCase() === (b.trim() || 'Database').toLowerCase();

/** Why a file is too large to read as a layout, or null. */
function tooLarge(input: LayoutInput): string | null {
  return input.bytes.byteLength > MAX_LAYOUT_BYTES ? `"${fileName(input.name)}" is larger than ${MAX_LAYOUT_BYTES / 1024 / 1024} MB, more than a database's layout runs to, so it was not read.` : null;
}

/** What a file that is no layout is told, after its name. */
const NOT_A_LAYOUT = "is not a database layout: give the answer of Forma's layout script, an SSMS \"Generate Scripts\" file, or a report (.repx) with a data source.";

/**
 * sqlcmd's or SQL Server's own error, written into the answer's file (the
 * wave-5 review measured `Msg 208 ... Invalid object name` and `Sqlcmd:
 * Error: ... Login failed`): said as that, its words never repeated, since a
 * sign-in's error names the account.
 */
const SQL_ERROR = /^\s*(?:Msg \d+, Level \d+|Sqlcmd: Error:)/;
const SQL_ERROR_WORDS = "holds an error from sqlcmd or SQL Server rather than the script's answer: open it to read the error, run the script again, and give the answer it writes.";

/**
 * A database's layout from a file, with the sample rows of the same database
 * beside it (the header). Refused, in words naming the file and the fix: a
 * file that is not a layout, Forma's export cut short or damaged, text that
 * lost characters to its encoding, a report with no data source, a sample
 * file that is a layout or is of another database. With `namesApart` the
 * reason names no database read from the files, and gives them as `named`.
 */
export function layoutFromFile(bytes: Uint8Array, name: string, samples: readonly LayoutInput[] = [], options: LayoutFileOptions = {}): LayoutRead {
  const file = fileName(name);
  const large = tooLarge({ bytes, name });
  if (large) return { ok: false, reason: large };
  let schema: SqlSchema;
  const said: string[] = [];
  const notices: string[] = [];
  if (isReport(file)) {
    const text = decodeText(bytes);
    const own = schemaFromRepx(text);
    if (!own) return { ok: false, reason: `"${file}" ${encodingProblem(text) ?? 'has no SQL data source to read a database\'s layout from.'}` };
    // Its names judged, never its labels' text (the wave-5 review, W5-PB-7).
    const lost = namesLost(own);
    if (lost) return { ok: false, reason: `"${file}" ${lost}` };
    schema = own;
    said.push(`Database layout read from "${file}", the part of the database this report reads: ${summarizeSchema(schema)}.`);
  } else {
    const found = readDatabaseBytes(bytes, file);
    if (!found) {
      const text = decodeText(bytes);
      return { ok: false, reason: `"${file}" ${encodingProblem(text) ?? (SQL_ERROR.test(text) ? SQL_ERROR_WORDS : NOT_A_LAYOUT)}` };
    }
    if (found.kind === 'damaged') return { ok: false, reason: `"${file}" ${found.reason}` };
    if (found.kind === 'sample') return { ok: false, reason: `"${file}" holds sample rows, not a layout: give the layout, and these rows beside it as sample rows.` };
    schema = found.schema;
    said.push(`Database layout read from "${file}": ${summarizeSchema(schema)}.`);
    // The same file can hold the sample rows too; given as the layout, they are not sent (OC6).
    if (found.rows) notices.push(`"${file}" holds sample rows too, which were not read with the layout: give the file as sample rows as well to send their values.`);
  }
  for (const input of samples) {
    const own = fileName(input.name);
    const large = tooLarge(input);
    if (large) return { ok: false, reason: large };
    if (isReport(own)) return { ok: false, reason: `"${own}" is a report, not sample rows: sample rows are the answer of Forma's sample script.` };
    // Its sample rows wherever they are in it, so the layout's own file can be given as sample rows as well.
    const found = readSampleBytes(input.bytes);
    if (!found) {
      const text = decodeText(input.bytes);
      const lost = encodingProblem(text);
      if (lost) return { ok: false, reason: `"${own}" ${lost}` };
      if (readDatabaseText(text)?.kind === 'schema') return { ok: false, reason: `"${own}" is a database layout, not sample rows: give it as the layout, and the sample script's answer as sample rows.` };
      if (SQL_ERROR.test(text)) return { ok: false, reason: `"${own}" ${SQL_ERROR_WORDS}` };
      return { ok: false, reason: `"${own}" holds no sample rows: give the answer of Forma's sample script.` };
    }
    if (found.kind === 'damaged') return { ok: false, reason: `"${own}" ${found.reason}` };
    if (!sameDatabase(found.database, schema.database)) {
      if (options.namesApart) {
        return { ok: false, reason: `The sample rows in "${own}" are of another database than the layout's: give sample rows of the same database as the layout.`, named: { samples: found.database, layout: schema.database } };
      }
      return { ok: false, reason: `The sample rows in "${own}" are of the database ${found.database || 'with no name'}, and the layout is of ${schema.database || 'a database with no name'}: give sample rows of the same database as the layout.` };
    }
    schema = withSamples(schema, found.samples);
    said.push(`Sample rows read for ${schema.database || 'the database'} from "${own}": ${summarizeSamples(found.samples)}.`);
  }
  return { ok: true, schema, said, notices };
}

/* ------------------------------------------------------------ among a report's files */

/** A database's layout or sample rows taken in among a request's files (repxIntake.ts `IngestResult['database']`). */
export type FoundDatabase = DatabaseText & { file: string };

/** How the step for a layout among the files is built (D1-1); what `makeReport` is told (`MakeRequest['layoutFiles']`). */
export interface LayoutFiles {
  /** Where the person chooses what a report reads and gives sample rows, in the caller's words; the Data tab's when absent. */
  where?: DatabaseWhere;
  /** The connection a report is written with when it names none (databaseAi.ts `databaseStep`). */
  connectionName?: string;
  /** Whether sample rows among the files go with the layout: only when the person said so (OC6); never when absent. */
  samples?: boolean;
  /** A query chosen before the AI is asked. */
  query?: ReportQuery | null;
  /** Told what writing the report's source did, with the layout it was held to (databaseAi.ts `DatabaseStepOptions`): the Node callers' binding (D1-9). */
  onWritten?: DatabaseStepOptions['onWritten'];
}

/**
 * The database step for the layouts and sample rows taken in among a
 * request's files, and what the request is told of them (the header). The
 * step is built only when the caller handed in none (`handedIn`), from the
 * first layout; every other file is said: one cut short or damaged, a second
 * layout, sample rows the person did not allow, of no layout, or of another
 * database. A notice names the file and never a name from inside it: the
 * MCP server's results carry text from a file only where they say so.
 */
export function stepFromFiles(found: readonly FoundDatabase[], handedIn: boolean, options: LayoutFiles = {}): { database?: NonNullable<AskDeps['database']>; notices: string[] } {
  const notices: string[] = [];
  const where = options.where ?? ON_THE_DATA_TAB;
  for (const f of found) if (f.kind === 'damaged') notices.push(`"${f.file}" ${f.reason}`);
  const layouts = found.filter((f): f is FoundDatabase & { kind: 'schema' } => f.kind === 'schema');
  const samples = found.filter((f): f is FoundDatabase & { kind: 'sample' } => f.kind === 'sample');
  if (handedIn) {
    for (const f of layouts) notices.push(`"${f.file}" is a database layout, and the report is bound to the database given, so it was not read.`);
    for (const f of samples) notices.push(`"${f.file}" holds sample rows, and the report is bound to the database given, so they were not read.`);
    return { notices };
  }
  const [first, ...more] = layouts;
  for (const f of more) notices.push(`"${f.file}" is a second database layout, and a report is bound to one, "${first.file}", so it was not read.`);
  let schema = first?.schema;
  // Sample rows in their own files, and in the layout's own file beside it (W5-PB-7): each by the same rule.
  const rows = [...samples, ...(first?.rows ? [{ ...first.rows, file: first.file, beside: true }] : [])];
  for (const f of rows) {
    const what = 'beside' in f ? 'holds sample rows too' : 'holds sample rows';
    if (!options.samples) notices.push(`"${f.file}" ${what}, which go to the AI only ${where.samples}, so they were not read.`);
    else if (!schema) notices.push(`"${f.file}" ${what} of a database whose layout was not given, so they were not read.`);
    else if (!sameDatabase(f.database, schema.database)) notices.push(`"${f.file}" ${what} of another database than the layout's, so they were not read.`);
    else schema = withSamples(schema, f.samples);
  }
  if (!first || !schema) return { notices };
  notices.push(`"${first.file}" is a database layout, given to the AI with the request so the report can be bound to it.`);
  return { database: databaseStep(schema, { where, connectionName: options.connectionName, query: options.query, onWritten: options.onWritten }), notices };
}

/**
 * `stepFromFiles` as `makeReport` uses it: what it says added to the
 * request's notices, and the request's parts with the step when one was
 * built. Here rather than in the core, whose chunk the workspace warms and
 * check:size budgets to the byte.
 */
export function withLayoutStep<D extends Pick<AskDeps, 'database'>>(found: readonly FoundDatabase[], deps: D, notices: string[], options?: LayoutFiles): D {
  const taken = stepFromFiles(found, Boolean(deps.database), options);
  notices.push(...taken.notices);
  return taken.database ? { ...deps, database: taken.database } : deps;
}
