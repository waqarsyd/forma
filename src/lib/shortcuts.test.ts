/** The chat's keyboard shortcuts, ChatGPT's own (2026-11-05). */
import { describe, it, expect } from 'vitest';
import { chatShortcutOf, shortcutText, type ShortcutKey } from './shortcuts';

const press = (key: string, mods: Partial<ShortcutKey> = {}): ShortcutKey => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe('chatShortcutOf', () => {
  it('reads Ctrl+Shift+O and Cmd+Shift+O as a new report, and Ctrl+Shift+C as copying the last reply', () => {
    expect(chatShortcutOf(press('O', { ctrlKey: true, shiftKey: true }))).toBe('newReport');
    expect(chatShortcutOf(press('o', { metaKey: true, shiftKey: true }))).toBe('newReport');
    expect(chatShortcutOf(press('C', { ctrlKey: true, shiftKey: true }))).toBe('copyReply');
  });

  it('reads Shift+Esc as the chat box', () => {
    expect(chatShortcutOf(press('Escape', { shiftKey: true }))).toBe('focusBox');
    expect(chatShortcutOf(press('Escape'))).toBeNull();
  });

  it('takes nothing else: no Shift, both Ctrl and Cmd, Alt, or mid-composition', () => {
    expect(chatShortcutOf(press('o', { ctrlKey: true }))).toBeNull();
    expect(chatShortcutOf(press('o', { ctrlKey: true, metaKey: true, shiftKey: true }))).toBeNull();
    expect(chatShortcutOf(press('o', { ctrlKey: true, shiftKey: true, altKey: true }))).toBeNull();
    expect(chatShortcutOf(press('o', { ctrlKey: true, shiftKey: true, isComposing: true }))).toBeNull();
    expect(chatShortcutOf(press('x', { ctrlKey: true, shiftKey: true }))).toBeNull();
  });
});

describe('shortcutText', () => {
  it('writes each as a PC and a Mac write it', () => {
    expect(shortcutText('newReport', 'Win32')).toBe('Ctrl+Shift+O');
    expect(shortcutText('copyReply', 'MacIntel')).toBe('⇧⌘C');
    expect(shortcutText('focusBox', 'Win32')).toBe('Shift+Esc');
  });
});
