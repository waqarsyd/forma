/**
 * Score Forma's box reader on real reports (2026-11-04, the owner's approval:
 * "scores only"; docs/proposals/own-model.md, *The box reader on real
 * reports*).
 *
 *   npx tsx scripts/model/realScore.ts --reports <dir> [--reports <dir>] --work <dir> [--limit 60] [--workers 8] [--model <file>]
 *
 * Every other score of the reader is on pages render.py drew from skeletons.
 * This prints the company's own reports with DevExpress itself and reads the
 * printed page as Forma would read a scan of it:
 * 1. **Layouts.** The `.repx` files under each `--reports` folder, one per
 *    distinct skeleton, `--limit` of them taken evenly by name.
 * 2. **A case each**, in `--work`: the report and a `data.json` of made-up
 *    rows for every field it binds (a number for a name that sounds like an
 *    amount or a count, a date for a date, a word otherwise), in three groups
 *    when it groups. None of the company's data is read or needed.
 * 3. **Printed** by `tools/RepxProbe render`: page 1 as a 96 dpi PNG, and
 *    `render.json` with every brick, its text and the control that printed it.
 * 4. **The truth** of every printed text is its control's band, and its role
 *    as `skeletonOf` assigns it (bound value, total, caption, title, page
 *    information), the same rules the training skeletons were made with. A
 *    table cell's name comes from the file, in the order the parser reads the
 *    cells.
 * 5. **Read** by OCR as the app reads a picture (ocrPages.ts), then by the
 *    reader; each text OCR read takes the truth of the brick it covers most.
 *
 * The real reports are client material, so everything this writes stays in
 * `--work`, which must be outside the repository. What it prints is counts
 * and percentages, never a report's words.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { readDetectedPage, readsTheseFeatures, rulesOf, type BoxReaderModel } from '../../src/lib/boxReader';
import { detectLayout } from '../../src/lib/ocrLayout';
import { pageForImage } from '../../src/lib/reportGeometry';
import { parseReportStructure } from '../../src/lib/reportPreview';
import { skeletonOf } from '../../src/lib/reportSkeleton';
import { skeletonToText } from '../../src/lib/skeletonText';
import { readWithOcr } from './ocrPages';
import { absolute, truthOf, type Brick, type Truth } from './printedTruth';

const argv = process.argv.slice(2);
const valuesOf = (flag: string) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
const valueOf = (flag: string) => valuesOf(flag)[0];
const reportDirs = valuesOf('--reports');
const workDir = valueOf('--work');
const LIMIT = Number(valueOf('--limit') ?? 60);
const WORKERS = Number(valueOf('--workers') ?? 8);
const modelFile = valueOf('--model') ?? 'assets/model/boxReader.json';
/** `--dump <file>`: each line's masked structure, for studying the misreadings; outside the repository. */
const dumpFile = valueOf('--dump');
/** `--rules`, as boxes.ts takes it: the rules after the networks, `app` by default. */
const RULES = rulesOf(valueOf('--rules') ?? 'app');
const dumpRows: string[] = [];
const PROBE = resolve('tools/RepxProbe/bin/Release/RepxProbe.exe');

if (!reportDirs.length || !workDir) {
  console.error('Usage: npx tsx scripts/model/realScore.ts --reports <dir> --work <dir> [--limit 60]');
  process.exit(2);
}
if (resolve(workDir).startsWith(resolve('.') + sep)) {
  console.error('--work must be outside the repository: the printed pages hold client material.');
  process.exit(2);
}
if (dumpFile && resolve(dumpFile).startsWith(resolve('.') + sep)) {
  console.error('--dump must be outside the repository, as --work is.');
  process.exit(2);
}

const model = JSON.parse(readFileSync(resolve(modelFile), 'utf8')) as BoxReaderModel;
if (!readsTheseFeatures(model)) {
  console.error(`${modelFile} was trained on other features than boxReader.ts computes now.`);
  process.exit(2);
}

// ------------------------------------------------------------ the layouts
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : d.name.toLowerCase().endsWith('.repx') ? [join(dir, d.name)] : []));
const files = reportDirs.flatMap((d) => walk(resolve(d))).sort();
const distinct = new Map<string, string>();
for (const f of files) {
  if (statSync(f).size > 4_000_000) continue;
  const s = parseReportStructure(readFileSync(f, 'utf8'));
  if (!s.bands.length) continue;
  const key = createHash('sha1').update(skeletonToText(skeletonOf(s))).digest('hex');
  if (!distinct.has(key)) distinct.set(key, f);
}
const layouts = [...distinct.values()];
const step = Math.max(1, layouts.length / LIMIT);
const chosen = Array.from({ length: Math.min(LIMIT, layouts.length) }, (_, i) => layouts[Math.floor(i * step)]);
console.log(`real reports: ${files.length} files, ${layouts.length} distinct layouts, ${chosen.length} chosen`);

// -------------------------------------------------------------- the cases
/** A made-up value for a field, from its name alone. */
function madeUp(field: string, row: number): string | number {
  const name = field.replace(/^.*\./, '');
  if (/date|dt$|day/i.test(name)) return `2026-${String((row % 12) + 1).padStart(2, '0')}-${String((row % 27) + 1).padStart(2, '0')}`;
  if (/qty|quantity|count|nos?$|number|pcs|units/i.test(name)) return (row * 7) % 90 + 1;
  if (/amount|amt|total|price|rate|value|balance|debit|credit|net|gross|tax|vat|cost|sum|salary|pay|fee|charge/i.test(name)) return Math.round(((row * 7919) % 900000) + 1000) / 100;
  return `${name.slice(0, 10)} ${String.fromCharCode(65 + (row % 26))}${row + 1}`;
}

const work = resolve(workDir);
mkdirSync(work, { recursive: true });
const cases: { dir: string; names: Map<string, Truth> }[] = [];
let failed = 0;
chosen.forEach((file) => {
  // Named by the report, so a later run with another --limit reuses only its own print.
  const dir = join(work, `r-${createHash('sha1').update(file).digest('hex').slice(0, 12)}`);
  mkdirSync(dir, { recursive: true });
  const xml = readFileSync(file, 'utf8');
  const truth = truthOf(xml);
  if (!existsSync(join(dir, 'render.json'))) {
    copyFileSync(file, join(dir, 'report.repx'));
    const member = truth.member || 'Data';
    const rows = Array.from({ length: 12 }, (_, r) =>
      Object.fromEntries([
        ...truth.fields.map((f) => [f.replace(/^.*\./, ''), madeUp(f, r)]),
        ...truth.groups.map((g) => [g.replace(/^.*\./, ''), `Group ${Math.floor(r / 4) + 1}`]),
      ]),
    );
    writeFileSync(join(dir, 'data.json'), JSON.stringify({ dataMember: member, tables: { [member]: rows }, exports: ['png'] }));
    try {
      execFileSync(PROBE, ['render', dir, dir], { stdio: 'pipe', timeout: 120_000 });
    } catch {
      failed++;
      return;
    }
  }
  if (existsSync(join(dir, 'report.png'))) cases.push({ dir, names: truth.names });
  else failed++;
});
console.log(`printed: ${cases.length} reports, ${failed} that DevExpress could not print here`);

// ----------------------------------------------------------------- reading
// OCR every printed page in one run, as many at a time as asked.
const pagesDir = join(work, 'pages');
mkdirSync(pagesDir, { recursive: true });
const pageNames = cases.map((c) => {
  const name = `${c.dir.split(sep).pop()}.png`;
  if (!existsSync(join(pagesDir, name))) copyFileSync(join(c.dir, 'report.png'), join(pagesDir, name));
  return name;
});
const readings = await readWithOcr(pagesDir, pageNames, join(work, 'ocr-cache.json'), WORKERS);
const tally = { texts: 0, matched: 0, band: 0, role: 0, both: 0, first: 0, firstBoth: 0, footerTotals: 0, footerTotalsRight: 0 };
const byBand: Record<string, { n: number; right: number }> = {};
const byRole: Record<string, { n: number; right: number }> = {};
const bandConfusion = new Map<string, number>();
const roleConfusion = new Map<string, number>();
let banded = 0;
for (const [ci, c] of cases.entries()) {
  const ocr = readings[pageNames[ci]];
  if (!ocr) continue;
  const render = JSON.parse(readFileSync(join(c.dir, 'render.json'), 'utf8')) as { pages: { size: [number, number]; bricks: Brick[] }[] };
  const page = render.pages[0];
  if (!page) continue;
  // Bricks are in 1/300 inch: scale them to the page in hundredths of an inch.
  const sx = 100 / 300;
  const sy = 100 / 300;
  const bricks = absolute(page.bricks).filter((b) => b.text?.trim() && b.owner && c.names.has(b.owner));
  // A brick's appearance: the first brick a control printed is its first appearance.
  const seen = new Map<string, number>();
  const instance = [...bricks].sort((a, b) => a.r[1] - b.r[1]).map((b) => {
    const n = seen.get(b.owner!) ?? 0;
    seen.set(b.owner!, n + 1);
    return { b, first: n === 0 };
  });
  const read = { ...ocr, dpi: 96 };
  const layout = detectLayout([{ ocr: read, page: pageForImage(read, 'HundredthsOfAnInch', 'Letter') }], { unit: 'HundredthsOfAnInch' }).pages[0];
  if (!layout) continue;
  const { reading, coverage } = readDetectedPage(model, layout, RULES);
  if (coverage.lost <= 0.15 * coverage.texts) banded++;
  const cells = layout.tables.flatMap((t) => t.rows.flatMap((r) => r.cells.filter((x): x is NonNullable<typeof x> => !!x)));
  const found = [...layout.labels, ...cells];
  const lineOf = new Map<number, number>();
  reading.lines.forEach((l, li) => l.boxes.forEach((k) => lineOf.set(k, li)));
  const truthOf = new Map<number, Truth>();
  found.forEach((t, k) => {
    tally.texts++;
    const ink = t.ink;
    let best: { b: Brick; first: boolean } | null = null;
    let most = 0;
    for (const x of instance) {
      const [bx, by, bw, bh] = [x.b.r[0] * sx, x.b.r[1] * sy, x.b.r[2] * sx, x.b.r[3] * sy];
      const ix = Math.min(ink.x + ink.w, bx + bw) - Math.max(ink.x, bx);
      const iy = Math.min(ink.y + ink.h, by + bh) - Math.max(ink.y, by);
      const a = ix > 0 && iy > 0 ? ix * iy : 0;
      if (a > most) {
        most = a;
        best = x;
      }
    }
    if (!best || most < 0.3 * ink.w * ink.h) return;
    const truth = c.names.get(best.b.owner!)!;
    if (truth.role === 'decoration') return;
    tally.matched++;
    const band = reading.bands[lineOf.get(k)!];
    const role = reading.roles[k];
    const bandOk = band === truth.band;
    const roleOk = role === truth.role;
    if (bandOk) tally.band++;
    if (roleOk) tally.role++;
    if (bandOk && roleOk) tally.both++;
    if (best.first) {
      tally.first++;
      if (bandOk && roleOk) tally.firstBoth++;
    }
    if (truth.role === 'total' && ['GroupFooter', 'ReportFooter', 'PageFooter'].includes(truth.band)) {
      tally.footerTotals++;
      if (bandOk && roleOk) tally.footerTotalsRight++;
    }
    truthOf.set(k, truth);
    if (!bandOk) bandConfusion.set(`${truth.band} -> ${band}`, (bandConfusion.get(`${truth.band} -> ${band}`) ?? 0) + 1);
    if (!roleOk) roleConfusion.set(`${truth.role} -> ${role}`, (roleConfusion.get(`${truth.role} -> ${role}`) ?? 0) + 1);
    (byBand[truth.band] ??= { n: 0, right: 0 }).n++;
    if (bandOk) byBand[truth.band].right++;
    (byRole[truth.role] ??= { n: 0, right: 0 }).n++;
    if (roleOk) byRole[truth.role].right++;
  });
  // `--dump`: each line's structure, its words masked to their character
  // classes, so the shapes the reader misreads can be studied with nothing a
  // report says kept. Written in the work folder, outside the repository.
  if (dumpFile) {
    const mask = (s: string) => (/^[-+(]?[$€£₹]?\s?\d[\d.,\s]*%?\)?$/.test(s.trim()) ? '9' : /\d/.test(s) ? (/\p{L}/u.test(s) ? 'A9' : '9x') : /\p{Lu}/u.test(s.trim()[0] ?? '') ? 'A' : 'a');
    for (const [li, l] of reading.lines.entries()) {
      const truths = l.boxes.map((k) => truthOf.get(k)).filter((t): t is Truth => !!t);
      const counts = new Map<string, number>();
      for (const t of truths) counts.set(t.band, (counts.get(t.band) ?? 0) + 1);
      const truthBand = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-';
      dumpRows.push(JSON.stringify({
        page: ci,
        line: li,
        texts: l.boxes.length,
        shape: l.boxes.map((k) => `${mask(found[k].text)}@${Math.round(found[k].ink.x / 10)}`).join(' '),
        band: reading.bands[li],
        truth: truthBand,
        roles: l.boxes.map((k) => reading.roles[k]).join(','),
        truthRoles: l.boxes.map((k) => truthOf.get(k)?.role ?? '-').join(','),
      }));
    }
  }
}
if (dumpFile) writeFileSync(dumpFile, dumpRows.join('\n'));

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
console.log('');
console.log(`== real reports, printed by DevExpress and read by OCR (${cases.length} pages)`);
console.log(`texts read: ${tally.texts}; on a printed text: ${tally.matched}`);
console.log(`band right ${pct(tally.band, tally.matched)}, role right ${pct(tally.role, tally.matched)}, both ${pct(tally.both, tally.matched)}`);
console.log(`in each control's first appearance: both right ${pct(tally.firstBoth, tally.first)} of ${tally.first}`);
console.log(`footer totals right in band and role: ${pct(tally.footerTotalsRight, tally.footerTotals)} of ${tally.footerTotals}`);
console.log(`by band: ${Object.entries(byBand).map(([b, x]) => `${b} ${pct(x.right, x.n)} of ${x.n}`).join(', ')}`);
console.log(`by role: ${Object.entries(byRole).map(([r, x]) => `${r} ${pct(x.right, x.n)} of ${x.n}`).join(', ')}`);
console.log(`pages the app would build banded: ${banded} of ${cases.length}; the rest as OCR's copy`);
const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, n]) => `${k} ${n}`).join(', ');
console.log(`commonest band errors: ${top(bandConfusion)}`);
console.log(`commonest role errors: ${top(roleConfusion)}`);
