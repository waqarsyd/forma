/**
 * The workspace's sidebar, opened and closed the way Gemini and ChatGPT do it
 * (2026-11-04, at the owner's request).
 *
 * Measured rather than remembered, on both products' own pages:
 * - **Gemini** (captured with REA, signed out, 1280px and 390px wide): open,
 *   a column with the brand at the left of its header and a panel icon at the
 *   right ("Close sidebar"); closed, an icon rail with the logo on top, where
 *   "Open sidebar" sits. On a phone there is no rail at all: a "Main menu"
 *   button in a top bar opens the same list as a drawer over a dimmed page,
 *   closed by an X at its top right.
 * - **ChatGPT** (measured in the owner's Chrome, signed out; it shows automated
 *   browsers a bot check): a 56px rail whose logo IS the "Open sidebar"
 *   button, turning into the panel icon on hover; open, 260px, with the
 *   panel icon at the right of the header. The width animates as
 *   `inline-size` over 0.22s, cubic-bezier(0.2, 0.8, 0.2, 1), and the page
 *   beside it is pushed, not covered. The state is kept across visits.
 *
 * Measured again on 2026-11-05, for the header's controls (the owner asked
 * for Search beside the close button, as ChatGPT has it). ChatGPT, signed in,
 * 1280px: open, its name at the left, then **Search** (36px at x=252) right
 * before **Hide sidebar** (36px at x=296), 8px apart, and New chat as the
 * first item below; closed, a 52px rail of 36px buttons 8px in, one every
 * 36px: the logo ("Show sidebar"), **New chat, Search**, Recents, Library,
 * the profile at the foot, the empty rail itself opening it too. It was
 * 340px wide open that day. Gemini, signed out (REA): the brand at the left,
 * "Close sidebar" at the right, New chat first below; its Search shows only
 * signed in. Forma follows ChatGPT's order: open, the mark, Search, the
 * toggle; closed, the toggle, New report, Search, then its sections, and
 * keeps its 56px and 260px and 38px buttons.
 *
 * Forma copies that behaviour and keeps its own parts: the same sections, the
 * mark as the route home while the sidebar is open, and the choice kept in
 * localStorage (`railExpanded`), as before. The keyboard shortcut is Forma's
 * choice, not a measurement: Ctrl+B (Cmd+B on a Mac), the editor convention
 * for a sidebar. Ctrl+Shift+S, the one ChatGPT is said to use, is Edge's web
 * capture, and a page cannot take a browser's own shortcut back.
 */

/** At or below this width the workspace stacks and the sidebar is a drawer. Matches workspace.css. */
export const STACKED_MAX_WIDTH = 880;

/** The sidebar's two widths on a desktop: the icon rail, and open with labels (ChatGPT's 260). */
export const SIDEBAR_CLOSED_WIDTH = 56;
export const SIDEBAR_OPEN_WIDTH = 260;

/** Whether the workspace is stacked at this viewport width, so the sidebar is a drawer. */
export function isStacked(viewportWidth: number): boolean {
  return viewportWidth <= STACKED_MAX_WIDTH;
}

/** The parts of a key event the shortcut reads. */
export interface ShortcutKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}

/**
 * Ctrl+B or Cmd+B, and nothing else held: Ctrl+Shift+B is the bookmarks bar
 * and Ctrl+Alt+B is something else again. Never mid-composition, when the key
 * belongs to an input method.
 */
export function isSidebarShortcut(e: ShortcutKey): boolean {
  if (e.isComposing || e.shiftKey || e.altKey) return false;
  if (e.ctrlKey === e.metaKey) return false;
  return e.key.toLowerCase() === 'b';
}

/** The shortcut as a Mac or a PC writes it, for a tooltip. */
export function sidebarShortcutText(platform: string): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘B' : 'Ctrl+B';
}

/** For `aria-keyshortcuts`: either modifier. */
export const SIDEBAR_SHORTCUT_ARIA = 'Control+B Meta+B';

/**
 * The toggle's name. On a desktop it opens or closes the sidebar; stacked, it
 * lives inside the drawer, so the only thing it can do is close it.
 */
export function sidebarToggleLabel(stacked: boolean, open: boolean): string {
  if (stacked) return 'Close the menu';
  return open ? 'Close the sidebar' : 'Open the sidebar';
}
