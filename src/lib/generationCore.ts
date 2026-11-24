/**
 * One way a report is made (2026-11-24, the MCP work's wave 6; the design
 * audit's NODE-4 and NODE-8): the workspace and Batch call this, and the MCP
 * server's generation tools and a later command line are to call it, so a
 * report is made the same way everywhere. Nothing under src/mcp calls it
 * yet: its Node versions of the parts handed in come first (wave 7).
 *
 * It starts where a turn with pictures, files or a description starts (the
 * pages and texts staged, the words), not where the request goes out:
 *
 * - `readRequest`: the pages are read (only the first and the last of a long
 *   upload before the request, when Forma's draft is what the AI corrects;
 *   the rest later, `readRest`, if the AI designs the report instead), the
 *   page reader reads them beside OCR, and the settings are worked out from
 *   what the request brings and again from what was read.
 * - `generateReport`: Forma's team prepares (`prepareTeam`), the pages between
 *   are read when the AI designs, a Word or Excel template's layout becomes
 *   the draft when the words ask for it, the AI chosen answers through the
 *   free chain (`askWithChain`) from one request budget, what does not print
 *   is sent back once (`fixUntilPrints`), a shared database's source is
 *   written, the language the words name is carried out, and the report is
 *   turned right to left where its source is. When every AI fails, Forma's own
 *   draft stands in, except over a report the person brought.
 * - `makeReport`: both, from files taken in here, for a caller with no
 *   workspace (Batch today, the MCP server's tools once they exist).
 *
 * The workspace runs the two halves apart because its chat decides between
 * them, after the pages are read, whether a message is a design at all.
 *
 * ## What is handed in
 *
 * Everything the browser owns: reading a page (OCR's engines are workers),
 * the page reader, the settings worked out (App's also keeps them for the
 * rest of the turn), the box reader's model file, Forma's own model and the
 * memory (both read storage), the vision model's set-up, the house-style
 * library, a shared database, the learning events, and the progress. The
 * module imports nothing at its top that needs a document, a worker or
 * storage, so a Node caller (wave 7) can pass Node versions of those parts.
 * The rest it loads when needed, as App's generation code did.
 *
 * ## Batch, which still differs
 *
 * A Batch file (`batchFile`) is made as it was made before this module
 * (2026-11-11, the full audit's batch BW, lib/batchRun.ts), and where it
 * still differs from a single report is said once, here, so a later change
 * can decide each on purpose: every page is read before the request, never
 * the first and last alone; a template's layout is not taken as the draft;
 * the request carries no other attached files beside a draft and no page
 * reader's readings; the fix is not given the draft's text, so a fixed
 * report's account of what it kept of the page is not worked out again; the
 * language is the one the words name, translated with the file's own
 * settings, even when the report already reads in it, and a report asked for
 * in a right-to-left language is not turned for it; what Forma's reading of
 * the page found missing gets no key for the REPX pane (the row counts it
 * instead); nothing stands in when the AI fails, the failure is thrown, and a
 * stop after the translation still finishes the file. And one that
 * lib/batchRun.ts makes itself, in the `beforeGeneration` it hands in: the
 * request is told the memory's instructions alone, never the nearest kept
 * report as an example.
 *
 * Moved out of App.tsx (`prepareTeam`, the reading in `runTurn`, the request
 * in `runGeneration`) and lib/batchRun.ts the same day, with no change in
 * what is asked or in what order: `git log -S"const prepareTeam"` finds them
 * as they were.
 */
import { applyDetected, type DetectedSettings, type SourcePage } from './autoConfig';
import { toAttachmentParts } from './attachmentParts';
import type { PreviewMeta } from './attachments';
import { isMissingApiKey, loadGemini } from './geminiClient';
import { descriptionWords, type ReportDescriptionRequest } from './promptToReport';
import { isReportFile } from './reportFile';
import type { BoxReaderModel } from './boxReader';
import type { EffectiveProvider } from './aiProvider';
import type { DraftSource } from './formaTeam';
import type { LearningRecord } from './learning';
import type { KeptChoice } from './learningLoop';
import type { ReadPage, ReaderBuiltReport } from './ocrAttach';
import type { OfflineDesign } from './offlineGenerator';
import type { PageReading } from './readerPairs';
import type { ReportSkeleton } from './reportSkeleton';
import type { ReportLayout } from './reportTypes';
import type { RepxFinding } from './repxAudit';
import type { TextAttachment } from './repxIntake';
import type { ReportQuery } from './sqlQuery';
import type { TokenUsage } from './tokenUsage';
import type { DraftRequest, GenerationResult, ReportConfig, StreamProgress } from '../services/geminiService';

/** A page sent: its picture, and which upload and page it is. */
export type SentPage = { src: string; meta: PreviewMeta };
/** A page OCR read. */
export type PageRead = { meta: PreviewMeta; read: ReadPage };

/** What a request brings that its settings are worked out from (lib/autoConfig.ts). */
export interface DetectionSources {
  texts?: readonly { file: string; text: string }[];
  metas?: readonly PreviewMeta[];
  pages?: readonly SourcePage[];
  words?: string;
}

/** A report Forma made itself, as the workspace shows one: a draft of the team's, or the stand-in. */
export interface DraftReport {
  content: string;
  timestamp: Date;
  title?: string;
  layout?: ReportLayout;
  repxContent?: string;
  usage?: TokenUsage | null;
}

/**
 * What the rest of Forma's team has for a run (2026-11-03, lib/formaTeam.ts),
 * captured when the run starts so a resume has it too. Absent on a turn that
 * only refines the open report in words: there is no page to read and no
 * draft worth handing over in its place.
 */
export interface TeamInput {
  /** The staged pages OCR finished reading. */
  read: PageRead[];
  /** The first page, for Forma's vision model, when it is an image. */
  firstImage?: SentPage;
  /** The same upload's last page, when it has more than one (2026-11-04): its footers and totals. */
  lastImage?: SentPage;
  /** A report described in words: the house style is told, and Forma's own model drafts. */
  described?: ReportDescriptionRequest;
  /**
   * The pages not read yet, read and given as texts when the AI designs the
   * report rather than correcting Forma's draft (2026-11-11, the full audit's
   * PL-23): the draft is written from the first page and the last alone.
   */
  readRest?: (signal: AbortSignal) => Promise<TextAttachment[]>;
}

/**
 * What the team brought to a run: the brief the AI is told and the quicker
 * version that stands in if the AI fails. Who took part is not kept
 * (2026-11-11, the full audit's RH-08): the reply is the result, and names
 * nobody.
 */
export interface TeamPlan {
  brief: string;
  draft: (() => Promise<{ result: DraftReport; source: DraftSource } | null>) | null;
  /**
   * OCR's own layout of the source, which the audit checks the AI's REPX
   * against (2026-11-05, `sourceLayoutOf`).
   */
  evidence?: ReportLayout | null;
  /**
   * Forma's draft of the page, for the AI to correct rather than design the
   * report from nothing (2026-11-05, lib/draftText.ts). Null without a picture
   * whose layout the vision model or the box reader read.
   */
  correct?: DraftRequest | null;
  /** The page's shape as Forma read it, which the nearest kept report is found by (2026-11-11, D3). */
  shape?: ReportSkeleton;
  /** The first page in numbers alone, kept on the device with the request's learning event (2026-11-12, D10). */
  reading?: PageReading | null;
}

export const NO_TEAM: TeamPlan = { brief: '', draft: null };

/** Reading the pages, which the browser does with its own engines (OCR's workers, the page reader). */
export interface ReadDeps {
  /** The settings worked out from what the request brings; App's also keeps them for the rest of the turn. */
  detect: (sources: DetectionSources) => DetectedSettings;
  /** Reads the pages' text; `now`, when given, the ones to read before the request. Every page is the request's. */
  readPages: (pages: readonly SentPage[], signal: AbortSignal, settings: ReportConfig, now?: readonly SentPage[]) => Promise<PageRead[]>;
  /** Reads the pages between the first and the last, when the AI designs from every page (`readRest`); `readPages` when absent. */
  readLater?: (pages: readonly SentPage[], signal: AbortSignal, settings: ReportConfig) => Promise<PageRead[]>;
  /** The page reader on the Local AI server, when one is set up (lib/pageReading.ts). */
  pageReader?: (pages: readonly SentPage[], signal: AbortSignal) => Promise<TextAttachment[]>;
}

/** Forma's own parts that read storage or a model file, or reach a local server. */
export interface TeamDeps {
  /** Forma's vision model beside the AI, when one is set up (lib/aiProvider.ts `visionModelOf`). */
  visionModel?: (settings: ReportConfig) => { baseUrl: string; model: string } | null;
  /** Forma's box reader's model (lib/boxReader.ts `loadBoxReader`, a file this site serves). */
  loadReader: () => Promise<BoxReaderModel>;
  /** The house style a described report is told; absent when the box's switch is off. */
  houseBrief?: (unit: string) => Promise<string>;
  /** Forma's own model's design from a description, in the person's own style (lib/learningLoop.ts). */
  designFromWords: (request: ReportDescriptionRequest, message: string) => Promise<{ design: OfflineDesign }>;
  /** A learning event: the stand-in Forma's own model designs is one. */
  recordLearning: (record: LearningRecord) => unknown;
}

/** A shared database (the Data tab, batch DE, lib/databaseAi.ts). */
export interface DatabaseStep {
  /** Its section of the design request. */
  section: string | undefined;
  /** The data source written from what the AI named: the file, what the reply says of it, and the query chosen. */
  write: (xml: string, dataQuery: unknown, version: string) => { xml: string; note: string; query: ReportQuery | null };
  /** The query chosen, once the report is read again with it. */
  chosen: (query: ReportQuery) => void;
}

/** What the request is told besides its words, and what it reports while it runs. */
export interface AskDeps {
  /** The remembered preferences, and on a first report the nearest kept report (lib/learningLoop.ts `beforeGeneration`). */
  beforeGeneration: (about: { first: boolean; drafting: boolean; shape?: ReportSkeleton; words: string; description?: string }) => Promise<{ remembered: string; kept: KeptChoice | null }>;
  /** House style from the report library, on a refinement (lib/houseStyle.ts); absent when the switch is off or nothing is ticked. */
  houseStyle?: (repx: string, words: string, settings: ReportConfig, signal: AbortSignal) => Promise<string>;
  /** A shared database, when one is shared. */
  database?: (words: string) => Promise<DatabaseStep | null>;
  /** The answer's progress as it streams. */
  onProgress?: (progress: StreamProgress) => void;
}

export type GenerationDeps = ReadDeps & TeamDeps & AskDeps;

/* ------------------------------------------------------------------ the parts */

/**
 * The staged pages Forma's vision model reads, by index (2026-11-04): the
 * first, when it is an image, and the same upload's last page when it has
 * more than one, since a report's last page holds the footers and totals its
 * first does not. Empty when the first is not an image (a PDF read as one).
 */
export function visionPages(images: readonly string[], metas: readonly PreviewMeta[]): number[] {
  if (!images[0]?.startsWith('data:image/') || !metas[0]) return [];
  let last = 0;
  metas.forEach((m, i) => {
    if (i > 0 && m.uploadId === metas[0].uploadId && images[i]?.startsWith('data:image/')) last = i;
  });
  return last > 0 ? [0, last] : [0];
}

/** Pages OCR read, as detection takes them: their shape, and their words for the direction. */
export function readSources(read: readonly PageRead[]): { pages: SourcePage[]; words: string } {
  return {
    pages: read.map(({ meta, read: r }) => ({ width: r.ocr.width, height: r.ocr.height, pagePoints: meta.pagePoints })),
    words: read.flatMap(({ read: r }) => r.ocr.lines.map((l) => l.text)).join('\n'),
  };
}

/** The text read from the pages, as attachments for the request. */
export async function ocrAttachments(read: readonly PageRead[], settings: Pick<ReportConfig, 'unit' | 'pageSize'>): Promise<TextAttachment[]> {
  if (!read.length) return [];
  const { ocrTexts } = await import('./ocrAttach');
  const stamp = Date.now();
  return ocrTexts(read, settings.unit, settings.pageSize).map((t, i) => ({ ...t, id: `${stamp}-${i}-ocr-${t.file}-p${t.page ?? 1}`, readByOcr: true as const }));
}

/** Forma's box reader's report from the pages read, or null when it cannot load or finds no text. */
export async function readerBuild(read: readonly PageRead[], pageSize: string, loadReader: () => Promise<BoxReaderModel>): Promise<ReaderBuiltReport | null> {
  try {
    const { buildWithReader } = await import('./ocrAttach');
    return buildWithReader(read, await loadReader(), pageSize);
  } catch (err) {
    console.warn("Forma's box reader could not read the page.", err);
    return null;
  }
}

/**
 * A report as its source is written: right to left when the request's text
 * or report is (2026-11-04, lib/repxRtl.ts and lib/autoConfig.ts). Applied
 * wherever a report reaches the bench, because the prompt is the only other
 * thing that knows the direction and most of the ways Forma makes a report
 * use no prompt.
 *
 * `asSeen` (2026-11-11, the full audit's PL-04b): the report was written as
 * its page is seen, by the AI (told so by the prompt) or by one of Forma's
 * readers, so it is turned round first (`toLogicalRtl`); with both
 * attributes set over it as it was, DevExpress printed the page mirrored.
 * Checked with RepxProbe render: the turned report printed every string
 * where the page as seen printed it. A report already laid out right to
 * left is left as it is.
 *
 * `built`: one of Forma's own builds, which goes through every repair an
 * AI's answer does first (2026-11-11, the full audit's ARCH-1b,
 * lib/repairChain.ts); it had three of them.
 */
export async function asConfigured(xml: string, settings: Pick<ReportConfig, 'version' | 'rtl'>, asSeen = false, built = false): Promise<string> {
  if (built && xml) xml = (await import('./repairChain')).repairRepx(xml, { version: settings.version }).xml;
  if (!settings.rtl || !xml) return xml;
  const { makeRightToLeft, toLogicalRtl } = await import('./repxRtl');
  return makeRightToLeft(asSeen ? toLogicalRtl(xml) : xml);
}

/** A report Forma's own model designs from a description, with no AI: the stand-in when the AI fails. */
async function offlineDesign(request: ReportDescriptionRequest, message: string, deps: TeamDeps): Promise<DraftReport> {
  // In the person's own style where their memory has one (lib/learningLoop.ts, D1).
  const { design } = await deps.designFromWords(request, message);
  const result: DraftReport = { content: design.markdown, timestamp: new Date(), title: design.title, layout: design.layout, repxContent: design.repx, usage: null };
  deps.recordLearning({ kind: 'generation', source: 'words', request: 'new', ai: 'forma', draft: 'offline', repx: design.repx });
  return result;
}

/**
 * Everything Forma's own parts bring to a run before the AI is asked
 * (2026-11-03, lib/formaTeam.ts). Each part is optional and none can fail
 * the run: a vision model that is off, or a model file that will not load,
 * leaves that part out with a warning in the console.
 * - A picture: Forma's vision model, when one is set up, reads the first
 *   page, and OCR's words go into its boxes. That draft is the brief, and
 *   the stand-in. With no vision model, the box reader's build is, and with
 *   neither OCR's own build is the stand-in.
 * - A description: the house style Forma's own model learned is the brief,
 *   and that model's own design is the stand-in.
 * `settings` are the ones worked out for this request, not the stored ones
 * (lib/autoConfig.ts); a Batch file's own, since three run at once (PL-15).
 */
export async function prepareTeam(input: TeamInput | undefined, signal: AbortSignal, settings: ReportConfig, deps: TeamDeps): Promise<TeamPlan> {
  if (!input) return NO_TEAM;
  const config = settings;
  let brief = '';
  let draft: TeamPlan['draft'] = null;
  let evidence: ReportLayout | null = null;
  let correct: DraftRequest | null = null;
  let shape: TeamPlan['shape'];
  let reading: TeamPlan['reading'] = null;
  if (input.read.length) {
    // OCR's own picture of the source, every row it read, for the audit
    // to check the AI's REPX against (2026-11-05, lib/ocrAttach.ts).
    const { sourceLayoutOf } = await import('./ocrAttach');
    evidence = sourceLayoutOf(input.read, config.unit, config.pageSize);
  }

  const vision = input.firstImage ? deps.visionModel?.(config) ?? null : null;
  if (vision && input.firstImage) {
    try {
      // The first page and the upload's last, in lib/visionDraft.ts since 2026-11-11 (BW).
      const made = await (await import('./visionDraft')).visionDraft(vision, input.firstImage, input.lastImage, input.read, config, signal);
      ({ brief, correct } = made);
      shape = made.skeleton;
      draft = async () => ({ result: made.result, source: 'vision' });
    } catch (err) {
      if (signal.aborted) throw err;
      console.warn("Forma's vision model could not read the page; the AI designs without its draft.", err);
    }
  }
  // With no vision model's draft, Forma's box reader puts the texts OCR read
  // in their bands (2026-11-04, lib/boxReader.ts), and that is the brief and
  // the stand-in. It needs no AI and no GPU, so it is there for every picture.
  if (!draft && input.read.length) {
    const built = await readerBuild(input.read, config.pageSize, deps.loadReader);
    if (built && !signal.aborted) {
      const { draftBrief, readerCorrection } = await import('./formaTeam');
      brief = draftBrief((shape = built.skeleton), built.layout, config.unit, 'reader');
      correct = readerCorrection(built);
      reading = built.pageReading ?? null;
      const readerResult: DraftReport = { content: built.markdown, timestamp: new Date(), title: built.title, layout: built.layout, repxContent: built.repxContent, usage: null };
      draft = async () => ({ result: readerResult, source: 'reader' });
    }
  }
  if (!draft && input.read.length) {
    const read = input.read;
    draft = async () => {
      const { buildFromRead } = await import('./ocrAttach');
      const built = buildFromRead(read, config.unit, config.pageSize);
      if (!built) return null;
      return {
        result: { content: built.markdown, timestamp: new Date(), title: built.title, layout: built.layout, repxContent: built.repxContent, usage: null },
        source: 'ocr',
      };
    };
  }

  const described = input.described;
  if (described) {
    // Forma's own style, unless the box's switch is off (2026-11-08); the
    // person's own once two reports they kept show it, with what their
    // changes taught (2026-11-11, D1 and D4; lib/learningLoop.ts).
    if (deps.houseBrief) try {
      brief = await deps.houseBrief(config.unit);
    } catch (err) {
      console.warn("Forma's own model could not be loaded; the AI designs without its house style.", err);
    }
    draft = async () => ({ result: await offlineDesign(described, described.description, deps), source: 'offline' });
  }
  return { brief, draft, evidence, correct, shape, reading };
}

/* --------------------------------------------------------------- the reading */

export interface ReadRequest {
  /** The pictures sent: an image, or a PDF page drawn as one. */
  images: readonly string[];
  /** Which upload and page each picture is, in the same order. */
  imageMeta: readonly PreviewMeta[];
  /** The text that came with the files: a PDF's text layer, a `.repx`, a data file, a document. */
  texts: readonly TextAttachment[];
  /** The words sent with them. */
  words: string;
  /** A report is open, which the request works on: every page is read before the request. */
  open: boolean;
  /** The stored settings, which the worked-out ones are laid over. */
  config: ReportConfig;
  /** The settings the pages are read with, when the caller has worked them out already (App, at the turn's start). */
  settings?: ReportConfig;
  signal: AbortSignal;
  /** Every page read before the request, never the first and last alone (Batch, the header). */
  everyPage?: boolean;
}

export interface ReadResult {
  read: PageRead[];
  /** Every text the request carries: the files' (in the unit worked out), OCR's and the page reader's. */
  texts: TextAttachment[];
  /** The settings worked out once the pages are read. */
  settings: ReportConfig;
  /** What Forma's team is given; undefined with no picture. */
  team: TeamInput | undefined;
}

/**
 * The pages of a request read, its settings worked out, and what Forma's
 * team is given. Null when stopped.
 *
 * What OCR reads from the attached images goes with them, as a PDF's text
 * layer does (2026-11-01). The page reader, when one is set up, reads the
 * same pages on the local server while OCR reads them in the browser
 * (2026-11-10, batch AF). Only what Forma's draft needs is read before the
 * request (2026-11-11, the full audit's PL-23): a first report from pictures
 * is a draft the AI corrects, and the draft is written from the first page
 * and the last. An eight-page scan was read page by page, a few seconds
 * each, before anything was asked; the pages between are read only when the
 * AI designs the report instead (`readRest`).
 */
export async function readRequest(request: ReadRequest, deps: ReadDeps): Promise<ReadResult | null> {
  const { images, imageMeta, texts, words, signal, config } = request;
  // The pages whose text came with them (a PDF's text layer) are not read again.
  const withText = new Set(texts.map((t) => `${t.uploadId}#${t.page ?? 0}`));
  const pages: SentPage[] = images.flatMap((src, i) => {
    const meta = imageMeta[i];
    return meta && !withText.has(`${meta.uploadId}#${meta.page ?? 0}`) ? [{ src, meta }] : [];
  });
  const before = request.settings ?? applyDetected(config, deps.detect({ texts, metas: imageMeta, words }));
  const draftFirst = !request.everyPage && !request.open && pages.length > 2 && !texts.some(isReportFile);
  const restPages = draftFirst ? pages.slice(1, -1) : [];
  // The page reader too reads only those first, the rest with OCR's (R2-11).
  const ends = draftFirst ? [pages[0], pages[pages.length - 1]] : undefined;
  const pageReading = deps.pageReader ? deps.pageReader(ends ?? pages, signal) : Promise.resolve([]);
  const read = await deps.readPages(pages, signal, before, ends);
  if (signal.aborted) return null;
  // What was read settles the paper and the direction.
  const fromPages = readSources(read);
  const settings = applyDetected(config, deps.detect({ texts, metas: imageMeta, pages: fromPages.pages, words: [words, fromPages.words].join('\n') }));
  const readByOcr = await ocrAttachments(read, settings);
  const readByReader = await pageReading;
  // A PDF's strings in the unit worked out just above (2026-11-11, the full
  // audit's PL-18): attached, they were written in the stored unit, and a
  // report worked out as millimetres was told inch positions.
  const { inUnit } = await import('./repxIntake');
  if (signal.aborted) return null;
  const all = [...inUnit(texts, settings.unit), ...readByOcr, ...readByReader];
  if (readByOcr.length) console.debug(`Including the text of ${readByOcr.length} page(s) read by OCR.`);
  if (readByReader.length) console.debug(`Including the text of ${readByReader.length} page(s) read by the page reader.`);
  const readLater = deps.readLater ?? deps.readPages;
  const readRest = restPages.length
    ? async (s: AbortSignal) =>
        (await Promise.all([readLater(restPages, s, settings).then((r) => ocrAttachments(r, settings)), deps.pageReader ? deps.pageReader(restPages, s) : []])).flat()
    : undefined;
  const [firstAt, lastAt] = visionPages(images, imageMeta);
  const team: TeamInput | undefined = images.length > 0
    ? {
        read,
        ...(firstAt !== undefined ? { firstImage: { src: images[firstAt], meta: imageMeta[firstAt] } } : {}),
        ...(lastAt !== undefined ? { lastImage: { src: images[lastAt], meta: imageMeta[lastAt] } } : {}),
        ...(readRest ? { readRest } : {}),
      }
    : undefined;
  return { read, texts: all, settings, team };
}

/* ------------------------------------------------------------- the request */

export interface GenerateRequest {
  /** The words the report is designed from ('' for a description, which is its own source). */
  words: string;
  /** The pictures the request carries. */
  images: readonly string[];
  /** Every text it carries, read pages included (`readRequest`). */
  texts: readonly TextAttachment[];
  /** The settings worked out for this request. */
  settings: ReportConfig;
  /** A report described in words: no attachments, the description is the source. */
  description?: ReportDescriptionRequest;
  /** What Forma's team is given; absent on a refinement in words. */
  team?: TeamInput;
  /** The report it refines; null or absent to design from nothing. */
  open?: { repxContent?: string } | null;
  /** The fields the report's data has, for the audit's misspelt-field check (CP-07). */
  fields?: readonly string[];
  signal: AbortSignal;
  /** A Batch file, made as Batch made it (the header). */
  batchFile?: boolean;
}

/** The AI's report, finished. */
export interface Answered {
  ok: true;
  /** The answer: fixed, its data source written, translated. Its `repxContent` is before `repxContent` below. */
  response: GenerationResult;
  /** The report as it goes to the person: turned right to left where its source is. */
  repxContent: string;
  /** The file the print findings were found in; a later change to it makes them stale. */
  printed: string;
  /** Every answer this report cost, the fixes' too. */
  spent: TokenUsage | null;
  /** Where the words went when another AI answered on a limit ('' when the one chosen did), a privacy fact the person is owed. */
  note: string;
  /** Who answered. */
  by: EffectiveProvider;
  /** The settings the answer came from, a limit's switch included. */
  answering: ReportConfig;
  /** The language the report was translated into, when the words named one. */
  translated: { language: string; bilingual: boolean } | null;
  /** The kept report given as an example, for the reply (D3). */
  kept: KeptChoice | null;
  /** What writing a shared database's source says. */
  dataNote: string;
  /** What Forma's own reading of the page found the report lacks, and the key of the file it was found in. */
  evidence: { findings: RepxFinding[]; on: string } | null;
  team: TeamPlan;
  /** Every text the request carried, the pages read later included. */
  texts: TextAttachment[];
  /** The run started from a report: the open one, or a `.repx` attached. */
  startedFromReport: boolean;
  standIn: null;
}

/** Forma's own draft, standing in for an AI that failed. */
export interface StandIn {
  /** Configured as the report it stands in for would have been. */
  result: DraftReport;
  source: DraftSource;
}

/** Every AI failed. */
export interface Failed {
  ok: false;
  error: unknown;
  /** Null when no draft could stand in: a missing AI, a report the person brought, or none made. */
  standIn: StandIn | null;
}

export type Generated = Answered | Failed;

/**
 * The report made from what was read: the team, the request, the fix, the
 * data source, the translation and the direction, or Forma's draft in its
 * place. Null when stopped; a Batch file's failure is thrown (the header).
 */
export async function generateReport(request: GenerateRequest, deps: TeamDeps & AskDeps): Promise<Generated | null> {
  const { words, images, settings, description, open, fields, signal } = request;
  const batch = Boolean(request.batchFile);
  let texts = [...request.texts];
  let team: TeamPlan = NO_TEAM;
  // Before the try, so a failure knows it too (R2-03): the open report, or a .repx attached.
  const startedFromReport = Boolean(open?.repxContent) || texts.some(isReportFile);
  try {
    team = await prepareTeam(request.team, signal, settings, deps);
    // No draft to correct, so the AI designs the report from every page:
    // the pages between the first and the last are read now (PL-23).
    if (request.team?.readRest && (open || !team.correct)) {
      const more = await request.team.readRest(signal);
      if (signal.aborted) return null;
      texts = [...texts, ...more];
    }
    // A Word or Excel template's layout, when the words ask for a report from it (CP-11); after the pages, which it does not stand in for.
    if (!batch && !team.correct && texts.some((t) => t.layout)) team = { ...team, correct: (await import('./repxIntake')).templateCorrection(texts, words) };
    if (signal.aborted) return null;
    // Text before images, and malformed previews dropped rather than thrown
    // on — see src/lib/attachmentParts.ts.
    const attachmentParts = toAttachmentParts(images, texts);
    const { analyzeReportDesign, REQUEST_BUDGET } = await loadGemini();
    /*
     * What else the user attached, for the AI that corrects Forma's draft
     * (2026-11-11, the full audit's PL-02b): a data file's columns, a
     * document, a PDF's text. The correction was sent the draft and the
     * pictures alone, so "this picture, bound to this CSV" lost the CSV.
     * Not OCR's texts, which the draft is written from, and the page
     * reader's apart, as a reading rather than a file (R2-11).
     */
    const extras = batch ? undefined : toAttachmentParts([], texts.filter((t) => !t.readByOcr && !t.readByReader));
    /*
     * The requests this click may make (2026-11-11, the full audit's PL-20),
     * shared by the service's own retries and repeats and the fix attempts
     * below. One per AI the chain asks: a limit on the first is no reason to
     * give the next nothing to answer with.
     */
    let budget = { left: REQUEST_BUDGET };

    /*
     * House style, retrieved only on a refinement and only from files the
     * user has ticked: the open report is the query (lib/houseStyle.ts).
     * Failure is swallowed to a warning on purpose. This is an enhancement
     * to a request that works perfectly well without it, and an empty
     * library, a blocked IndexedDB or a refused embedding must not cost the
     * user the generation they actually asked for.
     */
    let houseStyle = '';
    if (deps.houseStyle && open?.repxContent) {
      try {
        houseStyle = await deps.houseStyle(open.repxContent, words, settings, signal);
      } catch (error) {
        console.warn('House style could not be retrieved; generating without it.', error);
      }
    }

    // The user's remembered preferences (lib/memory.ts), as their own block
    // ahead of the request, never mixed into the words they typed; on a
    // first report the kept report nearest it as an example (2026-11-11, D3).
    const { remembered, kept } = await deps
      .beforeGeneration({ first: !open && !startedFromReport, drafting: Boolean(team.correct && !description), shape: team.shape, words, description: description?.description })
      .catch(() => ({ remembered: '', kept: null }));
    // A shared database's likeliest objects and sample values, in place of "assume the procedure" (batch DE).
    const db = deps.database ? await deps.database([words, team.brief, ...texts.map((t) => t.text)].join('\n')) : null;
    const database = db ? db.section : undefined;
    const askAi = (asked: ReportConfig) => {
      budget = { left: REQUEST_BUDGET };
      return analyzeReportDesign(
        // Passed through empty when the user typed nothing: see lib/userInstructions.ts.
        words,
        attachmentParts,
        asked,
        open ? { repxContent: open.repxContent, houseStyle } : undefined,
        signal,
        deps.onProgress,
        {
          ...(description ? { description } : {}),
          remembered,
          formaBrief: team.brief,
          evidence: team.evidence,
          // Forma drafts and the AI corrects, on a first generation from a
          // picture (2026-11-05); the service designs as before otherwise.
          draft: open ? null : team.correct ?? null,
          database,
          extras,
          readings: batch ? undefined : texts.flatMap((t) => (t.readByReader ? [t.text] : [])),
          fields,
          budget,
        },
      );
    };
    /*
     * The free chain (2026-11-10, the AI accuracy programme, batch AF;
     * lib/fallbackChain.ts): when the AI chosen has reached its limit, the
     * next one the person set up answers, and the reply says so. Only on a
     * limit; when every one gives out, Forma's own draft stands in below.
     */
    const { askWithChain } = await import('./fallbackChain');
    const chained = await askWithChain(settings, askAi, signal);
    let response = chained.value;
    if (signal.aborted) return null;

    /*
     * The fix loop (lib/printCheck.ts, `fixUntilPrints`, 2026-11-11, the full
     * audit's CC-01): any audit error on a report designed from words, and on
     * every run what printing it with the page's own records shows, an
     * expression DevExpress cannot read, and a grid drawn as loose texts
     * (PL-11b). One more answer at most, from this click's allowance (PL-20);
     * the better is kept, and a fix that fails keeps the report so far.
     */
    const fixed = await import('./printCheck').then((m) => m.fixUntilPrints(response, {
      described: Boolean(description),
      fields,
      fromReport: startedFromReport,
      spent: response.usage ?? null,
      left: () => budget.left,
      aborted: () => signal.aborted,
      // With the texts the person attached, not the report it is built on (R2-06): a field the data has is named in them.
      ask: (instruction, repxContent) => analyzeReportDesign(instruction, toAttachmentParts([], texts.filter((t) => !isReportFile(t))), chained.config, { repxContent }, signal, deps.onProgress, { description, database, fields, budget, evidence: team.evidence }),
      draftText: batch ? undefined : team.correct?.text,
    }));
    if (!fixed || (batch && signal.aborted)) return null;
    response = fixed.answer;
    const printed = response.repxContent;

    /*
     * The data source, written by Forma from what the AI named (batch DE,
     * lib/databaseAi.ts): the query chosen on the Data tab, the AI's
     * <?forma-query?>, or the object holding most of what it bound. The
     * Mockup and the Spec are read again, since a detail band may be added.
     */
    let dataNote = '';
    if (db && response.repxContent) {
      const out = db.write(response.repxContent, response.dataQuery, settings.version);
      dataNote = out.note;
      if (out.query) {
        const views = await import('./repxViews');
        const title = response.layout.title;
        response = { ...response, repxContent: out.xml, markdown: views.specFromRepx(out.xml, title), layout: views.layoutFromRepx(out.xml, title) };
        db.chosen(out.query);
      }
    }

    /*
     * A language the words name, carried out on a first report (2026-11-11,
     * the full audit's CV-14): "Make this report in German" with a picture
     * built the report in the picture's language and said it had been
     * updated. Translated before the reply, so the reply says what is so;
     * a translation that fails leaves the report as built.
     */
    let translated: { xml: string; language: string; bilingual: boolean } | null = null;
    const asked = words || description?.description || '';
    const tr = !batch && !open && response.repxContent ? await import('./repxTranslate').catch(() => null) : null;
    // Not when the report already reads in it (R2-01): the design request carried the same words.
    const language = batch
      ? words ? await import('./repxTranslate').then((m) => m.languageAsked(words)).catch(() => null) : null
      : tr?.languageToTranslate(response.repxContent, asked) ?? null;
    if (language && response.repxContent) {
      try {
        // With the settings the answer came from (R2-01), a limit's switch
        // included; a Batch file's own, translated whole, so with no words.
        const done = batch
          ? await import('./repxTranslate').then((m) => m.translateReportXml(response.repxContent, language, signal, '', settings))
          : await tr!.translateReportXml(response.repxContent, language, signal, words, chained.config);
        if (!batch && signal.aborted) return null;
        translated = { xml: done.xml, language, bilingual: done.bilingual };
      } catch (translateError) {
        if (signal.aborted) return null;
        console.warn(`The report could not be translated into ${language}; it stays as built.`, translateError);
      }
    }
    if (translated && translated.xml !== response.repxContent) {
      const views = await import('./repxViews');
      const title = response.layout?.title;
      response = { ...response, repxContent: translated.xml, markdown: views.specFromRepx(translated.xml, title), layout: views.layoutFromRepx(translated.xml, title) };
    }

    // The prompt asks for right to left, positions as the page shows them;
    // this turns them and makes sure of it (PL-04b). Only for a report made
    // from pages or words: one the AI changed from a report (the open one,
    // or a .repx attached) keeps that report's positions, which are already
    // laid out right to left, and turning them again would print it back
    // to front if the answer left out RightToLeftLayout (the PIPE1 review).
    // Asked in Arabic from a left-to-right page, whoever wrote the Arabic (R2-04).
    const repxContent = await asConfigured(tr ? tr.rightToLeftFor(response.repxContent, asked, settings.rtl) : response.repxContent, settings, !startedFromReport);
    if (!batch && signal.aborted) return null;
    // For the REPX pane, which lists them until the file changes (PL-11b); a Batch row counts them instead.
    const found = batch ? [] : response.evidenceFindings ?? [];
    const evidence = found.length ? { findings: found, on: (await import('./repxIntake')).pictureKey(repxContent) } : null;
    return {
      ok: true,
      response,
      repxContent,
      printed,
      spent: fixed.spent,
      note: chained.note,
      by: chained.by,
      answering: chained.config,
      translated: translated && { language: translated.language, bilingual: translated.bilingual },
      kept,
      dataNote,
      evidence,
      team,
      texts,
      startedFromReport,
      standIn: null,
    };
  } catch (err) {
    if (batch) throw err;
    if (signal.aborted) return null;
    console.error('Error during report generation:', err);
    // No AI set up is a setup step, not a failure: nothing stands in for it.
    if (isMissingApiKey(err)) return { ok: false, error: err, standIn: null };
    // A quicker version Forma makes stands in for the AI that could not
    // answer (lib/formaTeam.ts), rather than the request ending in an error.
    // Not over an open report (2026-11-07, agent audit item 21): a refinement
    // that failed replaced the report the person had with an OCR draft of
    // the picture they sent to change it. Nor over a .repx attached with a
    // picture (the re-audit's R2-03): the draft is of the picture, and the
    // report the person brought would be dropped for it.
    if (team.draft && !startedFromReport && !open) {
      try {
        const made = await team.draft();
        if (made && !signal.aborted) {
          // A draft from the page is written as the page is seen; one from a description is not (PL-04b).
          const result = { ...made.result, repxContent: await asConfigured(made.result.repxContent ?? '', settings, made.source !== 'offline', true) };
          if (signal.aborted) return null;
          return { ok: false, error: err, standIn: { result, source: made.source } };
        }
      } catch (draftError) {
        console.warn("Forma's own draft could not be made either.", draftError);
      }
    }
    return { ok: false, error: err, standIn: null };
  }
}

/* ---------------------------------------------------------------- one call */

export interface MakeRequest {
  /** The files to take in, each under its upload id (lib/repxIntake.ts `ingestFile`). */
  files?: readonly { file: File; uploadId: string }[];
  /** The words sent with them. */
  words: string;
  /** A report described in words, with no files: designed from the description (Prompt-to-Report). */
  description?: ReportDescriptionRequest;
  /** The report it refines, for a redesign; null or absent to design from nothing. */
  open?: { repxContent?: string } | null;
  /** The stored settings, which the worked-out ones are laid over. */
  config: ReportConfig;
  fields?: readonly string[];
  signal: AbortSignal;
  /** A Batch file, made as Batch made it (the header). */
  batchFile?: boolean;
}

/** What `makeReport` returns: the report or the failure, and what taking the files in said. */
export type Made = Generated & {
  /** What taking the files in could not do: a page not drawn, a file not read. */
  notices: string[];
  /** The pictures the files became, a PDF's pages included. */
  pictures: number;
};

/**
 * A report from files and words, or from a description, in one call: the
 * files taken in, the pages read, the request made. Null when stopped.
 */
export async function makeReport(request: MakeRequest, deps: GenerationDeps): Promise<Made | null> {
  const { signal, config } = request;
  const images: string[] = [];
  const imageMeta: PreviewMeta[] = [];
  const texts: TextAttachment[] = [];
  const notices: string[] = [];
  if (request.files?.length) {
    const { ingestFile } = await import('./repxIntake');
    for (const { file, uploadId } of request.files) {
      const taken = await ingestFile(file, uploadId, config.unit);
      images.push(...taken.images);
      imageMeta.push(...taken.imageMeta);
      texts.push(...taken.texts);
      notices.push(...taken.notices);
    }
    if (signal.aborted) return null;
  }
  const described = request.description;
  if (described && !images.length && !texts.length) {
    // The words are the whole source here, answers included ("on A4", "EXEC dbo.Sales").
    const settings = applyDetected(config, deps.detect({ words: descriptionWords(described) }));
    const made = await generateReport(
      { words: '', images: [], texts: [], settings, description: described, team: { read: [], described }, open: null, fields: request.fields, signal, batchFile: request.batchFile },
      deps,
    );
    return made && { ...made, notices, pictures: 0 };
  }
  const read = await readRequest(
    { images, imageMeta, texts, words: request.words, open: Boolean(request.open?.repxContent), config, signal, everyPage: request.batchFile },
    deps,
  );
  if (!read) return null;
  const made = await generateReport(
    { words: request.words, images, texts: read.texts, settings: read.settings, team: read.team, open: request.open ?? null, fields: request.fields, signal, batchFile: request.batchFile },
    deps,
  );
  return made && { ...made, notices, pictures: images.length };
}
