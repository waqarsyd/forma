/**
 * How the owner's scripts reach Firestore and Firebase Authentication over
 * their REST APIs, with no dependency (2026-11-11, the full audit's batch LO,
 * SA-14). Used by scripts/model/pull-learning.ts, scripts/admin/orphans.mjs
 * and scripts/admin/stats.mjs; run on the owner's own PC only, never on the
 * company's shared server, because every credential below can read every
 * account.
 *
 * The credential, in this order:
 *   --key <file>                    a service account's JSON key
 *   GOOGLE_APPLICATION_CREDENTIALS  the same, by environment
 *   gcloud's application default credentials, after
 *     gcloud auth application-default login
 *   which needs no key file at all and is the one to prefer.
 *
 * Ask for as little as the job needs (SA-14). A service account made for
 * this, never the Admin SDK's own (which can change everything):
 *   roles/datastore.viewer       to read (the learning pull, stats, orphans,
 *                                and pull-errors.ts --keep)
 *   roles/firebaseauth.viewer    to look accounts up (the pull, orphans, stats)
 *   roles/datastore.user         only for the steps that delete (2026-11-12,
 *                                Owner decisions 10 and 15): the learning
 *                                pull's retention (events older than 90 days
 *                                it has saved) and its --reconcile (a deleted
 *                                account's events), both through its
 *                                --write-key, and pull-errors.ts (each error
 *                                report once saved)
 * Two service accounts keep the reading one viewer-only: --key for the pull,
 * --write-key for its deletes. Delete each key file once the run is done;
 * make a new one next time.
 *
 * The project is the key's own, or firebase-applet-config.json's; the
 * database is firebase.json's `firestore.databaseId`, then the applet
 * config's `firestoreDatabaseId`, then `(default)`.
 *
 * Pure ASCII, as every script here.
 */
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The value after `--<name>`, or undefined. */
export function option(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Every value after a repeated `--<name>`. */
export function options(argv, name) {
  return argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] && !argv[i + 1].startsWith('--') ? [argv[i + 1]] : []));
}

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

/** Where gcloud keeps the application default credentials on this machine. */
export function adcPath(env = process.env) {
  const base = process.platform === 'win32' ? env.APPDATA ?? join(homedir(), 'AppData', 'Roaming') : join(homedir(), '.config');
  return join(base, 'gcloud', 'application_default_credentials.json');
}

/** The project and the database this repository's Firebase config names. */
export function firebaseIds(root = '.') {
  const applet = readJson(join(root, 'firebase-applet-config.json')) ?? {};
  const config = readJson(join(root, 'firebase.json')) ?? {};
  return {
    project: applet.projectId ?? '',
    // firebase.json's field is `databaseId`; the pull read `database` until
    // 2026-11-11, so it always fell through to (default) (LM-17).
    database: config.firestore?.databaseId ?? applet.firestoreDatabaseId ?? '(default)',
  };
}

const base64url = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/**
 * The credential as { project, database, headers() }: `headers` gives the
 * request headers with a fresh access token (cached until a minute before it
 * expires). `fetchFn` is the network, so a test can stand in for Google.
 *
 * @param {{ keyPath?: string, root?: string, fetchFn?: (url: string, init: any) => Promise<any>, env?: Record<string, string | undefined> }} [o]
 */
export async function connect({ keyPath, root = '.', fetchFn = fetch, env = process.env } = {}) {
  const path = keyPath ?? env.GOOGLE_APPLICATION_CREDENTIALS ?? (existsSync(adcPath(env)) ? adcPath(env) : '');
  if (!path) {
    throw new Error('No credential: pass --key <service-account.json>, set GOOGLE_APPLICATION_CREDENTIALS, or run  gcloud auth application-default login  first.');
  }
  const cred = readJson(path);
  if (!cred) throw new Error(`${path} is not a JSON credential.`);
  const ids = firebaseIds(root);
  const scope = 'https://www.googleapis.com/auth/cloud-platform';
  let exchange;
  let project = ids.project;
  let quotaProject = '';
  if (cred.type === 'authorized_user') {
    // gcloud's own sign-in: a refresh token for the person, billed to a
    // quota project (Google asks for one on every user-credential call).
    quotaProject = cred.quota_project_id ?? ids.project;
    exchange = () => ({
      uri: 'https://oauth2.googleapis.com/token',
      body: `grant_type=refresh_token&client_id=${encodeURIComponent(cred.client_id)}&client_secret=${encodeURIComponent(cred.client_secret)}&refresh_token=${encodeURIComponent(cred.refresh_token)}`,
    });
  } else if (cred.client_email && cred.private_key) {
    project = cred.project_id ?? ids.project;
    const uri = cred.token_uri ?? 'https://oauth2.googleapis.com/token';
    exchange = () => {
      const now = Math.floor(Date.now() / 1000);
      const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claims = base64url(JSON.stringify({ iss: cred.client_email, scope, aud: uri, iat: now, exp: now + 3600 }));
      const signer = createSign('RSA-SHA256');
      signer.update(`${header}.${claims}`);
      const jwt = `${header}.${claims}.${base64url(signer.sign(cred.private_key))}`;
      return { uri, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}` };
    };
  } else {
    throw new Error(`${path} is neither a service account key nor gcloud's application default credentials.`);
  }
  if (!project) throw new Error('No Firebase project: firebase-applet-config.json names none and the credential carries none.');
  let token = '';
  let expires = 0;
  return {
    project,
    database: ids.database,
    async headers() {
      if (!token || Date.now() > expires) {
        const { uri, body } = exchange();
        const res = await fetchFn(uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
        if (!res.ok) throw new Error(`The token endpoint answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const answer = await res.json();
        token = answer.access_token;
        expires = Date.now() + Math.max(60, (answer.expires_in ?? 3600) - 60) * 1000;
      }
      return { authorization: `Bearer ${token}`, ...(quotaProject ? { 'x-goog-user-project': quotaProject } : {}) };
    },
  };
}

/** The Firestore REST root of a project's database. */
export const documentsUrl = (project, database) => `https://firestore.googleapis.com/v1/projects/${project}/databases/${encodeURIComponent(database)}/documents`;

/**
 * How many documents a collection group holds, by one count() aggregation:
 * Firestore bills one read per 1,000 index entries it counts, not one per
 * document, so a count costs a thousandth of reading what it counts.
 */
export async function countGroup(fetchFn, { url, headers, collectionId }) {
  const res = await fetchFn(`${url}:runAggregationQuery`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      structuredAggregationQuery: {
        structuredQuery: { from: [{ collectionId, allDescendants: true }] },
        aggregations: [{ alias: 'n', count: {} }],
      },
    }),
  });
  if (!res.ok) throw new Error(`Counting ${collectionId} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return countOf(await res.json());
}

/** The count in a runAggregationQuery answer. */
export function countOf(answer) {
  const rows = Array.isArray(answer) ? answer : [answer];
  for (const row of rows) {
    const v = row?.result?.aggregateFields?.n;
    if (v) return Number(v.integerValue ?? v.doubleValue ?? 0);
  }
  return 0;
}

/** The Identity Toolkit (Firebase Authentication's REST API) root of a project. */
export const authUrl = (project) => `https://identitytoolkit.googleapis.com/v1/projects/${project}`;

/**
 * Each uid's state: 'verified' (the account exists and its address is
 * verified, as a Google sign-in's always is), 'unverified', or 'gone'.
 * `accounts:lookup` takes up to 100 uids a call and is free.
 */
export async function lookupAccounts(fetchFn, { project, headers, uids }) {
  const states = new Map();
  const list = [...new Set(uids)];
  for (let i = 0; i < list.length; i += 100) {
    const batch = list.slice(i, i + 100);
    const res = await fetchFn(`${authUrl(project)}/accounts:lookup`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ localId: batch }),
    });
    if (!res.ok) throw new Error(`Looking accounts up answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const found = new Map(((await res.json()).users ?? []).map((u) => [u.localId, u]));
    for (const uid of batch) {
      const u = found.get(uid);
      states.set(uid, !u ? 'gone' : u.emailVerified ? 'verified' : 'unverified');
    }
  }
  return states;
}

/** Every uid Firebase Authentication holds, page by page (`accounts:batchGet`, free). */
export async function allAccountIds(fetchFn, { project, headers }) {
  const ids = new Set();
  let pageToken = '';
  for (;;) {
    const query = `maxResults=1000${pageToken ? `&nextPageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetchFn(`${authUrl(project)}/accounts:batchGet?${query}`, { method: 'GET', headers });
    if (!res.ok) throw new Error(`Listing accounts answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const page = await res.json();
    for (const u of page.users ?? []) ids.add(u.localId);
    if (!page.nextPageToken || !(page.users ?? []).length) return ids;
    pageToken = page.nextPageToken;
  }
}

/**
 * True when the module at `metaUrl` is the script node was started with, so a
 * test can import a script for its functions without running it.
 */
export function isMain(metaUrl) {
  const started = process.argv[1];
  if (!started) return false;
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p).replace(/\.(m?[jt]s)$/, '');
  return norm(resolve(started)) === norm(fileURLToPath(metaUrl));
}
