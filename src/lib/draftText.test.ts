// @vitest-environment jsdom
/**
 * Forma's draft as the AI corrects it (2026-11-05). jsdom for `checkRepx`,
 * which parses with DOMParser; this must stay line 1. What matters: a draft
 * reads back as it was written, the words, fields, groups and colours the AI
 * writes reach the report, and the slips a model makes cost a line, not the
 * report.
 */
import { describe, expect, it } from 'vitest';
import { controlCount, CORRECTION_RULES, draftToText, textToDraft } from './draftText';
import { noneGiven, placeKey, skeletonToDesign } from './skeletonRepx';
import { checkRepx } from './repx';
import type { ReportSkeleton } from './reportSkeleton';

const SKELETON: ReportSkeleton = {
  paper: 'Letter',
  landscape: false,
  width: 850,
  height: 1100,
  margins: { top: 75, bottom: 75, left: 75, right: 75 },
  bands: [
    { kind: 'ReportHeader', height: 60, groupFields: 0, controls: [{ kind: 'label', role: 'title', x: 0, y: 0, w: 300, h: 30, font: { family: 'Arial', size: 18, bold: true, italic: false }, align: 'left', borders: 0, chars: 17 }] },
    { kind: 'GroupHeader', height: 25, groupFields: 1, controls: [{ kind: 'label', role: 'value', x: 0, y: 0, w: 200, h: 20, font: { family: 'Arial', size: 10, bold: true, italic: false }, align: 'left', borders: 0, chars: 0 }] },
    {
      kind: 'PageHeader',
      height: 20,
      groupFields: 0,
      controls: [
        {
          kind: 'table', role: 'caption', x: 0, y: 0, w: 700, h: 20, font: { family: 'Arial', size: 9, bold: true, italic: false }, align: 'left', borders: 4, chars: 0,
          rows: [[
            { role: 'caption', weight: 3, font: { family: 'Arial', size: 9, bold: true, italic: false }, align: 'left', chars: 11 },
            { role: 'caption', weight: 1, font: { family: 'Arial', size: 9, bold: true, italic: false }, align: 'right', chars: 6 },
          ]],
        },
      ],
    },
    {
      kind: 'Detail',
      height: 20,
      groupFields: 0,
      controls: [
        {
          kind: 'table', role: 'value', x: 0, y: 0, w: 700, h: 20, font: { family: 'Arial', size: 9, bold: false, italic: false }, align: 'left', borders: 0, chars: 0,
          rows: [[
            { role: 'value', weight: 3, font: { family: 'Arial', size: 9, bold: false, italic: false }, align: 'left', chars: 0 },
            { role: 'value', weight: 1, font: { family: 'Arial', size: 9, bold: false, italic: false }, align: 'right', chars: 0 },
          ]],
        },
      ],
    },
    {
      kind: 'ReportFooter',
      height: 30,
      groupFields: 0,
      controls: [
        { kind: 'label', role: 'caption', x: 450, y: 5, w: 100, h: 20, font: { family: 'Arial', size: 9, bold: true, italic: false }, align: 'right', borders: 0, chars: 9 },
        { kind: 'label', role: 'total', x: 560, y: 5, w: 140, h: 20, font: { family: 'Arial', size: 9, bold: true, italic: false }, align: 'right', borders: 0, chars: 0 },
      ],
    },
  ],
};

const GIVEN = (() => {
  const g = noneGiven();
  g.words.set(placeKey(0, 0), 'Northwind Traders');
  g.colours.set(placeKey(0, 0), { ink: '#1F3864' });
  g.groups.set(1, ['Region']);
  g.fields.set(placeKey(1, 0), 'Region');
  g.words.set(placeKey(2, 0, 0, 0), 'Description');
  g.words.set(placeKey(2, 0, 0, 1), 'Amount');
  g.fields.set(placeKey(3, 0, 0, 0), 'Description');
  g.fields.set(placeKey(3, 0, 0, 1), 'Amount');
  g.words.set(placeKey(4, 0), 'Total Due');
  g.colours.set(placeKey(4, 0), { fill: '#F2F2F2' });
  g.fields.set(placeKey(4, 1), 'Amount');
  return g;
})();

describe('the draft as text', () => {
  const text = draftToText(SKELETON, GIVEN);

  it('is the skeleton line by line, with the words, fields, groups and colours after it', () => {
    expect(text.split('\n')).toEqual([
      'page Letter portrait 850 1100 75 75 75 75',
      'band ReportHeader 60 0',
      'label title 0 0 300 30 Arial:18b l 0 17 "Northwind Traders" ink=#1F3864',
      'band GroupHeader 25 1 [Region]',
      'label value 0 0 200 20 Arial:10b l 0 0 [Region]',
      'band PageHeader 20 0',
      'table caption 0 0 700 20 Arial:9b l 4 0',
      'row caption 3 Arial:9b l 11 "Description" | caption 1 Arial:9b r 6 "Amount"',
      'band Detail 20 0',
      'table value 0 0 700 20 Arial:9 l 0 0',
      'row value 3 Arial:9 l 0 [Description] | value 1 Arial:9 r 0 [Amount]',
      'band ReportFooter 30 0',
      'label caption 450 5 100 20 Arial:9b r 0 9 "Total Due" fill=#F2F2F2',
      'label total 560 5 140 20 Arial:9b r 0 0 [Amount]',
    ]);
  });

  it('reads back as it was written', () => {
    const back = textToDraft(text);
    expect(back.problems).toEqual([]);
    expect(back.skeleton).toEqual(SKELETON);
    expect(back.given.words).toEqual(GIVEN.words);
    expect(back.given.fields).toEqual(GIVEN.fields);
    expect(back.given.groups).toEqual(GIVEN.groups);
    expect(back.given.colours).toEqual(GIVEN.colours);
    expect(controlCount(back.skeleton)).toBe(6);
  });
});

describe('what the AI writes back', () => {
  it('keeps words with spaces, quotes and a bar inside them', () => {
    const back = textToDraft('page A4 portrait 827 1169 50 50 50 50\nband PageHeader 20 0\ntable caption 0 0 700 20 Arial:9b l 0 0\nrow caption 1 Arial:9b l 9 "Qty | Unit" | caption 1 Arial:9b l 5 "Say \\"hi\\""');
    expect(back.problems).toEqual([]);
    expect(back.given.words.get(placeKey(0, 0, 0, 0))).toBe('Qty | Unit');
    expect(back.given.words.get(placeKey(0, 0, 0, 1))).toBe('Say "hi"');
  });

  it('forgives a length left out, a total written as an expression and a fence', () => {
    const back = textToDraft('```\npage Letter portrait 850 1100 75 75 75 75\nband ReportFooter 30 0\nlabel caption 450 5 100 20 Arial:9b r 0 "Subtotal"\nlabel total 560 5 140 20 Arial:9b r 0 0 sumSum([Amount])\n```');
    expect(back.problems).toEqual([]);
    expect(back.given.words.get(placeKey(0, 0))).toBe('Subtotal');
    expect(back.skeleton!.bands[0].controls[0].chars).toBe(8);
    expect(back.given.fields.get(placeKey(0, 1))).toBe('Amount');
  });

  it('forgives the borders and length a model drops once it has written the words, and an alignment as a word', () => {
    const back = textToDraft('page Letter portrait 850 1100 75 75 75 75\nband PageHeader 20 0\nlabel caption 94 0 80 20 Arial:9b left "Company"\ntable caption 0 0 700 20 Arial:9b l\nrow caption 2 Arial:9b l "Contact" | caption 1 Arial:9b right "Balance"\nlabel caption 0 0 10 10 Arial:9 "No alignment"');
    // Even with no alignment at all, a label is read, as left-aligned.
    expect(back.problems).toEqual([]);
    expect(back.skeleton!.bands[0].controls[2]).toMatchObject({ kind: 'label', align: 'left', chars: 12 });
    const [label, table] = back.skeleton!.bands[0].controls;
    expect(label).toMatchObject({ align: 'left', borders: 0, chars: 7 });
    expect(back.given.words.get(placeKey(0, 0))).toBe('Company');
    expect(table.rows![0].map((c) => c.align)).toEqual(['left', 'right']);
    expect(back.given.words.get(placeKey(0, 1, 0, 1))).toBe('Balance');
  });

  it('reads a line and a table written without role, font or alignment, as the first measured answers wrote them', () => {
    // Quoted from the benchmark's log on 2026-11-05: the strict reading dropped
    // both, and with the table its row of headings.
    const back = textToDraft(
      'page Letter portrait 850 1100 75 75 75 75\nband PageHeader 60 0\nline 0 42 754 1 0 0 0 #002244\ntable 0 0 938 18 1 1 1 1 1 1\nrow caption 0.5 Arial:8.5b l 8 "Customer" | caption 0.5 Arial:8.5b r 7 "Balance"',
    );
    expect(back.problems).toEqual([]);
    const [line, table] = back.skeleton!.bands[0].controls;
    expect(line).toMatchObject({ kind: 'line', role: 'decoration', x: 0, y: 42, w: 754, h: 1, font: null, align: 'left', borders: 0 });
    expect(back.given.colours.get(placeKey(0, 0))).toEqual({ ink: '#002244' });
    expect(table).toMatchObject({ kind: 'table', role: 'value', x: 0, y: 0, w: 938, h: 18 });
    expect(table.rows).toHaveLength(1);
    expect(back.given.words.get(placeKey(0, 1, 0, 1))).toBe('Balance');
  });

  it('takes words only for text and a field only for a value or a total', () => {
    const back = textToDraft('page Letter portrait 850 1100 75 75 75 75\nband Detail 20 0\nlabel value 0 0 100 20 Arial:9 l 0 0 "Chai" [Item]\nlabel caption 100 0 100 20 Arial:9 l 0 4 "Item" [Item]\nlabel decoration 200 0 100 20 - l 0 0 "x" fill=#ABCDEF fill=bad');
    expect(back.given.words.has(placeKey(0, 0))).toBe(false);
    expect(back.given.fields.get(placeKey(0, 0))).toBe('Item');
    expect(back.given.fields.has(placeKey(0, 1))).toBe(false);
    expect(back.given.words.has(placeKey(0, 2))).toBe(false);
    expect(back.given.colours.get(placeKey(0, 2))).toEqual({ fill: '#ABCDEF' });
  });

  it('skips what it cannot read and names it, and refuses only an answer with no page line', () => {
    const back = textToDraft('page Letter portrait 850 1100 75 75 75 75\nlabel title 0 0 10 10 Arial:9 l 0 0\nband Detail 20 0\nlabel title zero 0 10 10 Arial:9 l 0 0\nHere is the corrected draft.\nlabel title 0 0 100 20 Arial:9 l 0 5 "Hello"');
    expect(back.problems).toEqual(['line 2: a control before any band', 'line 4: a control needs a kind, a role, four numbers, a font, an alignment, borders and a length', 'line 5: not understood']);
    expect(controlCount(back.skeleton)).toBe(1);
    expect(textToDraft('band Detail 20 0').skeleton).toBeNull();
  });

  // The full audit (2026-11-11, PL-25): a page line the AI wrote loosely still carries the draft.
  it('reads a page line written loosely rather than throwing the answer away', () => {
    const back = textToDraft('page Tabloid Portrait 1100 1700 50 50\nband Detail 20 0\nlabel title 0 0 100 20 Arial:9 l 0 5 "Hello"');
    expect(back.problems).toEqual([]);
    expect(back.skeleton).toMatchObject({ paper: 'Custom', landscape: false, width: 1100, height: 1700, margins: { top: 50, bottom: 50, left: 0, right: 0 } });
    expect(controlCount(back.skeleton)).toBe(1);
  });
});

describe('the report built from a corrected draft', () => {
  const back = textToDraft(draftToText(SKELETON, GIVEN));
  const design = skeletonToDesign(back.skeleton!, { given: back.given, title: 'invoice', version: '23.2' });

  it('carries the words, the fields, the group and the colours the draft gave', () => {
    expect(design.repx).toContain('Text="Northwind Traders"');
    expect(design.repx).toContain('ForeColor="#1F3864"');
    expect(design.repx).toContain('<GroupFields><Item1 Ref="');
    expect(design.repx).toMatch(/FieldName="Region"/);
    expect(design.repx).toContain('Expression="[Description]"');
    expect(design.repx).toContain('Text="Total Due"');
    expect(design.repx).toContain('BackColor="#F2F2F2"');
    expect(design.repx).toContain('Expression="sumSum([Amount])"');
    expect(design.fields).toEqual(['Region', 'Description', 'Amount']);
  });

  it('is written for the version asked for, titled, and a file the designer opens', () => {
    expect(design.repx).toContain('SerializerVersion="23.2.3.0"');
    expect(design.repx).toContain('DevExpress.XtraReports.v23.2, Version=23.2.3.0');
    expect(design.repx).toContain('DisplayName="Northwind Traders"');
    expect(checkRepx(design.repx).ok).toBe(true);
  });
});

describe('the rules the AI is given', () => {
  it('ask for the format alone and name every band and role it may write', () => {
    expect(CORRECTION_RULES).toMatch(/Answer with the draft format alone/);
    for (const word of ['TopMargin', 'ReportHeader', 'PageHeader', 'GroupHeader', 'Detail', 'GroupFooter', 'ReportFooter', 'PageFooter', 'BottomMargin', 'title', 'caption', 'value', 'total', 'pageInfo', 'decoration']) {
      expect(CORRECTION_RULES).toContain(word);
    }
    expect(CORRECTION_RULES).toMatch(/ONE record/);
  });
});
