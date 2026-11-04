import { describe, it, expect } from 'vitest';
import {
  STACKED_MAX_WIDTH,
  SIDEBAR_CLOSED_WIDTH,
  SIDEBAR_OPEN_WIDTH,
  isStacked,
  isSidebarShortcut,
  sidebarShortcutText,
  sidebarToggleLabel,
} from './sidebar';

const key = (over: Partial<Parameters<typeof isSidebarShortcut>[0]> = {}) => ({
  key: 'b',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe('the sidebar', () => {
  it('becomes a drawer at the width the stylesheet stacks at, and not a pixel wider', () => {
    expect(isStacked(STACKED_MAX_WIDTH)).toBe(true);
    expect(isStacked(STACKED_MAX_WIDTH + 1)).toBe(false);
    expect(isStacked(390)).toBe(true);
  });

  it('opens to the width ChatGPT measured, from the rail it always had', () => {
    expect(SIDEBAR_CLOSED_WIDTH).toBe(56);
    expect(SIDEBAR_OPEN_WIDTH).toBe(260);
  });

  it('toggles on Ctrl+B or Cmd+B, whatever the case of the letter', () => {
    expect(isSidebarShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isSidebarShortcut(key({ metaKey: true }))).toBe(true);
    expect(isSidebarShortcut(key({ ctrlKey: true, key: 'B' }))).toBe(true);
  });

  it('leaves every neighbouring combination alone', () => {
    expect(isSidebarShortcut(key())).toBe(false);
    expect(isSidebarShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSidebarShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isSidebarShortcut(key({ ctrlKey: true, metaKey: true }))).toBe(false);
    expect(isSidebarShortcut(key({ ctrlKey: true, key: 's' }))).toBe(false);
    expect(isSidebarShortcut(key({ ctrlKey: true, isComposing: true }))).toBe(false);
  });

  it('writes the shortcut as the platform does, and names the toggle by what it will do', () => {
    expect(sidebarShortcutText('MacIntel')).toBe('⌘B');
    expect(sidebarShortcutText('Win32')).toBe('Ctrl+B');
    expect(sidebarToggleLabel(false, false)).toBe('Open the sidebar');
    expect(sidebarToggleLabel(false, true)).toBe('Close the sidebar');
    expect(sidebarToggleLabel(true, true)).toBe('Close the menu');
  });
});
