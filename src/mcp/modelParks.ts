/**
 * The models a limit parked, kept beyond the thread that met it (2026-11-24,
 * the CLI and Forma Designer work's wave 3; findings GAP3-1 and CLI-12 of its
 * design audit, `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`,
 * and the owner's decision OC2).
 *
 * ## Why a file
 *
 * On a limit (a 429) geminiService parks the model it asked, for the wait
 * Google states or until midnight Pacific for the day's allowance, and moves
 * to the next model the key can call (lib/modelCache.ts, *Overload
 * cooldown*). The park lived in memory alone, so it lasted only while one
 * thread did. The command line is to make each file of a batch in a thread of
 * its own (generator.ts `fresh`, OC2), and the MCP server's thread ends on a
 * cancellation, a deadline or a crash: each new thread began on the model the
 * last one had found spent, and asked it again, a request out of the file's
 * budget for every model already spent today (the audit measured five
 * requests where one was enough). So each limit's park is also kept here, in
 * Forma's own folder beside the model probe's file (nodeGeneration.ts), at
 * the moment it happens: never handed over in a thread's result, which is
 * lost when the thread is killed. A thread lays the parks for its key into
 * memory whenever it resolves a model (geminiService `resolveModel`), the
 * first time and after, so it also sees what another process learned since.
 *
 * ## What is in it
 *
 * `{ "<key's tag>": { "<model>": { "kind": "daily", "until": <ms> } } }`:
 * the key's 32-bit FNV-1a tag (modelCache.ts `keyTag`), as the model probe's
 * file keeps it, and never the key; the model; which limit (geminiErrors.ts
 * `quotaKind`); the instant it lifts. A park that has lifted is not read and
 * is gone from the file at the next write, so it holds only live parks. One
 * further off than 25 hours, the longest day, is not read either: no limit
 * lasts longer, so it is a damaged entry or a clock put back. A file that
 * will not read, or an entry
 * of the wrong shape, is skipped, never an error: a park is advice, and
 * without it a thread costs what every thread cost before this file. An
 * overload's park (a 503) is not kept here: it is a fact about the last
 * minute, not the key, and stays in memory, as modelCache.ts decided.
 *
 * ## Two writers
 *
 * The MCP server and the fidelity benchmark share the file, and the command
 * line is to (its wave 4), so two processes can add a park at once. Each write reads the
 * file just before it, adds its park, and writes the whole file under a name
 * of its own (the process and the thread), then renames it into place, so a
 * reader always reads one writer's whole file and never half of one. What
 * two writers can still do is lose an update: both read, both add, and the
 * second rename wins, without the first writer's park. That is harmless by
 * construction, which is why there is no lock to leave behind when a thread
 * is killed: a lost update drops a park, it never invents or lengthens one,
 * so no model is skipped that could answer; the thread that met the limit
 * still holds its park in memory; and the next thread that starts on that
 * model asks it once, Google answers 429 again with the same reset, and the
 * park is kept again: what every new thread cost for every spent model before
 * this file, now for one model, once.
 *
 * A park can be lost a second way, on Windows (the wave's review, W3R-4):
 * a rename onto the file is refused (EPERM, EACCES or EBUSY) while another
 * process has it open at that moment, a reader included, and another thread
 * reads it whenever it resolves a model. Measured on Windows 11 with Node 24
 * (the review's stress runs, 2026-11-24): one writer alone never met it,
 * while two writing 200 parks each at once had about half their renames
 * refused, and a writer beside a reader reading without a pause five in
 * six. So a refused rename is tried again, `RENAME_TRIES` times in all,
 * waiting 10 ms more before each, up to 50 ms (350 ms at the most, on the
 * thread that met the limit); run again so, the two writers lost none of
 * 400, and the writer beside that reader one in twelve. One still refused
 * then throws, and the park is kept in memory only, at the same cost as a
 * lost update and no other. No reader ever saw part of a file.
 *
 * ## The day's reset
 *
 * Only Google's limits are parked (geminiService parks no model of another
 * AI, which it never replaces), so a day's park lifts at midnight Pacific.
 * The store tells modelCache.ts when that is (`dailyReset`), on the zone's
 * own calendar (lib/aiLimit.ts `msUntilPacificReset`), and the park is kept,
 * in memory and here, until then: the browser's count, 24 hours less the time
 * since midnight, is an hour out on the two days a year the clocks change,
 * which would leave every model skipped an hour after Google reset, or ask
 * each an hour early (the wave's review, W3R-3). That day is 25 hours long,
 * so a park is read up to `LONGEST_PARK_MS` ahead.
 *
 * ## When a key can next be asked
 *
 * `limitAfterParks` lays the kept parks over the limit an error is
 * (lib/aiLimit.ts `limitOf`, which reads only the error the service
 * threw: the last model it asked). When every model the key can call is
 * parked for a limit, the one that lifts soonest decides when the key can be
 * asked again, and its kind is the limit's: a batch whose last model met the
 * day's limit while another model's minute ends in half a minute waits that
 * half minute rather than stopping for the day (OC5).
 *
 * Pure ASCII.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { threadId } from 'node:worker_threads';
import { msUntilPacificReset, type AiLimit } from '../lib/aiLimit';
import type { ModelPark, ParkStore } from '../lib/modelCache';

/** The file's name in Forma's folder, beside the model probe's `model-choice.json`. */
export const PARKS_FILE = 'model-parks.json';

/**
 * The longest a park is read: the day's allowance lifts at midnight Pacific,
 * never further off than the longest day, the 25 hours of the day the clocks
 * go back (the header's *The day's reset*).
 */
export const LONGEST_PARK_MS = 25 * 60 * 60 * 1000;

/** How many times a rename refused for a moment is tried, in all (the header's *Two writers*). */
export const RENAME_TRIES = 10;

/** The refusals Windows gives a rename onto a file another process has open at that moment: worth trying again. */
const BRIEFLY_REFUSED = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Waits `ms` on this thread, as a synchronous write must (a worker's or the main thread's; never a browser's). */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Renames `from` onto `to`, trying again when Windows refuses for a moment
 * (the header's *Two writers*): `RENAME_TRIES` in all, waiting 10 ms more
 * before each, up to 50 ms; any other failure, or the last refusal, is
 * thrown.
 */
function renameInto(from: string, to: string, rename: (from: string, to: string) => void): void {
  for (let tried = 1; ; tried++) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      if (tried >= RENAME_TRIES || !BRIEFLY_REFUSED.has((err as { code?: string } | null)?.code ?? '')) throw err;
      pause(Math.min(10 * tried, 50));
    }
  }
}

const KINDS: readonly ModelPark['kind'][] = ['daily', 'per-minute', 'unknown'];

type Kept = Record<string, Record<string, { kind: ModelPark['kind']; until: number }>>;

/** One entry as kept, or null when it is of the wrong shape, has lifted by `now`, or lifts further off than `LONGEST_PARK_MS`. */
function live(entry: unknown, now: number): { kind: ModelPark['kind']; until: number } | null {
  if (!entry || typeof entry !== 'object') return null;
  const { kind, until } = entry as { kind?: unknown; until?: unknown };
  if (!KINDS.includes(kind as ModelPark['kind']) || typeof until !== 'number' || !Number.isFinite(until)) return null;
  return until > now && until <= now + LONGEST_PARK_MS ? { kind: kind as ModelPark['kind'], until } : null;
}

/** What the file keeps that is live at `now`, every tag's; a file missing, damaged or of the wrong shape is empty. */
function readLive(path: string, now: number): Kept {
  let all: unknown;
  try {
    all = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
  const kept: Kept = {};
  if (!all || typeof all !== 'object' || Array.isArray(all)) return kept;
  for (const [tag, models] of Object.entries(all as Record<string, unknown>)) {
    if (!models || typeof models !== 'object' || Array.isArray(models)) continue;
    for (const [model, entry] of Object.entries(models as Record<string, unknown>)) {
      const park = model ? live(entry, now) : null;
      if (park) (kept[tag] ??= {})[model] = park;
    }
  }
  return kept;
}

/**
 * The parks in one JSON file (the header): read for a key's tag, and added to
 * as each happens, the whole file written under a name of its own and renamed
 * into place, a rename refused for a moment tried again. `add` throws when
 * the file cannot be written; modelCache.ts keeps the park in memory then.
 * `dailyReset` is when a day's park lifts (the header's *The day's reset*).
 * `rename` stands in for the file system's, for a test.
 */
export function fileParks(path: string, rename: (from: string, to: string) => void = renameSync): ParkStore {
  return {
    read: (tag, now) => Object.entries(readLive(path, now)[tag] ?? {}).map(([model, { kind, until }]) => ({ model, kind, until })),
    add: (tag, park, now) => {
      const kept = readLive(path, now);
      const was = kept[tag]?.[park.model];
      // The later of the two, with its kind: a park only ever keeps a model skipped for as long as some limit said.
      if (!was || was.until < park.until) (kept[tag] ??= {})[park.model] = { kind: park.kind, until: park.until };
      mkdirSync(dirname(path), { recursive: true });
      const part = `${path}.${process.pid}-${threadId}.part`;
      try {
        writeFileSync(part, JSON.stringify(kept));
        renameInto(part, path, rename);
      } finally {
        rmSync(part, { force: true });
      }
    },
    dailyReset: (now) => now + msUntilPacificReset(new Date(now)),
  };
}

/**
 * The limit an error is (`limit`, from lib/aiLimit.ts `limitOf`), with
 * the kept parks laid over it (the header's *When a key can next be asked*):
 * for Gemini, when every model in `usable` (the models the key can call,
 * modelCache.ts `readCachedModelSet`) is parked for a limit, the park that
 * lifts soonest, its kind and its wait. Otherwise the limit as it was: no
 * limit, another AI's, a model pinned (never parked), no models known, or a
 * model the parks leave free, so they do not explain the failure.
 */
export function limitAfterParks(limit: AiLimit | null, parks: readonly ModelPark[], usable: readonly string[] | null, now: number = Date.now()): AiLimit | null {
  if (!limit || limit.provider !== 'gemini' || !usable?.length) return limit;
  const latest = new Map<string, ModelPark>();
  for (const park of parks) if (park.until > now && (latest.get(park.model)?.until ?? 0) < park.until) latest.set(park.model, park);
  let soonest: ModelPark | null = null;
  for (const model of usable) {
    const park = latest.get(model);
    if (!park) return limit;
    if (!soonest || park.until < soonest.until) soonest = park;
  }
  return soonest ? { kind: soonest.kind, waitMs: soonest.until - now, provider: 'gemini' } : limit;
}
