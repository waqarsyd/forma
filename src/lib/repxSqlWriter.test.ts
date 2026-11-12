/**
 * Writing a SQL Server data source into a .repx (2026-11-08, the SQL Server
 * programme, batch DD). The expected strings are what DevExpress 20.1 wrote
 * for the same features (`RepxProbe emit-sql` and `emit-sql-params`), and
 * reports this writer produced were filled by DevExpress over the made-up
 * FormaSample on LocalDB (`RepxProbe sql-fill`): 3 orders, 5 lines and 2
 * pages through a multi-value In filter and a master-detail relation; a
 * stored procedure with its defaults; custom SQL; a multi-value parameter
 * joined into a procedure; a lookup list of 2 regions. The schema here is
 * made up.
 */
import { describe, expect, it } from 'vitest';
import { readSchemaScript } from './sqlSchema';
import { auditDataSources, connectionStringsSnippet, readRepxDataSources, stripStoredCredentials } from './repxSqlDataSource';
import { defaultValueInfo, parametersFor, resultTypeOf, sqlDataSourceXml, writeSqlDataSource, type DataSourceSpec } from './repxSqlWriter';
import { auditRefs } from './repxRefs';
import { specFromRepx } from './repxViews';
import type { ReportQuery } from './sqlQuery';

const schema = readSchemaScript(`
CREATE TABLE dbo.Customers (CustomerID int NOT NULL PRIMARY KEY, CompanyName nvarchar(80) NOT NULL, Region nvarchar(20) NULL, City nvarchar(40) NULL);
CREATE TABLE dbo.Orders (OrderID int NOT NULL PRIMARY KEY, CustomerID int NULL REFERENCES dbo.Customers(CustomerID), OrderDate datetime NOT NULL, Freight decimal(10,2) NOT NULL);
CREATE TABLE dbo.OrderLines (OrderID int NOT NULL REFERENCES dbo.Orders(OrderID), LineNumber int NOT NULL, Qty int NOT NULL, UnitPrice money NOT NULL);
CREATE PROCEDURE dbo.usp_Sales @Region nvarchar(20) = NULL, @From date = '2026-01-01', @To date, @Rows int OUTPUT AS SELECT 1;
CREATE PROCEDURE dbo.usp_ByRegions @Regions nvarchar(400) AS SELECT 1;
`, 'ShopDemo')!;
// What SQL Server describes for the procedures, as the layout script would bring it.
schema.procedures[0].result = [{ name: 'Region', type: 'nvarchar', length: 20 }, { name: 'Total', type: 'decimal', precision: 38, scale: 2 }];
schema.procedures[1].result = [{ name: 'CompanyName', type: 'nvarchar', length: 80 }];

const orders: ReportQuery = {
  kind: 'table',
  object: 'dbo.Orders',
  columns: [],
  joins: [{ table: 'dbo.Customers', type: 'LeftOuter', on: [{ from: 'CustomerID', to: 'CustomerID' }] }],
  filter: '[Customers.Region] In (?Regions)',
  sort: [{ column: 'dbo.Orders.OrderDate', descending: true }],
  top: 100,
  distinct: true,
  details: [{ table: 'dbo.OrderLines', type: 'Inner', on: [{ from: 'OrderID', to: 'OrderID' }] }],
};

const report = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a" Name="R" PageWidth="850" PageHeight="1100" Version="20.1" Dpi="100">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" Dpi="100" />
    <Item2 Ref="3" ControlType="DetailBand" Name="Detail" HeightF="25" Dpi="100"><Controls><Item1 Ref="4" ControlType="XRLabel" Name="labelCompany" Text="x" Dpi="100"><ExpressionBindings><Item1 Ref="5" EventName="BeforePrint" PropertyName="Text" Expression="[CompanyName]" /></ExpressionBindings></Item1></Controls></Item2>
    <Item3 Ref="6" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" Dpi="100" />
  </Bands>
</XtraReportsLayoutSerializer>`;

const spec: DataSourceSpec = {
  connectionName: 'ShopDemo',
  schema,
  query: orders,
  multiValue: ['Regions'],
  lookups: [{ parameter: 'Regions', object: 'dbo.Customers', valueColumn: 'Region' }],
  calculatedFields: [{ name: 'FreightWithTax', expression: '[Freight] * 1.2', type: 'Decimal' }],
};

describe('the result schema’s type names', () => {
  it('are the ones 20.1 wrote for each SQL type', () => {
    const measured: Record<string, string> = {
      int: 'Int32', bigint: 'Int64', smallint: 'Int16', tinyint: 'Byte', bit: 'Boolean', decimal: 'Decimal', numeric: 'Decimal', money: 'Decimal',
      float: 'Double', real: 'Single', date: 'DateTime', datetime: 'DateTime', datetime2: 'DateTime', smalldatetime: 'DateTime', time: 'Unknown',
      datetimeoffset: 'Unknown', char: 'String', varchar: 'String', nvarchar: 'String', text: 'String', xml: 'String', uniqueidentifier: 'Guid',
      binary: 'Unknown', varbinary: 'ByteArray', image: 'ByteArray',
    };
    for (const [sql, net] of Object.entries(measured)) expect(resultTypeOf(sql), sql).toBe(net);
  });
});

describe('the decoded data source', () => {
  const xml = sqlDataSourceXml({ ...spec });

  it('names the connection only, and writes a built query as 20.1 does', () => {
    expect(xml.startsWith('<SqlDataSource Name="sqlDataSource1"><Connection Name="ShopDemo" FromAppConfig="true" />')).toBe(true);
    expect(xml).not.toMatch(/password|userid|Data Source=/i);
    expect(xml).toContain('<Query Type="SelectQuery" Name="Orders" Top="100" Distinct="true">');
    expect(xml).toContain('<Parameter Name="Regions" Type="DevExpress.DataAccess.Expression">(System.String[], mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089)(?Regions)</Parameter>');
    expect(xml).toContain('<Relation Type="LeftOuter" Parent="Orders" Nested="Customers"><KeyColumn Parent="CustomerID" Nested="CustomerID" /></Relation>');
    expect(xml).toContain('<Sorting><Column Table="Orders" Name="OrderDate" Descending="true" /></Sorting>');
    expect(xml).toContain('<Filter>[Customers.Region] In (?Regions)</Filter>');
    expect(xml.endsWith('<ConnectionOptions CloseConnection="true" /></SqlDataSource>')).toBe(true);
  });

  it('carries the detail query, the relation, the lookup query and a typed result schema', () => {
    expect(xml).toContain('<Query Type="SelectQuery" Name="OrderLines"><Tables><Table Name="OrderLines" /></Tables><Columns><AllColumns /></Columns></Query>');
    expect(xml).toContain('<Relation Master="Orders" Detail="OrderLines" Name="OrderLinesOfOrders"><KeyColumn Master="OrderID" Detail="OrderID" /></Relation>');
    expect(xml).toContain('<Query Type="SelectQuery" Name="RegionsList" Distinct="true"><Tables><Table Name="Customers" /></Tables><Columns><Column Table="Customers" Name="Region" /></Columns></Query>');
    expect(xml).toContain('<View Name="Orders"><Field Name="OrderID" Type="Int32" /><Field Name="CustomerID" Type="Int32" /><Field Name="OrderDate" Type="DateTime" /><Field Name="Freight" Type="Decimal" /><Field Name="CompanyName" Type="String" /><Field Name="Region" Type="String" /><Field Name="City" Type="String" /></View>');
    expect(xml).toContain('<View Name="OrderLines"><Field Name="OrderID" Type="Int32" /><Field Name="LineNumber" Type="Int32" /><Field Name="Qty" Type="Int32" /><Field Name="UnitPrice" Type="Decimal" /></View>');
    expect(xml).toContain('<Relation Name="OrderLinesOfOrders" Master="Orders" Detail="OrderLines"><KeyColumn Master="OrderID" Detail="OrderID" /></Relation></DataSet></ResultSchema>');
  });

  it('writes a procedure’s inputs bound to report parameters, never its OUTPUT one', () => {
    const proc = sqlDataSourceXml({ connectionName: 'ShopDemo', schema, query: { kind: 'procedure', procedure: 'dbo.usp_Sales' } });
    expect(proc).toContain('<Query Type="StoredProcQuery" Name="Sales"><Parameter Name="@Region" Type="DevExpress.DataAccess.Expression">(System.String)(?Region)</Parameter><Parameter Name="@From" Type="DevExpress.DataAccess.Expression">(System.DateTime)(?From)</Parameter><Parameter Name="@To" Type="DevExpress.DataAccess.Expression">(System.DateTime)(?To)</Parameter><ProcName>dbo.usp_Sales</ProcName></Query>');
    expect(proc).not.toContain('@Rows');
    const joined = sqlDataSourceXml({ connectionName: 'ShopDemo', schema, query: { kind: 'procedure', procedure: 'dbo.usp_ByRegions' }, multiValue: ['Regions'] });
    expect(joined).toContain("<Parameter Name=\"@Regions\" Type=\"DevExpress.DataAccess.Expression\">(System.String)(Join(?Regions, ','))</Parameter>");
  });

  it('escapes custom SQL as text', () => {
    const custom = sqlDataSourceXml({ connectionName: 'ShopDemo', schema, query: { kind: 'custom', name: 'Big', sql: 'SELECT CompanyName FROM dbo.Customers WHERE CustomerID > @Min AND Region <> \'A&B\'' } });
    expect(custom).toContain("<Parameter Name=\"@Min\" Type=\"DevExpress.DataAccess.Expression\">(System.String)(?Min)</Parameter><Sql>SELECT CompanyName FROM dbo.Customers WHERE CustomerID &gt; @Min AND Region &lt;&gt; 'A&amp;B'</Sql>");
  });
});

describe('the report parameters a query needs', () => {
  it('take a procedure’s types and defaults, and a filter’s column type', () => {
    expect(parametersFor({ connectionName: 'X', schema, query: { kind: 'procedure', procedure: 'usp_Sales' } })).toEqual([
      { name: 'Region', type: 'System.String', valueInfo: null, allowNull: true, multi: false },
      { name: 'From', type: 'System.DateTime', valueInfo: '2026-01-01', allowNull: false, multi: false },
      { name: 'To', type: 'System.DateTime', valueInfo: null, allowNull: false, multi: false },
    ]);
    expect(parametersFor({ connectionName: 'X', schema, query: { ...orders, filter: '[Orders.Freight] > ?Min' } as ReportQuery })[0]).toMatchObject({ name: 'Min', type: 'System.Decimal', multi: false });
  });

  it('read a T-SQL default as a ValueInfo', () => {
    expect(defaultValueInfo("N'North'", 'nvarchar')).toBe('North');
    expect(defaultValueInfo("'it''s'", 'varchar')).toBe("it's");
    expect(defaultValueInfo('1', 'bit')).toBe('True');
    expect(defaultValueInfo('NULL', 'int')).toBeNull();
    expect(defaultValueInfo('GETDATE()', 'datetime')).toBeNull();
  });
});

describe('writing into a report', () => {
  const written = writeSqlDataSource(report, spec);

  it('points the report at the source and the query, and stores the source in ComponentStorage', () => {
    expect(written.applied).toBe(true);
    expect(written.reason).toBe('Wrote the data source: Orders on connection "ShopDemo", with parameter Regions');
    const ref = /DataSource="#Ref-(\d+)"/.exec(written.xml)![1];
    expect(written.xml).toMatch(new RegExp(`<XtraReportsLayoutSerializer [^>]*DataMember="Orders" DataSource="#Ref-${ref}">`));
    expect(written.xml).toMatch(new RegExp(`<ComponentStorage><Item1 Ref="${ref}" ObjectType="DevExpress.DataAccess.Sql.SqlDataSource,DevExpress.DataAccess.v20.1" Name="sqlDataSource1" Base64="`));
    expect(auditRefs(written.xml).duplicates).toEqual([]);
  });

  it('adds the parameter, multi-value, with its lookup list, as 20.1 serializes them', () => {
    expect(written.xml).toMatch(/<Parameters><Item1 Ref="\d+" Description="Regions" ValueSourceSettings="#Ref-(\d+)" MultiValue="true" Name="Regions" \/><\/Parameters>/);
    const lookupRef = /ValueSourceSettings="#Ref-(\d+)"/.exec(written.xml)![1];
    expect(written.xml).toContain(`Ref="${lookupRef}" ObjectType="DevExpress.XtraReports.Parameters.DynamicListLookUpSettings, DevExpress.Printing.v20.1.Core"`);
    expect(written.xml).toContain('DataMember="RegionsList" ValueMember="Region" DisplayMember="Region"');
  });

  it('adds the calculated field and a detail band for the relation, with a total that prints', () => {
    expect(written.xml).toMatch(/<CalculatedFields><Item1 Ref="\d+" Name="FreightWithTax" FieldType="Decimal" Expression="\[Freight\] \* 1\.2" DataMember="Orders" \/><\/CalculatedFields>/);
    expect(written.xml).toMatch(/ControlType="DetailReportBand" Name="DetailReportOrderLinesOfOrders" Level="0" DataMember="Orders\.OrderLinesOfOrders" DataSource="#Ref-\d+"/);
    expect(written.xml).toMatch(/<Summary Ref="\d+" Running="Report" \/><ExpressionBindings><Item1 Ref="\d+" EventName="BeforePrint" PropertyName="Text" Expression="sumSum\(\[UnitPrice\]\)" \/>/);
  });

  it('reads back as what was written, and the audit finds nothing wrong', () => {
    const [ds] = readRepxDataSources(written.xml);
    expect(ds).toMatchObject({ connectionName: 'ShopDemo', fromAppConfig: true, storesCredentials: false });
    expect(ds.queries.map((q) => q.name)).toEqual(['Orders', 'OrderLines', 'RegionsList']);
    expect(ds.relations.map((r) => r.name)).toEqual(['OrderLinesOfOrders']);
    expect(auditDataSources(written.xml)).toEqual([]);
  });

  it('replaces a source already there, keeping its Ref, and adds no parameter twice', () => {
    const again = writeSqlDataSource(written.xml, { ...spec, query: { ...orders, top: 10 } });
    expect(again.xml.match(/ObjectType="DevExpress\.DataAccess\.Sql\.SqlDataSource/g)).toHaveLength(1);
    expect(/DataSource="#Ref-(\d+)"/.exec(again.xml)![1]).toBe(/DataSource="#Ref-(\d+)"/.exec(written.xml)![1]);
    expect(again.xml.match(/Name="Regions"/g)).toHaveLength(1);
    expect(readRepxDataSources(again.xml)[0].queries[0]).toMatchObject({ name: 'Orders' });
    expect(again.reason).toMatch(/^Replaced the data source/);
  });

  // 2026-11-12 (CodeQL js/incomplete-sanitization): a name was put in a pattern with only its dots
  // escaped and compared with the file unescaped, so "(R&D)" never matched what was written and each
  // write added the band again, "Lines[" threw, and the band's Name carried a bare "&".
  it('writes a relation or a calculated field named with XML and pattern characters once', () => {
    const named: DataSourceSpec = {
      ...spec,
      details: [{ query: { kind: 'table', object: 'dbo.OrderLines', columns: [], joins: [] }, keys: [{ master: 'OrderID', detail: 'OrderID' }], name: 'Lines (R&D)' }],
      calculatedFields: [{ name: 'Tax & Duty', expression: '[Freight] * 0.2', type: 'Decimal' }],
    };
    const once = writeSqlDataSource(report, named);
    expect(once.xml).toContain('ControlType="DetailReportBand" Name="DetailReportLines (R&amp;D)" Level="0" DataMember="Orders.Lines (R&amp;D)"');
    const twice = writeSqlDataSource(once.xml, named);
    expect(twice.xml.match(/ControlType="DetailReportBand"/g)).toHaveLength(1);
    expect(twice.xml.match(/Name="Tax &amp; Duty"/g)).toHaveLength(1);
    expect(() => writeSqlDataSource(report, { ...named, details: [{ ...named.details![0], name: 'Lines[' }] })).not.toThrow();
  });

  it('refuses a connection string, a query with nothing to print, and text that is not a report', () => {
    // In plain words, with no configuration file's element named (2026-11-11, the full audit's SDW follow-up).
    expect(writeSqlDataSource(report, { ...spec, connectionName: 'Data Source=srv;Password=x' }).reason).toBe('the connection needs the name your application knows the database by, not a server, a login or a password');
    expect(writeSqlDataSource(report, { ...spec, query: { kind: 'procedure', procedure: 'dbo.usp_Nothing' } }).reason).toMatch(/has no columns Forma can read/);
    expect(writeSqlDataSource('<root/>', spec).applied).toBe(false);
  });
});

describe('a stored login', () => {
  it('is found by the audit and stripped to the connection’s name', () => {
    const b64 = Buffer.from('<SqlDataSource Name="s"><Connection Name="Main" ProviderKey="MSSqlServer"><Parameters><Parameter Name="server" Value="srv" /><Parameter Name="userid" Value="u" /><Parameter Name="password" Value="p" /></Parameters></Connection><ConnectionOptions CloseConnection="true" /></SqlDataSource>', 'utf8').toString('base64');
    const withLogin = report.replace('</XtraReportsLayoutSerializer>', `<ComponentStorage><Item1 Ref="9" ObjectType="DevExpress.DataAccess.Sql.SqlDataSource,DevExpress.DataAccess.v20.1" Name="s" Base64="${b64}" /></ComponentStorage></XtraReportsLayoutSerializer>`);
    expect(auditDataSources(withLogin).map((f) => f.code)).toEqual(['connection-has-credentials', 'schema-missing']);
    const fixed = stripStoredCredentials(withLogin);
    expect(fixed.applied).toBe(true);
    const [ds] = readRepxDataSources(fixed.xml);
    expect(ds).toMatchObject({ connectionName: 'Main', fromAppConfig: true, storesCredentials: false });
    expect(Buffer.from(/Base64="([^"]*)"/.exec(fixed.xml)![1], 'base64').toString('utf8')).not.toMatch(/srv|password/);
    expect(stripStoredCredentials(report).applied).toBe(false);
  });
});

describe('the audit of a data source', () => {
  it('finds a field the band’s query lacks, a parameter nothing supplies and a query that is not there', () => {
    const written = writeSqlDataSource(report, { ...spec, lookups: [] }).xml;
    const wrongField = written.replace('Expression="[CompanyName]"', 'Expression="[CompanyNam]"');
    expect(auditDataSources(wrongField)).toEqual([{ severity: 'warning', code: 'field-not-in-schema', message: '[CompanyNam] is bound in a band reading "Orders", which returns no field of that name, so it prints blank.' }]);
    const inDetail = written.replace('Expression="[Qty]"', 'Expression="[Freight]"');
    expect(auditDataSources(inDetail).map((f) => f.message)).toEqual(['[Freight] is bound in a band reading "OrderLines", which returns no field of that name, so it prints blank.']);
    const noParam = written.replace(/<Parameters>[\s\S]*?<\/Parameters>/, '');
    expect(auditDataSources(noParam).map((f) => f.code)).toEqual(['query-param-unbound']);
    const wrongMember = written.replace('DataMember="Orders" DataSource=', 'DataMember="Invoices" DataSource=');
    expect(auditDataSources(wrongMember).map((f) => f.code)).toContain('datamember-unknown');
  });
});

describe('what the application needs', () => {
  it('is a connectionStrings entry by name, and the Spec says so', () => {
    expect(connectionStringsSnippet(['ShopDemo', 'ShopDemo'])).toBe('<connectionStrings>\n    <add name="ShopDemo" providerName="System.Data.SqlClient" connectionString="Data Source=YOUR_SERVER;Initial Catalog=ShopDemo;Integrated Security=True" />\n</connectionStrings>');
    const spec2 = specFromRepx(writeSqlDataSource(report, spec).xml, 'R');
    expect(spec2).toContain('**Data source**: SQL Server, connection "ShopDemo", by name. Reads Orders (Orders, Customers); OrderLines (OrderLines); RegionsList (Customers). Master-detail: Orders to OrderLines.');
    expect(spec2).toContain('<add name="ShopDemo"');
    expect(spec2).toContain('XtraReport.FromFile("report.repx", true)');
  });
});

describe('the Mockup and the audit on a detail band', () => {
  it('count the same sections: the DetailReportBand holds bands and is not one', async () => {
    const { auditRepx } = await import('./repxAudit');
    const { layoutFromRepx } = await import('./repxViews');
    const xml = writeSqlDataSource(report, spec).xml;
    const codes = auditRepx(xml, layoutFromRepx(xml, 'R')).findings.map((f) => f.code);
    expect(codes).not.toContain('band-section-mismatch');
  });
});