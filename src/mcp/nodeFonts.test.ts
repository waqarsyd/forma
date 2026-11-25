/**
 * The fonts Node measures text in (2026-11-24, the CLI and Forma Designer
 * work's wave 1: GAP2-1 to GAP2-4, owner decision OC7): the one face table,
 * every file of it in the clone; every face of it measuring its family's
 * widths on Windows, each style in its own face and never the last one
 * registered (GAP2-2), Courier New's included (the wave-1 review's
 * FONTS-R3); a family the host lacks registered once, and a file missing
 * from the clone an error naming it before any face of it goes in; a canvas
 * that measures nothing refused; and the families a report names that this
 * machine measured in a stand-in found by measuring, Times New Roman, the
 * canvas's own fallback, included (GAP2-4), a face found that lacks some of
 * the sample's characters not named (FONTS-R2), and a reference to no
 * character never thrown on (FONTS-R1). Registered under names of the
 * test's own where it must, so it holds on Windows, where the five families
 * are installed, and on CI's Linux, where they are not.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLONE } from './nodeGeneration';
import { MAX_FACES_CHECKED, METRIC_FACES, NOTHING_MEASURES, checkMeasuring, facePath, familyFinder, registerFace, reportFaces, standInFamilies, useMetricFonts, type MetricFace } from './nodeFonts';
import { lineWidthPt, measureOn } from '../lib/textMeasure';

const canvas = () => createCanvas(1, 1).getContext('2d') as unknown as CanvasRenderingContext2D;
const scratch = mkdtempSync(join(tmpdir(), 'forma-fonts-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const STYLES = [
  ['', 'normal', 'normal'],
  ['bold ', 'bold', 'normal'],
  ['italic ', 'normal', 'italic'],
  ['italic bold ', 'bold', 'italic'],
] as const;

/** Each style's plain width of `text` at 2048px in `family`, as lib/textMeasure.ts asks the canvas. */
function styleWidths(family: string, text: string): number[] {
  const context = canvas();
  context.fontKerning = 'none';
  return STYLES.map(([prefix]) => {
    context.font = `${prefix}2048px "${family}"`;
    return context.measureText(text).width;
  });
}

describe('the face table', () => {
  it("holds four faces for each of the five families, one per weight and style, every file in the clone and under the hook's 1 MB", () => {
    const families = [...new Set(METRIC_FACES.map((f) => f.family))];
    expect(families).toEqual(['Arial', 'Times New Roman', 'Courier New', 'Calibri', 'Cambria']);
    for (const family of families) {
      const faces = METRIC_FACES.filter((f) => f.family === family);
      expect(faces.map((f) => `${f.weight} ${f.style}`).sort(), family).toEqual(['bold italic', 'bold normal', 'normal italic', 'normal normal']);
    }
    for (const face of METRIC_FACES) {
      const size = statSync(facePath(CLONE, face)).size;
      expect(size, face.file.join('/')).toBeGreaterThan(10_000);
      expect(size, face.file.join('/')).toBeLessThanOrEqual(1_048_576);
    }
    expect(Object.isFrozen(METRIC_FACES)).toBe(true);
  });
});

/**
 * Each family's own widths: each style's plain width of "Invoice Number
 * Total" at 2048px, regular, bold, italic and bold italic, in the fonts
 * installed on Windows 11 (measured 2026-11-24 with @napi-rs/canvas 1.2.0).
 * Every face of the table gives its family's exactly, but Caladea, whose
 * 1000-unit em rounds Cambria's widths (assets/metric-fonts/README.md):
 * within 4 of the 2048 here, 3.3 at most as measured.
 */
const WINDOWS_WIDTHS: Record<string, readonly number[]> = {
  Arial: [19464, 20825, 19464, 20825],
  'Times New Roman': [18198, 19341, 17974, 18658],
  'Courier New': [24580, 24580, 24580, 24580],
  Calibri: [17936, 18343, 17743, 18211],
  Cambria: [19045, 20428, 18498, 19799],
};
const WITHIN: Record<string, number> = { Cambria: 4 };

describe('each face registered with its own weight and style', () => {
  it("measures every family's faces in that family's own widths, each style in its own face, never the last one registered", () => {
    // Bare, four calls measured every style in the last face (GAP2-2): Times New Roman tells all four apart, Arial's italics do not.
    // A row of the table pointing at another family's files fails here on any machine, Courier New's too, which nothing measured
    // until the wave-1 review (FONTS-R3: Liberation Sans under Courier New passed every case on Windows and on Linux).
    const families = [...new Set(METRIC_FACES.map((f) => f.family))];
    expect(Object.keys(WINDOWS_WIDTHS)).toEqual(families);
    for (const family of families) {
      const as = `Forma Widths ${family}`;
      for (const face of METRIC_FACES.filter((f) => f.family === family)) registerFace(CLONE, face, as);
      const measured = styleWidths(as, 'Invoice Number Total');
      WINDOWS_WIDTHS[family].forEach((windows, i) => expect(Math.abs(measured[i] - windows), `${family}, style ${i}: ${measured[i]}`).toBeLessThanOrEqual(WITHIN[family] ?? 0));
    }
  });

  it("names the file and the family when the canvas cannot read a face", () => {
    const broken = join(scratch, 'broken');
    mkdirSync(join(broken, 'assets', 'pdf-fonts'), { recursive: true });
    const face: MetricFace = { family: 'Forma Test Broken', file: ['assets', 'pdf-fonts', 'nothing-here.ttf'], weight: 'normal', style: 'normal' };
    expect(() => registerFace(broken, face)).toThrow(/^The font that measures Forma Test Broken could not be read from this clone \(.*nothing-here\.ttf\)\. It is committed with Forma: restore it with git/);
  });
});

describe('a family the host lacks, registered once', () => {
  /** The Liberation Sans faces under a family no host has. */
  const testFamily = (family: string): MetricFace[] => METRIC_FACES.filter((f) => f.family === 'Arial').map((f) => ({ ...f, family }));

  it('registers its four faces and says so, then nothing the second time', () => {
    const faces = testFamily('Forma Test Arial');
    expect(GlobalFonts.has('Forma Test Arial')).toBe(false);
    expect(useMetricFonts(CLONE, faces)).toEqual(['Forma Test Arial']);
    expect(GlobalFonts.has('Forma Test Arial')).toBe(true);
    expect(useMetricFonts(CLONE, faces)).toEqual([]);
    // Arial's own widths, regular and bold, in Liberation Sans (rows 51 and 59 measure the regular).
    const [regular, bold, italic, boldItalic] = styleWidths('Forma Test Arial', 'AVATAR Wave To LT Yo');
    expect([regular, italic]).toEqual([22990, 22990]);
    expect(bold).toBe(boldItalic);
    expect(bold).toBeGreaterThan(regular);
  });

  it('refuses, naming the file, when one is missing from the clone, and registers none of its faces', () => {
    // A clone with three of the four faces: the last is looked for before the first is registered.
    const partial = join(scratch, 'partial');
    mkdirSync(join(partial, 'assets', 'pdf-fonts'), { recursive: true });
    const faces = testFamily('Forma Test Partial');
    for (const face of faces.slice(0, 3)) copyFileSync(facePath(CLONE, face), facePath(partial, face));
    const missing = facePath(partial, faces[3]);
    let said = '';
    try {
      useMetricFonts(partial, faces);
    } catch (error) {
      said = (error as Error).message;
    }
    expect(said).toBe(`The font that measures Forma Test Partial on a machine without it is missing from this clone (${missing}). It is committed with Forma: restore it with git, then start again.`);
    expect(GlobalFonts.has('Forma Test Partial')).toBe(false);
  });
});

describe('a canvas that measures nothing', () => {
  it('is refused, as a host with no fonts measured every width before the faces were registered', () => {
    const nothing = () => ({ font: '', measureText: () => ({ width: 0 }) }) as unknown as CanvasRenderingContext2D;
    expect(() => checkMeasuring(nothing)).toThrow(NOTHING_MEASURES);
    expect(() => checkMeasuring(() => null)).toThrow(NOTHING_MEASURES);
    expect(() => checkMeasuring(canvas)).not.toThrow();
  });
});

describe("the families a report names that this machine measured in a stand-in", () => {
  // As nodeGeneration does first: the five families of any host, installed or Forma's.
  beforeAll(() => useMetricFonts(CLONE));
  const label = (font: string, extra = '') => `<Item1 Ref="4" ControlType="XRLabel" Name="l" Text="x" Font="${font}"${extra} />`;

  it("reads each Font and DXFont, and each localized font, with its style, once each", () => {
    const xml = [
      label('Arial, 9.75pt'),
      label('Arial, 12pt'),
      label('Tahoma, 8pt, style=Bold, Italic'),
      '<Item2 Ref="5" ControlType="XRLabel" DXFont="Segoe UI, 20.64" />',
      label('Ben &amp; Jerry&apos;s, 9pt, style=Italic'),
      '<LocalizationItems><Item1 Ref="9" Component="#Ref-4" Culture="Default" Path="Font" Data="Verdana, 9pt, style=Bold" /><Item2 Ref="10" Component="#Ref-4" Culture="Default" Path="Text" Data="Not a font" /></LocalizationItems>',
    ].join('\n');
    expect(reportFaces(xml)).toEqual([
      { family: 'Arial', bold: false, italic: false },
      { family: 'Tahoma', bold: true, italic: true },
      { family: 'Segoe UI', bold: false, italic: false },
      { family: "Ben & Jerry's", bold: false, italic: true },
      { family: 'Verdana', bold: true, italic: false },
    ]);
  });

  it("finds the families the canvas does not, and none of the five, Times New Roman, its own fallback, included", () => {
    const xml = [
      label('Arial, 9.75pt, style=Bold'),
      label('Times New Roman, 9.75pt, style=Italic'),
      label('Times New Roman, 9.75pt'),
      label('Courier New, 10pt, style=Bold'),
      label('Calibri, 11pt'),
      label('Cambria, 11pt, style=Bold, Italic'),
      label('Forma No Such Family, 9pt'),
      '<Item2 Ref="5" ControlType="XRLabel" DXFont="Forma Missing Two, 20.64" />',
      // A quote the canvas's font string cannot carry: the measurer could not ask for it by name.
      label('Fo&quot;o, 9pt'),
      label('forma no such family, 9pt, style=Bold'),
      '<LocalizationItems><Item1 Ref="9" Component="#Ref-4" Culture="Default" Path="Font" Data="Forma Missing Three, 9pt" /></LocalizationItems>',
    ].join('\n');
    expect(standInFamilies(xml, canvas)).toEqual(['Forma No Such Family', 'Forma Missing Two', 'Fo"o', 'Forma Missing Three']);
    expect(standInFamilies('<XtraReportsLayoutSerializer />', canvas)).toEqual([]);
    expect(standInFamilies(xml, () => null)).toEqual([]);
  });

  it("counts a face the canvas finds as found though it lacks some of the sample's characters, and one with only a space of it as a stand-in", () => {
    // FONTS-R2: compared as a whole line, a Code 39 barcode font, with no lowercase, was named, though "*12345*" measures in it exactly.
    // pdf.js's Symbol face has the figures and the stop and no Latin letter; Inter's latin-ext subset a space and nothing else of the sample.
    expect(GlobalFonts.registerFromPath(join(CLONE, 'node_modules', 'pdfjs-dist', 'standard_fonts', 'FoxitSymbol.pfb'), 'Forma Test Symbol')).toBeTruthy();
    expect(GlobalFonts.registerFromPath(join(CLONE, 'src', 'fonts', 'inter-latin-ext.woff2'), 'Forma Test Accents')).toBeTruthy();
    const width = (css: string, text: string) => {
      const context = canvas();
      context.fontKerning = 'none';
      context.font = css;
      return context.measureText(text).width;
    };
    const behind = (family: string, text: string) => new Set([width(`2048px "${family}", "Courier New"`, text), width(`2048px "${family}", "Times New Roman"`, text)]).size;
    // What the two faces hold, as the canvas measures them: the figures and the stop in the Symbol face's own widths, and no letter in either.
    expect([behind('Forma Test Symbol', '1234.'), behind('Forma Test Symbol', 'Wim'), behind('Forma Test Accents', ' '), behind('Forma Test Accents', 'Invoice')]).toEqual([1, 2, 1, 2]);
    const xml = [label('Forma Test Symbol, 9pt'), label('Forma Test Accents, 9pt'), label('Arial, 9pt')].join('\n');
    expect(standInFamilies(xml, canvas)).toEqual(['Forma Test Accents']);
  });

  it('leaves a reference to no character as written, and never throws on one', () => {
    // FONTS-R1: a decoder of its own threw RangeError on &#x110000;, past the last code point, and the job lost the report its AI had made.
    const xml = [label('Arial&#x110000;, 9pt'), label('Forma &#99999999; Sans, 9pt'), label('Arial&#9999999999999999999999;, 9pt, style=Bold'), label('Caf&#xE9; Sans, 9pt')].join('\n');
    const families = ['Arial&#x110000;', 'Forma &#99999999; Sans', 'Arial&#9999999999999999999999;', 'Café Sans'];
    expect(reportFaces(xml).map((f) => f.family)).toEqual(families);
    expect(standInFamilies(xml, canvas)).toEqual(families);
  });

  it(`asks about at most ${MAX_FACES_CHECKED} faces, however many a report names`, () => {
    const xml = Array.from({ length: 200 }, (_, i) => label(`Forma Missing ${i}, 9pt`)).join('\n');
    const found = standInFamilies(xml, canvas);
    expect(found).toHaveLength(MAX_FACES_CHECKED);
    expect(found[0]).toBe('Forma Missing 0');
  });
});

describe('a family GDI names apart from the browser, found by its own name (2026-11-25)', () => {
  beforeAll(() => useMetricFonts(CLONE));
  const line = 'AVATAR Wave To LT Yo 0123456789 The quick brown fox';
  const at = (family: string) => ({ family, sizePt: 20, bold: false, italic: false });

  it('finds a family by a name once, in any case, and never one it lacks or cannot ask for', () => {
    let made = 0;
    const finds = familyFinder(() => (made++, canvas()));
    expect([finds('Arial'), finds('ARIAL'), finds('Forma No Such Family'), finds('Fo"o')]).toEqual([true, true, false, false]);
    expect(made).toBe(1);
    expect(familyFinder(() => null)('Arial')).toBe(false);
  });

  // Office's Franklin Gothic Demi, where installed: in its own face by GDI's name, where the browser's name measured another.
  it.runIf(familyFinder(canvas)('Franklin Gothic Demi'))('measures Franklin Gothic Demi in its own face once the finder is handed in', () => {
    try {
      measureOn(canvas);
      const asBrowser = lineWidthPt(line, at('Franklin Gothic Demi'));
      measureOn(canvas, familyFinder(canvas));
      const own = lineWidthPt(line, at('Franklin Gothic Demi'));
      const context = canvas();
      context.fontKerning = 'none';
      context.font = '2048px "Franklin Gothic Demi"';
      expect(own).toBeCloseTo((context.measureText(line).width * 20) / 2048, 6);
      expect(Math.abs(own! - asBrowser!)).toBeGreaterThan(0.5);
    } finally {
      measureOn(null);
    }
  });
});
