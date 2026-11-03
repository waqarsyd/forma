/**
 * Forma's vision model, asked through the Local AI provider (2026-11-03,
 * milestone 6 of docs/proposals/own-model.md).
 *
 * The model is fine-tuned on Kaggle and runs in the user's own Ollama or LM
 * Studio. It reads a picture of a report page and writes the page's skeleton
 * in the text of skeletonText.ts, nothing else. So the mega-prompt of
 * geminiService.ts, which asks a model for a spec, a layout and a .repx in
 * JSON, is the wrong question for it.
 * - **The question:** this module asks it exactly what it was trained on,
 *   the picture and then VISION_INSTRUCTION.
 * - **Transport:** the request goes through compatClient, so it reaches the
 *   same endpoints the provider settings already allow.
 * - **The report:** skeletonRepx.ts builds it, with the words OCR read.
 *
 * A model counts as Forma's by its name: whatever it was imported as must
 * contain "forma-vision", as `ollama create forma-vision` and the LM Studio
 * folder in the training script's export both do.
 */
import { compatClient } from './compatClient';
import { textToSkeleton, VISION_INSTRUCTION, type SkeletonReading } from '../lib/skeletonText';

/** Is the local model Forma's own vision model, by the name it was imported under? */
export const isFormaVisionModel = (model: string | undefined | null) => /forma-vision/i.test(model ?? '');

/** A data URL's bytes and type, as the request carries an image. */
export function imagePart(dataUrl: string): { data: string; mimeType: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  return m ? { mimeType: m[1], data: m[2] } : null;
}

/**
 * The skeleton the model reads from one page. It answers at temperature 0,
 * since there is one right answer to read. The longest skeleton it was
 * trained on fits in 4,096 tokens. `text` is its answer as written, kept
 * for a reply that could not be read.
 */
export async function readSkeleton(
  endpoint: { baseUrl: string; model: string },
  pageDataUrl: string,
  signal?: AbortSignal,
): Promise<SkeletonReading & { text: string }> {
  const image = imagePart(pageDataUrl);
  if (!image) throw new Error('The page is not an image Forma can send to the model.');
  const client = compatClient({ kind: 'local', baseUrl: endpoint.baseUrl.replace(/\/+$/, ''), model: endpoint.model });
  const answer = await client.models.generateContent({
    model: endpoint.model,
    contents: [{ role: 'user', parts: [{ inlineData: image }, { text: VISION_INSTRUCTION }] }],
    config: { temperature: 0, maxOutputTokens: 4096, abortSignal: signal },
  });
  return { ...textToSkeleton(answer.text), text: answer.text };
}
