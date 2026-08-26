import { describe, it, expect } from 'vitest';
import { calendarDaysAgo, formatSessionStamp } from './datetime';

/**
 * Every case here is one that renders perfectly happily while saying something
 * false about when a session was saved — a label two hours old reading
 * "Yesterday", a January entry claiming to be from this year. Nothing throws,
 * so nothing but these catches it.
 *
 * The locale is pinned to en-US throughout: the app deliberately passes none so
 * each reader gets their own format, but a test that asserted on the runner's
 * default would fail on a machine configured differently and prove nothing
 * about the logic under test.
 */
const EN = 'en-US';

describe('calendarDaysAgo', () => {
  it('counts days, not 24-hour spans', () => {
    // Two hours apart, either side of midnight. Dividing the difference by
    // 86,400,000 gives 0 and labels this "Today" — the bug this guards.
    const then = new Date(2026, 7, 25, 23, 0);
    const now = new Date(2026, 7, 26, 1, 0);
    expect(calendarDaysAgo(then, now)).toBe(1);
  });

  it('treats a long span within one day as today', () => {
    expect(calendarDaysAgo(new Date(2026, 7, 26, 0, 1), new Date(2026, 7, 26, 23, 59))).toBe(0);
  });

  it('survives a DST boundary, where a day is not 24 hours', () => {
    // US DST ends 2026-11-01; that local day is 25 hours long, so the raw
    // quotient is 1.041… and truncation would call it the same day.
    expect(calendarDaysAgo(new Date(2026, 9, 31, 12, 0), new Date(2026, 10, 1, 12, 0))).toBe(1);
  });

  it('goes negative for a future date rather than wrapping', () => {
    expect(calendarDaysAgo(new Date(2026, 7, 27), new Date(2026, 7, 26))).toBe(-1);
  });

  it('counts across a month boundary', () => {
    expect(calendarDaysAgo(new Date(2026, 6, 31), new Date(2026, 7, 2))).toBe(2);
  });
});

describe('formatSessionStamp', () => {
  const now = new Date(2026, 7, 26, 14, 30);

  it('names today', () => {
    expect(formatSessionStamp(new Date(2026, 7, 26, 9, 15), now, EN)).toBe('Today, 9:15 AM');
  });

  it('names yesterday', () => {
    expect(formatSessionStamp(new Date(2026, 7, 25, 23, 5), now, EN)).toBe('Yesterday, 11:05 PM');
  });

  it('gives an older date this year without the year', () => {
    expect(formatSessionStamp(new Date(2026, 7, 3, 15, 42), now, EN)).toBe('Aug 3, 3:42 PM');
  });

  it('adds the year once it is a different one', () => {
    // The case that makes a list unreadable: "Aug 3" over "Aug 3" for entries
    // twelve months apart.
    expect(formatSessionStamp(new Date(2025, 7, 3, 15, 42), now, EN)).toBe('Aug 3, 2025, 3:42 PM');
  });

  it('drops seconds', () => {
    expect(formatSessionStamp(new Date(2026, 7, 26, 9, 15, 47), now, EN)).toBe('Today, 9:15 AM');
  });

  it('accepts the ISO string a saved report actually stores', () => {
    const iso = new Date(2026, 7, 26, 9, 15).toISOString();
    expect(formatSessionStamp(iso, now, EN)).toBe('Today, 9:15 AM');
  });

  it('renders nothing at all for a timestamp it cannot read', () => {
    // Better an empty line than the words "Invalid Date" in the rail.
    expect(formatSessionStamp('not a date', now, EN)).toBe('');
    expect(formatSessionStamp(NaN, now, EN)).toBe('');
  });
});
