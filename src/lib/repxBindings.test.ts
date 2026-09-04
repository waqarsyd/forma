/**
 * The headings here are the ones real documents actually carry -- "Amount ($)",
 * "Qty.", "Sub-total", a blank cell above a column of numbers -- rather than
 * tidy identifiers that would pass any implementation.
 *
 * Note the loops below sit *inside* a single test case on purpose, rather than
 * generating one case per fixture. Five other files in the suite generate cases
 * from a loop, and CLAUDE.md carries a paragraph explaining why a grep of this
 * suite disagrees with a run of it; there was no reason to make that six. For
 * the same reason this comment does not spell out the vitest call by name --
 * prose naming it would inflate the grep in the other direction.
 */
import { describe, it, expect } from 'vitest';
import { toFieldName, deriveFieldNames, fieldExpression } from './repxBindings';

describe('toFieldName', () => {
  it('passes a clean single word straight through', () => {
    expect(toFieldName('Description')).toBe('Description');
  });

  it('joins words without a separator', () => {
    expect(toFieldName('Unit Price')).toBe('UnitPrice');
  });

  it('capitalises a lower-case heading', () => {
    expect(toFieldName('unit price')).toBe('UnitPrice');
  });

  it('leaves an acronym intact without needing a list of acronyms', () => {
    expect(toFieldName('VAT Amount')).toBe('VATAmount');
  });

  it('gives a shouty heading a shouty name, rather than inventing case', () => {
    // Documented decision, not an oversight: guessing "UnitPrice" here makes
    // two similar documents produce differently-cased names for the same
    // column. The heading said UNIT PRICE.
    expect(toFieldName('UNIT PRICE')).toBe('UNITPRICE');
  });

  it('drops a currency qualifier without a special case for it', () => {
    expect(toFieldName('Amount ($)')).toBe('Amount');
  });

  it('drops trailing punctuation and symbols', () => {
    expect(toFieldName('Item #')).toBe('Item');
    expect(toFieldName('Qty.')).toBe('Qty');
  });

  it('treats a hyphen as a word break', () => {
    expect(toFieldName('Sub-total')).toBe('SubTotal');
  });

  it('keeps digits that sit inside the heading', () => {
    expect(toFieldName('Line 2 Total')).toBe('Line2Total');
  });

  it('prefixes a leading digit rather than dropping the token', () => {
    // "1st Quarter" is about the 1; StQuarter would lose the point.
    expect(toFieldName('1st Quarter')).toBe('_1stQuarter');
  });

  it('returns empty for anything with no letters or digits in it', () => {
    for (const header of ['', '   ', '###', '($)', '-', '\n\t']) {
      expect(toFieldName(header)).toBe('');
    }
  });

  it('returns empty for null and undefined rather than throwing', () => {
    expect(toFieldName(null)).toBe('');
    expect(toFieldName(undefined)).toBe('');
  });

  it('caps a sentence-length heading at 64 characters', () => {
    const name = toFieldName('Description of the goods and services supplied including all taxes and duties');
    expect(name.length).toBe(64);
    expect(name.startsWith('DescriptionOfThe')).toBe(true);
  });

  it('never starts a capped name with a lower-case letter', () => {
    // The cap is applied after joining, so it cannot sever a token's first
    // letter from its tail and leave the name starting mid-word.
    expect(toFieldName('a'.repeat(80))).toBe('A' + 'a'.repeat(63));
  });
});

describe('deriveFieldNames', () => {
  it('returns one entry per column, in order', () => {
    const fields = deriveFieldNames(['Description', 'Qty', 'Amount']);
    expect(fields.map((f) => f.name)).toEqual(['Description', 'Qty', 'Amount']);
  });

  it('keeps the original heading verbatim alongside the name', () => {
    const [field] = deriveFieldNames(['Amount ($)']);
    expect(field.header).toBe('Amount ($)');
    expect(field.name).toBe('Amount');
    expect(field.synthesised).toBe(false);
  });

  it('suffixes a duplicate rather than emitting the same field twice', () => {
    const fields = deriveFieldNames(['Amount', 'Amount', 'Amount']);
    expect(fields.map((f) => f.name)).toEqual(['Amount', 'Amount2', 'Amount3']);
  });

  it('suffixes headings that differ only by punctuation', () => {
    // Both sanitise to Amount, which is exactly how a duplicate arises in a
    // real document: one column headed "Amount" and one headed "Amount ($)".
    expect(deriveFieldNames(['Amount', 'Amount ($)']).map((f) => f.name)).toEqual(['Amount', 'Amount2']);
  });

  it('synthesises a positional name for a blank heading, and says so', () => {
    const fields = deriveFieldNames(['Description', '   ', 'Amount']);
    expect(fields[1].name).toBe('Column2');
    expect(fields[1].synthesised).toBe(true);
    expect(fields[0].synthesised).toBe(false);
  });

  it('numbers a synthesised name by column position, not by how many are blank', () => {
    const fields = deriveFieldNames(['', '', '']);
    expect(fields.map((f) => f.name)).toEqual(['Column1', 'Column2', 'Column3']);
  });

  it('does not let a synthesised name collide with a literal one', () => {
    // A blank second heading wants Column2; the third column is literally
    // headed "Column 2". Both cannot be Column2.
    const fields = deriveFieldNames(['Description', '', 'Column 2']);
    expect(fields.map((f) => f.name)).toEqual(['Description', 'Column2', 'Column22']);
    expect(new Set(fields.map((f) => f.name)).size).toBe(3);
  });

  it('keeps a suffixed name within the length cap', () => {
    const long = 'A'.repeat(80);
    const fields = deriveFieldNames([long, long]);
    expect(fields[0].name.length).toBe(64);
    expect(fields[1].name.length).toBe(64);
    expect(fields[1].name.endsWith('2')).toBe(true);
    expect(fields[0].name).not.toBe(fields[1].name);
  });

  it('returns nothing for no columns', () => {
    expect(deriveFieldNames([])).toEqual([]);
  });

  it('never emits a name that would need XML escaping', () => {
    // The invariant the whole module exists to guarantee: a derived name goes
    // straight into Expression="[...]" in the REPX, so it must not carry the
    // characters the prompt spends a paragraph escaping.
    const hostile = [
      'Tom & Jerry',
      '<script>',
      'Price "each"',
      "Don't",
      'a > b',
      'Amount ($)',
      '</Item1>',
      'x=\"1\"',
      '  ',
      '1st',
      'Ünïcodé Ñame',
    ];
    for (const field of deriveFieldNames(hostile)) {
      expect(field.name).toMatch(/^[A-Za-z0-9_]+$/);
    }
  });
});

describe('fieldExpression', () => {
  it('wraps a name in the bracket syntax', () => {
    expect(fieldExpression('UnitPrice')).toBe('[UnitPrice]');
  });

  it('composes with the derived name to give a usable expression', () => {
    const [field] = deriveFieldNames(['Unit Price']);
    expect(fieldExpression(field.name)).toBe('[UnitPrice]');
  });
});
