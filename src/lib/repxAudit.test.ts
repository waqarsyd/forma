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
