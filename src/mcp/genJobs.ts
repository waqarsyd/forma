/**
 * The work of the MCP server's two AI tools, generate_report and
 * revise_report, as it runs in their worker thread (2026-11-24, the MCP
 * work's wave 8): genWorker.mjs runs `makeRunner` there, generator.ts starts
 * that thread with a memory bound and a deadline sized for a generation,
 * reportCalls.ts, on the thread that answers, judges the paths, reads the
 * files and writes the result (since the CLI and Forma Designer work's wave
 * 2, for the command line too), and aiTools.ts shapes what the host is told.
 * The tests run the same runner in their own thread, with the AI stood in.
 *
 * Nothing here writes a file; whatever it returns crosses to the other thread
 * by structured clone, so it holds only data.
 *
 * ## generate_report
 *
 * lib/generationCore.ts `makeReport` through nodeGeneration.ts's Node parts,
 * as the workspace makes a report: the files taken in (a picture, a PDF, a
 * report to start from, a Word or Excel template, an SSRS or FastReport
 * report, data files), the pages read, Forma's draft, the AI chosen through
 * the free chain, the fix the print check sends back, the language the words
 * name, and Forma's own draft standing in when every AI fails on a first
 * report. A `.vsrepx` is taken in as the `.repx` it is (GAP1-2), its stored
 * login taken out by the intake as an uploaded report's is (SEC-3). What it
 * returns: the report, with Visual Studio's working-file mark neutralised
 * (it is written as a .repx) and any login a report could still carry taken
 * out, who answered and the switch note when another AI did (SEC-11), the
 * stand-in, what taking the files in said, the audit, what printing it
 * found, and the families the report names that this machine measured in a
 * stand-in (nodeFonts.ts `standInFamilies`, the CLI and Forma Designer work's
 * GAP2-4), with a notice when there are any; a redesign in revise_report
 * carries the same, an edit measures no text. A job with `standIn: false`
 * gets no stand-in: the failure alone comes back, and nothing is to be
 * written (the command line's batch, OC5).
 *
 * ## What a failure carries, and who answered
 *
 * Since the CLI and Forma Designer work's wave 3 (2026-11-24; findings
 * GAP3-2, GAP3-4 and GAP3-5, the owner's decision OC5) both results carry,
 * as plain data, three things only this thread can know, because they are
 * read off the error and the answers themselves, which never cross:
 *
 * - `limit`: the limit the AI met (lib/aiLimit.ts `limitOf`: the
 *   minute's, the day's or unknown, the wait when known, which AI), or null;
 *   for Gemini with no model pinned, when every model the key can call is
 *   parked for a limit, the one that lifts soonest decides the kind and the
 *   wait (modelParks.ts `limitAfterParks`, the parks kept in Forma's folder).
 *   With no report it is why; with Forma's draft standing in, why it does;
 *   with a report the AI made, the print check's fix (or an edit's second
 *   pass) was not answered for it, so the report is the one before that, or
 *   the translation the words asked for was not, so the report is in the
 *   language it was made in, which a notice says (the wave's review,
 *   W3R-1); with a generate job's `standIn: false` such a translation is
 *   the job's failure instead, and no report comes back. A caller waits a minute's limit out
 *   or stops at the day's.
 * - `model`: the model that designed the report, or for revise_report the
 *   one that answered the request (a redesign's is the core's), as the
 *   answer names it (geminiService's `answeringModel`: an alias is recorded
 *   as what it resolved to); null with no AI's answer (the mock's, the
 *   report's facts, Forma's draft).
 * - `fixModel`: the model whose answer went in after that one, the print
 *   check's fix or an edit's second pass kept, when another; null otherwise.
 *
 * Who answered by provider is `by`, in the result's words; a model id is
 * machinery (lib/fallbackChain.ts `switchNote`, 2026-11-11), so it is data
 * for a caller's record and never a phrase here.
 *
 * ## revise_report
 *
 * The chat's own path for a report open in the workspace (App.tsx's report
 * turn), stateless (finding PROTO-9): the file is the report, opened first as
 * every report tool opens one (reportFile.ts `openReport`: well-formed XML,
 * its login taken out). A plain question about its fields, totals, groups or
 * bands is answered from its facts with no AI (lib/reportFacts.ts); otherwise
 * the AI is shown its outline, its audit's findings and its facts, through
 * the free chain, and its answer read by `readReportOutcome`:
 *
 * - answer: the reply, and nothing written;
 * - edit: `applyEdits` by control name, one more pass when an edit was
 *   declined or brought an error (`followUpMessage`, as App's), then the two
 *   structural passes the chat's edits get (item numbering, unique Refs);
 *   when nothing could be made in place, a redesign from the words, as the
 *   chat starts one;
 * - rebuild: a redesign through `makeReport` with the report open, so the
 *   AI changes this report rather than making another; with the job's
 *   `editsOnly` (the command line's `--edits-only`, its wave 4) no redesign
 *   is made, neither here nor where an edit could not be made in place, and
 *   nothing is written;
 * - new: a different report, said so for generate_report, nothing written.
 *
 * The chat's parts with no MCP equivalent are dropped: an export, the
 * DevExpress designer, a pane to show, sample rows and Undo (the file the
 * caller named is never changed, so keeping it is the undo), each said in
 * plain words but the pane; a translation runs only when the person's words
 * ask for one (`splitTools`, the app's own rule for a guarded tool the model
 * brings alone). No Preview rows are sent, since none exist in Node, so the
 * one question the chat asks, whether rows may go, never arises; nothing is
 * elicited. A database's sample rows, which a job can carry since the CLI and
 * Forma Designer work's wave 5 (*A database*, below), are not that question:
 * they go only where the person said so before the call, by passing them on
 * the command line, or by turning them on in the MCP server's entry
 * (FORMA_DATABASE_SAMPLES, that work's wave 7; the owner's OC6). The house
 * font from the memory is not applied: the server keeps no memory.
 *
 * ## Whose words
 *
 * A job carries its caller's voice (caller.ts `Voice`) as plain data, since
 * a function cannot cross to the worker (the CLI and Forma Designer work's
 * wave 2, CLI-10): the few phrases that name the caller's own way of doing
 * a thing are said to a host's model as the server's (`repx_pdf`, this
 * server, `fromFile`, revise_report in the log) and to a person at a command
 * line as its own (the pdf command, the command line, the label its output
 * gives the stand-in fonts, revise in the log), from `WORDS`. The command
 * line's words for the stand-in fonts promise that its output lists the
 * families under "stand-in fonts", which its wave 4 prints. Everything else
 * the work says is the same to both, and the server's words are exactly
 * what they were.
 *
 * ## A database
 *
 * Since the CLI and Forma Designer work's wave 5 (2026-11-24; findings D1-2,
 * D1-7 and D1-9 of its design audit, the owner's OC6) a job can carry a
 * database's layout (`database`, nodeDatabase.ts `DatabaseJob`): the files'
 * bytes, the query the caller pinned and the connection's name, read here by
 * the one reader before anything costs a request, a layout that cannot be
 * read and a pinned procedure whose result it does not describe refused.
 * The step the core takes is built here (databaseAi.ts `databaseStep`), as
 * the workspace builds its shared database's, since a step holds functions:
 *
 * - generate: the step handed to the core with the query pinned, if any; a
 *   layout among the files is still read by the core when none is handed in
 *   (D1-1), in the caller's words (nodeDatabase.ts `WHERE`), its sample rows
 *   never.
 * - revise: the chat is shown the layout (`chatSection`) with what the
 *   report reads now: the query pinned, else the one read back from the
 *   report (sqlDrift.ts `queryFromRepx`), so a source Forma wrote is the
 *   person's choice and never "a source Forma did not write"; shown again,
 *   read back, for a second pass after a `data` edit, which binds through
 *   `dataEditHook` at the version worked out; a redesign keeps the query read
 *   back as the one chosen. A report written with a query pinned reads it,
 *   bound with no AI when the AI's change left it reading another; nothing
 *   written binds nothing, and a notice says so.
 *
 * Both results carry `binding` (nodeDatabase.ts `bindingOf`): what the report
 * written binds, read back from it after every repair, or for revise with
 * nothing written what the report read binds; null with no database. Its
 * names are the layout's and the report's, for a caller's `fromFile`.
 *
 * ## The mock, and a test's stand-ins
 *
 * With `mock` (FORMA_MCP_MOCK) the design is the mock invoice and the chat's
 * answer the web app's canned one (geminiService's `buildMockReportReply`),
 * handed in here because geminiService reads its own mock switch from Vite's
 * environment alone (NODE-6). A test hands in its own `ask` and `chat`.
 *
 * Pure ASCII.
 */
import { effectiveProvider, type EffectiveProvider } from '../lib/aiProvider';
import type { AgentTool } from '../lib/agentEdit';
import type { GenerationDeps } from '../lib/generationCore';
import type { Answered } from '../lib/fallbackChain';
import { limitOf, type AiLimit } from '../lib/aiLimit';
import { keptParks, readCachedModelSet } from '../lib/modelCache';
import type { ChatOutcome, ChatTurn, ReportConfig, chatReply } from '../services/geminiService';
import { limitAfterParks } from './modelParks';
import { nodeGeneration, type MakeHooks, type MakeStage, type NodeGeneration } from './nodeGeneration';
import { fileFrom } from './nodeIntake';
import { audited, jobFailure, type Audited, type ReportRead } from './pipeline';
import { ToolRefusal, type Voice } from './caller';
import { WHERE, bindReport, readDatabase, recordWrites, sameQuery, type Binding, type DatabaseJob, type DatabaseRead } from './nodeDatabase';
import { CONNECTION_BY_NAME, fileLines, openReport } from './reportFile';

/** What the runner is made with: plain data, so it crosses to the worker thread as `workerData`. */
export interface GenSetup {
  /** The mock invoice and the canned chat answer instead of an AI. */
  mock: boolean;
  /** A Gemini model to answer with, never probed. */
  model?: string;
  /** The locale the paper follows. */
  locale?: string;
  /** Forma's own folder; nodeGeneration's per-user one by default. */
  userFolder?: string;
  /** PaddleOCR's models; the clone's vendor/paddle by default, null for Tesseract alone. */
  paddleModels?: string | null;
  /**
   * Whose words the Node parts' own errors are in, those that say how to
   * start again once a clone is mended (nodeGeneration.ts, nodeOcr.ts): the
   * server's by default, the command line's when it starts the thread (the
   * CLI and Forma Designer work's wave 4, CLI-10).
   */
  voice?: Voice;
}

/** The chat's answer, as geminiService's `chatReply` gives it. */
export type ChatFn = typeof chatReply;

/** A test's stand-ins for the AI, in its own thread only (functions do not cross to a worker). */
export interface GenHooks {
  ask?: GenerationDeps['ask'];
  chat?: ChatFn;
  /** Where the work's own lines go; console.error by default, which the worker's pipe sends to the server's log. */
  log?: (line: string) => void;
}

/** A file the tool read, by its name, for the intake. */
export interface InputFile {
  name: string;
  bytes: Uint8Array;
}

export interface GenerateJob {
  kind: 'generate';
  /** Whose words the work's own phrases are in (the header's *Whose words*). */
  voice: Voice;
  /** The stored settings, the AI's among them (aiSettings.ts). */
  config: ReportConfig;
  /** The description, or what to make from the files. */
  words: string;
  /** Pictures, PDFs, reports, templates; then data files, taken in after them. */
  files: InputFile[];
  /**
   * False: when every AI fails nothing stands in, no report is returned and
   * the failure, with its limit, is (the core's `standIn: false`, OC5; the
   * header's *What a failure carries*). Absent, Forma's draft stands in, as
   * generate_report has it.
   */
  standIn?: boolean;
  /**
   * A database's layout handed in with the request (the header's *A
   * database*): the files as read, read again here by nodeDatabase.ts's one
   * reader, the step built here, since a step holds functions. Absent, a
   * layout among `files` is still read by the core (D1-1).
   */
  database?: DatabaseJob;
}

export interface ReviseJob {
  kind: 'revise';
  voice: Voice;
  config: ReportConfig;
  /** What to change, in words. */
  request: string;
  /** The report's path as the caller spelled it, for a refusal's words. */
  name: string;
  /** The report's text as it is on disk: `openReport` takes its login out first. */
  text: string;
  /**
   * True: a request that would take a redesign of the whole report is
   * declined rather than made, nothing written (the command line's
   * `--edits-only`, the CLI and Forma Designer work's wave 4, GAP1-3), so a
   * change asked of many reports never rewrites one wholesale. The action is
   * still `rebuild`, with nothing to write and no failure, and a notice says
   * why. The server never asks it.
   */
  editsOnly?: boolean;
  /** A database's layout handed in with the request (the header's *A database*): the chat is shown it, a `data` edit binds to it, a redesign keeps the query read back. */
  database?: DatabaseJob;
}

export type GenJob = GenerateJob | ReviseJob;

/** Where the work has got to: a stage as it starts, or the AI's answer as it streams (0 to 95). */
/** `designer`, since the CLI and Forma Designer work's wave 7: the server reading a connection's layout through Forma Designer, on its own thread before the job (databaseTools.ts). */
export type GenStage = MakeStage | 'designer' | 'starting' | 'waiting' | 'writing';
export type GenEvent = { stage: GenStage } | { stage: 'asking'; percent: number };

/** Who answered: an AI, the mock, or nobody (a question answered from the report's facts). */
export type Answerer = EffectiveProvider | 'mock' | null;

/** What printing the report found, as data and as lines (a finding can name a control). */
export interface Printed {
  data: { severity: 'error' | 'warning'; code: string }[];
  lines: string[];
}

export interface GenerateDone {
  kind: 'generate';
  /** The report to write; '' when none was made. */
  xml: string;
  by: Answerer;
  /** The switch to say when another AI answered on a limit; '' otherwise. */
  note: string;
  /** Which of Forma's drafts stood in for an AI that failed, or null. */
  standIn: string | null;
  /** Why the AI did not make the report, its first line; '' when it did. */
  failure: string;
  /** What taking the files in could not do, in Forma's words. */
  notices: string[];
  pictures: number;
  translated: { language: string; bilingual: boolean } | null;
  audit: Audited | null;
  printed: Printed;
  /** The families the report names that this machine measured in a stand-in (nodeFonts.ts): text from the report, for fromFile. */
  standInFonts: string[];
  /** The limit the AI met, as data (the header's *What a failure carries*); null when it met none. */
  limit: AiLimit | null;
  /** The model that designed the report, when an AI did and named it (the header's *What a failure carries*); null otherwise. */
  model: string | null;
  /** The model that made the print check's fix kept, when another than `model`; null otherwise. */
  fixModel: string | null;
  /** What the report written binds, read back from it (nodeDatabase.ts `bindingOf`, D1-9); null when no database was handed in or found among the files. */
  binding: Binding | null;
}

export type ReviseAction = 'answer' | 'edit' | 'unchanged' | 'rebuild' | 'new';

export interface ReviseDone {
  kind: 'revise';
  action: ReviseAction;
  /** The report to write; '' when nothing is to be written. */
  xml: string;
  /** The AI's reply, or the facts' answer: text about the report, so the result carries it under fromFile. */
  reply: string[];
  applied: string[];
  declined: string[];
  /** What changed, a line each, for fromFile. */
  changes: string[];
  /** What opening the report found, in Forma's words, and the rest the result says. */
  report: ReportRead;
  notices: string[];
  by: Answerer;
  note: string;
  /** For `new`: the request for generate_report, as the AI wrote it. */
  brief: string[];
  failure: string;
  translated: { language: string; bilingual: boolean } | null;
  audit: Audited | null;
  /** As GenerateDone's, for a report redesigned through the core; an edit measures no text, so it names none. */
  standInFonts: string[];
  /** As GenerateDone's: why the AI made nothing, or that the second pass of an edit, or a redesign's fix, was not answered for a limit. */
  limit: AiLimit | null;
  /** The model that answered the request (the chat's, for an answer or an edit) or designed the redesign; null for an answer from the report's facts. */
  model: string | null;
  /** The model whose answer went into the change after the first: an edit's second pass kept, or a redesign's fix; null when none or the same. */
  fixModel: string | null;
  /** With a database handed in: what the report written binds, or, with nothing written, what the report read binds; null without one (D1-9). */
  binding: Binding | null;
}

export type GenDone = GenerateDone | ReviseDone;

/** The phrases of the work that a host's model and a person at a command line are told differently (the header's *Whose words*). */
const WORDS = {
  mcp: {
    standInFonts:
      'Some fonts the report names were measured in a stand-in on this machine (fromFile.standInFonts names them); line breaks and the print check are approximate for them.',
    pdf: 'repx_pdf draws a draft PDF',
    noPreview: 'which this server does not have',
    revise: 'revise_report',
  },
  cli: {
    standInFonts: 'Some fonts the report names were measured in a stand-in on this machine (listed as stand-in fonts); line breaks and the print check are approximate for them.',
    pdf: 'the pdf command draws a draft PDF',
    noPreview: 'which the command line does not have',
    revise: 'revise',
  },
} as const satisfies Record<Voice, Record<string, string>>;

/**
 * The notice a report made through the core carries when some of its fonts
 * were measured in a stand-in on this machine (GAP2-4), in the server's
 * words. The families are the report's text, so the result names them under
 * fromFile, never here; the command line's words name the label its output
 * lists them under (`standInFontsNotice('cli')`).
 */
export const STAND_IN_FONTS = WORDS.mcp.standInFonts;

/** The stand-in fonts notice in the caller's words; the server's is `STAND_IN_FONTS`. */
export const standInFontsNotice = (voice: Voice): string => WORDS[voice].standInFonts;

/** Runs the AI tools' jobs on one set of Node parts, assembled on the first job. */
export interface GenRunner {
  /** Null when stopped. */
  run(job: GenJob, signal: AbortSignal, tell: (event: GenEvent) => void): Promise<GenDone | null>;
  close(): Promise<void>;
}

const stoppedError = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });

/**
 * The first line of an error's message, for the result's words, with the
 * sentence's own closing stop taken off, since a result's words go on after
 * it (the wave-8 review's W8C-3: "rate limit.. Nothing was written."). Never
 * cut short here (W8C-1): this thread has no scrubber, and a key cut in two
 * is no longer its value, so reportCalls.ts `failureSaid` cuts it only once its keys are out,
 * and the result's own clip comes after the scrub too.
 */
export function failureWords(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const line = message.split('\n').map((l) => l.trim()).find(Boolean) ?? 'the AI did not answer';
  return line.replace(/\s*[.!?]+$/, '') || 'the AI did not answer';
}

/** The canned chat answer of mock mode, with no AI asked (geminiService's, handed in: NODE-6). */
const mockChat: ChatFn = async (history, _config, signal, _partial, report) => {
  if (signal?.aborted) throw stoppedError();
  const { buildMockReportReply, buildMockChatReply } = await import('../services/geminiService');
  const last = [...history].reverse().find((t) => t.role === 'user')?.text ?? '';
  return report ? buildMockReportReply(last, report.outline, report.database) : buildMockChatReply(last);
};

/** A report as it is written, a .repx: Visual Studio's working-file mark neutralised, and refused when a login is still in it. */
async function asWritten(xml: string): Promise<string> {
  const [{ workingFileMark }, { withoutStoredLogin }] = await Promise.all([import('../lib/repairChain'), import('../lib/repxSqlDataSource')]);
  const unmarked = workingFileMark(xml, 'repx').xml;
  const clean = withoutStoredLogin(unmarked);
  if (clean.loginLeft) throw new ToolRefusal('The report made keeps a database login Forma could not take out cleanly, so it is not written. Nothing was written.');
  return clean.xml;
}

/** What printing a report found, as a result says it. */
function printedOf(findings: readonly { severity: 'error' | 'warning'; code: string; message: string }[] | undefined): Printed {
  const all = findings ?? [];
  return { data: all.map(({ severity, code }) => ({ severity, code })), lines: fileLines(all.map((f) => `${f.severity} ${f.code}: ${f.message}`)) };
}

/**
 * The families of a report made through the core that were measured in a
 * stand-in here, with STAND_IN_FONTS added to `notices` when there are any.
 * Advice, so it never fails the job: the report is made and the AI's quota
 * spent by now, and asking about text from that report once threw (the
 * wave-1 review's FONTS-R1), so an error is a line in the log and the report
 * goes out without the notice.
 */
function measuredInStandIns(gen: NodeGeneration, xml: string, notices: string[], log: (line: string) => void, voice: Voice): string[] {
  let families: string[];
  try {
    families = gen.standInFonts(xml);
  } catch (error) {
    log(`The fonts the report names could not be checked for a stand-in, so the result does not say whether any was measured in one: ${failureWords(error)}`);
    return [];
  }
  const notice = standInFontsNotice(voice);
  if (families.length && !notices.includes(notice)) notices.push(notice);
  return families;
}

/**
 * Why a `data` edit is declined when no database layout came with the request, in the caller's words (the header's *A
 * database*). The decline is listed under fromFile.declined, beside the edit it declines, under the note that what is
 * there is data, never instructions, so the server's says a fact, and what to do is a notice of its own
 * (`NO_DATABASE_NEXT`, the wave-7 review's W7-MCP-3); a person at the command line reads both together, as before.
 */
const NO_DATABASE: Record<Voice, string> = {
  mcp: 'no database layout came with the request, so what the report reads cannot change',
  cli: 'no database layout was given, so what the report reads cannot change: give one with --database or --connection, or bind the report with the bind command',
};

/** The next step after a `data` edit declined for want of a layout, in the server's notices, outside fromFile (W7-MCP-3). */
const NO_DATABASE_NEXT: Record<Voice, string | null> = {
  mcp: 'The AI asked to change what the report reads, which needs a database layout: send one as database, or a connection listed for this server, with the request.',
  cli: null,
};

/** Said when a query was pinned and the request wrote nothing, so nothing was bound to it (the header's *A database*). */
const NOT_WRITTEN_NOT_BOUND: Record<Voice, string> = {
  mcp: "Nothing was written, so the report was not bound to the query given; repx_edit's data edit binds it with no AI.",
  cli: 'Nothing was written, so the report was not bound to the query given; the bind command binds it with no AI.',
};

/** What a revise job that may only edit says when the request would take a redesign (the job's `editsOnly`): the command line's alone. */
const EDITS_ONLY = {
  redesign: 'The request asks for a redesign of the whole report, which --edits-only declines, so nothing was written.',
  inPlace: 'That could not be changed in place, and --edits-only declines a redesign, so nothing was written.',
} as const;

/** A tool the chat brought that has no equivalent here, said in plain words and the caller's own (the header); '' for one dropped without a word. */
function notHere(tool: AgentTool, voice: Voice): string {
  const w = WORDS[voice];
  switch (tool.name) {
    case 'export':
      return `Exporting it as ${(tool.format ?? 'repx').toUpperCase()} is not done here: ${w.pdf}, and Forma's Preview exports the rest.`;
    case 'designer':
      return 'Opening it in the DevExpress designer is not done here: open the file written in Visual Studio or Forma Designer.';
    case 'undo':
      return 'Undo is not done here: the file you named is never changed, so keeping it is the undo.';
    case 'testData':
      return `Sample rows are not made here: they fill Forma's Preview, ${w.noPreview}.`;
    default:
      return '';
  }
}

/** The answer's progress from the length of the chat's reply so far, as geminiService shapes a report's (0 to 95). */
const chatPercent = (chars: number) => Math.min(95, Math.round(100 * (1 - Math.exp(-chars / 1500))));

/** The runner, its Node parts assembled on the first job (a failure there is the job's, and the next job tries again). */
export function makeRunner(setup: GenSetup, hooks: GenHooks = {}): GenRunner {
  const log = hooks.log ?? ((line: string) => console.error(line));
  let parts: Promise<NodeGeneration> | null = null;
  const ready = () =>
    (parts ??= nodeGeneration({
      mock: setup.mock,
      ...(setup.model ? { model: setup.model } : {}),
      ...(setup.locale ? { locale: setup.locale } : {}),
      ...(setup.userFolder ? { userFolder: setup.userFolder } : {}),
      ...(setup.paddleModels !== undefined ? { paddleModels: setup.paddleModels } : {}),
      ...(setup.voice ? { voice: setup.voice } : {}),
      ...(hooks.ask ? { ask: hooks.ask } : {}),
      log,
    }).catch((error: unknown) => {
      parts = null;
      throw error;
    }));
  const chat: ChatFn = hooks.chat ?? (setup.mock ? mockChat : async (...args) => (await import('../services/geminiService')).chatReply(...args));
  const answerer = (by: EffectiveProvider): Answerer => (setup.mock ? 'mock' : by);
  /**
   * The limit an error is (lib/aiLimit.ts `limitOf`), with the parks
   * kept for the key laid over it (modelParks.ts `limitAfterParks`): when
   * every model the key can call is parked, the soonest it can be asked
   * again. A pinned model is never parked, so its limit is the error's alone.
   */
  const limitFrom = (error: unknown, by: EffectiveProvider, config: ReportConfig): AiLimit | null => {
    const limit = limitOf(error, by);
    if (setup.model?.trim() || config.modelName?.trim()) return limit;
    return limitAfterParks(limit, keptParks(config.customApiKey ?? ''), readCachedModelSet());
  };

  const makeHooks = (tell: (event: GenEvent) => void): MakeHooks => ({
    onStage: (stage) => tell({ stage }),
    onProgress: (progress) => tell({ stage: 'asking', percent: progress.percent }),
  });

  async function generate(job: GenerateJob, gen: NodeGeneration, signal: AbortSignal, tell: (event: GenEvent) => void): Promise<GenerateDone | null> {
    // A .vsrepx is the same serializer XML, taken in as a .repx (GAP1-2).
    const files = job.files.map((f, i) => ({ file: fileFrom(f.name.replace(/\.vsrepx$/i, '.repx'), f.bytes), uploadId: `mcp-${i + 1}` }));
    if (files.length || job.database) tell({ stage: 'reading' });
    // The database handed in, read before anything costs a request (a layout that cannot be read is refused here); its step
    // built in this thread, since a step holds functions (D1-2). What each write of the source did is kept for the binding.
    const db = job.database ? await readDatabase(job.database, job.voice) : null;
    const seen = recordWrites();
    const where = WHERE[job.voice];
    const step = db && job.database ? (await import('../lib/databaseAi')).databaseStep(db.schema, { query: db.query, connectionName: job.database.connectionName, where, onWritten: seen.onWritten }) : undefined;
    const made = await gen.make(
      {
        files,
        words: files.length ? job.words : '',
        ...(files.length ? {} : { description: { description: job.words } }),
        config: job.config,
        signal,
        ...(job.standIn === false ? { standIn: false } : {}),
        // A layout among the files, when none was handed in, in the caller's words; its sample rows never (OC6).
        layoutFiles: { where, onWritten: seen.onWritten },
      },
      makeHooks(tell),
      step ? { database: step } : undefined,
    );
    if (!made || signal.aborted) return null;
    const chosen = effectiveProvider(job.config);
    const bindingFor = (xml: string) => seen.bindingOf(xml, db?.schema ?? null);
    const base = { kind: 'generate' as const, notices: [...(db?.notices ?? []), ...made.notices], pictures: made.pictures, translated: null, audit: null, printed: printedOf([]), standInFonts: [] as string[], model: null, fixModel: null, binding: null };
    if (made.ok) {
      const xml = await asWritten(made.repxContent);
      // The translation the words asked for, when it failed, is said, as revise_report says its own (the wave-3 review, W3R-1).
      if (made.translateFailed) base.notices.push(`The report could not be translated into ${made.translateFailed.language}; it stays in the language it was made in.`);
      const standInFonts = measuredInStandIns(gen, xml, base.notices, log, job.voice);
      // A step after the report that failed on a limit (the translation asked for, else the print check's fix) says when
      // the AI can be asked again: of the AI that answered, which both are asked of, and which a limit's switch may have
      // made another than the one chosen. The translation comes after the fix, so it is the later word on the limit.
      const translateLimit = made.translateFailed ? limitFrom(made.translateFailed.error, made.by, job.config) : null;
      return {
        ...base,
        xml,
        by: answerer(made.by),
        note: made.note,
        standIn: null,
        failure: '',
        translated: made.translated,
        audit: await audited(xml),
        printed: printedOf(made.response.printFindings),
        standInFonts,
        limit: translateLimit ?? (made.fixFailed === undefined ? null : limitFrom(made.fixFailed, made.by, job.config)),
        model: made.model,
        fixModel: made.fixModel,
        binding: await bindingFor(xml),
      };
    }
    // With standIn false, a report made whose translation then failed is no report (the core's *Nothing standing in*): said as the translation's failure.
    const failure = made.translating ? `the translation into ${made.translating} the request asks for did not answer: ${failureWords(made.error)}` : failureWords(made.error);
    const limit = limitFrom(made.error, made.by ?? chosen, job.config);
    if (made.standIn?.result.repxContent) {
      const xml = await asWritten(made.standIn.result.repxContent);
      const standInFonts = measuredInStandIns(gen, xml, base.notices, log, job.voice);
      return { ...base, xml, by: null, note: '', standIn: made.standIn.source, failure, audit: await audited(xml), standInFonts, limit, binding: await bindingFor(xml) };
    }
    return { ...base, xml: '', by: null, note: '', standIn: null, failure, limit };
  }

  /**
   * revise_report's work with the database handed in (the header's *A
   * database*): read first, so a layout that cannot be read costs no
   * request; then the work, and the binding read back from the report
   * written, or from the report as it is when nothing is.
   */
  async function revise(job: ReviseJob, gen: NodeGeneration, signal: AbortSignal, tell: (event: GenEvent) => void): Promise<ReviseDone | null> {
    tell({ stage: 'reading' });
    const opened = openReport(job.text, job.name, job.voice);
    const db = job.database ? await readDatabase(job.database, job.voice) : null;
    const seen = recordWrites();
    const done = await reviseWith(job, gen, signal, tell, opened, db && job.database ? { read: db, job: job.database, seen } : null);
    if (!done || !db) return done;
    // A query pinned binds only a report written: said when nothing is.
    const unpinned = db.query && !done.xml && !done.failure ? [NOT_WRITTEN_NOT_BOUND[job.voice]] : [];
    return { ...done, notices: [...db.notices, ...done.notices, ...unpinned], binding: await seen.bindingOf(done.xml || opened.xml, db.schema) };
  }

  async function reviseWith(
    job: ReviseJob,
    gen: NodeGeneration,
    signal: AbortSignal,
    tell: (event: GenEvent) => void,
    opened: ReturnType<typeof openReport>,
    db: { read: DatabaseRead; job: DatabaseJob; seen: ReturnType<typeof recordWrites> } | null,
  ): Promise<ReviseDone | null> {
    const w = WORDS[job.voice];
    const open = opened.xml;
    const report: ReportRead = { loginRemoved: opened.loginRemoved, connectionsChanged: opened.connectionsChanged, notices: opened.notices };
    const notices: string[] = [];
    const [agent, factsLib, { auditRepx }, { applyDetected }] = await Promise.all([import('../lib/agentEdit'), import('../lib/reportFacts'), import('../lib/repxAudit'), import('../lib/autoConfig')]);
    const empty = {
      kind: 'revise' as const,
      xml: '',
      reply: [] as string[],
      applied: [] as string[],
      declined: [] as string[],
      changes: [] as string[],
      report,
      notices,
      note: '',
      brief: [] as string[],
      failure: '',
      translated: null,
      audit: null,
      standInFonts: [] as string[],
      limit: null as AiLimit | null,
      model: null as string | null,
      fixModel: null as string | null,
      binding: null,
    };
    const chosen = effectiveProvider(job.config);

    // The settings worked out with the report laid over the stored ones, as the workspace's are.
    const asked = gen.config(applyDetected(job.config, gen.deps(job.config, open).detect({ words: job.request })));
    const facts = factsLib.reportFacts(open);
    // A plain question about the report's fields, totals, groups or bands: its facts answer, with no AI and no request.
    const known = factsLib.answerFromFacts(job.request, facts);
    if (known) return { ...empty, action: 'answer', reply: fileLines(known.split('\n')), by: null };

    // The database handed in (D1-2): what the report reads now is the query the caller pinned, else the one read back from
    // the report, so a source Forma wrote is the person's choice and never "a source Forma did not write"; read again from
    // the report a data edit changed, for the second pass.
    const [dbAi, drift] = db ? await Promise.all([import('../lib/databaseAi'), import('../lib/sqlDrift')]) : [null, null];
    const nowOf = (xml: string) => (db && drift ? (xml === open && db.read.query ? db.read.query : drift.queryFromRepx(xml, db.read.schema)) : null);
    const databaseFor = (xml: string) => (db && dbAi ? { database: dbAi.chatSection(db.read.schema, { query: nowOf(xml), words: job.request, repx: xml }) } : {});
    /** A report written with a query pinned reads it, bound with no AI when the AI's change left it reading another (nodeDatabase.ts `bindReport`). */
    const pinnedOn = async (xml: string): Promise<string> => {
      if (!db?.read.query || !drift || (await sameQuery(drift.queryFromRepx(xml, db.read.schema), db.read.query))) return xml;
      const bound = await bindReport(xml, db.read.schema, db.read.query, { connectionName: db.job.connectionName, version: asked.version, voice: job.voice });
      // Kept with the binding read back after, never in the plain notices: its words name the files' names (W5-PB-11).
      db.seen.onWritten(bound.written, db.read.schema);
      db.seen.note(...bound.binding.notes, ...(bound.binding.bound ? [] : [bound.note]));
      return bound.xml;
    };

    const outline = `${agent.reportOutline(open, { findings: auditRepx(open).findings.map((f) => f.message) })}\n${factsLib.factsBlock(facts)}`;
    const reportFor = (xml: string) => ({ outline: xml === open ? outline : agent.reportOutline(xml), ops: agent.EDIT_OPS, tools: agent.TOOL_LISTS, ...databaseFor(xml) });
    const history: ChatTurn[] = [{ role: 'user', text: job.request }];
    const { askWithChain } = await import('../lib/fallbackChain');
    tell({ stage: 'asking' });
    let chained: Answered<ChatOutcome>;
    try {
      chained = await askWithChain(asked, (c) => chat(history, c, signal, (text) => tell({ stage: 'asking', percent: chatPercent(text.length) }), reportFor(open)), signal);
    } catch (error) {
      // Every AI set up failed: said in plain words, nothing written (a wrong key, a limit, a server not running).
      if (signal.aborted) return null;
      log(`${w.revise}: the AI did not answer: ${failureWords(error)}`);
      return { ...empty, action: 'answer', by: null, failure: failureWords(error), limit: limitFrom(error, chosen, job.config) };
    }
    if (signal.aborted) return null;
    tell({ stage: 'checking' });
    const outcome = agent.readReportOutcome(chained.value, job.request);
    let by = answerer(chained.by);
    const notes = new Set([chained.note].filter(Boolean));
    /** The model that answered the request, as the chat names it (GAP3-4): every result from here on is that answer's, but a redesign's. */
    const answered = { ...empty, model: chained.value.model ?? null };

    // A redesign or a new report that hinges on a field the report's data lacks is declined; a reply naming one says so.
    const invented = factsLib.inventedFields(`${outcome.reply ?? ''} ${outcome.brief ?? ''}`, facts);
    if (invented.length && (outcome.action === 'rebuild' || outcome.action === 'new')) {
      return { ...answered, action: 'answer', reply: fileLines(factsLib.declinedForFields(invented, facts).split('\n')), by, note: [...notes].join(' ') };
    }
    const reply = invented.length ? `${outcome.reply}\n\n${factsLib.inventedNote(invented)}` : outcome.reply;
    const designWords = outcome.brief || job.request;

    // The chat's tools: a translation only when the words ask for it; the rest have no equivalent here (PROTO-9).
    const split = agent.splitTools(outcome.tools ?? [], job.request);
    if (split.dropped.length) log(`${w.revise} dropped what the request did not ask for: ${split.dropped.map((t) => t.name).join(', ')}.`);
    const translateTool = split.now.find((t) => t.name === 'translate');
    for (const tool of split.now) {
      const said = notHere(tool, job.voice);
      if (said && !notices.includes(said)) notices.push(said);
    }
    const declinedTools = outcome.toolsDeclined ?? [];

    /** The limit the translation the words asked for met, when it failed on one (the wave-3 review, W3R-1, as generate's): why the report is not translated. */
    let translateLimit: AiLimit | null = null;
    const translated = async (xml: string): Promise<{ xml: string; translated: ReviseDone['translated'] }> => {
      if (!translateTool) return { xml, translated: null };
      const tr = await import('../lib/repxTranslate');
      const language = tr.languageName(translateTool.language) || tr.languageAsked(job.request);
      if (!language) {
        notices.push("Name the language to translate into, and it is translated.");
        return { xml, translated: null };
      }
      try {
        const done = await tr.translateReportXml(xml, language, signal, job.request, chained.config, gen.deps(asked, open).translateTexts);
        if (done.note) notes.add(done.note);
        return { xml: done.xml, translated: { language, bilingual: done.bilingual } };
      } catch (error) {
        if (signal.aborted) throw error;
        notices.push(`The report could not be translated into ${language}; it stays as it was.`);
        log(`${w.revise}: the translation failed: ${failureWords(error)}`);
        // Asked of the AI that answered the request, which a limit's switch may have made another than the one chosen.
        translateLimit = limitFrom(error, effectiveProvider(chained.config), job.config);
        return { xml, translated: null };
      }
    };

    /** A redesign through the generation core, with this report open. */
    const redesign = async (): Promise<ReviseDone | null> => {
      // With a database, the redesign keeps what the report reads now as the query chosen (D1-2), as the workspace's does.
      const step = db && dbAi ? dbAi.databaseStep(db.read.schema, { query: nowOf(open), connectionName: db.job.connectionName, where: WHERE[job.voice], onWritten: db.seen.onWritten }) : undefined;
      const made = await gen.make({ words: designWords, open: { repxContent: open }, config: job.config, signal }, makeHooks(tell), step ? { database: step } : undefined);
      if (!made || signal.aborted) return null;
      notices.push(...made.notices);
      if (!made.ok) return { ...answered, action: 'rebuild', reply: fileLines([reply]), by, note: [...notes].join(' '), failure: failureWords(made.error), limit: limitFrom(made.error, chosen, job.config) };
      if (made.note) notes.add(made.note);
      by = answerer(made.by);
      const xml = await asWritten(await pinnedOn(made.repxContent));
      return {
        ...empty,
        action: 'rebuild',
        xml,
        reply: fileLines([reply]),
        changes: fileLines(agent.describeChanges(open, xml)),
        by,
        note: [...notes].join(' '),
        translated: made.translated,
        audit: await audited(xml),
        standInFonts: measuredInStandIns(gen, xml, notices, log, job.voice),
        // The redesign is the core's answer: its model, and its fix's (GAP3-4); a fix not answered for a limit says so, of the AI that answered.
        limit: made.fixFailed === undefined ? null : limitFrom(made.fixFailed, made.by, job.config),
        model: made.model,
        fixModel: made.fixModel,
      };
    };

    /** With `editsOnly`, a redesign declined and nothing written, said why (the job's `editsOnly`, GAP1-3). */
    const noRedesign = (why: string, declined: readonly string[] = []): ReviseDone => {
      notices.push(why);
      return { ...answered, action: 'rebuild', reply: fileLines([reply]), declined: fileLines([...declined]), by, note: [...notes].join(' ') };
    };

    if (outcome.action === 'new') return { ...answered, action: 'new', reply: fileLines([reply]), brief: fileLines([designWords]), by, note: [...notes].join(' ') };
    if (outcome.action === 'rebuild' || (outcome.wantsReport && outcome.action !== 'edit')) {
      return job.editsOnly ? noRedesign(EDITS_ONLY.redesign) : redesign();
    }

    if (outcome.action === 'edit') {
      // A `data` edit binds to the database handed in, at the version worked out, as App's (SD-25); without one it is declined
      // in the caller's words, never the Data tab's, which agentEdit.ts says when no hook is given (D1-8).
      const hooks = {
        fields: (xml: string) => factsLib.dataFieldsOf(xml),
        data:
          db && dbAi
            ? dbAi.dataEditHook(db.read.schema, asked.version, () => undefined, { connectionName: db.job.connectionName })
            : (xml: string) => {
                const next = NO_DATABASE_NEXT[job.voice];
                if (next && !notices.includes(next)) notices.push(next);
                return { xml, applied: false, reason: NO_DATABASE[job.voice] };
              },
      };
      let done = agent.applyEdits(open, outcome.edits ?? [], hooks);
      const errorsOf = (xml: string) => auditRepx(xml).findings.filter((f) => f.severity === 'error').map((f) => f.message);
      const errorsBefore = new Set(errorsOf(open));
      const brought = done.changed ? errorsOf(done.xml).filter((m) => !errorsBefore.has(m)) : [];
      // One more pass when an edit could not be made or brought an error, as App's (agent audit item 23).
      /** The second pass's model when its edits were kept and another answered it, and the limit that kept it from answering (GAP3-2, GAP3-4). */
      let second: { fixModel: string | null; limit: AiLimit | null } = { fixModel: null, limit: null };
      if (done.declined.length || brought.length) {
        try {
          const again = await chat(
            [...history, { role: 'assistant', text: outcome.reply || 'Made the edits.' }, { role: 'user', text: agent.followUpMessage(done.declined, brought) }],
            chained.config,
            signal,
            undefined,
            reportFor(done.xml),
          );
          if (signal.aborted) return null;
          const read = agent.readReportOutcome(again);
          const more = read.action === 'edit' && read.edits.length ? agent.applyEdits(done.xml, read.edits, hooks) : null;
          if (more?.changed) {
            done = { xml: more.xml, applied: [...done.applied, ...more.applied], appliedOps: [...done.appliedOps, ...more.appliedOps], declined: more.declined, changed: true };
            if (again.model && again.model !== answered.model) second = { ...second, fixModel: again.model };
          }
        } catch (error) {
          if (signal.aborted) return null;
          log(`${w.revise}: the second pass did not answer; the first stands: ${failureWords(error)}`);
          // Asked of the AI that answered the first pass, which a limit's switch may have made another than the one chosen.
          second = { ...second, limit: limitFrom(error, effectiveProvider(chained.config), job.config) };
        }
      }
      if (done.changed) {
        // The structural repairs the chat's edits get (ARCH-2): neither moves anything.
        const [{ normalizeItemNames }, { ensureUniqueRefs }] = await Promise.all([import('../lib/repxItems'), import('../lib/repxRefs')]);
        let xml = done.xml;
        for (const pass of [normalizeItemNames, ensureUniqueRefs]) {
          const fixed = pass(xml);
          if (fixed.applied) xml = fixed.xml;
        }
        const after = await translated(await pinnedOn(xml));
        const written = await asWritten(after.xml);
        return {
          ...answered,
          ...second,
          // The translation comes after the second pass, so a limit it met is the later word.
          ...(translateLimit ? { limit: translateLimit } : {}),
          action: 'edit',
          xml: written,
          reply: fileLines([reply]),
          applied: fileLines(done.applied),
          declined: fileLines([...done.declined, ...declinedTools]),
          changes: fileLines(agent.describeChanges(open, written)),
          by,
          note: [...notes].join(' '),
          translated: after.translated,
          audit: await audited(written),
        };
      }
      // The report already reads that way: said so, nothing written.
      if (done.applied.length) return { ...answered, ...second, action: 'unchanged', reply: fileLines([reply]), applied: fileLines(done.applied), declined: fileLines([...done.declined, ...declinedTools]), by, note: [...notes].join(' ') };
      // Nothing could be made in place: a redesign from the words, as the chat starts one, unless only edits may be made.
      if (job.editsOnly) return noRedesign(EDITS_ONLY.inPlace, done.declined);
      notices.push('That could not be changed in place, so the report was redesigned from the request.');
      const remade = await redesign();
      return remade && { ...remade, declined: fileLines(done.declined) };
    }

    // An answer, which may carry a translation the words asked for.
    if (translateTool) {
      const after = await translated(open);
      if (after.translated && after.xml !== open) {
        const written = await asWritten(await pinnedOn(after.xml));
        return { ...answered, action: 'edit', xml: written, reply: fileLines([reply]), changes: fileLines(agent.describeChanges(open, written)), declined: fileLines(declinedTools), by, note: [...notes].join(' '), translated: after.translated, audit: await audited(written) };
      }
    }
    return { ...answered, action: 'answer', reply: fileLines([reply]), declined: fileLines(declinedTools), by, note: [...notes].join(' '), limit: translateLimit };
  }

  return {
    async run(job, signal, tell) {
      if (signal.aborted) return null;
      const gen = await ready();
      if (signal.aborted) return null;
      try {
        const done = job.kind === 'generate' ? await generate(job, gen, signal, tell) : await revise(job, gen, signal, tell);
        if (done?.kind === 'revise' && done.report.connectionsChanged && !done.report.loginRemoved && done.xml) done.notices.push(CONNECTION_BY_NAME);
        return signal.aborted ? null : done;
      } catch (error) {
        if (signal.aborted) return null;
        throw error;
      }
    },
    async close() {
      const assembled = parts;
      parts = null;
      if (assembled) await (await assembled.catch(() => null))?.close();
    },
  };
}

/** How a job's failure crosses back from the worker: a refusal's words, or an error's stack for the log (pipeline.ts's rule). */
export const genFailure = jobFailure;
