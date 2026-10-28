import { describe, it, expect } from 'vitest';
import { checkFidelity, measureReport, median, normalizeText, scoreChecks } from './fidelity';
import type { ReportLayout } from './reportTypes';

/*
 * A small but complete report in the shape the mock fixture and the prompt both
 * use: five content bands between the two margin bands, a title label, a
 * heading table, a detail table, a totals label and a page-number control.
 * Font sizes are in points, as DevExpress writes them.
 */
const REPX = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" ReportUnit="HundredthsOfAnInch" Margins="75, 75, 75, 75" PageWidth="850" PageHeight="1100" Version="20.1">
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="75" />
    <Item2 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="80">
      <Controls>
        <Item1 Ref="3" ControlType="XRLabel" Name="labelTitle" Text="INVOICE" LocationFloat="0,0" SizeF="500,40" Font="Arial, 24pt, style=Bold" />
        <Item2 Ref="4" ControlType="XRLabel" Name="labelCompany" Text="Northwind &amp; Sons" LocationFloat="0,45" SizeF="300,20" Font="Arial, 10pt" />
      </Controls>
    </Item2>
    <Item3 Ref="5" ControlType="PageHeaderBand" Name="PageHeader" HeightF="30">
      <Controls>
        <Item1 Ref="6" ControlType="XRTable" Name="tableHead" LocationFloat="0,5" SizeF="700,20">
          <Rows>
            <Item1 Ref="7" ControlType="XRTableRow" Name="rowHead" Weight="1">
              <Cells>
                <Item1 Ref="8" ControlType="XRTableCell" Name="headDescription" Text="Description" Weight="3" Font="Arial, 9pt, style=Bold" />
                <Item2 Ref="9" ControlType="XRTableCell" Name="headQty" Text="Qty" Weight="1" Font="Arial, 9pt, style=Bold" />
                <Item3 Ref="10" ControlType="XRTableCell" Name="headAmount" Text="Amount" Weight="1" Font="Arial, 9pt, style=Bold" />
              </Cells>
            </Item1>
          </Rows>
        </Item1>
      </Controls>
    </Item3>
    <Item4 Ref="11" ControlType="DetailBand" Name="Detail" HeightF="25">
      <Controls>
        <Item1 Ref="12" ControlType="XRTable" Name="tableDetail" LocationFloat="0,0" SizeF="700,20">
          <Rows>
            <Item1 Ref="13" ControlType="XRTableRow" Name="rowDetail" Weight="1">
              <Cells>
                <Item1 Ref="14" ControlType="XRTableCell" Name="cellDescription" Text="Chai" Weight="3" Font="Arial, 9pt" />
                <Item2 Ref="15" ControlType="XRTableCell" Name="cellQty" Text="12" Weight="1" Font="Arial, 9pt" />
                <Item3 Ref="16" ControlType="XRTableCell" Name="cellAmount" Text="216.00" Weight="1" Font="Arial, 9pt" />
              </Cells>
            </Item1>
          </Rows>
        </Item1>
      </Controls>
    </Item4>
    <Item5 Ref="17" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="40">
      <Controls>
        <Item1 Ref="18" ControlType="XRLabel" Name="labelTotal" Text="Total Due" LocationFloat="400,10" SizeF="150,20" Font="Arial, 11pt, style=Bold" />
      </Controls>
    </Item5>
    <Item6 Ref="19" ControlType="PageFooterBand" Name="PageFooter" HeightF="30">
      <Controls>
        <Item1 Ref="20" ControlType="XRPageInfo" Name="pageInfo" TextFormatString="Page {0} of {1}" LocationFloat="600,5" SizeF="100,20" Font="Arial, 8pt" />
      </Controls>
    </Item6>
    <Item7 Ref="21" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="75" />
  </Bands>
</XtraReportsLayoutSerializer>`;

const LAYOUT: ReportLayout = {
  title: 'Invoice',
  pageWidth: 850,
  sections: ['ReportHeader', 'PageHeader', 'Detail', 'ReportFooter', 'PageFooter'].map((name, i) => ({
    id: `s${i}`,
    name,
    type: name === 'Detail' ? 'detail' : name.endsWith('Footer') ? 'footer' : 'header',
    height: 40,
    elements: [],
  })),
};

describe('measureReport', () => {
  const m = measureReport(REPX, LAYOUT);

  it('counts the content bands and leaves the margin bands out', () => {
    expect(m.bandOrder).toEqual(['ReportHeader', 'PageHeader', 'Detail', 'ReportFooter', 'PageFooter']);
    expect(m.bands).toEqual({ ReportHeader: 1, PageHeader: 1, Detail: 1, ReportFooter: 1, PageFooter: 1 });
  });

  it('counts controls by type, tables and their cells', () => {
    expect(m.controls).toEqual({ XRLabel: 3, XRTable: 2, XRPageInfo: 1 });
    expect(m.tables).toBe(2);
    expect(m.tableCells).toBe(6);
  });

  it('reads the root attributes the checks ask about', () => {
    expect(m.serializerVersion).toBe('20.1.3.0');
    expect(m.margins).toEqual({ left: 75, right: 75, top: 75, bottom: 75 });
    expect(m.unit).toBe('HundredthsOfAnInch');
    expect(m.page).toEqual({ width: 850, height: 1100 });
  });

  it('collects every Text, decoded, and every font size in points', () => {
    expect(m.texts).toContain('Northwind & Sons');
    expect(m.texts).toContain('216.00');
    // A page number's words live in TextFormatString, not Text.
    expect(m.texts).toContain('Page {0} of {1}');
    expect(m.fontSizesPt).toEqual([24, 10, 9, 9, 9, 9, 9, 9, 11, 8]);
    expect(m.fontMedianPt).toBe(9);
  });

  it('carries the audit and the layout section count', () => {
    expect(m.audit.errors).toBe(0);
    expect(m.layoutSections).toBe(5);
    expect(m.complete).toBe(true);
  });

  it('measures an empty or truncated document without throwing', () => {
    const empty = measureReport('');
    expect(empty.bandOrder).toEqual([]);
    expect(empty.controls).toEqual({});
    expect(empty.fontMedianPt).toBeNull();
    expect(empty.layoutSections).toBeNull();
    expect(empty.complete).toBe(false);

    const cut = measureReport(REPX.slice(0, Math.floor(REPX.length / 2)));
    expect(cut.complete).toBe(false);
  });
});

describe('checkFidelity', () => {
  const m = measureReport(REPX, LAYOUT);

  it('always reports completeness first', () => {
    const checks = checkFidelity(m, {});
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ id: 'complete', pass: true });
  });

  it('passes a report that meets every expectation', () => {
    const checks = checkFidelity(m, {
      bands: ['ReportHeader', 'PageHeader', 'Detail', 'ReportFooter', 'PageFooter'],
      tables: { min: 1, max: 3 },
      controls: { XRLabel: { min: 2, max: 10 }, XRPageInfo: { min: 1 } },
      texts: { all: ['invoice', 'Total Due', 'qty'] },
      fontSize: { median: { min: 8, max: 10 } },
      margins: { declared: true },
      audit: { errors: 0, maxWarnings: 1 },
      sectionsMatchBands: true,
      serializerVersion: '20.1.3.0',
    });
    expect(checks.filter((c) => !c.pass)).toEqual([]);
    expect(scoreChecks(checks)).toEqual({ passed: checks.length, total: checks.length, ratio: 1 });
  });

  it('names the band that is missing', () => {
    const checks = checkFidelity(m, { bands: ['GroupHeader'] });
    expect(checks.find((c) => c.id === 'band:GroupHeader')).toMatchObject({ pass: false, actual: 'absent' });
  });

  it('treats an absent control type as zero of them', () => {
    const [, chart] = checkFidelity(m, { controls: { XRChart: { min: 1 } } });
    expect(chart).toMatchObject({ id: 'control:XRChart', pass: false, actual: '0', expected: '>= 1' });
  });

  it('matches phrases regardless of case and whitespace, and lists what is missing', () => {
    const [, texts] = checkFidelity(m, { texts: { all: ['TOTAL   due', 'Bill To', 'Qty'], minRatio: 0.9 } });
    expect(texts.pass).toBe(false);
    expect(texts.actual).toContain('2/3');
    expect(texts.actual).toContain('"Bill To"');

    const [, lenient] = checkFidelity(m, { texts: { all: ['TOTAL   due', 'Bill To', 'Qty'], minRatio: 0.6 } });
    expect(lenient.pass).toBe(true);
  });

  it('fails the median font check when nothing carries a Font', () => {
    const bare = measureReport(REPX.replace(/ Font="[^"]*"/g, ''));
    const [, font] = checkFidelity(bare, { fontSize: { median: { min: 8 } } });
    expect(font).toMatchObject({ pass: false, actual: 'no Font written' });
  });

  it('reads all-zero Margins as not declared', () => {
    const zero = measureReport(REPX.replace('Margins="75, 75, 75, 75"', 'Margins="0, 0, 0, 0"'));
    const [, margins] = checkFidelity(zero, { margins: { declared: true } });
    expect(margins).toMatchObject({ pass: false, actual: '0, 0, 0, 0' });
  });

  it('compares the layout section count with the content bands', () => {
    const fewer: ReportLayout = { ...LAYOUT, sections: LAYOUT.sections.slice(0, 2) };
    const [, sections] = checkFidelity(measureReport(REPX, fewer), { sectionsMatchBands: true });
    expect(sections).toMatchObject({ pass: false, actual: '2 sections, 5 bands' });
  });

  it('reports the audit codes when errors or warnings are present', () => {
    // Two controls sharing a Ref is the defect the loader punishes by discarding content.
    const dup = REPX.replace('Ref="4" ControlType="XRLabel"', 'Ref="3" ControlType="XRLabel"');
    const checks = checkFidelity(measureReport(dup, LAYOUT), { audit: { errors: 0 } });
    const errors = checks.find((c) => c.id === 'audit.errors')!;
    expect(errors.pass).toBe(false);
    expect(errors.actual).toMatch(/^\d+ \(/);
  });
});

describe('helpers', () => {
  it('median handles odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('normalizeText collapses whitespace and case', () => {
    expect(normalizeText('  Total \n  DUE ')).toBe('total due');
  });

  it('scoreChecks reads an empty list as a full pass', () => {
    expect(scoreChecks([])).toEqual({ passed: 0, total: 0, ratio: 1 });
  });
});
