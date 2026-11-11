/**
 * What withdrawing a message takes back with it (2026-11-11, the full audit's
 * WS-41, out of App.tsx in batch BW2): the change its answer made, by the
 * report's Undo while that change is the last, and the panel's question
 * naming the undo only where there is one.
 */
import { describe, it, expect } from 'vitest';
import { howToUndo, requestsThatUndo, undoReplyOf, type WithdrawRequest } from './withdraw';

const requests: WithdrawRequest[] = [
  { id: 'u1', replies: [{ id: 'a1' }] },
  { id: 'u2', replies: [{ id: 'a2' }, { id: 'a3' }, { id: 'a4' }] },
  { id: 'u3', replies: [{ id: 'a5' }] },
  { id: 'u4', replies: [] },
];

describe('undoReplyOf', () => {
  it('takes the newest reply of the request that still has an Undo', () => {
    expect(undoReplyOf(requests, 'u2', new Set(['a2', 'a3']))).toBe('a3');
    expect(undoReplyOf(requests, 'u2', new Set(['a2', 'a3', 'a4']))).toBe('a4');
    expect(undoReplyOf(requests, 'u1', new Set(['a1']))).toBe('a1');
  });

  it('undoes nothing for a request that changed nothing, one with no replies, or one not there', () => {
    expect(undoReplyOf(requests, 'u3', new Set(['a1']))).toBeUndefined();
    expect(undoReplyOf(requests, 'u4', new Set(['a1']))).toBeUndefined();
    expect(undoReplyOf(requests, 'gone', new Set(['a1']))).toBeUndefined();
    // Another request's Undo is never taken by this one's withdrawal.
    expect(undoReplyOf(requests, 'u1', new Set(['a3']))).toBeUndefined();
  });
});

describe('howToUndo', () => {
  it('uses the report\'s Undo while the change is still the last, so Redo keeps working', () => {
    expect(howToUndo('<before/>', '<before/>')).toBe('undo');
  });

  it('puts the report back as it was when a later change sits on top, or there is no history', () => {
    expect(howToUndo('<before/>', '<later/>')).toBe('restore');
    expect(howToUndo('<before/>', undefined)).toBe('restore');
    expect(howToUndo(undefined, undefined)).toBe('restore');
  });
});

describe('requestsThatUndo', () => {
  it('names the requests whose withdrawal would undo a change, for the question', () => {
    expect([...requestsThatUndo(requests, new Set(['a3', 'a5']))].sort()).toEqual(['u2', 'u3']);
    expect(requestsThatUndo(requests, new Set()).size).toBe(0);
  });
});
