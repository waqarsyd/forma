# Phase 2 - Obvious junk

Date: 2026-08-28
Branch: `chore/cleanup`

**Headline: there is almost none.** The category that usually pays for a cleanup pass
paid nothing here, and that is the finding. The 2026-08-27 audit and the existing
`.gitignore` had already done this work. What was left was four items totalling
167 KB, none of it in the clone - plus one of them that was quietly affecting every
build.

**SAFE 4 / UNSURE 2 / KEEP 6.**

---

## 2.1 The scan

Every category the prompt names, run against the tracked file list. "Tracked" is the
distinction that matters: an untracked file is already outside the clone, so it is disk
tidiness, not repo weight.

| Category | Searched for | Tracked hits |
|---|---|---|
| Build output committed | `dist build out .next target bin obj coverage .cache .turbo .parcel-cache` as path segments | **none** |
| Dependency folders committed | `node_modules vendor venv .venv __pycache__` | **none** |
| OS / editor cruft | `.DS_Store Thumbs.db desktop.ini *.swp .idea/ .vscode/` | **2** - `.vscode/launch.json`, `.vscode/settings.json` |
| Logs / dumps / db files | `*.log *.heapsnapshot *.sqlite *.db *.dmp *.pyc npm-debug yarn-error` | **none** |
| Backups / manual copies | `*.bak *.old *.orig *.rej *.tmp` + `copy`/`backup`/`deprecated`/`old_`/`final`/`-v2` name patterns | **none** |
| Archives | `*.zip *.tar *.gz *.tgz *.rar *.7z *.bz2` | **none** |
| PDFs / screenshots / mockups / media | `*.pdf *.psd *.ai *.sketch *.fig *.mp4 *.mov *.gif *.bmp *.tiff` | **none** |
| CSV / SQL dumps | `*.csv *.sql` | **none** |
| Empty tracked files | length 0 | **none** |
| Ad-hoc root scripts | every root file classified by hand | **none** - all 17 tracked root files are configs or docs |

Then the disk, beyond what git sees:

| Check | Result |
|---|---|
| Stray cache/tool dirs (`.cache .turbo .parcel-cache .next out target __pycache__ .idea .nyc_output .pytest_cache`) anywhere outside `node_modules` | **none** |
| `Thumbs.db` / `desktop.ini` / `.DS_Store` anywhere on disk | **none** |
| Empty directories at any depth | **4** - two in `public/`, two mirrored into `dist/` by the build |
| Root-level `*.log` | **3** |

`scripts/` was checked for orphans: all three (`dev.mjs`, `build-server.mjs`,
`check-encoding.mjs`) are invoked by `package.json` scripts. No ad-hoc script exists.

## 2.2 SAFE - moved to quarantine (4)

All four were **untracked**, so none of them was ever in the clone. See `MANIFEST.md`
for the full rows.

### 1. `debug.log` (671 B) - not this project's file

A Chrome **installer** log from 2026-08-17. Every line is
`chrome\updater\win\installer\installer.cc` verbose output, referencing
`chrome_installer.exe` in a *previous agent session's scratchpad directory*. Nothing in
this repo installs a browser; it will not regenerate. It survived only because
`.gitignore` hid it behind `*.log`, which is exactly how a stray file gets to sit in a
repo root for eleven days without anyone noticing.

### 2. `firestore-debug.log` (167,171 B) - the largest untracked non-build file

Emulator output. Stale from a completed run.

### 3. `dev-server.log` (112 B)

Output of `npm run dev:log`. Verified nothing was listening on port 3000 before moving
it, so no live process held the handle.

Rows 2 and 3 **regenerate**, and both are already back at the repo root - the rules
suite recreated `firestore-debug.log` at byte-identical size while verifying this phase.
That is recorded in the manifest so a future reader does not mistake a reappeared log
for a broken record.

### 4. `public/LoginPage/` and `public/LoginPage/Contact&InquirePage/` - the one that mattered

Two empty directories, left behind when the decoy `DESIGN.md` was parked in `fbb0b3d`
back on 2026-08-09.

They were not harmless. **Vite copies `public/` verbatim into the build**, so every
`npm run build` for the last nineteen days reproduced them as
`dist/LoginPage/Contact&InquirePage/` - an empty directory tree shipping in the
deployable output, named after a page that does not exist, pointing at a design doc
that was deliberately removed for having been served publicly once already.

They were invisible to every check this project has, and would have stayed invisible:
**git cannot track an empty directory**, so no file-based tool - not `git ls-files`,
not the encoding sweep, not `tsc`, not a grep - can see one. Found only by walking the
disk for directories containing no files at any depth.

Verified fixed: `npm run clean && npm run build` afterwards produced a `dist/` with no
`LoginPage` entry.

## 2.3 UNSURE - not moved, awaiting your decision (2)

Both are tracked, both arrived in the initial commit (`c0e9c51`) and **have never been
edited since**, which is the signature of scaffold rather than something in use.

### `.vscode/launch.json`

```json
{ "version": "0.2.0", "configurations": [
  { "name": "npm install && npm run dev", "type": "node-terminal",
    "command": "npm install && npm run dev" } ] }
```

Three things are wrong with it on the merits: `npm install` is not this project's
install (`npm ci` is what CI uses and what the lockfile expects, and the 14.64 MB drift
found in Phase 0 is what `npm install` does over time); `CLAUDE.md` is explicit that the
dev server belongs in the user's own terminal; and it is generated AI Studio scaffold of
exactly the same vintage as `metadata.json` and `package.json`'s `"name":
"react-example"`, both already recognised as leftovers.

### `.vscode/settings.json`

```json
{ "workbench.startupEditor": "readme" }
```

One personal editor preference.

**Why these are UNSURE and not SAFE.** The prompt pack's own rule is to keep
`.vscode/settings.json` "only if the team actually uses them", and there is no search
that can prove whether you press F5 in VS Code. That is not a gap in the investigation;
it is a fact only you hold. A wrongly kept 200-byte file costs nothing, and I am not
going to promote a guess to evidence.

**My recommendation, for what it is worth:** quarantine `launch.json` (it encodes an
install command this project does not use, so if it *is* being pressed, it is doing the
wrong thing), and keep `settings.json` (harmless, and "open the README first" is a
reasonable thing to want).

## 2.4 KEEP - looks like junk, is not (6)

| Item | Size | Why it stays |
|---|---|---|
| `tools/RepxDesigner/bin/` | 145.64 MB | The **compiled companion tool you double-click**. Flow 5 is in scope, so this is a working binary, not build residue. Correctly gitignored. |
| `tools/RepxDesigner/obj/` | 0.13 MB | MSBuild intermediates. Regenerable, but moving them invalidates an incremental build for no gain. |
| `.antigravity/` | 22.14 MB | Live editor state for an editor you are presumably still using. Moving it is a change to your tooling, not a cleanup. Already gitignored, already documented in `CLAUDE.md`. **Superseded 2026-08-29:** deleted at the owner's explicit request after the pass had closed — see below. |

> **`.antigravity/` was deleted on 2026-08-29**, reversing the KEEP above. The file had not
> been written since 2026-06-19, roughly ten weeks, and no editor process held it open.
>
> It is worth flagging as **the one irreversible removal in this entire cleanup**, and the
> only one taken outside the quarantine convention. Everything else moved to
> `_not_required/` or stayed recoverable from git history; `.antigravity/` was gitignored,
> so git had no copy and there was nothing to restore from. That was put to the owner
> explicitly — with the alternatives of quarantining it or moving it outside the repo —
> and deletion was chosen knowingly.
>
> Working tree: **178.45 MB → 156.37 MB.** The `.gitignore` entry stays, because the
> editor recreates the folder when next used.
| `dist/` | 4.29 MB | Current build output, regenerated by `npm run build`, never tracked. |
| `.env` | 0.7 KB | Real local configuration. |
| `audit/` | 205 KB, 10 files | **Not junk.** The 2026-08-27 audit's findings register, with 33 branch names still referring to its identifiers (`audit/SEC-001-security-headers` and the rest). It is a historical record. It *is* undocumented - `CLAUDE.md` describes `docs/notes/` and `_not_required/` but never mentions `audit/` - and that is a documentation gap for Phase 7, not a reason to move 205 KB of findings. |

## 2.5 `.gitignore` audit

Every Phase 2 category, checked against the file as it stood.

| Category | Was covered? | Action |
|---|---|---|
| build output | `build/ dist/ coverage/` | none needed - `out/ .next/ target/ .turbo/ .parcel-cache/` deliberately **not** added: no Next.js, no Rust, no Turbo, no Parcel here, and speculative patterns for stacks a project does not use are the clutter this pass exists to remove |
| dependency folders | `node_modules/` | none - no `vendor/`, `venv/` in a repo with no Go/PHP/Python |
| logs | `*.log` | none - it caught all three stray logs |
| OS / editor cruft | `.DS_Store` only | **added `Thumbs.db`, `desktop.ini`, `*.swp`, `*.swo`, `.idea/`** |
| backups / scratch copies | nothing | **added `*.bak *.old *.orig *.rej *.tmp`** |
| archives | nothing | **added `*.zip *.tar *.tar.gz *.tgz *.rar *.7z`** |
| quarantine | added in Phase 1 | none |
| `.dockerignore` | - | **not applicable** - no Dockerfile, no container build |
| `.npmignore` | - | **not applicable** - not a published package |
| `.eslintignore` / `.prettierignore` | - | **not applicable** - neither tool exists in this project |

The OS block is the one that is genuinely wrong-shaped rather than merely incomplete:
`.DS_Store` is the macOS dropping, and **this is a Windows project**. Explorer writes
`Thumbs.db` into any folder whose images it has previewed - which includes `public/`
and `assets/source/` - and `desktop.ini` into any folder given a custom icon. Neither
has ever been committed, so this is a backstop in the same spirit as the existing
credential patterns, not a response to an incident.

**Verified**: no currently tracked file matches any newly added pattern (checked all
216 by running `git check-ignore -q --no-index` over the full `git ls-files` output),
and spot checks confirm `Thumbs.db`, `src/Thumbs.db`, `desktop.ini`, `App.tsx.orig`,
`notes.bak`, `archive.zip`, `x.tar.gz` and `.idea/workspace.xml` are now ignored while
`src/App.tsx`, `README.md` and `.env.example` are not.

## 2.6 Junk in git history (Phase 8 input, no action taken)

Reported now as the prompt requires; nothing was done.

Only **8 paths** have ever been added and later removed across all 119 commits:

```
.agents/skills/xcode_project_setup/SKILL.md     -> moved to _not_required (fbb0b3d)
firebase-blueprint.json                         -> moved to _not_required (fbb0b3d)
metadata.json                                   -> moved to _not_required (fbb0b3d)
public/LoginPage/Contact&InquirePage/DESIGN.md  -> moved to _not_required (fbb0b3d)
public/LoginPage/DESIGN.md                      -> consolidated into docs/design/
PRD.md                                          -> moved to docs/PRD.md
assets-source/logo.png                          -> renamed to assets/source/logo.png
assets-source/logo_white.png                    -> renamed to assets/source/logo_white.png
```

The two `.png` paths are the only junk-shaped entries, and they are **not dead weight**.
Verified by object id:

```
$ git rev-parse fbb0b3d~1:assets-source/logo_white.png
a758df680c814736f55d73317499a7d5176d8005
$ git rev-parse HEAD:assets/source/logo_white.png
a758df680c814736f55d73317499a7d5176d8005      <- same blob
```

Both logos are the *same objects* still reachable from HEAD under their new paths. A
rename costs a tree entry, not a blob. **There is nothing for a history rewrite to
reclaim here**, which settles Phase 8 in advance: the entire pack is 4.30 MiB and
essentially all of it is live.

## 2.7 Verification

Run after every change in this phase was in place:

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | exit 0 |
| `npm run lint:encoding` | exit 0 - 104 files swept, clean |
| `npm test` | exit 0 - **25 files / 409 tests passed** |
| `npm run test:rules` | exit 0 - **2 files / 41 tests passed** |
| `npm run clean && npm run build` | exit 0 - and `dist/` no longer contains `LoginPage/` |

Nothing broke; nothing needed restoring.

## 2.8 Size effect, stated honestly

| Measure | Before | After |
|---|---|---|
| Tracked files | 216 | 216 |
| Tracked size | 5.69 MB | 5.69 MB |
| Git pack | 4.30 MiB | 4.30 MiB |
| Root-level `*.log` on disk | 3 (167.9 KB) | 0 at the time of the move; 1 regenerated by the verification run |
| Empty directories shipping into `dist/` | 2 | **0** |

**Phase 2 removed no weight from the clone, because there was none to remove.** Its
actual return was the `public/` -> `dist/` empty-directory leak and a `.gitignore` whose
OS-cruft rule was written for the wrong operating system. The prompt pack expects this
phase to be the big win; on this repo it is not, and the honest thing is to say so and
move the expectation to Phase 5, where 530 MB of `node_modules` and a 1.12 MB entry
chunk are.
