/**
 * The database layout, read without a connection (2026-11-08, the SQL Server
 * programme, batch DB). The fixtures are real engine output, not hand-made:
 * `RepxProbe sql-run` ran `SCHEMA_SCRIPT` and a `sampleScript` over the
 * made-up FormaSample database on LocalDB 13.1 (SQL Server 2016), and
 * `RepxProbe emit-sql` wrote the .repx, over the same made-up rows. Nothing
 * here came from a company database.
 */
import { describe, expect, it } from 'vitest';
import {
  parseProcedureHeader,
  parseTypeName,
  readDatabaseText,
  readSampleExport,
  readSchemaExport,
  readSchemaScript,
  resultFix,
  schemaForAi,
  summarizeSchema,
  typeLabel,
  unwrapExport,
  withSamples,
  MAX_SAMPLE_VALUE,
} from './sqlSchema';
import { readRepxDataSources, readSqlDataSourceXml, schemaFromRepx } from './repxSqlDataSource';
import { SCHEMA_SCRIPT, quoteName, sampleScript } from './sqlSchemaScript';
import { keepRecent, MAX_DATABASES, type StoredDatabase } from './sqlSchemaStore';

/** SCHEMA_SCRIPT's answer over FormaSample, as SQL Server 2016 returned it. */
const SCHEMA_EXPORT: string = "<?forma {\"format\":\"forma-sql-schema\",\"version\":1,\"database\":\"FormaSample\",\"sqlVersion\":\"13.0.4001.0\",\"objects\":[{\"schema\":\"dbo\",\"name\":\"Customers\",\"kind\":\"table\",\"columns\":[{\"name\":\"CustomerID\",\"type\":\"int\",\"length\":4,\"precision\":10,\"scale\":0,\"nullable\":false,\"identity\":true,\"computed\":false},{\"name\":\"CompanyName\",\"type\":\"nvarchar\",\"length\":80,\"precision\":0,\"scale\":0,\"nullable\":false,\"identity\":false,\"computed\":false},{\"name\":\"City\",\"type\":\"nvarchar\",\"length\":40,\"precision\":0,\"scale\":0,\"nullable\":true,\"identity\":false,\"computed\":false},{\"name\":\"Region\",\"type\":\"nvarchar\",\"length\":20,\"precision\":0,\"scale\":0,\"nullable\":true,\"identity\":false,\"computed\":false}],\"primaryKey\":[{\"name\":\"CustomerID\"}]},{\"schema\":\"dbo\",\"name\":\"OrderLines\",\"kind\":\"table\",\"columns\":[{\"name\":\"OrderID\",\"type\":\"int\",\"length\":4,\"precision\":10,\"scale\":0,\"nullable\":false,\"identity\":false,\"computed\":false},{\"name\":\"LineNumber\",\"type\":\"int\",\"length\":4,\"precision\":10,\"scale\":0,\"nullable\":false,\"identity\":false,\"computed\":false},{\"name\":\"Product\",\"type\":\"nvarchar\",\"length\":60,\"precision\":0,\"scale\":0,\"nullable\":false,\"identity\":false,\"computed\":false},{\"name\":\"Qty\",\"type\":\"int\",\"length\":4,\"precision\":10,\"scale\":0,\"nullable\":false,\"identity\":false,\"computed\":false},{\"name\":\"UnitPrice\",\"type\":\"decimal\",\"length\":9,\"precision\":10,\"scale\":2,\"nullable\":false,\"identity\":false,\"computed\":false}],\"primaryKey\":[{\"name\":\"OrderID\"},{\"name\":\"LineNumber\"}]},{\"schema\":\"dbo\",\"name\":\"Orders\",\"kind\":\"table\",\"columns\":[{\"name\":\"OrderID\",\"type\":\"int\",\"length\":4,\"precision\":10,\"scale\":0,\"nullable\":false,\"identity\":false,\"computed\":false},{\"name\":\"CustomerID\",\"type\":\"int\",\"length\":4,\"precision\":10,\"scale\":0,\"nullable\":false,\"identity\":false,\"computed\":false},{\"name\":\"OrderDate\",\"type\":\"datetime\",\"length\":8,\"precision\":23,\"scale\":3,\"nullable\":false,\"identity\":false,\"computed\":false},{\"name\":\"Freight\",\"type\":\"decimal\",\"length\":9,\"precision\":10,\"scale\":2,\"nullable\":false,\"identity\":false,\"computed\":false}],\"primaryKey\":[{\"name\":\"OrderID\"}]},{\"schema\":\"dbo\",\"name\":\"vOrderTotals\",\"kind\":\"view\",\"columns\":[{\"name\":\"OrderID\",\"type\":\"int\",\"length\":4,\"precision\":10,\"scale\":0,\"nullable\":false,\"identity\":false,\"computed\":false},{\"name\":\"CompanyName\",\"type\":\"nvarchar\",\"length\":80,\"precision\":0,\"scale\":0,\"nullable\":false,\"identity\":false,\"computed\":false},{\"name\":\"Total\",\"type\":\"decimal\",\"length\":17,\"precision\":38,\"scale\":2,\"nullable\":true,\"identity\":false,\"computed\":false}]}],\"foreignKeys\":[{\"name\":\"FK__OrderLine__Order__286302EC\",\"table\":\"dbo.OrderLines\",\"references\":\"dbo.Orders\",\"columns\":[{\"column\":\"OrderID\",\"referencedColumn\":\"OrderID\"}]},{\"name\":\"FK__Orders__Customer__25869641\",\"table\":\"dbo.Orders\",\"references\":\"dbo.Customers\",\"columns\":[{\"column\":\"CustomerID\",\"referencedColumn\":\"CustomerID\"}]}],\"procedures\":[{\"schema\":\"dbo\",\"name\":\"usp_Dynamic\",\"result\":[{\"name\":\"CompanyName\",\"type\":\"nvarchar(80)\",\"nullable\":false}],\"header\":\"usp_Dynamic AS EXEC sp_executesql N'SELECT CompanyName FROM dbo.Customers';\"},{\"schema\":\"dbo\",\"name\":\"usp_SalesByRegion\",\"parameters\":[{\"name\":\"@Region\",\"type\":\"nvarchar\",\"length\":20,\"precision\":0,\"scale\":0,\"output\":false},{\"name\":\"@From\",\"type\":\"date\",\"length\":3,\"precision\":10,\"scale\":0,\"output\":false},{\"name\":\"@To\",\"type\":\"date\",\"length\":3,\"precision\":10,\"scale\":0,\"output\":false}],\"result\":[{\"name\":\"Region\",\"type\":\"nvarchar(20)\",\"nullable\":true},{\"name\":\"Total\",\"type\":\"decimal(38,2)\",\"nullable\":true}],\"header\":\"usp_SalesByRegion @Region nvarchar(20) = NULL, @From date = '2026-01-01', @To date AS SELECT c.Region, SUM(l.Qty * l.UnitPrice) AS Total FROM dbo.Customers c JOIN dbo.Orders o ON o.CustomerID = c.CustomerID JOIN dbo.OrderLines l ON l.OrderID = o.OrderID WHERE (@Region IS NULL OR c.Region = @Region) AND o.OrderDate BETWEEN @From AND @To GROUP BY c.Region\"},{\"schema\":\"dbo\",\"name\":\"usp_TempTable\",\"resultError\":{\"type\":\"TEMPORARY_TABLE\",\"message\":\"The metadata could not be determined because statement 'INSERT #t SELECT CompanyName FROM dbo.Customers' in procedure 'usp_TempTable' uses a temp table.\"},\"header\":\"usp_TempTable AS CREATE TABLE #t (Name nvarchar(80)); INSERT #t SELECT CompanyName FROM dbo.Customers; SELECT Name FROM #t;\"},{\"schema\":\"dbo\",\"name\":\"usp_TwoSets\",\"result\":[{\"name\":\"CustomerID\",\"type\":\"int\",\"nullable\":false},{\"name\":\"CompanyName\",\"type\":\"nvarchar(80)\",\"nullable\":false}],\"header\":\"usp_TwoSets AS SELECT CustomerID, CompanyName FROM dbo.Customers; SELECT OrderID, Freight FROM dbo.Orders;\"},{\"schema\":\"dbo\",\"name\":\"usp_WithOut\",\"parameters\":[{\"name\":\"@Region\",\"type\":\"nvarchar\",\"length\":20,\"precision\":0,\"scale\":0,\"output\":false},{\"name\":\"@Count\",\"type\":\"int\",\"length\":4,\"precision\":10,\"scale\":0,\"output\":true}],\"result\":[{\"name\":\"CompanyName\",\"type\":\"nvarchar(80)\",\"nullable\":false}],\"header\":\"usp_WithOut @Region nvarchar(20), @Count int OUTPUT AS SELECT CompanyName FROM dbo.Customers WHERE Region = @Region; SET @Count = @@ROWCOUNT;\"}]}?>";
/** sampleScript([dbo.Orders, dbo.vOrderTotals], 3)'s answer over FormaSample. */
const SAMPLE_EXPORT: string = "<?forma {\"format\":\"forma-sql-sample\",\"version\":1,\"database\":\"FormaSample\",\"samples\":[{\"object\":\"dbo.Orders\",\"rows\":[{\"OrderID\":1001,\"CustomerID\":1,\"OrderDate\":\"2026-01-05T00:00:00\",\"Freight\":12.50},{\"OrderID\":1002,\"CustomerID\":2,\"OrderDate\":\"2026-01-09T00:00:00\",\"Freight\":8.00},{\"OrderID\":1003,\"CustomerID\":3,\"OrderDate\":\"2026-02-01T00:00:00\",\"Freight\":20.25}]},{\"object\":\"dbo.vOrderTotals\",\"rows\":[{\"OrderID\":1001,\"CompanyName\":\"Example Traders\",\"Total\":32.99},{\"OrderID\":1002,\"CompanyName\":\"Sample Goods\",\"Total\":31.00},{\"OrderID\":1003,\"CompanyName\":\"Demo Supplies\",\"Total\":71.25}]}]}?>";
/** The .repx `RepxProbe emit-sql` wrote over FormaSample. */
const EMITTED_REPX: string = "﻿<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a\" Name=\"RepxProbeSql\" PageWidth=\"850\" PageHeight=\"1100\" Version=\"20.1\" DataMember=\"Orders\" DataSource=\"#Ref-0\">\n  <Parameters>\n    <Item1 Ref=\"3\" Description=\"Region\" ValueInfo=\"North\" Name=\"Region\" />\n    <Item2 Ref=\"5\" Description=\"To\" ValueInfo=\"2026-12-31\" Name=\"To\" Type=\"#Ref-4\" />\n  </Parameters>\n  <CalculatedFields>\n    <Item1 Ref=\"6\" Name=\"FreightWithTax\" FieldType=\"Decimal\" Expression=\"[Freight] * 1.2\" DataMember=\"Orders\" />\n  </CalculatedFields>\n  <Bands>\n    <Item1 Ref=\"7\" ControlType=\"TopMarginBand\" />\n    <Item2 Ref=\"8\" ControlType=\"DetailBand\" Name=\"Detail\" HeightF=\"25\">\n      <Controls>\n        <Item1 Ref=\"9\" ControlType=\"XRLabel\" Name=\"labelCompany\" SizeF=\"200,20\" LocationFloat=\"0,0\">\n          <ExpressionBindings>\n            <Item1 Ref=\"10\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[CompanyName]\" />\n          </ExpressionBindings>\n        </Item1>\n        <Item2 Ref=\"11\" ControlType=\"XRLabel\" Name=\"labelDate\" SizeF=\"200,20\" LocationFloat=\"210,0\">\n          <ExpressionBindings>\n            <Item1 Ref=\"12\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[OrderDate]\" />\n          </ExpressionBindings>\n        </Item2>\n        <Item3 Ref=\"13\" ControlType=\"XRLabel\" Name=\"labelFreight\" SizeF=\"200,20\" LocationFloat=\"420,0\">\n          <ExpressionBindings>\n            <Item1 Ref=\"14\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[FreightWithTax]\" />\n          </ExpressionBindings>\n        </Item3>\n      </Controls>\n    </Item2>\n    <Item3 Ref=\"15\" ControlType=\"DetailReportBand\" Name=\"DetailReport\" Level=\"0\" DataMember=\"Orders.OrderLinesOfOrder\" DataSource=\"#Ref-0\">\n      <Bands>\n        <Item1 Ref=\"16\" ControlType=\"DetailBand\" Name=\"DetailLines\" HeightF=\"25\">\n          <Controls>\n            <Item1 Ref=\"17\" ControlType=\"XRLabel\" Name=\"labelProduct\" SizeF=\"200,20\" LocationFloat=\"20,0\">\n              <ExpressionBindings>\n                <Item1 Ref=\"18\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Product]\" />\n              </ExpressionBindings>\n            </Item1>\n          </Controls>\n        </Item1>\n      </Bands>\n    </Item3>\n    <Item4 Ref=\"19\" ControlType=\"ReportFooterBand\" Name=\"ReportFooter\" HeightF=\"25\">\n      <Controls>\n        <Item1 Ref=\"20\" ControlType=\"XRLabel\" Name=\"labelTotal\" SizeF=\"200,20\" LocationFloat=\"420,0\">\n          <ExpressionBindings>\n            <Item1 Ref=\"21\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumSum([Freight])\" />\n          </ExpressionBindings>\n        </Item1>\n      </Controls>\n    </Item4>\n    <Item5 Ref=\"22\" ControlType=\"BottomMarginBand\" />\n  </Bands>\n  <ComponentStorage>\n    <Item1 Ref=\"0\" ObjectType=\"DevExpress.DataAccess.Sql.SqlDataSource,DevExpress.DataAccess.v20.1\" Name=\"sqlDataSource1\" Base64=\"PFNxbERhdGFTb3VyY2UgTmFtZT0ic3FsRGF0YVNvdXJjZTEiPjxDb25uZWN0aW9uIE5hbWU9IkZvcm1hU2FtcGxlIiBGcm9tQXBwQ29uZmlnPSJ0cnVlIiAvPjxRdWVyeSBUeXBlPSJTZWxlY3RRdWVyeSIgTmFtZT0iT3JkZXJzIiBUb3A9IjUwMCI+PFBhcmFtZXRlciBOYW1lPSJSZWdpb24iIFR5cGU9IkRldkV4cHJlc3MuRGF0YUFjY2Vzcy5FeHByZXNzaW9uIj4oU3lzdGVtLlN0cmluZykoP1JlZ2lvbik8L1BhcmFtZXRlcj48VGFibGVzPjxUYWJsZSBOYW1lPSJPcmRlcnMiIC8+PFRhYmxlIE5hbWU9IkN1c3RvbWVycyIgLz48UmVsYXRpb24gVHlwZT0iSW5uZXIiIFBhcmVudD0iT3JkZXJzIiBOZXN0ZWQ9IkN1c3RvbWVycyI+PEtleUNvbHVtbiBQYXJlbnQ9IkN1c3RvbWVySUQiIE5lc3RlZD0iQ3VzdG9tZXJJRCIgLz48L1JlbGF0aW9uPjwvVGFibGVzPjxDb2x1bW5zPjxDb2x1bW4gVGFibGU9Ik9yZGVycyIgTmFtZT0iT3JkZXJJRCIgLz48Q29sdW1uIFRhYmxlPSJPcmRlcnMiIE5hbWU9Ik9yZGVyRGF0ZSIgLz48Q29sdW1uIFRhYmxlPSJPcmRlcnMiIE5hbWU9IkZyZWlnaHQiIC8+PENvbHVtbiBUYWJsZT0iQ3VzdG9tZXJzIiBOYW1lPSJDb21wYW55TmFtZSIgLz48Q29sdW1uIFRhYmxlPSJDdXN0b21lcnMiIE5hbWU9IkNpdHkiIC8+PENvbHVtbiBUYWJsZT0iQ3VzdG9tZXJzIiBOYW1lPSJSZWdpb24iIC8+PC9Db2x1bW5zPjxTb3J0aW5nPjxDb2x1bW4gVGFibGU9IkN1c3RvbWVycyIgTmFtZT0iT3JkZXJEYXRlIiAvPjwvU29ydGluZz48RmlsdGVyPltDdXN0b21lcnMuUmVnaW9uXSA9ID9SZWdpb248L0ZpbHRlcj48L1F1ZXJ5PjxRdWVyeSBUeXBlPSJTZWxlY3RRdWVyeSIgTmFtZT0iT3JkZXJMaW5lcyI+PFRhYmxlcz48VGFibGUgTmFtZT0iT3JkZXJMaW5lcyIgLz48L1RhYmxlcz48Q29sdW1ucz48QWxsQ29sdW1ucyAvPjwvQ29sdW1ucz48L1F1ZXJ5PjxRdWVyeSBUeXBlPSJDdXN0b21TcWxRdWVyeSIgTmFtZT0iVG9wQ3VzdG9tZXJzIj48UGFyYW1ldGVyIE5hbWU9IkBuIiBUeXBlPSJTeXN0ZW0uSW50MzIiPjI8L1BhcmFtZXRlcj48U3FsPlNFTEVDVCBUT1AgKEBuKSBDb21wYW55TmFtZSwgQ2l0eSBGUk9NIGRiby5DdXN0b21lcnMgT1JERVIgQlkgQ29tcGFueU5hbWU8L1NxbD48L1F1ZXJ5PjxRdWVyeSBUeXBlPSJTdG9yZWRQcm9jUXVlcnkiIE5hbWU9IlNhbGVzQnlSZWdpb24iPjxQYXJhbWV0ZXIgTmFtZT0iQFJlZ2lvbiIgVHlwZT0iRGV2RXhwcmVzcy5EYXRhQWNjZXNzLkV4cHJlc3Npb24iPihTeXN0ZW0uU3RyaW5nKSg/UmVnaW9uKTwvUGFyYW1ldGVyPjxQYXJhbWV0ZXIgTmFtZT0iQEZyb20iIFR5cGU9IlN5c3RlbS5EYXRlVGltZSI+NjM5MDI4MjI0MDAwMDAwMDAwPC9QYXJhbWV0ZXI+PFBhcmFtZXRlciBOYW1lPSJAVG8iIFR5cGU9IkRldkV4cHJlc3MuRGF0YUFjY2Vzcy5FeHByZXNzaW9uIj4oU3lzdGVtLkRhdGVUaW1lKSg/VG8pPC9QYXJhbWV0ZXI+PFByb2NOYW1lPmRiby51c3BfU2FsZXNCeVJlZ2lvbjwvUHJvY05hbWU+PC9RdWVyeT48UmVsYXRpb24gTWFzdGVyPSJPcmRlcnMiIERldGFpbD0iT3JkZXJMaW5lcyIgTmFtZT0iT3JkZXJMaW5lc09mT3JkZXIiPjxLZXlDb2x1bW4gTWFzdGVyPSJPcmRlcklEIiBEZXRhaWw9Ik9yZGVySUQiIC8+PC9SZWxhdGlvbj48UmVzdWx0U2NoZW1hPjxEYXRhU2V0IE5hbWU9InNxbERhdGFTb3VyY2UxIj48VmlldyBOYW1lPSJUb3BDdXN0b21lcnMiPjxGaWVsZCBOYW1lPSJDb21wYW55TmFtZSIgVHlwZT0iU3RyaW5nIiAvPjxGaWVsZCBOYW1lPSJDaXR5IiBUeXBlPSJTdHJpbmciIC8+PC9WaWV3PjxWaWV3IE5hbWU9IlNhbGVzQnlSZWdpb24iPjxGaWVsZCBOYW1lPSJSZWdpb24iIFR5cGU9IlN0cmluZyIgLz48RmllbGQgTmFtZT0iVG90YWwiIFR5cGU9IkRlY2ltYWwiIC8+PC9WaWV3PjxWaWV3IE5hbWU9Ik9yZGVycyI+PEZpZWxkIE5hbWU9Ik9yZGVySUQiIFR5cGU9IkludDMyIiAvPjxGaWVsZCBOYW1lPSJPcmRlckRhdGUiIFR5cGU9IkRhdGVUaW1lIiAvPjxGaWVsZCBOYW1lPSJGcmVpZ2h0IiBUeXBlPSJEZWNpbWFsIiAvPjxGaWVsZCBOYW1lPSJDb21wYW55TmFtZSIgVHlwZT0iU3RyaW5nIiAvPjxGaWVsZCBOYW1lPSJDaXR5IiBUeXBlPSJTdHJpbmciIC8+PEZpZWxkIE5hbWU9IlJlZ2lvbiIgVHlwZT0iU3RyaW5nIiAvPjwvVmlldz48VmlldyBOYW1lPSJPcmRlckxpbmVzIj48RmllbGQgTmFtZT0iT3JkZXJJRCIgVHlwZT0iSW50MzIiIC8+PEZpZWxkIE5hbWU9IkxpbmVOdW1iZXIiIFR5cGU9IkludDMyIiAvPjxGaWVsZCBOYW1lPSJQcm9kdWN0IiBUeXBlPSJTdHJpbmciIC8+PEZpZWxkIE5hbWU9IlF0eSIgVHlwZT0iSW50MzIiIC8+PEZpZWxkIE5hbWU9IlVuaXRQcmljZSIgVHlwZT0iRGVjaW1hbCIgLz48L1ZpZXc+PFJlbGF0aW9uIE5hbWU9Ik9yZGVyTGluZXNPZk9yZGVyIiBNYXN0ZXI9Ik9yZGVycyIgRGV0YWlsPSJPcmRlckxpbmVzIj48S2V5Q29sdW1uIE1hc3Rlcj0iT3JkZXJJRCIgRGV0YWlsPSJPcmRlcklEIiAvPjwvUmVsYXRpb24+PC9EYXRhU2V0PjwvUmVzdWx0U2NoZW1hPjxDb25uZWN0aW9uT3B0aW9ucyBDbG9zZUNvbm5lY3Rpb249InRydWUiIC8+PC9TcWxEYXRhU291cmNlPg==\" />\n  </ComponentStorage>\n  <ObjectStorage>\n    <Item1 ObjectType=\"DevExpress.XtraReports.Serialization.ObjectStorageInfo, DevExpress.XtraReports.v20.1\" Ref=\"4\" Content=\"System.DateTime\" Type=\"System.Type\" />\n  </ObjectStorage>\n</XtraReportsLayoutSerializer>";

/** SSMS "Generate Scripts" output, made up, with the shapes SSMS writes. */
const GENERATED_SCRIPT = `USE [ShopDemo]
GO
/****** Object:  Table [dbo].[Customers]    Script Date: 08/11/2026 ******/
SET ANSI_NULLS ON
GO
CREATE TABLE [dbo].[Customers](
	[CustomerID] [int] IDENTITY(1,1) NOT NULL,
	[CompanyName] [nvarchar](80) NOT NULL,
	[Region] [nvarchar](20) NULL,
 CONSTRAINT [PK_Customers] PRIMARY KEY CLUSTERED
(
	[CustomerID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
CREATE TABLE [dbo].[Orders](
	[OrderID] [int] NOT NULL,
	[CustomerID] [int] NOT NULL,
	[Freight] [decimal](10, 2) NOT NULL,
	[Doubled]  AS ([Freight]*(2)),
 CONSTRAINT [PK_Orders] PRIMARY KEY CLUSTERED ([OrderID] ASC)
) ON [PRIMARY]
GO
ALTER TABLE [dbo].[Orders]  WITH CHECK ADD  CONSTRAINT [FK_Orders_Customers] FOREIGN KEY([CustomerID])
REFERENCES [dbo].[Customers] ([CustomerID])
GO
CREATE VIEW [dbo].[vRegions] AS SELECT c.Region, COUNT(*) AS Customers FROM dbo.Customers c GROUP BY c.Region
GO
-- A parenthesised list, AS before a type, and a comma inside a default.
CREATE PROCEDURE [dbo].[usp_Orders] (@From date = '2026-01-01', @Region AS nvarchar(20) = N'North, East', @Count int OUTPUT) AS BEGIN SET NOCOUNT ON; SELECT * FROM dbo.Orders END
GO
`;

describe('the layout script', () => {
  it('only reads: no statement that writes, creates or runs anything', () => {
    const code = SCHEMA_SCRIPT.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT)\b/i);
    expect(code).toMatch(/sys\.dm_exec_describe_first_result_set_for_object/);
    expect(code).toMatch(/processing-instruction\(forma\)/);
  });

  it('samples with SELECT TOP alone, names quoted as QUOTENAME does, the count clamped', () => {
    const sql = sampleScript([{ schema: 'dbo', name: "Order]s 'x'" }], 500);
    expect(sql).toContain("SELECT N'dbo.Order]s ''x''', (SELECT TOP (50) * FROM [dbo].[Order]]s 'x'] FOR JSON PATH, INCLUDE_NULL_VALUES)");
    const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE)\b/i);
    expect(sampleScript([{ schema: 'dbo', name: 'A' }], 0)).toContain('TOP (1)');
    expect(() => sampleScript([])).toThrow(/at least one/);
    expect(quoteName('a]b')).toBe('[a]]b]');
  });
});

describe('reading the layout script’s answer', () => {
  const schema = readSchemaExport(SCHEMA_EXPORT)!;

  it('reads the tables and the view with their types, keys and nullability', () => {
    expect(schema.source).toBe('export');
    expect(schema.database).toBe('FormaSample');
    expect(schema.sqlVersion).toMatch(/^13\./);
    expect(schema.objects.map((o) => `${o.kind} ${o.schema}.${o.name}`)).toEqual(['table dbo.Customers', 'table dbo.OrderLines', 'table dbo.Orders', 'view dbo.vOrderTotals']);
    const customers = schema.objects[0];
    expect(customers.primaryKey).toEqual(['CustomerID']);
    expect(customers.columns.find((c) => c.name === 'CustomerID')).toMatchObject({ type: 'int', identity: true, nullable: false });
    expect(customers.columns.find((c) => c.name === 'CompanyName')).toMatchObject({ type: 'nvarchar', length: 80, nullable: false });
    expect(customers.columns.find((c) => c.name === 'City')).toMatchObject({ length: 40, nullable: true });
    expect(schema.objects[1].primaryKey).toEqual(['OrderID', 'LineNumber']);
    expect(schema.objects[2].columns.find((c) => c.name === 'Freight')).toMatchObject({ type: 'decimal', precision: 10, scale: 2 });
    expect(schema.objects[3].columns.find((c) => c.name === 'Total')).toMatchObject({ type: 'decimal', precision: 38, scale: 2, nullable: true });
  });

  it('reads the foreign keys', () => {
    expect(schema.foreignKeys.map((f) => `${f.table}.${f.columns[0].column} -> ${f.references}.${f.columns[0].referencedColumn}`).sort()).toEqual([
      'dbo.OrderLines.OrderID -> dbo.Orders.OrderID',
      'dbo.Orders.CustomerID -> dbo.Customers.CustomerID',
    ]);
  });

  it('reads each procedure’s parameters with their defaults, and its result without running it', () => {
    const sales = schema.procedures.find((p) => p.name === 'usp_SalesByRegion')!;
    expect(sales.parameters).toEqual([
      { name: '@Region', type: 'nvarchar', length: 20, output: false, defaultValue: 'NULL' },
      { name: '@From', type: 'date', output: false, defaultValue: "'2026-01-01'" },
      { name: '@To', type: 'date', output: false },
    ]);
    expect(sales.result.map((c) => `${c.name} ${typeLabel(c)}`)).toEqual(['Region nvarchar(20)', 'Total decimal(38,2)']);
    expect(schema.procedures.find((p) => p.name === 'usp_WithOut')!.parameters.map((p) => `${p.name}${p.output ? ' OUTPUT' : ''}`)).toEqual(['@Region', '@Count OUTPUT']);
  });

  it('keeps the first result set of two, and says why a temp-table procedure has none', () => {
    expect(schema.procedures.find((p) => p.name === 'usp_TwoSets')!.result.map((c) => c.name)).toEqual(['CustomerID', 'CompanyName']);
    const temp = schema.procedures.find((p) => p.name === 'usp_TempTable')!;
    expect(temp.result).toEqual([]);
    expect(temp.resultError?.type).toBe('TEMPORARY_TABLE');
    expect(temp.resultError?.message).toMatch(/temp table/);
    expect(resultFix('TEMPORARY_TABLE')).toMatch(/table variable/);
    // Dynamic SQL was described by SQL Server 2016, as DevExpress read it in batch DA.
    expect(schema.procedures.find((p) => p.name === 'usp_Dynamic')!.result.map((c) => c.name)).toEqual(['CompanyName']);
  });

  it('summarises it in a line', () => {
    expect(summarizeSchema(schema)).toBe('FormaSample: 3 tables, 1 view, 5 procedures (1 whose result cannot be read: a temp table)');
  });

  it('finds the JSON inside the XML cell, inside sqlcmd’s output, and with ?> written as ?\\u003e', () => {
    expect(unwrapExport('XML_F52E2B61-18A1\n<?forma {"a":"x?\\u003ey"}?>')).toEqual({ a: 'x?>y' });
    expect(unwrapExport('\n\n{"format":"forma-sql-schema","objects":[]}\n(1 rows affected)')).toMatchObject({ format: 'forma-sql-schema' });
    expect(unwrapExport('not json')).toBeNull();
    expect(readSchemaExport('{"format":"something-else"}')).toBeNull();
  });
});

describe('sample rows', () => {
  it('reads them by object, bounded', () => {
    const sample = readSampleExport(SAMPLE_EXPORT)!;
    expect(sample.database).toBe('FormaSample');
    expect(Object.keys(sample.samples)).toEqual(['dbo.Orders', 'dbo.vOrderTotals']);
    expect(sample.samples['dbo.Orders'][0]).toMatchObject({ OrderID: 1001, Freight: 12.5 });
    expect(sample.samples['dbo.vOrderTotals'][2]).toMatchObject({ CompanyName: 'Demo Supplies' });
    const long = readSampleExport(JSON.stringify({ format: 'forma-sql-sample', database: 'D', samples: [{ object: 'dbo.T', rows: [{ Note: 'x'.repeat(500) }] }] }))!;
    expect(String(long.samples['dbo.T'][0].Note).length).toBe(MAX_SAMPLE_VALUE + 1);
  });

  it('go to the AI beside the layout, with the keys marked', () => {
    const schema = withSamples(readSchemaExport(SCHEMA_EXPORT)!, readSampleExport(SAMPLE_EXPORT)!.samples);
    const text = schemaForAi(schema);
    expect(text).toMatch(/^DATABASE "FormaSample" \(SQL Server 13\./);
    expect(text).toContain('- dbo.Orders (table): OrderID int PK not null, CustomerID int FK->dbo.Customers.CustomerID not null, OrderDate datetime not null, Freight decimal(10,2) not null');
    expect(text).toContain('e.g. OrderID=1001|1002|1003; CustomerID=1|2|3;');
    expect(text).toContain("- dbo.usp_SalesByRegion(@Region nvarchar(20) = NULL, @From date = '2026-01-01', @To date) procedure -> Region nvarchar(20), Total decimal(38,2)");
    expect(text).toContain('- dbo.usp_TempTable() procedure -> (result unknown: TEMPORARY_TABLE)');
    expect(schemaForAi(schema, 2)).toMatch(/\(7 more objects not listed\.\)$/);
  });
});

describe('SSMS Generate Scripts text', () => {
  const schema = readSchemaScript(GENERATED_SCRIPT)!;

  it('reads tables, keys, a computed column and an ALTER TABLE foreign key', () => {
    expect(schema.source).toBe('script');
    expect(schema.database).toBe('ShopDemo');
    const customers = schema.objects.find((o) => o.name === 'Customers')!;
    expect(customers.columns).toEqual([
      { name: 'CustomerID', type: 'int', identity: true, nullable: false },
      { name: 'CompanyName', type: 'nvarchar', length: 80, nullable: false },
      { name: 'Region', type: 'nvarchar', length: 20, nullable: true },
    ]);
    expect(customers.primaryKey).toEqual(['CustomerID']);
    const orders = schema.objects.find((o) => o.name === 'Orders')!;
    expect(orders.columns.find((c) => c.name === 'Freight')).toMatchObject({ type: 'decimal', precision: 10, scale: 2 });
    expect(orders.columns.find((c) => c.name === 'Doubled')).toMatchObject({ computed: true });
    expect(orders.primaryKey).toEqual(['OrderID']);
    expect(schema.foreignKeys).toEqual([{ name: 'FK_Orders_Customers', table: 'dbo.Orders', references: 'dbo.Customers', columns: [{ column: 'CustomerID', referencedColumn: 'CustomerID' }] }]);
  });

  it('reads a view’s column names and a procedure’s declared parameters', () => {
    expect(schema.objects.find((o) => o.name === 'vRegions')!.columns.map((c) => c.name)).toEqual(['Region', 'Customers']);
    const proc = schema.procedures[0];
    expect(proc).toMatchObject({ schema: 'dbo', name: 'usp_Orders', result: [], resultError: { type: 'NOT_DESCRIBED' } });
    expect(proc.parameters).toEqual([
      { name: '@From', type: 'date', output: false, defaultValue: "'2026-01-01'" },
      { name: '@Region', type: 'nvarchar', length: 20, output: false, defaultValue: "N'North, East'" },
      { name: '@Count', type: 'int', output: true },
    ]);
  });

  it('reads a header without parentheses, with comments, AS before a type and WITH RECOMPILE', () => {
    expect(parseProcedureHeader("usp_X -- note\n @A AS int = 5, /* b */ @B varchar(10) = 'a,b' WITH RECOMPILE AS SELECT @A")).toEqual([
      { name: '@A', type: 'int', output: false, defaultValue: '5' },
      { name: '@B', type: 'varchar', length: 10, output: false, defaultValue: "'a,b'" },
    ]);
    expect(parseProcedureHeader('usp_NoParams AS SELECT @@ROWCOUNT')).toEqual([]);
  });
});

describe('types', () => {
  it('reads and writes a type the way SQL Server names it', () => {
    expect(parseTypeName('nvarchar(max)')).toEqual({ type: 'nvarchar', length: -1 });
    expect(parseTypeName('decimal(38,2)')).toEqual({ type: 'decimal', precision: 38, scale: 2 });
    expect(parseTypeName('datetime2(3)')).toEqual({ type: 'datetime2', scale: 3 });
    expect(parseTypeName('int')).toEqual({ type: 'int' });
    expect(typeLabel({ type: 'nvarchar', length: -1 })).toBe('nvarchar(max)');
    expect(typeLabel({ type: 'decimal', precision: 9, scale: 0 })).toBe('decimal(9,0)');
  });
});

describe('telling a database apart from data', () => {
  it('recognises the layout, the sample rows and a CREATE script, and leaves a CSV alone', () => {
    expect(readDatabaseText(SCHEMA_EXPORT)?.kind).toBe('schema');
    expect(readDatabaseText(SAMPLE_EXPORT)?.kind).toBe('sample');
    const script = readDatabaseText(GENERATED_SCRIPT);
    expect(script?.kind === 'schema' && script.schema.source).toBe('script');
    expect(readDatabaseText('OrderID,Freight\n1001,12.50')).toBeNull();
  });
});

describe('a .repx’s own data source', () => {
  it('reads what DevExpress 20.1 wrote: connection, queries, parameters, relations, result schema', () => {
    const [ds] = readRepxDataSources(EMITTED_REPX);
    expect(ds).toMatchObject({ ref: '0', name: 'sqlDataSource1', connectionName: 'FormaSample', fromAppConfig: true, storesCredentials: false });
    expect(ds.queries.map((q) => `${q.type} ${q.name}`)).toEqual(['SelectQuery Orders', 'SelectQuery OrderLines', 'CustomSqlQuery TopCustomers', 'StoredProcQuery SalesByRegion']);
    const orders = ds.queries[0];
    expect(orders.tables).toEqual(['Orders', 'Customers']);
    expect(orders.filter).toBe('[Customers.Region] = ?Region');
    expect(orders.parameters).toEqual([{ name: 'Region', type: 'DevExpress.DataAccess.Expression', value: '(System.String)(?Region)' }]);
    // Its join, sort and Top (batch DG), the sort on the joined table as the fluent builder put it (batch DA).
    expect(orders.joins).toEqual([{ type: 'Inner', parent: 'Orders', nested: 'Customers', keys: [{ parent: 'CustomerID', nested: 'CustomerID' }] }]);
    expect(orders.sort).toEqual([{ table: 'Customers', name: 'OrderDate', descending: false }]);
    expect(orders.top).toBe(500);
    expect(ds.queries[1].joins).toEqual([]);
    expect(ds.queries[1].allColumns).toBe(true);
    expect(ds.queries[2].sql).toBe('SELECT TOP (@n) CompanyName, City FROM dbo.Customers ORDER BY CompanyName');
    const sales = ds.queries[3];
    expect(sales.procName).toBe('dbo.usp_SalesByRegion');
    // A static DateTime is .NET ticks, as measured.
    expect(sales.parameters[1]).toEqual({ name: '@From', type: 'System.DateTime', value: '639028224000000000' });
    expect(ds.relations).toEqual([{ name: 'OrderLinesOfOrder', master: 'Orders', detail: 'OrderLines', keys: [{ master: 'OrderID', detail: 'OrderID' }] }]);
    expect(ds.views.find((v) => v.name === 'SalesByRegion')!.fields).toEqual([{ name: 'Region', type: 'String' }, { name: 'Total', type: 'Decimal' }]);
  });

  it('turns it into the layout the report already uses', () => {
    const schema = schemaFromRepx(EMITTED_REPX)!;
    expect(schema.source).toBe('repx');
    expect(schema.database).toBe('FormaSample');
    expect(schema.procedures).toEqual([
      { schema: 'dbo', name: 'usp_SalesByRegion', parameters: [{ name: '@Region', type: 'nvarchar', output: false }, { name: '@From', type: 'datetime', output: false }, { name: '@To', type: 'datetime', output: false }], result: [{ name: 'Region', type: 'nvarchar' }, { name: 'Total', type: 'decimal' }] },
    ]);
    expect(schema.objects.map((o) => `${o.name}: ${o.columns.map((c) => `${c.name} ${c.type}`).join(', ')}`)).toEqual([
      'Orders: OrderID int, OrderDate datetime, Freight decimal',
      'Customers: CompanyName nvarchar, City nvarchar, Region nvarchar',
      'OrderLines: OrderID int, LineNumber int, Product nvarchar, Qty int, UnitPrice decimal',
    ]);
    expect(schemaFromRepx('<XtraReportsLayoutSerializer />')).toBeNull();
  });

  it('notices a stored login', () => {
    const ds = readSqlDataSourceXml('<SqlDataSource Name="s"><Connection Name="C" ProviderKey="MSSqlServer"><Parameters><Parameter Name="userid" Value="u" /><Parameter Name="password" Value="p" /></Parameters></Connection></SqlDataSource>');
    expect(ds).toMatchObject({ connectionName: 'C', fromAppConfig: false, storesCredentials: true });
  });
});

describe('the layouts kept on this device', () => {
  const entry = (name: string, savedAt: number, samples?: Record<string, Record<string, unknown>[]>): StoredDatabase => ({
    name,
    savedAt,
    schema: { source: 'export', database: name, objects: [], foreignKeys: [], procedures: [], ...(samples ? { samples } : {}) },
  });

  it('keeps one per database, newest first, at most five, and keeps sample rows across a re-import', () => {
    let list: StoredDatabase[] = [];
    for (let i = 1; i <= 7; i++) list = keepRecent(list, entry(`Db${i}`, i));
    expect(list.map((d) => d.name)).toEqual(['Db7', 'Db6', 'Db5', 'Db4', 'Db3']);
    expect(list).toHaveLength(MAX_DATABASES);
    list = keepRecent(list, entry('Db5', 10, { 'dbo.T': [{ a: 1 }] }));
    list = keepRecent(list, entry('Db5', 11));
    expect(list[0].name).toBe('Db5');
    expect(list[0].schema.samples).toEqual({ 'dbo.T': [{ a: 1 }] });
    expect(list.filter((d) => d.name === 'Db5')).toHaveLength(1);
  });
});
