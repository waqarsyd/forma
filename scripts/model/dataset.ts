/**
 * Pack Forma's skeletons as a private Kaggle dataset, for the vision model of
 * milestone 6 (2026-11-03, docs/proposals/own-model.md).
 *
 *   npm run model:dataset -- --data <dir> --out <dir> [--owner <kaggle-user>] [--eval 10]
 *
 * --data   the training set `npm run model:train` wrote. Only its skeletons/
 *          folder is read, never its index.json, which names each report's file.
 * --out    where the dataset is written. Keep it OUTSIDE the repository.
 *          `python scripts/model/render.py <out>` then draws each skeleton as
 *          page images in the same folder. `kaggle datasets create -p <out>`
 *          uploads it, and a new dataset is private unless --public is given.
 * --owner  the Kaggle username the dataset's id goes under. Without it the
 *          id says your-kaggle-username; edit dataset-metadata.json before
 *          uploading.
 * --eval   the percentage held out for evaluation (default 10). An example's
 *          share is decided by its number, so it is the same on every run.
 *
 * Writes examples.jsonl, one skeleton per line with its id, category, split
 * and `target` (the text the model learns to write, src/lib/skeletonText.ts),
 * and dataset-metadata.json. Each band is written as tall as it prints
 * (`withPrintedHeights`), because that is the height a picture shows.
 *
 * On 2026-11-03 the owner decided what may go to Kaggle: these skeletons,
 * drawn with placeholder text. A skeleton holds no text, name, query or
 * picture, but a font family is a name that a report chose, and a rare one
 * could be a client's own. So every family outside `PUBLIC_FONTS` becomes
 * Arial. Then every target is checked with `strayWords`, and if any word is
 * left that the format did not put there, the script exits 1 having written
 * nothing. Its console output is counts only.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CATEGORY_WORDS } from '../../src/lib/formaModel';
import type { ReportSkeleton } from '../../src/lib/reportSkeleton';
import { publicFontsOnly, skeletonToText, strayWords, withPrintedHeights } from '../../src/lib/skeletonText';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : fallback;
  if (v === undefined) {
    console.error(`--${name} is required. See the doc comment of scripts/model/dataset.ts.`);
    process.exit(2);
  }
  return v;
}

const dataDir = resolve(arg('data'));
const outDir = resolve(arg('out'));
const owner = arg('owner', 'your-kaggle-username');
const evalPercent = Number(arg('eval', '10'));
const repo = resolve('.');
if (outDir.toLowerCase().startsWith(repo.toLowerCase())) {
  console.error('--out is inside the repository. Keep the dataset outside it.');
  process.exit(2);
}

/** About `evalPercent` of the numbers, spread evenly, the same ones on every run. */
const held = (n: number) => (Math.imul(n, 2654435761) >>> 0) % 100 < evalPercent;
const categories = new Set(Object.keys(CATEGORY_WORDS));

const files = readdirSync(join(dataDir, 'skeletons')).filter((f) => /^\d+\.json$/.test(f));
const examples: string[] = [];
let replaced = 0;
let strays = 0;
let evalCount = 0;
for (const file of files.sort((a, b) => parseInt(a) - parseInt(b))) {
  const n = parseInt(file);
  const read = JSON.parse(readFileSync(join(dataDir, 'skeletons', file), 'utf8')) as { category: string | null; skeleton: ReportSkeleton };
  const fixed = publicFontsOnly(withPrintedHeights(read.skeleton));
  replaced += fixed.replaced;
  const target = skeletonToText(fixed.skeleton);
  strays += strayWords(target).length;
  const category = read.category && categories.has(read.category) ? read.category : null;
  const split = held(n) ? 'eval' : 'train';
  if (split === 'eval') evalCount++;
  examples.push(JSON.stringify({ id: `r${n}`, category, split, skeleton: fixed.skeleton, target }));
}

if (strays) {
  console.error(`Refusing to write the dataset: ${strays} word(s) in the targets that the format did not put there.`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'examples.jsonl'), `${examples.join('\n')}\n`);
writeFileSync(
  join(outDir, 'dataset-metadata.json'),
  `${JSON.stringify(
    {
      title: 'Forma report skeletons',
      subtitle: 'Report page images and their structure, for a vision model',
      description:
        "Training data for Forma's vision model (github.com/waqarsyd/forma, docs/proposals/own-model.md). " +
        'Each example is the structure of a report page, its paper, bands and controls, drawn as an image. ' +
        'Structure only: no text, name, query or picture from any report. Every word in an image is a placeholder.',
      id: `${owner}/forma-report-skeletons`,
      licenses: [{ name: 'other' }],
    },
    null,
    2,
  )}\n`,
);

const sizes = examples.map((e) => (JSON.parse(e) as { target: string }).target.length).sort((a, b) => a - b);
console.log(`examples ${examples.length}: train ${examples.length - evalCount}, eval ${evalCount}`);
console.log(`fonts replaced by Arial: ${replaced}; stray words: 0`);
console.log(`target length in characters: median ${sizes[Math.floor(sizes.length / 2)]}, 90th percentile ${sizes[Math.floor(sizes.length * 0.9)]}, largest ${sizes.at(-1)}`);
console.log(`written: ${join(outDir, 'examples.jsonl')} and dataset-metadata.json`);
