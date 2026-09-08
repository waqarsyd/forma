/**
 * Turning a margin the model *drew* into a margin the report *declares*.
 *
 * ## The defect
 *
 * The mega-prompt pins `Margins="0, 0, 0, 0"` and both margin bands at
 * `HeightF="0"`, and says why at the point of use: it makes a band's coordinate
 * space identical to the paper's, so the numbers from PHASE 1 and from an
 * extracted PDF text layer can be written straight into `LocationFloat` with no
 * subtraction. That block is headed "the single most common way this output
 * comes out wrong", and it earned the heading.
 *
 * The model still reproduces the design's margin — it just draws it, by pushing
 * every control inward. Measured on a real generation (2026-09-02,
 * `compare-repx/invoice-FLAT.repx`): `Margins="0, 0, 0, 0"` with a content box
 * of x 48..802, y 48..590 on an 850-wide page. A symmetric 48-unit border,
 * present as whitespace and absent from the file's structure.
 *
 * On screen the two are indistinguishable, which is why nobody caught it by
 * looking — the flat output matches its source image exactly. What it costs is
 * everything downstream of the picture: the report claims the whole sheet is
 * printable, so a designer opening it gets no margin guides, a printer gets no
 * non-printable-zone protection, and anything added later inherits a band that
 * runs to the paper edge.
 *
 * ## Why this is code and not prompt text
 *
 * The obvious fix is to ask for real margins. That reverses the rule above and
 * hands the model a subtraction to perform on every coordinate it writes — and
 * a control that keeps its paper coordinate lands silently in the wrong place
 * and never throws, which is precisely the failure the zero-margin convention
 * was adopted to prevent. The measurement, by contrast, is arithmetic. Done
 * here it is exact every time, and the model goes on writing the paper-absolute
 * coordinates it already gets right.
 *
 * ## What it does
 *
 * Measure the content box, move that whitespace out of the controls and into
 * `Margins` plus the two margin bands, and subtract it back off the coordinates
 * so the rendered page is unchanged. A pure translation: same ink, same places,
 * different structure.
 *
 *     Margins="0, 0, 0, 0"          ->  Margins="48, 48, 48, 48"
 *     TopMargin    HeightF="0"      ->  TopMargin    HeightF="48"
 *     Detail       HeightF="600"    ->  Detail       HeightF="552"
 *       LocationFloat="48,48"       ->    LocationFloat="0,0"
 *     BottomMargin HeightF="0"      ->  BottomMargin HeightF="48"
 *
 * The first body band absorbs the vertical shift — its controls move up by the
 * top margin and its height shrinks by the same amount. Bands stack, so every
 * band after it keeps its paper position without being touched: the top margin
 * pushes them all down by T, and the shorter first band pulls them all back up
 * by T. Horizontal is simpler, since every band begins at the left margin, so
 * every top-level control loses the same T from its x.
 *
 * Nested controls are deliberately left alone. An `XRTableCell`'s position is
 * relative to its `XRTableRow`, not to the band, so shifting it would move it
 * twice.
 *
 * ## When it declines
 *
 * It returns the XML untouched, with a reason, rather than guessing:
 *
 * - the report already declares non-zero margins — somebody meant that
 * - the margin bands are missing, so there is nowhere to put the height
 * - any measured edge is under `MIN_LIFT`, which is what a full-bleed design
 *   looks like: a header rule or a background block running to the paper edge
 *   puts a control at x=0, and lifting a margin under it would clip it
 * - the arithmetic would put a control at a negative coordinate
 *
 * A lift larger than `MAX_LIFT` is clamped rather than declined. Any value up
 * to the measured whitespace is safe — it is the amount of margin the design
 * can afford — so an unusually wide border yields a sane margin plus a little
 * extra inset instead of no margin at all.
 *
 * Only the left and top edges are measured. Right mirrors left and bottom
 * mirrors top, each capped by the space actually free, because the other two
 * edges measure nothing: no control need approach the right edge, and the last
 * band's height is the model's choice rather than its content's.
 */
import { unitsPerInch } from './reportGeometry';

/** Below this there is no margin worth declaring, and a zero means full bleed. */
const MIN_LIFT_INCHES = 0.1;

/** No real page margin is wider than this; past it, clamp and keep the rest as inset. */
const MAX_LIFT_INCHES = 1.5;

/**
 * What an empty report gets, when there is no drawn margin to measure.
 *
 * Checked against a real one: an empty report saved by the DevExpress 20.1
 * designer reads `Margins="20, 20, 20, 20"` with both margin bands at
 * `HeightF="20"` — 0.2in, in the `HundredthsOfAnInch` a new report defaults to.
 * Forma used to decline here and ship `0, 0, 0, 0` with both bands at zero,
 * which is a file asserting that the whole sheet is printable.
 *
 * Twenty is safe *here* and nowhere else in this module, and the distinction is
 * the whole reason this is a separate path rather than a floor applied to the
 * measurement. Everywhere else a margin has to be *taken* from whitespace the
 * design already has: declaring one the content cannot afford moves the ink, or
 * clips it. With nothing placed on the page there is nothing to move, so the
 * margin costs a design nothing and gives the file the structure a printer and
 * a designer both expect.
 */
const DEFAULT_MARGIN_INCHES = 0.2;

export interface LiftedMargins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface MarginLift {
  /** The rewritten document, or the input unchanged when `applied` is false. */
  xml: string;
  applied: boolean;
  /** Why it did or did not act. Logged, not shown to the user. */
  reason: string;
  /** The margins written, present only when `applied`. */
  margins?: LiftedMargins;
}

/** One `<Tag ... >` or `</Tag>`, with the attribute block kept for slicing. */
const TOKEN = /<\/?([A-Za-z_][\w.-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;

interface Attr {
  value: string;
  /** Index of the first character inside the quotes, in the whole document. */
  start: number;
  end: number;
}

/** Attributes of one element, with document offsets so values can be spliced. */
function readAttrs(raw: string, rawOffset: number): Map<string, Attr> {
  const out = new Map<string, Attr>();
  for (const m of raw.matchAll(/([\w.:-]+)\s*=\s*"([^"]*)"/g)) {
    const valueStart = rawOffset + m.index! + m[0].length - m[2].length - 1;
    out.set(m[1], { value: m[2], start: valueStart, end: valueStart + m[2].length });
  }
  return out;
}

/** `"12.5,20"` -> `[12.5, 20]`, or undefined if it is not a usable pair. */
function readPair(a: Attr | undefined): [number, number] | undefined {
  if (!a) return undefined;
  const parts = a.value.split(',').map((n) => Number(n.trim()));
  return parts.length === 2 && parts.every(Number.isFinite) ? [parts[0], parts[1]] : undefined;
}

function readNumber(a: Attr | undefined): number | undefined {
  if (!a) return undefined;
  const n = Number(a.value.trim());
  return Number.isFinite(n) ? n : undefined;
}

/** Trim a float to the two decimals a report unit can meaningfully carry. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

interface Control {
  loc: Attr;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Band {
  type: string;
  height: number;
  heightAttr: Attr | undefined;
  controls: Control[];
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

const MARGIN_BANDS = new Set(['TopMarginBand', 'BottomMarginBand']);

/**
 * Move a drawn margin into the report's structure.
 *
 * @param xml a complete `XtraReportsLayoutSerializer` document
 * @returns the rewritten XML, or the input with `applied: false` and a reason
 */
export function liftReportMargins(xml: string | undefined | null): MarginLift {
  const decline = (reason: string): MarginLift => ({ xml: xml ?? '', applied: false, reason });

  if (!xml || !xml.includes('XtraReportsLayoutSerializer')) {
    return decline('not a report document');
  }

  // A tag stack, not a regex over <Band>...</Band>. TopMarginBand is
  // self-closing, so a non-greedy pair match swallows the following band's
  // contents -- the mistake that produced 22 phantom overflow reports when the
  // banded and flat outputs were first compared on 2026-09-01.
  const stack: { name: string; band?: Band }[] = [];
  const bands: Band[] = [];
  let root: Map<string, Attr> | undefined;

  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(xml)) !== null) {
    if (m[0].startsWith('</')) {
      stack.pop();
      continue;
    }

    const attrs = readAttrs(m[2], m.index + m[0].indexOf(m[2]));
    const type = attrs.get('ControlType')?.value ?? '';
    const node: { name: string; band?: Band } = { name: m[1] };

    if (!root && m[1] === 'XtraReportsLayoutSerializer') {
      root = attrs;
    } else if (type.endsWith('Band')) {
      const heightAttr = attrs.get('HeightF');
      node.band = { type, height: readNumber(heightAttr) ?? 0, heightAttr, controls: [] };
      bands.push(node.band);
    } else {
      // Only a direct child of a band's <Controls> is positioned against the
      // band. Anything deeper (a cell inside a row inside a table) is relative
      // to its own parent and must not move.
      const parent = stack[stack.length - 1];
      const grandparent = stack[stack.length - 2];
      const loc = attrs.get('LocationFloat');
      const xy = readPair(loc);
      const wh = readPair(attrs.get('SizeF'));
      if (parent?.name === 'Controls' && grandparent?.band && loc && xy && wh) {
        grandparent.band.controls.push({ loc, x: xy[0], y: xy[1], w: wh[0], h: wh[1] });
      }
    }

    if (!m[3]) stack.push(node);
  }

  if (!root) return decline('no report root element');

  const marginsAttr = root.get('Margins');
  if (!marginsAttr) return decline('root has no Margins attribute');
  if (marginsAttr.value.split(',').some((n) => Number(n.trim()) !== 0)) {
    return decline('report already declares margins');
  }

  const pageWidth = readNumber(root.get('PageWidth'));
  const pageHeight = readNumber(root.get('PageHeight'));
  if (!pageWidth || !pageHeight) return decline('page size is missing or unreadable');

  const topBand = bands.find((b) => b.type === 'TopMarginBand');
  const bottomBand = bands.find((b) => b.type === 'BottomMarginBand');
  if (!topBand?.heightAttr || !bottomBand?.heightAttr) return decline('margin bands are missing');

  const bodyBands = bands.filter((b) => !MARGIN_BANDS.has(b.type));
  const placed = bodyBands.flatMap((b) => b.controls);

  if (!placed.length) {
    /*
     * Nothing is placed, so there is nothing to measure — and nothing to move.
     * Declare the DevExpress default instead of declining to zero. See
     * DEFAULT_MARGIN_INCHES for why 20 is safe on this path alone.
     */
    const perInch = unitsPerInch(root.get('ReportUnit')?.value);
    const size = DEFAULT_MARGIN_INCHES * perInch;
    const first = bodyBands[0];
    const bodyHeight = bodyBands.reduce((n, b) => n + b.height, 0);

    // The top margin comes out of the first body band, and the bottom needs
    // room under what is left. A body already filling the sheet has neither.
    if (!first?.heightAttr || first.height < size) return decline('no body band to take the margin from');
    if (pageHeight < bodyHeight + size) return decline('the body already fills the sheet');

    const edits: Edit[] = [
      { start: marginsAttr.start, end: marginsAttr.end, text: `${fmt(size)}, ${fmt(size)}, ${fmt(size)}, ${fmt(size)}` },
      { start: topBand.heightAttr.start, end: topBand.heightAttr.end, text: fmt(size) },
      { start: bottomBand.heightAttr.start, end: bottomBand.heightAttr.end, text: fmt(size) },
      { start: first.heightAttr.start, end: first.heightAttr.end, text: fmt(first.height - size) },
    ];
    edits.sort((a, b) => b.start - a.start);
    let out = xml;
    for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

    return {
      xml: out,
      applied: true,
      reason: `empty report; declared the ${fmt(size)} default margin`,
      margins: { left: size, right: size, top: size, bottom: size },
    };
  }

  const firstBand = bodyBands.find((b) => b.controls.length > 0);
  if (!firstBand || firstBand !== bodyBands[0]) {
    // The vertical shift is absorbed by the first band. If the first band is
    // empty the whitespace is band height rather than control inset, which is a
    // different edit than this one.
    return decline('the first body band carries no controls');
  }

  const perInch = unitsPerInch(root.get('ReportUnit')?.value);
  const min = MIN_LIFT_INCHES * perInch;
  const max = MAX_LIFT_INCHES * perInch;

  const measuredLeft = Math.min(...placed.map((c) => c.x));
  const measuredRight = pageWidth - Math.max(...placed.map((c) => c.x + c.w));
  const measuredTop = Math.min(...firstBand.controls.map((c) => c.y));

  if (measuredLeft < min || measuredRight < min || measuredTop < min) {
    return decline('content reaches the paper edge; a margin would clip it');
  }

  const left = Math.min(measuredLeft, max);
  const top = Math.min(measuredTop, max);

  // Right and bottom are mirrored from left and top rather than taken from the
  // measurement, and both are capped by what the content actually leaves free.
  //
  // The measurement alone is not a margin on either axis. Nothing need reach
  // the right edge -- a page of short left-aligned labels leaves 700 units
  // clear, which is empty space, not a 7in margin -- and the last band's height
  // is chosen by the model, so the gap under it says nothing either. Mirroring
  // gives the symmetric result a page layout almost always wants, and the cap
  // keeps it honest: a design with a genuinely wide right border ends up with
  // the declared margin plus some inset, never with content pushed off the
  // printable area.
  const right = Math.min(measuredRight, left);
  const bodyHeight = bodyBands.reduce((n, b) => n + b.height, 0) - top;
  const bottom = Math.max(0, Math.min(top, pageHeight - top - bodyHeight));

  const edits: Edit[] = [
    { start: marginsAttr.start, end: marginsAttr.end, text: `${fmt(left)}, ${fmt(right)}, ${fmt(top)}, ${fmt(bottom)}` },
    { start: topBand.heightAttr.start, end: topBand.heightAttr.end, text: fmt(top) },
    { start: bottomBand.heightAttr.start, end: bottomBand.heightAttr.end, text: fmt(bottom) },
  ];

  if (firstBand.heightAttr) {
    edits.push({ start: firstBand.heightAttr.start, end: firstBand.heightAttr.end, text: fmt(firstBand.height - top) });
  }

  for (const band of bodyBands) {
    const dy = band === firstBand ? top : 0;
    for (const c of band.controls) {
      const nx = c.x - left;
      const ny = c.y - dy;
      if (nx < 0 || ny < 0) return decline('the shift would place a control off the page');
      edits.push({ start: c.loc.start, end: c.loc.end, text: `${fmt(nx)},${fmt(ny)}` });
    }
  }

  // Back to front, so an earlier splice cannot invalidate a later offset.
  edits.sort((a, b) => b.start - a.start);
  let out = xml;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  return {
    xml: out,
    applied: true,
    reason: `lifted ${fmt(left)}/${fmt(right)}/${fmt(top)}/${fmt(bottom)} into margins`,
    margins: { left, right, top, bottom },
  };
}
