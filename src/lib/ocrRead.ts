/**
 * How a page's text is read, whichever engines read it (2026-11-24, the MCP
 * work's wave 7; findings NODE-1 and NODE-5 of the 2026-11-23 design audit).
 * Moved out of lib/ocr.ts, where it was the browser's alone, so the MCP
 * server's Node reader (src/mcp/nodeOcr.ts) follows the browser's rule
 * rather than a copy of it:
 *
 * - English first, by PaddleOCR where its models are there to read with
 *   (served by this site in the browser, in vendor/paddle in Node) and by
 *   Tesseract otherwise, or when PaddleOCR read too little of the page for
 *   its script (`inItsScript`);
 * - then the page's own language, worked out from that reading
 *   (lib/ocrScript.ts): a Latin page read again with French, German or
 *   Spanish beside English, and a page English garbled probed line by line
 *   in Arabic, Urdu and Hindi, and read again in the one that leads.
 *
 * The engines are handed in (`OcrEngines`): the browser's are workers fed a
 * canvas (lib/ocr.ts), Node's are a worker thread fed PNG bytes and an ONNX
 * session (src/mcp/nodeOcr.ts). What turns Tesseract's blocks into Forma's
 * page (`ocrPageFrom`) moved with it, and the width below which a picture is
 * read enlarged (`ENLARGE_BELOW`). Nothing here reaches a document, a worker
 * or storage.
 */
import type { OcrLine, OcrPage } from './ocr';
import { CONFIDENT, OTHER_SCRIPTS, bestScript, latinLanguageOf, meanConfidence, probeLines, readsAsLatin } from './ocrScript';
import type { PixelBox } from './reportGeometry';

export interface TesseractBlocks {
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

/**
 * Small text reads better enlarged: a screenshot narrower than this is drawn
 * at twice its size before recognition, and its boxes divided back.
 */
export const ENLARGE_BELOW = 1600;

/** The engines one reading uses, each on the page as its caller holds it. */
export interface OcrEngines {
  /** PaddleOCR's reading of the page, or null for Tesseract to read it: not there to read with, not the page's script, or failed. */
  paddle(): Promise<OcrPage | null>;
  /** Tesseract's reading of the whole page in `languages` (`eng`, `fra+eng` and so on). */
  tesseract(languages: string): Promise<OcrPage>;
  /** The page made ready for the language probes, once, and a probe: Tesseract's confidence in `languages` for each line box. */
  probes(): Promise<(languages: string, boxes: readonly PixelBox[]) => Promise<number[]>>;
  /** Throws when the reading was stopped; called between the steps, so a stopped reading goes no further. */
  stopped(): void;
  /** A stage of the reading has started, for the progress. */
  stage?(stage: string): void;
}

/**
 * One page read by `engines`: the reading kept, the language it was read in,
 * and PaddleOCR's reading when it was the English one.
 */
export async function readWithEngines(engines: OcrEngines): Promise<{ page: OcrPage; language: string; byPaddle: OcrPage | null }> {
  const started = performance.now();
  const took: string[] = [];
  const lap = (what: string, from: number) => took.push(`${what} ${((performance.now() - from) / 1000).toFixed(1)}s`);
  // English first, as every page always was, by PaddleOCR where it reads
  // (since 2026-11-10) and Tesseract otherwise; then the page's own
  // language, worked out from that reading (lib/ocrScript.ts).
  const byPaddle = await engines.paddle();
  // Stopped while PaddleOCR was waited for, a reading must not go on to
  // Tesseract: by then the engine may be the next reading's (the PIPE1 review).
  if (!byPaddle) engines.stopped();
  let page = byPaddle ?? (await engines.tesseract('eng'));
  lap(byPaddle ? 'PaddleOCR' : 'English', started);
  engines.stopped();
  let language = 'eng';
  if (readsAsLatin(page)) {
    const latin = latinLanguageOf(page.lines.map((l) => l.text).join(' '));
    if (latin) {
      const from = performance.now();
      const again = await engines.tesseract(`${latin}+eng`);
      lap(latin, from);
      // Over PaddleOCR's reading, only when Tesseract is sure of its own: the
      // two engines' confidences are not on one scale.
      const better = byPaddle ? meanConfidence(again.lines) >= CONFIDENT : meanConfidence(again.lines) >= meanConfidence(page.lines) - 2;
      if (better) [page, language] = [again, latin];
    }
  } else {
    const boxes = probeLines(page);
    if (boxes.length) {
      // The probes read the picture at its own size, where the boxes already
      // are: they only compare scripts, and an enlarged page costs four
      // times as much to send each time (Arabic still led English 57 to 29).
      const from = performance.now();
      engines.stage?.('working out the language');
      const probe = await engines.probes();
      engines.stopped();
      const english = await probe('eng', boxes);
      const scores: Record<string, number[]> = {};
      for (const script of OTHER_SCRIPTS) {
        engines.stopped();
        scores[script] = await probe(script, boxes);
      }
      lap('probes', from);
      const script = bestScript(english, scores);
      if (script) {
        const again = performance.now();
        [page, language] = [await engines.tesseract(`${script}+eng`), script];
        lap(script, again);
      }
    }
  }
  engines.stopped();
  console.debug(`OCR read the page as ${language === 'eng' ? 'English' : language}${byPaddle && page === byPaddle ? ' with PaddleOCR' : ''} (${took.join(', ')}).`);
  return { page, language, byPaddle };
}
