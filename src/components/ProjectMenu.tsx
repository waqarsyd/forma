/**
 * What can be done to the open project, from its title (2026-11-06), as
 * Google Stitch's main menu offers Duplicate, Download and Delete beside its
 * project's name: Rename in place, Duplicate, Download the .repx, and Delete,
 * which asks once in the menu itself before it does anything. Rename,
 * Duplicate and Delete need a saved project, since they act on what is kept;
 * App passes them only then. Escape or a click elsewhere closes it. See *The
 * conversation floats over the report* in docs/notes/app-shell.md.
 */
import { useEffect, useRef, useState } from 'react';
import './overlays.css';
import { useLayer } from './useLayer';

interface Props {
  name: string;
  onRename?: (name: string) => void;
  onDuplicate?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

export default function ProjectMenu({ name, onRename, onDuplicate, onDownload, onDelete, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && !(e.target as Element | null)?.closest?.('[data-project-toggle]')) onClose();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [onClose]);
  useLayer(onClose, true, 'project');
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
      <button type="button" role="menuitem" disabled={!onDownload} onClick={onDownload ? run(onDownload) : undefined}>Download the .repx</button>
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
