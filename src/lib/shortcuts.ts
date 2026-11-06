/**
 * The workspace's keyboard shortcuts for the chat (2026-11-05), ChatGPT's own:
 *
 * - Ctrl+Shift+O (Cmd+Shift+O on a Mac): a new report, as ChatGPT's new chat.
 * - Shift+Esc: the cursor to the chat box, from anywhere.
 * - Ctrl+Shift+C (Cmd+Shift+C): the last of Forma's replies on the clipboard.
 *
 * The sidebar's Ctrl+B is `lib/sidebar.ts`'s. Each is the exact combination
 * and nothing else held, as `isSidebarShortcut` reads its own, and never
 * mid-composition, when the keys belong to an input method. A browser keeps
 * some combinations for itself whatever a page asks (Chrome's Ctrl+Shift+C
 * can open its inspector), which is why ChatGPT documents the same one and
 * why Copy under a reply stays the way that always works.
 */

/** The parts of a key event the shortcuts read. */
export interface ShortcutKey {
  key: string;
  /** The physical key ("Digit1"), for Shift+1 whatever the layout prints for it. */
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}

/**
 * The workspace's own shortcuts (2026-11-05), Google Stitch's: Ctrl+K (Cmd+K)
 * opens the command menu, Ctrl+\ (Cmd+\) the clean screen, Stitch's Zen
 * mode, and "?" the list of shortcuts. On Preview, + and - zoom, Shift+0 is
 * 100%, Shift+1 the fit to the width and Shift+2 the selection. "?" and the
 * zoom keys are bare letters, so the caller passes `typing` when the key
 * went to a field, and they are then the field's.
 *
 * Undo and redo are here since 2026-11-06 (the workspace audit): Ctrl+Z,
 * and Ctrl+Shift+Z or Ctrl+Y, on every pane, as the corner's buttons work on
 * every pane. Only the Preview read them until then. In a field they are the
 * field's own.
 */
export type WorkspaceShortcut = 'commands' | 'clean' | 'shortcuts' | 'undo' | 'redo' | 'zoomIn' | 'zoomOut' | 'zoom100' | 'zoomFit' | 'zoomSelection';

export function workspaceShortcutOf(e: ShortcutKey, typing: boolean): WorkspaceShortcut | null {
  if (e.isComposing || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (e.ctrlKey !== e.metaKey && !typing) {
    if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (key === 'y' && !e.shiftKey) return 'redo';
  }
  if (e.ctrlKey !== e.metaKey && !e.shiftKey) {
    if (key === 'k') return 'commands';
    if (key === '\\') return 'clean';
    return null;
  }
  if (typing || e.ctrlKey || e.metaKey) return null;
  if (key === '?') return 'shortcuts';
  if (e.shiftKey && e.code === 'Digit0') return 'zoom100';
  if (e.shiftKey && e.code === 'Digit1') return 'zoomFit';
  if (e.shiftKey && e.code === 'Digit2') return 'zoomSelection';
  if (key === '+' || key === '=') return 'zoomIn';
  if (key === '-' && !e.shiftKey) return 'zoomOut';
  return null;
}

export type ChatShortcut = 'newReport' | 'focusBox' | 'copyReply';

/** Which chat shortcut a key press is, or null. */
export function chatShortcutOf(e: ShortcutKey): ChatShortcut | null {
  if (e.isComposing || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (e.shiftKey && !e.ctrlKey && !e.metaKey && key === 'escape') return 'focusBox';
  // Exactly one of Ctrl and Cmd, with Shift.
  if (!e.shiftKey || e.ctrlKey === e.metaKey) return null;
  if (key === 'o') return 'newReport';
  if (key === 'c') return 'copyReply';
  return null;
}

/** The shortcut as a Mac or a PC writes it, for a tooltip. */
export function shortcutText(shortcut: ChatShortcut, platform: string): string {
  const mac = /mac|iphone|ipad/i.test(platform);
  if (shortcut === 'focusBox') return mac ? '⇧Esc' : 'Shift+Esc';
  const letter = shortcut === 'newReport' ? 'O' : 'C';
  return mac ? `⇧⌘${letter}` : `Ctrl+Shift+${letter}`;
}
