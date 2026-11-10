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
 * All the text is on the ReportHeader band, which prints once whatever the
 * data: a picture of a page is a fixed layout, not a list of records. It was
 * on the Detail band until the Preview, which repeats Detail for the records
 * it previews, printed a two-page scan four times over. `RepxProbe render`
 * printed the two the same (2026-11-01): a band carrying both pages, broken
 * where the first ends, prints them as two pages with every text in place. An
 * empty Detail band stays, since DevExpress expects one.
 *
 * `layoutToReport` writes the same controls as the layout JSON the Mockup
 * draws, and `ocrSummary` the spec, so a report built from OCR fills every
 * pane a generated one does. All three read `ocrControls`, so they agree.
 */
import { ensureUniqueRefs } from './repxRefs';
import { repairDpi } from './repxDpi';
import { repairPaper } from './repxPaper';
import { checkRepx } from './repx';
import { auditRepx } from './repxAudit';
import { pointsToUnits } from './reportGeometry';
import { lineWidthPt } from './textMeasure';
import type { DetectedLayout, DetectedText } from './ocrLayout';
import type { ReportElement, ReportLayout } from './reportTypes';

const attr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r?\n/g, '&#xD;&#xA;');
const n = (v: number) => String(Math.round(v * 100) / 100);
const round2 = (v: number) => Math.round(v * 100) / 100;

/** A report Name DevExpress accepts: letters, digits and underscores, not starting with a digit. */
export function reportNameFor(file: string): string {
  const base = file.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]+/g, '');
  return /^[A-Za-z_]/.test(base) ? base : `Ocr${base}`;
}

export interface OcrRepxOptions {
  /** The report's name. */
  name?: string;
  /** Leave out text holding a word below the confidence threshold. */
  dropFlagged?: boolean;
}

interface OcrText {
  name: string;
  text: string;
  fontSize: number;
  flagged: boolean;
}

/** A control the layout becomes, in its page's band coordinates: from the page's margins. */
export type OcrControl =
  | (OcrText & { kind: 'label'; x: number; y: number; w: number; h: number })
  | { kind: 'table'; name: string; x: number; y: number; columns: number[]; rows: { name: string; h: number; cells: OcrText[] }[] };

/**
 * The controls of every page, a list per page. A label or cell with a
 * low-confidence word is named `lowConfidence…` rather than `ocr…`, so it can
 * be found in the designer's report explorer, unless `dropFlagged` leaves it
 * out; a table keeps its cell, empty, so its columns do not shift.
 */
export function ocrControls(layout: DetectedLayout, options: Pick<OcrRepxOptions, 'dropFlagged'> = {}): OcrControl[][] {
  let labelCount = 0;
  let tableCount = 0;
  const keep = (t: DetectedText | null): t is DetectedText => !!t && !(options.dropFlagged && t.flagged);
  const nameOf = (t: DetectedText, base: string, k: number) => `${t.flagged ? 'lowConfidence' : 'ocr'}${base}${k}`;
  // The text's width in Arial, the face the report names. A scan's own face is
  // often narrower, s54a's serif among them, and a label that does not grow
  // clips what does not fit, as the Preview showed. Where nothing can measure,
  // in Node, six tenths of the em a character is wide enough for Arial.
  const inArial = (text: string, sizePt: number) =>
    pointsToUnits(lineWidthPt(text, { family: 'Arial', sizePt, bold: false, italic: false }) ?? text.length * 0.6 * sizePt, layout.unit);
  return layout.pages.map((p) => {
    const ox = p.margins.left;
    const oy = p.margins.top;
    const out: OcrControl[] = [];
    for (const label of p.labels.filter(keep)) {
      const k = ++labelCount;
      out.push({
        kind: 'label',
        name: nameOf(label, 'Label', k),
        text: label.text,
        fontSize: label.fontSize,
        flagged: label.flagged,
        x: label.x - ox,
        y: label.y - oy,
        // As wide as the text was seen, or as it prints in Arial, whichever is
        // wider, and a little more, so nothing is clipped.
        w: Math.max(label.w * 1.08, inArial(label.text, label.fontSize) * 1.04) + 4,
        h: label.h,
      });
    }
    for (const table of p.tables) {
      const t = ++tableCount;
      out.push({
        kind: 'table',
        name: `ocrTable${t}`,
        x: table.x - ox,
        y: table.y - oy,
        columns: table.columns,
        rows: table.rows.map((row, r) => ({
          name: `ocrTable${t}Row${r + 1}`,
          h: row.h,
          cells: table.columns.map((_, c) => {
            const cell = row.cells[c];
            const k = r * table.columns.length + c + 1;
            return {
              name: cell ? nameOf(cell, `Table${t}Cell`, k) : `ocrTable${t}Cell${k}`,
              text: keep(cell) ? cell.text : '',
              fontSize: cell?.fontSize ?? 9,
              flagged: !!cell?.flagged && keep(cell),
            };
          }),
        })),
      });
    }
    return out;
  });
}

/** The .repx for `layout`, every page's controls on the one ReportHeader band. */
export function layoutToRepx(layout: DetectedLayout, options: OcrRepxOptions = {}): string {
  const first = layout.pages[0];
  const margins = first?.margins ?? { left: 50, right: 50, top: 50, bottom: 50 };
  const page = first ?? { width: 850, height: 1100 };
  let ref = 0;
  const next = () => ++ref;
  const font = (size: number) => `Arial, ${n(size)}pt`;

  const controls: string[] = [];
  let offset = 0;
  const pages = ocrControls(layout, options);
  layout.pages.forEach((p, index) => {
    // Each page after the first starts at a page break, at the bottom of the
    // page before's content area.
    if (index > 0) controls.push(`<Item${controls.length + 1} Ref="${next()}" ControlType="XRPageBreak" Name="pageBreak${index}" LocationFloat="0,${n(offset)}" />`);
    for (const c of pages[index]) {
      const item = `Item${controls.length + 1}`;
      if (c.kind === 'label') {
        controls.push(
          `<${item} Ref="${next()}" ControlType="XRLabel" Name="${c.name}" Text="${attr(c.text)}"` +
            ` TextAlignment="TopLeft" WordWrap="false" CanGrow="false" Padding="0,0,0,0,100"` +
            ` LocationFloat="${n(c.x)},${n(c.y + offset)}" SizeF="${n(c.w)},${n(c.h)}" Font="${font(c.fontSize)}" />`,
        );
        continue;
      }
      const width = c.columns.reduce((s, w) => s + w, 0);
      const height = c.rows.reduce((s, r) => s + r.h, 0);
      const rows = c.rows.map((row, r) => {
        const cells = row.cells.map(
          (cell, k) =>
            `<Item${k + 1} Ref="${next()}" ControlType="XRTableCell" Name="${cell.name}" Text="${attr(cell.text)}" Weight="${n(c.columns[k])}" Font="${font(cell.fontSize)}" Padding="2,2,0,0,100" />`,
        );
        return `<Item${r + 1} Ref="${next()}" ControlType="XRTableRow" Name="${row.name}" Weight="${n(row.h)}"><Cells>${cells.join('')}</Cells></Item${r + 1}>`;
      });
      controls.push(
        `<${item} Ref="${next()}" ControlType="XRTable" Name="${c.name}"` +
          ` LocationFloat="${n(c.x)},${n(c.y + offset)}" SizeF="${n(width)},${n(height)}"><Rows>${rows.join('')}</Rows></${item}>`,
      );
    }
    offset += p.height - p.margins.top - p.margins.bottom;
  });

  const headerHeight = Math.max(1, offset);
  const xml =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    `<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a"` +
    ` Name="${attr(options.name || 'OcrReport')}" ReportUnit="${layout.unit}" Margins="${n(margins.left)}, ${n(margins.right)}, ${n(margins.top)}, ${n(margins.bottom)}"` +
    ` PageWidth="${n(page.width)}" PageHeight="${n(page.height)}" Version="20.1" Font="Arial, 9pt">` +
    '<Bands>' +
    `<Item1 Ref="${next()}" ControlType="TopMarginBand" Name="TopMargin" HeightF="${n(margins.top)}" />` +
    `<Item2 Ref="${next()}" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="${n(headerHeight)}"><Controls>${controls.join('')}</Controls></Item2>` +
    `<Item3 Ref="${next()}" ControlType="DetailBand" Name="Detail" HeightF="0" />` +
    `<Item4 Ref="${next()}" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="${n(margins.bottom)}" />` +
    '</Bands></XtraReportsLayoutSerializer>';

  let out = xml;
  for (const pass of [ensureUniqueRefs, repairDpi, repairPaper]) {
    const result = pass(out);
    if (result.applied) out = result.xml;
  }
  return out;
}

/**
 * The same controls as the layout JSON the Mockup draws: a section per page,
 * each element in its section's coordinates. A layout's `fontSize` is in
 * report units, not points, as the prompt asks of the model.
 */
export function layoutToReport(layout: DetectedLayout, options: Pick<OcrRepxOptions, 'dropFlagged'> & { title?: string } = {}): ReportLayout {
  const pages = ocrControls(layout, options);
  const size = (pt: number) => round2(pointsToUnits(pt, layout.unit));
  return {
    title: options.title || 'Report read from the page',
    pageWidth: layout.pages[0]?.width ?? 850,
    sections: layout.pages.map((p, i) => ({
      id: `ocr-page-${i + 1}`,
      name: layout.pages.length > 1 ? `Report header, page ${i + 1}` : 'Report header',
      type: 'header' as const,
      height: round2(p.height - p.margins.top - p.margins.bottom),
      elements: pages[i].map((c): ReportElement =>
        c.kind === 'label'
          ? { id: c.name, type: 'label', content: c.text, x: round2(c.x), y: round2(c.y), width: round2(c.w), height: round2(c.h), fontSize: size(c.fontSize), wrap: false }
          : {
              id: c.name,
              type: 'table',
              content: '',
              x: round2(c.x),
              y: round2(c.y),
              width: round2(c.columns.reduce((s, w) => s + w, 0)),
              height: round2(c.rows.reduce((s, r) => s + r.h, 0)),
              fontSize: size(c.rows[0]?.cells[0]?.fontSize ?? 9),
              rows: c.rows.map((r) => ({ weight: round2(r.h), cells: r.cells.map((cell, k) => ({ content: cell.text, weight: round2(c.columns[k]) })) })),
            },
      ),
    })),
  };
}

/**
 * The spec pane's markdown for a report built from OCR: what was found, and
 * every text the engine was unsure of, to check against the source.
 */
export function ocrSummary(layout: DetectedLayout, options: Pick<OcrRepxOptions, 'dropFlagged'> & { title?: string } = {}): string {
  const pages = ocrControls(layout, options);
  const labels = pages.flat().filter((c) => c.kind === 'label').length;
  const tables = pages.flat().filter((c) => c.kind === 'table').length;
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const out = [
    `# ${options.title || 'Report read from the page'}`,
    '',
    `Built from the text of ${plural(layout.pages.length, 'page')} read by OCR in the browser, with no model involved: ` +
      `${plural(labels, 'label')} and ${plural(tables, 'table')}, on the report header${layout.pages.length > 1 ? ', a page break before each page after the first' : ''}.`,
    '',
  ];
  const flagged = layout.pages.flatMap((p, i) =>
    [...p.labels, ...p.tables.flatMap((t) => t.rows.flatMap((r) => r.cells))]
      .filter((t): t is DetectedText => !!t && t.flagged)
      .map((t) => ({ page: i + 1, t })),
  );
  if (flagged.length) {
    out.push(
      options.dropFlagged
        ? `**${plural(flagged.length, 'text')} held a word read at low confidence and ${flagged.length === 1 ? 'was' : 'were'} left out.** What ${flagged.length === 1 ? 'it' : 'they'} read, to add by hand if needed:`
        : `**${plural(flagged.length, 'text')} ${flagged.length === 1 ? 'holds' : 'hold'} a word read at low confidence**, named \`lowConfidence…\` in the report so the designer's report explorer finds ${flagged.length === 1 ? 'it' : 'them'}. Check each against the source:`,
      '',
      '| Page | Text | Confidence |',
      '| --- | --- | --- |',
      ...flagged.map(({ page, t }) => `| ${page} | ${cell(t.text)} | ${Math.round(t.confidence)} |`),
      '',
    );
  } else {
    out.push('Every word was read at or above the confidence threshold.', '');
  }
  if (layout.ignored) {
    out.push(`${plural(layout.ignored, 'reading was', 'readings were')} set aside as pictures, such as a chart's bars or a logo, and ${layout.ignored === 1 ? 'is' : 'are'} not in the report.`, '');
  }
  out.push('Borders, fills, images and charts are not read by OCR. Describe them in the chat, or generate from the same page to have the model draw them.');
  return out.join('\n');
}
/** What the app can tell about a written file before export: whether it opens, and the audit's errors. */
export function validateOcrRepx(xml: string): { ok: boolean; problems: string[] } {
  const check = checkRepx(xml);
  const audit = auditRepx(xml);
  const errors = audit.findings.filter((f) => f.severity === 'error').map((f) => f.message);
  const problems = [...(check.ok ? [] : [check.message || 'The file does not parse as a report.']), ...errors];
  return { ok: check.ok && errors.length === 0, problems };
}
