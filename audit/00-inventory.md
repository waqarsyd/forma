# Phase 0 — Recon & Ground Truth

> **Status: superseded in part.** This file records the repository as found on 2026-08-27, *before*
> any fix. Seven roadmap items have since landed and 11 findings are closed — see
> [`07-implementation.md`](07-implementation.md) for current counts and finding status. This file is
> deliberately left unedited as the baseline.

**Repo:** Forma — `<repo>`
**Date:** 2026-08-27
**Method:** read-only. No source file was modified. Every number below came from a command
run in this session or a file opened in it; commands are quoted where the number is not
obvious. Nothing was executed that installs, writes, deploys, or reaches the network.

**Working tree at time of audit:** `main`, HEAD `55da76e`, two uncommitted doc edits
(`CLAUDE.md`, `README.md`) plus the untracked `claude-code-full-audit-prompt-pack.md`.
The uncommitted edits are documentation catch-ups made today — see *Ground truth* §7.

---

## 1. Repo map

`git ls-files` → **176 tracked files**.

| Top-level | Files | Note |
|---|---|---|
| `.agents/` | 79 | **Vendored.** Firebase's official skill packs. Not our code. |
| `src/` | 54 | The application. |
| (root) | 16 | Configs, `server.ts`, `index.html`, the two docs. |
| `docs/` | 6 | PRD, design source, four architecture notes. |
| `public/` | 5 | Served verbatim at `/`. |
| `_not_required/` | 4 | Parked. Tracked but read by nothing. |
| `tools/` | 3 | C# designer companion (`Program.cs`, `.csproj`, README). |
| `assets/` | 3 | Logo masters + OG-card source, not deployed. |
| `.vscode/` | 2 | `launch.json`, `settings.json`. |
| `scripts/` | 2 | `dev.mjs`, `build-server.mjs`. |
| `.claude/` | 1 | `settings.local.json` (permission allowlist). |
| `tests/` | 1 | `firestore.rules.test.ts`. |

**Lines of text, tracked files only:**

| Extension | Files | Lines |
|---|---|---|
| `.json` | 10 | 14,989 (14,820 of which is `package-lock.json`) |
| `.md` | 90 | 11,849 |
| `.tsx` | 22 | 11,577 |
| `.ts` | 35 | 5,217 |
| `.css` | 2 | 2,578 |
| `.cs` | 1 | 613 |
| `.html` | 2 | 365 |
| `.rules` | 1 | 117 |
| rest (`.csproj`, `.mjs`, `.example`) | 4 | 157 |

Split by ownership: **36,784 lines ours (84 files)** vs **10,678 lines vendored (83 files,
`.agents/` + `_not_required/`)**. Nearly half the tracked file count is material nobody here
wrote. Every later phase should exclude those two directories from every metric.

**Ten biggest source files (ours):**

| Lines | File |
|---|---|
| 4,221 | `src/App.tsx` |
| 1,652 | `src/workspace.css` |
| 1,542 | `src/services/geminiService.ts` |
| 1,046 | `src/components/FeaturesPage.tsx` |
| 1,001 | `src/components/DocsPage.tsx` |
| 926 | `src/index.css` |
| 790 | `src/components/LoginPage.tsx` |
| 787 | `src/components/ContactPage.tsx` |
| 667 | `src/components/LandingPage.tsx` |
| 613 | `tools/RepxDesigner/Program.cs` |

Biggest by bytes is not source: `assets/source/logo_white.png` at 2.98 MB, then
`assets/source/logo.png` at 295 KB. Both are masters excluded from the deploy, so they cost
clone time, not page weight.

**Auto-generated / vendored / not-source:** `package-lock.json`; `.agents/**`;
`_not_required/**`; `public/og-card.png` (pre-rendered from `assets/source/og-card.html` by a
recorded headless-Edge command, not a build step); `tools/**/bin`, `tools/**/obj` (gitignored
MSBuild output, ~137 MB in Release per `.gitignore:36-39`); `.antigravity/` (untracked,
gitignored, one ~22 MB editor-state `.pbtxt` — do not read or index it).

---

## 2. Entry points

Derived, not assumed — every one below was opened.

| # | Entry point | Location | Notes |
|---|---|---|---|
| 1 | Dev/prod HTTP server | `server.ts:6-58` | Express, hardcoded `PORT = 3000`, binds `0.0.0.0`. |
| 2 | `GET /api/health` | `server.ts:15-17` | Returns `{"status":"ok"}`. **The only real HTTP route in the project.** |
| 3 | `/api/*` catch-all | `server.ts:34-36` | 404 JSON. Registered after `/api/health`, before the SPA fallback, deliberately (`server.ts:27-33`). |
| 4 | Vite middleware (dev) | `server.ts:39-44` | `NODE_ENV !== "production"`. |
| 5 | Static + SPA fallback (prod) | `server.ts:46-50` | `process.cwd()/dist`, so `npm start` must run from the repo root. |
| 6 | Browser entry | `index.html:82` → `src/main.tsx` | `StrictMode` > `MotionConfig` > `ErrorBoundary` > `App`. |
| 7 | Client routes | `src/lib/routes.ts:42-52` | Nine real paths: `/`, `/features`, `/docs`, `/contact`, `/login`, `/signup`, `/workspace`, `/terms`, `/privacy`. |
| 8 | Theme bootstrap | `index.html:8-25` | Inline, pre-paint, dependency-free by design. |
| 9 | CLI: dev logger | `scripts/dev.mjs` | Spawns `tsx server.ts`, tees to `dev-server.log` with `flags: 'w'` (truncates each run). |
| 10 | CLI: server bundler | `scripts/build-server.mjs` | esbuild → `dist/server.cjs`, `packages: 'external'`. |
| 11 | Companion: file picker | `tools/RepxDesigner/Program.cs:27-28` | `RepxDesigner.exe [file]`. |
| 12 | Companion: loopback server | `Program.cs:29`, `:326` | `--serve` on `127.0.0.1:7317`. |
| 13 | Companion: protocol handler | `Program.cs:30-31`, `:38-47` | `--register` / `--unregister` writes a `forma-repx://` URL handler under **HKCU**. Registered command is `"exe" --serve "%1"`. |

**Event-driven entry points** (nothing is a cron, queue consumer, webhook, or lambda — there
are none of any of those):

- `auth.onAuthStateChanged` — `src/App.tsx:1494`
- `popstate` + a custom `ROUTE_CHANGE` event — `src/lib/router.ts:54-57`
- `hashchange` — `src/App.tsx:1436`, the legacy-`#hash` migration for in-app links, documented at `:1429-1431`. Not leftover hash routing.
- A delegated document-level `click` that intercepts in-app `<a href="/...">` — `src/App.tsx:1470`
- 13 further `addEventListener` / `setInterval` sites, 10 of them in `App.tsx`

---

## 3. External runtime dependencies

Every host referenced from `src/`, `tools/`, `scripts/`, `index.html`:

| Service | Where | What crosses the boundary |
|---|---|---|
| **Gemini API** — `generativelanguage.googleapis.com` | `geminiService.ts:383` (model discovery), `:406` (probe), plus the `@google/genai` SDK at `:665`, `:933` | The uploaded file, the prompt, and **the user's own key** in an `x-goog-api-key` header. Browser → Google directly; the server is never in the loop. |
| **Firebase Auth** | `src/services/firebase.ts:32`, `:37`, `:132` | Email/password and Google `signInWithPopup`. |
| **Cloud Firestore** | `src/services/firebase.ts:24` | Saved reports and the encrypted key vault. Project `forma-201ba`, database `(default)`. |
| **Google Fonts** — `fonts.googleapis.com` | `index.html:71-77` | Two render-blocking stylesheets (Hanken Grotesk / Inter / JetBrains Mono, and Material Symbols). Discloses IP + User-Agent to Google on **every** page load. |
| **FormSubmit** — `formsubmit.co` | `ContactPage.tsx:279` | The visitor's **name, email address, chosen topic and message body**. Third-party relay. See INV-001. |
| **RepxDesigner companion** — `127.0.0.1:7317` | `src/lib/designerBridge.ts:17` | The generated REPX XML. Optional, feature-detected, local only. |
| **`forma-repx://`** | `Program.cs:38-47` | A Windows URL-protocol handler under HKCU, letting the page ask Windows to start the companion. |

`firestoreDatabaseId` in `firebase-applet-config.json:6` is `"(default)"` and `databaseId` in
`firebase.json:3` is `"(default)"`. **The invariant CLAUDE.md warns about holds.**

---

## 4. Environment variables

Exhaustive grep for `process.env.*` / `import.meta.env.*` across every tracked `.ts`,
`.tsx`, `.mjs` and `.cs` file. Four names are read, total:

| Variable | Read at | Cross-check vs `.env.example` |
|---|---|---|
| `NODE_ENV` | `server.ts:39`; baked to `"production"` by `scripts/build-server.mjs:17` | Not in `.env.example` — correct, it is set by the toolchain. |
| `DISABLE_HMR` | `vite.config.ts:26` | **Undocumented.** Not in `.env.example`. |
| `NO_COLOR` | `scripts/dev.mjs:20` | **Undocumented.** Conventional, so low value to document. |
| `VITE_FORMA_MOCK` | `geminiService.ts:647`, `:828` (via the `viteEnv` map built at `:205-206`) | Documented at `.env.example:12-15`. ✅ |
| `APP_URL` | **nowhere** | Documented at `.env.example:17-19` and set to `"MY_APP_URL"`. See INV-006. |

No `GEMINI_API_KEY` or `API_KEY` read exists anywhere in the codebase. `vite.config.ts:17`
allowlists `VITE_*` only. **The bring-your-own-key architecture is intact as documented.**

---

## 5. Configuration files — all read

`package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`,
`vitest.rules.config.ts`, `firebase.json`, `.firebaserc`, `firebase-applet-config.json`,
`firestore.rules`, `.gitignore`, `.env.example`, `index.html`, `server.ts`,
`scripts/dev.mjs`, `scripts/build-server.mjs`, `.vscode/launch.json`, `.vscode/settings.json`,
`.claude/settings.local.json`.

Points that matter downstream:

- **`tsconfig.json` has no `strict`, and no `noUnusedLocals`/`noUnusedParameters` either.** Also no `noImplicitAny`, `strictNullChecks`, or `noUncheckedIndexedAccess`. `npm run lint` is `tsc --noEmit` against this — a clean exit proves far less than it appears to.
- **There is no ESLint configuration of any kind.** Verified: no `.eslintrc*`, and no `eslint` dependency. `npm run lint` is a typecheck, not a lint.
- **Three Vitest/Vite configs**, deliberately separate: `vite.config.ts` (carries the "Do not modify" HMR block and the `watch: { ignored: ['**/tools/**'] }` guard against chokidar `EBUSY`), `vitest.config.ts` (jsdom, `include: ['src/**/*.test.ts']`), `vitest.rules.config.ts` (node, `include: ['tests/**/*.test.ts']`, `fileParallelism: false`, 20s/30s timeouts).
- `.gitignore` carries credential backstop patterns (`key.txt`, `*.key`, `*apikey*`, `*api-key*`, `secrets.json`) and ignores `.env*` except `.env.example`. `.firebaserc` is deliberately **not** ignored.
- `.vscode/launch.json:8` runs `npm install && npm run dev` — the only place in the repo that names an install step as part of starting up.

---

## 6. Git archaeology

```
git rev-list --count HEAD      → 78
git shortlog -sne --all        → 78  Waqar Sayyed <waqarsayyed.official@gmail.com>
first  c0e9c51  2026-08-09  Initial commit          (132 files)
latest 55da76e  2026-08-26
```

**The history is 18 days old and has exactly one contributor.** Commits cluster into nine
active days: 10 / 4 / 15 / 13 / 20 / 1 / 9 / 3 / 3 across 08-09 → 08-26.

This materially changes how Phases 2–6 should read git data:

- *"Files nobody has touched in a year"* is **vacuous** — nothing here is a year old. 67 non-vendored files have been touched exactly once, but that means "written recently and not revisited", not "abandoned".
- *"Complexity × churn"* still works, but churn counts are small enough that a single refactor commit distorts them. Treat the ranking as indicative, not quantitative.
- There is no code review signal at all: single author, no remote, no PRs, no CI.

**Churn, top 10:**

| Commits | File |
|---|---|
| **38** | `CLAUDE.md` |
| **23** | `src/App.tsx` |
| 11 | `src/components/ContactPage.tsx` |
| 10 | `docs/notes/app-shell.md` |
| 10 | `src/components/DocsPage.tsx` |
| 9 | `README.md` |
| 9 | `src/index.css` |
| 8 | `src/components/LandingPage.tsx` |
| 8 | `src/components/LoginPage.tsx` |
| 8 | `src/components/SiteFooter.tsx` |

`src/services/geminiService.ts` — the second-largest source file and the one carrying the
whole model contract — has been touched in only **3** commits. High complexity, near-zero
churn: it has not been revisited since it was written.

**Largest commits by files changed:** `c0e9c51` (132, initial), `a421aee` (23),
`55da76e` (17), `faf0100` (11). No mega-commits after the import.

**Reverts:** one genuine revert, `f5349d0` *"Revert the footer measure: the landing page is
the reference"*. No revert-of-a-revert. (A loose grep for revert/undo/restore matches 18
commits, but the other 17 are prose in message bodies, not reversions.)

**Secret scan of full history:** four `AIzaSy`-shaped strings exist across all 78 commits.
Values are not reproduced here. Classification:

| Length | Where | Verdict |
|---|---|---|
| 39 | `firebase-applet-config.json:4` | The Firebase **web** API key. Public project identifier, correctly committed — `README.md:80` says so. Not a secret. |
| 37 | `src/components/landing/VaultFigure.tsx:14` | Illustrative fake, documented as such at `:9`. Wrong length for a real key. See INV-007. |
| 21 | `src/lib/reportConfigStore.test.ts` | Obvious test placeholder (`AIzaSyREAL…`). |
| 12 | `src/App.tsx` / docs | Obvious placeholder (`AIzaSyWhoo…`). |

**No live Gemini key is present in the working tree or anywhere in git history.** The
revoked key from the pre-repo leak incident predates `c0e9c51` and is not recoverable from
this repository.

---

## 7. Docs vs. code

Six documents plus the companion README were read: `CLAUDE.md`, `README.md`, `docs/PRD.md`,
`docs/design/DESIGN.md`, `docs/notes/{gemini,app-shell,persistence,styling}.md`,
`tools/RepxDesigner/README.md`.

The documentation here is unusually good — it is written to explain *why*, records incidents
with dates, and names its own failure modes. Several claims cross-checked clean:

- ✅ `firestoreDatabaseId` matches `databaseId` (the silent-wrong-database trap).
- ✅ `envPrefix: ['VITE_']` with no Gemini env read anywhere.
- ✅ Node floor: `vitest@4.1.10` declares `^20.0.0 || ^22.0.0 || >=24.0.0`, so **21 and 23 really are excluded**; `firebase-tools@15.26.0` declares `>=20`. CLAUDE.md and `README.md:34` are both accurate.
- ✅ 13 unit test files exist with the names CLAUDE.md lists; the per-file counts sum to its stated 167. (Whether the suite actually reports 167 is a Phase 1 check — not run here.)
- ✅ `src/lib/routes.ts:43` `'/'` title is byte-identical to `index.html:31`.

Contradictions found are recorded as INV-001 and INV-006, INV-008, INV-009, INV-010, INV-011
below.

The two **uncommitted** doc edits are themselves catch-ups: `README.md`'s `## Project
structure` tree map was missing `reportGeometry`, `datetime` and `modelCatalog` from its
`lib/` line, and `CLAUDE.md` gained a router row for `reportGeometry.ts` plus a warning that
this exact block keeps going stale. **HEAD's README is stale; the working tree's is not.**

---

## 8. Findings

---

**ID:** INV-001
**Title:** The published privacy policy states data never leaves the browser, while the contact form POSTs name, email and message to a third party
**Severity:** P1
**Confidence:** High
**Location:** `src/components/LegalPage.tsx:74`, `:75`, `:117`; `src/components/ContactPage.tsx:279`; `index.html:71-77`
**Evidence:**
`LegalPage.tsx:75` (the `/privacy` page, "The short version"):
> 'Signed out, nothing about you leaves your browser except the request you send to Google with your own API key.'

`LegalPage.tsx:74`, same section:
> 'There are no analytics, no advertising, no tracking pixels and no third-party scripts watching what you do. Nothing is sold or shared with anyone for marketing.'

`ContactPage.tsx:279`:
```js
fetch('https://formsubmit.co/ajax/' + mailAddress(), {
  method: 'POST',
  ...
  body: JSON.stringify({ name: ..., email: ..., subject: values.topic, message: ... }),
```
`index.html:71-77` loads two stylesheets from `fonts.googleapis.com` on every page load.

Grepping `LegalPage.tsx` case-insensitively for `formsubmit|third-part|processor|contact|
message` returns exactly two hits: line 74 (the denial) and line 117, which merely directs
users to the contact page. **FormSubmit is disclosed nowhere.** Google Fonts is disclosed
nowhere.

**Why it matters:** A signed-out visitor who uses the contact form has their name, email
address and free-text message transmitted to FormSubmit, an unnamed third-party processor,
directly contradicting a claim on the site's own privacy page. Separately, every visitor's IP
and User-Agent reach Google Fonts on page load. This is a public legal statement that the
code falsifies — the exposure is reputational and regulatory (GDPR Art. 13 requires naming
recipient categories), not technical. The Google Fonts half is arguably defensible on the
literal wording ("scripts"), the FormSubmit half is not.
**Repro:** Open `/privacy`, read the second paragraph. Open `/contact`, fill the form,
submit, and watch the network tab: one `POST https://formsubmit.co/ajax/…` carrying the form
body.
**Recommendation:** Pick one of — (a) name FormSubmit and Google Fonts as processors in the
privacy page and soften the "nothing leaves your browser" sentence to exclude the contact
form; (b) self-host the fonts and replace FormSubmit with a `mailto:` link, making the
current text true. (a) is honest and cheap; (b) is stronger and matches the project's stated
posture everywhere else.
**Effort:** S for (a), M for (b)
**Fix risk:** (a) none — text only. (b) removes a working contact channel and changes the
font loading path, which touches first paint.

---

**ID:** INV-002
**Title:** `src/App.tsx` is 4,221 lines, is the most-changed source file in the repo, and has no test of any kind
**Severity:** P1
**Confidence:** High
**Location:** `src/App.tsx` (whole file)
**Evidence:** 4,221 lines / 179,292 bytes — 2.7× the next-largest source file. Touched by 23
of 78 commits, the highest of any source file. It holds 10 of the 13 `addEventListener` /
`setInterval` registrations in the app, the `onAuthStateChanged` subscription (`:1494`), the
route applier (`:1422-1426`), the delegated link interceptor (`:1470`), and three separate
`setInterval` progress drivers (`:1950`, `:2457`, `:2717`). `vitest.config.ts:15` includes
`src/**/*.test.ts` — there is no `App.test.ts`, and no component or render test exists
anywhere in the repo.
**Why it matters:** Every stateful behaviour in the product — generation progress,
cancellation, auth transitions, routing, the config modal — lives in one untested file that
changes in roughly a third of all commits. This is the intersection of highest complexity,
highest churn and zero coverage, which is the textbook definition of the riskiest file in a
codebase. `CLAUDE.md` and `README.md:147` both acknowledge it ("This is a floor, not a net"),
so it is known — but acknowledged is not mitigated.
**Repro:** n/a — structural.
**Recommendation:** Do not attempt to test it as-is. Continue the pattern the repo already
established (`repx.ts`, `sourceRect.ts`, `routes.ts`, `reportGeometry.ts` were all extracted
*out* of `App.tsx` precisely so they could be reached by a test) and keep extracting pure
logic until what remains is thin enough to render-test. Phase 3 should rank which extraction
buys the most coverage per unit of risk.
**Effort:** L
**Fix risk:** High if done as one refactor — this file is the app. Low if done as the repo
has been doing it: one helper at a time, each with its test, each its own commit.

---

**ID:** INV-003
**Title:** No CI exists; nothing gates a commit
**Severity:** P2
**Confidence:** High
**Location:** repo root — no `.github/`, no `.gitlab-ci.yml`, no pipeline definition of any kind
**Evidence:** `Test-Path .github` → false. `git ls-files` returns no CI configuration. The
five documented checks (`npm run lint`, the unused-symbol sweep, `npm test`,
`npm run test:rules`, the mojibake sweep) are all run by hand, and `CLAUDE.md` says so
explicitly: *"These four commands are the whole of what a machine checks here."*
**Why it matters:** Every invariant in this repo is enforced by someone remembering to run
it. The mojibake sweep in particular has no automated form and is the check most likely to be
skipped — and its failure mode is invisible to `tsc` and to the whole test suite, reaching
users as corrupted text in the UI. That has already happened once (2,768 corrupted sequences
in `App.tsx`).
**Repro:** `git log` shows 78 commits; no commit was gated by anything.
**Recommendation:** One workflow running the four runnable checks on push would cost an hour
and close most of this. The mojibake sweep is already written as a runnable snippet in
`CLAUDE.md` and could be the fifth step. Note the rules suite needs Java in the runner.
**Effort:** S
**Fix risk:** None — additive. A red pipeline on existing commits would be information, not breakage.

---

**ID:** INV-004
**Title:** Coverage is gitignored but no coverage provider is installed, so coverage cannot be generated
**Severity:** P2
**Confidence:** High
**Location:** `.gitignore:4`; `package.json:35-46`
**Evidence:** `.gitignore:4` ignores `coverage/`. `package.json` devDependencies contain no
`@vitest/coverage-v8` and no `@vitest/coverage-istanbul`. Checked on disk:
`node_modules\@vitest\coverage-v8` and `…\coverage-istanbul` both absent — *"NO coverage
provider installed"*.
**Why it matters:** Phase 3 of this audit is built on per-module line and branch coverage
mapped onto the critical flows, and it cannot run. `vitest run --coverage` will attempt an
interactive install prompt, which is exactly the "ask before installing" case ground rule 4
covers.
**Repro:** `npx vitest run --coverage` → Vitest reports the provider is missing and offers to
install it.
**Recommendation:** Ask the user before installing. `@vitest/coverage-v8` is the right
provider for this setup (V8 is already the runtime; istanbul would need instrumentation).
The `.gitignore` entry suggests coverage was intended at some point.
**Effort:** S
**Fix risk:** Adds a devDependency and modifies the lockfile — both require approval per
ground rule 4.

---

**ID:** INV-005
**Title:** `package.json` declares no `engines`, so an unsupported Node version fails late and cryptically
**Severity:** P2
**Confidence:** High
**Location:** `package.json:1-19` (no `engines` key)
**Evidence:** Verified against installed packages rather than documentation:
`vitest@4.1.10` declares `{"node":"^20.0.0 || ^22.0.0 || >=24.0.0"}`; `firebase-tools@15.26.0`
declares `>=20`; `vite@6.4.3` would still accept `^18`. `package.json` declares nothing, so
npm emits no warning on any version.
**Why it matters:** Node 21 and 23 are *newer than 20* and *outside vitest's range*. A
contributor on either gets no install-time warning and instead hits a syntax or API error
from inside a dependency, which reads as a broken repo rather than a wrong runtime. This is
correctly documented in `CLAUDE.md` and `README.md:34`, but documentation is not the
mechanism that catches it.
**Repro:** Install Node 21, run `npm ci`. No warning. The failure surfaces later.
**Recommendation:** Add `"engines": { "node": "^20 || ^22 || >=24" }`. Consider
`engine-strict=true` in `.npmrc` to make it an error rather than a warning.
**Effort:** S
**Fix risk:** Very low. `engine-strict` would harden it into a hard failure — desirable, but
it is a behaviour change for anyone currently on 21/23 who has been getting away with it.

---

**ID:** INV-006
**Title:** `APP_URL` is documented in `.env.example` and read by nothing
**Severity:** P3
**Confidence:** High
**Location:** `.env.example:17-19`; referenced only in prose at `index.html:35-43`
**Evidence:** Exhaustive grep for `process.env.*` and `import.meta.env.*` across every
tracked `.ts`, `.tsx`, `.mjs` and `.cs` file returns four names: `NODE_ENV`, `DISABLE_HMR`,
`NO_COLOR`, `VITE_FORMA_MOCK`. `APP_URL` appears in no source file. `server.ts:1` does
`import "dotenv/config"`, so the value is loaded into `process.env` and then never read.
`index.html:37` names it only to explain why `og:image` is root-relative *instead* of using it.
**Why it matters:** `.env.example` is the contract a new contributor fills in.
`APP_URL="MY_APP_URL"` is presented as required configuration and has no effect whatsoever —
mild, but it is the kind of thing that costs someone twenty minutes when a link comes out
wrong and they go looking for where the variable is consumed.
**Repro:** Set `APP_URL` to anything. Observe no behavioural difference.
**Recommendation:** Either delete it, or keep it and change the comment to say it is reserved
and currently unread. Conversely, `DISABLE_HMR` *is* read (`vite.config.ts:26`) and is
**not** documented in `.env.example` — the inverse gap, and worth fixing in the same edit.
**Effort:** S
**Fix risk:** None. Confirm no deployment script outside this repo consumes `APP_URL` first.

---

**ID:** INV-007
**Title:** A key-shaped literal ships in the client bundle and will trip secret scanners
**Severity:** P3
**Confidence:** High
**Location:** `src/components/landing/VaultFigure.tsx:14`
**Evidence:** `const PLAIN = 'AIzaSy…';` — a 37-character `AIzaSy`-prefixed string, the
"plaintext key" side of the landing page's vault animation. Documented as illustrative at
`:9`: *"The strings are illustrative — the real key never leaves the browser."* It is 37
characters where a genuine Google key is 39, so it does not match the real format. It has
been present in 63 of 78 commits and is in the working tree today.
**Why it matters:** It is not a secret and nothing is exposed. But it is a permanent
false positive for any credential scanner pointed at this repository or at the deployed
bundle — including Google's own, which has already revoked a key on this project once. A
scanner alert that is always wrong is a scanner alert that gets ignored, which is how the
next real one gets missed.
**Repro:** `git grep AIzaSy` → hits in `firebase-applet-config.json` (legitimately public)
and `VaultFigure.tsx` (decorative).
**Recommendation:** Change the prefix to something unmistakably fictional that keeps the same
visual character-class rhythm — the animation scrambles through
`ALPHA` (`:16`) and does not depend on the literal `AIzaSy` prefix. Add a
`# pragma: allowlist secret`-style marker if a scanner is ever adopted.
**Effort:** S
**Fix risk:** Cosmetic only; check the rendered figure still fills its row width.

---

**ID:** INV-008
**Title:** Three different figures for unit-suite runtime across three files
**Severity:** P3
**Confidence:** High
**Location:** `vitest.rules.config.ts:5`; `README.md:137-139`; `CLAUDE.md` (*Commands*)
**Evidence:** `vitest.rules.config.ts:5` — *"The unit suite is dependency-free and runs in
~2s"*. `README.md:139` — 52s first run, 4.6s immediately after, "around 5 seconds" warm.
`CLAUDE.md` carries the same 52s / 4.6s pair.
**Why it matters:** `CLAUDE.md` explicitly states that these figures live in two files and
that re-measuring is therefore a two-file change. It is a three-file change. The stale ~2s in
the config comment is the copy most likely to be believed, because it sits next to the code.
**Repro:** Compare the three lines.
**Recommendation:** Update `vitest.rules.config.ts:5` to match, or drop the number from it
and point at the README. Then correct CLAUDE.md's "two files" to three.
**Effort:** S
**Fix risk:** None.

---

**ID:** INV-009
**Title:** A build-script comment describes a `process.env` fallback the code does not have
**Severity:** P3
**Confidence:** High
**Location:** `scripts/build-server.mjs:18-22`; `src/services/geminiService.ts:205-206`
**Evidence:** `build-server.mjs:20-21` says esbuild collapses `import.meta.env` *"rather than
let esbuild substitute {} and warn — the module then falls through to `process.env`, which is
what the server wants anyway."* The actual code at `geminiService.ts:205-206` is:
```ts
const viteEnv: Record<string, string | undefined> =
  (import.meta as any).env ?? {};
```
With `'import.meta.env': 'undefined'` defined, that evaluates to `{}` — an empty object. There
is no `process.env` fallback on this path; grep confirms `geminiService.ts` reads
`process.env` nowhere.
**Why it matters:** Harmless today, because the server bundle never calls the Gemini path.
But the comment tells the next reader that server-side env vars reach this module, and they
do not. Someone acting on that belief would add a server-side flag and watch it silently do
nothing.
**Repro:** Read both files.
**Recommendation:** Correct the comment to say the value collapses to `{}` and that this is
fine because the server never takes this path. Do not add the fallback — a server-side env
read on a key-adjacent module is the pattern this project deliberately removed.
**Effort:** S
**Fix risk:** None — comment only.

---

**ID:** INV-010
**Title:** The README tree map omits `LogoPulse.tsx`
**Severity:** P3
**Confidence:** High
**Location:** `README.md:92-95`
**Evidence:** The `components/` line lists LandingPage, FeaturesPage, DocsPage, ContactPage,
LoginPage, LegalPage, SiteHeader, SiteFooter, MobileNav, Logo, AccountDialog, UserAvatar —
twelve. `git ls-files src/components/*.tsx` returns thirteen; `src/components/LogoPulse.tsx`
is missing from the list.
**Why it matters:** Trivial in isolation. Noted because `CLAUDE.md` (working tree) singles
out this exact block as *"the one part of it that keeps going stale"*, having been caught up
three times already, and because it is the only file-layout map in the repo — nothing
cross-checks it. The `lib/` line was fixed today; `components/` was not.
**Repro:** Compare `README.md:92-95` against `git ls-files 'src/components/*.tsx'`.
**Recommendation:** Add it. Better: a test in the spirit of `routes.test.ts` (which already
reads `index.html` off disk) asserting that every file under `src/components` and `src/lib`
appears somewhere in the README block would make this self-enforcing and retire the manual
discipline.
**Effort:** S for the edit, S–M for the test
**Fix risk:** None.

---

**ID:** INV-011
**Title:** Two different AI Studio URLs for the same "get a key" action
**Severity:** P3
**Confidence:** High
**Location:** `README.md:41` vs `src/components/SiteFooter.tsx:28` and `src/components/DocsPage.tsx:447`
**Evidence:** `README.md:41` links `https://aistudio.google.com/app/apikey`. The two in-app
links use `https://aistudio.google.com/apikey`.
**Why it matters:** Both currently resolve, so this is cosmetic — but getting a key is the
single most important onboarding step in a bring-your-own-key product, and if Google ever
retires one path the two copies will fail independently.
**Repro:** Compare the three lines.
**Recommendation:** Pick one and use it in all three places.
**Effort:** S
**Fix risk:** None.

---

## 9. Things that surprised me

1. **`CLAUDE.md` is the highest-churn file in the repository** — 38 of 78 commits, 49%, and
   64% more than `App.tsx`. Documentation changing in half of all commits is unusual. Read
   generously it means the docs are genuinely maintained; read sceptically it means they
   encode facts volatile enough to need constant correction, and several commits
   (`1b55f29` "Correct four stale claims in CLAUDE.md", `5c74f08` "Catch CLAUDE.md up with
   the last six commits", `87ff1da`, `a654882`) are explicitly repairs of drift. This is why
   INV-010's suggestion — make the invariant a test — is worth more here than another
   documented rule.

2. **`geminiService.ts` has been touched three times.** It is the second-largest source file,
   it carries the entire model contract and the mega-prompt, and it is the source of the
   single known open bug (repxContent truncation). Three commits in eighteen days, against
   `App.tsx`'s twenty-three. Everything else has been iterated on; this has not.

3. **45% of tracked files are vendored.** 79 of 176 are Firebase skill packs under
   `.agents/`. Any automated metric run over "the repo" will be dominated by material nobody
   here wrote.

4. **The server has exactly one route.** `/api/health`. `server.ts:19-25` documents two
   deleted routes and forbids their return. The "Express backend" in the stack description is
   a static file server with a health check — which makes most of Phase 5B/5C's questions
   inapplicable rather than unanswered.

5. **The privacy page and the contact form were written by the same hand, days apart, and
   contradict each other** (INV-001). `ContactPage.tsx` has 11 commits and `LegalPage.tsx`
   arrived in one — the FormSubmit integration and the privacy text never met.

6. **The `forma-repx://` protocol handler.** `CLAUDE.md`'s router describes the companion as
   a loopback listener with two guards. It also registers a Windows URL-protocol handler
   under HKCU (`Program.cs:38-47`), letting a web page cause a local program to start. It is
   thoughtfully reasoned about in `Program.cs` and gated by Windows' own confirmation prompt,
   but the index does not mention it exists, and it is the single most security-relevant
   surface in the project. Phase 5A should look at it closely.

7. **The best-tested thing in the repo is `firestore.rules`** — 117 lines covered by 29 tests
   in a dedicated suite with its own config and emulator. The 4,221-line file holding all
   application state has none. The coverage is inverted relative to the risk.

---

## 10. Questions I need answered before Phase 1

1. **FormSubmit (INV-001) — which fix do you want?** Disclose it in the privacy text, or
   remove it and make the existing text true? This changes what Phase 5A/5D report and
   whether Phase 7 has a P1 to fix. It is also the only finding here with a legal dimension,
   so it is genuinely your call, not mine.

2. **May I install `@vitest/coverage-v8`?** (INV-004.) Ground rule 4 requires me to ask
   before installing anything or touching the lockfile. Without it Phase 3's coverage
   analysis is impossible and I will have to substitute a hand-built map of tested vs
   untested modules — usable, but weaker.

3. **Is there a Gemini key available for this audit, and under what constraint?** Phase 1
   asks me to smoke-test the critical flows and confirm they work *today*. Critical flow #1
   (generation) cannot be exercised without one. `VITE_FORMA_MOCK=true` exercises the
   loaders, progress bar and cancellation but proves nothing about `repxContent` — which is
   where the known open bug lives. If the answer is no, I will run Phase 1 in mock mode and
   mark every generation-quality finding UNVERIFIED. **Do not paste a key into the chat** —
   the app's Settings dialog is the only correct place for it.

4. **Do you want the dev server run from my shell or yours?** `CLAUDE.md` is explicit that
   it belongs in your terminal, not an agent background shell, and that
   `RepxDesigner.exe --serve` must be started from your desktop or it paints where nobody can
   see it. For Phase 1 I need the server up. My assumption unless you say otherwise: you run
   `npm run dev:log` and I read `dev-server.log`.

5. **Is the RepxDesigner companion built and available on this machine?** Critical flow #6
   needs `RepxDesigner.exe` and DevExpress 20.1. If neither is present I will mark that flow
   untestable rather than reporting the button as broken.

6. **Should the two uncommitted doc edits be committed before Phase 1?** They are corrections
   and I would rather audit against a clean tree, but committing is a write and Phase 7 is
   where writes are supposed to start. Your call.

7. **Scale question, for calibrating severity:** is Forma intended to be deployed publicly
   and multi-user, or is it a personal/internal tool that happens to be open-sourced? INV-001
   is a P1 in the first case and closer to a P3 in the second, and the same fork applies to
   most of Phase 5A. The config block says pre-launch with no traffic; I need the *intent*,
   not the current state.

---

**Phase 0 complete. Stopping here per ground rule 9 and the phase's own instruction.**
