# Phase 4 — Actively Testing the Application

> **Status: superseded in part.** This file records the repository as found on 2026-08-27, *before*
> any fix. Seven roadmap items have since landed and 11 findings are closed — see
> [`07-implementation.md`](07-implementation.md) for current counts and finding status. This file is
> deliberately left unedited as the baseline.

## Method, and its limits

Without a Gemini key the generation flow cannot be driven, so this phase could not do what it is
designed to do: attack a running application. What it did instead was attack the **pure helpers**,
which are where this codebase deliberately put the logic that fails silently.

A throwaway probe harness was written to the scratchpad (not the repo), imported the modules by
absolute path with a jsdom environment, and ran ~200 hostile inputs across twelve modules —
boundaries, nulls, wrong types, unicode, path-traversal strings, prototype-pollution payloads,
date edges, XXE and entity-expansion payloads, and every documented enum value plus its
near-misses. **Every finding below was then confirmed a second time by an independent probe** that
computed the concrete error magnitude, per the pack's verify-twice rule.

**Two candidate bugs were rejected on that second pass** and are recorded here so nobody re-finds
them:

- **Trailing-slash routing.** `titleForRoute('/workspace/')` returns the *home* title, which looks
  like a deep-link bug. It is not: `router.ts:37-40` normalises the trailing slash in
  `currentPath()` before `viewForRoute` ever sees it, and the comment says so. Not a bug.
- **`rankDiscovered` throwing on non-string input.** Real (`TypeError: a.localeCompare is not a
  function`) but unreachable: its only in-app caller is `mergeCandidates`, fed exclusively by
  `usableFromCatalog`, which drops any entry whose `name` is not a string (`modelCatalog.ts:77`).
  Recorded as BUG-005 at P3 for hardening only, explicitly *not* as a live defect.

**What was not tested at all:** concurrency and double-submit, failure injection against Firestore
or Google, the authorization matrix beyond what the 29 rules tests already assert, idempotency,
and every model-response path including the known truncation bug. Those need a credential, a live
project, or both.

---

## Findings

---

**ID:** BUG-001
**Title:** A persisted `unit` or `pageSize` outside the supported set is accepted without validation and silently converted wrong — up to a 3× scale error
**Severity:** P2
**Confidence:** High
**Location:** `src/lib/reportConfigStore.ts:66-78`; `src/lib/reportGeometry.ts:38-47`, `:88-107`
**Evidence:**
`mergeStoredConfig` restores `unit` and `pageSize` from `localStorage` and validates **type only**:

```ts
if (typeof value === 'string') (merged as Record<string, unknown>)[field] = value;   // :77
```

There is no check against the supported set. `reportGeometry.ts` then falls back silently:

```ts
const UNITS_PER_INCH: Record<string, number> = {          // :38-42
  HundredthsOfAnInch: 100, TenthsOfAMillimeter: 254, Pixels: 96,
};
return (reportUnit && UNITS_PER_INCH[reportUnit]) || UNITS_PER_INCH.HundredthsOfAnInch;   // :46
```

Confirmed by probe, run twice:

| `localStorage` value | Accepted as | `unitsPerInch` | Correct | Effect |
|---|---|---|---|---|
| `{"unit":"Document"}` | `Document` | **100** | **300** | **3× scale error.** A 1-inch box is written as 100 units, not 300. A 16-unit font becomes 11.52pt instead of 3.84pt. |
| `{"unit":"Pixel"}` | `Pixel` | **100** | 96 | 4% error. The DevExpress enum member is `Pixels`; the singular silently falls back. |
| `{"unit":"tenthsofamillimeter"}` | as written | **100** | 254 | **2.54× error** from a case difference alone. |
| `{"pageSize":"a4"}` | `a4` | — | — | Page silently becomes Letter (850×1100) instead of A4 (827×1169). |
| `{"pageSize":"Tabloid"}` | `Tabloid` | — | — | Returns `{850, 1100}` — **byte-identical to Letter**, so the fallback is invisible even to someone checking the output. |

**Why it matters:** `reportGeometry.ts`'s own header states the case against this precisely:
*"every one of them fails silently — a wrong factor produces a plausible layout in the wrong place,
never an error."* This is that failure, arriving through the one door the module does not guard:
its callers. `Document` is a genuine `DevExpress.XtraReports.UI.ReportUnit` member that the
dropdown does not offer, so this is not a hypothetical string — it is the fourth value of an enum
the app already speaks, and it produces a report that is one third of the intended size with every
font three times too large, while both the layout JSON and the REPX remain internally consistent.

**Reachability, stated honestly:** not reachable through the UI today. The three dropdowns
(`App.tsx:3917-3919`, `:3940-3942`) offer exactly the supported values. It becomes reachable via
(a) a hand-edited `localStorage` entry, (b) a stale entry written by a build whose dropdown offered
different values, or (c) — the one that will actually happen — **someone adding `Document` or
`Tabloid` to a dropdown without adding it to `reportGeometry.ts`.** That last case is a one-line
change with no failing test and no visible error.

**Repro:**
```js
// devtools, on any Forma page, then reload and generate
localStorage.setItem('reportConfig', '{"unit":"Document","pageSize":"Tabloid"}')
```
The config dialog shows an empty unit selector; generation proceeds; the REPX is emitted with
`ReportUnit="Document"` and coordinates computed at 100 units/inch.

**Recommendation:** Validate the domain where the value enters, not where it is used. Export the
supported sets from `reportGeometry.ts` (they already exist as `UNITS_PER_INCH` and `PAGE_INCHES`
keys) and have `mergeStoredConfig` drop a value that is not in them, falling back to the default —
the same discipline `PERSISTED_FIELDS` already applies to field *names*, extended to field
*values*. Then make `unitsPerInch` and `pageSizeInUnits` the second line of defence rather than the
only one: keep the fallback, but `console.warn` on an unrecognised value so it is not literally
silent. Add `Document` (300) and `Tabloid` (11×17) to the tables while you are there — they are two
lines each and their absence is the actual root cause.
**Effort:** S
**Fix risk:** Low. A user with a stale unsupported value in `localStorage` would be silently moved
to the default, which is a behaviour change but the correct one. `reportGeometry.test.ts` already
has 16 cases to extend.

---

**ID:** BUG-002
**Title:** Windows reserved device names survive both filename sanitisers and reach `File.WriteAllText`
**Severity:** P3
**Confidence:** High
**Location:** `src/lib/designerBridge.ts:34-37`; `tools/RepxDesigner/Program.cs:487-504`
**Evidence:** Both sanitisers strip characters and path separators, and neither knows about DOS
device names. Browser side:

```ts
const base = (title || 'report-design').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-.]/g, '');
return `${base || 'report-design'}.repx`;                         // designerBridge.ts:35-36
```

Companion side, which the comment at `:484-486` correctly calls the real defence:

```csharp
string candidate = Path.GetFileName(suggestedName);
candidate = Regex.Replace(candidate, @"[^A-Za-z0-9_\-. ]", "");
candidate = candidate.Replace(".repx", "").Trim();
...
string path = Path.Combine(folder, safe + ".repx");
File.WriteAllText(path, xml, new UTF8Encoding(false));            // Program.cs:492-502
```

Probe output — every one passes through unchanged:
```
designerFileName("CON")  -> CON.repx      designerFileName("AUX")  -> AUX.repx
designerFileName("NUL")  -> NUL.repx      designerFileName("COM1") -> COM1.repx
designerFileName("PRN")  -> PRN.repx      designerFileName("LPT1") -> LPT1.repx
```
Windows resolves `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9` and `LPT1`–`LPT9` as devices **in every
directory**, with or without an extension, so `%TEMP%\Forma\CON.repx` addresses the console device
rather than a file.

**Why it matters:** A user who titles a report `CON` and clicks **Open in designer** gets a write
to a device instead of a file — an exception, or a silent write that goes nowhere and is then
opened as a missing file. Obscure, self-inflicted, and not a security issue: the path-traversal
defence the comment is actually about (`Path.GetFileName`) works correctly, and this reaches no
directory the process could not already write. It is recorded because it is the exact class of
input the surrounding comment claims to have handled, and because the fix is three lines.
**Repro:** Title a report `CON`, click **Open in designer** with the companion running.
(Not executed — the companion must be started from the user's own desktop session. The string
transformation through both sanitisers was verified directly; the `File.WriteAllText` behaviour is
documented Win32 semantics, not observed here.)
**Recommendation:** In `WriteTempCopy`, after the regex, test the candidate's stem
case-insensitively against the reserved list and prefix an underscore if it matches. Do it in the
companion, not the browser — `designerBridge.ts:31-32` is explicit that its own sanitising is a
courtesy and the companion re-sanitises because a value from the browser is a value an attacker
could send too. That reasoning is right, and it is why the fix belongs on the trusting side.
**Effort:** S
**Fix risk:** None.

---

**ID:** BUG-003
**Title:** No length cap on the designer filename, so a report name the rules explicitly permit produces a path over `MAX_PATH`
**Severity:** P3
**Confidence:** Medium — the arithmetic is confirmed; the resulting user-visible failure was not observed
**Location:** `src/lib/designerBridge.ts:34-37`; `tools/RepxDesigner/Program.cs:498-502`; `firestore.rules:29`
**Evidence:** `firestore.rules:29` permits `data.name.size() <= 256`, so a 256-character report
title is valid and storable. Neither sanitiser truncates. Probe:
```
designerFileName(256 chars) -> length 261
companion writes to %TEMP%\Forma\<name>; typical temp path ~40 chars => total ~301 vs MAX_PATH 260
```
`Path.Combine(Path.GetTempPath(), "Forma")` on this machine is 45 characters, so a 256-character
title yields a ~306-character path. Unless the process has long-path support enabled, `File.WriteAllText`
raises `PathTooLongException`.
**Why it matters:** A valid, saveable report name breaks a feature. The failure is loud (an
exception) rather than silent, which is why this is P3 and not higher — but it happens inside the
companion's HTTP handler, and I did not trace whether that surfaces as a useful message in the
browser or as a generic "could not open in designer". Confidence is Medium on that last step
specifically.
**Repro:** Not executed (companion not running). Title a report with 256 characters and click
**Open in designer**.
**Recommendation:** Truncate in both places — `designerFileName` should cap the stem at ~60
characters, and `WriteTempCopy` should cap independently for the same reason BUG-002's fix belongs
there. Sixty is well clear of any realistic path and still readable in the designer's title bar.
**Effort:** S
**Fix risk:** None. Two reports whose titles share a 60-character prefix would collide on the temp
filename; they already collide on identical titles, so this is not a new class of problem.

---

**ID:** BUG-004
**Title:** `boxToSourceRect` validates the shape of a model-supplied detection box but not its domain
**Severity:** P3
**Confidence:** High
**Location:** `src/lib/sourceRect.ts:20-32`
**Evidence:** The contract is documented at `:13-14` — *"`[ymin, xmin, ymax, xmax]` normalised to
0-1000"*. The implementation checks `length === 4`, that every entry is a finite number, and that
the resulting width and height are positive. It does not check that the values are within 0–1000,
and does not clamp the output to the unit square. Probe:

| Input | Output | Comment |
|---|---|---|
| `[0.1, 0.1, 0.5, 0.5]` | `{x: 0.0001, y: 0.0001, w: 0.0004, h: 0.0004}` | Fractional input accepted; yields a rect 1/10,000th the intended size |
| `[-1, -1, 2, 2]` | `{x: -0.001, y: -0.001, w: 0.003, h: 0.003}` | **Negative origin** — a crop starting outside the image |
| `[0, 0, 5000, 5000]` | `{x: 0, y: 0, w: 5, h: 5}` | 500% of the source image |
| `[2, 2, 1, 1]` | `null` | Correctly rejected (inverted) |
| `['a','b','c','d']` | `null` | Correctly rejected |

**Why it matters:** This is model output, and the module's own header explains why that matters:
*"read the wrong way round it produces a crop in a believable but wrong position rather than an
obvious error."* A hallucinated coordinate outside 0–1000 produces exactly that — a crop rectangle
partly or wholly outside the image, rendered without complaint. The existing guard catches the
*malformed* cases and lets the *implausible* ones through, which is the wrong way round for a
silent-failure class.
**Repro:** `boxToSourceRect([-1, -1, 2, 2])` returns a rect with a negative origin. Confirmed twice.
**Recommendation:** Clamp to the documented domain rather than rejecting — a slightly
out-of-range box from the model is more likely to be a near-miss worth salvaging than garbage worth
dropping. Clamp each coordinate to `[0, 1000]` before dividing, re-check that width and height are
still positive afterwards, and add the three cases above to `sourceRect.test.ts` (which has 9 and
is the right home for them).
**Effort:** S
**Fix risk:** None — strictly narrows output to the documented range.

---

**ID:** BUG-005
**Title:** `rankDiscovered` throws on non-string input; unreachable today, but it is an exported function with an unguarded contract
**Severity:** P3
**Confidence:** High — including High confidence that it is **not** currently reachable
**Location:** `src/lib/modelCatalog.ts:121-129`, specifically `:127`
**Evidence:** `rankDiscovered([null, '', 123])` throws
`TypeError: a.localeCompare is not a function` from the `a.localeCompare(b)` tiebreaker at `:127`.
Traced the call graph: the only in-app caller is `mergeCandidates` (`:152`), whose `discovered`
argument comes from `discoverModels` (`geminiService.ts:450`), which returns
`usableFromCatalog(body?.models)` — and that drops any entry whose `name` is not a string
(`modelCatalog.ts:77`). So the real path cannot deliver a non-string. `mergeCandidates` at
`geminiService.ts:451` is nonetheless **outside** any `try`/`catch` in `resolveModel`, so if the
guarantee ever broke the throw would propagate into model resolution and fail the first generation
of the session.
**Why it matters:** Not a live bug and should not be reported as one. It is recorded because the
module's header states the design intent — *"Everything here is pure so the filtering and ordering
can be tested without a key"* — and a pure exported function that throws on input its own signature
permits (`ReadonlyArray<string>` is not enforced at runtime) has a wider contract than its one
caller. The safety here rests on a filter two modules away, which is exactly the sort of invariant
that survives until someone adds a second caller.
**Repro:** `rankDiscovered([null as any])`.
**Recommendation:** Either coerce in `rankDiscovered` (`String(a).localeCompare(String(b))`) or
filter at its entry. One line, plus a case in `modelCatalog.test.ts` pinning that malformed input
degrades rather than throws.
**Effort:** S
**Fix risk:** None.

---

## What held up under attack

Worth recording, because these are the places a probe expected to find something and did not:

- **XXE and entity expansion.** `checkRepx` was given a `SYSTEM "file:///c:/windows/win.ini"`
  entity payload and a small billion-laughs payload. Both were rejected as unparseable or as an
  unexpected root element. No external entity resolution, no expansion blow-up.
- **Prototype pollution.** `mergeStoredConfig` was given `{"__proto__":{"polluted":true}}` and
  `{"constructor":{"prototype":{"x":1}}}`. Neither polluted `Object.prototype` — the allowlist loop
  at `:66` only ever reads five known field names, so the payload keys are never touched.
- **Key leakage through persistence.** `toPersistable` was given a config containing
  `customApiKey` and returned only the allowlisted fields. The allowlist-not-blocklist decision at
  `reportConfigStore.ts:14-15` does what its comment claims.
- **Malformed JSON in `localStorage`.** Nine malformed payloads (`{`, `[]`, `"str"`, `123`, `true`,
  `undefined`, …) all returned the defaults without throwing. The workspace cannot be bricked by a
  corrupted config entry.
- **Unit round-trips.** points → units → points was exact to floating-point across all four unit
  settings at 1, 10, 72, 100 and 0.1 points. The conversions are consistent with themselves; BUG-001
  is about the *input* to them, not the arithmetic.
- **Path traversal in filenames.** `../../etc/passwd` → `....etcpasswd.repx` on the browser side and
  `Path.GetFileName` on the companion side. Two independent defences, both correct.
- **Route fallback.** Every malformed path (`//`, `/%2e%2e`, `javascript:alert(1)`, a 300-character
  path) falls back to the home view. `routesWithoutABranch()` returns `[]`, as its test asserts.

---

## Not assessed in this phase

Stated explicitly so the roadmap does not treat silence as a pass:

| Area | Why not |
|---|---|
| Generation, streaming, truncation | No Gemini key. This is where the one *known* open bug lives. |
| Concurrency, double-submit, idempotency | Needs the generation and save flows running. |
| Failure injection (Firestore down, Google 500/timeout/malformed) | Same. The emulator could cover the Firestore half. |
| Authorization matrix / IDOR | Largely covered already by the 29 rules tests, which assert cross-account read, write, delete and unauthenticated access. No HTTP endpoints exist to enumerate. |
| File intake edge cases | `ingestFile` is inside `App.tsx` and cannot be imported without pulling in pdf.js and Firebase. This is ARC-001 blocking Phase 4 directly, and it is the clearest single argument for the extraction. |
| Designer round-trip | Companion must run on the user's own desktop. |
