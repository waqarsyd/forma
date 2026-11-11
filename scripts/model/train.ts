/**
 * Learn Forma's own model from a folder of .repx reports (2026-11-02).
 *
 *   npm run model:train -- --reports <dir> --data <dir> [--skeletons <dir> ...] [--k 10] [--hold-out 0.1] [--out <file>]
 *
 * --reports    the reports to learn from, searched recursively for .repx. They
 *              stay where they are: nothing here copies a report.
 * --skeletons  a folder of {category, skeleton} JSON files: what
 *              scripts/model/pull-learning.ts pulled from people's accounts
 *              (each with its `account`), or skeletons read another way (the
 *              Crystal set); may be repeated. Learned beside the reports, or
 *              alone when --reports is absent.
 * --data       where the sanitized training set is written: one skeleton per
 *              report and an index. Keep it OUTSIDE the repository. It holds no
 *              text, but its index names each report's file, which a client's
 *              folder names can identify. Its skeletons/ and held-out/ are
 *              emptied and rebuilt on every run, so what was deleted from a
 *              source is gone from here too.
 * --k          how many archetypes to learn (default 10).
 * --hold-out   the share of pulled skeletons kept out of training, in
 *              <data>/held-out, for scripts/model/gate.ts to measure the
 *              candidate on (default 0); chosen by each file's name, so the
 *              same file is held out every week.
 * --out        where the model is written. Since 2026-11-11 (the full audit,
 *              LM-21) the default is <data>/candidate/formaModel.json, a
 *              CANDIDATE: scripts/model/gate.ts decides whether it may replace
 *              assets/model/formaModel.json, the model the app ships (served at
 *              /model/ and fetched only when the offline generator runs), and
 *              scripts/model/learn-week.ts copies it there when it may. Name
 *              that file here to write it directly, as before.
 *
 * A pulled skeleton is checked again before it is learned from
 * (`soundSkeleton`, lib/learningPipeline.ts): one that is not sound is
 * counted and left out, and a font family that is '' is no font (LM-24b).
 * A font is learned from pulled skeletons only when three different accounts
 * use it (LM-07). The model carries an `id`, the first 12 hex digits of its
 * SHA-256, and `trainedFrom`, the counts it was learned from.
 *
 * The owner's reports are client material, and the owner chose that what
 * ships with the free, public app be learned from structure only. So each
 * report is reduced to its skeleton (src/lib/reportSkeleton.ts) before
 * anything is learned. The model is written only when `unexpectedStrings`
 * finds no string in it outside the fixed vocabulary a model may hold, and
 * when no font it names is also a word of a folder name. Otherwise the script
 * exits 1 without writing it. Its console output is counts and shares only,
 * so no report's words reach a terminal or a log.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseReportStructure } from '../../src/lib/reportPreview';
import { skeletonOf, type ReportSkeleton, type SkeletonFont } from '../../src/lib/reportSkeleton';
import { CATEGORY_WORDS, categoryOf, learnModel, modelIdSource, unexpectedStrings, type TrainingReport } from '../../src/lib/formaModel';
import { shortHash, soundSkeleton } from '../../src/lib/learningPipeline';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : fallback;
  if (v === undefined) {
    console.error(`--${name} is required. See the doc comment of scripts/model/train.ts.`);
    process.exit(2);
  }
  return v;
}

// --skeletons: folders of {category, skeleton} JSON files, as
// scripts/model/pull-learning.ts writes them from what people let Forma learn
// from (2026-11-10); learned beside the reports, or alone when --reports is
// absent. Repeatable since 2026-11-11, so the weekly job can learn the pulled
// set beside a fixed one.
const skeletonsDirs = process.argv.flatMap((a, i) => (a === '--skeletons' && process.argv[i + 1] ? [resolve(process.argv[i + 1])] : []));
const reportsDir = skeletonsDirs.length && !process.argv.includes('--reports') ? null : resolve(arg('reports'));
const dataDir = resolve(arg('data'));
const out = resolve(arg('out', join(dataDir, 'candidate', 'formaModel.json')));
const k = Number(arg('k', '10'));
const holdOut = Number(arg('hold-out', '0'));
if (!(holdOut >= 0 && holdOut < 1)) {
  console.error('--hold-out is a share from 0 up to, not including, 1.');
  process.exit(2);
}
const repo = resolve('.');
// Inside means the repository or a folder under it. A name test is not enough:
// a sibling such as ../forma-model-data begins with the repository's own path.
const within = relative(repo, dataDir);
if (!within.startsWith('..') && !isAbsolute(within)) {
  console.error('--data is inside the repository. Keep the training set outside it.');
  process.exit(2);
}

const files: string[] = [];
const walk = (d: string) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.repx$/i.test(name)) files.push(p);
  }
};
if (reportsDir) walk(reportsDir);

// Both folders are rebuilt from the sources on every run (2026-11-11, the
// review of batch LO). They were only ever added to, so a person who cleared
// their learning or deleted their account, and whom pull-learning.ts had
// since removed from the pull folder, stayed here for good: in held-out/,
// which the gate reads every week, and in skeletons/, as did files numbered
// past a smaller later set. A source inside either would be emptied with
// them, so that is refused first.
const rebuilt = [join(dataDir, 'skeletons'), join(dataDir, 'held-out')];
for (const source of [...skeletonsDirs, ...(reportsDir ? [reportsDir] : [])]) {
  if (rebuilt.some((r) => !relative(r, source).startsWith('..') && !isAbsolute(relative(r, source)))) {
    console.error(`${source} is inside ${dataDir}'s skeletons or held-out folder, which every run empties. Keep the sources elsewhere.`);
    process.exit(2);
  }
}
for (const dir of rebuilt) rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dataDir, 'skeletons'), { recursive: true });
const set: TrainingReport[] = [];
const index: { id: number; file: string; category: string | null }[] = [];
const folderWords = new Set<string>();
let failed = 0;
for (const file of files) {
  const rel = relative(reportsDir ?? '', file);
  for (const w of rel.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 3) folderWords.add(w);
  try {
    const skeleton = skeletonOf(parseReportStructure(readFileSync(file, 'utf8')));
    const category = categoryOf(rel);
    const id = set.length + 1;
    set.push({ skeleton, category });
    index.push({ id, file: rel, category });
    writeFileSync(join(dataDir, 'skeletons', `${id}.json`), JSON.stringify({ category, skeleton }));
  } catch {
    failed++;
  }
}
// Skeletons already reduced (pull-learning.ts, or another reader): each a
// {category, skeleton} file, with `account` when it was pulled from one. Each
// is checked again (soundSkeleton) rather than trusted, since a pulled one
// came from a browser anyone can script. A share of the pulled ones, chosen
// by file name, is held out for the gate to measure the candidate on.
/** A skeleton with every font whose family is '' taken away (LM-24b): no font, rather than a font named ''. */
function withoutEmptyFamilies(k: ReportSkeleton): ReportSkeleton {
  const fix = (f: SkeletonFont | null) => (f && !f.family ? null : f);
  return {
    ...k,
    bands: k.bands.map((b) => ({
      ...b,
      controls: b.controls.map((c) => ({ ...c, font: fix(c.font), ...(c.rows ? { rows: c.rows.map((r) => r.map((cell) => ({ ...cell, font: fix(cell.font) }))) } : {}) })),
    })),
  };
}

let pulled = 0;
let heldOut = 0;
let unsound = 0;
const pulledAccounts = new Set<string>();
if (holdOut > 0) mkdirSync(join(dataDir, 'held-out'), { recursive: true });
for (const [d, skeletonsDir] of skeletonsDirs.entries()) {
  // A pull folder (its events.jsonl beside skeletons/) holds what people
  // shared, whatever a file says: one written before the pull named its
  // account (2026-11-10) is held to the same checks, under one shared stand-in
  // account, so such files together count once toward a font's three.
  const pullFolder = existsSync(join(skeletonsDir, '..', 'events.jsonl'));
  for (const name of readdirSync(skeletonsDir)) {
    if (!/\.json$/i.test(name)) continue;
    try {
      const file = JSON.parse(readFileSync(join(skeletonsDir, name), 'utf8')) as { category?: string | null; skeleton?: ReportSkeleton; account?: string };
      const account = typeof file.account === 'string' && /^acct-[0-9a-f]+$/.test(file.account) ? file.account : pullFolder ? 'acct-unnamed' : null;
      // A pulled skeleton is held to the vocabulary, the page and the public
      // fonts; one of the owner's own sets (no account) keeps its fonts, as
      // the owner's reports do, less any family that is ''.
      const skeleton = account ? soundSkeleton(file.skeleton) : file.skeleton?.bands ? withoutEmptyFamilies(file.skeleton) : null;
      if (!skeleton) {
        unsound++;
        continue;
      }
      const category = typeof file.category === 'string' && file.category in CATEGORY_WORDS ? file.category : null;
      if (account && holdOut > 0 && parseInt(shortHash(name).slice(-6), 16) / 0x1000000 < holdOut) {
        writeFileSync(join(dataDir, 'held-out', name), JSON.stringify({ category, skeleton }));
        heldOut++;
        continue;
      }
      const id = set.length + 1;
      set.push({ skeleton, category, account });
      index.push({ id, file: `skeletons${d + 1}/${name}`, category });
      writeFileSync(join(dataDir, 'skeletons', `${id}.json`), JSON.stringify({ category, skeleton }));
      if (account) {
        pulled++;
        pulledAccounts.add(account);
      }
    } catch {
      failed++;
    }
  }
}
writeFileSync(join(dataDir, 'index.json'), JSON.stringify(index, null, 1));
console.log(
  `reports found ${files.length}, learned from ${set.length}${pulled ? ` (${pulled} pulled, from ${pulledAccounts.size} accounts)` : ''}` +
    `${heldOut ? `, held out ${heldOut}` : ''}, could not parse ${failed}${unsound ? `, not sound ${unsound}` : ''}`,
);

const learned = learnModel(set, { k, minFontReports: 5, minFontAccounts: 3 });
const trained = { ...learned, trainedFrom: { reports: set.length - pulled, events: pulled, accounts: pulledAccounts.size } };
const model = { id: createHash('sha256').update(modelIdSource(trained)).digest('hex').slice(0, 12), ...trained };
const strays = unexpectedStrings(model);
const fontClash = model.style.fonts.filter((f) => f.family.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length >= 3 && folderWords.has(w) && !/^(pro|bold|black|sans|serif|new|roman|times|arial|segoe|tahoma|courier|microsoft)$/.test(w)));
if (strays.length || fontClash.length) {
  writeFileSync(join(dataDir, 'leak-check.json'), JSON.stringify({ strays, fontClash }, null, 1));
  console.error(`Refusing to write the model: ${strays.length} string(s) outside the model's vocabulary and ${fontClash.length} font name(s) sharing a word with a folder name. Details (local only): ${join(dataDir, 'leak-check.json')}`);
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(model)}\n`);

const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;
console.log(`model ${model.id} written: ${relative(repo, out)}, ${kb(Buffer.byteLength(JSON.stringify(model)))}, ${model.archetypes.length} archetypes, leak check clean`);
console.log(`house fonts: ${model.style.fonts.map((f) => `${f.family} ${(f.share * 100).toFixed(0)}%`).join(', ')}`);
for (const [role, s] of Object.entries(model.style.roles)) console.log(`  ${role}: ${s!.family} ${s!.size}pt, bold ${(s!.bold * 100).toFixed(0)}%`);
console.log(`papers: ${model.style.papers.slice(0, 5).map((p) => `${p.paper}${p.landscape ? ' landscape' : ''} ${(p.share * 100).toFixed(0)}%`).join(', ')}`);
for (const a of model.archetypes) {
  const controls = a.skeleton.bands.reduce((s, b) => s + b.controls.length, 0);
  console.log(`  ${a.id} ${a.label}: ${(a.share * 100).toFixed(0)}% of reports, ${a.skeleton.paper}${a.skeleton.landscape ? ' landscape' : ''}, ${a.skeleton.bands.length} bands, ${controls} controls; categories ${a.categories.map((c) => `${c.name} ${(c.share * 100).toFixed(0)}%`).join(', ') || 'none'}`);
}
