/**
 * The three checks are measured against what DevExpress's analyzer returned
 * for its own demo on 2026-10-28, so the fixtures use the values it flagged:
 * 20pt bold text in #454d67 on #f6f7f9 passed its contrast rule, 9pt cells
 * failed its size rule, and a picture box with no AccessibleDescription failed
 * its alternative-text rule.
 */
import { describe, it, expect } from 'vitest';
import {
  auditAccessibility,
  contrastRatio,
  parseColor,
  parseFont,
  MIN_BODY_PT,
} from './repxAccessibility';
import { auditRepx } from './repxAudit';

const report = (bands: string, rootAttrs = '', extra = '') =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  `<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" PageWidth="850" PageHeight="1100"${rootAttrs}>` +
  `<Bands>${bands}</Bands>${extra}</XtraReportsLayoutSerializer>`;

const bands = (controls: string) =>
  '<Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="20" />' +
  `<Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="100"><Controls>${controls}</Controls></Item2>` +
  '<Item3 Ref="9" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="20" />';

const label = (n: number, attrs: string) =>
  `<Item${n} Ref="${n + 10}" ControlType="XRLabel" Name="label${n}" Text="Hello" LocationFloat="0,${n * 25}" SizeF="200,20" ${attrs}/>`;

const codes = (xml: string) => auditAccessibility(xml).map((f) => f.code);

describe('parseColor', () => {
  it('reads A,R,G,B as DevExpress writes it, and R,G,B', () => {
    expect(parseColor('255,69,77,103')).toEqual({ r: 69, g: 77, b: 103 });
    expect(parseColor('69,77,103')).toEqual({ r: 69, g: 77, b: 103 });
  });

  it('treats transparent, zero alpha and absent as see-through', () => {
    expect(parseColor('Transparent')).toBeNull();
    expect(parseColor('0,255,255,255')).toBeNull();
    expect(parseColor(null)).toBeNull();
  });

  it('leaves a partial alpha and an unknown name unjudged', () => {
    expect(parseColor('128,0,0,0')).toBeUndefined();
    expect(parseColor('Mauve')).toBeUndefined();
  });

  it('knows the common names', () => {
    expect(parseColor('White')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('black')).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and symmetric', () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };
    expect(contrastRatio(black, white)).toBeCloseTo(21, 1);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 1);
  });

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio({ r: 100, g: 100, b: 100 }, { r: 100, g: 100, b: 100 })).toBe(1);
  });
});

describe('parseFont', () => {
  it('reads size and bold from the DevExpress form', () => {
    expect(parseFont('Arial, 9.75pt')).toEqual({ size: 9.75, bold: false });
    expect(parseFont('Arial, 20pt, style=Bold')).toEqual({ size: 20, bold: true });
    expect(parseFont('Arial, 10pt, style=Bold, Italic')).toEqual({ size: 10, bold: true });
    expect(parseFont('Arial')).toEqual({ size: null, bold: false });
    expect(parseFont(null)).toBeNull();
  });
});

describe('a11y-text-size', () => {
  it('passes a report that declares no font anywhere, rather than assuming the default', () => {
    expect(codes(report(bands(label(1, ''))))).toEqual([]);
  });

  it('flags text below 12pt, once per report, naming the smallest', () => {
    const xml = report(bands(label(1, 'Font="Arial, 9pt" ') + label(2, 'Font="Arial, 7.5pt" ') + label(3, 'Font="Arial, 12pt" ')));
    const findings = auditAccessibility(xml);
    expect(findings.map((f) => f.code)).toEqual(['a11y-text-size']);
    expect(findings[0].message).toContain('2 of 3 text control(s)');
    expect(findings[0].message).toContain('label2 at 7.5pt');
    expect(findings[0].message).toContain(`${MIN_BODY_PT}pt`);
  });

  it('inherits the size from the report, a band, a table and a row', () => {
    const table =
      '<Item1 Ref="11" ControlType="XRTable" Name="t" LocationFloat="0,0" SizeF="400,20" Font="Arial, 8pt"><Rows>' +
      '<Item1 Ref="12" ControlType="XRTableRow" Name="r" Weight="1"><Cells>' +
      '<Item1 Ref="13" ControlType="XRTableCell" Name="c1" Text="A" Weight="1" />' +
      '<Item2 Ref="14" ControlType="XRTableCell" Name="c2" Text="B" Weight="1" Font="Arial, 14pt" />' +
      '</Cells></Item1></Rows></Item1>';
    const findings = auditAccessibility(report(bands(table)));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('1 of 2 text control(s)');
    expect(findings[0].message).toContain('c1 at 8pt');

    const fromRoot = report(bands(label(1, '')), ' Font="Arial, 9.75pt"');
    expect(codes(fromRoot)).toEqual(['a11y-text-size']);
  });

  it('reads a size that the style sheet holds after the style lift', () => {
    const styled = report(
      bands(label(1, 'StyleName="xrControlStyle1" ')),
      '',
      '<StyleSheet><Item1 Ref="30" Name="xrControlStyle1" Font="Arial, 8pt" /></StyleSheet>',
    );
    expect(codes(styled)).toEqual(['a11y-text-size']);
  });
});

describe('a11y-contrast', () => {
  it('passes black on white, and passes DevExpress\'s own demo colours', () => {
    expect(codes(report(bands(label(1, 'ForeColor="Black" BackColor="White" Font="Arial, 12pt" '))))).toEqual([]);
    // #454d67 on #f6f7f9 at 20pt bold: DevExpress flagged these cells for size, not contrast.
    expect(codes(report(bands(label(1, 'ForeColor="255,69,77,103" BackColor="255,246,247,249" Font="Arial, 20pt, style=Bold" '))))).toEqual([]);
  });

  it('flags grey on white and names the pair', () => {
    const findings = auditAccessibility(report(bands(label(1, 'ForeColor="255,170,175,189" Font="Arial, 12pt" '))));
    expect(findings.map((f) => f.code)).toEqual(['a11y-contrast']);
    expect(findings[0].message).toContain('label1 at ');
    expect(findings[0].message).toContain('#aaafbd on #ffffff');
  });

  it('lets large text pass at 3:1 where small text fails', () => {
    // #767676 on white is about 4.5:1; #8a8a8a is about 3.5:1 -- fails at 12pt, passes at 18pt.
    const grey = 'ForeColor="255,138,138,138" ';
    expect(codes(report(bands(label(1, grey + 'Font="Arial, 12pt" '))))).toEqual(['a11y-contrast']);
    expect(codes(report(bands(label(1, grey + 'Font="Arial, 18pt" '))))).toEqual([]);
    expect(codes(report(bands(label(1, grey + 'Font="Arial, 14pt, style=Bold" '))))).toEqual([]);
  });

  it('sees through a transparent background to the band and the report', () => {
    const band =
      '<Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="20" />' +
      '<Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="100" BackColor="255,0,0,0"><Controls>' +
      label(1, 'BackColor="Transparent" Font="Arial, 12pt" ') +
      '</Controls></Item2>' +
      '<Item3 Ref="9" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="20" />';
    // Default black text on the band's black background.
    expect(codes(report(band))).toEqual(['a11y-contrast']);
  });

  it('leaves an unknown colour unjudged', () => {
    expect(codes(report(bands(label(1, 'ForeColor="Mauve" Font="Arial, 12pt" '))))).toEqual([]);
    expect(codes(report(bands(label(1, 'ForeColor="128,0,0,0" Font="Arial, 12pt" '))))).toEqual([]);
  });
});

describe('a11y-alt-text', () => {
  const picture = (attrs: string) =>
    `<Item1 Ref="11" ControlType="XRPictureBox" Name="logo" LocationFloat="0,0" SizeF="100,40" ${attrs}/>`;

  it('flags a visual control with neither a description nor a role', () => {
    const findings = auditAccessibility(report(bands(picture(''))));
    expect(findings.map((f) => f.code)).toEqual(['a11y-alt-text']);
    expect(findings[0].message).toContain('logo');
  });

  it('accepts an AccessibleDescription, or an explicit AccessibleRole such as Decorative', () => {
    expect(codes(report(bands(picture('AccessibleDescription="Company logo" '))))).toEqual([]);
    expect(codes(report(bands(picture('AccessibleRole="Decorative" '))))).toEqual([]);
  });

  it('covers barcodes, charts, shapes, gauges and sparklines, and not labels', () => {
    for (const type of ['XRBarCode', 'XRChart', 'XRShape', 'XRGauge', 'XRSparkline']) {
      const xml = report(bands(`<Item1 Ref="11" ControlType="${type}" Name="v" LocationFloat="0,0" SizeF="100,40" />`));
      expect(codes(xml)).toEqual(['a11y-alt-text']);
    }
    expect(codes(report(bands(label(1, ''))))).toEqual([]);
  });
});

describe('through auditRepx', () => {
  it('appends the accessibility findings as warnings after the structural ones', () => {
    const xml = report(bands(label(1, 'Font="Arial, 8pt" ')));
    const audit = auditRepx(xml);
    expect(audit.errors).toBe(0);
    expect(audit.warnings).toBe(1);
    expect(audit.findings[0]).toMatchObject({ severity: 'warning', code: 'a11y-text-size' });
    expect(audit.summary).toContain('a11y-text-size');
  });

  it('still reports nothing on the structural fixtures with no appearance declared', () => {
    expect(auditRepx(report(bands(label(1, '')))).ok).toBe(true);
  });
});
