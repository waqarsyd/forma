/**
 * Questions about the Preview's rows, with consent first (2026-11-10, the
 * second gap of docs/proposals/ai-designers.md).
 */
import { describe, expect, it } from 'vitest';
import { asksAboutData, consentReply, MAX_CHARS, MAX_ROWS, rowsBlock, rowsNote } from './previewRows';

const fields = ['CompanyName', 'City', 'Balance'];

describe('which questions are about the data', () => {
  it('takes a question about figures, or one naming a printed field, and leaves a change or a layout question', () => {
    expect(asksAboutData('Which customer has the highest balance?', fields)).toBe(true);
    expect(asksAboutData('What do the amounts add up to?', fields)).toBe(true);
    expect(asksAboutData('How many rows are in London?', fields)).toBe(true);
    expect(asksAboutData('What is the City of the first row', fields)).toBe(true);
    expect(asksAboutData('Make the title bold', fields)).toBe(false);
    expect(asksAboutData('Sort it by balance', fields)).toBe(false);
    expect(asksAboutData('Is the title centred?', fields)).toBe(false);
    expect(asksAboutData('How do I share a report?', fields)).toBe(false);
  });
});

describe('the rows as they go', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ CompanyName: `Firm ${i}`, City: i % 2 ? 'Leeds' : 'York', Balance: i * 10.5, Secret: 'not a field' }));

  it('sends the fields named, a row a line, at most MAX_ROWS', () => {
    const block = rowsBlock(rows, fields);
    expect(block.split('\n')[0]).toBe(`${MAX_ROWS} of 60 rows the Preview prints (10 more not sent), one a line, fields separated by |:`);
    expect(block.split('\n')[1]).toBe('CompanyName | City | Balance');
    expect(block.split('\n')[2]).toBe('Firm 0 | York | 0');
    expect(block.split('\n')).toHaveLength(2 + MAX_ROWS);
    expect(block).not.toContain('not a field');
  });

  it('stops at the budget, and sends nothing with no rows or no fields', () => {
    const wide = Array.from({ length: 50 }, (_, i) => ({ Notes: 'x'.repeat(79) + i }));
    const block = rowsBlock(wide, ['Notes']);
    expect(block.length).toBeLessThanOrEqual(MAX_CHARS + 120);
    expect(block).toMatch(/^\d+ of 50 rows/);
    expect(rowsBlock([], fields)).toBe('');
    expect(rowsBlock(rows, [])).toBe('');
  });

  it('asks before they go, and says when they went', () => {
    expect(consentReply(20, fields, 'sample rows')).toBe(
      'To answer that, Forma would send the AI the 20 sample rows the Preview prints (CompanyName, City, Balance). Nothing of them has gone so far. Send them? They go with questions about the data for this project until you start a new one.',
    );
    expect(consentReply(80, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], 'test rows')).toMatch(/the 50 test rows .*\(A, B, C, D, E, F, G, H and 2 more\)/);
    expect(rowsNote(20, 'sample rows')).toBe('Answered from the 20 sample rows the Preview prints, which went with your question.');
  });
});
