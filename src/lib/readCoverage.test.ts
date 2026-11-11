/**
 * What a report kept of what Forma read on the page (2026-11-10, the AI
 * accuracy programme, batch AD): the draft's captions and titles found in the
 * REPX, and when that is little enough to ask the AI once more.
 */
import { describe, expect, it } from 'vitest';
import { captionsOfDraft, comparable, editDistance, missedNote, readCoverage, worthAnotherTry } from './readCoverage';

const DRAFT = [
  'page Letter portrait 850 1100 75 75 75 75',
  'band ReportHeader 60 0',
  'label title 0 0 300 30 Arial:18b l 0 7 "INVOICE"',
  'band PageHeader 20 0',
  'table caption 0 0 700 20 Arial:9b l 4 0',
  'row caption 2 Arial:9b l 11 "Description" | caption 1 Arial:9b r 9 "Unit Price" | caption 1 Arial:9b r 6 "Amount"',
  'band Detail 20 0',
  'table value 0 0 700 20 Arial:9 l 0 0',
  'row value 2 Arial:9 l 0 [Description] | value 1 Arial:9 r 0 [UnitPrice] | value 1 Arial:9 r 0 [Amount]',
  'band ReportFooter 40 0',
  'label caption 450 5 100 20 Arial:9b r 0 9 "Total Due"',
  'label total 560 5 140 20 Arial:9b r 0 0 [Amount]',
].join('\n');

const repx = (bands: string) => `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Report1" ReportUnit="HundredthsOfAnInch" PageWidth="850" PageHeight="1100" Version="20.1">
  <Bands>${bands}</Bands>
</XtraReportsLayoutSerializer>`;

const label = (ref: number, text: string) => `<Item${ref} Ref="${ref + 100}" ControlType="XRLabel" Name="l${ref}" Text="${text}" LocationFloat="0,0" SizeF="200,20" />`;

const FULL = repx(`
    <Item1 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="60"><Controls>${label(1, 'Invoice')}</Controls></Item1>
    <Item2 Ref="3" ControlType="TopMarginBand" Name="TopMargin" HeightF="40"><Controls>
      <Item1 Ref="4" ControlType="XRTable" Name="head" LocationFloat="0,0" SizeF="700,20"><Rows><Item1 Ref="5" ControlType="XRTableRow" Name="r" Weight="1"><Cells>
        <Item1 Ref="6" ControlType="XRTableCell" Name="c1" Text="Description" Weight="2" />
        <Item2 Ref="7" ControlType="XRTableCell" Name="c2" Text="Unit price:" Weight="1" />
        <Item3 Ref="8" ControlType="XRTableCell" Name="c3" Text="Amount" Weight="1" />
      </Cells></Item1></Rows></Item1>
    </Controls></Item2>
    <Item3 Ref="9" ControlType="DetailBand" Name="Detail" HeightF="20"><Controls>${label(2, 'Total Due')}</Controls></Item3>`);

describe('the captions in a draft', () => {
  it('are its titles and captions, in labels and table cells, with their bands; values and totals are not', () => {
    expect(captionsOfDraft(DRAFT)).toEqual([
      { text: 'INVOICE', band: 'ReportHeader' },
      { text: 'Description', band: 'PageHeader' },
      { text: 'Unit Price', band: 'PageHeader' },
      { text: 'Amount', band: 'PageHeader' },
      { text: 'Total Due', band: 'ReportFooter' },
    ]);
  });

  it('are none in a draft with no page line', () => {
    expect(captionsOfDraft('label title 0 0 300 30 Arial:18b l 0 7 "INVOICE"')).toEqual([]);
  });
});

describe('what the report kept', () => {
  it('finds a caption whatever its case and punctuation, and counts the top margin as the page header', () => {
    const c = readCoverage(captionsOfDraft(DRAFT), FULL);
    expect(c).toEqual({ captions: 5, kept: 5, missing: [], sameBand: 4 });
  });

  it('names what is missing, in the page order', () => {
    const c = readCoverage(captionsOfDraft(DRAFT), repx(`<Item1 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="60"><Controls>${label(1, 'INVOICE')}${label(2, 'Amount')}</Controls></Item1>`));
    expect(c.kept).toBe(2);
    expect(c.missing).toEqual(['Description', 'Unit Price', 'Total Due']);
  });

  it('matches whole words, so a short caption is not found inside a longer one', () => {
    expect(comparable('  Unit-Price: ')).toBe('unit price');
    const c = readCoverage([{ text: 'Rate', band: 'Detail' }], repx(`<Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="20"><Controls>${label(1, 'Rates')}</Controls></Item1>`));
    expect(c.kept).toBe(0);
  });

  // The full audit (2026-11-11, PL-09): the AI correcting OCR is not leaving the caption out.
  it('forgives a misread character in eight, so a correction of OCR still counts as kept', () => {
    const read = [
      { text: 'lnvoice Number', band: 'ReportHeader' as const },
      { text: 'Tota1 Due', band: 'ReportFooter' as const },
      { text: 'Customer', band: 'ReportHeader' as const },
      { text: 'Balance', band: 'ReportFooter' as const },
    ];
    const c = readCoverage(read, repx(`<Item1 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="60"><Controls>${label(1, 'Invoice Number:')}${label(2, 'Customer')}</Controls></Item1>
      <Item2 Ref="3" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="40"><Controls>${label(3, 'Total Due')}${label(4, 'Amount paid')}</Controls></Item2>`));
    expect(c.kept).toBe(3);
    expect(c.missing).toEqual(['Balance']);
    expect(worthAnotherTry(c)).toBe(false);
    expect(editDistance('lnvoice number', 'invoice number')).toBe(1);
    expect(editDistance('kitten', 'sitting', 1)).toBe(2);
  });
});

describe('asking once more', () => {
  const of = (captions: number, missing: number) => ({ captions, kept: captions - missing, missing: Array.from({ length: missing }, (_, i) => `t${i}`), sameBand: 0 });

  it('only for a real loss: four captions or more, two or more missing, a quarter or more', () => {
    expect(worthAnotherTry(of(16, 6))).toBe(true);
    expect(worthAnotherTry(of(16, 1))).toBe(false);
    expect(worthAnotherTry(of(16, 3))).toBe(false);
    expect(worthAnotherTry(of(3, 2))).toBe(false);
    expect(worthAnotherTry(of(4, 2))).toBe(true);
  });

  it('names at most twenty texts, each cut at eighty characters', () => {
    const note = missedNote({ captions: 30, kept: 5, missing: [...Array.from({ length: 24 }, (_, i) => `Heading ${i}`), 'x'.repeat(120)], sameBand: 0 });
    expect(note).toContain('"Heading 0"');
    expect(note).toContain('"Heading 19"');
    expect(note).not.toContain('"Heading 20"');
    expect(note).toContain('and 5 more');
    expect(missedNote({ captions: 4, kept: 1, missing: ['y'.repeat(120)], sameBand: 0 })).toContain(`"${'y'.repeat(79)}…"`);
  });
});
