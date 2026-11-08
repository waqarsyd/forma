/**
 * The box's Tools (2026-11-08): the list the "/" menu draws. Every tool is a
 * sentence with a place to fill in or an end to type after, and every id is
 * distinct, since the menu keys its items by id. Sentences alone since the
 * same day: the check, test data and Export are their own views'.
 */
import { describe, expect, it } from 'vitest';
import { BOX_TOOLS, toolText } from './boxTools';

describe('BOX_TOOLS', () => {
  it('has distinct ids, and a label, a note and words for every tool', () => {
    expect(new Set(BOX_TOOLS.map((t) => t.id)).size).toBe(BOX_TOOLS.length);
    for (const tool of BOX_TOOLS) {
      expect(tool.label.trim(), tool.id).not.toBe('');
      expect(tool.note.trim(), tool.id).not.toBe('');
      expect(tool.text.trim(), tool.id).not.toBe('');
    }
  });

  it('holds no step of its own: the check, test data and Export each have a place', () => {
    expect(BOX_TOOLS.map((t) => t.label).join(' ')).not.toMatch(/Accessibility|test data|Export/i);
  });
});

describe('toolText', () => {
  it('takes out the place to fill in and puts the caret there', () => {
    expect(toolText({ id: 'x', label: 'X', note: 'n', text: 'Group by …, please.', needsReport: true })).toEqual({ text: 'Group by , please.', caret: 9 });
  });

  it('puts the caret at the end of words with no place to fill in', () => {
    expect(toolText({ id: 'x', label: 'X', note: 'n', text: 'Put it on A4.', needsReport: true })).toEqual({ text: 'Put it on A4.', caret: 13 });
  });
});
