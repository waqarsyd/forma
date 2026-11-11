/**
 * Where the keyboard goes when Escape closes a side panel (2026-11-11, the
 * full audit's UI7 and its remainder in batch BW2).
 *
 * Escape closes a side panel floating in the chat's place (Projects,
 * Revisions, Batch, the library), and focus has to land somewhere the person
 * can see. Until BW2 it went to the rail's button for that panel, always:
 *
 * - Projects opened from the rail's **Search projects** gave the focus back
 *   to **Saved projects**, a different button, measured in the owner's Chrome
 *   (UI walk, 14:45). What had the focus when the panel opened is remembered
 *   by App, and gets it back when it is a control in the rail.
 * - On the stacked layout the rail sits inside the drawer, which is closed by
 *   then, so the focus went to a button nobody could see. There it goes to
 *   the top bar's menu button, the drawer's own way back in.
 */

/**
 * The element to focus once a side panel closes: the menu button on the
 * stacked layout; else `opener`, what had the focus when the panel opened,
 * while it is a control still in the rail; else the rail's button for the
 * panel (a panel opened from the command menu or the home, say).
 */
export function panelReturnTarget(o: {
  stacked: boolean;
  menuButton: HTMLElement | null;
  opener: Element | null;
  panelButton: HTMLElement | null;
}): HTMLElement | null {
  if (o.stacked) return o.menuButton ?? o.panelButton;
  const { opener } = o;
  if (opener instanceof HTMLElement && opener.isConnected && opener.closest('#wb-rail') && !(opener as HTMLButtonElement).disabled) return opener;
  return o.panelButton;
}
