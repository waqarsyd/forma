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
import { layoutToRepx, validateOcrRepx } from './ocrRepx';
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
    const detail = parseReportStructure(xml).bands.find((b) => b.kind === 'Detail')!;
    const at = (type: string) => detail.controls.filter((c) => c.type === type).map((c) => `${c.text}@${c.x},${c.y}`);
    // Band coordinates: the margin is the band's edge.
    expect(at('XRLabel')).toEqual(['Invoice & Co <42>@10,10', 'Smudge@350,10', 'Page two@10,1010']);
    expect(at('XRPageBreak')).toEqual(['@0,1000']);
    const table = detail.controls.find((c) => c.type === 'XRTable')!;
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
