/**
 * An Excel template's layout read into Forma's draft (2026-11-11, the full
 * audit's CP-11), on a made-up workbook: a bold title merged across four
 * columns, a subtitle, a bold heading row, a row of placeholders and two rows
 * of data, an A4 landscape page with half-inch margins.
 */
import { describe, expect, it } from 'vitest';
import { readXlsxTemplate, xlsxDraft } from './xlsxLayout';
import { textToDraft } from './draftText';
import { buildZip } from './zip';

const STRINGS = ['Stock on hand', 'By warehouse, as of today', 'Item', 'Warehouse', 'Quantity', 'Value', '{{ItemName}}', 'Chai', 'North'];
const s = (n: number, ref: string, style = 0) => `<c r="${ref}" t="s" s="${style}"><v>${n}</v></c>`;

const SHEET = `<worksheet>
<sheetFormatPr defaultRowHeight="15"/>
<cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="15" customWidth="1"/><col min="3" max="4" width="12" customWidth="1"/></cols>
<sheetData>
<row r="1" ht="24" customHeight="1">${s(0, 'A1', 1)}</row>
<row r="2">${s(1, 'A2', 3)}</row>
<row r="4">${s(2, 'A4', 2)}${s(3, 'B4', 2)}${s(4, 'C4', 4)}${s(5, 'D4', 4)}</row>
<row r="5">${s(6, 'A5')}<c r="B5" t="inlineStr"><is><t>{{Warehouse}}</t></is></c><c r="C5" t="inlineStr"><is><t>[Qty]</t></is></c></row>
<row r="6">${s(7, 'A6')}${s(8, 'B6')}<c r="C6"><v>12</v></c><c r="D6"><v>216</v></c></row>
</sheetData>
<mergeCells count="1"><mergeCell ref="A1:D1"/></mergeCells>
<pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape"/>
</worksheet>`;

const STYLES = `<styleSheet>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<cellXfs count="5"><xf fontId="0"/><xf fontId="1"><alignment horizontal="center"/></xf><xf fontId="2"/><xf fontId="0"><alignment horizontal="left"/></xf><xf fontId="2"><alignment horizontal="right"/></xf></cellXfs>
</styleSheet>`;

function xlsx(sheet = SHEET): Uint8Array {
  return buildZip(
    [
      { name: 'xl/sharedStrings.xml', content: `<sst>${STRINGS.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>` },
      { name: 'xl/styles.xml', content: STYLES },
      { name: 'xl/worksheets/sheet1.xml', content: sheet },
    ],
    new Date(),
    { keepPaths: true },
  ).bytes!;
}

describe('readXlsxTemplate', () => {
  it('reads the paper, its orientation and the margins', async () => {
    const page = (await readXlsxTemplate(xlsx()))!;
    expect([page.width, page.height]).toEqual([1169, 827]);
    expect(page.margins).toEqual({ top: 50, bottom: 50, left: 50, right: 50 });
  });

  it('reads the rows above the headings as the header, a merged title across its columns', async () => {
    const page = (await readXlsxTemplate(xlsx()))!;
    expect(page.before.map((t) => t.text)).toEqual(['Stock on hand', 'By warehouse, as of today']);
    // 30, 15, 12 and 12 characters wide: 215, 110, 89 and 89 pixels at 96 dpi, 525 hundredths in all.
    expect(page.before[0]).toMatchObject({ family: 'Arial', size: 16, bold: true, align: 'center', x: 0, w: 525 });
    expect(page.before[1]).toMatchObject({ w: 224, bold: false });
  });

  it('reads the headings and the record under them, with the column widths, and leaves the data out', async () => {
    const table = (await readXlsxTemplate(xlsx()))!.table!;
    expect(table.widths).toEqual([224, 115, 93, 93]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].cells.map((c) => c.text)).toEqual(['Item', 'Warehouse', 'Quantity', 'Value']);
    expect(table.rows[0].cells[2]).toMatchObject({ bold: true, align: 'right' });
    expect(table.rows[1].cells.map((c) => c.text)).toEqual(['{{ItemName}}', '{{Warehouse}}', '[Qty]', '']);
  });

  it('reads a formatted empty row written self-closing as a row of its own', async () => {
    // Row 3 is empty but formatted, so Excel writes it as <row .../>; the headings stay row 4.
    const sheet = SHEET.replace('<row r="4">', '<row r="3" ht="5" customHeight="1"/>\n<row r="4">');
    const table = (await readXlsxTemplate(xlsx(sheet)))!.table!;
    expect(table.rows[0].cells.map((c) => c.text)).toEqual(['Item', 'Warehouse', 'Quantity', 'Value']);
    expect(table.rows[1].cells.map((c) => c.text)).toEqual(['{{ItemName}}', '{{Warehouse}}', '[Qty]', '']);
  });

  it('is null for a workbook with no worksheet or nothing written on it', async () => {
    const empty = buildZip([{ name: 'xl/workbook.xml', content: '<workbook/>' }], new Date(), { keepPaths: true }).bytes!;
    expect(await readXlsxTemplate(empty)).toBeNull();
    expect(await readXlsxTemplate(xlsx('<worksheet><sheetData/></worksheet>'))).toBeNull();
    expect(await xlsxDraft(new Uint8Array([0, 1]))).toBeNull();
  });
});

describe('xlsxDraft', () => {
  it('writes the draft, the record bound to its placeholders and else to its headings', async () => {
    const draft = (await xlsxDraft(xlsx()))!;
    expect(draft.split('\n')[0]).toBe('page A4 landscape 1169 827 50 50 50 50');
    expect(draft).toContain('label title 0 0 525 33 Arial:16b c 0 13 "Stock on hand"');
    expect(draft).toContain('row value 1.71 Calibri:11 l 0 [ItemName] | value 0.88 Calibri:11 l 0 [Warehouse] | value 0.71 Calibri:11 l 0 [Qty] | value 0.71 Calibri:11 l 0 [Value]');
    const back = textToDraft(draft);
    expect(back.problems).toEqual([]);
    expect(back.skeleton?.bands.map((b) => b.kind)).toEqual(['TopMargin', 'ReportHeader', 'PageHeader', 'Detail', 'BottomMargin']);
  });

  it('lays out a sheet with no heading row as its lines alone', async () => {
    const draft = (await xlsxDraft(xlsx(`<worksheet><sheetData><row r="1">${s(0, 'A1', 1)}</row></sheetData></worksheet>`)))!;
    // Letter portrait, with Excel's own margins, when the sheet names no page.
    expect(draft.split('\n')[0]).toBe('page Letter portrait 850 1100 75 75 70 70');
    expect(draft).toContain('"Stock on hand"');
    expect(draft).not.toMatch(/^table/m);
  });
});
