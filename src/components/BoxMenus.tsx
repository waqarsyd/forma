/**
 * The box's "/" Tools menu (2026-11-08), as Google Stitch's box has its
 * Tools since it changed: for Forma, the things people ask of a report (see
 * lib/boxTools.ts). It opens upward from its button, takes the arrow keys as
 * every menu here does (useMenuKeys), and closes on Escape, a click elsewhere
 * or a choice. A "+" menu beside it, Upload files and the starting points,
 * went the same day with the workspace's repeated options; "+" opens the
 * picker again.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { BOX_TOOLS, type BoxTool } from '../lib/boxTools';
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
