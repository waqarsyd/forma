/**
 * .NET composite formatting. The expectations marked "printed" are strings
 * DevExpress 20.1 drew through `RepxProbe render` on 2026-10-30 in en-US;
 * the rest are .NET's documented en-US patterns.
 */
import { describe, it, expect } from 'vitest';
import { formatComposite, formatDate, toRoman } from './netFormat';
import { NetDecimal } from './netDecimal';

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

  it('formats money and nothing at all', () => {
    expect(formatComposite('{0:c2}', [1001.07])).toBe('$1,001.07'); // printed in case c05
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

/*
 * Every number format and value DevExpress 20.1 printed in case s15 of
 * docs/proposals/devexpress-parity.md (`RepxProbe render`, 2026-10-30), written
 * out literally. Decimal and double columns printed identically, so both run
 * against the same expectations.
 */
describe('numbers, as DevExpress printed them', () => {
  const VALUES = ["1234.5","-1234.5","0","0.005","2.345","2.355","1234567.891","-0.5","0.125","1.5","2.5","-2.5"];
  const INTS = ["42","-7","0","255","12345","3","100000","-1","7","8","9","10"];
  const PRINTED: Record<string, string[]> = {
    "{0}": ["1234.5","-1234.5","0","0.005","2.345","2.355","1234567.891","-0.5","0.125","1.5","2.5","-2.5"],
    "{0:c}": ["$1,234.50","($1,234.50)","$0.00","$0.01","$2.35","$2.36","$1,234,567.89","($0.50)","$0.13","$1.50","$2.50","($2.50)"],
    "{0:c0}": ["$1,235","($1,235)","$0","$0","$2","$2","$1,234,568","($1)","$0","$2","$3","($3)"],
    "{0:c2}": ["$1,234.50","($1,234.50)","$0.00","$0.01","$2.35","$2.36","$1,234,567.89","($0.50)","$0.13","$1.50","$2.50","($2.50)"],
    "{0:n}": ["1,234.50","-1,234.50","0.00","0.01","2.35","2.36","1,234,567.89","-0.50","0.13","1.50","2.50","-2.50"],
    "{0:n0}": ["1,235","-1,235","0","0","2","2","1,234,568","-1","0","2","3","-3"],
    "{0:n2}": ["1,234.50","-1,234.50","0.00","0.01","2.35","2.36","1,234,567.89","-0.50","0.13","1.50","2.50","-2.50"],
    "{0:f2}": ["1234.50","-1234.50","0.00","0.01","2.35","2.36","1234567.89","-0.50","0.13","1.50","2.50","-2.50"],
    "{0:f0}": ["1235","-1235","0","0","2","2","1234568","-1","0","2","3","-3"],
    "{0:p}": ["123,450.00%","-123,450.00%","0.00%","0.50%","234.50%","235.50%","123,456,789.10%","-50.00%","12.50%","150.00%","250.00%","-250.00%"],
    "{0:p1}": ["123,450.0%","-123,450.0%","0.0%","0.5%","234.5%","235.5%","123,456,789.1%","-50.0%","12.5%","150.0%","250.0%","-250.0%"],
    "{0:e2}": ["1.23e+003","-1.23e+003","0.00e+000","5.00e-003","2.35e+000","2.36e+000","1.23e+006","-5.00e-001","1.25e-001","1.50e+000","2.50e+000","-2.50e+000"],
    "{0:#,##0.00}": ["1,234.50","-1,234.50","0.00","0.01","2.35","2.36","1,234,567.89","-0.50","0.13","1.50","2.50","-2.50"],
    "{0:0.00}": ["1234.50","-1234.50","0.00","0.01","2.35","2.36","1234567.89","-0.50","0.13","1.50","2.50","-2.50"],
    "{0:#,##0.00;(#,##0.00);Zero}": ["1,234.50","(1,234.50)","Zero","0.01","2.35","2.36","1,234,567.89","(0.50)","0.13","1.50","2.50","(2.50)"],
    "{0:0.##}": ["1234.5","-1234.5","0","0.01","2.35","2.36","1234567.89","-0.5","0.13","1.5","2.5","-2.5"],
    "{0:g}": ["1234.5","-1234.5","0","0.005","2.345","2.355","1234567.891","-0.5","0.125","1.5","2.5","-2.5"],
    "Total: {0:c2}": ["Total: $1,234.50","Total: ($1,234.50)","Total: $0.00","Total: $0.01","Total: $2.35","Total: $2.36","Total: $1,234,567.89","Total: ($0.50)","Total: $0.13","Total: $1.50","Total: $2.50","Total: ($2.50)"],
    "{0:N3}": ["1,234.500","-1,234.500","0.000","0.005","2.345","2.355","1,234,567.891","-0.500","0.125","1.500","2.500","-2.500"],
    "{0:C1}": ["$1,234.5","($1,234.5)","$0.0","$0.0","$2.3","$2.4","$1,234,567.9","($0.5)","$0.1","$1.5","$2.5","($2.5)"],
  };
  const PRINTED_INT: Record<string, string[]> = {
    "{0}": ["42","-7","0","255","12345","3","100000","-1","7","8","9","10"],
    "{0:d5}": ["00042","-00007","00000","00255","12345","00003","100000","-00001","00007","00008","00009","00010"],
    "{0:x}": ["2a","fffffff9","0","ff","3039","3","186a0","ffffffff","7","8","9","a"],
    "{0:n0}": ["42","-7","0","255","12,345","3","100,000","-1","7","8","9","10"],
    "{0:00000}": ["00042","-00007","00000","00255","12345","00003","100000","-00001","00007","00008","00009","00010"],
    "{0:c}": ["$42.00","($7.00)","$0.00","$255.00","$12,345.00","$3.00","$100,000.00","($1.00)","$7.00","$8.00","$9.00","$10.00"],
  };

  it('prints every decimal the way DevExpress did', () => {
    for (const [format, expected] of Object.entries(PRINTED)) {
      expect(VALUES.map((v) => formatComposite(format, [NetDecimal.parse(v)]))).toEqual(expected);
    }
  });

  it('prints every double the same way, through its 15 significant digits', () => {
    for (const [format, expected] of Object.entries(PRINTED)) {
      if (format === '{0}' || format === '{0:g}') continue; // a double prints its own shortest digits
      expect(VALUES.map((v) => formatComposite(format, [Number(v)]))).toEqual(expected);
    }
  });

  it('prints every integer the way DevExpress did', () => {
    for (const [format, expected] of Object.entries(PRINTED_INT)) {
      expect(INTS.map((v) => formatComposite(format, [BigInt(v)]))).toEqual(expected);
    }
  });

  it('reads a numeric string from test data as the number a format expects', () => {
    expect(formatComposite('{0:c2}', ['-1234.5'])).toBe('($1,234.50)');
    expect(formatComposite('{0:n0}', ['12345'])).toBe('12,345');
    expect(formatComposite('{0:MM/dd/yyyy}', ['2026-03-01T14:07:09'])).toBe('03/01/2026');
    // With no format a string prints as it was written, as a decimal keeps its scale.
    expect(formatComposite('{0}', ['1240.00'])).toBe('1240.00');
  });
});
