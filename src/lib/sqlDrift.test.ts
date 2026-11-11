/**
 * A report's own SQL data source, read back, kept through a redesign and
 * checked against a newer layout (2026-11-09, the SQL Server programme,
 * batch DG). Measured with `RepxProbe sql-fill` over the made-up FormaSample
 * on LocalDB: with City renamed to CityName and Qty made decimal(10,2) by a
 * script run first (`--before`), the report as written failed in DevExpress
 * ("One or more queries have failed to validate") and printed nothing; the
 * report `refreshDataSource` fixed printed all eleven lines, Qty as 2.00; and
 * the report `carryDataSource` put back after its source, parameters and
 * pointer were dropped printed the same eleven lines as the original. The
 * tables here are that made-up database's.
 */
import { describe, expect, it } from 'vitest';
import { readSchemaScript, withSamples, type SqlSchema } from './sqlSchema';
import { carryDataSource, readRepxDataSources, schemaFromRepx } from './repxSqlDataSource';
import { writeSqlDataSource } from './repxSqlWriter';
import { driftOf, mainQueryOf, mergeLayouts, queryFromRepx, refreshDataSource, specFor } from './sqlDrift';
import { auditRepx } from './repxAudit';
import type { ReportQuery } from './sqlQuery';

const LAYOUT = `
CREATE TABLE dbo.Customers (CustomerID int PRIMARY KEY, CompanyName nvarchar(80) NOT NULL, City nvarchar(40) NULL, Region nvarchar(20) NULL);
CREATE TABLE dbo.Orders (OrderID int PRIMARY KEY, CustomerID int NOT NULL REFERENCES dbo.Customers(CustomerID), OrderDate datetime NOT NULL, Freight decimal(10,2) NOT NULL);
CREATE TABLE dbo.OrderLines (OrderID int NOT NULL REFERENCES dbo.Orders(OrderID), LineNumber int NOT NULL, Product nvarchar(60) NOT NULL, Qty int NOT NULL, UnitPrice decimal(10,2) NOT NULL);
CREATE PROCEDURE dbo.usp_SalesByRegion @Region nvarchar(20) = NULL AS SELECT 1;
CREATE PROCEDURE dbo.usp_WithOut @Region nvarchar(20), @Count int AS SELECT 1;
`;
const layout = (sql: string): SqlSchema => readSchemaScript(sql, 'FormaSample')!;
const schema = layout(LAYOUT);
schema.procedures[0].result = [{ name: 'Region', type: 'nvarchar', length: 20 }, { name: 'Total', type: 'decimal', precision: 38, scale: 2 }];
schema.procedures[1].result = [{ name: 'CompanyName', type: 'nvarchar', length: 80 }];

const orders: ReportQuery = {
  kind: 'table',
  object: 'dbo.Orders',
  columns: [],
  joins: [{ table: 'dbo.Customers', type: 'Inner', on: [{ from: 'CustomerID', to: 'CustomerID' }] }],
  filter: '[Customers.Region] In (?Regions)',
  sort: [{ column: 'dbo.Orders.OrderDate', descending: true }],
  top: 100,
  details: [{ table: 'dbo.OrderLines', type: 'Inner', on: [{ from: 'OrderID', to: 'OrderID' }] }],
};

const BASE = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a" Name="R" PageWidth="850" PageHeight="1100" Version="20.1" Dpi="100">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" Dpi="100" />
    <Item2 Ref="3" ControlType="DetailBand" Name="Detail" HeightF="25" Dpi="100"><Controls><Item1 Ref="4" ControlType="XRLabel" Name="labelCity" Text="x" SizeF="150,20" Dpi="100"><ExpressionBindings><Item1 Ref="5" EventName="BeforePrint" PropertyName="Text" Expression="[City]" /></ExpressionBindings></Item1></Controls></Item2>
    <Item3 Ref="6" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" Dpi="100" />
  </Bands>
</XtraReportsLayoutSerializer>`;

const report = writeSqlDataSource(BASE, {
  connectionName: 'FormaSample',
  schema,
  query: orders,
  multiValue: ['Regions'],
  lookups: [{ parameter: 'Regions', object: 'dbo.Customers', valueColumn: 'Region' }],
}).xml;

/** The newer layout of the measurement: City renamed to CityName, Qty made decimal(10,2). */
const newer = layout(LAYOUT.replace('City nvarchar(40)', 'CityName nvarchar(40)').replace('Qty int', 'Qty decimal(10,2)'));
const count = (xml: string, text: string) => xml.split(text).length - 1;

describe('reading a report’s source back', () => {
  it('gives the Data tab’s query, which the writer writes again the same', () => {
    const query = queryFromRepx(report, schema)!;
    expect(query).toMatchObject({ object: 'dbo.Orders', joins: orders.joins, filter: orders.filter, sort: orders.sort, top: 100, details: orders.details });
    // A joined query names its columns, as the writer wrote them.
    expect((query as Extract<ReportQuery, { kind: 'table' }>).columns).toEqual(['dbo.Orders.OrderID', 'dbo.Orders.CustomerID', 'dbo.Orders.OrderDate', 'dbo.Orders.Freight', 'dbo.Customers.CompanyName', 'dbo.Customers.City', 'dbo.Customers.Region']);
    const again = writeSqlDataSource(report, specFor(report, schema, query));
    expect(readRepxDataSources(again.xml)).toEqual(readRepxDataSources(report));
    expect(count(again.xml, 'ValueSourceSettings=')).toBe(1);
    expect(count(again.xml, 'DynamicListLookUpSettings')).toBe(1);
    expect(mainQueryOf(report)!.query.name).toBe('Orders');
  });

  it('reads a procedure and custom SQL back too, and nothing from a report with no source', () => {
    const proc = writeSqlDataSource(BASE, { connectionName: 'C', schema, query: { kind: 'procedure', procedure: 'dbo.usp_SalesByRegion' } }).xml;
    expect(queryFromRepx(proc, schema)).toEqual({ kind: 'procedure', procedure: 'dbo.usp_SalesByRegion' });
    const custom = writeSqlDataSource(BASE, { connectionName: 'C', schema, query: { kind: 'custom', name: 'Big', sql: 'SELECT City FROM dbo.Customers' } }).xml;
    expect(queryFromRepx(custom)).toEqual({ kind: 'custom', name: 'Big', sql: 'SELECT City FROM dbo.Customers' });
    expect(queryFromRepx(BASE)).toBeNull();
  });
});

describe('a redesign that dropped the source', () => {
  const dropped = report
    .replace(/<ComponentStorage>[\s\S]*?<\/ComponentStorage>/, '')
    .replace(/<Parameters>[\s\S]*?<\/Parameters>/, '')
    .replace(/<ObjectStorage>[\s\S]*?<\/ObjectStorage>/, '')
    .replace(/\sDataSource="[^"]*"/g, '')
    .replace(/\sDataMember="Orders"/, '');

  it('gets it back, with its parameters, their lookups and the report’s pointer, as DevExpress then printed it', () => {
    const kept = carryDataSource(report, dropped);
    expect(kept.reason).toBe('kept the data source (Orders, OrderLines, RegionsList on connection "FormaSample") through the redesign, with parameter Regions');
    expect(readRepxDataSources(kept.xml)).toEqual(readRepxDataSources(report));
    expect(kept.xml).toMatch(/<XtraReportsLayoutSerializer [^>]*DataMember="Orders" DataSource="#Ref-\d+">/);
    expect(count(kept.xml, 'ValueSourceSettings=')).toBe(1);
    expect(auditRepx(kept.xml, null).findings.map((f) => f.code)).toEqual(auditRepx(report, null).findings.map((f) => f.code));
  });

  it('gives the source a fresh number when the new report uses its old one, and moves a detail band’s pointer with it', () => {
    const ref = readRepxDataSources(report)[0].ref;
    // The label takes the source's old number, and the kept detail band still points at it.
    const clash = dropped
      .replace(/(<Item1 Ref=")4(" ControlType="XRLabel")/, `$1${ref}$2`)
      .replace('DataMember="Orders.OrderLinesOfOrders"', `DataMember="Orders.OrderLinesOfOrders" DataSource="#Ref-${ref}"`);
    const kept = carryDataSource(report, clash);
    const fresh = readRepxDataSources(kept.xml)[0].ref;
    expect(fresh).not.toBe(ref);
    expect(kept.xml).toContain(`DataMember="Orders.OrderLinesOfOrders" DataSource="#Ref-${fresh}"`);
  });

  it('leaves a new report with a source of its own alone, and a report that never had one', () => {
    expect(carryDataSource(report, report).applied).toBe(false);
    expect(carryDataSource(BASE, BASE).reason).toBe('the report had no data source');
  });
});

describe('drift against a newer layout', () => {
  it('finds the measured rename and type change, and the fix leaves none', () => {
    const drift = driftOf(report, newer);
    expect(drift).toEqual([
      { kind: 'renamed', query: 'Orders', message: 'Customers.City is not in FormaSample, so DevExpress refuses the query and the report prints nothing; it looks renamed to CityName.', rename: { table: 'Customers', from: 'City', to: 'CityName' } },
      { kind: 'retyped', query: 'OrderLines', message: 'OrderLines.Qty was Int32 when the report was written and is Decimal (decimal) in FormaSample.' },
    ]);
    const fixed = refreshDataSource(report, newer, [drift[0].rename!]);
    expect(fixed.reason).toBe('Replaced the data source: Orders on connection "FormaSample"; renamed [City] to [CityName] in 1 place');
    expect(driftOf(fixed.xml, newer)).toEqual([]);
    expect(fixed.xml).toContain('Expression="[CityName]"');
    expect(count(fixed.xml, 'ValueSourceSettings=')).toBe(1);
    expect(count(fixed.xml, 'DynamicListLookUpSettings')).toBe(1);
  });

  /*
   * SD-26 (2026-11-11, the full audit): two queries returning a field of the
   * same name. A line's own City, printed in the detail band, is not the
   * customer's City the rename was found for, and kept its name until now
   * only by luck of there being one query.
   */
  it('renames a field only where the renamed table’s query is read', () => {
    const both = LAYOUT.replace('UnitPrice decimal(10,2) NOT NULL)', 'UnitPrice decimal(10,2) NOT NULL, City nvarchar(40) NULL)');
    const lines = layout(both);
    const written = writeSqlDataSource(BASE, { connectionName: 'FormaSample', schema: lines, query: orders }).xml;
    // The detail band prints the line's City; the Detail band the customer's.
    expect(count(written, 'Expression="[City]"')).toBe(2);
    const renamedLayout = layout(both.replace('City nvarchar(40) NULL, Region', 'CityName nvarchar(40) NULL, Region'));
    const drift = driftOf(written, renamedLayout).filter((d) => d.kind === 'renamed');
    expect(drift.map((d) => d.rename)).toEqual([{ table: 'Customers', from: 'City', to: 'CityName' }]);
    const fixed = refreshDataSource(written, renamedLayout, [drift[0].rename!]);
    expect(fixed.reason).toMatch(/renamed \[City\] to \[CityName\] in 1 place$/);
    const detail = /ControlType="DetailReportBand"[\s\S]*$/.exec(fixed.xml)![0];
    expect(detail).toContain('Expression="[City]"');
    expect(detail).not.toContain('[CityName]');
    expect(count(fixed.xml, 'Expression="[CityName]"')).toBe(1);
    expect(driftOf(fixed.xml, renamedLayout).filter((d) => d.kind === 'renamed' || d.kind === 'missing-column')).toEqual([]);
  });

  it('says what a rewrite stops reading', () => {
    const gone = layout(LAYOUT.replace('City nvarchar(40) NULL, ', ''));
    expect(driftOf(report, gone)[0]).toMatchObject({ kind: 'missing-column', message: 'Customers.City is not in FormaSample, so DevExpress refuses the query and the report prints nothing.' });
    expect(refreshDataSource(report, gone).reason).toMatch(/; it no longer reads City, which the layout does not have$/);
  });

  it('finds a procedure’s parameter now OUTPUT, one it no longer takes and one it now needs, which a rewrite settles', () => {
    const proc = writeSqlDataSource(BASE, { connectionName: 'C', schema, query: { kind: 'procedure', procedure: 'dbo.usp_WithOut' } }).xml;
    const changed = layout(LAYOUT.replace('@Region nvarchar(20), @Count int AS', '@Count int OUTPUT, @Top int AS'));
    changed.procedures[1].result = [{ name: 'CompanyName', type: 'nvarchar', length: 80 }];
    expect(driftOf(proc, changed).map((d) => `${d.kind}: ${d.message}`)).toEqual([
      'missing-param: usp_WithOut no longer takes @Region, which the report passes.',
      'output-param: @Count is an OUTPUT parameter of usp_WithOut; DevExpress passes it as an input, so the report should not supply it.',
      'new-param: usp_WithOut now takes @Top, with no default, which the report does not supply.',
    ]);
    expect(driftOf(refreshDataSource(proc, changed).xml, changed)).toEqual([]);
  });

  it('finds a table or custom SQL’s name the layout lacks, and keeps the report’s own copy when asked', () => {
    const custom = writeSqlDataSource(BASE, { connectionName: 'C', schema, query: { kind: 'custom', name: 'Big', sql: 'SELECT City FROM dbo.Customers' } }).xml;
    expect(driftOf(custom, newer)).toEqual([{ kind: 'custom-sql', query: 'Big', message: 'The custom SQL of Big: no table of the query has a column "City".' }]);
    const partial = layout(LAYOUT.replace(/CREATE TABLE dbo\.Customers[^;]*;/, ''));
    expect(driftOf(report, partial).filter((d) => d.kind === 'missing-object').map((d) => d.message)).toEqual([
      'The query Orders reads Customers, which this layout of FormaSample does not have: it is gone, or the export left it out.',
      'The query RegionsList reads Customers, which this layout of FormaSample does not have: it is gone, or the export left it out.',
    ]);
    const merged = mergeLayouts(partial, schemaFromRepx(report));
    expect(merged.objects.map((o) => o.name)).toEqual(['Orders', 'OrderLines', 'Customers']);
    expect(driftOf(report, merged).filter((d) => d.kind === 'missing-object')).toEqual([]);
  });
});

describe('a replaced source', () => {
  it('takes with it the parameters only it used, and their lookups', () => {
    const replaced = writeSqlDataSource(report, { connectionName: 'FormaSample', schema, query: { kind: 'procedure', procedure: 'dbo.usp_SalesByRegion' } });
    expect(replaced.reason).toBe('Replaced the data source: SalesByRegion on connection "FormaSample", with parameter Region; removed Regions, which only the old one used');
    expect(replaced.xml).not.toContain('Name="Regions"');
    expect(replaced.xml).not.toContain('DynamicListLookUpSettings');
    expect(auditRepx(replaced.xml, null).findings.map((f) => f.code)).not.toContain('unused-parameter');
  });

  it('keeps a parameter the report still uses elsewhere', () => {
    const used = report.replace('Expression="[City]"', 'Expression="[City] + ?Regions"');
    const replaced = writeSqlDataSource(used, { connectionName: 'FormaSample', schema, query: { kind: 'procedure', procedure: 'dbo.usp_SalesByRegion' } });
    expect(replaced.xml).toContain('Name="Regions"');
    expect(replaced.reason).not.toMatch(/removed/);
  });
});

describe('the layout the samples went with', () => {
  it('is unchanged by a merge that adds nothing', () => {
    const withRows = withSamples(schema, { 'dbo.Orders': [{ OrderID: 1 }] });
    expect(mergeLayouts(withRows, null)).toBe(withRows);
    expect(mergeLayouts(withRows, schemaFromRepx(report)).objects).toHaveLength(withRows.objects.length);
  });
});
