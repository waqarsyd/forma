/**
 * The layout a cross-tab needs before DevExpress will print it.
 *
 * ## The measurement
 *
 * A cross-tab written as its three field collections alone -- `<RowFields>`,
 * `<ColumnFields>`, `<DataFields>`, which is what the serializer wrote for
 * `RepxProbe emit-chart` and what the prompt taught -- loads with its fields
 * and then THROWS when DevExpress prints it, with data or without (case s23 of
 * `docs/proposals/devexpress-parity.md`, 2026-10-30):
 *
 *     The number of columns in the generated layout does not match the number
 *     of items in the ColumnDefinitions collection.
 *
 * DevExpress generates a layout from the fields and checks the file against it.
 * A printable cross-tab carries that layout: a `<ColumnDefinitions>`, a
 * `<RowDefinitions>` and a `<Cells>` holding a cell at every position.
 * Leaving out the cells, or the row definitions, throws again. So every
 * cross-tab Forma wrote before parity row 30 opened in the designer and could
 * not be printed.
 *
 * ## The layout, as DevExpress generated it
 *
 * Read from `XRCrossTab.GenerateLayout()` for 24 field shapes, from no field
 * of a kind up to three of each. The rule below was written from 14 of them
 * and checked against the other 10, which it had not seen. With R row, C
 * column and D data fields, and D taken as at least 1:
 *
 * - the header rows are one per column field (at least one), plus a row of
 *   data-field names when D is 2 or more;
 * - then one data row, one subtotal row per row field but the last, innermost
 *   outward, and a Grand Total row when there is a row field;
 * - the row-header columns are one per row field (at least one);
 * - then a block of D columns for the values, one per column field but the
 *   last, innermost outward, for subtotals, and one for the Grand Total when
 *   there is a column field.
 *
 * The header holds each row field's name and `Grand Total`. Subtotal headers
 * carry `TextFormatString="Total {0}"`, and with two or more data fields each
 * block is headed by the data fields' names. Everything else is empty: the
 * values are filled in at print time.
 *
 * A generated cell is one inch by a quarter inch: 100 by 25 hundredths of an
 * inch, 254 by 63.5 tenths of a millimetre, 96 by 24 pixels. The numbers are
 * in the control's own `Dpi`, NOT the report's unit -- measured in case s24,
 * DevExpress reads every control at its `Dpi` attribute, 100 when absent,
 * whatever `ReportUnit` says. So the cells take the cross-tab's `Dpi`, which is
 * units per inch and needs no conversion table. When it is not 100 the
 * serializer also writes each column's `Width` and each cell's `Dpi`. The
 * control is resized to fit, because cells share out the control's own size:
 * left at 600 by 200, three columns printed 200 wide each, and the grid ran
 * onto a second page.
 *
 * ## What is repaired
 *
 * A cross-tab with no layout gets one. So does one whose layout does not
 * match its fields, since DevExpress refuses that one too, and its old cells
 * are discarded. A cross-tab whose layout already matches is left exactly as
 * written, so a designer-saved file comes back byte for byte. New items take
 * `Ref` values above the document's highest, because this runs after
 * `ensureUniqueRefs` and a duplicate `Ref` makes the loader discard content.
 */

export interface CrossTabCell {
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
  /** A field name or `Grand Total`; null for a cell filled in at print time. */
  text: string | null;
  /** `Total {0}` on a subtotal header, else null. */
  format: string | null;
}

export interface CrossTabLayout {
  columns: number;
  rows: number;
  cells: CrossTabCell[];
}

export interface CrossTabFields {
  rows: string[];
  columns: string[];
  data: string[];
}

/** The layout DevExpress generates for these fields. */
export function crossTabLayout({ rows: rowFields, columns: columnFields, data: dataFields }: CrossTabFields): CrossTabLayout {
  const R = rowFields.length;
  const C = columnFields.length;
  const D = Math.max(dataFields.length, 1);
  const dataHeader = dataFields.length >= 2 ? 1 : 0;
  const headerRows = Math.max(C, 1) + dataHeader;
  const rowHeads = Math.max(R, 1);
  const blocks = C >= 1 ? C + 1 : 1;
  const columns = rowHeads + D * blocks;
  const rows = headerRows + 1 + R;

  const cells: CrossTabCell[] = [];
  const cell = (column: number, row: number, extra: Partial<CrossTabCell> = {}) =>
    cells.push({ column, row, columnSpan: 1, rowSpan: 1, text: null, format: null, ...extra });

  // The corner: a row field's name over its column, or one empty cell.
  if (R === 0) cell(0, 0, { rowSpan: headerRows });
  else rowFields.forEach((name, k) => cell(k, 0, { rowSpan: headerRows, text: name }));

  // Column headers: each level's value, its subtotal, and the grand total.
  if (C === 0) {
    cell(rowHeads, 0, { columnSpan: D });
  } else {
    for (let k = 0; k < C; k++) cell(rowHeads, k, { columnSpan: D * Math.max(1, C - 1 - k) });
    for (let k = 0; k < C - 1; k++) cell(rowHeads + D * (C - 1 - k), k, { columnSpan: D, rowSpan: C - k, format: 'Total {0}' });
    cell(rowHeads + D * C, 0, { columnSpan: D, rowSpan: C, text: 'Grand Total' });
  }
  if (dataHeader) {
    for (let b = 0; b < blocks; b++) dataFields.forEach((name, j) => cell(rowHeads + b * D + j, headerRows - 1, { text: name }));
  }

  // Row headers: each level's value, its subtotal, and the grand total.
  const top = headerRows;
  if (R === 0) {
    cell(0, top);
  } else {
    for (let k = 0; k < R; k++) cell(k, top, { rowSpan: Math.max(1, R - 1 - k) });
    for (let k = R - 2; k >= 0; k--) cell(k, top + 1 + (R - 2 - k), { columnSpan: R - k, format: 'Total {0}' });
    cell(0, top + R, { columnSpan: R, text: 'Grand Total' });
  }

  // The values, at every row below the header and every column right of the row headers.
  for (let y = top; y < rows; y++) for (let x = rowHeads; x < columns; x++) cell(x, y);

  return { columns, rows, cells };
}

/** An element's `Dpi`: its units per inch, 100 when it writes none. */
const dpiOf = (attrs: string) => Number(attrOf(attrs, 'Dpi') ?? '100') || 100;

const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;

const attrOf = (attrs: string, name: string): string | null =>
  new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1] ?? null;

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const encode = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A number as the serializer writes one: no trailing zeros. */
const num = (n: number) => String(Math.round(n * 1000) / 1000);

interface Child {
  name: string;
  start: number;
  end: number;
  items: { attrs: string }[];
}

interface CrossTab {
  name: string;
  attrs: string;
  start: number;
  /** End of the opening tag, and start of the closing one; equal for a self-closing tag. */
  openEnd: number;
  closeStart: number;
  end: number;
  selfClosing: boolean;
  children: Child[];
  /** The band whose `<Controls>` hold it directly, for growing it; null inside a panel. */
  band: { attrsAt: number; attrs: string } | null;
}

interface Open {
  name: string;
  attrs: string;
  crossTab: CrossTab | null;
  child: Child | null;
  band: CrossTab['band'];
}

/** Every cross-tab, with its direct child collections and the band it sits in. */
function findCrossTabs(xml: string): CrossTab[] {
  const found: CrossTab[] = [];
  const stack: Open[] = [];
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(xml)) !== null) {
    const [whole, closing, name, attrs, selfClosing] = m;
    if (closing) {
      const el = stack.pop();
      if (el?.child) el.child.end = m.index + whole.length;
      if (el?.crossTab) {
        el.crossTab.closeStart = m.index;
        el.crossTab.end = m.index + whole.length;
      }
      continue;
    }
    const parent = stack[stack.length - 1];
    const type = attrOf(attrs, 'ControlType') ?? '';
    const band = /Band$/.test(type) ? { attrsAt: m.index + 1 + name.length, attrs } : parent?.band ?? null;

    // A direct child collection of a cross-tab, and the items in one.
    const owner = parent?.crossTab ?? null;
    let child: Child | null = null;
    if (owner) {
      child = { name, start: m.index, end: m.index + whole.length, items: [] };
      owner.children.push(child);
    } else if (parent?.child && stack[stack.length - 2]?.crossTab) {
      parent.child.items.push({ attrs });
    }

    let crossTab: CrossTab | null = null;
    if (type === 'XRCrossTab') {
      const end = m.index + whole.length;
      const inBand = parent?.name === 'Controls' && /Band$/.test(attrOf(stack[stack.length - 2]?.attrs ?? '', 'ControlType') ?? '');
      crossTab = {
        name: attrOf(attrs, 'Name') ?? 'crossTab',
        attrs,
        start: m.index,
        openEnd: end,
        closeStart: end,
        end,
        selfClosing: !!selfClosing,
        children: [],
        band: inBand ? band : null,
      };
      found.push(crossTab);
    }
    if (!selfClosing) stack.push({ name, attrs, crossTab, child, band });
  }
  return found;
}

function fieldsOf(tab: CrossTab): CrossTabFields {
  const list = (name: string) =>
    (tab.children.find((c) => c.name === name)?.items ?? []).map((i) => decode(attrOf(i.attrs, 'FieldName') ?? ''));
  return { rows: list('RowFields'), columns: list('ColumnFields'), data: list('DataFields') };
}

/** Whether a cross-tab's written layout is the one DevExpress generates for its fields. */
function layoutMatches(tab: CrossTab, expected: CrossTabLayout): boolean {
  const count = (name: string) => tab.children.find((c) => c.name === name)?.items.length ?? -1;
  if (count('ColumnDefinitions') !== expected.columns || count('RowDefinitions') !== expected.rows) return false;
  const written = new Set(
    (tab.children.find((c) => c.name === 'Cells')?.items ?? []).map((i) => `${attrOf(i.attrs, 'ColumnIndex') ?? 0},${attrOf(i.attrs, 'RowIndex') ?? 0}`),
  );
  return expected.cells.every((c) => written.has(`${c.column},${c.row}`));
}

export interface CrossTabProblem {
  name: string;
  /** `no-layout`: fields only, the form that throws. `wrong-layout`: written, but not what DevExpress generates. */
  kind: 'no-layout' | 'wrong-layout';
}

/** The cross-tabs DevExpress will refuse to print, as the file stands. */
export function findCrossTabProblems(xml: string | undefined | null): CrossTabProblem[] {
  const out: CrossTabProblem[] = [];
  for (const tab of findCrossTabs(xml ?? '')) {
    const expected = crossTabLayout(fieldsOf(tab));
    if (layoutMatches(tab, expected)) continue;
    const any = tab.children.some((c) => c.name === 'ColumnDefinitions' || c.name === 'RowDefinitions' || c.name === 'Cells');
    out.push({ name: tab.name, kind: any ? 'wrong-layout' : 'no-layout' });
  }
  return out;
}

/** Whether any cross-tab has no data field, which prints a grid of empty cells. */
export function crossTabsWithoutData(xml: string | undefined | null): string[] {
  return findCrossTabs(xml ?? '').filter((t) => fieldsOf(t).data.length === 0).map((t) => t.name);
}

export interface CrossTabRepair {
  xml: string;
  applied: boolean;
  reason: string;
  repaired: { name: string; columns: number; rows: number; cells: number }[];
}

/**
 * Write the layout DevExpress generates into every cross-tab that lacks it.
 *
 * The definitions and cells go after the field collections, where the
 * serializer writes them. The control is resized to the generated cells, in
 * its own `Dpi`, and its band grows if the control would now reach past the
 * band's bottom.
 */
export function repairCrossTabs(xml: string | undefined | null): CrossTabRepair {
  const text = xml ?? '';
  const tabs = findCrossTabs(text);

  let ref = 0;
  for (const r of text.matchAll(/\sRef="(\d+)"/g)) ref = Math.max(ref, Number(r[1]));
  const edits: { at: number; end: number; insert: string }[] = [];
  const repaired: CrossTabRepair['repaired'] = [];
  const bandHeights = new Map<number, { attrs: string; height: number }>();

  for (const tab of tabs) {
    const layout = crossTabLayout(fieldsOf(tab));
    if (layoutMatches(tab, layout)) continue;

    // One inch by a quarter inch, in the control's own units per inch.
    const dpi = dpiOf(tab.attrs);
    const size = { width: dpi, height: dpi / 4 };
    const item = (i: number, attrs: string) => `<Item${i + 1} Ref="${++ref}"${attrs} />`;
    const colAttr = dpi !== 100 ? ` Width="${num(size.width)}"` : '';
    const rowAttr = ` Height="${num(size.height)}"`;
    const cells = layout.cells.map((c, i) =>
      item(i,
        ' ControlType="XRCrossTabCell"' +
        (c.format ? ` TextFormatString="${encode(c.format)}"` : '') +
        ` ColumnIndex="${c.column}" RowIndex="${c.row}"` +
        (c.columnSpan > 1 ? ` ColumnSpan="${c.columnSpan}"` : '') +
        (c.rowSpan > 1 ? ` RowSpan="${c.rowSpan}"` : '') +
        (c.text !== null ? ` Text="${encode(c.text)}"` : '') +
        (dpi !== 100 ? ` Dpi="${num(dpi)}"` : '')));
    const block =
      `<ColumnDefinitions>${Array.from({ length: layout.columns }, (_, i) => item(i, colAttr)).join('')}</ColumnDefinitions>` +
      `<RowDefinitions>${Array.from({ length: layout.rows }, (_, i) => item(i, rowAttr)).join('')}</RowDefinitions>` +
      `<Cells>${cells.join('')}</Cells>`;

    // Any layout already written is replaced: DevExpress refuses it as it stands.
    for (const child of tab.children) {
      if (child.name === 'ColumnDefinitions' || child.name === 'RowDefinitions' || child.name === 'Cells') {
        edits.push({ at: child.start, end: child.end, insert: '' });
      }
    }
    const fields = tab.children.filter((c) => c.name === 'RowFields' || c.name === 'ColumnFields' || c.name === 'DataFields');
    const after = fields.length ? Math.max(...fields.map((c) => c.end)) : tab.closeStart;

    // The opening tag, resized; a self-closing one is opened up to hold the layout.
    let open = text.slice(tab.start, tab.openEnd);
    const w = num(layout.columns * size.width);
    const h = num(layout.rows * size.height);
    open = /\sSizeF="[^"]*"/.test(open)
      ? open.replace(/\sSizeF="[^"]*"/, ` SizeF="${w},${h}"`)
      : open.replace(/\s*\/?>$/, (end) => ` SizeF="${w},${h}"${end.trim() === '/>' ? ' />' : '>'}`);
    if (tab.band) {
      // Compared in the band's own units, which can carry a different Dpi.
      const y = Number((attrOf(tab.attrs, 'LocationFloat') ?? '0,0').split(',')[1]) || 0;
      const needed = ((y + layout.rows * size.height) * dpiOf(tab.band.attrs)) / dpi;
      const current = bandHeights.get(tab.band.attrsAt)?.height ?? Number(attrOf(tab.band.attrs, 'HeightF') ?? 'NaN');
      if (Number.isFinite(current) && needed > current) bandHeights.set(tab.band.attrsAt, { attrs: tab.band.attrs, height: needed });
    }
    if (tab.selfClosing) {
      edits.push({ at: tab.start, end: tab.end, insert: open.replace(/\s*\/>$/, '>') + block + '</' + /^<([\w.:-]+)/.exec(open)![1] + '>' });
    } else {
      edits.push({ at: tab.start, end: tab.openEnd, insert: open });
      edits.push({ at: after, end: after, insert: block });
    }
    repaired.push({ name: tab.name, columns: layout.columns, rows: layout.rows, cells: layout.cells.length });
  }

  for (const [at, { attrs, height }] of bandHeights) {
    const old = /\sHeightF="[^"]*"/.exec(attrs)!;
    edits.push({ at: at + old.index, end: at + old.index + old[0].length, insert: ` HeightF="${num(height)}"` });
  }

  if (!repaired.length) {
    return {
      xml: text,
      applied: false,
      reason: tabs.length ? 'every cross-tab already carries the layout DevExpress generates' : 'no cross-tabs',
      repaired: [],
    };
  }

  let out = text;
  // Back to front. At a shared offset the earlier edit goes first, so an old
  // layout is removed before the new one is inserted where it stood.
  for (const edit of edits.map((e, i) => ({ ...e, i })).sort((a, b) => b.at - a.at || a.i - b.i)) {
    out = out.slice(0, edit.at) + edit.insert + out.slice(edit.end);
  }
  return {
    xml: out,
    applied: true,
    reason: `wrote the generated layout into ${repaired.length} cross-tab(s): ` +
      repaired.map((r) => `${r.name} ${r.columns}x${r.rows}, ${r.cells} cells`).join('; '),
    repaired,
  };
}
