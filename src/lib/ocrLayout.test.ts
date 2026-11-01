import { describe, expect, it } from 'vitest';
import { detectLayout, fontFromInk } from './ocrLayout';
import type { OcrLine, OcrPage } from './ocr';

/** A line of words, each `[text, x0, x1, confidence]`, at a height of 13 pixels from `y`. */
function line(y: number, ...words: [string, number, number, number?][]): OcrLine {
  const ws = words.map(([text, x0, x1, confidence = 95]) => ({ text, box: { x0, y0: y, x1, y1: y + 9 }, confidence }));
  return {
    text: ws.map((w) => w.text).join(' '),
    box: { x0: ws[0].box.x0, y0: y, x1: ws[ws.length - 1].box.x1, y1: y + 9 },
    confidence: Math.min(...ws.map((w) => w.confidence)),
    words: ws,
  };
}

/** A Letter page rendered at 100 dpi, so a pixel is a hundredth of an inch. */
const page = (lines: OcrLine[]): OcrPage => ({ width: 850, height: 1100, dpi: 100, lines });
const layoutOf = (lines: OcrLine[], minConfidence?: number) =>
  detectLayout([{ ocr: page(lines), page: { width: 850, height: 1100 } }], { minConfidence });

describe('detectLayout', () => {
  it('places a label where its text was seen, its control from the font\'s ascent', () => {
    const [p] = layoutOf([line(120, ['Customer', 70, 120], ['01', 124, 136])]).pages;
    expect(p.labels).toHaveLength(1);
    const [l] = p.labels;
    expect(l.text).toBe('Customer 01');
    expect(l.ink).toEqual({ x: 70, y: 120, w: 66, h: 9 });
    expect(l.x).toBe(70);
    // A capital's 9 units of ink are 0.7 of a 12.9-unit em, 9.5pt at half points.
    expect(l.fontSize).toBe(9.5);
    expect(l.y).toBeCloseTo(120 - 0.22 * (9 / 0.7), 6);
  });

  it('splits a line at a gap wider than the line is tall, and makes aligned rows a table', () => {
    const [p] = layoutOf([
      line(300, ['Item', 60, 90], ['Qty', 300, 325], ['Price', 450, 490]),
      line(320, ['Chai', 60, 88], ['12', 305, 320], ['18.00', 450, 492]),
      line(340, ['Chang', 60, 100], ['3', 310, 318], ['19.00', 450, 492]),
    ]).pages;
    expect(p.labels).toEqual([]);
    expect(p.tables).toHaveLength(1);
    const [t] = p.tables;
    expect(t.rows.map((r) => r.cells.map((c) => c?.text ?? ''))).toEqual([
      ['Item', 'Qty', 'Price'],
      ['Chai', '12', '18.00'],
      ['Chang', '3', '19.00'],
    ]);
    expect(t.columns).toHaveLength(3);
    expect(t.x).toBe(60);
  });

  it('keeps words a space apart in one label, and a single row of two texts as labels', () => {
    const [p] = layoutOf([line(100, ['Bill', 60, 80], ['to', 84, 96]), line(140, ['Total', 60, 90], ['42.00', 400, 440])]).pages;
    expect(p.tables).toEqual([]);
    expect(p.labels.map((l) => l.text)).toEqual(['Bill to', 'Total', '42.00']);
  });

  it('flags a word read below the confidence threshold, and the label that holds it', () => {
    const layout = layoutOf([line(100, ['Total', 60, 90], ['due', 94, 112, 41])]);
    const [l] = layout.pages[0].labels;
    expect(l.flagged).toBe(true);
    expect(l.confidence).toBe(41);
    expect(l.words.map((w) => w.flagged)).toEqual([false, true]);
    expect(layout).toMatchObject({ total: 1, flagged: 1 });
    expect(layoutOf([line(100, ['Total', 60, 90], ['due', 94, 112, 41])], 40).flagged).toBe(0);
  });

  it('sets aside what reads as a picture: almost no confidence, or far taller than the text', () => {
    const tall: OcrLine = { ...line(200, ['||', 300, 340, 30]), box: { x0: 300, y0: 200, x1: 340, y1: 360 } };
    tall.words[0].box = { x0: 300, y0: 200, x1: 340, y1: 360 };
    const layout = layoutOf([line(100, ['Sales', 60, 90]), line(150, ['@', 60, 70, 4]), tall]);
    expect(layout.pages[0].labels.map((l) => l.text)).toEqual(['Sales']);
    expect(layout.pages[0].ignored.map((l) => l.text).sort()).toEqual(['@', '||']);
    expect(layout.ignored).toBe(2);
  });

  it('narrows a margin the text sits inside, so nothing lands outside the page\'s content', () => {
    const [p] = layoutOf([line(20, ['Header', 30, 90])]).pages;
    expect(p.margins.left).toBe(30);
    expect(p.margins.top).toBeLessThanOrEqual(20);
    expect(p.margins.right).toBe(50);
  });

  it('fits a screenshot to the printable width of Letter at its margins', () => {
    const shot: OcrPage = { width: 375, height: 200, dpi: null, lines: [line(10, ['Wide', 0, 375])] };
    const [p] = detectLayout([{ ocr: shot, page: { width: 850, height: 1100 } }]).pages;
    // 375 pixels across 750 units of printable width: two units a pixel, from the margin.
    expect(p.labels[0].ink.x).toBe(50);
    expect(p.labels[0].ink.w).toBe(750);
  });
});

describe('fontFromInk', () => {
  it('reads the em from capitals, descenders and x-height', () => {
    expect(fontFromInk('Customer 01', 9, 'HundredthsOfAnInch').size).toBe(9.5);
    expect(fontFromInk('Sales report', 12.5, 'HundredthsOfAnInch').size).toBe(10);
    expect(fontFromInk('sum', 7, 'HundredthsOfAnInch').em).toBeCloseTo(14, 6);
    expect(fontFromInk('X', 1, 'HundredthsOfAnInch').size).toBe(6);
    expect(fontFromInk('X', 500, 'HundredthsOfAnInch').size).toBe(48);
  });
});
