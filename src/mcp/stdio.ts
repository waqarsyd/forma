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
 *   2. The environment is touched here and nowhere else in src/mcp but the
 *      command line's own entry, cliEntry.ts (boundaries.test.ts): the roots'
 *      two variables, and since wave 8 the AI's (aiSettings.ts names them:
 *      FORMA_GEMINI_KEY, FORMA_PROVIDER, OpenRouter's and Local AI's, the
 *      model pin, the locale and the mock switch). Since the CLI and Forma
 *      Designer work's wave 2 (2026-11-24, CLI-9, TEST-2) what is taken is
 *      aiSettings.ts's `takeAiEnv`, one list for both entries, the first
 *      thing imported after the guard, which loads no SDK and starts
 *      nothing; this file applies it, in its old order. The keys' values go
 *      to the guard first (`addSecrets`), so from then on each is taken out
 *      of every line on stderr and every result by its value, a key in a
 *      format the patterns do not know included (SEC-7; no Local AI token is
 *      read, so none is handed over); GEMINI_API_KEY's and GOOGLE_API_KEY's
 *      too, which are then deleted from the environment with Google's Vertex
 *      AI switches before anything loads the Gemini SDK, which would fall
 *      back on them by itself (SEC-9, DOC-4); Forma's two key variables are
 *      deleted too once copied, so no worker thread inherits them (each job
 *      carries its settings). The AI's values go to readAiSettings, which
 *      reads nothing itself. No dotenv: a .env in the host's working folder
 *      is never this server's business (SEC-9). Since the CLI and Forma
 *      Designer work's wave 7 (2026-11-25; D2-11, the owner's OC6), once
 *      the keys are deleted: LOCALAPPDATA and FORMA_DESIGNER, where Forma
 *      Designer is (designerVerbs.ts `designerPlace`), the environment it is
 *      started with, built from Windows' own variables by `designerEnvFrom`,
 *      and the person's two switches, FORMA_DATABASE_CONNECTIONS and
 *      FORMA_DATABASE_SAMPLES (databaseTools.ts `readDatabaseSettings`), as
 *      the command line's entry reads Forma Designer's two; boundaries.test.ts
 *      holds that the environment is referred to after the delete by these
 *      and the roots' reads alone.
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
 * Studio's forms and one in a shape no pattern knows (each built here at run
 * time, never read from anywhere; the test sets the last as
 * FORMA_GEMINI_KEY, so only the scrub by value can take it out, which shows
 * this file handing the guard the keys `takeAiEnv` took: the CLI work's
 * wave-2 review, SEC-W2-1) through those and the guard's own log, says its
 * process id on stderr, and leaves one promise rejected with no handler, so
 * the test can show that stdout still carries only JSON-RPC, that every key
 * reaches stderr as "(a key)", that the process the host started is the
 * server itself, and that the server keeps serving; `crash` throws an
 * uncaught exception, so the test can show the process then exits non-zero.
 *
 * This file and run.mjs are outside the coverage measure: they run only in
 * the process stdio.test.ts spawns, which v8 coverage does not follow.
 *
 * Pure ASCII.
 */
import { installStdoutGuard } from './stdoutGuard';

const guard = installStdoutGuard();

// The AI's names, taken by aiSettings.ts's one list before anything that can load the Gemini SDK or start a worker (it
// loads neither): the keys' values to the guard before anything can print them; then the Gemini SDK's own fallbacks, which
// are never this server's (SEC-9, DOC-4), and Forma's key variables, which live in the settings from here on, never in an
// environment a worker thread copies, are deleted.
const { readAiSettings, takeAiEnv } = await import('./aiSettings');
const { aiEnv, secrets, remove } = takeAiEnv(process.env, 'mcp');
guard.addSecrets(secrets);
for (const name of remove) delete process.env[name];

const noise = process.env.FORMA_MCP_TEST_NOISE;
if (noise) makeTestNoise(noise);

const { serveStdio, StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');
const { createFormaServer } = await import('./formaServer');
const { nodeSystem } = await import('./paths');
const { formaVersion } = await import('./version');
const { readEnvRoots } = await import('./roots');
const { loadRepxSkill } = await import('./skillResource');
const { workerPipeline } = await import('./workerPool');
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
// Forma Designer, which database_connections and a `connection` start (designerVerbs.ts): found by the two values read here,
// and handed an environment of Windows' own variables, built only now that the keys are deleted, so no key of any program
// reaches it; and the person's two database switches, the connections it may read and whether sample rows may go to the AI
// (databaseTools.ts, the owner's OC6), said on stderr when either is wrong, never with its value.
const { designerEnvFrom, designerPlace } = await import('./designerVerbs');
const { readDatabaseSettings } = await import('./databaseTools');
const database = {
  settings: await readDatabaseSettings({ connections: process.env.FORMA_DATABASE_CONNECTIONS, samples: process.env.FORMA_DATABASE_SAMPLES }),
  designer: { place: designerPlace({ platform: process.platform, localAppData: process.env.LOCALAPPDATA, override: process.env.FORMA_DESIGNER }), env: designerEnvFrom(process.env) },
};
for (const problem of database.settings.problems) guard.log(problem);

serveStdio(() => createFormaServer({ envRoots, system, version, skills, pipeline, log: (line) => guard.log(line), redact: guard.redact, ai: { settings, generator }, database }), {
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
  // The same keys stdio.test.ts builds; the guard must take each out on every path, the shapeless one by its value alone.
  const key = ['AI', 'za', 'Sy'].join('') + 'n'.repeat(33);
  const newer = ['A', 'Q.'].join('') + 'n'.repeat(40);
  const shapeless = ['gq', '00'].join('') + 'f4aba7fbd7a9'.repeat(3);
  console.log(`FORMA-NOISE key on console.log ${key}`);
  process.stdout.write(`FORMA-NOISE key on process.stdout.write ${newer}\n`);
  guard.log(`FORMA-NOISE key on the guard's log ${key}`);
  console.log(`FORMA-NOISE shapeless key on console.log ${shapeless}`);
  guard.log(`FORMA-NOISE shapeless key on the guard's log ${shapeless}`);
  console.error(`FORMA-NOISE pid ${process.pid}`);
  say();
  setInterval(say, 25).unref();
  void Promise.reject(new Error('FORMA-NOISE rejection'));
}
