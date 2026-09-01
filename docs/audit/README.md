# Audit findings register — 2026-08-27

**This is an index, not the audit.** Ten narrative reports lived here until 2026-08-29;
they were removed and are recoverable from git history:

```
git show a4ac759:docs/audit/06-roadmap.md          # the roadmap and severity table
git show a4ac759:docs/audit/07-implementation.md   # what was actually built, and what it cost
git show a4ac759:docs/audit/00-inventory.md        # 01-runbook, 02-architecture, 03-test-audit,
                                                   # 04-bugs, 05a-security, 05b-performance,
                                                   # 05c-reliability-data-ux
```

This file exists because the reports could be deleted but their **identifiers could not**.
The findings below are cited **67 times across 42 source and config files** (2026-09-01) — in
`index.html`, `src/index.css`, `.env.example`, `.github/workflows/checks.yml`, half a
dozen tests — and **33 local branches are named after them** (`audit/SEC-001-security-headers`
and the rest). Without this table, a reader hitting `// (audit ARC-001)` in
`src/lib/attachmentParts.ts` has no way to learn what that was.

That count moves whenever a comment is added or a file is renamed, so do not trust it
without re-running it, and do not bother correcting it for a drift of one or two — the
argument it supports is "many, in places this file cannot reach", not a precise total.
It said **68 across 43** until 2026-09-01, which was never right: at the commit that
introduced the sentence the true figure was 66 across 41. To recount, match
`\b(ARC|SEC|REL|DATA|BUG|PERF|TEST|INV|RUN|UX|NEW)-\d{3}\b` over tracked non-markdown
files, and **exclude four-digit matches** or `INV-2043` in `HeroScanner.tsx` inflates
both numbers (see the note at the foot of this file).

Status is as of the audit's own implementation pass; several were closed or partly closed
by the 2026-08-28 cleanup, which is recorded in `git log 2ce6e56..9a8163c`.

---

## Architecture

| ID | Finding |
|---|---|
| **ARC-001** | `App.tsx` is the whole application. Blocks component testing and made `ingestFile` unimportable without dragging in pdf.js and Firebase. P1, **started not closed** — still the app. |
| **ARC-002** | The generation progress state machine was implicit and untestable; extracted, and a mutation test found a real defect in it. |
| **ARC-004** | No `strict` in `tsconfig.json`, so a clean `tsc` proved very little. Closed — **the debt turned out to be seven errors**, five of them in tests written the same week. |
| **ARC-005** | Documentation drift; part of the one-pass drift cluster with INV-006/009 and RUN-001. |

## Security

| ID | Finding |
|---|---|
| **SEC-001** | **Zero HTTP security headers**, and `X-Powered-By: Express` advertised. Closed — see `src/server/securityHeaders.ts`. |
| **SEC-002** | The dev server bound `0.0.0.0`. Closed — see `src/server/bindHost.ts`. |
| **SEC-003** | The privacy statement was **contradicted by the code**: third-party processors were unnamed. Closed; `src/components/legalDisclosure.test.ts` now pins it. |
| **SEC-005** | The vault's PBKDF2 iteration floor was not enforced in `firestore.rules` (`iterations ≥ 100000`). |

## Reliability

| ID | Finding |
|---|---|
| **REL-001** | The contact-form call to FormSubmit had **no timeout**. Closed — `src/lib/contactSubmit.ts`. |
| **REL-002** | `designerBridge.sendToDesigner` had **no timeout**. Closed. |
| **REL-003** | The Gemini catalogue and probe calls had no per-probe timeout. Part of the P3 correctness cluster. |

## Data

| ID | Finding |
|---|---|
| **DATA-001** | Account deletion was never verified to remove **both** the reports and the encrypted key. Closed — `tests/accountDeletion.test.ts`. |
| **DATA-002** | The `localStorage` and Firestore report shapes diverge with no shared validator. Open. |

## Correctness (P3 cluster)

| ID | Finding |
|---|---|
| **BUG-001** | `unit` / `pageSize` were not validated at the persistence boundary; `Document` and `Tabloid` unsupported. |
| **BUG-002** | `boxToSourceRect` clamping. |
| **BUG-003** | Windows **reserved device names** and path-length arithmetic in the designer filename path. Both halves fixed; the browser half is pinned by `designerBridge.test.ts`. |
| **BUG-004** | Filename length cap. |
| **BUG-005** | `rankDiscovered` coercion. Recorded for hardening only — **explicitly not a live defect**. |

## Performance

| ID | Finding |
|---|---|
| **PERF-001** | One **1.99 MB** eager chunk, no code splitting. **Partially closed: 540 → 306 kB gzipped eager, a 43% cut** — pdf.js, the Gemini SDK and react-markdown became lazy chunks. **Firebase remains eager** and dominates what is left. |
| **PERF-002** | Render-blocking third-party stylesheets. The Material Symbols icon font was removed (five glyphs, three of which already existed as inline SVG). Closed 2026-08-30 (`506da99`): the three text faces are self-hosted as variable woff2 under `src/fonts/`, with their OFL texts. This row read "self-hosting the three text faces is still open" until 2026-09-01 — which `src/fonts/README.md`, citing PERF-002 as the reason it was done, had been contradicting for two days. |

## Tests and infrastructure

| ID | Finding |
|---|---|
| **TEST-001** | No crypto round-trip test for the key vault — "highest value per line" in the gap list. Closed — `src/services/keyVault.test.ts`. |
| **TEST-002** | `geminiService` response parsing untested; wanted captured fixtures. Closed. |
| **TEST-003** | `designerBridge` — 5 of 6 exports untested. **Partially closed**; `launchDesigner` and `waitForDesigner` remain untested. |
| **TEST-004** | Report-shape round-trip untested. |
| **INV-001** | **FormSubmit** (`formsubmit.co`) relays the visitor's name, email, topic and message to a third party — undisclosed at the time. Paired with SEC-003. |
| **INV-003** | **No CI.** Every documented invariant depended on a human remembering to run it. Closed — `.github/workflows/checks.yml`. |
| **INV-004** | No coverage tooling; roughly **8.8%** of `src/` genuinely exercised. Closed — `npm run test:coverage`. |
| **INV-006** | `APP_URL` was documented in `.env.example` and **read by nothing**. Closed — removed 2026-08-27; `.env.example` keeps a comment where it stood saying why. A copy may still sit in your own untracked `.env`, where it is inert. |
| **INV-009** | Documentation drift; part of the cluster with INV-006/010/011, RUN-001 and ARC-005. |
| **RUN-001** | Runbook drift — including the `%VITE_*%` placeholder note that `index.html` still explains. |
| **UX-002** | **No 404 page**; an unknown path fell through silently. Closed — `src/components/NotFoundPage.tsx`. |

---

## Notes for whoever reads this next

- **`INV-2043` is not an audit ID.** It is an invoice number in the hero scanner's demo
  data (`src/components/landing/HeroScanner.tsx`). A regex over `\b[A-Z]+-\d{3}\b` will
  match inside it; ignore it.
- **A handful of IDs appear in the reports but are not cited anywhere in the code**
  (ARC-003 "no observability", INV-005 "no `engines` field", PERF-003, UX-001, UX-003,
  NEW-001…004). They are deliberately not listed above — this index covers the 31
  identifiers the codebase actually references. The full set is in
  `git show a4ac759:docs/audit/06-roadmap.md`.
- **Do not renumber or reuse these IDs.** They are load-bearing in 68 comments and 33
  branch names, none of which can be updated by editing this file.
