# Phase 5C/5D/5E — Reliability, Data, and Frontend/UX

> **Status: superseded in part.** This file records the repository as found on 2026-08-27, *before*
> any fix. Seven roadmap items have since landed and 11 findings are closed — see
> [`07-implementation.md`](07-implementation.md) for current counts and finding status. This file is
> deliberately left unedited as the baseline.

Three of the pack's five sub-phases are consolidated here. 5C (reliability) and 5D (data) each have
real but small surfaces in a browser-only app with no migrations and no schema, and splitting them
into thin files would obscure rather than clarify. 5E is included because its findings interact with
5C's — the same missing timeout produces both a reliability defect and a stuck UI state. The
re-scoping was agreed in §0a of the prompt pack.

---

# 5C — Reliability & Operability

## Error handling — better than expected

Counted every `catch` in `src/`: **69 blocks** across 11 files (`App.tsx` 29, `geminiService.ts` 16,
`keyVault.ts` 5, `firebase.ts` 5, the rest in single digits). Scanned for the classic failures:

- **Empty catch blocks: none.**
- **Log-and-continue on a critical path: one**, and it is deliberate and correct. `App.tsx:2336-2346`:
  ```ts
  const handleLogOut = async () => {
    try { await logOut(); } catch (err) { console.error(err); }
    setUser(null);
    setConfig((prev) => ({ ...prev, customApiKey: '' }));
  ```
  Signing out locally must succeed even if the remote call fails — and clearing the in-memory key
  regardless is the security-correct choice, documented at `:2343-2345`. This is the right pattern,
  not a swallowed error.
- **Unhandled promise rejections:** no `process.on('unhandledRejection')` on the server and no
  `window.onunhandledrejection` in the client. The client has an `ErrorBoundary`
  (`main.tsx:7-45`) which catches render errors and offers a reload, but React error boundaries do
  **not** catch errors in event handlers or async callbacks — which is where this app's errors live.
- **Cancellation is modelled properly.** `AbortError` is deliberately passed through untouched at
  three separate points (`geminiService.ts:395`, `:424`, and `asReadableError`), with a test
  asserting it — *"passes AbortError through untouched so cancellation stays distinguishable"*.
  That is a distinction most codebases get wrong.

## Timeouts — the real gap

Every `fetch` call site in the codebase, and whether it can hang:

| Location | Signal | Timeout | Verdict |
|---|---|---|---|
| `lib/designerBridge.ts:54` (`/health`) | ✅ | ✅ 1200 ms | Correct |
| `lib/designerBridge.ts:117` (`/open`) | ❌ | ❌ | **REL-002** |
| `components/ContactPage.tsx:279` (FormSubmit) | ❌ | ❌ | **REL-001** |
| `services/geminiService.ts:383` (catalogue) | ✅ caller's | ❌ | REL-003 |
| `services/geminiService.ts:405` (probe) | ✅ caller's | ❌ | REL-003 |

The pattern is inconsistent *within a single file*: `designerBridge.ts` guards its health probe
with an `AbortController` and an explicit comment about firewalls that drop rather than refuse
(`:41-46`), then omits the same guard on the request that actually matters.

## Retries, backoff, circuit breakers

None, anywhere. For this application that is mostly correct — a failed generation is a user-visible
event with a Retry button, and silently retrying a billed request on the user's own key would be
the wrong default. Worth stating explicitly so its absence reads as a decision rather than an
oversight. The one place a retry would help is transient Firestore write failures on save, which
currently surface as a terminal error message.

## Transactions

`handleSaveReport` (`App.tsx:2216-2286`) writes a single document. Firestore guarantees
single-document atomicity, so there is no partial-write window and no need for a transaction. The
delete path (`App.tsx:2310-2333`) removes one document. **No multi-document operation exists except
account deletion**, which must remove both the reports collection and the vault — and that one has
no test (Phase 3, dangerous path #3).

## Observability

Covered in full as ARC-003. Summary: `console.*` and nothing else. No structured logging, no
correlation ids, no metrics, no tracing, no client error reporting. `/api/health` returns a
constant and therefore reports "healthy" even if every downstream dependency is unreachable — which
is honest for a server that has no downstream dependencies, but means the endpoint carries no
information.

## Config validation, deploy, rollback

- **No startup config validation.** `server.ts` reads `NODE_ENV` and nothing else, so there is
  nothing to validate. `firebase-applet-config.json` is imported as a module
  (`firebase.ts:21`) and would fail the build if malformed — a reasonable accident.
- **No migrations.** Firestore is schemaless; the rules pin shape at write time.
- **No deploy pipeline, no rollback procedure, no backup, no restore.** `firebase.json` carries no
  `hosting` block, so the only deployable artifact is the rules file
  (`npx firebase deploy --only firestore:rules`). A rules deploy is instant, global, and has no
  staged rollout — a mistake there denies every user's writes at once, and the only recovery is
  another deploy. Since the rules are the entire security boundary **and** the entire validation
  layer, this is worth knowing before the first real deployment.
- **No CI.** INV-003.

---

## Findings — reliability

---

**ID:** REL-001
**Title:** The contact form's request has no timeout, so a hung third party leaves the form permanently in "sending"
**Severity:** P2
**Confidence:** High
**Location:** `src/components/ContactPage.tsx:276-290`
**Evidence:**
```ts
setState('sending');
// A rejected request goes to 'failed', never 'sent'. The previous version
// fell through to the success state on error and lost the message.
fetch('https://formsubmit.co/ajax/' + mailAddress(), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  ...
```
No `signal`, no `AbortController`, no `AbortSignal.timeout`. The `.catch` handles *rejection*, but a
socket that is accepted and then never answered does not reject — it hangs until the browser's own
timeout, which is on the order of minutes.
**Why it matters:** The comment above the call shows someone already fixed the harder version of
this bug — the previous code fell through to `'sent'` on error and silently lost the message. The
remaining case is the one where nothing resolves at all: the button stays disabled, the spinner
stays up, and the user has no signal and no way to retry short of reloading and retyping their
message. FormSubmit is a free third-party relay with no SLA; this is not a hypothetical.
**Repro:** Block `formsubmit.co` at the firewall in a way that drops rather than refuses (so the
connection hangs rather than failing fast), then submit the form. The UI stays in `'sending'`.
**Recommendation:** `AbortSignal.timeout(10_000)` on the request, and treat the resulting
`TimeoutError` as `'failed'` with a message that tells the user their text is still in the box.
`designerBridge.ts:47-64` is the pattern to copy — it is in this codebase already and its comment
explains exactly this failure mode.
**Effort:** S
**Fix risk:** None.

---

**ID:** REL-002
**Title:** `sendToDesigner` has no timeout while `pingDesigner` in the same file does
**Severity:** P2
**Confidence:** High
**Location:** `src/lib/designerBridge.ts:117` vs `:47-64`
**Evidence:** `pingDesigner` builds an `AbortController`, sets a 1200 ms timer, and clears it in a
`finally` — with a comment at `:41-46` explaining that *"a firewall that drops rather than refuses
would otherwise leave this pending and the button missing for as long as the tab is open."*
`sendToDesigner` at `:117` calls `fetch(\`${DESIGNER_ORIGIN}/open\`, …)` with no signal and no
timeout.
**Why it matters:** The reasoning already written down for the health probe applies verbatim to the
POST, and more so — the ping failing leaves a button hidden, but the POST failing leaves the user
having clicked **Open in designer** with no result and no error. The companion is a desktop
application that can be modal, minimised, or mid-crash while its listener socket is still open, so
"accepted but never answered" is a realistic state here rather than a theoretical one.
**Repro:** Not executed (companion must run on the user's own desktop). The asymmetry is visible
by reading `:47-64` against `:117`.
**Recommendation:** Give `sendToDesigner` the same `AbortController` + timeout treatment, at a
longer budget than the ping — writing a temp file and launching the designer is legitimately slower
than a health check, so 10–15 s rather than 1.2 s. Cover it in the same test as TEST-003, using fake
timers.
**Effort:** S
**Fix risk:** None. Choose the budget generously; a timeout that is too tight would break a slow
but working designer launch.

---

**ID:** REL-003
**Title:** The Gemini catalogue and probe requests rely entirely on user cancellation, with no timeout of their own
**Severity:** P3
**Confidence:** High
**Location:** `src/services/geminiService.ts:383-387`, `:405-417`
**Evidence:** Both pass the caller's `signal` through, so a user pressing Stop aborts them. Neither
sets a timeout. `resolveModel` fires up to 10 probes concurrently (`:459-461`) and `await`s
`Promise.all`, so **the slowest probe gates the entire generation start**.
**Why it matters:** Materially lower severity than REL-001/002 because a cancel path exists and is
correct — the user is not stuck, they can press Stop. But the failure shape is poor: one
unresponsive model endpoint stalls `Promise.all` and the user sees "starting" with no progress and
no explanation, on what is already documented as a minute-plus operation. There is no way for them
to know the delay is one probe rather than the model thinking.
**Repro:** Needs a key. UNVERIFIED in practice.
**Recommendation:** Give each probe an independent timeout — 5 s is generous for a 1-token request
— and switch `Promise.all` to `Promise.allSettled` so one hung endpoint cannot gate the rest. The
existing verdict type already has an `"unavailable"` case (`:401`) for a probe to fall into.
**Effort:** S
**Fix risk:** Low. A too-tight probe timeout would wrongly mark a slow-but-working model
unavailable, so err generous and log the timeout at `debug` beside the existing timing line.

---

# 5D — Data

## Shape and integrity

There is no schema. `firestore.rules` is the entire data contract, and it is a good one — reviewed
in detail in 05a. What it enforces:

| Constraint | Reports | Vault |
|---|---|---|
| Exact field set (`hasOnly` + `hasAll`) | ✅ 6 fields | ✅ 5 fields |
| Type checks | ✅ all | ✅ all |
| Size bounds | `id ≤ 128`, `name ≤ 256` | `ciphertext ≤ 2048`, `iv ≤ 64`, `salt ≤ 64` |
| Value bounds | `0 < timestamp < 4102444800000` | `iterations ≥ 100000` (SEC-005) |
| Ownership | `userId == request.auth.uid`, and update pins `userId` and `id` to the existing doc | path-scoped |
| Enumeration | `list` allowed, scoped to own collection | **no `list` clause** — deliberate |

**Invariants the code assumes that the database does not enforce:**

1. `messages` and `result` are typed `string` but unbounded — the comment at `:32-35` says
   Firestore's 1 MiB ceiling is the bound. That is true, and it is the mechanism behind the
   documented image-sync failure (`README.md:174`). A user can therefore push a document right up
   to the limit; the damage is confined to their own quota.
2. **`unit` and `pageSize` have no domain validation anywhere** — this is BUG-001, and it is a data
   finding as much as a logic one: an invalid value is *persisted* to `localStorage` and read back
   without complaint.
3. Nothing enforces that a `reports` document's `messages`/`result` are parseable JSON. A corrupted
   entry would fail at read time in the UI, not at write time in the rules.

**Can bad data exist today?** For a cloud-stored report: only the shapes above. The rules are
strict enough that malformed documents cannot be written by any client. For `localStorage`: yes,
freely — nothing validates it on write, and `mergeStoredConfig` is the only reader that defends
itself. I did not write queries to check for existing bad data, because there is no populated
database to query.

## Validation at the boundary

**Server-side validation does not exist, because there is no server in the data path.** The
boundary is `firestore.rules` and it is enforced by Google. This is a legitimate architecture for
this product, and it is worth stating plainly that it means: *the rules file is the only thing
standing between a modified client and the database*. That justifies the 29 tests it has, and
justifies keeping them at 100% as the rules change.

## Privacy — PII inventory

| Data | Where | Why | Retention | Deletion |
|---|---|---|---|---|
| Email address | Firebase Auth | Sign-in | Until account deletion | Account deletion |
| Display name (optional) | Firebase Auth | UI | Same | Same |
| Report title, conversation, spec, layout, XML, attached images | Firestore, per user | The product | Indefinite | Per-report, or account deletion |
| Encrypted API key (opt-in) | Firestore vault | Cross-session convenience | Indefinite | Vault delete, or account deletion |
| Name, email, message | **FormSubmit (third party)** | Contact form | **Unknown — third party** | **No mechanism** |
| IP, User-Agent | **Google Fonts** | Font delivery | Unknown | None |

The first four are accurately described on `/privacy` (`LegalPage.tsx:79-91`), including the
zero-knowledge property of the vault. **The last two are not disclosed at all** — SEC-003.

**Encryption at rest:** Firestore encrypts at rest by default; the vault adds client-side AES-GCM
on top so the operator cannot read it. **Audit trail for sensitive access:** none.
**Data export:** none — there is no "download my data" path. **Deletion:** account deletion exists
and must remove reports *and* vault; untested (Phase 3, path #3).

---

## Findings — data

---

**ID:** DATA-001
**Title:** Account deletion must remove two collections and nothing verifies that it does
**Severity:** P1
**Confidence:** Medium — the requirement is documented and the test's absence is verified; the deletion code path was not executed
**Location:** `src/components/AccountDialog.tsx`; `src/App.tsx`; `docs/notes/persistence.md`
**Evidence:** `firestore.rules` defines two per-user collections: `users/{userId}/reports/{reportId}`
and `users/{userId}/vault/{vaultId}`. `CLAUDE.md`'s router sends account-deletion questions to
`docs/notes/persistence.md` *"for what deleting an account has to remove"* — i.e. the requirement is
known and written down. No test in either suite exercises deletion: `tests/firestore.rules.test.ts`
covers whether a delete is *permitted*, never whether the application *performs* both.
**Why it matters:** A user who deletes their account and leaves an encrypted API key behind has had
a credential retained after asking for erasure. Ciphertext without the passphrase is not a
disclosure, but it is retained personal data with no deletion path and no way for the user to know.
This is the clearest GDPR-shaped exposure in the product after SEC-003, and unlike SEC-003 it is
silent — nobody finds out.
**Repro:** Not executed. Needs a live Firebase project and a disposable account. That is exactly
why it needs a test rather than a manual check.
**Recommendation:** Two things. First, an emulator-backed integration test: seed a user with
several reports and a vault document, run the deletion path, assert both collections are empty.
`npm run test:rules` already starts the emulator, so the harness exists. Second, verify by hand once
against a real project before any public launch, because the emulator cannot prove the Firebase Auth
user record is removed too.
**Effort:** M
**Fix risk:** Low for the test. If the test reveals the vault is *not* being deleted, the fix is
small but must be paired with a one-off cleanup for any existing accounts.

---

**ID:** DATA-002
**Title:** `localStorage` is written without validation on either side of the round-trip
**Severity:** P3
**Confidence:** High
**Location:** `src/App.tsx:2328-2332`; `src/lib/reportConfigStore.ts:52-81`
**Evidence:** The signed-out save path writes `localStorage.setItem('savedReports',
JSON.stringify(updated))` with no shape constraint — the Firestore equivalent is pinned to six
fields with types and bounds by `firestore.rules:25-38`. On the config side, `mergeStoredConfig`
defends its *reader* well (malformed JSON, wrong types, unknown keys all fall back to defaults,
probed with nine hostile payloads) but accepts any string for `unit` and `pageSize` (BUG-001).
**Why it matters:** The asymmetry is the finding. The same application state has a strict contract
in one store and none in the other, and TEST-004 records that nothing asserts they round-trip. A
signed-out user's data is the *less* protected copy, which is backwards — it is the copy with no
server-side authority behind it at all.
**Repro:** Compare `firestore.rules:25-38` against `App.tsx:2330`.
**Recommendation:** Write one validator and use it on both paths — the field list and bounds
already exist in the rules and can be transcribed once into `lib/`. Validate on read as well as
write, so a corrupted entry degrades to "this report could not be loaded" rather than a blank view.
**Effort:** M
**Fix risk:** Low. Existing `localStorage` data that fails the new validator must degrade
gracefully, not throw — that is the case to test first.

---

# 5E — Frontend / UX / Accessibility

**Scope limit, stated up front:** no automated accessibility scan was run and no manual keyboard-only
pass was performed. Browser automation was available but this session's paired browser belongs to a
different user's desktop session, so driving it was not appropriate. Everything below is **static
analysis of the source**, which can find missing attributes and wrong element choices but cannot
find contrast failures, focus-order problems, or screen-reader flow issues. **Treat a clean result
here as "not disproved", not "accessible".**

## What the static scan found — mostly good

Across 20 `.tsx` files: 15 `aria-label`, 24 `aria-hidden`, 9 `role=`, 40 `<button>`, and
**13 `<label>` against 13 `htmlFor`** — every label is bound to a control, which is the single most
commonly failed check and it passes cleanly.

`focus-visible` appears 6 times and `:focus` 13 times in `workspace.css`, plus a `u-focus-ring`
utility used on controls in the marketing chrome. Focus styling exists and is deliberate.

`prefers-reduced-motion` appears 3 times across the two stylesheets, and `useReducedMotion` 13
times in components — plus `MotionConfig reducedMotion="user"` at `main.tsx:52`, whose comment
correctly notes that the CSS media query only reaches CSS transitions and that Framer needs the
prop. Motion preferences are handled thoroughly on both sides.

**A candidate finding I rejected:** a regex scan reported 9 `<img>` tags against only 3 `alt`
attributes, which looked like six missing. It is wrong. `Logo.tsx:70-80` spreads `alt` (defaulting
to `''`) through an `imgProps` object *and* sets `'aria-hidden': alt ? undefined : true` — the
textbook decorative-image pattern, with a comment saying so at `:75`. Six of the nine matches are
`<img>` appearing inside comment prose. Every real image is correctly handled. Recording the
rejection so nobody re-finds it.

---

**ID:** UX-001
**Title:** The header's account menu is a `<div>` with `onClick` — unreachable by keyboard
**Severity:** P2
**Confidence:** High
**Location:** `src/components/SiteHeader.tsx:123-126`
**Evidence:**
```jsx
<div
  onClick={() => setShowProfileMenu(!showProfileMenu)}
  className="flex items-center gap-2.5 px-3 py-1.5 ... cursor-pointer transition-colors"
>
```
No `role="button"`, no `tabIndex`, no `onKeyDown`, no `aria-expanded`, no `aria-haspopup`. Nine
lines above it, the theme toggle at `:112-119` is a proper `<button>` with the `u-focus-ring`
utility — so the correct pattern is in the same file, in the adjacent element.
**Why it matters:** For a signed-in user this is the header's entry point to the account dialog.
A keyboard-only or screen-reader user cannot open it: it takes no focus, so Tab skips it entirely
and Enter has nothing to act on. WCAG 2.2 AA fails on 2.1.1 Keyboard and 4.1.2 Name, Role, Value.
It is also the only place in the scan where an interactive element is not a real control — the two
other `onClick`-on-a-`div` hits are `MobileNav.tsx:60` and `:68`, which are a backdrop
click-to-close and a panel `stopPropagation`, both standard, and that menu closes on Escape via
`MobileNav.tsx:35`.
**Repro:** Sign in, load any page with the site header, and press Tab repeatedly. Focus never lands
on the account control.
**Recommendation:** Change the `<div>` to a `<button type="button">`, add `aria-expanded={showProfileMenu}`
and `aria-haspopup="menu"`, and apply the `u-focus-ring` class the sibling toggle already uses.
Also add Escape-to-close, matching `MobileNav`. Check the styling afterwards — a `<button>` inherits
UA styles that a `<div>` does not, which `ContactPage.tsx:626-628` documents as a real trap in this
codebase.
**Effort:** S
**Fix risk:** Low, but visual. There is no visual regression test, so compare the header by eye in
both themes.

---

**ID:** UX-002
**Title:** No 404 view — every unknown path silently renders the home page under its own URL
**Severity:** P3
**Confidence:** High
**Location:** `server.ts:48-50`; `src/lib/routes.ts:96-98`
**Evidence:** Verified against the running production server: `GET /nonexistent-page` returns
**200** with `index.html`. Client-side, `viewForRoute` falls through to
`{showWorkspace: false, showLogin: false, loginMode: null, lastViewPath: '/'}` and `titleForRoute`
returns the home title, so the browser shows the landing page with `/nonexistent-page` still in the
address bar and "Forma — Screenshot to DevExpress .repx" in the tab.
**Why it matters:** A typo'd or dead link looks like a working page. The user has no signal they
are somewhere that does not exist, and the URL they might copy or bookmark is wrong. It also means
search engines receive a 200 for every non-existent path — soft-404s, which they penalise.
`routes.ts:101-108` shows the team already thinks carefully about routes that silently render as
`/`; this is the same failure mode arriving from outside the route table rather than inside it.
**Repro:** `Invoke-WebRequest http://localhost:3000/nonexistent-page` → 200, `text/html`, 4,753 bytes.
**Recommendation:** Add a `notFound` branch to `viewForRoute` distinct from the `/` case, render a
small 404 view with a link home, and give it a title. The SPA fallback must keep returning
index.html at the HTTP level — that is how SPAs work — so this is a client-side fix, and the
`routesWithoutABranch()` test should be extended to know about the new branch.
**Effort:** S
**Fix risk:** None functionally. Take care that the new branch does not accidentally capture a
legitimate route — which is precisely what `routesWithoutABranch()` exists to catch.

---

**ID:** UX-003
**Title:** No screen state inventory — loading, empty, error and offline states are unenumerated and untested
**Severity:** P3
**Confidence:** Medium — states clearly exist for the main flow; whether each screen covers all four was not verified per screen
**Location:** across `src/App.tsx` and `src/components/`
**Evidence:** The generation flow demonstrably has loading (three `setInterval` progress drivers),
error (a classified message path via `asReadableError`), and cancellation states. `ContactPage`
has `'sending'` / `'sent'` / `'failed'`. But nothing enumerates the four-state matrix per screen,
no component test asserts any of them, and **offline is handled nowhere** — there is no
`navigator.onLine` check or offline messaging anywhere in `src/`, so a dropped connection surfaces
as whatever error the underlying `fetch` produces.
**Why it matters:** The pack's observation that *"most apps are missing empty and error states"* is
hard to confirm or refute here without rendering each screen, and rendering each screen is exactly
what has no test harness (ARC-001). The specific gap I can state with confidence is offline: a user
who loses connectivity mid-generation gets a network error message rather than "you appear to be
offline", and for a product whose core operation takes a minute or more, that is a realistic case.
**Repro:** `git grep -i "navigator.onLine\|offline"` in `src/` → no matches.
**Recommendation:** Low priority relative to everything else here. When the component-test harness
from Phase 3 exists, an inventory of the four states per screen becomes cheap to write and cheap to
enforce. Until then, adding an offline check to the generation error path is the one piece worth
doing on its own.
**Effort:** S for offline; M for the full inventory
**Fix risk:** None.

---

## Not assessed in 5E

| | |
|---|---|
| Automated a11y scan (axe) | Not run — no browser session appropriate to drive. |
| Manual keyboard-only pass of the critical flows | Not run. UX-001 was found by reading source, not by tabbing. |
| Colour contrast | Not measured. Needs rendered pages. `docs/design/DESIGN.md` defines the palette; whether it meets 4.5:1 is unverified. |
| Responsive behaviour at 320 px, tablet, 200% zoom | Not tested. |
| Screen-reader flow | Not tested. |
| Heading order and landmark structure | Partially — 6 `<h1>` across 20 files is plausible for 6 top-level pages, but per-page heading order was not checked. |
| i18n readiness | Strings are hardcoded throughout with no i18n layer. `docs/PRD.md` lists RTL as "not yet exposed in the UI", so this is a known and accepted state, not a finding. |
