# Phase 7 - Restructure: proposal only

Date: 2026-08-29
Branch: `chore/cleanup`

**Nothing has been moved.** Phase 7's rule is explicit: present a proposal and wait.
This is that proposal.

**Branch conflict count: zero.** All 33 local `audit/*` branches are merged into `main`,
there is no remote, and no PR is open. This is the cheapest moment this repository will
ever have for moving files - which is an argument for doing the moves that are worth
doing, and not an argument for doing all of them.

---

## 7.1 The current tree

```
Dev_Forma/
├── src/
│   ├── App.tsx                 3,872 lines  ← the whole workspace
│   ├── main.tsx                   53
│   ├── index.css                 856
│   ├── workspace.css           1,535
│   ├── vite-env.d.ts               8
│   ├── components/             17 files at this level
│   │   ├── LandingPage.tsx  FeaturesPage.tsx  DocsPage.tsx
│   │   ├── ContactPage.tsx  LoginPage.tsx  LegalPage.tsx  NotFoundPage.tsx
│   │   ├── SiteHeader.tsx   SiteFooter.tsx  MobileNav.tsx
│   │   ├── Logo.tsx  LogoPulse.tsx  UserAvatar.tsx  Markdown.tsx
│   │   ├── AccountDialog.tsx
│   │   ├── useFocusTrap.ts             ← a hook
│   │   ├── legalDisclosure.test.ts     ← a test
│   │   └── landing/            7 files
│   ├── lib/                    25 modules + 21 colocated tests
│   └── services/               3 modules + 3 colocated tests
├── tests/                      2 files (Firestore rules, emulator)
├── scripts/                    3 files
├── docs/       PRD.md, design/DESIGN.md, notes/ ×4      175.5 KB
├── audit/      10 reports from the 2026-08-27 audit     219.2 KB
├── cleanup/    7 reports from this pass                  99.5 KB
├── public/  assets/source/  tools/RepxDesigner/  _not_required/  .agents/
└── 17 tracked files at the root
```

## 7.2 What is *not* wrong - read this before proposing anything

The prompt pack lists the usual structural failures. Most of them are absent here, and
saying so matters, because a restructure that "fixes" things that are already right is
pure churn against 175 KB of documentation that cites paths.

| Usual problem | Status here |
|---|---|
| Inconsistent naming (camel next to kebab next to snake) | **Absent.** 21 PascalCase files (all components), 59 camelCase (all modules), one kebab - `vite-env.d.ts`, which is Vite's own required name. Zero snake_case. This is a convention already being followed. |
| Components six levels deep | **Absent.** Maximum depth in `src/` is 4 (`src/components/landing/X.tsx`), and only 7 files reach it. |
| Tests scattered across three conventions | **Absent.** Two conventions, both deliberate and documented: `*.test.ts` colocated in `src/` for the unit suite, and `tests/` outside `src/` for the rules suite - which is *why* it is outside, so `vitest.config.ts`'s `include: ['src/**/*.test.ts']` cannot pick up emulator tests by accident. |
| Barrel files defeating tree-shaking | **Absent.** There is not one `index.ts` re-export anywhere. Phase 4 measured tree-shaking working correctly as a result. |
| A `src/` that isn't the real source root | **Present** - see 7.3.1. |
| A `utils/` or `helpers/` dump folder | **Present under another name** - see 7.3.2. |

## 7.3 What is actually wrong

### 7.3.1 `src/` is not the source root it claims to be

```
server.ts:5   import { securityHeadersFor } from "./src/lib/securityHeaders";
server.ts:6   import { resolveBindHost }    from "./src/lib/bindHost";
```

Two modules under `src/` - the client source tree, compiled by Vite into browser
JavaScript - exist **only** to be consumed by the Express server. No client file imports
either; verified by grep, the only other references are their own tests.

This is not cosmetic. `securityHeaders.ts` is the file that sets the app's CSP and
`bindHost.ts` decides whether the server listens on loopback or all interfaces - both
are security-boundary code, and both currently sit in the directory whose defining
property is *"everything in here ships to the browser."* Nothing structural stops a
component importing `resolveBindHost`, or stops someone adding a `window` reference to
`securityHeaders.ts` and only discovering it when the server crashes at boot.

### 7.3.2 `src/lib` is a 25-module flat bag spanning eight concerns

It is not called `utils/`, but it behaves like one. Sorted by what they actually do:

| Concern | Modules |
|---|---|
| Report domain | `reportGeometry` `reportTypes` `reportConfigStore` `repx` `savedReport` `analysisResponse` `sourceRect` |
| Gemini | `geminiErrors` `genai` `modelCatalog` `generationProgress` |
| File intake | `attachments` `attachmentParts` `pdf` |
| Routing | `router` `routes` |
| **Server** | `bindHost` `securityHeaders` |
| UI / layout | `panelSize` `motion` `announcements` |
| Account & data | `accountData` `contactSubmit` |
| Generic | `datetime` `designerBridge` |

Eight groups, one directory, alphabetical order. The cost is not aesthetic: `CLAUDE.md`'s
own routing table has to tell a session which of these 25 files owns a topic, because the
directory cannot.

### 7.3.3 `src/components` mixes four kinds of thing at one level

Seven **marketing pages** totalling 4,386 lines sit beside three pieces of **shared
chrome**, four **primitives** (`Logo`, `LogoPulse`, `UserAvatar`, `Markdown`), one
**workspace dialog**, one **hook** (`useFocusTrap.ts`, which I added in Phase 3), and one
**test** (`legalDisclosure.test.ts`). A `landing/` subfolder already exists and holds
figures used by those pages, which shows the split was started and not finished.

### 7.3.4 Three documentation directories, two of them undocumented

`docs/` (175.5 KB), `audit/` (219.2 KB) and `cleanup/` (99.5 KB) are all prose about this
project, at the top level, with no stated relationship. **`CLAUDE.md` describes `docs/`
in detail and never mentions `audit/` or `cleanup/` at all** - already flagged in Phase 2
as a documentation gap.

Checked, because it decides the cost: nothing anywhere links to an `audit/…` or
`cleanup/…` path, and every file in both directories is mojibake-clean, so moving them
under `docs/` - which `scripts/check-encoding.mjs` *does* sweep - would not break the
encoding gate. **This is the cheapest fix on the list.**

### 7.3.5 `App.tsx` is 3,872 lines

The real structural fact of this codebase, and **explicitly not a Phase 7 problem.**
Breaking it up is a refactor, not a `git mv`; it is already tracked as ARC-001; and it is
the reason several proposals below are deferred rather than recommended.

## 7.4 The organizing principle, and why it is not "group by feature"

The prompt pack's default is to group by feature/domain rather than by file type, and
says to justify the choice for *this* codebase rather than apply a template. Applying it
here would be wrong, for three specific reasons:

1. **There is essentially one feature.** Upload → analyse → render → export *is* the
   product. Feature folders would be `report/`, `marketing/`, `account/` - and the report
   feature is not spread across files waiting to be gathered, it is **inside `App.tsx`**.
   You cannot group by feature what has not yet been separated into modules.
2. **It would be done twice.** ARC-001 will move most of `App.tsx` into new modules. A
   feature-slicing now decides homes for files that do not exist yet, and ARC-001 would
   redo it.
3. **Documentation is this repository's most valuable asset and it cites paths.**
   `CLAUDE.md` plus four notes plus `README.md`'s tree map - the only copy of the layout
   anywhere - reference specific files constantly. Every move spends some of that.

**The principle I propose instead: separate by *runtime boundary* first, and by domain
only where a boundary already exists.** What actually breaks in this project is not
"related files are far apart" - it is that browser code, server code and Node tooling
share a directory whose name promises they are all one thing. That is the distinction
worth encoding now, and it is stable across ARC-001.

## 7.5 The proposal, in three tiers

### Tier 1 - recommended now (cheap, and each fixes something named above)

**1a. Give the two server modules their own directory inside `src/`.**

```
src/lib/securityHeaders.ts        →  src/server/securityHeaders.ts
src/lib/securityHeaders.test.ts   →  src/server/securityHeaders.test.ts
src/lib/bindHost.ts               →  src/server/bindHost.ts
src/lib/bindHost.test.ts          →  src/server/bindHost.test.ts
```

- **Blast radius: 3 import lines** - two in `server.ts`, and the two tests' own relative
  imports (which do not change, since each test moves with its module).
- **Deliberately inside `src/`, not a root-level `server/`.** A root directory would read
  better, but `vitest.config.ts` has `include: ['src/**/*.test.ts']`, so moving those two
  tests out of `src/` silently drops **15 tests** from `npm test` (409 → 394) unless the
  include is widened - and widening it is how the rules suite ends up running under the
  wrong config. Staying inside `src/` keeps the test count intact with no config change
  at all. This is the tradeoff, stated: a slightly less pure boundary in exchange for not
  touching the thing that decides which tests run.
- `CLAUDE.md`'s test-count bullet lists per-file counts and would need
  `src/server/securityHeaders.test.ts` and `src/server/bindHost.test.ts` in place of the
  `src/lib` paths. `README.md`'s tree map gains one line.

**1b. Consolidate the three documentation directories.**

```
audit/    →  docs/audit/
cleanup/  →  docs/cleanup/
```

- **Blast radius: zero import lines and zero links.** Verified: nothing references either
  path. Both are mojibake-clean, so joining `docs/` - which the encoding sweep covers -
  keeps that gate green.
- Top-level directories drop from 10 to 8. `CLAUDE.md` gains the two sentences it is
  currently missing about what `audit/` and `cleanup/` are.
- **Tradeoff:** `docs/` becomes the home of three quite different things - the living
  spec (`PRD.md`, `notes/`), a dated audit, and a dated cleanup. That is a real mixing,
  and the alternative is leaving two undocumented top-level directories. I think named
  subfolders under one roof beats three unexplained roots.

### Tier 2 - worth doing, more churn (your call)

**2a. Give `src/lib` internal structure.**

```
src/lib/report/     reportGeometry reportTypes reportConfigStore repx
                    savedReport analysisResponse sourceRect
src/lib/gemini/     geminiErrors genai modelCatalog generationProgress
src/lib/intake/     attachments attachmentParts pdf
src/lib/routing/    router routes
src/lib/ui/         panelSize motion announcements
src/lib/            accountData contactSubmit datetime designerBridge   (stay flat)
```

- **Blast radius: ~21 files move, plus their 21 colocated tests, and every importing
  file updates** - including `App.tsx`'s import block and `geminiService.ts`.
- **Real benefit:** `CLAUDE.md`'s routing table currently substitutes for directory
  structure. This is the one change that would let the tree carry some of that.
- **Real cost:** it collides with ARC-001, which will add report and Gemini modules and
  may want different boundaries once `App.tsx` is broken up. Doing this first means
  guessing those boundaries now.
- **My recommendation: defer until ARC-001 has started**, and use the module list above
  as the plan when it does.

### Tier 3 - not recommended now

| Proposal | Why not |
|---|---|
| Split `src/components` into `pages/`, `chrome/`, `primitives/` | The right end state, but four of the seven pages are ones Phase 3 identified as sharing extractable structure (`CtaSection`, `MarketingPageProps`, `PageShell`). Move them now and that extraction happens against paths that just changed. Do the extraction first, then the move, in one pass. |
| Move `vite.config.ts` / `vitest*.config.ts` into `config/` | Needs `--config` flags on every invocation and a `root` setting; `vite.config.ts` is loaded by the dev server and carries the "Do not modify" HMR block. This is the "hacks" case the prompt warns about. The root is 17 files and most are mandatory (`package.json`, `tsconfig.json`, `index.html` for Vite, `firebase.json` for the CLI). |
| Break up `App.tsx` | ARC-001. Not a move. |
| Move `useFocusTrap.ts` to a `hooks/` directory | One file does not make a directory. Revisit when there is a second hook. |

## 7.6 Conventions to adopt (documentation, not moves)

Currently these are *followed* but nowhere *written down*, which is why they are one
careless commit from being broken:

- **Directory naming:** lowercase, singular where it names a kind (`lib`, `server`), plural
  where it holds instances (`components`, `scripts`, `tests`).
- **File naming:** `PascalCase.tsx` for React components; `camelCase.ts` for everything
  else. Already 100% consistent; write it down.
- **Test placement:** colocated `*.test.ts` beside the module for anything the unit suite
  runs; `tests/` at the root for anything needing the emulator. **The separation is
  load-bearing, not stylistic** - it is what stops `npm test` starting a JVM.
- **Barrels: none.** No `index.ts` re-export files. This project has zero today and
  measurably benefits (Phase 4). Make it a rule so nobody "tidies" imports into one.
- **Import aliases:** `@/` already resolves to the repo root in `tsconfig.json`,
  `vite.config.ts` and `vitest.config.ts` - three declarations, nothing checking they
  agree (Phase 3 §3.4, proposal 5, deferred to here). **If Tier 1 is approved I would fold
  that fix in**, since a `config/` folder is off the table and a small
  `src/lib/alias` shared constant is not worth it - the honest fix is a comment in each of
  the three files naming the other two.
- **Where new code goes:** a new pure helper → `src/lib`; a new server helper →
  `src/server`; a new component → `src/components` (or `landing/` if it is a landing
  figure). A new top-level directory needs a stated reason.

## 7.7 If you approve, how it executes

Per ground rule 4, `git mv` only, one logical group per commit, no edits mixed in:

1. **Commit A** - `git mv` the four server files. No content changes.
2. **Commit B** - update the 2 import lines in `server.ts`. Content only, no moves.
3. **Commit C** - `git mv` `audit/` and `cleanup/` under `docs/`. No content changes.
4. **Commit D** - `CLAUDE.md` and `README.md` catch-up: the tree map, the test-count
   paths, and the missing description of `docs/audit` and `docs/cleanup`.
5. **Commit E** - the conventions in §7.6 written into `CLAUDE.md`.

Full gate suite after each of A-C, and the encoding sweep specifically after C, since it
changes which files are in scope. Expected: **409 unit tests and 41 rules tests
unchanged throughout** - if either count moves, the move is wrong and I restore before
reporting.

## 7.8 Summary

| Tier | Change | Files moved | Imports touched | Recommend |
|---|---|---|---|---|
| 1a | Server modules → `src/server/` | 4 | 2 | **Yes** |
| 1b | `audit/` + `cleanup/` → `docs/` | 17 | 0 | **Yes** |
| 2a | `src/lib` into domain folders | 21 (+21 tests) | many | Defer to ARC-001 |
| 3 | Components split, `config/`, `App.tsx` | - | - | No |

Tier 1 is 21 files moved, **2 import lines changed**, and it closes two of the four
structural problems named in 7.3. Tier 2 is the one with real value and real risk, and
its value is highest *after* `App.tsx` is broken up rather than before.
