/**
 * What DevExpress printed, as Forma's box reader is scored and trained on it
 * (2026-11-04): each printed text's band and role, from the control that
 * printed it. Shared by realScore.ts, which scores the reader on the
 * company's reports printed by DevExpress, and printed.ts, which prints
 * training pages from skeletons, so the two read a print the same way.
 *
 * A printed text's truth is its control's band and its role as `skeletonOf`
 * assigns it: a bound value, a total, a caption, a title, page information.
 * A table cell's name comes from the file, in the order the parser reads the
 * cells.
 */
import { READER_BANDS, type ReaderBand, type ReaderRole } from '../../src/lib/boxReader';
import { parseReportStructure } from '../../src/lib/reportPreview';
import { skeletonOf } from '../../src/lib/reportSkeleton';

export interface Truth {
  band: ReaderBand;
  role: ReaderRole | 'decoration';
}

/** A brick as `RepxProbe render` writes it into render.json. */
export interface Brick {
  d: number;
  r: [number, number, number, number];
  owner?: string;
  text?: string;
}

/** Every named control's and table cell's band and role, the fields the report binds, the fields it groups by, and its data member. */
export function truthOf(xml: string): { names: Map<string, Truth>; fields: string[]; groups: string[]; member: string | null } {
  const s = parseReportStructure(xml);
  const k = skeletonOf(s);
  const names = new Map<string, Truth>();
  const bandOf = (kind: string): ReaderBand => ((READER_BANDS as readonly string[]).includes(kind) ? (kind as ReaderBand) : kind === 'DetailReport' ? 'Detail' : 'ReportFooter');
  const fields = new Set<string>();
  const groups: string[] = [];
  s.bands.forEach((b, bi) => {
    const visible = b.controls.filter((c) => c.visible);
    for (const f of b.fields ?? []) if (f.field && b.kind === 'GroupHeader') groups.push(f.field);
    visible.forEach((c, ci) => {
      const sk = k.bands[bi]?.controls[ci];
      if (!sk) return;
      if (c.field) fields.add(c.field);
      names.set(c.name, { band: bandOf(b.kind), role: sk.role as Truth['role'] });
      if (sk.kind === 'table' && sk.rows) {
        // The cells' names, in file order, beside the parser's cells in the same order.
        const table = new RegExp(`Name="${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?<Rows>([\\s\\S]*?)</Rows>`).exec(xml);
        const cellNames = table ? [...table[1].matchAll(/ControlType="XRTableCell"[^>]*?Name="([^"]+)"/g)].map((m) => m[1]) : [];
        let n = 0;
        c.rows.forEach((row, ri) =>
          row.cells.forEach((cell, ki) => {
            if (cell.field) fields.add(cell.field);
            const name = cellNames[n++];
            const role = sk.rows![ri]?.[ki]?.role;
            if (name && role) names.set(name, { band: bandOf(b.kind), role: role as Truth['role'] });
          }),
        );
      }
    });
  });
  const member = /<XtraReportsLayoutSerializer[^>]*\bDataMember="([^"]*)"/.exec(xml)?.[1] ?? null;
  return { names, fields: [...fields], groups, member };
}

/**
 * Every brick with its rectangle made absolute. A brick's `r` is relative to
 * its parent's (the page's content area, a table, a row), and render.json
 * lists them depth first, so a brick's parent is the last one listed a level
 * up. Units are DevExpress's document units, 1/300 inch.
 */
export function absolute(bricks: readonly Brick[]): Brick[] {
  const origin: [number, number][] = [];
  return bricks.map((b) => {
    const [px, py] = b.d > 0 ? origin[b.d - 1] ?? [0, 0] : [0, 0];
    const r: Brick['r'] = [px + b.r[0], py + b.r[1], b.r[2], b.r[3]];
    origin[b.d] = [r[0], r[1]];
    return { ...b, r };
  });
}
