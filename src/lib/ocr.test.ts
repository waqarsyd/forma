import { describe, expect, it } from 'vitest';
import { ocrPageFrom } from './ocr';

/*
 * Tesseract's blocks as an OcrPage. The engine itself runs only in a browser
 * (or, for the measurements recorded in app-shell.md, in Node with its own
 * core); what is under test here is the reading of its result.
 */
describe('ocrPageFrom', () => {
  const blocks = [
    {
      paragraphs: [
        {
          lines: [
            {
              text: 'Invoice  42\n',
              confidence: 91,
              bbox: { x0: 20, y0: 40, x1: 220, y1: 70 },
              words: [
                { text: 'Invoice', confidence: 95, bbox: { x0: 20, y0: 40, x1: 140, y1: 70 } },
                { text: ' ', confidence: 0, bbox: { x0: 140, y0: 40, x1: 150, y1: 70 } },
                { text: '42', confidence: 87, bbox: { x0: 160, y0: 40, x1: 220, y1: 70 } },
              ],
            },
            { text: ' ', confidence: 0, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, words: [{ text: ' ', confidence: 0, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }] },
          ],
        },
      ],
    },
  ];

  it('keeps every word with its box and confidence, and a line as its words', () => {
    const page = ocrPageFrom(blocks, { width: 400, height: 300, dpi: 96 });
    expect(page).toMatchObject({ width: 400, height: 300, dpi: 96 });
    expect(page.lines).toHaveLength(1);
    expect(page.lines[0].text).toBe('Invoice 42');
    expect(page.lines[0].words.map((w) => `${w.text}:${w.confidence}`)).toEqual(['Invoice:95', '42:87']);
  });

  it('divides the boxes back when the image was enlarged for recognition', () => {
    const page = ocrPageFrom(blocks, { width: 200, height: 150, dpi: null }, 2);
    expect(page.lines[0].box).toEqual({ x0: 10, y0: 20, x1: 110, y1: 35 });
    expect(page.lines[0].words[1].box).toEqual({ x0: 80, y0: 20, x1: 110, y1: 35 });
  });

  it('reads no blocks as no lines', () => {
    expect(ocrPageFrom(null, { width: 1, height: 1, dpi: null }).lines).toEqual([]);
  });

  // Read in the owner's Chrome with Arabic chosen (2026-11-04): Tesseract wraps
  // a right-to-left word in U+200F and U+200E, which print as nothing.
  it('drops the direction marks Tesseract puts around right-to-left words', () => {
    const word = (text: string) => ({ text, confidence: 90, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } });
    const arabic = [{ paragraphs: [{ lines: [{ text: '', confidence: 90, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 }, words: [word('‏المبلغ‎'), word('‏‎')] }] }] }];
    const page = ocrPageFrom(arabic, { width: 10, height: 10, dpi: null });
    expect(page.lines[0].words.map((w) => w.text)).toEqual(['المبلغ']);
    expect(page.lines[0].text).toBe('المبلغ');
  });
});
