# Phase 1 - Quarantine set up

Date: 2026-08-28
Branch: `chore/cleanup`
Commits: `734884e` (scaffolding + exclusions), `ccad0a2` (untrack the four),
`45c1e19` (docs catch-up)

**Nothing was quarantined in this phase.** Phase 1 builds the place things go and
proves the exclusions work. The SAFE/UNSURE/KEEP counts are 0/0/0.

---

## 1.1 The decision you made, and what it cost

You chose **"Switch to ignored"**: `_not_required/` contents are gitignored, with
`MANIFEST.md` and `README.md` exempt. That is the prompt pack's default, and it is the
opposite of this repo's prior convention.

What it bought: quarantined bytes leave the clone, while the record of them stays in
git forever.

What it cost, stated plainly because it is a real loss: **the four already-parked files
are no longer reachable by a grep of the working tree.** `CLAUDE.md` had that property
written down as a feature ("it is tracked, so a grep reaches all of them"). Three
documents now say the opposite instead, and both `CLAUDE.md` and
`_not_required/README.md` point at the search that still works:

```
git log --diff-filter=D --name-only
```

## 1.2 Structure created

```
_not_required/
  MANIFEST.md            tracked - the permanent record, 4 rows
  README.md              tracked - the convention, the exclusion table, the 90-day expiry
  build-artifacts/       (empty)
  dead-code/             (empty)
  unused-assets/         (empty)
  duplicates/            (empty)
  old-configs/           (empty)
  experiments/           (empty)
  docs-archive/          (empty)
  vendor-dumps/          (empty)
  unsure/                (empty - requires your explicit approval to use)
```

The nine category folders exist on disk only; git does not track empty directories and
their contents will be ignored anyway. They will materialise in a clone the moment
`MANIFEST.md` describes something in them.

## 1.3 The `.gitignore` pattern, and why it is `/*` and not `/`

```gitignore
_not_required/*
!_not_required/MANIFEST.md
!_not_required/README.md
```

`_not_required/` would have been wrong. Git cannot re-include a file whose **parent
directory** is excluded, so excluding the directory itself makes both negations
silently do nothing - and `MANIFEST.md`, the one thing that must survive, would have
left the clone with everything else. `_not_required/*` excludes each child instead,
which leaves the directory itself includable and the negations effective.

**Verified** with exit codes rather than by reading the file (note `--no-index`, or git
declines to evaluate rules for paths that are still tracked):

```
$ git check-ignore -q --no-index <path>      # 0 = ignored, 1 = not ignored
NOT ignored  _not_required/MANIFEST.md
NOT ignored  _not_required/README.md
IGNORED      _not_required/metadata.json
IGNORED      _not_required/firebase-blueprint.json
IGNORED      _not_required/dead-code/x.ts
IGNORED      _not_required/docs-archive/a/b/c.md
```

## 1.4 Exclusions, each one verified

Ground rule: "Verify each exclusion actually took effect." Assumption was not accepted
anywhere in this table.

| Pipeline | Mechanism | Verification run | Result |
|---|---|---|---|
| git | `_not_required/*` + 2 negations | `git check-ignore -q --no-index` on 6 paths | as above - correct |
| typecheck / lint | new `"exclude"` in `tsconfig.json` | `npx tsc --noEmit --listFiles` | 88 non-dependency files, **0** from `_not_required`, `dist`, `tools` |
| unit tests | `include: ['src/**/*.test.ts']` | `npx vitest list --config vitest.config.ts` | 409 entries in 25 files, **0** from quarantine |
| rules tests | `include: ['tests/**/*.test.ts']` | `npx vitest list --config vitest.rules.config.ts` | 41 entries, **0** from quarantine |
| coverage | `include: ['src/lib/**','src/services/**']` | read from `vitest.config.ts` | cannot reach the folder by construction |
| bundle | nothing imports it | `git grep _not_required` over all source; then grepped every file in `dist/` for `_not_required`, `xcode_project_setup`, `firebase-blueprint`, `Contact&InquirePage` | **no source reference; no build artifact contains any of the four strings** |
| encoding sweep | `DIRS = src docs tests scripts tools` in `scripts/check-encoding.mjs` | `npm run lint:encoding` | 104 files swept, clean - the folder is not in `DIRS` |
| deploy | `firebase.json` has a `firestore` block only, no `hosting` | read | nothing to exclude - the folder is never deployed |
| Docker | no Dockerfile in this repo | `Get-ChildItem` | not applicable |
| npm publish | not a published package; no `files` field, no `.npmignore` | `package.json` | not applicable - flagged as a Phase 10 nicety, not a gap today |

## 1.5 The finding this phase turned up

Excluding the quarantine from `tsconfig.json` required adding an `exclude` array, and
there was none. There was no `include` either. TypeScript's default in that case is
**every `.ts`/`.tsx`/`.js` under the project directory**, minus a built-in list that
covers `node_modules` and `outDir` - and `outDir` is not set here, so `dist/` was not
excluded. `allowJs` is `true`.

Consequence, verified with `tsc --noEmit --listFiles`:

```
before:  96 non-dependency files, 8 of them under dist/
           dist/server.cjs
           dist/assets/index-B-oc0Jkh.js          (1.1 MB entry chunk)
           dist/assets/pdf.worker-CliDBb4N.mjs    (2.1 MB bundled worker)
           dist/assets/pdf-Bs6rg4xv.js
           dist/assets/index-BEAO-BqI.js
           dist/assets/Markdown-DT_GAzzd.js
           dist/assets/_commonjsHelpers-CqkleIqs.js
           dist/assets/pdf.worker-UaVanmWO.js
after:   88 non-dependency files, 0 under dist/
```

`npm run lint` was typechecking its own build output. It passed - which is the actual
problem, not a mitigation. It means the green status of the only linter this project
has depended on two things nobody intended: whether minified generated code happens to
satisfy `strict`, and whether `dist/` existed at the moment you ran it. A developer who
ran `npm run clean` and one who did not were running different checks.

Side effect: **`npm run lint` went from 21.95 s to 8.70 s**, a 60% cut, on the check
that runs most often.

The exclude list is `node_modules`, `dist`, `coverage`, `_not_required`,
`.antigravity`, `tools`.

## 1.6 The four rows now in the manifest

All four predate this pass (parked 2026-08-09 in `fbb0b3d`). What changed today is
their tracked status; the files have not moved and are still on disk, verified after
the `git rm --cached`.

The evidence column was **re-run from scratch** rather than inherited from the original
commit message, because "it was already parked" is not evidence. Every hit returned by
every search is prose in `CLAUDE.md`, `docs/notes/persistence.md` or
`docs/notes/styling.md` explaining that the file is parked. No code, config, script,
test or build artifact references any of them.

| File | Distinctive search also run | Hits outside docs |
|---|---|---|
| `metadata.json` | - | 0 |
| `firebase-blueprint.json` | `targetFormat` (a field unique to its stale schema) | 0 |
| `public/LoginPage/Contact&InquirePage/DESIGN.md` | `LoginPage/DESIGN` | 0 |
| `.agents/skills/xcode_project_setup/SKILL.md` | - | 0 |

## 1.7 Verification after the batch

All six gates, run after every change in this phase was in place:

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 (8.70 s, was 21.95 s) |
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | exit 0 (9.10 s) |
| `npm run lint:encoding` | exit 0 - 104 files swept, clean |
| `npm test` | exit 0 - **25 files / 409 tests passed** |
| `npm run test:rules` | exit 0 - **2 files / 41 tests passed** |
| `npm run build` | exit 0 - byte-identical chunk hashes to the Phase 0 baseline |

Encoding spot-checked by hand on the edited files: `README.md` 0, `.gitignore` 0,
`tsconfig.json` 0, both new `_not_required` records 0, and `CLAUDE.md` still **exactly
8** - the standing self-exception it documents, unchanged by these edits.

Nothing broke, so nothing needed restoring.

## 1.8 Left alone deliberately

- **`audit/00-inventory.md`** line 31 still reads "`_not_required/` | 4 | Parked.
  Tracked but read by nothing." and **`audit/02-architecture.md`** line 204 refers to
  the folder in the present tense. Both are now stale. They are dated point-in-time
  reports from the 2026-08-27 audit, and rewriting a historical record to match today
  is a worse habit than letting it read as history. **Say the word if you would rather
  they carried a "superseded 2026-08-28" note** - that is the version I would
  recommend if either is still being read as current.
- **`.npmignore`** not added. The package is not published (`"name": "react-example"`,
  no `license`, no `files`), so an ignore file for a publish that never happens is
  exactly the clutter this pass exists to remove. Revisit in Phase 10 only if
  publishing becomes real.
- **The pre-existing uncommitted move** of `claude-code-full-audit-prompt-pack.md` into
  `docs/` is still untouched, and every commit in this phase named explicit paths or
  committed only a pre-staged index so it could not be swept in.
- **33 local `audit/*` branches**, all merged into `main`. Ground rule 7 forbids
  deleting branches.

## 1.9 What is now true that was not before

1. There is a written convention for removal in this repo, and it is enforceable rather
   than customary.
2. Every removal from here on has a row with a restore command and a retention date, so
   deleting is a decision on a calendar instead of a drift.
3. `npm run lint` checks the project rather than the project plus its own output, and
   runs in 40% of the time.
