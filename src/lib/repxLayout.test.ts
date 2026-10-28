import { describe, it, expect } from 'vitest';
import { auditLayoutBounds } from './repxLayout';
import { auditRepx } from './repxAudit';

const report = (bands: string, margins = '0, 0, 0, 0') =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  `<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" Margins="${margins}" PageWidth="850" PageHeight="1100">` +
  `<Bands>${bands}</Bands></XtraReportsLayoutSerializer>`;

const detail = (controls: string, height = 100) =>
  '<Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="0" />' +
  `<Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="${height}"><Controls>${controls}</Controls></Item2>` +
  '<Item3 Ref="9" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="0" />';

const label = (n: number, x: number, y: number, w: number, h: number) =>
  `<Item${n} Ref="${n + 10}" ControlType="XRLabel" Name="l${n}" Text="t" LocationFloat="${x},${y}" SizeF="${w},${h}" />`;

const codes = (xml: string) => auditLayoutBounds(xml).map((f) => f.code);

describe('auditLayoutBounds', () => {
  it('passes a report whose controls sit inside their bands and the page', () => {
    expect(codes(report(detail(label(1, 0, 0, 850, 30) + label(2, 0, 60, 400, 40))))).toEqual([]);
  });

  it('flags a control past the right edge of the page, and names it', () => {
    const findings = auditLayoutBounds(report(detail(label(1, 700, 0, 200, 30))));
    expect(findings.map((f) => f.code)).toEqual(['control-outside-page']);
    expect(findings[0].message).toContain('l1');
    expect(findings[0].message).toContain('850-unit width');
  });

  it('flags a control past the bottom of its band', () => {
    const findings = auditLayoutBounds(report(detail(label(1, 0, 80, 200, 40))));
    expect(findings.map((f) => f.code)).toEqual(['control-below-band']);
    expect(findings[0].message).toContain('l1');
  });

  it('flags a band taller than the usable page, net of the margins', () => {
    const tall = report(detail(label(1, 0, 0, 200, 30), 1050), '0, 0, 50, 50');
    const findings = auditLayoutBounds(tall);
    expect(findings.map((f) => f.code)).toEqual(['band-taller-than-page']);
    expect(findings[0].message).toContain('Detail');
    expect(findings[0].message).toContain('1000 units');
    expect(codes(report(detail(label(1, 0, 0, 200, 30), 1000), '0, 0, 50, 50'))).toEqual([]);
  });

  it('ignores a unit of rounding past an edge', () => {
    expect(codes(report(detail(label(1, 0, 0, 850.5, 100.5))))).toEqual([]);
  });

  it('never throws on an empty document', () => {
    expect(auditLayoutBounds('')).toEqual([]);
  });

  it('is appended to the audit as warnings', () => {
    const audit = auditRepx(report(detail(label(1, 700, 0, 200, 30))));
    expect(audit.errors).toBe(0);
    expect(audit.findings.map((f) => f.code)).toContain('control-outside-page');
  });
});
