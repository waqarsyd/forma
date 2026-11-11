/**
 * Which field a report's column prints, by heading and by value, with how
 * sure (2026-11-09, the SQL Server programme, item 23). The fields and values
 * are made up.
 */
import { describe, expect, it } from 'vitest';
import { matchColumns, renameField, scoreMatch, wordsOf, type FieldEvidence } from './fieldMatch';

const fields: FieldEvidence[] = [
  { name: 'CustomerID', type: 'number', samples: ['1', '2'] },
  { name: 'CompanyName', type: 'string', samples: ['Example Traders', 'Demo Supplies'] },
  { name: 'ContactName', type: 'string', samples: ['Ana Example'] },
  { name: 'OrderDate', type: 'date', samples: ['2026-01-05'] },
  { name: 'CurrentBalance', type: 'number', samples: ['1240.5'] },
  { name: 'Qty', type: 'number' },
];

describe('the words of a name', () => {
  it('split camel case and underscores, drop the usual prefixes, and read short forms as the long ones', () => {
    expect(wordsOf('usp_SalesByRegion')).toEqual(['sale', 'region']);
    expect(wordsOf('Order Qty.')).toEqual(['order', 'quantity']);
    expect(wordsOf('CustomerNo')).toEqual(['customer', 'number']);
  });
});

describe('a column against a field', () => {
  it('is sure of a heading that is its name, likely of one that holds it, and less of shared words', () => {
    expect(scoreMatch({ heading: 'Customer ID' }, fields[0])).toEqual({ score: 1, why: 'the heading is its name' });
    expect(scoreMatch({ heading: 'Company' }, fields[1])).toEqual({ score: 0.75, why: 'the heading holds its name' });
    expect(scoreMatch({ heading: 'Balance' }, fields[4]).score).toBe(0.75);
    expect(scoreMatch({ heading: 'Quantity' }, fields[5])).toEqual({ score: 0.7, why: 'the same words' });
  });

  it('counts a value found in the samples, and against a type that cannot hold the value shown', () => {
    expect(scoreMatch({ heading: 'Cust.', sample: 'Example Traders' }, fields[1])).toEqual({ score: 0.55, why: 'its value is in the samples' });
    expect(scoreMatch({ heading: 'Balance', sample: '1,240.50' }, fields[4]).score).toBe(1);
    expect(scoreMatch({ heading: 'Order date', sample: 'Example Traders' }, fields[3])).toEqual({ score: 0.65, why: 'the heading is its name, "Example Traders" is not a date' });
    expect(scoreMatch({ heading: 'Customer ID', sample: 'ALFKI' }, fields[0]).score).toBe(0.65);
  });
});

describe('every column', () => {
  it('gets the likeliest field, each used once, with how sure and the next likeliest', () => {
    const matched = matchColumns(
      [{ heading: 'Customer ID' }, { heading: 'Company', sample: 'Demo Supplies' }, { heading: 'Contact' }, { heading: 'Balance', sample: '1,240.50' }, { heading: 'Notes' }],
      fields,
    );
    expect(matched.map((m) => [m.field, m.level])).toEqual([
      ['CustomerID', 'high'],
      ['CompanyName', 'high'],
      ['ContactName', 'medium'],
      ['CurrentBalance', 'high'],
      [null, null],
    ]);
    expect(matched[4].why).toBe('nothing matched its heading or its value');
  });

  it('suggests nothing below the floor, and offers what came close as alternatives', () => {
    const [m] = matchColumns([{ heading: 'Name' }], fields);
    expect(m.field).toBe('CompanyName');
    expect(m.alternatives).toEqual(['ContactName']);
    const [none] = matchColumns([{ heading: 'Region' }], fields);
    expect(none).toEqual({ field: null, score: 0, level: null, why: 'nothing matched its heading or its value', alternatives: [] });
  });
});

describe('renaming a field', () => {
  it('rewrites every expression and group field naming it, and leaves the fallback text alone', () => {
    const xml = '<a Text="Company" Expression="[Company]" /><b Expression="sumSum([company]) + [CompanyX]" /><GroupFields><Item1 FieldName="Company" /></GroupFields>';
    expect(renameField(xml, 'Company', 'CompanyName')).toEqual({
      xml: '<a Text="Company" Expression="[CompanyName]" /><b Expression="sumSum([CompanyName]) + [CompanyX]" /><GroupFields><Item1 FieldName="CompanyName" /></GroupFields>',
      count: 3,
    });
  });

  it('renames only the places it is told to, by their offset in the report', () => {
    const xml = '<a Expression="[City]" /><b FieldName="City" /><c Expression="[City]" />';
    const second = xml.indexOf('<c');
    expect(renameField(xml, 'City', 'Town$&', (at) => at < second)).toEqual({
      xml: '<a Expression="[Town$&]" /><b FieldName="Town$&" /><c Expression="[City]" />',
      count: 2,
    });
  });
});
