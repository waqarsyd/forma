/**
 * What a report reads from a SQL Server database (2026-11-08, the SQL Server
 * programme, batch DC). The schema is made up and read by the same parser the
 * Data tab uses, from SSMS-style text.
 */
import { describe, expect, it } from 'vitest';
import { readSchemaScript } from './sqlSchema';
import {
  checkCustomSql,
  describeQuery,
  duplicateFields,
  fieldKind,
  joinBlocked,
  joinsHeld,
  queryFields,
  queryName,
  queryParameters,
  sameJoin,
  selectedNames,
  suggestJoins,
  tableTwice,
  type ReportQuery,
} from './sqlQuery';

const schema = readSchemaScript(`
CREATE TABLE dbo.Customers (CustomerID int NOT NULL PRIMARY KEY, CompanyName nvarchar(80) NOT NULL, Region nvarchar(20) NULL);
CREATE TABLE dbo.Orders (OrderID int NOT NULL PRIMARY KEY, CustomerID int NULL REFERENCES dbo.Customers(CustomerID), OrderDate datetime NOT NULL, Freight decimal(10,2) NOT NULL, Paid bit NOT NULL);
CREATE TABLE dbo.OrderLines (OrderID int NOT NULL REFERENCES dbo.Orders(OrderID), LineNumber int NOT NULL, Product nvarchar(60) NOT NULL);
CREATE PROCEDURE dbo.usp_SalesByRegion @Region nvarchar(20) = NULL, @To date, @Count int OUTPUT AS SELECT 1;
`, 'ShopDemo')!;

describe('joins from foreign keys', () => {
  it('offers the tables an object points at and the tables pointing at it', () => {
    const joins = suggestJoins(schema, 'dbo.Orders');
    expect(joins.map((j) => `${j.direction} ${j.join.table} ${j.join.type}`)).toEqual([
      'references dbo.Customers LeftOuter',
      'referencedBy dbo.OrderLines Inner',
    ]);
    expect(joins[0].label).toBe('dbo.Customers on CustomerID = CustomerID');
    expect(joins[0].join.on).toEqual([{ from: 'CustomerID', to: 'CustomerID' }]);
  });
});

describe('a table joined once (2026-11-25)', () => {
  // An invoice's bill-to and ship-to customer, and an employee's manager: two keys to one table, and a key back to its own.
  const erp = readSchemaScript(`
CREATE TABLE dbo.Customers (CustomerID int NOT NULL PRIMARY KEY, CompanyName nvarchar(80) NOT NULL);
CREATE TABLE dbo.Invoices (InvoiceID int NOT NULL PRIMARY KEY, BillToID int NOT NULL REFERENCES dbo.Customers(CustomerID), ShipToID int NULL REFERENCES dbo.Customers(CustomerID));
CREATE TABLE dbo.Employees (EmployeeID int NOT NULL PRIMARY KEY, ManagerID int NULL REFERENCES dbo.Employees(EmployeeID), Name nvarchar(60) NOT NULL);
CREATE TABLE sales.Customers (CustomerID int NOT NULL PRIMARY KEY);
`, 'Erp')!;
  const invoices: Extract<ReportQuery, { kind: 'table' }> = { kind: 'table', object: 'dbo.Invoices', columns: [], joins: [] };
  const [billTo, shipTo] = suggestJoins(erp, 'dbo.Invoices');

  it('tells two keys to one table apart, and a join from its copy, in any case and order', () => {
    expect([billTo.label, shipTo.label]).toEqual(['dbo.Customers on BillToID = CustomerID', 'dbo.Customers on ShipToID = CustomerID']);
    expect(sameJoin(erp, billTo.join, shipTo.join)).toBe(false);
    expect(sameJoin(erp, billTo.join, { ...billTo.join, table: 'DBO.customers', on: [{ from: 'billtoid', to: 'customerid' }] })).toBe(true);
  });

  it('says why a query would name a table, or two of its queries, twice', () => {
    expect(tableTwice(erp, invoices)).toBeNull();
    expect(tableTwice(erp, { ...invoices, joins: [billTo.join] })).toBeNull();
    expect(tableTwice(erp, { ...invoices, joins: [billTo.join, shipTo.join] })).toBe('dbo.Customers would be in the query twice, which needs a table alias Forma does not write yet');
    // A detail is a query named after its table without its schema: one of the master's name, or two of one name.
    expect(tableTwice(erp, { ...invoices, details: [billTo.join, shipTo.join] })).toBe('two of its queries would both be named Customers, which needs a table alias Forma does not write yet');
    expect(tableTwice(erp, { ...invoices, details: [{ ...billTo.join, table: 'sales.Invoices' }] })).toBe('two of its queries would both be named Invoices, which needs a table alias Forma does not write yet');
    // In one query a schema tells two tables apart: the writer names them Customers and sales.Customers.
    expect(tableTwice(erp, { ...invoices, joins: [billTo.join, { ...shipTo.join, table: 'sales.Customers' }] })).toBeNull();
    expect(tableTwice(erp, { kind: 'procedure', procedure: 'dbo.usp_X' })).toBeNull();
  });

  it('blocks the second key to a table once the first is ticked, and never the one ticked', () => {
    expect(joinBlocked(erp, invoices, billTo)).toBeNull();
    const one = { ...invoices, joins: [billTo.join] };
    expect(joinBlocked(erp, one, billTo)).toBeNull();
    expect(joinBlocked(erp, one, shipTo)).toBe('dbo.Customers would be in the query twice, which needs a table alias Forma does not write yet: write it as custom SQL instead.');
  });

  it('blocks a table’s key back to itself, which only an alias could write', () => {
    const self = suggestJoins(erp, 'dbo.Employees');
    expect(self.map((s) => `${s.direction} ${s.join.table}`)).toEqual(['references dbo.Employees']);
    expect(joinBlocked(erp, { kind: 'table', object: 'dbo.Employees', columns: [], joins: [] }, self[0])).toMatch(/^dbo\.Employees would be in the query twice/);
  });

  it('gives a join on columns no suggestion has to the first choice for its table, so it shows ticked and clears (the review)', () => {
    const all = suggestJoins(erp, 'dbo.Invoices');
    const own = { table: 'dbo.Customers', type: 'Inner' as const, on: [{ from: 'InvoiceID', to: 'CustomerID' }] };
    const query = { ...invoices, joins: [own] };
    expect(joinsHeld(erp, query, all, 0)).toEqual([own]);
    expect(joinsHeld(erp, query, all, 1)).toEqual([]);
    const both = { ...invoices, joins: [billTo.join] };
    expect(joinsHeld(erp, both, all, 0)).toEqual([billTo.join]);
    expect(joinsHeld(erp, both, all, 1)).toEqual([]);
  });
});

describe('a query’s fields', () => {
  const orders: ReportQuery = { kind: 'table', object: 'dbo.Orders', columns: [], joins: [] };

  it('are every column of the table, with types', () => {
    expect(queryFields(schema, orders).map((f) => `${f.name}:${fieldKind(f.column)}`)).toEqual(['OrderID:number', 'CustomerID:number', 'OrderDate:date', 'Freight:number', 'Paid:boolean']);
  });

  it('take the joined table’s too, and say which names collide', () => {
    const joined: ReportQuery = { ...orders, joins: [suggestJoins(schema, 'dbo.Orders')[0].join] };
    const fields = queryFields(schema, joined);
    expect(fields.map((f) => `${f.source}.${f.name}`)).toContain('dbo.Customers.CompanyName');
    expect(duplicateFields(fields)).toEqual(['CustomerID']);
    const picked = queryFields(schema, { ...joined, columns: ['dbo.Orders.OrderID', 'Customers.CompanyName'] });
    expect(picked.map((f) => f.name)).toEqual(['OrderID', 'CompanyName']);
  });

  it('are a procedure’s result, and a custom query’s select list', () => {
    expect(queryFields(schema, { kind: 'procedure', procedure: 'dbo.usp_SalesByRegion' })).toEqual([]);
    expect(queryFields(schema, { kind: 'custom', name: 'Q', sql: 'SELECT o.OrderID, c.CompanyName AS Customer, Total = o.Freight * 2 FROM dbo.Orders o' }).map((f) => f.name)).toEqual(['OrderID', 'Customer', 'Total']);
    expect(selectedNames('SELECT TOP (5) [Order ID], COUNT(*) FROM T')).toEqual(['Order ID']);
  });
});

describe('custom SQL', () => {
  it('takes one SELECT and names its parameters', () => {
    expect(checkCustomSql("SELECT * FROM dbo.Orders WHERE Region = @Region AND Note <> 'DELETE me' -- DROP\n")).toEqual({ ok: true, problems: [], parameters: ['@Region'] });
    expect(checkCustomSql('WITH t AS (SELECT 1 AS a) SELECT a FROM t').ok).toBe(true);
  });

  it('refuses what writes, runs, grants or creates, and a second statement', () => {
    // In plain words, each ending on why (2026-11-11, the full audit's SDW follow-up).
    expect(checkCustomSql('DELETE FROM dbo.Orders').problems).toEqual(['A report only reads, so its query starts with SELECT, or with WITH and then a SELECT.', '"DELETE" would change the database, run something else or give rights, and a report only reads.']);
    expect(checkCustomSql('SELECT 1; DROP TABLE dbo.Orders').problems).toContain('Write one statement: a report reads one result.');
    expect(checkCustomSql('SELECT * INTO dbo.Copy FROM dbo.Orders').problems).toContain('SELECT ... INTO makes a new table, and a report only reads.');
    expect(checkCustomSql("SELECT * FROM OPENROWSET('x','y','z')").ok).toBe(false);
    expect(checkCustomSql('').problems).toEqual(['Write a SELECT statement.']);
  });
});

describe('parameters, names and descriptions', () => {
  it('turn a procedure’s inputs, a filter’s ?names and custom SQL’s @names into report parameters', () => {
    expect(queryParameters(schema, { kind: 'procedure', procedure: 'usp_SalesByRegion' })).toEqual([
      { name: 'Region', type: 'nvarchar(20)', defaultValue: 'NULL' },
      { name: 'To', type: 'date' },
    ]);
    expect(queryParameters(schema, { kind: 'table', object: 'dbo.Orders', columns: [], joins: [], filter: '[Customers.Region] = ?Region And [Orders.OrderDate] >= ?From And ?Region <> \'\'' })).toEqual([
      { name: 'Region', type: '' },
      { name: 'From', type: '' },
    ]);
    expect(queryParameters(schema, { kind: 'custom', name: 'Q', sql: 'SELECT 1 WHERE @a = @b' }).map((p) => p.name)).toEqual(['a', 'b']);
  });

  it('name the query as the report’s DataMember and describe it in a line', () => {
    expect(queryName({ kind: 'procedure', procedure: 'dbo.usp_SalesByRegion' })).toBe('SalesByRegion');
    expect(queryName({ kind: 'table', object: 'dbo.Orders', columns: [], joins: [] })).toBe('Orders');
    expect(queryName({ kind: 'custom', name: '', sql: 'SELECT 1' })).toBe('Query');
    expect(describeQuery({ kind: 'table', object: 'dbo.Orders', columns: [], joins: [{ table: 'dbo.Customers', type: 'Inner', on: [] }], filter: 'x', sort: [{ column: 'dbo.Orders.OrderDate', descending: true }], top: 100, distinct: true })).toBe(
      'dbo.Orders with dbo.Customers, filtered, sorted by OrderDate descending, top 100, distinct rows',
    );
  });
});
