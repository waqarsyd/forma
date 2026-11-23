/**
 * The stdout guard (stdoutGuard.ts) on stand-ins for the process and the
 * console, so the test runner's own stdout is never touched: the protocol
 * alone reaches stdout, everything else goes to stderr with keys taken out,
 * an unhandled rejection is logged and survived, and an uncaught exception
 * is logged and ends the process non-zero (finding PROTO-1). Stdout's `end`
 * is taken over as its `write` is (PS-7 of the wave-3 review), and a key is
 * taken out on every path to stderr, in both of AI Studio's forms (T3). The
 * real process is held by stdio.test.ts, which spawns it.
 */
import { describe, expect, it } from 'vitest';
import { installStdoutGuard, type GuardTarget } from './stdoutGuard';

const fakeKey = () => ['AI', 'za', 'Sy'].join('') + 'q'.repeat(33);
const fakeNewerKey = () => ['A', 'Q.'].join('') + 'q'.repeat(40);

function standIn() {
  const out: string[] = [];
  const err: string[] = [];
  const ended: string[] = [];
  const listeners: Record<string, ((value: unknown) => void)[]> = {};
  const exits: number[] = [];
  const text = (chunk: unknown) => (typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
  const target: GuardTarget = {
    stdout: {
      write: (chunk: unknown, ...rest: unknown[]) => {
        out.push(text(chunk));
        const done = rest.find((r) => typeof r === 'function') as (() => void) | undefined;
        done?.();
        return true;
      },
      end: (chunk?: unknown) => {
        ended.push(chunk === undefined ? '(end)' : text(chunk));
      },
      on: (event: string, listener: (e: Error) => void) => (listeners[`stdout ${event}`] ??= []).push(listener as (v: unknown) => void),
    },
    stderr: {
      write: (chunk: unknown) => {
        err.push(text(chunk));
        return true;
      },
    },
    on: (event: string, listener: (v: unknown) => void) => (listeners[event] ??= []).push(listener),
    exit: (code: number) => {
      exits.push(code);
    },
  };
  const holder: { console: any } = { console: undefined };
  const fire = (event: string, value: unknown) => listeners[event]?.forEach((l) => l(value));
  return { out, err, ended, exits, target, holder, fire };
}

describe('installStdoutGuard', () => {
  it('lets only protocolOut reach stdout, and sends a stray write to stderr', async () => {
    const s = standIn();
    const guard = installStdoutGuard({ target: s.target, holder: s.holder });
    await new Promise((done) => guard.protocolOut.write('{"jsonrpc":"2.0"}\n', done));
    s.target.stdout.write('stray line\n');
    s.target.stdout.write(Buffer.from('stray bytes\n'), () => undefined);
    expect(s.out).toEqual(['{"jsonrpc":"2.0"}\n']);
    expect(s.err).toEqual(['stray line\n', 'stray bytes\n']);
  });

  it("takes stdout's end over too: its chunk goes to stderr, its callback is called, and the real stream is never ended", async () => {
    const s = standIn();
    const guard = installStdoutGuard({ target: s.target, holder: s.holder });
    await new Promise<void>((done) => s.target.stdout.end('last words\n', done));
    s.target.stdout.end();
    s.target.stdout.end(Buffer.from('bytes at the end\n'));
    await new Promise((done) => guard.protocolOut.write('{"jsonrpc":"2.0"}\n', done));
    expect(s.ended).toEqual([]);
    expect(s.out).toEqual(['{"jsonrpc":"2.0"}\n']);
    expect(s.err).toEqual(['last words\n', 'bytes at the end\n']);
  });

  it('takes a key of either form out of a stray write and an end, not only out of the console', () => {
    const s = standIn();
    installStdoutGuard({ target: s.target, holder: s.holder });
    const key = fakeKey();
    const newer = fakeNewerKey();
    s.target.stdout.write(`stray ${key}\n`);
    s.target.stdout.write(Buffer.from(`bytes ${newer}\n`));
    s.target.stdout.end(`end ${key}\n`);
    expect(s.err.join('')).toBe('stray (a key)\nbytes (a key)\nend (a key)\n');
    expect(s.out).toEqual([]);
  });

  it('gives the program a console whose every method writes to stderr, with keys taken out', () => {
    const s = standIn();
    installStdoutGuard({ target: s.target, holder: s.holder });
    const key = fakeKey();
    s.holder.console.log('log', key);
    s.holder.console.info('info', fakeNewerKey());
    s.holder.console.debug('debug');
    s.holder.console.error('error');
    expect(s.out).toEqual([]);
    expect(s.err.join('')).toBe('log (a key)\ninfo (a key)\ndebug\nerror\n');
  });

  it('logs an unhandled rejection and goes on serving', () => {
    const s = standIn();
    installStdoutGuard({ target: s.target, holder: s.holder });
    s.fire('unhandledRejection', new Error('lost promise'));
    expect(s.exits).toEqual([]);
    expect(s.err.join('')).toMatch(/^forma-mcp: an unhandled rejection; the server goes on\. Error: lost promise/);
  });

  it('logs an uncaught exception, runs what was asked for before leaving, and exits 1', () => {
    const s = standIn();
    const guard = installStdoutGuard({ target: s.target, holder: s.holder, redact: (t) => t.replace(/secret/g, '(hidden)') });
    const ran: string[] = [];
    guard.atFatalExit(() => {
      throw new Error('a cleanup that fails');
    });
    guard.atFatalExit(() => ran.push('partial removed'));
    s.fire('uncaughtException', new Error('secret broke'));
    expect(ran).toEqual(['partial removed']);
    expect(s.exits).toEqual([1]);
    expect(s.err.join('')).toMatch(/^forma-mcp: an uncaught exception; the server stops\. Error: \(hidden\) broke/);
  });

  it("hands a failure of the real stdout to the protocol's stream", async () => {
    const s = standIn();
    const guard = installStdoutGuard({ target: s.target, holder: s.holder });
    const failed = new Promise<Error>((done) => guard.protocolOut.on('error', done));
    s.fire('stdout error', new Error('EPIPE'));
    expect((await failed).message).toBe('EPIPE');
  });
});
