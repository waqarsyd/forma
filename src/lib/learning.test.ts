/**
 * Learning from use (2026-11-10, the full audit): what an event carries on
 * each tier, the scrub that keeps a skeleton to its fixed words, and the
 * settings' defaults.
 */
import { describe, expect, it } from 'vitest';
import type { ReportSkeleton } from './reportSkeleton';
import {
  DEFAULT_LEARNING_SETTINGS,
  MAX_FULL_BYTES,
  MAX_REF_CHARS,
  featureDistance,
  projectKey,
  recordLearning,
  roundSkeleton,
  settleWithAccount,
  utf8Bytes,
  clearLearningEvents,
  effectiveLearningSettings,
  flushLearning,
  forSending,
  keepable,
  keepLearningEvent,
  learningEvent,
  learningId,
  learningSummary,
  listLearningEvents,
  markLearningSent,
  MAX_LOCAL,
  readDeviceLearning,
  readLearningSettings,
  scrubSkeleton,
  sendable,
  settleLearningSettings,
  skeletonField,
  sourceOf,
  writeLearningSettings,
  type LearningEvent,
} from './learning';

const skeleton: ReportSkeleton = {
  paper: 'A4',
  landscape: false,
  width: 827,
  height: 1169,
  margins: { top: 50, bottom: 50, left: 50, right: 50 },
  bands: [
    {
      kind: 'ReportHeader',
      height: 100,
      groupFields: 0,
      controls: [{ kind: 'label', role: 'title', x: 0, y: 0, w: 300, h: 30, font: { family: 'Tahoma', size: 14, bold: true, italic: false }, align: 'left', borders: 0, chars: 12 }],
    },
    {
      kind: 'Detail',
      height: 20,
      groupFields: 0,
      controls: [{ kind: 'table', role: 'value', x: 0, y: 0, w: 700, h: 20, font: null, align: 'left', borders: 15, chars: 0, rows: [[{ weight: 1, role: 'value', align: 'right', chars: 0, font: null }]] }],
    },
  ],
};

function fakeStorage(): Pick<Storage, 'getItem' | 'setItem'> & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe('the settings', () => {
  it('default to structure on and full reports off, and keep what is written', () => {
    const storage = fakeStorage();
    expect(readLearningSettings(null, storage)).toEqual(DEFAULT_LEARNING_SETTINGS);
    expect(DEFAULT_LEARNING_SETTINGS).toEqual({ structure: true, full: false });
    writeLearningSettings({ structure: false, full: true }, null, false, storage);
    expect(readLearningSettings(null, storage)).toEqual({ structure: false, full: true });
    storage.map.set('forma:learning', '{not json');
    expect(readLearningSettings(null, storage)).toEqual(DEFAULT_LEARNING_SETTINGS);
    expect(readLearningSettings(null, null)).toEqual(DEFAULT_LEARNING_SETTINGS);
  });

  // The full audit (2026-11-11, LM-01, SA-13): the next person at the browser never inherits the whole-report switch.
  it('are read for the account that wrote them, and another account gets the defaults', () => {
    const storage = fakeStorage();
    writeLearningSettings({ structure: true, full: true }, 'alice', false, storage);
    expect(readLearningSettings('alice', storage)).toEqual({ structure: true, full: true });
    expect(readLearningSettings('bob', storage)).toEqual({ structure: true, full: false });
    expect(readLearningSettings(null, storage)).toEqual({ structure: true, full: false });
    writeLearningSettings({ structure: false, full: false }, 'bob', false, storage);
    expect(readLearningSettings('alice', storage)).toEqual(DEFAULT_LEARNING_SETTINGS);
  });

  // The PRIV review (2026-11-11): an "off" chosen signed out survives the first sign-in into an account with no copy.
  it('carry an off chosen signed out into the account at sign-in, and never whole reports', () => {
    const storage = fakeStorage();
    writeLearningSettings({ structure: false, full: false }, null, false, storage);
    const device = readDeviceLearning('alice', storage);
    expect(device).toEqual({ settings: { structure: false, full: false }, pending: false });
    expect(settleLearningSettings(device, null)).toEqual({ settings: { structure: false, full: false }, push: true });
    writeLearningSettings({ structure: true, full: true }, null, false, storage);
    expect(readLearningSettings('alice', storage)).toEqual({ structure: true, full: false });
  });

  it('read a copy from before they named the account: an off is kept, whole reports are not', () => {
    const storage = fakeStorage();
    storage.map.set('forma:learning', JSON.stringify({ structure: false, full: true }));
    expect(readLearningSettings('anyone', storage)).toEqual({ structure: false, full: false });
    storage.map.set('forma:learning', JSON.stringify({ structure: true, full: true }));
    expect(readLearningSettings(null, storage)).toEqual({ structure: true, full: false });
  });

  it('remember a change the account does not have yet', () => {
    const storage = fakeStorage();
    writeLearningSettings({ structure: false, full: false }, 'alice', true, storage);
    expect(readDeviceLearning('alice', storage)).toEqual({ settings: { structure: false, full: false }, pending: true });
    writeLearningSettings({ structure: false, full: false }, 'alice', false, storage);
    expect(readDeviceLearning('alice', storage).pending).toBe(false);
  });

  it('settle on the account\'s copy, unless this browser holds a change it lacks or it has none', () => {
    const device = (structure: boolean, full: boolean, pending = false) => ({ settings: { structure, full }, pending });
    expect(settleLearningSettings(device(true, false), { structure: true, full: true })).toEqual({ settings: { structure: true, full: true }, push: false });
    expect(settleLearningSettings(device(false, false, true), { structure: true, full: true })).toEqual({ settings: { structure: false, full: false }, push: true });
    expect(settleLearningSettings(device(false, false), null)).toEqual({ settings: { structure: false, full: false }, push: true });
  });

  it('settle with the account: its copy stands, this browser\'s is written when it has none, and a failed read says false', async () => {
    const storage = fakeStorage();
    expect(await settleWithAccount('alice', async () => ({ structure: false, full: true }), async () => undefined, storage)).toBe(true);
    expect(readLearningSettings('alice', storage)).toEqual({ structure: false, full: true });
    const written: unknown[] = [];
    writeLearningSettings({ structure: false, full: false }, 'bob', true, storage);
    expect(await settleWithAccount('bob', async () => ({ structure: true, full: true }), async (s) => void written.push(s), storage)).toBe(true);
    expect(written).toEqual([{ structure: false, full: false }]);
    expect(await settleWithAccount('carol', async () => { throw new Error('offline'); }, async () => undefined, storage)).toBe(false);
  });

  it('hold whole reports back, signed in, until the account\'s copy is known', () => {
    const on = { structure: true, full: true };
    expect(effectiveLearningSettings(on, true, false)).toEqual({ structure: true, full: false });
    expect(effectiveLearningSettings(on, true, true)).toEqual(on);
    expect(effectiveLearningSettings(on, false, false)).toEqual(on);
  });
});

describe('the scrub', () => {
  it('leaves a sound skeleton as it is', () => {
    expect(scrubSkeleton(skeleton)).toEqual(skeleton);
  });

  it('strips any string that is not one of the fixed words, wherever a defect put it', () => {
    const leaky = JSON.parse(JSON.stringify(skeleton)) as ReportSkeleton & { bands: ({ text?: string } & ReportSkeleton['bands'][number])[] };
    leaky.bands[0].text = 'ACME Ltd, 14 High Street';
    (leaky.bands[0].controls[0] as { name?: string }).name = 'lblCustomerName';
    leaky.bands[0].controls[0].font!.family = 'Tahoma <script>';
    (leaky as unknown as { paper: string }).paper = 'A4; DROP TABLE';
    const clean = scrubSkeleton(leaky) as unknown as { bands: { text: string; controls: { name: string; font: { family?: string } }[] }[]; paper: string };
    expect(clean.bands[0].text).toBe('');
    expect(clean.bands[0].controls[0].name).toBe('');
    expect(clean.bands[0].controls[0].font).not.toHaveProperty('family');
    expect(clean.paper).toBe('');
    expect(clean.bands[0].controls[0]).toMatchObject({ kind: 'label', role: 'title', w: 300 });
  });

  // The full audit (2026-11-11, LM-24): a family it cannot keep goes, rather than becoming a font named ''.
  it('drops a non-Latin or underscored family, and keeps the rest of the font', () => {
    for (const family of ['MS Gothic_JP', 'ＭＳ ゴシック', '微软雅黑']) {
      const odd = JSON.parse(JSON.stringify(skeleton)) as ReportSkeleton;
      odd.bands[0].controls[0].font!.family = family;
      const font = (scrubSkeleton(odd).bands[0].controls[0].font ?? {}) as Record<string, unknown>;
      expect(font, family).not.toHaveProperty('family');
      expect(font).toMatchObject({ size: 14, bold: true });
      expect(skeletonField(odd)).not.toContain('"family":""');
    }
  });

  it('writes the skeleton as JSON, and nothing when there is none or it would not fit', () => {
    expect(JSON.parse(skeletonField(skeleton))).toEqual(skeleton);
    expect(skeletonField(null)).toBe('');
    const huge = { ...skeleton, bands: Array.from({ length: 3000 }, () => skeleton.bands[1]) };
    expect(skeletonField(huge)).toBe('');
  });
});

describe('an event', () => {
  const settings = { structure: true, full: false };

  it('carries the structure and never the report or the words on the structure tier', () => {
    const e = learningEvent(
      { kind: 'generation', source: 'image', request: 'new', ai: 'gemini', skeleton, ops: ['font', 'move'], findings: [{ severity: 'error' }, { severity: 'warning' }, { severity: 'warning' }], repx: '<XtraReportsLayoutSerializer/>', prompt: 'Rebuild this invoice' },
      settings,
      new Date('2026-11-10T20:15:00Z'),
    );
    expect(e).toMatchObject({ at: '2026-11-10T20:15:00.000Z', day: '2026-11-10', kind: 'generation', source: 'image', request: 'new', ai: 'gemini', ops: ['font', 'move'], errors: 1, warnings: 2, rating: '', full: '', prompt: '' });
    expect(JSON.parse(e.skeleton)).toEqual(skeleton);
    expect(e.id).toMatch(/^[a-z0-9]+-[a-z0-9]{6}$/);
    expect(sendable(e, settings)).toBe(true);
    expect(sendable(e, { structure: false, full: false })).toBe(false);
  });

  it('carries the report and the words only on the full tier, within their limits', () => {
    const full = { structure: true, full: true };
    const e = learningEvent({ kind: 'edit', skeleton, ops: ['text'], repx: '<x/>', prompt: 'p'.repeat(5000) }, full);
    expect(e.full).toBe('<x/>');
    expect(e.prompt).toHaveLength(4000);
    expect(sendable(e, { structure: false, full: true })).toBe(true);
    // Capped by UTF-8 bytes (LM-25): 300,000 Chinese characters are 900,000 bytes, over a document.
    const tooBig = learningEvent({ kind: 'edit', repx: '表'.repeat(300_000), prompt: 'p' }, full);
    expect(tooBig.full).toBe('');
    expect(tooBig.prompt).toBe('');
    expect(tooBig.dropped).toBe('full');
    expect(learningEvent({ kind: 'edit', repx: 'x'.repeat(MAX_FULL_BYTES), prompt: 'p' }, full).full).toHaveLength(MAX_FULL_BYTES);
    expect(utf8Bytes('表')).toBe(3);
  });

  it('keeps every field present, with the defaults, so the rules can pin the shape', () => {
    const e = learningEvent({ kind: 'rating', rating: 'good' }, settings);
    expect(Object.keys(e).sort()).toEqual(['ai', 'at', 'day', 'distance', 'draft', 'dropped', 'errors', 'full', 'how', 'id', 'kind', 'ms', 'ops', 'project', 'prompt', 'rating', 'ref', 'request', 'roles', 'skeleton', 'source', 'warnings'].sort());
    expect(e).toMatchObject({ source: 'none', request: 'none', ai: 'none', skeleton: '', ops: [], roles: [], errors: 0, warnings: 0, rating: 'good', ref: '', how: '', draft: '', ms: 0, project: '', distance: -1, dropped: '' });
  });

  /*
   * Event v2 (2026-11-11, the full audit's LM-10a, LM-11, LM-12, LM-25).
   */
  it('carries the skeleton only on a report made or kept, and says when it had to leave it out', () => {
    const s = { structure: true, full: true };
    expect(learningEvent({ kind: 'generation', skeleton }, s).skeleton).not.toBe('');
    expect(learningEvent({ kind: 'kept', skeleton, how: 'pdf' }, s).skeleton).not.toBe('');
    for (const kind of ['edit', 'translate', 'rating', 'undo'] as const) expect(learningEvent({ kind, skeleton }, s).skeleton, kind).toBe('');
    // A rating or an undo points at the event that has the report; it never carries one.
    expect(learningEvent({ kind: 'rating', rating: 'bad', repx: '<x/>' }, s).full).toBe('');
    expect(learningEvent({ kind: 'undo', repx: '<x/>' }, s).full).toBe('');
    const huge = { ...skeleton, bands: Array.from({ length: 3000 }, () => skeleton.bands[1]) };
    expect(learningEvent({ kind: 'generation', skeleton: huge }, s)).toMatchObject({ skeleton: '', dropped: 'skeleton' });
  });

  it('rounds the skeleton to one decimal before it is measured', () => {
    const fine = JSON.parse(JSON.stringify(skeleton)) as ReportSkeleton;
    fine.bands[0].controls[0].x = 12.3456;
    fine.bands[0].controls[0].w = 299.96;
    const out = JSON.parse(skeletonField(fine)) as ReportSkeleton;
    expect(out.bands[0].controls[0]).toMatchObject({ x: 12.3, w: 300 });
    expect(roundSkeleton({ a: [1.26, 'A4', null] })).toEqual({ a: [1.3, 'A4', null] });
  });

  it('names what a rating rates, takes a rating back as \'\', and says how a report was kept', () => {
    const rating = learningEvent({ kind: 'rating', rating: '', ref: 'm3k9x1-abc123', ai: 'gemini' }, settings);
    expect(rating).toMatchObject({ kind: 'rating', rating: '', ref: 'm3k9x1-abc123', ai: 'gemini', skeleton: '' });
    expect(learningEvent({ kind: 'rating', ref: 'not an id!' }, settings).ref).toBe('');
    expect(learningEvent({ kind: 'rating', ref: 'r'.repeat(MAX_REF_CHARS + 1) }, settings).ref).toBe('');
    expect(learningEvent({ kind: 'kept', how: 'designer' }, settings).how).toBe('designer');
    expect(learningEvent({ kind: 'kept', how: 'fax' }, settings).how).toBe('');
    expect(learningEvent({ kind: 'edit', how: 'pdf', rating: 'good' }, settings)).toMatchObject({ how: '', rating: '' });
    expect(learningEvent({ kind: 'generation', ai: 'forma', draft: 'reader', ms: 1234.6 }, settings)).toMatchObject({ draft: 'reader', ms: 1235 });
    expect(learningEvent({ kind: 'generation', ai: 'gemini', draft: 'reader' }, settings).draft).toBe('');
    expect(learningEvent({ kind: 'edit', ops: ['font', 'move'], roles: ['caption'] }, settings).roles).toEqual(['caption', '']);
  });

  it('names a project by a hash of the account and its id, never the id', async () => {
    const key = await projectKey('alice', '1731300000000');
    expect(key).toMatch(/^[0-9a-f]{12}$/);
    expect(await projectKey('bob', '1731300000000')).not.toBe(key);
    expect(await projectKey('alice', null)).toBe('');
    expect(learningEvent({ kind: 'kept', project: key }, settings).project).toBe(key);
    expect(learningEvent({ kind: 'kept', project: '1731300000000' }, settings).project).toBe('');
  });

  it('measures how far a kept report moved from the one made, without scale', () => {
    expect(featureDistance([1, 2, 3], [1, 2, 3])).toBe(0);
    expect(featureDistance([10, 0], [10, 10])).toBeGreaterThan(0.5);
    expect(featureDistance([], [])).toBe(-1);
  });

  it('brings an event kept before v2 to the shape the rules take', () => {
    const old = { id: 'old-1', at: '2026-11-10T10:00:00.000Z', day: '2026-11-10', kind: 'edit' as const, source: 'none' as const, request: 'edit' as const, ai: 'gemini' as const, skeleton: '{"paper":"A4"}', ops: ['font'], errors: 0, warnings: 0, rating: '' as const, full: '', prompt: '' };
    const out = forSending(old, settings)!;
    expect(out).toMatchObject({ skeleton: '', roles: [''], ref: '', how: '', draft: '', ms: 0, project: '', distance: -1, dropped: '' });
    expect(Object.keys(out).sort()).toEqual(Object.keys(learningEvent({ kind: 'edit' }, settings)).sort());
  });

  it('caps the operations at forty short names', () => {
    const e = learningEvent({ kind: 'edit', ops: Array.from({ length: 60 }, (_, i) => `op${i}`.padEnd(40, 'x')) }, settings);
    expect(e.ops).toHaveLength(40);
    expect(e.ops[0]).toHaveLength(24);
  });

  // The full audit (2026-11-11, LM-29): with both switches off nothing is kept, on the device either.
  it('is kept only while one of the switches is on', () => {
    expect(keepable({ structure: false, full: false })).toBe(false);
    expect(keepable({ structure: true, full: false })).toBe(true);
    expect(keepable({ structure: false, full: true })).toBe(true);
  });

  // The full audit (2026-11-11, LM-09): what goes is the event the rules pin, under the switches as they are when it goes.
  it('goes to the account without what only this browser keeps, and without the whole report once that switch is off', () => {
    const e = { ...learningEvent({ kind: 'edit', skeleton, repx: '<x/>', prompt: 'p' }, { structure: true, full: true }), uid: 'alice', sent: false };
    const both = forSending(e, { structure: true, full: true })!;
    expect(both).not.toHaveProperty('uid');
    expect(both).not.toHaveProperty('sent');
    expect(both).toMatchObject({ full: '<x/>', prompt: 'p' });
    expect(forSending(e, { structure: true, full: false })).toMatchObject({ full: '', prompt: '' });
    expect(forSending(e, { structure: false, full: false })).toBeNull();
    expect(forSending({ ...e, full: '' }, { structure: false, full: true })).toBeNull();
  });

  it('gives ids that stay unique within one millisecond', () => {
    const a = learningId(1000);
    const b = learningId(1000);
    expect(a).not.toBe(b);
  });
});

describe('what the request brought', () => {
  it('names one kind, or mixed', () => {
    expect(sourceOf({ images: 2, pdfs: 0, repx: 0, words: true, database: false })).toBe('image');
    expect(sourceOf({ images: 0, pdfs: 1, repx: 0, words: false, database: false })).toBe('pdf');
    expect(sourceOf({ images: 0, pdfs: 0, repx: 1, words: false, database: false })).toBe('repx');
    expect(sourceOf({ images: 0, pdfs: 0, repx: 0, words: true, database: false })).toBe('words');
    expect(sourceOf({ images: 0, pdfs: 0, repx: 0, words: false, database: true })).toBe('database');
    expect(sourceOf({ images: 1, pdfs: 0, repx: 1, words: true, database: false })).toBe('mixed');
    expect(sourceOf({ images: 0, pdfs: 0, repx: 0, words: false, database: false })).toBe('none');
  });
});

describe('the summary', () => {
  it('counts by kind and the full reports, from the earliest', () => {
    const s = { structure: true, full: true };
    const events = [
      learningEvent({ kind: 'generation', skeleton, repx: '<x/>' }, s, new Date('2026-11-10T10:00:00Z')),
      learningEvent({ kind: 'edit', ops: ['font'] }, s, new Date('2026-11-09T10:00:00Z')),
      learningEvent({ kind: 'rating', rating: 'bad' }, s, new Date('2026-11-11T10:00:00Z')),
    ];
    expect(learningSummary(events)).toEqual({ total: 3, byKind: { generation: 1, edit: 1, translate: 0, rating: 1, kept: 0, undo: 0 }, full: 1, since: '2026-11-09T10:00:00.000Z' });
    expect(learningSummary([])).toEqual({ total: 0, byKind: { generation: 0, edit: 0, translate: 0, rating: 0, kept: 0, undo: 0 }, full: 0, since: null });
  });
});

/*
 * The store on the device (2026-11-11, the full audit, TC-07). It can hold
 * whole reports on the full tier, so a trim that stops trimming grows it
 * without bound and a clear that stops clearing leaves those reports on a
 * shared PC after Settings' Forget, and neither would fail anything but this.
 * A fresh in-memory IndexedDB from `fake-indexeddb` per case, passed in
 * through the `idb` parameter the store already takes.
 *
 * Loaded through a computed specifier, so that a node_modules installed before
 * the devDependency arrived skips these cases by name instead of failing to
 * load the whole file. CI installs from the lockfile, so there a missing
 * package is an error, never a skip.
 */
const FAKE_IDB = 'fake-indexeddb';
const fakeIdb = (await import(/* @vite-ignore */ FAKE_IDB).catch(() => null)) as { IDBFactory: new () => IDBFactory } | null;
if (!fakeIdb && process.env.CI) throw new Error('fake-indexeddb is a devDependency and is not installed: run npm ci.');

describe.runIf(fakeIdb)('the store on the device', () => {
  const structure = { structure: true, full: false };
  const at = (n: number) => new Date(Date.UTC(2026, 10, 1) + n * 60_000);

  it('keeps events, lists them newest first, and forgets them all', async () => {
    const idb = new fakeIdb!.IDBFactory();
    const first = learningEvent({ kind: 'generation' }, structure, at(1));
    const second = learningEvent({ kind: 'edit', ops: ['font'] }, structure, at(2));
    const third = learningEvent({ kind: 'rating', rating: 'good' }, structure, at(3));
    await keepLearningEvent(second, idb);
    await keepLearningEvent(first, idb);
    await keepLearningEvent(third, idb);

    expect((await listLearningEvents(idb)).map((e) => e.id)).toEqual([third.id, second.id, first.id]);
    expect(await listLearningEvents(idb)).toContainEqual(second);

    await clearLearningEvents(idb);
    expect(await listLearningEvents(idb)).toEqual([]);
  });

  it(`keeps the newest ${MAX_LOCAL} and lets the oldest go`, async () => {
    const idb = new fakeIdb!.IDBFactory();
    const events = Array.from({ length: MAX_LOCAL + 1 }, (_, n) => learningEvent({ kind: 'edit' }, structure, at(n)));
    for (const event of events) await keepLearningEvent(event, idb);

    const kept = await listLearningEvents(idb);
    expect(kept).toHaveLength(MAX_LOCAL);
    expect(kept.some((e) => e.id === events[0].id)).toBe(false);
    expect(kept[0].id).toBe(events[MAX_LOCAL].id);
    expect(kept[MAX_LOCAL - 1].id).toBe(events[1].id);
  }, 60_000);

  // Event v2 (2026-11-11, LM-12, LM-13, LM-16): what a turn records, read off the report, kept, sent, and thinned once sent.
  it('records an edit by the kinds of part it touched, a kept report by how far it moved, and keeps no whole report once sent', async () => {
    const idb = new fakeIdb!.IDBFactory();
    const storage = fakeStorage();
    writeLearningSettings({ structure: true, full: true }, 'alice', false, storage);
    const repx =
      '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="r" PageWidth="827" PageHeight="1169" PaperKind="A4"><Bands>' +
      '<Item1 Ref="1" ControlType="ReportHeaderBand" HeightF="60"><Controls><Item1 Ref="2" ControlType="XRLabel" Name="lblTitle" Text="Acme Ltd" Font="Arial, 16pt" SizeF="300,30" LocationFloat="0,0" />' +
      '<Item2 Ref="3" ControlType="XRLabel" Name="lblAmount" SizeF="100,30" LocationFloat="400,0"><ExpressionBindings><Item1 Ref="4" EventName="BeforePrint" PropertyName="Text" Expression="[Amount]" /></ExpressionBindings></Item2></Controls></Item1>' +
      '<Item2 Ref="5" ControlType="DetailBand" HeightF="25" /></Bands></XtraReportsLayoutSerializer>';
    const sent: LearningEvent[] = [];
    const sink = { uid: 'alice', known: true, send: async (e: LearningEvent) => void sent.push(e), idb, storage };
    const edit = await recordLearning({ kind: 'edit', request: 'edit', ai: 'gemini', repx, ops: ['font', 'move', 'paper'], controls: ['lblTitle', 'lblAmount', undefined], prompt: 'bigger title' }, sink);
    expect(edit).toMatchObject({ kind: 'edit', ops: ['font', 'move', 'paper'], roles: ['caption', 'value', 'report'], skeleton: '', full: repx });
    const kept = await recordLearning({ kind: 'kept', how: 'pdf', repx, madeRepx: repx, ref: edit!.id, projectId: 'p1' }, sink);
    expect(kept).toMatchObject({ kind: 'kept', how: 'pdf', distance: 0, ref: edit!.id, project: expect.stringMatching(/^[0-9a-f]{12}$/) });
    expect(kept!.skeleton).not.toContain('Acme');
    expect(sent.map((e) => e.kind)).toEqual(['edit', 'kept']);
    const local = await listLearningEvents(idb);
    expect(local.every((e) => e.sent === true && e.full === '' && e.prompt === '')).toBe(true);
    // Nobody to send to: kept here, whole, until it goes.
    const waiting = await recordLearning({ kind: 'generation', repx }, { ...sink, send: null });
    expect((await listLearningEvents(idb)).find((e) => e.id === waiting!.id)).toMatchObject({ sent: false, full: repx });
    // A part the edit deleted is named for what it was, off the report before it (2026-11-11).
    const without = repx.replace(/<Item2 Ref="3"[\s\S]*?<\/Item2>/, '');
    expect(without).not.toContain('lblAmount');
    const deleted = await recordLearning({ kind: 'edit', request: 'edit', repx: without, beforeRepx: repx, ops: ['delete'], controls: ['lblAmount'] }, { ...sink, send: null });
    expect(deleted!.roles).toEqual(['value']);
    // A first report whose reading throws leaves the distance unknown, and the kept report's
    // skeleton stands. The parser forgives any string, so a value it cannot read stands in for one.
    const unparsed = await recordLearning({ kind: 'kept', how: 'repx', repx, madeRepx: new Proxy({}, { get: () => { throw new Error('unreadable'); } }) as unknown as string, ref: edit!.id }, { ...sink, send: null });
    expect(unparsed).toMatchObject({ distance: -1 });
    expect(unparsed!.skeleton).not.toBe('');
  });

  // The full audit (2026-11-11, LM-09): an event that could not be sent is sent at the next flush, and only its own account's.
  it('sends what the account lacks at the next flush, once, and never another account\'s or one made signed out', async () => {
    const idb = new fakeIdb!.IDBFactory();
    const mine = { ...learningEvent({ kind: 'generation' }, structure, at(1)), uid: 'alice', sent: false };
    const later = { ...learningEvent({ kind: 'edit' }, structure, at(2)), uid: 'alice', sent: false };
    const theirs = { ...learningEvent({ kind: 'edit' }, structure, at(3)), uid: 'bob', sent: false };
    const signedOut = { ...learningEvent({ kind: 'edit' }, structure, at(4)), uid: null, sent: false };
    const already = { ...learningEvent({ kind: 'edit' }, structure, at(5)), uid: 'alice', sent: true };
    for (const e of [mine, later, theirs, signedOut, already]) await keepLearningEvent(e, idb);

    // Offline: nothing goes, and nothing is marked.
    const failing = async () => { throw new Error('offline'); };
    expect(await flushLearning('alice', structure, failing, idb)).toBe(0);

    const sent: LearningEvent[] = [];
    expect(await flushLearning('alice', structure, async (e) => void sent.push(e), idb)).toBe(2);
    expect(sent.map((e) => e.id)).toEqual([mine.id, later.id]);
    expect(sent[0]).not.toHaveProperty('uid');
    expect(sent[0]).not.toHaveProperty('sent');

    // Sent once: a second flush has nothing left.
    expect(await flushLearning('alice', structure, async (e) => void sent.push(e), idb)).toBe(0);
    const kept = await listLearningEvents(idb);
    expect(kept.find((e) => e.id === mine.id)?.sent).toBe(true);
    expect(kept.find((e) => e.id === theirs.id)?.sent).toBe(false);
    expect(kept.find((e) => e.id === signedOut.id)?.sent).toBe(false);
  });

  // The PRIV review (2026-11-11): the rules allow create and never update, so an event the account already
  // holds (written, then never marked sent) is refused at every later flush. It must not hold back what is newer.
  it('goes on past an event the account refuses, and stops only for want of a connection', async () => {
    const idb = new fakeIdb!.IDBFactory();
    const landed = { ...learningEvent({ kind: 'generation' }, structure, at(1)), uid: 'alice', sent: false };
    const next = { ...learningEvent({ kind: 'edit' }, structure, at(2)), uid: 'alice', sent: false };
    const last = { ...learningEvent({ kind: 'rating', rating: 'good' }, structure, at(3)), uid: 'alice', sent: false };
    for (const e of [landed, next, last]) await keepLearningEvent(e, idb);

    // The account as the rules keep it: a second create of an id it holds is refused.
    const account = new Set<string>([landed.id]);
    const send = async (e: LearningEvent) => {
      if (account.has(e.id)) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      account.add(e.id);
    };
    expect(await flushLearning('alice', structure, send, idb)).toBe(2);
    expect([...account]).toEqual([landed.id, next.id, last.id]);
    // A second flush refuses the same one again and sends nothing twice.
    expect(await flushLearning('alice', structure, send, idb)).toBe(0);
    expect(account.size).toBe(3);

    // No connection still stops the pass, so nothing newer is tried while offline.
    const fresh = { ...learningEvent({ kind: 'edit' }, structure, at(4)), uid: 'alice', sent: false };
    await keepLearningEvent(fresh, idb);
    let tried = 0;
    const offline = async () => {
      tried++;
      throw Object.assign(new Error('offline'), { code: 'unavailable' });
    };
    expect(await flushLearning('alice', structure, offline, idb)).toBe(0);
    expect(tried).toBe(1);
  });

  it('sends nothing at a flush once learning is switched off', async () => {
    const idb = new fakeIdb!.IDBFactory();
    await keepLearningEvent({ ...learningEvent({ kind: 'generation' }, structure, at(1)), uid: 'alice', sent: false }, idb);
    expect(await flushLearning('alice', { structure: false, full: false }, async () => undefined, idb)).toBe(0);
  });

  it('marks nothing it no longer keeps', async () => {
    const idb = new fakeIdb!.IDBFactory();
    await expect(markLearningSent('gone', idb)).resolves.toBeUndefined();
    expect(await listLearningEvents(idb)).toEqual([]);
  });
});

describe('a browser with no IndexedDB', () => {
  it('keeps nothing, lists nothing and clears without failing', async () => {
    const event = learningEvent({ kind: 'edit' }, { structure: true, full: false }, new Date('2026-11-01T00:00:00Z'));
    await expect(keepLearningEvent(event, null)).resolves.toBeUndefined();
    expect(await listLearningEvents(null)).toEqual([]);
    await expect(clearLearningEvents(null)).resolves.toBeUndefined();
  });
});
