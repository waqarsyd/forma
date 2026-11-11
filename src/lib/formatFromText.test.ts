/**
 * The format a value prints in, read off the page's own text (2026-11-11, the
 * full audit's CC-06). The printed strings are the Claude Code reference's:
 * "14 Oct 2026", "1,763.00", "USD 1,957.86" on the invoice, "1,240" on the
 * sales report, which DevExpress printed as "10/14/2026 12:00 AM", "1763.0"
 * and "1240" with no format.
 */
import { describe, expect, it } from 'vitest';
import { applyFormats, formatFor, isPlain, isRatio, saysRatio, valueOfText } from './formatFromText';
import { formatComposite } from './netFormat';

describe('formatFor', () => {
  it.each([
    ['14 Oct 2026', '{0:dd MMM yyyy}', '2026-10-14'],
    ['4 Oct 2026', '{0:d MMM yyyy}', '2026-10-04'],
    ['14 October 2026', '{0:dd MMMM yyyy}', '2026-10-14'],
    ['Oct 14, 2026', '{0:MMM d, yyyy}', '2026-10-14'],
    ['10/14/2026', '{0:MM/dd/yyyy}', '2026-10-14'],
    ['14/10/2026', '{0:dd/MM/yyyy}', '2026-10-14'],
    ['2026-10-14', '{0:yyyy-MM-dd}', '2026-10-14'],
    ['1,763.00', '{0:n2}', '1763.00'],
    ['USD 1,957.86', 'USD {0:n2}', '1957.86'],
    ['$1,240.50', '${0:n2}', '1240.50'],
    ['1,240', '{0:n0}', '1240'],
    ['28.7%', '{0:n1}%', '28.7'],
    ['149.86', '{0:n2}', '149.86'],
  ])('reads "%s" as %s', (text, format, value) => {
    const found = formatFor(text);
    expect(found).toMatchObject({ format, values: [value] });
    // The round trip that accepted it: the format prints the page's text back exactly.
    expect(formatComposite(found!.format, [value])).toBe(text);
  });

  it('keeps a format only when it prints every sample', () => {
    expect(formatFor(['1,763.00', '18.00', '45.50'])?.format).toBe('{0:n2}');
    expect(formatFor(['1,240', '610', '380'])?.format).toBe('{0:n0}');
    // Two decimals on one and one on the other: no single format prints both.
    expect(formatFor(['1,763.00', '18.5'])).toBeNull();
  });

  it('gives no format to text that is not a value, or a number no format reproduces', () => {
    for (const text of ['Page 2', 'Northwind Traders', '1240', '10248', '555-1234', '', 'Item 3 of 5']) expect(formatFor(text)).toBeNull();
    expect(formatFor([])).toBeNull();
  });

  // The review of CC-06 (2026-11-11): "SKU-1001" read as "SKU" and -1001, and
  // the format `SKU{0}` printed the real code as "SKUSKU-1001".
  it('gives no format to a code: a hyphen after a letter is not a minus, and a letter is not a prefix', () => {
    for (const text of ['SKU-1001', 'INV-001', 'ABC123', 'A-12', 'USD1,957.86', '12 kg', '(1,234.00)']) expect(formatFor(text)).toBeNull();
    expect(formatFor(['SKU-1001', 'SKU-1002'])).toBeNull();
    expect(valueOfText('SKU-1001')).toBe('SKU-1001');
    // A minus at the start, or after a currency symbol, is still a sign.
    expect(formatFor('-1,240.50')).toMatchObject({ format: '{0:n2}', values: ['-1240.50'] });
    expect(formatFor('$-12.50')).toMatchObject({ format: '${0:n2}', values: ['-12.50'] });
  });

  it('calls a format plain only for whole numbers printed with no separator', () => {
    expect(isPlain(formatFor('18')!)).toBe(true);
    // Decimals are kept: the page's "18.00" may be the data's 18.0, which printed "18.0".
    expect(isPlain(formatFor('18.00')!)).toBe(false);
    expect(isPlain(formatFor('86.8')!)).toBe(false);
    expect(isPlain(formatFor('1,240')!)).toBe(false);
    expect(isPlain(formatFor('14 Oct 2026')!)).toBe(false);
  });

  it('reads the value a sample holds, or the text itself', () => {
    expect(valueOfText('USD 1,957.86')).toBe('1957.86');
    expect(valueOfText('14 Oct 2026')).toBe('2026-10-14');
    expect(valueOfText(' Garden Tools ')).toBe('Garden Tools');
  });
});

describe('isRatio', () => {
  it('names a percentage, a rate, a margin or an average, by caption or by field', () => {
    for (const text of ['Margin %', 'Margin', 'Tax rate', 'Average price', 'MarginPct', 'TaxRate', 'Pct']) expect(isRatio(text)).toBe(true);
    for (const text of ['Revenue', 'Units', 'Separate', 'Corporate', 'Amount']) expect(isRatio(text)).toBe(false);
  });
});

describe('saysRatio', () => {
  it('is narrower: a bare margin or rate is often money, so only a percent, a ratio or an average says so', () => {
    for (const text of ['Margin %', 'MarginPct', 'Percent', 'Average price', 'Avg', 'Ratio', 'Pct']) expect(saysRatio(text)).toBe(true);
    for (const text of ['Margin', 'Gross Margin', 'GrossMargin', 'Rate', 'TaxRate', 'Revenue', 'Separate']) expect(saysRatio(text)).toBe(false);
  });
});

describe('applyFormats', () => {
  const report = [
    '<Item1 Ref="2" ControlType="XRLabel" Name="date" SizeF="100,20"><ExpressionBindings><Item1 Ref="3" EventName="BeforePrint" PropertyName="Text" Expression="[OrderDate]" /></ExpressionBindings></Item1>',
    '<Item2 Ref="4" ControlType="XRTableCell" Name="amount" Weight="1"><ExpressionBindings><Item1 Ref="5" EventName="BeforePrint" PropertyName="Text" Expression="[Amount]" /></ExpressionBindings></Item2>',
    '<Item3 Ref="6" ControlType="XRTableCell" Name="total" Weight="1"><Summary Ref="7" Running="Report" /><ExpressionBindings><Item1 Ref="8" EventName="BeforePrint" PropertyName="Text" Expression="sumSum([Amount])" /></ExpressionBindings></Item3>',
    '<Item4 Ref="9" ControlType="XRLabel" Name="kept" TextFormatString="{0:c2}"><ExpressionBindings><Item1 Ref="10" EventName="BeforePrint" PropertyName="Text" Expression="[Amount]" /></ExpressionBindings></Item4>',
    '<Item5 Ref="11" ControlType="XRLabel" Name="joined"><ExpressionBindings><Item1 Ref="12" EventName="BeforePrint" PropertyName="Text" Expression="\'Total: \' + [Amount]" /></ExpressionBindings></Item5>',
    '<Item6 Ref="13" ControlType="XRLabel" Name="caption" Text="Amount" />',
  ].join('');

  it("writes the page's format on each value and total that prints one field, and leaves the rest", () => {
    const out = applyFormats(report, { values: { OrderDate: '{0:dd MMM yyyy}', Amount: '{0:n2}' }, totals: { Amount: 'USD {0:n2}' } });
    expect(out).toMatchObject({ applied: true, count: 3 });
    expect(out.xml).toContain('Name="date" SizeF="100,20" TextFormatString="{0:dd MMM yyyy}">');
    expect(out.xml).toContain('Name="amount" Weight="1" TextFormatString="{0:n2}">');
    expect(out.xml).toContain('Name="total" Weight="1" TextFormatString="USD {0:n2}">');
    // A format of its own is kept, and an expression of more than one field is left alone.
    expect(out.xml).toContain('Name="kept" TextFormatString="{0:c2}">');
    expect(out.xml).toContain('Name="joined">');
    expect(out.xml).toContain('Name="caption" Text="Amount" />');
  });

  it("gives a total the values' format when the page shows none for it, and changes nothing with no format", () => {
    expect(applyFormats(report, { values: { Amount: '{0:n2}' } }).xml).toContain('Name="total" Weight="1" TextFormatString="{0:n2}">');
    expect(applyFormats(report, {})).toMatchObject({ applied: false, xml: report });
  });
});
