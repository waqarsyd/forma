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

---

## Moved

| Date | Original path | New path | Category | Why removed | Evidence (search/tool + result) | Restore command | Risk | Safe to delete after |
|---|---|---|---|---|---|---|---|---|
| 2026-08-09 (parked) / 2026-08-28 (untracked) | `metadata.json` | `_not_required/metadata.json` | pre-existing | AI Studio applet metadata from before this was a Vite app. Nothing reads it, and it was the last place the pre-Forma product name "DevExpress Report AI Designer" survived. | `git grep -n -I -e 'metadata\.json' -- ':(exclude)_not_required' ':(exclude)cleanup' ':(exclude)docs/claude-code-*'` -> 2 hits, both prose in `CLAUDE.md` (lines 53, 55) explaining that it is parked. No code, config, script or test reference. Parked in `fbb0b3d`. | `git mv _not_required/metadata.json metadata.json` | low | 2026-11-26 |
| 2026-08-09 (parked) / 2026-08-28 (untracked) | `firebase-blueprint.json` | `_not_required/firebase-blueprint.json` | pre-existing | Stale schema doc describing a `SavedReport` entity (`targetFormat`, `repxContent`, `layout`, `content`) that matches neither `firestore.rules` nor the code. Actively misleading if read. | `git grep -n -I -e 'firebase-blueprint'` -> 2 hits, prose in `CLAUDE.md:55` and `docs/notes/persistence.md:24`. Cross-checked the distinctive field name: `git grep -n -I -e 'targetFormat'` -> 1 hit, the same `persistence.md` sentence. Nothing in `src/`. Parked in `fbb0b3d`. | `git mv _not_required/firebase-blueprint.json firebase-blueprint.json` | low | 2026-11-26 |
| 2026-08-09 (parked) / 2026-08-28 (untracked) | `public/LoginPage/Contact&InquirePage/DESIGN.md` | `_not_required/public/LoginPage/Contact&InquirePage/DESIGN.md` | pre-existing | Byte-identical twin of a design doc that had to be edited twice. Worse, it sat inside `public/`, so Vite copied it into `dist/` and **served the design docs on the live site** - verified in a build. The live source is `docs/design/DESIGN.md`. | `git grep -n -I -e 'Contact&InquirePage'` -> 2 hits, prose in `CLAUDE.md:55` and `docs/notes/styling.md:29`. Also `git grep -n -I -e 'LoginPage/DESIGN'` -> 1 hit, the same `styling.md` sentence. Parked in `fbb0b3d`. | `git mv "_not_required/public/LoginPage/Contact&InquirePage/DESIGN.md" "public/LoginPage/Contact&InquirePage/DESIGN.md"` | low | 2026-11-26 |
| 2026-08-09 (parked) / 2026-08-28 (untracked) | `.agents/skills/xcode_project_setup/SKILL.md` | `_not_required/.agents/skills/xcode_project_setup/SKILL.md` | pre-existing | Shipped inside Firebase's official skill packs. This is a web project on Windows with no Apple platform target; the skill is inapplicable. | `git grep -n -I -e 'xcode_project_setup'` -> 2 hits, prose in `CLAUDE.md` (lines 55, 137) explaining that it is parked. Parked in `fbb0b3d`. | `git mv _not_required/.agents/skills/xcode_project_setup/SKILL.md .agents/skills/xcode_project_setup/SKILL.md` | low | 2026-11-26 |

### Note on the four rows above

These four predate this cleanup pass - they were parked on 2026-08-09 in `fbb0b3d`,
before there was a manifest. What changed on 2026-08-28 is only their **tracked
status**: the folder was deliberately tracked until then, and is now gitignored except
`MANIFEST.md` and `README.md`. The files themselves have not moved and are still on
disk.

The evidence column was re-run from scratch during this pass rather than inherited from
the original commit message, because "it was already parked" is not evidence.

---

## Deleted from quarantine

Nothing. This section stays empty unless a human deliberately empties a row above after
its retention date.
