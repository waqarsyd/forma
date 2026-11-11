// @vitest-environment jsdom
/**
 * The REPX pane's account of what the report kept of the page (2026-11-10,
 * the AI accuracy programme, batch AD; lib/readCoverage.ts): the texts on the
 * page the report left out, named, silent when nothing was. The count of
 * what was read beside it, "kept 14/16 read", went on 2026-11-11 (the full
 * audit's CV-12): a readout of the reading, not of the report.
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
  it('names each text on the page left out, with no count of what was read', () => {
    const { container } = render(<RepxViewer xml={XML} coverage={{ captions: 16, kept: 14, missing: ['Unit Price', 'Total Due'], sameBand: 9 }} />);
    expect(container.querySelector('[data-readout="kept"]')).toBeNull();
    expect(screen.getByText('2 texts on your page are not in the report')).toBeTruthy();
    expect(screen.getByText('Unit Price')).toBeTruthy();
    expect(screen.getByText('Total Due')).toBeTruthy();
    expect(container.textContent).not.toMatch(/kept \d+\/\d+|Forma read/);
  });

  it('says nothing when the report kept it all, and nothing without a draft', () => {
    const { container, rerender } = render(<RepxViewer xml={XML} coverage={{ captions: 5, kept: 5, missing: [], sameBand: 5 }} />);
    expect(container.querySelector('[data-missing]')).toBeNull();
    expect(container.querySelector('[data-readout="kept"]')).toBeNull();
    rerender(<RepxViewer xml={XML} />);
    expect(container.querySelector('[data-missing]')).toBeNull();
  });

  it('says one text in the singular', () => {
    render(<RepxViewer xml={XML} coverage={{ captions: 3, kept: 2, missing: ['Notes'], sameBand: 2 }} />);
    expect(screen.getByText('1 text on your page is not in the report')).toBeTruthy();
  });
});
