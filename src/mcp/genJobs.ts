/**
 * The work of the MCP server's two AI tools, generate_report and
 * revise_report, as it runs in their worker thread (2026-11-24, the MCP
 * work's wave 8): genWorker.mjs runs `makeRunner` there, generator.ts starts
 * that thread with a memory bound and a deadline sized for a generation, and
 * aiTools.ts, on the thread that answers the host, judges the paths, reads
 * the files, writes the result and shapes what the host is told. The tests
 * run the same runner in their own thread, with the AI stood in.
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
 * carries the same, an edit measures no text.
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
 *   AI changes this report rather than making another;
 * - new: a different report, said so for generate_report, nothing written.
 *
 * The chat's parts with no MCP equivalent are dropped: an export, the
 * DevExpress designer, a pane to show, sample rows and Undo (the file the
 * caller named is never changed, so keeping it is the undo), each said in
 * plain words but the pane; a translation runs only when the person's words
 * ask for one (`splitTools`, the app's own rule for a guarded tool the model
 * brings alone). No rows are sent, since none exist in Node, so the one
 * question the chat asks, whether rows may go, never arises; nothing is
 * elicited. The house font from the memory is not applied: the server keeps
 * no memory.
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
import type { EffectiveProvider } from '../lib/aiProvider';
import type { AgentTool } from '../lib/agentEdit';
import type { GenerationDeps } from '../lib/generationCore';
import type { Answered } from '../lib/fallbackChain';
import type { ChatOutcome, ChatTurn, ReportConfig, chatReply } from '../services/geminiService';
import { nodeGeneration, type MakeHooks, type MakeStage, type NodeGeneration } from './nodeGeneration';
import { fileFrom } from './nodeIntake';
import { audited, jobFailure, type Audited, type ReportRead } from './pipeline';
import { CONNECTION_BY_NAME, fileLines, openReport } from './reportFile';
import { ToolRefusal } from './toolShape';

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
  /** The stored settings, the AI's among them (aiSettings.ts). */
  config: ReportConfig;
  /** The description, or what to make from the files. */
  words: string;
  /** Pictures, PDFs, reports, templates; then data files, taken in after them. */
  files: InputFile[];
}

export interface ReviseJob {
  kind: 'revise';
  config: ReportConfig;
  /** What to change, in words. */
  request: string;
  /** The report's path as the caller spelled it, for a refusal's words. */
  name: string;
  /** The report's text as it is on disk: `openReport` takes its login out first. */
  text: string;
}

export type GenJob = GenerateJob | ReviseJob;

/** Where the work has got to: a stage as it starts, or the AI's answer as it streams (0 to 95). */
export type GenStage = MakeStage | 'starting' | 'waiting' | 'writing';
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
}

export type GenDone = GenerateDone | ReviseDone;

/**
 * The notice a report made through the core carries when some of its fonts
 * were measured in a stand-in on this machine (GAP2-4). The families are the
 * report's text, so the result names them under fromFile, never here.
 */
export const STAND_IN_FONTS =
  'Some fonts the report names were measured in a stand-in on this machine (fromFile.standInFonts names them); line breaks and the print check are approximate for them.';

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
 * is no longer its value, so aiTools.ts cuts it only once its keys are out,
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
function measuredInStandIns(gen: NodeGeneration, xml: string, notices: string[], log: (line: string) => void): string[] {
  let families: string[];
  try {
    families = gen.standInFonts(xml);
  } catch (error) {
    log(`The fonts the report names could not be checked for a stand-in, so the result does not say whether any was measured in one: ${failureWords(error)}`);
    return [];
  }
  if (families.length && !notices.includes(STAND_IN_FONTS)) notices.push(STAND_IN_FONTS);
  return families;
}

/** A tool the chat brought that has no equivalent here, said in plain words; '' for one dropped without a word. */
function notHere(tool: AgentTool): string {
  switch (tool.name) {
    case 'export':
      return `Exporting it as ${(tool.format ?? 'repx').toUpperCase()} is not done here: repx_pdf draws a draft PDF, and Forma's Preview exports the rest.`;
    case 'designer':
      return 'Opening it in the DevExpress designer is not done here: open the file written in Visual Studio or Forma Designer.';
    case 'undo':
      return 'Undo is not done here: the file you named is never changed, so keeping it is the undo.';
    case 'testData':
      return "Sample rows are not made here: they fill Forma's Preview, which this server does not have.";
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
      ...(hooks.ask ? { ask: hooks.ask } : {}),
      log,
    }).catch((error: unknown) => {
      parts = null;
      throw error;
    }));
  const chat: ChatFn = hooks.chat ?? (setup.mock ? mockChat : async (...args) => (await import('../services/geminiService')).chatReply(...args));
  const answerer = (by: EffectiveProvider): Answerer => (setup.mock ? 'mock' : by);

  const makeHooks = (tell: (event: GenEvent) => void): MakeHooks => ({
    onStage: (stage) => tell({ stage }),
    onProgress: (progress) => tell({ stage: 'asking', percent: progress.percent }),
  });

  async function generate(job: GenerateJob, gen: NodeGeneration, signal: AbortSignal, tell: (event: GenEvent) => void): Promise<GenerateDone | null> {
    // A .vsrepx is the same serializer XML, taken in as a .repx (GAP1-2).
    const files = job.files.map((f, i) => ({ file: fileFrom(f.name.replace(/\.vsrepx$/i, '.repx'), f.bytes), uploadId: `mcp-${i + 1}` }));
    if (files.length) tell({ stage: 'reading' });
    const made = await gen.make(
      { files, words: files.length ? job.words : '', ...(files.length ? {} : { description: { description: job.words } }), config: job.config, signal },
      makeHooks(tell),
    );
    if (!made || signal.aborted) return null;
    const base = { kind: 'generate' as const, notices: [...made.notices], pictures: made.pictures, translated: null, audit: null, printed: printedOf([]), standInFonts: [] as string[] };
    if (made.ok) {
      const xml = await asWritten(made.repxContent);
      const standInFonts = measuredInStandIns(gen, xml, base.notices, log);
      return { ...base, xml, by: answerer(made.by), note: made.note, standIn: null, failure: '', translated: made.translated, audit: await audited(xml), printed: printedOf(made.response.printFindings), standInFonts };
    }
    const failure = failureWords(made.error);
    if (made.standIn?.result.repxContent) {
      const xml = await asWritten(made.standIn.result.repxContent);
      const standInFonts = measuredInStandIns(gen, xml, base.notices, log);
      return { ...base, xml, by: null, note: '', standIn: made.standIn.source, failure, audit: await audited(xml), standInFonts };
    }
    return { ...base, xml: '', by: null, note: '', standIn: null, failure };
  }

  async function revise(job: ReviseJob, gen: NodeGeneration, signal: AbortSignal, tell: (event: GenEvent) => void): Promise<ReviseDone | null> {
    tell({ stage: 'reading' });
    const opened = openReport(job.text, job.name);
    const open = opened.xml;
    const report: ReportRead = { loginRemoved: opened.loginRemoved, connectionsChanged: opened.connectionsChanged, notices: opened.notices };
    const notices: string[] = [];
    const [agent, factsLib, { auditRepx }, { applyDetected }] = await Promise.all([import('../lib/agentEdit'), import('../lib/reportFacts'), import('../lib/repxAudit'), import('../lib/autoConfig')]);
    const empty = { kind: 'revise' as const, xml: '', reply: [] as string[], applied: [] as string[], declined: [] as string[], changes: [] as string[], report, notices, note: '', brief: [] as string[], failure: '', translated: null, audit: null, standInFonts: [] as string[] };

    // The settings worked out with the report laid over the stored ones, as the workspace's are.
    const asked = gen.config(applyDetected(job.config, gen.deps(job.config, open).detect({ words: job.request })));
    const facts = factsLib.reportFacts(open);
    // A plain question about the report's fields, totals, groups or bands: its facts answer, with no AI and no request.
    const known = factsLib.answerFromFacts(job.request, facts);
    if (known) return { ...empty, action: 'answer', reply: fileLines(known.split('\n')), by: null };

    const outline = `${agent.reportOutline(open, { findings: auditRepx(open).findings.map((f) => f.message) })}\n${factsLib.factsBlock(facts)}`;
    const reportFor = (xml: string) => ({ outline: xml === open ? outline : agent.reportOutline(xml), ops: agent.EDIT_OPS, tools: agent.TOOL_LISTS });
    const history: ChatTurn[] = [{ role: 'user', text: job.request }];
    const { askWithChain } = await import('../lib/fallbackChain');
    tell({ stage: 'asking' });
    let chained: Answered<ChatOutcome>;
    try {
      chained = await askWithChain(asked, (c) => chat(history, c, signal, (text) => tell({ stage: 'asking', percent: chatPercent(text.length) }), reportFor(open)), signal);
    } catch (error) {
      // Every AI set up failed: said in plain words, nothing written (a wrong key, a limit, a server not running).
      if (signal.aborted) return null;
      log(`revise_report: the AI did not answer: ${failureWords(error)}`);
      return { ...empty, action: 'answer', by: null, failure: failureWords(error) };
    }
    if (signal.aborted) return null;
    tell({ stage: 'checking' });
    const outcome = agent.readReportOutcome(chained.value, job.request);
    let by = answerer(chained.by);
    const notes = new Set([chained.note].filter(Boolean));

    // A redesign or a new report that hinges on a field the report's data lacks is declined; a reply naming one says so.
    const invented = factsLib.inventedFields(`${outcome.reply ?? ''} ${outcome.brief ?? ''}`, facts);
    if (invented.length && (outcome.action === 'rebuild' || outcome.action === 'new')) {
      return { ...empty, action: 'answer', reply: fileLines(factsLib.declinedForFields(invented, facts).split('\n')), by, note: [...notes].join(' ') };
    }
    const reply = invented.length ? `${outcome.reply}\n\n${factsLib.inventedNote(invented)}` : outcome.reply;
    const designWords = outcome.brief || job.request;

    // The chat's tools: a translation only when the words ask for it; the rest have no equivalent here (PROTO-9).
    const split = agent.splitTools(outcome.tools ?? [], job.request);
    if (split.dropped.length) log(`revise_report dropped what the request did not ask for: ${split.dropped.map((t) => t.name).join(', ')}.`);
    const translateTool = split.now.find((t) => t.name === 'translate');
    for (const tool of split.now) {
      const said = notHere(tool);
      if (said && !notices.includes(said)) notices.push(said);
    }
    const declinedTools = outcome.toolsDeclined ?? [];

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
        log(`revise_report: the translation failed: ${failureWords(error)}`);
        return { xml, translated: null };
      }
    };

    /** A redesign through the generation core, with this report open. */
    const redesign = async (): Promise<ReviseDone | null> => {
      const made = await gen.make({ words: designWords, open: { repxContent: open }, config: job.config, signal }, makeHooks(tell));
      if (!made || signal.aborted) return null;
      notices.push(...made.notices);
      if (!made.ok) return { ...empty, action: 'rebuild', reply: fileLines([reply]), by, note: [...notes].join(' '), failure: failureWords(made.error) };
      if (made.note) notes.add(made.note);
      by = answerer(made.by);
      const xml = await asWritten(made.repxContent);
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
        standInFonts: measuredInStandIns(gen, xml, notices, log),
      };
    };

    if (outcome.action === 'new') return { ...empty, action: 'new', reply: fileLines([reply]), brief: fileLines([designWords]), by, note: [...notes].join(' ') };
    if (outcome.action === 'rebuild' || (outcome.wantsReport && outcome.action !== 'edit')) return redesign();

    if (outcome.action === 'edit') {
      const hooks = { fields: (xml: string) => factsLib.dataFieldsOf(xml) };
      let done = agent.applyEdits(open, outcome.edits ?? [], hooks);
      const errorsOf = (xml: string) => auditRepx(xml).findings.filter((f) => f.severity === 'error').map((f) => f.message);
      const errorsBefore = new Set(errorsOf(open));
      const brought = done.changed ? errorsOf(done.xml).filter((m) => !errorsBefore.has(m)) : [];
      // One more pass when an edit could not be made or brought an error, as App's (agent audit item 23).
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
          const second = agent.readReportOutcome(again);
          const more = second.action === 'edit' && second.edits.length ? agent.applyEdits(done.xml, second.edits, hooks) : null;
          if (more?.changed) done = { xml: more.xml, applied: [...done.applied, ...more.applied], appliedOps: [...done.appliedOps, ...more.appliedOps], declined: more.declined, changed: true };
        } catch (error) {
          if (signal.aborted) return null;
          log(`revise_report: the second pass did not answer; the first stands: ${failureWords(error)}`);
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
        const after = await translated(xml);
        const written = await asWritten(after.xml);
        return {
          ...empty,
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
      if (done.applied.length) return { ...empty, action: 'unchanged', reply: fileLines([reply]), applied: fileLines(done.applied), declined: fileLines([...done.declined, ...declinedTools]), by, note: [...notes].join(' ') };
      // Nothing could be made in place: a redesign from the words, as the chat starts one.
      notices.push('That could not be changed in place, so the report was redesigned from the request.');
      const remade = await redesign();
      return remade && { ...remade, declined: fileLines(done.declined) };
    }

    // An answer, which may carry a translation the words asked for.
    if (translateTool) {
      const after = await translated(open);
      if (after.translated && after.xml !== open) {
        const written = await asWritten(after.xml);
        return { ...empty, action: 'edit', xml: written, reply: fileLines([reply]), changes: fileLines(agent.describeChanges(open, written)), declined: fileLines(declinedTools), by, note: [...notes].join(' '), translated: after.translated, audit: await audited(written) };
      }
    }
    return { ...empty, action: 'answer', reply: fileLines([reply]), declined: fileLines(declinedTools), by, note: [...notes].join(' ') };
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
