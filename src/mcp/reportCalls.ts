/**
 * The two calls that ask an AI, generate and revise, as any caller of Forma's
 * Node side makes them (2026-11-24, the CLI and Forma Designer work's wave 2;
 * findings CLI-2 and SEC-4 of its design audit,
 * `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`): the MCP
 * server's generate_report and revise_report (aiTools.ts), and the command
 * line's generate and revise, which that work's wave 4 builds on this. Until
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
import { reportFileKind } from '../lib/vsReport';
import { notReadyMessage, type AiSettings } from './aiSettings';
import { CallStopped, ToolRefusal, type Voice } from './caller';
import type { Answerer, GenDone, GenEvent, InputFile, Printed, ReviseAction } from './genJobs';
import type { Generator, JobSource } from './generator';
import { nodeWriteFs, parsePath, resolveReadPath, resolveWritePath, type IfExists, type PathScope, type PathSystem, type PlacedStatus, type WriteFs, type WriteStatus } from './paths';
import type { Audited } from './pipeline';
import { besideName, codeRefusal, outputPath, readReport, writeReport, type LayoutKind, type ReportFile, type Written } from './reportFile';

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
    tooMany: (n: number) => `Send at most ${MAX_ATTACHMENTS} files in one call, as the workspace takes; ${n} were sent.`,
    noOutput: 'Name output, the full path of the .repx to write, since there is no file to write it beside.',
    noRequest: 'Send the request: what to change in the report, or what to ask about it, in words.',
    gone: (file: string) => `${file} could not be read when this call's turn came: it was moved, removed or locked while the call waited. Nothing was written.`,
    grew: (file: string, bytes: number) => `${file} grew to ${bytes} bytes while this call waited, more than the ${MAX_FILE_BYTES} this tool reads. Nothing was written.`,
    standIn: (what: string) => `The AI did not make the report (fromFile.aiError says what it answered), so Forma's own draft stands in: ${what}, without the AI's corrections.`,
  },
  cli: {
    nothing: 'Give a description of the report, files to make it from, or both.',
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

const scopeOf = async (policy: PathPolicy): Promise<PathScope> => (typeof policy.scope === 'function' ? policy.scope() : policy.scope);

/** A file judged for reading: where it really is, its name for the intake, and the path as the caller spelled it, resolved. */
export interface Judged {
  path: string;
  name: string;
  spelled: string;
}

/** A file a call reads, judged before the call waits: by paths.ts, as one of `extensions`, at most the web app's file size. Throws a `ToolRefusal`. */
export function judgeInput(raw: string, extensions: readonly string[], scope: PathScope, sys: PathSystem): Judged {
  const parsed = parsePath(raw, scope, sys);
  if (!parsed.ok) throw new ToolRefusal(parsed.reason);
  if (reportFileKind(parsed.path) === 'code') throw new ToolRefusal(codeRefusal(parsed.path, scope, sys));
  const found = resolveReadPath(raw, scope, sys, { extensions, maxBytes: MAX_FILE_BYTES });
  if (!found.ok) throw new ToolRefusal(found.reason);
  return { path: found.path, name: sys.path.basename(found.path), spelled: parsed.path };
}

/**
 * Reads the judged files once the call has its turn, never before (the
 * wave-8 review's W8C-6): a call waiting behind another holds no file's
 * bytes, and the read does not stop the thread that answers. Throws a
 * `ToolRefusal` when a file went or grew past the limit meanwhile.
 */
export async function readJudged(judged: readonly Judged[], voice: Voice): Promise<InputFile[]> {
  const files: InputFile[] = [];
  for (const file of judged) {
    let bytes: Uint8Array;
    try {
      bytes = ownBytes(await readFile(file.path));
    } catch {
      throw new ToolRefusal(SAY[voice].gone(JSON.stringify(file.spelled)));
    }
    if (bytes.byteLength > MAX_FILE_BYTES) throw new ToolRefusal(SAY[voice].grew(JSON.stringify(file.spelled), bytes.byteLength));
    files.push({ name: file.name, bytes });
  }
  return files;
}

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
}

/** A generate call judged: its words, its files (sources first, then data), the output, and the policy it was judged by. */
export interface GeneratePlan<W extends IfExists = IfExists> {
  words: string;
  inputs: readonly Judged[];
  target: string;
  policy: PathPolicy<W>;
}

/** Judges a generate call, its words and then every path, before it waits. Throws a `ToolRefusal`. */
export async function planGenerate<W extends IfExists>(input: GenerateInput, policy: PathPolicy<W>): Promise<GeneratePlan<W>> {
  const say = SAY[policy.voice];
  const words = (input.description ?? '').trim();
  const sources = input.files ?? [];
  const data = input.data ?? [];
  if (!words && !sources.length) throw new ToolRefusal(say.nothing);
  if (sources.length + data.length > MAX_ATTACHMENTS) throw new ToolRefusal(say.tooMany(sources.length + data.length));
  const scope = await scopeOf(policy);
  const { sys } = policy;
  const inputs = [...sources.map((raw) => judgeInput(raw, SOURCE_EXTENSIONS, scope, sys)), ...data.map((raw) => judgeInput(raw, DATA_EXTENSIONS, scope, sys))];
  const first = inputs[0];
  if (!input.output && !first) throw new ToolRefusal(say.noOutput);
  const target = resolveWritePath(input.output || besideName(first.spelled, '.generated.repx', sys), scope, sys, { extensions: ['.repx'] });
  if (!target.ok) throw new ToolRefusal(target.reason);
  return { words, inputs, target: target.path, policy };
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
}

/** What a generate call returns: its data, the text read from files apart, and the audit's words for a summary (null with no audit). */
export interface GenerateResult<W extends IfExists = IfExists> {
  data: GenerateData<W>;
  fromFile: { findings: string[]; printed: string[]; aiError?: string; standInFonts?: string[] };
  auditWords: string | null;
}

/** Runs a judged generate call: the files read at its turn, the AI asked, the report written. Throws a `ToolRefusal`, or `CallStopped`. */
export async function runGenerate<W extends IfExists>(plan: GeneratePlan<W>, run: CallRun): Promise<GenerateResult<W>> {
  const { policy } = plan;
  // The job is made, its files read, only once the call has its turn (W8C-6).
  const done = await asked(run, async () => ({ kind: 'generate', voice: policy.voice, config: run.ai.settings.config, words: plan.words, files: await readJudged(plan.inputs, policy.voice) }));
  if (done.kind !== 'generate') throw new Error('the generator answered another call');
  if (!done.xml) throw new ToolRefusal(`No report was made: ${failureSaid(done.failure, run.redact)} Nothing was written.`);
  const written = writeMade(plan.target, done.xml, run.signal, policy);
  const audit = done.audit;
  const notices = [...done.notices, ...(done.note ? [done.note] : [])];
  if (done.standIn) notices.push(SAY[policy.voice].standIn(STAND_IN_WORDS[done.standIn] ?? 'a quicker version'));
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
    },
    fromFile: {
      findings: audit?.lines ?? [],
      printed: done.printed.lines,
      ...(done.failure ? { aiError: done.failure } : {}),
      ...(done.standInFonts.length ? { standInFonts: done.standInFonts } : {}),
    },
    auditWords: audit?.words ?? null,
  };
}

/** What to revise: the report, the request in words, and where to write the result. */
export interface ReviseInput {
  path: string;
  request: string;
  output?: string;
}

/** A revise call judged: the request, the report read (its text not yet opened), the output, and the policy. */
export interface RevisePlan<W extends IfExists = IfExists> {
  request: string;
  report: ReportFile;
  target: string;
  policy: PathPolicy<W>;
}

/** Judges a revise call, its request and then its paths, reading the report before it waits (it is judged by its text). Throws a `ToolRefusal`. */
export async function planRevise<W extends IfExists>(input: ReviseInput, policy: PathPolicy<W>): Promise<RevisePlan<W>> {
  const request = input.request.trim();
  if (!request) throw new ToolRefusal(SAY[policy.voice].noRequest);
  const scope = await scopeOf(policy);
  const report = readReport(input.path, scope, policy.sys);
  const target = outputPath(input.output, report, '.revised.repx', ['.repx'], scope, policy.sys);
  return { request, report, target, policy };
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
}

/** What a revise call returns: its data, the text read from the report and the AI's reply apart, and the audit's words (null with nothing written). */
export interface ReviseResult<W extends IfExists = IfExists> {
  data: ReviseData<W>;
  fromFile: { reply: string[]; applied?: string[]; declined?: string[]; changes?: string[]; brief?: string[]; findings?: string[]; standInFonts?: string[] };
  auditWords: string | null;
}

/** Runs a judged revise call: the AI shown the report, its answer carried out, a change written to a new file. Throws a `ToolRefusal`, or `CallStopped`. */
export async function runRevise<W extends IfExists>(plan: RevisePlan<W>, run: CallRun): Promise<ReviseResult<W>> {
  const { report, policy } = plan;
  const done = await asked(run, { kind: 'revise', voice: policy.voice, config: run.ai.settings.config, request: plan.request, name: report.spelled, text: report.text });
  if (done.kind !== 'revise') throw new Error('the generator answered another call');
  if (done.failure && !done.xml) throw new ToolRefusal(`No change was made: ${failureSaid(done.failure, run.redact)} Nothing was written.`);
  const notices = [...done.report.notices, ...done.notices, ...(done.note ? [done.note] : [])];
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
  };
  const fromFile = {
    reply: done.reply,
    ...(done.applied.length ? { applied: done.applied } : {}),
    ...(done.declined.length ? { declined: done.declined } : {}),
    ...(done.changes.length ? { changes: done.changes } : {}),
    ...(done.brief.length ? { brief: done.brief } : {}),
  };
  if (!done.xml) return { data: { ...base, written: null }, fromFile, auditWords: null };
  const written = writeMade(plan.target, done.xml, run.signal, policy);
  return {
    data: { ...base, written, ...(done.audit?.data ?? {}) },
    fromFile: { ...fromFile, ...(done.audit ? { findings: done.audit.lines } : {}), ...(done.standInFonts.length ? { standInFonts: done.standInFonts } : {}) },
    auditWords: done.audit?.words ?? null,
  };
}
