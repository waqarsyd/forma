// @vitest-environment jsdom
/**
 * The REPX pane's account of what the report kept of the page (2026-11-10,
 * the AI accuracy programme, batch AD; lib/readCoverage.ts): the texts on the
 * page the report left out, named, silent when nothing was. The count of
 * what was read beside it, "kept 14/16 read", went on 2026-11-11 (the full
 * audit's CV-12): a readout of the reading, not of the report.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import RepxViewer from './RepxViewer';
import { forgetInspectionsForTests, keepInspection } from '../lib/designerBridge';
import type { RepxAudit } from '../lib/repxAudit';

afterEach(cleanup);
// What one test kept for XML would otherwise still be there for the next.
afterEach(forgetInspectionsForTests);

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

/*
 * A line is drawn as wide as its own text (2026-11-11, the full audit's PERF
 * batch, PR-06's review): `content-visibility: auto` clips a line to its box,
 * and the pane's width is counted in `ch`, which a Japanese or Arabic label
 * set in a fallback face outgrows. jsdom lays nothing out, so this holds the
 * style that prevents the clip rather than measuring one.
 */
describe('a long line in another script', () => {
  it('sizes its line to the text, never narrower than the pane', () => {
    const label = '請求書の合計金額と支払期日 فاتورة المبلغ الإجمالي'.repeat(6);
    const xml = XML.replace('HeightF="20" />', `HeightF="20"><Controls><Item1 Ref="3" ControlType="XRLabel" Name="label1" Text="${label}" /></Controls></Item1>`);
    const { container } = render(<RepxViewer xml={xml} />);
    const line = Array.from(container.querySelectorAll<HTMLElement>('pre > div')).find((div) => div.textContent?.includes(label));
    expect(line).toBeTruthy();
    const style = line!.getAttribute('style') ?? '';
    expect(style).toMatch(/width:\s*max-content/);
    expect(style).toMatch(/min-width:\s*100%/);
  });
});

/*
 * The re-audit's R1-02 and R1-07 (2026-11-11): a report with no file says so
 * in downloadDesign's words, with no model and no plain-text export that
 * Export no longer makes; and the pane carries no token count.
 */
describe('in plain words', () => {
  it('says a report has no .repx file yet, and what to do', () => {
    const { container } = render(<RepxViewer xml="" />);
    expect(screen.getByText('This report has no .repx file yet.')).toBeTruthy();
    expect(screen.getByText('Send the request again to make one.')).toBeTruthy();
    expect(container.textContent).not.toMatch(/model|plain-text|DevExpress XML/i);
  });

  it('shows no token count beside the file', () => {
    const { container } = render(<RepxViewer xml={XML} />);
    expect(container.textContent).not.toMatch(/tokens?\b/i);
  });
});

/*
 * What DevExpress found, asked once the report is on screen (2026-11-11, the
 * full audit's PERF batch): it arrives while the pane is open, joins the
 * audit's list, and belongs to the file it was asked about alone.
 */
describe('what DevExpress found', () => {
  const clean = { ok: true, errors: 0, warnings: 0, findings: [], summary: '' } as unknown as RepxAudit;
  const lost = { severity: 'error' as const, code: 'designer-lost-controls', message: 'DevExpress could not build one part of the report (tableHead), so it is missing when it opens.' };

  it('joins the list when it arrives, for this file only', () => {
    const { container } = render(<RepxViewer xml={XML} audit={clean} />);
    expect(container.querySelector('[data-audit]')).toBeNull();
    act(() => keepInspection(`${XML} `, [lost]));
    expect(container.querySelector('[data-audit]')).toBeNull();
    act(() => keepInspection(XML, [lost]));
    expect(screen.getByText('1 REPX error')).toBeTruthy();
    expect(screen.getByText(lost.message)).toBeTruthy();
  });
});
