/**
 * The command a host runs for Forma's MCP server, in one process
 * (2026-11-24, the MCP work's wave 3; findings TST-3 and PS-8):
 *
 *   node <clone>/src/mcp/run.mjs
 *
 * Plain JavaScript, so plain node runs it from any working folder: it
 * registers tsx's loader, which is resolved from this file and so from the
 * clone's node_modules whatever folder the host starts the server in, and
 * then loads the entry, stdio.ts, whose first act is the stdout guard.
 *
 * Why not the tsx CLI (`node <clone>/node_modules/tsx/dist/cli.mjs
 * stdio.ts`), the first form documented: that runs two processes. The CLI
 * spawns the server as a child, and listens on a named pipe for its own
 * messages, parsing each frame with no guard, so the process a host
 * started opened a listener (against "stdio only, no listener", PRD
 * section 6) and one malformed frame from any process of the same user
 * ended it (measured in the wave-3 review). Registered this way, tsx opens
 * no listener; its loader only tries to reach a parent tsx CLI's pipe,
 * finds none, and goes on.
 *
 * The loader is given the clone's own tsconfig.json (2026-11-24, finding
 * CLI-8 of the command line's design audit). Given none, tsx applies the
 * tsconfig.json of the working folder, which is the user's project: its
 * `paths` reach every package Forma's sources import, each bare specifier
 * (zod and the SDKs among them), whatever its `include` says (one sending
 * zod to a stub that throws kept the server from starting, measured on
 * 2026-11-24, and stdio.test.ts starts it from such a folder), and its
 * compiler settings reach Forma's sources when that project's tsconfig
 * takes the clone in, as a CI job's checkout inside it can (tsx 4.23.15
 * applies them only to the files a tsconfig includes, and `paths` to no
 * relative import). The path is built from
 * import.meta.dirname, so this file still imports nothing but tsx's
 * loader, and never from TSX_TSCONFIG_PATH, which would have a launcher
 * touch the environment. worker.mjs and genWorker.mjs do the same.
 *
 * Nothing else belongs here: whatever is imported before the guard could
 * write to stdout before anything stops it.
 *
 * Pure ASCII.
 */
import { register } from 'tsx/esm/api';

register({ tsconfig: import.meta.dirname + '/../../tsconfig.json' });
await import('./stdio.ts');
