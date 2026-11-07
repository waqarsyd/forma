/**
 * The changes the chat's replies made, kept in this tab so a reply's Undo and
 * Redo outlive a reload (2026-11-07, agent audit item 52).
 *
 * A reply that edits or redesigns the open report keeps the report as it was
 * before and after, and its Undo is offered while the report is still the one
 * it left. That record lived in memory only, so a reload took every Undo away
 * while the reply still read "Changed …" (seen live). The record is two REPX
 * files a change, which is too much to put in the saved project (its cloud
 * copy has a budget, see persistence.md), so it is kept per tab in
 * sessionStorage, as the unsent draft and the open project's id are: a reload
 * keeps it, closing the tab ends it, and Revisions holds what is older.
 *
 * Only the REPX is kept. The Mockup and the Spec are read off the REPX
 * (lib/repxViews.ts), so a report is rebuilt from the file alone, and only
 * the open project's changes: one project per tab is open at a time.
 */

/** The report as a reply found it and as it left it, as REPX. */
export interface ReplyChange {
  before: string;
  after: string;
}

export const REPLY_CHANGES_KEY = 'forma:replyChanges';
/** The newest changes kept; older ones are in Revisions. */
export const MAX_KEPT_CHANGES = 8;
/** Characters kept in all, well under the 5 MB sessionStorage gives an origin. */
export const MAX_KEPT_CHARS = 1_500_000;

interface Stored {
  project: string;
  changes: [string, ReplyChange][];
}

/**
 * The changes to keep for `project`, oldest first, as the string to store:
 * the newest `MAX_KEPT_CHANGES`, fewer while they exceed `MAX_KEPT_CHARS`.
 * Null when there is nothing to keep.
 */
export function packChanges(project: string, changes: ReadonlyArray<readonly [string, ReplyChange]>): string | null {
  let kept = changes
    .filter(([, c]) => typeof c.before === 'string' && typeof c.after === 'string' && c.before !== '' && c.after !== '')
    .slice(-MAX_KEPT_CHANGES)
    .map(([id, c]) => [id, { before: c.before, after: c.after }] as [string, ReplyChange]);
  const size = (list: typeof kept) => list.reduce((n, [, c]) => n + c.before.length + c.after.length, 0);
  while (kept.length && size(kept) > MAX_KEPT_CHARS) kept = kept.slice(1);
  if (!kept.length) return null;
  const stored: Stored = { project, changes: kept };
  return JSON.stringify(stored);
}

/** The changes kept for `project`, oldest first; none for another project or anything unreadable. */
export function unpackChanges(raw: string | null | undefined, project: string): [string, ReplyChange][] {
  if (!raw) return [];
  try {
    const stored = JSON.parse(raw) as Partial<Stored>;
    if (!stored || stored.project !== project || !Array.isArray(stored.changes)) return [];
    return stored.changes.filter(
      (entry): entry is [string, ReplyChange] =>
        Array.isArray(entry) &&
        typeof entry[0] === 'string' &&
        !!entry[1] &&
        typeof entry[1].before === 'string' &&
        typeof entry[1].after === 'string' &&
        entry[1].before !== '' &&
        entry[1].after !== '',
    );
  } catch {
    return [];
  }
}
