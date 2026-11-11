// @vitest-environment jsdom
/**
 * Forma's memory (milestone 4 of docs/proposals/own-model.md). jsdom for
 * localStorage; this must stay line 1. The kept report is made up for the
 * test, and its words are checked not to be kept.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  exportMemory,
  importMemory,
  instructionsOf,
  personalStyle,
  keptStyleOf,
  keptSummary,
  MAX_KEPT,
  memoryFrom,
  memoryKey,
  setMemoryAccount,
  preferencesOf,
  readMemory,
  REMEMBER,
  rememberedReply,
  rememberKept,
  retireLegacyMemory,
  writeMemory,
  type KeptStyle,
  type MemoryState,
} from './memory';

const ROOT = 'SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a" Version="20.1"';
const REPORT =
  `<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer ${ROOT} Name="ClientSecret" Margins="40, 40, 50, 50" PageWidth="827" PageHeight="1169" PaperKind="A4"><Bands>` +
  '<Item1 Ref="1" ControlType="TopMarginBand" HeightF="50" />' +
  '<Item2 Ref="2" ControlType="ReportHeaderBand" HeightF="40"><Controls><Item1 Ref="3" ControlType="XRLabel" Text="Acme Private Statement" Font="Tahoma, 15pt, style=Bold" SizeF="500,30" LocationFloat="0,0" /><Item2 Ref="4" ControlType="XRLabel" Text="Account" Font="Tahoma, 9pt" SizeF="100,20" LocationFloat="0,30" /></Controls></Item2>' +
  '<Item3 Ref="5" ControlType="DetailBand" HeightF="20"><Controls><Item1 Ref="6" ControlType="XRLabel" Font="Tahoma, 8pt" SizeF="100,20" LocationFloat="0,0"><ExpressionBindings><Item1 Ref="7" EventName="BeforePrint" PropertyName="Text" Expression="[SecretField]" /></ExpressionBindings></Item1></Controls></Item3>' +
  '<Item4 Ref="8" ControlType="BottomMarginBand" HeightF="50" /></Bands></XtraReportsLayoutSerializer>';

const style = (o: Partial<KeptStyle>): KeptStyle => ({ at: '2026-11-02T00:00:00Z', paper: 'Letter', landscape: false, fontFamily: 'Arial', sizes: { value: 8 }, ...o });

beforeEach(() => localStorage.clear());

describe('what a message asks Forma to remember', () => {
  // Only "remember" and "from now on" (the owner's rule, 2026-11-07, agent audit item 2).
  it('knows a memory from a request', () => {
    for (const m of ['remember: always use A4', 'Remember that our titles are 16pt', 'From now on, landscape please', 'please remember to use Tahoma']) expect(REMEMBER.test(m), m).toBe(true);
    for (const m of ['Create a stock register', 'a report that always totals', 'what can you remember?', 'Always use Tahoma', 'Never mind, make the title red', 'Note that the total is wrong', 'I prefer 9pt captions']) {
      expect(REMEMBER.test(m), m).toBe(false);
    }
  });

  it('keeps the words after "remember", and what Forma’s own model can apply', () => {
    const m = memoryFrom('Remember that our reports use A4 landscape, Tahoma, titles 14pt and values 8pt.', 'chat', new Date('2026-11-02T10:00:00Z'));
    expect(m.text).toBe('Our reports use A4 landscape, Tahoma, titles 14pt and values 8pt');
    expect(m.hints).toEqual({ paper: 'A4', landscape: true, fontFamily: 'Tahoma', sizes: { title: 14, value: 8 } });
    expect(memoryFrom('Always use portrait').text).toBe('Always use portrait');
    expect(memoryFrom('remember: never use Letter').text).toBe('Never use Letter');
    expect(rememberedReply(m)).toBe('Got it: A4 paper, landscape, Tahoma, 14pt titles, 8pt values from now on. You can change it in Settings, under Memory.');
  });

  // The full audit (2026-11-11, CV-06): what it means for the next report, never which part of Forma applies it.
  it('says what is kept in plain words, and where to change it', () => {
    expect(rememberedReply(memoryFrom('remember: always use A4'))).toBe('Got it: A4 paper from now on. You can change it in Settings, under Memory.');
    const plain = rememberedReply(memoryFrom('remember that our client is Contoso'));
    expect(plain).toBe("Got it, I'll keep that in mind for every report. You can change it in Settings, under Memory.");
    expect(plain).not.toMatch(/own model|any AI|told it/);
  });

  // Agent audit item 14: a name said as not wanted is not a hint, and the first wanted wins.
  it('reads what is not wanted as not wanted, and the first name wanted over the rest', () => {
    expect(memoryFrom('never use Letter').hints).toEqual({});
    expect(memoryFrom('Use Tahoma instead of Arial').hints).toEqual({ fontFamily: 'Tahoma' });
    expect(memoryFrom('A4, not Letter').hints).toEqual({ paper: 'A4' });
    expect(memoryFrom('not Letter but Legal').hints).toEqual({ paper: 'Legal' });
    expect(memoryFrom('Verdana rather than Arial, on A3').hints).toEqual({ paper: 'A3', fontFamily: 'Verdana' });
    expect(memoryFrom('never landscape').hints).toEqual({ landscape: false });
    expect(memoryFrom("don't print in portrait").hints).toEqual({ landscape: true });
  });
});

describe('what a kept report teaches', () => {
  it('its style, and none of its words', () => {
    const kept = keptStyleOf(REPORT, new Date('2026-11-02T10:00:00Z'))!;
    expect(kept).toEqual({ skeleton: expect.objectContaining({ paper: 'A4' }), key: expect.stringMatching(/^s[0-9a-z]+$/), shape: kept!.key, at: '2026-11-02T10:00:00.000Z', paper: 'A4', landscape: false, fontFamily: 'Tahoma', sizes: { title: 15, caption: 9, value: 8 } });
    expect(JSON.stringify(kept)).not.toMatch(/Acme|Private|SecretField|ClientSecret|Account/);
    expect(keptStyleOf('not a report')).toBeNull();
  });

  it('keeps the newest reports, and learns a style from two', () => {
    let state: MemoryState = { memories: [], kept: [], learnFromKept: true };
    for (let i = 0; i < MAX_KEPT + 5; i++) state = rememberKept(state, style({ at: String(i) }));
    expect(state.kept).toHaveLength(MAX_KEPT);
    expect(state.kept[0].at).toBe('5');
    expect(keptSummary({ memories: [], kept: [style({})], learnFromKept: true })).toBeNull();
    expect(keptSummary({ memories: [], kept: [style({ paper: 'A4' }), style({ paper: 'A4' }), style({})], learnFromKept: false })).toBeNull();
    expect(keptSummary({ memories: [], kept: [style({ paper: 'A4' }), style({ paper: 'A4' }), style({})], learnFromKept: true })).toMatchObject({ reports: 3, paper: 'A4', sizes: { value: 8 } });
  });

  // The full audit (2026-11-11, LM-28): one report exported five times is one report, not a house style.
  it('counts one report kept many times once, as it was last kept', () => {
    let state: MemoryState = { memories: [], kept: [], learnFromKept: true };
    for (let i = 0; i < 5; i++) state = rememberKept(state, style({ key: 'project-1', paper: 'A4', at: String(i) }));
    expect(state.kept).toHaveLength(1);
    expect(state.kept[0].at).toBe('4');
    expect(keptSummary(state)).toBeNull();
    state = rememberKept(state, style({ key: 'project-2' }));
    expect(state.kept.map((k) => k.key)).toEqual(['project-1', 'project-2']);
    // A style kept before the key carries none, and stays beside the rest.
    state = rememberKept({ ...state, kept: [style({}), ...state.kept] }, style({ key: 'project-1', at: '5' }));
    expect(state.kept.map((k) => k.key)).toEqual([undefined, 'project-2', 'project-1']);
    // The same report kept again without a project is known by its skeleton.
    expect(keptStyleOf(REPORT)!.key).toBe(keptStyleOf(REPORT, new Date(0))!.key);
    expect(keptStyleOf(REPORT, new Date(), 'project-9')!.key).toBe('project-9');
  });

  // D1 (2026-11-11): the person's own house style, from the skeletons of two or more kept reports.
  it('learns a personal house style from two kept reports, with margins, bold and row height', () => {
    const one = keptStyleOf(REPORT, new Date(), 'p1')!;
    let state: MemoryState = { memories: [], kept: [one], learnFromKept: true };
    expect(personalStyle(state)).toBeNull();
    state = rememberKept(state, keptStyleOf(REPORT, new Date(), 'p2')!);
    const mine = personalStyle(state)!;
    expect(mine.reports).toBe(2);
    expect(mine.style.fonts[0].family).toBe('Tahoma');
    expect(JSON.stringify(mine)).not.toMatch(/Acme|Private|SecretField|ClientSecret/);
    const prefs = preferencesOf(state);
    expect(prefs.margins).toBeDefined();
    expect(prefs.rowHeight).toBeGreaterThan(0);
    expect(prefs.bold?.title).toBeDefined();
    // No record's row in any kept report: no row height, rather than learnStyle's default.
    const noRows = { ...state, kept: state.kept.map((k) => ({ ...k, skeleton: { ...k.skeleton!, bands: k.skeleton!.bands.filter((b) => b.kind !== 'Detail') } })) };
    expect(preferencesOf(noRows).rowHeight).toBeUndefined();
    expect(personalStyle({ ...state, learnFromKept: false })).toBeNull();
    // A style kept before skeletons were (no `skeleton`) counts for nothing here.
    expect(personalStyle({ ...state, kept: state.kept.map(({ skeleton: _s, ...k }) => k) })).toBeNull();
  });

  // CP-13 (2026-11-11): a memory said for this client applies in its project alone.
  it('keeps a memory said for this client to its project, and moves memories as one file', () => {
    const forClient = memoryFrom('remember: for this client use Letter', 'chat', new Date(), 'project-1');
    const everywhere = memoryFrom('remember: always use Tahoma', 'chat', new Date(), 'project-1');
    expect(forClient.projectId).toBe('project-1');
    expect(everywhere.projectId).toBeUndefined();
    expect(memoryFrom('remember: for this client use Letter').projectId).toBeUndefined();
    const state: MemoryState = { memories: [forClient, everywhere], kept: [], learnFromKept: true };
    expect(instructionsOf(state, 'project-1')).toMatch(/Letter/);
    expect(instructionsOf(state, 'project-2')).not.toMatch(/Letter/);
    expect(instructionsOf(state, 'project-2')).toMatch(/Tahoma/);
    expect(preferencesOf(state, 'project-1').paper).toBe('Letter');
    expect(preferencesOf(state, null).paper).toBeUndefined();

    const file = exportMemory(state);
    const empty: MemoryState = { memories: [], kept: [], learnFromKept: true };
    const back = importMemory(empty, file)!;
    expect(back.memories.map((m) => [m.text, m.projectId])).toEqual([[forClient.text, 'project-1'], [everywhere.text, undefined]]);
    expect(importMemory(back, file)!.memories).toHaveLength(2);
    // One id twice in a file is one memory, not two rows under one key.
    const twice = JSON.stringify({ forma: 'memory', memories: [forClient, { ...forClient, text: 'again' }] });
    expect(importMemory(empty, twice)!.memories).toHaveLength(1);
    expect(importMemory(empty, '{"forma":"other"}')).toBeNull();
    expect(importMemory(empty, 'not json')).toBeNull();
  });

  // A wave-4 follow-up (2026-11-11): downloaded before it was saved, then saved, is still one report.
  it('counts a report kept before it had a project and after once', () => {
    const before = keptStyleOf(REPORT, new Date('2026-11-11T09:00:00Z'))!;
    const after = keptStyleOf(REPORT, new Date('2026-11-11T10:00:00Z'), 'project-7')!;
    expect(after.shape).toBe(before.key);
    let state: MemoryState = { memories: [], kept: [], learnFromKept: true };
    state = rememberKept(rememberKept(state, before), after);
    expect(state.kept.map((k) => k.key)).toEqual(['project-7']);
  });
});

/* Each account its own memory (2026-11-11, the full audit, WS-28, LM-18, SA-07, SE-17). */
describe('whose memory it is', () => {
  const alice: MemoryState = { memories: [memoryFrom('remember: always use A4')], kept: [], learnFromKept: true };

  afterEach(() => setMemoryAccount(null));

  it('keeps each account apart, and apart from use signed out', () => {
    writeMemory(alice, 'alice');
    expect(readMemory('alice')).toEqual(alice);
    expect(readMemory('bob').memories).toEqual([]);
    expect(readMemory(null).memories).toEqual([]);
    expect(localStorage.getItem('forma.memory:alice')).not.toBeNull();
    expect(memoryKey(null)).toBe('forma.memory');
    expect(memoryKey('bob')).toBe('forma.memory:bob');
  });

  it('reads and writes the account named by the sign-in when none is passed', () => {
    setMemoryAccount('alice');
    writeMemory(alice);
    expect(readMemory().memories).toHaveLength(1);
    setMemoryAccount('bob');
    expect(readMemory().memories).toEqual([]);
    setMemoryAccount(null);
    expect(readMemory().memories).toEqual([]);
    expect(readMemory('alice').memories).toHaveLength(1);
  });

  // A wave-4 follow-up (2026-11-11): the one key everybody wrote before it was per account.
  it('clears the signed-out memory once, at the first sign-out, and keeps what is written signed out after it', () => {
    writeMemory(alice, null);
    writeMemory(alice, 'alice');
    expect(retireLegacyMemory()).toBe(true);
    expect(readMemory(null).memories).toEqual([]);
    expect(readMemory('alice').memories).toHaveLength(1);
    writeMemory(alice, null);
    expect(retireLegacyMemory()).toBe(false);
    expect(readMemory(null).memories).toHaveLength(1);
    expect(retireLegacyMemory(null)).toBe(false);
  });
});

describe('using what is remembered', () => {
  const state: MemoryState = {
    kept: [style({ paper: 'A4', fontFamily: 'Verdana' }), style({ paper: 'A4', fontFamily: 'Verdana' })],
    learnFromKept: true,
    memories: [
      { ...memoryFrom('always use Tahoma'), enabled: true },
      { ...memoryFrom('use Letter landscape'), enabled: false },
      { ...memoryFrom('titles 16pt'), enabled: true },
    ],
  };

  it("lets the user's words win over what their reports show, and skips a memory switched off", () => {
    expect(preferencesOf(state)).toEqual({ paper: 'A4', landscape: false, fontFamily: 'Tahoma', sizes: { value: 8, title: 16 } });
  });

  it('tells an AI each memory and the kept style, or nothing at all', () => {
    const text = instructionsOf(state);
    expect(text).toMatch(/^THE USER'S REMEMBERED PREFERENCES/);
    expect(text).toContain('- Always use Tahoma');
    expect(text).not.toContain('Letter landscape');
    expect(text).toContain('- Their 2 kept reports use A4 paper and Verdana: values 8pt.');
    expect(instructionsOf({ memories: [], kept: [], learnFromKept: true })).toBe('');
  });

  it('is kept in this browser and read back', () => {
    expect(readMemory()).toEqual({ memories: [], kept: [], learnFromKept: true });
    writeMemory(state);
    expect(readMemory()).toEqual(state);
    localStorage.setItem('forma.memory', '{not json');
    expect(readMemory().memories).toEqual([]);
  });
});
