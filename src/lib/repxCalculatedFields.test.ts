import { describe, expect, it } from 'vitest';
import { repairCalculatedFields } from './repxCalculatedFields';
import { auditRepx } from './repxAudit';
import { paginate, parseReportStructure } from './reportPreview';

/*
 * CC-04 (2026-11-11): the FastReport case, grouped by the first letter of each
 * product. The AI grouped on `GroupLetter`, declared nowhere, and DevExpress
 * printed one group of twenty; the reference report declared the letter as a
 * calculated field and printed a group for each letter.
 */
const report = (header: string, extra = '') => `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="fr29" ReportUnit="HundredthsOfAnInch" PaperKind="A4" PageWidth="827" PageHeight="1169" Margins="39, 39, 39, 39" Version="20.1">${extra}
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="39" />
    <Item2 Ref="3" ControlType="GroupHeaderBand" Name="GroupHeader1" HeightF="30">
      <GroupFields><Item1 Ref="4" FieldName="GroupLetter" /></GroupFields>
      <Controls>
        <Item1 Ref="5" ControlType="XRLabel" Name="letter" LocationFloat="0, 0" SizeF="300, 30">
          <ExpressionBindings><Item1 Ref="6" EventName="BeforePrint" PropertyName="Text" Expression="${header}" /></ExpressionBindings>
        </Item1>
      </Controls>
    </Item2>
    <Item3 Ref="7" ControlType="DetailBand" Name="Detail" HeightF="20">
      <Controls>
        <Item1 Ref="8" ControlType="XRLabel" Name="name" LocationFloat="0, 0" SizeF="400, 20">
          <ExpressionBindings><Item1 Ref="9" EventName="BeforePrint" PropertyName="Text" Expression="[ProductName]" /></ExpressionBindings>
        </Item1>
        <Item2 Ref="10" ControlType="XRLabel" Name="price" LocationFloat="400, 0" SizeF="100, 20">
          <ExpressionBindings><Item1 Ref="11" EventName="BeforePrint" PropertyName="Text" Expression="[UnitPrice]" /></ExpressionBindings>
        </Item2>
      </Controls>
    </Item3>
    <Item4 Ref="12" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="39" />
  </Bands>
</XtraReportsLayoutSerializer>`;

const PRODUCTS = ['Tofu', 'Chai', 'Aniseed Syrup', 'Chang', "Chef Anton's Cajun Seasoning", "Grandma's Boysenberry Spread", "Uncle Bob's Organic Dried Pears", 'Northwoods Cranberry Sauce', 'Mishi Kobe Niku', 'Ikura', 'Queso Cabrales', 'Queso Manchego La Pastora', 'Konbu', 'Genen Shouyu', 'Pavlova', 'Alice Mutton', 'Carnarvon Tigers', 'Teatime Chocolate Biscuits', "Sir Rodney's Marmalade", "Chef Anton's Gumbo Mix"];
const rows = PRODUCTS.map((ProductName, i) => ({ ProductName, UnitPrice: String(10 + i) }));

const groupsPrinted = (xml: string) =>
  paginate(parseReportStructure(xml), rows.length, { rows }).pages.flatMap((p) => p.bands).filter((b) => b.band.kind === 'GroupHeader').length;

describe('repairCalculatedFields (CC-04)', () => {
  it('declares the group field as the expression its header prints, before the bands', () => {
    const before = report('Upper(Substring([ProductName], 0, 1))');
    expect(groupsPrinted(before)).toBe(1);
    const r = repairCalculatedFields(before);
    expect(r.applied).toBe(true);
    expect(r.declared).toEqual(['GroupLetter']);
    expect(r.xml).toContain('<CalculatedFields><Item1 Ref="13" Name="GroupLetter" Expression="Upper(Substring([ProductName], 0, 1))" /></CalculatedFields><Bands>');
    // One group per first letter: twelve among these twenty products (A, C, G, I, K, M, N, P, Q, S, T, U).
    expect(groupsPrinted(r.xml)).toBe(12);
    expect(auditRepx(r.xml).findings.map((f) => f.code)).not.toContain('field-unknown');
    expect(auditRepx(before).findings.map((f) => f.code)).toContain('field-unknown');
  });

  it('adds to a CalculatedFields block already there', () => {
    const r = repairCalculatedFields(report('Substring([ProductName], 0, 1)', '<CalculatedFields><Item1 Ref="99" Name="Other" Expression="[UnitPrice] * 2" /></CalculatedFields>'));
    expect(r.applied).toBe(true);
    expect(r.xml).toMatch(/<Item1 Ref="99" Name="Other"[^>]*\/><Item2 Ref="100" Name="GroupLetter" Expression="Substring\(\[ProductName\], 0, 1\)" \/><\/CalculatedFields>/);
  });

  it('declines an expression DevExpress cannot read, a bare field, a total and a field the data lacks', () => {
    // The AI's own header, which printed blank.
    expect(repairCalculatedFields(report('[ProductName].Substring(0, 1)')).applied).toBe(false);
    expect(repairCalculatedFields(report('[ProductName]')).applied).toBe(false);
    expect(repairCalculatedFields(report('sumCount([ProductName])')).applied).toBe(false);
    expect(repairCalculatedFields(report('Substring([Category], 0, 1)')).applied).toBe(false);
    // With the data's fields known, a field it has is not declared over.
    expect(repairCalculatedFields(report('Substring([ProductName], 0, 1)'), { fields: ['ProductName', 'UnitPrice', 'GroupLetter'] }).applied).toBe(false);
  });

  it("declares the field in the report's own data member, as the serializer writes it (emit-calc)", () => {
    const bound = report('Upper(Substring([ProductName], 0, 1))').replace('Name="fr29"', 'Name="fr29" DataMember="Products" DataSource="#Ref-0"');
    const r = repairCalculatedFields(bound, { fields: ['ProductName', 'UnitPrice'] });
    expect(r.applied).toBe(true);
    expect(r.xml).toContain('<Item1 Ref="13" Name="GroupLetter" Expression="Upper(Substring([ProductName], 0, 1))" DataMember="Products" />');
    // DataSource is the report's own, which the serializer leaves out.
    expect(r.xml).not.toMatch(/Name="GroupLetter"[^>]*DataSource=/);
  });

  it('with no schema, takes only a derivation, never a caption over another field', () => {
    // A group on a column printed nowhere, with a captioned header: CustomerID may be real.
    const captioned = report("'Customer: ' + [ProductName]").replace('FieldName="GroupLetter"', 'FieldName="CustomerID"');
    expect(repairCalculatedFields(captioned).applied).toBe(false);
    expect(repairCalculatedFields(report('[ProductName] + [UnitPrice]')).applied).toBe(false);
    // With the schema saying CustomerID is not a column, the same header is taken.
    expect(repairCalculatedFields(captioned, { fields: ['ProductName', 'UnitPrice'] }).applied).toBe(true);
  });

  it('leaves a report with no groups, or groups on a known field, alone', () => {
    const known = report('Substring([ProductName], 0, 1)').replace('FieldName="GroupLetter"', 'FieldName="ProductName"');
    expect(repairCalculatedFields(known)).toMatchObject({ applied: false, xml: known });
    expect(repairCalculatedFields('').applied).toBe(false);
  });
});
