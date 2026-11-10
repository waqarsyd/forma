/**
 * PaddleOCR's PP-OCRv5 models reading a page in Node (2026-11-10, the owner's
 * AI accuracy programme, batch AC), for measuring it beside Tesseract.js on
 * the private real pages (ocrCompare.ts) and for the box reader's training on
 * its readings. The steps are the app's own (src/lib/paddleOcr.ts); this only
 * opens the two models with onnxruntime-node on the CPU.
 *
 * The models are PaddlePaddle's own ONNX exports, Apache-2.0, kept in a
 * folder outside the repository as det.onnx, det.yml, rec-en.onnx and
 * rec-en.yml: what `npm run fetch:paddle` downloads into vendor/paddle.
 *
 * Pure ASCII, as every script here.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as ort from 'onnxruntime-node';
import type { OcrPage } from '../../src/lib/ocr';
import { inItsScript, scaled } from '../../src/lib/paddle';
import { characterDict, DETECT_LONG_SIDE, paddleReader as readerOver, RECOGNIZE_MIN_WIDTH, resizeRgb, rgbFromRgba, type OrtSessionLike, type PaddleReader } from '../../src/lib/paddleOcr';

export { resizeRgb, type PaddleReader, type Rgb } from '../../src/lib/paddleOcr';

/** The detector and recogniser in `dir`, read with onnxruntime-node. */
export async function paddleReader(dir: string, recName = 'rec-en', detectLongSide?: number, recognizeMinWidth?: number): Promise<PaddleReader> {
  const options: ort.InferenceSession.SessionOptions = { logSeverityLevel: 3 };
  const det = await ort.InferenceSession.create(join(dir, 'det.onnx'), options);
  const rec = await ort.InferenceSession.create(join(dir, `${recName}.onnx`), options);
  const dict = characterDict(readFileSync(join(dir, `${recName}.yml`), 'utf8'));
  return readerOver(det as unknown as OrtSessionLike, rec as unknown as OrtSessionLike, dict, (data, dims) => new ort.Tensor('float32', data, dims), { detectLongSide, recognizeMinWidth });
}

let appReader: Promise<PaddleReader> | null = null;

/**
 * A picture read as the app reads it (lib/ocr.ts and lib/paddle.ts, since
 * 2026-11-10): drawn twice its size when narrower than 1,600 pixels, read by
 * PaddleOCR with the app's own settings, and the boxes brought back to the
 * picture's size. Null when the models are not in `modelsDir` (`npm run
 * fetch:paddle`) or the page is in a script PaddleOCR does not read, which is
 * when the app reads it with Tesseract. Readings are cached in `cachePath` by
 * the picture's path.
 */
export async function readPictureAsTheApp(png: string, cachePath: string, modelsDir = 'vendor/paddle'): Promise<OcrPage | null> {
  if (!existsSync(`${modelsDir}/det.onnx`)) return null;
  const cache: Record<string, OcrPage | null> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  if (png in cache) return cache[png];
  appReader ??= paddleReader(modelsDir, 'rec-en', DETECT_LONG_SIDE, RECOGNIZE_MIN_WIDTH);
  const picture = await loadImage(readFileSync(png));
  const canvas = createCanvas(picture.width, picture.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, picture.width, picture.height);
  ctx.drawImage(picture, 0, 0);
  const img = rgbFromRgba(ctx.getImageData(0, 0, picture.width, picture.height).data, picture.width, picture.height);
  const scale = img.width < 1600 ? 2 : 1;
  const read = await (await appReader).read(scale === 2 ? resizeRgb(img, img.width * 2, img.height * 2) : img, null);
  const page = scaled(read, img, scale);
  cache[png] = inItsScript(page) ? page : null;
  writeFileSync(cachePath, JSON.stringify(cache));
  return cache[png];
}
