# Phase 10 - Guardrails

Date: 2026-08-29
Branch: `chore/cleanup`

The automation that keeps this from happening again, plus the fix for the defect Phase 9
found. **Zero new dependencies** - a pass whose Phase 5 conclusion was "all 26
dependencies are justified" has no business adding a 27th to lint filenames.

---

## 10.1 The defect from §9.4, fixed and measured

`src/index.css` had a bare `@import "tailwindcss"`, so Tailwind v4's automatic content
detection scanned the whole project - **all 110 tracked markdown files included** - and
generated real utilities from class names quoted in prose.

```css
@import "tailwindcss" source(none);
@source "../index.html";
@source "./";
```

| | Before | After |
|---|---|---|
| `index-*.css` | 109,018 B | **107,822 B** |
| Selectors generated | 534 | 524 |

**−1,196 bytes, ten selectors, none gained.** All ten were verified in Phase 9 to have no
`className` use anywhere in `src/` or `index.html` before the change, and the app was
**re-rendered afterwards** with headless Edge - landing, features and workspace all
identical to their pre-change screenshots.

The rationale sits in a comment at the point of use, including the specific instruction
not to "fix" a future missing class by removing `source(none)`, which would restore the
leak.

## 10.2 What was added

### `scripts/check-quarantine.mjs` → `npm run lint:quarantine`

Checks **two** things, because the quarantine fails in two different ways:

1. No source file imports from `_not_required/`. This is the one that breaks a build.
2. Nothing inside `_not_required/` is tracked except `MANIFEST.md` and `README.md`. This
   is the subtler one: `git mv`-ing a file *into* the folder appears to work, but a
   tracked file stays tracked wherever it sits, so the bytes never leave the clone.
   Moving something in needs `git rm --cached` after the move.

Current output: `90 source files checked, none import from _not_required/`.

### `scripts/check-bundle-size.mjs` → `npm run check:size`

Per-artifact budgets plus a total. **This exists because of §10.1**: that defect got past
`tsc`, 409 unit tests, 41 rules tests and a successful build, because nothing was watching
the size.

```
artifact                           bytes        budget       used
index-BEAO-BqI.js                  278,425      1,160,000    24.0%
index-CJP1nzM4.js                  1,120,976    1,160,000    96.6%
index--C1hbo2r.css                 107,822      112,000      96.3%
pdf.worker-CliDBb4N.mjs            2,174,484    2,250,000    96.6%
pdf-Bs6rg4xv.js                    447,505      470,000      95.2%
Markdown-HOuMY8lb.js               156,726      175,000      89.6%
dist/ total                        4,499,361    4,600,000    97.8%
```

**The budgets are deliberately tight** - most artifacts sit at 95-97% of theirs. A budget
with 50% slack is a budget that never fires, and the failure it is meant to catch was
1.1% of one file. It also fails when a budget matches **no** artifact, because a budget
matching nothing is not passing, it is blind.

### `.githooks/pre-commit` (+ `pre-commit.mjs`)

Blocks files over 1 MB, backup and archive extensions, OS droppings, anything staged
inside `_not_required/`, and what looks like a real API key **assignment**.

That last one is narrow on purpose: matching `AIzaSy` alone would fire on three legitimate
places in this repository - the public Firebase config, the illustrative fake in
`VaultFigure.tsx`, and an input placeholder - so the prefix is not a signal on its own.

**Opt-in, once per clone:**

```bash
git config core.hooksPath .githooks
```

Not installed automatically, and not via a tool that would install it: the alternative is
a dependency plus a postinstall step. Bypass with `git commit --no-verify`.

**It is written in Node, and that is a finding rather than a preference.** The first
version was a shell script using `wc`, `tr` and `grep`. It could not run: git on this
machine is **MinGit**, which ships `usr/bin/sh.exe` but none of the MSYS userland, so all
three utilities are missing. A hook that cannot execute is worse than no hook, because it
looks installed. The logic moved to Node - which the project already requires at ≥20 and
already uses for three `scripts/` checks - behind a two-line `exec node` shim.

**Verified by making a commit that should fail:**

```
$ git add -f test-artifact.bak && git commit -m "this should be blocked"

pre-commit blocked this commit (1 problem(s)):
  BACKUP      test-artifact.bak
              a scratch copy. Delete it, or park it in _not_required/.

$ echo $?
1
```

Nothing was committed. The test file was then removed.

### CI

`.github/workflows/checks.yml` gains both new checks in the right places - `Quarantine`
before the slow steps because it is static and cheap, `Bundle size budget` after `Build`
because it measures `dist/`. Each carries a comment saying what it exists for.

**Note it still has never executed**: there is no remote. The workflow remains a statement
of intent, and the seven checks are run by hand.

### `CONTRIBUTING.md`

New, public-facing, and written for this project rather than pasted from a template: the
`npm ci`-not-`install` rule with the 14.64 MB drift that justifies it, the encoding trap
with the incident behind it, the dependency bar ("a 2026-08-28 audit of all 26 found
nothing to remove - adding the 27th should feel like a decision"), the quarantine rules
including the `git rm --cached` step, and a **quarterly hygiene checklist**.

Two entries in that checklist are warnings rather than instructions, and both are there
because following the obvious advice would do damage:

- **`npx knip`** - read it, do not act on it. With no config for this project's second
  Vitest project it reports both rules test files and `@firebase/rules-unit-testing` as
  unused. Removing them breaks 41 passing tests.
- **`npm audit fix --force`** - do not run it. npm's offered fix for the five remaining
  advisories is a **major-version downgrade** of `firebase-tools`, from 15.28.1 to
  14.23.0.

## 10.3 A gap this phase found in an existing guardrail

Writing `CONTRIBUTING.md` exposed a real weakness in `scripts/check-encoding.mjs`.

The new file contained the corrupted example string quoted from `CLAUDE.md`, so it scored
**1** on the mojibake pattern - and **the sweep still reported clean**, because the script
enumerates root-level files by name and a brand-new root file is on nobody's list.

**A new root file silently escapes the encoding gate.** That is exactly the drift this
pass exists to prevent, sitting inside the check meant to prevent it.

Fixed both ways: the literal byte sequences were removed from `CONTRIBUTING.md` (describing
the corruption is enough; `CLAUDE.md` remains the single permanent exception that quotes
it), and `CONTRIBUTING.md` was added to `ROOT_FILES` with a comment recording the incident
so the next person to add a root file knows to do the same. The sweep now covers **128
files**, up from 104 at Phase 0.

## 10.4 Considered and rejected

| Proposed | Why not |
|---|---|
| `knip` as a warn-only CI job | It produces known-wrong output on this repository without a config (§10.2). A CI job that cries wolf every run trains people to ignore CI. It is in the quarterly checklist with the caveat attached instead. |
| `depcheck` / `unimported` | Phase 4 and Phase 5 already answered their questions - zero orphan files, zero unused dependencies - using two purpose-written scripts whose output was verified by hand. Adding a dependency to re-answer a settled question is the clutter this pass removed. |
| ESLint with `no-unused-vars: error` | `tsc --noEmit --noUnusedLocals --noUnusedParameters` already does this and is already in CI. Adding ESLint means a config, a plugin set, and a seventh devDependency for an overlap. |
| `.dockerignore`, `.npmignore` | No Dockerfile, and not a published package. Ignore files for pipelines that do not exist are clutter. |
| A CI job pinning coverage | The number is deliberately scoped to `src/lib`, `src/services` and `src/server`; `App.tsx` is excluded because counting untestable code moves the figure for reasons unrelated to safety. A threshold would invite widening the include list to game it. |

## 10.5 Verification

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | exit 0 |
| `npm run lint:encoding` | exit 0 - **128 files** |
| `npm run lint:quarantine` | exit 0 - 90 source files checked |
| `npm test` | exit 0 - **25 files / 409 tests** |
| `npm run test:rules` | exit 0 - **2 files / 41 tests** |
| `npm run build` | exit 0 |
| `npm run check:size` | exit 0 - all artifacts within budget |
| pre-commit hook | verified by a commit that correctly failed |
| visual | landing, features and workspace re-rendered after the CSS change, unchanged |

`CLAUDE.md` still scores exactly 8 on the mojibake pattern - its documented self-exception.
