/**
 * The notes the landing page's announcement dock and the workspace's What's
 * new show, newest first.
 *
 * Since 2026-11-07 they are the releases marked `announce` in releases.ts,
 * which the public /changelog page draws in full: one list, so the dock, the
 * menu, the page and its feed cannot disagree. Add a release there, not here.
 * Until then this file held its own three notes; the ids of the two still
 * shown are kept word for word, because `SEEN_KEY` remembers what was seen by
 * id. "Going open source" (2026-08-14) went: it said "soon" of something done
 * on 2026-09-09.
 *
 * **Only write things that are true** — releases.ts carries the rule now.
 */
import { RELEASES } from './releases';

export type Announcement = {
  /** Stable, and never reused — it is what "already seen" is remembered by. */
  id: string;
  /** ISO date. Displayed as-is, so keep it a date and not a timestamp. */
  date: string;
  title: string;
  body: string;
};

export const ANNOUNCEMENTS: Announcement[] = RELEASES.filter((r) => r.announce).map((r) => ({
  id: r.id,
  date: r.date,
  title: r.title,
  body: r.summary,
}));

/** Where the newest id the reader has seen is remembered. */
export const SEEN_KEY = 'announcementsSeenId';

/**
 * How many entries are newer than the one last seen.
 *
 * `items` is newest-first, so the answer is the index of `lastSeenId` — every
 * entry above it arrived after that read. An id that is absent (a cleared
 * profile, a note deleted since, a hand-edited value) counts everything as
 * unseen rather than nothing: showing a dot that turns out to be old news is a
 * smaller failure than silently never showing one again.
 */
export function unseenCount(items: Announcement[], lastSeenId: string | null): number {
  if (!lastSeenId) return items.length;

  const seenAt = items.findIndex((item) => item.id === lastSeenId);
  return seenAt === -1 ? items.length : seenAt;
}
