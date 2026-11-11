#!/usr/bin/env node
/**
 * How much is Forma used? Counts only (2026-11-11, the full audit, SA-28a).
 * For the owner, on the owner's own PC.
 *
 *   node scripts/admin/stats.mjs [--key <credential.json>]
 *
 * Until this the owner could learn how many projects, shares or learning
 * events there were only by reading them all (backup.mjs, pull-learning.ts),
 * which reads every person's content to print a number. This asks Firestore
 * to COUNT instead (`runAggregationQuery` count(): one billed read per
 * thousand documents counted, and no document's content leaves Google), and
 * Firebase Authentication for its number of accounts (`accounts:query` with
 * no user information, free). It prints numbers and nothing else.
 *
 * The credential is read by scripts/admin/google.mjs (gcloud's application
 * default credentials, or a viewer-only service account's key: roles/
 * datastore.viewer and roles/firebaseauth.viewer). Pure ASCII, as every
 * script here.
 */
import { authUrl, connect, countGroup, documentsUrl, isMain, option } from './google.mjs';

/** The collection groups counted, and what each holds. */
export const GROUPS = [
  ['reports', 'saved projects'],
  ['shares', 'shared links'],
  ['learning', 'learning events'],
];

/** How many accounts Authentication holds, with no user's information returned. */
export async function accountCount(fetchFn, { project, headers }) {
  const res = await fetchFn(`${authUrl(project)}/accounts:query`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ returnUserInfo: false }),
  });
  if (!res.ok) throw new Error(`Counting accounts answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Number((await res.json()).recordsCount ?? 0);
}

/** Every count, with the network given: what main prints. */
export async function countAll(fetchFn, cred) {
  const headers = await cred.headers();
  const url = documentsUrl(cred.project, cred.database);
  const counts = {};
  for (const [id] of GROUPS) counts[id] = await countGroup(fetchFn, { url, headers, collectionId: id });
  counts.accounts = await accountCount(fetchFn, { project: cred.project, headers });
  return counts;
}

if (isMain(import.meta.url)) {
  try {
    const cred = await connect({ keyPath: option(process.argv, 'key') });
    const counts = await countAll(fetch, cred);
    console.log(`stats for ${cred.project}, ${new Date().toISOString().slice(0, 10)}:`);
    console.log(`  ${String(counts.accounts).padStart(7)}  accounts`);
    for (const [id, what] of GROUPS) console.log(`  ${String(counts[id]).padStart(7)}  ${what}`);
  } catch (err) {
    console.error(`stats: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
