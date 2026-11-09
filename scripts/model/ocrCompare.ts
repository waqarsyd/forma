/**
 * Tesseract.js against PaddleOCR on the private real pages (2026-11-10, the
 * owner's AI accuracy programme, batch AC, item 9: "measured beside
 * Tesseract.js on the private real pages; adopted only if it reads better
 * within a budget").
 *
 *   npx tsx scripts/model/ocrCompare.ts --models <dir> --work <dir> [--real-score <dir>] [--pdfs <dir>] [--limit <n>] [--workers 4] [--det-long <n>] [--rec-min <n>]
 *
 * Two sets, both outside the repository, neither ever committed:
 * - `--real-score`: the company's reports printed by DevExpress with made-up
 *   rows (realScore.ts, 2026-11-04). The truth is every text DevExpress
 *   printed on page 1 (render.json); Tesseract's readings are the ones
 *   realScore.ts cached, made as the app reads a picture (ocrPages.ts).
 * - `--pdfs`: the company's own PDFs, each page with a text layer drawn by
 *   pdf.js at 96 dpi (a screenshot) and at 200 dpi (a scan), its text layer the
 *   truth. Tesseract reads them as the app does.
 *
 * PaddleOCR (paddleOcr.ts, models in `--models`) reads each page twice: at its
 * own size, and enlarged twice when narrower than 1,600 pixels as the app
 * enlarges a picture for Tesseract. Every reading is cached in `--work`.
 *
 * Scores, per set and engine: words (multiset match per page, exact and with
 * case and punctuation ignored), recall and precision, and characters (the
 * letters and digits read, as a bag per page, so a space one engine drops
 * between two words does not decide the result). It prints percentages and
 * counts only, never a page's words.
 *
 * Pure ASCII, as every script here.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { OcrPage } from '../../src/lib/ocr';
import { readWithOcr } from './ocrPages';
import { rgbFromRgba } from '../../src/lib/paddleOcr';
import { paddleReader, resizeRgb, type PaddleReader, type Rgb } from './paddleOcr';
import { absolute, type Brick } from './printedTruth';

const argv = process.argv.slice(2);
const valueOf = (flag: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
};
const models = valueOf('--models');
const work = valueOf('--work');
const realScore = valueOf('--real-score');
const pdfs = valueOf('--pdfs');
const limit = Number(valueOf('--limit') ?? Infinity);
const workers = Number(valueOf('--workers') ?? 4);
/** `--det-long <n>`: the detector reads the page no longer than this (the app's setting, lib/paddleWorker.ts); readings are cached apart. */
const detLong = valueOf('--det-long') ? Number(valueOf('--det-long')) : undefined;
/** `--rec-min <n>`: the recogniser's narrowest input, 320 in PaddleOCR (the app's setting, lib/paddleWorker.ts); cached apart. */
const recMin = valueOf('--rec-min') ? Number(valueOf('--rec-min')) : undefined;
if (!models || !work || (!realScore && !pdfs)) {
  console.error('--models, --work and --real-score or --pdfs are required. See the doc comment of scripts/model/ocrCompare.ts.');
  process.exit(2);
}
const inside = (p: string) => {
  const r = relative(resolve('.'), resolve(p));
  return !r.startsWith('..') && !isAbsolute(r);
};
if ([work, realScore, pdfs].some((p) => p && inside(p))) {
  console.error('--work, --real-score and --pdfs must be outside the repository.');
  process.exit(2);
}
mkdirSync(work, { recursive: true });

/** A page to score: its picture and the words it truly holds. */
interface Page {
  name: string;
  png: string;
  truth: string[];
  dpi: number | null;
}

const tokens = (text: string) => text.normalize('NFKC').split(/\s+/).filter(Boolean);
const loose = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** How many of `read` match `truth`, each truth used once. */
function matched(truth: readonly string[], read: readonly string[]): number {
  const left = new Map<string, number>();
  for (const t of truth) left.set(t, (left.get(t) ?? 0) + 1);
  let n = 0;
  for (const r of read) {
    const k = left.get(r) ?? 0;
    if (k > 0) {
      n++;
      left.set(r, k - 1);
    }
  }
  return n;
}

interface Tally {
  pages: number;
  words: number;
  read: number;
  exact: number;
  looseWords: number;
  looseRead: number;
  looseMatched: number;
  chars: number;
  charsRead: number;
  charsMatched: number;
  ms: number;
}
const empty = (): Tally => ({ pages: 0, words: 0, read: 0, exact: 0, looseWords: 0, looseRead: 0, looseMatched: 0, chars: 0, charsRead: 0, charsMatched: 0, ms: 0 });

function score(t: Tally, truth: readonly string[], page: OcrPage) {
  const read = page.lines.flatMap((l) => l.words.flatMap((w) => tokens(w.text)));
  t.pages++;
  t.words += truth.length;
  t.read += read.length;
  t.exact += matched(truth, read);
  const lt = truth.map(loose).filter(Boolean);
  const lr = read.map(loose).filter(Boolean);
  t.looseWords += lt.length;
  t.looseRead += lr.length;
  t.looseMatched += matched(lt, lr);
  const ct = [...lt.join('')];
  const cr = [...lr.join('')];
  t.chars += ct.length;
  t.charsRead += cr.length;
  t.charsMatched += matched(ct, cr);
}

const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1).padStart(5) : '    -');
const f1 = (m: number, truth: number, read: number) => (truth && read ? ((200 * m) / (truth + read)).toFixed(1).padStart(5) : '    -');
function row(set: string, engine: string, t: Tally): string {
  return [
    set.padEnd(14),
    engine.padEnd(18),
    String(t.pages).padStart(5),
    `${pct(t.exact, t.words)} ${pct(t.exact, t.read)} ${f1(t.exact, t.words, t.read)}`,
    `${pct(t.looseMatched, t.looseWords)} ${pct(t.looseMatched, t.looseRead)} ${f1(t.looseMatched, t.looseWords, t.looseRead)}`,
    `${pct(t.charsMatched, t.chars)} ${pct(t.charsMatched, t.charsRead)}`,
    t.ms ? `${Math.round(t.ms / t.pages)}`.padStart(6) : '     -',
  ].join('  ');
}

/** A page picture as RGB, through the canvas pdf.js draws with (sharp stays unloaded: package.json's overrides comment). */
async function rgbOf(png: string): Promise<Rgb> {
  const img = await loadImage(readFileSync(png));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return rgbFromRgba(ctx.getImageData(0, 0, img.width, img.height).data, img.width, img.height);
}

/** PaddleOCR's readings of `pages`, cached in `cachePath`; `enlarge` reads a page narrower than 1,600 pixels at twice its size. */
async function readWithPaddle(reader: PaddleReader, pages: readonly Page[], cachePath: string, enlarge: boolean): Promise<Record<string, { page: OcrPage; ms: number }>> {
  const cache: Record<string, { page: OcrPage; ms: number }> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  let since = 0;
  for (const p of pages) {
    if (cache[p.name]) continue;
    const img = await rgbOf(p.png);
    const scale = enlarge && img.width < 1600 ? 2 : 1;
    const started = Date.now();
    const read = await reader.read(scale === 2 ? resizeRgb(img, img.width * 2, img.height * 2) : img, p.dpi);
    const ms = Date.now() - started;
    if (scale === 2) {
      const half = (b: { x0: number; y0: number; x1: number; y1: number }) => ({ x0: b.x0 / 2, y0: b.y0 / 2, x1: b.x1 / 2, y1: b.y1 / 2 });
      read.width = img.width;
      read.height = img.height;
      read.lines = read.lines.map((l) => ({ ...l, box: half(l.box), words: l.words.map((w) => ({ ...w, box: half(w.box) })) }));
    }
    cache[p.name] = { page: read, ms };
    if (++since >= 10) {
      writeFileSync(cachePath, JSON.stringify(cache));
      since = 0;
    }
  }
  writeFileSync(cachePath, JSON.stringify(cache));
  return cache;
}

/** The real-score set: page 1 of each case, its truth the texts DevExpress printed. */
function realScorePages(dir: string): Page[] {
  const pages: Page[] = [];
  for (const name of readdirSync(dir).sort()) {
    const caseDir = join(dir, name);
    if (!existsSync(join(caseDir, 'report.png')) || !existsSync(join(caseDir, 'render.json'))) continue;
    const render = JSON.parse(readFileSync(join(caseDir, 'render.json'), 'utf8')) as { pages: { bricks: Brick[] }[] };
    const bricks = render.pages[0] ? absolute(render.pages[0].bricks) : [];
    const truth = bricks.flatMap((b) => (b.text?.trim() ? tokens(b.text) : []));
    if (!truth.length) continue;
    pages.push({ name: `${name}.png`, png: join(caseDir, 'report.png'), truth, dpi: 96 });
    if (pages.length >= limit) break;
  }
  return pages;
}

/** The PDF set: every page with a text layer, drawn at 96 and 200 dpi. */
async function pdfPages(dir: string, out: string): Promise<Page[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  mkdirSync(out, { recursive: true });
  const truthPath = join(out, 'truth.json');
  const truths: Record<string, string[]> = existsSync(truthPath) ? JSON.parse(readFileSync(truthPath, 'utf8')) : {};
  const pages: Page[] = [];
  for (const file of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort()) {
    const doc = await getDocument({ data: new Uint8Array(readFileSync(join(dir, file))), verbosity: 0 }).promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const truth = content.items.flatMap((i) => ('str' in i ? tokens(i.str) : []));
      if (truth.length < 5) continue;
      for (const dpi of [96, 200]) {
        const name = `${file.replace(/\.pdf$/i, '')}-p${n}-${dpi}.png`;
        const png = join(out, name);
        if (!existsSync(png)) {
          const viewport = page.getViewport({ scale: dpi / 72 });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
          writeFileSync(png, canvas.toBuffer('image/png'));
        }
        truths[name] = truth;
        pages.push({ name, png, truth, dpi });
      }
      if (pages.length >= 2 * limit) break;
    }
  }
  writeFileSync(truthPath, JSON.stringify(truths));
  return pages;
}

const reader = await paddleReader(models, 'rec-en', detLong, recMin);
const lines: string[] = [];
const header = `${'set'.padEnd(14)}  ${'engine'.padEnd(18)}  pages  words: recall prec   F1  loose: recall prec   F1  chars: recall prec  ms/page`;
const results: Record<string, Tally> = {};

async function compare(set: string, pages: Page[], tesseract: Record<string, OcrPage>) {
  const t = empty();
  for (const p of pages) if (tesseract[p.name]) score(t, p.truth, tesseract[p.name]);
  results[`${set} tesseract`] = t;
  lines.push(row(set, 'Tesseract (app)', t));
  for (const [variant, enlarge] of [['PaddleOCR', false], ['PaddleOCR x2', true]] as const) {
    const cache = await readWithPaddle(reader, pages, join(work!, `paddle-${set}-${enlarge ? 'x2' : 'native'}${detLong ? `-det${detLong}` : ''}${recMin ? `-rec${recMin}` : ''}.json`), enlarge);
    const pt = empty();
    for (const p of pages) {
      const c = cache[p.name];
      if (!c || !tesseract[p.name]) continue;
      score(pt, p.truth, c.page);
      pt.ms += c.ms;
    }
    results[`${set} ${variant}`] = pt;
    lines.push(row(set, variant, pt));
  }
}

if (realScore) {
  const pages = realScorePages(realScore);
  const cache = JSON.parse(readFileSync(join(realScore, 'ocr-cache.json'), 'utf8')) as Record<string, OcrPage>;
  await compare('real-score', pages, cache);
}
if (pdfs) {
  const out = join(work, 'pdf-pages');
  const pages = await pdfPages(pdfs, out);
  for (const dpi of [96, 200]) {
    const these = pages.filter((p) => p.dpi === dpi);
    const tesseract = await readWithOcr(out, these.map((p) => p.name), join(work, 'pdf-tesseract.json'), workers, false);
    await compare(`pdf ${dpi} dpi`, these, tesseract);
  }
}

console.log(header);
for (const l of lines) console.log(l);
writeFileSync(join(work, 'compare.json'), JSON.stringify({ date: new Date().toISOString().slice(0, 10), results }, null, 2));
console.log(`Written to ${join(work, 'compare.json')}`);
