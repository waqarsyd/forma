import { describe, it, expect } from 'vitest';
import { ANNOUNCEMENTS, unseenCount, type Announcement } from './announcements';

const items: Announcement[] = [
  { id: 'c', date: '2026-08-14', title: 'Newest', body: '' },
  { id: 'b', date: '2026-08-13', title: 'Middle', body: '' },
  { id: 'a', date: '2026-08-02', title: 'Oldest', body: '' },
];

/**
 * The dot on the launcher is the only thing that ever asks a visitor to click
 * it, and both ways of getting this wrong are silent: a count that never
 * reaches zero trains people to ignore it, and one that never leaves zero means
 * nobody sees the note at all.
 */
describe('unseenCount', () => {
  it('counts everything for a first-time reader', () => {
    expect(unseenCount(items, null)).toBe(3);
  });

  it('counts nothing once the newest has been seen', () => {
    expect(unseenCount(items, 'c')).toBe(0);
  });

  it('counts only what arrived after the last one seen', () => {
    expect(unseenCount(items, 'b')).toBe(1);
    expect(unseenCount(items, 'a')).toBe(2);
  });

  /* A cleared profile, a note deleted since it was read, or a hand-edited
     value. Everything unseen is the recoverable answer; nothing unseen would
     hide the dock's contents for good. */
  it('treats an id it does not recognise as never having read anything', () => {
    expect(unseenCount(items, 'gone')).toBe(3);
    expect(unseenCount(items, '')).toBe(3);
  });

  it('holds at zero for an empty list', () => {
    expect(unseenCount([], null)).toBe(0);
    expect(unseenCount([], 'c')).toBe(0);
  });
});

describe('ANNOUNCEMENTS', () => {
  it('is newest first, which is what unseenCount assumes', () => {
    const dates = ANNOUNCEMENTS.map((a) => a.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('has unique ids, because "seen" is remembered by one', () => {
    expect(new Set(ANNOUNCEMENTS.map((a) => a.id)).size).toBe(ANNOUNCEMENTS.length);
  });

  /* Since 2026-11-07 the notes are the releases marked to announce
     (releases.ts). A changed id would light the dot again for every reader who
     had already seen the note, so the ids shown before are kept word for word.
     Since 2026-11-11 (PS-16) 1.0.0, 2026-11-05-chat-edits-reports and
     2026-11-07-settings-account-ocr are no longer announced. A reader who saw
     a newer note keeps its id and notices nothing; one whose last seen id is
     one of those three now finds it gone, so unseenCount shows every announced
     note as unseen, the smaller failure it chooses over showing nothing. Such a
     reader had newer notes waiting already (1.2.0 onwards), so the cost is the
     older notes counted again, once. */
  it('keeps the ids readers have already seen', () => {
    const ids = ANNOUNCEMENTS.map((a) => a.id);
    expect(ids).toContain('2026-09-09-open-source-live');
    expect(ids).toContain('2026-11-10-full-audit');
  });
});
