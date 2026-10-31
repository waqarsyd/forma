/**
 * Line breaking and line spacing, as DevExpress 20.1 printed them through
 * `RepxProbe render` on 2026-10-30 (rows 7 and 8 of
 * docs/proposals/devexpress-parity.md). The browser's canvas, running this same
 * `wrapText`, broke all 18 of the texts DevExpress printed, in 9 fonts, into
 * identical lines; these cases pin the rules that made that true.
 */
import { describe, it, expect } from 'vitest';
import { wrapText, lineSpacingPt, linesHeightPt, cssFont, canvasMeasurer, GROW_EXTRA_PT, SHRINK_EXTRA_PT } from './textMeasure';

/** Every character one point wide, so widths are character counts. */
const mono = (s: string) => s.length;

describe('wrapText', () => {
  it('breaks greedily at spaces', () => {
    expect(wrapText('the quick brown fox jumps', mono, 12)).toEqual(['the quick', 'brown fox', 'jumps']);
  });

  it('does not fit a line exactly as wide as the area, as DevExpress did not', () => {
    // 36 Courier characters were exactly the 216pt area, and DevExpress broke
    // before the last word.
    expect(wrapText('abcde fghij', mono, 11)).toEqual(['abcde', 'fghij']);
    expect(wrapText('abcde fghij', mono, 11.01)).toEqual(['abcde fghij']);
  });

  it('breaks after a hyphen inside a word, as DevExpress printed "cut-" / "off,"', () => {
    expect(wrapText('missed the cut-off, and', mono, 16)).toEqual(['missed the cut-', 'off, and']);
    // A word that fits whole is not split at its hyphen.
    expect(wrapText('a cut-off', mono, 20)).toEqual(['a cut-off']);
  });

  it('breaks a word wider than the whole line between characters', () => {
    // Three characters per line, since four exactly fill the area; "j xy" is
    // four wide, so it does not fit either.
    expect(wrapText('abcdefghij xy', mono, 4)).toEqual(['abc', 'def', 'ghi', 'j', 'xy']);
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

  it('ignores case, and gives an unmeasured font Arial\'s ratio', () => {
    expect(lineSpacingPt('ARIAL', 10)).toBeCloseTo(11.499, 3);
    expect(lineSpacingPt('Some Font', 10)).toBeCloseTo(11.499, 3);
    expect(lineSpacingPt(null, 10)).toBeCloseTo(11.499, 3);
    expect(linesHeightPt(1, 'Some Font', 10)).toBeCloseTo(linesHeightPt(1, 'Arial', 10), 6);
  });

  it('carries the measured height constants', () => {
    expect(GROW_EXTRA_PT).toBe(1.5);
    expect(SHRINK_EXTRA_PT).toBe(1.17);
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
});
