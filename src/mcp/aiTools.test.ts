/**
 * The MCP server's two AI tools in process (2026-11-24, the MCP work's wave
 * 8): generate_report and revise_report called through `serveStdio` over the
 * SDK's InMemoryTransport (testClient.ts), in both protocol eras, their work
 * run in the test's own thread with the AI stood in: the mock
 * (FORMA_MCP_MOCK's runner) or an `ask` and a `chat` of the test's own. No
 * key is real and no request leaves the process; every key is built at run
 * time (TST-10).
 *
 * What is held: with no AI set up both stay listed and refuse with
 * SET_UP_AI's words and the names to set, before any file is read
 * (PROTO-8), and a Local AI address off this computer refuses them (SEC-11);
 * a report made from a description, from a .repx (its stored login gone
 * before the AI sees it, SEC-3) and data files, written to a new file and
 * never over one; paths refused before any request (SEC-5, GAP1-1); the
 * switch note when another AI set up answered on a limit (SEC-11); Forma's
 * draft standing in when the AI fails, said so; progress only rising, and
 * none after the result (PROTO-3); one call at a time, the second told it
 * waits (OD7, PROTO-7); a cancellation writing nothing, no partial file left
 * (PROTO-4); revise_report's outcomes, the chat's own (PROTO-9): edits by
 * control name to a new file, a question answered from the report's facts
 * with no AI, a redesign, a different report said for generate_report, the
 * chat's tools with no equivalent here said so; and no key's value in any
 * result, error or log line (SEC-7).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SET_UP_AI } from '../lib/aiProvider';
import { switchNote } from '../lib/fallbackChain';
import type { GenerationDeps } from '../lib/generationCore';
import { FORMA_KEYS, redactorFor } from '../lib/keyRedact';
import { encodeBase64 } from '../lib/repxSqlDataSource';
import { buildMockReportReply, mockAnswer, type ChatOutcome } from '../services/geminiService';
import { readAiSettings, type AiEnv, type AiSettings } from './aiSettings';
import { CALLS_AI } from './aiTools';
import { createFormaServer, formaVersion, nodeSystem } from './formaServer';
import type { ChatFn, GenSetup } from './genJobs';
import { oneAtATime, type Generator } from './generator';
import { readEnvRoots } from './roots';
import { loadRepxSkill } from './skillResource';
import { connectInMemory, inThread, inThreadGenerator, openLegacy, textJson } from './testClient';

const CLONE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OWNER_WORK = resolve(CLONE, '..', 'forma-model-data-kept-not-in-git', 'forma-model-data', 'work');
const scratch = realpathSync.native(mkdtempSync(join(existsSync(OWNER_WORK) ? OWNER_WORK : tmpdir(), 'mcp-ai-')));
const root = join(scratch, 'project');
const elsewhere = join(scratch, 'elsewhere');
mkdirSync(root);
mkdirSync(elsewhere);
/** Forma's own folder for every runner here: OCR's language data is gathered into it once. */
const SETUP: GenSetup = { mock: false, userFolder: join(scratch, 'forma-user'), paddleModels: null };

const system = nodeSystem();
const skills = await loadRepxSkill(() => {}, { strict: true });
const envRoots = readEnvRoots({ FORMA_MCP_ROOTS: root }, system);

/** Keys of each kind, built at run time. */
const geminiKey = ['AI', 'za', 'Sy'].join('') + 'D'.repeat(33);
const openRouterKey = ['sk', 'or', 'v1'].join('-') + '-' + 'ef56'.repeat(16);
const GEMINI: AiEnv = { FORMA_GEMINI_KEY: geminiKey };
const BOTH: AiEnv = { FORMA_PROVIDER: 'gemini', FORMA_GEMINI_KEY: geminiKey, FORMA_OPENROUTER_KEY: openRouterKey, FORMA_OPENROUTER_MODEL: 'meta/llama:free' };
const MODERN = '2026-07-28';
const meta = (extra: Record<string, unknown> = {}) => ({
  'io.modelcontextprotocol/protocolVersion': MODERN,
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
  ...extra,
});

let mockGenerator: Generator;
const logged: string[] = [];

beforeAll(() => {
  // The pipeline logs freely, as in the browser; the real server sends that to stderr through the scrubber.
  for (const level of ['log', 'info', 'warn', 'debug', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
  mockGenerator = oneAtATime(inThreadGenerator({ ...SETUP, mock: true }, { log: (l) => logged.push(l) }));
});

afterAll(async () => {
  await mockGenerator.close();
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

type Ask = NonNullable<GenerationDeps['ask']>;
const stopped = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });

/** A server whose AI tools ask `settings`' AI through `generator` (no AI set up when both are absent), its scrubber the one stdio.ts builds. */
async function serve(settings?: AiSettings, generator: Generator | null = null) {
  const log: string[] = [];
  const redact = redactorFor(settings?.secrets ?? [], FORMA_KEYS);
  const factory = () => createFormaServer({ envRoots, system, version: formaVersion(), skills, pipeline: inThread, log: (l) => log.push(l), redact, ...(settings ? { ai: { settings, generator } } : {}) });
  const c = await openLegacy(factory);
  return { ...c, log, factory };
}

/** The same server, as a 2026-07-28 client reaches it. */
async function serveModern(settings: AiSettings, generator: Generator) {
  const c = await connectInMemory(() => createFormaServer({ envRoots, system, version: formaVersion(), skills, pipeline: inThread, log: () => {}, redact: redactorFor(settings.secrets, FORMA_KEYS), ai: { settings, generator } }));
  await c.request('server/discover', { _meta: meta() });
  return { ...c, call: (name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) => c.request('tools/call', { name, arguments: args, _meta: meta(extra) }) };
}

type Client = Awaited<ReturnType<typeof serve>>;

async function call(c: Client, name: string, args: Record<string, unknown>, metaArg?: Record<string, unknown>, onId?: (id: number) => void): Promise<Record<string, any>> {
  const result = (await c.call(name, args, metaArg, onId)).result as Record<string, any>;
  if (!result.isError) expect(textJson(result)).toEqual(result.structuredContent);
  return result;
}
const errorText = (result: Record<string, any>) => {
  expect(result.isError, JSON.stringify(result).slice(0, 400)).toBe(true);
  return result.content[0].text as string;
};
const at = (...parts: string[]) => join(root, ...parts);
function put(path: string, text: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}
const partials = () => readdirSync(root, { recursive: true }).map(String).filter((f) => f.includes('forma-partial'));

const SECRET = 'Secret123';
const LOGIN_SOURCE = `<SqlDataSource Name="sqlDataSource1"><Connection Name="Sales" ProviderKey="MSSqlServer"><Parameters><Parameter Name="server" Value="db01" /><Parameter Name="database" Value="Sales" /><Parameter Name="userid" Value="sa" /><Parameter Name="password" Value="${SECRET}" /></Parameters></Connection><Query Type="SelectQuery" Name="Orders"><Tables><Table Name="Orders" /></Tables><Columns><AllColumns /></Columns></Query></SqlDataSource>`;

/** A small invoice: a title in its header, a field in its Detail band, and with `login` a SQL data source that keeps one. */
function invoice({ login = false } = {}): string {
  const storage = login ? `<ComponentStorage><Item1 Ref="9" ObjectType="DevExpress.DataAccess.Sql.SqlDataSource,DevExpress.DataAccess.v20.1" Name="sqlDataSource1" Base64="${encodeBase64(LOGIN_SOURCE)}" /></ComponentStorage>` : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Invoice" Margins="100, 100, 100, 100" PageWidth="850" PageHeight="1100" Version="20.1"${login ? ' DataMember="Orders" DataSource="#Ref-9"' : ''}>
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="100" />
    <Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="60">
      <Controls>
        <Item1 Ref="4" ControlType="XRLabel" Name="title" Text="Invoice" LocationFloat="0, 10" SizeF="300, 30" Font="Arial, 14pt" Padding="2,2,0,0,100" />
      </Controls>
    </Item2>
    <Item3 Ref="5" ControlType="DetailBand" Name="Detail" HeightF="25">
      <Controls>
        <Item1 Ref="6" ControlType="XRLabel" Name="amount" LocationFloat="0, 0" SizeF="200, 25" Padding="2,2,0,0,100">
          <ExpressionBindings>
            <Item1 Ref="7" EventName="BeforePrint" PropertyName="Text" Expression="[Amount]" />
          </ExpressionBindings>
        </Item1>
      </Controls>
    </Item3>
    <Item4 Ref="8" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="100" />
  </Bands>${storage}
</XtraReportsLayoutSerializer>
`;
}

/**
 * The AI's design stood in: the mock invoice, after `progress` streamed and
 * `wait` resolved; `fail` refuses a config; `answerWhenStopped` answers even
 * once the call was stopped, as a provider that finished anyway does.
 */
function askWith(
  o: { progress?: number[]; wait?: (signal: AbortSignal) => Promise<void>; fail?: (provider: string | undefined) => Error | null; seen?: { provider?: string; texts: string }[]; answerWhenStopped?: boolean } = {},
): Ask {
  return async (_prompt, parts, config, previous, signal, onProgress, options) => {
    o.seen?.push({ provider: config?.provider, texts: JSON.stringify(parts) });
    const failure = o.fail?.(config?.provider);
    if (failure) throw failure;
    for (const percent of o.progress ?? []) {
      onProgress?.({ chars: percent * 100, percent, elapsedMs: 0 });
      await new Promise((done) => setTimeout(done, 2));
    }
    if (o.wait && signal) await o.wait(signal);
    if (signal?.aborted && !o.answerWhenStopped) throw stopped();
    return mockAnswer('true', previous, options);
  };
}

/** A limit, as the free chain knows one. */
const limit = () => Object.assign(new Error('Too many requests: the free quota is used up'), { status: 429 });

describe('with no AI set up', () => {
  it('lists both AI tools, every hint set as a tool that reaches an AI and replaces nothing, saying it calls one', async () => {
    const c = await serve();
    const tools = (await c.request('tools/list')).result?.tools as Record<string, any>[];
    for (const name of ['generate_report', 'revise_report']) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.annotations, name).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
      expect(tool?.description, name).toContain(CALLS_AI);
    }
    await c.close();
  });

  it("refuses both with the app's words and the names to set, before any path is judged or file read", async () => {
    const c = await serve();
    for (const [name, args] of [
      ['generate_report', { description: 'An invoice', output: at('never.repx') }],
      ['revise_report', { path: at('no-such.repx'), request: 'bold' }],
    ] as const) {
      const said = errorText(await call(c, name, args));
      expect(said.startsWith(SET_UP_AI), name).toBe(true);
      for (const variable of ['FORMA_GEMINI_KEY', 'FORMA_OPENROUTER_KEY', 'FORMA_LOCAL_MODEL']) expect(said, name).toContain(variable);
      expect(said, name).not.toMatch(/no-such|never\.repx/);
    }
    expect(existsSync(at('never.repx'))).toBe(false);
    await c.close();
  });

  it('refuses both while the Local AI address is off this computer, whatever else is set', async () => {
    const settings = readAiSettings({ FORMA_PROVIDER: 'local', FORMA_LOCAL_MODEL: 'qwen3.5:9b', FORMA_LOCAL_URL: 'http://10.1.2.3:11434/v1' });
    const c = await serve(settings, mockGenerator);
    const said = errorText(await call(c, 'generate_report', { description: 'An invoice', output: at('lan.repx') }));
    expect(said).toContain('FORMA_LOCAL_URL names "10.1.2.3", which is not this computer');
    expect(existsSync(at('lan.repx'))).toBe(false);
    await c.close();
  });
});

describe('generate_report', () => {
  it('makes a report from a description alone, in both eras, writing a new .repx and naming who answered', { timeout: 60_000 }, async () => {
    const settings = readAiSettings({ ...GEMINI, FORMA_MCP_MOCK: '1' });
    const c = await serve(settings, mockGenerator);
    const result = await call(c, 'generate_report', { description: 'An invoice with a title, the customer, and a table of items with a total.', output: at('described', 'invoice.repx') });
    expect(result.isError, JSON.stringify(result).slice(0, 600)).toBeUndefined();
    const data = result.structuredContent;
    expect(data).toMatchObject({ written: { path: at('described', 'invoice.repx'), status: 'written' }, ai: 'mock', switched: false, standIn: null, pictures: 0 });
    expect(result.content[0].text.split('\n\n')[0]).toMatch(/^Wrote ".*invoice\.repx"\. Made by the mock invoice \(FORMA_MCP_MOCK is on\), with no AI asked\. The report has /);
    const written = readFileSync(at('described', 'invoice.repx'), 'utf8');
    expect(written).toContain('<XtraReportsLayoutSerializer');
    expect(data.written.bytes).toBe(Buffer.byteLength(written));
    expect(logged.concat(c.log).join('\n')).toContain(`generate_report wrote ${JSON.stringify(at('described', 'invoice.repx'))}`);
    // A file whose name begins sk- is named as it is, in the data, the summary and the log (W8C-2: it came back as "(a key).repx").
    const skName = at('described', 'sk-customer-invoices-2026.repx');
    const named = await call(c, 'generate_report', { description: 'An invoice with a title.', output: skName });
    expect(named.structuredContent.written).toMatchObject({ path: skName, status: 'written' });
    expect(named.content[0].text.split('\n\n')[0]).toContain(JSON.stringify(skName));
    expect(c.log.join('\n')).toContain(`generate_report wrote ${JSON.stringify(skName)}`);
    await c.close();

    const m = await serveModern(settings, mockGenerator);
    const modern = (await m.call('generate_report', { description: 'An invoice with a title.', output: at('described', 'modern.repx') })).result as Record<string, any>;
    expect(modern.resultType).toBe('complete');
    expect(modern.structuredContent).toMatchObject({ written: { status: 'written' }, ai: 'mock' });
    expect(existsSync(at('described', 'modern.repx'))).toBe(true);
    await m.close();
  });

  it('makes a report from a .repx and a data file, beside the first file, the stored login gone before the AI sees it', { timeout: 60_000 }, async () => {
    const seen: { provider?: string; texts: string }[] = [];
    const gen = inThreadGenerator(SETUP, { ask: askWith({ seen }) });
    const c = await serve(readAiSettings(GEMINI), gen);
    put(at('from-repx', 'old.repx'), invoice({ login: true }));
    put(at('from-repx', 'items.csv'), 'Item,Qty,Price\nChai,12,18.00\n');
    // A connection string in a data file loses its password before the AI sees it (W8C-5).
    put(at('from-repx', 'conn.txt'), 'Server=db02;Database=Sales;User Id=sa;Password=Secret12388;\nThe orders table holds one row per order.\n');
    const result = await call(c, 'generate_report', { description: 'Make it a sales invoice', files: [at('from-repx', 'old.repx')], data: [at('from-repx', 'items.csv'), at('from-repx', 'conn.txt')] });
    expect(result.isError, JSON.stringify(result).slice(0, 600)).toBeUndefined();
    expect(result.structuredContent.written).toMatchObject({ path: at('from-repx', 'old.generated.repx'), status: 'written' });
    expect(result.structuredContent.ai).toBe('gemini');
    expect(result.structuredContent.notices.join(' ')).toMatch(/login/i);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].texts).toContain('Existing DevExpress report');
    expect(seen[0].texts).toContain('Chai');
    expect(seen[0].texts).toContain('one row per order');
    for (const s of seen) expect(s.texts).not.toMatch(/Secret123|db01/);
    expect(readFileSync(at('from-repx', 'old.generated.repx'), 'utf8')).not.toContain(SECRET);
    // The file it was made from is as it was.
    expect(readFileSync(at('from-repx', 'old.repx'), 'utf8')).toBe(invoice({ login: true }));
    await c.close();
    await gen.close();
  });

  it('refuses before any request: nothing to make it from, no output with no file, a path outside, a data file passed as a source, a C# report, a credential', async () => {
    const seen: { provider?: string; texts: string }[] = [];
    const c = await serve(readAiSettings(GEMINI), inThreadGenerator(SETUP, { ask: askWith({ seen }) }));
    put(at('refused', 'rows.json'), '[{"a":1}]');
    put(at('refused', 'Report1.cs'), 'public class Report1 : DevExpress.XtraReports.UI.XtraReport {}');
    put(at('refused', 'service-account.json'), '{}');
    put(at('refused', 'appsettings.Production.json'), '{}');
    put(join(elsewhere, 'page.png'), 'not really a picture');
    const cases: [Record<string, unknown>, RegExp][] = [
      [{}, /^Send a description of the report, files to make it from/],
      [{ description: 'An invoice' }, /^Name output, the full path of the \.repx to write/],
      [{ files: [join(elsewhere, 'page.png')] }, /outside the folders this server may use/],
      [{ files: [at('refused', 'rows.json')] }, /is not a \.png or .*\.frx file/],
      [{ files: [at('refused', 'Report1.cs')] }, /C#/],
      [{ description: 'x', data: [at('refused', 'service-account.json')], output: at('refused', 'out.repx') }, /named as a file of credentials/],
      [{ description: 'x', data: [at('refused', 'appsettings.Production.json')], output: at('refused', 'out.repx') }, /named as a file of credentials/],
      [{ files: ['refused/rows.csv'] }, /full path/],
      [{ description: 'x', output: at('refused', 'out.pdf') }, /is not a \.repx file/],
    ];
    for (const [args, why] of cases) expect(errorText(await call(c, 'generate_report', args)), JSON.stringify(args)).toMatch(why);
    expect(seen).toEqual([]);
    expect(readdirSync(at('refused')).sort()).toEqual(['Report1.cs', 'appsettings.Production.json', 'rows.json', 'service-account.json']);
    await c.close();
  });

  it('says where the words went when another AI set up answered on a limit of the one chosen', { timeout: 60_000 }, async () => {
    const seen: { provider?: string; texts: string }[] = [];
    const gen = inThreadGenerator(SETUP, { ask: askWith({ seen, fail: (provider) => (provider === 'auto' ? limit() : null) }) });
    const c = await serve(readAiSettings(BOTH), gen);
    const result = await call(c, 'generate_report', { description: 'An invoice with a title.', output: at('switched', 'invoice.repx') });
    expect(result.isError, JSON.stringify(result).slice(0, 600)).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ ai: 'openrouter', switched: true });
    expect(result.structuredContent.notices).toContain(switchNote('gemini', 'openrouter'));
    expect(result.content[0].text.split('\n\n')[0]).toContain('Made by OpenRouter, which answered on a limit of the AI chosen');
    expect(seen.map((s) => s.provider).slice(0, 2)).toEqual(['auto', 'openrouter']);
    await c.close();
    await gen.close();
  });

  it("stands Forma's own draft in when every AI fails, says so, and keeps the key out of everything it returns and logs", { timeout: 60_000 }, async () => {
    const gen = inThreadGenerator(SETUP, { ask: askWith({ fail: () => new Error(`API key not valid. Please pass a valid API key: ${geminiKey}`) }) });
    const c = await serve(readAiSettings(GEMINI), gen);
    const result = await call(c, 'generate_report', { description: 'An invoice with a title and a table of items.', output: at('stand-in', 'invoice.repx') });
    expect(result.isError, JSON.stringify(result).slice(0, 600)).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ ai: null, standIn: 'offline', written: { status: 'written' } });
    expect(result.structuredContent.notices.join(' ')).toContain("Forma's own draft stands in: Forma's own model's design from the description");
    expect(result.structuredContent.fromFile.aiError).toContain('(a key)');
    expect(JSON.stringify(result)).not.toContain(geminiKey);
    expect(c.log.join('\n')).not.toContain(geminiKey);
    await c.close();
    await gen.close();

    // A key with no shape of its own, known only by its value, quoted where the 200-character clip of fromFile cuts it (W8C-1).
    const shapeless = ['gq', '00'].join('') + 'f4aba7fbd7a9'.repeat(3);
    const padded = inThreadGenerator(SETUP, { ask: askWith({ fail: () => new Error(`API key not valid for ${'the request '.repeat(13)}key ${shapeless} rejected.`) }) });
    const p = await serve(readAiSettings({ FORMA_GEMINI_KEY: shapeless }), padded);
    const across = await call(p, 'generate_report', { description: 'An invoice with a title and a table of items.', output: at('stand-in', 'padded.repx') });
    expect(across.structuredContent.standIn).toBe('offline');
    expect(across.structuredContent.fromFile.aiError).toMatch(/^API key not valid for the request .*\(a k/);
    expect(JSON.stringify(across)).not.toContain(shapeless.slice(0, 8));
    expect(p.log.join('\n')).not.toContain(shapeless.slice(0, 8));
    await p.close();
    await padded.close();
  });

  it('reports its progress only rising while it runs, when the request asks, and none after the result', { timeout: 60_000 }, async () => {
    const gen = oneAtATime(inThreadGenerator(SETUP, { ask: askWith({ progress: [5, 30, 60, 10, 50, 90, 95] }) }));
    const c = await serve(readAiSettings(GEMINI), gen);
    const result = await call(c, 'generate_report', { description: 'An invoice with a title.', output: at('progress', 'a.repx') }, { progressToken: 'p-1' });
    expect(result.isError, JSON.stringify(result).slice(0, 600)).toBeUndefined();
    await new Promise((done) => setTimeout(done, 50));
    const progress = c.notes.filter((n) => n.method === 'notifications/progress');
    expect(progress.length).toBeGreaterThan(2);
    const values = progress.map((n) => n.params.progress as number);
    for (let i = 1; i < values.length; i++) expect(values[i], `notification ${i}: ${values.join(', ')}`).toBeGreaterThan(values[i - 1]);
    for (const n of progress) expect(n.params).toMatchObject({ progressToken: 'p-1', total: 100 });
    expect(progress.map((n) => n.params.message)).toContain('Waiting for the AI.');
    // Every one came before the result: the reply count each saw is the one before the call's own.
    expect(new Set(progress.map((n) => n.replied)).size).toBe(1);
    const before = c.notes.length;
    // Without a progressToken, none at all.
    await call(c, 'generate_report', { description: 'An invoice with a title.', output: at('progress', 'b.repx') });
    expect(c.notes.slice(before).filter((n) => n.method === 'notifications/progress')).toEqual([]);
    await c.close();
    await gen.close();
  });

  it('runs one call at a time: a second waits, told so, and runs once the first has finished', { timeout: 60_000 }, async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((done) => (release = done));
    // Each call's own signal, as the AI is asked for it; the first call is held until released.
    const calls: AbortSignal[] = [];
    const wait = async (signal: AbortSignal) => {
      if (!calls.includes(signal)) calls.push(signal);
      if (signal === calls[0]) await held;
    };
    const gen = oneAtATime(inThreadGenerator(SETUP, { ask: askWith({ wait }) }));
    const c = await serve(readAiSettings(GEMINI), gen);
    const first = call(c, 'generate_report', { description: 'An invoice.', output: at('queue', 'first.repx') }, { progressToken: 'first' });
    await vi.waitFor(() => expect(calls.length).toBe(1), { timeout: 20_000 });
    const second = call(c, 'generate_report', { description: 'A list.', output: at('queue', 'second.repx') }, { progressToken: 'second' });
    await vi.waitFor(() => expect(c.notes.some((n) => n.params.progressToken === 'second')).toBe(true));
    expect(c.notes.find((n) => n.params.progressToken === 'second')?.params.message).toBe('Waiting for the report before it to finish.');
    expect(gen.waiting).toBe(1);
    expect(calls.length).toBe(1);
    expect(existsSync(at('queue', 'second.repx'))).toBe(false);
    release();
    const [one, two] = await Promise.all([first, second]);
    expect(one.structuredContent.written.status).toBe('written');
    expect(two.structuredContent.written.status).toBe('written');
    expect(calls.length).toBe(2);
    await c.close();
    await gen.close();
  });

  it('stops on a cancellation and writes nothing, no partial file either, and the next call still runs', { timeout: 60_000 }, async () => {
    let askedFor: () => void = () => {};
    const asking = new Promise<void>((done) => (askedFor = done));
    // The first call's AI answers all the same once the call is cancelled: what it made must still not be written.
    const calls: AbortSignal[] = [];
    const wait = (signal: AbortSignal) => {
      if (!calls.includes(signal)) calls.push(signal);
      if (signal !== calls[0]) return Promise.resolve();
      askedFor();
      return new Promise<void>((done) => signal.addEventListener('abort', () => done(), { once: true }));
    };
    const gen = oneAtATime(inThreadGenerator(SETUP, { ask: askWith({ wait, answerWhenStopped: true }) }));
    const c = await serve(readAiSettings(GEMINI), gen);
    let id = 0;
    void call(c, 'generate_report', { description: 'An invoice.', output: at('cancel', 'never.repx') }, undefined, (n) => (id = n));
    await asking;
    await c.notify('notifications/cancelled', { requestId: id, reason: 'the person pressed stop' });
    await vi.waitFor(() => expect(gen.busy).toBe(false), { timeout: 20_000 });
    await new Promise((done) => setTimeout(done, 50));
    expect(existsSync(at('cancel', 'never.repx'))).toBe(false);
    expect(partials()).toEqual([]);
    // The turn was given back.
    const after = await call(c, 'generate_report', { description: 'An invoice.', output: at('cancel', 'after.repx') });
    expect(after.isError, JSON.stringify(after).slice(0, 400)).toBeUndefined();
    await c.close();
    await gen.close();
  });
});

describe('revise_report', () => {
  /** A chat stood in: the web app's canned report answer, or `fail`'s error for a config. */
  const chatWith = (o: { fail?: (provider: string | undefined) => Error | null; seen?: string[] } = {}): ChatFn =>
    async (history, config, signal, _partial, report): Promise<ChatOutcome> => {
      o.seen?.push(report?.outline ?? '');
      const failure = o.fail?.(config?.provider);
      if (failure) throw failure;
      if (signal?.aborted) throw stopped();
      return buildMockReportReply([...history].reverse().find((t) => t.role === 'user')?.text ?? '', report?.outline ?? '');
    };

  it('edits by control name in both eras, writing a new file and never changing the one sent', { timeout: 60_000 }, async () => {
    const settings = readAiSettings({ ...GEMINI, FORMA_MCP_MOCK: 'true' });
    const c = await serve(settings, mockGenerator);
    const path = put(at('revise', 'inv.repx'), invoice());
    const result = await call(c, 'revise_report', { path, request: 'Make the title bold' });
    expect(result.isError, JSON.stringify(result).slice(0, 600)).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ action: 'edit', applied: 1, declined: 0, ai: 'mock', loginRemoved: false, written: { path: at('revise', 'inv.revised.repx'), status: 'written' } });
    expect(readFileSync(at('revise', 'inv.revised.repx'), 'utf8')).toMatch(/Name="title"[^>]*Font="Arial, 14pt, style=Bold"/);
    expect(readFileSync(path, 'utf8')).toBe(invoice());
    expect(result.structuredContent.fromFile.applied.length).toBe(1);
    await c.close();

    const m = await serveModern(settings, mockGenerator);
    const modern = (await m.call('revise_report', { path, request: 'Make the title bold', output: at('revise', 'modern.repx') })).result as Record<string, any>;
    expect(modern).toMatchObject({ resultType: 'complete', structuredContent: { action: 'edit', written: { status: 'written' } } });
    await m.close();
  });

  it("answers a question about the report from its facts with no AI, writing nothing", async () => {
    const c = await serve(readAiSettings(GEMINI), inThreadGenerator(SETUP, { chat: chatWith({ fail: () => new Error('the AI must not be asked') }) }));
    const path = put(at('facts', 'inv.repx'), invoice());
    const result = await call(c, 'revise_report', { path, request: 'Which fields does it print?' });
    expect(result.isError, JSON.stringify(result).slice(0, 600)).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ action: 'answer', ai: null, written: null });
    expect(result.structuredContent.fromFile.reply.join(' ')).toContain('Amount');
    expect(readdirSync(at('facts'))).toEqual(['inv.repx']);
    await c.close();
  });

  it('redesigns what edits cannot make, with the report open, and says where the words went on a limit', { timeout: 60_000 }, async () => {
    const seen: { provider?: string; texts: string }[] = [];
    const gen = inThreadGenerator(SETUP, { ask: askWith({ seen }), chat: chatWith({ fail: (provider) => (provider === 'auto' ? limit() : null) }) });
    const c = await serve(readAiSettings(BOTH), gen);
    const path = put(at('rebuild', 'inv.repx'), invoice());
    const result = await call(c, 'revise_report', { path, request: 'Turn it into a quarterly sales summary' });
    expect(result.isError, JSON.stringify(result).slice(0, 600)).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ action: 'rebuild', switched: true, written: { path: at('rebuild', 'inv.revised.repx'), status: 'written' } });
    expect(result.structuredContent.notices).toContain(switchNote('gemini', 'openrouter'));
    // The redesign was asked with this report open.
    expect(seen.length).toBeGreaterThan(0);
    await c.close();
    await gen.close();
  });

  it('says a different report is one for generate_report, and drops what has no equivalent here in plain words', { timeout: 60_000 }, async () => {
    const c = await serve(readAiSettings({ ...GEMINI, FORMA_MCP_MOCK: '1' }), mockGenerator);
    const path = put(at('dropped', 'inv.repx'), invoice());
    const other = await call(c, 'revise_report', { path, request: 'Make a new sales report for the regions' });
    expect(other.structuredContent).toMatchObject({ action: 'new', written: null });
    expect(other.structuredContent.fromFile.brief.join(' ')).toContain('sales report');
    expect(other.content[0].text).toContain('call generate_report');
    const exported = await call(c, 'revise_report', { path, request: 'Export it as PDF' });
    expect(exported.structuredContent).toMatchObject({ action: 'answer', written: null });
    expect(exported.structuredContent.notices.join(' ')).toContain('Exporting it as PDF is not done here: repx_pdf draws a draft PDF');
    expect(readdirSync(at('dropped'))).toEqual(['inv.repx']);
    await c.close();
  });

  it('takes the stored login out before the AI sees the report, and keeps it out of the file written', { timeout: 60_000 }, async () => {
    const outlines: string[] = [];
    const gen = inThreadGenerator(SETUP, { chat: chatWith({ seen: outlines }) });
    const c = await serve(readAiSettings(GEMINI), gen);
    const path = put(at('login', 'inv.repx'), invoice({ login: true }));
    const result = await call(c, 'revise_report', { path, request: 'Make the title bold' });
    expect(result.isError, JSON.stringify(result).slice(0, 600)).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ loginRemoved: true, action: 'edit', ai: 'gemini' });
    expect(outlines.length).toBeGreaterThan(0);
    for (const outline of outlines) expect(outline).not.toMatch(/Secret123|db01/);
    expect(readFileSync(at('login', 'inv.revised.repx'), 'utf8')).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    await c.close();
  });

  it('refuses in plain words when the AI fails, the key out of the words and the log', async () => {
    // The error's own closing stop is not doubled (W8C-3).
    const c = await serve(readAiSettings(GEMINI), inThreadGenerator(SETUP, { chat: chatWith({ fail: () => new Error(`API key not valid: ${geminiKey}.`) }) }));
    const path = put(at('fails', 'inv.repx'), invoice());
    const said = errorText(await call(c, 'revise_report', { path, request: 'Make the title bold' }));
    expect(said).toBe('No change was made: API key not valid: (a key). Nothing was written.');
    expect(c.log.join('\n')).not.toContain(geminiKey);
    expect(readdirSync(at('fails'))).toEqual(['inv.repx']);
    await c.close();

    // A key with no shape of its own, quoted where the 300-character cut of the refusal falls: out before the cut (W8C-1).
    const shapeless = ['gq', '00'].join('') + 'f4aba7fbd7a9'.repeat(3);
    const p = await serve(readAiSettings({ FORMA_GEMINI_KEY: shapeless }), inThreadGenerator(SETUP, { chat: chatWith({ fail: () => new Error(`API key not valid: ${'y'.repeat(270)} ${shapeless} rejected.`) }) }));
    const cut = errorText(await call(p, 'revise_report', { path, request: 'Make the title bold' }));
    expect(cut).not.toContain(shapeless.slice(0, 6));
    expect(cut).toBe(`No change was made: API key not valid: ${'y'.repeat(270)} (a key)... Nothing was written.`);
    expect(p.log.join('\n')).not.toContain(shapeless.slice(0, 6));
    await p.close();
  });
});
