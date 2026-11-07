// A copy of everything in Forma's Firestore, run by the owner (2026-11-08,
// site audit item 66). Pure ASCII, as every script here.
//
// The free plan has no managed backup: Firestore's own export and its
// scheduled backups need the paid plan. A person can download their own
// projects (Settings, General, "Download all"); this is the whole database,
// for the owner: every document under every collection, one JSON line each,
// written to a folder outside this repository.
//
// It needs what only the owner has, so nothing here runs it:
//   1. A service account key: Firebase console, Project settings, Service
//      accounts, Generate new private key. Keep the file outside this
//      repository (.gitignore refuses the usual names anyway) and delete it
//      when you are done; it can read and write everything.
//   2. The Admin SDK, for this run only:  npm i --no-save firebase-admin
//   3. GOOGLE_APPLICATION_CREDENTIALS set to that key's path, then
//        node scripts/backup.mjs --out <a folder outside the repository>
//
// It reads; it never writes to Firestore. Restoring is a deliberate act,
// written for the occasion from the lines this leaves.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

function fail(message) {
  console.error(`backup: ${message}`);
  process.exit(1);
}

const at = process.argv.indexOf('--out');
const out = at > 0 ? process.argv[at + 1] : '';
if (!out) fail('say where with --out <folder outside the repository>.');
const folder = resolve(out);
const inside = relative(process.cwd(), folder);
if (!inside.startsWith('..') && !isAbsolute(inside)) fail('the folder is inside this repository; choose one outside it, so client data never lands in git.');
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) fail('set GOOGLE_APPLICATION_CREDENTIALS to the service account key first.');

let app;
let firestore;
try {
  app = await import('firebase-admin/app');
  firestore = await import('firebase-admin/firestore');
} catch {
  fail('the Admin SDK is not installed; run  npm i --no-save firebase-admin  first.');
}

const config = JSON.parse(readFileSync('firebase-applet-config.json', 'utf8'));
app.initializeApp({ credential: app.applicationDefault(), projectId: config.projectId });
const db = config.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)'
  ? firestore.getFirestore(config.firestoreDatabaseId)
  : firestore.getFirestore();

const lines = [];
const counts = {};

// listDocuments, not get: a parent such as users/{uid} often has no document
// of its own, only subcollections, and get() would skip it and everything
// under it.
async function walk(collection) {
  for (const ref of await collection.listDocuments()) {
    const snap = await ref.get();
    if (snap.exists) {
      lines.push(JSON.stringify({ path: ref.path, data: snap.data() }));
      const top = ref.path.split('/').filter((_, i) => i % 2 === 0).join('/');
      counts[top] = (counts[top] || 0) + 1;
    }
    for (const sub of await ref.listCollections()) await walk(sub);
  }
}

for (const collection of await db.listCollections()) await walk(collection);

mkdirSync(folder, { recursive: true });
const file = join(folder, `forma-firestore-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`);
writeFileSync(file, lines.join('\n') + '\n');
console.log(`backup: ${lines.length} documents to ${file}`);
for (const [path, n] of Object.entries(counts).sort()) console.log(`  ${String(n).padStart(6)}  ${path}`);
