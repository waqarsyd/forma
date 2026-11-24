/**
 * The generation core's parts in Node, assembled (2026-11-24, the MCP work's
 * wave 7): Forma's own folder, the file the model probe is kept in between
 * runs (NODE-7), Forma's models and OCR's language data read as the parts
 * are assembled and failing loudly (NODE-3, NODE7-OCR-QUIET), a page OCR
 * could not read said in the result, the mock switched on in src/mcp
 * (NODE-6, PROTO-8) and making no request even to translate (W7R-1), the
 * model pin, the paper never following the operating system's locale, a
 * redesign asked in the open report's settings (W7R-2), and text measured
 * on @napi-rs/canvas (NODE-11). The end-to-end run is nodeMakeReport.test.ts.
 * No key: the probe's requests are answered here.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOCK_INVOICE_RESPONSE, type ReportConfig } from '../services/geminiService';
import { CLONE, fileStorage, formaUserFolder, nodeGeneration, unreadNotice } from './nodeGeneration';
import { fileFrom } from './nodeIntake';

const CONFIG = { version: '23.2', unit: 'HundredthsOfAnInch', pageSize: 'A4', customApiKey: 'stand-in' } as ReportConfig;
const folders: string[] = [];
const folder = () => {
  const made = mkdtempSync(join(tmpdir(), 'forma-gen-'));
  folders.push(made);
  return made;
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
});
const quiet = { log: () => undefined, paddleModels: null } as const;

/**
 * A server started afresh, as another process would start it: fresh modules,
 * so the model cache and the measuring canvas it sets are the ones the
 * service and the measurer then read.
 */
async function fresh(options: Parameters<typeof nodeGeneration>[0]) {
  vi.resetModules();
  const [{ nodeGeneration: start }, service, measuring] = await Promise.all([import('./nodeGeneration'), import('../services/geminiService'), import('../lib/textMeasure')]);
  return { gen: await start(options), service, measuring };
}

describe("Forma's own folder, outside any repository and the user's project", () => {
  it("is under the user's home, where each system keeps an application's cache", () => {
    expect(formaUserFolder('C:\\Users\\someone', 'win32')).toBe(join('C:\\Users\\someone', 'AppData', 'Local', 'Forma'));
    expect(formaUserFolder('/Users/someone', 'darwin')).toBe(join('/Users/someone', 'Library', 'Caches', 'Forma'));
    expect(formaUserFolder('/home/someone', 'linux')).toBe(join('/home/someone', '.cache', 'forma'));
  });

  it('keeps a storage in one file, written whole each time, and reads a damaged one as empty', () => {
    const path = join(folder(), 'nested', 'store.json');
    const store = fileStorage(path);
    expect(store.getItem('a')).toBeNull();
    store.setItem('a', '1');
    store.setItem('b', '2');
    store.removeItem('a');
    store.removeItem('never there');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ b: '2' });
    expect(readdirSync(join(path, '..'))).toEqual(['store.json']);
    writeFileSync(path, '{ half');
    expect(store.getItem('b')).toBeNull();
  });
});

describe("Forma's models, read from the clone", () => {
  /** A clone of only the model files given, each a copy of the real one or the text given. */
  const cloneWith = (files: Record<string, string | null>) => {
    const root = folder();
    mkdirSync(join(root, 'assets', 'model'), { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      const to = join(root, 'assets', 'model', name);
      if (text === null) copyFileSync(join(CLONE, 'assets', 'model', name), to);
      else writeFileSync(to, text);
    }
    return root;
  };

  it('fails loudly, naming the file, where a model is missing or cannot be read: never a quieter report', async () => {
    await expect(nodeGeneration({ ...quiet, clone: cloneWith({}), userFolder: folder() })).rejects.toThrow(/^Forma's box reader is missing from this clone \(.*boxReader\.json\)\. It is committed with Forma: restore it with git/);
    await expect(nodeGeneration({ ...quiet, clone: cloneWith({ 'boxReader.json': '{ half' }), userFolder: folder() })).rejects.toThrow(/^Forma's box reader in this clone \(.*\) is not readable\./);
    await expect(nodeGeneration({ ...quiet, clone: cloneWith({ 'boxReader.json': null }), userFolder: folder() })).rejects.toThrow(/^Forma's own model is missing from this clone/);
  });

  it('checks each is one this version reads, as the browser does', async () => {
    await expect(nodeGeneration({ ...quiet, clone: cloneWith({ 'boxReader.json': '{"version":2}' }), userFolder: folder() })).rejects.toThrow("Forma's box reader is not one this version can read.");
    await expect(nodeGeneration({ ...quiet, clone: cloneWith({ 'boxReader.json': null, 'formaModel.json': '{"version":1,"archetypes":[]}' }), userFolder: folder() })).rejects.toThrow("Forma's own model is not one this version can read.");
  });

  it("hands the core the box reader and Forma's own model, with no memory beside them", async () => {
    const gen = await nodeGeneration({ ...quiet, userFolder: folder() });
    const deps = gen.deps(CONFIG);
    expect((await deps.loadReader()).version).toBe(1);
    expect((await deps.houseBrief!('HundredthsOfAnInch')).trim()).not.toBe('');
    const { design } = await deps.designFromWords({ description: 'A customer list grouped by country' }, '');
    expect(design.repx).toContain('XtraReportsLayoutSerializer');
    expect(await deps.beforeGeneration({ first: true, drafting: false, words: '' })).toEqual({ remembered: '', kept: null });
    expect([deps.visionModel, deps.pageReader, deps.houseStyle, deps.database]).toEqual([undefined, undefined, undefined, undefined]);
    await gen.close();
  });
});

describe('the model Gemini answers with, probed once a day and kept in a file', () => {
  const KEY = 'stand-in-key-for-the-probe';
  const answered = () => vi.fn(async () => new Response('{}', { status: 200 }));

  it("keeps the day's choice by the key's tag, never the key, so the next server does not probe again", async () => {
    const forma = folder();
    const probes = answered();
    vi.stubGlobal('fetch', probes);
    // As Node 26 defines them: a read of either throws (TST-12), and none may happen.
    const reads: string[] = [];
    for (const name of ['localStorage', 'sessionStorage']) {
      vi.stubGlobal(name, undefined);
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get: () => {
          reads.push(name);
          throw new Error(`${name} needs --localstorage-file`);
        },
      });
    }
    const first = await (await fresh({ ...quiet, userFolder: forma })).service.resolveModel(KEY);
    expect(reads).toEqual([]);
    expect(probes).toHaveBeenCalled();
    const kept = readFileSync(join(forma, 'model-choice.json'), 'utf8');
    expect(kept).not.toContain(KEY);
    const day = JSON.parse(JSON.parse(kept)['geminiModel:day']);
    expect(day).toMatchObject({ model: first, tag: expect.stringMatching(/^[0-9a-f]{8}$/), at: expect.any(Number) });

    // Another server, another process: fresh modules, the same folder.
    const again = answered();
    vi.stubGlobal('fetch', again);
    expect(await (await fresh({ ...quiet, userFolder: forma })).service.resolveModel(KEY)).toBe(first);
    expect(again).not.toHaveBeenCalled();
  });

  it('probes again once the choice is a day old, and for another key', async () => {
    const forma = folder();
    const path = join(forma, 'model-choice.json');
    vi.stubGlobal('fetch', answered());
    await (await fresh({ ...quiet, userFolder: forma })).service.resolveModel(KEY);
    const all = JSON.parse(readFileSync(path, 'utf8'));
    const day = JSON.parse(all['geminiModel:day']);
    writeFileSync(path, JSON.stringify({ ...all, 'geminiModel:day': JSON.stringify({ ...day, at: Date.now() - 25 * 60 * 60 * 1000 }) }));
    const stale = answered();
    vi.stubGlobal('fetch', stale);
    await (await fresh({ ...quiet, userFolder: forma })).service.resolveModel(KEY);
    expect(stale).toHaveBeenCalled();

    const other = answered();
    vi.stubGlobal('fetch', other);
    await (await fresh({ ...quiet, userFolder: forma })).service.resolveModel(`${KEY}-another`);
    expect(other).toHaveBeenCalled();
  });

  it('pins a model when told one, which the service then never probes for', async () => {
    const pinned = await nodeGeneration({ ...quiet, userFolder: folder(), model: ' gemini-flash-latest ' });
    expect(pinned.config(CONFIG)).toEqual({ ...CONFIG, modelName: 'gemini-flash-latest' });
    const unpinned = await nodeGeneration({ ...quiet, userFolder: folder() });
    expect(unpinned.config(CONFIG)).toBe(CONFIG);
  });
});

describe('the mock, switched on in src/mcp alone', () => {
  it('answers with the mock invoice and asks no AI', async () => {
    const network = vi.fn(async () => {
      throw new Error('no request may leave in mock mode');
    });
    vi.stubGlobal('fetch', network);
    const gen = await nodeGeneration({ ...quiet, userFolder: folder(), mock: true });
    const made = await gen.make({ words: '', description: { description: 'A customer list grouped by country' }, config: { ...CONFIG, customApiKey: '' }, signal: new AbortController().signal });
    expect(made).toMatchObject({ ok: true });
    expect(made?.ok && made.repxContent).toContain('FORMA MOCK ENGINE');
    expect(network).not.toHaveBeenCalled();
    await gen.close();
  });

  it('translates as mock mode does where the words name a language, with a key in the settings and still no request', async () => {
    // The translation went to a real AI with the settings' key until the wave-7 review (W7R-1): six requests for these words.
    const network = vi.fn(async () => {
      throw new Error('no request may leave in mock mode');
    });
    vi.stubGlobal('fetch', network);
    const gen = await nodeGeneration({ ...quiet, userFolder: folder(), mock: true });
    const made = await gen.make({ words: '', description: { description: 'A customer list grouped by country, in French' }, config: CONFIG, signal: new AbortController().signal });
    expect(made).toMatchObject({ ok: true, translated: { language: 'French' } });
    expect(made?.ok && made.repxContent).toContain('[fr] ');
    expect(network).not.toHaveBeenCalled();
    await gen.close();
  });

  it('gives way to an AI handed in', async () => {
    const ask = vi.fn();
    const gen = await nodeGeneration({ ...quiet, userFolder: folder(), mock: true, ask });
    expect(gen.deps(CONFIG).ask).toBe(ask);
  });
});

describe("OCR's language data, gathered as the parts are assembled", () => {
  it('fails loudly, naming the folder, where it cannot be written: never every page read without its text', async () => {
    // A file where Forma's folder would be (the wave-7 review's NODE7-OCR-QUIET): the report was made, quieter, with one line on stderr.
    const blocked = join(folder(), 'not-a-folder');
    writeFileSync(blocked, "a file where Forma's folder would be");
    await expect(nodeGeneration({ ...quiet, userFolder: blocked })).rejects.toThrow(/^OCR's language data could not be written to .*not-a-folder.tessdata \(.*\)\. That folder must be one this user can write\.$/);
  });

  it('says in the result which picture OCR could not read, whose picture went to the AI alone', async () => {
    const asked: unknown[][] = [];
    const gen = await nodeGeneration({ ...quiet, userFolder: folder(), ask: async (...args: unknown[]) => (asked.push(args), MOCK_INVOICE_RESPONSE) });
    // A PNG cut off after its header: the intake sends it as it came, as the browser does, and OCR cannot decode it.
    const canvas = createCanvas(300, 200);
    const cut = canvas.toBuffer('image/png').subarray(0, 40);
    const made = await gen.make({ files: [{ file: fileFrom('cut.png', cut), uploadId: 'u1' }], words: 'an invoice', config: CONFIG, signal: new AbortController().signal });
    expect(made?.notices).toEqual([unreadNotice({ uploadId: 'u1', file: 'cut.png' })]);
    expect(unreadNotice({ uploadId: 'u1', file: 'cut.png' })).toBe('OCR could not read the text of "cut.png", so the AI was sent its picture alone.');
    expect(unreadNotice({ uploadId: 'u2', file: 'scan.pdf', page: 3 })).toBe('OCR could not read the text of page 3 of "scan.pdf", so the AI was sent its picture alone.');
    const parts = asked[0][1] as { inlineData?: { mimeType: string } }[];
    expect(parts.some((p) => p.inlineData?.mimeType === 'image/png')).toBe(true);
    await gen.close();
  });
});

describe('the settings Node works out', () => {
  it("takes the paper from the locale it is given, never the operating system's", async () => {
    const gen = await nodeGeneration({ ...quiet, userFolder: folder() });
    const told = await nodeGeneration({ ...quiet, userFolder: folder(), locale: 'en-GB' });
    // navigator.language is this machine's locale in Node; whatever it is, a server told none prints on Letter, DevExpress's own default.
    expect(gen.deps(CONFIG).detect({ words: 'a customer list' }).pageSize).toBe('Letter');
    expect(told.deps(CONFIG).detect({ words: 'a customer list' }).pageSize).toBe('A4');
    // The words still decide it where they say it.
    expect(gen.deps(CONFIG).detect({ words: 'a customer list on A4' }).pageSize).toBe('A4');
  });

  it("asks a redesign in the open report's own version, unit and paper, as the workspace does", async () => {
    // Asked in the stored settings until the wave-7 review (W7R-2): 20.1, hundredths of an inch, Letter.
    const asked: unknown[][] = [];
    const gen = await nodeGeneration({ ...quiet, userFolder: folder(), ask: async (...args: unknown[]) => (asked.push(args), MOCK_INVOICE_RESPONSE) });
    const open =
      '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer SerializerVersion="22.2.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v22.2" Name="Invoice" ReportUnit="TenthsOfAMillimeter" PaperKind="A4" Version="22.2"><Bands><Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="250" /></Bands></XtraReportsLayoutSerializer>';
    const stored = { version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'Letter', customApiKey: 'stand-in' } as ReportConfig;
    await gen.make({ words: 'add a grand total', open: { repxContent: open }, config: stored, signal: new AbortController().signal });
    expect(asked[0][2]).toMatchObject({ version: '22.2', unit: 'TenthsOfAMillimeter', pageSize: 'A4' });
    expect(asked[0][3]).toMatchObject({ repxContent: open });
    // The parts handed out for a request on an open report work it out the same way.
    expect(gen.deps(stored, open).detect({ words: '' })).toMatchObject({ version: '22.2', unit: 'TenthsOfAMillimeter', pageSize: 'A4' });
    expect(gen.deps(stored).detect({ words: '' }).unit).toBe('HundredthsOfAnInch');
    await gen.close();
  });
});

describe('text measured on @napi-rs/canvas, where the browser measures it', () => {
  it('measures in Node once the parts are assembled', async () => {
    const { canvasMeasurer, measuresHere } = (await fresh({ ...quiet, userFolder: folder() })).measuring;
    expect(measuresHere()).toBe(true);
    expect(canvasMeasurer()).not.toBeNull();
  });

  // The parity rows' widths (docs/proposals/devexpress-parity.md, rows 51, 53 and 59), where the fonts they were measured in are installed.
  it.runIf(['Arial', 'Times New Roman', 'Trebuchet MS'].every((f) => GlobalFonts.has(f)))("breaks and fits lines at the widths DevExpress printed, in this machine's fonts", async () => {
    const measure = (await fresh({ ...quiet, userFolder: folder() })).measuring.canvasMeasurer()!;
    const pt = (units: number) => (units * 72) / 100;
    const font = (family: string, sizePt: number) => ({ family, sizePt, bold: false, italic: false });
    const avatar = 'AVATAR Wave To LT Yo';
    // Kerned, Arial's line breaks below 293.342 units and keeps whole above it; unkerned it is short from 311.822.
    expect(measure(avatar, font('Arial', 20), pt(293.25))).toHaveLength(2);
    expect(measure(avatar, font('Arial', 20), pt(293.45))).toHaveLength(1);
    expect([measure.fitsUnkerned!(avatar, font('Arial', 20), pt(311.8)), measure.fitsUnkerned!(avatar, font('Arial', 20), pt(311.85))]).toEqual([false, true]);
    // Times New Roman 307.0 and Trebuchet MS 290.2 unkerned; "ROTATED TEXT" at 9.75pt, 101.2.
    expect([measure.fitsUnkerned!(avatar, font('Times New Roman', 20), pt(306.95)), measure.fitsUnkerned!(avatar, font('Times New Roman', 20), pt(307.1))]).toEqual([false, true]);
    expect([measure.fitsUnkerned!(avatar, font('Trebuchet MS', 20), pt(290.15)), measure.fitsUnkerned!(avatar, font('Trebuchet MS', 20), pt(290.3))]).toEqual([false, true]);
    expect([measure.fitsUnkerned!('ROTATED TEXT', font('Times New Roman', 9.75), pt(101.1)), measure.fitsUnkerned!('ROTATED TEXT', font('Times New Roman', 9.75), pt(101.25))]).toEqual([false, true]);
  });
});
