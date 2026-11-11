/**
 * How far a photographed or scanned page is turned (2026-11-11, the full
 * audit's CP-05), so it is straightened once at intake and OCR, Forma's own
 * reading of the page and the picture the AI sees all read the same straight
 * page. A phone photo two to four degrees off read into broken lines, and a
 * scan fed sideways into nothing; nothing said why, and nothing is said now:
 * the page is simply read straight.
 *
 * The measure is the classic projection profile. Text lines are dark rows
 * with light rows between them, so the row sums of the ink vary most when the
 * lines run exactly across: the page's turn is the angle that maximises the
 * variance of the row sums once the ink is turned back by it. It is measured
 * on a small black-and-white copy (`inkPoints`), from -6 to 6 degrees in
 * quarter degrees, about the page's centre.
 *
 * A page on its side scores far higher with its columns than its rows, which
 * is how a sideways page is found. Which side it lies on cannot come from that
 * score, which is the same both ways, so it is read from the margin: the
 * lines of a page start together and end ragged, so of the two ways back, the
 * one whose line starts line up better is the right way up. A page that
 * already reads across is never turned over, even where its lines end
 * together and start ragged (right-aligned or right-to-left text): turning an
 * upright page upside down is the one mistake worse than leaving it, and the
 * margin test alone is not sure enough for it. A sideways page judged the
 * wrong way ends upside down, no less readable than it came.
 *
 * Pure: the browser half is `turnOf` and `drawTurned` in repxIntake.ts, which
 * measure a small copy and draw the page turned back by this angle.
 */

/** The ink of a picture, as points about its centre. */
export interface Ink {
  /** x then y of each dark pixel, relative to the picture's centre. */
  points: Float32Array;
  width: number;
  height: number;
}

/** The darkness a pixel must reach to be ink: Otsu's threshold over the picture's grey levels. */
export function otsuThreshold(gray: ArrayLike<number>): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i] | 0]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** The dark pixels of RGBA pixels (a canvas's `ImageData`), about the centre. */
export function inkPoints(rgba: ArrayLike<number>, width: number, height: number): Ink {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
  const t = otsuThreshold(gray);
  const out: number[] = [];
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] <= t) out.push(x - cx, y - cy);
    }
  }
  // Ink over half the picture is a dark photo or a negative, not a page of text.
  if (out.length / 2 > (width * height) / 2) return { points: new Float32Array(0), width, height };
  return { points: Float32Array.from(out), width, height };
}

const RAD = Math.PI / 180;

/** The row sums of the ink turned back by `degrees` (the turn it is undone by), one row a pixel. */
function rowSums(ink: Ink, degrees: number): Int32Array {
  const sin = Math.sin(degrees * RAD);
  const cos = Math.cos(degrees * RAD);
  const reach = Math.ceil(Math.hypot(ink.width, ink.height) / 2) + 1;
  const rows = new Int32Array(reach * 2 + 1);
  const p = ink.points;
  for (let i = 0; i < p.length; i += 2) rows[Math.round(-p[i] * sin + p[i + 1] * cos) + reach]++;
  return rows;
}

/** How sharply the ink falls into rows once turned back by `degrees`: the sum of squared row sums. */
export function lineScore(ink: Ink, degrees: number): number {
  let score = 0;
  for (const n of rowSums(ink, degrees)) score += n * n;
  return score;
}

/**
 * How well the lines start together, against how well they end together,
 * once the ink is turned back by `degrees`: below 1 when the starts line up
 * better, which an upright page's do.
 */
export function marginRatio(ink: Ink, degrees: number): number {
  const sin = Math.sin(degrees * RAD);
  const cos = Math.cos(degrees * RAD);
  const reach = Math.ceil(Math.hypot(ink.width, ink.height) / 2) + 1;
  const first = new Float64Array(reach * 2 + 1).fill(Infinity);
  const last = new Float64Array(reach * 2 + 1).fill(-Infinity);
  const p = ink.points;
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i] * cos + p[i + 1] * sin;
    const row = Math.round(-p[i] * sin + p[i + 1] * cos) + reach;
    if (x < first[row]) first[row] = x;
    if (x > last[row]) last[row] = x;
  }
  // One start and one end a text line: the rows between blank rows.
  const starts: number[] = [];
  const ends: number[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (let r = 0; r <= reach * 2 + 1; r++) {
    if (r <= reach * 2 && first[r] !== Infinity) {
      lo = Math.min(lo, first[r]);
      hi = Math.max(hi, last[r]);
    } else if (lo !== Infinity) {
      starts.push(lo);
      ends.push(hi);
      lo = Infinity;
      hi = -Infinity;
    }
  }
  if (starts.length < 3) return 1;
  const spread = (v: number[]) => {
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  };
  return (spread(starts) + 1) / (spread(ends) + 1);
}

/** Below this much ink there is no text to measure a turn by. */
const MIN_POINTS = 200;
/** A page on its side scores at least this much higher across its columns. */
const SIDEWAYS = 2;
/** A turn that does not sharpen the lines by this much is noise, not a turn. */
const SHARPER = 1.02;
/** A turn smaller than this is left alone: redrawing would cost more than it fixes. */
const LEAST_DEGREES = 0.5;

/** The shorter side, in pixels, below which a picture is a logo or a crop rather than a page. */
const PAGE_EDGE = 500;
/** The longest a page's long side runs against its short one: A4 is 1.41, a phone photo of one 1.33 to 1.78. */
const PAGE_ASPECT = 2;

/**
 * Whether a picture is shaped like a photographed or scanned page, which is
 * the only picture turned on its side (2026-11-11, the review of CP-05): a
 * barcode, a striped logo or a bar chart has columns that score as lines once
 * turned, and was laid sideways at intake with nothing said.
 */
export function pageShaped(width: number, height: number): boolean {
  const short = Math.min(width, height);
  return short >= PAGE_EDGE && Math.max(width, height) / short <= PAGE_ASPECT;
}

/**
 * The page's clockwise turn in degrees, which it is drawn back by: a small
 * angle, or about 90 or 270 for a page on its side (only when `sideways` is
 * allowed, see `pageShaped`); 0 for a straight page or one with too little
 * text to tell.
 */
export function pageTurn(ink: Ink, sideways = true): number {
  if (ink.points.length / 2 < MIN_POINTS) return 0;
  // Each way's best within the range, whole degrees: a page on its side and
  // two degrees off scores little better exactly sideways than upright.
  const near = (base: number) => {
    let top = 0;
    for (let d = -6; d <= 6; d++) top = Math.max(top, lineScore(ink, base + d));
    return top;
  };
  let base = 0;
  if (sideways && near(90) > near(0) * SIDEWAYS) {
    base = marginRatio(ink, 90) <= marginRatio(ink, 270) ? 90 : 270;
  }
  const level = lineScore(ink, base);
  let best = base;
  let bestScore = level;
  for (let d = -6; d <= 6; d += 0.25) {
    if (d === 0) continue;
    const score = lineScore(ink, base + d);
    if (score > bestScore) {
      bestScore = score;
      best = base + d;
    }
  }
  if (Math.abs(best - base) < LEAST_DEGREES || bestScore < level * SHARPER) best = base;
  return best;
}
