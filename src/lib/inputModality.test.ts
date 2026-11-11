// @vitest-environment jsdom
/**
 * Pointer or keyboard, on the root (2026-11-10, the full audit): the rule
 * that keeps a ring and a darker border for the keyboard and off a click.
 */
import { describe, expect, it } from 'vitest';
import { isTextEntry, modalityOf, watchInputModality } from './inputModality';

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

  // 2026-11-11, audit FB-1: ArrowLeft in the Projects search brought the darker
  // edge back while the person was typing with a mouse in hand.
  it('reads the caret keys inside a text field as nothing, and Tab there as the keyboard', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    for (const target of [input, textarea, select]) {
      for (const key of ['ArrowLeft', 'ArrowUp', 'Home', 'End', 'Escape', 'PageDown']) {
        expect(modalityOf({ type: 'keydown', key, target }), `${key} in ${target.tagName}`).toBeNull();
      }
      expect(modalityOf({ type: 'keydown', key: 'Tab', target })).toBe('keyboard');
    }
    const search = document.createElement('input');
    search.type = 'search';
    expect(modalityOf({ type: 'keydown', key: 'ArrowLeft', target: search })).toBeNull();
  });

  // Found in review on 2026-11-11: Escape in the Share or Settings field closes the
  // dialog and moves focus to its trigger, which then showed no ring.
  it('reads Escape in a field inside a dialog or a menu as the keyboard, and only Escape', () => {
    for (const layer of ['dialog', 'role=dialog', 'role=menu']) {
      const host = layer === 'dialog' ? document.createElement('dialog') : document.createElement('div');
      if (layer !== 'dialog') host.setAttribute('role', layer.slice(5));
      const input = document.createElement('input');
      host.append(input);
      document.body.append(host);
      expect(modalityOf({ type: 'keydown', key: 'Escape', target: input }), layer).toBe('keyboard');
      expect(modalityOf({ type: 'keydown', key: 'ArrowLeft', target: input }), layer).toBeNull();
      host.remove();
    }
  });

  it('still reads the arrows on a button, a radio or a checkbox as the keyboard', () => {
    const button = document.createElement('button');
    const radio = document.createElement('input');
    radio.type = 'radio';
    const box = document.createElement('input');
    box.type = 'checkbox';
    for (const target of [button, radio, box, document.body]) {
      expect(modalityOf({ type: 'keydown', key: 'ArrowDown', target })).toBe('keyboard');
    }
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry(document)).toBe(false);
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

  // The watcher has to hand modalityOf the event's target, or a caret key in a
  // field reads as navigation again (2026-11-11, audit FB-1, held in review).
  it('passes the target, so a caret key typed in a field leaves the pointer in place', () => {
    const stop = watchInputModality(document);
    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.documentElement.dataset.modality).toBe('pointer');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.documentElement.dataset.modality).toBe('keyboard');
    stop();
    input.remove();
    delete document.documentElement.dataset.modality;
  });
});
