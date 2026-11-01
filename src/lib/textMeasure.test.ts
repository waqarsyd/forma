/**
 * Line breaking and line spacing, as DevExpress 20.1 printed them through
 * `RepxProbe render` on 2026-10-30 (rows 7 and 8 of
 * docs/proposals/devexpress-parity.md). The browser's canvas, running this same
 * `wrapText`, broke all 18 of the texts DevExpress printed, in 9 fonts, into
 * identical lines; these cases pin the rules that made that true.
 */
import { describe, it, expect } from 'vitest';
import { wrapText, lineSpacingPt, linesHeightPt, cssFont, canvasMeasurer, gdiKerns, synthesizedBold, boldWideningPt, GROW_EXTRA_PT } from './textMeasure';

/** Every character one point wide, so widths are character counts. */
const mono = (s: string) => s.length;

describe('wrapText', () => {
  it('breaks greedily at spaces', () => {
    expect(wrapText('the quick brown fox jumps', mono, 12)).toEqual(['the quick', 'brown fox', 'jumps']);
  });

  it('fits a line up to 22.5 millionths wider than the area, as DevExpress did (row 59)', () => {
    // s43: Courier New 10pt's 166.6938-unit line wrapped in a 166.69 box,
    // 22.8 millionths over; texts with nothing to kern all agreed on 22.3 to
    // 22.8. And 36 Courier New characters at 10pt, 216.035pt, did not fit a
    // 216pt area, while Arial's 215.97pt line did (row 7).
    expect(wrapText('abcde fghij', mono, 11)).toEqual(['abcde fghij']);
    expect(wrapText('abcde fghij', mono, 11 / (1 + 22e-6))).toEqual(['abcde fghij']);
    expect(wrapText('abcde fghij', mono, 11 / (1 + 23e-6))).toEqual(['abcde', 'fghij']);
    const courier = (s: string) => s.length * 6.0009722; // 1229/2048 of 10pt
    expect(wrapText(`${'a'.repeat(31)} bcde`, courier, 216)).toEqual(['a'.repeat(31), 'bcde']);
  });

  it('breaks after a hyphen inside a word, as DevExpress printed "cut-" / "off,"', () => {
    expect(wrapText('missed the cut-off, and', mono, 16)).toEqual(['missed the cut-', 'off, and']);
    // A word that fits whole is not split at its hyphen.
    expect(wrapText('a cut-off', mono, 20)).toEqual(['a cut-off']);
  });

  it('breaks a word wider than the whole line between characters', () => {
    // Three characters per line where four are a little too wide; "j xy" is
    // four wide, so it does not fit either.
    expect(wrapText('abcdefghij xy', mono, 3.99)).toEqual(['abc', 'def', 'ghi', 'j', 'xy']);
    expect(wrapText('abcdefghij xy', mono, 4.5)).toEqual(['abcd', 'efgh', 'ij', 'xy']);
  });

  it('keeps explicit line breaks and drops a trailing empty line', () => {
    expect(wrapText('one\ntwo three\n', mono, 100)).toEqual(['one', 'two three']);
    expect(wrapText('a\r\nb', mono, 100)).toEqual(['a', 'b']);
  });

  it('gives no lines for no text, which is what lets an empty CanShrink control collapse', () => {
    expect(wrapText('', mono, 10)).toEqual([]);
  });

  it('collapses runs of spaces between words', () => {
    expect(wrapText('a   b', mono, 100)).toEqual(['a b']);
  });

  it('wraps a long text in reasonable time', () => {
    const long = 'word '.repeat(20_000);
    const started = performance.now();
    const lines = wrapText(long, mono, 60);
    expect(lines.length).toBe(Math.ceil(20_000 / 12));
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('lineSpacingPt and linesHeightPt', () => {
  // Parity row 51, case s37: each font from 6 to 36pt, printed by DevExpress.
  it('uses the line spacing DevExpress printed for each font', () => {
    expect(lineSpacingPt('Arial', 9)).toBeCloseTo(10.349, 3); // printed 10.35 a line
    expect(lineSpacingPt('Times New Roman', 10)).toBeCloseTo(11.499, 3);
    expect(lineSpacingPt('Verdana', 10)).toBeCloseTo(12.153, 3);
    expect(lineSpacingPt('Tahoma', 10)).toBeCloseTo(12.07, 3);
    expect(lineSpacingPt('Segoe UI', 10)).toBeCloseTo(13.301, 3);
    expect(lineSpacingPt('Calibri', 10)).toBeCloseTo(12.207, 3);
    expect(lineSpacingPt('Georgia', 10)).toBeCloseTo(11.362, 3);
    expect(lineSpacingPt('Courier New', 10)).toBeCloseTo(11.328, 3);
    expect(lineSpacingPt('Microsoft Sans Serif', 10)).toBeCloseTo(11.318, 3);
    expect(lineSpacingPt('Trebuchet MS', 10)).toBeCloseTo(11.611, 3);
  });

  it('prints one line of Arial or Times New Roman shorter, and two or more at the spacing each', () => {
    // DevExpress's heights less the 1.5pt every grown label adds (s37, s31e).
    expect(linesHeightPt(1, 'Arial', 14)).toBeCloseTo(17.141 - 1.5, 2);
    expect(linesHeightPt(1, 'Times New Roman', 14)).toBeCloseTo(17.004 - 1.5, 2);
    expect(linesHeightPt(2, 'Arial', 14)).toBeCloseTo(33.697 - 1.5, 2);
    expect(linesHeightPt(3, 'Arial', 9)).toBeCloseTo(32.547 - 1.5, 2);
    expect(linesHeightPt(1, 'Verdana', 10)).toBeCloseTo(13.653 - 1.5, 2);
    expect(linesHeightPt(0, 'Arial', 10)).toBe(0);
  });

  it('prints one line that fits only kerned at the full spacing (row 59)', () => {
    // s43a: one line of Arial 20pt, wider unkerned than its box, printed 34.03
    // units tall, 24.5pt, where one that fitted printed 33.12.
    expect(linesHeightPt(1, 'Arial', 20, false) + 1.5).toBeCloseTo((34.025 / 100) * 72, 2);
    expect(linesHeightPt(1, 'Arial', 20) + 1.5).toBeCloseTo((33.116 / 100) * 72, 2);
    expect(linesHeightPt(1, 'Times New Roman', 20, false)).toBeCloseTo(lineSpacingPt('Times New Roman', 20), 6);
    // Fonts with no shorter line, and several lines, are the same either way.
    expect(linesHeightPt(1, 'Verdana', 20, false)).toBeCloseTo(linesHeightPt(1, 'Verdana', 20), 6);
    expect(linesHeightPt(2, 'Arial', 20, false)).toBeCloseTo(linesHeightPt(2, 'Arial', 20), 6);
  });

  it('ignores case, and gives an unmeasured font Arial\'s ratio', () => {
    expect(lineSpacingPt('ARIAL', 10)).toBeCloseTo(11.499, 3);
    expect(lineSpacingPt('Some Font', 10)).toBeCloseTo(11.499, 3);
    expect(lineSpacingPt(null, 10)).toBeCloseTo(11.499, 3);
    expect(linesHeightPt(1, 'Some Font', 10)).toBeCloseTo(linesHeightPt(1, 'Arial', 10), 6);
  });

  it('carries the measured height constant', () => {
    expect(GROW_EXTRA_PT).toBe(1.5);
  });
});

describe('the canvas measurer', () => {
  it('writes a canvas font in points, as the report does', () => {
    expect(cssFont({ family: 'Arial', sizePt: 9, bold: true, italic: false })).toBe('bold 9pt "Arial"');
    expect(cssFont({ family: 'Times New Roman', sizePt: 10, bold: false, italic: true })).toBe('italic 10pt "Times New Roman"');
  });

  it('is absent where there is no browser canvas', () => {
    expect(canvasMeasurer()).toBeNull();
  });

  it('kerns every face GDI kerns, which is all measured but Tahoma and Segoe UI italic (row 59)', () => {
    const face = (family: string, bold = false, italic = false) => gdiKerns({ family, sizePt: 20, bold, italic });
    for (const family of ['Arial', 'Times New Roman', 'Verdana', 'Calibri', 'Georgia', 'Courier New', 'Microsoft Sans Serif', 'Trebuchet MS']) {
      expect(face(family)).toBe(true);
      expect(face(family, true, true)).toBe(true);
    }
    expect(face('Segoe UI')).toBe(true);
    expect(face('Segoe UI', true)).toBe(true);
    // s43k: Segoe UI Italic wrapped until its box reached its unkerned 286.14.
    expect(face('Segoe UI', false, true)).toBe(false);
    expect(face('Segoe UI', true, true)).toBe(false);
    // s43a: Tahoma wrapped until 295.25, its unkerned width; kerned it is 282.5.
    expect(face('Tahoma')).toBe(false);
    expect(face(' TAHOMA ', false, true)).toBe(false);
    // An unmeasured face is kerned, as every measured face but these is.
    expect(face('Some Font')).toBe(true);
  });

  it('knows which families have no bold face, whose bold is synthesized (row 60)', () => {
    const bold = (family: string, isBold = true) => synthesizedBold({ family, sizePt: 20, bold: isBold, italic: false });
    for (const family of ['Microsoft Sans Serif', 'Lucida Console', 'Impact', 'Century', 'Sylfaen', 'Cambria Math', ' microsoft SANS serif ', 'Imprint MT S\u0068adow']) {
      expect(bold(family)).toBe(true);
    }
    // Regular is never synthesized; real bold faces are not on the list.
    expect(bold('Microsoft Sans Serif', false)).toBe(false);
    for (const family of ['Arial', 'Times New Roman', 'Verdana', 'Tahoma', 'Segoe UI', 'Calibri', 'Georgia', 'Courier New', 'Trebuchet MS', 'Consolas']) {
      expect(bold(family)).toBe(false);
    }
    // s44b: MS Gothic and SimSun's bold measured otherwise, so they are left out.
    expect(bold('MS Gothic')).toBe(false);
    expect(bold('SimSun')).toBe(false);
  });

  it('widens a synthesized bold by 41/2048 of an em for every character but a space (row 60)', () => {
    const mss = (sizePt: number, bold = true) => ({ family: 'Microsoft Sans Serif', sizePt, bold, italic: false });
    const hundredths = (pt: number) => (pt / 72) * 100;
    // GDI+ widened "AVATAR Wave To LT Yo", 16 characters and 4 spaces, by
    // 8.8976 hundredths of an inch at 20pt and 4.0039 at 9pt.
    expect(hundredths(boldWideningPt('AVATAR Wave To LT Yo', mss(20)))).toBeCloseTo(8.8976, 4);
    expect(hundredths(boldWideningPt('AVATAR Wave To LT Yo', mss(9)))).toBeCloseTo(4.0039, 4);
    // ...and "A B C D E F" by 1.3346 at 8pt: six letters, five spaces.
    expect(hundredths(boldWideningPt('A B C D E F', mss(8)))).toBeCloseTo(1.3346, 4);
    expect(boldWideningPt('     ', mss(20))).toBe(0);
    // Nothing for a regular weight, or for a family with a bold face.
    expect(boldWideningPt('AVATAR', mss(20, false))).toBe(0);
    expect(boldWideningPt('AVATAR', { family: 'Arial', sizePt: 20, bold: true, italic: false })).toBe(0);
  });
});
