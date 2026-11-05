/**
 * The toolbar over a selection on Preview (2026-11-05), as Google Stitch
 * shows one at the top centre of its canvas when a screen is selected
 * (Generate, Modify, Preview, More). Forma's acts on the controls selected:
 * Format (bold, italic, larger, smaller, the three alignments), Edit text,
 * which puts "Change the text of …" in the box for Forma, and More (copy
 * the names, delete, clear the selection). It takes the place of the pane
 * switcher in the bench's bar while something is selected, as the study the
 * owner approved proposed. App makes the edits; see `formatEdits` in
 * lib/agentEdit.ts and *The conversation floats over the report* in
 * docs/notes/app-shell.md.
 */
import { useEffect, useRef, useState } from 'react';
import type { FormatAction } from '../lib/agentEdit';
import { IconChevronDown, IconPencil, IconTarget } from './landing/icons';

export interface SelectionToolbarProps {
  names: readonly string[];
  onFormat: (action: FormatAction) => void;
  /** Absent for several controls: retyping is one control's. */
  onEditText?: () => void;
  onDelete: () => void;
  onClear: () => void;
}

const FORMAT: { action: FormatAction; label: string }[] = [
  { action: 'bold', label: 'Bold' },
  { action: 'italic', label: 'Italic' },
  { action: 'larger', label: 'Two points larger' },
  { action: 'smaller', label: 'Two points smaller' },
  { action: 'left', label: 'Align left' },
  { action: 'center', label: 'Centre' },
  { action: 'right', label: 'Align right' },
];

export default function SelectionToolbar({ names, onFormat, onEditText, onDelete, onClear }: SelectionToolbarProps) {
  const [menu, setMenu] = useState<'format' | 'more' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [menu]);
  const pick = (run: () => void) => {
    setMenu(null);
    run();
  };
  return (
    <div className="wb-ctx" role="toolbar" aria-label="The selected controls" ref={ref}>
      <span className="wb-ctx-what" title={names.join(', ')}>
        <IconTarget size={12} />
        {names.length === 1 ? names[0] : `${names.length} controls`}
      </span>
      <button type="button" aria-haspopup="menu" aria-expanded={menu === 'format'} onClick={() => setMenu((m) => (m === 'format' ? null : 'format'))}>
        Format <IconChevronDown size={12} />
      </button>
      {onEditText && (
        <button type="button" onClick={onEditText} title="Ask Forma for new words in this control">
          <IconPencil size={13} /> Edit text
        </button>
      )}
      <button type="button" aria-haspopup="menu" aria-expanded={menu === 'more'} onClick={() => setMenu((m) => (m === 'more' ? null : 'more'))}>
        More <IconChevronDown size={12} />
      </button>
      {menu === 'format' && (
        <div className="wb-ctx-menu" role="menu" aria-label="Format">
          {FORMAT.map((f) => (
            <button key={f.action} type="button" role="menuitem" onClick={() => pick(() => onFormat(f.action))}>
              {f.label}
            </button>
          ))}
        </div>
      )}
      {menu === 'more' && (
        <div className="wb-ctx-menu wb-ctx-menu--end" role="menu" aria-label="More">
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              pick(() => {
                navigator.clipboard?.writeText(names.join(', ')).catch(() => {});
              })
            }
          >
            {names.length === 1 ? 'Copy the name' : 'Copy the names'}
          </button>
          <button type="button" role="menuitem" onClick={() => pick(onClear)}>
            Clear the selection
          </button>
          <button type="button" role="menuitem" className="wb-danger" onClick={() => pick(onDelete)}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
