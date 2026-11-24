/**
 * Who may write to stdout in Forma's MCP server: the protocol, and nothing
 * else (2026-11-24, the MCP work's wave 3; finding PROTO-1 of the 2026-11-23
 * design audit).
 *
 * On stdio, stdout is the JSON-RPC channel, and the spec says the server MUST
 * NOT write anything there that is not an MCP message. Forma's pipeline was
 * written for the browser and logs freely: geminiService.ts alone has
 * console.log, console.info and console.debug calls on every generation, and
 * Node sends all three to stdout. Tesseract.js runs in worker_threads, whose
 * output reaches the parent through process.stdout.write. So the entry
 * (stdio.ts) calls `installStdoutGuard` before anything else is loaded, and:
 *
 * - keeps stdout's real write for `protocolOut`, a Writable that only the
 *   SDK's StdioServerTransport is given;
 * - sends every other process.stdout.write to stderr, and stdout's `end`
 *   too: a stream's end writes its last chunk through the internal write,
 *   not through the property replaced here, so it is replaced on its own,
 *   sends any chunk to stderr and never ends the real stream (finding PS-7
 *   of the wave-3 review);
 * - replaces the global console with one whose every method writes to
 *   stderr;
 * - passes all of it, and its own lines, through `redact`, so a key never
 *   reaches a host's log of the server's stderr: the one scrubber the web
 *   app's error reports share (lib/keyRedact.ts), with the formats of the
 *   keys Forma is given (`FORMA_KEYS`: the generic `sk-` and bearer forms
 *   would take apart a file's name, W8C-2), and from wave 8 the literal
 *   values of the keys the server was given too, which the entry hands over
 *   with `addSecrets` once it has read its environment, so a key in a format
 *   the patterns do not know is taken out by its value (finding SEC-7);
 *   `redact` is that same scrubber, for the tools' results and errors;
 * - logs an unhandled rejection and keeps serving (Node 24 would otherwise
 *   end the process, and Claude Code marks a stdio server that exits as
 *   failed until someone presses Reconnect);
 * - logs an uncaught exception, runs what was registered with
 *   `atFatalExit`, and exits non-zero, because Node's own docs say a process
 *   is not safe to resume after one. A host restarts or reconnects the
 *   server.
 *
 * The command line's entry (cliEntry.ts, since the CLI and Forma Designer
 * work's wave 4, 2026-11-24; finding CLI-11 of its design audit,
 * `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`) installs the
 * same guard with three options, the server's defaults unchanged: its own
 * prefix on the guard's lines (`forma: ` where the server's is
 * `forma-mcp: `); an unhandled rejection that fails the run (`onRejection:
 * 'fail'`), since a command that goes on past a promise that failed unseen
 * could report success over work it never did, where a server must keep
 * serving; and its own exit code after either (`fatalExitCode`, 70 there,
 * CLI-7), since the command line's 1 means a report written with audit
 * errors, which a crash must never be read as. Its results go to stdout
 * through `protocolOut`, as the server's protocol does, so with `--json`
 * stdout carries only its JSON Lines whatever a module logs.
 *
 * What it cannot cover: anything that writes to file descriptor 1 without
 * going through process.stdout. A synchronous write to the descriptor
 * itself, and a child process that inherits this one's stdout (spawned with
 * its stdio inherited, or forked, which inherits by default), reach the real
 * stdout between protocol messages whatever is replaced here (measured in
 * the wave-3 review). So those shapes are refused in src/mcp and in every
 * module it reaches, by boundaries.test.ts; a child process the server
 * starts gets its own pipes.
 *
 * It takes the process and the console's holder as arguments, so its tests
 * run on stand-ins and the test runner's own stdout is never touched. It
 * imports nothing that writes, so installing it first is enough.
 *
 * Pure ASCII.
 */
import { Console } from 'node:console';
import { Writable } from 'node:stream';
import { format } from 'node:util';
import { FORMA_KEYS, redactorFor } from '../lib/keyRedact';

type WriteFn = (...args: unknown[]) => boolean;

/** The parts of `process` the guard takes over. */
export interface GuardTarget {
  stdout: { write: WriteFn; end: (...args: unknown[]) => unknown; on(event: 'error', listener: (error: Error) => void): unknown };
  stderr: { write: WriteFn };
  on(event: 'unhandledRejection' | 'uncaughtException', listener: (reason: unknown) => void): unknown;
  exit(code: number): void;
}

export interface StdoutGuard {
  /** The only way to stdout: for the protocol's transport alone. */
  protocolOut: Writable;
  /** One line on stderr, prefixed and redacted. */
  log(...parts: unknown[]): void;
  /** Something to do before the process exits on an uncaught exception, such as deleting a partial file. */
  atFatalExit(fn: () => void): void;
  /** Keys and tokens taken out by their values from now on, wherever the guard and `redact` write. */
  addSecrets(values: readonly (string | null | undefined)[]): void;
  /** The scrubber every line goes through: the key patterns, and the values `addSecrets` was given. */
  redact(text: string): string;
}

const asText = (chunk: unknown) => (typeof chunk === 'string' ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk).toString('utf8') : String(chunk));

/** What an unhandled rejection does: the server goes on serving; a command line's run fails (the header). */
export type OnRejection = 'go on' | 'fail';

/** How the guard is installed; every field is optional, and left out each is the MCP server's. */
export interface GuardOptions {
  /** The process the guard takes over; for tests. */
  target?: GuardTarget;
  /** What holds the console; for tests. */
  holder?: { console: unknown };
  /** A scrubber of the caller's own, run after the key patterns and the values handed over. */
  redact?: (text: string) => string;
  /** What begins each of the guard's own lines on stderr: `forma-mcp: `, the server's, by default. */
  prefix?: string;
  /** 'go on', the server's default, logs an unhandled rejection and keeps serving; 'fail' logs it and exits as after an uncaught exception. */
  onRejection?: OnRejection;
  /** The exit code after an uncaught exception, or a rejection under 'fail': 1, the server's, by default. */
  fatalExitCode?: number;
}

/** What the guard says on stderr when it takes over a failure, by what a rejection does: the server's words exactly as they were, and a run's. */
const SAID: Record<OnRejection, { rejection: string; exception: string }> = {
  'go on': { rejection: 'an unhandled rejection; the server goes on.', exception: 'an uncaught exception; the server stops.' },
  fail: { rejection: 'an unhandled rejection; the run stops.', exception: 'an uncaught exception; the run stops.' },
};

/**
 * Takes stdout away from everything but the protocol, or the command line's
 * results. Call it once, first, in the entry; `target` and `holder` are for
 * tests, and the rest are the command line's (`GuardOptions`).
 */
export function installStdoutGuard(options: GuardOptions = {}): StdoutGuard {
  const target = options.target ?? (process as unknown as GuardTarget);
  const holder = options.holder ?? (globalThis as unknown as { console: unknown });
  const secrets: (string | null | undefined)[] = [];
  let scrub = options.redact ?? redactorFor(secrets, FORMA_KEYS);
  const redact = (text: string) => scrub(text);
  const realWrite = target.stdout.write.bind(target.stdout) as WriteFn;
  const errWrite = target.stderr.write.bind(target.stderr) as WriteFn;

  const protocolOut = new Writable({
    write(chunk, _encoding, callback) {
      realWrite(chunk, (error?: Error | null) => callback(error ?? null));
    },
  });
  target.stdout.on('error', (error) => protocolOut.destroy(error));

  target.stdout.write = ((chunk: unknown, ...rest: unknown[]) => errWrite(redact(asText(chunk)), ...rest)) as WriteFn;
  // end(chunk?, encoding?, callback?): the chunk to stderr, the callback called, the real stream left open.
  target.stdout.end = (...args: unknown[]) => {
    const [chunk] = args;
    if (chunk !== undefined && chunk !== null && typeof chunk !== 'function') errWrite(redact(asText(chunk)));
    const done = args.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (done) queueMicrotask(done);
    return target.stdout;
  };

  const toStderr = new Writable({
    write(chunk, _encoding, callback) {
      errWrite(redact(asText(chunk)));
      callback();
    },
  });
  holder.console = new Console({ stdout: toStderr, stderr: toStderr });

  const prefix = options.prefix ?? 'forma-mcp: ';
  const onRejection = options.onRejection ?? 'go on';
  const said = SAID[onRejection];
  const log = (...parts: unknown[]) => {
    errWrite(`${redact(`${prefix}${format(...parts)}`)}\n`);
  };
  const fatal: (() => void)[] = [];
  /** Logs why, runs what was asked for before leaving, and exits with the fatal code. */
  const stop = (words: string, cause: unknown) => {
    log(words, cause);
    for (const fn of fatal) {
      try {
        fn();
      } catch {
        /* the exit matters more */
      }
    }
    target.exit(options.fatalExitCode ?? 1);
  };

  target.on('unhandledRejection', (reason) => (onRejection === 'fail' ? stop(said.rejection, reason) : log(said.rejection, reason)));
  target.on('uncaughtException', (error) => stop(said.exception, error));

  const addSecrets = (values: readonly (string | null | undefined)[]) => {
    secrets.push(...values);
    const given = options.redact;
    const byValue = redactorFor(secrets, FORMA_KEYS);
    scrub = given ? (text) => given(byValue(text)) : byValue;
  };

  return { protocolOut, log, atFatalExit: (fn) => fatal.push(fn), addSecrets, redact };
}
