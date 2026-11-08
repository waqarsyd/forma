/**
 * The box's Tools (2026-11-08): the list the "/" menu draws. A sentence tool
 * must leave a place to fill in, and every id must be distinct, since App
 * runs the steps by kind and the menu keys its items by id.
 */
import { describe, expect, it } from 'vitest';
import { BOX_TOOLS, toolText } from './boxTools';

describe('BOX_TOOLS', () => {
  it('has distinct ids, a label and a note each, and words for every sentence tool', () => {
    expect(new Set(BOX_TOOLS.map((t) => t.id)).size).toBe(BOX_TOOLS.length);
    for (const tool of BOX_TOOLS) {
      expect(tool.label.trim(), tool.id).not.toBe('');
      expect(tool.note.trim(), tool.id).not.toBe('');
      expect(Boolean(tool.text), tool.id).toBe(tool.kind === 'prompt');
    }
  });

  it('runs the steps App knows: the check, test data and the export', () => {
    expect(BOX_TOOLS.filter((t) => t.kind !== 'prompt').map((t) => t.kind).sort()).toEqual(['accessibility', 'export', 'test-data']);
  });
});

describe('toolText', () => {
  it('takes out the place to fill in and puts the caret there', () => {
    expect(toolText({ id: 'x', label: 'X', note: 'n', kind: 'prompt', text: 'Group by …, please.', needsReport: true })).toEqual({ text: 'Group by , please.', caret: 9 });
  });

  it('puts the caret at the end of words with no place to fill in', () => {
    expect(toolText({ id: 'x', label: 'X', note: 'n', kind: 'prompt', text: 'Put it on A4.', needsReport: true })).toEqual({ text: 'Put it on A4.', caret: 13 });
  });
});
