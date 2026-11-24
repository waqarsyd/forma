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
import { SAMPLE_OBJECT_SCRIPT, SAMPLE_SCRIPT_ROWS, SAMPLE_VALUE_CUT, SCHEMA_SCRIPT, sampleScript } from './sqlSchemaScript';
import { MAX_SAMPLE_VALUE } from './sqlSchema';
import {
  companionConnections,
  companionFill,
  companionLayout,
  companionReachableFrom,
  CompanionProblem,
  COMPANION_PAGE_PORTS,
  hintOfNetType,
  NO_DEVEXPRESS_FOR_ROWS,
  notRunning,
  pagePortNote,
  previewFromFill,
  rowsOf,
  type FilledQuery,
} from './sqlCompanion';

afterEach(() => vi.unstubAllGlobals());

/** A string constant of tools/RepxDesigner/SqlScripts.cs, its literals joined and read as C# and JSON read them alike. */
function scriptsConstant(name: string): string {
  const cs = readFileSync('tools/RepxDesigner/SqlScripts.cs', 'utf8');
  const body = new RegExp(`public const string ${name} =\\s*([\\s\\S]*?);\\s*(?:\\}|///)`).exec(cs)![1];
  return [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string).join('');
}

describe('the companion’s own copy of the layout script', () => {
  it('is the text a person runs in SSMS (regenerate with npx tsx scripts/companion-scripts.ts)', () => {
    expect(scriptsConstant('Schema')).toBe(SCHEMA_SCRIPT);
  });

  /* D2-5 (2026-11-25, the CLI and Forma Designer work's wave 6): the samples trimmed on the server. */
  it('reads each sampled object with the sample SQL written here, trimmed as Forma keeps a sample', () => {
    expect(scriptsConstant('Sample')).toBe(SAMPLE_OBJECT_SCRIPT);
    // One character over what the reader keeps, so readSampleExport still marks a long value cut.
    expect(SAMPLE_VALUE_CUT).toBe(MAX_SAMPLE_VALUE + 1);
    expect(SAMPLE_OBJECT_SCRIPT).toContain(`N'SUBSTRING(' + QUOTENAME(c.name) + N', 1, ${SAMPLE_VALUE_CUT}) AS '`);
    expect(SAMPLE_OBJECT_SCRIPT).toContain("NOT IN (N'binary', N'varbinary', N'image', N'timestamp', N'xml', N'sql_variant')");
    expect(SAMPLE_OBJECT_SCRIPT).toContain('t.is_assembly_type = 0');
    // The wave's review, R6-1: SQL Server 2025's json is cut as text, so it arrives as a string the reader marks cut (vector is
    // varbinary to TYPE_NAME, and left out with it). R6-3: AUTO, which keeps a dotted column name flat where PATH nests it.
    expect(SAMPLE_OBJECT_SCRIPT).toContain(`WHEN TYPE_NAME(c.system_type_id) = N'json'\n                        THEN N'SUBSTRING(CONVERT(nvarchar(max), ' + QUOTENAME(c.name) + N'), 1, ${SAMPLE_VALUE_CUT}) AS '`);
    expect(SAMPLE_OBJECT_SCRIPT).toContain("N' FOR JSON AUTO, INCLUDE_NULL_VALUES'");
    expect(SAMPLE_OBJECT_SCRIPT).not.toContain('FOR JSON PATH');
    // Read-only: one SELECT, every name quoted by SQL Server; no star.
    expect(SAMPLE_OBJECT_SCRIPT).not.toMatch(/SELECT TOP \([^)]*\) \*|\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE)\b/i);
    expect(SAMPLE_OBJECT_SCRIPT).toContain("QUOTENAME(@s) + N'.' + QUOTENAME(@n)");
    expect(SAMPLE_OBJECT_SCRIPT).toMatch(/^[\x20-\x7e\n]*$/);
    // Forma Designer runs it for every object, the route and the verb alike, and no longer its own SELECT *.
    const sql = readFileSync('tools/RepxDesigner/Sql.cs', 'utf8');
    expect(sql).toContain('new SqlCommand(SqlScripts.Sample, conn)');
    expect(sql).not.toMatch(/N'\) \* FROM '/);
    // The rows it gives are those the SSMS script gives: 1 to 50, five unless asked.
    expect(/rows = Math\.Max\(1, Math\.Min\((\d+), rows\)\)/.exec(sql)![1]).toBe('50');
    // R6-2: an object SQL Server cannot read is left out and named by its number, the connection's own failures still end the call.
    expect(sql).toContain('catch (SqlException ex) when (ObjectOnly(ex, conn))');
    expect(sql).toMatch(/e\.Class >= 20 \|\| e\.Number == -2 \|\| e\.Number == 258/);
    expect(sampleScript([{ schema: 'dbo', name: 'A' }], 99)).toContain('TOP (50)');
  });
});

/*
 * Forma Designer's command-line verbs (2026-11-25, the CLI and Forma Designer work's wave 6;
 * D2-1 to D2-4, D2-9, D2-12 and SEC-2 of its design audit). No test may start Forma Designer
 * and CI builds no C#, so what can be held from here is its source: the order Main reads its
 * arguments in, what the verbs reach, and the contract a caller reads. Its runs over LocalDB's
 * FormaSample, an older build answering the sentinel among them, are recorded in
 * tools/RepxDesigner/README.md, *Verbs for Forma's command line*.
 */
describe('Forma Designer’s verbs, held to its source', () => {
  const code = (path: string) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const entry = code('tools/RepxDesigner/Entry.cs');
  const verbs = code('tools/RepxDesigner/Verbs.cs');

  it('runs a verb as Main’s first statement, before any switch is read anywhere in the arguments', () => {
    const main = /private static int Main\(string\[\] args\)\s*\{([\s\S]*)\}\s*\}\s*\}\s*$/.exec(entry)![1];
    const statements = main.split(';').map((s) => s.trim()).filter(Boolean);
    expect(statements[0]).toBe('if (Verbs.Is(args)) return Verbs.Run(args)');
    expect(main.indexOf('Verbs.Run(args)')).toBeLessThan(main.indexOf('DevExpressLocator.Configure(args)'));
    expect(main.indexOf('DevExpressLocator.Configure(args)')).toBeLessThan(main.indexOf('"--check"'));
    // D2-4: the exit code --install, --uninstall, --sql-add and --sql-remove set reaches the process.
    expect(main).toContain('return Environment.ExitCode');
    expect(main).not.toMatch(/Program\.Run\(args\);\s*return 0/);
  });

  it('names no DevExpress type, and reaches only what of the SQL store loads none (D2-9)', () => {
    expect(verbs).not.toMatch(/DevExpress|XtraReport|Program\./);
    const reached = new Set([...verbs.matchAll(/SqlCompanion\.(\w+)/g)].map((m) => m[1]));
    expect([...reached].sort()).toEqual(['ConnectionList', 'Explain', 'Failure', 'Find', 'IsName', 'Json', 'Samples', 'Schema', 'StorePath']);
    for (const loads of ['Parameters', 'Connect', 'Fill', 'PrepareForDesigner']) expect(reached.has(loads)).toBe(false);
    expect(verbs).toMatch(/\[MethodImpl\(MethodImplOptions\.NoInlining\)\]\s*public static int Run\(string\[\] args\)/);
    expect(readFileSync('tools/RepxDesigner/RepxDesigner.csproj', 'utf8')).toContain('<Compile Include="Verbs.cs" />');
  });

  it('takes the verb at args[0] alone and every call ending with the sentinel an older build answers (D2-1, SEC-2)', () => {
    expect(/Names = \{ ([^}]*) \}/.exec(verbs)![1]).toBe('"sql-list", "sql-schema", "sql-sample"');
    expect(/Sentinel = \{ ([^}]*) \}/.exec(verbs)![1]).toBe('"--check", "--no-load"');
    expect(verbs).toContain('Array.IndexOf(Names, args[0]) >= 0');
    // Forma Designer 1.1.0 and 1.0.0 reach --check with those arguments, which prints and exits.
    expect(entry).toMatch(/if \(Array\.IndexOf\(args, "--check"\) >= 0\) return Check\.Run\(args\)/);
    expect(code('tools/RepxDesigner/DevExpressLocator.cs')).toMatch(/Array\.IndexOf\(args, "--no-load"\) < 0/);
    // A name never reads as a switch: IsName refuses a leading - or . (databaseAi.test.ts holds the expression).
    expect(code('tools/RepxDesigner/Sql.cs')).toContain('@"^[A-Za-z0-9_][A-Za-z0-9_.\\-]{0,127}$"');
  });

  it('prints one ASCII line of JSON whose marker and exit codes a caller reads, 3 left to --check (D2-2, D2-4)', () => {
    const exits = Object.fromEntries([...verbs.matchAll(/public const int (\w+) = (\d+);/g)].map((m) => [m[1], Number(m[2])]));
    expect(exits).toMatchObject({ Done: 0, Usage: 2, NotKept: 4, SqlFailed: 5, DeadlinePassed: 6, DefaultRows: SAMPLE_SCRIPT_ROWS, MaxRows: 50, MaxObjects: 20 });
    expect(Object.values(exits)).not.toContain(3);
    expect(code('tools/RepxDesigner/DevExpressLocator.cs')).toMatch(/return usable == null \? 3 : 0;/);
    expect(verbs).toContain('"{\\"formaDesignerVerb\\":1,\\"verb\\":"');
    // R6-4: the exit code is the one of the line printed, the watchdog's when it spoke first.
    expect(verbs).toContain('if (TrySay(verb, code, fields)) return code;');
    expect(verbs).toContain('_code = code;');
    expect(verbs).toContain('new StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = true }');
    expect(verbs).toContain('new UTF8Encoding(false)');
    // Every string through SqlCompanion.Json, which writes each character above 126 as \uXXXX.
    expect(code('tools/RepxDesigner/Sql.cs')).toContain('if (ch < 32 || ch > 126) b.Append("\\\\u")');
    // --check's own writer too, since 1.2.0 (D2-2).
    expect(code('tools/RepxDesigner/DevExpressLocator.cs')).toContain("else if (c < ' ' || c > '~') b.Append(\"\\\\u\")");
  });
});

describe('who may call it', () => {
  it('is a page served from this machine, as for the designer; the deployed site never does', () => {
    expect(companionReachableFrom('http://localhost:3001')).toBe(true);
    expect(companionReachableFrom('http://127.0.0.1:3000')).toBe(true);
    expect(companionReachableFrom('https://forma-201ba.web.app')).toBe(false);
    // The website may open a report in the designer since 2026-11-09; the SQL routes stay local.
    expect(companionReachableFrom('https://openforma.web.app')).toBe(false);
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
    await expect(companionLayout('Sales')).rejects.toThrow('Forma Designer keeps no connection named Sales. Add it from its tray menu, SQL Server connections.');
  });

  /* SD-09 (2026-11-11): every failure in the product's name and plain words, with the way forward. */
  it('says it is not running, with the download, for no answer and for an older one', async () => {
    const NOT_RUNNING = 'Forma Designer is not running, or is older than this feature. Start it from the Start menu, or download the latest.';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const none = (await companionLayout('Sales').catch((e: unknown) => e)) as CompanionProblem;
    expect(none).toBeInstanceOf(CompanionProblem);
    expect(none.message).toBe(NOT_RUNNING);
    expect(none.link).toEqual({ href: '/download', label: 'Download Forma Designer' });
    // A Forma Designer from before the SQL routes answers them "Not found", as text.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
    await expect(companionLayout('Sales')).rejects.toThrow(NOT_RUNNING);
  });

  it('names the page port the SQL routes do not answer, which reaches the page as no answer', () => {
    expect(pagePortNote('http://localhost:3000')).toBe('');
    expect(pagePortNote('http://127.0.0.1:3001')).toBe('');
    expect(pagePortNote('http://localhost:5173')).toBe(' It reads databases only for Forma at port 3000 or 3001, and this page is at port 5173: start Forma Designer with --page-port 5173 to use it here.');
    expect(notRunning('http://localhost:5173').message).toMatch(/--page-port 5173 to use it here\.$/);
    // The website is told how elsewhere; it never asks.
    expect(pagePortNote('https://openforma.web.app')).toBe('');
    // Kept equal to the ports Forma Designer answers.
    const program = readFileSync('tools/RepxDesigner/Program.cs', 'utf8');
    expect(/PagePorts = new HashSet<int> \{ ([^}]*) \}/.exec(program)![1].split(',').map((p) => Number(p.trim()))).toEqual([...COMPANION_PAGE_PORTS]);
  });
});

describe('a fill', () => {
  it('maps each answer the companion gives', async () => {
    const answer = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
    answer(409, { procedures: ['SalesByRegion'] });
    expect(await companionFill('<x/>', {})).toEqual({ kind: 'procedures', names: ['SalesByRegion'] });
    answer(404, { missing: ['Sales'] });
    expect(await companionFill('<x/>', {})).toEqual({ kind: 'missing', names: ['Sales'] });
    // The database's own words, without the .NET type name in front of them.
    answer(502, { error: 'SqlException: Invalid column name' });
    expect(await companionFill('<x/>', {})).toEqual({ kind: 'error', message: 'Forma Designer could not read the database: Invalid column name' });
    // No DevExpress to fill it with: what is needed, and where the trial is.
    answer(424, { devexpress: null, found: [], oldest: '20.1' });
    expect(await companionFill('<x/>', {})).toEqual({
      kind: 'error',
      message: 'Live rows need DevExpress Reporting on this PC, since it fills the report as DevExpress does. Its free trial is at devexpress.com.',
      link: { href: 'https://www.devexpress.com/products/try/', label: 'Get the DevExpress trial' },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
    expect(await companionFill('<x/>', {})).toMatchObject({ kind: 'error', link: { href: '/download' } });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await companionFill('<x/>', {})).toMatchObject({ kind: 'error', message: /^Forma Designer is not running/ });
    // Never the code's word for it.
    for (const s of [notRunning('http://localhost:3000').message, NO_DEVEXPRESS_FOR_ROWS.message]) expect(s).not.toMatch(/companion|RepxDesigner|\d{3}\b/i);
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
