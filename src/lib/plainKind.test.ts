/**
 * A part and a band in plain words (2026-11-11, full audit PX-06): what the
 * Preview's toast and the chat's list of changes call them, so no class name
 * reaches a sentence.
 */
import { describe, expect, it } from 'vitest';
import { plainBand, plainKind } from './plainKind';

describe('plainKind', () => {
  it('names each control type as a person would', () => {
    const named: [string, string][] = [
      ['XRLabel', 'label'],
      ['XRTable', 'table'],
      ['XRTableCell', 'cell'],
      ['XRPanel', 'panel'],
      ['XRPictureBox', 'picture'],
      ['XRLine', 'line'],
      ['XRPageInfo', 'page number'],
      ['XRChart', 'chart'],
      ['XRCrossTab', 'cross-tab'],
      ['XRSubreport', 'subreport'],
      ['XRBarCode', 'barcode'],
      ['XRCheckBox', 'check box'],
      ['XRShape', 'shape'],
      ['XRRichText', 'rich text'],
      ['XRCharacterComb', 'character boxes'],
    ];
    for (const [type, word] of named) expect(plainKind(type)).toBe(word);
  });

  it('reads a fully qualified type the same', () => {
    expect(plainKind('DevExpress.XtraReports.UI.XRLabel')).toBe('label');
  });

  it('splits a type it does not list into words, and calls anything else a part', () => {
    expect(plainKind('XRPdfSignature')).toBe('pdf signature');
    expect(plainKind('SomethingElse')).toBe('part');
    expect(plainKind('')).toBe('part');
    expect(plainKind(undefined)).toBe('part');
  });

  it('never returns a class name', () => {
    for (const type of ['XRLabel', 'XRUnknownThing', 'XR', 'Label', 'XRTableOfContents']) expect(plainKind(type)).not.toMatch(/XR|[A-Z]/);
  });
});

describe('plainBand', () => {
  it('names a band by its kind or by the name the designer gives it', () => {
    expect(plainBand('PageHeader')).toBe('the page header');
    expect(plainBand('pageHeaderBand1')).toBe('the page header');
    expect(plainBand('GroupHeader1')).toBe('the group header');
    expect(plainBand('GroupFooter2')).toBe('the group footer');
    expect(plainBand('Detail')).toBe('the detail band');
    expect(plainBand('TopMargin')).toBe('the top margin');
    expect(plainBand('BottomMargin1')).toBe('the bottom margin');
    expect(plainBand('ReportHeader')).toBe('the report header');
    expect(plainBand('ReportFooter')).toBe('the report footer');
    expect(plainBand('PageFooter')).toBe('the page footer');
    expect(plainBand('DetailReport')).toBe('the detail report');
    expect(plainBand('DetailBand1')).toBe('the detail band');
  });

  // Looked up before "Band" is taken off too, or `SubBand1` was said as `the band "SubBand1"` (2026-11-11).
  it('names a sub-band', () => {
    expect(plainBand('SubBand1')).toBe('the extra band');
    expect(plainBand('SubBand')).toBe('the extra band');
  });

  it('says a name of its own as it is', () => {
    expect(plainBand('Totals')).toBe('the band "Totals"');
    expect(plainBand('')).toBe('the band');
  });
});
