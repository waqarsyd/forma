import { describe, it, expect } from 'vitest';
import { HANDWRITING_BELOW, HANDWRITING_CONFIDENCE, lineCrop, unsureLines, withHandwriting } from './handwriting';
import type { OcrPage } from './ocr';

const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
const page: OcrPage = {
  width: 800,
  height: 400,
  dpi: null,
  lines: [
    { text: 'Invoice 42', box: box(20, 20, 300, 50), confidence: 96, words: [{ text: 'Invoice', box: box(20, 20, 200, 50), confidence: 97 }, { text: '42', box: box(220, 20, 300, 50), confidence: 95 }] },
    { text: 'Tt wer «a splendid', box: box(10, 100, 780, 160), confidence: 41, words: [{ text: 'Tt', box: box(10, 100, 60, 160), confidence: 30 }] },
    { text: 'Received 1o', box: box(20, 200, 400, 240), confidence: HANDWRITING_BELOW, words: [{ text: 'Received', box: box(20, 200, 300, 240), confidence: 70 }] },
  ],
};

/*
 * Handwriting read again by TrOCR (2026-11-04). Measured on 60 real lines,
 * 40 in handwriting fonts and 20 printed: reading again only what Tesseract
 * read below 70 kept the printed lines exact and brought real handwriting
 * from 47.4% of characters wrong to 10.6%.
 */
describe('handwriting', () => {
  it('reads again only the lines Tesseract was unsure of, below 70', () => {
    expect(unsureLines(page)).toEqual([1]);
    expect(unsureLines(page, 80)).toEqual([1, 2]);
  });

  it('cuts a line with room around its ink, inside the page', () => {
    // 60 high: a fifth (12) above and below, half (30) at the sides.
    expect(lineCrop(box(10, 100, 780, 160), page)).toEqual(box(0, 88, 800, 172));
    expect(lineCrop(box(100, 100, 200, 150), page)).toEqual(box(75, 90, 225, 160));
  });

  it('puts what TrOCR read in place of the line, as one word over its box', () => {
    const read = withHandwriting(page, new Map([[1, '  It was a   splendid ']]));
    expect(read.lines[1]).toEqual({
      text: 'It was a splendid',
      box: page.lines[1].box,
      confidence: HANDWRITING_CONFIDENCE,
      words: [{ text: 'It was a splendid', box: page.lines[1].box, confidence: HANDWRITING_CONFIDENCE }],
    });
    expect(read.lines[0]).toBe(page.lines[0]);
  });

  it("keeps Tesseract's line where TrOCR read nothing", () => {
    expect(withHandwriting(page, new Map([[1, '  ']])).lines[1]).toBe(page.lines[1]);
  });

  it('gives a line it read a confidence that is not flagged, and no more', () => {
    // ocrLayout flags a word below 60 for review; TrOCR's 10% error is not certainty either.
    expect(HANDWRITING_CONFIDENCE).toBe(60);
  });
});
