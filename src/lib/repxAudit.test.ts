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
