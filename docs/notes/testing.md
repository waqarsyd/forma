# Testing

Split out of `CLAUDE.md` on 2026-09-06, carried across unchanged apart from heading
levels, the cross-references, and the inventory — which was a run-on sentence and is a
table here. The reason for the split is the same one that produced the other four notes
on 2026-08-13, and this time it can be quantified: the inventory below was **8,400
characters, 12% of a file loaded in full into every session**, spent carrying a table
that `npx vitest run` reproduces in thirty seconds. `CLAUDE.md` keeps the two facts a
session needs regardless of what it is touching — that the suites exist and cover
little, and that you recount by running them — and routes here for the rest.

**Nothing here is loaded automatically.** Reading `CLAUDE.md`'s two-bullet summary of
this area is not a substitute for opening this file before you change it.

**This note is the only place in the repo the counts are written down.** The *Commands*
block in `CLAUDE.md` and the *Testing* section of `README.md` both describe the suites
without numbering them, on purpose — three copies of "38" drifted apart once already. If
you add a test, this is the file to update, and it should stay the only one.

## There are two test suites, and between them they still cover little

`npm test` runs Vitest over **1,906 tests in 92 files** — under the `node` environment
by default, with the eleven files that genuinely need a DOM opting into jsdom on their
own first line; see `vitest.config.ts` for why that split is load-bearing rather than
tidiness, and `CLAUDE.md` for the cold-cache cliff that makes those eleven fail in a way
that looks like a broken install.

They cover the pure helpers in `src/lib`, the config-persistence allowlist in
`reportConfigStore.ts`, the stream scanner in `geminiService.ts`, the `history` /
`location` handling in `router.ts` (the one file that is not a pure helper — it *needs*
the jsdom environment rather than merely tolerating it), the per-route titles and view
mapping in `routes.ts`, which also reads `index.html` off disk to check the home title
against the `<title>` tag, and — added by the 2026-08-27 audit — the AES-GCM key vault,
the two outbound calls that can hang, the server's response headers and bind address,
and the privacy policy's third-party disclosure, which `legalDisclosure.test.ts` checks
by reading `ContactPage.tsx` and `index.html` off disk the same way.

Each was chosen because it encodes an invariant that fails *plausibly* rather than
loudly.

**As of 2026-09-05 that is no longer the whole story, but the gap is still large.**
`App.tsx`'s view state machine and its attachment budget were extracted into
`lib/workspaceView.ts` and `lib/attachmentBudget.ts` and are now tested — which is the
route `CLAUDE.md` has always prescribed ("raise the number by shrinking `App.tsx`"), not
a widening of the coverage scope. And the first two **component** tests exist, on
`DataBinding` and `BatchPanel`, using `@testing-library/react` (a devDependency, so no
bundle cost) with `// @vitest-environment jsdom` on line 1 like every other DOM file.
Three more have joined them since; the table above is where the current set lives.

**The chat was unpicked out of `App.tsx` over 2026-09-07 and 08**, in three commits, and
took the component count to four: `lib/chatSession` holds the transcript rules,
`ChatThread` draws it, `Composer` is the box you type in. `AccountDialog` followed on
2026-09-08 and made it **five**, which is the number the table above is the authority for
— that sentence describes the day the chat was extracted, not the count today, and the
distinction is the only reason it still reads "four". **The order is the part worth
copying** — each component's render tests were written and passing *before* `App.tsx` was
switched over to it, because an extract-then-check is unverified by construction, and
that is the order that produced the bug `DataBinding` was added after. Each was then
mutated to confirm the tests could actually fail, and each swap was checked against the
running app by pixel-comparing screenshots with the run before it. Two real defects fell
out of doing it that way rather than out of the suite: Enter bypassed the send button's
`disabled` entirely, re-entering `handleGenerate` mid-request, and clicking send dropped
keyboard focus because the button disables under itself.

**Everything else is still unenforced**: `App.tsx` is several thousand lines and what has
been extracted is a small fraction of them, most components still have no render test,
and `ReportPreview` has none because its portal, `ResizeObserver` and `window.print` are
browser behaviour rather than logic — the `run-forma` skill drives those instead.
Where the documentation calls something an invariant and it is not in one of these
files, you check it by hand or it ships broken.

## The inventory

Paths are relative to `src/`. Verified against `npx vitest run --reporter=json` on
2026-09-06.

| File | Tests | |
|---|---:|---|
| `components/AccountDialog` | 23 | jsdom |
| `components/BatchPanel` | 11 | jsdom |
| `components/ChatThread` | 27 | jsdom |
| `components/Composer` | 35 | jsdom, 8 from one loop |
| `components/DataBinding` | 18 | jsdom |
| `components/DescribeReportDialog` | 6 | jsdom; the Prompt-to-Report wizard, no key and no network |
| `components/LibraryPanel` | 17 | jsdom |
| `components/ReportPreview` | 11 | jsdom; inline styles computed from the file, against what DevExpress printed; a parameter value typed over test data; a link as an anchor; Export CSV |
| `components/legalDisclosure` | 9 | 3 from one loop |
| `lib/analysisResponse` | 16 | 4 from two `it(` sharing one loop |
| `lib/announcements` | 7 |  |
| `lib/attachmentBudget` | 12 |  |
| `lib/attachmentParts` | 14 | 6 from one loop |
| `lib/attachments` | 9 |  |
| `lib/batchQueue` | 24 |  |
| `lib/chatSession` | 21 |  |
| `lib/contactSubmit` | 6 |  |
| `lib/criteria` | 10 | DevExpress's expression language; the 44 expressions and 11 totals of parity case s16, each a string DevExpress printed |
| `lib/csvExport` | 6 | CSV export; three expectations are DevExpress's own exported files, byte for byte |
| `lib/dataSource` | 29 |  |
| `lib/datetime` | 12 |  |
| `lib/designerBridge` | 38 | 8 from one loop |
| `lib/embedStore` | 20 |  |
| `lib/expressions` | 8 | the expression reference and the check a generated one is held to, including that an aggregate in a column prints blank |
| `lib/fidelity` | 18 | the benchmark's scorer; the runner under `scripts/fidelity/` is not in the suite |
| `lib/geminiClient` | 6 |  |
| `lib/geminiErrors` | 25 |  |
| `lib/generationProgress` | 22 |  |
| `lib/houseStyle` | 18 |  |
| `lib/libraryDb` | 12 | record mapping only; no IndexedDB in jsdom |
| `lib/mockupRows` | 12 |  |
| `lib/modelCache` | 17 |  |
| `lib/modelCatalog` | 24 |  |
| `lib/netDecimal` | 8 | .NET's decimal: scale, exact sums, 28-place division, both roundings |
| `lib/netFormat` | 15 | .NET composite, date and number formatting in en-US; every cell of parity case s15's format table is a string DevExpress drew |
| `lib/panelSize` | 13 |  |
| `lib/pdf` | 5 |  |
| `lib/promptSections` | 48 |  |
| `lib/promptToReport` | 9 | the pure half of Prompt-to-Report |
| `lib/reportBands` | 15 |  |
| `lib/reportConfigStore` | 15 |  |
| `lib/reportData` | 23 | 7 from one loop: every summary scope in every band of parity case s17, against DevExpress's own pages and groups; then sorting, group runs and filtering |
| `lib/reportGeometry` | 37 |  |
| `lib/reportPreview` | 216 | 18 from four loops: parity cases c05 to c05e page for page, the seven s19 nesting variants, the four one-field-per-kind cross-tabs' CSVs, and s29a and s29b |
| `lib/repx` | 24 | jsdom |
| `lib/repxAccessibility` | 21 | one loop of five control types inside one case |
| `lib/repxAudit` | 92 |  |
| `lib/repxBindingPlan` | 67 |  |
| `lib/repxBindings` | 33 |  |
| `lib/repxChunks` | 22 |  |
| `lib/repxCrossTabs` | 37 | 24 from one loop: every field shape DevExpress's `GenerateLayout()` produced, cell for cell, ten of them unseen when the rule was written |
| `lib/repxDpi` | 11 | Dpi in millimetre and pixel reports; the expectations are files DevExpress saved, stripped and repaired back |
| `lib/repxEdit` | 25 |  |
| `lib/repxGroups` | 12 | nested groups written without `Level`; parity case s19, written as DevExpress printed it inside out, repaired and paginated into the nesting it printed with `Level` |
| `lib/repxItems` | 12 |  |
| `lib/repxLayout` | 9 | controls past the printable width or their band, bands taller than the page, inside a detail report too |
| `lib/repxMargins` | 24 |  |
| `lib/repxOverlaps` | 11 | FixLayoutErrors: overlapping siblings found and moved apart |
| `lib/repxParameters` | 24 |  |
| `lib/repxRefs` | 26 |  |
| `lib/repxStyles` | 18 |  |
| `lib/repxSummaries` | 19 | totals with no running scope, which DevExpress prints blank; each fixture is a shape it was made to print |
| `lib/repxTruncation` | 19 |  |
| `lib/revisions` | 21 |  |
| `lib/revisionStore` | 26 |  |
| `lib/router` | 17 | jsdom |
| `lib/routes` | 16 |  |
| `lib/runawayOutput` | 10 |  |
| `lib/savedReport` | 33 | jsdom |
| `lib/sourceRect` | 14 |  |
| `lib/textMeasure` | 13 | line breaking and spacing as DevExpress printed them; the canvas broke 18 of 18 printed texts identically |
| `lib/themeTransition` | 15 | jsdom |
| `lib/tokenUsage` | 15 |  |
| `lib/userInstructions` | 9 |  |
| `lib/vectorSearch` | 14 |  |
| `lib/workspaceView` | 11 |  |
| `lib/xlsxExport` | 9 | Excel export; the expectations are DevExpress's own workbooks read into grids, one by fingerprint |
| `lib/zip` | 25 |  |
| `server/bindHost` | 6 |  |
| `server/hostingConfig` | 9 | reads `firebase.json` off disk |
| `server/securityHeaders` | 27 |  |
| `server/staticCache` | 10 |  |
| `services/chatRetry` | 10 |  |
| `services/embeddings` | 20 | SDK mocked, as `geminiService` is |
| `services/generationRetry` | 7 | the generation path's runaway and truncated-stream retries, against a stubbed stream |
| `services/geminiService` | 33 | 7 of these come from one loop |
| `services/keyVault` | 21 | jsdom |
| `services/library` | 15 | storage and embedding injected |
| `services/modelResolution` | 32 | jsdom |
| `services/promptToExpression` | 4 | a sentence to an expression, checked against the fields, against a stubbed reply |
| `services/promptToReport` | 7 | description-mode framing, the overlap repair and the clarification call, against a stubbed stream |
| `services/testData` | 4 | AI-generated sample rows, keyed by bound field, against a stubbed reply |

**Total: 1,906 in 92 files** — and that total is the arithmetic sum of the column above
it, which is the point of writing both down. A mismatch between them is the cheapest
possible signal that this table went stale, so adding a case changes **two** numbers
here, not one.

It has worked, late: `reportBands` was recorded as 16 and had been 17 since `183cce5`,
which added a case and bumped only the total. Corrected 2026-09-05 — but the entry sat
wrong for four commits, which is how long a one-file discrepancy can hide when nobody
adds up thirty-nine numbers. The table format is partly a response to that: a column is
easier to sum than a paragraph, and `npx vitest run --reporter=json` will produce the
whole thing for you.

## Recount by running the suite, never by grepping

A grep for `\bit(` answers **1,835** against a real 1,906 and will talk you into
"correcting" numbers that were already right. **Nine** files generate cases from a loop,
and they are marked in the table above: `geminiService` produces seven of its 33 from
one `it(` over split points, `designerBridge` eight of its 38 over Windows reserved
device names, `attachmentParts` six of its fourteen over malformed data URLs,
`legalDisclosure` three of its nine over the disclosure table, `Composer` eight of its 35
from **two** `it(` sharing one loop over the four conditions that must block a send,
`analysisResponse` four of its sixteen from **two** `it(` sharing one loop over stop
reasons — the shape `Composer` now also has — `reportData` seven of its 23 from one
`it(` over the bands of parity case s17, and `reportPreview` eighteen of its 216 from four
`it(`, one over the five c05 cases, one over the seven s19 nesting variants, one over four cross-tabs and one over s29a and s29b, and
`repxCrossTabs` twenty-four of its 37 from one `it(` over the field shapes DevExpress generated.

**The shortfall is a constant, not a coincidence** — every other file adds as many tests
as it has `it(` calls, so both totals move together. **A change in the *gap* is the
signal worth reading**: it means a loop was added or removed, and nothing else does it.

**It was 22 from the split until 2026-09-08, and it is 28 now.** `Composer`'s loop is
what moved it — one `for` over four blocking conditions, each asserting both that Enter
is refused and that the button is disabled, so two `it(` calls became eight tests and the
gap grew by six. That is the mechanism working as designed rather than a discrepancy to
hunt: the number changed because a loop was genuinely added, which is exactly what this
paragraph exists to let you conclude in one step.

**It is 44 as of 2026-10-30**, and the same reading applies twice. `reportData` added
one `for` over seven bands, so one `it(` became seven tests and the gap grew by six.
`reportPreview` then added two: five c05 cases from one `it(` and seven s19 variants from
another, ten more. It is **67** after parity row 30: `repxCrossTabs` added one `for` over
24 shapes, so one `it(` became 24 tests and the gap grew by 23. It is **70** after row 31,
whose loop over four cross-tabs added three more, and **71** after row 36, whose loop over s29a and s29b
so every other file's grep count still matches the table.

Two ways the arithmetic goes wrong:

- **The gap can close from the wrong end.** Prose mentioning the vitest call counts as a
  grep hit, so a file discussing this trap inflates the grep instead of deflating it and
  the two errors quietly cancel. `repxBindings.test.ts` deliberately avoids naming the
  call in its own header comment for this reason. This note is not swept by that grep —
  it lives in `docs/` and the pathspec is `src/**/*.test.ts` — but keep the habit.
- **The word boundary is load-bearing.** A bare `it(` also matches `omit(`, which scores
  `repx.test.ts` at 27 instead of 24. Every file outside the nine loop files has a grep
  count matching this table exactly, but only with `\b`.

## The rules suite is three files, and the second is the non-obvious one

`npm run test:rules` runs **70 tests in three files** against the Firestore emulator:

| File | Tests | What it proves |
|---|---:|---|
| `tests/firestore.rules.test.ts` | 45 | account isolation, document shape, the key vault, the version subcollection |
| `tests/accountDeletion.test.ts` | 15 | deleting an account really removes the reports, **their version history** and the encrypted key |
| `tests/revisionRoundTrip.test.ts` | 10 | a history saved and read back through the same `saveRevisions` / `loadRevisions` the app calls |

`accountDeletion` earns its place because **Firestore does not delete a subcollection
with its parent document**, so a report removed with a bare `deleteDoc` strands its
whole history — and the result is indistinguishable from a clean delete. It runs through
an authenticated context with the production rules enforced.

`revisionRoundTrip` exists because the other two cannot see each other: a plan that is
right in memory and a rule that is right in isolation still produce nothing useful if
the read comes back in an order the numbering did not expect, and `fromVersionDocuments`
numbers downwards from the newest on the strength of the caller's `orderBy`.

## Test placement is two conventions, and the split is load-bearing

Colocated `*.test.ts` beside the module for the unit suite; `tests/` at the **root**,
outside `src/`, for anything needing the Firestore emulator. That is *why* it is outside
— it is what stops `npm test` trying to start a JVM.

**A module can have a file in both**, and `revisionStore` is the first:
`src/lib/revisionStore.test.ts` covers the planning and numbering against arrays, while
`tests/revisionRoundTrip.test.ts` drives the same functions against real Firestore
through an injected `VersionIo`. Neither is redundant — the array test cannot see an
ordering the emulator returns, and the emulator test is too slow to enumerate edge cases
in.

**The `src/server/` tests stay under `src/` for a reason that is easy to undo.**
`vitest.config.ts` has `include: ['src/**/*.test.{ts,tsx}']`, so moving them to a
root-level `server/` would silently drop **forty-two** cases — `6 + 26 + 10`, from the
inventory above. If you ever do move them, widen that include in the same commit and
check the count against the total. (Forty-two is the durable number here. `CLAUDE.md`
used to write it as a before-and-after pair of suite totals, which was stale within days
of every commit; the subtraction is the fact, not the endpoints.)

## A component test's job is what the user is shown, not how it looks

The two that exist were written after three render defects shipped in one day:

1. a pane that said "cannot be bound yet" immediately after a successful bind;
2. a button styled with a modifier class that does not exist;
3. JSX dropping the space before a word.

**Only the first is a component test's business** — it is state logic, and there is a
test that fails if the ordering is restored. The second and third are what looking at a
screenshot is for, which is why the `run-forma` skill exists alongside these tests and
not instead of them.

## What `npm run test:coverage` measures, and the two zeroes that are not gaps

The number it prints is scoped on purpose. `vitest.config.ts` includes only
`src/lib/**` and `src/services/**` — `App.tsx` and the twenty components are **not** in
the denominator, because counting code that cannot be unit-tested until `App.tsx` is
broken up would move the figure for reasons unrelated to whether anything got safer. Do
not "fix" that by widening the include list; **raise the number by shrinking `App.tsx`**,
which is what `workspaceView` and `attachmentBudget` were.

**Two zeroes in the report are not untested paths.** `src/lib/accountData.ts` reads 0%
because everything exercising it lives in `tests/accountDeletion.test.ts`, which runs
under the *other* config against the emulator and is not in this run at all.
`src/services/firebase.ts` reads 0% because it is the Firebase singleton — importing it
initialises an app, and there is nothing in it to unit-test.

The config says all of this at the point of use; read the comment there before changing
the block.

## Running one file, and what that does not buy you

Run a single test file with `npx vitest run src/lib/repx.test.ts`, or a single case with
`-t "<name>"`. **Narrowing to one file buys clarity, not time.** The numbers `CLAUDE.md`
used to give (~30s against ~34s) were measured cold and are wrong by an order of
magnitude: re-measured 2026-08-20, the first `npm test` of a session took 52s and the
very next one 4.6s, while a single file is ~5s either way. Warm, one file and all
fifty-two cost about the same.

Read a slow first run as a cold cache, not as a hang — and never quote a timing anywhere
in this repository that came from a cold run.

## A cold cache can look exactly like a broken install

**Until 2026-08-28 a cold cache did worse than crawl: it made the suite fail outright.**
jsdom's entry loads synchronously, and cold it was measured at **113 seconds** in one
process on this machine against 1.4s warm — while vitest gives a worker **60 seconds** to
report in (`START_TIMEOUT`, hardcoded in vitest's dist with no config option feeding it).
Every worker died before starting, and all 25 files of the day reported
`[vitest-pool-runner]: Timeout waiting for worker to respond`, which reads as a broken
pool or a broken install and is really a stopwatch.

**If you see that error, the suite is not broken and neither is your install. But do not
just run it again** — that was the advice until 2026-09-04 and it is wrong. Each worker
is killed at the 60s mark *before* it finishes populating the cache, so every re-run pays
the full cold price and dies in exactly the same place; you can repeat it all afternoon.
The warm-up has to happen **outside** vitest, in a process nothing is timing:

```powershell
node -e "import('jsdom')"    # takes as long as it takes; then npm test
```

Measured on 2026-09-04: that import took **507 seconds**, the second one 1.69s, and
`npm test` then ran green in 4.52s. The cold figure is 4.5x the 113s recorded in 2026-08
— this is a shared machine and the cold cost tracks I/O contention, so **re-measure
rather than trusting either number**. What is stable is the shape (one enormous first
load, then ~1.5s) and the 60s ceiling it has to fit under. `README.md` carries the same
figures, so re-measuring is a change to two files.

**The environment split narrowed the cliff without removing it.** Keeping the majority of
files under `node` cut summed environment setup from ~66s to ~8s and took the cliff from
every worker down to the ones that opt in — and it still fires: `themeTransition.test.ts`
died on both 2026-09-02 and 2026-09-04. The jsdom files are marked in the inventory above.
**When only the jsdom files fail and every other file passes, this is what you are
looking at.**

*Measured 2026-09-08:* **11 jsdom files holding 251 tests, 48 node files holding 1,063.**

(Read that as a dated measurement, not a maintained figure. The sentence above used to
carry the numbers inline and has been wrong three times: "24 of the 30 files … 366 tests"
until 2026-09-06, then "44 of the 52 … 935" for a suite that was already 53 files and 985
node tests, then "the eight jsdom files hold 167" for eleven files holding 251. Three
corrections is enough evidence that a hand-maintained split does not survive, so the
prose no longer depends on one — the shape of the failure is the part worth recognising,
and the arithmetic is one command away.

**Derive it, do not adjust it.** The jsdom files are the ones with
`// @vitest-environment jsdom` on line 1; sum their rows in the table above for the jsdom
figure, and the node figure is the table's total minus that. Both fall out of the
inventory, which is the only thing here anyone actually keeps current.)

**One red file after a cold run was the same stopwatch wearing a different error, and
the fix was not where two attempts looked for it.** From 2026-09-05 to 2026-10-28,
`src/services/chatRetry.test.ts` failed its first case — *retries and returns the reply
instead of failing* — with `Test timed out in 5000ms` in roughly one full-suite run in
ten, never when run alone, and on 2026-10-28 for the first time on the CI runner. The
test advances a fake clock through two backoffs, so both fixes tried on 2026-09-08
adjusted the clock, and both made it fail more often; the file's `runTurn` comment kept
that record and said the next attempt should start by finding what was still pending
when the budget expired. The answer was the SDK. `chatReply` reaches `@google/genai`
through `loadGenAI()`, which imports it on first use so the landing page does not carry
it, and in this file the first use was inside the first test — so the first test paid
for loading the SDK from disk against its own 5s budget while every later test found the
module cached. Measured with the file alone and warm: the first case took 250ms and the
other nine took 2 to 9ms, and a fresh Node process imports the package in ~150ms. Under a
full suite, with a cold cache or on CI (which is cold every time), that one import
occasionally exceeded 5s. The fix is a `beforeAll` in that file that imports the SDK
with a 60s budget of its own, before any test's clock starts; the first case then
measures 49ms. `resetGenAIForTests()` clears only the memoised promise, not Node's
module cache, so warming the module once is enough and every test still exercises
`loadGenAI()`. **The general lesson is the one above with a different lazy loader**: a
dependency that is loaded on first use lands its cold cost inside whichever test uses it
first, and that test's duration will be an order of magnitude above its neighbours' even
when it passes. `src/lib/pdf.ts` and `src/lib/firebaseClient.ts` are the other two
loaders, so a first-case-only timeout in a file that reaches either should start here.

**`--reporter=basic` no longer exists.** Vitest 4 removed it, and an unknown reporter
name is treated as a module to import, so the failure is a `Failed to load custom
Reporter from basic` / `Failed to load url basic (resolved id: basic)` stack trace with
Vite frames in it — which reads like a broken config rather than a bad flag value.
`vitest.config.ts` already sets `reporters: 'default'`; pass `--reporter=dot` for the
terse output `basic` used to give. Verified on vitest 4.1.10.

## Three configs, and the rules suite uses its own

`npm run test:rules` is `firebase emulators:exec --only firestore "vitest run --config
vitest.rules.config.ts"`. **The emulator wrapper is what supplies the Firestore
instance**, so `vitest run --config vitest.rules.config.ts` on its own has nothing to
talk to. `tests/firestore.rules.test.ts` sits outside `src/`, which is why the default
config never picks it up and `npm test` cannot run it by accident.

`vitest.config.ts` is deliberately separate from `vite.config.ts` — that one carries the
"Do not modify" HMR block and is loaded by the dev server. Tests live beside what they
test as `*.test.ts`, and the default config only picks up `src/**/*.test.ts`.

## Running a single rules case: use a space-free regex

**Do not try to nest quotes.** The `-t` flag has to go *inside* the quoted command the
emulator wrapper runs, and PowerShell 5.1 re-parses that string before `firebase` ever
sees it, so the obvious `-t \"lets a user read their own report\"` arrives mangled
(observed: `Script "… -t " lets a user read their own report\" exited with code 1`).
`-t` is a **regex**, so a `.` in place of each space sidesteps quoting entirely:

```powershell
npx firebase emulators:exec --only firestore "npx vitest run --config vitest.rules.config.ts -t lets.a.user.read.their.own.report"
```

Verified: `1 passed | 28 skipped`. A distinctive single word (`-t isolation`) works the
same way and is shorter.
