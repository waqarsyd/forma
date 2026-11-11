import { describe, expect, it } from 'vitest';
import { isReportFile } from './reportFile';

const REPORT = 'Existing DevExpress report (a.repx). Use this as the base structure:\n\n<XtraReportsLayoutSerializer Ref="0"><Bands /></XtraReportsLayoutSerializer>';

describe('isReportFile: a report Forma builds on, the same for App and Batch (R3-08)', () => {
  it('takes a .repx, and an SSRS or FastReport file converted to one', () => {
    for (const file of ['a.repx', 'b.rdl', 'c.RDLC', 'd.frx']) expect(isReportFile({ file, text: REPORT })).toBe(true);
  });

  it('decides by the name alone when there is no text', () => {
    expect(isReportFile({ file: 'orders.rdl' })).toBe(true);
    expect(isReportFile({ file: 'orders.pdf' })).toBe(false);
    expect(isReportFile({})).toBe(false);
  });

  it('does not take an RDL that would not convert, which goes to the AI as a definition to reproduce', () => {
    expect(isReportFile({ file: 'orders.rdl', text: 'An SSRS report definition (orders.rdl); reproduce its layout as a DevExpress report:\n\n<Report />' })).toBe(false);
  });

  it('does not take a picture, a PDF or a data file, whatever its text', () => {
    expect(isReportFile({ file: 'scan.png', text: REPORT })).toBe(false);
    expect(isReportFile({ file: 'orders.csv', text: 'Id,Name' })).toBe(false);
  });
});
