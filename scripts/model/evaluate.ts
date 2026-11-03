/**
 * Score Forma's vision model on the pages it was not trained on (2026-11-03,
 * milestone 6 of docs/proposals/own-model.md).
 *
 *   npx tsx scripts/model/evaluate.ts <predictions.jsonl>
 *
 * The input is what scripts/model/kaggle/train_vision.py writes to its
 * output: one held-out page per line, with the right skeleton text
 * (`target`) and the model's (`prediction`). Each is read with
 * textToSkeleton and the pair scored with scoreSkeleton
 * (src/lib/skeletonText.ts). The script prints the totals, then one line per
 * page. Both texts are structure only, so nothing printed here is a report's
 * words.
 */
import { readFileSync } from 'node:fs';
import { scoreSkeleton, textToSkeleton } from '../../src/lib/skeletonText';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npx tsx scripts/model/evaluate.ts <predictions.jsonl>');
  process.exit(2);
}

interface Row {
  id: string;
  image: string;
  target: string;
  prediction: string;
}
const rows: Row[] = readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as Row);

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
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
    `${r.image.padEnd(12)} lines ${String(lines(r.prediction)).padStart(4)} of ${String(lines(r.target)).padEnd(4)} ` +
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
