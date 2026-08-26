import { describe, it, expect } from 'vitest';
import {
  unitsPerInch,
  unitsToPx,
  pointsToUnits,
  unitsToPoints,
  pdfTopFromBaseline,
  pageSizeInUnits,
} from './reportGeometry';

/**
 * These are the numbers that decide whether the generated report matches the
 * design that was uploaded, and every one of them fails *silently*: a wrong
 * factor produces a plausible-looking layout in the wrong place or at the wrong
 * size. Nothing throws, the mockup still draws, the .repx still opens. Only
 * measuring catches it, which is what this file does.
 */
describe('unitsPerInch', () => {
  it('knows each DevExpress ReportUnit the config dialog offers', () => {
    expect(unitsPerInch('HundredthsOfAnInch')).toBe(100);
    expect(unitsPerInch('Pixels')).toBe(96);
  });

  it('uses 254 for tenths of a millimetre, not 250', () => {
    // An inch is 25.4mm. 250 looks right and is 1.6% wrong on every coordinate.
    expect(unitsPerInch('TenthsOfAMillimeter')).toBe(254);
  });

  it('falls back to hundredths for anything unknown or missing', () => {
    expect(unitsPerInch(undefined)).toBe(100);
    expect(unitsPerInch('SomethingElse')).toBe(100);
  });
});

describe('unitsToPx', () => {
  it('maps a Letter page onto the width the mockup has always drawn', () => {
    // 850 units = 8.5in = 816 CSS px. This is the 0.96 factor that used to be a
    // bare literal repeated at eight call sites.
    expect(unitsToPx(850)).toBe(816);
    expect(unitsToPx(100)).toBe(96);
  });

  it('is a no-op for Pixels, because DevExpress pixels are CSS pixels', () => {
    expect(unitsToPx(500, 'Pixels')).toBe(500);
  });

  it('scales metric units correctly', () => {
    // 254 tenths of a mm = 1 inch = 96px.
    expect(unitsToPx(254, 'TenthsOfAMillimeter')).toBe(96);
  });
});

describe('pointsToUnits', () => {
  it('converts PDF points to the report grid', () => {
    // A 612x792pt Letter page maps exactly onto 850x1100.
    expect(pointsToUnits(612)).toBeCloseTo(850, 6);
    expect(pointsToUnits(792)).toBeCloseTo(1100, 6);
  });

  it('follows the configured unit', () => {
    expect(pointsToUnits(72, 'Pixels')).toBeCloseTo(96, 6);
    expect(pointsToUnits(72, 'TenthsOfAMillimeter')).toBeCloseTo(254, 6);
  });
});

describe('unitsToPoints', () => {
  it('is NOT the identity, which is the whole reason it exists', () => {
    // A font is in points whatever ReportUnit says. Carrying a layout fontSize
    // straight into Font="Arial, Npt" makes the text 39% too big at the
    // default unit, and both files look internally consistent while doing it.
    expect(unitsToPoints(16)).toBeCloseTo(11.52, 5);
    expect(unitsToPoints(100)).toBe(72);
  });

  it('round-trips with pointsToUnits', () => {
    for (const unit of ['HundredthsOfAnInch', 'TenthsOfAMillimeter', 'Pixels']) {
      expect(unitsToPoints(pointsToUnits(12, unit), unit)).toBeCloseTo(12, 6);
    }
  });
});

describe('pdfTopFromBaseline', () => {
  it('flips the origin and accounts for the glyph height', () => {
    // Baseline 700 up from the bottom of a 792pt page, 12pt tall: the top of
    // the glyphs is 792 - (700 + 12) = 80pt from the top.
    expect(pdfTopFromBaseline(700, 12, 792)).toBe(80);
  });

  it('puts text at the very top of the page near zero, not near the page height', () => {
    // Forgetting the flip is obvious (the page is upside down). Forgetting the
    // glyph height is not: everything lands one line too low and reads as
    // sloppy model output rather than as a conversion bug.
    expect(pdfTopFromBaseline(780, 12, 792)).toBe(0);
    expect(pdfTopFromBaseline(0, 12, 792)).toBe(780);
  });
});

describe('pageSizeInUnits', () => {
  it('gives Letter the numbers the prompt has always hardcoded', () => {
    expect(pageSizeInUnits('Letter')).toEqual({ width: 850, height: 1100 });
  });

  it('gives A4 and Legal their real sizes rather than Letter', () => {
    // The config dialog has offered these since it existed, while the prompt
    // hardcoded 850x1100 for all three.
    expect(pageSizeInUnits('A4')).toEqual({ width: 827, height: 1169 });
    expect(pageSizeInUnits('Legal')).toEqual({ width: 850, height: 1400 });
  });

  it('expresses the same paper in the configured unit', () => {
    expect(pageSizeInUnits('A4', 'TenthsOfAMillimeter')).toEqual({ width: 2100, height: 2970 });
    expect(pageSizeInUnits('Letter', 'Pixels')).toEqual({ width: 816, height: 1056 });
  });

  it('falls back to Letter for an unknown size', () => {
    expect(pageSizeInUnits('Tabloid')).toEqual({ width: 850, height: 1100 });
    expect(pageSizeInUnits(undefined)).toEqual({ width: 850, height: 1100 });
  });
});
