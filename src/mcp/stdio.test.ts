/**
 * The MCP server as a host runs it: the exact command the docs give
 * (`node <clone>/src/mcp/run.mjs`), spawned from process.execPath with no
 * shell, from a fresh folder outside the clone, as a host starts it from the
 * user's project (findings PROTO-1 item 3, TST-3). With the entry's test-only
 * noise switched on, something writes to console.log, console.info,
 * console.debug and process.stdout throughout the run, keys of both of AI
 * Studio's forms are printed through them, and a promise is left rejected;
 * every line on stdout must still parse as JSON-RPC, each key must reach
 * stderr only as "(a key)", forma_status must answer in both eras, the
 * process must leave by itself when stdin ends, and nothing may be written
 * into the folder it was started in. A key set in its environment (built at
 * run time, TST-10) must never appear in what it prints either; the one set
 * as FORMA_GEMINI_KEY is in a shape no pattern knows and the noise prints it
 * too, so only the scrub by value, the keys the entry's hardening hands the
 * guard, can take it out (the CLI work's wave-2 review, SEC-W2-1). A case
 * that asks for the mock chooses an AI that cannot leave this computer as
 * well, so a mock that is not read never becomes a request (SEC-W2-7,
 * `NOWHERE_AI`). With the home
 * and the system's temp folder scratch ones, the AI tools write nothing but
 * their reports, OCR's languages in Forma's folder, and tsx's compile cache
 * (`tsx-<user>`) in the temp folder (wave 10's end-to-end probe found the
 * last, which the MCP note had said nothing of).
 *
 * The process the host started must be the server itself, with no tsx CLI
 * between them (finding PS-8 of the wave-3 review: the CLI ran a second
 * process and listened on a named pipe): the noise says its process id on
 * stderr, and it must be the spawned one.
 *
 * The folder a host starts it in may hold a tsconfig.json of the user's own,
 * and tsx, registered with no tsconfig named, applies that one (finding CLI-8
 * of the command line's design audit, 2026-11-24): its `paths` reach every
 * package Forma's sources import, each bare specifier, and its compiler
 * settings reach them when it takes the clone in. So the launcher and both
 * worker threads name the clone's own. One case starts the server from a
 * folder whose tsconfig.json sends zod (which the thread that answers loads
 * on start) and @napi-rs/canvas (which the AI tools' thread loads on start)
 * to a stub that throws, and the AI tools' worker and the thread that
 * answers still load Forma's modules. A control case first shows that folder
 * breaking those two start-up modules, through their package, when tsx is
 * registered as the launchers did before CLI-8, and pipeline.ts, the report
 * tools' thread, loading all the same: since the CLI work's wave 2 it names
 * no package on start, so no `paths` can reach it (the comment on HOSTILE).
 * So no spawned case here proves that worker.mjs ignores the folder's
 * tsconfig.json; the hostile case only shows that thread still answering.
 * Its pin is held statically, by boundaries.test.ts, and matters there only
 * for compiler settings, none of which breaks a module on that thread's way
 * today (CLI-8 found the risk latent).
 *
 * Each request waits at most 30 seconds and fails with the server's stderr in
 * its message; every process a case starts is ended after it, pass or fail,
 * before the scratch folder it ran in is removed (finding T8). Each case is
 * given a minute for a cold tsx compile.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { formaUserFolder } from './nodeGeneration';
import { TOOL_LIST } from './toolList';

const CLONE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** What a host is told to run, after `node`. */
const HOST_ARGS = [join(CLONE, 'src', 'mcp', 'run.mjs')];

const OWNER_WORK = resolve(CLONE, '..', 'forma-model-data-kept-not-in-git', 'forma-model-data', 'work');
const scratch = mkdtempSync(join(existsSync(OWNER_WORK) ? OWNER_WORK : tmpdir(), 'mcp-stdio-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** The keys the entry's noise prints: the same construction as there. */
const fakeKey = ['AI', 'za', 'Sy'].join('') + 'n'.repeat(33);
const fakeNewerKey = ['A', 'Q.'].join('') + 'n'.repeat(40);
/**
 * The key every case sets as FORMA_GEMINI_KEY, in a shape no pattern knows
 * (lib/keyRedact.ts `FORMA_KEYS`), which the noise prints too: only the
 * scrub by value takes it out, so a case shows the entry handing the guard
 * the keys `takeAiEnv` took, which the patterns alone would never show (the
 * CLI work's wave-2 review, SEC-W2-1).
 */
const shapelessKey = ['gq', '00'].join('') + 'f4aba7fbd7a9'.repeat(3);
/**
 * The AI a case that asks for the mock chooses as well: Local AI at a port
 * fetch refuses to open (port 1, one of the Fetch standard's bad ports), so
 * a mock that is not read fails on this computer and is never a request to
 * an AI (the wave-2 review's SEC-W2-7: the mock is read in the entry's voice
 * since that wave, and an entry that read it in the wrong one sent this
 * test's stand-in key to Google once). Local AI is never left for another AI
 * on a limit (lib/fallbackChain.ts `fallbacksFor`).
 */
const NOWHERE_AI = { FORMA_PROVIDER: 'local', FORMA_LOCAL_MODEL: 'forma-test-model', FORMA_LOCAL_URL: 'http://127.0.0.1:1/v1' };
const MODERN_META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'smoke', version: '1' } };
const REQUEST_MS = 30_000;

/**
 * A user's project files that would break Forma if tsx applied their
 * tsconfig.json (CLI-8): its `paths` sends a package each thread loads on
 * start to a stub that throws, zod (toolShape.ts, the thread that answers)
 * and @napi-rs/canvas (nodeGeneration.ts, the AI tools' thread). tsx applies
 * `paths` to a bare specifier from every importer outside node_modules,
 * whatever the tsconfig's `include` says (read in tsx 4.23.15), so it
 * reaches the clone from any folder; compiler settings would reach it only
 * from a project whose tsconfig takes the clone in.
 *
 * Until the CLI and Forma Designer work's wave 2 (2026-11-24) zod alone did
 * it, since every thread reached zod through toolShape.ts, where ToolRefusal
 * lived; that wave moved ToolRefusal to caller.ts so nothing on the command
 * line's way loads zod, and the report tools' thread (pipeline.ts) now names
 * no package on start at all (measured that day by importing each start-up
 * module under tsx registered with no tsconfig, from a folder whose `paths`
 * also sent node:fs and node:path to the stub, which tsx leaves alone), so
 * no `paths` can reach it, and the control below says so; its launcher's
 * pin stays for the compiler settings, which boundaries.test.ts holds.
 */
const STUB_SAYS = 'FORMA-HOSTILE-TSCONFIG';
const HOSTILE: Record<string, string> = {
  'tsconfig.json': `${JSON.stringify({ compilerOptions: { paths: { zod: ['./stub.mjs'], '@napi-rs/canvas': ['./stub.mjs'] } } }, null, 2)}\n`,
  'stub.mjs': `throw new Error('${STUB_SAYS}: a package was resolved through the tsconfig.json of the working folder');\n`,
};
/** Each start-up module the stub reaches, and the package through which: a namespace import fails on the stub's throw, a named one on its missing export, which names the package. */
const REDIRECTED: [string, string][] = [
  ['formaServer.ts', 'zod'],
  ['genJobs.ts', '@napi-rs/canvas'],
];

/** A server started for one case. */
interface Started {
  cwd: string;
  child: ChildProcessWithoutNullStreams;
  request(id: number, method: string, params?: Record<string, unknown>, waitMs?: number): Promise<Record<string, any>>;
  notify(method: string): void;
  exited: Promise<number | null>;
  out(): string;
  err(): string;
}

const started: Started[] = [];
afterEach(async () => {
  for (const s of started.splice(0)) {
    if (s.child.exitCode !== null || s.child.signalCode !== null) continue;
    s.child.stdin.end();
    s.child.kill();
    await Promise.race([s.exited, new Promise((done) => setTimeout(done, 5000).unref())]);
  }
});

/**
 * The server started as a host starts it, and a way to talk to it line by
 * line. `more` adds to its environment, a value left undefined taking that
 * variable out; with FORMA_MCP_MOCK in it, `NOWHERE_AI` is chosen too.
 * `files` are written into the folder it starts in, first.
 */
function start(noise: string, more: Record<string, string | undefined> = {}, files: Record<string, string> = {}): Started {
  const cwd = mkdtempSync(join(scratch, 'host-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(cwd, name), content);
  const env: NodeJS.ProcessEnv = { ...process.env, FORMA_MCP_ROOTS: realpathSync.native(cwd), FORMA_MCP_TEST_NOISE: noise, FORMA_GEMINI_KEY: shapelessKey, GEMINI_API_KEY: fakeNewerKey };
  delete env.CLAUDE_PROJECT_DIR;
  for (const name of Object.keys(env)) if (name.startsWith('FORMA_') && !['FORMA_MCP_ROOTS', 'FORMA_MCP_TEST_NOISE', 'FORMA_GEMINI_KEY'].includes(name)) delete env[name];
  if (more.FORMA_MCP_MOCK !== undefined) Object.assign(env, NOWHERE_AI);
  for (const [name, value] of Object.entries(more)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, HOST_ARGS, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  const pending = new Map<number, (m: Record<string, any>) => void>();
  child.stdout.on('data', (d) => {
    out += d;
    for (const line of out.split('\n').slice(0, -1)) {
      try {
        const m = JSON.parse(line);
        if (m.id !== undefined) pending.get(m.id)?.(m);
      } catch {
        /* judged at the end */
      }
    }
  });
  child.stderr.on('data', (d) => {
    err += d;
  });
  const exited = new Promise<number | null>((done) => child.on('exit', (code) => done(code)));
  const request = (id: number, method: string, params?: Record<string, unknown>, waitMs = REQUEST_MS) =>
    new Promise<Record<string, any>>((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`no answer to ${method} (id ${id}) within ${waitMs / 1000} s; the server's stderr:\n${err.slice(-2000)}`)), waitMs);
      pending.set(id, (m) => {
        clearTimeout(timer);
        done(m);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`);
    });
  const notify = (method: string) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  const s: Started = { cwd, child, request, notify, exited, out: () => out, err: () => err };
  started.push(s);
  return s;
}

/** Every file under a folder, as a path relative to it. */
function filesUnder(dir: string, under = ''): string[] {
  return readdirSync(join(dir, under)).flatMap((name) => (statSync(join(dir, under, name)).isDirectory() ? filesUnder(dir, join(under, name)) : [join(under, name)]));
}

/** Every line the process wrote to stdout, each one a JSON-RPC 2.0 message. */
function expectOnlyJsonRpc(stdout: string) {
  const lines = stdout.split('\n').filter((l) => l !== '');
  for (const line of lines) expect(() => JSON.parse(line), line.slice(0, 120)).not.toThrow();
  for (const line of lines) expect(JSON.parse(line).jsonrpc).toBe('2.0');
  return lines.length;
}

/** No key of any form anywhere it printed, and each printed key on stderr as "(a key)", the shapeless one by its value alone. */
function expectKeysTakenOut(s: Started) {
  for (const key of [fakeKey, fakeNewerKey, shapelessKey]) expect(s.out() + s.err()).not.toContain(key.slice(0, 12));
  expect(s.err()).toContain('FORMA-NOISE key on console.log (a key)');
  expect(s.err()).toContain('FORMA-NOISE key on process.stdout.write (a key)');
  expect(s.err()).toContain("FORMA-NOISE key on the guard's log (a key)");
  expect(s.err()).toContain('FORMA-NOISE shapeless key on console.log (a key)');
  expect(s.err()).toContain("FORMA-NOISE shapeless key on the guard's log (a key)");
}

/** Ends stdin and waits for the process to leave by itself, within ten seconds. */
async function leaves(s: Started) {
  s.child.stdin.end();
  const timer = new Promise<'still running'>((done) => setTimeout(() => done('still running'), 10_000).unref());
  return Promise.race([s.exited, timer]);
}

describe('the stdio server, started as a host starts it', () => {
  it('answers a 2025-era client with only JSON-RPC on stdout while other code writes there, and leaves when stdin ends', { timeout: 60_000 }, async () => {
    const s = start('1');
    const init = await s.request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
    expect(init.result.serverInfo.name).toBe('forma');
    s.notify('notifications/initialized');
    expect((await s.request(2, 'tools/list')).result.tools.map((t: { name: string }) => t.name)).toEqual(TOOL_LIST.map((t) => t.name));
    const status = await s.request(3, 'tools/call', { name: 'forma_status', arguments: {} });
    expect(status.result.structuredContent).toMatchObject({ protocol: { era: 'legacy', version: '2025-11-25' }, folders: { source: 'FORMA_MCP_ROOTS', paths: [realpathSync.native(s.cwd)] } });
    expect(await leaves(s)).toBe(0);
    expect(expectOnlyJsonRpc(s.out())).toBe(3);
    expect(s.err()).toContain('FORMA-NOISE console.log');
    expect(s.err()).toContain('FORMA-NOISE console.debug');
    expect(s.err()).toContain('FORMA-NOISE process.stdout.write');
    expect(s.err()).toContain('an unhandled rejection; the server goes on');
    expect(s.err()).toContain(`FORMA-NOISE pid ${s.child.pid}\n`);
    expectKeysTakenOut(s);
    expect(readdirSync(s.cwd)).toEqual([]);
  });

  it('answers a 2026-07-28 client the same way', { timeout: 60_000 }, async () => {
    const s = start('1');
    const discover = await s.request(1, 'server/discover', { _meta: MODERN_META });
    expect(discover.result.supportedVersions).toContain('2026-07-28');
    const status = await s.request(2, 'tools/call', { name: 'forma_status', arguments: {}, _meta: MODERN_META });
    expect(status.result).toMatchObject({ resultType: 'complete', structuredContent: { protocol: { era: 'modern', version: '2026-07-28' }, folders: { source: 'FORMA_MCP_ROOTS' } } });
    expect(await leaves(s)).toBe(0);
    expect(expectOnlyJsonRpc(s.out())).toBe(2);
    expect(s.err()).toContain('FORMA-NOISE console.info');
    expect(s.err()).toContain(`FORMA-NOISE pid ${s.child.pid}\n`);
    expectKeysTakenOut(s);
    expect(readdirSync(s.cwd)).toEqual([]);
  });

  it("runs the report tools' work in its worker thread: only JSON-RPC on stdout, and a stored login on neither stream nor in any file written", { timeout: 90_000 }, async () => {
    // The wave-4 review's REV4-3 and REV4-4: the worker registers tsx itself, its own output reaches stderr only, and the login is gone first.
    const s = start('');
    const login = '<Connection Name="Sales"><Parameters><Parameter Name="server" Value="db01" /><Parameter Name="userid" Value="sa" /><Parameter Name="password" Value="Secret123" /></Parameters></Connection>';
    const stored = Buffer.from(`<SqlDataSource Name="dsCode">${login}<Query Type="SelectQuery" Name="Orders"><Tables><Table Name="Orders" /></Tables><Columns><AllColumns /></Columns></Query></SqlDataSource>`).toString('base64');
    // As DevExpress 20.1 writes a source assigned in code: in ObjectStorage, not ComponentStorage (REV4-1).
    const report = `<?xml version="1.0" encoding="utf-8"?>\n<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="R" PageWidth="850" PageHeight="1100" Version="20.1" DataMember="Orders" DataSource="#Ref-0"><Bands><Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="20"><Controls><Item1 Ref="3" ControlType="XRLabel" Name="title" Text="Orders" SizeF="200,20" /></Controls></Item1></Bands><ObjectStorage><Item1 Ref="0" ObjectType="DevExpress.DataAccess.Sql.SqlDataSource,DevExpress.DataAccess.v20.1" Name="dsCode" Base64="${stored}" /></ObjectStorage></XtraReportsLayoutSerializer>\n`;
    const path = join(realpathSync.native(s.cwd), 'r.repx');
    writeFileSync(path, report);
    await s.request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
    s.notify('notifications/initialized');
    const answers = [
      await s.request(2, 'tools/call', { name: 'repx_audit', arguments: { path } }),
      await s.request(3, 'tools/call', { name: 'repx_repair', arguments: { path } }),
      await s.request(4, 'tools/call', { name: 'repx_edit', arguments: { path, edits: [{ op: 'text', control: 'title', text: 'Sales' }] } }),
    ];
    for (const answer of answers) expect(answer.result.structuredContent?.loginRemoved, JSON.stringify(answer).slice(0, 300)).toBe(true);
    expect(await leaves(s)).toBe(0);
    expect(expectOnlyJsonRpc(s.out())).toBe(4);
    const decoded = (text: string) => [text, ...[...text.matchAll(/Base64="([^"]*)"/g)].map((m) => Buffer.from(m[1], 'base64').toString('utf8'))].join('\n');
    expect(s.out() + s.err()).not.toMatch(/Secret123|userid|db01/);
    expect(readdirSync(s.cwd).sort()).toEqual(['r.edited.repx', 'r.repaired.repx', 'r.repx']);
    for (const f of ['r.edited.repx', 'r.repaired.repx']) expect(decoded(readFileSync(join(s.cwd, f), 'utf8')), f).not.toMatch(/Secret123|userid|db01/);
  });

  it("runs the AI tools in their own worker thread, the AI mocked: only JSON-RPC on stdout, rising progress, no key's value on either stream, and the reports written", { timeout: 240_000 }, async () => {
    // Wave 8 (2026-11-24): FORMA_MCP_MOCK, with a stand-in key (an AI must still be set up, OD6), and Forma's own folder in a scratch home.
    // Wave 10: the system's temp folder a scratch one too, so what the server writes outside the folders in effect is all seen.
    const home = mkdtempSync(join(scratch, 'home-'));
    const temp = mkdtempSync(join(scratch, 'temp-'));
    const s = start('', { FORMA_MCP_MOCK: '1', USERPROFILE: home, HOME: home, TEMP: temp, TMP: temp, TMPDIR: temp });
    await s.request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
    s.notify('notifications/initialized');
    const cwd = realpathSync.native(s.cwd);
    const made = await s.request(2, 'tools/call', { name: 'generate_report', arguments: { description: 'An invoice with a title and a table of items.', output: join(cwd, 'invoice.repx') }, _meta: { progressToken: 'smoke' } }, 180_000);
    expect(made.result.isError, JSON.stringify(made).slice(0, 600)).toBeUndefined();
    expect(made.result.structuredContent).toMatchObject({ ai: 'mock', written: { path: join(cwd, 'invoice.repx'), status: 'written' } });
    const revised = await s.request(3, 'tools/call', { name: 'revise_report', arguments: { path: join(cwd, 'invoice.repx'), request: 'Make it red' } }, 120_000);
    expect(revised.result.isError, JSON.stringify(revised).slice(0, 600)).toBeUndefined();
    expect(revised.result.structuredContent).toMatchObject({ action: 'edit', ai: 'mock', written: { path: join(cwd, 'invoice.revised.repx') } });
    expect(await leaves(s)).toBe(0);
    const lines = expectOnlyJsonRpc(s.out());
    const progress = s.out().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.method === 'notifications/progress');
    expect(lines).toBe(3 + progress.length);
    expect(progress.length).toBeGreaterThan(0);
    const values = progress.map((m) => m.params.progress as number);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    for (const key of [fakeKey, fakeNewerKey, shapelessKey]) expect(s.out() + s.err()).not.toContain(key.slice(0, 12));
    expect(s.err()).toContain(`generate_report wrote ${JSON.stringify(join(cwd, 'invoice.repx'))}`);
    expect(readdirSync(s.cwd).sort()).toEqual(['invoice.repx', 'invoice.revised.repx']);
    // Forma's folder is the scratch home's, never the user's own, and holds OCR's gathered languages alone (no model was probed, the AI mocked).
    const forma = relative(home, formaUserFolder(home));
    const inHome = filesUnder(home);
    expect(inHome.length).toBeGreaterThan(0);
    for (const file of inHome) expect(file.startsWith(join(forma, 'tessdata') + sep), file).toBe(true);
    // In the temp folder only tsx's compile cache, the clone's own modules transformed (the end-to-end probe of wave 10 found it).
    expect(readdirSync(temp).length).toBeGreaterThan(0);
    for (const name of readdirSync(temp)) expect(name, name).toMatch(/^tsx-/);
  });

  it('refuses the AI tools in plain words with no AI set up, and still serves the rest', { timeout: 60_000 }, async () => {
    const s = start('', { FORMA_GEMINI_KEY: undefined });
    await s.request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
    s.notify('notifications/initialized');
    const refused = await s.request(2, 'tools/call', { name: 'generate_report', arguments: { description: 'An invoice', output: join(realpathSync.native(s.cwd), 'x.repx') } });
    expect(refused.result.isError).toBe(true);
    expect(refused.result.content[0].text).toMatch(/^Set up your AI in Settings to start: .*FORMA_GEMINI_KEY/);
    expect((await s.request(3, 'tools/call', { name: 'forma_status', arguments: {} })).result.isError).toBeUndefined();
    expect(await leaves(s)).toBe(0);
    expect(s.err()).toContain('the AI tools refuse until an AI is set up');
    expect(s.out() + s.err()).not.toContain(fakeNewerKey);
    expect(readdirSync(s.cwd)).toEqual([]);
  });

  it("the control: from a folder whose tsconfig.json sends their packages to a stub, tsx registered with no tsconfig named breaks the start-up modules of the threads that load one", { timeout: 60_000 }, async () => {
    // As run.mjs, worker.mjs and genWorker.mjs registered it before CLI-8: the modules each thread loads on start fail on the stub,
    // so the case below cannot pass by the folder's tsconfig.json being ignored for some other reason. pipeline.ts, the report
    // tools' thread, names no package on start since the CLI work's wave 2 (the comment on HOSTILE), so it loads either way.
    const cwd = mkdtempSync(join(scratch, 'control-'));
    for (const [name, content] of Object.entries(HOSTILE)) writeFileSync(join(cwd, name), content);
    const tsxPackage = join(CLONE, 'node_modules', 'tsx');
    const tsxApi = pathToFileURL(join(tsxPackage, JSON.parse(readFileSync(join(tsxPackage, 'package.json'), 'utf8')).exports['./esm/api'].import.default)).href;
    const modules = [...REDIRECTED.map(([m]) => m), 'pipeline.ts'];
    const unpinned = [
      `import { register } from ${JSON.stringify(tsxApi)};`,
      'register();',
      `for (const [name, url] of ${JSON.stringify(modules.map((m) => [m, pathToFileURL(join(CLONE, 'src', 'mcp', m)).href]))}) {`,
      "  try { await import(url); console.log(name + ' loaded'); } catch (error) { console.log(name + ' failed: ' + error.message); }",
      '}',
      '',
    ].join('\n');
    writeFileSync(join(cwd, 'unpinned.mjs'), unpinned);
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.TSX_TSCONFIG_PATH;
    const child = spawn(process.execPath, [join(cwd, 'unpinned.mjs')], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const exited = new Promise<number | null>((done) => child.on('exit', done));
    // Bounded, and ended pass or fail before the scratch folder it runs in is removed (T8; the wave-1 review's LAUNCH-1).
    try {
      const code = await Promise.race([exited, new Promise<'still running'>((done) => setTimeout(() => done('still running'), REQUEST_MS).unref())]);
      expect(code, err.slice(-1000)).toBe(0);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await Promise.race([exited, new Promise((done) => setTimeout(done, 5000).unref())]);
      }
    }
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    for (const [m, pkg] of REDIRECTED) expect(out, `${out}\n${err.slice(-1000)}`).toMatch(new RegExp(`${escape(m)} failed: (?:${STUB_SAYS}|.*'${escape(pkg)}')`));
    expect(out, `${out}\n${err.slice(-1000)}`).toContain('pipeline.ts loaded');
  });

  it("ignores the tsconfig.json of the folder it is started in: the thread that answers and the AI tools' worker load Forma's modules, and the report tools' worker, which no `paths` can reach, still answers", { timeout: 120_000 }, async () => {
    // CLI-8: each launcher names the clone's tsconfig.json. The AI mocked and Forma's folder in a scratch home, as in the AI tools' case.
    const home = mkdtempSync(join(scratch, 'home-'));
    const s = start('', { FORMA_MCP_MOCK: '1', USERPROFILE: home, HOME: home, TSX_TSCONFIG_PATH: undefined }, HOSTILE);
    const cwd = realpathSync.native(s.cwd);
    const path = join(cwd, 'r.repx');
    writeFileSync(path, `<?xml version="1.0" encoding="utf-8"?>\n<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="R" PageWidth="850" PageHeight="1100" Version="20.1"><Bands><Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="20"><Controls><Item1 Ref="3" ControlType="XRLabel" Name="title" Text="Orders" SizeF="200,20" /></Controls></Item1></Bands></XtraReportsLayoutSerializer>\n`);
    const init = await s.request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
    expect(init.result?.serverInfo?.name).toBe('forma');
    s.notify('notifications/initialized');
    const status = await s.request(2, 'tools/call', { name: 'forma_status', arguments: {} });
    expect(status.result.isError, JSON.stringify(status).slice(0, 400)).toBeUndefined();
    const audit = await s.request(3, 'tools/call', { name: 'repx_audit', arguments: { path } });
    expect(audit.result.isError, `${JSON.stringify(audit).slice(0, 400)}\n${s.err().slice(-1000)}`).toBeUndefined();
    const revised = await s.request(4, 'tools/call', { name: 'revise_report', arguments: { path, request: 'Make the title red' } }, 90_000);
    expect(revised.result.isError, `${JSON.stringify(revised).slice(0, 400)}\n${s.err().slice(-1000)}`).toBeUndefined();
    expect(revised.result.structuredContent).toMatchObject({ action: 'edit', ai: 'mock', written: { path: join(cwd, 'r.revised.repx') } });
    expect(await leaves(s)).toBe(0);
    expect(expectOnlyJsonRpc(s.out())).toBe(4);
    expect(s.err()).not.toContain(STUB_SAYS);
    expect(readdirSync(s.cwd).sort()).toEqual(['r.repx', 'r.revised.repx', 'stub.mjs', 'tsconfig.json']);
  });

  it('exits non-zero after an uncaught exception, saying why on stderr and nothing on stdout', { timeout: 60_000 }, async () => {
    const s = start('crash');
    const code = await Promise.race([s.exited, new Promise<'still running'>((done) => setTimeout(() => done('still running'), 30_000).unref())]);
    expect(code).not.toBe(0);
    expect(code).not.toBe('still running');
    expectOnlyJsonRpc(s.out());
    expect(s.err()).toContain('an uncaught exception; the server stops');
  });
});
