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
import {
  planDetailBinding,
  bindDetailRow,
  bindFooterTotals,
  bindingEnabled,
  readBoundFields,
  unescapeXml,
} from './repxBindingPlan';
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
    // Columns that infer no format, so this stays a test of the splice alone
    // rather than of the splice plus an inserted attribute.
    const before = banded(['Description', 'Code'], ['Widget', 'AB-1234']);
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
    expect(reason).toBe('bound 2 columns: Description, Amount; formatted 1');
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

/**
 * The same pass, driven by a mapping the user chose instead of names the report
 * guessed at. This is what the binding screen calls.
 */
describe('bindDetailRow with an explicit mapping', () => {
  const twoColumns = () => banded(['Description', 'Amount'], ['Widget', '1.00']);

  it('binds to the supplied names, not the derived ones', () => {
    const { xml, applied, fields } = bindDetailRow(twoColumns(), ['DESCR', 'NET_TOTAL']);
    expect(applied).toBe(true);
    expect(xml).toContain('Expression="[DESCR]"');
    expect(xml).toContain('Expression="[NET_TOTAL]"');
    expect(xml).not.toContain('[Description]');
    expect(fields.map((f) => f.name)).toEqual(['DESCR', 'NET_TOTAL']);
  });

  it('keeps the heading each supplied name was mapped onto', () => {
    const { fields } = bindDetailRow(twoColumns(), ['DESCR', 'NET_TOTAL']);
    expect(fields.map((f) => f.header)).toEqual(['Description', 'Amount']);
    expect(fields.every((f) => f.synthesised === false)).toBe(true);
  });

  it('accepts a name with a space, because DevExpress reads [Unit Price]', () => {
    const { xml } = bindDetailRow(twoColumns(), ['Item Description', 'Unit Price']);
    expect(xml).toContain('Expression="[Item Description]"');
    expect(xml).toContain('Expression="[Unit Price]"');
  });

  it('leaves a null column completely alone', () => {
    const { xml, fields } = bindDetailRow(twoColumns(), [null, 'NET_TOTAL']);
    expect(fields.map((f) => f.name)).toEqual(['NET_TOTAL']);
    expect(xml).toContain('Expression="[NET_TOTAL]"');
    // Not merely unbound: no format either. A column the user declined to map
    // is one they said not to touch.
    const descriptionCell = /<Item1 [^>]*Text="Widget"[\s\S]*?(?:\/>|<\/Item1>)/.exec(xml)![0];
    expect(descriptionCell).not.toContain('ExpressionBindings');
    expect(descriptionCell).not.toContain('TextFormatString');
  });

  it('treats an empty string the same as null', () => {
    const { fields } = bindDetailRow(twoColumns(), ['  ', 'NET_TOTAL']);
    expect(fields.map((f) => f.name)).toEqual(['NET_TOTAL']);
  });

  it('declines rather than rewriting anything when nothing was mapped', () => {
    const before = twoColumns();
    const { xml, applied, reason } = bindDetailRow(before, [null, null]);
    expect(applied).toBe(false);
    expect(xml).toBe(before);
    expect(reason).toBe('no columns were mapped to a field');
  });

  it('counts only what it bound in the reason', () => {
    const { reason } = bindDetailRow(twoColumns(), [null, 'NET_TOTAL']);
    expect(reason).toMatch(/^bound 1 columns: NET_TOTAL/);
  });

  it('still declines when the plan itself could not be proved', () => {
    const flat = report(band('DetailBand', cell('c', 'x')));
    const { applied, xml } = bindDetailRow(flat, ['ANY']);
    expect(applied).toBe(false);
    expect(xml).toBe(flat);
  });

  it('leaves the derived behaviour untouched when no mapping is passed', () => {
    // The regression that matters: the screen must not change what generation
    // already does behind VITE_FORMA_BIND.
    expect(bindDetailRow(twoColumns()).xml).toBe(bindDetailRow(twoColumns(), undefined).xml);
    expect(bindDetailRow(twoColumns()).xml).toContain('Expression="[Description]"');
  });
});

/** Headings, a detail row, and a footer row -- for the totals pass. */
const withFooter = (headings: string[], values: string[], footer: string[]) =>
  report(
    band('PageHeaderBand', headings.map((h, i) => cell(String(i + 1), h)).join('')) +
      band('DetailBand', values.map((v, i) => cell(String(i + 1), v)).join('')) +
      band('ReportFooterBand', footer.map((v, i) => cell(String(i + 1), v)).join(''))
  );

describe('bindDetailRow formatting', () => {
  it('adds a currency format to a money column', () => {
    const { xml, reason } = bindDetailRow(banded(['Description', 'Amount'], ['Widget', '1240.00']));
    expect(xml).toContain('TextFormatString="{0:c2}"');
    expect(reason).toBe('bound 2 columns: Description, Amount; formatted 1');
  });

  it('adds no format to a text or plain-integer column', () => {
    const { xml, reason } = bindDetailRow(banded(['Description', 'Qty'], ['Widget', '2']));
    expect(xml).not.toContain('TextFormatString');
    expect(reason).toBe('bound 2 columns: Description, Qty');
  });

  it('does not overwrite a format the model already chose', () => {
    const withFormat = banded(['Amount'], ['1240.00']).replace(
      'Text="1240.00"',
      'TextFormatString="{0:n2}" Text="1240.00"'
    );
    const { xml } = bindDetailRow(withFormat);
    expect(xml).toContain('TextFormatString="{0:n2}"');
    expect(xml).not.toContain('{0:c2}');
  });

  it('leaves the document complete after inserting an attribute', () => {
    const { xml } = bindDetailRow(banded(['Amount', 'Date'], ['1240.00', '2026-09-04']));
    expect(checkRepxComplete(xml).complete).toBe(true);
    expect(xml).toContain('TextFormatString="{0:c2}"');
    expect(xml).toContain('TextFormatString="{0:d}"');
  });
});

describe('bindFooterTotals', () => {
  it('totals a money column with the serializer summary syntax', () => {
    const { xml, applied, reason } = bindFooterTotals(
      withFooter(['Description', 'Amount'], ['Widget', '1240.00'], ['Total', '1240.00'])
    );
    expect(applied).toBe(true);
    expect(xml).toContain('Expression="sumSum([Amount])"');
    expect(reason).toBe('totalled 1 column(s): Amount');
  });

  it('leaves the label cell under a text column alone', () => {
    const { xml } = bindFooterTotals(
      withFooter(['Description', 'Amount'], ['Widget', '1240.00'], ['Total', '1240.00'])
    );
    expect(xml).toContain('Text="Total" Weight="1" />');
    expect(xml.match(/<ExpressionBindings>/g)).toHaveLength(1);
  });

  it('declines when there is no footer table', () => {
    const { applied, reason } = bindFooterTotals(banded(['Amount'], ['1240.00']));
    expect(applied).toBe(false);
    expect(reason).toBe('there is no ReportFooter table to total');
  });

  it('declines when the footer and detail rows have different widths', () => {
    const { applied, reason } = bindFooterTotals(
      withFooter(['Description', 'Amount'], ['Widget', '1240.00'], ['Total'])
    );
    expect(applied).toBe(false);
    expect(reason).toContain('the footer row has 1 cells and the detail row has 2');
  });

  it('does not bind a sum over a label sitting in a money column', () => {
    // A binding overrides Text at print time, so binding sumSum() onto a cell
    // reading "Total" turns the label into a number. Found by loading a real
    // chain output into DevExpress, not by reasoning.
    const { xml, applied } = bindFooterTotals(
      withFooter(['Unit Price', 'Amount'], ['12.00', '1240.00'], ['Total', '1240.00'])
    );
    expect(applied).toBe(true);
    expect(xml).toContain('Text="Total" Weight="1" />');
    expect(xml).not.toContain('sumSum([UnitPrice])');
    expect(xml).toContain('sumSum([Amount])');
  });

  it('declines when every money cell in the footer is a label', () => {
    const { applied, reason } = bindFooterTotals(
      withFooter(['Description', 'Amount'], ['Widget', '1240.00'], ['Total', 'see below'])
    );
    expect(applied).toBe(false);
    expect(reason).toBe('no footer cell sits under a money column');
  });

  it('declines when no column is money', () => {
    const { applied, reason } = bindFooterTotals(
      withFooter(['Description', 'Qty'], ['Widget', '2'], ['Total', '2'])
    );
    expect(applied).toBe(false);
    expect(reason).toBe('no footer cell sits under a money column');
  });

  it('is idempotent', () => {
    const src = withFooter(['Description', 'Amount'], ['Widget', '1240.00'], ['Total', '1240.00']);
    const once = bindFooterTotals(src);
    const twice = bindFooterTotals(once.xml);
    expect(twice.applied).toBe(false);
    expect(twice.xml).toBe(once.xml);
  });

  it('composes with the detail pass, leaving a complete document', () => {
    const src = withFooter(['Description', 'Amount'], ['Widget', '1240.00'], ['Total', '1240.00']);
    const detail = bindDetailRow(src);
    const totals = bindFooterTotals(detail.xml);
    expect(totals.applied).toBe(true);
    expect(checkRepxComplete(totals.xml).complete).toBe(true);
    // The detail cell binds the field; the footer cell sums it.
    expect(totals.xml).toContain('Expression="[Amount]"');
    expect(totals.xml).toContain('Expression="sumSum([Amount])"');
  });
});

describe('readBoundFields', () => {
  it('lists the fields a bound report references', () => {
    const { xml } = bindDetailRow(banded(['Description', 'Unit Price'], ['Widget', '12.00']));
    expect(readBoundFields(xml)).toEqual(['Description', 'UnitPrice']);
  });

  it('counts a field once even when the footer also totals it', () => {
    const src = withFooter(['Description', 'Amount'], ['Widget', '1240.00'], ['Total', '1240.00']);
    const bound = bindDetailRow(src);
    const totals = bindFooterTotals(bound.xml);
    // [Amount] in the detail row and sumSum([Amount]) in the footer are one field.
    expect(readBoundFields(totals.xml)).toEqual(['Description', 'Amount']);
  });

  it('returns nothing for an unbound report', () => {
    expect(readBoundFields(banded(['Description'], ['Widget']))).toEqual([]);
  });

  it('returns nothing for an empty or absent document', () => {
    for (const input of ['', null, undefined]) {
      expect(readBoundFields(input)).toEqual([]);
    }
  });

  it('is not fooled by a bracketed literal outside an expression', () => {
    // Only Expression attributes are read, so a label reading "[draft]" is not
    // a bound field.
    const xml = banded(['Description'], ['[draft]']);
    expect(readBoundFields(xml)).toEqual([]);
  });
});

describe('bindingEnabled', () => {
  it('is off unless the flag is exactly "true"', () => {
    // Off by default, and not turned on by a truthy-looking value -- the same
    // contract flatLayoutEnabled has, so the two flags cannot behave
    // differently for the same input.
    for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
      expect(bindingEnabled({ VITE_FORMA_BIND: value })).toBe(false);
    }
    expect(bindingEnabled({ VITE_FORMA_BIND: 'true' })).toBe(true);
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
