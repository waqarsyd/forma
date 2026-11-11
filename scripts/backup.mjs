// A copy of everything in Forma's Firestore, run by the owner (2026-11-08,
// site audit item 66). Pure ASCII, as every script here.
//
// The free plan has no managed backup: Firestore's own export and its
// scheduled backups need the paid plan. A person can download their own
// projects (Settings, General, "Download all"); this is the whole database,
// for the owner: every document under every collection, one JSON line each,
// written to a folder outside this repository.
//
// It needs what only the owner has, on the owner's own PC (never the
// company's shared server), so nothing here runs it. Ask for as little as
// it needs (2026-11-11, the full audit, SA-14):
//   1. A credential that can only READ. Best, no key file at all:
//        gcloud auth application-default login
//      Or a service account made for this alone with one role,
//      roles/datastore.viewer (Google Cloud console, IAM, Service accounts),
//      and a key for it; never the "Generate new private key" of Firebase's
//      own Admin SDK account, which can rewrite or delete every account.
//      Keep a key file outside this repository (.gitignore refuses the usual
//      names anyway), and delete the key in the console when you are done.
//   2. The Admin SDK, for this run only:  npm i --no-save firebase-admin
//   3. For a key file, GOOGLE_APPLICATION_CREDENTIALS set to its path; then
//        node scripts/backup.mjs --out <a folder outside the repository> [--force]
//
// What it costs (SA-14): it first COUNTS each collection group (one billed
// read per thousand documents), prints the estimate, and stops when the copy
// would read more than 35,000 documents, most of the free plan's 50,000 reads
// a day that the live site shares, unless --force; run it just after
// midnight Pacific, when the day's reads start again. Then it reads each
// collection group page by page in document order, one read per document
// (it listed every document and asked each for its subcollections until
// 2026-11-11, two or three reads each), and writes each page to the file as
// it comes, so a large database is never held in memory.
//
// Which collection groups: the literal collection names in firestore.rules,
// the only paths a client can write (everything else is denied), so a new
// collection is backed up from the day its rules are written.
//
// It reads; it never writes to Firestore. Restoring is a deliberate act,
// written for the occasion from the lines this leaves.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { isMain } from './admin/google.mjs';

/** The most documents a backup reads without --force. */
const MAX_READS = 35_000;
const PAGE = 500;

function fail(message) {
  console.error(`backup: ${message}`);
  process.exit(1);
}

/** The collection names a rules file's match paths name, in the order they appear. */
export function collectionsOf(rules) {
  const names = [];
  for (const m of rules.matchAll(/match\s+\/([^\s{][^\s]*)\s*\{/g)) {
    for (const segment of m[1].split('/')) {
      if (!segment || segment.startsWith('{') || segment === 'databases' || segment === 'documents') continue;
      if (!names.includes(segment)) names.push(segment);
    }
  }
  return names;
}

const at = process.argv.indexOf('--out');
const out = at > 0 ? process.argv[at + 1] : '';
const force = process.argv.includes('--force');
if (isMain(import.meta.url)) {
  if (!out) fail('say where with --out <folder outside the repository>.');
  const folder = resolve(out);
  const inside = relative(process.cwd(), folder);
  if (!inside.startsWith('..') && !isAbsolute(inside)) fail('the folder is inside this repository; choose one outside it, so client data never lands in git.');

  let app;
  let firestore;
  try {
    app = await import('firebase-admin/app');
    firestore = await import('firebase-admin/firestore');
  } catch {
    fail('the Admin SDK is not installed; run  npm i --no-save firebase-admin  first.');
  }

  const config = JSON.parse(readFileSync('firebase-applet-config.json', 'utf8'));
  // applicationDefault() takes GOOGLE_APPLICATION_CREDENTIALS, or gcloud's
  // application default credentials when it is not set.
  app.initializeApp({ credential: app.applicationDefault(), projectId: config.projectId });
  const db = config.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)'
    ? firestore.getFirestore(config.firestoreDatabaseId)
    : firestore.getFirestore();

  const groups = collectionsOf(readFileSync('firestore.rules', 'utf8'));
  const counts = {};
  let estimate = 0;
  for (const id of groups) {
    counts[id] = (await db.collectionGroup(id).count().get()).data().count;
    estimate += counts[id];
  }
  console.log(`backup: ${estimate} documents in ${groups.length} collection groups (${groups.map((g) => `${g} ${counts[g]}`).join(', ')}), so about ${estimate} reads.`);
  if (estimate > MAX_READS && !force) {
    fail(`that is more than ${MAX_READS} reads, most of the free plan's day. Run it just after midnight Pacific with --force, or not today.`);
  }

  mkdirSync(folder, { recursive: true });
  const file = join(folder, `forma-firestore-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`);
  let written = 0;
  for (const id of groups) {
    let last = null;
    for (;;) {
      let query = db.collectionGroup(id).orderBy(firestore.FieldPath.documentId()).limit(PAGE);
      if (last) query = query.startAfter(last);
      const page = await query.get();
      if (page.empty) break;
      appendFileSync(file, page.docs.map((d) => JSON.stringify({ path: d.ref.path, data: d.data() })).join('\n') + '\n');
      written += page.size;
      last = page.docs[page.docs.length - 1];
      if (page.size < PAGE) break;
    }
  }
  console.log(`backup: ${written} documents to ${file}`);
  for (const id of groups) console.log(`  ${String(counts[id]).padStart(6)}  ${id}`);
}
