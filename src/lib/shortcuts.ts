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
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
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
