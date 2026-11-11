/**
 * A plan before a heavy job, changed and approved in the chat (2026-11-10,
 * the owner's AI accuracy programme, batch AG, item 22).
 *
 * A message carrying many files or many pages went straight into one design
 * of all of them, which is right for one report scanned page by page and
 * wrong for three different reports dropped together, and either way spent
 * requests before anyone had said which. So a heavy message is answered
 * first with a plan, which the person changes and starts:
 * - **Which files:** each one, with its pages, ticked or left out.
 * - **What to make:** one report from all of them, as the box has always
 *   meant, or a report for each, which goes to Batch, one at a time.
 * - **What it costs:** the pages OCR reads in the browser, and the requests
 *   the AI is sent. Said until 2026-11-11, when the full audit took the
 *   counts out of the steps: what a step costs is machinery.
 * Nothing was read or sent until Start, or a typed yes; since 2026-11-10 the
 * plan starts at once.
 *
 * Heavy is three files or more, or nine pages or more: one PDF is at most
 * eight (`MAX_PDF_PAGES`), so one document never asks first.
 */

import { pagesPerFile } from './attachmentBudget';

/** One attached file, as the plan lists it. */
export interface PlanFile {
  uploadId: string;
  file: string;
  /** Pages drawn from it; 0 for a file whose text came alone, a `.repx`. */
  pages: number;
}

export type PlanMode = 'one' | 'each';

export interface JobPlan {
  files: PlanFile[];
  mode: PlanMode;
  /** The files left out, by upload id. */
  skip: string[];
}

const PLAN_FILES = 3;
const PLAN_PAGES = 9;

/** The files a message carries, in the order they were attached, from its pages' and texts' upload ids. */
export function planFiles(images: readonly { uploadId: string; file: string }[], texts: readonly { uploadId: string; file: string }[]): PlanFile[] {
  const out: PlanFile[] = [];
  for (const m of images) {
    const known = out.find((f) => f.uploadId === m.uploadId);
    if (known) known.pages++;
    else out.push({ uploadId: m.uploadId, file: m.file, pages: 1 });
  }
  for (const t of texts) if (!out.some((f) => f.uploadId === t.uploadId)) out.push({ uploadId: t.uploadId, file: t.file, pages: 0 });
  return out;
}

/**
 * What the words ask for: a report for each file ("one report each",
 * "separate reports", "a report per file", "in batch"), else one report from
 * all of them, as the box has always meant (2026-11-10, the full audit: the
 * plan starts at once, so the words decide what Start used to).
 *
 * Only words about reports or files (2026-11-11, the full audit's PL-08):
 * any "each", "every" or "per page" did it, so "Rebuild these pages as one
 * invoice, keep every line" made three reports in Batch, and so did "make
 * each customer a group" and "show the totals per page". "Separate" only of
 * reports or files ("keep the logo separate" is one report), and "one per
 * file" and a bare "per file" still send it, as they did before.
 */
const EACH_WORDS = /\b(one|a|separate)\s+reports?\s+(for\s+)?(each|every|per)\b|\breports?\s+(for\s+)?(each|every)\s+(file|page|picture|one)\b|\b(each|every)\s+(file|page|picture|one)\s+(as|into)\s+(its\s+own|a\s+separate)\b|\beach\s+(as\s+)?its\s+own\s+report\b|\bone\s+per\s+(file|picture)\b|\bper\s+file\b|\bseparate\s+(reports?|files?)\b|\bseparately\b|\bin\s+batch\b|\bas\s+a\s+batch\b/i;
export function modeFromWords(words: string): PlanMode {
  return EACH_WORDS.test(words) ? 'each' : 'one';
}

/**
 * The words a request sends to Batch with, less the words that sent it there
 * (2026-11-11, the full audit's PL-15): "one report each, in German,
 * landscape" asks each file for "in German, landscape". Batch made each
 * report from the file alone, with no words, so whatever else was asked
 * was lost.
 */
export function batchWords(words: string): string {
  const left = words
    .replace(/\b(one\s+report\s+each|each\s+(as\s+)?its\s+own\s+report|(a|one|separate)\s+reports?\s+(for\s+)?(each|every|per)(\s+(file|page|picture|one))?|separate\s+reports?(\s+(for|of)\s+(these|them|those))?|separately|(make\s+)?one\s+per\s+(file|picture)|per\s+file|in\s+batch|as\s+a\s+batch)\b/gi, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/^[\s,.;:]+|[\s,;:]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // A bare "Make" or "Please create them" left is no request of its own.
  return /^(please\s+)?(make|create|build|do|generate|design)(\s+(them|these|those|it))?(\s+please)?[.!]?$/i.test(left) ? '' : left;
}

/** The plan a message needs before it is sent, or null when it is light enough to go straight on. */
export function planFor(files: readonly PlanFile[], words = ''): JobPlan | null {
  const pages = files.reduce((n, f) => n + f.pages, 0);
  if (files.length < PLAN_FILES && pages < PLAN_PAGES) return null;
  return { files: [...files], mode: modeFromWords(words), skip: [] };
}

/** The files the plan keeps. */
export const keptFiles = (plan: JobPlan) => plan.files.filter((f) => !plan.skip.includes(f.uploadId));

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The plan's steps, in words, for the files it keeps; `ai` names the AI that
 * designs. What each step is, never what it costs or how it is done
 * (2026-11-11, the full audit, the owner's rule): the steps said "1 request,
 * 2 if the report leaves out text it should keep", "N to 2N requests" and
 * "Read N pages with OCR" until then, and "Nothing is ticked, so nothing
 * would be made." for a plan nobody ticks any more, since it starts at once.
 * The reading of the pages is no step of its own now, and a plan that keeps
 * no file has no steps.
 */
export function planSteps(plan: JobPlan, ai: string): string[] {
  const kept = keptFiles(plan);
  if (!kept.length) return [];
  if (plan.mode === 'one' || kept.length === 1) {
    return [`Design one report from ${kept.length === 1 ? kept[0].file : count(kept.length, 'file')} with ${ai}.`];
  }
  return [
    `Open Batch with the ${count(kept.length, 'file')}, each its own report.`,
    `Design them one at a time with ${ai}. A limit pauses the batch, and it carries on from where it stopped.`,
  ];
}

/** "these 3 pictures", "these 2 PDFs", "these 4 files": what the files are, in the person's words. */
function theseFiles(files: readonly PlanFile[]): string {
  const n = files.length;
  const kind = files.every((f) => /\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i.test(f.file))
    ? ['picture', 'pictures']
    : files.every((f) => /\.pdf$/i.test(f.file)) ? ['PDF', 'PDFs'] : ['file', 'files'];
  return n === 1 ? `this ${kind[0]}` : `these ${n} ${kind[1]}`;
}

/**
 * What Forma says with the plan: what it is making, from what (2026-11-11,
 * the full audit's PL-14). It counted the files and the pages and ended
 * "Stop pauses it", which is how, not what. One report from more pages than
 * one report takes (`MAX_REQUEST_PAGES`, PL-22) says which it used.
 */
export function planReply(plan: JobPlan): string {
  const files = keptFiles(plan);
  if (plan.mode === 'each' && files.length > 1) {
    return `Making a report from each of ${theseFiles(files)}, one after another, in Batch.`;
  }
  const pages = files.reduce((n, f) => n + f.pages, 0);
  const used = [...pagesPerFile(files).values()].reduce((n, k) => n + k, 0);
  const capped = used < pages ? ` I used the first ${used} pages of the ${pages}, the first pages of each file.` : '';
  const each = files.length > 1 ? ` If they're different reports, say "one report each".` : '';
  return `Making one report from ${theseFiles(files)}.${capped}${each}`;
}

/**
 * What the thread says when the reports a request sent to Batch are made
 * (2026-11-11, the full audit's PL-14): which are ready and what to do with
 * them, and what was not made. Batch said nothing to the chat, so a request
 * answered "in Batch" ended there.
 */
export function batchReadyNote(items: readonly { title: string; sourceName: string; status: string }[]): string {
  const name = (i: { title: string; sourceName: string }) => i.title || (i.sourceName.split('/').pop() ?? '').replace(/\.[^.]+$/, '') || 'report';
  const made = items.filter((i) => i.status === 'done');
  const missed = items.length - made.length;
  const names = made.length > 6 ? `${made.slice(0, 5).map(name).join(', ')} and ${made.length - 5} more` : made.map(name).join(', ');
  if (!made.length) {
    return items.length === 1 ? 'The report was not made. Retry in Batch makes it.' : `None of the ${items.length} reports was made. Retry in Batch makes them.`;
  }
  const ready = made.length === 1
    ? `1 report is ready in Batch: ${names}. Open it, or download it as a .repx.`
    : `${made.length} reports are ready in Batch: ${names}. Open one, or download them all as a .zip.`;
  const other = missed === 1 ? ' One was not made; Retry in Batch makes it.' : missed > 1 ? ` ${missed} were not made; Retry in Batch makes them.` : '';
  return `${ready}${other}`;
}

/**
 * What the thread says once the plan was answered: that it started, and no
 * more (2026-11-11, the re-audit's R1-12). It said "Started: one report from
 * 3 files." under a reply that had just said "Making one report from these 3
 * pictures.": one thing said twice. The reply above it says what.
 */
export function planOutcome(_plan: JobPlan, started: boolean): string {
  return started ? 'Started.' : 'Not started.';
}

/** The plan with one file ticked or left out. */
export function toggleFile(plan: JobPlan, uploadId: string): JobPlan {
  return { ...plan, skip: plan.skip.includes(uploadId) ? plan.skip.filter((id) => id !== uploadId) : [...plan.skip, uploadId] };
}

/** What a plan's message carried, kept until it is answered (App's `plannedJobs`). */
export interface PlannedJob<M extends { uploadId: string }, T extends { uploadId: string }> {
  images: string[];
  imageMeta: M[];
  texts: T[];
  /** The files themselves, by upload id, where the box kept them. */
  files: ReadonlyMap<string, File>;
}

/**
 * The pages and texts of the files a plan keeps, for one report from them:
 * at most `MAX_REQUEST_PAGES` pages, the first pages of each file (2026-11-11,
 * the full audit's PL-22). A page's text goes with its page; a text with no
 * page (a .repx, a document) goes with its file.
 */
export function keptAttachments<M extends { uploadId: string; page?: number }, T extends { uploadId: string; page?: number }>(plan: JobPlan, job: PlannedJob<M, T>) {
  const files = keptFiles(plan);
  const room = pagesPerFile(files);
  const seen = new Map<string, number>();
  const pageKeys = new Set<string>();
  const capped = new Set(files.filter((f) => (room.get(f.uploadId) ?? 0) < f.pages).map((f) => f.uploadId));
  const at = job.imageMeta.flatMap((m, i) => {
    if (!room.has(m.uploadId)) return [];
    const n = seen.get(m.uploadId) ?? 0;
    seen.set(m.uploadId, n + 1);
    if (n >= (room.get(m.uploadId) ?? 0) && capped.has(m.uploadId)) return [];
    pageKeys.add(`${m.uploadId}#${m.page ?? 0}`);
    return [i];
  });
  const texts = job.texts.filter((t) => room.has(t.uploadId) && (!capped.has(t.uploadId) || t.page === undefined || pageKeys.has(`${t.uploadId}#${t.page}`)));
  return { images: at.map((i) => job.images[i]), imageMeta: at.map((i) => job.imageMeta[i]), texts };
}

/**
 * The files a plan sends to Batch, a report for each: the files themselves
 * where the box kept them, and a picture rebuilt from its page where it did
 * not (a message sent from the queue keeps its pages alone).
 */
export async function filesForBatch<M extends { uploadId: string }, T extends { uploadId: string }>(plan: JobPlan, job: PlannedJob<M, T>): Promise<File[]> {
  const files: File[] = [];
  for (const f of keptFiles(plan)) {
    const original = job.files.get(f.uploadId);
    if (original) {
      files.push(original);
      continue;
    }
    const at = job.imageMeta.findIndex((m) => m.uploadId === f.uploadId);
    if (at >= 0) files.push(new File([await (await fetch(job.images[at])).blob()], `${f.file.replace(/\.[^.]+$/, '')}.png`, { type: 'image/png' }));
  }
  return files;
}
