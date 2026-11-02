/**
 * A TrueType font read for embedding in a PDF, and cut down to the glyphs a
 * document uses (parity row 72, PDF/A, 2026-11-02).
 *
 * PDF/A forbids a font that is not embedded, so Forma's own PDF carries the
 * Liberation fonts it draws Arial, Times New Roman and Courier New text in.
 * Embedding a whole face would put 140 to 400 kB into every file; the subset
 * keeps only what the pages use. It keeps every glyph's number and empties the
 * glyphs not used, which is how DevExpress 20.1 subsets its own PDF/A fonts
 * (s60b: an Arial of 4,503 glyphs, ten with outlines, `loca` in its long form,
 * and the tables `cvt `, `fpgm`, `glyf`, `head`, `hhea`, `hmtx`, `loca`,
 * `maxp` and `prep`, the set the PDF specification asks a TrueType program to
 * keep). Keeping the numbers is what lets a PDF name glyphs by their own ids,
 * with `/CIDToGIDMap /Identity`, and costs only the two per-glyph tables.
 *
 * Written from the OpenType specification's table layouts. Pure, so it runs
 * under Node for the tests.
 */

/** A table's place in the font file. */
interface TableRecord {
  offset: number;
  length: number;
}

export interface TrueTypeFont {
  bytes: Uint8Array;
  tables: Map<string, TableRecord>;
  unitsPerEm: number;
  numGlyphs: number;
  /** The PostScript name, as a PDF names the font: "LiberationSans-Bold". */
  postscriptName: string;
  /** xMin, yMin, xMax, yMax in font units. */
  bbox: [number, number, number, number];
  ascent: number;
  descent: number;
  capHeight: number;
  italicAngle: number;
  fixedPitch: boolean;
  bold: boolean;
  /** Every glyph's advance width, in font units. */
  advances: Uint16Array;
  /** The glyph a Unicode code point is drawn with, 0 when the font has none. */
  glyphOf(codePoint: number): number;
}

const tag = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** Read a TrueType (glyf-outline) font. Throws on a CFF-flavoured or malformed file. */
export function parseTrueType(bytes: Uint8Array): TrueTypeFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0);
  if (version !== 0x00010000 && version !== 0x74727565 /* 'true' */) {
    throw new Error('Not a TrueType font: only fonts with glyf outlines can be embedded here.');
  }
  const tables = new Map<string, TableRecord>();
  const count = view.getUint16(4);
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    tables.set(tag(bytes, at), { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) });
  }
  const table = (name: string) => {
    const t = tables.get(name);
    if (!t) throw new Error(`The font has no ${name.trim()} table.`);
    return t.offset;
  };
  for (const required of ['head', 'hhea', 'hmtx', 'maxp', 'loca', 'glyf', 'cmap']) table(required);

  const head = table('head');
  const hhea = table('hhea');
  const unitsPerEm = view.getUint16(head + 18);
  const bbox: [number, number, number, number] = [view.getInt16(head + 36), view.getInt16(head + 38), view.getInt16(head + 40), view.getInt16(head + 42)];
  const numGlyphs = view.getUint16(table('maxp') + 4);

  const metrics = view.getUint16(hhea + 34);
  const hmtx = table('hmtx');
  const advances = new Uint16Array(numGlyphs);
  for (let g = 0; g < numGlyphs; g++) advances[g] = view.getUint16(hmtx + Math.min(g, metrics - 1) * 4);

  // The horizontal header's ascent and descent, as DevExpress's descriptors
  // give them (Arial 905 and -212 a thousand, s60b).
  const ascent = view.getInt16(hhea + 4);
  const descent = view.getInt16(hhea + 6);
  let capHeight = Math.round(ascent * 0.7);
  let bold = (view.getUint16(head + 44) & 1) === 1;
  const os2 = tables.get('OS/2');
  if (os2) {
    if (view.getUint16(os2.offset) >= 2 && os2.length >= 90) capHeight = view.getInt16(os2.offset + 88);
    bold = bold || view.getUint16(os2.offset + 4) >= 600;
  }
  const post = tables.get('post');
  const italicAngle = post ? view.getInt32(post.offset + 4) / 65536 : 0;
  const fixedPitch = post ? view.getUint32(post.offset + 12) !== 0 : false;

  return {
    bytes,
    tables,
    unitsPerEm,
    numGlyphs,
    postscriptName: postscriptNameOf(bytes, view, tables.get('name')) || 'Font',
    bbox,
    ascent,
    descent,
    capHeight,
    italicAngle,
    fixedPitch,
    bold,
    advances,
    glyphOf: cmapLookup(view, table('cmap'), numGlyphs),
  };
}

/** The `name` table's PostScript name (name id 6), Windows Unicode first, then Macintosh Roman. */
function postscriptNameOf(bytes: Uint8Array, view: DataView, name: TableRecord | undefined): string {
  if (!name) return '';
  const count = view.getUint16(name.offset + 2);
  const strings = name.offset + view.getUint16(name.offset + 4);
  let mac = '';
  for (let i = 0; i < count; i++) {
    const at = name.offset + 6 + i * 12;
    if (view.getUint16(at + 6) !== 6) continue;
    const platform = view.getUint16(at);
    const length = view.getUint16(at + 8);
    const start = strings + view.getUint16(at + 10);
    if (platform === 3) {
      let s = '';
      for (let k = 0; k + 1 < length; k += 2) s += String.fromCharCode(view.getUint16(start + k));
      return s.replace(/[^\x21-\x7e]/g, '');
    }
    if (platform === 1 && !mac) mac = String.fromCharCode(...bytes.subarray(start, start + length));
  }
  return mac.replace(/[^\x21-\x7e]/g, '');
}

/** The code point to glyph map: a Windows full-Unicode (format 12) table if there is one, else the BMP one (format 4). */
function cmapLookup(view: DataView, cmap: number, numGlyphs: number): (codePoint: number) => number {
  let format4 = -1;
  let format12 = -1;
  const count = view.getUint16(cmap + 2);
  for (let i = 0; i < count; i++) {
    const platform = view.getUint16(cmap + 4 + i * 8);
    const encoding = view.getUint16(cmap + 6 + i * 8);
    const at = cmap + view.getUint32(cmap + 8 + i * 8);
    const format = view.getUint16(at);
    if (format === 12 && (platform === 3 && encoding === 10 || platform === 0)) format12 = at;
    if (format === 4 && (platform === 3 && encoding === 1 || platform === 0 && format4 < 0)) format4 = at;
  }
  const valid = (g: number) => (g > 0 && g < numGlyphs ? g : 0);
  if (format12 >= 0) {
    const groups = view.getUint32(format12 + 12);
    return (c) => {
      let lo = 0;
      let hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const at = format12 + 16 + mid * 12;
        const start = view.getUint32(at);
        const end = view.getUint32(at + 4);
        if (c < start) hi = mid - 1;
        else if (c > end) lo = mid + 1;
        else return valid(view.getUint32(at + 8) + (c - start));
      }
      return 0;
    };
  }
  if (format4 < 0) return () => 0;
  const segments = view.getUint16(format4 + 6) / 2;
  const ends = format4 + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const rangeOffsets = deltas + segments * 2;
  return (c) => {
    if (c > 0xffff) return 0;
    for (let s = 0; s < segments; s++) {
      if (c > view.getUint16(ends + s * 2)) continue;
      const start = view.getUint16(starts + s * 2);
      if (c < start) return 0;
      const delta = view.getUint16(deltas + s * 2);
      const rangeOffset = view.getUint16(rangeOffsets + s * 2);
      if (!rangeOffset) return valid((c + delta) & 0xffff);
      const g = view.getUint16(rangeOffsets + s * 2 + rangeOffset + (c - start) * 2);
      return g ? valid((g + delta) & 0xffff) : 0;
    }
    return 0;
  };
}

/** Where glyph `g`'s outline sits in `glyf`, from `loca`, in either of its two forms. */
function glyphRange(font: TrueTypeFont, view: DataView, g: number): [number, number] {
  const loca = font.tables.get('loca')!.offset;
  const long = view.getInt16(font.tables.get('head')!.offset + 50) === 1;
  const at = (i: number) => (long ? view.getUint32(loca + i * 4) : view.getUint16(loca + i * 2) * 2);
  return [at(g), at(g + 1)];
}

/** The glyphs a composite glyph is built from (its components), or none for a simple one. */
function componentsOf(font: TrueTypeFont, view: DataView, g: number): number[] {
  const [start, end] = glyphRange(font, view, g);
  if (end <= start) return [];
  const glyf = font.tables.get('glyf')!.offset;
  let at = glyf + start;
  if (view.getInt16(at) >= 0) return [];
  at += 10;
  const out: number[] = [];
  for (;;) {
    const flags = view.getUint16(at);
    out.push(view.getUint16(at + 2));
    at += 4 + (flags & 0x0001 ? 4 : 2);
    if (flags & 0x0008) at += 2;
    else if (flags & 0x0040) at += 4;
    else if (flags & 0x0080) at += 8;
    if (!(flags & 0x0020)) return out;
  }
}

/** The tables a subset keeps: what the PDF specification asks of an embedded TrueType program, and what DevExpress keeps. */
const SUBSET_TABLES = ['cvt ', 'fpgm', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'prep'];

/** The OpenType checksum of a table: its bytes as big-endian 32-bit words, zero-padded, summed. */
export function tableChecksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const word = ((data[i] << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0)) >>> 0;
    sum = (sum + word) >>> 0;
  }
  return sum;
}

/**
 * The font with only `glyphs` drawn, plus glyph 0 and every component a kept
 * composite glyph is built from. Every glyph keeps its number and its advance;
 * the others are emptied.
 */
export function subsetTrueType(font: TrueTypeFont, glyphs: Iterable<number>): Uint8Array {
  const src = font.bytes;
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const keep = new Set<number>([0]);
  const queue = [...glyphs].filter((g) => g >= 0 && g < font.numGlyphs);
  while (queue.length) {
    const g = queue.pop()!;
    if (keep.has(g) && g !== 0) continue;
    keep.add(g);
    for (const c of componentsOf(font, view, g)) if (!keep.has(c) && c < font.numGlyphs) queue.push(c);
  }

  const glyf = font.tables.get('glyf')!.offset;
  const pieces: Uint8Array[] = [];
  const loca = new Uint8Array((font.numGlyphs + 1) * 4);
  const locaView = new DataView(loca.buffer);
  let offset = 0;
  for (let g = 0; g < font.numGlyphs; g++) {
    locaView.setUint32(g * 4, offset);
    if (!keep.has(g)) continue;
    const [start, end] = glyphRange(font, view, g);
    if (end <= start) continue;
    const length = end - start;
    const padded = (length + 3) & ~3;
    const piece = new Uint8Array(padded);
    piece.set(src.subarray(glyf + start, glyf + end));
    pieces.push(piece);
    offset += padded;
  }
  locaView.setUint32(font.numGlyphs * 4, offset);
  const glyfData = new Uint8Array(offset);
  let at = 0;
  for (const p of pieces) {
    glyfData.set(p, at);
    at += p.length;
  }

  const tableData = new Map<string, Uint8Array>();
  for (const name of SUBSET_TABLES) {
    const t = font.tables.get(name);
    if (name === 'glyf') tableData.set(name, glyfData);
    else if (name === 'loca') tableData.set(name, loca);
    else if (t) tableData.set(name, src.slice(t.offset, t.offset + t.length));
  }
  const head = tableData.get('head')!;
  const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);
  headView.setUint32(8, 0); // checkSumAdjustment, set below
  headView.setInt16(50, 1); // indexToLocFormat: long offsets

  const names = [...tableData.keys()].sort();
  const n = names.length;
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = 2 ** entrySelector * 16;
  let size = 12 + n * 16;
  const placed = names.map((name) => {
    const data = tableData.get(name)!;
    const p = { name, data, offset: size };
    size += (data.length + 3) & ~3;
    return p;
  });
  const out = new Uint8Array(size);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, 0x00010000);
  ov.setUint16(4, n);
  ov.setUint16(6, searchRange);
  ov.setUint16(8, entrySelector);
  ov.setUint16(10, n * 16 - searchRange);
  placed.forEach((p, i) => {
    const rec = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[rec + k] = p.name.charCodeAt(k);
    ov.setUint32(rec + 4, tableChecksum(p.data));
    ov.setUint32(rec + 8, p.offset);
    ov.setUint32(rec + 12, p.data.length);
    out.set(p.data, p.offset);
  });
  const headAt = placed.find((p) => p.name === 'head')!.offset;
  ov.setUint32(headAt + 8, (0xb1b0afba - tableChecksum(out)) >>> 0);
  return out;
}
