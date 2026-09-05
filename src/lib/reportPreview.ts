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
   * Where this control's opening tag sits in the source REPX: `openStart` is
   * the `<`, `openEnd` the matching `>`. Absolute offsets into the document
   * that was parsed, which is what lets an edit rewrite one attribute list and
   * leave every other byte alone. Meaningless against any other string.
   */
  openStart: number;
  openEnd: number;
}

export interface PreviewBand {
  kind: BandKind;
  name: string;
  height: number;
  controls: PreviewControl[];
}

export interface ReportStructure {
  page: { width: number; height: number };
  margins: { top: number; bottom: number };
  unit: string;
  bands: PreviewBand[];
  /** Non-fatal parse complaints, for the UI to surface rather than swallow. */
  problems: string[];
}

// --------------------------------------------------------------- attributes

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
  const open = new RegExp(`<${tagName}(?=[\\s>])`, 'g');
  const close = new RegExp(`</${tagName}>`, 'g');
  open.lastIndex = openEnd;
  close.lastIndex = openEnd;
  let depth = 1;
  let cursor = openEnd;
  while (depth > 0) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const nextOpen = open.exec(xml);
    const nextClose = close.exec(xml);
    if (!nextClose) return null;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      cursor = nextOpen.index + 1;
    } else {
      depth--;
      if (depth === 0) {
        return { text: xml.slice(openEnd + 1, nextClose.index), start: openEnd + 1 };
      }
      cursor = nextClose.index + 1;
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
      openStart: innerStart + item.start,
      openEnd: innerStart + inner.indexOf('>', item.start),
    });
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

  const startPage = () => {
    current = { number: pages.length + 1, bands: [] };
    pages.push(current);
    cursor = topMargin;
    if (pageHeader) {
      current.bands.push({ band: pageHeader, top: cursor, record: null });
      cursor += pageHeader.height;
    }
    if (pageFooter) {
      current.bands.push({
        band: pageFooter,
        top: structure.page.height - bottomMargin - pageFooter.height,
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
    current!.bands.push({ band, top: cursor, record });
    cursor += band.height;
  };

  startPage();

  if (reportHeader) {
    current!.bands.push({ band: reportHeader, top: cursor, record: null });
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
    for (let i = 0; i < records; i++) {
      if (pages.length >= maxPages && cursor + detail.height > pageBottom) break;
      place(detail, i + 1);
      placedRecords++;
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
