/**
 * Pull what people let Forma learn from (2026-11-10, the full audit):
 * every account's learning events (lib/learning.ts, Firestore
 * users/{uid}/learning/{id}) into a folder OUTSIDE the repository, as the
 * sets the model scripts read.
 *
 *   npx tsx scripts/model/pull-learning.ts --key <service-account.json> --out <dir> [--since YYYY-MM-DD]
 *
 * --key    a service account's JSON key for the Firebase project (Project
 *          settings > Service accounts > Generate new private key), with the
 *          Cloud Datastore User role. It bypasses the security rules, which
 *          is why it is the OWNER'S, read from their own PC, and never from a
 *          user's browser or this shared server (the company's RDP account).
 *          GOOGLE_APPLICATION_CREDENTIALS is read when --key is absent.
 * --out    where the events go. Kept outside the repository, as every
 *          training set is: forma-model-data/learning/<date> on the owner's PC.
 * --since  only events from that day on (the `day` field), for a weekly pull.
 *
 * Written, under --out:
 *   events.jsonl        every event as pulled, one per line, the full report
 *                       and the words left out (they are in the files below)
 *   skeletons/<id>.json {category: null, skeleton}, the shape train.ts reads
 *                       through --skeletons, for every event with a skeleton
 *   repx/<id>.repx      the whole report, on the opt-in tier only, the shape
 *                       train.ts reads through --reports and the library takes
 *   prompts/<id>.txt    the person's words with it, the same tier
 *   summary.json        counts by kind, tier, AI and day; no content
 *
 * Then, on the owner's PC:
 *   npm run model:train -- --skeletons <out>/skeletons --reports <out>/repx --data <set> --out assets/model/formaModel.json
 * and the box reader, the library examples and the chat judge's cases take
 * the repx and prompts folders by hand, since each needs a person's look.
 *
 * No dependency: the service account's key signs a JWT with node:crypto,
 * Google's token endpoint turns it into an access token, and the Firestore
 * REST API answers a collection-group query over `learning`, page by page.
 * The console prints counts only, never an event's content. Pure ASCII, as
 * every script here.
 */
import { createSign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const keyPath = option('key') ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
const outDir = option('out');
const since = option('since') ?? '';
if (!keyPath || !outDir) {
  console.error('Usage: npx tsx scripts/model/pull-learning.ts --key <service-account.json> --out <dir> [--since YYYY-MM-DD]');
  process.exit(2);
}
const out = resolve(outDir);
const within = relative(resolve('.'), out);
if (!within.startsWith('..') && !isAbsolute(within)) {
  console.error('--out is inside the repository. Keep what people share outside it.');
  process.exit(2);
}
if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error('--since must be a day as YYYY-MM-DD.');
  process.exit(2);
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const account = JSON.parse(readFileSync(keyPath, 'utf8')) as ServiceAccount;
if (!account.project_id || !account.client_email || !account.private_key) {
  console.error('The key file is not a service account key (project_id, client_email and private_key are needed).');
  process.exit(2);
}
const databaseId = ((JSON.parse(readFileSync('firebase.json', 'utf8')) as { firestore?: { database?: string } }).firestore?.database ?? '(default)');

const base64url = (s: Buffer | string) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** An access token for Firestore, from the service account's key: a signed JWT exchanged at Google's token endpoint. */
async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = account.token_uri ?? 'https://oauth2.googleapis.com/token';
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: tokenUri, iat: now, exp: now + 3600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${base64url(signer.sign(account.private_key))}`;
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`The token endpoint answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

type FirestoreValue = { stringValue?: string; integerValue?: string; doubleValue?: number; booleanValue?: boolean; nullValue?: null; arrayValue?: { values?: FirestoreValue[] }; mapValue?: { fields?: Record<string, FirestoreValue> } };

/** A Firestore REST value as plain JSON. */
function plain(v: FirestoreValue): unknown {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(plain);
  if (v.mapValue) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, plain(x)]));
  return null;
}

interface Event {
  id: string;
  userId: string;
  at: string;
  day: string;
  kind: string;
  source: string;
  request: string;
  ai: string;
  skeleton: string;
  ops: string[];
  errors: number;
  warnings: number;
  rating: string;
  full: string;
  prompt: string;
}

/** Every event, oldest first, in pages of 300 through a collection-group query. */
async function* events(token: string): AsyncGenerator<Event> {
  const url = `https://firestore.googleapis.com/v1/projects/${account.project_id}/databases/${encodeURIComponent(databaseId)}/documents:runQuery`;
  const filter = since ? { fieldFilter: { field: { fieldPath: 'day' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: since } } } : undefined;
  let offset = 0;
  for (;;) {
    const structuredQuery = {
      from: [{ collectionId: 'learning', allDescendants: true }],
      ...(filter ? { where: filter } : {}),
      orderBy: [{ field: { fieldPath: 'at' }, direction: 'ASCENDING' }],
      offset,
      limit: 300,
    };
    const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ structuredQuery }) });
    if (!res.ok) throw new Error(`Firestore answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const rows = (await res.json()) as { document?: { name: string; fields: Record<string, FirestoreValue> } }[];
    const docs = rows.filter((r) => r.document);
    for (const r of docs) yield plain({ mapValue: { fields: r.document!.fields } }) as Event;
    if (docs.length < 300) return;
    offset += docs.length;
  }
}

async function main() {
  for (const dir of ['skeletons', 'repx', 'prompts']) mkdirSync(join(out, dir), { recursive: true });
  const token = await accessToken();
  const summary = { pulled: 0, withSkeleton: 0, fullReports: 0, byKind: {} as Record<string, number>, byAi: {} as Record<string, number>, byDay: {} as Record<string, number>, accounts: 0 };
  const accounts = new Set<string>();
  const lines: string[] = [];
  for await (const e of events(token)) {
    if (!e.id || !/^[a-zA-Z0-9_-]+$/.test(e.id)) continue;
    summary.pulled++;
    accounts.add(e.userId);
    summary.byKind[e.kind] = (summary.byKind[e.kind] ?? 0) + 1;
    summary.byAi[e.ai] = (summary.byAi[e.ai] ?? 0) + 1;
    summary.byDay[e.day] = (summary.byDay[e.day] ?? 0) + 1;
    const { full, prompt, skeleton, ...rest } = e;
    lines.push(JSON.stringify({ ...rest, hasSkeleton: skeleton !== '', hasFull: full !== '' }));
    if (skeleton) {
      summary.withSkeleton++;
      try {
        writeFileSync(join(out, 'skeletons', `${e.id}.json`), JSON.stringify({ category: null, skeleton: JSON.parse(skeleton) }));
      } catch {
        /* a skeleton that is not JSON is left out */
      }
    }
    if (full) {
      summary.fullReports++;
      writeFileSync(join(out, 'repx', `${e.id}.repx`), full);
      if (prompt) writeFileSync(join(out, 'prompts', `${e.id}.txt`), prompt);
    }
  }
  summary.accounts = accounts.size;
  writeFileSync(join(out, 'events.jsonl'), lines.join('\n') + (lines.length ? '\n' : ''));
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(`pulled ${summary.pulled} events from ${summary.accounts} accounts${since ? ` since ${since}` : ''}: ${summary.withSkeleton} with a skeleton, ${summary.fullReports} full reports (opt-in)`);
  console.log(`by kind: ${Object.entries(summary.byKind).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
  console.log(`by AI: ${Object.entries(summary.byAi).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
  console.log(`written under ${out}${existsSync(join(out, 'events.jsonl')) ? '' : ' (nothing)'}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
