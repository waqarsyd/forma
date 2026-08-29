import { RefObject, useEffect, useRef } from 'react';

/**
 * The keyboard contract every modal in this app owes a keyboard user: focus
 * lands inside it, Escape closes it, Tab cannot walk out into the page behind
 * the scrim, and focus returns to whatever opened it.
 *
 * Extracted 2026-08-28. It existed twice — in `App.tsx` for the config dialog
 * and in `AccountDialog.tsx` — as 19 near-identical lines sharing a
 * byte-identical focusable-element selector. The two copies had not drifted,
 * which is the only reason this extraction is safe rather than a merge of two
 * behaviours. They were going to: this is accessibility code, **there is no
 * component test anywhere in this project**, and a correct fix to one copy
 * would have passed `tsc`, all 409 unit tests, all 41 rules tests and the
 * build while leaving the other dialog broken for anyone not using a mouse.
 *
 * Three details that are load-bearing rather than incidental, each carried
 * over from the copies this replaces:
 *
 * 1. **Focus the container, not its first field.** Landing on a `<select>`
 *    lets a stray arrow key change the DevExpress version before the user has
 *    read which one it is on. `tabIndex={-1}` on the container is what makes
 *    `node.focus()` work, so a caller that forgets it gets no focus at all.
 * 2. **The focusable list is recomputed on every keystroke, not cached.** The
 *    config dialog's vault section appears and disappears, and its Clear
 *    button only exists once there is a key to clear. A list captured on open
 *    would cycle through buttons that are no longer there.
 * 3. **`offsetParent !== null` is the visibility filter.** It excludes
 *    `display: none` subtrees, which is what a collapsed section is here.
 *    Note it also excludes `position: fixed` elements — no modal in this app
 *    has one inside it, and if one ever does, this is the line to revisit.
 *
 * `onClose` is held in a ref and refreshed on every render, so the effect does
 * not resubscribe when the callback identity changes — a caller passing an
 * inline arrow function stays correct without needing `useCallback`.
 *
 * @param ref     the dialog container. Needs `tabIndex={-1}` to be focusable.
 * @param onClose invoked on Escape.
 * @param active  whether the trap is armed. Pass `false` for a dialog that
 *                stays mounted while closed; omit it for one that unmounts.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  active = true,
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return;

    const node = ref.current;
    const returnFocusTo = document.activeElement as HTMLElement | null;
    node?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;

      const focusable = Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Back to the control that opened it, not to nowhere.
      returnFocusTo?.focus?.();
    };
    // `ref` is a stable ref object; `closeRef` is refreshed per render above.
  }, [active, ref]);
}
