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
 *   the AI is sent, counted from how a design is asked (one, and one more
 *   when the report leaves out text it should have kept).
 * Nothing is read or sent until Start, or a typed yes.
 *
 * Heavy is three files or more, or nine pages or more: one PDF is at most
 * eight (`MAX_PDF_PAGES`), so one document never asks first.
 */

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

export const PLAN_FILES = 3;
export const PLAN_PAGES = 9;

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
 */
export function modeFromWords(words: string): PlanMode {
  return /\b(each|every|separate(ly)?|per file|per page|one per|in batch|as a batch)\b/i.test(words) ? 'each' : 'one';
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

/** The plan's steps, in words, for what is ticked now; `ai` names the AI that designs. */
export function planSteps(plan: JobPlan, ai: string): string[] {
  const kept = keptFiles(plan);
  const pages = kept.reduce((n, f) => n + f.pages, 0);
  if (!kept.length) return ['Nothing is ticked, so nothing would be made.'];
  const read = pages ? `Read ${count(pages, 'page')} with OCR, in this browser; nothing leaves it for this.` : '';
  if (plan.mode === 'one' || kept.length === 1) {
    return [read, `Design one report from ${kept.length === 1 ? kept[0].file : count(kept.length, 'file')} with ${ai}: 1 request, 2 if the report leaves out text it should keep.`].filter(Boolean);
  }
  return [
    `Open Batch with the ${count(kept.length, 'file')}, each its own report.`,
    `Design them one at a time with ${ai}: ${kept.length} to ${kept.length * 2} requests. A limit pauses the batch, and it carries on from where it stopped.`,
  ];
}

/** What Forma says with the plan. */
export function planReply(plan: JobPlan): string {
  const pages = plan.files.reduce((n, f) => n + f.pages, 0);
  const what = `${count(plan.files.length, 'file')}${pages ? ` and ${count(pages, 'page')}` : ''}`;
  return plan.mode === 'each' && plan.files.length > 1
    ? `That is ${what}: I'm making a report from each, in Batch. Stop pauses it.`
    : `That is ${what}: I'm making one report from all of them. Say "one report each" if they are different reports. Stop stops it.`;
}

/** What the thread says once the plan was answered. */
export function planOutcome(plan: JobPlan, started: boolean): string {
  if (!started) return 'Not started.';
  const kept = keptFiles(plan);
  return plan.mode === 'each' && kept.length > 1 ? `Started: ${count(kept.length, 'report')} in Batch.` : `Started: one report from ${count(kept.length, 'file')}.`;
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

/** The pages and texts of the files a plan keeps, for one report from them. */
export function keptAttachments<M extends { uploadId: string }, T extends { uploadId: string }>(plan: JobPlan, job: PlannedJob<M, T>) {
  const keep = new Set(keptFiles(plan).map((f) => f.uploadId));
  const at = job.imageMeta.flatMap((m, i) => (keep.has(m.uploadId) ? [i] : []));
  return { images: at.map((i) => job.images[i]), imageMeta: at.map((i) => job.imageMeta[i]), texts: job.texts.filter((t) => keep.has(t.uploadId)) };
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
