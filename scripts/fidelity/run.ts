/**
 * The fidelity benchmark: generate each case with the real pipeline and score
 * what came back against the case's expectations.
 *
 *   FORMA_BENCH_KEY=<your Gemini key> npx tsx scripts/fidelity/run.ts [options]
 *   npm run bench:fidelity -- [options]
 *
 * Options
 *   --cases <dir>     where the cases live (default scripts/fidelity/cases)
 *   --only <name>     run one case; may be repeated
 *   --runs <n>        generate each case n times, to see variance (default 1)
 *   --out <dir>       where results go (default
 *                     ../forma-model-data-kept-not-in-git/forma-model-data/
 *                     fidelity-results/<timestamp>, beside
 *                     the repository rather than in it: RESULTS_DIR, below)
 *   --replay <dir>    re-score the saved outputs in that results directory
 *                     against the CURRENT case files, calling nothing.
 *                     scripts/fidelity/replay/reference-2026-11-11 is one kept
 *                     in the repository (2026-11-11, the full audit's CC-01):
 *                     Forma's AI answers of 2026-11-10 (run 1) and the Claude
 *                     Code reference's v2 (run 2) for invoice-ruled,
 *                     sales-grouped and fastreport-groups, each a report and
 *                     nothing else, so the print expectations replay with no
 *                     results folder from elsewhere. The summary is written
 *                     beside the saved outputs, except for a folder kept in
 *                     the repository, whose goes to RESULTS_DIR so the
 *                     tracked one stays as committed; --out names another
 *   --model <name>    pin a model instead of letting the app auto-detect one
 *   --thinking <n>    set ReportConfig.thinkingBudget for every case
 *   --rerender        re-render every .html source even if its .png exists
 *   --strict          exit 1 when any check fails (default: only on a crash)
 *   --key-from-clipboard
 *                     read the key from the clipboard instead of the
 *                     environment, so it never appears on a command line, in a
 *                     shell history or in an agent session's transcript. Copy
 *                     the key, run, then copy something else over it.
 *   --house <dir>     after the cases, the report library's evaluation: import
 *                     the .repx files there as the house style and refine each
 *                     first pass with and without it (houseEvaluation, below;
 *                     scripts/fidelity/house holds made-up ones)
 *   --brief, --draft  kept so older command lines still run, and change
 *                     nothing: since 2026-11-24 every run goes through the
 *                     generation core, which sends Forma's box reader's brief
 *                     with each picture (as the app has since 2026-11-04) and
 *                     asks the AI to correct Forma's draft of it (since
 *                     2026-11-05, lib/draftText.ts), as the app does. Until
 *                     then a run sent neither unless asked, so a scorecard
 *                     from before that date without these flags measured a
 *                     request the app never made
 *   --local-model <name>
 *                     design with a model on Ollama or LM Studio instead of
 *                     Gemini (Local AI, lib/aiProvider.ts), as qwen3.5:9b; no
 *                     Gemini key is needed and nothing leaves the computer
 *   --local-url <url> where that server answers (default
 *                     http://localhost:11434/v1, Ollama's; LM Studio's is
 *                     http://localhost:1234/v1)
 *   --forma           score Forma's own draft of each picture with no AI at all:
 *                     the generation core with an ask that refuses, so the
 *                     box reader's report, or OCR's copy where it declines,
 *                     stands in exactly as the app stands one in when every
 *                     AI has given out (lib/fallbackChain.ts, batch AF). No
 *                     key, no request, no quota; a case whose source is not a
 *                     picture has no draft and scores 0
 *   --style <path>    with --forma, also design each case from its words with
 *                     Forma's own model, as the app stands one in for a
 *                     described report, without and then with a person's own
 *                     style, and print the face and the median size of each
 *                     beside the source's (2026-11-11, the full audit's D1).
 *                     The path is a folder of .repx files the person kept, read
 *                     as the memory reads a kept report, or a .json of
 *                     preferences as lib/memory.ts `preferencesOf` gives them
 *   --page-reader <name>
 *                     read each picture with a page reader on that server, as
 *                     glm-ocr, and send its text beside the picture as the app
 *                     does (lib/pageReading.ts, handed to the core as its
 *                     `pageReader`, 2026-11-10); with Gemini or a local writer
 *                     alike
 *   --score <case> <file.repx>
 *                     score one file against one case, with no key, no
 *                     request and no results folder (2026-11-11, CC-02): the
 *                     layout is read off the file as the app reads it, and
 *                     the case's data.json prints it. May be repeated
 *   --probe           after scoring, print each report through the installed
 *                     DevExpress with the case's records (tools/RepxProbe
 *                     render, Windows with DevExpress 20.1 and the probe
 *                     built), and record its page count and the margins it
 *                     loaded beside Forma's own print. Works with --replay and
 *                     --score; opens no window
 *   --measure-source  print the median font size of each .html source, read
 *                     from headless Edge's layout of it, for a case's
 *                     fontSize.relative.sourcePt; writes nothing
 *
 * A case may carry `data.json` beside `case.json` (2026-11-11, CC-02): the
 * records its page shows, as `{ "types": { "Qty": "Int32", ... }, "rows":
 * [ { "Qty": "12", ... } ] }`, every value as text. Each run's report is then
 * printed with them (lib/fidelity.ts `printReport`), mapped onto whatever
 * fields that run binds, and the case's `print` expectations are read off
 * the print. A case whose source is a `.repx` is also scored against its own
 * untouched source (`selfTest`), which must fail something: the scorecard
 * says so when it does not.
 *
 * The local options are how the suggested Ollama pair is measured on the
 * owner's own computer (batch AF of the 2026-11-10 AI accuracy programme),
 * on these made-up cases and nothing of the company's:
 *
 *   ollama pull qwen3.5:9b; ollama pull glm-ocr
 *   (start Ollama with OLLAMA_CONTEXT_LENGTH=32768)
 *   npx tsx scripts/fidelity/run.ts --local-model qwen3.5:9b --draft
 *   npx tsx scripts/fidelity/run.ts --local-model qwen3.5:9b --draft --page-reader glm-ocr
 *
 * and the same with qwen3.5:4b and glm-ocr:q8_0 on a computer of 8 GB.
 *
 * What it measures and why is the doc comment of src/lib/fidelity.ts. This file
 * is the part that cannot live in the suite: it spends the owner's quota, takes
 * a minute or more per case, and needs a key, so it is run by hand before a
 * prompt or model change and the scorecard is quoted in the commit message --
 * the same way check:size records a budget.
 *
 * Each report is made through the generation core (src/lib/generationCore.ts
 * `makeReport`, 2026-11-24, the MCP work's wave 10 and finding NODE-9 of its
 * design audit), the one way the workspace, Batch and the MCP server's
 * generate_report make one, with the Node parts that tool runs it with
 * (src/mcp/nodeGeneration.ts) and an injected ask: geminiService's real
 * `analyzeReportDesign`, recording what each request carried. So the picture
 * is taken in as the app takes it (lib/repxIntake.ts: straightened when it
 * lies turned, drawn again past MAX_IMAGE_EDGE or a weight worth sending),
 * its text read by OCR (PaddleOCR where vendor/paddle holds its pinned models,
 * Tesseract otherwise), the settings worked out from what the page shows,
 * Forma's team prepares the box reader's brief and draft,
 * the AI corrects the draft, the print check sends back what does not print,
 * and every repair pass and the audit run as they do in the product. Until
 * that day this file was a third copy of the pipeline (its own OCR, box
 * reader and brief, `readerBriefFor`), which sent neither the brief nor the
 * draft unless asked and sent the image as it was: `git log -S
 * "readerBriefFor"` finds it.
 *
 * What still differs from the browser, deliberately and recorded here rather
 * than papered over, is what differs for the MCP server (docs/notes/mcp.md,
 * *What Node makes a report with*, finding NODE-11): the key arrives from the
 * environment because there is no Settings dialog; text is measured on
 * @napi-rs/canvas (lib/textMeasure.ts `measureOn`) where the browser measures
 * on its own canvas, the two held to DevExpress's widths within 0.04 units in
 * Arial, Times New Roman and Trebuchet MS; where the machine lacks Arial,
 * Times New Roman, Courier New, Calibri or Cambria, in the metric-compatible
 * faces src/mcp/nodeFonts.ts registers under their names (the same widths,
 * Caladea's Cambria's to within its rounding), and any other
 * missing family in a fallback face; PaddleOCR's picture is enlarged with
 * `resizeRgb` where the browser's canvas smooths it; no handwriting is read;
 * the paper follows the page and the words, with no locale behind them, so a
 * page that says nothing is laid on Letter, as in a browser set to en-US; and
 * nothing of a person's is used: no memory, kept reports, report library,
 * house style, shared database (a case's own `database` aside), vision model
 * or learning event. The house evaluation's refines (`--house`) still call
 * `analyzeReportDesign` directly, as a refinement of an open report in words
 * does in the chat.
 *
 * A case is a directory holding `case.json` and a source. The source is a
 * `.png`/`.jpg`/`.webp` image, a `.repx` file, or an `.html` page that the
 * runner renders to `<name>.png` with headless Edge the first time it is seen
 * (Windows only; on another OS render it yourself and commit nothing). HTML
 * sources are the ones committed here: a rendered PNG is a screenshot, which
 * CONTRIBUTING bans outside docs/media, and a page that renders to one is a
 * recipe, exactly like assets/source/og-card.html. Real reports belong in a
 * `local-*` case directory, which .gitignore keeps out of the repository.
 *
 *   {
 *     "source": "source.html",
 *     "prompt": "",
 *     "config": { "version": "20.1", "unit": "HundredthsOfAnInch", "pageSize": "Letter" },
 *     "render": { "width": 1275, "height": 1650 },
 *     "expect": { ...FidelityExpectations, see src/lib/fidelity.ts... }
 *   }
 *
 * A case's `config` is the stored settings a run begins from, as the
 * workspace's are, and the core lays what it works out over them: the paper
 * from the page's shape or the words, always, and the version and unit from
 * an attached .repx. So its `pageSize` changes no run; it is the paper
 * `--measure-source` assumes the render stands for. Each record keeps both:
 * `caseConfig`, and `config`, the settings the report was made with (the
 * wave-10 review's R5: a record said A4 for a report made on Letter).
 *
 * The key never touches disk. It is read from FORMA_BENCH_KEY, passed as
 * `config.customApiKey` the way the Settings dialog would, and the results
 * written out carry the settings with their keys removed. Do not add a .env
 * fallback: CLAUDE.md's rule that .env holds no Gemini key is the correction
 * to a real leak. The core's Node parts write only to Forma's own folder
 * (OCR's gathered languages, the model chosen and the models a limit parked,
 * each by the key's tag, never the key: src/mcp/nodeGeneration.ts
 * `formaUserFolder`, src/mcp/modelParks.ts) and to the results folder. A run
 * shares those parks with the MCP server on the same key (and the command
 * line, once it exists), so a model one found spent today is not asked again
 * by the other.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyzeReportDesign, type ReportConfig } from '../../src/services/geminiService';
import type { AnalysisResponse } from '../../src/lib/reportTypes';
import { readCachedModel } from '../../src/lib/modelCache';
import { importReports, retrieveHouseStyle } from '../../src/services/library';
import { embedEntries, embedTexts } from '../../src/services/embeddings';
import type { LibraryEntry } from '../../src/lib/embedStore';
import { captionsOfDraft, readCoverage, worthAnotherTry, type ReadCoverage } from '../../src/lib/readCoverage';
import { layoutFromFile } from '../../src/lib/layoutFile';
import { databaseStep } from '../../src/lib/databaseAi';
import { readerAttachments } from '../../src/lib/pageReading';
import { makeReport, type GenerationDeps, type IntakeDeps } from '../../src/lib/generationCore';
import { nodeGeneration, type NodeGeneration } from '../../src/mcp/nodeGeneration';
import { fileFrom } from '../../src/mcp/nodeIntake';
import { capturingConsole, formaDraftOf, settingsOf, watched, type FormaDraft, type Seen } from './formaDraft';
import {
  checkFidelity,
  measureReport,
  median,
  rowsForReport,
  scoreChecks,
  selfTest,
  type CaseData,
  type FidelityCheck,
  type FidelityExpectations,
  type FidelityMeasurements,
} from '../../src/lib/fidelity';
import { layoutFromRepx } from '../../src/lib/repxViews';
import { paperInches } from '../../src/lib/reportGeometry';
import { generateOffline, type OfflineRequest } from '../../src/lib/offlineGenerator';
import { keptStyleOf, preferencesOf, rememberKept, type MemoryState } from '../../src/lib/memory';
import type { FormaModel } from '../../src/lib/formaModel';

/*
 * Text is measured where the core's Node parts measure it: nodeGeneration
 * hands lib/textMeasure.ts an @napi-rs/canvas (`measureOn`), so a page's sizes
 * read from the letters' widths (lib/ocrLayout.ts, the full audit's CC-08),
 * the box reader's control widths and OCR's copy are measured as the MCP
 * server measures them, in the machine's own Arial and Times New Roman, or in
 * the Liberation faces nodeGeneration registers under those names where the
 * machine lacks them (src/mcp/nodeFonts.ts, 2026-11-24). From
 * 2026-11-11 until the move to the core this file measured a page's sizes in
 * the Liberation files the PDF export embeds (`measureFacesWith`), the only
 * widths Node had, and the box reader's widths not at all (the rough 0.6 em a
 * letter). The move's parity gate (2026-11-24, `--forma` on pictures drawn
 * from the public .repx files, before and after) measured both: the canvas's
 * sizes gave the Liberation files' reports exactly, and the measured widths
 * moved five drafts' controls by a few bytes' worth with no score changed.
 * That gate ran on Windows, whose Arial and Times New Roman have Liberation's
 * widths, so it could not see a Linux machine measuring in DejaVu; the
 * registration gives every machine the widths the Liberation files gave.
 */

/**
 * Where a run's results go unless --out names a folder: beside the repository,
 * not in it (2026-11-11, the full audit's RH-05). They went to
 * fidelity-results/ in the working tree, where 386 files and 20.5 MB had
 * collected, ignored by git but copied, searched and backed up with the
 * source. The owner keeps everything of Forma's in DevFiles, and the model
 * data folder beside the repository is where the rest of it already is. Read
 * from the repository's root, as every path in this script is.
 */
const RESULTS_DIR = join('..', 'forma-model-data-kept-not-in-git', 'forma-model-data', 'fidelity-results');

interface CaseFile {
  source: string;
  prompt?: string;
  config?: Partial<ReportConfig>;
  render?: { width?: number; height?: number };
  /**
   * A made-up database's layout beside the source (2026-11-09, the SQL Server
   * programme, item 23): a CREATE script or Forma's layout export, shared with
   * the AI as the app shares an attached one (`designSection`), and the data
   * source written from its answer (`writeFromAnswer`) before scoring.
   */
  database?: string;
  /** The page's records, `data.json` by default when it is there (CC-02). */
  data?: string;
  expect: FidelityExpectations;
  notes?: string;
}

interface LoadedCase {
  name: string;
  dir: string;
  file: CaseFile;
  /** The page's records, or null when the case has none. */
  data: CaseData | null;
}

/** What DevExpress printed (`--probe`): its page count and the margins it loaded, beside Forma's print. */
interface ProbeRecord {
  pages: number | null;
  margins: number[] | null;
  formaPages: number | null;
  error: string | null;
}

interface RunRecord {
  case: string;
  run: number;
  startedAt: string;
  elapsedMs: number;
  model: string | null;
  /**
   * The settings the report was made with, its keys left out: since
   * 2026-11-24 (the wave-10 review's R5) the ones the core worked out from
   * the page, the words and an attached .repx (the answering AI's, when one
   * answered), where it had written the case's own, which a picture's paper
   * then overrode unseen. Before the core works them out, the case's own.
   */
  config: Omit<ReportConfig, 'customApiKey' | 'openRouterKey'>;
  /** The stored settings the run began from: the runner's defaults with the case's `config` over them (since 2026-11-24; older records have none, and their `config` is this). */
  caseConfig?: Omit<ReportConfig, 'customApiKey' | 'openRouterKey'>;
  prompt: string;
  response: AnalysisResponse | null;
  error: string | null;
  measurements: FidelityMeasurements | null;
  checks: FidelityCheck[];
  /**
   * How much of what Forma read on the page the report kept (2026-11-10,
   * lib/readCoverage.ts): the captions and titles of the box reader's draft
   * found in the REPX, and in which band. Null when the case is not a picture or
   * the reader declined it. Computed again on a replay, from today's reading.
   */
  coverage?: ReadCoverage | null;
  /** DevExpress's own print of the report (`--probe`), when it was asked. */
  probe?: ProbeRecord | null;
  /**
   * Everything the service wrote to the console during this run. The pipeline
   * explains itself there and nowhere else -- which model it chose, why a
   * margin lift declined, the finishReason and the last 120 characters of a
   * response it could not parse -- and the first baseline lost all of it: two
   * runs failed on output limits and the only record was the one-line error.
   */
  log: string[];
}

function parseArgs(argv: string[]) {
  const opts = {
    cases: 'scripts/fidelity/cases',
    only: [] as string[],
    runs: 1,
    out: '',
    replay: '',
    model: '',
    thinking: undefined as number | undefined,
    rerender: false,
    strict: false,
    keyFromClipboard: false,
    house: '',
    brief: false,
    draft: false,
    forma: false,
    style: '',
    localModel: '',
    localUrl: 'http://localhost:11434/v1',
    pageReader: '',
    score: [] as [string, string][],
    probe: false,
    measureSource: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case '--cases': opts.cases = next(); break;
      case '--only': opts.only.push(next()); break;
      case '--runs': opts.runs = Math.max(1, Number(next()) || 1); break;
      case '--out': opts.out = next(); break;
      case '--replay': opts.replay = next(); break;
      case '--model': opts.model = next(); break;
      case '--thinking': opts.thinking = Number(next()); break;
      case '--rerender': opts.rerender = true; break;
      case '--strict': opts.strict = true; break;
      case '--key-from-clipboard': opts.keyFromClipboard = true; break;
      case '--house': opts.house = next(); break;
      case '--brief': opts.brief = true; break;
      case '--draft': opts.draft = true; break;
      case '--forma': opts.forma = true; break;
      case '--style': opts.style = next(); break;
      case '--local-model': opts.localModel = next(); break;
      case '--local-url': opts.localUrl = next(); break;
      case '--page-reader': opts.pageReader = next(); break;
      case '--score': {
        const name = next();
        opts.score.push([name, next()]);
        break;
      }
      case '--probe': opts.probe = true; break;
      case '--measure-source': opts.measureSource = true; break;
      default: throw new Error(`Unknown option ${a}`);
    }
  }
  return opts;
}

function loadCases(root: string, only: string[]): LoadedCase[] {
  if (!existsSync(root)) throw new Error(`No cases directory at ${root}`);
  const cases: LoadedCase[] = [];
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    if (!statSync(dir).isDirectory()) continue;
    const path = join(dir, 'case.json');
    if (!existsSync(path)) continue;
    if (only.length && !only.includes(entry)) continue;
    const file = JSON.parse(readFileSync(path, 'utf8')) as CaseFile;
    if (!file.source || !file.expect) throw new Error(`${path} needs "source" and "expect"`);
    const dataPath = join(dir, file.data ?? 'data.json');
    const data = existsSync(dataPath) ? (JSON.parse(readFileSync(dataPath, 'utf8')) as CaseData) : null;
    if (data && !Array.isArray(data.rows)) throw new Error(`${dataPath} needs "rows"`);
    cases.push({ name: entry, dir, file, data });
  }
  cases.sort((a, b) => a.name.localeCompare(b.name));
  return cases;
}

function edgePath(): string | null {
  const candidates = [
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Render an .html source to a PNG beside it.
 *
 * Old `--headless`, not `--headless=new`: the new mode ignores `--screenshot`
 * and exits 0 having written nothing, so a stale file would silently survive
 * and look like a fresh render (docs/notes/app-shell.md, the OG card). The PNG
 * is removed first for the same reason -- if the render fails, there is no
 * file, rather than yesterday's.
 */
function renderHtml(htmlPath: string, pngPath: string, render: CaseFile['render']): void {
  const edge = edgePath();
  if (!edge) {
    throw new Error(`${htmlPath} needs rendering to ${pngPath} and headless Edge was not found; render it yourself and re-run`);
  }
  const width = render?.width ?? 1275;
  const height = render?.height ?? 1650;
  if (existsSync(pngPath)) {
    // rmSync would do; writeFileSync of nothing keeps the import list short and
    // the failure mode identical (an empty file is as loud as a missing one).
    writeFileSync(pngPath, '');
  }
  const url = 'file:///' + resolve(htmlPath).replace(/\\/g, '/');
  const result = spawnSync(edge, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    '--virtual-time-budget=5000',
    `--user-data-dir=${join(process.env.TEMP ?? process.env.TMP ?? '.', 'forma-fidelity-edge')}`,
    `--screenshot=${resolve(pngPath)}`,
    url,
  ], { stdio: 'ignore', timeout: 60_000 });
  if (result.error) throw result.error;
  if (!existsSync(pngPath) || statSync(pngPath).size === 0) {
    throw new Error(`Edge exited ${result.status} and wrote nothing to ${pngPath}`);
  }
}

/**
 * The key, from the clipboard or the environment.
 *
 * The clipboard route exists for one reason: a key typed into a command line
 * is recorded by the shell's history and by any agent session the command ran
 * in, and a key written to a file is the leak CLAUDE.md's .gitignore patterns
 * exist to catch. Read once, used for this process, never printed. Windows and
 * macOS have a clipboard command; on Linux it tries xclip, then wl-paste.
 */
function readKey(fromClipboard: boolean): string {
  if (!fromClipboard) return process.env.FORMA_BENCH_KEY?.trim() ?? '';
  const attempts: Array<[string, string[]]> =
    process.platform === 'win32'
      ? [['powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw']]]
      : process.platform === 'darwin'
        ? [['pbpaste', []]]
        : [['xclip', ['-selection', 'clipboard', '-o']], ['wl-paste', ['--no-newline']]];
  for (const [cmd, args] of attempts) {
    const result = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (result.status === 0 && result.stdout) return result.stdout.trim();
  }
  return '';
}

/**
 * The file a case sends: its picture, its report, or for an .html source the
 * picture it renders to, rendered first when `render` is on and none is there
 * yet (or `rerender` asks). With `render` off, an .html source with no picture
 * yet is null: a replay reads what is there and starts no browser.
 */
function sourcePathOf(c: LoadedCase, render: boolean, rerender = false): string | null {
  const path = join(c.dir, c.file.source);
  if (extname(path).toLowerCase() !== '.html') return path;
  const png = path.replace(/\.html$/i, '.png');
  if (render && (rerender || !existsSync(png))) {
    console.log(`[${c.name}] rendering ${basename(path)} -> ${basename(png)}`);
    renderHtml(path, png, c.file.render);
  }
  return existsSync(png) ? png : null;
}

/** Whether a source is a picture the core reads with OCR, which Forma's draft is made from. */
const isPicture = (path: string) => /\.(png|jpe?g|webp)$/i.test(path);

/**
 * What the core takes in for a case: its source as the file a person drops,
 * typed by its extension (src/mcp/nodeIntake.ts `fileFrom`) and named after
 * the case, as the runner named the page it read before 2026-11-24, under the
 * case's name as its upload.
 */
function filesFor(c: LoadedCase, path: string): { file: File; uploadId: string }[] {
  return [{ file: fileFrom(`${c.name}${extname(path).toLowerCase()}`, readFileSync(path)), uploadId: c.name }];
}

/**
 * Node's parts for the generation core, assembled once for the run, as the
 * MCP server's AI tools assemble them (src/mcp/nodeGeneration.ts): OCR,
 * Forma's box reader and own model from assets/model, text measured on
 * @napi-rs/canvas, and the model Gemini answers with kept in Forma's folder by
 * the key's tag. Its lines go to the console, which a run captures.
 */
let generation: Promise<NodeGeneration> | null = null;
const nodeParts = () => (generation ??= nodeGeneration({ log: (line) => console.warn(line) }));

/** What stood in, in the words the scorecard's log has used since 2026-11-10. */
const DRAFT_WORDS: Record<string, string> = { reader: 'the box reader', ocr: "OCR's copy", vision: "Forma's vision model", offline: "Forma's own model, from the words" };

/**
 * Forma's own draft of a case, with no AI (`--forma`, and the reading a
 * replay's coverage needs): scripts/fidelity/formaDraft.ts, with the MCP
 * server's Node parts, the case's source as its file and its words.
 */
async function formaDraftFor(c: LoadedCase, path: string, config: ReportConfig, log: string[]): Promise<FormaDraft> {
  return formaDraftOf(await nodeParts(), { files: filesFor(c, path), words: c.file.prompt ?? '', config }, log);
}

/** A run's settings as they are written out: never a key. */
function withoutKey(config: ReportConfig): Omit<ReportConfig, 'customApiKey' | 'openRouterKey'> {
  const { customApiKey: _key, openRouterKey: _openRouter, ...rest } = config;
  return rest;
}

/** Settings as the log writes them: version, unit, paper and direction. */
const settingsLine = (s: ReportConfig) => `${s.version}, ${s.unit}, ${s.pageSize}${s.rtl ? ', right to left' : ''}`;

/**
 * A person's own preferences for `--style` (2026-11-11, D1): a folder of the
 * .repx files they kept, each read as the memory reads a kept report (its
 * style, never its words) and summed up as `preferencesOf` sums them for the
 * app; or a .json of those preferences as they are.
 */
function loadStyle(path: string): OfflineRequest['preferences'] {
  if (!statSync(path).isDirectory()) return JSON.parse(readFileSync(path, 'utf8')) as OfflineRequest['preferences'];
  let state: MemoryState = { memories: [], kept: [], learnFromKept: true, ledger: [] };
  for (const name of readdirSync(path).filter((n) => /\.repx$/i.test(n)).sort()) {
    const style = keptStyleOf(readFileSync(join(path, name), 'utf8'), new Date(), name);
    if (style) state = rememberKept(state, style);
  }
  if (state.kept.length < 2) throw new Error(`--style ${path}: a style is learned from two kept reports, and ${state.kept.length} could be read`);
  return preferencesOf(state);
}

/** The face most of a report's `Font` attributes name, or null. */
function faceOf(xml: string): string | null {
  const counts = new Map<string, number>();
  for (const m of xml.matchAll(/\bFont="([^,"]+),/g)) counts.set(m[1].trim(), (counts.get(m[1].trim()) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** The source's own face: a .repx's most used, an .html's first `font-family`; null for a picture. */
function sourceFace(c: LoadedCase): string | null {
  const path = join(c.dir, c.file.source);
  const ext = extname(path).toLowerCase();
  if (ext === '.repx') return faceOf(readFileSync(path, 'utf8'));
  if (ext === '.html') return /font-family:\s*['"]?([^;,'"]+)/i.exec(readFileSync(path, 'utf8'))?.[1].trim() ?? null;
  return null;
}

let formaModelCache: FormaModel | null = null;

/**
 * `--style`: the case designed from its words by Forma's own model, as the
 * app stands one in for a described report (lib/learningLoop.ts
 * `designFromWords`), without the person's style and with it, each one's face
 * and median size printed beside the source's, with the case's own fontSize
 * checks. Measurement only: it changes no score.
 */
function styleComparison(c: LoadedCase, preferences: OfflineRequest['preferences']): string[] {
  formaModelCache ??= JSON.parse(readFileSync('assets/model/formaModel.json', 'utf8')) as FormaModel;
  const description = c.file.prompt?.trim() || c.name.replace(/[-_]+/g, ' ');
  const source = sourceFace(c);
  const sourcePt = c.file.expect.fontSize?.relative?.sourcePt ?? null;
  const runs: [string, OfflineRequest['preferences']][] = [['without the style', undefined], ['with the style', preferences]];
  return runs.map(([label, prefs]) => {
    const design = generateOffline(formaModelCache!, { description, preferences: prefs });
    const m = measureReport(design.repx, design.layout);
    const face = faceOf(design.repx);
    const sameFace = source && face ? (face.toLowerCase() === source.toLowerCase() ? ', the source\'s face' : `, the source's is ${source}`) : '';
    const checks = checkFidelity(m, c.file.expect).filter((k) => k.id.startsWith('fontSize'));
    return `own design from words, ${label}: ${face ?? 'no face'}${sameFace}; median ${m.fontMedianPt ?? '-'}pt${sourcePt ? ` (the source's ${sourcePt}pt)` : ''}${checks.length ? `; ${checks.map((k) => `${k.id} ${k.pass ? 'passes' : 'fails'}`).join(', ')}` : ''}`;
  });
}

function configFor(c: LoadedCase, key: string, opts: ReturnType<typeof parseArgs>): ReportConfig {
  const config: ReportConfig = {
    version: '23.2',
    unit: 'HundredthsOfAnInch',
    pageSize: 'Letter',
    ...c.file.config,
    customApiKey: key,
  };
  if (opts.model) config.modelName = opts.model;
  if (opts.localModel) Object.assign(config, { provider: 'local', localUrl: opts.localUrl, localModel: opts.localModel });
  if (opts.thinking !== undefined && Number.isFinite(opts.thinking)) config.thinkingBudget = opts.thinking;
  return config;
}

async function generate(c: LoadedCase, run: number, key: string, opts: ReturnType<typeof parseArgs>, outDir: string): Promise<RunRecord> {
  const config = configFor(c, key, opts);
  const prompt = c.file.prompt ?? '';
  const startedAt = new Date();
  const record: RunRecord = {
    case: c.name,
    run,
    startedAt: startedAt.toISOString(),
    elapsedMs: 0,
    model: null,
    // The case's own until the core has worked the request's out (below).
    config: withoutKey(config),
    caseConfig: withoutKey(config),
    prompt,
    response: null,
    error: null,
    measurements: null,
    checks: [],
    log: [],
  };
  // The draft the AI was asked to correct, for the coverage: what the request carried.
  let draftText: string | null = null;
  try {
    const path = sourcePathOf(c, true, opts.rerender && run === 1) as string;
    // Forma's own draft, no AI (--forma, 2026-11-10), as the core stands it in since 2026-11-24.
    if (opts.forma) {
      const own = await formaDraftFor(c, path, config, record.log);
      record.config = withoutKey(own.settings);
      record.log.push(`[runner] the core worked out ${settingsLine(own.settings)}`);
      record.log.push(`[runner] Forma's own draft: ${own.standIn ? DRAFT_WORDS[own.standIn.source] ?? own.standIn.source : 'none (not a picture)'}`);
      // A person's own style on Forma's design from words, before and after (--style, D1).
      if (opts.style) {
        for (const line of styleComparison(c, loadStyle(opts.style))) {
          record.log.push(`[runner] ${line}`);
          console.log(`[${c.name}] ${line}`);
        }
      }
      if (!own.standIn) record.error = own.pictures ? "Forma's own draft could not be made from the picture" : 'Forma makes no draft without a picture';
      // The parity the move to the core was held to: the draft scored before the chain must be the one that stood in.
      if (own.sameAsStandIn === false) record.error = "Forma's draft taken again before the repair chain is not the one that stood in, so the before-the-chain score would be of another report";
      record.elapsedMs = Date.now() - startedAt.getTime();
      record.model = 'forma-draft';
      /*
       * Through the repair chain, as the core puts every report Forma builds
       * itself (`asConfigured`, ARCH-1b, lib/repairChain.ts), and scored before
       * and after it, so the chain's effect on Forma's own drafts is measured
       * rather than assumed (the CCC batch of wave 6).
       */
      if (own.raw) {
        const raw: RunRecord = { ...record, response: own.raw };
        score(raw, c);
        const s = scoreChecks(raw.checks);
        const failed = raw.checks.filter((k) => !k.pass).map((k) => k.id);
        record.log.push(`[runner] before the repair chain: ${s.passed}/${s.total}${failed.length ? ` (failed ${failed.join(', ')})` : ''}`);
        console.log(`[${c.name}] Forma's own draft before the repair chain: ${s.passed}/${s.total}${failed.length ? `, failed ${failed.join(', ')}` : ''}`);
      }
      // The layout read again off the configured file, as the app reads its views: the draft's own was read before the chain.
      if (own.standIn) record.response = { markdown: own.raw?.markdown ?? '', repxContent: own.standIn.repxContent, layout: layoutFromRepx(own.standIn.repxContent) };
      score(record, c);
      return record;
    }
    // The AI's design, as the core asks it, with what each request carried kept to say below.
    const sent: NonNullable<Parameters<typeof analyzeReportDesign>[6]>[] = [];
    const ask: NonNullable<GenerationDeps['ask']> = (words, parts, asked, previous, signal, onProgress, options) => {
      if (options) sent.push(options);
      return analyzeReportDesign(words, parts, asked, previous, signal, onProgress, options);
    };
    /*
     * The case's database, shared as the app shares an attached one
     * (2026-11-09): read as every layout file is (lib/layoutFile.ts), and
     * App's own step, the one builder, without the Data tab's query
     * (2026-11-24, D1-8). A case whose database cannot be read fails, where
     * it ran unbound before with no word.
     */
    const layout = c.file.database ? layoutFromFile(new Uint8Array(readFileSync(join(c.dir, c.file.database))), basename(c.file.database)) : null;
    if (layout && !layout.ok) throw new Error(`The case's database: ${layout.reason}`);
    for (const line of layout?.ok ? layout.said : []) record.log.push(`[runner] ${line}`);
    const database = layout?.ok ? databaseStep(layout.schema) : undefined;
    // The page reader's reading of each page beside OCR's, as the app sends it (2026-11-10).
    const reader = opts.pageReader ? { baseUrl: opts.localUrl, model: opts.pageReader } : null;
    const seen: Seen = { read: [], detected: null };
    const deps: GenerationDeps & IntakeDeps = {
      ...watched((await nodeParts()).deps(config), seen),
      ask,
      ...(database ? { database } : {}),
      ...(reader ? { pageReader: (pages: Parameters<NonNullable<GenerationDeps['pageReader']>>[0], signal: AbortSignal) => readerAttachments(reader, pages, signal) } : {}),
    };
    const made = await capturingConsole(record.log, () => makeReport({ files: filesFor(c, path), words: prompt, config, signal: new AbortController().signal }, deps));
    // The settings the request was made with: the answering AI's when one answered, else the ones the core worked out.
    record.config = withoutKey(made?.ok ? made.answering : settingsOf(config, seen));
    const first = sent[0];
    const brief = first?.formaBrief ?? '';
    const draft = first?.draft ?? null;
    console.log(`[${c.name}] Forma's draft: ${draft ? `${draft.text.split('\n').length} lines, ${draft.text.length} characters` : 'none (not a picture, or the reader declined the page)'}`);
    console.log(`[${c.name}] box reader brief: ${brief ? `${brief.split('\n').length} lines` : 'none (not a picture, or the reader declined the page)'}`);
    if (reader) record.log.push(`[runner] page reader ${reader.model}: ${first?.readings?.length ? `read ${first.readings.length} page(s)` : 'nothing'}`);
    if (!made) throw new Error('The run was stopped.');
    if (!made.ok) {
      // As the app would show it: Forma's draft in place of the AI's report. The scorecard measures the AI, so the run fails.
      if (made.standIn) record.log.push(`[runner] every AI failed; the app would show Forma's own draft in its place (${DRAFT_WORDS[made.standIn.source] ?? made.standIn.source})`);
      throw made.error;
    }
    record.log.push(`[runner] the core worked out ${settingsLine(made.answering)}; ${made.note || `answered by ${made.by}`}`);
    for (const notice of made.notices) record.log.push(`[runner] ${notice}`);
    if (made.dataNote) record.log.push(`[runner] database: ${made.dataNote}`);
    // The report as it goes to the person: turned right to left where its source is, its views read again when that changed it.
    record.response = made.repxContent === made.response.repxContent ? made.response : { ...made.response, repxContent: made.repxContent, layout: layoutFromRepx(made.repxContent) };
    draftText = made.team.correct?.text ?? null;
  } catch (error: any) {
    record.error = error?.message ?? String(error);
    // The service attaches what it could not parse. Kept as its own file so
    // the next person can see where a 51,813-character response went wrong,
    // rather than the 120 characters the console shows.
    if (typeof error?.rawResponse === 'string') {
      const rawPath = join(outDir, `${c.name}-${run}.raw.txt`);
      writeFileSync(rawPath, error.rawResponse);
      record.log.push(`[runner] raw response saved to ${rawPath}`);
    }
  }
  record.elapsedMs = Date.now() - startedAt.getTime();
  // The model that answered, as the service's timing line names it, not the
  // one detection picked: a model out of its daily quota falls back to the
  // next, and the scorecard credited the first with the second's work until
  // 2026-11-06 (2.5 Flash named, Flash-Lite answering).
  const answered = [...record.log].reverse().map((line) => /Generation timing .*\(model: ([^,)]+)/.exec(line)?.[1]).find(Boolean);
  record.model = answered ?? readCachedModel();
  score(record, c);
  record.coverage = await coverageFor(c, record, draftText);
  return record;
}

/**
 * What the report kept of the captions and titles Forma read on the case's
 * page (`readCoverage`): from the draft the request carried, or, on a replay,
 * the draft the core makes of the page today with no AI asked. Null with no
 * picture, an .html source not rendered yet (a replay starts no browser), or
 * a page the reader declined.
 */
async function coverageFor(c: LoadedCase, record: RunRecord, draftText?: string | null): Promise<ReadCoverage | null> {
  if (!record.response?.repxContent) return null;
  let text = draftText ?? null;
  if (draftText === undefined) {
    const path = sourcePathOf(c, false);
    if (!path || !isPicture(path)) return null;
    // The stored settings the run began from: a record written before 2026-11-24's review kept them as its `config`.
    text = (await formaDraftFor(c, path, { ...(record.caseConfig ?? record.config), customApiKey: '' }, [])).correctText;
  }
  return text ? readCoverage(captionsOfDraft(text), record.response.repxContent) : null;
}

/*
 * The report library's evaluation (2026-11-04; docs/proposals/rag.md, *How
 * we would know it worked*), on made-up reports the owner chose over the
 * company's, so nothing of theirs is sent anywhere.
 *
 * `--house <dir>` imports the .repx files there into an in-memory library,
 * embedded with the real model, as the Library panel would. Then each case's
 * first pass is refined twice with the same neutral instruction: once as
 * today, and once with the house-style block `retrieveHouseStyle` builds from
 * the library against that draft. The house's look is its body text's font
 * family and median size; each refine is scored by the share of its text
 * controls in that family and its median size, beside the first pass's.
 * Retrieval is real, so this measures what reaches the model and what the
 * model does with it; a held-out real report remains the stronger test.
 */
/** A refine that does not mention the house, and one that asks for it. */
const HOUSE_INSTRUCTIONS = [
  'Tidy up the formatting of this report, keeping its content.',
  'Restyle this report in our house style, keeping its content.',
];

interface Look {
  family: string;
  size: number;
}

/**
 * The font each label and table cell prints in: its own Font, else its style's,
 * else the nearest enclosing element's, as DevExpress inherits it. A scan of
 * the tags rather than a parse, which is enough for what the serializer and
 * the model write.
 */
function textFonts(xml: string): Look[] {
  const attr = (attrs: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];
  const styles = new Map<string, string>();
  const sheet = /<StyleSheet>([\s\S]*?)<\/StyleSheet>/.exec(xml)?.[1] ?? '';
  for (const m of sheet.matchAll(/<Item\d+\b([^>]*?)\/?>/g)) {
    const name = attr(m[1], 'Name');
    const font = attr(m[1], 'Font');
    if (name && font) styles.set(name, font);
  }
  const out: Look[] = [];
  const stack: string[] = [];
  for (const m of xml.replace(/<StyleSheet>[\s\S]*?<\/StyleSheet>/, '').matchAll(/<(\/?)([\w.:]+)([^>]*?)(\/?)>/g)) {
    const [, close, , attrs, self] = m;
    if (close) {
      stack.pop();
      continue;
    }
    const styleName = attr(attrs, 'StyleName');
    const font = attr(attrs, 'Font') ?? (styleName ? styles.get(styleName) : undefined) ?? stack[stack.length - 1] ?? '';
    if (/\bControlType="[^"]*\bXR(Label|TableCell)\b/.test(attrs) && font) {
      out.push({ family: font.split(',')[0].trim(), size: Number(/(\d+(?:\.\d+)?)pt/.exec(font)?.[1] ?? 0) });
    }
    if (!self) stack.push(font);
  }
  return out;
}

/** The body text of some reports: their commonest font family and median size. */
function lookOf(xmls: readonly string[]): Look {
  const fonts = xmls.flatMap(textFonts);
  const families = new Map<string, number>();
  for (const f of fonts) families.set(f.family, (families.get(f.family) ?? 0) + 1);
  const family = [...families].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  return { family, size: median(fonts.map((f) => f.size).filter((s) => s > 0)) ?? 0 };
}

/** How much of a report's text is in the house's family, and its median size. */
function adoption(xml: string | undefined, house: Look): { share: number; size: number } {
  const fonts = textFonts(xml ?? '');
  const inFamily = fonts.filter((f) => f.family.toLowerCase() === house.family.toLowerCase()).length;
  return { share: fonts.length ? inFamily / fonts.length : 0, size: lookOf(xml ? [xml] : []).size };
}

async function houseEvaluation(records: RunRecord[], cases: LoadedCase[], key: string, opts: ReturnType<typeof parseArgs>, outDir: string): Promise<void> {
  const files = readdirSync(opts.house)
    .filter((f) => f.toLowerCase().endsWith('.repx'))
    .map((f) => ({ name: f, text: readFileSync(join(opts.house, f), 'utf8') }));
  const house = lookOf(files.map((f) => f.text));
  let entries: LibraryEntry[] = [];
  const deps = { storage: { load: async () => entries, save: async (e: readonly LibraryEntry[]) => { entries = [...e]; } }, embedEntries, embedTexts };
  const imported = await importReports(files, deps, { apiKey: key });
  console.log(`\n=== house style: ${files.length} report(s), ${imported.added} fragment(s) embedded; their body text is ${house.family} ${house.size}pt ===`);
  const lines = [`| case | instruction | first pass | refined as today | refined with the house style |`, `|---|---|---|---|---|`];
  const cell = (a: { share: number; size: number }) => `${Math.round(a.share * 100)}% ${house.family}, median ${a.size}pt`;
  for (const r of records) {
    if (!r.response?.repxContent) continue;
    const c = cases.find((x) => x.name === r.case);
    if (!c) continue;
    const config = configFor(c, key, opts);
    const previous = { repxContent: r.response.repxContent };
    for (const [i, instruction] of HOUSE_INSTRUCTIONS.entries()) {
      const log: string[] = [];
      try {
        const plain = await capturingConsole(log, () => analyzeReportDesign(instruction, [], config, previous));
        const block = await retrieveHouseStyle(r.response.repxContent, instruction, deps, { apiKey: key });
        writeFileSync(join(outDir, `${r.case}-${r.run}.house-block-${i + 1}.txt`), block);
        const styled = await capturingConsole(log, () => analyzeReportDesign(instruction, [], config, { ...previous, houseStyle: block }));
        writeFileSync(join(outDir, `${r.case}-${r.run}.refined-${i + 1}.repx`), plain.repxContent);
        writeFileSync(join(outDir, `${r.case}-${r.run}.house-${i + 1}.repx`), styled.repxContent);
        const fragments = (block.match(/^--- example \d+/gm) ?? []).length;
        const row = `| ${r.case} | ${instruction} | ${cell(adoption(r.response.repxContent, house))} | ${cell(adoption(plain.repxContent, house))} | ${cell(adoption(styled.repxContent, house))} (${fragments} fragment(s) retrieved) |`;
        lines.push(row);
        console.log(row);
      } catch (error: any) {
        lines.push(`| ${r.case} | ${instruction} | failed: ${String(error?.message ?? error).slice(0, 120)} | | |`);
        console.log(`[${r.case}] house evaluation failed: ${error?.message ?? error}`);
      }
    }
  }
  writeFileSync(join(outDir, 'house.md'), [`House style: ${house.family} ${house.size}pt body, from ${files.map((f) => f.name).join(', ')}.`, '', ...lines, ''].join('\n'));
}

function score(record: RunRecord, c: LoadedCase): void {
  if (!record.response) {
    record.measurements = null;
    record.checks = [{ id: 'generated', pass: false, expected: 'a response', actual: record.error ?? 'none' }];
    return;
  }
  // Printed with the page's records when the case has them (CC-02).
  record.measurements = measureReport(record.response.repxContent, record.response.layout, c.data);
  record.checks = checkFidelity(record.measurements, c.file.expect);
}

/**
 * A `.repx` case's own source, scored as if it were the answer (CC-02): the
 * checks it fails. None means the case cannot tell a fixed report from the
 * one it asks to have fixed, which the scorecard says.
 */
function selfTestOf(c: LoadedCase): FidelityCheck[] | null {
  if (extname(c.file.source).toLowerCase() !== '.repx') return null;
  return selfTest(readFileSync(join(c.dir, c.file.source), 'utf8'), c.file.expect, c.data);
}

/** Where the built probe is, or null off Windows or before it is built (tools/RepxProbe/README.md). */
function probePath(): string | null {
  if (process.platform !== 'win32') return null;
  const path = resolve('tools/RepxProbe/bin/Release/RepxProbe.exe');
  return existsSync(path) ? path : null;
}

/**
 * Print a report through the installed DevExpress with the case's records
 * (`--probe`, CC-02): `RepxProbe render` over a case folder of its own in the
 * results directory, the records written in the probe's own data.json shape
 * (`Render.cs`), and its page count and loaded margins read back. Read-only,
 * local and windowless, as the probe is.
 */
function probeRecord(c: LoadedCase, record: RunRecord, outDir: string): ProbeRecord {
  const formaPages = record.measurements?.print?.pages ?? null;
  const exe = probePath();
  if (!exe) return { pages: null, margins: null, formaPages, error: 'RepxProbe is not built here (Windows with DevExpress 20.1 only)' };
  const xml = record.response?.repxContent;
  if (!xml) return { pages: null, margins: null, formaPages, error: 'no report' };
  const dir = resolve(join(outDir, 'probe', `${record.case}-${record.run}`));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.repx'), xml);
  if (c.data) {
    const { rows, types } = rowsForReport(xml, c.data);
    const NET: Record<string, string> = { date: 'DateTime', decimal: 'Decimal', int: 'Int32', double: 'Double', bool: 'Boolean' };
    const numeric = new Set(Object.entries(types).filter(([, t]) => t === 'decimal' || t === 'int' || t === 'double').map(([f]) => f));
    const table = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, numeric.has(k) && v !== '' && Number.isFinite(Number(v)) ? Number(v) : v])));
    const probeTypes = Object.fromEntries(Object.entries(types).filter(([, t]) => NET[t]).map(([f, t]) => [`Data.${f}`, NET[t]]));
    writeFileSync(join(dir, 'data.json'), JSON.stringify({ dataMember: 'Data', types: probeTypes, exports: [], tables: { Data: table } }, null, 2));
  }
  const out = join(dir, 'out');
  const run = spawnSync(exe, ['render', dir, out], { encoding: 'utf8', timeout: 180_000 });
  const json = join(out, 'render.json');
  if (!existsSync(json)) return { pages: null, margins: null, formaPages, error: `RepxProbe render wrote nothing (exit ${run.status}): ${(run.stderr || run.stdout || '').trim().split('\n').slice(-1)[0] ?? ''}` };
  const rendered = JSON.parse(readFileSync(json, 'utf8')) as { pageCount?: number; margins?: number[]; error?: string };
  return { pages: rendered.pageCount ?? null, margins: rendered.margins ?? null, formaPages, error: rendered.error ?? null };
}

/**
 * The median font size of an .html source as headless Edge lays it out
 * (`--measure-source`, CC-02), in points at the page the render stands for:
 * a copy of the page with a script that writes every visible text node's
 * computed size into the DOM, read back with `--dump-dom`. Nothing is written
 * beside the case; the copy lives in the results folder.
 */
function measureSourceFont(c: LoadedCase, outDir: string): number | null {
  const edge = edgePath();
  if (!edge || extname(c.file.source).toLowerCase() !== '.html') return null;
  const html = readFileSync(join(c.dir, c.file.source), 'utf8');
  const script = `<script>addEventListener('load',function(){var s=[],w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),n;while((n=w.nextNode())){if(!n.textContent.trim())continue;var cs=getComputedStyle(n.parentElement);if(cs.display==='none'||cs.visibility==='hidden')continue;s.push(parseFloat(cs.fontSize));}var p=document.createElement('pre');p.id='forma-font-sizes';p.textContent=JSON.stringify(s);document.body.appendChild(p);});</script>`;
  mkdirSync(outDir, { recursive: true });
  const copy = resolve(join(outDir, `${c.name}-measure.html`));
  writeFileSync(copy, html.includes('</body>') ? html.replace('</body>', () => `${script}</body>`) : html + script);
  const width = c.file.render?.width ?? 1275;
  const height = c.file.render?.height ?? 1650;
  const result = spawnSync(edge, [
    '--headless',
    '--disable-gpu',
    `--window-size=${width},${height}`,
    '--virtual-time-budget=5000',
    `--user-data-dir=${join(process.env.TEMP ?? process.env.TMP ?? '.', 'forma-fidelity-edge')}`,
    '--dump-dom',
    'file:///' + copy.replace(/\\/g, '/'),
  ], { encoding: 'utf8', timeout: 60_000 });
  const sizes = /<pre id="forma-font-sizes">([^<]*)<\/pre>/.exec(result.stdout ?? '')?.[1];
  if (!sizes) return null;
  const px = median(JSON.parse(sizes) as number[]);
  // The render is the page at some dpi: its long edge over the paper's.
  const inches = paperInches(c.file.config?.pageSize ?? 'Letter') ?? { w: 8.5, h: 11 };
  const dpi = Math.max(width, height) / Math.max(inches.w, inches.h);
  return px === null ? null : Math.round(((px / dpi) * 72) * 100) / 100;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function scorecard(records: RunRecord[]): string {
  const lines: string[] = [];
  const byCase = new Map<string, RunRecord[]>();
  for (const r of records) byCase.set(r.case, [...(byCase.get(r.case) ?? []), r]);

  lines.push(pad('case', 24) + pad('run', 5) + pad('score', 8) + pad('time', 8) + pad('model', 26) + 'failed checks');
  let passedAll = 0;
  let totalAll = 0;
  for (const [name, runs] of byCase) {
    for (const r of runs) {
      const s = scoreChecks(r.checks);
      passedAll += s.passed;
      totalAll += s.total;
      const failed = r.checks.filter((c) => !c.pass).map((c) => `${c.id} (${c.actual}; wanted ${c.expected})`);
      lines.push(
        pad(name, 24) +
          pad(String(r.run), 5) +
          pad(`${s.passed}/${s.total}`, 8) +
          pad(`${Math.round(r.elapsedMs / 1000)}s`, 8) +
          pad(r.model ?? '-', 26) +
          (failed.length ? failed.join('; ') : 'none'),
      );
    }
  }
  lines.push('');
  lines.push(`total ${passedAll}/${totalAll} checks passed (${totalAll ? Math.round((100 * passedAll) / totalAll) : 100}%) over ${records.length} run(s)`);
  return lines.join('\n');
}

function summaryMarkdown(records: RunRecord[], opts: ReturnType<typeof parseArgs>, selfTests: ReadonlyMap<string, readonly FidelityCheck[]> = new Map()): string {
  const lines: string[] = [];
  lines.push(`# Fidelity benchmark, ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Cases from \`${opts.cases}\`${opts.replay ? `, re-scored from \`${opts.replay}\`` : ''}.`);
  lines.push('');
  lines.push('```');
  lines.push(scorecard(records));
  lines.push('```');
  lines.push('');
  for (const [name, failed] of selfTests) {
    lines.push(failed.length ? `- ${name} self-test: the untouched source fails ${failed.map((f) => f.id).join(', ')}.` : `- **${name} self-test failed**: the untouched source passes every check, so the case measures nothing.`);
  }
  if (selfTests.size) lines.push('');
  for (const r of records) {
    lines.push(`## ${r.case} run ${r.run}`);
    lines.push('');
    if (r.error) {
      lines.push(`Error: ${r.error}`);
      lines.push('');
      lines.push('Last lines the service logged:');
      lines.push('```');
      for (const line of (r.log ?? []).slice(-12)) lines.push(line);
      lines.push('```');
    }
    if (r.measurements) {
      const m = r.measurements;
      lines.push(`- bands: ${m.bandOrder.join(', ') || 'none'}`);
      lines.push(`- controls: ${Object.entries(m.controls).map(([t, n]) => `${t} x${n}`).join(', ') || 'none'}`);
      lines.push(`- tables: ${m.tables} (${m.tableCells} cells)`);
      lines.push(`- fonts: median ${m.fontMedianPt ?? '-'}pt over ${m.fontSizesPt.length}`);
      lines.push(`- margins: ${m.margins ? `${m.margins.left}, ${m.margins.right}, ${m.margins.top}, ${m.margins.bottom}` : 'absent'}`);
      lines.push(`- audit: ${m.audit.errors} error(s), ${m.audit.warnings} warning(s)${m.audit.codes.length ? `: ${m.audit.codes.join(', ')}` : ''}`);
      if (m.print) lines.push(`- printed with ${m.print.records} records: ${m.print.pages} page(s), ${m.print.groups} group(s), ${m.print.clipped.length} past the margin`);
      if (r.probe) lines.push(`- DevExpress printed: ${r.probe.error ?? `${r.probe.pages} page(s), margins ${JSON.stringify(r.probe.margins)} (Forma's print: ${r.probe.formaPages ?? '-'})`}`);
      if (r.coverage) {
        const k = r.coverage;
        lines.push(`- kept: ${k.kept} of ${k.captions} captions Forma read${k.captions ? ` (${Math.round((100 * k.kept) / k.captions)}%)` : ''}, ${k.sameBand} in the same band${worthAnotherTry(k) ? ', would ask once more' : ''}${k.missing.length ? `; missing ${k.missing.slice(0, 8).map((s) => JSON.stringify(s)).join(', ')}` : ''}`);
      }
      lines.push(`- usage: ${r.response?.usage ? JSON.stringify(r.response.usage) : 'not reported'}`);
    }
    lines.push('');
    lines.push('| check | result | expected | actual |');
    lines.push('|---|---|---|---|');
    for (const c of r.checks) lines.push(`| ${c.id} | ${c.pass ? 'pass' : 'FAIL'} | ${c.expected} | ${c.actual.replace(/\|/g, '\\|')} |`);
    lines.push('');
  }
  return lines.join('\n');
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const cases = loadCases(opts.cases, opts.only);
  if (cases.length === 0) {
    console.error(`No cases found under ${opts.cases}${opts.only.length ? ` matching ${opts.only.join(', ')}` : ''}.`);
    return 1;
  }

  // The median font size of each .html source, for fontSize.relative.sourcePt (CC-02); writes nothing beside the case.
  if (opts.measureSource) {
    const scratch = opts.out || join(RESULTS_DIR, `measure-${timestamp()}`);
    for (const c of cases) {
      const pt = measureSourceFont(c, scratch);
      console.log(`${pad(c.name, 24)}${pt === null ? 'not an .html source, or Edge could not lay it out' : `${pt}pt median over the page's text`}`);
    }
    return 0;
  }

  let records: RunRecord[] = [];
  let outDir: string;

  if (opts.score.length) {
    // One file against one case, no key and no request (CC-02): the auditor's score.ts as an option.
    outDir = opts.out || join(RESULTS_DIR, `score-${timestamp()}`);
    const all = loadCases(opts.cases, []);
    for (const [name, file] of opts.score) {
      const c = all.find((x) => x.name === name);
      if (!c) throw new Error(`No case named ${name} under ${opts.cases}`);
      const xml = readFileSync(file, 'utf8');
      const record: RunRecord = {
        case: c.name,
        run: records.filter((r) => r.case === c.name).length + 1,
        startedAt: new Date().toISOString(),
        elapsedMs: 0,
        model: basename(file),
        config: withoutKey(configFor(c, '', opts)),
        prompt: c.file.prompt ?? '',
        response: { markdown: '', layout: layoutFromRepx(xml), repxContent: xml },
        error: null,
        measurements: null,
        checks: [],
        log: [],
      };
      score(record, c);
      if (opts.probe) record.probe = probeRecord(c, record, outDir);
      records.push(record);
    }
    console.log('\n' + scorecard(records));
    for (const r of records) {
      console.log(`\n${r.case} <- ${r.model}`);
      for (const check of r.checks) console.log(`  ${check.pass ? 'pass' : 'FAIL'}  ${check.id}  expected ${check.expected}  actual ${check.actual}`);
      if (r.measurements?.print) console.log(`  print: ${r.measurements.print.pages} page(s), ${r.measurements.print.groups} group(s), mapped ${JSON.stringify(r.measurements.print.mapping)}`);
      if (r.probe) console.log(`  DevExpress: ${r.probe.error ?? `${r.probe.pages} page(s), margins ${JSON.stringify(r.probe.margins)}`}`);
    }
    return 0;
  }

  if (opts.replay) {
    // A replay kept under scripts/ is tracked: its summary and coverage go to RESULTS_DIR, not into it.
    const fromScripts = relative(resolve('scripts'), resolve(opts.replay));
    const kept = !fromScripts.startsWith('..') && !isAbsolute(fromScripts);
    outDir = opts.out || (kept ? join(RESULTS_DIR, `replay-${timestamp()}`) : opts.replay);
    const byName = new Map(cases.map((c) => [c.name, c]));
    for (const file of readdirSync(opts.replay).filter((f) => /^run-.*\.json$/.test(f))) {
      const record = JSON.parse(readFileSync(join(opts.replay, file), 'utf8')) as RunRecord;
      const c = byName.get(record.case);
      if (!c) continue;
      // A record kept with its report alone (scripts/fidelity/replay) has its layout read off the file, as the app reads one.
      if (record.response?.repxContent && !record.response.layout) record.response = { ...record.response, layout: layoutFromRepx(record.response.repxContent) };
      score(record, c);
      record.coverage = await coverageFor(c, record);
      if (opts.probe) record.probe = probeRecord(c, record, outDir);
      records.push(record);
    }
    if (records.length === 0) {
      console.error(`Nothing to replay in ${opts.replay} for these cases.`);
      return 1;
    }
    // The house evaluation refines the saved first passes, which does call the model.
    if (opts.house) {
      const key = readKey(opts.keyFromClipboard);
      if (key.length < 20 || /\s/.test(key)) {
        console.error('--house needs a key, even with --replay: the refines are real requests. Nothing was sent.');
        return 1;
      }
      mkdirSync(outDir, { recursive: true });
      await houseEvaluation(records, cases, key, opts, outDir);
    }
  } else {
    // A local writer needs no Gemini key, and is sent none (2026-11-10); nor does Forma's own draft.
    const keyless = Boolean(opts.localModel || opts.forma);
    const key = keyless ? '' : readKey(opts.keyFromClipboard);
    if (!key && !keyless) {
      console.error(
        opts.keyFromClipboard
          ? 'The clipboard is empty or could not be read. Copy your Gemini key and run again.'
          : 'FORMA_BENCH_KEY is not set. Pass your own Gemini key in the environment for this one process, or copy it and pass --key-from-clipboard; it is never written anywhere.',
      );
      return 1;
    }
    if (!keyless && (key.length < 20 || /\s/.test(key))) {
      console.error('That does not look like an API key (too short, or it contains whitespace). Nothing was sent.');
      return 1;
    }
    outDir = opts.out || join(RESULTS_DIR, timestamp());
    mkdirSync(outDir, { recursive: true });
    for (const c of cases) {
      for (let run = 1; run <= opts.runs; run++) {
        console.log(`\n=== ${c.name} run ${run}/${opts.runs} ===`);
        const record = await generate(c, run, key, opts, outDir);
        if (opts.probe) record.probe = probeRecord(c, record, outDir);
        records.push(record);
        writeFileSync(join(outDir, `run-${c.name}-${run}.json`), JSON.stringify(record, null, 2));
        if (record.response?.repxContent) {
          writeFileSync(join(outDir, `${c.name}-${run}.repx`), record.response.repxContent);
        }
        const s = scoreChecks(record.checks);
        console.log(`[${c.name}] ${s.passed}/${s.total} checks passed in ${Math.round(record.elapsedMs / 1000)}s`);
      }
    }
    if (opts.house) await houseEvaluation(records, cases, key, opts, outDir);
  }

  // A .repx case that cannot tell its own untouched source from a fixed report measures nothing (CC-02).
  const selfTests = new Map(cases.flatMap((c) => {
    const failed = selfTestOf(c);
    return failed ? [[c.name, failed] as const] : [];
  }));
  for (const [name, failed] of selfTests) {
    console.log(failed.length ? `[${name}] self-test: the untouched source fails ${failed.map((f) => f.id).join(', ')}` : `[${name}] self-test FAILED: the untouched source passes every check, so this case measures nothing`);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'summary.md'), summaryMarkdown(records, opts, selfTests));
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(records.map((r) => ({
    case: r.case,
    run: r.run,
    model: r.model,
    elapsedMs: r.elapsedMs,
    score: scoreChecks(r.checks),
    failed: r.checks.filter((c) => !c.pass).map((c) => c.id),
    error: r.error,
    coverage: r.coverage ? { captions: r.coverage.captions, kept: r.coverage.kept, sameBand: r.coverage.sameBand, retry: worthAnotherTry(r.coverage) } : null,
  })), null, 2));

  console.log('\n' + scorecard(records));
  console.log(`\nWritten to ${outDir}`);

  const crashed = records.some((r) => r.error);
  const failed = records.some((r) => r.checks.some((c) => !c.pass));
  return crashed || (opts.strict && failed) ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
