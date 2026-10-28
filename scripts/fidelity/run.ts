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
import { analyzeReportDesign, type ReportConfig } from '../../src/services/geminiService';
import type { AnalysisResponse, AttachmentPart } from '../../src/lib/reportTypes';
import { readCachedModel } from '../../src/lib/modelCache';
import {
  checkFidelity,
  measureReport,
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

async function generate(c: LoadedCase, run: number, key: string, opts: ReturnType<typeof parseArgs>): Promise<RunRecord> {
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
    record.response = await capturingConsole(record.log, () => analyzeReportDesign(prompt, parts, config));
  } catch (error: any) {
    record.error = error?.message ?? String(error);
  }
  record.elapsedMs = Date.now() - startedAt.getTime();
  record.model = readCachedModel();
  score(record, c.file.expect);
  return record;
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
      records.push(record);
    }
    if (records.length === 0) {
      console.error(`Nothing to replay in ${opts.replay} for these cases.`);
      return 1;
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
        const record = await generate(c, run, key, opts);
        records.push(record);
        writeFileSync(join(outDir, `run-${c.name}-${run}.json`), JSON.stringify(record, null, 2));
        if (record.response?.repxContent) {
          writeFileSync(join(outDir, `${c.name}-${run}.repx`), record.response.repxContent);
        }
        const s = scoreChecks(record.checks);
        console.log(`[${c.name}] ${s.passed}/${s.total} checks passed in ${Math.round(record.elapsedMs / 1000)}s`);
      }
    }
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
