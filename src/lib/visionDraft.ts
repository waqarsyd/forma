/**
 * Forma's vision model's draft of a picture (2026-11-03, lib/formaTeam.ts):
 * it reads the first page, and the same upload's last when it has more
 * (2026-11-04), whose footers and totals the first does not show; OCR's words
 * go into its boxes. That draft is the brief the AI is told, the text it
 * corrects (lib/draftText.ts), and the stand-in when the AI fails.
 *
 * Out of App.tsx since 2026-11-11 (the full audit's BW), loaded only when a
 * vision model is set up: the workspace chunk was over its size budget, and
 * nothing here reads App's state. It throws when the model's answer has no
 * page line; App leaves the draft out and says so in the console.
 */
import type { PreviewMeta } from './attachments';
import type { ReadPage } from './ocrAttach';
import type { DraftRequest, ReportConfig, ReportLayout } from '../services/geminiService';
import type { readSkeleton } from '../services/formaVision';
import type { mergePageSkeletons, skeletonToDesign } from './skeletonRepx';

type Reading = Awaited<ReturnType<typeof readSkeleton>>;

/**
 * The report built from the vision model's readings of a picture sent on its
 * own (App's designFromVision, 2026-11-03), with the reply that says it.
 * `readings` are the first page's and, when the upload has more, the last's;
 * `read` is what OCR read of the pages, whose words go into the boxes.
 * Throws when the first reading has no page line, as visionDraft does.
 *
 * Out of App.tsx on 2026-11-11 (the full audit, after batch BW2 left the App
 * chunk 608 B over its budget): nothing here reads App's state.
 */
export async function designFromReadings(
  readings: readonly Reading[],
  read: readonly { meta: PreviewMeta; read: ReadPage }[],
  first: PreviewMeta | undefined,
  pageSize: ReportConfig['pageSize'],
): Promise<{ design: ReturnType<typeof skeletonToDesign>; problems: string[]; reply: string }> {
  const [{ skeletonToDesign: toDesign, pageTextsOf, mergePageSkeletons }, { detectLayout }, { pageForImage }] = await Promise.all([
    import('./skeletonRepx'),
    import('./ocrLayout'),
    import('./reportGeometry'),
  ]);
  const [firstReading, ...laterReadings] = readings;
  if (!firstReading?.skeleton) throw new Error('its answer had no page line');
  const skeleton = mergePageSkeletons(firstReading.skeleton, ...laterReadings.flatMap((r) => (r.skeleton ? [r.skeleton] : [])));
  // The words OCR read on the same page, in the skeleton's unit and on its paper.
  const page = read.find(({ meta }) => meta.uploadId === first?.uploadId && (meta.page ?? 0) === (first?.page ?? 0));
  const paper = skeleton.paper === 'Custom' ? pageSize : skeleton.paper;
  const texts = page
    ? pageTextsOf(detectLayout([{ ocr: page.read.ocr, page: pageForImage(page.read.ocr, 'HundredthsOfAnInch', paper) }], { unit: 'HundredthsOfAnInch' }))
    : [];
  const design = toDesign(skeleton, { texts, title: first?.file.replace(/\.[^.]+$/, '') });
  // Said by result (2026-11-11, the full audit's WS-08): the reply counted the
  // captions read and the pages looked at until then. With no text read at all
  // every caption is a placeholder, and "a few" would understate it, so that
  // case says what handleReaderBuild says.
  const reply = !design.placeholders
    ? `Here is "${design.title}", built from your page.`
    : design.read
      ? `Here is "${design.title}". A few words were hard to make out; they are marked in the report, so check them against your page.`
      : `Here is "${design.title}", built from your page. Its captions still need their words; they are marked in the report.`;
  return { design, problems: readings.flatMap((r) => r.problems), reply };
}

type Page = { src: string; meta: PreviewMeta };

export interface VisionDraft {
  brief: string;
  correct: DraftRequest;
  /** The design as a result the bench can show, for the stand-in. */
  result: { content: string; timestamp: Date; title: string; layout: ReportLayout; repxContent: string; usage: null };
  /** The page's shape, which the person's kept reports are matched against (LRN2's D3). */
  skeleton: ReturnType<typeof mergePageSkeletons>;
}

export async function visionDraft(
  vision: { baseUrl: string; model: string },
  firstImage: Page,
  lastImage: Page | undefined,
  read: readonly { meta: PreviewMeta; read: ReadPage }[],
  config: Pick<ReportConfig, 'unit' | 'pageSize'>,
  signal: AbortSignal,
): Promise<VisionDraft> {
  const [{ readSkeleton }, { skeletonToDesign, pageTextsOf, mergePageSkeletons }, { detectLayout }, { pageForImage }, { draftBrief }, { draftToText }] = await Promise.all([
    import('../services/formaVision'),
    import('./skeletonRepx'),
    import('./ocrLayout'),
    import('./reportGeometry'),
    import('./formaTeam'),
    import('./draftText'),
  ]);
  const first = firstImage.meta;
  const firstReading = await readSkeleton(vision, firstImage.src, signal);
  const lastReading = lastImage ? await readSkeleton(vision, lastImage.src, signal).catch(() => null) : null;
  if (!firstReading.skeleton) throw new Error('its answer had no page line');
  const skeleton = mergePageSkeletons(firstReading.skeleton, ...(lastReading?.skeleton ? [lastReading.skeleton] : []));
  const paper = skeleton.paper === 'Custom' ? config.pageSize : skeleton.paper;
  const page = read.find(({ meta }) => meta.uploadId === first.uploadId && (meta.page ?? 0) === (first.page ?? 0));
  const texts = page
    ? pageTextsOf(detectLayout([{ ocr: page.read.ocr, page: pageForImage(page.read.ocr, 'HundredthsOfAnInch', paper) }], { unit: 'HundredthsOfAnInch' }))
    : [];
  const design = skeletonToDesign(skeleton, { texts, title: first.file.replace(/\.[^.]+$/, '') });
  return {
    brief: draftBrief(skeleton, design.layout, config.unit),
    correct: { text: draftToText(skeleton, design.used), texts, title: design.title },
    result: { content: design.markdown, timestamp: new Date(), title: design.title, layout: design.layout, repxContent: design.repx, usage: null },
    skeleton,
  };
}
