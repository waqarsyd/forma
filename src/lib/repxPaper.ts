/**
 * The paper a report prints on, and `PaperKind` on the reports Forma writes.
 *
 * ## The measurement
 *
 * DevExpress takes the page size from `PaperKind`, not from `PageWidth` and
 * `PageHeight`. Printed through DevExpress 20.1 (cases s30p1 to s30p8 of
 * `docs/proposals/devexpress-parity.md`, 2026-10-31):
 *
 *     PageWidth="827" PageHeight="1169", nothing else      Letter, two pages
 *     PaperKind="A4" and that size                         A4, one page
 *     PageWidth="1100" PageHeight="850", nothing else      Letter portrait
 *     Landscape="true" and that size                       Letter landscape
 *     PaperKind="A4" with Letter's size written            A4
 *     Landscape="true" PaperKind="A4", portrait size       A4 landscape
 *     PaperKind="Custom" PageWidth="900" PageHeight="600"  900 by 600
 *
 * So the paper is `PaperKind`'s, Letter when there is none, turned by
 * `Landscape`, and only a `Custom` paper prints the size written. Forma wrote
 * no `PaperKind` at all, so every report it generated on A4, Legal or Tabloid,
 * or in landscape, loaded and printed on Letter portrait, spilling onto extra
 * pages, while its own Preview read the size written and showed the paper
 * intended.
 *
 * ## What the serializer writes
 *
 * Read from reports DevExpress saved: nothing for Letter, `PaperKind="A4"`,
 * `"Legal"` or `"Tabloid"` with the size, `Landscape="true"` with the size
 * turned for landscape (and the `PaperKind` unless it is Letter), and
 * `PaperKind="Custom"` with any other size. The sizes it writes are the ones
 * `pageSizeInUnits` computes, in all three units.
 */
import { SUPPORTED_PAGE_SIZES, pageSizeInUnits, paperInches, unitsPerInch } from './reportGeometry';

export interface PaperRepair {
  xml: string;
  applied: boolean;
  reason: string;
}

/** The paper DevExpress prints a report on. Its size is in the report's unit. */
export interface PrintedPaper {
  /** `PaperKind` as written, `Letter` when absent. */
  kind: string;
  landscape: boolean;
  width: number;
  height: number;
}

/** A report whose written page size is not the paper DevExpress prints it on. */
export interface PaperProblem {
  written: { width: number; height: number };
  printed: PrintedPaper;
  /** Whether the file names its paper; when it does not, DevExpress assumes Letter. */
  named: boolean;
}

const ROOT = /<XtraReportsLayoutSerializer\b((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)/;

const attrOf = (attrs: string, name: string): string | null =>
  new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1] ?? null;

const numberOf = (attrs: string, name: string): number | null => {
  const n = Number.parseFloat(attrOf(attrs, name) ?? '');
  return Number.isFinite(n) ? n : null;
};

/** Within a unit: the serializer rounds a paper's size to whole units. */
const near = (a: number, b: number) => Math.abs(a - b) <= 1;

/**
 * The paper DevExpress prints a report on, from its root's attributes: the
 * size of `PaperKind`, Letter when there is none, turned for `Landscape`. A
 * `Custom` paper, and one this app has no size for, prints the size written,
 * which the serializer writes turned already.
 */
export function printedPaper(rootAttrs: string): PrintedPaper {
  const unit = attrOf(rootAttrs, 'ReportUnit') || 'HundredthsOfAnInch';
  const kind = attrOf(rootAttrs, 'PaperKind') || 'Letter';
  const landscape = (attrOf(rootAttrs, 'Landscape') ?? '').toLowerCase() === 'true';
  const inches = kind === 'Custom' ? null : paperInches(kind);
  if (!inches) {
    return { kind, landscape, width: numberOf(rootAttrs, 'PageWidth') ?? 850, height: numberOf(rootAttrs, 'PageHeight') ?? 1100 };
  }
  // The paper's own size, not the rounded one written: DevExpress printed A4
  // 2480.315 by 3507.874 three-hundredths of an inch, which is 826.77 by 1169.29.
  const per = unitsPerInch(unit);
  const [w, h] = [inches.w * per, inches.h * per];
  return landscape ? { kind, landscape, width: h, height: w } : { kind, landscape, width: w, height: h };
}

/**
 * A report whose written size is not the paper DevExpress prints it on, or
 * null when they agree or nothing is written. What every non-Letter report
 * Forma generated before `repairPaper` looks like, and an uploaded file can.
 */
export function findPaperProblem(xml: string | undefined | null): PaperProblem | null {
  const attrs = ROOT.exec(xml ?? '')?.[1];
  if (attrs === undefined) return null;
  const width = numberOf(attrs, 'PageWidth');
  const height = numberOf(attrs, 'PageHeight');
  if (width === null || height === null) return null;
  const printed = printedPaper(attrs);
  if (near(width, printed.width) && near(height, printed.height)) return null;
  return { written: { width, height }, printed, named: attrOf(attrs, 'PaperKind') !== null };
}

/**
 * Name the paper a report's written size is, as DevExpress's serializer would:
 * `PaperKind` for any paper but Letter, `Landscape="true"` when the size is
 * turned, and `Custom` for a size no paper has. A report that already names its
 * paper or orientation is left alone, as is one with no size written.
 */
export function repairPaper(xml: string | undefined | null): PaperRepair {
  const text = xml ?? '';
  const root = ROOT.exec(text);
  if (!root) return { xml: text, applied: false, reason: 'no report root' };
  const attrs = root[1];
  if (attrOf(attrs, 'PaperKind') !== null || attrOf(attrs, 'Landscape') !== null) {
    return { xml: text, applied: false, reason: 'the report already names its paper' };
  }
  const width = numberOf(attrs, 'PageWidth');
  const height = numberOf(attrs, 'PageHeight');
  if (width === null || height === null) return { xml: text, applied: false, reason: 'no page size written, so Letter it is' };

  const unit = attrOf(attrs, 'ReportUnit') || 'HundredthsOfAnInch';
  let named = ' PaperKind="Custom"';
  let what = `a ${width} by ${height} page, which no paper is`;
  for (const paper of SUPPORTED_PAGE_SIZES) {
    const size = pageSizeInUnits(paper, unit);
    if (near(width, size.width) && near(height, size.height)) {
      if (paper === 'Letter') return { xml: text, applied: false, reason: 'Letter portrait, which DevExpress assumes' };
      [named, what] = [` PaperKind="${paper}"`, paper];
      break;
    }
    if (near(width, size.height) && near(height, size.width)) {
      [named, what] = [` Landscape="true"${paper === 'Letter' ? '' : ` PaperKind="${paper}"`}`, `${paper} landscape`];
      break;
    }
  }
  // Before PageWidth, where the serializer writes it. Found as an attribute,
  // since it was read as one above, whatever whitespace comes before it.
  const at = root.index + /\sPageWidth\s*=/.exec(root[0])!.index;
  return {
    xml: text.slice(0, at) + named + text.slice(at),
    applied: true,
    reason: `named the paper, ${what}, so DevExpress prints the page it was written for`,
  };
}
