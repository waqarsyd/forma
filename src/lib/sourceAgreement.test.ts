/*
 * How closely a report prints where its page printed, and the geometry fitted
 * to it (2026-11-11, the full audit's CC-07). The fixture is the Claude Code
 * reference's own pairs: its v1 and v2 of two made-up fidelity cases, where
 * DevExpress's print and the ink comparison found v2 closer on both (93.7% to
 * 97.4% on the invoice, 68.7% to 95.6% on the sales report), and the page as
 * PaddleOCR read it, in scripts/fidelity/replay/reference-2026-11-11.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { agreementOf, defaultTolerance, fitGeometry, measurerFrom, printedTexts, sourceAgreement, sourceTexts, type PlacedText } from './sourceAgreement';
import { faceWidthsFrom } from './ocrLayout';
import { parseReportStructure } from './reportPreview';
import { parseTrueType } from './trueType';
import { rowsForReport, type CaseData } from './fidelity';
import type { PageText } from './skeletonRepx';

const REPLAY = 'scripts/fidelity/replay/reference-2026-11-11';
const font = (file: string) => parseTrueType(new Uint8Array(readFileSync(`assets/pdf-fonts/${file}`)));
/** Arial and Times New Roman as Node measures them, so text grows as DevExpress prints it. */
const widthOf = faceWidthsFrom([
  { face: { family: 'Arial', bold: false }, font: font('LiberationSans-Regular.ttf') },
  { face: { family: 'Arial', bold: true }, font: font('LiberationSans-Bold.ttf') },
  { face: { family: 'Times New Roman', bold: false }, font: font('LiberationSerif-Regular.ttf') },
  { face: { family: 'Times New Roman', bold: true }, font: font('LiberationSerif-Bold.ttf') },
]);
const fixture = (name: string) => {
  const texts = JSON.parse(readFileSync(`${REPLAY}/${name}.texts.json`, 'utf8')) as PageText[];
  const data = JSON.parse(readFileSync(`scripts/fidelity/cases/${name}/data.json`, 'utf8')) as CaseData;
  const version = (v: string) => {
    const xml = readFileSync(`${REPLAY}/${name}-${v}.repx`, 'utf8');
    return { xml, rows: rowsForReport(xml, data).rows };
  };
  return { texts, v1: version('v1'), v2: version('v2') };
};

describe('sourceAgreement on the reference pairs', () => {
  for (const name of ['invoice-ruled', 'sales-grouped']) {
    it(`scores ${name}'s v2 above its v1, as DevExpress's print did`, () => {
      const { texts, v1, v2 } = fixture(name);
      const one = sourceAgreement(v1.xml, texts, { rows: v1.rows, widthOf })!;
      const two = sourceAgreement(v2.xml, texts, { rows: v2.rows, widthOf })!;
      expect(one.paired).toBeGreaterThan(50);
      expect(two.score).toBeGreaterThan(one.score + 0.2);
      // Neither sits across from the page: the margins were the page's own.
      expect(Math.abs(two.dx!)).toBeLessThan(1);
    });
  }

  it("fits the sales report's v1 as the reference did: the report header shorter, everything below it up", () => {
    const { texts, v1 } = fixture('sales-grouped');
    const fit = fitGeometry(v1.xml, texts, { rows: v1.rows, widthOf });
    expect(fit.applied).toBe(true);
    expect(fit.after!).toBeGreaterThan(fit.before! + 0.3);
    const header = (xml: string) => parseReportStructure(xml).bands.find((b) => b.kind === 'ReportHeader')!.height;
    // The reference took it from 56.67 to 52.
    expect(header(v1.xml)).toBeCloseTo(56.67, 1);
    expect(header(fit.xml)).toBeGreaterThan(51.5);
    expect(header(fit.xml)).toBeLessThan(53.5);
    expect(fit.reason).toMatch(/^fitted to the page: /);
  });

  it('leaves a report alone when nothing prints closer, and says so', () => {
    const { texts, v2 } = fixture('sales-grouped');
    const fit = fitGeometry(v2.xml, texts, { rows: v2.rows, widthOf });
    expect(fit).toMatchObject({ applied: false, xml: v2.xml });
    expect(fitGeometry(v2.xml, [], { rows: v2.rows, widthOf }).applied).toBe(false);
  });
});

/** A one-band report of labels, each `[text, x, y]`, at 10 pt Arial. */
const labels = (items: [string, number, number][], margin = 50) =>
  `<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="R" ReportUnit="HundredthsOfAnInch" Margins="${margin}, ${margin}, 50, 50" PaperKind="Letter" PageWidth="850" PageHeight="1100" Version="20.1"><Bands>` +
  '<Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />' +
  `<Item2 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="200"><Controls>${items
    .map(([t, x, y], i) => `<Item${i + 1} Ref="${i + 3}" ControlType="XRLabel" Name="l${i}" Text="${t}" LocationFloat="${x},${y}" SizeF="200,20" Font="Arial, 10pt" />`)
    .join('')}</Controls></Item2>` +
  '<Item3 Ref="40" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" />' +
  '</Bands></XtraReportsLayoutSerializer>';

describe('sourceAgreement, piece by piece', () => {
  it('reads the page by the middle and left edge of its ink, and the print by its font', () => {
    expect(sourceTexts([{ text: ' Total  Due ', x: 100, y: 200, w: 60, h: 10 }])).toEqual([{ text: ' Total  Due ', key: 'total due', x: 100, y: 205, band: null }]);
    const [printed] = printedTexts(labels([['Total', 0, 0]]), { widthOf }).texts;
    // Its line starts at the band's top (50 down, 50 across); the ink's middle of "Total" at 10 pt sits 0.55 em below.
    expect(printed).toMatchObject({ key: 'total', x: 50, band: 'ReportHeader' });
    expect(printed.y).toBeCloseTo(50 + ((0.189 + 0.905) / 2) * (10 / 0.72), 1);
  });

  it('pairs each text with the nearest one of the same words, and counts what sits within the tolerance', () => {
    const at = (key: string, x: number | null, y: number, band: string | null = 'B'): PlacedText => ({ text: key, key, x, y, band });
    const a = agreementOf([at('a', 10, 10, null), at('b', 10, 30, null), at('c', 10, 50, null)], [at('a', 11, 11), at('b', 10, 36), at('d', 10, 70)], 2);
    expect(a).toMatchObject({ paired: 2, within: 1, order: ['B'] });
    expect(a.recall).toBeCloseTo(1 / 3, 6);
    expect(a.precision).toBeCloseTo(1 / 3, 6);
    expect(a.bands.B).toBeCloseTo(3.5, 6);
  });

  it('holds a pair to 3 px of the picture it was read from, 150 dpi when that is not known', () => {
    expect(defaultTolerance('HundredthsOfAnInch')).toBeCloseTo(2, 6);
    expect(defaultTolerance('HundredthsOfAnInch', 300)).toBeCloseTo(1, 6);
    expect(defaultTolerance('HundredthsOfAnInch', 96)).toBeCloseTo(3.125, 6);
    expect(defaultTolerance('HundredthsOfAnInch', 0)).toBeCloseTo(2, 6);
  });

  it('moves everything across when the margin was counted twice', () => {
    // The page's texts at 75 across; the report drew them 25 in from a 50 margin, so 100.
    const xml = labels([['Northwind Traders', 25, 0], ['Invoice No', 25, 30], ['Bill To', 25, 60]]);
    const page = printedTexts(xml, { widthOf }).texts.map((t) => ({ text: t.text, x: t.x! - 25, y: t.y - 4, w: 80, h: 8 }));
    const before = sourceAgreement(xml, page, { widthOf })!;
    expect(before.dx).toBeCloseTo(25, 6);
    const fit = fitGeometry(xml, page, { widthOf });
    expect(fit.applied).toBe(true);
    expect(fit.after).toBe(1);
    expect(fit.xml).toContain('LocationFloat="0,0"');
  });

  it('measures lines in a face where nothing else can, and not at all where no face measures', () => {
    const measure = measurerFrom(widthOf)!;
    expect(measure('Northwind Traders Northwind Traders', { family: 'Arial', sizePt: 10, bold: false, italic: false }, 100)).toHaveLength(2);
    expect(measurerFrom(() => null)).toBeNull();
  });
});
