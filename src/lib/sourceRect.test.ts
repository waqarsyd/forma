import { describe, it, expect } from 'vitest';
import { boxToSourceRect, sourceRectFor } from './sourceRect';
import type { ReportElement } from './reportTypes';

/**
 * The whole point of this file is the coordinate order. Reading `box2d` x-first
 * instead of y-first produces a crop in a believable but wrong place, which
 * looks like a model failure rather than a code bug — so it is asserted with a
 * deliberately asymmetric box where transposing changes the answer.
 */
describe('boxToSourceRect', () => {
  it('reads box2d as [ymin, xmin, ymax, xmax], not x-first', () => {
    // Near the top-right: y 100-200 (high up), x 800-900 (far right).
    const rect = boxToSourceRect([100, 800, 200, 900]);

    expect(rect).toEqual({ x: 0.8, y: 0.1, width: 0.1, height: 0.1 });
    // Guard the failure mode explicitly: transposed, x would be 0.1.
    expect(rect!.x).not.toBeCloseTo(0.1);
  });

  it('normalises from 0-1000 to fractions', () => {
    expect(boxToSourceRect([0, 0, 1000, 1000])).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(boxToSourceRect([250, 500, 750, 1000])).toEqual({ x: 0.5, y: 0.25, width: 0.5, height: 0.5 });
  });

  it('keeps a tall box tall and a wide box wide', () => {
    // A signature strip: short in y, long in x.
    const wide = boxToSourceRect([400, 100, 450, 900])!;
    expect(wide.width).toBeGreaterThan(wide.height);

    // A vertical spine: long in y, narrow in x.
    const tall = boxToSourceRect([100, 400, 900, 450])!;
    expect(tall.height).toBeGreaterThan(tall.width);
  });

  it('rejects malformed input rather than producing a plausible rectangle', () => {
    expect(boxToSourceRect(undefined)).toBeNull();
    expect(boxToSourceRect([])).toBeNull();
    expect(boxToSourceRect([1, 2, 3])).toBeNull();
    expect(boxToSourceRect([1, 2, 3, 4, 5])).toBeNull();
    expect(boxToSourceRect([NaN, 0, 100, 100])).toBeNull();
    expect(boxToSourceRect([0, 0, Infinity, 100])).toBeNull();
    expect(boxToSourceRect(['0', '0', '100', '100'] as unknown as number[])).toBeNull();
  });

  it('rejects zero and inverted extents', () => {
    expect(boxToSourceRect([500, 500, 500, 600])).toBeNull(); // no height
    expect(boxToSourceRect([500, 500, 600, 500])).toBeNull(); // no width
    expect(boxToSourceRect([600, 500, 500, 600])).toBeNull(); // ymax < ymin
    expect(boxToSourceRect([500, 600, 600, 500])).toBeNull(); // xmax < xmin
  });
});

describe('sourceRectFor', () => {
  const base = { type: 'image', x: 0, y: 0, width: 10, height: 10 } as unknown as ReportElement;

  it('prefers box2d over the legacy sourceRect', () => {
    const el = {
      ...base,
      box2d: [100, 800, 200, 900],
      sourceRect: { x: 0.01, y: 0.02, width: 0.03, height: 0.04 },
    } as ReportElement;

    expect(sourceRectFor(el)).toEqual({ x: 0.8, y: 0.1, width: 0.1, height: 0.1 });
  });

  it('falls back to sourceRect so reports saved before box2d still render', () => {
    const legacy = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    expect(sourceRectFor({ ...base, sourceRect: legacy } as ReportElement)).toEqual(legacy);
  });

  it('falls back when box2d is present but unusable', () => {
    const legacy = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    const el = { ...base, box2d: [5, 5, 5, 5], sourceRect: legacy } as ReportElement;
    expect(sourceRectFor(el)).toEqual(legacy);
  });

  it('returns null when the element carries neither', () => {
    expect(sourceRectFor(base)).toBeNull();
  });
});

/**
 * The guard used to catch malformed boxes and let implausible ones through,
 * which is the wrong way round for a value that fails silently (audit BUG-004).
 * This is model output: a hallucinated coordinate outside the documented 0-1000
 * range produced a crop rectangle partly or wholly outside the image, rendered
 * without complaint.
 */
describe('boxToSourceRect clamps to the documented range', () => {
  it('no longer returns a negative origin', () => {
    // The reported case: [-1, -1, 2, 2] used to yield x and y of -0.001.
    const rect = boxToSourceRect([-1, -1, 2, 2]);
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.y).toBeGreaterThanOrEqual(0);
  });

  it('never returns a rectangle reaching outside the image', () => {
    for (const box of [
      [0, 0, 5000, 5000],
      [-500, -500, 1500, 1500],
      [900, 900, 3000, 3000],
    ]) {
      const rect = boxToSourceRect(box);
      if (!rect) continue;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(1);
      expect(rect.y + rect.height).toBeLessThanOrEqual(1);
    }
  });

  it('salvages a near-miss rather than dropping it', () => {
    // Slightly over is far more likely to be an off-by-one than garbage, so it
    // is clamped to the edge instead of rejected.
    expect(boxToSourceRect([0, 0, 1001, 1001])).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('drops a box that lies entirely outside the image', () => {
    // Clamping collapses it to zero area, and a zero-area crop is not something
    // to hand the renderer.
    expect(boxToSourceRect([2000, 2000, 3000, 3000])).toBeNull();
    expect(boxToSourceRect([-900, -900, -100, -100])).toBeNull();
  });

  it('leaves a box inside the range exactly as it was', () => {
    expect(boxToSourceRect([100, 800, 200, 900])).toEqual({ x: 0.8, y: 0.1, width: 0.1, height: 0.1 });
  });
});