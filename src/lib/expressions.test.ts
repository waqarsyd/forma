import { describe, it, expect } from 'vitest';
import { EXPRESSION_REFERENCE, checkExpression, fieldsIn } from './expressions';

describe('fieldsIn', () => {
  it('lists each field once and leaves parameters out', () => {
    expect(fieldsIn('Iif([Qty] > 10, [Qty] * [Price], [Price]) + [Parameters.Fee]')).toEqual(['Qty', 'Price']);
    expect(fieldsIn('sumSum([Amount])')).toEqual(['Amount']);
    expect(fieldsIn("'no fields here'")).toEqual([]);
  });
});

describe('checkExpression', () => {
  it('passes a well-formed expression over known fields', () => {
    const check = checkExpression("FormatString('{0:c2}', [Qty] * [Price])", ['Qty', 'Price']);
    expect(check).toEqual({ ok: true, problems: [], unknownFields: [] });
  });

  it('names a field the data does not have', () => {
    const check = checkExpression('[Qty] * [UnitCost]', ['Qty', 'Price']);
    expect(check.ok).toBe(false);
    expect(check.unknownFields).toEqual(['UnitCost']);
    expect(check.problems[0]).toContain('[UnitCost] is not a field');
  });

  it('skips the field check when no schema is known', () => {
    expect(checkExpression('[Anything]').ok).toBe(true);
  });

  it('catches the three unbalanced forms and code that is not an expression', () => {
    expect(checkExpression('Iif([A] > 1, [A]', ['A']).problems).toContain('Parentheses do not balance.');
    expect(checkExpression('[A * 2', ['A']).problems).toContain('Square brackets do not balance.');
    expect(checkExpression("Concat([A], 'x)", ['A']).problems).toContain('A string literal is not closed.');
    expect(checkExpression('SELECT Amount FROM Orders', []).problems[0]).toContain('SQL or code');
    expect(checkExpression('   ').ok).toBe(false);
  });
});

describe('the reference', () => {
  it('states the forms the project measured and forbids the forms it is not', () => {
    for (const form of ['[FieldName]', '[Parameters.Name]', 'sumSum([Amount])', 'Iif(', 'FormatString(', 'No semicolons']) {
      expect(EXPRESSION_REFERENCE).toContain(form);
    }
  });
});

describe('aggregates in a column binding', () => {
  it('flags one, because a Detail column has no running scope and prints it blank', () => {
    const check = checkExpression('sumRunningSum([Amount])', ['Amount']);
    expect(check.ok).toBe(false);
    expect(check.problems[0]).toContain('prints blank');
  });

  it('leaves per-record arithmetic and a field named like an aggregate alone', () => {
    expect(checkExpression('[Qty] * [Price]', ['Qty', 'Price']).ok).toBe(true);
    expect(checkExpression('[sumTotal] + 1', ['sumTotal']).ok).toBe(true);
  });
});