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
 * about 7 MB the first time and cached by the browser after; with each
 * language chosen in Settings, its own data too (lib/ocrLanguages.ts).
 */
import type { PixelBox } from './reportGeometry';
import { ocrLanguageString } from './ocrLanguages';

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
/** The languages the engine was created with, `eng` alone or `eng+ara` and so on. */
let engineLanguages = '';
let listener: OcrProgress | null = null;

/**
 * The engine, created once and kept: loading it is most of the cost. Created
 * again when the languages chosen in Settings change (2026-11-04,
 * lib/ocrLanguages.ts), since Tesseract reads the ones it was created with.
 */
async function loadEngine(): Promise<Engine> {
  const languages = ocrLanguageString();
  if (engine && engineLanguages !== languages) await stopOcr();
  if (!engine) {
    engineLanguages = languages;
    engine = import('tesseract.js')
      .then(({ createWorker, OEM }) =>
        createWorker(languages, OEM.LSTM_ONLY, {
          workerPath: '/ocr/worker.min.js',
          corePath: '/ocr/',
          langPath: '/ocr/',
          gzip: true,
          logger: (m: { status: string; progress: number }) => listener?.(m.status, m.progress),
        }),
      )
      .catch((err) => {
        engine = null;
        throw err;
      });
  }
  return engine;
}

/** Stop the engine, for a cancelled run; the next run loads it again. */
export async function stopOcr(): Promise<void> {
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
  try {
    if (options.signal?.aborted) throw new DOMException('OCR was stopped.', 'AbortError');
    listener = options.onProgress ?? null;
    const worker = await loadEngine();
    const result = await worker.recognize(input, {}, { blocks: true });
    if (options.signal?.aborted) throw new DOMException('OCR was stopped.', 'AbortError');
    return ocrPageFrom(result.data.blocks as TesseractBlocks[] | null, { width: source.width, height: source.height, dpi }, scale);
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
