/**
 * PaddleOCR's PP-OCRv5 reading a page (2026-11-10, the owner's AI accuracy
 * programme, batch AC): the steps around the two models, pure, so the browser
 * (lib/paddle.ts, through a worker) and the measuring script
 * (scripts/model/paddleOcr.ts, with onnxruntime-node) run the same code.
 *
 * Measured on the company's private pages on 2026-11-10 against the
 * Tesseract reading the app made until then (docs/notes/app-shell.md, *OCR
 * reads the text of an image or a scan*): words found and right, F1, 30.4 to
 * 78.7 on 200 reports printed by DevExpress, 52.8 to 92.7 on real PDFs drawn
 * at 96 dpi and 68.4 to 95.1 at 200 dpi, as the app runs it (lib/paddleWorker.ts).
 *
 * The models are PaddlePaddle's own ONNX exports, Apache-2.0: the text
 * detector PP-OCRv5_mobile_det and the English recogniser
 * en_PP-OCRv5_mobile_rec. The steps follow their inference.yml and PaddleOCR's
 * DBPostProcess and CTCLabelDecode, with one simplification a report allows:
 * its text is upright, so a detected region is its axis-aligned box rather
 * than a rotated rectangle.
 *
 * - Detection: the page at its own size rounded to a multiple of 32
 *   (PaddleOCR 3's document default, at least 64 and at most 4000 a side),
 *   BGR, normalised by ImageNet's mean and deviation; the probability map
 *   above 0.3 in 8-connected regions, one kept when the mean probability over
 *   its box reaches 0.6, then grown by area x 1.5 / perimeter on every side.
 * - Recognition: each box 48 pixels high at its own aspect, at least 320
 *   wide, BGR, (x / 255 - 0.5) / 0.5, padded with zeros, eight at a time in
 *   order of aspect; read greedily (CTC), class 0 the blank and the last the
 *   space when the model has one more class than its list.
 */
import type { OcrLine, OcrPage, OcrWord } from './ocr';
import type { PixelBox } from './reportGeometry';

/** An RGB image, three bytes a pixel, row by row. */
export interface Rgb {
  data: Uint8Array;
  width: number;
  height: number;
}

/** What both onnxruntime-web's and onnxruntime-node's sessions offer, as far as this needs. */
export interface OrtSessionLike {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, never>): Promise<Record<string, { data: unknown; dims: readonly number[] }>>;
}

/** Makes a float32 tensor of the runtime in use. */
export type MakeTensor = (data: Float32Array, dims: number[]) => unknown;

/** An RGBA picture (a canvas's ImageData) as RGB, transparent pixels on white. */
export function rgbFromRgba(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Rgb {
  const data = new Uint8Array(width * height * 3);
  for (let p = 0, q = 0; p < width * height; p++, q += 4) {
    const a = rgba[q + 3] / 255;
    for (let c = 0; c < 3; c++) data[p * 3 + c] = Math.round(rgba[q + c] * a + 255 * (1 - a));
  }
  return { data, width, height };
}

/** Bilinear resize, sampling at pixel centres as OpenCV's INTER_LINEAR does. */
export function resizeRgb(img: Rgb, width: number, height: number): Rgb {
  if (width === img.width && height === img.height) return img;
  const out = new Uint8Array(width * height * 3);
  const sx = img.width / width;
  const sy = img.height / height;
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, (y + 0.5) * sy - 0.5);
    const y0 = Math.min(img.height - 1, Math.floor(fy));
    const y1 = Math.min(img.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5);
      const x0 = Math.min(img.width - 1, Math.floor(fx));
      const x1 = Math.min(img.width - 1, x0 + 1);
      const wx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const a = img.data[(y0 * img.width + x0) * 3 + c];
        const b = img.data[(y0 * img.width + x1) * 3 + c];
        const d = img.data[(y1 * img.width + x0) * 3 + c];
        const e = img.data[(y1 * img.width + x1) * 3 + c];
        out[(y * width + x) * 3 + c] = Math.round((a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy);
      }
    }
  }
  return { data: out, width, height };
}

/** A region of `img`, clamped to it. */
export function cropRgb(img: Rgb, box: PixelBox): Rgb {
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(box.x0)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(box.y0)));
  const x1 = Math.max(x0 + 1, Math.min(img.width, Math.ceil(box.x1)));
  const y1 = Math.max(y0 + 1, Math.min(img.height, Math.ceil(box.y1)));
  const width = x1 - x0;
  const height = y1 - y0;
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * img.width + x0) * 3;
    data.set(img.data.subarray(from, from + width * 3), y * width * 3);
  }
  return { data, width, height };
}

/** A recogniser's character list, from the `character_dict` of its inference.yml. */
export function characterDict(yml: string): string[] {
  const lines = yml.split('\n');
  const at = lines.findIndex((l) => /^\s*character_dict:\s*$/.test(l));
  if (at < 0) throw new Error('The recogniser names no character_dict.');
  const out: string[] = [];
  for (const line of lines.slice(at + 1)) {
    const m = /^\s*- (.*)$/.exec(line.replace(/\r$/, ''));
    if (!m) break;
    const v = m[1];
    if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) out.push(v.slice(1, -1).replace(/''/g, "'"));
    else if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) out.push(JSON.parse(v) as string);
    else out.push(v);
  }
  return out;
}

/** Greedy CTC over one sequence of `steps` x `classes` scores: each kept class, its step and its score. */
export function ctcGreedy(probs: Float32Array, offset: number, steps: number, classes: number): { index: number; step: number; score: number }[] {
  const out: { index: number; step: number; score: number }[] = [];
  let last = -1;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    let score = -Infinity;
    const base = offset + t * classes;
    for (let k = 0; k < classes; k++) {
      if (probs[base + k] > score) {
        score = probs[base + k];
        best = k;
      }
    }
    if (best !== 0 && best !== last) out.push({ index: best, step: t, score });
    last = best;
  }
  return out;
}

/**
 * DBPostProcess with upright boxes: the 8-connected regions of `prob` (h x w)
 * above `thresh`, kept when their box's mean probability reaches `boxThresh`,
 * grown by `unclip`.
 */
export function boxesFromMap(prob: Float32Array, w: number, h: number, thresh = 0.3, boxThresh = 0.6, unclip = 1.5, maxCandidates = 1000): PixelBox[] {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const boxes: PixelBox[] = [];
  for (let start = 0; start < w * h && boxes.length < maxCandidates; start++) {
    if (seen[start] || prob[start] <= thresh) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    while (top) {
      const p = stack[--top];
      const x = p % w;
      const y = (p - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (!seen[q] && prob[q] > thresh) {
            seen[q] = 1;
            stack[top++] = q;
          }
        }
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (Math.min(bw, bh) < 3) continue;
    let sum = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) sum += prob[y * w + x];
    if (sum / (bw * bh) < boxThresh) continue;
    const d = (bw * bh * unclip) / (2 * (bw + bh));
    const box = { x0: x0 - d, y0: y0 - d, x1: x1 + 1 + d, y1: y1 + 1 + d };
    if (Math.min(box.x1 - box.x0, box.y1 - box.y0) < 3 + 2) continue;
    boxes.push(box);
  }
  return boxes;
}

/** PaddleOCR's reading order: top to bottom, then left to right among boxes within 10 pixels of one line. */
export function readingOrder(boxes: readonly PixelBox[]): PixelBox[] {
  const sorted = [...boxes].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  for (let i = 0; i < sorted.length - 1; i++) {
    for (let j = i; j >= 0; j--) {
      if (Math.abs(sorted[j + 1].y0 - sorted[j].y0) < 10 && sorted[j + 1].x0 < sorted[j].x0) {
        [sorted[j], sorted[j + 1]] = [sorted[j + 1], sorted[j]];
      } else break;
    }
  }
  return sorted;
}

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/**
 * The detector's input: the page rounded to a multiple of 32 a side, BGR,
 * normalised; no longer than `longSide` when one is given (the detector's own
 * inference.yml says 960), the recogniser still reading its crops from the
 * page at full size.
 */
export function detectorInput(img: Rgb, longSide?: number): { data: Float32Array; width: number; height: number } {
  let ratio = 1;
  if (Math.min(img.width, img.height) < 64) ratio = 64 / Math.min(img.width, img.height);
  const most = Math.min(4000, longSide ?? 4000);
  if (Math.max(img.width, img.height) * ratio > most) ratio = most / Math.max(img.width, img.height);
  const width = Math.max(32, Math.round((img.width * ratio) / 32) * 32);
  const height = Math.max(32, Math.round((img.height * ratio) / 32) * 32);
  const small = resizeRgb(img, width, height);
  const plane = width * height;
  const data = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    // BGR, each channel normalised with the statistic in its own position, as PaddleOCR does.
    for (let c = 0; c < 3; c++) data[c * plane + p] = (small.data[p * 3 + (2 - c)] / 255 - MEAN[c]) / STD[c];
  }
  return { data, width, height };
}

/** One recognised box as an OCR line: its words split at the model's space, each placed by the steps its letters were read at. */
export function lineFromSequence(
  kept: readonly { index: number; step: number; score: number }[],
  dict: readonly string[],
  space: number,
  box: PixelBox,
  geometry: { steps: number; inputWidth: number; drawnWidth: number },
): OcrLine | null {
  if (!kept.length) return null;
  const toX = (step: number) => box.x0 + (((step + 0.5) * geometry.inputWidth) / geometry.steps / geometry.drawnWidth) * (box.x1 - box.x0);
  const charW = (box.x1 - box.x0) / Math.max(1, kept.length);
  const words: OcrWord[] = [];
  let current: { index: number; step: number; score: number }[] = [];
  const flush = () => {
    if (!current.length) return;
    const text = current.map((k) => dict[k.index - 1] ?? '').join('');
    if (text.trim()) {
      words.push({
        text,
        box: { x0: Math.max(box.x0, toX(current[0].step) - charW / 2), y0: box.y0, x1: Math.min(box.x1, toX(current[current.length - 1].step) + charW / 2), y1: box.y1 },
        confidence: (100 * current.reduce((a, k) => a + k.score, 0)) / current.length,
      });
    }
    current = [];
  };
  for (const k of kept) {
    if (k.index === space) flush();
    else current.push(k);
  }
  flush();
  if (!words.length) return null;
  return {
    text: words.map((w) => w.text).join(' '),
    box: { ...box },
    confidence: (100 * kept.reduce((a, k) => a + k.score, 0)) / kept.length,
    words,
  };
}

/**
 * A page as PaddleOCR read it, and how many text regions its detector found:
 * on a page in a script its recogniser does not know, most regions come back
 * empty, which is how Forma knows to try Tesseract's languages (`readShare`).
 */
export type PaddlePage = OcrPage & { detected: number };

/** The text regions of a page, in the page's pixels, as the detector finds them (DBPostProcess, upright boxes). */
export async function detectRegions(det: OrtSessionLike, img: Rgb, tensor: MakeTensor, detectLongSide?: number): Promise<PixelBox[]> {
  const input = detectorInput(img, detectLongSide);
  const out = await det.run({ [det.inputNames[0]]: tensor(input.data, [1, 3, input.height, input.width]) as never });
  const map = out[det.outputNames[0]].data as Float32Array;
  const sx = img.width / input.width;
  const sy = img.height / input.height;
  return boxesFromMap(map, input.width, input.height).map((b) => ({
    x0: Math.max(0, b.x0 * sx),
    y0: Math.max(0, b.y0 * sy),
    x1: Math.min(img.width, b.x1 * sx),
    y1: Math.min(img.height, b.y1 * sy),
  }));
}

/**
 * Each region read as an OCR line, or null where nothing was read: eight at a
 * time in order of aspect, so a batch pads little. Independent region by
 * region, which is what lets the browser share them out among workers
 * (lib/paddle.ts).
 */
export async function recognizeRegions(
  rec: OrtSessionLike,
  dict: readonly string[],
  img: Rgb,
  boxes: readonly PixelBox[],
  tensor: MakeTensor,
  onProgress?: (fraction: number) => void,
  minWidth = 320,
): Promise<(OcrLine | null)[]> {
  const crops = boxes.map((b) => cropRgb(img, b));
  const order = crops.map((c, i) => ({ i, ratio: c.width / c.height })).sort((a, b) => a.ratio - b.ratio);
  const lines: (OcrLine | null)[] = new Array<OcrLine | null>(boxes.length).fill(null);
  for (let s = 0; s < order.length; s += 8) {
    const batch = order.slice(s, s + 8);
    const inputWidth = Math.min(3200, Math.max(minWidth, Math.ceil(48 * Math.max(...batch.map((b) => b.ratio)))));
    const plane = 48 * inputWidth;
    const input = new Float32Array(batch.length * 3 * plane);
    const widths: number[] = [];
    batch.forEach((b, n) => {
      const drawn = Math.max(1, Math.min(inputWidth, Math.ceil(48 * b.ratio)));
      widths.push(drawn);
      const r = resizeRgb(crops[b.i], drawn, 48);
      for (let y = 0; y < 48; y++) {
        for (let x = 0; x < drawn; x++) {
          const p = (y * drawn + x) * 3;
          for (let c = 0; c < 3; c++) input[n * 3 * plane + c * plane + y * inputWidth + x] = (r.data[p + (2 - c)] / 255 - 0.5) / 0.5;
        }
      }
    });
    const out = await rec.run({ [rec.inputNames[0]]: tensor(input, [batch.length, 3, 48, inputWidth]) as never });
    const t = out[rec.outputNames[0]];
    const [, steps, classes] = t.dims;
    const probs = t.data as Float32Array;
    const space = classes === dict.length + 2 ? classes - 1 : -1;
    batch.forEach((b, n) => {
      const kept = ctcGreedy(probs, n * steps * classes, steps, classes);
      lines[b.i] = lineFromSequence(kept, dict, space, boxes[b.i], { steps, inputWidth, drawnWidth: widths[n] });
    });
    onProgress?.(Math.min(1, (s + batch.length) / order.length));
  }
  return lines;
}

/** A page from its regions in reading order and what each read as. */
export function pageFromRegions(img: { width: number; height: number }, dpi: number | null, boxes: readonly PixelBox[], lines: readonly (OcrLine | null)[]): PaddlePage {
  return { width: img.width, height: img.height, dpi, lines: lines.filter((l): l is OcrLine => !!l), detected: boxes.length };
}

export interface PaddleReader {
  read(img: Rgb, dpi: number | null, onProgress?: (fraction: number) => void): Promise<PaddlePage>;
}

/** A reader over the two sessions in one place, whichever runtime made them: the measuring scripts' way. */
export function paddleReader(det: OrtSessionLike, rec: OrtSessionLike, dict: readonly string[], tensor: MakeTensor, options: { detectLongSide?: number; recognizeMinWidth?: number } = {}): PaddleReader {
  return {
    async read(img, dpi, onProgress) {
      const boxes = readingOrder(await detectRegions(det, img, tensor, options.detectLongSide));
      return pageFromRegions(img, dpi, boxes, await recognizeRegions(rec, dict, img, boxes, tensor, onProgress, options.recognizeMinWidth));
    },
  };
}

/**
 * Below this share of its regions read, a page is taken to be in a script the
 * recogniser does not know, and read by Tesseract as before, probes and all
 * (lib/ocr.ts). Measured 2026-11-10: real English report pages median 1.00,
 * lowest 0.72 of 35; drawn Arabic lines 0.25, Hindi 0.50. On both, English's
 * confidence alone said Latin (99.5 and 72.5), because what it did read was the
 * digits, so confidence cannot be the test.
 */
export const MIN_READ_SHARE = 0.6;

/** The share of the regions found that came back as text: near 1 on a page in the recogniser's own script. */
export function readShare(page: PaddlePage): number {
  return page.detected ? page.lines.length / page.detected : 1;
}
