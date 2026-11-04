/**
 * Forma's box reader (2026-11-04, docs/proposals/own-model.md): the band and
 * the role of each text OCR reads on a picture of a report page, from where
 * the texts sit and what kind of characters they hold. No picture, no GPU and
 * no AI: two small networks learned on this project's CPU from the drawn
 * skeletons, shipped as numbers.
 *
 * The owner chose it after the vision model, asked the same thing with OCR's
 * boxes, placed worse than OCR alone and put 23% of the boxes in the right
 * band. OCR already places the text; what it cannot tell is the structure.
 * - **Lines.** The texts are grouped into the lines they print on.
 * - **A band per line.** A network scores each line's band from its place on
 *   the page, its neighbours and whether it repeats; the bands are then
 *   decoded together in the order DevExpress prints them (`decodeBands`), so
 *   a page header never follows the records.
 * - **A role per text.** A second network scores each text's role from its
 *   place, its characters, its column and its line's band.
 * - **The skeleton.** `readerSkeleton` keeps the first appearance of each band
 *   and the first record, as a report's design holds them, with each text a
 *   control at the place OCR read it. `skeletonToDesign` (skeletonRepx.ts)
 *   makes that a report, with OCR's words in its titles and captions and its
 *   values bound to fields named after their captions.
 *
 * The features are written once, here, and the training script
 * (scripts/model/boxes.ts) calls the same functions, so training and the app
 * cannot read a page differently. Lengths are hundredths of an inch, from the
 * page's top left corner. Pure, so it runs under Node for training and tests.
 */
import type { DetectedPage, DetectedText } from './ocrLayout';
import { pointsToUnits } from './reportGeometry';
import type { BandKind } from './reportPreview';
import { paperName, type ReportSkeleton, type SkeletonBand, type SkeletonControl, type SkeletonRole } from './reportSkeleton';
import { lineWidthPt } from './textMeasure';

/** A text read on the page: where its ink is, and its words. */
export interface ReadBox {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

/** The bands a line can belong to, in the order DevExpress prints them. */
export const READER_BANDS = ['TopMargin', 'ReportHeader', 'PageHeader', 'GroupHeader', 'Detail', 'GroupFooter', 'ReportFooter', 'PageFooter', 'BottomMargin'] as const;
export type ReaderBand = (typeof READER_BANDS)[number];

/** The roles a text can play. A decoration prints no text, so OCR never reads one. */
export const READER_ROLES = ['title', 'caption', 'value', 'total', 'pageInfo'] as const;
export type ReaderRole = (typeof READER_ROLES)[number];

/** A one-hidden-layer network: inputs standardised, ReLU, then softmax. Weights row-major. */
export interface Mlp {
  inputs: number;
  hidden: number;
  outputs: number;
  mean: number[];
  scale: number[];
  w1: number[];
  b1: number[];
  w2: number[];
  b2: number[];
}

export interface BoxReaderModel {
  version: 1;
  bands: readonly string[];
  roles: readonly string[];
  lineFeatures: readonly string[];
  boxFeatures: readonly string[];
  lines: Mlp;
  boxes: Mlp;
  /** Log probabilities: of the first line's band, and of a line's band after the line above's. */
  start: number[];
  transitions: number[][];
  /**
   * How much the order counts against a line's own scores when decoding.
   * At full weight a record after a record is so likely that a page number
   * at the foot was decoded as one more; chosen on pages held out of training.
   */
  transitionWeight: number;
  trainedOn: { pages: number; lines: number; texts: number };
}

/** A line of print: the texts on it, left to right, and its extent. */
export interface BoxLine {
  boxes: number[];
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const median = (v: readonly number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * The lines the texts print on: a text joins the line its vertical middle
 * falls within, as `detectLayout`'s rows are made, so a tall title and the
 * caption beside it are one line.
 */
export function linesOf(boxes: readonly ReadBox[]): BoxLine[] {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].y + boxes[a].h / 2 - (boxes[b].y + boxes[b].h / 2));
  const lines: BoxLine[] = [];
  for (const i of order) {
    const b = boxes[i];
    const mid = b.y + b.h / 2;
    const line = lines[lines.length - 1];
    const lineMid = line ? (line.top + line.bottom) / 2 : 0;
    if (line && ((mid >= line.top && mid <= line.bottom) || (lineMid >= b.y && lineMid <= b.y + b.h))) {
      line.boxes.push(i);
      line.top = Math.min(line.top, b.y);
      line.bottom = Math.max(line.bottom, b.y + b.h);
      line.left = Math.min(line.left, b.x);
      line.right = Math.max(line.right, b.x + b.w);
    } else {
      lines.push({ boxes: [i], top: b.y, bottom: b.y + b.h, left: b.x, right: b.x + b.w });
    }
  }
  for (const l of lines) l.boxes.sort((a, b) => boxes[a].x - boxes[b].x);
  return lines;
}

/** What kind of characters a text holds. */
function charShares(text: string) {
  const t = text.replace(/\s+/g, '');
  const n = t.length || 1;
  const digits = (t.match(/\d/g) ?? []).length / n;
  const letters = (t.match(/\p{L}/gu) ?? []).length / n;
  const upper = (t.match(/\p{Lu}/gu) ?? []).length / Math.max(1, (t.match(/\p{L}/gu) ?? []).length);
  return { digits, letters, upper };
}

const NUMERIC = /^[-+(]?[$€£₹]?\s?\d[\d.,\s]*%?\)?$/;
const MONEY = /\d[.,]\d{2}\)?$/;
const DATE = /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/;
const PAGE_OF = /\d+\s*\/\s*\d+$|\b\d+\s+\D{1,4}\s+\d+$/;

/**
 * Two lines share a shape when they hold as many texts and their left or
 * right edges line up: records printing again, a column's values each a line.
 */
function sameShape(a: BoxLine, b: BoxLine, boxes: readonly ReadBox[]): boolean {
  if (a.boxes.length !== b.boxes.length) return false;
  let aligned = 0;
  for (let i = 0; i < a.boxes.length; i++) {
    const p = boxes[a.boxes[i]];
    const q = boxes[b.boxes[i]];
    if (Math.abs(p.x - q.x) <= 4 || Math.abs(p.x + p.w - (q.x + q.w)) <= 4) aligned++;
  }
  return aligned >= Math.max(1, Math.ceil(a.boxes.length * 0.7));
}

/**
 * Looser than `sameShape`, for telling a record printing again as OCR reads
 * it: OCR runs two texts together on one record and not the next, or misses
 * an empty one, so the counts may differ by a quarter (at least one) and the
 * texts are matched by place, not by order. Most of the shorter line's texts
 * must start or end where one of the other's does.
 */
function similarShape(a: BoxLine, b: BoxLine, boxes: readonly ReadBox[]): boolean {
  if (Math.abs(a.boxes.length - b.boxes.length) > Math.max(1, Math.floor(Math.max(a.boxes.length, b.boxes.length) / 4))) return false;
  const [short, long] = a.boxes.length <= b.boxes.length ? [a, b] : [b, a];
  const lined = short.boxes.filter((k) =>
    long.boxes.some((j) => Math.abs(boxes[k].x - boxes[j].x) <= 4 || Math.abs(boxes[k].x + boxes[k].w - (boxes[j].x + boxes[j].w)) <= 4),
  ).length;
  return lined >= Math.max(1, Math.ceil(short.boxes.length * 0.7));
}

export const LINE_FEATURES = [
  'top',
  'bottom',
  'fromContentTop',
  'toContentBottom',
  'position',
  'linesAbove',
  'linesBelow',
  'texts',
  'height',
  'tallest',
  'gapAbove',
  'gapBelow',
  'left',
  'right',
  'span',
  'repeats',
  'aboveRecords',
  'inRecords',
  'belowRecords',
  'likeAbove',
  'likeBelow',
  'digits',
  'letters',
  'numericTexts',
  'dates',
  'pageOf',
  'lines',
  'pageTallest',
  'recordAbove',
  'recordBelow',
  'toRecordsAbove',
  'toRecordsBelow',
  'inRecordColumns',
] as const;

/** Each line's features, in LINE_FEATURES order. */
export function lineFeatures(page: { width: number; height: number }, boxes: readonly ReadBox[], lines: readonly BoxLine[]): number[][] {
  const W = page.width || 1;
  const H = page.height || 1;
  const mh = Math.max(1, median(boxes.map((b) => b.h)));
  const maxH = Math.max(1, ...boxes.map((b) => b.h));
  const n = lines.length;
  const contentTop = n ? lines[0].top : 0;
  const contentBottom = n ? lines[n - 1].bottom : H;
  const repeats = lines.map((l, i) => lines.reduce((s, m, j) => s + (j !== i && sameShape(l, m, boxes) ? 1 : 0), 0));
  const recordLines = lines.map((_, i) => i).filter((i) => repeats[i] >= 2);
  const firstRecord = recordLines.length ? recordLines[0] : -1;
  const lastRecord = recordLines.length ? recordLines[recordLines.length - 1] : -1;
  const isRecord = lines.map((_, i) => repeats[i] >= 2);
  // The records' columns, by their right edges: a total sits under one.
  const recordRights = recordLines.flatMap((i) => lines[i].boxes.map((k) => boxes[k].x + boxes[k].w));
  const toRecord = (i: number, dir: -1 | 1) => {
    for (let m = i + dir, d = 1; m >= 0 && m < lines.length && d <= 5; m += dir, d++) if (isRecord[m]) return d / 5;
    return 1.2;
  };
  return lines.map((l, i) => {
    const texts = l.boxes.map((k) => boxes[k].text);
    const shares = texts.map(charShares);
    const above = lines[i - 1];
    const below = lines[i + 1];
    const inColumns = l.boxes.filter((k) => recordRights.some((r) => Math.abs(r - (boxes[k].x + boxes[k].w)) <= 4)).length / l.boxes.length;
    return [
      l.top / H,
      l.bottom / H,
      (l.top - contentTop) / H,
      (contentBottom - l.bottom) / H,
      n > 1 ? i / (n - 1) : 0,
      Math.min(i, 10) / 10,
      Math.min(n - 1 - i, 10) / 10,
      Math.log1p(l.boxes.length),
      (l.bottom - l.top) / mh,
      Math.max(...l.boxes.map((k) => boxes[k].h)) / mh,
      above ? Math.min(10, (l.top - above.bottom) / mh) : 10,
      below ? Math.min(10, (below.top - l.bottom) / mh) : 10,
      l.left / W,
      l.right / W,
      (l.right - l.left) / W,
      Math.log1p(repeats[i]),
      firstRecord >= 0 && i < firstRecord ? 1 : 0,
      firstRecord >= 0 && i >= firstRecord && i <= lastRecord ? 1 : 0,
      lastRecord >= 0 && i > lastRecord ? 1 : 0,
      above && sameShape(l, above, boxes) ? 1 : 0,
      below && sameShape(l, below, boxes) ? 1 : 0,
      shares.reduce((s, c) => s + c.digits, 0) / shares.length,
      shares.reduce((s, c) => s + c.letters, 0) / shares.length,
      texts.filter((t) => NUMERIC.test(t.trim())).length / texts.length,
      texts.filter((t) => DATE.test(t)).length / texts.length,
      texts.some((t) => PAGE_OF.test(t.trim())) ? 1 : 0,
      Math.log1p(n),
      Math.max(...l.boxes.map((k) => boxes[k].h)) / maxH,
      i > 0 && isRecord[i - 1] ? 1 : 0,
      i + 1 < n && isRecord[i + 1] ? 1 : 0,
      toRecord(i, -1),
      toRecord(i, 1),
      isRecord[i] ? 0 : inColumns,
    ];
  });
}

export const BOX_FEATURES = [
  'x',
  'right',
  'centre',
  'width',
  'height',
  'pageTallest',
  'indexInLine',
  'firstInLine',
  'lastInLine',
  'textsInLine',
  'chars',
  'words',
  'digits',
  'letters',
  'upper',
  'numeric',
  'money',
  'date',
  'pageOf',
  'colon',
  'leftAligned',
  'rightAligned',
  'numericAbove',
  'textAbove',
  'numericBelow',
  'centred',
  'alignedInRecords',
  'sameInRecords',
  'differsInRecords',
  ...READER_BANDS.map((b) => `band${b}`),
  ...LINE_FEATURES.map((f) => `line_${f}`),
] as const;

/** Each text's features, in BOX_FEATURES order, given its line's band. */
export function boxFeatures(
  page: { width: number; height: number },
  boxes: readonly ReadBox[],
  lines: readonly BoxLine[],
  bands: readonly ReaderBand[],
  lineFeats: readonly number[][] = lineFeatures(page, boxes, lines),
): number[][] {
  const W = page.width || 1;
  const mh = Math.max(1, median(boxes.map((b) => b.h)));
  const maxH = Math.max(1, ...boxes.map((b) => b.h));
  const lineOf = new Array<number>(boxes.length).fill(-1);
  lines.forEach((l, li) => l.boxes.forEach((k) => (lineOf[k] = li)));
  // The lines shaped like each line: its record printing again, when it is one.
  const alike = lines.map((l, li) => lines.flatMap((m, mi) => (mi !== li && similarShape(l, m, boxes) ? [mi] : [])));
  const words = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const out = new Array<number[]>(boxes.length);
  lines.forEach((l, li) => {
    l.boxes.forEach((k, idx) => {
      const b = boxes[k];
      const t = b.text.trim();
      const c = charShares(t);
      let leftAligned = 0;
      let rightAligned = 0;
      for (let j = 0; j < boxes.length; j++) {
        if (lineOf[j] === li) continue;
        if (Math.abs(boxes[j].x - b.x) <= 3) leftAligned++;
        if (Math.abs(boxes[j].x + boxes[j].w - (b.x + b.w)) <= 3) rightAligned++;
      }
      // The nearest text above and below in the same column, within three lines.
      const near = (dir: -1 | 1) => {
        for (let m = li + dir; m >= 0 && m < lines.length && Math.abs(m - li) <= 3; m += dir) {
          const hit = lines[m].boxes.find((j) => Math.min(boxes[j].x + boxes[j].w, b.x + b.w) - Math.max(boxes[j].x, b.x) > 0);
          if (hit !== undefined) return boxes[hit].text.trim();
        }
        return null;
      };
      const up = near(-1);
      const down = near(1);
      const centre = b.x + b.w / 2;
      // The texts in its column on the lines shaped like its own. A caption
      // prints the same words on every record; a value changes.
      const column = alike[li].flatMap((m) =>
        lines[m].boxes.filter((j) => Math.abs(boxes[j].x - b.x) <= 4 || Math.abs(boxes[j].x + boxes[j].w - (b.x + b.w)) <= 4),
      );
      const same = column.filter((j) => words(boxes[j].text) === words(t)).length;
      out[k] = [
        b.x / W,
        (b.x + b.w) / W,
        centre / W,
        b.w / W,
        b.h / mh,
        b.h / maxH,
        l.boxes.length > 1 ? idx / (l.boxes.length - 1) : 0,
        idx === 0 ? 1 : 0,
        idx === l.boxes.length - 1 ? 1 : 0,
        Math.log1p(l.boxes.length),
        Math.log1p(t.length),
        Math.log1p(t.split(/\s+/).filter(Boolean).length),
        c.digits,
        c.letters,
        c.upper,
        NUMERIC.test(t) ? 1 : 0,
        MONEY.test(t) ? 1 : 0,
        DATE.test(t) ? 1 : 0,
        PAGE_OF.test(t) ? 1 : 0,
        /:\s*$/.test(t) ? 1 : 0,
        Math.log1p(leftAligned),
        Math.log1p(rightAligned),
        up !== null && NUMERIC.test(up) ? 1 : 0,
        up !== null && !NUMERIC.test(up) ? 1 : 0,
        down !== null && NUMERIC.test(down) ? 1 : 0,
        Math.abs(centre - W / 2) / W < 0.05 ? 1 : 0,
        Math.log1p(column.length),
        column.length ? same / column.length : 0,
        column.length && same < column.length ? 1 : 0,
        ...READER_BANDS.map((band) => (bands[li] === band ? 1 : 0)),
        ...lineFeats[li],
      ];
    });
  });
  return out;
}

/** The network's probabilities for one input. */
export function mlpProbs(m: Mlp, x: readonly number[]): number[] {
  const h = new Array<number>(m.hidden);
  for (let j = 0; j < m.hidden; j++) {
    let s = m.b1[j];
    const row = j * m.inputs;
    for (let i = 0; i < m.inputs; i++) s += m.w1[row + i] * ((x[i] - m.mean[i]) / m.scale[i]);
    h[j] = s > 0 ? s : 0;
  }
  const z = new Array<number>(m.outputs);
  let max = -Infinity;
  for (let k = 0; k < m.outputs; k++) {
    let s = m.b2[k];
    const row = k * m.hidden;
    for (let j = 0; j < m.hidden; j++) s += m.w2[row + j] * h[j];
    z[k] = s;
    if (s > max) max = s;
  }
  let sum = 0;
  for (let k = 0; k < m.outputs; k++) {
    z[k] = Math.exp(z[k] - max);
    sum += z[k];
  }
  return z.map((v) => v / sum);
}

/**
 * The most likely bands for the lines, top to bottom (Viterbi): each line's
 * own scores, and how likely each band is to follow the band above it,
 * weighted by `weight`.
 */
export function decodeBands(scores: readonly number[][], start: readonly number[], transitions: readonly number[][], weight = 1): number[] {
  const n = scores.length;
  if (!n) return [];
  const K = start.length;
  const log = (p: number) => Math.log(Math.max(p, 1e-9));
  let best = start.map((s, k) => weight * s + log(scores[0][k]));
  const back: number[][] = [];
  for (let i = 1; i < n; i++) {
    const next = new Array<number>(K);
    const from = new Array<number>(K);
    for (let k = 0; k < K; k++) {
      let top = -Infinity;
      let arg = 0;
      for (let j = 0; j < K; j++) {
        const v = best[j] + weight * transitions[j][k];
        if (v > top) {
          top = v;
          arg = j;
        }
      }
      next[k] = top + log(scores[i][k]);
      from[k] = arg;
    }
    back.push(from);
    best = next;
  }
  let k = best.indexOf(Math.max(...best));
  const path = [k];
  for (let i = n - 2; i >= 0; i--) {
    k = back[i][k];
    path.unshift(k);
  }
  return path;
}

/** What the reader made of a page: its lines, each line's band and each text's role. */
export interface BoxReading {
  lines: BoxLine[];
  bands: ReaderBand[];
  roles: ReaderRole[];
}

export function readBoxes(model: BoxReaderModel, page: { width: number; height: number }, boxes: readonly ReadBox[], settle = true): BoxReading {
  const lines = linesOf(boxes);
  const lf = lineFeatures(page, boxes, lines);
  const bands = decodeBands(
    lf.map((x) => mlpProbs(model.lines, x)),
    model.start,
    model.transitions,
    model.transitionWeight,
  ).map((k) => model.bands[k] as ReaderBand);
  const bf = boxFeatures(page, boxes, lines, bands, lf);
  const roles = bf.map((x) => {
    const p = mlpProbs(model.boxes, x);
    return model.roles[p.indexOf(Math.max(...p))] as ReaderRole;
  });
  return settle ? settleRecords(boxes, { lines, bands, roles }) : { lines, bands, roles };
}

const HEADER_BANDS: readonly ReaderBand[] = ['ReportHeader', 'PageHeader', 'GroupHeader'];

/**
 * Column headings are not a record (settled after the networks, 2026-11-04).
 * Headings line up with the columns under them, so on the plainest listing
 * there is, a row of headings over records, they read as one more record and
 * the design printed the headings once per record with no field bound. The
 * page states the difference plainly: the line that opens a run of records
 * holds no digit, while the next line holds one in a column under it. That
 * line joins the header band above it, or the page header, and its texts
 * are captions. Text, not the networks' roles, decides, because the role
 * network reads a text in a record as a value.
 */
export function settleRecords(boxes: readonly ReadBox[], reading: BoxReading): BoxReading {
  const { lines } = reading;
  const bands = [...reading.bands];
  const roles = [...reading.roles];
  const digit = (k: number) => /\d/.test(boxes[k].text);
  const under = (k: number, li: number) =>
    lines[li].boxes.filter((j) => Math.min(boxes[j].x + boxes[j].w, boxes[k].x + boxes[k].w) - Math.max(boxes[j].x, boxes[k].x) > 0);
  for (let i = 0; i + 1 < lines.length; i++) {
    if (bands[i] !== 'Detail' || (i > 0 && bands[i - 1] === 'Detail') || bands[i + 1] !== 'Detail') continue;
    const heading = lines[i].boxes.every((k) => !digit(k) && /\p{L}/u.test(boxes[k].text));
    const numbersUnder = lines[i].boxes.some((k) => under(k, i + 1).some(digit));
    if (!heading || !numbersUnder || lines[i].boxes.length < 2) continue;
    bands[i] = i > 0 && HEADER_BANDS.includes(bands[i - 1]) ? bands[i - 1] : 'PageHeader';
    for (const k of lines[i].boxes) roles[k] = 'caption';
  }
  // A second rule, that a caption whose column reads differently on the next
  // record is a value, was measured and left out: on the held-out pages it
  // took captions from 93.7% right to 77.4%, as group headers read as
  // records set their captions among the records' values.
  return { lines, bands, roles };
}

/** Bands whose appearances repeat down a page; a design keeps the first. */
const REPEATING: readonly ReaderBand[] = ['GroupHeader', 'Detail', 'GroupFooter'];
/** Bands stacked from the top margin down, as DevExpress prints the first page. */
const STACKED: readonly ReaderBand[] = ['ReportHeader', 'PageHeader', 'GroupHeader', 'Detail'];

/**
 * The lines a design keeps of each band kind: its first run down the page,
 * and of the records only the first.
 */
/**
 * Where the records in the run of lines i to j start, and how many lines
 * each takes: the first stretch of up to four lines, starting within the
 * run's first six, that the lines after it repeat for two more periods where
 * the run is long enough, one where it is not. One line merely resembling
 * the next is not a record printing again; a period is. Lines of one record
 * often share a shape (a caption and a value, then another), so every period
 * they allow is a candidate. The shortest under which every line holds a
 * text reading exactly as it did a period before wins, since a record's
 * captions print again word for word; without one, the shortest. Counting
 * matches instead picked four-line "records" from a listing of values only,
 * where a code recurs four lines apart by chance (2026-11-04, in the owner's
 * Chrome). Null when nothing repeats.
 */
function recordPeriod(lines: readonly BoxLine[], boxes: readonly ReadBox[], i: number, j: number): { start: number; period: number } | null {
  const words = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const sameWords = (q: number, p: number) =>
    lines[q].boxes.filter((k) =>
      lines[q - p].boxes.some(
        (m) => (Math.abs(boxes[m].x - boxes[k].x) <= 4 || Math.abs(boxes[m].x + boxes[m].w - (boxes[k].x + boxes[k].w)) <= 4) && words(boxes[m].text) === words(boxes[k].text),
      ),
    ).length;
  for (let s = i; s <= Math.min(i + 5, j); s++) {
    let shortest = 0;
    for (let p = 1; p <= 4 && s + 2 * p - 1 <= j; p++) {
      let again = true;
      let everyLine = true;
      for (let q = s + p; q <= Math.min(j, s + 3 * p - 1) && again; q++) {
        again = similarShape(lines[s + ((q - s) % p)], lines[q], boxes);
        everyLine = everyLine && sameWords(q, p) > 0;
      }
      if (!again) continue;
      if (everyLine) return { start: s, period: p };
      shortest ||= p;
    }
    if (shortest) return { start: s, period: shortest };
  }
  return null;
}

function firstAppearances(boxes: readonly ReadBox[], reading: BoxReading): Map<ReaderBand, number[]> {
  const { lines, bands } = reading;
  const kept = new Map<ReaderBand, number[]>();
  /**
   * The first record of a run of records (`recordPeriod`). Lines before it
   * that repeat nothing are a heading read as a record more often than a part
   * of every one, and are left out. The whole run when nothing repeats: one
   * record, as on a form.
   */
  const firstRecord = (i: number, j: number): number[] => {
    const r = recordPeriod(lines, boxes, i, j);
    return r ? Array.from({ length: r.period }, (_, d) => r.start + d) : Array.from({ length: j - i + 1 }, (_, d) => i + d);
  };
  let i = 0;
  while (i < lines.length) {
    const kind = bands[i];
    let j = i;
    while (j + 1 < lines.length && bands[j + 1] === kind) j++;
    if (!kept.has(kind)) {
      // Records repeat line after line; a group's header or footer is one run.
      kept.set(kind, kind === 'Detail' ? firstRecord(i, j) : Array.from({ length: j - i + 1 }, (_, d) => i + d));
    }
    i = j + 1;
  }
  return kept;
}

/**
 * How much of the page a design from this reading holds. Every text is kept
 * (in a band's first appearance), repeated (a record or group printing again,
 * shaped like a line kept of its band, which a design prints from data), or
 * lost: a line of a band that prints once seen a second time, or a line under
 * a repeating band shaped like none of its first. A form read as records
 * loses most of itself; `buildWithReader` builds OCR's copy instead then.
 */
export function readerCoverage(boxes: readonly ReadBox[], reading: BoxReading): { texts: number; kept: number; repeated: number; lost: number } {
  const kept = firstAppearances(boxes, reading);
  const keptLines = new Set([...kept.values()].flat());
  let k = 0;
  let repeated = 0;
  let lost = 0;
  reading.lines.forEach((l, i) => {
    const n = l.boxes.length;
    if (keptLines.has(i)) k += n;
    else if (REPEATING.includes(reading.bands[i]) && (kept.get(reading.bands[i]) ?? []).some((m) => similarShape(reading.lines[m], l, boxes))) repeated += n;
    else lost += n;
  });
  return { texts: boxes.length, kept: k, repeated, lost };
}

/** The share of a page's texts a design may lose before OCR's copy is the better build. */
export const READER_MAX_LOST = 0.15;

/** A box's place on the page and the font it was read at, for the control it becomes. */
export interface ControlPlace {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Points, when OCR estimated it. */
  fontSize?: number;
}

/**
 * The report's skeleton from a reading. Each band kind keeps its first
 * appearance, and a repeating band its first record: the lines from its
 * first down to the line before the first one shaped like it again. Each
 * text kept becomes a control at its place (`places`, the boxes themselves
 * when absent). Bands stack from the top margin as DevExpress prints them,
 * each running down to the next, so the controls stay where OCR read them;
 * the page footer and bottom margin sit at the page's foot. `margins` are the
 * page's when known; they shrink where a text was read inside them.
 */
export function readerSkeleton(
  page: { width: number; height: number; margins?: { top: number; bottom: number; left: number; right: number } },
  boxes: readonly ReadBox[],
  reading: BoxReading,
  places: readonly ControlPlace[] = boxes,
): ReportSkeleton {
  const { paper, landscape } = paperName(page.width, page.height);
  const given = page.margins ?? { top: 50, bottom: 50, left: 50, right: 50 };
  const { lines, bands, roles } = reading;
  const kept = firstAppearances(boxes, reading);

  const all = boxes.map((_, k) => places[k] ?? boxes[k]);
  const left = Math.max(0, Math.min(given.left, ...all.map((p) => p.x)));
  const right = Math.max(0, Math.min(given.right, ...all.map((p) => page.width - (p.x + p.w))));
  const lineTop = (li: number) => Math.min(...lines[li].boxes.map((k) => all[k].y));
  const lineBottom = (li: number) => Math.max(...lines[li].boxes.map((k) => all[k].y + all[k].h));

  const firstBody = lines.findIndex((_, li) => bands[li] !== 'TopMargin');
  const topMarginLines = kept.get('TopMargin') ?? [];
  const bodyTop = firstBody >= 0 ? lineTop(firstBody) : given.top;
  const top =
    topMarginLines.length && firstBody >= 0
      ? (Math.max(...topMarginLines.map(lineBottom)) + bodyTop) / 2
      : Math.max(0, Math.min(given.top, bodyTop - 2));

  const footerLines = kept.get('PageFooter') ?? [];
  const bottomLines = kept.get('BottomMargin') ?? [];
  const lastAbove = (li: number) => (li > 0 ? lineBottom(li - 1) : top);
  // A page footer as tall as its texts need: every pixel above them is taken from the records.
  const footerTop = footerLines.length ? Math.max(lastAbove(footerLines[0]), lineTop(footerLines[0]) - 2) : null;
  const footerEnd = footerLines.length ? Math.max(...footerLines.map(lineBottom)) : null;
  const bottomStart = bottomLines.length
    ? (Math.max(footerEnd ?? lastAbove(bottomLines[0]), lastAbove(bottomLines[0])) + lineTop(bottomLines[0])) / 2
    : Math.max(footerEnd !== null ? footerEnd + 2 : 0, page.height - given.bottom);
  const bottom = Math.max(0, page.height - bottomStart);

  const control = (k: number, bandTop: number): SkeletonControl => {
    const p = all[k];
    const role = roles[k] as SkeletonRole;
    const t = boxes[k].text.trim();
    const numeric = NUMERIC.test(t);
    const align = (role === 'value' || role === 'total') && numeric ? 'right' : role === 'title' && Math.abs(p.x + p.w / 2 - page.width / 2) < page.width * 0.05 ? 'center' : 'left';
    // A title prints bold, about a tenth wider than the face it was measured in.
    const w = role === 'title' ? p.w * 1.12 : p.w;
    return {
      kind: role === 'pageInfo' ? 'pageInfo' : 'label',
      role,
      x: Math.round((p.x - left) * 100) / 100,
      y: Math.round((p.y - bandTop) * 100) / 100,
      w: Math.round(w * 100) / 100,
      h: Math.round(p.h * 100) / 100,
      font: p.fontSize ? { family: 'Arial', size: p.fontSize, bold: role === 'title', italic: false } : null,
      align,
      borders: 0,
      chars: role === 'caption' || role === 'title' ? Math.min(200, t.length) : 0,
    };
  };
  const band = (kind: ReaderBand, lineIds: readonly number[], bandTop: number, height: number): SkeletonBand => ({
    kind: kind as BandKind,
    height: Math.max(0, Math.round(height * 100) / 100),
    groupFields: kind === 'GroupHeader' ? 1 : 0,
    controls: lineIds.flatMap((li) => lines[li].boxes.map((k) => control(k, bandTop))),
  });

  const out: SkeletonBand[] = [];
  out.push(band('TopMargin', topMarginLines, 0, top));
  // Headers and the first record, stacked from the top margin in the order
  // the page shows them, each running down to the next.
  const stacked = STACKED.filter((kind) => kept.has(kind)).sort((a, b) => kept.get(a)![0] - kept.get(b)![0]);
  let y = top;
  stacked.forEach((kind, s) => {
    const ids = kept.get(kind)!;
    const nextKind = stacked[s + 1];
    const last = ids[ids.length - 1];
    // To the next band's first line, or the next record's, or a little below its own.
    const following = nextKind ? lineTop(kept.get(nextKind)![0]) : last + 1 < lines.length && bands[last + 1] === kind ? lineTop(last + 1) : null;
    const end = Math.max(following ?? lineBottom(last) + 2, lineBottom(last));
    out.push(band(kind, ids, y, end - y));
    y = end;
  });
  // Footers that print where the records end: each at its own first line.
  for (const kind of ['GroupFooter', 'ReportFooter'] as const) {
    const ids = kept.get(kind);
    if (!ids) continue;
    const t = lineTop(ids[0]) - 2;
    out.push(band(kind, ids, t, Math.max(...ids.map(lineBottom)) + 2 - t));
  }
  if (footerLines.length && footerTop !== null) out.push(band('PageFooter', footerLines, footerTop, bottomStart - footerTop));
  out.push(band('BottomMargin', bottomLines, page.height - bottom, bottom));

  return {
    paper,
    landscape,
    width: page.width,
    height: page.height,
    margins: { top: Math.round(top * 100) / 100, bottom: Math.round(bottom * 100) / 100, left: Math.round(left * 100) / 100, right: Math.round(right * 100) / 100 },
    bands: out,
  };
}

/**
 * A page OCR's layout detected (`detectLayout`, in hundredths of an inch),
 * read by the box reader: every label and table cell, its ink box and words
 * for the reading and its control box and font for the control it becomes.
 */
export function readDetectedPage(
  model: BoxReaderModel,
  page: DetectedPage,
): { skeleton: ReportSkeleton; reading: BoxReading; coverage: ReturnType<typeof readerCoverage> } {
  const cells = page.tables.flatMap((t) => t.rows.flatMap((r) => r.cells.filter((c): c is NonNullable<typeof c> => !!c)));
  const found = [...page.labels, ...cells];
  const boxes = found.map((t) => ({ ...t.ink, text: t.text }));
  const reading = readBoxes(model, page, boxes);
  const skeleton = readerSkeleton(page, boxes, reading, found.map(controlPlaceOf));
  return { skeleton, reading, coverage: readerCoverage(boxes, reading) };
}

/**
 * The control a text OCR read becomes: as wide as it was seen or as it prints
 * in Arial, whichever is wider, and a little more, as OCR's own build sizes a
 * label (`ocrControls`), so a word does not wrap in the Preview. Sized to the
 * ink alone, "Designation" printed as "Designatio" over "n". A number grows
 * to the left, where it is aligned. Hundredths of an inch.
 */
export function controlPlaceOf(t: DetectedText): ControlPlace {
  const inArial = pointsToUnits(lineWidthPt(t.text, { family: 'Arial', sizePt: t.fontSize, bold: false, italic: false }) ?? t.text.length * 0.6 * t.fontSize, 'HundredthsOfAnInch');
  const w = Math.max(t.w * 1.08, inArial * 1.04) + 4;
  const x = NUMERIC.test(t.text.trim()) ? t.x + t.w - w : t.x;
  return { x, y: t.y, w, h: t.h, fontSize: t.fontSize };
}

/** Where the browser fetches the shipped reader (MODEL_ASSETS in vite.config.ts). */
export const BOX_READER_URL = '/model/boxReader.json';

/** Whether a model reads the features this version computes, in the same order. */
export function readsTheseFeatures(model: BoxReaderModel): boolean {
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  return (
    model.version === 1 &&
    same(model.lineFeatures, LINE_FEATURES) &&
    same(model.boxFeatures, BOX_FEATURES) &&
    same(model.bands, READER_BANDS) &&
    same(model.roles, READER_ROLES) &&
    model.lines.inputs === LINE_FEATURES.length &&
    model.boxes.inputs === BOX_FEATURES.length &&
    typeof model.transitionWeight === 'number'
  );
}

let loading: Promise<BoxReaderModel> | null = null;

/** The shipped reader, fetched once per session; a failed fetch is tried again next time. */
export function loadBoxReader(): Promise<BoxReaderModel> {
  if (!loading) {
    loading = fetch(BOX_READER_URL).then(async (r) => {
      if (!r.ok) throw new Error(`Forma's box reader could not be loaded (HTTP ${r.status}).`);
      const model = (await r.json()) as BoxReaderModel;
      if (!readsTheseFeatures(model)) throw new Error("Forma's box reader is not one this version can read.");
      return model;
    });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}
