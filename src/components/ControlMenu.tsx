/**
 * The menu a right-click opens on a control in the Preview (2026-11-05), as
 * Google Stitch's opens on a screen: what can be done to the selection, each
 * with its shortcut, and a submenu (Format) that opens beside its row. Drawn
 * at the pointer in a portal into the workspace's root, kept inside the
 * window, and closed by Escape,
 * a click elsewhere, the wheel or choosing an item. Arrows move between rows;
 * the right arrow opens a submenu and the left closes it. ReportPreview
 * decides the items; this only draws them.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './overlays.css';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  keys?: string;
  run?: () => void;
  sub?: MenuItem[];
  danger?: boolean;
  /** A rule above this row. */
  divide?: boolean;
}

function MenuList({ items, onDone, label, autoFocus, onBack }: { items: MenuItem[]; onDone: () => void; label: string; autoFocus?: boolean; onBack?: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [autoFocus]);
  const move = (from: HTMLElement, by: number) => {
    const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>(':scope > li > button') ?? [])];
    const at = all.indexOf(from as HTMLButtonElement);
    all[(at + by + all.length) % all.length]?.focus();
  };
  return (
    <ul className="wb-cmenu" role="menu" aria-label={label} ref={ref}>
      {items.map((item, i) => (
        <li key={item.label} role="none" className={item.divide ? 'wb-cmenu-divide' : undefined} onMouseEnter={() => setOpen(item.sub ? i : null)}>
          <button
            type="button"
            role="menuitem"
            aria-haspopup={item.sub ? 'menu' : undefined}
            aria-expanded={item.sub ? open === i : undefined}
            className={item.danger ? 'is-danger' : undefined}
            onClick={() => {
              if (item.sub) { setOpen(open === i ? null : i); return; }
              onDone();
              item.run?.();
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); move(e.currentTarget, 1); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); move(e.currentTarget, -1); }
              else if (e.key === 'ArrowRight' && item.sub) { e.preventDefault(); setOpen(i); }
              else if (e.key === 'ArrowLeft' && onBack) { e.preventDefault(); onBack(); }
            }}
          >
            <span>{item.label}</span>
            {item.keys && <kbd>{item.keys}</kbd>}
            {item.sub && <span aria-hidden className="wb-cmenu-more">›</span>}
          </button>
          {item.sub && open === i && (
            <div className="wb-cmenu-sub">
              <MenuList items={item.sub} onDone={onDone} label={item.label} autoFocus onBack={() => { setOpen(null); ref.current?.querySelectorAll<HTMLButtonElement>(':scope > li > button')[i]?.focus(); }} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function ControlMenu({ x, y, items, onClose, label = 'Control' }: { x: number; y: number; items: MenuItem[]; onClose: () => void; label?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setAt({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
  }, [x, y]);
  useEffect(() => {
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    // The wheel, not `scroll`: the selection that opening the menu makes moves
    // the layout, and a scroll event from that closed the menu as it opened.
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
    document.addEventListener('wheel', away, { capture: true, passive: true });
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('wheel', away, { capture: true });
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  return createPortal(
    <div ref={box} className="wb-cmenu-host" style={{ left: at.left, top: at.top }} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={items} onDone={onClose} label={label} autoFocus />
    </div>,
    // Inside the workspace's root, whose tokens (--panel, --rule, --ink) the
    // menu is drawn in; on the body they are undefined and it drew unstyled.
    document.querySelector('.wb-root') ?? document.body,
  );
}
