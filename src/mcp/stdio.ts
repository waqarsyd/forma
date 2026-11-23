/**
 * The entry of Forma's MCP server: stdio only, both protocol eras
 * (2026-11-24, the MCP work's wave 3).
 *
 * A host runs it from a clone, after a full `npm ci` (tsx is a
 * devDependency), through the launcher beside it, with this exact command:
 *
 *   node <clone>/src/mcp/run.mjs
 *
 * One process, from any working folder (run.mjs says why not the tsx CLI,
 * which runs two and opens a pipe). No npm form is a host's command: `npm
 * run mcp` prints npm's banner to stdout, where the protocol allows only its
 * own messages, and npm runs the `mcp` script of whichever package.json is
 * nearest the folder the host starts the server in, which is the user's
 * project, not this clone (findings PS-9 and T5 of the wave-3 review). Never
 * `npx tsx`: outside the clone it fetches an unpinned tsx, because npx
 * assumes yes when stdin is not a terminal. There is no bundle and nothing is
 * written to dist/, which Firebase Hosting publishes (findings PROTO-2,
 * DOC-1, DOC-2, TST-1, TST-3).
 *
 * The order below is the point of this file, and boundaries.test.ts holds it:
 *
 *   1. The stdout guard is the only static import, and it is installed
 *      before anything else is loaded (static imports are evaluated before
 *      the body, so everything else is imported dynamically after it).
 *   2. The environment is read here and nowhere else in src/mcp: the roots'
 *      two variables. No dotenv: a .env in the host's working folder is
 *      never this server's business (SEC-9).
 *   3. serveStdio serves both eras from one factory: a 2026-07-28 client
 *      opens with server/discover, a 2025-era client with initialize. Its
 *      transport writes through the guard's `protocolOut`, the one Writable
 *      that reaches the real stdout.
 *   4. When stdin ends the transport closes and the process exits by itself;
 *      a timer that does not hold the process open makes sure of it a second
 *      later, whatever still holds a handle (the spec: a server SHOULD exit
 *      promptly when its stdin closes).
 *
 * A test-only switch, FORMA_MCP_TEST_NOISE, used by stdio.test.ts and by
 * nothing else: `1` writes to console.log, console.info, console.debug and
 * process.stdout.write at start and every 25 ms, prints a key of each of AI
 * Studio's forms (built here at run time, never read from anywhere) through
 * those and the guard's own log, says its process id on stderr, and leaves
 * one promise rejected with no handler, so the test can show that stdout
 * still carries only JSON-RPC, that every key reaches stderr as "(a key)",
 * that the process the host started is the server itself, and that the
 * server keeps serving; `crash` throws an uncaught exception, so the test can
 * show the process then exits non-zero.
 *
 * This file and run.mjs are outside the coverage measure: they run only in
 * the process stdio.test.ts spawns, which v8 coverage does not follow.
 *
 * Pure ASCII.
 */
import { installStdoutGuard } from './stdoutGuard';

const guard = installStdoutGuard();

const noise = process.env.FORMA_MCP_TEST_NOISE;
if (noise) makeTestNoise(noise);

const { serveStdio, StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');
const { createFormaServer, formaVersion, nodeSystem } = await import('./formaServer');
const { readEnvRoots } = await import('./roots');

const system = nodeSystem();
const envRoots = readEnvRoots({ FORMA_MCP_ROOTS: process.env.FORMA_MCP_ROOTS, CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR }, system);
for (const problem of [...(envRoots.forma?.problems ?? []), ...(envRoots.claude?.problems ?? [])]) guard.log(problem);
const version = formaVersion();

serveStdio(() => createFormaServer({ envRoots, system, version, log: (line) => guard.log(line) }), {
  transport: new StdioServerTransport(process.stdin, guard.protocolOut),
  onerror: (error) => guard.log('a protocol error:', error),
});

const leave = () => setTimeout(() => process.exit(0), 1000).unref();
process.stdin.once('end', leave);
process.stdin.once('close', leave);

function makeTestNoise(mode: string): void {
  if (mode === 'crash') {
    setTimeout(() => {
      throw new Error('FORMA-NOISE crash');
    }, 200);
    return;
  }
  const say = () => {
    console.log('FORMA-NOISE console.log');
    console.info('FORMA-NOISE console.info');
    console.debug('FORMA-NOISE console.debug');
    process.stdout.write('FORMA-NOISE process.stdout.write\n');
  };
  // The same two keys stdio.test.ts builds; the guard must take each out on every path.
  const key = ['AI', 'za', 'Sy'].join('') + 'n'.repeat(33);
  const newer = ['A', 'Q.'].join('') + 'n'.repeat(40);
  console.log(`FORMA-NOISE key on console.log ${key}`);
  process.stdout.write(`FORMA-NOISE key on process.stdout.write ${newer}\n`);
  guard.log(`FORMA-NOISE key on the guard's log ${key}`);
  console.error(`FORMA-NOISE pid ${process.pid}`);
  say();
  setInterval(say, 25).unref();
  void Promise.reject(new Error('FORMA-NOISE rejection'));
}
