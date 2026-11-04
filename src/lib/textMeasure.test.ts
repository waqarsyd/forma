/**
 * Line breaking and line spacing, as DevExpress 20.1 printed them through
 * `RepxProbe render` on 2026-10-30 (rows 7 and 8 of
 * docs/proposals/devexpress-parity.md). The browser's canvas, running this same
 * `wrapText`, broke all 18 of the texts DevExpress printed, in 9 fonts, into
 * identical lines; these cases pin the rules that made that true.
 */
import { describe, it, expect } from 'vitest';
import { wrapText, lineSpacingPt, linesHeightPt, cssFont, cssFace, browserFace, canvasMeasurer, gdiKerns, synthesizedBold, boldWideningPt, drawnBoldWideningPt, resolveLineMetrics, GROW_EXTRA_PT, turnedLines, oneLinePt, type TurnedWidths } from './textMeasure';

/** Every character one point wide, so widths are character counts. */
const mono = (s: string) => s.length;

/*
 * Turned text longer than its box (parity row 54). Every character 5pt
 * wide, trailing spaces unmeasured, as DevExpress measures them; one line
 * 10pt and the spacing 12pt.
 */
describe('turnedLines', () => {
  const plain = (s: string) => s.replace(/\s+$/, '').length * 5;
  const flat: TurnedWidths = { kerned: plain, plain };
  const lay = (text: string, length: number, across: number, w: TurnedWidths = flat, wrap = true) => turnedLines(text, w, length, across, 10, 12, wrap);

  it('prints a text that fits as it is', () => {
    expect(lay('SHORT', 60, 20)).toEqual(['SHORT']);
  });

  it('keeps the lines that fit across, and continues the last by characters, inside a word', () => {
    // At 30: "AB" / "CDEFGH". One line across: "AB" takes " CDE" while it fits 30.
    expect(lay('AB CDEFGH', 30, 21)).toEqual(['AB CDE']);
    // Two lines fit across from (2 - 1) x 12 + 10 = 22.
    expect(lay('AB CDEFGH', 30, 22)).toEqual(['AB', 'CDEFGH']);
  });

  it('lays the text out again at its widest line, rounded up to a pixel, not at the box', () => {
    // At 60: "A LONGER" (40) / "TURNED" / "HEADING", so the second layout is at
    // 40.5, and "A LONGER" cannot take " T".
    expect(lay('A LONGER TURNED HEADING', 60, 20)).toEqual(['A LONGER']);
  });

  it('breaks between words by the kerned width and cuts characters by the plain one', () => {
    // Kerning takes 2pt from a line of two words: "AB CD" fits 23.25 kerned, not plain.
    const kerned: TurnedWidths = { kerned: (s) => plain(s) - (/\S \S/.test(s) ? 2 : 0), plain };
    expect(lay('AB CD EF', 25, 20, kerned)).toEqual(['AB CD']);
  });

  it('cuts one line with WordWrap off', () => {
    expect(lay('ABCDEFGH', 20, 20, flat, false)).toEqual(['ABCD']);
  });

  it('prints nothing for no text', () => {
    expect(lay('  ', 60, 20)).toEqual([]);
  });

  it("takes one line as GDI+'s ascent and descent", () => {
    // Arial: 2288/2048 of the size, where its spacing is 2355/2048.
    expect(oneLinePt('Arial', 10)).toBeCloseTo((10 * 2288) / 2048, 9);
    expect(oneLinePt('Verdana', 10)).toBeCloseTo(lineSpacingPt('Verdana', 10), 9);
  });
});

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

  it('takes a family outside the table from the browser, whose metrics are GDI+\'s (row 63)', () => {
    const garamond = { one: 2304 / 2048, spacing: 2304 / 2048 };
    expect(resolveLineMetrics('Garamond', garamond)).toEqual(garamond);
    // The table wins for its ten families, whatever the browser says.
    expect(resolveLineMetrics('Arial', garamond)).toEqual({ one: 2288 / 2048, spacing: 2355 / 2048 });
    expect(resolveLineMetrics(' VERDANA ', null)).toEqual({ one: 2489 / 2048, spacing: 2489 / 2048 });
    // Nothing measured, as under Node: Arial's.
    expect(resolveLineMetrics('Garamond', null)).toEqual({ one: 2288 / 2048, spacing: 2355 / 2048 });
    expect(resolveLineMetrics(null, null)).toEqual({ one: 2288 / 2048, spacing: 2355 / 2048 });
    // s45a: one line of Garamond 20pt printed 33.33 units, two 64.58.
    expect(((garamond.one * 20 + 1.5) / 72) * 100).toBeCloseTo(33.33, 2);
    expect(((2 * garamond.spacing * 20 + 1.5) / 72) * 100).toBeCloseTo(64.58, 2);
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

  it('leaves unkerned the families GDI does not kern in any style (row 61)', () => {
    const face = (family: string, bold = false, italic = false) => gdiKerns({ family, sizePt: 20, bold, italic });
    // s45a: each wrapped until its box reached its unkerned width.
    for (const family of ['Arial Narrow', 'Garamond', 'Gill Sans MT', 'Bodoni MT', 'Goudy Old Style', 'Leelawadee UI',
      'Franklin Gothic Book', 'Rockwell', 'Tw Cen MT', 'Century']) {
      expect(face(family)).toBe(false);
      expect(face(family, true)).toBe(false);
      expect(face(family, false, true)).toBe(false);
      expect(face(family, true, true)).toBe(false);
    }
    // Segoe UI's lighter and heavier families follow it: kerned upright only.
    for (const family of ['Segoe UI Light', 'Segoe UI Semibold']) {
      expect(face(family)).toBe(true);
      expect(face(family, false, true)).toBe(false);
    }
  });

  it('asks the browser for the face GDI names by a weight or width of a family (row 62)', () => {
    const face = (family: string, bold = false, italic = false) => browserFace({ family, bold, italic });
    // s46a: DevExpress broke each where the browser's widths of this face fall.
    expect(face('Franklin Gothic Demi')).toEqual({ family: 'Franklin Gothic', weight: 600, stretch: 'normal', italic: false });
    expect(face('franklin gothic demi cond', false, true)).toEqual({ family: 'Franklin Gothic', weight: 600, stretch: 'semi-condensed', italic: true });
    expect(face('Eras Medium ITC').weight).toBe(450);
    expect(face('Segoe UI Semilight')).toMatchObject({ family: 'Segoe UI', weight: 350 });
    expect(face('Rockwell Extra Bold', true).weight).toBe(750);
    expect(face('Rockwell Extra Bold', false, true).weight).toBe(850);
    // Any other name is asked for as written.
    expect(face(' Arial ', true)).toEqual({ family: 'Arial', weight: 700, stretch: 'normal', italic: false });
    // The page draws the same face, its family quoted so that a name such
    // as "3 of 9 Barcode" stays one valid declaration.
    expect(cssFace({ family: 'Franklin Gothic Demi', bold: false, italic: false })).toEqual({ fontFamily: '"Franklin Gothic", sans-serif', fontWeight: 600, fontStretch: 'normal', fontStyle: 'normal' });
    expect(cssFace({ family: '3 of 9 Barcode', bold: false, italic: true }).fontFamily).toBe('"3 of 9 Barcode", sans-serif');
    // And the canvas: a weight it has no keyword for is a number.
    expect(cssFont({ family: 'Leelawadee UI Semilight', sizePt: 9, bold: false, italic: false })).toBe('350 9pt "Leelawadee UI"');
    // GDI kerns these names no more than the families above.
    expect(gdiKerns({ family: 'Franklin Gothic Demi', sizePt: 9, bold: false, italic: false })).toBe(false);
    expect(gdiKerns({ family: 'Segoe UI Semilight', sizePt: 9, bold: false, italic: false })).toBe(true);
    expect(gdiKerns({ family: 'Segoe UI Semilight', sizePt: 9, bold: false, italic: true })).toBe(false);
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
    // Row 60 left out MS Gothic and SimSun, whose bold measured otherwise in
    // s44b; row 67 found how, and the families GDI+ widens the same way.
    for (const family of ['MS Gothic', 'SimSun', 'MS PGothic', 'Gulim', 'Dotum', 'MingLiU', 'PMingLiU', 'Elephant', 'Ink Free']) {
      expect(bold(family)).toBe(true);
    }
    // A symbol font GDI+ widens evenly but DevExpress printed by neither rule.
    expect(bold('Marlett')).toBe(false);
  });

  /*
   * DevExpress's own line breaks and short lines, from s53, s53b and s53c:
   * for each, the widening past the regular's GDI width at the last box the
   * text did not fit and the first it did, in hundredths of an inch. A line
   * break ('b') is GDI+'s widening at a large em, a short line ('d') GDI+'s at
   * the size drawn (row 67).
   */
  const DX_BOLD: [string, string, number, 'b' | 'd', number, number][] = [
    ['MS Gothic', 'AVATAR Wave To LT Yo', 8, 'b', 0.4989, 0.5489],
    ['MS Gothic', 'AVATAR Wave To LT Yo', 30, 'b', 2.0033, 2.0533],
    ['MS Gothic', 'AAAAAAAAAA', 10, 'b', 0.2956, 0.3456],
    ['MS Gothic', 'A A A A A A', 8, 'b', 0.2489, 0.2989],
    ['MS Gothic', 'A A A A A A', 20, 'b', 0.7022, 0.7522],
    ['SimSun', 'A A A A A A', 20, 'b', 0.7022, 0.7522],
    ['MS PGothic', 'AVATAR Wave To LT Yo', 20, 'b', 1.3474, 1.3974],
    ['Gulim', 'A A A A A A', 20, 'b', 2.9543, 3.0043],
    ['Gulim', 'A A A A A A', 8, 'b', 1.1457, 1.1957],
    ['Dotum', 'AVATAR Wave To LT Yo', 12, 'b', 3.2024, 3.2524],
    ['MingLiU', 'AVATAR Wave To LT Yo', 20, 'b', 5.4022, 5.4522],
    ['PMingLiU', 'A A A A A A', 10, 'b', 1.4529, 1.5029],
    ['Elephant', 'A A A A A A', 8, 'b', 1.1013, 1.1513],
    ['Elephant', 'A A A A A A', 20, 'b', 2.8033, 2.8533],
    ['Ink Free', 'AVATAR Wave To LT Yo', 20, 'b', 5.1469, 5.1969],
    ['Modern No. 20', 'AAAAAAAAAA', 12, 'b', 1.5025, 1.5525],
    ['Impact', 'A A A A A A', 20, 'b', 3.3027, 3.3527],
    ['SimSun', 'AVATAR Wave To LT Yo', 8, 'd', 3.4489, 3.4989],
    ['Gulim', 'AVATAR Wave To LT Yo', 20, 'd', 8.6546, 8.7046],
    ['Gulim', 'A A A A A A', 8, 'd', 1.2957, 1.3457],
    ['Dotum', 'AVATAR Wave To LT Yo', 12, 'd', 5.2024, 5.2524],
    ['MingLiU', 'AVATAR Wave To LT Yo', 20, 'd', 8.6522, 8.7022],
    ['PMingLiU', 'A A A A A A', 10, 'd', 1.6029, 1.6529],
    ['Modern No. 20', 'AAAAAAAAAA', 12, 'd', 3.3025, 3.3525],
  ];
  it.each(DX_BOLD)('widens %s Bold "%s" at %spt as DevExpress does (%s, row 67)', (family, text, sizePt, kind, notFit, fit) => {
    const font = { family, sizePt, bold: true, italic: false };
    const hundredths = ((kind === 'b' ? boldWideningPt(text, font) : drawnBoldWideningPt(text, font)) / 72) * 100;
    // Above the box it did not fit, and within the first it did, allowing
    // row 59's slack of 22.5 millionths of a box of that size.
    expect(hundredths).toBeGreaterThan(notFit);
    expect(hundredths).toBeLessThanOrEqual(fit + 0.01);
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
