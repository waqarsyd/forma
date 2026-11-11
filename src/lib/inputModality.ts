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
 * and a screen reader, see every ring they always did. A text field's darker
 * edge waits for `html[data-modality="keyboard"]` instead (2026-11-11, audit
 * FB-10): a field the page focuses itself on load, as Sign in's email does,
 * is not a keyboard user's Tab, and it wore its ring while the address was
 * typed. And `src/lib/focusRules.test.ts` reads the stylesheets for any focus
 * rule that draws without one of those gates.
 *
 * Inside a text field the arrows, Home, End and Escape edit the text or the
 * caret, they do not move focus, so there they say nothing either
 * (2026-11-11, audit FB-1): moving the caret with ArrowLeft in the Projects
 * search, a mouse still in hand, brought the darker edge back mid-typing, and
 * on /login the orange edge and its ring. Tab is navigation everywhere, and so
 * is Escape in a field inside a dialog or a menu (found in review the same day):
 * there it closes the layer and focus returns to whatever opened it, so a
 * dialog opened with a click and closed with Escape left that trigger with no
 * ring when the keyboard had just moved the focus onto it.
 *
 * Pure functions, so a test holds the rule; `watchInputModality` wires them
 * to a document.
 */

export type InputModality = 'pointer' | 'keyboard';

/** The keys that move focus or leave something, as opposed to typing. */
const NAVIGATION_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Home', 'End', 'PageUp', 'PageDown']);

/** Input types that hold no caret: on them an arrow key moves a choice or the focus, as on a button. */
const NO_CARET_INPUT = /^(checkbox|radio|range|button|submit|reset|file|color|image)$/;

/** A field the person types in: there the arrows, Home, End and Escape edit text, they do not move focus. */
export function isTextEntry(target: EventTarget | null | undefined): boolean {
  const el = target as HTMLElement | null | undefined;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !NO_CARET_INPUT.test((el as HTMLInputElement).type);
}

/** The modality an event establishes, or null when it says nothing (a letter typed, a caret moved). */
export function modalityOf(event: { type: string; key?: string; target?: EventTarget | null }): InputModality | null {
  if (event.type === 'pointerdown' || event.type === 'mousedown' || event.type === 'touchstart') return 'pointer';
  if (event.type !== 'keydown' || event.key === undefined) return null;
  if (event.key === 'Tab') return 'keyboard';
  if (!NAVIGATION_KEYS.has(event.key)) return null;
  if (!isTextEntry(event.target)) return 'keyboard';
  return event.key === 'Escape' && insideLayer(event.target) ? 'keyboard' : null;
}

/** Whether a target sits in a dialog or a menu, where Escape closes it rather than editing text. */
function insideLayer(target: EventTarget | null | undefined): boolean {
  const el = target as Element | null | undefined;
  return typeof el?.closest === 'function' && el.closest('dialog, [role=dialog], [role=alertdialog], [role=menu]') !== null;
}

/** Keeps `data-modality` on the document's root up to date; returns the function that stops it. */
export function watchInputModality(doc: Document = document): () => void {
  const root = doc.documentElement;
  const on = (event: Event) => {
    const modality = modalityOf(event as { type: string; key?: string; target: EventTarget | null });
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
