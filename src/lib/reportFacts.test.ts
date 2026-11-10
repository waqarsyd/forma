/**
 * The facts of the open report, counted in code (2026-11-10, the AI accuracy
 * programme, batch AG, items 21 and 24). The report is made up: a customer
 * list grouped by region with a sum and a count, reading a made-up database
 * through the data source Forma writes (lib/repxSqlWriter.ts).
 */
import { describe, expect, it } from 'vitest';
import { readSchemaScript } from './sqlSchema';
import { writeSqlDataSource } from './repxSqlWriter';
import { answerFromFacts, dataFieldsOf, factsBlock, fieldsInExpression, inventedFields, inventedNote, reportFacts } from './reportFacts';

const HEAD = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a" Name="Customers" DisplayName="Customers by region" PaperKind="A4" Landscape="true" PageWidth="1169" PageHeight="827" Version="20.1" Dpi="100">`;
const label = (ref: number, name: string, expression: string, summary = '') =>
  `<Item${ref} Ref="${ref + 10}" ControlType="XRLabel" Name="${name}" SizeF="150,20" Dpi="100">${summary}<ExpressionBindings><Item1 Ref="${ref + 50}" EventName="BeforePrint" PropertyName="Text" Expression="${expression}" /></ExpressionBindings></Item${ref}>`;
const REPORT = `${HEAD}
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" Dpi="100" />
    <Item2 Ref="3" ControlType="GroupHeaderBand" Name="GroupHeader1" HeightF="25" Dpi="100"><GroupFields><Item1 Ref="4" FieldName="Region" /></GroupFields><Controls>${label(1, 'labelRegion', '[Region]')}</Controls></Item2>
    <Item3 Ref="5" ControlType="DetailBand" Name="Detail" HeightF="25" Dpi="100"><Controls>${label(2, 'labelCompany', '[CompanyName]')}${label(3, 'labelCity', '[City] + \', \' + [Region]')}</Controls></Item3>
    <Item4 Ref="6" ControlType="GroupFooterBand" Name="GroupFooter1" HeightF="25" Dpi="100"><Controls>${label(4, 'labelCount', 'sumCount([CustomerID])', '<Summary Ref="90" Running="Group" />')}</Controls></Item4>
    <Item5 Ref="7" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="25" Dpi="100"><Controls>${label(5, 'labelTotal', 'sumSum([Credit])', '<Summary Ref="91" Running="Report" />')}</Controls></Item5>
    <Item6 Ref="8" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" Dpi="100" />
  </Bands>
</XtraReportsLayoutSerializer>`;

const schema = readSchemaScript(
  'CREATE TABLE dbo.Customers (CustomerID int PRIMARY KEY, CompanyName nvarchar(80) NOT NULL, City nvarchar(40) NULL, Region nvarchar(20) NULL, Credit decimal(10,2) NULL, Phone nvarchar(24) NULL);',
  'FormaSample',
)!;
const WITH_DATA = writeSqlDataSource(REPORT, {
  connectionName: 'FormaSample',
  schema,
  query: { kind: 'table', object: 'dbo.Customers', columns: [], joins: [], sort: [] },
}).xml;

describe('the facts of a report', () => {
  it('counts its bands, controls, fields, totals, groups and paper from the file', () => {
    const f = reportFacts(REPORT);
    expect(f.title).toBe('Customers by region');
    expect([f.paper, f.landscape]).toEqual(['A4', true]);
    expect(f.bands).toEqual(['TopMargin', 'GroupHeader', 'Detail', 'GroupFooter', 'ReportFooter', 'BottomMargin']);
    expect(f.groups).toEqual(['Region']);
    expect(f.controls).toBe(5);
    expect(f.byType).toEqual({ XRLabel: 5 });
    expect(f.printed).toEqual(['Region', 'CompanyName', 'City', 'CustomerID', 'Credit']);
    expect(f.totals).toEqual([
      { control: 'labelCount', band: 'GroupFooter', func: 'Count', field: 'CustomerID', scope: 'Group' },
      { control: 'labelTotal', band: 'ReportFooter', func: 'Sum', field: 'Credit', scope: 'Report' },
    ]);
    // With no data source, nothing says what the data is.
    expect(f.dataFields).toBeNull();
  });

  it('reads the data a report declares, and a database App knows', () => {
    expect(dataFieldsOf(WITH_DATA)).toEqual(expect.arrayContaining(['CustomerID', 'CompanyName', 'City', 'Region', 'Credit', 'Phone']));
    expect(dataFieldsOf(REPORT, ['Region', 'Total'])).toEqual(['Region', 'Total']);
  });

  it('reads an expression’s fields, never a parameter or a string', () => {
    expect(fieldsInExpression("[Qty] * [Price] + ?Rate + [Parameters.Tax] + '[not a field]'")).toEqual(['Qty', 'Price']);
  });

  it('tells the AI the numbers and names to use', () => {
    const block = factsBlock(reportFacts(WITH_DATA));
    expect(block).toMatch(/^FACTS, counted from the file by Forma/);
    expect(block).toMatch(/6 bands: top margin, group header, detail, group footer, report footer, bottom margin; 5 controls/);
    expect(block).toMatch(/The data's fields: .*\[Phone\]\. Name no other field/);
    expect(block).toMatch(/the count of \[CustomerID\] in the group footer, over each group; the sum of \[Credit\] in the report footer, over the whole report/);
    expect(factsBlock(reportFacts(REPORT))).toMatch(/declares no data source, so the data is not known/);
  });
});

describe('a question answered with no AI', () => {
  const f = reportFacts(WITH_DATA);

  it('answers what the report prints, and what its data has besides', () => {
    const answer = answerFromFacts('Which fields does this report use?', f)!;
    expect(answer).toMatch(/^It prints 5 fields: \[Region\], \[CompanyName\], \[City\], \[CustomerID\], \[Credit\]\. Its data has 6 fields; not printed: \[Phone\]\./);
    expect(answer).toMatch(/Counted from the report file by Forma, with no AI\._$/);
  });

  it('answers its totals, groups, bands, parameters, controls and paper', () => {
    expect(answerFromFacts('what totals does it have?', f)).toMatch(/^2 totals: the count of \[CustomerID\]/);
    expect(answerFromFacts('Is it grouped?', f)).toMatch(/^It is grouped by \[Region\]\./);
    expect(answerFromFacts('how many bands are there', f)).toMatch(/^It has 6 bands:/);
    expect(answerFromFacts('Does it have parameters?', f)).toMatch(/^It has no parameters\./);
    expect(answerFromFacts('How many labels are on it?', f)).toMatch(/^It has 5 controls: 5 Label\./);
    expect(answerFromFacts('What paper is it on?', f)).toMatch(/^It prints on A4, landscape\./);
  });

  it('leaves a change, or anything the facts do not hold, to the AI', () => {
    expect(answerFromFacts('Can you add a total of Credit?', f)).toBeNull();
    expect(answerFromFacts('Make the fields bold', f)).toBeNull();
    expect(answerFromFacts('Group it by city please', f)).toBeNull();
    expect(answerFromFacts('What does this report show the reader?', f)).toBeNull();
    expect(answerFromFacts('fields', f)).toBeNull();
  });

  // Found by the chat judge's dry run (batch AH, 2026-11-10): one of a set is not the set.
  it('leaves a question about one column, band, total or parameter to the AI', () => {
    expect(answerFromFacts('What does the Margin column show?', f)).toBeNull();
    expect(answerFromFacts('What is in the detail band?', f)).toBeNull();
    expect(answerFromFacts('What does the Region parameter do?', f)).toBeNull();
    expect(answerFromFacts('Why is the total blank?', f)).toBeNull();
    expect(answerFromFacts('Does it have a total?', f)).toMatch(/^2 totals/);
    expect(answerFromFacts('How many columns does it print?', f)).toMatch(/^It prints 5 fields/);
  });
});

describe('a field the data does not have', () => {
  it('is named when the data is known, and only then', () => {
    expect(inventedFields('I bound it to [Phone] and [Discount], beside [Region].', reportFacts(WITH_DATA))).toEqual(['Discount']);
    expect(inventedFields('I bound it to [Discount].', reportFacts(REPORT))).toEqual([]);
    expect(inventedNote(['Discount'])).toBe("Note: this report's data has no field [Discount], so it would print nothing.");
    expect(inventedNote([])).toBe('');
  });
});
