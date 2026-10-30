/**
 * Controls that overlap, and the repair DevExpress calls FixLayoutErrors.
 *
 * DevExpress's Report Design Analyzer counts two controls overlapping as a
 * layout error ("when report controls overlap each other or extend beyond the
 * report's printable area"), and its Prompt-to-Report wizard has a
 * `FixLayoutErrors` option that resolves them automatically after the model has
 * written a layout. A model designing from a description, with nothing to
 * measure from, overlaps controls more readily than one reproducing a picture,
 * which is why that option exists there and this module exists here.
 *
 * ## What counts
 *
 * Two siblings in the same `<Controls>` collection whose rectangles overlap by
 * more than one unit on both axes. Siblings only: a panel's children overlap
 * the panel by construction, and a cell has no rectangle. Lines, cross-band
 * lines and boxes, and shapes are left out of both the finding and the repair:
 * a rule under a heading overlaps it by a unit or two on purpose, and a shape
 * is usually the box the text sits in.
 *
 * ## What the repair does
 *
 * The later control (by y, then document order) is moved down to clear the
 * earlier one, the way the designer's own fix does, and the band grows to hold
 * what moved. Nothing is resized or moved sideways; a column that was meant to
 * sit beside another is not the module's to redesign. Coordinates are
 * rewritten through `repxEdit.moveControl`, the same path a drag on the Preview
 * takes, so every other byte of the file survives.
 */
import { parseReportStructure, type PreviewControl } from './reportPreview';
import { moveControl } from './repxEdit';

/** Controls that are drawn over others on purpose, and so never count. */
const DECORATIVE = new Set(['XRLine', 'XRCrossBandLine', 'XRCrossBandBox', 'XRShape']);

/** Overlap below this many units is a touching edge, not a collision. */
const TOLERANCE = 1;
/** The gap left between a moved control and the one above it. */
const GAP = 2;

export interface Overlap {
  band: string;
  /** Band index, control index: the `ControlRef` of each. */
  a: { name: string; type: string; index: number };
  b: { name: string; type: string; index: number };
  /** Units of vertical overlap. */
  depth: number;
}

function rect(c: PreviewControl) {
  return {
    left: c.x + c.offsetX,
    top: c.y + c.offsetY,
    right: c.x + c.offsetX + c.width,
    bottom: c.y + c.offsetY + c.height,
  };
}

function overlapOf(a: PreviewControl, b: PreviewControl): number {
  const ra = rect(a);
  const rb = rect(b);
  const dx = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
  const dy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
  return dx > TOLERANCE && dy > TOLERANCE ? dy : 0;
}

// A hidden control prints nothing, so it can overlap nothing on the page.
const counts = (c: PreviewControl) => c.visible && !DECORATIVE.has(c.type) && c.width > 0 && c.height > 0;

/** Same container: both directly in the band, or both children of the same panel. */
const siblings = (a: PreviewControl, b: PreviewControl) => a.offsetX === b.offsetX && a.offsetY === b.offsetY;

/** Every overlapping pair, in band order. Never throws; an unparseable document has none. */
export function findOverlaps(xml: string | null | undefined): Overlap[] {
  const out: Overlap[] = [];
  const structure = parseReportStructure(xml ?? '');
  for (const band of structure.bands) {
    const cs = band.controls;
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i];
        const b = cs[j];
        if (!counts(a) || !counts(b) || !siblings(a, b)) continue;
        const depth = overlapOf(a, b);
        if (depth > 0) {
          out.push({
            band: band.name || band.kind,
            a: { name: a.name, type: a.type, index: i },
            b: { name: b.name, type: b.type, index: j },
            depth,
          });
        }
      }
    }
  }
  return out;
}

export interface OverlapResult {
  xml: string;
  applied: boolean;
  /** How many controls were moved down. */
  moved: number;
  /** How many bands were made taller to hold them. */
  grown: number;
  reason: string;
}

/**
 * Move overlapping controls apart, then grow any band its controls now exceed.
 *
 * Bounded: each pass moves every lower member of an overlapping pair, and the
 * loop stops when a pass moves nothing or after `maxPasses`. A layout that
 * keeps overlapping after that is reported as unresolved rather than looped on.
 */
export function resolveOverlaps(xml: string | null | undefined, maxPasses = 8): OverlapResult {
  let current = xml ?? '';
  if (!current.trim()) return { xml: current, applied: false, moved: 0, grown: 0, reason: 'no REPX to repair' };

  let moved = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const structure = parseReportStructure(current);
    let movedThisPass = 0;

    for (let bandIndex = 0; bandIndex < structure.bands.length; bandIndex++) {
      const cs = structure.bands[bandIndex].controls;
      // The lower control of each pair moves; resolved from the top down so a
      // control pushed down by one neighbour is measured against the next in
      // the same pass.
      const order = cs.map((_, i) => i).filter((i) => counts(cs[i])).sort((i, j) => cs[i].y + cs[i].offsetY - (cs[j].y + cs[j].offsetY) || i - j);
      for (let p = 0; p < order.length; p++) {
        for (let q = p + 1; q < order.length; q++) {
          const a = cs[order[p]];
          const b = cs[order[q]];
          if (!siblings(a, b)) continue;
          if (overlapOf(a, b) === 0) continue;
          const newY = a.y + a.height + GAP;
          const edit = moveControl(current, { band: bandIndex, control: order[q] }, b.x, newY);
          if (!edit.applied) continue;
          current = edit.xml;
          movedThisPass += 1;
          // The structure is stale after an edit; restart this band's pass.
          p = order.length;
          break;
        }
      }
      if (movedThisPass) break;
    }

    moved += movedThisPass;
    if (!movedThisPass) break;
  }

  // Grow bands whose contents now extend past them.
  let grown = 0;
  const after = parseReportStructure(current);
  for (const band of after.bands) {
    const bottom = band.controls.reduce((max, c) => Math.max(max, c.y + c.offsetY + c.height), 0);
    if (bottom > band.height + 0.5 && band.name) {
      const pattern = new RegExp(`(<Item\\d+\\b[^>]*ControlType="\\w+Band"[^>]*\\sName="${band.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*\\sHeightF=")[^"]*(")`);
      const next = current.replace(pattern, `$1${Math.ceil(bottom)}$2`);
      if (next !== current) {
        current = next;
        grown += 1;
      }
    }
  }

  const remaining = findOverlaps(current).length;
  const reason = moved
    ? `moved ${moved} control(s) down${grown ? ` and grew ${grown} band(s)` : ''}${remaining ? `; ${remaining} overlap(s) remain` : ''}`
    : 'no overlapping controls';
  return { xml: current, applied: moved > 0 || grown > 0, moved, grown, reason };
}
