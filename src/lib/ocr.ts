/**
 * OCR in the browser (approved by the owner on 2026-11-01): the text of an
 * uploaded image or a scanned PDF page, every word and line with its box and
 * confidence, read by Tesseract.js so that nothing leaves the browser.
 *
 * A digital PDF does not come here. Its text layer already has every string
 * and its exact position (`extractPdfPageText` in App.tsx), which no OCR can
 * improve on. OCR is for what has only pixels: screenshots, photos, scans.
 *
 * The engine is loaded on first use, like `pdf.ts` and `genai.ts`, and from
 * this site's own `/ocr/` (see `servedAssets('ocr', …)` in vite.config.ts): the worker,
 * the core build for the browser's SIMD support, and the English LSTM data,
 * about 7 MB the first time and cached by the browser after. Another
 * language's data is fetched only when a page turns out to need it: since
 * 2026-11-04 OCR works out the language itself (lib/ocrScript.ts), where
 * before the user ticked languages in Settings.
 */
import type { PixelBox } from './reportGeometry';
import { OCR_BASE, OCR_WORKER } from './assetPaths';
import { CONFIDENT, OTHER_SCRIPTS, bestScript, latinLanguageOf, looksHandwritten, meanConfidence, probeLines, readsAsLatin } from './ocrScript';

/** One recognized word: its text, its box in the image's pixels, and Tesseract's confidence, 0 to 100. */
export interface OcrWord {
  text: string;
  box: PixelBox;
  confidence: number;
}

/** One recognized line, with its words. */
export interface OcrLine {
  text: string;
  box: PixelBox;
  confidence: number;
  words: OcrWord[];
}

/**
 * One page's OCR: its image size in pixels, its resolution when known (a
 * rendered PDF page), and its lines in reading order.
 */
export interface OcrPage {
  width: number;
  height: number;
  dpi: number | null;
  lines: OcrLine[];
}

interface TesseractBlocks {
  paragraphs?: { lines?: { text: string; confidence: number; bbox: PixelBox; words?: { text: string; confidence: number; bbox: PixelBox }[] }[] }[];
}

const scaleBox = (b: PixelBox, s: number): PixelBox => ({ x0: b.x0 / s, y0: b.y0 / s, x1: b.x1 / s, y1: b.y1 / s });

/*
 * Direction marks Tesseract wraps right-to-left words in (2026-11-04, read in
 * the owner's Chrome with Arabic chosen: U+200F before a word, U+200E after).
 * They print as nothing, so a report's text keeps none of them, and they would
 * stop a word matching itself anywhere downstream.
 */
const DIRECTION_MARKS = /[‎‏‪-‮⁦-⁩]/g;

/**
 * Tesseract's blocks as an `OcrPage`, its boxes divided by `scale` when the
 * image was enlarged for recognition. Pure; empty words and lines are left
 * out, and a line's text is its words', so the two never disagree.
 */
export function ocrPageFrom(blocks: readonly TesseractBlocks[] | null | undefined, image: { width: number; height: number; dpi: number | null }, scale = 1): OcrPage {
  const lines: OcrLine[] = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const words = (line.words ?? [])
          .map((w) => ({ text: w.text.replace(DIRECTION_MARKS, '').trim(), box: scaleBox(w.bbox, scale), confidence: w.confidence }))
          .filter((w) => w.text);
        if (!words.length) continue;
        lines.push({
          text: words.map((w) => w.text).join(' '),
          box: scaleBox(line.bbox, scale),
          confidence: line.confidence,
          words,
        });
      }
    }
  }
  return { ...image, lines };
}

/** What the engine reports as it loads and reads, for a progress bar: a stage and 0 to 1. */
export type OcrProgress = (stage: string, progress: number) => void;

type Engine = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let engine: Promise<Engine> | null = null;
/** The languages the engine reads now, `eng` alone or `ara+eng` and so on. */
let engineLanguages = '';
let listener: OcrProgress | null = null;

/**
 * The engine, created once and kept: loading it is most of the cost. Given
 * other languages, the same worker is re-initialised with them rather than
 * created again, which fetches only the new language's data.
 */
async function loadEngine(languages = 'eng'): Promise<Engine> {
  if (!engine) {
    engineLanguages = languages;
    engine = import('tesseract.js')
      .then(({ createWorker, OEM }) =>
        createWorker(languages, OEM.LSTM_ONLY, {
          // Versioned by the build (site audit item 91, lib/assetPaths.ts).
          workerPath: OCR_WORKER,
          corePath: OCR_BASE,
          langPath: OCR_BASE,
          gzip: true,
          logger: (m: { status: string; progress: number }) => listener?.(m.status, m.progress),
        }),
      )
      .catch((err) => {
        engine = null;
        throw err;
      });
    return engine;
  }
  const worker = await engine;
  if (engineLanguages !== languages) {
    const { OEM } = await import('tesseract.js');
    await worker.reinitialize(languages, OEM.LSTM_ONLY);
    engineLanguages = languages;
  }
  return worker;
}

type Recognized = Awaited<ReturnType<Engine['recognize']>>;

/** One reading of the whole page with `languages`, as an `OcrPage`. */
async function readWith(
  languages: string,
  input: HTMLCanvasElement,
  image: { width: number; height: number; dpi: number | null },
  scale: number,
): Promise<OcrPage> {
  const worker = await loadEngine(languages);
  const result: Recognized = await worker.recognize(input, {}, { blocks: true });
  return ocrPageFrom(result.data.blocks as TesseractBlocks[] | null, image, scale);
}

/** A canvas as one PNG, encoded once for the reads that share it. */
function pngOf(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The page could not be encoded.'))), 'image/png'));
}

/**
 * How confidently `languages` reads each of the given lines, as rectangles of
 * the whole page. Measured on 2026-11-04 on the owner's certificate, the
 * three ways a line can be probed: as a rectangle of the page, Arabic read the
 * six lines at 58.8 against English's 32.7; cut out as crops, 50.0 against
 * 46.8, too close to tell, because a crop has no resolution and Tesseract
 * guesses one for each (269 to 789 dpi on those six). The page goes in once,
 * encoded beforehand: given the canvas, each read encoded it again, and the
 * probes took 98 s.
 */
async function probeWith(languages: string, page: Blob, boxes: readonly PixelBox[]): Promise<number[]> {
  const worker = await loadEngine(languages);
  const out: number[] = [];
  for (const b of boxes) {
    const rectangle = { left: Math.round(b.x0), top: Math.round(b.y0), width: Math.round(b.x1 - b.x0), height: Math.round(b.y1 - b.y0) };
    const result: Recognized = await worker.recognize(page, { rectangle });
    out.push(result.data.confidence);
  }
  return out;
}

/** PaddleOCR's module (lib/paddle.ts), once a reading has asked for it. */
let paddle: typeof import('./paddle') | null = null;

/**
 * PaddleOCR's reading of the page (2026-11-10, the AI accuracy programme,
 * batch AC), or null for Tesseract to read it: when this site does not serve
 * the models, when the page is in a script the English recogniser does not
 * know (`inItsScript`), or when it fails. Measured on the company's private
 * pages, PaddleOCR found 97% of the characters printed where Tesseract found
 * 61% (docs/notes/app-shell.md, *OCR reads the text of an image or a scan*).
 */
async function readByPaddle(
  input: HTMLCanvasElement,
  image: { width: number; height: number; dpi: number | null },
  scale: number,
  signal: AbortSignal | undefined,
): Promise<OcrPage | null> {
  try {
    paddle ??= await import('./paddle');
    if (!(await paddle.paddleServed())) return null;
    const page = await paddle.readWithPaddle(input, image, scale, { onProgress: (status, progress) => listener?.(status, progress), signal });
    if (!paddle.inItsScript(page)) {
      console.debug('PaddleOCR read too little of this page for its script; Tesseract reads it.');
      return null;
    }
    return page;
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn('PaddleOCR did not read the page; Tesseract reads it.', err);
    return null;
  }
}

/** Stop the engine, for a cancelled run; the next run loads it again. */
export async function stopOcr(): Promise<void> {
  paddle?.stopPaddle();
  const running = engine;
  engine = null;
  if (running) await (await running.catch(() => null))?.terminate();
}

/**
 * Small text reads better enlarged: a screenshot narrower than this is drawn
 * at twice its size before recognition, and its boxes divided back.
 */
const ENLARGE_BELOW = 1600;

/**
 * OCR one page image, given as a data URL or a canvas; `dpi` when it is a
 * rendered PDF page. A signal that aborts stops the engine, since a running
 * recognition cannot otherwise be interrupted.
 */
export async function recognizePage(
  image: string | HTMLCanvasElement,
  dpi: number | null,
  options: { onProgress?: OcrProgress; signal?: AbortSignal } = {},
): Promise<OcrPage> {
  const source = typeof image === 'string' ? await imageCanvas(image) : image;
  const scale = source.width < ENLARGE_BELOW ? 2 : 1;
  const input = scale === 1 ? source : enlarge(source, scale);
  const abort = () => void stopOcr();
  options.signal?.addEventListener('abort', abort, { once: true });
  const stopped = () => {
    if (options.signal?.aborted) throw new DOMException('OCR was stopped.', 'AbortError');
  };
  try {
    stopped();
    listener = options.onProgress ?? null;
    const image = { width: source.width, height: source.height, dpi };
    const started = performance.now();
    const took: string[] = [];
    const lap = (what: string, from: number) => took.push(`${what} ${((performance.now() - from) / 1000).toFixed(1)}s`);
    // English first, as every page always was, by PaddleOCR where this site
    // serves it (since 2026-11-10) and Tesseract otherwise; then the page's own
    // language, worked out from that reading (lib/ocrScript.ts).
    const byPaddle = await readByPaddle(input, image, scale, options.signal);
    let page = byPaddle ?? (await readWith('eng', input, image, scale));
    lap(byPaddle ? 'PaddleOCR' : 'English', started);
    stopped();
    let language = 'eng';
    if (readsAsLatin(page)) {
      const latin = latinLanguageOf(page.lines.map((l) => l.text).join(' '));
      if (latin) {
        const from = performance.now();
        const again = await readWith(`${latin}+eng`, input, image, scale);
        lap(latin, from);
        // Over PaddleOCR's reading, only when Tesseract is sure of its own: the
        // two engines' confidences are not on one scale.
        const better = byPaddle ? meanConfidence(again.lines) >= CONFIDENT : meanConfidence(again.lines) >= meanConfidence(page.lines) - 2;
        if (better) [page, language] = [again, latin];
      }
    } else {
      const boxes = probeLines(page);
      if (boxes.length) {
        // The probes read the picture at its own size, where the boxes already
        // are: they only compare scripts, and an enlarged page costs four
        // times as much to send each time (Arabic still led English 57 to 29).
        const from = performance.now();
        listener?.('working out the language', 0);
        const png = await pngOf(source);
        const english = await probeWith('eng', png, boxes);
        const scores: Record<string, number[]> = {};
        for (const script of OTHER_SCRIPTS) {
          stopped();
          scores[script] = await probeWith(script, png, boxes);
        }
        lap('probes', from);
        const script = bestScript(english, scores);
        if (script) {
          const again = performance.now();
          [page, language] = [await readWith(`${script}+eng`, input, image, scale), script];
          lap(script, again);
        }
      }
    }
    stopped();
    console.debug(`OCR read the page as ${language === 'eng' ? 'English' : language}${byPaddle && page === byPaddle ? ' with PaddleOCR' : ''} (${took.join(', ')}).`);
    // The lines still unsure, read again as handwriting (2026-11-04,
    // lib/handwriting.ts): only on a Latin page where enough of them are
    // unsure, and only where this site serves the model. One that will not
    // load leaves Tesseract's reading as it was.
    if (language !== 'eng' || !looksHandwritten(page)) return page;
    try {
      const { handwritingServed, readHandwriting } = await import('./handwriting');
      if (!(await handwritingServed())) return page;
      listener?.('reading handwriting', 0);
      return await readHandwriting(page, source, options.signal);
    } catch (err) {
      console.warn('Handwriting was not read; keeping what OCR read.', err);
      return page;
    }
  } finally {
    listener = null;
    options.signal?.removeEventListener('abort', abort);
  }
}

async function imageCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.drawImage(img, 0, 0);
  return canvas;
}

function enlarge(source: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width * scale;
  canvas.height = source.height * scale;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingQuality = 'high';
  c.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}
