/**
 * The fixture that matters is `documentSequential`: the shape a real generation
 * produced on 2026-09-04, with Item names running straight through the document
 * and locked to the Ref beside them. DevExpress loaded that file as 0 tables and
 * 0 cells out of 3 and 44 declared, silently.
 *
 * As elsewhere in this suite the loops sit inside a single case, so the grep and
 * the run agree.
 */
import { describe, it, expect } from 'vitest';
import { normalizeItemNames } from './repxItems';
import { checkRepxComplete } from './repxTruncation';

const wrap = (bands: string) =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ' +
  'ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" PageWidth="850" PageHeight="1100">' +
  `<Bands>${bands}</Bands></XtraReportsLayoutSerializer>`;

/** Correct: every collection restarts at Item1. */
const correct = wrap(
  '<Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" />' +
    '<Item2 Ref="2" ControlType="DetailBand" Name="Detail"><Controls>' +
    '<Item1 Ref="3" ControlType="XRTable" Name="table1"><Rows>' +
    '<Item1 Ref="4" ControlType="XRTableRow" Name="row1"><Cells>' +
    '<Item1 Ref="5" ControlType="XRTableCell" Name="c1" Text="A" />' +
    '<Item2 Ref="6" ControlType="XRTableCell" Name="c2" Text="B" />' +
    '</Cells></Item1></Rows></Item1></Controls></Item2>' +
    '<Item3 Ref="7" ControlType="BottomMarginBand" Name="BottomMargin" />'
);

/** The defect: names continue across the document instead of restarting. */
const documentSequential = wrap(
  '<Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" />' +
    '<Item2 Ref="2" ControlType="DetailBand" Name="Detail"><Controls>' +
    '<Item3 Ref="3" ControlType="XRTable" Name="table1"><Rows>' +
    '<Item4 Ref="4" ControlType="XRTableRow" Name="row1"><Cells>' +
    '<Item5 Ref="5" ControlType="XRTableCell" Name="c1" Text="A" />' +
    '<Item6 Ref="6" ControlType="XRTableCell" Name="c2" Text="B" />' +
    '</Cells></Item4></Rows></Item3></Controls></Item2>' +
    '<Item7 Ref="7" ControlType="BottomMarginBand" Name="BottomMargin" />'
);

describe('normalizeItemNames', () => {
  it('leaves a correct document byte-identical', () => {
    const r = normalizeItemNames(correct);
    expect(r.applied).toBe(false);
    expect(r.xml).toBe(correct);
    expect(r.renamed).toBe(0);
    expect(r.reason).toContain('already match their position');
  });

  it('repairs the document-sequential names a real generation produced', () => {
    const { xml, applied } = normalizeItemNames(documentSequential);
    expect(applied).toBe(true);
    expect(xml).toBe(correct);
  });

  it('restarts numbering in every collection independently', () => {
    const { xml } = normalizeItemNames(documentSequential);
    expect(xml).toContain('<Rows><Item1 Ref="4"');
    expect(xml).toContain('<Cells><Item1 Ref="5"');
    expect(xml).toContain('<Item2 Ref="6" ControlType="XRTableCell"');
  });

  it('renames closing tags to match their opening tag', () => {
    const { xml } = normalizeItemNames(documentSequential);
    // Item4 became Item1, so its closing tag must too, or the XML is malformed.
    expect(xml).not.toContain('</Item4>');
    expect(xml).not.toContain('</Item3>');
    expect(checkRepxComplete(xml).complete).toBe(true);
  });

  it('changes nothing except the tag names', () => {
    const { xml } = normalizeItemNames(documentSequential);
    const strip = (s: string) => s.replace(/Item\d+/g, 'Item');
    expect(strip(xml)).toBe(strip(documentSequential));
  });

  it('is idempotent', () => {
    const once = normalizeItemNames(documentSequential);
    const twice = normalizeItemNames(once.xml);
    expect(twice.applied).toBe(false);
    expect(twice.xml).toBe(once.xml);
  });

  it('counts elements renamed, and reports tags separately', () => {
    const { renamed, reason } = normalizeItemNames(documentSequential);
    // Five elements move: Item3->1, Item4->1, Item5->1, Item6->2, Item7->3.
    // Two of them (the table and the row) also have a closing tag, so seven
    // edits. Mixing the two counts is how this once read "renamed 105 of 88".
    expect(renamed).toBe(5);
    expect(reason).toContain('renamed 5 of 7 Item element(s)');
    expect(reason).toContain('(7 tags, counting closing tags)');
  });

  it('handles a gap or a repeat in the numbering, not only an offset', () => {
    const messy = wrap(
      '<Item9 Ref="1" ControlType="TopMarginBand" Name="TopMargin" />' +
        '<Item9 Ref="2" ControlType="DetailBand" Name="Detail" />' +
        '<Item2 Ref="3" ControlType="BottomMarginBand" Name="BottomMargin" />'
    );
    const { xml } = normalizeItemNames(messy);
    expect(xml).toContain('<Item1 Ref="1"');
    expect(xml).toContain('<Item2 Ref="2"');
    expect(xml).toContain('<Item3 Ref="3"');
  });

  it('is not fooled by an Item name inside a comment', () => {
    const withComment = documentSequential.replace('<Bands>', '<!-- <Item99 ControlType="X" /> --><Bands>');
    const { xml } = normalizeItemNames(withComment);
    expect(xml).toContain('<!-- <Item99 ControlType="X" /> -->');
    expect(xml).toContain('<Rows><Item1 Ref="4"');
  });

  it('ignores elements that are not Items', () => {
    // Bands, Controls, Rows, Cells and Symbology are containers, not members.
    const { xml } = normalizeItemNames(documentSequential);
    for (const container of ['<Bands>', '<Controls>', '<Rows>', '<Cells>']) {
      expect(xml).toContain(container);
    }
  });

  it('declines a document with no Item elements', () => {
    const bare = '<?xml version="1.0"?><XtraReportsLayoutSerializer Ref="0"><Bands /></XtraReportsLayoutSerializer>';
    const r = normalizeItemNames(bare);
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('the document has no Item elements');
  });

  it('declines an empty document rather than throwing', () => {
    for (const input of ['', '   ', null, undefined]) {
      const r = normalizeItemNames(input);
      expect(r.applied).toBe(false);
      expect(r.reason).toBe('there is no REPX to renumber');
    }
  });
});
