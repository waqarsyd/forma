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
      [{ name: 'OrderID', type: 'number', sample: '' }, { name: 'CustomerID', type: 'number', sample: '' }, { name: 'Freight', type: 'number', sample: '' }],
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
