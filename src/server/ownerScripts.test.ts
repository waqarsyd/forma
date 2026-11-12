/**
 * The owner's scripts, run against a stand-in for Google (2026-11-11, the
 * full audit's batch LO). They run on the owner's own PC with a credential
 * that never touches the shared server this suite runs on, so none of them
 * is ever pointed at the real project here: each is imported for its
 * functions (every one runs only when it is the script node was started
 * with) and given a `fetch` that answers as Google would.
 *
 * Here rather than beside the scripts because the unit suite collects
 * `src/**` alone (vitest.config.ts), and in `src/server` because these, like
 * server.ts, are Node programs rather than browser code. What each proves:
 * - pull-learning.ts pages by cursor and resumes from `cursor.json` (LM-17),
 *   learns only from verified, existing accounts (LM-07), and removes from
 *   the owner's folder what the accounts no longer hold (LM-03);
 * - gate.ts passes the shipped model against itself and fails a damaged one
 *   (LM-21);
 * - deploy.mjs's designer check compares the digest and the size, not the
 *   name (SD-21);
 * - orphans.mjs and stats.mjs print what Google answers, and stats only
 *   counts (SA-20a, SA-28a); backup.mjs backs up every collection the rules
 *   name (SA-14);
 * - pull-errors.ts saves every error report and deletes only what it saved
 *   (2026-11-12, Owner decision 10).
 * The scratch folder is made and removed by the suite: beside the
 * repository on the owner's server (never C:, which fills up), the system's
 * temporary folder elsewhere.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { main as pull } from '../../scripts/model/pull-learning';
import { main as gate } from '../../scripts/model/gate';
import { errorsQuery, main as pullErrors } from '../../scripts/admin/pull-errors';
import { connect, countOf, lookupAccounts } from '../../scripts/admin/google.mjs';
import { findOrphans, orphansOf } from '../../scripts/admin/orphans.mjs';
import { countAll } from '../../scripts/admin/stats.mjs';
import { collectionsOf } from '../../scripts/backup.mjs';
import { designerAssetProblem, manifestOf } from '../../scripts/designer-asset.mjs';
import { accountKey, shortHash, type FetchLike } from '../lib/learningPipeline';
import { LINE_FEATURES } from '../lib/boxReader';
import { BOX_OWN, FEATURE_SIGNATURE } from '../lib/readerPairs';

const SCRATCH_ROOT = fs.existsSync(resolve('..', 'forma-model-data', 'work')) ? resolve('..', 'forma-model-data', 'work') : tmpdir();
const scratch = fs.mkdtempSync(join(SCRATCH_ROOT, 'lo-owner-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const keyFile = join(scratch, 'made-up-service-account.json');
fs.writeFileSync(keyFile, JSON.stringify({ type: 'service_account', project_id: 'made-up-project', client_email: 'learning-reader@made-up-project.iam.gserviceaccount.com', private_key: privateKey }));

type Reply = { ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> };
const reply = (body: unknown, status = 200): Reply => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

const skeletonJson = (height = 1169) =>
  JSON.stringify({
    paper: 'A4',
    landscape: false,
    width: 827,
    height,
    margins: { top: 50, bottom: 50, left: 40, right: 40 },
    bands: [{ kind: 'Detail', height: 20, groupFields: 0, controls: [{ kind: 'label', role: 'value', x: 0, y: 0, w: 100, h: 20, font: { family: 'Arial', size: 9, bold: false, italic: false }, align: 'left', borders: 0, chars: 0 }] }],
  });

const doc = (uid: string, id: string, at: string, over: Record<string, unknown> = {}) => {
  const e: Record<string, unknown> = { id, userId: uid, at, day: at.slice(0, 10), kind: 'generation', source: 'words', request: 'new', ai: 'gemini', skeleton: skeletonJson(), ops: [], errors: 0, warnings: 0, rating: '', full: '', prompt: '', ...over };
  const value = (v: unknown): Record<string, unknown> =>
    typeof v === 'number' ? { integerValue: String(v) } : Array.isArray(v) ? { arrayValue: { values: v.map(value) } } : typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) };
  return { name: `projects/made-up-project/databases/(default)/documents/users/${uid}/learning/${id}`, fields: Object.fromEntries(Object.entries(e).map(([k, v]) => [k, value(v)])) };
};

/** A Google that holds `docs`, knows `users`, and records what it was asked. */
function google(docs: ReturnType<typeof doc>[], users: { localId: string; emailVerified: boolean }[]) {
  const asked: { url: string; body: Record<string, unknown> | null; method: string }[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    const body = init.body && init.body.startsWith('{') ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    asked.push({ url, body, method: init.method });
    if (url.includes('oauth2')) return reply({ access_token: 'made-up-token', expires_in: 3600 });
    if (url.endsWith('accounts:lookup')) {
      const wanted = (body!.localId as string[]) ?? [];
      return reply({ users: users.filter((u) => wanted.includes(u.localId)) });
    }
    if (url.endsWith(':runAggregationQuery')) return reply([{ result: { aggregateFields: { n: { integerValue: String(docs.length) } } } }]);
    if (url.endsWith(':runQuery')) {
      // Filtered on `day` and ordered as asked, as Firestore would, so a
      // resumed pull reads what its query really selects.
      const q = body!.structuredQuery as {
        where?: { fieldFilter: { value: { stringValue: string } } };
        orderBy: { field: { fieldPath: string } }[];
        startAt?: { values: { referenceValue?: string }[] };
        limit: number;
      };
      const field = (d: ReturnType<typeof doc>, f: string) => (f === '__name__' ? d.name : String((d.fields[f] as { stringValue?: string } | undefined)?.stringValue ?? ''));
      const from = q.where?.fieldFilter.value.stringValue ?? '';
      const sorted = docs
        .filter((d) => field(d, 'day') >= from)
        .sort((a, b) => {
          for (const o of q.orderBy) {
            const [x, y] = [field(a, o.field.fieldPath), field(b, o.field.fieldPath)];
            if (x !== y) return x < y ? -1 : 1;
          }
          return 0;
        });
      const start = q.startAt ? sorted.findIndex((d) => d.name === q.startAt!.values.at(-1)!.referenceValue) + 1 : 0;
      const page = sorted.slice(start, start + q.limit);
      return reply(page.length ? page.map((document) => ({ document })) : [{ readTime: 'now' }]);
    }
    if (init.method === 'DELETE') return reply({});
    return reply({ error: 'not stood in for' }, 404);
  };
  return { fetchFn, asked };
}

describe('pull-learning.ts against a stand-in for Google', () => {
  const out = join(scratch, 'pulled');
  const docs = [
    doc('verified1', 'a1', '2026-11-10T10:00:00Z', { full: '<XtraReportsLayoutSerializer/>', prompt: 'made-up words' }),
    doc('verified1', 'a2', '2026-11-10T11:00:00Z', { ai: 'mock' }),
    doc('unverified1', 'b1', '2026-11-10T12:00:00Z'),
    doc('deleted1', 'c1', '2026-11-10T13:00:00Z'),
  ];
  const users = [
    { localId: 'verified1', emailVerified: true },
    { localId: 'unverified1', emailVerified: false },
  ];

  it('learns only from a verified account and a real AI, keeps the opt-in report, and leaves the gone account out', async () => {
    fs.mkdirSync(join(out, 'skeletons'), { recursive: true });
    fs.writeFileSync(join(out, 'skeletons', 'cleared.json'), JSON.stringify({ account: accountKey('verified1') }));
    const g = google(docs, users);
    expect(await pull(['--out', out, '--key', keyFile], g.fetchFn)).toBe(0);
    expect(fs.readdirSync(join(out, 'skeletons'))).toEqual(['a1.json']);
    const kept = JSON.parse(fs.readFileSync(join(out, 'skeletons', 'a1.json'), 'utf8')) as { account: string; hash: string; quality: unknown };
    expect(kept.account).toBe(accountKey('verified1'));
    expect(kept.quality).toEqual({ errors: 0, warnings: 0, rating: '' });
    expect(fs.readdirSync(join(out, 'repx'))).toEqual(['a1.repx']);
    expect(fs.readdirSync(join(out, 'prompts'))).toEqual(['a1.txt']);
    const lines = fs.readFileSync(join(out, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.map((l) => l.id)).toEqual(['a1', 'a2', 'b1']);
    for (const l of lines) {
      expect(l).not.toHaveProperty('skeleton');
      expect(l).not.toHaveProperty('full');
      expect(l).not.toHaveProperty('prompt');
    }
    // Pages by cursor, never by offset, and the token came from the key.
    const queries = g.asked.filter((a) => a.url.endsWith(':runQuery')).map((a) => a.body!.structuredQuery as Record<string, unknown>);
    for (const q of queries) expect(q).not.toHaveProperty('offset');
    expect(g.asked[0].url).toContain('oauth2');
    expect(JSON.parse(fs.readFileSync(join(out, 'cursor.json'), 'utf8'))).toEqual({ since: '', at: '2026-11-10T13:00:00Z' });
    const summary = JSON.parse(fs.readFileSync(join(out, 'summary.json'), 'utf8')) as { thisPull: { dropped: Record<string, number> } };
    expect(summary.thisPull.dropped).toEqual({ 'mock or no AI': 1, 'address not verified': 1, 'account gone': 1 });
  });

  it('resumes where it stopped, and removes what a person has since cleared', async () => {
    const later = [...docs.slice(1), doc('verified1', 'a3', '2026-11-10T21:00:00Z', { skeleton: skeletonJson(1100) })];
    const g = google(later, users);
    expect(await pull(['--out', out, '--key', keyFile], g.fetchFn)).toBe(0);
    // Resumed a lookback before the last trusted time, by day, not strictly after it.
    const first = g.asked.find((a) => a.url.endsWith(':runQuery'))!.body!.structuredQuery as { startAt?: unknown; where?: unknown };
    expect(first.startAt).toBeUndefined();
    expect(first.where).toEqual({ fieldFilter: { field: { fieldPath: 'day' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: '2026-10-11' } } });
    // a1 was cleared from the account: its skeleton, report and words go.
    expect(fs.readdirSync(join(out, 'skeletons'))).toEqual(['a3.json']);
    expect(fs.readdirSync(join(out, 'repx'))).toEqual([]);
    expect(fs.readdirSync(join(out, 'prompts'))).toEqual([]);
    // What it read again is not recorded or judged twice.
    const ids = fs.readFileSync(join(out, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => (JSON.parse(l) as { id: string }).id);
    expect(ids).toEqual(['a2', 'b1', 'a3']);
    expect(JSON.parse(fs.readFileSync(join(out, 'cursor.json'), 'utf8'))).toEqual({ since: '', at: '2026-11-10T21:00:00Z' });
  });

  it('is not stopped by an event with a made-up time, and still reads one that synced late', async () => {
    const own = join(scratch, 'pulled-poisoned');
    const real = doc('verified1', 'r1', '2026-11-10T10:00:00Z');
    const poison = [doc('verified1', 'z9', '9999-12-31T23:59:59Z'), doc('verified1', 'tilde', '~', { day: '~' })];
    const g1 = google([real, ...poison], users);
    expect(await pull(['--out', own, '--key', keyFile], g1.fetchFn)).toBe(0);
    expect(JSON.parse(fs.readFileSync(join(own, 'cursor.json'), 'utf8'))).toEqual({ since: '', at: '2026-11-10T10:00:00Z' });
    expect((JSON.parse(fs.readFileSync(join(own, 'summary.json'), 'utf8')) as { thisPull: { dropped: Record<string, number> } }).thisPull.dropped).toEqual({ 'unreadable time': 2 });
    expect(fs.readdirSync(join(own, 'skeletons'))).toEqual(['r1.json']);

    // A week later: a new event, and one from a device whose write synced
    // after the first pull although its time is earlier than the cursor.
    const late = doc('verified1', 'late', '2026-11-09T08:00:00Z', { skeleton: skeletonJson(1000) });
    // Times in the past, as a test run on any later day needs: a time after
    // the pull began is not trusted.
    const fresh = doc('verified1', 'r2', '2026-11-10T20:00:00Z', { skeleton: skeletonJson(1100) });
    const g2 = google([late, real, fresh, ...poison], users);
    expect(await pull(['--out', own, '--key', keyFile], g2.fetchFn)).toBe(0);
    expect(fs.readdirSync(join(own, 'skeletons')).sort()).toEqual(['late.json', 'r1.json', 'r2.json']);
    const ids = fs.readFileSync(join(own, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => (JSON.parse(l) as { id: string }).id);
    expect(ids).toEqual(['r1', 'late', 'r2']);
  });

  // The page pairs (2026-11-12, Owner decision 20, D10): structure, so the weekly pull brings them.
  it('saves a kept report\'s page pair beside the events, never in them, and lets it go when the report is undone', async () => {
    const own = join(scratch, 'pulled-pairs');
    const pair = JSON.stringify({ v: 1, features: FEATURE_SIGNATURE, page: [827, 1169], boxes: [[100, 140, 80, 8]], lines: [[0]], lineFeatures: [new Array(LINE_FEATURES.length).fill(0)], boxFeatures: [new Array(BOX_OWN).fill(0)], readBand: [4], readRole: [2], band: [4], role: [2] });
    const keptDoc = doc('verified1', 'k1', '2026-11-10T10:00:00Z', { kind: 'kept', skeleton: '', boxes: pair, ref: 'g1' });
    const g1 = google([keptDoc], users);
    expect(await pull(['--out', own, '--key', keyFile, '--skeletons-only'], g1.fetchFn)).toBe(0);
    const file = JSON.parse(fs.readFileSync(join(own, 'boxes', 'k1.json'), 'utf8')) as { ref: string; at: string; account: string; pair: { band: number[] } };
    expect(file).toMatchObject({ ref: 'g1', at: '2026-11-10T10:00:00Z', account: accountKey('verified1') });
    expect(file.pair.band).toEqual([4]);
    const line = JSON.parse(fs.readFileSync(join(own, 'events.jsonl'), 'utf8').trim()) as Record<string, unknown>;
    expect(line).not.toHaveProperty('boxes');
    expect(line.hasBoxes).toBe(true);
    const select = (g1.asked.find((a) => a.url.endsWith(':runQuery'))!.body!.structuredQuery as { select: { fields: { fieldPath: string }[] } }).select.fields.map((f) => f.fieldPath);
    expect(select).toContain('boxes');
    expect(select).not.toContain('full');
    // The report undone since: its pair goes.
    const g2 = google([keptDoc, doc('verified1', 'un1', '2026-11-10T11:00:00Z', { kind: 'undo', skeleton: '', ref: 'g1' })], users);
    expect(await pull(['--out', own, '--key', keyFile, '--skeletons-only'], g2.fetchFn)).toBe(0);
    expect(fs.readdirSync(join(own, 'boxes'))).toEqual([]);
  });

  it('counts first, and will not read most of the free day without --force', async () => {
    // 17,501 events: the id listing and the pull would read 35,002.
    const fetchFn: FetchLike = async (url) =>
      url.includes('oauth2') ? reply({ access_token: 't', expires_in: 3600 }) : url.endsWith(':runAggregationQuery') ? reply([{ result: { aggregateFields: { n: { integerValue: '17501' } } } }]) : reply({}, 500);
    expect(await pull(['--out', join(scratch, 'pulled-big'), '--key', keyFile], fetchFn)).toBe(1);
  });

  it('refuses a folder inside the repository', async () => {
    expect(await pull(['--out', 'pulled-here', '--key', keyFile], google([], []).fetchFn)).toBe(2);
  });
});

describe('train.ts', () => {
  const root = join(scratch, 'train');
  const pulledDir = join(root, 'pulled');
  const ownDir = join(root, 'own');
  const data = join(root, 'set');
  // train.ts runs as it is imported, so it is run as the owner runs it.
  const train = (...args: string[]) =>
    spawnSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/model/train.ts', '--data', data, '--out', join(root, 'candidate.json'), '--k', '2', ...args], { encoding: 'utf8' }).status;
  // Names the hold-out picks at 0.99, found rather than assumed.
  const heldName = (i: number) => {
    for (let n = i; ; n++) if (parseInt(shortHash(`p${n}.json`).slice(-6), 16) / 0x1000000 < 0.99) return `p${n}.json`;
  };

  it('empties what it rebuilds, so a skeleton deleted from the pull leaves the held-out set too', () => {
    const shipped = JSON.parse(fs.readFileSync('assets/model/formaModel.json', 'utf8')) as { archetypes: { skeleton: unknown }[] };
    fs.mkdirSync(ownDir, { recursive: true });
    // Every archetype: under five reports no font is a house font, and a role's
    // font then fails the leak check, which is not what this test is about.
    for (const [i, a] of shipped.archetypes.entries()) fs.writeFileSync(join(ownDir, `own${i}.json`), JSON.stringify({ category: null, skeleton: a.skeleton }));
    fs.mkdirSync(join(pulledDir, 'skeletons'), { recursive: true });
    fs.writeFileSync(join(pulledDir, 'events.jsonl'), '');
    const first = heldName(1);
    const second = heldName(Number(first.slice(1, -5)) + 1);
    for (const name of [first, second]) fs.writeFileSync(join(pulledDir, 'skeletons', name), JSON.stringify({ category: null, skeleton: shipped.archetypes[0].skeleton, account: accountKey(name) }));

    expect(train('--skeletons', ownDir, '--skeletons', join(pulledDir, 'skeletons'), '--hold-out', '0.99')).toBe(0);
    expect(fs.readdirSync(join(data, 'held-out')).sort()).toEqual([first, second].sort());
    const before = fs.readdirSync(join(data, 'skeletons')).length;

    // The person behind `first` cleared their learning; the pull removed it.
    fs.rmSync(join(pulledDir, 'skeletons', first));
    fs.writeFileSync(join(data, 'skeletons', '999.json'), '{}');
    expect(train('--skeletons', ownDir, '--skeletons', join(pulledDir, 'skeletons'), '--hold-out', '0.99')).toBe(0);
    expect(fs.readdirSync(join(data, 'held-out'))).toEqual([second]);
    expect(fs.readdirSync(join(data, 'skeletons'))).toHaveLength(before);
  }, 120_000);

  it('refuses a source inside the folders it empties', () => {
    expect(train('--skeletons', join(data, 'skeletons'))).toBe(2);
  }, 60_000);
});

describe('gate.ts', () => {
  it('passes the shipped model against itself, and fails one damaged on purpose', () => {
    expect(gate(['--candidate', 'assets/model/formaModel.json'])).toBe(0);
    const damaged = JSON.parse(fs.readFileSync('assets/model/formaModel.json', 'utf8')) as { style: { roles: Record<string, { size: number }> } };
    for (const role of Object.values(damaged.style.roles)) role.size = 40;
    const file = join(scratch, 'damaged-candidate.json');
    fs.writeFileSync(file, JSON.stringify(damaged));
    expect(gate(['--candidate', file])).toBe(1);
  });
});

describe('the Forma Designer download on its release (deploy.mjs)', () => {
  const source = "\n  file: 'FormaDesigner-1.0.0-windows.zip',\n  bytes: 100285,\n  sha256: 'abc123',\n  tag: 'v1.4.0',\n";
  const manifest = manifestOf(source);

  it('reads the manifest as the deploy does, the size as a number', () => {
    expect(manifest).toEqual({ tag: 'v1.4.0', file: 'FormaDesigner-1.0.0-windows.zip', sha256: 'abc123', bytes: 100285 });
  });

  it('takes the zip only when its digest and size are the manifest\'s, not its name alone', () => {
    const asset = { name: manifest.file, digest: 'sha256:abc123', size: 100285 };
    expect(designerAssetProblem([asset], manifest)).toBeNull();
    expect(designerAssetProblem([{ ...asset, digest: 'sha256:other' }], manifest)).toMatch(/not the zip the manifest describes/);
    expect(designerAssetProblem([{ ...asset, size: 99 }], manifest)).toMatch(/99 bytes/);
    expect(designerAssetProblem([{ ...asset, name: 'other.zip' }], manifest)).toMatch(/carries no/);
    expect(designerAssetProblem(null, manifest)).toMatch(/does not exist/);
  });
});

describe('the admin scripts', () => {
  it('reads the credential, and asks each account\'s state 100 at a time', async () => {
    const g = google([], [{ localId: 'u1', emailVerified: true }, { localId: 'u2', emailVerified: false }]);
    const cred = await connect({ keyPath: keyFile, fetchFn: g.fetchFn });
    expect(cred.project).toBe('made-up-project');
    expect(await cred.headers()).toEqual({ authorization: 'Bearer made-up-token' });
    const uids = ['u1', 'u2', ...Array.from({ length: 120 }, (_, i) => `x${i}`)];
    const states = await lookupAccounts(g.fetchFn, { project: cred.project, headers: await cred.headers(), uids });
    expect(states.get('u1')).toBe('verified');
    expect(states.get('u2')).toBe('unverified');
    expect(states.get('x7')).toBe('gone');
    expect(g.asked.filter((a) => a.url.endsWith('accounts:lookup'))).toHaveLength(2);
  });

  it('lists the account folders no account owns any more, and deletes nothing', async () => {
    expect(orphansOf(['a', 'b', 'c'], new Set(['b']))).toEqual(['a', 'c']);
    const asked: string[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      asked.push(`${init.method} ${url}`);
      if (url.includes('/documents/users')) return reply({ documents: [{ name: 'projects/p/databases/(default)/documents/users/kept' }, { name: 'projects/p/databases/(default)/documents/users/orphan' }] });
      if (url.includes('accounts:batchGet')) return reply({ users: [{ localId: 'kept' }] });
      return reply({}, 404);
    };
    const cred = { project: 'p', database: '(default)', headers: async () => ({ authorization: 'Bearer t' }) };
    expect(await findOrphans(fetchFn, cred)).toEqual({ held: 2, accounts: 1, orphans: ['orphan'] });
    expect(asked.every((a) => a.startsWith('GET '))).toBe(true);
    expect(asked[0]).toContain('showMissing=true');
  });

  it('counts with aggregation queries and reads no document', async () => {
    const asked: { url: string; body: string }[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      asked.push({ url, body: init.body ?? '' });
      if (url.endsWith(':runAggregationQuery')) {
        const id = (JSON.parse(init.body!) as { structuredAggregationQuery: { structuredQuery: { from: { collectionId: string }[] } } }).structuredAggregationQuery.structuredQuery.from[0].collectionId;
        return reply([{ result: { aggregateFields: { n: { integerValue: String({ reports: 12, shares: 3, learning: 40 }[id] ?? 0) } } } }]);
      }
      if (url.endsWith('accounts:query')) return reply({ recordsCount: '7' });
      return reply({}, 404);
    };
    const cred = { project: 'p', database: '(default)', headers: async () => ({ authorization: 'Bearer t' }) };
    expect(await countAll(fetchFn, cred)).toEqual({ reports: 12, shares: 3, learning: 40, accounts: 7 });
    expect(asked.some((a) => a.url.endsWith(':runQuery'))).toBe(false);
    expect(JSON.parse(asked.find((a) => a.url.endsWith('accounts:query'))!.body)).toEqual({ returnUserInfo: false });
    expect(countOf([{ readTime: 'x' }])).toBe(0);
  });

  it('backs up every collection the rules name', () => {
    expect(collectionsOf(fs.readFileSync('firestore.rules', 'utf8'))).toEqual(['users', 'vault', 'reports', 'reportIndex', 'shares', 'acl', 'meta', 'learning', 'errors', 'versions']);
  });
});

/*
 * The error reports' pull (2026-11-12, Owner decision 10, SA-15): every
 * report saved on the owner's PC, then deleted from Firestore, never one
 * deleted before the line holding it is written.
 */
describe('pull-errors.ts against a stand-in for Google', () => {
  const errorDoc = (id: string, message = 'Cannot read properties of null') => ({
    name: `projects/made-up-project/databases/(default)/documents/errors/${id}`,
    fields: { day: { stringValue: '2026-11-12' }, version: { stringValue: '1.6.0+abc1234' }, area: { stringValue: 'preview' }, code: { stringValue: 'TypeError' }, message: { stringValue: message } },
  });
  /** A Google holding `docs` in `errors`, which a DELETE removes; `refuse` answers every DELETE 403. */
  function errorsGoogle(docs: ReturnType<typeof errorDoc>[], refuse = false) {
    const held = [...docs];
    const asked: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      const body = init.body && init.body.startsWith('{') ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      asked.push({ url, method: init.method, body });
      if (url.includes('oauth2')) return reply({ access_token: 'made-up-token', expires_in: 3600 });
      if (url.endsWith(':runAggregationQuery')) return reply([{ result: { aggregateFields: { n: { integerValue: String(held.length) } } } }]);
      if (url.endsWith(':runQuery')) {
        const q = body!.structuredQuery as { startAt?: { values: { referenceValue: string }[] }; limit: number };
        const sorted = [...held].sort((a, b) => (a.name < b.name ? -1 : 1));
        const start = q.startAt ? sorted.filter((d) => d.name > q.startAt!.values[0].referenceValue) : sorted;
        const page = start.slice(0, q.limit);
        return reply(page.length ? page.map((document) => ({ document })) : [{ readTime: 'now' }]);
      }
      if (init.method === 'DELETE') {
        if (refuse) return reply({ error: 'PERMISSION_DENIED' }, 403);
        const at = held.findIndex((d) => url.endsWith(d.name));
        if (at >= 0) held.splice(at, 1);
        return reply({});
      }
      return reply({ error: 'not stood in for' }, 404);
    };
    return { fetchFn, asked, held };
  }

  it('saves every report, then deletes each one it saved', async () => {
    const out = join(scratch, 'errors');
    const g = errorsGoogle([errorDoc('e1'), errorDoc('e2', 'Maximum update depth exceeded')]);
    expect(await pullErrors(['--out', out, '--key', keyFile], g.fetchFn)).toBe(0);
    const lines = fs.readFileSync(join(out, 'errors.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, string>);
    expect(lines).toEqual([
      { id: 'e1', day: '2026-11-12', version: '1.6.0+abc1234', area: 'preview', code: 'TypeError', message: 'Cannot read properties of null' },
      { id: 'e2', day: '2026-11-12', version: '1.6.0+abc1234', area: 'preview', code: 'TypeError', message: 'Maximum update depth exceeded' },
    ]);
    expect(g.held).toEqual([]);
    // The first DELETE comes after the query that read the page it deletes from.
    const firstDelete = g.asked.findIndex((a) => a.method === 'DELETE');
    expect(firstDelete).toBeGreaterThan(g.asked.findIndex((a) => a.url.endsWith(':runQuery')));
    const summary = JSON.parse(fs.readFileSync(join(out, 'summary.json'), 'utf8')) as { pulled: number; deleted: number; byArea: Record<string, number> };
    expect(summary).toMatchObject({ pulled: 2, deleted: 2, byArea: { preview: 2 } });
  });

  it('with --keep deletes nothing, and a second pull writes nothing twice', async () => {
    const out = join(scratch, 'errors-kept');
    const g = errorsGoogle([errorDoc('k1')]);
    expect(await pullErrors(['--out', out, '--key', keyFile, '--keep'], g.fetchFn)).toBe(0);
    expect(g.asked.some((a) => a.method === 'DELETE')).toBe(false);
    expect(await pullErrors(['--out', out, '--key', keyFile], g.fetchFn)).toBe(0);
    expect(fs.readFileSync(join(out, 'errors.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
    // The second run deletes what the first saved.
    expect(g.held).toEqual([]);
  });

  it('says which role a refused delete needs, with the page already saved', async () => {
    const out = join(scratch, 'errors-viewer');
    const g = errorsGoogle([errorDoc('v1')], true);
    await expect(pullErrors(['--out', out, '--key', keyFile], g.fetchFn)).rejects.toThrow(/roles\/datastore\.user, or --keep/);
    expect(fs.readFileSync(join(out, 'errors.jsonl'), 'utf8')).toContain('"id":"v1"');
  });

  it('pages by document name, never by offset, and refuses a folder inside the repository', async () => {
    expect(errorsQuery('projects/p/databases/(default)/documents/errors/x')).toMatchObject({ startAt: { values: [{ referenceValue: 'projects/p/databases/(default)/documents/errors/x' }], before: false } });
    expect(errorsQuery(null)).not.toHaveProperty('offset');
    expect(await pullErrors(['--out', 'errors-here', '--key', keyFile], errorsGoogle([]).fetchFn)).toBe(2);
  });
});
