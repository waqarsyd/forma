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

`npm test` runs Vitest over **1,102 tests in 52 files** — under the `node` environment
by default, with the eight files that genuinely need a DOM opting into jsdom on their
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

**Everything else is still unenforced**: `App.tsx` is ~4,450 lines and the two
extractions are perhaps sixty of them, no other component has a render test, and
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
| `components/DataBinding` | 15 | jsdom |
| `components/legalDisclosure` | 9 | 3 from one loop |
| `lib/analysisResponse` | 16 | 4 from two `it(` sharing one loop |
| `lib/announcements` | 7 |  |
| `lib/attachmentBudget` | 12 |  |
| `lib/attachmentParts` | 14 | 6 from one loop |
| `lib/attachments` | 9 |  |
| `lib/batchQueue` | 24 |  |
| `lib/contactSubmit` | 6 |  |
| `lib/dataSource` | 29 |  |
| `lib/datetime` | 12 |  |
| `lib/designerBridge` | 33 | 8 from one loop |
| `lib/geminiClient` | 6 |  |
| `lib/geminiErrors` | 14 |  |
| `lib/generationProgress` | 22 |  |
| `lib/modelCatalog` | 16 |  |
| `lib/panelSize` | 13 |  |
| `lib/pdf` | 5 |  |
| `lib/promptSections` | 41 |  |
| `lib/reportBands` | 12 |  |
| `lib/reportConfigStore` | 15 |  |
| `lib/reportGeometry` | 37 |  |
| `lib/reportPreview` | 87 |  |
| `lib/repx` | 24 | jsdom |
| `lib/repxAudit` | 68 |  |
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
| `lib/userInstructions` | 9 |  |
| `lib/workspaceView` | 11 |  |
| `lib/zip` | 24 |  |
| `server/bindHost` | 6 |  |
| `server/securityHeaders` | 26 |  |
| `server/staticCache` | 10 |  |
| `services/chatRetry` | 6 |  |
| `services/geminiService` | 22 | 7 of these come from one loop |
| `services/keyVault` | 21 | jsdom |
| `services/modelResolution` | 32 | jsdom |

**Total: 1,102 in 52 files** — and that total is the arithmetic sum of the column above
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

A grep for `\bit(` answers **1,080** against a real 1,102 and will talk you into
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
  `repx.test.ts` at 27 instead of 24. The other forty-five files' grep counts match this
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

This is also why `revisionStore` is the one module with a file in both places — see the
test-placement bullet in `CLAUDE.md`'s *Structure conventions*. Neither is redundant:
the array test cannot see an ordering the emulator returns, and the emulator test is too
slow to enumerate edge cases in.

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
