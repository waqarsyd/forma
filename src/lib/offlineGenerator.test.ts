// @vitest-environment jsdom
/**
 * Reports designed by Forma's own model, with no AI service (milestone 2 of
 * docs/proposals/own-model.md), over the model the app ships. Each design is
 * read back the way the app reads any report: it must parse, pass the audit
 * with no error, and print its bound values and totals over records. jsdom
 * because `checkRepx` parses with DOMParser; this must stay line 1.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { captionOf, fieldName, generateOffline, guessType, readRequest, titleFrom } from './offlineGenerator';
import { checkRepx } from './repx';
import { auditRepx } from './repxAudit';
import { paginate, parseReportStructure } from './reportPreview';
import type { FormaModel } from './formaModel';

const model = JSON.parse(readFileSync('assets/model/formaModel.json', 'utf8')) as FormaModel;

/** The texts printed on every page, over `rows`. */
function printed(repx: string, rows: Record<string, string>[]): string[] {
  const structure = parseReportStructure(repx);
  const report = paginate(structure, rows.length, { rows });
  return report.pages.flatMap((p) => p.bands.flatMap((b) => b.controls.flatMap((c) => [c.text ?? '', ...(c.cellTexts ?? []).flat()])));
}

describe('readRequest', () => {
  it('reads the category, the columns, the grouping, the totals and the page', () => {
    expect(readRequest('A payroll report with columns employee, department, net pay and tax, grouped by department, with totals, landscape')).toMatchObject({
      category: 'payroll',
      columns: ['employee', 'department', 'net pay', 'tax'],
      groupBy: 'department',
      totals: true,
      landscape: true,
    });
    expect(readRequest('Build a report listing our orders, grouped by region, with a total per region')).toMatchObject({ category: 'document', columns: [], groupBy: 'region', totals: true });
    expect(readRequest('Create a customer list grouped by country, with each balance and a total per country')).toMatchObject({ columns: ['customer', 'country', 'balance'], groupBy: 'country' });
    expect(readRequest('Price labels for the shop').label).toBe(true);
  });

  it('names fields and captions as a report binds and prints them', () => {
    expect(fieldName('net pay')).toBe('NetPay');
    expect(fieldName('unit price (incl. tax)')).toBe('UnitPriceInclTax');
    expect(fieldName('2nd address')).toBe('F2ndAddress');
    expect(captionOf('NetPay')).toBe('Net Pay');
    expect(guessType('InvoiceDate')).toBe('date');
    expect(guessType('NetPay')).toBe('number');
    expect(guessType('CustomerName')).toBe('text');
    expect(titleFrom('Create a stock register grouped by warehouse with totals')).toBe('Stock Register');
    expect(titleFrom('A payroll report with columns employee and tax')).toBe('Payroll Report');
    expect(titleFrom('Build a report listing our orders, grouped by region')).toBe('Orders Report');
  });
});

describe('generateOffline', () => {
  it('designs a grouped payroll report that opens, passes the audit and prints its records and totals', () => {
    const design = generateOffline(model, { description: 'A payroll report with columns employee, department, net pay and tax, grouped by department, with totals' });
    expect(checkRepx(design.repx).ok).toBe(true);
    expect(auditRepx(design.repx).findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(design.groupBy).toBe('Department');
    expect(design.totals).toEqual(['NetPay', 'Tax']);
    expect(design.fields.map((f) => f.name)).toEqual(['Employee', 'Department', 'NetPay', 'Tax']);
    const rows = [
      { Employee: 'Ann', Department: 'Sales', NetPay: '100', Tax: '10' },
      { Employee: 'Bob', Department: 'Sales', NetPay: '200', Tax: '20' },
      { Employee: 'Cy', Department: 'Stores', NetPay: '50', Tax: '5' },
    ];
    const text = printed(design.repx, rows);
    expect(text).toEqual(expect.arrayContaining(['Ann', 'Bob', 'Cy', 'Sales', 'Stores', 'Net Pay', '300.00', '50.00', '350.00', '35.00', 'Grand total']));
  });

  // The full audit (2026-11-11, PL-07): the Spec says what the report is, never what made it.
  it('writes its Spec in plain words', () => {
    for (const description of ['A payroll report grouped by department, with totals', 'an invoice', 'Price labels for the shop']) {
      const { markdown, title } = generateOffline(model, { description });
      expect(markdown.startsWith(`# ${title}\n`)).toBe(true);
      expect(markdown).toMatch(/^Laid out as an? [a-z ]+ on \w+/m);
      expect(markdown).not.toMatch(/OCR|box reader|own model|vision model|learned from|no model|AI service|AI provider/i);
    }
  });

  it('takes a pasted schema over the words, and a title when given one', () => {
    const design = generateOffline(model, {
      description: 'an invoice',
      title: 'Tax Invoice',
      fields: [
        { name: 'Item', type: 'text' },
        { name: 'Qty', type: 'number' },
        { name: 'Amount', type: 'number' },
      ],
    });
    expect(design.title).toBe('Tax Invoice');
    expect(design.repx).toContain('Text="Tax Invoice"');
    expect(design.repx).toContain('Expression="[Qty]"');
    expect(design.repx).toContain('TextFormatString="{0:n2}"');
    expect(design.totals).toEqual([]);
    expect(design.layout.sections.map((s) => s.type)).toEqual(['header', 'header', 'detail', 'footer']);
  });

  it('draws in the house style the model learned, on the paper of its pattern or the one remembered', () => {
    const design = generateOffline(model, { description: 'a stock register grouped by warehouse with totals' });
    const caption = model.style.roles.caption!;
    expect(design.repx).toContain(`Font="${caption.family}, ${caption.size}pt${caption.bold >= 0.5 ? ', style=Bold' : ''}"`);
    const remembered = generateOffline(model, { description: 'a stock register', preferences: { paper: 'Letter', landscape: true } });
    // Letter is DevExpress's default, so it is never named; the turn is.
    expect(remembered.repx).not.toMatch(/PaperKind=/);
    expect(remembered.repx).toMatch(/Landscape="true"/);
    expect(remembered.repx).toMatch(/PageWidth="1100" PageHeight="850"/);
    // Remembered sizes (memory.ts) win over the house style's.
    const sized = generateOffline(model, { description: 'a stock register', preferences: { fontFamily: 'Tahoma', sizes: { title: 16, value: 9 } } });
    expect(sized.repx).toContain('Font="Tahoma, 16pt');
    expect(sized.repx).toContain('Font="Tahoma, 9pt"');
  });

  it('starts a named kind of report from its usual columns, joined by what the words add', () => {
    const stock = generateOffline(model, { description: 'Create a stock register grouped by warehouse with totals' });
    expect(stock.title).toBe('Stock Register');
    expect(stock.groupBy).toBe('Warehouse');
    expect(stock.fields.map((f) => f.name)).toEqual(['Item', 'Warehouse', 'Opening', 'Received', 'Issued', 'Balance']);
    expect(stock.totals).toEqual(['Received', 'Issued', 'Balance']);
    const customers = generateOffline(model, { description: 'Create a customer list grouped by country, with each balance and a total per country' });
    expect(customers.fields.map((f) => f.name)).toEqual(['Customer', 'Country', 'Balance']);
    expect(customers.totals).toEqual(['Balance']);
  });

  it('chooses a pattern of the category the words name', () => {
    const payroll = generateOffline(model, { description: 'monthly payroll' });
    const archetype = model.archetypes.find((a) => a.id === payroll.archetype.id)!;
    expect(archetype.categories.map((c) => c.name)).toContain('payroll');
    expect(payroll.fields.map((f) => f.name)).toContain('NetPay');
  });
});
