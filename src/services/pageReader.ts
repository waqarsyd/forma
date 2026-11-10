/**
 * The page reader on the Local AI server (2026-11-10, batch AF, item 18;
 * lib/localModels.ts has why): a model such as glm-ocr that reads a picture's
 * text, asked once per page through compatClient, as Forma's vision model is
 * (formaVision.ts). Its answer goes to the AI beside OCR's, never in place of
 * it, so a reader that is off or fails costs nothing but its own text.
 */
import { compatClient } from './compatClient';
import { imagePart } from './formaVision';
import { pageReaderPrompt } from '../lib/localModels';

/** The text the page reader reads from one page, as it wrote it. */
export async function readPageText(endpoint: { baseUrl: string; model: string }, pageDataUrl: string, signal?: AbortSignal): Promise<string> {
  const image = imagePart(pageDataUrl);
  if (!image) throw new Error('The page is not an image Forma can send to the page reader.');
  const client = compatClient({ kind: 'local', baseUrl: endpoint.baseUrl.replace(/\/+$/, ''), model: endpoint.model });
  const answer = await client.models.generateContent({
    model: endpoint.model,
    contents: [{ role: 'user', parts: [{ inlineData: image }, { text: pageReaderPrompt(endpoint.model) }] }],
    // One right answer to read, and a page's text with its tables fits.
    config: { temperature: 0, maxOutputTokens: 8192, abortSignal: signal },
  });
  return answer.text;
}
