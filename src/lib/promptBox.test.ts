/**
 * The composer's words, held outside App's state (lib/promptBox.ts): what a
 * starting point or "Edit text" puts in the box, and when the box tells its
 * one reader that the words changed.
 */
import { describe, expect, it, vi } from 'vitest';
import { createPromptBox } from './promptBox';

describe('createPromptBox', () => {
  it('puts words into an empty box as they are', () => {
    const box = createPromptBox();
    box.insert('An invoice.');
    expect(box.get()).toBe('An invoice.');
  });

  it('puts words after what is typed, on a line of their own', () => {
    const box = createPromptBox('Make it A4.   ');
    box.insert('An invoice.');
    expect(box.get()).toBe('Make it A4.\nAn invoice.');
  });

  /* 2026-11-12, the end-to-end retest: a starting point picked, Settings
     opened at the key, closed, and the same point picked again stood twice. */
  it('does not put the same words in twice, and still adds different ones', () => {
    const box = createPromptBox();
    box.insert('An invoice.');
    box.insert('An invoice.');
    expect(box.get()).toBe('An invoice.');
    box.set('Make it A4.\nAn invoice.\nAnd landscape.');
    box.insert('An invoice.');
    expect(box.get()).toBe('Make it A4.\nAn invoice.\nAnd landscape.');
    box.insert('A customer list.');
    expect(box.get()).toBe('Make it A4.\nAn invoice.\nAnd landscape.\nA customer list.');
  });

  it('tells its readers of a change, and only of a change, until they stop', () => {
    const box = createPromptBox('a');
    const listener = vi.fn();
    const stop = box.subscribe(listener);
    box.set('a');
    expect(listener).not.toHaveBeenCalled();
    box.set((typed) => `${typed}b`);
    expect(box.get()).toBe('ab');
    expect(listener).toHaveBeenCalledTimes(1);
    box.clear();
    expect(box.get()).toBe('');
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    box.set('c');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
