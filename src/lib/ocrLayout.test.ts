import { describe, expect, it } from 'vitest';
import { detectLayout, fontFromInk, fontFromWidth, layoutText } from './ocrLayout';
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
    // One size for every cell, the median of theirs.
    expect(new Set(t.rows.flatMap((r) => r.cells.map((c) => c?.fontSize))).size).toBe(1);
  });

  it('keeps words a space apart in one label, and a single row of two texts as labels', () => {
    const [p] = layoutOf([line(100, ['Bill', 60, 80], ['to', 84, 96]), line(140, ['Total', 60, 90], ['42.00', 400, 440])]).pages;
    expect(p.tables).toEqual([]);
    expect(p.labels.map((l) => l.text)).toEqual(['Bill to', 'Total', '42.00']);
  });

  it('splits two amounts side by side, however close, but not a number with a space between its thousands', () => {
    const [p] = layoutOf([
      line(100, ['894', 300, 318], ['213,086.00', 324, 380], ['184,088.14', 386, 442]),
      line(140, ['Total', 60, 90], ['1', 300, 306], ['250.00', 310, 346]),
      line(180, ['Invoice', 60, 100], ['42', 104, 116]),
    ]).pages;
    expect(p.labels.map((l) => l.text)).toEqual(['894', '213,086.00', '184,088.14', 'Total', '1 250.00', 'Invoice 42']);
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

  it('does not run a row into a table it does not line up with, however close', () => {
    // s23-gen: a chart's axis labels sit just above the cross-tab printed under it.
    const [p] = layoutOf([
      line(280, ['North', 157, 187], ['South', 307, 338], ['West', 461, 489]),
      line(300, ['Region', 50, 91], ['Q1', 151, 166], ['Q2', 250, 267], ['Q3', 350, 367], ['Q4', 450, 468], ['Total', 550, 620]),
      line(320, ['North', 51, 85], ['100', 152, 171], ['400', 251, 272], ['700', 352, 373], ['1000', 452, 480], ['2200', 551, 579]),
    ]).pages;
    expect(p.tables).toHaveLength(1);
    expect(p.tables[0].rows.map((r) => r.cells[0]?.text)).toEqual(['Region', 'North']);
    expect(p.labels.map((l) => l.text)).toEqual(['North', 'South', 'West']);
  });

  it('keeps values printed on a picture out of tables, and sets aside a mark with no letter or digit', () => {
    const bar = (x0: number, x1: number): OcrLine => {
      const l = line(200, ['||', x0, x1, 30]);
      l.box = { ...l.box, y1: 360 };
      l.words[0].box = { ...l.words[0].box, y1: 360 };
      return l;
    };
    const layout = layoutOf([
      bar(300, 340),
      bar(400, 440),
      line(210, ['1000', 305, 335], ['1200', 405, 435]),
      line(230, ['700', 305, 330], ['900', 405, 430]),
      line(400, ['Sales', 60, 90], ['|]', 300, 304, 50]),
    ]);
    const [p] = layout.pages;
    expect(p.tables).toEqual([]);
    expect(p.labels.map((l) => l.text).sort()).toEqual(['1000', '1200', '700', '900', 'Sales']);
    expect(p.ignored.map((l) => l.text)).toEqual(['||', '||', '|]']);
    // A letter or two standing far taller than the text is a picture too.
    const big: OcrLine = { ...line(500, ['B', 300, 330, 90]), box: { x0: 300, y0: 500, x1: 330, y1: 530 } };
    big.words[0].box = { x0: 300, y0: 500, x1: 330, y1: 530 };
    expect(layoutOf([line(100, ['Sales', 60, 90]), line(120, ['North', 60, 95]), big]).pages[0].ignored.map((l) => l.text)).toEqual(['B']);
  });
  it('sizes a table by the widths of its cells when their boxes take in the borders', () => {
    // s23-gen's cross-tab: Tesseract's boxes were as tall as the cells.
    const boxed = (l: OcrLine): OcrLine => ({
      ...l,
      box: { ...l.box, y1: l.box.y0 + 30 },
      words: l.words.map((w) => ({ ...w, box: { ...w.box, y1: w.box.y0 + 30 } })),
    });
    const [p] = layoutOf([
      boxed(line(300, ['Region', 60, 100], ['Q1', 300, 318], ['Total', 450, 480])),
      boxed(line(340, ['North', 60, 92], ['1000', 300, 327], ['2200', 450, 477])),
    ]).pages;
    expect(p.tables).toHaveLength(1);
    // By height every cell is 31pt; by width they run 8.5 to 10.5, and the median is 9.
    expect(p.tables[0].rows.flatMap((r) => r.cells.map((c) => c?.fontSize))).toEqual([9, 9, 9, 9, 9, 9]);
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

  it('reads a size from the width as well, digits about half an em', () => {
    // 1000 at 9.75pt in Times New Roman is 19.5pt wide, 27.08 hundredths of an inch.
    expect(fontFromWidth('1000', 27.08, 'HundredthsOfAnInch')).toBe(9);
    expect(fontFromWidth('Region', 40, 'HundredthsOfAnInch')).toBe(9.5);
    expect(fontFromWidth('', 40, 'HundredthsOfAnInch')).toBe(48);
  });
});

describe('layoutText', () => {
  it('writes every string with its box for the model, tables as tables, unsure strings marked', () => {
    const [p] = layoutOf([
      line(100, ['Total', 60, 90], ['due', 94, 112, 41]),
      line(300, ['Item', 60, 90], ['Qty', 300, 325], ['Price', 450, 490]),
      line(320, ['Chai', 60, 88], ['12', 305, 320], ['18.00', 450, 492]),
    ]).pages;
    const lines = layoutText(p, 3, 'HundredthsOfAnInch', 'scan.pdf').split('\n');
    expect(lines[0]).toMatch(/^scan\.pdf, page 3: text READ BY OCR from the page image/);
    expect(lines[1]).toBe('Page is 850 x 1100 report units.');
    expect(lines[2]).toMatch(/^"Total due" x=60 y=97 w=52 h=\d+ size=9\.5pt LOW CONFIDENCE \(41\)$/);
    expect(lines[3]).toMatch(/^Table 1: x=60 y=\d+, 3 columns of widths \d+, \d+, \d+, 2 rows:$/);
    expect(lines[4]).toMatch(/^ {2}row y=\d+ h=\d+: "Item" .* \| "Qty" .* \| "Price" .*$/);
    expect(lines).toHaveLength(6);
  });
});