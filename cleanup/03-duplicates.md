# Phase 3 - Duplicates and near-duplicates

Date: 2026-08-28
Branch: `chore/cleanup`

**Nothing was moved and nothing was consolidated.** Phase 3's rule is explicit -
consolidate only after the canonical version is confirmed - so this phase reports and
diffs. **SAFE 0 / UNSURE 0 / KEEP 3**, plus **5 consolidation proposals** awaiting your
decision.

Headline: **exactly one byte-identical pair exists in 215 tracked files, and it is in
vendored code we are not allowed to touch.** The real finding is near-duplication in
`src/`: 30 blocks totalling 373 duplicated lines, of which one cluster is 84% of an
entire function.

---

## 3.1 Byte-identical files

Every tracked file hashed with SHA-256. **One** duplicate group in 215 files:

```
--- 2 copies, 27,107 bytes each ---
     .agents/skills/firebase_firestore/references/enterprise/security_rules.md
     .agents/skills/firebase_firestore/references/standard/security_rules.md
```

**Verdict: KEEP.** This is vendored third-party code - Firebase's official skill packs,
copied verbatim - and ground rule 6 forbids touching vendored directories. Two further
reasons beyond the rule: de-duplicating it diverges the pack from upstream, so the next
refresh silently restores the copy and any symlink or pointer we leave behind becomes
the thing that is wrong; and 27 KB is not worth owning a permanent diff against a
vendor.

For the record, the pack has *many* same-named files across products
(`SKILL.md` × 10, `ios_setup.md` × 7, `flutter_setup.md` × 5, `android_setup.md` × 3).
All of them differ in content. Only this one pair is identical.

## 3.2 Near-duplicate source - the real finding

Detected by longest-shared-run analysis over all 55 non-test source files: maximal runs
of 8 or more consecutive normalized lines appearing in two or more places, with
indentation stripped and blank/comment lines skipped so a reformat cannot manufacture a
match and indentation cannot hide one.

**30 blocks, 373 duplicated lines.** Against 19,068 non-test lines that is about 2%,
which is a low rate and worth saying out loud - this is not a copy-paste codebase. But
the distribution is lumpy, and two of the clusters are the dangerous kind.

### Cluster A - `handleResume` is 84% a copy of `handleGenerate` **(the one that matters)**

| | |
|---|---|
| Location | `src/App.tsx:2442` (`handleResume`, 108 lines) and `src/App.tsx:2595` (`handleGenerate`, 206 lines) |
| Overlap | **91 of `handleResume`'s 108 lines are identical to lines in `handleGenerate`** (`git diff --numstat` on the two extracted bodies: 105 added, 17 removed) |
| Longest single identical run | **30 lines** - the entire `catch (err: any)` block, byte for byte |

The complete list of differences, from the diff. Every one of them is a **log string or
user-facing copy**:

| `handleResume` | `handleGenerate` |
|---|---|
| `console.log("Resuming report generation process...")` | `console.log("Starting report generation process...")` |
| *(absent)* | `console.debug("Included ${n} preview images/files.")` |
| `console.debug('Requesting Gemini API on resume...')` | `console.debug('Sending request to Gemini API...')` |
| *(absent)* | `console.debug("Generated Layout Title: ...")` |
| *(absent)* | `console.debug("Generated REPX length: ...")` |
| `"I've resumed and completed the report layout based on your instructions..."` | `"I've updated the report layout based on your instructions..."` |
| `console.log('Report layout updated successfully on resume.')` | `console.log('Report layout updated successfully.')` |

**Nothing functional differs.** Same `analyzeReportDesign(...)` call with the same
arguments, same `newResult` construction, same assistant-message shape, and an
identical error path.

**Why this is the most important item in the phase.** The 30-line `catch` block is the
error handling for the app's single most important operation - a Gemini generation that
can 404, 429, 503, hang, abort, or return truncated `repxContent`. It exists twice.
`docs/notes/gemini.md` records real incidents in exactly this path. A fix applied to one
copy will pass every gate this project has - `tsc`, all 409 unit tests, all 41 rules
tests, the build - while leaving the resumed-generation path still broken, and the only
way to notice is to pause a generation and resume it.

That is the specific failure Phase 3 warns about: near-duplicates are more dangerous
than exact copies because behaviour drifts. Here it has not drifted **yet**.

### Cluster B - the marketing-page CTA and hero

| Blocks | Locations |
|---|---|
| 27 lines | `FeaturesPage.tsx:968` / `LandingPage.tsx:584` (CTA section) |
| 24 lines | `FeaturesPage.tsx:1009` / `LandingPage.tsx:629` (CTA buttons) |
| 12 lines | `FeaturesPage.tsx:372` / `LandingPage.tsx:196` (hero `<main>` + section open) |
| 9 lines | `FeaturesPage.tsx:394` / `LandingPage.tsx:222` (the underline `<span>`) |

**72 lines.** Diffed: the two CTA sections differ in a wrapper element
(`</RevealGroup>` vs `</div>`) and in the eyebrow, where `LandingPage` carries a comment
explaining that the eyebrow's trailing rule is deliberately suppressed for centred text.
Everything else - the section, the `Logo`, the spacing literals, the button group - is
identical.

Note that comment: a real, load-bearing design decision recorded in **one** of the two
copies. That is how a near-duplicate goes wrong - not by drifting in code, but by the
reasoning living in only one of the places that needs it.

### Cluster C - two focus traps

| | |
|---|---|
| Location | `src/App.tsx:1827` and `src/components/AccountDialog.tsx:116` |
| Overlap | 19 lines, including a **byte-identical** focusable-element selector |

```
'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
```

Both implement the same modal keyboard contract: focus the dialog, Escape closes, Tab
cycles within, focus returns to the opener on unmount. They differ only in local names
(`dialog` vs `node`, `dismissConfigRef` vs `closeRef`) and dependency array
(`[isConfigOpen]` vs `[]`).

**Why it matters:** this is accessibility code, and there is no test for either copy.
The unit suite has no component tests at all. An a11y fix - adding `[contenteditable]`
to the selector, handling shadow roots, respecting `inert` - applied to one dialog
leaves the other subtly broken, and nothing anywhere will say so.

### Cluster D - the shared page shell and its props

| Blocks | What |
|---|---|
| 17 + 15 lines | `LegalPage.tsx:151` / `NotFoundPage.tsx:41` - the same `<div className="landing ...">` + `SheetRuler` + `SiteHeader` page shell |
| ~10 blocks × 8 lines | The `{ onEnterWorkspace, onSignIn, onSignUp, user }` prop signature and its pass-through, repeated across `ContactPage`, `DocsPage`, `FeaturesPage`, `LandingPage`, `LegalPage`, `NotFoundPage` and `SiteHeader` |
| 14 lines × 5 | `App.tsx:2970, 3003, 3019, 3035, 3051` - the identical prop-passing block, once per marketing route |

This is one root cause with three symptoms: **there is no shared type for the marketing
page props and no shared page shell**, so seven components declare the same four props
by hand and `App.tsx` passes them five times.

### Cluster E - CSS and small internal repeats

| Blocks | What |
|---|---|
| 11 lines | `workspace.css:110` / `workspace.css:400` - a 38×38 grid-centred icon button |
| 8 lines | `workspace.css:516` / `workspace.css:1304` - a pill-radius icon button |
| 8 lines | `StepFigures.tsx:50` / `:93` - a repeated `motion.span` caption |

Lowest value of the five. Listed for completeness.

## 3.3 Duplicate assets

### The `public/` logo set is **not** duplication - KEEP

| File | Dimensions | Bytes |
|---|---|---|
| `public/logo.png` | 256×256 | 38,075 |
| `public/logo.webp` | - | 8,374 |
| `public/logo_white.png` | 256×256 | 46,452 |
| `public/logo_white.webp` | - | 9,506 |

Every one of the four is referenced from `src/components/Logo.tsx`, and the png/webp
pairing is a deliberate `<picture>` fallback:

```jsx
<source srcSet="/logo.webp" type="image/webp" />
<img {...imgProps} src="/logo.png" />
```

`public/logo.png` is *also* the favicon (`index.html:7`), which `docs/notes/styling.md`
explains is png rather than webp for "broadest support for the one request that happens
before any component code runs." This is the correct pattern, not the
`ttf + woff + woff2 where only woff2 is served` waste the prompt asks about. **Nothing
to consolidate.**

### The masters in `assets/source/` - reported here, decided in Phase 6

| File | Dimensions | Bytes | Referenced by |
|---|---|---|---|
| `assets/source/logo_white.png` | 2048×2048 | **2,984,020** | nothing in code; explained in `docs/notes/styling.md:61` |
| `assets/source/logo.png` | 659×659 | 295,261 | nothing in code |

`assets/source/logo_white.png` alone is **52% of everything tracked in this repository**.
Two observations:

1. The two masters are at **different resolutions** - 2048 and 659 - so they are not a
   matched pair of originals. One of them has been through a different pipeline.
2. 2,984,020 bytes for a 2048×2048 mark is roughly 0.71 bytes per pixel, which for a
   flat two-colour logo is very large. It is almost certainly an unoptimised RGBA
   export.

**One thing to understand before deciding anything:** moving these to quarantine would
shrink the *checkout* by 3.2 MB and the *clone* by **zero**. The blobs stay in history,
and Phase 2 already established that this repository's history is essentially all live.
Quarantining a master is therefore a working-tree tidy, not a size win, and re-encoding
it is an edit that creates a *new* blob rather than replacing the old one.

Handed to Phase 6 with that caveat attached. `assets/source/og-card.html` references
`../../public/logo.png` - the *shipped* 256px file, not either master - so nothing in
the generation pipeline depends on them either.

## 3.4 Duplicate configuration

| Family | Found | Verdict |
|---|---|---|
| ESLint | none - no `.eslintrc*`, no `eslint` dependency | nothing to duplicate |
| Prettier | none | - |
| Babel | none | - |
| Dockerfile | none | - |
| `.editorconfig` / `jsconfig` | none | - |
| CI workflows | **one** file, `.github/workflows/checks.yml`, two jobs | Not duplication. The `rules` job is split from `checks` because it needs a JVM and takes ~90 s; the file documents that reasoning at the point of use. `npm ci` appearing in both jobs is how Actions works, not a clone. |
| tsconfig | **one** | - |
| Vite / Vitest configs | **three** (`vite.config.ts`, `vitest.config.ts`, `vitest.rules.config.ts`) | Deliberately separate, each documented. See below for the one genuine overlap. |

### The one real config duplication: the `@` alias is declared three times

```
tsconfig.json:30       "@/*": ["./*"]
vite.config.ts:20      '@': path.resolve(__dirname, '.')
vitest.config.ts:80    '@': path.resolve(__dirname, '.')
```

Three declarations of the same alias, in three files, with **nothing checking that they
agree**. Change the root in one and the build and the tests resolve `@` to different
places - silently, because each config is individually valid and every tool reports
success.

Two of the three are reducible: `vite.config.ts` and `vitest.config.ts` could import one
shared constant. The third is not - TypeScript needs `paths` in `tsconfig.json`
regardless of what the bundler does, so the best achievable state is two declarations,
not one.

Low probability, but the failure mode is silent and the fix is four lines. Offered as
proposal 5 below.

## 3.5 Duplicate documentation - none

Ran the same detector across all 19 tracked markdown files (`docs/`, `audit/`,
`README.md`, `CLAUDE.md`, `tools/RepxDesigner/README.md`) at a **lower** threshold of 5
lines: **no duplicated blocks at all**.

Worth noting because `CLAUDE.md` explicitly warns that `README.md` restates a handful of
facts that also live in it, "so a change to one of those is a change to two files."
That restatement turns out to be **paraphrase, not copy-paste** - the same fact told
differently for a different audience. That is the right form for it, and it is why a
mechanical detector finds nothing: this is duplication of *fact*, which no tool can
consolidate and only the existing "change to two files" note can manage.

## 3.6 Nothing was changed

No file was moved, quarantined, edited, or consolidated in this phase. `MANIFEST.md`
gains no rows. The gates were not re-run because nothing was touched; the last full
green run is recorded in `cleanup/02-junk.md`.

## 3.7 The five proposals

Ranked by risk reduced, not by lines saved.

| # | Proposal | Lines | Risk it removes | Effort |
|---|---|---|---|---|
| **1** | Extract the shared body of `handleResume` / `handleGenerate` in `App.tsx` into one function taking the log strings and assistant copy as parameters | ~91 | **High.** One copy of the error handling for the app's most failure-prone operation, instead of two that no test distinguishes. | Medium - it is inside a 3,910-line component, and both call sites touch a lot of state |
| **2** | Extract the focus trap into a `useFocusTrap(ref, onClose)` hook | ~19 | **High.** Accessibility code with no test coverage, currently fixable in one place and broken in the other. | Low |
| **3** | Extract a `MarketingPageProps` type and a `<PageShell>` for the `landing` chrome | ~110 | Medium. Adding a prop to the marketing pages currently means editing seven components and five call sites in `App.tsx`. | Low-medium, but touches 7 files |
| **4** | Extract the shared CTA / hero into a `<CtaSection>` used by `LandingPage` and `FeaturesPage` | ~72 | Medium. The design rationale for the eyebrow exists in only one of the two copies today. | Low |
| **5** | Declare the `@` alias once and import it into `vite.config.ts` and `vitest.config.ts` | ~4 | Low probability, silent failure. `tsconfig.json` must keep its own copy regardless. | Trivial |

**Recommended: 1, 2 and 5.** Proposals 1 and 2 are the ones where a future correct fix
lands in the wrong place; 5 is four lines. Proposals 3 and 4 are ordinary refactors that
would be better done as part of the `App.tsx` breakup already tracked as ARC-001 than
bolted onto a cleanup pass - doing them now means touching seven marketing components
that Phase 7 may want to move anyway.

**None of these is a `git mv`.** They are edits to working code, which is why ground
rule 4 keeps them out of the move commits and why the phase stops here for your
decision.
