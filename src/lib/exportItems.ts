/**
 * What a laid-out report prints as text, item by item, for the exports that
 * place text rather than draw it: XLSX, HTML, RTF and DOCX.
 *
 * Each item is one control's text, or one table or cross-tab cell's, with
 * its box in report units, the page it is on, and its font, colour, fill,
 * alignment and link. It was `itemsOf` in `xlsxExport.ts` until parity row
 * 21 needed the same reading for three more formats, two of them by page.
 * The font size is as designed; XLSX keeps whole points of it, as DevExpress
 * wrote the default 9.75pt there as 9, while its RTF wrote it as 19
 * half-points and its HTML as 13 pixels.
 */
import type { Value } from './criteria';
import { placedControls } from './csvExport';
import { cssColor, fontDecoration, pageInfoText, tocCells, type Appearance, type PaginatedReport, type PreviewControl } from './reportPreview';

/** Controls that print no text of their own make no item. */
export const TEXTLESS = new Set(['XRLine', 'XRShape', 'XRPictureBox', 'XRBarCode', 'XRChart', 'XRCrossTab', 'XRGauge', 'XRSparkline', 'XRPanel', 'XRRichText', 'XRSubreport', 'XRPageBreak']);

export interface ExportItem {
  /** The page it prints on, 0-based; 0 throughout a continuous layout. */
  page: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  text: string;
  /** The lines this part prints, where the text was measured: what a page-by-page export puts in its frame. */
  lines: string[] | null;
  value: Value | null | undefined;
  format: string | null;
  font: { name: string; size: number; bold: boolean; italic: boolean; underline: boolean; color: string };
  fill: string | null;
  h: 'left' | 'center' | 'right';
  v: 'top' | 'center' | 'bottom';
  url: string | null;
  /** A page-info control, which DevExpress wrote as text. */
  pageNumber?: boolean;
}

/** `#RRGGBB` or `rgb(r, g, b)` as Excel's `FFRRGGBB`. */
export function argb(css: string | undefined | null, fallback: string): string {
  if (!css) return fallback;
  const hex = /^#([0-9a-f]{6})$/i.exec(css);
  if (hex) return `FF${hex[1].toUpperCase()}`;
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(css);
  if (rgb) return 'FF' + [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  return fallback;
}

function fontOf(c: { fontFamily: string | null; fontSize: number | null; bold: boolean; italic: boolean }, look: Appearance) {
  return {
    // With no font anywhere DevExpress 20.1 prints Times New Roman 9.75pt.
    name: c.fontFamily ?? 'Times New Roman',
    size: c.fontSize ?? 9.75,
    bold: c.bold,
    italic: c.italic,
    underline: (fontDecoration(look.Font) ?? '').includes('underline'),
    color: argb(cssColor(look.ForeColor), 'FF000000'),
  };
}

const horizontal = (a: string): ExportItem['h'] => (a === 'center' ? 'center' : a === 'right' ? 'right' : 'left');
const vertical = (a: string): ExportItem['v'] => (a === 'middle' ? 'center' : a === 'bottom' ? 'bottom' : 'top');

/** Every text item `report` prints, page by page. */
export function reportItems(report: PaginatedReport): ExportItem[] {
  const out: ExportItem[] = [];
  for (const { page, bandLeft, bandTop, pc } of placedControls(report)) {
    const index = page.number - 1;
    const c: PreviewControl = pc.control;
    const left = bandLeft + c.x + c.offsetX;
    const top = bandTop + pc.y;
    // A cross-tab's grid, in DevExpress's default appearance: s25 printed none
    // of the cross-tab's own reaching its cells, and wrote values typed.
    if (pc.crossTab) {
      for (const cell of pc.crossTab.cells) {
        out.push({
          page: index,
          left: left + cell.x, top: top + cell.y, right: left + cell.x + cell.width, bottom: top + cell.y + cell.height,
          text: cell.text, lines: null, value: cell.value, format: null,
          font: fontOf({ fontFamily: null, fontSize: null, bold: false, italic: false }, {}),
          fill: null, h: 'left', v: 'top', url: null,
        });
      }
      continue;
    }
    // A table of contents: its heading and rows, each title and its page
    // number in boxes of their own, as DevExpress's RTF and HTML of s55c had them.
    if (pc.toc && c.toc) {
      for (const cell of tocCells(pc, left, top, report.unit)) {
        const f = cell.heading ? c.toc.titleFont : c.toc.rowFont;
        out.push({
          page: index,
          left: cell.x, top: cell.y, right: cell.x + cell.w, bottom: cell.y + cell.h,
          text: cell.text, lines: null, value: undefined, format: null,
          font: fontOf({ fontFamily: f.family, fontSize: f.size, bold: f.bold, italic: f.italic }, c.appearance),
          fill: null, h: cell.align, v: cell.heading ? 'top' : 'bottom', url: null,
        });
      }
      continue;
    }
    if (TEXTLESS.has(c.type)) continue;
    if (c.type === 'XRTable') {
      const heights = pc.rowHeights ?? c.rows.map(() => c.height / Math.max(1, c.rows.length));
      let y = top;
      heights.forEach((h, r) => {
        const row = c.rows[pc.rowStart + r];
        if (!row) return;
        const total = row.cells.reduce((s, cell) => s + cell.weight, 0) || 1;
        let x = left;
        row.cells.forEach((cell, i) => {
          const w = (c.width * cell.weight) / total;
          out.push({
            page: index,
            left: x, top: y, right: x + w, bottom: y + h,
            text: pc.cellTexts?.[pc.rowStart + r]?.[i] ?? cell.text,
            lines: null,
            value: pc.cellValues?.[pc.rowStart + r]?.[i],
            format: cell.data.format,
            font: fontOf(cell, cell.appearance),
            fill: cssColor(cell.appearance.BackColor) ?? null,
            h: horizontal(cell.align), v: vertical(cell.vAlign), url: null,
          });
          x += w;
        });
        y += h;
      });
      continue;
    }
    out.push({
      page: index,
      left, top, right: left + c.width, bottom: top + pc.height,
      text: c.pageInfo ? pageInfoText(c.pageInfo, page.number, report.pages.length) : pc.text ?? c.text,
      lines: c.pageInfo ? null : pc.lines,
      value: c.pageInfo ? undefined : pc.value,
      format: c.data.format,
      font: fontOf(c, c.appearance),
      fill: cssColor(c.appearance.BackColor) ?? null,
      h: horizontal(c.align), v: vertical(c.vAlign), url: pc.url ?? null,
      pageNumber: !!c.pageInfo,
    });
  }
  return out;
}

/**
 * A picture an export places: a chart or other drawing the Preview drew,
 * rasterized by the browser to PNG bytes, with its box in report units.
 */
export interface ExportPicture {
  page: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  png: Uint8Array;
}

/** `FFRRGGBB` as its six hex digits, as RTF, DOCX and HTML want them. */
export const rgbHex = (argbColour: string) => argbColour.slice(-6);
/* `cssHex`, a colour as `#RRGGBB`, went on 2026-11-11 (the full audit's RH-06):
   no export called it. `0cec241` has it. */