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
 * --eval   the percentage of layouts held out for evaluation (default 10),
 *          decided by number, so it is the same on every run.
 * --augment  how many variants of each trained layout (default 6).
 *
 * Version 1 of the vision model learned to write one layout for every page:
 * - the 359 skeletons hold only 199 different texts;
 * - one layout is 53 of them;
 * - 28 of the 40 held-out pages had an exact copy in training.
 * So each layout is packed once. Near-copies are grouped and held out
 * together: the same paper, with four fifths of the controls in the same
 * places. Each trained layout comes with variants (`perturbSkeleton`) that
 * move its margins and controls, so the right answer can only be read off
 * the picture.
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
import { isAbsolute, join, relative, resolve } from 'node:path';
import { CATEGORY_WORDS } from '../../src/lib/formaModel';
import type { ReportSkeleton } from '../../src/lib/reportSkeleton';
import { perturbSkeleton, publicFontsOnly, scoreSkeleton, skeletonToText, strayWords, withPrintedHeights } from '../../src/lib/skeletonText';

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
// Inside means the repository or a folder under it. A name test is not enough:
// a sibling such as ../forma-model-data begins with the repository's own path.
const within = relative(resolve('.'), outDir);
if (!within.startsWith('..') && !isAbsolute(within)) {
  console.error('--out is inside the repository. Keep the dataset outside it.');
  process.exit(2);
}

const augment = Number(arg('augment', '6'));

/** About `evalPercent` of the numbers, spread evenly, the same ones on every run. */
const held = (n: number) => (Math.imul(n, 2654435761) >>> 0) % 100 < evalPercent;
const categories = new Set(Object.keys(CATEGORY_WORDS));
/** A seeded generator, so the variants are the same on every run. */
const seeded = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

interface Report {
  n: number;
  category: string | null;
  skeleton: ReportSkeleton;
  target: string;
}

// Every skeleton, as tall as it prints and in public fonts.
const files = readdirSync(join(dataDir, 'skeletons')).filter((f) => /^\d+\.json$/.test(f));
let replaced = 0;
const reports: Report[] = files
  .sort((a, b) => parseInt(a) - parseInt(b))
  .map((file) => {
    const read = JSON.parse(readFileSync(join(dataDir, 'skeletons', file), 'utf8')) as { category: string | null; skeleton: ReportSkeleton };
    const fixed = publicFontsOnly(withPrintedHeights(read.skeleton));
    replaced += fixed.replaced;
    const category = read.category && categories.has(read.category) ? read.category : null;
    return { n: parseInt(file), category, skeleton: fixed.skeleton, target: skeletonToText(fixed.skeleton) };
  });

// Each layout once. Version 1 trained on all 359, of which 199 differ, and one
// layout is 53 of them; it learned to write that layout for every page.
const distinct = [...new Map(reports.map((r) => [r.target, r])).values()];

// Near-copies together, so none is held out while its twin is trained on: the
// same paper, and at least four fifths of the controls in the same places.
const parent = distinct.map((_, i) => i);
const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
for (let i = 0; i < distinct.length; i++) {
  for (let j = i + 1; j < distinct.length; j++) {
    const a = distinct[i].skeleton;
    const b = distinct[j].skeleton;
    if (a.paper !== b.paper || a.landscape !== b.landscape) continue;
    const s = scoreSkeleton(b, a);
    const f1 = s.controls.predicted + s.controls.expected ? (2 * s.controls.matched) / (s.controls.predicted + s.controls.expected) : 1;
    if (f1 >= 0.8) parent[root(j)] = root(i);
  }
}
const groups = new Set(distinct.map((_, i) => root(i)));

// The held-out layouts once each, as they are; every trained layout as it is
// and in `augment` variants, so the right answer can only be read off the picture.
const examples: string[] = [];
let strays = 0;
let evalCount = 0;
const push = (r: Report, id: string, skeleton: ReportSkeleton, split: 'train' | 'eval') => {
  const target = skeletonToText(skeleton);
  strays += strayWords(target).length;
  if (split === 'eval') evalCount++;
  examples.push(JSON.stringify({ id, category: r.category, split, skeleton, target }));
};
let evalGroups = 0;
distinct.forEach((r, i) => {
  const out = held(distinct[root(i)].n);
  if (out && root(i) === i) evalGroups++;
  push(r, `r${r.n}`, r.skeleton, out ? 'eval' : 'train');
  if (out) return;
  for (let v = 1; v <= augment; v++) push(r, `r${r.n}v${v}`, perturbSkeleton(r.skeleton, seeded(r.n * 1000 + v)), 'train');
});

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
const groupSizes = [...groups].map((g) => distinct.filter((_, i) => root(i) === g).length).sort((a, b) => b - a);
console.log(`skeletons ${reports.length}, distinct ${distinct.length}, in ${groups.size} groups of near-copies (${evalGroups} held out); largest groups ${groupSizes.slice(0, 6).join(', ')}`);
console.log(`examples ${examples.length}: train ${examples.length - evalCount} (each layout and ${augment} variants), eval ${evalCount}`);
console.log(`fonts replaced by Arial: ${replaced}; stray words: 0`);
console.log(`target length in characters: median ${sizes[Math.floor(sizes.length / 2)]}, 90th percentile ${sizes[Math.floor(sizes.length * 0.9)]}, largest ${sizes.at(-1)}`);
console.log(`written: ${join(outDir, 'examples.jsonl')} and dataset-metadata.json`);
