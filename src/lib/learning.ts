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
 *   (`AccessibleDescription`) never reaches a skeleton either.
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
 * Pure parts here are tested; the store is thin over IndexedDB.
 */
import type { ReportSkeleton } from './reportSkeleton';

export interface LearningSettings {
  /** The skeleton, the request's kind, the edits and the thumbs: on by default, said in the policy. */
  structure: boolean;
  /** The whole REPX and the person's words with it: off until they turn it on. */
  full: boolean;
}

export const DEFAULT_LEARNING_SETTINGS: LearningSettings = { structure: true, full: false };

const SETTINGS_KEY = 'forma:learning';

export function readLearningSettings(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): LearningSettings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    const s = raw ? (JSON.parse(raw) as Partial<LearningSettings>) : null;
    return { structure: s?.structure ?? DEFAULT_LEARNING_SETTINGS.structure, full: s?.full ?? DEFAULT_LEARNING_SETTINGS.full };
  } catch {
    return { ...DEFAULT_LEARNING_SETTINGS };
  }
}

export function writeLearningSettings(settings: LearningSettings, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage refused: the defaults hold */
  }
}

export type LearningKind = 'generation' | 'edit' | 'translate' | 'rating';
/** What the request brought: the kinds the composer tells apart. */
export type LearningSource = 'image' | 'pdf' | 'repx' | 'words' | 'database' | 'mixed' | 'none';
/** What was asked: a new report, the open one redesigned, an edit in place, a batch file. */
export type LearningRequest = 'new' | 'redesign' | 'edit' | 'batch' | 'none';
/** Which AI answered, by kind only. */
export type LearningAi = 'gemini' | 'local' | 'openrouter' | 'forma' | 'mock' | 'none';

/** One event, as the store and the account hold it. Every field present, so the rules can pin the shape. */
export interface LearningEvent {
  id: string;
  /** ISO time. */
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
  errors: number;
  warnings: number;
  rating: '' | 'good' | 'bad';
  /** The whole REPX, only on the full tier; '' otherwise. */
  full: string;
  /** The person's words, only on the full tier; '' otherwise. */
  prompt: string;
}

export const MAX_OPS = 40;
export const MAX_SKELETON_CHARS = 80_000;
export const MAX_FULL_CHARS = 400_000;
export const MAX_PROMPT_CHARS = 4_000;
/** Events kept on the device, newest first; older ones go. */
export const MAX_LOCAL = 500;

/** The keys whose string values a skeleton may carry, and the longest each may be. */
const WORD_KEYS: Record<string, number> = { kind: 24, role: 16, align: 8, paper: 16, family: 40 };
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9 .'-]*$/;

/**
 * A skeleton with every string that is not one of its fixed words stripped.
 * A skeleton holds no text by construction (a caption keeps its length only),
 * so this changes a sound one not at all; it is the guard against a defect
 * upstream, the same promise `unexpectedStrings` makes for the shipped model.
 */
export function scrubSkeleton<T>(value: T, key = ''): T {
  if (Array.isArray(value)) return value.map((v) => scrubSkeleton(v, key)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubSkeleton(v, k);
    return out as T;
  }
  if (typeof value === 'string') {
    const max = WORD_KEYS[key];
    return (max && value.length <= max && PLAIN.test(value) ? value : '') as unknown as T;
  }
  return value;
}

/** The skeleton as the event carries it: scrubbed, as JSON, or '' when it would not fit. */
export function skeletonField(skeleton: ReportSkeleton | null | undefined): string {
  if (!skeleton) return '';
  const json = JSON.stringify(scrubSkeleton(skeleton));
  return json.length <= MAX_SKELETON_CHARS ? json : '';
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
export function learningEvent(
  input: {
    kind: LearningKind;
    source?: LearningSource;
    request?: LearningRequest;
    ai?: LearningAi;
    skeleton?: ReportSkeleton | null;
    ops?: readonly string[];
    findings?: readonly { severity: string }[];
    rating?: 'good' | 'bad';
    repx?: string | null;
    prompt?: string | null;
  },
  settings: LearningSettings,
  now = new Date(),
): LearningEvent {
  const full = settings.full && input.repx && input.repx.length <= MAX_FULL_CHARS ? input.repx : '';
  return {
    id: learningId(now.getTime()),
    at: now.toISOString(),
    day: now.toISOString().slice(0, 10),
    kind: input.kind,
    source: input.source ?? 'none',
    request: input.request ?? 'none',
    ai: input.ai ?? 'none',
    skeleton: skeletonField(input.skeleton),
    ops: (input.ops ?? []).map((op) => op.slice(0, 24)).slice(0, MAX_OPS),
    errors: (input.findings ?? []).filter((f) => f.severity === 'error').length,
    warnings: (input.findings ?? []).filter((f) => f.severity !== 'error').length,
    rating: input.rating ?? '',
    full,
    prompt: full && input.prompt ? input.prompt.slice(0, MAX_PROMPT_CHARS) : '',
  };
}

/** Whether an event goes to the account under these settings: structure events always once on, full ones only with their switch. */
export function sendable(event: LearningEvent, settings: LearningSettings): boolean {
  return settings.structure || (settings.full && event.full !== '');
}

/** What Settings says about what is kept: counts by kind, and how many carried a full report. */
export function learningSummary(events: readonly LearningEvent[]): { total: number; byKind: Record<LearningKind, number>; full: number; since: string | null } {
  const byKind: Record<LearningKind, number> = { generation: 0, edit: 0, translate: 0, rating: 0 };
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
export async function keepLearningEvent(event: LearningEvent, idb: IDBFactory | null = typeof indexedDB === 'undefined' ? null : indexedDB): Promise<void> {
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

/** Every event kept on the device, newest first. */
export async function listLearningEvents(idb: IDBFactory | null = typeof indexedDB === 'undefined' ? null : indexedDB): Promise<LearningEvent[]> {
  if (!idb) return [];
  const db = await openDb(idb);
  try {
    const all = (await request(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())) as LearningEvent[];
    return all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  } finally {
    db.close();
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
