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
 * Nothing else belongs here: whatever is imported before the guard could
 * write to stdout before anything stops it.
 *
 * Pure ASCII.
 */
import { register } from 'tsx/esm/api';

register();
await import('./stdio.ts');
