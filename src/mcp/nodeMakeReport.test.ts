/**
 * A report made in Node, end to end (2026-11-24, the MCP work's wave 7): the
 * generation core's `makeReport` through every part nodeGeneration.ts hands
 * it, with only the AI stood in, on a picture drawn here with
 * @napi-rs/canvas and on two PDFs built here, one scanned and one with a
 * text layer. No fixture is read from disk, and no key is used.
 *
 * What is held: Forma's draft goes with the request for the AI to correct,
 * with a brief; the page is read by OCR, PaddleOCR where vendor/paddle holds
 * its pinned models and Tesseract otherwise (the case's title says which is
 * expected here: CI has no models, so it reads with Tesseract), and the case
 * checks the engine that read it from what the reading said, since a
 * PaddleOCR that fails gives the page to Tesseract with only a line in the
 * log (the wave-7 review's W7R-3); a PDF's text layer goes as it is; with
 * every AI failing, the draft that stands in is the one the core's own
 * `prepareTeam` makes again over the pages read and the settings worked out,
 * the paper the page's, and the refused request carried that draft, its brief
 * and OCR's evidence (wave 10, NODE-9: the fidelity benchmark's `--forma`
 * scores that stand-in and its draft before the repair chain, through
 * scripts/fidelity/formaDraft.ts, which this case calls); nothing is
 * written outside the test's own folder; and no storage is touched, as Node 26
 * would throw on a read (TST-12).
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_INVOICE_RESPONSE, type ReportConfig } from '../services/geminiService';
import { METRIC_FACES, registerFace } from './nodeFonts';
import { CLONE, nodeGeneration, type NodeGeneration } from './nodeGeneration';
import { fileFrom } from './nodeIntake';
import { pinnedModelsIn } from './nodePaddle';

const CONFIG = { version: '23.2', unit: 'HundredthsOfAnInch', pageSize: 'A4', customApiKey: 'stand-in' } as ReportConfig;
const ROWS = [
  ['Chai', '12', '18.00'],
  ['Chang', '10', '19.00'],
  ['Aniseed Syrup', '5', '10.00'],
];

/*
 * Drawn in Liberation Sans, the font the repository commits for PDF/A
 * (assets/pdf-fonts), so the page is the same on every machine, CI's Linux
 * included, whatever fonts it has. Each face with its weight and style, from
 * nodeFonts.ts's table (2026-11-24, GAP2-2): registered bare, the bold, the
 * last one in, drew the body text too.
 */
for (const face of METRIC_FACES.filter((f) => f.family === 'Arial')) registerFace(CLONE, face, 'Forma Test Sans');

/** An invoice page drawn at about 150 dpi, A4, as a scan or a screenshot would bring it. */
function invoicePage(): Canvas {
  const canvas = createCanvas(1240, 1754);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1240, 1754);
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 48px "Forma Test Sans"';
  ctx.fillText('INVOICE 1001', 100, 150);
  ctx.font = '28px "Forma Test Sans"';
  ctx.fillText('Customer: Alfreds Futterkiste', 100, 230);
  ctx.fillText('Item', 100, 330);
  ctx.fillText('Qty', 700, 330);
  ctx.fillText('Price', 950, 330);
  ROWS.forEach((row, i) => row.forEach((cell, c) => ctx.fillText(cell, [100, 700, 950][c], 400 + i * 50)));
  ctx.fillText('Total', 700, 600);
  ctx.fillText('47.00', 950, 600);
  return canvas;
}

/** A PDF of the given objects, the byte offsets of its cross-reference table counted as it is written. */
function pdfOf(objects: (string | Buffer)[]): Uint8Array {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), typeof body === 'string' ? Buffer.from(body, 'latin1') : body, Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`, 'latin1'));
  return new Uint8Array(Buffer.concat(parts));
}

/** A one-page scan: the invoice as a JPEG on a Letter page, with no text layer. */
function scannedPdf(): Uint8Array {
  const page = invoicePage();
  const jpeg = page.toBuffer('image/jpeg', 92);
  const draw = 'q 612 0 0 792 0 0 cm /Im1 Do Q';
  return pdfOf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>',
    `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`,
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, 'latin1'),
      jpeg,
      Buffer.from('\nendstream', 'latin1'),
    ]),
  ]);
}

/** A one-page digital PDF: its text in a text layer, in Helvetica, which it does not embed. */
function digitalPdf(): Uint8Array {
  const text = 'BT /F1 24 Tf 72 700 Td (INVOICE 1001) Tj ET BT /F1 12 Tf 72 650 Td (Chai 12 18.00) Tj ET';
  return pdfOf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

const ENGINE = pinnedModelsIn(join(CLONE, 'vendor', 'paddle')).ok ? 'paddle' : 'tesseract';
const ENGINE_NAME = ENGINE === 'paddle' ? 'PaddleOCR (vendor/paddle holds its pinned models)' : 'Tesseract (vendor/paddle holds no pinned models)';

describe('a report made in Node, with only the AI stood in', () => {
  let folder: string;
  let gen: NodeGeneration;
  const asked: unknown[][] = [];
  const storageReads: string[] = [];
  const saved: Record<string, PropertyDescriptor | undefined> = {};
  let cwdBefore: string[];
  /** The server's log, and the line OCR ends each reading with (lib/ocrRead.ts), for the case in hand. */
  const logged: string[] = [];
  const said: string[] = [];
  const log = (line: string) => logged.push(line);
  let debug: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logged.length = 0;
    said.length = 0;
  });

  /** The engine whose reading of the page was kept: PaddleOCR only where it says so and nothing fell back to Tesseract. */
  const engineThatRead = (): 'paddle' | 'tesseract' => {
    const fellBack = logged.some((l) => /PaddleOCR (did not read|read too little)/.test(l));
    const byPaddle = said.some((l) => /^OCR read the page as .* with PaddleOCR/.test(l));
    return byPaddle && !fellBack ? 'paddle' : 'tesseract';
  };

  beforeAll(async () => {
    debug = vi.spyOn(console, 'debug').mockImplementation((...args: unknown[]) => void said.push(args.map(String).join(' ')));
    folder = mkdtempSync(join(tmpdir(), 'forma-node-make-'));
    cwdBefore = readdirSync(process.cwd()).sort();
    // As Node 26 defines them: any read of either throws, and is counted here.
    for (const name of ['localStorage', 'sessionStorage']) {
      saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          storageReads.push(name);
          throw new Error(`${name} is not available without --localstorage-file`);
        },
      });
    }
    gen = await nodeGeneration({
      userFolder: folder,
      log,
      ask: async (...args: unknown[]) => {
        asked.push(args);
        return MOCK_INVOICE_RESPONSE;
      },
    });
  });

  afterAll(async () => {
    debug?.mockRestore();
    await gen?.close();
    for (const [name, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
    rmSync(folder, { recursive: true, force: true });
  });

  /** The request the stand-in AI was sent last: its words, its parts and its options. */
  const lastRequest = () => {
    const [words, parts, , , , , options] = asked[asked.length - 1] as [string, { text?: string; inlineData?: { mimeType: string } }[], unknown, unknown, unknown, unknown, { draft?: { text: string; texts: unknown[] } | null; formaBrief?: string }];
    return { words, parts, options };
  };

  it(`corrects Forma's draft of a picture, its page read by ${ENGINE_NAME}`, async () => {
    expect(gen.ocr).toBe(ENGINE);
    const png = invoicePage().toBuffer('image/png');
    const made = await gen.make({ files: [{ file: fileFrom('invoice.png', png), uploadId: 'u1' }], words: 'an invoice', config: CONFIG, signal: new AbortController().signal });
    expect(made).toMatchObject({ ok: true, pictures: 1, notices: [] });
    const { words, parts, options } = lastRequest();
    expect(words).toBe('an invoice');
    // Forma's draft for the AI to correct, and the brief it is told.
    expect(options.draft?.text).toMatch(/\bband\b/);
    expect(options.draft?.texts.length).toBeGreaterThan(0);
    expect(options.formaBrief?.trim()).not.toBe('');
    // OCR's reading of the page goes with it, and the picture itself.
    const read = parts.find((p) => p.text?.includes('READ BY OCR'))?.text ?? '';
    expect(read).toMatch(/INVOICE/);
    expect(read).toMatch(/Chai/);
    expect(parts.some((p) => p.inlineData?.mimeType === 'image/png')).toBe(true);
    // Read by the engine the title names, not by Tesseract standing in for a PaddleOCR that failed.
    expect(engineThatRead()).toBe(ENGINE);
  }, 180_000);

  it(`draws a scanned PDF's page, and corrects Forma's draft of it, read by ${ENGINE_NAME}`, async () => {
    const made = await gen.make({ files: [{ file: fileFrom('scan.pdf', scannedPdf()), uploadId: 'u2' }], words: '', config: CONFIG, signal: new AbortController().signal });
    expect(made).toMatchObject({ ok: true, pictures: 1, notices: [] });
    const { parts, options } = lastRequest();
    expect(options.draft?.text).toMatch(/\bband\b/);
    expect(options.formaBrief?.trim()).not.toBe('');
    expect(parts.find((p) => p.text?.includes('READ BY OCR'))?.text).toMatch(/INVOICE/);
    // pdf.js drew the page, and the intake sent it as a JPEG.
    expect(parts.some((p) => p.inlineData?.mimeType === 'image/jpeg')).toBe(true);
    expect(engineThatRead()).toBe(ENGINE);
  }, 180_000);

  it("sends a digital PDF's text layer as it is, and draws its page in the font it names", async () => {
    const made = await gen.make({ files: [{ file: fileFrom('digital.pdf', digitalPdf()), uploadId: 'u3' }], words: 'the same invoice', config: CONFIG, signal: new AbortController().signal });
    expect(made).toMatchObject({ ok: true, pictures: 1, notices: [] });
    const { parts, options } = lastRequest();
    const layer = parts.find((p) => p.text?.startsWith('PDF page 1'))?.text ?? '';
    expect(layer).toContain('"INVOICE 1001"');
    expect(layer).toContain('"Chai 12 18.00"');
    // A page with a text layer is not read by OCR, in Node as in the browser, so there is no draft of Forma's: the AI designs.
    expect(parts.some((p) => p.text?.includes('READ BY OCR'))).toBe(false);
    expect(options.draft).toBeNull();
  }, 120_000);

  it("stands Forma's draft in when every AI fails, the draft prepareTeam makes again over the pages read and the settings worked out", async () => {
    // The fidelity benchmark's --forma runs exactly this since 2026-11-24 (wave 10, NODE-9; the wave-10 review's R3 moved it out of run.ts to be called here).
    const { formaDraftOf } = await import('../../scripts/fidelity/formaDraft');
    const stored = { ...CONFIG, pageSize: 'Letter' } as ReportConfig;
    const log: string[] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const own = await formaDraftOf(gen, { files: [{ file: fileFrom('stand-in.png', invoicePage().toBuffer('image/png')), uploadId: 'u5' }], words: '', config: stored }, log);
      expect(own).toMatchObject({ pictures: 1, standIn: { source: 'reader' } });
      // The paper is the page's (an A4 drawing), over the stored Letter; the version and unit stay the stored ones.
      expect(own.settings).toMatchObject({ pageSize: 'A4', version: '23.2', unit: 'HundredthsOfAnInch' });
      // Taken again and configured as the core configures a stand-in, it is the report that stood in.
      expect(own.sameAsStandIn).toBe(true);
      expect(own.raw?.repxContent).toContain('<XtraReportsLayoutSerializer');
      // The refused request carried that draft, and OCR's evidence (the box reader's brief beside it).
      expect(own.carried).toHaveLength(1);
      expect(own.carried[0].draft?.text).toBe(own.correctText);
      expect(own.correctText).toBeTruthy();
      expect(own.carried[0].formaBrief).toBeTruthy();
      expect((own.carried[0].evidence as { sections: { elements: unknown[] }[] } | undefined)?.sections.flatMap((s) => s.elements).length).toBeGreaterThan(0);
      // The refusal is no AI failing, so neither the log nor the console hears it as one (the review's R6).
      expect(log.some((line) => line.includes('no AI is asked'))).toBe(false);
      expect(errors.mock.calls.some((args) => args.some((a) => String(a instanceof Error ? a.message : a).includes('no AI is asked')))).toBe(false);
    } finally {
      errors.mockRestore();
    }
  }, 180_000);

  it('reads with Tesseract alone when PaddleOCR is not asked for, from the language data gathered into its own folder', async () => {
    const tesseract = await nodeGeneration({ userFolder: folder, paddleModels: null, log, ask: async (...args: unknown[]) => (asked.push(args), MOCK_INVOICE_RESPONSE) });
    try {
      expect(tesseract.ocr).toBe('tesseract');
      const png = invoicePage().toBuffer('image/png');
      expect(await tesseract.make({ files: [{ file: fileFrom('again.png', png), uploadId: 'u4' }], words: '', config: CONFIG, signal: new AbortController().signal })).toMatchObject({ ok: true, notices: [] });
      const { parts, options } = lastRequest();
      expect(parts.find((p) => p.text?.includes('READ BY OCR'))?.text).toMatch(/INVOICE/);
      expect(options.draft?.text).toMatch(/\bband\b/);
      expect(engineThatRead()).toBe('tesseract');
      expect(said.some((l) => /^OCR read the page as /.test(l))).toBe(true);
    } finally {
      await tesseract.close();
    }
    expect(readdirSync(join(folder, 'tessdata')).sort()).toEqual(['ara', 'deu', 'eng', 'fra', 'hin', 'spa', 'urd'].map((l) => `${l}.traineddata.gz`));
  }, 180_000);

  // D1-1 (2026-11-24): a layout passed among the files was taken in and dropped with no word; the MCP server's generate_report took it as data.
  it('binds a report to a database layout passed among its files, a UTF-16 one as sqlcmd -u writes it', async () => {
    const { SCHEMA_EXPORT } = await import('../lib/sqlFixtures');
    const layout = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(SCHEMA_EXPORT, 'utf16le')]);
    const made = await gen.make({ files: [{ file: fileFrom('forma-schema.txt', layout), uploadId: 'u6' }], words: 'a list of customers with their city', config: CONFIG, signal: new AbortController().signal });
    expect(made).toMatchObject({ ok: true, pictures: 0, notices: ['"forma-schema.txt" is a database layout, given to the AI with the request so the report can be bound to it.'] });
    const { options } = lastRequest() as unknown as { options: { database?: string } };
    expect(options.database).toContain('\n<database>\nDATABASE "FormaSample" (SQL Server 13.0.4001.0).');
    expect(options.database).toContain('- dbo.Customers (table): CustomerID int PK not null, CompanyName nvarchar(80) not null, City nvarchar(40), Region nvarchar(20)');
    // Bound or not, the reply says what the report reads: never silence.
    expect(made?.ok && made.dataNote).toMatch(/FormaSample/);
  }, 120_000);

  it('wrote nothing outside its own folder, and read no storage', () => {
    expect(readdirSync(process.cwd()).sort()).toEqual(cwdBefore);
    // The gathered language data is all Forma's folder holds: no probe ran, the AI being stood in.
    expect(readdirSync(folder)).toEqual(['tessdata']);
    expect(storageReads).toEqual([]);
  });
});
