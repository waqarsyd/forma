/**
 * The four paste formats, and the mapping they feed.
 *
 * Format detection is the part with a real failure mode: a JSON array and a CSV
 * file both contain commas, a CREATE TABLE contains commas *and* newlines, and
 * a plain list accepts anything at all. So each format is tested for what it
 * reads AND for not being claimed by the format before it in the chain.
 */
import { describe, it, expect } from 'vitest';
import { parseDataSource, suggestMapping, cleanFieldName, type DataField } from './dataSource';

describe('reading a JSON sample', () => {
  it('reads fields, types and a real sample value from an array of rows', () => {
    const source = parseDataSource(`[
      {"ItemCode": "W-100", "Description": "Widget", "Qty": 4, "UnitPrice": 12.5, "Shipped": "2026-09-01", "Taxable": true}
    ]`);
    expect(source.kind).toBe('json');
    expect(source.rowCount).toBe(1);
    expect(source.fields).toEqual([
      { name: 'ItemCode', type: 'string', sample: 'W-100' },
      { name: 'Description', type: 'string', sample: 'Widget' },
      { name: 'Qty', type: 'number', sample: '4' },
      { name: 'UnitPrice', type: 'number', sample: '12.5' },
      { name: 'Shipped', type: 'date', sample: '2026-09-01' },
      { name: 'Taxable', type: 'boolean', sample: 'true' },
    ]);
  });

  it('unions keys across rows, because an API omits nulls', () => {
    // The trap: reading keys off the first row alone loses Discount entirely,
    // and the first row is the one most likely to be missing an optional field.
    const source = parseDataSource('[{"A": 1}, {"A": 2, "Discount": 5}]');
    expect(source.fields.map((f) => f.name)).toEqual(['A', 'Discount']);
    expect(source.fields[1].sample).toBe('5');
  });

  it('takes the sample from the first row that actually has a value', () => {
    const source = parseDataSource('[{"A": null}, {"A": ""}, {"A": "real"}]');
    expect(source.fields[0]).toEqual({ name: 'A', type: 'string', sample: 'real' });
  });

  it('accepts a single object as one row', () => {
    const source = parseDataSource('{"Total": 1250}');
    expect(source.rowCount).toBe(1);
    expect(source.fields[0]).toMatchObject({ name: 'Total', type: 'number' });
  });

  it('explains bad JSON instead of falling through to another format', () => {
    const source = parseDataSource('[{"A": 1},]');
    expect(source.kind).toBe('json');
    expect(source.fields).toEqual([]);
    expect(source.problems.join(' ')).toMatch(/did not parse/);
  });

  it('says so when the JSON has no objects to read names from', () => {
    const source = parseDataSource('[1, 2, 3]');
    expect(source.fields).toEqual([]);
    expect(source.problems.join(' ')).toMatch(/no objects/);
  });
});

describe('reading CSV', () => {
  it('reads the header row as fields and types from the first data row', () => {
    const source = parseDataSource('Item,Qty,Price\nWidget,4,12.50\nBolt,2,0.75');
    expect(source.kind).toBe('csv');
    expect(source.rowCount).toBe(2);
    expect(source.fields).toEqual([
      { name: 'Item', type: 'string', sample: 'Widget' },
      { name: 'Qty', type: 'number', sample: '4' },
      { name: 'Price', type: 'number', sample: '12.50' },
    ]);
  });

  it('prefers tabs, so a spreadsheet paste keeps commas inside cells', () => {
    const source = parseDataSource('Name\tNotes\nWidget\tsmall, blue');
    expect(source.fields.map((f) => f.name)).toEqual(['Name', 'Notes']);
    expect(source.fields[1].sample).toBe('small, blue');
  });

  it('honours quoted cells containing the delimiter', () => {
    const source = parseDataSource('Name,Notes\n"Widget","small, blue"');
    expect(source.fields[1].sample).toBe('small, blue');
  });

  it('reports a ragged row rather than inventing a column for it', () => {
    const source = parseDataSource('A,B\n1,2,3');
    expect(source.fields).toHaveLength(2);
    expect(source.problems.join(' ')).toMatch(/do not have 2 columns/);
  });
});

describe('reading a CREATE TABLE', () => {
  const ddl = `CREATE TABLE dbo.InvoiceLine (
      LineId       INT IDENTITY(1,1) NOT NULL,
      Description  NVARCHAR(200) NULL,
      Qty          DECIMAL(10,2) NOT NULL,
      ShippedOn    DATETIME2 NULL,
      IsTaxable    BIT NOT NULL,
      CONSTRAINT PK_InvoiceLine PRIMARY KEY (LineId)
    );`;

  it('reads columns and maps SQL types onto the four the report cares about', () => {
    const source = parseDataSource(ddl);
    expect(source.kind).toBe('sql');
    expect(source.fields).toEqual([
      { name: 'LineId', type: 'number', sample: '' },
      { name: 'Description', type: 'string', sample: '' },
      { name: 'Qty', type: 'number', sample: '' },
      { name: 'ShippedOn', type: 'date', sample: '' },
      { name: 'IsTaxable', type: 'boolean', sample: '' },
    ]);
  });

  it('is not split apart by the comma inside DECIMAL(10,2)', () => {
    // Depth-0 commas only. A naive split makes "2) NOT NULL" a column.
    expect(parseDataSource(ddl).fields.map((f) => f.name)).not.toContain('2');
  });

  it('takes the name as the first token, not everything before the last one', () => {
    // The bug this caught: a type with no parentheses to halt the match --
    // DATETIME2, BIT, INT -- let a `[\w ]+` name swallow the type and call the
    // trailing NULL/NOT the type instead. Only visible on unparenthesised
    // types, which is why the parenthesised ones above looked like proof.
    const plain = parseDataSource('CREATE TABLE T (ShippedOn DATETIME2 NULL, IsTaxable BIT NOT NULL)');
    expect(plain.fields).toEqual([
      { name: 'ShippedOn', type: 'date', sample: '' },
      { name: 'IsTaxable', type: 'boolean', sample: '' },
    ]);
  });

  it('allows a quoted column name to contain spaces', () => {
    const quoted = parseDataSource('CREATE TABLE T ([Unit Price] DECIMAL(10,2) NOT NULL)');
    expect(quoted.fields).toEqual([{ name: 'Unit Price', type: 'number', sample: '' }]);
  });

  it('skips constraints and keys rather than parsing them', () => {
    const names = parseDataSource(ddl).fields.map((f) => f.name);
    expect(names).not.toContain('CONSTRAINT');
    expect(names).not.toContain('PK_InvoiceLine');
  });

  it('wins over CSV detection even though it is commas and newlines', () => {
    expect(parseDataSource(ddl).kind).toBe('sql');
  });
});

describe('reading a plain list', () => {
  it('accepts names one per line', () => {
    const source = parseDataSource('ItemCode\nDescription\nAmount');
    expect(source.kind).toBe('list');
    expect(source.fields.map((f) => f.name)).toEqual(['ItemCode', 'Description', 'Amount']);
    expect(source.rowCount).toBe(0);
  });

  it('accepts names on one comma-separated line', () => {
    expect(parseDataSource('A, B, C').fields.map((f) => f.name)).toEqual(['A', 'B', 'C']);
  });

  it('is the fallback, not a detected format', () => {
    // A single line with no comma cannot be CSV, so it lands here.
    expect(parseDataSource('JustOneName').kind).toBe('list');
  });
});

describe('nothing to read', () => {
  it('returns an empty source rather than a problem', () => {
    for (const input of ['', '   ', null, undefined]) {
      const source = parseDataSource(input);
      expect(source.kind).toBe('none');
      expect(source.fields).toEqual([]);
      expect(source.problems).toEqual([]);
    }
  });
});

describe('field names that would break the file', () => {
  it('strips what would end an expression or an attribute early', () => {
    expect(cleanFieldName('Unit "Price"')).toBe('Unit Price');
    expect(cleanFieldName('Total [net]')).toBe('Total net');
    expect(cleanFieldName('A & B')).toBe('A  B'.replace('  ', ' '));
  });

  it('keeps spaces, because DevExpress reads [Unit Price]', () => {
    expect(cleanFieldName('  Unit   Price  ')).toBe('Unit Price');
  });

  it('drops a column whose name is nothing but punctuation', () => {
    expect(parseDataSource('[{"[]": 1, "Real": 2}]').fields.map((f) => f.name)).toEqual(['Real']);
  });
});

describe('suggesting the mapping', () => {
  const fields = (...names: string[]): DataField[] =>
    names.map((name) => ({ name, type: 'string', sample: '' }));

  it('matches ignoring case, spaces and underscores', () => {
    expect(suggestMapping(['Unit Price'], fields('unit_price'))).toEqual(['unit_price']);
  });

  it('settles every exact match before any loose one', () => {
    // "Price" contains-matches UnitPrice, and would steal it if the columns were
    // resolved left to right in one pass. The exact pairing must win.
    expect(suggestMapping(['Price', 'Unit Price'], fields('UnitPrice', 'Price')))
      .toEqual(['Price', 'UnitPrice']);
  });

  it('falls back to containment when nothing matches exactly', () => {
    expect(suggestMapping(['Description'], fields('ItemDescription'))).toEqual(['ItemDescription']);
  });

  it('uses a field at most once', () => {
    const result = suggestMapping(['Amount', 'Amount'], fields('Amount'));
    expect(result).toEqual(['Amount', null]);
  });

  it('leaves a hole rather than guessing when nothing fits', () => {
    expect(suggestMapping(['Qty', 'Colour'], fields('Qty'))).toEqual(['Qty', null]);
  });

  it('returns one entry per heading, including for blank headings', () => {
    const result = suggestMapping(['', 'Qty'], fields('Qty'));
    expect(result).toHaveLength(2);
    expect(result[0]).toBeNull();
  });
});
