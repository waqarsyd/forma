/**
 * The Mockup, the Spec and the title, read off the REPX instead of written by
 * the AI (2026-11-05).
 *
 * ## Why
 *
 * Until this date every generation asked the AI for three artifacts in one
 * JSON answer: a markdown specification, a `layout` JSON for the Mockup, and
 * the REPX. The first two describe the third. Measured over the fifteen
 * benchmark runs recorded by then, a report cost 34,213 tokens on average,
 * and of what the AI wrote, the layout was 37% and the specification 22%:
 * more than half the answer was two copies of the report the REPX already
 * holds. The owner asked for Forma's own parts to take work off the AI so a
 * report burns fewer tokens, and this is the largest piece of that: the AI
 * writes the REPX, and Forma reads the other two out of it.
 *
 * It also settles a disagreement gemini.md had recorded since 2026-08-29:
 * the layout and the REPX came out of one answer and could disagree about how
 * many bands the report has, with nothing enforcing that they agree. Read off
 * the REPX, the Mockup and the Spec describe the file that is downloaded,
 * always.
 *
 * ## What the Mockup is now
 *
 * The bands as designed, the way a designer shows them: the Detail band holds
 * the ONE row that repeats per record, named so. The AI's layout used to copy
 * up to eight of the source's rows into it (MOCKUP_ROW_CAP), which made the
 * Mockup a picture of the source rather than of the report; the source is the
 * upload itself, and the Preview prints the records once test data is in.
 *
 * Positions follow the Mockup's convention: x from the paper's left edge,
 * y from the top of the section, so the left margin is added to every x and
 * the top margin is carried by the first section. A picture box before the
 * Detail band gets a `box2d` from where it sits on the page, which is where
 * the AI put it from the source, so the Mockup can crop the upload's artwork
 * into it; after the Detail band the page has one row where the source had
 * many, so the position no longer matches the source and none is given.
 */
import { pageInfoText, parseReportStructure, type BandKind, type PreviewBand, type PreviewControl, type ReportStructure } from './reportPreview';
import { pointsToUnits } from './reportGeometry';
import type { ReportCell, ReportElement, ReportLayout, ReportRow, ReportSection } from './reportTypes';
import { connectionStringsSnippet, readRepxDataSources } from './repxSqlDataSource';

const SECTION_TYPE: Record<BandKind, ReportSection['type'] | null> = {
  TopMargin: null,
  BottomMargin: null,
  ReportHeader: 'header',
  PageHeader: 'header',
  GroupHeader: 'group',
  Detail: 'detail',
  DetailReport: 'detail',
  GroupFooter: 'group',
  ReportFooter: 'footer',
  PageFooter: 'footer',
  Unknown: 'detail',
};

const SECTION_NAME: Record<BandKind, string> = {
  TopMargin: 'Top margin',
  BottomMargin: 'Bottom margin',
  ReportHeader: 'Report header',
  PageHeader: 'Page header',
  GroupHeader: 'Group header',
  Detail: 'Detail, once per record',
  DetailReport: 'Detail report',
  GroupFooter: 'Group footer',
  ReportFooter: 'Report footer',
  PageFooter: 'Page footer',
  Unknown: 'Band',
};

const ELEMENT_TYPE: Record<string, ReportElement['type']> = {
  XRTable: 'table',
  XRLine: 'line',
  XRPictureBox: 'image',
  XRChart: 'chart',
  XRSparkline: 'chart',
  XRGauge: 'gauge',
  XRBarCode: 'barcode',
  XRCheckBox: 'checkbox',
};

/** A colour the Mockup can draw: `#rrggbb` or a CSS name, never white or transparent fills. */
function colourOf(value: string | undefined | null): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (/^(transparent|white|#fff(fff)?|255,\s*255,\s*255)$/i.test(v)) return undefined;
  const rgb = /^(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})$/.exec(v);
  if (rgb) return `#${rgb.slice(1).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  const argb = /^#([0-9a-f]{2})([0-9a-f]{6})$/i.exec(v);
  if (argb) return `#${argb[2]}`;
  return v.startsWith('#') || /^[a-z]+$/i.test(v) ? v : undefined;
}

/** What a control or a cell shows: its text, else `[Field]` when it prints a field. */
function shownText(text: string, field: string | null): string {
  return text.trim() || (field ? `[${field}]` : '');
}

function cellOf(cell: PreviewControl['rows'][number]['cells'][number]): ReportCell {
  return {
    content: shownText(cell.text, cell.field),
    weight: cell.weight,
    ...(cell.bold ? { bold: true } : {}),
    textAlign: cell.align,
    ...(colourOf(cell.appearance.ForeColor) ? { color: colourOf(cell.appearance.ForeColor) } : {}),
    ...(colourOf(cell.appearance.BackColor) ? { backgroundColor: colourOf(cell.appearance.BackColor) } : {}),
  };
}

function chartTypeOf(control: PreviewControl): ReportElement['chartType'] {
  const view = control.series[0]?.view ?? '';
  if (/Pie|Doughnut/i.test(view)) return 'pie';
  if (/Area/i.test(view)) return 'area';
  if (/Line|Spline/i.test(view)) return 'line';
  return 'bar';
}

/**
 * One control as a Mockup element. `left` and `top` are where its band's
 * coordinates start on the drawn page; `page` places a picture on the upload.
 */
function elementOf(
  control: PreviewControl,
  id: string,
  structure: ReportStructure,
  left: number,
  top: number,
  pageTop: number | null,
): ReportElement | null {
  if (!control.visible || control.type === 'XRPanel') return null;
  const type = ELEMENT_TYPE[control.type] ?? 'label';
  const x = left + control.offsetX + control.x;
  const y = top + control.offsetY + control.y;
  const a = control.appearance;
  const content =
    control.type === 'XRPageInfo' && control.pageInfo
      ? pageInfoText(control.pageInfo, 1, 1)
      : control.type === 'XRChart'
        ? control.chartText?.titles[0] ?? 'Chart'
        : control.type === 'XRSubreport'
          ? 'Subreport'
          : control.type === 'XRCrossTab'
            ? 'Cross-tab'
            : shownText(control.text, control.field);
  const el: ReportElement = {
    id,
    type,
    content,
    x,
    y,
    width: control.width,
    height: control.height,
    ...(control.fontSize ? { fontSize: Math.round(pointsToUnits(control.fontSize, structure.unit) * 100) / 100 } : {}),
    ...(control.fontFamily ? { fontFamily: control.fontFamily } : {}),
    ...(control.bold ? { bold: true } : {}),
    ...(control.italic ? { italic: true } : {}),
    textAlign: control.align,
    verticalAlign: control.vAlign,
    ...(control.wordWrap && control.canGrow ? { wrap: true } : {}),
    ...(colourOf(a.ForeColor) ? { color: colourOf(a.ForeColor) } : {}),
    ...(colourOf(a.BackColor) ? { backgroundColor: colourOf(a.BackColor) } : {}),
    ...(control.borders.top ? { borderTop: true } : {}),
    ...(control.borders.right ? { borderRight: true } : {}),
    ...(control.borders.bottom ? { borderBottom: true } : {}),
    ...(control.borders.left ? { borderLeft: true } : {}),
    ...(colourOf(a.BorderColor) ? { borderColor: colourOf(a.BorderColor) } : {}),
  };
  if (type === 'table') {
    el.rows = control.rows.map((row, r): ReportRow => ({ cells: row.cells.map(cellOf), ...(r === 0 && control.rows.length > 1 && row.cells.every((c) => c.bold) ? { isHeader: true } : {}) }));
  }
  if (type === 'chart') {
    el.chartType = chartTypeOf(control);
    if (control.chartText?.titles[0]) el.chartTitle = control.chartText.titles[0];
    if (control.chartText?.axisX) el.chartXTitle = control.chartText.axisX;
    if (control.chartText?.axisY) el.chartYTitle = control.chartText.axisY;
  }
  if (type === 'checkbox' && control.checkState === 'checked') el.checked = true;
  if (type === 'image' && pageTop !== null && structure.page.width > 0 && structure.page.height > 0) {
    const permille = (v: number, of: number) => Math.max(0, Math.min(1000, Math.round((v / of) * 1000)));
    const py = pageTop + control.offsetY + control.y;
    el.box2d = [permille(py, structure.page.height), permille(x, structure.page.width), permille(py + control.height, structure.page.height), permille(x + control.width, structure.page.width)];
  }
  return el;
}

/** The content bands in print order, a detail report's own bands after its band. */
function contentBands(bands: readonly PreviewBand[]): PreviewBand[] {
  const out: PreviewBand[] = [];
  for (const band of bands) {
    if (!SECTION_TYPE[band.kind]) continue;
    if (band.kind === 'DetailReport' && band.sub) out.push(...contentBands(band.sub.bands));
    else out.push(band);
  }
  return out;
}

/**
 * The Mockup's layout, from the REPX. The title is the caller's, normally
 * `reportTitleOf` the same document.
 */
export function layoutFromRepx(xml: string | undefined | null, title = reportTitleOf(xml)): ReportLayout {
  const structure = parseReportStructure(xml);
  const bands = contentBands(structure.bands);
  const sections: ReportSection[] = [];
  // Where the next band starts on the page, for placing pictures on the upload;
  // null from the Detail band on, where the page stops matching the source.
  let pageTop: number | null = structure.margins.top;
  bands.forEach((band, b) => {
    const first = b === 0;
    const top = first ? structure.margins.top : 0;
    if (band.kind === 'Detail' || band.kind === 'DetailReport') pageTop = null;
    const elements = band.controls
      .map((control, c) => elementOf(control, `b${b}-c${c}`, structure, structure.margins.left, top, pageTop))
      .filter((el): el is ReportElement => el !== null);
    sections.push({ id: `section-${b + 1}`, name: SECTION_NAME[band.kind], type: SECTION_TYPE[band.kind] ?? 'detail', height: band.height + top, elements });
    if (pageTop !== null) pageTop += band.height;
  });
  return { title, pageWidth: structure.page.width, sections };
}

/**
 * The report's title: the `DisplayName` the AI is asked to write on the
 * report, else its largest text before the Detail band, else its `Name`.
 */
export function reportTitleOf(xml: string | undefined | null): string {
  const text = xml ?? '';
  const root = /<XtraReportsLayoutSerializer\b([^>]*)>/.exec(text)?.[1] ?? '';
  const attr = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(root)?.[1]?.trim() ?? '';
  const display = attr('DisplayName');
  if (display) return decode(display);
  const structure = parseReportStructure(text);
  let best: { text: string; size: number } | null = null;
  for (const band of structure.bands) {
    if (band.kind === 'Detail' || band.kind === 'DetailReport') break;
    for (const c of band.controls) {
      const t = c.text.trim();
      if (!c.visible || c.type !== 'XRLabel' || !t || c.field) continue;
      const size = c.fontSize ?? 0;
      if (!best || size > best.size) best = { text: t, size };
    }
  }
  if (best) return best.text;
  return decode(attr('Name')) || 'Report';
}

function decode(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const round = (v: number) => Math.round(v * 10) / 10;

function fontText(c: { fontFamily: string | null; fontSize: number | null; bold: boolean; italic: boolean }): string {
  const parts = [c.fontFamily, c.fontSize ? `${round(c.fontSize)}pt` : null, c.bold ? 'bold' : null, c.italic ? 'italic' : null].filter(Boolean);
  return parts.join(' ');
}

function controlLine(control: PreviewControl): string | null {
  if (!control.visible || control.type === 'XRPanel') return null;
  const where = `at ${round(control.offsetX + control.x)}, ${round(control.offsetY + control.y)}, ${round(control.width)} x ${round(control.height)}`;
  const font = fontText(control);
  const total = control.data.expression && /\b(sum|count|avg|min|max)\w*\(/i.test(control.data.expression)
    ? `, a total: ${control.data.expression}${control.data.running ? ` over the ${control.data.running.toLowerCase()}` : ''}`
    : '';
  const format = control.data.format ? `, formatted ${JSON.stringify(control.data.format)}` : '';
  switch (control.type) {
    case 'XRTable': {
      const rows = control.rows.map((row) => row.cells.map((c) => shownText(c.text, c.field) || '(empty)').join(' | '));
      const cellFont = control.rows[0]?.cells[0] ? fontText(control.rows[0].cells[0]) : '';
      return `- A table of ${control.rows[0]?.cells.length ?? 0} column(s) and ${control.rows.length} row(s) ${where}${cellFont ? `, ${cellFont}` : ''}:\n${rows.map((r) => `  - ${r}`).join('\n')}`;
    }
    case 'XRPageInfo':
      return `- Page information ${JSON.stringify(control.pageInfo ? pageInfoText(control.pageInfo, 1, 2) : '')} ${where}`;
    case 'XRLine':
      return `- A line ${where}`;
    case 'XRPictureBox':
      return `- A picture ${where}`;
    case 'XRChart': {
      const series = control.series.map((s) => `${s.value || '?'} by ${s.argument || '?'}`).join('; ');
      return `- A ${chartTypeOf(control)} chart${control.chartText?.titles[0] ? ` titled ${JSON.stringify(control.chartText.titles[0])}` : ''} ${where}${series ? `, plotting ${series}` : ''}`;
    }
    case 'XRCheckBox':
      return `- A check box ${JSON.stringify(control.text.trim())} ${where}`;
    case 'XRBarCode':
      return `- A barcode ${where}`;
    default: {
      const shown = shownText(control.text, control.field);
      const kind = control.type === 'XRLabel' ? 'A label' : control.type.replace(/^XR/, 'A ');
      return `- ${kind} ${shown ? JSON.stringify(shown) : '(empty)'} ${where}${font ? `, ${font}` : ''}${control.align !== 'left' ? `, ${control.align}-aligned` : ''}${total}${format}`;
    }
  }
}

function bandLines(band: PreviewBand, depth = 0): string[] {
  const indent = '  '.repeat(depth);
  const lines: string[] = [];
  const fields = band.fields.length ? `, ${band.kind === 'GroupHeader' ? 'grouped' : 'sorted'} by ${band.fields.map((f) => `[${f.field}]${f.order === 'Descending' ? ' descending' : ''}`).join(', ')}` : '';
  lines.push(`${indent}**${SECTION_NAME[band.kind]}**, ${round(band.height)} high${fields}${band.level ? `, level ${band.level}` : ''}`);
  if (band.kind === 'DetailReport' && band.sub) {
    lines.push(`${indent}Prints after each record${band.sub.dataMember ? ` over ${band.sub.dataMember}` : ''}:`);
    for (const inner of band.sub.bands) if (SECTION_TYPE[inner.kind]) lines.push(...bandLines(inner, depth + 1));
    return lines;
  }
  const controls = band.controls.map(controlLine).filter((l): l is string => l !== null);
  lines.push(...(controls.length ? controls.map((l) => l.replace(/^/gm, indent)) : [`${indent}- (empty)`]));
  return lines;
}

/**
 * The Spec: what the report holds, band by band, written from the REPX.
 * Units are the report's own; font sizes are in points, as in the file.
 */
export function specFromRepx(xml: string | undefined | null, title = reportTitleOf(xml)): string {
  const s = parseReportStructure(xml);
  const paper = /\sPaperKind="([^"]*)"/.exec(xml ?? '')?.[1] ?? 'Letter';
  const landscape = /\sLandscape="true"/i.test(xml ?? '');
  const bound = new Set<string>();
  const visit = (bands: readonly PreviewBand[]) => {
    for (const band of bands) {
      if (band.sub) visit(band.sub.bands);
      for (const c of band.controls) {
        if (c.field) bound.add(c.field);
        for (const row of c.rows) for (const cell of row.cells) if (cell.field) bound.add(cell.field);
      }
    }
  };
  visit(s.bands);
  const out = [
    `**${title}**`,
    '',
    `${paper}${landscape ? ' landscape' : ''}, ${round(s.page.width)} x ${round(s.page.height)} in ${s.unit}; margins ${round(s.margins.left)} left, ${round(s.margins.right)} right, ${round(s.margins.top)} top, ${round(s.margins.bottom)} bottom.`,
  ];
  if (bound.size) out.push('', `Prints from the fields ${[...bound].map((f) => `[${f}]`).join(', ')}.`);
  if (s.parameters.length) out.push('', `Parameters: ${s.parameters.map((p) => `${p.name} (${p.type.replace(/^System\./, '')})`).join(', ')}.`);
  if (s.calculatedFields.length) out.push('', `Calculated fields: ${s.calculatedFields.map((f) => `${f.name} = ${f.expression}`).join('; ')}.`);
  if (s.filterString) out.push('', `Filtered by ${s.filterString}.`);
  // The SQL data source and what running the report needs (2026-11-08, the SQL Server programme, item 21).
  const sources = readRepxDataSources(xml ?? '');
  if (sources.length) {
    const names = sources.map((d) => d.connectionName).filter(Boolean);
    for (const ds of sources) {
      const reads = ds.queries.map((q) => (q.type === 'StoredProcQuery' ? `${q.name} (stored procedure ${q.procName})` : q.type === 'CustomSqlQuery' ? `${q.name} (custom SQL)` : `${q.name} (${q.tables.join(', ')})`));
      out.push('', `**Data source**: SQL Server, connection "${ds.connectionName}"${ds.fromAppConfig ? ', by name' : ''}. Reads ${reads.join('; ')}.${ds.relations.length ? ` Master-detail: ${ds.relations.map((r) => `${r.master} to ${r.detail}`).join(', ')}.` : ''}`);
    }
    out.push(
      '',
      'Your application supplies the connection, in its config file:',
      '',
      '```xml',
      connectionStringsSnippet(names),
      '```',
      '',
      'And runs the report with it:',
      '',
      '```csharp',
      'var report = DevExpress.XtraReports.UI.XtraReport.FromFile("report.repx", true);',
      'report.ExportToPdf("report.pdf");',
      '```',
    );
  }
  for (const band of s.bands) {
    if (!SECTION_TYPE[band.kind]) continue;
    out.push('', ...bandLines(band));
  }
  return out.join('\n');
}
