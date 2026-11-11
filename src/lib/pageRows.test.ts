/**
 * The records a page shows, read off OCR's layout of it for the print check
 * (2026-11-11, the full audit's CC-01). The page is the fidelity benchmark's
 * sales-grouped case, its nine records in three regions with a subtotal under
 * each and a grand total, the figures as a revenue-weighted margin would
 * print them.
 */
import { describe, expect, it } from 'vitest';
import { pageFormats, rowsFromEvidence } from './pageRows';
import type { ReportLayout } from './reportTypes';

const WEIGHTS = [300, 150, 150, 150];
let ref = 0;
const r = () => ++ref;
const bind = (expression: string, running?: string) =>
  `${running ? `<Summary Ref="${r()}" Running="${running}" />` : ''}<ExpressionBindings><Item1 Ref="${r()}" EventName="BeforePrint" PropertyName="Text" Expression="${expression}" /></ExpressionBindings>`;
const table = (cells: (string | { text: string })[]) =>
  `<Item1 Ref="${r()}" ControlType="XRTable" Name="t${ref}" LocationFloat="0,0" SizeF="750,25"><Rows><Item1 Ref="${r()}" ControlType="XRTableRow" Name="r${ref}" Weight="1"><Cells>` +
  cells
    .map((c, i) =>
      typeof c === 'string'
        ? `<Item${i + 1} Ref="${r()}" ControlType="XRTableCell" Name="c${ref}" Weight="${WEIGHTS[i]}">${c}</Item${i + 1}>`
        : `<Item${i + 1} Ref="${r()}" ControlType="XRTableCell" Name="c${ref}" Weight="${WEIGHTS[i]}" Text="${c.text}" />`,
    )
    .join('') +
  '</Cells></Item1></Rows></Item1>';
const band = (i: number, type: string, name: string, height: number, inner = '') =>
  `<Item${i} Ref="${r()}" ControlType="${type}" Name="${name}" HeightF="${height}"${inner ? `>${inner}</Item${i}>` : ' />'}`;

/** The sales report as an AI wrote it: the margin column summed. */
function salesReport() {
  ref = 0;
  return (
    '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Sales" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PaperKind="Letter" PageWidth="850" PageHeight="1100" Version="20.1"><Bands>' +
    band(1, 'TopMarginBand', 'TopMargin', 50) +
    band(2, 'PageHeaderBand', 'PageHeader', 25, `<Controls>${table([{ text: 'Product' }, { text: 'Units' }, { text: 'Revenue' }, { text: 'Margin %' }])}</Controls>`) +
    band(3, 'GroupHeaderBand', 'GroupHeader1', 25, `<GroupFields><Item1 Ref="${r()}" FieldName="Region" /></GroupFields><Controls><Item1 Ref="${r()}" ControlType="XRLabel" Name="region" LocationFloat="0,0" SizeF="300,25">${bind('[Region]')}</Item1></Controls>`) +
    band(4, 'DetailBand', 'Detail', 25, `<Controls>${table([bind('[ProductLine]'), bind('[Units]'), bind('[Revenue]'), bind('[MarginPct]')])}</Controls>`) +
    band(5, 'GroupFooterBand', 'GroupFooter1', 25, `<Controls>${table([{ text: 'Subtotal' }, bind('sumSum([Units])', 'Group'), bind('sumSum([Revenue])', 'Group'), bind('sumSum([MarginPct])', 'Group')])}</Controls>`) +
    band(6, 'ReportFooterBand', 'ReportFooter', 25, `<Controls>${table([{ text: 'Grand total' }, bind('sumSum([Units])', 'Report'), bind('sumSum([Revenue])', 'Report'), bind('sumSum([MarginPct])', 'Report')])}</Controls>`) +
    band(7, 'BottomMarginBand', 'BottomMargin', 50) +
    '</Bands></XtraReportsLayoutSerializer>'
  );
}

const PAGE = [
  ['Product', 'Units', 'Revenue', 'Margin %'],
  ['Region: North', '', '', ''],
  ['Garden Tools', '1,240', '86.8', '31.2'],
  ['Outdoor Lighting', '610', '54.9', '27.5'],
  ['Irrigation', '380', '41.8', '24.0'],
  ['Subtotal', '2,230', '183.5', '28.5'],
  ['Region: South', '', '', ''],
  ['Garden Tools', '1,905', '133.4', '33.0'],
  ['Outdoor Lighting', '720', '64.8', '26.1'],
  ['Irrigation', '1,060', '116.6', '29.4'],
  ['Patio Furniture', '215', '96.8', '22.8'],
  ['Subtotal', '3,900', '411.6', '28.5'],
  ['Region: West', '', '', ''],
  ['Garden Tools', '980', '68.6', '30.4'],
  ['Patio Furniture', '340', '153.0', '23.9'],
  ['Subtotal', '1,320', '221.6', '25.9'],
  ['Grand total', '7,450', '816.7', '27.8'],
];

const evidence = (rows: string[][], x = 0): ReportLayout => ({
  title: 'Quarterly Sales by Region',
  pageWidth: 850,
  sections: [
    {
      id: 'ocr-page-1',
      name: 'Report header',
      type: 'header',
      height: 1000,
      elements: [
        { id: 'title', type: 'label', content: 'Quarterly Sales by Region', x: 0, y: 0, width: 400, height: 30 },
        { id: 'grid', type: 'table', content: '', x, y: 100, width: 750, height: 400, rows: rows.map((cells) => ({ cells: cells.map((content, i) => ({ content, weight: WEIGHTS[i] })) })) },
      ],
    },
  ],
});

describe('rowsFromEvidence', () => {
  it("reads the page's records under the fields the report prints, its groups and its totals", () => {
    const page = rowsFromEvidence(evidence(PAGE), salesReport())!;
    expect(page.columns).toEqual(['ProductLine', 'Units', 'Revenue', 'MarginPct']);
    expect(page.rows).toHaveLength(9);
    // Kept as the data holds them, the region from the group's heading.
    expect(page.rows[0]).toEqual({ ProductLine: 'Garden Tools', Units: '1240', Revenue: '86.8', MarginPct: '31.2', Region: 'North' });
    expect(page.rows[8]).toMatchObject({ ProductLine: 'Patio Furniture', Region: 'West' });
    expect(page.groups).toEqual([[0, 1, 2], [3, 4, 5, 6], [7, 8]]);
    expect(page.totals.map((t) => [t.label, t.group, t.figures.MarginPct])).toEqual([
      ['Subtotal', 0, '28.5'],
      ['Subtotal', 1, '28.5'],
      ['Subtotal', 2, '25.9'],
      ['Grand total', null, '27.8'],
    ]);
    expect(page.samples.Units.slice(0, 2)).toEqual(['1,240', '610']);
    expect(page.pages).toBe(1);
  });

  it('places a column with no heading by where it prints, whatever margin the reading has', () => {
    const page = rowsFromEvidence(evidence(PAGE.slice(2, 5), 80), salesReport())!;
    expect(page.columns).toEqual(['ProductLine', 'Units', 'Revenue', 'MarginPct']);
    expect(page.rows.map((row) => row.Units)).toEqual(['1240', '610', '380']);
    expect(page.groups).toEqual([[0, 1, 2]]);
  });

  // The review of CC-01 (2026-11-11): "Tax" after an invoice's subtotal was read
  // as a new group's first record, and a product named "Total Gym" as a total.
  it('reads a summary line after a subtotal as no record, and a record that starts with "Total" as a record', () => {
    const invoice = [
      PAGE[0],
      ['Garden Tools', '1,240', '86.8', '31.2'],
      ['Total Gym', '2', '998.0', '20.0'],
      ['Irrigation', '380', '41.8', '24.0'],
      ['Subtotal', '1,622', '1,126.6', ''],
      ['Tax', '', '8.5', ''],
      ['Total (USD)', '', '1,135.1', ''],
    ];
    const page = rowsFromEvidence(evidence(invoice), salesReport())!;
    expect(page.rows.map((row) => row.ProductLine)).toEqual(['Garden Tools', 'Total Gym', 'Irrigation']);
    expect(page.groups).toEqual([[0, 1, 2]]);
    expect(page.totals.map((t) => [t.label, t.group])).toEqual([
      ['Subtotal', null],
      ['Total (USD)', null],
    ]);
  });

  it('skips a description wrapped onto a line of its own, and is null with no grid or no field to read into', () => {
    const wrapped = [PAGE[0], PAGE[2], ['(cordless, 18 V)', '', '', ''], PAGE[3]];
    expect(rowsFromEvidence(evidence(wrapped), salesReport().replace('FieldName="Region"', 'FieldName="ProductLine"'))!.rows).toHaveLength(2);
    expect(rowsFromEvidence(null, salesReport())).toBeNull();
    expect(rowsFromEvidence({ ...evidence(PAGE), sections: [{ ...evidence(PAGE).sections[0], elements: [] }] }, salesReport())).toBeNull();
    expect(rowsFromEvidence(evidence(PAGE), salesReport().replace(/Expression="\[\w+\]"/g, 'Expression="\'x\'"'))).toBeNull();
  });
});

describe('pageFormats', () => {
  it("gives a value the page's format unless it is a whole number printed plain, and a total always", () => {
    const formats = pageFormats(rowsFromEvidence(evidence(PAGE), salesReport())!);
    expect(formats.values).toEqual({ Units: '{0:n0}', Revenue: '{0:n1}', MarginPct: '{0:n1}' });
    expect(formats.totals).toMatchObject({ Units: '{0:n0}', Revenue: '{0:n1}', MarginPct: '{0:n1}' });
  });
});
