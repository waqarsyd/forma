/**
 * A report saved by DevExpress 22.2 or later, whose fonts are written as
 * `DXFont` (2026-11-24, finding GAP1-4 of the MCP design audit): read as the
 * fonts they are wherever Forma reads a font. The fixture is hand-written in
 * the shape of DevExpress's own Blazor sample (Reporting-Blazor-Getting-
 * Started, TestReport.repx, SerializerVersion 22.2.1.0): the root's
 * `DXFont="Arial, 9.75"`, and a label's `DXFont="Arial, 20.64"` beside
 * `<StylePriority UseFont="false" />`. Until then the Preview, the chat's
 * outline (which repx_outline, repx_edit and revise_report are driven by)
 * and the draft PDF read that label as Times New Roman 9.75pt, the
 * accessibility check never saw a small one, and a font edit added a second
 * font beside it.
 */
import { describe, expect, it } from 'vitest';
import { applyEdits, reportOutline } from './agentEdit';
import { parseReportStructure } from './reportPreview';
import { auditAccessibility, parseFont } from './repxAccessibility';
import { chunkRepx } from './repxChunks';

/** The sample's shape; `label` is the label's font attribute, `small` adds a label of 7 points in the same form. */
function modern({ label = 'DXFont="Arial, 20.64"', small = '' } = {}): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="22.2.1.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v22.2, Version=22.2.1.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a" Name="TestReport" PageWidth="850" PageHeight="1100" Version="22.2" DXFont="Arial, 9.75" Dpi="100">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="100" Dpi="100" />
    <Item2 Ref="3" ControlType="DetailBand" Name="Detail" HeightF="100" Dpi="100">
      <Controls>
        <Item1 Ref="4" ControlType="XRLabel" Name="xrLabel1" Multiline="true" Text="Hello, World!" LocationFloat="102.08, 27.71" SizeF="207.29, 49.04" ${label} Padding="2,2,0,0,100" Dpi="100">
          <StylePriority Ref="5" UseFont="false" />
        </Item1>
        <Item2 Ref="6" ControlType="XRLabel" Name="plain" Text="Inherits the report's font" LocationFloat="0, 80" SizeF="300, 18" Padding="2,2,0,0,100" Dpi="100" />${small}
      </Controls>
    </Item2>
    <Item3 Ref="8" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="100" Dpi="100" />
  </Bands>
</XtraReportsLayoutSerializer>
`;
}
const SMALL = '\n        <Item3 Ref="7" ControlType="XRLabel" Name="fine" Text="Small print" LocationFloat="0, 0" SizeF="100, 12" DXFont="Arial, 7" Padding="2,2,0,0,100" Dpi="100" />';

const controls = (xml: string) => parseReportStructure(xml).bands.flatMap((b) => b.controls);

describe('a DXFont, as DevExpress 22.2 and later writes a font', () => {
  it("is read by the Preview as the font it is: the label's own, and the report's where a control has none", () => {
    const [label, plain] = controls(modern());
    expect(label).toMatchObject({ name: 'xrLabel1', fontFamily: 'Arial', fontSize: 20.64 });
    expect(plain).toMatchObject({ name: 'plain', fontFamily: 'Arial', fontSize: 9.75 });
  });

  it("is read the same as the Font it stands for, so a report saved either way prints the same", () => {
    const asFont = controls(modern({ label: 'Font="Arial, 20.64pt"' }))[0];
    expect(controls(modern())[0]).toMatchObject({ fontFamily: asFont.fontFamily, fontSize: asFont.fontSize, bold: asFont.bold });
  });

  it("is what the chat's outline says, so repx_outline and an edit by name see the label's real font", () => {
    const outline = reportOutline(modern());
    expect(outline).toMatch(/xrLabel1: XRLabel .*Arial 20\.64pt/);
    expect(outline).not.toContain('Times New Roman');
  });

  it('counts as a declared size for the accessibility check, so a small one is flagged as a Font would be', () => {
    expect(parseFont('Arial, 7')).toEqual({ size: 7, bold: false });
    expect(parseFont('Arial, 9.75pt, style=Bold')).toEqual({ size: 9.75, bold: true });
    expect(parseFont('Arial, 12px')).toEqual({ size: null, bold: false });
    const flagged = auditAccessibility(modern({ small: SMALL })).find((f) => f.code === 'a11y-text-size');
    expect(flagged?.message).toContain('fine at 7pt');
    expect(auditAccessibility(modern({ small: SMALL.replace('DXFont="Arial, 7"', 'Font="Arial, 7pt"') })).find((f) => f.code === 'a11y-text-size')?.message).toBe(flagged?.message);
  });

  it('is rewritten in its own form by a font edit, so the label never carries two fonts', () => {
    const done = applyEdits(modern(), [{ op: 'font', control: 'xrLabel1', bold: true }]);
    expect(done.changed).toBe(true);
    const tag = /<Item1 Ref="4"[^>]*>/.exec(done.xml)?.[0] ?? '';
    expect(tag).toContain('DXFont="Arial, 20.64, style=Bold"');
    expect(tag).not.toMatch(/\sFont=/);
    expect(controls(done.xml)[0]).toMatchObject({ fontFamily: 'Arial', fontSize: 20.64, bold: true });
    // A control with a Font keeps being edited as one.
    const plain = applyEdits(modern(), [{ op: 'font', control: 'plain', size: 11 }]);
    expect(/<Item2 Ref="6"[^>]*>/.exec(plain.xml)?.[0]).toContain('Font="Arial, 11pt"');
  });

  it("names the label's font in the report library's caption", () => {
    const chunk = chunkRepx(modern()).find((c) => c.kind === 'control' && c.caption.includes('in the detail'));
    expect(chunk?.caption).toContain('Arial 20.64');
  });
});
