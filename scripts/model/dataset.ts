/**
 * Pack Forma's skeletons as a private Kaggle dataset, for the vision model of
 * milestone 6 (2026-11-03, docs/proposals/own-model.md).
 *
 *   npm run model:dataset -- --data <dir> --out <dir> [--owner <kaggle-user>] [--eval 10]
 *
 * --data   the training set `npm run model:train` wrote. Only its skeletons/
 *          folder is read, never its index.json, which names each report's file.
 *          Give it more than once to pack several sets together (2026-11-03,
 *          the SUNFACET reports beside SBS.JMS). The first set keeps its ids,
 *          r12, so its held-out layouts stay the ones scored before; the next
 *          are s1r12, s2r12 and so on. A layout in two sets is packed once.
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
 * --max-train, --max-eval  caps on the layouts packed for each split (default
 *          none), taken one per group of near-copies in turn so a cap keeps
 *          as many kinds as it can. The first set's layouts come first, so a
 *          capped eval still holds the pages earlier versions were scored on.
 *          Version 4 (2026-11-03) has ~8,000 distinct layouts and GPU time
 *          for about 3,000 pages, so many layouts with few variants beat
 *          a few with many.
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
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync, writeSync } from 'node:fs';
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

/** Every value given for a flag that may repeat. */
function args(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === `--${name}` && process.argv[i + 1] !== undefined ? [process.argv[i + 1]] : []));
}

const dataDirs = args('data').map((d) => resolve(d));
if (!dataDirs.length) {
  console.error('--data is required. See the doc comment of scripts/model/dataset.ts.');
  process.exit(2);
}
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
  /** Unique across the sets: the number in the first, 100000 times the set's index plus it in the next. */
  key: number;
  id: string;
  category: string | null;
  skeleton: ReportSkeleton;
  target: string;
}

// Every skeleton of every set, as tall as it prints and in public fonts.
let replaced = 0;
const perSet: number[] = [];
const reports: Report[] = dataDirs.flatMap((dataDir, s) => {
  const files = readdirSync(join(dataDir, 'skeletons')).filter((f) => /^\d+\.json$/.test(f));
  perSet.push(files.length);
  return files
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map((file) => {
      const n = parseInt(file);
      const read = JSON.parse(readFileSync(join(dataDir, 'skeletons', file), 'utf8')) as { category: string | null; skeleton: ReportSkeleton };
      const fixed = publicFontsOnly(withPrintedHeights(read.skeleton));
      replaced += fixed.replaced;
      const category = read.category && categories.has(read.category) ? read.category : null;
      return { key: s * 100000 + n, id: s === 0 ? `r${n}` : `s${s}r${n}`, category, skeleton: fixed.skeleton, target: skeletonToText(fixed.skeleton) };
    });
});

// Each layout once. Version 1 trained on all 359, of which 199 differ, and one
// layout is 53 of them; it learned to write that layout for every page.
// Within a set the last copy stands for the layout, as version 2 chose; across
// sets the earlier set keeps it, so a SBS.JMS layout that SUNFACET repeats
// keeps its id and stays held out where version 2 held it out.
const bySet = (r: Report) => Math.floor(r.key / 100000);
const chosen = new Map<string, Report>();
for (const r of reports) {
  const had = chosen.get(r.target);
  if (!had || bySet(had) === bySet(r)) chosen.set(r.target, r);
}
const distinct = [...chosen.values()];

// Near-copies together, so none is held out while its twin is trained on: the
// same paper, and at least four fifths of the controls in the same places.
// Comparing every pair is fine for 218 layouts and hours for the ~8,000 the
// Crystal reports add (2026-11-03). So a pair is scored only when it could
// reach four fifths. Controls are matched only between bands of the same kind,
// so F1 is at most twice the sum, kind by kind, of the smaller control count,
// over both totals. That bound is exact, which keeps the groups as an
// all-pairs comparison makes them. A first try bucketed by band sequence
// instead, and split version 2's 82 groups into 113.
const parent = distinct.map((_, i) => i);
const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
const perKind = distinct.map((r) => {
  const m = new Map<string, number>();
  for (const b of r.skeleton.bands) if (b.controls.length) m.set(b.kind, (m.get(b.kind) ?? 0) + b.controls.length);
  return m;
});
const controlCount = (i: number) => [...perKind[i].values()].reduce((s, n) => s + n, 0);
const links: [number, number][] = [];
const buckets = new Map<string, number[]>();
distinct.forEach((r, i) => {
  const key = `${r.skeleton.paper}|${r.skeleton.landscape}`;
  buckets.set(key, [...(buckets.get(key) ?? []), i]);
});
for (const members of buckets.values()) {
  const sorted = [...members].sort((a, b) => controlCount(a) - controlCount(b));
  for (let x = 0; x < sorted.length; x++) {
    const i = sorted[x];
    const ci = controlCount(i);
    for (let y = x + 1; y < sorted.length; y++) {
      const j = sorted[y];
      const cj = controlCount(j);
      // Sorted by count, so once the smaller is under 2/3 of the larger, every later one is too.
      if (ci + cj > 0 && ci < (2 / 3) * cj) break;
      let shared = 0;
      for (const [kind, n] of perKind[i]) shared += Math.min(n, perKind[j].get(kind) ?? 0);
      if (ci + cj > 0 && (2 * shared) / (ci + cj) < 0.8) continue;
      // The later layout as the prediction, as the all-pairs loop scored it: the
      // match is greedy, so the order can change a borderline pair.
      const [a, b] = i < j ? [i, j] : [j, i];
      const s = scoreSkeleton(distinct[b].skeleton, distinct[a].skeleton);
      const f1 = s.controls.predicted + s.controls.expected ? (2 * s.controls.matched) / (s.controls.predicted + s.controls.expected) : 1;
      if (f1 >= 0.8) links.push([a, b]);
    }
  }
}
// Joined in the order the all-pairs loop joined them. The groups come out the
// same in any order, but which layout heads a group does not, and a group is
// held out by its head's number: joined as found, 7 of version 2's 20 held-out
// layouts moved to training.
links.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
for (const [a, b] of links) parent[root(b)] = root(a);
const groups = new Set(distinct.map((_, i) => root(i)));

/**
 * At most `max` of `members`, taken one per group in turn, so a cap keeps as
 * many kinds of layout as it can (2026-11-03: the Crystal reports give ~8,000
 * distinct layouts, and the GPU time is for about 3,000 pages). The first set
 * comes first, so the pages version 2 was scored on stay in a capped eval.
 */
function spread(members: number[], max: number): number[] {
  if (!(max > 0) || members.length <= max) return members;
  const byGroup = new Map<number, number[]>();
  for (const i of [...members].sort((a, b) => distinct[a].key - distinct[b].key)) byGroup.set(root(i), [...(byGroup.get(root(i)) ?? []), i]);
  const queues = [...byGroup.values()].sort((a, b) => distinct[a[0]].key - distinct[b[0]].key);
  const firstSet = members.filter((i) => distinct[i].key < 100000);
  const out: number[] = firstSet.length < max ? [...firstSet] : firstSet.slice(0, max);
  const taken = new Set(out);
  for (let round = 0; out.length < max; round++) {
    let any = false;
    for (const q of queues) {
      if (round >= q.length) continue;
      any = true;
      if (taken.has(q[round])) continue;
      out.push(q[round]);
      taken.add(q[round]);
      if (out.length >= max) break;
    }
    if (!any) break;
  }
  return out.sort((a, b) => a - b);
}

const maxTrain = Number(arg('max-train', '0'));
const maxEval = Number(arg('max-eval', '0'));
const isHeld = distinct.map((_, i) => held(distinct[root(i)].key));
const trainSet = spread(distinct.flatMap((_, i) => (isHeld[i] ? [] : [i])), maxTrain);
const evalSet = spread(distinct.flatMap((_, i) => (isHeld[i] ? [i] : [])), maxEval);
const evalGroups = new Set(evalSet.map((i) => root(i))).size;
const trainGroups = new Set(trainSet.map((i) => root(i))).size;

// The held-out layouts once each, as they are; every trained layout as it is
// and in `augment` variants, so the right answer can only be read off the picture.
// Written line by line: version 4's lines together pass the longest string V8 holds.
let strays = 0;
let evalCount = 0;
let count = 0;
const sizes: number[] = [];
const lines: string[] = [];
const push = (r: Report, id: string, skeleton: ReportSkeleton, split: 'train' | 'eval') => {
  const target = skeletonToText(skeleton);
  strays += strayWords(target).length;
  if (split === 'eval') evalCount++;
  count++;
  sizes.push(target.length);
  lines.push(JSON.stringify({ id, category: r.category, split, skeleton, target }));
};
for (const i of [...trainSet, ...evalSet].sort((a, b) => a - b)) {
  const r = distinct[i];
  const out = isHeld[i];
  push(r, r.id, r.skeleton, out ? 'eval' : 'train');
  if (out) continue;
  for (let v = 1; v <= augment; v++) push(r, `${r.id}v${v}`, perturbSkeleton(r.skeleton, seeded(r.key * 1000 + v)), 'train');
}

if (strays) {
  console.error(`Refusing to write the dataset: ${strays} word(s) in the targets that the format did not put there.`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const fd = openSync(join(outDir, 'examples.jsonl'), 'w');
for (const line of lines) writeSync(fd, `${line}\n`);
closeSync(fd);
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

sizes.sort((a, b) => a - b);
const groupSize = new Map<number, number>();
distinct.forEach((_, i) => groupSize.set(root(i), (groupSize.get(root(i)) ?? 0) + 1));
const groupSizes = [...groupSize.values()].sort((a, b) => b - a);
const heldGroups = new Set(distinct.flatMap((_, i) => (isHeld[i] ? [root(i)] : []))).size;
console.log(`skeletons ${reports.length} (${perSet.join(' + ')} by set), distinct ${distinct.length}, in ${groups.size} groups of near-copies (${heldGroups} held out); largest groups ${groupSizes.slice(0, 6).join(', ')}`);
console.log(`packed: train ${trainSet.length} layouts from ${trainGroups} groups, eval ${evalSet.length} layouts from ${evalGroups} groups${maxTrain || maxEval ? ' (capped, one per group in turn)' : ''}`);
console.log(`examples ${count}: train ${count - evalCount} (each layout and ${augment} variants), eval ${evalCount}`);
console.log(`fonts replaced by Arial: ${replaced}; stray words: 0`);
console.log(`target length in characters: median ${sizes[Math.floor(sizes.length / 2)]}, 90th percentile ${sizes[Math.floor(sizes.length * 0.9)]}, largest ${sizes.at(-1)}`);
console.log(`written: ${join(outDir, 'examples.jsonl')} and dataset-metadata.json`);
