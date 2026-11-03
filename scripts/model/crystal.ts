/**
 * Number the Crystal Reports layouts that scripts/model/crystal.ps1 read as
 * skeletons, the way `npm run model:train` numbers .repx ones (2026-11-03,
 * milestone 6 of docs/proposals/own-model.md).
 *
 *   npx tsx scripts/model/crystal.ts --data <dir>
 *
 * --data  the folder crystal.ps1 wrote to, OUTSIDE the repository. Its
 *         crystal\<md5>.json layouts become skeletons\<n>.json, each
 *         {category, skeleton} as model:train writes them, numbered by md5 so a
 *         rerun gives the same numbers. index.json pairs each number with a file
 *         that layout was read from; like model:train's, it stays local.
 *
 * Then `npm run model:dataset -- --data <repx set> --data <this> ...` packs it
 * beside the .repx sets. Each layout goes through `skeletonFromLayout`, which
 * holds it to the skeleton's vocabulary, and the packer replaces any font
 * outside the public list and refuses a stray word, as for any other set.
 * Console output is counts only.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { categoryOf } from '../../src/lib/formaModel';
import { skeletonFromLayout, type ForeignLayout } from '../../src/lib/reportSkeleton';

const i = process.argv.indexOf('--data');
if (i < 0 || !process.argv[i + 1]) {
  console.error('--data is required. See the doc comment of scripts/model/crystal.ts.');
  process.exit(2);
}
const dataDir = resolve(process.argv[i + 1]);
const within = relative(resolve('.'), dataDir);
if (!within.startsWith('..') && !isAbsolute(within)) {
  console.error('--data is inside the repository. Keep the training set outside it.');
  process.exit(2);
}

// md5 -> a file it was read from, across every shard's list.
const fileOf = new Map<string, string>();
for (const name of readdirSync(dataDir).filter((f) => /^crystal-files-\d+\.json$/.test(f))) {
  const raw = readFileSync(join(dataDir, name), 'utf8').replace(/^﻿/, '');
  for (const e of JSON.parse(raw) as { md5: string; file: string }[]) fileOf.set(e.md5, e.file);
}

const layouts = readdirSync(join(dataDir, 'crystal'))
  .filter((f) => /^[0-9a-f]{32}\.json$/.test(f))
  .sort();
mkdirSync(join(dataDir, 'skeletons'), { recursive: true });
const index: { id: number; file: string | null; category: string | null }[] = [];
let unreadable = 0;
let empty = 0;
for (const name of layouts) {
  const md5 = name.slice(0, 32);
  let layout: ForeignLayout;
  try {
    layout = JSON.parse(readFileSync(join(dataDir, 'crystal', name), 'utf8').replace(/^﻿/, '')) as ForeignLayout;
    // PowerShell writes a one-item array as the item itself.
    layout.bands = ([] as ForeignLayout['bands']).concat(layout.bands ?? []).map((b) => ({ ...b, controls: ([] as ForeignLayout['bands'][number]['controls']).concat(b.controls ?? []) }));
  } catch {
    unreadable++;
    continue;
  }
  const skeleton = skeletonFromLayout(layout);
  if (!skeleton.bands.some((b) => b.controls.length)) {
    empty++;
    continue;
  }
  const file = fileOf.get(md5) ?? null;
  const category = file ? categoryOf(file) : null;
  const id = index.length + 1;
  index.push({ id, file, category });
  writeFileSync(join(dataDir, 'skeletons', `${id}.json`), JSON.stringify({ category, skeleton }));
}
writeFileSync(join(dataDir, 'index.json'), JSON.stringify(index, null, 1));
console.log(`layouts ${layouts.length}: skeletons written ${index.length}, unreadable ${unreadable}, with no control ${empty}`);
