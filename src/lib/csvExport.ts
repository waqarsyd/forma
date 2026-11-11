/**
 * The report as CSV, the way DevExpress 20.1 exports it.
 *
 * Measured by exporting the parity cases through `RepxProbe render` on
 * 2026-10-30 (row 20 of `docs/proposals/devexpress-parity.md`), and compared
 * byte for byte with what this writes:
 *
 * - **One continuous page.** The page header and footer appear once, at the
 *   top and the bottom; groups print once each; nothing breaks across pages,
 *   and the page number reads "Page 1 of 1".
 * - **A line for every distinct top, a column for every distinct left edge**,
 *   over every printed control in the report -- table cells included, each at
 *   its own left. So a page-footer label at x=550 adds a column every line
 *   carries, empty everywhere else.
 * - **The printed text**, formatted: `$1,001.07`, not 1001.07. A control that
 *   prints nothing still makes its line, as `,,`.
 * - Fields are quoted only when they hold a comma, a quote or a line break.
 *   Lines end CRLF, the last one too, and there is no byte-order mark (unless
 *   the text holds a character outside ASCII; see `reportToCsv`).
 */
import {
  pageInfoText,
  paginate,
  tocCells,
  type PaginatedReport,
  type PaginateOptions,
  type PlacedBand,
  type PlacedControl,
  type PreviewBand,
  type PreviewPage,
  type ReportStructure,
} from './reportPreview';

/**
 * Controls that print no text of their own make no CSV cell. A subreport's
 * text is its inner report's, reached through `placedControls`; DevExpress's
 * CSV and workbook of s22b held those lines and no edge for the box itself.
 */
const TEXTLESS = new Set(['XRLine', 'XRShape', 'XRPictureBox', 'XRBarCode', 'XRChart', 'XRCrossTab', 'XRGauge', 'XRSparkline', 'XRPanel', 'XRRichText', 'XRSubreport', 'XRPageBreak']);

const quote = (field: string) => (/[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field);
const key = (n: number) => Math.round(n * 100) / 100;

/**
 * Every placed control of a laid-out report with the page-absolute origin of
 * the band it sits in, an embedded subreport's controls included at their
 * place inside it.
 */
export function placedControls(report: PaginatedReport): { page: PreviewPage; bandLeft: number; bandTop: number; pc: PlacedControl }[] {
  const out: { page: PreviewPage; bandLeft: number; bandTop: number; pc: PlacedControl }[] = [];
  const walk = (page: PreviewPage, bandLeft: number, bandTop: number, controls: readonly PlacedControl[]) => {
    for (const pc of controls) {
      out.push({ page, bandLeft, bandTop, pc });
      for (const inner of pc.inner ?? []) {
        walk(page, bandLeft + pc.control.x + pc.control.offsetX + inner.left, bandTop + pc.y + inner.top, inner.controls);
      }
    }
  };
  for (const page of report.pages) for (const band of page.bands) walk(page, band.left, band.top, band.controls);
  return out;
}

/**
 * What a picture an export places shows, for its alternative text: the
 * `AccessibleDescription` of the smallest control on its page whose box holds
 * the picture's centre, or '' when that control has none (2026-11-11, CP-14).
 * Until then the HTML export wrote every picture `alt=""` and the Word export
 * no description, though the chat's `describe` writes one into the file.
 */
export function pictureDescription(
  report: PaginatedReport,
  picture: { page: number; left: number; top: number; right: number; bottom: number },
): string {
  const cx = (picture.left + picture.right) / 2;
  const cy = (picture.top + picture.bottom) / 2;
  let best: { area: number; description: string } | null = null;
  for (const { page, bandLeft, bandTop, pc } of placedControls(report)) {
    if (page.number - 1 !== picture.page) continue;
    const left = bandLeft + pc.control.x + pc.control.offsetX;
    const top = bandTop + pc.y;
    if (cx < left || cx > left + pc.control.width || cy < top || cy > top + pc.height) continue;
    const area = pc.control.width * pc.height;
    if (!best || area < best.area) best = { area, description: pc.control.description ?? '' };
  }
  return best?.description ?? '';
}

/** Every printed text of a laid-out report with its page-absolute position. */
function cellsOf(report: PaginatedReport): { x: number; y: number; text: string }[] {
  const out: { x: number; y: number; text: string }[] = [];
  for (const { page, bandLeft, bandTop, pc } of placedControls(report)) {
    const c = pc.control;
    const left = bandLeft + c.x + c.offsetX;
    const top = bandTop + pc.y;
    // A cross-tab drawn over test data exports its grid, as DevExpress's did.
    if (pc.crossTab) {
      for (const cell of pc.crossTab.cells) out.push({ x: left + cell.x, y: top + cell.y, text: cell.text });
      continue;
    }
    // A table of contents exports its heading and rows, as DevExpress's did (s55c).
    if (pc.toc) {
      for (const cell of tocCells(pc, left, top, report.unit)) out.push({ x: cell.x, y: cell.y, text: cell.text });
      continue;
    }
    if (TEXTLESS.has(c.type)) continue;
    if (c.type === 'XRTable') {
      const rowHeights = pc.rowHeights ?? c.rows.map(() => c.height / Math.max(1, c.rows.length));
      let y = top;
      rowHeights.forEach((h, r) => {
        const row = c.rows[pc.rowStart + r];
        if (!row) return;
        const total = row.cells.reduce((s, cell) => s + cell.weight, 0) || 1;
        let x = left;
        row.cells.forEach((cell, i) => {
          out.push({ x, y, text: pc.cellTexts?.[pc.rowStart + r]?.[i] ?? cell.text });
          x += (c.width * cell.weight) / total;
        });
        y += h;
      });
      continue;
    }
    const text = c.pageInfo ? pageInfoText(c.pageInfo, page.number, report.pages.length) : pc.text ?? c.text;
    out.push({ x: left, y: top, text });
  }
  return out;
}

/**
 * The report laid out as DevExpress lays it out for CSV and Excel: on one page
 * tall enough to hold everything, with the settings about pages neutral.
 */
export function layoutContinuous(structure: ReportStructure, recordCount: number, options: PaginateOptions = {}): PaginatedReport {
  // On one continuous page, settings about pages do nothing: DevExpress's CSV of
  // c04b (PrintOn, PrintAtBottom) was byte for byte its CSV of c04, and c05c's
  // (PageBreak after every group) was c05's.
  const flow = (band: PreviewBand): PreviewBand => ({
    ...band,
    printOn: 'AllPages',
    printAtBottom: false,
    pageBreak: 'None',
    groupUnion: 'None',
    sub: band.sub ? { ...band.sub, bands: band.sub.bands.map(flow) } : null,
  });
  const continuous: ReportStructure = { ...structure, page: { ...structure.page, height: 1e9 }, bands: structure.bands.map(flow) };
  const report = paginate(continuous, recordCount, { ...options, maxPages: 1, overflowPages: false });
  // The page footer follows the last of the content, not the foot of a page a
  // billion units tall: DevExpress's workbooks put it directly after the report
  // footer, the gap between them exactly the two bands' own spacing. The bottom
  // margin band follows it: DevExpress's CSV and workbook of s29m ended with its
  // texts, as they began with the top margin band's (parity row 38).
  const atFoot = (b: PlacedBand) => b.band.kind === 'PageFooter' || b.band.kind === 'BottomMargin';
  for (const page of report.pages) {
    const end = Math.max(0, ...page.bands.filter((b) => !atFoot(b)).map((b) => b.top + b.height));
    const footer = page.bands.find((b) => b.band.kind === 'PageFooter');
    page.bands = page.bands.map((b) =>
      b.band.kind === 'PageFooter' ? { ...b, top: end } : b.band.kind === 'BottomMargin' ? { ...b, top: end + (footer?.height ?? 0) } : b);
  }
  return report;
}

/**
 * How the CSV is written beyond DevExpress's form. `safeForSpreadsheets`
 * (the Export panel's "Safe for spreadsheets", off by default so the file
 * stays DevExpress's byte for byte; 2026-11-11, the full audit's SE-18) puts
 * an apostrophe before a cell that starts with `=`, `+`, `-`, `@`, a tab or a
 * carriage return, which a
 * spreadsheet would otherwise run as a formula when the file is opened: data
 * from a database can hold one. A plain number, "-12.50", is left alone.
 */
export interface CsvOptions {
  safeForSpreadsheets?: boolean;
}

/*
 * The choice is the viewer's own, kept in this browser like a remembered tab:
 * the Export panel sets it, and every CSV written here follows it, whether
 * the panel or the chat asked for the file. Unreadable storage means off.
 */
const SAFE_KEY = 'forma.csvSafeForSpreadsheets';

/** Whether this browser asked for CSV safe for spreadsheets. */
export function csvSafetyPreferred(): boolean {
  try {
    return globalThis.localStorage?.getItem(SAFE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember, in this browser, whether CSV is written safe for spreadsheets. */
export function preferCsvSafety(on: boolean): void {
  try {
    if (on) globalThis.localStorage?.setItem(SAFE_KEY, '1');
    else globalThis.localStorage?.removeItem(SAFE_KEY);
  } catch {
    // Storage refused (a private window): the switch holds for this visit only.
  }
}

// A tab or carriage return first is on OWASP's list beside the four signs: a
// spreadsheet can strip it and then run what follows (the PXA review).
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[-+]?\d[\d,]*(?:\.\d+)?%?$/;
const neutralise = (field: string) => (FORMULA_START.test(field) && !PLAIN_NUMBER.test(field) ? `'${field}` : field);

/**
 * Lay the report out on one continuous page and write it as CSV.
 *
 * A file holding any character outside ASCII starts with a byte-order mark
 * (2026-11-11, the full audit's PX-18): without one Excel reads a CSV in the
 * machine's ANSI code page, and "Café" opened with its last letter as two
 * wrong ones. DevExpress wrote
 * none, and its measured cases were all ASCII, so those stay byte for byte.
 */
export function reportToCsv(
  structure: ReportStructure,
  recordCount: number,
  options: PaginateOptions = {},
  csv: CsvOptions = { safeForSpreadsheets: csvSafetyPreferred() },
): string {
  const cells = cellsOf(layoutContinuous(structure, recordCount, options));
  const xs = [...new Set(cells.map((c) => key(c.x)))].sort((a, b) => a - b);
  const ys = [...new Set(cells.map((c) => key(c.y)))].sort((a, b) => a - b);
  const grid = ys.map(() => xs.map(() => [] as string[]));
  for (const c of cells) grid[ys.indexOf(key(c.y))][xs.indexOf(key(c.x))].push(c.text);
  const field = (text: string) => quote(csv.safeForSpreadsheets ? neutralise(text) : text);
  const text = grid.map((row) => row.map((parts) => field(parts.join(' '))).join(',')).join('\r\n') + '\r\n';
  return /[^\x00-\x7F]/.test(text) ? `\uFEFF${text}` : text;
}

/** The file name for a report's export: its title, whitespace collapsed to underscores, as the .repx download names it. */
export function exportFileName(title: string | null | undefined, extension: string): string {
  const base = (title ?? '').trim().replace(/\s+/g, '_').replace(/[\\/:*?"<>|]+/g, '') || 'report';
  return `${base}.${extension}`;
}
