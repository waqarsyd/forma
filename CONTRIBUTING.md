# Contributing to Forma

Short version: **run the checks, keep the tree small, and write down why.**

This file is the public-facing half of the project's conventions. The other half is
[`CLAUDE.md`](CLAUDE.md), which carries the constraints and incident history an agent or a
new contributor needs before touching anything. Where the two overlap — the Node floor,
the script list, the encoding rule — a change is a change to **both**.

---

## Setup

```bash
npm ci                 # not `npm install` — see below
npm run dev            # tsx server.ts -> http://localhost:3000
```

**Node 20, 22, or 24+.** Not 21 or 23: `vitest` declares `^20 || ^22 || >=24`, so the odd
lines fall outside the supported range despite being newer. Developed on 24.18.1.

**Use `npm ci`, not `npm install`.** `ci` installs exactly what the lockfile says and
fails if `package.json` and the lockfile disagree, which is a check nothing else performs.
`install` drifts: a measurement on 2026-08-28 found the working `node_modules` sitting
**14.64 MB above** what the lockfile specified.

**`npm run test:rules` needs Java** — the Firestore emulator is a JVM process. A JRE is
enough; no JDK, no admin.

### Optional, recommended once per clone

```bash
git config core.hooksPath .githooks
```

Git will not run hooks out of a tracked directory on its own, and this project
deliberately does not install them for you — the alternative is a dependency plus a
postinstall step, and a codebase whose entire dependency list is justified should not add
one to lint filenames. The hook blocks files over 1 MB, backup and archive extensions, OS
droppings, and what looks like a real API key assignment. Bypass a single commit with
`git commit --no-verify`.

---

## The checks

All seven, in the order CI runs them:

| Command | What it catches |
|---|---|
| `npm run lint` | `tsc --noEmit` under `strict`. There is no ESLint. |
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | dead locals and parameters, stricter than `tsconfig.json` |
| `npm run lint:encoding` | mojibake — the highest-blast-radius check here, see below |
| `npm test` | the unit suite — pure helpers, plus the two outbound calls that can hang |
| `npm run test:rules` | the security-rule suite, against the Firestore emulator |
| `npm run build` && `npm run check:size` | a broken import, and artifact-size regression |

**Every baseline is clean**, so anything any of them prints is yours.

This table deliberately does not say how many tests there are. `CLAUDE.md` is the
only place that number is written down, and it stays that way because copies of it
drift: this file carried "409 unit tests in 25 files" for a while after the suite
had moved on, which is worse than no number at all — a contributor trusts it and
concludes their run is broken. Run the suite if you want the count.

### The encoding check is not bureaucracy

Windows PowerShell 5.1 decodes files with the ANSI codepage, so a read-modify-write
through `Get-Content` / `Set-Content` turns every UTF-8 character into mojibake. This has
happened here: bulk edits corrupted **2,768 sequences** in `App.tsx`, and the API-key
banner shipped with a line of garbled Latin-1 in place of its em dash. It compiled. Every
test passed. It was visible only by looking at the rendered page.

(The corrupted byte sequences are quoted verbatim in `CLAUDE.md`, which is why that one
file is the sweep's single permanent exception. Do not reproduce them here — this file is
swept like any other.)

Never edit source with PowerShell's `Get-Content`/`Set-Content`. Use an editor, or
`[IO.File]::ReadAllText`/`WriteAllText` with an explicit `UTF8Encoding($false)`.

---

## Before you add anything

Before adding **any** file, dependency, config, tool, or editor extension, it must be

1. used by code that actually ships or actually runs, and
2. in the directory the conventions call for (see *Structure conventions* in `CLAUDE.md`).

If it fails either test it does not go in — not "temporarily", not "we'll clean it up
later". Leave it out; git will still have it if you committed it once and removed it.

**Never commit:** build output, caches, coverage, logs, profiling dumps, dependency
folders, backup or versioned copies (`*.bak`, `file 2.js`, `index-final-v3.ts`), personal
editor config, OS metadata, scratch scripts, one-off migrations, screenshots, archives,
database dumps, or large media that belongs in object storage.

**Never commit commented-out code.** Git remembers it. Delete it. (A 2026-08-28 sweep
found zero commented-out blocks in this repository — keep it that way.)

### Adding a dependency

Justify it in the PR: what it does, why nothing already here does it, its installed and
bundle size, its maintenance status, and what removing it later would take. If an existing
dependency covers the job, use that one.

The bar is real. A 2026-08-28 audit of all 26 dependencies found **nothing to remove** —
one library per job, no date library, no HTTP client (native `fetch`), no icon package
(the icons are inline SVG). Adding the 27th should feel like a decision.

---

## Removing things

- Delete dead code the moment it becomes dead. Do not leave it "just in case".
- Removing a feature means removing its code, tests, assets, config, routes, flags **and
  docs**. Grep for every trace.
- When a feature flag is fully rolled out or abandoned, collapse the branch and remove the
  flag in the same PR.

### Removing things: git is the safety net

There is no quarantine folder. One existed briefly and was retired — **git history is the
recovery mechanism this project actually uses**, and a second one needing three separate
enforcement mechanisms was not earning its keep.

- **`git rm` it.** Do not move it aside "for now"; a directory of files nobody polices is
  how the clutter comes back.
- **Leave a comment where it was**, naming the commit, if the removal is one somebody
  might reasonably want to undo — the way `src/lib/motion.ts` and
  `src/components/landing/icons.tsx` do.
- **Recovering:** `git show <commit>~1:<path>` for a file, `git log --diff-filter=D
  --name-only` to find every path ever deleted, `git log -S'<symbol>'` to find the commit
  that removed a given piece of code.
- **The exception that proves it:** a gitignored file has no copy in history, so deleting
  one is permanent. Check `git log -- <path>` returns something before you rely on this.

---

## Structure

- New code goes in the existing structure. A new **top-level directory needs a stated
  reason** — there are eight, down from ten, and the point is to keep it there.
- `src/lib` is browser code. `src/server` is not. `server.ts` is the only importer of the
  latter.
- `PascalCase.tsx` for components, `camelCase.ts` for everything else.
- Tests colocated as `*.test.ts`; `tests/` at the root is **only** for emulator tests, and
  that separation is what stops `npm test` starting a JVM.
- **No barrel files.** There is not one `index.ts` re-export here, and the benefit is
  measured: seven unused exports tree-shook to exactly zero bytes.
- `git mv` in a commit containing no other changes, so history survives.

---

## Definition of done

No new unused files, exports, dependencies or assets. No commented-out code. No new
top-level clutter. All six checks pass. If you changed something the documentation
describes, the documentation changed in the same PR.

---

## Quarterly hygiene

Not automated, because most of it needs judgement. Roughly every three months:

1. **`git gc --aggressive --prune=now`.** Safe, no history rewrite. Recovered **454 KB
   (8.5%)** on 2026-08-29.
2. **Skim `git log --diff-filter=D --name-only`** for anything deleted that should have
   been kept, or kept that should have been deleted. This replaced a quarantine manifest
   with retention dates; the log is the same information without a folder to maintain.
3. **`npx knip`** for unused files and exports. **Read its output, do not act on it**: it
   has no configuration for this project's second Vitest project, so it reports both rules
   test files and `@firebase/rules-unit-testing` as unused. They are not; removing them
   breaks 41 passing tests.
4. **`npm audit`.** Currently 5 moderate, all dev-only and unreachable. **Do not run
   `npm audit fix --force`** — npm's offered fix is a *major-version downgrade* of
   `firebase-tools`.
5. **`npm outdated`.** Upgrade deliberately, one major at a time, never as a side effect.
6. **Re-measure the bundle** with `npm run check:size` and tighten the budgets if the
   build shrank. A budget with slack in it is a budget that never fires.
7. **Check the fonts.** `index.html` loads three families and eleven weights, on the order
   of 150–250 KB — more than every image on the site combined. Which family/weight
   combinations are actually fetched has never been measured; it needs a network panel on
   a built page. This is the largest known unanswered question about the site's weight.

The 2026-08-28 cleanup that produced these rules is recorded in its commit messages —
32 commits merged as `f6046c1`, each stating what changed, what it was worth, and what was
verified. `git log 72214ab..f6046c1` is the record. (Twelve phase reports also existed
under `docs/cleanup/`; they were removed on 2026-08-29 and are recoverable from history
with `git show 9df8d32:docs/cleanup/09-results.md` or similar.)
