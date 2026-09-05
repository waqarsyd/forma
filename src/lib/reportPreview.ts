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

/** The bands that carry content, in the order XtraReports prints them. */
export type BandKind =
  | 'TopMargin'
  | 'ReportHeader'
  | 'PageHeader'
  | 'GroupHeader'
  | 'Detail'
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
  'GroupFooter',
  'ReportFooter',
  'PageFooter',
  'BottomMargin',
];

/*
 * There is deliberately no MARGIN_BANDS list to filter against. TopMargin and
 * BottomMargin are page furniture, and `paginate` never places them because it
 * places bands by naming the ones it wants rather than by excluding the ones it
 * does not -- so a list of exclusions would be a second, silent way for a band
 * to be dropped. `reportPreview.test.ts` asserts neither appears as content.
 */

export interface PreviewCell {
  text: string;
  /** Relative width within the row. DevExpress distributes by weight, not px. */
  weight: number;
  bold: boolean;
  align: 'left' | 'center' | 'right';
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
  /** Points, as written in the file — font size is not in report units. */
  fontSize: number | null;
  fontFamily: string | null;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle' | 'bottom';
  borders: { top: boolean; right: boolean; bottom: boolean; left: boolean };
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
   * Where this control's opening tag sits in the source REPX: `openStart` is
   * the `<`, `openEnd` the matching `>`. Absolute offsets into the document
   * that was parsed, which is what lets an edit rewrite one attribute list and
   * leave every other byte alone. Meaningless against any other string.
   */
  openStart: number;
  openEnd: number;
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
  spacing: number;
  /** `AcrossThenDown` or `DownThenAcross`. */
  layout: string;
  /** `UseColumnCount` or `UseColumnWidth`. */
  mode: string;
}

export interface PreviewBand {
  kind: BandKind;
  name: string;
  height: number;
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
}

export interface ReportStructure {
  page: { width: number; height: number };
  margins: { top: number; bottom: number };
  unit: string;
  bands: PreviewBand[];
  /**
   * The page watermark, or null when there is none.
   *
   * Page-level rather than band-level, so it is read once and drawn on every
   * page rather than living in the band list.
   */
  watermark: PreviewWatermark | null;
  /** Non-fatal parse complaints, for the UI to surface rather than swallow. */
  problems: string[];
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
    layout: attrOf(attrs, 'Layout') || 'AcrossThenDown',
    mode: attrOf(attrs, 'Mode') || 'UseColumnCount',
  };
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

function parseTableRows(xml: string, controlStart: number): PreviewRow[] {
  const rowsIdx = xml.indexOf('<Rows', controlStart);
  if (rowsIdx === -1) return [];
  const rowsInner = innerXml(xml, 'Rows', rowsIdx);
  if (!rowsInner) return [];
  const rows: PreviewRow[] = [];
  for (const item of collectionItems(rowsInner)) {
    if (attrOf(item.attrs, 'ControlType') !== 'XRTableRow') continue;
    const cellsIdx = rowsInner.indexOf('<Cells', item.start);
    const cellsInner = cellsIdx === -1 ? null : innerXml(rowsInner, 'Cells', cellsIdx);
    const cells: PreviewCell[] = [];
    for (const cell of cellsInner ? collectionItems(cellsInner) : []) {
      if (attrOf(cell.attrs, 'ControlType') !== 'XRTableCell') continue;
      const font = parseFont(attrOf(cell.attrs, 'Font'));
      cells.push({
        text: decodeXmlText(attrOf(cell.attrs, 'Text') || ''),
        weight: numAttr(cell.attrs, 'Weight', 1) || 1,
        bold: font.bold,
        align: parseAlignment(attrOf(cell.attrs, 'TextAlignment')).align,
      });
    }
    rows.push({ cells });
  }
  return rows;
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
  return { rows: fields('RowFields'), columns: fields('ColumnFields'), data: fields('DataFields') };
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
function parseControls(bandInner: string, bandInnerStart: number): PreviewControl[] {
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
    const loc = pairAttr(item.attrs, 'LocationFloat');
    const size = pairAttr(item.attrs, 'SizeF');
    const font = parseFont(attrOf(item.attrs, 'Font'));
    const alignment = parseAlignment(attrOf(item.attrs, 'TextAlignment'));
    controls.push({
      type,
      name: attrOf(item.attrs, 'Name') || '',
      x: loc.a,
      y: loc.b,
      width: size.a,
      height: size.b,
      text: decodeXmlText(attrOf(item.attrs, 'Text') || ''),
      fontSize: font.size,
      fontFamily: font.family,
      bold: font.bold,
      italic: font.italic,
      align: alignment.align,
      vAlign: alignment.vAlign,
      borders: parseBorders(attrOf(item.attrs, 'Borders')),
      rows: type === 'XRTable' ? parseTableRows(inner, item.start) : [],
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
        for (const child of parseControls(panelSlice, innerStart + item.start)) {
          controls.push({ ...child, offsetX: loc.a, offsetY: loc.b });
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

/**
 * Read the page, the margins and every band out of a `.repx`.
 *
 * Never throws. An unusable document comes back with no bands and a `problems`
 * entry saying so, which is what the caller renders.
 */
export function parseReportStructure(xml: string | undefined | null): ReportStructure {
  const text = xml ?? '';
  const problems: string[] = [];
  const empty: ReportStructure = {
    page: { width: 850, height: 1100 },
    margins: { top: 0, bottom: 0 },
    unit: 'HundredthsOfAnInch',
    bands: [],
    watermark: null,
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

  const structure: ReportStructure = {
    page: {
      width: numAttr(rootAttrs, 'PageWidth', 850),
      height: numAttr(rootAttrs, 'PageHeight', 1100),
    },
    margins: { top: marginRaw[2] ?? 0, bottom: marginRaw[3] ?? 0 },
    unit: attrOf(rootAttrs, 'ReportUnit') || 'HundredthsOfAnInch',
    bands: [],
    watermark: parseWatermark(text),
    problems,
  };

  const bandsIdx = text.indexOf('<Bands');
  const bandsSpan = bandsIdx === -1 ? null : innerSpan(text, 'Bands', bandsIdx);
  if (!bandsSpan) {
    problems.push('The report has no <Bands> element, so there is nothing to lay out.');
    return structure;
  }
  const bandsInner = bandsSpan.text;

  for (const item of collectionItems(bandsInner)) {
    const controlType = attrOf(item.attrs, 'ControlType');
    if (!controlType || !/Band$/.test(controlType)) continue;
    const kind = bandKind(controlType);
    if (kind === 'Unknown') {
      problems.push(`Unrecognised band type "${controlType}" — it is drawn in file order.`);
    }
    const bandSpan = innerSpan(bandsInner, item.tag, item.start);
    structure.bands.push({
      kind,
      name: attrOf(item.attrs, 'Name') || controlType,
      height: numAttr(item.attrs, 'HeightF', 0),
      controls: bandSpan
        ? parseControls(bandSpan.text, bandsSpan.start + bandSpan.start)
        : [],
      columns: bandSpan ? parseColumns(bandSpan.text) : null,
    });
  }

  if (!structure.bands.length) problems.push('No bands were found inside <Bands>.');

  // Print order, not file order. A file listing PageHeader after Detail is a
  // different report, and repxAudit reports that -- but the preview should not
  // compound it by drawing them upside down.
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

// --------------------------------------------------------------- pagination

export interface PlacedBand {
  band: PreviewBand;
  /** Page-relative top edge, in report units. */
  top: number;
  /**
   * Page-relative left edge, in report units.
   *
   * 0 for everything except a record in the second or later column of a
   * multi-column Detail band. Headers and footers always span the full width —
   * DevExpress divides only the detail flow, not the page.
   */
  left: number;
  /**
   * How wide this band prints, in report units.
   *
   * The full page width except inside a multi-column Detail band, where it is
   * one column. The renderer needs it because a column's controls are laid out
   * against the column's width, not the page's.
   */
  width: number;
  /** 1-based record number for a repeated Detail band; null for everything else. */
  record: number | null;
}

export interface PreviewPage {
  /** 1-based, as a reader counts pages. */
  number: number;
  bands: PlacedBand[];
}

export interface PaginatedReport {
  pages: PreviewPage[];
  page: { width: number; height: number };
  unit: string;
  /** Records actually laid out. */
  records: number;
  /** Detail rows that fit on one page; 0 when there is no Detail band. */
  recordsPerPage: number;
  problems: string[];
}

const findBand = (bands: PreviewBand[], kind: BandKind) => bands.find((b) => b.kind === kind);

/**
 * Lay the report out across pages, printing the Detail band once per record.
 *
 * This is the whole point of the module, so the rules are worth stating rather
 * than leaving in the arithmetic:
 *
 * - TopMargin and BottomMargin are page furniture. Their heights reserve space
 *   and they are never placed as content.
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
  records: number,
  options: { maxPages?: number } = {},
): PaginatedReport {
  const maxPages = options.maxPages ?? 50;
  const problems = [...structure.problems];
  const bands = structure.bands;

  const topMargin = Math.max(structure.margins.top, findBand(bands, 'TopMargin')?.height ?? 0);
  const bottomMargin = Math.max(structure.margins.bottom, findBand(bands, 'BottomMargin')?.height ?? 0);

  const reportHeader = findBand(bands, 'ReportHeader');
  const pageHeader = findBand(bands, 'PageHeader');
  const detail = findBand(bands, 'Detail');
  const reportFooter = findBand(bands, 'ReportFooter');
  const pageFooter = findBand(bands, 'PageFooter');

  /*
   * Every group band, not the first.
   *
   * DevExpress nests groups by emitting several GroupHeaderBands, each with its
   * own GroupFields and Level -- region, then category within it. Taking only
   * `find`'s first match drew the outer group and silently dropped the inner
   * one, which is precisely the "looks right, is missing content" failure this
   * preview exists to expose. Headers print outermost-first, footers in the
   * reverse order, which is what the file order already gives once the footers
   * are read back to front.
   */
  const groupHeaders = bands.filter((b) => b.kind === 'GroupHeader');
  const groupFooters = [...bands.filter((b) => b.kind === 'GroupFooter')].reverse();

  const pageBottom = structure.page.height - bottomMargin - (pageFooter?.height ?? 0);

  const pages: PreviewPage[] = [];
  let current: PreviewPage | null = null;
  let cursor = 0;

  /** The full page width, which every band gets unless it is in a column. */
  const fullWidth = structure.page.width;

  const startPage = () => {
    current = { number: pages.length + 1, bands: [] };
    pages.push(current);
    cursor = topMargin;
    if (pageHeader) {
      current.bands.push({ band: pageHeader, top: cursor, left: 0, width: fullWidth, record: null });
      cursor += pageHeader.height;
    }
    if (pageFooter) {
      current.bands.push({
        band: pageFooter,
        top: structure.page.height - bottomMargin - pageFooter.height,
        left: 0,
        width: fullWidth,
        record: null,
      });
    }
  };

  /** Place a band, opening a new page first if it will not fit on this one. */
  const place = (band: PreviewBand, record: number | null) => {
    if (!current) startPage();
    if (cursor + band.height > pageBottom && pages.length < maxPages) {
      startPage();
    }
    current!.bands.push({ band, top: cursor, left: 0, width: fullWidth, record });
    cursor += band.height;
  };

  startPage();

  if (reportHeader) {
    current!.bands.push({ band: reportHeader, top: cursor, left: 0, width: fullWidth, record: null });
    cursor += reportHeader.height;
  }
  for (const header of groupHeaders) place(header, null);

  let placedRecords = 0;
  if (detail && records > 0) {
    const usable = pageBottom - topMargin - (pageHeader?.height ?? 0);
    if (detail.height > usable) {
      problems.push(
        `The Detail band is ${Math.round(detail.height)} units tall and only ${Math.round(usable)} fit on a page, ` +
          'so every record starts a new sheet. A Detail band near the height of the page usually means the whole ' +
          'design went into one band instead of being split across ReportHeader, PageHeader and Detail.',
      );
    }
    const columns = detail.columns && detail.columns.count > 1 ? detail.columns : null;

    if (!columns) {
      for (let i = 0; i < records; i++) {
        if (pages.length >= maxPages && cursor + detail.height > pageBottom) break;
        place(detail, i + 1);
        placedRecords++;
      }
    } else {
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
      const columnWidth = (fullWidth - columns.spacing * (columns.count - 1)) / columns.count;
      const downThenAcross = columns.layout === 'DownThenAcross';

      /*
       * Recomputed per page rather than once, because the first page is
       * shorter: it spends height on the ReportHeader and any group headers.
       * Computing the grid once from the first page's remaining height would
       * under-fill every page after it, which reads as a pagination bug in the
       * report rather than in this function.
       */
      let pageTop = cursor;
      let rowsPerPage = Math.max(1, Math.floor((pageBottom - pageTop) / detail.height));
      let perPage = rowsPerPage * columns.count;
      let onPage = 0;
      let rowsUsed = 0;

      for (let i = 0; i < records; i++) {
        if (onPage === perPage) {
          if (pages.length >= maxPages) break;
          startPage();
          pageTop = cursor;
          rowsPerPage = Math.max(1, Math.floor((pageBottom - pageTop) / detail.height));
          perPage = rowsPerPage * columns.count;
          onPage = 0;
          rowsUsed = 0;
        }

        // Which slot of the rows x count grid, in this layout's fill order.
        const row = downThenAcross ? onPage % rowsPerPage : Math.floor(onPage / columns.count);
        const column = downThenAcross ? Math.floor(onPage / rowsPerPage) : onPage % columns.count;

        current!.bands.push({
          band: detail,
          top: pageTop + row * detail.height,
          left: column * (columnWidth + columns.spacing),
          width: columnWidth,
          record: i + 1,
        });
        onPage++;
        rowsUsed = Math.max(rowsUsed, row + 1);
        placedRecords++;
      }

      // Below every column, so a group or report footer does not land inside
      // the grid. `place` is not used above precisely because its single
      // vertical cursor cannot describe two records at the same height.
      cursor = pageTop + rowsUsed * detail.height;
    }
  }

  for (const footer of groupFooters) place(footer, null);
  if (reportFooter) place(reportFooter, null);

  if (placedRecords < records) {
    problems.push(
      `Preview stopped at ${maxPages} pages; ${records - placedRecords} of ${records} records are not shown.`,
    );
  }

  // Reported for the UI's "N records per page" readout. Derived from the first
  // full page rather than from the arithmetic above, because the arithmetic
  // ignores the ReportHeader that shortens page 1.
  const recordsPerPage = detail && detail.height > 0
    ? Math.max(1, Math.floor((pageBottom - topMargin - (pageHeader?.height ?? 0)) / detail.height))
    : 0;

  return {
    pages,
    page: structure.page,
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
