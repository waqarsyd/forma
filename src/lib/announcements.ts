/**
 * The notes the landing page's announcement dock shows, newest first.
 *
 * A hand-written list rather than a feed: this app has no CMS, no backend of
 * its own and no analytics, and adding one so a three-line changelog can be
 * edited without a deploy would be the tail wagging the dog. Add an entry at
 * the top, ship, done.
 *
 * **Only write things that are true.** This is the one surface where the
 * product talks about itself to someone who has not used it yet, so a note
 * describing a feature that is not there is worse than no note at all. A note
 * about something *coming* is fine — say so in as many words, as the one below
 * does, rather than writing a plan in the present tense.
 */
export type Announcement = {
  /** Stable, and never reused — it is what "already seen" is remembered by. */
  id: string;
  /** ISO date. Displayed as-is, so keep it a date and not a timestamp. */
  date: string;
  title: string;
  body: string;
};

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: '2026-09-09-open-source-live',
    date: '2026-09-09',
    title: 'Forma is open source',
    body: 'It’s done — the repository is public at github.com/waqarsyd/forma under Apache-2.0: the app itself, the prompt behind it, and the notes on why it works the way it does. 🚀',
  },
  {
    id: '2026-08-14-open-source',
    date: '2026-08-14',
    title: 'Going open source',
    body: 'Soon, I’ll be open-sourcing the project and making the repository publicly available. 🚀 Stay tuned — more details coming soon! 🔥',
  },
];

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
