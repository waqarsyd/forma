/**
 * A report drawn as a draft PDF with no browser (2026-11-24, moved out of
 * scripts/repx.ts unchanged, where it was written on 2026-11-11 for the
 * full audit's CP-12). Two callers share it: `npx tsx scripts/repx.ts pdf`
 * and repx_pdf, the MCP server's tool.
 *
 * The report is laid out with the Preview's own engine (`paginate`, with no
 * data, five records: a field's place is laid out and left empty, as the
 * Preview's first view leaves it) and written with Forma's PDF writer in the
 * standard fonts: text on one line per control or cell, the first line of
 * each, its width estimated at half an em a character for centring; borders
 * and lines as drawn. It is
 * a draft for checking where things fall, not the Preview's PDF export,
 * which draws from the browser's own pages and fonts.
 */
import { paginate, parseReportStructure, type PaginatedReport } from './reportPreview';
import { unitsPerInch } from './reportGeometry';
import { writePdf, type PdfOp, type PdfPage, type StandardFont } from './pdfWriter';

/** How many records the draft lays out: the Preview's first view, with no data. */
const RECORDS = 5;

/** The standard font a control's family and weight print in. */
export function fontOf(family: string | null, bold: boolean, italic: boolean): StandardFont {
  const f = (family ?? '').toLowerCase();
  const base = /times|serif|georgia|garamond/.test(f) && !/sans/.test(f) ? 'Times' : /courier|mono|consol/.test(f) ? 'Courier' : 'Helvetica';
  if (base === 'Times') return bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman';
  const suffix = bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : '';
  return `${base}${suffix}` as StandardFont;
}

/** A laid-out report as pages of drawing operations, in points. */
export function pdfPages(report: PaginatedReport): PdfPage[] {
  const pt = (units: number) => (units / unitsPerInch(report.unit)) * 72;
  const black: [number, number, number] = [0, 0, 0];
  const text = (ops: PdfOp[], x: number, y: number, w: number, value: string, size: number, font: StandardFont, align: string) => {
    const line = value.split(/\r?\n/)[0];
    if (!line) return;
    // An estimate of the line's width, for centred and right-aligned text: half an em a character.
    const width = Math.min(w, line.length * size * 0.5);
    const left = align === 'center' ? x + (w - width) / 2 : align === 'right' ? x + w - width : x;
    ops.push({ kind: 'text', x: left + 1, y: y + size, size, font, colour: black, text: line, scale: 1 });
  };
  const box = (ops: PdfOp[], x: number, y: number, w: number, h: number, sides: { top: boolean; right: boolean; bottom: boolean; left: boolean }) => {
    const line = (x1: number, y1: number, x2: number, y2: number) => ops.push({ kind: 'line', x1, y1, x2, y2, width: 0.5, colour: black });
    if (sides.top) line(x, y, x + w, y);
    if (sides.bottom) line(x, y + h, x + w, y + h);
    if (sides.left) line(x, y, x, y + h);
    if (sides.right) line(x + w, y, x + w, y + h);
  };
  return report.pages.map((page) => {
    const ops: PdfOp[] = [];
    for (const band of page.bands) {
      for (const placed of band.controls) {
        const c = placed.control;
        if (!c.visible) continue;
        const x = pt(band.left + c.x);
        const y = pt(band.top + placed.y);
        const w = pt(c.width);
        const h = pt(placed.height);
        if (c.type === 'XRTable') {
          const heights = placed.rowHeights ?? c.rows.map(() => placed.height / Math.max(1, c.rows.length));
          let top = y;
          c.rows.slice(placed.rowStart, placed.rowStart + heights.length).forEach((row, ri) => {
            const total = row.cells.reduce((sum, cell) => sum + (cell.weight || 1), 0) || 1;
            const rowH = pt(heights[ri] ?? 0);
            let left = x;
            row.cells.forEach((cell, ci) => {
              const cellW = (w * (cell.weight || 1)) / total;
              const value = placed.cellTexts?.[placed.rowStart + ri]?.[ci] ?? cell.text;
              box(ops, left, top, cellW, rowH, cell.borders);
              text(ops, left, top, cellW, value, cell.fontSize ?? 9, fontOf(cell.fontFamily, cell.bold, cell.italic), cell.align);
              left += cellW;
            });
            top += rowH;
          });
          continue;
        }
        box(ops, x, y, w, h, c.borders);
        if (c.type === 'XRLine') {
          ops.push({ kind: 'line', x1: x, y1: y + h / 2, x2: x + w, y2: y + h / 2, width: 1, colour: black });
          continue;
        }
        const value = placed.text ?? (c.field ? `[${c.field}]` : c.text);
        if (value) text(ops, x, y, w, value, c.fontSize ?? 9, fontOf(c.fontFamily, c.bold, c.italic), c.align);
      }
    }
    return { width: pt(report.page.width), height: pt(report.page.height), ops };
  });
}

/** The draft PDF of a report, or null when no band could be read from it. */
export async function draftPdf(xml: string, fallbackTitle: string): Promise<{ bytes: Uint8Array; pages: number; problems: string[] } | null> {
  const structure = parseReportStructure(xml);
  if (!structure.bands.length) return null;
  const report = paginate(structure, RECORDS);
  const pages = pdfPages(report);
  const bytes = await writePdf({ title: structure.outlineTitle ?? fallbackTitle, pages });
  return { bytes, pages: pages.length, problems: report.problems };
}
