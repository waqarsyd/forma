# Phase 6 — Gap Analysis & Roadmap

> **Status: superseded in part.** This file records the repository as found on 2026-08-27, *before*
> any fix. Seven roadmap items have since landed and 11 findings are closed — see
> [`07-implementation.md`](07-implementation.md) for current counts and finding status. This file is
> deliberately left unedited as the baseline.

**46 findings: 4 × P0-adjacent P1, 16 × P2, 26 × P3.** No P0. Assessed 2026-08-27 against `main`
at `55da76e` plus two uncommitted documentation edits.

---

## Executive summary

Forma is a **well-reasoned codebase with one structural problem, one process gap, and one promise
it is not keeping.** It is in materially better shape than its stage would predict, and the reason
is unusual: the documentation is accurate enough to audit against. Every mechanically checkable
claim in `CLAUDE.md` held — the per-file test counts to the individual digit, the Node 21/23
subtlety, the database-id match, the 11-hit mojibake exception. That is not a soft compliment; it
is why this audit could reach 46 findings without a working API key.

**The five things that matter most:**

1. **The privacy page states data never leaves the browser, and the contact form sends name, email
   and message to an undisclosed third party.** This is the only finding with a legal dimension and
   the only one where the fix is a paragraph of text. Fix it first because it is cheap, and because
   adding error reporting later (which you should) makes it worse.
2. **`App.tsx` is 4,221 lines, holds every piece of application state, changes in a third of all
   commits, and has no test.** Everything else about the codebase's testability is downstream of
   this. It is also, directly, why Phase 4 could not test file intake.
3. **The cryptography protecting users' API keys has no test.** The storage *rules* are covered by
   29 tests; the encrypt/decrypt round-trip is covered by none. Given the product promises a
   forgotten passphrase is unrecoverable by design, a decryption regression is permanently
   destructive. This is the cheapest high-value test in the repo — an hour's work.
4. **Nothing runs automatically.** No CI, no hooks, no gates. Five documented checks, all of which
   pass, all of which are fast, none of which anything enforces. The mojibake sweep in particular
   has no runnable form in CI and has already caused a user-visible failure once.
5. **The marketing pages ship 539 kB gzipped of JavaScript they do not use.** For an open-source
   project whose landing page is its front door, that is the wrong shape.

**The single biggest risk** is not any individual finding. It is that `App.tsx` is simultaneously
the highest-complexity, highest-churn and zero-coverage file, and that the project's only defence
against regression there is one person looking at a rendered page. Every other finding is bounded;
that one compounds with each feature.

**Would I be comfortable shipping this to 10× current traffic?** Current traffic is zero, so the
honest form of the question is: *would I be comfortable making this public?* **Not today, and the
blockers are small.** Fix the privacy text (SEC-003), add security headers (SEC-001), stop the dev
server binding `0.0.0.0` (SEC-002), and verify account deletion removes the vault (DATA-001). That
is roughly a day. The architecture underneath — bring-your-own-key, no server in the data path,
rules as the enforced boundary — scales fine, because there is almost nothing to scale.

**One thing to be blunt about:** the quality gap in this project is not between good code and bad
code. It is between *what is written down* and *what is enforced*. The reasoning is excellent and
lives in prose; the enforcement is five commands a human has to remember. Closing that gap — CI,
plus the specific tests below — is worth more than any refactor on this list.

---

## Scorecard

| Area | 1–5 | Justification | Finding IDs |
|---|---|---|---|
| **Documentation** | **5** | Accurate to the digit where checkable; the `CLAUDE.md` router genuinely works. Only small drifts found. | INV-008, INV-010, INV-011, RUN-003, RUN-005 |
| **Security design** | **4** | Key architecture and Firestore rules are both excellent and both incident-driven. Docked for zero HTTP headers and the privacy contradiction. | SEC-001, SEC-002, SEC-003, SEC-005 |
| **Data** | **4** | `hasOnly`+`hasAll`, per-operation rules, bounded values, no vault `list`. Docked for the unvalidated `localStorage` twin and the untested deletion path. | DATA-001, DATA-002, BUG-001 |
| **Test quality** | **5** | Zero assertion-free, zero skipped, zero `.only`, zero snapshots, zero sleeps, zero unseeded randomness. One mocking file and it is legitimate. | TEST-005 |
| **Test coverage** | **1** | ≈8.8% of `src/` genuinely exercised. Nothing on `App.tsx`, no component test, no coverage tooling. | TEST-001–004, INV-004 |
| **Architecture** | **3** | Clean layering, no cycles, no dead code — but effectively one layer, and it is 4,221 lines. | ARC-001, ARC-002, ARC-005 |
| **Code quality** | **4** | Consistent patterns, no TODO debt, good naming, thoughtful comments. Docked for two 130–216-line functions. | ARC-002 |
| **Type safety** | **2** | Compiles clean with every strictness flag off, which makes the clean exit weak evidence. | ARC-004 |
| **Reliability** | **3** | 69 catch blocks, one deliberate log-and-continue, cancellation modelled properly. Docked for two outbound calls with no timeout. | REL-001, REL-002, REL-003 |
| **Performance** | **2** | One 1.99 MB chunk, no splitting, two render-blocking third-party stylesheets, no budget. | PERF-001, PERF-002, PERF-003 |
| **Observability** | **1** | `console.*` and nothing else. A 3am failure would leave no trace. | ARC-003 |
| **DX** | **4** | Five fast documented checks that all pass; excellent onboarding docs. Docked entirely for nothing running them. | INV-003, INV-005, RUN-004 |
| **UX / A11y** | **3** | Labels all bound, motion preferences handled thoroughly on both CSS and Framer sides, images correct. Docked for one keyboard-inaccessible control and no 404. **Statically assessed only.** | UX-001, UX-002, UX-003 |

---

## Gap analysis

| Area | Current | Target for a public open-source app at this stage | Gap | Impact if unaddressed | IDs |
|---|---|---|---|---|---|
| Privacy disclosure | Statement contradicted by code | Statement matches behaviour | One paragraph + two named processors | Regulatory exposure; reputational damage disproportionate to the actual data flow | SEC-003 |
| HTTP headers | None | CSP, XFO, nosniff, Referrer-Policy | One middleware | Sign-in form is clickjackable; no defence in depth around a live API key | SEC-001 |
| CI | None | Lint + test + build gate on push | One workflow file | Every invariant depends on human memory | INV-003 |
| Coverage of critical paths | ≈8.8%, none on generation/persistence | 60%+ on `lib/`+`services/`, smoke on components | keyVault, geminiService parsing, deletion, extraction of `App.tsx` | Regressions found by users | TEST-001–004 |
| God file | 4,221 lines, 30 `useState` | No file over ~800; state extractable | Sustained extraction | Every feature raises risk; no path to component tests | ARC-001, ARC-002 |
| Bundle | 539 kB gz eager | <150 kB gz on marketing routes | One lazy boundary + self-hosted fonts | Slow front door on the page most likely to be seen once | PERF-001, PERF-002 |
| Observability | None | Client error reporting | One reporter behind a flag | Silent failures stay silent | ARC-003 |
| Type safety | No strict flags | `strictNullChecks` minimum | Measure, then enable incrementally | The green typecheck overstates safety | ARC-004 |
| Timeouts | 2 of 5 fetch sites guarded | All guarded | Two one-line fixes | Users stuck in permanent "sending" | REL-001, REL-002 |
| Dependency hygiene | Build tools in `dependencies`; 12 advisories | Correct split; audit clean | `npm audit fix` + move 3 entries | Scanners report build-tool CVEs as production exposure | SEC-004, SEC-006 |

---

## Roadmap

### Now — this week

| # | Item | IDs | Effort | Risk | Acceptance criteria | Verify by |
|---|---|---|---|---|---|---|
| 1 | **Fix the privacy statement** | SEC-003 / INV-001 | S | None | `/privacy` names FormSubmit and Google Fonts as processors, and the "nothing leaves your browser" sentence excludes the contact form | Read `/privacy`; grep `LegalPage.tsx` for both names |
| 2 | **Add security headers + `disable('x-powered-by')`** | SEC-001 | S | Low | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` present; no `X-Powered-By` | `Invoke-WebRequest` header dump against `npm start` |
| 3 | **Bind the dev server to loopback by default** | SEC-002 | S | Low | `npm run dev` listens on `127.0.0.1`; `HOST` env opts into `0.0.0.0` | `Get-NetTCPConnection -LocalPort 3000` shows loopback only |
| 4 | **Test `keyVault.ts`** | TEST-001 | S | None | 6 tests: round-trip, wrong passphrase rejects, tampered ciphertext rejects, iterations pinned at 310,000, salt/IV differ per call, legacy key removed | `npm test` green with 173 |
| 5 | **Add the two missing timeouts** | REL-001, REL-002 | S | None | Contact form and `sendToDesigner` both abort and surface a retryable error | Tests with fake timers (pairs with TEST-003) |
| 6 | **Add CI** | INV-003 | S | None | Push runs lint → test → mojibake sweep → build (~50s); rules suite nightly | A deliberately broken commit fails the pipeline |
| 7 | **`npm audit fix` + move build tools to `devDependencies`** | SEC-004, SEC-006 | S | Low | `npm audit --omit=dev` reports 0; `vite`/`@vitejs/plugin-react`/`@tailwindcss/vite` are dev deps | Both suites + a build pass after |

*Sequencing note:* item 1 must precede any error-reporting work (ARC-003), because that adds a third
undisclosed processor. Item 6 should land early so items 4, 5 and everything after are actually
gated.

### Next — this month

| # | Item | IDs | Effort | Risk | Acceptance criteria |
|---|---|---|---|---|---|
| 8 | **Verify and test account deletion** | DATA-001 | M | Low | Emulator test seeds reports + vault, runs deletion, asserts both empty; plus one manual run against a real project |
| 9 | **Validate `unit` / `pageSize` at the boundary; add `Document` and `Tabloid`** | BUG-001 | S | Low | An unsupported persisted value falls back to the default and warns; `Document`→300 and `Tabloid`→11×17 present and tested |
| 10 | **Extract `handleGenerate`'s state machine** | ARC-001, ARC-002 | M | Moderate | Progress/cancellation/error classification is a pure reducer in `lib/`, tested with no key and no network; `App.tsx` wires it |
| 11 | **Code-split at `/workspace` + self-host fonts** | PERF-001, PERF-002 | M | Moderate | Marketing-route JS under 150 kB gz; no `fonts.googleapis.com` request; designer button still works under any CSP added |
| 12 | **`engines` field + measure `--strict`** | INV-005, ARC-004 | S | Low | `"engines": {"node": "^20 \|\| ^22 \|\| >=24"}`; the `--strict` error count is recorded and a decision taken |
| 13 | **Close the `designerBridge` and `geminiService` test gaps** | TEST-002, TEST-003 | M | None | 5 of 6 `designerBridge` exports covered; `analyzeReportDesign` response parsing driven from captured fixtures, including a truncated one |
| 14 | **Client error reporting behind a flag** | ARC-003 | M | Low | `ErrorBoundary` and the generation catch report to a configurable sink; **privacy text updated in the same PR** |

### Later — this quarter

| # | Item | IDs | Effort |
|---|---|---|---|
| 15 | Continue extracting `App.tsx` until a component-test harness is viable; smoke-render the five marketing pages | ARC-001 | L |
| 16 | Unify the `localStorage` / Firestore report shapes behind one validator | DATA-002, TEST-004 | M |
| 17 | Enable `strictNullChecks`, then further flags, one per commit | ARC-004 | M–L |
| 18 | Bundle budget in CI; record sizes in `README.md` beside the timings | PERF-003 | S |
| 19 | Automated a11y scan + a manual keyboard pass of the critical flows; fix what they find | UX-001, UX-003 | M |
| 20 | The P3 correctness cluster: `boxToSourceRect` clamping, reserved device names, filename length cap, `rankDiscovered` coercion, per-probe timeouts | BUG-002–005, REL-003 | S each |
| 21 | The documentation drift cluster — one pass, one commit | INV-006, 008–011, RUN-001, 003–006, ARC-005, SEC-005 | S total |

### Someday / won't do

| Item | Why not |
|---|---|
| Load testing, p50/p95/p99 | One endpoint returning a constant. The numbers would be theatre. |
| Moving generation server-side | `docs/PRD.md` §6 rules it out explicitly, and the bring-your-own-key architecture is a deliberate response to a real leak. Do not revisit without revisiting that decision first. |
| Metrics / distributed tracing | No server on any data path. Client error reporting (item 14) is the right-sized version. |
| E2E suite | Needs a key and a live project per run. Revisit once component tests exist and the marginal value is clearer. |
| Mutation testing | Premature at 8.8% coverage. |
| Migrations tooling, RTO/RPO, DR runbook | No schema, nothing deployed. Revisit at launch. |
| A license decision | Out of audit scope and genuinely the owner's call — but note `README.md:180` is right that nobody currently has the right to use this code. It blocks "open source" being true. |

---

## Quick wins — high impact, low effort

Seven items, roughly a day between them, closing one P1 and five P2s:

1. **Privacy text** (SEC-003) — one paragraph, closes the only legally-shaped finding.
2. **Security headers** (SEC-001) — one middleware, closes an OWASP A05 fail.
3. **`keyVault` tests** (TEST-001) — an hour, closes the highest-consequence untested path.
4. **Two timeouts** (REL-001, REL-002) — two lines, closes two P2s.
5. **CI workflow** (INV-003) — ~50s of checks that already exist and already pass.
6. **Loopback dev bind** (SEC-002) — one argument, matters specifically on this shared host.
7. **`npm audit fix` + dependency split** (SEC-004, SEC-006) — makes the vulnerability number mean
   something.

---

## Things that are GOOD — protect these during refactoring

1. **The bring-your-own-key architecture.** No env read, `VITE_*` allowlist, no key-bearing server
   route, `sessionStorage` only, legacy plaintext actively deleted. Every part of this is a
   correction to a real incident. Any change that reintroduces a key on the server or in the bundle
   is a regression to a known-bad state, and `server.ts:19-25` says so in the file itself.
2. **`firestore.rules`.** `hasOnly`+`hasAll`, per-operation splits with recorded reasons, bounded
   timestamp, iteration floor, no vault `list`, 29 passing tests. Keep it at 100% coverage as it
   changes — it is the entire security boundary *and* the entire validation layer.
3. **No `dangerouslySetInnerHTML`, and `react-markdown` without `rehype-raw`.** The obvious XSS
   vector in a product that renders model output is closed by construction. Do not add `rehype-raw`.
4. **The documentation discipline.** `CLAUDE.md` as a router with the reasoning in `docs/notes/`,
   incidents recorded with dates, and the rule that new reasoning goes in the note rather than the
   index. This is why the audit worked.
5. **`reportGeometry.ts`.** One place for four coordinate systems, every constant explained, the
   254-not-250 trap named. BUG-001 is about its *callers*, not about it.
6. **The pure-helper extraction pattern.** Eleven modules already pulled out of `App.tsx` so tests
   could reach them. This is the correct answer to ARC-001 and it is already in motion.
7. **The `/api/*` guard.** `server.ts:27-36` — verified returning 404 JSON for both deleted routes.
8. **Test quality.** Every test asserts, none is skipped, none sleeps, none is random. Do not let
   volume dilute this.
9. **Cancellation modelling.** `AbortError` passed through untouched at three points with a test
   pinning it.
10. **The companion's origin check.** Anchored regex, no `Access-Control-Allow-Origin` for unknown
    origins, and a deliberately non-safelisted header forcing the preflight that makes the check
    possible. Both halves correct and both documented.

---

## What I could NOT assess, and why

Stated explicitly so the roadmap does not read silence as a pass.

| Not assessed | Why | What would change it |
|---|---|---|
| **Generation quality, `repxContent` validity, the known truncation bug** | No Gemini API key | A key entered in the Settings dialog by you — not pasted into a chat |
| Model resolution wall-clock, probe cost, streaming behaviour | Same | Same. Instrumentation already exists at `geminiService.ts:462` |
| Sign-in, cloud save, account deletion end to end | No live Firebase project or disposable account | A test project |
| Designer round-trip, `forma-repx://` registration | Companion must run on your own desktop session | You double-clicking `RepxDesigner.exe --serve` |
| Line/branch coverage | No provider installed; installing modifies the lockfile (ground rule 4) | Your approval to add `@vitest/coverage-v8` |
| Colour contrast, focus order, screen-reader flow, responsive at 320 px / 200% zoom | Needs rendered pages in a browser; this session's paired browser belongs to another user's desktop | An axe scan and a keyboard pass |
| Core Web Vitals | Same | Same |
| React re-render profiling | Needs a live workspace with a generated mockup | A key |
| Concurrency, double-submit, idempotency, failure injection | Needs the generation and save flows running | A key + a test project; the Firestore half could use the emulator today |
| File-intake edge cases (`ingestFile`) | Not importable without pulling in pdf.js and Firebase — **ARC-001 blocking the audit directly** | The extraction in roadmap item 10/15 |
| Whether a fresh clone installs cleanly | `npm install` not re-run (ground rule 4) | CI doing `npm ci` on every push — roadmap item 6 |
| Flakiness | Suite run once, not five times | 20 seconds whenever someone wants to |

**Two findings carry Medium confidence and are flagged in place:** TEST-004 (the `localStorage`/
Firestore shape divergence is documented and untested, but I did not demonstrate a concrete losing
case) and BUG-003 (the path-length arithmetic is confirmed; the resulting user-visible failure was
not observed). DATA-001 is Medium on execution and High on the absence of any test.

**Two candidate findings were rejected on a second pass** and are recorded in `04-bugs.md` so they
are not re-found: trailing-slash routing (normalised at `router.ts:37-40`) and `rankDiscovered`
throwing (unreachable — its only caller filters). One more was rejected in `05c`: the apparent
missing `alt` attributes, which are correctly handled via a spread object in `Logo.tsx:70-80`.

---

## Test strategy going forward

**Targets by layer:**

| Layer | Target | Notes |
|---|---|---|
| `lib/` | ~100% of exports | 11 of 13 already there; close `designerBridge` |
| `services/` | 60% of exports | `keyVault` first, then `geminiService` parsing from fixtures |
| `firestore.rules` | 100%, permanently | A rule change without a test is a regression waiting |
| `App.tsx` | Extract, then cover the extraction | Never test it in place |
| Components | Smoke-render the five marketing pages | Cheap; gives a11y somewhere to live |

**Test at which level:** pure logic as unit tests (the existing pattern, and it works); anything
touching Firestore as emulator integration tests (the harness already exists in
`npm run test:rules`); nothing at E2E until component tests exist.

**What to stop testing:** nothing. There is no wasted test in this repository.

**CI gates, in order:** `npm run lint` → `npm test` → mojibake sweep → `npm run build` (~50s total,
per push) → `npm run test:rules` (needs Java; nightly is enough).

---

## STOP

Phase 6 complete. Per the pack, this is where the audit stops and you choose what gets worked on.
Phase 7 implements approved items one at a time — failing test first, minimal change, full suite
plus lint plus typecheck, critical flows re-verified, one commit per finding ID.

**Tell me which items to take and I will start with the failing test.** If you want a
recommendation: **Now items 1–7**, in that order, as seven separate commits.
