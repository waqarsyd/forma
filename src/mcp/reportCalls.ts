/**
 * The two calls that ask an AI, generate and revise, as any caller of Forma's
 * Node side makes them (2026-11-24, the CLI and Forma Designer work's wave 2;
 * findings CLI-2 and SEC-4 of its design audit,
 * `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`): the MCP
 * server's generate_report and revise_report (aiTools.ts), and the command
 * line's generate and revise (commandLine.ts, since that work's wave 4). Until
 * this wave every step was a closure inside `aiTools()`, bound to the MCP's
 * ToolContext, zod and defineTool, so a second caller could only have copied
 * them, and with them two rules whose order is their security: a failure's
 * keys out before it is cut (W8C-1), and the files read only at the call's
 * turn (W8C-6). Nothing here names the MCP SDK or zod, and nothing it loads
 * does (boundaries.test.ts).
 *
 * A call is two steps, so a caller judges everything before it waits:
 *
 * - **`planGenerate`, `planRevise`**: the call's own words first (something
 *   to make the report from, at most the workspace's number of files, a
 *   request), then every path, through the caller's `PathPolicy`: the
 *   server's roots, asked for only once the words pass, as before this
 *   module, or the command line's working folder (paths.ts `PathScope`).
 *   Each input is of the kinds its argument takes, pictures, PDFs, reports,
 *   templates and SSRS or FastReport reports as sources and data files only
 *   as data (SEC-5: a .json or .txt reaches the AI only when it is passed as
 *   data), and at most the web app's file size; a C# or VB report is refused
 *   with how to save it as a .repx (GAP1-1); the report to revise is read,
 *   its text not yet opened (reportFile.ts `readReport`); the output is
 *   judged for a write. Nothing waits and nothing costs a request.
 * - **`runGenerate`, `runRevise`**: the job run on the caller's generator,
 *   behind the gate (`readyGenerator`, the web app's own: OD6); the files
 *   read only when the job has its turn, and moved to the work's thread
 *   rather than copied (W8C-6); the AI's failure said with its keys out
 *   before it is cut (`failureSaid`, W8C-1); the report written only while
 *   the call is still wanted, through `writeOutput`'s temporary name and the
 *   policy's `ifExists` (beside, the server's; refuse, the command line's,
 *   or replace when the person said so: CLI-6); and the result returned as
 *   data: generate_report's and revise_report's own output objects, the
 *   text read from files apart under `fromFile`, and the audit's words for
 *   a summary.
 *
 * Since that work's wave 3 (GAP3-2, GAP3-4, OC5): a call the AI made nothing
 * for is refused as an `AiFailure` (caller.ts), a `ToolRefusal` whose words
 * are the same and which carries the limit the AI met as data; a result
 * carries the model that answered, the fix's when another, and a limit met
 * though a report was written (genJobs.ts, *What a failure carries, and who
 * answered*), each as data and never in a phrase, as `ai` names a provider
 * and only `answeredBy` words it; and `planGenerate` takes `standIn: false`
 * (`GenerateHow`), with which nothing stands in for the AI. Since its wave 4
 * (the command line, OC5): `GenerateHow`'s `draft`, a second target that
 * Forma's draft is written to when it stands in, so the command line's
 * `--allow-stand-in` writes `<name>.draft.repx` and never a draft under the
 * report's own name; and `planRevise` takes `editsOnly`, with which a
 * request that would take a redesign of the whole report is declined and
 * nothing written (GAP1-3). And since that wave's review (SEC-W4-2), under
 * a policy that replaces (the command line's `--force`): a generate is
 * refused before the AI is asked when its output, or its draft's, is one of
 * the files it is made from, and a revise writes over its report only when
 * nothing was taken out of its connection (reportFile.ts
 * `overInputRefusal`), so the login a reading removes never leaves the
 * person's own file. The server's policy never replaces, so it never meets
 * either.
 *
 * Since that work's wave 5 (findings D1-2, D1-9 and D1-10, the owner's OC6):
 * both calls take a database's layout (`DatabaseInput`: the layout file, the
 * files of sample rows the person passed, the query pinned, the connection's
 * name), judged with the rest before the call waits and read at its turn,
 * as the job's `database` (genJobs.ts *A database*); the command line's
 * `--database`, the server's tools taking none until that work's wave 7. A
 * result made with one, or with a layout the core found among the data
 * files (D1-1), says whether the report is bound (`bound`) and, apart under
 * `fromFile.binding`, what it reads or why not: the names are the layout's
 * and the report's (D1-10). A result made with none is as it was.
 *
 * Only a refusal's quoted failure has its keys out here (`failureSaid`).
 * Every string in a returned result is unscrubbed: `fromFile.aiError` is the
 * AI's failure, and `reply`, `brief` and the notices are the AI's words, as
 * they came from the work's thread, which has no scrubber (genJobs.ts). A
 * caller shows a result only through caller.ts's `scrubbed` and
 * `clippedFromFile` with its own redact, as toolShape.ts's `shapeResult`
 * does for the server, never by printing a field it read here (the wave-2
 * review's SEC-W2-3: the order lives in one place, so the command line
 * keeps no copy of it).
 *
 * What stays the caller's: the gate's place in its order (aiTools.ts checks
 * it before anything else, the command line before any file is read), its
 * schemas, its progress (`tell` hears every stage, and 'writing' just
 * before the write), its summary sentence, its log, and how it shows the
 * result. The few phrases here that differ for a person at a command line
 * are chosen by the policy's voice (CLI-10), as paths.ts chooses its own by
 * the scope; the job carries the same voice to the work's thread (genJobs.ts,
 * *Whose words*), and the gate's refusal is in the voice the settings were
 * read in (aiSettings.ts), which the caller's entry chose. No phrase here
 * names the generate command: the summary that would ("call generate_report
 * with what fromFile.brief says") is the caller's.
 *
 * Pure ASCII.
 */
import { readFile } from 'node:fs/promises';
import { PROVIDER_NAMES } from '../lib/aiProvider';
import { MAX_ATTACHMENTS, MAX_FILE_BYTES } from '../lib/attachmentBudget';
import type { AiLimit } from '../lib/aiLimit';
import { reportFileKind } from '../lib/vsReport';
import { notReadyMessage, type AiSettings } from './aiSettings';
import { AiFailure, CallStopped, ToolRefusal, quoted, type Voice } from './caller';
import type { QueryJson } from '../lib/databaseAi';
import type { Answerer, GenDone, GenEvent, InputFile, Printed, ReviseAction } from './genJobs';
import type { Generator, JobSource } from './generator';
import { nodeWriteFs, parsePath, resolveReadPath, resolveWritePath, type IfExists, type PathScope, type PathSystem, type PlacedStatus, type WriteFs, type WriteStatus } from './paths';
import { LAYOUT_FILE_EXTENSIONS, MAX_LAYOUT_FILE_BYTES, SAMPLE_FILE_EXTENSIONS, type Binding, type DatabaseJob, type LayoutBytes } from './nodeDatabase';
import type { Audited } from './pipeline';
import { besideName, codeRefusal, outputPath, overInputRefusal, readReport, sameFile, writeReport, type LayoutKind, type ReportFile, type Written } from './reportFile';

/** Pictures the intake reads. */
export const PICTURE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.avif'] as const;
/** What a report is made from: pictures, PDFs, reports to start from, templates, SSRS and FastReport reports. */
export const SOURCE_EXTENSIONS = [...PICTURE_EXTENSIONS, '.pdf', '.repx', '.vsrepx', '.docx', '.xlsx', '.rdl', '.rdlc', '.frx'] as const;
/** What it takes as data: data files, whose columns become the report's fields. */
export const DATA_EXTENSIONS = ['.csv', '.tsv', '.json', '.txt', '.sql', '.xlsx', '.docx'] as const;

/** What a call is said to have answered with when Forma's draft stood in. */
const STAND_IN_WORDS: Record<string, string> = {
  vision: "Forma's vision model's reading of the page",
  reader: "Forma's box reader's reading of the page",
  ocr: "OCR's reading of the page",
  offline: "Forma's own model's design from the description",
};

/** The phrases of this module that a host's model and a person are told differently (CLI-10). */
const SAY = {
  mcp: {
    nothing: 'Send a description of the report, files to make it from (files), or both.',
    overSource: (file: string) => `${file} is one of the files the report is made from; name another output.`,
    tooMany: (n: number) => `Send at most ${MAX_ATTACHMENTS} files in one call, as the workspace takes; ${n} were sent.`,
    noOutput: 'Name output, the full path of the .repx to write, since there is no file to write it beside.',
    noRequest: 'Send the request: what to change in the report, or what to ask about it, in words.',
    gone: (file: string) => `${file} could not be read when this call's turn came: it was moved, removed or locked while the call waited. Nothing was written.`,
    grew: (file: string, bytes: number) => `${file} grew to ${bytes} bytes while this call waited, more than the ${MAX_FILE_BYTES} this tool reads. Nothing was written.`,
    standIn: (what: string) => `The AI did not make the report (fromFile.aiError says what it answered), so Forma's own draft stands in: ${what}, without the AI's corrections.`,
  },
  cli: {
    nothing: 'Give a description of the report, files to make it from, or both.',
    overSource: (file: string) => `${file} is one of the files the report is made from, which Forma never writes over; name another file with --out.`,
    tooMany: (n: number) => `Give at most ${MAX_ATTACHMENTS} files at once, as the workspace takes; ${n} were given.`,
    noOutput: 'Name where to write the report, a .repx, since there is no file to write it beside.',
    noRequest: 'Give the request: what to change in the report, or what to ask about it, in words.',
    gone: (file: string) => `${file} could not be read when its turn came: it was moved, removed or locked meanwhile. Nothing was written.`,
    grew: (file: string, bytes: number) => `${file} grew to ${bytes} bytes meanwhile, more than the ${MAX_FILE_BYTES} Forma reads. Nothing was written.`,
    standIn: (what: string) => `The AI did not make the report, so Forma's own draft stands in: ${what}, without the AI's corrections.`,
  },
} as const satisfies Record<Voice, Record<string, unknown>>;

/** What turned the mock on, by whose it is: the server's variable, the command line's flag (aiSettings.ts, CLI-9). */
const MOCK_SWITCH: Record<Voice, string> = { mcp: 'FORMA_MCP_MOCK is on', cli: '--mock' };

/** Who answered, in a result's words, the caller's. */
export function answeredBy(by: Answerer, voice: Voice): string {
  if (by === 'mock') return `the mock invoice (${MOCK_SWITCH[voice]}), with no AI asked`;
  return by ? PROVIDER_NAMES[by] : "the report's own facts, with no AI asked";
}

/** The longest AI failure a refusal quotes. */
const MAX_FAILURE = 300;

/**
 * Why the AI made nothing, as a refusal quotes it: its keys taken out first,
 * then cut, never the other way round (the wave-8 review's W8C-1: an error
 * quoting a key past the cut sent the key's first characters out), and one
 * closing stop (W8C-3).
 */
export function failureSaid(failure: string, redact: (text: string) => string): string {
  const clean = redact(failure || 'the AI did not answer');
  return clean.length > MAX_FAILURE ? `${clean.slice(0, MAX_FAILURE - 3)}...` : `${clean}.`;
}

/** Bytes over a buffer of their own, so the generator can move them to the work's thread rather than copy them (W8C-6). */
const ownBytes = (buf: Uint8Array): Uint8Array => (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength ? new Uint8Array(buf.buffer, 0, buf.byteLength) : new Uint8Array(buf));

/** What a call asks the AI with: the settings its entry read from the environment, and the generator its work runs on (null when the AI is not ready). */
export interface AiCall {
  settings: AiSettings;
  generator: Generator | null;
}

/** The generator, once the gate lets the call through: the AI chosen must be ready, by the web app's own rule (OD6), or the call is refused with what to set. */
export function readyGenerator(ai: AiCall): Generator {
  if (!ai.settings.ready || !ai.generator) throw new ToolRefusal(notReadyMessage(ai.settings));
  return ai.generator;
}

/**
 * Where a call's paths are judged and how its report is written: the
 * server's roots and `beside`, or the command line's working folder and
 * `refuse` (or `replace`, when the person said so).
 */
export interface PathPolicy<W extends IfExists = IfExists> {
  /** Whose words this module's own refusals are in; paths.ts takes its own from the scope, which says the same. */
  voice: Voice;
  sys: PathSystem;
  /** The server's roots, asked for only once the call's own words pass, or the command line's working folder. */
  scope: PathScope | (() => Promise<PathScope>);
  ifExists: W;
  /** The file-system calls a write makes; Node's by default. */
  wfs?: WriteFs;
}

/** What a write under `W` can say: `exists` only where the policy refuses a taken name. */
export type WrittenBy<W extends IfExists> = Written<W extends 'refuse' ? WriteStatus : PlacedStatus>;

/** The policy's scope, the server's roots asked for when the policy holds a question for them. */
export const scopeOf = async (policy: PathPolicy): Promise<PathScope> => (typeof policy.scope === 'function' ? policy.scope() : policy.scope);

/** A file judged for reading: where it really is, its name for the intake, and the path as the caller spelled it, resolved. */
export interface Judged {
  path: string;
  name: string;
  spelled: string;
}

/**
 * A file a call reads, judged before the call waits: by paths.ts, as one of `extensions`, at most the web app's file size
 * (a database's layout, `maxBytes`, at most nodeDatabase.ts's). Throws a `ToolRefusal`.
 */
export function judgeInput(raw: string, extensions: readonly string[], scope: PathScope, sys: PathSystem, maxBytes = MAX_FILE_BYTES): Judged {
  const parsed = parsePath(raw, scope, sys);
  if (!parsed.ok) throw new ToolRefusal(parsed.reason);
  if (reportFileKind(parsed.path) === 'code') throw new ToolRefusal(codeRefusal(parsed.path, scope, sys));
  const found = resolveReadPath(raw, scope, sys, { extensions, maxBytes });
  if (!found.ok) throw new ToolRefusal(found.reason);
  return { path: found.path, name: sys.path.basename(found.path), spelled: parsed.path };
}

/**
 * Reads the judged files once the call has its turn, never before (the
 * wave-8 review's W8C-6): a call waiting behind another holds no file's
 * bytes, and the read does not stop the thread that answers. Throws a
 * `ToolRefusal` when a file went or grew past the limit meanwhile.
 */
export async function readJudged(judged: readonly Judged[], voice: Voice, maxBytes = MAX_FILE_BYTES): Promise<InputFile[]> {
  const files: InputFile[] = [];
  for (const file of judged) {
    let bytes: Uint8Array;
    try {
      bytes = ownBytes(await readFile(file.path));
    } catch {
      throw new ToolRefusal(SAY[voice].gone(quoted(file.spelled, voice)));
    }
    if (bytes.byteLength > maxBytes) throw new ToolRefusal(SAY[voice].grew(quoted(file.spelled, voice), bytes.byteLength));
    files.push({ name: file.name, bytes });
  }
  return files;
}

/**
 * A database's layout a call is made with (the CLI and Forma Designer work's
 * wave 5; D1-2, D1-7, OC6): the layout file, the files of sample rows the
 * person passed (their values go to the AI: passing them is the person's
 * consent, OC6), the query pinned as JSON (databaseAi.ts `QueryJson`), and
 * the connection a report names when it names none. The MCP server's tools
 * take none until that work's wave 7; the command line's `--database`.
 *
 * Since that work's wave 6 (2026-11-25, D2-6) the layout and the sample rows
 * can also be text already read, as `LayoutBytes` (a name for what is said
 * of it, and its bytes): the command line's `--connection`, whose layout
 * Forma Designer printed (designerVerbs.ts) on the thread that called,
 * before the job, so the job is handed what a layout file's bytes would be
 * and no worker ever starts a program. Such text is no file: nothing judges
 * it, and no output can be written over it.
 */
export interface DatabaseInput {
  layout: DatabaseSource;
  samples?: readonly DatabaseSource[];
  query?: QueryJson | null;
  connectionName?: string;
}

/** A layout or a file of sample rows as a call takes it: a file's path, or text already read (`--connection`). */
export type DatabaseSource = string | LayoutBytes;

/** A database's files judged before the call waits (read only at its turn), or text already read, passed as it is. */
export interface JudgedDatabase {
  layout: Judged | LayoutBytes;
  samples: (Judged | LayoutBytes)[];
  query: QueryJson | null;
  connectionName?: string;
}

/** The database's files on disk, of those a call was given, for the rule that no output is written over one. */
export function databaseFilesOf(db: JudgedDatabase): Judged[] {
  return [db.layout, ...db.samples].filter((d): d is Judged => 'path' in d);
}

/** Judges a database's files, as the kinds a layout and sample rows are read from, at most nodeDatabase.ts's size; text already read passes as it is. Throws a `ToolRefusal`. */
export function judgeDatabase(input: DatabaseInput, scope: PathScope, sys: PathSystem): JudgedDatabase {
  const judged = (raw: DatabaseSource, extensions: readonly string[]) => (typeof raw === 'string' ? judgeInput(raw, extensions, scope, sys, MAX_LAYOUT_FILE_BYTES) : raw);
  return {
    layout: judged(input.layout, LAYOUT_FILE_EXTENSIONS),
    samples: (input.samples ?? []).map((raw) => judged(raw, SAMPLE_FILE_EXTENSIONS)),
    query: input.query ?? null,
    ...(input.connectionName !== undefined ? { connectionName: input.connectionName } : {}),
  };
}

/** A database's files read at the call's turn (W8C-6), as the job carries them to the work's thread; text already read as it is. Throws a `ToolRefusal`. */
export async function readDatabaseFiles(db: JudgedDatabase, voice: Voice): Promise<DatabaseJob> {
  const read = async (d: Judged | LayoutBytes): Promise<LayoutBytes> => ('path' in d ? (await readJudged([d], voice, MAX_LAYOUT_FILE_BYTES))[0] : d);
  const samples: LayoutBytes[] = [];
  for (const d of db.samples) samples.push(await read(d));
  return {
    layout: await read(db.layout),
    samples,
    query: db.query,
    ...(db.connectionName !== undefined ? { connectionName: db.connectionName } : {}),
  };
}

/**
 * A binding as a result carries it (D1-10): whether the report is bound, as data, and its names, read from the layout
 * and the report, apart for `fromFile`, with what else it says (`notes`: a connection Forma Designer cannot fill, a
 * connection kept, fields renamed, a detail report moved or removed; the wave-5 review, BT-7, W5-PB-11, W5-PB-12).
 */
export type BindingText =
  | { database: string; query: QueryJson; connection: string; designerFills: boolean; parameters: string[]; leftOut: string[]; notes: string[] }
  | { database: string; reason: string; notes: string[] };

/** A binding split for a result: `bound` for its data, the rest for `fromFile`. */
export function bindingParts(binding: Binding | null): { bound: boolean | null; text: BindingText | null } {
  if (!binding) return { bound: null, text: null };
  const { bound, ...text } = binding;
  return { bound, text };
}

/** What a host's model is told of a binding, the names apart under fromFile (D1-10); the command line prints the binding itself. */
const BOUND_SAID = {
  mcp: (bound: boolean) =>
    bound ? 'The report is bound to the database layout given; fromFile.binding says what it reads.' : 'The report is not bound to the database layout given; fromFile.binding says why.',
  cli: () => null,
} as const satisfies Record<Voice, (bound: boolean) => string | null>;

/** How a call runs: the AI and its generator, the call's signal, where its progress goes, and the caller's scrubber. */
export interface CallRun {
  ai: AiCall;
  signal: AbortSignal;
  /** Each stage as it starts, the AI's answer as it streams, and 'writing' just before the report is written. */
  tell(event: GenEvent): void;
  /** Takes the caller's keys out of a text (lib/keyRedact.ts `redactorFor`): a failure is scrubbed before it is cut. */
  redact(text: string): string;
}

/** The job run on the generator behind the gate; a stop is `CallStopped`, and nothing is written after one. */
async function asked(run: CallRun, job: JobSource): Promise<GenDone> {
  const done = await readyGenerator(run.ai).run(job, run.signal, run.tell);
  if (!done || run.signal.aborted) throw new CallStopped();
  if (done.xml) run.tell({ stage: 'writing' });
  return done;
}

/** Writes the report while the call is still wanted, by the policy's rule for a taken name. */
function writeMade<W extends IfExists>(target: string, xml: string, signal: AbortSignal, policy: PathPolicy<W>): WrittenBy<W> {
  if (signal.aborted) throw new CallStopped();
  return writeReport(target, xml, policy.wfs ?? nodeWriteFs, policy.sys, policy.ifExists as IfExists) as WrittenBy<W>;
}

/** The audit's counts when there was no audit. */
const NO_AUDIT: Audited['data'] = { errors: 0, warnings: 0, summary: '', findings: [] };

/** What to make a report from: words, files, data files, and where to write it. */
export interface GenerateInput {
  description?: string;
  files?: readonly string[];
  data?: readonly string[];
  output?: string;
  /** A database's layout to bind the report to (the CLI and Forma Designer work's wave 5); the command line's `--database`. */
  database?: DatabaseInput;
}

/** A generate call judged: its words, its files (sources first, then data), the output, the policy it was judged by, and whether Forma's draft may stand in, and where. */
export interface GeneratePlan<W extends IfExists = IfExists> {
  words: string;
  inputs: readonly Judged[];
  target: string;
  policy: PathPolicy<W>;
  standIn: boolean;
  /** Where Forma's draft is written when it stands in, apart from the report's name (`GenerateHow`'s `draft`); null: under `target`, the server's way. */
  draftTarget: string | null;
  /** The database's files judged, or null. */
  database: JudgedDatabase | null;
}

/**
 * How the caller has a generate call made, beside what it is made from:
 * `standIn` false and nothing stands in when every AI fails (the core's
 * `standIn: false`, OC5), the failure refused as an `AiFailure` with the
 * limit it met. The server leaves it out, so Forma's draft stands in, as
 * before; the command line sets it unless the person gives
 * `--allow-stand-in` (its wave 4).
 *
 * `draft`, since the command line's wave 4 (OC5, left open by wave 3): the
 * path Forma's draft is written to when it stands in, apart from the
 * report's own name, so a draft is never taken for the AI's report by name:
 * the command line's `<name>.draft.repx`. It is judged with the output,
 * before the call waits, so a refused path costs no request; left out, a
 * draft that stands in is written under the report's name, as the server
 * writes it.
 */
export interface GenerateHow {
  standIn?: boolean;
  draft?: string;
}

/** Judges a generate call, its words and then every path, before it waits. Throws a `ToolRefusal`. */
export async function planGenerate<W extends IfExists>(input: GenerateInput, policy: PathPolicy<W>, how: GenerateHow = {}): Promise<GeneratePlan<W>> {
  const say = SAY[policy.voice];
  const words = (input.description ?? '').trim();
  const sources = input.files ?? [];
  const data = input.data ?? [];
  if (!words && !sources.length) throw new ToolRefusal(say.nothing);
  if (sources.length + data.length > MAX_ATTACHMENTS) throw new ToolRefusal(say.tooMany(sources.length + data.length));
  const scope = await scopeOf(policy);
  const { sys } = policy;
  const inputs = [...sources.map((raw) => judgeInput(raw, SOURCE_EXTENSIONS, scope, sys)), ...data.map((raw) => judgeInput(raw, DATA_EXTENSIONS, scope, sys))];
  const database = input.database ? judgeDatabase(input.database, scope, sys) : null;
  const first = inputs[0];
  if (!input.output && !first) throw new ToolRefusal(say.noOutput);
  const target = resolveWritePath(input.output || besideName(first.spelled, '.generated.repx', sys), scope, sys, { extensions: ['.repx'] });
  if (!target.ok) throw new ToolRefusal(target.reason);
  const draft = how.draft ? resolveWritePath(how.draft, scope, sys, { extensions: ['.repx'] }) : null;
  if (draft && !draft.ok) throw new ToolRefusal(draft.reason);
  // A report made from a file is never written over that file, whatever replaces (the wave-4 review's SEC-W4-2): a
  // report to start from would lose what it was, its login included. Only a policy that replaces can reach it.
  if (policy.ifExists === 'replace') {
    const read = [...inputs, ...(database ? databaseFilesOf(database) : [])];
    for (const written of [target.path, ...(draft?.ok ? [draft.path] : [])]) {
      const over = read.find((i) => sameFile(written, i.path, sys));
      if (over) throw new ToolRefusal(say.overSource(quoted(over.path, policy.voice)));
    }
  }
  return { words, inputs, target: target.path, policy, standIn: how.standIn !== false, draftTarget: draft ? draft.path : null, database };
}

/** generate_report's output object: the file written, who answered, what stood in, the notices, the audit and what printing found. */
export interface GenerateData<W extends IfExists = IfExists> {
  written: WrittenBy<W>;
  ai: Answerer;
  switched: boolean;
  standIn: string | null;
  notices: string[];
  pictures: number;
  errors: number;
  warnings: number;
  summary: string;
  findings: Audited['data']['findings'];
  printFindings: Printed['data'];
  translated: { language: string; bilingual: boolean } | null;
  /** The model that designed the report, as the answer named it; null with no AI's answer (genJobs.ts, *What a failure carries, and who answered*). */
  model: string | null;
  /** The model that made the print check's fix kept, when another; null otherwise. */
  fixModel: string | null;
  /** The limit the AI met though a report was written: why Forma's draft stands in, or why the fix was not asked; null when none. */
  limit: AiLimit | null;
  /** Whether the report written is bound to the database layout given (D1-9), there only with one, so a result made with none is as it was. What it reads is under fromFile.binding (D1-10). */
  bound?: boolean;
}

/** What a generate call returns: its data, the text read from files apart, and the audit's words for a summary (null with no audit). */
export interface GenerateResult<W extends IfExists = IfExists> {
  data: GenerateData<W>;
  fromFile: { findings: string[]; printed: string[]; aiError?: string; standInFonts?: string[]; binding?: BindingText };
  auditWords: string | null;
}

/** Runs a judged generate call: the files read at its turn, the AI asked, the report written. Throws a `ToolRefusal`, or `CallStopped`. */
export async function runGenerate<W extends IfExists>(plan: GeneratePlan<W>, run: CallRun): Promise<GenerateResult<W>> {
  const { policy } = plan;
  // The job is made, its files read, only once the call has its turn (W8C-6).
  const done = await asked(run, async () => ({
    kind: 'generate',
    voice: policy.voice,
    config: run.ai.settings.config,
    words: plan.words,
    files: await readJudged(plan.inputs, policy.voice),
    ...(plan.standIn ? {} : { standIn: false }),
    ...(plan.database ? { database: await readDatabaseFiles(plan.database, policy.voice) } : {}),
  }));
  if (done.kind !== 'generate') throw new Error('the generator answered another call');
  if (!done.xml) throw new AiFailure(`No report was made: ${failureSaid(done.failure, run.redact)} Nothing was written.`, done.limit);
  // Forma's draft, standing in, goes to its own name when the caller gave one (GenerateHow's draft).
  const written = writeMade(done.standIn && plan.draftTarget ? plan.draftTarget : plan.target, done.xml, run.signal, policy);
  const audit = done.audit;
  const notices = [...done.notices, ...(done.note ? [done.note] : [])];
  if (done.standIn) notices.push(SAY[policy.voice].standIn(STAND_IN_WORDS[done.standIn] ?? 'a quicker version'));
  const binding = bindingParts(done.binding);
  const boundSaid = binding.bound === null ? null : BOUND_SAID[policy.voice](binding.bound);
  if (boundSaid) notices.push(boundSaid);
  return {
    data: {
      written,
      ai: done.by,
      switched: Boolean(done.note),
      standIn: done.standIn,
      notices,
      pictures: done.pictures,
      ...(audit?.data ?? NO_AUDIT),
      printFindings: done.printed.data,
      translated: done.translated,
      model: done.model,
      fixModel: done.fixModel,
      limit: done.limit,
      ...(binding.bound === null ? {} : { bound: binding.bound }),
    },
    fromFile: {
      findings: audit?.lines ?? [],
      printed: done.printed.lines,
      ...(done.failure ? { aiError: done.failure } : {}),
      ...(done.standInFonts.length ? { standInFonts: done.standInFonts } : {}),
      ...(binding.text ? { binding: binding.text } : {}),
    },
    auditWords: audit?.words ?? null,
  };
}

/** What to revise: the report, the request in words, and where to write the result. */
export interface ReviseInput {
  path: string;
  request: string;
  output?: string;
  /** No redesign of the whole report, only edits in place (genJobs.ts `ReviseJob`'s `editsOnly`): the command line's `--edits-only`. */
  editsOnly?: boolean;
  /** A database's layout the change is made with (the CLI and Forma Designer work's wave 5, D1-2); the command line's `--database`. */
  database?: DatabaseInput;
}

/** A revise call judged: the request, the report read (its text not yet opened), the output, the policy, and whether only edits may be made. */
export interface RevisePlan<W extends IfExists = IfExists> {
  request: string;
  report: ReportFile;
  target: string;
  policy: PathPolicy<W>;
  editsOnly: boolean;
  /** The database's files judged, or null. */
  database: JudgedDatabase | null;
}

/** Judges a revise call, its request and then its paths, reading the report before it waits (it is judged by its text). Throws a `ToolRefusal`. */
export async function planRevise<W extends IfExists>(input: ReviseInput, policy: PathPolicy<W>): Promise<RevisePlan<W>> {
  const request = input.request.trim();
  if (!request) throw new ToolRefusal(SAY[policy.voice].noRequest);
  const scope = await scopeOf(policy);
  const report = readReport(input.path, scope, policy.sys);
  const target = outputPath(input.output, report, '.revised.repx', ['.repx'], scope, policy.sys);
  const database = input.database ? judgeDatabase(input.database, scope, policy.sys) : null;
  // A layout read from a report's own source is never what a change is written over (SEC-W4-2's rule, for --force).
  if (database && policy.ifExists === 'replace' && databaseFilesOf(database).some((d) => sameFile(target, d.path, policy.sys) && !sameFile(target, report.path, policy.sys))) {
    throw new ToolRefusal(SAY[policy.voice].overSource(quoted(target, policy.voice)));
  }
  return { request, report, target, policy, editsOnly: input.editsOnly === true, database };
}

/** revise_report's output object: the report read, what was done, the file written (or null), who answered, the notices, and the audit when written. */
export interface ReviseData<W extends IfExists = IfExists> {
  path: string;
  kind: LayoutKind;
  loginRemoved: boolean;
  action: ReviseAction;
  applied: number;
  declined: number;
  ai: Answerer;
  switched: boolean;
  notices: string[];
  translated: { language: string; bilingual: boolean } | null;
  written: WrittenBy<W> | null;
  errors?: number;
  warnings?: number;
  summary?: string;
  findings?: Audited['data']['findings'];
  /** The model that answered the request, or designed the redesign; null for an answer from the report's facts (genJobs.ts). */
  model: string | null;
  /** The model whose answer went in after that one (an edit's second pass kept, a redesign's fix), when another; null otherwise. */
  fixModel: string | null;
  /** The limit an edit's second pass or a redesign's fix met, so the change is the one before it; null when none. */
  limit: AiLimit | null;
  /** With a database layout given, and only then: whether the report written (or, with nothing written, the report read) is bound to it. */
  bound?: boolean;
}

/** What a revise call returns: its data, the text read from the report and the AI's reply apart, and the audit's words (null with nothing written). */
export interface ReviseResult<W extends IfExists = IfExists> {
  data: ReviseData<W>;
  fromFile: { reply: string[]; applied?: string[]; declined?: string[]; changes?: string[]; brief?: string[]; findings?: string[]; standInFonts?: string[]; binding?: BindingText };
  auditWords: string | null;
}

/** Runs a judged revise call: the AI shown the report, its answer carried out, a change written to a new file. Throws a `ToolRefusal`, or `CallStopped`. */
export async function runRevise<W extends IfExists>(plan: RevisePlan<W>, run: CallRun): Promise<ReviseResult<W>> {
  const { report, policy } = plan;
  // The job made, and its database's files read, only once the call has its turn (W8C-6), as generate's.
  const done = await asked(run, async () => ({
    kind: 'revise',
    voice: policy.voice,
    config: run.ai.settings.config,
    request: plan.request,
    name: report.spelled,
    text: report.text,
    ...(plan.editsOnly ? { editsOnly: true } : {}),
    ...(plan.database ? { database: await readDatabaseFiles(plan.database, policy.voice) } : {}),
  }));
  if (done.kind !== 'revise') throw new Error('the generator answered another call');
  if (done.failure && !done.xml) throw new AiFailure(`No change was made: ${failureSaid(done.failure, run.redact)} Nothing was written.`, done.limit);
  const notices = [...done.report.notices, ...done.notices, ...(done.note ? [done.note] : [])];
  const binding = bindingParts(done.binding);
  const boundSaid = binding.bound === null ? null : BOUND_SAID[policy.voice](binding.bound);
  if (boundSaid) notices.push(boundSaid);
  const base = {
    path: report.path,
    kind: report.kind,
    loginRemoved: done.report.loginRemoved,
    action: done.action,
    applied: done.applied.length,
    declined: done.declined.length,
    ai: done.by,
    switched: Boolean(done.note),
    notices,
    translated: done.translated,
    ...(binding.bound === null ? {} : { bound: binding.bound }),
  };
  const fromFile = {
    reply: done.reply,
    ...(binding.text ? { binding: binding.text } : {}),
    ...(done.applied.length ? { applied: done.applied } : {}),
    ...(done.declined.length ? { declined: done.declined } : {}),
    ...(done.changes.length ? { changes: done.changes } : {}),
    ...(done.brief.length ? { brief: done.brief } : {}),
  };
  const answered = { model: done.model, fixModel: done.fixModel, limit: done.limit };
  if (!done.xml) return { data: { ...base, written: null, ...answered }, fromFile, auditWords: null };
  // Written over the report itself only when nothing was taken out of its connection, as an edit (SEC-W4-2).
  if (policy.ifExists === 'replace' && sameFile(plan.target, report.path, policy.sys) && done.report.connectionsChanged) throw overInputRefusal(report.path, done.report.loginRemoved, policy.voice);
  const written = writeMade(plan.target, done.xml, run.signal, policy);
  return {
    data: { ...base, written, ...(done.audit?.data ?? {}), ...answered },
    fromFile: { ...fromFile, ...(done.audit ? { findings: done.audit.lines } : {}), ...(done.standInFonts.length ? { standInFonts: done.standInFonts } : {}) },
    auditWords: done.audit?.words ?? null,
  };
}
