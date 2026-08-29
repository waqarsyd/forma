# Phase 0 - Baseline

Date: 2026-08-28
Branch: `chore/cleanup` (created from `main` @ `4fd4bd9`)
Machine: Windows Server 2019, Node 24.18.1, npm 11.16.0, Temurin JRE 21.0.12+8

This is the scorecard. Every number here gets re-measured in Phase 9.

---

## 0.1 Config used

The config block supplied with the request had placeholders (`Stack: <yours>`, `...`),
so the following was reconstructed from `CLAUDE.md`, `package.json` and the repo itself.
**Correct anything wrong here before Phase 1 runs.**

| Field | Value (inferred) |
|---|---|
| Repo path | `<repo>` |
| Stack | React 19 + Vite 6 + Tailwind v4 + TypeScript (strict), Express 4 dev *and* prod server, Firebase Auth + Firestore, Gemini via `@google/genai`. Plus a C#/.NET WinForms companion under `tools/RepxDesigner` (DevExpress 20.1). |
| Package manager | npm (lockfileVersion 3) |
| Install / build / run | `npm ci` / `npm run build` / `npm run dev` (never bare `vite dev`), `npm start` for the built server |
| Test / lint / typecheck | `npm test`, `npm run test:rules` (needs Java), `npm run lint` (`tsc --noEmit`), `npm run lint:encoding` |
| Current pain | Not stated. Observed: `src/App.tsx` is 178 KB / ~4.6k lines and holds the whole app; the client entry chunk is 1.12 MB; 10 `audit/*` markdown reports at the root are undocumented in `CLAUDE.md`; two stray `.log` files sit in the working tree. |
| Critical flows | Not stated. Assumed: (1) upload image/PDF/`.repx` -> Gemini analysis -> markdown spec + mockup + `.repx` download; (2) sign in, save a report to Firestore, load it back, delete the account; (3) BYO Gemini key entry, vault encrypt/decrypt, model auto-detection; (4) the five marketing routes and the two legal pages; (5) **Open in designer** handoff to `RepxDesigner.exe --serve`. |
| Public API / published package? | No. `package.json` has `"name": "react-example"`, no `license`, no `files`, never published. Exported symbols have no external consumers. |
| Dynamic loading in use? | Yes, and it matters: `import()` code-splitting (pdf, Markdown chunks), route -> view mapping by string in `src/lib/routes.ts`, Tailwind v4 class scanning (CSS classes referenced only from `.tsx` strings), `wb-` workspace classes in `src/workspace.css`, `public/` assets referenced by URL string, Firestore rules referenced by path, and `.agents/skills/**/SKILL.md` read by name. |
| Generated code dirs | `dist/` (untracked), `tools/RepxDesigner/bin`+`obj` (untracked), `public/og-card.png` (pre-rendered by hand from `assets/source/og-card.html`, not a build step). |
| Vendored / third-party | `.agents/skills/` - Firebase's official skill packs, 79 tracked files, vendored verbatim. |
| Do NOT touch | `_not_required/` (already the repo's own quarantine), `.agents/skills/`, `vite.config.ts` HMR block, `.firebaserc`, `firebase-applet-config.json`, `.env.example`. No LICENSE/NOTICE file exists to protect. |
| Team size / branches open | Single developer, no remote. 33 local `audit/*` branches, **all already merged into `main`** - so file moves conflict with nothing. |

---

## 0.2 Repo size

```
$ git count-objects -vH
count: 250
size: 1.63 MiB
in-pack: 770
packs: 1
size-pack: 4.30 MiB
prune-packable: 0
garbage: 0
size-garbage: 0 bytes
```

| Measure | Value |
|---|---|
| Git objects (`size-pack` + loose) | **5.93 MiB** |
| `.git/` on disk | 6.09 MB |
| Working tree excl. `.git` + `node_modules` | **178.12 MB** in 424 files |
| ... also excl. `.antigravity/`, `dist/`, `tools/**/bin`+`obj` | **5.92 MB** |
| Tracked files | **216** totalling **5.69 MB** |
| Commits | 119, first on 2026-08-09 |

Top-level directories on disk:

| Dir | MB | Tracked? |
|---|---|---|
| `node_modules/` | 544.94 | no (gitignored) |
| `tools/` | 145.81 | only 3 files (`Program.cs`, `README.md`, `.csproj`); `bin`+`obj` = 145.77 MB, gitignored |
| `.antigravity/` | 22.14 | no (gitignored) - editor state, a single ~22 MB `.pbtxt` |
| `.git/` | 6.09 | - |
| `dist/` | 4.29 | no (gitignored) |
| `assets/` | 3.13 | yes - 3 files, 2.91 MB of it one PNG |
| `src/` | 0.96 | yes - 80 files |
| `.agents/` | 0.35 | yes - 79 files (vendored Firebase skills) |
| `docs/` | 0.24 | yes - 6 tracked (+2 untracked prompt packs) |
| `audit/` | 0.21 | yes - 10 files |
| `public/` | 0.19 | yes - 5 files |
| `tests/` | 0.02 | yes - 2 files |
| `_not_required/` | 0.01 | yes - 4 files |
| `scripts/` | 0.01 | yes - 3 files |
| root files | 0.75 | 17 tracked (+2 untracked logs, +`.env`) |

## 0.3 Top 30 largest tracked files

| KB | Path |
|---|---|
| 2914.1 | `assets/source/logo_white.png` |
| 526.8 | `package-lock.json` |
| 288.3 | `assets/source/logo.png` |
| 177.7 | `src/App.tsx` |
| 96.4 | `public/og-card.png` |
| 72.7 | `docs/notes/app-shell.md` |
| 70.6 | `src/services/geminiService.ts` |
| 63.9 | `src/workspace.css` |
| 53.6 | `src/components/DocsPage.tsx` |
| 51.6 | `src/components/FeaturesPage.tsx` |
| 45.4 | `public/logo_white.png` |
| 39.7 | `src/components/ContactPage.tsx` |
| 37.2 | `public/logo.png` |
| 36.9 | `src/components/LoginPage.tsx` |
| 36.8 | `docs/notes/gemini.md` |
| 35.6 | `src/index.css` |
| 35.2 | `CLAUDE.md` |
| 34.7 | `audit/00-inventory.md` |
| 34.4 | `src/components/LandingPage.tsx` |
| 29.1 | `audit/07-implementation.md` |
| 26.5 | `.agents/skills/firebase_firestore/references/enterprise/security_rules.md` |
| 26.5 | `.agents/skills/firebase_firestore/references/standard/security_rules.md` |
| 26.0 | `tools/RepxDesigner/Program.cs` |
| 25.4 | `audit/05c-reliability-data-ux.md` |
| 22.7 | `src/components/landing/HeroScanner.tsx` |
| 22.2 | `audit/02-architecture.md` |
| 21.0 | `docs/PRD.md` |
| 20.7 | `audit/03-test-audit.md` |
| 19.9 | `audit/06-roadmap.md` |
| 19.8 | `docs/notes/styling.md` |

Largest untracked-but-present items (they inflate the working tree, not the clone):
`node_modules/` 544.94 MB, `tools/RepxDesigner/bin` 145.64 MB, `.antigravity/` 22.14 MB, `dist/` 4.29 MB.

## 0.4 File count by extension (tracked)

| Count | Ext |
|---|---|
| 101 | `.md` |
| 60 | `.ts` |
| 24 | `.tsx` |
| 10 | `.json` |
| 5 | `.png` |
| 3 | `.mjs` |
| 2 | `.webp` |
| 2 | `.css` |
| 2 | `.html` |
| 1 each | `.example` `.cs` `.csproj` `.firebaserc` `.rules` `.gitignore` `.yml` |

By top-level dir: `src` 80, `.agents` 79, root 17, `audit` 10, `docs` 6, `public` 5,
`_not_required` 4, `scripts` 3, `tools` 3, `assets` 3, `tests` 2, `.vscode` 2,
`.claude` 1, `.github` 1.

Note: 101 of 216 tracked files are markdown, and 79 of those are the vendored
`.agents/skills/` packs.

## 0.5 LOC (tracked)

| Ext | Files | Lines |
|---|---|---|
| `.tsx` | 24 | 11,049 |
| `.ts` | 60 | 8,338 |
| `.css` | 2 | 2,391 |
| `.cs` | 1 | 562 |
| `.html` | 2 | 346 |
| `.mjs` | 3 | 173 |
| `.rules` | 1 | 115 |
| **Total code** | **93** | **22,974** |
| of which tests | 27 | 3,906 |
| **Non-test code** | **66** | **19,068** |
| Markdown | 101 | 12,331 |

## 0.6 Dependencies

| Measure | Value |
|---|---|
| Direct `dependencies` | **10** |
| Direct `devDependencies` | **16** |
| Lockfile package entries (transitive) | **1,112** |
| ... marked `dev` | 719 |
| ... prod-reachable | 393 |
| `node_modules/` top-level entries | 680 |
| `node_modules/` on disk, as found | 544.94 MB |
| `node_modules/` on disk, after a clean `npm ci` | **530.30 MB in 36,462 files** |
| `npm audit` at baseline | 6 vulnerabilities (1 low, 5 moderate) |

dependencies: `@google/genai` ^1.29.0, `dotenv` ^17.2.3, `express` ^4.21.2,
`firebase` ^12.12.1, `motion` ^12.23.24, `pdfjs-dist` ^5.5.207, `react` ^19.0.0,
`react-dom` ^19.0.0, `react-markdown` ^10.1.0, `remark-gfm` ^4.0.1

devDependencies: `@firebase/rules-unit-testing` ^5.0.1, `@tailwindcss/vite` ^4.1.14,
`@types/express` ^4.17.21, `@types/node` ^22.14.0, `@types/react` ^19.2.18,
`@types/react-dom` ^19.2.5, `@vitejs/plugin-react` ^5.0.4, `@vitest/coverage-v8` ^4.1.11,
`esbuild` ^0.27.4, `firebase-tools` ^15.26.0, `jsdom` ^30.0.1, `tailwindcss` ^4.1.14,
`tsx` ^4.21.0, `typescript` ~5.8.2, `vite` ^6.2.0, `vitest` ^4.1.10

## 0.7 Production build output

`npm run build` = `vite build && node scripts/build-server.mjs`

| Artifact | Raw | Gzip |
|---|---|---|
| `assets/pdf.worker-CliDBb4N.mjs` | 2,174.48 kB | - |
| `assets/index-B-oc0Jkh.js` | **1,122.87 kB** | 307.60 kB |
| `assets/pdf-Bs6rg4xv.js` | 447.51 kB | 132.54 kB |
| `assets/index-BEAO-BqI.js` | 278.43 kB | 55.76 kB |
| `assets/Markdown-DT_GAzzd.js` | 156.73 kB | 47.46 kB |
| `assets/index-DlZtsGj6.css` | 109.41 kB | 20.54 kB |
| `index.html` | 6.32 kB | 2.64 kB |
| `server.cjs` | 3.6 kB | - |
| images (`og-card.png`, 2x png, 2x webp) | 196.5 kB | - |
| **dist/ total** | **4.292 MB** in 15 files | |

Largest chunk: **`index-*.js` at 1,122.87 kB raw / 307.60 kB gzip.**
755 modules transformed.

## 0.8 Timings

Measured on this machine, warm cache unless noted.

| Operation | Time |
|---|---|
| `npm run lint` (`tsc --noEmit`) | 21.95 s |
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | 22.22 s |
| `npm run lint:encoding` | 0.71 s |
| `npm test` (unit, 25 files / 409 tests) warm | 5.57 s wall, 3.98 s reported |
| `npm test` **cold** (vitest cache wiped by `npm ci`) | 28.40 s wall, 24.74 s reported (environment 108.11 s summed) |
| `npm run test:rules` (emulator boot + 2 files / 41 tests) | 88.09 s wall, 11.76 s reported |
| `npm run build` cold (after `npm run clean`) | 17.42 s |
| `npm run build` incremental | 13.27 s |
| **`npm ci`** from a wiped `node_modules` | **654.37 s (10 m 54 s)** |

### 0.8b The install number

`npm ci` exited 0, which is itself a check nothing else in this repo performs: it fails
when `package.json` and `package-lock.json` disagree, and they do not.

It produced **530.30 MB in 36,462 files**. Note the pre-`npm ci` `node_modules/` measured
**544.94 MB** - so the installed tree had drifted **14.64 MB** above what the lockfile
actually specifies. That drift is a real (if small) finding for Phase 5, and it means the
530.30 MB figure, not 544.94 MB, is the honest install baseline.

`npm ci` also reported **6 vulnerabilities (1 low, 5 moderate)**. Detail deferred to
Phase 5.

Re-verified green **after** `npm ci` rewrote `node_modules`: `npm test` = 25 files /
409 tests passed, cold and warm.

Caveat carried from `CLAUDE.md`: a **cold** vitest cache is a different animal - the
first `npm test` of a session has been measured at 52 s, and before the 2026-08-28
environment split a cold jsdom load blew past vitest's 60 s worker start timeout and
failed the whole suite. The 5.57 s above is a warm number and must be compared
against a warm number in Phase 9.

Docker: **not applicable** - there is no Dockerfile, `.dockerignore`, or container
build in this repo.

## 0.9 Green-before-we-start check

All five gates pass on `main` @ `4fd4bd9`. **We are clear to clean.**

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run lint` | exit 0, no output |
| Dead-code sweep | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | exit 0, no output |
| Encoding | `npm run lint:encoding` | exit 0 - "Encoding clean: 104 files swept, no mojibake." |
| Unit tests | `npm test` | exit 0 - **Test Files 25 passed (25) / Tests 409 passed (409)** |
| Rules tests | `npm run test:rules` | exit 0 - **Test Files 2 passed (2) / Tests 41 passed (41)** |
| Build | `npm run build` | exit 0 |

The 409/25 and 41/2 counts match what `CLAUDE.md` records exactly, so that line is
not stale as of this baseline.

## 0.10 Pre-existing working-tree state (not mine, not touched)

`git status` at the start of this session already showed an in-flight, uncommitted
file move that predates the cleanup:

```
 D claude-code-full-audit-prompt-pack.md
?? docs/claude-code-cleanup-prompt-pack.md
?? docs/claude-code-full-audit-prompt-pack.md
```

That is a root-level prompt pack being moved into `docs/`. I have **not** staged,
committed, reverted, or touched it, and every commit I make will name explicit paths
so it does not get swept into a cleanup commit. Tell me if you want it committed or
reverted first.

## 0.11 Things noticed while measuring (Phase 2+ input, no action taken)

These are recorded now only so the baseline explains itself. Nothing has been moved.

1. `firestore-debug.log` (163.3 KB) and `debug.log` (0.7 KB) and `dev-server.log`
   (0.1 KB) sit in the working tree. All three are gitignored by `*.log`, so they are
   junk on disk, not in the clone.
2. `audit/` - 10 tracked markdown reports, 205 KB, produced by the 2026-08-27 audit.
   `CLAUDE.md` documents `docs/notes/` and `_not_required/` but never mentions
   `audit/`, so it is currently an undocumented top-level directory.
3. `assets/source/logo_white.png` is 2.91 MB - **51% of everything tracked in this
   repo** - and its shipped counterpart `public/logo_white.png` is 45.4 KB.
4. The repo already has its own quarantine convention: `_not_required/` exists, is
   **tracked** (deliberately, per `CLAUDE.md`), and holds 4 parked files. This
   collides with the prompt pack's Phase 1 default of gitignoring it. See the Phase 1
   question.
5. `.env` (0.7 KB) exists on disk and is gitignored; `.env.example` is tracked.
6. 33 local `audit/*` branches, all merged into `main`. Ground rule 7 forbids deleting
   branches, so they are reported, not touched.
