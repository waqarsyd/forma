/**
 * The owner's side of learning from use, the parts that can be tested
 * (2026-11-11, the full audit's batch LO: LM-04, LM-17, LM-07, LM-03, LM-10,
 * LM-21). The scripts that use it run on the owner's own PC with a
 * credential that never touches the shared server this was written on:
 * `scripts/model/pull-learning.ts` (the pull), `scripts/model/train.ts` (the
 * candidate), `scripts/model/gate.ts` (whether it may ship) and
 * `scripts/model/learn-week.ts` (the three in a row, once a week).
 *
 * What the audit found, and what each part here answers:
 * - **The pull read page after page by `offset`**, which Firestore bills as
 *   every skipped document read again, and ordered by `at` with a filter on
 *   `day`, a query no index served. `pullQuery` pages by cursor (the last
 *   event's `at` and document name) and orders by the filtered field first;
 *   `firestore.indexes.json` declares the index it needs. A weekly pull
 *   resumes from `ResumePoint`, a time it could trust, less a lookback, and
 *   never from a value the browser wrote unchecked.
 * - **One account could poison the shipped model**: a thousand copies of one
 *   skeleton, or a skeleton with a made-up font or impossible numbers, went
 *   straight into training. `soundSkeleton` rebuilds each pulled skeleton
 *   from its known keys, holds it to the skeleton's vocabulary and to the
 *   page, and keeps public fonts only; `selectTraining` drops accounts whose
 *   address is not verified or that no longer exist, mock and AI-less
 *   events, reports the checks found errors in, reports rated bad or undone,
 *   repeats of a skeleton from the same account, and anything past
 *   `perAccount` skeletons per account per pull. What it dropped is counted.
 * - **Deletion never reached the owner's copies**: a person who cleared their
 *   learning in Settings, or deleted their account, stayed in every folder
 *   the owner had pulled. `planReconcile` and `applyReconcile` remove the
 *   files and the `events.jsonl` lines of every event that is gone.
 * - **Nothing stood between a training run and the shipped model** but the
 *   leak check. `gateModels` compares a candidate with the shipped model:
 *   the leak check and public fonts, the six description-only fidelity cases
 *   (`scripts/fidelity/cases/described/`), and how near held-out pulled
 *   skeletons sit to an archetype; any drop fails it.
 *
 * Pure: no Node module is imported, so it is browser-safe as everything in
 * src/lib is, and the scripts hand it `fetch` and the file system.
 */
import { scrubSkeleton } from './learning';
import { isBandKind, isControlKind, PUBLIC_FONTS, publicFontsOnly } from './skeletonText';
import { skeletonFeatures, type ReportSkeleton, type SkeletonBand, type SkeletonCell, type SkeletonControl, type SkeletonFont, type SkeletonRole } from './reportSkeleton';
import { featureDistance, unexpectedStrings, type FormaModel } from './formaModel';
import { generateOffline } from './offlineGenerator';
import { checkFidelity, measureReport, scoreChecks, type FidelityExpectations } from './fidelity';

/* ---- Firestore's REST answers ---- */

export type FirestoreValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  referenceValue?: string;
  timestampValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

/** A Firestore REST value as plain JSON. */
function plainValue(v: FirestoreValue): unknown {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.referenceValue !== undefined) return v.referenceValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(plainValue);
  if (v.mapValue) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, plainValue(x)]));
  return null;
}

/** The part of `fetch` the pull uses, so a test can stand in for Google. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/** One learning event as the account holds it (lib/learning.ts), plus what a later version may add. */
export interface PulledEvent {
  id: string;
  userId: string;
  at: string;
  day: string;
  kind: string;
  source: string;
  request: string;
  ai: string;
  skeleton: string;
  ops: string[];
  errors: number;
  warnings: number;
  rating: string;
  full: string;
  prompt: string;
  /** A rating's event: the one it rates (event v2, not written before LRN). */
  ref?: string;
  /** Whether the person undid the edit (event v2). */
  undone?: boolean;
  /** The document's full name, for the cursor and for a delete. */
  name?: string;
}

/** Every field an event has; a pull for skeletons only asks for these less `full` and `prompt`. */
export const EVENT_FIELDS = ['id', 'userId', 'at', 'day', 'kind', 'source', 'request', 'ai', 'skeleton', 'ops', 'errors', 'warnings', 'rating', 'full', 'prompt', 'ref', 'undone'] as const;
export const SKELETON_FIELDS = EVENT_FIELDS.filter((f) => f !== 'full' && f !== 'prompt');

/** Where a pull stopped: the last event read, by the fields the query is ordered by. */
export interface PullCursor {
  /** The `--since` the cursor was made under; a cursor of another is not resumed. */
  since: string;
  day: string;
  at: string;
  name: string;
}

const PAGE_SIZE = 300;

/**
 * The collection-group query over every account's `learning`, one page.
 * With a day to start from it is filtered on `day` and ordered by `day`,
 * `at` and the document's name, which the composite index in
 * firestore.indexes.json serves; without one it is ordered by `at` and the
 * name, which the collection-group field override on `at` serves. `after` is
 * the last event of the page before: `startAt` with `before: false` begins
 * just after it, so each event is read once and nothing is skipped by
 * `offset`, which Firestore bills as read.
 */
export function pullQuery(o: { since?: string; after?: PullCursor | null; pageSize?: number; fields?: readonly string[] } = {}): Record<string, unknown> {
  const since = o.since ?? '';
  const order = (field: string) => ({ field: { fieldPath: field }, direction: 'ASCENDING' });
  const after = o.after && o.after.since === since ? o.after : null;
  return {
    ...(o.fields ? { select: { fields: o.fields.map((fieldPath) => ({ fieldPath })) } } : {}),
    from: [{ collectionId: 'learning', allDescendants: true }],
    ...(since ? { where: { fieldFilter: { field: { fieldPath: 'day' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: since } } } } : {}),
    orderBy: since ? [order('day'), order('at'), order('__name__')] : [order('at'), order('__name__')],
    ...(after
      ? {
          startAt: {
            values: [...(since ? [{ stringValue: after.day }] : []), { stringValue: after.at }, { referenceValue: after.name }],
            before: false,
          },
        }
      : {}),
    limit: o.pageSize ?? PAGE_SIZE,
  };
}

/**
 * Every event from the cursor on, a page at a time, each page with the cursor
 * after it, so the caller can keep it and a pull stopped half way resumes
 * where it stopped.
 */
export async function* pullPages(
  fetchFn: FetchLike,
  o: { url: string; headers: Record<string, string>; since?: string; after?: PullCursor | null; pageSize?: number; fields?: readonly string[] },
): AsyncGenerator<{ events: PulledEvent[]; cursor: PullCursor }> {
  const pageSize = o.pageSize ?? PAGE_SIZE;
  let after = o.after ?? null;
  for (;;) {
    const structuredQuery = pullQuery({ since: o.since, after, pageSize, fields: o.fields });
    const res = await fetchFn(o.url, { method: 'POST', headers: { ...o.headers, 'content-type': 'application/json' }, body: JSON.stringify({ structuredQuery }) });
    if (!res.ok) throw new Error(`Firestore answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const rows = (await res.json()) as { document?: { name: string; fields?: Record<string, FirestoreValue> } }[];
    const docs = rows.flatMap((r) => (r.document ? [r.document] : []));
    if (!docs.length) return;
    const events = docs.map((d) => ({ ...(plainValue({ mapValue: { fields: d.fields ?? {} } }) as PulledEvent), name: d.name }));
    const last = events[events.length - 1];
    after = { since: o.since ?? '', day: String(last.day ?? ''), at: String(last.at ?? ''), name: last.name! };
    yield { events, cursor: after };
    if (docs.length < pageSize) return;
  }
}

/* ---- Where the next pull begins ---- */

/**
 * Where a weekly pull resumes, kept as `cursor.json` in the pull folder: the
 * latest event time a pull could trust, under the `--since` it was made with.
 *
 * Not the page cursor above, and that is the point (2026-11-11, the review of
 * batch LO). `at` is written by the browser, and the rules accept any string
 * of up to 40 characters, so a cursor taken from the last event read could be
 * moved by anyone signed in: one event with an `at` of '9999-12-31' or '~'
 * sorts last, becomes the cursor, and every later pull starts after it and
 * reads nothing, for every account. And an event written with an earlier `at`
 * than the cursor (a clock running behind, a write queued offline and synced
 * after a pull) would be skipped for good by a pull that starts strictly after
 * it. So the resume point moves only over times that are ISO times no later
 * than the pull began (`trustedAt`), and the next pull starts `LOOKBACK_DAYS`
 * before it, by day; the ids already in the folder's `events.jsonl` keep what
 * it reads twice from being written twice.
 */
export interface ResumePoint {
  since: string;
  at: string;
}

/** How far before the resume point a pull starts again, for events that arrive late. */
export const LOOKBACK_DAYS = 30;

/** An ISO time as `Date.prototype.toISOString` writes it, which is what lib/learning.ts writes. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

/** Whether an event's `at` may move the resume point: an ISO time, no later than `startedAt` (ms). */
export function trustedAt(at: unknown, startedAt: number): at is string {
  if (typeof at !== 'string' || !ISO_TIME.test(at)) return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && t <= startedAt;
}

/** The resume point after a page: the latest trusted time seen, never moving back. */
export function advanceResume(prev: ResumePoint | null, events: readonly { at?: unknown }[], o: { since: string; startedAt: number }): ResumePoint | null {
  let at = prev && prev.since === o.since && trustedAt(prev.at, o.startedAt) ? prev.at : '';
  for (const e of events) if (trustedAt(e.at, o.startedAt) && (!at || Date.parse(e.at) > Date.parse(at))) at = e.at;
  return at ? { since: o.since, at } : prev;
}

/**
 * The day a pull reads from: `since` on a first pull, and on a resumed one the
 * resume point's day less `lookbackDays`, but never before `since`. A resume
 * point that is not a trusted time (an older `cursor.json`, made before this,
 * may hold the very value it guards against) is not resumed from.
 */
export function resumeSince(since: string, resume: ResumePoint | null, o: { startedAt: number; lookbackDays?: number }): string {
  if (!resume || resume.since !== since || !trustedAt(resume.at, o.startedAt)) return since;
  const day = new Date(Date.parse(resume.at) - (o.lookbackDays ?? LOOKBACK_DAYS) * 86_400_000).toISOString().slice(0, 10);
  return day > since ? day : since;
}

/* ---- What may be learned from ---- */

/** A short, stable hash (cyrb53), as 14 hex digits: for telling repeats apart, not for secrecy. */
export function shortHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * The name a skeleton file carries for its account: a hash of the uid, so
 * the training set can count accounts and `--forget` can find one, without
 * the uid itself in every file.
 */
export const accountKey = (uid: string): string => `acct-${shortHash(`forma-account:${uid}`)}`;

const PAPERS = new Set(['A4', 'Letter', 'Legal', 'A5', 'A3', 'Executive', 'Custom']);
const ROLES = new Set<string>(['title', 'caption', 'value', 'total', 'pageInfo', 'decoration']);
const ALIGNS = new Set<string>(['left', 'center', 'right']);
/** The largest page a skeleton may describe, in its unit: a metre of tenths of a millimetre. */
const MAX_PAGE = 10_000;
const MAX_BANDS = 200;
const MAX_CONTROLS = 2_000;
const MAX_ROWS = 200;
const MAX_CELLS = 100;
/** How far a control may sit outside its band before the skeleton is refused, in report units. */
const SLACK = 10;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const between = (v: unknown, lo: number, hi: number): v is number => finite(v) && v >= lo && v <= hi;
const wholeBetween = (v: unknown, lo: number, hi: number): v is number => between(v, lo, hi) && Number.isInteger(v);

class Unsound extends Error {}
const need = (ok: boolean, what: string) => {
  if (!ok) throw new Unsound(what);
};

function soundFont(v: unknown): SkeletonFont | null {
  if (v === null || v === undefined) return null;
  const f = v as Partial<SkeletonFont>;
  need(typeof f === 'object' && (f.family === undefined || typeof f.family === 'string'), 'font');
  // A name the learning scrub could not keep is dropped (LM-24), or was ''
  // before 2026-11-11: no font, rather than a font named ''.
  if (!f.family) return null;
  need(between(f.size, 1, 200) && typeof f.bold === 'boolean' && typeof f.italic === 'boolean', 'font');
  return { family: f.family!, size: f.size as number, bold: f.bold as boolean, italic: f.italic as boolean };
}

function soundCell(v: unknown): SkeletonCell {
  const c = v as Partial<SkeletonCell>;
  need(!!c && typeof c === 'object', 'cell');
  need(between(c.weight, 0, 1_000) && ROLES.has(String(c.role)) && ALIGNS.has(String(c.align)) && wholeBetween(c.chars, 0, 10_000), 'cell');
  return { weight: c.weight as number, role: c.role as SkeletonRole, align: c.align as SkeletonCell['align'], chars: c.chars as number, font: soundFont(c.font) };
}

function soundControl(v: unknown, page: { width: number; height: number }): SkeletonControl {
  const c = v as Partial<SkeletonControl>;
  need(!!c && typeof c === 'object' && isControlKind(String(c.kind)) && ROLES.has(String(c.role)) && ALIGNS.has(String(c.align)), 'control vocabulary');
  need(between(c.x, -SLACK, page.width) && between(c.y, -SLACK, page.height) && between(c.w, 0, page.width * 2) && between(c.h, 0, page.height * 2), 'control place');
  // Real reports draw past the paper (a rule in the owner's bottom margins
  // runs 998 wide on an 850 page, and DevExpress clips it), so the bound is
  // twice the page: enough for what people make, not for a made-up number.
  need((c.x as number) + (c.w as number) <= page.width * 2, 'control past the page');
  need(wholeBetween(c.borders, 0, 15) && wholeBetween(c.chars, 0, 10_000), 'control numbers');
  const out: SkeletonControl = {
    kind: c.kind as SkeletonControl['kind'],
    role: c.role as SkeletonRole,
    x: c.x as number,
    y: c.y as number,
    w: c.w as number,
    h: c.h as number,
    font: soundFont(c.font),
    align: c.align as SkeletonControl['align'],
    borders: c.borders as number,
    chars: c.chars as number,
  };
  if (c.rows !== undefined) {
    need(Array.isArray(c.rows) && c.rows.length <= MAX_ROWS, 'rows');
    out.rows = c.rows.map((row) => {
      need(Array.isArray(row) && row.length <= MAX_CELLS, 'row');
      return row.map(soundCell);
    });
  }
  return out;
}

/**
 * A pulled skeleton as it may be learned from, or null when it may not.
 * It is scrubbed again (`scrubSkeleton`, the guard the app applies before it
 * sends), then REBUILT from the keys a skeleton has, so a key someone added
 * on the way, carrying numbers the leak check would never look at, is not
 * carried into an archetype. Every word must be one of the skeleton's
 * vocabulary (a paper, a band or control kind, a role, an alignment), every
 * number finite and on the page, and every font one of `PUBLIC_FONTS`
 * (`publicFontsOnly`, which turns any other into Arial): a font name is the
 * one word a skeleton carries freely, and the shipped model must not learn
 * an account's private one.
 */
export function soundSkeleton(input: string | unknown): ReportSkeleton | null {
  try {
    const raw = scrubSkeleton(typeof input === 'string' ? (JSON.parse(input) as unknown) : input) as Partial<ReportSkeleton>;
    need(!!raw && typeof raw === 'object' && PAPERS.has(String(raw.paper)) && typeof raw.landscape === 'boolean', 'page');
    need(between(raw.width, 1, MAX_PAGE) && between(raw.height, 1, MAX_PAGE), 'page size');
    const page = { width: raw.width as number, height: raw.height as number };
    const m = raw.margins as Partial<ReportSkeleton['margins']> | undefined;
    need(!!m && between(m.top, 0, page.height) && between(m.bottom, 0, page.height) && between(m.left, 0, page.width) && between(m.right, 0, page.width), 'margins');
    need((m!.top as number) + (m!.bottom as number) < page.height && (m!.left as number) + (m!.right as number) < page.width, 'margins');
    need(Array.isArray(raw.bands) && raw.bands.length > 0 && raw.bands.length <= MAX_BANDS, 'bands');
    let controls = 0;
    const bands: SkeletonBand[] = raw.bands!.map((v) => {
      const b = v as Partial<SkeletonBand>;
      need(!!b && typeof b === 'object' && isBandKind(String(b.kind)) && between(b.height, 0, page.height) && wholeBetween(b.groupFields, 0, 20), 'band');
      need(Array.isArray(b.controls), 'band controls');
      controls += b.controls!.length;
      need(controls <= MAX_CONTROLS, 'too many controls');
      const band: SkeletonBand = { kind: b.kind as SkeletonBand['kind'], height: b.height as number, groupFields: b.groupFields as number, controls: b.controls!.map((c) => soundControl(c, page)) };
      if (b.pageTop !== undefined) {
        need(between(b.pageTop, 0, page.height), 'band place');
        band.pageTop = b.pageTop;
      }
      return band;
    });
    const skeleton: ReportSkeleton = { paper: raw.paper as string, landscape: raw.landscape as boolean, width: page.width, height: page.height, margins: { top: m!.top!, bottom: m!.bottom!, left: m!.left!, right: m!.right! }, bands };
    return publicFontsOnly(skeleton).skeleton;
  } catch {
    return null;
  }
}

/** A skeleton's identity for telling repeats apart: the hash of its JSON. */
const skeletonHash = (k: ReportSkeleton): string => shortHash(JSON.stringify(k));

/** Why a pulled event was not learned from. */
export type DropReason =
  | 'unreadable id'
  | 'unreadable time'
  | 'address not verified'
  | 'account gone'
  | 'mock or no AI'
  | 'checks found errors'
  | 'rated bad'
  | 'undone'
  | 'skeleton not sound'
  | 'same skeleton again'
  | 'over the account cap';

/** What an account check says: verified, unverified, or no such account any more. */
export type AccountState = 'verified' | 'unverified' | 'gone';

/** How many distinct skeletons one account may add to one pull, by default. */
const PER_ACCOUNT = 20;

export interface TrainingPick {
  event: PulledEvent;
  skeleton: ReportSkeleton;
  hash: string;
  account: string;
  quality: { errors: number; warnings: number; rating: '' | 'good' };
}

/**
 * Which pulled events may be learned from, and why the others may not.
 * `accounts` answers for each uid; `seen` holds `<account>|<hash>` of
 * skeletons already in the training set from earlier pulls, so a weekly pull
 * adds no repeat. Events without a skeleton are not candidates and are not
 * counted. Ratings are read first, so a report rated bad is dropped wherever
 * in the pull its rating came. With `startedAt`, an event whose time is not a
 * trusted one (`trustedAt`) is refused as unreadable: a clock a little ahead
 * is read on a later pull, inside the lookback, and a made-up time never.
 */
export function selectTraining(
  events: readonly PulledEvent[],
  o: { accounts: (uid: string) => AccountState; perAccount?: number; seen?: Iterable<string>; startedAt?: number },
): { kept: TrainingPick[]; dropped: Partial<Record<DropReason, number>> } {
  const perAccount = o.perAccount ?? PER_ACCOUNT;
  const seen = new Set(o.seen ?? []);
  const ratedBad = new Set(events.filter((e) => e.kind === 'rating' && e.rating === 'bad' && e.ref).map((e) => e.ref!));
  const ratedGood = new Set(events.filter((e) => e.kind === 'rating' && e.rating === 'good' && e.ref).map((e) => e.ref!));
  const perUid = new Map<string, number>();
  const dropped: Partial<Record<DropReason, number>> = {};
  const drop = (why: DropReason) => {
    dropped[why] = (dropped[why] ?? 0) + 1;
  };
  const kept: TrainingPick[] = [];
  for (const e of events) {
    if (!e.skeleton) continue;
    if (!e.id || !/^[a-zA-Z0-9_-]+$/.test(e.id) || !e.userId) {
      drop('unreadable id');
      continue;
    }
    if (o.startedAt !== undefined && !trustedAt(e.at, o.startedAt)) {
      drop('unreadable time');
      continue;
    }
    const state = o.accounts(e.userId);
    if (state === 'gone') {
      drop('account gone');
      continue;
    }
    if (state !== 'verified') {
      drop('address not verified');
      continue;
    }
    if (e.ai === 'mock' || e.ai === 'none') {
      drop('mock or no AI');
      continue;
    }
    if (e.errors > 0) {
      drop('checks found errors');
      continue;
    }
    if (e.rating === 'bad' || ratedBad.has(e.id)) {
      drop('rated bad');
      continue;
    }
    if (e.undone) {
      drop('undone');
      continue;
    }
    const skeleton = soundSkeleton(e.skeleton);
    if (!skeleton) {
      drop('skeleton not sound');
      continue;
    }
    const account = accountKey(e.userId);
    const hash = skeletonHash(skeleton);
    if (seen.has(`${account}|${hash}`)) {
      drop('same skeleton again');
      continue;
    }
    const n = perUid.get(e.userId) ?? 0;
    if (n >= perAccount) {
      drop('over the account cap');
      continue;
    }
    perUid.set(e.userId, n + 1);
    seen.add(`${account}|${hash}`);
    kept.push({ event: e, skeleton, hash, account, quality: { errors: e.errors, warnings: e.warnings, rating: e.rating === 'good' || ratedGood.has(e.id) ? 'good' : '' } });
  }
  return { kept, dropped };
}

/* ---- Deletion that reaches the owner's copies ---- */

/** The part of `node:fs` a reconcile uses, so this module imports none. */
export interface FsLike {
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string): void;
  unlinkSync(path: string): void;
}

/** The folders a pull writes an event's files into, each file named `<id>.<ext>`. */
const PULL_DIRS = ['skeletons', 'repx', 'prompts'] as const;
export type PullDir = (typeof PULL_DIRS)[number];

export interface ReconcilePlan {
  /** Files to remove, by folder and name. */
  remove: { dir: PullDir; name: string }[];
  /** `events.jsonl` as it stays. */
  lines: string[];
  /** The ids whose files or lines go. */
  ids: string[];
}

/**
 * What a pull folder loses so that it holds only what people still share:
 * every file and `events.jsonl` line of an event `current` no longer holds
 * (null when the current ids were not read, as for `--forget` alone), and
 * every one of an account in `forget` (by uid, or by `accountKey`, which a
 * skeleton file carries). An event's account is read from its line; a file
 * with no line is judged by its id alone.
 */
export function planReconcile(
  folder: { files: { dir: PullDir; name: string }[]; lines: string[]; accounts?: ReadonlyMap<string, string> },
  current: ReadonlySet<string> | null,
  forget: ReadonlySet<string> = new Set(),
): ReconcilePlan {
  const uidOf = new Map<string, string>();
  for (const line of folder.lines) {
    try {
      const e = JSON.parse(line) as { id?: string; userId?: string };
      if (e.id && e.userId) uidOf.set(e.id, e.userId);
    } catch {
      /* a line that is not JSON is judged as gone below */
    }
  }
  const forgotten = (id: string) => {
    const uid = uidOf.get(id);
    const account = folder.accounts?.get(id);
    return (!!uid && (forget.has(uid) || forget.has(accountKey(uid)))) || (!!account && forget.has(account));
  };
  const gone = (id: string) => (current !== null && !current.has(id)) || forgotten(id);
  const ids = new Set<string>();
  const lines = folder.lines.filter((line) => {
    let id = '';
    try {
      id = String((JSON.parse(line) as { id?: string }).id ?? '');
    } catch {
      return false;
    }
    if (id && !gone(id)) return true;
    if (id) ids.add(id);
    return false;
  });
  const remove = folder.files.filter((f) => {
    const id = f.name.replace(/\.[^.]+$/, '');
    if (!gone(id)) return false;
    ids.add(id);
    return true;
  });
  return { remove, lines, ids: [...ids] };
}

/**
 * Applies `planReconcile` to a pull folder on disk: removes the files and
 * rewrites `events.jsonl`. Returns the plan, for the counts it prints.
 */
export function applyReconcile(fs: FsLike, dir: string, current: ReadonlySet<string> | null, forget: ReadonlySet<string> = new Set()): ReconcilePlan {
  const files: { dir: PullDir; name: string }[] = [];
  const accounts = new Map<string, string>();
  for (const sub of PULL_DIRS) {
    const path = `${dir}/${sub}`;
    if (!fs.existsSync(path)) continue;
    for (const name of fs.readdirSync(path)) {
      files.push({ dir: sub, name });
      if (sub === 'skeletons' && forget.size) {
        try {
          const account = (JSON.parse(fs.readFileSync(`${path}/${name}`, 'utf8')) as { account?: string }).account;
          if (account) accounts.set(name.replace(/\.[^.]+$/, ''), account);
        } catch {
          /* unreadable: judged by its id */
        }
      }
    }
  }
  const eventsPath = `${dir}/events.jsonl`;
  const lines = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, 'utf8').split('\n').filter((l) => l.trim()) : [];
  const plan = planReconcile({ files, lines, accounts }, current, forget);
  for (const f of plan.remove) fs.unlinkSync(`${dir}/${f.dir}/${f.name}`);
  if (fs.existsSync(eventsPath) || plan.lines.length) fs.writeFileSync(eventsPath, plan.lines.join('\n') + (plan.lines.length ? '\n' : ''));
  return plan;
}

/* ---- The gate ---- */

/** A description-only fidelity case (`scripts/fidelity/cases/described/<name>/case.json`). */
export interface DescribedCase {
  name: string;
  prompt: string;
  expect: FidelityExpectations;
}

/** Each case's score with a model: Forma's own report from the words alone, checked as the benchmark checks one. */
export function scoreDescribed(model: FormaModel, cases: readonly DescribedCase[]): { name: string; passed: number; total: number; ratio: number }[] {
  return cases.map((c) => {
    const design = generateOffline(model, { description: c.prompt });
    const score = scoreChecks(checkFidelity(measureReport(design.repx, design.layout), c.expect));
    return { name: c.name, ...score };
  });
}

/**
 * How near a set of skeletons sits to a model's archetypes: the mean distance
 * from each to its nearest one, measured in `scale` so two models can be
 * compared in the same units. Null for an empty set.
 */
export function meanNearest(model: FormaModel, skeletons: readonly ReportSkeleton[], scale: { sd: number[] }): number | null {
  if (!skeletons.length || !model.archetypes.length) return null;
  let sum = 0;
  for (const k of skeletons) {
    const f = skeletonFeatures(k);
    sum += Math.min(...model.archetypes.map((a) => featureDistance(f, a.features, scale)));
  }
  return sum / skeletons.length;
}

export interface GateCheck {
  name: string;
  pass: boolean;
  detail: string;
}

/** Numbers equal to this many places count as no drop. */
const EPS = 1e-9;

/**
 * Whether a candidate may replace the shipped model (LM-21, D7, D9). No AI
 * and no quota: every part runs here.
 * (a) the leak check (`unexpectedStrings`) finds nothing, and every font the
 *     candidate names is public or already shipped;
 * (b) no description-only case scores lower with the candidate;
 * (d) held-out pulled skeletons sit no further from the candidate's
 *     archetypes than from the shipped model's, both measured in the shipped
 *     model's scale.
 * (c), the box reader on the picture cases, is not here: nothing in the
 * picture path reads this model (see scripts/model/gate.ts).
 */
export function gateModels(
  shipped: FormaModel,
  candidate: FormaModel,
  o: { cases: readonly DescribedCase[]; heldOut?: readonly ReportSkeleton[] },
): { pass: boolean; checks: GateCheck[] } {
  const checks: GateCheck[] = [];
  const strays = unexpectedStrings(candidate);
  checks.push({ name: 'leak check', pass: strays.length === 0, detail: strays.length ? `${strays.length} string(s) outside the model's vocabulary` : 'clean' });
  const allowed = new Set([...PUBLIC_FONTS, ...shipped.style.fonts.map((f) => f.family)].map((f) => f.toLowerCase()));
  const named = [...candidate.style.fonts.map((f) => f.family), ...Object.values(candidate.style.roles).map((r) => r!.family)];
  const private_ = [...new Set(named.filter((f) => !allowed.has(f.toLowerCase())))];
  checks.push({ name: 'public fonts', pass: private_.length === 0, detail: private_.length ? `${private_.length} font(s) neither public nor shipped` : `${new Set(named).size} font(s), all public or shipped` });
  const before = scoreDescribed(shipped, o.cases);
  const after = scoreDescribed(candidate, o.cases);
  for (const [i, b] of before.entries()) {
    const a = after[i];
    checks.push({ name: `case ${b.name}`, pass: a.ratio >= b.ratio - EPS, detail: `${b.passed}/${b.total} shipped, ${a.passed}/${a.total} candidate` });
  }
  const held = o.heldOut ?? [];
  if (held.length) {
    const was = meanNearest(shipped, held, shipped.scale)!;
    const now = meanNearest(candidate, held, shipped.scale)!;
    checks.push({ name: 'held-out distance', pass: now <= was + EPS, detail: `${held.length} skeleton(s): ${was.toFixed(3)} shipped, ${now.toFixed(3)} candidate` });
  }
  return { pass: checks.every((c) => c.pass), checks };
}
