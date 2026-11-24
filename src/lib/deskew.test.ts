import { describe, expect, it } from 'vitest';
import { inkPoints, lineCount, lineScore, marginRatio, otsuThreshold, pageShaped, pageTurn, type Ink } from './deskew';

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

/*
 * A made-up form (2026-11-24): a title across the top, twenty-four short
 * labels stacked at the left margin in four blocks of six, and a line at the
 * foot, with nothing beside the labels, as a FastReport employee list's draft
 * PDF drew them, at the proportions of the intake's 700-pixel sample of that
 * page (the fidelity benchmark's parity gate, where the intake laid it on its
 * side). Each bar is six pixels high, turned clockwise about the centre.
 */
function form(degrees: number): Ink {
  const bars: [number, number, number][] = [[4, -316, 76]];
  const lengths = [37, 40, 18, 34, 27, 25];
  const tops = [0, 13, 26, 39, 52, 70];
  for (let block = 0; block < 4; block++) for (let row = 0; row < 6; row++) bars.push([-199, -258 + block * 158 + tops[row], lengths[row]]);
  bars.push([-199, 311, 89]);
  const sin = Math.sin((degrees * Math.PI) / 180);
  const cos = Math.cos((degrees * Math.PI) / 180);
  const out: number[] = [];
  for (const [left, top, length] of bars) {
    for (let y = top; y < top + 6; y++) {
      for (let x = left; x < left + length; x++) out.push(x * cos - y * sin, x * sin + y * cos);
    }
  }
  return { points: Float32Array.from(out), width: 540, height: 700 };
}

/** The same ink inside a one-pixel frame four pixels in from the picture's edge, as a scanned page's border or a photographed page's edge draws one. */
function framed(ink: Ink): Ink {
  const { width: w, height: h } = ink;
  const out = Array.from(ink.points);
  for (let x = -w / 2 + 4; x < w / 2 - 4; x++) out.push(x, -h / 2 + 4, x, h / 2 - 5);
  for (let y = -h / 2 + 5; y < h / 2 - 5; y++) out.push(-w / 2 + 4, y, w / 2 - 5, y);
  return { points: Float32Array.from(out), width: w, height: h };
}

/*
 * A page in two columns of ten lines with a rule between them (2026-11-24,
 * the wave-10 review): turned back it holds ink in every row, the rule's, so
 * it makes one line; as it lies it makes three, the columns and the rule. Its
 * columns score it on its side six times over, so the score decides.
 */
function twoColumns(degrees: number): Ink {
  const right = [190, 150, 200, 120, 170, 200, 140, 180, 160, 130];
  const bars: [number, number, number][] = [];
  right.forEach((length, line) => bars.push([-220, -150 + line * 30, 200], [20, -150 + line * 30, length]));
  const sin = Math.sin((degrees * Math.PI) / 180);
  const cos = Math.cos((degrees * Math.PI) / 180);
  const out: number[] = [];
  for (const [left, top, length] of bars) {
    for (let y = top; y < top + 6; y++) {
      for (let x = left; x < left + length; x++) out.push(x * cos - y * sin, x * sin + y * cos);
    }
  }
  for (let y = -160; y < 160; y++) out.push(-y * sin, y * cos);
  return { points: Float32Array.from(out), width: 800, height: 600 };
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

  it('keeps a straight form of short stacked labels upright, though its column scores higher sideways', () => {
    const straight = form(0);
    // The test the sideways rule began with alone would lay it on its side: the column turned is one dense band.
    expect(lineScore(straight, 90)).toBeGreaterThan(lineScore(straight, 0) * 2);
    // But it holds a line a label only as it stands.
    expect(lineCount(straight, 0)).toBe(26);
    expect(lineCount(straight, 90)).toBe(2);
    expect(pageTurn(straight)).toBe(0);
    // A form a little off is still straightened, and a page of lines on its side still found.
    expect(pageTurn(form(3))).toBeCloseTo(3, 0);
    expect(pageTurn(form(-2))).toBeCloseTo(-2, 0);
    expect(lineCount(page(90), 90)).toBeGreaterThan(lineCount(page(90), 0));
    expect(pageTurn(page(90))).toBe(90);
  });

  it('still finds a framed page on its side, where the frame makes one line each way, and keeps a framed form upright', () => {
    // The wave-10 review: requiring more lines turned back kept these on their side, though the score alone had turned them.
    const sideways = framed(page(90, { width: 800, height: 600 }));
    expect(lineCount(sideways, 0)).toBe(1);
    expect(lineCount(sideways, 90)).toBe(1);
    expect(pageTurn(sideways)).toBe(90);
    expect(Math.abs(pageTurn(framed(page(92, { width: 800, height: 600 }))) - 92)).toBeLessThanOrEqual(0.25);
    expect(pageTurn(framed(page(0)))).toBe(0);
    // The frame brings the form's sideways score under twice the upright one, so the count is never asked.
    expect(pageTurn(framed(form(0)))).toBe(0);
  });

  it('turns a page clearly on its side by its score, whatever its lines say', () => {
    const sideways = twoColumns(90);
    expect(lineScore(sideways, 90)).toBeGreaterThan(lineScore(sideways, 0) * 4);
    expect(lineCount(sideways, 90)).toBeLessThan(lineCount(sideways, 0));
    expect(pageTurn(sideways)).toBe(90);
    expect(pageTurn(twoColumns(0))).toBe(0);
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
