/**
 * The worker thread the MCP server's AI tools run in (2026-11-24, the MCP
 * work's wave 8; generator.ts starts it and says why). Plain JavaScript, as
 * worker.mjs is, because a new thread starts with none of its parent's
 * loaders: it registers tsx's loader in this thread, resolved from this file
 * and so from the clone's node_modules, with the clone's own tsconfig.json
 * named, as run.mjs does and says why (CLI-8), then loads genJobs.ts, makes
 * one runner from the setup it was started with (`workerData`: the mock switch,
 * the model pin, the locale) and answers each job the generator posts, by
 * its id: the work's events as it goes, then the result or how it failed. A
 * cancellation ends the thread from outside, so nothing here listens for
 * one. It reads no environment variable; the keys come with each job's
 * settings, and what the modules it runs log goes to this thread's stdout
 * and stderr, which the generator sends to the server's log on stderr
 * through the scrubber.
 *
 * Outside the coverage measure, as worker.mjs is: v8 coverage does not
 * follow a worker thread. The runner is measured where the tests run it in
 * their own thread.
 *
 * Pure ASCII.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { register } from 'tsx/esm/api';

register({ tsconfig: import.meta.dirname + '/../../tsconfig.json' });
const { makeRunner, genFailure } = await import('./genJobs.ts');
const runner = makeRunner(workerData);
const never = new AbortController().signal;

parentPort.on('message', async ({ id, job }) => {
  try {
    const value = await runner.run(job, never, (event) => parentPort.postMessage({ id, event }));
    parentPort.postMessage({ id, ok: true, value });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, ...genFailure(error) });
  }
});
