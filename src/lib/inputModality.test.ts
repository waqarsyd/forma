// @vitest-environment jsdom
/**
 * Pointer or keyboard, on the root (2026-11-10, the full audit): the rule
 * that keeps a ring and a darker border for the keyboard and off a click.
 */
import { describe, expect, it } from 'vitest';
import { modalityOf, watchInputModality } from './inputModality';

describe('what an event says about how the page is driven', () => {
  it('reads a pointer press as the pointer, and a key that moves focus as the keyboard', () => {
    expect(modalityOf({ type: 'pointerdown' })).toBe('pointer');
    expect(modalityOf({ type: 'mousedown' })).toBe('pointer');
    expect(modalityOf({ type: 'touchstart' })).toBe('pointer');
    expect(modalityOf({ type: 'keydown', key: 'Tab' })).toBe('keyboard');
    expect(modalityOf({ type: 'keydown', key: 'ArrowDown' })).toBe('keyboard');
    expect(modalityOf({ type: 'keydown', key: 'Escape' })).toBe('keyboard');
  });

  it('reads typing as nothing: a letter, a space or Enter in a field is not navigation', () => {
    expect(modalityOf({ type: 'keydown', key: 'a' })).toBeNull();
    expect(modalityOf({ type: 'keydown', key: ' ' })).toBeNull();
    expect(modalityOf({ type: 'keydown', key: 'Enter' })).toBeNull();
    expect(modalityOf({ type: 'keydown' })).toBeNull();
    expect(modalityOf({ type: 'focus' })).toBeNull();
  });
});

describe('the root attribute', () => {
  it('follows the last press or navigation key, and stops when told', () => {
    const stop = watchInputModality(document);
    expect(document.documentElement.dataset.modality).toBeUndefined();
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.documentElement.dataset.modality).toBe('pointer');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(document.documentElement.dataset.modality).toBe('pointer');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.documentElement.dataset.modality).toBe('keyboard');
    stop();
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.documentElement.dataset.modality).toBe('keyboard');
    delete document.documentElement.dataset.modality;
  });
});
