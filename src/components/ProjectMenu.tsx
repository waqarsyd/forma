/**
 * What can be done to the open project, from its title (2026-11-06), as
 * Google Stitch's main menu offers Duplicate and Delete beside its project's
 * name: Rename in place, Duplicate, Archive, and Delete, which asks once in
 * the menu itself before it does anything. They act on what is kept, so App
 * opens the menu only for a saved project. Download the .repx left it in the
 * workspace audit of the same day, being the Export panel's first row, and
 * Archive joined it, which only the projects list offered. Escape or a click
 * elsewhere closes it. See *The conversation floats over the report* in
 * docs/notes/app-shell.md.
 */
import { useEffect, useRef, useState } from 'react';
import './overlays.css';
import { useLayer } from './useLayer';
import { useMenuKeys } from './useMenuKeys';

interface Props {
  name: string;
  onRename?: (name: string) => void;
  onDuplicate?: () => void;
  /** Archive or bring back; `archived` says which this is. */
  onArchive?: () => void;
  archived?: boolean;
  onDelete?: () => void;
  onClose: () => void;
  /** Opened at Rename's field, or at Delete's question, as Ctrl+K's "Rename…" and "Delete…" open it (2026-11-06). */
  start?: 'rename' | 'delete';
}

export default function ProjectMenu({ name, onRename, onDuplicate, onArchive, archived = false, onDelete, onClose, start }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState<string | null>(start === 'rename' && onRename ? name : null);
  const [confirming, setConfirming] = useState(start === 'delete' && !!onDelete);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && !(e.target as Element | null)?.closest?.('[data-project-toggle]')) onClose();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [onClose]);
  useLayer(onClose, true, 'project');
  // Its keys, and focus back to the title (2026-11-06); not while a field is open in it.
  useMenuKeys(box, renaming === null && !confirming);
  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  return (
    <div className="wb-project-menu" ref={box} role="menu" aria-label="Project">
      {renaming !== null && onRename ? (
        <form
          className="wb-project-rename"
          onSubmit={(e) => {
            e.preventDefault();
            const typed = renaming.trim();
            onClose();
            if (typed && typed !== name) onRename(typed);
          }}
        >
          <input autoFocus aria-label="Project name" value={renaming} maxLength={120} onChange={(e) => setRenaming(e.target.value)} onFocus={(e) => e.target.select()} />
          <button type="submit">Rename</button>
        </form>
      ) : (
        <button type="button" role="menuitem" disabled={!onRename} onClick={() => setRenaming(name)}>Rename</button>
      )}
      <button type="button" role="menuitem" disabled={!onDuplicate} onClick={onDuplicate ? run(onDuplicate) : undefined}>Duplicate</button>
      <button type="button" role="menuitem" disabled={!onArchive} onClick={onArchive ? run(onArchive) : undefined}>{archived ? 'Bring back from the archive' : 'Archive'}</button>
      {confirming && onDelete ? (
        <div className="wb-project-confirm" role="group" aria-label="Delete this project?">
          <span>Delete this project?</span>
          <button type="button" className="is-danger" onClick={run(onDelete)}>Delete</button>
          <button type="button" onClick={() => setConfirming(false)}>Keep</button>
        </div>
      ) : (
        <button type="button" role="menuitem" className="is-danger" disabled={!onDelete} onClick={() => setConfirming(true)}>Delete</button>
      )}
      {!onRename && <p className="wb-project-note">Saved projects can be renamed, duplicated and deleted.</p>}
    </div>
  );
}
