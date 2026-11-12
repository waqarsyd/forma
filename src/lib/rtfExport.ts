/**
 * The report as an RTF document, the way DevExpress 20.1 exports one (parity
 * row 21), read out of its RTF of s23 and s54a:
 *
 * - **Page by page.** One section per page, each with the report's paper size
 *   and margins in twips: Letter with half-inch margins was
 *   `\paperw12240\paperh15840\margl720\margr720\margt720\margb720`.
 * - **Every item is a positioned frame**: x from the left margin, y from the
 *   page's top, and its width and exact height, so each prints where the
 *   page printed it. s54a's title, a 400 by 30 label at the margin, was
 *   `\posx0\posy720\absw5760\absh-432`; a customer at 20 across was `\posx288`.
 * - Its font, size in half points (9.75pt is 19), colour, fill and
 *   alignment, and a chart as a PNG picture in its own frame.
 *
 * A frame holds the lines the page printed, so a text cut at the foot keeps
 * on each page what printed there. DevExpress also wrote an empty frame for
 * the blank rest of a box cut at the foot; this writes none.
 */
import { unitsPerInch } from './reportGeometry';
import { argb, reportItems, rgbHex, type ExportItem, type ExportPicture } from './exportItems';
import type { PaginatedReport, ReportStructure } from './reportPreview';

/** A text in RTF: control characters escaped, a line break as `\line`, anything past ASCII as `\uN?`. */
export function rtfText(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\' || ch === '{' || ch === '}') out += `\\${ch}`;
    else if (ch === '\n') out += '\\line ';
    else if (ch === '\r') continue;
    else if (code < 0x80) out += ch;
    else if (code > 0xffff) {
      // Outside the basic plane: the two UTF-16 halves, each as a signed 16-bit \u.
      for (const unit of [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)]) out += `\\u${unit - 0x10000}?`;
    } else out += `\\u${code > 0x7fff ? code - 0x10000 : code}?`;
  }
  return out;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** The report laid out page by page as `report`, as RTF. */
export function reportToRtf(report: PaginatedReport, structure: ReportStructure, pictures: readonly ExportPicture[] = []): string {
  const twips = (units: number) => Math.round((units / unitsPerInch(report.unit)) * 1440);
  const items = reportItems(report);
  const fonts: string[] = [];
  const font = (name: string) => {
    let i = fonts.indexOf(name);
    if (i < 0) i = fonts.push(name) - 1;
    return i;
  };
  const colours: string[] = [];
  /** 1-based, as `\cf0` and `\cbpat0` mean the default. */
  const colour = (rgb: string) => {
    let i = colours.indexOf(rgb);
    if (i < 0) i = colours.push(rgb) - 1;
    return i + 1;
  };
  const margins = structure.margins;
  const frame = (left: number, top: number, right: number, bottom: number) =>
    `\\pard\\overlay\\posx${twips(left - margins.left)}\\posy${twips(top)}\\absw${twips(right - left)}\\absh-${twips(bottom - top)}\\frmtxlrtb\\pvpg`;
  const textFrame = (item: ExportItem) => {
    const text = item.lines ? item.lines.join('\n') : item.text;
    const f = item.font;
    const align = item.h === 'center' ? '\\qc' : item.h === 'right' ? '\\qr' : '\\ql';
    const fill = item.fill ? `\\cbpat${colour(rgbHex(argb(item.fill, 'FFFFFFFF')))}` : '\\cbpat0';
    const run =
      `\\cf${colour(rgbHex(f.color))}\\f${font(f.name)}\\fs${Math.trunc(f.size * 2)}` +
      (f.bold ? '\\b' : '') + (f.italic ? '\\i' : '') + (f.underline ? '\\ul' : '');
    // The link escaped for the field code (a quote and a backslash take a backslash),
    // then as RTF text (2026-11-12, CodeQL js/incomplete-sanitization): the other way
    // round, RTF read the quote's backslash as a control symbol and the field lost both.
    const body = item.url
      ? `{\\field{\\*\\fldinst HYPERLINK "${rtfText(item.url.replace(/["\\]/g, '\\$&'))}"}{\\fldrslt ${rtfText(text)}}}`
      : rtfText(text);
    return `{${frame(item.left, item.top, item.right, item.bottom)}${align}${fill}${run} ${body}\\par}`;
  };

  const paper = `\\paperw${twips(structure.page.width)}\\paperh${twips(structure.page.height)}` +
    `\\margl${twips(margins.left)}\\margr${twips(margins.right)}\\margt${twips(margins.top)}\\margb${twips(margins.bottom)}` +
    (structure.page.width > structure.page.height ? '\\lndscpsxn' : '');
  const pages = report.pages.map((_, p) => {
    const parts: string[] = [];
    for (const picture of pictures.filter((x) => x.page === p)) {
      const w = twips(picture.right - picture.left);
      const h = twips(picture.bottom - picture.top);
      parts.push(`{${frame(picture.left, picture.top, picture.right, picture.bottom)}\\ql{\\pict\\pngblip\\picwgoal${w}\\pichgoal${h}\n${hex(picture.png)}\n}\\par}`);
    }
    for (const item of items.filter((x) => x.page === p)) parts.push(textFrame(item));
    return `\\sectd${paper}\n${parts.join('\n')}`;
  });
  const fontTable = `{\\fonttbl${(fonts.length ? fonts : ['Times New Roman']).map((n, i) => `{\\f${i} ${rtfText(n)};}`).join('')}}`;
  const colourTable = `{\\colortbl;${colours.map((c) => `\\red${parseInt(c.slice(0, 2), 16)}\\green${parseInt(c.slice(2, 4), 16)}\\blue${parseInt(c.slice(4, 6), 16)};`).join('')}}`;
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0\n${fontTable}\n${colourTable}\n${pages.join('\n\\sect\n')}\n}`;
}
