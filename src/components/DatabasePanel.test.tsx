// @vitest-environment jsdom
/**
 * The Data tab's SQL Server database (2026-11-08, the SQL Server programme,
 * batch DC): what a person is shown and what their actions do, over a
 * made-up layout read by the same parser the tab uses.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import DatabasePanel from './DatabasePanel';

/* The databases kept in this browser, as the panel's own store holds them
   (2026-11-11, PERF: switching and forgetting moved here from App). */
const store = vi.hoisted(() => ({
  kept: [] as { name: string; schema: unknown; savedAt: number }[],
  forgotten: [] as string[],
}));
vi.mock('../lib/sqlSchemaStore', () => ({
  loadDatabases: async () => store.kept,
  forgetDatabase: async (name: string) => {
    store.forgotten.push(name);
  },
  storedName: (s: { database: string }) => s.database.trim() || 'Database',
}));
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
    onAdopt: vi.fn(),
    onNotice: vi.fn(),
    query: null as ReportQuery | null,
    onQuery: vi.fn(),
    selection: [] as string[],
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
    const northwind = { ...schema, database: 'Northwind' };
    store.kept = [{ name: 'Northwind', schema: northwind, savedAt: 1 }];
    const props = panel({ database: null, recent: ['Northwind'] });
    fireEvent.click(screen.getByText('Copy the layout script'));
    await Promise.resolve();
    expect(props.onCopy).toHaveBeenCalledWith(SCHEMA_SCRIPT);
    fireEvent.click(screen.getByText('Northwind'));
    await waitFor(() => expect(props.onAdopt).toHaveBeenCalledWith(northwind));
  });
});

describe('forgetting the database', () => {
  it('forgets it in this browser, leaves the workspace with none, and says so', async () => {
    store.forgotten = [];
    const props = panel();
    fireEvent.click(screen.getByText('Forget'));
    await waitFor(() => expect(props.onAdopt).toHaveBeenCalledWith(null));
    expect(store.forgotten).toEqual(['ShopDemo']);
    expect(props.onNotice).toHaveBeenCalledWith('ShopDemo is forgotten in this browser.');
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
    const props = panel({ query: orders, selection: ['labelFreight'] });
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
    expect(screen.getByText(/"DELETE" would change the database/)).toBeTruthy();
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
    render(<DatabasePanel database={regions} recent={[]} query={query} onQuery={vi.fn()} selection={[]} onBindField={vi.fn()} onCopy={vi.fn(async () => true)} onWrite={onWrite} />);
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

  it('writes SQL from a sentence at once when shared, and holds it to the layout', async () => {
    const onAskSql = vi.fn(async () => ({ sql: 'SELECT o.OrderID, o.Discount FROM dbo.Orders o', name: 'Orders', explanation: 'Every order.' }));
    panel({ shared: true, onShare: vi.fn(), onAskSql });
    fireEvent.click(screen.getByText('Write custom SQL'));
    fireEvent.change(screen.getByLabelText('Describe the query'), { target: { value: 'every order' } });
    fireEvent.click(screen.getByText('Write the SQL'));
    await screen.findByText('Every order.');
    // With the part of the layout it is about, worked out by the panel.
    expect(onAskSql).toHaveBeenCalledWith('every order', expect.stringContaining('Orders'));
    expect((screen.getByLabelText('Custom SQL') as HTMLTextAreaElement).value).toBe('SELECT o.OrderID, o.Discount FROM dbo.Orders o');
    // A column the layout does not have is refused, not run.
    expect(screen.getByText('dbo.Orders has no column "Discount"')).toBeTruthy();
    expect((screen.getByText('Use this SQL') as HTMLButtonElement).disabled).toBe(true);
    // The switch already said yes: no question was asked.
    expect(screen.queryByRole('group', { name: 'Send the names to the AI?' })).toBeNull();
  });

  /*
   * The owner's decision 3 of the 2026-11-11 audit (2026-11-12): the button was
   * disabled until the switch was ticked; now it asks, in the chat's rows
   * question's look, once per project, and a no sends nothing.
   */
  const asked = () => screen.getByRole('group', { name: 'Send the names to the AI?' });
  const writeFromSentence = () => {
    fireEvent.click(screen.getByText('Write custom SQL'));
    fireEvent.change(screen.getByLabelText('Describe the query'), { target: { value: 'every order' } });
    fireEvent.click(screen.getByText('Write the SQL'));
  };

  it('asks before the sentence and the names go when not shared, and a no sends nothing', () => {
    const onAskSql = vi.fn(async () => ({ sql: 'SELECT o.OrderID FROM dbo.Orders o', name: 'Orders', explanation: 'Every order.' }));
    const onSqlConsent = vi.fn();
    panel({ shared: false, onShare: vi.fn(), onAskSql, onSqlConsent });
    writeFromSentence();
    expect(asked().textContent).toMatch(/^To write it I'd send your sentence to the AI, with the names of up to 12 tables, views and procedures in ShopDemo it is likeliest about\. Nothing has been sent yet\. Send them\? For this project they'll go each time you write SQL from a sentence, until you start a new one\./);
    expect(onAskSql).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: "Don't send them" }));
    expect(onAskSql).not.toHaveBeenCalled();
    expect(onSqlConsent).not.toHaveBeenCalled();
    expect(screen.getByText('Nothing was sent.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Send the names to the AI?' })).toBeNull();
  });

  it('on a yes writes it and has the project remember, so the next sentence goes without asking', async () => {
    const onAskSql = vi.fn(async () => ({ sql: 'SELECT o.OrderID FROM dbo.Orders o', name: 'Orders', explanation: 'Every order.' }));
    const onSqlConsent = vi.fn();
    const props = panel({ shared: false, onShare: vi.fn(), onAskSql, onSqlConsent });
    writeFromSentence();
    fireEvent.click(screen.getByRole('button', { name: 'Send the names' }));
    expect(onSqlConsent).toHaveBeenCalledTimes(1);
    await screen.findByText('Every order.');
    expect(onAskSql).toHaveBeenCalledWith('every order', expect.stringContaining('Orders'));
    // App holds the yes for the project and hands it back: no question the second time.
    cleanup();
    panel({ ...props, sqlConsented: true });
    writeFromSentence();
    expect(screen.queryByRole('group', { name: 'Send the names to the AI?' })).toBeNull();
    await waitFor(() => expect(onAskSql).toHaveBeenCalledTimes(2));
  });

  it('names the sample values in the question when the layout has them', () => {
    panel({ database: { ...schema, samples: { 'dbo.Orders': [{ OrderID: 1, CustomerID: 1, Freight: 2 }] } }, shared: false, onShare: vi.fn(), onAskSql: vi.fn() });
    writeFromSentence();
    expect(asked().textContent).toMatch(/likeliest about, and up to 3 sample values a column\. Nothing has been sent yet\./);
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

/* Read from my SQL Server, through Forma Designer on this PC (2026-11-09, Phase 2, item 36). */
describe('Forma Designer on this PC', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists its connections and reads a layout through one, for App to keep', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/sql/connections')) return new Response(JSON.stringify({ connections: [{ name: 'FormaSample', mode: 'windows', database: 'FormaSample' }] }), { status: 200 });
      if (url.includes('/sql/schema?connection=FormaSample')) return new Response('<?forma {"format":"forma-sql-schema"}?>', { status: 200 });
      return new Response('', { status: 404 });
    }));
    const onLayoutText = vi.fn(async () => 'Database layout read: FormaSample.');
    panel({ database: null, onLayoutText });
    fireEvent.click(screen.getByText('Look for Forma Designer on this PC'));
    expect(await screen.findByText('FormaSample (FormaSample)')).toBeTruthy();
    fireEvent.click(screen.getByText('Read the layout'));
    expect(await screen.findByText('Database layout read: FormaSample.')).toBeTruthy();
    expect(onLayoutText).toHaveBeenCalledWith('<?forma {"format":"forma-sql-schema"}?>');
  });

  /* SD-09 and SD-10 (2026-11-11): its name, the way forward, and a second look without leaving the tab. */
  it('says how to start it when none answers, and looks again', async () => {
    let up = false;
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (!up) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ connections: [] }), { status: 200 });
    }));
    panel({ database: null, onLayoutText: vi.fn(async () => null) });
    fireEvent.click(screen.getByText('Look for Forma Designer on this PC'));
    expect(await screen.findByText(/^Forma Designer is not running, or is older than this feature/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download Forma Designer' }).getAttribute('href')).toBe('/download');
    up = true;
    fireEvent.click(screen.getByRole('button', { name: 'Look again' }));
    expect(await screen.findByText(/Forma Designer keeps no connections yet/)).toBeTruthy();
    // The empty answer can be asked again too, after a connection is added.
    expect(screen.getByRole('button', { name: 'Look again' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/companion|RepxDesigner|--serve/i);
  });

  it('says a failed read in words, with the way forward', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/sql/connections')) return new Response(JSON.stringify({ connections: [{ name: 'FormaSample', mode: 'windows', database: 'FormaSample' }] }), { status: 200 });
      throw new TypeError('Failed to fetch');
    }));
    panel({ database: null, onLayoutText: vi.fn(async () => 'read') });
    fireEvent.click(screen.getByText('Look for Forma Designer on this PC'));
    fireEvent.click(await screen.findByText('Read the layout'));
    expect(await screen.findByText(/Forma Designer is not running/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Failed to fetch/);
  });

  /* SD-23 (2026-11-11): where the layout came from, said true next to the card that read it. */
  it('says a layout read through it was read through it', async () => {
    // A layout as a script names its database in its USE line.
    const layoutText = 'USE [ShopDemo];\nCREATE TABLE dbo.Customers (CustomerID int NOT NULL PRIMARY KEY);';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/sql/connections')) return new Response(JSON.stringify({ connections: [{ name: 'ShopDemo', mode: 'windows', database: 'ShopDemo' }] }), { status: 200 });
      return new Response(layoutText, { status: 200 });
    }));
    const props = {
      recent: ['ShopDemo'], query: null, onQuery: vi.fn(), selection: [], onBindField: vi.fn(), onCopy: vi.fn(async () => true),
      onLayoutText: vi.fn(async () => 'Database layout read: ShopDemo.'),
    };
    const { rerender } = render(<DatabasePanel database={null} {...props} />);
    fireEvent.click(screen.getByText('Look for Forma Designer on this PC'));
    fireEvent.click(await screen.findByText('Read the layout'));
    await screen.findByText('Database layout read: ShopDemo.');
    rerender(<DatabasePanel database={schema} {...props} />);
    expect(screen.getByText(/^Read through Forma Designer on this PC/)).toBeTruthy();
    // A layout pasted or kept is not said to have been read through it.
    cleanup();
    panel();
    expect(screen.getByText(/^Read from an SSMS script; kept in this browser, which never connects to your server\.$/)).toBeTruthy();
  });
});

/* SD-11 (2026-11-11): the layout can always be pasted where it stays private. */
describe('pasting the layout on this tab', () => {
  it('has its own box, which reads what is pasted and says so', async () => {
    const onLayoutText = vi.fn(async () => 'Database layout read: ShopDemo.');
    panel({ database: null, onLayoutText });
    expect(screen.getByText(/Paste it in the box below, where it stays in this browser/)).toBeTruthy();
    expect((screen.getByText('Read what I pasted') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Paste the layout'), { target: { value: 'CREATE TABLE dbo.T (A int);' } });
    fireEvent.click(screen.getByText('Read what I pasted'));
    expect(await screen.findByText('Database layout read: ShopDemo.')).toBeTruthy();
    expect(onLayoutText).toHaveBeenCalledWith('CREATE TABLE dbo.T (A int);');
  });

  it('says when what was pasted is not a layout', async () => {
    panel({ database: null, onLayoutText: vi.fn(async () => null) });
    fireEvent.change(screen.getByLabelText('Paste the layout'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByText('Read what I pasted'));
    expect(await screen.findByText(/does not look like the layout script’s result/)).toBeTruthy();
  });
});