/**
 * Forma's MCP server in process, through the same `serveStdio` entry the
 * stdio process uses, over the SDK's own InMemoryTransport (finding TST-2:
 * no client package needed), with raw JSON-RPC in both eras: a 2025-era
 * client opening with initialize, and a 2026-07-28 client opening with
 * server/discover and carrying its envelope on every request. The roots are
 * asked for as GAP3-2 says, and only so: on a 2025-era connection only when
 * initialize declared them, with a timeout, one request for calls made in
 * parallel, kept for the connection until the list changes; on a 2026-07-28
 * request only when its envelope declares them, as an input_required result,
 * never twice. The era is the connection's: a 2025-era request carrying the
 * 2026-07-28 envelope stays 2025-era (PS-1 and PS-10 of the wave-3 review).
 */
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORMA_INSTRUCTIONS, NO_AI_TOOLS, createFormaServer, formaVersion, nodeSystem, type FormaServerOptions } from './formaServer';
import { NO_AI } from './reportTools';
import { noRootMessage, readEnvRoots, type EnvRoots } from './roots';
import { SKILL_PREFACE, SKILL_URI, loadRepxSkill, skillText } from './skillResource';
import { connectInMemory, inThread, textJson } from './testClient';
import { fakeFs } from './testFs';
import { TOOL_LIST } from './toolList';
import { MAX_DESCRIPTION } from './toolShape';

const system = { path: posix, home: '/home/me', fs: fakeFs(posix, { dirs: ['/srv/env', '/srv/client', '/srv/claude'], links: { '/srv/linked': '/srv/env' } }) };
const MODERN = '2026-07-28';
const LEGACY = '2025-11-25';

/** The REPX skill's catalog, built once as the stdio entry builds it; strict, so a problem with the skill fails here. */
const skills = await loadRepxSkill(() => {}, { strict: true });

/** One connection to a fresh server, through the shared in-memory client (testClient.ts). */
async function connect(env: { FORMA_MCP_ROOTS?: string; CLAUDE_PROJECT_DIR?: string } = {}, more: Partial<FormaServerOptions> = {}) {
  const logged: string[] = [];
  const envRoots: EnvRoots = readEnvRoots(env, system);
  const c = await connectInMemory(() => createFormaServer({ envRoots, system, version: formaVersion(), skills, pipeline: inThread, log: (line) => logged.push(line), rootsTimeoutMs: 150, ...more }));
  return { ...c, logged };
}

const meta = (capabilities: Record<string, unknown> = {}) => ({
  'io.modelcontextprotocol/protocolVersion': MODERN,
  'io.modelcontextprotocol/clientCapabilities': capabilities,
  'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
});

async function legacy(env = {}, capabilities: Record<string, unknown> = {}, more: Partial<FormaServerOptions> = {}) {
  const c = await connect(env, more);
  const init = await c.request('initialize', { protocolVersion: LEGACY, capabilities, clientInfo: { name: 'test', version: '1' } });
  await c.notify('notifications/initialized');
  return { ...c, init, status: () => c.request('tools/call', { name: 'forma_status', arguments: {} }) };
}

async function modern(env = {}, capabilities: Record<string, unknown> = {}) {
  const c = await connect(env);
  const discover = await c.request('server/discover', { _meta: meta(capabilities) });
  return { ...c, discover, status: (extra: Record<string, unknown> = {}) => c.request('tools/call', { name: 'forma_status', arguments: {}, _meta: meta(capabilities), ...extra }) };
}

describe('a 2025-era client', () => {
  it('is answered with Forma at its version, the instructions, and a tool list that never changes', async () => {
    const c = await legacy();
    expect(c.init.result).toMatchObject({ protocolVersion: LEGACY, serverInfo: { name: 'forma', version: formaVersion() }, instructions: FORMA_INSTRUCTIONS, capabilities: { tools: { listChanged: false } } });
    await c.close();
  });

  it('gets forma_status as data twice over: structuredContent, and the same JSON in the text under a summary', async () => {
    const c = await legacy({ FORMA_MCP_ROOTS: '/srv/env' });
    const { result } = await c.status();
    expect(result?.isError).toBeUndefined();
    expect(result?.structuredContent).toEqual({
      name: 'forma',
      version: formaVersion(),
      protocol: { era: 'legacy', version: LEGACY },
      folders: { source: 'FORMA_MCP_ROOTS', paths: ['/srv/env'], notes: [] },
    });
    expect(result?.content[0].text).toMatch(new RegExp(`^Forma ${formaVersion().replace(/\./g, '\\.')}, over MCP ${LEGACY}, a 2025-era connection\\. Its tools may use one folder, from FORMA_MCP_ROOTS\\.`));
    expect(textJson(result as Record<string, any>)).toEqual(result?.structuredContent);
    await c.close();
  });

  it('lists a folder reached through a link as it was spelled, with a note naming where it really is', async () => {
    const c = await legacy({ FORMA_MCP_ROOTS: '/srv/linked' });
    expect((await c.status()).result?.structuredContent?.folders).toEqual({
      source: 'FORMA_MCP_ROOTS',
      paths: ['/srv/linked'],
      notes: ['"/srv/linked" is "/srv/env" once links are followed; a path under either is used.'],
    });
    await c.close();
  });

  it("asks a client that declared roots once, keeps the answer for the connection, and asks again when the list changes", async () => {
    const c = await legacy({ CLAUDE_PROJECT_DIR: '/srv/claude' }, { roots: { listChanged: true } });
    c.answerWith((r) => (r.method === 'roots/list' ? { result: { roots: [{ uri: 'file:///srv/client', name: 'client' }] } } : undefined));
    expect((await c.status()).result?.structuredContent?.folders).toEqual({ source: 'client', paths: ['/srv/client'], notes: [] });
    await c.status();
    expect(c.asked).toEqual([{ method: 'roots/list' }]);
    await c.notify('notifications/roots/list_changed');
    await c.status();
    expect(c.asked).toEqual([{ method: 'roots/list' }, { method: 'roots/list' }]);
    await c.close();
  });

  it('never asks a client that did not declare roots, and falls to CLAUDE_PROJECT_DIR', async () => {
    const c = await legacy({ CLAUDE_PROJECT_DIR: '/srv/claude' });
    expect((await c.status()).result?.structuredContent?.folders).toEqual({ source: 'CLAUDE_PROJECT_DIR', paths: ['/srv/claude'], notes: [] });
    expect(c.asked).toEqual([]);
    await c.close();
  });

  it('goes on past a client that declared roots and answers -32601, or never answers, within the timeout', async () => {
    const refusing = await legacy({ CLAUDE_PROJECT_DIR: '/srv/claude' }, { roots: {} });
    refusing.answerWith(() => ({ error: { code: -32601, message: 'Method not found' } }));
    const folders = (await refusing.status()).result?.structuredContent?.folders;
    expect(folders).toMatchObject({ source: 'CLAUDE_PROJECT_DIR', paths: ['/srv/claude'] });
    expect(folders.notes[0]).toMatch(/^The client declared roots but did not list them \(.*Method not found/);
    await refusing.close();

    const silent = await legacy({}, { roots: {} });
    const started = Date.now();
    const { result } = await silent.status();
    expect(Date.now() - started).toBeLessThan(3000);
    expect(result?.structuredContent?.folders).toMatchObject({ source: null, paths: [], why: noRootMessage(system) });
    await silent.close();
  });

  it('sends one roots/list for calls made in parallel, and answers them all within the timeout', async () => {
    const c = await legacy({}, { roots: {} });
    const started = Date.now();
    const answers = await Promise.all([c.status(), c.status(), c.status()]);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(c.asked).toEqual([{ method: 'roots/list' }]);
    for (const { result } of answers) expect(result?.structuredContent?.folders).toMatchObject({ source: null, why: noRootMessage(system) });
    await c.close();
  });

  it('stays a 2025-era connection when a request carries the 2026-07-28 envelope: never asked by input_required, reported as 2025-era', async () => {
    // Finding PS-1 of the wave-3 review: the era is the connection's, never the request's.
    const undeclared = await legacy({ CLAUDE_PROJECT_DIR: '/srv/claude' });
    const call = (c: typeof undeclared) => c.request('tools/call', { name: 'forma_status', arguments: {}, _meta: meta({ roots: {} }) });
    const plain = await call(undeclared);
    expect(plain.result?.isError).toBeUndefined();
    expect(plain.result?.resultType).not.toBe('input_required');
    expect(plain.result?.structuredContent).toMatchObject({ protocol: { era: 'legacy', version: LEGACY }, folders: { source: 'CLAUDE_PROJECT_DIR', paths: ['/srv/claude'] } });
    expect(undeclared.asked).toEqual([]);
    await undeclared.close();

    const declared = await legacy({}, { roots: {} });
    const started = Date.now();
    const silent = await call(declared);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(silent.result?.resultType).not.toBe('input_required');
    expect(silent.result?.structuredContent).toMatchObject({ protocol: { era: 'legacy', version: LEGACY }, folders: { source: null, why: noRootMessage(system) } });
    expect(declared.asked).toEqual([{ method: 'roots/list' }]);
    await declared.close();
  });

  it('takes FORMA_MCP_ROOTS alone while it is set: a mistake in it refuses, and the client is not asked', async () => {
    const c = await legacy({ FORMA_MCP_ROOTS: 'srv/env' }, { roots: {} });
    const folders = (await c.status()).result?.structuredContent?.folders;
    expect(folders.source).toBeNull();
    expect(folders.why).toMatch(/^FORMA_MCP_ROOTS entry: "srv\/env" is not a full path.*while it is set, it is the only source of folders\.$/);
    expect(c.asked).toEqual([]);
    await c.close();
  });
});

describe('a 2026-07-28 client', () => {
  it('discovers the modern revision, the same instructions and the same tool list', async () => {
    const c = await modern();
    expect(c.discover.result?.supportedVersions).toContain(MODERN);
    expect(c.discover.result?.instructions).toBe(FORMA_INSTRUCTIONS);
    const l = await legacy();
    const modernTools = (await c.request('tools/list', { _meta: meta() })).result?.tools;
    const legacyTools = (await l.request('tools/list')).result?.tools;
    expect(modernTools).toEqual(legacyTools);
    await c.close();
    await l.close();
  });

  it('gets forma_status with its own era and revision, and no question when it declared no roots', async () => {
    const c = await modern({ CLAUDE_PROJECT_DIR: '/srv/claude' });
    const { result, error } = await c.status();
    expect(error).toBeUndefined();
    expect(result?.resultType).toBe('complete');
    expect(result?.structuredContent).toMatchObject({ protocol: { era: 'modern', version: MODERN }, folders: { source: 'CLAUDE_PROJECT_DIR', paths: ['/srv/claude'] } });
    await c.close();
  });

  it('is asked for its roots as an input_required result when it declared them, and its retry is answered with them', async () => {
    const c = await modern({}, { roots: {} });
    const first = await c.status();
    expect(first.result).toMatchObject({ resultType: 'input_required', inputRequests: { roots: { method: 'roots/list' } } });
    const retry = await c.status({ inputResponses: { roots: { roots: [{ uri: 'file:///srv/client' }] } } });
    expect(retry.result?.structuredContent?.folders).toEqual({ source: 'client', paths: ['/srv/client'], notes: [] });
    expect(c.asked).toEqual([]);
    await c.close();
  });

  it('is never asked twice: a retry without the list falls through to the recipe', async () => {
    const c = await modern({}, { roots: {} });
    const retry = await c.status({ inputResponses: { other: { action: 'cancel' } } });
    expect(retry.result?.resultType).toBe('complete');
    expect(retry.result?.structuredContent?.folders).toEqual({ source: null, paths: [], why: noRootMessage(system), notes: ['The client was asked for its roots and did not list them.'] });
    await c.close();
  });
});

describe('the tool list', () => {
  it("lists toolList.ts's tools in its order, each read-only as the list says, and saying it needs no AI where the list says so", async () => {
    // Finding DOC-5: the list the docs will be held to is the list the server registers from.
    const c = await legacy();
    const tools = (await c.request('tools/list')).result?.tools as Record<string, any>[];
    expect(tools.map((t) => t.name)).toEqual(TOOL_LIST.map((t) => t.name));
    for (const [i, entry] of TOOL_LIST.entries()) {
      expect(tools[i].annotations.readOnlyHint, entry.name).toBe(entry.readOnly);
      expect(tools[i].description.includes('calls no AI'), entry.name).toBe(!entry.needsAi);
      if (entry.name !== 'forma_status') expect(tools[i].description.includes(NO_AI), entry.name).toBe(!entry.needsAi);
    }
    // The instructions every host's model reads say no tool calls an AI exactly while none does (R11 of the wave-4 review).
    expect(FORMA_INSTRUCTIONS.includes(NO_AI_TOOLS)).toBe(TOOL_LIST.every((t) => !t.needsAi));
    expect(FORMA_INSTRUCTIONS).not.toMatch(/\bmakes? (DevExpress )?reports\b/);
    await c.close();
  });

  it('serves the REPX skill as a resource, with the preface that tells a model to send full paths, the file itself unchanged', async () => {
    // Findings PROTO-11 and GAP2-5.
    const c = await legacy();
    const listed = (await c.request('resources/list')).result?.resources as Record<string, any>[];
    expect(listed).toEqual([expect.objectContaining({ uri: SKILL_URI, name: 'devexpress-repx', mimeType: 'text/markdown' })]);
    const contents = (await c.request('resources/read', { uri: SKILL_URI })).result?.contents as Record<string, any>[];
    const served: string = contents[0].text;
    const file = skillText();
    const front = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(file)![0];
    expect(served).toBe(`${front}\n${SKILL_PREFACE}\n${file.slice(front.length)}`);
    expect(SKILL_PREFACE).toMatch(/^[\x20-\x7e\n]+$/);
    expect(SKILL_PREFACE).toContain('G:\\Reports\\invoice.repx');
    expect(SKILL_PREFACE).toContain('/home/me/reports/invoice.repx');
    // Every relative link the skill makes is said where it leads, since it leads nowhere in the served copy (R12 of the wave-4 review).
    const targets = [...new Set([...file.matchAll(/\]\((\.\.\/[^)#\s]+)/g)].map((m) => m[1]))];
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(SKILL_PREFACE, target).toContain(target);
    await c.close();
  });

  it('sets every hint on every tool, takes an object, and keeps each description and the instructions within limits', async () => {
    const c = await legacy();
    const tools = (await c.request('tools/list')).result?.tools as Record<string, any>[];
    for (const tool of tools) {
      for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) expect(typeof tool.annotations[hint]).toBe('boolean');
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema.type).toBe('object');
      expect(tool.outputSchema.additionalProperties).not.toBe(false);
      expect(tool.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
    }
    expect(FORMA_INSTRUCTIONS.length).toBeLessThanOrEqual(1500);
    expect(FORMA_INSTRUCTIONS).toMatch(/^[\x20-\x7e\n]+$/);
    await c.close();
  });

  it('reads its version from package.json, and the real platform for the real server', () => {
    expect(formaVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(nodeSystem('win32').path.sep).toBe('\\');
    expect(nodeSystem('linux').path.sep).toBe('/');
  });
});
