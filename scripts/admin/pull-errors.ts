/**
 * Pull the error reports people chose to send (2026-11-12, Owner decision 10,
 * the full audit's SA-15; src/lib/errorReport.ts): every document in the
 * top-level `errors` collection, saved to a folder OUTSIDE the repository and
 * then deleted from Firestore, so a report lives in the database only until
 * the owner has read it, as the privacy policy says.
 *
 *   npx tsx scripts/admin/pull-errors.ts --out <dir> [--key <credential.json>] [--keep] [--force]
 *
 * The credential is the owner's, on their own PC, never the company's shared
 * server, read by scripts/admin/google.mjs as pull-learning.ts reads it:
 * `gcloud auth application-default login`, or a service account's key made
 * for this. Which roles each run needs:
 *   a pull, which deletes what it saved   roles/datastore.user
 *   a pull with --keep, which deletes nothing   roles/datastore.viewer
 * Never the Admin SDK's own account. A key file is deleted once the run is done.
 *
 * --out    where the reports go: `errors.jsonl`, one line per report (its id,
 *          day, version, area, code and message, as the browser scrubbed it;
 *          nothing names an account), the same file every time, a report
 *          already in it not written twice; and `summary.json`, the counts.
 * --keep   read and save, and delete nothing (the viewer role is then enough).
 * --force  pull even when the count says it would read more than 35,000
 *          documents, most of the free plan's day, which the live site shares.
 *
 * A report is deleted only after the line holding it is on disk. The console
 * prints counts by version, area and code; the messages stay in the file.
 * Pure ASCII, as every script here.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connect, countGroup, documentsUrl, isMain, option } from './google.mjs';
import { insideRepository } from '../model/pull-learning';
import type { FetchLike, FirestoreValue } from '../../src/lib/learningPipeline';

/** The most documents a pull reads without --force: the same line the other owner scripts keep. */
const MAX_READS = 35_000;
const PAGE_SIZE = 300;
const FIELDS = ['day', 'version', 'area', 'code', 'message'] as const;

export interface PulledError {
  id: string;
  day: string;
  version: string;
  area: string;
  code: string;
  message: string;
}

/** One page of the `errors` collection, in document order, after `after` (a document name). */
export function errorsQuery(after: string | null, pageSize = PAGE_SIZE): Record<string, unknown> {
  return {
    select: { fields: FIELDS.map((fieldPath) => ({ fieldPath })) },
    from: [{ collectionId: 'errors' }],
    orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
    ...(after ? { startAt: { values: [{ referenceValue: after }], before: false } } : {}),
    limit: pageSize,
  };
}

const text = (v: FirestoreValue | undefined) => (typeof v?.stringValue === 'string' ? v.stringValue : '');

/** A REST document as a report: its id from its name, every field as text. */
export function errorOf(document: { name: string; fields?: Record<string, FirestoreValue> }): PulledError {
  const f = document.fields ?? {};
  return {
    id: document.name.slice(document.name.lastIndexOf('/') + 1),
    day: text(f.day),
    version: text(f.version),
    area: text(f.area),
    code: text(f.code),
    message: text(f.message),
  };
}

/** Counts by a field, largest first. */
function tally(rows: readonly PulledError[], field: keyof PulledError): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r[field] || '(none)'] = (out[r[field] || '(none)'] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

export async function main(argv = process.argv.slice(2), fetchFn: FetchLike = fetch): Promise<number> {
  const outDir = option(argv, 'out') as string | undefined;
  if (!outDir) {
    console.error('Usage: npx tsx scripts/admin/pull-errors.ts --out <dir> [--key <credential.json>] [--keep] [--force]');
    return 2;
  }
  if (insideRepository(outDir)) {
    console.error(`${outDir} is inside the repository. Keep what people send outside it.`);
    return 2;
  }
  const keep = argv.includes('--keep');
  const out = resolve(outDir);
  mkdirSync(out, { recursive: true });
  const cred = await connect({ keyPath: option(argv, 'key'), fetchFn });
  const docsUrl = documentsUrl(cred.project, cred.database);
  const held = await countGroup(fetchFn, { url: docsUrl, headers: await cred.headers(), collectionId: 'errors' });
  console.log(`error reports waiting: ${held}.`);
  if (held > MAX_READS && !argv.includes('--force')) {
    console.error(`That is more than ${MAX_READS} reads, most of the free plan's day, which the live site shares. Run it just after midnight Pacific with --force, or not today.`);
    return 1;
  }

  const file = join(out, 'errors.jsonl');
  const known = new Set<string>();
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      try {
        known.add((JSON.parse(line) as { id: string }).id);
      } catch {
        /* blank */
      }
    }
  }
  const pulled: PulledError[] = [];
  let deleted = 0;
  let after: string | null = null;
  for (;;) {
    const res = await fetchFn(`${docsUrl}:runQuery`, {
      method: 'POST',
      headers: { ...(await cred.headers()), 'content-type': 'application/json' },
      body: JSON.stringify({ structuredQuery: errorsQuery(after) }),
    });
    if (!res.ok) throw new Error(`Firestore answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const rows = (await res.json()) as { document?: { name: string; fields?: Record<string, FirestoreValue> } }[];
    const docs = rows.flatMap((r) => (r.document ? [r.document] : []));
    if (!docs.length) break;
    // Saved first, the whole page, and only then deleted.
    const fresh = docs.map(errorOf).filter((e) => /^[A-Za-z0-9_-]+$/.test(e.id) && !known.has(e.id));
    if (fresh.length) appendFileSync(file, fresh.map((e) => `${JSON.stringify(e)}\n`).join(''));
    for (const e of fresh) known.add(e.id);
    pulled.push(...fresh);
    if (!keep) {
      for (const d of docs) {
        if (!known.has(errorOf(d).id)) continue;
        const gone = await fetchFn(`https://firestore.googleapis.com/v1/${d.name}`, { method: 'DELETE', headers: await cred.headers() });
        if (!gone.ok) throw new Error(`Deleting a saved error report answered ${gone.status}${gone.status === 403 ? ': this credential may only read; use one with roles/datastore.user, or --keep' : ''}.`);
        deleted++;
      }
    }
    after = docs[docs.length - 1].name;
    if (docs.length < PAGE_SIZE) break;
  }

  const summary = { pulled: pulled.length, deleted, byVersion: tally(pulled, 'version'), byArea: tally(pulled, 'area'), byCode: tally(pulled, 'code'), byDay: tally(pulled, 'day') };
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(`saved ${pulled.length} new error report(s) to ${file}${keep ? '; --keep, so none was deleted' : `; ${deleted} deleted from Firestore`}.`);
  for (const [field, counts] of [['version', summary.byVersion], ['area', summary.byArea], ['code', summary.byCode]] as const) {
    const top = Object.entries(counts).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(', ');
    if (top) console.log(`  by ${field}: ${top}`);
  }
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
