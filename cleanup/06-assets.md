# Phase 6 - Assets and media

Date: 2026-08-28
Branch: `chore/cleanup`

**SAFE 0 / UNSURE 2 / KEEP 5.** Nothing moved. Phase 6's rule is that unreferenced
assets get quarantined but merely *unoptimized* ones get a report and an approval first,
because conversion is an edit and can affect visual quality. Both live candidates here
turn out to need a decision rather than an action, for a reason worth stating up front:

> **Optimizing a tracked image makes this repository bigger, not smaller.** The
> optimized file is a new blob; the old one stays in history. Phase 2 established the
> history is essentially all live, so there is nothing to reclaim by rewriting it.

---

## 6.1 The complete asset inventory

Seven tracked binaries. That is the entire media surface of this project.

| File | Dimensions | Bytes | Referenced by |
|---|---|---|---|
| `assets/source/logo_white.png` | 2048×2048 | **2,984,020** | **nothing in code** |
| `assets/source/logo.png` | 659×659 | **295,261** | **nothing in code** |
| `public/og-card.png` | 1200×630 | 98,684 | `index.html` (`og:image`, `twitter:image`) |
| `public/logo_white.png` | 256×256 | 46,452 | `Logo.tsx` (`<picture>` fallback) |
| `public/logo.png` | 256×256 | 38,075 | `Logo.tsx` fallback, **`index.html` favicon**, `og-card.html` |
| `public/logo_white.webp` | - | 9,506 | `Logo.tsx` (`<source>`) |
| `public/logo.webp` | - | 8,374 | `Logo.tsx` (`<source>`) |
| **total tracked media** | | **3,480,372** | |

No untracked media anywhere outside `node_modules`, `dist`, `.git`, `.antigravity` and
`tools`. No videos, no PDFs, no JSON data files beyond configuration, and **no SVG files
at all** - the icon set is inline JSX in `src/components/landing/icons.tsx`, so the
"uncompressed SVGs with editor metadata" check has nothing to examine.

`assets/source/logo_white.png` alone is **52% of everything tracked in this repository**,
and the two masters together are **58%**.

## 6.2 Unreferenced assets

Only the two masters, and only in the sense that no *code* path reaches them:

```
$ git grep -n 'assets/source/logo'
docs/notes/styling.md:61   (prose: "The full-resolution originals (659px and 2048px)
                            are preserved in assets/source/, which is outside public/
                            on purpose")
```

Note what does **not** reference them: `assets/source/og-card.html`, the page the OG
card is rendered from, points at `../../public/logo.png` - the *shipped* 256px file, not
either master. So nothing in the card-generation workflow depends on them either.

They are an archive: deliberately kept, deliberately outside `public/` so Vite does not
copy 3 MB of unused PNG into `dist/`, and documented as such. Whether an archive belongs
in the working tree is a decision, not a finding - see §6.5.

## 6.3 The favicon is a 38 KB, 256×256 PNG

`index.html:7`:

```html
<link rel="icon" type="image/png" href="/logo.png" />
```

That is **38,075 bytes at 256×256**, fetched on the first load of every visit, to be
drawn by the browser at 16 or 32 CSS pixels in a tab strip.

`docs/notes/styling.md` records the reasoning - "broadest support for the one request
that happens before any component code runs" - and the *format* choice is right. PNG is
correct for a favicon; WebP favicons are still patchy. The problem is the **dimensions**,
which are inherited rather than chosen: `/logo.png` was already in the repo as the
`<picture>` fallback, so it got reused.

Measured by generating downscales from the same source:

| Favicon size | Bytes | vs the current 38,075 B |
|---|---|---|
| 16×16 | 634 | 1.7% |
| **32×32** | **1,406** | **3.7%** |
| 48×48 | 2,423 | 6.4% |
| 64×64 | 3,589 | 9.4% |
| 128×128 | 10,937 | 28.7% |

**A 32×32 favicon saves ~36.7 KB on every cold page load** - which is 34% more than the
entire 604-byte CSS saving Phase 4 produced, on a single asset.

**Why `public/logo.png` cannot simply be shrunk instead:** it has three jobs. It is the
favicon, it is the `<picture>` fallback in `Logo.tsx` (rendered at `size` up to 46 px,
so ~92 px on a retina display, plus a `fill` mode that scales with its column), and it
is the image `assets/source/og-card.html` composites into the 1200×630 card. Shrinking
it to 32 px would degrade the other two. The fix is a **separate** favicon file, which
means adding an asset - an edit, so it needs approval.

## 6.4 The masters are unoptimized, and fixing that would grow the repo

`assets/source/logo_white.png` is 2048×2048 in `Format32bppArgb` at **2,984,020 bytes** -
roughly 0.71 bytes per pixel for a flat two-colour mark, which is very high.

Re-encoded at identical dimensions and identical bit depth, with no resampling and no
quality loss whatsoever, using nothing more sophisticated than .NET's own PNG encoder:

```
before:  2,984,020 B
after:   1,981,386 B      -33.6%, and a dedicated optimizer (oxipng, pngquant)
                          would do considerably better
```

So **one megabyte of that file is encoder waste**, not image data.

**And re-encoding it would make the repository larger.** The 1.98 MB optimized blob would
be added; the 2.98 MB original stays reachable from history forever. A clone would carry
**both**. The working tree would shrink by 1 MB and the clone would grow by 1.98 MB.

The same arithmetic applies to quarantining them, only more cleanly: moving the masters
out shrinks the *checkout* by 3.28 MB and the *clone* by **exactly zero**.

There is no version of this that reclaims space from a clone short of a history rewrite,
and Phase 2 already settled that question - only 8 paths have ever been added and
removed across 119 commits, and the two junk-shaped ones share blobs with files still
reachable from HEAD.

## 6.5 UNSURE - two decisions (2)

### 1. The masters in `assets/source/`

| Option | Checkout | Clone | Loses |
|---|---|---|---|
| Keep as-is | 3.28 MB | 3.28 MB | nothing |
| Quarantine | −3.28 MB | unchanged | masters absent from a fresh clone; recoverable via `git checkout <commit> -- <path>` |
| Re-encode in place | −1 MB | **+1.98 MB** | nothing visually; costs clone size |

**My recommendation: keep them.** For an open-source project the full-resolution masters
are the thing a fork needs in order to regenerate `public/` at other sizes or produce a
new OG card, and 3.28 MB in a 4.3 MiB pack is a proportion that sounds alarming and
costs about one second of clone time once. Quarantining buys working-tree tidiness this
repository does not need, and re-encoding actively costs more than it saves.

**The one thing I would change if you want the size back:** it belongs in Phase 8's
territory, not here - and Phase 8's answer is already no.

### 2. The favicon

Add `public/favicon.png` at 32×32 (1,406 B) and point `index.html` at it, leaving
`public/logo.png` untouched for its other two roles.

- Cost: one new 1.4 KB asset, one changed line in `index.html`, one line in
  `README.md`'s project-structure block (it names `public/` contents), and a sentence in
  `docs/notes/styling.md`, which currently explains the favicon choice and would
  otherwise become wrong.
- Benefit: **−36.7 KB on every cold page load.**
- Risk: low, but it is a visual asset - the 32×32 downscale should be looked at before
  it ships, because a mark that reads well at 256 px can turn to mud at 32.

**My recommendation: do it**, but look at the generated file first. This is the largest
single measured saving the whole cleanup has produced.

## 6.6 KEEP (5)

| Asset | Why |
|---|---|
| `public/logo.png` / `logo_white.png` | Live `<picture>` fallbacks, and the PNG half of a correct WebP-with-fallback pattern. 256×256 is generous but justified: `Logo` renders up to 46 px, doubled for retina, plus a `fill` mode that scales with its container. |
| `public/logo.webp` / `logo_white.webp` | The modern path; 8.4 KB and 9.5 KB, already 78% smaller than their PNG twins. Nothing to improve. |
| `public/og-card.png` | 98,684 B at 1200×630, fetched by link-preview scrapers rather than by visitors, so it costs nothing on a normal page load. PNG is the safe format here - several scrapers still do not handle WebP. Pre-rendered by hand from `assets/source/og-card.html`, not by a build step. |

## 6.7 Fonts - reported, not actionable without measurement

`index.html:89` loads **three families and eleven weights** from Google Fonts:

```
Hanken Grotesk:  400 500 600 700 800     (5 weights)
Inter:           400 500 600             (3 weights)
JetBrains Mono:  400 500 600             (3 weights)
```

All three families are genuinely used - `src/index.css` maps `--font-display-lg`,
`--font-headline-lg` and `--font-title-md` to Hanken Grotesk, `--font-body-lg` /
`--font-body-sm` / `--font-sans` to Inter, and `--font-code-sm` / `--font-label-caps` /
`--font-mono` to JetBrains Mono.

All five weight values are used somewhere too: `font-medium` appears 67 times in `src/`,
`font-semibold` 65, `font-bold` 43, `font-extrabold` 18, plus explicit `font-weight: 500`
through `800` declarations in the two stylesheets.

**What I cannot determine statically is the family/weight *combination*.** Tailwind's
`font-bold` applies 700 to whichever family is in effect at that element; if that element
is Inter, the browser needs Inter 700, which is **not** in the loaded set. It would
synthesise instead. Deciding which of the eleven weights is genuinely fetched requires
loading the built page and reading the network panel, not reading the source.

Each Google Fonts weight is a separate woff2 of roughly 15-25 KB, so the eleven together
are on the order of 150-250 KB - larger than every image on the site combined. **This is
the biggest remaining asset question and it deserves a measurement rather than a guess.**
Recorded as a follow-up; no change made.

An icon *font* was already removed here for exactly this class of waste - `src/index.css`
still carries the note, at the site of the rule deleted in audit PERF-002: Material
Symbols was loaded from Google for five glyphs, three of which already existed as inline
SVG.

## 6.8 Not applicable

| Check | Why |
|---|---|
| Unused SVG / editor metadata | No `.svg` files exist; icons are inline JSX. |
| Icon fonts, whole icon libraries | None. Already removed (PERF-002). |
| Responsive image variants | The only raster in the layout is a logo rendered at ≤46 CSS px; `srcset` by width would be over-engineering. The WebP/PNG `<source>` pair is the variant that matters and it is present. |
| PNGs that should be SVGs | The mark has no vector source in this repository - `docs/notes/styling.md` records that this is why `LogoPulse` animates *around* the logo rather than animating anything inside it. Converting would mean redrawing it, which is design work, not cleanup. |
| Media belonging in object storage | Only the two masters, at 3.28 MB. Covered in §6.5; moving them to storage has the same zero effect on clone size. |
