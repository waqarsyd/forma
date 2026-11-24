/**
 * A database's layout on Forma's Node side, function by function
 * (2026-11-24, the CLI and Forma Designer work's wave 5; findings D1-2,
 * D1-7, D1-9 and GAP1-5 of its design audit): the one reader with the query
 * a caller pins, the binding read back from a report as written, a binding
 * with no AI, and an SSRS report's own DataSet. cliDatabase.test.ts runs
 * them through the command line; these are the edges it does not reach.
 * Over the real FormaSample captures (lib/sqlFixtures.ts).
 */
import { describe, expect, it } from 'vitest';
import { designerNote, writeFromAnswer } from '../lib/databaseAi';
import { MAX_LAYOUT_BYTES } from '../lib/layoutFile';
import { readRepxDataSources } from '../lib/repxSqlDataSource';
import { EMITTED_REPX, SAMPLE_EXPORT, SCHEMA_EXPORT } from '../lib/sqlFixtures';
import { readSchemaExport } from '../lib/sqlSchema';
import { ToolRefusal } from './caller';
import { MAX_LAYOUT_FILE_BYTES, WHERE, bindReport, bindingOf, pinnedQuery, rdlDataSets, readDatabase, recordWrites, renameFields, sameQuery, type DatabaseJob } from './nodeDatabase';

const schema = readSchemaExport(SCHEMA_EXPORT)!;
const bytes = (text: string) => new TextEncoder().encode(text);
const job = (layout: string, extra: Partial<DatabaseJob> = {}): DatabaseJob => ({ layout: { name: 'formasample.txt', bytes: bytes(layout) }, samples: [], query: null, ...extra });

const report = (fields: string[]) => `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="R" PageWidth="850" PageHeight="1100" Version="20.1">
  <Bands><Item1 Ref="3" ControlType="DetailBand" Name="Detail" HeightF="25"><Controls>${fields.map((f, i) => `<Item${i + 1} Ref="${10 + i}" ControlType="XRLabel" Name="l${i}" LocationFloat="${i * 150}, 0" SizeF="150, 23"><ExpressionBindings><Item1 Ref="${30 + i}" EventName="BeforePrint" PropertyName="Text" Expression="[${f}]" /></ExpressionBindings></Item${i + 1}>`).join('')}</Controls></Item1></Bands>
</XtraReportsLayoutSerializer>`;

describe('the reader, and the query a caller pins', () => {
  it('names the reader\'s own limit on the thread that judges paths, which never loads the reader', () => {
    expect(MAX_LAYOUT_FILE_BYTES).toBe(MAX_LAYOUT_BYTES);
  });

  it('reads the layout and the sample rows passed beside it, and refuses in the reader\'s words before any AI is asked', async () => {
    const read = await readDatabase(job(SCHEMA_EXPORT, { samples: [{ name: 'rows.txt', bytes: bytes(SAMPLE_EXPORT) }] }), 'cli');
    expect(read.said).toEqual([
      'Database layout read from "formasample.txt": FormaSample: 3 tables, 1 view, 5 procedures (1 whose result cannot be read: a temp table).',
      'Sample rows read for FormaSample from "rows.txt": dbo.Orders (3 rows), dbo.vOrderTotals (3 rows).',
    ]);
    expect(read.schema.samples?.['dbo.Orders']).toHaveLength(3);
    await expect(readDatabase(job('just words'), 'cli')).rejects.toThrow(/^"formasample\.txt" is not a database layout: .* Nothing was asked of the AI, and nothing written\.$/);
    await expect(readDatabase(job(SCHEMA_EXPORT, { connectionName: 'a=b' }), 'mcp')).rejects.toThrow(/^A connection name cannot hold ; or =.* Nothing was asked of the AI\.$/);
    await expect(readDatabase(job(SCHEMA_EXPORT, { query: { table: 'dbo.Orders' } }), 'cli')).resolves.toMatchObject({ query: { kind: 'table', object: 'dbo.Orders' } });
  });

  it('refuses a pinned query with any part the layout lacks, rather than bind what the person did not ask for', async () => {
    await expect(pinnedQuery({ table: 'dbo.Orders', columns: ['Freight', 'Nope'] }, schema, 'cli')).rejects.toThrow(
      /^Part of the query given is not in the layout, so it was not bound: left out the column "Nope": the query's tables have no such column; give another with --procedure, --query or --object\./,
    );
    await expect(pinnedQuery({ procedure: 'dbo.usp_TempTable' }, schema, 'mcp')).rejects.toBeInstanceOf(ToolRefusal);
    await expect(pinnedQuery({}, schema, 'mcp')).rejects.toThrow(/^The query given cannot be bound: the query names no table, view, procedure or SQL; name another in the request\./);
    await expect(pinnedQuery({ name: 'Top', sql: 'SELECT TOP 5 CompanyName FROM dbo.Customers' }, schema, 'cli')).resolves.toMatchObject({ kind: 'custom', name: 'Top' });
  });

  it('says where to choose a query in each caller\'s words, never the Data tab\'s', () => {
    for (const where of Object.values(WHERE)) expect(JSON.stringify(where)).not.toContain('Data tab');
    expect(WHERE.cli.choose).toBe('with --procedure, --query or --object');
  });
});

describe('the binding, read back from the report as written (D1-9)', () => {
  it('is what the file holds: the query, the connection by name, the parameters it reads, and what was left out', async () => {
    const written = writeFromAnswer(report(['OrderID', 'Freight']), schema, { dataQuery: { table: 'dbo.Orders', columns: ['OrderID', 'Freight', 'Nope'] } });
    expect(written.leftOut).toEqual(['the column "Nope": the query\'s tables have no such column']);
    expect(await bindingOf(written.xml, schema, written)).toEqual({
      bound: true,
      database: 'FormaSample',
      query: { table: 'dbo.Orders', columns: ['dbo.Orders.OrderID', 'dbo.Orders.Freight'] },
      connection: 'FormaSample',
      designerFills: true,
      parameters: [],
      leftOut: ['the column "Nope": the query\'s tables have no such column'],
      notes: [],
    });
    // A report DevExpress's own emitter wrote: its main query, read back and held to the layout, and the parameters its source reads.
    expect(await bindingOf(EMITTED_REPX, schema)).toMatchObject({ bound: true, query: { table: 'dbo.Orders' }, connection: 'FormaSample', parameters: ['Region', 'To'] });
  });

  it('says why not: no source, the write\'s own reason, or a source reading what the layout does not have', async () => {
    expect(await bindingOf(report(['A']), schema)).toEqual({ bound: false, database: 'FormaSample', reason: 'The report reads no SQL data source.', notes: [] });
    const unbound = writeFromAnswer(report(['A']), schema, { dataQuery: { table: 'dbo.Nope' } });
    expect(await bindingOf(unbound.xml, schema, unbound)).toEqual({ bound: false, database: 'FormaSample', reason: unbound.note, notes: [] });
    const other = { ...schema, objects: schema.objects.filter((o) => o.name !== 'Orders') };
    expect(await bindingOf(EMITTED_REPX, other)).toMatchObject({ bound: false, reason: expect.stringMatching(/^It reads Orders, which FormaSample does not have: there is no table or view "dbo\.Orders"/) });
  });

  it('is held to the layout of the last write, else the one given, else none', async () => {
    const seen = recordWrites();
    expect(await seen.bindingOf(EMITTED_REPX, null)).toBeNull();
    expect(await seen.bindingOf(EMITTED_REPX, schema)).toMatchObject({ bound: true });
    const written = writeFromAnswer(report(['CompanyName']), schema, { dataQuery: { table: 'dbo.Customers' } });
    seen.onWritten(written, schema);
    expect(await seen.bindingOf(written.xml, null)).toMatchObject({ bound: true, query: { table: 'dbo.Customers' } });
    expect(await sameQuery(null, null)).toBe(true);
    expect(await sameQuery({ kind: 'procedure', procedure: 'dbo.a' }, { kind: 'procedure', procedure: 'dbo.a' })).toBe(true);
  });

  it('binds with no AI at the version given, and keeps a report\'s own connection, saying so when another was given', async () => {
    const bound = await bindReport(report(['Region', 'Total']), schema, { kind: 'procedure', procedure: 'dbo.usp_SalesByRegion' }, { version: '20.1', voice: 'cli', connectionName: 'ShopLive' });
    expect(bound.binding).toMatchObject({ bound: true, connection: 'ShopLive', designerFills: true, parameters: ['Region', 'From', 'To'], notes: [] });
    const kept = await bindReport(EMITTED_REPX, schema, { kind: 'table', object: 'dbo.Customers', columns: [], joins: [] }, { version: '20.1', voice: 'mcp', connectionName: 'ShopLive' });
    expect(readRepxDataSources(kept.xml)[0].connectionName).toBe('FormaSample');
    // In the binding's notes, never a plain notice: its words name the files' names (W5-PB-11).
    expect(kept.binding.notes).toEqual([
      'The report already names its connection "FormaSample", which is kept; connectionName names the connection of a report that names none.',
      // Its detail report read the orders' lines, which a source of the customers does not have (BT-2).
      'Removed the detail report DetailReport, which read Orders.OrderLinesOfOrder, a relation the new source does not have.',
    ]);
    const none = await bindReport(report(['A']), schema, null, { version: '20.1', voice: 'cli' });
    expect(none).toMatchObject({ binding: { bound: false }, xml: report(['A']) });
  });

  it('says a connection Forma Designer cannot fill under every binding, read from the report written (BT-7, W5-PB-12)', async () => {
    const spaced = await bindReport(report(['CompanyName']), schema, { kind: 'table', object: 'dbo.Customers', columns: [], joins: [] }, { version: '20.1', voice: 'cli', connectionName: 'My Shop' });
    expect(spaced.binding).toMatchObject({ bound: true, connection: 'My Shop', designerFills: false });
    expect(spaced.binding.notes).toEqual([designerNote('My Shop')]);
    // The same from a generation's write, read back by recordWrites.
    const seen = recordWrites();
    const written = writeFromAnswer(report(['CompanyName']), { ...schema, database: 'My Shop' }, { dataQuery: { table: 'dbo.Customers' } });
    seen.onWritten(written, schema);
    expect(await seen.bindingOf(written.xml, null)).toMatchObject({ bound: true, designerFills: false, notes: [designerNote('My Shop')] });
  });

  it('is not bound while a detail report reads a member its source lacks, which DevExpress cannot print (BT-2)', async () => {
    const orders = await bindReport(report(['OrderID']), schema, { kind: 'table', object: 'dbo.Orders', columns: [], joins: [], details: [{ table: 'dbo.OrderLines', type: 'Inner', on: [{ from: 'OrderID', to: 'OrderID' }] }] }, { version: '20.1', voice: 'cli' });
    expect(orders.binding).toMatchObject({ bound: true });
    expect(orders.xml).toContain('DataMember="Orders.OrderLinesOfOrders"');
    // A detail band left on a relation the source does not have, as the writer left it before the wave-5 review.
    const stale = orders.xml.replace('DataMember="Orders.OrderLinesOfOrders"', 'DataMember="Orders.GoneOfOrders"');
    expect(await bindingOf(stale, schema)).toMatchObject({ bound: false, reason: expect.stringMatching(/^the detail report DetailReportOrderLinesOfOrders reads Orders\.GoneOfOrders, which its data source has no query or relation for/) });
    // Bound again to a view, the detail report goes with the relation, and says so; the binding holds.
    const view = await bindReport(orders.xml, schema, { kind: 'table', object: 'dbo.vOrderTotals', columns: [], joins: [] }, { version: '20.1', voice: 'cli' });
    expect(view.binding).toMatchObject({ bound: true, query: { table: 'dbo.vOrderTotals' } });
    expect(view.xml).not.toContain('DetailReportBand');
    expect(view.binding.notes).toEqual(['Removed the detail report DetailReportOrderLinesOfOrders, which read Orders.OrderLinesOfOrders, a relation the new source does not have.']);
  });
});

describe("an SSRS report's own DataSet (GAP1-5)", () => {
  it('reads each DataSet, its command, and its fields with the columns they read, and which one the first table reads; never its data source', async () => {
    const rdl = `<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2005/01/reportdefinition" xmlns:rd="x">
      <DataSources><DataSource Name="S"><ConnectionProperties><ConnectString>Password=Secret123</ConnectString></ConnectionProperties></DataSource></DataSources>
      <DataSets>
        <DataSet Name="One"><Query><CommandText>SELECT 1 AS A</CommandText></Query><Fields><Field Name="A"><DataField>A</DataField><rd:TypeName>System.Int32</rd:TypeName></Field></Fields></DataSet>
        <DataSet Name="Two"><Query><CommandType>StoredProcedure</CommandType><CommandText> dbo.usp_X </CommandText></Query><Fields><Field Name="Shown"><DataField>Real</DataField></Field><Field Name="Same" /></Fields></DataSet>
      </DataSets>
      <Body><ReportItems><Rectangle Name="r"><ReportItems><Table Name="T"><DataSetName>Two</DataSetName></Table></ReportItems></Rectangle></ReportItems></Body>
    </Report>`;
    const read = await rdlDataSets(rdl);
    expect(read).toEqual({
      region: 'Two',
      sets: [
        { name: 'One', commandType: 'Text', commandText: 'SELECT 1 AS A', fields: [{ name: 'A', dataField: 'A' }] },
        { name: 'Two', commandType: 'StoredProcedure', commandText: 'dbo.usp_X', fields: [{ name: 'Shown', dataField: 'Real' }, { name: 'Same', dataField: 'Same' }] },
      ],
    });
    expect(JSON.stringify(read)).not.toContain('Secret123');
    expect(await rdlDataSets('<NotAReport/>')).toEqual({ sets: [], region: null });
    expect(await rdlDataSets('not xml')).toEqual({ sets: [], region: null });
  });

  it('renames a field in every expression and group, and leaves a column with a bracket as it is', async () => {
    const xml = '<a Expression="[SalesTotal] * 2 + sumSum([SalesTotal])" /><GroupFields><Item1 FieldName="SalesTotal" /></GroupFields><b Expression="[Other]" />';
    expect(await renameFields(xml, new Map([['SalesTotal', 'Total']]))).toBe('<a Expression="[Total] * 2 + sumSum([Total])" /><GroupFields><Item1 FieldName="Total" /></GroupFields><b Expression="[Other]" />');
    expect(await renameFields(xml, new Map())).toBe(xml);
  });
});
