/**
 * The owner's learning pipeline (2026-11-11, the full audit's batch LO): the
 * pull pages by cursor, one account cannot poison what is learned, deletion
 * reaches the owner's copies, and a candidate model passes the gate only when
 * nothing drops. Every account, event and skeleton here is made up; the
 * folder a reconcile is tried on is made and removed by the test.
 */
import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  accountKey,
  advanceResume,
  applyReconcile,
  expiringPages,
  expiryQuery,
  forgottenMarkers,
  gateModels,
  RETENTION_DAYS,
  retentionCutoff,
  LOOKBACK_DAYS,
  meanNearest,
  planReconcile,
  pullPages,
  pullQuery,
  resumeSince,
  scoreDescribed,
  selectPairs,
  selectTraining,
  SKELETON_FIELDS,
  soundSkeleton,
  trustedAt,
  type DescribedCase,
  type FetchLike,
  type FsLike,
  type PulledEvent,
} from './learningPipeline';
import type { FormaModel } from './formaModel';
import type { ReportSkeleton } from './reportSkeleton';
import { LINE_FEATURES } from './boxReader';
import { BOX_OWN, FEATURE_SIGNATURE } from './readerPairs';

/** A sound skeleton, as the app sends one: a title, a ruled heading table, a Detail row. */
function skeleton(over: Partial<ReportSkeleton> = {}, family = 'Arial'): ReportSkeleton {
  const font = { family, size: 9, bold: false, italic: false };
  return {
    paper: 'A4',
    landscape: false,
    width: 827,
    height: 1169,
    margins: { top: 50, bottom: 50, left: 40, right: 40 },
    bands: [
      { kind: 'TopMargin', height: 50, groupFields: 0, controls: [] },
      { kind: 'ReportHeader', height: 40, groupFields: 0, controls: [{ kind: 'label', role: 'title', x: 0, y: 0, w: 400, h: 30, font: { ...font, size: 16, bold: true }, align: 'left', borders: 0, chars: 14 }] },
      {
        kind: 'Detail',
        height: 20,
        groupFields: 0,
        controls: [
          {
            kind: 'table',
            role: 'value',
            x: 0,
            y: 0,
            w: 700,
            h: 20,
            font,
            align: 'left',
            borders: 15,
            chars: 0,
            rows: [[{ weight: 1, role: 'value', align: 'left', chars: 0, font }, { weight: 1, role: 'value', align: 'right', chars: 0, font }]],
          },
        ],
      },
      { kind: 'BottomMargin', height: 50, groupFields: 0, controls: [] },
    ],
    ...over,
  };
}

let next = 0;
function event(over: Partial<PulledEvent> = {}): PulledEvent {
  next++;
  return {
    id: `e${next}`,
    userId: 'alice',
    at: `2026-11-1${next % 10}T10:00:00.000Z`,
    day: '2026-11-11',
    kind: 'generation',
    source: 'words',
    request: 'new',
    ai: 'gemini',
    skeleton: JSON.stringify(skeleton()),
    ops: [],
    errors: 0,
    warnings: 0,
    rating: '',
    full: '',
    prompt: '',
    ...over,
  };
}

describe('pullQuery', () => {
  it('pages from a cursor and never by offset, ordered by the filtered field first', () => {
    const first = pullQuery({ since: '2026-11-04' });
    expect(first).not.toHaveProperty('offset');
    expect(first).not.toHaveProperty('startAt');
    expect(first.where).toEqual({ fieldFilter: { field: { fieldPath: 'day' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: '2026-11-04' } } });
    expect((first.orderBy as { field: { fieldPath: string } }[]).map((o) => o.field.fieldPath)).toEqual(['day', 'at', '__name__']);

    const after = { since: '2026-11-04', day: '2026-11-05', at: '2026-11-05T09:00:00Z', name: 'projects/p/databases/(default)/documents/users/u/learning/x' };
    expect(pullQuery({ since: '2026-11-04', after }).startAt).toEqual({
      values: [{ stringValue: '2026-11-05' }, { stringValue: '2026-11-05T09:00:00Z' }, { referenceValue: after.name }],
      before: false,
    });
  });

  it('orders by the time alone with no day to start from, and asks only for what it needs', () => {
    const q = pullQuery({ fields: SKELETON_FIELDS, after: { since: '', day: 'd', at: 't', name: 'n' } });
    expect(q).not.toHaveProperty('where');
    expect((q.orderBy as { field: { fieldPath: string } }[]).map((o) => o.field.fieldPath)).toEqual(['at', '__name__']);
    expect(q.startAt).toEqual({ values: [{ stringValue: 't' }, { referenceValue: 'n' }], before: false });
    const fields = (q.select as { fields: { fieldPath: string }[] }).fields.map((f) => f.fieldPath);
    expect(fields).toContain('skeleton');
    expect(fields).not.toContain('full');
    expect(fields).not.toContain('prompt');
  });

  it('does not resume a cursor made under another day to start from', () => {
    expect(pullQuery({ since: '2026-11-04', after: { since: '', day: 'd', at: 't', name: 'n' } })).not.toHaveProperty('startAt');
  });
});

describe('pullPages', () => {
  it('reads each page after the last event of the one before, until a short page', async () => {
    const all = Array.from({ length: 5 }, (_, i) => ({
      name: `projects/p/databases/(default)/documents/users/u/learning/id${i}`,
      fields: { id: { stringValue: `id${i}` }, userId: { stringValue: 'u' }, at: { stringValue: `2026-11-1${i}T00:00:00Z` }, day: { stringValue: `2026-11-1${i}` }, errors: { integerValue: '0' } },
    }));
    const bodies: { structuredQuery: ReturnType<typeof pullQuery> }[] = [];
    const fake: FetchLike = async (_url, init) => {
      const body = JSON.parse(init.body!) as { structuredQuery: ReturnType<typeof pullQuery> };
      bodies.push(body);
      const start = body.structuredQuery.startAt ? all.findIndex((d) => d.name === (body.structuredQuery.startAt as { values: { referenceValue?: string }[] }).values.at(-1)!.referenceValue) + 1 : 0;
      const page = all.slice(start, start + 2).map((document) => ({ document }));
      return { ok: true, status: 200, json: async () => (page.length ? page : [{ readTime: 'x' }]), text: async () => '' };
    };
    const seen: string[] = [];
    let cursor = null;
    for await (const page of pullPages(fake, { url: 'u', headers: { authorization: 'Bearer t' }, pageSize: 2 })) {
      seen.push(...page.events.map((e) => e.id));
      cursor = page.cursor;
    }
    expect(seen).toEqual(['id0', 'id1', 'id2', 'id3', 'id4']);
    expect(bodies).toHaveLength(3);
    for (const b of bodies) expect(b.structuredQuery).not.toHaveProperty('offset');
    expect(cursor).toMatchObject({ at: '2026-11-14T00:00:00Z', name: all[4].name });
  });

  it('says what Firestore answered when it refuses', async () => {
    const fake: FetchLike = async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => 'The query requires an index.' });
    await expect(pullPages(fake, { url: 'u', headers: {} }).next()).rejects.toThrow(/400: The query requires an index/);
  });
});

describe('where the next pull begins', () => {
  const startedAt = Date.parse('2026-11-11T12:00:00.000Z');

  it('trusts only an ISO time no later than the pull began', () => {
    expect(trustedAt('2026-11-11T10:00:00.000Z', startedAt)).toBe(true);
    expect(trustedAt('2026-11-11T10:00:00Z', startedAt)).toBe(true);
    for (const at of ['9999-12-31T00:00:00.000Z', '2026-11-11T12:00:01.000Z', '~', '', '2026-11-11', '2026-11-11T10:00:00+05:30', 42]) expect(trustedAt(at, startedAt), String(at)).toBe(false);
  });

  it('is not moved by a made-up time, so one event cannot stop every later pull', () => {
    const resume = advanceResume(null, [{ at: '2026-11-10T09:00:00.000Z' }, { at: '9999-12-31T23:59:59.999Z' }, { at: '~' }], { since: '', startedAt });
    expect(resume).toEqual({ since: '', at: '2026-11-10T09:00:00.000Z' });
    // Never moves back, and a page of nothing trusted keeps it.
    expect(advanceResume(resume, [{ at: '2026-11-01T00:00:00.000Z' }], { since: '', startedAt })).toEqual(resume);
    expect(advanceResume(resume, [{ at: '9999-12-31T00:00:00.000Z' }], { since: '', startedAt })).toEqual(resume);
    expect(advanceResume(null, [{ at: '~' }], { since: '', startedAt })).toBeNull();
  });

  it('starts the next pull a lookback before it, so an event that synced late is still read', () => {
    expect(LOOKBACK_DAYS).toBeGreaterThanOrEqual(14);
    expect(resumeSince('', null, { startedAt })).toBe('');
    expect(resumeSince('', { since: '', at: '2026-11-10T09:00:00.000Z' }, { startedAt, lookbackDays: 30 })).toBe('2026-10-11');
    // Never before the --since asked for, and never from another --since's point.
    expect(resumeSince('2026-11-01', { since: '2026-11-01', at: '2026-11-10T09:00:00.000Z' }, { startedAt, lookbackDays: 30 })).toBe('2026-11-01');
    expect(resumeSince('2026-11-01', { since: '', at: '2026-11-10T09:00:00.000Z' }, { startedAt })).toBe('2026-11-01');
    // A cursor.json written before this, holding the poisoned value, is not resumed from.
    expect(resumeSince('', { since: '', at: '9999-12-31T00:00:00.000Z' }, { startedAt })).toBe('');
  });

  it('refuses to learn from an event whose time is made up', () => {
    const { kept, dropped } = selectTraining([event({ at: '9999-12-31T00:00:00.000Z' }), event({ at: '~' }), event({ at: '2026-11-10T09:00:00.000Z', skeleton: JSON.stringify(skeleton({ height: 1100 })) })], { accounts: () => 'verified', startedAt });
    expect(kept).toHaveLength(1);
    expect(dropped).toEqual({ 'unreadable time': 2 });
  });
});

describe('soundSkeleton', () => {
  it('keeps a sound skeleton as it was, and every archetype the shipped model learned from real reports', () => {
    expect(soundSkeleton(JSON.stringify(skeleton()))).toEqual(skeleton());
    const shipped = JSON.parse(fs.readFileSync('assets/model/formaModel.json', 'utf8')) as FormaModel;
    for (const a of shipped.archetypes) expect(soundSkeleton(a.skeleton), a.id).not.toBeNull();
  });

  it('rebuilds from the keys a skeleton has, so nothing added on the way is learned', () => {
    const tampered = skeleton() as unknown as Record<string, unknown>;
    tampered.secret = [1, 2, 3];
    (tampered.bands as Record<string, unknown>[])[1].extra = { client: 42 };
    const k = soundSkeleton(tampered)!;
    expect(k).not.toHaveProperty('secret');
    expect(k.bands[1]).not.toHaveProperty('extra');
  });

  it('keeps public fonts only, and a name the scrub emptied is no font (LM-24)', () => {
    expect(soundSkeleton(skeleton({}, 'ClientSecretFont'))!.bands[1].controls[0].font!.family).toBe('Arial');
    expect(soundSkeleton(skeleton({}, 'MS Gothic_JP'))!.bands[1].controls[0].font).toBeNull();
    expect(soundSkeleton(skeleton({}, 'メイリオ'))!.bands[1].controls[0].font).toBeNull();
    expect(soundSkeleton(skeleton({}, 'Segoe UI'))!.bands[1].controls[0].font!.family).toBe('Segoe UI');
  });

  it('refuses words outside the vocabulary and numbers off the page', () => {
    const control = (c: Record<string, unknown>) => {
      const k = skeleton() as unknown as { bands: { controls: Record<string, unknown>[] }[] };
      Object.assign(k.bands[1].controls[0], c);
      return k;
    };
    expect(soundSkeleton(control({ kind: 'gauge' }))).toBeNull();
    expect(soundSkeleton(control({ role: 'secret' }))).toBeNull();
    expect(soundSkeleton(control({ x: Number.NaN }))).toBeNull();
    expect(soundSkeleton(control({ x: 800, w: 1000 }))).toBeNull();
    expect(soundSkeleton(control({ h: 1e6 }))).toBeNull();
    // A rule drawn a little past the paper, as real reports have, is kept.
    expect(soundSkeleton(control({ x: 2.54, w: 998.25 }))).not.toBeNull();
    expect(soundSkeleton(control({ borders: 99 }))).toBeNull();
    expect(soundSkeleton({ ...skeleton(), paper: 'Huge' })).toBeNull();
    expect(soundSkeleton({ ...skeleton(), width: 1e9 })).toBeNull();
    expect(soundSkeleton({ ...skeleton(), bands: [] })).toBeNull();
    expect(soundSkeleton('not json')).toBeNull();
  });
});

describe('selectTraining', () => {
  const verified = () => 'verified' as const;

  it('takes one skeleton however many times one account sends it, and caps each account', () => {
    const many = Array.from({ length: 1000 }, () => event({ userId: 'mallory' }));
    const { kept, dropped } = selectTraining(many, { accounts: verified });
    expect(kept).toHaveLength(1);
    expect(dropped['same skeleton again']).toBe(999);

    const different = Array.from({ length: 30 }, (_, i) => event({ userId: 'mallory', skeleton: JSON.stringify(skeleton({ height: 1000 + i })) }));
    const capped = selectTraining(different, { accounts: verified, perAccount: 20 });
    expect(capped.kept).toHaveLength(20);
    expect(capped.dropped['over the account cap']).toBe(10);
  });

  it('drops unverified and deleted accounts, mock and AI-less answers, errors, bad ratings and undone edits', () => {
    const bad = event({ userId: 'bob' });
    const events = [
      event({ userId: 'carol' }),
      event({ userId: 'dave' }),
      event({ ai: 'mock' }),
      event({ ai: 'none' }),
      event({ errors: 2 }),
      event({ undone: true }),
      bad,
      event({ kind: 'rating', rating: 'bad', ref: bad.id, skeleton: '' }),
      event({ skeleton: '{"paper":"A4"}' }),
      event({ kind: 'rating', rating: 'good', skeleton: '' }),
    ];
    const states: Record<string, 'verified' | 'unverified' | 'gone'> = { carol: 'unverified', dave: 'gone' };
    const { kept, dropped } = selectTraining(events, { accounts: (uid) => states[uid] ?? 'verified' });
    expect(kept).toHaveLength(0);
    expect(dropped).toEqual({
      'address not verified': 1,
      'account gone': 1,
      'mock or no AI': 2,
      'checks found errors': 1,
      undone: 1,
      'rated bad': 1,
      'skeleton not sound': 1,
    });
  });

  it('writes each kept skeleton with its account as a pseudonym, and skips what an earlier pull kept', () => {
    const e = event({ userId: 'erin' });
    const first = selectTraining([e], { accounts: verified });
    expect(first.kept[0].account).toBe(accountKey('erin'));
    expect(first.kept[0].account).not.toContain('erin');
    const again = selectTraining([event({ userId: 'erin' })], { accounts: verified, seen: [`${first.kept[0].account}|${first.kept[0].hash}`] });
    expect(again.kept).toHaveLength(0);
  });
});

/* The retention (2026-11-12, Owner decision 15): 90 days in Firestore, and what each account deleted. */
describe('the retention', () => {
  it('keeps 90 days, counted from the pull, by day', () => {
    expect(RETENTION_DAYS).toBe(90);
    expect(retentionCutoff(Date.parse('2026-11-12T12:00:00Z'))).toBe('2026-08-14');
    expect(retentionCutoff(Date.parse('2026-11-12T00:00:00Z'), 1)).toBe('2026-11-11');
  });

  it('asks for the older events by day, ids and days only, and pages by cursor', async () => {
    const q = expiryQuery('2026-08-14', null);
    expect(q.where).toEqual({ fieldFilter: { field: { fieldPath: 'day' }, op: 'LESS_THAN', value: { stringValue: '2026-08-14' } } });
    expect((q.select as { fields: { fieldPath: string }[] }).fields.map((f) => f.fieldPath)).toEqual(['id', 'userId', 'day']);
    expect(q).not.toHaveProperty('offset');
    expect(expiryQuery('2026-08-14', { day: '2026-07-01', name: 'n1' }).startAt).toEqual({ values: [{ stringValue: '2026-07-01' }, { referenceValue: 'n1' }], before: false });
    const names = ['a', 'b', 'c'].map((id) => `projects/p/databases/(default)/documents/users/u/learning/${id}`);
    const asked: unknown[] = [];
    const fetchFn: FetchLike = async (_url, init) => {
      const query = (JSON.parse(init.body!) as { structuredQuery: { startAt?: unknown } }).structuredQuery;
      asked.push(query.startAt ?? null);
      const page = query.startAt ? names.slice(2) : names.slice(0, 2);
      const body = page.map((name) => ({ document: { name, fields: { id: { stringValue: name.slice(-1) }, userId: { stringValue: 'u' }, day: { stringValue: '2026-07-01' } } } }));
      return { ok: true, status: 200, json: async () => body, text: async () => '' };
    };
    const seen: string[] = [];
    for await (const page of expiringPages(fetchFn, { url: 'x:runQuery', headers: async () => ({}), cutoff: '2026-08-14', pageSize: 2 })) seen.push(...page.map((e) => e.id));
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(asked[1]).toEqual({ values: [{ stringValue: '2026-07-01' }, { referenceValue: names[1] }], before: false });
  });

  it('reads when each account deleted what it shared, a hundred accounts a request, and nothing for one that never did', async () => {
    const calls: string[][] = [];
    const fetchFn: FetchLike = async (_url, init) => {
      const docs = (JSON.parse(init.body!) as { documents: string[] }).documents;
      calls.push(docs);
      const body = docs.map((name) => (name.includes('/users/u7/') ? { found: { name, fields: { at: { timestampValue: '2026-11-11T09:00:00.123456Z' } } } } : { missing: name }));
      return { ok: true, status: 200, json: async () => body, text: async () => '' };
    };
    const uids = Array.from({ length: 150 }, (_, i) => `u${i}`);
    const marks = await forgottenMarkers(fetchFn, { url: 'https://x/documents', root: 'projects/p/databases/(default)/documents', headers: async () => ({}), uids: [...uids, 'bad id!'] });
    expect([...marks]).toEqual([['u7', '2026-11-11T09:00:00.123456Z']]);
    expect(calls.map((c) => c.length)).toEqual([100, 50]);
    expect(calls[0][0]).toBe('projects/p/databases/(default)/documents/users/u0/meta/forgotten');
  });
});

/*
 * The page pairs a kept report labelled (2026-11-12, Owner decision 20, D10;
 * lib/readerPairs.ts): kept from a verified account's kept report, never the
 * mock's, one rated bad or undone, one not sound, or past the cap.
 */
describe('selectPairs', () => {
  /** The smallest sound pair: one text on one line, read and labelled a value in Detail. */
  const pair = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ v: 1, features: FEATURE_SIGNATURE, page: [827, 1169], boxes: [[100, 140, 80, 8]], lines: [[0]], lineFeatures: [new Array(LINE_FEATURES.length).fill(0)], boxFeatures: [new Array(BOX_OWN).fill(0)], readBand: [4], readRole: [2], band: [4], role: [2], ...over });
  const kept = (over: Partial<PulledEvent> = {}) => event({ kind: 'kept', skeleton: '', boxes: pair(), ref: 'g1', ...over });
  const accounts = (uid: string) => (uid === 'gone1' ? 'gone' : uid === 'new1' ? 'unverified' : 'verified') as 'verified' | 'unverified' | 'gone';

  it('keeps a kept report\'s pair, with the report it labels, when, and the account as a pseudonym', () => {
    const e = kept({ userId: 'erin' });
    const { kept: picks } = selectPairs([e, event()], { accounts });
    expect(picks).toHaveLength(1);
    expect(picks[0].file).toMatchObject({ ref: 'g1', at: e.at, account: accountKey('erin') });
    expect(picks[0].file.pair.band).toEqual([4]);
  });

  it('drops gone and unverified accounts, the mock, a bad rating, an undo, an unsound pair and past the cap', () => {
    const events = [
      kept({ userId: 'gone1' }),
      kept({ userId: 'new1' }),
      kept({ ai: 'mock' }),
      kept({ ref: 'rated' }),
      event({ kind: 'rating', rating: 'bad', ref: 'rated', skeleton: '' }),
      kept({ ref: 'undone' }),
      event({ kind: 'undo', ref: 'undone', skeleton: '' }),
      kept({ boxes: pair({ features: '00000000' }) }),
      kept({ userId: 'busy' }),
      kept({ userId: 'busy' }),
    ];
    const { kept: picks, dropped } = selectPairs(events, { accounts, perAccount: 1 });
    expect(picks.map((p) => p.event.userId)).toEqual(['busy']);
    expect(dropped).toEqual({ 'account gone': 1, 'address not verified': 1, mock: 1, 'rated bad': 1, undone: 1, 'pair not sound': 1, 'over the account cap': 1 });
  });
});

/** Scratch for the reconcile: beside the repository on the owner's server (never C:), the system's elsewhere. */
const SCRATCH_ROOT = fs.existsSync(resolve('..', 'forma-model-data', 'work')) ? resolve('..', 'forma-model-data', 'work') : tmpdir();
const scratch = fs.mkdtempSync(join(SCRATCH_ROOT, 'lo-reconcile-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

const nodeFs: FsLike = {
  existsSync: fs.existsSync,
  readdirSync: (p) => fs.readdirSync(p),
  readFileSync: (p, e) => fs.readFileSync(p, e),
  writeFileSync: (p, d) => fs.writeFileSync(p, d),
  unlinkSync: fs.unlinkSync,
};

describe('reconcile', () => {
  it('plans to remove every file and line of an event that is gone or of an account forgotten', () => {
    const lines = [JSON.stringify({ id: 'a', userId: 'u1' }), JSON.stringify({ id: 'b', userId: 'u2' }), JSON.stringify({ id: 'c', userId: 'u1' })];
    const files = [
      { dir: 'skeletons' as const, name: 'a.json' },
      { dir: 'skeletons' as const, name: 'b.json' },
      { dir: 'repx' as const, name: 'c.repx' },
      { dir: 'prompts' as const, name: 'c.txt' },
    ];
    const plan = planReconcile({ files, lines }, new Set(['a', 'c']));
    expect(plan.remove).toEqual([{ dir: 'skeletons', name: 'b.json' }]);
    expect(plan.lines.map((l) => JSON.parse(l).id)).toEqual(['a', 'c']);
    const forgot = planReconcile({ files, lines }, null, new Set(['u1']));
    expect(forgot.remove.map((f) => f.name)).toEqual(['a.json', 'c.repx', 'c.txt']);
    expect(forgot.ids.sort()).toEqual(['a', 'c']);
  });

  it('brings a pull folder on disk in step with what the accounts still hold', () => {
    for (const d of ['skeletons', 'repx', 'prompts']) fs.mkdirSync(join(scratch, d), { recursive: true });
    fs.writeFileSync(join(scratch, 'skeletons', 'keep.json'), JSON.stringify({ account: accountKey('u1') }));
    fs.writeFileSync(join(scratch, 'skeletons', 'cleared.json'), JSON.stringify({ account: accountKey('u1') }));
    fs.writeFileSync(join(scratch, 'skeletons', 'forgotten.json'), JSON.stringify({ account: accountKey('u9') }));
    fs.writeFileSync(join(scratch, 'repx', 'cleared.repx'), '<x/>');
    fs.writeFileSync(join(scratch, 'prompts', 'cleared.txt'), 'words');
    fs.writeFileSync(join(scratch, 'events.jsonl'), ['keep', 'cleared'].map((id) => JSON.stringify({ id, userId: 'u1' })).join('\n') + '\n');

    const plan = applyReconcile(nodeFs, scratch, new Set(['keep', 'forgotten']), new Set([accountKey('u9')]));
    expect(plan.ids.sort()).toEqual(['cleared', 'forgotten']);
    expect(fs.readdirSync(join(scratch, 'skeletons'))).toEqual(['keep.json']);
    expect(fs.readdirSync(join(scratch, 'repx'))).toEqual([]);
    expect(fs.readdirSync(join(scratch, 'prompts'))).toEqual([]);
    expect(fs.readFileSync(join(scratch, 'events.jsonl'), 'utf8')).toBe(`${JSON.stringify({ id: 'keep', userId: 'u1' })}\n`);
  });

  /*
   * The retention (2026-11-12, Owner decision 15): an event Firestore no
   * longer holds because it is older than the retention keeps its copy; a
   * person's own deletion still reaches it, by the time they deleted.
   */
  it('keeps a copy the retention took out of Firestore, and forgets one its person deleted, however old', () => {
    const lines = [
      JSON.stringify({ id: 'old', userId: 'u1', day: '2026-07-01', at: '2026-07-01T10:00:00Z' }),
      JSON.stringify({ id: 'new', userId: 'u1', day: '2026-11-10', at: '2026-11-10T10:00:00Z' }),
      JSON.stringify({ id: 'later', userId: 'u1', day: '2026-11-12', at: '2026-11-12T10:00:00Z' }),
      JSON.stringify({ id: 'other', userId: 'u2', day: '2026-07-01', at: '2026-07-01T10:00:00Z' }),
    ];
    const files = ['old', 'new', 'later', 'other'].map((id) => ({ dir: 'skeletons' as const, name: `${id}.json` }));
    // Firestore holds only `later`: `new` was cleared, `old` and `other` passed the retention.
    const kept = planReconcile({ files, lines }, new Set(['later']), new Set(), { keepBefore: '2026-08-14' });
    expect(kept.ids).toEqual(['new']);
    // u1 deleted what they shared at 11:00 on the 11th: everything of theirs made by then goes, `later` stays.
    const marked = planReconcile({ files, lines }, new Set(['later']), new Set(), { keepBefore: '2026-08-14', forgetBefore: new Map([['u1', '2026-11-11T11:00:00.000Z']]) });
    expect(marked.ids.sort()).toEqual(['new', 'old']);
    expect(marked.remove.map((f) => f.name).sort()).toEqual(['new.json', 'old.json']);
  });

  // The page pairs (2026-11-12, D10) go as the rest do: with their event, and with a forgotten account.
  it('removes a page pair with its event, and a forgotten account\'s by the pseudonym its file carries', () => {
    const dir = join(scratch, 'pairs');
    fs.mkdirSync(join(dir, 'boxes'), { recursive: true });
    fs.writeFileSync(join(dir, 'boxes', 'kept1.json'), JSON.stringify({ ref: 'g1', account: accountKey('u1') }));
    fs.writeFileSync(join(dir, 'boxes', 'cleared1.json'), JSON.stringify({ ref: 'g2', account: accountKey('u1') }));
    fs.writeFileSync(join(dir, 'boxes', 'other1.json'), JSON.stringify({ ref: 'g3', account: accountKey('u9') }));
    const plan = applyReconcile(nodeFs, dir, new Set(['kept1', 'other1']), new Set([accountKey('u9')]));
    expect(plan.ids.sort()).toEqual(['cleared1', 'other1']);
    expect(fs.readdirSync(join(dir, 'boxes'))).toEqual(['kept1.json']);
  });
});

describe('the gate', () => {
  const shipped = JSON.parse(fs.readFileSync('assets/model/formaModel.json', 'utf8')) as FormaModel;
  const dir = 'scripts/fidelity/cases/described';
  const cases: DescribedCase[] = fs
    .readdirSync(dir)
    .sort()
    .map((name) => ({ name, ...(JSON.parse(fs.readFileSync(join(dir, name, 'case.json'), 'utf8')) as Omit<DescribedCase, 'name'>) }));

  it('has the six described cases, each scored with Forma\'s own report', () => {
    expect(cases.map((c) => c.name)).toEqual(['address-labels', 'customer-list', 'general-ledger', 'invoice-lines', 'payslip-list', 'stock-register']);
    for (const s of scoreDescribed(shipped, cases)) expect(s.total, s.name).toBeGreaterThan(5);
  });

  it('passes the shipped model against itself', () => {
    const heldOut = [skeleton(), skeleton({ landscape: true, width: 1169, height: 827 })];
    const { pass, checks } = gateModels(shipped, shipped, { cases, heldOut });
    expect(checks.filter((c) => !c.pass)).toEqual([]);
    expect(pass).toBe(true);
    expect(checks.map((c) => c.name)).toContain('held-out distance');
  });

  it('fails a candidate that holds a word, names a private font, scores lower or sits further from what people make', () => {
    const damaged = JSON.parse(JSON.stringify(shipped)) as FormaModel;
    // A font the house style lists is in the leak check's vocabulary by
    // definition, which is why the gate asks separately whether it is public.
    damaged.style.fonts.push({ family: 'ClientSecretFont', share: 0 });
    damaged.archetypes[0].label = 'Confidential Client Ltd';
    for (const role of Object.values(damaged.style.roles)) role!.size = 40;
    for (const a of damaged.archetypes) a.features = a.features.map((f) => f + 50);
    const { pass, checks } = gateModels(shipped, damaged, { cases, heldOut: [skeleton()] });
    expect(pass).toBe(false);
    const failed = checks.filter((c) => !c.pass).map((c) => c.name);
    expect(failed).toContain('leak check');
    expect(failed).toContain('public fonts');
    expect(failed).toContain('held-out distance');
    expect(failed.some((n) => n.startsWith('case '))).toBe(true);
  });

  it('measures nearness in one scale, and says nothing of an empty set', () => {
    expect(meanNearest(shipped, [], shipped.scale)).toBeNull();
    expect(meanNearest(shipped, [skeleton()], shipped.scale)).toBeGreaterThanOrEqual(0);
  });
});
