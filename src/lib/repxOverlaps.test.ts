import { describe, it, expect } from 'vitest';
import { findOverlaps, resolveOverlaps } from './repxOverlaps';
import { parseReportStructure } from './reportPreview';

const report = (controls: string, bandHeight = 100) =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" PageWidth="850" PageHeight="1100">' +
  '<Bands>' +
  '<Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="20" />' +
  `<Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="${bandHeight}"><Controls>${controls}</Controls></Item2>` +
  '<Item3 Ref="9" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="20" />' +
  '</Bands></XtraReportsLayoutSerializer>';

const label = (n: number, x: number, y: number, w: number, h: number, type = 'XRLabel') =>
  `<Item${n} Ref="${n + 10}" ControlType="${type}" Name="c${n}" Text="t" LocationFloat="${x},${y}" SizeF="${w},${h}" />`;

describe('findOverlaps', () => {
  it('finds two labels that share area, and names both', () => {
    const xml = report(label(1, 0, 0, 200, 30) + label(2, 50, 20, 200, 30));
    const found = findOverlaps(xml);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ band: 'Detail', a: { name: 'c1' }, b: { name: 'c2' }, depth: 10 });
  });

  it('ignores touching edges, side-by-side columns and stacked rows', () => {
    const xml = report(label(1, 0, 0, 200, 30) + label(2, 200, 0, 200, 30) + label(3, 0, 30, 200, 30) + label(4, 0, 60.5, 200, 30));
    expect(findOverlaps(xml)).toEqual([]);
  });

  it('leaves lines and shapes out, since they are drawn over text on purpose', () => {
    const xml = report(label(1, 0, 0, 200, 30) + label(2, 0, 28, 200, 2, 'XRLine') + label(3, 0, 0, 300, 60, 'XRShape'));
    expect(findOverlaps(xml)).toEqual([]);
  });

  it('ignores a hidden control, which DevExpress prints nothing for', () => {
    const hidden = label(2, 50, 20, 200, 30).replace(' />', ' Visible="false" />');
    expect(findOverlaps(report(label(1, 0, 0, 200, 30) + hidden))).toEqual([]);
  });

  it('never throws on an empty or malformed document', () => {
    expect(findOverlaps('')).toEqual([]);
    expect(findOverlaps('<not xml')).toEqual([]);
  });
});

describe('resolveOverlaps', () => {
  it('moves the lower control down to clear the upper one, leaving a gap', () => {
    const xml = report(label(1, 0, 0, 200, 30) + label(2, 50, 20, 200, 30));
    const result = resolveOverlaps(xml);
    expect(result.applied).toBe(true);
    expect(result.moved).toBe(1);
    const detail = parseReportStructure(result.xml).bands.find((b) => b.kind === 'Detail')!;
    const moved = detail.controls.find((c) => c.name === 'c2')!;
    expect(moved.x).toBe(50);
    expect(moved.y).toBe(32);
    expect(findOverlaps(result.xml)).toEqual([]);
  });

  it('writes the file\'s own numbers in a millimetre report with no Dpi, which the parse reads at 2.54 times', () => {
    // DevExpress reads each control at its own Dpi, 100 when absent (s24), so
    // the parse scales these by 2.54; the move must be divided back.
    const xml = report(label(1, 0, 0, 200, 30) + label(2, 50, 20, 200, 30)).replace('Name="Report1"', 'Name="Report1" ReportUnit="TenthsOfAMillimeter"');
    const result = resolveOverlaps(xml);
    expect(result.applied).toBe(true);
    // 30 + the 2-unit gap over 2.54, rounded: 31, not the 81 a scaled write would give.
    expect(result.xml).toContain('Name="c2" Text="t" LocationFloat="50,31"');
    expect(findOverlaps(result.xml)).toEqual([]);
  });

  it('grows the band when the moved control no longer fits', () => {
    const xml = report(label(1, 0, 0, 200, 60) + label(2, 0, 50, 200, 40), 90);
    const result = resolveOverlaps(xml);
    expect(result.grown).toBe(1);
    const detail = parseReportStructure(result.xml).bands.find((b) => b.kind === 'Detail')!;
    expect(detail.height).toBe(102);
    expect(result.reason).toContain('grew 1 band');
  });

  it('resolves a chain of three in one call', () => {
    const xml = report(label(1, 0, 0, 200, 30) + label(2, 0, 10, 200, 30) + label(3, 0, 20, 200, 30));
    const result = resolveOverlaps(xml);
    expect(result.moved).toBeGreaterThanOrEqual(2);
    expect(findOverlaps(result.xml)).toEqual([]);
  });

  it('changes nothing and says so when nothing overlaps', () => {
    const xml = report(label(1, 0, 0, 200, 30) + label(2, 0, 40, 200, 30));
    const result = resolveOverlaps(xml);
    expect(result.applied).toBe(false);
    expect(result.xml).toBe(xml);
    expect(result.reason).toBe('no overlapping controls');
  });

  it('declines an empty document', () => {
    expect(resolveOverlaps('').applied).toBe(false);
  });
});
