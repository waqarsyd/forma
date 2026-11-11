/**
 * One Batch file, made the way a single report is (2026-11-11, the full
 * audit's PL-15, CV-10 and ARCH-B), loaded the first time a batch runs.
 *
 * It was sent to the AI with no words, no reading of its pages, no draft of
 * Forma's to correct (so never the path that costs a fifth of the tokens), no
 * remembered preferences, no right to left, in the stored unit, and what
 * reading it left out was dropped. Now: its pages are read (stopped with the
 * batch, PL-01), the settings worked out from it and from the words it was
 * sent with, Forma's team prepares, the AI corrects the draft or designs it,
 * the language the words name is carried out, the report is turned right to
 * left where it is, the reading's notices go on the row, and a learning event
 * says it was a batch file. Since the re-audit (2026-11-11, R2-05) what
 * printing it with the page's records shows is sent back once, from the
 * file's own allowance, and what is left counts on the row.
 *
 * ## Out of App, and why the parts it needs are handed in
 *
 * It lived in App.tsx and took the workspace chunk past its size budget the
 * day it was written, so it is a module of its own, loaded on the first
 * batch run. Forma's team, OCR's attachments, the right-to-left pass, the
 * translation and the learning event are App's own functions (they read the
 * bench's settings and the vision model's set-up), so App hands them in
 * (`BatchRunDeps`) each with the settings worked out for this file.
 *
 * ## Read straight through, not through the chat's cache
 *
 * The chat keeps each page's reading for the session by upload id and page,
 * so a retry reuses it. A batch file's upload id is its row's id, and those
 * start again at `0:<name>` whenever a batch is replaced, so through that
 * cache a later batch with a `scan0001.pdf` in the same place was built from
 * the earlier file's text, with no error anywhere. Each file is read here and
 * its reading dropped with it, and a page that could not be read is tried
 * again on Retry.
 *
 * Worked out per file and not kept, since up to three files run at once, and
 * from the file alone: the report open on the bench is not its source.
 */
import { applyDetected, detectSettings, type DetectInput, type SourcePage } from './autoConfig';
import { toAttachmentParts } from './attachmentParts';
import type { PreviewMeta } from './attachments';
import { loadGemini } from './geminiClient';
import type { BatchOutcome } from './batchQueue';
import type { LearningRecord } from './learning';
import type { ReadPage } from './ocrAttach';
import type { TextAttachment } from './repxIntake';
import { isReportFile } from './reportFile';
import type { DraftRequest, ReportConfig, ReportLayout } from '../services/geminiService';

type Read = { meta: PreviewMeta; read: ReadPage }[];
type Page = { src: string; meta: PreviewMeta };

/** What App hands in: its own functions, each told this file's settings. */
export interface BatchRunDeps {
  /** The stored settings, which this file's are worked out over. */
  config: ReportConfig;
  /** The detection input for this file's sources alone, never the open report. */
  detectInput: (sources: { texts: readonly { file: string; text: string }[]; metas: readonly PreviewMeta[]; pages?: readonly SourcePage[]; words: string }) => DetectInput;
  /** The first page and the same upload's last, for the vision model. */
  visionPages: (images: readonly string[], metas: readonly PreviewMeta[]) => number[];
  prepareTeam: (
    input: { read: Read; firstImage?: Page; lastImage?: Page } | undefined,
    signal: AbortSignal,
    worked: ReportConfig,
  ) => Promise<{ brief: string; evidence?: ReportLayout | null; correct?: DraftRequest | null }>;
  ocrAttachments: (read: Read, worked: ReportConfig) => Promise<TextAttachment[]>;
  asConfigured: (xml: string, asSeen: boolean, built: boolean, worked: ReportConfig) => Promise<string>;
  translateXml: (xml: string, language: string, signal: AbortSignal, worked: ReportConfig) => Promise<{ xml: string }>;
  recordLearning: (record: LearningRecord) => unknown;
  aiKindOf: (by: 'gemini' | 'local' | 'openrouter') => LearningRecord['ai'];
  /** Whose remembered preferences the request carries. */
  uid: string | null;
  /** The Data tab's fields, for the audit's misspelt-field check and the fix (CP-07), as a single report has them. */
  fields?: readonly string[];
}

/** Each page's text, read for this file alone; a page that cannot be read goes without its text. */
async function readFilePages(pages: readonly Page[], settings: ReportConfig, signal: AbortSignal): Promise<Read> {
  const out: Read = [];
  if (!pages.length) return out;
  const { readPage } = await import('./ocrAttach');
  for (const { src, meta } of pages) {
    if (signal.aborted) break;
    try {
      out.push({ meta, read: await readPage(src, meta, settings.unit, settings.pageSize, undefined, signal) });
    } catch (err) {
      if (signal.aborted) break;
      // The picture still goes with the request; only its text does not.
      console.warn(`The text of ${meta.file} could not be read:`, err);
    }
  }
  return out;
}

export async function runBatchFile(file: File, signal: AbortSignal, id: string, words: string, deps: BatchRunDeps): Promise<BatchOutcome> {
  const startedAt = Date.now();
  const stopped = () => {
    if (signal.aborted) throw new Error('stopped while this file was generating');
  };
  const { config } = deps;
  const { ingestFile, inUnit } = await import('./repxIntake');
  const uploadId = `batch-${id}`;
  const ingested = await ingestFile(file, uploadId, config.unit);
  stopped();
  // The pages whose text came with them (a PDF's text layer) are not read again.
  const withText = new Set(ingested.texts.map((t) => `${t.uploadId}#${t.page ?? 0}`));
  const pages = ingested.images.flatMap((src, i) => (withText.has(`${uploadId}#${ingested.imageMeta[i]?.page ?? 0}`) ? [] : [{ src, meta: ingested.imageMeta[i] }]));
  const sources = { texts: ingested.texts, metas: ingested.imageMeta, words };
  const read = await readFilePages(pages, applyDetected(config, detectSettings(deps.detectInput(sources))), signal);
  stopped();
  // What was read settles the paper and the direction, as for a single report.
  const fileConfig = applyDetected(
    config,
    detectSettings(
      deps.detectInput({
        ...sources,
        pages: read.map(({ meta, read: r }) => ({ width: r.ocr.width, height: r.ocr.height, pagePoints: meta.pagePoints })),
        words: [words, ...read.flatMap(({ read: r }) => r.ocr.lines.map((l) => l.text))].join('\n'),
      }),
    ),
  );
  // A PDF's strings in the unit worked out for it (2026-11-11, PL-18), and what OCR read.
  const texts = [...inUnit(ingested.texts, fileConfig.unit), ...(await deps.ocrAttachments(read, fileConfig))];
  const [firstAt, lastAt] = deps.visionPages(ingested.images, ingested.imageMeta);
  const team = await deps.prepareTeam(
    ingested.images.length
      ? {
          read,
          ...(firstAt !== undefined ? { firstImage: { src: ingested.images[firstAt], meta: ingested.imageMeta[firstAt] } } : {}),
          ...(lastAt !== undefined ? { lastImage: { src: ingested.images[lastAt], meta: ingested.imageMeta[lastAt] } } : {}),
        }
      : undefined,
    signal,
    fileConfig,
  );
  stopped();
  const parts = toAttachmentParts(ingested.images, texts);
  const remembered = await import('./memory').then((m) => m.instructionsOf(m.readMemory(deps.uid))).catch(() => '');
  const [{ analyzeReportDesign, REQUEST_BUDGET }, { askWithChain }] = await Promise.all([loadGemini(), import('./fallbackChain')]);
  const { fields } = deps;
  /*
   * One allowance a file, as one click has (PL-20): the service's own
   * retries and repeats and the fix below spend from it, so a batch never
   * asks more for a file than a single report would. A new one for each AI
   * the chain asks, as App gives it.
   */
  let budget = { left: REQUEST_BUDGET };
  // On a limit the next AI set up designs it (2026-11-10, batch AG item 23, lib/fallbackChain.ts);
  // when every one gives out, the batch pauses on that error and is kept.
  const chained = await askWithChain(
    fileConfig,
    (asked) => {
      budget = { left: REQUEST_BUDGET };
      return analyzeReportDesign(words, parts, asked, undefined, signal, undefined, { remembered, formaBrief: team.brief, evidence: team.evidence, draft: team.correct ?? null, fields, budget });
    },
    signal,
  );
  stopped();
  const fromReport = texts.some(isReportFile);
  /*
   * What printing it with the page's records showed, sent back as a single
   * report's is (2026-11-11, the re-audit's R2-05, lib/printCheck.ts): a
   * Batch report skipped it, so one that printed on two pages, or blank
   * where a field should be, came back counted as clean. With the files'
   * texts, not their pictures, so a field the data has can be found.
   */
  const textParts = toAttachmentParts([], texts.filter((t) => !isReportFile(t)));
  const fixed = await import('./printCheck').then((m) =>
    m.fixUntilPrints(chained.value, {
      described: false,
      fields,
      fromReport,
      spent: chained.value.usage ?? null,
      left: () => budget.left,
      aborted: () => signal.aborted,
      ask: (instruction, repxContent) =>
        analyzeReportDesign(instruction, textParts, chained.config, { repxContent }, signal, undefined, { evidence: team.evidence, fields, budget }),
    }),
  );
  stopped();
  // Null only when stopped, which `stopped` has just thrown on.
  let response = fixed!.answer;
  // The language the words name, as a single report carries it out (CV-14).
  const language = words ? await import('./repxTranslate').then((m) => m.languageAsked(words)).catch(() => null) : null;
  if (language && response.repxContent) {
    try {
      const done = await deps.translateXml(response.repxContent, language, signal, fileConfig);
      if (done.xml !== response.repxContent) {
        const views = await import('./repxViews');
        const title = response.layout?.title;
        response = { ...response, repxContent: done.xml, markdown: views.specFromRepx(done.xml, title), layout: views.layoutFromRepx(done.xml, title) };
      }
    } catch (translateError) {
      stopped();
      console.warn(`The batch report could not be translated into ${language}; it stays as built.`, translateError);
    }
  }
  const repxContent = await deps.asConfigured(response.repxContent, !fromReport, false, fileConfig);
  const { auditRepx } = await import('./repxAudit');
  const audit = auditRepx(repxContent, response.layout, { fields });
  // Counted on the row as the single path says them (R2-05): what the print
  // still shows wrong, and a grid the page shows drawn as loose texts.
  const found = [...(response.printFindings ?? []).filter((f) => f.severity === 'error'), ...(response.evidenceFindings ?? []).filter((f) => f.code === 'grid-not-a-table')];
  const count = (severity: string) => found.filter((f) => f.severity === severity).length;
  deps.recordLearning({
    kind: 'generation',
    // Under no project (2026-11-11): the one open on the bench is not this file's.
    projectId: null,
    sourceCounts: {
      images: ingested.images.length,
      pdfs: /\.pdf$/i.test(file.name) ? 1 : 0,
      repx: fromReport ? 1 : 0,
      words: Boolean(words.trim()),
      database: false,
    },
    request: 'batch',
    ai: deps.aiKindOf(chained.by),
    repx: repxContent,
    prompt: words,
    ms: Date.now() - startedAt,
  });
  return {
    title: response.layout?.title || '',
    repxContent: repxContent || '',
    bands: response.layout?.sections?.length ?? 0,
    errors: audit.errors + count('error'),
    warnings: audit.warnings + count('warning'),
    ...(ingested.notices.length ? { notes: ingested.notices.join(' ') } : {}),
  };
}
