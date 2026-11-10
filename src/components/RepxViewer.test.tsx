// @vitest-environment jsdom
/**
 * The REPX pane's account of what the report kept of the page (2026-11-10,
 * the AI accuracy programme, batch AD; lib/readCoverage.ts): a readout beside
 * the usage, and the texts left out, named, silent when nothing was.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import RepxViewer from './RepxViewer';

afterEach(cleanup);

const XML = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Report1" ReportUnit="HundredthsOfAnInch" PageWidth="850" PageHeight="1100" Version="20.1">
  <Bands><Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="20" /></Bands>
</XtraReportsLayoutSerializer>`;

describe('what the report kept of the page', () => {
  it('reads out the share kept and names each text left out', () => {
    const { container } = render(<RepxViewer xml={XML} coverage={{ captions: 16, kept: 14, missing: ['Unit Price', 'Total Due'], sameBand: 9 }} />);
    expect(container.querySelector('[data-readout="kept"]')?.textContent).toBe('kept 14/16 read');
    expect(screen.getByText('2 texts Forma read on the page are not in the report')).toBeTruthy();
    expect(screen.getByText('Unit Price')).toBeTruthy();
    expect(screen.getByText('Total Due')).toBeTruthy();
  });

  it('says nothing more when the report kept it all, and nothing at all without a draft', () => {
    const { container, rerender } = render(<RepxViewer xml={XML} coverage={{ captions: 5, kept: 5, missing: [], sameBand: 5 }} />);
    expect(container.querySelector('[data-readout="kept"]')?.textContent).toBe('kept 5/5 read');
    expect(container.querySelector('[data-missing]')).toBeNull();
    rerender(<RepxViewer xml={XML} />);
    expect(container.querySelector('[data-readout="kept"]')).toBeNull();
  });
});
