import { useEffect, useState, type RefObject } from 'react';

/**
 * What a menu owes a keyboard (2026-11-06, the workspace audit): the menus
 * that said role="menu" (the project's, the selection toolbar's, the model's,
 * the account's) took no arrow keys and put focus nowhere, and none gave it
 * back to the button that opened it when they closed.
 *
 * While `active`: focus goes to the first item as it opens, ↓ and ↑ move
 * between the items (round the ends), Home and End go to the ends, and when
 * it closes focus goes back to what had it before, unless the person put it
 * somewhere else on purpose, such as a click on another control.
 */
export function useMenuKeys(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const opener = document.activeElement as HTMLElement | null;
    const items = () =>
      [...node.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')].filter(
        (el) => !(el as HTMLButtonElement).disabled,
      );
    items()[0]?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      const all = items();
      if (!all.length) return;
      const at = all.indexOf(document.activeElement as HTMLElement);
      let next: number;
      if (e.key === 'ArrowDown') next = (at + 1) % all.length;
      else if (e.key === 'ArrowUp') next = (at - 1 + all.length) % all.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = all.length - 1;
      else return;
      e.preventDefault();
      all[next].focus();
    };
    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      returnFocus(opener, node);
    };
  }, [active, ref]);
}

/**
 * Focus back to what had it when an overlay opened, as it closes, for one
 * with no items to move between (the Export panel, the corner's help, the
 * command menu). For an overlay that mounts as it opens.
 */
export function useReturnFocus(ref: RefObject<HTMLElement | null>): void {
  // Read as it first renders, before a field in it takes the focus with
  // autoFocus, which happens before any effect runs.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)));
  useEffect(() => {
    const node = ref.current;
    return () => returnFocus(opener, node);
  }, [opener, ref]);
}

/** Back to the opener, if focus was left inside the overlay or dropped to the page with it. */
function returnFocus(opener: HTMLElement | null, node: HTMLElement | null): void {
  const now = document.activeElement;
  const lost = !now || now === document.body || (node !== null && node.contains(now));
  if (lost && opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
}
