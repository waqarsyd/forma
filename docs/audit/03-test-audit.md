# Phase 3 — Test Audit

> **Status: superseded in part.** This file records the repository as found on 2026-08-27, *before*
> any fix. Seven roadmap items have since landed and 11 findings are closed — see
> [`07-implementation.md`](07-implementation.md) for current counts and finding status. This file is
> deliberately left unedited as the baseline.

**No coverage was generated.** No provider is installed (`@vitest/coverage-v8` and
`-istanbul` are both absent from `package.json` and from `node_modules`), and installing one
modifies the lockfile, which ground rule 4 puts behind approval. Everything below is a **hand-built
map from imports to exports**, verified file by file. It is weaker than line/branch coverage in one
specific way — it cannot see *within* a covered function — and stronger in another: it distinguishes
"this module has a test file" from "this module is tested", which a global percentage cannot.

---

## 1. Inventory

| | |
|---|---|
| Frameworks | Vitest 4.1.10 — one framework, two configs |
| Unit suite | 13 files, **167 tests**, jsdom, `src/**/*.test.ts`, 4.1s warm |
| Rules suite | 1 file, **29 tests**, node + Firestore emulator, 9.06s (95.6s including emulator boot) |
| Integration | **none** |
| E2E | **none** |
| Contract | **none** |
| Component / render | **none** |
| Visual regression | **none** |
| Load / perf | **none** |
| Accessibility | **none** |
| Fuzz / property | **none** |
| Mutation | **none** |
| Pass/fail right now | **196 / 196 passing**, both suites, exit 0 |

Tests live beside what they test as `*.test.ts`. The rules suite sits outside `src/` specifically so
`npm test` cannot pick it up and demand Java — a deliberate separation documented in
`vitest.rules.config.ts:3-11` and verified: the two configs' `include` globs do not overlap.

---

## 2. Coverage map

### The headline number is 18.6%, and it is the wrong number

Counting modules that merely *have* a test file: **13 of 38** source modules, **2,779 of 14,915
lines (18.6%)**.

That figure is inflated by one entry. `src/services/geminiService.ts` is 1,542 lines and counts as
"covered", but `geminiService.test.ts` imports exactly two of its symbols:

```ts
import { extractPartialReply, asReadableError } from './geminiService';
```

Two pure helpers, roughly 70 lines between them, out of eleven exported functions. Nothing tests
`analyzeReportDesign`, `chatReply`, `resolveModel`, `validateApiKey`, `readCachedModel` or the
mega-prompt construction.

**Corrected for what is actually exercised, the figure is ≈ 8.8% (1,307 of 14,915 lines).**

### Per-module, honestly

| Module | Lines | Exports | Exports tested | Verdict |
|---|---|---|---|---|
| `lib/repx.ts` | 240 | 3 | **3** | Complete |
| `lib/router.ts` | 95 | 5 | **5** | Complete |
| `lib/routes.ts` | 123 | 4 | **4** | Complete |
| `lib/reportGeometry.ts` | 109 | 8 | 8 | Complete |
| `lib/modelCatalog.ts` | 155 | 3 | **3** | Complete |
| `lib/panelSize.ts` | 71 | 5 | 5 | Complete |
| `lib/reportConfigStore.ts` | 82 | 3 | **3** | Complete |
| `lib/attachments.ts` | 75 | 2 | **2** | Complete |
| `lib/announcements.ts` | 51 | 3 | 3 | Complete |
| `lib/datetime.ts` | 67 | 2 | 2 | Complete |
| `lib/sourceRect.ts` | 38 | 2 | 2 | Complete |
| `lib/designerBridge.ts` | 131 | 6 | **1** | **Partial — `designerFileName` only** |
| `services/geminiService.ts` | 1,542 | ~11 | **2** | **Partial — the stream scanner only** |
| `services/keyVault.ts` | 227 | — | **0** | **None** |
| `services/firebase.ts` | 221 | — | 0 | None |
| `lib/motion.ts` | 111 | — | 0 | None |
| `App.tsx` | 4,221 | — | **0** | **None** |
| 20 components | 6,196 | — | 0 | None |
| `firestore.rules` | 117 | — | 29 tests | **Complete — the best-covered file in the repo** |

### Mapped onto the critical flows

| # | Flow | Coverage | Reality |
|---|---|---|---|
| 1 | Upload → generate → spec + mockup + `.repx` | **~5%** | `checkRepx` validates the output shape and `reportGeometry` pins the conversions. The *flow* — ingest, prompt, stream, cancel, commit — has nothing. |
| 2 | Key handling | **rules only** | The 29 rules tests prove the vault's **storage shape**. The crypto itself — encrypt/decrypt round-trip, wrong passphrase, tampered ciphertext — has **no test at all**. |
| 3 | Sign in → save → reload → reopen | **rules only** | Firestore side proved; the UI round-trip and the `localStorage` fallback path have nothing. |
| 4 | Account deletion removes reports **and** vault | **0%** | Nothing. |
| 5 | Routing / deep links / titles | **~95%** | The best-covered flow. `router.test.ts` (17) + `routes.test.ts` (13), including reading `index.html` off disk to check the `/` title. |
| 6 | Open in designer | **~15%** | Filename derivation only. The ping, the protocol launch, the wait loop and the POST are untested. |

**A 90% global number would mean nothing here — and there isn't one.** What the map shows is a
suite that is excellent where it exists and absent everywhere the product's value lives.

---

## 3. Test quality — the part that is genuinely excellent

Scanned all 14 test files for the standard anti-patterns:

| Anti-pattern | Count |
|---|---|
| Tests with no assertion | **0** |
| `.skip` / `.todo` / `xit` / `xdescribe` | **0** |
| `.only` | **0** |
| Snapshot tests | **0** |
| Real sleeps / `await new Promise(setTimeout)` | **0** |
| Real network | **0** |
| Unseeded randomness | **0** |
| `Date.now()` / `new Date()` in a test | **1** (see below) |
| Files using mocks at all | **1 of 14** |

Assertion density is 260 `expect(` calls across 167 unit tests, ~1.6 per test — healthy, neither
assertion-free nor shotgun.

**The one mocking file is legitimate.** `router.test.ts` uses 7 `vi.*` calls to stub jsdom's
`history`/`location`, which is the thing under test. This is not mock theater: the assertions are
on resulting URL state, not on whether a mock was called.

**The one time dependency is safe.** `tests/firestore.rules.test.ts:32` uses `Date.now()` for a
document timestamp. The rule it exercises bounds `timestamp < 4102444800000` (2100-01-01), so the
test is deterministic until the year 2100. Worth knowing, not worth changing.

**`expect` count of 0 for the rules suite is a false alarm.** It uses `assertSucceeds` (10) and
`assertFails` (29) from `@firebase/rules-unit-testing`. Any coverage-by-grep of this repo will
mis-score that file; noted so nobody "fixes" it.

**The stated design philosophy holds up.** `README.md:143` claims the suite targets functions whose
invariants *"fail plausibly rather than loudly"*. Reading the cases, that is accurate:
`sourceRect.test.ts` pins the y-before-x box ordering that would transpose every crop into a
believable wrong position; `reportGeometry.test.ts` pins 254-not-250; `routes.test.ts` asserts
`routesWithoutABranch()` stays empty, catching the one of three edits a new route needs that fails
silently. These are chosen, not generated.

**Assessment: the tests that exist are better than most production codebases have. There are just
very few of them.**

---

## 4. Test infrastructure

- **Fixtures/factories:** none, and none needed at this scope — the pure helpers take primitives.
  The rules suite builds documents inline, which is readable at 29 cases and would not be at 200.
- **Isolation:** the rules suite clears Firestore between cases and sets `fileParallelism: false`
  (`vitest.rules.config.ts:20`) because the cases share one emulator. Correct, and the reason is
  written down.
- **Parallelism:** the unit suite runs workers in parallel; `environment 20.96s` summed across
  workers against 2.48s wall confirms it.
- **CI:** **none.** Nothing gates a merge because there are no merges — single contributor, no
  remote, no PRs. This is INV-003.
- **Coverage tooling:** not installed (INV-004).
- **Flake:** no flaky pattern found by inspection. Not proven — the pack's standard is running the
  suite five times, and I ran it once. At 4.1s that is a 20-second check nobody has an excuse to
  skip, and it is worth doing before trusting the "no flakes" claim.

---

## 5. Missing test types

| Type | Present | Would it pay here? |
|---|---|---|
| Component / render | No | **Yes — the biggest gap.** Blocked by ARC-001; needs extraction first. |
| Integration | No | **Yes**, for the Firestore round-trip against the emulator that already runs. |
| Contract | No | **Yes, narrowly** — a schema check on the Gemini response shape would catch a model returning a changed structure, which is a live risk given runtime model detection. |
| Crypto round-trip | No | **Yes** — see TEST-001. Highest value per line in this list. |
| E2E | No | Not yet. Needs a key and a live project; the cost is real and the payoff is low at this stage. |
| Visual regression | No | **Maybe.** `workspace.css` (1,652 lines) and `index.css` (926) change often and nothing checks them. A screenshot diff on three pages would be cheap. |
| Accessibility | No | **Yes** — an axe pass on the five marketing pages is close to free and there is no baseline. |
| Load / perf | No | No. No server, no traffic, nothing to load-test. A bundle-size budget is the useful analogue. |
| Fuzz / property | No | Partly done ad hoc — Phase 4's probe found four real issues in an hour. Worth keeping a small property suite for `reportGeometry` round-trips. |
| Mutation | No | No. Premature at 9% coverage. |

---

## 6. The ten most dangerous untested paths

Ranked by (likelihood of breaking × blast radius), not by size.

| # | Path | Where | Why it is dangerous |
|---|---|---|---|
| **1** | **Key vault encrypt/decrypt round-trip** | `services/keyVault.ts` (227 lines, 0 tests) | A silent break means either a user's stored key cannot be recovered (unrecoverable by design — there is no reset) or, far worse, a change that weakens the encryption goes unnoticed. The *rules* are tested; the *cryptography* is not. Cheapest high-value test in the repo: it is pure Web Crypto, runs in jsdom, needs no key and no network. |
| **2** | **`handleGenerate` progress / cancellation / error classification** | `App.tsx:2609-2824` | 216 lines, highest churn, the product's core flow, every failure branch (429, 503, abort mid-stream, truncation) verified only by hand with a real key. |
| **3** | **Account deletion removing reports *and* vault** | `App.tsx` + `AccountDialog.tsx` | A miss leaves an encrypted credential and a user's documents behind after they asked for deletion. Privacy exposure, and the emulator could test it today. |
| **4** | **The `localStorage` ↔ Firestore shape divergence** | `App.tsx` save/load paths | `docs/notes/persistence.md` records that the two shapes differ. Two representations of the same object with no test asserting they round-trip is how a signed-out user's saved report becomes unreadable after they sign in. |
| **5** | **`sendToDesigner` / `waitForDesigner` / `launchDesigner`** | `lib/designerBridge.ts` (5 of 6 exports untested) | Includes the missing-timeout bug (REL-002) and the protocol-launch path — the one route by which a web page starts a local program. |
| **6** | **`analyzeReportDesign` response parsing** | `geminiService.ts:810+` | Where the known truncation bug lives. A malformed or truncated model response must degrade to a clear error, not a half-written `.repx`. Testable against captured fixtures with no key. |
| **7** | **`ingestFile` — PDF/image/`.repx` intake** | `App.tsx:336-421` | 85 lines handling three file types, pdf.js, and image resizing. Every malformed-upload path is unexercised: encrypted PDF, 0-byte file, a `.repx` that is not XML, a 50 MB image. |
| **8** | **`optimizeImageDataUrl`** | `App.tsx:450-496` | Directly determines whether a saved report exceeds Firestore's 1 MiB limit — a failure mode `README.md:174` already documents as live. |
| **9** | **Auth state transitions** | `App.tsx:1494` | Sign-out must clear the in-memory key (`:2346` does this deliberately). Sign-in must not clobber the workspace. Both are one-line regressions away and neither is tested. |
| **10** | **Theme resolution across its four sources** | `index.html:14-24` + `App.tsx:2071` | The pre-paint bootstrap in `index.html` and the React resolution must agree or every dark-mode user gets a flash. Two copies of one rule in two languages, verified by looking at a page. |

---

## Findings

---

**ID:** TEST-001
**Title:** `keyVault.ts` — the cryptography protecting stored API keys — has no unit test
**Severity:** P1
**Confidence:** High
**Location:** `src/services/keyVault.ts` (227 lines); no `keyVault.test.ts` exists
**Evidence:** `git ls-files src/**/*.test.ts` returns 13 files; none is `keyVault.test.ts`. The
module implements PBKDF2-HMAC-SHA256 at 310,000 iterations (`:41`) deriving an AES-GCM-256 key
(`:100-102`), with a 16-byte salt and 12-byte IV from `crypto.getRandomValues` (`:122-123`), plus
`sessionStorage` caching (`:187-207`) and a legacy `localStorage` migration that deletes the old
plaintext entry (`:215-221`). `tests/firestore.rules.test.ts` covers the *storage shape* of the
resulting document — `hasOnly`/`hasAll` on the five fields, the size bound, the iteration floor —
but never calls `keyVault.ts`.
**Why it matters:** `README.md:28` promises *"a forgotten passphrase is unrecoverable by design"*.
That promise makes a decryption regression permanently destructive: there is no reset path, so a
change that breaks round-trip silently orphans every stored key. In the other direction, a change
that weakened the KDF would pass every existing check — the rules only enforce
`iterations >= 100000`, while the code uses 310,000, so a client-side drop to the floor is
invisible to the one test that looks at this data.
**Repro:** No test imports the module. Verified by grep across all 14 test files.
**Recommendation:** Add `src/services/keyVault.test.ts`. It needs no key, no network and no
emulator — Web Crypto is available in jsdom. Cover: (a) encrypt → decrypt returns the original
string; (b) a wrong passphrase fails rather than returning garbage (AES-GCM is authenticated, so
this should reject); (c) tampered ciphertext fails; (d) `iterations` is written as 310,000, pinned
as a literal so a future weakening is a failing test; (e) salt and IV differ between two encryptions
of the same input; (f) the legacy `localStorage` key is removed after migration. Six tests, an hour,
and it closes the highest-consequence untested path in the project.
**Effort:** S
**Fix risk:** None — additive.

---

**ID:** TEST-002
**Title:** `geminiService.ts` counts as covered but 2 of ~11 exports are tested, inflating the coverage picture 2×
**Severity:** P2
**Confidence:** High
**Location:** `src/services/geminiService.test.ts:2`; `src/services/geminiService.ts`
**Evidence:** The test file's only source import is
`import { extractPartialReply, asReadableError } from './geminiService';`. The module exports
`validateApiKey`, `readCachedModel`, `clearCachedModel`, `resolveModel`, `asReadableError`,
`extractPartialReply`, `chatReply`, `analyzeReportDesign`, `MODEL_PREFERENCE` and
`MissingApiKeyError`. Counting by module, coverage of `src/` is 18.6%; correcting for this one
file, it is ≈ 8.8%.
**Why it matters:** Any future coverage report, and any informal "which files have tests" glance,
will score the largest and most business-critical service in the repo as covered on the strength of
16 tests over ~70 lines of stream-scanning. That is the single most misleading number available
about this codebase, and it will be quoted.
**Repro:** Read the import line; compare against the export list.
**Recommendation:** Two things. Short-term, note the real scope in the test file's header so the
next reader is not misled. Medium-term, the testable-without-a-key surface here is larger than it
looks: `resolveModel`'s ranking and caching, `validateApiKey`'s classification, and
`analyzeReportDesign`'s response parsing can all be driven from captured fixtures with `fetch`
stubbed. That is also the only realistic way the truncation bug gets a regression test.
**Effort:** S for the note; M for the fixtures
**Fix risk:** None — additive.

---

**ID:** TEST-003
**Title:** `designerBridge.ts` tests 1 of 6 exports, and the 5 untested ones include the missing-timeout bug
**Severity:** P2
**Confidence:** High
**Location:** `src/lib/designerBridge.test.ts:1`; `src/lib/designerBridge.ts`
**Evidence:** The test file imports only `designerFileName`. Untested: `pingDesigner` (has a
timeout), `launchDesigner`, `waitForDesigner`, `sendToDesigner` (**no** timeout — see REL-002), and
`DESIGNER_PROTOCOL`. Six tests over the one pure function; nothing over the four that touch the
network or the URL-protocol handler.
**Why it matters:** This module is the browser's half of the only mechanism by which the web app
causes a local program to run. Its guards — the non-safelisted `x-forma-client` header that forces
a CORS preflight (`:20-25`), the ping timeout, the wait loop — are security-relevant and
behavioural, and none is asserted. `sendToDesigner`'s missing timeout would have been caught by the
same test that covers `pingDesigner`'s present one.
**Repro:** Compare the test file's import against the module's exports.
**Recommendation:** These are all `fetch`-based and stub cleanly. Assert: `pingDesigner` resolves
`false` (not throws) on a refused connection and honours its timeout; `sendToDesigner` sends the
`x-forma-client` header and has a timeout once REL-002 is fixed; `waitForDesigner` gives up after
its budget. Use fake timers, not sleeps.
**Effort:** S
**Fix risk:** None — additive. Pair with the REL-002 fix so the test lands with the timeout.

---

**ID:** TEST-004
**Title:** No test asserts the `localStorage` and Firestore report shapes round-trip
**Severity:** P2
**Confidence:** Medium — the divergence is documented; I did not read both serialisation paths in full
**Location:** `src/App.tsx` save/load paths; `docs/notes/persistence.md`
**Evidence:** `firestore.rules:26-27` pins the cloud shape to exactly six fields
(`id`, `name`, `timestamp`, `messages`, `result`, `userId`), with `messages` and `result` typed as
**strings**. The signed-out path writes to `localStorage` under `'savedReports'`
(`App.tsx:2330`) with no such constraint. `CLAUDE.md` routes shape questions to
`docs/notes/persistence.md` on the grounds that the two "diverge". No test exercises either
serialiser, let alone both.
**Why it matters:** A user who works signed out and later signs in has reports in one shape being
read by code that may expect the other. The failure is not a crash — it is a report that loads
blank or loses its conversation, which looks like data loss to the user and like nothing at all to
`tsc`.
**Repro:** Not reproduced. Marked Medium confidence for that reason: the divergence is documented,
the absence of a test is verified, but I have not demonstrated a concrete losing case.
**Recommendation:** First establish whether the shapes are meant to converge or are deliberately
different. If deliberate, one test per direction asserting the adapter. If accidental, unify them
and pin the result with a round-trip test. Either way this should be settled before the next change
to the save path.
**Effort:** S to test; M if the shapes need unifying
**Fix risk:** Low for a test; changing a stored shape needs a migration for anyone with existing
`localStorage` data.

---

**ID:** TEST-005
**Title:** Non-flakiness is assumed, not demonstrated
**Severity:** P3
**Confidence:** High
**Location:** both suites
**Evidence:** Inspection found no flaky pattern — no sleeps, no real network, no real clock beyond
one bounded `Date.now()`, no unseeded randomness, no order dependence, and `fileParallelism: false`
on the suite that shares state. But the suite was run **once** in this audit, and the pack's own
standard (ground rule for Phase 7) is five consecutive runs.
**Why it matters:** Low risk, but the unit suite takes 4.1s. There is no cost argument for not
knowing.
**Repro:** n/a.
**Recommendation:** Run `npm test` five times and record the result. If CI is added (INV-003),
have it do this on a schedule rather than per-commit.
**Effort:** S
**Fix risk:** None.

---

## Suggested test strategy going forward

**Targets, by layer:**

| Layer | Target | How |
|---|---|---|
| `lib/` pure helpers | Keep at ~100% of exports | Already there for 11 of 13. Close `designerBridge`. |
| `services/` | 60% of exports | Fixtures + stubbed `fetch`. `keyVault` first, then `geminiService` parsing. |
| `firestore.rules` | Keep at 100% | Already there. Add a case whenever a rule changes. |
| `App.tsx` | Extract, then cover the extraction | Do not try to test it in place. |
| Components | Smoke-render the five marketing pages | Cheap, catches import-time breakage, gives a11y a place to live. |

**What to stop doing:** nothing. There is no wasted test in this repo.

**CI gates to add, in order:** `npm run lint` → `npm test` → the mojibake sweep → `npm run build` →
`npm run test:rules`. The first four total ~50s. The fifth needs Java in the runner and can be
nightly rather than per-push.
