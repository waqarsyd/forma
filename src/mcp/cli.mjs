/**
 * The command a person or a CI step runs for Forma's command line, in one
 * process (2026-11-24, the CLI and Forma Designer work's wave 4; findings
 * CLI-1, CLI-8, DOC-1 and TEST-1 of its design audit):
 *
 *   node <clone>/src/mcp/cli.mjs <command> [options]
 *
 * run.mjs's form, for the same reasons: plain JavaScript, so plain node
 * runs it from any working folder; it registers tsx's loader, which is
 * resolved from this file and so from the clone's node_modules, with the
 * clone's own tsconfig.json named (CLI-8: given none, tsx applies the one in
 * the folder the command runs in, a user's project or a CI checkout, whose
 * `paths` reach every package Forma imports), and then loads the entry,
 * cliEntry.ts, whose first act is the stdout guard. Never the tsx CLI, which
 * runs two processes and opens a pipe, never `npx tsx`, which outside the
 * clone fetches an unpinned tsx, and never an npm script, whose banner goes
 * to stdout and which runs the nearest package.json's script, the user's
 * own (run.mjs's header has each measured).
 *
 * The arguments after this file's path are the command line's
 * (process.argv.slice(2), read in the entry), so nothing here looks at them.
 * Nothing else belongs here: whatever is imported before the guard could
 * write to stdout before anything stops it.
 *
 * Pure ASCII.
 */
import { register } from 'tsx/esm/api';

register({ tsconfig: import.meta.dirname + '/../../tsconfig.json' });
await import('./cliEntry.ts');
