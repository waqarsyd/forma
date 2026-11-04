/**
 * The boxes design for Forma's vision model (2026-11-04, milestone 6 of
 * docs/proposals/own-model.md).
 *
 * Version 2 of the model wrote whole skeletons and placed 11% of a page's text
 * where it prints, against OCR's 55%. Placing things is what OCR already does
 * well. So in this design the model is given the page and the text read on it,
 * as numbered boxes, and asked only for what OCR cannot tell:
 * - the bands, each where it first prints, with its top and height;
 * - under each band, the number and role of each box printed in it.
 * A box in a repeated record (the second row of a Detail band, a later
 * group's header) is not listed: it is the same control printing again.
 *
 *   page A4 portrait 827 1169 40 40 40 40
 *   band PageHeader 104 25
 *   1 caption
 *   2 caption
 *   band Detail 129 18
 *   3 value
 *
 * The places come from the boxes, so they are as good as the reading.
 * `scripts/model/render.py --boxes` writes the training pairs from the text it
 * draws; at a real page the boxes are OCR's.
 */
import type { BandKind } from './reportPreview';
import type { ReportSkeleton, SkeletonBand, SkeletonRole } from './reportSkeleton';
import { textToSkeleton } from './skeletonText';

/** The question, word for word as render.py's BOX_INSTRUCTION; a test keeps them the same. */
export const BOX_INSTRUCTION =
  'This is one page of a printed business report and the text boxes read on it, numbered, ' +
  'each x y w h in hundredths of an inch from the top left of the page. Write its structure ' +
  'as Forma box text: the page line, then each band where it first prints, with its top and ' +
  'height, and under it the number and role of each box printed there.';

/** A text's box on the page, in hundredths of an inch from its top left. */
export interface TextBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The boxes in reading order, top to bottom then left to right: the order they are numbered in. */
export function orderBoxes<T extends TextBox>(boxes: readonly T[]): T[] {
  return [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** The prompt for a page: the question, then each box, numbered from 1, as whole hundredths. */
export function boxPrompt(boxes: readonly TextBox[]): string {
  const r = Math.round;
  return [BOX_INSTRUCTION, ...boxes.map((b, i) => `${i + 1} ${r(b.x)} ${r(b.y)} ${r(b.w)} ${r(b.h)}`)].join('\n');
}

/** The numbered boxes back out of a prompt, by their number. */
export function boxesOfPrompt(prompt: string): Map<number, TextBox> {
  const out = new Map<number, TextBox>();
  for (const line of prompt.split(/\r?\n/)) {
    const m = /^(\d+) (-?\d+) (-?\d+) (\d+) (\d+)$/.exec(line.trim());
    if (m) out.set(Number(m[1]), { x: Number(m[2]), y: Number(m[3]), w: Number(m[4]), h: Number(m[5]) });
  }
  return out;
}

const ROLES: readonly SkeletonRole[] = ['title', 'caption', 'value', 'total', 'pageInfo', 'decoration'];
const BANDS: readonly BandKind[] = ['TopMargin', 'ReportHeader', 'PageHeader', 'GroupHeader', 'Detail', 'DetailReport', 'GroupFooter', 'ReportFooter', 'PageFooter', 'BottomMargin', 'Unknown'];

/** An answer read: its page line, and its bands with their places and boxes. */
export interface BoxAnswer {
  page: Omit<ReportSkeleton, 'bands'> | null;
  bands: { kind: BandKind; top: number; height: number; boxes: { n: number; role: SkeletonRole }[] }[];
  /** Lines that could not be read, by number; they are left out. */
  problems: string[];
}

/** An answer read tolerantly: what cannot be read is listed and skipped, as textToSkeleton does. */
export function parseBoxAnswer(text: string): BoxAnswer {
  const out: BoxAnswer = { page: null, bands: [], problems: [] };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('```')) return;
    const t = line.split(/\s+/);
    if (t[0] === 'page') {
      const k = textToSkeleton(line).skeleton;
      if (k) out.page = { paper: k.paper, landscape: k.landscape, width: k.width, height: k.height, margins: k.margins };
      else out.problems.push(`line ${i + 1}: a page line needs a paper, an orientation and six numbers`);
    } else if (t[0] === 'band' && t.length === 4 && BANDS.includes(t[1] as BandKind) && Number.isFinite(Number(t[2])) && Number.isFinite(Number(t[3]))) {
      out.bands.push({ kind: t[1] as BandKind, top: Number(t[2]), height: Number(t[3]), boxes: [] });
    } else if (t.length === 2 && /^\d+$/.test(t[0]) && ROLES.includes(t[1] as SkeletonRole) && out.bands.length) {
      out.bands[out.bands.length - 1].boxes.push({ n: Number(t[0]), role: t[1] as SkeletonRole });
    } else {
      out.problems.push(`line ${i + 1}: not understood`);
    }
  });
  return out;
}

/** Roughly how wide one character prints, in hundredths of an inch: 7 is a 10-point face. */
const CHAR_WIDTH = 7;

/**
 * The skeleton an answer describes, its controls at the boxes' places: each
 * box listed under a band becomes a label in it, from the band's top and the
 * page's left margin. A box numbered that the boxes do not hold is left out.
 * Null when the answer has no page line.
 *
 * A box is text read on the page, so a caption made from one is never empty:
 * its length is estimated from the box's width, since the question carries
 * numbers only. Until 2026-11-04 it was 0, which a skeleton reads as an empty
 * caption, so every box called a caption scored as printing nothing and the
 * right answer itself found only 59.1% of the text where it prints.
 */
export function boxAnswerToSkeleton(answer: BoxAnswer, boxes: ReadonlyMap<number, TextBox>): ReportSkeleton | null {
  if (!answer.page) return null;
  const left = answer.page.margins.left;
  const bands: SkeletonBand[] = answer.bands.map((b) => ({
    kind: b.kind,
    height: b.height,
    groupFields: b.kind === 'GroupHeader' ? 1 : 0,
    controls: b.boxes.flatMap(({ n, role }) => {
      const box = boxes.get(n);
      if (!box) return [];
      const chars = role === 'caption' ? Math.max(1, Math.round(box.w / CHAR_WIDTH)) : 0;
      return [{ kind: 'label' as const, role, x: box.x - left, y: box.y - b.top, w: box.w, h: box.h, font: null, align: 'left' as const, borders: 0, chars }];
    }),
  }));
  return { ...answer.page, bands };
}

/** How an answer's boxes compare with the right one's: listed or left out, and in the right band with the right role. */
export interface BoxScore {
  /** Boxes the right answer lists, the answer lists, and both list. */
  expected: number;
  predicted: number;
  listed: number;
  /** Of those both list, how many have the right band, and the right band and role. */
  band: number;
  role: number;
  /** Band kinds as a multiset, as scoreSkeleton counts them. */
  bands: { expected: number; predicted: number; matched: number };
}

export function scoreBoxAnswer(predicted: BoxAnswer, expected: BoxAnswer): BoxScore {
  const where = (a: BoxAnswer) => {
    const m = new Map<number, { band: BandKind; role: SkeletonRole }>();
    for (const b of a.bands) for (const x of b.boxes) if (!m.has(x.n)) m.set(x.n, { band: b.kind, role: x.role });
    return m;
  };
  const e = where(expected);
  const p = where(predicted);
  let listed = 0;
  let band = 0;
  let role = 0;
  for (const [n, want] of e) {
    const got = p.get(n);
    if (!got) continue;
    listed++;
    if (got.band === want.band) {
      band++;
      if (got.role === want.role) role++;
    }
  }
  const count = (a: BoxAnswer) => a.bands.reduce((m, b) => m.set(b.kind, (m.get(b.kind) ?? 0) + 1), new Map<BandKind, number>());
  const eb = count(expected);
  const pb = count(predicted);
  let matched = 0;
  for (const [k, n] of eb) matched += Math.min(n, pb.get(k) ?? 0);
  return { expected: e.size, predicted: p.size, listed, band, role, bands: { expected: expected.bands.length, predicted: predicted.bands.length, matched } };
}
