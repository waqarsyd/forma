/**
 * Every unit conversion in the report pipeline, in one place and under test.
 *
 * Four coordinate systems meet in this app and three of them used to be encoded
 * as bare literals scattered across two files:
 *
 *   PDF points        1/72"    — what pdf.js reports, y measured up from the bottom
 *   report units      varies   — what the layout JSON and the REPX both speak
 *   CSS pixels        1/96"    — what the mockup draws in
 *   typographic point 1/72"    — what a DevExpress `Font` size is in, always
 *
 * The last one is the trap. Report units are configurable and font size is not:
 * `Font="Arial, 12pt"` means 12/72" whatever `ReportUnit` says. A layout that
 * reports sizes in report units and an XML that writes them as points will
 * disagree by 39% at the default unit, and both files will look internally
 * consistent while doing it.
 *
 * Nothing here throws and nothing rounds except where a caller asks: these are
 * the numbers that decide whether the generated report matches the design, and
 * every one of them fails silently — a wrong factor produces a plausible layout
 * in the wrong place, never an error.
 */

/** PDF and typography both use 1/72". */
export const POINTS_PER_INCH = 72;
/** One CSS inch. The mockup is drawn in these. */
export const CSS_PX_PER_INCH = 96;

/**
 * Units per inch for each `ReportUnit` DevExpress accepts and the config dialog
 * offers.
 *
 * `TenthsOfAMillimeter` is 254 because an inch is 25.4mm — not 250, which is
 * the sort of thing that looks right at a glance and is 1.6% wrong forever.
 * `Pixels` in DevExpress means 1/96", i.e. the same as a CSS pixel, which is
 * why that case is a no-op in `unitsToPx`.
 */
const UNITS_PER_INCH: Record<string, number> = {
  HundredthsOfAnInch: 100,
  TenthsOfAMillimeter: 254,
  Pixels: 96,
};

/** Falls back to hundredths — the default everywhere, and the app's own. */
export function unitsPerInch(reportUnit?: string): number {
  return (reportUnit && UNITS_PER_INCH[reportUnit]) || UNITS_PER_INCH.HundredthsOfAnInch;
}

/** Report units → CSS pixels, for the mockup. */
export function unitsToPx(value: number, reportUnit?: string): number {
  return (value / unitsPerInch(reportUnit)) * CSS_PX_PER_INCH;
}

/** PDF points → report units, for text lifted out of an uploaded PDF. */
export function pointsToUnits(points: number, reportUnit?: string): number {
  return (points / POINTS_PER_INCH) * unitsPerInch(reportUnit);
}

/**
 * Report units → typographic points, for a DevExpress `Font` size.
 *
 * This is the conversion that has no business being skipped. A font is in
 * points whatever the report unit is, so a size carried straight across from
 * the layout lands 39% too large at the default unit.
 */
export function unitsToPoints(value: number, reportUnit?: string): number {
  return (value / unitsPerInch(reportUnit)) * POINTS_PER_INCH;
}

/**
 * PDF y is a **baseline measured up from the bottom of the page**; the report
 * grid measures down from the top. Both halves matter: forget the flip and the
 * page is upside down (obvious), forget the glyph height and everything sits
 * one line too low (not obvious at all, and it looks like sloppy model output).
 */
export function pdfTopFromBaseline(baselineY: number, glyphHeight: number, pageHeightPt: number): number {
  return pageHeightPt - (baselineY + glyphHeight);
}

export interface PageSize {
  /** Width in report units. */
  width: number;
  /** Height in report units. */
  height: number;
}

/** Inches, as the paper actually measures. */
const PAGE_INCHES: Record<string, { w: number; h: number }> = {
  Letter: { w: 8.5, h: 11 },
  Legal: { w: 8.5, h: 14 },
  // ISO A4 is 210 × 297 mm exactly: 8.2677" × 11.6929".
  A4: { w: 210 / 25.4, h: 297 / 25.4 },
};

/**
 * The page in report units, rounded to whole units.
 *
 * Used for the REPX `PageWidth`/`PageHeight` and for the grid the prompt tells
 * the model to map the design onto. Those two being derived from one function is
 * the point: they were separately hardcoded to 850×1100 while the config dialog
 * offered A4 and Legal, so choosing anything but Letter produced a report whose
 * declared paper and actual coordinates disagreed.
 */
export function pageSizeInUnits(pageSize?: string, reportUnit?: string): PageSize {
  const inches = (pageSize && PAGE_INCHES[pageSize]) || PAGE_INCHES.Letter;
  const per = unitsPerInch(reportUnit);
  return { width: Math.round(inches.w * per), height: Math.round(inches.h * per) };
}
