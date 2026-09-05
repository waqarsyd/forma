/**
 * Every check here corresponds to a defect that actually reached a user on
 * 2026-09-04, so the fixtures are the real shapes rather than invented ones:
 * document-wide Item numbering, a report with no Detail band, and an XRPageInfo
 * carrying an invented enum value beside a Format= attribute.
 *
 * As elsewhere in this suite the loops sit inside a single case, so the grep and
 * the run agree.
 */
import { describe, it, expect } from 'vitest';
import { auditRepx } from './repxAudit';

const report = (bands: string) =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ' +
  'ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" PageWidth="850" PageHeight="1100">' +
  `<Bands>${bands}</Bands></XtraReportsLayoutSerializer>`;

/*
 * Item numbering has to be correct in the fixtures themselves, or every case
 * picks up an `item-numbering` finding it did not ask for — which is exactly
 * what happened on the first draft of this file: `<Bands>` held Item1 and Item3
 * with nothing between them, and the audit was right to say so.
 */
const detailWithTable =
  '<Item2 Ref="2" ControlType="DetailBand" Name="Detail"><Controls>' +
  '<Item1 Ref="3" ControlType="XRTable" Name="t"><Rows>' +
  '<Item1 Ref="4" ControlType="XRTableRow" Name="r"><Cells>' +
  '<Item1 Ref="5" ControlType="XRTableCell" Name="c1" Text="A" Weight="1" />' +
  '<Item2 Ref="6" ControlType="XRTableCell" Name="c2" Text="B" Weight="1" />' +
  '</Cells></Item1></Rows></Item1></Controls></Item2>';

const TOP = '<Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" />';
const bottom = (n: number, ref: number) =>
  `<Item${n} Ref="${ref}" ControlType="BottomMarginBand" Name="BottomMargin" />`;

/** A structurally sound report: margin bands, a Detail band, a weighted table. */
const healthy = report(TOP + detailWithTable + bottom(3, 9));

/** The same, minus the Detail band — correctly numbered, so only that is found. */
const noDetail = report(TOP + bottom(2, 9));

const codes = (xml: string) => auditRepx(xml).findings.map((f) => f.code);

describe('auditRepx on a healthy report', () => {
  it('finds nothing', () => {
    const audit = auditRepx(healthy);
    expect(audit.findings).toEqual([]);
    expect(audit.ok).toBe(true);
    expect(audit.summary).toBe('no structural problems found');
  });
});

describe('auditRepx errors', () => {
  it('reports the Item numbering that emptied a real report', () => {
    const broken = healthy
      .replace('<Rows><Item1 Ref="4"', '<Rows><Item4 Ref="4"')
      .replace('</Item1></Rows>', '</Item4></Rows>');
    const audit = auditRepx(broken);
    expect(codes(broken)).toContain('item-numbering');
    expect(audit.errors).toBeGreaterThan(0);
    expect(audit.findings.find((f) => f.code === 'item-numbering')?.message).toMatch(/load EMPTY/);
  });

  it('reports duplicate Ref values', () => {
    const dup = healthy.replace('Ref="6"', 'Ref="5"');
    expect(codes(dup)).toContain('duplicate-ref');
    expect(auditRepx(dup).findings.find((f) => f.code === 'duplicate-ref')?.message).toMatch(/5x2/);
  });

  it('reports XML that stops part-way', () => {
    const cut = healthy.slice(0, healthy.length - 120);
    expect(codes(cut)).toContain('truncated');
  });

  it('reports an empty document as an error rather than a clean pass', () => {
    for (const input of ['', '   ', null, undefined]) {
      const audit = auditRepx(input);
      expect(audit.ok).toBe(false);
      expect(audit.findings[0].code).toBe('empty');
    }
  });
});

describe('auditRepx warnings', () => {
  it('reports a report with no Detail band, and says what it costs', () => {
    const audit = auditRepx(noDetail);
    expect(codes(noDetail)).toContain('no-detail-band');
    expect(audit.findings.find((f) => f.code === 'no-detail-band')?.message).toMatch(/cannot be bound to a data source/);
    // Degraded, not broken: this must never be an error.
    expect(audit.errors).toBe(0);
  });

  it('reports a missing margin band', () => {
    const noBottom = report(TOP + detailWithTable);
    expect(codes(noBottom)).toContain('no-margin-bands');
  });

  it('reports an invented PageInfo value and names the valid ones', () => {
    const bad = healthy.replace(
      '</Controls></Item2>',
      '<Item2 Ref="7" ControlType="XRPageInfo" Name="p" PageInfo="NumberOfPagesNoWith  PageNumber" /></Controls></Item2>'
    );
    const audit = auditRepx(bad);
    expect(codes(bad)).toContain('bad-pageinfo');
    const message = audit.findings.find((f) => f.code === 'bad-pageinfo')?.message ?? '';
    expect(message).toContain('NumberOfTotal');
    expect(message).toMatch(/prints nothing/);
  });

  it('accepts every valid PageInfo value', () => {
    for (const value of ['None', 'Number', 'NumberOfTotal', 'Total', 'RomLowNumber', 'RomHiNumber', 'DateTime', 'UserName']) {
      const ok = healthy.replace(
        '</Controls></Item2>',
        `<Item2 Ref="7" ControlType="XRPageInfo" Name="p" PageInfo="${value}" /></Controls></Item2>`
      );
      expect(codes(ok), `rejected the valid value ${value}`).not.toContain('bad-pageinfo');
    }
  });

  it('reports Format= on XRPageInfo, which DevExpress does not read', () => {
    const bad = healthy.replace(
      '</Controls></Item2>',
      '<Item2 Ref="7" ControlType="XRPageInfo" Name="p" PageInfo="NumberOfTotal" Format="Page {0} of {1}" /></Controls></Item2>'
    );
    expect(codes(bad)).toContain('pageinfo-format-attr');
  });

  it('reports a table cell carrying coordinates instead of a Weight', () => {
    const positioned = healthy.replace('Name="c1" Text="A" Weight="1"', 'Name="c1" Text="A" LocationFloat="0,0" SizeF="100,20"');
    expect(codes(positioned)).toContain('positioned-table-cell');
  });

  it('reports it once even when every cell is positioned', () => {
    const positioned = healthy.replace(/Weight="1"/g, 'LocationFloat="0,0"');
    expect(codes(positioned).filter((c) => c === 'positioned-table-cell')).toHaveLength(1);
  });

  it('reports a table with no cells at all', () => {
    const empty = report(
      '<Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" />' +
        '<Item2 Ref="2" ControlType="DetailBand" Name="Detail"><Controls>' +
        '<Item1 Ref="3" ControlType="XRTable" Name="t"><Rows /></Item1>' +
        '</Controls></Item2>' +
        '<Item3 Ref="9" ControlType="BottomMarginBand" Name="BottomMargin" />'
    );
    expect(codes(empty)).toContain('empty-table');
  });
});

/**
 * The cross-check. Three live runs from one image on 2026-09-04 produced a
 * Detail band once and none the other two times; "there is no Detail band" is
 * correct for a certificate and a defect for a job card, and the layout is the
 * only thing in the response that knows which this is.
 */
const layoutWith = (rows: number, sections = 1): any => ({
  title: 'T',
  pageWidth: 850,
  sections: Array.from({ length: sections }, (_, i) => ({
    id: `s${i}`,
    name: i === 0 ? 'Detail' : `Section${i}`,
    type: i === 0 ? 'detail' : 'header',
    height: 100,
    elements: i === 0
      ? [{ type: 'table', rows: Array.from({ length: rows }, () => ({ cells: [{ text: 'x' }] })) }]
      : [{ type: 'label', text: 'x' }],
  })),
});

/**
 * Grouping. The serialized shape here was measured with `tools/RepxProbe` on
 * 2026-09-05: `<GroupFields>` is a sibling of `<Controls>`, written first, and
 * its items carry `FieldName` and no `ControlType`.
 */
describe('auditRepx on group bands', () => {
  const groupHeader = (fields: string | null, n: number, ref: number) =>
    `<Item${n} Ref="${ref}" ControlType="GroupHeaderBand" Name="GroupHeader" HeightF="20">` +
    (fields ? `<GroupFields><Item1 Ref="${ref + 100}" FieldName="${fields}" /></GroupFields>` : '') +
    '</Item' + n + '>';

  it('says nothing about a group header that has its fields', () => {
    const xml = report(TOP + groupHeader('Region', 2, 20) + detailWithTable.replace('Item2', 'Item3') + bottom(4, 9));
    expect(codes(xml)).not.toContain('group-without-fields');
  });

  it('reports a group header that groups by nothing', () => {
    // DevExpress accepts it and prints the band once, so the report looks like
    // it has a heading and its grouping simply does not happen.
    const xml = report(TOP + groupHeader(null, 2, 20) + detailWithTable.replace('Item2', 'Item3') + bottom(4, 9));
    const finding = auditRepx(xml).findings.find((f) => f.code === 'group-without-fields');
    expect(finding?.message).toMatch(/1 of 1 group header band\(s\) carry no <GroupFields>/);
  });

  it('counts each band separately when only one of several is missing its fields', () => {
    const xml = report(
      TOP + groupHeader('Region', 2, 20) + groupHeader(null, 3, 21) +
      detailWithTable.replace('Item2', 'Item4') + bottom(5, 9),
    );
    expect(auditRepx(xml).findings.find((f) => f.code === 'group-without-fields')?.message)
      .toMatch(/1 of 2 group header band\(s\)/);
  });

  it('reports a group footer with no header to close', () => {
    const xml = report(
      TOP + detailWithTable +
      '<Item3 Ref="20" ControlType="GroupFooterBand" Name="GroupFooter" HeightF="20" />' +
      bottom(4, 9),
    );
    expect(codes(xml)).toContain('group-footer-without-header');
  });

  it('says nothing about a group footer that has one', () => {
    const xml = report(
      TOP + groupHeader('Region', 2, 20) + detailWithTable.replace('Item2', 'Item3') +
      '<Item4 Ref="21" ControlType="GroupFooterBand" Name="GroupFooter" HeightF="20" />' +
      bottom(5, 9),
    );
    expect(codes(xml)).not.toContain('group-footer-without-header');
  });

  it('says nothing at all about an ungrouped report', () => {
    expect(codes(healthy)).not.toContain('group-without-fields');
    expect(codes(healthy)).not.toContain('group-footer-without-header');
  });
});

describe('auditRepx on charts and cross-tabs', () => {
  const inDetail = (controls: string) =>
    report(TOP + `<Item2 Ref="2" ControlType="DetailBand" Name="Detail"><Controls>${controls}</Controls></Item2>` + bottom(3, 9));

  const chart = (withSeries: boolean, ref = 3) =>
    `<Item1 Ref="${ref}" ControlType="XRChart" Name="c${ref}">` +
    (withSeries
      ? `<Chart Ref="${ref + 1}"><DataContainer Ref="${ref + 2}"><SeriesSerializable>` +
        `<Item1 Ref="${ref + 3}" Name="S" ArgumentDataMember="R" ValueDataMembersSerializable="A" />` +
        '</SeriesSerializable></DataContainer></Chart>'
      : '') +
    `</Item${ref === 3 ? '1' : '2'}>`;

  it('says nothing about a chart that has a series', () => {
    expect(codes(inDetail(chart(true)))).not.toContain('chart-without-series');
  });

  it('reports a chart that plots nothing', () => {
    // It loads, and draws an empty frame that reads as "data has not arrived".
    const finding = auditRepx(inDetail(chart(false))).findings.find((f) => f.code === 'chart-without-series');
    expect(finding?.message).toMatch(/1 of 1 chart\(s\) declare no series/);
  });

  it('counts each chart separately', () => {
    const two = inDetail(chart(true, 3) + chart(false, 10).replace('<Item1 Ref="10"', '<Item2 Ref="10"'));
    expect(auditRepx(two).findings.find((f) => f.code === 'chart-without-series')?.message)
      .toMatch(/1 of 2 chart\(s\)/);
  });

  it('says nothing about a complete cross-tab', () => {
    const full =
      '<Item1 Ref="3" ControlType="XRCrossTab" Name="x">' +
      '<RowFields><Item1 Ref="4" FieldName="R" /></RowFields>' +
      '<ColumnFields><Item1 Ref="5" FieldName="Q" /></ColumnFields>' +
      '<DataFields><Item1 Ref="6" FieldName="A" /></DataFields></Item1>';
    expect(codes(inDetail(full))).not.toContain('crosstab-missing-fields');
  });

  it('names the collection a cross-tab is missing', () => {
    const noData =
      '<Item1 Ref="3" ControlType="XRCrossTab" Name="x">' +
      '<RowFields><Item1 Ref="4" FieldName="R" /></RowFields>' +
      '<ColumnFields><Item1 Ref="5" FieldName="Q" /></ColumnFields></Item1>';
    const finding = auditRepx(inDetail(noData)).findings.find((f) => f.code === 'crosstab-missing-fields');
    expect(finding?.message).toContain('<DataFields>');
  });

  it('says nothing at all about a report with neither', () => {
    expect(codes(healthy)).not.toContain('chart-without-series');
    expect(codes(healthy)).not.toContain('crosstab-missing-fields');
  });
});

describe('auditRepx on parameters', () => {
  const withParams = (params: string, extra = '') =>
    report(TOP + detailWithTable + bottom(3, 9))
      .replace('<Bands>', `<Parameters>${params}</Parameters><Bands>`)
      .replace('<XtraReportsLayoutSerializer', `<XtraReportsLayoutSerializer${extra}`);

  it('says nothing when every parameter is declared and used', () => {
    const xml = withParams(
      '<Item1 Ref="30" Name="Region" Description="Region" />',
      ' FilterString="[Region] = ?Region"',
    );
    expect(codes(xml)).not.toContain('undeclared-parameter');
    expect(codes(xml)).not.toContain('unused-parameter');
  });

  it('reports a filter referring to a parameter that does not exist', () => {
    const xml = withParams(
      '<Item1 Ref="30" Name="Region" />',
      ' FilterString="[Region] = ?Region And [D] &gt;= ?DateFrom"',
    );
    const finding = auditRepx(xml).findings.find((f) => f.code === 'undeclared-parameter');
    expect(finding?.message).toContain('"DateFrom"');
  });

  it('reports a declared parameter nobody uses', () => {
    const xml = withParams('<Item1 Ref="30" Name="Unused" />');
    expect(auditRepx(xml).findings.find((f) => f.code === 'unused-parameter')?.message)
      .toContain('"Unused"');
  });

  it('counts an expression reference as use', () => {
    const xml = withParams('<Item1 Ref="30" Name="Region" />')
      .replace('Text="A"', 'Text="A" Expression="[Parameters.Region]"');
    expect(codes(xml)).not.toContain('unused-parameter');
  });

  it('says nothing at all about a report with no parameters', () => {
    expect(codes(healthy)).not.toContain('undeclared-parameter');
    expect(codes(healthy)).not.toContain('unused-parameter');
  });
});

describe('auditRepx cross-checked against the layout', () => {
  it('says nothing extra when the report and the mockup agree', () => {
    // One section, one content band (Detail), and a table in both.
    expect(codes(healthy)).toEqual([]);
    expect(auditRepx(healthy, layoutWith(4)).findings.map((f) => f.code)).toEqual([]);
  });

  it('turns "no Detail band" from an observation into a diagnosis', () => {
    const plain = auditRepx(noDetail).findings.find((f) => f.code === 'no-detail-band')?.message ?? '';
    const withEvidence = auditRepx(noDetail, layoutWith(12)).findings.find((f) => f.code === 'no-detail-band')?.message ?? '';
    expect(plain).not.toMatch(/12-row grid/);
    expect(withEvidence).toMatch(/mockup drew a 12-row grid in "Detail"/);
    expect(withEvidence).toMatch(/they belong in a Detail band as ONE row/);
  });

  it('leaves the plain wording when the mockup has no grid either', () => {
    // A certificate: no Detail band is the right answer, so no evidence is added.
    const single = auditRepx(noDetail, layoutWith(1)).findings.find((f) => f.code === 'no-detail-band')?.message ?? '';
    expect(single).not.toMatch(/row grid/);
  });

  it('reports a grid the mockup drew that the report emitted as loose controls', () => {
    const noTable = report(TOP + '<Item2 Ref="2" ControlType="DetailBand" Name="Detail"><Controls>' +
      '<Item1 Ref="3" ControlType="XRLabel" Name="l" Text="A" /></Controls></Item2>' + bottom(3, 9));
    const found = auditRepx(noTable, layoutWith(9)).findings.map((f) => f.code);
    expect(found).toContain('grid-not-a-table');
    expect(auditRepx(noTable, layoutWith(9)).findings.find((f) => f.code === 'grid-not-a-table')?.message)
      .toMatch(/cannot be bound to data, resized as a table, or repeated/);
  });

  it('does not claim a missing table when the mockup drew no grid', () => {
    const noTable = report(TOP + '<Item2 Ref="2" ControlType="DetailBand" Name="Detail"><Controls>' +
      '<Item1 Ref="3" ControlType="XRLabel" Name="l" Text="A" /></Controls></Item2>' + bottom(3, 9));
    expect(codes(noTable)).not.toContain('grid-not-a-table');
    expect(auditRepx(noTable, layoutWith(1)).findings.map((f) => f.code)).not.toContain('grid-not-a-table');
  });

  it('reports the band-versus-section disagreement gemini.md says nothing enforces', () => {
    // The report has one content band (Detail); the mockup claims three sections.
    const found = auditRepx(healthy, layoutWith(4, 3)).findings.map((f) => f.code);
    expect(found).toContain('band-section-mismatch');
  });

  it('does not count margin bands as sections', () => {
    // healthy has TopMargin + Detail + BottomMargin. Only Detail is content, so
    // a one-section layout agrees with it.
    expect(auditRepx(healthy, layoutWith(4, 1)).findings.map((f) => f.code)).not.toContain('band-section-mismatch');
  });

  it('runs the structural checks with no layout at all', () => {
    // A report loaded from an older save may not have one.
    for (const layout of [undefined, null]) {
      expect(auditRepx(noDetail, layout).findings.map((f) => f.code)).toContain('no-detail-band');
    }
  });
});

describe('auditRepx reporting', () => {
  it('counts errors and warnings separately', () => {
    const both = noDetail.replace('Ref="9"', 'Ref="1"');
    const audit = auditRepx(both);
    expect(audit.errors).toBe(1);      // duplicate Ref
    expect(audit.warnings).toBe(1);    // no Detail band
    expect(audit.ok).toBe(false);
  });

  it('summarises by code, so a log line stays short', () => {
    expect(auditRepx(noDetail).summary).toBe('0 error(s), 1 warning(s): no-detail-band');
  });
});

/**
 * Two more controls that load happily and print nothing.
 *
 * Same family as the chart-without-series and cross-tab-missing-fields checks:
 * DevExpress raises nothing, the page just has a gap where content was meant to
 * be, and on a busy page that reads as data still loading.
 */
describe('empty containers', () => {
  it('warns about a panel with no controls in it', () => {
    const xml = report('<Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="100"><Controls>'
      + '<Item1 Ref="2" ControlType="XRPanel" Name="p" LocationFloat="0,0" SizeF="200,50" Borders="All" />'
      + '</Controls></Item1>');
    const findings = auditRepx(xml, null).findings;
    expect(findings.some((f) => f.code === 'empty-panel')).toBe(true);
  });

  it('stays quiet about a panel that contains something', () => {
    const xml = report('<Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="100"><Controls>'
      + '<Item1 Ref="2" ControlType="XRPanel" Name="p" LocationFloat="0,0" SizeF="200,50"><Controls>'
      + '<Item1 Ref="3" ControlType="XRLabel" Name="in" Text="x" LocationFloat="5,5" SizeF="100,20" />'
      + '</Controls></Item1></Controls></Item1>');
    const findings = auditRepx(xml, null).findings;
    expect(findings.some((f) => f.code === 'empty-panel')).toBe(false);
  });

  it('warns about a subreport that names no report', () => {
    const xml = report('<Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="100"><Controls>'
      + '<Item1 Ref="2" ControlType="XRSubreport" Name="s" LocationFloat="0,0" SizeF="200,20" />'
      + '</Controls></Item1>');
    const findings = auditRepx(xml, null).findings;
    expect(findings.some((f) => f.code === 'subreport-without-source')).toBe(true);
  });

  it('accepts a subreport named by URL', () => {
    const xml = report('<Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="100"><Controls>'
      + '<Item1 Ref="2" ControlType="XRSubreport" Name="s" ReportSourceUrl="Other.repx" LocationFloat="0,0" SizeF="200,20" />'
      + '</Controls></Item1>');
    const findings = auditRepx(xml, null).findings;
    expect(findings.some((f) => f.code === 'subreport-without-source')).toBe(false);
  });

  it('accepts a subreport carrying an embedded ReportSource', () => {
    // Measured with RepxProbe emit-container: the inner report really does
    // serialize inline, so this form is self-contained and must not be flagged.
    const xml = report('<Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="100"><Controls>'
      + '<Item1 Ref="2" ControlType="XRSubreport" Name="s" LocationFloat="0,0" SizeF="200,20">'
      + '<ReportSource Ref="3" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Inner" PageWidth="850" PageHeight="1100">'
      + '<Bands><Item1 Ref="4" ControlType="DetailBand" Name="InnerDetail" HeightF="20" /></Bands>'
      + '</ReportSource></Item1></Controls></Item1>');
    const findings = auditRepx(xml, null).findings;
    expect(findings.some((f) => f.code === 'subreport-without-source')).toBe(false);
  });
});

/**
 * Conditional formatting fails as BEHAVIOUR, not as missing content.
 *
 * A link points at a rule by Value="#Ref-N" (RepxProbe emit-rules). If it names
 * something that is not a rule, the rule never fires and the report prints as
 * though the condition was never met -- no error, just the wrong colours. That
 * cannot be caught by counting controls the way the other checks here do.
 */
describe('formatting rules', () => {
  const withRules = (sheet: string, body: string) =>
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
    sheet +
    '<Bands><Item1 Ref="50" ControlType="DetailBand" Name="Detail" HeightF="100"><Controls>' + body +
    '</Controls></Item1></Bands></XtraReportsLayoutSerializer>';

  const sheet = '<FormattingRuleSheet><Item1 Ref="1" Name="Overdue" Condition="[Days] &gt; 30" /></FormattingRuleSheet>';
  const link = (ref: number) =>
    `<Item1 Ref="60" ControlType="XRLabel" Name="l" Text="x" SizeF="100,20" LocationFloat="0,0">` +
    `<FormattingRuleLinks><Item1 Ref="61" Value="#Ref-${ref}" /></FormattingRuleLinks></Item1>`;

  it('accepts a link that names a real rule', () => {
    const findings = auditRepx(withRules(sheet, link(1)), null).findings;
    expect(findings.some((f) => f.code === 'formatting-rule-link-dangling')).toBe(false);
    expect(findings.some((f) => f.code === 'formatting-rule-unused')).toBe(false);
  });

  it('reports a link that names something which is not a rule', () => {
    // Ref 50 is the Detail band, not a rule. The file loads perfectly.
    const findings = auditRepx(withRules(sheet, link(50)), null).findings;
    const dangling = findings.find((f) => f.code === 'formatting-rule-link-dangling');
    expect(dangling?.severity).toBe('error');
    expect(dangling?.message).toContain('50');
  });

  it('reports a rule nothing links to', () => {
    const plainLabel = '<Item1 Ref="60" ControlType="XRLabel" Name="l" Text="x" SizeF="100,20" LocationFloat="0,0" />';
    const findings = auditRepx(withRules(sheet, plainLabel), null).findings;
    expect(findings.some((f) => f.code === 'formatting-rule-unused')).toBe(true);
  });

  it('stays quiet about a report with no conditional formatting at all', () => {
    const plain = withRules('', '<Item1 Ref="60" ControlType="XRLabel" Name="l" Text="x" SizeF="100,20" LocationFloat="0,0" />');
    const findings = auditRepx(plain, null).findings;
    expect(findings.some((f) => f.code.startsWith('formatting-rule'))).toBe(false);
  });
});

/**
 * Calculated fields, and why the checks are about the declarations.
 *
 * A control references a calculated field exactly as it references a real one
 * -- Expression="[LineTotal]" says nothing about where the field comes from
 * (RepxProbe emit-calc). So nothing in a binding can tell us whether a name
 * resolves, and the failures worth catching are all in the <CalculatedFields>
 * block itself.
 */
describe('calculated fields', () => {
  const withFields = (fields: string, body = '') =>
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
    (fields ? `<CalculatedFields>${fields}</CalculatedFields>` : '') +
    '<Bands><Item1 Ref="50" ControlType="DetailBand" Name="Detail" HeightF="40"><Controls>' + body +
    '</Controls></Item1></Bands></XtraReportsLayoutSerializer>';

  const bound = (name: string) =>
    `<Item1 Ref="60" ControlType="XRLabel" Name="l" Text="0" SizeF="100,20" LocationFloat="0,0">` +
    `<ExpressionBindings><Item1 Ref="61" EventName="BeforePrint" PropertyName="Text" Expression="[${name}]" /></ExpressionBindings></Item1>`;

  const field = (name: string, expr: string) =>
    `<Item1 Ref="1" Name="${name}" FieldType="Decimal" Expression="${expr}" />`;

  it('accepts a field that is declared and used', () => {
    const findings = auditRepx(withFields(field('LineTotal', '[Qty] * [Price]'), bound('LineTotal')), null).findings;
    expect(findings.some((f) => f.code.startsWith('calculated-field'))).toBe(false);
  });

  it('reports a field with no expression as an error', () => {
    const findings = auditRepx(withFields(field('LineTotal', ''), bound('LineTotal')), null).findings;
    const empty = findings.find((f) => f.code === 'calculated-field-empty');
    expect(empty?.severity).toBe('error');
    expect(empty?.message).toContain('LineTotal');
  });

  it('reports two fields sharing a name, because the later one silently wins', () => {
    const two = field('LineTotal', '[Qty] * [Price]') +
      '<Item2 Ref="2" Name="LineTotal" FieldType="Decimal" Expression="[Qty]" />';
    const findings = auditRepx(withFields(two, bound('LineTotal')), null).findings;
    expect(findings.find((f) => f.code === 'calculated-field-duplicate')?.severity).toBe('error');
  });

  it('warns about a field nothing references', () => {
    const findings = auditRepx(withFields(field('Margin', '[Price] - [Cost]')), null).findings;
    expect(findings.some((f) => f.code === 'calculated-field-unused')).toBe(true);
  });

  it('stays quiet about a report with no calculated fields', () => {
    const findings = auditRepx(withFields('', bound('Amount')), null).findings;
    expect(findings.some((f) => f.code.startsWith('calculated-field'))).toBe(false);
  });
});

/**
 * Sorting, and the mistake that is invisible in the file.
 *
 * <SortFields> belongs to the DetailBand. On any other band DevExpress keeps it
 * and never applies it, so the rows print unsorted with nothing to say why.
 *
 * <SortFields> and <GroupFields> have IDENTICAL item shapes -- FieldName plus an
 * optional SortOrder, no ControlType (RepxProbe emit-sort) -- so the parent
 * element name is the only thing telling them apart.
 */
describe('sorting', () => {
  const band = (kind: string, inner: string) =>
    `<Item1 Ref="1" ControlType="${kind}" Name="B" HeightF="20">${inner}</Item1>`;

  const doc = (bands: string) =>
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
    `<Bands>${bands}</Bands></XtraReportsLayoutSerializer>`;

  const sortFields = '<SortFields><Item1 Ref="2" FieldName="OrderDate" SortOrder="Descending" /></SortFields>';

  it('accepts sorting on the Detail band', () => {
    const findings = auditRepx(doc(band('DetailBand', sortFields)), null).findings;
    expect(findings.some((f) => f.code.startsWith('sort-'))).toBe(false);
  });

  it('warns when the sort sits on a band that will never apply it', () => {
    const findings = auditRepx(doc(band('PageHeaderBand', sortFields)), null).findings;
    const wrong = findings.find((f) => f.code === 'sort-on-wrong-band');
    expect(wrong?.message).toContain('PageHeaderBand');
  });

  it('does not mistake a GroupHeaderBand GroupFields for a sort', () => {
    // Identical item shape, different parent. Confusing the two would report a
    // grouped report as mis-sorted on every generation.
    const grouped = band('GroupHeaderBand', '<GroupFields><Item1 Ref="2" FieldName="Region" /></GroupFields>');
    const findings = auditRepx(doc(grouped), null).findings;
    expect(findings.some((f) => f.code.startsWith('sort-'))).toBe(false);
  });

  it('reports a sort field naming nothing', () => {
    const blank = '<SortFields><Item1 Ref="2" FieldName="" /></SortFields>';
    expect(auditRepx(doc(band('DetailBand', blank)), null).findings.some((f) => f.code === 'sort-field-empty')).toBe(true);
  });

  it('reports the same field sorted twice', () => {
    const twice = '<SortFields><Item1 Ref="2" FieldName="Name" /><Item2 Ref="3" FieldName="Name" /></SortFields>';
    const findings = auditRepx(doc(band('DetailBand', twice)), null).findings;
    expect(findings.find((f) => f.code === 'sort-field-duplicate')?.message).toContain('Name');
  });

  it('stays quiet about a report that sorts nothing', () => {
    const plain = band('DetailBand', '<Controls><Item1 Ref="2" ControlType="XRLabel" Name="l" Text="x" SizeF="10,10" LocationFloat="0,0" /></Controls>');
    expect(auditRepx(doc(plain), null).findings.some((f) => f.code.startsWith('sort-'))).toBe(false);
  });
});

/**
 * Bookmarks: the document map, and the two ways it comes out wrong.
 *
 * BookmarkParent is a #Ref-N pointer at another CONTROL (RepxProbe emit-book) --
 * the fifth pointer attribute in this format.
 */
describe('bookmarks', () => {
  const doc = (controls: string) =>
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
    '<Bands><Item1 Ref="50" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="60"><Controls>' + controls +
    '</Controls></Item1></Bands></XtraReportsLayoutSerializer>';

  const label = (ref: number, attrs: string) =>
    `<Item1 Ref="${ref}" ControlType="XRLabel" Name="l${ref}" Text="t" ${attrs} SizeF="100,20" LocationFloat="0,0" />`;

  it('accepts a child nesting under a real bookmark', () => {
    const xml = doc(label(3, 'Bookmark="North"') + label(4, 'Bookmark="Acme" BookmarkParent="#Ref-3"'));
    expect(auditRepx(xml, null).findings.some((f) => f.code === 'bookmark-parent-unbookmarked')).toBe(false);
  });

  it('warns when the named parent carries no bookmark of its own', () => {
    // The child cannot nest, so it lands at the top level beside the entry it
    // was meant to sit inside -- a flat map where a tree was intended.
    const xml = doc(label(3, '') + label(4, 'Bookmark="Acme" BookmarkParent="#Ref-3"'));
    const finding = auditRepx(xml, null).findings.find((f) => f.code === 'bookmark-parent-unbookmarked');
    expect(finding?.message).toContain('3');
  });

  it('warns about a literal bookmark inside the Detail band', () => {
    const detail =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
      '<Bands><Item1 Ref="50" ControlType="DetailBand" Name="Detail" HeightF="40"><Controls>' +
      label(3, 'Bookmark="Same every row"') +
      '</Controls></Item1></Bands></XtraReportsLayoutSerializer>';
    expect(auditRepx(detail, null).findings.some((f) => f.code === 'bookmark-literal-in-detail')).toBe(true);
  });

  it('accepts a per-record bookmark written as an expression', () => {
    const bound =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
      '<Bands><Item1 Ref="50" ControlType="DetailBand" Name="Detail" HeightF="40"><Controls>' +
      '<Item1 Ref="3" ControlType="XRLabel" Name="l" SizeF="100,20" LocationFloat="0,0">' +
      '<ExpressionBindings><Item1 Ref="4" EventName="BeforePrint" PropertyName="Bookmark" Expression="[Region]" /></ExpressionBindings>' +
      '</Item1></Controls></Item1></Bands></XtraReportsLayoutSerializer>';
    expect(auditRepx(bound, null).findings.some((f) => f.code === 'bookmark-literal-in-detail')).toBe(false);
  });

  it('stays quiet about a report with no bookmarks', () => {
    expect(auditRepx(doc(label(3, '')), null).findings.some((f) => f.code.startsWith('bookmark'))).toBe(false);
  });
});

describe('table of contents', () => {
  const doc = (controls: string) =>
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
    '<Bands><Item1 Ref="50" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="200"><Controls>' + controls +
    '</Controls></Item1></Bands></XtraReportsLayoutSerializer>';

  const toc = '<Item1 Ref="3" ControlType="XRTableOfContents" Name="toc" LocationFloat="0,0"><LevelTitle Ref="4" Text="Contents" /></Item1>';

  it('warns about a contents page with nothing to list', () => {
    // The worst version of this control: the heading makes it look like the
    // content is coming.
    const finding = auditRepx(doc(toc), null).findings.find((f) => f.code === 'toc-without-bookmarks');
    expect(finding?.severity).toBe('warning');
  });

  it('stays quiet when the report has bookmarks for it to list', () => {
    const withMark = toc + '<Item2 Ref="5" ControlType="XRLabel" Name="l" Text="North" Bookmark="North" SizeF="10,10" LocationFloat="0,50" />';
    expect(auditRepx(doc(withMark), null).findings.some((f) => f.code === 'toc-without-bookmarks')).toBe(false);
  });

  it('stays quiet about a report with no contents page', () => {
    const plain = '<Item1 Ref="3" ControlType="XRLabel" Name="l" Text="x" SizeF="10,10" LocationFloat="0,0" />';
    expect(auditRepx(doc(plain), null).findings.some((f) => f.code === 'toc-without-bookmarks')).toBe(false);
  });
});
