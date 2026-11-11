/**
 * FastReport's demo reports as Forma skeletons (2026-11-10, the owner's AI
 * accuracy programme, batch AE, item 16), so the box reader learns from report
 * layouts beyond one company's.
 *
 *   npx tsx scripts/model/fastreport.ts --frx <dir> --out <dir>
 *
 * The reports are FastReport's own demos (github.com/FastReports/FastReport,
 * Demos/Reports, MIT; the licence and the commit are kept beside them). Each
 * page of a report is written as a minimal DevExpress REPX and read by
 * Forma's own parser and `skeletonOf`, so a FastReport text gets its role
 * exactly as a company report's does: a field with a running total is a
 * total, a field a value, words a caption, page numbers page information. The
 * skeletons go to `<out>/skeletons/<n>.json` as `npm run model:train` writes
 * them, for `npm run model:dataset` to pack beside the company's sets. A
 * skeleton keeps no words, so nothing a demo says is learned either.
 *
 * The mapping, FastReport to DevExpress, is `frxPageToRepx` in
 * src/lib/importForeign.ts, where it moved on 2026-11-11 (the full audit's
 * CP-08) so the workspace opens an .frx with the same mapping; its doc
 * comment holds the rules. Since then a page's size and margins are written
 * whole, as DevExpress 20.1 keeps them (repxPaper.ts). A report whose data
 * band holds another (master and detail) is left out and counted, rather
 * than mapped to a guess.
 *
 * The folders must be outside the repository. Prints counts only.
 *
 * Pure ASCII, as every script here.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { frxPageToRepx, frxTotals, parseXml } from '../../src/lib/importForeign';
import { parseReportStructure } from '../../src/lib/reportPreview';
import { skeletonOf } from '../../src/lib/reportSkeleton';

const argv = process.argv.slice(2);
const valueOf = (flag: string) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : undefined);
const frxDir = valueOf('--frx');
const outDir = valueOf('--out');
if (!frxDir || !outDir) {
  console.error('--frx and --out are required. See the doc comment of scripts/model/fastreport.ts.');
  process.exit(2);
}
for (const p of [frxDir, outDir]) {
  const rel = relative(resolve('.'), resolve(p));
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    console.error('--frx and --out must be outside the repository.');
    process.exit(2);
  }
}

// ------------------------------------------------------------- the run

const files = readdirSync(frxDir).filter((f) => f.toLowerCase().endsWith('.frx')).sort();
mkdirSync(join(outDir, 'skeletons'), { recursive: true });
mkdirSync(join(outDir, 'repx'), { recursive: true });
const skipped = new Map<string, number>();
const roles = new Map<string, number>();
let written = 0;
let unreadable = 0;
for (const file of files) {
  const root = parseXml(readFileSync(join(frxDir, file), 'utf8'));
  if (!root || root.name !== 'Report') {
    unreadable++;
    continue;
  }
  const totals = frxTotals(root);
  const pages = root.children.filter((c) => c.name === 'ReportPage');
  for (const page of pages) {
    const made = frxPageToRepx(page, totals, `fr${written + 1}`);
    if ('skipped' in made) {
      skipped.set(made.skipped, (skipped.get(made.skipped) ?? 0) + 1);
      continue;
    }
    const structure = parseReportStructure(made.repx);
    if (!structure.bands.length) {
      skipped.set('no band Forma could read', (skipped.get('no band Forma could read') ?? 0) + 1);
      continue;
    }
    const skeleton = skeletonOf(structure);
    for (const b of skeleton.bands) for (const c of b.controls) for (const role of [c.role, ...(c.rows ?? []).flat().map((x) => x.role)]) roles.set(role, (roles.get(role) ?? 0) + 1);
    written++;
    writeFileSync(join(outDir, 'skeletons', `${written}.json`), JSON.stringify({ category: null, skeleton }));
    writeFileSync(join(outDir, 'repx', `${written}.repx`), made.repx);
  }
}
console.log(`${files.length} reports, ${unreadable} unreadable; ${written} pages written as skeletons to ${join(outDir, 'skeletons')}`);
for (const [why, n] of skipped) console.log(`  left out: ${n} page(s), ${why}`);
console.log(`  roles: ${[...roles].map(([r, n]) => `${r} ${n}`).join(', ')}`);
