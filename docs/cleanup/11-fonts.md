# Follow-up - the font measurement

Date: 2026-08-29
Branch: `main`

Closes the question `docs/cleanup/06-assets.md` §6.7 left open: **which of the eleven
declared font weights does the browser actually fetch?**

**The Phase 6 estimate was wrong in both directions.** It guessed 150–250 KB across
eleven weight files and called it "the largest remaining asset question". The real
figure is **113.6 KB across three files**, and no amount of trimming reduces it. But the
measurement found something Phase 6 never suspected: **22 elements on the marketing pages
are being rendered in a synthetic bold**, because three of the weights the app paints are
weights it never asked for.

---

## 11.1 Method

Two measurements per route, over the Chrome DevTools Protocol against the **production
build** — no dependencies, since Node 24 has a global `WebSocket`:

1. **`document.fonts` after load.** Every `FontFace` the stylesheet declared, with its
   status. `loaded` means the browser fetched the file; `unloaded` means it was declared
   and never needed.
2. **Computed style on every element containing visible text**, giving the
   `(family, weight)` pairs the page actually paints.

The first says what was downloaded, the second what was needed. Where they disagree, the
difference is either waste or a defect.

Routes: `/`, `/features`, `/docs`, `/contact`, `/login`, `/terms`, `/workspace`.

This could not have been answered by reading source, which is why §6.7 deferred it:
Tailwind's `font-bold` applies 700 to *whichever family is in effect at that element*, so
the family/weight pairing only exists at render time.

## 11.2 What is declared versus what is fetched

```
  Hanken Grotesk     400   unloaded   painted on    0 element(s)
  Hanken Grotesk     500   unloaded   painted on    0 element(s)
  Hanken Grotesk     600   unloaded   painted on    0 element(s)
  Hanken Grotesk     700   loaded     painted on   77 element(s)
  Hanken Grotesk     800   loaded     painted on   74 element(s)
  Inter              400   loaded     painted on  427 element(s)
  Inter              500   loaded     painted on   19 element(s)
  Inter              600   loaded     painted on   79 element(s)
  JetBrains Mono     400   loaded     painted on  475 element(s)
  JetBrains Mono     500   loaded     painted on  356 element(s)
  JetBrains Mono     600   loaded     painted on   14 element(s)
```

**Three declared weights are never used**: Hanken Grotesk 400, 500 and 600. The display
face is only ever painted at 700 and 800.

## 11.3 The size answer: 113.6 KB, and it cannot be trimmed

Only **three files** are downloaded, not eleven:

| File | Bytes |
|---|---|
| `hankengrotesk/v12/…woff2` | 34,704 |
| `inter/v20/…woff2` | 48,256 |
| `jetbrainsmono/v24/…woff2` | 31,432 |
| **total** | **114,392** (111.7 KB) |

Because these are **variable fonts**. Google serves one woff2 per family spanning the
whole weight axis; the `wght@…` list in the URL selects which `@font-face` blocks appear
in the CSS, not which binaries exist.

Four request variants were fetched and their latin woff2 files weighed:

| Variant | latin woff2 | CSS |
|---|---|---|
| **A** current | **116,280 B** | 22.5 KB |
| **B** trim Hanken to 700;800 | **116,280 B** | 17.7 KB |
| **C** trim Hanken **and** declare the synthesised weights | **116,280 B** | 25.0 KB |
| **D** declare the synthesised weights, keep Hanken | **116,280 B** | 29.8 KB |

**Every variant downloads exactly the same 116,280 bytes.** So:

- Removing the three unused Hanken weights saves **zero** font bytes. It saves 4.8 KB of
  uncompressed CSS.
- Adding the three missing weights costs **zero** font bytes. It costs 2.5 KB of
  uncompressed CSS.

*(116,280 B here versus 114,392 B observed in the browser: the live page fetches only the
subsets its content needs, while this variant comparison weighs the full latin file for
each family. The comparison between variants is what matters, and it is exact.)*

## 11.4 The real finding: 22 elements are rendered in a synthetic bold

The painted set contains three pairs that appear in **no** `@font-face` rule:

| Painted | Declared? | Elements |
|---|---|---|
| `Inter 700` | **no** | 14 |
| `JetBrains Mono 700` | **no** | 6 |
| `Inter 800` | **no** | 2 |

When a page asks for a weight the family does not provide, the browser **synthesises**
it — mechanically thickening the regular face. It is legible, but visibly worse than a
real bold: uneven stem widths, counters that fill in at small sizes, and no proper
optical compensation.

Located precisely:

| Route | Faux-bold elements |
|---|---|
| `/` | 5 |
| `/features` | 5 |
| `/docs` | 4 |
| `/login` | 6 |
| `/contact` | 1 |
| `/workspace` | **0** |

And what they are — every one is emphasis inside body copy, which is exactly the text
meant to draw the eye:

```
Inter 700          <b>  "There is no model to choose, and that is deliberate."
Inter 700          <b>  "a forgotten passphrase cannot be recovered"
Inter 700          <b>  "Only you can decrypt the stored key."
Inter 700          <b>  "400 strings per page"
Inter 700     <strong>  "Waqar Sayyed"          ← the byline, on every page
Inter 800        <div>  "INVOICE"               ← the hero scanner figure
JetBrains Mono 700 <b>  "100 / 72"              ← the geometry callouts
JetBrains Mono 700 <b>  "850 × 1100"
```

The `<strong>` byline appears on all five marketing pages. `/workspace` is clean, which
fits: its type comes from `workspace.css`, which sets weights explicitly rather than
through Tailwind's `font-bold`.

The cause is exactly what §6.7 predicted without being able to confirm it: `font-bold`
resolves to 700 against whatever family is in effect, and Inter and JetBrains Mono were
only ever requested up to 600.

## 11.5 Recommendation

**Variant C**, a one-line change to `index.html`:

```
family=Hanken+Grotesk:wght@700;800
family=Inter:wght@400;500;600;700;800
family=JetBrains+Mono:wght@400;500;600;700
```

- **Font bytes: unchanged.** Measured, not assumed — all four variants are 116,280 B.
- **CSS: +2.5 KB uncompressed** (22.5 → 25.0 KB), and that file is served gzipped.
- **Fixes 22 elements** across five pages, including the byline on every one.
- **Removes three declarations that were doing nothing.**

It is a visible change — real bold is heavier and better-formed than synthetic bold — so
it is a design decision, not a pure defect fix, and it is recorded here for a decision
rather than applied.

## 11.6 What this corrects in the earlier record

`docs/cleanup/06-assets.md` §6.7 says the eleven weights are "on the order of 150–250 KB,
larger than every image on the site combined" and calls it the biggest remaining asset
question.

**That was wrong.** The true figure is 113.6 KB, which is *less* than the images
(`og-card.png` alone is 98.7 KB, and the four logo variants add 102.4 KB). The estimate
assumed one file per declared weight, which is how Google Fonts behaved before variable
fonts and is no longer true for any of these three families.

The section's instinct was right — it insisted the question needed a network panel rather
than a guess, and refused to act on the estimate. Had it acted, it would have trimmed
weights to save bytes that were never there, and never noticed the synthetic bold.
