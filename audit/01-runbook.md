# Phase 1 — Get It Running (proved, not assumed)

> **Status: superseded in part.** This file records the repository as found on 2026-08-27, *before*
> any fix. Seven roadmap items have since landed and 11 findings are closed — see
> [`07-implementation.md`](07-implementation.md) for current counts and finding status. This file is
> deliberately left unedited as the baseline.

**Date:** 2026-08-27 · **Machine:** Windows Server 2019, Node 24.18.1, npm 11.16.0, Temurin JRE 21.0.12
**Assumption on the open questions:** no Gemini key available, so critical flow #1 is exercised in
mock mode only and its output quality is UNVERIFIED throughout.

Every command below was run in this session. Timings are wall-clock from a warm cache unless
stated. `npm install` was **not** re-run — ground rule 4 forbids touching the lockfile without
approval, so the existing `node_modules` was verified with `npm ls --depth=0` instead (exit 0,
tree complete, 23 top-level packages, no unmet peers).

---

## The verified runbook

```powershell
npm ls --depth=0                                        # 2.2s   exit 0 — tree intact
npm run lint                                            # 19.9s  exit 0 — no output
npx tsc --noEmit --noUnusedLocals --noUnusedParameters   # 20.5s  exit 0 — no output
npm test                                                # 4.1s   exit 0 — 167 passed (13 files)
npm run test:rules                                      # 95.6s  exit 0 — 29 passed (1 file)
npm run build                                           # 25.2s  exit 0 — 2 warnings, see RUN-001/RUN-002
npm start                                               # serves dist/ on :3000
```

Nothing exceeded two minutes. `npm run test:rules` is the only slow step and ~86s of its 95.6s is
Firestore-emulator startup and shutdown — the suite itself reports 9.06s.

**The documented setup works exactly as written.** Following `README.md` §Quick start as a new
hire would, the only step that fails is the one the README already warns about (`vite dev`), and
the only prerequisite not stated in the Quick start is Java, which is stated in §Testing where it
belongs. This is a materially better result than most repos this size.

---

## Results in detail

### Typecheck and dead-code sweep

Both clean, exactly as `CLAUDE.md` claims. Note that `tsconfig.json` enables no strictness flags,
so "clean" means "no syntax-level type errors", not "type-safe". See ARC-004 in Phase 2.

### Unit suite

```
✓ src/lib/reportConfigStore.test.ts   (9)     ✓ src/lib/datetime.test.ts        (12)
✓ src/lib/designerBridge.test.ts      (6)     ✓ src/lib/modelCatalog.test.ts    (16)
✓ src/lib/announcements.test.ts       (7)     ✓ src/lib/routes.test.ts          (13)
✓ src/lib/attachments.test.ts         (9)     ✓ src/lib/router.test.ts          (17)
✓ src/lib/panelSize.test.ts          (13)     ✓ src/lib/repx.test.ts            (24)
✓ src/lib/sourceRect.test.ts          (9)     ✓ src/services/geminiService.test.ts (16)
✓ src/lib/reportGeometry.test.ts     (16)
Test Files  13 passed (13)   Tests  167 passed (167)
```

**`CLAUDE.md`'s counts are correct to the individual file.** All thirteen per-file numbers match,
and they sum to the stated 167. Its warning about `geminiService.test.ts` is also correct — the
file contains 10 `it(` calls and reports 16 tests, because one sits inside a loop over split
points. This is the only place in the audit where a documented count could be checked to the digit,
and it survived.

### Rules suite

`29 passed (29)`, exit 0. The run emits ~22 `PERMISSION_DENIED` blocks on stderr; these are the
**negative** cases logging the denial they assert, not failures. Verified: the suite uses
`assertFails` (29 calls) and `assertSucceeds` (10 calls) from `@firebase/rules-unit-testing`
rather than `expect`, which is why a naive `expect(` count reports zero assertions for this file.

### Build

```
dist/index.html                        4.75 kB │ gzip:   1.96 kB
dist/assets/index-zKyBMFvc.css       108.72 kB │ gzip:  20.64 kB
dist/assets/index-CAXYdgVD.js      1,994.27 kB │ gzip: 538.79 kB
dist/assets/pdf.worker-CliDBb4N.mjs 2,174.48 kB
✓ built in 17.93s
```

Two warnings, both findings below.

### Mojibake sweep

The one documented check with no runnable form. Run it: **0 hits across 75 files**, and `CLAUDE.md`
itself scores **11**, exactly as documented. One discrepancy — see RUN-005.

### Runtime smoke test

`npm start` from the repo root, then probing the production server:

| Path | Status | Content-Type | Note |
|---|---|---|---|
| `/api/health` | 200 | `application/json` | `{"status":"ok"}` |
| `/api/generate-report` | **404** | `application/json` | Deleted route correctly denies as JSON |
| `/api/debug-key` | **404** | `application/json` | Same — the guard at `server.ts:27-36` works |
| `/` | 200 | `text/html` | 4,753 bytes |
| `/workspace` | 200 | `text/html` | SPA fallback |
| `/docs` | 200 | `text/html` | SPA fallback |
| `/nonexistent-page` | 200 | `text/html` | SPA fallback — no real 404 page |
| `/og-card.png` | 200 | `image/png` | 98,684 bytes |

**The `/api/*` guard is doing exactly what its comment claims.** `server.ts:27-33` says the
deleted routes must fail as JSON rather than being swallowed by the SPA catch-all, and both
return 404 JSON. That is a documented invariant, verified.

Response headers on `/` are covered in Phase 5A — the short version is that there are none worth
having.

---

## Critical flows — status today

| # | Flow | Status |
|---|---|---|
| 1 | Upload → generate → spec + mockup + `.repx` | **UNVERIFIED.** Needs a Gemini key. Mock mode (`VITE_FORMA_MOCK=true`) exercises the loaders and cancellation but returns a canned invoice, so it proves nothing about `repxContent`. |
| 2 | Key handling (sessionStorage, no disk, no server, no bundle) | **VERIFIED by construction.** No `GEMINI_API_KEY` read exists anywhere; `envPrefix: ['VITE_']`; the server has no key-bearing route; `keyVault.ts` uses `sessionStorage` and migrates the old `localStorage` entry away. See Phase 5A. |
| 3 | Sign in → save → reload → reopen | **PARTIALLY VERIFIED.** The security rules behind it pass 29/29 against the emulator. The UI round-trip needs a live Firebase project and was not exercised. |
| 4 | Account deletion removes reports **and** vault | **NOT VERIFIED.** Needs a live project and a disposable account. |
| 5 | Routing / deep links / titles | **VERIFIED.** All nine paths return the SPA shell; `routes.test.ts` asserts the title table and that `/` matches `index.html`; `routesWithoutABranch()` returns `[]`. |
| 6 | Open in designer | **PARTIALLY VERIFIED.** `RepxDesigner.exe` **is** built at `tools/RepxDesigner/bin/Release/` (16,896 bytes, 2026-08-26). Port 7317 is not listening, so the companion is not running — correctly, since `CLAUDE.md` says it must be started from the user's own desktop. The button's feature detection was not exercised end to end. |

**No critical flow was found broken.** None was fully proved either, and the reason is the same in
every case: the parts that need a credential or a live desktop session were out of reach.

---

## Findings

---

**ID:** RUN-001
**Title:** Every production build prints a `%VITE_*%` warning caused by a comment in `index.html`
**Severity:** P3
**Confidence:** High
**Location:** `index.html:38-40`
**Evidence:** `npm run build` prints, before any other output:
```
(!) %VITE_*% is not defined in env variables found in /index.html. Is the variable mistyped?
```
Vite scans `index.html` for `%NAME%` placeholders **including inside HTML comments**. The text at
`index.html:38-40` reads *"Vite's `%VITE_*%` HTML replacement leaves the placeholder text in the
output when the variable is unset"* — a comment explaining why the feature is deliberately not
used, which the scanner reads as a use of it.
**Why it matters:** A warning that fires on every single build and can never be acted on is a
warning people learn to scroll past, which is how the next real one gets missed. It also reads as
a genuine misconfiguration to anyone building this for the first time.
**Repro:** `npm run build`. The warning is the first line after `vite v6.4.3 building for production...`.
**Recommendation:** Break the literal so the scanner does not match it — e.g. write it as
`%VITE_&#42;%` or `"%" + "VITE_*" + "%"` in prose, or move that paragraph to
`docs/notes/app-shell.md` and leave a one-line pointer in the HTML.
**Effort:** S
**Fix risk:** None — comment text only. Verify the warning is gone with one `npm run build`.

---

**ID:** RUN-002
**Title:** The client ships as one 1.99 MB chunk with no code splitting, so the marketing pages load the whole app
**Severity:** P2
**Confidence:** High
**Location:** build output; `vite.config.ts` (no `build.rollupOptions.output.manualChunks`)
**Evidence:**
```
dist/assets/index-CAXYdgVD.js   1,994.27 kB │ gzip: 538.79 kB
(!) Some chunks are larger than 500 kB after minification.
```
One JS chunk for the entire application. There is no dynamic `import()` anywhere in `src/` and no
manual chunk configuration. `dist/assets/` contains exactly two JS artifacts: this chunk and the
2.17 MB pdf.js worker (which is loaded on demand by pdf.js itself, not eagerly).
**Why it matters:** `/`, `/features`, `/docs`, `/contact`, `/terms` and `/privacy` are static
marketing pages, and every one of them downloads, parses and executes Firebase Auth, Firestore,
the `@google/genai` SDK, `react-markdown`, `remark-gfm`, the full workspace and the pdf.js entry —
539 kB gzipped before a visitor has done anything. For a public open-source front door, the landing
page is the page most likely to be visited once and never returned to, and it is paying the
workspace's entire cost. Parse-and-execute time, not transfer, is usually the larger share of that
on a mid-range device.
**Repro:** `npm run build`; read the chunk table.
**Recommendation:** Lazy-load the workspace behind `React.lazy` at the route boundary — `/workspace`
is already a distinct route with a distinct view state (`routes.ts:83-99`), so the split line is
already drawn. Firebase and `@google/genai` follow it, since neither is used by any marketing page.
Measure before and after rather than assuming; the target worth quoting is landing-page JS under
150 kB gzipped.
**Effort:** M
**Fix risk:** Moderate. The single `loginModal` renders in both the landing and workspace trees
(`routes.ts:62-70`), so the split must not put the modal on the lazy side or `/login` breaks. A
loading state is also needed at the boundary, and there is currently no test that would catch it
regressing.

---

**ID:** RUN-003
**Title:** `README.md`'s "first run of a session takes ~52s" did not reproduce; the real variable is the OS file cache
**Severity:** P3
**Confidence:** High
**Location:** `README.md:139`; `CLAUDE.md` (*Commands*)
**Evidence:** `README.md:139` states: *"Measured on one machine on 2026-08-20: 52s for the first
`npm test` of the session, then 4.6s for the same command immediately after."* The first `npm test`
of **this** session took **4.1s**, with `environment 20.96s` summed across workers — not the 442s
the README attributes to a cold run.

**A later run in the same session settled it.** Re-running `npm test` at the end of the audit, after
a build, two `tsc` passes, an emulator run and an `npm audit` had churned the file cache, gave
**42.23s** with `environment 477.90s` — squarely the README's "cold" profile. So both numbers are
real and both were observed **within one session**: the variable is the OS file cache and
`node_modules/.vite`, not how many times the command has run since the terminal opened.
**Why it matters:** Minor, but the framing is what misleads. The cache that matters
(`node_modules/.vite` plus the OS file cache) persists across sessions and across reboots-with-warm-
disk; "first run of a session" implies it resets per terminal, which it does not. Someone reading
this and getting 4s would reasonably wonder what else in the doc is stale.
**Repro:** Open a new shell, run `npm test`. Observed 4.1s.
**Recommendation:** Reword to "first run after a cold file cache — typically after a reboot or a
fresh clone", keep the 52s figure as the observed worst case, and note it is not per-session.
Changing this is a two-file edit (`README.md` and `CLAUDE.md`), and see RUN-004 for the third copy.
**Effort:** S
**Fix risk:** None.

---

**ID:** RUN-004
**Title:** `npm run build` and `npm run lint` have no documented timings, and lint is the slowest routine check
**Severity:** P3
**Confidence:** High
**Location:** `README.md:130-147`; `CLAUDE.md` (*Commands*)
**Evidence:** Measured this session: `npm run lint` 19.9s, the unused-symbol sweep 20.5s,
`npm run build` 25.2s, `npm test` 4.1s. Both documents give timings for the test suites only.
**Why it matters:** `npm test` is documented as the slow one and is in fact the fastest of the
four by a factor of five. Anyone budgeting a pre-commit check from the docs will size it wrong,
and a 20s typecheck is the step most likely to be skipped under time pressure — which matters more
here than usual, because `tsc` is the only linter in the project.
**Repro:** The timings above.
**Recommendation:** Add a one-line timing row to the Commands table. If a pre-commit hook is ever
added (see INV-003), note that lint+build is ~45s and the tests are nearly free.
**Effort:** S
**Fix risk:** None.

---

**ID:** RUN-005
**Title:** The documented mojibake sweep count is 75; the repo as of 2026-08-26 sweeps 74
**Severity:** P3
**Confidence:** High
**Location:** `CLAUDE.md` (*Commands*, the runnable sweep block)
**Evidence:** `CLAUDE.md` says *"(75 files as of 2026-08-26 …)"*. Running the block verbatim today
reports **75** — but that total includes `claude-code-full-audit-prompt-pack.md`, which I added
this session. Excluding it, the repo as of 2026-08-26 sweeps **74**. The most likely cause is that
the original count included `CLAUDE.md` itself, which the block's `Where-Object Name -ne 'CLAUDE.md'`
explicitly excludes.
**Why it matters:** Trivial on its own. It is recorded because this is the one check in the repo
with no automated form and the largest blast radius when skipped (2,768 corrupted sequences in
`App.tsx` reaching the UI, per `CLAUDE.md`), so the number beside it is the only signal a reader
has that the block is still current. An off-by-one here is the same class of drift the file warns
about elsewhere.
**Repro:** Run the sweep block from `CLAUDE.md` *Commands*, then re-run it filtering out
`claude-code-full-audit-prompt-pack.md`.
**Recommendation:** Correct 75 → 74, or drop the count and let the block speak for itself. The
count's only real job is to catch a sweep that silently stopped matching files; a `if ($all.Count
-lt 70) { "SWEEP LOOKS TRUNCATED" }` guard inside the block would do that job without going stale.
**Effort:** S
**Fix risk:** None.

---

**ID:** RUN-006
**Title:** No `.env` file exists, so `dotenv` silently loads nothing and `APP_URL` is undefined at runtime
**Severity:** P3
**Confidence:** High
**Location:** `server.ts:1`; `.env.example:17-19`
**Evidence:** `.env` is not present in the working tree (`.env*` is gitignored except the example,
and no local copy was made). `server.ts:1` does `import "dotenv/config"`, which is a no-op when the
file is absent — dotenv does not warn. The documented Quick start (`README.md:36-39`) is
`npm install` then `npm run dev`, with no step that creates `.env`.
**Why it matters:** Nothing breaks, because nothing reads `APP_URL` (see INV-006). It is recorded
because the two facts together are load-bearing: the setup docs never mention `.env`, dotenv never
complains, and the one variable the example file presents as required has no consumer. If a future
change *does* start reading `APP_URL`, it will read `undefined` on every developer machine and
nobody will get a warning.
**Repro:** `npm run dev` on a clean clone with no `.env`. It starts normally.
**Recommendation:** Resolve alongside INV-006. If `APP_URL` is deleted, `.env.example` reduces to
the commented-out `VITE_FORMA_MOCK` line and the `dotenv` import can go too — which is the honest
end state for a project with no server-side configuration.
**Effort:** S
**Fix risk:** Low. Confirm no deployment tooling outside this repo sources `.env`.

---

## What I could not do in this phase

- **Generate a real report.** No key. Everything about `repxContent` quality, model behaviour, the
  known truncation bug, and the 5A question of whether a key ever reaches a log is either UNVERIFIED
  or argued from code rather than observation.
- **Exercise sign-in, cloud save, or account deletion.** Needs a live Firebase project and a
  disposable account. The rules underneath them are proved; the UI paths on top are not.
- **Run the designer round-trip.** The `.exe` exists but must be started from the user's own
  desktop session, per `CLAUDE.md` and `tools/RepxDesigner/README.md`.
- **Re-run `npm install` from scratch.** Ground rule 4. The tree was verified intact instead, which
  proves the current state works but not that a fresh clone installs cleanly.
