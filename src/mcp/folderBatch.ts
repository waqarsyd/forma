/**
 * What the command line's batch makes, decided before it reads a file
 * (2026-11-24, the CLI and Forma Designer work's wave 4; findings CLI-5,
 * SEC-1, GAP1-3, GAP1-4, GAP3-3 and CLI-12 of its design audit,
 * `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`, and the owner's
 * decisions OC2 and OC5). commandLine.ts runs it; everything here is the
 * plan: the folder walked, each file's route, and every name it writes.
 *
 * ## The walk (SEC-1)
 *
 * A folder is listed level by level, with `readdir`'s own file types
 * (`withFileTypes`, which reads each entry as lstat does), never through a
 * recursive readdir or a stat, which follow a junction out of the folder
 * (the design audit measured Node's recursive readdir doing it): a link or a
 * junction (Node reports a junction as a link) is never followed, whichever
 * way it leads, and is said in the summary. On a Linux runner a checkout
 * keeps real symlinks, so a pull request could carry `x.rdl ->
 * /proc/self/environ`, whose text is the job's environment, key included,
 * as the process started; nothing here opens it. Dot-folders and dot-files
 * are left out, and `node_modules`, and the `--out` folder when it sits
 * inside the folder walked, and folders deeper than `BATCH_DEPTH`, browser
 * Batch's depth (lib/folderDrop.ts). The list is made once, before the first
 * file is read, and each file on it is judged by paths.ts again at its turn,
 * in the working-folder mode with the batch's folder as the folder it must
 * be in, so a file swapped for a link after the walk is refused then. Every
 * name the batch writes, and every `--data` file, is judged in the mode of
 * the folder the command runs in, as every other command's are, so no link
 * that folder holds is followed out of it (the wave-4 review's SEC-W4-1).
 *
 * Only report sources are taken (`kindOf`): pictures and PDFs, reports
 * (`.repx`, `.vsrepx`), SSRS and FastReport reports, and, as rows that say
 * why they are skipped, Word and Excel files (data as often as a layout, and
 * a batch reads no template: generationCore.ts's header) and Crystal
 * Reports files. A data file is never a source of its own: it reaches the
 * AI only under `--data`, as the MCP server's `data` (SEC-5). Forma's own
 * outputs are left out (`isFormaOutput`: every suffix it writes, with the
 * ` (n)` a copy beside one is given, and a write's temporary
 * `.forma-partial-*`), so a rerun never takes the last run's reports for
 * reports to start from; a person's own `Invoice (1).repx` is kept.
 *
 * ## The routes (GAP1-3, GAP1-4, GAP1-1)
 *
 * From the file's kind and what the person asked, never from its content,
 * so `--dry-run` and the AI's gate tell the truth before anything is read:
 * a picture or a PDF is generated (AI); a report with `--words` is revised
 * (AI), by control name, `--edits-only` turning a redesign into a declined
 * row; a report with no words is repaired with `--repair` and otherwise
 * skipped, and said; an SSRS or FastReport report is converted with no AI,
 * or with `--words` converted and then revised, so the AI changes the
 * converter's exact report rather than writing a new one. An SSRS file that
 * will not convert is made by the AI from its text only when words were
 * given; otherwise its row says so and names the generate command, never
 * spending quota a dry run did not show.
 *
 * ## The names (CLI-5, CLI-6)
 *
 * Every output goes under `--out`, its folder inside the batch's kept, as
 * `<name>.generated.repx`, `.revised.repx`, `.converted.repx` or
 * `.repaired.repx`, and Forma's draft, where it may stand in, as
 * `<name>.draft.repx`. All are decided here, before the run: two inputs that
 * would claim one name (`invoice.png` and `invoice.pdf`) both keep their
 * extension (`invoice.png.generated.repx`, `invoice.pdf.generated.repx`),
 * whatever order they are made in, never a numbering by the write. A name
 * still claimed twice (two spellings one disk takes for one) is a row that
 * says so.
 *
 * ## Limits (OC5, GAP3-2, GAP3-3)
 *
 * `afterLimit` is what the batch does when the AI met a limit: the day's, or
 * one that lifts later than ten minutes from now (lib/aiLimit.ts
 * `DAILY_RESET_MS`), stops the batch asking the AI: the files after it that
 * ask the AI are listed as not started, so a rerun with `--skip-existing`
 * carries on, while those that need no AI (a conversion, a repair) are still
 * made; a minute's, or one that said neither, is waited out (its wait, else
 * `LIMIT_WAIT_MS`) and the file made once more, and a second limit on it
 * stops the batch asking the AI. A report made though a limit kept a later
 * step from being asked is written, and the batch waits before its next file
 * that asks the AI. `KEY_REFUSED` is the other failure every file after that
 * asks the AI would meet, read in the words of the AI's own failure alone
 * (caller.ts `AiFailure`), never in a row's message, which names the file
 * (the wave-4 review's SEC-W4-3: a file named `permission.frx` that would
 * not convert stopped the batch), and never for Local AI, which has no key.
 *
 * Pure ASCII.
 */
import { readdirSync } from 'node:fs';
import type { PlatformPath } from 'node:path';
import { DAILY_RESET_MS, type AiLimit } from '../lib/aiLimit';
import { PICTURE_EXTENSIONS } from './reportCalls';
import { FOREIGN_EXTENSIONS, LAYOUT_EXTENSIONS } from './reportFile';

/** Folders deeper than this below the batch's folder are not opened: browser Batch's depth (lib/folderDrop.ts, `MAX_DEPTH`). */
export const BATCH_DEPTH = 8;

/** One entry of a folder as `readdir` reads it with its file types: lstat's view, so a link is a link whatever it leads to. */
export interface ListedEntry {
  name: string;
  file: boolean;
  folder: boolean;
  link: boolean;
}

/** Lists one folder, its entries as they are, never following one. */
export type ListFolder = (dir: string) => ListedEntry[];

/** Node's: `readdir` with `withFileTypes`, which reads a junction on Windows as a link (SEC-1, measured). */
export const nodeList: ListFolder = (dir) => readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, file: d.isFile(), folder: d.isDirectory(), link: d.isSymbolicLink() }));

/** What a file is to a batch, by its name. */
export type SourceKind = 'picture' | 'pdf' | 'report' | 'foreign' | 'template' | 'crystal';

const ext = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

/** A file's kind as a source, or null when a batch takes nothing from it (a data file, a document, anything else). */
export function kindOf(name: string): SourceKind | null {
  const e = ext(name);
  if ((PICTURE_EXTENSIONS as readonly string[]).includes(e)) return 'picture';
  if (e === '.pdf') return 'pdf';
  if ((LAYOUT_EXTENSIONS as readonly string[]).includes(e)) return 'report';
  if ((FOREIGN_EXTENSIONS as readonly string[]).includes(e)) return 'foreign';
  if (e === '.docx' || e === '.xlsx') return 'template';
  if (e === '.rpt') return 'crystal';
  return null;
}

/** Every suffix Forma writes a report under, its draft's included, and bind's since the CLI work's wave 5 (the header's *The names*). */
export const OUTPUT_SUFFIXES = ['generated', 'revised', 'converted', 'repaired', 'edited', 'bound', 'draft'] as const;

const FORMA_OUTPUT = new RegExp(String.raw`\.(?:${OUTPUT_SUFFIXES.join('|')})(?: \(\d+\))?\.(?:repx|vsrepx)$`, 'i');
const PARTIAL = /\.forma-partial-[A-Za-z0-9]+$/;

/** Whether a name is one Forma writes (`x.generated.repx`, `x.edited (2).vsrepx`, a write's temporary file): never a batch's input. */
export const isFormaOutput = (name: string): boolean => FORMA_OUTPUT.test(name) || PARTIAL.test(name);

/** What a walk found, and what it left out. */
export interface Walked {
  /** Every report source, a full path, in the order the batch makes them: by its path inside the folder. */
  files: string[];
  /** Links and junctions met, never followed. */
  links: string[];
  /** Files named as Forma's own outputs, left out. */
  outputs: number;
  /** Other files left out: dot-files, data files, documents, anything that is not a report source. */
  other: number;
  /** Folders deeper than `BATCH_DEPTH`, not opened. */
  deep: string[];
  /** Folders that could not be listed. */
  unreadable: string[];
}

/** Paths in a stable order on every system: by their names inside the folder, case aside first. */
function byPath(path: PlatformPath, root: string) {
  const key = (p: string) => path.relative(root, p).split(path.sep).join('/');
  return (a: string, b: string) => {
    const [x, y] = [key(a), key(b)];
    const [lx, ly] = [x.toLowerCase(), y.toLowerCase()];
    return lx < ly ? -1 : lx > ly ? 1 : x < y ? -1 : x > y ? 1 : 0;
  };
}

/**
 * Walks `root` (a folder paths.ts admitted, its real path) level by level
 * for report sources (the header's *The walk*): no link followed, no
 * dot-folder, `node_modules` or folder in `skip` opened, nothing deeper than
 * `depth`. Lists only; no file is read.
 */
export function walkBatch(root: string, options: { path: PlatformPath; list?: ListFolder; skip?: readonly string[]; depth?: number }): Walked {
  const { path } = options;
  const list = options.list ?? nodeList;
  const skip = options.skip ?? [];
  const maxDepth = options.depth ?? BATCH_DEPTH;
  const walked: Walked = { files: [], links: [], outputs: 0, other: 0, deep: [], unreadable: [] };
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift() as { dir: string; depth: number };
    let entries: ListedEntry[];
    try {
      entries = list(dir);
    } catch {
      walked.unreadable.push(dir);
      continue;
    }
    for (const entry of entries) {
      const at = path.join(dir, entry.name);
      if (entry.name.startsWith('.')) {
        if (!entry.folder) walked.other += 1;
        continue;
      }
      if (entry.link) {
        walked.links.push(at);
        continue;
      }
      if (entry.folder) {
        if (entry.name.toLowerCase() === 'node_modules' || skip.some((s) => path.relative(at, s) === '')) continue;
        if (depth + 1 > maxDepth) walked.deep.push(at);
        else queue.push({ dir: at, depth: depth + 1 });
        continue;
      }
      if (!entry.file) walked.other += 1;
      else if (isFormaOutput(entry.name)) walked.outputs += 1;
      else if (kindOf(entry.name) === null) walked.other += 1;
      else walked.files.push(at);
    }
  }
  walked.files.sort(byPath(path, root));
  walked.links.sort(byPath(path, root));
  return walked;
}

/** What a batch does with a file. */
export type Route = 'generate' | 'revise' | 'convert' | 'convert-revise' | 'repair' | 'skip';

/** Whether a route asks the AI (and so spends the person's quota): the gate is asked only when one does. */
export const ROUTE_NEEDS_AI: Readonly<Record<Route, boolean>> = { generate: true, revise: true, convert: false, 'convert-revise': true, repair: false, skip: false };

/** The suffix each route writes its report under. */
export const ROUTE_SUFFIX: Readonly<Record<Exclude<Route, 'skip'>, string>> = {
  generate: '.generated.repx',
  revise: '.revised.repx',
  convert: '.converted.repx',
  'convert-revise': '.revised.repx',
  repair: '.repaired.repx',
};

/** A route in a person's words, for the plan and the lines. */
export const ROUTE_WORDS: Readonly<Record<Route, string>> = {
  generate: 'generate',
  revise: 'revise',
  convert: 'convert',
  'convert-revise': 'convert, then revise',
  repair: 'repair',
  skip: 'skip',
};

/** Why a file is skipped. */
export type SkipReason = 'nothing asked' | 'template' | 'crystal' | 'same name';

/** What the person asked of the batch, as the routes read it. */
export interface RouteAsked {
  /** `--words` was given: reports are revised, SSRS and FastReport reports converted and then revised. */
  words: boolean;
  /** `--repair`: a report with no words is repaired, rather than skipped. */
  repair: boolean;
}

/** A file's route, from its kind and what was asked (the header's *The routes*). */
export function routeOf(kind: SourceKind, asked: RouteAsked): { route: Route; skip?: SkipReason } {
  switch (kind) {
    case 'picture':
    case 'pdf':
      return { route: 'generate' };
    case 'report':
      return asked.words ? { route: 'revise' } : asked.repair ? { route: 'repair' } : { route: 'skip', skip: 'nothing asked' };
    case 'foreign':
      return { route: asked.words ? 'convert-revise' : 'convert' };
    case 'template':
      return { route: 'skip', skip: 'template' };
    case 'crystal':
      return { route: 'skip', skip: 'crystal' };
  }
}

/** Why a file is skipped, in a person's words, its path in quotes. */
export function skipWords(reason: SkipReason, shown: string): string {
  switch (reason) {
    case 'nothing asked':
      return `"${shown}" is a report, and nothing was asked of it: give --words to change it, or --repair to repair it (audit checks a folder of reports).`;
    case 'template':
      return `"${shown}" is a Word or Excel file, which is data as often as a layout, so a batch makes no report from it; give it to generate with a description that makes it the layout.`;
    case 'crystal':
      return `"${shown}" is a Crystal Reports file, which only Crystal Reports reads: export it as a PDF (File > Export) and give the PDF.`;
    case 'same name':
      return `"${shown}" would be written under the same name as another file of the batch, so it was not made; rename one of them.`;
  }
}

/** One file of a batch, its route and every name it writes, decided before the run. */
export interface BatchItem {
  /** The file, a full path. */
  path: string;
  /** Its path inside the batch's folder, with the platform's separators. */
  rel: string;
  kind: SourceKind;
  route: Route;
  needsAi: boolean;
  /** Where its report goes, a full path under the out folder; null for a file skipped. */
  target: string | null;
  /** Where Forma's draft goes if it stands in (`allowStandIn`, the routes that generate); null otherwise. */
  draft: string | null;
  /** Why it is skipped. */
  skip?: SkipReason;
}

/**
 * The batch's plan (the header's *The routes* and *The names*): each file
 * walked under `root`, its route, and its report's name under `out`, the
 * folder inside `root` kept; two that would claim one name keep their
 * extensions. Reads nothing.
 */
export function planBatch(files: readonly string[], root: string, out: string, path: PlatformPath, asked: RouteAsked & { allowStandIn: boolean }): BatchItem[] {
  const items = files.map((file): BatchItem & { stem: string; ext: string; dir: string } => {
    const rel = path.relative(root, file);
    const name = path.basename(rel);
    const kind = kindOf(name) as SourceKind;
    const { route, skip } = routeOf(kind, asked);
    const e = path.extname(name);
    return { path: file, rel, kind, route, needsAi: ROUTE_NEEDS_AI[route], target: null, draft: null, ...(skip ? { skip } : {}), stem: name.slice(0, name.length - e.length), ext: e, dir: path.dirname(rel) };
  });
  const making = items.filter((i) => i.route !== 'skip');
  /** The names an item writes with `base` before its suffix: its report's, and its draft's where one may stand in. */
  const namesOf = (i: (typeof items)[number], base: string) => {
    const route = i.route as Exclude<Route, 'skip'>;
    const drafts = asked.allowStandIn && (route === 'generate' || route === 'convert-revise');
    return [`${base}${ROUTE_SUFFIX[route]}`, ...(drafts ? [`${base}.draft.repx`] : [])].map((n) => path.join(i.dir, n));
  };
  const claimed = (bases: Map<(typeof items)[number], string>) => {
    const count = new Map<string, number>();
    for (const [i, base] of bases) for (const n of namesOf(i, base)) count.set(n.toLowerCase(), (count.get(n.toLowerCase()) ?? 0) + 1);
    return (i: (typeof items)[number]) => namesOf(i, bases.get(i) as string).some((n) => (count.get(n.toLowerCase()) ?? 0) > 1);
  };
  const bases = new Map(making.map((i) => [i, i.stem] as const));
  const twice = claimed(bases);
  for (const i of making) if (twice(i)) bases.set(i, `${i.stem}${i.ext}`);
  const still = claimed(bases);
  for (const i of making) {
    if (still(i)) {
      i.route = 'skip';
      i.needsAi = false;
      i.skip = 'same name';
      continue;
    }
    const [report, draft] = namesOf(i, bases.get(i) as string);
    i.target = path.join(out, report);
    i.draft = draft === undefined ? null : path.join(out, draft);
  }
  return items.map((i) => ({ path: i.path, rel: i.rel, kind: i.kind, route: i.route, needsAi: i.needsAi, target: i.target, draft: i.draft, ...(i.skip ? { skip: i.skip } : {}) }));
}

/** How long a limit that said no wait is waited out, before the file is made once more. */
export const LIMIT_WAIT_MS = 60_000;

/** A margin on a stated wait, so the file is asked again just after the limit lifts, never just before. */
const WAIT_MARGIN_MS = 1000;

/** Whether a limit is one the batch stops at rather than waits out: the day's, or one that lifts later than ten minutes from now. */
export const endsTheBatch = (limit: AiLimit): boolean => limit.kind === 'daily' || (limit.waitMs !== null && limit.waitMs > DAILY_RESET_MS);

/**
 * What the batch does after a file's AI met `limit` (the header's
 * *Limits*): `made` when its report was written all the same (a later step
 * not asked), `retried` when this was the file's second try. Stop; or wait,
 * and then make the same file again (`retry`) or go on to the next.
 */
export function afterLimit(limit: AiLimit, made: boolean, retried: boolean): { stop: true } | { stop: false; waitMs: number; retry: boolean } {
  if (endsTheBatch(limit) || (!made && retried)) return { stop: true };
  return { stop: false, waitMs: (limit.waitMs ?? LIMIT_WAIT_MS) + WAIT_MARGIN_MS, retry: !made };
}

/**
 * A failure every file after it would meet: the AI refused the key. Browser
 * Batch's rule (lib/batchCheckpoint.ts `stopsTheBatch`, which loads the
 * browser's own storage and views, so it is not imported here; a test holds
 * the two to one answer).
 */
export const KEY_REFUSED = /api key|permission|denied|not valid|rejected the key/i;
