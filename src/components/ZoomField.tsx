/**
 * The zoom at the bench's corner (2026-11-06): the percentage the Preview is
 * drawn at, as a field. Click it and type a size, 150 or 150%, then Enter
 * (the owner's request); ↑ and ↓ step by ten; Escape puts it back. While it
 * has focus, Stitch's zoom menu opens above it: 100% (⇧0), Fit (⇧1) and,
 * with controls selected, Selection (⇧2). Sizes run from 10% to 400%. App
 * turns a percentage into the zoom over the fit (`zoomPreview`).
 */
import { useRef, useState } from 'react';
import './overlays.css';

export const MIN_PERCENT = 10;
export const MAX_PERCENT = 400;

/** A typed size as a whole percentage inside the limits, or null when it is not a number. */
export function readPercent(text: string): number | null {
  const n = Number(text.replace(/%/g, '').trim());
  if (!text.trim() || !Number.isFinite(n) || n <= 0) return null;
  return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, Math.round(n)));
}

interface Props {
  percent: number;
  onSet: (percent: number) => void;
  onFit: () => void;
  onSelection?: () => void;
  mac: boolean;
}

export default function ZoomField({ percent, onSet, onFit, onSelection, mac }: Props) {
  const [draft, setDraftState] = useState<string | null>(null);
  // Read by the blur, which a choice from the menu causes: the choice clears
  // it first, so the blur cannot apply the typed size over the one chosen.
  const draftRef = useRef<string | null>(null);
  const setDraft = (value: string | null) => {
    draftRef.current = value;
    setDraftState(value);
  };
  const shift = mac ? '⇧' : 'Shift+';
  const apply = () => {
    const value = draftRef.current === null ? null : readPercent(draftRef.current);
    if (value !== null && value !== percent) onSet(value);
    setDraft(null);
  };
  const choose = (run: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    setDraft(null);
    run();
    (document.activeElement as HTMLElement | null)?.blur();
  };
  return (
    <span className="wb-zoom">
      <input
        className="wb-corner-zoom"
        aria-label="Zoom, in percent"
        title="Type a size, or choose one"
        inputMode="numeric"
        value={draft ?? `${percent}%`}
        onFocus={(e) => {
          setDraft(String(percent));
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') {
            e.preventDefault();
            const field = e.currentTarget;
            setDraft(null);
            requestAnimationFrame(() => field.blur());
          }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const now = readPercent(draft ?? '') ?? percent;
            const next = Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, now + (e.key === 'ArrowUp' ? 10 : -10)));
            setDraft(String(next));
            onSet(next);
          }
          e.stopPropagation();
        }}
      />
      {/* Choices for the pointer while the field is typed in; the keyboard has
          their shortcuts, which each states (2026-11-06, the workspace audit):
          it said role="menu" and no key could reach its items, the field
          losing focus, and the menu with it, on Tab. */}
      {draft !== null && (
        <span className="wb-zoom-menu" role="group" aria-label="Zoom to">
          <button type="button" tabIndex={-1} aria-keyshortcuts="Shift+0" onMouseDown={choose(() => onSet(100))}><span>100%</span><kbd>{shift}0</kbd></button>
          <button type="button" tabIndex={-1} aria-keyshortcuts="Shift+1" onMouseDown={choose(onFit)}><span>Fit</span><kbd>{shift}1</kbd></button>
          {onSelection && <button type="button" tabIndex={-1} aria-keyshortcuts="Shift+2" onMouseDown={choose(onSelection)}><span>Selection</span><kbd>{shift}2</kbd></button>}
        </span>
      )}
    </span>
  );
}
