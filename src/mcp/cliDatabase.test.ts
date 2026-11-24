/**
 * A database's layout on Forma's command line (2026-11-24, the CLI and Forma
 * Designer work's wave 5; findings D1-2, D1-4, D1-6, D1-7, D1-9, D1-10,
 * D1-11 and GAP1-5 of its design audit,
 * `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`, and the owner's
 * decisions OC6 and OC7), over the real engine output of LocalDB's made-up
 * FormaSample database (lib/sqlFixtures.ts), written to files here in the
 * forms the person's tools write them, so the reading of a file is
 * exercised, not a string pasted in. Two halves:
 *
 * - **In process**: commandLine.ts's `main` as the entry calls it, the
 *   report commands' work and the AI's in this thread (testClient.ts), the
 *   AI stood in by the mock or a hook that records what it was shown: a
 *   picture generated with `--database`, bound to a table, to a procedure
 *   with parameters, to a query of joins, and refused before any AI is asked
 *   for a procedure the layout does not describe; sample values sent only
 *   with `--samples` and never printed; `--require-binding`; a revise shown
 *   what the report reads now and binding through a data edit, and with no
 *   layout declining a data edit in its own words; bind with
 *   each selector; convert --database on SSRS reports whose DataSet runs a
 *   procedure, reads a table, runs SQL or names a procedure the layout
 *   lacks; sql-script's scripts, and its layout read back in every encoding
 *   sqlcmd writes; a batch whose two files bind to different objects.
 * - **Spawned**: the documented command from a folder outside the clone,
 *   through the real worker threads: a mock generate bound to a procedure,
 *   bind, and sql-script.
 *
 * No key is real and no request leaves this computer: every key is built at
 * run time (TST-10), and every AI case chooses Local AI at 127.0.0.1:1 beside
 * the mock or a hook that answers. Paths are built with join, so the cases
 * run on CI's Linux as here.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FORMA_KEYS, redactorFor } from '../lib/keyRedact';
import { layoutFromFile } from '../lib/layoutFile';
import { readRepxDataSources } from '../lib/repxSqlDataSource';
import { EMITTED_REPX, SAMPLE_EXPORT, SCHEMA_EXPORT } from '../lib/sqlFixtures';
import { SCHEMA_SCRIPT, sampleScript } from '../lib/sqlSchemaScript';
import { readSchemaExport } from '../lib/sqlSchema';
import { mockAnswer, type ChatOutcome } from '../services/geminiService';
import type { AiEnv } from './aiSettings';
import { CLI_LAUNCHER } from './cliCommands';
import { EXIT, bindingLines, main, parseArgs, queryWords, sampleTargets, sqlcmdLine, type CliIo } from './commandLine';
import type { GenHooks } from './genJobs';
import { inThread, inThreadGenerator } from './testClient';

const CLONE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OWNER_WORK = resolve(CLONE, '..', 'forma-model-data-kept-not-in-git', 'forma-model-data', 'work');
const scratch = realpathSync.native(mkdtempSync(join(existsSync(OWNER_WORK) ? OWNER_WORK : tmpdir(), 'clidb-')));
const userFolder = join(scratch, 'forma-user');

/** A key of AI Studio's form, built at run time (TST-10). */
const geminiKey = ['AI', 'za', 'Sy'].join('') + 'B'.repeat(33);
const redact = redactorFor([geminiKey], FORMA_KEYS);
/** An AI set up, for the gate, and one that cannot leave this computer, chosen beside the mock (stdio.test.ts's NOWHERE_AI). */
const AI: AiEnv = { FORMA_GEMINI_KEY: geminiKey, FORMA_PROVIDER: 'local', FORMA_LOCAL_MODEL: 'forma-test-model', FORMA_LOCAL_URL: 'http://127.0.0.1:1/v1' };

/** A design that must never be asked for, beside the mock's chat, which answers a revise with no request. */
const NO_DESIGN: GenHooks = {
  ask: async () => {
    throw new Error('the AI must not be asked');
  },
};

/** An AI that must never be asked. */
const NEVER: GenHooks = {
  ask: async () => {
    throw new Error('the AI must not be asked');
  },
  chat: async () => {
    throw new Error('the AI must not be asked');
  },
};

beforeAll(() => {
  for (const level of ['log', 'info', 'warn', 'debug', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

let folders = 0;
function folder(): string {
  const dir = join(scratch, `work-${++folders}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function put(dir: string, name: string, data: string | Uint8Array): string {
  const path = join(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  return path;
}

/** A picture of a page title, drawn here. */
function titlePng(text: string): Buffer {
  const canvas = createCanvas(640, 240);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 640, 240);
  ctx.fillStyle = '#000000';
  ctx.font = '48px sans-serif';
  ctx.fillText(text, 40, 120);
  return canvas.toBuffer('image/png');
}

/** The layout script's answer as sqlcmd writes it with -f 65001: the one cell, a line of its own. */
const LAYOUT_TEXT = `${SCHEMA_EXPORT}\r\n`;
const SAMPLE_TEXT = `${SAMPLE_EXPORT}\r\n`;

/** A report whose Detail band prints `fields`, bound to nothing yet. */
const report = (fields: string[]) => `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="R" PageWidth="850" PageHeight="1100" Version="20.1" Dpi="100">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" Dpi="100" />
    <Item2 Ref="3" ControlType="DetailBand" Name="Detail" HeightF="25" Dpi="100"><Controls>${fields.map((f, i) => `<Item${i + 1} Ref="${10 + i}" ControlType="XRLabel" Name="label${f}" Text="${f}" Font="Arial, 9pt" LocationFloat="${i * 150}, 0" SizeF="150, 23" Dpi="100"><ExpressionBindings><Item1 Ref="${30 + i}" EventName="BeforePrint" PropertyName="Text" Expression="[${f}]" /></ExpressionBindings></Item${i + 1}>`).join('')}</Controls></Item2>
    <Item3 Ref="4" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" Dpi="100" />
  </Bands>
</XtraReportsLayoutSerializer>`;

interface Ran {
  code: number;
  out: string;
  err: string;
  lines: string[];
  json(): Record<string, any>[];
}

/** `main` as the entry calls it, the work in this thread, the AI stood in by `hooks` (the mock when the run asks for it). */
async function cli(argv: string[], o: { cwd: string; env?: AiEnv; hooks?: GenHooks }): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    cwd: o.cwd,
    aiEnv: o.env ?? {},
    out: (text) => out.push(text),
    err: (line) => err.push(line),
    redact,
    signal: new AbortController().signal,
    pipeline: () => inThread,
    generator: (setup, log) => inThreadGenerator({ ...setup, userFolder, paddleModels: null }, { log, ...o.hooks }),
    userFolder,
    sleep: async () => {},
  };
  const code = await main(argv, io);
  const text = out.join('');
  const lines = text.split('\n').filter(Boolean);
  return { code, out: text, err: err.join('\n'), lines, json: () => lines.map((l) => JSON.parse(l)) };
}

/** The data source a report written reads: its connection's name, and each query's name and procedure. */
function sourceOf(path: string) {
  const ds = readRepxDataSources(readFileSync(path, 'utf8'))[0];
  return ds ? { connection: ds.connectionName, queries: ds.queries.map((q) => ({ name: q.name, ...(q.procName ? { procedure: q.procName } : {}) })), xml: readFileSync(path, 'utf8') } : null;
}

/** An AI's design that records the database section it was shown and names `query` as the mock names one, never a request. */
function recording(seen: (string | undefined)[], query?: unknown): GenHooks {
  return {
    ...NEVER,
    ask: async (_prompt, _parts, _config, previous, _signal, _onProgress, options) => {
      seen.push(options?.database);
      const answer = mockAnswer('true', previous, options);
      return (query === undefined ? answer : { ...answer, dataQuery: query }) as never;
    },
  };
}

describe('the options of a database, read before anything', () => {
  it('reads --database, --samples (once for each file), one of --procedure, --object or --query, --connection-name and --require-binding', () => {
    const read = parseArgs(['generate', 'a.png', '--database', 'db.txt', '--samples', 's1.txt', '--samples=s2.txt', '--procedure', 'dbo.usp_SalesByRegion', '--connection-name', 'ShopLive', '--require-binding']);
    expect(read).toMatchObject({ kind: 'run', options: { database: 'db.txt', samples: ['s1.txt', 's2.txt'], query: { procedure: 'dbo.usp_SalesByRegion' }, connectionName: 'ShopLive', requireBinding: true } });
    expect(parseArgs(['bind', 'r.repx', '--database', 'db.txt', '--object', 'dbo.Orders'])).toMatchObject({ options: { query: { table: 'dbo.Orders' } } });
    expect(parseArgs(['bind', 'r.repx', '--database', 'db.txt', '--query', '{"table":"dbo.Orders","columns":["OrderID"]}'])).toMatchObject({ options: { query: { table: 'dbo.Orders', columns: ['OrderID'] } } });
    // With a layout given as data (D1-1), --require-binding has a database to hold the report to.
    expect(parseArgs(['generate', 'a.png', '--data', 'layout.txt', '--require-binding'])).toMatchObject({ options: { requireBinding: true } });
    expect(parseArgs(['sql-script', '--sample', 'dbo.Orders, Sales.[Order Lines],Customers', '--rows', '3', '--out', 'x.sql', '--sqlcmd', '(localdb)\\MSSQLLocalDB', 'FormaSample'])).toMatchObject({
      options: { sample: [{ schema: 'dbo', name: 'Orders' }, { schema: 'Sales', name: 'Order Lines' }, { schema: 'dbo', name: 'Customers' }], rows: 3, sqlcmd: { server: '(localdb)\\MSSQLLocalDB', database: 'FormaSample' } },
    });
  });

  it.each([
    [['generate', 'a.png', '--samples', 's.txt'], /^--samples goes with --database/],
    [['generate', 'a.png', '--procedure', 'dbo.x'], /^--procedure goes with --database/],
    [['generate', 'a.png', '--connection-name', 'X'], /^--connection-name goes with --database/],
    [['generate', 'a.png', '--require-binding'], /^--require-binding goes with --database, or a layout given with --data/],
    [['generate', 'a.png', '--database', 'd.txt', '--procedure', 'p', '--object', 't'], /^--procedure and --object each say what the report reads; give one of them\./],
    [['generate', 'a.png', '--database', 'd.txt', '--query', '{nope'], /^--query is not JSON: /],
    [['generate', 'a.png', '--database', 'd.txt', '--query', '[1]'], /^--query takes one JSON object/],
    [['generate', 'a.png', '--database', 'd.txt', '--database', 'e.txt'], /^--database is given 2 times; give it once\./],
    [['generate', 'a.png', '--database', ' '], /^--database needs a value after it\./],
    [['bind', 'r.repx', '--database', 'd.txt'], /^Name what the report reads with --procedure, --object or --query/],
    [['bind', 'r.repx', '--object', 'dbo.Orders'], /^--object goes with --database/],
    [['bind', 'r.repx', '--database', 'd.txt', '--object', 'x', '--samples', 's.txt'], /^--samples is not an option of bind\./],
    [['convert', 'a.rdl', '--database', 'd.txt', '--procedure', 'p'], /^--procedure is not an option of convert\./],
    [['sql-script', 'x.sql'], /^sql-script takes no file; one was named/],
    [['sql-script', '--rows', '3'], /^--rows goes with --sample/],
    [['sql-script', '--sample', 'dbo.Orders', '--rows', '51'], /^--rows takes a whole number of rows from 1 to 50\./],
    [['sql-script', '--sample', 'a.b.c'], /^--sample names tables or views as schema\.name/],
    [['sql-script', '--sample', `dbo.A${String.fromCharCode(27)}[2J`], /^--sample names tables or views as schema\.name.*; "dbo\.A\?\[2J" is not one\.$/],
    [['sql-script', '--sqlcmd', 'server'], /^--sqlcmd takes two values after it: the server, then the database\./],
    [['sql-script', '--sqlcmd', 'server', 'db'], /^--sqlcmd names the script file it runs: give --out/],
  ])('refuses %j as a usage error', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });

  it('refuses a connection name with ; or = before anything is read, never repeating it, exit 2', async () => {
    const dir = folder();
    put(dir, 'db.txt', LAYOUT_TEXT);
    writeFileSync(join(dir, 'a.png'), titlePng('INVOICE'));
    const ran = await cli(['generate', 'a.png', '--mock', '--database', 'db.txt', '--connection-name', 'Server=db01;Password=Secret123'], { cwd: dir, env: AI, hooks: NEVER });
    expect(ran.code).toBe(EXIT.usage);
    expect(ran.err).toMatch(/A connection name cannot hold ; or =/);
    expect(ran.err).not.toMatch(/Secret123|db01/);
    // Before the gate too: with no AI set up the name is still the first thing said, and bind, which needs none, says it the same.
    expect((await cli(['generate', 'a.png', '--database', 'db.txt', '--connection-name', 'a=b'], { cwd: dir })).code).toBe(EXIT.usage);
    put(dir, 'r.repx', report(['CompanyName']));
    const bound = await cli(['bind', 'r.repx', '--database', 'db.txt', '--object', 'dbo.Customers', '--connection-name', 'x;y'], { cwd: dir });
    expect(bound.code).toBe(EXIT.usage);
    expect(bound.err).not.toContain('x;y');
    expect(readdirSync(dir).sort()).toEqual(['a.png', 'db.txt', 'r.repx']);
  });

  it('says what a query reads and what binding did in plain lines', () => {
    expect(queryWords({ procedure: 'dbo.usp_SalesByRegion' })).toBe('the stored procedure dbo.usp_SalesByRegion');
    expect(queryWords({ table: 'dbo.Orders', joins: [{ table: 'dbo.Customers' }], details: [{ table: 'dbo.OrderLines' }] })).toBe('dbo.Orders with dbo.Customers, each with its dbo.OrderLines');
    expect(queryWords({ name: 'Top', sql: 'SELECT 1' })).toBe('the SQL query Top');
    expect(bindingLines({ database: 'FormaSample', query: { procedure: 'dbo.usp_SalesByRegion' }, connection: 'FormaSample', designerFills: true, parameters: ['Region', 'From', 'To'], leftOut: [], notes: [] }, true)).toEqual([
      '  bound to the stored procedure dbo.usp_SalesByRegion on connection "FormaSample", the report parameters Region, From, To',
    ]);
    expect(bindingLines({ database: 'FormaSample', reason: 'The report reads no SQL data source.', notes: [] }, false)).toEqual(['  not bound to FormaSample: The report reads no SQL data source.']);
    // What else the binding says comes under it, a line each.
    expect(bindingLines({ database: 'FormaSample', reason: 'Why.', notes: ['A note.'] }, false)).toEqual(['  not bound to FormaSample: Why.', '  A note.']);
    expect(bindingLines(undefined, null)).toEqual([]);
    expect(sampleTargets('[dbo].[Odd]]Name]')).toEqual([{ schema: 'dbo', name: 'Odd]Name' }]);
  });
});

describe('generate with a database', () => {
  it('binds a picture to the table the AI named (written back as the layout spells it), says the layout read before the AI is asked, and carries the binding as data', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    writeFileSync(join(dir, 'orders.png'), titlePng('CUSTOMERS'));
    const seen: (string | undefined)[] = [];
    const ran = await cli(['generate', 'orders.png', '--mock', '--database', 'formasample.txt', '--description', 'A list of customers', '--json'], { cwd: dir, env: AI, hooks: recording(seen, { table: 'Customers' }) });
    expect(ran.code, ran.err).toBe(EXIT.done);
    // Said before the AI was asked: the database and its objects, never a value.
    expect(ran.err).toContain('Database layout read from "formasample.txt": FormaSample: 3 tables, 1 view, 5 procedures (1 whose result cannot be read: a temp table).');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('<database>');
    expect(seen[0]).toContain('- dbo.Customers (table)');
    const [line] = ran.json();
    expect(line).toMatchObject({ status: 'done', binding: { bound: true, database: 'FormaSample', query: { table: 'dbo.Customers' }, connection: 'FormaSample', parameters: [], leftOut: [] } });
    expect(line.fileText?.binding).toBeUndefined();
    expect(sourceOf(join(dir, 'orders.generated.repx'))).toMatchObject({ connection: 'FormaSample', queries: [{ name: 'Customers' }] });
    // The connection by name only: no server, no login.
    expect(sourceOf(join(dir, 'orders.generated.repx'))!.xml).not.toMatch(/password|userid/i);
  });

  it('binds to a stored procedure pinned with --procedure, its parameters made report parameters, and names another connection', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    writeFileSync(join(dir, 'sales.png'), titlePng('SALES'));
    const seen: (string | undefined)[] = [];
    const ran = await cli(['generate', 'sales.png', '--mock', '--database', 'formasample.txt', '--procedure', 'usp_SalesByRegion', '--connection-name', 'ShopLive'], { cwd: dir, env: AI, hooks: recording(seen) });
    expect(ran.code, ran.err).toBe(EXIT.done);
    expect(ran.err).toContain('The report is to read the stored procedure dbo.usp_SalesByRegion.');
    // The AI is told the query chosen, in the command line's words, never the Data tab's.
    expect(seen[0]).toContain('THE REPORT READS stored procedure dbo.usp_SalesByRegion, as the user chose. Its fields, exactly as named: Region (nvarchar(20)); Total (decimal(38,2)).');
    expect(seen[0]).not.toContain('Data tab');
    expect(ran.lines).toContain('  bound to the stored procedure dbo.usp_SalesByRegion on connection "ShopLive", the report parameters Region, From, To');
    expect(sourceOf(join(dir, 'sales.generated.repx'))).toMatchObject({ connection: 'ShopLive', queries: [{ name: 'SalesByRegion', procedure: 'dbo.usp_SalesByRegion' }] });
  });

  it('binds to a query of joins given as JSON, every name held to the layout', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    writeFileSync(join(dir, 'o.png'), titlePng('ORDERS'));
    const query = JSON.stringify({ table: 'dbo.Orders', joins: [{ table: 'dbo.Customers' }], filter: '[Customers.Region] = ?Region' });
    const ran = await cli(['generate', 'o.png', '--mock', '--database', 'formasample.txt', '--query', query, '--json'], { cwd: dir, env: AI, hooks: recording([]) });
    expect(ran.code, ran.err).toBe(EXIT.done);
    expect(ran.json()[0].binding).toMatchObject({ bound: true, query: { table: 'dbo.Orders', joins: [{ table: 'dbo.Customers' }], filter: '[Customers.Region] = ?Region' }, parameters: ['Region'] });
  });

  it('refuses before any AI is asked a procedure the layout does not describe, a name it lacks and a layout cut short, writing nothing', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    put(dir, 'cut.txt', SCHEMA_EXPORT.slice(0, -3));
    writeFileSync(join(dir, 'a.png'), titlePng('INVOICE'));
    const temp = await cli(['generate', 'a.png', '--mock', '--database', 'formasample.txt', '--procedure', 'dbo.usp_TempTable'], { cwd: dir, env: AI, hooks: NEVER });
    expect(temp.code).toBe(EXIT.failed);
    expect(temp.err).toContain('The layout does not say what the stored procedure dbo.usp_TempTable returns, so a report cannot be bound to it: Use a table variable instead of a #temp table');
    const missing = await cli(['generate', 'a.png', '--mock', '--database', 'formasample.txt', '--object', 'dbo.Invoices'], { cwd: dir, env: AI, hooks: NEVER });
    expect(missing.code).toBe(EXIT.failed);
    expect(missing.err).toContain('The query given cannot be bound: there is no table or view "dbo.Invoices" in the database FormaSample');
    const cut = await cli(['generate', 'a.png', '--mock', '--database', 'cut.txt'], { cwd: dir, env: AI, hooks: NEVER });
    expect(cut.code).toBe(EXIT.failed);
    expect(cut.err).toMatch(/"cut\.txt" .*cut short/);
    expect(readdirSync(dir).sort()).toEqual(['a.png', 'cut.txt', 'formasample.txt']);
  });

  it('sends sample values only with --samples (the person passing the file, OC6), and never prints one', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    put(dir, 'rows.txt', SAMPLE_TEXT);
    // The layout and its rows saved in one file: given as the layout, its rows are not sent.
    put(dir, 'both.txt', `${SCHEMA_EXPORT}\r\n${SAMPLE_EXPORT}\r\n`);
    writeFileSync(join(dir, 'a.png'), titlePng('TOTALS'));
    const withRows: (string | undefined)[] = [];
    const sent = await cli(['generate', 'a.png', '--mock', '--database', 'formasample.txt', '--samples', 'rows.txt', '--object', 'dbo.vOrderTotals', '--json'], { cwd: dir, env: AI, hooks: recording(withRows) });
    expect(sent.code, sent.err).toBe(EXIT.done);
    expect(withRows[0]).toContain('Example Traders');
    expect(sent.err).toContain('Sample rows read for FormaSample from "rows.txt": dbo.Orders (3 rows), dbo.vOrderTotals (3 rows).');
    for (const text of [sent.out, sent.err]) expect(text).not.toMatch(/Example Traders|Sample Goods|Demo Supplies/);

    const names: (string | undefined)[] = [];
    const none = await cli(['generate', 'a.png', '--mock', '--database', 'both.txt', '--object', 'dbo.vOrderTotals', '--out', 'b.repx', '--json'], { cwd: dir, env: AI, hooks: recording(names) });
    expect(none.code, none.err).toBe(EXIT.done);
    expect(names[0]).toContain('- dbo.vOrderTotals (view)');
    expect(names[0]).not.toMatch(/Example Traders|Sample Goods|Demo Supplies/);
    expect(none.err).toContain('"both.txt" holds sample rows too, which were not read with the layout');
  });

  it('a layout among --data binds the report too (D1-1), its sample rows never sent, said in the command line\'s words', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    put(dir, 'rows.txt', SAMPLE_TEXT);
    writeFileSync(join(dir, 'a.png'), titlePng('CUSTOMERS'));
    const seen: (string | undefined)[] = [];
    const ran = await cli(['generate', 'a.png', '--mock', '--data', 'formasample.txt', '--data', 'rows.txt', '--description', 'customers', '--require-binding', '--json'], { cwd: dir, env: AI, hooks: recording(seen, { table: 'Customers' }) });
    expect(ran.code, ran.err).toBe(EXIT.done);
    expect(seen[0]).not.toMatch(/Example Traders/);
    const [line] = ran.json();
    expect(line.binding).toMatchObject({ bound: true, query: { table: 'dbo.Customers' } });
    expect(line.notices).toContain('"rows.txt" holds sample rows, which go to the AI only when they are given with --samples, so they were not read.');
  });

  it('--require-binding: a report written but not bound ends the input with 4, said why', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    writeFileSync(join(dir, 'a.png'), titlePng('INVOICE'));
    const unbound = recording([], { table: 'dbo.Invoices' });
    const loose = await cli(['generate', 'a.png', '--mock', '--database', 'formasample.txt', '--json'], { cwd: dir, env: AI, hooks: unbound });
    expect(loose.code, loose.err).toBe(EXIT.done);
    expect(loose.json()[0].binding).toMatchObject({ bound: false, database: 'FormaSample' });
    expect(loose.json()[0].binding.reason).toMatch(/^It is not bound to FormaSample yet: .*Choose what it reads with --procedure, --query or --object\.$/);
    const held = await cli(['generate', 'a.png', '--mock', '--database', 'formasample.txt', '--require-binding', '--force'], { cwd: dir, env: AI, hooks: unbound });
    expect(held.code).toBe(EXIT.failed);
    expect(held.err).toContain('The report was written, but it is not bound to the database given (--require-binding).');
    expect(held.lines.some((l) => l.startsWith('  not bound to FormaSample: It is not bound to FormaSample yet'))).toBe(true);
  });
});

describe('revise with a database', () => {
  it('shows the chat the layout and what the report reads now, read back from the report (D1-2), never "a source Forma did not write"', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    put(dir, 'orders.repx', EMITTED_REPX);
    const shown: (string | undefined)[] = [];
    const chat: GenHooks['chat'] = async (_history, _config, _signal, _partial, report) => {
      shown.push(report?.database);
      return { reply: 'It reads the orders.', wantsReport: false, action: 'answer', edits: [] } as ChatOutcome;
    };
    const ran = await cli(['revise', 'orders.repx', '--database', 'formasample.txt', '--words', 'What does it read now?', '--json'], { cwd: dir, env: AI, hooks: { ...NEVER, chat } });
    expect(ran.code, ran.err).toBe(EXIT.done);
    expect(shown[0]).toContain('THE REPORT READS NOW: {"table":"dbo.Orders"');
    expect(shown[0]).not.toContain('a source Forma did not write');
    // Nothing written: the binding is the report's as it reads.
    expect(ran.json()[0]).toMatchObject({ action: 'answer', binding: { bound: true, query: { table: 'dbo.Orders' }, connection: 'FormaSample' } });
  });

  it('binds through the chat\'s data edit, and a pinned query binds the report written even when the AI changed something else', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    put(dir, 'r.repx', report(['CompanyName', 'City']));
    const edited = await cli(['revise', 'r.repx', '--mock', '--database', 'formasample.txt', '--words', 'Bind it to dbo.Customers', '--json'], { cwd: dir, env: AI, hooks: NO_DESIGN });
    expect(edited.code, edited.err).toBe(EXIT.done);
    expect(edited.json()[0]).toMatchObject({ action: 'edit', binding: { bound: true, query: { table: 'dbo.Customers' }, connection: 'FormaSample' } });
    expect(sourceOf(join(dir, 'r.revised.repx'))).toMatchObject({ connection: 'FormaSample', queries: [{ name: 'Customers' }] });

    // The AI makes the title bold; --procedure binds what is written to the procedure all the same.
    const pinned = await cli(['revise', 'r.repx', '--mock', '--database', 'formasample.txt', '--procedure', 'dbo.usp_SalesByRegion', '--words', 'Make it bold', '--out', 'p.repx', '--json'], { cwd: dir, env: AI, hooks: NO_DESIGN });
    expect(pinned.code, pinned.err).toBe(EXIT.done);
    expect(pinned.json()[0].binding).toMatchObject({ bound: true, query: { procedure: 'dbo.usp_SalesByRegion' }, parameters: ['Region', 'From', 'To'] });

    // Nothing written: nothing bound, and said so.
    const asked = await cli(['revise', 'r.repx', '--mock', '--database', 'formasample.txt', '--procedure', 'dbo.usp_SalesByRegion', '--words', 'Export it as PDF', '--out', 'never.repx'], { cwd: dir, env: AI, hooks: NO_DESIGN });
    expect(asked.code, asked.err).toBe(EXIT.done);
    expect(asked.err).toContain('Nothing was written, so the report was not bound to the query given; the bind command binds it with no AI.');
    expect(existsSync(join(dir, 'never.repx'))).toBe(false);
  });
});

describe('revise with no database', () => {
  it("declines the chat's data edit in the command line's words, never the Data tab's", async () => {
    const dir = folder();
    put(dir, 'r.repx', report(['CompanyName']));
    const chat: GenHooks['chat'] = async () => ({ reply: 'Bound it.', wantsReport: false, action: 'edit', edits: [{ op: 'data', query: { table: 'dbo.Customers' } }] }) as ChatOutcome;
    const ran = await cli(['revise', 'r.repx', '--words', 'Bind it to dbo.Customers', '--edits-only', '--json'], { cwd: dir, env: AI, hooks: { ...NEVER, chat } });
    const [line] = ran.json();
    expect(line.fileText.declined.join(' ')).toContain('no database layout was given, so what the report reads cannot change: give one with --database, or bind the report with the bind command');
    expect(JSON.stringify(line)).not.toContain('Data tab');
    expect(line.binding).toBeUndefined();
  });
});

describe('bind, with no AI', () => {
  it('binds a report with each selector, at no AI\'s cost, the audit after, never over a file', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    put(dir, 'r.repx', report(['Region', 'Total']));
    const byProcedure = await cli(['bind', 'r.repx', '--database', 'formasample.txt', '--procedure', 'dbo.usp_SalesByRegion', '--json'], { cwd: dir });
    expect(byProcedure.code, byProcedure.err).toBe(EXIT.done);
    expect(byProcedure.json()[0]).toMatchObject({ status: 'done', written: { path: join(dir, 'r.bound.repx'), status: 'written' }, binding: { bound: true, query: { procedure: 'dbo.usp_SalesByRegion' }, parameters: ['Region', 'From', 'To'] } });
    expect(byProcedure.err).toContain('Database layout read from "formasample.txt": FormaSample:');
    // Never over a file: the same command again refuses, exit 4, and --force replaces.
    expect((await cli(['bind', 'r.repx', '--database', 'formasample.txt', '--procedure', 'dbo.usp_SalesByRegion'], { cwd: dir })).lines[0]).toMatch(/^Found the same file already at /);
    put(dir, 'r.bound.repx', 'other');
    expect((await cli(['bind', 'r.repx', '--database', 'formasample.txt', '--procedure', 'dbo.usp_SalesByRegion'], { cwd: dir })).code).toBe(EXIT.failed);
    expect((await cli(['bind', 'r.repx', '--database', 'formasample.txt', '--procedure', 'dbo.usp_SalesByRegion', '--force'], { cwd: dir })).code).toBe(EXIT.done);

    put(dir, 'c.repx', report(['CompanyName', 'City']));
    const byObject = await cli(['bind', 'c.repx', '--database', 'formasample.txt', '--object', 'Customers', '--connection-name', 'ShopLive'], { cwd: dir });
    expect(byObject.code, byObject.err).toBe(EXIT.done);
    expect(byObject.lines.slice(0, 2)).toEqual([expect.stringMatching(/^Wrote ".*c\.bound\.repx"\. Bound with no AI\. The result has /), '  bound to dbo.Customers on connection "ShopLive"']);
    const query = JSON.stringify({ table: 'dbo.Orders', joins: [{ table: 'dbo.Customers' }], details: [{ table: 'dbo.OrderLines' }] });
    const byQuery = await cli(['bind', 'c.repx', '--database', 'formasample.txt', '--query', query, '--out', 'q.repx', '--json'], { cwd: dir });
    expect(byQuery.code, byQuery.err).toBe(EXIT.done);
    expect(byQuery.json()[0].binding).toMatchObject({ bound: true, query: { table: 'dbo.Orders', details: [{ table: 'dbo.OrderLines' }] } });
    expect(sourceOf(join(dir, 'q.repx'))!.queries.map((x) => x.name)).toEqual(['Orders', 'OrderLines']);
  });

  it('keeps the connection a report already names, saying so, and refuses what it cannot bind with nothing written', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    put(dir, 'orders.repx', EMITTED_REPX);
    const kept = await cli(['bind', 'orders.repx', '--database', 'formasample.txt', '--object', 'dbo.Customers', '--connection-name', 'ShopLive'], { cwd: dir });
    expect(kept.code, kept.err).toBeLessThanOrEqual(EXIT.auditErrors);
    // Said under the binding, as all it says is (W5-PB-11).
    expect(kept.lines).toContain('  The report already names its connection "FormaSample", which is kept; --connection-name names the connection of a report that names none.');
    expect(sourceOf(join(dir, 'orders.bound.repx'))).toMatchObject({ connection: 'FormaSample', queries: [{ name: 'Customers' }] });
    const temp = await cli(['bind', 'orders.repx', '--database', 'formasample.txt', '--procedure', 'dbo.usp_TempTable', '--out', 't.repx'], { cwd: dir });
    expect(temp.code).toBe(EXIT.failed);
    expect(existsSync(join(dir, 't.repx'))).toBe(false);
  });

  it('finds a name written in brackets, as QUOTENAME and SSMS write it (BT-3)', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    put(dir, 'r.repx', report(['Region', 'Total']));
    const byProcedure = await cli(['bind', 'r.repx', '--database', 'formasample.txt', '--procedure', '[dbo].[usp_SalesByRegion]', '--json'], { cwd: dir });
    expect(byProcedure.code, byProcedure.err).toBe(EXIT.done);
    expect(byProcedure.json()[0].binding).toMatchObject({ bound: true, query: { procedure: 'dbo.usp_SalesByRegion' } });
    put(dir, 'c.repx', report(['CompanyName']));
    const byObject = await cli(['bind', 'c.repx', '--database', 'formasample.txt', '--object', '[dbo].[Customers]', '--json'], { cwd: dir });
    expect(byObject.json()[0].binding).toMatchObject({ bound: true, query: { table: 'dbo.Customers' } });
  });

  it('says a connection Forma Designer cannot fill under the binding, and in its JSON line (BT-7)', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    put(dir, 'c.repx', report(['CompanyName']));
    const ran = await cli(['bind', 'c.repx', '--database', 'formasample.txt', '--object', 'dbo.Customers', '--connection-name', 'My Shop'], { cwd: dir });
    expect(ran.code, ran.err).toBe(EXIT.done);
    expect(ran.lines).toContain('  bound to dbo.Customers on connection "My Shop"');
    expect(ran.lines).toContain('  Forma Designer cannot fill a connection named "My Shop": the names it fills hold only letters, digits, _, . and -, at most 128.');
    const json = await cli(['bind', 'c.repx', '--database', 'formasample.txt', '--object', 'dbo.Customers', '--connection-name', 'My Shop', '--out', 'j.repx', '--json'], { cwd: dir });
    expect(json.json()[0].binding).toMatchObject({ bound: true, designerFills: false, notes: [expect.stringMatching(/^Forma Designer cannot fill a connection named "My Shop"/)] });
  });

  it('binds a master-detail report to a view with its detail report gone, so DevExpress can print it, and says so (BT-2)', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    put(dir, 'o.repx', report(['OrderID', 'CompanyName']));
    const masterDetail = JSON.stringify({ table: 'dbo.Orders', joins: [{ table: 'dbo.Customers' }], details: [{ table: 'dbo.OrderLines' }] });
    expect((await cli(['bind', 'o.repx', '--database', 'formasample.txt', '--query', masterDetail, '--out', 'md.repx'], { cwd: dir })).code).toBeLessThanOrEqual(EXIT.auditErrors);
    expect(readFileSync(join(dir, 'md.repx'), 'utf8')).toContain('DataMember="Orders.OrderLinesOfOrders"');
    const ran = await cli(['bind', 'md.repx', '--database', 'formasample.txt', '--object', 'dbo.vOrderTotals', '--out', 'view.repx', '--json'], { cwd: dir });
    const [line] = ran.json();
    expect(line.binding).toMatchObject({ bound: true, query: { table: 'dbo.vOrderTotals' }, notes: [expect.stringMatching(/^Removed the detail report DetailReportOrderLinesOfOrders, which read Orders\.OrderLinesOfOrders/)] });
    const xml = readFileSync(join(dir, 'view.repx'), 'utf8');
    expect(xml).not.toContain('Orders.OrderLinesOfOrders');
    // Forma's audit finds no member the source lacks.
    const audit = await cli(['audit', 'view.repx', '--json'], { cwd: dir });
    expect(JSON.stringify(audit.json()[0])).not.toMatch(/has no query or relation for/);
    // Bound back to the orders with their lines, the band comes back on the relation.
    const again = await cli(['bind', 'view.repx', '--database', 'formasample.txt', '--query', masterDetail, '--out', 'again.repx', '--json'], { cwd: dir });
    expect(again.json()[0].binding).toMatchObject({ bound: true });
    expect(readFileSync(join(dir, 'again.repx'), 'utf8')).toContain('DataMember="Orders.OrderLinesOfOrders"');
  });
});

/** An SSRS report over FormaSample: its DataSet `Sales` runs `command` as `type`, with a field renamed from its query column. */
const salesRdl = (type: string, command: string, fields = '<Field Name="Region"><DataField>Region</DataField></Field><Field Name="SalesTotal"><DataField>Total</DataField></Field>') => `<?xml version="1.0" encoding="utf-8"?>
<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition" xmlns:rd="http://schemas.microsoft.com/SQLServer/reporting/reportdesigner">
  <DataSources><DataSource Name="Shop"><ConnectionProperties><DataProvider>SQL</DataProvider><ConnectString>Data Source=db01;Initial Catalog=FormaSample;User ID=sa;Password=Secret123</ConnectString></ConnectionProperties></DataSource></DataSources>
  <DataSets>
    <DataSet Name="Sales">
      <Query><DataSourceName>Shop</DataSourceName>${type ? `<CommandType>${type}</CommandType>` : ''}<CommandText>${command}</CommandText></Query>
      <Fields>${fields}</Fields>
    </DataSet>
  </DataSets>
  <ReportSections><ReportSection>
    <Body>
      <ReportItems>
        <Tablix Name="Table1">
          <TablixBody>
            <TablixColumns><TablixColumn><Width>2in</Width></TablixColumn><TablixColumn><Width>1in</Width></TablixColumn></TablixColumns>
            <TablixRows>
              <TablixRow><Height>0.25in</Height><TablixCells>
                <TablixCell><CellContents><Textbox Name="h1"><Paragraphs><Paragraph><TextRuns><TextRun><Value>Region</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>
                <TablixCell><CellContents><Textbox Name="h2"><Paragraphs><Paragraph><TextRuns><TextRun><Value>Total</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>
              </TablixCells></TablixRow>
              <TablixRow><Height>0.25in</Height><TablixCells>
                <TablixCell><CellContents><Textbox Name="d1"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Fields!Region.Value</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>
                <TablixCell><CellContents><Textbox Name="d2"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Fields!SalesTotal.Value</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>
              </TablixCells></TablixRow>
            </TablixRows>
          </TablixBody>
          <TablixColumnHierarchy><TablixMembers><TablixMember /><TablixMember /></TablixMembers></TablixColumnHierarchy>
          <TablixRowHierarchy><TablixMembers><TablixMember><KeepWithGroup>After</KeepWithGroup></TablixMember><TablixMember><Group Name="Details" /></TablixMember></TablixMembers></TablixRowHierarchy>
          <DataSetName>Sales</DataSetName>
          <Top>0in</Top><Left>0in</Left><Height>0.5in</Height><Width>3in</Width>
        </Tablix>
      </ReportItems>
      <Height>1in</Height>
    </Body>
    <Width>6.5in</Width>
    <Page><PageHeight>11in</PageHeight><PageWidth>8.5in</PageWidth><LeftMargin>1in</LeftMargin><RightMargin>1in</RightMargin><TopMargin>1in</TopMargin><BottomMargin>1in</BottomMargin></Page>
  </ReportSection></ReportSections>
</Report>`;

describe('convert --database, with no AI (GAP1-5)', () => {
  it("binds a converted SSRS report to the stored procedure its own DataSet runs, a field renamed to the column it reads, never its connection string", async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    put(dir, 'sales.rdl', salesRdl('StoredProcedure', 'dbo.usp_SalesByRegion'));
    const ran = await cli(['convert', 'sales.rdl', '--database', 'formasample.txt', '--json'], { cwd: dir });
    expect(ran.code, ran.err).toBeLessThanOrEqual(EXIT.auditErrors);
    const [line] = ran.json();
    expect(line).toMatchObject({ chosenBy: 'procedure', binding: { bound: true, query: { procedure: 'dbo.usp_SalesByRegion' }, connection: 'FormaSample', parameters: ['Region', 'From', 'To'] } });
    expect(line.binding.notes).toContain('Renamed a field to the column the query returns: SalesTotal to Total.');
    const xml = readFileSync(join(dir, 'sales.converted.repx'), 'utf8');
    expect(xml).toContain('[Total]');
    expect(xml).not.toContain('[SalesTotal]');
    expect(xml).not.toMatch(/Secret123|db01|User ID/);
  });

  it('binds a TableDirect DataSet to its table, a Text one to its SQL when the layout holds every name, and says a procedure the layout lacks', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    const customers = '<Field Name="CompanyName"><DataField>CompanyName</DataField></Field><Field Name="City"><DataField>City</DataField></Field>';
    put(dir, 'table.rdl', salesRdl('TableDirect', 'dbo.Customers', customers));
    put(dir, 'sql.rdl', salesRdl('', 'SELECT c.CompanyName, c.City FROM dbo.Customers c WHERE c.Region = @Region', customers));
    put(dir, 'missing.rdl', salesRdl('StoredProcedure', 'dbo.usp_Missing'));
    const ran = await cli(['convert', 'table.rdl', 'sql.rdl', 'missing.rdl', '--database', 'formasample.txt', '--json', '--fail-on', 'never'], { cwd: dir });
    const lines = ran.json().filter((l) => l.type === 'input');
    const by = Object.fromEntries(lines.map((l) => [l.input, l]));
    expect(by['table.rdl']).toMatchObject({ chosenBy: 'table', binding: { bound: true, query: { table: 'dbo.Customers' } } });
    expect(by['sql.rdl']).toMatchObject({ chosenBy: 'sql', binding: { bound: true, query: { name: 'Sales', sql: 'SELECT c.CompanyName, c.City FROM dbo.Customers c WHERE c.Region = @Region' } } });
    // The RDL names its true source: a layout without it is never a reason to bind another object (BT-9).
    expect(by['missing.rdl']).toMatchObject({
      chosenBy: null,
      binding: { bound: false, reason: "The SSRS report's DataSet Sales runs the stored procedure dbo.usp_Missing, which the layout of FormaSample does not have: give the layout of the database it runs in." },
    });
    expect(readRepxDataSources(readFileSync(join(dir, 'missing.converted.repx'), 'utf8'))).toEqual([]);
  });

  it('runs the stored procedure an SSRS DataSet names in brackets (BT-3)', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    put(dir, 'sp.rdl', salesRdl('StoredProcedure', '[dbo].[usp_SalesByRegion]'));
    const ran = await cli(['convert', 'sp.rdl', '--database', 'formasample.txt', '--json'], { cwd: dir });
    expect(ran.json()[0]).toMatchObject({ chosenBy: 'procedure', binding: { bound: true, query: { procedure: 'dbo.usp_SalesByRegion' } } });
  });

  it('--require-binding fails a converted report that could not be bound, and convert with no database is as before', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    put(dir, 'odd.rdl', salesRdl('StoredProcedure', 'dbo.usp_Missing', '<Field Name="Sprocket"><DataField>Sprocket</DataField></Field>').replace(/Fields!(Region|SalesTotal)/g, 'Fields!Sprocket'));
    const held = await cli(['convert', 'odd.rdl', '--database', 'formasample.txt', '--require-binding'], { cwd: dir });
    expect(held.code).toBe(EXIT.failed);
    expect(held.err).toContain('The report was written, but it is not bound to the database given (--require-binding).');
    const plain = await cli(['convert', 'odd.rdl', '--out', 'plain.repx', '--json'], { cwd: dir });
    expect(plain.json()[0].binding).toBeUndefined();
    expect(readRepxDataSources(readFileSync(join(dir, 'plain.repx'), 'utf8'))).toEqual([]);
  });
});

describe('sql-script', () => {
  it("prints Forma's read-only layout script, or the sample script with its names quoted, and needs no AI", async () => {
    const dir = folder();
    const layout = await cli(['sql-script'], { cwd: dir });
    expect(layout).toMatchObject({ code: EXIT.done, out: SCHEMA_SCRIPT });
    const sample = await cli(['sql-script', '--sample', 'dbo.Orders,[Sales].[Order Lines]', '--rows', '3'], { cwd: dir });
    expect(sample.out).toBe(sampleScript([{ schema: 'dbo', name: 'Orders' }, { schema: 'Sales', name: 'Order Lines' }], 3));
    expect(sample.out).toContain('FROM [Sales].[Order Lines]');
    const json = await cli(['sql-script', '--json'], { cwd: dir });
    expect(json.json()[0]).toMatchObject({ type: 'input', command: 'sql-script', status: 'done', script: 'layout', text: SCHEMA_SCRIPT });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('writes the script to --out and prints the sqlcmd line that keeps it UTF-8, never -W, never a redirect', async () => {
    const dir = folder();
    const ran = await cli(['sql-script', '--out', 'forma-schema.sql', '--sqlcmd', '(localdb)\\MSSQLLocalDB', 'FormaSample'], { cwd: dir });
    expect(ran.code, ran.err).toBe(EXIT.done);
    expect(readFileSync(join(dir, 'forma-schema.sql'), 'utf8')).toBe(SCHEMA_SCRIPT);
    // Measured by the wave-5 review (BT-1): sqlcmd 16 refuses -h beside -y 0, and without -b a script SQL Server fails exits 0.
    expect(ran.lines).toContain('sqlcmd -S "(localdb)\\MSSQLLocalDB" -d FormaSample -E -y 0 -b -f 65001 -i forma-schema.sql -o forma-schema.txt');
    expect(ran.out).not.toMatch(/ -W|>| -h /);
    expect(ran.err).toContain('-E signs in with your Windows account');
    expect(sqlcmdLine('db01', 'Shop $env:X', 'a.sql', 'a.txt')).toBeNull();
    expect(sqlcmdLine('db01', 'My Shop', 'a b.sql', 'a b.txt')).toBe('sqlcmd -S db01 -d "My Shop" -E -y 0 -b -f 65001 -i "a b.sql" -o "a b.txt"');
  });

  it('quotes every value holding a backslash, which a POSIX shell reads as an escape unquoted, and refuses one a quote cannot keep (BT-8)', async () => {
    // A named instance and a path in a subfolder keep their backslashes in PowerShell, cmd and Git Bash alike.
    expect(sqlcmdLine('db01\\SQLEXPRESS', 'Shop', 'sub\\layout.sql', 'sub\\layout.txt')).toBe('sqlcmd -S "db01\\SQLEXPRESS" -d Shop -E -y 0 -b -f 65001 -i "sub\\layout.sql" -o "sub\\layout.txt"');
    // A backslash at the end escapes the closing quote, and two together are read as one inside quotes: refused, never printed.
    expect(sqlcmdLine('db01\\', 'Shop', 'a.sql', 'a.txt')).toBeNull();
    expect(sqlcmdLine('\\\\server\\SQL', 'Shop', 'a.sql', 'a.txt')).toBeNull();
    const dir = folder();
    mkdirSync(join(dir, 'sub'));
    const ran = await cli(['sql-script', '--out', join('sub', 'layout.sql'), '--sqlcmd', 'db01\\SQLEXPRESS', 'Shop'], { cwd: dir });
    expect(ran.code, ran.err).toBe(EXIT.done);
    const line = ran.lines.find((l) => l.startsWith('sqlcmd '))!;
    expect(line).toContain('-S "db01\\SQLEXPRESS"');
    // The script and its answer, as the platform spells a path in a subfolder: quoted when it holds a backslash.
    const script = join('sub', 'layout.sql');
    expect(line).toContain(`-i ${script.includes('\\') ? `"${script}"` : script} -o `);
    const refused = await cli(['sql-script', '--out', 'x.sql', '--sqlcmd', 'db01\\', 'Shop'], { cwd: dir });
    expect(refused.code).toBe(EXIT.usage);
    expect(refused.err).toContain('a backslash at its end');
  });

  it("reads the layout back exactly in every form sqlcmd writes it: UTF-8 with -f 65001, with and without a mark, UTF-16LE with -u, and refuses the code page's", () => {
    const expected = readSchemaExport(SCHEMA_EXPORT);
    const bom = (bytes: Uint8Array, mark: number[]) => new Uint8Array([...mark, ...bytes]);
    const utf8 = new TextEncoder().encode(LAYOUT_TEXT);
    const utf16 = new Uint8Array(Buffer.from(LAYOUT_TEXT, 'utf16le'));
    for (const [form, bytes] of [
      ['-f 65001', utf8],
      ['-f 65001 with a mark', bom(utf8, [0xef, 0xbb, 0xbf])],
      ['-u', bom(utf16, [0xff, 0xfe])],
    ] as const) {
      const read = layoutFromFile(bytes, 'forma-schema.txt');
      expect(read.ok, form).toBe(true);
      if (read.ok) expect(read.schema, form).toEqual(expected);
    }
    // Without -f, sqlcmd writes the computer's code page: a name in another script is lost, and refused with the fix,
    // which is writing it again (BT-5): a Latin letter as a byte that is not UTF-8, a letter the code page lacks as "?".
    const named = LAYOUT_TEXT.replace('"Customers"', '"Kunden\u00e4"');
    const ansi = new Uint8Array(Buffer.from(named, 'latin1'));
    const lost = layoutFromFile(ansi, 'forma-schema.txt');
    expect(lost).toMatchObject({ ok: false });
    if (!lost.ok) expect(lost.reason).toMatch(/not UTF-8.*write it again as UTF-8 from the start, with sqlcmd's -f 65001/);
    const questioned = layoutFromFile(new TextEncoder().encode(LAYOUT_TEXT.replace('"Customers"', '"??????"')), 'forma-schema.txt');
    expect(questioned).toMatchObject({ ok: false, reason: expect.stringMatching(/lost to a code page, so they read as question marks/) });
  });
});

describe('batch with a database', () => {
  it('binds each file on its own, so one file\'s query never carries to the next (D1-9), and counts the bound', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    mkdirSync(join(dir, 'in'), { recursive: true });
    writeFileSync(join(dir, 'in', 'a.png'), titlePng('CUSTOMERS'));
    writeFileSync(join(dir, 'in', 'b.png'), titlePng('SALES'));
    put(dir, join('in', 'sales.rdl'), salesRdl('StoredProcedure', 'dbo.usp_SalesByRegion'));
    // The first design names the customers, the second the procedure: each file's own step writes its own.
    const picks = [{ table: 'dbo.Customers' }, { procedure: 'dbo.usp_SalesByRegion' }];
    let designs = 0;
    const hooks: GenHooks = {
      ...NEVER,
      ask: async (_prompt, _parts, _config, previous, _signal, _onProgress, options) => {
        const answer = mockAnswer('true', previous, options);
        return (previous?.repxContent ? answer : { ...answer, dataQuery: picks[designs++] }) as never;
      },
    };
    const ran = await cli(['batch', 'in', '--out', 'out', '--mock', '--database', 'formasample.txt', '--require-binding', '--json'], { cwd: dir, env: AI, hooks });
    expect(ran.code, ran.err).toBeLessThanOrEqual(EXIT.auditErrors);
    const rows = ran.json();
    const by = Object.fromEntries(rows.filter((r) => r.type === 'input').map((r) => [r.input.split(/[\\/]/).pop(), r]));
    expect(by['a.png'].binding).toMatchObject({ bound: true, query: { table: 'dbo.Customers' } });
    expect(by['b.png'].binding).toMatchObject({ bound: true, query: { procedure: 'dbo.usp_SalesByRegion' } });
    expect(by['sales.rdl']).toMatchObject({ route: 'convert', chosenBy: 'procedure', binding: { bound: true } });
    expect(rows.find((r) => r.type === 'summary')).toMatchObject({ binding: { bound: 3, unbound: 0 } });
    // Read and said once, before the first file.
    expect(ran.err.match(/Database layout read from/g)).toHaveLength(1);
  });

  it('binds every SSRS report a batch converts to the query pinned for it, never its own DataSet\'s (BT-4)', async () => {
    const dir = folder();
    put(dir, 'formasample.txt', LAYOUT_TEXT);
    const customers = '<Field Name="CompanyName"><DataField>CompanyName</DataField></Field><Field Name="City"><DataField>City</DataField></Field>';
    put(dir, join('in', 'table.rdl'), salesRdl('TableDirect', 'dbo.Customers', customers));
    put(dir, join('in', 'sales.rdl'), salesRdl('StoredProcedure', 'dbo.usp_SalesByRegion'));
    const ran = await cli(['batch', 'in', '--out', 'out', '--database', 'formasample.txt', '--procedure', 'dbo.usp_SalesByRegion', '--json', '--fail-on', 'never'], { cwd: dir, env: AI, hooks: NEVER });
    const rows = ran.json();
    const by = Object.fromEntries(rows.filter((r) => r.type === 'input').map((r) => [r.input.split(/[\\/]/).pop(), r]));
    for (const name of ['table.rdl', 'sales.rdl']) expect(by[name], name).toMatchObject({ route: 'convert', chosenBy: 'pinned', binding: { bound: true, query: { procedure: 'dbo.usp_SalesByRegion' } } });
    // The field its DataSet reads as Total, which the procedure returns, is renamed; nothing else is.
    expect(by['sales.rdl'].binding.notes).toContain('Renamed a field to the column the query returns: SalesTotal to Total.');
    expect(rows.find((r) => r.type === 'summary')).toMatchObject({ binding: { bound: 2, unbound: 0 } });
  });

  it('refuses a layout that cannot be read before any file is made', async () => {
    const dir = folder();
    put(dir, 'cut.txt', SCHEMA_EXPORT.slice(0, -3));
    mkdirSync(join(dir, 'in'), { recursive: true });
    writeFileSync(join(dir, 'in', 'a.png'), titlePng('X'));
    const ran = await cli(['batch', 'in', '--out', 'out', '--mock', '--database', 'cut.txt'], { cwd: dir, env: AI, hooks: NEVER });
    expect(ran.code).toBe(EXIT.failed);
    expect(existsSync(join(dir, 'out'))).toBe(false);
  });
});

/* ------------------------------------------------------------ spawned as the docs give it */

const LAUNCHER = join(CLONE, ...CLI_LAUNCHER.split('/'));
const children: { child: ChildProcessWithoutNullStreams; exited: Promise<number | null> }[] = [];
afterAll(async () => {
  for (const { child, exited } of children.splice(0)) {
    if (child.exitCode === null) child.kill();
    await exited;
  }
});

/** The command line spawned from a fresh folder outside the clone, with plain node, the home and temp folders scratch ones. */
function spawned(args: string[], env: Record<string, string>, prepare: (cwd: string) => void) {
  const cwd = realpathSync.native(mkdtempSync(join(scratch, 'spawned-')));
  const home = mkdtempSync(join(scratch, 'home-'));
  const temp = mkdtempSync(join(scratch, 'temp-'));
  prepare(cwd);
  const base: NodeJS.ProcessEnv = { ...process.env, USERPROFILE: home, HOME: home, TEMP: temp, TMP: temp, TMPDIR: temp };
  for (const name of Object.keys(base)) if (name.startsWith('FORMA_') || name === 'CLAUDE_PROJECT_DIR' || name === 'TSX_TSCONFIG_PATH' || name === 'GEMINI_API_KEY') delete base[name];
  const child = spawn(process.execPath, [LAUNCHER, ...args], { cwd, env: { ...base, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end();
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  const exited = new Promise<number | null>((done) => child.on('exit', (code) => done(code)));
  children.push({ child, exited });
  return { cwd, done: new Promise<{ code: number | null; out: string; err: string }>((done) => child.on('close', (code) => done({ code, out, err }))) };
}

describe('spawned as the docs give it', () => {
  it('generates a picture bound to a stored procedure, through the real worker threads, stdout JSON Lines alone', { timeout: 180_000 }, async () => {
    const s = spawned(['generate', 'sales.png', '--mock', '--database', 'formasample.txt', '--procedure', 'dbo.usp_SalesByRegion', '--json'], { ...AI } as Record<string, string>, (cwd) => {
      writeFileSync(join(cwd, 'sales.png'), titlePng('SALES'));
      writeFileSync(join(cwd, 'formasample.txt'), LAYOUT_TEXT);
    });
    const done = await s.done;
    expect(done.code, done.err.slice(-2000)).toBeLessThanOrEqual(EXIT.auditErrors);
    const lines = done.out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(['input', 'summary']);
    expect(lines[0].binding).toMatchObject({ bound: true, query: { procedure: 'dbo.usp_SalesByRegion' }, connection: 'FormaSample', parameters: ['Region', 'From', 'To'] });
    expect(done.err).toContain('Database layout read from "formasample.txt": FormaSample:');
    expect(`${done.out}${done.err}`).not.toContain(geminiKey);
  });

  it('binds with no AI and no AI set up, and prints the layout script', { timeout: 120_000 }, async () => {
    const bound = spawned(['bind', 'r.repx', '--database', 'formasample.txt', '--object', 'dbo.Customers', '--json'], {}, (cwd) => {
      writeFileSync(join(cwd, 'r.repx'), report(['CompanyName', 'City']));
      writeFileSync(join(cwd, 'formasample.txt'), new Uint8Array([0xff, 0xfe, ...Buffer.from(LAYOUT_TEXT, 'utf16le')]));
    });
    const done = await bound.done;
    expect(done.code, done.err.slice(-2000)).toBe(EXIT.done);
    expect(JSON.parse(done.out.split('\n')[0]).binding).toMatchObject({ bound: true, query: { table: 'dbo.Customers' } });
    expect(sourceOf(join(bound.cwd, 'r.bound.repx'))).toMatchObject({ connection: 'FormaSample', queries: [{ name: 'Customers' }] });
    const script = await spawned(['sql-script'], {}, () => {}).done;
    expect(script).toMatchObject({ code: 0, out: SCHEMA_SCRIPT, err: '' });
  });
});
