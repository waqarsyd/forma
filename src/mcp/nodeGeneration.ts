/**
 * Everything the generation core is handed, in Node (2026-11-24, the MCP
 * work's wave 7): lib/generationCore.ts `makeReport` runs here as the
 * workspace and Batch run it in the browser, with Node's version of each
 * part the browser owns. The MCP server's AI tools (aiTools.ts, wave 8)
 * call `nodeGeneration` once in their worker thread (genJobs.ts) and `make`
 * for each request, its hooks hearing each stage for their progress; this
 * file registers no tool. The fidelity benchmark (scripts/fidelity/run.ts,
 * wave 10, NODE-9) hands `deps` to the core with its own `ask`, so it scores
 * the reports these parts make.
 *
 * `make` must never run on the thread that answers the protocol. pdf.js
 * parses and draws a PDF on the thread that calls it, and the wave-7 review
 * (NODE7-PDF-HEAP) measured a 611 KB one-page PDF ending the process with
 * V8's heap out of memory in 67 seconds, beyond any handler, and a 1 MB one
 * stalling the event loop for up to 13.8 seconds at a time: on that thread,
 * one attachment would stop the server answering anyone, cancellation
 * included, or end it. The AI tools run `make` in a worker thread with
 * `resourceLimits` and a deadline sized for a generation (generator.ts
 * `GEN_LIMITS`: 2 GB, 15 minutes); a worker so bounded contained the 611 KB PDF (nodeIntake.ts's header has the measurements). A stop
 * reaches the intake between files and pages; it cannot interrupt pdf.js
 * inside a step.
 *
 * What Node reads with, and how it differs from the browser (the MCP note,
 * docs/notes/mcp.md, says it for a reader):
 *
 * - Files are drawn on @napi-rs/canvas and PDFs opened with pdf.js's legacy
 *   build (nodeIntake.ts); a File built here is typed by its extension.
 * - Pages are read by PaddleOCR when vendor/paddle holds its pinned models,
 *   else by Tesseract from the installed language data, gathered into
 *   Forma's own folder (nodeOcr.ts, nodePaddle.ts). A page OCR could not
 *   read is said in the result's notices; its picture still goes to the AI.
 * - Forma's box reader, its own model and OCR's language data are read now,
 *   the models from assets/model in the clone, checked as the browser checks
 *   them: one that is missing or unreadable, or language data that cannot be
 *   gathered, is an error here, never a quieter report later, where the
 *   browser's loader would warn and leave Forma's draft out (NODE-3, and the
 *   wave-7 review's NODE7-OCR-QUIET for the language data).
 * - The settings are worked out with the open report laid over the stored
 *   ones, as the workspace's are (App's `detectFor`), so a redesign is asked
 *   in the report's own version, unit and paper (the wave-7 review's W7R-2).
 * - Text is measured on @napi-rs/canvas (lib/textMeasure.ts `measureOn`),
 *   for the print check, the fit to the page and the box reader's widths,
 *   in the family the host has installed or, where it lacks Arial, Times
 *   New Roman, Courier New, Calibri or Cambria, in the metric-compatible
 *   face Forma registers under that name first (the same widths, Caladea's
 *   Cambria's to within its rounding; nodeFonts.ts
 *   `useMetricFonts`, 2026-11-24: on a Linux host without them every width
 *   was another family's, or 0 with no fonts at all). A canvas that measures
 *   nothing is an error here. A family the host lacks and Forma has no face
 *   for is measured in a stand-in, which `standInFonts` names for the result.
 * - The paper follows a locale the server is given (`locale`), never the
 *   operating system's: with none, Letter, DevExpress's own default.
 * - The model Gemini answers with is probed once a day for a key and kept in
 *   a file in Forma's folder, by the key's tag and never the key
 *   (lib/modelCache.ts `keepModelChoiceIn`), or pinned (`model`), which
 *   probes nothing (NODE-7). The models a limit parked are kept in another
 *   beside it, the same way, as each limit happens, so a thread started
 *   afresh asks none of them again (modelParks.ts, GAP3-1).
 * - The AI's design is handed in (`ask`): geminiService's by default, the
 *   mock invoice with `mock`, and a test's own stand-in. The mock hands in
 *   mock mode's translation too, so a request that names a language makes no
 *   request either (the wave-7 review's W7R-1). Since wave 8 the entry reads
 *   `mock`, `model` and `locale` from the server's environment
 *   (FORMA_MCP_MOCK, FORMA_MODEL, FORMA_LOCALE: aiSettings.ts) and hands
 *   them to the AI tools' worker, which passes them here.
 * - No memory, no kept reports, no report library, no shared database, no
 *   vision model or page reader on a Local AI server, and no learning event:
 *   the server keeps nothing of the person's, and reads no storage at all
 *   (Node 26 defines localStorage and throws on a read, TST-12).
 *
 * Forma's folder (`formaUserFolder`) is per user and outside any repository
 * and the user's project: the probe's file, the parks' file and the gathered
 * language data are all it holds, and all this writes.
 *
 * Pure ASCII.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import type { PreviewMeta } from '../lib/attachments';
import { detectInputFrom, detectSettings } from '../lib/autoConfig';
import { boxReaderFrom } from '../lib/boxReader';
import { formaModelFrom } from '../lib/formaModel';
import type { GenerationDeps, IntakeDeps, Made, MakeRequest } from '../lib/generationCore';
import { designWith, houseBriefWith } from '../lib/learningLoop';
import { emptyMemory } from '../lib/memory';
import { keepModelChoiceIn, type ModelStorage } from '../lib/modelCache';
import { measureOn } from '../lib/textMeasure';
import type { ReportConfig, StreamProgress } from '../services/geminiService';
import { fileParks, PARKS_FILE } from './modelParks';
import { checkMeasuring, METRIC_FACES, standInFamilies, useMetricFonts, type MetricFace } from './nodeFonts';
import { nodeDrawing } from './nodeIntake';
import { nodeOcr } from './nodeOcr';

/** The clone this runs from: two folders up from this file. */
export const CLONE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Forma's own folder for this user, outside any repository and the user's
 * project: AppData\Local\Forma on Windows, Library/Caches/Forma on macOS,
 * .cache/forma elsewhere, under the user's home.
 */
export function formaUserFolder(home: string = homedir(), platform: string = process.platform): string {
  if (platform === 'win32') return join(home, 'AppData', 'Local', 'Forma');
  if (platform === 'darwin') return join(home, 'Library', 'Caches', 'Forma');
  return join(home, '.cache', 'forma');
}

/**
 * Storage over one JSON file, for the model's choice of the day: what
 * lib/modelCache.ts keeps there is the key's 32-bit tag, the model, the
 * models the key can call and when, never the key. Written through a
 * temporary name, so a second server never reads half a file; a file that
 * will not read is an empty one.
 */
export function fileStorage(path: string): ModelStorage {
  const read = (): Record<string, string> => {
    try {
      const all = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      return all && typeof all === 'object' && !Array.isArray(all) ? (all as Record<string, string>) : {};
    } catch {
      return {};
    }
  };
  const write = (all: Record<string, string>) => {
    mkdirSync(dirname(path), { recursive: true });
    const part = `${path}.${process.pid}.part`;
    try {
      writeFileSync(part, JSON.stringify(all));
      renameSync(part, path);
    } finally {
      rmSync(part, { force: true });
    }
  };
  return {
    getItem: (key) => {
      const value = read()[key];
      return typeof value === 'string' ? value : null;
    },
    setItem: (key, value) => write({ ...read(), [key]: String(value) }),
    removeItem: (key) => {
      const all = read();
      if (!(key in all)) return;
      delete all[key];
      write(all);
    },
  };
}

/** One of Forma's model files from the clone, or an error that names it and says how to restore it. */
function modelFile(clone: string, name: string, what: string): () => Promise<unknown> {
  return async () => {
    const path = join(clone, 'assets', 'model', name);
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      throw new Error(`${what} is missing from this clone (${path}). It is committed with Forma: restore it with git, then start the server again.`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`${what} in this clone (${path}) is not readable. Restore it with git, then start the server again.`);
    }
  };
}

const stoppedError = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });

/** The mock invoice, with no AI asked: geminiService's own mock answer, handed in as the core's `ask`. */
const mockAsk: NonNullable<GenerationDeps['ask']> = async (_prompt, _parts, _config, previousState, signal, _onProgress, options) => {
  if (signal?.aborted) throw stoppedError();
  return (await import('../services/geminiService')).mockAnswer('true', previousState, options);
};

/** Mock mode's translation, with no AI asked: each text marked with the language (geminiService `mockTranslations`), handed in as the core's `translateTexts`. */
const mockTranslate: NonNullable<GenerationDeps['translateTexts']> = async (texts, language, _config, signal) => {
  if (signal?.aborted) throw stoppedError();
  return (await import('../services/geminiService')).mockTranslations(texts, language);
};

/** What a page OCR could not read becomes in the result: its picture went to the AI, its text did not. */
export function unreadNotice(meta: PreviewMeta): string {
  const which = meta.page ? `page ${meta.page} of "${meta.file}"` : `"${meta.file}"`;
  return `OCR could not read the text of ${which}, so the AI was sent its picture alone.`;
}

export interface NodeGenerationOptions {
  /** The clone's root, whose assets/model and vendor/paddle are read; this file's own clone by default. */
  clone?: string;
  /** Forma's own folder (`formaUserFolder` by default): the probe's file, the parks' file and the gathered language data. */
  userFolder?: string;
  /** PaddleOCR's models; the clone's vendor/paddle by default, null for Tesseract alone. */
  paddleModels?: string | null;
  /** The AI's design; geminiService's `analyzeReportDesign` when absent. */
  ask?: GenerationDeps['ask'];
  /** The mock invoice instead of an AI, and mock mode's translation; an `ask` handed in designs in the invoice's place. */
  mock?: boolean;
  /** A Gemini model to answer with, never probed. */
  model?: string;
  /** The locale the paper follows when nothing in the request says it; never the operating system's. */
  locale?: string;
  /** Where a line about the work goes: the server's log on stderr. */
  log?: (line: string) => void;
  /** The canvas text is measured on: @napi-rs/canvas's by default, a test's own to see one that measures nothing refused. */
  canvas?: () => CanvasRenderingContext2D | null;
  /** The faces registered for the families the host lacks: nodeFonts.ts's table by default, a test's own to see them registered on a host that has the five. */
  metricFaces?: readonly MetricFace[];
}

/** Where a request has got to, for the MCP tools' progress (2026-11-24, wave 8, PROTO-3). */
export type MakeStage = 'reading' | 'drafting' | 'asking' | 'checking';

/** What `make` tells of its work as it goes: each stage as it starts, and the answer's progress as it streams. */
export interface MakeHooks {
  onStage?(stage: MakeStage): void;
  onProgress?(progress: StreamProgress): void;
}

export interface NodeGeneration {
  /** Which engine reads an English page: PaddleOCR when its pinned models are there, else Tesseract. */
  readonly ocr: 'paddle' | 'tesseract';
  /** The settings a request is made with: the ones given, with the model pinned when one is. */
  config(base: ReportConfig): ReportConfig;
  /** What `makeReport` is handed for a request made with `config`, on `open` (the report it redesigns) when there is one. */
  deps(config: ReportConfig, open?: string | null): GenerationDeps & IntakeDeps;
  /**
   * A report from files and words, or from a description: lib/generationCore.ts
   * `makeReport` with these parts. `hooks` hears each stage as it starts (the
   * pages read, Forma's draft, the AI asked, the answer checked: the fix the
   * print check sends back is asked again) and the answer's progress.
   */
  make(request: MakeRequest, hooks?: MakeHooks): Promise<Made | null>;
  /** The families a report's fonts name that this machine measured in a stand-in (nodeFonts.ts `standInFamilies`): text from the report. */
  standInFonts(xml: string): string[];
  /** Ends OCR's worker; the next reading starts another. */
  close(): Promise<void>;
}

/**
 * Node's parts for the generation core, assembled once (the header). Rejects
 * when one of Forma's models will not load, OCR's language data cannot be
 * gathered into Forma's folder, a font a missing family needs is not in the
 * clone, or the canvas measures nothing.
 */
export async function nodeGeneration(options: NodeGenerationOptions = {}): Promise<NodeGeneration> {
  const clone = options.clone ?? CLONE;
  const folder = options.userFolder ?? formaUserFolder();
  const log = options.log ?? ((line: string) => console.error(line));
  // Read now, so a clone without them fails here, in words, and never makes a quieter report (NODE-3).
  const reader = await boxReaderFrom(modelFile(clone, 'boxReader.json', "Forma's box reader"));
  const model = await formaModelFrom(modelFile(clone, 'formaModel.json', "Forma's own model"));
  const ocr = nodeOcr({ languages: join(folder, 'tessdata'), paddle: options.paddleModels === undefined ? join(clone, 'vendor', 'paddle') : options.paddleModels, log });
  // OCR's language data too, needed in PaddleOCR's mode as well (another language, and Tesseract's turn): NODE7-OCR-QUIET.
  ocr.ready();
  keepModelChoiceIn({ session: null, day: fileStorage(join(folder, 'model-choice.json')), parks: fileParks(join(folder, PARKS_FILE)) });
  // The five families' own widths on any host, then a canvas that measures something (GAP2-1).
  useMetricFonts(clone, options.metricFaces ?? METRIC_FACES);
  const canvas =options.canvas ?? (() => createCanvas(1, 1).getContext('2d') as unknown as CanvasRenderingContext2D);
  checkMeasuring(canvas);
  measureOn(canvas);
  const ask = options.ask ?? (options.mock ? mockAsk : undefined);
  const translateTexts = options.mock ? mockTranslate : undefined;
  const pinned = options.model?.trim();

  const config = (base: ReportConfig): ReportConfig => (pinned ? { ...base, modelName: pinned } : base);
  /**
   * The AI's design, telling `hooks` when it is asked and when its answer is
   * back to be checked: geminiService's own when none is handed in, loaded
   * as the core would load it.
   */
  const askTelling = (hooks: MakeHooks): NonNullable<GenerationDeps['ask']> => async (...args) => {
    hooks.onStage?.('asking');
    const design = ask ?? (await import('../services/geminiService')).analyzeReportDesign;
    try {
      return await design(...args);
    } finally {
      hooks.onStage?.('checking');
    }
  };
  /** The parts for one request; `unread` is told of each page OCR was asked to read and could not. */
  const partsFor = (asked: ReportConfig, open: string | null | undefined, unread?: (meta: PreviewMeta) => void, hooks?: MakeHooks): GenerationDeps & IntakeDeps => ({
    drawing: nodeDrawing,
    // The open report laid over the stored settings, as App's detectFor lays it (W7R-2).
    detect: (sources) =>
      detectSettings(detectInputFrom(sources, { withOpenReport: Boolean(open), openReport: open ?? null, locale: options.locale, learned: { version: asked.version, unit: asked.unit } })),
    readPages: async (pages, signal, settings, now) => {
      if (pages.length) hooks?.onStage?.('reading');
      const read = await ocr.readPages(pages, signal, settings, now);
      if (unread && !signal.aborted) for (const { meta } of now ?? pages) if (!read.some((r) => r.meta === meta)) unread(meta);
      return read;
    },
    loadReader: async () => {
      hooks?.onStage?.('drafting');
      return reader;
    },
    houseBrief: (unit) => {
      hooks?.onStage?.('drafting');
      return houseBriefWith(async () => model, emptyMemory(), unit);
    },
    designFromWords: (request, message) => designWith(async () => model, emptyMemory, request, message),
    recordLearning: () => undefined,
    beforeGeneration: async () => ({ remembered: '', kept: null }),
    ...(hooks ? { ask: askTelling(hooks), ...(hooks.onProgress ? { onProgress: hooks.onProgress } : {}) } : ask ? { ask } : {}),
    ...(translateTexts ? { translateTexts } : {}),
  });

  return {
    ocr: ocr.english,
    config,
    deps: (asked, open) => partsFor(asked, open),
    make: async (request, hooks) => {
      const asked = config(request.config);
      const unread: PreviewMeta[] = [];
      const { makeReport } = await import('../lib/generationCore');
      const made = await makeReport({ ...request, config: asked }, partsFor(asked, request.open?.repxContent, (meta) => unread.push(meta), hooks));
      return made && (unread.length ? { ...made, notices: [...made.notices, ...unread.map(unreadNotice)] } : made);
    },
    standInFonts: (xml) => standInFamilies(xml, canvas),
    close: () => ocr.close(),
  };
}
