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
import { READER_MAX_LOST, readDetectedPage, type BoxReaderModel } from './boxReader';
import { pageReadingOf, type PageReading } from './readerPairs';
import { recognizePage, type OcrPage } from './ocr';
import { detectLayout, layoutText } from './ocrLayout';
import { layoutToRepx, layoutToReport, ocrSummary, reportNameFor, validateOcrRepx } from './ocrRepx';
import { imageDpi, pageForImage } from './reportGeometry';
import type { ReportSkeleton } from './reportSkeleton';
import type { ReportLayout } from './reportTypes';
import { mergePageSkeletons, pageTextsOf, skeletonToDesign, type DraftGiven, type PageText } from './skeletonRepx';

/** A page read: the OCR, and how many of its texts hold a word read without confidence. */
export interface ReadPage {
  ocr: OcrPage;
  flagged: number;
  lines: number;
}

/**
 * OCR one attached page, at its resolution when it is a rendered PDF page.
 * `signal` stops it (2026-11-11, the full audit's PL-01): the reading ends,
 * and this rejects, as soon as it aborts.
 */
export async function readPage(
  src: string,
  meta: PreviewMeta,
  unit: string,
  paper: string,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<ReadPage> {
  const read = await recognizePage(src, null, {
    signal,
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
 * A report built from pages already read, with no model, as the review's
 * Build .repx builds one (2026-11-02): what the chat box does with an image
 * when there is no key. Null when nothing was read; `problems` lists what the
 * app's own checks found, and the report is built regardless, as the review's
 * "Build anyway" does.
 */
export function buildFromRead(
  pages: readonly { meta: PreviewMeta; read: ReadPage }[],
  unit: string,
  paper: string,
): { title: string; repxContent: string; layout: ReportLayout; markdown: string; flagged: number; problems: string[] } | null {
  if (!pages.length) return null;
  const layout = detectLayout(pages.map(({ read }) => ({ ocr: read.ocr, page: pageForImage(read.ocr, unit, paper) })), { unit });
  const file = pages[0].meta.file;
  const title = file.replace(/\.[^.]+$/, '') || 'Report read from the page';
  const repxContent = layoutToRepx(layout, { name: reportNameFor(file) });
  return {
    title,
    repxContent,
    layout: layoutToReport(layout, { title }),
    markdown: ocrSummary(layout, { title }),
    flagged: layout.flagged,
    problems: validateOcrRepx(repxContent).problems,
  };
}

/**
 * OCR's own layout of the pages read (2026-11-05): a picture of the source,
 * every table with every row it read, made by no model. The audit checks the
 * AI's REPX against it, so a grid the source has and the REPX lacks is still
 * a finding now that the Mockup is read off the REPX itself. Null when
 * nothing was read.
 */
export function sourceLayoutOf(pages: readonly { meta: PreviewMeta; read: ReadPage }[], unit: string, paper: string): ReportLayout | null {
  if (!pages.length) return null;
  const layout = detectLayout(pages.map(({ read }) => ({ ocr: read.ocr, page: pageForImage(read.ocr, unit, paper) })), { unit });
  return layout.total ? layoutToReport(layout) : null;
}

/** A report Forma's box reader built, with the skeleton it read and how many titles and captions took OCR's words. */
export interface ReaderBuiltReport {
  title: string;
  repxContent: string;
  layout: ReportLayout;
  markdown: string;
  skeleton: ReportSkeleton;
  read: number;
  placeholders: number;
  /** The first page's texts as read, and the words and fields the build used: what a draft for the AI is written from (2026-11-05). */
  texts: PageText[];
  used: DraftGiven;
  /**
   * The first page's resolution, in pixels per inch of the page it is a
   * picture of (2026-11-11, the wave 6b follow-up to CC-07): the texts above
   * are in hundredths of an inch, so the fit to the page's positions
   * (lib/sourceAgreement.ts) cannot tell a 300 dpi scan from a 96 dpi
   * screenshot without it, and held both to 3 px at 150 dpi.
   */
  dpi: number;
  /**
   * The first page as the reader read it, in numbers alone (2026-11-12, the
   * full audit's D10, lib/readerPairs.ts): kept on the device with the
   * request's learning event and labelled by the report once it is kept.
   * Null for a page with no text or too many.
   */
  pageReading?: PageReading | null;
}

/** A page's pixels per inch: a rendered PDF page's own, else the image's width over the paper it is a picture of. */
export function pictureDpi(ocr: { width: number; height: number; dpi: number | null }, paper: string): number {
  if (ocr.dpi && ocr.dpi > 0) return ocr.dpi;
  const page = pageForImage(ocr, 'HundredthsOfAnInch', paper);
  return page.width > 0 ? (ocr.width * 100) / page.width : 0;
}

/**
 * A report built from pages already read, with each text put in its band and
 * given its role by Forma's box reader (2026-11-04, boxReader.ts): a banded
 * report whose records print from bound fields, where `buildFromRead` copies
 * the page as it printed. The first page is read, and the last when there are
 * more, for the footers and totals only it shows, as the vision model reads
 * them. Null when the first page holds no text, or when a design from its
 * reading would lose more than READER_MAX_LOST of its texts (readerCoverage):
 * a form read as records, say, where OCR's copy keeps every word.
 */
export function buildWithReader(
  pages: readonly { meta: PreviewMeta; read: ReadPage }[],
  model: BoxReaderModel,
  paper: string,
): ReaderBuiltReport | null {
  if (!pages.length) return null;
  const layoutOf = (p: { read: ReadPage }) =>
    detectLayout([{ ocr: p.read.ocr, page: pageForImage(p.read.ocr, 'HundredthsOfAnInch', paper) }], { unit: 'HundredthsOfAnInch' });
  const first = layoutOf(pages[0]);
  if (!first.pages[0] || !first.total) return null;
  const reading = readDetectedPage(model, first.pages[0]);
  // The page in numbers alone, kept with the request's learning event for the
  // reader to learn from once the report is kept (2026-11-12, lib/readerPairs.ts).
  // Never in the way of the build: a reading that cannot be made is not kept.
  let pageReading: PageReading | null = null;
  try {
    pageReading = pageReadingOf(model, first.pages[0], reading.reading);
  } catch {
    pageReading = null;
  }
  // A page a design would lose too much of is better as OCR's copy.
  if (reading.coverage.lost > READER_MAX_LOST * reading.coverage.texts) return null;
  const skeletons = [reading.skeleton];
  if (pages.length > 1) {
    const last = layoutOf(pages[pages.length - 1]).pages[0];
    if (last && last.labels.length + last.tables.length) skeletons.push(readDetectedPage(model, last).skeleton);
  }
  const skeleton = mergePageSkeletons(skeletons[0], ...skeletons.slice(1));
  const texts = pageTextsOf(first);
  // No `readBy` since 2026-11-11 (the full audit, PL-07): the Spec says what
  // the report is, not which part of Forma read the page.
  const design = skeletonToDesign(skeleton, {
    texts,
    title: pages[0].meta.file.replace(/\.[^.]+$/, '') || 'Report read from the page',
  });
  return {
    title: design.title,
    repxContent: design.repx,
    layout: design.layout,
    markdown: design.markdown,
    skeleton,
    read: design.read,
    placeholders: design.placeholders,
    texts,
    used: design.used,
    dpi: pictureDpi(pages[0].read.ocr, paper),
    pageReading,
  };
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
