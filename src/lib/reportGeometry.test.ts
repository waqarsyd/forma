import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  unitsPerInch,
  unitsToPx,
  pxToUnits,
  pointsToUnits,
  unitsToPoints,
  pdfTopFromBaseline,
  pageSizeInUnits,
  isSupportedUnit,
  isSupportedPageSize,
  resolveReportUnit,
  resolvePageSize,
  SUPPORTED_UNITS,
  SUPPORTED_PAGE_SIZES,
  DEFAULT_UNIT,
  DEFAULT_PAGE_SIZE,
  placeImage,
  paperOfImage,
  pixelBoxToUnits,
  pageForImage,
  imageDpi,
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

describe('pxToUnits', () => {
  it('is the exact inverse of unitsToPx', () => {
    for (const unit of ['HundredthsOfAnInch', 'TenthsOfAMillimeter', 'Pixels', 'Document']) {
      for (const value of [0, 1, 37, 250, 850, 1100]) {
        expect(pxToUnits(unitsToPx(value, unit), unit)).toBeCloseTo(value, 9);
      }
    }
  });

  it('converts a drag on screen into the report grid', () => {
    // 96 CSS px is an inch, which is 100 hundredths of an inch.
    expect(pxToUnits(96)).toBe(100);
    expect(pxToUnits(48)).toBe(50);
  });

  it('is a no-op for Pixels, matching unitsToPx', () => {
    expect(pxToUnits(500, 'Pixels')).toBe(500);
  });

  it('handles a negative delta, because a drag goes both ways', () => {
    expect(pxToUnits(-96)).toBe(-100);
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
    // This case used to assert `pageSizeInUnits('Tabloid')` returned Letter,
    // which is what BUG-001 was: Tabloid is real paper the table did not carry,
    // and its fallback matched Letter exactly so nothing looked wrong. Tabloid
    // is supported now, so the example had to become one that genuinely is not
    // a paper size.
    expect(pageSizeInUnits('A3')).toEqual({ width: 850, height: 1100 });
    expect(pageSizeInUnits(undefined)).toEqual({ width: 850, height: 1100 });
  });
});

/**
 * An unrecognised unit or page size used to be accepted in silence and then
 * converted with the *default* factor (audit BUG-001).
 *
 * Two things made that worse than an ordinary fallback. `Document` is a real
 * `DevExpress.XtraReports.UI.ReportUnit` member the table simply did not carry,
 * so a legitimate value produced a **3x scale error** -- a 1-inch box written as
 * 100 units instead of 300, every font three times too large -- while both the
 * layout JSON and the REPX stayed internally consistent. And `Tabloid` returned
 * Letter's exact dimensions, so the fallback was invisible even to someone
 * checking the output.
 *
 * The value also travels: `geminiService` writes it verbatim into
 * `ReportUnit="..."`, so an unsupported string does not just mis-scale, it lands
 * in the XML and DevExpress refuses the file.
 */
describe('the supported sets', () => {
  it('carries every ReportUnit DevExpress defines', () => {
    // Document is 1/300", the .NET GraphicsUnit.Document. Its absence was the
    // root cause of BUG-001.
    expect([...SUPPORTED_UNITS].sort()).toEqual(
      ['Document', 'HundredthsOfAnInch', 'Pixels', 'TenthsOfAMillimeter'].sort()
    );
  });

  it('converts Document at 300 units per inch, not the default 100', () => {
    expect(unitsPerInch('Document')).toBe(300);
    // The regression in numbers: a 16-unit font at Document.
    expect(unitsToPoints(16, 'Document')).toBeCloseTo(3.84, 2);
  });

  it('knows Tabloid is 11x17, not Letter', () => {
    const tabloid = pageSizeInUnits('Tabloid', 'HundredthsOfAnInch');
    expect(tabloid).toEqual({ width: 1100, height: 1700 });
    // The fallback used to be undetectable because it matched Letter exactly.
    expect(tabloid).not.toEqual(pageSizeInUnits('Letter', 'HundredthsOfAnInch'));
  });

  it('lists page sizes the geometry can actually compute', () => {
    for (const size of SUPPORTED_PAGE_SIZES) {
      const page = pageSizeInUnits(size, DEFAULT_UNIT);
      expect(page.width).toBeGreaterThan(0);
      expect(page.height).toBeGreaterThan(0);
    }
  });

  it('defaults to values that are themselves supported', () => {
    expect(isSupportedUnit(DEFAULT_UNIT)).toBe(true);
    expect(isSupportedPageSize(DEFAULT_PAGE_SIZE)).toBe(true);
  });
});

describe('isSupportedUnit / isSupportedPageSize', () => {
  it('accepts the exact DevExpress spellings', () => {
    for (const unit of SUPPORTED_UNITS) expect(isSupportedUnit(unit)).toBe(true);
    for (const size of SUPPORTED_PAGE_SIZES) expect(isSupportedPageSize(size)).toBe(true);
  });

  it('rejects a different case, because the value is written into the XML verbatim', () => {
    // Normalising would be worse: DevExpress matches the enum name exactly, so
    // a helpfully-corrected "pixels" would produce a file it refuses to open.
    expect(isSupportedUnit('pixels')).toBe(false);
    expect(isSupportedUnit('PIXELS')).toBe(false);
    expect(isSupportedPageSize('a4')).toBe(false);
  });

  it('rejects the near-misses that look right', () => {
    expect(isSupportedUnit('Pixel')).toBe(false);              // the enum is plural
    expect(isSupportedUnit('TenthsOfAMillimeters')).toBe(false); // it is not
    expect(isSupportedUnit(' Pixels ')).toBe(false);
  });

  it('rejects nothing at all', () => {
    for (const bad of [undefined, null, '', '   ', '../../etc', '<script>']) {
      expect(isSupportedUnit(bad as any)).toBe(false);
      expect(isSupportedPageSize(bad as any)).toBe(false);
    }
  });
});

describe('resolveReportUnit / resolvePageSize', () => {
  afterEach(() => vi.restoreAllMocks());

  it('passes a supported value straight through', () => {
    expect(resolveReportUnit('Document')).toBe('Document');
    expect(resolvePageSize('Tabloid')).toBe('Tabloid');
  });

  it('falls back to the default for anything else', () => {
    expect(resolveReportUnit('Nonsense')).toBe(DEFAULT_UNIT);
    expect(resolvePageSize('Nonsense')).toBe(DEFAULT_PAGE_SIZE);
  });

  it('treats absent as the default without complaining', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveReportUnit(undefined)).toBe(DEFAULT_UNIT);
    expect(resolvePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when it drops a value someone actually set', () => {
    // The whole failure class here is silence. A fallback that says nothing is
    // how a 3x scale error ships looking plausible.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveReportUnit('Document2');
    resolvePageSize('A3');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toMatch(/Document2/);
    expect(String(warn.mock.calls[1][0])).toMatch(/A3/);
  });

  it('never returns something the conversions cannot handle', () => {
    for (const bad of ['Document2', '', '  ', 'a4', null, undefined] as any[]) {
      expect(isSupportedUnit(resolveReportUnit(bad))).toBe(true);
      expect(isSupportedPageSize(resolvePageSize(bad))).toBe(true);
    }
  });
});

/**
 * The workspace status bar prints the report's scale, and it printed it wrong.
 *
 * `<span>units 100/in</span>` was a literal — correct for the default and for
 * nothing else. Set `TenthsOfAMillimeter` and the bar still claimed 100 where
 * the report is built at 254; set `Pixels` and it claimed 100 against 96.
 * Measured in the running app across the three units the dialog offers: 1 of 3
 * told the truth. It sits beside `DevExpress v{config.version}`, which *is*
 * derived, so the whole bar reads as live — and it names the scale of the file
 * about to be exported, which is the worst place to be confidently wrong.
 *
 * Nothing could catch it: a literal is valid TypeScript, renders fine, and is
 * only wrong relative to a table in another file. So this reads `App.tsx` off
 * disk the way `legalDisclosure.test.ts` reads `ContactPage.tsx` — the claim is
 * about the *source*, so the source is what gets asserted, and no component
 * tree has to render.
 *
 * The status bar went on 2026-11-04, and the readout with it moved to the REPX
 * pane (`data-readout="units"` in `RepxViewer`), so the guard moved too.
 */
describe('the units readout reads the unit table rather than restating it', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

  /**
   * Comments are stripped before the literal check, because the first version of
   * this test failed on the comment *explaining the bug* — which quotes the old
   * `units 100/in` markup. The invariant is about what renders, so asserting on
   * prose would make the record of the fix and the guard against it mutually
   * exclusive, and every future comment near this line a tripwire.
   */
  const codeOnly = (s: string) =>
    s
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

  const start = app.indexOf('data-readout="units"');
  const readout = codeOnly(app.slice(start, start + 400));

  it('finds the readout at all', () => {
    // Guards the two assertions below: if the marker is renamed, the slice above
    // is empty and everything here passes vacuously.
    expect(app).toContain('data-readout="units"');
    expect(readout).toMatch(/units/);
  });

  it('derives the units-per-inch figure from unitsPerInch()', () => {
    expect(readout).toMatch(/unitsPerInch\(/);
    expect(app).toMatch(/import\s*\{[^}]*\bunitsPerInch\b[^}]*\}\s*from\s*'\.\/lib\/reportGeometry'/);
  });

  it('states no units-per-inch figure as a literal', () => {
    for (const perInch of SUPPORTED_UNITS.map((u) => unitsPerInch(u))) {
      expect(
        readout,
        `The units readout hardcodes "${perInch}/in". It must read unitsPerInch(unit) — ` +
          `a literal is right for one unit and silently wrong for the rest.`
      ).not.toMatch(new RegExp(`\\b${perInch}\\s*/\\s*in`));
    }
  });
});

/*
 * OCR's page images (2026-11-01). A rendered PDF page knows its resolution
 * and is the whole page; a screenshot does not, and is fitted to the
 * printable width at the margins.
 */
describe('placing a page image on the report page', () => {
  const margins = { left: 50, right: 50, top: 50, bottom: 50 };

  it('reads a rendered PDF page at its resolution, from the page corner', () => {
    const at = placeImage({ width: 1530, height: 1980, dpi: 180 }, { width: 850, margins }, 'HundredthsOfAnInch');
    expect(at).toEqual({ unitsPerPixel: 100 / 180, left: 0, top: 0 });
    // Two inches in is two inches in, margins included.
    expect(pixelBoxToUnits({ x0: 360, y0: 180, x1: 540, y1: 216 }, at)).toEqual({ x: 200, y: 100, w: 100, h: 20 });
    expect(placeImage({ width: 10, height: 10, dpi: 254 }, { width: 2159, margins }, 'TenthsOfAMillimeter').unitsPerPixel).toBe(1);
  });

  it('fits a screenshot to the printable width, from the margins', () => {
    const at = placeImage({ width: 1500, height: 900, dpi: null }, { width: 850, margins }, 'HundredthsOfAnInch');
    expect(at).toEqual({ unitsPerPixel: 0.5, left: 50, top: 50 });
    expect(pixelBoxToUnits({ x0: 0, y0: 0, x1: 1500, y1: 20 }, at)).toEqual({ x: 50, y: 50, w: 750, h: 10 });
  });

  it('takes a rendered page\'s own size, and Letter for a screenshot, turned when it is wide', () => {
    expect(pageForImage({ width: 1530, height: 1980, dpi: 180 }, 'HundredthsOfAnInch')).toEqual({ width: 850, height: 1100 });
    expect(pageForImage({ width: 800, height: 1200, dpi: null }, 'HundredthsOfAnInch')).toEqual({ width: 850, height: 1100 });
    expect(pageForImage({ width: 1600, height: 900, dpi: null }, 'HundredthsOfAnInch')).toEqual({ width: 1100, height: 850 });
  });

  it('takes the configured paper for a screenshot, and a rendered page\'s resolution from its own width', () => {
    const a4 = pageSizeInUnits('A4', 'HundredthsOfAnInch');
    expect(pageForImage({ width: 800, height: 1200, dpi: null }, 'HundredthsOfAnInch', 'A4')).toEqual(a4);
    expect(pageForImage({ width: 1200, height: 800, dpi: null }, 'HundredthsOfAnInch', 'A4')).toEqual({ width: a4.height, height: a4.width });
    // A Letter page, 612 points wide, rendered 1,530 pixels across.
    expect(imageDpi(1530, 612)).toBe(180);
    expect(imageDpi(0, 612)).toBeNull();
  });

  // 2026-11-03: a full-page picture fitted inside the margins put every text
  // pushed in and shrunk; OCR found 21.8% of 40 drawn pages' texts where they
  // print, against 55.7% with the scale known.
  it('knows a screenshot with a paper\'s shape as that whole page, even when the settings name another paper', () => {
    expect(paperOfImage({ width: 827, height: 1169 }, 'Letter')).toBe('A4');
    expect(paperOfImage({ width: 1169, height: 827 })).toBe('A4');
    expect(paperOfImage({ width: 1700, height: 2200 }, 'A4')).toBe('Letter');
    expect(paperOfImage({ width: 1100, height: 1700 })).toBe('Tabloid');
    // The configured paper wins a tie of shapes, and a shape no paper has is none.
    expect(paperOfImage({ width: 850, height: 1100 }, 'Letter')).toBe('Letter');
    expect(paperOfImage({ width: 800, height: 1200 })).toBeNull();
    expect(paperOfImage({ width: 1600, height: 900 })).toBeNull();
    // 1,500 by 900 is 1.667 to 1, within 2% of Legal on its side.
    expect(paperOfImage({ width: 1500, height: 900 })).toBe('Legal');
    expect(pageForImage({ width: 2480, height: 3508, dpi: null }, 'HundredthsOfAnInch')).toEqual(pageSizeInUnits('A4', 'HundredthsOfAnInch'));
  });

  it('places such a screenshot from the page corner across the full width, and fits any other inside the margins', () => {
    const page = { width: 827, height: 1169, margins };
    expect(placeImage({ width: 1654, height: 2338, dpi: null }, page, 'HundredthsOfAnInch')).toEqual({ unitsPerPixel: 0.5, left: 0, top: 0 });
    expect(placeImage({ width: 1500, height: 900, dpi: null }, page, 'HundredthsOfAnInch')).toEqual({ unitsPerPixel: 727 / 1500, left: 50, top: 50 });
    // Without the page's height there is nothing to compare, and it is fitted as before.
    expect(placeImage({ width: 1654, height: 2338, dpi: null }, { width: 827, margins }, 'HundredthsOfAnInch').left).toBe(50);
  });
});