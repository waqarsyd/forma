/** Data files attached in the chat (2026-11-05): what each gives the AI. */
import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { buildZip, crc32 } from './zip';
import { isDataFile, MAX_ROWS, parseDelimited, readDataFile, unzip } from './dataFiles';

const bytes = (s: string) => new TextEncoder().encode(s);

/** One deflated entry, as Office writes them, which buildZip (stored only) does not. */
function deflatedZip(name: string, content: string): Uint8Array {
  const data = bytes(content);
  const packed = new Uint8Array(deflateRawSync(data));
  const nameBytes = bytes(name);
  const local = new Uint8Array(30 + nameBytes.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(14, crc32(data), true);
  lv.setUint32(18, packed.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(16, crc32(data), true);
  cv.setUint32(20, packed.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, 0, true);
  central.set(nameBytes, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + packed.length, true);
  const out = new Uint8Array(local.length + packed.length + central.length + end.length);
  out.set(local, 0);
  out.set(packed, local.length);
  out.set(central, local.length + packed.length);
  out.set(end, local.length + packed.length + central.length);
  return out;
}

describe('isDataFile', () => {
  it('takes the data and document kinds, and leaves images, PDFs and reports to their own paths', () => {
    for (const name of ['orders.CSV', 'a.tsv', 'b.json', 'notes.txt', 'schema.sql', 'Sales.xlsx', 'Brief.docx']) expect(isDataFile(name)).toBe(true);
    for (const name of ['scan.png', 'invoice.pdf', 'Invoice.repx', 'old.xls']) expect(isDataFile(name)).toBe(false);
  });
});

describe('parseDelimited', () => {
  it('honours quotes, doubled quotes, line breaks inside quotes and Windows line ends, and drops blank rows', () => {
    expect(parseDelimited('Name,Note\r\n"Acme, Ltd","said ""hi""\nthen left"\r\n\r\nB,x', ',')).toEqual([
      ['Name', 'Note'],
      ['Acme, Ltd', 'said "hi"\nthen left'],
      ['B', 'x'],
    ]);
  });
});

describe('readDataFile', () => {
  it('gives a CSV as its fields and first rows, says the columns are the report\'s fields, and counts the rest', async () => {
    const csv = ['OrderID,Customer,Amount', ...Array.from({ length: MAX_ROWS + 5 }, (_, i) => `${i + 1},Acme,${i * 10}`)].join('\n');
    const out = await readDataFile('orders.csv', bytes(csv));
    expect(out.text).toContain('DATA SOURCE (orders.csv)');
    expect(out.text).toContain('Fields: OrderID, Customer, Amount');
    expect(out.text).toContain(`the first ${MAX_ROWS} of ${MAX_ROWS + 5} rows`);
    expect(out.text).toContain('bind the detail rows');
    expect(out.text.split('\n').filter((l) => /^\d+,Acme,/.test(l))).toHaveLength(MAX_ROWS);
  });

  it('reads a JSON array of records as a table, the union of their keys as fields', async () => {
    const out = await readDataFile('people.json', bytes(JSON.stringify({ data: [{ Name: 'Ann', Age: 30 }, { Name: 'Bo', City: 'Pune' }] })));
    expect(out.text).toContain('Fields: Name, Age, City');
    expect(out.text).toContain('Bo,,Pune');
  });

  it('reads the first worksheet of a workbook, shared strings and numbers, and a sparse row in its columns', async () => {
    const zip = buildZip(
      [
        { name: 'xl/sharedStrings.xml', content: '<sst><si><t>Region</t></si><si><t>Total</t></si><si><t>North &amp; East</t></si></sst>' },
        { name: 'xl/worksheets/sheet1.xml', content: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>12.5</v></c></row></sheetData></worksheet>' },
      ],
      new Date(),
      { keepPaths: true },
    );
    const out = await readDataFile('Sales.xlsx', zip.bytes!);
    expect(out.text).toContain('Fields: Region, Total');
    expect(out.text).toContain('North & East,');
  });

  it('reads a Word document deflated as Office writes it, a table\'s cells joined', async () => {
    const doc = '<w:document><w:body><w:p><w:r><w:t>Invoice for each customer</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Price</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
    const files = await unzip(deflatedZip('word/document.xml', doc), () => true);
    expect(new TextDecoder().decode(files.get('word/document.xml'))).toBe(doc);
    const out = await readDataFile('Brief.docx', deflatedZip('word/document.xml', doc));
    expect(out.text).toContain('DOCUMENT (Brief.docx)');
    expect(out.text).toContain('Invoice for each customer');
    expect(out.text).toMatch(/Item\s*\|\s*Price/);
  });

  it('says what went wrong rather than throwing: bad JSON, an empty file, a file that is not a zip', async () => {
    expect((await readDataFile('x.json', bytes('{nope'))).note).toBe('"x.json" is not valid JSON.');
    expect((await readDataFile('x.txt', bytes('  '))).note).toBe('"x.txt" is empty.');
    expect((await readDataFile('x.xlsx', bytes('plain text'))).note).toBe('"x.xlsx" could not be read: not a zip archive.');
  });
});
