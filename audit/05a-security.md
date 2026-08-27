# Phase 5A — Security

> **Status: superseded in part.** This file records the repository as found on 2026-08-27, *before*
> any fix. Seven roadmap items have since landed and 11 findings are closed — see
> [`07-implementation.md`](07-implementation.md) for current counts and finding status. This file is
> deliberately left unedited as the baseline.

## Threat model

**Assets:** the user's Gemini API key (a live billable credential); their uploaded designs, which
may be confidential business documents; their saved reports; their account identity; and — the
asset most projects forget — the *operator's* reputation, since the privacy page makes promises.

**Actors:** an anonymous visitor; a signed-in user; another signed-in user (the interesting one);
a malicious web page open in the same browser as Forma; whoever operates a Forma deployment; Google.

**Trust boundaries:**

1. Browser ↔ `generativelanguage.googleapis.com` — carries the user's key. Not the operator's
   problem by design, and that is the whole point of the architecture.
2. Browser ↔ Firestore — **the only boundary the operator controls, and it is enforced entirely by
   `firestore.rules`.** There is no server-side validation anywhere in this product.
3. Browser ↔ `127.0.0.1:7317` — a web page reaching a native program on the user's machine.
4. Browser ↔ `formsubmit.co` — carries visitor PII to an undisclosed third party.
5. The Express server — carries nothing. One route, returning a constant.

**Entry points:** nine client routes, one HTTP endpoint (`/api/health`), the file-upload intake, the
config dialog, the contact form, and the `forma-repx://` protocol handler.

---

## OWASP Top 10 (2021) coverage

| # | Category | Status | Evidence |
|---|---|---|---|
| A01 | Broken Access Control | **Pass** | Every rule is `userId == request.auth.uid`; `firestore.rules:88-113` splits create/update/delete, and update pins both `userId` and `id` against the existing document so a record cannot be re-homed. 29 emulator tests cover cross-account read/write/delete and unauthenticated access — all pass. No IDOR surface: no HTTP endpoints take an object id. |
| A02 | Cryptographic Failures | **Pass** | PBKDF2-HMAC-SHA256, 310,000 iterations (`keyVault.ts:41`, OWASP's 2023 floor), AES-GCM-256, 16-byte salt and 12-byte IV per record from `crypto.getRandomValues` (`:122-123`). Authenticated encryption, so tampering fails closed. One gap: it has **no test** (TEST-001). One inconsistency: SEC-005. |
| A03 | Injection | **Pass** | No SQL, no NoSQL query built from strings, no `eval`, no `new Function`, no `document.write`, no shell execution. Firestore access is via typed SDK calls with literal paths. XXE probed against `checkRepx` and rejected. |
| A04 | Insecure Design | **Pass, notably** | The bring-your-own-key architecture is a *response* to a real incident and removes the operator from the credential path entirely. `docs/PRD.md` §6 records that moving generation server-side is explicitly out of scope. |
| A05 | Security Misconfiguration | **Fail** | Zero HTTP security headers. `X-Powered-By: Express` advertised. Dev server binds `0.0.0.0`. See SEC-001 and SEC-002. |
| A06 | Vulnerable Components | **Pass (with caveats)** | 12 advisories, 1 critical. **None reaches the shipped bundle** — verified by string-searching `dist/`. See SEC-004. |
| A07 | Identification & Auth Failures | **Pass** | Firebase Auth handles password storage, session tokens, reset and lockout. The sign-in fallback that fabricated a session on an unrecognised domain was removed as an authentication bypass and `README.md:162` forbids its return. No custom auth code to get wrong. |
| A08 | Software & Data Integrity | **Partial** | `package-lock.json` committed. No SRI on the two Google Fonts stylesheets (no integrity attribute is possible for a Google Fonts CSS URL, which is itself the argument for self-hosting). No CI, so no build provenance. |
| A09 | Logging & Monitoring Failures | **Fail** | Nothing. `console.*` only. A successful attack would leave no trace anywhere. See ARC-003. |
| A10 | SSRF | **N/A** | No server-side fetching of any kind. The server makes no outbound requests. |

**API Security Top 10** is largely inapplicable: there is one endpoint and it takes no input.

---

## What is genuinely well done

Recording this first because it is the majority of the picture and the findings below should be
read against it.

- **No `dangerouslySetInnerHTML` anywhere in the codebase**, and `react-markdown` is used at
  `App.tsx:3807` with `remarkPlugins={[remarkGfm]}` and **no `rehype-raw`**. Model-generated
  markdown — the obvious stored-XSS vector in a product like this — is escaped by construction.
  This is the single most important thing they got right after the key architecture.
- **The key never touches disk, the server, or the bundle.** No env read exists;
  `vite.config.ts:17` allowlists `VITE_*`; `server.ts:19-25` documents the two deleted key-bearing
  routes and forbids their return; `keyVault.ts:187-207` uses `sessionStorage`; and `:215-221`
  actively *deletes* the legacy plaintext `localStorage` entry rather than leaving it.
- **The deleted routes fail closed and were verified doing so.** `/api/generate-report` and
  `/api/debug-key` both return `404 application/json`, not the SPA's 200 + HTML.
- **The companion's origin check is correct.** `Program.cs:477-480` matches
  `^http://(localhost|127\.0\.0\.1)(:\d+)?$` — anchored at both ends, no `.startsWith`, no
  substring match, and an unrecognised origin gets **no** `Access-Control-Allow-Origin` header, so
  the browser blocks the real request after preflight. The non-safelisted `x-forma-client` header
  (`designerBridge.ts:20-25`) exists specifically to *force* that preflight. Both halves are
  documented and both are right.
- **`firestore.rules` uses `hasOnly` and `hasAll`.** `:20-24` records that the previous
  `keys().size() >= 6` accepted the required fields *plus anything else*, letting a modified client
  append arbitrary data under its own account. Fixed, and the reason written down.
- **Path traversal is defended twice**, independently, on both sides of the designer bridge.
- **Prototype pollution is closed by construction** — `mergeStoredConfig` iterates a fixed
  allowlist of five field names and never touches keys from the parsed object. Probed with
  `__proto__` and `constructor.prototype` payloads; `Object.prototype` was not polluted.
- **`.gitignore` carries credential backstop patterns** (`key.txt`, `*.key`, `*apikey*`,
  `*api-key*`, `secrets.json`) so a pasted key cannot be committed by a careless `git add .`.
- **No live credential in git history.** All 78 commits scanned; four `AIzaSy`-shaped strings, all
  accounted for (one public Firebase identifier, three placeholders).

---

## Findings

---

**ID:** SEC-001
**Title:** The application serves no security headers at all, and advertises its framework
**Severity:** P2 — **P1 if deployed publicly**
**Confidence:** High
**Location:** `server.ts:6-55`
**Evidence:** Full response header set from the production server on `/`, captured this session:
```
Connection, Keep-Alive, Accept-Ranges, Content-Length, Cache-Control,
Content-Type, Date, ETag, Last-Modified, X-Powered-By: Express
```
Absent: `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options` /
`frame-ancestors`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`,
`Cross-Origin-Opener-Policy`. `server.ts` calls no header middleware and does not disable
`x-powered-by`.
**Why it matters:** Three of these are load-bearing for *this specific* application:
- **`X-Frame-Options` / `frame-ancestors`.** `/login` and `/signup` render a sign-in form. With no
  framing policy, any site can iframe them and clickjack.
- **`Content-Security-Policy`.** The app renders model-generated markdown and holds a live API key
  in `sessionStorage`. React escaping is the *only* thing standing between a future
  `rehype-raw`-shaped mistake and a key exfiltration. A CSP is the defence in depth that makes that
  mistake survivable, and it is currently absent.
- **`Referrer-Policy`.** Outbound links to GitHub, DevExpress and AI Studio leak the full referring
  URL by default.

`X-Powered-By` is minor on its own; it is listed because removing it is one line in the same edit.
**Repro:**
```powershell
npm run build; npm start
Invoke-WebRequest http://localhost:3000/ -UseBasicParsing | Select-Object -Expand Headers
```
**Recommendation:** Add a header middleware in `server.ts` before the static branch, and
`app.disable('x-powered-by')`. Start with `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and
`Permissions-Policy: camera=(), microphone=(), geolocation=()`. Add HSTS only behind TLS. CSP needs
care and should be added last, in report-only mode first: the policy must allow
`fonts.googleapis.com` / `fonts.gstatic.com` (or, better, self-host the fonts and drop them from the
policy), `generativelanguage.googleapis.com`, the Firebase endpoints, `formsubmit.co` if it stays,
and `http://127.0.0.1:7317` in `connect-src` or the designer button breaks. That last one is the
detail most likely to be missed — test the designer bridge after enabling CSP.
**Effort:** S for the basic headers; M for a correct CSP
**Fix risk:** Low for the basic set. A CSP is the one that can break the app silently in production
— hence report-only first, and note the loopback `connect-src` requirement.

---

**ID:** SEC-002
**Title:** The dev server binds `0.0.0.0`, exposing it to every other user of this shared machine
**Severity:** P2
**Confidence:** High
**Location:** `server.ts:53`
**Evidence:** `app.listen(PORT, "0.0.0.0", ...)` — all interfaces, not loopback. This machine is a
shared Windows Server 2019 host. In development this Express instance has Vite middleware mounted
(`server.ts:39-44`), which serves module graph requests and transforms arbitrary project files.
**Why it matters:** On a single-developer laptop, binding `0.0.0.0` is a convenience for testing
from a phone. On a shared host it means anyone else with access to the box — or to the network
segment — can reach the dev server while it runs, including Vite's filesystem-backed module
endpoints. There is also an open low-severity advisory against `esbuild` about arbitrary file read
via a development server on Windows; I could **not** establish that Vite 6 exercises the affected
code path, so treat that as an unconfirmed aggravating factor rather than a second finding.
**Repro:** `npm run dev`, then from another host on the same network request
`http://<this-machine>:3000/`.
**Recommendation:** Default to `127.0.0.1` and make the wider bind opt-in via an env var —
`app.listen(PORT, process.env.HOST || "127.0.0.1", …)`. The production branch can keep `0.0.0.0`,
since a deployed server behind a proxy needs it; it is the *dev* branch where the default is wrong.
**Effort:** S
**Fix risk:** Low. Anyone currently testing from another device on the LAN would need to set `HOST`.

---

**ID:** SEC-003
**Title:** The contact form sends visitor PII to an undisclosed third party, contradicting the privacy page
**Severity:** P1
**Confidence:** High
**Location:** `src/components/ContactPage.tsx:279-290`; `src/components/LegalPage.tsx:74`, `:75`, `:117`
**Evidence:** This is INV-001 from Phase 0, restated here because it is a security/privacy finding
and belongs in this file. `LegalPage.tsx:75` states *"Signed out, nothing about you leaves your
browser except the request you send to Google with your own API key."* `ContactPage.tsx:279` POSTs
`name`, `email`, `subject` and `message` to `https://formsubmit.co/ajax/…`. A case-insensitive
grep of `LegalPage.tsx` for any disclosure returns only line 117, which points users *to* the
contact page without saying where its data goes. Additionally `index.html:71-77` discloses every
visitor's IP and User-Agent to Google Fonts on page load.
**Why it matters:** Full reasoning in `audit/00-inventory.md` under INV-001. The short version:
GDPR Art. 13 requires naming recipient categories, and a privacy statement the code falsifies is
worse than no statement.
**Repro:** Open `/privacy`, read paragraph two. Submit the contact form and watch the network tab.
**Recommendation:** See INV-001. Note the ordering constraint: if any error reporting is added
(ARC-003), that is a third undisclosed processor, so fix the privacy text **before** adding it.
**Effort:** S to disclose; M to remove the dependencies
**Fix risk:** None for the text; removing FormSubmit removes a working contact channel.

---

**ID:** SEC-004
**Title:** 12 dependency advisories including 1 critical — none reachable from the shipped bundle, and that needs recording before someone panics or ignores it
**Severity:** P3
**Confidence:** High
**Location:** `package.json`; `package-lock.json`
**Evidence:** `npm audit`: 1 critical, 3 high, 6 moderate, 2 low across 1,100 dependencies.
`npm audit --omit=dev` still reports 7, because `vite`, `@vitejs/plugin-react` and
`@tailwindcss/vite` are declared in **`dependencies`** rather than `devDependencies`
(`package.json:22-23`, `:33`) — see SEC-006.

Reachability was tested directly, by string-searching the built client bundle
(`dist/assets/index-CAXYdgVD.js`, 1.9 MB):

| Package | Severity | Via | In bundle? |
|---|---|---|---|
| `websocket-driver` | **critical** | `firebase` | **absent** |
| `postcss` | high | `vite` | **absent** |
| `nanoid` | high | `vite` | **absent** |
| `brace-expansion` | high | build tooling | **absent** |
| `protobufjs` | moderate | `@google/genai`, `firebase` | **absent** |
| `body-parser` | low | `express` | server-only |
| `esbuild` | low | build | build-only |

Also searched for `faye-websocket`, `Sec-WebSocket-Extensions` and `permessage-deflate` — all
absent. The critical advisory is against the Node transport in the Firebase SDK; the browser build
uses native WebSocket, and this app uses Firestore rather than Realtime Database.

`body-parser`'s advisory concerns an *invalid* limit value silently disabling size enforcement.
`server.ts:11-12` passes `'50mb'`, which is valid, so it does not apply — though see the note on
that limit in `audit/05c-reliability-data-ux.md`.
**Why it matters:** "1 critical vulnerability" on a dependency dashboard is exactly the kind of
finding that gets either panicked over or permanently ignored. The useful output is the reachability
column, and it says the shipped attack surface is unaffected. The build toolchain is still worth
patching, but it is a different urgency.
**Repro:** `npm audit`, then `npm audit --omit=dev`, then search `dist/assets/*.js` for the package
names.
**Recommendation:** Run `npm audit fix` (non-breaking; `fixAvailable=True` for six of seven).
`esbuild` needs a semver-major bump and can wait. Then fix SEC-006 so the `--omit=dev` number means
something. Re-run `npm test` and `npm run build` afterwards — the lockfile change needs approval per
ground rule 4.
**Effort:** S
**Fix risk:** Low, but it is a lockfile change with no CI to catch a regression. Run both suites and
a build before and after.

---

**ID:** SEC-005
**Title:** The rules accept a PBKDF2 iteration count 3× weaker than the client uses, and than the comment cites
**Severity:** P3
**Confidence:** High
**Location:** `firestore.rules:56`; `src/services/keyVault.ts:37-41`, `:160`
**Evidence:** `keyVault.ts:37-41`:
```ts
/** OWASP's 2023 floor for PBKDF2-HMAC-SHA256. Raising this later is safe: each
 *  record stores the count it used ... */
const PBKDF2_ITERATIONS = 310_000;
```
`firestore.rules:56`, with the comment *"Reject a weakened iteration count written by a tampered
client"*:
```
&& data.iterations is number && data.iterations >= 100000;
```
310,000 **is** the OWASP floor for PBKDF2-HMAC-SHA256, so the rule's threshold sits at roughly a
third of the value the code itself calls a floor. Decryption reads `record.iterations ||
PBKDF2_ITERATIONS` (`:160`), so a record written at 100,000 decrypts correctly and permanently.
**Why it matters:** Small and self-inflicted — the only person who can weaken a user's vault is
that user's own tampered client, protecting their own key, and 100,000 is not catastrophic. It is
recorded because the rule exists *specifically* to stop this and stops it at the wrong number, so
the guard reads as stronger than it is. The forward-compatibility design (each record stores its
own count) is correct and should be preserved.
**Repro:** Write a vault document with `iterations: 100000`; the rules accept it. This is already
covered in reverse by the rules test *"rejects a weakened iteration count from a tampered client"*,
which asserts a value below 100,000 fails.
**Recommendation:** Raise the rule to `>= 310000` and update the existing test. Because each record
carries its own count, old records keep decrypting — the change only constrains new writes. If any
vault documents already exist at a lower count, they will fail to *update*; given the deployment is
pre-launch, that is very unlikely to matter, but confirm before deploying rules.
**Effort:** S
**Fix risk:** Low. Verify no existing vault records sit below the new floor first.

---

**ID:** SEC-006
**Title:** Build tooling is declared in `dependencies`, inflating the production tree to 449 packages
**Severity:** P3
**Confidence:** High
**Location:** `package.json:22` (`@tailwindcss/vite`), `:23` (`@vitejs/plugin-react`), `:33` (`vite`)
**Evidence:** All three are build-time tools and all three sit in `dependencies`. Meanwhile
`tailwindcss`, `esbuild`, `typescript`, `tsx` and `vitest` are correctly in `devDependencies`. The
consequence is measurable: `npm audit --omit=dev` reports **449 production dependencies and 7
advisories**, when the genuine runtime dependency set for the *server* is `express` + `dotenv`, and
for the *client* is whatever Vite bundles.
**Why it matters:** Three practical costs. A production install (`npm ci --omit=dev`) pulls the
entire build toolchain. Any dependency-scanning tool pointed at this project reports build-tool
advisories as production exposure — which is precisely the confusion SEC-004 had to spend a
paragraph undoing. And the split currently gives no signal at all about what actually ships.
**Repro:** `npm audit --omit=dev` reports 7 advisories; `npm ls postcss --omit=dev` traces to
`vite@6.4.3`.
**Recommendation:** Move `vite`, `@vitejs/plugin-react` and `@tailwindcss/vite` to
`devDependencies`. Verify `npm run build` and `npm start` still work — they should, since both run
from the repo root with the full tree installed. This also makes the `engines` field from INV-005 a
more meaningful statement.
**Effort:** S
**Fix risk:** Low. It is a lockfile change; check any deployment that runs `npm ci --omit=dev`
before building — that would break, and correctly so, since it should build with dev deps present.

---

## Not assessed

- **Rate limiting and abuse.** No endpoint exists to rate-limit; Firebase Auth and Firestore apply
  their own quotas. FormSubmit's abuse controls are unknown to me and are a third party's problem
  that becomes yours if it is spammed with your address.
- **The `forma-repx://` protocol handler end to end.** The code and its guards were read and are
  sound; the registration and launch were not executed, because the companion must be started from
  the user's own desktop session.
- **Secrets in logs.** No log aggregation exists to inspect. `console.*` calls were reviewed and
  none prints key material; `geminiService.ts` passes the key in a header, never in a URL or a log
  line. Not proven under a real generation, since none could be run.
- **Any runtime security behaviour requiring a Gemini key or a live Firebase project.**
