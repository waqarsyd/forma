/**
 * How the person is driving the page, a pointer or the keyboard, written on
 * the root as `data-modality` (2026-11-10, the full audit).
 *
 * The owner's rule is that no grey or orange boundary appears when an
 * element is clicked or typed into: the Projects search field darkened its
 * border on focus, every Settings input darkened its border, and the
 * workspace's generic `:focus-visible` outline drew on a clicked checkbox.
 * The browsers' own heuristic is the reason: a button clicked with a mouse
 * does not match `:focus-visible`, but a text field always does, on a click
 * as on a Tab, so a ring meant for keyboard users appears on every click
 * into a field. ChatGPT, Claude and Gemini show no boundary on a click and
 * keep a ring for the keyboard.
 *
 * So the page remembers the last way it was driven: a pointer press sets
 * `pointer`, and a key that moves focus (Tab, the arrows, Escape) sets
 * `keyboard`; typing letters into a field changes nothing, since typing is
 * not navigation. The stylesheets draw their rings and border changes only
 * under `html:not([data-modality="pointer"])`, which includes the time
 * before the first event, so a keyboard user who never touched the mouse,
 * and a screen reader, see every ring they always did.
 *
 * Pure functions, so a test holds the rule; `watchInputModality` wires them
 * to a document.
 */

export type InputModality = 'pointer' | 'keyboard';

/** The keys that move focus or leave something, as opposed to typing. */
const NAVIGATION_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Home', 'End', 'PageUp', 'PageDown']);

/** The modality an event establishes, or null when it says nothing (a letter typed). */
export function modalityOf(event: { type: string; key?: string }): InputModality | null {
  if (event.type === 'pointerdown' || event.type === 'mousedown' || event.type === 'touchstart') return 'pointer';
  if (event.type === 'keydown') return event.key !== undefined && NAVIGATION_KEYS.has(event.key) ? 'keyboard' : null;
  return null;
}

/** Keeps `data-modality` on the document's root up to date; returns the function that stops it. */
export function watchInputModality(doc: Document = document): () => void {
  const root = doc.documentElement;
  const on = (event: Event) => {
    const modality = modalityOf(event as { type: string; key?: string });
    if (modality && root.dataset.modality !== modality) root.dataset.modality = modality;
  };
  const options = { capture: true, passive: true } as const;
  doc.addEventListener('pointerdown', on, options);
  doc.addEventListener('keydown', on, options);
  return () => {
    doc.removeEventListener('pointerdown', on, options);
    doc.removeEventListener('keydown', on, options);
  };
}
