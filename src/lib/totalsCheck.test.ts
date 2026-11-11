/**
 * Totals checked against the figures the page prints (2026-11-11, the full
 * audit's CC-05). Forma's AI totalled the sales case's "Margin %" column as
 * `sumSum([Margin])` and printed 82.7, 111.3, 54.3 and 248.3; this page's
 * figures are the revenue-weighted margins (28.5, 28.5, 25.9 and 27.8), which
 * neither the sum, the plain average nor a margin weighted by units gives.
 */
import { describe, expect, it } from 'vitest';
import { checkTotals, repairTotals, sumOfRatio } from './totalsCheck';
import { rowsFromEvidence } from './pageRows';
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

/** The sales report with its margin column totalled by `margin`. */
function salesReport(margin = 'sumSum([MarginPct])', caption = 'Margin %') {
  ref = 0;
  return (
    '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Sales" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PaperKind="Letter" PageWidth="850" PageHeight="1100" Version="20.1"><Bands>' +
    band(1, 'TopMarginBand', 'TopMargin', 50) +
    band(2, 'PageHeaderBand', 'PageHeader', 25, `<Controls>${table([{ text: 'Product' }, { text: 'Units' }, { text: 'Revenue' }, { text: caption }])}</Controls>`) +
    band(3, 'GroupHeaderBand', 'GroupHeader1', 25, `<GroupFields><Item1 Ref="${r()}" FieldName="Region" /></GroupFields><Controls><Item1 Ref="${r()}" ControlType="XRLabel" Name="region" LocationFloat="0,0" SizeF="300,25">${bind('[Region]')}</Item1></Controls>`) +
    band(4, 'DetailBand', 'Detail', 25, `<Controls>${table([bind('[ProductLine]'), bind('[Units]'), bind('[Revenue]'), bind('[MarginPct]')])}</Controls>`) +
    band(5, 'GroupFooterBand', 'GroupFooter1', 25, `<Controls>${table([{ text: 'Subtotal' }, bind('sumSum([Units])', 'Group'), bind('sumSum([Revenue])', 'Group'), bind(margin, 'Group')])}</Controls>`) +
    band(6, 'ReportFooterBand', 'ReportFooter', 25, `<Controls>${table([{ text: 'Grand total' }, bind('sumSum([Units])', 'Report'), bind('sumSum([Revenue])', 'Report'), bind(margin, 'Report')])}</Controls>`) +
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

const evidence = (rows: string[][]): ReportLayout => ({
  title: 'Quarterly Sales by Region',
  pageWidth: 850,
  sections: [
    {
      id: 'ocr-page-1',
      name: 'Report header',
      type: 'header',
      height: 1000,
      elements: [{ id: 'grid', type: 'table', content: '', x: 0, y: 100, width: 750, height: 400, rows: rows.map((cells) => ({ cells: cells.map((content, i) => ({ content, weight: WEIGHTS[i] })) })) }],
    },
  ],
});

const WEIGHTED = 'sumSum([Revenue] * [MarginPct]) / sumSum([Revenue])';

describe('sumOfRatio', () => {
  it('warns of a percentage summed, by its caption or its field, with no records needed', () => {
    expect(sumOfRatio(salesReport())).toEqual([expect.objectContaining({ severity: 'warning', code: 'sum-of-ratio', message: expect.stringContaining('"Margin %"') })]);
    expect(sumOfRatio(salesReport('sumSum([MarginPct])', 'Share'))[0]?.code).toBe('sum-of-ratio');
    // An average, or a sum of what adds up, is not one.
    expect(sumOfRatio(salesReport('sumAvg([MarginPct])'))).toEqual([]);
    expect(sumOfRatio(salesReport(WEIGHTED))).toEqual([]);
  });

  it('reads as two sentences: the message is shown to people as written', () => {
    // 2026-11-11: an edit dropped the space between the two halves and the
    // finding read "...never added up.Use its average"; nothing caught it.
    const message = sumOfRatio(salesReport())[0]?.message ?? '';
    expect(message).toContain('never added up. Use its average');
    expect(message).not.toMatch(/\.[A-Z]/);
  });

  it('leaves a money column called a margin or a rate alone: only a word that means ratio warns', () => {
    // "Gross Margin" is money beside Revenue and Cost; summing it is right.
    expect(sumOfRatio(salesReport('sumSum([GrossMargin])', 'Gross Margin'))).toEqual([]);
    expect(sumOfRatio(salesReport('sumSum([Rate])', 'Rate'))).toEqual([]);
    expect(sumOfRatio(salesReport('sumSum([GrossMargin])', 'Margin %'))[0]?.code).toBe('sum-of-ratio');
  });
});

describe('checkTotals', () => {
  it("names a total that works out differently from the page's figure, after rounding to its decimals", () => {
    const xml = salesReport();
    const found = checkTotals(xml, rowsFromEvidence(evidence(PAGE), xml));
    expect(found.map((f) => [f.severity, f.code])).toEqual([
      ['error', 'total-disagrees-with-page'],
      ['error', 'total-disagrees-with-page'],
    ]);
    expect(found[0].message).toBe('The total under "Margin %" prints 82.7 where the page shows 28.5.');
    // The units and the revenue add up, so they are not named.
    expect(found.some((f) => /Units|Revenue/.test(f.message))).toBe(false);
  });

  it('only warns of a total that is the right kind but not the page\'s figure: a misread, or figures no formula gives', () => {
    // The reference's own page: 28.7, 28.9, 25.9 and 28.1, which only West's weighted margin gives.
    const madeUp = PAGE.map((row) => (row[1] === '2,230' ? [...row.slice(0, 3), '28.7'] : row[1] === '3,900' ? [...row.slice(0, 3), '28.9'] : row[0] === 'Grand total' ? [...row.slice(0, 3), '28.1'] : row));
    const xml = salesReport(WEIGHTED);
    const found = checkTotals(xml, rowsFromEvidence(evidence(madeUp), xml));
    expect(found.map((f) => [f.severity, f.message])).toEqual([
      ['warning', 'The total under "Margin %" prints 28.5 where the page shows 28.7.'],
      ['warning', 'The total under "Margin %" prints 27.8 where the page shows 28.1.'],
    ]);
  });

  it('finds nothing in totals that print the page, and nothing without its records', () => {
    const xml = salesReport(WEIGHTED);
    expect(checkTotals(xml, rowsFromEvidence(evidence(PAGE), xml))).toEqual([]);
    expect(checkTotals(xml, null)).toEqual([]);
  });
});

describe('repairTotals', () => {
  it('rewrites a total to the one form that prints every figure the page shows', () => {
    const xml = salesReport();
    const out = repairTotals(xml, rowsFromEvidence(evidence(PAGE), xml));
    expect(out.applied).toBe(true);
    expect(out.xml.match(/Expression="sumSum\(\[Revenue\] \* \[MarginPct\]\) \/ sumSum\(\[Revenue\]\)"/g)).toHaveLength(2);
    // The scopes and the other totals are as they were.
    expect(out.xml.match(/Expression="sumSum\(\[Units\]\)"/g)).toHaveLength(2);
    expect(out.xml.match(/Running="Group"/g)).toHaveLength(3);
    expect(checkTotals(out.xml, rowsFromEvidence(evidence(PAGE), out.xml))).toEqual([]);
  });

  it('leaves a total alone when no form, or more than one, prints the page', () => {
    // Made-up figures no weighting reproduces, as the reference's own page had.
    // Each total is judged on its own: the group footer's and the report footer's.
    const madeUp = PAGE.map((row) => (row[1] === '2,230' ? [...row.slice(0, 3), '28.7'] : row[0] === 'Grand total' ? [...row.slice(0, 3), '28.6'] : row));
    const xml = salesReport();
    expect(repairTotals(xml, rowsFromEvidence(evidence(madeUp), xml))).toMatchObject({ applied: false, xml });
    const groupsOnly = PAGE.map((row) => (row[1] === '2,230' ? [...row.slice(0, 3), '28.7'] : row));
    const repaired = repairTotals(xml, rowsFromEvidence(evidence(groupsOnly), xml)).xml;
    expect(repaired.match(/Expression="sumSum\(\[MarginPct\]\)"/g)).toHaveLength(1);
    expect(repairTotals(xml, null)).toMatchObject({ applied: false, xml });
  });
});
