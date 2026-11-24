/**
 * Reading a page's text in Node (2026-11-24, the MCP work's wave 7; NODE-1,
 * NODE-5, NODE-10, TST-7, SEC-2): the language data gathered from the
 * installed packages into Forma's own folder, the options every Tesseract
 * worker starts with, PaddleOCR first where its pinned models are and
 * Tesseract otherwise, one reading at a time, each stopped on its own, and a
 * damaged picture a rejection that harms no other reading; since the wave-7
 * review, a reading stopped as its worker starts asking nothing of it
 * (NODE7-ABORT-UNHANDLED), the language data gathered when told to
 * (NODE7-OCR-QUIET) and no picture past nodeIntake.ts's size decoded
 * (NODE7-PICTURE-MEMORY). tesseract.js is stood in for where the case is
 * about what is asked of it, and run for real where the case is about what
 * it does (a damaged picture, the working folder, a stop as its worker
 * starts). Pictures are drawn here.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SentPage } from '../lib/generationCore';
import type { PaddlePage, PaddleReader } from '../lib/paddleOcr';
import { OCR_LANGUAGES } from '../lib/ocrScript';
import type { ReportConfig } from '../services/geminiService';
import { CLONE } from './nodeGeneration';
import { bytesOfDataUrl, gatherLanguages, installedLanguage, nodeOcr, tesseractOptions } from './nodeOcr';

const folders: string[] = [];
const folder = () => {
  const made = mkdtempSync(join(tmpdir(), 'forma-ocr-'));
  folders.push(made);
  return made;
};
afterEach(() => {
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
});

const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const SETTINGS = { unit: 'HundredthsOfAnInch', pageSize: 'A4' } as ReportConfig;

beforeAll(() => {
  GlobalFonts.registerFromPath(join(CLONE, 'assets', 'pdf-fonts', 'LiberationSans-Regular.ttf'), 'Forma Test Sans');
});

/** A picture of `lines`, as a PNG data URL. */
function page(lines: string[], width = 900): string {
  const canvas = createCanvas(width, 120 + lines.length * 80);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.font = '40px "Forma Test Sans"';
  lines.forEach((l, i) => ctx.fillText(l, 60, 100 + i * 80));
  return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`;
}

/** A Tesseract reading with one line, in the shape tesseract.js answers. */
const answer = (text: string, confidence = 93) => ({
  data: { confidence, blocks: [{ paragraphs: [{ lines: [{ text, confidence, bbox: { x0: 10, y0: 10, x1: 300, y1: 50 }, words: [{ text, confidence, bbox: { x0: 10, y0: 10, x1: 300, y1: 50 } }] }] }] }] },
});

/** tesseract.js stood in for: what each worker was started with, and every reading asked of it. */
function standIn(recognize: (image: unknown, options?: unknown) => Promise<unknown>) {
  const workers: { languages: string; options: Record<string, unknown>; terminate: ReturnType<typeof vi.fn>; reinitialize: ReturnType<typeof vi.fn> }[] = [];
  const createWorker = vi.fn(async (languages: string, _oem: number, options: Record<string, unknown>) => {
    const worker = { languages, options, terminate: vi.fn(async () => undefined), reinitialize: vi.fn(async () => undefined), recognize: vi.fn(recognize) };
    workers.push(worker);
    return worker;
  });
  return { workers, tesseract: async () => ({ createWorker, OEM: { LSTM_ONLY: 1 } }) as never };
}

describe("OCR's language data, gathered from the installed packages", () => {
  it('copies every language OCR reads into one folder, each the installed file to the byte, and only there', () => {
    const into = join(folder(), 'tessdata');
    expect(gatherLanguages(into)).toBe(into);
    expect(readdirSync(into).sort()).toEqual(OCR_LANGUAGES.map((l) => `${l}.traineddata.gz`).sort());
    for (const lang of OCR_LANGUAGES) expect(sha(join(into, `${lang}.traineddata.gz`))).toBe(sha(installedLanguage(lang)));
  });

  it('copies again a file that is not the installed one, rather than reading it', () => {
    const into = join(folder(), 'tessdata');
    gatherLanguages(into);
    writeFileSync(join(into, 'eng.traineddata.gz'), 'someone else\'s model');
    gatherLanguages(into);
    expect(sha(join(into, 'eng.traineddata.gz'))).toBe(sha(installedLanguage('eng')));
    expect(readdirSync(into).filter((n) => n.endsWith('.part'))).toEqual([]);
  });

  it('is the list the browser build copies into dist/ocr', () => {
    // vite.config.ts names English apart and the rest in one array; every language must be in one or the other.
    const config = readFileSync(join(CLONE, 'vite.config.ts'), 'utf8');
    for (const lang of OCR_LANGUAGES) expect(config, lang).toMatch(new RegExp(`'${lang}\\.traineddata\\.gz'|'${lang}'`));
  });
});

describe('what a Tesseract worker is started with', () => {
  it('one folder of languages, gzipped, nothing cached in or read from the working folder, and a failed job a rejection', () => {
    const log = vi.fn();
    const options = tesseractOptions('/forma/tessdata', log);
    expect(options).toMatchObject({ langPath: '/forma/tessdata', gzip: true, cacheMethod: 'none' });
    options.errorHandler('Error attempting to read image.');
    expect(log).toHaveBeenCalledWith('Tesseract: Error attempting to read image.');
  });

  it('is what the reader starts its worker with, re-initialised for another language as the browser does', async () => {
    const languages = join(folder(), 'tessdata');
    const { workers, tesseract } = standIn(async () => answer('Invoice total'));
    const ocr = nodeOcr({ languages, paddle: null, log: () => undefined, tesseract });
    expect(ocr.english).toBe('tesseract');
    const read = await ocr.recognize(page(['Invoice total']));
    expect(read.lines.map((l) => l.text)).toEqual(['Invoice total']);
    expect(workers).toHaveLength(1);
    expect(workers[0].languages).toBe('eng');
    expect(workers[0].options).toMatchObject({ langPath: languages, gzip: true, cacheMethod: 'none', errorHandler: expect.any(Function) });
    // Tesseract is handed PNG bytes, never a string it could take for a path or a URL.
    expect(Buffer.isBuffer((workers[0] as unknown as { recognize: { mock: { calls: unknown[][] } } }).recognize.mock.calls[0][0])).toBe(true);
    await ocr.close();
    expect(workers[0].terminate).toHaveBeenCalled();
  });
});

describe('PaddleOCR first, where its pinned models are', () => {
  const paddlePage = (lines: string[], detected: number): PaddlePage => ({
    width: 900,
    height: 300,
    dpi: null,
    detected,
    unsureBelow: 95,
    lines: lines.map((text, i) => ({ text, confidence: 99, box: { x0: 10, y0: 10 + i * 60, x1: 400, y1: 50 + i * 60 }, words: [{ text, confidence: 99, box: { x0: 10, y0: 10 + i * 60, x1: 400, y1: 50 + i * 60 } }] })),
  });

  it('reads an English page with PaddleOCR, and starts no Tesseract', async () => {
    const { workers, tesseract } = standIn(async () => answer('not asked'));
    const reader: PaddleReader = { read: vi.fn(async () => paddlePage(['INVOICE 1001', 'Total 47.00'], 2)) };
    const ocr = nodeOcr({ languages: join(folder(), 'tessdata'), paddle: '/models', pinned: () => ({ ok: true }), paddleReader: async () => reader, log: () => undefined, tesseract });
    expect(ocr.english).toBe('paddle');
    const read = await ocr.recognize(page(['INVOICE 1001', 'Total 47.00']));
    expect(read.lines.map((l) => l.text)).toEqual(['INVOICE 1001', 'Total 47.00']);
    expect(workers).toHaveLength(0);
    await ocr.close();
  });

  it('leaves a page PaddleOCR read too little of, or failed on, to Tesseract', async () => {
    const log = vi.fn();
    const { workers, tesseract } = standIn(async () => answer('read by Tesseract'));
    let fails = false;
    const reader: PaddleReader = {
      read: vi.fn(async () => {
        if (fails) throw new Error('the session broke');
        return paddlePage(['10234'], 4);
      }),
    };
    const ocr = nodeOcr({ languages: join(folder(), 'tessdata'), paddle: '/models', pinned: () => ({ ok: true }), paddleReader: async () => reader, log, tesseract });
    expect((await ocr.recognize(page(['some words']))).lines[0].text).toBe('read by Tesseract');
    expect(log).toHaveBeenCalledWith('PaddleOCR read too little of this page for its script; Tesseract reads it.');
    fails = true;
    expect((await ocr.recognize(page(['some words']))).lines[0].text).toBe('read by Tesseract');
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^PaddleOCR did not read the page; Tesseract reads it\. Error: the session broke/));
    expect(workers).toHaveLength(1);
    await ocr.close();
  });

  it('reads with Tesseract, and says why, where the models are not the pinned ones', () => {
    const log = vi.fn();
    const ocr = nodeOcr({ languages: join(folder(), 'tessdata'), paddle: '/models', pinned: () => ({ ok: false, why: 'det.onnx is not in /models' }), log });
    expect(ocr.english).toBe('tesseract');
    expect(log).toHaveBeenCalledWith('OCR reads with Tesseract: det.onnx is not in /models (npm run fetch:paddle puts the pinned models there).');
  });
});

describe('one reading at a time, each stopped on its own', () => {
  it('never starts a reading stopped while it waited, and ends the worker under one stopped while it reads', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const { workers, tesseract } = standIn(() => new Promise((resolve) => (finish = resolve)));
    const ocr = nodeOcr({ languages: join(folder(), 'tessdata'), paddle: null, log: () => undefined, tesseract });
    const first = new AbortController();
    const second = new AbortController();
    const reading = ocr.recognize(page(['first']), first.signal);
    const waiting = ocr.recognize(page(['second']), second.signal);
    second.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    await vi.waitFor(() => expect((workers[0] as unknown as { recognize: { mock: { calls: unknown[] } } }).recognize.mock.calls).toHaveLength(1));
    first.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0].terminate).toHaveBeenCalled();
    finish(answer('too late'));
    // The next reading starts another worker, and the stopped one never read the second page.
    const next = ocr.recognize(page(['third']));
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    finish(answer('third'));
    expect((await next).lines[0].text).toBe('third');
    await ocr.close();
  });

  it("reads the core's pages, the ones asked for now when it names them, and goes on past one it cannot read", async () => {
    const log = vi.fn();
    const { tesseract } = standIn(async () => answer('a line'));
    const ocr = nodeOcr({ languages: join(folder(), 'tessdata'), paddle: null, log, tesseract });
    const at = (n: number, src = page([`page ${n}`])): SentPage => ({ src, meta: { uploadId: 'u1', file: 'scan.pdf', page: n } });
    const pages = [at(1), at(2, 'data:image/png;base64,AAAA'), at(3)];
    const read = await ocr.readPages(pages, new AbortController().signal, SETTINGS);
    expect(read.map((r) => r.meta.page)).toEqual([1, 3]);
    expect(read[0].read).toMatchObject({ lines: 1, flagged: 0 });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^The text of scan\.pdf could not be read: /));
    const now = await ocr.readPages(pages, new AbortController().signal, SETTINGS, [pages[2]]);
    expect(now.map((r) => r.meta.page)).toEqual([3]);
    await ocr.close();
  });

  it('rejects a reading Tesseract itself fails, and the same worker answers the next', async () => {
    // A failure inside Tesseract, past the picture's decoding (W7R-4): the worker is not ended for it, as a stop ends it.
    let fails = true;
    const { workers, tesseract } = standIn(async () => {
      if (fails) {
        fails = false;
        throw new Error('Error attempting to read image.');
      }
      return answer('read after');
    });
    const ocr = nodeOcr({ languages: join(folder(), 'tessdata'), paddle: null, log: () => undefined, tesseract });
    await expect(ocr.recognize(page(['first']))).rejects.toThrow('Error attempting to read image.');
    expect((await ocr.recognize(page(['second']))).lines[0].text).toBe('read after');
    expect(workers).toHaveLength(1);
    expect(workers[0].terminate).not.toHaveBeenCalled();
    await ocr.close();
  });

  it('takes a page as a data URL only, never a path to read or a URL to fetch', () => {
    expect(bytesOfDataUrl('data:image/png;base64,aGk=').toString()).toBe('hi');
    expect(() => bytesOfDataUrl('C:\\Users\\someone\\secret.png')).toThrow('A page to read is given as a data URL.');
    expect(() => bytesOfDataUrl('https://example.com/page.png')).toThrow('A page to read is given as a data URL.');
  });
});

describe('the real Tesseract, in this process', () => {
  it('refuses a damaged picture as it is decoded, before Tesseract, then reads the next, and writes nothing into the working folder', async () => {
    // The picture never reaches Tesseract: @napi-rs/canvas refuses it first (the wave-7 review's W7R-4). Tesseract's own failure is the next two cases'.
    const before = readdirSync(process.cwd()).sort();
    const languages = join(folder(), 'tessdata');
    const log = vi.fn();
    const ocr = nodeOcr({ languages, paddle: null, log });
    // Truncated: the header of a PNG and nothing after it.
    const good = page(['Invoice 1001', 'Total 47.00']);
    const damaged = good.slice(0, 60);
    await expect(ocr.recognize(damaged)).rejects.toThrow();
    const read = await ocr.recognize(good);
    expect(read.lines.map((l) => l.text).join(' ')).toMatch(/Invoice 1001/);
    await ocr.close();
    expect(readdirSync(process.cwd()).sort()).toEqual(before);
    expect(readdirSync(languages).every((n) => n.endsWith('.traineddata.gz'))).toBe(true);
  }, 120_000);

  it("turns tesseract.js's own failure on a damaged picture into a rejection, with the worker answering after", async () => {
    // The audit's crash, held where it happened: given these options, nothing reaches the process as an uncaught exception.
    const { createWorker, OEM } = await import('tesseract.js');
    const log = vi.fn();
    const worker = await createWorker('eng', OEM.LSTM_ONLY, tesseractOptions(gatherLanguages(join(folder(), 'tessdata')), log));
    try {
      const png = bytesOfDataUrl(page(['Total 47.00']));
      await expect(worker.recognize(png.subarray(0, 80))).rejects.toBeDefined();
      expect(log).toHaveBeenCalled();
      const read = await worker.recognize(png);
      expect(read.data.text).toMatch(/47\.00/);
    } finally {
      await worker.terminate();
    }
  }, 120_000);

  it('asks nothing of a worker being ended when a reading is stopped as its worker starts, and leaves no rejection unhandled', async () => {
    // The wave-7 review's NODE7-ABORT-UNHANDLED: the reading went on to recognize() on the worker its stop had ended, and tesseract.js
    // rejected that where nothing could catch it. Stopped here at the moment the worker is made, every time.
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', record);
    const real = await import('tesseract.js');
    const stopping = new AbortController();
    const made: { terminate: () => Promise<unknown> }[] = [];
    const tesseract = async () => ({
      OEM: real.OEM,
      createWorker: async (...args: Parameters<typeof real.createWorker>) => {
        const worker = await real.createWorker(...args);
        made.push(worker);
        if (made.length === 1) stopping.abort();
        return worker;
      },
    });
    const ocr = nodeOcr({ languages: join(folder(), 'tessdata'), paddle: null, log: () => undefined, tesseract: tesseract as never });
    try {
      await expect(ocr.recognize(page(['Invoice 1001']), stopping.signal)).rejects.toMatchObject({ name: 'AbortError' });
      // The next reading starts a worker of its own and is answered.
      expect((await ocr.recognize(page(['Total 47.00']))).lines.map((l) => l.text).join(' ')).toMatch(/47\.00/);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(unhandled).toEqual([]);
      expect(made).toHaveLength(2);
    } finally {
      process.off('unhandledRejection', record);
      await ocr.close();
    }
  }, 120_000);
});

describe('what the reader refuses before it starts a worker', () => {
  it('gathers the language data when told to, and names the folder it cannot write', () => {
    const blocked = join(folder(), 'not-a-folder');
    writeFileSync(blocked, 'a file');
    const ocr = nodeOcr({ languages: join(blocked, 'tessdata'), paddle: null, log: () => undefined });
    expect(() => ocr.ready()).toThrow(/^OCR's language data could not be written to .*not-a-folder.tessdata /);
    const languages = join(folder(), 'tessdata');
    nodeOcr({ languages, paddle: null, log: () => undefined }).ready();
    expect(readdirSync(languages).sort()).toEqual(OCR_LANGUAGES.map((l) => `${l}.traineddata.gz`).sort());
  });

  it('reads no picture past the size nodeIntake.ts decodes, its header saying so, and starts no worker for it', async () => {
    // The wave-7 review's NODE7-PICTURE-MEMORY: OCR decoded whatever it was given at full size.
    const { workers, tesseract } = standIn(async () => answer('not asked'));
    const ocr = nodeOcr({ languages: join(folder(), 'tessdata'), paddle: null, log: () => undefined, tesseract });
    const header = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(header, 0);
    header.write('IHDR', 12, 'latin1');
    header.writeUInt32BE(46_000, 16);
    header.writeUInt32BE(46_000, 20);
    await expect(ocr.recognize(`data:image/png;base64,${header.toString('base64')}`)).rejects.toThrow('The picture is not read: it is 46000 by 46000 pixels, past the 100 million Node decodes.');
    await expect(ocr.recognize('data:image/svg+xml;base64,PHN2Zy8+')).rejects.toThrow(/^The picture is not read: its size could not be read from its header/);
    expect(workers).toHaveLength(0);
    await ocr.close();
  });
});
