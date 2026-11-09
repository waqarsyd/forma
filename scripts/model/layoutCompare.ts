/**
 * Whether a layout detector knows a report's bands (2026-11-10, the owner's AI
 * accuracy programme, batch AC, item 10: "a layout detector (regions: title,
 * table, header, footer, figure) measured the same way; adopted only if it
 * improves the box reader's bands").
 *
 *   npx tsx scripts/model/layoutCompare.ts --model <layout-s.onnx> --real-score <dir> [--limit <n>] [--threshold 0.5]
 *
 * The detector is PP-DocLayout-S (PicoDet, 23 classes, Apache-2.0), in the ONNX
 * export of stefanj0/PP-DocLayout-S-ONNX on Hugging Face, whose preprocessing
 * matches PaddlePaddle's own inference.yml: RGB, 480 x 480 without keeping the
 * ratio, ImageNet's mean and deviation, and the boxes back in the page's
 * pixels through `scale_factor`.
 *
 * The pages are realScore.ts's (the company's reports printed by DevExpress
 * with made-up rows, outside the repository). Each printed text takes the
 * class of the smallest region holding its centre, and the tally is that
 * class against the text's true band, so a class that marks a band well shows
 * as a column concentrated in one row. Compare each band's row with the box
 * reader's accuracy on that band (realScore.ts's result): the detector can
 * help only where it is both precise and the reader is weak.
 *
 * Prints counts and percentages only, never a page's words.
 *
 * Pure ASCII, as every script here.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import * as ort from 'onnxruntime-node';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { resizeRgb, rgbFromRgba, type Rgb } from '../../src/lib/paddleOcr';
import { absolute, truthOf, type Brick } from './printedTruth';

const argv = process.argv.slice(2);
const valueOf = (flag: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
};
const modelPath = valueOf('--model');
const realScore = valueOf('--real-score');
const limit = Number(valueOf('--limit') ?? Infinity);
const threshold = Number(valueOf('--threshold') ?? 0.5);
if (!modelPath || !realScore) {
  console.error('--model and --real-score are required. See the doc comment of scripts/model/layoutCompare.ts.');
  process.exit(2);
}
const rel = relative(resolve('.'), resolve(realScore));
if (!rel.startsWith('..') && !isAbsolute(rel)) {
  console.error('--real-score must be outside the repository.');
  process.exit(2);
}

/** PP-DocLayout's classes, in the order of its inference.yml. */
const CLASSES = ['paragraph_title', 'image', 'text', 'number', 'abstract', 'content', 'figure_title', 'formula', 'table', 'table_title', 'reference', 'doc_title', 'footnote', 'header', 'algorithm', 'footer', 'seal', 'chart_title', 'chart', 'formula_number', 'header_image', 'footer_image', 'aside_text'];
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

const session = await ort.InferenceSession.create(resolve(modelPath), { logSeverityLevel: 3 });

interface Region {
  cls: string;
  score: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

async function regionsOf(png: string): Promise<{ regions: Region[]; width: number; height: number; ms: number }> {
  const picture = await loadImage(readFileSync(png));
  const canvas = createCanvas(picture.width, picture.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(picture, 0, 0);
  const img: Rgb = rgbFromRgba(ctx.getImageData(0, 0, picture.width, picture.height).data, picture.width, picture.height);
  const small = resizeRgb(img, 480, 480);
  const plane = 480 * 480;
  const input = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) for (let c = 0; c < 3; c++) input[c * plane + p] = (small.data[p * 3 + c] / 255 - MEAN[c]) / STD[c];
  const started = Date.now();
  const out = await session.run({
    image: new ort.Tensor('float32', input, [1, 3, 480, 480]),
    scale_factor: new ort.Tensor('float32', new Float32Array([480 / img.height, 480 / img.width]), [1, 2]),
  });
  const ms = Date.now() - started;
  const [detsName, countName] = session.outputNames;
  const dets = out[detsName];
  const count = Number(out[countName].data[0]);
  const rows = dets.data as Float32Array;
  const regions: Region[] = [];
  for (let i = 0; i < count; i++) {
    const [cls, score, x0, y0, x1, y1] = rows.subarray(i * 6, i * 6 + 6);
    if (score >= threshold) regions.push({ cls: CLASSES[cls] ?? `class ${cls}`, score, x0, y0, x1, y1 });
  }
  return { regions, width: img.width, height: img.height, ms };
}

const confusion = new Map<string, Map<string, number>>();
const bandTotals = new Map<string, number>();
const classTotals = new Map<string, number>();
let pages = 0;
let texts = 0;
let ms = 0;
for (const name of readdirSync(realScore).sort()) {
  const dir = join(realScore, name);
  if (!existsSync(join(dir, 'report.png')) || !existsSync(join(dir, 'render.json')) || !existsSync(join(dir, 'report.repx'))) continue;
  if (pages >= limit) break;
  const truth = truthOf(readFileSync(join(dir, 'report.repx'), 'utf8')).names;
  const render = JSON.parse(readFileSync(join(dir, 'render.json'), 'utf8')) as { pages: { bricks: Brick[] }[] };
  if (!render.pages[0]) continue;
  const { regions, ms: took } = await regionsOf(join(dir, 'report.png'));
  pages++;
  ms += took;
  // Bricks are in 1/300 inch; the page was printed at 96 dpi.
  const k = 96 / 300;
  for (const b of absolute(render.pages[0].bricks)) {
    if (!b.text?.trim() || !b.owner) continue;
    const t = truth.get(b.owner);
    if (!t || t.role === 'decoration') continue;
    const cx = (b.r[0] + b.r[2] / 2) * k;
    const cy = (b.r[1] + b.r[3] / 2) * k;
    const holding = regions.filter((r) => cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1);
    holding.sort((a, c) => (a.x1 - a.x0) * (a.y1 - a.y0) - (c.x1 - c.x0) * (c.y1 - c.y0));
    const cls = holding[0]?.cls ?? '(none)';
    texts++;
    const row = confusion.get(t.band) ?? new Map<string, number>();
    row.set(cls, (row.get(cls) ?? 0) + 1);
    confusion.set(t.band, row);
    bandTotals.set(t.band, (bandTotals.get(t.band) ?? 0) + 1);
    classTotals.set(cls, (classTotals.get(cls) ?? 0) + 1);
  }
}

const columns = [...classTotals].sort((a, b) => b[1] - a[1]).map(([c]) => c);
console.log(`PP-DocLayout-S over ${pages} printed pages, ${texts} printed texts, ${Math.round(ms / Math.max(1, pages))} ms a page (score >= ${threshold}).`);
console.log('Share of each band\'s texts by the region class holding them:');
console.log(['band'.padEnd(13), 'texts'.padStart(6), ...columns.map((c) => c.slice(0, 9).padStart(10))].join(''));
for (const [band, n] of [...bandTotals].sort((a, b) => b[1] - a[1])) {
  const row = confusion.get(band)!;
  console.log([band.padEnd(13), String(n).padStart(6), ...columns.map((c) => `${(((row.get(c) ?? 0) * 100) / n).toFixed(1)}`.padStart(10))].join(''));
}
console.log('Precision of each class for the band most of its texts are in:');
for (const c of columns) {
  let best = '';
  let most = 0;
  for (const [band, row] of confusion) {
    const v = row.get(c) ?? 0;
    if (v > most) {
      most = v;
      best = band;
    }
  }
  const n = classTotals.get(c)!;
  console.log(`  ${c.padEnd(16)} ${String(n).padStart(6)} texts, ${((most * 100) / n).toFixed(1)}% ${best}`);
}
