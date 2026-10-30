/**
 * .NET composite formatting. The expectations marked "printed" are strings
 * DevExpress 20.1 drew through `RepxProbe render` on 2026-10-30 in en-US;
 * the rest are .NET's documented en-US patterns.
 */
import { describe, it, expect } from 'vitest';
import { formatComposite, formatDate, toRoman } from './netFormat';

// Friday, 30 October 2026, 14:05:09 local time.
const friday = new Date(2026, 9, 30, 14, 5, 9);

describe('formatDate', () => {
  it('prints the long date DevExpress drew for a page-info DateTime', () => {
    expect(formatDate(friday, 'D')).toBe('Friday, October 30, 2026'); // printed
  });

  it('prints the custom patterns the parity cases used', () => {
    expect(formatDate(friday, 'yyyy-MM-dd')).toBe('2026-10-30'); // printed
    expect(formatDate(new Date(2026, 5, 18), 'dd MMM yyyy')).toBe('18 Jun 2026'); // printed
  });

  it('handles every token width', () => {
    const early = new Date(2006, 0, 5, 9, 7, 3);
    expect(formatDate(early, 'd/M/yy')).toBe('5/1/06');
    expect(formatDate(early, 'y')).toBe('January 2006'); // a lone y is the standard year-month
    expect(formatDate(early, 'ddd dd MMMM yyyy')).toBe('Thu 05 January 2006');
    expect(formatDate(early, 'HH:mm:ss')).toBe('09:07:03');
    expect(formatDate(friday, 'h:mm tt')).toBe('2:05 PM');
    expect(formatDate(new Date(2026, 0, 1, 0, 30), 'hh:mm t')).toBe('12:30 A');
  });

  it('copies quoted and escaped text through, and unknown letters as they are', () => {
    expect(formatDate(friday, "'Week of' MMMM d")).toBe('Week of October 30');
    expect(formatDate(friday, 'yyyy\\y')).toBe('2026y');
    expect(formatDate(friday, 'yyyy.MM.dd Q')).toBe('2026.10.30 Q');
  });

  it('expands the en-US standard patterns', () => {
    expect(formatDate(friday, 'd')).toBe('10/30/2026');
    expect(formatDate(friday, 'g')).toBe('10/30/2026 2:05 PM');
    expect(formatDate(friday, 'M')).toBe('October 30');
    expect(formatDate(friday, '')).toBe('10/30/2026 2:05:09 PM');
  });
});

describe('formatComposite', () => {
  it('fills arguments by index, with and without a format', () => {
    expect(formatComposite('Page {0} of {1}', [1, 4])).toBe('Page 1 of 4'); // printed
    expect(formatComposite('{0:} of {1}', [1, 2])).toBe('1 of 2'); // printed
    expect(formatComposite('{0:yyyy-MM-dd}', [friday])).toBe('2026-10-30'); // printed
    expect(formatComposite('{1}-{0}', ['a', 'b'])).toBe('b-a');
  });

  it('keeps doubled braces as literals and pads by alignment', () => {
    expect(formatComposite('{{{0}}}', [7])).toBe('{7}');
    expect(formatComposite('[{0,4}]', [7])).toBe('[   7]');
    expect(formatComposite('[{0,-4}]', [7])).toBe('[7   ]');
  });

  it('never throws on a missing argument, a stray brace or nothing at all', () => {
    expect(formatComposite('{2}', [1])).toBe('');
    expect(formatComposite('total {0', [1])).toBe('total {0');
    expect(formatComposite('{x}', [1])).toBe('{x}');
    expect(formatComposite('', [])).toBe('');
  });

  it('prints a value it has no rule for as plain text, rather than guessing', () => {
    // Money and decimals wait for parity row 12 to print them.
    expect(formatComposite('{0:c2}', [1001.07])).toBe('1001.07');
    expect(formatComposite('{0}', [null])).toBe('');
  });
});

describe('toRoman', () => {
  it('writes lower-case Roman numerals, as RomLowNumber printed them', () => {
    expect([1, 2, 3, 4].map(toRoman)).toEqual(['i', 'ii', 'iii', 'iv']); // printed: i, ii, iii, iv
    expect([9, 14, 40, 90, 400, 2026].map(toRoman)).toEqual(['ix', 'xiv', 'xl', 'xc', 'cd', 'mmxxvi']);
  });

  it('leaves a number with no Roman form as digits', () => {
    expect(toRoman(0)).toBe('0');
    expect(toRoman(-3)).toBe('-3');
  });
});
