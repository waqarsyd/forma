/**
 * PaddleOCR reading a page in Node, through onnxruntime-node on the CPU
 * (2026-11-24, the MCP work's wave 7; finding NODE-5 of the 2026-11-23
 * design audit). The one Node reader: the MCP server's OCR (nodeOcr.ts) and
 * the measuring scripts (scripts/model/paddleOcr.ts, and through it the
 * fidelity benchmark) both open the models here. It was the scripts' own
 * until then; the steps were always the app's (lib/paddleOcr.ts).
 *
 * The models are PaddlePaddle's own ONNX exports, Apache-2.0: det.onnx,
 * rec-en.onnx and rec-en.yml, what `npm run fetch:paddle` downloads into
 * vendor/paddle, pinned there by SHA-256. They are read only when every one
 * is there with its pinned hash (`pinnedModelsIn`): the browser's rule,
 * where a site that does not serve them reads with Tesseract.
 *
 * onnxruntime-node is a devDependency, loaded only when a reader is opened,
 * on the CPU binaries its package ships for every platform; its install
 * script, which only downloads Linux CUDA binaries, stays denied
 * (package.json, comment:allowScripts).
 *
 * The only module under src/mcp a script imports (boundaries.test.ts names
 * it): a Node module both use, so neither keeps a copy.
 *
 * Pure ASCII.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InferenceSession } from 'onnxruntime-node';
import { ENLARGE_BELOW } from '../lib/ocrRead';
import {
  characterDict,
  DETECT_LONG_SIDE,
  paddleReader as readerOver,
  RECOGNIZE_MIN_WIDTH,
  resizeRgb,
  scaled,
  type OrtSessionLike,
  type PaddlePage,
  type PaddleReader,
  type Rgb,
} from '../lib/paddleOcr';

/**
 * Each model file and its SHA-256, as scripts/fetch-paddle.mjs pins them
 * (nodePaddle.test.ts holds the two lists equal): the files the app's
 * accuracy was measured on (docs/notes/app-shell.md, *PaddleOCR reads an
 * English page*).
 */
export const PADDLE_PINS: Readonly<Record<string, string>> = {
  'det.onnx': 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d',
  'rec-en.onnx': 'b5f833dfc5d0eb71da397b4efa06ebeee9b431b690a47d6af40d77d8eabc557f',
  'rec-en.yml': '27e91d0582f40168aa218303c76e184bc78fa7a5d105aad0cfbad8458b441067',
};

/** Whether `dir` holds the pinned models, each with its pinned hash; why not, when it does not. */
export function pinnedModelsIn(dir: string): { ok: true } | { ok: false; why: string } {
  for (const [name, want] of Object.entries(PADDLE_PINS)) {
    const path = join(dir, name);
    if (!existsSync(path)) return { ok: false, why: `${name} is not in ${dir}` };
    const got = createHash('sha256').update(readFileSync(path)).digest('hex');
    if (got !== want) return { ok: false, why: `${name} in ${dir} is not the pinned file (SHA-256 ${got})` };
  }
  return { ok: true };
}

/** The detector and recogniser in `dir`, read with onnxruntime-node. */
export async function paddleReader(dir: string, recName = 'rec-en', detectLongSide?: number, recognizeMinWidth?: number, threads?: number): Promise<PaddleReader> {
  const ort = await import('onnxruntime-node');
  const options: InferenceSession.SessionOptions = { logSeverityLevel: 3, ...(threads ? { intraOpNumThreads: threads, interOpNumThreads: 1 } : {}) };
  const det = await ort.InferenceSession.create(join(dir, 'det.onnx'), options);
  const rec = await ort.InferenceSession.create(join(dir, `${recName}.onnx`), options);
  const dict = characterDict(readFileSync(join(dir, `${recName}.yml`), 'utf8'));
  return readerOver(det as unknown as OrtSessionLike, rec as unknown as OrtSessionLike, dict, (data, dims) => new ort.Tensor('float32', data, dims), { detectLongSide, recognizeMinWidth });
}

/** The app's reader over the models in `dir`: the app's detection size and narrowest recognition. */
export function appReader(dir: string, threads?: number): Promise<PaddleReader> {
  return paddleReader(dir, 'rec-en', DETECT_LONG_SIDE, RECOGNIZE_MIN_WIDTH, threads);
}

/**
 * A picture read as the app reads it (lib/ocr.ts and lib/paddle.ts): drawn
 * twice its size when narrower than ENLARGE_BELOW, read by `reader`, and the
 * boxes brought back to the picture's size. Whether the page is in the
 * recogniser's script (`inItsScript`) is the caller's to decide, as the
 * browser's is.
 */
export async function readAsTheApp(reader: PaddleReader, img: Rgb): Promise<PaddlePage> {
  const scale = img.width < ENLARGE_BELOW ? 2 : 1;
  const read = await reader.read(scale === 2 ? resizeRgb(img, img.width * 2, img.height * 2) : img, null);
  return scaled(read, img, scale);
}
