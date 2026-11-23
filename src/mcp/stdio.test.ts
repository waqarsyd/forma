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
 * run time, TST-10) must never appear in what it prints either.
 *
 * The process the host started must be the server itself, with no tsx CLI
 * between them (finding PS-8 of the wave-3 review: the CLI ran a second
 * process and listened on a named pipe): the noise says its process id on
 * stderr, and it must be the spawned one.
 *
 * Each request waits at most 30 seconds and fails with the server's stderr in
 * its message; every process a case starts is ended after it, pass or fail,
 * before the scratch folder it ran in is removed (finding T8). Each case is
 * given a minute for a cold tsx compile.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

const CLONE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** What a host is told to run, after `node`. */
const HOST_ARGS = [join(CLONE, 'src', 'mcp', 'run.mjs')];

const OWNER_WORK = resolve(CLONE, '..', 'forma-model-data-kept-not-in-git', 'forma-model-data', 'work');
const scratch = mkdtempSync(join(existsSync(OWNER_WORK) ? OWNER_WORK : tmpdir(), 'mcp-stdio-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** The keys the entry's noise prints: the same construction as there. */
const fakeKey = ['AI', 'za', 'Sy'].join('') + 'n'.repeat(33);
const fakeNewerKey = ['A', 'Q.'].join('') + 'n'.repeat(40);
const MODERN_META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'smoke', version: '1' } };
const REQUEST_MS = 30_000;

/** A server started for one case. */
interface Started {
  cwd: string;
  child: ChildProcessWithoutNullStreams;
  request(id: number, method: string, params?: Record<string, unknown>): Promise<Record<string, any>>;
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

/** The server started as a host starts it, and a way to talk to it line by line. */
function start(noise: string): Started {
  const cwd = mkdtempSync(join(scratch, 'host-'));
  const env: NodeJS.ProcessEnv = { ...process.env, FORMA_MCP_ROOTS: realpathSync.native(cwd), FORMA_MCP_TEST_NOISE: noise, FORMA_GEMINI_KEY: fakeKey, GEMINI_API_KEY: fakeNewerKey };
  delete env.CLAUDE_PROJECT_DIR;
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
  const request = (id: number, method: string, params?: Record<string, unknown>) =>
    new Promise<Record<string, any>>((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`no answer to ${method} (id ${id}) within ${REQUEST_MS / 1000} s; the server's stderr:\n${err.slice(-2000)}`)), REQUEST_MS);
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

/** Every line the process wrote to stdout, each one a JSON-RPC 2.0 message. */
function expectOnlyJsonRpc(stdout: string) {
  const lines = stdout.split('\n').filter((l) => l !== '');
  for (const line of lines) expect(() => JSON.parse(line), line.slice(0, 120)).not.toThrow();
  for (const line of lines) expect(JSON.parse(line).jsonrpc).toBe('2.0');
  return lines.length;
}

/** No key of either form anywhere it printed, and each printed key on stderr as "(a key)". */
function expectKeysTakenOut(s: Started) {
  expect(s.out() + s.err()).not.toContain(fakeKey);
  expect(s.out() + s.err()).not.toContain(fakeNewerKey);
  expect(s.err()).toContain('FORMA-NOISE key on console.log (a key)');
  expect(s.err()).toContain('FORMA-NOISE key on process.stdout.write (a key)');
  expect(s.err()).toContain("FORMA-NOISE key on the guard's log (a key)");
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
    expect((await s.request(2, 'tools/list')).result.tools.map((t: { name: string }) => t.name)).toEqual(['forma_status']);
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

  it('exits non-zero after an uncaught exception, saying why on stderr and nothing on stdout', { timeout: 60_000 }, async () => {
    const s = start('crash');
    const code = await Promise.race([s.exited, new Promise<'still running'>((done) => setTimeout(() => done('still running'), 30_000).unref())]);
    expect(code).not.toBe(0);
    expect(code).not.toBe('still running');
    expectOnlyJsonRpc(s.out());
    expect(s.err()).toContain('an uncaught exception; the server stops');
  });
});
