/**
 * The entry of Forma's command line (2026-11-24, the CLI and Forma Designer
 * work's wave 4; findings CLI-1, CLI-9, CLI-11, SEC-3 and TEST-2 of its
 * design audit, `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`),
 * the second entry of src/mcp beside the MCP server's stdio.ts. A person or
 * a CI step runs it through the launcher beside it, from any folder:
 *
 *   node <clone>/src/mcp/cli.mjs <command> [options]
 *
 * (cli.mjs says why plain node, never npx or the tsx CLI; scripts/repx.ts,
 * the command line until this wave, loads this file too.) The order below is
 * the point of this file, as stdio.ts's is of that one, and
 * boundaries.test.ts holds it for both (`ENTRIES`):
 *
 *   1. The stdout guard is the only static import, installed before
 *      anything else is loaded, with the command line's options (CLI-11):
 *      its own prefix on the guard's lines, an unhandled rejection that
 *      fails the run, and 70 as the exit code after either, since 1 means
 *      a report written with audit errors (CLI-7). From then on stdout
 *      carries only what commandLine.ts writes through `protocolOut`, its results or
 *      its JSON Lines; every console method and stray write goes to stderr,
 *      keys taken out.
 *   2. The environment is taken here and nowhere else in the command line:
 *      aiSettings.ts's `takeAiEnv` in the command line's voice, the first
 *      thing imported after the guard (it loads no package and starts
 *      nothing), which copies the FORMA_* names but FORMA_MCP_MOCK (the
 *      command line's mock is its `--mock` flag) and never FORMA_MCP_ROOTS
 *      or CLAUDE_PROJECT_DIR, which name the server's roots (the command line
 *      judges paths against the folder it runs in). Its keys' values go to
 *      the guard (`addSecrets`), so each is taken out of every line by value;
 *      then GEMINI_API_KEY, GOOGLE_API_KEY, Google's Vertex AI switches and
 *      Forma's two key variables are deleted, before anything can load the
 *      Gemini SDK or start the worker threads, which would otherwise copy
 *      them (SEC-3, SEC-9, DOC-4). No dotenv: a .env in the folder a command
 *      runs in is never Forma's business.
 *   3. Forma Designer is looked for (designerVerbs.ts, since that work's
 *      wave 6, 2026-11-25; D2-11): its place from the platform,
 *      LOCALAPPDATA (the per-user install) and FORMA_DESIGNER (a copy built
 *      from source), and the environment it is started with, Windows' own
 *      variables alone, built only after the keys are deleted
 *      (`designerEnvFrom`), so no key of any program reaches it; nothing is
 *      started here. Both are handed to `main` as values, as the AI's are.
 *   4. commandLine.ts is loaded, Ctrl+C and a termination are wired to a stop
 *      (`stopOnSignals`), and `main` runs with the arguments after the
 *      launcher's and what the process gives it: the working folder, the
 *      AI's values, Forma Designer's place, stdout through `protocolOut`,
 *      stderr through the guard's log and its scrubber.
 *   5. The exit code is set and the process leaves when nothing is left to
 *      do, so what was written to a pipe is flushed; a timer that does not
 *      hold the process open makes sure of the exit two seconds later. On
 *      Windows a stop once the AI's thread has started ends the process
 *      with 0xC000013A, a console's Ctrl+C code, in place of 130 (the
 *      wave-4 review's U7; leaving at once after `main` was measured in its
 *      fix round and changed nothing, so it is not done): commandLine.ts's
 *      header and mcp.md say so.
 *
 * boundaries.test.ts holds this file's wiring too (`ENTRIES`, and the
 * command line's own case, SEC-W4-4): the guard's exact options, `main`
 * handed the guard's scrubber, its log and its `protocolOut`, and no
 * reference to the environment before the keys are deleted but
 * `takeAiEnv`'s. A test-only switch, FORMA_CLI_TEST_NOISE (the function at
 * the end says what it does), is read after that, as stdio.ts reads its own.
 *
 * This file and cli.mjs are outside the coverage measure, as stdio.ts and
 * run.mjs are: they run only in the process commandLine.test.ts spawns. Everything
 * else the command line does is commandLine.ts's, measured in the tests' own thread.
 *
 * Pure ASCII.
 */
import { installStdoutGuard } from './stdoutGuard';

const guard = installStdoutGuard({ prefix: 'forma: ', onRejection: 'fail', fatalExitCode: 70 });

// The AI's names, taken by aiSettings.ts's one list before anything that can load the Gemini SDK or start a worker (it
// loads neither): the keys' values to the guard before anything can print them; then the Gemini SDK's own fallbacks and
// Forma's key variables are deleted, so no worker thread copies them.
const { takeAiEnv } = await import('./aiSettings');
const { aiEnv, secrets, remove } = takeAiEnv(process.env, 'cli');
guard.addSecrets(secrets);
for (const name of remove) delete process.env[name];

// Forma Designer, which connections and --connection start (designerVerbs.ts): found by the two values read here, and handed an
// environment of Windows' own variables, built only now that the keys are deleted, so no key of any program reaches it.
const { designerEnvFrom, designerPlace } = await import('./designerVerbs');
const designer = {
  place: designerPlace({ platform: process.platform, localAppData: process.env.LOCALAPPDATA, override: process.env.FORMA_DESIGNER }),
  env: designerEnvFrom(process.env),
};

const { main, stopOnSignals } = await import('./commandLine');
const stop = new AbortController();
stopOnSignals(process, stop, (line) => guard.log(line));
// A reader that leaves early (`... | head`) closes stdout: the run stops as on Ctrl+C, rather than failing on its next write.
guard.protocolOut.on('error', () => stop.abort());
const code = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  aiEnv,
  out: (text) => {
    guard.protocolOut.write(text);
  },
  err: (line) => guard.log(line),
  redact: guard.redact,
  signal: stop.signal,
  designer,
});
process.exitCode = code;

if (process.env.FORMA_CLI_TEST_NOISE) makeTestNoise();

setTimeout(() => process.exit(code), 2000).unref();

/**
 * A test-only switch, FORMA_CLI_TEST_NOISE, used by commandLine.test.ts and
 * by nothing else, as stdio.ts's FORMA_MCP_TEST_NOISE is (the wave-4
 * review's SEC-W4-4): once `main` has printed its results, a key in a shape
 * no pattern knows (built here at run time; the test sets the same one as
 * FORMA_GEMINI_KEY, so only the scrub by value takes it out) goes to
 * console.log, to process.stdout.write and to the guard's log, and a
 * promise is left rejected with no handler, so the test can show stdout
 * carrying results alone, the key reaching stderr only as "(a key)", and an
 * unhandled rejection ending the run with 70, not 1.
 */
function makeTestNoise(): void {
  const shapeless = ['gq', '00'].join('') + 'b7c1d2e3f4a5'.repeat(3);
  console.log(`FORMA-NOISE key on console.log ${shapeless}`);
  process.stdout.write(`FORMA-NOISE key on process.stdout.write ${shapeless}\n`);
  guard.log(`FORMA-NOISE key on the guard's log ${shapeless}`);
  // Once stdout has taken the results, so the exit the rejection makes cannot cut them short.
  guard.protocolOut.write('', () => void Promise.reject(new Error(`FORMA-NOISE rejection ${shapeless}`)));
}
