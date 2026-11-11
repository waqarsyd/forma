/**
 * The report printed with the page's own records before it is answered, and
 * the one loop that sends it back over what the print shows (2026-11-11, the
 * full audit's CC-01). The defects are the Claude Code reference's, each in
 * one report: too many pages, text past the margin, a heading bound to
 * `[ProductName].Substring(0, 1)` printing blank, one group where the page
 * shows several, "1240" where the page shows "1,240".
 */
import { describe, expect, it, vi } from 'vitest';
import { findingsToFix, fixInstructionFor, fixUntilPrints, printCheck, type FixableAnswer } from './printCheck';
import { pageFormats, rowsFromEvidence } from './pageRows';
import { applyFormats } from './formatFromText';
import type { ReportLayout } from './reportTypes';
import type { RepxFinding } from './repxAudit';

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

const WEIGHTED = 'sumSum([Revenue] * [MarginPct]) / sumSum([Revenue])';

/** The sales report, right unless an option says otherwise. */
function salesReport(o: { detailHeight?: number; groupField?: string; groupLabel?: string; extraHeader?: string } = {}) {
  ref = 0;
  return (
    '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Sales" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PaperKind="Letter" PageWidth="850" PageHeight="1100" Version="20.1"><Bands>' +
    band(1, 'TopMarginBand', 'TopMargin', 50) +
    band(2, 'PageHeaderBand', 'PageHeader', 25, `<Controls>${table([{ text: 'Product' }, { text: 'Units' }, { text: 'Revenue' }, { text: 'Margin %' }])}${o.extraHeader ?? ''}</Controls>`) +
    band(3, 'GroupHeaderBand', 'GroupHeader1', 25, `<GroupFields><Item1 Ref="${r()}" FieldName="${o.groupField ?? 'Region'}" /></GroupFields><Controls><Item1 Ref="${r()}" ControlType="XRLabel" Name="region" LocationFloat="0,0" SizeF="300,25">${bind(o.groupLabel ?? '[Region]')}</Item1></Controls>`) +
    band(4, 'DetailBand', 'Detail', o.detailHeight ?? 25, `<Controls>${table([bind('[ProductLine]'), bind('[Units]'), bind('[Revenue]'), bind('[MarginPct]')])}</Controls>`) +
    band(5, 'GroupFooterBand', 'GroupFooter1', 25, `<Controls>${table([{ text: 'Subtotal' }, bind('sumSum([Units])', 'Group'), bind('sumSum([Revenue])', 'Group'), bind(WEIGHTED, 'Group')])}</Controls>`) +
    band(6, 'ReportFooterBand', 'ReportFooter', 25, `<Controls>${table([{ text: 'Grand total' }, bind('sumSum([Units])', 'Report'), bind('sumSum([Revenue])', 'Report'), bind(WEIGHTED, 'Report')])}</Controls>`) +
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

const evidence: ReportLayout = {
  title: 'Quarterly Sales by Region',
  pageWidth: 850,
  sections: [
    {
      id: 'ocr-page-1',
      name: 'Report header',
      type: 'header',
      height: 1000,
      elements: [{ id: 'grid', type: 'table', content: '', x: 0, y: 100, width: 750, height: 400, rows: PAGE.map((cells) => ({ cells: cells.map((content, i) => ({ content, weight: WEIGHTS[i] })) })) }],
    },
  ],
};

/** The report printed with the page's records, as the generation calls it. */
function check(xml: string) {
  const page = rowsFromEvidence(evidence, xml)!;
  return printCheck(xml, page.rows, { pagesShown: page.pages, groupsShown: page.groups.length, samples: page.samples });
}

describe('printCheck', () => {
  it("finds nothing wrong in a report that prints the page, once its values carry the page's formats", () => {
    const xml = salesReport();
    // Units print "1240" where the page shows "1,240".
    expect(check(xml)).toEqual([expect.objectContaining({ severity: 'warning', code: 'value-unformatted', message: expect.stringContaining('"1,240"') })]);
    const formatted = applyFormats(xml, pageFormats(rowsFromEvidence(evidence, xml)!)).xml;
    expect(check(formatted)).toEqual([]);
  });

  it('names a report that prints more pages than the page has', () => {
    expect(check(salesReport({ detailHeight: 300 })).map((f) => f.code)).toContain('prints-extra-pages');
  });

  it('names a control printed past the right margin', () => {
    const wide = `<Item2 Ref="900" ControlType="XRLabel" Name="printedOn" Text="Printed 14 Oct 2026" LocationFloat="650,0" SizeF="200,25" />`;
    const found = check(salesReport({ extraHeader: wide })).find((f) => f.code === 'clipped-at-margin');
    expect(found?.message).toMatch(/^printedOn prints past the right margin/);
  });

  it('names a bound text that prints nothing over records that hold its field', () => {
    // As the AI wrote the letter groups' heading: the records hold every product's name.
    const found = check(salesReport({ groupLabel: '[ProductLine].Substring(0, 1)' })).find((f) => f.code === 'bound-cell-blank');
    expect(found?.message).toContain('region ([ProductLine].Substring(0, 1))');
    expect(check(salesReport({ groupLabel: 'Substring([ProductLine], 0, 1)' })).map((f) => f.code)).not.toContain('bound-cell-blank');
  });

  it("fills the group's field from the page's headings when the header prints it in an expression", () => {
    expect(check(salesReport({ groupLabel: "'Region: ' + [Region]" })).map((f) => f.code)).not.toContain('group-collapses');
  });

  it('names one group where the page shows several, and a group for every record', () => {
    expect(check(salesReport({ groupField: 'GroupLetter' })).find((f) => f.code === 'group-collapses')?.message).toMatch(/one group where the page shows 3 groups/);
    expect(check(salesReport({ groupField: 'Units' })).find((f) => f.code === 'group-collapses')?.message).toMatch(/each of the 9 records as a group of its own/);
  });

  it('judges nothing without records', () => {
    expect(printCheck(salesReport({ detailHeight: 300 }), [], { pagesShown: 1 })).toEqual([]);
    expect(printCheck('', [{ A: '1' }])).toEqual([]);
  });
});

const layout: ReportLayout = { title: 'Sales', pageWidth: 850, sections: [] };
const finding = (code: string, severity: RepxFinding['severity'] = 'error'): RepxFinding => ({ severity, code, message: `${code} message` });
const answer = (over: Partial<FixableAnswer> = {}): FixableAnswer => ({ repxContent: salesReport(), layout, usage: { input: 10, output: 5, thinking: 0, total: 15 }, ...over });

describe('findingsToFix', () => {
  it('sends a picture back over what its print shows, an unreadable expression and a grid drawn as texts, the one warning that does', () => {
    const a = answer({
      printFindings: [finding('prints-extra-pages'), finding('value-unformatted', 'warning'), finding('sum-of-ratio', 'warning'), finding('total-disagrees-with-page', 'warning')],
      evidenceFindings: [finding('grid-not-a-table', 'warning'), finding('no-detail-band', 'warning')],
    });
    expect(findingsToFix(a, { described: false }).map((f) => f.code)).toEqual(['prints-extra-pages', 'grid-not-a-table']);
    const unreadable = answer({ repxContent: salesReport({ groupLabel: "[Region].Substring(0, 1)" }) });
    expect(findingsToFix(unreadable, { described: false }).map((f) => f.code)).toContain('expression-invalid');
  });

  // The review of CC-01 (2026-11-11): a report the person opened or attached
  // carries expressions DevExpress already accepted.
  it('does not send back the expressions of a report the run started from', () => {
    const unreadable = answer({ repxContent: salesReport({ groupLabel: "[Region].Substring(0, 1)" }) });
    expect(findingsToFix(unreadable, { described: false, fromReport: true }).map((f) => f.code)).not.toContain('expression-invalid');
  });
});

describe('fixUntilPrints', () => {
  const quiet = () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  };

  it('asks once, naming what to fix, and keeps the better answer with both answers counted', async () => {
    quiet();
    const fixedAnswer = answer({ usage: { input: 20, output: 10, thinking: 0, total: 30 }, dataQuery: undefined });
    const ask = vi.fn(async () => fixedAnswer);
    const out = await fixUntilPrints(answer({ printFindings: [finding('clipped-at-margin')], dataQuery: { name: 'q' } }), {
      described: false,
      spent: { input: 10, output: 5, thinking: 0, total: 15 },
      left: () => 3,
      ask,
      aborted: () => false,
    });
    expect(ask).toHaveBeenCalledTimes(1);
    expect((ask.mock.calls[0] as unknown as [string])[0]).toContain('- [clipped-at-margin] clipped-at-margin message');
    expect(out?.findings).toEqual([]);
    expect(out?.spent?.total).toBe(45);
    // The query the first answer named stands.
    expect(out?.answer.dataQuery).toEqual({ name: 'q' });
  });

  it('keeps the first answer when the fix is worse or fails, and asks nothing with nothing to fix or nothing left to spend', async () => {
    quiet();
    const first = answer({ printFindings: [finding('clipped-at-margin')] });
    const worse = answer({ printFindings: [finding('clipped-at-margin'), finding('prints-extra-pages')] });
    const base = { described: false, spent: null, aborted: () => false };
    expect((await fixUntilPrints(first, { ...base, left: () => 3, ask: async () => worse }))?.answer).toBe(first);
    expect((await fixUntilPrints(first, { ...base, left: () => 3, ask: async () => Promise.reject(new Error('429')) }))?.answer).toBe(first);
    const ask = vi.fn(async () => worse);
    await fixUntilPrints(answer(), { ...base, left: () => 3, ask });
    await fixUntilPrints(first, { ...base, left: () => 0, ask });
    expect(ask).not.toHaveBeenCalled();
  });

  it('says nothing more once the person stops it', async () => {
    quiet();
    let stopped = false;
    const out = await fixUntilPrints(answer({ printFindings: [finding('bound-cell-blank')] }), {
      described: false,
      spent: null,
      left: () => 3,
      ask: async () => {
        stopped = true;
        return answer();
      },
      aborted: () => stopped,
    });
    expect(out).toBeNull();
  });

  // 2026-11-11, the re-audit's R2-08: a fix is designed with no draft, and the account of the page was lost with it.
  it('works out again what a fixed report kept of the page, from the draft the first answer corrected', async () => {
    quiet();
    const draftText = ['page Letter portrait 850 1100 75 75 75 75', 'band ReportHeader 60 0', 'label title 0 0 300 30 Arial:18b l 0 7 "QUARTERLY SALES"'].join('\n');
    const firstCoverage = { captions: 9, kept: 9, missing: [], sameBand: 9 };
    const first = answer({ printFindings: [finding('clipped-at-margin')], coverage: firstCoverage });
    const base = { described: false, spent: null, left: () => 3, aborted: () => false, ask: async () => answer() };
    const out = await fixUntilPrints(first, { ...base, draftText });
    // Of the fixed file, never the first answer's copied over.
    expect(out?.answer.coverage).toEqual({ captions: 1, kept: 0, missing: ['QUARTERLY SALES'], sameBand: 0 });
    // None when the first answer had none, and the first's own when it is the one kept.
    expect((await fixUntilPrints(answer({ printFindings: [finding('clipped-at-margin')] }), { ...base, draftText }))?.answer.coverage).toBeUndefined();
    expect((await fixUntilPrints(answer({ coverage: firstCoverage }), { ...base, draftText }))?.answer.coverage).toBe(firstCoverage);
  });

  it('writes an instruction that keeps the layout and lists each finding', () => {
    expect(fixInstructionFor([finding('bound-cell-blank')])).toMatch(/Keep the layout exactly as it is and fix ONLY these:\n- \[bound-cell-blank\] bound-cell-blank message\nReturn the complete report/);
  });
});
