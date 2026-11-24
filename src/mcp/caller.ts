/**
 * What every caller of Forma's Node side is told, whoever it is (2026-11-24,
 * the CLI and Forma Designer work's wave 2; findings CLI-2 and CLI-10 of its
 * design audit, `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`):
 * the MCP server's host, through toolShape.ts, and the command line, which is
 * to come in that work's wave 4.
 *
 * - `ToolRefusal`, a refusal whose words were written for whoever called,
 *   sent as they are (keys still taken out). It lived in toolShape.ts until
 *   this wave, which loads zod and names the MCP SDK; the modules on the
 *   command line's way (paths.ts aside, reportFile.ts, reportCalls.ts,
 *   generator.ts, workerPool.ts and the work the two threads run) import it
 *   from here, so none of them loads either, which boundaries.test.ts holds.
 *   toolShape.ts re-exports it, one class, so `instanceof` holds across both.
 * - `AiFailure`, the refusal when the AI made nothing, which also carries the
 *   limit it met as data (since that work's wave 3): a `ToolRefusal`, so the
 *   server says its words and nothing else, as before.
 * - `MAX_FILE_TEXT`, the longest single string read from a file that a
 *   result carries (reportFile.ts `fileLines` folds lines to it, and
 *   `clippedFromFile` clips what goes under `fromFile` to it).
 * - `scrubbed` and `clippedFromFile`, the one way a result is made safe to
 *   show (the wave-8 review's W8C-1, moved here from toolShape.ts in the
 *   wave-2 review, SEC-W2-3): every string with the caller's keys taken out,
 *   and the text read from files with its keys taken out first and only then
 *   folded and clipped, since a key cut in two is neither its value nor a
 *   whole key's shape. What reportCalls.ts returns is unscrubbed, the AI's
 *   failure and reply as they came from the work's thread, which has no
 *   scrubber; toolShape.ts's `shapeResult` passes every result through these
 *   two, and the command line is to, rather than keep a copy of the order.
 * - `Voice`, who the words are for: a host's model (`mcp`) or a person at a
 *   command line or a CI log (`cli`). The few phrases that differ are chosen
 *   by it (CLI-10): where to send a path and which program never opens a
 *   share (paths.ts, by the scope), where the AI's settings go and how to
 *   start again (aiSettings.ts, by the voice the settings were read in), the
 *   PDF command's name, the label the stand-in fonts are listed under and a
 *   login's notice (genJobs.ts, pipeline.ts and reportFile.ts, the voice
 *   carried in each job as data, since a function cannot cross to a worker),
 *   what turned the mock on (reportCalls.ts), and what one piece of work is
 *   called when a bound ends it (workerPool.ts, generator.ts); the rest of
 *   what Forma says is the same to both. The server's words are exactly what
 *   they were, and cliVoice.test.ts holds the command line's to none of the
 *   server's.
 *
 * Pure ASCII.
 */
import type { AiLimit } from '../lib/aiLimit';

/** A refusal whose words were written for whoever called: sent as they are (keys still taken out). */
export class ToolRefusal extends Error {}

/**
 * The refusal when the AI made nothing (2026-11-24, the CLI and Forma
 * Designer work's wave 3; findings GAP3-2 and CLI-4, the owner's decision
 * OC5): its words as any refusal's, which the server sends as before, and
 * the limit the AI met as data (lib/aiLimit.ts `limitOf`, worked out
 * in the work's thread from the error itself), so the command line's batch
 * can wait a minute's limit out or stop at the day's; null when the failure
 * was not a limit.
 */
export class AiFailure extends ToolRefusal {
  readonly limit: AiLimit | null;
  constructor(message: string, limit: AiLimit | null) {
    super(message);
    this.limit = limit;
  }
}

/** The call was stopped (a host's cancellation, Ctrl+C at a command line) before anything was written. */
export class CallStopped extends Error {
  constructor() {
    super('cancelled');
  }
}

/** The longest single string read from a file that a result carries. */
export const MAX_FILE_TEXT = 200;

/** Every string in a value with `redact` applied (lib/keyRedact.ts `redactorFor`, the caller's keys); the value's shape kept. */
export function scrubbed<T>(value: T, redact: (text: string) => string): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => scrubbed(v, redact)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubbed(v, redact)])) as T;
  return value;
}

/** Folds whitespace and clips every string under a value to MAX_FILE_TEXT. Never on its own: a key must be out first. */
function clipped(value: unknown): unknown {
  if (typeof value === 'string') {
    const folded = value.replace(/\s+/g, ' ').trim();
    return folded.length > MAX_FILE_TEXT ? `${folded.slice(0, MAX_FILE_TEXT)}...` : folded;
  }
  if (Array.isArray(value)) return value.map(clipped);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clipped(v)]));
  return value;
}

/** Text read from files, as a result carries it: its keys taken out, then every string folded and clipped, never the other way round (W8C-1). */
export function clippedFromFile(value: unknown, redact: (text: string) => string): unknown {
  return clipped(scrubbed(value, redact));
}

/** Who Forma's words are for: an MCP host's model, or a person at a command line. */
export type Voice = 'mcp' | 'cli';
