/**
 * Every keyboard shortcut of the workspace, by group (2026-11-05), as Google
 * Stitch's Shortcut Keys dialog lists its own: opened by "?" (outside a
 * field), from the command menu and from the corner's help. Written for a
 * Mac with ⌘ and for a PC with Ctrl. The keys themselves are read in
 * `lib/shortcuts.ts`, `lib/sidebar.ts`, the Preview and the box; this is
 * their one list, so a new shortcut is a new row here too.
 */
import { useEffect } from 'react';
import './overlays.css';
import { IconClose } from './landing/icons';

type Row = [label: string, keys: string[]];

export function shortcutGroups(mac: boolean): { title: string; rows: Row[] }[] {
  const mod = mac ? '⌘' : 'Ctrl';
  return [
    {
      title: 'General',
      rows: [
        ['Command menu', [mod, 'K']],
        ['Keyboard shortcuts', ['?']],
        ['New report', [mod, '⇧', 'O']],
        ['Show or hide the sidebar', [mod, 'B']],
        ['Clean screen', [mod, '\\']],
      ],
    },
    {
      title: 'The box',
      rows: [
        ['Cursor to the box', ['⇧', 'Esc']],
        ['Send', ['Enter']],
        ['New line', ['⇧', 'Enter']],
        ['Your earlier messages', ['↑']],
        ['Copy the last reply', [mod, '⇧', 'C']],
      ],
    },
    {
      title: 'Edit',
      rows: [
        ['Undo', [mod, 'Z']],
        ['Redo', [mod, '⇧', 'Z']],
        ['Select more', ['⇧', 'Click']],
        ['Nudge the selection', ['↑ ↓ ← →']],
        ['Delete the selection', ['Delete']],
        ['Retype a label or a cell', ['Double-click']],
      ],
    },
    {
      title: 'View',
      rows: [
        ['Zoom in', ['+']],
        ['Zoom out', ['−']],
        ['Zoom to 100%', ['⇧', '0']],
        ['Zoom to fit', ['⇧', '1']],
        ['Zoom to the selection', ['⇧', '2']],
      ],
    },
  ];
}

export default function ShortcutsDialog({ onClose, mac }: { onClose: () => void; mac: boolean }) {
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  return (
    <div className="wb-cmd-backdrop wb-cmd-backdrop--centre" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wb-keys" role="dialog" aria-modal="true" aria-labelledby="wb-keys-title">
        <div className="wb-keys-head">
          <h2 id="wb-keys-title">Keyboard shortcuts</h2>
          <button type="button" className="wb-pill wb-pill--round" aria-label="Close" onClick={onClose} autoFocus>
            <IconClose size={16} />
          </button>
        </div>
        <div className="wb-keys-body">
          {shortcutGroups(mac).map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.rows.map(([label, keys]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
