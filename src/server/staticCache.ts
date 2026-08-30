/**
 * `Cache-Control` for the files `npm start` serves out of `dist/`.
 *
 * Express's `express.static` sends `public, max-age=0` when given no options,
 * which is what this server did until 2026-08-30. That is not a neutral
 * default: it means every asset is revalidated on every load. The ETag saves
 * the bytes -- the reply is a 304 -- but not the round trip, and the round
 * trips are serialised behind the document, so a repeat visit pays a full
 * latency stack before anything renders. Measured against the production build,
 * a cold load of `/` is 12 requests; with `max-age=0` a warm load is still 12.
 *
 * Two classes of file live in `dist/`, and they want opposite answers.
 *
 * **Vite's `assets/` output is content-hashed** -- `index-liqdgv4K.js`, and the
 * hash changes whenever the bytes do. A given URL can therefore never have
 * different content, which is exactly the condition `immutable` describes.
 * Google's own font CDN serves its files this way and that is visible in the
 * network log next to ours: `max-age=31536000` on theirs, `max-age=0` on ours.
 *
 * **Everything copied verbatim from `public/` is not hashed** -- `favicon.png`,
 * `og-card.png`, the logos. Their URLs are stable by design, because the OG card
 * is referenced by absolute path from `index.html` and scrapers cache it. Give
 * those a long max-age and replacing a logo would not reach anyone who had
 * already loaded it, with no way to force it short of renaming the file. They
 * get revalidation instead, which is what they had.
 *
 * `index.html` is the one that must never be cached hard: it carries the
 * `<script src>` naming the current hashed bundle, so a stale copy pins a
 * visitor to an old deploy indefinitely. `no-cache` does not mean "do not
 * store" -- it means "store, but revalidate before reuse", which is precisely
 * right here.
 */

/** One year. The conventional `immutable` max-age; longer is not honoured. */
const ONE_YEAR = 31536000;

export const IMMUTABLE = `public, max-age=${ONE_YEAR}, immutable`;
export const REVALIDATE = 'no-cache';

/**
 * Is this a build artifact whose name changes with its content?
 *
 * Matches Vite's default output layout: `dist/assets/<name>-<hash>.<ext>`. The
 * hash is checked for rather than the directory alone, so a file dropped into
 * `public/assets/` by hand -- which lands in `dist/assets/` unhashed -- is not
 * mistaken for one and cached for a year.
 */
export function isContentHashed(filePath: string): boolean {
  const normalised = filePath.replace(/\\/g, '/');
  if (!normalised.includes('/assets/')) return false;

  const name = normalised.slice(normalised.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  const base = name.slice(0, dot);

  /*
   * Vite's hash is the LAST 8 characters of the base name, preceded by '-'.
   *
   * Taking the text after the last '-' instead looks equivalent and is not:
   * the alphabet is base64url, so a hash can contain '-' itself. This build
   * produced `index-BEAO-BqI.js`, where the hash is `BEAO-BqI` and everything
   * after the last '-' is the three characters `BqI`.
   */
  const HASH_LEN = 8;
  if (base.length < HASH_LEN + 1) return false;
  if (base[base.length - HASH_LEN - 1] !== '-') return false;
  const hash = base.slice(-HASH_LEN);
  if (!/^[A-Za-z0-9_-]+$/.test(hash)) return false;

  /*
   * ...and it must not be a word. `open-in-designer.svg` ends in eight
   * base64url-legal characters and is a filename someone writes by hand;
   * caching it for a year would be unfixable without renaming it. A real hash
   * is effectively random over 64 symbols, so the chance of one being entirely
   * lowercase letters is (26/64)^8, about three in ten thousand -- worth
   * trading for never mistaking an English word.
   */
  return /[A-Z0-9_-]/.test(hash);
}

/**
 * The header value for one file. Pure, so `server.ts` keeps only the wiring --
 * the same reason `securityHeaders.ts` exists as its own module.
 */
export function cacheControlFor(filePath: string): string {
  return isContentHashed(filePath) ? IMMUTABLE : REVALIDATE;
}
