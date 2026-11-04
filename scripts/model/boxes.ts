/**
 * Train Forma's box reader on the CPU (2026-11-04, src/lib/boxReader.ts and
 * docs/proposals/own-model.md), and score it.
 *
 *   npx tsx scripts/model/boxes.ts --data <dir> [--read] [--workers 6] [--read-limit N] [--pages <dir>] [--out <file>] [--epochs 12] [--hidden 64]
 *
 * --data   folders holding labels.jsonl, as `python scripts/model/render.py
 *   <dir> --labels` writes it: every text drawn on every page, with its box,
 *   band and role. Searched one level down, so shards drawn in parallel are
 *   read together. Pages marked "eval" are held out.
 * --read   also read every training page drawn there with OCR, as the app
 *   would (ocrPages.ts, `--workers` at once, kept in each folder's
 *   ocr-cache.json), and train on what OCR read: each text takes the band
 *   and role of the drawn text it covers most. The first version, trained on
 *   the drawn boxes alone, was right about the band of 88% of texts with the
 *   drawn boxes and 75% with OCR's, and placed text worse than OCR alone.
 * --pages  the held-out pages drawn and read by OCR (evaluate.ts --pages
 *   made the folder and its ocr-cache.json). Each text OCR read there is
 *   given the band and role of the drawn text it lies on, and the reader is
 *   scored on OCR's boxes: what Forma will really give it. Beside it, on the
 *   page, OCR alone, as evaluate.ts scores it.
 * --out    where the model is written, `assets/model/boxReader.json` when
 *   given; without it the script only scores.
 *
 * Training texts are given as OCR would read them: each box a pixel off,
 * one in thirty missed, and texts on one line whose gap is narrower than
 * the line is tall run together, as `detectLayout` joins words. The labels
 * hold render.py's placeholder words, never a report's, so nothing here or in
 * the model is a report's words; the model holds numbers and the names of
 * its bands, roles and features.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  BOX_FEATURES,
  LINE_FEATURES,
  READER_BANDS,
  READER_MAX_LOST,
  READER_ROLES,
  readerCoverage,
  boxFeatures,
  controlPlaceOf,
  decodeBands,
  lineFeatures,
  linesOf,
  mlpProbs,
  readBoxes,
  readerSkeleton,
  type BoxReaderModel,
  type BoxReading,
  type ControlPlace,
  type Mlp,
  type ReadBox,
  type ReaderBand,
  type ReaderRole,
} from '../../src/lib/boxReader';
import { fixedPlaces, scorePlaces, textToSkeleton, type PagePlace } from '../../src/lib/skeletonText';
import type { OcrPage } from '../../src/lib/ocr';
import { detectLayout } from '../../src/lib/ocrLayout';
import { pageForImage } from '../../src/lib/reportGeometry';
import { paperName } from '../../src/lib/reportSkeleton';
import { readWithOcr } from './ocrPages';

const argv = process.argv.slice(2);
const valueOf = (flag: string) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : undefined);
const dataDir = valueOf('--data');
const pagesDir = valueOf('--pages');
const outFile = valueOf('--out');
const EPOCHS = Number(valueOf('--epochs') ?? 12);
const HIDDEN = Number(valueOf('--hidden') ?? 64);
const READ = argv.includes('--read');
const WORKERS = Number(valueOf('--workers') ?? 6);
/** The most training pages read by OCR in each folder: OCR runs at about a page a second. */
const READ_LIMIT = Number(valueOf('--read-limit') ?? Infinity);
/** Score this model instead of training one. */
const MODEL_FILE = valueOf('--model');
/** Score the networks' reading alone, before `settleRecords`. */
const RAW = argv.includes('--raw');
/** List the held-out pages where the reader found fewer texts than OCR alone, line by line. */
const WHY = argv.includes('--why');
const why: { lost: number; text: string }[] = [];
const lostShares: number[] = [];
if (!dataDir) {
  console.error('Usage: npx tsx scripts/model/boxes.ts --data <dir> [--pages <dir>] [--out <file>]');
  process.exit(2);
}

interface LabelText {
  box: [number, number, number, number];
  band: string | null;
  instance: number;
  role: string;
  text: string;
}
interface LabelPage {
  image: string;
  id: string;
  split: 'train' | 'eval';
  width: number;
  height: number;
  margins: { top: number; bottom: number; left: number; right: number };
  texts: LabelText[];
}

const readJsonl = <T>(path: string): T[] =>
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);

const labelFiles = (dir: string): string[] => {
  const here = join(dir, 'labels.jsonl');
  const subs = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(dir, d.name, 'labels.jsonl'))
    .filter(existsSync);
  return [...(existsSync(here) ? [here] : []), ...subs];
};

const BAND_OF: Record<string, ReaderBand> = { DetailReport: 'Detail', Unknown: 'ReportFooter' };
const bandOf = (b: string | null): ReaderBand => (b && (READER_BANDS as readonly string[]).includes(b) ? (b as ReaderBand) : BAND_OF[b ?? ''] ?? 'Detail');
const roleOf = (r: string): ReaderRole => ((READER_ROLES as readonly string[]).includes(r) ? (r as ReaderRole) : 'value');

// A seeded generator, so a run can be repeated exactly.
let seed = 20261104;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

/**
 * A page's texts with their labels. `known` is false for a text that has
 * none: something OCR read where nothing was drawn. `places` are the control
 * boxes OCR's layout gives each text, when it was read.
 */
interface Example {
  /** The layout drawn, so its pages stay together on one side of the validation split. */
  id: string;
  page: { width: number; height: number };
  boxes: ReadBox[];
  band: ReaderBand[];
  role: ReaderRole[];
  instance: number[];
  known: boolean[];
  places?: ControlPlace[];
  /** OCR's own boxes, unwidened, for scoring OCR alone as evaluate.ts does. */
  read?: ControlPlace[];
  margins?: { top: number; bottom: number; left: number; right: number };
}

/** The page as OCR read it, each text labelled by the drawn text it covers most. */
function exampleFromOcr(p: LabelPage, reading: OcrPage, paperHint?: string): Example {
  const named = paperName(p.width, p.height).paper;
  const paper = paperHint ?? (named === 'Custom' ? 'Letter' : named);
  const ocrPage = { ...reading, dpi: 100 };
  const layoutPage = detectLayout([{ ocr: ocrPage, page: pageForImage(ocrPage, 'HundredthsOfAnInch', paper) }], { unit: 'HundredthsOfAnInch' }).pages[0];
  const cells = layoutPage.tables.flatMap((t) => t.rows.flatMap((r) => r.cells.filter((c): c is NonNullable<typeof c> => !!c)));
  const found = [...layoutPage.labels, ...cells];
  const ex: Example = {
    id: p.id,
    page: { width: p.width, height: p.height },
    boxes: found.map((t) => ({ ...t.ink, text: t.text })),
    band: [],
    role: [],
    instance: [],
    known: [],
    // Sized as the app sizes them, so the page is scored as it will print.
    places: found.map(controlPlaceOf),
    read: found.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h })),
    margins: layoutPage.margins,
  };
  ex.boxes.forEach((b, k) => {
    let best = -1;
    let most = 0;
    p.texts.forEach((d, j) => {
      const ix = Math.min(b.x + b.w, d.box[0] + d.box[2]) - Math.max(b.x, d.box[0]);
      const iy = Math.min(b.y + b.h, d.box[1] + d.box[3]) - Math.max(b.y, d.box[1]);
      const a = ix > 0 && iy > 0 ? ix * iy : 0;
      if (a > most) {
        most = a;
        best = j;
      }
    });
    const ok = best >= 0 && most >= 0.3 * Math.min(b.w * b.h, p.texts[best].box[2] * p.texts[best].box[3]);
    ex.band[k] = ok ? bandOf(p.texts[best].band) : 'Detail';
    ex.role[k] = ok ? roleOf(p.texts[best].role) : 'value';
    ex.instance[k] = ok ? p.texts[best].instance : 1;
    ex.known[k] = ok;
  });
  return ex;
}

function exampleOf(p: LabelPage, noisy: boolean): Example {
  let items = p.texts.map((t) => ({
    box: { x: t.box[0], y: t.box[1], w: t.box[2], h: t.box[3], text: t.text } as ReadBox,
    band: bandOf(t.band),
    role: roleOf(t.role),
    instance: t.instance,
  }));
  if (noisy) {
    items = items
      .filter(() => rand() >= 1 / 30)
      .map((it) => {
        const j = () => Math.round((rand() - 0.5) * 3);
        return { ...it, box: { ...it.box, x: it.box.x + j(), y: it.box.y + j(), w: Math.max(1, it.box.w + j()), h: Math.max(1, it.box.h + j()) } };
      });
    // Texts on one line closer than the line is tall read as one.
    const lines = linesOf(items.map((it) => it.box));
    const merged: typeof items = [];
    for (const l of lines) {
      let cur = { ...items[l.boxes[0]], box: { ...items[l.boxes[0]].box } };
      for (const k of l.boxes.slice(1)) {
        const nb = items[k];
        const gap = nb.box.x - (cur.box.x + cur.box.w);
        if (gap <= 1.4 * Math.max(cur.box.h, nb.box.h) && rand() < 0.8) {
          const keep = nb.box.text.length > cur.box.text.length ? nb : cur;
          const x = Math.min(cur.box.x, nb.box.x);
          const y = Math.min(cur.box.y, nb.box.y);
          cur = {
            ...keep,
            box: { x, y, w: Math.max(cur.box.x + cur.box.w, nb.box.x + nb.box.w) - x, h: Math.max(cur.box.y + cur.box.h, nb.box.y + nb.box.h) - y, text: `${cur.box.text} ${nb.box.text}` },
          };
        } else {
          merged.push(cur);
          cur = { ...nb, box: { ...nb.box } };
        }
      }
      merged.push(cur);
    }
    items = merged;
  }
  return {
    id: p.id,
    page: { width: p.width, height: p.height },
    boxes: items.map((i) => i.box),
    band: items.map((i) => i.band),
    role: items.map((i) => i.role),
    instance: items.map((i) => i.instance),
    known: items.map(() => true),
    margins: p.margins,
  };
}

/** A line's band: the band most of its labelled texts were drawn in; -1 when none has a label. */
function lineLabels(ex: Example, lines: ReturnType<typeof linesOf>): number[] {
  return lines.map((l) => {
    const count = new Array(READER_BANDS.length).fill(0);
    for (const k of l.boxes) if (ex.known[k]) count[READER_BANDS.indexOf(ex.band[k])]++;
    const most = Math.max(...count);
    return most > 0 ? count.indexOf(most) : -1;
  });
}

/**
 * Train a network with Adam on cross-entropy, each class weighted by the
 * square root of how rare it is (at most five times): a page footer is one
 * line in thirty, and unweighted the network learned to call it a record.
 */
function train(xs: number[][], ys: number[], outputs: number, hidden: number, epochs: number, label: string): Mlp {
  const inputs = xs[0].length;
  const seen = new Array(outputs).fill(0);
  for (const y of ys) seen[y]++;
  const weight = seen.map((n) => (n ? Math.min(5, Math.max(0.5, Math.sqrt(ys.length / (outputs * n)))) : 1));
  console.log(`${label}: class weights ${weight.map((w) => w.toFixed(2)).join(' ')}`);
  const mean = new Array(inputs).fill(0);
  const scale = new Array(inputs).fill(0);
  for (const x of xs) for (let i = 0; i < inputs; i++) mean[i] += x[i] / xs.length;
  for (const x of xs) for (let i = 0; i < inputs; i++) scale[i] += (x[i] - mean[i]) ** 2 / xs.length;
  for (let i = 0; i < inputs; i++) scale[i] = Math.sqrt(scale[i]) || 1;
  const w1 = Array.from({ length: hidden * inputs }, () => gauss() * Math.sqrt(2 / inputs));
  const b1 = new Array(hidden).fill(0);
  const w2 = Array.from({ length: outputs * hidden }, () => gauss() * Math.sqrt(1 / hidden));
  const b2 = new Array(outputs).fill(0);
  const params = [w1, b1, w2, b2];
  const m1 = params.map((p) => new Array(p.length).fill(0));
  const m2 = params.map((p) => new Array(p.length).fill(0));
  const grads = params.map((p) => new Array(p.length).fill(0));
  const lr0 = 0.003;
  const batch = 128;
  let step = 0;
  const order = xs.map((_, i) => i);
  const z = xs.map((x) => x.map((v, i) => (v - mean[i]) / scale[i]));
  const h = new Array(hidden).fill(0);
  const p = new Array(outputs).fill(0);
  for (let epoch = 0; epoch < epochs; epoch++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const lr = lr0 * (epoch < epochs - 3 ? 1 : 0.3);
    let loss = 0;
    for (let s = 0; s < order.length; s += batch) {
      for (const g of grads) g.fill(0);
      const end = Math.min(order.length, s + batch);
      for (let b = s; b < end; b++) {
        const x = z[order[b]];
        const y = ys[order[b]];
        for (let j = 0; j < hidden; j++) {
          let v = b1[j];
          const row = j * inputs;
          for (let i = 0; i < inputs; i++) v += w1[row + i] * x[i];
          h[j] = v > 0 ? v : 0;
        }
        let max = -Infinity;
        for (let k = 0; k < outputs; k++) {
          let v = b2[k];
          const row = k * hidden;
          for (let j = 0; j < hidden; j++) v += w2[row + j] * h[j];
          p[k] = v;
          if (v > max) max = v;
        }
        let sum = 0;
        for (let k = 0; k < outputs; k++) {
          p[k] = Math.exp(p[k] - max);
          sum += p[k];
        }
        for (let k = 0; k < outputs; k++) p[k] /= sum;
        const wy = weight[y];
        loss -= wy * Math.log(Math.max(p[y], 1e-12));
        for (let k = 0; k < outputs; k++) {
          const d = wy * (p[k] - (k === y ? 1 : 0));
          grads[3][k] += d;
          const row = k * hidden;
          for (let j = 0; j < hidden; j++) grads[2][row + j] += d * h[j];
        }
        for (let j = 0; j < hidden; j++) {
          if (h[j] <= 0) continue;
          let d = 0;
          for (let k = 0; k < outputs; k++) d += wy * (p[k] - (k === y ? 1 : 0)) * w2[k * hidden + j];
          grads[1][j] += d;
          const row = j * inputs;
          for (let i = 0; i < inputs; i++) grads[0][row + i] += d * x[i];
        }
      }
      step++;
      const n = end - s;
      params.forEach((param, q) => {
        const g = grads[q];
        for (let i = 0; i < param.length; i++) {
          const gi = g[i] / n + (q === 0 || q === 2 ? 1e-5 * param[i] : 0);
          m1[q][i] = 0.9 * m1[q][i] + 0.1 * gi;
          m2[q][i] = 0.999 * m2[q][i] + 0.001 * gi * gi;
          const mh = m1[q][i] / (1 - 0.9 ** step);
          const vh = m2[q][i] / (1 - 0.999 ** step);
          param[i] -= (lr * mh) / (Math.sqrt(vh) + 1e-8);
        }
      });
    }
    console.error(`${label}: epoch ${epoch + 1}/${epochs}, loss ${(loss / order.length).toFixed(4)}`);
  }
  const r = (v: number) => Math.round(v * 1e5) / 1e5;
  return { inputs, hidden, outputs, mean: mean.map(r), scale: scale.map(r), w1: w1.map(r), b1: b1.map(r), w2: w2.map(r), b2: b2.map(r) };
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');

// ---------------------------------------------------------------- the data
const files = labelFiles(resolve(dataDir));
if (!files.length) {
  console.error(`No labels.jsonl in ${dataDir} or the folders in it. Draw them with render.py --labels.`);
  process.exit(2);
}
const pages = files.flatMap((f) => readJsonl<LabelPage>(f));
const trainPages = pages.filter((p) => p.split === 'train' && p.texts.length);
const evalPages = pages.filter((p) => p.split === 'eval' && p.texts.length);
console.log(`labels: ${pages.length} pages from ${files.length} file(s); train ${trainPages.length}, held out ${evalPages.length}`);

const model: BoxReaderModel = MODEL_FILE ? (JSON.parse(readFileSync(resolve(MODEL_FILE), 'utf8')) as BoxReaderModel) : await trainModel();
if (MODEL_FILE) console.log(`scoring ${MODEL_FILE} without training it`);

async function trainModel(): Promise<BoxReaderModel> {
const trainEx = trainPages.map((p) => exampleOf(p, true));
let readPages = 0;
if (READ) {
  // Each folder's training pages, read by OCR as the app reads a picture.
  for (const f of files) {
    const dir = join(f, '..');
    const here = readJsonl<LabelPage>(f)
      .filter((p) => p.split === 'train' && p.texts.length && existsSync(join(dir, p.image)))
      .slice(0, READ_LIMIT);
    const cache = await readWithOcr(
      dir,
      here.map((p) => p.image),
      join(dir, 'ocr-cache.json'),
      WORKERS,
    );
    for (const p of here) {
      if (!cache[p.image]) continue;
      trainEx.push(exampleFromOcr(p, cache[p.image]));
      readPages++;
    }
  }
}
// One layout in twenty is held out of training to choose the decoding's
// transition weight on, all its pages together.
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
const validation = trainEx.filter((ex) => Math.abs(hash(ex.id)) % 20 === 0);
const fitting = trainEx.filter((ex) => Math.abs(hash(ex.id)) % 20 !== 0);
trainEx.length = 0;
trainEx.push(...fitting);
const lineX: number[][] = [];
const lineY: number[] = [];
const counts = READER_BANDS.map(() => new Array(READER_BANDS.length).fill(0.1));
const starts = new Array(READER_BANDS.length).fill(0.1);
const trainLines = trainEx.map((ex) => {
  const lines = linesOf(ex.boxes);
  const feats = lineFeatures(ex.page, ex.boxes, lines);
  const labels = lineLabels(ex, lines);
  feats.forEach((f, i) => {
    if (labels[i] < 0) return;
    lineX.push(f);
    lineY.push(labels[i]);
  });
  const known = labels.filter((l) => l >= 0);
  if (known.length) starts[known[0]]++;
  for (let i = 1; i < known.length; i++) counts[known[i - 1]][known[i]]++;
  return { lines, feats, labels };
});
const texts = trainEx.reduce((s, e) => s + e.known.filter(Boolean).length, 0);
console.log(`training on ${trainEx.length} pages (${readPages} of them as OCR read them), ${lineX.length} lines and ${texts} texts`);

const lineNet = train(lineX, lineY, READER_BANDS.length, HIDDEN, EPOCHS, 'lines');
const startLog = starts.map((c) => Math.log(c / starts.reduce((a, b) => a + b, 0)));
const transLog = counts.map((row) => row.map((c) => Math.log(c / row.reduce((a: number, b: number) => a + b, 0))));

// The transition weight that decodes the held-out layouts best, OCR's readings
// first, by the mean of each band's accuracy: chosen on all lines together it
// was 1, because records are most of them, and a page number at the foot of a
// short listing was decoded as one more record.
const choosing = validation.some((ex) => ex.places) ? validation.filter((ex) => ex.places) : validation;
const scored = choosing.map((ex) => {
  const lines = linesOf(ex.boxes);
  return { scores: lineFeatures(ex.page, ex.boxes, lines).map((f) => mlpProbs(lineNet, f)), labels: lineLabels(ex, lines) };
});
let transitionWeight = 1;
let bestRight = -1;
const tried: string[] = [];
for (const w of [0.1, 0.2, 0.35, 0.5, 0.7, 1]) {
  const right = new Array(READER_BANDS.length).fill(0);
  const all = new Array(READER_BANDS.length).fill(0);
  for (const s of scored) {
    const path = decodeBands(s.scores, startLog, transLog, w);
    s.labels.forEach((l, i) => {
      if (l < 0) return;
      all[l]++;
      if (path[i] === l) right[l]++;
    });
  }
  const seenBands = all.map((_, k) => k).filter((k) => all[k] > 0);
  const balanced = seenBands.reduce((s, k) => s + right[k] / all[k], 0) / Math.max(1, seenBands.length);
  tried.push(`${w} ${pct(balanced, 1)}`);
  if (balanced > bestRight) {
    bestRight = balanced;
    transitionWeight = w;
  }
}
console.log(`transition weight ${transitionWeight}, on ${choosing.length} held-out training pages: ${tried.join(', ')}`);

// The roles are learned with the bands the reader itself decodes, as the app will have them.
const boxX: number[][] = [];
const boxY: number[] = [];
trainEx.forEach((ex, e) => {
  const { lines, feats } = trainLines[e];
  const bands = decodeBands(
    feats.map((f) => mlpProbs(lineNet, f)),
    startLog,
    transLog,
    transitionWeight,
  ).map((k) => READER_BANDS[k]);
  boxFeatures(ex.page, ex.boxes, lines, bands, feats).forEach((f, k) => {
    if (!ex.known[k]) return;
    boxX.push(f);
    boxY.push(READER_ROLES.indexOf(ex.role[k]));
  });
});
const boxNet = train(boxX, boxY, READER_ROLES.length, HIDDEN, EPOCHS, 'texts');

return {
  version: 1,
  bands: READER_BANDS,
  roles: READER_ROLES,
  lineFeatures: LINE_FEATURES,
  boxFeatures: BOX_FEATURES,
  lines: lineNet,
  boxes: boxNet,
  start: startLog.map((v) => Math.round(v * 1e4) / 1e4),
  transitions: transLog.map((row) => row.map((v) => Math.round(v * 1e4) / 1e4)),
  transitionWeight,
  trainedOn: { pages: trainEx.length, lines: lineX.length, texts },
};
}

// ---------------------------------------------------------------- scoring
interface Tally {
  lines: number;
  linesRight: number;
  linesArgmax: number;
  texts: number;
  band: number;
  role: number;
  both: number;
  firstTexts: number;
  firstBand: number;
  firstBoth: number;
  roleCounts: Record<string, { n: number; right: number }>;
  bandCounts: Record<string, { n: number; right: number }>;
  /** Texts put in the wrong band, by the right band and the one given. */
  confused: Record<string, number>;
  page: { expected: number; predicted: number; matched: number; found: number };
}
const tally = (): Tally => ({
  lines: 0,
  linesRight: 0,
  linesArgmax: 0,
  texts: 0,
  band: 0,
  role: 0,
  both: 0,
  firstTexts: 0,
  firstBand: 0,
  firstBoth: 0,
  roleCounts: {},
  bandCounts: {},
  confused: {},
  page: { expected: 0, predicted: 0, matched: 0, found: 0 },
});

/** Score one page's reading against its labels; `known` marks the texts that have labels. */
function scoreReading(t: Tally, ex: Example, reading: BoxReading, known: boolean[]) {
  const labels = lineLabels(ex, reading.lines);
  const feats = lineFeatures(ex.page, ex.boxes, reading.lines);
  reading.lines.forEach((l, i) => {
    if (!l.boxes.some((k) => known[k])) return;
    t.lines++;
    if (READER_BANDS[labels[i]] === reading.bands[i]) t.linesRight++;
    const p = mlpProbs(model.lines, feats[i]);
    if (p.indexOf(Math.max(...p)) === labels[i]) t.linesArgmax++;
  });
  const lineOf = new Array<number>(ex.boxes.length);
  reading.lines.forEach((l, i) => l.boxes.forEach((k) => (lineOf[k] = i)));
  ex.boxes.forEach((_, k) => {
    if (!known[k]) return;
    const band = reading.bands[lineOf[k]];
    const bandOk = band === ex.band[k];
    const roleOk = reading.roles[k] === ex.role[k];
    t.texts++;
    if (bandOk) t.band++;
    if (roleOk) t.role++;
    if (bandOk && roleOk) t.both++;
    if (ex.instance[k] === 0) {
      t.firstTexts++;
      if (bandOk) t.firstBand++;
      if (bandOk && roleOk) t.firstBoth++;
    }
    const rc = (t.roleCounts[ex.role[k]] ??= { n: 0, right: 0 });
    rc.n++;
    if (roleOk) rc.right++;
    const bc = (t.bandCounts[ex.band[k]] ??= { n: 0, right: 0 });
    bc.n++;
    if (bandOk) bc.right++;
    else t.confused[`${ex.band[k]} as ${band}`] = (t.confused[`${ex.band[k]} as ${band}`] ?? 0) + 1;
  });
}

function addPage(t: Tally, predicted: PagePlace[], truthTarget: string | undefined): number {
  const truth = truthTarget ? textToSkeleton(truthTarget).skeleton : null;
  if (!truth) return 0;
  const want = fixedPlaces(truth);
  const s = scorePlaces(predicted, want.places, want.regions);
  for (const k of ['expected', 'predicted', 'matched', 'found'] as const) t.page[k] += s[k];
  return s.found;
}

function report(label: string, t: Tally, extra: string[] = []) {
  console.log('');
  console.log(`== ${label}`);
  console.log(`lines: band right ${pct(t.linesRight, t.lines)} decoded in print order (${pct(t.linesArgmax, t.lines)} line by line), ${t.lines} lines`);
  console.log(`texts: band right ${pct(t.band, t.texts)}, role right ${pct(t.role, t.texts)}, both ${pct(t.both, t.texts)} (${t.texts} texts)`);
  console.log(`texts in each band's first appearance: band right ${pct(t.firstBand, t.firstTexts)}, band and role ${pct(t.firstBoth, t.firstTexts)} (${t.firstTexts})`);
  console.log(`by role: ${Object.entries(t.roleCounts).map(([r, c]) => `${r} ${pct(c.right, c.n)} of ${c.n}`).join(', ')}`);
  console.log(`by band: ${Object.entries(t.bandCounts).map(([b, c]) => `${b} ${pct(c.right, c.n)} of ${c.n}`).join(', ')}`);
  const confused = Object.entries(t.confused).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (confused.length) console.log(`most put in the wrong band: ${confused.map(([k, n]) => `${k} ${n}`).join(', ')}`);
  if (t.page.expected) console.log(`on the page (fixed bands): text found where it prints ${pct(t.page.found, t.page.expected)}; box right recall ${pct(t.page.matched, t.page.expected)}`);
  for (const line of extra) console.log(line);
}

// The held-out pages' skeleton texts, for the page-level score.
const targets = new Map<string, string>();
for (const f of files) {
  const evalFile = join(f, '..', 'eval.jsonl');
  if (existsSync(evalFile)) for (const r of readJsonl<{ image: string; target: string; truth?: string }>(evalFile)) targets.set(r.image, r.truth ?? r.target);
}
const evalLabels = new Map(evalPages.map((p) => [p.image, p]));

const exact = tally();
for (const p of evalPages.filter((q) => q.image.endsWith('-0.png'))) {
  const ex = exampleOf(p, false);
  const reading = readBoxes(model, ex.page, ex.boxes, !RAW);
  scoreReading(exact, ex, reading, ex.known);
  const k = readerSkeleton({ ...ex.page, margins: p.margins }, ex.boxes, reading);
  addPage(exact, fixedPlaces(k).places, targets.get(p.image));
}
const majorityBand = Object.entries(exact.bandCounts).sort((a, b) => b[1].n - a[1].n)[0]?.[0] ?? 'Detail';
report('held-out pages, the boxes as drawn', exact, [`(always ${majorityBand}: ${pct(exact.bandCounts[majorityBand]?.n ?? 0, exact.texts)} of texts)`]);

if (pagesDir) {
  const dir = resolve(pagesDir);
  const cache: Record<string, OcrPage> = JSON.parse(readFileSync(join(dir, 'ocr-cache.json'), 'utf8'));
  const evalRows = readJsonl<{ image: string; target: string }>(join(dir, 'eval.jsonl'));
  const ocr = tally();
  const alone = tally();
  /** OCR's own build: every text it read, its label sized as the reader's are. */
  const built = tally();
  let unmatched = 0;
  let read = 0;
  for (const row of evalRows) {
    const labels = evalLabels.get(row.image);
    const truth = textToSkeleton(row.target).skeleton;
    if (!labels || !truth || !cache[row.image]) continue;
    const ex = exampleFromOcr(labels, cache[row.image], truth.paper === 'Custom' ? 'Letter' : truth.paper);
    unmatched += ex.known.filter((k) => !k).length;
    read += ex.boxes.length;
    const reading = readBoxes(model, ex.page, ex.boxes, !RAW);
    scoreReading(ocr, ex, reading, ex.known);
    const k = readerSkeleton({ ...ex.page, margins: ex.margins }, ex.boxes, reading, ex.places);
    const cover = readerCoverage(ex.boxes, reading);
    lostShares.push(cover.texts ? cover.lost / cover.texts : 0);
    if (WHY && cover.lost > READER_MAX_LOST * cover.texts) {
      why.push({
        lost: 1000 + cover.lost,
        text: [
          `${row.image}: a design would lose ${cover.lost} of ${cover.texts} texts (kept ${cover.kept}, repeated ${cover.repeated})`,
          ...reading.lines.map((l, i) => {
            const right = lineLabels(ex, [l])[0];
            return `  ${String(Math.round(l.top)).padStart(4)} ${(right >= 0 ? READER_BANDS[right] : '?').padEnd(12)} ${reading.bands[i].padEnd(12)} ${l.boxes.length} texts`;
          }),
        ].join('\n'),
      });
    }
    const mine = addPage(ocr, fixedPlaces(k).places, row.target);
    const theirs = addPage(alone, (ex.read ?? []).map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h, text: true })), row.target);
    addPage(built, (ex.places ?? []).map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h, text: true })), row.target);
    if (WHY && theirs > mine) {
      // Where the reader found fewer texts than OCR alone: each line, its right band and the one given.
      why.push({
        lost: theirs - mine,
        text: [
          `${row.image}: OCR alone found ${theirs}, the reader ${mine}; bands ${k.bands.map((b) => `${b.kind} ${Math.round(b.height)}`).join(', ')}; margins ${JSON.stringify(k.margins)}`,
          ...reading.lines.map((l, i) => {
            const right = lineLabels(ex, [l])[0];
            const mark = right >= 0 && READER_BANDS[right] !== reading.bands[i] ? '  <-' : '';
            return `  ${String(Math.round(l.top)).padStart(4)} ${(right >= 0 ? READER_BANDS[right] : '?').padEnd(12)} ${reading.bands[i].padEnd(12)} ${l.boxes.length} texts${mark}`;
          }),
        ].join('\n'),
      });
    }
  }
  const sorted = [...lostShares].sort((a, b) => a - b);
  report(`held-out pages, OCR's boxes (${evalRows.length} pages, ${read} texts read, ${unmatched} on no drawn text)`, ocr, [
    `OCR alone, the same pages: text found where it prints ${pct(alone.page.found, alone.page.expected)}; box right recall ${pct(alone.page.matched, alone.page.expected)}`,
    `OCR's own build, labels sized as the reader's: text found where it prints ${pct(built.page.found, built.page.expected)}; box right recall ${pct(built.page.matched, built.page.expected)}`,
    `texts a design would lose, per page: median ${pct(sorted[Math.floor(sorted.length / 2)] ?? 0, 1)}, most ${pct(sorted[sorted.length - 1] ?? 0, 1)}; ` +
      `${sorted.filter((s) => s > READER_MAX_LOST).length} of ${sorted.length} pages over ${pct(READER_MAX_LOST, 1)}, which the app builds as OCR's copy instead`,
  ]);
  for (const w of why.sort((a, b) => b.lost - a.lost).slice(0, 6)) console.log(`\n${w.text}`);
}

if (outFile) {
  writeFileSync(resolve(outFile), `${JSON.stringify(model)}\n`);
  console.log(`\nwrote ${outFile}: ${model.lines.w1.length + model.lines.w2.length + model.boxes.w1.length + model.boxes.w2.length} weights`);
}
