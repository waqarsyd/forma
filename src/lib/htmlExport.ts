/**
 * The report as an HTML page, the way DevExpress 20.1 exports one (parity
 * row 21), read out of its HTML of s23 and s54a:
 *
 * - **One continuous page**, as CSV and XLSX are (`layoutContinuous`): the
 *   page header and footer once, nothing broken.
 * - **A table whose grid is the layout.** A column edge at every item's left
 *   and right and a row edge at every top and bottom, each the position in
 *   report units rounded to whole pixels at 96 to the inch, from the
 *   content's top-left corner; then each item a cell spanning its columns
 *   and rows. s54a's 400-unit title spanned 384 pixels and a customer 20
 *   across started at 19; its report footer at 1255 started at 1205.
 * - A one-line text in `<nobr>` with its spaces as `&nbsp;`, as there; its
 *   font in pixels, colour, fill and alignment on the cell.
 *
 * Where DevExpress writes a chart as a PNG beside the page in a `_files`
 * folder, this embeds it in the page as a data URL, because a browser
 * download is one file.
 */
import { unitsPerInch } from './reportGeometry';
import { argb, reportItems, rgbHex, type ExportItem, type ExportPicture } from './exportItems';
import type { PaginatedReport, ReportStructure } from './reportPreview';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

interface Placed {
  left: number;
  top: number;
  right: number;
  bottom: number;
  item?: ExportItem;
  picture?: ExportPicture;
}

/**
 * The report laid out continuously as `report` (from `layoutContinuous`), as
 * an HTML page titled `title`.
 */
export function reportToHtml(report: PaginatedReport, structure: ReportStructure, title: string, pictures: readonly ExportPicture[] = []): string {
  const px = (units: number) => Math.round((units / unitsPerInch(report.unit)) * 96);
  const placed: Placed[] = [
    ...pictures.map((p) => ({ left: p.left, top: p.top, right: p.right, bottom: p.bottom, picture: p })),
    ...reportItems(report).filter((i) => i.text || i.fill).map((i) => ({ left: i.left, top: i.top, right: i.right, bottom: i.bottom, item: i })),
  ];
  // The content's top-left corner, as XLSX takes it: the margins, or the
  // page's top when a top margin band prints.
  const marginTop = structure.bands.some((b) => b.kind === 'TopMargin' && b.controls.length);
  const originX = px(structure.margins.left);
  const originY = marginTop ? 0 : px(structure.margins.top);
  const xs = [...new Set([originX, ...placed.flatMap((p) => [px(p.left), px(p.right)])])].filter((x) => x >= originX).sort((a, b) => a - b);
  const ys = [...new Set([originY, ...placed.flatMap((p) => [px(p.top), px(p.bottom)])])].filter((y) => y >= originY).sort((a, b) => a - b);
  const width = xs[xs.length - 1] - xs[0];
  const height = ys[ys.length - 1] - ys[0];

  // Which grid cell each item starts in, and the cells it covers.
  const starts = new Map<string, { colspan: number; rowspan: number; p: Placed }>();
  const covered = new Set<string>();
  for (const p of placed) {
    const c0 = xs.indexOf(px(p.left));
    const c1 = xs.indexOf(px(p.right));
    const r0 = ys.indexOf(px(p.top));
    const r1 = ys.indexOf(px(p.bottom));
    if (c0 < 0 || r0 < 0 || c1 <= c0 || r1 <= r0 || starts.has(`${r0},${c0}`) || covered.has(`${r0},${c0}`)) continue;
    starts.set(`${r0},${c0}`, { colspan: c1 - c0, rowspan: r1 - r0, p });
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) if (r !== r0 || c !== c0) covered.add(`${r},${c}`);
  }

  const cellStyle = (item: ExportItem, w: number, h: number) => {
    const f = item.font;
    return [
      `width:${w}px`, `height:${h}px`,
      `font-family:'${f.name.replace(/'/g, '')}'`, `font-size:${Math.round((f.size * 4) / 3)}px`,
      `font-weight:${f.bold ? 'bold' : 'normal'}`, `font-style:${f.italic ? 'italic' : 'normal'}`,
      ...(f.underline ? ['text-decoration:underline'] : []),
      `color:#${rgbHex(f.color)}`,
      `background-color:${item.fill ? `#${rgbHex(argb(item.fill, 'FFFFFFFF'))}` : 'transparent'}`,
      `text-align:${item.h}`, `vertical-align:${item.v === 'center' ? 'middle' : item.v}`,
    ].join(';');
  };
  const content = (item: ExportItem) => {
    const lines = item.text.split('\n');
    const inner = lines.length === 1 ? `<nobr>${esc(item.text).replace(/ /g, '&nbsp;')}</nobr>` : lines.map(esc).join('<br/>');
    return item.url ? `<a href="${esc(item.url)}">${inner}</a>` : inner;
  };

  const rows: string[] = [];
  rows.push(`<tr><td style="width:0px;height:0px;"></td>${xs.slice(1).map((x, i) => `<td style="height:0px;width:${x - xs[i]}px;"></td>`).join('')}</tr>`);
  for (let r = 0; r < ys.length - 1; r++) {
    const cells = [`<td style="width:0px;height:${ys[r + 1] - ys[r]}px;"></td>`];
    for (let c = 0; c < xs.length - 1; c++) {
      if (covered.has(`${r},${c}`)) continue;
      const start = starts.get(`${r},${c}`);
      if (!start) {
        cells.push('<td></td>');
        continue;
      }
      const w = xs[c + start.colspan] - xs[c];
      const h = ys[r + start.rowspan] - ys[r];
      const span = `${start.colspan > 1 ? ` colspan="${start.colspan}"` : ''}${start.rowspan > 1 ? ` rowspan="${start.rowspan}"` : ''}`;
      if (start.p.picture) {
        cells.push(`<td${span} style="width:${w}px;height:${h}px;"><img alt="" src="data:image/png;base64,${base64(start.p.picture.png)}" style="width:${w}px;height:${h}px;display:block;"/></td>`);
      } else {
        cells.push(`<td${span} style="${cellStyle(start.p.item!, w, h)}">${content(start.p.item!)}</td>`);
      }
    }
    rows.push(`<tr style="vertical-align:top;">${cells.join('')}</tr>`);
  }
  return (
    '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8"/>\n' +
    `<title>${esc(title)}</title>\n</head>\n<body style="margin:10px;background-color:#FFFFFF">\n` +
    `<table cellpadding="0" cellspacing="0" border="0" style="border-width:0px;border-collapse:collapse;empty-cells:show;width:${width}px;height:${height}px;table-layout:fixed;">\n` +
    `${rows.join('\n')}\n</table>\n</body>\n</html>\n`
  );
}
