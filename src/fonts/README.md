# Fonts

The three typefaces this app renders in, self-hosted since 2026-08-30 (audit
PERF-002). They came from `fonts.googleapis.com` before that; see the
**typefaces** block at the top of [`../index.css`](../index.css) for why they
moved and what the `unicode-range` and weight values mean.

## What is here

| File | Family | Weights | Subset | Bytes |
|---|---|---|---|---|
| `hanken-grotesk-latin.woff2` | Hanken Grotesk | 700–800 | latin | 34,704 |
| `hanken-grotesk-latin-ext.woff2` | Hanken Grotesk | 700–800 | latin-ext | 19,588 |
| `inter-latin.woff2` | Inter | 400–800 | latin | 48,256 |
| `inter-latin-ext.woff2` | Inter | 400–800 | latin-ext | 85,068 |
| `jetbrains-mono-latin.woff2` | JetBrains Mono | 400–700 | latin | 31,432 |
| `jetbrains-mono-latin-ext.woff2` | JetBrains Mono | 400–700 | latin-ext | 11,624 |

Each is a **variable** font spanning its weight axis, not a static instance —
one file covers every weight in the range. `unicode-range` in the `@font-face`
rules means a browser fetches `latin-ext` only when a page actually contains a
character from it, so a typical English page still downloads three files, the
same three it downloaded from Google before.

These are referenced from `../index.css` rather than sitting in `public/`, so
Vite fingerprints them into `dist/assets/`. That is what earns them
`Cache-Control: immutable` from `src/server/staticCache.ts`; anything in
`public/` is unhashed and gets `no-cache` instead.

## Licence

All three are under the **SIL Open Font License 1.1**, whose full text is in
`OFL-inter.txt`, `OFL-jetbrainsmono.txt` and `OFL-hankengrotesk.txt`. The OFL
requires that the copyright notice and licence travel with the font files, which
is why those files are here and not summarised away.

- Inter — Copyright 2020 The Inter Project Authors, <https://github.com/rsms/inter>
- JetBrains Mono — Copyright 2020 The JetBrains Mono Project Authors, <https://github.com/JetBrains/JetBrainsMono>
- Hanken Grotesk — Copyright 2021 The Hanken Grotesk Project Authors, <https://github.com/marcologous/hanken-grotesk>

The OFL is separate from and unaffected by this project's Apache-2.0 licence:
the fonts stay under the OFL, the code stays under Apache-2.0. This is the one
place in the repository where a second licence applies, which is why it is
stated here rather than only in the root `LICENSE`.

## Refreshing them

Request **weight ranges**, not a discrete weight list — a range is what makes
Google return a variable face. The discrete list this project uses returns 67
static faces instead of 6:

```
https://fonts.googleapis.com/css2
  ?family=Hanken+Grotesk:wght@700..800
  &family=Inter:wght@400..800
  &family=JetBrains+Mono:wght@400..700
  &display=swap
```

Fetch that with a current desktop browser User-Agent (an old or absent one gets
you `ttf`, not `woff2`), keep the `latin` and `latin-ext` blocks, download the
`.woff2` each names, and replace both the files here and the matching
`@font-face` rules in `../index.css` — the `unicode-range` values come from that
same response and must be copied across with them.
