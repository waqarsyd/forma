/**
 * Reading a page's text in Node, by the browser's rule (2026-11-24, the MCP
 * work's wave 7; findings NODE-1, NODE-5, NODE-10, TST-7 and SEC-2 of the
 * 2026-11-23 design audit, and owner decision OD2 as revised that day).
 *
 * Which engine reads, and in which language, is lib/ocrRead.ts's, shared
 * with the browser: English by PaddleOCR when its pinned models are in
 * vendor/paddle (nodePaddle.ts, onnxruntime-node), by Tesseract otherwise
 * and for a page outside PaddleOCR's script; then the page's own language
 * with Tesseract. What a reading becomes is lib/ocrAttach.ts `pageRead`, as
 * in the browser. What is Node's own is the engines and their care:
 *
 * - Tesseract's language data comes from the installed @tesseract.js-data
 *   packages, already pinned by the lockfile, gathered into one folder Forma
 *   owns (`gatherLanguages`), because tesseract.js reads every language of
 *   `fra+eng` from one folder: no fetch step and never a CDN, which is where
 *   tesseract.js goes when no folder is given. Each file is checked against
 *   the installed one by SHA-256 before a worker starts, and copied again
 *   when it differs; one that still differs stops the reading. The server
 *   gathers them once as it starts (`ready`, called by nodeGeneration.ts), so
 *   a package that is missing or a folder that cannot be written is an error
 *   then, naming it, never every page read without its text (the wave-7
 *   review's NODE7-OCR-QUIET).
 * - `cacheMethod: 'none'`: by default tesseract.js reads
 *   `./<lang>.traineddata` from the working folder ahead of the data it was
 *   given, unhashed, and writes one there afterwards, which in an MCP server
 *   is the user's project. Neither happens.
 * - `errorHandler`: without it, a damaged picture or a language with no data
 *   reached the main thread as an uncaught exception and ended the process,
 *   every client with it (measured in the audit). With it each becomes a
 *   rejected reading, and the worker answers the next one.
 * - Tesseract is handed PNG bytes only, never a canvas, a Blob or a string
 *   it would take for a path or a URL to fetch.
 * - One worker, one reading at a time, as the browser's queue has it; a
 *   reading stopped ends the worker (a running recognition cannot otherwise
 *   be interrupted) and the next starts another. A stopped reading asks
 *   nothing more of a worker: before each recognition it checks it was not
 *   stopped, since one asked of the worker being ended was an unhandled
 *   rejection inside tesseract.js, and a reading that never settled (the
 *   wave-7 review's NODE7-ABORT-UNHANDLED, reproduced stopping a reading
 *   700 ms in, while its worker started). Idle for a minute, the worker
 *   ends, on a timer that never holds the process open.
 * - A picture is decoded only within nodeIntake.ts's `MAX_PICTURE_PIXELS`,
 *   read from its header first, and its pixels let go once drawn
 *   (NODE7-PICTURE-MEMORY); one past it is a page not read.
 *
 * What this module writes is the gathered language data, into the folder it
 * is given, and nothing else, anywhere.
 *
 * Pure ASCII.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import type { PageRead, SentPage } from '../lib/generationCore';
import type { OcrPage } from '../lib/ocr';
import { pageRead } from '../lib/ocrAttach';
import { ENLARGE_BELOW, ocrPageFrom, readWithEngines, type TesseractBlocks } from '../lib/ocrRead';
import { OCR_LANGUAGES } from '../lib/ocrScript';
import { inItsScript, rgbFromRgba, type PaddleReader } from '../lib/paddleOcr';
import type { PixelBox } from '../lib/reportGeometry';
import type { ReportConfig } from '../services/geminiService';
import { notDrawn, releasePicture } from './nodeIntake';
import { appReader, pinnedModelsIn, readAsTheApp } from './nodePaddle';

const requireHere = createRequire(import.meta.url);

/** The installed data file of one of OCR's languages: the files the browser build copies into dist/ocr. */
export function installedLanguage(lang: string): string {
  let pkg: string;
  try {
    pkg = requireHere.resolve(`@tesseract.js-data/${lang}/package.json`);
  } catch {
    throw new Error(`OCR's ${lang} data, the package @tesseract.js-data/${lang}, is not installed in this clone. Run npm ci in the clone, then start the server again.`);
  }
  return join(dirname(pkg), '4.0.0_best_int', `${lang}.traineddata.gz`);
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/**
 * Every language OCR reads, from the installed packages, in one folder
 * (`into`), each the installed file to the byte. A copy that is missing or
 * differs is made again, through a temporary name so a reader never meets
 * half a file; one that still differs throws, and nothing is read with it.
 * A package missing, or a folder that cannot be written, throws an error
 * that names it.
 */
export function gatherLanguages(into: string): string {
  const unwritable = (err: unknown) => new Error(`OCR's language data could not be written to ${into} (${String(err)}). That folder must be one this user can write.`);
  try {
    mkdirSync(into, { recursive: true });
  } catch (err) {
    throw unwritable(err);
  }
  for (const lang of OCR_LANGUAGES) {
    const from = installedLanguage(lang);
    const to = join(into, `${lang}.traineddata.gz`);
    const want = sha256(from);
    if (existsSync(to) && sha256(to) === want) continue;
    const part = `${to}.${process.pid}.part`;
    try {
      copyFileSync(from, part);
      renameSync(part, to);
    } catch (err) {
      throw unwritable(err);
    } finally {
      rmSync(part, { force: true });
    }
    if (sha256(to) !== want) throw new Error(`OCR's ${lang} data in ${into} is not the installed file, so it was not used.`);
  }
  return into;
}

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
type Recognized = Awaited<ReturnType<TesseractWorker['recognize']>>;

/** How long a worker is kept after the last reading, as the browser keeps its engines (lib/ocr.ts OCR_IDLE_MS). */
export const NODE_OCR_IDLE_MS = 60_000;

const stoppedError = () => Object.assign(new Error('OCR was stopped.'), { name: 'AbortError' });

/** The parts the reader is made of, handed in so its tests can stand one in. */
export interface NodeOcrOptions {
  /** The folder OCR's languages are gathered into (`gatherLanguages`): Forma's own, never the working folder. */
  languages: string;
  /** PaddleOCR's models; null reads with Tesseract alone. */
  paddle: string | null;
  /** Where a line about the reading goes: the server's log on stderr. */
  log: (line: string) => void;
  /** tesseract.js, for its tests to stand in for. */
  tesseract?: () => Promise<Pick<typeof import('tesseract.js'), 'createWorker' | 'OEM'>>;
  /** PaddleOCR's reader over the models, for its tests to stand in for. */
  paddleReader?: (dir: string) => Promise<PaddleReader>;
  /** Whether the models are the pinned ones (nodePaddle.ts `pinnedModelsIn`), for its tests to stand in for. */
  pinned?: (dir: string) => { ok: true } | { ok: false; why: string };
}

/**
 * The options a Tesseract worker is started with (the header): one folder of
 * languages, read gzipped, nothing cached in or read from the working folder,
 * and a failed job a rejection rather than a throw nothing can catch.
 */
export function tesseractOptions(langPath: string, log: (line: string) => void): { langPath: string; gzip: true; cacheMethod: 'none'; errorHandler: (error: unknown) => void } {
  return { langPath, gzip: true, cacheMethod: 'none', errorHandler: (error) => log(`Tesseract: ${String(error)}`) };
}

export interface NodeOcr {
  /** Which engine reads an English page: PaddleOCR when its pinned models are there, Tesseract otherwise. */
  readonly english: 'paddle' | 'tesseract';
  /** Gathers the language data now (`gatherLanguages`); throws, naming the package or the folder, when it cannot. */
  ready(): void;
  /** One picture's text, given as a data URL; a damaged picture rejects, and the next reading is not harmed. */
  recognize(src: string, signal?: AbortSignal): Promise<OcrPage>;
  /** The generation core's `readPages`: `now`, when given, the pages to read now; a page that cannot be read goes without its text. */
  readPages(pages: readonly SentPage[], signal: AbortSignal, settings: ReportConfig, now?: readonly SentPage[]): Promise<PageRead[]>;
  /** Ends the worker; the next reading starts another. */
  close(): Promise<void>;
}

/** A data URL's bytes; anything else is refused, so nothing is read from a path or fetched from a URL. */
export function bytesOfDataUrl(src: string): Buffer {
  const m = /^data:[^,;]*(;[^,]*)?,/.exec(src);
  if (!m) throw new Error('A page to read is given as a data URL.');
  const body = src.slice(m[0].length);
  return /;base64$/i.test(m[1] ?? '') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
}

export function nodeOcr(options: NodeOcrOptions): NodeOcr {
  const { log } = options;
  const loadTesseract = options.tesseract ?? (() => import('tesseract.js'));
  const paddleCheck = options.paddle ? (options.pinned ?? pinnedModelsIn)(options.paddle) : ({ ok: false, why: 'PaddleOCR is not asked for' } as const);
  if (options.paddle && !paddleCheck.ok) log(`OCR reads with Tesseract: ${paddleCheck.why} (npm run fetch:paddle puts the pinned models there).`);
  const paddleDir = paddleCheck.ok ? options.paddle : null;
  let paddle: Promise<PaddleReader> | null = null;

  let worker: Promise<TesseractWorker> | null = null;
  let workerLanguages = '';
  let idle: ReturnType<typeof setTimeout> | null = null;
  let queue: Promise<void> = Promise.resolve();
  /** The reading under way, if any: only its own end starts the idle timer, never a stopped one ending late. */
  let current: object | null = null;

  async function stopWorker(): Promise<void> {
    const running = worker;
    worker = null;
    workerLanguages = '';
    if (running) await (await running.catch(() => null))?.terminate().catch(() => undefined);
  }

  /** The worker reading `languages`, started once and re-initialised for another set, as the browser's engine is; `stopped` before it is re-initialised, which asks the worker too. */
  async function engine(languages: string, stopped: () => void): Promise<TesseractWorker> {
    if (!worker) {
      // Checked again for each worker, as the header says: about 60 ms over a folder already whole.
      const folder = gatherLanguages(options.languages);
      workerLanguages = languages;
      worker = loadTesseract()
        // A failed job rejects its own promise; the errorHandler keeps tesseract.js from also throwing it where nothing can catch it.
        .then(({ createWorker, OEM }) => createWorker(languages, OEM.LSTM_ONLY, tesseractOptions(folder, log)))
        .catch((err) => {
          worker = null;
          workerLanguages = '';
          throw err;
        });
      return worker;
    }
    const ready = await worker;
    if (workerLanguages !== languages) {
      const { OEM } = await loadTesseract();
      stopped();
      await ready.reinitialize(languages, OEM.LSTM_ONLY);
      workerLanguages = languages;
    }
    return ready;
  }

  /*
   * `stopped` throws once the reading is stopped, and is called after the
   * worker is waited for and before every recognition (the header): by then
   * the worker may be the one being ended.
   */
  async function tesseractPage(languages: string, png: Buffer, image: { width: number; height: number; dpi: number | null }, scale: number, stopped: () => void): Promise<OcrPage> {
    const ready = await engine(languages, stopped);
    stopped();
    const result: Recognized = await ready.recognize(png, {}, { blocks: true });
    return ocrPageFrom(result.data.blocks as TesseractBlocks[] | null, image, scale);
  }

  async function probe(languages: string, png: Buffer, boxes: readonly PixelBox[], stopped: () => void): Promise<number[]> {
    const ready = await engine(languages, stopped);
    const out: number[] = [];
    for (const b of boxes) {
      stopped();
      const rectangle = { left: Math.round(b.x0), top: Math.round(b.y0), width: Math.round(b.x1 - b.x0), height: Math.round(b.y1 - b.y0) };
      const result: Recognized = await ready.recognize(png, { rectangle });
      out.push(result.data.confidence);
    }
    return out;
  }

  async function byPaddle(source: Canvas, signal: AbortSignal | undefined): Promise<OcrPage | null> {
    if (!paddleDir) return null;
    try {
      paddle ??= (options.paddleReader ?? appReader)(paddleDir);
      const pixels = source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
      const page = await readAsTheApp(await paddle, rgbFromRgba(pixels, source.width, source.height));
      if (!inItsScript(page)) {
        log('PaddleOCR read too little of this page for its script; Tesseract reads it.');
        return null;
      }
      return page;
    } catch (err) {
      if (signal?.aborted) throw err;
      paddle = null;
      log(`PaddleOCR did not read the page; Tesseract reads it. ${String(err)}`);
      return null;
    }
  }

  /** One reading, the engines to itself. */
  async function readOne(src: string, signal: AbortSignal | undefined): Promise<OcrPage> {
    const bytes = bytesOfDataUrl(src);
    // Its size read from its header first, as the intake reads it (the header).
    const why = notDrawn(bytes);
    if (why) throw new Error(`The picture is not read: ${why}.`);
    const picture = await loadImage(bytes);
    const width = picture.width;
    const height = picture.height;
    if (!width || !height) throw new Error('The picture has no pixels to read.');
    // Drawn on white, as the browser draws it before reading (lib/ocr.ts imageCanvas).
    const source = createCanvas(width, height);
    const ctx = source.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(picture, 0, 0);
    releasePicture(picture);
    const scale = width < ENLARGE_BELOW ? 2 : 1;
    let input = source;
    if (scale === 2) {
      input = createCanvas(width * 2, height * 2);
      const big = input.getContext('2d');
      big.imageSmoothingQuality = 'high';
      big.drawImage(source, 0, 0, width * 2, height * 2);
    }
    const image = { width, height, dpi: null };
    let inputPng: Promise<Buffer> | null = null;
    const stopped = () => {
      if (signal?.aborted) throw stoppedError();
    };
    stopped();
    const { page } = await readWithEngines({
      paddle: () => byPaddle(source, signal),
      tesseract: async (languages) => tesseractPage(languages, await (inputPng ??= input.encode('png')), image, scale, stopped),
      probes: async () => {
        const png = await source.encode('png');
        return (languages, boxes) => probe(languages, png, boxes, stopped);
      },
      stopped,
    });
    return page;
  }

  function idleLater(): void {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => void stopWorker(), NODE_OCR_IDLE_MS);
    idle.unref();
  }

  /*
   * One reading at a time, each stopped on its own, as lib/ocr.ts
   * `recognizePage` has it: a reading waits its turn; one stopped while it
   * waits never starts; one stopped while it reads rejects at once and ends
   * the worker, and the queue goes on without waiting for it, since a
   * terminated worker never settles what it was doing.
   */
  function recognize(src: string, signal?: AbortSignal): Promise<OcrPage> {
    if (signal?.aborted) return Promise.reject(stoppedError());
    return new Promise<OcrPage>((resolve, reject) => {
      let settled = false;
      let running = false;
      let release = () => {};
      const settle = (done: () => void) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        done();
        release();
      };
      const onAbort = () => {
        const mine = running;
        settle(() => reject(stoppedError()));
        if (mine) void stopWorker();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      queue = queue.then(
        () =>
          new Promise<void>((done) => {
            release = done;
            // Stopped while it waited: it never starts.
            if (settled) return done();
            if (idle) clearTimeout(idle);
            running = true;
            const me = {};
            current = me;
            readOne(src, signal)
              .then(
                (page) => settle(() => resolve(page)),
                (err) => settle(() => reject(err)),
              )
              .finally(() => {
                running = false;
                done();
                // A stopped reading that ends after the next has begun leaves that one's worker alone.
                if (current !== me) return;
                current = null;
                idleLater();
              });
          }),
      );
    });
  }

  async function readPages(pages: readonly SentPage[], signal: AbortSignal, settings: ReportConfig, now?: readonly SentPage[]): Promise<PageRead[]> {
    const out: PageRead[] = [];
    for (const { src, meta } of now ?? pages) {
      if (signal.aborted) break;
      try {
        out.push({ meta, read: pageRead(await recognize(src, signal), meta, settings.unit, settings.pageSize) });
      } catch (err) {
        if (signal.aborted) break;
        // The picture still goes with the request; only its text does not.
        log(`The text of ${meta.file} could not be read: ${String(err)}`);
      }
    }
    return out;
  }

  async function close(): Promise<void> {
    await queue;
    if (idle) clearTimeout(idle);
    idle = null;
    await stopWorker();
  }

  return {
    english: paddleDir ? 'paddle' : 'tesseract',
    ready: () => void gatherLanguages(options.languages),
    recognize,
    readPages,
    close,
  };
}
