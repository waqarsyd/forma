# Phase 7 — Implementation record

**Date:** 2026-08-27 · **Scope:** the roadmap's *Now* list (items 1–7), plus the documentation
those fixes invalidated.

**This file supersedes the numbers in the earlier audit files.** Those describe the repository as
found on 2026-08-27 *before* any fix; they are kept unedited as the baseline. Where a count or a
finding status differs, this file is current.

---

## What landed

Eight commits on `main`, one per concern, each on its own `audit/<id>-<slug>` branch merged
fast-forward.

| Commit | Item | Findings closed |
|---|---|---|
| `0f72720` | Privacy disclosure + regression test | **SEC-003 / INV-001** (P1) |
| `e8b036c` | Security headers, `x-powered-by` off | **SEC-001** (P2) |
| `390c2ef` | Loopback dev bind | **SEC-002** (P2) |
| `2ed3424` | Key vault test suite | **TEST-001** (P1) |
| `e412a3b` | Two missing fetch timeouts | **REL-001, REL-002** (P2 ×2) |
| `a754544` | CI + runnable encoding check | **INV-003** (P2) |
| `9f06141` | `npm audit fix` + dependency split | **SEC-004, SEC-006** (P3 ×2) |
| `cc703e1` | Documentation catch-up | — |

**10 findings closed: 2 × P1, 6 × P2, 2 × P3.** One further finding — **TEST-005** (non-flakiness
assumed, not demonstrated) — was closed as a side effect: the suite was run five consecutive times
at the end, 219/219 each time.

### Second pass — `Next` items and live API testing

| Commit | Item | Findings |
|---|---|---|
| `74a780e` | Account deletion proved, document layout consolidated | **DATA-001** (P1) — **the last open P1** |
| `9e8c94c` | 400 no longer reported as an invalid key | **NEW-001** (P2) — found by live testing |
| `10afe1d` | `geminiService` covered from fixtures; offline no longer blamed on the key | **TEST-002** (P2), **NEW-002** (P2) — found by writing the tests |
| `67412d8` | One shape adapter for saved projects, round-trip tested | **TEST-004** (P2) |
| `1790b39` | The signed-out save can no longer throw on a full browser store | **NEW-003** (P2) — found while closing TEST-004 |
| `a5d4bf2` | Units and page sizes the geometry cannot convert are rejected | **BUG-001** (P2) |
| `7c54d03` | `strict` enabled; React types declared rather than inherited | **ARC-004** (P2), **NEW-004** (P2) |
| `04914a5` | Three heavy dependencies moved behind lazy boundaries | **PERF-001** (P2, partial) |
| `0e4bc3c` | The progress state machine and attachment builder extracted and tested | **ARC-002** (P2); **ARC-001** started |

**22 findings closed, two partially. No P1 remains.**

### ARC-002, and a mutation test that found something

`handleGenerate` (216 lines) and `handleResume` (130) shared about ninety lines near-verbatim. The
audit's recommendation was to extract **the state machine, not the I/O**, so every branch becomes
reachable without a key or a network. That is what landed.

`lib/generationProgress.ts` is a pure reducer over `{stepIndex, percent, streamChars}` with 22
cases. The rule it protects has broken before: the opening phase is *simulated*, because model
detection, upload and the model's silent thinking produce no signal at all, and the rest is *real*.
When the simulation climbed freely, the first real chunk reported a lower figure and the bar snapped
backwards.

Every update in `App.tsx` is now functional, which **removed `lastCompletedStepIndexRef` entirely** —
it existed only because a callback would have closed over a stale copy of the step index.

**A mutation test found that the ceiling clamp is currently redundant.** Deleting the
`Math.min(PRE_STREAM_CEILING, …)` broke nothing, because the last step lands on
`4 + (6−1) × 2 = 14`, *exactly* the ceiling. That is a coincidence between two constants, not a
design. A seventh step would push it to 16 and break the handover again, with a snapping bar as the
only symptom. There is now a test asserting the relationship; adding a step fails it with
`expected 16 to be less than or equal to 14`.

The attachment builder also parsed data URLs blind — `mimeInfo.split(':')[1].split(';')[0]` throws a
`TypeError` on any string without a colon. Previews normally come from the intake, but a project
restored from `localStorage` carries whatever was stored, and a throw there loses the whole
generation rather than one thumbnail.

**ARC-001 is started, not closed.** `App.tsx` went 3,920 → 3,864 lines and still has 30 `useState`.
The remaining work is the same shape repeated: the chat-turn branch, `ingestFile`, the error
classification (which currently re-classifies a message `classifyGeminiError` already produced, and
overwrites the better one — worth its own finding), and eventually the workspace itself, which is
what PERF-001 needs to finish.

### PERF-001: the audit's proposed approach was wrong

The audit said to lazy-load the workspace, on the grounds that *"the split line is already drawn"*.
**It is not.** `routes.ts` draws a *view-state* line; `App.tsx:2997` is
`if (!showWorkspace) return (…)` — a render branch inside a single component, with **all 75 hooks
above it and none below**. Lazy-loading the workspace means extracting the workspace, which is
ARC-001 wearing a performance costume.

So the route taken instead was three dependencies that are individually large and each used in
exactly one place:

| | Raw | Gzip | Loaded when |
|---|---|---|---|
| **eager** (was 1,997.96 / 540.16) | **1,117.98 kB** | **306.44 kB** | first paint |
| `pdf-*.js` | 447.51 kB | 132.54 kB | a PDF is dropped |
| `index-*.js` (Gemini SDK) | 278.43 kB | 55.76 kB | first generation or chat |
| `Markdown-*.js` | 156.73 kB | 47.46 kB | the spec plate is opened |

**−43% of what a first-time visitor pays.** `index.html` references only the eager chunk, verified
against the built server, so the other three genuinely cost nothing until something asks for them.

What forced pdf.js eager was not its import but the line below it —
`GlobalWorkerOptions.workerSrc` assigned at module scope. Model discovery and probing stay eager on
purpose: they use plain `fetch` against the REST endpoint, are small, and `validateApiKey` calls
them from the settings dialog before any SDK work happens.

**Why this is "partial": Firebase dominates the remainder.** Auth is genuinely eager — `SiteHeader`
shows the signed-in user on every marketing page. Firestore is workspace-only and could follow, but
`db` is created at module scope in `services/firebase.ts` and consumed by three modules, so
deferring it is a refactor rather than an import change, with no component test to catch a
regression. **The audit's 150 kB target is not reachable without that or ARC-001.** 306 kB is where
the cheap wins end, and saying so is more useful than pretending otherwise.

### ARC-004: the debt was seven errors

The audit deliberately did **not** guess the size, on the grounds that a figure gathered and not
acted on invites being treated as settled. Measured: **7 errors across ~15,000 lines**, five of them
in tests written the same week. It had never been done because the cost was assumed to be large and
nobody had spent the twenty seconds to check.

Demonstrated rather than asserted — four bug shapes that compile with **zero** errors under the old
settings and produce four under the new ones:

| Bug | Caught by |
|---|---|
| `name.length` where `name: string \| null` | `strictNullChecks` |
| `function f(x)` with no annotation | `noImplicitAny` |
| `catch (e) { return e.message }` | `useUnknownInCatchVariables` |
| `const s: string = arr.find(…)` | `strictNullChecks` |

**NEW-004, and the more valuable half of this item: `@types/react` was not declared anywhere.** It
was present only because `react-markdown` happens to depend on it. Had that dependency changed,
every `.tsx` file would have silently degraded to `any` while `tsc` still exited 0 — the same
failure `strict` exists to prevent, arriving through the dependency tree rather than the config.
`@types/react-dom` was genuinely absent and was one of the seven errors. Both are now
`devDependencies`.

Two of the seven were the same finding twice: `LocalSaveOutcome` wanted to be a discriminated union
and had to be written as an interface with an optional field two commits earlier, because without
`strictNullChecks` `!outcome.ok` did not narrow. It is a union again — which is what enabling this
buys, in miniature.

### NEW-003, and what TEST-004 actually turned out to be

**TEST-004 was recorded at Medium confidence because I had not demonstrated a losing case. There
isn't one** — the two shapes convert correctly today, and the audit's suspicion was wrong. What the
work bought was a single adapter with 21 round-trip cases guarding the edit that breaks it later,
whose symptom is a saved report reopening blank rather than an error anyone can see. Two genuine
defects surfaced on the way: the display name was computed separately in each save branch, so the
same report saved signed out and signed in could be listed under two different names; and the read
path could throw a `RangeError` on a document with no timestamp, inside an `onSnapshot` callback the
surrounding `try`/`catch` does not cover — emptying the whole projects panel instead of skipping one
row.

**NEW-003 is the finding that mattered.** Every `localStorage.setItem` in `App.tsx` sat inside a
try/catch except the one writing the projects list — the only write carrying base64 uploads, and so
the only one that can exhaust the quota. Demonstrated: four reports of 1.2 MB each threw
`QuotaExceededError`, from inside a `setSavedReports` updater, so it reached React rather than the
user. The signed-in path already refuses an oversized project with a considered message, and that
message points the user at the path that threw.

Both writes now go through `saveReportsLocally`, which returns an outcome, restores the previous
list if the write fails, and is tested against a full store and a blocked one.

**A small illustration of ARC-004 in passing:** the outcome type wanted to be a discriminated union
`{ok: true} | {ok: false; message: string}`. It does not narrow, because no strictness flags are
enabled — `!outcome.ok` fails to exclude the success arm and every read of `message` is a type
error. It is an interface with an optional field instead, with a comment saying why.

### TEST-002 and what it turned up

`geminiService.ts` went from **2 of 10 exports tested to 10 of 10**, entirely from fixtures — no
key, no network. Two extractions were needed, both to make a branch reachable rather than for
tidiness:

- **`lib/analysisResponse.ts`** — the parse-or-explain branch from the bottom of
  `analyzeReportDesign`. It decides whether a failed generation is reported as *truncated* or as
  *malformed*, and only `finishReason` distinguishes them. That fix was made on 2026-08-26 and
  verified by fulfilling a stream with 62% of a valid payload over CDP: careful work, doable once,
  by hand. It is now 16 fixtures including that payload.
- **`services/modelResolution.test.ts`** — 30 cases over `resolveModel`, `validateApiKey`, the
  session cache, `MODEL_PREFERENCE` and the `MissingApiKeyError` guards, driven by the catalogue
  shape captured live.

**NEW-002, found by writing those tests.** With no network connection, the user was told:

> *"No Gemini model is available to this API key. Create a new key in Google AI Studio and try
> again."*

The key was fine; they were offline, and could not have reached AI Studio to make a new key either.
`validateApiKey` had a branch for exactly this case, matching `"Failed to fetch"` — and it was
**dead code**, because `discoverModels` and `probeModel` both swallowed the network error long
before it could reach it, folding "never reached Google" into the same verdict as "Google said no".
`probeModel` now returns a distinct `network` verdict, and `resolveModel` reports a connection
failure when *every* probe failed to connect. A mix still falls through to the key-then-quota
precedence, because some requests arriving means what they returned is the better clue.

Both suites were mutation-checked: folding `network` back into `unavailable` fails three cases,
and making the `MAX_TOKENS` branch unreachable fails two.

**Still uncovered, and stated plainly:** the streaming loop inside `analyzeReportDesign` and
`chatReply`. Reaching it means mocking `@google/genai` rather than `fetch`, which would assert the
mock more than the code. Everything on either side of it is now covered.

---

## The live API session

A temporary key was supplied and used to exercise the paths the audit could only mark UNVERIFIED.
**The key was never written to any file, never passed on a command line** (this is a shared host —
process arguments are readable by other users), only ever exported to a single invocation's
environment, and destroyed afterwards. It is absent from the repo, from every commit, from the
scratchpad, from all logs and from all three environment scopes — verified by sweep. It should
still be treated as compromised, because it appeared in a chat transcript.

### Now verified, no longer UNVERIFIED

| Claim | Result |
|---|---|
| **Critical flow #1 — upload → generate → spec + mockup + `.repx`** | **Works.** 86.5s end to end on `public/og-card.png`. Returned a 3-section layout (header/detail/footer) and 2,887 characters of REPX. |
| `checkRepx` against real model output | `{"ok":true,"message":"Valid DevExpress report XML."}` — no warnings |
| REPX well-formedness | Root closed, 35 opening / 32 closing / 3 self-closing tags — balanced. `ReportUnit="HundredthsOfAnInch"`, `PageWidth="850"`, `<Bands>` present. |
| **Truncation bug** | **Did not reproduce** on this input. See below. |
| `resolveModel` cold-start cost | **8.1s and 16.9s** across two runs — 1 catalogue call + 10 concurrent probes. This was PERF's open UNVERIFIED number. |
| The 503 retry + fallback path | **Fired for real.** `gemini-flash-latest` was overloaded, retried twice with backoff (2.5s, 4.4s), then fell back to `gemini-2.5-flash` and succeeded. |
| Runtime model detection | Catalogue returned 52 entries, 38 supporting `generateContent`; discovery added 5 models the curated list does not know (`gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, …). |
| `validateApiKey` | `{"valid":true,"message":"Key is valid — using gemini-flash-latest."}` |

### Two things the live run corrected

- **`validateApiKey` re-probing is deliberate, not a bug.** It costs a second ~16s round of 10
  probes because it calls `clearCachedModel()` first, with the reason written down: a different key
  can have different model access, so a choice resolved for a previous key must not be trusted. I
  nearly reported it.
- **`README.md`'s thinking-token figure has drifted.** It states 4,770 thinking tokens against
  3,184 output. Measured this session: **8,718 thinking, 3,182 output** (input 4,556, total 16,456).
  The output figure is almost exactly right; thinking is 1.8× the documented number. Worth
  re-measuring and updating — it is the evidence behind the `thinkingBudget` note in *Status and
  limitations*. **Not fixed here** — one sample is not a re-measurement.

### On the truncation bug

It did not reproduce. The generated REPX was 2,887 characters, closed cleanly and validated. That
is **not** evidence the bug is gone — a 3-section report from a marketing card is at the small end
of what the product handles, and the bug is reported on larger reports. What the run does establish
is that the pipeline is sound at this size, and that `checkRepx` correctly accepts real output. A
complex multi-band source document is the input that would settle it.

One incidental observation: the output contained **no `Font=` attributes at all**, so the
point-conversion path that `reportGeometry.unitsToPoints` exists to serve was never exercised. That
is the model's choice on this input, not a defect, but it means the units fix remains unproven
against real output.

---

## Test state now

| | Before | After |
|---|---|---|
| Unit test files | 13 | **18** |
| Unit tests | 167 | **219** |
| Rules tests | 29 | 29 |
| **Total** | 196 | **248** |
| Modules with a test file | 13 of 38 | **17 of 41** |
| `src/` lines under a test file | 18.6% | **21.4%** |
| …corrected for `geminiService` (see below) | ≈8.8% | **≈11.7%** |

Five new test files: `keyVault.test.ts` (21), `designerBridge.test.ts` +5 (6 → 11),
`securityHeaders.test.ts` (9), `bindHost.test.ts` (6), `contactSubmit.test.ts` (6),
`legalDisclosure.test.ts` (5).

**The corrected figure still matters.** `geminiService.ts` is 1,542 lines and counts as "covered"
on the strength of 2 exports out of 10, so the headline 21.4% overstates reality by roughly 2×.
That is TEST-002, and it is still open.

### Export-level coverage, measured

| Module | Exports tested | Note |
|---|---|---|
| `lib/repx.ts` | 3/3 | |
| `lib/router.ts` | 5/5 | |
| `lib/routes.ts` | 4/4 | |
| `lib/modelCatalog.ts` | 3/3 | |
| `lib/attachments.ts` | 2/2 | |
| `lib/datetime.ts` | 2/2 | |
| `lib/sourceRect.ts` | 2/2 | |
| `lib/bindHost.ts` | 3/3 | **new** |
| `lib/contactSubmit.ts` | 2/2 | **new** |
| `lib/securityHeaders.ts` | 2/2 | **new** |
| `lib/reportGeometry.ts` | 6/8 | the 2 are `POINTS_PER_INCH` / `CSS_PX_PER_INCH` — constants |
| `lib/panelSize.ts` | 5/6 | the 1 is `REVIEW_BENCH_RESERVE` — a constant |
| `lib/reportConfigStore.ts` | 2/3 | the 1 is `STORAGE_KEY` — a constant |
| `lib/announcements.ts` | 2/3 | the 1 is `SEEN_KEY` — a constant |
| `services/keyVault.ts` | 9/10 | **new**; the 1 is `VaultUnavailableError`, unreachable where WebCrypto exists |
| `lib/designerBridge.ts` | 4/8 | **was 1/6.** Real gaps: `launchDesigner`, `waitForDesigner` |
| `services/geminiService.ts` | **2/10** | unchanged — the single largest remaining gap |

Constants are counted as untested by the measurement but need no test; the behavioural gaps are
the four named in the last two rows.

---

## Still open — the honest list

Nothing from the *Now* list remains. Everything below is *Next* or *Later* and was never in scope
for this pass.

### Testing

| Finding | Severity | State |
|---|---|---|
| ~~**TEST-002** — `geminiService` at 2/10 exports~~ | P2 | **Closed** in `10afe1d`. Now 10/10, from fixtures. The streaming loop itself remains uncovered by choice — see above. |
| **TEST-003** — `designerBridge` | P2 | **Partially closed.** `sendToDesigner` gained five cases with the timeout fix. `launchDesigner` and `waitForDesigner` remain untested. |
| ~~**TEST-004** — `localStorage` ↔ Firestore shape round-trip~~ | P2 | **Closed** in `67412d8`. The conversion turned out to be *correct* — my Medium-confidence guess at a losing case was wrong. It is now one adapter in `lib/savedReport.ts` with 21 round-trip cases, plus two real fixes found on the way: the display name was computed separately in each branch (so one report could be listed under two names), and the read path could throw a `RangeError` inside an `onSnapshot` callback on a document with no timestamp — emptying the entire projects panel rather than skipping a row. |
| ~~**NEW-003** — the signed-out save had no quota guard~~ | P2 | **Closed** in `1790b39`. Found while closing TEST-004. |
| ~~**DATA-001** — account deletion clears reports *and* vault~~ | P1 | **Closed** in `74a780e` — this row was left stale for several commits, which is the drift this whole file exists to prevent. The emulator harness that would test it already runs in `npm run test:rules`. |
| Component / render tests | — | **None exist.** Blocked by ARC-001. |
| Contract test on the Gemini response shape | — | Not started. |
| Accessibility scan, visual regression | — | Not started. |

### Not testing

| Finding | Severity | State |
|---|---|---|
| ~~**ARC-002** — `handleGenerate` at 216 lines~~ | P2 | **Closed** in `0e4bc3c`. The progress state machine and the attachment builder are extracted and tested; `lastCompletedStepIndexRef` is gone. |
| **ARC-001** — `App.tsx` is the whole application | P1→ | **Started, not closed.** 3,920 → 3,864 lines, still 30 `useState`. This was one slice; the file is still the app. |
| ~~**BUG-001** — `unit`/`pageSize` accepted without domain validation~~ | P2 | **Closed** in `a5d4bf2`. `Document` now converts at 300 units/inch instead of 100 (the 3× error), `Tabloid` is 11×17 instead of silently Letter, `mergeStoredConfig` validates the domain, and `geminiService` resolves both before they reach the XML. Recorded in `docs/notes/gemini.md` under the units audit. |
| **ARC-003** — no observability | P2 | Open. Note the ordering constraint is now satisfied: the privacy text names its processors, so adding an error reporter no longer creates an undisclosed one. |
| ~~**ARC-004** — no `strict` flags~~ | P2 | **Closed** in `7c54d03`. Measured: **7 errors across the whole codebase**, five in tests written the same week. The debt was assumed large and nobody had checked. Turned on. |
| **PERF-001** — one 1.99 MB chunk | P2 | **Partially closed** in `04914a5`. **540 → 306 kB gzipped eager, a 43% cut.** pdf.js, the Gemini SDK and react-markdown are now three lazy chunks. Firebase remains eager and is what dominates the rest — see below. |
| **PERF-002** — render-blocking Google Fonts | P3 | Open. Roadmap item 11. |
| **UX-001** — account menu is a `<div>` with `onClick` | P2 | Open. Roadmap item 19. |
| **INV-005** — no `engines` field | P2 | Open. Roadmap item 12. |
| **BUG-002…005, REL-003, DATA-002, UX-002, UX-003** | P3 | Open. Roadmap item 20. |
| The documentation-drift cluster | P3 | **Partially closed** — the stale items this work touched were fixed in `cc703e1`. INV-006 (`APP_URL`), INV-009, INV-010, INV-011, RUN-001, RUN-003…006, ARC-005 and SEC-005 remain. |

**Running total (superseded — see the register below).** This line was written after the first pass
and is kept only so the sequence is legible.

---

## Findings register, as of the end of the session

**50 findings: the audit's 46, plus 4 found while fixing them** (NEW-001 to NEW-004).

| | Count |
|---|---|
| **Closed** | **45** |
| Partially closed | 3 — ARC-001, PERF-001, PERF-002 |
| Open | 2 |
| **P0** | 0, and there never were any |
| **P1 open** | **0** — all four are closed |
| **P2 open** | **1** — ARC-003 (observability) |
| P3 open | 1 — component/render tests, which ARC-001 gates |

### The final pass

Everything from the *Later* list except the two items below. In one sitting, in
this order:

| Commit | Findings |
|---|---|
| `298ae32` | **UX-001**, **UX-002** — keyboard access to the account menu; a real 404 |
| `3f8b5aa` | **BUG-002…005**, **REL-003**, **INV-005**, **SEC-005** — the quiet-failure cluster |
| `82c1d4f` | **INV-004**, **TEST-003** — coverage measured at last, and the gap it named |
| `f6eba8a` | **ARC-005**, **RUN-001/003/005/006**, **INV-006/008/009/011** — layering and doc drift |
| `e36cd3f` | **DATA-002** — a corrupted store no longer takes the app down at boot |
| `d75381b` | **PERF-002** (partial) — the icon font is gone |

**Coverage, measured rather than estimated for the first time:** `lib/` at
**95.99% of statements**, `lib/` + `services/` at 71.95%. Two zeroes in the
report are not gaps — `accountData.ts` is exercised by the emulator suite under
a different config, and `firebase.ts` is the Firebase singleton.

### What remains, and why

**ARC-003 — no observability.** Deliberately left. It is the one item whose
right answer depends on a decision nobody has made: where the reports go. Adding
a sink also adds a third-party processor, and the privacy page now names its
processors exactly — so this must be done *with* that text, not before it. Worth
closing before any public deployment; not worth guessing at now.

**ARC-001 — `App.tsx`.** Started, not finished: 4,221 → 3,860 lines, still 30
`useState`. Two slices landed (the progress state machine, the attachment
builder) and the pattern is proven. Component tests and the last of the bundle
weight are both downstream of it.

**PERF-002 — self-hosting the three text faces.** The icon font is gone and both
origins are preconnected. The rest means committing font binaries and changing
what every page renders in, with no visual regression test to catch a wrong
weight. The exposure is disclosed either way.

### Never assessed — unchanged from the first hour

Report **fidelity** (needs a PDF with known offsets, measured in the designer),
the **truncation bug** on a large report, the **designer round-trip**, and
anything **visual** — contrast, focus order, responsive behaviour,
screen-reader flow. The CI workflow has still never executed, because there is
still no remote.

### The four found while fixing, none of which the audit saw

| | What |
|---|---|
| **NEW-001** | Any HTTP 400 was reported as an invalid API key. Found by sending a malformed request with a *valid* key. |
| **NEW-002** | Offline, the user was told to create a new key in AI Studio — which they could not reach. `validateApiKey`'s connectivity branch was dead code. |
| **NEW-003** | The signed-out save was the only unguarded `localStorage.setItem` in the app, and the only one carrying base64 uploads. |
| **NEW-004** | `@types/react` was never declared — present only because `react-markdown` depends on it. One dependency change from every `.tsx` file silently becoming `any`. |

### What is genuinely left

**Nothing blocking, and nothing with a demonstrated user-visible failure except UX-001.** In rough
order of value:

1. **UX-001** (P2) — the account menu is a `<div>` with `onClick`: no keyboard access at all. The
   last open P2 with a user-visible effect, and a small fix.
2. **ARC-001** (P1→, started) — `App.tsx` is still 3,864 lines and 30 `useState`. Everything else
   about testability and the remaining bundle weight is downstream of it.
3. **ARC-003** (P2) — no observability. Worth closing before any public deployment, not before.
4. **INV-005** (P2) — no `engines` field; Node 21/23 still fail late and cryptically.
5. The **P3 correctness cluster** — `boxToSourceRect` clamping, Windows reserved device names,
   the designer filename length cap, `rankDiscovered` coercion, per-probe timeouts.
6. **PERF-002** (P3) — self-host the fonts; closes the last Google Fonts privacy exposure too.
7. An **accessibility pass** and **component tests**, both blocked on ARC-001 to varying degrees.

### Never assessed, and still not

Unchanged all session: report **fidelity** (needs a PDF with known offsets measured in the
designer), the **truncation bug** on a large report, the **designer round-trip**, anything
**visual** (contrast, focus order, responsive, screen-reader), and **line/branch coverage** — no
provider is installed. The CI workflow has still never executed, because there is still no remote.

---

## Verification performed

Every check the repository documents, run after the last commit:

```
npm run lint                                            clean
npx tsc --noEmit --noUnusedLocals --noUnusedParameters  clean
npm run lint:encoding                                   83 files, 0 mojibake
npm test  x5                                            219/219, five consecutive runs
npm run test:rules                                      29/29
npm run build                                           built, chunk sizes unchanged
```

Critical flows against the real production build: `/`, `/workspace`, `/docs`, `/privacy` all 200
HTML; `/api/health` 200 JSON; `/api/generate-report` and `/api/debug-key` still 404 JSON; the four
security headers present; `X-Powered-By` absent; port released afterwards.

**Two fixes were verified by breaking them on purpose rather than by assertion alone:**

- Lowering `PBKDF2_ITERATIONS` to 100,000 — a value `firestore.rules` still accepts — fails the
  iteration case. Switching `cacheKeyForSession` to `localStorage` fails two more. Both reverted;
  `keyVault.ts` byte-identical.
- Decoding `bindHost.ts` with codepage 1252 and writing it back produced real mojibake, which
  `npm run lint:encoding` caught and exited 1 on. **The codepage matters:** Windows-1252 maps
  `0x80` to a euro sign, which is what forms the three-character signature the check looks for.
  ISO-8859-1 maps the same byte to a control character, produces no such signature, and therefore
  reports clean on genuinely corrupt input — that first attempt nearly convinced me the check was
  broken. (Deliberately described rather than quoted: a literal example would make this file a
  second permanent exception to its own sweep, which is exactly the cost `CLAUDE.md` already pays.)

Dependencies after `npm audit fix`: **0 production advisories** (was 4), 6 all-deps (was 12) with
no critical or high. The remainder are `firebase-tools` transitives plus one `esbuild` low needing
a semver-major bump.

---

## What this pass did not verify, and still cannot

Unchanged from the audit, and unchanged by any of the work above:

- **Generation quality, `repxContent` validity, the truncation bug** — needs a Gemini key.
- **Sign-in, cloud save, account deletion end to end** — needs a live Firebase project.
- **The designer round-trip** — the companion must run on your own desktop session. The timeout
  added to `sendToDesigner` is proved by stubbed tests, not by a real companion refusing to answer.
- **The CI workflow has never executed** — there is still no remote. Every step was run locally in
  the order the workflow runs it.
- **Line/branch coverage** — no provider installed; installing one needs approval.
- **Anything visual** — no automated a11y scan, no keyboard pass, no contrast measurement.
