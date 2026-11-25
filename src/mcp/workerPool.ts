/**
 * Where a report tool's work runs: a worker thread with a memory bound and a
 * deadline, never the thread that answers the host (2026-11-24, the wave-4
 * review's REV4-3). The tools read files someone else made, and the web
 * app's modules they run were written for a report a person is looking at.
 * The review measured, on the server as a host runs it, a well-formed 1.3 MB
 * report that ran it out of memory, which ended the process and every tool
 * with it, and small malformed files that held its one thread for minutes,
 * while no other request was answered, forma_status included, and a
 * cancellation did nothing. The size limit bounds neither.
 *
 * - Each job runs in a Worker with `resourceLimits` (`PIPELINE_LIMITS`:
 *   512 MB of heap and a 4 MB stack) and a deadline of 30 seconds. Running
 *   out of memory, passing the deadline and the call's cancellation each end
 *   that worker and become a refusal in plain words (or, for a cancellation,
 *   the wrapper's "Stopped"), in the job's voice since the CLI and Forma
 *   Designer work's wave 2 ("one call" to a host's model, "one report" to a
 *   person at a command line, `ONE_CALL`, CLI-10); nothing is written, and
 *   the server goes on.
 *   A failure inside the worker that is not a refusal ends it too, and its
 *   stack goes to the log, never into the result (toolShape.ts).
 * - One worker is kept idle between calls, unref'd so it never holds the
 *   process open; calls made at once each get their own, since Claude Code
 *   runs read-only tools side by side.
 * - A worker's stdout and stderr are its own (`stdout: true`, `stderr:
 *   true`), read here and sent to the server's log on stderr, line by line:
 *   only the transport writes to stdout (stdoutGuard.ts, and
 *   boundaries.test.ts, which refuses a Worker started without them).
 *
 * The worker itself is worker.mjs, and its work pipeline.ts.
 *
 * Pure ASCII.
 */
import { Worker } from 'node:worker_threads';
import type { Readable } from 'node:stream';
import { ToolRefusal, type Voice } from './caller';
import type { Done, Job, JobName } from './pipeline';

/** How long one call's work may take, and how much memory it may use. */
export interface PipelineLimits {
  deadlineMs: number;
  heapMb: number;
  stackMb: number;
}

export const PIPELINE_LIMITS: PipelineLimits = { deadlineMs: 30_000, heapMb: 512, stackMb: 4 };

/** Runs a report tool's job off the thread that answers the host. */
export interface Pipeline {
  run<T extends JobName>(job: Extract<Job, { tool: T }>, signal: AbortSignal): Promise<Done<T>>;
  /** Ends every idle worker; a pipeline closed takes no more jobs. */
  close(): Promise<void>;
}

/** What one piece of work is to whoever it is said to (CLI-10): a call to a host's model, a report to a person at a command line. */
export const ONE_CALL: Record<Voice, string> = { mcp: 'one call', cli: 'one report' };

/** The refusal when a call's work passes its deadline, in the job's words (the server's by default). */
export const tooLong = (ms: number, voice: Voice = 'mcp') =>
  `Forma stopped working on this report after ${ms / 1000} seconds, the longest ${ONE_CALL[voice]} may take. A report this slow to read is usually damaged, or far larger than a report needs to be. Nothing was written.`;

/** The refusal when a call's work runs out of memory, in the job's words. */
export const tooMuchMemory = (mb: number, voice: Voice = 'mcp') =>
  `Forma stopped working on this report when it needed more than ${mb} MB of memory, the most ${ONE_CALL[voice]} may use. A report that needs this much is usually damaged, or far larger than a report needs to be. Nothing was written.`;

const WORKER_FILE = new URL('./worker.mjs', import.meta.url);

type Reply = { id: number; ok: true; value: unknown } | { id: number; ok: false; refusal?: string; fromFile?: Record<string, unknown>; error?: string };

/** A worker's output, a line at a time, to the server's log; generator.ts's worker's too. */
export function toLog(stream: Readable | null, log: (line: string) => void): void {
  if (!stream) return;
  let rest = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    rest += chunk;
    const lines = rest.split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) log(line.replace(/\r$/, ''));
  });
}

/** An error from inside the worker, its first line as the message and its whole stack kept for the log. */
export function workerError(stack = 'the worker failed'): Error {
  const error = new Error(stack.split('\n')[0]);
  error.stack = stack;
  return error;
}

export interface PipelineOptions {
  /** A line on the server's log, stderr. */
  log(line: string): void;
  limits?: Partial<PipelineLimits>;
  /** Starts a worker; worker.mjs with the limits by default. A test starts one of its own. */
  spawn?(limits: PipelineLimits): Worker;
}

/** The pipeline the server runs: worker threads, one kept idle. */
export function workerPipeline(options: PipelineOptions): Pipeline {
  const limits: PipelineLimits = { ...PIPELINE_LIMITS, ...options.limits };
  const spawn =
    options.spawn ??
    ((l: PipelineLimits) => new Worker(WORKER_FILE, { resourceLimits: { maxOldGenerationSizeMb: l.heapMb, stackSizeMb: l.stackMb }, stdout: true, stderr: true }));
  const idle: Worker[] = [];
  let next = 0;
  let closed = false;

  const start = () => {
    const worker = spawn(limits);
    toLog(worker.stdout, options.log);
    toLog(worker.stderr, options.log);
    // A busy worker's failure is its job's (below); an idle one that ends is only dropped.
    worker.on('error', () => {});
    worker.on('exit', () => {
      const at = idle.indexOf(worker);
      if (at >= 0) idle.splice(at, 1);
    });
    return worker;
  };

  return {
    run<T extends JobName>(job: Extract<Job, { tool: T }>, signal: AbortSignal): Promise<Done<T>> {
      return new Promise<Done<T>>((resolve, reject) => {
        if (closed) return reject(new Error('the pipeline is closed'));
        if (signal.aborted) return reject(new Error('cancelled'));
        const worker = idle.pop() ?? start();
        worker.ref();
        const id = ++next;
        let settled = false;
        const end = (keep: boolean, settle: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          worker.off('message', onMessage);
          worker.off('error', onError);
          worker.off('exit', onExit);
          if (keep && !closed && idle.length === 0) {
            worker.unref();
            idle.push(worker);
          } else void worker.terminate();
          settle();
        };
        const onMessage = (reply: Reply) => {
          if (reply.id !== id) return;
          if (reply.ok) end(true, () => resolve(reply.value as Done<T>));
          else if (reply.refusal !== undefined) end(true, () => reject(new ToolRefusal(reply.refusal, reply.fromFile)));
          else end(false, () => reject(workerError(reply.error)));
        };
        const onError = (error: Error & { code?: string }) =>
          end(false, () => reject(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new ToolRefusal(tooMuchMemory(limits.heapMb, job.voice)) : error));
        const onExit = (code: number) => end(false, () => reject(new Error(`the worker stopped before it answered (exit code ${code})`)));
        const onAbort = () => end(false, () => reject(new Error('cancelled')));
        const timer = setTimeout(() => end(false, () => reject(new ToolRefusal(tooLong(limits.deadlineMs, job.voice)))), limits.deadlineMs);
        worker.on('message', onMessage);
        worker.on('error', onError);
        worker.on('exit', onExit);
        signal.addEventListener('abort', onAbort, { once: true });
        worker.postMessage({ id, job });
      });
    },

    async close() {
      closed = true;
      await Promise.all(idle.splice(0).map((worker) => worker.terminate()));
    },
  };
}
