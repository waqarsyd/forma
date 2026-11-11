/**
 * A Word template's layout read into Forma's draft (2026-11-11, the full
 * audit's CP-11), on a made-up document: an A4 page with 0.75 in margins, a
 * title, a table of three columns whose second row holds merge placeholders,
 * a closing note, and a page header and footer.
 */
import { describe, expect, it } from 'vitest';
import { docxDraft, fieldOf, readDocxTemplate, wordParagraph } from './docxLayout';
import { textToDraft } from './draftText';
import { buildZip } from './zip';

const para = (text: string, rPr = '', jc = '') =>
  `<w:p>${jc ? `<w:pPr><w:jc w:val="${jc}"/></w:pPr>` : ''}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (text: string, rPr = '', jc = '') => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(text, rPr, jc)}</w:tc>`;

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${para('Monthly Sales &amp; Returns', '<w:rFonts w:ascii="Arial"/><w:b/><w:sz w:val="36"/>', 'center')}
${para('Prepared for the regional managers', '<w:i/><w:sz w:val="20"/>')}
<w:p/>
<w:tbl><w:tblPr><w:tblInd w:w="144" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4320"/><w:gridCol w:w="1440"/><w:gridCol w:w="2160"/></w:tblGrid>
<w:tr><w:trPr><w:trHeight w:val="432"/></w:trPr>${cell('Product', '<w:b/>')}${cell('Units', '<w:b/>', 'right')}${cell('Unit price', '<w:b/>', 'right')}</w:tr>
<w:tr>${cell('«ProductName»')}${cell('{{Quantity}}', '', 'right')}${cell('[UnitPrice]', '', 'right')}</w:tr>
<w:tr>${cell('Chai')}${cell('12')}${cell('18.00')}</w:tr>
</w:tbl>
${para('Figures exclude tax.', '<w:sz w:val="16"/>', 'right')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;

const STYLES = '<w:styles xmlns:w="x"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>';

function docx(document = DOCUMENT, extra: { name: string; content: string }[] = []): Uint8Array {
  return buildZip(
    [
      { name: 'word/document.xml', content: document },
      { name: 'word/styles.xml', content: STYLES },
      { name: 'word/header1.xml', content: `<w:hdr xmlns:w="x">${para('Northwind Traders', '<w:b/>')}</w:hdr>` },
      { name: 'word/footer1.xml', content: `<w:ftr xmlns:w="x">${para('Confidential', '', 'center')}</w:ftr>` },
      ...extra,
    ],
    new Date(),
    { keepPaths: true },
  ).bytes!;
}

describe('readDocxTemplate', () => {
  it('reads the page and margins from the last section, in hundredths of an inch', async () => {
    const page = (await readDocxTemplate(docx()))!;
    expect(page.width).toBe(827);
    expect(page.height).toBe(1169);
    expect(page.margins).toEqual({ top: 75, bottom: 75, left: 75, right: 75 });
  });

  it('reads the paragraphs before and after the table, with their size, weight and alignment', async () => {
    const page = (await readDocxTemplate(docx()))!;
    expect(page.before.map((t) => t.text)).toEqual(['Monthly Sales & Returns', 'Prepared for the regional managers']);
    expect(page.before[0]).toMatchObject({ family: 'Arial', size: 18, bold: true, align: 'center' });
    // The document default face and size for a run that sets none.
    expect(page.before[1]).toMatchObject({ family: 'Calibri', size: 10, italic: true, bold: false, align: 'left' });
    expect(page.after).toEqual([expect.objectContaining({ text: 'Figures exclude tax.', size: 8, align: 'right' })]);
    expect(page.header.map((t) => t.text)).toEqual(['Northwind Traders']);
    expect(page.footer.map((t) => t.text)).toEqual(['Confidential']);
  });

  it("reads the table's column widths, row height and cells", async () => {
    const table = (await readDocxTemplate(docx()))!.table!;
    expect(table.x).toBe(10);
    expect(table.widths).toEqual([300, 100, 150]);
    expect(table.rows[0].height).toBe(30);
    expect(table.rows[0].cells.map((c) => c.text)).toEqual(['Product', 'Units', 'Unit price']);
    expect(table.rows[0].cells[1]).toMatchObject({ bold: true, align: 'right' });
    expect(table.rows[1].cells.map((c) => c.text)).toEqual(['«ProductName»', '{{Quantity}}', '[UnitPrice]']);
  });

  it('is null for a zip that holds no Word document', async () => {
    const other = buildZip([{ name: 'xl/workbook.xml', content: '<workbook/>' }], new Date(), { keepPaths: true }).bytes!;
    expect(await readDocxTemplate(other)).toBeNull();
    expect(await docxDraft(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('wordParagraph', () => {
  it('takes a switched-off bold as not bold, and is null for an empty paragraph', () => {
    expect(wordParagraph(para('x', '<w:b w:val="0"/>'), { family: 'Calibri', size: 11 })?.bold).toBe(false);
    expect(wordParagraph('<w:p><w:r><w:t></w:t></w:r></w:p>', { family: 'Calibri', size: 11 })).toBeNull();
  });
});

describe('fieldOf', () => {
  it("is a merge placeholder's name, else the heading as one name", () => {
    expect(fieldOf('«Customer Name»', 'Customer')).toBe('CustomerName');
    expect(fieldOf('{{qty}}', 'Units')).toBe('qty');
    expect(fieldOf('', 'Unit price')).toBe('UnitPrice');
    expect(fieldOf('Chai', 'Product')).toBe('Product');
  });
});

describe('docxDraft', () => {
  it('writes the page, the bands and the table in the draft format, which reads back', async () => {
    const draft = (await docxDraft(docx()))!;
    expect(draft.split('\n')[0]).toBe('page A4 portrait 827 1169 75 75 75 75');
    expect(draft).toContain('label title 0 0 677 38 Arial:18b c 0 23 "Monthly Sales & Returns"');
    // The page header's paragraph, then the headings under it, at the widths the columns have.
    expect(draft).toContain('band PageHeader 53 0\nlabel caption 0 0 677 23 Calibri:11b l 0 17 "Northwind Traders"\ntable value 10 23 550 30');
    expect(draft).toContain('row caption 1.64 Calibri:11b l 7 "Product" | caption 0.55 Calibri:11b r 5 "Units" | caption 0.82 Calibri:11b r 10 "Unit price"');
    expect(draft).toContain('row value 1.64 Calibri:11 l 0 [ProductName] | value 0.55 Calibri:11 r 0 [Quantity] | value 0.82 Calibri:11 r 0 [UnitPrice]');
    expect(draft).toContain('"Figures exclude tax."');
    expect(draft).toContain('"Confidential"');
    const back = textToDraft(draft);
    expect(back.problems).toEqual([]);
    expect(back.skeleton?.bands.map((b) => b.kind)).toEqual(['TopMargin', 'ReportHeader', 'PageHeader', 'Detail', 'ReportFooter', 'PageFooter', 'BottomMargin']);
    // The table sits where the document indents it, as wide as its columns.
    const table = back.skeleton!.bands[3].controls[0];
    expect([table.x, table.w]).toEqual([10, 550]);
  });

  it('lays out a document with no table as its paragraphs, and is null for an empty one', async () => {
    const plain = `<w:document xmlns:w="x"><w:body>${para('Notes', '<w:sz w:val="28"/>')}${para('One line.')}</w:body></w:document>`;
    const draft = (await docxDraft(docx(plain)))!;
    // Letter with Word's one-inch margins when the file names no page.
    expect(draft.split('\n')[0]).toBe('page Letter portrait 850 1100 100 100 100 100');
    expect(draft).toContain('"Notes"');
    expect(draft).not.toMatch(/^table/m);
    const empty = buildZip([{ name: 'word/document.xml', content: '<w:document xmlns:w="x"><w:body><w:p/></w:body></w:document>' }], new Date(), { keepPaths: true }).bytes!;
    expect(await docxDraft(empty)).toBeNull();
  });
});
