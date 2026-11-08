/**
 * The SQL Server companion, from the browser (2026-11-09, the SQL Server
 * programme, Phase 2). The fill below is what the companion answered over the
 * made-up FormaSample on LocalDB for batch DD's orders report with
 * Regions=North,South: three orders, five lines, two regions, a decimal at its
 * own scale. The companion itself was checked the same day: a foreign origin
 * 403, no x-forma-client header 400, an unknown connection 404, a stored
 * procedure 409 until the request says the person asked for it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { SCHEMA_SCRIPT } from './sqlSchemaScript';
import {
  companionConnections,
  companionFill,
  companionLayout,
  companionReachableFrom,
  hintOfNetType,
  previewFromFill,
  rowsOf,
  type FilledQuery,
} from './sqlCompanion';

afterEach(() => vi.unstubAllGlobals());

describe('the companion’s own copy of the layout script', () => {
  it('is the text a person runs in SSMS (regenerate with npx tsx scripts/companion-scripts.ts)', () => {
    const cs = readFileSync('tools/RepxDesigner/SqlScripts.cs', 'utf8');
    const body = /public const string Schema =\s*([\s\S]*?);\s*\}/.exec(cs)![1];
    const text = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string).join('');
    expect(text).toBe(SCHEMA_SCRIPT);
  });
});

describe('who may call it', () => {
  it('is a page served from this machine, as for the designer; the deployed site never does', () => {
    expect(companionReachableFrom('http://localhost:3001')).toBe(true);
    expect(companionReachableFrom('http://127.0.0.1:3000')).toBe(true);
    expect(companionReachableFrom('https://forma-201ba.web.app')).toBe(false);
  });

  it('sends the header that forces the preflight, and reads no companion as null', async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Response(JSON.stringify({ connections: [{ name: 'FormaSample', mode: 'windows', database: 'FormaSample' }] }), { status: 200 });
    }));
    expect(await companionConnections()).toEqual([{ name: 'FormaSample', mode: 'windows', database: 'FormaSample' }]);
    expect((seen[0].headers as Record<string, string>)['x-forma-client']).toBe('1');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await companionConnections()).toBeNull();
  });

  it('names a connection it does not keep in words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ missing: ['Sales'] }), { status: 404 })));
    await expect(companionLayout('Sales')).rejects.toThrow('The companion keeps no connection named Sales.');
  });
});

describe('a fill', () => {
  it('maps each answer the companion gives', async () => {
    const answer = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
    answer(409, { procedures: ['SalesByRegion'] });
    expect(await companionFill('<x/>', {})).toEqual({ kind: 'procedures', names: ['SalesByRegion'] });
    answer(404, { missing: ['Sales'] });
    expect(await companionFill('<x/>', {})).toEqual({ kind: 'missing', names: ['Sales'] });
    answer(502, { error: 'SqlException: Invalid column name' });
    expect(await companionFill('<x/>', {})).toEqual({ kind: 'error', message: 'SqlException: Invalid column name' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect((await companionFill('<x/>', {})).kind).toBe('error');
  });

  it('asks for a procedure only when told, with each parameter value', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ queries: [] }), { status: 200 });
    }));
    await companionFill('<x/>', { Regions: 'North,South', Empty: '' });
    await companionFill('<x/>', { To: '2026-12-31' }, true);
    expect(urls).toEqual(['http://127.0.0.1:7317/sql/fill?p.Regions=North%2CSouth', 'http://127.0.0.1:7317/sql/fill?procedures=1&p.To=2026-12-31']);
  });
});

const FILLED: FilledQuery[] = [
  {
    name: 'Orders',
    columns: [{ name: 'OrderID', type: 'Int32' }, { name: 'OrderDate', type: 'DateTime' }, { name: 'Freight', type: 'Decimal' }, { name: 'CompanyName', type: 'String' }, { name: 'Region', type: 'String' }],
    rows: [[1003, '2026-02-01T00:00:00', '20.25', 'Demo Supplies', 'North'], [1002, '2026-01-09T00:00:00', '8.00', 'Sample Goods', 'South'], [1001, '2026-01-05T00:00:00', '12.50', 'Example Traders', 'North']],
  },
  {
    name: 'OrderLines',
    columns: [{ name: 'OrderID', type: 'Int32' }, { name: 'LineNumber', type: 'Int32' }, { name: 'Product', type: 'String' }, { name: 'Qty', type: 'Int32' }, { name: 'UnitPrice', type: 'Decimal' }],
    rows: [[1001, 1, 'Widget', 4, '3.25'], [1001, 2, 'Gadget', 1, '19.99'], [1002, 1, 'Widget', 10, '3.10'], [1003, 1, 'Sprocket', 2, '7.50'], [1003, 2, 'Gadget', 3, '18.75']],
  },
  { name: 'RegionsList', columns: [{ name: 'Region', type: 'String' }], rows: [['North'], ['South']] },
];

describe('into the Preview', () => {
  it('types each field from the type DevExpress filled it with', () => {
    expect(['Int32', 'Int64', 'Decimal', 'Double', 'DateTime', 'DateTimeOffset', 'Boolean', 'Guid', 'String', 'TimeSpan'].map(hintOfNetType)).toEqual(['int', 'int', 'decimal', 'double', 'date', 'dto', 'bool', 'guid', 'string', 'string']);
    expect(rowsOf(FILLED[0])[1]).toEqual({ OrderID: '1002', OrderDate: '2026-01-09T00:00:00', Freight: '8.00', CompanyName: 'Sample Goods', Region: 'South' });
  });

  it('gives the main query’s rows, each master’s lines by the relation, and each lookup’s values', () => {
    const out = previewFromFill(FILLED, 'Orders', [{ name: 'OrderLinesOfOrders', master: 'Orders', detail: 'OrderLines', keys: [{ master: 'OrderID', detail: 'OrderID' }] }], [{ parameter: 'Regions', dataMember: 'RegionsList', valueMember: 'Region' }]);
    expect(out.rows.map((r) => r.OrderID)).toEqual(['1003', '1002', '1001']);
    expect(out.hints).toMatchObject({ OrderID: 'int', Freight: 'decimal', OrderDate: 'date', UnitPrice: 'decimal' });
    expect(out.related('Orders.OrderLinesOfOrders', out.rows[0])!.map((r) => r.Product)).toEqual(['Sprocket', 'Gadget']);
    expect(out.related('Orders.Nope', out.rows[0])).toBeNull();
    expect(out.choices).toEqual({ Regions: ['North', 'South'] });
  });
});
