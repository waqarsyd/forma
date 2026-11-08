/**
 * The box's "+" and "/" menus (2026-11-08), as Google Stitch's box has them
 * since it changed: "+" for what to bring (files, a starting point) and "/"
 * for Tools, which for Forma are the things people ask of a report (see
 * lib/boxTools.ts). Each opens upward from its button, takes the arrow keys
 * as every menu here does (useMenuKeys), and closes on Escape, a click
 * elsewhere or a choice.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { BOX_TOOLS, type BoxTool } from '../lib/boxTools';
import type { StartingPoint } from '../lib/startingPoints';
import './overlays.css';
import { useLayer } from './useLayer';
import { useMenuKeys } from './useMenuKeys';

/** Closes a menu on a pointer press outside it and its button. */
function useOutside(box: RefObject<HTMLElement | null>, toggle: string, onClose: () => void) {
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!box.current?.contains(target as Node) && !target?.closest?.(`[data-menu-toggle="${toggle}"]`)) onClose();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [box, toggle, onClose]);
}

export function ToolsMenu({ hasReport, onPick, onClose }: { hasReport: boolean; onPick: (tool: BoxTool) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useOutside(box, 'tools', onClose);
  useLayer(onClose, true, 'box-tools');
  useMenuKeys(box, true);
  return (
    <div className="wb-box-menu" ref={box} role="menu" aria-label="Tools">
      {BOX_TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          role="menuitem"
          disabled={tool.needsReport && !hasReport}
          onClick={() => {
            onClose();
            onPick(tool);
          }}
        >
          <span>{tool.label}</span>
          <small>{tool.needsReport && !hasReport ? 'With a report open' : tool.note}</small>
        </button>
      ))}
    </div>
  );
}

export function PlusMenu({ onUpload, onStart, onClose }: { onUpload: () => void; onStart: (point: StartingPoint) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  /* The starting points load with the menu, not with the box: six
     descriptions are three kilobytes nobody needs until they look. */
  const [points, setPoints] = useState<readonly StartingPoint[]>([]);
  useEffect(() => {
    let live = true;
    void import('../lib/startingPoints').then((m) => live && setPoints(m.STARTING_POINTS));
    return () => {
      live = false;
    };
  }, []);
  useOutside(box, 'plus', onClose);
  useLayer(onClose, true, 'box-plus');
  useMenuKeys(box, points.length > 0);
  return (
    <div className="wb-box-menu" ref={box} role="menu" aria-label="Add">
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onUpload();
        }}
      >
        <span>Upload files</span>
        <small>A picture, a scan, a PDF, a .repx or a data file</small>
      </button>
      {points.length > 0 && <p className="wb-box-menu-head">Start from an example</p>}
      {points.map((point) => (
        <button
          key={point.id}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            onStart(point);
          }}
        >
          <span>{point.title}</span>
          <small>{point.gist}</small>
        </button>
      ))}
    </div>
  );
}
