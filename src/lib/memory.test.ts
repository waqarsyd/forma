// @vitest-environment jsdom
/**
 * Forma's memory (milestone 4 of docs/proposals/own-model.md). jsdom for
 * localStorage; this must stay line 1. The kept report is made up for the
 * test, and its words are checked not to be kept.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  instructionsOf,
  keptStyleOf,
  keptSummary,
  MAX_KEPT,
  memoryFrom,
  preferencesOf,
  readMemory,
  REMEMBER,
  rememberedReply,
  rememberKept,
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
  it('knows a memory from a request', () => {
    for (const m of ['remember: always use A4', 'Always use Tahoma', 'From now on, landscape please', 'I prefer 9pt captions', 'never put the logo on the right']) expect(REMEMBER.test(m), m).toBe(true);
    for (const m of ['Create a stock register', 'a report that always totals', 'what can you remember?']) expect(REMEMBER.test(m), m).toBe(false);
  });

  it('keeps the words after "remember", and what Forma’s own model can apply', () => {
    const m = memoryFrom('Remember that our reports use A4 landscape, Tahoma, titles 14pt and values 8pt.', 'chat', new Date('2026-11-02T10:00:00Z'));
    expect(m.text).toBe('Our reports use A4 landscape, Tahoma, titles 14pt and values 8pt');
    expect(m.hints).toEqual({ paper: 'A4', landscape: true, fontFamily: 'Tahoma', sizes: { title: 14, value: 8 } });
    expect(memoryFrom('Always use portrait').text).toBe('Always use portrait');
    expect(memoryFrom('never use Letter').hints).toEqual({ paper: 'Letter' });
    expect(rememberedReply(m)).toContain('A4 paper, landscape, Tahoma, 14pt titles, 8pt values');
  });
});

describe('what a kept report teaches', () => {
  it('its style, and none of its words', () => {
    const kept = keptStyleOf(REPORT, new Date('2026-11-02T10:00:00Z'))!;
    expect(kept).toEqual({ at: '2026-11-02T10:00:00.000Z', paper: 'A4', landscape: false, fontFamily: 'Tahoma', sizes: { title: 15, caption: 9, value: 8 } });
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
