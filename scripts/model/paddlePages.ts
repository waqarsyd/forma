/**
 * Read a folder of training pages with PaddleOCR, as the app reads a picture
 * (2026-11-10, the owner's AI accuracy programme, batch AE), so Forma's box
 * reader can be trained on what the app now gives it.
 *
 *   npx tsx scripts/model/paddlePages.ts --dir <folder> [--threads 8] [--models vendor/paddle] [--shard i/n | --merge n]
 *
 * Every page labels.jsonl names in the folder (render.py's or printed.ts's;
 * eval.jsonl where there is none, as in evaluate.ts's held-out pages),
 * training and held out alike, is drawn twice its size when narrower than
 * 1,600 pixels, read with the app's settings (lib/paddleOcr.ts), and kept in
 * `paddle-cache.json` beside it, as the page name to its `OcrPage`, or to null
 * where the page is in a script the English recogniser does not read (the app
 * gives those to Tesseract). Resumable: a page already there is not read
 * again, and the cache is written every 25 pages. `--threads` caps ONNX
 * Runtime's threads, so several folders can be read side by side.
 * `boxes.ts --cache paddle-cache.json` trains on it.
 *
 * The folder must be outside the repository: the pages may come from the
 * company's layouts. Prints counts only.
 *
 * Pure ASCII, as every script here.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { OcrPage } from '../../src/lib/ocr';
import { inItsScript, scaled } from '../../src/lib/paddle';
import { DETECT_LONG_SIDE, RECOGNIZE_MIN_WIDTH, resizeRgb, rgbFromRgba } from '../../src/lib/paddleOcr';
import { paddleReader } from './paddleOcr';

const argv = process.argv.slice(2);
const valueOf = (flag: string) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : undefined);
const dir = valueOf('--dir');
const threads = valueOf('--threads') ? Number(valueOf('--threads')) : undefined;
const models = valueOf('--models') ?? 'vendor/paddle';
/**
 * `--shard i/n`: read only every n-th page from the i-th, into its own
 * `paddle-cache.part<i>.json`, so one folder can be read by n processes;
 * `--merge n` then joins the n parts into `paddle-cache.json`.
 */
const shardArg = valueOf('--shard');
const [shardIndex, shardCount] = shardArg ? shardArg.split('/').map(Number) : [0, 1];
const mergeCount = valueOf('--merge') ? Number(valueOf('--merge')) : 0;
if (!dir) {
  console.error('--dir is required. See the doc comment of scripts/model/paddlePages.ts.');
  process.exit(2);
}
const rel = relative(resolve('.'), resolve(dir));
if (!rel.startsWith('..') && !isAbsolute(rel)) {
  console.error('--dir must be outside the repository.');
  process.exit(2);
}
if (!existsSync(join(models, 'det.onnx'))) {
  console.error(`No PaddleOCR models in ${models}: run npm run fetch:paddle.`);
  process.exit(2);
}

const names = [
  ...new Set(
    readFileSync(join(dir, existsSync(join(dir, 'labels.jsonl')) ? 'labels.jsonl' : 'eval.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => (JSON.parse(l) as { image: string }).image)
      .filter((image) => existsSync(join(dir, image))),
  ),
];
const cachePath = join(dir, shardCount > 1 ? `paddle-cache.part${shardIndex}.json` : 'paddle-cache.json');
if (mergeCount) {
  const merged: Record<string, OcrPage | null> = {};
  for (let i = 0; i < mergeCount; i++) Object.assign(merged, JSON.parse(readFileSync(join(dir, `paddle-cache.part${i}.json`), 'utf8')));
  writeFileSync(join(dir, 'paddle-cache.json'), JSON.stringify(merged));
  console.log(`merged ${mergeCount} parts: ${Object.keys(merged).length} pages in ${join(dir, 'paddle-cache.json')}`);
  process.exit(0);
}
const cache: Record<string, OcrPage | null> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
const save = () => {
  writeFileSync(`${cachePath}.tmp`, JSON.stringify(cache));
  renameSync(`${cachePath}.tmp`, cachePath);
};

const reader = await paddleReader(models, 'rec-en', DETECT_LONG_SIDE, RECOGNIZE_MIN_WIDTH, threads);
const todo = names.filter((n, i) => i % shardCount === shardIndex && !(n in cache));
const started = Date.now();
let done = 0;
for (const name of todo) {
  const picture = await loadImage(readFileSync(join(dir, name)));
  const canvas = createCanvas(picture.width, picture.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, picture.width, picture.height);
  ctx.drawImage(picture, 0, 0);
  const img = rgbFromRgba(ctx.getImageData(0, 0, picture.width, picture.height).data, picture.width, picture.height);
  const scale = img.width < 1600 ? 2 : 1;
  const page = scaled(await reader.read(scale === 2 ? resizeRgb(img, img.width * 2, img.height * 2) : img, null), img, scale);
  cache[name] = inItsScript(page) ? page : null;
  if (++done % 25 === 0) {
    save();
    const each = (Date.now() - started) / done;
    console.log(`${done} of ${todo.length} read, ${(each / 1000).toFixed(1)} s a page, about ${Math.round(((todo.length - done) * each) / 60000)} min left`);
  }
}
save();
const nulls = Object.values(cache).filter((p) => p === null).length;
console.log(`${dir}: ${names.length} pages, ${done} read now, ${nulls} left to Tesseract (another script); in ${cachePath}`);
