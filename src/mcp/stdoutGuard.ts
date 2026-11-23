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
 *   reaches a host's log of the server's stderr;
 * - logs an unhandled rejection and keeps serving (Node 24 would otherwise
 *   end the process, and Claude Code marks a stdio server that exits as
 *   failed until someone presses Reconnect);
 * - logs an uncaught exception, runs what was registered with
 *   `atFatalExit`, and exits non-zero, because Node's own docs say a process
 *   is not safe to resume after one. A host restarts or reconnects the
 *   server.
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
import { withoutKeys } from '../lib/problemReport';

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
}

const asText = (chunk: unknown) => (typeof chunk === 'string' ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk).toString('utf8') : String(chunk));

/**
 * Takes stdout away from everything but the protocol. Call it once, first,
 * in the entry; `target` and `holder` are for tests.
 */
export function installStdoutGuard(options: { target?: GuardTarget; holder?: { console: unknown }; redact?: (text: string) => string } = {}): StdoutGuard {
  const target = options.target ?? (process as unknown as GuardTarget);
  const holder = options.holder ?? (globalThis as unknown as { console: unknown });
  const redact = options.redact ?? withoutKeys;
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

  const log = (...parts: unknown[]) => {
    errWrite(`${redact(`forma-mcp: ${format(...parts)}`)}\n`);
  };
  const fatal: (() => void)[] = [];

  target.on('unhandledRejection', (reason) => log('an unhandled rejection; the server goes on.', reason));
  target.on('uncaughtException', (error) => {
    log('an uncaught exception; the server stops.', error);
    for (const fn of fatal) {
      try {
        fn();
      } catch {
        /* the exit matters more */
      }
    }
    target.exit(1);
  });

  return { protocolOut, log, atFatalExit: (fn) => fatal.push(fn) };
}
