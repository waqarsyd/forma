/**
 * The text the page reader on the Local AI server reads from the sent
 * pictures, one attachment a page beside OCR's (2026-11-10, batch AF,
 * lib/localModels.ts). Asked one page at a time, since a local server answers
 * one at a time; a reader that is off or fails leaves its text out.
 *
 * Moved out of App.tsx on 2026-11-11 (the re-audit's R2-11), loaded only
 * when a page reader is set up: the workspace chunk had no room for what the
 * fix added to App. Each reading is marked `readByReader`, so the request
 * that corrects Forma's draft gives it a heading of its own, never "other
 * files the user attached", which the AI was told to take field names from.
 */
import { readPageText } from '../services/pageReader';
import { pageReaderText } from './localModels';
import type { PreviewMeta } from './attachments';
import type { TextAttachment } from './repxIntake';

export async function readerAttachments(
  reader: { baseUrl: string; model: string },
  pages: readonly { src: string; meta: PreviewMeta }[],
  signal: AbortSignal,
): Promise<TextAttachment[]> {
  try {
    const stamp = Date.now();
    const out: TextAttachment[] = [];
    for (const [i, { src, meta }] of pages.entries()) {
      if (signal.aborted) break;
      const text = pageReaderText(meta.file, meta.page ?? 1, reader.model, await readPageText(reader, src, signal));
      if (text) out.push({ id: `${stamp}-${i}-reader-${meta.file}-p${meta.page ?? 1}`, uploadId: meta.uploadId, file: meta.file, page: meta.page, text, readByReader: true });
    }
    return out;
  } catch (err) {
    if (!signal.aborted) console.warn(`The page reader ${reader.model} could not read the page; the AI designs from OCR's reading alone.`, err);
    return [];
  }
}
