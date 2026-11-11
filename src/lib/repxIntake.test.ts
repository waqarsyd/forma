import { describe, expect, it } from 'vitest';
import {
  AI_PICTURE_TYPES,
  crystalNotice,
  evidenceMarkdown,
  evidenceSummary,
  inUnit,
  isTiff,
  LOGIN_REMOVED_NOTICE,
  pdfPageText,
  pdfPagesNotice,
  pdfPagesToRead,
  pdfTextItems,
  pictureKey,
  pictureNeed,
  rdlAttachment,
  repxAttachment,
  tiffNotice,
  transform,
} from './repxIntake';
import { decodeBase64, encodeBase64 } from './repxSqlDataSource';

/*
 * What a file brings in (2026-11-11, the full audit's PIPE1): the parts of
 * the intake a test can read without a browser. Drawing a page or a picture
 * needs a canvas and is checked in the owner's Chrome.
 */

describe('the pages of a long PDF (CP-04)', () => {
  it('reads every page up to the most, and past it the first ones and the last', () => {
    expect(pdfPagesToRead(3, 8)).toEqual([1, 2, 3]);
    expect(pdfPagesToRead(8, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // The last page carries the totals and the closing footer.
    expect(pdfPagesToRead(20, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 20]);
    expect(pdfPagesToRead(0, 8)).toEqual([]);
  });

  it('says which were read', () => {
    expect(pdfPagesNotice('ledger.pdf', 20, 8)).toBe('"ledger.pdf" has 20 pages; the first 7 and the last were read.');
  });
});

describe("a PDF page's text (PL-18)", () => {
  // pdf.js's scale-1 viewport of a 612 x 792 point page: upright, and turned 90 degrees.
  const upright = { width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] };
  const turned = { width: 792, height: 612, transform: [0, 1, 1, 0, 0, 0] };

  it('places a string on an upright page by its baseline, one em up, in points', () => {
    const page = pdfTextItems(upright, [{ str: ' Invoice ', transform: [12, 0, 0, 12, 72, 700], width: 48, height: 12 }], 1);
    expect(page.items).toEqual([{ text: 'Invoice', x: 72, y: 80, w: 48, h: 12 }]);
    expect([page.width, page.height]).toEqual([612, 792]);
  });

  it('places a string on a page saved turned where the page shows it', () => {
    // Text that reads left to right on the turned page runs up the unturned one.
    const page = pdfTextItems(turned, [{ str: 'Total', transform: [0, 12, -12, 0, 100, 72], width: 30, height: 12 }], 1);
    expect(page.items).toEqual([{ text: 'Total', x: 72, y: 88, w: 30, h: 12 }]);
    expect([page.width, page.height]).toEqual([792, 612]);
  });

  it("is pdf.js's own matrix product", () => {
    expect(transform([1, 0, 0, -1, 0, 792], [12, 0, 0, 12, 72, 700])).toEqual([12, 0, 0, -12, 72, 92]);
  });

  it('skips blank strings, and counts what passes the cap rather than keeping it', () => {
    const many = Array.from({ length: 405 }, (_, i) => ({ str: `w${i}`, transform: [10, 0, 0, 10, 0, 700], width: 10, height: 10 }));
    const page = pdfTextItems(upright, [{ str: '   ' }, ...many], 2);
    expect(page.items).toHaveLength(400);
    expect(page.omitted).toBe(5);
  });

  it('is written in the unit worked out when the message is sent', () => {
    const page = pdfTextItems(upright, [{ str: 'Invoice "No"', transform: [12, 0, 0, 12, 72, 700], width: 48, height: 12 }], 1);
    const inches = pdfPageText(page, 'HundredthsOfAnInch')!;
    expect(inches).toContain(`"Invoice 'No'" x=100 y=111 w=67 h=17`);
    expect(inches).toContain('Page is 850 x 1100 report units.');
    const mm = pdfPageText(page, 'TenthsOfAMillimeter')!;
    expect(mm).toContain('x=254 y=282 w=169 h=42');
    expect(mm).toContain('(TenthsOfAMillimeter)');
    expect(pdfPageText({ ...page, items: [] })).toBeNull();
  });

  it('writes again only the texts that are a PDF page, in the unit given', () => {
    const page = pdfTextItems(upright, [{ str: 'A', transform: [12, 0, 0, 12, 72, 700], width: 8, height: 12 }], 1);
    const texts = [
      { id: 'p1', text: pdfPageText(page, 'HundredthsOfAnInch')!, pdf: page },
      { id: 'csv', text: 'Name,Amount' },
    ];
    const out = inUnit(texts, 'TenthsOfAMillimeter');
    expect(out[0].text).toContain('x=254');
    expect(out[1]).toBe(texts[1]);
  });
});

describe('pictures the AI takes (PL-17)', () => {
  it('sends PNG, JPEG, WebP and HEIC as they are, and draws anything else again', () => {
    for (const type of AI_PICTURE_TYPES) expect(pictureNeed(type)).toBe('keep');
    for (const type of ['image/gif', 'image/bmp', 'image/tiff', 'image/svg+xml', 'image/avif']) expect(pictureNeed(type)).toBe('redraw');
    // A browser that gives no type: the name decides, and anything unknown is drawn again.
    expect(pictureNeed('', 'scan.PNG')).toBe('keep');
    expect(pictureNeed('', 'scan.jpeg')).toBe('keep');
    expect(pictureNeed('', 'scan.tif')).toBe('redraw');
  });

  it('knows a TIFF by its type or its name, and says what to do with one', () => {
    expect(isTiff('image/tiff', 'x')).toBe(true);
    expect(isTiff('', 'Scan.TIF')).toBe(true);
    expect(isTiff('image/png', 'x.png')).toBe(false);
    expect(tiffNotice('x.tif')).toBe('"x.tif" is a TIFF; save it as PNG or PDF and attach that.');
  });
});

describe("a page's reading key (PL-31b)", () => {
  it('is the same for the same picture and different for another', () => {
    const a = 'data:image/png;base64,AAAA';
    expect(pictureKey(a)).toBe(pictureKey(`${a}`));
    expect(pictureKey(a)).not.toBe(pictureKey('data:image/png;base64,AAAB'));
    expect(pictureKey(a)).toMatch(/^pic-[0-9a-z]+-[0-9a-z]+$/);
  });
});

describe('an uploaded .repx (SE-01)', () => {
  const source = (connection: string) =>
    `<SqlDataSource Name="sqlDataSource1">${connection}<Query Type="SelectQuery" Name="Orders"><Tables><Table Name="Orders" /></Tables><Columns><AllColumns /></Columns></Query></SqlDataSource>`;
  const report = (connection: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="R" DataSource="#Ref-0">` +
    `<Bands><Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="20" /></Bands>` +
    `<ComponentStorage><Item1 Ref="0" ObjectType="DevExpress.DataAccess.Sql.SqlDataSource,DevExpress.DataAccess.v20.1" Name="sqlDataSource1" Base64="${encodeBase64(source(connection))}" /></ComponentStorage>` +
    `</XtraReportsLayoutSerializer>`;
  const login = '<Connection Name="Sales" ProviderKey="MSSqlServer"><Parameters><Parameter Name="server" Value="db01" /><Parameter Name="database" Value="Sales" /><Parameter Name="userid" Value="sa" /><Parameter Name="password" Value="Secret123" /></Parameters></Connection>';

  it('never carries a database login to the AI, and says it was removed', () => {
    const read = repxAttachment('orders.repx', report(login));
    const stored = decodeBase64(/Base64="([^"]*)"/.exec(read.text)![1]);
    expect(stored).not.toMatch(/Secret123|Name="password"|Name="userid"/);
    expect(stored).toContain('<Connection Name="Sales" FromAppConfig="true" />');
    expect(read.text).toMatch(/^Existing DevExpress report \(orders\.repx\)\. Use this as the base structure/);
    expect(read.notices).toContain(LOGIN_REMOVED_NOTICE);
  });

  // The PIPE1 review: a custom connection string was cleaned and nothing was said.
  it('says so when the password was inside a custom connection string', () => {
    const custom = repxAttachment('orders.repx', report('<Connection Name="Sales" ConnectionString="XpoProvider=MSSqlServer;data source=db01;initial catalog=Sales;user id=sa;password=Secret123" />'));
    expect(decodeBase64(/Base64="([^"]*)"/.exec(custom.text)![1])).not.toContain('Secret123');
    expect(custom.notices).toContain(LOGIN_REMOVED_NOTICE);
    const trusted = repxAttachment('orders.repx', report('<Connection Name="Sales" ConnectionString="XpoProvider=MSSqlServer;data source=db01;initial catalog=Sales;integrated security=SSPI" />'));
    expect(trusted.notices).not.toContain(LOGIN_REMOVED_NOTICE);
  });

  it('says nothing of a login a report never had', () => {
    const byName = repxAttachment('orders.repx', report('<Connection Name="Sales" FromAppConfig="true" />'));
    expect(byName.notices).not.toContain(LOGIN_REMOVED_NOTICE);
    expect(decodeBase64(/Base64="([^"]*)"/.exec(byName.text)![1])).toContain('<Connection Name="Sales" FromAppConfig="true" />');
  });
});

describe('Crystal Reports and SSRS (CP-01a)', () => {
  it('sends a Crystal Reports file to its PDF', () => {
    expect(crystalNotice('Invoice.rpt')).toBe('"Invoice.rpt" is a Crystal Reports file. Export it from Crystal Reports as a PDF (File > Export) and attach the PDF.');
  });

  it('reads an SSRS definition as a layout to reproduce, its password taken out', () => {
    const text = rdlAttachment('Sales.rdl', '<Report><ConnectString>Data Source=db01;Initial Catalog=Sales;User ID=sa;Password=Secret123;</ConnectString></Report>');
    expect(text).toMatch(/^An SSRS report definition \(Sales\.rdl\); reproduce its layout as a DevExpress report:/);
    expect(text).not.toContain('Secret123');
    expect(text).toContain('Initial Catalog=Sales;');
  });

  // The PIPE1 review: the attribute form lost its name and kept its value, and broke the XML.
  it('takes a quoted password out whole, and leaves an embedded picture behind', () => {
    const text = rdlAttachment('Sales.rdl', '<Report><DataSource password="Secret123" Name="db"/><EmbeddedImages><EmbeddedImage Name="logo"><MIMEType>image/png</MIMEType><ImageData>iVBORw0KGgoAAAANSUhEUg==</ImageData></EmbeddedImage></EmbeddedImages></Report>');
    expect(text).not.toContain('Secret123');
    expect(text).toContain('<DataSource  Name="db"/>');
    expect(text).not.toContain('iVBORw0KGgo');
    expect(text).toContain('<ImageData>(an embedded picture)</ImageData>');
  });
});

describe('what the page shows the report lacks (PL-11b)', () => {
  // The PIPE1 review: the general fallback said a table drawn as texts "will not print as drawn", which is untrue.
  it('says a table drawn as separate texts in a sentence of its own', () => {
    const said = evidenceMarkdown([{ code: 'grid-not-a-table' }]);
    expect(said).toBe('**Compared with your page**\n- A table on your page came out as separate texts, so its columns cannot be bound to data or repeat for each record.');
    expect(said).not.toContain('will not print as drawn');
  });

  it('says each thing once, and nothing for a code it has no sentence for', () => {
    expect(evidenceMarkdown([{ code: 'no-detail-band' }, { code: 'no-detail-band' }]).split('\n')).toHaveLength(2);
    expect(evidenceMarkdown([{ code: 'band-order' }])).toBe('');
    expect(evidenceMarkdown([])).toBe('');
  });

  it('counts them in the summary in words, never by code', () => {
    expect(evidenceSummary('1 warning', 0)).toBe('1 warning');
    expect(evidenceSummary('1 warning', 1)).toBe('1 warning; and 1 thing your page shows the report lacks');
    expect(evidenceSummary('ok', 2)).not.toMatch(/grid-not-a-table|no-detail-band/);
  });
});
