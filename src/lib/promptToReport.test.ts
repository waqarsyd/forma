import { describe, it, expect } from 'vitest';
import {
  buildDescriptionBrief,
  describeDataSource,
  describedRequest,
  fixInstruction,
  isDescribable,
  normalizeDescription,
  requestDataSource,
  shouldRetryForErrors,
  withAnswers,
  MAX_FIX_ATTEMPTS,
} from './promptToReport';

describe('normalizeDescription and isDescribable', () => {
  it('collapses whitespace and refuses a description too short to design from', () => {
    expect(normalizeDescription('  an\n\n invoice   with totals ')).toBe('an invoice with totals');
    expect(isDescribable({ description: 'invoice' })).toBe(false);
    expect(isDescribable({ description: 'an invoice with totals' })).toBe(true);
    expect(isDescribable({ description: '' })).toBe(false);
  });
});

describe('requestDataSource and describeDataSource', () => {
  it('reads a pasted schema into typed fields, one per line', () => {
    const source = requestDataSource({ description: 'x', dataSchema: 'CREATE TABLE Orders (OrderId INT, Customer NVARCHAR(50), Total DECIMAL(10,2), OrderDate DATETIME)' });
    expect(source).not.toBeNull();
    expect(source!.fields.map((f) => f.name)).toEqual(['OrderId', 'Customer', 'Total', 'OrderDate']);
    expect(describeDataSource(source!)).toContain('- Total (number)');
    expect(describeDataSource(source!)).toContain('- OrderDate (date)');
  });

  it('is null for no schema and for text with no fields in it', () => {
    expect(requestDataSource({ description: 'x' })).toBeNull();
    expect(requestDataSource({ description: 'x', dataSchema: '   ' })).toBeNull();
  });
});

describe('buildDescriptionBrief', () => {
  it('states there is no image, quotes the description and the title', () => {
    const brief = buildDescriptionBrief({ description: '  A  customer\nlist ', title: 'Customers' });
    expect(brief).toContain('There is no source document');
    expect(brief).toContain('DESCRIPTION: "A customer list"');
    expect(brief).toContain('TITLE: "Customers"');
    expect(brief).toContain('NO DATA SOURCE was given');
  });

  it('lists the data source fields and forbids invented ones', () => {
    const brief = buildDescriptionBrief({ description: 'A customer list with balances', dataSchema: 'CustomerId, Company, Balance' });
    expect(brief).toContain('DATA SOURCE STRUCTURE (list)');
    expect(brief).toContain('- Company (string)');
    expect(brief).toContain('ONLY field names');
    expect(brief).toContain('never invent a field');
    expect(brief).not.toContain('NO DATA SOURCE');
  });

  it('carries the answers to follow-up questions', () => {
    const request = withAnswers({ description: 'A sales report' }, [
      { id: 'title', question: 'What should the report title be?', answer: 'Q3 Sales' },
      { id: 'blank', question: 'Group by?', answer: '   ' },
    ]);
    expect(request.answers).toHaveLength(1);
    const brief = buildDescriptionBrief(request);
    expect(brief).toContain('Q: What should the report title be? A: Q3 Sales');
    expect(brief).not.toContain('Group by?');
  });
});

describe('the repair decision', () => {
  it('retries only on errors, and only up to the limit', () => {
    expect(shouldRetryForErrors({ errors: 1 }, 1)).toBe(true);
    expect(shouldRetryForErrors({ errors: 1 }, MAX_FIX_ATTEMPTS)).toBe(false);
    expect(shouldRetryForErrors({ errors: 0 }, 1)).toBe(false);
  });

  it('tells the model exactly which errors to fix and nothing else', () => {
    const text = fixInstruction({
      findings: [
        { severity: 'error', code: 'duplicate-ref', message: 'Ref values are reused (5x2).' },
        { severity: 'warning', code: 'a11y-text-size', message: 'small text' },
      ],
    });
    expect(text).toContain('[duplicate-ref] Ref values are reused (5x2).');
    expect(text).not.toContain('a11y-text-size');
    expect(text).toContain('fix ONLY these');
  });
});

/*
 * A description typed into the chat box (2026-11-01), which took over the
 * Describe dialog and its separate data-source field: a schema in a fenced
 * block or a CREATE TABLE is the data source, the rest the description.
 */
describe('describedRequest', () => {
  it('takes a fenced block that reads as fields as the data source', () => {
    const r = describedRequest('A customer list grouped by country.\n```json\n{"Name":"Ann","Country":"UK","Balance":12.5}\n```\nwith totals');
    expect(r.description).toBe('A customer list grouped by country. with totals');
    expect(requestDataSource(r)!.fields.map((f) => f.name)).toEqual(['Name', 'Country', 'Balance']);
  });

  it('takes a CREATE TABLE statement as the data source', () => {
    const r = describedRequest('Orders by month, CREATE TABLE Orders (Id int, OrderDate date, Total decimal(10,2)); sorted by date');
    expect(r.dataSchema).toMatch(/^CREATE TABLE Orders/);
    expect(requestDataSource(r)!.fields.map((f) => f.name)).toEqual(['Id', 'OrderDate', 'Total']);
    expect(r.description).toBe('Orders by month, sorted by date');
  });

  it('leaves everything in the description when nothing reads as fields', () => {
    expect(describedRequest('An  invoice\nwith line items')).toEqual({ description: 'An invoice with line items' });
    // A fence holding prose is not a schema.
    expect(describedRequest('Like this: ```a nice header```').dataSchema).toBeUndefined();
  });
});