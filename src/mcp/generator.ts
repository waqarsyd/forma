/**
 * Where the MCP server's AI tools run, one at a time, and what they tell the
 * host while they run (2026-11-24, the MCP work's wave 8; findings PROTO-3,
 * PROTO-4, PROTO-7 and GAP3-3 of the 2026-11-23 design audit, and the owner's
 * decision OD7).
 *
 * ## A worker thread with a generation's bounds
 *
 * `workerGenerator` runs genJobs.ts's runner in a worker thread
 * (genWorker.mjs), never on the thread that answers the protocol: pdf.js
 * parses a PDF on the thread that calls it, and the wave-7 review measured
 * one PDF ending a process out of heap and another stalling its event loop
 * for 13.8 seconds at a time (nodeIntake.ts's header). The thread gets
 * `GEN_LIMITS`: 2 GB of heap and a deadline of 15 minutes, far past
 * workerPool.ts's 30 seconds, since one report may cost six requests and the
 * fidelity benchmark recorded single runs of four minutes. Running out of
 * memory or passing the deadline ends the thread and becomes a refusal in
 * plain words, the job's own (its voice, since the CLI and Forma Designer
 * work's wave 2, CLI-10); a cancellation ends it at once, so no request goes
 * out after it and nothing it made is written (PROTO-4). One thread is kept idle
 * between calls, unref'd so it never holds the process open, with Forma's
 * models already read; a thread ended for any reason is replaced by the
 * next call. Its stdout and stderr are its own, read here line by line into
 * the server's log on stderr, through the scrubber (stdoutGuard.ts). A
 * job's files are moved to the thread, not copied (the wave-8 review's
 * W8C-6).
 *
 * ## A thread per job (the command line's batch)
 *
 * With `fresh` (the CLI and Forma Designer work's wave 3, CLI-12, the
 * owner's decision OC2: "each file in its own bounded worker so one bad file
 * cannot end the batch") no thread is kept: each job starts one, which is
 * ended when the job ends, and the job's answer is given only once it has
 * ended, so the next job's thread never runs beside it. A kept thread
 * carries from one file to the next what `resourceLimits` does not bound
 * (ArrayBuffers, the canvas's and onnxruntime's native memory) and every
 * module's state. Measured on 2026-11-24 with the same mock generate job on
 * one drawn page, four times each way
 * (`DevFiles/forma-model-data-kept-not-in-git/forma-model-data/work/cd-wave3/measure-fresh.txt`):
 * a fresh thread costs about 1.6 seconds a file with Tesseract (0.55 to start
 * and assemble Node's parts, 0.9 for Tesseract's first start) and about 0.7
 * to 1 with PaddleOCR, and 21 to 161 ms to end; the process stayed at 165 to
 * 236 MB between files, where a kept thread left it at 450 MB with Tesseract
 * and 1.7 GB with PaddleOCR. A report from a real AI takes tens of seconds
 * at least. What a thread learned about the AI's limits outlives it: each
 * limit's park is kept in Forma's folder as it happens (modelParks.ts), so a
 * new thread asks no model one before it found spent; the day's model
 * choice already was (nodeGeneration.ts). The server leaves it off: its
 * thread, kept idle, answers the next call without the start.
 *
 * ## A queue of one (OD7, PROTO-7)
 *
 * The spec asks a server to rate-limit its tools, and one report can spend a
 * free day's requests on the user's own key, so `oneAtATime` lets one AI
 * call run in the whole process, whichever connection asked: a second waits,
 * told "Waiting for the report before it to finish." through its progress,
 * until the first ends; one cancelled while it waits leaves the queue and
 * never runs. A generate_report call that waits holds its words and the
 * paths it was sent, not its files, up to twelve of 20 MB: a job given as a
 * function (`JobSource`) is made, and the files read, only once the call has
 * its turn (W8C-6). revise_report reads its one report before it waits,
 * since the report is judged by its text. Approval is left to the host's own
 * permission prompt: no tool asks for a person on every call (no
 * requiresUserInteraction).
 *
 * ## Progress that only goes up (PROTO-3)
 *
 * `progressReporter` turns the work's stages into the spec's progress
 * notifications, which must increase with every one: each stage owns a
 * fixed part of 0 to 100 (`STAGES`), the AI's streamed answer moves within
 * its own part, and a value at or below the last one sent is never sent, so
 * a retry, the print check's second answer or the coverage re-ask, each of
 * which starts the stream's count from nothing again, sends nothing until it
 * passes the mark. While nothing happens, a beat every 15 seconds still
 * raises the value a little, by a twentieth of what is left of the part, so
 * a host that counts silence (Claude Code allows 30 minutes on stdio) sees
 * the call alive. Within a stage at most one a second, while each stage's
 * start is sent at once, so two can follow each other closely ("Starting."
 * then "Reading the files."); none before a stage begins; none after the
 * result (`stop`). Sent only when the request carried a
 * progressToken (aiTools.ts). Progress does not lift a host's own cap:
 * Claude Desktop on Windows reportedly ends any call at about four minutes
 * (GAP3-3), and a report still running then is finished and written all the
 * same unless the host cancels it, and the server's log on stderr says where.
 *
 * Pure ASCII.
 */
import { Worker } from 'node:worker_threads';
import { ToolRefusal, type Voice } from './caller';
import type { GenDone, GenEvent, GenJob, GenSetup, GenStage } from './genJobs';
import { ONE_CALL, toLog, workerError, type PipelineLimits } from './workerPool';

/**
 * A job, or what makes it once the call has its turn (the wave-8 review's
 * W8C-6): generate_report's files are read then, so a call waiting behind
 * another holds none of their bytes.
 */
export type JobSource = GenJob | (() => GenJob | Promise<GenJob>);

/** The job a source makes; a refusal it throws is the call's. */
export const jobOf = async (source: JobSource): Promise<GenJob> => (typeof source === 'function' ? source() : source);

/** What runs the AI tools' jobs: genJobs.ts's runner, in a worker or (for tests) in this thread. */
export interface Generator {
  /** Null when stopped. A job given as a function is made only when the call runs, never while it waits. */
  run(job: JobSource, signal: AbortSignal, tell: (event: GenEvent) => void): Promise<GenDone | null>;
  close(): Promise<void>;
}

/** The buffers a job's files can be moved in rather than copied: each one a file's own (W8C-6). */
function movable(job: GenJob): ArrayBuffer[] {
  if (job.kind !== 'generate') return [];
  const own = job.files.filter((f) => f.bytes.byteOffset === 0 && f.bytes.byteLength === f.bytes.buffer.byteLength).map((f) => f.bytes.buffer as ArrayBuffer);
  return [...new Set(own)];
}

/** How long one AI call may take, and how much memory its thread may use. */
export const GEN_LIMITS: PipelineLimits = { deadlineMs: 15 * 60_000, heapMb: 2048, stackMb: 4 };

/** The refusal when an AI call passes its deadline, in the job's words (the server's by default; CLI-10). */
export const genTooLong = (ms: number, voice: Voice = 'mcp') =>
  `Forma stopped working on this report after ${Math.round(ms / 60_000)} minutes, the longest ${ONE_CALL[voice]} may take. The AI may be slow or out of reach; try again later, or with fewer pages. Nothing was written.`;

/** The refusal when an AI call runs out of memory, in the job's words. */
export const genTooMuchMemory = (mb: number, voice: Voice = 'mcp') =>
  `Forma stopped working on this report when it needed more than ${mb} MB of memory, the most ${ONE_CALL[voice]} may use. A file this costly to read is usually damaged, or far larger than a report needs; ${voice === 'cli' ? 'give' : 'send'} fewer or smaller files. Nothing was written.`;

/** What the work's thread is called in an error for the log, by whose it is. */
const WORKER_NAME: Record<Voice, string> = { mcp: "the AI tools' worker", cli: "the AI's worker" };

const GEN_WORKER_FILE = new URL('./genWorker.mjs', import.meta.url);

type Reply = { id: number; event: GenEvent } | { id: number; ok: true; value: GenDone | null } | { id: number; ok: false; refusal?: string; error?: string };

export interface WorkerGeneratorOptions {
  setup: GenSetup;
  /** A line on the server's log, stderr. */
  log(line: string): void;
  limits?: Partial<PipelineLimits>;
  /**
   * Each job in a thread of its own, ended when the job ends and before its
   * result is given (the header's *A thread per job*): for the command line's
   * batch, its wave 4. The server leaves it off and keeps one idle.
   */
  fresh?: boolean;
  /** Starts a worker; genWorker.mjs with the limits by default. A test starts one of its own. */
  spawn?(limits: PipelineLimits, setup: GenSetup): Worker;
}

/** The generator the server runs: one worker thread at a time, kept idle between calls, or with `fresh` one per job (the header). */
export function workerGenerator(options: WorkerGeneratorOptions): Generator {
  const limits: PipelineLimits = { ...GEN_LIMITS, ...options.limits };
  const fresh = options.fresh === true;
  const spawn =
    options.spawn ??
    ((l: PipelineLimits, setup: GenSetup) =>
      new Worker(GEN_WORKER_FILE, { workerData: setup, resourceLimits: { maxOldGenerationSizeMb: l.heapMb, stackSizeMb: l.stackMb }, stdout: true, stderr: true }));
  let idle: Worker | null = null;
  const busy = new Set<Worker>();
  let next = 0;
  let closed = false;

  const start = () => {
    const worker = spawn(limits, options.setup);
    toLog(worker.stdout, options.log);
    toLog(worker.stderr, options.log);
    worker.on('error', () => {});
    worker.on('exit', () => {
      if (idle === worker) idle = null;
    });
    return worker;
  };

  return {
    async run(source: JobSource, signal: AbortSignal, tell: (event: GenEvent) => void): Promise<GenDone | null> {
      if (closed) throw new Error('the generator is closed');
      if (signal.aborted) return null;
      const job = await jobOf(source);
      return new Promise<GenDone | null>((resolve, reject) => {
        if (closed) return reject(new Error('the generator is closed'));
        if (signal.aborted) return resolve(null);
        const worker = idle ?? start();
        idle = null;
        busy.add(worker);
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
          busy.delete(worker);
          if (keep && fresh) {
            // Its answer is given once the thread has ended, so the next job's never runs beside it (the header).
            worker.terminate().then(settle, settle);
            return;
          }
          if (keep && !closed && !idle) {
            worker.unref();
            idle = worker;
          } else void worker.terminate();
          settle();
        };
        const onMessage = (reply: Reply) => {
          if (reply.id !== id) return;
          if ('event' in reply) {
            if (!signal.aborted) tell(reply.event);
          } else if (reply.ok) end(true, () => resolve(reply.value));
          else if (reply.refusal !== undefined) end(true, () => reject(new ToolRefusal(reply.refusal)));
          else end(false, () => reject(workerError(reply.error)));
        };
        const onError = (error: Error & { code?: string }) =>
          end(false, () => reject(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new ToolRefusal(genTooMuchMemory(limits.heapMb, job.voice)) : error));
        const onExit = (code: number) => end(false, () => reject(new Error(`${WORKER_NAME[job.voice] ?? WORKER_NAME.mcp} stopped before it answered (exit code ${code})`)));
        // Ended at once: no request goes out after a cancellation, and what it made is never written.
        const onAbort = () => end(false, () => resolve(null));
        const timer = setTimeout(() => end(false, () => reject(new ToolRefusal(genTooLong(limits.deadlineMs, job.voice)))), limits.deadlineMs);
        worker.on('message', onMessage);
        worker.on('error', onError);
        worker.on('exit', onExit);
        signal.addEventListener('abort', onAbort, { once: true });
        // The files' bytes are moved to the thread, not copied (W8C-6); a buffer that cannot be moved is copied as before.
        const post = (transfer: ArrayBuffer[]) => worker.postMessage({ id, job }, transfer);
        try {
          post(movable(job));
        } catch {
          try {
            post([]);
          } catch (error) {
            end(false, () => reject(error));
          }
        }
      });
    },

    async close() {
      closed = true;
      const all = [...busy, ...(idle ? [idle] : [])];
      idle = null;
      busy.clear();
      await Promise.all(all.map((worker) => worker.terminate()));
    },
  };
}

/** A generator that lets one call run at a time in the process, the rest waiting in order (the header). */
export function oneAtATime(inner: Generator): Generator & { readonly busy: boolean; readonly waiting: number } {
  let running = false;
  const queue: (() => void)[] = [];
  const release = () => {
    const next = queue.shift();
    if (next) next();
    else running = false;
  };
  return {
    async run(job, signal, tell) {
      if (signal.aborted) return null;
      if (running) {
        tell({ stage: 'waiting' });
        const turn = await new Promise<boolean>((resolve) => {
          const go = () => {
            signal.removeEventListener('abort', onAbort);
            resolve(true);
          };
          const onAbort = () => {
            const at = queue.indexOf(go);
            if (at >= 0) queue.splice(at, 1);
            resolve(false);
          };
          queue.push(go);
          signal.addEventListener('abort', onAbort, { once: true });
        });
        // Cancelled while it waited: it never held the turn, so it gives none back.
        if (!turn) return null;
      } else running = true;
      try {
        if (signal.aborted) return null;
        tell({ stage: 'starting' });
        return await inner.run(job, signal, tell);
      } finally {
        release();
      }
    },
    close: () => inner.close(),
    get busy() {
      return running;
    },
    get waiting() {
      return queue.length;
    },
  };
}

/** Each stage's part of 0 to 100, and what a progress notification says while it runs. */
export const STAGES: Readonly<Record<GenStage, { from: number; to: number; message: string }>> = {
  waiting: { from: 0, to: 2, message: 'Waiting for the report before it to finish.' },
  starting: { from: 2, to: 4, message: 'Starting.' },
  reading: { from: 4, to: 15, message: 'Reading the files.' },
  drafting: { from: 15, to: 25, message: "Making Forma's draft." },
  asking: { from: 25, to: 85, message: 'Waiting for the AI.' },
  checking: { from: 85, to: 97, message: 'Checking the report.' },
  writing: { from: 97, to: 99, message: 'Writing the report.' },
};

/** The total every progress notification names. */
export const PROGRESS_TOTAL = 100;

/** One progress notification's content. */
export interface Progress {
  progress: number;
  total: number;
  message: string;
}

export interface ProgressOptions {
  /** How long a silence lasts before a beat raises the value; 15 seconds. */
  heartbeatMs?: number;
  /** The least time between two notifications, a stage's start aside; 1 second. */
  gapMs?: number;
  now?: () => number;
}

/**
 * The work's events as progress that only goes up (the header). `send` is
 * null when the request carried no progressToken: then nothing is sent, and
 * no timer runs.
 */
export function progressReporter(send: ((progress: Progress) => void) | null, options: ProgressOptions = {}): { tell(event: GenEvent): void; stop(): void } {
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const gapMs = options.gapMs ?? 1000;
  const now = options.now ?? Date.now;
  let stage: GenStage | null = null;
  let mark = 0;
  let ceiling = 0;
  let last = -1;
  let lastAt = 0;
  let stopped = !send;

  const emit = (value: number, force: boolean) => {
    if (stopped || !send) return;
    const rounded = Math.floor(value * 100) / 100;
    if (rounded <= last) return;
    const at = now();
    if (!force && at - lastAt < gapMs) return;
    last = rounded;
    lastAt = at;
    send({ progress: rounded, total: PROGRESS_TOTAL, message: STAGES[stage ?? 'starting'].message });
  };
  /** A twentieth of what is left of the furthest part reached. */
  const bump = () => mark + (ceiling - mark) * 0.05;

  const timer = send
    ? setInterval(() => {
        if (stopped || stage === null || now() - lastAt < heartbeatMs) return;
        mark = bump();
        emit(mark, true);
      }, Math.max(250, Math.min(heartbeatMs, 5000)))
    : null;
  timer?.unref();

  return {
    tell(event) {
      if (stopped) return;
      if ('percent' in event) {
        const part = STAGES.asking;
        const within = part.from + (part.to - part.from) * Math.min(1, Math.max(0, event.percent / 95)) * 0.99;
        if (stage !== 'asking' || within <= mark) return;
        mark = within;
        emit(mark, false);
        return;
      }
      stage = event.stage;
      const part = STAGES[event.stage];
      ceiling = Math.max(ceiling, part.to);
      mark = part.from > mark ? part.from : bump();
      emit(mark, true);
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}
