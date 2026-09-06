/**
 * The Mockup draws a heading row once, and the layout still carries it twice.
 *
 * Both halves are asserted here, because the second is what makes the first
 * safe: `recordCountFromLayout` counts the detail table's rows and subtracts the
 * heading, so a "fix" that removed the row from the data would take a record
 * with it and say nothing. The last case in this file fails if that happens.
 */
import { describe, it, expect } from 'vitest';
import { repeatedHeadingTables, type MockupLayoutLike } from './mockupRows';
import { recordCountFromLayout } from './reportPreview';

const cells = (...texts: string[]) => ({ cells: texts.map((content) => ({ content })) });

/** The shape the prompt asks for: headings in the PageHeader, repeated in Detail. */
const invoice: MockupLayoutLike = {
  sections: [
    { type: 'header', elements: [{ type: 'label' }] },
    { type: 'header', elements: [{ type: 'table', rows: [cells('Item Description', 'Amount')] }] },
    {
      type: 'detail',
      elements: [
        {
          type: 'table',
          rows: [
            cells('Item Description', 'Amount'),
            cells('Mock Layout Development Service', '1,250.00'),
            cells('Second Mock Line Item', '480.00'),
          ],
        },
      ],
    },
  ],
};

describe('finding a heading the mockup would draw twice', () => {
  it('flags a detail table whose first row repeats an earlier heading', () => {
    expect(repeatedHeadingTables(invoice)).toEqual(new Set(['2:0']));
  });

  it('keys by section and element index, not by element id', () => {
    // Two tables in one detail section; only the second repeats a heading.
    const layout: MockupLayoutLike = {
      sections: [
        { type: 'header', elements: [{ type: 'table', rows: [cells('Item', 'Amount')] }] },
        {
          type: 'detail',
          elements: [
            { type: 'table', rows: [cells('Ref', 'Qty'), cells('A-1', '2')] },
            { type: 'table', rows: [cells('Item', 'Amount'), cells('Widget', '5.00')] },
          ],
        },
      ],
    };
    expect(repeatedHeadingTables(layout)).toEqual(new Set(['1:1']));
  });

  it('ignores case and collapsed whitespace, which vary between the two copies', () => {
    const layout: MockupLayoutLike = {
      sections: [
        { type: 'header', elements: [{ type: 'table', rows: [cells('ITEM  DESCRIPTION', 'Amount')] }] },
        {
          type: 'detail',
          elements: [{ type: 'table', rows: [cells(' Item Description ', 'amount'), cells('Widget', '5.00')] }],
        },
      ],
    };
    expect(repeatedHeadingTables(layout).has('1:0')).toBe(true);
  });

  it('keeps a heading that is the only copy on the page', () => {
    const layout: MockupLayoutLike = {
      sections: [
        { type: 'header', elements: [{ type: 'label' }] },
        {
          type: 'detail',
          elements: [{ type: 'table', rows: [cells('Item', 'Amount'), cells('Widget', '5.00')] }],
        },
      ],
    };
    expect(repeatedHeadingTables(layout).size).toBe(0);
  });

  it('does not drop a row because a table BELOW repeats it', () => {
    // A totals table in the footer echoing the column names is not a reason to
    // remove the heading above it.
    const layout: MockupLayoutLike = {
      sections: [
        {
          type: 'detail',
          elements: [{ type: 'table', rows: [cells('Item', 'Amount'), cells('Widget', '5.00')] }],
        },
        { type: 'footer', elements: [{ type: 'table', rows: [cells('Item', 'Amount')] }] },
      ],
    };
    expect(repeatedHeadingTables(layout).size).toBe(0);
  });

  it('never empties a one-row table', () => {
    const layout: MockupLayoutLike = {
      sections: [
        { type: 'header', elements: [{ type: 'table', rows: [cells('Item', 'Amount')] }] },
        { type: 'detail', elements: [{ type: 'table', rows: [cells('Item', 'Amount')] }] },
      ],
    };
    expect(repeatedHeadingTables(layout).size).toBe(0);
  });

  it('does not match two blank rows to each other', () => {
    const layout: MockupLayoutLike = {
      sections: [
        { type: 'header', elements: [{ type: 'table', rows: [cells('', ''), cells('Item', 'Amount')] }] },
        { type: 'detail', elements: [{ type: 'table', rows: [cells('', ''), cells('Widget', '5.00')] }] },
      ],
    };
    expect(repeatedHeadingTables(layout).size).toBe(0);
  });

  it('does not match rows that differ only in cell count', () => {
    const layout: MockupLayoutLike = {
      sections: [
        { type: 'header', elements: [{ type: 'table', rows: [cells('Item', 'Amount')] }] },
        {
          type: 'detail',
          elements: [{ type: 'table', rows: [cells('Item', 'Amount', 'Tax'), cells('Widget', '5.00', '0.50')] }],
        },
      ],
    };
    expect(repeatedHeadingTables(layout).size).toBe(0);
  });

  it('compares whole rows, so a shared separator cannot forge a match', () => {
    const layout: MockupLayoutLike = {
      sections: [
        { type: 'header', elements: [{ type: 'table', rows: [cells('Item', 'Amount')] }] },
        {
          type: 'detail',
          elements: [{ type: 'table', rows: [cells('Item"Amount'), cells('Widget', '5.00')] }],
        },
      ],
    };
    expect(repeatedHeadingTables(layout).size).toBe(0);
  });

  it('looks only at tables, so a label repeating the words is not a heading', () => {
    const layout: MockupLayoutLike = {
      sections: [
        { type: 'header', elements: [{ type: 'label' }] },
        {
          type: 'detail',
          elements: [{ type: 'table', rows: [cells('Item', 'Amount'), cells('Widget', '5.00')] }],
        },
      ],
    };
    expect(repeatedHeadingTables(layout).size).toBe(0);
  });

  it('survives an absent, empty or ragged layout', () => {
    expect(repeatedHeadingTables(null).size).toBe(0);
    expect(repeatedHeadingTables(undefined).size).toBe(0);
    expect(repeatedHeadingTables({}).size).toBe(0);
    expect(repeatedHeadingTables({ sections: [{ type: 'detail' }] }).size).toBe(0);
    expect(repeatedHeadingTables({ sections: [{ type: 'detail', elements: [{ type: 'table' }] }] }).size).toBe(0);
  });

  it('leaves the record count alone, because the row stays in the data', () => {
    // The whole reason this is a renderer rule. Two data rows plus the repeated
    // heading is still two records to the Preview, and the row is still there.
    expect(recordCountFromLayout(invoice)).toBe(2);
    expect(invoice.sections![2].elements![0].rows).toHaveLength(3);
  });
});
