/**
 * Pull what people let Forma learn from (2026-11-10, the full audit):
 * every account's learning events (lib/learning.ts, Firestore
 * users/{uid}/learning/{id}) into a folder OUTSIDE the repository, as the
 * sets the model scripts read.
 *
 *   npx tsx scripts/model/pull-learning.ts --out <dir> [--key <credential.json>] [--since YYYY-MM-DD]
 *       [--skeletons-only] [--per-account 20] [--reconcile <dir> ...] [--forget <uid> ...] [--force]
 *   npx tsx scripts/model/pull-learning.ts --forget <uid> --reconcile <dir> ...     (no credential, nothing read)
 *
 * The credential is the owner's, on their own PC, never this shared server
 * (the company's RDP account): `gcloud auth application-default login` and
 * no key file at all, or a service account made for this with
 * roles/datastore.viewer and roles/firebaseauth.viewer, and
 * roles/datastore.user only when --reconcile is to delete (2026-11-11,
 * SA-14). Never the Admin SDK's own account, which can change everything; a
 * key file is deleted once the run is done. scripts/admin/google.mjs reads
 * it, and says where from.
 *
 * --out            where the pull goes; kept outside the repository, as every
 *                  training set is: forma-model-data/learning on the owner's
 *                  PC, the same folder every week.
 * --since          only events from that day on (the `day` field).
 * --skeletons-only asks Firestore for every field but the whole report and
 *                  the words (a projection): the pull the weekly job makes.
 * --per-account    at most this many new skeletons from one account per pull
 *                  (default 20), so one account cannot outweigh the rest.
 * --reconcile      earlier pull folders to bring in step as well; and, with
 *                  it, the events of deleted accounts are deleted from
 *                  Firestore too (the one write this script makes).
 * --forget         an account (uid) whose files go from every folder named,
 *                  for a person who asked to be forgotten.
 * --force          pull even when the count says it would read more than
 *                  35,000 documents (twice the events held: the id listing
 *                  and the pull), most of the free plan's 50,000 reads a day
 *                  that the live site shares. The count itself costs a read
 *                  per thousand.
 *
 * Without --reconcile, the events of deleted accounts are removed from these
 * folders but not from Firestore, and the weekly job (learn-week.ts) does not
 * pass it: its credential can then be viewer-only (SA-14), and the delete is
 * a run the owner makes on purpose, with --reconcile and the one role that
 * may write.
 *
 * Written, under --out:
 *   events.jsonl        one line per event: its kind, source, AI and counts,
 *                       never the skeleton, the report or the words
 *   skeletons/<id>.json {category: null, skeleton, account, hash, quality},
 *                       the shape train.ts reads through --skeletons, only for
 *                       what may be learned from (below)
 *   boxes/<id>.json     {ref, at, account, pair}: a kept report's page pair
 *                       (2026-11-12, Owner decision 20, the full audit's D10;
 *                       src/lib/readerPairs.ts), where each text of a page sent
 *                       sat and the box reader's numbers for it, never its
 *                       characters, with the band and role the kept report gave
 *                       it; structure, so it comes with --skeletons-only too.
 *                       Kept by `selectPairs` (a verified, existing account,
 *                       not the mock, not rated bad or undone, sound, at most
 *                       --per-account); `npx tsx scripts/model/boxes.ts --pairs
 *                       <out>/boxes` trains the box reader on them
 *   repx/<id>.repx      the whole report, on the opt-in tier only, the shape
 *                       train.ts reads through --reports and the library takes
 *   prompts/<id>.txt    the person's words with it, the same tier
 *   cursor.json         the latest trusted event time this folder's pulls saw;
 *                       the next pull reads from 30 days before it, by day, so
 *                       an event that synced late is still read, and a made-up
 *                       time ('9999-...') cannot move it (ResumePoint,
 *                       lib/learningPipeline.ts, 2026-11-11)
 *   summary.json        counts by kind, AI and day, and what was dropped; no content
 *
 * What may be learned from (2026-11-11, LM-07, LM-10, lib/learningPipeline.ts
 * `selectTraining`): an account whose address is verified and that still
 * exists; a real AI's answer (not the mock, not none); a report the checks
 * found no error in, not rated bad and not undone; a skeleton that is sound
 * (`soundSkeleton`: rebuilt from its known keys, held to the vocabulary and
 * the page, public fonts only); one copy of each skeleton per account; and
 * at most --per-account of them. What was dropped is printed as counts.
 *
 * Deletion reaches these copies (LM-03, SE-10): every pull lists the ids
 * still in Firestore (a projection on `id`) and removes the files and lines
 * of every event that is gone from --out and each --reconcile folder; a
 * rating of "bad" that arrives after its report was kept removes the report's
 * skeleton too.
 *
 * The query pages by cursor, never by offset (LM-17), on the index in
 * firestore.indexes.json (LM-04), which the deploy now deploys. The console
 * prints counts only, never an event's content. Pure ASCII, as every script
 * here.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { connect, countGroup, documentsUrl, isMain, lookupAccounts, option, options } from '../admin/google.mjs';
import {
  advanceResume,
  applyReconcile,
  EVENT_FIELDS,
  pullPages,
  resumeSince,
  selectPairs,
  selectTraining,
  SKELETON_FIELDS,
  trustedAt,
  type AccountState,
  type DropReason,
  type FetchLike,
  type FsLike,
  type PulledEvent,
  type ResumePoint,
} from '../../src/lib/learningPipeline';

/**
 * The most documents a pull reads without --force: the same line backup.mjs
 * keeps (SA-14), most of the free plan's 50,000 reads a day, which the live
 * site shares. Listing the current ids reads every learning event (a
 * projection is still one read per document), and the pull reads up to as
 * many again, so a pull is estimated at twice the count.
 */
const MAX_READS = 35_000;

const nodeFs: FsLike = {
  existsSync,
  readdirSync: (p) => readdirSync(p),
  readFileSync: (p, e) => readFileSync(p, e),
  writeFileSync: (p, d) => writeFileSync(p, d),
  unlinkSync,
};

/** Whether a folder is the repository or inside it: a sibling such as ../forma-model-data begins with its path. */
export function insideRepository(dir: string, repo = resolve('.')): boolean {
  const within = relative(repo, resolve(dir));
  return !within.startsWith('..') && !isAbsolute(within);
}

/** The `<account>|<hash>` of every skeleton an earlier pull kept, so a repeat is not kept twice. */
export function seenSkeletons(dir: string): string[] {
  const folder = join(dir, 'skeletons');
  if (!existsSync(folder)) return [];
  return readdirSync(folder).flatMap((name) => {
    try {
      const f = JSON.parse(readFileSync(join(folder, name), 'utf8')) as { account?: string; hash?: string };
      return f.account && f.hash ? [`${f.account}|${f.hash}`] : [];
    } catch {
      return [];
    }
  });
}

/** The page pair files of a folder by the report they label (`ref`), so a bad rating or an undo can find them. */
function refsOfPairs(dir: string): Map<string, string[]> {
  const byRef = new Map<string, string[]>();
  const folder = join(dir, 'boxes');
  if (!existsSync(folder)) return byRef;
  for (const name of readdirSync(folder)) {
    try {
      const ref = (JSON.parse(readFileSync(join(folder, name), 'utf8')) as { ref?: string }).ref;
      if (ref) byRef.set(ref, [...(byRef.get(ref) ?? []), name]);
    } catch {
      /* unreadable: left to the reconcile */
    }
  }
  return byRef;
}

/** Every id the accounts still hold: a projection on `id` and `userId`, page by page. */
async function currentIds(fetchFn: FetchLike, url: string, headers: Record<string, string>): Promise<{ ids: Set<string>; names: Map<string, { name: string; userId: string }> }> {
  const ids = new Set<string>();
  const names = new Map<string, { name: string; userId: string }>();
  for await (const page of pullPages(fetchFn, { url, headers, fields: ['id', 'userId', 'at'] })) {
    for (const e of page.events) {
      ids.add(e.id);
      names.set(e.id, { name: e.name ?? '', userId: e.userId });
    }
  }
  return { ids, names };
}

/** The folder's resume point, or null; `resumeSince` refuses one that is not a trusted time. */
function readCursor(out: string, since: string): ResumePoint | null {
  try {
    const c = JSON.parse(readFileSync(join(out, 'cursor.json'), 'utf8')) as Partial<ResumePoint>;
    return c.since === since && typeof c.at === 'string' ? { since, at: c.at } : null;
  } catch {
    return null;
  }
}

/** Counts over events.jsonl, the whole folder's, not this pull's alone. */
function summarise(out: string, dropped: Partial<Record<DropReason, number>>, pulled: number, kept: number): Record<string, unknown> {
  const path = join(out, 'events.jsonl');
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()) : [];
  const byKind: Record<string, number> = {};
  const byAi: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  const accounts = new Set<string>();
  for (const line of lines) {
    try {
      const e = JSON.parse(line) as { kind: string; ai: string; day: string; userId: string };
      byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
      byAi[e.ai] = (byAi[e.ai] ?? 0) + 1;
      byDay[e.day] = (byDay[e.day] ?? 0) + 1;
      accounts.add(e.userId);
    } catch {
      /* skipped */
    }
  }
  const skeletons = existsSync(join(out, 'skeletons')) ? readdirSync(join(out, 'skeletons')).length : 0;
  const full = existsSync(join(out, 'repx')) ? readdirSync(join(out, 'repx')).length : 0;
  const pagePairs = existsSync(join(out, 'boxes')) ? readdirSync(join(out, 'boxes')).length : 0;
  return { events: lines.length, accounts: accounts.size, skeletons, pagePairs, fullReports: full, thisPull: { pulled, kept, dropped }, byKind, byAi, byDay };
}

export async function main(argv = process.argv.slice(2), fetchFn: FetchLike = fetch): Promise<number> {
  const outDir = option(argv, 'out') as string | undefined;
  const since = (option(argv, 'since') as string | undefined) ?? '';
  const reconcileDirs = (options(argv, 'reconcile') as string[]).map((d) => resolve(d));
  const forget = new Set(options(argv, 'forget') as string[]);
  const perAccount = Number(option(argv, 'per-account') ?? 20);
  const skeletonsOnly = argv.includes('--skeletons-only');
  if (!outDir && !(forget.size && reconcileDirs.length)) {
    console.error('Usage: npx tsx scripts/model/pull-learning.ts --out <dir> [--key <credential.json>] [--since YYYY-MM-DD] [--skeletons-only] [--per-account 20] [--reconcile <dir> ...] [--forget <uid> ...] [--force]');
    return 2;
  }
  for (const dir of [outDir, ...reconcileDirs].filter((d): d is string => !!d)) {
    if (insideRepository(dir)) {
      console.error(`${dir} is inside the repository. Keep what people share outside it.`);
      return 2;
    }
  }
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    console.error('--since must be a day as YYYY-MM-DD.');
    return 2;
  }
  if (!Number.isInteger(perAccount) || perAccount < 1) {
    console.error('--per-account must be a whole number from 1.');
    return 2;
  }

  // --forget alone: the owner's own folders, nothing read from Firestore.
  if (!outDir) {
    for (const dir of reconcileDirs) {
      const plan = applyReconcile(nodeFs, dir, null, forget);
      console.log(`${dir}: forgot ${plan.ids.length} event(s), ${plan.remove.length} file(s) removed`);
    }
    return 0;
  }

  const out = resolve(outDir);
  for (const dir of ['skeletons', 'repx', 'prompts', 'boxes']) mkdirSync(join(out, dir), { recursive: true });
  const cred = await connect({ keyPath: option(argv, 'key'), fetchFn });
  const docsUrl = documentsUrl(cred.project, cred.database);
  const url = `${docsUrl}:runQuery`;
  const held = await countGroup(fetchFn, { url: docsUrl, headers: await cred.headers(), collectionId: 'learning' });
  console.log(`learning events in the accounts: ${held}; this pull reads at most ${2 * held}.`);
  if (2 * held > MAX_READS && !argv.includes('--force')) {
    console.error(`That is more than ${MAX_READS} reads, most of the free plan's day, which the live site shares. Run it just after midnight Pacific with --force, or not today.`);
    return 1;
  }
  // Where this pull begins (LM-17): the last trusted time a pull saw, less a
  // lookback, never a time an event wrote unchecked (ResumePoint,
  // lib/learningPipeline.ts). What it reads twice is already in events.jsonl.
  const startedAt = Date.now();
  const after = readCursor(out, since);
  const from = resumeSince(since, after, { startedAt });
  const resumed = from !== since;
  const states = new Map<string, AccountState>();
  const events: PulledEvent[] = [];
  let read = 0;
  let cursor: ResumePoint | null = after;
  const known = new Set<string>();
  const eventsPath = join(out, 'events.jsonl');
  if (existsSync(eventsPath)) {
    for (const line of readFileSync(eventsPath, 'utf8').split('\n')) {
      try {
        known.add((JSON.parse(line) as { id: string }).id);
      } catch {
        /* blank */
      }
    }
  }

  // An event is judged once, on the pull that first records it; a rating is
  // read again each time, since it may unkeep a report kept earlier.
  const knownAtStart = new Set(known);

  for await (const page of pullPages(fetchFn, { url, headers: await cred.headers(), since: from, fields: skeletonsOnly ? SKELETON_FIELDS : EVENT_FIELDS })) {
    read += page.events.length;
    const fresh = page.events.filter((e) => e.userId && !states.has(e.userId)).map((e) => e.userId);
    if (fresh.length) for (const [uid, state] of (await lookupAccounts(fetchFn, { project: cred.project, headers: await cred.headers(), uids: fresh })) as Map<string, AccountState>) states.set(uid, state);
    for (const e of page.events) {
      if (!e.id || !/^[a-zA-Z0-9_-]+$/.test(e.id)) continue;
      const state = states.get(e.userId) ?? 'gone';
      // The whole report goes to repx/ only for a verified, existing account and
      // a real AI's answer; it is never kept in memory beyond this page.
      if (!skeletonsOnly && e.full && state === 'verified' && e.ai !== 'mock' && e.ai !== 'none') {
        writeFileSync(join(out, 'repx', `${e.id}.repx`), e.full);
        if (e.prompt) writeFileSync(join(out, 'prompts', `${e.id}.txt`), e.prompt);
      }
      const { full, prompt, skeleton, boxes, name: _name, ...rest } = e;
      // An event whose time is not trusted is not recorded, so a clock that
      // ran ahead is recorded on a later pull, inside the lookback.
      if (state !== 'gone' && !known.has(e.id) && trustedAt(e.at, startedAt)) {
        appendFileSync(eventsPath, `${JSON.stringify({ ...rest, hasSkeleton: !!skeleton, hasFull: !!full || !!prompt, hasBoxes: !!boxes })}\n`);
        known.add(e.id);
      }
      if (!knownAtStart.has(e.id) || e.kind === 'rating') events.push({ ...e, full: '', prompt: '' });
    }
    // Kept page by page, so a pull stopped half way resumes near where it stopped.
    cursor = advanceResume(cursor, page.events, { since, startedAt });
    if (cursor) writeFileSync(join(out, 'cursor.json'), JSON.stringify(cursor));
  }

  const { kept, dropped } = selectTraining(events, { accounts: (uid) => states.get(uid) ?? 'gone', perAccount, seen: seenSkeletons(out), startedAt });
  for (const k of kept) {
    writeFileSync(join(out, 'skeletons', `${k.event.id}.json`), JSON.stringify({ category: null, skeleton: k.skeleton, account: k.account, hash: k.hash, quality: k.quality }));
  }
  // The page pairs a kept report labelled (2026-11-12, D10), for boxes.ts --pairs.
  const pairs = selectPairs(events, { accounts: (uid) => states.get(uid) ?? 'gone', perAccount, startedAt });
  for (const p of pairs.kept) writeFileSync(join(out, 'boxes', `${p.event.id}.json`), JSON.stringify(p.file));
  // A report rated bad or undone after an earlier pull kept it: its skeleton and its page pairs go now.
  let unkept = 0;
  const pairRefs = refsOfPairs(out);
  for (const e of events) {
    if (!((e.kind === 'rating' && e.rating === 'bad') || e.kind === 'undo') || !e.ref || !/^[a-zA-Z0-9_-]+$/.test(e.ref)) continue;
    const file = join(out, 'skeletons', `${e.ref}.json`);
    if (e.kind === 'rating' && existsSync(file)) {
      unlinkSync(file);
      unkept++;
    }
    for (const name of pairRefs.get(e.ref) ?? []) {
      if (!existsSync(join(out, 'boxes', name))) continue;
      unlinkSync(join(out, 'boxes', name));
      unkept++;
    }
  }
  // Deletion reaches the copies: whatever is gone from the accounts goes from every folder.
  const current = await currentIds(fetchFn, url, await cred.headers());
  if (reconcileDirs.length) {
    // Every account that still holds events, not only this pull's: an account
    // deleted since an earlier pull is found here.
    const unknown = [...new Set([...current.names.values()].map((n) => n.userId))].filter((uid) => uid && !states.has(uid));
    if (unknown.length) for (const [uid, state] of (await lookupAccounts(fetchFn, { project: cred.project, headers: await cred.headers(), uids: unknown })) as Map<string, AccountState>) states.set(uid, state);
  }
  const goneUids = [...states].filter(([, s]) => s === 'gone').map(([uid]) => uid);
  let deleted = 0;
  if (reconcileDirs.length && goneUids.length) {
    // Events of accounts that no longer exist are deleted where they are, the one write (roles/datastore.user).
    const gone = new Set(goneUids);
    for (const { name, userId } of current.names.values()) {
      if (!gone.has(userId) || !name) continue;
      const res = await fetchFn(`https://firestore.googleapis.com/v1/${name}`, { method: 'DELETE', headers: await cred.headers() });
      if (!res.ok) throw new Error(`Deleting an event of a deleted account answered ${res.status}.`);
      current.ids.delete(name.slice(name.lastIndexOf('/') + 1));
      deleted++;
    }
  }
  const forgetAll = new Set([...forget, ...goneUids]);
  let reconciled = 0;
  for (const dir of [out, ...reconcileDirs]) reconciled += applyReconcile(nodeFs, dir, current.ids, forgetAll).ids.length;

  const summary = summarise(out, dropped, read, kept.length);
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 1));
  const accountsSeen = new Set(events.map((e) => e.userId)).size;
  console.log(`pulled ${read} events (${events.length} new) from ${accountsSeen} accounts${from ? ` from ${from}` : ''}${resumed ? ' (resumed, with a lookback)' : ''}: ${kept.length} skeleton(s) and ${pairs.kept.length} page pair(s) kept to learn from`);
  const why = Object.entries(dropped).map(([k, n]) => `${k} ${n}`).join(', ');
  const pairsWhy = Object.entries(pairs.dropped).map(([k, n]) => `${k} ${n}`).join(', ');
  console.log(`not learned from: ${why || 'none'}${pairsWhy ? `; page pairs: ${pairsWhy}` : ''}${unkept ? `; ${unkept} kept earlier and rated bad or undone since, removed` : ''}`);
  console.log(`reconciled: ${reconciled} event(s) no longer shared removed from ${1 + reconcileDirs.length} folder(s)${deleted ? `; ${deleted} event(s) of deleted accounts deleted from Firestore` : ''}`);
  console.log(`folder: ${summary.events} events, ${summary.skeletons} skeletons, ${summary.pagePairs} page pairs, ${summary.fullReports} full reports (opt-in), from ${summary.accounts} accounts, under ${out}`);
  return 0;
}

if (isMain(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
