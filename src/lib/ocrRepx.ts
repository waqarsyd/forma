/**
 * A detected OCR layout written as a DevExpress .repx (2026-11-01): every
 * table an XRTable and every other text an XRLabel, where the page printed
 * it, and every page after the first behind an XRPageBreak.
 *
 * The file is written the way DevExpress's serializer writes one, then put
 * through the same passes as a generated report: unique `Ref`s, a `Dpi` on
 * every element, and `PaperKind` for its paper, so it opens in the designer on
 * the right page and at the right scale. `validateOcrRepx` asks the questions
 * the app can ask before export: does it parse as a report (`checkRepx`), and
 * does the audit find an error. Whether DevExpress's own loader keeps every
 * control is `tools/RepxProbe inspect`'s question, which only Windows can ask.
 *
 * All the text is on one Detail band. The report has no data source, so
 * DevExpress prints the Detail band once, which is what a picture of a page
 * is: a fixed layout, not a list of records.
 */
import { ensureUniqueRefs } from './repxRefs';
import { repairDpi } from './repxDpi';
import { repairPaper } from './repxPaper';
import { checkRepx } from './repx';
import { auditRepx } from './repxAudit';
import type { DetectedLayout, DetectedText } from './ocrLayout';

const attr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r?\n/g, '&#xD;&#xA;');
const n = (v: number) => String(Math.round(v * 100) / 100);

export interface OcrRepxOptions {
  /** The report's name. */
  name?: string;
  /** Leave out text holding a word below the confidence threshold. */
  dropFlagged?: boolean;
}

/**
 * The .repx for `layout`. A label or cell with a low-confidence word is named
 * `lowConfidence…` rather than `ocr…`, so it can be found in the designer's
 * report explorer, unless `dropFlagged` leaves it out.
 */
export function layoutToRepx(layout: DetectedLayout, options: OcrRepxOptions = {}): string {
  const first = layout.pages[0];
  const margins = first?.margins ?? { left: 50, right: 50, top: 50, bottom: 50 };
  const page = first ?? { width: 850, height: 1100 };
  let ref = 0;
  const next = () => ++ref;
  let labelCount = 0;
  let tableCount = 0;
  const keep = (t: DetectedText | null): t is DetectedText => !!t && !(options.dropFlagged && t.flagged);
  const nameOf = (t: DetectedText, base: string, k: number) => `${t.flagged ? 'lowConfidence' : 'ocr'}${base}${k}`;
  const font = (size: number) => `Arial, ${n(size)}pt`;

  const controls: string[] = [];
  let offset = 0;
  layout.pages.forEach((p, index) => {
    // Each page after the first starts at a page break, at the bottom of the
    // page before's content area.
    if (index > 0) controls.push(`<Item${controls.length + 1} Ref="${next()}" ControlType="XRPageBreak" Name="pageBreak${index}" LocationFloat="0,${n(offset)}" />`);
    const ox = p.margins.left;
    const oy = p.margins.top - offset;
    for (const label of p.labels.filter(keep)) {
      const k = ++labelCount;
      // A little wider than the text measured, so a face DevExpress draws a
      // touch wider than the source does not wrap or clip it.
      const w = label.w * 1.08 + 4;
      const h = label.h;
      controls.push(
        `<Item${controls.length + 1} Ref="${next()}" ControlType="XRLabel" Name="${nameOf(label, 'Label', k)}" Text="${attr(label.text)}"` +
          ` TextAlignment="TopLeft" WordWrap="false" CanGrow="false" Padding="0,0,0,0,100"` +
          ` LocationFloat="${n(label.x - ox)},${n(label.y - oy)}" SizeF="${n(w)},${n(h)}" Font="${font(label.fontSize)}" />`,
      );
    }
    for (const table of p.tables) {
      const t = ++tableCount;
      const width = table.columns.reduce((s, w) => s + w, 0);
      const height = table.rows.reduce((s, r) => s + r.h, 0);
      const rows = table.rows.map((row, r) => {
        const cells = table.columns.map((w, c) => {
          const cell = row.cells[c];
          const text = keep(cell) ? cell.text : '';
          const size = cell?.fontSize ?? 9;
          const name = cell ? nameOf(cell, `Table${t}Cell`, r * table.columns.length + c + 1) : `ocrTable${t}Cell${r * table.columns.length + c + 1}`;
          return `<Item${c + 1} Ref="${next()}" ControlType="XRTableCell" Name="${name}" Text="${attr(text)}" Weight="${n(w)}" Font="${font(size)}" Padding="2,2,0,0,100" />`;
        });
        return `<Item${r + 1} Ref="${next()}" ControlType="XRTableRow" Name="ocrTable${t}Row${r + 1}" Weight="${n(row.h)}"><Cells>${cells.join('')}</Cells></Item${r + 1}>`;
      });
      controls.push(
        `<Item${controls.length + 1} Ref="${next()}" ControlType="XRTable" Name="ocrTable${t}"` +
          ` LocationFloat="${n(table.x - ox)},${n(table.y - oy)}" SizeF="${n(width)},${n(height)}"><Rows>${rows.join('')}</Rows></Item${controls.length + 1}>`,
      );
    }
    offset += p.height - p.margins.top - p.margins.bottom;
  });

  const detailHeight = Math.max(1, offset);
  const xml =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    `<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a"` +
    ` Name="${attr(options.name || 'OcrReport')}" ReportUnit="${layout.unit}" Margins="${n(margins.left)}, ${n(margins.right)}, ${n(margins.top)}, ${n(margins.bottom)}"` +
    ` PageWidth="${n(page.width)}" PageHeight="${n(page.height)}" Version="20.1" Font="Arial, 9pt">` +
    '<Bands>' +
    `<Item1 Ref="${next()}" ControlType="TopMarginBand" Name="TopMargin" HeightF="${n(margins.top)}" />` +
    `<Item2 Ref="${next()}" ControlType="DetailBand" Name="Detail" HeightF="${n(detailHeight)}"><Controls>${controls.join('')}</Controls></Item2>` +
    `<Item3 Ref="${next()}" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="${n(margins.bottom)}" />` +
    '</Bands></XtraReportsLayoutSerializer>';

  let out = xml;
  for (const pass of [ensureUniqueRefs, repairDpi, repairPaper]) {
    const result = pass(out);
    if (result.applied) out = result.xml;
  }
  return out;
}

/** What the app can tell about a written file before export: whether it opens, and the audit's errors. */
export function validateOcrRepx(xml: string): { ok: boolean; problems: string[] } {
  const check = checkRepx(xml);
  const audit = auditRepx(xml);
  const errors = audit.findings.filter((f) => f.severity === 'error').map((f) => f.message);
  const problems = [...(check.ok ? [] : [check.message || 'The file does not parse as a report.']), ...errors];
  return { ok: check.ok && errors.length === 0, problems };
}
