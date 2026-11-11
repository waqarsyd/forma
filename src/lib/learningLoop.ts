/**
 * The per-person learning loop (2026-11-11, the full audit's batch LRN2: D1
 * to D4): what the reports a person keeps teach their next one, on this
 * device, with nothing sent anywhere for it.
 *
 * App loads this module only when it needs it, so none of it is in the
 * workspace's own chunk (the App chunk had no room left: it was at 99.7% of
 * its budget, and what moved here from App.tsx paid for what the loop added):
 *
 * - **A report is kept** (`onKept`: exported in any format, saved, opened in
 *   the designer). Its style goes to the memory (`rememberKept`, D1), what
 *   the person changed from the report Forma made goes to the corrections
 *   ledger (D4, lib/corrections.ts), and the report itself joins their
 *   library, stripped (D2, services/library.ts `keepReport`).
 * - **What Forma did is undone** (`onUndone`): the ledger counts against it,
 *   until a Redo makes it again (`onRedone`).
 * - **A first report is asked for** (`beforeGeneration`): the memories the
 *   AI is told, and, once a report is kept, the kept one nearest the draft
 *   Forma makes first, as a formatting example (D3). Its name stays here, for
 *   the reply (`laidOutLike`), which says so only when the report came out
 *   looking like it.
 * - **A report is described in words** (`houseBrief`): the person's own
 *   house style once two kept reports show one, else Forma's, with what
 *   their changes taught written into it.
 *
 * Everything here is gated by Settings > Memory's "Learn the style of reports
 * I keep" (`learnFromKept`), and by the box's house style switch where App
 * passes it. A kept report belongs to whoever kept it (`owner`), as the memory
 * does, and Settings' two Forget buttons take it out of the library too
 * (services/library.ts `forgetKept`; both from the LRN2 review, 2026-11-11). None of it can fail the turn that called it: App catches each
 * call, and a library that cannot be read is an empty one.
 */
import * as memory from './memory';
import { keptCorrections, learnedMemories, learnedPreferences, recordCorrections, undoneCorrections, withLearned } from './corrections';
import { defaultDeps, keepReport, nearestKept, type LibraryDeps } from '../services/library';
import type { KeptRecord } from './libraryDb';
import { skeletonFeatures, type ReportSkeleton } from './reportSkeleton';
import { categoryOf, learnStyle, loadFormaModel, type FormaModel } from './formaModel';
import { keptExampleBlock } from './houseStyle';
import { houseStyleBrief } from './formaTeam';
import { designedReply, generateOffline, type OfflineDesign } from './offlineGenerator';

let deps: LibraryDeps | null = null;
/** The library, opened once per session; a test passes its own. */
const libraryDeps = (): LibraryDeps => (deps ??= defaultDeps());

/**
 * A report's skeleton in hundredths of an inch, or null when it cannot be
 * read. In hundredths whatever its unit (the LRN2 review, 2026-11-11), so a
 * millimetre report's features sit in the space the shipped model's scale
 * and the query's do, and `nearestKept` compares like with like.
 */
function skeletonOfRepx(repx: string): ReportSkeleton | null {
  try {
    const k = memory.skeletonInHundredths(repx);
    return k.bands.length ? k : null;
  } catch {
    return null;
  }
}

/** The face most of a report's text is in, and its title's size. */
function looksOf(k: ReportSkeleton): { face: string; titleSize: number | null } {
  const style = learnStyle([k]);
  return { face: style.fonts[0]?.family ?? 'Arial', titleSize: style.roles.title?.size ?? null };
}

export interface KeptInput {
  repx: string;
  /** The project it is saved as, which a report kept again is known by. */
  projectId?: string | null;
  /** Who is signed in, whose memory it is; null signed out. */
  owner: string | null;
  /** The report's title, shown in the Library panel and the reply. */
  name?: string;
  /** The report Forma made in this conversation, and that reply's id: what the person changed is measured from it. */
  madeRepx?: string;
  madeRef?: string;
  now?: Date;
}

/**
 * A report kept: its style remembered, the person's changes to what Forma
 * made counted, and the report put in their library. True when the library
 * took it. Nothing at all when the person switched the learning off.
 */
export async function onKept(input: KeptInput, d: LibraryDeps = libraryDeps()): Promise<boolean> {
  const state = memory.readMemory(input.owner);
  if (!state.learnFromKept) return false;
  const now = input.now ?? new Date();
  const style = memory.keptStyleOf(input.repx, now, input.projectId ?? undefined);
  let next = style ? memory.rememberKept(state, style) : state;
  if (input.madeRepx && input.madeRef && input.madeRepx !== input.repx) {
    const ledger = recordCorrections(next.ledger ?? [], keptCorrections(input.madeRepx, input.repx, input.madeRef, now));
    next = { ...next, ledger, memories: learnedMemories(next.memories, learnedPreferences(ledger), now) };
  }
  memory.writeMemory(next, input.owner);

  const k = skeletonOfRepx(input.repx);
  if (!k || !style) return false;
  const name = input.name?.trim() || 'Untitled report';
  return keepReport(
    { id: style.key ?? style.shape ?? name, owner: input.owner, name, features: skeletonFeatures(k), category: categoryOf(name), ...looksOf(k), repx: input.repx },
    d,
    { now: now.getTime(), replaces: style.shape },
  ).catch(() => false);
}

/** What Forma did, undone: each part it changed counts against the value it changed it to (D4). */
export function onUndone(input: { before?: string; after?: string; ref: string; owner: string | null; now?: Date }): void {
  const state = memory.readMemory(input.owner);
  if (!state.learnFromKept || !input.before || !input.after) return;
  const now = input.now ?? new Date();
  const ledger = recordCorrections(state.ledger ?? [], undoneCorrections(input.before, input.after, input.ref, now));
  memory.writeMemory({ ...state, ledger, memories: learnedMemories(state.memories, learnedPreferences(ledger), now) }, input.owner);
}

/** What was undone, made again with Redo: the undo no longer counts against it. */
export function onRedone(input: { ref: string; owner: string | null; now?: Date }): void {
  const state = memory.readMemory(input.owner);
  const ledger = (state.ledger ?? []).filter((e) => !(e.ref === input.ref && e.weight < 0));
  if (ledger.length === (state.ledger ?? []).length) return;
  memory.writeMemory({ ...state, ledger, memories: learnedMemories(state.memories, learnedPreferences(ledger), input.now ?? new Date()) }, input.owner);
}

/** The kept report a first one was laid out after: its name and looks, for the reply. */
export interface KeptChoice {
  name: string;
  face: string;
  titleSize: number | null;
  block: string;
}

/** The shipped model's spread of each feature, or none when it cannot be loaded. */
async function scaleOf(): Promise<{ sd: number[] } | null> {
  try {
    return (await loadFormaModel()).scale;
  } catch {
    return null;
  }
}

/**
 * The kept report nearest a first report, as a formatting example, or null:
 * none kept, the learning off, or nothing to compare. The draft Forma makes
 * first is what is compared (`shape`: the box reader's or the vision
 * model's reading of a picture); a description is compared by the report
 * Forma's own model would design from it. With neither, only a kept report
 * of the category the words name is taken.
 */
export async function keptExample(
  input: { shape?: ReportSkeleton | null; words?: string; description?: string; owner: string | null },
  d: LibraryDeps = libraryDeps(),
  model: () => Promise<FormaModel> = loadFormaModel,
): Promise<KeptChoice | null> {
  if (!memory.readMemory(input.owner).learnFromKept || !d.kept) return null;
  // Only what this person kept: another account's, or a signed-out visitor's, is not their style (the LRN2 review).
  const records = (await d.kept.load().catch((): KeptRecord[] => [])).filter((r) => r.owner === input.owner);
  if (!records.length) return null;
  const words = [input.words, input.description].filter(Boolean).join(' ');
  const category = categoryOf(words);
  let shape = input.shape ?? null;
  if (!shape && input.description) {
    shape = await model()
      .then((m) => skeletonOfRepx(generateOffline(m, { description: input.description! }).repx))
      .catch(() => null);
  }
  let record: KeptRecord | null = null;
  if (shape) {
    const scale = (await scaleOf()) ?? { sd: [] };
    record = nearestKept({ features: skeletonFeatures(shape), category }, records, scale)?.record ?? null;
  } else if (category) {
    record = records.filter((r) => r.category === category).sort((a, b) => b.at - a.at)[0] ?? null;
  }
  if (!record) return null;
  const block = keptExampleBlock(record.chunks);
  return block ? { name: record.name, face: record.face, titleSize: record.titleSize, block } : null;
}

/**
 * The kept report's looks in words, for a request that corrects Forma's
 * draft (2026-11-11, the re-audit's R2-02). That request answers in the
 * draft's own format, which writes a font on each line and forbids XML, so
 * the example's band XML (up to 12,000 characters) was both against its
 * rules and paid for in every such request. Its face and its title's size
 * are what the draft's lines can carry, and what `laidOutLike` looks for.
 * Not its name, which the block leaves out too: a report's name can be a
 * client's.
 */
export function keptHint(kept: Pick<KeptChoice, 'face' | 'titleSize'>): string {
  const title = kept.titleSize !== null ? `, its title at ${kept.titleSize}pt` : '';
  return `A report this person kept is set in ${kept.face}${title}. Write the draft's fonts in ${kept.face}${title ? ', and the title at that size' : ''}, unless the picture plainly shows another.`;
}

/**
 * What a generation is told besides its request: the memories (as
 * `instructionsOf`), and on a first report, with `first` set, the nearest
 * kept report after them: its block of XML for a request that designs the
 * report, its face and title size in words when `drafting` (the request
 * corrects Forma's draft, `keptHint`). `kept` is the choice, for the reply.
 */
export async function beforeGeneration(input: {
  owner: string | null;
  projectId?: string | null;
  first: boolean;
  /** The request corrects Forma's draft, whose answer is the draft's format and never XML. */
  drafting?: boolean;
  shape?: ReportSkeleton | null;
  words?: string;
  description?: string;
}, d: LibraryDeps = libraryDeps()): Promise<{ remembered: string; kept: KeptChoice | null }> {
  const remembered = memory.instructionsOf(memory.readMemory(input.owner), input.projectId);
  const kept = input.first ? await keptExample(input, d).catch(() => null) : null;
  const example = kept && (input.drafting ? keptHint(kept) : kept.block);
  return { remembered: [remembered, example].filter(Boolean).join('\n\n'), kept };
}

/**
 * One sentence for the reply when a first report came out looking like the
 * kept one it was given (D3): the same face, and a title of the same size,
 * which is what a person sees at once. '' otherwise, so nothing is claimed
 * of a report the example did not visibly shape.
 */
export function laidOutLike(repx: string, kept: Pick<KeptChoice, 'name' | 'face' | 'titleSize'> | null): string {
  if (!kept || kept.titleSize === null) return '';
  const k = skeletonOfRepx(repx);
  if (!k) return '';
  const now = looksOf(k);
  if (now.face.toLowerCase() !== kept.face.toLowerCase() || now.titleSize === null || Math.abs(now.titleSize - kept.titleSize) > 0.5) return '';
  const name = kept.name.trim();
  if (!name || /^untitled report$/i.test(name)) return 'Laid out like a report you kept.';
  return /\breport$/i.test(name) ? `Laid out like your ${name}.` : `Laid out like your ${name} report.`;
}

/**
 * Forma's own report from a description, with no AI: the stand-in when the
 * AI fails (moved here from App.tsx on 2026-11-11 with the loop, D1). The
 * person's preferences go with it, now with what their kept reports show of
 * margins, weight and a record's row (`preferencesOf`), so it looks like
 * their reports too. A pasted schema's fields win over any the words list.
 */
export async function designFromWords(
  request: { description?: string; dataSchema?: string },
  message: string,
  owner: string | null,
  projectId?: string | null,
): Promise<{ design: OfflineDesign; reply: string }> {
  const { parseDataSource } = await import('./dataSource');
  const fields = request.dataSchema
    ? parseDataSource(request.dataSchema).fields.map((f) => ({ name: f.name, type: f.type === 'string' ? ('text' as const) : f.type }))
    : undefined;
  const design = generateOffline(await loadFormaModel(), {
    description: request.description || message,
    fields,
    preferences: memory.preferencesOf(memory.readMemory(owner), projectId),
  });
  return { design, reply: designedReply(design) };
}

/**
 * The house style a described report is given (`houseStyleBrief`): the
 * person's own once two kept reports show one (D1), else Forma's, with what
 * their changes taught written into it (D4).
 */
export async function houseBrief(owner: string | null, unit: string): Promise<string> {
  const state = memory.readMemory(owner);
  const model = memory.personalStyle(state) ?? (await loadFormaModel());
  return houseStyleBrief(withLearned(model.style, state.memories), model.reports, unit);
}
