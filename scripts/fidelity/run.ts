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
 *   --out <dir>       where results go (default fidelity-results/<timestamp>)
 *   --replay <dir>    re-score the saved outputs in that results directory
 *                     against the CURRENT case files, calling nothing
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
 *   --brief           send Forma's box reader's brief with each picture, as
 *                     the app has since 2026-11-04 (readerBriefFor, below)
 *   --draft           ask the AI to correct Forma's draft of each picture and
 *                     build the report from it, as the app has since
 *                     2026-11-05 (lib/draftText.ts)
 *
 * What it measures and why is the doc comment of src/lib/fidelity.ts. This file
 * is the part that cannot live in the suite: it spends the owner's quota, takes
 * a minute or more per case, and needs a key, so it is run by hand before a
 * prompt or model change and the scorecard is quoted in the commit message --
 * the same way check:size records a budget.
 *
 * It calls the real `analyzeReportDesign` with the arguments App.tsx passes for
 * a first generation, so every repair pass and the audit run exactly as they do
 * in the product. Two differences from the browser are deliberate and recorded
 * here rather than papered over: the key arrives from the environment because
 * there is no Settings dialog, and an image is sent as-is because the browser's
 * MAX_IMAGE_EDGE downscale uses a canvas Node does not have. The runner reads
 * the PNG header and warns when the long edge exceeds that limit, so a case
 * whose source is too large is a known difference rather than a silent one.
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
 * The key never touches disk. It is read from FORMA_BENCH_KEY, passed as
 * `config.customApiKey` the way the Settings dialog would, and the results
 * written out carry the config with that field removed. Do not add a .env
 * fallback: CLAUDE.md's rule that .env holds no Gemini key is the correction
 * to a real leak.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyzeReportDesign, type DraftRequest, type ReportConfig } from '../../src/services/geminiService';
import type { AnalysisResponse, AttachmentPart, ReportLayout } from '../../src/lib/reportTypes';
import { readCachedModel } from '../../src/lib/modelCache';
import { importReports, retrieveHouseStyle } from '../../src/services/library';
import { embedEntries, embedTexts } from '../../src/services/embeddings';
import type { LibraryEntry } from '../../src/lib/embedStore';
import { readsTheseFeatures, type BoxReaderModel } from '../../src/lib/boxReader';
import { buildWithReader, sourceLayoutOf } from '../../src/lib/ocrAttach';
import { draftBrief } from '../../src/lib/formaTeam';
import { draftToText } from '../../src/lib/draftText';
import { readWithOcr } from '../model/ocrPages';
import { readPictureAsTheApp } from '../model/paddleOcr';
import { captionsOfDraft, readCoverage, worthAnotherTry, type ReadCoverage } from '../../src/lib/readCoverage';
import { readDatabaseText } from '../../src/lib/sqlSchema';
import { designSection, writeFromAnswer } from '../../src/lib/databaseAi';
import {
  checkFidelity,
  measureReport,
  median,
  scoreChecks,
  type FidelityCheck,
  type FidelityExpectations,
  type FidelityMeasurements,
} from '../../src/lib/fidelity';

/** The browser downsizes anything longer than this on its long edge (App.tsx). */
const MAX_IMAGE_EDGE = 2048;

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
  expect: FidelityExpectations;
  notes?: string;
}

interface LoadedCase {
  name: string;
  dir: string;
  file: CaseFile;
}

interface RunRecord {
  case: string;
  run: number;
  startedAt: string;
  elapsedMs: number;
  model: string | null;
  config: Omit<ReportConfig, 'customApiKey'>;
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
  /**
   * Everything the service wrote to the console during this run. The pipeline
   * explains itself there and nowhere else -- which model it chose, why a
   * margin lift declined, the finishReason and the last 120 characters of a
   * response it could not parse -- and the first baseline lost all of it: two
   * runs failed on output limits and the only record was the one-line error.
   */
  log: string[];
}

/** Run `fn` with the console captured into `lines`, still echoed to the real one. */
async function capturingConsole<T>(lines: string[], fn: () => Promise<T>): Promise<T> {
  const methods = ['log', 'warn', 'error', 'debug', 'info'] as const;
  const original = Object.fromEntries(methods.map((m) => [m, console[m]])) as Record<(typeof methods)[number], (...args: unknown[]) => void>;
  for (const m of methods) {
    console[m] = (...args: unknown[]) => {
      lines.push(`[${m}] ${args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a))).join(' ')}`);
      original[m](...args);
    };
  }
  try {
    return await fn();
  } finally {
    for (const m of methods) console[m] = original[m];
  }
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
    cases.push({ name: entry, dir, file });
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

/** Width and height from a PNG's IHDR chunk, or null for anything else. */
function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  const signature = '89504e470d0a1a0a';
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== signature) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function attachmentFor(c: LoadedCase, rerender: boolean): AttachmentPart[] {
  let sourcePath = join(c.dir, c.file.source);
  const ext = extname(sourcePath).toLowerCase();

  if (ext === '.html') {
    const png = sourcePath.replace(/\.html$/i, '.png');
    if (rerender || !existsSync(png)) {
      console.log(`[${c.name}] rendering ${basename(sourcePath)} -> ${basename(png)}`);
      renderHtml(sourcePath, png, c.file.render);
    }
    sourcePath = png;
  }

  const sourceExt = extname(sourcePath).toLowerCase();
  if (sourceExt === '.repx') {
    return [{ text: readFileSync(sourcePath, 'utf8') }];
  }
  const mimeType = MIME[sourceExt];
  if (!mimeType) throw new Error(`${sourcePath}: unsupported source type ${sourceExt}`);
  const bytes = readFileSync(sourcePath);
  const dims = pngDimensions(bytes);
  if (dims && Math.max(dims.width, dims.height) > MAX_IMAGE_EDGE) {
    console.warn(
      `[${c.name}] ${basename(sourcePath)} is ${dims.width}x${dims.height}; the browser would downscale it to ${MAX_IMAGE_EDGE} on the long edge and this runner does not.`,
    );
  }
  return [{ inlineData: { data: bytes.toString('base64'), mimeType } }];
}

/**
 * Forma's box reader's brief for a picture, as App.tsx's prepareTeam passes it
 * with every upload since 2026-11-04 (`--brief`): the page read by OCR as the
 * app reads it (scripts/model/ocrPages.ts), the box reader run over that
 * reading, and `draftBrief` of what it built. '' when the case is not a PNG or
 * the reader declines the page, which the product would answer the same way.
 * The OCR works in the results folder, so no case directory gains files.
 */
async function readerBriefFor(c: LoadedCase, unit: string, paper: string, outDir: string): Promise<{ brief: string; evidence: ReportLayout | null; draft: DraftRequest | null }> {
  let source = join(c.dir, c.file.source);
  if (extname(source).toLowerCase() === '.html') source = source.replace(/\.html$/i, '.png');
  if (extname(source).toLowerCase() !== '.png' || !existsSync(source)) return { brief: '', evidence: null, draft: null };
  const work = join(outDir, 'ocr');
  mkdirSync(work, { recursive: true });
  const name = `${c.name}.png`;
  writeFileSync(join(work, name), readFileSync(source));
  // As the app reads a picture since 2026-11-10: PaddleOCR when the models are
  // fetched and the page is in its script, Tesseract otherwise.
  const ocr = (await readPictureAsTheApp(join(work, name), join(work, 'paddle.json'))) ?? (await readWithOcr(work, [name], join(work, 'ocr.json'), 1, false))[name];
  const model = JSON.parse(readFileSync('assets/model/boxReader.json', 'utf8')) as BoxReaderModel;
  if (!readsTheseFeatures(model)) throw new Error('assets/model/boxReader.json is not one this version reads.');
  const pages = [{ meta: { uploadId: c.name, file: name }, read: { ocr, flagged: 0, lines: ocr.lines.length } }];
  const built = buildWithReader(pages, model, paper);
  // OCR's own layout is the audit's evidence, as prepareTeam passes it (2026-11-05).
  const evidence = sourceLayoutOf(pages, unit, paper);
  // Forma's draft for the AI to correct, as prepareTeam writes it (--draft, 2026-11-05).
  const draft = built ? { text: draftToText(built.skeleton, built.used), texts: built.texts, title: built.title, readBy: "Forma's box reader, corrected by the AI" } : null;
  return { brief: built ? draftBrief(built.skeleton, built.layout, unit, 'reader') : '', evidence, draft };
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
  if (opts.thinking !== undefined && Number.isFinite(opts.thinking)) config.thinkingBudget = opts.thinking;
  return config;
}

function withoutKey(config: ReportConfig): Omit<ReportConfig, 'customApiKey'> {
  const { customApiKey: _dropped, ...rest } = config;
  return rest;
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
    config: withoutKey(config),
    prompt,
    response: null,
    error: null,
    measurements: null,
    checks: [],
    log: [],
  };
  try {
    const parts = attachmentFor(c, opts.rerender && run === 1);
    const team = opts.brief || opts.draft ? await readerBriefFor(c, config.unit ?? 'HundredthsOfAnInch', config.pageSize ?? 'Letter', outDir) : { brief: '', evidence: null, draft: null };
    const { brief: formaBrief, evidence } = team;
    const draft = opts.draft ? team.draft : null;
    if (opts.draft) console.log(`[${c.name}] Forma's draft: ${draft ? `${draft.text.split('\n').length} lines, ${draft.text.length} characters` : 'none (not a PNG, or the reader declined the page)'}`);
    if (opts.brief) console.log(`[${c.name}] box reader brief: ${formaBrief ? `${formaBrief.split('\n').length} lines` : 'none (not a PNG, or the reader declined the page)'}`);
    // The case's database, shared as the app shares an attached one (2026-11-09).
    const schema = c.file.database ? readDatabaseText(readFileSync(join(c.dir, c.file.database), 'utf8'), basename(c.file.database).replace(/\.[^.]+$/, '')) : null;
    const layout = schema?.kind === 'schema' ? schema.schema : null;
    const database = layout ? designSection(layout, { words: [prompt, formaBrief].join('\n') }) : undefined;
    record.response = await capturingConsole(record.log, () =>
      analyzeReportDesign(prompt, parts, config, undefined, undefined, undefined, formaBrief || draft || database ? { formaBrief, evidence, draft, database } : undefined),
    );
    if (layout && record.response?.repxContent) {
      const out = writeFromAnswer(record.response.repxContent, layout, { dataQuery: record.response.dataQuery, version: config.version });
      record.log.push(`[runner] database: ${out.note}`);
      if (out.query) record.response = { ...record.response, repxContent: out.xml };
    }
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
  score(record, c.file.expect);
  record.coverage = await coverageFor(c, record, outDir);
  return record;
}

/** What the report kept of the captions and titles Forma read on the case's page (`readCoverage`). */
async function coverageFor(c: LoadedCase, record: RunRecord, outDir: string): Promise<ReadCoverage | null> {
  if (!record.response?.repxContent) return null;
  const team = await readerBriefFor(c, record.config.unit ?? 'HundredthsOfAnInch', record.config.pageSize ?? 'Letter', outDir);
  return team.draft ? readCoverage(captionsOfDraft(team.draft.text), record.response.repxContent) : null;
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

function score(record: RunRecord, expect: FidelityExpectations): void {
  if (!record.response) {
    record.measurements = null;
    record.checks = [{ id: 'generated', pass: false, expected: 'a response', actual: record.error ?? 'none' }];
    return;
  }
  record.measurements = measureReport(record.response.repxContent, record.response.layout);
  record.checks = checkFidelity(record.measurements, expect);
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

function summaryMarkdown(records: RunRecord[], opts: ReturnType<typeof parseArgs>): string {
  const lines: string[] = [];
  lines.push(`# Fidelity benchmark, ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Cases from \`${opts.cases}\`${opts.replay ? `, re-scored from \`${opts.replay}\`` : ''}.`);
  lines.push('');
  lines.push('```');
  lines.push(scorecard(records));
  lines.push('```');
  lines.push('');
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

  let records: RunRecord[] = [];
  let outDir: string;

  if (opts.replay) {
    outDir = opts.out || opts.replay;
    const byName = new Map(cases.map((c) => [c.name, c]));
    for (const file of readdirSync(opts.replay).filter((f) => /^run-.*\.json$/.test(f))) {
      const record = JSON.parse(readFileSync(join(opts.replay, file), 'utf8')) as RunRecord;
      const c = byName.get(record.case);
      if (!c) continue;
      score(record, c.file.expect);
      record.coverage = await coverageFor(c, record, outDir);
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
    const key = readKey(opts.keyFromClipboard);
    if (!key) {
      console.error(
        opts.keyFromClipboard
          ? 'The clipboard is empty or could not be read. Copy your Gemini key and run again.'
          : 'FORMA_BENCH_KEY is not set. Pass your own Gemini key in the environment for this one process, or copy it and pass --key-from-clipboard; it is never written anywhere.',
      );
      return 1;
    }
    if (key.length < 20 || /\s/.test(key)) {
      console.error('That does not look like an API key (too short, or it contains whitespace). Nothing was sent.');
      return 1;
    }
    outDir = opts.out || join('fidelity-results', timestamp());
    mkdirSync(outDir, { recursive: true });
    for (const c of cases) {
      for (let run = 1; run <= opts.runs; run++) {
        console.log(`\n=== ${c.name} run ${run}/${opts.runs} ===`);
        const record = await generate(c, run, key, opts, outDir);
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

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'summary.md'), summaryMarkdown(records, opts));
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
