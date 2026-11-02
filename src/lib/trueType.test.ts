/**
 * The TrueType reader and subsetter PDF/A embedding rests on (row 72), over
 * the committed Liberation faces. The subset is checked as DevExpress's own
 * was read in s60b: every glyph slot kept, only the glyphs used holding an
 * outline, `loca` long, the nine tables a PDF needs, valid checksums.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTrueType, subsetTrueType, tableChecksum } from './trueType';

const face = (file: string) => parseTrueType(new Uint8Array(readFileSync(`assets/pdf-fonts/${file}`)));

/** A font file's table directory, and each glyph's outline length from its long-form `loca`. */
function readBack(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map<string, { checksum: number; offset: number; length: number }>();
  for (let i = 0; i < v.getUint16(4); i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(...bytes.subarray(at, at + 4));
    tables.set(tag, { checksum: v.getUint32(at + 4), offset: v.getUint32(at + 8), length: v.getUint32(at + 12) });
  }
  const head = tables.get('head')!.offset;
  const numGlyphs = v.getUint16(tables.get('maxp')!.offset + 4);
  const loca = tables.get('loca')!.offset;
  const lengths = Array.from({ length: numGlyphs }, (_, g) => v.getUint32(loca + (g + 1) * 4) - v.getUint32(loca + g * 4));
  return { tables, longLoca: v.getInt16(head + 50) === 1, numGlyphs, lengths };
}

describe('parseTrueType', () => {
  it('reads what a PDF font descriptor needs from Liberation Sans', () => {
    const f = face('LiberationSans-Regular.ttf');
    expect(f.postscriptName).toBe('LiberationSans');
    expect(f.unitsPerEm).toBe(2048);
    expect(f.numGlyphs).toBe(2620);
    expect(f.fixedPitch).toBe(false);
    expect(f.bold).toBe(false);
    expect(f.italicAngle).toBe(0);
    // Arial's metrics, which Liberation Sans is made to: 905 and -212 a thousand, as DevExpress's Arial descriptor says (s60b).
    expect(Math.round((f.ascent * 1000) / 2048)).toBe(905);
    expect(Math.round((f.descent * 1000) / 2048)).toBe(-212);
    // A space is 569 units, 277.832 a thousand, the width DevExpress's Arial gives it.
    expect(f.advances[f.glyphOf(0x20)]).toBe(569);
    expect(f.glyphOf(0x41)).toBeGreaterThan(0);
    expect(f.glyphOf(0x03a9)).toBeGreaterThan(0); // Greek capital omega
    expect(f.glyphOf(0x0416)).toBeGreaterThan(0); // Cyrillic capital zhe
    expect(f.glyphOf(0x6771)).toBe(0); // a CJK ideograph it does not hold
  });

  it('tells a monospace, bold or italic face by its own tables', () => {
    const mono = face('LiberationMono-Regular.ttf');
    expect(mono.fixedPitch).toBe(true);
    expect(new Set([0x41, 0x69, 0x20].map((c) => mono.advances[mono.glyphOf(c)])).size).toBe(1);
    expect(face('LiberationSerif-Bold.ttf').bold).toBe(true);
    expect(face('LiberationSerif-Italic.ttf').italicAngle).toBeLessThan(0);
  });

  it('refuses a font that is not TrueType-outlined', () => {
    expect(() => parseTrueType(new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0, 0, 0, 0]))).toThrow(/Not a TrueType font/);
  });
});

describe('subsetTrueType', () => {
  it('keeps every glyph slot and outlines only the glyphs used, as DevExpress subsets (s60b)', () => {
    const f = face('LiberationSerif-Regular.ttf');
    const used = [...'Archive'].map((c) => f.glyphOf(c.codePointAt(0)!));
    const subset = subsetTrueType(f, used);
    const back = readBack(subset);
    expect([...back.tables.keys()]).toEqual(['cvt ', 'fpgm', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'prep']);
    expect(back.longLoca).toBe(true);
    expect(back.numGlyphs).toBe(f.numGlyphs);
    const outlined = back.lengths.flatMap((n, g) => (n > 0 ? [g] : []));
    // Liberation's .notdef is itself empty, so only the glyphs asked for carry outlines.
    expect(outlined.filter((g) => g !== 0)).toEqual([...new Set(used)].sort((a, b) => a - b));
    expect(subset.length).toBeLessThan(f.bytes.length / 5);
    // The advances are the font's own, every one.
    const hmtx = back.tables.get('hmtx')!;
    expect(hmtx.length).toBe(f.tables.get('hmtx')!.length);
  });

  it('keeps the glyphs a composite glyph is built from', () => {
    const f = face('LiberationSans-Regular.ttf');
    const aacute = f.glyphOf(0x00c1);
    const back = readBack(subsetTrueType(f, [aacute]));
    const outlined = back.lengths.flatMap((n, g) => (n > 0 ? [g] : []));
    expect(outlined).toContain(aacute);
    // Its parts, the A and the accent, came with it: more than .notdef and itself.
    expect(outlined.length).toBeGreaterThan(2);
  });

  it('writes checksums a font reader accepts', () => {
    const f = face('LiberationMono-Bold.ttf');
    const subset = subsetTrueType(f, [f.glyphOf(0x46), f.glyphOf(0x6f)]);
    const back = readBack(subset);
    for (const [tag, t] of back.tables) {
      const data = subset.slice(t.offset, t.offset + t.length);
      if (tag === 'head') new DataView(data.buffer).setUint32(8, 0);
      expect(tableChecksum(data), tag).toBe(t.checksum);
    }
    // The whole file sums to the OpenType magic once head's adjustment is in.
    expect(tableChecksum(subset)).toBe(0xb1b0afba);
  });
});
