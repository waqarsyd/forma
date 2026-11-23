/**
 * The draft PDF (2026-11-24, moved out of scripts/repx.ts, where it had no
 * test): a report laid out by the Preview's engine with no data and drawn in
 * the standard fonts, the drawing scripts/repx.ts's `pdf` command and the
 * MCP server's repx_pdf share.
 */
import { describe, expect, it } from 'vitest';
import { draftPdf, fontOf, pdfPages } from './draftPdf';
import { winAnsiHex } from './pdfWriter';
import { paginate, parseReportStructure } from './reportPreview';

const REPORT = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Invoice" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100" Version="20.1">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />
    <Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="60">
      <Controls>
        <Item1 Ref="4" ControlType="XRLabel" Name="title" Text="Invoice" Font="Times New Roman, 14pt, style=Bold" TextAlignment="TopCenter" LocationFloat="0,0" SizeF="750,30" />
        <Item2 Ref="5" ControlType="XRLine" Name="rule" LocationFloat="0,40" SizeF="750,10" />
      </Controls>
    </Item2>
    <Item3 Ref="6" ControlType="DetailBand" Name="Detail" HeightF="22">
      <Controls>
        <Item1 Ref="7" ControlType="XRLabel" Name="customer" Font="Courier New, 9pt" Borders="All" LocationFloat="0,0" SizeF="300,20">
          <ExpressionBindings><Item1 Ref="8" EventName="BeforePrint" PropertyName="Text" Expression="[Customer]" /></ExpressionBindings>
        </Item1>
      </Controls>
    </Item3>
    <Item4 Ref="9" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" />
  </Bands>
</XtraReportsLayoutSerializer>`;

describe('the draft PDF', () => {
  it.each([
    [['Arial', false, false], 'Helvetica'],
    [['Arial', true, true], 'Helvetica-BoldOblique'],
    [['Times New Roman', true, false], 'Times-Bold'],
    [['Georgia', false, true], 'Times-Italic'],
    [['Microsoft Sans Serif', false, false], 'Helvetica'],
    [['Courier New', false, false], 'Courier'],
    [['Consolas', false, true], 'Courier-Oblique'],
    [[null, false, false], 'Helvetica'],
  ] as const)('prints %j in %s', ([family, bold, italic], font) => {
    expect(fontOf(family, bold, italic)).toBe(font);
  });

  it("draws each control where the Preview lays it out, in points: a title's words, a line, and a bordered field's place, empty", () => {
    const report = paginate(parseReportStructure(REPORT), 5);
    const [page] = pdfPages(report);
    expect(page.width).toBeCloseTo(612);
    expect(page.height).toBeCloseTo(792);
    const texts = page.ops.filter((op) => op.kind === 'text');
    // With no data a field prints nothing, as the Preview's first view: the title alone is text.
    expect(texts).toEqual([expect.objectContaining({ text: 'Invoice', font: 'Times-Bold', size: 14 })]);
    // The field's four borders in each of the five records, and the rule.
    expect(page.ops.filter((op) => op.kind === 'line')).toHaveLength(5 * 4 + 1);
  });

  it('writes a PDF of its pages with the words in it, and nothing when no band can be read', async () => {
    const drawn = await draftPdf(REPORT, 'invoice.repx');
    expect(drawn?.pages).toBe(1);
    const text = new TextDecoder('latin1').decode(drawn!.bytes);
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain(winAnsiHex('Invoice'));
    expect(await draftPdf('<XtraReportsLayoutSerializer Ref="1" />', 'empty.repx')).toBeNull();
  });
});
