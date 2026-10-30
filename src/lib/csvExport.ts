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
 *   Lines end CRLF, the last one too, and there is no byte-order mark.
 */
import { pageInfoText, paginate, type PaginatedReport, type PaginateOptions, type PreviewBand, type ReportStructure } from './reportPreview';

/** Controls that print no text of their own make no CSV cell. */
const TEXTLESS = new Set(['XRLine', 'XRShape', 'XRPictureBox', 'XRBarCode', 'XRChart', 'XRCrossTab', 'XRGauge', 'XRSparkline', 'XRPanel', 'XRRichText']);

const quote = (field: string) => (/[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field);
const key = (n: number) => Math.round(n * 100) / 100;

/** Every printed text of a laid-out report with its page-absolute position. */
function cellsOf(report: PaginatedReport): { x: number; y: number; text: string }[] {
  const out: { x: number; y: number; text: string }[] = [];
  for (const page of report.pages) {
    for (const band of page.bands) {
      for (const pc of band.controls) {
        const c = pc.control;
        if (TEXTLESS.has(c.type)) continue;
        const left = band.left + c.x + c.offsetX;
        const top = band.top + pc.y;
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
    }
  }
  return out;
}

/**
 * Lay the report out as DevExpress lays it out for CSV -- on one page tall
 * enough to hold everything -- and write it.
 */
export function reportToCsv(structure: ReportStructure, recordCount: number, options: PaginateOptions = {}): string {
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
  const report = paginate(continuous, recordCount, { ...options, maxPages: 1 });
  const cells = cellsOf(report);
  const xs = [...new Set(cells.map((c) => key(c.x)))].sort((a, b) => a - b);
  const ys = [...new Set(cells.map((c) => key(c.y)))].sort((a, b) => a - b);
  const grid = ys.map(() => xs.map(() => [] as string[]));
  for (const c of cells) grid[ys.indexOf(key(c.y))][xs.indexOf(key(c.x))].push(c.text);
  return grid.map((row) => row.map((parts) => quote(parts.join(' '))).join(',')).join('\r\n') + '\r\n';
}

/** The file name for a report's export: its title, whitespace collapsed to underscores, as the .repx download names it. */
export function exportFileName(title: string | null | undefined, extension: string): string {
  const base = (title ?? '').trim().replace(/\s+/g, '_').replace(/[\\/:*?"<>|]+/g, '') || 'report';
  return `${base}.${extension}`;
}
