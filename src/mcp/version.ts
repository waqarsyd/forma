/**
 * Forma's version, as both of its Node entries say it (2026-11-24, the CLI
 * and Forma Designer work's wave 2, finding CLI-2): the number in the
 * clone's package.json, the same one the release notes carry. It lived in
 * formaServer.ts, which loads the MCP SDK, so the command line had no way to
 * it without the server; formaServer.ts re-exports it.
 *
 * Pure ASCII.
 */
import { readFileSync } from 'node:fs';

/** Forma's version, from package.json. */
export function formaVersion(): string {
  return (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
}
