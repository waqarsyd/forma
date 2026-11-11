/**
 * What the person's own changes teach Forma (2026-11-11, the full audit's
 * D4, lib/corrections.ts). The reports are made up for the test: the same
 * statement as Forma made it and as the person kept it, with one or two
 * parts changed. Node, not jsdom: the parse is regex, not DOMParser.
 */
import { describe, expect, it } from 'vitest';
import {
  LEARN_AFTER,
  MAX_LEDGER,
  colourName,
  forgetLearned,
  keptCorrections,
  learnedId,
  learnedMemories,
  learnedPreferences,
  learnedText,
  recordCorrections,
  styleOfReport,
  undoneCorrections,
  withLearned,
  type Correction,
} from './corrections';
import type { HouseStyle } from './formaModel';
import type { Memory } from './memory';

const ROOT = 'SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a" Version="20.1"';

/** A small statement, its title and margins as asked. Hundredths of an inch, the default unit. */
const report = (o: { titleSize?: number; titleFont?: string; titleBold?: boolean; titleColour?: string; left?: number } = {}) => {
  const font = `${o.titleFont ?? 'Tahoma'}, ${o.titleSize ?? 15}pt${o.titleBold === false ? '' : ', style=Bold'}`;
  const colour = o.titleColour ? ` ForeColor="${o.titleColour}"` : '';
  return (
    `<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer ${ROOT} Name="ClientSecret" Margins="${o.left ?? 40}, 40, 50, 50" PageWidth="827" PageHeight="1169" PaperKind="A4"><Bands>` +
    '<Item1 Ref="1" ControlType="TopMarginBand" HeightF="50" />' +
    `<Item2 Ref="2" ControlType="ReportHeaderBand" HeightF="40"><Controls><Item1 Ref="3" ControlType="XRLabel" Text="Acme Private Statement" Font="${font}"${colour} SizeF="500,30" LocationFloat="0,0" /><Item2 Ref="4" ControlType="XRLabel" Text="Account" Font="Tahoma, 9pt" SizeF="100,20" LocationFloat="0,30" /></Controls></Item2>` +
    '<Item3 Ref="5" ControlType="DetailBand" HeightF="20"><Controls><Item1 Ref="6" ControlType="XRLabel" Font="Tahoma, 8pt" SizeF="100,20" LocationFloat="0,0"><ExpressionBindings><Item1 Ref="7" EventName="BeforePrint" PropertyName="Text" Expression="[SecretField]" /></ExpressionBindings></Item1></Controls></Item3>' +
    '<Item4 Ref="8" ControlType="BottomMarginBand" HeightF="50" /></Bands></XtraReportsLayoutSerializer>'
  );
};

const NOW = new Date('2026-11-11T12:00:00Z');

describe("a report's style", () => {
  it('reads each kind of text and the margins, and nothing of the words', () => {
    const style = styleOfReport(report())!;
    expect(style.parts.title).toEqual({ font: 'Tahoma', size: 15, bold: true, align: 'left', colour: 'black' });
    expect(style.parts.value?.size).toBe(8);
    expect(style.margins).toEqual({ left: 0.4, right: 0.4, top: 0.5, bottom: 0.5 });
    expect(JSON.stringify(style)).not.toMatch(/Acme|Private|SecretField|ClientSecret|Account/);
    expect(styleOfReport('not a report')).toBeNull();
  });

  it('spells one colour one way', () => {
    expect(colourName('Maroon')).toBe('maroon');
    expect(colourName('128, 0, 0')).toBe('#800000');
    expect(colourName('')).toBe('black');
  });
});

describe('what the person changed', () => {
  it('is each part they changed, at the value they kept, for the report Forma made', () => {
    const changes = keptCorrections(report(), report({ titleSize: 18, left: 100 }), 'm1', NOW);
    expect(changes.map((c) => [c.kind, c.part, c.value, c.weight, c.ref])).toEqual([
      ['size', 'title', '18', 1, 'm1'],
      ['margin', 'left', '1', 1, 'm1'],
    ]);
    expect(keptCorrections(report(), report(), 'm1')).toEqual([]);
    expect(keptCorrections('x', report(), 'm1')).toEqual([]);
  });

  it('counts an undone change against the value Forma changed it to', () => {
    const undone = undoneCorrections(report(), report({ titleFont: 'Verdana' }), 'e1', NOW);
    expect(undone).toEqual([{ kind: 'font', part: 'title', value: 'Verdana', weight: -1, ref: 'e1', at: NOW.toISOString() }]);
  });

  it('keeps one report once, however often it is kept, and the newest MAX_LEDGER', () => {
    let ledger = recordCorrections([], keptCorrections(report(), report({ titleSize: 18 }), 'm1', NOW));
    ledger = recordCorrections(ledger, keptCorrections(report(), report({ titleSize: 20 }), 'm1', NOW));
    expect(ledger.map((c) => c.value)).toEqual(['20']);
    const many: Correction[] = Array.from({ length: MAX_LEDGER + 10 }, (_, i) => ({ kind: 'size', part: 'title', value: '18', weight: 1, ref: `r${i}`, at: NOW.toISOString() }));
    const full = many.reduce((l, c) => recordCorrections(l, [c]), [] as Correction[]);
    expect(full).toHaveLength(MAX_LEDGER);
    expect(full[0].ref).toBe('r10');
  });
});

describe('a habit, from two reports', () => {
  const kept = (ref: string, o: Parameters<typeof report>[0]) => keptCorrections(report(), report(o), ref, NOW);

  it('is learned once two reports Forma made were changed the same way, and not from one', () => {
    const once = recordCorrections([], kept('m1', { titleSize: 18 }));
    expect(learnedPreferences(once)).toEqual([]);
    const twice = recordCorrections(once, kept('m2', { titleSize: 18 }));
    expect(LEARN_AFTER).toBe(2);
    expect(learnedPreferences(twice)).toEqual([{ kind: 'size', part: 'title', value: '18', net: 2 }]);
  });

  it('is not learned when an undo says the opposite', () => {
    let ledger = recordCorrections([], kept('m1', { titleSize: 18 }));
    ledger = recordCorrections(ledger, kept('m2', { titleSize: 18 }));
    ledger = recordCorrections(ledger, undoneCorrections(report(), report({ titleSize: 18 }), 'e1', NOW));
    expect(learnedPreferences(ledger)).toEqual([]);
  });

  it('becomes a memory of its own, said in plain words, kept off when switched off, gone when undone', () => {
    const ledger = recordCorrections(recordCorrections([], kept('m1', { titleSize: 18, titleBold: false })), kept('m2', { titleSize: 18, titleBold: false }));
    const own: Memory = { id: 'own', text: 'Always use A4', source: 'settings', created: NOW.toISOString(), enabled: true, hints: { paper: 'A4' } };
    const memories = learnedMemories([own], learnedPreferences(ledger), NOW);
    expect(memories.map((m) => [m.id, m.text, m.source])).toEqual([
      ['own', 'Always use A4', 'settings'],
      ['learned-size-title', 'Titles at 18pt', 'learned'],
      ['learned-bold-title', 'Titles not bold', 'learned'],
    ]);
    expect(memories[1].hints).toEqual({ sizes: { title: 18 } });
    expect(memories[2].hints).toEqual({ bold: { title: false } });
    // Switched off, it stays off while the habit holds.
    const off = memories.map((m) => (m.id === 'learned-size-title' ? { ...m, enabled: false } : m));
    expect(learnedMemories(off, learnedPreferences(ledger), NOW).find((m) => m.id === 'learned-size-title')?.enabled).toBe(false);
    // No longer held: it goes, and the person's own memory stays.
    expect(learnedMemories(memories, [], NOW)).toEqual([own]);
  });

  it('is forgotten with what it was counted from, so the same two reports do not bring it back', () => {
    const ledger = recordCorrections(recordCorrections([], kept('m1', { titleSize: 18 })), kept('m2', { titleSize: 18 }));
    const left = forgetLearned(ledger, learnedId('size', 'title'));
    expect(left).toEqual([]);
    expect(learnedPreferences(left)).toEqual([]);
  });

  it('says every kind in words a person reads, never as a machine would', () => {
    expect(learnedText({ kind: 'font', part: 'value', value: 'Verdana' })).toBe('Text in Verdana');
    expect(learnedText({ kind: 'font', part: 'title', value: 'Verdana' })).toBe('Titles in Verdana');
    expect(learnedText({ kind: 'align', part: 'total', value: 'right' })).toBe('Totals aligned right');
    expect(learnedText({ kind: 'bold', part: 'caption', value: 'bold' })).toBe('Captions and column headings in bold');
    expect(learnedText({ kind: 'colour', part: 'title', value: 'maroon' })).toBe('Titles in maroon');
    expect(learnedText({ kind: 'margin', part: 'left', value: '1' })).toBe('Left margin of 1 inch');
  });
});

describe("the house style a described report is given", () => {
  const style: HouseStyle = {
    papers: [{ paper: 'A4', landscape: false, share: 1 }],
    margins: { A4: { top: 50, bottom: 50, left: 40, right: 40 } },
    fonts: [{ family: 'Tahoma', share: 1 }],
    roles: { title: { family: 'Tahoma', size: 15, bold: 1 } },
    bands: {},
    rowHeight: 20,
  };
  const learned = (kind: string, part: string, text: string, enabled = true): Memory => ({ id: `learned-${kind}-${part}`, text, source: 'learned', created: NOW.toISOString(), enabled, hints: {} });

  it('carries what the changes taught, and only the habits switched on', () => {
    const out = withLearned(style, [
      learned('size', 'title', 'Titles at 18pt'),
      learned('bold', 'title', 'Titles not bold'),
      learned('font', 'value', 'Text in Verdana'),
      learned('margin', 'left', 'Left margin of 1 inch'),
      learned('size', 'caption', 'Captions and column headings at 11pt', false),
    ]);
    expect(out.roles.title).toEqual({ family: 'Tahoma', size: 18, bold: 0 });
    expect(out.roles.value?.family).toBe('Verdana');
    expect(out.fonts[0].family).toBe('Verdana');
    expect(out.margins.A4).toEqual({ top: 50, bottom: 50, left: 100, right: 40 });
    expect(out.roles.caption).toBeUndefined();
    // The style it was given is not changed.
    expect(style.roles.title?.size).toBe(15);
    expect(withLearned(style, [])).toBe(style);
  });
});
