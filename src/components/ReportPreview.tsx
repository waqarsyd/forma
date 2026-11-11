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
  insetsPt,
  withoutPanelChildren,
  pageHolding,
  type Appearance,
  type ChartModel,
  type PreviewChartText,
  type PlacedControl,
  type RecordValues,
  type PreviewControl,
  type PaginatedReport,
} from '../lib/reportPreview';
import { parseParameters } from '../lib/repxParameters';
import { saveBlob } from '../lib/download';
import { choicesFor, parameterLookups, sqlPreview } from '../lib/sqlPreview';
import { companionFill, companionReachableFrom, previewFromFill } from '../lib/sqlCompanion';
import { readRepxDataSources } from '../lib/repxSqlDataSource';
import type { SqlSchema } from '../lib/sqlSchema';
import type { ReportQuery } from '../lib/sqlQuery';
import { readBoundFields } from '../lib/repxBindingPlan';
import { cultureName, inCulture, reportCultures, retypeInCulture, syncLocalization } from '../lib/repxTranslate';
import { inkBounds, placeSource, unionBox, type Box } from '../lib/sourceAlign';
import { groupHeaderFields, setGroupField } from '../lib/repxGroupField';
import { unitsToPx, pxToUnits, unitsPerInch } from '../lib/reportGeometry';
import { naturalSize, pictureRect } from '../lib/pictureBox';
import { canvasMeasurer, cssFace, lineSpacingPt, lineWidthPt, oneLinePt, turnedLines, turnedWidths } from '../lib/textMeasure';
import { exportFileName, layoutContinuous, reportToCsv } from '../lib/csvExport';
import { reportToXlsxFiles, xlsxOptionsOf } from '../lib/xlsxExport';
import { buildZip } from '../lib/zip';
import { moveControl, resizeControl, setControlText, overflowsBand, deleteControl, addLabel, setCellText, duplicateControl, boundTextNotice, type ControlRef } from '../lib/repxEdit';
import { bundleName, isScriptRefusal, jobFormats, printFallbackNote, printsInBrowser, readsContinuous, readsPages, replyAfterExport, savedSentence, writingNotice, type ExportJob, type PrintFormat } from '../lib/exportJob';
import type { FormatAction } from '../lib/agentEdit';
import ControlMenu, { type MenuItem } from './ControlMenu';
import SelectionToolbar from './SelectionToolbar';
import { observeFit } from './useFitScale';
import { hasOpenLayer, isOutsideReport } from '../lib/layers';
import { copyText } from '../lib/clipboard';
import { scrollBehavior } from '../lib/motion';
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
  /**
   * An edit made here, one per gesture: a drag is written once, on letting go
   * (2026-11-11, PR-03). `continues` is set for an arrow press of the same
   * selection within 600 ms of the last (PX-21), which the history keeps as
   * the step the first press began: a held arrow filled all fifty steps.
   */
  onEdit?: (xml: string, reason: string, continues?: boolean) => void;
  /**
   * AI-generated sample rows, keyed by bound field name. When present the
   * Detail band prints once per row with each bound cell showing that row's
   * value, instead of once per layout record with placeholder text. The rows
   * are App's: this pane only draws them. Modelled on DevExpress's *Show
   * Report Preview with AI-generated Test Data*.
   */
  records?: TestRow[] | null;
  /**
   * The SQL Server database the report reads, when one is active (2026-11-09,
   * the SQL Server programme, batch DF, lib/sqlPreview.ts): its sample rows can
   * fill the Preview with no request, every field is typed as SqlClient hands
   * it to DevExpress, the query's filter and a detail report's rows apply, and
   * each parameter is asked for with its type and its lookup list.
   */
  database?: { schema: SqlSchema; query: ReportQuery | null } | null;
  /** Asks App to generate rows; absent, no Test data button is drawn. */
  onTestData?: () => void;
  onClearTestData?: () => void;
  testDataBusy?: boolean;
  /**
   * Stops the rows being written (2026-11-11, PX-28): while `testDataBusy` the
   * button turns into Stop, the one way to reach a request that a chat tool,
   * the command menu or this button started outside any turn.
   */
  onStopTestData?: () => void;
  /**
   * An export the chat asked for (2026-11-05, `lib/agentEdit.ts`'s tools):
   * made once per `nonce`, as its button in the pane would make it, and then
   * reported done so the request does not run again when the pane is next
   * opened. `formats` (2026-11-11, PX-17): several asked in one turn are
   * written together and saved as one .zip; `reply` is the chat's reply that
   * said so, which `onExported` then says the file was saved in (CV-17).
   */
  exportRequest?: { format?: PrintFormat; formats?: readonly PrintFormat[]; nonce: number; reply?: string | null } | null;
  onExportRequestDone?: () => void;
  /**
   * The conversation's messages, rewritten to say what was saved in the reply
   * that asked (2026-11-11, CV-17): App hands over its setter as it is, so
   * the rewrite is written here, in the lazy pane, not in the workspace.
   */
  onExported?: (update: <T extends { id: string; text: string }>(messages: T[]) => T[]) => void;
  /**
   * The report is someone else's, shared by a link (2026-11-11, the full
   * audit's SE-14): each link says where it goes, as a title and beside its
   * text on hover and focus, since a label reading "Sign in" can lead anywhere.
   */
  shared?: boolean;
  /**
   * The controls selected on the pane, by name, whenever that changes, and
   * none once the pane closes (2026-11-05): the chat's "this" and "these".
   */
  onSelectionChange?: (names: string[]) => void;
  /**
   * The controls a request changed, by name, outlined while that request is
   * the one shown from the conversation (the request log's pick until 2026-11-08), as Stitch outlines the
   * screens a request changed. The first is scrolled into view.
   */
  highlight?: readonly string[];
  /**
   * The workspace's own history and zoom (2026-11-05), at the corner of the
   * bench as Stitch's are. With `historyElsewhere`, App keeps one history for
   * every change to the report and reads Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y on
   * every pane (2026-11-06, lib/shortcuts.ts); the pane keeps none and draws
   * no Undo. Without it, the pane keeps its own and its Undo button. `zoom`
   * multiplies the fit to the width, and `onScaleChange` reports the scale
   * the pages are drawn at. A new `resetSelection` clears the selection.
   */
  historyElsewhere?: boolean;
  /**
   * Edit text on the floating toolbar, for one named control: App starts
   * "Change the text of …" in the box so Forma writes the words.
   */
  onEditText?: (name: string) => void;
  /** Describe a control (2026-11-10): App starts "Describe … as" in the box; read aloud by screen readers. */
  onDescribe?: (name: string) => void;
  zoom?: number;
  onScaleChange?: (scale: number) => void;
  resetSelection?: number;
  /**
   * The right-click menu's actions that are App's (2026-11-05, Stitch's menu
   * on a screen): the selection into the chat (Ctrl+L), a format from the
   * selection toolbar's menu, the zoom to the selection (F), and a short
   * notice. Duplicate (Ctrl+D), Retype, Copy the name and Delete are the
   * pane's own. See components/ControlMenu.tsx.
   */
  onAddToChat?: () => void;
  onFormat?: (action: FormatAction) => void;
  onFocusSelection?: () => void;
  onNotice?: (text: string) => void;
  /**
   * Mark an area (2026-11-08), Stitch's Mark (M): a box dragged over the
   * pages selects every control it touches, a click the one under it, and
   * `onMarked` hands the tool back to Select. Escape leaves it.
   */
  marking?: boolean;
  onMarked?: () => void;
  /**
   * Compare with the original (2026-11-11, the full audit's CP-03): the
   * pictures the report was made from, one per page, each drawn under its
   * page at the printed paper size (lib/sourceAlign.ts), with a slider for
   * how much of it shows and one that swipes between it and the report.
   * Absent, nothing is drawn.
   */
  compareWith?: readonly string[];
  /**
   * The pane's own export buttons (2026-11-06). Off in the workspace, whose
   * Export panel offers every format and reaches these exports through
   * `exportRequest`; on where nothing else offers them, a shared report's page.
   */
  exportButtons?: boolean;
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
 * Where a link goes, said plainly (2026-11-11, SE-14): the site's host, or the
 * address an email link writes to. `safeLink` has already kept only web and
 * email addresses, so anything else is named by its scheme.
 */
function destinationOf(href: string): string {
  try {
    const url = new URL(href);
    if (url.protocol === 'mailto:') return `an email to ${decodeURIComponent(url.pathname)}`;
    return url.host || url.protocol.replace(/:$/, '');
  } catch {
    return 'another page';
  }
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
  /** Drawn mirrored by a right-to-left layout (s63a): `originX` is the file's own, and moves go the other way. */
  mirrored: boolean;
  /** The rest of a multiple selection, moved by the same amount (2026-11-04). */
  others: { ref: ControlRef; originX: number; originY: number; mirrored: boolean; dpiScale: number }[];
  /** Every control the gesture carries, as `band:control`, for the drawing to shift while it lasts. */
  keys: ReadonlySet<string>;
  /** Where the pointer was last seen, in client px; unset until it moves. */
  lastX?: number;
  lastY?: number;
  /**
   * The scale the pages were drawn at when it began (2026-11-11, the PERF
   * follow-up): a zoom during the drag divided the whole distance by the new
   * scale, so the control landed short of the pointer or past it.
   */
  scale: number;
  /** Past the few pixels a click wanders (PX-09): until then it is a click, and writes nothing. */
  moved?: boolean;
} | null;

/** How far a press may wander and still be a click (2026-11-11, PX-09). */
const CLICK_SLOP_PX = 4;

/**
 * Whether a gesture's edit lands where the control already is, in the file's
 * whole units (PX-09): `moveControl` rewrites the position even then, so a
 * press that came back to its start was written as a move and an Undo step.
 */
function lands(g: NonNullable<Gesture>, dx: number, dy: number): boolean {
  const s = g.dpiScale;
  const same = (a: number, b: number) => Math.round(a / s) === Math.round(b / s);
  return g.mode === 'move'
    ? same(g.originX + (g.mirrored ? -dx : dx), g.originX) && same(g.originY + dy, g.originY)
    : same(g.originW + dx, g.originW) && same(g.originH + dy, g.originH);
}

/**
 * The edit a gesture makes, from how far the pointer went in report units:
 * the whole of it, written once when the pointer is let go (2026-11-11, the
 * full audit's PR-03). It was written on every pointer move until then, and
 * each write parsed, paginated and audited the whole report again: 12.6 ms a
 * move for a 16-control invoice, 278 ms for 501 controls, over a second for
 * 1,021. While the drag lasts the controls are drawn shifted instead.
 */
function gestureEdit(g: NonNullable<Gesture>, dx: number, dy: number): { xml: string; applied: boolean; reason: string } {
  // Back into the file's own numbers, which a control with no Dpi in a
  // millimetre report holds at a 2.54th of what prints (parity row 35).
  const s = g.dpiScale;
  // Mirrored, the screen's right is the file's left: a move goes the other
  // way, and a resize from the right-hand handle moves the file's x by
  // what the width gains, so the box grows the way it is dragged.
  const fileDx = g.mirrored ? -dx : dx;
  let result =
    g.mode === 'move'
      ? moveControl(g.baseXml, g.ref, (g.originX + fileDx) / s, (g.originY + dy) / s)
      : resizeControl(g.baseXml, g.ref, (g.originW + dx) / s, (g.originH + dy) / s);
  if (g.mode === 'resize' && g.mirrored && result.applied) {
    const moved = moveControl(result.xml, g.ref, (g.originX - dx) / s, g.originY / s);
    if (moved.applied) result = { ...moved, reason: result.reason };
  }
  // The rest of a multiple selection moves by the same amount.
  if (g.mode === 'move' && result.applied) {
    for (const o of g.others) {
      const next = moveControl(result.xml, o.ref, (o.originX + (o.mirrored ? -dx : dx)) / o.dpiScale, (o.originY + dy) / o.dpiScale);
      if (next.applied) result = { ...next, reason: `moved ${g.others.length + 1} controls` };
    }
  }
  return result;
}

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

function ChartPicture({ model, width, height, extras }: { model: ChartModel; width: number; height: number; extras?: PreviewChartText }) {
  const label = 10.5; // 8pt at 96 dpi
  const pie = model.series.find((s) => s.view === 'PieSeriesView');
  const text = (x: number, y: number, s: string, anchor: 'start' | 'middle' | 'end', fill = '#3c3c3c') => (
    <text x={x} y={y} fontSize={label} fontFamily={CHART_FONT} textAnchor={anchor} dominantBaseline="middle" fill={fill}>{s}</text>
  );
  /*
   * What the chart shows besides its data (2026-11-04, `PreviewChartText`):
   * its title above, its axis titles beside the axes, and its legend where
   * the file puts it, or none when it is hidden. Sized as a reading aid,
   * not measured against DevExpress's picture.
   */
  const titles = extras?.titles ?? [];
  const titleH = titles.length * 18;
  const showLegend = extras?.legend !== false;
  const legendBelow = /Bottom/.test(extras?.legendVertical ?? '');
  const titleText = titles.map((t, i) => (
    <text key={`t${i}`} x={width / 2} y={10 + i * 18} fontSize={13} fontFamily={CHART_FONT} textAnchor="middle" dominantBaseline="middle" fill="#3c3c3c">{t}</text>
  ));
  if (pie) {
    const slices = pie.points.filter((p) => p.value !== null && p.value > 0);
    const shares = slices.map((p) => pieShare(p.value!, pie.points));
    const legendWidth = showLegend && !legendBelow ? Math.min(width * 0.4, 30 + Math.max(...shares.map((s) => s.length)) * 6.5) : 0;
    const legendH = showLegend && legendBelow ? 18 : 0;
    const r = Math.max(4, Math.min((width - legendWidth) / 2 - 40, (height - titleH - legendH) / 2 - 24));
    const cx = (width - legendWidth) / 2;
    const cy = titleH + (height - titleH - legendH) / 2;
    const total = slices.reduce((sum, p) => sum + p.value!, 0);
    let start = 0;
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={titles[0] ?? `Pie chart of ${pie.name}`}>
        {titleText}
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
        {showLegend && !legendBelow && (
          <g transform={`translate(${width - legendWidth + 4},${titleH + 6})`}>
            {shares.map((s, i) => (
              <g key={i} transform={`translate(0,${i * 18})`}>
                <rect width={12} height={12} y={-6} fill={PIE_COLOURS[i % PIE_COLOURS.length]} />
                {text(18, 0, s, 'start')}
              </g>
            ))}
          </g>
        )}
        {showLegend && legendBelow && (
          <g transform={`translate(8,${height - 9})`}>
            {shares.map((s, i) => (
              <g key={i} transform={`translate(${i * (24 + s.length * 6.5)},0)`}>
                <rect width={12} height={12} y={-6} fill={PIE_COLOURS[i % PIE_COLOURS.length]} />
                {text(16, 0, s, 'start')}
              </g>
            ))}
          </g>
        )}
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
  const legendWidth = showLegend && !legendBelow ? Math.min(width * 0.3, 36 + Math.max(...xy.map((s) => s.name.length)) * 6.5) : 0;
  const legendH = showLegend && legendBelow ? 18 : 0;
  const yTitleW = extras?.axisY ? 16 : 0;
  const xTitleH = extras?.axisX ? 16 : 0;
  const left = 12 + yTitleW + Math.max(...ticks.map((t) => String(t).length)) * 6.5;
  const plot = { x: left, y: 10 + titleH, w: Math.max(10, width - left - legendWidth - 16), h: Math.max(10, height - 34 - titleH - xTitleH - legendH) };
  const yOf = (v: number) => plot.y + plot.h - ((v - low) / (high - low || 1)) * plot.h;
  const slot = plot.w / Math.max(1, model.arguments.length);
  const xOf = (argument: string) => plot.x + slot * (model.arguments.indexOf(argument) + 0.5);
  const bars = xy.filter((s) => !/Line|Spline|Point|Area/.test(s.view));
  const barWidth = (slot * 0.6) / Math.max(1, bars.length);
  const legendItem = (s: (typeof xy)[number], si: number) => {
    const colour = SERIES_COLOURS[si] ?? PIE_COLOURS[si % PIE_COLOURS.length];
    return (
      <>
        {bars.includes(s) ? <rect width={14} height={12} y={-6} fill={colour} /> : (
          <g><line x1={0} x2={14} y1={0} y2={0} stroke={colour} strokeWidth={2} /><circle cx={7} cy={0} r={4} fill={colour} /></g>
        )}
        {text(20, 0, s.name, 'start')}
      </>
    );
  };
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={titles[0] ?? `Chart of ${xy.map((s) => s.name).join(', ')}`}>
      {titleText}
      <rect x={plot.x} y={plot.y} width={plot.w} height={plot.h} fill="none" stroke="#c8c8c8" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={plot.x} x2={plot.x + plot.w} y1={yOf(t)} y2={yOf(t)} stroke="#e6e6e6" />
          {text(plot.x - 6, yOf(t), String(t), 'end')}
        </g>
      ))}
      {model.arguments.map((a, i) => <React.Fragment key={i}>{text(xOf(a), plot.y + plot.h + 12, a, 'middle')}</React.Fragment>)}
      {extras?.axisX && text(plot.x + plot.w / 2, plot.y + plot.h + 28, extras.axisX, 'middle')}
      {extras?.axisY && (
        <text x={10} y={plot.y + plot.h / 2} fontSize={label} fontFamily={CHART_FONT} textAnchor="middle" dominantBaseline="middle" fill="#3c3c3c" transform={`rotate(-90 10 ${plot.y + plot.h / 2})`}>{extras.axisY}</text>
      )}
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
      {showLegend && !legendBelow && (
        <g transform={`translate(${plot.x + plot.w + 12},${plot.y + 8})`}>
          {xy.map((s, si) => <g key={si} transform={`translate(0,${si * 18})`}>{legendItem(s, si)}</g>)}
        </g>
      )}
      {showLegend && legendBelow && (
        <g transform={`translate(${plot.x},${height - 9})`}>
          {xy.map((s, si) => <g key={si} transform={`translate(${xy.slice(0, si).reduce((t, o) => t + 30 + o.name.length * 6.5, 0)},0)`}>{legendItem(s, si)}</g>)}
        </g>
      )}
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
  shared = false,
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
  /** On a shared report's page: a link says where it goes (SE-14). */
  shared?: boolean;
}) {
  const u = (n: number) => unitsToPx(n, unit);
  // Resolved appearance: style, StylePriority, own attribute, then parent.
  const look = control.appearance;
  const edge = borderLine(look);
  // Right to left (s63), the box runs its text that way, and flex-start is then
  // its right edge: the physical alignment is kept by naming the other end.
  const justify = control.rtl
    ? control.align === 'right' ? 'flex-start' : control.align === 'center' ? 'center' : 'flex-end'
    : control.align === 'right' ? 'flex-end' : control.align === 'center' ? 'center' : 'flex-start';
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
    ...(control.rtl ? { direction: 'rtl' as const } : {}),
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
    /*
     * The picture as DevExpress 20.1 prints it (2026-11-04; lib/pictureBox.ts
     * holds the measured rules). An SVG the size of the box, so an image larger
     * than it is clipped as the print clips it, and `role="img"` so the PDF,
     * image, RTF, DOCX and HTML exports take it from the page as they take a
     * chart. A picture with no image here (one bound to data, one at a URL a
     * page cannot rely on loading) keeps the dashed box, saying which.
     */
    const pic = control.picture;
    const bound = control.bindings?.find((b) => b.property === 'ImageSource' || b.property === 'ImageUrl');
    if (!pic?.source) {
      return (
        <div style={{ ...frame, border: '1px dashed #999', color: '#777', fontSize: '7pt', justifyContent: 'center' }}>
          {bound ? bound.expression : pic?.url ? 'image from a URL' : 'image'}
        </div>
      );
    }
    const natural = naturalSize(pic.source, pic.useImageResolution, unit);
    const box = { w: control.width, h: placed.height };
    const r = pictureRect(box, natural, pic.sizing, pic.alignment);
    const size = pic.sizing === 'AutoSize' && natural ? natural : box;
    const tileId = `pic-tile-${control.openStart}`;
    return (
      <div style={{ ...frame, width: u(size.w), height: u(size.h), display: 'block', padding: 0 }}>
        <svg role="img" aria-label={control.name || 'picture'} width={u(size.w)} height={u(size.h)} style={{ display: 'block' }}>
          {r.tile ? (
            <>
              <defs>
                <pattern id={tileId} patternUnits="userSpaceOnUse" width={u(r.w)} height={u(r.h)}>
                  <image href={pic.source.dataUrl} width={u(r.w)} height={u(r.h)} preserveAspectRatio="none" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill={`url(#${tileId})`} />
            </>
          ) : (
            <image href={pic.source.dataUrl} x={u(r.x)} y={u(r.y)} width={u(r.w)} height={u(r.h)} preserveAspectRatio="none" />
          )}
        </svg>
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
                <ControlBox key={pc.index} control={pc.control} placed={pc} unit={unit} pageNumber={pageNumber} pageCount={pageCount} shared={shared} />
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
        <ChartPicture model={placed.chart} width={u(control.width)} height={u(placed.height)} extras={control.chartText} />
      </div>
    );
  }
  if (control.type === 'XRChart') {
    const pie = control.series.some((s) => s.view === 'PieSeriesView');
    const line = control.series.some((s) => s.view === 'LineSeriesView');
    return (
      <div style={{ ...frame, flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-end', border: '1px solid #b9c2cc', padding: 4, gap: 3 }}>
        {/* Its title, as the file names it (2026-11-04). */}
        {control.chartText?.titles.length ? (
          <div style={{ fontSize: '8pt', textAlign: 'center', color: '#3c3c3c', whiteSpace: 'nowrap', overflow: 'hidden' }}>{control.chartText.titles.join(' · ')}</div>
        ) : null}
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
          {control.chartText && (control.chartText.axisX || control.chartText.axisY) ? ` · axes ${control.chartText.axisX ?? '-'} / ${control.chartText.axisY ?? '-'}` : ''}
          {control.chartText?.legend === false ? ' · no legend' : ''}
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
            // Left to right whatever the report's direction: the cells are
            // already in the order they print, mirrored or not (s63), and a
            // row inheriting rtl would lay them out reversed again.
            <div key={r} style={{ display: 'flex', height: rowHeight, alignItems: 'stretch', direction: 'ltr' }}>
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
                    // Right to left (s63), flex-start is the cell's right edge.
                    justifyContent: cell.rtl
                      ? cell.align === 'right' ? 'flex-start' : cell.align === 'center' ? 'center' : 'flex-end'
                      : cell.align === 'right' ? 'flex-end' : cell.align === 'center' ? 'center' : 'flex-start',
                    ...(cell.rtl ? { direction: 'rtl' as const } : {}),
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
  // Where it goes, on a shared report's page (2026-11-11, SE-14): the
  // `rp-link` rules' note under it on hover and focus, and the same words as
  // its description for a screen reader. No `title` as well: a mouse showed
  // the browser's tooltip on top of the note, the same words twice.
  const goes = placed.url && shared ? destinationOf(placed.url) : null;
  const link = placed.url
    ? {
        href: placed.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        ...(goes ? { 'aria-description': `Opens ${goes}`, className: 'rp-link', 'data-goes': `Opens ${goes}` } : {}),
        style: { ...frame, color: frame.color ?? 'inherit', textDecoration: frame.textDecoration ?? 'none' },
      }
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
    const spacingPt = lineSpacingPt(control.fontFamily, sizePt, control);
    /*
     * A quarter turn longer than its box (parity row 54, 2026-11-04) prints
     * the lines DevExpress keeps: laid out along the box, again at the width
     * of its widest line, as many lines as fit across, the last continued by
     * characters (`turnedLines`). Until then the whole text was drawn on one
     * line, cut at the box's edge. Where nothing can measure, as under jsdom,
     * it is still one line.
     */
    const widths = Math.abs(control.angle % 180) === 90 ? turnedWidths(font) : null;
    let lines = [text];
    if (widths) {
      const inset = insetsPt(control.appearance, control.borders);
      const toPt = (u: number) => (u / unitsPerInch(unit)) * 72;
      const laid = turnedLines(text, widths, toPt(placed.height) - inset.top - inset.bottom, toPt(control.width) - inset.left - inset.right, oneLinePt(control.fontFamily, sizePt, control), spacingPt, control.wordWrap);
      lines = laid.length ? laid : [''];
    }
    const w = (Math.max(...lines.map((l) => lineWidthPt(l, font) ?? l.length * sizePt * 0.5)) * 96) / 72;
    const lineH = (spacingPt * 96) / 72;
    const h = lineH * lines.length;
    const turn = (control.angle * Math.PI) / 180;
    const [boxW, boxH] = [Math.abs(w * Math.cos(turn)) + Math.abs(h * Math.sin(turn)), Math.abs(w * Math.sin(turn)) + Math.abs(h * Math.cos(turn))];
    return (
      <Box {...link}>
        <span style={{ position: 'relative', flex: 'none', width: boxW, height: boxH }}>
          <span style={{ position: 'absolute', left: '50%', top: '50%', width: w, lineHeight: `${lineH}px`, whiteSpace: 'pre', transform: `translate(-50%, -50%) rotate(${-control.angle}deg)` }}>
            {lines.join('\n')}
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

/**
 * One parameter's field, as DevExpress's parameters panel asks for it
 * (2026-11-09, the SQL Server programme, item 28): a number for a number, a
 * date for a date, Yes or No for a Boolean, the lookup list's values when the
 * report has one, a box per value for a multi-value list, and text otherwise.
 * The value goes on as text, comma separated for a list, as before.
 */
function ParameterInput({ type, multi, choices, value, onChange, label }: { type: string; multi: boolean; choices?: string[]; value: string; onChange: (value: string) => void; label: string }) {
  if (choices?.length && multi) {
    const chosen = new Set(value.split(',').map((v) => v.trim()).filter(Boolean));
    return (
      <span role="group" aria-label={label} style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
        {choices.map((c) => (
          <label key={c} style={{ display: 'inline-flex', gap: 3, alignItems: 'center', fontSize: 12 }}>
            <input
              type="checkbox"
              checked={chosen.has(c)}
              onChange={(e) => onChange(choices.filter((x) => (x === c ? e.target.checked : chosen.has(x))).join(','))}
            />
            {c}
          </label>
        ))}
      </span>
    );
  }
  if (choices?.length) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {!choices.includes(value) && <option value={value}>{value || '—'}</option>}
        {choices.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  }
  if (type === 'System.Boolean') {
    return (
      <select value={/^(true|1)$/i.test(value) ? 'True' : 'False'} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="True">Yes</option>
        <option value="False">No</option>
      </select>
    );
  }
  const numeric = /^System\.(Int16|Int32|Int64|Decimal|Double|Single)$/.test(type);
  const date = type === 'System.DateTime';
  return (
    <input
      type={multi ? 'text' : numeric ? 'number' : date ? 'date' : 'text'}
      step={numeric && /Int/.test(type) ? 1 : numeric ? 'any' : undefined}
      value={date && !multi ? value.slice(0, 10) : value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      placeholder={multi ? 'values, comma between' : undefined}
      spellCheck={false}
    />
  );
}

/** A text's lines as a text area hands them back: one break, `\n`, whatever the file wrote. */
const asLines = (text: string) => text.replace(/\r\n?/g, '\n');

/**
 * The retype editor (2026-11-11, the full audit's PX-07): a text area for a
 * text of several lines, where Enter keeps the words and Shift+Enter starts a
 * new line; one line otherwise. Only ever an `<input>` until then, which drops
 * the line breaks from its value, so the first key typed into a three-line
 * address wrote it back as one run-together line.
 */
function RetypeField({ multiline, label, value, style, onChange, onDone, onCancel }: {
  multiline: boolean;
  label: string;
  value: string;
  style: React.CSSProperties;
  onChange: (value: string) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const props = {
    className: 'rp-textedit',
    autoFocus: true,
    value,
    'aria-label': label,
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    onBlur: onDone,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.nativeEvent.isComposing && !(multiline && e.shiftKey)) {
        e.preventDefault();
        e.currentTarget.blur();
      }
      // Escape abandons the edit rather than committing it, which is what
      // Escape means everywhere else in this app.
      if (e.key === 'Escape') onCancel();
      e.stopPropagation();
    },
  };
  return multiline ? <textarea {...props} rows={1} style={{ ...style, resize: 'none', lineHeight: 'normal' }} /> : <input {...props} style={style} />;
}

/*
 * A control drawn again only when what it prints changes (2026-11-11, PR-03):
 * a drag draws the pane once a frame, and every control on every page was
 * drawn with it. Its props come from the memoised pagination, so they keep
 * their identity until the report or its rows change.
 */
const PrintedControl = React.memo(ControlBox);

// Drawn again only when its props change (2026-11-11, PR-05): App hands it
// functions that keep their identity (`Steady` in App.tsx), so typing in the
// box and a streamed reply no longer draw every page again.
export default React.memo(ReportPreview);

function ReportPreview({ repxContent, layout, title, onEdit, records: given, database, onTestData, onClearTestData, testDataBusy, onStopTestData, exportRequest, onExportRequestDone, onExported, shared = false, onSelectionChange, highlight, historyElsewhere = false, onEditText, onDescribe, zoom = 1, onScaleChange, resetSelection, onAddToChat, onFormat, onFocusSelection, onNotice, exportButtons = true, marking = false, onMarked, compareWith }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const highlightKey = (highlight ?? []).join('\n');
  const changedNames = useMemo(() => new Set(highlightKey ? highlightKey.split('\n') : []), [highlightKey]);
  /*
   * The first changed control into view, once per set of names. On a page a
   * long report does not draw (2026-11-11, PX-26), that page's frame first,
   * which draws it, and then the control: until then Go to and a request's
   * changes past the few pages around the view scrolled nowhere.
   */
  const reportRef = useRef<PaginatedReport | null>(null);
  useEffect(() => {
    if (!highlightKey) return;
    const toChanged = () => {
      const hit = viewportRef.current?.querySelector('.rp-hit.is-changed');
      hit?.scrollIntoView?.({ block: 'center', behavior: scrollBehavior() });
      return !!hit;
    };
    let later = 0;
    const t = setTimeout(() => {
      if (toChanged() || !reportRef.current) return;
      const index = pageHolding(reportRef.current, new Set(highlightKey.split('\n')));
      const wrap = index < 0 ? null : viewportRef.current?.querySelectorAll('.rp-page-wrap')[index];
      if (!wrap) return;
      wrap.scrollIntoView?.({ block: 'start' });
      later = window.setTimeout(toChanged, 120);
    }, 80);
    return () => {
      clearTimeout(t);
      clearTimeout(later);
    };
  }, [highlightKey]);
  /* The width the pages fit, times the workspace's zoom (2026-11-05). */
  const [fitScale, setFitScale] = useState(1);
  const scale = fitScale * zoom;
  const reportScale = useRef(onScaleChange);
  reportScale.current = onScaleChange;
  useEffect(() => reportScale.current?.(scale), [scale]);
  const [showBands, setShowBands] = useState(true);
  const [selected, setSelected] = useState<ControlRef | null>(null);
  /*
   * More controls selected beside `selected` (2026-11-04): Shift+click adds or
   * takes one away, and arrows, Delete and a drag act on them all. `selected`
   * stays the one the toolbar describes and the handle resizes.
   */
  const [also, setAlso] = useState<ControlRef[]>([]);
  /* The box being marked, in the window's coordinates, while it is dragged (2026-11-08). */
  const [markBox, setMarkBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const markLayerRef = useRef<HTMLDivElement>(null);
  const markDone = useRef(onMarked);
  markDone.current = onMarked;
  useEffect(() => {
    if (!marking) return;
    const leave = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMarkBox(null);
      markDone.current?.();
    };
    window.addEventListener('keydown', leave);
    return () => window.removeEventListener('keydown', leave);
  }, [marking]);
  /** Every control the box touches, each once however many pages draw it; a click, the one under it. */
  const finishMark = (box: { x0: number; y0: number; x1: number; y1: number }) => {
    const left = Math.min(box.x0, box.x1);
    const right = Math.max(box.x0, box.x1);
    const top = Math.min(box.y0, box.y1);
    const bottom = Math.max(box.y0, box.y1);
    const click = right - left < 4 && bottom - top < 4;
    const seen = new Set<string>();
    const refs: ControlRef[] = [];
    for (const el of viewportRef.current?.querySelectorAll<HTMLElement>('.rp-hit[data-band]') ?? []) {
      const r = el.getBoundingClientRect();
      const touched = click
        ? left >= r.left && left <= r.right && top >= r.top && top <= r.bottom
        : r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom;
      const key = `${el.dataset.band}:${el.dataset.control}`;
      if (!touched || seen.has(key)) continue;
      seen.add(key);
      refs.push({ band: Number(el.dataset.band), control: Number(el.dataset.control) });
    }
    setSelected(refs[0] ?? null);
    setAlso(refs.slice(1));
    markDone.current?.();
  };
  // Cleared from outside: the selection toolbar's Clear and Delete (2026-11-05).
  useEffect(() => {
    if (resetSelection === undefined) return;
    setSelected(null);
    setAlso([]);
  }, [resetSelection]);
  const [editingText, setEditingText] = useState<string | null>(null);
  /*
   * Which placement of the label is being retyped, `page:band`. A Detail band
   * prints once per record, and until 2026-11-04 the editor opened in every
   * placement of the label at once, each taking the focus from the last, so
   * the blur closed the edit before a key was typed.
   */
  const [editingAt, setEditingAt] = useState<string | null>(null);
  /** A table cell being retyped, found from where the double-click landed. */
  const [editingCell, setEditingCell] = useState<{ at: string; ref: ControlRef; row: number; cell: number; text: string; box: { left: number; top: number; width: number; height: number } } | null>(null);
  /** Why the last edit was declined, shown in the toolbar until the next one. */
  const [editNote, setEditNote] = useState<string | null>(null);
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

  /** `continues`: the edit carries on the last step, as a held arrow does (PX-21). */
  const commit = (result: { xml: string; applied: boolean; reason: string }, previous: string, continues = false) => {
    if (!result.applied) setEditNote(result.reason);
    if (!result.applied || !onEdit) return;
    setEditNote(null);
    lastWrote.current = result.xml;
    // None kept when the workspace keeps the history: this one was never
    // read there, and held a full copy of the file per edit (2026-11-06).
    if (!historyElsewhere && !(continues && undoStack.current.length)) {
      undoStack.current.push({ xml: previous, reason: result.reason });
      setUndoDepth(undoStack.current.length);
    }
    // A report in two languages prints its own from its Default items (CP-06).
    const xml = syncLocalization(result.xml);
    if (continues) onEdit(xml, result.reason, true);
    else onEdit(xml, result.reason);
  };

  /**
   * One edit applied to several controls, as one undo step. Each is applied
   * to the file the one before left, so indexes must still hold: a delete
   * goes from the last control back to the first.
   */
  const applyAll = (refs: readonly ControlRef[], edit: (xml: string, ref: ControlRef) => { xml: string; applied: boolean; reason: string }, what: string, continues = false) => {
    if (!repxContent || !refs.length) return;
    let xml = repxContent;
    const reasons: string[] = [];
    for (const ref of refs) {
      const result = edit(xml, ref);
      if (!result.applied) {
        commit(result, repxContent);
        return;
      }
      xml = result.xml;
      reasons.push(result.reason);
    }
    commit({ xml, applied: true, reason: refs.length === 1 ? reasons[0] : `${what} ${refs.length} controls` }, repxContent, continues);
  };
  /** The last arrow press: which selection it moved, and when (PX-21). */
  const lastNudge = useRef<{ key: string; at: number } | null>(null);
  /**
   * The file this pane last wrote: a press carries on the last step only while
   * the report is still that file, so an Undo or a chat edit between two
   * presses starts a new step rather than folding into one it no longer follows.
   */
  const lastWrote = useRef<string | null>(null);

  /**
   * Why a label or a cell that prints a field opens no editor (2026-11-11, the
   * full audit's PX-08b): said under the bar and as the workspace's notice.
   * The retype was refused only on letting go until then, and for a label not
   * at all, so the typed words showed here and DevExpress printed the field.
   */
  const sayBound = (reason: string) => {
    setEditNote(reason);
    onNotice?.(reason.charAt(0).toUpperCase() + reason.slice(1));
  };
  /** The retype editor opened on one placement of a label, unless it prints a field. */
  const startRetype = (ref: ControlRef, at: string, text: string) => {
    const bound = repxContent ? boundTextNotice(repxContent, ref) : null;
    if (bound) {
      sayBound(bound);
      return;
    }
    setEditingAt(at);
    setEditingText(text);
  };

  /** The right-click menu, where it opened and on which placement of the control. */
  const [menu, setMenu] = useState<{ x: number; y: number; at: string } | null>(null);
  /** The copies a duplicate made, selected once the file holding them is parsed. */
  const selectAfter = useRef<string[] | null>(null);
  /** Duplicate the selection, last first so the indexes hold, and select the copies (Ctrl+D). */
  const duplicateSelection = (chosen: readonly ControlRef[]) => {
    // A panel's copy holds its children: they are not copied again (PX-10).
    const refs = withoutPanelChildren(structureBands, chosen);
    if (!repxContent || !refs.length) return;
    let xml = repxContent;
    const names: string[] = [];
    for (const ref of [...refs].sort((a, b) => b.band - a.band || b.control - a.control)) {
      const result = duplicateControl(xml, ref);
      if (!result.applied) { commit(result, repxContent); return; }
      xml = result.xml;
      const name = / as "([^"]+)"$/.exec(result.reason)?.[1];
      if (name) names.push(name);
    }
    selectAfter.current = names;
    commit({ xml, applied: true, reason: refs.length === 1 ? `duplicated as ${names[0]}` : `duplicated ${refs.length} controls` }, repxContent);
  };

  /**
   * The selection deleted, as one step: the Delete key's, the right-click
   * menu's and the floating toolbar's, by the selection itself (2026-11-06).
   * The toolbar's went through App by name until then, and skipped a control
   * with none; the pane drew a Delete of its own beside it.
   */
  const deleteSelected = () => {
    if (!selected) return;
    // A panel deleted takes its children with it (PX-10).
    applyAll(withoutPanelChildren(structureBands, [selected, ...also]).sort((a, b) => b.band - a.band || b.control - a.control), deleteControl, 'deleted');
    setSelected(null);
    setAlso([]);
  };
  /** The selected controls' names on the clipboard, saying so; the menu's and the toolbar's. */
  const copyNames = (names: readonly string[]) => {
    if (!names.length) return;
    void copyText(names.join(', ')).then((ok) => onNotice?.(ok ? (names.length > 1 ? 'Copied the names' : `Copied ${names[0]}`) : 'The browser did not allow copying'));
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
  const [typedParams, setParamValues] = useState<Record<string, string>>({});
  /*
   * The database's part (2026-11-09, batch DF): its sample rows, used when the
   * reader asks for them and no AI rows are shown; the types every row is read
   * with; and each parameter's lookup list, a cascade read from the values
   * typed so far. A multi-value parameter with a list starts with all of it,
   * as an empty one would keep no row at all.
   */
  const sql = useMemo(() => (database ? sqlPreview(repxContent, database.schema, database.query) : null), [repxContent, database]);
  const [dbRowsOn, setDbRowsOn] = useState(false);
  useEffect(() => setDbRowsOn(false), [database]);
  /*
   * Live rows (2026-11-09, the SQL Server programme, Phase 2, item 37): the
   * report's own data source filled on this PC by Forma Designer, with the
   * parameter values typed here, the database applying its filter. Offered
   * only on a page Forma Designer answers (lib/sqlCompanion.ts); a stored
   * procedure runs only from the button that names it.
   */
  const ownSource = useMemo(() => readRepxDataSources(repxContent ?? '')[0] ?? null, [repxContent]);
  const liveReachable = typeof window !== 'undefined' && companionReachableFrom(window.location.origin);
  const [live, setLive] = useState<ReturnType<typeof previewFromFill> | null>(null);
  const [liveLine, setLiveLine] = useState('');
  const [liveProcedures, setLiveProcedures] = useState<string[]>([]);
  // Once the person has run this report's procedure, a refresh runs it again; another source asks again.
  const [consented, setConsented] = useState(false);
  const liveKey = ownSource ? `${ownSource.connectionName}|${ownSource.queries.map((q) => q.name).join(',')}` : '';
  useEffect(() => {
    // A read still under way is the old source's, and its rows must not land on this one (2026-11-11, PXB review).
    liveRead.current?.abort();
    liveRead.current = null;
    setLiveReading(false);
    setLive(null);
    setLiveLine('');
    setLiveLink(null);
    setLiveProcedures([]);
    setConsented(false);
  }, [liveKey]);
  const records = given ?? (live ? live.rows : dbRowsOn && sql?.rows?.length ? sql.rows : null);
  const choices = useMemo(() => {
    if (live) return live.choices;
    if (!database) return {} as Record<string, string[]>;
    const multi = new Set(parseParameters(repxContent).filter((p) => p.multiValue).map((p) => p.name));
    return choicesFor(database.schema, repxContent ?? '', typedParams, multi);
  }, [database, repxContent, typedParams, live]);
  const paramValues = useMemo(() => {
    const defaults: Record<string, string> = {};
    for (const p of parseParameters(repxContent)) if (p.multiValue && !p.value && choices[p.name]?.length) defaults[p.name] = choices[p.name].join(',');
    return { ...defaults, ...typedParams };
  }, [repxContent, choices, typedParams]);
  const dataOptions = useMemo(
    () => (live ? { rowTypes: live.hints, sourceFilter: null, related: live.related } : { rowTypes: sql?.hints, sourceFilter: sql?.sourceFilter ?? null, related: sql?.related }),
    [sql, live],
  );
  /*
   * A read under way (2026-11-11, the full audit's SD-23b and SD-14c): Live
   * rows is greyed while it lasts, so a second press is not a second fill of
   * the whole result, and Cancel stops waiting for it. Its way forward, the
   * download or the DevExpress trial, is a link after the line (the SDW
   * follow-up), where only the words were shown. It opens a new tab, as the
   * Data tab's companion links do, even for Forma's own /download: the same
   * tab left the workspace in the middle of the task.
   */
  const liveRead =useRef<AbortController | null>(null);
  const [liveReading, setLiveReading] = useState(false);
  const [liveLink, setLiveLink] = useState<{ href: string; label: string } | null>(null);
  useEffect(() => () => liveRead.current?.abort(), []);
  const cancelLive = () => {
    liveRead.current?.abort();
    liveRead.current = null;
    setLiveReading(false);
    setLiveLine('');
  };
  const fillLive = async (procedures = consented) => {
    if (!repxContent || !ownSource || liveRead.current) return;
    if (procedures) setConsented(true);
    const reading = new AbortController();
    liveRead.current = reading;
    setLiveReading(true);
    setLiveLink(null);
    setLiveLine('Reading from your SQL Server…');
    const out = await companionFill(repxContent, paramValues, procedures, reading.signal);
    if (reading.signal.aborted) return;
    liveRead.current = null;
    setLiveReading(false);
    if (out.kind === 'filled') {
      const member = /<XtraReportsLayoutSerializer\b[^>]*\sDataMember="([^"]*)"/.exec(repxContent)?.[1]?.split('.')[0] ?? ownSource.queries[0]?.name ?? '';
      setLive(previewFromFill(out.queries, member, ownSource.relations, parameterLookups(repxContent)));
      setLiveProcedures([]);
      setLiveLine('');
    } else if (out.kind === 'procedures') {
      setLiveProcedures(out.names);
      setLiveLine(`The report runs the stored procedure ${out.names.join(', ')}, which could change data: run it only if you know it only reads.`);
    } else if (out.kind === 'missing') {
      setLiveLine(`Forma Designer keeps no connection named ${out.names.join(', ')}. Add it from its tray menu, SQL Server connections.`);
    } else {
      setLiveLine(out.message);
      setLiveLink(out.link ?? null);
    }
  };
  /*
   * The drill-down groups the reader has opened or closed (s56), by key. The
   * toggle beside a group's label flips one, as a click on the label does in
   * DevExpress's viewer, and every export prints what the pane shows. Kept
   * while a report is edited; another report, or another toggle, starts over.
   */
  const [drillToggled, setDrillToggled] = useState<ReadonlySet<string>>(() => new Set());
  const drillIdentity = `${title ?? ''}|${/DrillDownControl="[^"]*"/.exec(repxContent ?? '')?.[0] ?? ''}`;
  useEffect(() => setDrillToggled(new Set()), [drillIdentity]);
  const toggleDrill = useCallback((key: string) => {
    setDrillToggled((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  /*
   * The report's languages (2026-11-11, the full audit's CP-06): a report
   * with DevExpress LocalizationItems is drawn in the one chosen, as
   * DevExpress prints it for that culture; '' is its own language. Edits
   * still write the file as it is.
   */
  /*
   * Compare with the original (CP-03): each picture's size and ink, read once
   * from a small copy, then how much of it shows (0 to 1) and how far across
   * the page it reaches from the left (0 to 100), the rest being the report.
   */
  const [sourceInfo, setSourceInfo] = useState<Record<string, { width: number; height: number; ink: Box | null }>>({});
  const [sourceOpacity, setSourceOpacity] = useState(0.5);
  const [sourceSwipe, setSourceSwipe] = useState(100);
  const sourcesAsked = useRef(new Set<string>());
  useEffect(() => {
    for (const src of compareWith ?? []) {
      if (sourcesAsked.current.has(src)) continue;
      sourcesAsked.current.add(src);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight, 1));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        let ink: Box | null = null;
        try {
          const ctx = Object.assign(document.createElement('canvas'), { width: w, height: h }).getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            const small = inkBounds(ctx.getImageData(0, 0, w, h).data, w, h);
            ink = small && { x0: small.x0 / scale, y0: small.y0 / scale, x1: small.x1 / scale, y1: small.y1 / scale };
          }
        } catch {
          // A picture the canvas will not read is laid at the page's width.
        }
        setSourceInfo((prev) => ({ ...prev, [src]: { width: img.naturalWidth, height: img.naturalHeight, ink } }));
      };
      img.src = src;
    }
  }, [compareWith]);

  const cultures = useMemo(() => reportCultures(repxContent ?? ''), [repxContent]);
  const [culture, setCulture] = useState('');
  const shownCulture = cultures.includes(culture) ? culture : '';
  /** A retype made while another language shows is that language's words, not the report's own (the review of CP-06). */
  const retyped = (result: { xml: string; applied: boolean; reason: string }) =>
    shownCulture && result.applied && repxContent ? { ...result, xml: retypeInCulture(repxContent, result.xml, shownCulture) } : result;
  const { structure, report } = useMemo(() => {
    const parsed = parseReportStructure(shownCulture && repxContent ? inCulture(repxContent, shownCulture) : repxContent);
    // With sample rows the record count is theirs; otherwise it is the number
    // of rows the model read out of the source document.
    const count = records?.length ? records.length : recordCountFromLayout(layout);
    // The rows themselves too, now: a record's values decide how tall it grows.
    return {
      structure: parsed,
      report: paginate(parsed, count, { measure, rows: records ?? null, parameters: paramValues, drillToggled, ...dataOptions }) as PaginatedReport,
    };
  }, [repxContent, shownCulture, layout, records, measure, paramValues, drillToggled, dataOptions]);

  reportRef.current = report;
  const boundFields = useMemo(() => readBoundFields(repxContent), [repxContent]);
  const structureBands = structure.bands;

  // The selection by name, for the chat (2026-11-05): see `onSelectionChange`.
  const selectionNames = useMemo(
    () =>
      (selected ? [selected, ...also] : [])
        .map((r) => structure.bands[r.band]?.controls[r.control]?.name)
        .filter((n): n is string => Boolean(n)),
    [selected, also, structure],
  );
  const reportSelection = useRef(onSelectionChange);
  reportSelection.current = onSelectionChange;
  const selectionKey = selectionNames.join('\n');
  useEffect(() => {
    reportSelection.current?.(selectionKey ? selectionKey.split('\n') : []);
  }, [selectionKey]);
  useEffect(() => () => reportSelection.current?.([]), []);
  // The copies a duplicate made, selected as Stitch selects a duplicate.
  useEffect(() => {
    const names = selectAfter.current;
    if (!names) return;
    selectAfter.current = null;
    const refs = structureBands.flatMap((b, band) => b.controls.flatMap((c, control) => (c.name && names.includes(c.name) ? [{ band, control }] : [])));
    if (!refs.length) return;
    setSelected(refs[0]);
    setAlso(refs.slice(1));
  }, [structureBands]);
  /** The `Ref` of the control that toggles Detail, when it has a drill-down. */
  const drillRef = structureBands.find((b) => b.kind === 'Detail')?.drillDown?.control;
  const watermark = structure.watermark;
  // The columns DevExpress actually prints, which a declared count with no Mode
  // is not; in practice only Detail ever declares any.
  const multiColumn = structureBands
    .map((b) => activeColumns(b.columns, report.content.width))
    .find((c) => c !== null) ?? null;
  const parameters = useMemo(() => parseParameters(repxContent), [repxContent]);
  /*
   * The field each group header breaks on, to choose another (2026-11-04,
   * lib/repxGroupField.ts). Offered from the fields the report binds and the
   * test rows' columns, so over test data a choice regroups the pages at once.
   */
  const groupChoices = useMemo(() => groupHeaderFields(repxContent), [repxContent]);
  const groupOptions = (current: string | null) =>
    [...new Set([current ?? '', ...boundFields, ...Object.keys(records?.[0] ?? {})].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const regroup = (band: string, field: string) => {
    if (!repxContent) return;
    commit(setGroupField(repxContent, band, field), repxContent);
  };

  const pageW = unitsToPx(report.page.width, report.unit);

  // The fit to the width, shared with the Mockup (useFitScale.ts, 2026-11-06).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    return observeFit(el, pageW, setFitScale);
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
    // A retype still open is finished first, and this press does nothing else
    // (2026-11-06): the drag would start from the file before the new words,
    // and its first move wrote them away.
    if (editingText !== null || editingCell !== null) {
      (document.activeElement as HTMLElement | null)?.blur?.();
      return;
    }
    const same = (a: ControlRef) => a.band === ref.band && a.control === ref.control;
    /*
     * A finger on a control not yet selected only selects it (2026-11-11, the
     * full audit's PR-13 and PX-11): every control is a hit target, so on a
     * phone a swipe that began on text dragged it, an edit each time, where
     * the person meant to scroll. The page scrolls under an unselected
     * control (`touch-action` in the rules below); a selected one drags.
     */
    if (event.pointerType === 'touch' && mode === 'move' && !(selected && same(selected)) && !also.some(same)) {
      setSelected(ref);
      setAlso([]);
      setEditingText(null);
      setEditingCell(null);
      return;
    }
    // Shift+click adds a control to the selection or takes it away, and drags nothing.
    if (mode === 'move' && event.shiftKey && selected) {
      if (same(selected)) {
        setSelected(also[0] ?? null);
        setAlso(also.slice(1));
      } else {
        setAlso(also.some(same) ? also.filter((a) => !same(a)) : [...also, ref]);
      }
      return;
    }
    // A drag on one of several selected moves them all; anywhere else starts
    // over. The rest of the group stays selected beside the one pressed
    // (2026-11-06): `also` kept the pressed control too, so a Delete then
    // removed it twice, the second time taking the next control in its band.
    const chosen = selected ? [selected, ...also] : also;
    const group = mode === 'move' && chosen.some(same) ? chosen.filter((a) => !same(a)) : [];
    setAlso(group);
    setSelected(ref);
    setEditingText(null);
    setEditingCell(null);
    /*
     * What the drag writes: the selection less every control whose panel is
     * in it too (PX-10), which the panel's move carries. The one pressed may
     * be such a child, so the write is led by the first that is left; the
     * drawing still shifts every selected control, children included.
     */
    const [lead, ...rest] = mode === 'move' ? withoutPanelChildren(structureBands, [ref, ...group]) : [ref];
    const leadControl = (lead && structureBands[lead.band]?.controls[lead.control]) || control;
    // One undo entry per gesture: the one write it makes, on letting go (`commit`).
    gesture.current = {
      ref: lead ?? ref,
      mode,
      baseXml: repxContent,
      fromX: event.clientX,
      fromY: event.clientY,
      // The file's own x: a mirrored right-to-left layout (s63a) draws the
      // control elsewhere, and a drag there moves it the other way in the file.
      originX: leadControl.fileX ?? leadControl.x,
      mirrored: leadControl.fileX !== undefined,
      originY: leadControl.y,
      originW: leadControl.width,
      originH: leadControl.height,
      dpiScale: leadControl.dpiScale ?? 1,
      others: rest.flatMap((r) => {
        const c = structureBands[r.band]?.controls[r.control];
        return c ? [{ ref: r, originX: c.fileX ?? c.x, originY: c.y, mirrored: c.fileX !== undefined, dpiScale: c.dpiScale ?? 1 }] : [];
      }),
      keys: new Set([ref, ...group].map((r) => `${r.band}:${r.control}`)),
      scale,
    };
  };

  /*
   * A drag (2026-11-11, the full audit's PR-03): the pointer is read once a
   * frame and the controls it carries are drawn shifted by it, in this pane's
   * own state; the report is written once, when the pointer is let go, so a
   * drag is one write and one Undo whatever its length. The listeners are
   * added once and read the scale, the unit and `commit` as they are now:
   * they were added again on every render of the workspace, `onEdit` being a
   * new function each time.
   */
  const [dragShift, setDragShift] = useState<{ keys: ReadonlySet<string>; mode: 'move' | 'resize'; dx: number; dy: number } | null>(null);
  const dragNow = useRef({ unit: report.unit, commit });
  dragNow.current = { unit: report.unit, commit };
  useEffect(() => {
    if (!editable) return;
    let frame = 0;
    // How far the pointer went in page px: the zoom divided out, as it is a
    // presentation scale, not a unit; the scale the drag began at, which a
    // zoom part way through does not change (2026-11-11).
    const travel = (g: NonNullable<Gesture>) => ({ dx: ((g.lastX ?? g.fromX) - g.fromX) / g.scale, dy: ((g.lastY ?? g.fromY) - g.fromY) / g.scale });
    const onMove = (event: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      // A click wanders a pixel or two: not a drag until past the slop (PX-09).
      if (!g.moved && Math.hypot(event.clientX - g.fromX, event.clientY - g.fromY) < CLICK_SLOP_PX) return;
      g.moved = true;
      g.lastX = event.clientX;
      g.lastY = event.clientY;
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        const now = gesture.current;
        if (now) setDragShift({ keys: now.keys, mode: now.mode, ...travel(now) });
      });
    };
    const end = (write: boolean) => {
      const g = gesture.current;
      gesture.current = null;
      cancelAnimationFrame(frame);
      frame = 0;
      setDragShift(null);
      if (!write || !g || !g.moved || g.lastX === undefined) return;
      const { dx, dy } = travel(g);
      const { unit } = dragNow.current;
      const [ux, uy] = [pxToUnits(dx, unit), pxToUnits(dy, unit)];
      // Back where it began, in the file's whole units: a click, not an edit (PX-09).
      if (lands(g, ux, uy)) return;
      dragNow.current.commit(gestureEdit(g, ux, uy), g.baseXml);
    };
    const onUp = () => end(true);
    // A cancelled pointer (a touch taken over by a scroll) leaves the report as it was.
    const onCancel = () => end(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [editable]);

  useEffect(() => {
    if (!editable) return;
    const onKey = (event: KeyboardEvent) => {
      if (editingText !== null || editingCell !== null) return;
      // Typing in a field elsewhere on the page (a parameter, the chat) is not an edit of the report.
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      // Nor is a key that went to a menu, a dialog or the conversation, or one
      // anything open over the report took (2026-11-06, lib/layers.ts): the
      // arrows that moved through the right-click menu also moved the control,
      // and Delete with the Share dialog open deleted it.
      if (event.defaultPrevented || hasOpenLayer() || isOutsideReport(target)) return;
      // Undo is the workspace's when it keeps the history (App reads Ctrl+Z on every pane).
      if (!historyElsewhere && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (event.key === 'Escape') { setSelected(null); setAlso([]); return; }
      if (!selected || !selectedControl || !repxContent) return;
      const chosen = [selected, ...also];
      // Delete takes the whole selection, last first so the indexes still hold.
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
        return;
      }
      // The right-click menu's keys (2026-11-05), Stitch's: Ctrl+D duplicates,
      // Ctrl+L puts the selection in the chat, F zooms to it.
      const mod = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
      if (mod && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(chosen); return; }
      if (mod && event.key.toLowerCase() === 'l' && onAddToChat) { event.preventDefault(); onAddToChat(); return; }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'f' && onFocusSelection) { event.preventDefault(); onFocusSelection(); return; }
      const step = event.shiftKey ? 10 : 1;
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
      };
      const delta = nudge[event.key];
      if (!delta) return;
      // Arrow keys are the precision half of direct manipulation: a drag gets
      // you close, one unit at a time gets you exact. A unit of the file's own
      // numbers, so they stay whole whatever the control's Dpi. Every selected
      // control moves, as one undo step; a child with its panel only once,
      // with it (PX-10). Presses of the same selection less than 600 ms apart,
      // a held key's repeats among them, carry on one step (PX-21).
      event.preventDefault();
      const moving = withoutPanelChildren(structureBands, chosen);
      const key = moving.map((r) => `${r.band}:${r.control}`).join(' ');
      const now = Date.now();
      const continues = lastNudge.current?.key === key && now - lastNudge.current.at < 600 && repxContent === lastWrote.current;
      lastNudge.current = { key, at: now };
      applyAll(moving, (xml, ref) => {
        const c = structureBands[ref.band]?.controls[ref.control];
        if (!c) return { xml, applied: false, reason: 'a selected control is gone' };
        const s = c.dpiScale ?? 1;
        // Mirrored (s63a), the left arrow moves the control left on the page,
        // which is right in the file.
        const mirrored = c.fileX !== undefined;
        return moveControl(xml, ref, (c.fileX ?? c.x) / s + (mirrored ? -delta[0] : delta[0]), c.y / s + delta[1]);
      }, 'moved', continues);
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

  /**
   * Why the last export was not written, said under the bar rather than only
   * in the console. The PDF writer's alone until 2026-11-06 (the workspace
   * audit): Word, RTF, HTML and the image failed in silence, and a CSV or
   * Excel export that threw took the pane down with it.
   */
  const [exportNote, setExportNote] = useState<string | null>(null);
  const failedText = (what: string, err: unknown) => {
    console.error(`Forma could not write the ${what}.`, err);
    return `Forma could not write the ${what}${err instanceof Error && err.message ? `: ${err.message}` : '.'}`;
  };
  /**
   * A file handed to the browser to save, under its own name. Through
   * lib/download.ts (2026-11-11, the full audit's PR-17): the address was let
   * go straight after the click, before some browsers read it.
   */
  const save = useCallback((data: BlobPart, type: string, name: string) => saveBlob(name, new Blob([data], { type })), []);

  /*
   * Every export is a job (2026-11-11, batch PXB; the decisions are
   * lib/exportJob.ts's): the formats one request asked for, written one after
   * another and saved as one download, one file or one .zip of them. Jobs
   * queue, so a second request waits for the first instead of replacing it:
   * a Word file still being written when the RTF arrived was dropped (PX-17).
   *
   * - CSV as DevExpress exports it (parity row 20): one continuous page, a
   *   line per distinct top and a column per distinct left edge, the printed
   *   text in each, byte for byte DevExpress's in thirteen cases; laid out with
   *   the pane's measurer, as the workbook is, so grown text pushes the lines
   *   below it in both (PX-19).
   * - An Excel workbook as DevExpress exports one (parity row 19): the layout
   *   as a grid of merged cells, numbers and dates kept as values; in the
   *   file's own Excel options (row 74), a workbook per page among them.
   * - Word, RTF, HTML and the picture (parity row 21) and Forma's own PDF
   *   (row 18) read the pages drawn at true size into a hidden host, the paged
   *   layout for the PDF, Word and RTF, the continuous one for HTML and the
   *   picture. Each writer is loaded only when it is chosen.
   * - "PDF" alone, from the Export panel, the command menu or a shared
   *   report's button, for a report with no password or PDF/A of its own, is
   *   the browser's print, which keeps the Preview's own fonts.
   */
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const job = jobs[0] ?? null;
  const enqueue = useCallback((formats: readonly PrintFormat[], reply?: string | null) => {
    setExportNote(null);
    setJobs((queue) => [...queue, { formats: jobFormats(formats), reply: reply ?? null }]);
  }, []);
  /** The job whose pages are drawn into the hidden hosts, once it is known not to print. */
  const [hosted, setHosted] = useState<ExportJob | null>(null);
  const pagedHostRef = useRef<HTMLDivElement>(null);
  const flowHostRef = useRef<HTMLDivElement>(null);
  const flowNeeded = !!hosted?.formats.some(readsContinuous);
  const continuous = useMemo(() => {
    if (!flowNeeded) return null;
    const count = records?.length ? records.length : recordCountFromLayout(layout);
    return layoutContinuous(structure, count, { rows: records ?? null, parameters: paramValues, measure, drillToggled, ...dataOptions });
  }, [flowNeeded, structure, records, layout, paramValues, measure, drillToggled, dataOptions]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  /** What a job reads, as it is when it reads it: a job outlives the render that started it. */
  const jobNow = useRef({ report, structure, continuous, title, repxContent, records, layout, paramValues, drillToggled, dataOptions, measure, onNotice, onExported });
  jobNow.current = { report, structure, continuous, title, repxContent, records, layout, paramValues, drillToggled, dataOptions, measure, onNotice, onExported };

  type JobFile = { name: string; type: string; content: string | Uint8Array | Blob };
  const WHAT: Record<PrintFormat, string> = { pdf: 'PDF', 'pdf-outline': 'PDF', csv: 'CSV file', xlsx: 'Excel workbook', docx: 'Word file', rtf: 'RTF file', html: 'HTML page', png: 'image' };
  /** The report's name as its files take it: "Monthly_Invoice". */
  const baseName = () => exportFileName(jobNow.current.title, 'x').slice(0, -2);
  /** The CSV and the workbooks, written at once from the layout. */
  const tableFiles = (format: 'csv' | 'xlsx'): JobFile[] => {
    const n = jobNow.current;
    const count = n.records?.length ? n.records.length : recordCountFromLayout(n.layout);
    const options = { rows: n.records ?? null, parameters: n.paramValues, measure: n.measure, drillToggled: n.drillToggled, ...n.dataOptions };
    if (format === 'csv') return [{ name: `${baseName()}.csv`, type: 'text/csv;charset=utf-8', content: reportToCsv(n.structure, count, options) }];
    const files = reportToXlsxFiles(n.structure, count, options, xlsxOptionsOf(n.repxContent));
    const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    // Numbered as DevExpress numbered its files, report1.xlsx, report2.xlsx, when there are several.
    return files.length === 1
      ? [{ name: `${baseName()}.xlsx`, type, content: files[0].bytes }]
      : files.map((x) => ({ name: `${baseName()}${x.number}.xlsx`, type, content: x.bytes }));
  };

  /**
   * The job's files saved, as one file or one .zip, and said: under the bar
   * for what failed, in a notice for what was saved, and in the chat's reply
   * when the chat asked (CV-17).
   */
  const finish = (done: ExportJob, files: JobFile[], notes: string[], printInstead: string | null) => {
    if (!alive.current) return;
    const names = files.map((f) => f.name);
    let saved = bundleName(jobNow.current.title, names);
    if (files.length === 1) save(files[0].content as BlobPart, files[0].type, files[0].name);
    else if (files.length > 1) {
      const zip = buildZip(files.map((f) => ({ name: f.name, content: f.content as string | Uint8Array })), new Date(), { keepPaths: true });
      if (zip.bytes) save(zip.bytes as BlobPart, 'application/zip', saved!);
      else {
        notes.push(`Forma could not put the files in one .zip: ${zip.reason}.`);
        saved = null;
      }
    }
    if (printInstead) notes.unshift(printInstead);
    setExportNote(notes.join(' ') || null);
    const { onNotice: notice, onExported: exported } = jobNow.current;
    if (saved) notice?.(`Saved ${saved}`);
    const sentence = saved ? [savedSentence(saved, names), ...(printInstead ? [printInstead] : [])].join(' ') : notes.join(' ');
    const reply = done.reply;
    if (reply && exported && sentence) exported((messages) => messages.map((m) => (m.id === reply ? { ...m, text: replyAfterExport(m.text, sentence) } : m)));
  };

  /** A CSV and workbook job, written within the effect that starts it. */
  const runNow = (now: ExportJob) => {
    const files: JobFile[] = [];
    const notes: string[] = [];
    for (const format of now.formats) {
      try {
        files.push(...tableFiles(format as 'csv' | 'xlsx'));
      } catch (err) {
        notes.push(failedText(WHAT[format], err));
      }
    }
    finish(now, files, notes, null);
  };

  /** Any other job: the print decided first, then the pages drawn into the hosts and read. */
  const runLater = async (later: ExportJob) => {
    const [{ pdfSecurityOf }, { pdfaPartOf }] = await Promise.all([import('../lib/pdfCrypto'), import('../lib/pdfA')]);
    // The report's own PDF passwords, which DevExpress encrypts its export
    // with (row 73), and its PDF/A part (row 72); asking for both is refused,
    // as DevExpress refuses it.
    const security = pdfSecurityOf(jobNow.current.repxContent);
    const pdfa = pdfaPartOf(jobNow.current.repxContent);
    const secured = !!(security || pdfa);
    if (!alive.current) return;
    if (printsInBrowser(later, secured)) {
      setPrinting(true);
      return;
    }
    const writing = writingNotice(later.formats);
    if (writing) jobNow.current.onNotice?.(writing);
    setHosted(later);
    const frame = () => new Promise((ok) => requestAnimationFrame(ok));
    const needPages = later.formats.some(readsPages);
    const needFlow = later.formats.some(readsContinuous);
    for (let i = 0; i < 30 && ((needPages && !pagedHostRef.current) || (needFlow && !flowHostRef.current)); i++) await frame();
    await document.fonts?.ready;
    await frame();
    await frame();
    const files: JobFile[] = [];
    const notes: string[] = [];
    let printInstead: string | null = null;
    const pagesIn = (host: HTMLDivElement | null) => [...(host?.querySelectorAll<HTMLElement>('.rp-page') ?? [])];
    for (const format of later.formats) {
      if (!alive.current) return;
      const n = jobNow.current;
      try {
        if (format === 'csv' || format === 'xlsx') files.push(...tableFiles(format));
        else if (format === 'pdf' || format === 'pdf-outline') {
          const { pagesToPdf } = await import('../lib/pdfFromDom');
          const blob = await pagesToPdf(pagesIn(pagedHostRef.current), n.report, n.title || 'Report', n.structure.outlineTitle || n.title || 'Report', { security, pdfa });
          files.push({ name: `${baseName()}.pdf`, type: 'application/pdf', content: blob });
        } else if (format === 'png') {
          // Page by page into a .zip when the report is taller than one picture can be (PX-24).
          const dom = await import('../lib/exportFromDom');
          const page = pagesIn(flowHostRef.current)[0];
          if (!page) throw new Error('the report has no page to draw.');
          const picture = await dom.pageToPictures(page, baseName());
          files.push(picture.extension === 'zip'
            ? { name: `${baseName()}-pictures.zip`, type: 'application/zip', content: picture.blob }
            : { name: `${baseName()}.png`, type: 'image/png', content: picture.blob });
          if (picture.note) notes.push(picture.note);
        } else {
          const laid = format === 'html' ? n.continuous ?? n.report : n.report;
          const dom = await import('../lib/exportFromDom');
          const pictures = await dom.picturesOf(pagesIn(format === 'html' ? flowHostRef.current : pagedHostRef.current), unitsPerInch(laid.unit) / 96);
          if (format === 'html') {
            const { reportToHtml } = await import('../lib/htmlExport');
            files.push({ name: `${baseName()}.html`, type: 'text/html;charset=utf-8', content: reportToHtml(laid, n.structure, n.title || 'Report', pictures) });
          } else if (format === 'rtf') {
            const { reportToRtf } = await import('../lib/rtfExport');
            files.push({ name: `${baseName()}.rtf`, type: 'application/rtf', content: reportToRtf(laid, n.structure, pictures) });
          } else {
            const { reportToDocx } = await import('../lib/docxExport');
            files.push({ name: `${baseName()}.docx`, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: reportToDocx(laid, n.structure, pictures) as Uint8Array });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (format === 'pdf' && isScriptRefusal(message)) {
          // A script Forma's PDF cannot hold, which the print keeps: printed instead, and said.
          printInstead = printFallbackNote(message, secured);
          setPrinting(true);
        } else if (format === 'pdf' || format === 'pdf-outline') {
          // The PDF writer throws plain sentences only (the PXA review), shown as they are.
          console.error('Forma could not write the PDF.', err);
          notes.push(message || 'Forma could not write the PDF.');
        } else notes.push(failedText(WHAT[format], err));
      }
    }
    // Several files go in one .zip, which takes bytes.
    if (files.length > 1) {
      for (const f of files) if (f.content instanceof Blob) f.content = new Uint8Array(await f.content.arrayBuffer());
    }
    finish(later, files, notes, printInstead);
  };

  const started = useRef<ExportJob | null>(null);
  useEffect(() => {
    if (!job || started.current === job) return;
    started.current = job;
    const done = () => {
      if (alive.current) setJobs((queue) => queue.filter((j) => j !== job));
    };
    if (job.formats.every((f) => f === 'csv' || f === 'xlsx')) {
      runNow(job);
      done();
      return;
    }
    void runLater(job)
      .catch((err) => console.error('Forma could not finish the export.', err))
      .finally(() => {
        if (alive.current) setHosted(null);
        done();
      });
    // Started once per job; what it reads is `jobNow`'s.
  }, [job]);

  /*
   * An export the chat, the Export panel or the command menu asked for, made
   * once per request (2026-11-05): see `exportRequest`. Taken at once, and
   * queued as a job, which says for itself what was saved or what failed.
   */
  const exportedNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!exportRequest || exportedNonce.current === exportRequest.nonce) return;
    exportedNonce.current = exportRequest.nonce;
    onExportRequestDone?.();
    const formats = exportRequest.formats ?? (exportRequest.format ? [exportRequest.format] : []);
    if (formats.length) enqueue(formats, exportRequest.reply);
  }, [exportRequest, enqueue, onExportRequestDone]);

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
              {/* The original under the page (CP-03), in the pane only, never in a print or an export. */}
              {editing && windowed && compareWith?.[pageIndex] && sourceInfo[compareWith[pageIndex]] && (() => {
                const src = compareWith[pageIndex];
                const content = unionBox(page.bands.flatMap((placed) => placed.controls.map((pc) => {
                  const x = unitsToPx(placed.left + pc.control.x + (pc.control.offsetX ?? 0), report.unit);
                  const y = unitsToPx(placed.top + pc.y, report.unit);
                  return { x0: x, y0: y, x1: x + unitsToPx(pc.control.width, report.unit), y1: y + unitsToPx(pc.height, report.unit) };
                })));
                const at = placeSource(sourceInfo[src], { width: pageW, height: pageH, content });
                return (
                  <>
                    <div aria-hidden className="rp-source" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0, clipPath: `inset(0 ${100 - sourceSwipe}% 0 0)` }}>
                      <img src={src} alt="" style={{ position: 'absolute', left: at.x0, top: at.y0, width: at.x1 - at.x0, height: at.y1 - at.y0, maxWidth: 'none', opacity: sourceOpacity }} />
                    </div>
                    {sourceSwipe < 100 && (
                      <div aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: `${sourceSwipe}%`, borderLeft: '1px dashed #2563eb', pointerEvents: 'none', zIndex: 3 }} />
                    )}
                  </>
                );
              })()}
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
                    // Carried by a drag under way: drawn where it is going, written on letting go.
                    const shift = dragShift?.keys.has(`${bandIndex}:${c}`) ? dragShift : null;
                    const box = (
                      <PrintedControl
                        control={control}
                        placed={pc}
                        unit={report.unit}
                        pageNumber={page.number}
                        pageCount={report.pages.length}
                        record={placed.record !== null && records?.length ? records[(placed.record - 1) % records.length] : null}
                        shared={shared}
                      />
                    );
                    return (
                      /* A Fragment, not a wrapper div. An `inset: 0` wrapper
                         stretches to the whole band, so in a band with several
                         controls the last one's wrapper lies over every earlier
                         control's hit target and only the last is selectable.
                         The mock has one control per band, which is exactly the
                         shape that hides this. */
                      <React.Fragment key={c}>
                        {shift?.mode === 'move' ? (
                          // The band's own box, moved whole: the control keeps its place in it.
                          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', transform: `translate(${shift.dx}px, ${shift.dy}px)` }}>{box}</div>
                        ) : box}
                        {placed.drill && control.ref !== undefined && control.ref === drillRef && (
                          <button
                            type="button"
                            className="rp-drill"
                            aria-expanded={placed.drill.expanded}
                            aria-label={`${placed.drill.expanded ? 'Collapse' : 'Expand'} ${pc.text || control.name}`}
                            title={placed.drill.expanded ? "Hide this group's records" : "Show this group's records"}
                            style={{
                              left: unitsToPx(control.x + control.offsetX, report.unit) - 15,
                              top: unitsToPx(pc.y, report.unit) + 2,
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => toggleDrill(placed.drill!.key)}
                          >
                            {placed.drill.expanded ? '−' : '+'}
                          </button>
                        )}
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
                            className={`rp-hit${isSelected || (editing && also.some((a) => a.band === bandIndex && a.control === c)) ? ' is-selected' : ''}${control.name && changedNames.has(control.name) ? ' is-changed' : ''}`}
                            // Which control, for Mark an area to find (2026-11-08).
                            data-band={bandIndex}
                            data-control={c}
                            style={{
                              // Over the control where it is drawn, which after
                              // growth and push-down need not be where the file
                              // puts it; a drag still edits from the file's origin.
                              left: unitsToPx(control.x + control.offsetX, report.unit),
                              top: unitsToPx(pc.y, report.unit),
                              // A resize under way draws the outline at its new size;
                              // the control itself is drawn again when it is written.
                              width: Math.max(1, unitsToPx(control.width, report.unit) + (shift?.mode === 'resize' ? shift.dx : 0)),
                              height: Math.max(1, unitsToPx(pc.height, report.unit) + (shift?.mode === 'resize' ? shift.dy : 0)),
                              ...(shift?.mode === 'move' ? { transform: `translate(${shift.dx}px, ${shift.dy}px)` } : {}),
                            }}
                            onPointerDown={(e) => {
                              // A right-click opens the menu (onContextMenu); it does not start a drag.
                              if (e.button === 2) { e.stopPropagation(); return; }
                              beginGesture(e, { band: bandIndex, control: c }, 'move');
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const ref = { band: bandIndex, control: c };
                              const inSelection = (selected && selected.band === ref.band && selected.control === ref.control) || also.some((a) => a.band === ref.band && a.control === ref.control);
                              if (!inSelection) { setSelected(ref); setAlso([]); }
                              setEditingText(null);
                              setEditingCell(null);
                              setMenu({ x: e.clientX, y: e.clientY, at: `${pageIndex}:${i}` });
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              if (control.type === 'XRTable' && control.rows.length) {
                                // The cell under the pointer, from the rows as placed and
                                // the cells' weights across (2026-11-04).
                                const r = e.currentTarget.getBoundingClientRect();
                                const fy = (e.clientY - r.top) / Math.max(1, r.height);
                                const fx = (e.clientX - r.left) / Math.max(1, r.width);
                                const heights = pc.rowHeights?.length ? pc.rowHeights : control.rows.map(() => 1);
                                const total = heights.reduce((s, h) => s + h, 0) || 1;
                                let row = 0;
                                let top = 0;
                                while (row < heights.length - 1 && (top + heights[row]) / total < fy) top += heights[row++];
                                const rowIndex = Math.min(control.rows.length - 1, (pc.rowStart ?? 0) + row);
                                const cells = control.rows[rowIndex].cells;
                                const weights = cells.map((cell) => cell.weight || 1);
                                const sum = weights.reduce((s, w) => s + w, 0) || 1;
                                let k = 0;
                                let left = 0;
                                while (k < weights.length - 1 && (left + weights[k]) / sum < fx) left += weights[k++];
                                setSelected({ band: bandIndex, control: c });
                                setAlso([]);
                                // A cell printing a field opens no editor; it says why (PX-08b).
                                if (cells[k]?.field) {
                                  sayBound('the cell prints a field, not typed text: bind another on the Data tab');
                                  return;
                                }
                                setEditingCell({
                                  // The placement clicked: a Detail band prints once per record,
                                  // and an editor in every one would steal focus from the last.
                                  at: `${pageIndex}:${i}`,
                                  ref: { band: bandIndex, control: c },
                                  row: rowIndex,
                                  cell: k,
                                  text: cells[k]?.text ?? '',
                                  box: { left: left / sum, top: top / total, width: weights[k] / sum, height: heights[row] / total },
                                });
                                return;
                              }
                              if (control.type !== 'XRLabel') return;
                              setSelected({ band: bandIndex, control: c });
                              startRetype({ band: bandIndex, control: c }, `${pageIndex}:${i}`, control.text);
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
                            {isSelected && editingText !== null && editingAt === `${pageIndex}:${i}` && (
                              <RetypeField
                                multiline={!!control.multiline || /[\r\n]/.test(control.text)}
                                label="Edit the control's text"
                                value={editingText}
                                style={{
                                  inset: 0,
                                  fontSize: control.fontSize ? `${control.fontSize}pt` : '9pt',
                                  fontWeight: control.bold ? 700 : 400,
                                }}
                                onChange={setEditingText}
                                onDone={() => {
                                  if (repxContent && asLines(editingText) !== asLines(control.text)) {
                                    commit(retyped(setControlText(repxContent, { band: bandIndex, control: c }, editingText)), repxContent);
                                  }
                                  setEditingText(null);
                                }}
                                onCancel={() => setEditingText(null)}
                              />
                            )}
                            {editingCell && editingCell.at === `${pageIndex}:${i}` && editingCell.ref.band === bandIndex && editingCell.ref.control === c && (() => {
                              const before = control.rows[editingCell.row]?.cells[editingCell.cell];
                              return (
                                <RetypeField
                                  multiline={!!before?.multiline || /[\r\n]/.test(before?.text ?? '')}
                                  label="Edit the cell's text"
                                  value={editingCell.text}
                                  style={{
                                    left: `${editingCell.box.left * 100}%`,
                                    top: `${editingCell.box.top * 100}%`,
                                    width: `${editingCell.box.width * 100}%`,
                                    height: `${editingCell.box.height * 100}%`,
                                    fontSize: control.fontSize ? `${control.fontSize}pt` : '9pt',
                                  }}
                                  onChange={(text) => setEditingCell({ ...editingCell, text })}
                                  onDone={() => {
                                    if (repxContent && asLines(editingCell.text) !== asLines(before?.text ?? '')) {
                                      commit(retyped(setCellText(repxContent, editingCell.ref, editingCell.row, editingCell.cell, editingCell.text)), repxContent);
                                    }
                                    setEditingCell(null);
                                  }}
                                  onCancel={() => setEditingCell(null)}
                                />
                              );
                            })()}
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
           the app's colour scheme, the same rule the mockup follows. On the
           page as well as the pane (2026-11-06): the print, PDF and export
           hosts are portaled to the body, outside .rp-root, where the two were
           undefined, so in dark mode a label with no colour of its own was
           written in the theme's near-white onto white paper. */
        .rp-page, .rp-root { --rp-ink: #111418; --rp-paper: #fff; }
        .rp-bar {
          display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
          margin-bottom: 14px; font-size: 12px;
        }
        .rp-stat { font-family: var(--font-code, monospace); letter-spacing: .04em; text-transform: uppercase; opacity: .7; }
        /* safe: a page zoomed wider than the bench overflows to the right only,
           where it scrolls; centred, its left part went past the scroller's
           start and could not be reached (2026-11-06, 600px of it at 300%). */
        .rp-pages { display: flex; flex-direction: column; align-items: safe center; gap: 22px; }
        /* The selection's toolbar, floating over the top of the report: height 0, so it moves nothing. */
        .rp-float-tools { position: sticky; top: 8px; height: 0; z-index: 6; display: flex; justify-content: center; }
        .rp-float-tools > .wb-ctx { align-self: flex-start; }
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
        /* A grey edge, not amber: no orange or amber border in the workspace (the owner, 2026-11-06). */
        .rp-problems {
          border-left: 3px solid var(--rule, #d7dee9); padding: 10px 14px; margin-bottom: 16px;
          font-size: 13px; line-height: 1.5;
        }
        .rp-problems p { margin: 0 0 6px; }
        .rp-problems p:last-child { margin: 0; }

        /* Editing chrome. Absolutely positioned over each control, transparent
           until hovered so the report reads as a report at rest. Blue, as a
           designer selects, never orange: the owner asked on 2026-11-06 for no
           orange border anywhere in the workspace. */
        /* touch-action: a drag on a touch screen moves the control rather than scrolling the page. */
        .rp-hit { position: absolute; cursor: move; outline: 1px solid transparent; touch-action: none; }
        .rp-hit:hover { outline-color: rgba(47, 111, 228, .45); }
        .rp-hit.is-selected { outline: 1.5px solid #2f6fe4; }
        .rp-mark-layer { position: absolute; inset: 0; z-index: 4; cursor: crosshair; touch-action: none; }
        .rp-mark-rect { position: absolute; border: 1.5px dashed #2f6fe4; border-radius: 3px; background: rgba(47, 111, 228, 0.08); pointer-events: none; }
        /* What the request picked in the log changed (2026-11-05), in Stitch's violet. */
        .rp-hit.is-changed:not(.is-selected) { outline: 2px solid #7c6be0; background: rgba(124, 107, 224, .08); }
        .rp-handle {
          position: absolute; right: -4px; bottom: -4px; width: 9px; height: 9px;
          background: #2f6fe4; border: 1px solid #fff; border-radius: 1px;
          cursor: nwse-resize; touch-action: none;
        }
        /* On a touch screen (2026-11-11, the full audit's PR-13, PX-11 and
           PR-11c): a swipe over a control scrolls the page, and only a selected
           control or its handle takes the finger; the handle is a size a
           finger can find. */
        @media (pointer: coarse) {
          .rp-hit { touch-action: pan-x pan-y; }
          .rp-hit.is-selected, .rp-handle { touch-action: none; }
          .rp-handle { width: 20px; height: 20px; right: -10px; bottom: -10px; }
        }
        /* Where a link on a shared report goes (2026-11-11, SE-14), under it on
           hover and on keyboard focus; never printed. The frame clips what it
           holds, so it lets the note out while it shows. */
        .rp-link[data-goes]:hover, html:not([data-modality='pointer']) .rp-link[data-goes]:focus-visible { overflow: visible !important; z-index: 5; }
        .rp-link[data-goes]:hover::after, html:not([data-modality='pointer']) .rp-link[data-goes]:focus-visible::after {
          content: attr(data-goes); position: absolute; left: 0; top: 100%; margin-top: 2px;
          padding: 1px 6px; background: #fff; color: #111418; border: 1px solid #c9d1dc; border-radius: 3px;
          font: 400 11px/1.4 system-ui, sans-serif; font-style: normal; white-space: nowrap; text-decoration: none;
        }
        @media print { .rp-link[data-goes]::after { content: none !important; } }
        /* Drill-down (s56): the toggle beside a group's label, in the margin as
           DevExpress's viewer draws it. Viewer chrome, so no export or print
           carries it: pdfFromDom and exportFromDom skip it by class. */
        .rp-drill {
          position: absolute; z-index: 3; width: 11px; height: 11px; padding: 0;
          display: grid; place-items: center; box-sizing: border-box;
          border: 1px solid #8a94a3; border-radius: 2px; background: #fff; color: #39424e;
          font: 600 10px/1 var(--font-code, monospace); cursor: pointer;
        }
        .rp-drill:hover { border-color: #2f6fe4; color: #2f6fe4; }
        .rp-drill:focus-visible { outline: none; }
        html:not([data-modality='pointer']) .rp-drill:focus-visible { border-color: #2f6fe4; color: #2f6fe4; }
        @media print { .rp-drill { display: none; } }
        /* The blue edge is the editing indicator, and the only one (2026-11-11, audit
           FB-5): with no outline of its own the editor, focused on a double-click, wore
           Chrome's dark ring round its blue edge, and the keyboard's grey ring outside it. */
        .rp-textedit {
          position: absolute; z-index: 2; box-sizing: border-box;
          border: 1.5px solid #2f6fe4; background: #fff; color: #111418;
          padding: 0 2px; font-family: inherit; outline: none;
        }
        .rp-textedit:focus-visible, .wb-root .rp-textedit:focus-visible { outline: none; }
        /* One line whatever it says, so selecting moves nothing below it (2026-11-06). */
        .rp-sel {
          font-family: var(--font-code, monospace); font-size: 11px;
          letter-spacing: .04em; opacity: .8;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1 1 0;
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
          /* The bench's rule, not the paper's (2026-11-06): the pills sit on
             the bench, and the paper's light hairline vanished on it in dark. */
          border: 1px solid var(--rule-strong, #d7dee7);
        }
        .rp-param small { font-family: var(--font-code, monospace); font-size: 10px; opacity: .55; }
        .rp-param em { font-style: normal; font-family: var(--font-code, monospace); font-size: 11px; opacity: .8; }
        .rp-param input {
          font-family: var(--font-code, monospace); font-size: 11px; width: 11ch;
          padding: 0 2px; border: 0; border-bottom: 1px solid var(--rule-strong, #d7dee7);
          background: transparent; color: inherit;
        }
        /* The underline darkens for the keyboard only (2026-11-11, audit FB-4, FB-10):
           keyed on :focus, it turned black on every click into a parameter. The
           lookup list takes the same underline: with its ring off and the input's
           alone darkening, a Tab onto it showed nothing at all, in the workspace
           and on a shared report alike (found in review the same day). */
        .rp-param input:focus, .rp-param select:focus { outline: none; }
        html[data-modality='keyboard'] .rp-param input:focus-visible,
        html[data-modality='keyboard'] .rp-param select:focus-visible { border-bottom-color: currentColor; }
        .rp-param select {
          font-family: var(--font-code, monospace); font-size: 11px; max-width: 18ch;
          padding: 0 2px; border: 0; border-bottom: 1px solid var(--rule-strong, #d7dee7);
          background: transparent; color: inherit; cursor: pointer;
        }
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
                  {/* The floating toolbar names it; said here only without one (2026-11-06). */}
                  {selectedControl.name && !onFormat ? ` ${selectedControl.name}` : ''}
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
              : 'Click a control to move it · Shift+click for more · double-click a label or a table cell to retype it'}
            {also.length > 0 && <> · <b>{also.length + 1} selected</b></>}
            {editNote && <span className="rp-over"> · {editNote}</span>}
          </span>
        )}
        {editable && (
          <button
            className="wb-pill wb-pill--outline"
            onClick={() => {
              if (!repxContent) return;
              // Beside the selection, under it in its band; else at the top of the records.
              // In the band's own numbers (2026-11-06): a panel's child is placed
              // inside its panel, and a mirrored right-to-left one is drawn at the
              // other side, so its drawn x and y put the label elsewhere.
              const bandIndex = selected?.band ?? Math.max(0, structureBands.findIndex((b) => b.kind === 'Detail'));
              const below = selectedControl
                ? {
                    x: (selectedControl.fileX ?? selectedControl.x) + selectedControl.offsetX,
                    y: selectedControl.y + selectedControl.offsetY + selectedControl.height + 4,
                  }
                : { x: 0, y: 0 };
              const count = structureBands[bandIndex]?.controls.length ?? 0;
              const result = addLabel(repxContent, bandIndex, below.x, below.y);
              commit(result, repxContent);
              if (result.applied) {
                setSelected({ band: bandIndex, control: count });
                setAlso([]);
              }
            }}
            title="A new label, under the selected control or at the top of the records"
            style={{ marginLeft: 'auto' }}
          >
            Add label
          </button>
        )}
        {/* No Delete of its own while the floating toolbar has one (2026-11-06). */}
        {editable && selected && !onFormat && (
          <button className="wb-pill wb-pill--outline" onClick={deleteSelected} title="Delete the selected controls (Delete key)">
            Delete
          </button>
        )}
        {editable && !historyElsewhere && (
          <button
            className="wb-pill wb-pill--outline"
            onClick={undo}
            disabled={undoDepth === 0}
          >
            Undo
          </button>
        )}
        {ownSource && liveReachable && !given && (
          /* Live rows from the database on this PC (2026-11-09, Phase 2, item 37). */
          <>
            <button type="button" className="wb-pill wb-pill--outline" onClick={() => void fillLive()} disabled={liveReading} title="The report’s own data source, filled on this PC by Forma Designer, with the values asked for above">
              {live ? `Live: ${live.rows.length} rows · Refresh` : 'Live rows'}
            </button>
            {liveReading && <button type="button" className="wb-pill wb-pill--outline" onClick={cancelLive}>Cancel</button>}
            {live && !liveReading && <button type="button" className="wb-pill wb-pill--outline" onClick={() => setLive(null)}>Clear</button>}
            {liveProcedures.length > 0 && !liveReading && (
              <button type="button" className="wb-pill wb-pill--outline" onClick={() => void fillLive(true)}>Run {liveProcedures.join(', ')}</button>
            )}
            {liveLine && (
              <span className="rp-stat" role="status">
                {liveLine}
                {liveLink && <> <a href={liveLink.href} target="_blank" rel="noopener noreferrer">{liveLink.label}</a></>}
              </span>
            )}
          </>
        )}
        {compareWith && compareWith.length > 0 && (
          /* Compare with the original (CP-03): how much of it shows, and how far across. */
          <>
            <label className="rp-stat">
              Original{' '}
              <input type="range" min={0} max={100} value={Math.round(sourceOpacity * 100)} onChange={(e) => setSourceOpacity(Number(e.target.value) / 100)} aria-label="How much of the original shows" />
            </label>
            <label className="rp-stat">
              Swipe{' '}
              <input type="range" min={0} max={100} value={sourceSwipe} onChange={(e) => setSourceSwipe(Number(e.target.value))} aria-label="How far across the page the original reaches" />
            </label>
          </>
        )}
        {cultures.length > 0 && (
          /* The language the Preview draws (CP-06), for a report in two or more. */
          <label className="rp-stat">
            Language{' '}
            <select value={shownCulture} onChange={(e) => setCulture(e.target.value)} aria-label="The language the Preview shows">
              <option value="">Its own</option>
              {cultures.map((c) => <option key={c} value={c}>{cultureName(c)}</option>)}
            </select>
          </label>
        )}
        {sql && !given && !live && (
          /* The database's own sample rows (2026-11-09, batch DF): no request,
             typed from its layout; the AI's test data below when it has none. */
          sql.rows?.length ? (
            <button
              type="button"
              className="wb-pill wb-pill--outline"
              aria-pressed={dbRowsOn}
              onClick={() => setDbRowsOn(!dbRowsOn)}
              title={sql.note}
            >
              {dbRowsOn ? `Sample rows: ${sql.rows.length} · Clear` : `Sample rows (${sql.rows.length})`}
            </button>
          ) : (
            /* Why there are none, as words on the bar (2026-11-11, SD-09b): a
               title shows only to a pointer that waits, and never on a phone. */
            <span className="rp-stat">{sql.note.charAt(0).toUpperCase() + sql.note.slice(1)}.</span>
          )
        )}
        {onTestData && !(dbRowsOn && sql?.rows?.length) && (
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
          ) : testDataBusy && onStopTestData ? (
            <button
              type="button"
              className="wb-pill wb-pill--outline"
              onClick={onStopTestData}
              title="Stop writing the sample rows"
            >
              Generating test data… · Stop
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
        {/* The exports, here only where nothing else offers them (a shared
            report's page): the workspace's Export panel has every format
            since 2026-11-06, and the owner asked for the duplicates to go. */}
        {exportButtons && (<>
        <button
          className="wb-pill wb-pill--outline"
          onClick={() => enqueue(['pdf'])}
          disabled={!report.pages.length}
          style={editable ? undefined : { marginLeft: 'auto' }}
        >
          Export PDF
        </button>
        <button
          type="button"
          className="wb-pill wb-pill--outline"
          onClick={() => enqueue(['pdf-outline'])}
          disabled={!report.pages.length}
          title="A PDF Forma writes itself, with the report's bookmarks as its outline"
        >
          {job?.formats.includes('pdf-outline') ? 'Writing PDF…' : 'PDF with outline'}
        </button>
        <button type="button" className="wb-pill wb-pill--outline" onClick={() => enqueue(['xlsx'])} disabled={!report.pages.length}>
          Export XLSX
        </button>
        <button type="button" className="wb-pill wb-pill--outline" onClick={() => enqueue(['csv'])} disabled={!report.pages.length}>
          Export CSV
        </button>
        <select
          className="wb-pill wb-pill--outline"
          aria-label="Export in another format"
          value=""
          disabled={!report.pages.length}
          onChange={(e) => {
            const kind = e.target.value as PrintFormat | '';
            // Queued behind any export under way, never in its place (PX-17).
            if (kind) enqueue([kind]);
          }}
        >
          <option value="">{job ? 'Exporting…' : 'More exports'}</option>
          <option value="docx">Word (DOCX)</option>
          <option value="rtf">RTF</option>
          <option value="html">HTML</option>
          <option value="png">Image (PNG)</option>
        </select>
        </>)}
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
            // Before the first live fill too (Phase 2): a procedure's parameter with no default is typed first.
            records || (ownSource && liveReachable) ? (
              <label className="rp-param" key={p.name}>
                {p.description || p.name}
                <small>{(p.resolvedType ?? (p.lifted ? 'typed' : p.type)).replace('System.', '')}{p.multiValue ? ' · many' : ''}</small>
                <ParameterInput
                  type={p.resolvedType ?? p.type}
                  multi={p.multiValue}
                  choices={choices[p.name]}
                  value={paramValues[p.name] ?? p.value}
                  onChange={(value) => setParamValues((v) => ({ ...v, [p.name]: value }))}
                  label={`Value for ${p.description || p.name}`}
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

      {/* The field each group breaks on, chosen here (2026-11-04). Over test
          data the pages regroup as soon as it changes; Undo takes it back. */}
      {editable && groupChoices.length > 0 && (
        <div className="rp-params">
          <span className="rp-params-label">Grouped by</span>
          {groupChoices.map((g) => (
            <label className="rp-param" key={g.band}>
              {g.band}
              <select value={g.field ?? ''} onChange={(e) => regroup(g.band, e.target.value)} aria-label={`Field ${g.band} groups by`}>
                {!g.field && <option value="">nothing</option>}
                {groupOptions(g.field).map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      {exportNote && (
        <div className="rp-problems" role="alert">
          <p>{exportNote}</p>
        </div>
      )}

      {report.problems.length > 0 && (
        <div className="rp-problems" role="status">
          {report.problems.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}

      {/* The selection's toolbar floats over the top of the report (2026-11-06,
          the owner's choice): it took the pane switcher's place in the bench's
          bar, which hid the panes while something was selected and wrapped the
          bar, moving the page under the pointer. Height 0, so it pushes nothing. */}
      {editable && onFormat && selected && (
        <div className="rp-float-tools">
          <SelectionToolbar
            names={[selected, ...also].map((r) => {
              const c = structureBands[r.band]?.controls[r.control];
              return c?.name || c?.type || 'control';
            })}
            onFormat={onFormat}
            onEditText={onEditText && !also.length && selectedControl?.name ? () => onEditText(selectedControl.name!) : undefined}
            onCopy={selectionNames.length ? () => copyNames(selectionNames) : undefined}
            onDelete={deleteSelected}
            onClear={() => { setSelected(null); setAlso([]); }}
          />
        </div>
      )}

      {/* The paper clears the whole selection (2026-11-06): it cleared the
          first control only, and the rest stayed outlined. */}
      <div ref={viewportRef} style={{ width: '100%', position: 'relative' }} onPointerDown={() => { setSelected(null); setAlso([]); }}>
        {renderPages(scale, editable, true)}
        {/* Mark an area (2026-11-08): over the pages while the tool is on. */}
        {marking && editable && (
          <div
            ref={markLayerRef}
            className="rp-mark-layer"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              e.currentTarget.setPointerCapture?.(e.pointerId);
              setMarkBox({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
            }}
            onPointerMove={(e) => setMarkBox((box) => (box ? { ...box, x1: e.clientX, y1: e.clientY } : box))}
            onPointerUp={(e) => {
              const box = markBox;
              setMarkBox(null);
              if (box) finishMark({ ...box, x1: e.clientX, y1: e.clientY });
            }}
          >
            {markBox && markLayerRef.current && (() => {
              const at = markLayerRef.current.getBoundingClientRect();
              return (
                <div
                  className="rp-mark-rect"
                  style={{
                    left: Math.min(markBox.x0, markBox.x1) - at.left,
                    top: Math.min(markBox.y0, markBox.y1) - at.top,
                    width: Math.abs(markBox.x1 - markBox.x0),
                    height: Math.abs(markBox.y1 - markBox.y0),
                  }}
                />
              );
            })()}
          </div>
        )}
      </div>

      {menu && selected && selectedControl && editable && (
        <ControlMenu
          x={menu.x}
          y={menu.y}
          label={selectionNames.length > 1 ? `${selectionNames.length} controls` : selectedControl.name || selectedControl.type}
          onClose={() => setMenu(null)}
          items={((): MenuItem[] => {
            const chosen = [selected, ...also];
            const items: MenuItem[] = [];
            if (onAddToChat) items.push({ label: 'Add to chat', keys: 'Ctrl+L', run: onAddToChat });
            // Not offered for a label that prints a field (PX-08b), which no retype changes.
            if (chosen.length === 1 && selectedControl.type === 'XRLabel' && repxContent && !boundTextNotice(repxContent, selected)) {
              items.push({ label: 'Retype', keys: 'Double-click', run: () => startRetype(selected, menu.at, selectedControl.text) });
            }
            // What it writes is read aloud by screen readers and kept in a tagged PDF, not
            // something for the AI (2026-11-11, the full audit's CV-30).
            if (onDescribe && chosen.length === 1 && selectedControl.name) items.push({ label: 'Describe this part', run: () => onDescribe(selectedControl.name!) });
            if (onFormat) {
              items.push({
                label: 'Format',
                sub: ([['bold', 'Bold'], ['italic', 'Italic'], ['larger', 'Two points larger'], ['smaller', 'Two points smaller'], ['left', 'Align left'], ['center', 'Centre'], ['right', 'Align right']] as [FormatAction, string][])
                  .map(([action, label]) => ({ label, run: () => onFormat(action) })),
              });
            }
            items.push({ label: 'Duplicate', keys: 'Ctrl+D', divide: true, run: () => duplicateSelection(chosen) });
            if (selectionNames.length) {
              items.push({ label: selectionNames.length > 1 ? 'Copy the names' : 'Copy the name', run: () => copyNames(selectionNames) });
            }
            if (onFocusSelection) items.push({ label: 'Focus', keys: 'F', run: onFocusSelection });
            items.push({ label: 'Delete', keys: 'Del', danger: true, divide: true, run: deleteSelected });
            return items;
          })()}
        />
      )}

      {/* True size, outside the workspace tree, only while printing. */}
      {printing && createPortal(<div className="rp-print-host">{renderPages(1, false, false)}</div>, document.body)}
      {/* True size again, off screen but laid out, for an export job to read:
          the pages as they print for the PDF, Word and RTF, and the one
          continuous page for HTML and the picture. */}
      {hosted?.formats.some(readsPages) && createPortal(
        <div ref={pagedHostRef} aria-hidden style={{ position: 'fixed', left: -100000, top: 0, pointerEvents: 'none' }}>
          {renderPages(1, false, false)}
        </div>,
        document.body,
      )}
      {hosted && continuous && createPortal(
        <div ref={flowHostRef} aria-hidden style={{ position: 'fixed', left: -100000, top: 0, pointerEvents: 'none' }}>
          {renderPages(1, false, false, continuous)}
        </div>,
        document.body,
      )}
    </div>
  );
}
