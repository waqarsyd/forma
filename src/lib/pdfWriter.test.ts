/**
 * Forma's own PDF writer and its outline (parity row 18).
 *
 * The outline is checked against DevExpress's, read from the PDFs it exported
 * for s54a to s54c: a report bookmark, a group header bookmarked by region,
 * detail rows bookmarked by customer under their region, and a literal
 * bookmark in the report footer, over 45 records and two pages. The writer is
 * checked by reading what it writes back with pdfjs, the library the app
 * already reads PDFs with.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { paginate, parseReportStructure } from './reportPreview';
import { fitsWinAnsi, reportOutline, unprintableReason, winAnsiHex, writePdf, type OutlineEntry } from './pdfWriter';
import { parseTrueType } from './trueType';

const S54A = "<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"0\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a\" Name=\"s54a-bookmarks\" Bookmark=\"Sales by region\" Margins=\"50, 50, 50, 50\" PageWidth=\"850\" PageHeight=\"1100\" Version=\"20.1\" DataMember=\"Items\"><Bands><Item1 Ref=\"1\" ControlType=\"TopMarginBand\" HeightF=\"50\" /><Item2 Ref=\"2\" ControlType=\"ReportHeaderBand\" HeightF=\"40\"><Controls><Item1 Ref=\"3\" ControlType=\"XRLabel\" Name=\"title\" Text=\"Sales report\" Bookmark=\"Title\" SizeF=\"400,30\" LocationFloat=\"0,0\" /></Controls></Item2><Item3 Ref=\"4\" ControlType=\"GroupHeaderBand\" HeightF=\"30\"><GroupFields><Item1 Ref=\"5\" FieldName=\"Region\" /></GroupFields><Controls><Item1 Ref=\"6\" ControlType=\"XRLabel\" Name=\"region\" SizeF=\"300,25\" LocationFloat=\"0,0\"><ExpressionBindings><Item1 Ref=\"7\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Region]\" /><Item2 Ref=\"8\" EventName=\"BeforePrint\" PropertyName=\"Bookmark\" Expression=\"[Region]\" /></ExpressionBindings></Item1></Controls></Item3><Item4 Ref=\"9\" ControlType=\"DetailBand\" HeightF=\"25\"><Controls><Item1 Ref=\"10\" ControlType=\"XRLabel\" Name=\"customer\" BookmarkParent=\"#Ref-6\" SizeF=\"300,25\" LocationFloat=\"20,0\"><ExpressionBindings><Item1 Ref=\"11\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Customer]\" /><Item2 Ref=\"12\" EventName=\"BeforePrint\" PropertyName=\"Bookmark\" Expression=\"[Customer]\" /></ExpressionBindings></Item1></Controls></Item4><Item5 Ref=\"13\" ControlType=\"ReportFooterBand\" HeightF=\"30\"><Controls><Item1 Ref=\"14\" ControlType=\"XRLabel\" Name=\"totals\" Text=\"Totals\" Bookmark=\"Totals\" SizeF=\"300,25\" LocationFloat=\"0,0\" /></Controls></Item5><Item6 Ref=\"15\" ControlType=\"BottomMarginBand\" HeightF=\"50\" /></Bands></XtraReportsLayoutSerializer>";
// DevExpress's outline of s54a, read from its PDF: depth by leading space, title@page,top in hundredths of an inch.
const DX_OUTLINE = ["Sales by region@1,0"," Title@1,50"," North@1,90","  Customer 01@1,120","  Customer 04@1,145","  Customer 07@1,170","  Customer 10@1,195","  Customer 13@1,220","  Customer 16@1,245","  Customer 19@1,270","  Customer 22@1,295","  Customer 25@1,320","  Customer 28@1,345","  Customer 31@1,370","  Customer 34@1,395","  Customer 37@1,420","  Customer 40@1,445","  Customer 43@1,470"," South@1,495","  Customer 02@1,525","  Customer 05@1,550","  Customer 08@1,575","  Customer 11@1,600","  Customer 14@1,625","  Customer 17@1,650","  Customer 20@1,675","  Customer 23@1,700","  Customer 26@1,725","  Customer 29@1,750","  Customer 32@1,775","  Customer 35@1,800","  Customer 38@1,825","  Customer 41@1,850","  Customer 44@1,875"," West@1,900","  Customer 03@1,930","  Customer 06@1,955","  Customer 09@1,980","  Customer 12@1,1005","  Customer 15@1,1030","  Customer 18@2,55","  Customer 21@2,80","  Customer 24@2,105","  Customer 27@2,130","  Customer 30@2,155","  Customer 33@2,180","  Customer 36@2,205","  Customer 39@2,230","  Customer 42@2,255","  Customer 45@2,280"," Totals@2,305"];
const ROWS = Array.from({ length: 45 }, (_, k) => ({
  Region: ['North', 'South', 'West'][k % 3],
  Customer: `Customer ${String(k + 1).padStart(2, '0')}`,
  Amount: String((k + 1) * 10),
}));

/** An outline flattened as DX_OUTLINE is: depth, title@page,top in hundredths. */
const flat = (root: OutlineEntry): string[] => {
  const out: string[] = [];
  const walk = (e: OutlineEntry, depth: number) => {
    out.push(`${' '.repeat(depth)}${e.title}@${e.page + 1},${Math.round((e.y / 72) * 100 * 100) / 100}`);
    for (const c of e.children) walk(c, depth + 1);
  };
  walk(root, 0);
  return out;
};
const outlineOf = (repx: string) => {
  const structure = parseReportStructure(repx);
  return reportOutline(paginate(structure, ROWS.length, { rows: ROWS }), structure.outlineTitle ?? '');
};

describe('the PDF outline, as DevExpress exports it (s54)', () => {
  it('nests each bookmark under its parent, opening its page at the control (s54a)', () => {
    expect(flat(outlineOf(S54A))).toEqual(DX_OUTLINE);
  });

  it('roots the outline at the report name when the report has no bookmark of its own (s54b)', () => {
    const root = outlineOf(S54A.replace(' Bookmark="Sales by region"', ''));
    expect(root.title).toBe('s54a-bookmarks');
    expect(flat(root).slice(1)).toEqual(DX_OUTLINE.slice(1));
  });

  it('puts a bookmark with no parent directly under the root (s54c)', () => {
    const root = outlineOf(S54A.replace(/ BookmarkParent="#Ref-\d+"/, ''));
    expect(root.children.map((e) => e.title)).toEqual(
      DX_OUTLINE.slice(1).map((l) => l.trim().split('@')[0]),
    );
    expect(root.children.every((e) => e.children.length === 0)).toBe(true);
  });
});

describe('the PDF writer', () => {
  // pdfjs's cold import can outlast a test's own five seconds when the whole
  // suite loads in parallel; paid here instead (see testing.md). Seen failing
  // the first case on 2026-11-02.
  beforeAll(async () => {
    await import('pdfjs-dist/legacy/build/pdf.mjs');
  }, 60_000);

  it('encodes text in Windows-1252, with "?" for what it cannot hold', () => {
    expect(winAnsiHex('Aé€')).toBe('<41e980>');
    expect(winAnsiHex('中')).toBe('<3f>');
  });

  it('writes a PDF pdfjs reads back: pages, text, an image, a link and the outline', async () => {
    const outline: OutlineEntry = { title: 'Résumé', page: 0, y: 0, children: [{ title: 'Second', page: 1, y: 72, children: [] }] };
    for (const deflate of [null, async (b: Uint8Array) => new Uint8Array(deflateSync(b))]) {
      const bytes = await writePdf({
        title: 'Test',
        deflate,
        outline,
        images: [{ width: 2, height: 1, rgb: new Uint8Array([255, 0, 0, 0, 0, 255]), alpha: new Uint8Array([255, 128]) }],
        pages: [
          {
            width: 612,
            height: 792,
            ops: [
              { kind: 'fill', x: 36, y: 36, w: 100, h: 20, colour: [1, 1, 0] },
              { kind: 'line', x1: 36, y1: 60, x2: 136, y2: 60, width: 1, colour: [0, 0, 0], dash: [3, 2] },
              { kind: 'clip', x: 0, y: 0, w: 612, h: 792 },
              { kind: 'text', x: 36, y: 50, size: 12, font: 'Helvetica-Bold', colour: [0, 0, 0], text: 'Hello (world) é', scale: 1.1 },
              { kind: 'restore' },
              { kind: 'image', x: 200, y: 200, w: 40, h: 20, image: 0 },
              { kind: 'link', x: 36, y: 36, w: 100, h: 20, uri: 'https://example.com/a(b)' },
            ],
          },
          { width: 612, height: 792, ops: [{ kind: 'text', x: 36, y: 100, size: 10, font: 'Times-Roman', colour: [0, 0, 0], text: 'Page two', scale: 1 }] },
        ],
      });
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const doc = await pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false, standardFontDataUrl: `${process.cwd().replace(/\\/g, '/')}/node_modules/pdfjs-dist/standard_fonts/` }).promise;
      expect(doc.numPages).toBe(2);
      const first = await doc.getPage(1);
      expect(first.view).toEqual([0, 0, 612, 792]);
      const text = (await first.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('');
      expect(text).toContain('Hello (world) é');
      const [annotation] = await first.getAnnotations();
      expect(annotation.url).toBe('https://example.com/a(b)');
      const items = await doc.getOutline();
      expect(items.map((i) => i.title)).toEqual(['Résumé']);
      expect(items[0].items.map((i) => i.title)).toEqual(['Second']);
      const dest = items[0].items[0].dest as unknown[];
      expect(await doc.getPageIndex(dest[0] as never)).toBe(1);
      expect(dest[3]).toBe(792 - 72);
      const ops = await first.getOperatorList();
      expect(ops.fnArray).toContain(pdfjs.OPS.paintImageXObject);
      await doc.loadingTask.destroy();
    }
  });

  // The 2026-11-11 audit, PX-14: "PDF with outline" printed Polish, Greek and
  // the rest beyond Windows-1252 as "?". The Liberation faces hold them.
  it('writes Polish and Greek in the embedded faces, and they read back as written', async () => {
    const face = (file: string) => parseTrueType(new Uint8Array(readFileSync(`assets/pdf-fonts/${file}`)));
    const fonts = { Helvetica: face('LiberationSans-Regular.ttf'), 'Times-Bold': face('LiberationSerif-Bold.ttf') };
    const pages = [{
      width: 612,
      height: 792,
      ops: [
        { kind: 'text' as const, x: 36, y: 50, size: 12, font: 'Helvetica' as const, colour: [0, 0, 0] as [number, number, number], text: 'Zażółć gęślą jaźń', scale: 1 },
        { kind: 'text' as const, x: 36, y: 80, size: 12, font: 'Times-Bold' as const, colour: [0, 0, 0] as [number, number, number], text: 'Καλημέρα κόσμε', scale: 1 },
      ],
    }];
    expect(fitsWinAnsi('Zażółć')).toBe(false);
    expect(fitsWinAnsi('Café €5')).toBe(true);
    expect(unprintableReason(pages, fonts)).toBeNull();
    const bytes = await writePdf({ title: 'Test', pages, fonts });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false }).promise;
    const text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('|');
    expect(text).toContain('Zażółć gęślą jaźń');
    expect(text).toContain('Καλημέρα κόσμε');
    await doc.loadingTask.destroy();
  });

  // The review of PX-14 (2026-11-11): embedding faces without PDF/A made an
  // encrypted file with embedded faces possible for the first time, and the
  // CIDSystemInfo strings were still written in the clear, which a reader
  // decrypts into nonsense. Every string is under its object's key now.
  it('embeds the faces in a password-protected file too, every string encrypted', async () => {
    const face = (file: string) => parseTrueType(new Uint8Array(readFileSync(`assets/pdf-fonts/${file}`)));
    const fonts = { Helvetica: face('LiberationSans-Regular.ttf') };
    const pages = [{
      width: 612,
      height: 792,
      ops: [{ kind: 'text' as const, x: 36, y: 50, size: 12, font: 'Helvetica' as const, colour: [0, 0, 0] as [number, number, number], text: 'Zażółć gęślą jaźń', scale: 1 }],
    }];
    const bytes = await writePdf({ title: 'Test', pages, fonts, security: { openPassword: 'test-open', permissionsPassword: '', level: 'AES128' } });
    const raw = new TextDecoder('latin1').decode(bytes);
    expect(raw).toContain('/CIDFontType2');
    expect(raw).not.toContain('(Adobe)');
    expect(raw).not.toContain('(Identity)');
    // Unencrypted, the same strings are written as they always were.
    expect(new TextDecoder('latin1').decode(await writePdf({ title: 'Test', pages, fonts }))).toContain('/Registry (Adobe) /Ordering (Identity) /Supplement 0');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    await expect(pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise).rejects.toMatchObject({ name: 'PasswordException' });
    const doc = await pdfjs.getDocument({ data: bytes.slice(), password: 'test-open', disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
    const text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('');
    expect(text).toContain('Zażółć gęślą jaźń');
    await doc.loadingTask.destroy();
  }, 60_000);

  it('refuses a script the faces do not hold, in words the person reads, and not a symbol', () => {
    const face = parseTrueType(new Uint8Array(readFileSync('assets/pdf-fonts/LiberationSans-Regular.ttf')));
    const page = (text: string) => [{ width: 612, height: 792, ops: [{ kind: 'text' as const, x: 0, y: 10, size: 10, font: 'Helvetica' as const, colour: [0, 0, 0] as [number, number, number], text, scale: 1 }] }];
    expect(unprintableReason(page('الإجمالي 100'), { Helvetica: face })).toBe('This report has Arabic text that PDF with outline cannot hold; PDF keeps it as shown.');
    expect(unprintableReason(page('कुल'), { Helvetica: face })).toBe('This report has Hindi text that PDF with outline cannot hold; PDF keeps it as shown.');
    expect(unprintableReason(page('合计'), { Helvetica: face })).toBe('This report has Chinese text that PDF with outline cannot hold; PDF keeps it as shown.');
    // A symbol the font lacks still prints as "?", not a refused file.
    expect(unprintableReason(page('Done ✓ \u{1F600}'), { Helvetica: face })).toBeNull();
    // Without faces, a letter beyond Windows-1252 is what asks for them.
    expect(unprintableReason(page('Zażółć'), null)).toMatch(/cannot hold/);
    expect(unprintableReason(page('Café'), null)).toBeNull();
  });

  // PX-15: a watermark at 20% and 45 degrees came out solid and level.
  it('draws a faded mark under an opacity, and turned text turned', async () => {
    const pages = [{
      width: 612,
      height: 792,
      ops: [
        { kind: 'text' as const, x: 100, y: 400, size: 48, font: 'Helvetica' as const, colour: [0.6, 0.6, 0.6] as [number, number, number], text: 'DRAFT', scale: 1, angle: -Math.PI / 4, alpha: 0.2 },
        { kind: 'fill' as const, x: 0, y: 0, w: 10, h: 10, colour: [0, 0, 1] as [number, number, number], alpha: 0.5 },
        { kind: 'fill' as const, x: 20, y: 0, w: 10, h: 10, colour: [0, 0, 1] as [number, number, number] },
      ],
    }];
    const raw = new TextDecoder('latin1').decode(await writePdf({ title: 'T', pages }));
    expect(raw).toContain('/ExtGState << /GA0 << /Type /ExtGState /ca 0.2 /CA 0.2 >> /GA1 << /Type /ExtGState /ca 0.5 /CA 0.5 >> >>');
    expect(raw).toMatch(/q \/GA0 gs BT \/F0 48 Tf 100 Tz 0\.6 0\.6 0\.6 rg 0\.707 0\.707 -0\.707 0\.707 100 392 Tm <[0-9a-f]+> Tj ET Q/);
    expect(raw).toContain('q /GA1 gs 0 0 1 rg 0 782 10 10 re f Q');
    expect(raw).toContain('\n0 0 1 rg 20 782 10 10 re f');
    // PDF/A-1 allows no transparency: the faded mark is its colour on white.
    const flat = writePdfA1(pages);
    await expect(flat).resolves.toContain('0.5 0.5 1 rg 0 782 10 10 re f');
  });
});

/** The same pages as PDF/A-1b, its streams left uncompressed, read as text. */
async function writePdfA1(pages: Parameters<typeof writePdf>[0]['pages']): Promise<string> {
  const face = parseTrueType(new Uint8Array(readFileSync('assets/pdf-fonts/LiberationSans-Regular.ttf')));
  const bytes = await writePdf({ title: 'T', pages, pdfa: { part: 1, fonts: { Helvetica: face }, date: new Date(0) } });
  return new TextDecoder('latin1').decode(bytes);
}
