/**
 * The Preview's tools at the bench's right edge (2026-11-08), as Stitch's
 * rail: Select (V) and Mark an area (M), and since 2026-11-11 (the full
 * audit's CP-03) Compare with the original (O), which draws the page the
 * report was made from under the Preview's page, with a slider for how much
 * of it shows (ReportPreview's `compareWith`). Only on the Preview, the one
 * pane where a control can be picked, and Compare only for a report made
 * from a picture or a PDF.
 *
 * Moved out of App.tsx the same day, lazily, so the third button cost the
 * App chunk nothing (its budget is at 99%).
 */
import { IconMarquee, IconPointer } from './landing/icons';

export type PreviewTool = 'select' | 'mark' | 'compare';

interface Props {
  tool: PreviewTool;
  onTool: (tool: PreviewTool) => void;
  /** Whether the open report has an original to compare with. */
  canCompare: boolean;
}

/** Two sheets offset, the second drawn over the first: the report over its original. */
const IconCompare = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="3.5" y="3.5" width="11" height="14" rx="1" />
    <path d="M9.5 20.5h10a1 1 0 0 0 1-1v-12a1 1 0 0 0-1-1h-2" strokeDasharray="2 2" />
    <path d="M12 2v20" />
  </svg>
);

export default function PreviewRail({ tool, onTool, canCompare }: Props) {
  return (
    <div className="wb-float wb-float-rail" role="toolbar" aria-label="Preview tools" aria-orientation="vertical">
      <button type="button" aria-label="Select" title="Select (V)" aria-pressed={tool === 'select'} onClick={() => onTool('select')}>
        <IconPointer size={16} />
      </button>
      <button
        type="button"
        aria-label="Mark an area"
        title="Mark an area (M): drag over the report to select everything in it"
        aria-pressed={tool === 'mark'}
        onClick={() => onTool(tool === 'mark' ? 'select' : 'mark')}
      >
        <IconMarquee size={16} />
      </button>
      {canCompare && (
        <button
          type="button"
          aria-label="Compare with the original"
          title="Compare with the original (O): the page it was made from, under the report"
          aria-pressed={tool === 'compare'}
          onClick={() => onTool(tool === 'compare' ? 'select' : 'compare')}
        >
          <IconCompare />
        </button>
      )}
      {/* Upload files stood here for a day (2026-11-08), a repeat of the
          box's "+", and went with the workspace's other repeats. */}
    </div>
  );
}
