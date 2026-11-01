/**
 * OCR as the chat box uses it (2026-11-01): a page is read the moment it is
 * attached, and what was read goes with the message as text, as a PDF's text
 * layer does. The owner asked for one chat box that handles every input the
 * way other chat apps do, so the separate OCR button became this.
 *
 * Loaded on demand by `App.tsx`, like the engine it drives: the workspace's
 * entry chunk carries none of it.
 */
import type { PreviewMeta } from './attachments';
import { recognizePage, type OcrPage } from './ocr';
import { detectLayout, layoutText } from './ocrLayout';
import { imageDpi, pageForImage } from './reportGeometry';

/** A page read: the OCR, and how many of its texts hold a word read without confidence. */
export interface ReadPage {
  ocr: OcrPage;
  flagged: number;
  lines: number;
}

/** OCR one attached page, at its resolution when it is a rendered PDF page. */
export async function readPage(
  src: string,
  meta: PreviewMeta,
  unit: string,
  paper: string,
  onProgress?: (progress: number) => void,
): Promise<ReadPage> {
  const read = await recognizePage(src, null, {
    onProgress: (stage, progress) => {
      // The engine's loading stages say nothing a reader needs; the reading does.
      if (/recogniz/i.test(stage)) onProgress?.(progress);
    },
  });
  const ocr = { ...read, dpi: meta.pagePoints ? imageDpi(read.width, meta.pagePoints.width) : null };
  const layout = detectLayout([{ ocr, page: pageForImage(ocr, unit, paper) }], { unit });
  return { ocr, flagged: layout.flagged, lines: ocr.lines.length };
}

/**
 * The text that goes with a message, one attachment per page read: each
 * page's strings with their boxes, tables as tables and unsure words marked,
 * in the form the prompt's SOURCE PRECEDENCE describes as READ BY OCR.
 */
export function ocrTexts(
  pages: readonly { meta: PreviewMeta; read: ReadPage }[],
  unit: string,
  paper: string,
): { uploadId: string; file: string; page?: number; text: string }[] {
  if (!pages.length) return [];
  const layout = detectLayout(pages.map(({ read }) => ({ ocr: read.ocr, page: pageForImage(read.ocr, unit, paper) })), { unit });
  return pages.map(({ meta }, i) => ({
    uploadId: meta.uploadId,
    file: meta.file,
    page: meta.page,
    text: layoutText(layout.pages[i], meta.page ?? 1, unit, meta.file),
  }));
}
