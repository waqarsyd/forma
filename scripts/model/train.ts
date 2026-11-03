/**
 * Learn Forma's own model from a folder of .repx reports (2026-11-02).
 *
 *   npm run model:train -- --reports <dir> --data <dir> [--k 10] [--out assets/model/formaModel.json]
 *
 * --reports  the reports to learn from, searched recursively for .repx. They
 *            stay where they are: nothing here copies a report.
 * --data     where the sanitized training set is written: one skeleton per
 *            report and an index. Keep it OUTSIDE the repository. It holds no
 *            text, but its index names each report's file, which a client's
 *            folder names can identify.
 * --k        how many archetypes to learn (default 10).
 * --out      the model the app ships (default assets/model/formaModel.json),
 *            served at /model/ and fetched only when the offline generator runs.
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
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseReportStructure } from '../../src/lib/reportPreview';
import { skeletonOf } from '../../src/lib/reportSkeleton';
import { categoryOf, learnModel, unexpectedStrings, type TrainingReport } from '../../src/lib/formaModel';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : fallback;
  if (v === undefined) {
    console.error(`--${name} is required. See the doc comment of scripts/model/train.ts.`);
    process.exit(2);
  }
  return v;
}

const reportsDir = resolve(arg('reports'));
const dataDir = resolve(arg('data'));
const out = resolve(arg('out', 'assets/model/formaModel.json'));
const k = Number(arg('k', '10'));
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
walk(reportsDir);

mkdirSync(join(dataDir, 'skeletons'), { recursive: true });
const set: TrainingReport[] = [];
const index: { id: number; file: string; category: string | null }[] = [];
const folderWords = new Set<string>();
let failed = 0;
for (const file of files) {
  const rel = relative(reportsDir, file);
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
writeFileSync(join(dataDir, 'index.json'), JSON.stringify(index, null, 1));
console.log(`reports found ${files.length}, learned from ${set.length}, could not parse ${failed}`);

const model = learnModel(set, { k, minFontReports: 5 });
const strays = unexpectedStrings(model);
const fontClash = model.style.fonts.filter((f) => f.family.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length >= 3 && folderWords.has(w) && !/^(pro|bold|black|sans|serif|new|roman|times|arial|segoe|tahoma|courier|microsoft)$/.test(w)));
if (strays.length || fontClash.length) {
  writeFileSync(join(dataDir, 'leak-check.json'), JSON.stringify({ strays, fontClash }, null, 1));
  console.error(`Refusing to write the model: ${strays.length} string(s) outside the model's vocabulary and ${fontClash.length} font name(s) sharing a word with a folder name. Details (local only): ${join(dataDir, 'leak-check.json')}`);
  process.exit(1);
}
writeFileSync(out, `${JSON.stringify(model)}\n`);

const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;
console.log(`model written: ${relative(repo, out)}, ${kb(Buffer.byteLength(JSON.stringify(model)))}, ${model.archetypes.length} archetypes, leak check clean`);
console.log(`house fonts: ${model.style.fonts.map((f) => `${f.family} ${(f.share * 100).toFixed(0)}%`).join(', ')}`);
for (const [role, s] of Object.entries(model.style.roles)) console.log(`  ${role}: ${s!.family} ${s!.size}pt, bold ${(s!.bold * 100).toFixed(0)}%`);
console.log(`papers: ${model.style.papers.slice(0, 5).map((p) => `${p.paper}${p.landscape ? ' landscape' : ''} ${(p.share * 100).toFixed(0)}%`).join(', ')}`);
for (const a of model.archetypes) {
  const controls = a.skeleton.bands.reduce((s, b) => s + b.controls.length, 0);
  console.log(`  ${a.id} ${a.label}: ${(a.share * 100).toFixed(0)}% of reports, ${a.skeleton.paper}${a.skeleton.landscape ? ' landscape' : ''}, ${a.skeleton.bands.length} bands, ${controls} controls; categories ${a.categories.map((c) => `${c.name} ${(c.share * 100).toFixed(0)}%`).join(', ') || 'none'}`);
}
