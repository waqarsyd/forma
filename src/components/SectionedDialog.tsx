/**
 * The frame Settings and the account dialog share since 2026-11-07, as
 * ChatGPT's Settings: a list of sections on the left, one section at a time
 * on the right under its name, a Close at the top and no footer. What a
 * section holds is the caller's; what both owe a keyboard is here: focus in
 * on open and back on close, Tab kept inside and Escape (useFocusTrap), and
 * the sections as a tab list with the arrows, Home and End.
 *
 * Extracted when the second dialog took this shape, so that the two cannot
 * drift apart, which is what the config and account dialogs' focus traps
 * had started to do before useFocusTrap (2026-08-28).
 */
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { IconClose } from './landing/icons';
import { useFocusTrap } from './useFocusTrap';
import './overlays.css';
import './dialogs.css';

export interface DialogSection<T extends string> {
  id: T;
  label: string;
  Icon: (p: { size?: number }) => ReactNode;
}

export interface SectionedDialogProps<T extends string> {
  title: string;
  sections: readonly DialogSection<T>[];
  section: T;
  onSection: (id: T) => void;
  onClose: () => void;
  children: ReactNode;
}

export default function SectionedDialog<T extends string>({ title, sections, section, onSection, onClose, children }: SectionedDialogProps<T>) {
  const id = useId();
  const dialog = useRef<HTMLElement>(null);
  useFocusTrap(dialog, onClose);

  // Up and down here, left and right where the list runs across a phone.
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = sections.findIndex((s) => s.id === section);
    const by = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? sections.length - 1 : by ? (at + by + sections.length) % sections.length : -1;
    if (next < 0) return;
    e.preventDefault();
    onSection(sections[next].id);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  const current = sections.find((s) => s.id === section) ?? sections[0];
  return (
    <div className="wb-cmd-backdrop wb-cmd-backdrop--centre" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="wb-set" role="dialog" aria-modal="true" aria-labelledby={`${id}title`} ref={dialog} tabIndex={-1}>
        <nav className="wb-set-nav" aria-label={title}>
          <div className="wb-set-head">
            <h2 id={`${id}title`}>{title}</h2>
            <button type="button" className="wb-set-close" aria-label="Close" onClick={onClose}>
              <IconClose size={15} />
            </button>
          </div>
          <div className="wb-set-tabs" role="tablist" aria-label="Sections" onKeyDown={move}>
            {sections.map(({ id: sid, label, Icon }) => (
              <button
                key={sid}
                type="button"
                role="tab"
                id={`${id}tab-${sid}`}
                aria-selected={current.id === sid}
                aria-controls={`${id}panel`}
                tabIndex={current.id === sid ? 0 : -1}
                className="wb-set-tab"
                onClick={() => onSection(sid)}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* Keyed by the section, so a new one starts at its top. */}
        <div key={current.id} className="wb-set-pane" role="tabpanel" id={`${id}panel`} aria-labelledby={`${id}tab-${current.id}`}>
          <h3>{current.label}</h3>
          {children}
        </div>
      </section>
    </div>
  );
}
