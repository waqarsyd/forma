/**
 * The two things a user does with a report library: fill it, and use it.
 *
 * Milestone 6 of `docs/proposals/rag.md`, minus the panel that calls it. Everything
 * built before this is a pure function over a list; this is where chunking, a
 * store, an embedding request and a search become *import these files* and *match
 * our house style*.
 *
 * ## Dependencies are injected, because this is the one file that does all the IO
 *
 * `LibraryDeps` names the store and the two embedding calls. `defaultDeps()` wires
 * the real ones. A test supplies its own and gets the whole orchestration under
 * assertion without IndexedDB or a network, which is the only way the ordering
 * rules below can be checked at all.
 *
 * ## The import saves before it embeds, and that ordering is the point
 *
 * Chunking is local and instant; embedding is a network request against the user's
 * own quota that can fail halfway. So the entries are written to the store the
 * moment they exist, *before* a single vector is asked for. A failed embedding then
 * costs nothing — the chunks are in the library, `entriesToEmbed` will name them
 * next time, and the second attempt asks only for what is still missing.
 *
 * Saving afterwards instead would mean a network failure discarded work already
 * done locally, and the retry would re-chunk, re-hash and re-request everything.
 *
 * ## Retrieval answers with a string, and an empty one is an ordinary answer
 *
 * `retrieveHouseStyle` returns the block for `previousState.houseStyle`, or `''`.
 * Empty is the common case rather than the failure case: no library yet, nothing
 * canonical, no query worth asking, or nothing scoring above the threshold. The
 * caller appends it unconditionally and the prompt is unchanged when it is empty.
 *
 * **It refuses rather than degrades on one thing only**: a library embedded with a
 * different model than the one answering now. `searchable()` filters those out, so
 * the result is an honest nothing rather than a comparison between two spaces.
 *
 * ## The reports a person keeps fill it too (2026-11-11, the full audit's D2 and D3)
 *
 * Until then the library held only what someone imported by hand and ticked, and
 * was read only on a refine (LM-23). Now a report the person keeps joins it on
 * its own (`keepReport`), stripped as an import is, the newest
 * `MAX_KEPT_REPORTS`, and the Library panel lists it with a Remove like any
 * other. It is never embedded, so nothing of it leaves the browser: a first
 * report is matched to the kept one nearest it by shape (`nearestKept`), the
 * numbers `skeletonFeatures` gives, in the shipped model's scale, with the
 * category the words name counting for most. That answers the proposal's open
 * question of retrieval before the model has looked: the draft Forma makes
 * first is the query.
 */
import { chunkRepx } from '../lib/repxChunks';
import {
  addChunks,
  entriesToEmbed,
  searchable,
  withVectors,
  forgetSource,
  type LibraryEntry,
  type LibraryStorage,
} from '../lib/embedStore';
import { houseStyleBlock, mergeMatches, styleQueries, type StyleBlockOptions } from '../lib/houseStyle';
import { topMatches, type Match } from '../lib/vectorSearch';
import { createKeptStorage, createLibraryStorage, type KeptRecord, type KeptStorage } from '../lib/libraryDb';
import { featureDistance } from '../lib/formaModel';
import { embedEntries, embedTexts } from './embeddings';

export interface LibraryDeps {
  storage: LibraryStorage;
  /** The kept reports (D2); absent in a caller that has none, which then keeps nothing. */
  kept?: KeptStorage;
  embedEntries: typeof embedEntries;
  embedTexts: typeof embedTexts;
}

/** The real wiring. A caller that is not a test wants this. */
export function defaultDeps(): LibraryDeps {
  return { storage: createLibraryStorage(), kept: createKeptStorage(), embedEntries, embedTexts };
}

/**
 * How many kept reports the library holds; the oldest goes first. Enough for
 * the kinds of report one person makes, few enough that the library follows
 * them as their style changes. Unmeasured, as MAX_KEPT in lib/memory.ts.
 */
export const MAX_KEPT_REPORTS = 20;

/** A report kept, on its way in: what `KeptRecord` holds but its parts and its time, and the file they are cut from. */
export type KeptReport = Omit<KeptRecord, 'chunks' | 'at'> & { repx: string };

/**
 * Put a kept report in the library: its parts cut and stripped as an
 * imported file's are, in place of what the same report left before, the
 * newest MAX_KEPT_REPORTS. False when there is nowhere to keep it or the file
 * has no part to keep. Nothing is embedded and nothing is sent.
 *
 * `replaces` names the id the same report was kept under before it had a
 * project (its shape's hash, as lib/memory.ts keys it), so a report exported
 * and then saved is one report here too.
 *
 * Only its owner's records stay beside it (2026-11-11, the LRN2 review): what
 * someone else kept in this browser, signed out or under another account, is
 * dropped here rather than left for whoever keeps a report next, as
 * lib/memory.ts never carries signed-out memory into an account.
 */
export async function keepReport(report: KeptReport, deps: LibraryDeps, options: { now?: number; max?: number; replaces?: string } = {}): Promise<boolean> {
  if (!deps.kept) return false;
  const { repx, ...rest } = report;
  const chunks = chunkRepx(repx, report.name);
  if (!chunks.length) return false;
  const record: KeptRecord = { ...rest, at: options.now ?? Date.now(), chunks };
  const others = (await deps.kept.load())
    .filter((r) => r.owner === record.owner && r.id !== record.id && r.id !== options.replaces)
    .sort((a, b) => a.at - b.at);
  await deps.kept.save([...others, record].slice(-(options.max ?? MAX_KEPT_REPORTS)));
  return true;
}

/**
 * The kept report nearest a new one, or null when none is kept: the
 * distance between their shapes in each feature's spread (`scale.sd`, the
 * shipped model's), less 2 when both are the same category, so "an invoice"
 * finds the invoice kept before a list that happens to be shaped like it.
 * The nearest is always given: the person's own report is a better example
 * than none, and the prompt says the source wins wherever they differ.
 */
export function nearestKept(
  query: { features: number[]; category: string | null },
  records: readonly KeptRecord[],
  scale: { sd: number[] },
): { record: KeptRecord; distance: number } | null {
  let best: { record: KeptRecord; distance: number } | null = null;
  for (const record of records) {
    if (record.features.length !== query.features.length) continue;
    const distance = featureDistance(query.features, record.features, scale) - (query.category && record.category === query.category ? 2 : 0);
    if (!best || distance < best.distance || (distance === best.distance && record.at > best.record.at)) best = { record, distance };
  }
  return best;
}

/** One file on its way in. Text rather than a File, so this needs no DOM. */
export interface ReportFile {
  name: string;
  text: string;
}

export interface ImportResult {
  /** Chunks new to the library. */
  added: number;
  /** Chunks already held, by content — a re-import costs nothing. */
  skipped: number;
  /** How many got a vector this time. */
  embedded: number;
  /** Chunks still waiting for one, which the next import will pick up. */
  pending: number;
  /** Files that produced no chunks at all. */
  empty: string[];
}

/**
 * Chunk these reports into the library and embed whatever still needs it.
 *
 * Embeds every pending entry rather than only the new ones, so an import after a
 * failed one finishes the job instead of leaving a permanently half-embedded
 * library.
 */
export async function importReports(
  files: readonly ReportFile[],
  deps: LibraryDeps,
  options: { apiKey: string; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<ImportResult> {
  const existing = await deps.storage.load();

  let entries = existing;
  let added = 0;
  let skipped = 0;
  const empty: string[] = [];

  for (const file of files) {
    const chunks = chunkRepx(file.text, file.name);
    if (chunks.length === 0) {
      empty.push(file.name);
      continue;
    }
    const merged = addChunks(entries, chunks);
    entries = merged.entries;
    added += merged.added;
    skipped += merged.skipped;
  }

  // Before the network, deliberately -- see the header.
  await deps.storage.save(entries);

  const pending = entriesToEmbed(entries, '');
  const toEmbed = entries.filter((e) => e.vector === null);
  if (toEmbed.length === 0) {
    return { added, skipped, embedded: 0, pending: pending.length, empty };
  }

  const { vectors, model } = await deps.embedEntries(toEmbed, {
    apiKey: options.apiKey,
    signal: options.signal,
    onProgress: options.onProgress,
  });

  if (vectors.size > 0) {
    entries = withVectors(entries, vectors, model);
    await deps.storage.save(entries);
  }

  return {
    added,
    skipped,
    embedded: vectors.size,
    pending: entries.filter((e) => e.vector === null).length,
    empty,
  };
}

export interface RetrieveOptions extends StyleBlockOptions {
  apiKey: string;
  signal?: AbortSignal;
  /** Restrict retrieval to a chosen subset — the canonical set. */
  where?: (entry: LibraryEntry) => boolean;
  /** How many matches each query contributes before merging. */
  perQuery?: number;
}

/**
 * Build the house-style block for a refine, or `''`.
 *
 * Every early return is a legitimate "nothing to add" rather than an error: the
 * library is empty, the draft and the instruction between them ask nothing, or the
 * stored vectors belong to another model.
 */
export async function retrieveHouseStyle(
  draftRepx: string | null | undefined,
  instruction: string | null | undefined,
  deps: LibraryDeps,
  options: RetrieveOptions,
): Promise<string> {
  const entries = await deps.storage.load();
  if (entries.length === 0) return '';

  const queries = styleQueries(draftRepx, instruction);
  if (queries.length === 0) return '';

  const { vectors, model } = await deps.embedTexts(queries, {
    apiKey: options.apiKey,
    signal: options.signal,
  });

  const candidates = searchable(entries, model).filter(
    (candidate) => !options.where || options.where(candidate.item),
  );
  if (candidates.length === 0) return '';

  const perQuery = options.perQuery ?? 4;
  const results: Match<LibraryEntry>[][] = vectors.map((vector) =>
    topMatches(vector, candidates, { k: perQuery, minScore: options.minScore }),
  );

  return houseStyleBlock(mergeMatches(results), options);
}

/** What the panel lists: one row per file, not per chunk. */
export interface LibrarySource {
  name: string;
  chunks: number;
  embedded: number;
  /** Only a report the person kept (D2), nothing added by that name: it joined on its own and is used without a tick. */
  kept?: true;
}

/** Group the library by the file each chunk came from, for display, with the kept reports by name. */
export function sources(entries: readonly LibraryEntry[], kept: readonly KeptRecord[] = []): LibrarySource[] {
  const byName = new Map<string, LibrarySource>();

  for (const entry of entries) {
    const name = entry.chunk.source || '(unnamed)';
    const row = byName.get(name) ?? { name, chunks: 0, embedded: 0 };
    row.chunks++;
    if (entry.vector) row.embedded++;
    byName.set(name, row);
  }
  // A kept report is never embedded, so it is counted as read: the panel says
  // "still being read" of an import waiting for its key, never of these. One
  // row per name: a file added under the same name keeps its own row (and its
  // tick), and Remove takes both out.
  for (const record of kept) {
    if (!byName.has(record.name)) byName.set(record.name, { name: record.name, chunks: record.chunks.length, embedded: record.chunks.length, kept: true });
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What the Library panel lists, read from both stores: of the kept reports,
 * only those `owner` kept (null signed out), so a shared browser never shows
 * one person the names of another's reports (the LRN2 review, 2026-11-11).
 */
export async function listSources(deps: LibraryDeps, owner: string | null = null): Promise<LibrarySource[]> {
  const [entries, kept] = await Promise.all([deps.storage.load(), deps.kept?.load() ?? []]);
  return sources(entries, kept.filter((r) => r.owner === owner));
}

/**
 * Every report `owner` kept, taken out of the library: Settings > Memory's
 * Forget kept reports and Forget everything (the LRN2 review, 2026-11-11).
 * Until then they cleared the memory's styles and left the reports here, still
 * quoted to the AI on the next first report and still listed.
 */
export async function forgetKept(owner: string | null, deps: LibraryDeps): Promise<void> {
  if (!deps.kept) return;
  const kept = await deps.kept.load();
  const left = kept.filter((r) => r.owner !== owner);
  if (left.length !== kept.length) await deps.kept.save(left);
}

/** Take one file back out of the library, and a kept report of that name with it. */
export async function removeSource(name: string, deps: LibraryDeps): Promise<LibraryEntry[]> {
  const entries = await deps.storage.load();
  const left = forgetSource(entries, name);
  await deps.storage.save(left);
  if (deps.kept) {
    const kept = await deps.kept.load();
    if (kept.some((r) => r.name === name)) await deps.kept.save(kept.filter((r) => r.name !== name));
  }
  return left;
}
