/**
 * The report as it prints: paginated, at real size, from the exported REPX.
 *
 * The Mockup pane draws `layout.sections` stacked into one tall sheet — a
 * picture of the uploaded document, which is the right thing for checking
 * fidelity. This pane draws the *other* artifact. It reads `repxContent`
 * through `lib/reportPreview.ts`, applies the band rules (Detail once per
 * record, PageHeader on every sheet, ReportFooter after the last row) and lays
 * the result out across real pages.
 *
 * Two things follow from that choice, and both are the point:
 *
 * - It checks the file the user actually downloads. Until now nothing did. A
 *   report whose Detail band is the height of the page looks perfect in the
 *   mockup and shows itself here immediately — one record fills a sheet.
 * - It needs no data source. The record count comes from the rows the model
 *   already read out of the user's own document, so the preview repeats the
 *   band over their data rather than over invented placeholders.
 *
 * ## Why printing is the PDF export
 *
 * Everything here is laid out in CSS `px` at 96/inch and font sizes in `pt`,
 * which is what the file itself declares. That makes the on-screen page
 * physically correct, so `window.print()` produces a true-to-size PDF with
 * selectable text, real fonts and vector rules — better output than a canvas
 * rasteriser would give, with no dependency added to a bundle that is already
 * budgeted. The screen-only chrome (band labels, page captions) is hidden by
 * the print rules below, and `@page` is emitted from the report's own
 * dimensions so the paper matches the design rather than the browser default.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  parseReportStructure,
  paginate,
  recordCountFromLayout,
  type PreviewControl,
  type PaginatedReport,
} from '../lib/reportPreview';
import { parseParameters } from '../lib/repxParameters';
import { unitsToPx, pxToUnits, unitsPerInch } from '../lib/reportGeometry';
import { moveControl, resizeControl, setControlText, overflowsBand, type ControlRef } from '../lib/repxEdit';
import type { ReportLayout } from '../lib/reportTypes';

interface Props {
  repxContent?: string;
  layout?: ReportLayout | null;
  /** Shown in the print header line and used for the suggested file name. */
  title?: string;
  /**
   * Supplied to make the pane editable. Without it the preview is read-only,
   * which is what the print portal wants and what a loaded report gets before
   * anything is selected.
   */
  onEdit?: (xml: string, reason: string) => void;
}

/**
 * A drag in progress. Null between gestures.
 *
 * `baseXml` and the origin geometry are captured once, at pointerdown, and
 * every move recomputes from them rather than applying a delta to the previous
 * frame. Incremental application accumulates rounding — each move rounds to a
 * whole report unit — so a slow drag across the page would land somewhere other
 * than the pointer. It also keeps undo to one entry per gesture instead of one
 * per mouse move.
 */
type Gesture = {
  ref: ControlRef;
  mode: 'move' | 'resize';
  baseXml: string;
  /** Pointer position when the gesture began, in client px. */
  fromX: number;
  fromY: number;
  /** The control's geometry when the gesture began, in report units. */
  originX: number;
  originY: number;
  originW: number;
  originH: number;
} | null;

/** Bands the reader should be able to tell apart on screen. */
const BAND_TINT: Record<string, string> = {
  ReportHeader: 'rgba(226, 89, 12, .05)',
  PageHeader: 'rgba(59, 90, 140, .05)',
  Detail: 'transparent',
  GroupHeader: 'rgba(59, 90, 140, .04)',
  GroupFooter: 'rgba(59, 90, 140, .04)',
  ReportFooter: 'rgba(226, 89, 12, .05)',
  PageFooter: 'rgba(59, 90, 140, .05)',
};

function ControlBox({
  control,
  unit,
  pageNumber,
  pageCount,
}: {
  control: PreviewControl;
  unit: string;
  pageNumber: number;
  pageCount: number;
}) {
  const u = (n: number) => unitsToPx(n, unit);
  const justify =
    control.align === 'right' ? 'flex-end' : control.align === 'center' ? 'center' : 'flex-start';
  const alignItems =
    control.vAlign === 'bottom' ? 'flex-end' : control.vAlign === 'middle' ? 'center' : 'flex-start';

  const frame: React.CSSProperties = {
    position: 'absolute',
    // Plus the containing panel's position, which is 0 for everything that is
    // not inside one. A panel's children are stored panel-relative because that
    // is what the file says and what an edit writes back -- see PreviewControl.
    left: u(control.x + control.offsetX),
    top: u(control.y + control.offsetY),
    width: u(control.width),
    height: u(control.height),
    display: 'flex',
    alignItems,
    justifyContent: justify,
    // Font size is in points in the file and `pt` is a real CSS unit, so this
    // is correct on screen and on paper without a conversion of our own.
    fontSize: control.fontSize ? `${control.fontSize}pt` : '9pt',
    fontFamily: control.fontFamily ? `${control.fontFamily}, sans-serif` : 'inherit',
    fontWeight: control.bold ? 700 : 400,
    fontStyle: control.italic ? 'italic' : 'normal',
    borderTop: control.borders.top ? '1px solid #111' : undefined,
    borderRight: control.borders.right ? '1px solid #111' : undefined,
    borderBottom: control.borders.bottom ? '1px solid #111' : undefined,
    borderLeft: control.borders.left ? '1px solid #111' : undefined,
    overflow: 'hidden',
  };

  if (control.type === 'XRLine') {
    return <div style={{ ...frame, borderTop: '1px solid #111', height: Math.max(1, u(control.height)) }} />;
  }

  if (control.type === 'XRPageInfo') {
    // The file says which of the eight PageInfo values it wants; the useful one
    // to show here is the page position, which is also the one most often
    // dropped on load because the enum was invented (see repxAudit).
    return <div style={frame}>{`${pageNumber} / ${pageCount}`}</div>;
  }

  if (control.type === 'XRPictureBox') {
    return (
      <div style={{ ...frame, border: '1px dashed #999', color: '#777', fontSize: '7pt', justifyContent: 'center' }}>
        image
      </div>
    );
  }

  if (control.type === 'XRBarCode') {
    return (
      <div style={{ ...frame, gap: 1, alignItems: 'stretch', justifyContent: 'center' }}>
        {Array.from({ length: 28 }, (_, i) => (
          <span key={i} style={{ width: i % 3 === 0 ? 2 : 1, background: '#111' }} />
        ))}
      </div>
    );
  }

  /*
   * A character comb draws one box per character, which is the whole point of
   * it being one. Drawn from the text the file carries, so an empty or bound
   * comb shows its boxes rather than nothing — the boxes ARE the content on a
   * blank form, and a form control that renders as empty space here would look
   * like a control that got lost.
   */
  if (control.type === 'XRCharacterComb') {
    const characters = control.text ? [...control.text] : new Array(8).fill('');
    return (
      <div style={{ ...frame, gap: 2, alignItems: 'center', justifyContent: 'flex-start' }}>
        {characters.map((character, i) => (
          <span
            key={i}
            style={{
              border: '1px solid currentColor',
              minWidth: '1.1em',
              textAlign: 'center',
              lineHeight: 1.3,
              flex: '0 0 auto',
            }}
          >
            {character || ' '}
          </span>
        ))}
      </div>
    );
  }

  /*
   * A gauge and a sparkline, drawn as their SETTINGS rather than as data —
   * the same decision as charts and cross-tabs, and for the same reason: the
   * preview has no data source, so a needle at an invented position on a page
   * someone is checking for accuracy is worse than no needle.
   *
   * What IS knowable is the range, the value if it is a literal, and the field
   * if it is bound. That is what a reader needs to confirm, because a gauge
   * bound to the wrong field looks identical to a correct one either way.
   */
  if (control.type === 'XRGauge' && control.meter) {
    const m = control.meter;
    const circular = m.view !== 'Linear';
    const span = m.max !== null && m.min !== null ? m.max - m.min : null;
    const fraction = m.value !== null && span ? Math.max(0, Math.min(1, (m.value - (m.min ?? 0)) / span)) : null;
    return (
      <div style={{ ...frame, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        <span
          aria-hidden
          style={{
            width: circular ? Math.min(u(control.width), u(control.height)) * 0.7 : '100%',
            height: circular ? Math.min(u(control.width), u(control.height)) * 0.7 : 8,
            border: '1px solid currentColor',
            borderRadius: circular ? '50%' : 3,
            borderBottomColor: circular ? 'transparent' : undefined,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {!circular && fraction !== null && (
            <span style={{ position: 'absolute', inset: 0, width: `${fraction * 100}%`, background: 'currentColor', opacity: 0.35 }} />
          )}
        </span>
        <span style={{ fontSize: 9, opacity: 0.75, whiteSpace: 'nowrap' }}>
          {m.bound ? `[${m.bound}]` : m.value !== null ? m.value : 'no value'}
          {m.min !== null && m.max !== null ? ` of ${m.min}–${m.max}` : ''}
        </span>
      </div>
    );
  }

  if (control.type === 'XRSparkline' && control.meter) {
    return (
      <div style={{ ...frame, flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 2 }}>
        <span aria-hidden style={{ height: 1, background: 'currentColor', opacity: 0.5 }} />
        <span style={{ fontSize: 9, opacity: 0.75, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          {control.meter.field ? `${control.meter.view} of ${control.meter.field}` : `${control.meter.view} sparkline`}
        </span>
      </div>
    );
  }

  /*
   * A shape draws its figure. Ellipse is the default when the file carries no
   * <Shape> child, so an XRShape with nothing in it is a circle rather than
   * nothing — which is exactly the kind of thing that would otherwise show as a
   * blank space here and a filled ellipse in DevExpress.
   *
   * Only the three figures a report actually uses are drawn as themselves;
   * anything else falls back to a labelled outline, which is honest about not
   * knowing rather than drawing the wrong figure confidently.
   */
  if (control.type === 'XRShape') {
    const name = control.shape ?? 'Ellipse';
    const stroke = { border: '1px solid currentColor', width: '100%', height: '100%' };
    if (name === 'Ellipse') return <div style={{ ...frame }}><span style={{ ...stroke, borderRadius: '50%' }} /></div>;
    if (name === 'Rectangle') return <div style={{ ...frame }}><span style={stroke} /></div>;
    if (name === 'Line') {
      return (
        <div style={{ ...frame, alignItems: 'center' }}>
          <span style={{ width: '100%', borderTop: '1px solid currentColor' }} />
        </div>
      );
    }
    return (
      <div style={{ ...frame, alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ ...stroke, borderStyle: 'dashed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, opacity: 0.7 }}>
          {name}
        </span>
      </div>
    );
  }

  /*
   * Rich text is drawn as a marked block, not as its content.
   *
   * The content is a base64 UTF-16 RTF document (`RepxProbe emit-rich`), and
   * decoding it would mean an RTF parser for a control Forma never generates —
   * it only ever arrives inside an uploaded .repx. Showing the block is what
   * matters: the alternative is empty space where the printed report has a
   * paragraph, which reads as a control that got lost.
   */
  if (control.type === 'XRRichText') {
    return (
      <div style={{ ...frame, alignItems: 'stretch' }}>
        <span
          style={{
            width: '100%',
            border: '1px dashed currentColor',
            opacity: 0.55,
            fontSize: 9,
            padding: 2,
            overflow: 'hidden',
          }}
        >
          rich text — carried through from the source
        </span>
      </div>
    );
  }

  /*
   * A checkbox draws its own box, which is the point of it being one.
   *
   * The alternative the prompt warns against -- a label containing "X", or a
   * bordered empty label -- looks identical here, so this pane is where the
   * difference becomes visible: a real XRCheckBox renders a tick, a fake one
   * renders a letter. Unchecked is the common case and is drawn as an empty
   * box rather than as nothing, because an empty box IS the content.
   */
  if (control.type === 'XRCheckBox') {
    // Sized from the control's own height in px, clamped so a tall box does
    // not produce an absurd glyph and a short one stays visible.
    const box = Math.min(12, Math.max(8, u(control.height) * 0.6));
    return (
      <div style={{ ...frame, gap: 6, alignItems: 'center', justifyContent: 'flex-start' }}>
        <span
          aria-hidden
          style={{
            width: box,
            height: box,
            flex: `0 0 ${box}px`,
            border: '1px solid currentColor',
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: box - 2,
            lineHeight: 1,
          }}
        >
          {control.checkState === 'checked' ? '✓' : control.checkState === 'indeterminate' ? '–' : ''}
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {control.text}
        </span>
      </div>
    );
  }

  /*
   * A chart and a cross-tab are drawn as their STRUCTURE, not as invented data.
   *
   * The preview has no data source, so plotting bars would mean making numbers
   * up and showing them on a page the user is checking for accuracy. What is
   * actually knowable from the file is the shape and the binding -- a bar chart
   * of Amount by Region -- and that is the thing worth confirming, because a
   * chart bound to the wrong field looks identical to a correct one either way.
   */
  if (control.type === 'XRChart') {
    const pie = control.series.some((s) => s.view === 'PieSeriesView');
    const line = control.series.some((s) => s.view === 'LineSeriesView');
    return (
      <div style={{ ...frame, flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-end', border: '1px solid #b9c2cc', padding: 4, gap: 3 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 3, minHeight: 0 }}>
          {pie ? (
            <div style={{
              margin: 'auto', width: '46%', aspectRatio: '1', borderRadius: '50%',
              background: 'conic-gradient(#8fa6bf 0 38%, #b9c2cc 0 65%, #d7dee7 0)',
            }} />
          ) : line ? (
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
              <polyline points="2,34 22,20 42,26 62,10 82,16 98,4" fill="none" stroke="#8fa6bf" strokeWidth="2" />
            </svg>
          ) : (
            [46, 70, 34, 88, 58].map((h, i) => (
              <span key={i} style={{ flex: 1, height: `${h}%`, background: '#b9c2cc' }} />
            ))
          )}
        </div>
        {/* The binding, in words. This is the part a reader can check. */}
        <div style={{ fontSize: '6pt', color: '#5a6672', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden' }}>
          {control.series.length === 0
            ? 'chart with no series'
            : control.series.map((s) => `${s.value || '?'} by ${s.argument || '?'}`).join(' · ')}
        </div>
      </div>
    );
  }

  if (control.type === 'XRCrossTab' && control.crossTab) {
    const { rows, columns, data } = control.crossTab;
    const label = (items: string[], kind: string) => items.join(', ') || `no ${kind} field`;
    return (
      <div style={{ ...frame, flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', border: '1px solid #b9c2cc', fontSize: '6.5pt', color: '#39444f' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid #b9c2cc', background: '#f2f4f8' }}>
          <span style={{ flex: '0 0 34%', padding: '2px 4px', borderRight: '1px solid #b9c2cc' }} />
          <span style={{ flex: 1, padding: '2px 4px' }}>{label(columns, 'column')} →</span>
        </div>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <span style={{ flex: '0 0 34%', padding: '2px 4px', borderRight: '1px solid #b9c2cc', background: '#f2f4f8' }}>
            {label(rows, 'row')} ↓
          </span>
          <span style={{ flex: 1, padding: '2px 4px', color: '#5a6672' }}>
            {label(data, 'data')}
          </span>
        </div>
      </div>
    );
  }

  if (control.type === 'XRTable') {
    const rowHeight = control.rows.length ? u(control.height) / control.rows.length : u(control.height);
    return (
      <div style={{ ...frame, flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start' }}>
        {control.rows.map((row, r) => {
          // No weight total to compute: `flex: <weight> 1 0` distributes the
          // row's width in the same proportion DevExpress does, and lets the
          // browser do the division.
          return (
            <div key={r} style={{ display: 'flex', height: rowHeight, alignItems: 'stretch' }}>
              {row.cells.map((cell, c) => (
                <div
                  key={c}
                  style={{
                    // Cells are sized by relative weight, never by coordinates.
                    flex: `${cell.weight || 1} 1 0`,
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent:
                      cell.align === 'right' ? 'flex-end' : cell.align === 'center' ? 'center' : 'flex-start',
                    fontWeight: cell.bold ? 700 : undefined,
                    padding: '0 2px',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {cell.text}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  // XRLabel and anything else with text in it.
  return <div style={frame}>{control.text}</div>;
}

export default function ReportPreview({ repxContent, layout, title, onEdit }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [showBands, setShowBands] = useState(true);
  const [selected, setSelected] = useState<ControlRef | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const gesture = useRef<Gesture>(null);
  const editable = Boolean(onEdit);

  /*
   * Undo, kept here rather than in App.
   *
   * Direct manipulation without undo is a feature people are afraid to use: a
   * drag is cheap to make and, until now, impossible to take back short of
   * regenerating the whole report — which is the cost this pane exists to
   * remove. The stack holds the REPX before each edit, which is small, exact,
   * and needs no diffing.
   */
  const undoStack = useRef<{ xml: string; reason: string }[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);

  const commit = (result: { xml: string; applied: boolean; reason: string }, previous: string) => {
    if (!result.applied || !onEdit) return;
    undoStack.current.push({ xml: previous, reason: result.reason });
    setUndoDepth(undoStack.current.length);
    onEdit(result.xml, result.reason);
  };

  const undo = () => {
    const step = undoStack.current.pop();
    if (!step || !onEdit) return;
    setUndoDepth(undoStack.current.length);
    onEdit(step.xml, `undid: ${step.reason}`);
  };

  /* The structure is kept alongside the pagination because editing addresses a
     control by its index in `structure.bands`, and `paginate` reuses the very
     same band objects — so a placed band's identity finds its index. */
  const { structure, report } = useMemo(() => {
    const parsed = parseReportStructure(repxContent);
    return { structure: parsed, report: paginate(parsed, recordCountFromLayout(layout)) as PaginatedReport };
  }, [repxContent, layout]);
  const structureBands = structure.bands;
  const watermark = structure.watermark;
  // Any band declaring columns; in practice only Detail ever does.
  const multiColumn = structureBands.find((b) => b.columns && b.columns.count > 1)?.columns ?? null;
  const parameters = useMemo(() => parseParameters(repxContent), [repxContent]);

  const pageW = unitsToPx(report.page.width, report.unit);
  const pageH = unitsToPx(report.page.height, report.unit);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const available = el.clientWidth;
      if (available > 0) setScale(Math.min(1, available / pageW));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pageW]);

  const inches = (units: number) => (units / unitsPerInch(report.unit)).toFixed(2);

  /** The selected control, read out of the current parse rather than cached. */
  const selectedControl =
    selected ? structureBands[selected.band]?.controls[selected.control] ?? null : null;

  const beginGesture = (
    event: React.PointerEvent,
    ref: ControlRef,
    mode: 'move' | 'resize',
  ) => {
    if (!editable || !repxContent) return;
    const control = structureBands[ref.band]?.controls[ref.control];
    if (!control) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(ref);
    setEditingText(null);
    // One undo entry per gesture, recorded before the first frame of it.
    undoStack.current.push({ xml: repxContent, reason: mode === 'move' ? 'move' : 'resize' });
    setUndoDepth(undoStack.current.length);
    gesture.current = {
      ref,
      mode,
      baseXml: repxContent,
      fromX: event.clientX,
      fromY: event.clientY,
      originX: control.x,
      originY: control.y,
      originW: control.width,
      originH: control.height,
    };
  };

  useEffect(() => {
    if (!editable) return;
    const onMove = (event: PointerEvent) => {
      const g = gesture.current;
      if (!g || !onEdit) return;
      // Divide out the zoom first: it is a presentation scale, not a unit.
      const dx = pxToUnits((event.clientX - g.fromX) / scale, report.unit);
      const dy = pxToUnits((event.clientY - g.fromY) / scale, report.unit);
      const result =
        g.mode === 'move'
          ? moveControl(g.baseXml, g.ref, g.originX + dx, g.originY + dy)
          : resizeControl(g.baseXml, g.ref, g.originW + dx, g.originH + dy);
      if (result.applied) onEdit(result.xml, result.reason);
    };
    const onUp = () => { gesture.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [editable, onEdit, scale, report.unit]);

  useEffect(() => {
    if (!editable) return;
    const onKey = (event: KeyboardEvent) => {
      if (editingText !== null) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
        return;
      }
      if (event.key === 'Escape') { setSelected(null); return; }
      if (!selected || !selectedControl || !repxContent) return;
      const step = event.shiftKey ? 10 : 1;
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
      };
      const delta = nudge[event.key];
      if (!delta) return;
      // Arrow keys are the precision half of direct manipulation: a drag gets
      // you close, one unit at a time gets you exact.
      event.preventDefault();
      commit(
        moveControl(repxContent, selected, selectedControl.x + delta[0], selectedControl.y + delta[1]),
        repxContent,
      );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /*
   * Printing is the PDF export, and it needs the pages at true size rather than
   * scaled to the pane. `printing` swaps in an unscaled copy in a body portal,
   * prints, and clears itself on `afterprint`.
   *
   * The timeout before `print()` is not a guess dressed up as a fix: React has
   * to commit the portal before the browser snapshots the document, and
   * `window.print()` is synchronous and blocking. Without a frame in between,
   * the print dialog opens on a document that does not yet contain the pages.
   */
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add('rp-printing');
    const finish = () => setPrinting(false);
    window.addEventListener('afterprint', finish);
    let rescue = 0;
    const id = window.setTimeout(() => {
      window.print();
      /*
       * `afterprint` was the ONLY way out of this state, and it does not fire
       * everywhere. Anywhere `print()` is a no-op — headless Chrome, a kiosk
       * build, printing disabled by policy — nothing ever clears `printing`,
       * and `printing` is what holds `body.rp-printing`, which hides the whole
       * application. Measured in headless Chrome on 2026-09-08: after Export
       * PDF the workspace was 0x0 with zero reachable buttons and stayed that
       * way, so the only escape was a reload — which throws away the report
       * the user had not saved yet. A one-way door out of an unsaved document
       * is worth a belt to go with the braces.
       *
       * Scheduled from *after* `print()` returns rather than alongside it: the
       * call blocks until the dialog closes, so by this line the browser has
       * already snapshotted the document and unmounting the portal cannot
       * truncate the output. The five seconds are slack for any browser where
       * that blocking is less absolute than it looks.
       */
      rescue = window.setTimeout(finish, 5000);
    }, 80);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(rescue);
      window.removeEventListener('afterprint', finish);
      document.body.classList.remove('rp-printing');
    };
  }, [printing]);

  const exportPdf = useCallback(() => setPrinting(true), []);

  /**
   * The pages themselves, drawn at `zoom`.
   *
   * `editing` is a parameter rather than the `editable` prop because this is
   * called twice: once for the pane, and once into the print portal, where hit
   * targets and selection outlines have no business existing.
   */
  const renderPages = (zoom: number, editing: boolean) => (
    <div className="rp-pages">
      {report.pages.map((page) => (
        <div className="rp-page-wrap" key={page.number}>
          <div className="rp-caption">
            {title ? `${title} — ` : ''}page {page.number} of {report.pages.length}
          </div>
          {/* The stage reserves the post-scale footprint so pages do not
              overlap; the sheet itself is drawn at true size and scaled. */}
          <div className="rp-stage" style={{ width: pageW * zoom, height: pageH * zoom }}>
            <div className="rp-page" style={{ width: pageW, height: pageH, transform: `scale(${zoom})` }}>
              {/* The watermark, behind the bands and on every page.
                  `pointer-events: none` matters: it covers the whole sheet, so
                  without it nothing underneath could be selected or dragged --
                  the same mistake the panel wrapper made, and the reason it is
                  worth stating rather than assuming. */}
              {watermark && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                    overflow: 'hidden',
                    zIndex: 0,
                  }}
                >
                  <span
                    style={{
                      color: watermark.color ?? '#999',
                      // DevExpress writes 0-255 where 255 is opaque; CSS wants 0-1.
                      opacity: Math.max(0, Math.min(1, watermark.transparency / 255)),
                      fontFamily: watermark.fontFamily ?? 'inherit',
                      fontSize: watermark.fontSize ? `${watermark.fontSize}pt` : '48pt',
                      fontWeight: watermark.bold ? 700 : 400,
                      whiteSpace: 'nowrap',
                      transform:
                        watermark.direction === 'BackwardDiagonal' ? 'rotate(-45deg)'
                        : watermark.direction === 'ForwardDiagonal' ? 'rotate(45deg)'
                        : 'none',
                    }}
                  >
                    {watermark.text}
                  </span>
                </div>
              )}
              {page.bands.map((placed, i) => (
                <div
                  key={i}
                  className="rp-band"
                  style={{
                    top: unitsToPx(placed.top, report.unit),
                    // left/width are the full page for everything except a
                    // record inside a multi-column Detail band, where they are
                    // the column. `.rp-band` sets left:0 and width:100% in CSS,
                    // so both have to be written here to override it.
                    left: unitsToPx(placed.left, report.unit),
                    width: unitsToPx(placed.width, report.unit),
                    height: unitsToPx(placed.band.height, report.unit),
                    background: showBands ? BAND_TINT[placed.band.kind] ?? 'transparent' : 'transparent',
                  }}
                >
                  {showBands && (
                    <>
                      <span className="rp-band-rule" />
                      <span className="rp-band-label">
                        {placed.band.name}
                        {placed.record !== null ? ` ${placed.record}` : ''}
                      </span>
                    </>
                  )}
                  {placed.band.controls.map((control, c) => {
                    const bandIndex = structureBands.indexOf(placed.band);
                    const isSelected =
                      editing && selected?.band === bandIndex && selected.control === c;
                    return (
                      /* A Fragment, not a wrapper div. An `inset: 0` wrapper
                         stretches to the whole band, so in a band with several
                         controls the last one's wrapper lies over every earlier
                         control's hit target and only the last is selectable.
                         The mock has one control per band, which is exactly the
                         shape that hides this. */
                      <React.Fragment key={c}>
                        <ControlBox
                          control={control}
                          unit={report.unit}
                          pageNumber={page.number}
                          pageCount={report.pages.length}
                        />
                        {editing && (
                          /* A transparent hit target over the control rather
                             than handlers on the control itself: the control's
                             own markup varies by type (a table is a grid of
                             divs, a barcode is 28 bars) and putting a drag
                             handler on each shape would mean the gesture works
                             on a label and not on a table. */
                          <div
                            className={`rp-hit${isSelected ? ' is-selected' : ''}`}
                            style={{
                              left: unitsToPx(control.x, report.unit),
                              top: unitsToPx(control.y, report.unit),
                              width: unitsToPx(control.width, report.unit),
                              height: unitsToPx(control.height, report.unit),
                            }}
                            onPointerDown={(e) => beginGesture(e, { band: bandIndex, control: c }, 'move')}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              if (control.type !== 'XRLabel') return;
                              setSelected({ band: bandIndex, control: c });
                              setEditingText(control.text);
                            }}
                          >
                            {isSelected && editingText === null && (
                              <span
                                className="rp-handle"
                                onPointerDown={(e) =>
                                  beginGesture(e, { band: bandIndex, control: c }, 'resize')
                                }
                              />
                            )}
                            {isSelected && editingText !== null && (
                              <input
                                className="rp-textedit"
                                autoFocus
                                value={editingText}
                                aria-label="Edit the control's text"
                                style={{
                                  inset: 0,
                                  fontSize: control.fontSize ? `${control.fontSize}pt` : '9pt',
                                  fontWeight: control.bold ? 700 : 400,
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                                onChange={(e) => setEditingText(e.target.value)}
                                onBlur={() => {
                                  if (repxContent && editingText !== control.text) {
                                    commit(setControlText(repxContent, { band: bandIndex, control: c }, editingText), repxContent);
                                  }
                                  setEditingText(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { e.currentTarget.blur(); }
                                  // Escape abandons the edit rather than
                                  // committing it, which is what Escape means
                                  // everywhere else in this app.
                                  if (e.key === 'Escape') { setEditingText(null); }
                                  e.stopPropagation();
                                }}
                              />
                            )}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="rp-root">
      <style>{`
        /* Paper is paper in both themes: a printed report must not change with
           the app's colour scheme, the same rule the mockup follows. */
        .rp-root { --rp-ink: #111418; --rp-paper: #fff; }
        .rp-bar {
          display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
          margin-bottom: 14px; font-size: 12px;
        }
        .rp-stat { font-family: var(--font-code, monospace); letter-spacing: .04em; text-transform: uppercase; opacity: .7; }
        .rp-pages { display: flex; flex-direction: column; align-items: center; gap: 22px; }
        .rp-page-wrap { display: flex; flex-direction: column; gap: 6px; }
        .rp-caption {
          font-family: var(--font-code, monospace); font-size: 10px; letter-spacing: .1em;
          text-transform: uppercase; opacity: .55;
        }
        .rp-page {
          background: var(--rp-paper); color: var(--rp-ink);
          position: relative; overflow: hidden;
          box-shadow: 0 1px 3px rgba(0,0,0,.16), 0 8px 24px rgba(0,0,0,.10);
          transform-origin: top left;
        }
        .rp-band { position: absolute; left: 0; right: 0; }
        .rp-band-label {
          position: absolute; left: 2px; top: 1px; font-size: 6pt; letter-spacing: .08em;
          text-transform: uppercase; color: #3B5A8C; opacity: .65; pointer-events: none;
          font-family: var(--font-code, monospace);
        }
        .rp-band-rule { position: absolute; left: 0; right: 0; top: 0; border-top: 1px dashed rgba(59,90,140,.35); }
        .rp-problems {
          border-left: 3px solid var(--warn, #b45309); padding: 10px 14px; margin-bottom: 16px;
          font-size: 13px; line-height: 1.5;
        }
        .rp-problems p { margin: 0 0 6px; }
        .rp-problems p:last-child { margin: 0; }

        /* Editing chrome. Absolutely positioned over each control, transparent
           until hovered so the report reads as a report at rest. */
        .rp-hit { position: absolute; cursor: move; outline: 1px solid transparent; }
        .rp-hit:hover { outline-color: rgba(226, 89, 12, .5); }
        .rp-hit.is-selected { outline: 1.5px solid #e8590c; }
        .rp-handle {
          position: absolute; right: -4px; bottom: -4px; width: 9px; height: 9px;
          background: #e8590c; border: 1px solid #fff; border-radius: 1px;
          cursor: nwse-resize;
        }
        .rp-textedit {
          position: absolute; z-index: 2; box-sizing: border-box;
          border: 1.5px solid #e8590c; background: #fff; color: #111418;
          padding: 0 2px; font-family: inherit;
        }
        .rp-sel {
          font-family: var(--font-code, monospace); font-size: 11px;
          letter-spacing: .04em; opacity: .8;
        }
        .rp-sel b { font-weight: 600; }
        .rp-over { color: var(--warn, #b45309); }
        .rp-params {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px;
        }
        .rp-params-label {
          font-family: var(--font-code, monospace); font-size: 10px; letter-spacing: .1em;
          text-transform: uppercase; opacity: .55;
        }
        .rp-param {
          display: inline-flex; align-items: baseline; gap: 6px; font-size: 12px;
          padding: 3px 9px; border-radius: 999px;
          border: 1px solid var(--paper-rule, #d7dee7);
        }
        .rp-param small { font-family: var(--font-code, monospace); font-size: 10px; opacity: .55; }
        .rp-param em { font-style: normal; font-family: var(--font-code, monospace); font-size: 11px; opacity: .8; }
        @media print { .rp-params { display: none !important; } }

        /* Printing renders the pages a SECOND time, into a portal attached to
           document.body, and hides everything else. The obvious approach --
           hiding the app around the pane in place -- does not survive this
           layout: the pages sit many levels inside the workspace, and an
           ancestor with overflow:hidden clips an absolutely positioned
           descendant. A direct child of body has no such ancestor.
           (No backticks in here: this block is a template literal.) */
        body.rp-printing > *:not(.rp-print-host) { display: none !important; }
        .rp-print-host { display: none; }
        body.rp-printing .rp-print-host { display: block; }

        @media print {
          .rp-caption, .rp-band-label, .rp-band-rule { display: none !important; }
          /* The band tint is a reading aid for the pane, not report content.
             Hiding the label and the rule but leaving the wash behind put a
             coloured block across the ReportHeader of the exported PDF. */
          .rp-band { background: transparent !important; }
          .rp-pages { gap: 0; display: block; }
          .rp-page-wrap { gap: 0; }
          .rp-page {
            box-shadow: none !important;
            transform: none !important;
            break-after: page;
            page-break-after: always;
          }
          .rp-page:last-child { break-after: auto; page-break-after: auto; }
          .rp-stage { width: auto !important; height: auto !important; }
        }
        /* Paper cut from the report's own dimensions, so the PDF matches the
           design rather than whatever the browser defaults to. */
        @page { size: ${inches(report.page.width)}in ${inches(report.page.height)}in; margin: 0; }
      `}</style>

      <div className="rp-bar">
        <span className="rp-stat">
          {report.pages.length} {report.pages.length === 1 ? 'page' : 'pages'}
        </span>
        <span className="rp-stat">{report.records} records</span>
        {report.recordsPerPage > 0 && <span className="rp-stat">{report.recordsPerPage}/page</span>}
        <span className="rp-stat">
          {inches(report.page.width)} × {inches(report.page.height)} in
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={showBands} onChange={(e) => setShowBands(e.target.checked)} />
          Show bands
        </label>
        {/* Drawn now, and still worth saying: the fill ORDER is not visible from
            a page of identical records, and it is the half of a multi-column
            layout most likely to be wrong in the file. */}
        {multiColumn && (
          <span className="rp-stat">
            {multiColumn.count} columns, {multiColumn.layout === 'DownThenAcross' ? 'down then across' : 'across then down'}
          </span>
        )}
        {editable && (
          <span className="rp-sel">
            {selectedControl
              ? <>
                  <b>{selectedControl.type}</b>
                  {selectedControl.name ? ` ${selectedControl.name}` : ''}
                  {' · '}{Math.round(selectedControl.x)},{Math.round(selectedControl.y)}
                  {' · '}{Math.round(selectedControl.width)}×{Math.round(selectedControl.height)}
                  {/* Said rather than prevented. A control dragged past its
                      band's HeightF is a real edit with a real consequence --
                      the designer pushes the band taller or drops the control
                      onto a second page -- and refusing the drag would be
                      guessing at what the user meant. */}
                  {selected && overflowsBand(selectedControl, structureBands[selected.band]?.height ?? 0) && (
                    <span className="rp-over"> · past the band’s {Math.round(structureBands[selected.band]?.height ?? 0)}-unit height</span>
                  )}
                </>
              : 'Click a control to move it · double-click a label to retype it'}
          </span>
        )}
        {editable && (
          <button
            className="wb-pill wb-pill--outline"
            onClick={undo}
            disabled={undoDepth === 0}
            style={{ marginLeft: 'auto' }}
          >
            Undo
          </button>
        )}
        <button
          className="wb-pill wb-pill--outline"
          onClick={exportPdf}
          disabled={!report.pages.length}
          style={editable ? undefined : { marginLeft: 'auto' }}
        >
          Export PDF
        </button>
      </div>

      {/* Parameters are asked BEFORE the report prints, so they belong above
          the paper rather than on it — DevExpress shows them in a panel the
          reader fills in first, and a preview that omitted them would suggest
          the report just runs. */}
      {parameters.length > 0 && (
        <div className="rp-params">
          <span className="rp-params-label">Asked before printing</span>
          {parameters.map((p) => (
            <span className="rp-param" key={p.name}>
              {p.description || p.name}
              <small>{p.lifted ? 'typed' : p.type.replace('System.', '')}{p.multiValue ? ' · many' : ''}</small>
              {p.value && <em>{p.value}</em>}
            </span>
          ))}
        </div>
      )}

      {report.problems.length > 0 && (
        <div className="rp-problems" role="status">
          {report.problems.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}

      <div ref={viewportRef} style={{ width: '100%' }} onPointerDown={() => setSelected(null)}>
        {renderPages(scale, editable)}
      </div>

      {/* True size, outside the workspace tree, only while printing. */}
      {printing && createPortal(<div className="rp-print-host">{renderPages(1, false)}</div>, document.body)}
    </div>
  );
}
