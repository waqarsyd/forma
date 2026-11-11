import { describe, expect, it } from 'vitest';
import type { PreviewMeta } from './attachments';
import type { OcrLine, OcrPage } from './ocr';
import { buildFromRead, ocrTexts, sourceLayoutOf, type ReadPage } from './ocrAttach';

/*
 * A page OCR read, built into a report with no AI (2026-11-11, the full
 * audit's TC-08a): what the chat box makes of a picture when no AI answers,
 * and what the review's Build .repx makes. It had no test of its own; the
 * engine's side is ocr.test.ts.
 */

/** A line of words, each 60 pixels wide with a 20-pixel gap, at `y` from `x`. */
function line(words: string[], x: number, y: number, confidence = 95): OcrLine {
  const out = words.map((text, i) => ({ text, confidence, box: { x0: x + i * 80, y0: y, x1: x + i * 80 + 60, y1: y + 24 } }));
  return { text: words.join(' '), confidence, box: { x0: x, y0: y, x1: out[out.length - 1].box.x1, y1: y + 24 }, words: out };
}

/** A letter page at 150 dpi, as a rendered PDF page reaches OCR. */
const page = (lines: OcrLine[]): OcrPage => ({ width: 1275, height: 1650, dpi: 150, lines });
const read = (lines: OcrLine[]): ReadPage => ({ ocr: page(lines), flagged: 0, lines: lines.length });
const meta: PreviewMeta = { uploadId: 'u1', file: 'Invoice 42.pdf', page: 1, pagePoints: { width: 612, height: 792 } };

const invoice = [
  line(['INVOICE'], 150, 120),
  line(['Date:', '2026-01-05'], 150, 200),
  line(['Item', 'Qty', 'Price'], 150, 320),
  line(['Tea', '2', '4.00'], 150, 360),
  line(['Milk', '1', '1.20'], 150, 400),
  line(['Sugar', '3', '2.10'], 150, 440),
];

describe('buildFromRead', () => {
  it('builds a report of every text read, named after the file', () => {
    const built = buildFromRead([{ meta, read: read(invoice) }], 'HundredthsOfAnInch', 'Letter')!;
    expect(built.title).toBe('Invoice 42');
    expect(built.repxContent).toMatch(/<XtraReportsLayoutSerializer\b/);
    for (const text of ['INVOICE', '2026-01-05', 'Qty', 'Sugar', '2.10']) expect(built.repxContent).toContain(text);
    expect(built.markdown).toMatch(/^# Invoice 42/m);
    expect(built.layout.title).toBe('Invoice 42');
    expect(built.flagged).toBe(0);
    expect(Array.isArray(built.problems)).toBe(true);
  });

  it('marks the words read without confidence', () => {
    const unsure = [...invoice.slice(0, 5), line(['Sugar', '3', '2.1O'], 150, 440, 30)];
    const built = buildFromRead([{ meta, read: read(unsure) }], 'HundredthsOfAnInch', 'Letter')!;
    expect(built.flagged).toBeGreaterThan(0);
  });

  it('builds nothing from nothing', () => {
    expect(buildFromRead([], 'HundredthsOfAnInch', 'Letter')).toBeNull();
  });
});

describe("OCR's own reading of the source", () => {
  it('is the layout the audit checks the AI against, and nothing when nothing was read', () => {
    const layout = sourceLayoutOf([{ meta, read: read(invoice) }], 'HundredthsOfAnInch', 'Letter');
    expect(layout).not.toBeNull();
    expect(JSON.stringify(layout)).toContain('Sugar');
    expect(sourceLayoutOf([{ meta, read: read([]) }], 'HundredthsOfAnInch', 'Letter')).toBeNull();
  });

  it('goes with the message as one text per page, tied to its upload', () => {
    const texts = ocrTexts([{ meta, read: read(invoice) }], 'HundredthsOfAnInch', 'Letter');
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ uploadId: 'u1', file: 'Invoice 42.pdf', page: 1 });
    expect(texts[0].text).toContain('INVOICE');
  });
});
