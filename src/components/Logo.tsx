/**
 * The Forma mark. Single owner of the logo asset, its intrinsic size, and the
 * light/dark variant — replacing twelve inline <img> tags that each hardcoded a
 * ~700-character `lh3.googleusercontent.com/aida-public/...` URL.
 *
 * Three things here are load-bearing:
 *
 * 1. **Local assets, not a CDN.** The old URL was an AI Studio-hosted asset the
 *    project does not own and cannot re-issue. With that host unreachable —
 *    offline, LAN-only, or egress-filtered — every logo in the app rendered as a
 *    broken image. `public/logo.png` ships in the repo and is already the
 *    favicon in `index.html`.
 *
 * 2. **`width`/`height` are always set.** The old tags used `h-8 w-auto` with no
 *    intrinsic size, so until the image arrived the box collapsed to the width
 *    of its alt text — 106px instead of 32px — and the brand text beside it
 *    visibly snapped left once the image loaded. Declaring both dimensions
 *    reserves the box up front. Do not remove them.
 *
 * 3. **Dark mode swaps the file, and it must key off the `dark` class.** The app
 *    toggles `.dark` on `document.documentElement` (see App.tsx) rather than
 *    following the OS, so selecting the variant with a `prefers-color-scheme`
 *    media query would ignore the in-app theme switch and show the wrong mark.
 *    Both variants are rendered and Tailwind's `dark:` variant picks one — a
 *    swap of `src` in an effect would flash the wrong logo on first paint.
 *
 * 4. **WebP with a PNG fallback.** `<source type="image/webp">` is offered first
 *    and the `<img src="....png">` is what any browser without WebP support
 *    actually loads — the `<img>` is not decoration, it is the fallback, so do
 *    not collapse this back to a bare `<img>` pointing at the .webp. There is no
 *    vector source for this mark (it is shaded/gradient artwork that was only
 *    ever raster), so WebP is the end of the line for size: 84 KB of PNG became
 *    ~18 KB. The alpha channel round-trips exactly; the lossy step touches only
 *    RGB, and measurably not on any visible pixel.
 *
 * `index.html` keeps the PNG for the favicon deliberately — broadest support for
 * the one request that happens before any of this code runs.
 */

interface LogoProps {
  /** Rendered edge length in px. The mark is square. */
  size?: number;
  /** Extra classes for the wrapper — layout only; sizing comes from `size`. */
  className?: string;
  /**
   * Screen-reader text. Defaults to empty: nearly every placement sits directly
   * beside the visible word "Forma", where announcing "Forma Logo" is redundant.
   * Pass one explicitly where the mark stands alone.
   */
  alt?: string;
}

export default function Logo({ size = 32, className = '', alt = '' }: LogoProps) {
  const imgProps = {
    width: size,
    height: size,
    alt,
    // Decorative by default; a non-empty alt makes it meaningful again.
    'aria-hidden': alt ? undefined : true,
    decoding: 'async' as const,
    className: 'block',
    style: { width: size, height: size },
  };

  return (
    <span className={`inline-flex shrink-0 ${className}`} style={{ width: size, height: size }}>
      <picture className="block dark:hidden">
        <source srcSet="/logo.webp" type="image/webp" />
        <img {...imgProps} src="/logo.png" />
      </picture>
      <picture className="hidden dark:block">
        <source srcSet="/logo_white.webp" type="image/webp" />
        <img {...imgProps} src="/logo_white.png" />
      </picture>
    </span>
  );
}
