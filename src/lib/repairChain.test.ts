/**
 * The repair chain (2026-11-11, the full audit, ARCH-1a and SE-02b): the
 * passes the generation ran inline, in their order, and the scripts the
 * answer may not carry.
 */
import { describe, expect, it, vi } from 'vitest';
import { REPAIR_ORDER, repairRepx, stripReportScripts } from './repairChain';
import { normalizeItemNames } from './repxItems';
import { ensureUniqueRefs } from './repxRefs';
import { repairDpi } from './repxDpi';
import { repairPaper } from './repxPaper';
import { liftReportMargins } from './repxMargins';
import { liftParameterTypes } from './repxParameters';
import { repairSummaries } from './repxSummaries';
import { repairGroupLevels } from './repxGroups';
import { repairCrossTabs } from './repxCrossTabs';
import { stripStoredCredentials } from './repxSqlDataSource';
import { liftStyles } from './repxStyles';
import { hasReportScripts } from './shares';

const REPORT = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="23.2.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v23.2" Name="Report1" ScriptsSource="private void Report1_BeforePrint(object s, System.EventArgs e) { }" ReportUnit="TenthsOfAMillimeter" Margins="0, 0, 0, 0" PageWidth="2100" PageHeight="2970" PaperKind="A4" Version="23.2">
  <Scripts Ref="9" OnBeforePrint="Report1_BeforePrint" />
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="0" />
    <Item2 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="300">
      <Controls>
        <Item1 Ref="3" ControlType="XRLabel" Name="title" Text="Invoice" LocationFloat="200,100" SizeF="800,80" Font="Arial, 18pt, style=Bold" />
        <Item1 Ref="3" ControlType="XRLabel" Name="sub" Text="Customer" LocationFloat="200,200" SizeF="800,60" Font="Arial, 12pt" />
      </Controls>
    </Item2>
    <Item3 Ref="5" ControlType="DetailBand" Name="Detail" HeightF="60" />
    <Item4 Ref="6" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="0" />
  </Bands>
</XtraReportsLayoutSerializer>`;

describe('the repair chain', () => {
  it('runs the passes in the order the generation always did', () => {
    expect([...REPAIR_ORDER]).toEqual([
      'items', 'refs', 'dpi', 'paper', 'margins', 'overlaps', 'parameters', 'totals', 'groups', 'cross-tabs', 'data source', 'logins', 'scripts', 'styles',
    ]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { steps } = repairRepx(REPORT, { version: '23.2' });
    // No description and no earlier report: overlaps and the carried data source do not run.
    expect(steps.map((s) => s.name)).toEqual(REPAIR_ORDER.filter((n) => n !== 'overlaps' && n !== 'data source'));
    expect(repairRepx(REPORT, { version: '23.2', description: true, previous: REPORT }).steps.map((s) => s.name)).toEqual([...REPAIR_ORDER]);
  });

  it('changes nothing the inline passes did not, apart from the scripts', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    let byHand = REPORT;
    for (const pass of [normalizeItemNames, ensureUniqueRefs, repairDpi, repairPaper, liftReportMargins, (x: string) => liftParameterTypes(x, '23.2'), repairSummaries, repairGroupLevels, repairCrossTabs, stripStoredCredentials, stripReportScripts, liftStyles]) {
      const r = pass(byHand);
      if (r.applied) byHand = r.xml;
    }
    expect(repairRepx(REPORT, { version: '23.2' }).xml).toBe(byHand);
  });

  it('takes out code the answer carried, and keeps code the user brought', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const stripped = repairRepx(REPORT, { version: '23.2' }).xml;
    expect(hasReportScripts(stripped)).toBe(false);
    expect(stripped).not.toContain('<Scripts');
    expect(stripped).toContain('Text="Invoice"');
    const kept = repairRepx(REPORT, { version: '23.2', keepScripts: true }).xml;
    expect(kept).toContain('ScriptsSource=');
    expect(kept).toContain('<Scripts Ref="9" OnBeforePrint="Report1_BeforePrint" />');
  });

  it('removes a Scripts element with content as well, and leaves a report without any untouched', () => {
    const withBody = '<Item1 Ref="3" ControlType="XRLabel" Name="a"><Scripts Ref="4" OnBeforePrint="a_BeforePrint"></Scripts></Item1>';
    expect(stripReportScripts(withBody)).toMatchObject({ applied: true, xml: '<Item1 Ref="3" ControlType="XRLabel" Name="a"></Item1>' });
    expect(stripReportScripts('<Item1 Ref="3" />')).toMatchObject({ applied: false, xml: '<Item1 Ref="3" />' });
  });
});
