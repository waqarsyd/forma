# Phase 5B — Performance

> **Status: superseded in part.** This file records the repository as found on 2026-08-27, *before*
> any fix. Seven roadmap items have since landed and 11 findings are closed — see
> [`07-implementation.md`](07-implementation.md) for current counts and finding status. This file is
> deliberately left unedited as the baseline.

## Re-scope, and why

The pack's performance phase assumes a server with a database: N+1 queries, `EXPLAIN` plans,
missing indexes, connection pools, lock contention, load tests with p50/p95/p99. **None of that
exists here.** There is no SQL, no query planner, no ORM, and exactly one HTTP endpoint
(`/api/health`) which returns a constant and takes no input. Load-testing it would measure Express's
ability to serialise fifteen bytes.

The real performance surface of this application is the **client bundle**, the **generation
latency** (which is Google's, not the app's), and **Firestore document size** — the last of which is
already a documented live failure mode. Those are what this file covers.

**No load test was run and none should be.** Stating that explicitly rather than leaving a gap.

---

## 1. Bundle — measured

From `npm run build`, this session:

| Artifact | Raw | Gzip |
|---|---|---|
| `dist/assets/index-CAXYdgVD.js` | **1,994.27 kB** | **538.79 kB** |
| `dist/assets/pdf.worker-CliDBb4N.mjs` | 2,174.48 kB | — (lazy, loaded by pdf.js on demand) |
| `dist/assets/index-zKyBMFvc.css` | 108.72 kB | 20.64 kB |
| `dist/index.html` | 4.75 kB | 1.96 kB |

Vite's own warning:
```
(!) Some chunks are larger than 500 kB after minification.
```

**One chunk for the entire application.** There is no dynamic `import()` anywhere in `src/`, and
`vite.config.ts` sets no `manualChunks`. The consequence is RUN-002: every marketing page —
`/`, `/features`, `/docs`, `/contact`, `/terms`, `/privacy` — downloads, parses and executes
Firebase Auth, Firestore, `@google/genai`, `react-markdown`, `remark-gfm` and the whole workspace,
539 kB gzipped, before the visitor has done anything.

For a public open-source front door that is the wrong shape: the landing page is the page most
likely to be visited once and never returned to, and it is paying the workspace's full cost. On a
mid-range device the parse-and-execute cost of ~2 MB of JavaScript typically exceeds the transfer
cost, so this is not just a bandwidth question.

**The split line is already drawn.** `routes.ts:83-99` gives `/workspace` its own view state, and
`lib/` is already separated from the components that use it. The only structural complication is
noted in RUN-002: the single `loginModal` renders in both the landing and workspace trees
(`routes.ts:62-70`), so it must stay on the eager side.

**CSS:** 108.72 kB raw / 20.64 kB gzipped from `index.css` (926 lines) + `workspace.css` (1,652).
That is fine and not worth touching.

---

## 2. Render-blocking third-party CSS

`index.html:71-77` loads **two** stylesheets from `fonts.googleapis.com`: one for Hanken Grotesk,
Inter and JetBrains Mono, and a second for Material Symbols Outlined. Both are render-blocking, both
require a DNS lookup, TCP handshake and TLS negotiation to a third-party origin before first paint,
and each then triggers font-file fetches from `fonts.gstatic.com` — a second origin, a second
connection.

`display=swap` is set on both, which is correct and avoids invisible text. There is no
`<link rel="preconnect">` to either origin.

This interacts with three other findings and should be fixed once, deliberately:

- **SEC-001** — a CSP has to allowlist both origins, or not, if the fonts are self-hosted.
- **SEC-003** — Google Fonts discloses every visitor's IP to Google, undisclosed on the privacy page.
- **PERF-002 below** — the Material Symbols font is a large download for the number of glyphs used.

Self-hosting the fonts resolves all three at once. That is the recommendation, and it is the
highest-leverage single change in this file.

---

## 3. Model resolution cost — the first generation of every session

`resolveModel` (`geminiService.ts:433-495`) does, on a cold session:

1. One `GET /v1beta/models?pageSize=200` — the catalogue.
2. Then **up to 10 concurrent `POST …:generateContent` probes**, one per candidate, each a real
   billed request (`mergeCandidates` defaults `limit = 10`; `MODEL_PREFERENCE` contributes 5 and
   discovery can add 5 more).

Each probe is capped at `maxOutputTokens: 1` (`:413`), so the token cost is negligible and the
comment at `:438-443` correctly argues that firing them concurrently beats probing serially. The
result is cached per session (`readCachedModel`).

**This is a sound design and I am not proposing to change it.** It is recorded because it is the
only place the app makes up to eleven network requests before doing any work, it happens on the
user's own quota, and nothing in the UI says it is happening. If a user ever reports "the first
report of the day is slow to start", this is why.

**UNVERIFIED:** the actual wall-clock cost. Measuring it needs a key. The instrumentation is
already there — `:462` logs `Model probing finished in ${…}ms (${candidates.length} candidates)` —
so whoever has a key can answer this in one generation by reading the console.

---

## 4. Generation latency

`README.md:171` states generation is *"typically a minute or more"*, most of it the model thinking
before emitting output, measured at 4,770 thinking tokens against 3,184 output tokens on a
representative run. `ReportConfig.thinkingBudget` exists as a lever and is unset by default.

**This is Google's latency, not the application's**, and it is honestly documented. The app's
response to it is the right one: stream, show progress, allow cancellation. I have nothing to add
except that `thinkingBudget` being unset by default is a deliberate quality-over-speed choice that
is worth keeping — and worth revisiting only with measurements, which need a key.

---

## 5. Firestore document size — a documented live failure

`README.md:174`: *"A single detailed 2048px upload can exceed Firestore's 1 MiB document limit on
its own; Forma saves the spec and REPX without the images in that case, and says so."*

`firestore.rules:32-35` acknowledges the same thing: `messages` and `result` are bounded only by
Firestore's own 1 MiB ceiling, not by the rules.

`optimizeImageDataUrl` (`App.tsx:450-496`) is the function that decides whether a save fits. It is
**untested** (ranked #8 in Phase 3's dangerous-paths list) and it is the direct cause of a
user-visible degradation that already ships. This is the one performance issue in the product with
a known user impact, and it is a correctness problem wearing a performance costume.

---

## 6. Client-side runtime

Reviewed statically; nothing was profiled, because profiling the workspace requires a generation.

- **30 `useState` + 22 `useEffect` in `App.tsx`.** Any state change in that component re-renders
  the whole tree beneath it. There are 9 `useMemo` and 11 `useCallback`, so some memoisation is
  present, but with 30 state atoms in one component the default is a wide re-render. **UNVERIFIED
  whether this is actually felt** — it needs React DevTools against a live workspace with a
  rendered mockup, which needs a generation.
- **Three `setInterval` progress drivers** (`App.tsx:1950`, `:2457`, `:2717`). Each was checked for
  a matching clear; all three are inside `useEffect`s or explicit handler cleanup. No leak found by
  inspection.
- **No unbounded caches.** `readCachedModel` stores one string per session. No memo cache grows
  without eviction.
- **`pdfjs-dist` is imported dynamically inside `ingestFile`** (`App.tsx:353` uses
  `pdfjs.getDocument`), and the 2.17 MB worker is a separate chunk that Vite emits and pdf.js
  fetches on demand — so PDF handling does not cost anything until a PDF is uploaded. Good.

---

## Findings

---

**ID:** PERF-001
**Title:** The marketing pages ship the entire application — 539 kB gzipped of JS for a static landing page
**Severity:** P2
**Confidence:** High
**Location:** build output; `vite.config.ts` (no code splitting); `src/App.tsx`
**Evidence:** One JS chunk, 1,994.27 kB raw / 538.79 kB gzipped, plus Vite's own >500 kB warning.
No `import()` anywhere in `src/`; no `manualChunks` configured. Six of the nine routes are static
marketing pages that use none of Firebase, `@google/genai`, `react-markdown` or the workspace.
**Why it matters:** Fully argued in RUN-002. This is the same finding, recorded here because it is
the performance phase's headline and the roadmap should carry it once.
**Repro:** `npm run build`; read the chunk table.
**Recommendation:** `React.lazy` at the `/workspace` boundary. Keep `loginModal` eager. Measure
before and after — the target worth quoting is landing-page JS under 150 kB gzipped, but measure
rather than assume the split achieves it, because Firebase is imported by `services/firebase.ts`
which the login modal also needs.
**Effort:** M
**Fix risk:** Moderate — see RUN-002. The `loginModal` constraint is the trap, and nothing tests it.

---

**ID:** PERF-002
**Title:** Two render-blocking Google Fonts stylesheets with no `preconnect`, one of them a full icon font
**Severity:** P3
**Confidence:** High
**Location:** `index.html:71-77`
**Evidence:** Two `<link rel="stylesheet">` elements to `fonts.googleapis.com`, both
render-blocking. The second requests
`Material+Symbols+Outlined:wght,FILL@100..700,0..1` — a variable icon font covering the full weight
and fill axes. No `<link rel="preconnect">` to `fonts.googleapis.com` or `fonts.gstatic.com`, so
first paint waits on cold DNS + TCP + TLS to two third-party origins in sequence.
`display=swap` is correctly present on both.
**Why it matters:** This is first-paint cost on every page including the landing page, and it is
paid before any of the app's own JavaScript matters. It also has two non-performance consequences
that make fixing it worth more than the milliseconds: it is the Google Fonts half of the privacy
contradiction in SEC-003, and it is a CSP allowlist entry in SEC-001.
**Repro:** Load `/` with a cold cache and inspect the network waterfall — the two stylesheet
requests block render.
**Recommendation:** Self-host. Subset the three text faces to the weights actually used
(`400;500;600;700;800` for Hanken Grotesk, `400;500;600` for Inter, `400;500;600` for JetBrains
Mono, per the current URLs) and serve them from `public/`. For Material Symbols, count the icons
actually used and either subset the font or replace it with inline SVGs — `src/components/landing/
icons.tsx` already exists and has fan-in 11, so an inline icon convention is established. If
self-hosting is rejected, add `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`
as a cheap partial fix.
**Effort:** M
**Fix risk:** Low-moderate. Fonts are a visual regression risk with no visual regression test —
compare the five marketing pages by eye before and after, and note `docs/design/DESIGN.md`'s
frontmatter mirrors the typography by hand.

---

**ID:** PERF-003
**Title:** No performance budget exists, so bundle growth is invisible
**Severity:** P3
**Confidence:** High
**Location:** `vite.config.ts`; absence of CI
**Evidence:** `build.chunkSizeWarningLimit` is at its 500 kB default, which the main chunk exceeds
by 4×, so the warning fires on every build and conveys nothing (the same pathology as RUN-001). No
CI exists to enforce a budget, and no size is recorded anywhere in the repo for comparison.
**Why it matters:** The bundle is 1.99 MB today. Without a recorded baseline nobody will notice it
becoming 2.5 MB, and the marketing pages are the ones that pay. This costs almost nothing to fix
and is the difference between PERF-001 being solved once and staying solved.
**Repro:** `npm run build`; note the warning has fired every build since the chunk passed 500 kB and
no action followed.
**Recommendation:** After PERF-001 lands, record the resulting per-chunk sizes in `README.md`
alongside the existing test timings, and add a build step to CI (INV-003) that fails if the eager
chunk exceeds an agreed ceiling. Raise `chunkSizeWarningLimit` to just above the real post-split
figure so the warning becomes meaningful again rather than being permanent noise.
**Effort:** S
**Fix risk:** None.

---

## What was not measured, and why

| | |
|---|---|
| Load test / p50-p95-p99 | **Deliberately not run.** One endpoint returning a constant; the numbers would be meaningless. |
| DB query analysis, `EXPLAIN`, indexes, N+1 | No database in the SQL sense. Firestore access is single-document `getDoc`/`setDoc` on literal paths, plus one `list` scoped to the caller's own collection. There is no query to plan. |
| Core Web Vitals (LCP / CLS / INP) | Needs a browser session against a running instance. Not run — see the note on browser tooling in the roadmap. Given PERF-001 and PERF-002, LCP is the metric most likely to be poor. |
| React re-render profiling | Needs a live workspace with a generated mockup, which needs a key. |
| Generation latency, model-probe wall clock | Needs a key. The instrumentation already exists at `geminiService.ts:462`. |
| Cold start | Not applicable — not serverless, and `npm start` serves static files. |
| Build time | Measured: 25.2s total, 17.93s for the client. Acceptable, and recorded in RUN-004. |
