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
  activeColumns,
  pageInfoText,
  printedText,
  cssColor,
  cssPadding,
  fontDecoration,
  recordCountFromLayout,
  pieShare,
  type Appearance,
  type ChartModel,
  type PlacedControl,
  type RecordValues,
  type PreviewControl,
  type PaginatedReport,
} from '../lib/reportPreview';
import { parseParameters } from '../lib/repxParameters';
import { readBoundFields } from '../lib/repxBindingPlan';
import { unitsToPx, pxToUnits, unitsPerInch } from '../lib/reportGeometry';
import { canvasMeasurer, cssFace, lineSpacingPt, lineWidthPt } from '../lib/textMeasure';
import { exportFileName, layoutContinuous, reportToCsv } from '../lib/csvExport';
import { reportToXlsx } from '../lib/xlsxExport';
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
  /**
   * AI-generated sample rows, keyed by bound field name. When present the
   * Detail band prints once per row with each bound cell showing that row's
   * value, instead of once per layout record with placeholder text. The rows
   * are App's: this pane only draws them. Modelled on DevExpress's *Show
   * Report Preview with AI-generated Test Data*.
   */
  records?: TestRow[] | null;
  /** Asks App to generate rows; absent, no Test data button is drawn. */
  onTestData?: () => void;
  onClearTestData?: () => void;
  testDataBusy?: boolean;
}

export type TestRow = RecordValues;

/**
 * A border as CSS, in the control's own width and colour. `BorderWidth` is in
 * pixels at 96 per inch -- printed, 2 came out 1.5pt -- and both default to
 * DevExpress's 1px black.
 */
function borderLine(look: Appearance): string {
  const width = Number.parseFloat(look.BorderWidth ?? '');
  return `${Number.isFinite(width) && width > 0 ? width : 1}px solid ${cssColor(look.BorderColor) ?? '#000'}`;
}

/**
 * The row's value for a bound field, or the control's own text: the engine's
 * fallback, for a placement the layout did not give a text of its own.
 */
const printed = printedText;

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
  /** The control's `dpiScale`: what the file's numbers were multiplied by to reach report units. */
  dpiScale: number;
} | null;

/** Bands the reader should be able to tell apart on screen. */
/** A report this short draws every page; a longer one only those near the viewport. */
const DRAW_EVERY_PAGE_UP_TO = 12;

/*
 * A chart over test data (parity row 32), drawn as DevExpress 20.1 draws its
 * default picture, in the colours sampled from its PNG of s23: a series bar
 * #60B5CC and the next series #E66C7D; a pie's slices in its legend's twelve
 * colours. Bars stand on a category axis, one slot per distinct argument, a
 * record's bar over the record before it as s23's four bars per region did;
 * a line runs through its points in record order; every point carries its
 * value, and a pie slice its share, as DevExpress labels them by default.
 * The picture is the Preview's own drawing of what DevExpress plots, matched
 * to its points and not to its pixels.
 */
const SERIES_COLOURS = ['#60B5CC', '#E66C7D'];
const PIE_COLOURS = ['#3EA5C1', '#DA253E', '#53AC56', '#D89C00', '#E1621E', '#B93A39', '#B2DBE6', '#F0A8B2', '#BADEBB', '#FFD770', '#F3C0A5', '#E4A9A8'];
const CHART_FONT = 'Tahoma, sans-serif';

function ChartPicture({ model, width, height }: { model: ChartModel; width: number; height: number }) {
  const label = 10.5; // 8pt at 96 dpi
  const pie = model.series.find((s) => s.view === 'PieSeriesView');
  const text = (x: number, y: number, s: string, anchor: 'start' | 'middle' | 'end', fill = '#3c3c3c') => (
    <text x={x} y={y} fontSize={label} fontFamily={CHART_FONT} textAnchor={anchor} dominantBaseline="middle" fill={fill}>{s}</text>
  );
  if (pie) {
    const slices = pie.points.filter((p) => p.value !== null && p.value > 0);
    const shares = slices.map((p) => pieShare(p.value!, pie.points));
    const legendWidth = Math.min(width * 0.4, 30 + Math.max(...shares.map((s) => s.length)) * 6.5);
    const r = Math.max(4, Math.min((width - legendWidth) / 2 - 40, height / 2 - 24));
    const cx = (width - legendWidth) / 2;
    const cy = height / 2;
    const total = slices.reduce((sum, p) => sum + p.value!, 0);
    let start = 0;
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Pie chart of ${pie.name}`}>
        {slices.map((p, i) => {
          // Counter-clockwise from three o'clock, as s23's pie ran.
          const sweep = (p.value! / total) * Math.PI * 2;
          const a0 = start;
          const a1 = (start += sweep);
          const point = (a: number, rr = r) => `${cx + rr * Math.cos(a)},${cy - rr * Math.sin(a)}`;
          const mid = (a0 + a1) / 2;
          const d = sweep >= Math.PI * 2 - 1e-9
            ? `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`
            : `M${cx},${cy}L${point(a0)}A${r},${r} 0 ${sweep > Math.PI ? 1 : 0},0 ${point(a1)}Z`;
          const [lx, ly] = point(mid, r + 16).split(',').map(Number);
          return (
            <g key={i}>
              <path d={d} fill={PIE_COLOURS[i % PIE_COLOURS.length]} />
              {text(lx, ly, shares[i], Math.cos(mid) >= 0 ? 'start' : 'end', PIE_COLOURS[i % PIE_COLOURS.length])}
            </g>
          );
        })}
        <g transform={`translate(${width - legendWidth + 4},6)`}>
          {shares.map((s, i) => (
            <g key={i} transform={`translate(0,${i * 18})`}>
              <rect width={12} height={12} y={-6} fill={PIE_COLOURS[i % PIE_COLOURS.length]} />
              {text(18, 0, s, 'start')}
            </g>
          ))}
        </g>
      </svg>
    );
  }

  const xy = model.series.filter((s) => s.view !== 'PieSeriesView');
  const ticks = model.ticks.length ? model.ticks : [0, 1];
  // The plot runs a tenth of the range past the last tick: s23's top was at
  // about 1317 against a last tick of 1200, so its tallest bar did not meet
  // the frame.
  const low = ticks[0] < 0 ? ticks[0] - (ticks[ticks.length - 1] - ticks[0]) * 0.1 : ticks[0];
  const high = ticks[ticks.length - 1] + (ticks[ticks.length - 1] - ticks[0]) * 0.1;
  const legendWidth = Math.min(width * 0.3, 36 + Math.max(...xy.map((s) => s.name.length)) * 6.5);
  const left = 12 + Math.max(...ticks.map((t) => String(t).length)) * 6.5;
  const plot = { x: left, y: 10, w: Math.max(10, width - left - legendWidth - 16), h: Math.max(10, height - 34) };
  const yOf = (v: number) => plot.y + plot.h - ((v - low) / (high - low || 1)) * plot.h;
  const slot = plot.w / Math.max(1, model.arguments.length);
  const xOf = (argument: string) => plot.x + slot * (model.arguments.indexOf(argument) + 0.5);
  const bars = xy.filter((s) => !/Line|Spline|Point|Area/.test(s.view));
  const barWidth = (slot * 0.6) / Math.max(1, bars.length);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Chart of ${xy.map((s) => s.name).join(', ')}`}>
      <rect x={plot.x} y={plot.y} width={plot.w} height={plot.h} fill="none" stroke="#c8c8c8" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={plot.x} x2={plot.x + plot.w} y1={yOf(t)} y2={yOf(t)} stroke="#e6e6e6" />
          {text(plot.x - 6, yOf(t), String(t), 'end')}
        </g>
      ))}
      {model.arguments.map((a) => text(xOf(a), plot.y + plot.h + 12, a, 'middle'))}
      {xy.map((s, si) => {
        const colour = SERIES_COLOURS[si] ?? PIE_COLOURS[si % PIE_COLOURS.length];
        const points = s.points.filter((p) => p.value !== null);
        if (bars.includes(s)) {
          const offset = (bars.indexOf(s) - (bars.length - 1) / 2) * barWidth;
          return (
            <g key={si}>
              {points.map((p, i) => {
                const x = xOf(p.argument) + offset - barWidth / 2;
                const top = Math.min(yOf(p.value!), yOf(0));
                return <rect key={i} x={x} y={top} width={barWidth} height={Math.abs(yOf(0) - yOf(p.value!))} fill={colour} />;
              })}
              {points.map((p, i) => <g key={`l${i}`}>{text(xOf(p.argument) + offset, yOf(p.value!) + 9, String(p.value), 'middle', '#ffffff')}</g>)}
            </g>
          );
        }
        // A line runs along the axis: each argument's points in record order,
        // then the next argument's, as s23's Trend rose at each region before
        // falling to the next.
        const along = [...points].sort((a, b) => model.arguments.indexOf(a.argument) - model.arguments.indexOf(b.argument));
        return (
          <g key={si}>
            <polyline points={along.map((p) => `${xOf(p.argument)},${yOf(p.value!)}`).join(' ')} fill="none" stroke={colour} strokeWidth={2} />
            {points.map((p, i) => <circle key={i} cx={xOf(p.argument)} cy={yOf(p.value!)} r={4} fill={colour} />)}
            {points.map((p, i) => <g key={`l${i}`}>{text(xOf(p.argument) + 8, yOf(p.value!) - 8, String(p.value), 'start', colour)}</g>)}
          </g>
        );
      })}
      <g transform={`translate(${plot.x + plot.w + 12},${plot.y + 8})`}>
        {xy.map((s, si) => {
          const colour = SERIES_COLOURS[si] ?? PIE_COLOURS[si % PIE_COLOURS.length];
          return (
            <g key={si} transform={`translate(0,${si * 18})`}>
              {bars.includes(s) ? <rect width={14} height={12} y={-6} fill={colour} /> : (
                <g><line x1={0} x2={14} y1={0} y2={0} stroke={colour} strokeWidth={2} /><circle cx={7} cy={0} r={4} fill={colour} /></g>
              )}
              {text(20, 0, s.name, 'start')}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

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
  placed,
  unit,
  pageNumber,
  pageCount,
  record,
}: {
  control: PreviewControl;
  /**
   * Where and how tall it prints in this placement, after growing, being
   * pushed down and being cut at a page break; and the lines and table rows
   * that part prints. See `layoutBand` in lib/reportPreview.
   */
  placed: PlacedControl;
  unit: string;
  pageNumber: number;
  pageCount: number;
  /** The sample row this band placement prints, when test data is shown. */
  record?: TestRow | null;
}) {
  const u = (n: number) => unitsToPx(n, unit);
  // Resolved appearance: style, StylePriority, own attribute, then parent.
  const look = control.appearance;
  const edge = borderLine(look);
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
    // The laid-out position, which already includes any panel offset.
    top: u(placed.y),
    width: u(control.width),
    height: u(placed.height),
    display: 'flex',
    alignItems,
    justifyContent: justify,
    // Font size is in points in the file and `pt` is a real CSS unit, so this
    // is correct on screen and on paper without a conversion of our own. The
    // values are already resolved through styles and inheritance, so these
    // fallbacks are DevExpress's own default rather than this app's typeface.
    fontSize: control.fontSize ? `${control.fontSize}pt` : '9.75pt',
    // The face the browser finds for the report's family name (parity row 62).
    ...(control.fontFamily ? cssFace({ family: control.fontFamily, bold: control.bold, italic: control.italic }) : { fontFamily: '"Times New Roman", serif', fontWeight: control.bold ? 700 : 400, fontStyle: control.italic ? 'italic' : 'normal' }),
    textDecoration: fontDecoration(look.Font),
    // Colour, fill, padding and the border's own width and colour, as printed:
    // a 2px red border with 10 units of padding put text 8.7pt inside the edge.
    // Every border was drawn 1px black, and no colour at all, until 2026-10-30.
    color: cssColor(look.ForeColor),
    background: cssColor(look.BackColor),
    padding: cssPadding(look.Padding),
    // A table's cells draw its borders, shared edges once; the frame does not.
    borderTop: control.type !== 'XRTable' && control.borders.top ? edge : undefined,
    borderRight: control.type !== 'XRTable' && control.borders.right ? edge : undefined,
    borderBottom: control.type !== 'XRTable' && control.borders.bottom ? edge : undefined,
    borderLeft: control.type !== 'XRTable' && control.borders.left ? edge : undefined,
    overflow: 'hidden',
  };

  if (control.type === 'XRLine') {
    return <div style={{ ...frame, borderTop: `1px solid ${cssColor(look.ForeColor) ?? '#111'}`, height: Math.max(1, u(control.height)) }} />;
  }

  if (control.type === 'XRPageInfo' && control.pageInfo) {
    // What DevExpress prints for this kind and format on this page -- `1/2`,
    // `Page 1`, `ii`, a date. It drew "n / N" for every kind until 2026-10-30.
    // An invented PageInfo value is reported by repxAudit, not drawn here.
    return <div style={frame}>{pageInfoText(control.pageInfo, pageNumber, pageCount)}</div>;
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
   * An embedded subreport draws its own report inside its box (parity row 27),
   * laid out once by the engine and grown to fit: printed in s22b, the whole
   * inner report appeared at the control's place for every master record. A
   * subreport loaded from a file names it instead, because a browser cannot
   * open a path on the machine that will print the report.
   */
  if (control.type === 'XRSubreport') {
    if (placed.inner) {
      return (
        <div style={{ ...frame, display: 'block', padding: 0 }}>
          {placed.inner.map((band, i) => (
            <div key={i} style={{ position: 'absolute', left: u(band.left), top: u(band.top), width: u(band.width), height: u(band.height) }}>
              {band.controls.map((pc) => (
                <ControlBox key={pc.index} control={pc.control} placed={pc} unit={unit} pageNumber={pageNumber} pageCount={pageCount} />
              ))}
            </div>
          ))}
        </div>
      );
    }
    return (
      <div style={{ ...frame, border: '1px dashed #999', color: '#777', fontSize: '7pt', alignItems: 'center', justifyContent: 'center' }}>
        {control.subreport?.url ? `subreport ${control.subreport.url}, not loaded here` : 'subreport'}
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
          {placed.text ?? printed(control.text, control.field, record)}
        </span>
      </div>
    );
  }

  /*
   * A chart is drawn as its STRUCTURE, not as invented data, and so is a
   * cross-tab that the Preview cannot draw from the test data (row 31 draws
   * the rest, above).
   *
   * Without test data, plotting bars would mean making numbers up and showing
   * them on a page the user is checking for accuracy. What is actually
   * knowable from the file is the shape and the binding -- a bar chart of
   * Amount by Region -- and that is the thing worth confirming, because a chart
   * bound to the wrong field looks identical to a correct one either way. A
   * With test data a chart plots it instead (parity row 32), below.
   */
  /*
   * A table of contents (queue 6, s55): its heading, then a row per bookmark,
   * indented by its depth, its title and a leader of dots to its page number
   * at the right edge, the text sitting on the row's bottom as DevExpress set
   * it. `rowStart` says which rows this part of it prints when it ran across
   * a page.
   */
  if (control.type === 'XRTableOfContents' && control.toc && placed.toc && placed.rowHeights) {
    const toc = control.toc;
    const face = (f: typeof toc.rowFont): React.CSSProperties => ({
      fontSize: `${f.size ?? 9.75}pt`,
      ...(f.family ? cssFace({ family: f.family, bold: f.bold, italic: f.italic }) : { fontFamily: '"Times New Roman", serif', fontWeight: f.bold ? 700 : 400, fontStyle: f.italic ? 'italic' : 'normal' }),
      color: cssColor(look.ForeColor) ?? '#000',
      whiteSpace: 'nowrap',
      lineHeight: 'normal',
    });
    let top = 0;
    return (
      <div style={{ ...frame, display: 'block' }}>
        {placed.rowHeights.map((h, i) => {
          const row = placed.rowStart + i;
          const y = top;
          top += h;
          if (row === 0) {
            return <div key={i} style={{ position: 'absolute', left: 0, top: u(y), width: '100%', height: u(h), overflow: 'hidden', ...face(toc.titleFont) }}>{toc.title}</div>;
          }
          const entry = placed.toc![row - 1];
          if (!entry) return null;
          return (
            <div key={i} style={{ position: 'absolute', left: u((entry.level - 1) * toc.indent), right: 0, top: u(y), height: u(h), display: 'flex', alignItems: 'flex-end', overflow: 'hidden', ...face(toc.rowFont) }}>
              <span>{entry.title}&nbsp;</span>
              <span aria-hidden style={{ flex: 1, overflow: 'hidden' }}>{'.'.repeat(400)}</span>
              <span>{entry.page || ''}</span>
            </div>
          );
        })}
      </div>
    );
  }

  if (control.type === 'XRChart' && placed.chart) {
    return (
      <div style={{ ...frame, display: 'block' }}>
        <ChartPicture model={placed.chart} width={u(control.width)} height={u(placed.height)} />
      </div>
    );
  }
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

  /*
   * A cross-tab over test data draws the grid DevExpress prints (parity row
   * 31). Every cell is in DevExpress's own default appearance -- Times New
   * Roman 9.75pt, black, top left, no padding, fill or border -- because s25
   * printed none of the cross-tab's own Font, colours, borders or alignment
   * reaching a cell, nor the report's.
   */
  if (control.type === 'XRCrossTab' && placed.crossTab) {
    return (
      <div style={{ position: 'absolute', left: frame.left, top: frame.top, width: u(placed.crossTab.width), height: u(placed.crossTab.height) }}>
        {placed.crossTab.cells.map((cell, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: u(cell.x),
              top: u(cell.y),
              width: u(cell.width),
              height: u(cell.height),
              overflow: 'hidden',
              fontFamily: '"Times New Roman", serif',
              fontSize: '9.75pt',
              color: '#000',
              whiteSpace: 'pre-wrap',
              lineHeight: `${lineSpacingPt('Times New Roman', 9.75)}pt`,
            }}
          >
            {cell.text}
          </div>
        ))}
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
    // The rows this part prints, each at its laid-out height; or, unmeasured,
    // every row at an equal share of the designed height.
    const shown = placed.rowHeights
      ? control.rows.slice(placed.rowStart, placed.rowStart + placed.rowHeights.length)
      : control.rows;
    const equal = shown.length ? u(control.height) / shown.length : u(control.height);
    return (
      <div style={{ ...frame, flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start' }}>
        {shown.map((row, r) => {
          const rowHeight = placed.rowHeights ? u(placed.rowHeights[r]) : equal;
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
                    // Each cell's own resolved alignment and font -- its style,
                    // then its own attributes, then its row's and its table's.
                    // Vertically centred until 2026-10-30, where DevExpress's
                    // default is the top.
                    alignItems:
                      cell.vAlign === 'bottom' ? 'flex-end' : cell.vAlign === 'middle' ? 'center' : 'flex-start',
                    justifyContent:
                      cell.align === 'right' ? 'flex-end' : cell.align === 'center' ? 'center' : 'flex-start',
                    fontSize: cell.fontSize ? `${cell.fontSize}pt` : undefined,
                    ...(cell.fontFamily ? cssFace({ family: cell.fontFamily, bold: cell.bold, italic: cell.italic }) : { fontWeight: cell.bold ? 700 : 400, fontStyle: cell.italic ? 'italic' : 'normal' }),
                    textDecoration: fontDecoration(cell.appearance.Font),
                    color: cssColor(cell.appearance.ForeColor),
                    background: cssColor(cell.appearance.BackColor),
                    // DevExpress printed table cells with no padding of their
                    // own; this pane used to add 2px each side.
                    padding: cssPadding(cell.appearance.Padding) ?? 0,
                    borderTop: cell.borders.top ? borderLine(cell.appearance) : undefined,
                    borderRight: cell.borders.right ? borderLine(cell.appearance) : undefined,
                    borderBottom: cell.borders.bottom ? borderLine(cell.appearance) : undefined,
                    borderLeft: cell.borders.left ? borderLine(cell.appearance) : undefined,
                    overflow: 'hidden',
                    // A cell wraps unless it says WordWrap="false", as DevExpress
                    // prints it, at its line spacing -- the row has already grown
                    // to fit. It clipped with an ellipsis until 2026-10-30.
                    whiteSpace: cell.wordWrap ? 'normal' : 'nowrap',
                    overflowWrap: 'anywhere',
                    lineHeight: `${lineSpacingPt(cell.fontFamily, cell.fontSize ?? 9.75, cell)}pt`,
                  }}
                >
                  {placed.cellTexts?.[placed.rowStart + r]?.[c] ?? printed(cell.text, cell.field, record)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  // Measured text prints exactly the lines the paginator counted, at
  // DevExpress's line spacing for the font, so the page shows the same breaks
  // and the same height the layout used. 18 of 18 texts in 9 fonts broke where
  // DevExpress broke them; see lib/textMeasure.
  /*
   * A label with a `NavigateUrl` is an anchor (parity row 17). DevExpress's PDF
   * carried both a literal and a bound link as link annotations (c08), and a
   * browser keeps an anchor's link when it prints, so Export PDF does too. It
   * takes the label's own colour and decoration, as DevExpress draws it: a
   * link looks like a link only when the report says so.
   */
  const Box = placed.url ? 'a' : 'div';
  const link = placed.url
    ? { href: placed.url, target: '_blank', rel: 'noopener noreferrer', style: { ...frame, color: frame.color ?? 'inherit', textDecoration: frame.textDecoration ?? 'none' } }
    : { style: frame };

  /*
   * Turned text (parity row 49). Printed in s35, DevExpress turned the text by
   * its `Angle`, counter-clockwise, and aligned the turned text's bounding box
   * in the label's box by `TextAlignment`, the box unturned. So the frame
   * aligns a box the size of that bounding box, and the text turns about its
   * centre inside it. Where nothing can measure, as under jsdom, a character
   * is taken as half an em.
   */
  if (control.angle) {
    const text = placed.text ?? printed(control.text, control.field, record);
    const sizePt = control.fontSize ?? 9.75;
    const font = { family: control.fontFamily ?? 'Times New Roman', sizePt, bold: control.bold, italic: control.italic };
    const w = ((lineWidthPt(text, font) ?? text.length * sizePt * 0.5) * 96) / 72;
    const h = (lineSpacingPt(control.fontFamily, sizePt, control) * 96) / 72;
    const turn = (control.angle * Math.PI) / 180;
    const [boxW, boxH] = [Math.abs(w * Math.cos(turn)) + Math.abs(h * Math.sin(turn)), Math.abs(w * Math.sin(turn)) + Math.abs(h * Math.cos(turn))];
    return (
      <Box {...link}>
        <span style={{ position: 'relative', flex: 'none', width: boxW, height: boxH }}>
          <span style={{ position: 'absolute', left: '50%', top: '50%', width: w, lineHeight: `${h}px`, whiteSpace: 'pre', transform: `translate(-50%, -50%) rotate(${-control.angle}deg)` }}>
            {text}
          </span>
        </span>
      </Box>
    );
  }

  if (placed.lines) {
    return (
      <Box {...link} style={{ ...link.style, whiteSpace: 'pre', lineHeight: `${lineSpacingPt(control.fontFamily, control.fontSize ?? 9.75, control)}pt` }}>
        {placed.lines.join('\n')}
      </Box>
    );
  }

  // XRLabel and anything else with text in it: what the layout evaluated and
  // formatted for this placement -- `$1,240.00` where the binding is
  // `[Amount]` with `{0:c2}`, a group's total where it is `sumSum` -- which
  // was the raw value or the literal text until parity row 12.
  return <Box {...link}>{placed.text ?? printed(control.text, control.field, record)}</Box>;
}

export default function ReportPreview({ repxContent, layout, title, onEdit, records, onTestData, onClearTestData, testDataBusy }: Props) {
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
  // Text measured in the browser's own copy of each font, so controls grow and
  // pages break where DevExpress puts them. Null under jsdom, where the layout
  // falls back to the designed heights.
  const measure = useMemo(() => canvasMeasurer(), []);
  /*
   * Values typed into the parameter fields above the paper, by name. They only
   * mean something over test data: the report's FilterString and any `?Name`
   * in an expression read them, and each wins over the file's default, as
   * DevExpress printed in c07 (parity row 11). Kept across regenerations, so a
   * value typed once survives a refinement that keeps the parameter.
   */
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const { structure, report } = useMemo(() => {
    const parsed = parseReportStructure(repxContent);
    // With sample rows the record count is theirs; otherwise it is the number
    // of rows the model read out of the source document.
    const count = records?.length ? records.length : recordCountFromLayout(layout);
    // The rows themselves too, now: a record's values decide how tall it grows.
    return {
      structure: parsed,
      report: paginate(parsed, count, { measure, rows: records ?? null, parameters: paramValues }) as PaginatedReport,
    };
  }, [repxContent, layout, records, measure, paramValues]);

  const boundFields = useMemo(() => readBoundFields(repxContent), [repxContent]);
  const structureBands = structure.bands;
  const watermark = structure.watermark;
  // The columns DevExpress actually prints, which a declared count with no Mode
  // is not; in practice only Detail ever declares any.
  const multiColumn = structureBands
    .map((b) => activeColumns(b.columns, report.content.width))
    .find((c) => c !== null) ?? null;
  const parameters = useMemo(() => parseParameters(repxContent), [repxContent]);

  const pageW = unitsToPx(report.page.width, report.unit);

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
      dpiScale: control.dpiScale ?? 1,
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
      // Back into the file's own numbers, which a control with no Dpi in a
      // millimetre report holds at a 2.54th of what prints (parity row 35).
      const s = g.dpiScale;
      const result =
        g.mode === 'move'
          ? moveControl(g.baseXml, g.ref, (g.originX + dx) / s, (g.originY + dy) / s)
          : resizeControl(g.baseXml, g.ref, (g.originW + dx) / s, (g.originH + dy) / s);
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
      // you close, one unit at a time gets you exact. A unit of the file's own
      // numbers, so they stay whole whatever the control's Dpi.
      event.preventDefault();
      const s = selectedControl.dpiScale ?? 1;
      commit(
        moveControl(repxContent, selected, selectedControl.x / s + delta[0], selectedControl.y / s + delta[1]),
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

  /*
   * CSV as DevExpress exports it (parity row 20): one continuous page, a line
   * per distinct top and a column per distinct left edge, the printed text in
   * each. Thirteen parity cases came out byte for byte the same as
   * DevExpress's own files. Laid out from the same report, rows and parameter
   * values the pane shows, so the file holds what the reader sees.
   */
  const download = useCallback((data: BlobPart, type: string, extension: string) => {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName(title, extension);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [title]);
  const exportCsv = useCallback(() => {
    const count = records?.length ? records.length : recordCountFromLayout(layout);
    download(reportToCsv(structure, count, { rows: records ?? null, parameters: paramValues }), 'text/csv;charset=utf-8', 'csv');
  }, [structure, records, layout, paramValues, download]);

  /*
   * An Excel workbook as DevExpress exports one (parity row 19): the layout as
   * a grid of merged cells, numbers and dates kept as values with the format
   * string converted. The thirteen parity workbooks came out cell for cell the
   * same as DevExpress's. It takes the pane's measurer, because a row is as tall
   * as its grown text, and DevExpress's rows were.
   */
  const exportXlsx = useCallback(() => {
    const count = records?.length ? records.length : recordCountFromLayout(layout);
    const bytes = reportToXlsx(structure, count, { rows: records ?? null, parameters: paramValues, measure });
    download(bytes as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx');
  }, [structure, records, layout, paramValues, measure, download]);

  /*
   * Word, RTF, HTML and image, as DevExpress exports them (parity row 21).
   * Word and RTF go page by page, as frames where the page printed each item;
   * HTML and the image are the continuous layout CSV and XLSX use, a table
   * whose grid is the layout and one picture of the whole report. The text
   * comes from the layout, as for XLSX; the charts, and the image, from the
   * pages drawn at true size into a hidden host, as for the PDF. Each writer
   * is loaded only when it is chosen.
   */
  type ExportKind = 'docx' | 'rtf' | 'html' | 'png';
  const [exportKind, setExportKind] = useState<ExportKind | null>(null);
  const exportHostRef = useRef<HTMLDivElement>(null);
  const continuous = useMemo(() => {
    if (exportKind !== 'html' && exportKind !== 'png') return null;
    const count = records?.length ? records.length : recordCountFromLayout(layout);
    return layoutContinuous(structure, count, { rows: records ?? null, parameters: paramValues, measure });
  }, [exportKind, structure, records, layout, paramValues, measure]);
  useEffect(() => {
    if (!exportKind) return;
    let cancelled = false;
    (async () => {
      try {
        await document.fonts?.ready;
        await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
        const host = exportHostRef.current;
        if (!host || cancelled) return;
        const pages = [...host.querySelectorAll<HTMLElement>('.rp-page')];
        const laid = continuous ?? report;
        const dom = await import('../lib/exportFromDom');
        if (exportKind === 'png') {
          if (!cancelled) download(await dom.pageToPng(pages[0]), 'image/png', 'png');
          return;
        }
        const pictures = await dom.picturesOf(pages, unitsPerInch(laid.unit) / 96);
        if (cancelled) return;
        if (exportKind === 'html') {
          const { reportToHtml } = await import('../lib/htmlExport');
          download(reportToHtml(laid, structure, title || 'Report', pictures), 'text/html;charset=utf-8', 'html');
        } else if (exportKind === 'rtf') {
          const { reportToRtf } = await import('../lib/rtfExport');
          download(reportToRtf(laid, structure, pictures), 'application/rtf', 'rtf');
        } else {
          const { reportToDocx } = await import('../lib/docxExport');
          download(reportToDocx(laid, structure, pictures) as BlobPart, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx');
        }
      } catch (err) {
        console.error('Forma could not write the export.', err);
      } finally {
        if (!cancelled) setExportKind(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exportKind, continuous, report, structure, title, download]);

  /*
   * A PDF of Forma's own writing, with the report's bookmarks as its outline
   * (parity row 18). Printing cannot add an outline, so this reads the pages
   * drawn at true size into a hidden host, as the printed copy is, and writes
   * them with lib/pdfFromDom, loaded only now. It sits beside Export PDF
   * rather than replacing it: printing keeps the Preview's own fonts, and this
   * uses the PDF standard ones.
   */
  const [writingPdf, setWritingPdf] = useState(false);
  const pdfHostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!writingPdf) return;
    let cancelled = false;
    (async () => {
      try {
        await document.fonts?.ready;
        await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
        const host = pdfHostRef.current;
        if (!host || cancelled) return;
        const { pagesToPdf } = await import('../lib/pdfFromDom');
        const pages = [...host.querySelectorAll<HTMLElement>('.rp-page')];
        const blob = await pagesToPdf(pages, report, title || 'Report', structure.outlineTitle || title || 'Report');
        if (!cancelled) download(blob, 'application/pdf', 'pdf');
      } catch (err) {
        console.error('Forma could not write the PDF.', err);
      } finally {
        if (!cancelled) setWritingPdf(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [writingPdf, report, structure, title, download]);

  /*
   * Only the pages near the viewport are filled in (parity row 16). Every page
   * keeps its frame at full size, so the scroll height and each page's place
   * are exact, but a page's bands are drawn only within a few pages of what is
   * on screen. That is what lets the 50-page cap go: c09's 213 pages lay out
   * in a quarter of a second, and drawing every control of every page is what
   * would not scale. A short report, and the printed copy, draw every page.
   */
  const pagesRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState<[number, number]>([0, 3]);
  useEffect(() => {
    const total = report.pages.length;
    if (total <= DRAW_EVERY_PAGE_UP_TO) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const wraps = pagesRef.current?.querySelectorAll<HTMLElement>('.rp-page-wrap');
      if (!wraps || wraps.length < 2) return;
      const first = wraps[0].getBoundingClientRect();
      const pitch = wraps[1].getBoundingClientRect().top - first.top;
      if (!(pitch > 0)) return;
      const from = Math.max(0, Math.floor(-first.top / pitch) - 2);
      const to = Math.min(total - 1, Math.ceil((window.innerHeight - first.top) / pitch) + 2);
      setNear((prev) => (prev[0] === from && prev[1] === to ? prev : [from, to]));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    // Capture, so a scroll in whichever ancestor scrolls the pane is heard.
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [report, scale]);
  const isDrawn = (index: number) =>
    report.pages.length <= DRAW_EVERY_PAGE_UP_TO || (index >= near[0] && index <= near[1]);

  /**
   * The pages themselves, drawn at `zoom`.
   *
   * `editing` is a parameter rather than the `editable` prop because this is
   * called twice: once for the pane, and once into the print portal, where hit
   * targets and selection outlines have no business existing. `windowed` is
   * true for the pane only: the printed copy needs every page.
   */
  const renderPages = (zoom: number, editing: boolean, windowed: boolean, laid: PaginatedReport = report) => {
    // Another layout of the same report, for an export (the continuous one for
    // HTML and PNG), is drawn with its own page size.
    const report = laid;
    const pageW = unitsToPx(report.page.width, report.unit);
    const pageH = unitsToPx(report.page.height, report.unit);
    return (
    <div className="rp-pages" ref={windowed ? pagesRef : undefined}>
      {report.pages.map((page, pageIndex) => (
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
              {(!windowed || isDrawn(pageIndex)) && page.bands.map((placed, i) => (
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
                    // This placement's height: grown, or one part of a split.
                    height: unitsToPx(placed.height, report.unit),
                    // Clip at the margins and nowhere else, as DevExpress does:
                    // not at a column's edge (an over-wide control in a column
                    // prints over the next one, measured by render-cols), and not
                    // vertically. The right inset is negative for a column,
                    // reaching out to the printable area's right edge. Only a band
                    // shifted left a column, on a page for what ran past the right
                    // margin, is clipped at the left one as well (parity row 64).
                    clipPath: `inset(-100000px ${unitsToPx(
                      placed.left + placed.width - (report.content.left + report.content.width),
                      report.unit,
                    )}px -100000px ${placed.left < report.content.left ? unitsToPx(report.content.left - placed.left, report.unit) : -100000}px)`,
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
                  {placed.controls.map((pc) => {
                    // The controls as laid out for this placement: hidden ones
                    // are already left out, and `pc.index` is the control's
                    // index in its band, which edits address it by.
                    const control = pc.control;
                    const c = pc.index;
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
                          placed={pc}
                          unit={report.unit}
                          pageNumber={page.number}
                          pageCount={report.pages.length}
                          record={placed.record !== null && records?.length ? records[(placed.record - 1) % records.length] : null}
                        />
                        {/* A detail report's bands are not in the top-level list
                            edits address, so they are drawn but not editable. */}
                        {editing && bandIndex >= 0 && (
                          /* A transparent hit target over the control rather
                             than handlers on the control itself: the control's
                             own markup varies by type (a table is a grid of
                             divs, a barcode is 28 bars) and putting a drag
                             handler on each shape would mean the gesture works
                             on a label and not on a table. */
                          <div
                            className={`rp-hit${isSelected ? ' is-selected' : ''}`}
                            style={{
                              // Over the control where it is drawn, which after
                              // growth and push-down need not be where the file
                              // puts it; a drag still edits from the file's origin.
                              left: unitsToPx(control.x + control.offsetX, report.unit),
                              top: unitsToPx(pc.y, report.unit),
                              width: unitsToPx(control.width, report.unit),
                              height: unitsToPx(pc.height, report.unit),
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
              {/* Cross-band lines and boxes, drawn over the bands they cross
                  (parity row 48): a box as its frame, a line down the middle
                  of its strip, each stroke in pixels as DevExpress draws it. */}
              {(!windowed || isDrawn(pageIndex)) && page.crossBands?.map((cb, i) => (
                <div
                  key={`cross${i}`}
                  aria-hidden
                  style={{
                    position: 'absolute',
                    pointerEvents: 'none',
                    top: unitsToPx(cb.top, report.unit),
                    height: unitsToPx(cb.bottom - cb.top, report.unit),
                    ...(cb.kind === 'box'
                      ? { left: unitsToPx(cb.left, report.unit), width: unitsToPx(cb.width, report.unit), boxSizing: 'border-box', border: `${cb.strokePx}px solid ${cssColor(cb.color) ?? '#000'}` }
                      : { left: `calc(${unitsToPx(cb.left + cb.width / 2, report.unit)}px - ${cb.strokePx / 2}px)`, width: cb.strokePx, background: cssColor(cb.color) ?? '#000' }),
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
  };

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
          /* DevExpress draws its text unkerned, every font measured (parity row 53, s39). */
          font-kerning: none;
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
        .rp-param input {
          font-family: var(--font-code, monospace); font-size: 11px; width: 11ch;
          padding: 0 2px; border: 0; border-bottom: 1px solid var(--paper-rule, #d7dee7);
          background: transparent; color: inherit;
        }
        .rp-param input:focus { outline: none; border-bottom-color: currentColor; }
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
                      DevExpress prints the band tall enough to hold it, as the
                      pages here now show -- and refusing the drag would be
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
        {onTestData && (
          /* DevExpress's "Show Report Preview with AI-generated Test Data".
             Needs bound fields, because the rows are keyed by them: a report
             with none has nothing to fill, and the Data tab is where that is
             fixed -- the same order as the data source coming first in the
             DevExpress wizard. */
          records?.length ? (
            <button
              className="wb-pill wb-pill--outline"
              onClick={onClearTestData}
              title="Back to the one placeholder record"
            >
              Test data: {records.length} rows · Clear
            </button>
          ) : (
            <button
              className="wb-pill wb-pill--outline"
              onClick={onTestData}
              disabled={testDataBusy || boundFields.length === 0}
              title={boundFields.length === 0 ? 'Bind the report to fields on the Data tab first' : `Generate sample rows for ${boundFields.join(', ')}`}
            >
              {testDataBusy ? 'Generating test data…' : 'Test data'}
            </button>
          )
        )}
        <button
          className="wb-pill wb-pill--outline"
          onClick={exportPdf}
          disabled={!report.pages.length}
          style={editable ? undefined : { marginLeft: 'auto' }}
        >
          Export PDF
        </button>
        <button
          type="button"
          className="wb-pill wb-pill--outline"
          onClick={() => setWritingPdf(true)}
          disabled={!report.pages.length || writingPdf}
          title="A PDF Forma writes itself, with the report's bookmarks as its outline. Text is in the PDF standard fonts."
        >
          {writingPdf ? 'Writing PDF…' : 'PDF with outline'}
        </button>
        <button type="button" className="wb-pill wb-pill--outline" onClick={exportXlsx} disabled={!report.pages.length}>
          Export XLSX
        </button>
        <button type="button" className="wb-pill wb-pill--outline" onClick={exportCsv} disabled={!report.pages.length}>
          Export CSV
        </button>
        <select
          className="wb-pill wb-pill--outline"
          aria-label="Export in another format"
          value=""
          disabled={!report.pages.length || !!exportKind}
          onChange={(e) => {
            const kind = e.target.value as ExportKind | '';
            if (kind) setExportKind(kind);
          }}
        >
          <option value="">{exportKind ? 'Exporting…' : 'More exports'}</option>
          <option value="docx">Word (DOCX)</option>
          <option value="rtf">RTF</option>
          <option value="html">HTML</option>
          <option value="png">Image (PNG)</option>
        </select>
      </div>

      {/* Parameters are asked BEFORE the report prints, so they belong above
          the paper rather than on it — DevExpress shows them in a panel the
          reader fills in first, and a preview that omitted them would suggest
          the report just runs. */}
      {parameters.length > 0 && (
        <div className="rp-params">
          <span className="rp-params-label">Asked before printing</span>
          {parameters.map((p) =>
            // With test data each parameter takes a value, as DevExpress asks
            // for one before printing; without it there is nothing to apply it to.
            records ? (
              <label className="rp-param" key={p.name}>
                {p.description || p.name}
                <small>{p.lifted ? 'typed' : p.type.replace('System.', '')}{p.multiValue ? ' · many' : ''}</small>
                <input
                  value={paramValues[p.name] ?? p.value}
                  onChange={(e) => setParamValues((v) => ({ ...v, [p.name]: e.target.value }))}
                  aria-label={`Value for ${p.description || p.name}`}
                  spellCheck={false}
                />
              </label>
            ) : (
              <span className="rp-param" key={p.name}>
                {p.description || p.name}
                <small>{p.lifted ? 'typed' : p.type.replace('System.', '')}{p.multiValue ? ' · many' : ''}</small>
                {p.value && <em>{p.value}</em>}
              </span>
            ),
          )}
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
        {renderPages(scale, editable, true)}
      </div>

      {/* True size, outside the workspace tree, only while printing. */}
      {printing && createPortal(<div className="rp-print-host">{renderPages(1, false, false)}</div>, document.body)}
      {/* The same, for the other exports: the continuous layout for HTML and the image. */}
      {exportKind && createPortal(
        <div ref={exportHostRef} aria-hidden style={{ position: 'fixed', left: -100000, top: 0, pointerEvents: 'none' }}>
          {renderPages(1, false, false, continuous ?? report)}
        </div>,
        document.body,
      )}
      {/* True size again, off screen but laid out, for the PDF writer to read. */}
      {writingPdf && createPortal(
        <div ref={pdfHostRef} aria-hidden style={{ position: 'fixed', left: -100000, top: 0, pointerEvents: 'none' }}>
          {renderPages(1, false, false)}
        </div>,
        document.body,
      )}
    </div>
  );
}
