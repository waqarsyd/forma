/**
 * The AI and a shared SQL Server database (2026-11-09, the SQL Server
 * programme, batch DE): what it is shown, the query it names held to the
 * layout, custom SQL held to the layout, the data source written from its
 * answer, and the chat's `data` and `group` edits. Reports written this way
 * were filled and printed by DevExpress 20.1 over the made-up FormaSample on
 * LocalDB (`RepxProbe sql-fill`): a group on Region printed its header and a
 * total of 32.75 over two orders, and a report bound by a data edit to a
 * stored procedure printed its two rows. The layout here is made up.
 */
import { describe, expect, it } from 'vitest';
import { readSchemaScript, withSamples } from './sqlSchema';
import {
  chatSection,
  checkSqlAgainstSchema,
  dataEditHook,
  designSection,
  guessQuery,
  layoutFor,
  queryFromJson,
  queryToJson,
  rankObjects,
  writeFromAnswer,
} from './databaseAi';
import { takeQueryInstruction } from './analysisResponse';
import { applyEdits, describeChanges } from './agentEdit';
import { auditRepx } from './repxAudit';
import { readRepxDataSources } from './repxSqlDataSource';
import { writeSqlDataSource } from './repxSqlWriter';
import { parseReportStructure } from './reportPreview';
import type { ReportQuery } from './sqlQuery';

const layout = readSchemaScript(`
CREATE TABLE dbo.Customers (CustomerID int NOT NULL PRIMARY KEY, CompanyName nvarchar(80) NOT NULL, Region nvarchar(20) NULL, Phone nvarchar(24) NULL);
CREATE TABLE dbo.Orders (OrderID int NOT NULL PRIMARY KEY, CustomerID int NULL REFERENCES dbo.Customers(CustomerID), OrderDate datetime NOT NULL, Freight decimal(10,2) NOT NULL);
CREATE TABLE dbo.OrderLines (OrderID int NOT NULL REFERENCES dbo.Orders(OrderID), LineNumber int NOT NULL, Qty int NOT NULL);
CREATE TABLE dbo.Suppliers (SupplierID int NOT NULL PRIMARY KEY, CompanyName nvarchar(80) NOT NULL);
CREATE PROCEDURE dbo.usp_SalesByRegion @Region nvarchar(20) = NULL AS SELECT 1;
`, 'ShopDemo')!;
layout.procedures[0].result = [{ name: 'Region', type: 'nvarchar', length: 20 }, { name: 'Total', type: 'decimal', precision: 38, scale: 2 }];
const schema = withSamples(layout, {
  'dbo.Customers': [{ CustomerID: 1, CompanyName: 'Example Traders', Region: 'North', Phone: '555-0101' }, { CustomerID: 2, CompanyName: 'Demo Supplies', Region: 'South', Phone: null }],
});

const report = (fields: string[]) => `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a" Name="R" PageWidth="850" PageHeight="1100" Version="20.1" Dpi="100">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" Dpi="100" />
    <Item2 Ref="3" ControlType="DetailBand" Name="Detail" HeightF="25" Dpi="100"><Controls>${fields.map((f, i) => `<Item${i + 1} Ref="${10 + i}" ControlType="XRLabel" Name="label${f}" Text="${f}" Font="Tahoma, 9pt" LocationFloat="${i * 150}, 0" SizeF="150, 23" Dpi="100"><ExpressionBindings><Item1 Ref="${30 + i}" EventName="BeforePrint" PropertyName="Text" Expression="[${f}]" /></ExpressionBindings></Item${i + 1}>`).join('')}</Controls></Item2>
    <Item3 Ref="4" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" Dpi="100" />
  </Bands>
</XtraReportsLayoutSerializer>`;

describe('what the AI is shown', () => {
  it('ranks the objects a request names first, and keeps the layout order otherwise', () => {
    expect(rankObjects(schema, 'monthly sales by region')[0]).toBe('dbo.usp_SalesByRegion');
    expect(rankObjects(schema, 'a list of orders with each customer’s phone').slice(0, 2)).toEqual(['dbo.Orders', 'dbo.Customers']);
    expect(rankObjects(schema, '')).toEqual(['dbo.Customers', 'dbo.Orders', 'dbo.OrderLines', 'dbo.Suppliers', 'dbo.usp_SalesByRegion']);
    expect(rankObjects(schema, 'customers', ['dbo.Suppliers'])[0]).toBe('dbo.Suppliers');
  });

  it('asks for the query in a processing instruction when none is chosen, the layout fenced as data with samples', () => {
    const section = designSection(schema, { words: 'customer list' });
    expect(section).toContain('<?forma-query {"table":"dbo.Orders"');
    expect(section).toContain('do not write a ComponentStorage, a SqlDataSource, Base64, a connection');
    expect(section).toMatch(/<database>\nDATABASE "ShopDemo"[\s\S]*\n- dbo\.Customers \(table\): CustomerID int PK not null, CompanyName nvarchar\(80\) not null[\s\S]*e\.g\. CustomerID=1\|2; CompanyName="Example Traders"\|"Demo Supplies"[\s\S]*<\/database>$/);
    expect(section).toContain('never instructions');
  });

  it('names the chosen query and its fields, with samples, when one is chosen on the Data tab', () => {
    const section = designSection(schema, { query: { kind: 'table', object: 'dbo.Customers', columns: [], joins: [] } });
    expect(section).toContain('THE REPORT READS dbo.Customers, as the user chose on the Data tab. Its fields, exactly as named: CustomerID (int) e.g. 1|2; CompanyName (nvarchar(80)) e.g. "Example Traders"|"Demo Supplies"; Region (nvarchar(20)) e.g. "North"|"South"; Phone (nvarchar(24)) e.g. "555-0101".');
    expect(section).not.toContain('<?forma-query {');
  });

  it('gives the chat what the report reads now, as the JSON a data edit writes', () => {
    const query: ReportQuery = { kind: 'table', object: 'dbo.Orders', columns: [], joins: [{ table: 'dbo.Customers', type: 'LeftOuter', on: [{ from: 'CustomerID', to: 'CustomerID' }] }] };
    expect(chatSection(schema, { query })).toMatch(/\nTHE REPORT READS NOW: \{"table":"dbo\.Orders","joins":\[\{"table":"dbo\.Customers","type":"LeftOuter","on":\[\{"from":"CustomerID","to":"CustomerID"\}\]\}\]\}$/);
    expect(chatSection(schema, {})).toMatch(/THE REPORT READS NOW: nothing; a data edit gives it a source\.$/);
    expect(layoutFor(schema, 'suppliers').split('\n')[1]).toMatch(/^- dbo\.Suppliers \(table\)/);
  });
});

describe('the query the AI names', () => {
  it('is lifted out of its answer before the REPX is read', () => {
    const taken = takeQueryInstruction('<?forma-query {"table":"Orders"}?>\n<?xml version="1.0"?><XtraReportsLayoutSerializer />');
    expect(taken).toEqual({ text: '<?xml version="1.0"?><XtraReportsLayoutSerializer />', query: { table: 'Orders' } });
    expect(takeQueryInstruction('<XtraReportsLayoutSerializer />')).toEqual({ text: '<XtraReportsLayoutSerializer />' });
  });

  it('is held to the layout and written back as the layout spells it, a join’s columns from the foreign key', () => {
    const read = queryFromJson({ table: 'orders', joins: [{ table: 'Customers', type: 'left' }], filter: '[Region] = ?Region', sort: [{ column: 'orderdate', descending: true }], top: 50, details: [{ table: 'OrderLines' }] }, schema);
    expect(read).toEqual({
      query: {
        kind: 'table',
        object: 'dbo.Orders',
        columns: [],
        joins: [{ table: 'dbo.Customers', type: 'LeftOuter', on: [{ from: 'CustomerID', to: 'CustomerID' }] }],
        filter: '[Customers.Region] = ?Region',
        sort: [{ column: 'dbo.Orders.OrderDate', descending: true }],
        top: 50,
        details: [{ table: 'dbo.OrderLines', type: 'Inner', on: [{ from: 'OrderID', to: 'OrderID' }] }],
      },
      problems: [],
    });
    expect(queryToJson(read.query!)).toMatchObject({ table: 'dbo.Orders', filter: '[Customers.Region] = ?Region', top: 50 });
    expect(queryFromJson(JSON.stringify(queryToJson(read.query!)), schema).query).toEqual(read.query);
  });

  it('drops what it cannot hold, says so, and refuses a table, procedure or SQL the layout lacks', () => {
    const read = queryFromJson({ table: 'dbo.Orders', joins: [{ table: 'dbo.Invoices' }], columns: ['OrderID', 'Nope'], filter: '[Orders.Discount] > 0' }, schema);
    expect(read.query).toMatchObject({ object: 'dbo.Orders', joins: [], columns: ['dbo.Orders.OrderID'] });
    expect(read.query).not.toHaveProperty('filter');
    expect(read.problems).toEqual([
      'the join to dbo.Invoices: ShopDemo has no such table',
      'the column "Nope": the query\'s tables have no such column',
      'the filter: it names [Orders.Discount], which the query does not have',
    ]);
    expect(queryFromJson({ table: 'dbo.Invoices' }, schema).problems).toEqual(['there is no table or view "dbo.Invoices" in the database ShopDemo']);
    expect(queryFromJson({ procedure: 'usp_Nothing' }, schema).query).toBeNull();
    expect(queryFromJson({ procedure: 'usp_SalesByRegion' }, schema).query).toEqual({ kind: 'procedure', procedure: 'dbo.usp_SalesByRegion' });
    expect(queryFromJson({ sql: 'DELETE FROM dbo.Orders' }, schema).query).toBeNull();
    expect(queryFromJson({ name: 'Big Ones!', sql: 'SELECT OrderID FROM dbo.Orders WHERE Freight > @Min' }, schema).query).toEqual({ kind: 'custom', name: 'BigOnes', sql: 'SELECT OrderID FROM dbo.Orders WHERE Freight > @Min' });
    expect(queryFromJson('not json', schema).problems).toEqual(['the query was not a JSON object']);
  });

  it('or, when it named none, the object holding most of what the report binds', () => {
    expect(guessQuery(schema, ['CompanyName', 'Region', 'Phone'])).toEqual({ kind: 'table', object: 'dbo.Customers', columns: [], joins: [] });
    expect(guessQuery(schema, ['Region', 'Total'])).toEqual({ kind: 'procedure', procedure: 'dbo.usp_SalesByRegion' });
    expect(guessQuery(schema, ['Company', 'Balance', 'Notes'])).toBeNull();
  });
});

describe('custom SQL against the layout', () => {
  it('passes what the layout has: aliases, joins, computed columns, an alias used in ORDER BY, functions and parameters', () => {
    expect(checkSqlAgainstSchema('SELECT o.OrderID, c.CompanyName FROM dbo.Orders o JOIN dbo.Customers AS c ON c.CustomerID = o.CustomerID WHERE c.Region = @Region', schema)).toEqual([]);
    expect(checkSqlAgainstSchema('SELECT OrderID, Freight * 2 AS Doubled, YEAR(OrderDate) AS Y FROM dbo.Orders ORDER BY Doubled DESC', schema)).toEqual([]);
    expect(checkSqlAgainstSchema("SELECT [CompanyName], COUNT(*) AS N FROM [dbo].[Customers] WHERE Region <> N'it''s' GROUP BY [CompanyName]", schema)).toEqual([]);
    expect(checkSqlAgainstSchema('WITH t AS (SELECT CustomerID FROM dbo.Customers) SELECT t.Anything FROM t', schema)).toEqual([]);
  });

  it('refuses a table, a column or an alias it does not have, and a procedure read as a table', () => {
    expect(checkSqlAgainstSchema('SELECT * FROM dbo.Invoices', schema)).toEqual(['there is no table or view "dbo.Invoices" in ShopDemo']);
    expect(checkSqlAgainstSchema('SELECT o.OrderNumber FROM dbo.Orders o', schema)).toEqual(['dbo.Orders has no column "OrderNumber"']);
    expect(checkSqlAgainstSchema('SELECT Discount FROM dbo.Orders', schema)).toEqual(['no table of the query has a column "Discount"']);
    expect(checkSqlAgainstSchema('SELECT x.OrderID FROM dbo.Orders o', schema)).toEqual(['"x" in x.OrderID is not a table or alias of the query']);
    expect(checkSqlAgainstSchema('SELECT * FROM dbo.usp_SalesByRegion', schema)[0]).toMatch(/is a stored procedure/);
  });
});

describe('the data source written from the answer', () => {
  /** The full audit's SD-04 and CV-23 (2026-11-11): the note is said in the reply, so it names no machinery. */
  const machinery = /the AI (chose|named)|AI model|gemini-2\.|tried the other models|from the (query|object)/;

  it('from the query the AI named, saying what was left out', () => {
    const out = writeFromAnswer(report(['OrderID', 'CompanyName']), schema, { dataQuery: { table: 'dbo.Orders', joins: [{ table: 'dbo.Customers' }], filter: '[Nope] = 1' } });
    expect(out.note).toBe('Bound it to Orders on "ShopDemo". Left out the filter: it names [Nope], which the query does not have.');
    expect(out.note).not.toMatch(machinery);
    const join = writeFromAnswer(report(['OrderID']), schema, { dataQuery: { table: 'dbo.Orders', joins: [{ table: 'Sales' }] } });
    expect(join.note).toBe('Bound it to Orders on "ShopDemo". Left out the join to Sales: ShopDemo has no such table.');
    const withParameter = writeFromAnswer(report(['Region', 'Total']), schema, { dataQuery: { procedure: 'dbo.usp_SalesByRegion' } });
    expect(withParameter.note).toBe('Bound it to SalesByRegion on "ShopDemo" with the parameter Region.');
    expect(out.query).toMatchObject({ object: 'dbo.Orders', joins: [{ table: 'dbo.Customers' }] });
    expect(readRepxDataSources(out.xml)[0]).toMatchObject({ connectionName: 'ShopDemo', fromAppConfig: true });
  });

  it('from the query chosen on the Data tab over the AI’s, keeping a connection name the report already has', () => {
    // The user named the connection "ShopLive" on the Data tab; a later generation keeps it.
    const named = writeSqlDataSource(report(['CompanyName']), { connectionName: 'ShopLive', schema, query: { kind: 'table', object: 'dbo.Customers', columns: [], joins: [] } }).xml;
    const chosen: ReportQuery = { kind: 'table', object: 'dbo.Suppliers', columns: [], joins: [] };
    const out = writeFromAnswer(named, schema, { query: chosen, dataQuery: { table: 'dbo.Customers' } });
    expect(out.note).toBe('Bound it to Suppliers on "ShopLive".');
  });

  it('from the object holding most of what it bound, or not at all, saying why', () => {
    expect(writeFromAnswer(report(['CompanyName', 'Phone']), schema).note).toBe('Bound it to Customers on "ShopDemo".');
    const none = writeFromAnswer(report(['Company', 'Balance']), schema, { dataQuery: { table: 'dbo.Invoices' } });
    expect(none.query).toBeNull();
    expect(none.note).toBe('It is not bound to ShopDemo yet: there is no table or view "dbo.Invoices" in the database ShopDemo. Choose what it reads on the Data tab.');
    const unnamed = writeFromAnswer(report(['Company', 'Balance']), schema);
    expect(unnamed.note).toBe('It is not bound to ShopDemo yet: no table or procedure has most of the fields it prints. Choose what it reads on the Data tab.');
    for (const note of [none.note, unnamed.note]) expect(note).not.toMatch(machinery);
  });

  // SD-04's review (2026-11-11): a refused query is not "left out" of a report bound to something else.
  it('says nothing of a refused query when another object is bound in its place', () => {
    const fields = report(['CompanyName', 'Phone']);
    for (const dataQuery of [{ table: 'dbo.Invoices' }, 'not json', { name: 'Gone', sql: 'DELETE FROM dbo.Customers' }]) {
      const out = writeFromAnswer(fields, schema, { dataQuery });
      expect(out.note).toBe('Bound it to Customers on "ShopDemo".');
      expect(out.note).not.toMatch(/Left out|JSON|SELECT|\.\./);
    }
  });

  it('says a refused query plainly when nothing could be bound instead', () => {
    const fields = report(['Company', 'Balance']);
    for (const dataQuery of ['not json', { name: 'Gone', sql: 'DELETE FROM dbo.Customers' }]) {
      const out = writeFromAnswer(fields, schema, { dataQuery });
      expect(out.note).toBe('It is not bound to ShopDemo yet: no table or procedure has most of the fields it prints. Choose what it reads on the Data tab.');
    }
  });
});

describe('the chat’s database edits', () => {
  it('a data edit writes the source, tells App the query and is said in the Changed list', () => {
    let told: ReportQuery | null = null;
    const hooks = { data: dataEditHook(schema, '20.1', (q) => { told = q; }) };
    const before = report(['Region', 'Total']);
    const done = applyEdits(before, [{ op: 'bind', control: 'labelRegion', field: 'Region' }, { op: 'data', query: { procedure: 'dbo.usp_SalesByRegion' } }], hooks);
    expect(done.applied[0]).toBe('wrote the data source: SalesByRegion on connection "ShopDemo", with parameter Region');
    expect(told).toEqual({ kind: 'procedure', procedure: 'dbo.usp_SalesByRegion' });
    expect(describeChanges(before, done.xml)[0]).toBe('the report now reads SalesByRegion on connection "ShopDemo"');
    expect(auditRepx(done.xml, null).findings.map((f) => f.code)).not.toContain('field-not-in-schema');
  });

  it('a data edit with no database shared, or one the layout cannot hold, is declined with why', () => {
    expect(applyEdits(report(['Region']), [{ op: 'data', query: { table: 'dbo.Orders' } }]).declined[0]).toMatch(/^data: no database is shared with the AI/);
    const hooks = { data: dataEditHook(schema, '20.1', () => {}) };
    expect(applyEdits(report(['Region']), [{ op: 'data', query: { table: 'dbo.Invoices' } }], hooks).declined).toEqual(['data: there is no table or view "dbo.Invoices" in the database ShopDemo']);
  });

  it('a group goes before Detail with its total after, in print order, and a second one outside it', () => {
    const base = writeFromAnswer(report(['OrderID', 'Freight']), schema, { dataQuery: { table: 'dbo.Orders', joins: [{ table: 'dbo.Customers' }] } }).xml;
    const once = applyEdits(base, [{ op: 'group', field: 'Region', total: 'Freight' }]);
    expect(once.applied).toEqual(['grouped the report by [Region], with a total of [Freight] for each']);
    const bands = parseReportStructure(once.xml).bands;
    expect(bands.map((b) => b.kind)).toEqual(['TopMargin', 'GroupHeader', 'Detail', 'GroupFooter', 'BottomMargin']);
    expect(bands[1].fields.map((f) => f.field)).toEqual(['Region']);
    expect(bands[1].level).toBe(0);
    expect(once.xml).toMatch(/<Item2 Ref="\d+" ControlType="GroupHeaderBand" Name="GroupHeaderRegion" HeightF="25" Dpi="100"><GroupFields><Item1 Ref="\d+" FieldName="Region" \/><\/GroupFields><Controls>/);
    expect(once.xml).toMatch(/<Summary Ref="\d+" Running="Group" \/><ExpressionBindings><Item1 Ref="\d+" EventName="BeforePrint" PropertyName="Text" Expression="sumSum\(\[Freight\]\)" \/>/);
    expect(once.xml).toMatch(/<Item3 Ref="3" ControlType="DetailBand"[\s\S]*<Item4 Ref="\d+" ControlType="GroupFooterBand"[\s\S]*<Item5 Ref="4" ControlType="BottomMarginBand"/);
    const codes = auditRepx(once.xml, null).findings.map((f) => f.code);
    expect(codes).not.toContain('band-order');
    expect(codes).not.toContain('field-not-in-schema');
    // By its kind in words since the re-audit's R1-10 (2026-11-11), not the designer's band name.
    expect(describeChanges(base, once.xml)[0]).toBe('added a group footer');
    expect(describeChanges(base, once.xml)).toContain('added a group header, grouping by [Region]');

    const twice = applyEdits(once.xml, [{ op: 'group', field: 'CompanyName' }]);
    const outer = parseReportStructure(twice.xml).bands.find((b) => b.fields.some((f) => f.field === 'CompanyName'))!;
    expect(outer.level).toBe(1);
    expect(applyEdits(twice.xml, [{ op: 'group', field: 'region' }]).declined).toEqual(['group: the report already groups by [region]']);
    expect(applyEdits(once.xml, [{ op: 'group', field: '[Bad"Name]' }]).declined[0]).toMatch(/is not a field name/);
  });

  it('a group on a field the query lacks is found by the audit, and a parameter the query uses is not unused', () => {
    const base = writeFromAnswer(report(['OrderID']), schema, { dataQuery: { table: 'dbo.Orders', filter: '[Orders.Freight] > ?Min' } }).xml;
    const codes = auditRepx(base, null).findings.map((f) => f.code);
    expect(codes).not.toContain('unused-parameter');
    const grouped = applyEdits(base, [{ op: 'group', field: 'Region' }]).xml;
    expect(auditRepx(grouped, null).findings.find((f) => f.code === 'field-not-in-schema')?.message).toBe('[Region] is bound in a band reading "Orders", which returns no field of that name, so it prints blank.');
  });
});
