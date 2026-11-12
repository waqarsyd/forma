import { describe, expect, it } from 'vitest';
import { frxToRepx, importForeign, parseXml, rdlToRepx, rdlValue, reportName } from './importForeign';
import { repairRepx } from './repairChain';
import { auditRepx } from './repxAudit';
import { parseReportStructure } from './reportPreview';
import { lengthToPoints } from './reportGeometry';

/** A made-up SSRS 2016 report: a title, a table with a heading, a group, details and a total, page number in the footer. */
const RDL_2016 = `<?xml version="1.0" encoding="utf-8"?>
<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition" xmlns:rd="http://schemas.microsoft.com/SQLServer/reporting/reportdesigner">
  <ReportSections>
    <ReportSection>
      <Body>
        <ReportItems>
          <Textbox Name="Title">
            <Paragraphs><Paragraph><TextRuns><TextRun><Value>Sales &amp; returns</Value><Style><FontFamily>Segoe UI</FontFamily><FontSize>16pt</FontSize><FontWeight>Bold</FontWeight></Style></TextRun></TextRuns><Style><TextAlign>Center</TextAlign></Style></Paragraph></Paragraphs>
            <Top>0in</Top><Left>0in</Left><Height>0.4in</Height><Width>6in</Width>
          </Textbox>
          <Tablix Name="Orders">
            <TablixBody>
              <TablixColumns>
                <TablixColumn><Width>3in</Width></TablixColumn>
                <TablixColumn><Width>1.5in</Width></TablixColumn>
                <TablixColumn><Width>1.5in</Width></TablixColumn>
              </TablixColumns>
              <TablixRows>
                <TablixRow><Height>0.25in</Height><TablixCells>
                  <TablixCell><CellContents><Textbox Name="HeadProduct"><Paragraphs><Paragraph><TextRuns><TextRun><Value>Product</Value></TextRun></TextRuns></Paragraph></Paragraphs><Style><Border><Style>Solid</Style></Border></Style></Textbox></CellContents></TablixCell>
                  <TablixCell><CellContents><Textbox Name="HeadQty"><Paragraphs><Paragraph><TextRuns><TextRun><Value>Qty</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>
                  <TablixCell><CellContents><Textbox Name="HeadAmount"><Paragraphs><Paragraph><TextRuns><TextRun><Value>Amount</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>
                </TablixCells></TablixRow>
                <TablixRow><Height>0.25in</Height><TablixCells>
                  <TablixCell><CellContents><Textbox Name="RegionName"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Fields!Region.Value</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox><ColSpan>3</ColSpan></CellContents></TablixCell>
                </TablixCells></TablixRow>
                <TablixRow><Height>0.2in</Height><TablixCells>
                  <TablixCell><CellContents><Textbox Name="Product"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Fields!Product.Value</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>
                  <TablixCell><CellContents><Textbox Name="Qty"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Fields!Qty.Value</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>
                  <TablixCell><CellContents><Textbox Name="Amount"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Fields!Amount.Value * 1.0</Value></TextRun></TextRuns><Style><TextAlign>Right</TextAlign></Style></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>
                </TablixCells></TablixRow>
                <TablixRow><Height>0.25in</Height><TablixCells>
                  <TablixCell><CellContents><Textbox Name="RegionTotalLabel"><Paragraphs><Paragraph><TextRuns><TextRun><Value>="Total for " &amp; Fields!Region.Value</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox><ColSpan>2</ColSpan></CellContents></TablixCell>
                  <TablixCell><CellContents><Textbox Name="RegionTotal"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Sum(Fields!Amount.Value)</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>
                </TablixCells></TablixRow>
                <TablixRow><Height>0.3in</Height><TablixCells>
                  <TablixCell><CellContents><Textbox Name="GrandLabel"><Paragraphs><Paragraph><TextRuns><TextRun><Value>Grand total</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox><ColSpan>2</ColSpan></CellContents></TablixCell>
                  <TablixCell><CellContents><Textbox Name="GrandTotal"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Sum(Fields!Amount.Value)</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>
                </TablixCells></TablixRow>
              </TablixRows>
            </TablixBody>
            <TablixColumnHierarchy><TablixMembers><TablixMember /><TablixMember /><TablixMember /></TablixMembers></TablixColumnHierarchy>
            <TablixRowHierarchy>
              <TablixMembers>
                <TablixMember><KeepWithGroup>After</KeepWithGroup></TablixMember>
                <TablixMember>
                  <Group Name="Region"><GroupExpressions><GroupExpression>=Fields!Region.Value</GroupExpression></GroupExpressions></Group>
                  <TablixMembers>
                    <TablixMember><KeepWithGroup>After</KeepWithGroup></TablixMember>
                    <TablixMember><Group Name="Details" /></TablixMember>
                    <TablixMember><KeepWithGroup>Before</KeepWithGroup></TablixMember>
                  </TablixMembers>
                </TablixMember>
                <TablixMember><KeepWithGroup>Before</KeepWithGroup></TablixMember>
              </TablixMembers>
            </TablixRowHierarchy>
            <DataSetName>Orders</DataSetName>
            <Top>0.6in</Top><Left>0in</Left><Height>1.25in</Height><Width>6in</Width>
          </Tablix>
          <Textbox Name="Note">
            <Paragraphs><Paragraph><TextRuns><TextRun><Value>=Code.Signature()</Value></TextRun></TextRuns></Paragraph></Paragraphs>
            <Top>2.1in</Top><Left>0in</Left><Height>0.25in</Height><Width>3in</Width>
          </Textbox>
        </ReportItems>
        <Height>2.5in</Height>
      </Body>
      <Width>6in</Width>
      <Page>
        <PageFooter>
          <Height>0.3in</Height>
          <ReportItems>
            <Textbox Name="PageNo"><Paragraphs><Paragraph><TextRuns><TextRun><Value>="Page " &amp; Globals!PageNumber &amp; " of " &amp; Globals!TotalPages</Value></TextRun></TextRuns></Paragraph></Paragraphs><Top>0in</Top><Left>4in</Left><Height>0.25in</Height><Width>2in</Width></Textbox>
          </ReportItems>
        </PageFooter>
        <PageHeight>29.7cm</PageHeight>
        <PageWidth>21cm</PageWidth>
        <LeftMargin>2cm</LeftMargin><RightMargin>2cm</RightMargin><TopMargin>2cm</TopMargin><BottomMargin>2cm</BottomMargin>
      </Page>
    </ReportSection>
  </ReportSections>
</Report>`;

/** A made-up SSRS 2005 report: a Table with a header, details and footer. */
const RDL_2005 = `<?xml version="1.0" encoding="utf-8"?>
<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2005/01/reportdefinition">
  <Body>
    <ReportItems>
      <Table Name="People">
        <TableColumns><TableColumn><Width>2in</Width></TableColumn><TableColumn><Width>1in</Width></TableColumn></TableColumns>
        <Header><TableRows><TableRow><Height>0.25in</Height><TableCells>
          <TableCell><ReportItems><Textbox Name="h1"><Value>Name</Value><Style><FontWeight>Bold</FontWeight></Style></Textbox></ReportItems></TableCell>
          <TableCell><ReportItems><Textbox Name="h2"><Value>Age</Value></Textbox></ReportItems></TableCell>
        </TableCells></TableRow></TableRows></Header>
        <Details><TableRows><TableRow><Height>0.2in</Height><TableCells>
          <TableCell><ReportItems><Textbox Name="d1"><Value>=Fields!Name.Value</Value></Textbox></ReportItems></TableCell>
          <TableCell><ReportItems><Textbox Name="d2"><Value>=Fields!Age.Value</Value></Textbox></ReportItems></TableCell>
        </TableCells></TableRow></TableRows></Details>
        <Footer><TableRows><TableRow><Height>0.25in</Height><TableCells>
          <TableCell><ReportItems><Textbox Name="f1"><Value>Count</Value></Textbox></ReportItems></TableCell>
          <TableCell><ReportItems><Textbox Name="f2"><Value>=Count(Fields!Name.Value)</Value></Textbox></ReportItems></TableCell>
        </TableCells></TableRow></TableRows></Footer>
        <Top>0in</Top><Left>0in</Left>
      </Table>
    </ReportItems>
    <Height>1in</Height>
  </Body>
  <PageHeight>11in</PageHeight><PageWidth>8.5in</PageWidth>
  <LeftMargin>1in</LeftMargin><RightMargin>1in</RightMargin><TopMargin>1in</TopMargin><BottomMargin>1in</BottomMargin>
</Report>`;

/** A made-up FastReport report in the demos' form: a title, a data band with a total in the summary. */
const FRX = `<?xml version="1.0" encoding="utf-8"?>
<Report ScriptLanguage="CSharp" ReportInfo.Name="Products">
  <Dictionary>
    <Total Name="TotalPrice" Expression="[Products.UnitPrice]" Evaluator="Data1"/>
  </Dictionary>
  <ReportPage Name="Page1" PaperWidth="210" PaperHeight="297" LeftMargin="10" RightMargin="10" TopMargin="10" BottomMargin="10">
    <ReportTitleBand Name="ReportTitle1" Width="718.2" Height="37.8">
      <TextObject Name="Text1" Width="718.2" Height="28.35" Text="PRODUCT LIST" HorzAlign="Center" Font="Tahoma, 14pt, style=Bold"/>
    </ReportTitleBand>
    <DataBand Name="Data1" Top="41.8" Width="718.2" Height="18.9">
      <TextObject Name="Text2" Width="300" Height="18.9" Text="[Products.ProductName]"/>
      <TextObject Name="Text3" Left="600" Width="118.2" Height="18.9" Text="[Products.UnitPrice]" HorzAlign="Right"/>
    </DataBand>
    <ReportSummaryBand Name="Summary1" Top="64.7" Width="718.2" Height="18.9">
      <TextObject Name="Text4" Left="600" Width="118.2" Height="18.9" Text="[TotalPrice]" HorzAlign="Right"/>
    </ReportSummaryBand>
  </ReportPage>
</Report>`;

const controls = (xml: string) => parseReportStructure(xml).bands.flatMap((b) => b.controls.map((c) => ({ band: b.kind, ...c })));

describe('parseXml', () => {
  it('keeps text, CDATA and decoded entities', () => {
    const root = parseXml('<a x="1 &amp; 2"><b>one &lt; two</b><c><![CDATA[<raw>]]></c></a>');
    expect(root?.attrs.x).toBe('1 & 2');
    expect(root?.children.map((c) => c.text)).toEqual(['one < two', '<raw>']);
  });

  // The re-audit's R5-07: fromCodePoint threw on these, and the drop lost every file after this one.
  it('reads a reference to no character XML may hold as a replacement character, without throwing', () => {
    const root = parseXml('<a t="&#x110000;">&#xD800;&#0;&#1;ok&#x1F600;</a>');
    const bad = String.fromCharCode(0xfffd);
    expect(root?.attrs.t).toBe(bad);
    expect(root?.text).toBe(`${bad}${bad}${bad}ok${String.fromCodePoint(0x1f600)}`);
    // A raw control character is taken out, as no XML may hold one.
    expect(parseXml('<a>x\u0001y</a>')?.text).toBe('xy');
  });

  // 2026-11-12 (CodeQL js/incomplete-multi-character-sanitization): comments were stripped before
  // anything was read, so a "<!--" inside a CDATA section or a processing instruction took
  // everything up to the next comment's end with it.
  it('skips a comment where it starts, not inside a CDATA section or a processing instruction', () => {
    const root = parseXml('<?xml version="1.0"?><!DOCTYPE a><a><b><![CDATA[x <!-- y ]]></b><?pi <!-- ?><c>kept</c><!-- note --><d>too</d></a>');
    expect(root?.children.map((c) => [c.name, c.text])).toEqual([['b', 'x <!-- y '], ['c', 'kept'], ['d', 'too']]);
  });
});

describe('lengthToPoints', () => {
  it('reads the units an SSRS file writes', () => {
    expect(lengthToPoints('1in')).toBe(72);
    expect(lengthToPoints('2.54cm')).toBeCloseTo(72);
    expect(lengthToPoints('25.4mm')).toBeCloseTo(72);
    expect(lengthToPoints('12pt')).toBe(12);
    expect(lengthToPoints('1pc')).toBe(12);
    expect(lengthToPoints('10')).toBe(10);
    expect(lengthToPoints('wide')).toBeNull();
  });
});

describe('rdlValue', () => {
  it('converts fields, parameters, totals, strings and page numbers', () => {
    expect(rdlValue('Invoice')).toEqual({ text: 'Invoice' });
    expect(rdlValue('=Fields!Amount.Value')).toEqual({ expression: '[Amount]', aggregate: false });
    expect(rdlValue('=Parameters!From.Value')).toEqual({ expression: '?From', aggregate: false });
    expect(rdlValue('=Sum(Fields!Amount.Value, "Orders")')).toEqual({ expression: 'sumSum([Amount])', aggregate: true });
    expect(rdlValue('="Total: " & Fields!Amount.Value')).toEqual({ expression: "'Total: ' + [Amount]", aggregate: false });
    expect(rdlValue(`="O'Brien & sons"`)).toEqual({ expression: "'O''Brien & sons'", aggregate: false });
    expect(rdlValue('=IIf(Fields!Qty.Value > 0, "yes", "no")')).toEqual({ expression: "Iif([Qty] > 0, 'yes', 'no')", aggregate: false });
    expect(rdlValue('=Globals!PageNumber')).toEqual({ pageInfo: 'Number' });
    expect(rdlValue('="Page " & Globals!PageNumber & " of " & Globals!TotalPages')).toEqual({ pageInfo: 'NumberOfTotal', format: 'Page {0} of {1}' });
  });

  it('leaves what DevExpress cannot read as the text it is', () => {
    expect(rdlValue('=Code.Signature()')).toEqual({ unconverted: '=Code.Signature()' });
    expect(rdlValue('=ReportItems!Total.Value')).toEqual({ unconverted: '=ReportItems!Total.Value' });
    expect(rdlValue('=Format(Fields!Date.Value, "d")')).toEqual({ unconverted: '=Format(Fields!Date.Value, "d")' });
  });

  // The re-audit's R3-03: the usual footer printed its formula, and a page of a total was always in English.
  it('reads a page number or a page of a total with its own words', () => {
    expect(rdlValue('="Page " & Globals!PageNumber')).toEqual({ pageInfo: 'Number', format: 'Page {0}' });
    expect(rdlValue('="Seite " & Globals!PageNumber & " von " & Globals!TotalPages')).toEqual({ pageInfo: 'NumberOfTotal', format: 'Seite {0} von {1}' });
    expect(rdlValue('=Globals!TotalPages')).toEqual({ pageInfo: 'NumberOfTotal', format: '{1}' });
    expect(rdlValue('=Globals!OverallPageNumber & " / " & Globals!OverallTotalPages')).toEqual({ pageInfo: 'NumberOfTotal', format: '{0} / {1}' });
    // Several runs of a text box are joined in brackets (boxValue); braces in the words are doubled.
    expect(rdlValue('="{Page} " & (Globals!PageNumber) & ("" & " of ") & (Globals!TotalPages)')).toEqual({ pageInfo: 'NumberOfTotal', format: '{{Page}} {0} of {1}' });
    expect(rdlValue('="Printed " & Globals!ExecutionTime')).toEqual({ pageInfo: 'DateTime', format: 'Printed {0}' });
    expect(rdlValue('=Globals!ExecutionTime')).toEqual({ pageInfo: 'DateTime' });
  });

  it('leaves a page number joined to anything else printing as written', () => {
    for (const value of ['="Page " & Globals!PageNumber & " for " & Fields!Name.Value', '=Globals!PageNumber + 1', '="Page " & Globals!PageNumber & Globals!ExecutionTime', '=Globals!ReportName & Globals!PageNumber']) {
      expect(rdlValue(value)).toEqual({ unconverted: value });
    }
  });
});

describe('rdlToRepx', () => {
  const made = rdlToRepx(RDL_2016, 'Sales Summary.rdl');
  if ('skipped' in made) throw new Error(made.skipped);

  it('writes a report DevExpress opens, on the page the file names', () => {
    // checkRepx needs a browser's DOMParser; the file is read back here instead.
    expect(parseXml(made.repx)?.name).toBe('XtraReportsLayoutSerializer');
    // 21 by 29.7 cm, margins of 2 cm, in hundredths of an inch; the paper's
    // name is the repair's (below), so until then DevExpress would read Letter.
    expect(made.repx).toContain('Margins="79, 79, 79, 79" PageWidth="827" PageHeight="1169"');
    expect(made.repx).toContain('Name="Sales_Summary"');
  });

  it('puts each row of the table in the band that prints it', () => {
    const s = parseReportStructure(made.repx);
    expect(s.bands.map((b) => b.kind)).toEqual(['TopMargin', 'ReportHeader', 'GroupHeader', 'Detail', 'GroupFooter', 'ReportFooter', 'PageFooter', 'BottomMargin']);
    expect(made.repx).toMatch(/<GroupFields><Item1 Ref="\d+" FieldName="Region" \/><\/GroupFields>/);
    const all = controls(made.repx);
    const title = all.find((c) => c.name === 'Title')!;
    expect(title.band).toBe('ReportHeader');
    expect(title.text).toBe('Sales & returns');
    expect(title.fontSize).toBe(16);
    expect(title.bold).toBe(true);
    expect(title.align).toBe('center');
    // The heading row sits below the title, at the table's own top: 0.6 in.
    const heading = all.find((c) => c.band === 'ReportHeader' && c.type === 'XRTable')!;
    expect(heading.y).toBe(60);
    expect(heading.rows[0].cells.map((c) => c.text)).toEqual(['Product', 'Qty', 'Amount']);
    expect(heading.rows[0].cells.map((c) => c.weight)).toEqual([300, 150, 150]);
  });

  it('binds fields and totals, with the running scope of their band', () => {
    expect(made.repx).toContain('Expression="[Product]"');
    expect(made.repx).toContain('Expression="[Amount] * 1.0"');
    expect(made.repx).toContain('Expression="&apos;Total for &apos; + [Region]"');
    expect(made.repx.match(/Expression="sumSum\(\[Amount\]\)"/g)).toHaveLength(2);
    expect(made.repx).toMatch(/<Summary Ref="\d+" Running="Group" \/>/);
    expect(made.repx).toMatch(/<Summary Ref="\d+" Running="Report" \/>/);
    expect(made.repx).toMatch(/ControlType="XRPageInfo" Name="PageNo" PageInfo="NumberOfTotal" TextFormatString="Page \{0\} of \{1\}"/);
  });

  it('keeps what sits below the table under its total row, and counts a formula it could not read', () => {
    const note = controls(made.repx).find((c) => c.name === 'Note')!;
    expect(note.band).toBe('ReportFooter');
    // 2.1 in less the table's bottom (1.85 in), under the 0.3 in total row.
    expect(note.y).toBe(55);
    expect(note.text).toBe('=Code.Signature()');
    expect(made.unconverted).toBe(1);
  });

  it('puts an item beside the table straight under the total row, never above the footer', () => {
    const beside = RDL_2016.replace('<Textbox Name="Note">', `<Textbox Name="Side">
            <Paragraphs><Paragraph><TextRuns><TextRun><Value>Approved</Value></TextRun></TextRuns></Paragraph></Paragraphs>
            <Top>1in</Top><Left>6.5in</Left><Height>0.25in</Height><Width>1in</Width>
          </Textbox>
          <Textbox Name="Note">`);
    const out = rdlToRepx(beside, 'Sales Summary.rdl');
    if ('skipped' in out) throw new Error(out.skipped);
    const side = controls(out.repx).find((c) => c.name === 'Side')!;
    expect(side.band).toBe('ReportFooter');
    // Its top was inside the table (0.6 to 1.85 in): under the 0.3 in total row.
    expect(side.y).toBe(30);
  });

  it('comes through the repairs with no errors, the paper named', () => {
    const repaired = repairRepx(made.repx, { version: '20.1' });
    expect(repaired.xml).toContain('PaperKind="A4"');
    expect(auditRepx(repaired.xml).errors).toBe(0);
  });

  it('reads a 2005 Table the same way', () => {
    const old = rdlToRepx(RDL_2005, 'people.rdlc');
    if ('skipped' in old) throw new Error(old.skipped);
    const s = parseReportStructure(old.repx);
    expect(s.bands.map((b) => b.kind)).toEqual(['TopMargin', 'ReportHeader', 'Detail', 'ReportFooter', 'BottomMargin']);
    expect(old.repx).toContain('Expression="sumCount([Name])"');
    expect(controls(old.repx).find((c) => c.band === 'ReportHeader')!.rows[0].cells[0].bold).toBe(true);
  });

  /**
   * The re-audit's R3-02. RDL 2008 has no sections: the body and the page sit
   * on the report itself, and the page was not read, so its header, footer,
   * paper and margins were lost. 2010 introduced the sections 2016 keeps.
   */
  it('reads the page of a 2008 report, and of a 2010 one', () => {
    const rdl2008 = RDL_2016.replace('2016/01', '2008/01').replace(/<\/?ReportSections?>/g, '');
    const rdl2010 = RDL_2016.replace('2016/01', '2010/01');
    for (const [year, file] of [['2008', rdl2008], ['2010', rdl2010]] as const) {
      const out = rdlToRepx(file, `sales-${year}.rdl`);
      if ('skipped' in out) throw new Error(out.skipped);
      expect(out.repx, year).toContain('Margins="79, 79, 79, 79" PageWidth="827" PageHeight="1169"');
      expect(parseReportStructure(out.repx).bands.map((b) => b.kind), year).toContain('PageFooter');
      expect(out.repx, year).toMatch(/ControlType="XRPageInfo" Name="PageNo" PageInfo="NumberOfTotal"/);
    }
  });

  /**
   * The re-audit's R3-11: a table inside a rectangle was drawn once, rows and
   * all, in the report header, and the Detail band left empty; a 2005 matrix
   * above a table was taken for the data region and the table lost.
   */
  it('finds a table inside a rectangle, at the place the rectangle puts it', () => {
    const boxed = RDL_2016.replace('<Tablix Name="Orders">', '<Rectangle Name="Frame"><Top>0.5in</Top><Left>0.25in</Left><Height>2in</Height><Width>6in</Width><ReportItems><Tablix Name="Orders">')
      .replace('<Top>0.6in</Top><Left>0in</Left><Height>1.25in</Height><Width>6in</Width>\n          </Tablix>', '<Top>0.1in</Top><Left>0in</Left><Height>1.25in</Height><Width>6in</Width>\n          </Tablix></ReportItems></Rectangle>');
    expect(boxed).toContain('</Tablix></ReportItems></Rectangle>');
    const out = rdlToRepx(boxed, 'boxed.rdl');
    if ('skipped' in out) throw new Error(out.skipped);
    const s = parseReportStructure(out.repx);
    expect(s.bands.map((b) => b.kind)).toEqual(['TopMargin', 'ReportHeader', 'GroupHeader', 'Detail', 'GroupFooter', 'ReportFooter', 'PageFooter', 'BottomMargin']);
    const heading = controls(out.repx).find((c) => c.band === 'ReportHeader' && c.type === 'XRTable')!;
    // 0.5 in of the rectangle and 0.1 in inside it; 0.25 in from the left.
    expect(heading.y).toBe(60);
    expect(heading.x).toBe(25);
    expect(controls(out.repx).some((c) => c.band === 'Detail' && c.type === 'XRTable')).toBe(true);
    expect(controls(out.repx).some((c) => c.type === 'XRPanel')).toBe(false);
  });

  it('passes over a matrix it cannot read for the table below it, and says the matrix was left out', () => {
    const matrix = RDL_2005.replace('<ReportItems>', '<ReportItems><Matrix Name="Pivot"><Top>0in</Top><Left>0in</Left><Height>0.5in</Height><Width>3in</Width></Matrix>').replace('<Top>0in</Top><Left>0in</Left>\n      </Table>', '<Top>1in</Top><Left>0in</Left>\n      </Table>');
    const out = rdlToRepx(matrix, 'pivot.rdl');
    if ('skipped' in out) throw new Error(out.skipped);
    expect(parseReportStructure(out.repx).bands.map((b) => b.kind)).toEqual(['TopMargin', 'ReportHeader', 'Detail', 'ReportFooter', 'BottomMargin']);
    expect(out.repx).toContain('Expression="sumCount([Name])"');
    expect(out.dropped).toBe(1);
  });

  // The review of R3-11 (2026-11-12): a one-row grid in a heading rectangle above the table won, and the table printed once.
  it('takes the grid with a row per record over a one-row grid above it', () => {
    const info =
      '<Rectangle Name="Head"><Top>0.4in</Top><Left>0in</Left><Height>0.2in</Height><Width>6in</Width><ReportItems>' +
      '<Tablix Name="Info"><TablixBody><TablixColumns><TablixColumn><Width>2in</Width></TablixColumn></TablixColumns><TablixRows><TablixRow><Height>0.2in</Height><TablixCells>' +
      '<TablixCell><CellContents><Textbox Name="InfoText"><Paragraphs><Paragraph><TextRuns><TextRun><Value>Regional sales</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>' +
      '</TablixCells></TablixRow></TablixRows></TablixBody><TablixRowHierarchy><TablixMembers><TablixMember /></TablixMembers></TablixRowHierarchy>' +
      '<Top>0in</Top><Left>0in</Left><Height>0.2in</Height><Width>2in</Width></Tablix></ReportItems></Rectangle>';
    const out = rdlToRepx(RDL_2016.replace('<Tablix Name="Orders">', `${info}<Tablix Name="Orders">`), 'info.rdl');
    if ('skipped' in out) throw new Error(out.skipped);
    expect(parseReportStructure(out.repx).bands.map((b) => b.kind)).toEqual(['TopMargin', 'ReportHeader', 'GroupHeader', 'Detail', 'GroupFooter', 'ReportFooter', 'PageFooter', 'BottomMargin']);
    expect(controls(out.repx).some((c) => c.band === 'Detail' && c.type === 'XRTable')).toBe(true);
    // The heading rectangle stays a panel, its grid inside it.
    expect(out.repx).toMatch(/ControlType="XRPanel" Name="Head"[^>]*><Controls><Item1 Ref="\d+" ControlType="XRTable" Name="Info"/);
  });

  // The review of R3-03 (2026-11-12): a page number with words in a table cell was left blank, and nothing said so.
  it('prints a page number in a table cell as written, and counts it', () => {
    const cell = RDL_2016.replace('<Value>Qty</Value>', '<Value>="Page " &amp; Globals!PageNumber</Value>');
    const out = rdlToRepx(cell, 'cell.rdl');
    if ('skipped' in out) throw new Error(out.skipped);
    const heading = controls(out.repx).find((c) => c.band === 'ReportHeader' && c.type === 'XRTable')!;
    expect(heading.rows[0].cells[1].text).toBe('="Page " & Globals!PageNumber');
    expect(out.unconverted).toBe(2);
  });

  it('refuses what is not a report definition', () => {
    expect(rdlToRepx('<Workbook/>', 'x.rdl')).toEqual({ skipped: 'not a report definition' });
  });
});

describe('frxToRepx', () => {
  it('maps a FastReport report to bands, fields and its total, text kept', () => {
    const made = frxToRepx(FRX, 'Products');
    if ('skipped' in made) throw new Error(made.skipped);
    const s = parseReportStructure(made.repx);
    expect(s.bands.map((b) => b.kind)).toEqual(['TopMargin', 'ReportHeader', 'Detail', 'ReportFooter', 'BottomMargin']);
    expect(controls(made.repx).find((c) => c.band === 'ReportHeader')!.text).toBe('PRODUCT LIST');
    expect(made.repx).toContain('Expression="[ProductName]"');
    // The total sums the field its expression names, not its own name (R3-01).
    expect(made.repx).toContain('Expression="sumSum([UnitPrice])"');
    expect(made.repx).not.toContain('[TotalPrice]');
  });

  /** The re-audit's R3-01: a text's own words, its total's type, and FastReport's page and date variables. */
  const withTexts = (texts: string[], dictionary = '') =>
    FRX.replace('<Dictionary>', `<Dictionary>${dictionary}`).replace(
      '<TextObject Name="Text2"',
      `${texts.map((t, i) => `<TextObject Name="Extra${i}" Top="${i * 20}" Width="300" Height="18.9" Text="${t}"/>`).join('')}<TextObject Name="Text2"`,
    );
  const made = (texts: string[], dictionary = '') => {
    const out = frxToRepx(withTexts(texts, dictionary), 'Products');
    if ('skipped' in out) throw new Error(out.skipped);
    return out.repx;
  };

  it("keeps a text's words beside its field, and binds a total by its type", () => {
    const repx = made(
      ['Customer: [Customers.Name]', 'Items: [ItemCount]', 'Average [AvgPrice] each', 'Margin [Odd]'],
      '<Total Name="ItemCount" TotalType="Count" Evaluator="Data1"/><Total Name="AvgPrice" TotalType="Avg" Expression="[Products.UnitPrice]" Evaluator="Data1"/><Total Name="Odd" Expression="Sum([Products.UnitPrice])" Evaluator="Data1"/>',
    );
    expect(repx).toContain('Expression="&apos;Customer: &apos; + [Name]"');
    expect(repx).toContain('Expression="&apos;Items: &apos; + sumCount()"');
    expect(repx).toContain('Expression="&apos;Average &apos; + sumAvg([UnitPrice]) + &apos; each&apos;"');
    // A total whose expression is more than fields and arithmetic prints as written, not as a guess.
    expect(repx).toContain('Text="Margin [Odd]"');
  });

  it('writes the page number, the total pages and the date as page information, words kept', () => {
    const repx = made(['[Page#]', 'Page [Page#] of [TotalPages#]', '[PageNofM]', '[Date]', 'Printed [Now] {x}']);
    expect(repx).toMatch(/ControlType="XRPageInfo" Name="c\d+" PageInfo="Number" LocationFloat/);
    expect(repx).toContain('PageInfo="NumberOfTotal" TextFormatString="Page {0} of {1}"');
    expect(repx.match(/TextFormatString="Page \{0\} of \{1\}"/g)).toHaveLength(2);
    expect(repx).toContain('PageInfo="DateTime" TextFormatString="{0:d}"');
    // Braces in the words are doubled, so they print as written.
    expect(repx).toContain('PageInfo="DateTime" TextFormatString="Printed {0:g} {{x}}"');
  });

  it('puts the date beside a field as an expression, and leaves a page number beside one as written', () => {
    const repx = made(['On [Date] for [Customers.Name]', 'Page [Page#] for [Customers.Name]']);
    expect(repx).toContain("Expression=\"&apos;On &apos; + FormatString(&apos;{0:d}&apos;, Today()) + &apos; for &apos; + [Name]\"");
    expect(repx).toContain('Text="Page [Page#] for [Customers.Name]"');
  });

  // The review of R3-01 (2026-11-12): `in` found Object.prototype's names, and wrote a function's source as a format.
  it("takes no name of JavaScript's own for a page or date variable", () => {
    const repx = made(['[constructor]', 'Page [toString] of [__proto__]', '[hasOwnProperty]'], '');
    expect(repx).not.toContain('native code');
    expect(repx).not.toMatch(/ControlType="XRPageInfo" Name="Extra/);
    const bad = FRX.replace('HorzAlign="Center"', 'HorzAlign="constructor" VertAlign="toString"');
    const out = frxToRepx(bad, 'Products');
    if ('skipped' in out) throw new Error(out.skipped);
    expect(out.repx).not.toContain('native code');
    expect(out.repx).toContain('TextAlignment="TopLeft"');
  });

  it('keeps words that look like its own placeholders as written', () => {
    const repx = made(['{i} and {ref} and {running}']);
    expect(repx).toContain('Text="{i} and {ref} and {running}"');
    expect(parseReportStructure(repx).bands.some((b) => b.controls.some((c) => c.text === '{i} and {ref} and {running}'))).toBe(true);
  });
});

describe('importForeign', () => {
  it('names a report after its file, as an identifier', () => {
    expect(reportName('C:\\reports\\Sales Summary (2024).rdl')).toBe('Sales_Summary_2024');
    expect(reportName('2024.rdl')).toBe('Report_2024');
  });

  it('says what prints as written and what was left out', () => {
    const made = importForeign('sales.rdl', RDL_2016)!;
    expect(made.notices).toEqual(['"sales.rdl": one formula prints as written, because DevExpress has no direct equivalent; check it in the report.']);
    const withChart = importForeign('c.rdl', RDL_2005.replace('<ReportItems>', '<ReportItems><Chart Name="c"><Top>3in</Top></Chart>'))!;
    expect(withChart.notices).toEqual(['"c.rdl": a chart, matrix, map or subreport was left out; ask for it to be added.']);
  });

  it('opens an .frx with its paper left to the repair, and returns null for what it cannot read', () => {
    const made = importForeign('products.frx', FRX)!;
    expect(made.repx).not.toContain('PaperKind');
    expect(repairRepx(made.repx, { version: '20.1' }).xml).toContain('PaperKind="A4"');
    expect(importForeign('broken.frx', '<NotAReport/>')).toBeNull();
  });
});
