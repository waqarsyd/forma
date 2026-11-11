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

/**
 * CSS pixels → report units, for a control dragged on screen.
 *
 * The inverse of `unitsToPx`, and it lives here for the reason this whole
 * module exists: direct manipulation converts a pointer delta into a
 * `LocationFloat` on every mouse move, and doing that arithmetic inline in a
 * component would put a second conversion site in the codebase — the exact
 * failure the units audit of 2026-08-26 was about. A drag that converts with
 * the wrong scale renders a plausible layout in the wrong place and never
 * throws.
 *
 * Note the caller must divide out the preview's zoom BEFORE calling this: zoom
 * is a presentation scale with no unit of its own, and folding it in here would
 * make this function about the screen rather than about the report.
 */
export function pxToUnits(px: number, reportUnit?: string): number {
  return (px / CSS_PX_PER_INCH) * unitsPerInch(reportUnit);
}

/** PDF points → report units, for text lifted out of an uploaded PDF. */
export function pointsToUnits(points: number, reportUnit?: string): number {
  return (points / POINTS_PER_INCH) * unitsPerInch(reportUnit);
}

/** Points per unit of a written length, for `lengthToPoints`. */
const POINTS_PER: Record<string, number> = { in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pt: 1, pc: 12, px: 72 / CSS_PX_PER_INCH };

/**
 * A length written with its unit, as an SSRS report definition writes every
 * size ("2.5in", "1cm", "12pt", 2026-11-11, the full audit's CP-08), in
 * points; null when it is not one. A bare number is taken as points, which is
 * what a font size without a unit means.
 */
export function lengthToPoints(written: string | null | undefined): number | null {
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(in|cm|mm|pt|pc|px)?\s*$/i.exec(written ?? '');
  if (!m) return null;
  return Number(m[1].replace(',', '.')) * POINTS_PER[(m[2] ?? 'pt').toLowerCase()];
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

/** A paper's size in inches, portrait, or null for a paper this app has no size for. */
export function paperInches(paper: string): { w: number; h: number } | null {
  return Object.prototype.hasOwnProperty.call(PAGE_INCHES, paper) ? PAGE_INCHES[paper] : null;
}

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

/** The geometry attributes `convertReportUnit` rescales: each a list of numbers in the report's unit. */
const GEOMETRY_ATTRIBUTES = ['LocationFloat', 'SizeF', 'HeightF', 'Margins', 'PageWidth', 'PageHeight'];

/**
 * A finished REPX rewritten from one report unit to another (2026-11-11, the
 * full audit, PL-12).
 *
 * Forma's own builder writes hundredths of an inch, so until then the draft
 * path -- Forma drafts, the AI corrects, at a fifth of the tokens -- ran only
 * for reports in that unit, and a user whose reports are in tenths of a
 * millimetre, most of the metric world, never had it. The draft is still built
 * in hundredths; this turns the file it becomes into the unit asked for.
 *
 * Rescaled: `LocationFloat`, `SizeF`, `HeightF`, `Margins`, `PageWidth` and
 * `PageHeight`, every number in each. Not the font sizes, which are points
 * whatever the unit, nor `BorderWidth`, which is pixels, nor `Padding`, which
 * carries its own Dpi as its fifth number. Each element is read at its own
 * `Dpi` when it has one, as DevExpress reads it, and that `Dpi` is dropped:
 * `repairDpi` writes the target unit's on exactly the elements that need it,
 * so the conversion runs before the repairs. `ReportUnit` names the new unit.
 */
export function convertReportUnit(xml: string, from: string, to: string): string {
  const fromUnit = resolveReportUnit(from);
  const toUnit = resolveReportUnit(to);
  if (fromUnit === toUnit) return xml;
  const source = unitsPerInch(fromUnit);
  const target = unitsPerInch(toUnit);
  const round = (v: number) => String(Math.round(v * 100) / 100);
  const converted = xml.replace(/<([A-Za-z_][\w.:-]*)(\s[^<>]*?)?(\/?)>/g, (whole, name: string, attrs: string | undefined, close: string) => {
    if (!attrs || !/\s(LocationFloat|SizeF|HeightF|Margins|PageWidth|PageHeight|Dpi|ReportUnit)="/.test(attrs)) return whole;
    const dpi = Number(/\sDpi="([\d.]+)"/.exec(attrs)?.[1]);
    const scale = target / (Number.isFinite(dpi) && dpi > 0 ? dpi : source);
    let out = attrs.replace(/\sDpi="[^"]*"/, '');
    for (const attribute of GEOMETRY_ATTRIBUTES) {
      out = out.replace(new RegExp(`(\\s${attribute}=")([^"]*)(")`), (_m, open: string, value: string, end: string) =>
        open + value.replace(/-?\d+(?:\.\d+)?/g, (n) => round(Number(n) * scale)) + end,
      );
    }
    out = out.replace(/(\sReportUnit=")[^"]*(")/, (_m, open: string, end: string) => open + toUnit + end);
    return `<${name}${out}${close}>`;
  });
  // The root names its unit; a file that left it out was in the default.
  return /<XtraReportsLayoutSerializer\b[^>]*\sReportUnit="/.test(converted)
    ? converted
    : converted.replace(/<XtraReportsLayoutSerializer\b/, (open) => `${open} ReportUnit="${toUnit}"`);
}

/** A box in a page image, in its pixels: left, top, right and bottom. */
export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Where a page image's pixels fall on the report's page (OCR, 2026-11-01):
 * report units to a pixel, and where the image's top-left corner lands, in
 * page coordinates.
 */
export interface ImagePlacement {
  unitsPerPixel: number;
  left: number;
  top: number;
}

/**
 * Place a page image on a report page.
 *
 * Two cases, because the two sources say different things about their size:
 *
 * - **A rendered PDF page knows its resolution.** It is the whole page drawn
 *   at `dpi`, so a pixel is `1/dpi` of an inch and the image's corner is the
 *   page's: a word 360 pixels from the left of a page rendered at 180 dpi is
 *   two inches in, margins included.
 * - **A screenshot does not.** Its pixels are whatever the screen was, so its
 *   width is fitted to the page's printable width and its corner put at the
 *   margins: the screenshot is taken to be the report's content, which is
 *   what a user photographs or captures.
 * - **A screenshot with its page's shape is the whole page** (2026-11-03),
 *   margins and all: a scan, or a capture of a PDF page from edge to edge. It
 *   is placed as a rendered page is, from the page's corner and across its
 *   full width. Fitted inside the margins as well, every text on it came out
 *   pushed in and shrunk: measured on 40 drawn report pages, OCR found 21.8%
 *   of the texts where they print, against 55.7% with the scale known.
 *   `page.height` is what makes the comparison possible; without it the
 *   screenshot is fitted as before.
 */
export function placeImage(
  image: { width: number; height: number; dpi: number | null },
  page: { width: number; height?: number; margins: { left: number; right: number; top: number } },
  reportUnit?: string,
): ImagePlacement {
  if (image.dpi && image.dpi > 0) return { unitsPerPixel: unitsPerInch(reportUnit) / image.dpi, left: 0, top: 0 };
  if (page.height && image.width > 0 && Math.abs(image.height / image.width / (page.height / page.width) - 1) <= WHOLE_PAGE_TOLERANCE) {
    return { unitsPerPixel: page.width / image.width, left: 0, top: 0 };
  }
  const printable = Math.max(1, page.width - page.margins.left - page.margins.right);
  return { unitsPerPixel: printable / Math.max(1, image.width), left: page.margins.left, top: page.margins.top };
}

/**
 * How near a picture's shape must be to a paper's for the picture to be taken
 * as that whole page. The papers this app knows differ by far more: A4 is
 * 1.414 times as tall as it is wide, Letter 1.294, Tabloid 1.545, Legal 1.647.
 */
export const WHOLE_PAGE_TOLERANCE = 0.02;

/** How many times as long as it is wide, whichever way up. */
const elongation = (w: number, h: number) => Math.max(w, h) / Math.max(1e-9, Math.min(w, h));

/**
 * The paper a picture with no resolution is the whole page of, judged by its
 * shape (2026-11-03), or null when it has the shape of none. The configured
 * paper is tried first. A full-page A4 scan is A4 even when the settings
 * still say Letter, the default. A4 and A5 have the same shape, so a picture
 * of either is taken for A4, the one this app knows.
 */
export function paperOfImage(image: { width: number; height: number }, paper?: string): string | null {
  const shape = elongation(image.width, image.height);
  const near = (p: string) => Math.abs(shape / elongation(PAGE_INCHES[p].w, PAGE_INCHES[p].h) - 1) <= WHOLE_PAGE_TOLERANCE;
  const configured = isSupportedPageSize(paper) ? (paper as string) : DEFAULT_PAGE_SIZE;
  if (near(configured)) return configured;
  return SUPPORTED_PAGE_SIZES.find(near) ?? null;
}

/** A pixel box on the page, in report units: its left, top, width and height. */
export function pixelBoxToUnits(box: PixelBox, at: ImagePlacement): { x: number; y: number; w: number; h: number } {
  return {
    x: at.left + box.x0 * at.unitsPerPixel,
    y: at.top + box.y0 * at.unitsPerPixel,
    w: (box.x1 - box.x0) * at.unitsPerPixel,
    h: (box.y1 - box.y0) * at.unitsPerPixel,
  };
}

/**
 * The page an image is a picture of, in report units: a rendered PDF page's
 * own size from its pixels and resolution; for a screenshot, the paper it
 * has the shape of (`paperOfImage`), else `paper` (the configured page size,
 * Letter when absent), turned when the image is wider than it is tall.
 */
export function pageForImage(
  image: { width: number; height: number; dpi: number | null },
  reportUnit?: string,
  paper?: string,
): PageSize {
  if (image.dpi && image.dpi > 0) {
    const per = unitsPerInch(reportUnit) / image.dpi;
    return { width: Math.round(image.width * per), height: Math.round(image.height * per) };
  }
  const size = pageSizeInUnits(paperOfImage(image, paper) ?? paper ?? 'Letter', reportUnit);
  return image.width > image.height ? { width: size.height, height: size.width } : size;
}

/**
 * The resolution of a rendered PDF page as it reached the app: its width in
 * pixels against the page's width in PDF points. Measured from the image
 * rather than taken from the render scale, because a page image is resized
 * on the way in when it is larger than the upload cap.
 */
export function imageDpi(pixelWidth: number, pageWidthPoints: number): number | null {
  return pixelWidth > 0 && pageWidthPoints > 0 ? (pixelWidth * POINTS_PER_INCH) / pageWidthPoints : null;
}