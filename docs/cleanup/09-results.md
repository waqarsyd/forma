# Phase 9 - Verify and measure

Date: 2026-08-29
Branch: `chore/cleanup`

Every Phase 0 measurement re-run, the bundle audited for strings that should be gone, the
quarantine exclusions proven from a genuinely clean clone, and one defect found that no
earlier phase caught.

---

## 9.1 The scorecard

### Repository

| Measure | Phase 0 | Now | Change |
|---|---|---|---|
| Tracked files | 216 | 224 | +8 |
| Tracked size | 5.69 MB | 5.83 MB | +0.14 MB |
| Git objects (`size-pack` + loose) | 5.93 MiB | **4.63 MiB** | **−22.0%** |
| `.git/` on disk | 6.09 MB | **4.79 MB** | **−21.3%** |
| Commits | 119 | 146 | +27 |
| Top-level directories (non-dot) | 10 | **8** | **−2** |

The tracked count and size went **up**, and that is the honest shape of this pass: it
added eleven documents totalling ~140 KB - eight cleanup reports, `_not_required/`'s
manifest and README, and a 1,406-byte favicon - while removing far less than that in
code. **The clone still shrank by a fifth**, because `git gc` recovered more than the
additions cost.

### Working tree

| Measure | Phase 0 | Now |
|---|---|---|
| Excl. `.git` + `node_modules` | 178.12 MB / 424 files | 178.45 MB / 443 files |
| Source only (also excl. `.antigravity`, `dist`, `tools/**/bin`+`obj`) | 5.92 MB | 6.25 MB |

Unchanged in substance. The 178 MB is dominated by two things this pass deliberately did
not touch: `tools/RepxDesigner/bin` (145.6 MB, the compiled companion tool) and
`.antigravity` (22.1 MB, live editor state).

### Code

| Measure | Phase 0 | Now | Change |
|---|---|---|---|
| Total code LOC | 22,974 | 22,968 | −6 |
| Test LOC | 3,906 in 27 files | 3,906 in 27 files | 0 |
| Non-test code LOC | 19,068 | 19,062 | −6 |
| Markdown LOC | 12,331 in 101 files | 14,321 in 110 files | +1,990 |
| `src/App.tsx` | 3,910 lines | **3,872 lines** | **−38** |

−6 net lines of code is not a typo, and it is worth sitting with. Phase 3 removed ~91
duplicated lines and Phase 4 removed eleven dead symbols, but both phases *added*
rationale at the removal sites, and the extracted `useFocusTrap` and `runGeneration`
carry docblocks explaining why they exist. **This pass was never going to be measured in
lines**, and the report says so rather than picking a metric that flatters it.

### Dependencies

| Measure | Phase 0 | Now |
|---|---|---|
| Direct `dependencies` | 10 | 10 |
| Direct `devDependencies` | 16 | 16 |
| Transitive packages | 1,112 | 1,110 |
| `npm audit` | **6** (1 low, 5 moderate) | **5** (0 low, 5 moderate) |
| esbuild copies installed | 2 | 2 |

Phase 5 found nothing to remove and said so. The single change was clearing the one
advisory that named a package this project declares.

### Build output

| Artifact | Phase 0 | Now | Change |
|---|---|---|---|
| `index-*.js` (eager entry) | 1,120,976 B | 1,120,976 B | 0 |
| `index-*.css` | 109,411 B | 109,018 B | **−393 B** |
| `pdf.worker-*.mjs` | 2,174,484 B | 2,174,484 B | 0 |
| `pdf-*.js` | 447,505 B | 447,505 B | 0 |
| `index-BEAO-BqI.js` (genai) | 278,425 B | 278,425 B | 0 |
| `Markdown-*.js` | 156,726 B | 156,726 B | 0 |
| `favicon.png` | - | **1,406 B** (new) | - |
| `logo.png` as favicon | 38,075 B fetched per cold load | **not fetched** | **−38,075 B** |
| `dist/` total | 4.292 MB / 15 files | 4.292 MB / 16 files | +1 file |

**What a visitor actually downloads on a cold load: −38,468 bytes.** −38,075 from the
favicon (Phase 6) and −393 net from CSS (Phase 4's −604, partly offset - see §9.4).

### Timings

| Operation | Phase 0 | Now | Change |
|---|---|---|---|
| `npm run lint` | 21.95 s | **9.65 s** | **−56%** |
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | 22.22 s | **9.86 s** | **−56%** |
| `npm run lint:encoding` | 0.71 s (104 files) | 0.74 s (**123 files**) | +18% coverage, +0.03 s |
| `npm test` (warm) | 5.57 s | 5.86 s | +0.29 s |
| `npm run build` (cold `dist/`) | 17.42 s | 14.46 s | −17% |
| `npm run build` (incremental) | 13.27 s | 16.07 s | +21% |
| `npm run test:rules` | 88.09 s | 16.18 s | see note |

The two lint numbers are the real win and they are attributable: Phase 1 found `tsc` was
typechecking `dist/` and excluded it.

**The rules-suite figure is not attributable to anything this pass did** and should not be
read as an improvement. Phase 0's 88 s included a cold Firestore emulator start; 16 s is a
warm one. The build timings likewise vary by a few seconds run to run on this machine -
treat anything under ~20% there as noise.

## 9.2 Clean-clone verification

`git clone --branch chore/cleanup` into a temp directory, then a fresh `npm ci` and the
whole gate suite from nothing.

| Measure | Value |
|---|---|
| Clone `.git/` | **4.706 MB** |
| Clone working tree | 5.927 MB |
| **Clone total** | **10.633 MB** in 224 files |
| `npm ci` | exit 0, **705.5 s**, 529.32 MB installed |

**The quarantine exclusion, proven where it matters most.** A fresh clone's
`_not_required/` contains exactly two files:

```
MANIFEST.md
README.md
```

Nothing else. This is the Phase 1 design working end to end - the record of what was
parked travels with the repository; the parked bytes do not.

### Gates, from a clean clone

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 (10.68 s) |
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | exit 0 (9.31 s) |
| `npm run lint:encoding` | exit 0 - **122 files swept, clean** |
| `npm test` (cold cache) | exit 0 - **25 files / 409 tests** (30.82 s) |
| `npm run test:rules` | exit 0 - **2 files / 41 tests** (63.05 s incl. emulator start) |
| `npm run build` (cold) | exit 0 (29.12 s), 16 artifacts |

The encoding sweep reports 122 in the clone against 123 in the working repository: the
difference is the uncommitted prompt-pack files sitting in the working tree's `docs/`,
which the clone correctly does not have.

**The build is reproducible.** The clone produced byte-identical chunk hashes to the
working repository - `index-DGXLP5rs.js`, `Markdown-oFbx4mCV.js`, `index-BEAO-BqI.js`,
`pdf-Bs6rg4xv.js` - and its `dist/` was independently audited: `_not_required`,
`IconUpload`, `glass-panel` and `xcode_project_setup` all appear **0 times**.
`dist/favicon.png` is present at 1,406 B.

### Critical flows, walked against the clone's production server

The server was started with `npm start` from the clone and every flow exercised as far as
this environment honestly allows.

**Flow 4 - the marketing routes and legal pages: fully verified.**

```
/  /features  /docs  /contact  /login  /signup  /workspace  /terms  /privacy
   → 200, 6,884 B each (the SPA shell; per-route titles are applied client-side by
     routes.ts, which routes.test.ts covers with 16 cases)
/no-such-page  → 200 + shell, so the client renders NotFoundPage — the documented design
/api/health         → 200 {"status":"ok"}
/api/does-not-exist → 404 JSON, NOT the SPA shell — the deliberate behaviour docs/PRD.md records
/favicon.png → 200, 1,406 B, image/png     ← the Phase 6 change, verified end to end
/logo.webp   → 200, 8,374 B, image/webp
/og-card.png → 200, 98,684 B, image/png
```

**Rendered, not just fetched.** The landing page and the workspace were rendered with
headless Edge - the same tool `docs/notes/app-shell.md` documents for the OG card - to
confirm the app actually boots from a clean clone rather than merely serving HTML.

- **Landing page**: full hero, the scanner figure with its invoice-to-REPX panel, header
  chrome and both CTAs render correctly.
- **Workspace**: renders the key gate exactly as designed - *"Add your API key to start"*,
  *"Add your Gemini API key — Forma ships no key of its own"*, *"Your key clears when this
  tab closes"* - with **Save** disabled while signed out and **Open in designer** disabled
  by feature detection. The status bar reads `IDLE · DEVEXPRESS V23.2 · UNITS 100/IN`.

That screenshot is the visible proof of the architecture: **the app refuses to work
without a key the user supplies**, which is flow 3's gate and the correction to the
original leak incident.

### What could *not* be walked here, and why

Stated rather than glossed, because a verification section that implies more than it did
is worse than one that admits the boundary:

| Flow | Status |
|---|---|
| **1** - upload → Gemini → spec + mockup + `.repx` | **Not executed.** It requires a live Gemini API key. Forma ships none by design, and using one of mine would both cost the owner nothing and prove nothing about their setup. The pipeline's logic is covered by the unit suite - `repx`, `reportGeometry`, `analysisResponse`, `attachmentParts`, `sourceRect`, `generationProgress` - and the key gate above was verified visually. |
| **2** - sign in, save, load, delete account | **Partially.** The security boundary is fully covered by the 41 rules tests, which run against the emulator with the production `firestore.rules` enforced and include proving that deleting an account removes both the reports and the encrypted key. The interactive path needs real Firebase auth against `forma-201ba`. |
| **3** - BYO key, vault, model detection | **Partially.** The gate is verified visually above; `keyVault.test.ts` (21) and `modelResolution.test.ts` (32) cover the crypto and the probing. Entering a real key was not done. |
| **5** - Open in designer | **Not executed.** It needs `RepxDesigner.exe --serve` running on a desktop session. `tools/RepxDesigner/README.md` is explicit that a process started from an agent shell paints on the wrong desktop and reports success anyway. The button was verified present and correctly feature-detected to *disabled* with no listener running, which is the half that can be checked from here. |

## 9.3 Bundle audit: strings that should be gone

Every text artifact in `dist/` concatenated - 4,293,534 characters across 9 files - and
searched.

| Category | Strings checked | Occurrences |
|---|---|---|
| Phase 4 dead code | `IconUpload` `IconRuler` `drawerVariants` `messageVariants` `tabPanelVariants` `snapInVariants` `bento-grid` `glass-panel` `hero-gradient` `port-indicator` | **0 each** |
| Quarantined items | `_not_required` `xcode_project_setup` `firebase-blueprint` `Contact&InquirePage` `metadata.json` `launch.json` | **0 each** |

Phase 3's consolidation verified from the other direction: `"Resuming report generation"`
appears **once** (the `RESUMED_RUN` constant) and `"resumed and completed"` twice (its two
variants, for prompt and no-prompt). The duplicated function body is gone from the output,
not merely from the source.

### Secret scan

Four key-shaped strings appear in the bundle. **All four are correct**, and given this
repository's history - an application-owned Gemini key was once inlined by `envPrefix` and
revoked by Google's scanner - each was traced to source rather than assumed:

| String | Where it comes from | Verdict |
|---|---|---|
| `GEMINI_API_KEY` ×1 | inside `@google/genai`'s own minified code: `apiKey: qe("GEMINI_API_KEY") ?? null` - the SDK's env-var *name*, in a browser where that lookup yields nothing | benign, and not ours |
| `AIzaSyA06ro9…` ×1 | `firebase-applet-config.json`, beside `forma-201ba` | **expected** - `CLAUDE.md` and `README.md` both record that the Firebase web config is a public project identifier and stays committed |
| `AIzaSyD7k2Qx9…` ×1 | `src/components/landing/VaultFigure.tsx:14`, whose docblock reads *"The strings are illustrative — the real key never leaves the browser, which is the point the figure exists to make"* | an illustrative fake in a landing animation |
| `AIzaSy…` ×1 | the config dialog's input `placeholder` | benign |

`sk-` matched three times, all inside `task-list-item` from `remark-gfm`.

**No application-owned key is present in the bundle.** The bring-your-own-key
architecture holds.

## 9.4 The defect this phase found

**Tailwind is generating CSS utilities from class names quoted in documentation.**

`src/index.css` has `@import "tailwindcss";` with **no `@source` directive**, so Tailwind
v4 falls back to automatic content detection across the whole project - which includes all
110 tracked markdown files.

Caught by noticing the built CSS had grown 211 bytes since Phase 4 measured it. The proof
is one class:

```
.bg-user-msg{background-color:var(--color-user-msg)}      ← in the shipped stylesheet
$ git grep -F "bg-user-msg" -- src index.html              → no hits
$ git grep -F "bg-user-msg" -- docs                        → docs/cleanup/04-dead-code.md:171
```

That line of mine reads *"`--color-user-msg` is 'used' when some JSX says `bg-user-msg`."*
**Writing the sentence made the sentence false.** Phase 4 measured that token at zero
occurrences in the built CSS; explaining why it was dead is what brought it back.

### Measured cost

Rebuilt with `@import "tailwindcss" source(none)` plus explicit `@source "../index.html"`
and `@source "./"`:

```
unrestricted (current):  109,018 B    534 selectors
restricted to src:       107,790 B    524 selectors
                        ───────────
                          −1,228 B    −10 selectors, 0 gained
```

**Twice what Phase 4's dead-code removal saved.**

### All ten verified dead

| Selector | Only source | Live use in `src/`? |
|---|---|---|
| `max-w-6xl` `max-w-7xl` `mt-7` `border-t-primary` | `docs/notes/app-shell.md`, and `border-t-primary` also in an `index.css` **comment** describing a class that was already replaced by `--paper-accent` | none |
| `bg-user-msg` | `docs/cleanup/04-dead-code.md` (mine) | none |
| `lowercase` | `docs/cleanup/07-restructure-proposal.md` (mine) | none |
| `m-1` `m-2` `outline` `shadow` | no identifiable source | none - `outline`/`shadow` grep-match only as word-parts of `outline-none`, `shadow-lg`; no bare use in any `className` |

**This is not a defect this cleanup introduced.** Four of the ten come from
`docs/notes/app-shell.md`, written 2026-08-13 in `eab2f7a`, long before this pass. The
mechanism has been leaking documentation into the stylesheet for months. This pass added
two more classes to the leak and then found it.

**Not fixed here.** It is a build-configuration change and belongs in Phase 10 as a
guardrail, where it can be applied and re-verified together with the other automation
rather than during the phase whose job is to measure the current state.

## 9.5 What is in quarantine

14 files, **209.5 KB**, of which git tracks **2** - the manifest and the README, by design.

| Category | Files | Bytes | Contents |
|---|---|---|---|
| `build-artifacts/` | 3 | 167,954 | `firestore-debug.log`, `debug.log` (a Chrome installer log from another session), `dev-server.log` |
| `dead-code/` | 4 | 5,926 | excerpts: 2 icons, 4 motion variants, `SMALL`, 4 CSS rules |
| `old-configs/` | 1 | 212 | `.vscode/launch.json` |
| `public/` | 1 | 7,750 | the decoy `DESIGN.md` (parked 2026-08-09) |
| `.agents/` | 1 | 5,901 | `xcode_project_setup/SKILL.md` (parked 2026-08-09) |
| top level | 2 | 1,009 | `metadata.json`, `firebase-blueprint.json` (parked 2026-08-09) |
| `duplicates/` | 0 | 0 | the empty `public/LoginPage/` tree - directories only, no files |
| `docs-archive/` `experiments/` `unsure/` `unused-assets/` `vendor-dumps/` | 0 | 0 | never needed |

**`unsure/` is empty, and that is the headline of the quarantine.** Nothing was ever moved
without either proof it was unreferenced or an explicit decision from the repository
owner.

## 9.6 Nothing broke

**No restore was ever needed.** Across nine phases, the gates never went red on a change
that shipped. Three problems were caught *before* they shipped, all by tooling rather than
by reading:

1. **Phase 3** - removing `AccountDialog`'s `closeRef` with the focus trap failed
   immediately on `tsc` (`TS2304`), because that ref was also serving the account-deletion
   path's `await`. Fixed before commit.
2. **Phase 5** - the approved `esbuild` bump left `npm audit` unchanged, because the
   vulnerable copy was `tsx`'s nested one, not the declared one. Caught by re-running
   `npm audit` instead of assuming; fixed by updating `tsx`.
3. **Phase 7** - a live smoke test of the production server disproved my own claim, in two
   committed documents, that `securityHeaders.ts` sets the app's CSP. It does not. Every
   gate was green and the build succeeded; only starting the server exposed it.

## 9.7 The UNSURE list still awaiting a decision

**Empty.** Every item raised across nine phases was resolved by an explicit decision from
the repository owner:

| Phase | Item | Decision |
|---|---|---|
| 1 | tracked vs ignored quarantine | ignored, with the manifest tracked |
| 2 | `.vscode/launch.json` | quarantined |
| 2 | `.vscode/settings.json` | kept |
| 3 | the five consolidation proposals | 1, 2 and 5 approved; 5 later deferred on a corrected estimate |
| 3 | a regression test for the resume path | not written; consolidation removes the risk at its root |
| 4 | `resetGenAIForTests` | kept |
| 4 | ~12 internal-only exports | left exported |
| 6 | the favicon | 32×32, after visual review |
| 6 | the `assets/source/` masters | kept |
| 7 | restructure tiers | Tier 1 only |

Nothing sits in `_not_required/unsure/`, and nothing is waiting on you.

## 9.8 What was deliberately not touched, and why

| Not touched | Why |
|---|---|
| `App.tsx`'s 3,872 lines | Breaking it up is ARC-001, a refactor rather than a cleanup. Phase 3 removed a 91-line duplicate inside it; Phase 7 declined to restructure around it. |
| `tools/RepxDesigner/bin` (145.6 MB) | The compiled companion tool the owner double-clicks. A working binary, correctly gitignored. |
| `.antigravity/` (22.1 MB) | Live editor state. Moving it changes the owner's tooling, not the project. |
| `assets/source/` masters (3.28 MB) | Kept by decision. Quarantining shrinks the checkout by 3.28 MB and the clone by **zero**; re-encoding would make the clone **1.98 MB larger**. |
| The 5 remaining `npm audit` advisories | All dev-only and unreachable, and npm's offered "fix" is a **major-version downgrade** of `firebase-tools`. |
| `src/lib`'s flat 24-module layout | Tier 2 of Phase 7. Its right boundaries are not knowable until ARC-001 has started; the grouping is written down ready. |
| `src/components`' mixed levels | Tier 3. Better done after the `CtaSection` / `PageShell` extractions Phase 3 identified. |
| The SPDX `Apache-2.0` header in `App.tsx` | The only one in the repo, while there is no `LICENSE` and no `license` field, and `CLAUDE.md` forbids adding one. A licensing decision, not a cleanup. Recorded in Phase 3 §3.9. |
| The `import.meta.env` cast in `geminiService.ts` | Its own comment says the exact text matters; the line below it is a cast. Live path, no test, file history includes a leaked key. Recorded in Phase 4 §4.8. |
| The 11 font weights | The largest unmeasured asset question, ~150-250 KB. Needs a network panel on a built page. Recorded in Phase 6 §6.7. |
| Git history | Phase 8: a rewrite could reclaim ≤120 KB; `git gc` already recovered 454 KB safely. |
| Your uncommitted prompt-pack move | Present since before this pass. Every commit named explicit paths so it was never swept in. |

## 9.9 Honest summary

What a user downloads on a cold load fell by **38,468 bytes**, almost all of it one
oversized favicon. The clone shrank **22%**, almost all of it a `git gc` that any
maintainer could have run in three seconds. `npm run lint` got **56% faster**, and that
one is squarely attributable: it had been typechecking its own build output.

Against that, the codebase is 6 lines shorter and carries 2,000 more lines of markdown.

**The durable value of this pass is not in those numbers.** It is that the 30-line error
path for a Gemini call exists once instead of twice; that the modal keyboard contract
exists once instead of twice; that the CSP-adjacent server modules are no longer in the
browser's directory; that 18 more documents are under the encoding gate; that the
conventions the project was already following are now written down; and that
`_not_required/MANIFEST.md` records why every removal was safe, with the command that
proves it and the command that undoes it.
