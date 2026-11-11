/**
 * What an export asked of the Preview becomes (2026-11-11, the full audit's
 * PX-13, CV-17, PX-17 and PX-20, batch PXB): which PDF path it takes, what is
 * said while it is written, the one download several formats make, and the
 * reply that says what was saved.
 */
import { describe, expect, it } from 'vitest';
import { bundleName, isScriptRefusal, jobFormats, printFallbackNote, printsInBrowser, replyAfterExport, savedSentence, writingNotice } from './exportJob';
import { unprintableReason, type PdfPage } from './pdfWriter';

describe('which PDF a job writes', () => {
  it('prints in the browser only for one PDF chosen outside the chat, from a report with no password or PDF/A', () => {
    expect(printsInBrowser({ formats: ['pdf'] }, false)).toBe(true);
    // Asked in the chat: a file in the downloads, not a print dialog (CV-17).
    expect(printsInBrowser({ formats: ['pdf'], reply: 'm1' }, false)).toBe(false);
    // A password or PDF/A: printing can do neither (PX-13).
    expect(printsInBrowser({ formats: ['pdf'] }, true)).toBe(false);
    // Among several: a file in the .zip.
    expect(printsInBrowser({ formats: ['pdf', 'docx'] }, false)).toBe(false);
    expect(printsInBrowser({ formats: ['pdf-outline'] }, false)).toBe(false);
  });

  it('keeps each format once, in the order asked, and one PDF where both were asked among others', () => {
    expect(jobFormats(['docx', 'rtf', 'docx'])).toEqual(['docx', 'rtf']);
    expect(jobFormats(['pdf', 'csv', 'pdf-outline'])).toEqual(['csv', 'pdf-outline']);
    expect(jobFormats(['pdf'])).toEqual(['pdf']);
  });
});

describe('what is said', () => {
  it('says what is being written while it takes a moment, and nothing for a file written at once', () => {
    expect(writingNotice(['pdf'])).toBe('Writing the PDF…');
    expect(writingNotice(['docx', 'rtf'])).toBe('Writing the Word document and the RTF file…');
    expect(writingNotice(['csv', 'png', 'html', 'pdf-outline'])).toBe('Writing the picture, the web page and the PDF…');
    expect(writingNotice(['csv', 'xlsx'])).toBeNull();
  });

  it('names the one download: the file itself, or a .zip after the report', () => {
    expect(bundleName('Invoice', ['Invoice.pdf'])).toBe('Invoice.pdf');
    expect(bundleName('Monthly Invoice', ['Monthly_Invoice.docx', 'Monthly_Invoice.rtf'])).toBe('Monthly_Invoice.zip');
    expect(bundleName('Invoice', [])).toBeNull();
  });

  it('says where the file went, and what a .zip holds', () => {
    expect(savedSentence('Invoice.pdf', ['Invoice.pdf'])).toBe('Saved Invoice.pdf to your downloads.');
    expect(savedSentence('Invoice.zip', ['Invoice.docx', 'Invoice.rtf'])).toBe('Saved Invoice.zip to your downloads, with Invoice.docx and Invoice.rtf in it.');
    expect(savedSentence('Invoice.zip', ['Invoice.csv', 'Invoice.docx', 'Invoice.rtf'])).toBe('Saved Invoice.zip to your downloads, with Invoice.csv, Invoice.docx and Invoice.rtf in it.');
  });

  it('replaces the reply\'s "Exporting it as" sentences with what was saved, once', () => {
    expect(replyAfterExport('Exporting it as a PDF.', 'Saved Invoice.pdf to your downloads.')).toBe('Saved Invoice.pdf to your downloads.');
    expect(replyAfterExport('Done. Exporting it as a Word document. Exporting it as an RTF file.', 'Saved Invoice.zip to your downloads.')).toBe(
      'Done. Saved Invoice.zip to your downloads.',
    );
    // The .repx is downloaded elsewhere, so its sentence stays.
    expect(replyAfterExport('Exporting it as a .repx file. Exporting it as a PDF.', 'Saved R.pdf to your downloads.')).toBe(
      'Exporting it as a .repx file. Saved R.pdf to your downloads.',
    );
    // None said: the sentence is added; a $ in it is kept as written.
    expect(replyAfterExport('Here it is.', 'Saved $&.pdf to your downloads.')).toBe('Here it is.\n\nSaved $&.pdf to your downloads.');
  });
});

describe('a script Forma\'s PDF cannot hold', () => {
  it('recognises the writer\'s own refusal, and no other failure', () => {
    // The writer's sentence itself, from a page of Arabic and no faces.
    const page: PdfPage = { width: 100, height: 100, ops: [{ kind: 'text', x: 0, y: 0, size: 10, font: 'Helvetica', colour: [0, 0, 0], text: 'مرحبا', scale: 1 }] } as PdfPage;
    const reason = unprintableReason([page], null)!;
    expect(reason).toMatch(/Arabic/);
    expect(isScriptRefusal(reason)).toBe(true);
    expect(isScriptRefusal('The letters this PDF needs could not be loaded. Check the connection and try again.')).toBe(false);
  });

  it('says it printed instead, naming the script, and that a print carries no password', () => {
    const reason = 'This report has Arabic text that PDF with outline cannot hold; PDF keeps it as shown.';
    expect(printFallbackNote(reason, false)).toBe("This report has Arabic text that a PDF file from Forma can't hold, so it opened to print instead: choose Save as PDF there.");
    expect(printFallbackNote('This report has text that PDF with outline cannot hold; PDF keeps it as shown.', true)).toBe(
      "This report has text that a PDF file from Forma can't hold, so it opened to print instead: choose Save as PDF there. The printed copy has no password.",
    );
  });
});
