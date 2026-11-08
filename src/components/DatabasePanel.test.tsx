// @vitest-environment jsdom
/**
 * The Data tab's SQL Server database (2026-11-08, the SQL Server programme,
 * batch DC): what a person is shown and what their actions do, over a
 * made-up layout read by the same parser the tab uses.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import DatabasePanel from './DatabasePanel';
import { readSchemaScript } from '../lib/sqlSchema';
import { SCHEMA_SCRIPT } from '../lib/sqlSchemaScript';
import type { ReportQuery } from '../lib/sqlQuery';

afterEach(cleanup);

const schema = {
  ...readSchemaScript(`
CREATE TABLE dbo.Customers (CustomerID int NOT NULL PRIMARY KEY, CompanyName nvarchar(80) NOT NULL);
CREATE TABLE dbo.Orders (OrderID int NOT NULL PRIMARY KEY, CustomerID int NOT NULL REFERENCES dbo.Customers(CustomerID), Freight decimal(10,2) NOT NULL);
CREATE VIEW dbo.vTotals AS SELECT o.OrderID, o.Freight AS Total FROM dbo.Orders o;
CREATE PROCEDURE dbo.usp_Temp AS SELECT 1;
`, 'ShopDemo')!,
};
schema.procedures[0] = { ...schema.procedures[0], resultError: { type: 'TEMPORARY_TABLE', message: 'It uses a temp table.' } };

function panel(over: Partial<Parameters<typeof DatabasePanel>[0]> = {}) {
  const props = {
    database: schema,
    recent: ['ShopDemo'],
    onSwitch: vi.fn(),
    onForget: vi.fn(),
    query: null as ReportQuery | null,
    onQuery: vi.fn(),
    selectionLabel: '',
    onBindField: vi.fn(),
    onCopy: vi.fn(async () => true),
    onFieldsChange: vi.fn(),
    ...over,
  };
  render(<DatabasePanel {...props} />);
  return props;
}

describe('with no database yet', () => {
  it('gives the layout script to copy and the databases kept here', async () => {
    const props = panel({ database: null, recent: ['Northwind'] });
    fireEvent.click(screen.getByText('Copy the layout script'));
    await Promise.resolve();
    expect(props.onCopy).toHaveBeenCalledWith(SCHEMA_SCRIPT);
    fireEvent.click(screen.getByText('Northwind'));
    expect(props.onSwitch).toHaveBeenCalledWith('Northwind');
  });
});

describe('browsing a database', () => {
  it('groups tables, views and procedures, and finds by column', () => {
    panel();
    expect(screen.getByText('Tables (2)')).toBeTruthy();
    expect(screen.getByText('Views (1)')).toBeTruthy();
    expect(screen.getByText('Stored procedures (1)')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Find in the database'), { target: { value: 'freight' } });
    expect(screen.getByText('Tables (1)')).toBeTruthy();
    expect(screen.getByText('dbo.Orders')).toBeTruthy();
    expect(screen.queryByText('dbo.Customers')).toBeNull();
  });

  it('shows a table’s columns with their keys, and uses it', () => {
    const props = panel();
    fireEvent.click(screen.getByText('dbo.Orders'));
    expect(screen.getByText('decimal(10,2)')).toBeTruthy();
    expect(screen.getByText('→ dbo.Customers.CustomerID')).toBeTruthy();
    fireEvent.click(screen.getByText('Use this table'));
    expect(props.onQuery).toHaveBeenCalledWith({ kind: 'table', object: 'dbo.Orders', columns: [], joins: [] });
  });

  it('says why a procedure’s result cannot be read, and what to change', () => {
    panel();
    fireEvent.click(screen.getByText('dbo.usp_Temp'));
    expect(screen.getByText(/It uses a temp table\. Use a table variable/)).toBeTruthy();
  });
});

describe('what the report reads', () => {
  const orders: ReportQuery = { kind: 'table', object: 'dbo.Orders', columns: [], joins: [] };

  it('offers the foreign key’s join and lists the fields, handing them to the mapping', () => {
    const props = panel({ query: orders });
    fireEvent.click(screen.getByLabelText(/dbo\.Customers on CustomerID = CustomerID/));
    expect(props.onQuery).toHaveBeenCalledWith({ ...orders, joins: [{ table: 'dbo.Customers', type: 'Inner', on: [{ from: 'CustomerID', to: 'CustomerID' }] }] });
    expect(screen.getByText('Fields (3)')).toBeTruthy();
    expect(props.onFieldsChange).toHaveBeenCalledWith(
      // With their sample values, none in this layout, for the mapping's matching (batch DE).
      [{ name: 'OrderID', type: 'number', sample: '', samples: [] }, { name: 'CustomerID', type: 'number', sample: '', samples: [] }, { name: 'Freight', type: 'number', sample: '', samples: [] }],
      'dbo.Orders',
    );
  });

  it('binds a field to what the Preview has selected, and not before', () => {
    const none = panel({ query: orders });
    expect((screen.getAllByText('Bind')[0] as HTMLButtonElement).disabled).toBe(true);
    expect(none.onBindField).not.toHaveBeenCalled();
    cleanup();
    const props = panel({ query: orders, selectionLabel: 'labelFreight' });
    fireEvent.click(screen.getAllByText('Bind')[2]);
    expect(props.onBindField).toHaveBeenCalledWith('Freight');
  });

  it('writes the options into the query', () => {
    const props = panel({ query: orders });
    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: '[Orders.Freight] > ?Min' } });
    expect(props.onQuery).toHaveBeenLastCalledWith({ ...orders, filter: '[Orders.Freight] > ?Min' });
    fireEvent.change(screen.getByLabelText('Top'), { target: { value: '50' } });
    expect(props.onQuery).toHaveBeenLastCalledWith({ ...orders, top: 50 });
  });

  it('takes custom SQL only when it is one SELECT', () => {
    const props = panel();
    fireEvent.click(screen.getByText('Write custom SQL'));
    fireEvent.change(screen.getByLabelText('Custom SQL'), { target: { value: 'DELETE FROM dbo.Orders' } });
    expect(screen.getByText(/"DELETE" is not allowed/)).toBeTruthy();
    expect((screen.getByText('Use this SQL') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Custom SQL'), { target: { value: 'SELECT OrderID FROM dbo.Orders WHERE Freight > @Min' } });
    expect(screen.getByText(/Parameters: @Min/)).toBeTruthy();
    fireEvent.click(screen.getByText('Use this SQL'));
    expect(props.onQuery).toHaveBeenCalledWith({ kind: 'custom', name: 'Query', sql: 'SELECT OrderID FROM dbo.Orders WHERE Freight > @Min' });
  });
});

/* Into the report (2026-11-08, batch DD): the connection by name, several
   values, a lookup list and its cascade, handed to App's writer. */
describe('writing into the report', () => {
  it('hands the connection, multi-value, a lookup and a cascade to the writer', async () => {
    const onWrite = vi.fn(async () => 'Wrote the data source: Orders on connection "Shop", with parameters Customer, Region.');
    const query: ReportQuery = { kind: 'table', object: 'dbo.Orders', columns: [], joins: [], filter: '[Orders.Region] = ?Region And [Orders.CustomerID] = ?CustomerID' };
    const regions = {
      ...schema,
      objects: schema.objects.map((o) => (o.name === 'Orders' ? { ...o, columns: [...o.columns, { name: 'Region', type: 'nvarchar', length: 20 }] } : o.name === 'Customers' ? { ...o, columns: [...o.columns, { name: 'Region', type: 'nvarchar', length: 20 }] } : o)),
    };
    render(<DatabasePanel database={regions} recent={[]} onSwitch={vi.fn()} onForget={vi.fn()} query={query} onQuery={vi.fn()} selectionLabel="" onBindField={vi.fn()} onCopy={vi.fn(async () => true)} onWrite={onWrite} />);
    fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'Shop;Password=x' } });
    // A connection string's ; and = cannot be typed: the box takes a name.
    expect((screen.getByLabelText('Connection name') as HTMLInputElement).value).toBe('ShopPasswordx');
    fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'Shop' } });
    fireEvent.click(screen.getAllByLabelText(/several values/)[0]);
    fireEvent.change(screen.getByLabelText('Values of CustomerID from'), { target: { value: 'dbo.Customers.CustomerID' } });
    fireEvent.change(screen.getByLabelText('CustomerID depends on'), { target: { value: 'Region' } });
    fireEvent.click(screen.getByText('Write into the report'));
    await Promise.resolve();
    expect(onWrite).toHaveBeenCalledWith({
      connectionName: 'Shop',
      multiValue: ['Region'],
      lookups: [{ parameter: 'CustomerID', object: 'dbo.Customers', valueColumn: 'CustomerID', filter: '[Region] In (?Region)' }],
      calculatedFields: [],
    });
  });
});

/* Sharing with the AI and SQL from a sentence (2026-11-09, batch DE, items 22 and 26). */
describe('sharing the database with the AI', () => {
  it('is the user’s to switch, and says what each state means', () => {
    const onShare = vi.fn();
    panel({ shared: false, onShare });
    expect(screen.getByText(/Off: the AI sees none of this database/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Send names and sample values to the AI/));
    expect(onShare).toHaveBeenCalledWith(true);
  });

  it('writes SQL from a sentence only when shared, and holds it to the layout', async () => {
    const onAskSql = vi.fn(async () => ({ sql: 'SELECT o.OrderID, o.Discount FROM dbo.Orders o', name: 'Orders', explanation: 'Every order.' }));
    panel({ shared: false, onShare: vi.fn(), onAskSql });
    fireEvent.click(screen.getByText('Write custom SQL'));
    fireEvent.change(screen.getByLabelText('Describe the query'), { target: { value: 'every order' } });
    expect((screen.getByText('Write the SQL') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    panel({ shared: true, onShare: vi.fn(), onAskSql });
    fireEvent.click(screen.getByText('Write custom SQL'));
    fireEvent.change(screen.getByLabelText('Describe the query'), { target: { value: 'every order' } });
    fireEvent.click(screen.getByText('Write the SQL'));
    await screen.findByText('Every order.');
    expect(onAskSql).toHaveBeenCalledWith('every order');
    expect((screen.getByLabelText('Custom SQL') as HTMLTextAreaElement).value).toBe('SELECT o.OrderID, o.Discount FROM dbo.Orders o');
    // A column the layout does not have is refused, not run.
    expect(screen.getByText('dbo.Orders has no column "Discount"')).toBeTruthy();
    expect((screen.getByText('Use this SQL') as HTMLButtonElement).disabled).toBe(true);
  });
});

/* The report's own data source and its drift (2026-11-09, batch DG, items 29 and 30). */
describe('the report’s own data source', () => {
  const orders: ReportQuery = { kind: 'table', object: 'dbo.Orders', columns: [], joins: [{ table: 'dbo.Customers', type: 'Inner', on: [{ from: 'CustomerID', to: 'CustomerID' }] }] };
  const base = '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="R" PageWidth="850" PageHeight="1100" Version="20.1" Dpi="100"><Bands><Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="25" Dpi="100"><Controls><Item1 Ref="3" ControlType="XRLabel" Name="labelCompany" Text="x" SizeF="150,20" Dpi="100"><ExpressionBindings><Item1 Ref="4" EventName="BeforePrint" PropertyName="Text" Expression="[CompanyName]" /></ExpressionBindings></Item1></Controls></Item1></Bands></XtraReportsLayoutSerializer>';

  it('is shown, checked against a newer layout, and a renamed column fixed in one click', async () => {
    const { writeSqlDataSource } = await import('../lib/repxSqlWriter');
    const repx = writeSqlDataSource(base, { connectionName: 'ShopDemo', schema, query: orders }).xml;
    const newer = readSchemaScript(`
CREATE TABLE dbo.Customers (CustomerID int NOT NULL PRIMARY KEY, CompanyNameFull nvarchar(80) NOT NULL);
CREATE TABLE dbo.Orders (OrderID int NOT NULL PRIMARY KEY, CustomerID int NOT NULL REFERENCES dbo.Customers(CustomerID), Freight decimal(10,2) NOT NULL);
`, 'ShopDemo')!;
    const onApplyRepx = vi.fn();
    panel({ database: newer, repx, onApplyRepx });
    expect(screen.getByText('connection “ShopDemo”, by name')).toBeTruthy();
    expect(screen.getByText(/Customers\.CompanyName is not in ShopDemo, so DevExpress refuses the query/)).toBeTruthy();
    fireEvent.click(screen.getByText('Rename to CompanyNameFull'));
    expect(onApplyRepx).toHaveBeenCalledWith(expect.stringContaining('Expression="[CompanyNameFull]"'), 'Replaced the data source: Orders on connection "ShopDemo"; renamed [CompanyName] to [CompanyNameFull] in 1 place');
  });

  it('with no layout imported, offers the layout the report uses as the database', async () => {
    const { writeSqlDataSource } = await import('../lib/repxSqlWriter');
    const repx = writeSqlDataSource(base, { connectionName: 'ShopDemo', schema, query: orders }).xml;
    const onAdopt = vi.fn();
    panel({ database: null, repx, onAdopt });
    expect(screen.getByText(/Orders with Customers/)).toBeTruthy();
    fireEvent.click(screen.getByText('Browse the layout it uses'));
    expect(onAdopt).toHaveBeenCalledWith(expect.objectContaining({ source: 'repx', database: 'ShopDemo' }));
  });
});