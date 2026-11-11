/**
 * The command menu (2026-11-05), Google Stitch's Ctrl+K: "Type a command…"
 * over the workspace, every action it can take in one list with its
 * shortcut beside it, narrowed as words are typed, run by Enter or a click.
 * App builds the list from what is open (the panes, the zoom, a "Go to" for
 * each control of the report and each saved project); this draws it and
 * takes the keyboard. Arrows move, Enter runs, Escape or a click outside
 * closes. See *The conversation floats over the report* in app-shell.md.
 */
import { useEffect, useRef, useState } from 'react';
import './overlays.css';
import { IconSearch } from './landing/icons';
import { useLayer } from './useLayer';
import { useReturnFocus } from './useMenuKeys';

export interface Command {
  id: string;
  label: string;
  /** The shortcut as written beside it, "Ctrl+K". */
  keys?: string;
  run: () => void;
}

/** The commands holding every word typed, in the order given. */
export function matchCommands(commands: readonly Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter((c) => words.every((w) => c.label.toLowerCase().includes(w)));
}

export default function CommandMenu({ commands, onClose }: { commands: readonly Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const shown = matchCommands(commands, query);
  // Escape closes it, and only it (lib/layers.ts); 'commands' lets Ctrl+K close it too.
  useLayer(onClose, true, 'commands');
  // Focus back to where it was when the menu opened (2026-11-06).
  const box = useRef<HTMLDivElement>(null);
  useReturnFocus(box);
  useEffect(() => setAt(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [at]);
  const run = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };
  return (
    <div className="wb-cmd-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wb-cmd" role="dialog" aria-modal="true" aria-label="Command menu" ref={box}>
        <div className="wb-cmd-search">
          <IconSearch size={16} />
          <input
            autoFocus
            value={query}
            placeholder="Type a command…"
            aria-label="Type a command"
            role="combobox"
            aria-expanded="true"
            aria-controls="wb-cmd-list"
            // Which option the arrows are on, for a screen reader (2026-11-06).
            aria-activedescendant={shown[at] ? `wb-cmd-opt-${at}` : undefined}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(shown.length - 1, i + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
              else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); run(shown[at]); }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="wb-cmd-list" id="wb-cmd-list" role="listbox" aria-label="Commands" ref={listRef}>
          {/* Keyed by place as well as id (2026-11-11, the full audit's WS-31):
              App gave two commands the id 'search', and React drew one row
              for both, so "Search the conversation" ran the projects' search. */}
          {shown.map((c, i) => (
            <li key={`${i}:${c.id}`} id={`wb-cmd-opt-${i}`} role="option" aria-selected={i === at} onMouseEnter={() => setAt(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => run(c)}>
              <span>{c.label}</span>
              {c.keys && <kbd>{c.keys}</kbd>}
            </li>
          ))}
          {shown.length === 0 && <li className="wb-cmd-none">No command holds that.</li>}
        </ul>
      </div>
    </div>
  );
}
