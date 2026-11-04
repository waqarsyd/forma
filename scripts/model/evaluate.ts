/**
 * Score Forma's vision model on the pages it was not trained on (2026-11-03,
 * milestone 6 of docs/proposals/own-model.md), and set it beside OCR.
 *
 *   npx tsx scripts/model/evaluate.ts <predictions.jsonl> [--pages <dir>]
 *   npx tsx scripts/model/evaluate.ts --pages <dir>
 *
 * The predictions are what scripts/model/kaggle/train_vision.py writes to its
 * output: one held-out page per line, with the right skeleton text
 * (`target`) and the model's (`prediction`). Each is read with
 * textToSkeleton and the pair scored with scoreSkeleton
 * (src/lib/skeletonText.ts), band by band.
 *
 * --pages  a folder of the same held-out pages drawn here, with
 *   `python scripts/model/render.py <dir> --variants 1` over an examples.jsonl
 *   that holds only the held-out rows. Then each page is also read by OCR
 *   the way the app reads an attached image: enlarged twice when it is
 *   narrower than 1,600 pixels, Tesseract with the app's own language data,
 *   then `ocrPageFrom` and `detectLayout`. Today's path for a picture, the
 *   OCR build, is that reading. Both readings, and the vision model's when
 *   predictions are given, are scored on the page (`fixedPlaces` and
 *   `scorePlaces`). Only the bands at fixed places (margins, report and page
 *   headers, page footer) are compared, since the Detail band repeats a
 *   random number of times on a drawn page. OCR runs once per page, and
 *   ocr-cache.json in the folder keeps the readings for the next run.
 *
 * --ocr-prompts <file>  with --pages, also writes each page's question in
 *   the boxes design (src/lib/boxText.ts) with OCR's boxes: the places the
 *   OCR reading at known scale found, in reading order. train_vision.py
 *   --boxes asks the model those when the file is in its dataset, so the
 *   held-out pages are scored as Forma will ask them, not only with the
 *   exact boxes the drawing recorded. Each row keeps the page's skeleton
 *   as `truth`; it has no right answer of its own, so `target` is empty.
 *
 * Both skeleton texts are structure only, and a drawn page holds only
 * placeholder words, so nothing printed here is a report's words. A
 * question holds only numbers.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixedPlaces, scorePlaces, scoreSkeleton, textToSkeleton, type PagePlace, type PageScore } from '../../src/lib/skeletonText';
import type { OcrPage } from '../../src/lib/ocr';
import { readWithOcr } from './ocrPages';
import { detectLayout } from '../../src/lib/ocrLayout';
import { pageForImage } from '../../src/lib/reportGeometry';
import { boxPrompt, orderBoxes } from '../../src/lib/boxText';

const argv = process.argv.slice(2);
const valueOf = (flag: string) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : undefined);
const pagesDir = valueOf('--pages');
const ocrPromptsFile = valueOf('--ocr-prompts');
const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--pages' && argv[i - 1] !== '--ocr-prompts');
if (!file && !pagesDir) {
  console.error('Usage: npx tsx scripts/model/evaluate.ts <predictions.jsonl> [--pages <dir>], or --pages <dir> alone.');
  process.exit(2);
}

interface Row {
  id: string;
  image: string;
  target: string;
  prediction: string;
}
const readJsonl = <T>(path: string): T[] =>
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
const rows: Row[] = file ? readJsonl<Row>(file) : [];

if (rows.length) {
  const lines = (t: string) => t.split(/\r?\n/).filter((l) => l.trim()).length;
  let parsed = 0;
  let paper = 0;
  let skipped = 0;
  const bands = { predicted: 0, expected: 0, matched: 0 };
  const controls = { predicted: 0, expected: 0, matched: 0, kind: 0, role: 0 };
  const perPage: string[] = [];
  for (const r of rows) {
    const expected = textToSkeleton(r.target).skeleton;
    if (!expected) continue;
    const reading = textToSkeleton(r.prediction);
    const s = scoreSkeleton(reading.skeleton, expected);
    if (s.parsed) parsed++;
    if (s.paper) paper++;
    skipped += reading.problems.length;
    for (const k of ['predicted', 'expected', 'matched'] as const) bands[k] += s.bands[k];
    for (const k of ['predicted', 'expected', 'matched', 'kind', 'role'] as const) controls[k] += s.controls[k];
    perPage.push(
      `${r.image.padEnd(14)} lines ${String(lines(r.prediction)).padStart(4)} of ${String(lines(r.target)).padEnd(4)} ` +
        `bands ${s.bands.matched}/${s.bands.expected} (wrote ${s.bands.predicted})  ` +
        `controls found ${s.controls.matched}/${s.controls.expected} (wrote ${s.controls.predicted})${s.paper ? '' : '  paper wrong'}${s.parsed ? '' : '  NO PAGE LINE'}`,
    );
  }
  const precision = controls.predicted ? controls.matched / controls.predicted : 0;
  const recall = controls.expected ? controls.matched / controls.expected : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  console.log(`pages scored: ${perPage.length}`);
  console.log(`answers with a page line: ${pct(parsed, perPage.length)}; paper and orientation right: ${pct(paper, perPage.length)}`);
  console.log(`lines of an answer that could not be read: ${skipped}`);
  console.log(`bands: ${pct(bands.matched, bands.expected)} of the right ones found, ${pct(bands.matched, bands.predicted)} of those written were right`);
  console.log(
    `controls (paired at half overlap within a band): recall ${pct(controls.matched, controls.expected)}, precision ${pct(controls.matched, controls.predicted)}, F1 ${(f1 * 100).toFixed(1)}%`,
  );
  console.log(`of the controls found, right kind ${pct(controls.kind, controls.matched)}, right role ${pct(controls.role, controls.matched)}`);
  console.log('');
  for (const line of perPage) console.log(line);
}

if (pagesDir) await comparePages(resolve(pagesDir));

async function comparePages(dir: string) {
  const pages = readJsonl<{ image: string; id: string; target: string }>(join(dir, 'eval.jsonl'));
  const cache = await readWithOcr(
    dir,
    pages.map((p) => p.image),
    join(dir, 'ocr-cache.json'),
  );

  const predictions = new Map(rows.map((r) => [r.image, r.prediction]));
  // The app reads a screenshot on the configured paper, which is Letter until someone changes it.
  const systems = ['OCR, scale known (100 dpi)', 'OCR, screenshot, paper Letter (default)', ...(predictions.size ? ["Forma's vision model"] : [])];
  // Totals for every page, and for version 2's pages alone (the first set's ids, r12), which every later version is also scored on.
  const zero = () => systems.map(() => ({ expected: 0, predicted: 0, matched: 0, found: 0 }));
  const totals = zero();
  const firstSet = zero();
  const perPage: string[] = [];
  let firstSetPages = 0;
  const add = (i: number, s: PageScore, first: boolean) => {
    for (const k of ['expected', 'predicted', 'matched', 'found'] as const) {
      totals[i][k] += s[k];
      if (first) firstSet[i][k] += s[k];
    }
  };
  const ocrPlaces = (ocr: OcrPage, dpi: number | null, paper: string): PagePlace[] => {
    const read = { ...ocr, dpi };
    const page = detectLayout([{ ocr: read, page: pageForImage(read, 'HundredthsOfAnInch', paper) }], { unit: 'HundredthsOfAnInch' }).pages[0];
    const cells = page.tables.flatMap((t) => t.rows.flatMap((r) => r.cells.filter((c): c is NonNullable<typeof c> => !!c)));
    return [...page.labels, ...cells].map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h, text: true }));
  };
  const questions: string[] = [];
  for (const p of pages) {
    const expected = textToSkeleton(p.target).skeleton;
    if (!expected) continue;
    const truth = fixedPlaces(expected);
    const paper = expected.paper === 'Custom' ? 'Letter' : expected.paper;
    const read = ocrPlaces(cache[p.image], 100, paper);
    if (ocrPromptsFile) questions.push(JSON.stringify({ id: p.id, image: p.image, target: '', truth: p.target, prompt: boxPrompt(orderBoxes(read)) }));
    const scores = [scorePlaces(read, truth.places, truth.regions), scorePlaces(ocrPlaces(cache[p.image], null, 'Letter'), truth.places, truth.regions)];
    if (predictions.size) {
      const k = textToSkeleton(predictions.get(p.image) ?? '').skeleton;
      scores.push(scorePlaces(k ? fixedPlaces(k).places : [], truth.places, truth.regions));
    }
    const first = /^r\d+-/.test(p.image);
    if (first) firstSetPages++;
    scores.forEach((s, i) => add(i, s, first));
    perPage.push(`${p.image.padEnd(14)} text places ${String(scores[0].expected).padStart(3)}: ` + scores.map((s) => `found ${s.found} boxed ${s.matched} (read ${s.predicted})`).join(' | '));
  }
  const summary = (label: string, sums: ReturnType<typeof zero>, n: number) => {
    console.log('');
    console.log(`On the page, at the fixed bands only, ${label} (${n} pages):`);
    systems.forEach((name, i) => {
      const t = sums[i];
      console.log(
        `${name.padEnd(36)} text found where it prints ${pct(t.found, t.expected)}; box right (half overlap) recall ${pct(t.matched, t.expected)}, precision ${pct(t.matched, t.predicted)}`,
      );
    });
  };
  summary('every page', totals, perPage.length);
  if (firstSetPages && firstSetPages < perPage.length) summary("version 2's pages", firstSet, firstSetPages);
  console.log('');
  console.log(`per page: ${systems.join(' | ')}`);
  for (const line of perPage) console.log(line);
  if (ocrPromptsFile) {
    writeFileSync(ocrPromptsFile, questions.map((q) => `${q}\n`).join(''));
    console.log(`\nwrote ${questions.length} questions with OCR's boxes to ${ocrPromptsFile}`);
  }
}
