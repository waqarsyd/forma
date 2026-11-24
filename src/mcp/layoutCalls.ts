/**
 * The calls on a report layout that need no AI, audit, outline, repair,
 * edit and pdf, as any caller of Forma's Node side makes them (2026-11-24,
 * the CLI and Forma Designer work's wave 4; findings CLI-1, CLI-2 and SEC-4
 * of its design audit, `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`):
 * the MCP server's repx_audit, repx_outline, repx_repair, repx_edit and
 * repx_pdf (reportTools.ts), and the command line's audit, outline, repair,
 * edit and pdf (commandLine.ts). And a sixth, convert (the same wave's second
 * part, GAP1-1 and the owner's OC7): an SSRS or FastReport report made into a
 * repaired `.repx` with no AI, by the conversion the web app's intake runs
 * (lib/repxIntake.ts `importedReport`), which the command line's convert and
 * its batch call, and the server's repx_convert is to (that work's wave 7).
 * And, since that wave's review (U1), `copyLayout` and `writeLayout`, with
 * which the batch writes a report its words changed nothing in, as it reads
 * or as converted, so no file it was given is missing from its output.
 * And since that work's wave 5 (D1-3, D1-7, D1-11, GAP1-5, OC7): `readLayout`,
 * a database's layout read with no report, so a caller says what it read
 * before any AI is asked; `bindLayout`, a report bound to a table, view,
 * procedure or query of a layout with no AI (the command line's bind, and
 * the server's repx_edit `data` edit is to use it in that work's wave 7);
 * and a database given to `convertLayout`, which binds the converted SSRS
 * report to what its own DataSet reads (nodeDatabase.ts `bindConverted`).
 * Until this wave the steps were inside the tools'
 * handlers, bound to the MCP's ToolContext and zod, so the command line
 * could only have copied them, and with them rules whose order is their
 * security, as reportCalls.ts says of the two calls that ask an AI: the
 * report read through paths.ts and its login taken out (in the worker)
 * before anything sees it, a report whose connection was stored with more
 * than its name never written over in place, a `.vsrepx` never written
 * where its Designer file looks up a name it lost, and nothing written once
 * the call is no longer wanted.
 *
 * Each call judges its paths through the caller's `PathPolicy`
 * (reportCalls.ts): the server's roots and a taken name written beside it,
 * or the command line's working folder and a taken name refused, or
 * replaced when the person said so. Its work, everything that costs time or
 * memory in proportion to the report, runs on the caller's `Pipeline`
 * (workerPool.ts: a worker thread with a memory bound and a deadline), in
 * the policy's voice. What it returns is data: the tool's own output object,
 * the text read from the file apart (`fromFile`), and the audit's words for
 * a summary. Every string is unscrubbed, as reportCalls.ts's are: a caller
 * shows a result only through caller.ts's `scrubbed` and `clippedFromFile`
 * with its own redact.
 *
 * What stays the caller's: its schemas and its summary sentence
 * (reportTools.ts for the server, commandLine.ts for the command line). The few
 * phrases here that differ for a person at a command line are chosen by the
 * policy's voice (CLI-10); the server's are exactly what they were, which
 * reportTools.test.ts holds. Nothing here names the MCP SDK or zod, and
 * nothing it loads does (boundaries.test.ts).
 *
 * Pure ASCII.
 */
import type { AgentEdit } from '../lib/agentEdit';
import { CallStopped, ToolRefusal, quoted, type Voice } from './caller';
import { nodeWriteFs, resolveWritePath, type IfExists, type PathScope, type PathSystem } from './paths';
import type { Binding, ChosenBy, DatabaseJob } from './nodeDatabase';
import type { Audited, DesignerText, Dropped, LayoutSaid, ReportRead } from './pipeline';
import { bindingParts, databaseFilesOf, judgeDatabase, readDatabaseFiles, scopeOf, type BindingText, type DatabaseInput, type PathPolicy, type WrittenBy } from './reportCalls';
import {
  CONNECTION_BY_NAME,
  LAYOUT_EXTENSIONS,
  besideName,
  designerFor,
  outputPath,
  overInputRefusal,
  readForeign,
  readReport,
  sameFile,
  targetKind,
  writeReport,
  type ForeignFile,
  type LayoutKind,
  type ReportFile,
} from './reportFile';
import type { Pipeline } from './workerPool';

/** Where a call's work runs, and the signal that stops it. */
export interface LayoutRun {
  pipeline: Pipeline;
  signal: AbortSignal;
}

/** What every result says of the report it read: the file's own path and kind, and what opening it found. */
export interface LayoutRead {
  path: string;
  kind: LayoutKind;
  loginRemoved: boolean;
  notices: string[];
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The phrases of this module that a host's model and a person at a command line are told differently (caller.ts `Voice`, CLI-10). */
const SAY = {
  mcp: {
    noEdit: 'Send at least one edit.',
    noBand: (path: string) => `No band could be read from ${path}, so there is nothing to draw; repx_audit says what is wrong with it.`,
    lookedUp: 'fromFile.designerLooksUp',
    fromText: 'generate_report can make a report from its text with the AI',
  },
  cli: {
    noEdit: 'Give at least one edit.',
    noBand: (path: string) => `No band could be read from ${path}, so there is nothing to draw; the audit command says what is wrong with it.`,
    lookedUp: 'listed as designer looks up',
    fromText: 'the generate command can make a report from its text with the AI',
  },
} as const satisfies Record<Voice, Record<string, unknown>>;

/** What a result says when a written `.vsrepx` lost names its Designer file looks up (GAP1-3), in the caller's words. */
export const droppedNotice = (d: Dropped, voice: Voice): string =>
  `${quoted(d.file, voice)} looks up ${n(d.names.length, 'name')} by Name that the new layout no longer has (${SAY[voice].lookedUp}); its fields for them would be null when the report runs.`;

/** What every result says of the report read. */
const readOf = (report: ReportFile, found: ReportRead): LayoutRead => ({ path: report.path, kind: report.kind, loginRemoved: found.loginRemoved, notices: [...found.notices] });

/** Nothing is written once the call is no longer wanted (PROTO-4). */
const stillWanted = (signal: AbortSignal) => {
  if (signal.aborted) throw new CallStopped();
};

/** The report a call names, read through the policy's scope: judged by paths.ts, its text not yet opened. */
async function opened(raw: string, policy: PathPolicy): Promise<{ scope: PathScope; report: ReportFile }> {
  const scope = await scopeOf(policy);
  return { scope, report: readReport(raw, scope, policy.sys) };
}

/**
 * The Designer file a written `.vsrepx` is checked against (GAP1-3): the one
 * beside the file written, which loads it, else the one beside the input;
 * none for a `.repx`.
 */
function designersFor(report: ReportFile, target: string, scope: PathScope, sys: PathSystem): DesignerText[] {
  for (const [layout, besideTarget] of [[target, true], [report.spelled, false]] as const) {
    const found = designerFor(layout, scope, sys);
    if (found) return [{ ...found, besideTarget }];
  }
  return [];
}

/** The audit's counts and findings, as every result that audits carries them. */
type AuditData = Audited['data'];

/** An audit: what is still wrong with a report, writing nothing. */
export async function auditLayout(raw: string, policy: PathPolicy, run: LayoutRun): Promise<{ data: LayoutRead & AuditData; fromFile: { findings: string[] }; words: string }> {
  const { report } = await opened(raw, policy);
  const done = await run.pipeline.run({ tool: 'audit', voice: policy.voice, name: report.spelled, text: report.text }, run.signal);
  return { data: { ...readOf(report, done.report), ...done.audit.data }, fromFile: { findings: done.audit.lines }, words: done.audit.words };
}

/** The counts an outline gives. */
export type OutlineCounts = { bands: number; controls: number; fields: number; parameters: number; dataSources: number };

/** An outline: the report as Forma's chat is shown it, every control by its Name, and its SQL data sources by connection name only. */
export async function outlineLayout(
  raw: string,
  policy: PathPolicy,
  run: LayoutRun,
): Promise<{ data: LayoutRead & OutlineCounts; fromFile: { outline: string[]; dataSources: { name: string; connection: string; queries: string[] }[] } }> {
  const { report } = await opened(raw, policy);
  const done = await run.pipeline.run({ tool: 'outline', voice: policy.voice, name: report.spelled, text: report.text }, run.signal);
  return { data: { ...readOf(report, done.report), ...done.counts }, fromFile: { outline: done.outline, dataSources: done.dataSources } };
}

/** A repair's result: the file written, the repairs made, and the audit of what was written. */
export interface RepairDone<W extends IfExists> {
  data: LayoutRead & { written: WrittenBy<W>; repairs: string[] } & AuditData;
  fromFile: { repairs: string[]; findings: string[]; designerLooksUp?: string[] };
  words: string;
}

/**
 * A repair: every repair Forma makes on the reports it generates, in the
 * same order, written to a new file (`output`, else `<name>.repaired.repx`
 * beside the input). Written over the input itself only where the policy
 * replaces and nothing was taken out of its connection (the wave-4 review's
 * SEC-W4-2, as an edit: reportFile.ts `overInputRefusal`).
 */
export async function repairLayout<W extends IfExists>(raw: string, output: string | undefined, policy: PathPolicy<W>, run: LayoutRun): Promise<RepairDone<W>> {
  const { sys, voice } = policy;
  const { scope, report } = await opened(raw, policy);
  const target = outputPath(output, report, '.repaired.repx', LAYOUT_EXTENSIONS, scope, sys);
  const kind = targetKind(target, report, voice);
  const inPlace = policy.ifExists === 'replace' && sameFile(target, report.path, sys);
  const designers = kind === 'vsrepx' ? designersFor(report, target, scope, sys) : [];
  // The developer's own code is kept (GAP1-3, SE-02b), in pipeline.ts.
  const done = await run.pipeline.run({ tool: 'repair', voice, name: report.spelled, text: report.text, target: kind, designers }, run.signal);
  if (inPlace && done.report.connectionsChanged) throw overInputRefusal(report.path, done.report.loginRemoved, voice);
  const notices = [...done.report.notices];
  if (done.report.connectionsChanged && !done.report.loginRemoved) notices.push(CONNECTION_BY_NAME);
  // A repair writes even where its Designer looks up a name it lost, and says which (GAP1-3).
  if (done.dropped) notices.push(droppedNotice(done.dropped, voice));
  stillWanted(run.signal);
  const written = writeReport(target, done.xml, policy.wfs ?? nodeWriteFs, sys, policy.ifExists as IfExists) as WrittenBy<W>;
  return {
    data: { ...readOf(report, done.report), notices, written, repairs: done.repairs, ...done.audit.data },
    fromFile: { repairs: done.said, findings: done.audit.lines, ...(done.dropped ? { designerLooksUp: done.dropped.names } : {}) },
    words: done.audit.words,
  };
}

/** An edit's result: the file written, or null and why not, and the edits made and declined. */
export interface EditDone<W extends IfExists> {
  data: LayoutRead & { written: WrittenBy<W> | null; applied: number; declined: number; notWritten?: string };
  fromFile: { applied: string[]; declined: string[]; designerLooksUp?: string[] };
}

/** Said in an edit's data when no edit could be made, so nothing was written. */
export const NO_EDIT_MADE = 'no edit was made';

/**
 * Where an edit writes: `output` when given; else, with `overInput` (the
 * server's `overwrite` with no output), over the input itself; else
 * `<name>.edited.repx` (or `.vsrepx`) beside the input.
 */
export interface EditTarget {
  output?: string;
  overInput?: boolean;
}

/**
 * An edit: the edits Forma's own chat makes (lib/agentEdit.ts `applyEdits`),
 * each a splice of the file, by control name, written to a new file unless
 * the policy replaces. A report whose connection was stored with more than
 * its name is never written over in place, and a `.vsrepx` is not written
 * where the Designer beside it looks up a name the edits removed.
 */
export async function editLayout<W extends IfExists>(raw: string, edits: readonly AgentEdit[], where: EditTarget, policy: PathPolicy<W>, run: LayoutRun): Promise<EditDone<W>> {
  const { sys, voice } = policy;
  if (!edits.length) throw new ToolRefusal(SAY[voice].noEdit);
  const { scope, report } = await opened(raw, policy);
  const replace = policy.ifExists === 'replace';
  const ext = report.kind === 'vsrepx' ? '.vsrepx' : '.repx';
  const target = outputPath(where.output ?? (where.overInput ? report.spelled : undefined), report, `.edited${ext}`, LAYOUT_EXTENSIONS, scope, sys);
  const kind = targetKind(target, report, voice);
  const inPlace = replace && sameFile(target, report.path, sys);
  const designers = kind === 'vsrepx' ? designersFor(report, target, scope, sys) : [];
  const done = await run.pipeline.run({ tool: 'edit', voice, name: report.spelled, text: report.text, target: kind, edits: [...edits], designers }, run.signal);
  if (inPlace && done.report.connectionsChanged) throw overInputRefusal(report.path, done.report.loginRemoved, voice);
  const counts = { applied: done.applied.length, declined: done.declined.length };
  const said = { applied: done.applied, declined: done.declined };
  const notices = [...done.report.notices];
  if (!done.changed) return { data: { ...readOf(report, done.report), written: null, ...counts, notWritten: NO_EDIT_MADE }, fromFile: said };
  if (done.unmarked) notices.push("Visual Studio's working-file mark was neutralised, because the file written is a .repx (DevExpress says it refuses a marked .repx from 20.2.4 on).");
  if (done.report.connectionsChanged && !done.report.loginRemoved) notices.push(CONNECTION_BY_NAME);
  const dropped = done.dropped;
  // The Designer beside the file written loads that file: a name it lost is a null field (GAP1-3).
  if (dropped?.besideTarget) {
    return { data: { ...readOf(report, done.report), notices, written: null, ...counts, notWritten: droppedNotice(dropped, voice) }, fromFile: { ...said, designerLooksUp: dropped.names } };
  }
  if (dropped) notices.push(droppedNotice(dropped, voice));
  stillWanted(run.signal);
  const written = writeReport(target, done.xml, policy.wfs ?? nodeWriteFs, sys, policy.ifExists as IfExists) as WrittenBy<W>;
  return { data: { ...readOf(report, done.report), notices, written, ...counts }, fromFile: { ...said, ...(dropped ? { designerLooksUp: dropped.names } : {}) } };
}

/** A draft PDF's result: the file written and its pages, and what drawing it could not show. */
export interface PdfDone<W extends IfExists> {
  data: LayoutRead & { written: WrittenBy<W>; pages: number };
  fromFile?: { notes: string[] };
}

/**
 * A draft PDF: the layout drawn by the engine of Forma's Preview with no
 * data, in the standard PDF fonts (lib/draftPdf.ts), written to `output`,
 * else `<name>.pdf` beside the input.
 */
export async function pdfLayout<W extends IfExists>(raw: string, output: string | undefined, policy: PathPolicy<W>, run: LayoutRun): Promise<PdfDone<W>> {
  const { sys, voice } = policy;
  const { scope, report } = await opened(raw, policy);
  const target = outputPath(output, report, '.pdf', ['.pdf'], scope, sys);
  const done = await run.pipeline.run({ tool: 'pdf', voice, name: report.spelled, text: report.text, title: sys.path.basename(report.spelled) }, run.signal);
  const drawn = done.drawn;
  if (!drawn) throw new ToolRefusal(SAY[voice].noBand(quoted(report.path, voice)));
  stillWanted(run.signal);
  const written = writeReport(target, drawn.bytes, policy.wfs ?? nodeWriteFs, sys, policy.ifExists as IfExists) as WrittenBy<W>;
  return { data: { ...readOf(report, done.report), written, pages: drawn.pages }, ...(drawn.problems.length ? { fromFile: { notes: drawn.problems } } : {}) };
}

/** Writes a report already made by the policy's rule for a taken name, while the call is still wanted. */
export function writeLayout<W extends IfExists>(target: string, xml: string, policy: PathPolicy<W>, signal: AbortSignal): WrittenBy<W> {
  stillWanted(signal);
  return writeReport(target, xml, policy.wfs ?? nodeWriteFs, policy.sys, policy.ifExists as IfExists) as WrittenBy<W>;
}

/**
 * A report written as it reads (the wave-4 review's U1): opened on the
 * caller's pipeline, its login taken out as every reading takes it, the
 * working-file mark neutralised for a `.repx`, and written to `target`: the
 * command line's batch, for a report its words changed nothing in, so its
 * output folder holds every report it was given and a rerun with
 * --skip-existing asks the AI nothing again. Never over the report itself.
 */
export async function copyLayout<W extends IfExists>(report: ReportFile, target: string, policy: PathPolicy<W>, run: LayoutRun): Promise<{ written: WrittenBy<W>; notices: string[]; audit: Audited }> {
  const { sys, voice } = policy;
  if (sameFile(target, report.path, sys)) throw new ToolRefusal(`${quoted(target, voice)} is the report itself; ${voice === 'cli' ? 'name another --out' : 'name another output'}.`);
  const done = await run.pipeline.run({ tool: 'copy', voice, name: report.spelled, text: report.text, target: targetKind(target, report, voice) }, run.signal);
  const notices = [...done.report.notices];
  if (done.report.connectionsChanged && !done.report.loginRemoved) notices.push(CONNECTION_BY_NAME);
  if (done.unmarked) notices.push("Visual Studio's working-file mark was neutralised, because the file written is a .repx (DevExpress says it refuses a marked .repx from 20.2.4 on).");
  return { written: writeLayout(target, done.xml, policy, run.signal), notices, audit: done.audit };
}

/** The report program a converted file came from, by its name. */
export type ForeignKind = 'SSRS' | 'FastReport';

/* ------------------------------------------------------------ a database's layout (the CLI work's wave 5) */

/**
 * A database's layout read on the caller's pipeline, with no report and no
 * AI (the CLI and Forma Designer work's wave 5; D1-3, D1-7): what the caller
 * says before any AI is asked, so a wrong layout, or a pinned procedure whose
 * result it does not describe, is seen before any quota is spent; and, for a
 * batch, before its first file. The files are judged and read as a call
 * reads them (reportCalls.ts `judgeDatabase`), and read again by each job
 * that uses them, at its turn.
 */
export async function readLayout(database: DatabaseInput, policy: PathPolicy, run: LayoutRun): Promise<LayoutSaid> {
  const scope = await scopeOf(policy);
  const files = await readDatabaseFiles(judgeDatabase(database, scope, policy.sys), policy.voice);
  const done = await run.pipeline.run({ tool: 'layout', voice: policy.voice, database: files }, run.signal);
  return { said: done.said, notices: done.notices, database: done.database, query: done.query };
}

/** A binding's result: the file written (null when nothing could be bound), the binding, the note, the layout read and the audit of the report bound. */
export interface BindDone<W extends IfExists> {
  data: LayoutRead & { written: WrittenBy<W> | null; bound: boolean } & AuditData;
  fromFile: { binding: BindingText; findings: string[] };
  /** The layout read: what it was, and what was not read. */
  layout: LayoutSaid;
  words: string | null;
}

/**
 * A report bound to the query pinned, with no AI (D1-11; the owner's OC7):
 * the report read and its login taken out, the layout read, the query held to
 * it and written as the report's SQL data source by the writer a generation
 * uses (nodeDatabase.ts `bindReport`, in the pipeline's bounded thread), at
 * the report's own version, then audited; written to `output`, else
 * `<name>.bound.repx` (or `.vsrepx`) beside it, never over a file unless the
 * policy replaces, and never over the report in place when its connection
 * was stored with more than its name. Nothing is written when nothing could
 * be bound, and the binding says why.
 */
export async function bindLayout<W extends IfExists>(raw: string, database: DatabaseInput, output: string | undefined, policy: PathPolicy<W>, run: LayoutRun): Promise<BindDone<W>> {
  const { sys, voice } = policy;
  const { scope, report } = await opened(raw, policy);
  const ext = report.kind === 'vsrepx' ? '.vsrepx' : '.repx';
  const target = outputPath(output, report, `.bound${ext}`, LAYOUT_EXTENSIONS, scope, sys);
  const kind = targetKind(target, report, voice);
  const judged = judgeDatabase(database, scope, sys);
  if (policy.ifExists === 'replace' && databaseFilesOf(judged).some((d) => sameFile(target, d.path, sys) && !sameFile(target, report.path, sys))) {
    throw new ToolRefusal(`${quoted(target, voice)} is the database layout the report is bound with; ${voice === 'cli' ? 'name another --out' : 'name another output'}.`);
  }
  const files = await readDatabaseFiles(judged, voice);
  const inPlace = policy.ifExists === 'replace' && sameFile(target, report.path, sys);
  const done = await run.pipeline.run({ tool: 'bind', voice, name: report.spelled, text: report.text, target: kind, database: files }, run.signal);
  if (inPlace && done.report.connectionsChanged) throw overInputRefusal(report.path, done.report.loginRemoved, voice);
  const notices = [...done.report.notices, ...done.notices];
  if (done.unmarked) notices.push("Visual Studio's working-file mark was neutralised, because the file written is a .repx (DevExpress says it refuses a marked .repx from 20.2.4 on).");
  if (done.report.connectionsChanged && !done.report.loginRemoved) notices.push(CONNECTION_BY_NAME);
  const { bound, text } = bindingParts(done.binding);
  const audit = done.audit;
  const counts = audit?.data ?? { errors: 0, warnings: 0, summary: '', findings: [] };
  const fromFile = { binding: text as BindingText, findings: audit?.lines ?? [] };
  if (!done.xml || !bound) return { data: { ...readOf(report, done.report), notices, written: null, bound: false, ...counts }, fromFile, layout: done.layout, words: null };
  stillWanted(run.signal);
  const written = writeReport(target, done.xml, policy.wfs ?? nodeWriteFs, sys, policy.ifExists as IfExists) as WrittenBy<W>;
  return { data: { ...readOf(report, done.report), notices, written, bound: true, ...counts }, fromFile, layout: done.layout, words: audit?.words ?? null };
}

/** The DevExpress version a converted report is written as (lib/importForeign.ts writes 20.1.3.0, and the repair runs at 20.1). */
export const CONVERTED_VERSION = '20.1';

/** An SSRS or FastReport report converted, not yet written: the file read, what it came from, and the report made from it, or null when it will not convert. */
export interface Converted {
  source: ForeignFile;
  from: ForeignKind;
  report: { xml: string; notices: string[]; audit: Audited; bound: ConvertBound | null } | null;
  /** What opening the file found (pipeline.ts), its notices among them. */
  read: ReportRead;
}

/** What binding a converted report did, with a database given (GAP1-5): the binding, how its query was chosen, and the layout read. */
export type ConvertBound = { binding: Binding; chosenBy: ChosenBy | null; layout: LayoutSaid };

/** Why a file will not convert, in the caller's words, its path as the caller shows one (`shown`, in quotes): an SSRS file can still be made by the AI from its text, a FastReport file cannot. */
export const notConverted = (shown: string, from: ForeignKind, voice: Voice) =>
  `${shown} could not be converted: Forma reads SSRS reports from RDL 2005 to 2016 and FastReport's .frx${from === 'SSRS' ? `, and ${SAY[voice].fromText}` : ''}. Nothing was written.`;

/** The conversion of a file already read and judged, on the caller's pipeline. */
async function converted(source: ForeignFile, policy: PathPolicy, run: LayoutRun, database?: DatabaseJob): Promise<Converted> {
  const from: ForeignKind = /\.frx$/i.test(source.path) ? 'FastReport' : 'SSRS';
  const done = await run.pipeline.run(
    { tool: 'convert', voice: policy.voice, name: source.spelled, text: source.text, file: policy.sys.path.basename(source.path), ...(database ? { database } : {}) },
    run.signal,
  );
  return { source, from, report: done.converted, read: done.report };
}

/** A database's files judged and read for a conversion, in the caller's scope: none without one. */
async function databaseFiles(database: DatabaseInput | undefined, policy: PathPolicy): Promise<DatabaseJob | undefined> {
  if (!database) return undefined;
  return readDatabaseFiles(judgeDatabase(database, await scopeOf(policy), policy.sys), policy.voice);
}

/**
 * Converts an SSRS (.rdl, .rdlc) or FastReport (.frx) report with no AI, on
 * the caller's pipeline (the worker's bounds, pipeline.ts `convert`), writing
 * nothing: the command line's batch revises what it makes when it is given
 * words (GAP1-3), and `convertLayout` writes it.
 */
export async function convertForeign(raw: string, policy: PathPolicy, run: LayoutRun, database?: DatabaseInput): Promise<Converted> {
  const scope = await scopeOf(policy);
  const source = readForeign(raw, scope, policy.sys);
  return converted(source, policy, run, await databaseFiles(database, policy));
}

/** A conversion's result: the file written, or null and why not; what it came from, the version written, the converter's notices and the audit. */
export interface ConvertDone<W extends IfExists> {
  data: { path: string; from: ForeignKind; version: string; written: WrittenBy<W> | null; notConverted?: string; notices: string[]; bound: boolean | null; chosenBy: ChosenBy | null } & AuditData;
  fromFile: { findings: string[]; binding?: BindingText };
  words: string | null;
  /** With a database given, the layout read; null without one. */
  layout: LayoutSaid | null;
}

/**
 * A conversion written: `output`, else `<name>.converted.repx` beside the
 * input, judged before the work, a `.repx` written as DevExpress 20.1 writes
 * one (`CONVERTED_VERSION`). A file that will not convert writes nothing and
 * says why (`notConverted`); the converter's notices (a formula printed as
 * written, a chart left out) are the result's notices.
 */
export async function convertLayout<W extends IfExists>(raw: string, output: string | undefined, policy: PathPolicy<W>, run: LayoutRun, database?: DatabaseInput): Promise<ConvertDone<W>> {
  const { sys, voice } = policy;
  const scope = await scopeOf(policy);
  const source = readForeign(raw, scope, sys);
  const target = resolveWritePath(output === undefined || output === '' ? besideName(source.spelled, '.converted.repx', sys) : output, scope, sys, { extensions: ['.repx'] });
  if (!target.ok) throw new ToolRefusal(target.reason);
  const done = await converted(source, policy, run, await databaseFiles(database, policy));
  const base = { path: source.path, from: done.from, version: CONVERTED_VERSION };
  if (!done.report) {
    return {
      data: { ...base, written: null, notConverted: notConverted(quoted(source.spelled, voice), done.from, voice), notices: [...done.read.notices], bound: null, chosenBy: null, errors: 0, warnings: 0, summary: '', findings: [] },
      fromFile: { findings: [] },
      words: null,
      layout: null,
    };
  }
  const bound = done.report.bound;
  const parts = bindingParts(bound?.binding ?? null);
  const report = done.report;
  stillWanted(run.signal);
  const written = writeReport(target.path, report.xml, policy.wfs ?? nodeWriteFs, sys, policy.ifExists as IfExists) as WrittenBy<W>;
  return {
    data: { ...base, written, notices: [...done.read.notices, ...report.notices], bound: parts.bound, chosenBy: bound?.chosenBy ?? null, ...report.audit.data },
    fromFile: { findings: report.audit.lines, ...(parts.text ? { binding: parts.text } : {}) },
    words: report.audit.words,
    layout: bound?.layout ?? null,
  };
}
