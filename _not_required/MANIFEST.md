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

### Phase 4 - dead code (2026-08-28)

These are **symbols cut out of files that are still live**, not whole files, so the
"New path" column holds an excerpt file rather than a moved original. Each excerpt
carries the code verbatim plus a header saying where it came from and what it depends
on; restoring means pasting it back, not a `git mv`. The live file keeps a short comment
at the removal site pointing here, so the next reader finds the record without a search.

Unlike the Phase 2 rows these **were tracked**, so git history is a real second copy:
`git show 5263341:<path>` reaches any of them at their last live commit.

| Date | Original path | New path | Category | Why removed | Evidence (search/tool + result) | Restore command | Risk | Safe to delete after |
|---|---|---|---|---|---|---|---|---|
| 2026-08-28 | `src/components/landing/icons.tsx` -> `IconRuler`, `IconUpload` | `_not_required/dead-code/src/components/landing/icons.tsx` | dead-code | Two exported icon components nothing rendered. | `git grep -w IconUpload` -> 1 hit, the declaration. `git grep -w IconRuler` -> 3 hits: the declaration and **two prose comments** in the same file, no JSX. Dynamic-reference check: every icon import in the project is a static named import; `git grep 'icons\['` -> no hits, so there is no name-keyed lookup. **Measured:** neither icon's `d=` path data appears anywhere in `dist/assets/*.js` (control: `IconFolder`, which is used, appears once) - both were already tree-shaken. | paste from the excerpt back into `src/components/landing/icons.tsx` | low - zero shipped bytes, so no behaviour to change | 2026-11-26 |
| 2026-08-28 | `src/lib/motion.ts` -> `drawerVariants`, `messageVariants`, `tabPanelVariants`, `snapInVariants` | `_not_required/dead-code/src/lib/motion.ts` | dead-code | Four exported Framer Motion variant objects nothing imported - a vocabulary for a drawer, an animated message list and an animated tab panel that this app does not have. | `git grep -w` -> exactly one hit each, the declaration. Cross-checked with `npx knip`, which flagged the same four independently. **Measured:** `x:'100%'` (drawer) and `scale:1.22` (snapIn) appear 0 times in the built JS; control `fadeInUpVariants`'s `y:16` appears once. Already tree-shaken. | paste from the excerpt back into `src/lib/motion.ts` | low | 2026-11-26 |
| 2026-08-28 | `src/components/landing/sections.tsx` -> `SMALL` | `_not_required/dead-code/src/components/landing/sections.tsx` | dead-code | A typography class-string constant. Its four siblings (`H2`, `LEDE`, `BODY` and the components below them) are imported by `LandingPage` and `FeaturesPage`; this one by neither. | `git grep -w SMALL` -> 1 hit, the declaration. Fixed-string search for the class list itself -> no hit in `src/` outside the declaration, so it is not inlined elsewhere under another name. **Measured:** removing it changed the built JS by exactly 0 bytes - it too was tree-shaken. | paste back beside `BODY` | low | 2026-11-26 |
| 2026-08-28 | `src/index.css` -> `.bento-grid`, `.glass-panel`, `.port-indicator`, `.hero-gradient` | `_not_required/dead-code/src/index.css` | dead-code | Four hand-written class rules from an earlier visual direction - a bento grid, a glassmorphism panel, a port indicator and a hero gradient - that the current landing design never adopted. | Each class name appears **exactly once in the entire repository**: its own declaration. Dynamic-construction check: all 98 `className={\`…\`}` template-literal sites in `src/` were read and none builds a `-grid`, `-panel`, `-gradient` or `-indicator` suffix; a fixed-string search for those suffixes before a backtick returns nothing. **Measured:** unlike everything else in this phase these were genuinely shipping - the built stylesheet contained all four, and removing them took `dist/assets/*.css` from 109,411 B to 108,807 B, **-604 B**, with the JS byte-identical. | paste back after the "Landing Page Specific Rules" comment | low | 2026-11-26 |

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
| `src/vite-env.d.ts` | unreachable from every entry point | An ambient declaration; tsc consumes it by inclusion, never by import, so no import graph can reach it. Its own comment records why it is load-bearing: without it, `(import.meta as any)` casts defeat Vite's transform-time substitution and leave a dev-only branch in the production bundle. |
| `GET /api/health` in `server.ts` | a route with no in-repo caller | A health endpoint is called by things outside the repository. `docs/PRD.md` and `docs/notes/gemini.md` both record it as the *only* surviving endpoint after `POST /api/generate-report` and `GET /api/debug-key` were deleted, and that the server is deliberately key-free. Removing it would undo a documented decision. |
| `@firebase/rules-unit-testing` | knip reported it an unused devDependency | **A false positive, and instructive.** knip had no configuration for the second Vitest project, so it also called `tests/firestore.rules.test.ts`, `tests/accountDeletion.test.ts` and `vitest.rules.config.ts` "unused files". The package is imported by both rules tests. This is exactly why tool output was verified rather than trusted. |
| 46 unused `@theme` tokens in `src/index.css` | dead design tokens | **Measured: they cost zero shipped bytes.** Tailwind v4 emits only the tokens it needs, and none of the 46 appears in the built stylesheet. They are the unused half of a coherent Material Design 3 palette; deleting part of a design-token set costs source lines and buys nothing. |
| ~12 exports used only inside their own file (`EASE`, `googleProvider`, `USERS_COLLECTION`, `DESIGNER_ORIGIN`, `POINTS_PER_INCH`, `CSS_PX_PER_INCH`, `reauthenticate`, `LOCAL_REPORTS_KEY`, `FirestoreErrorInfo`, …) | unused exports | The *values* are live - each is used within its declaring module. Only the `export` keyword is surplus. Listed as UNSURE in `cleanup/04-dead-code.md` with the argument for narrowing them, because un-exporting brings them under `tsc --noUnusedLocals`, which cannot see an exported symbol. Not moved: that is an edit to 9 files for no runtime effect. |
| `AttachmentText` (`src/lib/attachmentParts.ts`) vs `TextAttachment` (`src/App.tsx`) | duplicate type declarations | **Not duplicates.** `AttachmentText` is `{ text: string }` - a deliberately minimal structural type, so `App.tsx`'s richer five-field `TextAttachment` satisfies it without the lib depending on the component. Checked because the transposed names look like an accident; they are not. |
| `resetGenAIForTests` (`src/lib/genai.ts:36`) | an unused function whose own name says it is for tests | Genuinely unreferenced - no test calls it. **Kept on the owner's explicit decision, 2026-08-28.** `loadGenAI()` memoises a dynamic `import()` on the module, so without this seam any future test touching that loader inherits state from the previous one. Three lines, tree-shaken, zero shipped bytes. Removing dead code is right; removing a deliberately placed, documented seam for tests not yet written is a different decision. **Do not re-flag this.** |
| `Route` type (`src/lib/router.ts:28`) | an exported type used nowhere, not even in its own file | One line, erased entirely at compile time, and it names the route union derived from `ROUTES` - which the same file documents at length as load-bearing. Kept 2026-08-28. |
| `assets/source/logo.png` (295,261 B) and `assets/source/logo_white.png` (2,984,020 B) | 3.28 MB of unreferenced PNG - 58% of everything tracked, and no code path reaches either | **Kept on the owner's explicit decision, 2026-08-29.** They are the design masters: for an open-source project they are what a fork needs in order to regenerate `public/` at other sizes or produce a new OG card, and `docs/notes/styling.md` documents them as deliberately preserved outside `public/` so Vite does not copy 3 MB into `dist/`. The arithmetic is the real argument: quarantining them shrinks the **checkout** by 3.28 MB and the **clone** by exactly zero, because the blobs stay in history - and Phase 2 established there is nothing worth reclaiming by rewriting it. Re-encoding is worse still: `logo_white.png` losslessly re-encodes to 1,981,386 B, but the new blob is *added* while the old one stays reachable, so the clone would **grow** by ~1.98 MB. **Do not re-flag this.** |
| ~12 internal-only exports, revisited | see the row above | **Decision taken 2026-08-28: leave them exported.** Narrowing would be an edit across nine files with no runtime effect, and the boundary is symbol-by-symbol rather than file-by-file - `VAULT_DOC_ID` sits in the same file as three of them and *is* imported by a test. The known cost of leaving them is recorded in `cleanup/04-dead-code.md` §4.5: an exported symbol is invisible to `tsc --noUnusedLocals`, so if one of these becomes dead later, nothing will say so. |

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
