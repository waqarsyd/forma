/**
 * PDF/A for Forma's own PDF (parity row 72), against what DevExpress 20.1
 * wrote in s60a to s60d and s62a to s62d. The files the writer makes here were
 * also passed through veraPDF 1.30.3 as PDF/A-1b, 2b and 3b on 2026-11-02;
 * these tests pin the structure that verdict rests on.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { flattenOnWhite, PDFA_WITH_PASSWORD, pdfaPartOf, pdfDate, srgbIccProfile, xmpDate, xmpPacket } from './pdfA';
import { cidSet, glyphRun, LIBERATION_FACE, subsetTag, toUnicodeCMap, widthsArray } from './pdfFonts';
import { parseTrueType } from './trueType';
import { writePdf, type PdfOp, type StandardFont } from './pdfWriter';

const face = (file: string) => parseTrueType(new Uint8Array(readFileSync(`assets/pdf-fonts/${file}`)));
const FONTS = Object.fromEntries((Object.keys(LIBERATION_FACE) as StandardFont[]).map((f) => [f, face(LIBERATION_FACE[f])])) as Record<StandardFont, ReturnType<typeof face>>;

describe('pdfaPartOf', () => {
  it("reads the root's PdfACompatibility, as DevExpress saves it (s60b, s62a)", () => {
    expect(pdfaPartOf('<ExportOptions Ref="8"><Pdf Ref="9" PdfACompatibility="PdfA2b" /></ExportOptions>')).toBe(2);
    expect(pdfaPartOf('<ExportOptions Ref="5"><Pdf Ref="6" PdfACompatibility="PdfA1b"><PasswordSecurityOptions Ref="7" OpenPassword="x" /></Pdf></ExportOptions>')).toBe(1);
    expect(pdfaPartOf('<ExportOptions><Pdf PdfACompatibility="PdfA3b" /></ExportOptions>')).toBe(3);
    expect(pdfaPartOf('<ExportOptions><Pdf PdfACompatibility="None" /></ExportOptions>')).toBeNull();
    expect(pdfaPartOf('<ExportOptions><Xls ShowGridLines="true" /></ExportOptions>')).toBeNull();
    expect(pdfaPartOf('<Bands />')).toBeNull();
    expect(pdfaPartOf(null)).toBeNull();
  });
});

describe('the metadata PDF/A requires to agree', () => {
  const when = new Date(Date.UTC(2026, 10, 2, 9, 5, 7));

  it('writes one instant in both forms', () => {
    expect(pdfDate(when)).toBe("D:20261102090507+00'00'");
    expect(xmpDate(when)).toBe('2026-11-02T09:05:07+00:00');
  });

  it('identifies the part with conformance B, and carries the title, producer and dates', () => {
    const xmp = xmpPacket({ part: 2, title: 'Sales & <Returns>', producer: 'Forma', date: when });
    expect(xmp).toContain('<pdfaid:part>2</pdfaid:part>');
    expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(xmp).toContain('<rdf:li xml:lang="x-default">Sales &amp; &lt;Returns&gt;</rdf:li>');
    expect(xmp).toContain('<pdf:Producer>Forma</pdf:Producer>');
    expect(xmp).toContain('<xmp:CreateDate>2026-11-02T09:05:07+00:00</xmp:CreateDate>');
    expect(xmp.startsWith('<?xpacket begin="﻿"')).toBe(true);
    expect(xmp.endsWith('<?xpacket end="w"?>')).toBe(true);
  });
});

describe('srgbIccProfile', () => {
  it('is a well-formed ICC 2.1 RGB display profile', () => {
    const icc = srgbIccProfile();
    const v = new DataView(icc.buffer);
    const text = (at: number) => String.fromCharCode(...icc.subarray(at, at + 4));
    expect(v.getUint32(0)).toBe(icc.length);
    expect(v.getUint32(8)).toBe(0x02100000);
    expect([text(12), text(16), text(20), text(36)]).toEqual(['mntr', 'RGB ', 'XYZ ', 'acsp']);
    const count = v.getUint32(128);
    const tags = Array.from({ length: count }, (_, i) => ({ sig: text(132 + i * 12), offset: v.getUint32(136 + i * 12), size: v.getUint32(140 + i * 12) }));
    expect(tags.map((t) => t.sig).sort()).toEqual(['bTRC', 'bXYZ', 'cprt', 'desc', 'gTRC', 'gXYZ', 'rTRC', 'rXYZ', 'wtpt']);
    for (const t of tags) {
      expect(t.offset % 4).toBe(0);
      expect(t.offset + t.size).toBeLessThanOrEqual(icc.length);
    }
    // The sRGB transfer curve, 1,024 samples from 0 to full, 0.5 in giving about 0.214 out.
    const trc = tags.find((t) => t.sig === 'rTRC')!;
    expect(text(trc.offset)).toBe('curv');
    expect(v.getUint32(trc.offset + 8)).toBe(1024);
    expect(v.getUint16(trc.offset + 12)).toBe(0);
    expect(v.getUint16(trc.offset + 12 + 1023 * 2)).toBe(65535);
    expect(v.getUint16(trc.offset + 12 + 511 * 2) / 65535).toBeCloseTo(0.214, 2);
    const desc = tags.find((t) => t.sig === 'desc')!;
    expect(desc.size).toBe(12 + 18 + 4 + 4 + 3 + 67);
  });
});

describe('flattenOnWhite', () => {
  it('composes each pixel over white, as PDF/A-1 needs (s62d)', () => {
    expect([...flattenOnWhite(new Uint8Array([220, 30, 30, 0, 0, 0]), new Uint8Array([128, 255]))]).toEqual([237, 142, 142, 0, 0, 0]);
  });
});

describe('the embedded fonts', () => {
  it('draws a missing character as "?", never .notdef, and white space as a space', () => {
    const f = FONTS.Helvetica;
    const run = glyphRun(f, 'A東\tz');
    const ids = run.glyphs.map(([g]) => g);
    expect(ids).not.toContain(0);
    expect(run.glyphs[1]).toEqual([f.glyphOf(0x3f), 0x3f]);
    expect(run.glyphs[2]).toEqual([f.glyphOf(0x20), 0x20]);
    expect(run.hex).toBe(`<${ids.map((g) => g.toString(16).padStart(4, '0')).join('')}>`);
  });

  it('gives widths from the font, as DevExpress writes them (s60b: a space 277.832)', () => {
    const f = FONTS.Helvetica;
    expect(widthsArray(f, [f.glyphOf(0x20), f.glyphOf(0x20)])).toBe(`[${f.glyphOf(0x20)} [277.832]]`);
  });

  it('maps glyphs back to text, in blocks of a hundred, beyond the BMP too', () => {
    const map = new Map<number, number>(Array.from({ length: 150 }, (_, i) => [i + 3, 0x41 + i] as [number, number]));
    map.set(500, 0x1f600);
    const cmap = toUnicodeCMap(map);
    expect(cmap.match(/beginbfchar/g)).toHaveLength(2);
    expect(cmap).toContain('100 beginbfchar');
    expect(cmap).toContain('51 beginbfchar');
    expect(cmap).toContain('<0003> <0041>');
    expect(cmap).toContain('<01f4> <d83dde00>');
  });

  it('lists every glyph slot in the CIDSet, as DevExpress does (s60b)', () => {
    expect([...cidSet(8)]).toEqual([0xff]);
    expect([...cidSet(10)]).toEqual([0xff, 0xc0]);
    expect(cidSet(2620).length).toBe(328);
  });

  it('names a subset with six capitals, the same for the same glyphs', () => {
    const tag = subsetTag('LiberationSans', [5, 3, 3]);
    expect(tag).toMatch(/^[A-Z]{6}$/);
    expect(subsetTag('LiberationSans', [3, 5])).toBe(tag);
    expect(subsetTag('LiberationSans', [3, 6])).not.toBe(tag);
  });
});

describe('writePdf, PDF/A', () => {
  // pdfjs's cold import can outlast a test's own five seconds; paid here instead (see testing.md).
  beforeAll(async () => {
    await import('pdfjs-dist/legacy/build/pdf.mjs');
  }, 60_000);

  const ops: PdfOp[] = [
    { kind: 'text', x: 36, y: 50, size: 12, font: 'Helvetica-Bold', colour: [0, 0, 0], text: 'Archive Łódź Ω', scale: 1 },
    { kind: 'text', x: 36, y: 80, size: 10, font: 'Times-Roman', colour: [0, 0, 0], text: 'Times', scale: 1 },
    { kind: 'image', x: 36, y: 100, w: 20, h: 10, image: 0 },
    { kind: 'link', x: 36, y: 36, w: 100, h: 20, uri: 'https://example.com/' },
  ];
  const write = (part: 1 | 2 | 3) =>
    writePdf({
      title: 'Archive',
      pages: [{ width: 612, height: 792, ops }],
      images: [{ width: 2, height: 1, rgb: new Uint8Array([255, 0, 0, 0, 0, 255]), alpha: new Uint8Array([255, 128]) }],
      pdfa: { part, fonts: FONTS, date: new Date(Date.UTC(2026, 10, 2, 9, 30, 0)) },
    });
  const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

  it('writes the file DevExpress writes for PDF/A: 1.4, sRGB intent, XMP, embedded CID fonts, an identifier (s60)', async () => {
    const pdf = latin1(await write(2));
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf).toMatch(/\/OutputIntents \[<< \/Type \/OutputIntent \/S \/GTS_PDFA1 \/OutputConditionIdentifier \(sRGB IEC61966-2\.1\)/);
    expect(pdf).toContain('<pdfaid:part>2</pdfaid:part>');
    expect(pdf).toMatch(/\/Type \/Metadata \/Subtype \/XML \/Length \d+ >>/); // never filtered
    expect(pdf.match(/\/Subtype \/Type0 \/BaseFont \/[A-Z]{6}\+Liberation(Sans-Bold|Serif) \/Encoding \/Identity-H/g)).toHaveLength(2);
    expect(pdf).toMatch(/\/Subtype \/CIDFontType2 .*\/DW 1000 \/W \[(\d+ \[[\d.]+\] ?)+\] \/CIDToGIDMap \/Identity >>/);
    expect(pdf).toMatch(/\/CIDSet \d+ 0 R \/FontFile2 \d+ 0 R/);
    expect(pdf).toMatch(/\/Length1 \d+/);
    expect(pdf).not.toMatch(/\/Subtype \/Type1/);
    expect(pdf).not.toContain('/Encrypt');
    expect(pdf).toMatch(/trailer\n<< [^>]*\/ID \[<[0-9a-f]{32}> <[0-9a-f]{32}>\]/);
    expect(pdf).toContain("/CreationDate (D:20261102093000+00'00') /ModDate (D:20261102093000+00'00')");
    expect(pdf).toContain('<xmp:CreateDate>2026-11-02T09:30:00+00:00</xmp:CreateDate>');
    expect(pdf).toMatch(/\/Subtype \/Link [^>]*\/F 4/);
  });

  it('flattens a transparent picture for PDF/A-1 and keeps its mask for 2 and 3 (s62d)', async () => {
    expect(latin1(await write(1))).not.toContain('/SMask');
    expect(latin1(await write(2))).toContain('/SMask');
    expect(latin1(await write(3))).toContain('<pdfaid:part>3</pdfaid:part>');
  });

  it('reads back as text, Polish and Greek included, through its Unicode map', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: await write(2), disableFontFace: true, useSystemFonts: false }).promise;
    const text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('');
    expect(text).toContain('Archive Łódź Ω');
    expect(text).toContain('Times');
    await doc.destroy();
  });

  it('refuses PDF/A with a password, as DevExpress refuses it (s62a, s62b)', async () => {
    await expect(
      writePdf({ title: 'x', pages: [{ width: 612, height: 792, ops }], pdfa: { part: 2, fonts: FONTS }, security: { openPassword: 'a', permissionsPassword: '', level: 'AES128' } }),
    ).rejects.toThrow(PDFA_WITH_PASSWORD);
  });

  it('leaves a report that does not ask for PDF/A as it was: standard fonts, no metadata', async () => {
    const pdf = latin1(await writePdf({ title: 'x', pages: [{ width: 612, height: 792, ops: ops.slice(0, 2) }] }));
    expect(pdf).toContain('/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding');
    expect(pdf).not.toContain('/Metadata');
    expect(pdf).not.toContain('/ID [');
  });
});
