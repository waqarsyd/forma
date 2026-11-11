/**
 * A report made right to left (2026-11-04), for the Settings checkbox.
 *
 * Until this the setting reached only the generation prompt, which asks the
 * model for `RightToLeft="Yes"` and `RightToLeftLayout="Yes"` on the report.
 * Forma also makes reports with no model at all (OCR, the box reader, its own
 * model, the vision model, its stand-in draft), and the checkbox has to mean
 * the same thing for those. So this pass writes both attributes on the
 * report's root element, where DevExpress reads them and where the Preview's
 * parser reads them too (`applyRightToLeft` in reportPreview.ts, measured in
 * parity cases s63a to s63d): every alignment flips, text runs right to left,
 * and with the layout attribute every control mirrors across the page.
 *
 * Both are needed. `RightToLeftLayout` alone printed exactly as neither, and
 * `RightToLeft` alone flips the text but leaves every control where it was,
 * which for a report designed left to right puts the captions on the wrong
 * side of their values.
 *
 * Idempotent, and a document with no root element comes back unchanged.
 *
 * ## A page read as it is seen (2026-11-11, the full audit's PL-04b)
 *
 * Under both attributes DevExpress mirrors what is written, so a report must
 * be written mirrored to print as its page looks: a title the page shows at
 * the right, aligned right, is written at the left, aligned left. Every
 * reader of a page (the AI, OCR, the box reader, the vision model) writes
 * what it sees, and setting the attributes over that printed an Arabic
 * invoice back to front. `toLogicalRtl` turns such a report round before the
 * attributes are set: the inverse of what s63a measured, which is the same
 * mirror again.
 */
import { printedPaper } from './repxPaper';
import { unitsPerInch } from './reportGeometry';

const ROOT = /<XtraReportsLayoutSerializer\b([^>]*?)(\/?)>/;

/** `xml` with the report set right to left; unchanged when it is already, or has no report root. */
export function makeRightToLeft(xml: string): string {
  const root = ROOT.exec(xml);
  if (!root) return xml;
  let attrs = root[1];
  for (const name of ['RightToLeft', 'RightToLeftLayout']) {
    const own = new RegExp(`\\s${name}="[^"]*"`);
    attrs = own.test(attrs) ? attrs.replace(own, ` ${name}="Yes"`) : `${attrs} ${name}="Yes"`;
  }
  return xml.slice(0, root.index) + `<XtraReportsLayoutSerializer${attrs}${root[2]}>` + xml.slice(root.index + root[0].length);
}

const attrOf = (attrs: string, name: string): string | null => new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1] ?? null;

/** `attrs` with `name` set to `value`, written in place or added at the end. */
function setAttr(attrs: string, name: string, value: string): string {
  const own = new RegExp(`(\\s${name}\\s*=\\s*")[^"]*(")`);
  return own.test(attrs) ? attrs.replace(own, (_, a: string, b: string) => `${a}${value}${b}`) : `${attrs} ${name}="${value}"`;
}

/** "x, y" as two numbers, 0 for anything missing. */
function pair(value: string | null): [number, number] {
  const [a, b] = (value ?? '').split(',').map((p) => Number.parseFloat(p.trim()));
  return [Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0];
}

/** A number as DevExpress writes one: no trailing zeros, at most four places. */
const num = (n: number) => String(Math.round(n * 10000) / 10000);

/** Left for Right and Right for Left, in an alignment or a list of sides. */
const swapSides = (value: string) => value.replace(/Left|Right/g, (side) => (side === 'Left' ? 'Right' : 'Left'));

const TAG = /<(\/?)([\w.:-]+)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;

/**
 * A report whose page reads right to left, written as the page is seen, turned
 * to be written as DevExpress lays it out right to left (PL-04b): every
 * control's x mirrored across what holds it, `width - x - w` (a band's
 * printable width, a panel's own), every alignment's Left and Right swapped,
 * and every table row's cells reversed with their left and right borders
 * swapped. Measured in s63a: with RightToLeft and RightToLeftLayout,
 * DevExpress printed a label written at 0 of 200 from 600 to 800 of a
 * 750-wide band, right-aligned text at its box's left, and a row's first cell
 * rightmost.
 *
 * A report already laid out right to left (`RightToLeftLayout="Yes"`) comes
 * back unchanged, so this is safe to run on one twice, and on a report the
 * user brought. Controls inside a table cell keep their place: a cell's width
 * is a share of its row, which this does not work out. Each element's numbers
 * are read at its own Dpi, 100 when absent, as DevExpress reads them.
 *
 * Not turned, and known (the PIPE1 review): a cross-band line or box
 * (XRCrossBandLine, XRCrossBandBox), which has a start and an end rather than
 * a SizeF; a label's Borders; and any Padding's left and right. A report
 * read off a page rarely has the first, and the others print a few points
 * off rather than on the wrong side.
 */
export function toLogicalRtl(xml: string): string {
  const root = ROOT.exec(xml);
  if (!root || attrOf(root[1], 'RightToLeftLayout') === 'Yes') return xml;
  const rootAttrs = root[1];
  const unit = attrOf(rootAttrs, 'ReportUnit') || 'HundredthsOfAnInch';
  const paper = printedPaper(rootAttrs);
  const margins = (attrOf(rootAttrs, 'Margins') ?? '').split(',').map((p) => Number.parseFloat(p.trim()));
  const rootDpi = Number.parseFloat(attrOf(rootAttrs, 'Dpi') ?? '') || 100;
  // No Margins written is DevExpress's default, an inch each side, which is
  // the root's Dpi in its own numbers (it read [100, 100] until the PIPE1
  // review, a third of an inch short on a report at 254 or 96 Dpi).
  const [left, right] = margins.length >= 4 && margins.slice(0, 4).every(Number.isFinite) ? margins : [rootDpi, rootDpi];
  /** The band's printable width, in inches. */
  const printable = paper.width / unitsPerInch(unit) - (left + right) / rootDpi;

  /**
   * What holds the elements open now: its tag name, the width, in inches, its
   * controls mirror across (null: they keep their place), and whether it or
   * anything round it writes an alignment its controls inherit.
   */
  const stack: { name: string; width: number | null; aligned: boolean }[] = [];
  let out = '';
  let last = 0;
  for (const m of xml.matchAll(TAG)) {
    const [whole, closing, name, attrsRaw, selfClosing] = m;
    if (closing) {
      const at = stack.map((f) => f.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
      continue;
    }
    const type = attrOf(attrsRaw, 'ControlType') ?? '';
    const holder = stack.length ? stack[stack.length - 1].width : printable;
    let attrs = attrsRaw;
    let width: number | null = holder;
    if (name === 'XtraReportsLayoutSerializer' || /Band$/.test(type)) {
      width = printable;
    } else if (/XRTableRow$|XRTableCell$/.test(type)) {
      width = null;
      if (/XRTableCell$/.test(type) && attrOf(attrs, 'Borders')) attrs = setAttr(attrs, 'Borders', swapSides(attrOf(attrs, 'Borders')!));
    } else if (type && attrOf(attrs, 'SizeF') !== null) {
      const dpi = Number.parseFloat(attrOf(attrs, 'Dpi') ?? '') || 100;
      const [w] = pair(attrOf(attrs, 'SizeF'));
      const [x, y] = pair(attrOf(attrs, 'LocationFloat'));
      if (holder !== null) attrs = setAttr(attrs, 'LocationFloat', `${num(holder * dpi - x - w)}, ${num(y)}`);
      // A table's cells hold their own controls; anything else holds them across its own width.
      width = /XRTable$/.test(type) ? null : w / dpi;
    }
    const align = attrOf(attrs, 'TextAlignment');
    const inherited = stack.length > 0 && stack[stack.length - 1].aligned;
    if (align) attrs = setAttr(attrs, 'TextAlignment', swapSides(align));
    // Text written with no alignment was seen at its box's left, DevExpress's
    // TopLeft; under RightToLeft that prints at the right, so it is written
    // TopRight. Not over a style's alignment, nor on a cell, which takes its
    // row's and its table's, nor (the PIPE1 review) under a band, panel or
    // table that writes one, which it inherits, already swapped above.
    else if (/XR(Label|Table|PageInfo|CheckBox|RichText)$/.test(type) && !attrOf(attrs, 'StyleName') && !inherited) attrs = setAttr(attrs, 'TextAlignment', 'TopRight');
    if (attrs !== attrsRaw) {
      out += xml.slice(last, m.index) + `<${name}${attrs}${selfClosing ? ' /' : ''}>`;
      last = m.index + whole.length;
    }
    // Only a control passes its alignment on: a collection (`<Controls>`,
    // `<Cells>`) passes on what holds it.
    if (!selfClosing) stack.push({ name, width, aligned: inherited || Boolean(type && align) });
  }
  return reverseRowCells(out + xml.slice(last));
}

/**
 * Each `<Cells>` collection's items in reverse order, renumbered Item1 on
 * from the first written. Inner collections first, so an outer one moves
 * them as they already are.
 */
function reverseRowCells(xml: string): string {
  let text = xml;
  for (let from = text.length; from >= 0; ) {
    const open = text.lastIndexOf('<Cells>', from);
    if (open < 0) break;
    from = open - 1;
    const start = open + '<Cells>'.length;
    const end = closingCells(text, start);
    if (end >= 0) text = text.slice(0, start) + reversedItems(text.slice(start, end)) + text.slice(end);
  }
  return text;
}

/** Where the `</Cells>` closing the collection opened just before `start` is. */
function closingCells(text: string, start: number): number {
  const tags = /<(\/?)Cells>/g;
  tags.lastIndex = start;
  let depth = 1;
  for (let m = tags.exec(text); m; m = tags.exec(text)) {
    depth += m[1] ? -1 : 1;
    if (!depth) return m.index;
  }
  return -1;
}

/** A collection's inner text with its top-level items reversed and renumbered; what lies between them stays where it was. */
function reversedItems(inner: string): string {
  const items: { start: number; end: number }[] = [];
  let depth = 0;
  let open = -1;
  for (const m of inner.matchAll(/<(\/?)Item\d+\b[^>]*?(\/?)>/g)) {
    if (m[2]) {
      if (!depth) items.push({ start: m.index, end: m.index + m[0].length });
      continue;
    }
    if (!m[1]) {
      if (!depth) open = m.index;
      depth++;
    } else if (--depth === 0) {
      items.push({ start: open, end: m.index + m[0].length });
    }
  }
  if (items.length < 2) return inner;
  const bodies = items.map((it) => inner.slice(it.start, it.end)).reverse();
  let out = inner.slice(0, items[0].start);
  bodies.forEach((body, i) => {
    const n = `Item${i + 1}`;
    const renamed = body.replace(/^<Item\d+/, () => `<${n}`).replace(/<\/Item\d+>$/, () => `</${n}>`);
    out += renamed + (i + 1 < items.length ? inner.slice(items[i].end, items[i + 1].start) : '');
  });
  return out + inner.slice(items[items.length - 1].end);
}
