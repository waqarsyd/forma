/**
 * The toolbar over a selection on Preview (2026-11-05), as Google Stitch
 * shows one at the top centre of its canvas when a screen is selected
 * (Generate, Modify, Preview, More). Forma's acts on the controls selected:
 * Format (bold, italic, larger, smaller, the three alignments), Edit text,
 * which puts "Change the text of …" in the box for Forma, and More (copy
 * the names, delete, clear the selection). The Preview draws it, floating
 * over the top of the report (2026-11-06, the owner's choice in the
 * workspace audit): it took the place of the pane switcher in the bench's
 * bar until then, which hid the panes while something was selected and
 * wrapped the bar onto two lines, moving the page under the pointer. Copy
 * and Delete are the Preview's own, by the selection itself, as its menu's
 * and the Delete key's are; Format and Edit text are App's (`formatEdits`
 * in lib/agentEdit.ts). See *The conversation floats over the report* in
 * docs/notes/app-shell.md.
 */
import { useEffect, useRef, useState } from 'react';
import './overlays.css';
import type { FormatAction } from '../lib/agentEdit';
import { IconChevronDown, IconPencil, IconTarget } from './landing/icons';
import { useLayer } from './useLayer';

export interface SelectionToolbarProps {
  /** What it calls each selected control: its name, or its type when it has none. */
  names: readonly string[];
  onFormat: (action: FormatAction) => void;
  /** Absent for several controls: retyping is one control's. */
  onEditText?: () => void;
  /** Absent when no selected control has a name to copy. */
  onCopy?: () => void;
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

export default function SelectionToolbar({ names, onFormat, onEditText, onCopy, onDelete, onClear }: SelectionToolbarProps) {
  const [menu, setMenu] = useState<'format' | 'more' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [menu]);
  // Escape closes the open menu and leaves the selection (lib/layers.ts).
  useLayer(() => setMenu(null), menu !== null, 'selection-menu');
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
          {onCopy && (
            <button type="button" role="menuitem" onClick={() => pick(onCopy)}>
              {names.length === 1 ? 'Copy the name' : 'Copy the names'}
            </button>
          )}
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
