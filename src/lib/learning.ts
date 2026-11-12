/**
 * The more Forma is used, the more its own model learns (2026-11-10, the
 * full audit, the owner's ask): every report generated, every edit made in
 * the chat, every translation and every thumbs on a reply becomes a learning
 * event, kept in this browser and, with the person's leave, sent to their
 * account, from where the owner pulls the whole collection to train Forma's
 * own model (`scripts/model/pull-learning.ts` -> `scripts/model/train.ts`),
 * retrain the box reader, seed the report library with examples and widen
 * the chat judge's cases.
 *
 * Two tiers, two switches in Settings (`LearningSettings.tsx`):
 * - **Structure**, on by default and said in the privacy policy: the
 *   report's skeleton (`reportSkeleton.ts`: paper, bands, every control's
 *   kind, place, size, font, alignment, borders and the ROLE of its text,
 *   never the text), the request's kind and source, which AI answered (its
 *   kind, never a key), what the checks found as counts, the edit operations
 *   by name, and the thumbs. `scrubSkeleton` is the guard: a skeleton holds
 *   no text by construction, and this strips any string that is not one of
 *   the fixed words a skeleton may carry, so a defect upstream cannot leak a
 *   caption through it. A user's own description of a control
 *   (`AccessibleDescription`) never reaches a skeleton either. Since
 *   2026-11-12 (Owner decision 20, the full audit's D10), a report kept
 *   from a picture also carries the page pair (`boxes`, lib/readerPairs.ts):
 *   where each text on the page sat and the numbers the box reader computed
 *   of it, never a character of it, with the band and role the kept report
 *   gave it, for the box reader to learn from. The reading waits on the
 *   device with the request's event (`reading`, never sent as it is).
 * - **Full reports**, off until the person turns it on: the whole REPX and
 *   their words with it. Their captions, their field names, their data
 *   source by name. Nothing of theirs leaves without this switch.
 *
 * Where it lives: IndexedDB `forma-learning` on the device (the last
 * `MAX_LOCAL` events, so Settings can show and delete what was kept), and
 * Firestore `users/{uid}/learning/{id}` once signed in, a collection the
 * account owns (it can list and delete it, an account deletion removes it,
 * `accountData.ts`), created only in the shape `firestore.rules` pins. The
 * owner reads every account's collection with a service account, on their
 * own PC, never from a user's browser.
 *
 * Pure parts here are tested; the store is thin over IndexedDB, and tested
 * over `fake-indexeddb`. Since 2026-11-11 (the full audit) the switches follow
 * the account (see `readDeviceLearning`), the store is an outbox as well
 * (`flushLearning`), and nothing is kept with both switches off (`keepable`).
 */
import type { ReportSkeleton } from './reportSkeleton';
import type { PageReading } from './readerPairs';

export interface LearningSettings {
  /** The skeleton, the request's kind, the edits and the thumbs: on by default, said in the policy. */
  structure: boolean;
  /** The whole REPX and the person's words with it: off until they turn it on. */
  full: boolean;
}

export const DEFAULT_LEARNING_SETTINGS: LearningSettings = { structure: true, full: false };

const SETTINGS_KEY = 'forma:learning';

/*
 * The switches follow the account (2026-11-11, the full audit's LM-01 and
 * SA-13). They were this browser's alone, so the whole-report switch one
 * person turned on stayed on for the next person to sign in there, and every
 * report that person made was sent whole; and turning learning off on one
 * computer left it on at every other. Now:
 * - The account holds them, at `users/{uid}/meta/learning` (accountData.ts,
 *   pinned by firestore.rules), and Settings says they apply on every device.
 * - The copy here names whose it is. Another account's copy is not read: the
 *   defaults stand until the account's own arrives. A copy from before the
 *   change names nobody; its structure switch is kept if it was turned off,
 *   and its whole-report switch is not, since whose it was cannot be known.
 *   A copy written signed out is read the same way at sign-in, so an "off"
 *   chosen before signing in reaches an account that has no copy yet rather
 *   than being replaced by the more-sharing default.
 * - A change made here is marked `pending` until the account has it, so a
 *   change that could not reach the account is sent at the next sign-in
 *   rather than overwritten by what the account held before it.
 * - Until the account's copy has been read, nothing whole is sent
 *   (`effectiveLearningSettings`).
 */

/** The copy kept in this browser, and whether the account still lacks it. */
export interface DeviceLearningSettings {
  settings: LearningSettings;
  pending: boolean;
}

export function readDeviceLearning(uid: string | null = null, storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): DeviceLearningSettings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    const s = raw ? (JSON.parse(raw) as Partial<LearningSettings> & { uid?: string | null; pending?: boolean }) : null;
    if (!s) return { settings: { ...DEFAULT_LEARNING_SETTINGS }, pending: false };
    // From before the copy named its account: an explicit "off" is kept, an "on" for whole reports is not.
    if (!('uid' in s)) return { settings: { structure: s.structure !== false, full: false }, pending: false };
    const owner = s.uid ?? null;
    // Made signed out, read signed in: the same, since an "off" chosen before signing in must
    // not become "on" at the first sign-in by way of the defaults (the PRIV review, 2026-11-11).
    if (owner === null && uid !== null) return { settings: { structure: s.structure !== false, full: false }, pending: false };
    if (owner !== uid) return { settings: { ...DEFAULT_LEARNING_SETTINGS }, pending: false };
    return { settings: { structure: s.structure !== false, full: s.full === true }, pending: s.pending === true };
  } catch {
    return { settings: { ...DEFAULT_LEARNING_SETTINGS }, pending: false };
  }
}

/** The switches kept here for `uid` (null signed out), or the defaults when they are another account's. */
export function readLearningSettings(uid: string | null = null, storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): LearningSettings {
  return readDeviceLearning(uid, storage).settings;
}

export function writeLearningSettings(
  settings: LearningSettings,
  uid: string | null = null,
  pending = false,
  storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify({ uid, structure: settings.structure, full: settings.full, ...(pending ? { pending: true } : {}) }));
  } catch {
    /* storage refused: the defaults hold */
  }
}

/**
 * Which copy stands once the account's has been read: this browser's when it
 * holds a change the account lacks, or when the account has none yet (`push`:
 * then it is written to the account); otherwise the account's.
 */
export function settleLearningSettings(device: DeviceLearningSettings, account: LearningSettings | null): { settings: LearningSettings; push: boolean } {
  if (device.pending || !account) return { settings: { ...device.settings }, push: true };
  return { settings: { structure: account.structure, full: account.full }, push: false };
}

/**
 * The switches settled with the account once per sign-in (moved here from
 * App.tsx on 2026-11-11, batch LRN, so the work runs in this lazy module):
 * read the account's copy, write this browser's to it when it should stand,
 * and keep what was settled here. A switch changed in Settings while this ran
 * has written its own copy, and it stands: writing what was settled over it
 * would undo the change unseen. True once the account's copy is known; false,
 * with a console line, when it could not be read.
 */
export async function settleWithAccount(
  uid: string,
  read: () => Promise<LearningSettings | null>,
  write: (settings: LearningSettings) => Promise<void>,
  storage: (Pick<Storage, 'getItem'> & Pick<Storage, 'setItem'>) | null = typeof localStorage === 'undefined' ? null : localStorage,
): Promise<boolean> {
  try {
    const before = readDeviceLearning(uid, storage);
    const settled = settleLearningSettings(before, await read());
    if (settled.push) await write(settled.settings);
    const now = readDeviceLearning(uid, storage);
    const untouched = now.pending === before.pending && now.settings.structure === before.settings.structure && now.settings.full === before.settings.full;
    if (untouched) writeLearningSettings(settled.settings, uid, false, storage);
    return true;
  } catch (err) {
    console.warn('The learning switches could not be read from the account; whole reports wait until they are.', err);
    return false;
  }
}

/**
 * The switches a turn obeys. Signed in, until the account's copy has been
 * read (`accountKnown`), the whole-report switch is held off: the more
 * restrictive of this browser's copy and an account copy not yet known.
 */
export function effectiveLearningSettings(device: LearningSettings, signedIn: boolean, accountKnown: boolean): LearningSettings {
  if (!signedIn || accountKnown) return { ...device };
  return { structure: device.structure, full: false };
}

/*
 * Event v2 (2026-11-11, the full audit's LM-10a to LM-13, LM-25, LM-26 and
 * LM-12): fewer and smaller events that say more. The skeleton goes only with
 * a report made or kept, where it is what is learned from; an edit says which
 * operations were made and on what kind of part; a rating names the event it
 * rates. And the two strongest signals are collected: a report kept (exported,
 * opened in the designer or saved) and an edit undone. Every list below is the
 * one the rules take (`firestore.rules` isValidLearning), and a test holds
 * the two together.
 */
export const LEARNING_KINDS = ['generation', 'edit', 'translate', 'rating', 'kept', 'undo'] as const;
export type LearningKind = (typeof LEARNING_KINDS)[number];
/** What the request brought: the kinds the composer tells apart. */
export const LEARNING_SOURCES = ['image', 'pdf', 'repx', 'words', 'database', 'mixed', 'none'] as const;
export type LearningSource = (typeof LEARNING_SOURCES)[number];
/** What was asked: a new report, the open one redesigned, an edit in place, a batch file. */
export const LEARNING_REQUESTS = ['new', 'redesign', 'edit', 'batch', 'none'] as const;
export type LearningRequest = (typeof LEARNING_REQUESTS)[number];
/** Which AI answered, by kind only. */
export const LEARNING_AIS = ['gemini', 'local', 'openrouter', 'forma', 'mock', 'none'] as const;
export type LearningAi = (typeof LEARNING_AIS)[number];
/** How a report was kept: the export's format, the designer, or a Save. '' on every other kind. */
export const LEARNING_HOWS = ['', 'repx', 'pdf', 'xlsx', 'csv', 'docx', 'rtf', 'html', 'png', 'designer', 'save'] as const;
export type LearningHow = (typeof LEARNING_HOWS)[number];
/** What Forma made on its own when `ai` is 'forma': its reader's draft, a build from the text read, or the offline build. */
export const LEARNING_DRAFTS = ['', 'reader', 'ocr', 'offline'] as const;
export type LearningDraft = (typeof LEARNING_DRAFTS)[number];
/** What an event had to leave out to fit, said rather than dropped silently (LM-25); a page's pair since 2026-11-12 (D10). */
export const LEARNING_DROPPED = ['', 'skeleton', 'full', 'boxes'] as const;
export type LearningDropped = (typeof LEARNING_DROPPED)[number];

/** The kinds that carry the skeleton (LM-10a): what is made and what is kept, the two worth learning a layout from. */
const SKELETON_KINDS: ReadonlySet<LearningKind> = new Set(['generation', 'kept']);
/** The kinds that may carry the whole report on the opt-in tier; a rating or an undo points at the event that has it. */
const FULL_KINDS: ReadonlySet<LearningKind> = new Set(['generation', 'edit', 'translate', 'kept']);

/** One event, as the store and the account hold it. Every field present, so the rules can pin the shape. */
export interface LearningEvent {
  id: string;
  /** ISO time. The account's copy is stamped when it is sent, on the server's day (firestore.rules). */
  at: string;
  /** YYYY-MM-DD, for the owner's pull by day. */
  day: string;
  kind: LearningKind;
  source: LearningSource;
  request: LearningRequest;
  ai: LearningAi;
  /** The scrubbed skeleton as JSON, or '' when the event has none. */
  skeleton: string;
  /** Edit operations by name ('font', 'move'...), at most MAX_OPS. */
  ops: string[];
  /** The kind of part each operation was made on ('caption', 'value', 'table', 'report'...), beside `ops`. */
  roles: string[];
  errors: number;
  warnings: number;
  /** '' on every kind but a rating, and on a rating taken back. */
  rating: '' | 'good' | 'bad';
  /** The event this one rates, keeps or undoes; '' when there is none. */
  ref: string;
  how: LearningHow;
  draft: LearningDraft;
  /** Milliseconds from the message sent to the result shown; 0 when not measured. */
  ms: number;
  /** Which project, as twelve hex characters of a hash of the account and the project, never the id; '' when none. */
  project: string;
  /** How far the kept report moved from the one made, scale-free (0 is unchanged); -1 when not measured. */
  distance: number;
  dropped: LearningDropped;
  /**
   * On a kept report made from a picture (2026-11-12, the full audit's D10,
   * lib/readerPairs.ts): the page's numeric reading, where each text sat and
   * its features, never its characters, with the band and role the kept
   * report gave each, as JSON; '' on every other event. Structure, like the
   * skeleton.
   */
  boxes: string;
  /** The whole REPX, only on the full tier; '' otherwise. */
  full: string;
  /** The person's words, only on the full tier; '' otherwise. */
  prompt: string;
}

const MAX_OPS = 40;
const MAX_SKELETON_CHARS = 80_000;
/**
 * The whole report's cap, in UTF-8 bytes (LM-25): 400,000 characters of a
 * report in Arabic or Chinese is over a megabyte, more than a document holds,
 * so the write failed and the event was lost. Bytes are what the document is
 * measured in, and `firestore.rules` caps the characters at the same number.
 */
export const MAX_FULL_BYTES = 700_000;
const MAX_PROMPT_CHARS = 4_000;
export const MAX_REF_CHARS = 64;
/** Events kept on the device, newest first; older ones go. */
export const MAX_LOCAL = 500;
/**
 * The longest page pair an event carries, as lib/readerPairs.ts's
 * MAX_PAIR_CHARS and firestore.rules hold it (a test holds the three
 * together); written here so this module does not load the reader.
 */
export const MAX_BOXES_CHARS = 100_000;
/** How many requests' page readings this device keeps, waiting for their report to be kept; older ones are let go. */
export const MAX_READINGS = 20;

/** The keys whose string values a skeleton may carry, and the longest each may be. */
const WORD_KEYS: Record<string, number> = { kind: 24, role: 16, align: 8, paper: 16, family: 40 };
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9 .'-]*$/;

/**
 * A skeleton with every string that is not one of its fixed words stripped.
 * A skeleton holds no text by construction (a caption keeps its length only),
 * so this changes a sound one not at all; it is the guard against a defect
 * upstream, the same promise `unexpectedStrings` makes for the shipped model.
 *
 * A font's `family` it cannot keep is dropped rather than kept as ''
 * (2026-11-11, the full audit's LM-24): a non-Latin name, or one with an
 * underscore such as "MS Gothic_JP", became an empty family, which training
 * then counted as a font. A font with no family is a size and a weight, which
 * is all the skeleton can say of it.
 */
export function scrubSkeleton<T>(value: T, key = ''): T {
  if (Array.isArray(value)) return value.map((v) => scrubSkeleton(v, key)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const clean = scrubSkeleton(v, k);
      if (k === 'family' && clean === '') continue;
      out[k] = clean;
    }
    return out as T;
  }
  if (typeof value === 'string') {
    const max = WORD_KEYS[key];
    return (max && value.length <= max && PLAIN.test(value) ? value : '') as unknown as T;
  }
  return value;
}

/**
 * Every number to one decimal (2026-11-11, the full audit's LM-25): a place
 * read to the hundredth of a unit says nothing training can use, and the
 * digits made a large report's skeleton too long to send.
 */
export function roundSkeleton<T>(value: T): T {
  if (Array.isArray(value)) return value.map(roundSkeleton) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = roundSkeleton(v);
    return out as T;
  }
  return (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : value) as T;
}

/** The skeleton as the event carries it: scrubbed, rounded, as JSON, or '' when it would not fit. */
export function skeletonField(skeleton: ReportSkeleton | null | undefined): string {
  if (!skeleton) return '';
  const json = JSON.stringify(roundSkeleton(scrubSkeleton(skeleton)));
  return json.length <= MAX_SKELETON_CHARS ? json : '';
}

/** A string's length in UTF-8 bytes, which is what a document is measured in. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * How far one report's skeleton moved from another's, from their feature
 * vectors (`skeletonFeatures`), scale-free: each feature's change over the
 * larger of the two (or 1), the root mean square of those, to three
 * decimals. 0 is unchanged; a report rebuilt from nothing is near 1.
 */
export function featureDistance(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return -1;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = (a[i] - b[i]) / Math.max(Math.abs(a[i]), Math.abs(b[i]), 1);
    sum += d * d;
  }
  return Math.round(Math.sqrt(sum / n) * 1000) / 1000;
}

/**
 * Which project an event belongs to, without naming it (LM-12): twelve hex
 * characters of SHA-256 over the account and the project's id, so the owner
 * can tell one project's events apart and never learns its id. '' without one.
 */
export async function projectKey(uid: string | null, projectId: string | null | undefined): Promise<string> {
  if (!projectId || typeof crypto === 'undefined' || !crypto.subtle) return '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${uid ?? ''}:${projectId}`));
  return [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** What the composer's staging says the request brought. */
export function sourceOf(counts: { images: number; pdfs: number; repx: number; words: boolean; database: boolean }): LearningSource {
  const kinds = [counts.images > 0, counts.pdfs > 0, counts.repx > 0, counts.database].filter(Boolean).length;
  if (kinds > 1) return 'mixed';
  if (counts.images) return 'image';
  if (counts.pdfs) return 'pdf';
  if (counts.repx) return 'repx';
  if (counts.database) return 'database';
  return counts.words ? 'words' : 'none';
}

let last = 0;
/** An id the rules accept (letters, digits, - and _), unique on this device. */
export function learningId(now = Date.now()): string {
  last = now > last ? now : last + 1;
  return `${last.toString(36)}-${Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0')}`;
}

/**
 * An event from what a turn knows. The full tier's fields are filled only
 * when the settings say so; the structure tier's always, since the store on
 * the device keeps every event and the settings decide what is sent.
 */
/** What a turn knows, from which `learningEvent` builds the event. */
export interface LearningEventInput {
  /** An id chosen beforehand, so the reply can name its event before the event is built (LM-11). */
  id?: string;
  kind: LearningKind;
  source?: LearningSource;
  request?: LearningRequest;
  ai?: LearningAi;
  skeleton?: ReportSkeleton | null;
  ops?: readonly string[];
  roles?: readonly string[];
  findings?: readonly { severity: string }[];
  /** A rating given, or '' when it is taken back. */
  rating?: 'good' | 'bad' | '';
  repx?: string | null;
  prompt?: string | null;
  ref?: string | null;
  /** A LearningHow, or an export format named some other way, which is recorded as ''. */
  how?: LearningHow | string;
  draft?: LearningDraft;
  ms?: number;
  project?: string;
  distance?: number;
  /** On a kept report, the page pair (lib/readerPairs.ts) as JSON. */
  boxes?: string | null;
  /** On a kept report, a pair that was made and would not fit. */
  boxesDropped?: boolean;
}

const word = (value: string, max = 16) => (value && value.length <= max && PLAIN.test(value) ? value : '');

export function learningEvent(input: LearningEventInput, settings: LearningSettings, now = new Date()): LearningEvent {
  const wantsSkeleton = SKELETON_KINDS.has(input.kind) && Boolean(input.skeleton);
  const skeleton = SKELETON_KINDS.has(input.kind) ? skeletonField(input.skeleton) : '';
  const wantsFull = settings.full && FULL_KINDS.has(input.kind) && Boolean(input.repx);
  const full = wantsFull && utf8Bytes(input.repx!) <= MAX_FULL_BYTES ? input.repx! : '';
  const ops = (input.ops ?? []).map((op) => op.slice(0, 24)).slice(0, MAX_OPS);
  const ref = input.ref && input.ref.length <= MAX_REF_CHARS && /^[A-Za-z0-9_-]+$/.test(input.ref) ? input.ref : '';
  const wantsBoxes = input.kind === 'kept' && Boolean(input.boxes);
  const boxes = wantsBoxes && input.boxes!.length <= MAX_BOXES_CHARS ? input.boxes! : '';
  return {
    id: input.id ?? learningId(now.getTime()),
    at: now.toISOString(),
    day: now.toISOString().slice(0, 10),
    kind: input.kind,
    source: input.source ?? 'none',
    request: input.request ?? 'none',
    ai: input.ai ?? 'none',
    skeleton,
    ops,
    roles: ops.map((_, i) => word(input.roles?.[i] ?? '')),
    errors: (input.findings ?? []).filter((f) => f.severity === 'error').length,
    warnings: (input.findings ?? []).filter((f) => f.severity !== 'error').length,
    rating: input.kind === 'rating' ? (input.rating ?? '') : '',
    ref,
    // An export's format as the Export panel names it; one the list lacks is said as ''.
    how: input.kind === 'kept' && (LEARNING_HOWS as readonly string[]).includes(input.how ?? '') ? (input.how as LearningHow) : '',
    draft: input.ai === 'forma' ? (input.draft ?? '') : '',
    ms: Number.isFinite(input.ms) && input.ms! > 0 ? Math.round(input.ms!) : 0,
    project: /^[0-9a-f]{12}$/.test(input.project ?? '') ? input.project! : '',
    distance: Number.isFinite(input.distance) && input.distance! >= 0 ? input.distance! : -1,
    // Said rather than dropped silently (LM-25): the skeleton first, as what is learned from.
    dropped: wantsSkeleton && !skeleton ? 'skeleton' : wantsFull && !full ? 'full' : (wantsBoxes && !boxes) || (input.kind === 'kept' && input.boxesDropped) ? 'boxes' : '',
    boxes,
    full,
    prompt: full && input.prompt ? input.prompt.slice(0, MAX_PROMPT_CHARS) : '',
  };
}

/**
 * An event kept here before event v2 (2026-11-11), in today's shape: the new
 * fields at their "none", and a skeleton on a kind that no longer carries one
 * left out, so an event waiting in the outbox is still one the rules take.
 */
function upgradeEvent<T extends Partial<LearningEvent> & Pick<LearningEvent, 'id' | 'kind'>>(event: T): T & LearningEvent {
  const kind = (LEARNING_KINDS as readonly string[]).includes(event.kind) ? event.kind : 'edit';
  const ops = Array.isArray(event.ops) ? event.ops.slice(0, MAX_OPS) : [];
  const full = typeof event.full === 'string' && FULL_KINDS.has(kind) && utf8Bytes(event.full) <= MAX_FULL_BYTES ? event.full : '';
  return {
    ...event,
    at: event.at ?? new Date(0).toISOString(),
    day: event.day ?? (event.at ?? '').slice(0, 10),
    kind,
    source: event.source ?? 'none',
    request: event.request ?? 'none',
    ai: event.ai ?? 'none',
    skeleton: SKELETON_KINDS.has(kind) ? (event.skeleton ?? '') : '',
    ops,
    roles: Array.isArray(event.roles) && event.roles.length === ops.length ? event.roles : ops.map(() => ''),
    errors: event.errors ?? 0,
    warnings: event.warnings ?? 0,
    rating: kind === 'rating' ? (event.rating ?? '') : '',
    ref: event.ref ?? '',
    how: event.how ?? '',
    draft: event.draft ?? '',
    ms: event.ms ?? 0,
    project: event.project ?? '',
    distance: event.distance ?? -1,
    dropped: event.dropped ?? (event.full && !full ? 'full' : ''),
    // The page pair, a kept report's only (2026-11-12): an event kept before it has none.
    boxes: kind === 'kept' && typeof event.boxes === 'string' && event.boxes.length <= MAX_BOXES_CHARS ? event.boxes : '',
    full,
    prompt: full ? (event.prompt ?? '') : '',
  };
}

/** Whether an event goes to the account under these settings: structure events always once on, full ones only with their switch. */
export function sendable(event: LearningEvent, settings: LearningSettings): boolean {
  return settings.structure || (settings.full && event.full !== '');
}

/** Whether an event is kept at all: with both switches off nothing is (2026-11-11, the full audit's LM-29). */
export function keepable(settings: LearningSettings): boolean {
  return settings.structure || settings.full;
}

/**
 * An event as this browser keeps it (2026-11-11, the full audit's LM-09):
 * whose it is, null when made signed out, and whether the account has it.
 * Until then an event that could not be sent was kept and never sent again.
 */
export interface StoredLearningEvent extends LearningEvent {
  uid: string | null;
  sent: boolean;
  /**
   * On a generation from a picture (2026-11-12, D10): the page's numeric
   * reading, kept on this device only, until the report is kept and labels
   * it (`boxes` on the kept event). Never sent as it is.
   */
  reading?: PageReading | null;
}

/**
 * What goes to the account: the event alone, without the fields only this
 * browser keeps (the rules pin every field), and without the whole report
 * and the words when that switch is now off. Null when nothing goes.
 */
export function forSending(event: Partial<LearningEvent> & Pick<LearningEvent, 'id' | 'kind'> & Partial<Pick<StoredLearningEvent, 'uid' | 'sent' | 'reading'>>, settings: LearningSettings): LearningEvent | null {
  const { uid: _uid, sent: _sent, reading: _reading, ...rest } = event;
  const plain: LearningEvent = upgradeEvent(rest);
  const out: LearningEvent = settings.full ? plain : { ...plain, full: '', prompt: '' };
  return sendable(out, settings) ? out : null;
}

/** What Settings says about what is kept: counts by kind, and how many carried a full report. */
export function learningSummary(events: readonly LearningEvent[]): { total: number; byKind: Record<LearningKind, number>; full: number; since: string | null } {
  const byKind: Record<LearningKind, number> = { generation: 0, edit: 0, translate: 0, rating: 0, kept: 0, undo: 0 };
  let full = 0;
  let since: string | null = null;
  for (const e of events) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    if (e.full) full++;
    if (!since || e.at < since) since = e.at;
  }
  return { total: events.length, byKind, full, since };
}

/* ---- the store on the device ---- */

export const LEARNING_DB_NAME = 'forma-learning';
const STORE = 'events';

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(LEARNING_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('at', 'at');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const request = <T,>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** Keeps an event on the device, and trims the store to MAX_LOCAL. A browser without IndexedDB keeps nothing. */
export async function keepLearningEvent(event: LearningEvent | StoredLearningEvent, idb: IDBFactory | null = typeof indexedDB === 'undefined' ? null : indexedDB): Promise<void> {
  if (!idb) return;
  const db = await openDb(idb);
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    await request(store.put(event));
    const keys = (await request(store.index('at').getAllKeys())) as IDBValidKey[];
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_LOCAL))) await request(store.delete(key));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Every event kept on the device, newest first. One kept before 2026-11-11 has no `uid` or `sent`. */
export async function listLearningEvents(idb: IDBFactory | null = typeof indexedDB === 'undefined' ? null : indexedDB): Promise<(LearningEvent & Partial<Pick<StoredLearningEvent, 'uid' | 'sent'>>)[]> {
  if (!idb) return [];
  const db = await openDb(idb);
  try {
    const all = (await request(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())) as (LearningEvent & Partial<Pick<StoredLearningEvent, 'uid' | 'sent'>>)[];
    return all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  } finally {
    db.close();
  }
}

/** One event kept on the device, or null. */
export async function readLearningEvent(id: string, idb: IDBFactory | null = typeof indexedDB === 'undefined' ? null : indexedDB): Promise<StoredLearningEvent | null> {
  if (!idb) return null;
  const db = await openDb(idb);
  try {
    return ((await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(id))) as StoredLearningEvent | undefined) ?? null;
  } finally {
    db.close();
  }
}

/**
 * The page readings kept for the newest `max` requests, and none for older
 * ones (2026-11-12, D10): a reading waits for its report to be kept, and a
 * request long past is unlikely to be, while each reading is tens of
 * kilobytes. The events themselves stay.
 */
export async function trimReadings(max = MAX_READINGS, idb: IDBFactory | null = typeof indexedDB === 'undefined' ? null : indexedDB): Promise<number> {
  if (!idb) return 0;
  const db = await openDb(idb);
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const all = (await request(store.getAll())) as StoredLearningEvent[];
    const holding = all.filter((e) => e.reading).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const old = holding.slice(max);
    for (const e of old) {
      const { reading: _gone, ...rest } = e;
      await request(store.put(rest));
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return old.length;
  } finally {
    db.close();
  }
}

/** Marks a kept event as in the account; one no longer kept (trimmed, or cleared meanwhile) is left gone. */
export async function markLearningSent(id: string, idb: IDBFactory | null = typeof indexedDB === 'undefined' ? null : indexedDB): Promise<void> {
  if (!idb) return;
  const db = await openDb(idb);
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const kept = (await request(store.get(id))) as StoredLearningEvent | undefined;
    // The whole report and the words are kept here only while they wait to go
    // (2026-11-11, the full audit's LM-16): once the account has them, a copy
    // in this browser is one more place a report sits for nothing.
    if (kept) await request(store.put({ ...kept, sent: true, full: '', prompt: '' }));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** A Firestore refusal of this one event, as opposed to no connection: the next event may still go. */
function refusedByAccount(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'permission-denied' || code === 'invalid-argument';
}

/**
 * Sends what this account made here and the account does not have yet
 * (2026-11-11, the full audit's LM-09), oldest first, under the switches as
 * they are now: on load and on sign-in. Only events made signed in as `uid`
 * go, never one made signed out or by another account. Stops at the first
 * send that fails for want of a connection, since the next would fail the
 * same way; what is left goes next time. One the account refuses
 * (`permission-denied`, `invalid-argument`: a shape the rules no longer
 * take, say) is passed over and stays unsent, so it can never hold back the
 * events behind it (the PRIV review, 2026-11-11). One the account already
 * holds is not a refusal: `writeLearning` answers it as sent. Returns how
 * many went.
 */
export async function flushLearning(
  uid: string,
  settings: LearningSettings,
  send: (event: LearningEvent) => Promise<void>,
  idb: IDBFactory | null = typeof indexedDB === 'undefined' ? null : indexedDB,
): Promise<number> {
  const waiting = (await listLearningEvents(idb)).filter((e) => e.uid === uid && e.sent === false).reverse();
  let sent = 0;
  for (const event of waiting) {
    const out = forSending(event, settings);
    if (!out) continue;
    try {
      await send(out);
    } catch (err) {
      if (refusedByAccount(err)) continue;
      break;
    }
    sent++;
    await markLearningSent(event.id, idb).catch(() => undefined);
  }
  return sent;
}

/* ---- recording a turn ---- */

/** What App knows of a turn; `learningEvent`'s input plus what is read off the report here. */
export interface LearningRecord extends Omit<LearningEventInput, 'skeleton' | 'findings' | 'project' | 'distance' | 'roles'> {
  /** What the request brought, counted; named by `sourceOf` when `source` is not given. */
  sourceCounts?: { images: number; pdfs: number; repx: number; words: boolean; database: boolean };
  /** The report as the turn left it: its skeleton, checks and the edited parts' kinds are read off it. */
  repx?: string | null;
  /** On a kept report, the one Forma made, for `distance`. */
  madeRepx?: string | null;
  /**
   * On an edit, the report before it, so a part an edit deleted or renamed is
   * named for what it was rather than as 'report' (2026-11-11): the parts are
   * read off this first, and off `repx` for one the edit added.
   */
  beforeRepx?: string | null;
  /** On an edit, the name of the control each operation was made on, beside `ops`. */
  controls?: readonly (string | undefined)[];
  projectId?: string | null;
  /**
   * On a generation from a picture, the page's numeric reading
   * (lib/readerPairs.ts), kept on this device with the event; a kept report
   * whose `ref` names the event labels it, and the pair goes with that.
   */
  reading?: PageReading | null;
}

/** Where a record goes: whose it is, whether the account's switches are known, and how to send. */
export interface LearningSink {
  uid: string | null;
  /** Settles once the account's switches have been read; true when they were (`settleLearning` in App). */
  known: Promise<boolean> | boolean;
  /** Null when nothing may be sent: signed out, or an address not verified yet (the rules require one). */
  send: ((event: LearningEvent) => Promise<void>) | null;
  idb?: IDBFactory | null;
  storage?: Pick<Storage, 'getItem'> | null;
}

/** The kind of part an edit was made on, from the parsed report: never its name or its words. */
function partRole(control: { type: string; field: string | null; data?: { running?: string | null } } | undefined): string {
  if (!control) return 'report';
  if (control.type === 'XRTable') return 'table';
  if (control.field) return control.data?.running ? 'total' : 'value';
  if (control.type === 'XRLabel') return 'caption';
  return word(control.type.replace(/^XR/, '').toLowerCase()) || 'other';
}

/**
 * A turn recorded (2026-11-11, the full audit; moved here from App.tsx so the
 * work runs in this lazy module and App carries one call): the report read
 * for what the event's kind carries, the event built, kept on this device,
 * and sent when the sink may. Never throws: a failure is a console line, and
 * an event that could not go waits in the outbox (`flushLearning`). Returns
 * the event, or null when nothing was kept.
 */
export async function recordLearning(input: LearningRecord, sink: LearningSink): Promise<LearningEvent | null> {
  try {
    const known = await sink.known;
    const settings = effectiveLearningSettings(readLearningSettings(sink.uid, sink.storage), sink.uid !== null, known);
    if (!keepable(settings)) return null;
    const { sourceCounts, madeRepx, beforeRepx, controls, projectId, reading, ...rest } = input;
    const idb = sink.idb === undefined ? (typeof indexedDB === 'undefined' ? null : indexedDB) : sink.idb;
    let skeleton: ReportSkeleton | null = null;
    let findings: { severity: string }[] = [];
    let roles: string[] = [];
    let distance = -1;
    const reads = SKELETON_KINDS.has(input.kind) || input.kind === 'edit';
    if (input.repx && reads) {
      const [{ parseReportStructure }, { skeletonOf, skeletonFeatures }, { auditRepx }] = await Promise.all([import('./reportPreview'), import('./reportSkeleton'), import('./repxAudit')]);
      try {
        const structure = parseReportStructure(input.repx);
        findings = auditRepx(input.repx, null).findings;
        if (input.kind === 'edit') {
          const namesOf = (s: typeof structure) => new Map(s.bands.flatMap((b) => b.controls).map((c) => [c.name, c] as const));
          const after = namesOf(structure);
          let before: typeof after = new Map();
          try {
            if (beforeRepx) before = namesOf(parseReportStructure(beforeRepx));
          } catch {
            // The parts are then read off the report after the edit alone.
          }
          roles = (controls ?? []).map((name) => partRole(name ? before.get(name) ?? after.get(name) : undefined));
        } else {
          skeleton = skeletonOf(structure);
          if (input.kind === 'kept' && madeRepx === input.repx) distance = 0;
          else if (input.kind === 'kept' && madeRepx) {
            // In a try of its own (2026-11-11): a first report that will not
            // parse leaves the distance unknown and keeps the kept report's skeleton.
            const kept = skeleton;
            try {
              distance = featureDistance(skeletonFeatures(skeletonOf(parseReportStructure(madeRepx))), skeletonFeatures(kept));
            } catch {
              distance = -1;
            }
          }
        }
      } catch {
        skeleton = null;
      }
    }
    const source = rest.source ?? (sourceCounts ? sourceOf(sourceCounts) : undefined);
    const project = await projectKey(sink.uid, projectId).catch(() => '');
    const pair = input.kind === 'kept' ? await keptPair(input.ref, input.repx, sink.uid, idb) : { json: null, tooLarge: false };
    const event = learningEvent({ ...rest, source, skeleton, findings, roles, project, distance, boxes: pair.json, boxesDropped: pair.tooLarge }, settings);
    const keepsReading = input.kind === 'generation' && reading ? { reading } : {};
    try {
      await keepLearningEvent({ ...event, uid: sink.uid, sent: false, ...keepsReading }, idb);
      if (keepsReading.reading) await trimReadings(MAX_READINGS, idb);
    } catch (err) {
      console.warn('A learning event could not be kept on this device.', err);
    }
    const outgoing = sink.send ? forSending(event, settings) : null;
    if (!sink.send || !outgoing) return event;
    try {
      await sink.send(outgoing);
    } catch (err) {
      console.warn('A learning event could not be sent; it goes next time.', err);
      return event;
    }
    await markLearningSent(event.id, idb).catch(() => undefined);
    return event;
  } catch (err) {
    console.warn('A learning event could not be kept.', err);
    return null;
  }
}

/**
 * The page pair a kept report makes (2026-11-12, D10): the reading kept with
 * the request it came from (`ref`), by this account on this device, labelled
 * by the report as kept, read in hundredths of an inch as the reading is.
 * Nothing when there is no reading, or the report does not account for the
 * page (lib/readerPairs.ts). Never throws.
 */
async function keptPair(ref: string | null | undefined, repx: string | null | undefined, uid: string | null, idb: IDBFactory | null): Promise<{ json: string | null; tooLarge: boolean }> {
  const none = { json: null, tooLarge: false };
  if (!ref || !repx) return none;
  try {
    const made = await readLearningEvent(ref, idb);
    if (!made?.reading || made.uid !== uid) return none;
    const [{ parseReportStructure }, { skeletonOf }, { DEFAULT_UNIT, unitsPerInch }, { readerPairOf }] = await Promise.all([
      import('./reportPreview'),
      import('./reportSkeleton'),
      import('./reportGeometry'),
      import('./readerPairs'),
    ]);
    return readerPairOf(made.reading, skeletonOf(parseReportStructure(repx, { dpi: unitsPerInch(DEFAULT_UNIT), unit: DEFAULT_UNIT })));
  } catch {
    return none;
  }
}

/** Removes everything kept on the device. */
export async function clearLearningEvents(idb: IDBFactory | null = typeof indexedDB === 'undefined' ? null : indexedDB): Promise<void> {
  if (!idb) return;
  const db = await openDb(idb);
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await request(tx.objectStore(STORE).clear());
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
