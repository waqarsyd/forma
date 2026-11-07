/**
 * The replies' changes kept in the tab (2026-11-07, agent audit item 52), so
 * their Undo and Redo outlive a reload. What is proved: only the open
 * project's come back, the newest are the ones kept, the size stays bounded,
 * and anything unreadable is nothing rather than a throw at load.
 */
import { describe, it, expect } from 'vitest';
import { MAX_KEPT_CHANGES, MAX_KEPT_CHARS, packChanges, unpackChanges, type ReplyChange } from './replyChanges';

const change = (n: number, size = 10): [string, ReplyChange] => [`r${n}`, { before: `b${n}`.padEnd(size, '.'), after: `a${n}`.padEnd(size, '.') }];

describe('packChanges and unpackChanges', () => {
  it('brings back the changes kept for the project, oldest first', () => {
    const packed = packChanges('p1', [change(1), change(2)]);
    expect(unpackChanges(packed, 'p1')).toEqual([change(1), change(2)]);
  });

  it("brings back nothing for another project, nothing stored, or what is not Forma's", () => {
    const packed = packChanges('p1', [change(1)]);
    expect(unpackChanges(packed, 'p2')).toEqual([]);
    expect(unpackChanges(null, 'p1')).toEqual([]);
    expect(unpackChanges('{not json', 'p1')).toEqual([]);
    expect(unpackChanges(JSON.stringify({ project: 'p1', changes: [['r1', { before: 1 }], 'x'] }), 'p1')).toEqual([]);
  });

  it('keeps the newest changes, and fewer while they are too large', () => {
    const many = Array.from({ length: MAX_KEPT_CHANGES + 3 }, (_, i) => change(i));
    expect(unpackChanges(packChanges('p', many), 'p').map(([id]) => id)).toEqual(many.slice(3).map(([id]) => id));
    const big = Math.floor(MAX_KEPT_CHARS / 3);
    const kept = unpackChanges(packChanges('p', [change(1, big), change(2, big), change(3, 10)]), 'p');
    expect(kept.map(([id]) => id)).toEqual(['r2', 'r3']);
  });

  it('keeps nothing for no changes or a change with an empty side', () => {
    expect(packChanges('p', [])).toBeNull();
    expect(packChanges('p', [['r', { before: '', after: '<x/>' }]])).toBeNull();
  });
});
