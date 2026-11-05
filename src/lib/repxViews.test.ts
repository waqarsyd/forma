/**
 * The Mockup, the Spec and the title read off the REPX (2026-11-05), which the
 * AI wrote beside it until then. What matters: the Mockup draws where the
 * AI's layout used to (x from the paper's edge, the top margin carried by the
 * first section), every band is there under its own name, a field prints as
 * `[Field]`, and a picture is cropped from the upload only where the page still
 * matches the source.
 */
import { describe, expect, it } from 'vitest';
import { layoutFromRepx, reportTitleOf, specFromRepx } from './repxViews';

const REPX = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Report1" ReportUnit="HundredthsOfAnInch" Margins="50, 40, 30, 20" PaperKind="A4" PageWidth="827" PageHeight="1169" Version="20.1">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="30" />
    <Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="100">
      <Controls>
        <Item1 Ref="4" ControlType="XRLabel" Name="title" Text="Sales by Region" LocationFloat="0,10" SizeF="400,40" Font="Arial, 18pt, style=Bold" />
        <Item2 Ref="5" ControlType="XRLabel" Name="sub" Text="Quarter 3" LocationFloat="0,55" SizeF="200,20" Font="Arial, 10pt" ForeColor="128, 128, 128" />
        <Item3 Ref="6" ControlType="XRPictureBox" Name="logo" LocationFloat="600,0" SizeF="100,80" />
      </Controls>
    </Item2>
    <Item3 Ref="7" ControlType="PageHeaderBand" Name="PageHeader" HeightF="25">
      <Controls>
        <Item1 Ref="8" ControlType="XRTable" Name="head" LocationFloat="0,0" SizeF="700,25" Borders="Bottom">
          <Rows>
            <Item1 Ref="9" ControlType="XRTableRow" Name="headRow" Weight="1">
              <Cells>
                <Item1 Ref="10" ControlType="XRTableCell" Name="headCustomer" Text="Customer" Weight="2" Font="Arial, 9pt, style=Bold" />
                <Item2 Ref="11" ControlType="XRTableCell" Name="headAmount" Text="Amount" Weight="1" TextAlignment="MiddleRight" Font="Arial, 9pt, style=Bold" />
              </Cells>
            </Item1>
          </Rows>
        </Item1>
      </Controls>
    </Item3>
    <Item4 Ref="12" ControlType="GroupHeaderBand" Name="GroupHeader1" HeightF="20">
      <GroupFields>
        <Item1 Ref="13" FieldName="Region" />
      </GroupFields>
      <Controls>
        <Item1 Ref="14" ControlType="XRLabel" Name="region" LocationFloat="0,0" SizeF="300,20" Font="Arial, 10pt, style=Bold">
          <ExpressionBindings>
            <Item1 Ref="15" EventName="BeforePrint" PropertyName="Text" Expression="[Region]" />
          </ExpressionBindings>
        </Item1>
      </Controls>
    </Item4>
    <Item5 Ref="16" ControlType="DetailBand" Name="Detail" HeightF="20">
      <Controls>
        <Item1 Ref="17" ControlType="XRTable" Name="row" LocationFloat="0,0" SizeF="700,20">
          <Rows>
            <Item1 Ref="18" ControlType="XRTableRow" Name="dataRow" Weight="1">
              <Cells>
                <Item1 Ref="19" ControlType="XRTableCell" Name="cellCustomer" Weight="2">
                  <ExpressionBindings>
                    <Item1 Ref="20" EventName="BeforePrint" PropertyName="Text" Expression="[Customer]" />
                  </ExpressionBindings>
                </Item1>
                <Item2 Ref="21" ControlType="XRTableCell" Name="cellAmount" Weight="1" TextAlignment="MiddleRight">
                  <ExpressionBindings>
                    <Item1 Ref="22" EventName="BeforePrint" PropertyName="Text" Expression="[Amount]" />
                  </ExpressionBindings>
                </Item2>
              </Cells>
            </Item1>
          </Rows>
        </Item1>
      </Controls>
    </Item5>
    <Item6 Ref="23" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="60">
      <Controls>
        <Item1 Ref="24" ControlType="XRLabel" Name="total" LocationFloat="500,5" SizeF="200,20" TextAlignment="MiddleRight">
          <Summary Ref="25" Running="Report" />
          <ExpressionBindings>
            <Item1 Ref="26" EventName="BeforePrint" PropertyName="Text" Expression="sumSum([Amount])" />
          </ExpressionBindings>
        </Item1>
        <Item2 Ref="27" ControlType="XRPictureBox" Name="signature" LocationFloat="0,10" SizeF="150,40" />
      </Controls>
    </Item6>
    <Item7 Ref="28" ControlType="PageFooterBand" Name="PageFooter" HeightF="20">
      <Controls>
        <Item1 Ref="29" ControlType="XRPageInfo" Name="pageNumber" LocationFloat="500,0" SizeF="200,20" TextFormatString="Page {0} of {1}" />
      </Controls>
    </Item7>
    <Item8 Ref="30" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="20" />
  </Bands>
</XtraReportsLayoutSerializer>`;

describe('the title', () => {
  it('is the DisplayName the AI is asked to write', () => {
    expect(reportTitleOf(REPX.replace('Name="Report1"', 'Name="Report1" DisplayName="Regional Sales &amp; Returns"'))).toBe('Regional Sales & Returns');
  });

  it('is otherwise the largest text before the Detail band', () => {
    expect(reportTitleOf(REPX)).toBe('Sales by Region');
  });

  it('falls back to the report\'s Name, and to "Report" with nothing at all', () => {
    expect(reportTitleOf('<XtraReportsLayoutSerializer Name="Ledger"><Bands /></XtraReportsLayoutSerializer>')).toBe('Ledger');
    expect(reportTitleOf('')).toBe('Report');
  });
});

describe('the Mockup read off the REPX', () => {
  const layout = layoutFromRepx(REPX);
  const [header, pageHeader, group, detail, footer, pageFooter] = layout.sections;

  it('has one section per content band, in print order, the margins left out', () => {
    expect(layout.title).toBe('Sales by Region');
    // The page DevExpress prints on, which PaperKind decides (repxPaper.ts): A4 is 8.27 inches wide.
    expect(layout.pageWidth).toBeCloseTo(826.77, 2);
    expect(layout.sections.map((s) => s.name)).toEqual(['Report header', 'Page header', 'Group header', 'Detail, once per record', 'Report footer', 'Page footer']);
    expect(layout.sections.map((s) => s.type)).toEqual(['header', 'header', 'group', 'detail', 'footer', 'footer']);
  });

  it('places x from the paper\'s left edge, and carries the top margin in the first section', () => {
    expect(header.height).toBe(130);
    expect(header.elements[0]).toMatchObject({ type: 'label', content: 'Sales by Region', x: 50, y: 40, width: 400, height: 40, bold: true, fontFamily: 'Arial' });
    expect(pageHeader.height).toBe(25);
    expect(pageHeader.elements[0]).toMatchObject({ x: 50, y: 0 });
  });

  it('gives a font size in report units, as the Mockup reads it, and a colour it can draw', () => {
    expect(header.elements[0].fontSize).toBe(25);
    expect(header.elements[1].color).toBe('#808080');
  });

  it('draws a table as rows of cells by weight, and a field as [Field]', () => {
    expect(pageHeader.elements[0].rows?.[0].cells.map((c) => [c.content, c.weight, c.bold ?? false])).toEqual([['Customer', 2, true], ['Amount', 1, true]]);
    expect(detail.elements[0].rows?.[0].cells.map((c) => c.content)).toEqual(['[Customer]', '[Amount]']);
    expect(group.elements[0].content).toBe('[Region]');
    expect(footer.elements[0].content).toBe('[Amount]');
  });

  it('crops a picture from the upload only before the Detail band, where the page still matches the source', () => {
    expect(header.elements[2]).toMatchObject({ type: 'image', box2d: [26, 786, 94, 907] });
    expect(footer.elements[1].type).toBe('image');
    expect(footer.elements[1].box2d).toBeUndefined();
  });

  it('prints a page number as the report would on its first page', () => {
    expect(pageFooter.elements[0].content).toBe('Page 1 of 1');
  });

  it('leaves out what DevExpress does not print', () => {
    const hidden = layoutFromRepx(REPX.replace('Name="sub" Text="Quarter 3"', 'Name="sub" Visible="false" Text="Quarter 3"'));
    expect(hidden.sections[0].elements.map((e) => e.content)).toEqual(['Sales by Region', '']);
  });
});

describe('the Spec read off the REPX', () => {
  const spec = specFromRepx(REPX);

  it('names the paper, the margins and the fields it prints', () => {
    expect(spec).toContain('**Sales by Region**');
    expect(spec).toContain('A4, 826.8 x 1169.3 in HundredthsOfAnInch; margins 50 left, 40 right, 30 top, 20 bottom.');
    expect(spec).toContain('Prints from the fields [Region], [Customer], [Amount].');
  });

  it('goes band by band, with the grouping and the total in words', () => {
    expect(spec).toContain('**Group header**, 20 high, grouped by [Region]');
    expect(spec).toContain('**Detail, once per record**, 20 high');
    expect(spec).toContain('  - [Customer] | [Amount]');
    expect(spec).toMatch(/A label "\[Amount\]" at 500, 5, 200 x 20.*a total: sumSum\(\[Amount\]\) over the report/);
    expect(spec).toContain('- Page information "Page 1 of 2"');
  });
});
