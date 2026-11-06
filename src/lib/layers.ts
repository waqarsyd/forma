/**
 * What is open over the workspace (2026-11-06, the workspace audit): a menu,
 * a panel or a dialog. Each registers itself while it is open, in the order
 * it opened, so that two things hold that did not before:
 *
 * - **Escape closes the topmost one only.** Every menu and dialog listened
 *   for Escape on the document itself, and one press closed all of them:
 *   Ctrl+K over Settings, then Escape, closed both and threw away the key
 *   just typed in Settings, and Escape on a toolbar menu also dropped the
 *   Preview's selection behind it.
 * - **The keys that act on the report behind hold back while one is open**
 *   (`hasOpenLayer`): the arrows, Delete and F on the Preview's selection,
 *   undo and redo, the zoom, and the workspace's own shortcuts. The arrows
 *   that moved through the right-click menu also moved the control, and
 *   Delete pressed with the Share dialog open deleted it.
 *
 * One keydown listener on the document, bubbling, does the closing: after
 * the page's own handlers, so a field that uses Escape itself (a retype, a
 * typed zoom) says so with `preventDefault` and keeps it; before the window,
 * where the Preview and App listen, which never see an Escape a layer took.
 * See `components/useLayer.ts` for the hook the overlays use.
 */

export interface Layer {
  /** Which overlay it is, for the one key that may close its own: Ctrl+K and the command menu. */
  id: string;
  close: () => void;
}

const open: Layer[] = [];
let installed = false;

/** The keys a layer listener reads. */
export interface LayerKey {
  key: string;
  isComposing?: boolean;
  defaultPrevented: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

/** Escape for the topmost layer: closes it and keeps the key from anything behind. */
export function onLayerKey(e: LayerKey): void {
  if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return;
  const top = open[open.length - 1];
  if (!top) return;
  e.preventDefault();
  e.stopPropagation();
  top.close();
}

/** Registers an open layer; the function returned unregisters it. */
export function addLayer(layer: Layer): () => void {
  if (!installed && typeof document !== 'undefined') {
    installed = true;
    document.addEventListener('keydown', onLayerKey);
  }
  open.push(layer);
  return () => {
    const at = open.lastIndexOf(layer);
    if (at >= 0) open.splice(at, 1);
  };
}

/** Whether anything is open over the workspace. */
export function hasOpenLayer(): boolean {
  return open.length > 0;
}

/** The layer opened last, or null. */
export function topLayer(): Layer | null {
  return open[open.length - 1] ?? null;
}

/**
 * Whether a key went to something that is not the report: a menu, a dialog,
 * or the conversation floating over it. The Preview's selection keys are the
 * report's alone, so a Delete pressed on a reply's Copy is not a delete.
 */
export function isOutsideReport(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return !!el?.closest?.('[role="dialog"], [role="menu"], [role="listbox"], .wb-float');
}
