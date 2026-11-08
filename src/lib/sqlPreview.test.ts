/**
 * The Preview over a database's own shapes (2026-11-09, the SQL Server
 * programme, batch DF). The expectations are what DevExpress 20.1 printed
 * (`RepxProbe sql-fill`, en-US) over the made-up FormaSample on LocalDB: one
 * row of every type, and an orders report with a multi-value `In` filter, a
 * calculated field, a sort, a master-detail band and a lookup list. The
 * tables and rows here are that made-up database's, as Forma's sample script
 * returned them (numbers as JSON numbers, dates as ISO text).
 */
import { describe, expect, it } from 'vitest';
import { readSchemaScript, withSamples } from './sqlSchema';
import { choicesFor, fieldHints, fieldTypes, hintOf, parameterLookups, relatedRows, sampleRows, sqlPreview, unqualified } from './sqlPreview';
import { typeRows } from './reportData';
import { valueText } from './criteria';
import { writeSqlDataSource } from './repxSqlWriter';
import { paginate, parseReportStructure } from './reportPreview';
import type { ReportQuery } from './sqlQuery';

const layout = readSchemaScript(`
CREATE TABLE dbo.Customers (CustomerID int IDENTITY(1,1) PRIMARY KEY, CompanyName nvarchar(80) NOT NULL, City nvarchar(40) NULL, Region nvarchar(20) NULL);
CREATE TABLE dbo.Orders (OrderID int PRIMARY KEY, CustomerID int NOT NULL REFERENCES dbo.Customers(CustomerID), OrderDate datetime NOT NULL, Freight decimal(10,2) NOT NULL);
CREATE TABLE dbo.OrderLines (OrderID int NOT NULL REFERENCES dbo.Orders(OrderID), LineNumber int NOT NULL, Product nvarchar(60) NOT NULL, Qty int NOT NULL, UnitPrice decimal(10,2) NOT NULL);
CREATE TABLE dbo.Suppliers (SupplierID int PRIMARY KEY, CompanyName nvarchar(80) NOT NULL);
CREATE PROCEDURE dbo.usp_SalesByRegion @Region nvarchar(20) = NULL AS SELECT 1;
`, 'FormaSample')!;
const schema = withSamples(layout, {
  'dbo.Customers': [
    { CustomerID: 1, CompanyName: 'Example Traders', City: 'Leeds', Region: 'North' },
    { CustomerID: 2, CompanyName: 'Sample Goods', City: 'Bristol', Region: 'South' },
    { CustomerID: 3, CompanyName: 'Demo Supplies', City: 'York', Region: 'North' },
  ],
  'dbo.Orders': [
    { OrderID: 1001, CustomerID: 1, OrderDate: '2026-01-05T00:00:00', Freight: 12.5 },
    { OrderID: 1002, CustomerID: 2, OrderDate: '2026-01-09T00:00:00', Freight: 8 },
    { OrderID: 1003, CustomerID: 3, OrderDate: '2026-02-01T00:00:00', Freight: 20.25 },
  ],
  'dbo.OrderLines': [
    { OrderID: 1001, LineNumber: 1, Product: 'Widget', Qty: 4, UnitPrice: 3.25 },
    { OrderID: 1001, LineNumber: 2, Product: 'Gadget', Qty: 1, UnitPrice: 19.99 },
    { OrderID: 1002, LineNumber: 1, Product: 'Widget', Qty: 10, UnitPrice: 3.1 },
    { OrderID: 1003, LineNumber: 1, Product: 'Sprocket', Qty: 2, UnitPrice: 7.5 },
    { OrderID: 1003, LineNumber: 2, Product: 'Gadget', Qty: 3, UnitPrice: 18.75 },
  ],
});

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

describe('each SQL type, as DevExpress printed it', () => {
  it('reads a sample value as SqlClient hands it over: scale kept, a code with its zeros, a Guid in lower case', () => {
    const columns = [
      ['int', '12', '12'], ['bigint', '1234567890123', '1234567890123'], ['bit', 'true', 'True'],
      ['decimal(12,4)', '12.5', '12.5000'], ['numeric(9,2)', '12.5', '12.50'], ['money', '12.5', '12.5000'],
      ['float', '12.5', '12.5'], ['real', '0.1', '0.1'],
      ['date', '2026-01-05', '1/5/2026 12:00:00 AM'], ['datetime', '2026-01-05T13:45:00', '1/5/2026 1:45:00 PM'],
      ['datetime2', '2026-01-05T13:45:00.1234567', '1/5/2026 1:45:00 PM'], ['time', '13:45:30', '13:45:30'],
      ['datetimeoffset', '2026-01-05T13:45:00+05:30', '1/5/2026 1:45:00 PM +05:30'],
      ['varchar(20)', '00123', '00123'], ['uniqueidentifier', '6F9619FF-8B86-D011-B42D-00C04FC964FF', '6f9619ff-8b86-d011-b42d-00c04fc964ff'],
    ] as const;
    const t = readSchemaScript(`CREATE TABLE dbo.Types (${columns.map(([type], i) => `c${i} ${type}`).join(', ')});`)!.objects[0];
    const hints = Object.fromEntries(t.columns.map((c) => [c.name, hintOf(c)]));
    const [row] = typeRows([Object.fromEntries(columns.map(([, sample], i) => [`c${i}`, sample]))], hints);
    expect(columns.map((_, i) => valueText(row[`c${i}`]))).toEqual(columns.map(([, , printed]) => printed));
  });

  it('gives the AI each field’s SQL type, and the Preview each field’s hint, a detail’s too', () => {
    expect(fieldTypes(schema, orders)).toMatchObject({ OrderID: 'int', Freight: 'decimal(10,2)', CompanyName: 'nvarchar(80)', OrderDate: 'datetime' });
    expect(fieldHints(schema, orders)).toMatchObject({ OrderID: 'int', Freight: 'decimal:2', OrderDate: 'date', Region: 'string', UnitPrice: 'decimal:2', Qty: 'int' });
  });
});

describe('the sample rows of a query', () => {
  it('are joined, sorted and cut as SQL Server would return them, before its filter', () => {
    const out = sampleRows(schema, orders)!;
    expect(out.rows.map((r) => [r.OrderID, r.CompanyName, r.Region])).toEqual([['1003', 'Demo Supplies', 'North'], ['1002', 'Sample Goods', 'South'], ['1001', 'Example Traders', 'North']]);
    expect(out.note).toBe('3 sample rows of dbo.Orders');
    expect(sampleRows(schema, { ...orders, top: 1, sort: [{ column: 'dbo.Orders.Freight' }] })!.rows.map((r) => r.Freight)).toEqual(['8']);
  });

  it('say when an inner join finds no match, and keep the row for a left outer one', () => {
    const lonely = withSamples(schema, { 'dbo.Customers': [{ CustomerID: 1, CompanyName: 'Example Traders', Region: 'North' }] });
    expect(sampleRows(lonely, orders)!.note).toBe('1 sample row of dbo.Orders; 2 of the sample rows found no match in dbo.Customers (the sample rows were taken table by table)');
    const outer = sampleRows(lonely, { ...orders, joins: [{ ...orders.joins[0], type: 'LeftOuter' }] })!;
    expect(outer.rows.map((r) => [r.OrderID, r.CompanyName])).toEqual([['1003', ''], ['1002', ''], ['1001', 'Example Traders']]);
  });

  it('are none for a procedure, which only running it could sample, and say so', () => {
    expect(sampleRows(schema, { kind: 'procedure', procedure: 'dbo.usp_SalesByRegion' })).toBeNull();
    expect(sqlPreview('', schema, { kind: 'procedure', procedure: 'dbo.usp_SalesByRegion' })?.note).toMatch(/cannot be sampled without running it/);
    expect(sqlPreview('', schema, { kind: 'table', object: 'dbo.Suppliers', columns: [], joins: [] })?.note).toBe('dbo.Suppliers has no sample rows: run Forma’s sample script for it, or use AI test data');
  });

  it('read their filter by field name', () => {
    expect(unqualified('[Customers.Region] In (?Regions) And [dbo.Orders.Freight] > 5')).toBe('[Region] In (?Regions) And [Freight] > 5');
  });
});

/** The orders report the writer makes, as batch DD wrote it and DevExpress filled it. */
function ordersReport(): string {
  const label = (f: string, i: number) => `<Item${i + 1} Ref="${10 + i * 2}" ControlType="XRLabel" Name="label${f}" Text="${f}" LocationFloat="${i * 160},0" SizeF="150,20" Dpi="100"><ExpressionBindings><Item1 Ref="${11 + i * 2}" EventName="BeforePrint" PropertyName="Text" Expression="[${f}]" /></ExpressionBindings></Item${i + 1}>`;
  const base = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a" Name="FormaWritten" PageWidth="850" PageHeight="1100" Version="20.1" Dpi="100">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" Dpi="100" />
    <Item2 Ref="3" ControlType="DetailBand" Name="Detail" HeightF="25" Dpi="100"><Controls>${['OrderID', 'OrderDate', 'CompanyName', 'FreightWithTax'].map(label).join('')}</Controls></Item2>
    <Item3 Ref="4" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" Dpi="100" />
  </Bands>
</XtraReportsLayoutSerializer>`;
  return writeSqlDataSource(base, {
    connectionName: 'FormaSample',
    schema,
    query: orders,
    multiValue: ['Regions'],
    lookups: [{ parameter: 'Regions', object: 'dbo.Customers', valueColumn: 'Region' }],
    calculatedFields: [{ name: 'FreightWithTax', expression: '[Freight] * 1.2', type: 'Decimal' }],
  }).xml;
}

function printed(repx: string, regions: string): string[] {
  const sql = sqlPreview(repx, schema, orders)!;
  const report = paginate(parseReportStructure(repx), sql.rows!.length, { rows: sql.rows, parameters: { Regions: regions }, rowTypes: sql.hints, sourceFilter: sql.sourceFilter, related: sql.related });
  return report.pages[0].bands
    .map((band) => [
      ...band.controls.map((c) => c.text ?? '').filter((t) => t.trim()),
      ...band.controls.flatMap((c) => (c.cellTexts ?? []).flat()),
    ].join(' | '))
    .filter(Boolean);
}

describe('the orders report over the sample rows', () => {
  it('prints what DevExpress printed: the filter by several regions, newest first, each order with its lines and their total', () => {
    expect(printed(ordersReport(), 'North,South')).toEqual([
      '1003 | 2/1/2026 12:00:00 AM | Demo Supplies | 24.3',
      '1003 | 1 | Sprocket | 2 | 7.50',
      '1003 | 2 | Gadget | 3 | 18.75',
      '26.25',
      '1002 | 1/9/2026 12:00:00 AM | Sample Goods | 9.6',
      '1002 | 1 | Widget | 10 | 3.10',
      '3.10',
      '1001 | 1/5/2026 12:00:00 AM | Example Traders | 15',
      '1001 | 1 | Widget | 4 | 3.25',
      '1001 | 2 | Gadget | 1 | 19.99',
      '23.24',
    ]);
  });

  it('keeps the one South order with Regions=South, as DevExpress kept one row', () => {
    expect(printed(ordersReport(), 'South')).toEqual(['1002 | 1/9/2026 12:00:00 AM | Sample Goods | 9.6', '1002 | 1 | Widget | 10 | 3.10', '3.10']);
  });

  it('nests a detail report’s rows by the relation’s keys', () => {
    const related = relatedRows(schema, ordersReport())!;
    expect(related('Orders.OrderLinesOfOrders', { OrderID: '1001' })!.map((r) => r.Product)).toEqual(['Widget', 'Gadget']);
    expect(related('Orders.Nope', { OrderID: '1001' })).toBeNull();
  });
});

describe('a parameter’s lookup list', () => {
  it('is the lookup column’s sample values, distinct, and a cascade reads the other parameter', () => {
    const repx = ordersReport();
    expect(parameterLookups(repx)).toEqual([{ parameter: 'Regions', dataMember: 'RegionsList', valueMember: 'Region', filter: '' }]);
    expect(choicesFor(schema, repx, {})).toEqual({ Regions: ['North', 'South'] });
    const cascade = writeSqlDataSource(repx, {
      connectionName: 'FormaSample',
      schema,
      query: { ...orders, filter: '[Customers.Region] In (?Regions) And [Customers.City] = ?City' },
      multiValue: ['Regions'],
      lookups: [{ parameter: 'Regions', object: 'dbo.Customers', valueColumn: 'Region' }, { parameter: 'City', object: 'dbo.Customers', valueColumn: 'City', filter: '[Region] In (?Regions)' }],
    }).xml;
    expect(choicesFor(schema, cascade, { Regions: 'South' }, new Set(['Regions']))).toEqual({ Regions: ['North', 'South'], City: ['Bristol'] });
    expect(choicesFor(schema, cascade, { Regions: 'North,South' }, new Set(['Regions'])).City).toEqual(['Leeds', 'Bristol', 'York']);
  });
});
