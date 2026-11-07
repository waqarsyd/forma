/**
 * What the box holds that has not been sent, kept in the tab across a reload
 * (2026-11-07, agent audit items 69 and 71).
 *
 * **The draft is kept per project**, as ChatGPT keeps one per chat. Until
 * then the tab had one draft, so words typed on one project were waiting in
 * the box of the next one opened, and a reload put them back in whichever
 * project came up. Each project's words are kept under its id, a report not
 * yet saved under `NEW_DRAFT`, and a report's first save moves its words to
 * its id (`movedDraft`). At most `MAX_DRAFTS`, the oldest going first.
 *
 * **The queue is kept too**, with the project it belongs to: it was memory
 * only, so a reload in the middle of a turn lost every message waiting in
 * it. A kept queue comes back paused (App), since the turn it was waiting on
 * was cut off; Resume sends it. A queue too large for the tab's storage, as
 * pictures can make it, is kept as its words, each message that lost its
 * files saying so (`withoutFiles`), rather than not kept at all.
 *
 * sessionStorage, as the key is: this may be a shared machine, and an unsent
 * message is the person's words. The reading and writing is App's; this file
 * is the shapes, so a test can hold them.
 */

/** The tab's drafts, one per project. `forma:draft` held the single draft before. */
export const DRAFTS_KEY = 'forma:drafts';
export const LEGACY_DRAFT_KEY = 'forma:draft';
/** The draft of a report not yet saved, which has no id. */
export const NEW_DRAFT = 'new';
export const MAX_DRAFTS = 20;

export type Drafts = Readonly<Record<string, string>>;

/**
 * The drafts kept, from what storage holds. The single draft an older build
 * kept goes to `legacyKey`, the project that tab had open, when nothing newer
 * is kept there.
 */
export function parseDrafts(raw: string | null, legacy?: string | null, legacyKey: string = NEW_DRAFT): Drafts {
  const drafts: Record<string, string> = {};
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, text] of Object.entries(parsed)) if (typeof text === 'string' && text) drafts[key] = text;
      }
    } catch {
      /* a store that cannot be read holds nothing */
    }
  }
  if (legacy && !(legacyKey in drafts)) drafts[legacyKey] = legacy;
  return drafts;
}

/** The drafts with `text` kept for `key`, newest last; an empty text drops the key. */
export function withDraft(drafts: Drafts, key: string, text: string): Drafts {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(drafts)) if (k !== key) next[k] = v;
  if (text) next[key] = text;
  const keys = Object.keys(next);
  if (keys.length <= MAX_DRAFTS) return next;
  const kept: Record<string, string> = {};
  for (const k of keys.slice(-MAX_DRAFTS)) kept[k] = next[k];
  return kept;
}

/** A report's first save: its words move from the key it had to its id. */
export function movedDraft(drafts: Drafts, from: string, to: string): Drafts {
  if (from === to || !(from in drafts)) return drafts;
  return withDraft(withDraft(drafts, from, ''), to, drafts[from]);
}

/** The tab's queue, with the project it belongs to. */
export const QUEUE_KEY = 'forma:queue';

/** What a kept queue's message must have; the rest is App's (`Queued`). */
export interface KeptMessage {
  id: string;
  text: string;
  images?: readonly string[];
  imageMeta?: readonly unknown[];
  texts?: readonly unknown[];
  /** Its files were too large to keep over a reload, and went. */
  dropped?: true;
}

export function keepQueue<T extends KeptMessage>(project: string, items: readonly T[]): string {
  return JSON.stringify({ project, items });
}

/** The messages kept for `project`, or none: a queue kept for another project is not this one's. */
export function keptQueueFor<T extends KeptMessage>(raw: string | null, project: string): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { project?: unknown; items?: unknown };
    if (parsed?.project !== project || !Array.isArray(parsed.items)) return [];
    return parsed.items.filter((m): m is T => !!m && typeof m === 'object' && typeof (m as KeptMessage).id === 'string' && typeof (m as KeptMessage).text === 'string');
  } catch {
    return [];
  }
}

/** The queue as its words alone, each message that had files marked as having lost them. */
export function withoutFiles<T extends KeptMessage>(items: readonly T[]): T[] {
  return items.map((m) => {
    if (!m.images?.length && !m.texts?.length) return m;
    const { images: _images, imageMeta: _meta, texts: _texts, ...rest } = m;
    return { ...rest, dropped: true } as T;
  });
}

/** How many files a queued message carries: its uploads, a PDF's pages and its text layer counting once. */
export function queuedFiles(m: { imageMeta?: readonly { uploadId?: string }[]; images?: readonly string[]; texts?: readonly { uploadId?: string }[] }): number {
  const ids = new Set<string>();
  m.imageMeta?.forEach((meta, i) => ids.add(meta?.uploadId ?? `image-${i}`));
  if (!m.imageMeta && m.images) m.images.forEach((_, i) => ids.add(`image-${i}`));
  m.texts?.forEach((t, i) => ids.add(t?.uploadId ?? `text-${i}`));
  return ids.size;
}
