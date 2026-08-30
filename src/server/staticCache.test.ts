/**
 * The caching split is a correctness question, not a tuning one: cache the
 * wrong file for a year and there is no way to reach the people holding it.
 *
 * So what is pinned here is mainly the NEGATIVE case -- that unhashed files,
 * and `index.html` above all, never get `immutable`. A visitor holding a stale
 * `index.html` is pinned to whichever hashed bundle it names, which is a deploy
 * that can never land.
 */
import { describe, it, expect } from 'vitest';
import { cacheControlFor, isContentHashed, IMMUTABLE, REVALIDATE } from './staticCache';

describe('isContentHashed', () => {
  it('recognises Vite hashed output', () => {
    for (const p of [
      'dist/assets/index-liqdgv4K.js',
      'dist/assets/index-DkcSu9Sh.css',
      'dist/assets/pdf.worker-CliDBb4N.mjs',
      'dist/assets/Markdown-DaFLE01V.js',
    ]) {
      expect(isContentHashed(p)).toBe(true);
    }
  });

  it('accepts Windows separators, since that is where this runs', () => {
    expect(isContentHashed('E:\\repo\\dist\\assets\\index-liqdgv4K.js')).toBe(true);
  });

  it('rejects everything copied verbatim out of public/', () => {
    for (const p of [
      'dist/index.html',
      'dist/favicon.png',
      'dist/og-card.png',
      'dist/logo_white.webp',
      'dist/robots.txt',
    ]) {
      expect(isContentHashed(p)).toBe(false);
    }
  });

  it('does not treat an unhashed file under assets/ as hashed', () => {
    // A file placed in public/assets/ by hand lands in dist/assets/ with its
    // name intact. Caching that for a year would be unfixable without a rename.
    expect(isContentHashed('dist/assets/brochure.pdf')).toBe(false);
    expect(isContentHashed('dist/assets/logo.svg')).toBe(false);
  });

  it('does not mistake a hyphenated word for a hash', () => {
    // Eight base64url-legal characters after a '-', and a filename a person
    // actually writes. The first version of isContentHashed cached this for a
    // year, which is the one mistake here with no way back short of a rename.
    expect(isContentHashed('dist/assets/open-in-designer.svg')).toBe(false);
    expect(isContentHashed('dist/assets/hero-fallback.png')).toBe(false);
  });

  it('handles a hash that contains a hyphen', () => {
    // Real output from this build. The alphabet is base64url, so '-' is a legal
    // hash character: reading the text after the LAST '-' yields `BqI` and
    // wrongly rejects it. The hash is the last eight characters, not the last
    // segment.
    expect(isContentHashed('dist/assets/index-BEAO-BqI.js')).toBe(true);
  });
});

describe('cacheControlFor', () => {
  it('caches hashed bundles for a year and marks them immutable', () => {
    expect(cacheControlFor('dist/assets/index-liqdgv4K.js')).toBe(IMMUTABLE);
    expect(IMMUTABLE).toContain('immutable');
    expect(IMMUTABLE).toContain('31536000');
  });

  it('never lets index.html be cached hard', () => {
    // The one that pins a visitor to a dead deploy.
    expect(cacheControlFor('dist/index.html')).toBe(REVALIDATE);
    expect(cacheControlFor('dist/index.html')).not.toContain('immutable');
    expect(cacheControlFor('dist/index.html')).not.toMatch(/max-age=[1-9]/);
  });

  it('keeps the OG card and favicon revalidating, since their URLs are stable', () => {
    // Scrapers hold onto og-card.png by absolute path; a year of immutable
    // would make replacing it impossible without renaming.
    expect(cacheControlFor('dist/og-card.png')).toBe(REVALIDATE);
    expect(cacheControlFor('dist/favicon.png')).toBe(REVALIDATE);
  });

  it('answers with one of exactly two values', () => {
    for (const p of ['dist/index.html', 'dist/assets/index-liqdgv4K.js', 'dist/logo.png']) {
      expect([IMMUTABLE, REVALIDATE]).toContain(cacheControlFor(p));
    }
  });
});
