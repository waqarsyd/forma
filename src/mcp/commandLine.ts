/**
 * Forma's command line (2026-11-24, the CLI and Forma Designer work's wave
 * 4; findings CLI-1, CLI-7, CLI-10, CLI-11, GAP1-2, GAP1-3, SEC-3, TEST-1 and
 * TEST-3 of its design audit,
 * `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`, and the owner's
 * decision OC5). A person or a CI step runs it from any folder as
 *
 *   node <clone>/src/mcp/cli.mjs <command> [options]
 *
 * cli.mjs registers tsx and loads cliEntry.ts, which installs the stdout
 * guard, takes the AI's environment and deletes the keys from it, wires
 * Ctrl+C to a stop, and calls `main` here with the arguments and what the
 * process gives it (`CliIo`). Nothing here reads the environment, argv or
 * the working folder itself, so the tests call `main` in their own thread
 * with whatever they like, which is where its coverage is measured;
 * scripts/repx.ts, the command line until this wave, forwards to the entry.
 *
 * ## The commands (cliCommands.ts `CLI_COMMANDS`, one table with `needsAi`)
 *
 * audit, outline, repair, pdf and edit run layoutCalls.ts's calls, the ones
 * the MCP server's report tools make, so a fix there reaches both; their
 * work runs in workerPool.ts's bounded worker thread, so a report built to
 * be slow or large ends one command, not the process. They never look at
 * the AI's settings: the job CI runs on a fork's pull request, given no
 * secret, can audit every report (GAP1-2). generate and revise run
 * reportCalls.ts's calls, the server's generate_report's and
 * revise_report's, in generator.ts's bounded thread, a thread of its own
 * for the command (`fresh`); each checks that an AI is set up before it
 * reads any file, and exits 3 with the setup's words in a person's voice
 * when none is. `--mock` replaces the AI's answer only: an AI must still be
 * set up (OD6, aiSettings.ts's header).
 *
 * convert (the same wave's second part; GAP1-1, OC7) makes an SSRS or
 * FastReport report, or every one directly in a folder, into a repaired
 * `.repx` with no AI, by the web app's own conversion (layoutCalls.ts
 * `convertLayout`), in workerPool.ts's bounded thread like every report
 * command, since a file built to be slow or large must cost one command and
 * not the process: it writes `<name>.converted.repx`, says the converter's
 * notices as warnings and the DevExpress version it writes (20.1), and its
 * repairs' console lines reach stderr only through the thread's log, under
 * `--verbose`, so stdout stays results.
 *
 * batch (the same part; CLI-5, SEC-1, GAP1-3, GAP1-4, GAP3-3, CLI-12, OC2,
 * OC5) makes every report source of a folder and its subfolders under
 * `--out`, one file at a time: folderBatch.ts walks the folder once (no link
 * followed), decides every route and name before a file is read, and says
 * why; the AI's gate is asked only when a route needs the AI. Each file
 * that asks the AI runs in a thread of its own (generator.ts `fresh`), with
 * GEN_LIMITS' bounds for that file alone; before it, the parks the threads
 * before kept in Forma's folder are read (modelParks.ts `keyParked`), so a
 * key every model of which is spent for the day stops the batch without a
 * request Google would refuse. A minute's limit is waited out and the file
 * made once more; the day's, a second limit on one file, or the AI refusing
 * the key (told by the AI's own failure, never a file's name: the wave-4
 * review's SEC-W4-3) stop the batch asking the AI, each file that would
 * listed as not started, a row of its own (U4), while those that need no
 * AI are still made, and the same command with `--skip-existing` carries
 * on. A report the words leave as it was (the AI found nothing to change,
 * or answered rather than changed) is written as it reads, and an SSRS or
 * FastReport report as converted, so `--out` holds every report and a rerun
 * asks the AI nothing again (U1). A summary ends it: each status's count,
 * who answered, the time, why it stopped, and the bounds each file had.
 * `--dry-run` prints the plan with nothing read and no AI asked.
 *
 * ## A database (the same work's wave 5)
 *
 * Findings D1-2, D1-3, D1-4, D1-6, D1-7, D1-9, D1-10, D1-11 and GAP1-5, the
 * owner's OC6 and OC7. `--database <layout>` binds what generate, revise
 * and batch make to a database's layout (sql-script's script's answer saved
 * as a file, an SSMS "Generate Scripts" file, or a .repx's own source), as
 * the workspace's shared database does: the AI names what the report reads
 * and Forma writes the SQL data source, the connection by name only
 * (`--connection-name`, else the database's own). `--samples <file>`, once
 * for each file, sends that file's sample values to the AI with the layout:
 * passing it is the person's consent (OC6); without it only names go, a
 * value is never printed or put in a JSON line. One of `--procedure`,
 * `--object` or `--query` pins what the report reads, held to the layout
 * before anything else, a stored procedure whose result the layout does not
 * describe refused with what would describe it (D1-7). The layout is read in
 * the report work's bounded thread and said on stderr (the database, its
 * objects, each sample file's tables and counts) before any AI is asked: for
 * a batch once, before its first file, each file's job then reading it again
 * and building a step of its own, so no file's query carries to the next
 * (D1-9), a deliberate departure from browser Batch, which shares no
 * database. bind (D1-11) and convert --database (GAP1-5) bind with no AI,
 * and so, since the wave-8 review (W8R-1), does a batch's repair route
 * (nodeDatabase.ts `bindRepaired`: the query pinned, else the SQL data
 * source the report already reads, else the object holding most of its
 * fields), which bound nothing until then, its rows passing
 * `--require-binding` unbound;
 * sql-script prints the scripts and the sqlcmd line (D1-4). Each input's
 * result says what the report binds, read back from the file written
 * (`binding` in its JSON line, lines under it otherwise, control characters
 * shown as `?` as every line's are), and `--require-binding` makes a report
 * written but not bound an input that failed (`unbound`, exit 4).
 *
 * ## Forma Designer's connections (the same work's wave 6)
 *
 * Findings D2-1, D2-5, D2-6, D2-10, D2-11 and SEC-5, the owner's OC1 and
 * OC6. On Windows, Forma Designer keeps a person's SQL Server connections,
 * a login's secret encrypted for their Windows account, and from 1.2.0
 * (packed for release 1.7.0, 2026-11-25) answers command-line verbs that
 * designerVerbs.ts starts: `connections` lists the names it keeps, with
 * each one's database and how it signs in; `--connection <name>`, in place
 * of `--database` on generate, revise, batch, convert and bind, has it read
 * that connection's layout, which is then used exactly as a layout file's
 * (`DatabaseInput` takes it as bytes), the report's connection written with
 * the name Forma Designer keeps it under unless `--connection-name` names
 * another (D2-10); `--sample-objects dbo.A,dbo.B [--rows N]`, with it, has
 * it read sample rows of those tables, whose values go to the AI: naming
 * them is the person's consent (OC6), as passing `--samples` is, and no
 * value is printed; a table SQL Server cannot read is left out and said by
 * name and SQL Server's number alone (the wave's review, R6-2), and a
 * connection an older Forma Designer kept under a name beginning with `.`
 * or `-` is listed as one `--connection` cannot name, with how to rename it
 * (N6-6). The layout is read once, on this thread, before any
 * job starts (`connectionFirst`, D2-6), within `DESIGNER_CLI_SECONDS` for
 * each verb and killed by a stop; a Forma Designer that is not there, is
 * older than 1.2.0 or is not on Windows is refused in words with the way
 * on (a layout file), exit 4, before anything else is read, and since the
 * wave-8 review (W8R-5) so is one of its own answers that names none (its
 * deadline: run it again; SQL Server's refusal or words: check the
 * connection in its tray menu; each, or the file: `withWayOn`). The entry
 * finds it (`designerPlace`: the per-user install, or FORMA_DESIGNER for a
 * copy built from source) and builds the environment it is started with
 * from Windows' own variables, after the keys are deleted; nothing here
 * reads the environment.
 *
 * ## Paths and writes
 *
 * Every path goes through paths.ts in the working-folder mode (`PathScope`
 * `{ base }`, the folder the command runs in): a relative path is that
 * folder's, every other form is refused before the disk is touched, and no
 * link the folder holds is followed out of it. A folder given to audit is
 * judged the same way (`resolveFolderPath`), and each report found directly
 * in it then on its own. The batch judges every output, draft and data file
 * in that same mode, and only its own files in its folder's mode (each must
 * really be in the batch's folder), so a link the working folder holds
 * under `--out` or on the way to a data file is refused as the single
 * commands refuse it (the wave-4 review's SEC-W4-1). generate writes over
 * no file it is made from, `--force` or not, and a report whose connection
 * was stored with more than its name is never replaced in place (SEC-W4-2,
 * reportFile.ts `overInputRefusal`); any other report is replaced in place
 * only when `--out` names it and `--force` is given (measured in the CLI
 * work's wave 8: `repair r.repx --out r.repx --force` replaces r.repx). A file system's refusal to
 * write (permission, a read-only or full disk, a file in use) is a failure,
 * exit 4, naming the file, never an internal error (U3). An output is `<name>.repaired.repx`,
 * `<name>.edited.repx`, `<name>.pdf`, `<name>.converted.repx`, `<first
 * file>.generated.repx` or `<name>.revised.repx`, beside the input or where
 * `--out` says (a folder takes that name inside it; the batch's under its
 * `--out` always, folderBatch.ts's names). A taken name is refused, nothing written and
 * exit 4 (`ifExists: 'refuse'`, CLI-6), or replaced with `--force`; the
 * same bytes already there are `unchanged`. Before generate's AI is asked,
 * an output that is already there is refused at no cost in quota; the write
 * itself decides as well, since a file can appear while the AI answers, and
 * alone for revise, whose question is answered with nothing written.
 * When every AI fails, generate writes nothing (OC5: the core's `standIn:
 * false`), unless `--allow-stand-in`, with which Forma's draft is written to
 * `<name>.draft.repx`, never under the report's own name, and said so (a
 * second target in the plan, `GenerateHow`'s `draft`, judged before the AI
 * is asked); its status is `draft`, exit 4, since the report asked for was
 * not made (CLI-4; the wave-4 review's U2).
 *
 * ## What it prints (CLI-11, SEC-3)
 *
 * stdout carries results only, through the guard's `protocolOut` (`io.out`),
 * so whatever a module logs goes to stderr. With `--json`, stdout is JSON
 * Lines: one object for each input as it finishes (`type: "input"`), then
 * one summary object (`type: "summary"`), each built from named fields,
 * never by spreading a job, the settings or a config, which hold the key:
 * the provider and the model that answered, the limit met, the file
 * written, the audit, and the text read from files apart under `fileText`
 * (its stand-in fonts under "stand-in fonts", as the work's notice says),
 * keys out before any string is clipped (caller.ts). Without it, a line or a
 * few for each input, the provider named and the model only with
 * `--verbose`. stderr carries the stages of an AI's work, the notices,
 * refusals and errors; the work's own log lines only with `--verbose`.
 * Every line goes through the scrubber (`io.redact`, the guard's, which the
 * entry handed the keys' values), and control characters, a line break and
 * a tab among them, and the marks that reorder what a terminal shows are
 * each a `?`, since a report's own text and a file's name reach the screen
 * (a Linux name can hold a line break, which would begin a line of its own
 * in the plan a CI author reads: SEC-W4-5); so each call prints one line,
 * and a stack under `--verbose` is printed line by line. A path is quoted
 * plainly, never as JSON (caller.ts `quoted`, U8). Under `--json` each
 * finding's text is one string, whole, beside its code (U9).
 *
 * ## Exit codes (CLI-7)
 *
 * 0 done; 1 a report written, or audited, with audit errors (`--fail-on
 * never` makes it 0); 2 a usage error; 3 no AI set up; 4 an input failed,
 * was refused, declined, only Forma's draft was written, a report was
 * written but not bound under --require-binding, or its output is already
 * there (a file the AI refusing the key left not started too); 5
 * stopped at an AI limit (a file it left not started too); 70 an internal
 * error (the guard's own exit code for an uncaught exception too); 130
 * interrupted. With several inputs the run's code is the highest in the
 * order 130, 70, 5, 4, 1, 0 (`worstExit`).
 *
 * ## A stop (TEST-3)
 *
 * The first SIGINT or SIGTERM (and Ctrl+Break, SIGBREAK, on Windows) aborts
 * the run's signal (`stopOnSignals`): the AI's thread is ended at once, so
 * no request goes out after it, the report under way is not written, and
 * the command exits 130; a second ends the process at once. On Windows a
 * stop while the AI's thread reads the files (OCR, a PDF's pages) ends the
 * process with 3221226505 (0xC0000409, Windows' fail-fast abort, not its
 * Ctrl+C code, 0xC000013A, which is 3221225786; the wave-7 review's W7R-4),
 * in place of 130, though nothing is written and the lines printed say 130
 * (measured in the wave-4 review, U7, and again in its fix round, leaving at
 * once after `main` or not; not yet explained). A stop while the thread
 * waits on the AI's answer, or while a batch waits out a limit, exits 130
 * on Windows too (measured in the CLI work's wave 8, Ctrl+Break sent to a
 * console of the command's own: 130 at "Waiting for the AI." and during a
 * minute's wait, 3221226505 at every moment of "Reading the files."). What survives a
 * kill is the write's own atomicity (a temporary name, then a link: at most
 * a `<name>.forma-partial-*` is left, never half a report under its name)
 * and the JSON line of every input already finished.
 *
 * Pure ASCII.
 */
import { readFileSync, readdirSync } from 'node:fs';
import type { AgentEdit } from '../lib/agentEdit';
import { PROVIDER_NAMES } from '../lib/aiProvider';
import type { AiLimit } from '../lib/aiLimit';
import type { QueryJson } from '../lib/databaseAi';
import { EDIT_OPS } from '../lib/editLanguage';
import { MAX_SAMPLE_ROWS } from '../lib/sqlSchema';
import { SAMPLE_SCRIPT_ROWS, type SampleTarget } from '../lib/sqlSchemaScript';
import { fallbacksFor } from '../lib/fallbackChain';
import { MAX_BATCH_FILES } from '../lib/folderDrop';
import { MAX_FILE_BYTES } from '../lib/attachmentBudget';
import { notReadyMessage, readAiSettings, type AiEnv, type AiSettings } from './aiSettings';
import { AiFailure, CallStopped, MAX_FILE_TEXT, ToolRefusal, UNSAFE_IN_LINE, clippedFromFile, quoted as quotedFor, scrubbed } from './caller';
import { CLI_COMMANDS, CLI_LAUNCHER, type CliCommand, type CliCommandName } from './cliCommands';
import { BATCH_DEPTH, KEY_REFUSED, ROUTE_WORDS, afterLimit, planBatch, skipWords, walkBatch, type BatchItem, type ListFolder, type Route, type Walked } from './folderBatch';
import type { GenEvent, GenSetup } from './genJobs';
import { GEN_LIMITS, STAGES, workerGenerator, type Generator } from './generator';
import { CONVERTED_VERSION, NO_EDIT_MADE, auditLayout, bindLayout, convertForeign, convertLayout, copyLayout, editLayout, notConverted, outlineLayout, pdfLayout, readLayout, repairLayout, writeLayout, type LayoutRun } from './layoutCalls';
import { formaUserFolder, keyParked } from './modelParks';
import { DESIGNER_VERBS_SINCE } from '../lib/designerRelease';
import { DESIGNER_INSTALL, DESIGNER_MAX_OBJECTS, DesignerRefusal, RENAME_TO_USE, designerConnections, designerNext, designerRead, type DesignerSetup } from './designerVerbs';
import { CHOSEN_WORDS, REPAIR_CHOSEN_WORDS, type LayoutBytes } from './nodeDatabase';
import { nodeSystem, parsePath, resolveFolderPath, resolveReadPath, resolveWritePath, type PathSystem, type PathVerdict, type WorkingFolder, type WriteFs, type WriteStatus } from './paths';
import { DATA_EXTENSIONS, SOURCE_EXTENSIONS, answeredBy, judgeDatabase, judgeInput, planGenerate, planRevise, runGenerate, runRevise, type BindingText, type DatabaseInput, type PathPolicy, type RevisePlan } from './reportCalls';
import { FOREIGN_EXTENSIONS, LAYOUT_EXTENSIONS, besideName } from './reportFile';
import { formaVersion } from './version';
import type { Audited } from './pipeline';
import { PIPELINE_LIMITS, workerPipeline, type Pipeline } from './workerPool';

/** What the process gives the command line: cliEntry.ts builds it, a test builds its own. */
export interface CliIo {
  /** The folder the command runs in, a full path (process.cwd()). */
  cwd: string;
  /** The AI's values, as the entry took them (aiSettings.ts `takeAiEnv(..., 'cli')`). */
  aiEnv: AiEnv;
  /** Writes results to stdout: the guard's `protocolOut`. Each call is whole lines. */
  out(text: string): void;
  /** One line on stderr: the guard's log. */
  err(line: string): void;
  /** Takes the keys out of a text: the guard's scrubber, the keys' values handed to it. */
  redact(text: string): string;
  /** Aborted by Ctrl+C or a termination (`stopOnSignals`). */
  signal: AbortSignal;
  /** The platform's path rules and file system; the real ones by default. */
  sys?: PathSystem;
  /** The file-system calls a write makes; Node's by default. */
  wfs?: WriteFs;
  /** Where the report commands' work runs; workerPool.ts's bounded thread by default, a test's own thread in its tests. */
  pipeline?: () => Pipeline;
  /** Where an AI's work runs; generator.ts's bounded thread, one for the command, by default. */
  generator?: (setup: GenSetup, log: (line: string) => void) => Generator;
  /** Forma's own folder, whose kept parks the batch reads before each file and the AI's work keeps; modelParks.ts `formaUserFolder` by default. */
  userFolder?: string;
  /** Lists a folder for the batch; folderBatch.ts `nodeList` by default. */
  list?: ListFolder;
  /** Waits out a limit, ended early by the signal; a timer by default. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** The time, for the batch's summary; Date.now by default. */
  now?: () => number;
  /**
   * Where Forma Designer is and the environment it is started with, as the
   * entry worked them out (designerVerbs.ts `designerPlace`, `designerEnvFrom`):
   * `connections` and `--connection` start it. Absent, neither can.
   */
  designer?: DesignerSetup;
}

/** Waits `ms`, or until `signal` is aborted, whichever comes first. */
function sleepFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((done) => {
    if (signal.aborted) return done();
    const stop = () => {
      clearTimeout(timer);
      done();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      done();
    }, ms);
    signal.addEventListener('abort', stop, { once: true });
  });
}

/** The exit codes (the header). */
export const EXIT = { done: 0, auditErrors: 1, usage: 2, noAi: 3, failed: 4, limit: 5, internal: 70, interrupted: 130 } as const;

/** The order a run's code is chosen in when its inputs ended differently: the first found wins. */
const PRECEDENCE: readonly number[] = [EXIT.interrupted, EXIT.internal, EXIT.limit, EXIT.failed, EXIT.auditErrors];

/** The run's exit code from its inputs' (the header): 130 > 70 > 5 > 4 > 1 > 0. */
export function worstExit(codes: readonly number[]): number {
  return PRECEDENCE.find((code) => codes.includes(code)) ?? EXIT.done;
}

/**
 * How an input ended. `skipped`: the batch left it, said why, and that is no
 * failure (a report nothing was asked of, or one made already under
 * `--skip-existing`). `draft`: every AI failed and only Forma's own draft was
 * written, under `--allow-stand-in`, so the report asked for was not made
 * (CLI-4: a draft never passes for success). `unbound`: a report written,
 * but not bound to the database given, under --require-binding (D1-9).
 * `notStarted`: a file that asks
 * the AI, left when the batch stopped asking it (OC5), listed so a person or
 * a CI step can see which are left.
 */
export type Status = 'done' | 'errors' | 'skipped' | 'draft' | 'unbound' | 'exists' | 'refused' | 'failed' | 'declined' | 'limit' | 'notStarted' | 'stopped' | 'internal';

/** Each status's exit code; a file not started takes the code of what stopped the batch (`Row`'s `exit`), the limit's by default. */
const EXIT_OF: Record<Status, number> = { done: 0, errors: 1, skipped: 0, draft: 4, unbound: 4, exists: 4, refused: 4, failed: 4, declined: 4, limit: 5, notStarted: 5, stopped: 130, internal: 70 };

/** How each status is counted in a summary line. */
const COUNTED: Record<Status, string> = {
  done: 'done',
  errors: 'with audit errors',
  skipped: 'skipped',
  draft: "Forma's draft only (the AI did not make the report)",
  unbound: 'written, but not bound to the database (--require-binding)',
  exists: 'already there',
  refused: 'refused',
  failed: 'failed',
  declined: 'declined',
  limit: 'stopped at an AI limit',
  notStarted: 'not started',
  stopped: 'stopped',
  internal: 'stopped by an internal error',
};

/** A usage error: exit 2, before anything is read. */
export class UsageError extends Error {}

/** The options the person gave, read. */
interface Options {
  out?: string;
  failOn: 'errors' | 'never';
  description?: string;
  data: string[];
  words?: string;
  edits?: string;
  json: boolean;
  verbose: boolean;
  force: boolean;
  mock: boolean;
  allowStandIn: boolean;
  editsOnly: boolean;
  /** The batch: a report nothing was asked of is repaired, rather than skipped. */
  repair: boolean;
  /** The batch: an input whose report is already there is skipped, so a rerun carries on. */
  skipExisting: boolean;
  /** The batch: the plan printed, nothing read, no AI asked. */
  dryRun: boolean;
  /** The batch: the most files it makes; `MAX_BATCH_FILES` unless the person says more. */
  max: number;
  /** A database's layout file: generate, revise, batch, convert and bind bind their reports to it (the header's *A database*). */
  database?: string;
  /** A connection Forma Designer keeps, whose layout it reads in place of --database's file (the header's *Forma Designer's connections*). */
  connection?: string;
  /** With --connection: the tables and views Forma Designer reads sample rows of, whose values go to the AI: naming them is the person's consent (OC6). */
  sampleObjects?: SampleTarget[];
  /** Files of sample rows of the same database, whose values go to the AI: passing one is the person's consent (OC6). */
  samples: string[];
  /** The query pinned, as JSON (databaseAi.ts `QueryJson`): from --procedure, --object or --query. */
  query: QueryJson | null;
  /** The connection a report names when it names none of its own. */
  connectionName?: string;
  /** A report written but not bound to the database given ends the input with 4. */
  requireBinding: boolean;
  /** sql-script: the tables and views to read sample rows of, as `schema.name`. */
  sample?: SampleTarget[];
  /** sql-script with --sample, or --sample-objects: the rows read of each. */
  rows?: number;
  /** sql-script: the server and database the sqlcmd line names. */
  sqlcmd?: { server: string; database: string };
}

/** What the arguments ask for. */
export type Parsed = { kind: 'help' } | { kind: 'version' } | { kind: 'run'; command: CliCommand; inputs: string[]; options: Options };

/** Options that take a value. */
const VALUED = new Set(['--out', '--fail-on', '--description', '--data', '--words', '--edits', '--max', '--database', '--connection', '--sample-objects', '--samples', '--procedure', '--query', '--object', '--connection-name', '--sample', '--rows']);
/** Options that take two values: sql-script's `--sqlcmd <server> <database>`. */
const PAIRED_VALUES = new Set(['--sqlcmd']);
/** Options given once for each file. */
const REPEATED = new Set(['--data', '--samples']);
/** Options that are switches. */
const SWITCHES = new Set(['--json', '--verbose', '--help', '--version', '--force', '--mock', '--allow-stand-in', '--edits-only', '--repair', '--skip-existing', '--dry-run', '--require-binding']);
/** The options that say what a report reads, of which one is given. */
const PINS = ['--procedure', '--query', '--object'] as const;

/**
 * The tables and views sql-script's `--sample` names, `dbo.Orders,Sales.[Order Lines]`:
 * split at commas outside brackets, each `schema.name` (`dbo` when only a name is given),
 * a bracketed part taken as it is written; `option`, the option a usage error names
 * (`--sample-objects` reads its tables the same way). Throws a `UsageError`.
 */
export function sampleTargets(text: string, option = '--sample'): SampleTarget[] {
  const parts: string[] = [];
  let at = '';
  let depth = 0;
  for (const c of text) {
    if (c === '[') depth += 1;
    if (c === ']') depth = Math.max(0, depth - 1);
    if (c === ',' && !depth) {
      parts.push(at);
      at = '';
    } else at += c;
  }
  parts.push(at);
  return parts.map((part) => {
    const names = [...part.trim().matchAll(/\[((?:[^\]]|\]\])+)\]|([^.[\]]+)/g)].map((m) => (m[1] !== undefined ? m[1].replace(/\]\]/g, ']') : m[2].trim())).filter(Boolean);
    // A control character is refused, never put in a script printed whole (UNSAFE_IN_LINE, as every line's are).
    const safe = part.replace(UNSAFE_IN_LINE, '?');
    if (!names.length || names.length > 2 || safe !== part) {
      throw new UsageError(`${option} names tables or views as schema.name, separated by commas, such as dbo.Orders,dbo.Customers; ${quoted(safe.trim() || safe)} is not one.`);
    }
    return names.length === 1 ? { schema: 'dbo', name: names[0] } : { schema: names[0], name: names[1] };
  });
}

/** The query a person pinned, from --procedure, --object or --query, as JSON for the layout to hold. Throws a `UsageError`. */
function pinnedJson(option: (typeof PINS)[number], value: string): QueryJson {
  if (option === '--procedure') return { procedure: value.trim() };
  if (option === '--object') return { table: value.trim() };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new UsageError(`--query is not JSON: ${error instanceof Error ? error.message.split('\n')[0] : 'it does not parse'}; give an object such as {"table":"dbo.Orders"} or {"procedure":"dbo.usp_Sales"}.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new UsageError('--query takes one JSON object, such as {"table":"dbo.Orders","columns":["OrderID"]} or {"procedure":"dbo.usp_Sales"}.');
  return parsed as QueryJson;
}
/** The options every command takes. */
const EVERY = ['--json', '--verbose', '--help'];

/** A value the person typed, as a usage error quotes it: short, and in quotes. */
const quoted = (text: string) => JSON.stringify(text.length > 60 ? `${text.slice(0, 60)}...` : text);

/** Reads the arguments (no file is read, nothing is judged). Throws a `UsageError`. */
export function parseArgs(argv: readonly string[]): Parsed {
  const end = argv.indexOf('--');
  if ((end < 0 ? argv : argv.slice(0, end)).some((a) => a === '--help' || a === '-h')) return { kind: 'help' };
  const inputs: string[] = [];
  const given = new Map<string, string[]>();
  const switched = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (i > end && end >= 0) {
      inputs.push(arg);
      continue;
    }
    if (i === end) continue;
    if (!arg.startsWith('--')) {
      if (arg.startsWith('-') && arg !== '-') throw new UsageError(`${quoted(arg)} is not an option; options are written in full, such as --out.`);
      inputs.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    if (SWITCHES.has(name)) {
      if (eq > 0) throw new UsageError(`${name} takes no value.`);
      switched.add(name);
      continue;
    }
    if (PAIRED_VALUES.has(name)) {
      const pair = [argv[i + 1], argv[i + 2]];
      const last = end < 0 ? argv.length : end;
      if (eq > 0 || i + 2 >= last || pair.some((v) => v === undefined || v.startsWith('--'))) throw new UsageError(`${name} takes two values after it: the server, then the database.`);
      i += 2;
      given.set(name, [...(given.get(name) ?? []), ...pair]);
      continue;
    }
    if (!VALUED.has(name)) throw new UsageError(`${quoted(name)} is not an option of Forma's command line.`);
    const value = eq > 0 ? arg.slice(eq + 1) : argv[i + 1];
    if (value === undefined || (eq < 0 && (value.startsWith('--') || i + 1 === end))) throw new UsageError(`${name} needs a value after it.`);
    if (eq < 0) i++;
    given.set(name, [...(given.get(name) ?? []), value]);
  }
  if (switched.has('--version')) return { kind: 'version' };
  const [name, ...rest] = inputs;
  if (name === undefined) throw new UsageError('Name a command.');
  const command: CliCommand | undefined = CLI_COMMANDS.find((c) => c.name === name);
  if (!command) throw new UsageError(`${quoted(name)} is not a command.`);
  if (command.soon) throw new UsageError(`${command.name} is not built yet; it comes with the folder batch.`);
  for (const option of [...given.keys(), ...switched]) {
    if (!EVERY.includes(option) && !command.options.includes(option)) throw new UsageError(`${option} is not an option of ${command.name}.`);
  }
  for (const [option, values] of given) {
    const once = PAIRED_VALUES.has(option) ? 2 : 1;
    if (!REPEATED.has(option) && values.length > once) throw new UsageError(`${option} is given ${values.length / once} times; give it once.`);
  }
  const one = (option: string) => given.get(option)?.[0];
  const failOn = one('--fail-on') ?? 'errors';
  if (failOn !== 'errors' && failOn !== 'never') throw new UsageError('--fail-on takes errors or never.');
  const maxGiven = one('--max');
  if (maxGiven !== undefined && !/^[1-9]\d{0,5}$/.test(maxGiven)) throw new UsageError('--max takes a whole number of files, 1 or more.');
  const options: Options = {
    out: one('--out'),
    failOn,
    description: one('--description'),
    data: given.get('--data') ?? [],
    words: one('--words'),
    edits: one('--edits'),
    json: switched.has('--json'),
    verbose: switched.has('--verbose'),
    force: switched.has('--force'),
    mock: switched.has('--mock'),
    allowStandIn: switched.has('--allow-stand-in'),
    editsOnly: switched.has('--edits-only'),
    repair: switched.has('--repair'),
    skipExisting: switched.has('--skip-existing'),
    dryRun: switched.has('--dry-run'),
    max: maxGiven === undefined ? MAX_BATCH_FILES : Number(maxGiven),
    database: one('--database'),
    connection: one('--connection'),
    samples: given.get('--samples') ?? [],
    query: null,
    connectionName: one('--connection-name'),
    requireBinding: switched.has('--require-binding'),
  };
  for (const [option, value] of [['--out', options.out], ['--edits', options.edits], ['--database', options.database], ['--connection', options.connection], ...options.samples.map((s) => ['--samples', s] as const), ...PINS.map((p) => [p, one(p)] as const)] as const) {
    if (value !== undefined && !value.trim()) throw new UsageError(`${option} needs a value after it.`);
  }
  // A database's layout, and what goes with it (the header's *A database*): a file (--database) or a connection Forma Designer
  // keeps (--connection), one of them; each of these needs one, and one query at most.
  if (options.database !== undefined && options.connection !== undefined) {
    throw new UsageError('--database and --connection each give the database the report reads, a layout file or a connection Forma Designer keeps; give one of them.');
  }
  const pins = PINS.filter((p) => given.has(p));
  if (options.database === undefined && options.connection === undefined) {
    const without = [...(options.samples.length ? ['--samples'] : []), ...pins, ...(options.connectionName !== undefined ? ['--connection-name'] : [])];
    if (without.length) throw new UsageError(`${without[0]} goes with --database or --connection, the database the report reads.`);
    if (options.requireBinding && !options.data.length) throw new UsageError('--require-binding goes with --database, or a layout given with --data, or --connection: with no database, no report is bound.');
  }
  if (pins.length > 1) throw new UsageError(`${pins.join(' and ')} each say what the report reads; give one of them.`);
  if (pins.length) options.query = pinnedJson(pins[0], one(pins[0]) as string);
  if (options.connectionName !== undefined && !options.connectionName.trim()) throw new UsageError('--connection-name needs a value after it.');
  if (command.name === 'bind' && !pins.length) throw new UsageError('Name what the report reads with --procedure, --object or --query; bind binds with no AI, so nothing chooses it for you.');
  if (command.name === 'bind' && options.database === undefined && options.connection === undefined) {
    throw new UsageError('Give the database the report reads: its layout with --database, or a connection Forma Designer keeps with --connection.');
  }
  // Sample rows Forma Designer reads through the connection (OC6: naming them is the person's act), and how many of each.
  if (command.name !== 'sql-script') {
    const objects = one('--sample-objects');
    if (objects !== undefined) {
      if (options.connection === undefined) throw new UsageError('--sample-objects goes with --connection, whose database Forma Designer reads the rows from; with a layout file, give the sample script\'s answer with --samples.');
      options.sampleObjects = sampleTargets(objects, '--sample-objects');
      if (options.sampleObjects.length > DESIGNER_MAX_OBJECTS) throw new UsageError(`--sample-objects names ${options.sampleObjects.length} tables or views; Forma Designer reads at most ${DESIGNER_MAX_OBJECTS} at a time.`);
    }
    const rows = one('--rows');
    if (rows !== undefined) {
      if (objects === undefined) throw new UsageError('--rows goes with --sample-objects, the tables whose rows Forma Designer reads.');
      if (!/^\d+$/.test(rows) || Number(rows) < 1 || Number(rows) > MAX_SAMPLE_ROWS) throw new UsageError(`--rows with --sample-objects takes a whole number of rows from 1 to ${MAX_SAMPLE_ROWS}, the most of each Forma keeps.`);
      options.rows = Number(rows);
    }
  }
  if (command.name === 'sql-script') {
    if (rest.length) throw new UsageError(`sql-script takes no file; ${rest.length === 1 ? 'one was' : `${rest.length} were`} named. Give --out to write the script to a file.`);
    const sample = one('--sample');
    if (sample !== undefined) options.sample = sampleTargets(sample);
    const rows = one('--rows');
    if (rows !== undefined) {
      if (sample === undefined) throw new UsageError('--rows goes with --sample, the tables whose rows are read.');
      if (!/^\d+$/.test(rows) || Number(rows) < 1 || Number(rows) > 50) throw new UsageError('--rows takes a whole number of rows from 1 to 50.');
      options.rows = Number(rows);
    }
    const pair = given.get('--sqlcmd');
    if (pair) {
      options.sqlcmd = { server: pair[0], database: pair[1] };
      if (options.out === undefined) throw new UsageError('--sqlcmd names the script file it runs: give --out with the .sql file to write the script to, such as --out forma-schema.sql.');
    }
  }
  for (const [option, value] of [['--out', options.out], ['--edits', options.edits]] as const) if (value !== undefined && !value.trim()) throw new UsageError(`${option} needs a value after it.`);
  if (command.name === 'audit') {
    if (!rest.length) throw new UsageError('Name a report, or a folder of reports, to audit.');
  } else if (command.name === 'convert') {
    if (!rest.length) throw new UsageError('Name an SSRS or FastReport report (.rdl, .rdlc or .frx), or a folder of them, to convert.');
  } else if (command.name === 'batch') {
    if (rest.length !== 1) throw new UsageError(`batch takes one folder; ${rest.length} were named.`);
    if (options.out === undefined) throw new UsageError('Name the folder to write the reports in with --out; a batch writes nothing beside its inputs unless --out names their folder.');
    if (options.force && options.skipExisting) throw new UsageError('--force makes a report again where one is already there, and --skip-existing leaves it; give one of them.');
    if (options.editsOnly && !options.words?.trim()) throw new UsageError('--edits-only goes with --words, the change each report is asked for.');
    if (options.words !== undefined && !options.words.trim()) throw new UsageError('--words needs a value after it.');
  } else if (command.name === 'generate') {
    if (!rest.length && !options.description?.trim()) throw new UsageError('Name files to make the report from, give --description "...", or both.');
    if (!rest.length && options.out === undefined) throw new UsageError('Name where to write the report with --out, since there is no file to write it beside.');
  } else if (command.name === 'connections') {
    if (rest.length) throw new UsageError(`connections takes no file; ${rest.length === 1 ? 'one was' : `${rest.length} were`} named.`);
  } else if (command.name !== 'sql-script' && rest.length !== 1) throw new UsageError(`${command.name} takes one report; ${rest.length} were named.`);
  if (command.name === 'edit' && options.edits === undefined) throw new UsageError('Give the edits with --edits: a .json file, or the JSON itself, an array of edits each with its op.');
  if (command.name === 'revise' && !options.words?.trim()) throw new UsageError('Give the request with --words "...": what to change in the report, or what to ask about it.');
  return { kind: 'run', command, inputs: rest, options };
}

/** How the help marks a command that asks the AI: always, or for the files whose route needs it. */
export const aiMark = (c: CliCommand): string => (c.needsAi === 'by route' ? '   [AI for some files]' : c.needsAi ? '   [AI]' : '');

/** The help: every command from the table, whether it needs an AI, the options, the AI's settings and the exit codes. */
export function helpText(version: string): string {
  const lines = [
    `Forma's command line, ${version}.`,
    '',
    `  node <clone>/${CLI_LAUNCHER} <command> [options]`,
    '',
    'From any folder; a relative path is read from the folder the command runs in. Commands marked [AI] call the AI set up in the environment the command runs in, and spend its quota, and [AI for some files] does for the files that need it; the others need no AI and no key.',
    '',
    'Commands:',
  ];
  for (const c of CLI_COMMANDS) {
    const soon = 'soon' in c && c.soon ? ' (not built yet)' : '';
    lines.push(`  ${c.name}${c.usage ? ` ${c.usage}` : ''}${aiMark(c)}`, `      ${c.says}${soon}`);
  }
  lines.push(
    '',
    'Options every command takes:',
    '  --json              results as JSON Lines on stdout: an object for each input as it finishes, then a summary object',
    '  --verbose           the work\'s own log lines on stderr, the model that answered, and an internal error\'s stack',
    '  --help              this help',
    '',
    'Options of some commands (each command lists its own above):',
    '  --out <file|folder> where to write; a folder takes the usual name inside it (batch: the folder its reports go in, each subfolder kept)',
    '  --force             replace a file already at the output; without it nothing is replaced, and the command exits 4',
    '  --fail-on errors|never  whether a report with audit errors makes the run exit 1; errors by default (audit, repair, edit, convert, bind, generate, revise, batch)',
    '  --description "..." the report in words (generate); sent with every picture and PDF (batch), which without one is made as Forma\'s draft the AI corrects',
    "  --data <file>       a data file whose columns are the report's fields (generate, and every picture and PDF of a batch): " + `${DATA_EXTENSIONS.join(', ')}; once for each file`,
    "  --allow-stand-in    when every AI fails, write Forma's own draft as <name>.draft.repx, and say so, exit 4 all the same (generate, batch); without it nothing is written",
    "  --mock              the mock invoice in place of the AI's answer (generate, revise, batch); an AI must still be set up",
    '  --words "..."       what to change in the report, or what to ask about it (revise); what to change in every report, and every SSRS or FastReport report once converted (batch)',
    '  --edits-only        decline a change that would redesign the whole report, and write nothing (revise, batch)',
    '  --edits <edits.json|json>  the edits, a JSON array, each with its op and the fields it reads (edit); outline gives the control names',
    '  --repair            repair every report nothing else was asked of (batch); without it such a report is skipped, and said',
    '  --skip-existing     skip an input whose report is already under --out, so running the same command again carries on (batch)',
    '  --dry-run           print what each file would be made into, and which need the AI, reading no file and asking no AI (batch)',
    `  --max <n>           the most files a batch makes; ${MAX_BATCH_FILES} unless given, and a folder holding more is refused before anything is read`,
    "  --database <layout> a database's layout: what sql-script's script answers, saved as a file (UTF-8 or UTF-16), an SSMS \"Generate Scripts\" file, or a .repx whose data source it reads; the AI binds the report to it, and Forma writes the SQL data source with the connection by name only (generate, revise, batch; convert, bind and a batch's repairs with no AI)",
    `  --connection <name> a SQL Server connection Forma Designer keeps for you (connections lists them), in place of --database: Forma Designer ${DESIGNER_VERBS_SINCE} or later, on Windows, reads its database's layout, and the report's connection is written with this name (generate, revise, batch, convert, bind)`,
    "  --samples <file>    sample rows of the same database (sql-script --sample's answer), whose values go to the AI with the layout: giving the file is your consent; once for each file (generate, revise, batch). Without it, only names go",
    "  --sample-objects <dbo.A,dbo.B>  with --connection: Forma Designer reads a few rows of these tables or views, whose values go to the AI with the layout: naming them is your consent (generate, revise, batch). Without it, only names go",
    '  --procedure <name>  the stored procedure the report reads, such as dbo.usp_Sales; refused before any AI is asked when the layout does not say what it returns (generate, revise, batch, bind)',
    '  --object <name>     the table or view the report reads, such as dbo.Orders (generate, revise, batch, bind)',
    '  --query <json>      the query the report reads, as JSON: {"table":"dbo.Orders","joins":[{"table":"dbo.Customers"}],"filter":"[Orders.Freight] > ?Min"}, or {"procedure":"..."}, or {"name":"...","sql":"SELECT ..."}; every name must be in the layout (generate, revise, batch, bind)',
    "  --connection-name <name>  the name your application knows the database by, written as the report's connection when it names none; the database's own name by default, or --connection's",
    '  --require-binding   a report written but not bound to the database given ends its input with exit 4 (generate, revise, batch, convert)',
    '  --sample <dbo.A,dbo.B>  sql-script: the script that reads a few rows of these tables and views instead of the layout',
    `  --rows <n>          the rows read of each table or view: 1 to 50 with sql-script --sample, 1 to ${MAX_SAMPLE_ROWS} with --sample-objects (the most Forma keeps); ${SAMPLE_SCRIPT_ROWS} unless given`,
    '  --sqlcmd <server> <database>  sql-script with --out: also prints the sqlcmd line that runs the script into a UTF-8 .txt beside it',
    '',
    `A batch makes one file at a time, each that asks the AI in a thread of its own, with at most ${Math.round(GEN_LIMITS.deadlineMs / 60_000)} minutes and ${GEN_LIMITS.heapMb} MB of memory, so one bad file cannot end the batch. A minute's limit is waited out and the file made once more; the day's limit stops the files that ask the AI, each listed as not started, while those that need none are still made, and the same command with --skip-existing carries on once it lifts. A report the words leave as it was is written as it reads (an SSRS or FastReport report as converted), so --out holds every report.`,
    '',
    `Forma Designer, for connections and --connection: the one installed for this Windows user, in ${DESIGNER_INSTALL.join('\\')} under LOCALAPPDATA, ${DESIGNER_VERBS_SINCE} or later; or FORMA_DESIGNER, the full path of a RepxDesigner.exe built from source. It reads the database with the connection it keeps, whose server, login and password it never gives Forma.`,
    '',
    'The AI, from the environment the command runs in (in CI, from its secrets into the step\'s environment): FORMA_GEMINI_KEY; or FORMA_OPENROUTER_KEY and FORMA_OPENROUTER_MODEL; or FORMA_LOCAL_MODEL, with FORMA_LOCAL_URL for a server not at Ollama\'s address; FORMA_PROVIDER when more than one is set; FORMA_MODEL and FORMA_LOCALE if wanted.',
    '',
    "Exit codes: 0 done; 1 a report written or audited with audit errors; 2 a usage error; 3 no AI set up; 4 an input failed, was refused or declined, only Forma's draft was written, a report was written but not bound under --require-binding, or its output is already there; 5 stopped at an AI limit; 70 an internal error; 130 interrupted (on Windows, a stop while a file that asks the AI is being made can end the process with 3221226505 instead, its lines still saying 130). With several inputs, the highest in the order 130, 70, 5, 4, 1, 0.",
  );
  return `${lines.join('\n')}\n`;
}

/** The marks escaped in a JSON line that JSON.stringify leaves (it escapes only the first 32): a report's own text must not steer the screen. */
const UNSAFE_IN_JSON = /[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/** A path as a person reads it in a line: in quotes, never escaped, so it can be copied to a shell; a control character in it a `?` (caller.ts `quoted`). */
const q = (path: string) => quotedFor(path, 'cli');
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** How long until a limit lifts, in words. */
function lasting(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 90) return n(s, 'second');
  const m = Math.round(s / 60);
  if (m < 90) return n(m, 'minute');
  return n(Math.round(m / 60), 'hour');
}

/** A limit the AI met, in words: which AI, which limit, and when it lifts when that is known. */
export function limitWords(limit: AiLimit): string {
  const kind = { 'per-minute': 'per-minute limit', daily: 'daily limit', unknown: 'limit' }[limit.kind];
  return `${PROVIDER_NAMES[limit.provider] ?? limit.provider} reached its ${kind}${limit.waitMs === null ? '' : `, which lifts in about ${lasting(limit.waitMs)}`}.`;
}

/** What a write did, in words. */
function wrote(written: { path: string; status: WriteStatus }): string {
  switch (written.status) {
    case 'unchanged':
      return `Found the same file already at ${q(written.path)}, so nothing changed.`;
    case 'replaced':
      return `Replaced ${q(written.path)}.`;
    case 'exists':
      return `${q(written.path)} is already there and holds something else, so nothing was written; give --force to replace it.`;
    default:
      return `Wrote ${q(written.path)}.`;
  }
}

/** An input's status once its report is written: already there, or with audit errors, or done. */
const writtenStatus = (written: { status: WriteStatus }, errors = 0): Status => (written.status === 'exists' ? 'exists' : errors ? 'errors' : 'done');

/** The fields of `value` named, in that order, and no other (SEC-3: never a spread of a job, the settings or a config). */
function pick(value: object, keys: readonly string[]): Record<string, unknown> {
  const from = value as Record<string, unknown>;
  return Object.fromEntries(keys.filter((k) => k in from).map((k) => [k, from[k]]));
}

/**
 * The labels the text read from files is printed under, where the field's own name is not a person's. `aiError` is why the
 * AI made no report, which is often not an answer of its own (a Local AI not running, a refused key, a limit): it was
 * "the AI answered" until the CLI work's wave-8 end-to-end run read "The AI answered: Forma could not reach the local AI".
 */
const FROM_FILE_LABELS: Record<string, string> = { standInFonts: 'stand-in fonts', designerLooksUp: 'designer looks up', aiError: 'why the AI made no report' };

/** An input's result, as it is printed. */
interface Row {
  input: string;
  status: Status;
  /** Result lines, for stdout. */
  lines: string[];
  /** Notices and the like, for stderr. */
  notes: string[];
  /** Why it failed or was refused, for stderr. */
  message?: string;
  /** The named fields its JSON line carries. */
  fields: Record<string, unknown>;
  /** Text read from files: apart, as data, under `fileText` in a JSON line. */
  fromFile?: Record<string, unknown>;
  /** Its exit code when its status's is not the one (a file not started when the AI refused the key: 4, not the limit's 5). */
  exit?: number;
  /** The AI refused the key, by the words of the AI's own failure (never the row's message, which names the file: SEC-W4-3). */
  keyRefused?: boolean;
}

/** A row with no result: the input refused, failed, stopped. */
const failedRow = (input: string, status: Status, message: string, fields: Record<string, unknown> = {}): Row => ({ input, status, lines: [], notes: [], message, fields });

/** A write that met other content under its name: no result line, and the refusal on stderr, as every refusal is (U6). */
function refusedWrite(written: { path: string; status: WriteStatus }, fields: Record<string, unknown>, notes: string[]): Omit<Row, 'input'> {
  return { status: 'exists', lines: [], notes, message: wrote(written), fields };
}

/** Everything a command's run shares. */
interface Run {
  io: CliIo;
  command: CliCommandName;
  inputs: string[];
  options: Options;
  sys: PathSystem;
  scope: WorkingFolder;
  policy: PathPolicy<'refuse' | 'replace'>;
  layout(): LayoutRun;
  /** Every row printed, in order. */
  rows: Row[];
  /** Why the batch stopped before its last file: an AI's limit it does not wait out, or the AI refusing the key. */
  stopped?: { why: 'limit'; limit: AiLimit } | { why: 'key' };
  /** Whether the way on after that stop was said on stderr (`tellStop`); else it is said once at the batch's end (`tellStopAtEnd`). */
  stopTold?: boolean;
  /** The batch's plan and walk, for its summary; absent for every other command. */
  batch?: BatchFacts;
  /** --connection's layout and --sample-objects' rows, as Forma Designer printed them, once read (`connectionFirst`). */
  fetched?: { connection: string; layout: LayoutBytes; samples: LayoutBytes[] };
  out(line: string): void;
  err(line: string): void;
}

/**
 * The text a person sees, one line of it: keys out, and every control
 * character a `?`, a line break and a tab among them, so neither a report's
 * own text nor a file's name (a Linux name can hold a line break) can steer
 * the screen or begin a line of its own (SEC-W4-5). A text of several lines,
 * a stack, is printed line by line.
 */
const shown = (io: CliIo, text: string) => io.redact(String(text)).replace(UNSAFE_IN_LINE, '?');

/** Prints a row as it finishes: its lines and notes, or its JSON line. */
function emit(run: Run, row: Row): void {
  run.rows.push(row);
  const { io, options } = run;
  const exitCode = rowExit(row, options);
  if (options.json) {
    const fromFile = row.fromFile ? fileTextOf(row.fromFile, io.redact) : undefined;
    const line = { type: 'input', command: run.command, input: row.input, status: row.status, exitCode, ...(row.message ? { message: row.message } : {}), ...row.fields, ...(fromFile ? { fileText: fromFile } : {}) };
    run.out(JSON.stringify(scrubbed(line, io.redact)).replace(UNSAFE_IN_JSON, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));
  } else {
    for (const line of row.lines) run.out(line);
    if (row.fromFile) for (const line of fromFileLines(clippedFromFile(row.fromFile, io.redact) as Record<string, unknown>)) run.out(line);
  }
  for (const note of row.notes) run.err(note);
  if (row.message) run.err(row.message);
}

/** The text read from files, its fields renamed where a person reads them. */
function relabel(fromFile: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fromFile).map(([k, v]) => [FROM_FILE_LABELS[k] ?? k, v]));
}

/** The lists whose lines pair one to one with a structured list of the same name in the line (the audit's `findings`, the print check's `printFindings`). */
const PAIRED = new Set(['findings', 'printed']);

/**
 * Lines reportFile.ts `fileLines` folded made whole again: a continuation
 * ("... ") joined to the line it continues, so a finding is one string
 * (U9). A line cut at a space ends short of `MAX_FILE_TEXT`, so the space
 * goes back; one cut inside a word fills it, so nothing does. Only for
 * `PAIRED`'s lists, each line of which begins with its severity and code,
 * never with "... ".
 */
export function unfolded(lines: readonly unknown[]): string[] {
  const out: string[] = [];
  let before = 0;
  for (const line of lines) {
    if (typeof line !== 'string') continue;
    if (out.length && line.startsWith('... ')) out[out.length - 1] += `${before === MAX_FILE_TEXT ? '' : ' '}${line.slice(4)}`;
    else out.push(line);
    before = line.length;
  }
  return out;
}

/**
 * The text read from files as a JSON line carries it, under `fileText`:
 * keys out first, then folded and clipped (caller.ts `clippedFromFile`),
 * but the findings, made whole and never clipped, so `fileText.findings[i]`
 * is the message of `findings[i]` (U9); the plain lines keep the folding.
 */
function fileTextOf(fromFile: Record<string, unknown>, redact: (text: string) => string): Record<string, unknown> {
  return relabel(Object.fromEntries(Object.entries(fromFile).map(([k, v]) => [k, PAIRED.has(k) && Array.isArray(v) ? scrubbed(unfolded(v), redact) : clippedFromFile(v, redact)])));
}

/**
 * The chat's words without the emphasis its page draws (U12): `**bold**` and
 * `` `code` `` marks taken out for a plain line. Never a single `_`, which a
 * control's name holds (`label_1`); never in the outline or the findings,
 * which are the report's own text.
 */
export const plainWords = (text: string) => text.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');

/** The text read from files as plain lines, indented under the result: the findings, the outline, the edits, the reply. */
function fromFileLines(fromFile: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
  for (const [key, value] of Object.entries(fromFile)) {
    if (key === 'dataSources') {
      for (const s of value as { name: string; connection: string; queries: string[] }[]) lines.push(`  data source ${s.name}: connection ${s.connection}${s.queries.length ? `; queries ${s.queries.join(', ')}` : ''}`);
    } else if (key === 'aiError') {
      // Said on stderr with generate's notes, never as a result line.
    } else if (key === 'reply') {
      for (const s of strings(value)) lines.push(`  ${plainWords(s)}`);
    } else if (key === 'outline' || key === 'findings' || key === 'printed' || key === 'notes') {
      for (const s of strings(value)) lines.push(`  ${s}`);
    } else if (key === 'repairs') {
      for (const s of strings(value)) lines.push(`  repaired ${s}`);
    } else if (key === 'applied' || key === 'declined' || key === 'changes' || key === 'brief') {
      const label = { applied: 'made', declined: 'declined', changes: 'changed', brief: 'asks for' }[key];
      for (const s of strings(value)) lines.push(`  ${label}: ${plainWords(s)}`);
    } else {
      const list = strings(value);
      if (list.length) lines.push(`  ${FROM_FILE_LABELS[key] ?? key}: ${list.join(', ')}`);
    }
  }
  return lines;
}

/** An input's exit code: its own when it has one, else its status's, an audit error's 0 under `--fail-on never`. */
const rowExit = (row: Pick<Row, 'status' | 'exit'>, options: Options) => row.exit ?? (row.status === 'errors' && options.failOn === 'never' ? EXIT.done : EXIT_OF[row.status]);

/** What a file system's refusal means, by Node's code: the person's to fix, never Forma's fault (U3). */
const FS_REFUSALS: Record<string, string> = {
  EACCES: 'the system does not allow it (permission denied)',
  EPERM: 'the system does not allow it (the file is read-only, or its folder does not allow it)',
  EROFS: 'its disk is read-only',
  ENOSPC: 'its disk is full',
  EDQUOT: 'its disk quota is used up',
  EBUSY: 'another program has it open',
  EISDIR: 'a folder has that name',
  ENOTDIR: 'a part of the path is a file, not a folder',
  ENAMETOOLONG: 'its name is too long for the file system',
};

/**
 * A file system's refusal in a person's words, or null when the error is not
 * one (U3): `Forma cannot write "<the target>"`, never the temporary
 * `.forma-partial-*` name the write was using, with why and what to do.
 * Until the wave-4 review a read-only `--out` folder in CI was said as an
 * internal error, exit 70, which tells a person Forma is broken.
 */
export function fileSystemRefusal(error: unknown): string | null {
  const e = error as { code?: unknown; syscall?: unknown; path?: unknown; dest?: unknown } | null;
  const why = typeof e?.code === 'string' && Object.hasOwn(FS_REFUSALS, e.code) ? FS_REFUSALS[e.code] : null;
  if (!why) return null;
  const partial = /\.forma-partial-[A-Za-z0-9]+$/;
  const named = [e?.dest, e?.path].find((p): p is string => typeof p === 'string' && p !== '');
  const target = named?.replace(partial, '');
  // paths.ts `writeOutput`'s calls: the folder made, the temporary file opened, then linked, copied or renamed to its name.
  const writing = ['mkdir', 'link', 'rename', 'copyfile', 'unlink', 'write'].includes(String(e?.syscall)) || (e?.syscall === 'open' && typeof e?.path === 'string' && partial.test(e.path));
  if (!writing) return `Forma cannot read ${target ? q(target) : 'a file it was given'}: ${why}.`;
  return `Forma cannot write ${target ? q(target) : 'the report'}: ${why}. Nothing was written; choose another --out, or make room or allow it, and run the command again.`;
}

/**
 * Runs one input's work and makes its row; a refusal, a failure, a stop or
 * an internal error becomes a row of its own. A usage error is thrown on, to
 * end the run with 2.
 */
async function attempt(run: Run, input: string, work: () => Promise<Omit<Row, 'input'>>): Promise<Row> {
  try {
    return { input, ...(await work()) };
  } catch (error) {
    if (error instanceof UsageError) throw error;
    if (run.io.signal.aborted || error instanceof CallStopped) return failedRow(input, 'stopped', 'Stopped: the report under way was not written.');
    if (error instanceof AiFailure) {
      // A single command met a limit: the way on, which the batch says in its own words (tellStop) and generate and revise
      // left out until the CLI work's wave-8 end-to-end run.
      const again = error.limit && run.command !== 'batch' ? ' Run the same command again once it lifts.' : '';
      // Whether the AI refused the key is read in its own failure's words alone (browser Batch's rule), which name no file (SEC-W4-3).
      return { ...failedRow(input, error.limit ? 'limit' : 'failed', `${error.message}${error.limit ? ` ${limitWords(error.limit)}${again}` : ''}`, { limit: error.limit }), keyRefused: !error.limit && KEY_REFUSED.test(error.message) };
    }
    if (error instanceof ToolRefusal) return failedRow(input, 'refused', error.message);
    const refused = fileSystemRefusal(error);
    if (refused) return failedRow(input, 'failed', refused);
    const said = error instanceof Error ? error.message : String(error);
    const row = failedRow(input, 'internal', `Forma stopped on an internal error with ${q(input)}: ${said.split('\n')[0]}`);
    if (run.options.verbose && error instanceof Error && error.stack) row.notes.push(...error.stack.split('\n'));
    return row;
  }
}

/** A path's name without its extension. */
const stemOf = (run: Run, raw: string) => run.sys.path.basename(raw, run.sys.path.extname(raw));

/**
 * Where `--out` sends a file: a folder (one that is there, judged by
 * paths.ts, or a name ending in a separator) takes `name` inside it; any
 * other name is the file itself, which the call judges for a write, and
 * which must be of `extensions`, the kinds the command writes, or the
 * person is told how to name a new folder instead (a usage error, U13:
 * `--out newdir` was refused as "not a .repx file", with no word of the
 * separator that makes it a folder).
 */
function outTarget(run: Run, name: string | null, extensions: readonly string[]): { path: string; folder: string | null } | undefined {
  const out = run.options.out;
  if (out === undefined) return undefined;
  const separated = /[\\/]$/.test(out);
  if (!separated && !resolveFolderPath(out, run.scope, run.sys).ok) {
    if (!extensions.includes(run.sys.path.extname(out).toLowerCase())) {
      throw new UsageError(`--out names ${q(out)}, which is not a ${extensions.join(' or ')} file, what ${run.command} writes; to write into a new folder, end it with a separator: ${q(`${out}${run.sys.path.sep}`)}.`);
    }
    return { path: out, folder: null };
  }
  if (name === null) throw new UsageError('--out names a folder; name the file to write in it, since there is no input file to name it after.');
  return { path: run.sys.path.join(out, name), folder: out };
}

/** The edits a person gave: a .json file, or the JSON itself; each checked field by field. Throws a `UsageError`, or a `ToolRefusal` for the file. */
function editsGiven(run: Run): AgentEdit[] {
  const given = (run.options.edits ?? '').trim();
  let text = given;
  let where = 'The edits given with --edits';
  if (!/^[[{]/.test(given)) {
    const file = judgeInput(given, ['.json'], run.scope, run.sys);
    text = readFileSync(file.path, 'utf8').replace(/^\ufeff/, '');
    where = q(file.spelled);
  }
  return editsFrom(text, where);
}

/** What each field of an edit is: a field added to the chat's `AgentEdit` fails to compile here until it is added (as reportTools.ts's schema does). */
const EDIT_FIELDS = {
  op: 'op',
  control: 'string',
  row: 'number',
  cell: 'number',
  band: 'string',
  text: 'string',
  x: 'number',
  y: 'number',
  width: 'number',
  height: 'number',
  family: 'string',
  size: 'number',
  bold: 'boolean',
  italic: 'boolean',
  underline: 'boolean',
  foreColor: 'string',
  backColor: 'string',
  align: 'align',
  paper: 'string',
  landscape: 'boolean',
  left: 'number',
  right: 'number',
  top: 'number',
  bottom: 'number',
  visible: 'boolean',
  borders: 'string',
  borderColor: 'string',
  borderWidth: 'number',
  format: 'string',
  field: 'string',
  pageInfo: 'string',
  name: 'string',
  total: 'string',
} as const satisfies { [K in Exclude<keyof AgentEdit, 'query'>]-?: 'op' | 'string' | 'number' | 'boolean' | 'align' };

/** The ops edit takes: the chat's, but `data`, which needs a database layout: bind is the command that takes one (as the server's repx_edit, until the CLI work's wave 7). */
export const EDIT_COMMAND_OPS: readonly string[] = EDIT_OPS.filter((op) => op !== 'data');

/** The edits in a JSON text, each an object with its op and fields of the right kinds. Throws a `UsageError` naming what is wrong. */
export function editsFrom(text: string, where: string): AgentEdit[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${where} is not JSON: ${error instanceof Error ? error.message.split('\n')[0] : 'it does not parse'}.`);
  }
  const list = Array.isArray(value) ? value : [value];
  if (!list.length) throw new UsageError(`${where} holds no edit; give at least one.`);
  const fields = EDIT_FIELDS as Record<string, string>;
  // "Edit 1 of the edits given with --edits", the sentence's own capital only at its start (U13).
  const of = where.startsWith('The ') ? `the ${where.slice(4)}` : where;
  return list.map((edit, i) => {
    const at = `Edit ${i + 1} of ${of}`;
    if (!edit || typeof edit !== 'object' || Array.isArray(edit)) throw new UsageError(`${at} is not an object with its op and fields.`);
    if (!('op' in edit)) throw new UsageError(`${at} has no op; ops are ${EDIT_COMMAND_OPS.join(', ')}.`);
    for (const [key, v] of Object.entries(edit)) {
      const kind = Object.hasOwn(fields, key) ? fields[key] : undefined;
      if (!kind) throw new UsageError(`${at} has ${quoted(key)}, which no edit reads.`);
      const fits =
        kind === 'op' ? typeof v === 'string' && EDIT_COMMAND_OPS.includes(v) : kind === 'align' ? v === 'left' || v === 'center' || v === 'right' : kind === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === kind;
      if (!fits) {
        const want = { op: `one of ${EDIT_COMMAND_OPS.join(', ')}`, align: 'left, center or right', number: 'a number', string: 'text in quotes', boolean: 'true or false' }[kind];
        throw new UsageError(`${at}: its ${key} is not ${want}.`);
      }
    }
    return edit as AgentEdit;
  });
}

/** What a folder of inputs is listed for: audit's reports, convert's SSRS and FastReport reports. */
const FOLDER_OF = {
  audit: { extensions: LAYOUT_EXTENSIONS, what: 'report (.repx or .vsrepx)', none: 'no report (.repx or .vsrepx)', done: 'audited' },
  convert: { extensions: FOREIGN_EXTENSIONS, what: 'SSRS or FastReport report (.rdl, .rdlc or .frx)', none: 'no SSRS or FastReport report (.rdl, .rdlc or .frx)', done: 'converted' },
} as const;

/** The reports of the command's kind directly in a folder (never a link, never a dot-file), or the input itself when it names one. */
function folderInputs(run: Run, raw: string, command: keyof typeof FOLDER_OF): string[] | Row {
  const of = FOLDER_OF[command];
  const isOne = (name: string) => (of.extensions as readonly string[]).includes(run.sys.path.extname(name).toLowerCase());
  if (isOne(raw)) return [raw];
  const folder = resolveFolderPath(raw, run.scope, run.sys);
  if (!folder.ok) return failedRow(raw, 'refused', `${folder.reason} ${command} takes a ${of.what} or a folder of them.`);
  // A link's entry is not a file here (withFileTypes reads it with lstat), so no link in the folder is followed; each file is judged again on its own.
  const found = readdirSync(folder.path, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && isOne(entry.name))
    .map((entry) => run.sys.path.join(folder.path, entry.name))
    .sort();
  // With the way on (the CLI work's wave-8 end-to-end run: the refusal stopped at "nothing was audited"): no subfolder is read.
  if (!found.length) return failedRow(raw, 'refused', `${q(folder.path)} holds ${of.none} directly in it, so nothing was ${of.done}; ${command} reads no subfolder, so name the folder they are in, or the files.`);
  return found;
}

/** The fields every report command's JSON line carries of the report read. */
const READ_FIELDS = ['path', 'kind', 'loginRemoved', 'notices'];
const AUDIT_FIELDS = ['errors', 'warnings', 'summary', 'findings'];

/** The six commands that need no AI, each run on one input (audit and convert on each of theirs). */
async function layoutCommand(run: Run, input: string): Promise<Row> {
  const { policy } = run;
  return attempt(run, input, async () => {
    switch (run.command) {
      case 'audit': {
        const done = await auditLayout(input, policy, run.layout());
        return {
          status: done.data.errors ? 'errors' : 'done',
          lines: [`Audited ${q(done.data.path)}: ${done.words}.`],
          notes: done.data.notices,
          fields: pick(done.data, [...READ_FIELDS, ...AUDIT_FIELDS]),
          fromFile: done.fromFile,
        };
      }
      case 'outline': {
        const done = await outlineLayout(input, policy, run.layout());
        const c = done.data;
        return {
          status: 'done',
          lines: [`Outlined ${q(c.path)}: ${n(c.bands, 'band')}, ${n(c.controls, 'control')}, ${n(c.fields, 'field')} printed, ${n(c.parameters, 'parameter')} and ${n(c.dataSources, 'SQL data source')}.`],
          notes: c.notices,
          fields: pick(c, [...READ_FIELDS, 'bands', 'controls', 'fields', 'parameters', 'dataSources']),
          fromFile: done.fromFile,
        };
      }
      case 'repair':
        return repairWork(run, input, outTarget(run, `${stemOf(run, input)}.repaired.repx`, LAYOUT_EXTENSIONS)?.path, policy);
      case 'convert':
        return convertWork(run, input, outTarget(run, `${stemOf(run, input)}.converted.repx`, ['.repx'])?.path, policy);
      case 'bind':
        return bindWork(run, input);
      case 'pdf': {
        const done = await pdfLayout(input, outTarget(run, `${stemOf(run, input)}.pdf`, ['.pdf'])?.path, policy, run.layout());
        const d = done.data;
        const fields = pick(d, [...READ_FIELDS, 'written', 'pages']);
        if (d.written.status === 'exists') return refusedWrite(d.written, fields, d.notices);
        return { status: writtenStatus(d.written), lines: [`${wrote(d.written)} ${n(d.pages, 'page')}.`], notes: d.notices, fields, ...(done.fromFile ? { fromFile: done.fromFile } : {}) };
      }
      case 'edit': {
        const edits = editsGiven(run);
        const ext = /\.vsrepx$/i.test(input) ? '.vsrepx' : '.repx';
        const done = await editLayout(input, edits, { output: outTarget(run, `${stemOf(run, input)}.edited${ext}`, LAYOUT_EXTENSIONS)?.path }, policy, run.layout());
        const d = done.data;
        const fields = pick(d, [...READ_FIELDS, 'written', 'applied', 'declined', 'notWritten']);
        if (!d.written) {
          const why = d.notWritten === NO_EDIT_MADE ? `No edit was made to ${q(d.path)}, so nothing was written; each is declined below with why.` : `Nothing was written: ${d.notWritten}`;
          return { status: 'declined', lines: [why], notes: d.notices, fields, fromFile: done.fromFile };
        }
        if (d.written.status === 'exists') return refusedWrite(d.written, fields, d.notices);
        return {
          status: writtenStatus(d.written),
          lines: [`${wrote(d.written)} ${n(d.applied, 'edit')} made${d.declined ? `, ${d.declined} declined` : ''}.`],
          notes: d.notices,
          fields,
          fromFile: done.fromFile,
        };
      }
      default:
        throw new Error(`${run.command} is not one of the report commands`);
    }
  });
}

/**
 * A repair: every repair Forma makes, written to `output` (else
 * `<name>.repaired.repx` beside it), with the audit of the result. A
 * batch's repair route hands it the batch's database (since the CLI work's
 * wave-8 review, W8R-1: the route bound nothing, carried no binding on its
 * row, and so passed `--require-binding` unbound), and the report is bound
 * with no AI (nodeDatabase.ts `bindRepaired`), its row carrying `binding`
 * and how its query was chosen, held to `--require-binding` as every other.
 */
async function repairWork(run: Run, input: string, output: string | undefined, policy: Run['policy'], database?: DatabaseInput): Promise<Omit<Row, 'input'>> {
  const done = await repairLayout(input, output, policy, run.layout(), database);
  const d = done.data;
  const fields = {
    ...pick(d, [...READ_FIELDS, 'written', 'repairs', ...AUDIT_FIELDS]),
    ...(database ? { binding: bindingField(d.bound, done.fromFile.binding), chosenBy: d.chosenBy ?? null } : {}),
  };
  if (d.written.status === 'exists') return refusedWrite(d.written, fields, d.notices);
  const chosen = d.chosenBy ? [`  chosen as ${REPAIR_CHOSEN_WORDS[d.chosenBy]}`] : [];
  return requiredBound(run, {
    status: writtenStatus(d.written, d.errors),
    lines: [`${wrote(d.written)} ${d.repairs.length ? `Repaired: ${d.repairs.join(', ')}.` : 'Nothing needed repairing.'} The result has ${done.words}.`, ...bindingLines(done.fromFile.binding, d.bound), ...chosen],
    notes: d.notices,
    fields,
    fromFile: withoutBinding(done.fromFile),
  });
}

/** Said of every converted report: the version it is written as, which later versions open as DevExpress opens an older layout. */
const CONVERTED_AS = `with no AI, written as DevExpress ${CONVERTED_VERSION} writes a report, which later versions open`;

/**
 * A conversion: an SSRS or FastReport report made into a repaired `.repx`
 * with no AI (layoutCalls.ts `convertLayout`), written to `output` (else
 * `<name>.converted.repx` beside it), its converter's notices as warnings.
 * A file that will not convert is a failure, with nothing written.
 */
async function convertWork(run: Run, input: string, output: string | undefined, policy: Run['policy'], label = input): Promise<Omit<Row, 'input'>> {
  const database = databaseOf(run);
  const done = await convertLayout(input, output, policy, run.layout(), database);
  const d = done.data;
  const fields = {
    ...pick(d, ['path', 'from', 'version', 'written', 'notices', ...AUDIT_FIELDS]),
    // With a database, what it binds and how its query was chosen (GAP1-5).
    ...(database ? { binding: bindingField(d.bound, done.fromFile.binding), chosenBy: d.chosenBy } : {}),
  };
  if (!d.written) return { status: 'failed', lines: [], notes: d.notices, message: notConverted(q(label), d.from, 'cli'), fields };
  if (d.written.status === 'exists') return refusedWrite(d.written, fields, d.notices);
  const chosen = d.chosenBy ? [`  chosen as ${CHOSEN_WORDS[d.chosenBy]}`] : [];
  return requiredBound(run, {
    status: writtenStatus(d.written, d.errors),
    lines: [`${wrote(d.written)} Converted from ${d.from} ${CONVERTED_AS}. The result has ${done.words ?? 'no audit'}.`, ...bindingLines(done.fromFile.binding, d.bound), ...chosen],
    notes: d.notices,
    fields,
    fromFile: withoutBinding(done.fromFile),
  });
}

/**
 * A binding with no AI (D1-11, OC7): the report bound to the query pinned,
 * written to `output` (else `<name>.bound.repx` beside it); nothing is
 * written when nothing could be bound, a declined input, exit 4.
 */
async function bindWork(run: Run, input: string): Promise<Omit<Row, 'input'>> {
  const database = databaseOf(run) as DatabaseInput;
  const ext = /\.vsrepx$/i.test(input) ? '.vsrepx' : '.repx';
  const done = await bindLayout(input, database, outTarget(run, `${stemOf(run, input)}.bound${ext}`, LAYOUT_EXTENSIONS)?.path, run.policy, run.layout());
  const d = done.data;
  const fields = { ...pick(d, [...READ_FIELDS, 'written', ...AUDIT_FIELDS]), binding: bindingField(d.bound, done.fromFile.binding) };
  const said = bindingLines(done.fromFile.binding, d.bound);
  // What was read of the layout first, on stderr, then what binding it did.
  const notes = [...done.layout.said, ...d.notices];
  if (!d.written) return { status: 'declined', lines: [`Nothing was written: ${q(d.path)} could not be bound.`, ...said], notes, fields, fromFile: { findings: done.fromFile.findings } };
  if (d.written.status === 'exists') return refusedWrite(d.written, fields, notes);
  return {
    status: writtenStatus(d.written, d.errors),
    lines: [`${wrote(d.written)} Bound with no AI. The result has ${done.words ?? 'no audit'}.`, ...said],
    notes,
    fields,
    fromFile: { findings: done.fromFile.findings },
  };
}

/**
 * What the AI's work tells as it goes, a line on stderr for each stage it
 * starts (never the answer's percent, which only a terminal could redraw);
 * the batch's lines indented under the file's own.
 */
function stageLines(run: Run, indent = ''): (event: GenEvent) => void {
  let last = '';
  return (event) => {
    if ('percent' in event) return;
    const said = STAGES[event.stage]?.message;
    if (said && said !== last) {
      last = said;
      run.err(`${indent}${said}`);
    }
  };
}

/** The AI's work: a thread of its own for each job (`fresh`), so each file of a batch is bounded on its own (OC2). */
function generatorFor(run: Run, settings: AiSettings): Generator {
  const setup: GenSetup = {
    mock: settings.mock,
    voice: 'cli',
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.locale ? { locale: settings.locale } : {}),
    ...(run.io.userFolder ? { userFolder: run.io.userFolder } : {}),
  };
  const log = (line: string) => {
    if (run.options.verbose) run.err(line);
  };
  return run.io.generator ? run.io.generator(setup, log) : workerGenerator({ setup, log, fresh: true });
}

/** The model that answered, for a plain line under --verbose. */
const modelNote = (data: { model: string | null; fixModel: string | null }) =>
  data.model ? `The model that answered: ${data.model}${data.fixModel ? `, and ${data.fixModel} for the fix kept` : ''}.` : null;

/** The output an AI call would write is there already and --force was not given: refused before the AI is asked, at no cost in quota. */
function alreadyThere(run: Run, target: string): Omit<Row, 'input'> | null {
  if (run.options.force || !run.sys.fs.lexists(target)) return null;
  return { status: 'exists', lines: [], notes: [], message: `${q(target)} is already there, so the AI was not asked and nothing was written; give --force to replace it, or another --out.`, fields: {} };
}

/* ------------------------------------------------------------ a database (the header's *A database*) */

/**
 * What a shell reads inside double quotes (PowerShell's `$` and backtick, cmd's `%`, bash's `!`), a quote, or a control
 * character; two backslashes together, which a POSIX shell reads as one inside quotes; or a backslash at the end, which
 * would escape the closing quote (in a POSIX shell, and in how Windows programs read their arguments): never put in a
 * line a person runs (the wave-5 review, BT-8).
 */
const SHELL_READS = /["$`%!\u0000-\u001f\u007f]|\\\\|\\$/;

/**
 * One argument of a command line as a person types it in PowerShell, cmd or a POSIX shell alike: plain, or in double
 * quotes. A backslash is always quoted (BT-8): unquoted, a POSIX shell (Git Bash, WSL) reads it as an escape, so a named
 * instance `db01\SQLEXPRESS` arrived as `db01SQLEXPRESS`; inside double quotes it keeps a backslash before anything but
 * `$`, a backtick, `"`, `\` and a line break, which `SHELL_READS` refuses.
 */
function shellArg(value: string): string {
  return /^[A-Za-z0-9_.:/-]+$/.test(value) ? value : `"${value}"`;
}

/**
 * The sqlcmd line that runs Forma's script and keeps every name readable
 * (D1-4): `-y 0` so the one cell is printed whole, with no heading line (the
 * wave-5 review measured sqlcmd 16 with ODBC 17 over LocalDB's FormaSample:
 * it refuses `-h` beside `-y 0`, "The -h and the -y 0 options are mutually
 * exclusive", exit 1 and no file, in every shell, and without `-h` it writes
 * the cell alone, a 1.9 MB layout of 1,205 tables whole); `-b`, so a script
 * SQL Server fails (a sample script naming a table that is not there: "Msg
 * 208, Invalid object name") ends sqlcmd with 1 rather than 0 with the error
 * written into the file; `-f 65001` so the file is UTF-8 whatever the
 * console's code page (without it, sqlcmd writes the computer's code page,
 * and a name in another script is lost, Arabic's to question marks); and
 * `-o`, never a shell's `>`, which Windows PowerShell 5.1 writes as UTF-16
 * after reading the output through the console's code page. Never `-W`,
 * which sqlcmd refuses beside `-y`. `-E` signs in with Windows, the person's
 * own sign-in; no password is ever on the line. Null when a value holds what
 * a shell would read inside quotes.
 */
export function sqlcmdLine(server: string, database: string, script: string, out: string): string | null {
  if ([server, database, script, out].some((v) => !v || SHELL_READS.test(v))) return null;
  return `sqlcmd -S ${shellArg(server)} -d ${shellArg(database)} -E -y 0 -b -f 65001 -i ${shellArg(script)} -o ${shellArg(out)}`;
}

/**
 * sql-script (D1-4, D1-6): Forma's read-only layout script, or with
 * `--sample` the script that reads a few rows of the tables named (lib's
 * `sampleScript`, which quotes every name), on stdout as it is, or written
 * to `--out`'s .sql file; with `--sqlcmd`, the line that runs it into a
 * .txt beside it, which `--database` (or `--samples`) then reads. Needs no
 * AI, opens no connection.
 */
async function sqlScriptCommand(run: Run): Promise<Row> {
  const { options, io } = run;
  const kind = options.sample ? 'sample rows' : 'layout';
  return attempt(run, options.out ?? 'stdout', async () => {
    const scripts = await import('../lib/sqlSchemaScript');
    const text = options.sample ? scripts.sampleScript(options.sample, options.rows) : scripts.SCHEMA_SCRIPT;
    const fields = { script: kind, ...(options.sample ? { sample: options.sample.map((t) => `${t.schema}.${t.name}`), rows: options.rows ?? scripts.SAMPLE_SCRIPT_ROWS } : {}) };
    if (options.out === undefined) {
      // The script itself, Forma's own text and the names the person gave, whole: never through the one-line `shown`.
      if (options.json) return { status: 'done', lines: [], notes: [], fields: { ...fields, text } };
      io.out(text);
      return { status: 'done', lines: [], notes: [], fields };
    }
    const target = resolveWritePath(options.out, run.scope, run.sys, { extensions: ['.sql'] });
    if (!target.ok) throw new ToolRefusal(`${target.reason} sql-script writes a .sql file.`);
    const output = target.path.replace(/\.sql$/i, '.txt');
    const line = options.sqlcmd ? sqlcmdLine(options.sqlcmd.server, options.sqlcmd.database, options.out, run.sys.path.join(run.sys.path.dirname(options.out), run.sys.path.basename(output))) : null;
    if (options.sqlcmd && !line) throw new UsageError('--sqlcmd: the server, the database or a file name holds a quote, a $, `, % or !, a control character, two backslashes together or a backslash at its end, which a shell reads inside quotes; type the sqlcmd line yourself.');
    const written = writeLayout(target.path, text, run.policy, io.signal);
    if (written.status === 'exists') return refusedWrite(written, { ...fields, written }, []);
    const lines = [`${wrote(written)} It reads the ${kind === 'layout' ? "database's layout" : 'rows of the tables named'}, and changes nothing.`];
    const notes: string[] = [];
    if (line) {
      lines.push(`Run it with sqlcmd, which writes ${q(output)}; then give that file to ${kind === 'layout' ? '--database' : '--samples'}:`, line);
      notes.push('-E signs in with your Windows account; for a SQL Server login, put -U <login> in its place, and sqlcmd asks for the password.');
    } else {
      notes.push(`Run it in SSMS and save the one cell it answers, or with sqlcmd: sql-script --sqlcmd <server> <database> --out ${q(options.out)} prints the line.`);
    }
    return { status: writtenStatus(written), lines, notes, fields: { ...fields, written, ...(line ? { sqlcmd: line, output } : {}) } };
  });
}

/**
 * The database the person gave, as the calls take it; undefined without one.
 * With --connection, the layout Forma Designer printed (read first, by
 * `connectionFirst`), and the report's connection named as Forma Designer
 * keeps it unless --connection-name names another (D2-10: a report written
 * with the database's own name was one Forma Designer could not connect).
 */
function databaseOf(run: Run): DatabaseInput | undefined {
  const o = run.options;
  if (o.connection !== undefined) {
    const f = run.fetched;
    if (!f) throw new Error('the connection was not read before its layout was used');
    return { layout: f.layout, samples: [...f.samples, ...o.samples], query: o.query, connectionName: o.connectionName ?? f.connection };
  }
  if (o.database === undefined) return undefined;
  return { layout: o.database, samples: o.samples, query: o.query, ...(o.connectionName !== undefined ? { connectionName: o.connectionName } : {}) };
}

/** Whether the person gave a database, as a file or a connection. */
const hasDatabase = (run: Run) => run.options.database !== undefined || run.options.connection !== undefined;

/** The database the person gave, as a row that refuses it names it. */
const databaseLabel = (run: Run) => run.options.database ?? (run.options.connection !== undefined ? `connection ${run.options.connection}` : '');

/**
 * The seconds each of Forma Designer's verbs is given from the command line,
 * which no client cuts short: ten minutes, where a page waits three for the
 * same layout (lib/sqlCompanion.ts) and Forma Designer's own default is two,
 * since a large database's layout describes what every procedure returns,
 * and a CI step is better served by a long wait than a failed one. A stop
 * (Ctrl+C) ends it at once, and Forma Designer ends itself at the deadline.
 */
export const DESIGNER_CLI_SECONDS = 600;

/** Forma Designer as the entry found it, or why it was not looked for. */
const designerOf = (run: Run): DesignerSetup => run.io.designer ?? { place: { ok: false, reason: 'Forma Designer was not looked for in this run.' }, env: {} };

/** The way on when Forma Designer cannot be used: the layout as a file. */
const LAYOUT_INSTEAD = "Give the database's layout as a file with --database instead: sql-script prints the script that reads it.";

/** What each of Forma Designer's refusals leaves the person to do (designerVerbs.ts `designerNext`), in the command line's words. */
const WAY_ON: Record<NonNullable<ReturnType<typeof designerNext>>, string> = {
  file: LAYOUT_INSTEAD,
  again: "Run the command again, or give the database's layout as a file with --database instead: sql-script prints the script that reads it.",
  check: "Check the connection in Forma Designer's tray menu, SQL Server connections, or give the database's layout as a file with --database instead: sql-script prints the script that reads it.",
};

/**
 * Forma Designer's refusals end with the way on (designerVerbs.ts
 * `designerNext`), as the header says and as the server's do
 * (databaseTools.ts): a layout file after one made before it answered
 * anything (not installed, older than 1.2.0, a link, a program that could
 * not be started or did not answer as Forma Designer does); running it
 * again, or the file, after a deadline; its connection in its tray menu, or
 * the file, after SQL Server refused, was not reached or failed. An answer
 * that says its own (no connection of that name) keeps it. Until the CLI
 * work's wave-8 end-to-end run, `connections` and `--connection` said "Forma
 * Designer is not installed for this Windows user" and stopped there, and
 * until its review (W8R-5) a deadline or SQL Server's words did.
 */
async function withWayOn<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const next = error instanceof DesignerRefusal ? designerNext(error) : null;
    if (error instanceof DesignerRefusal && next) throw new DesignerRefusal(`${error.message} ${WAY_ON[next]}`, error.problem, error.number, error.fromFile);
    throw error;
  }
}

/** A table or view as a line names it. */
const objectName = (t: SampleTarget) => `${t.schema}.${t.name}`;

/**
 * --connection's layout, and --sample-objects' rows, read through Forma
 * Designer once, before anything else reads the database (the header's
 * *Forma Designer's connections*): on this thread, before any job starts, so
 * no worker thread ever starts a program (D2-6), and said on stderr, never a
 * value (OC6). Null when read; else the input's refused row, exit 4.
 */
async function connectionFirst(run: Run, label: string): Promise<Row | null> {
  const name = run.options.connection;
  if (name === undefined || run.fetched) return null;
  const row = await attempt(run, label, async () => {
    const setup = designerOf(run);
    if (!setup.place.ok) throw new ToolRefusal(`${setup.place.reason} ${LAYOUT_INSTEAD}`);
    const objects = run.options.sampleObjects;
    const rows = run.options.rows ?? SAMPLE_SCRIPT_ROWS;
    run.err(
      `Reading the layout of the connection ${name}${objects ? `, and ${n(rows, 'row')} of each of ${objects.map(objectName).join(', ')}, whose values go to the AI with it,` : ''} through Forma Designer, within ${n(DESIGNER_CLI_SECONDS / 60, 'minute')} for each.`,
    );
    const read = await withWayOn(designerRead(setup, name, { voice: 'cli', signal: run.io.signal, seconds: DESIGNER_CLI_SECONDS, log: (line) => run.options.verbose && run.err(line) }, objects ? { objects, rows } : undefined));
    // A table SQL Server could not read is left out, the rest sent (R6-2): said by name and number, never SQL Server's words.
    for (const u of read.unread) {
      run.err(`SQL Server could not read sample rows of ${u.object}${u.number === null ? '' : ` (its error ${u.number})`}, so its rows were left out.`);
    }
    // A table or view the database does not have, which Forma Designer leaves out with no word (the wave-7 review's W7-MCP-4).
    for (const name of read.notFound) run.err(`The database has no table or view named ${name}, so no rows of it were read.`);
    // The name what is read is said under: the connection's, as Forma Designer keeps it, never a file's.
    const as = `${read.connection} in Forma Designer`;
    const bytes = (text: string) => new TextEncoder().encode(text);
    run.fetched = { connection: read.connection, layout: { name: as, bytes: bytes(read.layout) }, samples: read.samples === null ? [] : [{ name: as, bytes: bytes(read.samples) }] };
    return { status: 'done', lines: [], notes: [], fields: {} };
  });
  return row.status === 'done' ? null : row;
}

/**
 * connections: the SQL Server connections Forma Designer keeps for this
 * Windows user (`sql-list`), each by name with its database and how it signs
 * in, never a server or a secret, which Forma Designer never prints. Opens
 * no connection; needs no AI.
 */
async function connectionsCommand(run: Run): Promise<Row> {
  return attempt(run, 'Forma Designer', async () => {
    const setup = designerOf(run);
    if (!setup.place.ok) throw new ToolRefusal(`${setup.place.reason} ${LAYOUT_INSTEAD}`);
    const list = await withWayOn(designerConnections(setup, { voice: 'cli', signal: run.io.signal, log: (line) => run.options.verbose && run.err(line) }));
    // Each line begins with Forma's own word, never a name from the store; one --connection cannot name is said so (N6-6).
    const lines = list.length
      ? list.map((c) => `connection ${c.name}: database ${c.database}, signing in ${c.signIn === 'windows' ? 'with Windows' : 'with a saved SQL Server login'}${c.usable ? '' : '; its name begins with . or -, so --connection cannot name it'}`)
      : ['Forma Designer keeps no SQL Server connection for this Windows user. Add one from its tray menu, SQL Server connections.'];
    const notes = list.some((c) => !c.usable) ? [`A connection whose name begins with . or - was kept by an older Forma Designer. ${RENAME_TO_USE}`] : [];
    return { status: 'done', lines, notes, fields: { connections: list } };
  });
}

/** What a query reads, in words: a stored procedure, a SQL query by its name, or a table or view with what it joins. */
export function queryWords(q: QueryJson): string {
  if (q.procedure) return `the stored procedure ${q.procedure}`;
  if (q.sql) return `the SQL query ${q.name || 'Query'}`;
  const joins = (q.joins ?? []).map((j) => j.table).filter(Boolean);
  const details = (q.details ?? []).map((d) => d.table).filter(Boolean);
  return `${q.table ?? q.object ?? 'a table'}${joins.length ? ` with ${joins.join(', ')}` : ''}${details.length ? `, each with its ${details.join(', ')}` : ''}`;
}

/**
 * A binding as lines under an input's result: what the report reads, on which connection, its parameters and what was
 * left out, or why it is not bound; then what else the binding says (its `notes`: a connection Forma Designer cannot fill,
 * the wave-5 review's BT-7 and W5-PB-12, said under every command that binds, a connection kept, fields renamed, a
 * detail report moved or removed).
 */
export function bindingLines(binding: BindingText | undefined, bound: boolean | null | undefined): string[] {
  if (bound === null || bound === undefined || !binding) return [];
  const notes = (binding.notes ?? []).map((note) => `  ${note}`);
  if ('reason' in binding) return [`  not bound to ${binding.database || 'the database'}: ${binding.reason}`, ...notes];
  const n = binding.parameters.length;
  const parameters = n ? `, the report parameter${n === 1 ? '' : 's'} ${binding.parameters.join(', ')}` : '';
  return [`  bound to ${queryWords(binding.query)} on connection "${binding.connection}"${parameters}`, ...binding.leftOut.map((part) => `  left out ${part}`), ...notes];
}

/** A binding as an input's JSON line carries it (D1-9): whether bound, then what it reads or why not; null without a database. */
const bindingField = (bound: boolean | null | undefined, text: BindingText | undefined) => (bound === null || bound === undefined ? null : { bound, ...(text ?? {}) });

/** Text read from files, without the binding, which a row carries as its own field and lines. */
const withoutBinding = <T extends object>(fromFile: T): T => Object.fromEntries(Object.entries(fromFile).filter(([k]) => k !== 'binding')) as T;

/**
 * The layout read before any AI is asked or any report made (D1-3, D1-7), in
 * the pipeline's bounded thread: what was read said on stderr (the database
 * and its objects, each file of sample rows by its tables and counts, never a
 * value: OC6), what was not, and what the report is to read when a query was
 * pinned. Null when read; else the input's refused row.
 */
async function layoutFirst(run: Run, label: string): Promise<Row | null> {
  const fetched = await connectionFirst(run, label);
  if (fetched) return fetched;
  const database = databaseOf(run);
  if (!database) return null;
  const checked = await attempt(run, label, async () => {
    const read = await readLayout(database, run.policy, run.layout());
    for (const line of [...read.said, ...read.notices]) run.err(line);
    if (read.query) run.err(`The report is to read ${queryWords(read.query)}.`);
    return { status: 'done', lines: [], notes: [], fields: {} };
  });
  return checked.status === 'done' ? null : checked;
}

/** With --require-binding, a report written but not bound to the database given ends its input with 4 (D1-9). */
function requiredBound(run: Run, row: Omit<Row, 'input'>): Omit<Row, 'input'> {
  if (!run.options.requireBinding || (row.status !== 'done' && row.status !== 'errors') || !row.fields.written) return row;
  const binding = row.fields.binding as { bound?: boolean } | null | undefined;
  if (binding?.bound) return row;
  return { ...row, status: 'unbound', message: `The report was written, but it is not bound to the database given (--require-binding).` };
}

/** What a generate makes, for generate and for each picture and PDF of a batch. */
interface GenerateSpec {
  label: string;
  /** The sources, as the call judges them; `shown`, as a line names them. */
  files: string[];
  shown: string[];
  description?: string;
  data: string[];
  output?: string;
  draft?: string;
  policy: Run['policy'];
  /** generate's own look for its output before the AI is asked; the batch looks itself, by its own rule. */
  lookFirst: boolean;
  indent?: string;
  /** Said before the result's notices: the batch's word on an SSRS file that would not convert. */
  first?: string[];
}

/** A report from files and/or words, by the AI set up: the work of one row, its failures thrown for `attempt`. */
async function generateWork(run: Run, spec: GenerateSpec, settings: AiSettings, generator: Generator): Promise<Omit<Row, 'input'>> {
  const { options } = run;
  const database = databaseOf(run);
  const plan = await planGenerate(
    { description: spec.description, files: spec.files, data: spec.data, output: spec.output, ...(database ? { database } : {}) },
    spec.policy,
    { standIn: options.allowStandIn, ...(spec.draft ? { draft: spec.draft } : {}) },
  );
  const there = spec.lookFirst ? alreadyThere(run, plan.target) : null;
  if (there) return there;
  const tell = stageLines(run, spec.indent);
  tell({ stage: 'starting' });
  const made = await runGenerate(plan, { ai: { settings, generator }, signal: run.io.signal, tell, redact: run.io.redact });
  const d = made.data;
  const how = d.standIn
    ? "Forma's own draft stands in for the AI, which did not make the report"
    : `Made by ${answeredBy(d.ai, 'cli')}${d.switched ? ', which answered on a limit of the AI chosen' : ''}`;
  const printed = d.printFindings.length ? `; printing it found ${n(d.printFindings.length, 'problem')}` : '';
  const notes = [...(spec.first ?? []), ...d.notices];
  if (d.limit) notes.push(`${limitWords(d.limit)}${d.standIn ? '' : ' The report written is the one before the step it kept from being asked.'}`);
  if (made.fromFile.aiError) notes.push(`Why the AI made no report: ${made.fromFile.aiError}`);
  const model = options.verbose ? modelNote(d) : null;
  const fields = {
    files: spec.shown,
    data: options.data,
    ...pick(d, ['written', 'standIn', 'switched', 'notices', 'pictures', 'errors', 'warnings', 'summary', 'findings', 'printFindings', 'translated']),
    notices: [...(spec.first ?? []), ...d.notices],
    provider: d.ai,
    model: d.model,
    fixModel: d.fixModel,
    limit: d.limit,
    ...(database || options.data.length ? { binding: bindingField(d.bound, made.fromFile.binding) } : {}),
  };
  if (d.written.status === 'exists') return refusedWrite(d.written, fields, notes);
  return requiredBound(run, {
    // Forma's draft standing in is the draft's status, exit 4 whatever its audit: the report asked for was not made (CLI-4).
    status: d.standIn ? 'draft' : writtenStatus(d.written, d.errors),
    lines: [`${wrote(d.written)} ${how}. The report has ${made.auditWords ?? 'no audit'}${printed}.`, ...(model ? [model] : []), ...bindingLines(made.fromFile.binding, d.bound)],
    notes,
    fields,
    fromFile: pick(made.fromFile, ['findings', 'printed', 'standInFonts', 'aiError']),
  });
}

/** generate: a report from files and/or words, by the AI set up. */
async function generateCommand(run: Run, settings: AiSettings, generator: Generator): Promise<Row> {
  const { options, sys } = run;
  const first = run.inputs[0];
  const label = first ?? 'the description';
  // A data file named as a source is the person's slip, said with where it goes (U13), before anything is read.
  const asData = run.inputs.find((raw) => {
    const ext = sys.path.extname(raw).toLowerCase();
    return (DATA_EXTENSIONS as readonly string[]).includes(ext) && !(SOURCE_EXTENSIONS as readonly string[]).includes(ext);
  });
  if (asData !== undefined) throw new UsageError(`${q(asData)} is a data file, whose columns become the report's fields: give it with --data ${q(asData)}, beside a picture, a PDF, a report or --description.`);
  const out = outTarget(run, first === undefined ? null : `${stemOf(run, first)}.generated.repx`, ['.repx']);
  const draft = !options.allowStandIn
    ? undefined
    : out
      ? out.folder !== null
        ? sys.path.join(out.folder, `${first === undefined ? stemOf(run, out.path) : stemOf(run, first)}.draft.repx`)
        : besideName(out.path, '.draft.repx', sys)
      : besideName(first, '.draft.repx', sys);
  const spec: GenerateSpec = { label, files: run.inputs, shown: run.inputs, description: options.description, data: options.data, output: out?.path, draft, policy: run.policy, lookFirst: true };
  // The database read and said first, so a wrong one costs no request (D1-3, D1-7).
  const refused = await layoutFirst(run, label);
  if (refused) return refused;
  return attempt(run, label, () => generateWork(run, spec, settings, generator));
}

/** revise: a change in words to a report, by the AI set up. */
async function reviseCommand(run: Run, settings: AiSettings, generator: Generator): Promise<Row> {
  const input = run.inputs[0];
  const refused = await layoutFirst(run, input);
  if (refused) return refused;
  return attempt(run, input, async () => {
    const output = outTarget(run, `${stemOf(run, input)}.revised.repx`, ['.repx'])?.path;
    // No look for the output before the AI is asked, as generate has: a question is answered with nothing written, so only
    // the write can say whether the name was wanted.
    const database = databaseOf(run);
    const plan = await planRevise({ path: input, request: run.options.words ?? '', output, editsOnly: run.options.editsOnly, ...(database ? { database } : {}) }, run.policy);
    return reviseWork(run, plan, settings, generator);
  });
}

/**
 * What a batch writes when its words change nothing in a report, so its
 * `--out` holds every report it was given and a rerun with --skip-existing
 * asks the AI nothing again (U1): the report as it reads (layoutCalls.ts
 * `copyLayout`), or an SSRS or FastReport report as converted, which the
 * conversion would otherwise lose.
 */
interface Kept {
  converted: boolean;
  write(): Promise<{ written: { path: string; status: WriteStatus; bytes: number }; notices: string[]; audit: Audited }>;
}

/** A change in words to a report judged (`plan`), by the AI set up: the work of one row, its failures thrown for `attempt`. */
async function reviseWork(run: Run, plan: RevisePlan<'refuse' | 'replace'>, settings: AiSettings, generator: Generator, indent = '', first: string[] = [], keep?: Kept, label?: string): Promise<Omit<Row, 'input'>> {
  const tell = stageLines(run, indent);
  tell({ stage: 'starting' });
  const made = await runRevise(plan, { ai: { settings, generator }, signal: run.io.signal, tell, redact: run.io.redact });
  const d = made.data;
  const at = q(d.path);
  const by = answeredBy(d.ai, 'cli');
  const notes = [...first, ...d.notices, ...(d.limit ? [`${limitWords(d.limit)} The change written is the one before the step it kept from being asked.`] : [])];
  const model = run.options.verbose ? modelNote(d) : null;
  const fields = {
    ...pick(d, [...READ_FIELDS, 'action', 'written', 'applied', 'declined', 'switched', 'translated', ...AUDIT_FIELDS]),
    notices: [...first, ...d.notices],
    provider: d.ai,
    model: d.model,
    fixModel: d.fixModel,
    limit: d.limit,
    ...(plan.database ? { binding: bindingField(d.bound, made.fromFile.binding) } : {}),
  };
  const bindingSaid = bindingLines(made.fromFile.binding, d.bound);
  const fromFile = withoutBinding(made.fromFile);
  if (d.written?.status === 'exists') return refusedWrite(d.written, fields, notes);
  if (!d.written && keep && (d.action === 'unchanged' || d.action === 'answer')) {
    const kept = await keep.write();
    const keptFields = { ...fields, written: kept.written, kept: keep.converted ? 'as converted' : 'as it reads', ...kept.audit.data };
    const keptNotes = [...notes, ...kept.notices];
    if (kept.written.status === 'exists') return refusedWrite(kept.written, keptFields, keptNotes);
    const what = keep.converted ? `the report converted from ${q(label ?? d.path)} is written as converted` : `${q(label ?? d.path)} is written as it reads`;
    const why = d.action === 'unchanged' ? 'Nothing needed changing, so' : `The request was answered by ${by} rather than carried out, so`;
    return requiredBound(run, {
      status: writtenStatus(kept.written, kept.audit.data.errors),
      lines: [`${wrote(kept.written)} ${why} ${what}; the result has ${kept.audit.words}.${d.action === 'answer' ? ' The answer:' : ''}`, ...(model ? [model] : []), ...bindingSaid],
      notes: keptNotes,
      fields: keptFields,
      fromFile: { ...fromFile, findings: kept.audit.lines },
    });
  }
  let status: Status;
  let line: string;
  if (!d.written) {
    const said: Record<string, [Status, string]> = {
      answer: ['done', `Answered about ${at} by ${by}; nothing was written. The answer:`],
      unchanged: ['done', `Nothing needed changing in ${at}: it already reads that way, so nothing was written.`],
      new: ['declined', `The request asks for a different report rather than a change to ${at}, so nothing was written; run generate with what it asks for:`],
      rebuild: ['declined', `Nothing was written for ${at}: the change would take a redesign of the whole report, which --edits-only declines.`],
    };
    [status, line] = said[d.action] ?? ['declined', `Nothing was written for ${at}.`];
  } else {
    status = writtenStatus(d.written, d.errors);
    const what = d.action === 'rebuild' ? `The report was redesigned by ${by}` : `${n(d.applied, 'edit')} made${d.declined ? `, ${d.declined} declined` : ''} by ${by}`;
    line = `${wrote(d.written)} ${what}. The result has ${made.auditWords ?? 'no audit'}.`;
  }
  // The binding said under a report written; with nothing written its JSON line still carries the report's as it reads.
  return requiredBound(run, { status, lines: [line, ...(model ? [model] : []), ...(d.written ? bindingSaid : [])], notes, fields, fromFile });
}

/**
 * Prints the run's summary: a line on stdout when there was more than one
 * input, and the summary object under --json. `planned` counts every input
 * the run meant to work on, so those a stop left are said as not started.
 */
function summarize(run: Run, code: number, planned: number, message?: string): void {
  const counts = Object.fromEntries((Object.keys(COUNTED) as Status[]).map((s) => [s, run.rows.filter((r) => r.status === s).length])) as Record<Status, number>;
  // Those a stop left are not started too: a batch's files the AI's stop left are rows of their own (U4), the rest only counted.
  counts.notStarted += Math.max(0, planned - run.rows.length);
  const inputs = Math.max(planned, run.rows.length);
  const batch = run.batch ? batchSummary(run, run.batch) : null;
  if (run.options.json) {
    run.out(JSON.stringify(scrubbed({ type: 'summary', command: run.command, inputs, ...counts, exitCode: code, ...(message ? { message } : {}), ...(batch?.fields ?? {}) }, run.io.redact)));
    return;
  }
  if (inputs <= 1 && !batch) return;
  const parts = (Object.keys(COUNTED) as Status[]).filter((s) => counts[s]).map((s) => `${counts[s]} ${COUNTED[s]}`);
  run.out(`${n(inputs, 'input')}: ${parts.join(', ') || 'none made'}.`);
  for (const line of batch?.lines ?? []) run.out(line);
}

/** What a batch's summary adds: who answered, the time, why it stopped, the bounds each file had, and what the walk left out. */
function batchSummary(run: Run, facts: BatchFacts): { fields: Record<string, unknown>; lines: string[] } {
  const now = (run.io.now ?? Date.now)();
  const tally = (key: 'provider' | 'model') => {
    const counts: Record<string, number> = {};
    for (const row of run.rows) {
      const value = row.fields[key];
      if (typeof value === 'string' && value) counts[value] = (counts[value] ?? 0) + 1;
    }
    return counts;
  };
  const providers = tally('provider');
  const models = tally('model');
  const stop = run.stopped;
  const stopped = stop ? (stop.why === 'key' ? 'key' : stop.limit.kind === 'daily' ? 'daily-limit' : 'limit') : run.io.signal.aborted ? 'interrupted' : null;
  const resetsAt = stop?.why === 'limit' && stop.limit.waitMs !== null ? new Date(now + stop.limit.waitMs).toISOString() : null;
  const ms = Math.max(0, now - facts.started);
  const limits = {
    ai: { minutes: Math.round(GEN_LIMITS.deadlineMs / 60_000), heapMb: GEN_LIMITS.heapMb },
    layout: { seconds: PIPELINE_LIMITS.deadlineMs / 1000, heapMb: PIPELINE_LIMITS.heapMb },
  };
  // With a database, how many reports written are bound to it (D1-9), each file's on its own.
  const bindings = run.rows.map((r) => r.fields.binding as { bound?: boolean } | null | undefined).filter((b) => b !== undefined);
  const bound = hasDatabase(run) ? { bound: bindings.filter((b) => b?.bound).length, unbound: bindings.filter((b) => !b?.bound).length } : null;
  const fields = { routes: facts.routes, providers, models, seconds: Math.round(ms / 1000), stoppedBy: stopped, resetsAt, limits, leftOut: facts.leftOut, ...(bound ? { binding: bound } : {}) };
  const lines: string[] = [];
  if (bound) lines.push(`Bound to the database: ${bound.bound} of ${bindings.length} report${bindings.length === 1 ? '' : 's'} made.`);
  const files = (count: number) => n(count, 'file');
  const said = Object.entries(providers).map(([p, count]) => `${p === 'mock' ? 'the mock invoice' : (PROVIDER_NAMES[p as keyof typeof PROVIDER_NAMES] ?? p)} (${files(count)})`);
  if (said.length) lines.push(`Answered by: ${said.join(', ')}.`);
  if (run.options.verbose && Object.keys(models).length) lines.push(`The models that answered: ${Object.entries(models).map(([m, count]) => `${m} (${files(count)})`).join(', ')}.`);
  if (stop?.why === 'limit') {
    // In words and the clock's time in UTC for a person; the summary object keeps the instant itself (U12).
    const lifts = stop.limit.waitMs === null ? '' : `, which lifts in about ${lasting(stop.limit.waitMs)} (${new Date(now + stop.limit.waitMs).toISOString().slice(11, 16)} UTC)`;
    lines.push(`Stopped at an AI limit${lifts}; the same command with --skip-existing carries on.`);
  }
  if (stopped === 'key') lines.push('Stopped: the AI refused the key.');
  lines.push(`Took about ${lasting(ms)}${facts.askedAi ? `; each file that asked the AI ran in a thread of its own, with at most ${limits.ai.minutes} minutes and ${limits.ai.heapMb} MB of memory` : ''}.`);
  return { fields, lines };
}

/**
 * The inputs a command works on, each a row as it finishes: an AI command's
 * one, behind the gate; a report command's one, or audit's and convert's
 * every report named or found directly in a folder named; the batch's every
 * file its walk found. Returns how many were planned; a stop leaves the rest
 * not started.
 */
async function work(run: Run, setGenerator: (g: Generator) => void): Promise<number | 'no AI' | 'planned only'> {
  // A connection name that cannot be written is the person's slip, said before anything else and never repeated (D1-5).
  if (run.options.connectionName !== undefined) {
    const problem = (await import('../lib/databaseAi')).connectionNameProblem(run.options.connectionName);
    if (problem) throw new UsageError(problem);
  }
  // A Forma Designer connection's name by its own rule, before anything starts (SEC-2): no name it could keep reads as a switch.
  if (run.options.connection !== undefined && !(await import('../lib/databaseAi')).DESIGNER_NAME.test(run.options.connection)) {
    // A name Forma Designer 1.1.0 kept may begin with . or -, which connections lists as one to add again (N6-6): say how here too.
    const older = /^[.-][A-Za-z0-9_.-]{0,127}$/.test(run.options.connection) ? ` A connection kept under such a name by an older Forma Designer cannot be read until it is renamed: ${RENAME_TO_USE}` : ' connections lists the names it keeps.';
    throw new UsageError(`--connection names a connection Forma Designer keeps, whose name begins with a letter, a digit or _, and holds only letters, digits, _, . and -, at most 128; ${quoted(run.options.connection.replace(UNSAFE_IN_LINE, '?'))} is not one.${older}`);
  }
  if (run.command === 'batch') return batchCommand(run, setGenerator);
  if (run.command === 'generate' || run.command === 'revise') {
    // The gate before any file is read, so a run with no AI costs nothing and says what to set (GAP1-2, CLI-7).
    const settings = gate(run);
    if (!settings) return 'no AI';
    const generator = generatorFor(run, settings);
    setGenerator(generator);
    emit(run, run.command === 'generate' ? await generateCommand(run, settings, generator) : await reviseCommand(run, settings, generator));
    return 1;
  }
  if (run.command === 'sql-script') {
    emit(run, await sqlScriptCommand(run));
    return 1;
  }
  if (run.command === 'connections') {
    emit(run, await connectionsCommand(run));
    return 1;
  }
  // bind reads its layout in its own call: a connection's is read first, so a refused one costs no report read.
  if (run.command === 'bind') {
    const refused = await connectionFirst(run, run.inputs[0]);
    if (refused) {
      emit(run, refused);
      return 1;
    }
  }
  const planned: string[] = [];
  for (const raw of run.inputs) {
    const found = run.command === 'audit' || run.command === 'convert' ? folderInputs(run, raw, run.command) : [raw];
    if (Array.isArray(found)) planned.push(...found);
    else emit(run, found);
  }
  // convert's database read and said once, before its first file; each conversion reads it again in its own thread.
  if (run.command === 'convert' && planned.length) {
    const refused = await layoutFirst(run, databaseLabel(run));
    if (refused) {
      emit(run, refused);
      return run.rows.length + planned.length;
    }
  }
  if (run.command === 'convert' && planned.length > 1 && run.options.out !== undefined && outTarget(run, 'x', ['.repx'])?.folder === null) {
    throw new UsageError(`--out names one file, but ${planned.length} reports are converted; name a folder, ending it with a separator if it is not there yet.`);
  }
  const total = run.rows.length + planned.length;
  for (const input of planned) {
    if (run.io.signal.aborted) break;
    emit(run, await layoutCommand(run, input));
  }
  return total;
}

/** The AI's settings when the AI chosen is ready; else the setup's words said (and the summary under --json), and null. */
function gate(run: Run): AiSettings | null {
  const settings = readAiSettings(run.io.aiEnv, { voice: 'cli', mock: run.options.mock });
  if (settings.ready) return settings;
  run.err(notReadyMessage(settings));
  if (run.options.json) summarize(run, EXIT.noAi, 0, notReadyMessage(settings));
  return null;
}

/** What a batch's summary reports of its plan and its walk. */
interface BatchFacts {
  routes: Partial<Record<Route, number>>;
  leftOut: { links: number; outputs: number; other: number; deep: number; unreadable: number };
  /** Whether any file's route asks the AI. */
  ai: boolean;
  /** Whether any file did ask it, so the summary says its bounds only then (U12). */
  askedAi: boolean;
  started: number;
}

/** Said when a file that asked the AI is stopped under way. */
const STOPPED = 'Stopped: the report under way was not written.';

/**
 * The batch (folderBatch.ts's header): the folder walked once, every route
 * and name decided, the AI's gate only when a route needs it, then one file
 * at a time, each that asks the AI in a thread of its own (`fresh`, OC2),
 * the kept parks read before it (modelParks.ts `keyParked`), a minute's
 * limit waited out and the file made once more, the day's limit or the key
 * refused stopping the rest (OC5, GAP3-3).
 */
async function batchCommand(run: Run, setGenerator: (g: Generator) => void): Promise<number | 'no AI' | 'planned only'> {
  const { io, options, sys } = run;
  const raw = run.inputs[0];
  const outRaw = options.out as string;
  const folder = resolveFolderPath(raw, run.scope, sys);
  if (!folder.ok) {
    emit(run, failedRow(raw, 'refused', `${folder.reason} batch takes a folder.`));
    return 1;
  }
  // The out folder, a relative name the working folder's, judged for a write before anything is listed.
  const outParsed = parsePath(outRaw, run.scope, sys);
  const probe = outParsed.ok ? resolveWritePath(sys.path.join(outParsed.path, 'forma-batch.repx'), run.scope, sys, { extensions: ['.repx'] }) : outParsed;
  if (!probe.ok) {
    emit(run, failedRow(outRaw, 'refused', `${probe.reason} --out names the folder the reports go in.`));
    return 1;
  }
  const out = sys.path.dirname(probe.path);
  if (sys.fs.lexists(out) && !sys.fs.stat(out).isDirectory()) {
    emit(run, failedRow(outRaw, 'refused', `${q(out)} is a file; --out names the folder the reports go in.`));
    return 1;
  }
  const walked = walkBatch(folder.path, { path: sys.path, ...(io.list ? { list: io.list } : {}), skip: [out] });
  const items = planBatch(walked.files, folder.path, out, sys.path, { words: Boolean(options.words), repair: options.repair, allowStandIn: options.allowStandIn });
  const making = items.filter((i) => i.route !== 'skip');
  if (making.length > options.max) {
    throw new UsageError(`${q(raw)} holds ${making.length} files a batch makes, more than ${options.max}; give --max ${making.length} to make them all, or a smaller folder.`);
  }
  tellLeftOut(run, walked);
  if (!items.length) {
    emit(run, failedRow(raw, 'refused', `${q(folder.path)} holds no file a batch makes (a picture, a PDF, a report, an SSRS or FastReport report) in it or its subfolders, so nothing was made.`));
    return 1;
  }
  const routes: Partial<Record<Route, number>> = {};
  for (const item of items) routes[item.route] = (routes[item.route] ?? 0) + 1;
  const ai = items.some((i) => i.needsAi);
  const leftOut = { links: walked.links.length, outputs: walked.outputs, other: walked.other, deep: walked.deep.length, unreadable: walked.unreadable.length };
  // Every output and draft judged before any file is read, in the working folder's mode, as every path of the command line is:
  // no link the folder the command runs in holds is followed out of it, under --out or anywhere else (SEC-1, SEC-W4-1). The
  // batch's own files are judged at their turn in its folder's mode (`makeItem`).
  const judged = new Map(items.map((item) => [item, judgeNames(item, run.scope, sys)] as const));
  const label = (item: BatchItem) => sys.path.join(raw, item.rel);
  if (options.dryRun) {
    printPlan(run, items, judged, label, { routes, leftOut });
    return 'planned only';
  }
  const facts: BatchFacts = { routes, leftOut, ai, askedAi: false, started: (io.now ?? Date.now)() };
  run.batch = facts;
  // The gate only when a route asks the AI, and before any file is read (GAP1-2).
  const settings = ai ? gate(run) : null;
  if (ai && !settings) return 'no AI';
  // Each data file judged once, before the first file, in the working folder's mode (SEC-W4-1): a link out of it on the way to
  // one is refused as the single commands refuse it, and its real path is what each file's call is handed.
  const data: string[] = [];
  for (const given of options.data) {
    try {
      data.push(judgeInput(given, DATA_EXTENSIONS, run.scope, sys).path);
    } catch (error) {
      if (!(error instanceof ToolRefusal)) throw error;
      emit(run, failedRow(given, 'refused', `${error.message} --data names a data file every picture and PDF of the batch is made with.`));
      return 1;
    }
  }
  // The database read and said once, before the first file (D1-3, D1-7); each file's job reads it again and builds a step of
  // its own, so no file's query carries to the next (D1-9), a departure from browser Batch, which shares no database.
  const refusedDb = await layoutFirst(run, databaseLabel(run));
  if (refusedDb) {
    emit(run, refusedDb);
    return 1;
  }
  const generator = settings ? generatorFor(run, settings) : null;
  if (generator) setGenerator(generator);
  const sleep = io.sleep ?? sleepFor;
  const userFolder = io.userFolder ?? formaUserFolder();
  // Only a Gemini key with no model pinned, no mock and no other AI behind it is parked, so only then can the parks say it is spent.
  const parksSay = settings && !settings.mock && settings.provider === 'gemini' && !settings.model && settings.config.customApiKey && !fallbacksFor(settings.config).length ? settings.config.customApiKey : null;
  const counts = Object.entries(routes).filter(([route]) => route !== 'skip').map(([route, count]) => `${count} to ${ROUTE_WORDS[route as Route]}`);
  run.err(
    `Making ${n(making.length, 'file')} of ${q(raw)} one at a time${counts.length ? `: ${counts.join(', ')}` : ''}.${ai ? ` Each that asks the AI runs in a thread of its own, with at most ${Math.round(GEN_LIMITS.deadlineMs / 60_000)} minutes and ${GEN_LIMITS.heapMb} MB of memory.` : ''}`,
  );
  const ctx: ItemContext = { settings, generator, policy: run.policy, inside: { base: folder.path }, data };
  let waitFirst = 0;
  /** How many files of those the batch makes have had their turn, for the progress line's number (U12). */
  let turn = 0;
  /** Whether a file that asks the AI comes after the one at `at`: only then is a stop said. */
  const aiAfter = (at: number) => items.slice(at + 1).some((i) => i.needsAi);
  for (let at = 0; at < items.length; at++) {
    if (io.signal.aborted) break;
    const item = items[at];
    const name = label(item);
    const names = judged.get(item);
    if (item.route === 'skip' || !names) {
      emit(run, routed(item, failedRow(name, 'skipped', skipWords(item.skip ?? 'nothing asked', name))));
      continue;
    }
    turn += 1;
    // A name the path rules refuse is said at once, before any wait for the AI.
    const refusedName = !names.target.ok ? names.target.reason : names.draft && !names.draft.ok ? names.draft.reason : null;
    if (refusedName) {
      emit(run, routed(item, failedRow(name, 'refused', refusedName)));
      continue;
    }
    // A report already made: left with --skip-existing, so a rerun carries on; else refused, at no cost in quota (CLI-6).
    if (names.target.ok && sys.fs.lexists(names.target.path) && !options.force) {
      emit(
        run,
        routed(
          item,
          options.skipExisting
            ? failedRow(name, 'skipped', `${q(name)} is made already, at ${q(names.target.path)}, so it was skipped (--skip-existing).`)
            : failedRow(name, 'exists', `${q(names.target.path)} is already there, so ${q(name)} was not made again; give --skip-existing to carry on past what is made, or --force to make it again.`),
        ),
      );
      continue;
    }
    // Stopped at the AI's limit or by its refusing the key: each file that asks it is listed as not started (OC5, U4), while
    // those that need none are still made; one made already or refused by name is said as that, since it would be all the same.
    if (run.stopped && item.needsAi) {
      emit(run, notStartedRow(run, item, name));
      continue;
    }
    if (item.needsAi) {
      if (waitFirst) {
        run.err(`Waiting about ${lasting(waitFirst)} for the AI's limit to lift before ${q(name)}.`);
        await sleep(waitFirst, io.signal);
        waitFirst = 0;
        if (io.signal.aborted) break;
      }
      // The parks the threads before this one kept (modelParks.ts): a day's limit stops here without a request Google would refuse.
      const parked = parksSay ? keyParked(userFolder, parksSay, (io.now ?? Date.now)()) : null;
      if (parked) {
        const next = afterLimit(parked, true, false);
        if (next.stop) {
          run.stopped = { why: 'limit', limit: parked };
          run.err(`${limitWords(parked)} Every model the key can call is spent until then, so the batch stopped before asking again.`);
          tellStop(run, true);
          emit(run, notStartedRow(run, item, name));
          continue;
        }
        run.err(`${limitWords(parked)} Every model the key can call is resting until then, so the batch waits before ${q(name)}.`);
        await sleep(next.waitMs, io.signal);
        if (io.signal.aborted) break;
      }
    }
    // Numbered among the files the batch makes, as the line before the first said them (U12).
    run.err(`[${turn}/${making.length}] ${ROUTE_WORDS[item.route]} ${q(name)}`);
    let row = await makeItem(run, item, name, names, ctx);
    // A limit (OC5, GAP3-2): a minute's waited out and the file made once more; the day's, or a second, stops the batch.
    for (let tries = 1; ; tries++) {
      const limit = row.fields.limit as AiLimit | null | undefined;
      if (!item.needsAi || !limit || io.signal.aborted) break;
      const next = afterLimit(limit, row.status !== 'limit', tries > 1);
      if (next.stop) {
        // Kept as the batch's end only when it ends something: this file, or one after it that asks the AI.
        if (row.status === 'limit' || aiAfter(at)) run.stopped = { why: 'limit', limit };
        break;
      }
      if (!next.retry) {
        waitFirst = next.waitMs;
        break;
      }
      run.err(`${limitWords(limit)} Waiting about ${lasting(next.waitMs)}, then making ${q(name)} once more.`);
      await sleep(next.waitMs, io.signal);
      if (io.signal.aborted) {
        row = failedRow(name, 'stopped', STOPPED);
        break;
      }
      row = await makeItem(run, item, name, names, ctx);
    }
    // A file refused before its thread started asked nothing of the AI.
    if (item.needsAi && row.status !== 'refused') facts.askedAi = true;
    emit(run, routed(item, row));
    // The AI refusing the key: every file after this one would fail the same way (browser Batch's rule, GAP3-3), told by the AI's
    // own failure (`keyRefused`), never by a file's name (SEC-W4-3); Local AI has no key.
    if (item.needsAi && row.keyRefused && settings?.provider !== 'local') run.stopped = { why: 'key' };
    if (run.stopped && item.needsAi && aiAfter(at)) tellStop(run);
  }
  if (!io.signal.aborted) tellStopAtEnd(run);
  return items.length;
}

/** A file that asks the AI, left when the batch stopped asking it (OC5, U4): a row of its own, so each is listed, with the stop's exit code. */
function notStartedRow(run: Run, item: BatchItem, name: string): Row {
  const key = run.stopped?.why === 'key';
  const row = failedRow(name, 'notStarted', `${q(name)} was not started: the batch stopped asking the AI when ${key ? 'it refused the key' : 'it met its limit'}.`);
  return routed(item, { ...row, exit: key ? EXIT.failed : EXIT.limit });
}

/** The names a file of the batch writes, judged for a write (a refusal is its row's, at its turn). */
type JudgedNames = { target: PathVerdict; draft: PathVerdict | null };

/** The names a file of the batch writes, judged for a write in `scope`, the working folder's (SEC-W4-1). */
function judgeNames(item: BatchItem, scope: WorkingFolder, sys: PathSystem): JudgedNames | null {
  if (!item.target) return null;
  return { target: resolveWritePath(item.target, scope, sys, { extensions: ['.repx'] }), draft: item.draft ? resolveWritePath(item.draft, scope, sys, { extensions: ['.repx'] }) : null };
}

/** A row with its route and its report's name, as a batch's JSON line carries them. */
const routed = (item: BatchItem, row: Row): Row => ({ ...row, fields: { route: item.route, output: item.target, ...row.fields } });

/**
 * What a batch's file is made with: the AI's settings and thread (null when
 * no route asks the AI), the command's path policy (the working folder's,
 * as for every command), the batch's folder as the folder its own files
 * must really be in, and the data files' real paths.
 */
interface ItemContext {
  settings: AiSettings | null;
  generator: Generator | null;
  policy: Run['policy'];
  inside: WorkingFolder;
  data: string[];
}

/**
 * A file of the batch judged once more at its turn, in the batch's folder's
 * mode (a file swapped for a link since the walk, even one to elsewhere in
 * the working folder, is refused then), as the kind its name says, at most
 * the web app's file size. Its real path is what the call is handed, judged
 * again in the working folder's mode with everything else it reads and
 * writes (SEC-W4-1). Throws a `ToolRefusal`.
 */
function sourceOf(item: BatchItem, inside: WorkingFolder, sys: PathSystem): string {
  const found = resolveReadPath(item.path, inside, sys, { extensions: [sys.path.extname(item.path).toLowerCase()], maxBytes: MAX_FILE_BYTES });
  if (!found.ok) throw new ToolRefusal(found.reason);
  return found.path;
}

/** One file of the batch made by its route (folderBatch.ts): a row, its failures made rows by `attempt`. */
async function makeItem(run: Run, item: BatchItem, name: string, names: JudgedNames, ctx: ItemContext): Promise<Row> {
  if (!names.target.ok) return failedRow(name, 'refused', names.target.reason);
  if (names.draft && !names.draft.ok) return failedRow(name, 'refused', names.draft.reason);
  const target = names.target.path;
  const draft = names.draft?.ok ? names.draft.path : undefined;
  const { options } = run;
  const { policy, data } = ctx;
  const indent = '  ';
  const ai = () => {
    if (!ctx.settings || !ctx.generator) throw new Error('a route that asks the AI ran with no AI ready');
    return { settings: ctx.settings, generator: ctx.generator };
  };
  const words = options.words ?? '';
  const database = databaseOf(run);
  return attempt(run, name, async () => {
    const source = sourceOf(item, ctx.inside, run.sys);
    switch (item.route) {
      case 'generate': {
        const { settings, generator } = ai();
        return generateWork(run, { label: name, files: [source], shown: [name], description: options.description, data, output: target, draft, policy, lookFirst: false, indent }, settings, generator);
      }
      case 'revise': {
        const { settings, generator } = ai();
        const plan = await planRevise({ path: source, request: words, output: target, editsOnly: options.editsOnly, ...(database ? { database } : {}) }, policy);
        // A report the words leave as it was is written as it reads, so --out holds it and a rerun skips it (U1).
        const keep: Kept = { converted: false, write: () => copyLayout(plan.report, target, policy, run.layout()) };
        return reviseWork(run, plan, settings, generator, indent, [], keep, name);
      }
      case 'convert':
        return convertWork(run, source, target, policy, name);
      case 'repair':
        // Bound to the batch's database as every other route is (W8R-1).
        return repairWork(run, source, target, policy, database);
      case 'convert-revise': {
        const { settings, generator } = ai();
        // Converted with no AI first, then revised: the AI changes the converter's exact report, by control name (GAP1-1, GAP1-3).
        // With a database, the conversion binds it first (GAP1-5), and the revision is shown what it reads.
        const c = await convertForeign(source, policy, run.layout(), database);
        if (!c.report) {
          if (c.from === 'FastReport') return { status: 'failed', lines: [], notes: [...c.read.notices], message: notConverted(q(name), c.from, 'cli'), fields: { from: c.from } };
          const first = [`${q(name)} could not be converted, so the AI made it from its text and the words given.`];
          return generateWork(run, { label: name, files: [source], shown: [name], description: words, data, output: target, draft, policy, lookFirst: false, indent, first }, settings, generator);
        }
        const converted = c.report;
        const plan: RevisePlan<'refuse' | 'replace'> = {
          request: words,
          report: { path: c.source.path, spelled: c.source.spelled, kind: 'repx', text: converted.xml },
          target,
          policy,
          editsOnly: options.editsOnly,
          database: database ? judgeDatabase(database, run.scope, run.sys) : null,
        };
        // The conversion is kept when the words change nothing in it: written as converted, never lost (U1).
        const keep: Kept = { converted: true, write: async () => ({ written: writeLayout(target, converted.xml, policy, run.io.signal), notices: [], audit: converted.audit }) };
        return reviseWork(run, plan, settings, generator, indent, [...c.read.notices, ...converted.notices, `Converted from ${c.from} ${CONVERTED_AS}, then revised.`], keep, name);
      }
      default:
        throw new Error(`${item.route} is not a route that makes a report`);
    }
  });
}

/** What the walk left out, said once on stderr before the batch starts; each link named under --verbose. */
function tellLeftOut(run: Run, walked: Walked): void {
  const parts: string[] = [];
  if (walked.links.length) parts.push(`${n(walked.links.length, 'link')} (a batch follows no link or junction)`);
  if (walked.outputs) parts.push(`${n(walked.outputs, 'file')} named as Forma's own outputs`);
  if (walked.deep.length) parts.push(`${n(walked.deep.length, 'folder')} deeper than ${BATCH_DEPTH} levels`);
  if (walked.unreadable.length) parts.push(`${n(walked.unreadable.length, 'folder')} that could not be listed`);
  if (parts.length) run.err(`Left out ${parts.join(', ')}.`);
  if (run.options.verbose) for (const link of walked.links) run.err(`  a link left out: ${q(link)}`);
}

/**
 * Why the batch stopped asking the AI, and how to carry on, said once on
 * stderr when it stops: each file that asks it, after this one (or from this
 * one on, `fromThis`, when the kept parks stopped it before asking), is
 * listed as not started, a row of its own (U4), while any that need no AI
 * are still made.
 */
function tellStop(run: Run, fromThis = false): void {
  const stop = run.stopped;
  if (!stop) return;
  run.stopTold = true;
  const rest = `each file ${fromThis ? 'from this one on' : 'after this one'} that asks it is listed as not started, and any that need no AI are still made`;
  if (stop.why === 'key') run.err(`The AI refused the key, so every file after this one that asks it would fail the same way: the batch stopped asking it; ${rest}. Set the key right, then run the same command with --skip-existing to carry on.`);
  else run.err(`The batch stopped asking the AI at its limit; ${rest}. Once it lifts${stop.limit.waitMs === null ? '' : `, in about ${lasting(stop.limit.waitMs)}`}, run the same command with --skip-existing to carry on.`);
}

/**
 * The way on after a stop that no line said, once, at the batch's end,
 * before the summary: `tellStop` speaks only when a file that asks the AI
 * follows, so a day's limit or a refused key on the last such file (or the
 * only one) left a `--json` run with no next step anywhere, its summary
 * object carrying only `stoppedBy` and `resetsAt`, and a batch row never
 * takes the single command's "Run the same command again", which without
 * `--skip-existing` would exit 4 on every report made (the CLI work's
 * wave-8 review, W8R-4).
 */
function tellStopAtEnd(run: Run): void {
  const stop = run.stopped;
  if (!stop || run.stopTold) return;
  run.stopTold = true;
  if (stop.why === 'key') run.err('The AI refused the key. Set the key right, then run the same command with --skip-existing to carry on.');
  else run.err(`The batch met the AI's limit. Once it lifts${stop.limit.waitMs === null ? '' : `, in about ${lasting(stop.limit.waitMs)}`}, run the same command with --skip-existing to carry on.`);
}

/** --dry-run: each file's route and the name it would be written under, which need the AI, and what the walk left out; nothing read, no AI asked. */
function printPlan(run: Run, items: readonly BatchItem[], judged: ReadonlyMap<BatchItem, JudgedNames | null>, label: (item: BatchItem) => string, facts: Pick<BatchFacts, 'routes' | 'leftOut'>): void {
  const { io, options, sys } = run;
  for (const item of items) {
    const name = label(item);
    const names = judged.get(item) ?? null;
    const there = names?.target.ok ? sys.fs.lexists(names.target.path) : false;
    const refused = names && !names.target.ok ? names.target.reason : null;
    const why = item.route === 'skip' ? skipWords(item.skip ?? 'nothing asked', name) : refused;
    if (options.json) {
      run.out(JSON.stringify(scrubbed({ type: 'plan', input: name, route: item.route, needsAi: item.needsAi, output: item.target, already: there, ...(why ? { message: why } : {}) }, io.redact)));
    } else if (item.route === 'skip') {
      run.out(why as string);
    } else if (refused) {
      run.out(`${q(name)}: refused. ${refused}`);
    } else {
      run.out(`${q(name)}: ${ROUTE_WORDS[item.route]}${item.needsAi ? ' (AI)' : ''} -> ${q(item.target as string)}${there ? ', already there' : ''}`);
    }
  }
  const needAi = items.filter((i) => i.needsAi).length;
  if (options.json) {
    run.out(JSON.stringify(scrubbed({ type: 'summary', command: 'batch', dryRun: true, inputs: items.length, routes: facts.routes, needAi, leftOut: facts.leftOut, exitCode: EXIT.done }, io.redact)));
    return;
  }
  const counts = Object.entries(facts.routes).map(([route, count]) => `${count} to ${ROUTE_WORDS[route as Route]}`);
  run.out(`${n(items.length, 'input')}: ${counts.join(', ')}; ${n(needAi, 'file')} would ask the AI. Nothing was read, and no AI was asked.`);
}

/**
 * Forma's command line: `argv` is what follows the launcher, `io` what the
 * process gives it (the header). Resolves to the exit code, having closed
 * every thread it started.
 */
export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  const usage = (error: unknown): number => {
    if (!(error instanceof UsageError)) throw error;
    io.err(shown(io, `${error.message} Run with --help for the commands and their options.`));
    return EXIT.usage;
  };
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    return usage(error);
  }
  if (parsed.kind === 'help') {
    // Forma's own text, several lines: printed as it is, never through the one-line `shown`.
    io.out(helpText(formaVersion()));
    return EXIT.done;
  }
  if (parsed.kind === 'version') {
    io.out(`${formaVersion()}\n`);
    return EXIT.done;
  }
  const { options } = parsed;
  const sys = io.sys ?? nodeSystem();
  const scope: WorkingFolder = { base: io.cwd };
  let pipeline: Pipeline | null = null;
  let generator: Generator | null = null;
  const log = (line: string) => {
    if (options.verbose) io.err(shown(io, line));
  };
  const run: Run = {
    io,
    command: parsed.command.name as CliCommandName,
    inputs: parsed.inputs,
    options,
    sys,
    scope,
    policy: { voice: 'cli', sys, scope, ifExists: options.force ? 'replace' : 'refuse', ...(io.wfs ? { wfs: io.wfs } : {}) },
    layout: () => ({ pipeline: (pipeline ??= io.pipeline ? io.pipeline() : workerPipeline({ log })), signal: io.signal }),
    rows: [],
    out: (line) => io.out(`${shown(io, line)}\n`),
    err: (line) => io.err(shown(io, line)),
  };
  let planned: number | 'no AI' | 'planned only';
  try {
    planned = await work(run, (g) => (generator = g));
  } catch (error) {
    return usage(error);
  } finally {
    const started: (Pipeline | Generator | null)[] = [pipeline, generator];
    await Promise.all(started.map((s) => s?.close()));
  }
  if (planned === 'no AI') return EXIT.noAi;
  if (planned === 'planned only') return EXIT.done;
  // A batch stopped at a limit ends as a limit through its files not started (U4), though no file of its own met one (the parks said it).
  const code = worstExit([...run.rows.map((r) => rowExit(r, options)), ...(io.signal.aborted ? [EXIT.interrupted] : [])]);
  summarize(run, code, planned);
  return code;
}

/** What `stopOnSignals` needs of the process: its signal events, its exit and its platform. */
export interface SignalSource {
  on(event: string, listener: () => void): unknown;
  exit(code: number): void;
  platform: string;
}

/**
 * Ctrl+C and a termination stop the run (the header's *A stop*): the first
 * SIGINT or SIGTERM (or SIGBREAK, Ctrl+Break, on Windows) aborts `stop`,
 * whose signal every call of the run carries, and says so; a second ends the
 * process at once with 130.
 */
export function stopOnSignals(proc: SignalSource, stop: AbortController, say: (line: string) => void): void {
  let heard = 0;
  const signals = proc.platform === 'win32' ? ['SIGINT', 'SIGTERM', 'SIGBREAK'] : ['SIGINT', 'SIGTERM'];
  for (const name of signals) {
    proc.on(name, () => {
      heard += 1;
      if (heard > 1) {
        proc.exit(EXIT.interrupted);
        return;
      }
      say('Stopping: the report under way is not written. Press Ctrl+C again to end at once.');
      stop.abort();
    });
  }
}
