/**
 * Every keyboard shortcut of the workspace, by group (2026-11-05), as Google
 * Stitch's Shortcut Keys dialog lists its own: opened by "?" (outside a
 * field), from the command menu and from the corner's help. Written for a
 * Mac with ⌘ and for a PC with Ctrl. The keys themselves are read in
 * `lib/shortcuts.ts`, `lib/sidebar.ts`, the Preview and the box; their one
 * list is `shortcutGroups` in `lib/shortcuts.ts` since 2026-11-08, which the
 * Docs page prints too, so a new shortcut is a new row there.
 */
import { useRef } from 'react';
import './overlays.css';
import { IconClose } from './landing/icons';
import { useFocusTrap } from './useFocusTrap';
import { shortcutGroups } from '../lib/shortcuts';

export default function ShortcutsDialog({ onClose, mac }: { onClose: () => void; mac: boolean }) {
  // A modal's keyboard (2026-11-06): focus in, Tab kept inside, Escape, and focus back.
  const dialog = useRef<HTMLDivElement>(null);
  useFocusTrap(dialog, onClose);
  return (
    <div className="wb-cmd-backdrop wb-cmd-backdrop--centre" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wb-keys" role="dialog" aria-modal="true" aria-labelledby="wb-keys-title" ref={dialog} tabIndex={-1}>
        <div className="wb-keys-head">
          <h2 id="wb-keys-title">Keyboard shortcuts</h2>
          <button type="button" className="wb-pill wb-pill--round" aria-label="Close" onClick={onClose}>
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
