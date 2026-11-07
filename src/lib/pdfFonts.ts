/**
 * The fonts Forma embeds in a PDF/A file (parity row 72, 2026-11-02), and
 * the PDF objects that describe them.
 *
 * Forma's own PDF draws Arial and the sans families in Helvetica, Times New
 * Roman in Times and Courier New in Courier: the PDF standard fonts, which a
 * reader supplies itself. PDF/A forbids a font that is not in the file, so
 * for PDF/A each standard font is replaced by the Liberation face made to the
 * same metrics as the Windows font it stands for, and embedded as DevExpress
 * embeds its own (s60b): a Type 0 font over a CIDFontType2 with Identity-H,
 * glyph ids as character codes, a Unicode map, widths for the glyphs used, a
 * CIDSet listing every glyph slot the subset keeps, and the subset itself.
 *
 * The faces are the Liberation Fonts 2.1.5 release, SIL Open Font License
 * 1.1, committed unmodified under assets/pdf-fonts (its README has their
 * provenance, and why pdf.js's older Liberation Sans is not used). They are
 * served at /pdf-fonts/ (see pdfFontAssets in vite.config.ts) and fetched
 * only when a PDF/A file is written.
 */
import type { StandardFont } from './pdfWriter';
import type { TrueTypeFont } from './trueType';
import { md5 } from './pdfCrypto';
import { PDF_FONT_BASE } from './assetPaths';

/** Where the browser fetches the faces from: a folder the build names for its contents (lib/assetPaths.ts). */
export const PDF_FONT_PATH = PDF_FONT_BASE;

/** The Liberation face each standard font is replaced by. */
export const LIBERATION_FACE: Record<StandardFont, string> = {
  Helvetica: 'LiberationSans-Regular.ttf',
  'Helvetica-Bold': 'LiberationSans-Bold.ttf',
  'Helvetica-Oblique': 'LiberationSans-Italic.ttf',
  'Helvetica-BoldOblique': 'LiberationSans-BoldItalic.ttf',
  'Times-Roman': 'LiberationSerif-Regular.ttf',
  'Times-Bold': 'LiberationSerif-Bold.ttf',
  'Times-Italic': 'LiberationSerif-Italic.ttf',
  'Times-BoldItalic': 'LiberationSerif-BoldItalic.ttf',
  Courier: 'LiberationMono-Regular.ttf',
  'Courier-Bold': 'LiberationMono-Bold.ttf',
  'Courier-Oblique': 'LiberationMono-Italic.ttf',
  'Courier-BoldOblique': 'LiberationMono-BoldItalic.ttf',
};

/**
 * A line of text as the glyphs `font` draws it: a hex string of two-byte
 * glyph ids for Identity-H, and which character each glyph stands for.
 *
 * A character the font lacks is drawn as "?", never as glyph 0: PDF/A-2
 * forbids showing .notdef, and "?" is what Forma's standard-font PDF prints
 * for a character outside Windows-1252. White space is drawn as a space.
 */
export function glyphRun(font: TrueTypeFont, text: string): { hex: string; glyphs: [number, number][] } {
  const question = font.glyphOf(0x3f);
  const space = font.glyphOf(0x20) || question;
  let hex = '';
  const glyphs: [number, number][] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    let g = /\s/.test(ch) ? space : font.glyphOf(cp);
    let shown = /\s/.test(ch) ? 0x20 : cp;
    if (!g) {
      g = question;
      shown = 0x3f;
    }
    hex += g.toString(16).padStart(4, '0');
    glyphs.push([g, shown]);
  }
  return { hex: `<${hex}>`, glyphs };
}

/** A glyph's advance in the thousandths of an em a PDF's widths are in. */
export const pdfWidth = (font: TrueTypeFont, g: number) => Number(((font.advances[g] * 1000) / font.unitsPerEm).toFixed(3));

/** The CIDFont's /W array for the glyphs used, one entry each, in glyph order. */
export function widthsArray(font: TrueTypeFont, glyphs: Iterable<number>): string {
  const sorted = [...new Set(glyphs)].sort((a, b) => a - b);
  return `[${sorted.map((g) => `${g} [${pdfWidth(font, g)}]`).join(' ')}]`;
}

/** A code point as UTF-16BE hex, for a Unicode map. */
function utf16Hex(cp: number): string {
  const units = cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp];
  return units.map((u) => u.toString(16).padStart(4, '0')).join('');
}

/** The ToUnicode CMap: which character each glyph used stands for, so text can be searched and copied. */
export function toUnicodeCMap(map: Map<number, number>): string {
  const entries = [...map.entries()].sort((a, b) => a[0] - b[0]);
  const blocks: string[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    blocks.push(`${chunk.length} beginbfchar\n${chunk.map(([g, cp]) => `<${g.toString(16).padStart(4, '0')}> <${utf16Hex(cp)}>`).join('\n')}\nendbfchar`);
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

/**
 * The CIDSet: one bit per glyph slot the embedded program holds, all set.
 * The subset keeps every slot (and empties the unused), and DevExpress's
 * CIDSet sets every one too (s60b).
 */
export function cidSet(numGlyphs: number): Uint8Array {
  const out = new Uint8Array(Math.ceil(numGlyphs / 8));
  out.fill(0xff);
  const rest = numGlyphs % 8;
  if (rest) out[out.length - 1] = (0xff << (8 - rest)) & 0xff;
  return out;
}

/** Six capital letters naming a subset, as PDF requires before its font name; derived from what it holds, so it is stable. */
export function subsetTag(name: string, glyphs: Iterable<number>): string {
  const digest = md5(new TextEncoder().encode(`${name}:${[...new Set(glyphs)].sort((a, b) => a - b).join(',')}`));
  return [...digest.subarray(0, 6)].map((b) => String.fromCharCode(65 + (b % 26))).join('');
}

/** The font descriptor's flags: fixed pitch 1, serif 2, nonsymbolic 32, italic 64. */
export function descriptorFlags(font: TrueTypeFont, serif: boolean): number {
  return (font.fixedPitch ? 1 : 0) | (serif ? 2 : 0) | 32 | (font.italicAngle !== 0 ? 64 : 0);
}

/** The descriptor's entries in thousandths of an em, from the font's own tables. */
export function descriptorMetrics(font: TrueTypeFont): string {
  const k = (v: number) => Math.round((v * 1000) / font.unitsPerEm);
  const [x0, y0, x1, y1] = font.bbox;
  return (
    `/FontBBox [${k(x0)} ${k(y0)} ${k(x1)} ${k(y1)}] /ItalicAngle ${Number(font.italicAngle.toFixed(2))}` +
    ` /Ascent ${k(font.ascent)} /Descent ${k(font.descent)} /CapHeight ${k(font.capHeight)} /StemV ${font.bold ? 140 : 80}`
  );
}
