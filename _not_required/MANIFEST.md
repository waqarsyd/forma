# Quarantine manifest

The permanent record of everything moved out of the project and why. This file is
**tracked**; the files it describes are not. See [`README.md`](README.md) for the
convention.

Nothing here has been deleted. Every row carries a restore command that works against
the working tree, and a commit to recover from if the working-tree copy is gone.

**Retention:** a row whose "Safe to delete after" date has passed is a candidate for
real deletion. That is a human decision, taken against this table, never a side effect
of a cleanup pass.

---

## How to restore something

```powershell
# 1. From the working tree (the folder still holds the file):
git mv _not_required/<category>/<original path> <original path>

# 2. From history (fresh clone, or the working-tree copy is gone):
git checkout <commit named in Evidence>~1 -- <original path>
```

Because the folder is gitignored, `git mv` out of it is what re-adds the file to the
index. Moving something *in* needs `git rm --cached <path>` after the `mv`, since a
`git mv` into an ignored path fails.

### One caveat that changes what "safe" means

**For a file that was never tracked, this folder is the only copy.** Git history is the
real backup only for things git ever had. A gitignored file moved in here has no commit
to be recovered from, and the restore command in its row is not a convenience - it is
the entire recovery path.

Rows below are marked **`untracked`** in the Risk column where this applies. Weigh them
accordingly before emptying the folder: for a regenerable build artifact it means
nothing, and for anything else it would mean everything.

---

## Moved

### Pre-existing - parked 2026-08-09, untracked 2026-08-28

| Date | Original path | New path | Category | Why removed | Evidence (search/tool + result) | Restore command | Risk | Safe to delete after |
|---|---|---|---|---|---|---|---|---|
| 2026-08-09 (parked) / 2026-08-28 (untracked) | `metadata.json` | `_not_required/metadata.json` | pre-existing | AI Studio applet metadata from before this was a Vite app. Nothing reads it, and it was the last place the pre-Forma product name "DevExpress Report AI Designer" survived. | `git grep -n -I -e 'metadata\.json' -- ':(exclude)_not_required' ':(exclude)cleanup' ':(exclude)docs/claude-code-*'` -> 2 hits, both prose in `CLAUDE.md` (lines 53, 55) explaining that it is parked. No code, config, script or test reference. Parked in `fbb0b3d`. | `git mv _not_required/metadata.json metadata.json` | low | 2026-11-26 |
| 2026-08-09 (parked) / 2026-08-28 (untracked) | `firebase-blueprint.json` | `_not_required/firebase-blueprint.json` | pre-existing | Stale schema doc describing a `SavedReport` entity (`targetFormat`, `repxContent`, `layout`, `content`) that matches neither `firestore.rules` nor the code. Actively misleading if read. | `git grep -n -I -e 'firebase-blueprint'` -> 2 hits, prose in `CLAUDE.md:55` and `docs/notes/persistence.md:24`. Cross-checked the distinctive field name: `git grep -n -I -e 'targetFormat'` -> 1 hit, the same `persistence.md` sentence. Nothing in `src/`. Parked in `fbb0b3d`. | `git mv _not_required/firebase-blueprint.json firebase-blueprint.json` | low | 2026-11-26 |
| 2026-08-09 (parked) / 2026-08-28 (untracked) | `public/LoginPage/Contact&InquirePage/DESIGN.md` | `_not_required/public/LoginPage/Contact&InquirePage/DESIGN.md` | pre-existing | Byte-identical twin of a design doc that had to be edited twice. Worse, it sat inside `public/`, so Vite copied it into `dist/` and **served the design docs on the live site** - verified in a build. The live source is `docs/design/DESIGN.md`. | `git grep -n -I -e 'Contact&InquirePage'` -> 2 hits, prose in `CLAUDE.md:55` and `docs/notes/styling.md:29`. Also `git grep -n -I -e 'LoginPage/DESIGN'` -> 1 hit, the same `styling.md` sentence. Parked in `fbb0b3d`. | `git mv "_not_required/public/LoginPage/Contact&InquirePage/DESIGN.md" "public/LoginPage/Contact&InquirePage/DESIGN.md"` | low | 2026-11-26 |
| 2026-08-09 (parked) / 2026-08-28 (untracked) | `.agents/skills/xcode_project_setup/SKILL.md` | `_not_required/.agents/skills/xcode_project_setup/SKILL.md` | pre-existing | Shipped inside Firebase's official skill packs. This is a web project on Windows with no Apple platform target; the skill is inapplicable. | `git grep -n -I -e 'xcode_project_setup'` -> 2 hits, prose in `CLAUDE.md` (lines 55, 137) explaining that it is parked. Parked in `fbb0b3d`. | `git mv _not_required/.agents/skills/xcode_project_setup/SKILL.md .agents/skills/xcode_project_setup/SKILL.md` | low | 2026-11-26 |

### Phase 2 - obvious junk (2026-08-28)

| Date | Original path | New path | Category | Why removed | Evidence (search/tool + result) | Restore command | Risk | Safe to delete after |
|---|---|---|---|---|---|---|---|---|
| 2026-08-28 | `debug.log` (671 B) | `_not_required/build-artifacts/debug.log` | build-artifacts | **Not this project's file at all.** A Chrome *installer* log, written 2026-08-17 by a browser install run out of a previous agent session's scratchpad directory. Nothing in this repo produces or reads it. | Read the file: every line is `chrome\updater\win\installer\installer.cc` verbose output referencing `...\claude\...\823f4e14-...\scratchpad\chrome_installer.exe`. Untracked - `git ls-files` does not list it; matched by the existing `*.log` rule, so it was never in the clone. Does not regenerate: nothing here installs Chrome. | `Move-Item _not_required/build-artifacts/debug.log debug.log` | **untracked** / none | 2026-11-26 |
| 2026-08-28 | `firestore-debug.log` (167,171 B) | `_not_required/build-artifacts/firestore-debug.log` | build-artifacts | Firestore emulator output, and the largest non-build untracked file in the tree. Stale output from a finished run; nothing reads it after the emulator exits. | Untracked, covered by `*.log`. **Confirmed transient:** running `npm run test:rules` after the move recreated it at the root at exactly 167,171 bytes - the same size, so the emulator truncates and rewrites rather than appending. | `Move-Item _not_required/build-artifacts/firestore-debug.log firestore-debug.log` | **untracked** / none - regenerates | 2026-11-26 |
| 2026-08-28 | `dev-server.log` (112 B) | `_not_required/build-artifacts/dev-server.log` | build-artifacts | Output of `npm run dev:log`. Two lines, from a dev server that had already exited. | Untracked, covered by `*.log`. `scripts/dev.mjs` opens it with `flags: 'w'`, so each run truncates it - documented in `CLAUDE.md`. Verified nothing was listening on port 3000 before moving it, so no live process had the handle. | `Move-Item _not_required/build-artifacts/dev-server.log dev-server.log` | **untracked** / none - regenerates | 2026-11-26 |
| 2026-08-28 | `public/LoginPage/` and `public/LoginPage/Contact&InquirePage/` (empty dirs) | `_not_required/duplicates/public/LoginPage/...` | duplicates | Empty directories left behind when the decoy `DESIGN.md` was parked in `fbb0b3d`. Not harmless: Vite copies `public/` **verbatim** into the build, so every `npm run build` reproduced the empty tree as `dist/LoginPage/Contact&InquirePage/` - an empty directory named after a page that does not exist, shipping in the deployable output. | Git never tracked them (git cannot track an empty directory), so they were invisible to `git ls-files`, the encoding sweep, `tsc` and every grep. Found only by walking the disk for directories containing no files at any depth. **Verified fixed:** `npm run clean && npm run build` afterwards produced a `dist/` with no `LoginPage` entry - previously present. | `Move-Item "_not_required/duplicates/public/LoginPage" "public/LoginPage"` | **untracked** / none - contains no files | 2026-11-26 |

### Phase 2 - resolved from UNSURE by explicit decision (2026-08-28)

| Date | Original path | New path | Category | Why removed | Evidence (search/tool + result) | Restore command | Risk | Safe to delete after |
|---|---|---|---|---|---|---|---|---|
| 2026-08-28 | `.vscode/launch.json` (212 B) | `_not_required/old-configs/.vscode/launch.json` | old-configs | A node-terminal launch running `npm install && npm run dev`. Wrong on three counts: `npm install` is not this project's install (`npm ci` is what CI uses and what the lockfile expects - Phase 0 measured `node_modules` drifted 14.64 MB above the lockfile, which is what `npm install` does over time); `CLAUDE.md` states the dev server belongs in the user's own terminal, not a launched one; and it is AI Studio scaffold of the same vintage as `metadata.json` and `package.json`'s `"name": "react-example"`. | Tracked since the initial commit `c0e9c51` and **never edited since** - `git log -- .vscode` returns exactly one commit. Referenced nowhere in code or config; the only mention anywhere is `audit/00-inventory.md:157`, a list of config files that were read during the audit. **Classified UNSURE, not SAFE**, because no search can prove whether a human presses F5 - moved only on the explicit instruction of the repository owner on 2026-08-28. | `git mv _not_required/old-configs/.vscode/launch.json .vscode/launch.json` | low - if it was in use, it was running the wrong install command | 2026-11-26 |

### Kept, so a later pass does not re-flag them

Not everything examined is a candidate. These were looked at and deliberately left in
place; the reason is recorded so the next cleanup does not spend the same effort.

| Item | Looked like | Kept because |
|---|---|---|
| `.vscode/settings.json` | personal editor config, same untouched scaffold vintage as `launch.json` | One line - `{"workbench.startupEditor": "readme"}`. Harmless, and "open the README first" is a reasonable thing for a project whose README is its open-source front door to want. Kept on the owner's explicit decision, 2026-08-28. |
| `tools/RepxDesigner/bin/` (145.64 MB) | enormous build output | It is the **compiled companion tool the user double-clicks**. A working binary, not residue. Already gitignored. |
| `tools/RepxDesigner/obj/` (0.13 MB) | build intermediates | Regenerable, but moving it invalidates an incremental MSBuild for no gain. |
| `.antigravity/` (22.14 MB) | a 22 MB blob nothing reads | Live editor state for an editor still in use. Moving it is a change to the owner's tooling, not a cleanup. Already gitignored and documented in `CLAUDE.md`. |
| `audit/` (205 KB, 10 files) | a docs dump | The 2026-08-27 audit's findings register. 33 local branches still carry its identifiers (`audit/SEC-001-security-headers` and the rest). It is a historical record. It *is* undocumented in `CLAUDE.md` - that is a documentation gap for Phase 7, not a reason to move 205 KB of findings. |
| `dist/`, `.env` | build output, config | Regenerated / real local configuration. Both correctly gitignored. |

### Note on the four pre-existing rows

Those four predate this cleanup pass - they were parked on 2026-08-09 in `fbb0b3d`,
before there was a manifest. What changed on 2026-08-28 is only their **tracked
status**: the folder was deliberately tracked until then, and is now gitignored except
`MANIFEST.md` and `README.md`. The files themselves have not moved and are still on
disk. Unlike the Phase 2 rows they *were* tracked, so history is a real second copy of
them; `fbb0b3d` is the commit to recover from.

The evidence column was re-run from scratch during this pass rather than inherited from
the original commit message, because "it was already parked" is not evidence.

### Note on the two regenerating rows

`firestore-debug.log` and `dev-server.log` are back at the repo root already, and that
is expected rather than a failed move: both are tool scratch files that their tool
rewrites from scratch on the next run. Running the rules suite immediately after the
move recreated `firestore-debug.log` at byte-identical size.

Their rows are here for completeness of the record, not because anything was recovered.
Do not read a root-level `firestore-debug.log` as evidence that the manifest is wrong.
The only Phase 2 row describing a file that will *not* come back on its own is
`debug.log`, which this project has no way to produce.

---

## Deleted from quarantine

Nothing. This section stays empty unless a human deliberately empties a row above after
its retention date.
