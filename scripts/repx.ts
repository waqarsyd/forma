/**
 * Forma's REPX knowledge from a command line (2026-11-11, the full audit's
 * CP-12), for a person or a coding assistant working on a report outside the
 * web app.
 *
 *   npx tsx scripts/repx.ts audit  <file.repx>            what is still wrong, one finding a line
 *   npx tsx scripts/repx.ts repair <file.repx> [out.repx]  every repair Forma makes, then the audit
 *   npx tsx scripts/repx.ts pdf    <file.repx> [out.pdf]   the report's pages as Forma lays them out
 *
 * `audit` exits 1 when an error is found, so it can gate a build. `repair`
 * runs `repairRepx`, the chain the generation runs (src/lib/repairChain.ts),
 * and writes `<name>.repaired.repx` beside the input unless told where.
 * `pdf` lays the report out with the Preview's own engine (`paginate`, with
 * no data: every field prints its name's place, as the Preview's first view
 * does) and writes it with Forma's PDF writer in the standard fonts. It is a
 * draft for checking where things fall, not the Preview's PDF export, which
 * draws from the browser's own pages and fonts.
 *
 * What each repair and finding means, and how it was measured against
 * DevExpress, is docs/skills/devexpress-repx/SKILL.md and the gemini.md
 * headings it links.
 *
 * Pure ASCII, as every script here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { repairRepx } from '../src/lib/repairChain';
import { auditRepx } from '../src/lib/repxAudit';
import { paginate, parseReportStructure, type PaginatedReport } from '../src/lib/reportPreview';
import { unitsPerInch } from '../src/lib/reportGeometry';
import { writePdf, type PdfOp, type PdfPage, type StandardFont } from '../src/lib/pdfWriter';

const [command, file, out] = process.argv.slice(2);
const USAGE = 'usage: npx tsx scripts/repx.ts audit|repair|pdf <file.repx> [out]';

/** The serializer version a report names, for the parameter repair; 20.1 when it names none. */
export function versionOf(xml: string): string {
  return /\bSerializerVersion="(\d+\.\d+)/.exec(xml)?.[1] ?? '20.1';
}

/** A file beside the input, its extension replaced. */
const beside = (path: string, suffix: string) => join(dirname(path), `${basename(path, extname(path))}${suffix}`);

/** The standard font a control's family and weight print in. */
function fontOf(family: string | null, bold: boolean, italic: boolean): StandardFont {
  const f = (family ?? '').toLowerCase();
  const base = /times|serif|georgia|garamond/.test(f) && !/sans/.test(f) ? 'Times' : /courier|mono|consol/.test(f) ? 'Courier' : 'Helvetica';
  if (base === 'Times') return bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman';
  const suffix = bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : '';
  return `${base}${suffix}` as StandardFont;
}

/** A laid-out report as pages of drawing operations, in points. */
export function pdfPages(report: PaginatedReport): PdfPage[] {
  const pt = (units: number) => (units / unitsPerInch(report.unit)) * 72;
  const black: [number, number, number] = [0, 0, 0];
  const text = (ops: PdfOp[], x: number, y: number, w: number, value: string, size: number, font: StandardFont, align: string) => {
    const line = value.split(/\r?\n/)[0];
    if (!line) return;
    // An estimate of the line's width, for centred and right-aligned text: half an em a character.
    const width = Math.min(w, line.length * size * 0.5);
    const left = align === 'center' ? x + (w - width) / 2 : align === 'right' ? x + w - width : x;
    ops.push({ kind: 'text', x: left + 1, y: y + size, size, font, colour: black, text: line, scale: 1 });
  };
  const box = (ops: PdfOp[], x: number, y: number, w: number, h: number, sides: { top: boolean; right: boolean; bottom: boolean; left: boolean }) => {
    const line = (x1: number, y1: number, x2: number, y2: number) => ops.push({ kind: 'line', x1, y1, x2, y2, width: 0.5, colour: black });
    if (sides.top) line(x, y, x + w, y);
    if (sides.bottom) line(x, y + h, x + w, y + h);
    if (sides.left) line(x, y, x, y + h);
    if (sides.right) line(x + w, y, x + w, y + h);
  };
  return report.pages.map((page) => {
    const ops: PdfOp[] = [];
    for (const band of page.bands) {
      for (const placed of band.controls) {
        const c = placed.control;
        if (!c.visible) continue;
        const x = pt(band.left + c.x);
        const y = pt(band.top + placed.y);
        const w = pt(c.width);
        const h = pt(placed.height);
        if (c.type === 'XRTable') {
          const heights = placed.rowHeights ?? c.rows.map(() => placed.height / Math.max(1, c.rows.length));
          let top = y;
          c.rows.slice(placed.rowStart, placed.rowStart + heights.length).forEach((row, ri) => {
            const total = row.cells.reduce((sum, cell) => sum + (cell.weight || 1), 0) || 1;
            const rowH = pt(heights[ri] ?? 0);
            let left = x;
            row.cells.forEach((cell, ci) => {
              const cellW = (w * (cell.weight || 1)) / total;
              const value = placed.cellTexts?.[placed.rowStart + ri]?.[ci] ?? cell.text;
              box(ops, left, top, cellW, rowH, cell.borders);
              text(ops, left, top, cellW, value, cell.fontSize ?? 9, fontOf(cell.fontFamily, cell.bold, cell.italic), cell.align);
              left += cellW;
            });
            top += rowH;
          });
          continue;
        }
        box(ops, x, y, w, h, c.borders);
        if (c.type === 'XRLine') {
          ops.push({ kind: 'line', x1: x, y1: y + h / 2, x2: x + w, y2: y + h / 2, width: 1, colour: black });
          continue;
        }
        const value = placed.text ?? (c.field ? `[${c.field}]` : c.text);
        if (value) text(ops, x, y, w, value, c.fontSize ?? 9, fontOf(c.fontFamily, c.bold, c.italic), c.align);
      }
    }
    return { width: pt(report.page.width), height: pt(report.page.height), ops };
  });
}

async function main(): Promise<number> {
  if (!command || !file || !['audit', 'repair', 'pdf'].includes(command)) {
    console.error(USAGE);
    return 2;
  }
  const xml = readFileSync(file, 'utf8');
  if (command === 'audit') {
    const audit = auditRepx(xml);
    for (const f of audit.findings) console.log(`${f.severity.padEnd(7)} ${f.code}: ${f.message}`);
    console.log(audit.summary);
    return audit.errors ? 1 : 0;
  }
  if (command === 'repair') {
    const repaired = repairRepx(xml, { version: versionOf(xml) });
    const target = out ?? beside(file, '.repaired.repx');
    writeFileSync(target, repaired.xml);
    const applied = repaired.steps.filter((s) => s.applied);
    for (const s of applied) console.log(`repaired ${s.name}: ${s.reason}`);
    if (!applied.length) console.log('nothing to repair');
    const audit = auditRepx(repaired.xml);
    console.log(`written: ${target}`);
    console.log(audit.summary);
    return audit.errors ? 1 : 0;
  }
  const structure = parseReportStructure(xml);
  if (!structure.bands.length) {
    console.error('No band could be read from this file.');
    return 1;
  }
  const report = paginate(structure, 5);
  const pages = pdfPages(report);
  const target = out ?? beside(file, '.pdf');
  writeFileSync(target, await writePdf({ title: structure.outlineTitle ?? basename(file), pages }));
  console.log(`written: ${target} (${pages.length} page${pages.length === 1 ? '' : 's'})`);
  for (const p of report.problems) console.log(`note: ${p}`);
  return 0;
}

// Run only as a script, so a test can import the helpers above.
if (process.argv[1] && /repx\.ts$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
