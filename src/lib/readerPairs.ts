/**
 * The box reader learns from use (2026-11-12, Owner decision 20, the full
 * audit's D10; lib/boxReader.ts). It was learned from drawn pages and the
 * owner's own reports, and nothing it met in use ever reached it: when the AI
 * or the person put a text in another band, the reader went on reading such
 * pages as it always had. Now a picture request keeps the page's numeric
 * reading and a kept report labels it:
 *
 * - **On a picture request** (`pageReadingOf`), the first page as the reader
 *   saw it, in numbers only: each text's box (hundredths of an inch from the
 *   page's corner), the lines they make, each line's features
 *   (`LINE_FEATURES`) and each text's own (`BOX_FEATURES` up to its band's
 *   one-hot, which the networks' bands fill in), and what the shipped reader
 *   made of them. Features are numbers computed from where a text sits and
 *   what kind of characters it holds (how long it is, the share of digits,
 *   whether it reads as a figure or a date); **never a character of it**.
 *   Kept on the device with the generation's learning event, never sent.
 * - **When that report is kept** (`readerPairOf`), the band and role each text
 *   ended in, read off the kept report by position (`labelReading`): each of
 *   its bands is laid over the page where its texts' places best meet the
 *   boxes read there, a header or a margin near where it prints, a record or a
 *   group anywhere between, as often as it repeats; every line it covers must
 *   be mostly its own, since a line of print belongs to one band; and a text
 *   takes the band and role of the place it fell in. The pair goes with the
 *   `kept` learning event, in the structure tier, which the Learning switch
 *   turns off.
 * - **On the owner's PC**, `soundPair` rebuilds each pulled pair from its
 *   known keys and holds it to the reader's features, and `pairPage` and
 *   `pairRoleRows` turn it into the rows `scripts/model/boxes.ts --pairs`
 *   trains on beside the drawn pages.
 *
 * Pure, so the training script and the tests run it under Node.
 */
import {
  BOX_FEATURES,
  LINE_FEATURES,
  READER_BANDS,
  READER_ROLES,
  boxFeatures,
  contextFeatures,
  decodeBands,
  lineFeatures,
  linesOf,
  mlpProbs,
  readBoxes,
  type BoxLine,
  type BoxReaderModel,
  type BoxReading,
  type ReadBox,
  type ReaderBand,
} from './boxReader';
import type { DetectedPage } from './ocrLayout';
import type { ReportSkeleton, SkeletonBand } from './reportSkeleton';

/** How many of a text's features are its own, before its line's band and its line's features. */
export const BOX_OWN = BOX_FEATURES.indexOf(`band${READER_BANDS[0]}` as (typeof BOX_FEATURES)[number]);

/** FNV-1a over a text, as eight hex digits. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Which features a pair was read with: a pair read with others is no use to this reader, and is refused. */
export const FEATURE_SIGNATURE = fnv([LINE_FEATURES.join(','), BOX_FEATURES.join(','), READER_BANDS.join(','), READER_ROLES.join(',')].join('|'));

/** The most texts a page may have for its reading to be kept: a page past it is a listing whose pair would be too large. */
export const MAX_BOXES = 500;
/** The longest a pair may be, as JSON; firestore.rules holds the same number. */
export const MAX_PAIR_CHARS = 100_000;
/** The share of a page's texts the kept report must account for before the pair is worth sending. */
export const MIN_LABELLED = 0.5;

/** A page's numeric reading: never a character of its text. */
export interface PageReading {
  v: 1;
  features: string;
  /** Width and height, hundredths of an inch. */
  page: [number, number];
  /** Each text's ink box: x, y, width, height. */
  boxes: [number, number, number, number][];
  /** Each line's texts, left to right, by index. */
  lines: number[][];
  /** Each line's features, in LINE_FEATURES order. */
  lineFeatures: number[][];
  /** Each text's own features: BOX_FEATURES up to the band's one-hot. */
  boxFeatures: number[][];
  /** What the shipped reader made of it: each line's band and each text's role, as indexes. */
  readBand: number[];
  readRole: number[];
}

/** A reading with what the kept report says of each text: its band and role, as indexes, -1 for none. */
export interface ReaderPair extends PageReading {
  band: number[];
  role: number[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0);

/** The texts of a detected page in the order `readDetectedPage` reads them: labels, then each table's cells. */
function readBoxesOf(page: DetectedPage): ReadBox[] {
  const cells = page.tables.flatMap((t) => t.rows.flatMap((r) => r.cells.filter((c): c is NonNullable<typeof c> => !!c)));
  return [...page.labels, ...cells].map((t) => ({ ...t.ink, text: t.text }));
}

/** The bands the reader's networks decode for a page, before the rules settle them: what its role network is given. */
export function decodedBands(model: BoxReaderModel, boxes: readonly ReadBox[], lines: readonly BoxLine[], lf: readonly number[][]): ReaderBand[] {
  const first = lf.map((x) => mlpProbs(model.lines, x));
  const scores = model.context ? contextFeatures(lines, boxes, lf, first).map((x) => mlpProbs(model.context!, x)) : first;
  return decodeBands(scores, model.start, model.transitions, model.transitionWeight).map((k) => model.bands[k] as ReaderBand);
}

/**
 * A page's numeric reading, from the layout OCR detected and the reader's
 * reading of it (`readDetectedPage`'s, when given; read again otherwise).
 * Null for a page with no text, or more than `MAX_BOXES`.
 */
export function pageReadingOf(model: BoxReaderModel, page: DetectedPage, settled?: BoxReading): PageReading | null {
  const boxes = readBoxesOf(page);
  if (!boxes.length || boxes.length > MAX_BOXES) return null;
  const lines = linesOf(boxes);
  const lf = lineFeatures(page, boxes, lines);
  const bf = boxFeatures(page, boxes, lines, decodedBands(model, boxes, lines, lf), lf);
  const reading = settled && settled.roles.length === boxes.length ? settled : readBoxes(model, page, boxes);
  return {
    v: 1,
    features: FEATURE_SIGNATURE,
    page: [r1(page.width), r1(page.height)],
    boxes: boxes.map((b) => [r1(b.x), r1(b.y), r1(b.w), r1(b.h)]),
    lines: lines.map((l) => [...l.boxes]),
    lineFeatures: lf.map((row) => row.map(r3)),
    boxFeatures: bf.map((row) => row.slice(0, BOX_OWN).map(r3)),
    readBand: reading.bands.map((b) => READER_BANDS.indexOf(b)),
    readRole: reading.roles.map((r) => READER_ROLES.indexOf(r)),
  };
}

/* ---- Labelling a reading with the kept report ---- */

/** A place a band prints text at, relative to its top, and the role it prints. */
interface Place {
  x: number;
  y: number;
  w: number;
  h: number;
  role: number;
}

const TEXT_KINDS = new Set(['label', 'pageInfo', 'richText', 'checkbox']);

/** The places a band prints text at: each control's, each table cell's, never a decoration's. */
function placesOf(band: SkeletonBand, left: number): Place[] {
  const out: Place[] = [];
  const roleIndex = (role: string, chars: number) => (role === 'decoration' || (role === 'caption' && chars <= 0) ? -1 : READER_ROLES.indexOf(role as (typeof READER_ROLES)[number]));
  for (const c of band.controls) {
    if (c.kind === 'table') {
      const rows = c.rows ?? [];
      rows.forEach((row, ri) => {
        const rh = c.h / Math.max(1, rows.length);
        const total = row.reduce((s, cell) => s + Math.max(0.01, cell.weight), 0) || 1;
        let cx = left + c.x;
        for (const cell of row) {
          const cw = (c.w * Math.max(0.01, cell.weight)) / total;
          const role = roleIndex(cell.role, cell.chars);
          if (role >= 0) out.push({ x: cx, y: c.y + ri * rh, w: cw, h: rh, role });
          cx += cw;
        }
      });
    } else if (TEXT_KINDS.has(c.kind)) {
      const role = c.kind === 'pageInfo' ? READER_ROLES.indexOf('pageInfo') : roleIndex(c.role, c.chars);
      if (role >= 0) out.push({ x: left + c.x, y: c.y, w: c.w, h: c.h, role });
    }
  }
  return out;
}

/** A band laid over the page at one height: which text fell in which of its places. */
interface Instance {
  band: number;
  /** A header, a footer or a margin, which prints at one place: it wins a tie with a band that repeats. */
  fixed: boolean;
  pairs: { box: number; role: number }[];
}

const FIXED: readonly ReaderBand[] = ['TopMargin', 'ReportHeader', 'PageHeader', 'PageFooter', 'BottomMargin'];
/** How far a header, a footer or a margin may print from where its report puts it, hundredths of an inch. */
const FIXED_WINDOW = 60;
/** How far a text's middle may sit outside its place, up or down. */
const SLACK_Y = 4;

/**
 * What the kept report says of each text read on the page: its band and role
 * as indexes (`READER_BANDS`, `READER_ROLES`), -1 where the report has no
 * text, and how many it accounts for. `kept` is the report's skeleton in
 * hundredths of an inch (`memory.skeletonInHundredths`), the reading's unit.
 */
export function labelReading(reading: PageReading, kept: ReportSkeleton): { band: number[]; role: number[]; labelled: number } {
  const n = reading.boxes.length;
  const band = new Array<number>(n).fill(-1);
  const role = new Array<number>(n).fill(-1);
  const boxes = reading.boxes.map(([x, y, w, h]) => ({ x, y, w, h, mid: y + h / 2 }));
  const byMid = boxes.map((_, k) => k).sort((a, b) => boxes[a].mid - boxes[b].mid);
  const lineOf = new Array<number>(n).fill(-1);
  reading.lines.forEach((l, li) => l.forEach((k) => (lineOf[k] = li)));
  const m = kept.margins;
  const of = (kind: ReaderBand) => kept.bands.filter((b) => b.kind === kind);
  const headerBottom = m.top + [...of('ReportHeader'), ...of('PageHeader')].reduce((s, b) => s + b.height, 0);
  const footerTop = kept.height - m.bottom - of('PageFooter').reduce((s, b) => s + b.height, 0);
  const overlapX = (b: { x: number; w: number }, p: Place) => Math.min(b.x + b.w, p.x + p.w) - Math.max(b.x, p.x);
  const sideBySide = (b: { x: number; w: number }, p: Place) => overlapX(b, p) >= 0.5 * Math.min(b.w, p.w);

  /** The texts a band's places meet with its top at `top`, each place its best text, each text once. */
  const matchAt = (places: readonly Place[], top: number): { box: number; role: number }[] => {
    const used = new Set<number>();
    const out: { box: number; role: number }[] = [];
    for (const p of places) {
      const lo = top + p.y - SLACK_Y;
      const hi = top + p.y + p.h + SLACK_Y;
      let best = -1;
      let most = 0;
      // The texts whose middle lies in the place's height, found by halving.
      let a = 0;
      let z = byMid.length;
      while (a < z) {
        const mid = (a + z) >> 1;
        if (boxes[byMid[mid]].mid < lo) a = mid + 1;
        else z = mid;
      }
      for (let i = a; i < byMid.length && boxes[byMid[i]].mid <= hi; i++) {
        const k = byMid[i];
        if (used.has(k) || !sideBySide(boxes[k], p)) continue;
        const o = overlapX(boxes[k], p);
        if (o > most) {
          most = o;
          best = k;
        }
      }
      if (best >= 0) {
        used.add(best);
        out.push({ box: best, role: p.role });
      }
    }
    return out;
  };

  /** Whether every line a match touches is mostly its own: a line of print belongs to one band. */
  const wholeLines = (pairs: readonly { box: number }[]): boolean => {
    const mine = new Set(pairs.map((p) => p.box));
    const touched = new Set(pairs.map((p) => lineOf[p.box]).filter((li) => li >= 0));
    for (const li of touched) {
      const line = reading.lines[li];
      if (line.filter((k) => mine.has(k)).length < Math.max(1, Math.ceil(0.75 * line.length))) return false;
    }
    return true;
  };

  const candidates: Instance[] = [];
  let stacked = m.top;
  for (const b of kept.bands) {
    const kind = READER_BANDS.indexOf(b.kind as ReaderBand);
    if (kind < 0) continue;
    const places = placesOf(b, m.left);
    // A header's place on the first page, stacked from the top margin as DevExpress prints it.
    const expected =
      b.kind === 'TopMargin' ? 0 : b.kind === 'BottomMargin' ? kept.height - m.bottom : b.kind === 'PageFooter' ? footerTop : b.kind === 'ReportHeader' || b.kind === 'PageHeader' ? stacked : null;
    if (b.kind === 'ReportHeader' || b.kind === 'PageHeader') stacked += b.height;
    if (!places.length) continue;
    const need = Math.max(1, Math.ceil(0.5 * places.length));
    const fixed = FIXED.includes(b.kind as ReaderBand);
    const [lo, hi] = fixed && expected !== null ? [expected - FIXED_WINDOW, expected + FIXED_WINDOW] : [headerBottom - FIXED_WINDOW, footerTop + FIXED_WINDOW];
    // Every height at which one of its places would sit on a text read there.
    const tops = new Set<number>();
    for (const p of places) for (const k of byMid) if (sideBySide(boxes[k], p)) tops.add(Math.round(boxes[k].mid - (p.y + p.h / 2)));
    const found: { top: number; pairs: { box: number; role: number }[] }[] = [];
    for (const top of tops) {
      if (top < lo || top > hi) continue;
      const pairs = matchAt(places, top);
      if (pairs.length >= need && wholeLines(pairs)) found.push({ top, pairs });
    }
    found.sort((x, y) => y.pairs.length - x.pairs.length || x.top - y.top);
    // A header or a margin prints once; a record or a group as often as the page shows it, never overlapping itself.
    const taken: number[] = [];
    for (const f of found) {
      if (fixed && taken.length) break;
      if (taken.some((t) => Math.abs(t - f.top) < Math.max(1, b.height * 0.5))) continue;
      taken.push(f.top);
      candidates.push({ band: kind, fixed, pairs: f.pairs });
    }
  }
  // The fullest matches first, a band that prints once before one that
  // repeats (a row of headings is shaped like the records under it); a text
  // is claimed once, by the first band that meets it.
  candidates.sort((x, y) => y.pairs.length - x.pairs.length || Number(y.fixed) - Number(x.fixed));
  for (const c of candidates) {
    if (c.pairs.some((p) => band[p.box] >= 0)) continue;
    for (const p of c.pairs) {
      band[p.box] = c.band;
      role[p.box] = p.role;
    }
  }
  return { band, role, labelled: band.filter((b) => b >= 0).length };
}

/**
 * The pair a kept report makes with a page's reading, as the `boxes` field of
 * a `kept` learning event carries it: JSON, or null when the report accounts
 * for less than `MIN_LABELLED` of the page's texts (it is not a report of
 * this page, or not one the reader could learn from), or when it would not
 * fit `MAX_PAIR_CHARS`.
 */
export function readerPairOf(reading: PageReading, kept: ReportSkeleton): { json: string | null; tooLarge: boolean } {
  const { band, role, labelled } = labelReading(reading, kept);
  if (!reading.boxes.length || labelled < MIN_LABELLED * reading.boxes.length) return { json: null, tooLarge: false };
  const json = JSON.stringify({ ...reading, band, role } satisfies ReaderPair);
  return json.length <= MAX_PAIR_CHARS ? { json, tooLarge: false } : { json: null, tooLarge: true };
}

/* ---- On the owner's PC: a pulled pair, checked, and the rows it trains ---- */

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numbers = (v: unknown, length: number, bound: number): v is number[] => Array.isArray(v) && v.length === length && v.every((x) => finite(x) && Math.abs(x) <= bound);
const indexes = (v: unknown, length: number, below: number): v is number[] => Array.isArray(v) && v.length === length && v.every((x) => Number.isInteger(x) && x >= -1 && x < below);

/**
 * A pulled pair as it may be learned from, or null: rebuilt from its known
 * keys, so a field someone added on the way is not carried, and held to this
 * reader's features (`FEATURE_SIGNATURE`), the page, and lengths and indexes
 * that agree with each other. Every text in exactly one line.
 */
export function soundPair(input: unknown): ReaderPair | null {
  try {
    const raw = (typeof input === 'string' ? JSON.parse(input) : input) as Partial<ReaderPair>;
    if (!raw || typeof raw !== 'object' || raw.v !== 1 || raw.features !== FEATURE_SIGNATURE) return null;
    if (!numbers(raw.page, 2, 10_000) || raw.page[0] <= 0 || raw.page[1] <= 0) return null;
    const [w, h] = raw.page;
    const n = Array.isArray(raw.boxes) ? raw.boxes.length : -1;
    if (n < 1 || n > MAX_BOXES) return null;
    if (!raw.boxes!.every((b) => numbers(b, 4, 2 * Math.max(w, h)) && b[2] >= 0 && b[3] >= 0)) return null;
    if (!Array.isArray(raw.lines) || !raw.lines.length || raw.lines.length > n) return null;
    const seen = new Array<number>(n).fill(0);
    for (const line of raw.lines) {
      if (!Array.isArray(line) || !line.length || !line.every((k) => Number.isInteger(k) && k >= 0 && k < n)) return null;
      for (const k of line) seen[k]++;
    }
    if (seen.some((c) => c !== 1)) return null;
    const L = raw.lines.length;
    if (!Array.isArray(raw.lineFeatures) || raw.lineFeatures.length !== L || !raw.lineFeatures.every((f) => numbers(f, LINE_FEATURES.length, 10_000))) return null;
    if (!Array.isArray(raw.boxFeatures) || raw.boxFeatures.length !== n || !raw.boxFeatures.every((f) => numbers(f, BOX_OWN, 10_000))) return null;
    if (!indexes(raw.readBand, L, READER_BANDS.length) || !indexes(raw.readRole, n, READER_ROLES.length)) return null;
    if (!indexes(raw.band, n, READER_BANDS.length) || !indexes(raw.role, n, READER_ROLES.length)) return null;
    return {
      v: 1,
      features: FEATURE_SIGNATURE,
      page: [w, h],
      boxes: raw.boxes!.map((b) => [b[0], b[1], b[2], b[3]]),
      lines: raw.lines.map((l) => [...l]),
      lineFeatures: raw.lineFeatures.map((f) => [...f]),
      boxFeatures: raw.boxFeatures.map((f) => [...f]),
      readBand: [...raw.readBand],
      readRole: [...raw.readRole],
      band: [...raw.band],
      role: [...raw.role],
    };
  } catch {
    return null;
  }
}

/** A pair as the training script takes a page: its lines rebuilt from the boxes, each line's band by most of its texts. */
export interface PairPage {
  page: { width: number; height: number };
  /** The boxes, with no text: what `contextFeatures` reads of them is where they are. */
  boxes: ReadBox[];
  lines: BoxLine[];
  lineFeats: number[][];
  /** Each line's band index by most of its labelled texts, -1 when none is labelled. */
  lineLabel: number[];
  boxOwn: number[][];
  boxLine: number[];
  /** Each text's role index, -1 when the kept report gave it none. */
  boxLabel: number[];
  /** Each text's band index from the kept report, -1 for none. */
  boxBand: number[];
  /** What the shipped reader made of the page in use: each line's band and each text's role. */
  readBand: number[];
  readRole: number[];
}

export function pairPage(pair: ReaderPair): PairPage {
  const boxes: ReadBox[] = pair.boxes.map(([x, y, w, h]) => ({ x, y, w, h, text: '' }));
  const lines: BoxLine[] = pair.lines.map((ids) => ({
    boxes: [...ids],
    top: Math.min(...ids.map((k) => boxes[k].y)),
    bottom: Math.max(...ids.map((k) => boxes[k].y + boxes[k].h)),
    left: Math.min(...ids.map((k) => boxes[k].x)),
    right: Math.max(...ids.map((k) => boxes[k].x + boxes[k].w)),
  }));
  const boxLine = new Array<number>(boxes.length).fill(-1);
  pair.lines.forEach((ids, li) => ids.forEach((k) => (boxLine[k] = li)));
  const lineLabel = pair.lines.map((ids) => {
    const count = new Array<number>(READER_BANDS.length).fill(0);
    for (const k of ids) if (pair.band[k] >= 0) count[pair.band[k]]++;
    const most = Math.max(...count);
    return most > 0 ? count.indexOf(most) : -1;
  });
  return {
    page: { width: pair.page[0], height: pair.page[1] },
    boxes,
    lines,
    lineFeats: pair.lineFeatures,
    lineLabel,
    boxOwn: pair.boxFeatures,
    boxLine,
    boxLabel: pair.role,
    boxBand: pair.band,
    readBand: pair.readBand,
    readRole: pair.readRole,
  };
}

/** How often a reader agrees with the kept reports, over every labelled text: its band, its role, and both. */
export interface PairScore {
  texts: number;
  band: number;
  role: number;
  both: number;
}

/**
 * Pairs scored two ways: the shipped reader as it read each page in use
 * (rules and all, from the pair), and `model` from the pair's numbers alone,
 * its bands decoded as the app decodes them and each role its network's
 * first choice (the rules after the networks read the text, which a pair
 * does not hold). Each against the bands and roles of the kept report.
 */
export function scorePairPages(model: BoxReaderModel, pages: readonly PairPage[]): { shipped: PairScore; model: PairScore } {
  const shipped: PairScore = { texts: 0, band: 0, role: 0, both: 0 };
  const mine: PairScore = { texts: 0, band: 0, role: 0, both: 0 };
  const add = (s: PairScore, bandOk: boolean, roleOk: boolean) => {
    s.texts++;
    if (bandOk) s.band++;
    if (roleOk) s.role++;
    if (bandOk && roleOk) s.both++;
  };
  for (const p of pages) {
    const bands = decodedBands(model, p.boxes, p.lines, p.lineFeats);
    p.boxLabel.forEach((role, k) => {
      if (role < 0 || p.boxBand[k] < 0) return;
      const li = p.boxLine[k];
      add(shipped, p.readBand[li] === p.boxBand[k], p.readRole[k] === role);
      const probs = mlpProbs(model.boxes, roleInput(p, k, bands));
      add(mine, READER_BANDS.indexOf(bands[li]) === p.boxBand[k], probs.indexOf(Math.max(...probs)) === role);
    });
  }
  return { shipped, model: mine };
}

/**
 * The role network's rows from a pair: each labelled text's features as
 * `boxFeatures` builds them (its own, its line's band given as `bands`, which
 * the training decodes with the reader it is making, and its line's), and its
 * role from the kept report.
 */
export function pairRoleRows(p: PairPage, bands: readonly ReaderBand[]): { x: number[]; y: number }[] {
  return p.boxOwn.flatMap((_, k) => (p.boxLabel[k] < 0 ? [] : [{ x: roleInput(p, k, bands), y: p.boxLabel[k] }]));
}

/** One text's input to the role network, as `boxFeatures` builds it: its own features, its line's band, its line's features. */
export function roleInput(p: PairPage, k: number, bands: readonly ReaderBand[]): number[] {
  const li = p.boxLine[k];
  return [...p.boxOwn[k], ...READER_BANDS.map((b) => (bands[li] === b ? 1 : 0)), ...p.lineFeats[li]];
}

/**
 * The pairs a pull folder holds (`boxes/<id>.json`, each `{ ref, at, pair }`),
 * as the training reads them: sound ones only, and of several pairs for one
 * report (it was exported, then saved) the newest, which is the report as the
 * person last kept it.
 */
export function pairsOfFolder(files: readonly string[]): ReaderPair[] {
  const newest = new Map<string, { at: string; pair: ReaderPair }>();
  for (const text of files) {
    try {
      const f = JSON.parse(text) as { ref?: unknown; at?: unknown; pair?: unknown };
      const pair = soundPair(f.pair);
      if (!pair) continue;
      const ref = typeof f.ref === 'string' && f.ref ? f.ref : `#${newest.size}`;
      const at = typeof f.at === 'string' ? f.at : '';
      const was = newest.get(ref);
      if (!was || at > was.at) newest.set(ref, { at, pair });
    } catch {
      /* not a pair file */
    }
  }
  return [...newest.values()].map((v) => v.pair);
}
