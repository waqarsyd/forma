/**
 * How the chat box routes a message before any AI is asked (2026-11-07, the
 * agent audit's batch B). Each case is a message that was routed wrongly
 * before, or one the change must not break.
 */
import { describe, expect, it } from 'vitest';
import { isPlainBuild, isRememberMessage, pendingReplyKind, withSelection } from './chatTurn';

describe('isRememberMessage', () => {
  it('keeps only "remember" and "from now on" (items 2 and 92)', () => {
    for (const m of ['Remember: always use A4', 'remember that our reports are landscape', 'From now on use Tahoma', 'Please remember to use 9pt captions']) {
      expect(isRememberMessage(m), m).toBe(true);
    }
    for (const m of ['Never mind, make the title red', 'Always put the logo left', 'Note that the total is wrong', 'I prefer A4', 'By default use Letter', 'Do you remember the invoice?', 'remember what I said?']) {
      expect(isRememberMessage(m), m).toBe(false);
    }
  });
});

describe('isPlainBuild', () => {
  it('takes a report asked for with something to design from (item 80)', () => {
    for (const m of ['Create a sales report', 'make an invoice', 'Build a report of orders by region', 'please draft a stock register', 'Generate a customer list with phone numbers', 'create me a payslip']) {
      expect(isPlainBuild(m), m).toBe(true);
    }
  });

  it('leaves a report asked for with nothing to say what it shows to the chat, and anything else', () => {
    for (const m of ['create a report', 'Make a new report please', 'build me a simple list', 'create a report for me', 'make the title bold', 'hello', 'what is a report?']) {
      expect(isPlainBuild(m), m).toBe(false);
    }
  });
});

describe('pendingReplyKind', () => {
  it('reads a reply to the questions as the answer, a question of its own, or a new request (item 87)', () => {
    expect(pendingReplyKind('Group by region, with a total per region')).toBe('answer');
    expect(pendingReplyKind('the amounts, in euros')).toBe('answer');
    expect(pendingReplyKind('What does grouping do?')).toBe('question');
    expect(pendingReplyKind('yes, is that fine?')).toBe('answer');
    expect(pendingReplyKind('Create a payslip for our staff')).toBe('new');
  });
});

describe('withSelection', () => {
  it('names the selected controls for a redesign, and leaves the words alone with none (item 19)', () => {
    expect(withSelection('make these a table', [])).toBe('make these a table');
    const words = withSelection('make these a table', ['labelQty', 'labelPrice']);
    expect(words.startsWith('make these a table')).toBe(true);
    expect(words).toContain('labelQty, labelPrice');
  });
});
