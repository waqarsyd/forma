/**
 * The fixtures are the banded shape `reportBands.ts` asks the model for --
 * headings in a PageHeader table, one row in Detail -- because that is the only
 * shape a binding pass will ever see. The declines get as much attention as the
 * success, since every one of them exists to stop a confident wrong answer
 * reaching a file the user trusts.
 *
 * As in repxBindings.test.ts the loops sit inside a single case, so this file's
 * grep and its run agree.
 */
import { describe, it, expect } from 'vitest';
import { planDetailBinding, bindDetailRow, unescapeXml } from './repxBindingPlan';
import { checkRepxComplete } from './repxTruncation';

const cell = (name: string, text: string, weight = 1) =>
  `<Item${name} Ref="9" ControlType="XRTableCell" Name="cell${name}" Text="${text}" Weight="${weight}" />`;

const table = (band: string, cells: string) =>
  `<Item1 Ref="5" ControlType="XRTable" Name="table${band}" LocationFloat="0,0" SizeF="750,20">` +
  `<Rows><Item1 Ref="6" ControlType="XRTableRow" Name="row${band}" Weight="1">` +
  `<Cells>${cells}</Cells></Item1></Rows></Item1>`;

const band = (type: string, cells: string) =>
  `<Item1 Ref="2" ControlType="${type}" Name="${type}" HeightF="20">` +
  `<Controls>${table(type, cells)}</Controls></Item1>`;

const report = (bands: string) =>
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ' +
  'ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" ' +
  'ReportUnit="HundredthsOfAnInch" PageWidth="850" PageHeight="1100" Version="20.1">' +
  `<Bands>${bands}</Bands></XtraReportsLayoutSerializer>`;

/** Headings in PageHeader, one data row in Detail -- the shape banding produces. */
const banded = (headings: string[], values: string[]) =>
  report(
    band('PageHeaderBand', headings.map((h, i) => cell(String(i + 1), h)).join('')) +
      band('DetailBand', values.map((v, i) => cell(String(i + 1), v)).join(''))
  );

describe('planDetailBinding', () => {
  it('derives a field per column from the header row', () => {
    const { plan } = planDetailBinding(banded(['Description', 'Unit Price'], ['Widget', '12.00']));
    expect(plan?.fields.map((f) => f.name)).toEqual(['Description', 'UnitPrice']);
  });

  it('reports the columns it found in the reason', () => {
    const { reason } = planDetailBinding(banded(['Description', 'Amount'], ['Widget', '1.00']));
    expect(reason).toBe('2 columns: Description, Amount');
  });

  it('keeps headings, fields and cells aligned by column', () => {
    const { plan } = planDetailBinding(banded(['Qty', 'Amount ($)'], ['2', '24.00']));
    expect(plan?.headings).toEqual(['Qty', 'Amount ($)']);
    expect(plan?.fields.map((f) => f.name)).toEqual(['Qty', 'Amount']);
    expect(plan?.cells.map((c) => c.text)).toEqual(['2', '24.00']);
  });

  it('returns spans that select exactly the cell elements', () => {
    const xml = banded(['Description'], ['Widget']);
    const { plan } = planDetailBinding(xml);
    const span = xml.slice(plan!.cells[0].start, plan!.cells[0].end);
    expect(span.startsWith('<Item1 ')).toBe(true);
    expect(span.endsWith('/>')).toBe(true);
    expect(span).toContain('Text="Widget"');
    // The detail cell, not the identically-shaped header cell above it.
    expect(span).not.toContain('Description');
  });

  it('reads the detail row, not the header row, for cell text', () => {
    const { plan } = planDetailBinding(banded(['Description', 'Amount'], ['Widget', '1240.00']));
    expect(plan?.cells.map((c) => c.text)).toEqual(['Widget', '1240.00']);
  });

  it('unescapes a heading before deriving its name', () => {
    // Left escaped, "R&amp;D" derives RAmpD -- the entity's letters survive
    // sanitisation as an ordinary token.
    const { plan } = planDetailBinding(banded(['R&amp;D', 'Amount'], ['x', '1']));
    expect(plan?.headings[0]).toBe('R&D');
    expect(plan?.fields[0].name).toBe('RD');
  });

  it('declines an empty or absent document', () => {
    for (const input of ['', '   ', null, undefined]) {
      const { plan, reason } = planDetailBinding(input);
      expect(plan).toBeNull();
      expect(reason).toBe('there is no REPX to bind');
    }
  });

  it('declines a report with no DetailBand', () => {
    const { plan, reason } = planDetailBinding(report(band('PageHeaderBand', cell('1', 'Description'))));
    expect(plan).toBeNull();
    expect(reason).toBe('the report has no DetailBand');
  });

  it('declines a DetailBand with no table', () => {
    const xml = report(
      band('PageHeaderBand', cell('1', 'Description')) +
        '<Item2 Ref="7" ControlType="DetailBand" Name="Detail" HeightF="20"><Controls>' +
        '<Item1 Ref="8" ControlType="XRLabel" Name="label1" Text="Widget" /></Controls></Item2>'
    );
    const { plan, reason } = planDetailBinding(xml);
    expect(plan).toBeNull();
    expect(reason).toBe('the DetailBand has no table to bind');
  });

  it('declines when there is no PageHeader table to name columns from', () => {
    // The flat shape: one page-sized DetailBand and nothing above it.
    const { plan, reason } = planDetailBinding(report(band('DetailBand', cell('1', 'Widget'))));
    expect(plan).toBeNull();
    expect(reason).toBe('there is no PageHeader table to read column headings from');
  });

  it('declines when the two rows disagree about the column count', () => {
    // What a merged or spanning header cell looks like from here.
    const { plan, reason } = planDetailBinding(banded(['Description', 'Amount'], ['Widget', '1', '2']));
    expect(plan).toBeNull();
    expect(reason).toContain('the header row has 2 columns and the detail row has 3');
    expect(reason).toContain('cannot be proved');
  });

  it('declines a detail row that is already bound, under either element name', () => {
    for (const element of ['ExpressionBindings', 'DataBindings']) {
      const bound =
        `<Item1 Ref="9" ControlType="XRTableCell" Name="cell1" Weight="1">` +
        `<${element}><Item1 Ref="10" PropertyName="Text" Expression="[Description]" /></${element}>` +
        `</Item1>`;
      const xml = report(
        band('PageHeaderBand', cell('1', 'Description')) + band('DetailBand', bound)
      );
      const { plan, reason } = planDetailBinding(xml);
      expect(plan).toBeNull();
      expect(reason).toBe('1 of 1 detail cells are already bound');
    }
  });

  it('declines when every heading is blank', () => {
    const { plan, reason } = planDetailBinding(banded(['', '  '], ['Widget', '1.00']));
    expect(plan).toBeNull();
    expect(reason).toBe('every column heading is blank, so this region is probably not a table');
  });

  it('proceeds when only some headings are blank, flagging the synthesised ones', () => {
    const { plan } = planDetailBinding(banded(['Description', ''], ['Widget', '1.00']));
    expect(plan?.fields.map((f) => f.name)).toEqual(['Description', 'Column2']);
    expect(plan?.fields.map((f) => f.synthesised)).toEqual([false, true]);
  });

  it('is unaffected by comments and a declaration sitting in the document', () => {
    const xml = banded(['Description'], ['Widget']).replace(
      '<Bands>',
      '<!-- a comment with <Item1 ControlType="XRTableCell" /> inside it --><Bands>'
    );
    const { plan } = planDetailBinding(xml);
    expect(plan?.fields.map((f) => f.name)).toEqual(['Description']);
    expect(plan?.cells).toHaveLength(1);
  });

  it('survives the single-line form the model actually returns', () => {
    const xml = banded(['Unit Price'], ['12.00']).replace(/\n\s*/g, '');
    expect(planDetailBinding(xml).plan?.fields[0].name).toBe('UnitPrice');
  });
});

describe('bindDetailRow', () => {
  it('writes the shape the 20.1 serializer writes', () => {
    // Verbatim from a real file produced by SaveLayoutToXml against the
    // installed DevExpress 20.1, minus the Ref the loader ignores.
    const { xml } = bindDetailRow(banded(['Description'], ['Widget']));
    expect(xml).toContain(
      '<ExpressionBindings>' +
        '<Item1 EventName="BeforePrint" PropertyName="Text" Expression="[Description]" />' +
        '</ExpressionBindings>'
    );
  });

  it('binds every column to its own field', () => {
    const { xml, applied, fields } = bindDetailRow(
      banded(['Description', 'Unit Price'], ['Widget', '12.00'])
    );
    expect(applied).toBe(true);
    expect(fields.map((f) => f.name)).toEqual(['Description', 'UnitPrice']);
    expect(xml).toContain('Expression="[Description]"');
    expect(xml).toContain('Expression="[UnitPrice]"');
  });

  it('keeps Text on the bound cell, as the designer does', () => {
    const { xml } = bindDetailRow(banded(['Description'], ['Widget']));
    expect(xml).toContain('Text="Widget"');
  });

  it('converts a self-closing cell into one with a body', () => {
    const { xml } = bindDetailRow(banded(['Description'], ['Widget']));
    // The cell element must no longer be self-closing, and must close properly.
    expect(xml).not.toContain('Text="Widget" Weight="1" />');
    expect(xml).toContain('</ExpressionBindings></Item1>');
  });

  it('leaves the header row alone', () => {
    const { xml } = bindDetailRow(banded(['Description'], ['Widget']));
    expect(xml).toContain('Text="Description" Weight="1" />');
    // One binding, in the detail row only.
    expect(xml.match(/<ExpressionBindings>/g)).toHaveLength(1);
  });

  it('leaves everything outside the cells byte-for-byte alone', () => {
    const before = banded(['Description', 'Amount'], ['Widget', '1240.00']);
    const { xml } = bindDetailRow(before);
    // Reverse exactly the splice -- a binding block followed immediately by
    // the cell's closing tag becomes ` />` again -- and the result must be the
    // input, byte for byte. Anchoring on both ends matters: a regex that just
    // strips the bindings also eats `</Cells></Item1>` and proves nothing.
    const unwound = xml.replace(
      /><ExpressionBindings>.*?<\/ExpressionBindings><\/Item\d+>/g,
      ' />'
    );
    expect(unwound).toBe(before);
  });

  it('produces a document that still parses as complete', () => {
    const { xml } = bindDetailRow(banded(['Description', 'Amount'], ['Widget', '1.00']));
    const check = checkRepxComplete(xml);
    expect(check.complete).toBe(true);
    expect(check.reason).toBe('');
  });

  it('is idempotent: the second run declines rather than double-binding', () => {
    const once = bindDetailRow(banded(['Description'], ['Widget']));
    const twice = bindDetailRow(once.xml);
    expect(twice.applied).toBe(false);
    expect(twice.reason).toBe('1 of 1 detail cells are already bound');
    expect(twice.xml).toBe(once.xml);
  });

  it('returns the input untouched, with the reason, when it declines', () => {
    const flat = report(band('DetailBand', cell('1', 'Widget')));
    const result = bindDetailRow(flat);
    expect(result.applied).toBe(false);
    expect(result.xml).toBe(flat);
    expect(result.fields).toEqual([]);
    expect(result.reason).toBe('there is no PageHeader table to read column headings from');
  });

  it('names the columns it bound in the reason', () => {
    const { reason } = bindDetailRow(banded(['Description', 'Amount'], ['Widget', '1.00']));
    expect(reason).toBe('bound 2 columns: Description, Amount');
  });

  it('emits no Ref, which is the variant proven to round-trip', () => {
    const { xml } = bindDetailRow(banded(['Description'], ['Widget']));
    const binding = /<Item1 EventName[^>]*\/>/.exec(xml);
    expect(binding).not.toBeNull();
    expect(binding![0]).not.toContain('Ref=');
  });

  it('never needs escaping, because the field name cannot need it', () => {
    // The heading is hostile; the derived name is not, by construction.
    const { xml, fields } = bindDetailRow(banded(['Tom & Jerry <b>'], ['x']));
    expect(fields[0].name).toBe('TomJerryB');
    expect(xml).toContain('Expression="[TomJerryB]"');
  });
});

describe('unescapeXml', () => {
  it('decodes the five predefined entities', () => {
    expect(unescapeXml('a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;')).toBe(
      'a & b < c > d "e" \'f\''
    );
  });

  it('decodes numeric and hex escapes', () => {
    expect(unescapeXml('Don&#39;t')).toBe("Don't");
    expect(unescapeXml('Don&#x27;t')).toBe("Don't");
  });

  it('does not double-decode an escaped entity', () => {
    // &amp;lt; is the literal text "&lt;", not a less-than sign.
    expect(unescapeXml('&amp;lt;')).toBe('&lt;');
  });

  it('leaves text with no entities alone', () => {
    expect(unescapeXml('Unit Price')).toBe('Unit Price');
  });
});
