/**
 * Where the original goes under the Preview's page (2026-11-11, the full
 * audit's CP-03), on made-up pictures.
 */
import { describe, expect, it } from 'vitest';
import { inkBounds, isWholePage, placeSource, unionBox } from './sourceAlign';

/** A white RGBA picture with black rectangles. */
function picture(width: number, height: number, inked: { x0: number; y0: number; x1: number; y1: number }[], alpha = 255): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let i = 3; i < data.length; i += 4) data[i] = alpha;
  for (const r of inked)
    for (let y = r.y0; y < r.y1; y++)
      for (let x = r.x0; x < r.x1; x++) data.set([0, 0, 0, 255], (y * width + x) * 4);
  return data;
}

describe('inkBounds', () => {
  it('is the box round everything printed', () => {
    const data = picture(200, 100, [{ x0: 20, y0: 10, x1: 60, y1: 20 }, { x0: 30, y0: 50, x1: 180, y1: 90 }]);
    expect(inkBounds(data, 200, 100)).toEqual({ x0: 20, y0: 10, x1: 180, y1: 90 });
  });

  it('is null for a blank picture, and takes transparent pixels as paper', () => {
    expect(inkBounds(picture(50, 50, []), 50, 50)).toBeNull();
    expect(inkBounds(picture(50, 50, [], 0), 50, 50)).toBeNull();
    expect(inkBounds(new Uint8ClampedArray(4), 50, 50)).toBeNull();
  });

  it('is not stretched by a speck near an edge on a large picture', () => {
    const data = picture(1000, 1000, [{ x0: 100, y0: 100, x1: 900, y1: 900 }, { x0: 995, y0: 2, x1: 996, y1: 3 }]);
    expect(inkBounds(data, 1000, 1000)).toEqual({ x0: 100, y0: 100, x1: 900, y1: 900 });
  });
});

describe('placeSource', () => {
  const page = { width: 816, height: 1056, content: { x0: 96, y0: 96, x1: 720, y1: 400 } };

  it('covers the page with a picture of a whole page, whatever its ink', () => {
    expect(isWholePage({ width: 1275, height: 1650 }, page)).toBe(true);
    expect(placeSource({ width: 1275, height: 1650, ink: { x0: 0, y0: 0, x1: 10, y1: 10 } }, page)).toEqual({ x0: 0, y0: 0, x1: 816, y1: 1056 });
  });

  it("fits a cropped screenshot's ink to the page's content by the widths", () => {
    // Ink 312 px wide from (10, 20): twice smaller than the content's 624.
    const at = placeSource({ width: 400, height: 200, ink: { x0: 10, y0: 20, x1: 322, y1: 180 } }, page);
    expect(at).toEqual({ x0: 76, y0: 56, x1: 876, y1: 456 });
  });

  it('lays a picture at the top left at the page width when either box is missing', () => {
    expect(placeSource({ width: 408, height: 100, ink: null }, page)).toEqual({ x0: 0, y0: 0, x1: 816, y1: 200 });
    expect(placeSource({ width: 408, height: 100, ink: { x0: 0, y0: 0, x1: 10, y1: 10 } }, { ...page, content: null })).toEqual({ x0: 0, y0: 0, x1: 816, y1: 200 });
  });
});

describe('unionBox', () => {
  it('is the box round the boxes, or null for none', () => {
    expect(unionBox([{ x0: 5, y0: 9, x1: 10, y1: 12 }, { x0: 1, y0: 10, x1: 7, y1: 30 }])).toEqual({ x0: 1, y0: 9, x1: 10, y1: 30 });
    expect(unionBox([])).toBeNull();
  });
});
