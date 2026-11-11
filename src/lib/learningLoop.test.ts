// @vitest-environment jsdom
/**
 * The per-person learning loop (2026-11-11, the full audit's batch LRN2, D1
 * to D4, lib/learningLoop.ts): a report kept teaches the memory, the ledger
 * and the library; an undo counts against what it undid; a first report is
 * given the kept one nearest it, and the reply says so only when it shows.
 * jsdom for localStorage, where the memory lives; this must stay line 1.
 * The library is an in-memory store, so nothing here touches IndexedDB.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { beforeGeneration, houseBrief, keptExample, laidOutLike, onKept, onRedone, onUndone } from './learningLoop';
import { forgetLearned } from './corrections';
import { readMemory, writeMemory } from './memory';
import { parseReportStructure } from './reportPreview';
import { skeletonOf } from './reportSkeleton';
import { KEPT_BLOCK_START } from './houseStyle';
import { forgetKept, type LibraryDeps } from '../services/library';
import type { KeptRecord, KeptStorage } from './libraryDb';

const ROOT = 'SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a" Version="20.1"';

/** A small statement in Tahoma, its title as asked. */
const report = (o: { titleSize?: number; face?: string; title?: string } = {}) =>
  `<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer ${ROOT} Name="ClientSecret" Margins="40, 40, 50, 50" PageWidth="827" PageHeight="1169" PaperKind="A4"><Bands>` +
  '<Item1 Ref="1" ControlType="TopMarginBand" HeightF="50" />' +
  `<Item2 Ref="2" ControlType="ReportHeaderBand" HeightF="40"><Controls><Item1 Ref="3" ControlType="XRLabel" Text="${o.title ?? 'Acme Private Statement'}" Font="${o.face ?? 'Tahoma'}, ${o.titleSize ?? 15}pt, style=Bold" SizeF="500,30" LocationFloat="0,0" /><Item2 Ref="4" ControlType="XRLabel" Text="Account" Font="${o.face ?? 'Tahoma'}, 9pt" SizeF="100,20" LocationFloat="0,30" /></Controls></Item2>` +
  `<Item3 Ref="5" ControlType="DetailBand" HeightF="20"><Controls><Item1 Ref="6" ControlType="XRLabel" Font="${o.face ?? 'Tahoma'}, 8pt" SizeF="100,20" LocationFloat="0,0"><ExpressionBindings><Item1 Ref="7" EventName="BeforePrint" PropertyName="Text" Expression="[SecretField]" /></ExpressionBindings></Item1></Controls></Item3>` +
  '<Item4 Ref="8" ControlType="BottomMarginBand" HeightF="50" /></Bands></XtraReportsLayoutSerializer>';

/** A library whose kept reports live in memory, and which can embed nothing. */
function library() {
  let held: KeptRecord[] = [];
  const kept: KeptStorage = { load: async () => held, save: async (r) => void (held = r.slice()) };
  const never = async () => {
    throw new Error('nothing kept is embedded');
  };
  const deps = { storage: { load: async () => [], save: async () => undefined }, kept, embedEntries: never, embedTexts: never } as unknown as LibraryDeps;
  return { deps, held: () => held };
}

const NOW = new Date('2026-11-11T12:00:00Z');

beforeEach(() => localStorage.clear());

describe('a report kept', () => {
  it('teaches the memory its style, and joins the library without its words', async () => {
    const lib = library();
    expect(await onKept({ repx: report(), projectId: 'p1', owner: 'alice', name: 'Statement', now: NOW }, lib.deps)).toBe(true);
    expect(readMemory('alice').kept.map((k) => k.key)).toEqual(['p1']);
    expect(readMemory(null).kept).toEqual([]);
    expect(lib.held().map((r) => [r.id, r.name, r.face, r.titleSize])).toEqual([['p1', 'Statement', 'Tahoma', 15]]);
    expect(JSON.stringify(lib.held())).not.toMatch(/Acme|Private|SecretField|ClientSecret/);
    // Kept again: one report, in the memory and in the library.
    await onKept({ repx: report(), projectId: 'p1', owner: 'alice', name: 'Statement' }, lib.deps);
    expect(readMemory('alice').kept).toHaveLength(1);
    expect(lib.held()).toHaveLength(1);
  });

  it('is kept once when it was downloaded before it had a project, then saved', async () => {
    const lib = library();
    await onKept({ repx: report(), owner: null, name: 'Statement' }, lib.deps);
    await onKept({ repx: report(), projectId: 'p7', owner: null, name: 'Statement' }, lib.deps);
    expect(lib.held().map((r) => r.id)).toEqual(['p7']);
  });

  it('does nothing at all when the person switched the learning off', async () => {
    const lib = library();
    writeMemory({ memories: [], kept: [], learnFromKept: false }, null);
    expect(await onKept({ repx: report(), madeRepx: report({ titleSize: 12 }), madeRef: 'm1', owner: null }, lib.deps)).toBe(false);
    expect(readMemory(null).kept).toEqual([]);
    expect(readMemory(null).ledger).toEqual([]);
    expect(lib.held()).toEqual([]);
  });

  it("learns a habit from the same change to two reports Forma made, and forgets it on Forget", async () => {
    const lib = library();
    await onKept({ repx: report({ titleSize: 18 }), madeRepx: report(), madeRef: 'm1', projectId: 'p1', owner: null }, lib.deps);
    expect(readMemory(null).memories).toEqual([]);
    await onKept({ repx: report({ titleSize: 18 }), madeRepx: report(), madeRef: 'm2', projectId: 'p2', owner: null }, lib.deps);
    const learned = readMemory(null).memories;
    expect(learned.map((m) => [m.text, m.source])).toEqual([['Titles at 18pt', 'learned']]);
    // Settings' Forget takes the ledger's entries with it (MemorySettings.test.tsx clicks it).
    expect(forgetLearned(readMemory(null).ledger ?? [], learned[0].id)).toEqual([]);
  });

  it('counts an undo against what was undone, so the habit does not form', async () => {
    const lib = library();
    await onKept({ repx: report({ titleSize: 18 }), madeRepx: report(), madeRef: 'm1', projectId: 'p1', owner: null }, lib.deps);
    onUndone({ before: report(), after: report({ titleSize: 18 }), ref: 'e1', owner: null });
    await onKept({ repx: report({ titleSize: 18 }), madeRepx: report(), madeRef: 'm2', projectId: 'p2', owner: null }, lib.deps);
    expect(readMemory(null).memories).toEqual([]);
    expect(readMemory(null).ledger?.filter((c) => c.weight < 0)).toHaveLength(1);
    // Made again with Redo: the undo stops counting, and the habit forms.
    onRedone({ ref: 'e1', owner: null });
    expect(readMemory(null).ledger?.filter((c) => c.weight < 0)).toEqual([]);
    expect(readMemory(null).memories.map((m) => m.text)).toEqual(['Titles at 18pt']);
  });
});

describe('a first report', () => {
  const shape = skeletonOf(parseReportStructure(report()));

  it('is given the kept report nearest it, stripped, and nothing when none is kept', async () => {
    const lib = library();
    expect(await keptExample({ shape, owner: null }, lib.deps)).toBeNull();
    await onKept({ repx: report(), projectId: 'p1', owner: null, name: 'Statement' }, lib.deps);
    const choice = (await keptExample({ shape, owner: null }, lib.deps))!;
    expect(choice).toMatchObject({ name: 'Statement', face: 'Tahoma', titleSize: 15 });
    expect(choice.block.startsWith(KEPT_BLOCK_START)).toBe(true);
    expect(choice.block).not.toMatch(/Acme|Private|SecretField|ClientSecret|Statement/);
    // With no shape and no category named, nothing is guessed.
    expect(await keptExample({ owner: null, words: 'something' }, lib.deps)).toBeNull();
    // The learning off: nothing.
    writeMemory({ ...readMemory(null), learnFromKept: false }, null);
    expect(await keptExample({ shape, owner: null }, lib.deps)).toBeNull();
  });

  // The LRN2 review (2026-11-11): the library is the browser's, the memory the account's.
  it("is never given a report someone else kept in this browser", async () => {
    const lib = library();
    await onKept({ repx: report(), projectId: 'p1', owner: null, name: 'Statement' }, lib.deps);
    expect(lib.held().map((r) => r.owner)).toEqual([null]);
    expect(await keptExample({ shape, owner: 'alice' }, lib.deps)).toBeNull();
    // Alice keeps one: the signed-out visitor's goes, and only hers is used.
    await onKept({ repx: report(), projectId: 'p2', owner: 'alice', name: 'Invoice' }, lib.deps);
    expect(lib.held().map((r) => [r.owner, r.name])).toEqual([['alice', 'Invoice']]);
    expect((await keptExample({ shape, owner: 'alice' }, lib.deps))?.name).toBe('Invoice');
    expect(await keptExample({ shape, owner: null }, lib.deps)).toBeNull();
  });

  it("is given nothing once Settings' Forget has forgotten the kept reports", async () => {
    const lib = library();
    await onKept({ repx: report(), projectId: 'p1', owner: 'alice', name: 'Statement' }, lib.deps);
    expect(await keptExample({ shape, owner: 'alice' }, lib.deps)).not.toBeNull();
    // What MemorySettings' two Forget buttons call (MemorySettings.test.tsx clicks them).
    await forgetKept('alice', lib.deps);
    expect(await keptExample({ shape, owner: 'alice' }, lib.deps)).toBeNull();
  });

  it('is told the memories, and only a first report is given an example', async () => {
    writeMemory({ memories: [{ id: 'm', text: 'Always use A4', source: 'settings', created: '', enabled: true, hints: { paper: 'A4' } }], kept: [], learnFromKept: true }, null);
    const { remembered, kept } = await beforeGeneration({ owner: null, first: false, shape });
    expect(remembered).toMatch(/^THE USER'S REMEMBERED PREFERENCES/);
    expect(remembered).toContain('- Always use A4');
    expect(kept).toBeNull();
    // A first report, with a report kept: the example after the memories, in the same block the prompt places.
    const lib = library();
    await onKept({ repx: report(), projectId: 'p1', owner: null, name: 'Statement' }, lib.deps);
    const first = await beforeGeneration({ owner: null, first: true, shape }, lib.deps);
    expect(first.kept?.name).toBe('Statement');
    expect(first.remembered.indexOf('- Always use A4')).toBeLessThan(first.remembered.indexOf(KEPT_BLOCK_START));
    expect((await beforeGeneration({ owner: null, first: false, shape }, lib.deps)).remembered).not.toContain(KEPT_BLOCK_START);
  });

  it('says it was laid out like the kept report only when it visibly is', () => {
    const kept = { name: 'Invoice', face: 'Tahoma', titleSize: 15 };
    expect(laidOutLike(report(), kept)).toBe('Laid out like your Invoice report.');
    expect(laidOutLike(report(), { ...kept, name: 'Monthly report' })).toBe('Laid out like your Monthly report.');
    expect(laidOutLike(report(), { ...kept, name: 'Untitled report' })).toBe('Laid out like a report you kept.');
    expect(laidOutLike(report({ titleSize: 20 }), kept)).toBe('');
    expect(laidOutLike(report({ face: 'Arial' }), kept)).toBe('');
    expect(laidOutLike(report(), null)).toBe('');
    expect(laidOutLike('not a report', kept)).toBe('');
  });
});

describe('a report described in words', () => {
  it("is given the person's own style once two kept reports show it, with what their changes taught", async () => {
    const lib = library();
    await onKept({ repx: report({ titleSize: 18 }), madeRepx: report(), madeRef: 'm1', projectId: 'p1', owner: null }, lib.deps);
    await onKept({ repx: report({ titleSize: 18 }), madeRepx: report(), madeRef: 'm2', projectId: 'p2', owner: null }, lib.deps);
    const brief = await houseBrief(null, 'HundredthsOfAnInch');
    expect(brief).toMatch(/Tahoma/);
    expect(brief).toMatch(/18/);
    expect(brief).not.toMatch(/Acme|Private|SecretField|ClientSecret/);
  });
});
