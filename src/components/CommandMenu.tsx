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
      <div className="wb-cmd" role="dialog" aria-modal="true" aria-label="Command menu">
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
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(shown.length - 1, i + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); run(shown[at]); }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="wb-cmd-list" id="wb-cmd-list" role="listbox" aria-label="Commands" ref={listRef}>
          {shown.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === at} onMouseEnter={() => setAt(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => run(c)}>
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
