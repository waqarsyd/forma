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
 * Units per inch for **every** `ReportUnit` DevExpress accepts.
 *
 * This used to say "and the config dialog offers", and matching the dialog
 * rather than the enum was the bug: `Document` was missing, so a legitimate
 * value converted at the default factor and produced a report at a third of
 * its intended size. The table now leads and the dialog is a subset of it — a
 * dropdown gaining an option is then safe, whereas the reverse was not.
 *
 * The dialog currently offers the first three. Adding `Document` to it is a
 * product decision, not a correctness one; the geometry is ready either way.
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
  // 1/300", the .NET GraphicsUnit.Document. Its absence here was the root cause
  // of BUG-001: `Document` is a real ReportUnit member, so a legitimate value
  // fell through to the 100 below and produced a 3x scale error that looked
  // entirely plausible in both artifacts.
  Document: 300,
};

/** The default everywhere, and the app's own. */
export const DEFAULT_UNIT = 'HundredthsOfAnInch';

/** Every `ReportUnit` this app can convert. Exactly the DevExpress spellings. */
export const SUPPORTED_UNITS: readonly string[] = Object.freeze(Object.keys(UNITS_PER_INCH));

/**
 * Is this a unit the conversions below understand?
 *
 * Case-sensitive, and deliberately so. The value is written verbatim into
 * `ReportUnit="..."` in the generated REPX, and DevExpress matches the enum
 * name exactly — a helpfully-normalised `"pixels"` would produce a file it
 * refuses to open, which is a worse outcome than rejecting the value here.
 */
export function isSupportedUnit(reportUnit: unknown): boolean {
  return typeof reportUnit === 'string' && Object.prototype.hasOwnProperty.call(UNITS_PER_INCH, reportUnit);
}

/**
 * The unit to actually use, given whatever the caller has.
 *
 * Unrecognised values fall back to the default **and say so**. The silence was
 * the bug: a fallback that produces a plausible layout at the wrong scale, with
 * nothing anywhere to indicate it happened, is exactly how BUG-001 survived.
 * An absent value is not warned about — that is the ordinary case, not a
 * mistake.
 */
export function resolveReportUnit(reportUnit?: string | null): string {
  if (isSupportedUnit(reportUnit)) return reportUnit as string;
  if (reportUnit != null && String(reportUnit).trim() !== '') {
    console.warn(
      `Unknown ReportUnit ${JSON.stringify(reportUnit)} — falling back to ${DEFAULT_UNIT}. ` +
      `Supported: ${SUPPORTED_UNITS.join(', ')}.`
    );
  }
  return DEFAULT_UNIT;
}

/** Falls back to the default for anything unknown — see `resolveReportUnit`. */
export function unitsPerInch(reportUnit?: string): number {
  return UNITS_PER_INCH[isSupportedUnit(reportUnit) ? (reportUnit as string) : DEFAULT_UNIT];
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
  // Tabloid was the other half of BUG-001, and the nastier half: it fell back
  // to Letter, whose dimensions it matched *exactly* at the default unit, so
  // the wrong answer was indistinguishable from the right one even to someone
  // checking the output.
  Tabloid: { w: 11, h: 17 },
};

/** The paper assumed when none is set. */
export const DEFAULT_PAGE_SIZE = 'Letter';

/** Every paper size this app can compute. */
export const SUPPORTED_PAGE_SIZES: readonly string[] = Object.freeze(Object.keys(PAGE_INCHES));

/** Case-sensitive, for the same reason as `isSupportedUnit`. */
export function isSupportedPageSize(pageSize: unknown): boolean {
  return typeof pageSize === 'string' && Object.prototype.hasOwnProperty.call(PAGE_INCHES, pageSize);
}

/** The paper to actually use. Warns when it drops a value someone set. */
export function resolvePageSize(pageSize?: string | null): string {
  if (isSupportedPageSize(pageSize)) return pageSize as string;
  if (pageSize != null && String(pageSize).trim() !== '') {
    console.warn(
      `Unknown page size ${JSON.stringify(pageSize)} — falling back to ${DEFAULT_PAGE_SIZE}. ` +
      `Supported: ${SUPPORTED_PAGE_SIZES.join(', ')}.`
    );
  }
  return DEFAULT_PAGE_SIZE;
}

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
  const inches = PAGE_INCHES[isSupportedPageSize(pageSize) ? (pageSize as string) : DEFAULT_PAGE_SIZE];
  const per = unitsPerInch(reportUnit);
  return { width: Math.round(inches.w * per), height: Math.round(inches.h * per) };
}
