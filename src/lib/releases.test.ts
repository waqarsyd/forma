/**
 * The release notes (2026-11-07): the rules the data must keep, since the page,
 * the feed, the in-app What's new and the landing dock all read it, and the
 * functions that filter it, group it and write its Atom feed.
 */
import { describe, it, expect } from 'vitest';
import {
  AREAS,
  atomFeed,
  changesByKind,
  filterFromSearch,
  filterReleases,
  KINDS,
  readableDate,
  RELEASES,
  releasesByMonth,
  searchForFilter,
  type Release,
} from './releases';

describe('RELEASES', () => {
  it('is newest first, which the page, the feed and the dock assume', () => {
    const dates = RELEASES.map((r) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  /* An id is an anchor others link to, the feed's entry id, and what "seen"
     is remembered by: it must be unique and look like a slug. */
  it('has unique slug ids and ISO dates', () => {
    expect(new Set(RELEASES.map((r) => r.id)).size).toBe(RELEASES.length);
    for (const r of RELEASES) {
      expect(r.id).toMatch(/^[a-z0-9-]+$/);
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(r.date))).toBe(false);
    }
  });

  it('gives every release a title, a summary and at least one change of a known kind and area', () => {
    for (const r of RELEASES) {
      expect(r.title.trim()).not.toBe('');
      expect(r.summary.trim()).not.toBe('');
      expect(r.changes.length).toBeGreaterThan(0);
      for (const c of r.changes) {
        expect(KINDS).toContain(c.kind);
        expect(AREAS).toContain(c.area);
        expect(c.text.trim()).not.toBe('');
      }
    }
  });

  it('carries the 1.0.0 release with its version, as its GitHub release does', () => {
    expect(RELEASES.find((r) => r.version === '1.0.0')?.id).toBe('2026-10-28-version-1-0-0');
  });
});

const sample: Release[] = [
  {
    id: 'b',
    date: '2026-11-07',
    title: 'B',
    summary: 'Second.',
    changes: [
      { kind: 'fixed', area: 'preview', text: 'A fix' },
      { kind: 'new', area: 'chat', text: 'A <new> thing & more' },
    ],
  },
  { id: 'a', date: '2026-10-28', version: '1.0.0', title: 'A', summary: 'First.', changes: [{ kind: 'new', area: 'site', text: 'Hello' }] },
];

describe('changesByKind', () => {
  it('groups in the order New, Improved, Changed, Fixed, Removed, Security, leaving out empty kinds', () => {
    expect(changesByKind(sample[0]).map((g) => g.kind)).toEqual(['new', 'fixed']);
  });
});

describe('filterReleases', () => {
  it('returns everything for no filter', () => {
    expect(filterReleases(sample, { kind: null, area: null })).toHaveLength(2);
  });

  it('keeps only matching changes, and leaves out a release left with none', () => {
    const fixed = filterReleases(sample, { kind: 'fixed', area: null });
    expect(fixed.map((r) => r.id)).toEqual(['b']);
    expect(fixed[0].changes.map((c) => c.text)).toEqual(['A fix']);
    expect(filterReleases(sample, { kind: 'new', area: 'site' }).map((r) => r.id)).toEqual(['a']);
    expect(filterReleases(sample, { kind: 'security', area: null })).toEqual([]);
  });

  it('does not change the list it was given', () => {
    filterReleases(sample, { kind: 'fixed', area: null });
    expect(sample[0].changes).toHaveLength(2);
  });
});

describe('the filter in the address', () => {
  it('round-trips through the query string', () => {
    expect(searchForFilter({ kind: 'fixed', area: 'preview' })).toBe('?kind=fixed&area=preview');
    expect(filterFromSearch('?kind=fixed&area=preview')).toEqual({ kind: 'fixed', area: 'preview' });
    expect(searchForFilter({ kind: null, area: null })).toBe('');
  });

  it('ignores what it does not know', () => {
    expect(filterFromSearch('?kind=bogus&area=nowhere')).toEqual({ kind: null, area: null });
    expect(filterFromSearch('')).toEqual({ kind: null, area: null });
  });
});

describe('releasesByMonth and readableDate', () => {
  it('groups by month, newest first, with a name', () => {
    expect(releasesByMonth(sample, 'en-GB').map((m) => [m.id, m.label, m.releases.length])).toEqual([
      ['2026-11', 'November 2026', 1],
      ['2026-10', 'October 2026', 1],
    ]);
  });

  it("writes a date as the reader's language does, on the day it names (site audit item 104)", () => {
    expect(readableDate('2026-11-07', 'en-GB')).toBe('7 November 2026');
    expect(readableDate('2026-11-07', 'en-US')).toBe('November 7, 2026');
    expect(readableDate('2026-11-07', 'de-DE')).toBe('7. November 2026');
    expect(releasesByMonth(sample, 'fr-FR')[0].label).toBe('novembre 2026');
    // The day named, wherever the reader is: read in UTC.
    expect(readableDate('2026-01-01', 'en-GB')).toBe('1 January 2026');
  });
});

describe('atomFeed', () => {
  const xml = atomFeed(sample, 'https://example.test');

  it('is an Atom feed with the page, itself and the newest date', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml).toContain('<id>https://example.test/changelog</id>');
    expect(xml).toContain('<link rel="self" type="application/atom+xml" href="https://example.test/changelog.xml"/>');
    expect(xml).toContain('<updated>2026-11-07T00:00:00Z</updated>');
  });

  it('writes an entry per release, linked to its anchor, with the version in the title', () => {
    expect(xml.match(/<entry>/g)).toHaveLength(2);
    expect(xml).toContain('<id>https://example.test/changelog#b</id>');
    expect(xml).toContain('<title>A (1.0.0)</title>');
  });

  it('escapes what it carries, so a change cannot break the XML', () => {
    expect(xml).not.toContain('<new>');
    expect(xml).toContain('A &amp;lt;new&amp;gt; thing &amp;amp; more');
  });

  it('is written for the real releases too', () => {
    expect(atomFeed(RELEASES).match(/<entry>/g)).toHaveLength(RELEASES.length);
  });
});
