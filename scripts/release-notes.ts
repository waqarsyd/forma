/**
 * What scripts/deploy.mjs needs to make a GitHub release (2026-11-08, site
 * audit item 43), as one line of JSON on stdout:
 *
 *   npx tsx scripts/release-notes.ts 1.1.0
 *   {"newest":"1.1.0","notes":"## A chat that keeps its word ..."}
 *
 * `newest` is the version the newest release in src/lib/releases.ts carries
 * (null when it carries none); `notes` are the release's notes when that is
 * the version asked for, and empty otherwise. A script of its own because
 * deploy.mjs is plain Node and releases.ts is TypeScript. Pure ASCII.
 */
import { RELEASES, releaseNotes } from '../src/lib/releases';

const asked = process.argv[2] ?? '';
const newest = RELEASES[0]?.version ?? null;
process.stdout.write(JSON.stringify({ newest, notes: newest === asked ? releaseNotes(asked) : '' }) + '\n');
