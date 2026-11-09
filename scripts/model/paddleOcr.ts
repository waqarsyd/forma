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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import { characterDict, paddleReader as readerOver, type OrtSessionLike, type PaddleReader } from '../../src/lib/paddleOcr';

export { resizeRgb, type PaddleReader, type Rgb } from '../../src/lib/paddleOcr';

/** The detector and recogniser in `dir`, read with onnxruntime-node. */
export async function paddleReader(dir: string, recName = 'rec-en', detectLongSide?: number, recognizeMinWidth?: number): Promise<PaddleReader> {
  const options: ort.InferenceSession.SessionOptions = { logSeverityLevel: 3 };
  const det = await ort.InferenceSession.create(join(dir, 'det.onnx'), options);
  const rec = await ort.InferenceSession.create(join(dir, `${recName}.onnx`), options);
  const dict = characterDict(readFileSync(join(dir, `${recName}.yml`), 'utf8'));
  return readerOver(det as unknown as OrtSessionLike, rec as unknown as OrtSessionLike, dict, (data, dims) => new ort.Tensor('float32', data, dims), { detectLongSide, recognizeMinWidth });
}
