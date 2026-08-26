/**
 * Timestamps for the workspace rail.
 *
 * The Recent list showed `toLocaleTimeString()` and nothing else, so every
 * session read as a bare wall-clock time — "3:42:11 PM" for something saved
 * three weeks ago, sitting directly above "9:15:04 AM" from this morning. With
 * no day attached the two are indistinguishable, and the list stops being a way
 * to find anything.
 *
 * The failure this file is built around is the one that does not throw:
 * "yesterday" is a **calendar** question, not an arithmetic one. 11pm and 1am
 * are two hours apart and two different days; a DST boundary makes a day 23 or
 * 25 hours long. Anything that divides a millisecond difference by 86,400,000
 * is right most of the time and quietly wrong at the edges — which is exactly
 * the kind of thing nobody notices until the label has been lying for months.
 */

/** Midnight local time on the day `d` falls in. */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Whole calendar days from `then` to `now`. 0 is today, 1 yesterday, and a
 * future date is negative. Rounded because a DST day is not 24 hours, so the
 * quotient is 0.958… or 1.041… rather than exactly 1.
 */
export function calendarDaysAgo(then: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
}

/**
 * "Today, 3:42 PM" · "Yesterday, 9:15 AM" · "26 Aug, 3:42 PM" · "26 Aug 2025, 3:42 PM".
 *
 * The year appears only when it is not the current one — carrying it on every
 * row costs width in a narrow column to say something that is true of almost
 * every row. Seconds are dropped: they were never useful for telling two
 * sessions apart, and they made the line longer than the name above it.
 *
 * `locale` exists so the tests can pin a format; leave it undefined in the app
 * so the reader gets their own.
 */
export function formatSessionStamp(
  when: Date | string | number,
  now: Date = new Date(),
  locale?: string
): string {
  const d = when instanceof Date ? when : new Date(when);
  // A saved report always has a timestamp, but a corrupt localStorage entry or
  // a Firestore document written by an older shape might not. An empty string
  // renders as nothing rather than as "Invalid Date".
  if (Number.isNaN(d.getTime())) return '';

  const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const days = calendarDaysAgo(d, now);

  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;

  const date = d.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
  return `${date}, ${time}`;
}
