/**
 * PaddleOCR's PP-OCRv5 models reading a page in Node (2026-11-10, the owner's
 * AI accuracy programme, batch AC), for measuring it beside Tesseract.js on
 * the private real pages (ocrCompare.ts) and for the box reader's training on
 * its readings. The steps are the app's own (src/lib/paddleOcr.ts); opening
 * the two models with onnxruntime-node on the CPU, and reading a picture as
 * the app reads it, are src/mcp/nodePaddle.ts's since 2026-11-24 (the MCP
 * work's wave 7), shared with the MCP server's OCR, so neither keeps a copy.
 * What is left here is the scripts' own: a picture read from a file, and the
 * readings kept in a cache file.
 *
 * The models are PaddlePaddle's own ONNX exports, Apache-2.0, kept in a
 * folder outside the repository as det.onnx, det.yml, rec-en.onnx and
 * rec-en.yml: what `npm run fetch:paddle` downloads into vendor/paddle.
 *
 * Pure ASCII, as every script here.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { OcrPage } from '../../src/lib/ocr';
import { inItsScript, rgbFromRgba, type PaddleReader } from '../../src/lib/paddleOcr';
import { appReader, readAsTheApp } from '../../src/mcp/nodePaddle';

export { paddleReader } from '../../src/mcp/nodePaddle';
export { resizeRgb, type PaddleReader, type Rgb } from '../../src/lib/paddleOcr';

let reader: Promise<PaddleReader> | null = null;

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
  reader ??= appReader(modelsDir);
  const picture = await loadImage(readFileSync(png));
  const canvas = createCanvas(picture.width, picture.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, picture.width, picture.height);
  ctx.drawImage(picture, 0, 0);
  const page = await readAsTheApp(await reader, rgbFromRgba(ctx.getImageData(0, 0, picture.width, picture.height).data, picture.width, picture.height));
  cache[png] = inItsScript(page) ? page : null;
  writeFileSync(cachePath, JSON.stringify(cache));
  return cache[png];
}
