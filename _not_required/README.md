# `_not_required/` - the quarantine

**This folder is not part of the project.** Nothing in `src/`, `tests/`, `scripts/`,
`server.ts` or any config may import, read, build, or reference anything in here.

It exists so that cleanup can be aggressive without being dangerous. When something
looks unnecessary, it is **moved here, never deleted**. Deleting is a separate,
deliberate decision made later, by a human, against the record below.

## The rule

> If you are about to `rm` something during a cleanup, stop. `git mv` it into
> `_not_required/` and log it in `MANIFEST.md` instead.

## How it is laid out

Original relative paths are preserved inside each category folder, so restoring is
mechanical rather than archaeological. A file from `src/utils/legacy/parse.ts` goes to
`_not_required/dead-code/src/utils/legacy/parse.ts`, and the restore command writes
itself.

| Folder | What goes in it |
|---|---|
| `build-artifacts/` | committed `dist/`, coverage, logs, caches |
| `dead-code/` | unreferenced source files |
| `unused-assets/` | images, fonts, icons, media nothing references |
| `duplicates/` | redundant copies, backups, `*.bak`, `*.old`, `file 2.js` |
| `old-configs/` | superseded configs, dead CI workflows, stale dotfiles |
| `experiments/` | spikes, scratch scripts, one-off migrations, POCs |
| `docs-archive/` | outdated docs, old specs, meeting notes, TODO dumps |
| `vendor-dumps/` | manually vendored libs that should be deps, or are unused |
| `unsure/` | **only** with explicit human approval - see below |

Four files parked before this convention was formalised sit at the top level rather
than in a category folder: `metadata.json`, `firebase-blueprint.json`,
`public/LoginPage/Contact&InquirePage/DESIGN.md`, and
`.agents/skills/xcode_project_setup/SKILL.md`. They are logged in `MANIFEST.md` like
everything else.

## Tracked vs ignored

**The contents of this folder are gitignored. `MANIFEST.md` and `README.md` are not.**

That is the deliberate trade: the quarantined bytes leave the clone, while the record
of what was parked, why, and how to get it back stays in git forever. Git history is
the real recovery mechanism; this folder is only the convenient one.

Two consequences worth knowing before you go looking for something:

- **A grep of the working tree will not reach these files.** Before 2026-08-28 it
  would have - the folder was tracked on purpose for exactly that reason. If you are
  hunting for a parked file, read `MANIFEST.md` or use `git log --diff-filter=D
  --name-only` rather than concluding it never existed.
- **A fresh clone does not contain them.** Restoring on a machine that never had them
  means recovering from history (`git checkout <commit-before-the-move> -- <path>`),
  not from this folder. The `MANIFEST.md` restore column gives the working-tree
  command; the "Evidence" column gives you the commit to recover from if the working
  tree copy is gone.

## The `unsure/` folder

Nothing goes in `unsure/` on an agent's or an author's own judgement. The whole point
of the SAFE / UNSURE / KEEP split is that UNSURE items **stay where they are** and get
listed for a human decision. `unsure/` exists only for the case where that human has
looked at the list and said "park these while I think about it."

## Exclusions

`_not_required/` is excluded from every pipeline in this repo. If you add a new tool,
add it here too, and verify the exclusion actually took effect rather than assuming it.

| Pipeline | How it is excluded | Verified by |
|---|---|---|
| git | `_not_required/*` in `.gitignore`, with `!MANIFEST.md` / `!README.md` | `git check-ignore -v` |
| typecheck / lint | `"exclude"` in `tsconfig.json` | `tsc --noEmit --listFiles` |
| unit tests | `include: ['src/**/*.test.ts']` in `vitest.config.ts` | `vitest list` |
| rules tests | `include: ['tests/**/*.test.ts']` in `vitest.rules.config.ts` | `vitest list` |
| coverage | `include: ['src/lib/**', 'src/services/**']` in `vitest.config.ts` | the coverage report |
| bundle | not reachable from `index.html` -> `src/main.tsx`; nothing imports it | `grep` + the build's module count |
| encoding sweep | `DIRS` in `scripts/check-encoding.mjs` is `src docs tests scripts tools` | the swept-file count |
| deploy | `firebase.json` deploys Firestore rules only; there is no hosting block | - |
| Docker | not applicable - this repo has no Dockerfile | - |

## Expiry

Anything in here that is still untouched **90 days** after its move date is a
candidate for real deletion, because git history is the actual backup. `MANIFEST.md`
carries a "Safe to delete after" date per row so that this is a decision on a
calendar, not a drift.
