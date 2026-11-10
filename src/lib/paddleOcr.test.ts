import { describe, expect, it } from 'vitest';
import {
  boxesFromMap,
  characterDict,
  cropRgb,
  ctcGreedy,
  detectorInput,
  lineFromSequence,
  paddleReader,
  MIN_READ_SHARE,
  readingOrder,
  readShare,
  recognizeRegions,
  resizeRgb,
  rgbFromRgba,
  type OrtSessionLike,
  type Rgb,
} from './paddleOcr';

/*
 * PaddleOCR's steps around its two models (2026-11-10, the AI accuracy
 * programme, batch AC). The models themselves were measured on the private
 * pages; these hold the code that feeds them and reads them, where a mistake
 * would read plausibly and wrongly rather than fail.
 */

const solid = (width: number, height: number, rgb: [number, number, number]): Rgb => {
  const data = new Uint8Array(width * height * 3);
  for (let p = 0; p < width * height; p++) data.set(rgb, p * 3);
  return { data, width, height };
};

describe('the recogniser list', () => {
  it('reads plain, single-quoted and double-quoted entries, and stops at the next key', () => {
    const yml = ['PostProcess:', '  name: CTCLabelDecode', '  character_dict:', "  - '0'", '  - A', "  - ''''", '  - "\\""', 'Other:', '  - B'].join('\n');
    expect(characterDict(yml)).toEqual(['0', 'A', "'", '"']);
  });

  it('refuses a recogniser with no list', () => {
    expect(() => characterDict('PostProcess:\n  name: CTCLabelDecode\n')).toThrow(/character_dict/);
  });
});

describe('greedy CTC', () => {
  // Classes: 0 blank, 1 "a", 2 "b".
  const seq = (best: number[], classes = 3) => {
    const probs = new Float32Array(best.length * classes);
    best.forEach((k, t) => (probs[t * classes + k] = 0.9));
    return probs;
  };

  it('drops the blank and collapses a repeat, and keeps a letter repeated across a blank', () => {
    expect(ctcGreedy(seq([1, 1, 0, 2, 2, 0, 2]), 0, 7, 3).map((k) => k.index)).toEqual([1, 2, 2]);
  });

  it('records the step each letter was read at', () => {
    expect(ctcGreedy(seq([0, 1, 1, 0, 2]), 0, 5, 3).map((k) => k.step)).toEqual([1, 4]);
  });
});

describe('the detector map', () => {
  const map = (w: number, h: number, fill: (x: number, y: number) => number) => {
    const m = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = fill(x, y);
    return m;
  };

  it('finds each region as a box grown by the unclip distance', () => {
    const m = map(100, 40, (x, y) => ((x >= 10 && x < 30 && y >= 10 && y < 20) || (x >= 60 && x < 90 && y >= 10 && y < 20) ? 0.9 : 0));
    const boxes = boxesFromMap(m, 100, 40);
    expect(boxes).toHaveLength(2);
    // A 20 x 10 region grows by 20 * 10 * 1.5 / 60 = 5 on every side.
    expect(boxes[0]).toEqual({ x0: 5, y0: 5, x1: 35, y1: 25 });
  });

  it('drops a faint region and a speck', () => {
    const m = map(60, 30, (x, y) => (x >= 5 && x < 25 && y >= 5 && y < 15 ? 0.4 : x >= 40 && x < 42 && y >= 5 && y < 7 ? 0.9 : 0));
    expect(boxesFromMap(m, 60, 30)).toEqual([]);
  });

  it('rounds the page to a multiple of 32 and orders the channels blue, green, red', () => {
    const input = detectorInput(solid(100, 70, [255, 0, 0]));
    expect([input.width, input.height]).toEqual([96, 64]);
    // A side under 64 is first scaled up to 64.
    expect(detectorInput(solid(100, 50, [0, 0, 0])).height).toBe(64);
    const plane = 96 * 64;
    // Red sits in the third channel, normalised with the third statistic.
    expect(input.data[2 * plane]).toBeCloseTo((1 - 0.406) / 0.225, 4);
    expect(input.data[0]).toBeCloseTo((0 - 0.485) / 0.229, 4);
  });
});

describe('pictures', () => {
  it('puts a transparent pixel on white', () => {
    expect([...rgbFromRgba(new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0]), 2, 1).data]).toEqual([10, 20, 30, 255, 255, 255]);
  });

  it('resizes a flat colour to the same colour, and leaves the same size alone', () => {
    const img = solid(3, 2, [40, 80, 120]);
    expect(resizeRgb(img, 3, 2)).toBe(img);
    const big = resizeRgb(img, 7, 5);
    expect([big.width, big.height]).toEqual([7, 5]);
    expect(new Set(big.data)).toEqual(new Set([40, 80, 120]));
  });

  it('crops within the picture whatever the box asks for', () => {
    const c = cropRgb(solid(10, 10, [1, 2, 3]), { x0: -5, y0: 8.5, x1: 4.2, y1: 30 });
    expect([c.width, c.height]).toEqual([5, 2]);
  });
});

describe('reading order', () => {
  it('reads down the page, and left to right along a line', () => {
    const order = readingOrder([
      { x0: 300, y0: 12, x1: 400, y1: 30 },
      { x0: 10, y0: 100, x1: 90, y1: 120 },
      { x0: 10, y0: 10, x1: 90, y1: 30 },
    ]);
    expect(order.map((b) => b.x0 + b.y0)).toEqual([20, 312, 110]);
  });
});

describe('a recognised line', () => {
  const dict = ['A', 'B', 'C'];
  const box = { x0: 100, y0: 50, x1: 196, y1: 70 };
  const at = (index: number, step: number) => ({ index, step, score: 0.8 });

  it('splits words at the space class and places each within the line', () => {
    // Classes: 0 blank, 1-3 the list, 4 the space.
    const line = lineFromSequence([at(1, 0), at(2, 2), at(4, 5), at(3, 8)], dict, 4, box, { steps: 10, inputWidth: 320, drawnWidth: 320 });
    expect(line?.text).toBe('AB C');
    expect(line?.words.map((w) => w.text)).toEqual(['AB', 'C']);
    for (const w of line!.words) {
      expect(w.box.x0).toBeGreaterThanOrEqual(box.x0);
      expect(w.box.x1).toBeLessThanOrEqual(box.x1);
    }
    expect(line!.words[0].box.x1).toBeLessThan(line!.words[1].box.x0 + 1);
    expect(line?.confidence).toBeCloseTo(80, 5);
  });

  it('is nothing when nothing was read', () => {
    expect(lineFromSequence([], dict, 4, box, { steps: 10, inputWidth: 320, drawnWidth: 320 })).toBeNull();
    expect(lineFromSequence([at(4, 1)], dict, 4, box, { steps: 10, inputWidth: 320, drawnWidth: 320 })).toBeNull();
  });
});

describe('the reader', () => {
  it('detects a region, recognises it, and returns the page as OCR lines', async () => {
    const tensor = (data: Float32Array, dims: number[]) => ({ data, dims });
    const det: OrtSessionLike = {
      inputNames: ['x'],
      outputNames: ['y'],
      async run(feeds) {
        const { dims } = feeds.x as unknown as { dims: number[] };
        const [, , h, w] = dims;
        const map = new Float32Array(w * h);
        for (let y = 20; y < 30; y++) for (let x = 20; x < 60; x++) map[y * w + x] = 0.95;
        return { y: { data: map, dims: [1, 1, h, w] } };
      },
    };
    // Classes: 0 blank, 1-3 "A", "B", "C", 4 the space: "BA".
    const rec: OrtSessionLike = {
      inputNames: ['x'],
      outputNames: ['y'],
      async run(feeds) {
        const { dims } = feeds.x as unknown as { dims: number[] };
        const steps = 6;
        const probs = new Float32Array(dims[0] * steps * 5);
        [2, 0, 1, 0, 0, 0].forEach((k, t) => (probs[t * 5 + k] = 0.9));
        return { y: { data: probs, dims: [dims[0], steps, 5] } };
      },
    };
    const progress: number[] = [];
    const page = await paddleReader(det, rec, ['A', 'B', 'C'], tensor).read(solid(64, 64, [255, 255, 255]), 96, (f) => progress.push(f));
    expect(page.dpi).toBe(96);
    expect(page.lines.map((l) => l.text)).toEqual(['BA']);
    expect(page.lines[0].box.x0).toBeLessThan(20);
    expect(page.lines[0].box.x1).toBeGreaterThan(60);
    expect(progress.at(-1)).toBe(1);
    expect(page.detected).toBe(1);
    expect(page.unsureBelow).toBe(95);
  });

  it('tells a page in another script by the share of its regions read, not by confidence', () => {
    const line = { text: '10234', box: { x0: 0, y0: 0, x1: 10, y1: 10 }, confidence: 99, words: [] };
    // Measured: Arabic lines came back as their digits alone, one region in four, at 99.5.
    expect(readShare({ width: 1, height: 1, dpi: null, lines: [line], detected: 4 })).toBeLessThan(MIN_READ_SHARE);
    expect(readShare({ width: 1, height: 1, dpi: null, lines: [line, line, line], detected: 4 })).toBeGreaterThan(MIN_READ_SHARE);
    expect(readShare({ width: 1, height: 1, dpi: null, lines: [], detected: 0 })).toBe(1);
  });
});

describe('the recogniser input', () => {
  it('pads a short region to the narrowest width asked for, 320 when none is', async () => {
    const widths: number[] = [];
    const rec: OrtSessionLike = {
      inputNames: ['x'],
      outputNames: ['y'],
      async run(feeds) {
        const { dims } = feeds.x as unknown as { dims: number[] };
        widths.push(dims[3]);
        return { y: { data: new Float32Array(dims[0] * 4 * 5), dims: [dims[0], 4, 5] } };
      },
    };
    const tensor = (data: Float32Array, dims: number[]) => ({ data, dims });
    // A region 40 x 20: twice as wide as tall, so 96 pixels at the recogniser's height of 48.
    const box = [{ x0: 0, y0: 0, x1: 40, y1: 20 }];
    await recognizeRegions(rec, ['A', 'B', 'C'], solid(64, 32, [255, 255, 255]), box, tensor);
    await recognizeRegions(rec, ['A', 'B', 'C'], solid(64, 32, [255, 255, 255]), box, tensor, undefined, 96);
    await recognizeRegions(rec, ['A', 'B', 'C'], solid(64, 32, [255, 255, 255]), box, tensor, undefined, 48);
    expect(widths).toEqual([320, 96, 96]);
  });
});
