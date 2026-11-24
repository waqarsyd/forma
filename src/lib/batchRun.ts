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
 * ## Made by the generation core
 *
 * Since 2026-11-24 (the MCP work's wave 6) the file is made by
 * lib/generationCore.ts `makeReport`, the one way a report is made, as a
 * Batch file (`batchFile`): the places Batch still differs from a single
 * report are listed in that module's header. What is left here is Batch's
 * own: the row's id, its reading of each page, the settings worked out from
 * the file alone, its remembered preferences, the row's counts and its
 * learning event. Forma's team, OCR's attachments, the right-to-left pass
 * and the translation moved into the core; App hands in its own parts
 * (`BatchRunDeps`): the box reader's model, the vision model's set-up, Forma's
 * own model and the learning events.
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
import { detectSettings, type DetectInput } from './autoConfig';
import type { BatchOutcome } from './batchQueue';
import type { DetectionSources, PageRead, SentPage, TeamDeps } from './generationCore';
import type { LearningRecord } from './learning';
import type { ReportConfig } from '../services/geminiService';

/** What App hands in: its own parts, and the settings each file's are worked out over. */
export interface BatchRunDeps extends TeamDeps {
  /** The stored settings, which this file's are worked out over. */
  config: ReportConfig;
  /** The detection input for this file's sources alone, never the open report. */
  detectInput: (sources: DetectionSources) => DetectInput;
  recordLearning: (record: LearningRecord) => unknown;
  aiKindOf: (by: 'gemini' | 'local' | 'openrouter') => LearningRecord['ai'];
  /** Whose remembered preferences the request carries. */
  uid: string | null;
  /** The Data tab's fields, for the audit's misspelt-field check and the fix (CP-07), as a single report has them. */
  fields?: readonly string[];
}

/** Each page's text, read for this file alone; a page that cannot be read goes without its text. */
async function readFilePages(pages: readonly SentPage[], settings: ReportConfig, signal: AbortSignal): Promise<PageRead[]> {
  const out: PageRead[] = [];
  if (!pages.length) return out;
  const { readPage } = await import('./ocr');
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
  const { fields } = deps;
  const [{ makeReport }, { browserDrawing }] = await Promise.all([import('./generationCore'), import('./browserIntake')]);
  const made = await makeReport(
    { files: [{ file, uploadId: `batch-${id}` }], words, config: deps.config, fields, signal, batchFile: true },
    {
      ...deps,
      // The file drawn on the browser's canvases, as a single report's is (lib/browserIntake.ts).
      drawing: browserDrawing,
      detect: (sources) => detectSettings(deps.detectInput(sources)),
      readPages: (pages, s, settings) => readFilePages(pages, settings, s),
      // The memory's instructions alone: no kept report as an example (the core's header).
      beforeGeneration: async () => ({
        remembered: await import('./memory').then((m) => m.instructionsOf(m.readMemory(deps.uid))).catch(() => ''),
        kept: null,
      }),
    },
  );
  if (!made) throw new Error('stopped while this file was generating');
  // A Batch file's failure is thrown by the core, never stood in for.
  if (!made.ok) throw made.error;
  const { response, repxContent } = made;
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
      images: made.pictures,
      pdfs: /\.pdf$/i.test(file.name) ? 1 : 0,
      repx: made.startedFromReport ? 1 : 0,
      words: Boolean(words.trim()),
      database: false,
    },
    request: 'batch',
    ai: deps.aiKindOf(made.by),
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
    ...(made.notices.length ? { notes: made.notices.join(' ') } : {}),
  };
}
