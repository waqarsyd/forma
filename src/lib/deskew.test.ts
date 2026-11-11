import { describe, expect, it } from 'vitest';
import { inkPoints, lineScore, marginRatio, otsuThreshold, pageShaped, pageTurn, type Ink } from './deskew';

/*
 * Made-up pages (2026-11-11, the full audit's CP-05): twenty lines of "text",
 * each a bar six pixels high, starting together at the left margin and ending
 * ragged, as a page of prose or a report's captions do, turned clockwise by a
 * known angle about the page's centre.
 */
function page(degrees: number, { width = 600, height = 800 } = {}): Ink {
  const lengths = [380, 300, 410, 260, 350, 400, 220, 330, 390, 280, 360, 240, 405, 310, 270, 395, 345, 230, 385, 290];
  const sin = Math.sin((degrees * Math.PI) / 180);
  const cos = Math.cos((degrees * Math.PI) / 180);
  const out: number[] = [];
  lengths.forEach((length, line) => {
    const top = -250 + line * 26;
    for (let y = top; y < top + 6; y++) {
      for (let x = -220; x < -220 + length; x++) out.push(x * cos - y * sin, x * sin + y * cos);
    }
  });
  return { points: Float32Array.from(out), width, height };
}

describe('otsuThreshold and inkPoints', () => {
  it('separates dark ink from a light page', () => {
    const gray = [...new Array(90).fill(240), ...new Array(10).fill(20)];
    const t = otsuThreshold(gray);
    expect(t).toBeGreaterThanOrEqual(20);
    expect(t).toBeLessThan(240);
  });

  it('keeps the dark pixels, about the centre', () => {
    // A 4 by 2 picture, white but for one black pixel at (3, 1).
    const rgba = new Array(4 * 2 * 4).fill(255);
    rgba.splice((1 * 4 + 3) * 4, 3, 0, 0, 0);
    const ink = inkPoints(rgba, 4, 2);
    expect([...ink.points]).toEqual([1, 0]);
  });

  it('reads a picture that is mostly dark as having no text', () => {
    expect(inkPoints(new Array(4 * 4 * 4).fill(0), 4, 4).points.length).toBe(0);
  });
});

describe('pageTurn', () => {
  it('finds a phone photo a few degrees off, either way', () => {
    expect(pageTurn(page(3))).toBeCloseTo(3, 0);
    expect(Math.abs(pageTurn(page(-2.5)) + 2.5)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(pageTurn(page(5.75)) - 5.75)).toBeLessThanOrEqual(0.25);
  });

  it('leaves a straight page, and one too little off to be worth redrawing, as it is', () => {
    expect(pageTurn(page(0))).toBe(0);
    expect(pageTurn(page(0.25))).toBe(0);
  });

  it('finds a page on its side, and which side', () => {
    expect(pageTurn(page(90))).toBe(90);
    expect(pageTurn(page(270))).toBe(270);
    // On its side and a little off as well.
    expect(Math.abs(pageTurn(page(92)) - 92)).toBeLessThanOrEqual(0.25);
  });

  it('turns only a picture shaped like a page on its side, never a logo or a barcode', () => {
    expect(pageShaped(1200, 1600)).toBe(true);
    expect(pageShaped(4032, 3024)).toBe(true);
    expect(pageShaped(240, 120)).toBe(false); // a logo
    expect(pageShaped(1800, 600)).toBe(false); // a barcode or a banner
    // Not allowed on its side, a page that lies there is only straightened.
    expect(pageTurn(page(90), false)).toBe(0);
    expect(pageTurn(page(3), false)).toBeCloseTo(3, 0);
  });

  it('never turns over a page that already reads across', () => {
    // Upside down, its lines end together and start ragged; it is left, as a right-aligned page would be.
    expect(pageTurn(page(180))).toBe(0);
  });

  it('says nothing of a picture with too little ink', () => {
    expect(pageTurn({ points: Float32Array.from([1, 2, 3, 4]), width: 10, height: 10 })).toBe(0);
  });

  it('scores lines sharpest across, and their starts as the aligned margin', () => {
    const straight = page(0);
    expect(lineScore(straight, 0)).toBeGreaterThan(lineScore(straight, 4));
    expect(marginRatio(straight, 0)).toBeLessThan(1);
    expect(marginRatio(straight, 180)).toBeGreaterThan(1);
  });
});
