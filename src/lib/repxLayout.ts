/**
 * Controls and bands that do not fit where they are, asked of a report the way
 * DevExpress's Report Design Analyzer asks it.
 *
 * That analyzer's layout group covers controls that "overlap each other or
 * extend beyond the report's printable area". Overlaps are `repxOverlaps.ts`;
 * this is the other half. Three facts, each computable from the file and each
 * with a consequence the designer applies silently:
 *
 * - a control past the printable width -- the page less BOTH side margins,
 *   since band coordinates start at the left margin -- is clipped at the right
 *   margin when printed, and the clipped part is printed on an EXTRA page.
 *   Measured with `RepxProbe render` on 2026-10-30: a control reaching only
 *   into the right margin turned a one-page report into two, exactly as one
 *   past the page edge did. This compared against the whole page width until
 *   then, so it missed every control in the margin;
 * - a control past the bottom of its band makes the designer push the band
 *   taller on load, or drop the control onto a second page -- which is what
 *   the Preview's selection readout says when a drag causes it, and nothing
 *   said when a generation did;
 * - a band taller than the usable page can never fit, so it paginates one
 *   record per sheet, the "page-height Detail band" that the Preview was built
 *   to expose.
 *
 * All three are warnings: the file opens and prints, wrongly. One finding per
 * kind per report, with the first few names, like the accessibility checks.
 */
import { parseReportStructure, type PreviewControl } from './reportPreview';
import type { RepxFinding } from './repxAudit';

/** Under this many units past an edge is rounding, not a defect. */
const TOLERANCE = 1;

function names(cs: { name: string; type: string }[]): string {
  return cs.slice(0, 4).map((c) => c.name || c.type).join(', ') + (cs.length > 4 ? ', …' : '');
}

export function auditLayoutBounds(xml: string | null | undefined): RepxFinding[] {
  const text = xml ?? '';
  if (!text.trim()) return [];
  const structure = parseReportStructure(text);
  const findings: RepxFinding[] = [];

  const printableWidth = structure.page.width - structure.margins.left - structure.margins.right;
  const usableHeight = structure.page.height - structure.margins.top - structure.margins.bottom;

  const offPage: PreviewControl[] = [];
  const belowBand: PreviewControl[] = [];
  const tallBands: string[] = [];

  for (const band of structure.bands) {
    if (band.kind === 'TopMargin' || band.kind === 'BottomMargin') continue;
    if (band.height > usableHeight + TOLERANCE) tallBands.push(band.name || band.kind);
    for (const c of band.controls) {
      // Cells have no rectangle; everything else does. A hidden control prints
      // nothing, so it cannot run off the page or out of its band.
      if (c.width <= 0 && c.height <= 0) continue;
      if (!c.visible) continue;
      const left = c.x + c.offsetX;
      const right = left + c.width;
      const bottom = c.y + c.offsetY + c.height;
      if (left < -TOLERANCE || right > printableWidth + TOLERANCE) offPage.push(c);
      if (bottom > band.height + TOLERANCE) belowBand.push(c);
    }
  }

  if (offPage.length) {
    findings.push({
      severity: 'warning',
      code: 'control-outside-page',
      message:
        `${offPage.length} control(s) extend past the ${Math.round(printableWidth)}-unit printable width, the page less its side margins — ${names(offPage)}. ` +
        'DevExpress clips them at the right margin and prints the clipped part on an extra page; its design analyzer reports the same.',
    });
  }

  if (belowBand.length) {
    findings.push({
      severity: 'warning',
      code: 'control-below-band',
      message:
        `${belowBand.length} control(s) extend past the bottom of their band — ${names(belowBand)}. ` +
        'The designer pushes the band taller on load or drops the control onto the next page, so the layout prints differently from how it was drawn.',
    });
  }

  if (tallBands.length) {
    findings.push({
      severity: 'warning',
      code: 'band-taller-than-page',
      message:
        `${tallBands.join(', ')} ${tallBands.length === 1 ? 'is' : 'are'} taller than the usable page (${Math.round(usableHeight)} units). ` +
        'A band that cannot fit prints one record per sheet, which is what the Preview shows for it.',
    });
  }

  return findings;
}
