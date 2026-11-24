/**
 * The worker thread a report tool's work runs in (2026-11-24, the wave-4
 * review's REV4-3; workerPool.ts starts it and says why). Plain JavaScript,
 * as run.mjs is, because a new thread starts with none of its parent's
 * loaders: it registers tsx's loader in this thread, resolved from this
 * file and so from the clone's node_modules, with the clone's own
 * tsconfig.json named, as run.mjs does and says why (CLI-8), then loads
 * pipeline.ts and answers each job the pool posts, by its id, with the
 * result or how it failed. It reads no environment variable and writes
 * nothing but its answers; what the modules it runs log goes to this
 * thread's stdout and stderr, which the pool sends to the server's log on
 * stderr.
 *
 * Outside the coverage measure, as run.mjs is: v8 coverage does not follow
 * a worker thread. `runJob` is measured where the tests run it in their own
 * thread.
 *
 * Pure ASCII.
 */
import { parentPort } from 'node:worker_threads';
import { register } from 'tsx/esm/api';

register({ tsconfig: import.meta.dirname + '/../../tsconfig.json' });
const { runJob, jobFailure } = await import('./pipeline.ts');

parentPort.on('message', async ({ id, job }) => {
  try {
    parentPort.postMessage({ id, ok: true, value: await runJob(job) });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, ...jobFailure(error) });
  }
});
