#!/usr/bin/env node
/**
 * Which accounts' data outlived the account? (2026-11-11, the full audit,
 * SA-20a.) For the owner, on the owner's own PC.
 *
 *   node scripts/admin/orphans.mjs [--key <credential.json>]
 *
 * Deleting a person in the Firebase console's Authentication tab removes the
 * sign-in, not what the account kept: `users/{uid}/**` (projects, the index,
 * the key vault, the quota, learning) stays in Firestore, and so do the
 * shares it made. The app deletes all of it when a person deletes their own
 * account, but a deletion made by hand, or one that failed half way, leaves
 * an orphan nothing lists. This lists them: every `users/{uid}` Firestore
 * holds (as a document or only as the parent of subcollections) whose uid
 * Firebase Authentication no longer has.
 *
 * It PRINTS the uids and changes nothing. Deleting one is a deliberate act,
 * and how to answer a data request is in docs/notes/persistence.md:
 *   npx firebase firestore:delete users/<uid> --recursive --project forma-201ba
 * then the shares whose ownerId is that uid.
 *
 * The credential is read by scripts/admin/google.mjs (gcloud's application
 * default credentials, or a viewer-only service account's key: roles/
 * datastore.viewer and roles/firebaseauth.viewer). It costs one Firestore
 * read per page of up to 300 uids listed, and nothing on the Authentication
 * side. Pure ASCII, as every script here.
 */
import { allAccountIds, connect, documentsUrl, isMain, option } from './google.mjs';

/** Every uid under `users/`, a document or only a parent of subcollections (`showMissing`), page by page. */
export async function firestoreUserIds(fetchFn, { url, headers }) {
  const ids = [];
  let pageToken = '';
  for (;;) {
    // mask.fieldPaths names a field no user document has, so only names come back.
    const query = `pageSize=300&showMissing=true&mask.fieldPaths=formaNoSuchField${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetchFn(`${url}/users?${query}`, { method: 'GET', headers });
    if (!res.ok) throw new Error(`Listing users answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const page = await res.json();
    for (const d of page.documents ?? []) ids.push(d.name.slice(d.name.lastIndexOf('/') + 1));
    if (!page.nextPageToken) return ids;
    pageToken = page.nextPageToken;
  }
}

/** The uids Firestore holds that Authentication does not, in order. */
export const orphansOf = (firestoreIds, accountIds) => firestoreIds.filter((uid) => !accountIds.has(uid));

/** The whole check, with the network given: what main prints. */
export async function findOrphans(fetchFn, cred) {
  const headers = await cred.headers();
  const held = await firestoreUserIds(fetchFn, { url: documentsUrl(cred.project, cred.database), headers });
  const accounts = await allAccountIds(fetchFn, { project: cred.project, headers });
  return { held: held.length, accounts: accounts.size, orphans: orphansOf(held, accounts) };
}

if (isMain(import.meta.url)) {
  try {
    const cred = await connect({ keyPath: option(process.argv, 'key') });
    const { held, accounts, orphans } = await findOrphans(fetch, cred);
    console.log(`orphans: ${held} account folder(s) in Firestore, ${accounts} account(s) in Authentication, ${orphans.length} folder(s) with no account.`);
    for (const uid of orphans) console.log(`  ${uid}`);
    if (orphans.length) console.log('Nothing was deleted. docs/notes/persistence.md says how to answer a data request.');
  } catch (err) {
    console.error(`orphans: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
