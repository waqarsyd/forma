/**
 * Training pages for Forma's box reader, printed by DevExpress (2026-11-04,
 * docs/proposals/own-model.md, *The box reader on real reports*).
 *
 *   npx tsx scripts/model/printed.ts --skeletons <dir> [--skeletons <dir>] --out <dir> [--limit 1200] [--variants 2] [--workers 4]
 *
 * Every page the reader had trained on was drawn by render.py. Scored on the
 * company's own reports printed by DevExpress (realScore.ts) it put 55.8% of
 * texts in the right band with the right role, where it put 85.8% of drawn
 * pages right: group headers and footers read as records, names in records
 * read as captions, and text in the bottom margin read as the page footer.
 * This prints pages the way those were printed, from the same skeletons the
 * drawn pages came from:
 * - **A report from each skeleton** (`skeletonToDesign`), its captions given
 *   ordinary report words from the lists below and its title a made-up one.
 *   No report's words are used anywhere: skeletons hold structure only.
 * - **Made-up rows**: a number for a value aligned right, a date for some
 *   narrow ones, a name, code or word otherwise; three to forty records, in
 *   groups of one to eight when the report groups.
 * - **Printed** by `tools/RepxProbe render` at 100 pixels to the inch, a
 *   pixel to a hundredth as render.py draws, page 1 only.
 * - **Labelled from the bricks**, as realScore.ts scores (printedTruth.ts):
 *   each printed text's band and role are its control's.
 * The output is a folder `boxes.ts --data` reads like render.py's: a
 * labels.jsonl and the pages. `--variants` prints each skeleton that many
 * times with other words and rows, all under the skeleton's id, so they stay
 * on one side of the validation split.
 *
 * Use skeletons that are not the reports scored on: the Crystal ones
 * (crystal.ps1) when realScore.ts scores the .repx reports. `--out` must be
 * outside the repository.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { parseReportStructure } from '../../src/lib/reportPreview';
import type { ReportSkeleton } from '../../src/lib/reportSkeleton';
import { skeletonToDesign } from '../../src/lib/skeletonRepx';
import { absolute, truthOf, type Brick } from './printedTruth';

const argv = process.argv.slice(2);
const valuesOf = (flag: string) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
const valueOf = (flag: string) => valuesOf(flag)[0];
const skeletonDirs = valuesOf('--skeletons');
const outDir = valueOf('--out');
const LIMIT = Number(valueOf('--limit') ?? 1200);
const VARIANTS = Number(valueOf('--variants') ?? 2);
const WORKERS = Number(valueOf('--workers') ?? 4);
const PROBE = resolve('tools/RepxProbe/bin/Release/RepxProbe.exe');

if (!skeletonDirs.length || !outDir) {
  console.error('Usage: npx tsx scripts/model/printed.ts --skeletons <dir> --out <dir> [--limit 1200] [--variants 2] [--workers 4]');
  process.exit(2);
}
if (resolve(outDir).startsWith(resolve('.') + sep)) {
  console.error('--out must be outside the repository.');
  process.exit(2);
}

// Ordinary report words, nobody's in particular.
const CAPTIONS = [
  'Date', 'No.', 'Invoice No', 'Ref No', 'Voucher', 'Customer', 'Supplier', 'Account', 'Account Name', 'Description', 'Item', 'Item Code',
  'Qty', 'Quantity', 'Unit', 'Rate', 'Price', 'Amount', 'Debit', 'Credit', 'Balance', 'Tax', 'VAT', 'Discount', 'Net Amount', 'Remarks',
  'Branch', 'Department', 'Employee', 'Designation', 'Code', 'Name', 'Status', 'Due Date', 'Period', 'Currency', 'Opening', 'Closing',
  'Received', 'Paid', 'Location', 'Category', 'Project', 'Cost Centre', 'Reference', 'Particulars', 'Narration', 'Phone', 'Address',
];
const TOTALS = ['Total', 'Grand Total', 'Sub Total', 'Total Amount', 'Net Total', 'Group Total'];
const TITLES = ['Sales Register', 'Customer Statement', 'Stock Summary', 'Purchase Register', 'Ledger Report', 'Payroll Summary', 'Invoice', 'Aging Report', 'Trial Balance', 'Delivery Note', 'Expense Report', 'Receipt Voucher'];
const NAMES = ['Ahmed', 'Priya', 'John', 'Maria', 'Chen', 'Fatima', 'Ravi', 'Sara', 'Omar', 'Li', 'Anna', 'Yusuf', 'Kiran', 'David', 'Noor'];
const SURNAMES = ['Khan', 'Sharma', 'Smith', 'Garcia', 'Wang', 'Ali', 'Patel', 'Brown', 'Hassan', 'Lee', 'Silva', 'Das', 'Rahman', 'Jones'];
const WORDS = ['Office supplies', 'Freight', 'Consulting', 'Spare parts', 'Maintenance', 'Rent', 'Fuel', 'Printing', 'Software', 'Cement', 'Steel', 'Cables', 'Paint', 'Tiles', 'Pipes'];

/** A generator seeded from a string, so a variant prints the same every run. */
function seeded(key: string) {
  let s = createHash('sha1').update(key).digest().readUInt32LE(0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

type Kind = 'number' | 'integer' | 'date' | 'name' | 'code' | 'word';

/** Characters that fit a box `width` hundredths wide at a report's usual 8 to 10pt. */
const charsIn = (width: number) => Math.max(1, Math.floor(width / 7));

/** A field's kind from how its value is drawn, right aligned being a number, and how many characters its box holds. */
function kindsOf(xml: string, fields: readonly string[], rand: () => number): Map<string, { kind: Kind; chars: number }> {
  const s = parseReportStructure(xml);
  const align = new Map<string, { align: string; width: number }>();
  for (const b of s.bands)
    for (const c of b.controls) {
      if (c.field) align.set(c.field, { align: c.align, width: c.width });
      const rows = c.rows ?? [];
      for (const r of rows) {
        const sum = r.cells.reduce((t, cell) => t + (cell.weight || 1), 0) || 1;
        for (const cell of r.cells) if (cell.field) align.set(cell.field, { align: cell.align, width: (c.width * (cell.weight || 1)) / sum });
      }
    }
  const out = new Map<string, { kind: Kind; chars: number }>();
  for (const f of fields) {
    const a = align.get(f);
    const chars = charsIn(a?.width ?? 100);
    if (a?.align === 'right') out.set(f, { kind: rand() < 0.75 ? 'number' : 'integer', chars });
    else if (chars >= 8 && chars <= 16 && rand() < 0.4) out.set(f, { kind: 'date', chars });
    else out.set(f, { kind: (['name', 'code', 'word'] as const)[Math.floor(rand() * 3)], chars });
  }
  return out;
}

/**
 * A made-up value that fits `chars` characters, as a real report's values fit
 * their boxes. Dates are written as text, dd/MM/yyyy, because RepxProbe types
 * an ISO date as a DateTime and DevExpress then prints its time too.
 */
function valueOf2(kind: Kind, chars: number, rand: () => number): string | number {
  const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
  const fit = (s: string) => (s.length <= chars ? s : s.slice(0, chars).trimEnd());
  switch (kind) {
    case 'number': {
      const digits = Math.max(1, Math.min(chars - 3, 1 + Math.floor(rand() * 6)));
      return Math.round(rand() * 10 ** digits * 100) / 100;
    }
    case 'integer':
      return 1 + Math.floor(rand() * 10 ** Math.max(1, Math.min(chars, 1 + Math.floor(rand() * 3))));
    case 'date': {
      const d = String(1 + Math.floor(rand() * 28)).padStart(2, '0');
      const m = String(1 + Math.floor(rand() * 12)).padStart(2, '0');
      return chars >= 10 ? `${d}/${m}/2026` : `${d}/${m}`;
    }
    case 'name':
      return fit(chars >= 12 ? `${pick(NAMES)} ${pick(SURNAMES)}` : pick(NAMES));
    case 'code':
      return fit(`${pick(['INV', 'PO', 'GRN', 'AC', 'JV', 'SO'])}-${String(Math.floor(rand() * 99999)).padStart(5, '0')}`);
    default:
      return fit(pick(WORDS));
  }
}

/** A word from `words` that fits `chars`, the longest of a few tries; cut to fit when none does. */
function wordFor(words: readonly string[], chars: number, rand: () => number): string {
  const fitting = words.filter((w) => w.length <= chars);
  if (fitting.length) return fitting[Math.floor(rand() * fitting.length)];
  return words[Math.floor(rand() * words.length)].slice(0, chars);
}

/** The report a skeleton describes, with words and rows made up for this variant. */
function caseOf(k: ReportSkeleton, key: string): { repx: string; data: object; names: ReturnType<typeof truthOf>['names'] } {
  const rand = seeded(key);
  const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
  /*
   * Page information only where a page prints it: the headers, footers and
   * margins. The Crystal skeletons carry special fields (a record number, a
   * group's count) inside records as page information, and printed in their
   * narrow boxes as "Pag"; trained on them (printed-v1, 2026-11-04) the reader
   * took page numbers on real reports for values half the time.
   */
  const pageBands = new Set(['TopMargin', 'BottomMargin', 'PageHeader', 'PageFooter', 'ReportHeader', 'ReportFooter']);
  const cleaned: ReportSkeleton = { ...k, bands: k.bands.map((b) => (pageBands.has(b.kind) ? b : { ...b, controls: b.controls.filter((c) => c.role !== 'pageInfo') })) };
  const design = skeletonToDesign(cleaned, { title: pick(TITLES) });
  // Each caption a word that fits its box, as the report's own caption did.
  let repx = design.repx.replace(/<Item\d+\b[^>]*>/g, (tag) => {
    if (!/\sText="(Caption|Total)"/.test(tag)) return tag;
    const width = Number(/\sSizeF="([\d.]+)/.exec(tag)?.[1] ?? 60);
    const words = /\sText="Total"/.test(tag) ? TOTALS : CAPTIONS;
    return tag.replace(/\sText="(Caption|Total)"/, ` Text="${wordFor(words, charsIn(width), rand)}"`);
  });
  const truth = truthOf(repx);
  const kinds = kindsOf(repx, truth.fields, rand);
  const count = 3 + Math.floor(rand() * 38);
  const groupSize = 1 + Math.floor(rand() * 8);
  const member = truth.member || 'Data';
  const groupNames = Array.from({ length: Math.ceil(count / groupSize) }, (_, g) => `${pick(WORDS)} ${String.fromCharCode(65 + (g % 26))}`);
  const rows = Array.from({ length: count }, (_, r) =>
    Object.fromEntries([
      ...truth.fields.map((f) => {
        const k2 = kinds.get(f) ?? { kind: 'word' as Kind, chars: 12 };
        return [f.replace(/^.*\./, ''), valueOf2(k2.kind, k2.chars, rand)];
      }),
      ...truth.groups.map((g) => [g.replace(/^.*\./, ''), groupNames[Math.floor(r / groupSize)]]),
    ]),
  );
  if (!truth.member) repx = repx.replace(/<XtraReportsLayoutSerializer\b/, `<XtraReportsLayoutSerializer DataMember="${member}"`);
  return { repx, data: { dataMember: member, tables: { [member]: rows }, exports: ['png'], pngResolution: 100 }, names: truth.names };
}

/** Run RepxProbe on a case, at most `WORKERS` at once. */
function render(dir: string): Promise<boolean> {
  return new Promise((done) => {
    const child = spawn(PROBE, ['render', dir, dir], { stdio: 'ignore' });
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      done(code === 0 && existsSync(join(dir, 'render.json')) && existsSync(join(dir, 'report.png')));
    });
    child.on('error', () => {
      clearTimeout(timer);
      done(false);
    });
  });
}

// ------------------------------------------------------------- the skeletons
const files = skeletonDirs.flatMap((d) => readdirSync(resolve(d)).filter((f) => f.endsWith('.json')).map((f) => join(resolve(d), f))).sort();
const step = Math.max(1, files.length / LIMIT);
const chosen = Array.from({ length: Math.min(LIMIT, files.length) }, (_, i) => files[Math.floor(i * step)]);
const out = resolve(outDir);
const casesDir = join(out, 'cases');
mkdirSync(casesDir, { recursive: true });
console.log(`skeletons: ${files.length}, chosen ${chosen.length}, ${VARIANTS} variant(s) each`);

interface Job {
  id: string;
  image: string;
  dir: string;
  names: ReturnType<typeof truthOf>['names'];
}
const jobs: Job[] = [];
for (const file of chosen) {
  let k: ReportSkeleton;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { skeleton?: ReportSkeleton };
    if (!parsed.skeleton?.bands?.length) continue;
    k = parsed.skeleton;
  } catch {
    continue;
  }
  const id = `printed-${createHash('sha1').update(file).digest('hex').slice(0, 12)}`;
  for (let v = 0; v < VARIANTS; v++) {
    const dir = join(casesDir, `${id}-${v}`);
    mkdirSync(dir, { recursive: true });
    let made;
    try {
      made = caseOf(k, `${file}|${v}`);
    } catch {
      continue;
    }
    if (!existsSync(join(dir, 'render.json'))) {
      writeFileSync(join(dir, 'report.repx'), made.repx);
      writeFileSync(join(dir, 'data.json'), JSON.stringify(made.data));
    }
    jobs.push({ id, image: `${id}-${v}-0.png`, dir, names: made.names });
  }
}

let next = 0;
let printed = 0;
let failed = 0;
const todo = jobs.filter((j) => !existsSync(join(j.dir, 'render.json')));
await Promise.all(
  Array.from({ length: WORKERS }, async () => {
    while (next < todo.length) {
      const job = todo[next++];
      if (await render(job.dir)) printed++;
      else failed++;
      if ((printed + failed) % 100 === 0) console.log(`printed ${printed}, failed ${failed} of ${todo.length}`);
    }
  }),
);
console.log(`printed ${printed} new, ${failed} failed, ${jobs.length - todo.length} already printed`);

// ------------------------------------------------------------------ labels
const labels: string[] = [];
let texts = 0;
for (const job of jobs) {
  if (!existsSync(join(job.dir, 'render.json')) || !existsSync(join(job.dir, 'report.png'))) continue;
  const render = JSON.parse(readFileSync(join(job.dir, 'render.json'), 'utf8')) as { margins: number[]; pages: { size: [number, number]; bricks: Brick[] }[] };
  const page = render.pages[0];
  if (!page) continue;
  const seen = new Map<string, number>();
  const pageTexts = absolute(page.bricks)
    .filter((b) => b.text?.trim() && b.owner && job.names.has(b.owner) && job.names.get(b.owner)!.role !== 'decoration')
    .sort((a, b) => a.r[1] - b.r[1] || a.r[0] - b.r[0])
    .map((b) => {
      const truth = job.names.get(b.owner!)!;
      const instance = (seen.get(b.owner!) ?? 0) + 1;
      seen.set(b.owner!, instance);
      const box = b.r.map((n) => Math.round((n / 3) * 100) / 100) as [number, number, number, number];
      return { box, band: truth.band, instance, role: truth.role, text: b.text! };
    });
  if (!pageTexts.length) continue;
  copyFileSync(join(job.dir, 'report.png'), join(out, job.image));
  const [left, right, top, bottom] = render.margins;
  labels.push(JSON.stringify({ image: job.image, id: job.id, split: 'train', width: page.size[0] / 3, height: page.size[1] / 3, margins: { top, bottom, left, right }, texts: pageTexts }));
  texts += pageTexts.length;
}
writeFileSync(join(out, 'labels.jsonl'), labels.join('\n') + '\n');
console.log(`labels: ${labels.length} pages, ${texts} texts -> ${join(out, 'labels.jsonl')}`);
