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
 *      two variables, and since wave 8 the AI's (aiSettings.ts names them:
 *      FORMA_GEMINI_KEY, FORMA_PROVIDER, OpenRouter's and Local AI's, the
 *      model pin, the locale and the mock switch), copied out by name and
 *      handed to readAiSettings, which reads nothing itself. The keys'
 *      values go to the guard first (`addSecrets`), so from then on each is
 *      taken out of every line on stderr and every result by its value, a
 *      key in a format the patterns do not know included (SEC-7; no Local
 *      AI token is read, so none is handed over); GEMINI_API_KEY's and
 *      GOOGLE_API_KEY's too, which are then deleted from the environment
 *      with Google's Vertex AI switches before anything loads the Gemini
 *      SDK, which would fall back on them by itself (SEC-9, DOC-4); Forma's
 *      two key variables are deleted too once copied, so no worker thread
 *      inherits them (each job carries its settings). No
 *      dotenv: a .env in the host's working folder is never this server's
 *      business (SEC-9).
 *   3. serveStdio serves both eras from one factory: a 2026-07-28 client
 *      opens with server/discover, a 2025-era client with initialize. Its
 *      transport writes through the guard's `protocolOut`, the one Writable
 *      that reaches the real stdout.
 *   4. When stdin ends the transport closes and the process exits by itself;
 *      the AI tools' worker thread is ended at once (a report in progress is
 *      not written: its call was aborted with the connection, PROTO-4), and
 *      a timer that does not hold the process open makes sure of the exit a
 *      second later, whatever still holds a handle (the spec: a server
 *      SHOULD exit promptly when its stdin closes).
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

// The AI's settings, copied out by name; the keys' values to the guard before anything can print them.
const aiEnv = {
  FORMA_PROVIDER: process.env.FORMA_PROVIDER,
  FORMA_GEMINI_KEY: process.env.FORMA_GEMINI_KEY,
  FORMA_OPENROUTER_KEY: process.env.FORMA_OPENROUTER_KEY,
  FORMA_OPENROUTER_MODEL: process.env.FORMA_OPENROUTER_MODEL,
  FORMA_LOCAL_URL: process.env.FORMA_LOCAL_URL,
  FORMA_LOCAL_MODEL: process.env.FORMA_LOCAL_MODEL,
  FORMA_MODEL: process.env.FORMA_MODEL,
  FORMA_LOCALE: process.env.FORMA_LOCALE,
  FORMA_MCP_MOCK: process.env.FORMA_MCP_MOCK,
};
guard.addSecrets([aiEnv.FORMA_GEMINI_KEY, aiEnv.FORMA_OPENROUTER_KEY, process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY]);
// Never this server's: the Gemini SDK would take a key or a Vertex AI endpoint from these by itself (SEC-9, DOC-4).
for (const name of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION']) delete process.env[name];
// The keys live in the settings from here on, never in an environment a worker thread copies.
for (const name of ['FORMA_GEMINI_KEY', 'FORMA_OPENROUTER_KEY']) delete process.env[name];

const noise = process.env.FORMA_MCP_TEST_NOISE;
if (noise) makeTestNoise(noise);

const { serveStdio, StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');
const { createFormaServer, formaVersion, nodeSystem } = await import('./formaServer');
const { readEnvRoots } = await import('./roots');
const { loadRepxSkill } = await import('./skillResource');
const { workerPipeline } = await import('./workerPool');
const { readAiSettings } = await import('./aiSettings');
const { oneAtATime, workerGenerator } = await import('./generator');

const system = nodeSystem();
const envRoots = readEnvRoots({ FORMA_MCP_ROOTS: process.env.FORMA_MCP_ROOTS, CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR }, system);
for (const problem of [...(envRoots.forma?.problems ?? []), ...(envRoots.claude?.problems ?? [])]) guard.log(problem);
const version = formaVersion();
// The REPX skill, read from the clone once; every connection attaches the same catalog.
const skills = await loadRepxSkill((line) => guard.log(line));
// The report tools' work, in worker threads with a memory bound and a deadline; one pipeline for every connection.
const pipeline = workerPipeline({ log: (line) => guard.log(line) });
// The AI tools' AI, said on stderr when it is not ready (never a key), and their one generator for the process: one call at a time.
const settings = readAiSettings(aiEnv);
if (!settings.ready) guard.log(`the AI tools refuse until an AI is set up: ${settings.problems.join(' ')}`);
const generator = settings.ready
  ? oneAtATime(workerGenerator({ setup: { mock: settings.mock, ...(settings.model ? { model: settings.model } : {}), ...(settings.locale ? { locale: settings.locale } : {}) }, log: (line) => guard.log(line) }))
  : null;

serveStdio(() => createFormaServer({ envRoots, system, version, skills, pipeline, log: (line) => guard.log(line), redact: guard.redact, ai: { settings, generator } }), {
  transport: new StdioServerTransport(process.stdin, guard.protocolOut),
  onerror: (error) => guard.log('a protocol error:', error),
});

const leave = () => {
  void generator?.close();
  setTimeout(() => process.exit(0), 1000).unref();
};
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
