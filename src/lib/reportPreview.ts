/**
 * What the exported `.repx` actually prints — read out of the REPX itself.
 *
 * ## Why this reads the REPX and not the layout JSON
 *
 * The mockup renders `layout.sections` stacked into one tall page. That is a
 * picture of the source document, and it is the right thing for checking
 * fidelity against what the user uploaded. It is *not* what the file prints:
 * the layout has no concept of a page, so nothing in the product has ever shown
 * the user their report paginated, and nothing has ever checked the artifact
 * they actually download.
 *
 * This module parses `repxContent`. That choice is the point of it. A Detail
 * band prints once per record, a PageHeader repeats on every sheet, a
 * ReportFooter prints once after the last row — those rules live in the REPX
 * band structure and nowhere else, so a preview built from the layout would
 * agree with the mockup and tell the user nothing new. Built from the REPX it
 * answers the question the audit can only hint at: *is this a report, or a
 * drawing of one?* A file whose Detail band is the height of the page shows it
 * immediately — one record fills a sheet.
 *
 * ## Regex, not DOMParser
 *
 * `repxAudit.ts`, `repxItems.ts`, `repxRefs.ts` and `repxBindingPlan.ts` all
 * read this XML with regular expressions, and this follows them for two
 * reasons beyond consistency. `DOMParser` is a browser global, so a module
 * using it drags its tests into the jsdom environment — `vitest.config.ts`
 * keeps 32 of 38 files out of jsdom precisely because that entry costs minutes
 * on a cold cache. And the input is not arbitrary XML: it is the narrow dialect
 * this project's own prompt emits, already checked by `checkRepx` before it
 * gets here.
 *
 * The parser is deliberately forgiving. A preview that renders most of a broken
 * report is more useful than one that throws, and `repxAudit` is what passes
 * judgement on the file. Anything unparseable is reported in `problems` and
 * skipped.
 */

import { formatComposite, formatDate, toRoman } from './netFormat';
import { unitsPerInch } from './reportGeometry';
import { GROW_EXTRA_PT, SHRINK_EXTRA_PT, lineSpacingPt, type FontSpec, type MeasureText } from './textMeasure';
import { ReportData, aggregate, groupRuns, sortCompare, sortedOrder, valueText, type CalculatedField, type TextData, type TextScope, type TypedRow } from './reportData';
import { parseParameters, type ReportParameter } from './repxParameters';
import { isTrue, parseCriteria, type Value } from './criteria';
import { crossTabFacts } from './repxCrossTabs';
import { printedPaper } from './repxPaper';
import { NetDecimal } from './netDecimal';

/** The bands that carry content, in the order XtraReports prints them. */
export type BandKind =
  | 'TopMargin'
  | 'ReportHeader'
  | 'PageHeader'
  | 'GroupHeader'
  | 'Detail'
  | 'DetailReport'
  | 'GroupFooter'
  | 'ReportFooter'
  | 'PageFooter'
  | 'BottomMargin'
  | 'Unknown';

/** Print order, used to sort bands whatever order the file lists them in. */
const BAND_ORDER: BandKind[] = [
  'TopMargin',
  'ReportHeader',
  'PageHeader',
  'GroupHeader',
  'Detail',
  // A detail report prints after each record of the Detail band it follows.
  'DetailReport',
  'GroupFooter',
  'ReportFooter',
  'PageFooter',
  'BottomMargin',
];

/*
 * There is deliberately no MARGIN_BANDS list to filter against. TopMargin and
 * BottomMargin are page furniture, and `paginate` places bands by naming the
 * ones it wants rather than by excluding the ones it does not -- so a list of
 * exclusions would be a second, silent way for a band to be dropped. Since
 * parity row 38 it names the margin bands too, as furniture on every page that
 * holds their controls and never as content in the flow.
 */

/**
 * The appearance properties a control can take from a style or inherit from
 * its parent, by the name each carries ON A CONTROL.
 *
 * Every one of these was printed through DevExpress 20.1 with `RepxProbe
 * render` on 2026-10-30 (`docs/proposals/devexpress-parity.md`, row 3): each
 * applies from a style, each inherits down report, band, panel, table, row and
 * cell, and each has a `<StylePriority Use… />` flag of the same name, except
 * that a style's `BorderWidth` has no effect.
 */
export type AppearanceProperty =
  | 'Font'
  | 'ForeColor'
  | 'BackColor'
  | 'TextAlignment'
  | 'Padding'
  | 'Borders'
  | 'BorderColor'
  | 'BorderWidth';

/** Resolved raw attribute values, as the file writes them. Absent means unset all the way up. */
export type Appearance = Partial<Record<AppearanceProperty, string>>;

/**
 * A rule from the report's `<FormattingRuleSheet>`: a condition over the
 * record, and the appearance and visibility it applies when the condition holds.
 * Measured in case s22a of `docs/proposals/devexpress-parity.md`: see
 * `applyRules` for what DevExpress printed.
 */
export interface FormattingRule {
  name: string;
  condition: string;
  appearance: Appearance;
  /** `Visible` in the rule's formatting; null when the rule does not set it. */
  visible: boolean | null;
}

export type { TextData };

export interface PreviewCell {
  text: string;
  /** Relative width within the row. DevExpress distributes by weight, not px. */
  weight: number;
  /** Points, resolved through the cell's style, its row and its table. */
  fontSize: number | null;
  fontFamily: string | null;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle' | 'bottom';
  /**
   * The sides this cell actually draws, after DevExpress's sharing rule: a
   * shared edge is drawn once, by the cell on the left or above. See
   * `shareTableBorders`.
   */
  borders: { top: boolean; right: boolean; bottom: boolean; left: boolean };
  /** Everything the cell resolved to: colours, padding, border width and colour. */
  appearance: Appearance;
  /** As on a control: a cell grows and wraps unless the file says otherwise. */
  canGrow: boolean;
  wordWrap: boolean;
  data: TextData;
  /**
   * The data field this cell's text is bound to, or null when it is a literal.
   *
   * Read from an `ExpressionBindings` item with `PropertyName="Text"`: the
   * first `[Field]` in its expression. A summary (`sumSum([Amount])`) still
   * names its field and is reported as that field, which is what a test-data
   * preview wants to show in the cell. Added 2026-10-28 for the AI test-data
   * preview, so a record can be printed into the bound cells.
   */
  field: string | null;
  /** The formatting rules linked to this cell, by `Ref`, in link order. */
  rules: string[];
  /** Its expression bindings on anything but the text; see `AppearanceBinding`. */
  bindings?: AppearanceBinding[];
  /** The appearance properties the cell or its row sets itself; the rest it inherits from the table. */
  ownProps: AppearanceProperty[];
}

export interface PreviewRow {
  cells: PreviewCell[];
}

/**
 * One chart series, as the file declares it.
 *
 * Measured 2026-09-05 with `RepxProbe emit-chart`: series live in
 * `<SeriesSerializable>` inside `<DataContainer>` inside `<Chart>`, carry
 * `ArgumentDataMember` and `ValueDataMembersSerializable`, and carry NO
 * `ControlType` -- the fourth place in this format where a collection item
 * omits it. The view type appears as a `<View TypeNameSerializable="...">`
 * child ONLY when it is not the default, so a bar series writes nothing.
 */
export interface PreviewSeries {
  name: string;
  /** The field along the category axis. */
  argument: string;
  /** The field(s) plotted. Comma-separated in the file. */
  value: string;
  /** `PieSeriesView`, `LineSeriesView`, … or '' for the bar default. */
  view: string;
}

/** A cross-tab's three field collections, each item `FieldName` and no type. */
export interface PreviewCrossTab {
  rows: string[];
  columns: string[];
  data: string[];
  /** DevExpress prints it as written: it carries the layout DevExpress generates. */
  printable: boolean;
  /** Everything it carries was printed in parity case s25; see `crossTabFacts`. */
  measured: boolean;
  /** The generated layout's columns and rows, which share out the control's size. */
  layoutColumns: number;
  layoutRows: number;
}

/** One printed cell of a cross-tab, relative to the control's top left. */
export interface CrossTabGridCell {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  /** The typed value, for a workbook cell; undefined for a caption. */
  value?: Value;
}

/** A cross-tab as DevExpress prints it over the test data. */
export interface CrossTabGrid {
  width: number;
  height: number;
  cells: CrossTabGridCell[];
}

/**
 * What an `XRGauge` or `XRSparkline` is set to show.
 *
 * Measured with `RepxProbe emit-gauge`:
 *
 * - A gauge's numbers are flat attributes, and **`ViewType="Circular"` is never
 *   written because it is the default** — so an absent view type is a dial, not
 *   an unknown.
 * - A sparkline needs **no data source**: `DataMember` and `ValueMember` are
 *   flat attributes, the same answer calculated fields gave.
 * - A sparkline always writes `<View Type="Line" />`, and that element is the
 *   one child in this format that carries **no `Ref`** while still consuming a
 *   number in the sequence. A gap in the Ref numbering is therefore normal and
 *   is not evidence of a dropped element.
 */
export interface PreviewMeter {
  /** `Circular` or `Linear` for a gauge; the sparkline view type otherwise. */
  view: string;
  /** Gauge only, and null when the value is bound rather than literal. */
  value: number | null;
  target: number | null;
  min: number | null;
  max: number | null;
  /** Sparkline only: the field plotted. */
  field: string | null;
  /** The property an expression drives, when one does — e.g. `ActualValue`. */
  bound: string | null;
}

/**
 * An `ExpressionBindings` item that sets something other than the text:
 * `Visible`, a colour, the borders, the alignment, or a part of the font.
 * Evaluated per record over the test data (parity row 45). Printed in s31a
 * and s31d, each changed its control record by record, and a formatting rule
 * setting the same property won over the binding.
 */
export interface AppearanceBinding {
  property: string;
  expression: string;
}

export interface PreviewControl {
  /** The DevExpress ControlType verbatim, e.g. `XRLabel`. */
  type: string;
  name: string;
  /** Band-relative, in report units. */
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  /** The field `Text` is bound to, or null. See `PreviewCell.field`. */
  field: string | null;
  /** Points, as written in the file — font size is not in report units. */
  fontSize: number | null;
  fontFamily: string | null;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle' | 'bottom';
  borders: { top: boolean; right: boolean; bottom: boolean; left: boolean };
  /**
   * The control's appearance after styles, `StylePriority` and inheritance.
   *
   * `fontSize`, `align`, `borders` and the rest above are read out of this, so
   * they show what DevExpress prints rather than what the control's own
   * attributes say. See `resolveAppearance`.
   */
  appearance: Appearance;
  /**
   * False for `Visible="false"`, or for anything inside a hidden panel.
   *
   * DevExpress prints nothing at all for such a control -- no brick, no text --
   * measured with `RepxProbe render` on 2026-10-30. It stays in this list, so
   * an edit's band and control indices still line up with the file, and the
   * renderer and the layout checks skip it. A `Visible` driven by an
   * expression is data, not a literal, and is treated as shown.
   */
  visible: boolean;
  /**
   * Auto-sizing, with DevExpress's defaults: `CanGrow` and `WordWrap` are true
   * unless the file says "false", `CanShrink` is false unless it says "true"
   * (`RepxProbe emit-grow`). Read by `layoutBand` when a text measurer is given.
   */
  canGrow: boolean;
  canShrink: boolean;
  wordWrap: boolean;
  /** What the control prints from data: its whole `Text` binding, its summary scope and its format. */
  data: TextData;
  /** `NavigateUrl`: written on the control, or bound to an expression. Null when it has none. */
  link: { literal: string | null; expression: string | null } | null;
  /** The formatting rules linked to this control, by `Ref`, in link order. */
  rules: string[];
  /** Its expression bindings on anything but the text; see `AppearanceBinding`. */
  bindings?: AppearanceBinding[];
  /**
   * `ProcessDuplicatesMode` and `ProcessNullValues` as written, when they are
   * (parity row 46). Printed in s31b and s32: a repeat is blank, compared with
   * the record before in print order across pages and groups; a merged run
   * prints once, in one box per page; a null is blank. The shrinking modes
   * suppress the same way, and their shrink is row 52.
   */
  duplicates?: 'Suppress' | 'SuppressAndShrink' | 'Merge';
  nulls?: 'Suppress' | 'SuppressAndShrink';
  /**
   * For an `XRSubreport`: the report embedded in its `<ReportSource>`, parsed,
   * or the file its `ReportSourceUrl` names, which a browser cannot open.
   * Null for every other control.
   */
  subreport: { structure: ReportStructure | null; url: string | null } | null;
  /**
   * The appearance properties this control sets itself -- by its own attribute
   * or its style -- or that a panel around it sets. A rule linked to the band
   * reaches only the others, the ones the control inherits from the band.
   */
  ownProps: AppearanceProperty[];
  /** Populated for XRPageInfo only: what it prints and how. See `pageInfoText`. */
  pageInfo: PreviewPageInfo | null;
  /** Populated for XRTable only. */
  rows: PreviewRow[];
  /** Populated for XRChart only. */
  series: PreviewSeries[];
  /** Populated for XRCrossTab only. */
  crossTab: PreviewCrossTab | null;
  /**
   * Populated for XRCheckBox only: `unchecked`, `checked` or `indeterminate`.
   *
   * Unchecked is the serializer's default and is written as nothing at all, so
   * an absent attribute is a real state rather than missing information.
   */
  checkState: CheckState | null;
  /**
   * The containing panel's position, or 0 for a control sitting directly in a
   * band.
   *
   * `x`/`y` are always exactly what the file says, because that is what an edit
   * has to write back. **The renderer must add these**, or a panel's children
   * draw in the band's corner instead of inside the panel.
   */
  /**
   * Populated for XRGauge and XRSparkline: what the control is set to show.
   *
   * A gauge carries its numbers as flat attributes; a sparkline carries the
   * field it plots. Both may instead be bound, in which case the literal is
   * absent and `bound` says which property drives it — the preview has no data,
   * so naming the binding is the honest thing to draw.
   */
  meter: PreviewMeter | null;
  /**
   * Populated for XRShape only: `Rectangle`, `Ellipse`, `Line`, `Star`, …
   *
   * Never null for a shape. An absent `<Shape>` child means Ellipse, which is a
   * real answer rather than a missing one.
   */
  shape: string | null;
  offsetX: number;
  offsetY: number;
  /**
   * For a panel's child, the index in its band's `controls` of the panel it
   * sits in, which `layoutBand` lays it out inside; absent at the band's top
   * level. A panel inside a panel is flattened into the outer one, as its
   * offset is.
   */
  panel?: number;
  /**
   * How much the file's numbers were scaled to reach the report's unit: the
   * report's units per inch over this control's `Dpi`, which DevExpress reads
   * as 100 when absent. 1 for every report written as DevExpress writes one;
   * 2.54 for a millimetre report with no `Dpi`. An edit divides by it, so it
   * writes the file's own numbers back. Absent means 1.
   */
  dpiScale?: number;
  /**
   * Where this control's opening tag sits in the source REPX: `openStart` is
   * the `<`, `openEnd` the matching `>`. Absolute offsets into the document
   * that was parsed, which is what lets an edit rewrite one attribute list and
   * leave every other byte alone. Meaningless against any other string.
   */
  openStart: number;
  openEnd: number;
}

/**
 * An `XRPageInfo`'s settings, as the file writes them.
 *
 * `kind` is `NumberOfTotal` when the file writes no `PageInfo`: the serializer
 * omits the default, and DevExpress printed such a control as `1/2`.
 */
export interface PreviewPageInfo {
  kind: string;
  /** `TextFormatString`, or null for the kind's own default. */
  format: string | null;
  /** `StartPageNumber`: what page 1 is numbered. 1 when absent. */
  start: number;
}

/**
 * What an `XRPageInfo` prints on a page, as DevExpress 20.1 printed it.
 *
 * Every row was printed through `RepxProbe render` on 2026-10-30 (row 15 of
 * `docs/proposals/devexpress-parity.md`), on page 1 of 2 in en-US:
 *
 * | kind | no format | with a format |
 * |---|---|---|
 * | `Number` | `1`; `5` with `StartPageNumber="5"` | `Page {0}` gave `Page 1` |
 * | `NumberOfTotal`, or no kind | `1/2`, no spaces | `{0} / {1}` gave `1 / 2` |
 * | `Total` | `2` | `{0} pages` gave `2 pages` |
 * | `RomLowNumber` / `RomHiNumber` | `i` / `I` | |
 * | `DateTime` | `Friday, October 30, 2026` | `{0:yyyy-MM-dd}` gave `2026-10-30` |
 * | `UserName` | the machine's user name | |
 * | `None` | nothing, even with `Text` set | |
 *
 * A user name is not knowable from a browser, so it prints as a placeholder,
 * the way the Preview names a binding it cannot evaluate. `StartPageNumber`
 * was measured on `Number`; it is applied to the page position of every kind.
 */
export function pageInfoText(info: PreviewPageInfo, page: number, total: number, now: Date = new Date()): string {
  const position = page + info.start - 1;
  const fmt = (fallback: string, args: unknown[]) => formatComposite(info.format ?? fallback, args);
  switch (info.kind) {
    case 'None':
      return '';
    case 'Number':
      return fmt('{0}', [position]);
    case 'Total':
      return fmt('{0}', [total]);
    case 'RomLowNumber':
      return fmt('{0}', [toRoman(position), total]);
    case 'RomHiNumber':
      return fmt('{0}', [toRoman(position).toUpperCase(), total]);
    case 'DateTime':
      return info.format === null ? formatDate(now, 'D') : formatComposite(info.format, [now]);
    case 'UserName':
      return fmt('{0}', ['[user name]']);
    default:
      // NumberOfTotal, and the absent default, which prints the same.
      return fmt('{0}/{1}', [position, total]);
  }
}

/**
 * A band's multi-column layout, or null for the ordinary single-column case.
 *
 * `RepxProbe emit-cols`: a band left alone writes **no `<MultiColumn>` element
 * at all**, so absence is "one column" rather than "not known" — the same shape
 * as `CanGrow` and as a shape with no `<Shape>` child.
 */
export interface PreviewColumns {
  count: number;
  /** `ColumnWidth`, read only in `UseColumnWidth` mode; 0 when absent. */
  width: number;
  spacing: number;
  /** `AcrossThenDown` or `DownThenAcross`. */
  layout: string;
  /** `UseColumnCount`, `UseColumnWidth`, or `None` -- the default, one column. */
  mode: string;
}

export interface PreviewBand {
  kind: BandKind;
  name: string;
  /** Its `Ref`, which a cross-band control names its bands by (parity row 48). */
  ref?: string;
  /** In the report's unit, scaled by `dpiScale` from the file's `HeightF`. */
  height: number;
  /** As on a control: the report's units per inch over the band's `Dpi`. Absent means 1. */
  dpiScale?: number;
  controls: PreviewControl[];
  /**
   * Multi-column flow, when the band declares it.
   *
   * Honoured by `paginate`, which lays the records out on a `rows x count` grid
   * and gives each placement a `left` and a `width`. Only the Detail band is
   * divided — headers, footers and group bands span the full page, which is
   * what DevExpress does.
   */
  columns: PreviewColumns | null;
  /**
   * `KeepTogether="true"`: move the whole band to the next page rather than
   * split it. Printed: a growing record that would have been split across a
   * page break moved whole instead. False, the default, splits it.
   */
  keepTogether: boolean;
  /*
   * There is no `canGrow` here, deliberately. A band's `CanGrow="false"` was
   * read as holding it at its designed height until parity row 36, which nothing
   * had measured; printed, a band marked so still grew with its text and still
   * held a control placed past its bottom (s29b, s29f, s29g).
   */
  /**
   * `PrintOn`, for a page header or footer: `AllPages` by default, or the flags
   * `NotWithReportHeader` and `NotWithReportFooter`, comma-separated. Printed:
   * a page header with `NotWithReportHeader` was absent from page 1, and a
   * page footer with `NotWithReportFooter` from the report footer's page.
   */
  printOn: string;
  /** `PrintAtBottom="true"` on a report footer: printed at the foot of its page. */
  printAtBottom: boolean;
  /**
   * `<GroupFields>` on a group header, `<SortFields>` on Detail, in file order.
   * Printed: groups came out in ascending order of their field whatever order
   * the data arrived in, and a descending `SortFields` on Detail sorted the
   * records within each group.
   */
  fields: BandField[];
  /**
   * `Level` as written, 0 when absent. It decides nesting, NOT the file order:
   * measured in case s19, the higher level is the outer group, and between
   * equal levels the band LATER in the file is the outer one -- so two group
   * headers written outer-first with no `Level` nest the other way round. A
   * group footer closes the group whose header has its level.
   */
  level: number;
  /** `RepeatEveryPage="true"` on a group header: printed again at the top of each page its group continues onto. */
  repeatEveryPage: boolean;
  /** `GroupUnion` on a group header: `None`, `WholePage` or `WithFirstDetail`. */
  groupUnion: string;
  /** `PageBreak`: `None`, `BeforeBand`, `BeforeBandExceptFirstEntry`, `AfterBand` or `AfterBandExceptLastEntry`. */
  pageBreak: string;
  /** For a `DetailReportBand`: the report it prints after each master record. Null for every other band. */
  sub: SubReport | null;
  /** The formatting rules linked to this band, by `Ref`, in link order. */
  rules: string[];
}

/**
 * A `DetailReportBand`: its own bands, printed after each record of the
 * master's Detail band over that record's related rows. Printed in c06: every
 * order got its lines header, one Detail per line and a footer whose
 * `Running="Report"` total was that order's own; an order with no lines still
 * got the header, ONE blank Detail and a blank total.
 */
export interface SubReport {
  /** `DataMember`, a relation path such as `Orders.OrderLines`. */
  dataMember: string | null;
  filterString: string | null;
  bands: PreviewBand[];
}

/** One `GroupFields` or `SortFields` item. `None` groups without sorting. */
export interface BandField {
  field: string;
  order: 'Ascending' | 'Descending' | 'None';
}

/** A band's `<GroupFields>` or `<SortFields>`, from its own part of the file. */
function parseBandFields(bandText: string, tag: 'GroupFields' | 'SortFields'): BandField[] {
  const head = bandText.split(/<(?:Controls|Bands|SubBands)\b/)[0];
  const block = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(head);
  if (!block) return [];
  const out: BandField[] = [];
  for (const m of block[1].matchAll(/<Item\d+\b([^>]*?)\/?>/g)) {
    const field = attrOf(m[1], 'FieldName');
    if (!field) continue;
    const order = attrOf(m[1], 'SortOrder');
    out.push({ field, order: order === 'Descending' ? 'Descending' : order === 'None' ? 'None' : 'Ascending' });
  }
  return out;
}

export interface ReportStructure {
  page: { width: number; height: number };
  /**
   * From `Margins="left, right, top, bottom"`. Band content starts at the left
   * margin, and the printable width is the page less BOTH side margins:
   * measured by printing, where a control at band position 0,0 under
   * `Margins="60, 40, 50, 50"` printed at page position 60,50. This held only
   * top and bottom until 2026-10-30, so every control previewed shifted left
   * by the left margin.
   */
  margins: { top: number; bottom: number; left: number; right: number };
  unit: string;
  bands: PreviewBand[];
  /**
   * The page watermark, or null when there is none.
   *
   * Page-level rather than band-level, so it is read once and drawn on every
   * page rather than living in the band list.
   */
  watermark: PreviewWatermark | null;
  /** `<CalculatedFields>`: each a name and an expression, evaluated per record. */
  calculatedFields: CalculatedField[];
  /** `<Parameters>`, whose values an expression reads as `?Name`. */
  parameters: ReportParameter[];
  /** The report's `FilterString`, decoded; null when it has none. */
  filterString: string | null;
  /** `<FormattingRuleSheet>`, by each rule's `Ref`, which is what a link points at. */
  rules: Record<string, FormattingRule>;
  /** `<CrossBandControls>`: lines and boxes drawn from one band to another (parity row 48). */
  crossBands?: CrossBandControl[];
  /** Non-fatal parse complaints, for the UI to surface rather than swallow. */
  problems: string[];
}

/**
 * An `XRCrossBandLine` or `XRCrossBandBox`: drawn from a point in its start
 * band to a point in its end band, through every band between (parity row
 * 48). Positions are from the left margin and from each band's top.
 */
export interface CrossBandControl {
  kind: 'line' | 'box';
  name: string;
  /** The `Ref`s of the bands it starts and ends in. */
  startRef: string;
  endRef: string;
  x: number;
  startY: number;
  endY: number;
  /** `WidthF`: the box's width, or the strip a line is drawn down the middle of. */
  width: number;
  /** Pixels: a box's `BorderWidth`, 2 when absent as DevExpress printed it; a line's `LineWidth`, 1. */
  strokePx: number;
  color: string | undefined;
}

/** One stretch of a cross-band control on one page, page-relative. */
export interface CrossBandSegment {
  kind: 'line' | 'box';
  left: number;
  width: number;
  top: number;
  bottom: number;
  strokePx: number;
  color: string | undefined;
}

/**
 * A text watermark, as the file carries it.
 *
 * **Image watermarks are deliberately not represented.** `RepxProbe emit-mark`
 * showed one serializes as `ImageSource="…"`, base64 — 172 characters for a 4×4
 * bitmap — so Forma never writes one, and an uploaded file that has one is
 * carried through untouched rather than drawn here. Reporting `null` for that
 * case is honest: the preview cannot show it, and pretending otherwise by
 * drawing a placeholder over every page would be worse than the omission.
 */
export interface PreviewWatermark {
  text: string;
  /** Points, like every other font size in this file. */
  fontSize: number | null;
  fontFamily: string | null;
  bold: boolean;
  color: string | null;
  /** 0–255 as DevExpress writes it; 255 is opaque. */
  transparency: number;
  /** `BackwardDiagonal`, `ForwardDiagonal` or `Horizontal`. */
  direction: string;
}

// --------------------------------------------------------------- attributes

export type CheckState = 'unchecked' | 'checked' | 'indeterminate';

/**
 * An `XRShape`'s figure, defaulting to the one DevExpress assumes.
 *
 * Bounded by the control's own extent for the same reason `parseSeries` is: a
 * band can hold two shapes and the second's `<Shape>` must not be read as the
 * first's.
 */
/**
 * A band's `<MultiColumn>` declaration, if it has one.
 *
 * Bounded to the band's own inner XML by the caller, which is enough because
 * bands do not nest here — a `DetailReportBand` does, and its inner bands are
 * parsed separately, so a nested band's columns cannot be read as its parent's.
 *
 * Note `Layout` rather than `Direction`: the API property that was called
 * `Direction` is obsolete and the serializer writes `Layout` (`emit-cols`).
 */
function parseColumns(bandInner: string): PreviewColumns | null {
  const tag = /<MultiColumn\b([^>]*)\/?>/.exec(bandInner);
  if (!tag) return null;
  const attrs = tag[1];
  return {
    count: numAttr(attrs, 'ColumnCount', 1),
    spacing: numAttr(attrs, 'ColumnSpacing', 0),
    /*
     * `DownThenAcross` is the default, measured with `RepxProbe render-cols`
     * rather than assumed — and this line said `AcrossThenDown` until that
     * measurement, which would have laid an unlabelled multi-column report out
     * in the wrong order while looking entirely plausible.
     *
     * The evidence: with no `Layout` attribute, twelve records filled the first
     * column top to bottom before any reached the second.
     */
    layout: attrOf(attrs, 'Layout') || 'DownThenAcross',
    /*
     * `None` is the default, and it means ONE column whatever ColumnCount says.
     * Measured by printing on 2026-10-30: `ColumnCount="2"` with no `Mode`
     * printed every record in a single column. This line defaulted to
     * `UseColumnCount` until then, so such a file previewed in columns that
     * DevExpress never prints. The generation prompt always said to write the
     * mode; this pane is now as strict as DevExpress about it.
     */
    mode: attrOf(attrs, 'Mode') || 'None',
    width: numAttr(attrs, 'ColumnWidth', 0),
  };
}

/**
 * The columns a band actually prints in, or null for one column.
 *
 * `printableWidth` is the page less both side margins. Measured with
 * `RepxProbe render`:
 *
 * - `UseColumnCount` divides the printable width: two columns with 20 spacing
 *   over 750 put the second at 385, each 365 wide.
 * - `UseColumnWidth` keeps the declared width and fits as many as the
 *   printable width holds: 200 wide with 20 spacing over 750 gave three, at 0,
 *   220 and 440.
 * - Any other mode, or none, is one column.
 */
export function activeColumns(
  columns: PreviewColumns | null,
  printableWidth: number,
): { count: number; width: number; spacing: number; layout: string } | null {
  if (!columns) return null;
  const { spacing, layout } = columns;
  if (columns.mode === 'UseColumnCount' && columns.count > 1) {
    return { count: columns.count, width: (printableWidth - spacing * (columns.count - 1)) / columns.count, spacing, layout };
  }
  if (columns.mode === 'UseColumnWidth' && columns.width > 0) {
    const count = Math.max(1, Math.floor((printableWidth + spacing) / (columns.width + spacing)));
    return count > 1 ? { count, width: columns.width, spacing, layout } : null;
  }
  return null;
}

/**
 * The page watermark, if the report carries a text one.
 *
 * Returns null for an image watermark — see `PreviewWatermark`. The
 * discriminator is `Text`: `RepxProbe emit-mark` showed a text watermark writes
 * `Text=` and an image one writes `ImageSource=` instead, never both.
 */
function parseWatermark(text: string): PreviewWatermark | null {
  const tag = /<Watermark\b([^>]*)\/?>/.exec(text);
  if (!tag) return null;
  const attrs = tag[1];
  const caption = decodeXmlText(attrOf(attrs, 'Text') ?? '');
  if (!caption) return null;
  const font = parseFont(attrOf(attrs, 'Font'));
  return {
    text: caption,
    fontSize: font.size,
    fontFamily: font.family,
    bold: font.bold,
    color: attrOf(attrs, 'ForeColor'),
    // 255 is opaque; DevExpress omits the attribute when it is fully opaque.
    transparency: numAttr(attrs, 'TextTransparency', 255),
    direction: attrOf(attrs, 'TextDirection') || 'Horizontal',
  };
}

/**
 * A gauge's numbers or a sparkline's field, plus whichever is bound.
 *
 * `slice` is the control's own extent so a second gauge's `<View>` cannot be
 * read as the first's — the same bounding the chart and cross-tab readers use.
 */
function parseMeter(type: string, attrs: string, slice: string): PreviewMeter {
  const num = (name: string): number | null => {
    const raw = attrOf(attrs, name);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  const binding = /PropertyName="(ActualValue|Value|ValueMember)"/.exec(slice);
  return {
    // Absent is Circular for a gauge, measured — not unknown. A sparkline's
    // <View Type="..."> is always written, so the fallback never applies there.
    view: attrOf(attrs, 'ViewType') ?? (/<View\b[^>]*\sType="([^"]*)"/.exec(slice)?.[1] ?? 'Circular'),
    value: type === 'XRGauge' ? num('ActualValue') : null,
    target: type === 'XRGauge' ? num('TargetValue') : null,
    min: type === 'XRGauge' ? num('Minimum') : null,
    max: type === 'XRGauge' ? num('Maximum') : null,
    field: type === 'XRSparkline' ? attrOf(attrs, 'ValueMember') : null,
    bound: binding ? binding[1] : null,
  };
}

function parseShapeName(inner: string, controlStart: number, controlEnd: number): string {
  const match = /<Shape\b[^>]*\sShapeName="([^"]*)"/.exec(inner.slice(controlStart, controlEnd));
  // Absent means Ellipse, measured — not "unknown".
  return match ? match[1] : 'Ellipse';
}

/**
 * A checkbox's state, from whichever of the two attributes the file carries.
 *
 * `RepxProbe emit-marks` showed DevExpress writes `Checked="true"` **and**
 * `CheckBoxState="Checked"` together for a ticked box, and neither for an empty
 * one. `CheckBoxState` wins when both are present because it is the wider type
 * — `Indeterminate` has no representation in the bool.
 *
 * A model that writes only one of the pair is still read correctly here. That is
 * deliberate leniency in the reader, not permission in the prompt, which asks
 * for both: this pane exists to show what the file says, and refusing to read a
 * half-written checkbox would hide the defect instead of displaying it.
 */
function parseCheckState(attrs: string): CheckState {
  const state = (attrOf(attrs, 'CheckBoxState') || '').toLowerCase();
  if (state === 'checked') return 'checked';
  if (state === 'indeterminate') return 'indeterminate';
  if (state === 'unchecked') return 'unchecked';
  return (attrOf(attrs, 'Checked') || '').toLowerCase() === 'true' ? 'checked' : 'unchecked';
}

const attrOf = (attrs: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
};

const numAttr = (attrs: string, name: string, fallback = 0): number => {
  const raw = attrOf(attrs, name);
  if (raw === null) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
};

/** `LocationFloat="20,30"` and `SizeF="500,40"` are both comma pairs. */
/** An element's `Dpi`: its units per inch, 100 when it writes none, as DevExpress reads it. */
function dpiOf(attrs: string): number {
  const dpi = Number(attrOf(attrs, 'Dpi'));
  return Number.isFinite(dpi) && dpi > 0 ? dpi : 100;
}

function pairAttr(attrs: string, name: string): { a: number; b: number } {
  const raw = attrOf(attrs, name);
  if (!raw) return { a: 0, b: 0 };
  const [first, second] = raw.split(',').map((p) => Number.parseFloat(p.trim()));
  return {
    a: Number.isFinite(first) ? first : 0,
    b: Number.isFinite(second) ? second : 0,
  };
}

/**
 * XML entities, in the order that keeps `&amp;lt;` reading as a literal
 * `&lt;` rather than a `<`. Ampersand last on the way out, as always.
 */
export function decodeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/**
 * The CSS text decoration a resolved `Font` asks for: `style=Underline`,
 * `style=Strikeout`, both, or neither. Read at draw time from the appearance,
 * so the parsed shapes did not have to grow for it.
 */
export function fontDecoration(font: string | null | undefined): string | undefined {
  const styles = (font ?? '').toLowerCase();
  const parts = [/style=[^"]*underline/.test(styles) && 'underline', /style=[^"]*strikeout/.test(styles) && 'line-through'].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

/**
 * A link a control may follow, as an address and nothing else: http, https and
 * mailto. The file is the user's own upload or the model's output, so a
 * `javascript:` URL in it must never become something the Preview runs.
 */
export function safeLink(url: string | null | undefined): string | null {
  const value = (url ?? '').trim();
  return /^(https?:\/\/|mailto:)/i.test(value) ? value : null;
}

/**
 * `Font="Arial, 9.75pt, style=Bold, Italic"`, or the same as a child element.
 * Size is in POINTS here and in nothing else in the file; see reportGeometry.
 */
function parseFont(value: string | null) {
  if (!value) return { family: null, size: null, bold: false, italic: false };
  const parts = value.split(',').map((p) => p.trim());
  const family = parts[0] || null;
  const sizePart = parts.find((p) => /^[\d.]+pt$/i.test(p));
  const size = sizePart ? Number.parseFloat(sizePart) : null;
  const styles = value.toLowerCase();
  return {
    family,
    size: size !== null && Number.isFinite(size) ? size : null,
    bold: /style=[^"]*bold/.test(styles),
    italic: /style=[^"]*italic/.test(styles),
  };
}

/**
 * `TextAlignment="MiddleRight"` combines vertical and horizontal in one value,
 * so it is read from both ends rather than matched against a list of twelve.
 */
function parseAlignment(value: string | null) {
  const v = (value || '').toLowerCase();
  const align: PreviewControl['align'] = v.includes('right')
    ? 'right'
    : v.includes('center')
      ? 'center'
      : 'left';
  const vAlign: PreviewControl['vAlign'] = v.startsWith('bottom')
    ? 'bottom'
    : v.startsWith('middle')
      ? 'middle'
      : 'top';
  return { align, vAlign };
}

/** `Borders="Top, Bottom"`, `"All"`, `"None"`, or absent. */
function parseBorders(value: string | null) {
  const v = (value || '').toLowerCase();
  const all = v.includes('all');
  return {
    top: all || v.includes('top'),
    right: all || v.includes('right'),
    bottom: all || v.includes('bottom'),
    left: all || v.includes('left'),
  };
}

// --------------------------------------------------------------- appearance

const APPEARANCE: AppearanceProperty[] = [
  'Font', 'ForeColor', 'BackColor', 'TextAlignment', 'Padding', 'Borders', 'BorderColor', 'BorderWidth',
];

/**
 * The name each property has INSIDE A STYLE, where it differs or is absent.
 *
 * A control's `Borders` is a style's `Sides` (`RepxProbe emit-styles`). And a
 * style's `BorderWidth` is left out on purpose: printed with `BorderWidth="2"`
 * in the style, the border came out 1 wide, so reading it from a style would
 * draw something DevExpress does not.
 */
const STYLE_NAME: Record<AppearanceProperty, string | null> = {
  Font: 'Font',
  ForeColor: 'ForeColor',
  BackColor: 'BackColor',
  TextAlignment: 'TextAlignment',
  Padding: 'Padding',
  Borders: 'Sides',
  BorderColor: 'BorderColor',
  BorderWidth: null,
};

/**
 * What a report with no font anywhere prints in: Times New Roman, 9.75pt.
 *
 * Measured, not assumed: a table carrying no `Font` on itself, its band or the
 * report printed in exactly that through DevExpress 20.1. This pane used to fall
 * back to 9pt in the app's own typeface. It is 20.1's default, the version
 * installed here; a later DevExpress may differ, and a generated report almost
 * always writes its own fonts anyway.
 */
export const DEFAULT_APPEARANCE: Appearance = { Font: 'Times New Roman, 9.75pt' };

/** Each named style in the report's `<StyleSheet>`, as control-side properties. */
function parseStyleSheet(text: string): Map<string, Appearance> {
  const styles = new Map<string, Appearance>();
  const block = /<StyleSheet>([\s\S]*?)<\/StyleSheet>/.exec(text);
  if (!block) return styles;
  for (const item of collectionItems(block[1])) {
    const name = attrOf(item.attrs, 'Name');
    if (!name) continue;
    const style: Appearance = {};
    for (const property of APPEARANCE) {
      const inStyle = STYLE_NAME[property];
      const value = inStyle ? attrOf(item.attrs, inStyle) : null;
      if (value !== null) style[property] = value;
    }
    styles.set(name, style);
  }
  return styles;
}

/**
 * The part of an element's text that is its OWN: its opening tag and the
 * children that describe it, but not the controls, rows or cells nested in it.
 *
 * A table's `<StylePriority>` must not be confused with one on its first cell,
 * so the search stops at the first nested collection.
 */
function ownPart(slice: string): string {
  const nested = slice.slice(1).search(/<(Controls|Rows|Cells|Bands)[\s>]/);
  return nested === -1 ? slice : slice.slice(0, nested + 1);
}

/**
 * A control's appearance as DevExpress prints it.
 *
 * For each property, in this order, the first that applies wins -- the order
 * every case of row 3 of the parity table printed:
 *
 * 1. **The control's style**, when it sets the property and the control carries
 *    no `<StylePriority Use… ="false" />` child for it. A style beats the
 *    control's own attribute: `Font="Arial, 8pt"` under a 16pt style printed
 *    16pt. The flag is a CHILD ELEMENT; the dotted attribute form
 *    `StylePriority.UseFont` is ignored by DevExpress and so is ignored here.
 * 2. **The control's own attribute.**
 * 3. **Its parent's resolved value** -- panel, row, table, band, then the
 *    report. A cell with nothing of its own printed in its table's style; a
 *    label printed in its band's font, borders, padding, alignment and fill.
 *
 * One measured exception: **an `XRPanel`'s `ForeColor` is dropped.** A panel
 * writing `ForeColor="Teal"` printed in its report's colour, and so did its
 * children, while its own fill and borders applied. So a panel passes down its
 * parent's colour, not its own.
 */
export function resolveAppearance(
  attrs: string,
  ownSlice: string,
  styles: ReadonlyMap<string, Appearance>,
  parent: Appearance,
  type = '',
): Appearance {
  const style = styles.get(attrOf(attrs, 'StyleName') ?? '') ?? {};
  const priority = /<StylePriority\b([^>]*?)\/?>/.exec(ownSlice)?.[1] ?? '';
  const out: Appearance = {};
  for (const property of APPEARANCE) {
    if (type === 'XRPanel' && property === 'ForeColor') {
      if (parent.ForeColor !== undefined) out.ForeColor = parent.ForeColor;
      continue;
    }
    const fromStyle = style[property];
    const styleWins = fromStyle !== undefined && attrOf(priority, `Use${property}`) !== 'false';
    const value = styleWins ? fromStyle : attrOf(attrs, property) ?? parent[property];
    if (value !== undefined) out[property] = value;
  }
  return out;
}

/**
 * An `XRSubreport`'s report: the `<ReportSource>` it embeds, read as a report of
 * its own -- the serializer writes it with the root's attributes and its own
 * `<Bands>` (`RepxProbe emit-container`) -- or the `ReportSourceUrl` it names.
 */
function parseSubreport(
  attrs: string,
  slice: string,
  hostDpi = 100,
  hostUnit = 'HundredthsOfAnInch',
): { structure: ReportStructure | null; url: string | null } {
  const at = slice.indexOf('<ReportSource');
  const open = at === -1 ? null : /^<ReportSource\b([^>]*)>/.exec(slice.slice(at));
  const span = open ? innerSpan(slice, 'ReportSource', at) : null;
  const url = attrOf(attrs, 'ReportSourceUrl');
  return {
    // In the host's unit, since the host lays it out inside the control.
    structure: open && span
      ? parseReportStructure(`<XtraReportsLayoutSerializer${open[1]}>${span.text}</XtraReportsLayoutSerializer>`, { dpi: hostDpi, unit: hostUnit })
      : null,
    url: url === null ? null : decodeXmlText(url),
  };
}

/** The appearance properties a node sets itself, by its own attribute or its style: none inherited. */
function ownPropsOf(attrs: string, ownSlice: string, styles: ReadonlyMap<string, Appearance>, type = ''): AppearanceProperty[] {
  return Object.keys(resolveAppearance(attrs, ownSlice, styles, {}, type)) as AppearanceProperty[];
}

/** The `Ref`s a node's `<FormattingRuleLinks>` point at, in link order. */
/** The properties an expression binding is applied to besides the text, as s31a and s31d printed them. */
const BOUND_PROPERTIES = new Set([
  'Visible', 'ForeColor', 'BackColor', 'BorderColor', 'Borders', 'TextAlignment',
  'Font.Bold', 'Font.Italic', 'Font.Underline', 'Font.Strikeout', 'Font.Size', 'Font.Name',
]);

/** A node's own expression bindings on those properties, from its own part of the file. */
function parseAppearanceBindings(ownSlice: string): AppearanceBinding[] {
  const block = /<ExpressionBindings>([\s\S]*?)<\/ExpressionBindings>/.exec(ownSlice);
  if (!block) return [];
  const out: AppearanceBinding[] = [];
  for (const m of block[1].matchAll(/<Item\d+\b([^>]*?)\/?>/g)) {
    const property = attrOf(m[1], 'PropertyName');
    const expression = attrOf(m[1], 'Expression');
    if (property && expression !== null && BOUND_PROPERTIES.has(property)) out.push({ property, expression: decodeXmlText(expression) });
  }
  return out;
}

/**
 * The report's `<CrossBandControls>`, as the serializer wrote them in s31c and
 * s34: `StartBand` and `EndBand` name bands by `Ref`, and each point is from
 * the left margin and from that band's top. A box with no `BorderWidth`
 * printed a 2-pixel frame. Each is read at its own `Dpi`, as every control is.
 */
function crossBandsOf(text: string, targetDpi: number): { crossBands?: CrossBandControl[] } {
  const block = /<CrossBandControls>([\s\S]*?)<\/CrossBandControls>/.exec(text);
  if (!block) return {};
  const out: CrossBandControl[] = [];
  for (const m of block[1].matchAll(/<Item\d+\b([^>]*?)\/?>/g)) {
    const type = attrOf(m[1], 'ControlType');
    if (type !== 'XRCrossBandLine' && type !== 'XRCrossBandBox') continue;
    const startRef = /^#Ref-(\d+)$/.exec(attrOf(m[1], 'StartBand') ?? '')?.[1];
    const endRef = /^#Ref-(\d+)$/.exec(attrOf(m[1], 'EndBand') ?? '')?.[1];
    if (!startRef || !endRef) continue;
    const scale = targetDpi / dpiOf(m[1]);
    const start = pairAttr(m[1], 'StartPointFloat');
    const end = pairAttr(m[1], 'EndPointFloat');
    const box = type === 'XRCrossBandBox';
    out.push({
      kind: box ? 'box' : 'line',
      name: attrOf(m[1], 'Name') ?? '',
      startRef,
      endRef,
      x: start.a * scale,
      startY: start.b * scale,
      endY: end.b * scale,
      width: numAttr(m[1], 'WidthF', box ? 0 : 1) * scale,
      strokePx: box ? numAttr(m[1], 'BorderWidth', 2) : numAttr(m[1], 'LineWidth', 1),
      color: attrOf(m[1], box ? 'BorderColor' : 'ForeColor') ?? undefined,
    });
  }
  return out.length ? { crossBands: out } : {};
}

/** `ProcessDuplicatesMode` and `ProcessNullValues`, for a control that writes either. */
function repeatsOf(attrs: string): Pick<PreviewControl, 'duplicates' | 'nulls'> {
  const duplicates = attrOf(attrs, 'ProcessDuplicatesMode');
  const nulls = attrOf(attrs, 'ProcessNullValues');
  return {
    ...(duplicates === 'Suppress' || duplicates === 'SuppressAndShrink' || duplicates === 'Merge' ? { duplicates } : {}),
    ...(nulls === 'Suppress' || nulls === 'SuppressAndShrink' ? { nulls } : {}),
  };
}

/** `{ bindings }` for a node that has any, and nothing for one that has none. */
function boundProperties(ownSlice: string): { bindings?: AppearanceBinding[] } {
  const bindings = parseAppearanceBindings(ownSlice);
  return bindings.length ? { bindings } : {};
}

function parseRuleLinks(ownSlice: string): string[] {
  const block = /<FormattingRuleLinks>([\s\S]*?)<\/FormattingRuleLinks>/.exec(ownSlice);
  if (!block) return [];
  return [...block[1].matchAll(/\sValue="#Ref-(\d+)"/g)].map((m) => m[1]);
}

/** `<FormattingRuleSheet>`, by each rule's `Ref`. */
function parseRuleSheet(text: string): Record<string, FormattingRule> {
  const block = /<FormattingRuleSheet>([\s\S]*?)<\/FormattingRuleSheet>/.exec(text);
  const rules: Record<string, FormattingRule> = {};
  if (!block) return rules;
  for (const m of block[1].matchAll(/<Item\d+\b([^>]*?)>\s*<Formatting\b([^>]*?)\/?>/g)) {
    const ref = attrOf(m[1], 'Ref');
    const condition = attrOf(m[1], 'Condition');
    if (!ref || condition === null) continue;
    const appearance: Appearance = {};
    for (const property of APPEARANCE) {
      const value = attrOf(m[2], property);
      if (value !== null) appearance[property] = value;
    }
    const visible = attrOf(m[2], 'Visible');
    rules[ref] = {
      name: attrOf(m[1], 'Name') ?? '',
      condition: decodeXmlText(condition),
      appearance,
      visible: visible === null ? null : visible.toLowerCase() !== 'false',
    };
  }
  return rules;
}

// ------------------------------------------------------------------ parsing

/**
 * The substring of `xml` inside the element that starts at `openIndex`, and
 * where that substring begins.
 *
 * The offset is what makes editing possible: a control parsed out of a band's
 * inner text knows its position within that slice, and adding the slice's own
 * start walks it back to a real offset in the document. `repxEdit.ts` splices
 * at those offsets, so everything the model wrote that is not being changed
 * survives byte for byte.
 *
 * Nested opens are counted so a `<Controls>` inside a `<Controls>` does not end
 * the outer one early. Null for a self-closing or unterminated element.
 */
function innerSpan(xml: string, tagName: string, openIndex: number): { text: string; start: number } | null {
  const openEnd = xml.indexOf('>', openIndex);
  if (openEnd === -1) return null;
  if (xml[openEnd - 1] === '/') return null; // self-closing: no children
  /*
   * Match WHOLE tags, so a self-closing one can be told from an opening one.
   *
   * The previous version searched for `<Item2` and `</Item2>` separately and
   * counted every `<Item2` as a nesting level. A self-closing `<Item2 ... />`
   * has no `</Item2>`, so it pushed the depth up by one and nothing ever
   * brought it back down: the scan ran off the end and returned null.
   *
   * That is not a hypothetical. Item numbering restarts inside every
   * collection, so a band `<Item2 ControlType="ReportHeaderBand">` holding two
   * or more controls contains a control named `<Item2 ... />` — self-closing,
   * because most controls have no children. The band's inner XML came back
   * null and **every control in it silently vanished from the Preview**, while
   * the exported REPX was perfectly correct. Found on 2026-09-05 by a checkbox
   * fixture whose Detail band happened to be `Item1`.
   */
  const scanner = new RegExp(
    `<(/?)${tagName}((?:\\s+[\\w.:-]+\\s*=\\s*"[^"]*")*)\\s*(/?)>`,
    'g',
  );
  scanner.lastIndex = openEnd + 1;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(xml)) !== null) {
    if (match[1] === '/') {
      depth--;
      if (depth === 0) return { text: xml.slice(openEnd + 1, match.index), start: openEnd + 1 };
    } else if (match[3] !== '/') {
      depth++;
    }
  }
  return null;
}

/** The inner text alone, for the callers that do not need to splice. */
function innerXml(xml: string, tagName: string, openIndex: number): string | null {
  return innerSpan(xml, tagName, openIndex)?.text ?? null;
}

/**
 * Every direct `<ItemN …>` of a collection element, with its attributes.
 *
 * Depth-tracked on purpose. A band's `<Controls>` contains an XRTable whose own
 * `<Rows>` contains more `ItemN` elements, so a flat scan would report a
 * table's cells as controls of the band -- drawn at the cell's row-relative
 * coordinates, which are meaningless outside the table.
 */
function collectionItems(inner: string): { tag: string; attrs: string; start: number }[] {
  const out: { tag: string; attrs: string; start: number }[] = [];
  const scanner = /<(\/?)([\w.:-]+)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(inner)) !== null) {
    const [, closing, tag, attrs, selfClosing] = match;
    if (closing) {
      depth--;
      continue;
    }
    if (depth === 0 && /^Item\d+$/.test(tag)) {
      out.push({ tag, attrs, start: match.index });
    }
    if (!selfClosing) depth++;
  }
  return out;
}

/**
 * The field a control's `Text` is bound to, from the slice of XML that is that
 * control's own extent (so a table's slice is never read for a label and a
 * cell's never for its neighbour).
 *
 * DevExpress writes the binding item's attributes as EventName, PropertyName,
 * Expression (measured on the 26.1 designer's own output, 2026-10-28); this
 * project's `bindDetailRow` writes the same order. Both orders are accepted
 * because an attribute order is not a contract.
 */
function parseTextData(attrs: string, slice: string): TextData {
  const own = ownPart(slice);
  const item =
    /<Item\d+\b[^>]*\sPropertyName="Text"[^>]*\sExpression="([^"]*)"/.exec(own) ??
    /<Item\d+\b[^>]*\sExpression="([^"]*)"[^>]*\sPropertyName="Text"/.exec(own);
  const summary = /<Summary\b([^>]*?)\/?>/.exec(own);
  const format = attrOf(attrs, 'TextFormatString');
  return {
    expression: item ? decodeXmlText(item[1]) : null,
    running: summary ? attrOf(summary[1], 'Running') ?? 'None' : null,
    format: format === null ? null : decodeXmlText(format),
  };
}

/** `NavigateUrl` as an attribute or as an expression binding, from the control's own part. */
function parseLink(attrs: string, slice: string): { literal: string | null; expression: string | null } | null {
  const own = ownPart(slice);
  const item =
    /<Item\d+\b[^>]*\sPropertyName="NavigateUrl"[^>]*\sExpression="([^"]*)"/.exec(own) ??
    /<Item\d+\b[^>]*\sExpression="([^"]*)"[^>]*\sPropertyName="NavigateUrl"/.exec(own);
  const literal = attrOf(attrs, 'NavigateUrl');
  if (!item && literal === null) return null;
  return { literal: literal === null ? null : decodeXmlText(literal), expression: item ? decodeXmlText(item[1]) : null };
}

function parseTextBinding(slice: string): string | null {
  const item =
    /<Item\d+\b[^>]*\sPropertyName="Text"[^>]*\sExpression="([^"]*)"/.exec(slice) ??
    /<Item\d+\b[^>]*\sExpression="([^"]*)"[^>]*\sPropertyName="Text"/.exec(slice);
  if (!item) return null;
  const field = /\[([A-Za-z_][\w.]*)\]/.exec(decodeXmlText(item[1]));
  return field ? field[1] : null;
}

/**
 * A table's rows and cells, each cell's appearance resolved through its own
 * style, its row and the table's (`tableLook`) -- a cell with nothing of its own
 * printed in its table's style, fill and borders included.
 */
function parseTableRows(
  xml: string,
  controlStart: number,
  styles: ReadonlyMap<string, Appearance> = new Map(),
  tableLook: Appearance = DEFAULT_APPEARANCE,
): PreviewRow[] {
  const rowsIdx = xml.indexOf('<Rows', controlStart);
  if (rowsIdx === -1) return [];
  const rowsInner = innerXml(xml, 'Rows', rowsIdx);
  if (!rowsInner) return [];
  const rows: PreviewRow[] = [];
  const rowItems = collectionItems(rowsInner);
  for (const [rowIndex, item] of rowItems.entries()) {
    if (attrOf(item.attrs, 'ControlType') !== 'XRTableRow') continue;
    const rowEnd = rowItems[rowIndex + 1]?.start ?? rowsInner.length;
    const rowLook = resolveAppearance(item.attrs, ownPart(rowsInner.slice(item.start, rowEnd)), styles, tableLook);
    const rowOwn = ownPropsOf(item.attrs, ownPart(rowsInner.slice(item.start, rowEnd)), styles);
    const cellsIdx = rowsInner.indexOf('<Cells', item.start);
    const cellsInner = cellsIdx === -1 ? null : innerXml(rowsInner, 'Cells', cellsIdx);
    const cells: PreviewCell[] = [];
    const items = cellsInner ? collectionItems(cellsInner) : [];
    for (const [index, cell] of items.entries()) {
      if (attrOf(cell.attrs, 'ControlType') !== 'XRTableCell') continue;
      // This cell's own extent: up to the next cell, or the end of the collection.
      const extent = items[index + 1]?.start ?? cellsInner!.length;
      const slice = cellsInner!.slice(cell.start, extent);
      const look = resolveAppearance(cell.attrs, slice, styles, rowLook);
      const font = parseFont(look.Font ?? null);
      const alignment = parseAlignment(look.TextAlignment ?? null);
      cells.push({
        text: decodeXmlText(attrOf(cell.attrs, 'Text') || ''),
        weight: numAttr(cell.attrs, 'Weight', 1) || 1,
        fontSize: font.size,
        fontFamily: font.family,
        bold: font.bold,
        italic: font.italic,
        align: alignment.align,
        vAlign: alignment.vAlign,
        borders: parseBorders(look.Borders ?? null),
        appearance: look,
        canGrow: (attrOf(cell.attrs, 'CanGrow') ?? '').toLowerCase() !== 'false',
        wordWrap: (attrOf(cell.attrs, 'WordWrap') ?? '').toLowerCase() !== 'false',
        data: parseTextData(cell.attrs, slice),
        field: parseTextBinding(slice),
        rules: parseRuleLinks(ownPart(slice)),
        ...boundProperties(ownPart(slice)),
        ownProps: [...new Set([...ownPropsOf(cell.attrs, slice, styles), ...rowOwn])],
      });
    }
    rows.push({ cells });
  }
  return shareTableBorders(rows);
}

/**
 * Draw each shared table edge once, as DevExpress does.
 *
 * Measured with `RepxProbe render` on 2026-10-30 (row 6 of the parity table),
 * on a two-by-two table with `Borders="All"`: the top-left cell drew all four
 * sides, the cell to its right dropped its left, the cell below dropped its
 * top, and the last cell dropped both. A cell drops an edge that the cell to
 * its left, or the cell above, already draws -- and the shared edge then
 * prints in THAT cell's style: a cell writing `Borders="Left"` with its own red
 * 3-wide border, beside a cell drawing `Right`, printed no border of its own.
 *
 * "Above" is every cell in the previous row that overlaps this one across the
 * table, and the top is dropped only when all of them draw a bottom. Aligned
 * grids, the only shape measured, reduce to the cell directly above.
 */
export function shareTableBorders(rows: PreviewRow[]): PreviewRow[] {
  const spans = rows.map((row) => {
    const total = row.cells.reduce((sum, c) => sum + c.weight, 0) || 1;
    let at = 0;
    return row.cells.map((c) => {
      const span = { from: at / total, to: (at + c.weight) / total };
      at += c.weight;
      return span;
    });
  });
  return rows.map((row, r) => ({
    ...row,
    cells: row.cells.map((cell, c) => {
      const sides = { ...cell.borders };
      if (c > 0 && row.cells[c - 1].borders.right) sides.left = false;
      if (r > 0 && sides.top) {
        const mine = spans[r][c];
        const above = rows[r - 1].cells.filter((_, k) => {
          const s = spans[r - 1][k];
          return Math.min(s.to, mine.to) - Math.max(s.from, mine.from) > 1e-9;
        });
        if (above.length && above.every((a) => a.borders.bottom)) sides.top = false;
      }
      return { ...cell, borders: sides };
    }),
  }));
}

/**
 * A DevExpress colour as CSS, or undefined for none.
 *
 * The file writes three forms, all printed as written on 2026-10-30: a .NET
 * name (`Navy`, `LightYellow`), hex (`#FF8800`), and comma-separated ARGB
 * (`255,200,220,240` printed as `#C8DCF0`). Three numbers are RGB. CSS knows
 * the .NET names the measured reports used.
 */
export function cssColor(value: string | undefined | null): string | undefined {
  const v = (value ?? '').trim();
  if (!v) return undefined;
  const parts = v.split(',').map((p) => Number(p.trim()));
  if (parts.length === 4 && parts.every(Number.isFinite)) {
    const [a, r, g, b] = parts;
    return a >= 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
  }
  if (parts.length === 3 && parts.every(Number.isFinite)) return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
  return v;
}

/**
 * `Padding="left,right,top,bottom,dpi"` as CSS pixels at 96 per inch, in CSS
 * order. The last number is the unit the other four are in: 100 is hundredths
 * of an inch. Printed on 2026-10-30, ten hundredths of padding put the text
 * 7.2pt inside the border.
 */
export function cssPadding(value: string | undefined | null): string | undefined {
  const parts = (value ?? '').split(',').map((p) => Number(p.trim()));
  if (parts.length < 4 || !parts.slice(0, 4).every(Number.isFinite)) return undefined;
  const dpi = parts[4] && parts[4] > 0 ? parts[4] : 100;
  const px = (n: number) => `${Math.round((n / dpi) * 96 * 100) / 100}px`;
  const [left, right, top, bottom] = parts;
  return `${px(top)} ${px(right)} ${px(bottom)} ${px(left)}`;
}

/**
 * The series of an XRChart, from the slice starting at its opening tag.
 *
 * Bounded by the control's own extent rather than searched globally, because a
 * band can hold two charts and the second's series must not be read as the
 * first's. `<SeriesSerializable>` does not nest, so a plain match inside that
 * window is enough.
 */
function parseSeries(inner: string, controlStart: number, controlEnd: number): PreviewSeries[] {
  const slice = inner.slice(controlStart, controlEnd);
  const block = /<SeriesSerializable>([\s\S]*?)<\/SeriesSerializable>/.exec(slice);
  if (!block) return [];
  const out: PreviewSeries[] = [];
  for (const item of collectionItems(block[1])) {
    const name = attrOf(item.attrs, 'Name');
    if (name === null) continue;
    // The <View> child, when present, belongs to THIS item: take the text from
    // this item's start to the next one's.
    const rest = block[1].slice(item.start);
    const nextItem = /<Item\d+[\s>]/.exec(rest.slice(1));
    const own = nextItem ? rest.slice(0, nextItem.index + 1) : rest;
    const view = /TypeNameSerializable="([^"]*)"/.exec(own);
    out.push({
      name,
      argument: attrOf(item.attrs, 'ArgumentDataMember') ?? '',
      value: attrOf(item.attrs, 'ValueDataMembersSerializable') ?? '',
      view: view ? view[1] : '',
    });
  }
  return out;
}

/** The three field collections of an XRCrossTab, in the same bounded window. */
function parseCrossTab(inner: string, controlStart: number, controlEnd: number): PreviewCrossTab {
  const slice = inner.slice(controlStart, controlEnd);
  const fields = (tag: string): string[] => {
    const block = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(slice);
    if (!block) return [];
    return collectionItems(block[1])
      .map((item) => attrOf(item.attrs, 'FieldName') ?? '')
      .filter(Boolean);
  };
  const facts = crossTabFacts(slice);
  return {
    rows: fields('RowFields'),
    columns: fields('ColumnFields'),
    data: fields('DataFields'),
    printable: facts.printable,
    measured: facts.measured,
    layoutColumns: facts.columns,
    layoutRows: facts.rows,
  };
}

/**
 * Read an `XRPanel`'s children, flattened into the band's own control list.
 *
 * **A panel's children are positioned relative to the panel**, not to the band
 * — measured with `RepxProbe emit-container`, where a child at `LocationFloat
 * "10,10"` inside a panel at `"100,100"` is written verbatim and *means* 110,110
 * on the page. Drawing those numbers as band-relative would stack every child in
 * the top-left corner of the band, next to the panel rather than inside it.
 *
 * So `x`/`y` stay exactly as the file writes them — which is what an edit has to
 * write back — and the panel's own position travels alongside in `offsetX`/
 * `offsetY` for the renderer to add. Keeping the two apart is what lets dragging
 * a child work without a conversion at the point of writing.
 */
function parseControls(
  bandInner: string,
  bandInnerStart: number,
  styles: ReadonlyMap<string, Appearance> = new Map(),
  parentLook: Appearance = DEFAULT_APPEARANCE,
  parentVisible = true,
  /** Properties a containing panel sets itself, which a band's rule cannot reach past. */
  shield: readonly AppearanceProperty[] = [],
  /** Units per inch of the unit geometry is read into, and that unit: the report's own, or its host's. */
  targetDpi = 100,
  targetUnit = 'HundredthsOfAnInch',
): PreviewControl[] {
  const controlsIdx = bandInner.indexOf('<Controls');
  if (controlsIdx === -1) return [];
  const span = innerSpan(bandInner, 'Controls', controlsIdx);
  if (!span) return [];
  const inner = span.text;
  // Where `inner` begins in the whole document, so a control's offset within
  // it can be reported absolutely.
  const innerStart = bandInnerStart + span.start;
  const controls: PreviewControl[] = [];
  const items = collectionItems(inner);
  for (const [index, item] of items.entries()) {
    const type = attrOf(item.attrs, 'ControlType');
    if (!type) continue;
    // This control's own extent: up to the next sibling, or the end. Used to
    // stop a chart reading the next chart's series.
    const extent = items[index + 1]?.start ?? inner.length;
    // DevExpress reads every control at its own Dpi, 100 when absent, whatever
    // the report's unit (s24, s28), so its numbers are put in the report's
    // unit here. The file's own numbers are what an edit writes back, divided
    // by `dpiScale` again.
    const dpiScale = targetDpi / dpiOf(item.attrs);
    const raw = { loc: pairAttr(item.attrs, 'LocationFloat'), size: pairAttr(item.attrs, 'SizeF') };
    // A control written above or left of its band's or panel's corner loads at
    // 0 and prints there (s29e, s29e2; parity rows 36 and 42), and a panel moved
    // so takes its children with it.
    const loc = { a: Math.max(0, raw.loc.a * dpiScale), b: Math.max(0, raw.loc.b * dpiScale) };
    const size = { a: raw.size.a * dpiScale, b: raw.size.b * dpiScale };
    // Style first, then the control's own attribute, then its parent's: what
    // DevExpress prints, not what this element writes. See resolveAppearance.
    const look = resolveAppearance(item.attrs, ownPart(inner.slice(item.start, extent)), styles, parentLook, type);
    const font = parseFont(look.Font ?? null);
    const alignment = parseAlignment(look.TextAlignment ?? null);
    controls.push({
      type,
      name: attrOf(item.attrs, 'Name') || '',
      x: loc.a,
      y: loc.b,
      width: size.a,
      height: size.b,
      text: decodeXmlText(attrOf(item.attrs, 'Text') || ''),
      // A table's bindings belong to its cells, read in parseTableRows.
      field: type === 'XRTable' ? null : parseTextBinding(inner.slice(item.start, extent)),
      fontSize: font.size,
      fontFamily: font.family,
      bold: font.bold,
      italic: font.italic,
      align: alignment.align,
      vAlign: alignment.vAlign,
      borders: parseBorders(look.Borders ?? null),
      appearance: look,
      visible: parentVisible && (attrOf(item.attrs, 'Visible') ?? '').toLowerCase() !== 'false',
      canGrow: (attrOf(item.attrs, 'CanGrow') ?? '').toLowerCase() !== 'false',
      canShrink: (attrOf(item.attrs, 'CanShrink') ?? '').toLowerCase() === 'true',
      wordWrap: (attrOf(item.attrs, 'WordWrap') ?? '').toLowerCase() !== 'false',
      data: type === 'XRTable' ? { expression: null, running: null, format: null } : parseTextData(item.attrs, inner.slice(item.start, extent)),
      link: parseLink(item.attrs, inner.slice(item.start, extent)),
      rules: parseRuleLinks(ownPart(inner.slice(item.start, extent))),
      ...boundProperties(ownPart(inner.slice(item.start, extent))),
      ...repeatsOf(item.attrs),
      subreport: type === 'XRSubreport' ? parseSubreport(item.attrs, inner.slice(item.start, extent), targetDpi, targetUnit) : null,
      ownProps: [...new Set([...ownPropsOf(item.attrs, ownPart(inner.slice(item.start, extent)), styles, type), ...shield])],
      pageInfo: type === 'XRPageInfo'
        ? {
            kind: attrOf(item.attrs, 'PageInfo') || 'NumberOfTotal',
            format: attrOf(item.attrs, 'TextFormatString') === null ? null : decodeXmlText(attrOf(item.attrs, 'TextFormatString')!),
            start: numAttr(item.attrs, 'StartPageNumber', 1),
          }
        : null,
      rows: type === 'XRTable' ? parseTableRows(inner, item.start, styles, look) : [],
      series: type === 'XRChart' ? parseSeries(inner, item.start, extent) : [],
      crossTab: type === 'XRCrossTab' ? parseCrossTab(inner, item.start, extent) : null,
      /*
       * Read `CheckBoxState` rather than `Checked`, though DevExpress writes
       * both when a box is ticked (`RepxProbe emit-marks`). `Checked` is a
       * two-value bool and `CheckBoxState` is the enum that also carries
       * `Indeterminate`, so the enum is the one that can express every state
       * the control has. Absent means unchecked -- neither attribute is written
       * for the default, so the empty box is the silent case.
       */
      checkState: type === 'XRCheckBox' ? parseCheckState(item.attrs) : null,
      /*
       * `RepxProbe emit-rich`: the shape lives in a `<Shape ShapeName="..." />`
       * child, and **Ellipse writes no element at all** because it is the
       * default. So an absent child is an ellipse, not an unknown — reading it
       * as "no shape" would draw nothing where DevExpress draws a circle.
       */
      shape: type === 'XRShape' ? parseShapeName(inner, item.start, extent) : null,
      meter:
        type === 'XRGauge' || type === 'XRSparkline'
          ? parseMeter(type, item.attrs, inner.slice(item.start, extent))
          : null,
      offsetX: 0,
      offsetY: 0,
      dpiScale,
      openStart: innerStart + item.start,
      openEnd: innerStart + inner.indexOf('>', item.start),
    });

    /*
     * A panel's children, flattened in after the panel itself so they paint on
     * top of its border. They carry the panel's position as their offset; see
     * the note on this function for why that is not folded into x/y.
     *
     * One level only, deliberately. DevExpress allows panels inside panels and
     * nothing here forbids it, but no source document Forma has been given
     * nests them, and a recursive reader is a recursive set of offset bugs
     * waiting for a document to trigger them. Nested children are simply not
     * drawn; the outer panel still is, so the omission is visible rather than
     * silent. Make it recursive the day a real report needs it.
     */
    if (type === 'XRPanel') {
      const panelSlice = inner.slice(item.start, extent);
      const childIdx = panelSlice.indexOf('<Controls');
      const childSpan = childIdx === -1 ? null : innerSpan(panelSlice, 'Controls', childIdx);
      if (childSpan) {
        const panelIndex = controls.length - 1;
        const panelVisible = controls[panelIndex].visible;
        const panelOwn = controls[panelIndex].ownProps;
        for (const child of parseControls(panelSlice, innerStart + item.start, styles, look, panelVisible, panelOwn, targetDpi, targetUnit)) {
          controls.push({ ...child, offsetX: loc.a, offsetY: loc.b, panel: panelIndex });
        }
      }
    }
  }
  return controls;
}

function bandKind(controlType: string): BandKind {
  const name = controlType.replace(/Band$/, '');
  return (BAND_ORDER as string[]).includes(name) ? (name as BandKind) : 'Unknown';
}

/** `<CalculatedFields>`, in declaration order, which is the order they are added to a record. */
function parseCalculatedFields(text: string): CalculatedField[] {
  const block = /<CalculatedFields>([\s\S]*?)<\/CalculatedFields>/.exec(text);
  if (!block) return [];
  const out: CalculatedField[] = [];
  for (const m of block[1].matchAll(/<Item\d+\b([^>]*?)\/?>/g)) {
    const name = attrOf(m[1], 'Name');
    const expression = attrOf(m[1], 'Expression');
    if (name && expression !== null) out.push({ name, expression: decodeXmlText(expression) });
  }
  return out;
}

/**
 * Read the page, the margins and every band out of a `.repx`.
 *
 * Never throws. An unusable document comes back with no bands and a `problems`
 * entry saying so, which is what the caller renders.
 */
export function parseReportStructure(
  xml: string | undefined | null,
  /**
   * Read the geometry into another unit: an embedded subreport's report is
   * laid out inside its host, so its numbers are wanted in the host's unit.
   */
  into?: { dpi: number; unit: string },
): ReportStructure {
  const text = xml ?? '';
  const problems: string[] = [];
  const empty: ReportStructure = {
    page: { width: 850, height: 1100 },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    unit: 'HundredthsOfAnInch',
    bands: [],
    watermark: null,
    calculatedFields: [],
    parameters: [],
    filterString: null,
    rules: {},
    problems,
  };

  if (!text.trim()) {
    problems.push('There is no REPX to preview yet.');
    return empty;
  }

  const rootMatch = /<XtraReportsLayoutSerializer((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)/.exec(text);
  if (!rootMatch) {
    problems.push('This does not look like a DevExpress report: no XtraReportsLayoutSerializer element.');
    return empty;
  }
  const rootAttrs = rootMatch[1];

  // Margins="left, right, top, bottom" -- DevExpress writes them in that order,
  // which is not the CSS order and is the kind of thing that renders a
  // plausible page with the wrong gap at the top.
  const marginRaw = (attrOf(rootAttrs, 'Margins') || '')
    .split(',')
    .map((p) => Number.parseFloat(p.trim()))
    .map((n) => (Number.isFinite(n) ? n : 0));

  /*
   * Every band and control is read at its own Dpi, 100 when absent, whatever
   * ReportUnit says -- measured by printing in s24 and s28, where a millimetre
   * report without Dpi printed 2.54 times its size and a label with Dpi in a
   * band without one printed at its own. So each element's numbers are scaled
   * into the report's unit by the report's units per inch over its own Dpi,
   * and the Preview draws what DevExpress prints (parity row 35). The root's
   * Dpi governs the side margins the same way; the paper did not scale.
   */
  const ownUnit = attrOf(rootAttrs, 'ReportUnit') || 'HundredthsOfAnInch';
  const targetUnit = into?.unit ?? ownUnit;
  const targetDpi = into?.dpi ?? unitsPerInch(ownUnit);
  const rootScale = targetDpi / dpiOf(rootAttrs);
  const pageScale = into ? targetDpi / unitsPerInch(ownUnit) : 1;
  // The paper DevExpress prints on: PaperKind's, Letter when there is none,
  // whatever PageWidth and PageHeight say (parity row 44, s30).
  const paper = printedPaper(rootAttrs);

  const structure: ReportStructure = {
    page: {
      width: paper.width * pageScale,
      height: paper.height * pageScale,
    },
    margins: {
      top: (marginRaw[2] ?? 0) * rootScale,
      bottom: (marginRaw[3] ?? 0) * rootScale,
      left: (marginRaw[0] ?? 0) * rootScale,
      right: (marginRaw[1] ?? 0) * rootScale,
    },
    unit: targetUnit,
    bands: [],
    watermark: parseWatermark(text),
    calculatedFields: parseCalculatedFields(text),
    parameters: parseParameters(text),
    filterString: attrOf(rootAttrs, 'FilterString') ? decodeXmlText(attrOf(rootAttrs, 'FilterString')!) : null,
    rules: parseRuleSheet(text),
    ...crossBandsOf(text, targetDpi),
    problems,
  };

  const bandsIdx = text.indexOf('<Bands');
  const bandsSpan = bandsIdx === -1 ? null : innerSpan(text, 'Bands', bandsIdx);
  if (!bandsSpan) {
    problems.push('The report has no <Bands> element, so there is nothing to lay out.');
    return structure;
  }
  const bandsInner = bandsSpan.text;

  // Appearance flows report -> band -> panel or table -> row -> cell, with a
  // style beating a control's own attribute at every level. The report's own
  // Font and ForeColor reach a Detail label that sets neither; measured.
  const styles = parseStyleSheet(text);
  const reportLook = resolveAppearance(rootAttrs, '', styles, DEFAULT_APPEARANCE);

  /*
   * One band collection; a DetailReportBand's own <Bands> are read the same way,
   * into its `sub`. Until 2026-10-30 a detail report was an "unrecognised"
   * band whose first nested label was read as its own control, and nothing of
   * it printed (parity row 14).
   */
  const byPrintOrder = (a: PreviewBand, b: PreviewBand) => BAND_ORDER.indexOf(a.kind) - BAND_ORDER.indexOf(b.kind);
  const parseBandList = (inner: string, base: number, parentLook: Appearance): PreviewBand[] => {
    const out: PreviewBand[] = [];
    for (const item of collectionItems(inner)) {
      const controlType = attrOf(item.attrs, 'ControlType');
      if (!controlType || !/Band$/.test(controlType)) continue;
      const kind = bandKind(controlType);
      if (kind === 'Unknown') {
        problems.push(`Unrecognised band type "${controlType}" — it is drawn in file order.`);
      }
      const bandSpan = innerSpan(inner, item.tag, item.start);
      const bandLook = resolveAppearance(item.attrs, bandSpan ? ownPart(bandSpan.text) : '', styles, parentLook, controlType);
      let sub: SubReport | null = null;
      if (kind === 'DetailReport') {
        const nestedAt = bandSpan ? bandSpan.text.indexOf('<Bands') : -1;
        const nested = bandSpan && nestedAt !== -1 ? innerSpan(bandSpan.text, 'Bands', nestedAt) : null;
        const filter = attrOf(item.attrs, 'FilterString');
        sub = {
          dataMember: attrOf(item.attrs, 'DataMember'),
          filterString: filter ? decodeXmlText(filter) : null,
          bands: nested && bandSpan ? parseBandList(nested.text, base + bandSpan.start + nested.start, bandLook).sort(byPrintOrder) : [],
        };
      }
      const dpiScale = targetDpi / dpiOf(item.attrs);
      const columns = bandSpan && kind !== 'DetailReport' ? parseColumns(bandSpan.text) : null;
      out.push({
        kind,
        name: attrOf(item.attrs, 'Name') || controlType,
        ...(attrOf(item.attrs, 'Ref') ? { ref: attrOf(item.attrs, 'Ref')! } : {}),
        height: numAttr(item.attrs, 'HeightF', 0) * dpiScale,
        dpiScale,
        // A detail report has no controls of its own; its bands do.
        controls: bandSpan && kind !== 'DetailReport'
          ? parseControls(bandSpan.text, base + bandSpan.start, styles, bandLook, true, [], targetDpi, targetUnit)
          : [],
        columns: columns && { ...columns, spacing: columns.spacing * dpiScale, width: columns.width * dpiScale },
        keepTogether: (attrOf(item.attrs, 'KeepTogether') ?? '').toLowerCase() === 'true',
        printOn: attrOf(item.attrs, 'PrintOn') || 'AllPages',
        printAtBottom: (attrOf(item.attrs, 'PrintAtBottom') ?? '').toLowerCase() === 'true',
        fields: bandSpan && kind !== 'DetailReport' ? parseBandFields(bandSpan.text, kind === 'Detail' ? 'SortFields' : 'GroupFields') : [],
        level: numAttr(item.attrs, 'Level', 0),
        repeatEveryPage: (attrOf(item.attrs, 'RepeatEveryPage') ?? '').toLowerCase() === 'true',
        groupUnion: attrOf(item.attrs, 'GroupUnion') || 'None',
        pageBreak: attrOf(item.attrs, 'PageBreak') || 'None',
        sub,
        rules: bandSpan ? parseRuleLinks(ownPart(bandSpan.text)) : [],
      });
    }
    return out;
  };
  structure.bands.push(...parseBandList(bandsInner, bandsSpan.start, reportLook));

  if (!structure.bands.length) problems.push('No bands were found inside <Bands>.');

  // A subreport loaded from a file cannot be drawn here: say which, once.
  const loaded = structure.bands.flatMap((b) => b.controls).filter((c) => c.subreport?.url && !c.subreport.structure);
  if (loaded.length) {
    problems.push(
      `${loaded.length} subreport(s) load another file (${loaded.slice(0, 3).map((c) => c.subreport!.url).join(', ')}), ` +
        'which the Preview cannot open; each is drawn as a box where DevExpress prints that report.',
    );
  }

  // Print order, not file order. DevExpress places a band by its type, so a file
  // listing PageHeader after Detail still renders the same report -- the preview
  // sorts here so it does not draw one that DevExpress would not. `repxAudit`
  // reports the misordering as `band-order`, and names the real consequence:
  // `repxMargins.ts` reads this collection in FILE order, so out of order the
  // margin lift measures from the wrong band or declines.
  //
  // That cross-reference was here before the check was: this comment claimed
  // "repxAudit reports that" from the day it was written, and no such check
  // existed until 2026-09-06. It is true now.
  //
  // Array.prototype.sort has been stable since ES2019, which is load-bearing
  // here rather than incidental: nested groups produce several GroupHeaderBands
  // that all share one rank, and their relative order is the nesting. An
  // unstable sort would reorder region-then-category into category-then-region,
  // which is a different report.
  structure.bands.sort(
    (a, b) => BAND_ORDER.indexOf(a.kind) - BAND_ORDER.indexOf(b.kind),
  );

  return structure;
}

// -------------------------------------------------------------- band layout

/** One record's values, keyed by bound field name -- the Preview's test data. */
export type RecordValues = Record<string, string>;

/** The row's value for a bound field, or the control's own text when there is none. */
export function printedText(text: string, field: string | null, record: RecordValues | null | undefined): string {
  if (!record || !field) return text;
  const value = record[field];
  return value === undefined ? text : value;
}

/**
 * A control as it prints in one instance of its band.
 *
 * `y` and `height` are relative to the instance, in report units, AFTER the
 * control has grown to fit its text, been pushed down by growing controls
 * above it, and been cut at a page break. `y` already includes a panel's
 * offset, so the renderer draws at `y` and not at the file's `LocationFloat`.
 */
export interface PlacedControl {
  control: PreviewControl;
  /** Its index in the band's `controls`, which edits address it by. */
  index: number;
  y: number;
  height: number;
  /** The lines this part prints when the text was measured; null when it was not. */
  lines: string[] | null;
  /** For an XRTable: the first row this part prints, and each printed row's height. */
  rowStart: number;
  rowHeights: number[] | null;
  /**
   * What it prints: its binding evaluated over the test data and formatted, or
   * its own text. Null for a control that prints no text of its own (a table,
   * a page number). For a table, `cellTexts` holds every row's cells.
   */
  text: string | null;
  cellTexts: string[][] | null;
  /**
   * Where the control links to in this placement, an http, https or mailto
   * address only; null for none. Printed in c08: a literal and a bound
   * `NavigateUrl` both became link annotations in DevExpress's PDF, and the
   * browser keeps an anchor's link when it prints, so the Preview's does too.
   */
  url?: string | null;
  /**
   * The typed value the binding evaluated to, before formatting, for an export
   * that keeps numbers as numbers; undefined with no test data or no binding.
   * For a table, `cellValues` holds every row's cells.
   */
  value?: Value | null;
  cellValues?: (Value | null | undefined)[][] | null;
  /** For an embedded subreport: its report's bands as laid out, relative to the control. */
  inner?: PlacedBand[] | null;
  /** For a cross-tab over test data: the grid it prints; null where its structure is drawn. */
  crossTab?: CrossTabGrid | null;
}

/** One printed occurrence of a band: a record's Detail, a page's header, a split part. */
export interface BandInstance {
  band: PreviewBand;
  record: number | null;
  height: number;
  controls: PlacedControl[];
  /** The records its text read, when there is test data; kept to reprint it once its page is known. */
  scope?: TextScope | null;
}

interface LayoutContext {
  measure: MeasureText | null;
  unit: string;
  /** The test data, typed; null when there is none and controls print their own text. */
  data?: ReportData | null;
  /** The report's formatting rules, by `Ref`. */
  rules?: Record<string, FormattingRule>;
  /**
   * The test rows once each, typed, before the report's filter: what a
   * cross-tab reads, since it has a data source of its own.
   */
  source?: readonly TypedRow[] | null;
  /** The band's printable width, which a cross-tab's grid must fit inside. */
  contentWidth?: number;
}

/** What the rules linked by `refs` set for this record: later links win, property by property. */
function firedRules(refs: readonly string[], ctx: LayoutContext, scope: TextScope | null) {
  let look: Appearance | null = null;
  let visible: boolean | null = null;
  if (!refs.length || !ctx.data || !scope || !ctx.rules) return { look, visible };
  for (const ref of refs) {
    const rule = ctx.rules[ref];
    if (!rule) continue;
    if (!isTrue(ctx.data.value({ expression: rule.condition, running: null, format: null }, scope) ?? null)) continue;
    look = { ...(look ?? {}), ...rule.appearance };
    if (rule.visible !== null) visible = rule.visible;
  }
  return { look, visible };
}

/** The font styles a `Font.` binding can turn on or off, as DevExpress writes them. */
const FONT_STYLES = ['Bold', 'Italic', 'Underline', 'Strikeout'];

/** `font` with one part changed: its family, its size in points, or one style. */
function fontWith(font: string | undefined, part: string, value: Value): string {
  const tokens = (font ?? DEFAULT_APPEARANCE.Font!).split(',').map((t) => t.trim()).filter(Boolean);
  let family = tokens[0] ?? 'Times New Roman';
  let size = tokens.find((t) => /^[\d.]+pt$/i.test(t)) ?? '9.75pt';
  const styles = new Set<string>();
  const rest: string[] = [];
  for (const token of tokens.slice(1)) {
    const name = token.replace(/^style=/i, '');
    if (FONT_STYLES.includes(name)) styles.add(name);
    else if (token !== size) rest.push(token);
  }
  if (part === 'Font.Name') family = String(value);
  else if (part === 'Font.Size') size = `${Number(value)}pt`;
  else if (isTrue(value)) styles.add(part.slice('Font.'.length));
  else styles.delete(part.slice('Font.'.length));
  const style = FONT_STYLES.filter((s) => styles.has(s));
  return [family, size, ...(style.length ? [`style=${style.join(', ')}`] : []), ...rest].join(', ');
}

/**
 * `look` with a node's expression bindings applied for this record, and what
 * `Visible` binds to (parity row 45). Printed in s31a and s31d: each binding
 * changed its node record by record, a table cell's included. Without test
 * data nothing is evaluated, as for text.
 */
function boundAppearance(look: Appearance, bindings: readonly AppearanceBinding[] | undefined, ctx: LayoutContext, scope: TextScope | null) {
  let visible: boolean | null = null;
  if (!bindings?.length || !ctx.data || !scope) return { look, visible };
  const out = { ...look };
  for (const { property, expression } of bindings) {
    let value: Value | undefined;
    try {
      value = ctx.data.value({ expression, running: null, format: null }, scope);
    } catch {
      continue;
    }
    if (value === undefined || value === null) continue;
    if (property === 'Visible') visible = isTrue(value);
    else if (property.startsWith('Font.')) out.Font = fontWith(out.Font, property, value);
    else out[property as AppearanceProperty] = String(value);
  }
  return { look: out, visible };
}

/** A node re-read through an appearance a rule changed: font, alignment and borders follow it. */
function restyled<T extends { appearance: Appearance; fontSize: number | null; fontFamily: string | null; bold: boolean; italic: boolean; align: string; vAlign: string; borders: PreviewControl['borders'] }>(node: T, look: Appearance): T {
  const font = parseFont(look.Font ?? null);
  const alignment = parseAlignment(look.TextAlignment ?? null);
  return {
    ...node,
    appearance: look,
    fontSize: font.size,
    fontFamily: font.family,
    bold: font.bold,
    italic: font.italic,
    align: alignment.align,
    vAlign: alignment.vAlign,
    borders: parseBorders(look.Borders ?? null),
  };
}

/** `look` with `over` laid on it, only where `owned` does not claim the property. */
function inheritInto(look: Appearance, over: Appearance | null, owned: readonly AppearanceProperty[]): Appearance {
  if (!over) return look;
  const out = { ...look };
  for (const [p, v] of Object.entries(over) as [AppearanceProperty, string][]) if (!owned.includes(p)) out[p] = v;
  return out;
}

/**
 * A control as it prints for one record, its formatting rules applied
 * (parity row 26). Measured in case s22a, five rules over six records:
 *
 * - a rule applies per record, on exactly the records its condition holds for;
 * - where two linked rules set one property, the LATER link wins, and their
 *   other properties merge: "High" (red, bold) then "Blue" printed blue and bold;
 * - `Visible="False"` removes the control from that record, and the band keeps
 *   its height;
 * - a rule linked to the band reaches its controls by inheritance: every label
 *   on a shaded record printed the band's fill, its own rules on top.
 *
 * An expression binding on an appearance property applies first, so a rule
 * setting the same property wins over it: printed in s31d, a label bound red
 * and caught by a green rule printed green (parity row 45).
 *
 * The control itself is unchanged when nothing fires, so the common case costs
 * an object identity and nothing else.
 */
function applyRules(control: PreviewControl, band: { look: Appearance | null }, ctx: LayoutContext, scope: TextScope | null): PreviewControl {
  const own = firedRules(control.rules, ctx, scope);
  const bound = !!control.bindings?.length && !!ctx.data && !!scope;
  const cellRules = control.type === 'XRTable' && control.rows.some((r) => r.cells.some((c) => c.rules.length || c.bindings?.length));
  if (!band.look && !own.look && own.visible === null && !bound && !cellRules) return control;
  let out = control;
  let visible = own.visible;
  if (band.look || own.look || bound) {
    const bindings = boundAppearance(inheritInto(control.appearance, band.look, control.ownProps), control.bindings, ctx, scope);
    out = restyled(control, { ...bindings.look, ...(own.look ?? {}) });
    visible ??= bindings.visible;
  }
  if (visible !== null) out = { ...out, visible };
  if (control.type === 'XRTable') {
    const rows = control.rows.map((row) => ({
      cells: row.cells.map((cell) => {
        const fired = firedRules(cell.rules, ctx, scope);
        if (!band.look && !own.look && !fired.look && !cell.bindings?.length) return cell;
        // A band's rule reaches a cell only past the table's own properties.
        let look = inheritInto(cell.appearance, band.look, [...cell.ownProps, ...control.ownProps]);
        look = inheritInto(look, own.look, cell.ownProps);
        look = boundAppearance(look, cell.bindings, ctx, scope).look;
        return restyled(cell, { ...look, ...(fired.look ?? {}) });
      }),
    }));
    out = { ...out, rows: shareTableBorders(rows) };
  }
  return out;
}

/**
 * Whether a control prints nothing on this record, keeping its space, because
 * its value is null or repeats the record before's (parity row 46). Printed
 * in s31b and s32: a null printed nothing under `ProcessNullValues`, and under
 * `ProcessDuplicatesMode="Suppress"` a value printed on the first record of
 * each run and nowhere after it, compared with the record before in print
 * order, across a page break and across a group break alike. Without test
 * data nothing is suppressed, so the Preview shows every record as designed.
 */
function suppressed(control: PreviewControl, band: PreviewBand, ctx: LayoutContext, scope: TextScope | null): boolean {
  const repeats = control.duplicates === 'Suppress' || control.duplicates === 'SuppressAndShrink';
  if (!ctx.data || !scope || (!control.nulls && !repeats)) return false;
  if (control.nulls && ctx.data.value(control.data, scope) === null) return true;
  if (!repeats || band.kind !== 'Detail' || scope.row === null || scope.row < 1) return false;
  const before = { ...scope, row: scope.row - 1, anchor: scope.row - 1 };
  return textsOf(control, null, ctx, before).text === textsOf(control, null, ctx, scope).text;
}

/**
 * Where each cross-band line and box prints, page by page (parity row 48).
 * Printed in s31c and s34: one runs from its start band's top plus its start
 * point to its end band's top plus its end point, each start paired with the
 * next end, so a line from a group header to its group footer prints once
 * per group. On a page it only crosses it runs from below the page header to
 * above the page footer, and so it does on its first and last pages beyond
 * the band it starts or ends in: a group's line stopped at the page footer's
 * top and began again below the next page's header.
 */
function drawCrossBands(
  controls: readonly CrossBandControl[],
  bands: readonly PreviewBand[],
  pages: PreviewPage[],
  content: { top: number; bottom: number; left: number },
): void {
  for (const cb of controls) {
    const start = bands.find((b) => b.ref === cb.startRef);
    const end = bands.find((b) => b.ref === cb.endRef);
    if (!start || !end) continue;
    let open = false;
    for (const page of pages) {
      const header = page.bands.find((b) => b.band.kind === 'PageHeader');
      const footer = page.bands.find((b) => b.band.kind === 'PageFooter');
      const top = header ? header.top + header.height : content.top;
      const bottom = footer ? footer.top : content.bottom;
      const draw = (from: number, to: number) => (page.crossBands ??= []).push({
        kind: cb.kind, left: content.left + cb.x, width: cb.width, top: from, bottom: to, strokePx: cb.strokePx, color: cb.color,
      });
      let from: number | null = open ? top : null;
      for (const pb of [...page.bands].sort((a, b) => a.top - b.top)) {
        if (pb.band === start && from === null) {
          if (start === end) draw(pb.top + cb.startY, pb.top + cb.endY);
          else from = pb.top + cb.startY;
        } else if (pb.band === end && from !== null) {
          draw(from, pb.top + cb.endY);
          from = null;
        }
      }
      if (from !== null) draw(from, bottom);
      open = from !== null;
    }
  }
}

/**
 * A `ProcessDuplicatesMode="Merge"` control printed once per run on each page
 * (parity row 46). Printed in s31b and s32a: a run of equal values printed one
 * box, from the top of the run's first record's control to the bottom of its
 * last's, its text aligned within that box, and a run crossing a page break
 * printed a box on each page, the value on both. Runs are consecutive Detail
 * placements of one band; anything printed between them ends a run.
 */
function mergeRuns(pages: PreviewPage[]): void {
  type Member = { at: number; pc: PlacedControl };
  for (const page of pages) {
    const runs = new Map<number, { band: PreviewBand; text: string; members: Member[] }>();
    const drop = new Map<number, Set<PlacedControl>>();
    const close = (key: number) => {
      const run = runs.get(key);
      runs.delete(key);
      if (!run || run.members.length < 2) return;
      const [first, last] = [run.members[0], run.members[run.members.length - 1]];
      const top = page.bands[first.at].top + first.pc.y;
      const bottom = page.bands[last.at].top + last.pc.y + last.pc.height;
      page.bands[first.at] = {
        ...page.bands[first.at],
        controls: page.bands[first.at].controls.map((pc) => (pc === first.pc ? { ...pc, height: bottom - top } : pc)),
      };
      for (const m of run.members.slice(1)) (drop.get(m.at) ?? drop.set(m.at, new Set()).get(m.at)!).add(m.pc);
    };
    page.bands.forEach((pb, at) => {
      if (pb.band.kind !== 'Detail') {
        for (const key of [...runs.keys()]) close(key);
        return;
      }
      for (const pc of pb.controls) {
        if (pc.control.duplicates !== 'Merge') continue;
        const text = pc.text ?? pc.control.text;
        const run = runs.get(pc.index);
        if (run && run.band === pb.band && run.text === text) run.members.push({ at, pc });
        else {
          close(pc.index);
          runs.set(pc.index, { band: pb.band, text, members: [{ at, pc }] });
        }
      }
    });
    for (const key of [...runs.keys()]) close(key);
    for (const [at, gone] of drop) page.bands[at] = { ...page.bands[at], controls: page.bands[at].controls.filter((pc) => !gone.has(pc)) };
  }
}

/**
 * What a control prints in one instance: its binding evaluated in `scope` when
 * there is test data, otherwise the row's raw value or its own text, as before
 * parity row 12.
 */
function textFor(
  literal: string,
  field: string | null,
  data: TextData,
  values: RecordValues | null,
  ctx: LayoutContext,
  scope: TextScope | null,
): string {
  const evaluated = ctx.data && scope ? ctx.data.text(data, scope) : null;
  return evaluated ?? printedText(literal, field, values);
}

/** Every text a control prints in one instance; see `PlacedControl.text`. */
function textsOf(control: PreviewControl, values: RecordValues | null, ctx: LayoutContext, scope: TextScope | null) {
  const valueOf = (data: TextData) => (ctx.data && scope ? ctx.data.value(data, scope) : undefined);
  if (control.type === 'XRTable') {
    return {
      text: null,
      cellTexts: control.rows.map((row) => row.cells.map((cell) => textFor(cell.text, cell.field, cell.data, values, ctx, scope))),
      cellValues: ctx.data ? control.rows.map((row) => row.cells.map((cell) => valueOf(cell.data))) : null,
    };
  }
  if (control.pageInfo) return { text: null, cellTexts: null, url: linkFor(control, ctx, scope) };
  return {
    text: textFor(control.text, control.field, control.data, values, ctx, scope),
    cellTexts: null,
    url: linkFor(control, ctx, scope),
    value: valueOf(control.data),
  };
}

/** A control's `NavigateUrl` in one instance: its expression evaluated over the test data, or its literal. */
function linkFor(control: PreviewControl, ctx: LayoutContext, scope: TextScope | null): string | null {
  if (!control.link) return null;
  const { literal, expression } = control.link;
  const evaluated = expression && ctx.data && scope ? ctx.data.text({ expression, running: null, format: null }, scope) : null;
  return safeLink(evaluated ?? literal);
}

const EPS = 1e-6;
const MEASURED_TYPES = new Set(['XRLabel']);

/** Points inside a control's edge, from its padding and drawn borders. */
function insetsPt(look: Appearance, borders: PreviewControl['borders']) {
  const pad = (look.Padding ?? '').split(',').map((p) => Number(p.trim()));
  const dpi = pad[4] && pad[4] > 0 ? pad[4] : 100;
  const padPt = (i: number) => (Number.isFinite(pad[i]) ? (pad[i] / dpi) * 72 : 0);
  const width = Number.parseFloat(look.BorderWidth ?? '');
  const borderPt = (Number.isFinite(width) && width > 0 ? width : 1) * 0.75;
  return {
    left: padPt(0) + (borders.left ? borderPt : 0),
    right: padPt(1) + (borders.right ? borderPt : 0),
    top: padPt(2) + (borders.top ? borderPt : 0),
    bottom: padPt(3) + (borders.bottom ? borderPt : 0),
  };
}

/**
 * The height a piece of text needs, in report units, with the lines it breaks
 * into. The formula is the one DevExpress printed: lines times the font's line
 * spacing, plus 1.5pt, plus the vertical padding and borders. See textMeasure.ts.
 */
function textHeight(
  text: string,
  font: { family: string | null; size: number | null; bold: boolean; italic: boolean },
  widthUnits: number,
  look: Appearance,
  borders: PreviewControl['borders'],
  wordWrap: boolean,
  ctx: LayoutContext,
): { lines: string[]; needUnits: number; shrinkUnits: number } {
  const perInch = unitsPerInch(ctx.unit);
  const toPt = (units: number) => (units / perInch) * 72;
  const toUnits = (pt: number) => (pt / 72) * perInch;
  const inset = insetsPt(look, borders);
  const spec: FontSpec = {
    family: font.family ?? 'Times New Roman',
    sizePt: font.size ?? 9.75,
    bold: font.bold,
    italic: font.italic,
  };
  const area = toPt(widthUnits) - inset.left - inset.right;
  const lines = wordWrap ? ctx.measure!(text, spec, area) : text ? [text.replace(/\r?\n/g, ' ')] : [];
  const spacing = lineSpacingPt(spec.family, spec.sizePt);
  const body = lines.length * spacing + inset.top + inset.bottom;
  return {
    lines,
    needUnits: lines.length ? toUnits(body + GROW_EXTRA_PT) : 0,
    shrinkUnits: lines.length ? toUnits(body + SHRINK_EXTRA_PT) : 0,
  };
}

/**
 * A band with no visible control, which DevExpress prints as nothing at all
 * (parity row 41). Printed in s29x1, s29x2, s29s6 and s29x3: an empty page
 * header, Detail band, group header and page footer took no room, and nor
 * did a band holding only a hidden label, or only a fill and borders, whose
 * fill did not print either. The empty page footer left its room to the
 * records, 33 a page where it would have allowed 30. The margin bands are not
 * included: their height is the page's margin whatever they hold.
 */
export function isEmptyBand(band: PreviewBand): boolean {
  return band.kind !== 'TopMargin' && band.kind !== 'BottomMargin' && !band.controls.some((c) => c.visible);
}

/**
 * How tall a band prints before anything grows: its declared height, or its
 * lowest visible control's bottom when that is lower down. Printed in s29a, a
 * report header declared 100 holding a label to 140 printed 140, and the
 * page header, Detail band and page footer did the same. The loader keeps the
 * declared `HeightF`, so this is a rule of printing, not of the file. Lines
 * and tables count; a hidden control does not (s29e). A panel counts at the
 * height it holds its children to, unless it says `CanGrow="false"` (row 37).
 * Margin bands are page furniture and stay fixed, which `paginate` already
 * does by never laying them out.
 */
export function heldHeight(band: PreviewBand): number {
  if (isEmptyBand(band)) return 0;
  const held = (c: PreviewControl, index: number) =>
    c.type === 'XRPanel' && c.canGrow
      ? Math.max(c.height, ...band.controls.filter((k) => k.visible && k.panel === index).map((k) => k.y + k.height))
      : c.height;
  return Math.max(band.height, ...band.controls.map((c, index) => (c.visible && c.panel === undefined ? c.y + held(c, index) : 0)));
}

/**
 * Lay out one printed instance of a band, the way DevExpress grows it.
 *
 * With no measurer every control keeps its designed size, which is what the
 * Preview did before parity rows 7 and 8 and what the Node-side checks want.
 * With one, measured by printing through DevExpress 20.1:
 *
 * - a label grows to fit its text when `CanGrow` (the default), and shrinks to
 *   it when `CanShrink`; `WordWrap="false"` keeps it to one line;
 * - a table row grows to its tallest cell, and every cell takes that height;
 * - a control whose top is at or below a growing control's bottom moves down by
 *   that growth -- whether or not the two overlap across the band, which the
 *   printed report showed for a label beside, not under, the growing one;
 * - the band prints at least to its lowest visible control, and grows by
 *   however far its lowest content moved, keeping the space that was below it.
 *   That is `heldHeight` plus the growth, whatever the band's `CanGrow` says
 *   (parity row 36, s29a to s29g).
 */
export function layoutBand(
  band: PreviewBand,
  record: number | null,
  values: RecordValues | null,
  ctx: LayoutContext,
  scope: TextScope | null = null,
): BandInstance {
  // The band's own rules for this record: its fill and the like reach its
  // controls by inheritance; `Visible="False"` drops the band from this record.
  const bandRules = firedRules(band.rules, ctx, scope);
  if (bandRules.visible === false || isEmptyBand(band)) return { band, record, scope, height: 0, controls: [] };
  const items = band.controls
    .map((control, index) => ({ control: applyRules(control, { look: bandRules.look }, ctx, scope), index }))
    .filter(({ control }) => control.visible && !suppressed(control, band, ctx, scope))
    .map(({ control, index }) => {
      const top = control.y + control.offsetY;
      let height = control.height;
      let lines: string[] | null = null;
      let rowHeights: number[] | null = null;
      let inner: PlacedBand[] | null = null;
      let crossTab: CrossTabGrid | null = null;
      const texts = textsOf(control, values, ctx, scope);
      if (control.crossTab && (crossTab = crossTabGrid(control, ctx))) {
        // A cross-tab grows by whole cells to hold its grid, as s23 printed.
        if (crossTab.height > height) height = crossTab.height;
      } else if (control.subreport?.structure) {
        // An embedded subreport grows to its report's height, as s22b printed.
        const laid = subreportLayout(control.subreport.structure, ctx);
        inner = laid.bands;
        if (control.canGrow && laid.height > height) height = laid.height;
      } else if (ctx.measure && MEASURED_TYPES.has(control.type)) {
        const text = texts.text ?? '';
        const m = textHeight(text, { family: control.fontFamily, size: control.fontSize, bold: control.bold, italic: control.italic },
          control.width, control.appearance, control.borders, control.wordWrap, ctx);
        lines = m.lines;
        if (control.canGrow && m.needUnits > height) height = m.needUnits;
        else if (control.canShrink && m.shrinkUnits < height) height = m.shrinkUnits;
      } else if (ctx.measure && control.type === 'XRTable' && control.rows.length) {
        const designRow = control.height / control.rows.length;
        rowHeights = control.rows.map((row, r) => {
          const total = row.cells.reduce((sum, c) => sum + c.weight, 0) || 1;
          let tallest = designRow;
          for (const [c, cell] of row.cells.entries()) {
            if (!cell.canGrow) continue;
            const text = texts.cellTexts?.[r]?.[c] ?? '';
            const m = textHeight(text, { family: cell.fontFamily, size: cell.fontSize, bold: cell.bold, italic: cell.italic },
              (control.width * cell.weight) / total, cell.appearance, cell.borders, cell.wordWrap, ctx);
            tallest = Math.max(tallest, m.needUnits);
          }
          return tallest;
        });
        height = rowHeights.reduce((sum, h) => sum + h, 0);
      }
      return { control, index, top, designHeight: control.height, height, lines, rowHeights, inner, crossTab, shift: 0, ...texts };
    })
    .sort((a, b) => a.top - b.top);
  type Item = (typeof items)[number];

  /*
   * Push-down, cascading: each control moves by the largest growth of anything
   * that ended at or above its top, plus however far that thing itself moved.
   * `at` is a control's top within its container. Returns the container's
   * designed and placed bottoms.
   */
  const pushDown = (group: Item[], at: (it: Item) => number) => {
    for (let i = 0; i < group.length; i++) {
      for (let j = 0; j < i; j++) {
        const above = group[j];
        if (at(above) + above.designHeight <= at(group[i]) + EPS) {
          group[i].shift = Math.max(group[i].shift, above.shift + Math.max(0, above.height - above.designHeight));
        }
      }
    }
    return {
      design: Math.max(0, ...group.map((it) => at(it) + it.designHeight)),
      placed: Math.max(0, ...group.map((it) => at(it) + it.shift + it.height)),
    };
  };

  /*
   * A panel is laid out like a small band (parity row 37). Its children grow
   * and push one another inside it, from their own panel-relative tops, and it
   * holds them and grows by their growth unless it says `CanGrow="false"`. In
   * its band it then pushes as one control: printed in s29h, a label below the
   * panel moved with it and one beside it did not, though that one sat below
   * the growing child. A child whose panel did not print does not print.
   */
  const panels = new Map<number, Item>(items.filter((it) => it.control.type === 'XRPanel').map((it) => [it.index, it]));
  const kept = items.filter((it) => it.control.panel === undefined || panels.has(it.control.panel));
  for (const panel of panels.values()) {
    const children = kept.filter((it) => it.control.panel === panel.index).sort((a, b) => a.control.y - b.control.y);
    const inside = pushDown(children, (it) => it.control.y);
    if (panel.control.canGrow) panel.height = Math.max(panel.designHeight, inside.design) + Math.max(0, inside.placed - inside.design);
  }
  const bottoms = pushDown(kept.filter((it) => it.control.panel === undefined), (it) => it.top);
  const yOf = (it: Item) => {
    const panel = it.control.panel === undefined ? undefined : panels.get(it.control.panel);
    return panel ? panel.top + panel.shift + it.control.y + it.shift : it.top + it.shift;
  };

  return {
    band,
    record,
    scope,
    height: Math.max(band.height, bottoms.design) + Math.max(0, bottoms.placed - bottoms.design),
    controls: kept.map((it) => ({
      control: it.control,
      index: it.index,
      y: yOf(it),
      height: it.height,
      lines: it.lines,
      rowStart: 0,
      rowHeights: it.rowHeights,
      text: it.text,
      cellTexts: it.cellTexts,
      url: it.url ?? null,
      value: it.value,
      cellValues: it.cellValues ?? null,
      inner: it.inner,
      crossTab: it.crossTab,
    })),
  };
}

const crossTabCache = new WeakMap<PreviewCrossTab, WeakMap<readonly TypedRow[], CrossTabGrid | null>>();

/** One value of a field: strings by exact text, as "b" and "B" printed apart in s25. */
const sameKey = (a: Value, b: Value) =>
  a === null || b === null ? a === b : typeof a === 'string' || typeof b === 'string' ? a === b : sortCompare(a, b) === 0;

/**
 * A cross-tab as DevExpress prints it over the test rows (parity row 31), or
 * null where the Preview keeps drawing its structure.
 *
 * Printed in cases s23 and s25 for up to one field of each kind. The header
 * row holds the row field's name, each column value and `Grand Total`. Then
 * comes one row per row value and a `Grand Total` row. Values sort with a
 * missing one first and then by en-US collation, numbers by value, which is
 * `sortCompare`. Each intersection is the sum of its records' data values,
 * unformatted and in the data's own type. It is blank where no record falls,
 * and 0 where records fall but none has a value. Every cell takes an equal
 * share of the control's size per the generated layout, and the grid grows
 * from there by whole cells.
 *
 * Null keeps the structure drawing for what was not printed, or what would
 * not print: no test data, a layout DevExpress refuses, two fields of a kind,
 * a setting on a field or a style on a cell, data that is not numeric, and a
 * grid wider than the page, which DevExpress continues onto another page.
 */
function crossTabGrid(control: PreviewControl, ctx: LayoutContext): CrossTabGrid | null {
  const tab = control.crossTab;
  const rows = ctx.source;
  if (!tab || !rows?.length || !tab.printable || !tab.measured) return null;
  if (tab.rows.length > 1 || tab.columns.length > 1 || tab.data.length > 1) return null;
  let byRows = crossTabCache.get(tab);
  if (!byRows) crossTabCache.set(tab, (byRows = new WeakMap()));
  let grid = byRows.get(rows);
  if (grid === undefined) {
    grid = buildCrossTabGrid(tab, rows, control.width / tab.layoutColumns, control.height / tab.layoutRows);
    byRows.set(rows, grid);
  }
  if (!grid || (ctx.contentWidth !== undefined && control.x + control.offsetX + grid.width > ctx.contentWidth + 0.5)) return null;
  return grid;
}

function buildCrossTabGrid(tab: PreviewCrossTab, rows: readonly TypedRow[], cellWidth: number, cellHeight: number): CrossTabGrid | null {
  const [rowField] = tab.rows;
  const [columnField] = tab.columns;
  const [dataField] = tab.data;
  const amount = dataField === undefined ? null : parseCriteria(`[${dataField.replace(/]/g, ']]')}]`);
  if (dataField !== undefined) {
    const numeric = rows.every((r) => {
      const v = r[dataField] ?? null;
      return v === null || typeof v === 'bigint' || typeof v === 'number' || v instanceof NetDecimal;
    });
    if (!numeric) return null;
  }

  const keys = (field: string | undefined) => {
    if (field === undefined) return [null];
    const out: Value[] = [];
    for (const r of rows) {
      const v = r[field] ?? null;
      if (!out.some((o) => sameKey(o, v))) out.push(v);
    }
    return out.sort(sortCompare);
  };
  const rowKeys = keys(rowField);
  const columnKeys = keys(columnField);
  const matches = (field: string | undefined, key: Value) => (r: TypedRow) => field === undefined || sameKey(r[field] ?? null, key);

  /** The sum over these records: blank with none, 0 when none has a value. */
  const total = (records: readonly TypedRow[]): { text: string; value?: Value } => {
    if (!amount || !records.length) return { text: '' };
    const sum = aggregate('sumsum', [amount], records, 0, () => null) ?? 0n;
    return { text: valueText(sum), value: sum };
  };

  const columnCount = 1 + columnKeys.length + (columnField !== undefined ? 1 : 0);
  const rowCount = 1 + rowKeys.length + (rowField !== undefined ? 1 : 0);
  const cells: CrossTabGridCell[] = [];
  const put = (column: number, row: number, cell: { text: string; value?: Value }) =>
    cells.push({ x: column * cellWidth, y: row * cellHeight, width: cellWidth, height: cellHeight, ...cell });
  const key = (v: Value) => (v === null ? { text: '' } : { text: valueText(v), value: v });

  put(0, 0, { text: rowField ?? '' });
  columnKeys.forEach((k, c) => put(1 + c, 0, columnField === undefined ? { text: '' } : key(k)));
  if (columnField !== undefined) put(columnCount - 1, 0, { text: 'Grand Total' });

  const bodyRows = [...rowKeys.map((k) => ({ head: rowField === undefined ? { text: '' } : key(k), keep: matches(rowField, k) }))];
  if (rowField !== undefined) bodyRows.push({ head: { text: 'Grand Total' }, keep: () => true });
  bodyRows.forEach(({ head, keep }, r) => {
    const inRow = rows.filter(keep);
    put(0, 1 + r, head);
    columnKeys.forEach((k, c) => put(1 + c, 1 + r, total(inRow.filter(matches(columnField, k)))));
    if (columnField !== undefined) put(columnCount - 1, 1 + r, total(inRow));
  });

  return { width: columnCount * cellWidth, height: rowCount * cellHeight, cells };
}

const subreportCache = new WeakMap<ReportStructure, Map<MeasureText | null, { height: number; bands: PlacedBand[] }>>();

/**
 * An embedded subreport's report, laid out as it prints inside its control
 * (parity row 27). Measured in s22b: the whole inner report printed at the
 * control's place, once for every master record -- its report header, then its
 * Detail band once, since it has no data of its own -- and the control grew to
 * that height, the band with it. Its page header and footer are left out, as a
 * subreport has no page of its own, and its margins do not apply: the content
 * starts at the control's top left. Laid out once per report and measurer,
 * since every record prints the same thing.
 */
function subreportLayout(structure: ReportStructure, ctx: LayoutContext): { height: number; bands: PlacedBand[] } {
  let byMeasure = subreportCache.get(structure);
  if (!byMeasure) subreportCache.set(structure, (byMeasure = new Map()));
  const cached = byMeasure.get(ctx.measure);
  if (cached) return cached;
  const content: ReportStructure = {
    ...structure,
    page: { ...structure.page, height: 1e9 },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    bands: structure.bands.filter((b) => b.kind !== 'PageHeader' && b.kind !== 'PageFooter' && b.kind !== 'TopMargin' && b.kind !== 'BottomMargin'),
  };
  const report = paginate(content, 1, { measure: ctx.measure, maxPages: 1 });
  const placed = report.pages[0]?.bands ?? [];
  const top = placed.length ? Math.min(...placed.map((b) => b.top)) : 0;
  const bottom = placed.length ? Math.max(...placed.map((b) => b.top + b.height)) : 0;
  const result = { height: bottom - top, bands: placed.map((b) => ({ ...b, top: b.top - top, left: 0 })) };
  byMeasure.set(ctx.measure, result);
  return result;
}

/** A placed control reprinted in a new scope, its lines re-broken if its text changed. */
function retext(pc: PlacedControl, values: RecordValues | null, ctx: LayoutContext, scope: TextScope): PlacedControl {
  const texts = textsOf(pc.control, values, ctx, scope);
  let lines = pc.lines;
  if (lines && ctx.measure && texts.text !== pc.text) {
    const c = pc.control;
    lines = textHeight(texts.text ?? '', { family: c.fontFamily, size: c.fontSize, bold: c.bold, italic: c.italic },
      c.width, c.appearance, c.borders, c.wordWrap, ctx).lines;
  }
  return { ...pc, ...texts, lines };
}

/**
 * Cut a band instance at `avail` units down, for a page break.
 *
 * Returns the part that stays and the part that continues. Measured on a
 * record DevExpress split across pages 2 and 3: the lines of a growing label
 * that fit stayed, the rest continued at the top of the next page, and every
 * control below it followed at its original distance from where that
 * continuation ENDED -- so the label below landed at 71.5 and the record's
 * remainder was 46.5 tall, both of which this reproduces exactly.
 *
 * Text splits between lines, a table between rows; anything else that crosses
 * the cut moves whole.
 *
 * DevExpress cuts at the foot even when nothing prints above it (parity row
 * 40, s29s3 and s29s5): a label at 35 with 20 units left continued 15 units
 * into the next page, not 35, and one straddling the foot below a gap
 * continued at the page's top. So the first part is null only when nothing
 * fits, and the second is then what continues, the space above the cut left
 * behind. With no room at all the instance itself continues.
 */
export function splitInstance(inst: BandInstance, avail: number, unit: string, spanned = false): [BandInstance | null, BandInstance | null] {
  if (avail <= EPS) return [null, inst];
  const perInch = unitsPerInch(unit);
  const toUnits = (pt: number) => (pt / 72) * perInch;
  const first: PlacedControl[] = [];
  const crossing: { origBottom: number; origY: number; part: PlacedControl }[] = [];
  const below: PlacedControl[] = [];
  // Whether a control's box was cut while its text stayed, which is what
  // carries the band's own remainder over (c05, s29s4). A cross-band line
  // running through the band across the cut counts as one: printed in s34c,
  // the blank remainder carried where without the line it did not (s34d).
  let boxCut = spanned;

  for (const pc of inst.controls) {
    const bottom = pc.y + pc.height;
    if (bottom <= avail + EPS) { first.push(pc); continue; }
    if (pc.y >= avail - EPS) { below.push(pc); continue; }

    const c = pc.control;
    if (MEASURED_TYPES.has(c.type)) {
      const inset = insetsPt(c.appearance, c.borders);
      const spacing = toUnits(lineSpacingPt(c.fontFamily ?? 'Times New Roman', c.fontSize ?? 9.75));
      const fit = Math.floor((avail - pc.y - toUnits(inset.top)) / spacing + EPS);
      // Unmeasured text is taken as one line.
      const lineCount = pc.lines ? pc.lines.length : pc.text ? 1 : 0;
      // An empty label has no line to keep, so it goes with its record: c02's
      // record 12, with empty notes, moved to page 2 whole.
      if (lineCount >= 1 && fit >= lineCount) {
        /*
         * Every line fits above the cut, so the label stays on this page and
         * only its box is cut -- even a one-line label whose box crosses into
         * the page footer. Printed in c05 and c05d: records C0052 and C0088
         * ended 1 and 5 units past the footer's top and printed there anyway,
         * and the rest of their band carried over and pushed the next page's
         * first record down by 3 and 7 units. A label whose line does NOT fit
         * moved whole (s20). Until 2026-10-30 such a label always moved.
         */
        first.push({ ...pc, height: avail - pc.y });
        boxCut = true;
        continue;
      }
      if (pc.lines && fit >= 1) {
        const rest = pc.lines.slice(fit);
        first.push({ ...pc, height: avail - pc.y, lines: pc.lines.slice(0, fit) });
        crossing.push({
          origBottom: bottom,
          origY: pc.y,
          part: { ...pc, y: 0, lines: rest, height: rest.length * spacing + toUnits(GROW_EXTRA_PT + inset.top + inset.bottom) },
        });
        continue;
      }
    }
    if (pc.rowHeights && pc.rowHeights.length > 1) {
      let used = 0;
      let k = 0;
      while (k < pc.rowHeights.length && pc.y + used + pc.rowHeights[k] <= avail + EPS) used += pc.rowHeights[k++];
      if (k >= 1) {
        const rest = pc.rowHeights.slice(k);
        first.push({ ...pc, height: used, rowHeights: pc.rowHeights.slice(0, k) });
        crossing.push({
          origBottom: bottom,
          origY: pc.y,
          part: { ...pc, y: 0, rowStart: pc.rowStart + k, rowHeights: rest, height: rest.reduce((s, h) => s + h, 0) },
        });
        continue;
      }
    }
    // Cannot split: the whole control continues at the top of the next part.
    crossing.push({ origBottom: bottom, origY: pc.y, part: { ...pc, y: 0 } });
  }

  // Everything below the cut follows the continuation that was above it.
  const rest: PlacedControl[] = crossing.map((x) => x.part);
  for (const pc of below) {
    let delta = 0;
    for (const x of crossing) {
      if (x.origBottom <= pc.y + EPS) delta = Math.max(delta, x.part.height - (x.origBottom - avail));
    }
    rest.push({ ...pc, y: pc.y - avail + delta });
  }

  const contentBottom = Math.max(0, ...inst.controls.map((pc) => pc.y + pc.height));
  const gap = Math.max(0, inst.height - contentBottom);
  /*
   * With nothing left to print, the band's own remainder carries over only when
   * a control's box was cut: printed, it pushed the next page's first record
   * down by exactly that much (c05, s29s4). When every control ended above the
   * foot the blank remainder was dropped, and the next page began straight
   * under its header (s29s1, s29m).
   */
  const restHeight = rest.length ? Math.max(...rest.map((pc) => pc.y + pc.height)) + gap : boxCut ? Math.max(0, inst.height - avail) : 0;
  const continues = restHeight > EPS ? { band: inst.band, record: inst.record, scope: inst.scope, height: restHeight, controls: rest } : null;
  if (!first.length) return [null, continues ?? inst];
  return [{ band: inst.band, record: inst.record, scope: inst.scope, height: avail, controls: first }, continues];
}

// --------------------------------------------------------------- pagination

export interface PlacedBand {
  band: PreviewBand;
  /**
   * How tall this placement prints: the band's designed height, or more when
   * its text grew, or a part of it when a page break split it.
   */
  height: number;
  /** The controls as they print in this placement. See `PlacedControl`. */
  controls: PlacedControl[];
  /** Page-relative top edge, in report units. */
  top: number;
  /**
   * Page-relative left edge, in report units.
   *
   * The left margin for everything except a record in the second or later
   * column of a multi-column Detail band. Headers and footers always span the
   * printable width — DevExpress divides only the detail flow, not the page.
   */
  left: number;
  /**
   * How wide this band prints, in report units.
   *
   * The printable width -- the page less both side margins -- except inside a
   * multi-column Detail band, where it is one column. The renderer needs it
   * because a column's controls are laid out against the column's width.
   */
  width: number;
  /** 1-based record number for a repeated Detail band; null for everything else. */
  record: number | null;
  /** As on `BandInstance`. */
  scope?: TextScope | null;
}

export interface PreviewPage {
  /** 1-based, as a reader counts pages. */
  number: number;
  bands: PlacedBand[];
  /** The cross-band lines and boxes on this page, once the pages exist (parity row 48). */
  crossBands?: CrossBandSegment[];
}

export interface PaginatedReport {
  pages: PreviewPage[];
  page: { width: number; height: number };
  /**
   * The printable area across the page: from the left margin, the page less
   * both side margins. The renderer clips each band at its right edge, because
   * DevExpress clips a control there (and prints the rest on an extra page).
   */
  content: { left: number; width: number };
  unit: string;
  /** Records actually laid out. */
  records: number;
  /** Detail rows that fit on one page; 0 when there is no Detail band. */
  recordsPerPage: number;
  problems: string[];
}

const findBand = (bands: PreviewBand[], kind: BandKind) => bands.find((b) => b.kind === kind);

/** How `paginate` is asked to lay a report out; every field is optional. */
export interface PaginateOptions {
  maxPages?: number;
  /** Measures text so controls grow and bands split as DevExpress prints them. */
  measure?: MeasureText | null;
  /**
   * Test data: record n prints row (n - 1) modulo the count. An empty array is
   * an empty data source, which prints differently from no data at all.
   */
  rows?: RecordValues[] | null;
  /** Parameter values the reader entered, by name; each wins over the file's default. */
  parameters?: Readonly<Record<string, string>>;
  /**
   * A detail report's rows for one master record: given its `DataMember` (a
   * relation path) and the master's row. Absent, every master has none.
   */
  related?: (dataMember: string, master: RecordValues) => RecordValues[] | null;
}

/**
 * Lay the report out across pages, printing the Detail band once per record.
 *
 * This is the whole point of the module, so the rules are worth stating rather
 * than leaving in the arithmetic:
 *
 * - TopMargin and BottomMargin are page furniture. Their heights reserve space,
 *   and their controls print on every page at the page's top edge and in the
 *   band ending at its foot, never in the flow of content (parity row 38).
 * - ReportHeader prints once, at the top of page 1 only.
 * - PageHeader repeats below the top margin of EVERY page.
 * - Detail repeats once per record and flows onto as many pages as it needs.
 * - GroupHeader prints once before the records, GroupFooter once after, and
 *   EVERY such band is placed rather than the first — nested groups are
 *   several of each. This preview knows nothing about the data, so it cannot
 *   know how many groups there are: what it draws is one group, which is an
 *   honest picture of the band structure and not of the record breaks. The
 *   band count and their order are what it is being asked about.
 * - ReportFooter prints once after the last record, moving to a new page if it
 *   does not fit.
 * - PageFooter sits ON the bottom margin of every page, not after the content.
 *
 * A Detail band taller than the usable area is the interesting failure: it can
 * never fit, so it would paginate forever. One record is placed per page and
 * `problems` says so, which is exactly the diagnosis a page-height Detail band
 * deserves.
 */
export function paginate(
  structure: ReportStructure,
  recordCount: number,
  options: PaginateOptions = {},
): PaginatedReport {
  /*
   * No cap unless a caller asks for one (parity row 16). The Preview stopped at
   * 50 pages until 2026-10-30, so c09's 10,000 records showed 50 of DevExpress's
   * 213 pages. Laying all 213 out takes about a quarter of a second with the
   * test data evaluated, and the pane draws only the pages near the viewport.
   */
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
  const problems = [...structure.problems];
  const bands = structure.bands;

  /*
   * Group nesting, as DevExpress decides it -- by `Level`, not by file order.
   * Measured in case s19: the higher level is the outer group; between equal
   * levels, and a missing `Level` is 0, the band LATER in the file is the outer
   * one; and a group footer closes the group whose header declares its level,
   * ties paired in file order. Until 2026-10-30 this took the file order as
   * outer-first, which nests a file with no `Level` the wrong way round.
   */
  const outerFirstOf = (list: readonly PreviewBand[], kind: BandKind) =>
    list
      .map((band, index) => ({ band, index }))
      .filter((x) => x.band.kind === kind)
      .sort((x, y) => y.band.level - x.band.level || y.index - x.index)
      .map((x) => x.band);
  /** Each header's footer, by declared level; and the footers no header claims. */
  const pairFooters = (list: readonly PreviewBand[], headers: readonly PreviewBand[]) => {
    const footers = new Map<PreviewBand, PreviewBand>();
    const left = outerFirstOf(list, 'GroupFooter').reverse();
    for (const header of [...headers].reverse()) {
      const i = left.findIndex((f) => f.level === header.level);
      if (i >= 0) footers.set(header, left.splice(i, 1)[0]);
    }
    return { footers, left };
  };
  const groupHeaders = outerFirstOf(bands, 'GroupHeader');
  const { footers: footerOf, left: unpaired } = pairFooters(bands, groupHeaders);
  /** Footers innermost first, as they print after the records; an unpaired one prints last. */
  const groupFooters = [
    ...[...groupHeaders].reverse().flatMap((h) => (footerOf.has(h) ? [footerOf.get(h)!] : [])),
    ...unpaired,
  ];

  // The test data, typed, with calculated fields and parameter defaults: what
  // a binding, a summary and a format string are evaluated against. Then put
  // in print order: sorted by every group's fields, outermost first, then by
  // Detail's SortFields -- printed, groups came out in ascending order whatever
  // order the rows arrived in, and a descending sort within them held.
  let data = options.rows
    ? ReportData.from(options.rows, recordCount, structure.calculatedFields, structure.parameters, options.parameters)
    : null;
  /*
   * The report's FilterString keeps only the records it is true for, with the
   * parameter values the reader entered (parity row 11). Printed in c07:
   * `[Region] = ?Region` with South supplied over a North default printed the
   * 37 South records of 90, and the header bound to the parameter said South.
   * Without test data there is nothing to filter, so the layout's count stands.
   */
  if (data && structure.filterString) {
    const kept = data.filtered(structure.filterString);
    if (kept) data = kept;
    else problems.push(`The report's filter "${structure.filterString}" could not be read, so the preview shows every record.`);
  }
  let order: number[] | null = null;
  if (data) {
    order = sortedOrder(data.records, [
      ...groupHeaders.flatMap((h) => h.fields),
      ...(findBand(bands, 'Detail')?.fields ?? []),
    ]);
    data = data.reordered(order);
    // No Detail band: every total prints "?" (parity row 39, s29n1 to s29n4).
    if (!findBand(bands, 'Detail')) data = data.withoutDetail();
  }
  /** Records to lay out: the data's own count when there is test data, none included. */
  const records = data ? data.records.length : recordCount;
  const ctx: LayoutContext = {
    measure: options.measure ?? null,
    unit: structure.unit,
    data,
    rules: structure.rules,
    source: options.rows
      ? ReportData.from(options.rows, options.rows.length, structure.calculatedFields, structure.parameters, options.parameters).records
      : null,
    contentWidth: structure.page.width - structure.margins.left - structure.margins.right,
  };
  const rowFor = (i: number) =>
    options.rows?.length ? options.rows[(order ? order[i] : i) % options.rows.length] : null;

  /*
   * The records each printed band reads; see `TextScope` for what DevExpress
   * printed. Record indices are 0-based, in print order. Each group level
   * breaks the records into runs sharing that level's fields and every outer
   * level's; without test data there is nothing to break on, so each level is
   * one run around every record -- the band structure, not the data. With no
   * group bands at all, `Group` prints "?" in Detail too: measured in case s17b.
   */
  const positions: number[] = Array.from({ length: records }, (_, i) => i);
  const all: number[] = data ? positions : [];
  const firstRecord = all.length ? 0 : null;
  const lastRecord = all.length ? all.length - 1 : null;
  const grouped = groupHeaders.length > 0 || groupFooters.length > 0;
  const levelRuns: number[][][] = groupHeaders.map((_, k) =>
    data
      ? groupRuns(data.records, groupHeaders.slice(0, k + 1).flatMap((h) => h.fields.map((f) => f.field)))
      : [positions],
  );
  /** The innermost group each record is in, for a Detail band's `Group` summaries. */
  const innermost: (readonly number[])[] = [];
  for (const run of levelRuns[levelRuns.length - 1] ?? []) for (const i of run) innermost[i] = run;
  const scopeFor = (
    kind: BandKind,
    record: number | null,
    page: readonly number[] | null,
    before: number | null,
    run: readonly number[] | null = null,
  ): TextScope => {
    const base = { report: all, group: null as readonly number[] | null, page };
    const pageFirst = page ? page[0] ?? before : firstRecord;
    const pageLast = page ? page[page.length - 1] ?? before : lastRecord;
    const group = run && data ? run : grouped ? all : null;
    const runFirst = group?.length ? group[0] : null;
    const runLast = group?.length ? group[group.length - 1] : null;
    switch (kind) {
      case 'Detail': {
        const i = record === null ? null : record - 1;
        const own = i !== null && data && innermost[i] ? innermost[i] : grouped ? all : null;
        return { ...base, group: own, row: i, anchor: i };
      }
      case 'GroupHeader': return { ...base, group, row: runFirst, anchor: runLast };
      case 'GroupFooter': return { ...base, group, row: runLast, anchor: runLast };
      case 'ReportHeader': return { ...base, row: firstRecord, anchor: lastRecord };
      case 'ReportFooter': return { ...base, row: lastRecord, anchor: lastRecord };
      case 'PageHeader': case 'TopMargin': return { ...base, row: pageFirst, anchor: pageLast };
      default: return { ...base, row: pageLast, anchor: pageLast };
    }
  };
  const instance = (
    band: PreviewBand,
    record: number | null = null,
    values: RecordValues | null = null,
    run: readonly number[] | null = null,
  ) => layoutBand(band, record, values, ctx, scopeFor(band.kind, record, null, null, run));

  const topMargin = Math.max(structure.margins.top, findBand(bands, 'TopMargin')?.height ?? 0);
  const bottomMargin = Math.max(structure.margins.bottom, findBand(bands, 'BottomMargin')?.height ?? 0);

  const reportHeader = findBand(bands, 'ReportHeader');
  const pageHeader = findBand(bands, 'PageHeader');
  const detail = findBand(bands, 'Detail');
  const reportFooter = findBand(bands, 'ReportFooter');
  const pageFooter = findBand(bands, 'PageFooter');

  /*
   * Every group band, not the first: `groupHeaders` and `groupFooters` above.
   * DevExpress nests groups by emitting several GroupHeaderBands -- region,
   * then category within it -- and taking only `find`'s first match once drew
   * the outer group and silently dropped the inner one, which is precisely the
   * "looks right, is missing content" failure this preview exists to expose.
   */

  // The page furniture prints the same on every page, so it is laid out once.
  const reportHeaderInst = reportHeader ? instance(reportHeader) : null;
  const pageHeaderInst = pageHeader ? instance(pageHeader) : null;
  const pageFooterInst = pageFooter ? instance(pageFooter) : null;
  /*
   * The margin bands print their controls on every page (parity row 38, s29m):
   * the top one from the page's top edge, the bottom one in the band that ends
   * at the page's foot, page numbers included. Neither grows, and neither moves
   * the content: a label past the top one's bottom printed over the content,
   * and one past the bottom one's fell off the page (s29a). One with no
   * controls places nothing.
   */
  const marginInst = (kind: BandKind) => {
    const band = findBand(bands, kind);
    return band && band.controls.length ? { ...instance(band), height: band.height } : null;
  };
  const topMarginInst = marginInst('TopMargin');
  const bottomMarginInst = marginInst('BottomMargin');

  /** Where the page footer ends: the top of the bottom margin. */
  const footerBottom = structure.page.height - bottomMargin;
  /** Where content must stop on the CURRENT page: above its page footer, if it has one. */
  let pageBottom = footerBottom - (pageFooterInst?.height ?? 0);
  /** The same on an ordinary page, for the records-per-page readout. */
  const ordinaryPageBottom = pageBottom;
  /** `PrintOn` carries a flag, alone or as part of a comma-separated pair. */
  const skips = (band: PreviewBand | undefined, flag: string) => !!band && band.printOn.split(',').some((f) => f.trim() === flag);

  const pages: PreviewPage[] = [];
  let current: PreviewPage | null = null;
  let cursor = 0;
  /** Where content starts on the current page, below its headers. */
  let pageContentTop = 0;
  /**
   * The group headers whose groups are open, outermost first. A new page
   * reprints those marked `RepeatEveryPage` below its page header: printed, the
   * South and West headers reappeared at the top of the pages their groups ran
   * onto.
   */
  const openGroups: BandInstance[] = [];
  /** A band asked for a page break after itself; the next thing placed starts a new page. */
  let breakPending = false;

  /*
   * Where band content goes across the page: from the left margin, as wide as
   * the page less both side margins. Every band gets that unless it is in a
   * column. Until 2026-10-30 this was 0 and the full page width, which drew
   * every control left of where DevExpress prints it by the left margin.
   */
  const contentLeft = structure.margins.left;
  const fullWidth = Math.max(0, structure.page.width - structure.margins.left - structure.margins.right);

  /*
   * A control past the printable width. DevExpress clips it at the right margin
   * and prints what was clipped on an EXTRA page -- measured both for a control
   * that only reached into the margin and for one past the page edge; each
   * turned a one-page report into two. This pane clips at the margin too (see
   * `content` below) but does not draw the extra page, so it says so.
   */
  const overhanging = bands
    .flatMap((b) => b.controls)
    .filter((c) => c.visible && c.width > 0 && c.x + c.offsetX + c.width > fullWidth + 1);
  if (overhanging.length) {
    problems.push(
      `${overhanging.length} control(s) run past the right margin (${overhanging.slice(0, 3).map((c) => c.name || c.type).join(', ')}). ` +
        'DevExpress clips them at the margin and prints the clipped part on an extra page, which this preview does not draw.',
    );
  }

  /*
   * `withReportHeader` is only true for page 1, and the ordering it produces is
   * the whole reason this takes an argument.
   *
   * DevExpress prints the ReportHeader ABOVE the PageHeader on the first page --
   * its "Print Order of Bands" lists ReportHeader, PageHeader, GroupHeader,
   * Detail, and the designer stacks them the same way. `BAND_ORDER` in this file
   * has always said so too.
   *
   * The pagination did not. `startPage` placed the PageHeader at the top of
   * every page including the first, and the ReportHeader was pushed after it, so
   * page 1 came out PageHeader-then-ReportHeader -- column headings above the
   * report title. It rendered plausibly, contradicted this module's own
   * BAND_ORDER, and no test looked: the suite asserted that the ReportHeader is
   * on page 1 and how much height it consumes, both of which are order-blind.
   * Found on 2026-09-06 by looking at the Preview pane rather than at the code.
   */
  /** A placement at the full printable width, from an instance. A page break prints nothing of its own. */
  const at = (inst: BandInstance, top: number): PlacedBand => ({
    band: inst.band, height: inst.height, controls: inst.controls.filter((pc) => pc.control.type !== 'XRPageBreak'),
    top, left: contentLeft, width: fullWidth, record: inst.record, scope: inst.scope,
  });
  /**
   * Where an instance's first `XRPageBreak` sits, or null (parity row 47). On
   * one continuous page, as the exports and an embedded report lay out, a
   * break does nothing.
   */
  const firstBreak = (inst: BandInstance): number | null => {
    if (maxPages <= 1) return null;
    const ys = inst.controls.filter((pc) => pc.control.type === 'XRPageBreak').map((pc) => pc.y);
    return ys.length ? Math.min(...ys) : null;
  };
  /** The report header's part below its first page break, placed once page 2 is open. */
  let headerAfterBreak: BandInstance | null = null;
  /*
   * The cross-band controls open at the point of placing (parity row 48). One
   * runs through every band between its start and its end, and where it runs
   * across a page's foot the band's remainder carries over as for a control
   * crossing it (s34c against s34d).
   */
  const crossBands = structure.crossBands ?? [];
  const crossBand = (ref: string) => bands.find((b) => b.ref === ref);
  const crossOpen = new Set<CrossBandControl>();
  const spans = (inst: BandInstance, avail: number) => crossBands.some((cb) => {
    const [start, end] = [crossBand(cb.startRef), crossBand(cb.endRef)];
    if (inst.band === start && inst.band === end) return cb.startY < avail && cb.endY > avail;
    if (inst.band === start) return crossOpen.has(cb) || cb.startY < avail;
    if (inst.band === end) return crossOpen.has(cb) && cb.endY > avail;
    return crossOpen.has(cb);
  });
  const track = (inst: BandInstance) => {
    for (const cb of crossBands) {
      const [start, end] = [crossBand(cb.startRef), crossBand(cb.endRef)];
      if (inst.band === end) crossOpen.delete(cb);
      else if (inst.band === start) crossOpen.add(cb);
    }
  };

  const startPage = (withReportHeader = false) => {
    current = { number: pages.length + 1, bands: [] };
    pages.push(current);
    if (topMarginInst) current.bands.push(at(topMarginInst, 0));
    if (bottomMarginInst) current.bands.push(at(bottomMarginInst, structure.page.height - bottomMargin));
    cursor = topMargin;
    // The page that carries the report header -- page 1, when there is one.
    const headerPage = withReportHeader && !!reportHeaderInst;
    if (headerPage) {
      // Only the part above a page break prints here; the rest opens page 2.
      const breakAt = firstBreak(reportHeaderInst!);
      const [above, below] = breakAt === null ? [reportHeaderInst!, null] : breakAt > EPS ? splitInstance(reportHeaderInst!, breakAt, ctx.unit) : [null, reportHeaderInst!];
      if (above) {
        current.bands.push(at(above, cursor));
        cursor += above.height;
      }
      headerAfterBreak = breakAt === null ? null : below;
    }
    // PrintOn: printed, a page header marked NotWithReportHeader was absent
    // from page 1, which then held 27 records where it had held 26.
    if (pageHeaderInst && !(headerPage && skips(pageHeader, 'NotWithReportHeader'))) {
      current.bands.push(at(pageHeaderInst, cursor));
      cursor += pageHeaderInst.height;
    }
    const footerHere = !!pageFooterInst && !(headerPage && skips(pageFooter, 'NotWithReportHeader'));
    if (footerHere) current.bands.push(at(pageFooterInst!, footerBottom - pageFooterInst!.height));
    pageBottom = footerBottom - (footerHere ? pageFooterInst!.height : 0);
    for (const header of openGroups) {
      if (!header.band.repeatEveryPage) continue;
      current.bands.push(at(header, cursor));
      cursor += header.height;
    }
    pageContentTop = cursor;
  };

  /**
   * Place one band instance, splitting it across a page break when it does not
   * fit -- DevExpress's default, measured -- or moving it whole to the next page
   * when the band says `KeepTogether="true"` and it fits on a page at all.
   * Without a measurer every height is the designed one, so a band that does
   * not fit still moves to the next page whole unless its controls are
   * separately placeable, which is DevExpress's behaviour too.
   */
  const flow = (inst: BandInstance) => {
    if (!current) startPage();
    let part: BandInstance | null = inst;
    for (let guard = 0; part && guard < 10_000; guard++) {
      const avail = pageBottom - cursor;
      const atTop = cursor <= pageContentTop + EPS;
      // Put the part here as it is: it fits, or nothing better is possible.
      const put = () => {
        current!.bands.push(at(part!, cursor));
        cursor += part!.height;
        track(part!);
      };
      if (part.height <= avail + EPS) return put();
      if (pages.length >= maxPages && !atTop) return put();
      if (part.band.keepTogether && part.height <= pageBottom - pageContentTop + EPS && !atTop) {
        startPage();
        continue;
      }
      const [first, rest]: [BandInstance | null, BandInstance | null] = splitInstance(part, avail, ctx.unit, spans(part, avail));
      if (!first) {
        if (atTop) return put();
        // Nothing prints here; what continues starts the next page, the space
        // above the cut left behind as DevExpress leaves it (s29s3, s29s5).
        startPage();
        part = rest;
        continue;
      }
      current!.bands.push(at(first, cursor));
      cursor += first.height;
      track(first);
      if (!rest || pages.length >= maxPages) return;
      startPage();
      part = rest;
    }
  };

  /**
   * `flow`, breaking the page at each `XRPageBreak` the instance holds (parity
   * row 47). Printed in s31c: the band was cut where the break sat, as at a
   * page's foot, and what was below continued at the top of the next page at
   * its own gap below the break, the next band after it.
   */
  const place = (inst: BandInstance) => {
    let part: BandInstance | null = inst;
    for (let breakAt = firstBreak(part); part && breakAt !== null; breakAt = part ? firstBreak(part) : null) {
      const [above, below]: [BandInstance | null, BandInstance | null] = breakAt > EPS ? splitInstance(part, breakAt, ctx.unit) : [null, part];
      if (above) flow(above);
      if (!current || cursor > pageContentTop + EPS) startPage();
      // A break at the very top cuts nothing; drop it so it is not met again.
      part = above ? below : below && { ...below, controls: below.controls.filter((pc) => !(pc.control.type === 'XRPageBreak' && pc.y === breakAt)) };
    }
    if (part) flow(part);
  };

  startPage(true);
  if (headerAfterBreak) {
    const rest: BandInstance = headerAfterBreak;
    headerAfterBreak = null;
    startPage();
    place(rest);
  }

  let placedRecords = 0;
  if (detail && records > 0) {
    const usable = ordinaryPageBottom - topMargin - (pageHeader ? heldHeight(pageHeader) : 0);
    const tall = heldHeight(detail);
    if (tall > usable) {
      problems.push(
        `The Detail band is ${Math.round(tall)} units tall and only ${Math.round(usable)} fit on a page, ` +
          'so every record starts a new sheet. A Detail band near the height of the page usually means the whole ' +
          'design went into one band instead of being split across ReportHeader, PageHeader and Detail.',
      );
    }
  }
  // Only the columns DevExpress prints: a declared count with no Mode is one.
  const columns = detail && records > 0 ? activeColumns(detail.columns, fullWidth) : null;

  if (!columns) {
    /*
     * Groups from the data (parity row 10), as one sequence of band instances
     * laid out first and placed second, because two rules need to look ahead:
     *
     * - `GroupUnion="WholePage"` moved a group that did not fit in the room
     *   left to the next page whole -- c05b printed one group per page -- and
     *   `WithFirstDetail` moved a header that fitted at the foot of a page with
     *   its first record when that record did not (c05e). By default the
     *   header stays there alone (c05d). A group too tall for any page is not
     *   moved, which was not measured.
     * - `PageBreak="AfterBand"` on a group footer started a new page after
     *   every group, the last included, so the grand total printed alone (c05c).
     *
     * Each level's header prints when its run starts and its footer when it
     * ends, so nested groups open outermost first and close innermost first.
     */
    type Step = { inst: BandInstance | null; role: 'header' | 'detail' | 'footer' | 'end' | 'sub'; level: number; first: boolean; last: boolean };
    const steps: Step[] = [];

    /*
     * A detail report after a master record (parity row 14): its report header,
     * its groups and one Detail per related row, its report footer -- each band
     * reading that master's related rows, so a `Running="Report"` total inside
     * it is the master's own, as c06 printed. The rows come from
     * `options.related`; with none, the master has no related rows, which
     * DevExpress prints as the header, ONE blank Detail and a blank total. The
     * Preview's test data is flat, so that is what it shows, and says why.
     */
    const detailReports = bands.filter((b) => b.kind === 'DetailReport' && b.sub);
    const subSteps = (masterIndex: number | null): Step[] => {
      const out: Step[] = [];
      for (const report of detailReports) {
        const sub = report.sub!;
        const master = masterIndex === null ? null : rowFor(masterIndex);
        const rows = data && master && options.related ? options.related(sub.dataMember ?? '', master) ?? [] : [];
        const subHeaders = outerFirstOf(sub.bands, 'GroupHeader');
        const { footers: subFooters, left: subUnpaired } = pairFooters(sub.bands, subHeaders);
        const subDetail = sub.bands.find((b) => b.kind === 'Detail') ?? null;
        let subData = data ? ReportData.from(rows, rows.length, [], structure.parameters, options.parameters) : null;
        if (subData && sub.filterString) subData = subData.filtered(sub.filterString) ?? subData;
        if (subData) {
          subData = subData.reordered(sortedOrder(subData.records, [...subHeaders.flatMap((h) => h.fields), ...(subDetail?.fields ?? [])]));
        }
        // Without test data, one line: the structure, as the master shows it.
        const count = subData ? subData.records.length : 1;
        const all = subData ? Array.from({ length: count }, (_, i) => i) : [];
        const runs = subHeaders.map((_, k) =>
          subData ? groupRuns(subData.records, subHeaders.slice(0, k + 1).flatMap((h) => h.fields.map((f) => f.field))) : [Array.from({ length: count }, (_, i) => i)],
        );
        const subCtx: LayoutContext = { ...ctx, data: subData };
        const last = all.length ? all.length - 1 : null;
        const lay = (band: PreviewBand, row: number | null, anchor: number | null, group: readonly number[] | null) =>
          layoutBand(band, null, null, subCtx, { row, anchor, report: all, group, page: null });
        const push = (inst: BandInstance) => out.push({ inst, role: 'sub', level: -1, first: true, last: true });
        const runAt = runs.map(() => 0);
        const open = (k: number) => {
          const run = runs[k][runAt[k]] ?? [];
          push(lay(subHeaders[k], run.length ? run[0] : null, run.length ? run[run.length - 1] : null, run));
        };
        const close = (k: number) => {
          const run = runs[k][runAt[k]] ?? [];
          const footer = subFooters.get(subHeaders[k]);
          if (footer) push(lay(footer, run.length ? run[run.length - 1] : null, run.length ? run[run.length - 1] : null, run));
          runAt[k]++;
        };
        for (const band of sub.bands.filter((b) => b.kind === 'ReportHeader')) push(lay(band, all.length ? 0 : null, last, null));
        if (count > 0) {
          for (let i = 0; i < count; i++) {
            for (let k = 0; k < subHeaders.length; k++) if (runs[k][runAt[k]]?.[0] === i) open(k);
            const inner = runs.length ? runs[runs.length - 1].find((r) => r.includes(i)) ?? null : null;
            if (subDetail) push(lay(subDetail, subData ? i : null, subData ? i : null, inner));
            for (let k = subHeaders.length - 1; k >= 0; k--) {
              const run = runs[k][runAt[k]];
              if (run && run[run.length - 1] === i) close(k);
            }
          }
        } else {
          for (let k = 0; k < subHeaders.length; k++) open(k);
          if (subDetail) push(lay(subDetail, null, null, null));
          for (let k = subHeaders.length - 1; k >= 0; k--) close(k);
        }
        for (const footer of subUnpaired) push(lay(footer, last, last, all));
        for (const band of sub.bands.filter((b) => b.kind === 'ReportFooter')) push(lay(band, last, last, null));
      }
      return out;
    };
    if (!detail && detailReports.length) {
      // Printed (s29n5, c06 without its Detail band): DevExpress threw rather than
      // create the document, so there is no printed report to picture.
      problems.push(
        `DevExpress will not print this report: it has the detail report ${detailReports.map((b) => `"${b.name}"`).join(', ')} ` +
          'and no Detail band of its own, and refuses to create the document. Add a Detail band, even an empty one.',
      );
    } else if (data && detailReports.length && !options.related) {
      problems.push(
        `The detail report ${detailReports.map((b) => `"${b.name}"`).join(', ')} reads ${detailReports.map((b) => b.sub!.dataMember ?? 'its own data').join(', ')}, ` +
          'which the test data does not carry, so each record prints it as DevExpress prints a record with no related rows.',
      );
    }
    const runAt = levelRuns.map(() => 0);
    const openStep = (k: number) => {
      const runs = levelRuns[k];
      const run = runs[runAt[k]] ?? [];
      steps.push({ inst: instance(groupHeaders[k], null, run.length ? rowFor(run[0]) : null, run), role: 'header', level: k, first: runAt[k] === 0, last: runAt[k] === runs.length - 1 });
    };
    const closeStep = (k: number) => {
      const runs = levelRuns[k];
      const run = runs[runAt[k]] ?? [];
      const footer = footerOf.get(groupHeaders[k]);
      const meta = { level: k, first: runAt[k] === 0, last: runAt[k] === runs.length - 1 };
      steps.push(footer ? { inst: instance(footer, null, run.length ? rowFor(run[run.length - 1]) : null, run), role: 'footer', ...meta } : { inst: null, role: 'end', ...meta });
      runAt[k]++;
    };
    const unpairedSteps = () => {
      for (const footer of unpaired) steps.push({ inst: instance(footer), role: 'footer', level: -1, first: true, last: true });
    };
    if (!detail) {
      /*
       * No Detail band: DevExpress walks no records, so no group band and no
       * detail report prints, while the report and page bands do (parity row
       * 39). Printed in s29n1 over three names, a group header and footer by
       * name printed nothing, where a Detail band 0 tall printed three groups
       * (s29n3). Totals print "?", which `ReportData.withoutDetail` gives.
       */
    } else if (records > 0) {
      for (let i = 0; i < records; i++) {
        for (let k = 0; k < groupHeaders.length; k++) if (levelRuns[k][runAt[k]]?.[0] === i) openStep(k);
        if (detail) steps.push({ inst: instance(detail, i + 1, rowFor(i)), role: 'detail', level: groupHeaders.length, first: i === 0, last: i === records - 1 });
        steps.push(...subSteps(i));
        for (let k = groupHeaders.length - 1; k >= 0; k--) {
          const run = levelRuns[k][runAt[k]];
          if (run && run[run.length - 1] === i) closeStep(k);
        }
      }
    } else {
      /*
       * No records: every group band once, and the Detail band once, around
       * nothing (parity row 13). Printed over an empty data source (c04e,
       * s21): one page, every header and footer, the Detail band once with
       * its literal text and blank fields -- which shows the report's shape
       * where printing nothing would not.
       */
      for (let k = 0; k < groupHeaders.length; k++) openStep(k);
      if (detail) steps.push({ inst: instance(detail), role: 'detail', level: groupHeaders.length, first: true, last: true });
      steps.push(...subSteps(null));
      for (let k = groupHeaders.length - 1; k >= 0; k--) closeStep(k);
    }
    if (detail) unpairedSteps();

    const height = (from: number, to: number) => {
      let total = 0;
      for (let s = from; s <= to && s < steps.length; s++) total += steps[s].inst?.height ?? 0;
      return total;
    };
    /** The room a page has for content once its page header and repeated group headers are down. */
    const freshRoom = () =>
      ordinaryPageBottom - topMargin - (pageHeaderInst?.height ?? 0) -
      openGroups.reduce((sum, h) => sum + (h.band.repeatEveryPage ? h.height : 0), 0);
    const atContentTop = () => cursor <= pageContentTop + EPS;

    for (let s = 0; s < steps.length; s++) {
      const step = steps[s];
      if (step.role === 'end') {
        openGroups.length = Math.min(openGroups.length, step.level);
        continue;
      }
      const inst = step.inst!;
      const band = inst.band;
      if (pages.length >= maxPages && cursor + inst.height > pageBottom + EPS) break;
      const breaksBefore = band.pageBreak === 'BeforeBand' || (band.pageBreak === 'BeforeBandExceptFirstEntry' && !step.first);
      if ((breakPending || breaksBefore) && !atContentTop()) startPage();
      breakPending = false;
      if (step.role === 'header' && (band.groupUnion === 'WholePage' || band.groupUnion === 'WithFirstDetail')) {
        // The whole group runs to the step that closes this level; the header
        // with its first record runs to the first Detail after it.
        const closes = (t: Step) =>
          band.groupUnion === 'WholePage' ? (t.role === 'footer' || t.role === 'end') && t.level === step.level : t.role === 'detail';
        let end = s + 1;
        while (end < steps.length && !closes(steps[end])) end++;
        const need = height(s, end);
        if (need > pageBottom - cursor + EPS && need <= freshRoom() + EPS && !atContentTop()) startPage();
      }
      place(inst);
      // A detail report's lines are not master records.
      if (step.role === 'detail' && inst.record !== null) placedRecords++;
      if (step.role === 'header') openGroups.push(inst);
      if (step.role === 'footer' && step.level >= 0) openGroups.length = Math.min(openGroups.length, step.level);
      if (band.pageBreak === 'AfterBand' || (band.pageBreak === 'AfterBandExceptLastEntry' && !step.last)) breakPending = true;
    }
    openGroups.length = 0;
  } else if (detail) {
    for (const header of groupHeaders) place(instance(header));
    {
      /*
       * Multi-column flow.
       *
       * DevExpress divides the detail area into `count` columns and fills them
       * in one of two orders. `DownThenAcross` fills a column to the bottom
       * before starting the next; `AcrossThenDown` places one record in each
       * column and then moves down a row. Everything else on the page — the
       * headers, the footers, the group bands — still spans the full width,
       * because only the detail flow is divided.
       *
       * The whole block below is arithmetic on a grid of `rows x count` slots.
       * `cursor` is deliberately NOT used inside it: `place` advances a single
       * vertical cursor, which is the one thing that cannot describe two
       * records at the same height. It is set once at the end, to the bottom of
       * the last row used, so whatever comes after the detail flow — the group
       * footers, the report footer — lands below all of the columns rather than
       * inside them.
       */
      const columnWidth = columns.width;
      const downThenAcross = columns.layout === 'DownThenAcross';
      // A slot holds every control placed in the record, as a band does (row
      // 36); growth inside columns is not measured, so nothing else moves it.
      const slotHeight = heldHeight(detail);

      /*
       * Recomputed per page rather than once, because the first page is
       * shorter: it spends height on the ReportHeader and any group headers.
       * Computing the grid once from the first page's remaining height would
       * under-fill every page after it, which reads as a pagination bug in the
       * report rather than in this function.
       */
      let pageTop = cursor;
      let rowsPerPage = Math.max(1, Math.floor((pageBottom - pageTop) / slotHeight));
      let perPage = rowsPerPage * columns.count;
      let onPage = 0;
      let rowsUsed = 0;

      for (let i = 0; i < records; i++) {
        if (onPage === perPage) {
          if (pages.length >= maxPages) break;
          startPage();
          pageTop = cursor;
          rowsPerPage = Math.max(1, Math.floor((pageBottom - pageTop) / slotHeight));
          perPage = rowsPerPage * columns.count;
          onPage = 0;
          rowsUsed = 0;
        }

        // Which slot of the rows x count grid, in this layout's fill order.
        const row = downThenAcross ? onPage % rowsPerPage : Math.floor(onPage / columns.count);
        const column = downThenAcross ? Math.floor(onPage / rowsPerPage) : onPage % columns.count;

        // Columns keep the slot height: a grid of slots cannot hold records of
        // different heights, and growth inside columns is not measured yet.
        const slot = layoutBand(detail, i + 1, rowFor(i), { measure: null, unit: ctx.unit, data, rules: ctx.rules }, scopeFor('Detail', i + 1, null, null));
        current!.bands.push({
          band: detail,
          height: slotHeight,
          controls: slot.controls,
          top: pageTop + row * slotHeight,
          left: contentLeft + column * (columnWidth + columns.spacing),
          width: columnWidth,
          record: i + 1,
          scope: slot.scope,
        });
        onPage++;
        rowsUsed = Math.max(rowsUsed, row + 1);
        placedRecords++;
      }

      // Below every column, so a group or report footer does not land inside
      // the grid. `place` is not used above precisely because its single
      // vertical cursor cannot describe two records at the same height.
      cursor = pageTop + rowsUsed * slotHeight;
    }
    for (const footer of groupFooters) place(instance(footer));
  }

  if (reportFooter) {
    // A page break asked for after the last group: printed, the grand total
    // went to a page of its own (c05c).
    if (breakPending && cursor > pageContentTop + EPS) startPage();
    breakPending = false;
    const rf = instance(reportFooter);
    // A page footer marked NotWithReportFooter is not printed on the page the
    // report footer prints on, so that page has the footer's room as well.
    const dropsFooter = skips(pageFooter, 'NotWithReportFooter');
    const bottomFor = (page: PreviewPage) =>
      dropsFooter || !page.bands.some((b) => b.band === pageFooter) ? footerBottom : footerBottom - pageFooterInst!.height;
    if (reportFooter.printAtBottom && rf.height <= footerBottom - topMargin) {
      // PrintAtBottom: printed, at the foot of its page rather than straight
      // after the last record -- at 990 on a page whose footer it suppressed.
      if (!current) startPage();
      if (cursor + rf.height > bottomFor(current!) + EPS) startPage();
      const top = bottomFor(current!) - rf.height;
      current!.bands.push(at(rf, top));
      cursor = top + rf.height;
    } else {
      place(rf);
    }
    if (dropsFooter) {
      const rfPage = [...pages].reverse().find((p) => p.bands.some((b) => b.band === reportFooter));
      if (rfPage) rfPage.bands = rfPage.bands.filter((b) => b.band !== pageFooter);
    }
  }

  // Only a report with a Detail band places records; one without prints its
  // report bands once, which is not a page cap (parity row 39).
  if (detail && placedRecords < records) {
    problems.push(
      `Preview stopped at ${maxPages} pages; ${records - placedRecords} of ${records} records are not shown.`,
    );
  }

  /*
   * What reads the page is printed once the pages are known. A page summary
   * prints the whole page's total wherever it sits, the page header included,
   * and a page header or footer reads the page's first or last record; until
   * pagination ends neither is known, so those bands were laid out against the
   * whole report and are reprinted here. Their heights stay as laid out.
   *
   * A record split across a break counts on both pages, and every part of it
   * reads the page it FINISHES on: printed, the part of record 21 left on page
   * 1 showed page 2's total, and its part on page 2 numbered itself 1 there.
   */
  if (data) {
    const readsPage = (c: PreviewControl) =>
      c.data.running === 'Page' || c.rows.some((row) => row.cells.some((cell) => cell.data.running === 'Page'));
    // The page bands, the margin bands among them (row 38), read their page.
    const isPageBand = (kind: BandKind) => kind === 'PageHeader' || kind === 'PageFooter' || kind === 'TopMargin' || kind === 'BottomMargin';
    const sensitive = new Set(bands.filter((b) => isPageBand(b.kind) || b.controls.some(readsPage)));
    // An empty remainder carried over a break prints nothing, so it does not
    // put its record on that page -- not measured, since nothing it prints shows.
    const detailRecords = (page: PreviewPage) =>
      page.bands.filter((b) => b.band.kind === 'Detail' && b.record !== null && b.controls.length > 0).map((b) => b.record! - 1);
    // Every record with any part on the page, a split one on both of its pages.
    const onPage = pages.map((page) => [...new Set(detailRecords(page))].sort((a, b) => a - b));
    const finishesOn = new Map<number, number>();
    pages.forEach((page, k) => detailRecords(page).forEach((r) => finishesOn.set(r, k)));
    // The last record printed before each page, for a page that has none of its own.
    const before: (number | null)[] = [];
    pages.forEach((_, k) => {
      const prior = k ? onPage[k - 1] : [];
      before.push(prior.length ? prior[prior.length - 1] : k ? before[k - 1] : null);
    });
    pages.forEach((page, k) => {
      page.bands = page.bands.map((pb) => {
        if (!sensitive.has(pb.band)) return pb;
        const own = pb.band.kind === 'Detail' && pb.record !== null ? finishesOn.get(pb.record - 1) ?? k : k;
        // A page band reads the page's records; anything else keeps the
        // records it was laid out with -- its group -- and learns its page.
        const pageBand = isPageBand(pb.band.kind);
        const scope = pageBand || !pb.scope
          ? scopeFor(pb.band.kind, pb.record, onPage[own], before[own])
          : { ...pb.scope, page: onPage[own] };
        const values = pb.record !== null ? rowFor(pb.record - 1) : null;
        return { ...pb, controls: pb.controls.map((pc) => retext(pc, values, ctx, scope)) };
      });
    });
  }

  // A merged run prints once per page, so it is drawn once the pages exist.
  if (data) mergeRuns(pages);
  if (structure.crossBands) drawCrossBands(structure.crossBands, bands, pages, {
    top: topMargin, bottom: structure.page.height - bottomMargin, left: contentLeft,
  });

  // Reported for the UI's "N records per page" readout. Derived from the first
  // full page rather than from the arithmetic above, because the arithmetic
  // ignores the ReportHeader that shortens page 1.
  const recordsPerPage = detail && heldHeight(detail) > 0
    ? Math.max(1, Math.floor((ordinaryPageBottom - topMargin - (pageHeader ? heldHeight(pageHeader) : 0)) / heldHeight(detail)))
    : 0;

  return {
    pages,
    page: structure.page,
    content: { left: contentLeft, width: fullWidth },
    unit: structure.unit,
    records: placedRecords,
    recordsPerPage,
    problems,
  };
}

/**
 * How many records to preview, taken from what the model actually read.
 *
 * The layout's detail section carries every row it could see in the source
 * document while the Detail BAND carries one -- that divergence is deliberate
 * and stated in the prompt. It also means the row count is real data rather
 * than a number this module invented, so the preview repeats the band as many
 * times as the user's own document had rows. Synthetic test data can come
 * later; the honest count is already here.
 */
export function recordCountFromLayout(
  layout: { sections?: { type?: string; elements?: { type?: string; rows?: unknown[] }[] }[] } | null | undefined,
  fallback = 3,
): number {
  let best = 0;
  for (const section of layout?.sections ?? []) {
    if (section.type !== 'detail') continue;
    for (const element of section.elements ?? []) {
      if (element.type === 'table') best = Math.max(best, element.rows?.length ?? 0);
    }
  }
  // A table in the detail section normally still carries its heading row in the
  // layout, so one row is chrome rather than a record.
  return best > 1 ? best - 1 : fallback;
}
