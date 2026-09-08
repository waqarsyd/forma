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

`npm test` runs Vitest over **1,202 tests in 56 files** — under the `node` environment
by default, with the nine files that genuinely need a DOM opting into jsdom on their
own first line; see `vitest.config.ts` for why that split is load-bearing rather than
tidiness, and `CLAUDE.md` for the cold-cache cliff that makes those eight fail in a way
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

**Everything else is still unenforced**: `App.tsx` is several thousand lines and the
two extractions are perhaps sixty of them, no other component has a render test, and
`ReportPreview` has none because its portal, `ResizeObserver` and `window.print` are
browser behaviour rather than logic — the `run-forma` skill drives those instead.
Where the documentation calls something an invariant and it is not in one of these
files, you check it by hand or it ships broken.

## The inventory

Paths are relative to `src/`. Verified against `npx vitest run --reporter=json` on
2026-09-06.

| File | Tests | |
|---|---:|---|
| `components/BatchPanel` | 10 | jsdom |
| `components/ChatThread` | 19 | jsdom |
| `components/DataBinding` | 15 | jsdom |
| `components/legalDisclosure` | 9 | 3 from one loop |
| `lib/analysisResponse` | 16 | 4 from two `it(` sharing one loop |
| `lib/announcements` | 7 |  |
| `lib/attachmentBudget` | 12 |  |
| `lib/attachmentParts` | 14 | 6 from one loop |
| `lib/attachments` | 9 |  |
| `lib/batchQueue` | 24 |  |
| `lib/chatSession` | 19 |  |
| `lib/contactSubmit` | 6 |  |
| `lib/dataSource` | 29 |  |
| `lib/datetime` | 12 |  |
| `lib/designerBridge` | 33 | 8 from one loop |
| `lib/geminiClient` | 6 |  |
| `lib/geminiErrors` | 14 |  |
| `lib/generationProgress` | 22 |  |
| `lib/mockupRows` | 12 |  |
| `lib/modelCatalog` | 16 |  |
| `lib/panelSize` | 13 |  |
| `lib/pdf` | 5 |  |
| `lib/promptSections` | 48 |  |
| `lib/reportBands` | 15 |  |
| `lib/reportConfigStore` | 15 |  |
| `lib/reportGeometry` | 37 |  |
| `lib/reportPreview` | 90 |  |
| `lib/repx` | 24 | jsdom |
| `lib/repxAudit` | 81 |  |
| `lib/repxBindingPlan` | 63 |  |
| `lib/repxBindings` | 33 |  |
| `lib/repxEdit` | 24 |  |
| `lib/repxItems` | 12 |  |
| `lib/repxMargins` | 19 |  |
| `lib/repxParameters` | 24 |  |
| `lib/repxRefs` | 26 |  |
| `lib/repxStyles` | 17 |  |
| `lib/repxTruncation` | 19 |  |
| `lib/revisions` | 21 |  |
| `lib/revisionStore` | 26 |  |
| `lib/router` | 17 | jsdom |
| `lib/routes` | 16 |  |
| `lib/savedReport` | 33 | jsdom |
| `lib/sourceRect` | 14 |  |
| `lib/themeTransition` | 15 | jsdom |
| `lib/tokenUsage` | 15 |  |
| `lib/userInstructions` | 9 |  |
| `lib/workspaceView` | 11 |  |
| `lib/zip` | 24 |  |
| `server/bindHost` | 6 |  |
| `server/securityHeaders` | 27 |  |
| `server/staticCache` | 10 |  |
| `services/chatRetry` | 6 |  |
| `services/geminiService` | 30 | 7 of these come from one loop |
| `services/keyVault` | 21 | jsdom |
| `services/modelResolution` | 32 | jsdom |

**Total: 1,202 in 56 files** — and that total is the arithmetic sum of the column above
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

A grep for `\bit(` answers **1,180** against a real 1,202 and will talk you into
"correcting" numbers that were already right. **Five** files generate cases from a loop,
and they are marked in the table above: `geminiService` produces seven of its 22 from
one `it(` over split points, `designerBridge` eight of its 33 over Windows reserved
device names, `attachmentParts` six of its fourteen over malformed data URLs,
`legalDisclosure` three of its nine over the disclosure table, and `analysisResponse`
four of its sixteen from **two** `it(` sharing one loop over stop reasons — which is the
shape the other four do not have.

**The 22-test shortfall is a constant, not a coincidence.** `reportPreview`,
`dataSource` and `repxEdit` each add as many tests as they have `it(` calls, so both
totals move together and the gap stays at 22. **A change in the *gap* is the signal
worth reading** — it means a loop was added or removed.

Two ways the arithmetic goes wrong:

- **The gap can close from the wrong end.** Prose mentioning the vitest call counts as a
  grep hit, so a file discussing this trap inflates the grep instead of deflating it and
  the two errors quietly cancel. `repxBindings.test.ts` deliberately avoids naming the
  call in its own header comment for this reason. This note is not swept by that grep —
  it lives in `docs/` and the pathspec is `src/**/*.test.ts` — but keep the habit.
- **The word boundary is load-bearing.** A bare `it(` also matches `omit(`, which scores
  `repx.test.ts` at 27 instead of 24. The other forty-six files' grep counts match this
  table exactly, but only with `\b`.

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

**The environment split narrowed the cliff without removing it.** Keeping 46 of the 54
files under `node` cut summed environment setup from ~66s to ~8s and took the cliff from
every worker down to the eight that opt in — and it still fires: `themeTransition.test.ts`
died on both 2026-09-02 and 2026-09-04. The eight are marked in the inventory above.
**When only those eight fail and the other 46 pass with 997 tests, this is what you are
looking at.**

(That last sentence read "24 of the 30 files ... 366 tests" until 2026-09-06, and the
same passage said the cliff was down to "the six that opt in" two sentences before
listing eight; the correction then wrote "44 of the 52 ... 935" for a suite that was
already 53 files and 985 node tests, so the same sentence has now been stale twice. The
numbers are worth keeping because they are what you compare a failing run against —
which is exactly why they have to be corrected when the suite grows, and why they live
here now rather than in a file that carries no other counts. Derive them rather than
adjusting them by hand: the eight jsdom files hold 167 tests between them, so the node
figure is the table's total minus 167.)

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
