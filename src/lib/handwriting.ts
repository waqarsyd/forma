/**
 * Handwriting, read by TrOCR after Tesseract (2026-11-04; the owner approved
 * the test and then chose to serve the model from Forma's own site, opt-in).
 *
 * Tesseract's data is trained on print and reads handwriting badly. Measured
 * on 60 real handwritten lines (IAM, the validation split), Tesseract's
 * character error rate was 47.4% and TrOCR-small-handwritten's 10.1%; on
 * printed lines Tesseract was exact and TrOCR 4.3% wrong. So TrOCR is not a
 * second OCR for everything: it reads again only the lines Tesseract was
 * unsure of, below a confidence of 70, which kept the printed lines exact and
 * the report-style lines in handwriting fonts at 3.6%, and brought the real
 * handwriting to 10.6% (docs/notes/app-shell.md, *Handwriting*).
 *
 * TrOCR reads one line at a time, so each unsure line is cut from the page
 * with a little margin and read whole; the line becomes one word, its box the
 * line's, since TrOCR gives no word boxes. English only, as the model was
 * trained.
 *
 * The model (about 66 MB with its tokenizer) from `/handwriting/models/` and
 * ONNX Runtime's WebAssembly (21 MB) from the site's own assets are fetched
 * the first time it runs, and the browser keeps them; nothing is fetched from
 * anywhere else (`env.allowRemoteModels` false, checked in the owner's
 * Chrome by listing every request). The pure functions below decide what to read and how the result
 * fits back; `readHandwriting` is the browser half.
 */
import type { OcrPage } from './ocr';
import type { PixelBox } from './reportGeometry';
/*
 * ONNX Runtime's glue and WebAssembly, as URLs of this site's own copies.
 * Transformers.js points the runtime at cdn.jsdelivr.net otherwise, which the
 * production CSP blocked in the owner's Chrome on 2026-11-04 (handwriting then
 * fell back to Tesseract's reading, silently). Imported by path because the
 * package does not export its dist files; Vite emits each once, hashed.
 */
import ortMjs from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url';
import ortWasm from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';

/** Lines Tesseract read below this confidence are read again by TrOCR. */
export const HANDWRITING_BELOW = 70;
/** The confidence a line read by TrOCR is given: high enough not to be flagged, no higher. */
export const HANDWRITING_CONFIDENCE = 60;
/** Where the model and the runtime are served. */
export const HANDWRITING_BASE = '/handwriting/';
const MODEL = 'Xenova/trocr-small-handwritten';

/** The lines of a page to read again, by index: those below `below`, with at least one word. */
export function unsureLines(page: OcrPage, below = HANDWRITING_BELOW): number[] {
  return page.lines.flatMap((line, i) => (line.confidence < below && line.words.length ? [i] : []));
}

/**
 * Where to cut a line from its page: its box with a margin of a fifth of its
 * height above and below and half its height at the sides, inside the page.
 * TrOCR read IAM lines cut with room around the ink, and a line cut tight
 * loses the tops and tails of its letters.
 */
export function lineCrop(box: PixelBox, page: { width: number; height: number }): PixelBox {
  const h = box.y1 - box.y0;
  return {
    x0: Math.max(0, Math.floor(box.x0 - h / 2)),
    y0: Math.max(0, Math.floor(box.y0 - h / 5)),
    x1: Math.min(page.width, Math.ceil(box.x1 + h / 2)),
    y1: Math.min(page.height, Math.ceil(box.y1 + h / 5)),
  };
}

/** The page with the lines TrOCR read replaced: each one word over the line's box. Lines it read as nothing are kept. */
export function withHandwriting(page: OcrPage, read: ReadonlyMap<number, string>): OcrPage {
  return {
    ...page,
    lines: page.lines.map((line, i) => {
      const text = read.get(i)?.replace(/\s+/g, ' ').trim();
      if (!text) return line;
      return { text, box: line.box, confidence: HANDWRITING_CONFIDENCE, words: [{ text, box: line.box, confidence: HANDWRITING_CONFIDENCE }] };
    }),
  };
}

type Reader = (image: unknown, options: { max_new_tokens: number }) => Promise<{ generated_text?: string }[]>;
let reader: Promise<{ read: Reader; fromCanvas: (c: HTMLCanvasElement) => unknown }> | null = null;

/** TrOCR, loaded once from this site and kept. */
function loadReader() {
  if (!reader) {
    reader = import('@huggingface/transformers')
      .then(async ({ pipeline, env, RawImage }) => {
        // From this site only: the model from /handwriting/models/, and the
        // runtime's two files from the build's own assets.
        env.allowRemoteModels = false;
        env.allowLocalModels = true;
        env.localModelPath = `${HANDWRITING_BASE}models/`;
        if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };
        const read = (await pipeline('image-to-text', MODEL, { dtype: 'q8', device: 'wasm' })) as unknown as Reader;
        return { read, fromCanvas: (c: HTMLCanvasElement) => RawImage.fromCanvas(c) };
      })
      .catch((err) => {
        reader = null;
        throw err;
      });
  }
  return reader;
}

/**
 * Read the unsure lines of a page again as handwriting, from `source`, the
 * image the page was read from at its own size. Resolves to the page as it
 * was when there is nothing to read; rejects when the model cannot be loaded,
 * and the caller keeps Tesseract's reading.
 */
export async function readHandwriting(page: OcrPage, source: HTMLCanvasElement, signal?: AbortSignal): Promise<OcrPage> {
  const lines = unsureLines(page);
  if (!lines.length) return page;
  const { read, fromCanvas } = await loadReader();
  const results = new Map<number, string>();
  for (const i of lines) {
    if (signal?.aborted) break;
    const crop = lineCrop(page.lines[i].box, page);
    const w = crop.x1 - crop.x0;
    const h = crop.y1 - crop.y0;
    if (w < 4 || h < 4) continue;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(source, crop.x0, crop.y0, w, h, 0, 0, w, h);
    const out = await read(fromCanvas(canvas), { max_new_tokens: 64 });
    results.set(i, out[0]?.generated_text ?? '');
  }
  return withHandwriting(page, results);
}
