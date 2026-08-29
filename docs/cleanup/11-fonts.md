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
it is a design decision, not a pure defect fix, and it was put to the repository owner
with a rendered before/after rather than applied on my own judgement.

## 11.5b Applied, 2026-08-29

**Approved after visual review and applied.** `index.html`'s font request is now:

```
family=Hanken+Grotesk:wght@700;800
family=Inter:wght@400;500;600;700;800
family=JetBrains+Mono:wght@400;500;600;700
```

Verified against the shipped production build across all seven routes:

```
/  /features  /docs  /contact  /login  /terms  /workspace
    → 0 element(s) in an undeclared weight, on every one
```

And the declared set is now exactly the painted set — no dead declarations, no synthesis:

```
  Hanken Grotesk  700  loaded  painted on  77      Inter 700  loaded  painted on  13
  Hanken Grotesk  800  loaded  painted on  65      Inter 800  loaded  painted on   2
  Inter           400  loaded  painted on 404      JBM   400  loaded  painted on 467
  Inter           500  loaded  painted on  15      JBM   500  loaded  painted on 348
  Inter           600  loaded  painted on  77      JBM   600  loaded  painted on  14
                                                   JBM   700  loaded  painted on   6
```

Every face fetched is used; every weight painted is declared. Gates green throughout:
lint, unused sweep, encoding at 130 files, quarantine, 409 unit tests in 25 files, build,
and the bundle budget.

`docs/notes/styling.md` carries the rule going forward, and `index.html` carries it at the
point of use: **do not add a weight without checking something paints it, and do not
remove one without checking nothing does** — neither question can be answered by reading
source.

### What the before/after actually showed

The visual review changed the argument. The expected difference was weight; the more
consequential one is **width**. Synthetic bold thickens each stem, which adds advance
width the designer never drew — in the `/docs` capture, the faux-bold sentence overflows
a crop that the real Inter Bold fits inside. So this was never only a question of texture:
the synthetic faces were also pushing line breaks around.

### A correction about the measurement itself

The first two attempts at those crops produced **blank images**, and a hash comparison run
on them reported one pair as "byte-identical" — which was two empty regions compared
against each other, and meant nothing. `Page.captureScreenshot`'s `clip` is measured in
page coordinates while `getBoundingClientRect()` returns viewport coordinates, and
overriding `deviceScaleFactor` shifted the space again. Once fixed, **all four pairs
differ.** Recorded because a measurement that silently returns nothing looks exactly like
a measurement that found nothing.

## 11.5c Runtime verification, 2026-08-29

The measurement in §11.1 and the check in §11.5b both ran against the **production**
build. The app is also served a second way — `npm run dev` runs `tsx server.ts` with Vite
in middleware mode, which transforms modules on the fly rather than serving `dist/`. A
font change that held in one and not the other would be a real trap, so both were run.

Ten routes on each: `/`, `/features`, `/docs`, `/contact`, `/login`, `/signup`, `/terms`,
`/privacy`, `/workspace`, and an unrouted path.

| | Dev server | Production server |
|---|---|---|
| Elements in an undeclared weight | **0 on every route** | **0 on every route** |
| Faces loaded per route | 7–10 (subsets vary with content) | 7–10, identical |
| `<link rel="icon">` | `/favicon.png` | `/favicon.png` |
| DOM nodes under `#root` | 137–980 | **identical, route for route** |
| Rendered text length | 364–16,173 chars | **identical, route for route** |
| Console errors / uncaught exceptions | none | none |
| HTTP ≥ 400 | none | none |

Identical node counts and text lengths across the two servers is the useful part: it says
the Vite-transformed and the bundled output render the same thing, so the weight
declarations are not being resolved differently by the two pipelines.

Also confirmed from the network log — the request that goes out is the corrected one:

```
https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@700;800
  &family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700
```

and it pulls exactly three files from `fonts.gstatic.com` — one per family, as §11.3
established it must.

### Two findings that look like failures and are not

Both are recorded because the next person to run this check will see them.

1. **The first dev-server load of `/` rendered nothing** — 0 nodes, 0 text, 20 seconds.
   That is Vite re-optimising dependencies, which it does after `vite.config.ts` changes;
   the log line is `[vite] (client) Re-optimizing dependencies because vite config has
   changed`. Warm, the same route renders 828 nodes in 2.5 s. **A cold dev server is not
   a broken one** — the same trap `CLAUDE.md` already records for a cold Vitest cache.
2. **`net::ERR_CONNECTION_REFUSED` on `/workspace`.** Traced to the URL rather than
   assumed: `http://127.0.0.1:7317/health`, which is `designerBridge.ts` feature-detecting
   RepxDesigner. It is not running, so the probe is refused and the **Open in designer**
   button stays disabled — which is the designed behaviour, verified visually. The other
   abort in that log is Firestore's realtime channel closing on navigation.

The reduced-motion console warnings appear only under the dev server, because `motion`
strips them from its production build. They are this machine's Windows setting, not the
application.

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
