/**
 * Totals that print blank. Every fixture below is a shape DevExpress 20.1 was
 * made to PRINT on 2026-10-30 (cases c10 and c11 of
 * docs/proposals/devexpress-parity.md), so each expectation is what the real
 * report did, not what the serializer would accept.
 */
import { describe, it, expect } from 'vitest';
import { isAggregate, findSummaries, findSummaryProblems, repairSummaries } from './repxSummaries';
import { checkRepxComplete } from './repxTruncation';
import { auditRepx } from './repxAudit';

const report = (bands: string) =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ' +
  'ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" PageWidth="850" PageHeight="1100">' +
  `<Bands>${bands}</Bands></XtraReportsLayoutSerializer>`;

/** A label bound to `expression`, with `summary` written verbatim before its bindings. */
const total = (n: number, name: string, expression: string, summary = '') =>
  `<Item${n} ControlType="XRLabel" Name="${name}" SizeF="100,20" LocationFloat="0,0">${summary}` +
  `<ExpressionBindings><Item1 EventName="BeforePrint" PropertyName="Text" Expression="${expression}" /></ExpressionBindings>` +
  `</Item${n}>`;

const band = (n: number, type: string, controls: string, extra = '') =>
  `<Item${n} ControlType="${type}" Name="${type}${n}" HeightF="25"${extra}><Controls>${controls}</Controls></Item${n}>`;

const TOP = '<Item1 ControlType="TopMarginBand" Name="TopMargin" HeightF="0" />';
const grouped = (controls: { gf?: string; rf?: string; pf?: string; detail?: string; gh?: string }) =>
  report(
    TOP +
      band(2, 'GroupHeaderBand', controls.gh ?? '').replace('<Controls>', '<GroupFields><Item1 FieldName="Region" /></GroupFields><Controls>') +
      band(3, 'DetailBand', controls.detail ?? '<Item1 ControlType="XRLabel" Name="lblAmt" Text="0" />') +
      band(4, 'GroupFooterBand', controls.gf ?? '') +
      band(5, 'ReportFooterBand', controls.rf ?? '') +
      band(6, 'PageFooterBand', controls.pf ?? '') +
      '<Item7 ControlType="BottomMarginBand" Name="BottomMargin" HeightF="0" />',
  );

describe('isAggregate', () => {
  it('recognises the summary functions and nothing that only looks like one', () => {
    for (const yes of ['sumSum([Amount])', 'sumRunningSum([Amount])', 'sumCount([Id])', "Iif(true, sumAvg([A]), 0)", 'sumSum ([A])']) {
      expect(isAggregate(yes)).toBe(true);
    }
    // A field named sumTotal, a collection aggregate that needs no <Summary>,
    // ordinary arithmetic, and a function that is not one of DevExpress's.
    for (const no of ['[sumTotal]', '[Lines][].Sum([Amount])', '[Amount] * 2', 'Sum([A])', 'summary([A])', '']) {
      expect(isAggregate(no)).toBe(false);
    }
  });
});

describe('findSummaryProblems', () => {
  it('reports an aggregate with no <Summary> in every band, which prints blank', () => {
    const xml = grouped({
      gh: total(1, 'ghTotal', 'sumSum([Amount])'),
      detail: total(1, 'dRun', 'sumRunningSum([Amount])'),
      gf: total(1, 'gfTotal', 'sumSum([Amount])'),
      rf: total(1, 'rfTotal', 'sumSum([Amount])'),
      pf: total(1, 'pfTotal', 'sumSum([Amount])'),
    });
    const problems = findSummaryProblems(xml);
    expect(problems.map((p) => `${p.control}@${p.band}`)).toEqual([
      'ghTotal@GroupHeaderBand',
      'dRun@DetailBand',
      'gfTotal@GroupFooterBand',
      'rfTotal@ReportFooterBand',
      'pfTotal@PageFooterBand',
    ]);
    expect(problems.every((p) => p.kind === 'no-running' && p.running === 'None')).toBe(true);
  });

  it('treats a <Summary> with no Running, or Running="None", as no scope at all', () => {
    const xml = grouped({
      gf: total(1, 'empty', 'sumSum([Amount])', '<Summary />') + total(2, 'none', 'sumSum([Amount])', '<Summary Running="None" />'),
    });
    expect(findSummaryProblems(xml).map((p) => p.control)).toEqual(['empty', 'none']);
  });

  it('accepts a valid scope, with or without a Ref', () => {
    const xml = grouped({
      detail: total(1, 'dRun', 'sumRunningSum([Amount])', '<Summary Running="Report" />'),
      gf: total(1, 'gf', 'sumSum([Amount])', '<Summary Ref="40" Running="Group" />'),
      rf: total(1, 'rf', 'sumSum([Amount])', '<Summary Running="Report" />'),
      pf: total(1, 'pf', 'sumSum([Amount])', '<Summary Running="Page" />'),
    });
    expect(findSummaryProblems(xml)).toEqual([]);
    expect(findSummaries(xml).map((s) => s.running)).toEqual(['Report', 'Group', 'Report', 'Page']);
  });

  it('reports Running="Group" in the report footer, which prints "?"', () => {
    const xml = grouped({ rf: total(1, 'rf', 'sumSum([Amount])', '<Summary Running="Group" />') });
    expect(findSummaryProblems(xml)).toEqual([
      expect.objectContaining({ control: 'rf', kind: 'group-in-report-footer' }),
    ]);
  });

  it('ignores plain fields, other properties and expressions that are not aggregates', () => {
    const bookmark =
      '<Item1 ControlType="XRLabel" Name="mark"><ExpressionBindings>' +
      '<Item1 EventName="BeforePrint" PropertyName="Bookmark" Expression="sumSum([Amount])" /></ExpressionBindings></Item1>';
    const xml = grouped({ gf: bookmark + total(2, 'plain', '[Amount] * 1.2') });
    expect(findSummaries(xml)).toEqual([]);
  });

  it('reads an aggregate inside a table cell, and an escaped expression', () => {
    const cell =
      '<Item1 ControlType="XRTable" Name="t"><Rows><Item1 ControlType="XRTableRow" Name="r"><Cells>' +
      '<Item1 ControlType="XRTableCell" Name="cTotal" Weight="1"><ExpressionBindings>' +
      '<Item1 EventName="BeforePrint" PropertyName="Text" Expression="Iif(sumCount([Id]) &gt; 0, sumSum([Amount]), 0)" />' +
      '</ExpressionBindings></Item1></Cells></Item1></Rows></Item1>';
    const [found] = findSummaries(grouped({ rf: cell }));
    expect(found).toMatchObject({ control: 'cTotal', band: 'ReportFooterBand', running: 'None' });
    expect(found.expression).toBe('Iif(sumCount([Id]) > 0, sumSum([Amount]), 0)');
  });

  it('places a total in a detail report by its own inner band', () => {
    const nested =
      '<Item3 ControlType="DetailReportBand" Name="Lines" DataMember="Orders.Lines"><Bands>' +
      band(1, 'DetailBand', '<Item1 ControlType="XRLabel" Name="lblItem" Text="x" />') +
      band(2, 'ReportFooterBand', total(1, 'orderTotal', 'sumSum([Price])')) +
      '</Bands></Item3>';
    const xml = report(TOP + band(2, 'DetailBand', '<Item1 ControlType="XRLabel" Name="lblOrder" Text="o" />') + nested);
    expect(findSummaryProblems(xml)).toEqual([expect.objectContaining({ control: 'orderTotal', band: 'ReportFooterBand' })]);
  });

  it('finds nothing in an empty or missing document', () => {
    expect(findSummaryProblems('')).toEqual([]);
    expect(findSummaryProblems(null)).toEqual([]);
  });
});

describe('repairSummaries', () => {
  it('scopes a group footer total to the group and a report footer total to the report', () => {
    const src = grouped({ gf: total(1, 'gfTotal', 'sumSum([Amount])'), rf: total(1, 'rfTotal', 'sumSum([Amount])') });
    const { xml, applied, repaired } = repairSummaries(src);
    expect(applied).toBe(true);
    expect(repaired).toHaveLength(2);
    expect(repaired).toEqual(expect.arrayContaining([
      { control: 'rfTotal', band: 'ReportFooterBand', running: 'Report' },
      { control: 'gfTotal', band: 'GroupFooterBand', running: 'Group' },
    ]));
    // First child of the control, before its bindings, which is where the
    // serializer writes it -- and with no Ref, which printing showed it needs none of.
    expect(xml).toContain('Name="gfTotal" SizeF="100,20" LocationFloat="0,0"><Summary Running="Group" /><ExpressionBindings>');
    expect(xml).toContain('Name="rfTotal" SizeF="100,20" LocationFloat="0,0"><Summary Running="Report" /><ExpressionBindings>');
    expect(findSummaryProblems(xml)).toEqual([]);
    expect(checkRepxComplete(xml).complete).toBe(true);
  });

  it('changes nothing but the inserted elements', () => {
    const src = grouped({ gf: total(1, 'gfTotal', 'sumSum([Amount])') });
    const { xml } = repairSummaries(src);
    expect(xml.replace('<Summary Running="Group" />', '')).toBe(src);
  });

  it('sets Running on a <Summary> that has none, and replaces Running="None"', () => {
    const src = grouped({
      gf: total(1, 'empty', 'sumSum([Amount])', '<Summary FormatString="{0:c2}" />') +
        total(2, 'none', 'sumSum([Amount])', '<Summary Running="None" />'),
    });
    const { xml } = repairSummaries(src);
    expect(xml).toContain('<Summary Running="Group" FormatString="{0:c2}" />');
    expect(xml).toContain('Name="none" SizeF="100,20" LocationFloat="0,0"><Summary Running="Group" />');
    expect(xml).not.toContain('Running="None"');
  });

  it('turns Running="Group" in the report footer into "Report"', () => {
    const src = grouped({ rf: total(1, 'rf', 'sumSum([Amount])', '<Summary Ref="9" Running="Group" />') });
    const { xml, repaired } = repairSummaries(src);
    expect(xml).toContain('<Summary Ref="9" Running="Report" />');
    expect(repaired).toEqual([{ control: 'rf', band: 'ReportFooterBand', running: 'Report' }]);
  });

  it('leaves a page footer, the Detail band and a group header for the audit, because their scope is intent', () => {
    const src = grouped({
      gh: total(1, 'ghTotal', 'sumSum([Amount])'),
      detail: total(1, 'dRun', 'sumRunningSum([Amount])'),
      pf: total(1, 'pfTotal', 'sumSum([Amount])'),
    });
    const result = repairSummaries(src);
    expect(result.applied).toBe(false);
    expect(result.xml).toBe(src);
    expect(result.reason).toBe('3 aggregate(s) lack a scope outside the group and report footers, where the right one is a question of intent');
  });

  it('never changes a valid scope, so a second run is a no-op', () => {
    const src = grouped({
      gf: total(1, 'gf', 'sumSum([Amount])'),
      rf: total(1, 'rf', 'sumSum([Amount])'),
      pf: total(1, 'pf', 'sumSum([Amount])', '<Summary Running="Report" />'),
    });
    const once = repairSummaries(src);
    const twice = repairSummaries(once.xml);
    expect(once.applied).toBe(true);
    expect(twice.applied).toBe(false);
    expect(twice.xml).toBe(once.xml);
    expect(twice.reason).toBe('every aggregate already has a running scope');
  });

  it('repairs a detail report\'s own footer to its own report scope', () => {
    const nested =
      '<Item3 ControlType="DetailReportBand" Name="Lines" DataMember="Orders.Lines"><Bands>' +
      band(1, 'DetailBand', '<Item1 ControlType="XRLabel" Name="lblItem" Text="x" />') +
      band(2, 'ReportFooterBand', total(1, 'orderTotal', 'sumSum([Price])')) +
      '</Bands></Item3>';
    const src = report(TOP + band(2, 'DetailBand', '<Item1 ControlType="XRLabel" Name="lblOrder" Text="o" />') + nested);
    expect(repairSummaries(src).xml).toContain('Name="orderTotal" SizeF="100,20" LocationFloat="0,0"><Summary Running="Report" />');
  });

  it('keeps every offset right across a thousand totals in one band', () => {
    const many = Array.from({ length: 1000 }, (_, i) => total(i + 1, `t${i}`, 'sumSum([Amount])')).join('');
    const src = grouped({ gf: many });
    const started = performance.now();
    const { xml, repaired } = repairSummaries(src);
    const elapsed = performance.now() - started;
    expect(repaired).toHaveLength(1000);
    expect(xml.match(/<Summary Running="Group" \/><ExpressionBindings>/g)).toHaveLength(1000);
    expect(findSummaryProblems(xml)).toEqual([]);
    expect(checkRepxComplete(xml).complete).toBe(true);
    // Linear, not quadratic: a generous ceiling that a per-edit rescan would blow.
    expect(elapsed).toBeLessThan(2000);
  });

  it('leaves the audit clean of total findings once repaired', () => {
    const src = grouped({ gf: total(1, 'gf', 'sumSum([Amount])'), rf: total(1, 'rf', 'sumSum([Amount])', '<Summary Running="Group" />') });
    const before = auditRepx(src).findings.map((f) => f.code);
    expect(before).toContain('summary-no-running');
    expect(before).toContain('summary-group-in-report-footer');
    const after = auditRepx(repairSummaries(src).xml).findings.map((f) => f.code);
    expect(after).not.toContain('summary-no-running');
    expect(after).not.toContain('summary-group-in-report-footer');
  });

  it('declines an empty document', () => {
    expect(repairSummaries('')).toMatchObject({ applied: false, xml: '', repaired: [] });
  });
});
