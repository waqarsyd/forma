/**
 * A client in memory, for the MCP server's tests only (nothing the server
 * runs imports it, which boundaries.test.ts holds; outside coverage, as
 * testFs.ts is). It talks to a server through the same `serveStdio` entry
 * the stdio process uses, over the SDK's own InMemoryTransport (finding
 * TST-2: no client package needed), in raw JSON-RPC: requests awaited by
 * their id with no budget of their own, so a slow runner fails on the test's
 * timeout and never as a wrong answer (finding T9 of the wave-3 review), and
 * the server's own requests (roots/list) answered by `answerWith`.
 *
 * Shared by formaServer.test.ts and reportTools.test.ts (2026-11-24, the MCP
 * work's wave 4), so both drive the server the one way.
 *
 * `inThread` is a pipeline that runs a report tool's job in the test's own
 * thread (the wave-4 review's REV4-3): the server runs each job in a worker
 * thread, which v8 coverage does not follow, so the tools' logic is measured
 * here, and reportTools.test.ts runs the same jobs through the real worker
 * as well.
 *
 * Pure ASCII.
 */
import { InMemoryTransport, type JSONRPCMessage, type McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { runJob } from './pipeline';
import type { Pipeline } from './workerPool';

/** A pipeline that runs each job in this thread, with no bound: for tests only. */
export const inThread: Pipeline = {
  run: (job) => runJob(job),
  close: async () => {},
};

export type Reply = { id?: number; result?: Record<string, any>; error?: { code: number; message: string } };
export type Answer = (request: { id: number; method: string; params?: unknown }) => Record<string, unknown> | undefined;

/** The 2025-era revision the tests open with. */
export const LEGACY = '2025-11-25';

/** One connection to a server the factory makes: requests by id, and how the client answers the server's own requests. */
export async function connectInMemory(factory: () => McpServer | Promise<McpServer>) {
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (reply: Reply) => void>();
  const asked: { method: string }[] = [];
  let answer: Answer = () => undefined;
  client.onmessage = (message: JSONRPCMessage) => {
    const m = message as { id?: number; method?: string; params?: unknown };
    if (m.method !== undefined && m.id !== undefined) {
      asked.push({ method: m.method });
      const reply = answer({ id: m.id, method: m.method, params: m.params });
      if (reply) void client.send({ jsonrpc: '2.0', id: m.id, ...reply } as JSONRPCMessage);
    } else if (m.id !== undefined) pending.get(m.id)?.(message as Reply);
  };
  await client.start();
  const handle = serveStdio(factory, { transport: serverSide });
  let next = 1;
  const request = (method: string, params?: Record<string, unknown>) =>
    new Promise<Reply>((done) => {
      const id = next++;
      pending.set(id, done);
      void client.send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) } as JSONRPCMessage);
    });
  const notify = (method: string) => client.send({ jsonrpc: '2.0', method } as JSONRPCMessage);
  return { request, notify, asked, answerWith: (fn: Answer) => (answer = fn), close: () => handle.close() };
}

/** A connection opened as a 2025-era client opens one: initialize, then initialized. */
export async function openLegacy(factory: () => McpServer | Promise<McpServer>, capabilities: Record<string, unknown> = {}) {
  const c = await connectInMemory(factory);
  const init = await c.request('initialize', { protocolVersion: LEGACY, capabilities, clientInfo: { name: 'test', version: '1' } });
  await c.notify('notifications/initialized');
  return { ...c, init, call: (name: string, args: Record<string, unknown> = {}) => c.request('tools/call', { name, arguments: args }) };
}

/** The JSON a result's text block carries under its summary (and the note on text read from a file). */
export function textJson(result: Record<string, any>): Record<string, any> {
  const text: string = result.content[0].text;
  return JSON.parse(text.slice(text.indexOf('\n\n{') + 2));
}
