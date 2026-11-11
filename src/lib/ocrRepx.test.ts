// @vitest-environment jsdom
/**
 * The .repx an OCR layout becomes. jsdom because `checkRepx` parses with the
 * browser's DOMParser, which is what the app's own check runs on before an
 * export. Whether DevExpress's loader keeps every control was asked of the
 * real thing with `tools/RepxProbe inspect` when this was written: a two-page
 * layout with a table and a flagged label loaded with one table and six cells,
 * nothing lost, and printed every text where the layout put it.
 */
import { describe, expect, it } from 'vitest';
import { layoutToRepx, layoutToReport, ocrSummary, reportNameFor, validateOcrRepx } from './ocrRepx';
import { parseReportStructure } from './reportPreview';
import type { DetectedLayout, DetectedText } from './ocrLayout';

const t = (text: string, x: number, y: number, flagged = false): DetectedText => ({
  text, x, y, w: 80, h: 18, ink: { x, y: y + 3, w: 80, h: 10 }, fontSize: 10, confidence: flagged ? 40 : 95, flagged, words: [],
});

const layout: DetectedLayout = {
  unit: 'HundredthsOfAnInch', total: 8, flagged: 1, ignored: 0,
  pages: [
    {
      width: 850, height: 1100, margins: { left: 50, right: 50, top: 50, bottom: 50 }, ignored: [],
      labels: [t('Invoice & Co <42>', 60, 60), t('Smudge', 400, 60, true)],
      tables: [{ x: 60, y: 120, columns: [200, 100, 100], rows: [
        { y: 120, h: 20, cells: [t('Item', 60, 120), t('Qty', 260, 120), t('Price', 360, 120)] },
        { y: 140, h: 20, cells: [t('Chai', 60, 140), t('12', 260, 140), null] },
      ] }],
    },
    { width: 850, height: 1100, margins: { left: 50, right: 50, top: 50, bottom: 50 }, ignored: [], labels: [t('Page two', 60, 60)], tables: [] },
  ],
};

// Beside the function since 2026-11-06; it was tested through OcrDialog's re-export.
describe('reportNameFor', () => {
  it('makes a report Name DevExpress accepts out of a file name', () => {
    expect(reportNameFor('invoice scan.pdf')).toBe('invoicescan');
    expect(reportNameFor('2024-03 receipt.png')).toBe('Ocr202403receipt');
    expect(reportNameFor('Bill_of_Lading.jpeg')).toBe('Bill_of_Lading');
  });
});

describe('layoutToRepx', () => {
  const xml = layoutToRepx(layout, { name: 'OcrTable' });

  it('writes a report the app\'s own checks pass, with the passes a generated report gets', () => {
    expect(validateOcrRepx(xml)).toEqual({ ok: true, problems: [] });
    // Letter is DevExpress's default paper, so its serializer writes no PaperKind for it.
    expect(xml).not.toMatch(/PaperKind=/);
    expect(xml).toMatch(/<XtraReportsLayoutSerializer [^>]*Ref="0"/);
    // A Dpi on every element where the serializer writes one: none at 100, 254 in millimetres.
    expect(xml).not.toMatch(/Dpi=/);
    expect(layoutToRepx({ ...layout, unit: 'TenthsOfAMillimeter' })).toMatch(/ControlType="DetailBand"[^>]*Dpi="254"/);
  });

  it('places every label and cell where the layout put it, a later page behind a page break', () => {
    // On the report header, which prints once; Detail is there, empty, because DevExpress expects one.
    const bands = parseReportStructure(xml).bands;
    expect(bands.map((b) => [b.kind, b.height])).toEqual([['TopMargin', 50], ['ReportHeader', 2000], ['Detail', 0], ['BottomMargin', 50]]);
    const header = bands.find((b) => b.kind === 'ReportHeader')!;
    const at = (type: string) => header.controls.filter((c) => c.type === type).map((c) => `${c.text}@${c.x},${c.y}`);
    // Band coordinates: the margin is the band's edge.
    expect(at('XRLabel')).toEqual(['Invoice & Co <42>@10,10', 'Smudge@350,10', 'Page two@10,1010']);
    expect(at('XRPageBreak')).toEqual(['@0,1000']);
    const table = header.controls.find((c) => c.type === 'XRTable')!;
    expect([table.x, table.y, table.width, table.height]).toEqual([10, 70, 400, 40]);
    expect(table.rows.map((r) => r.cells.map((c) => c.text))).toEqual([['Item', 'Qty', 'Price'], ['Chai', '12', '']]);
  });

  it('turns a page wider than it is tall, as the paper repair writes it', () => {
    const wide = { ...layout, pages: layout.pages.map((p) => ({ ...p, width: 1100, height: 850 })) };
    expect(layoutToRepx(wide)).toMatch(/Landscape="true"/);
  });

  it('names text with a low-confidence word so it can be found, or leaves it out', () => {
    expect(xml).toMatch(/Name="lowConfidenceLabel2" Text="Smudge"/);
    expect(xml).toMatch(/Name="ocrLabel1"/);
    expect(layoutToRepx(layout, { dropFlagged: true })).not.toMatch(/Smudge/);
  });
});

describe('layoutToReport and ocrSummary', () => {
  it('gives the Mockup the same controls, a section per page, its font sizes in report units', () => {
    const report = layoutToReport(layout, { title: 'Scan' });
    expect([report.title, report.pageWidth]).toEqual(['Scan', 850]);
    expect(report.sections.map((s) => [s.name, s.type, s.height])).toEqual([['Report header, page 1', 'header', 1000], ['Report header, page 2', 'header', 1000]]);
    const [label, smudge, table] = report.sections[0].elements;
    // As wide as the text prints in Arial: with no canvas, 0.6 em a character,
    // 17 characters at 10pt, is 141.67 units, and 4% and 4 units more.
    expect([label.type, label.content, label.x, label.y, label.width, label.height]).toEqual(['label', 'Invoice & Co <42>', 10, 10, 151.33, 18]);
    // A label already wider than that keeps the width it was seen at.
    const wide = layoutToReport({ ...layout, pages: [{ ...layout.pages[0], labels: [{ ...layout.pages[0].labels[1], w: 300 }], tables: [] }] });
    expect(wide.sections[0].elements[0].width).toBe(328);
    expect(smudge.id).toBe('lowConfidenceLabel2');
    // 10pt is 13.89 hundredths of an inch.
    expect(label.fontSize).toBe(13.89);
    expect([table.type, table.x, table.y, table.width, table.height]).toEqual(['table', 10, 70, 400, 40]);
    expect(table.rows!.map((r) => r.cells.map((c) => c.content))).toEqual([['Item', 'Qty', 'Price'], ['Chai', '12', '']]);
    expect(table.rows![0].cells.map((c) => c.weight)).toEqual([200, 100, 100]);
    expect(report.sections[1].elements.map((e) => [e.content, e.x, e.y])).toEqual([['Page two', 10, 10]]);
  });

  it('lists the unsure text in the spec, to check against the source, or says it was left out', () => {
    const md = ocrSummary(layout, { title: 'Scan' });
    expect(md).toMatch(/^# Scan\n/);
    expect(md).toMatch(/Built from your 2 pages: 3 texts and 1 table, each where the page printed it/);
    expect(ocrSummary(layout, { dropFlagged: true })).toMatch(/2 texts and 1 table/);
    expect(md).toContain('**Check these against the page.** 1 text holds a word that was hard to make out');
    expect(md).toContain('| 1 | Smudge |');
    const dropped = ocrSummary(layout, { dropFlagged: true });
    // Left out of the report, not out of sight: the spec still says what it read.
    expect(dropped).toMatch(/\*\*Check these against the page\.\*\* 1 text was hard to make out and was left out; add it by hand if needed:/);
    expect(dropped).toContain('| 1 | Smudge |');
  });

  // The full audit (2026-11-11, PL-07): the Spec names no part of Forma and no confidence.
  it('writes the spec in plain words', () => {
    for (const md of [ocrSummary(layout, { title: 'Scan' }), ocrSummary(layout, { dropFlagged: true })]) {
      expect(md).not.toMatch(/OCR|box reader|own model|vision model|learned from|no model|AI service|\bconfidence\b/i);
    }
  });
});