# Contributing to Forma

Short version: **run the checks, keep the tree small, and write down why.**

This file is the public-facing half of the project's conventions. The other half is
[`CLAUDE.md`](CLAUDE.md), which carries the constraints and incident history an agent or a
new contributor needs before touching anything. Where the two overlap — the Node floor,
the script list, the encoding rule — a change is a change to **both**.

`CLAUDE.md` now says this back: the bullet beginning **"`CONTRIBUTING.md` is the public
half of this file"**, in its *Read this first* section, names what this file duplicates and
which direction new material goes. It did not exist until 2026-09-01, and its absence had
the predictable effect — `CLAUDE.md`'s "a change to two files" warnings were counting
`README.md` and stopping, so this file quietly drifted. Read that bullet before moving a
rule between the two. The short version of it: **process here, reasoning in the
`docs/notes/` file that owns the area, session-wide constraints in `CLAUDE.md`.**

Three documents carry the check list — the table below, `README.md`'s script table, and
`CLAUDE.md`'s *Commands* block — so adding or renaming a script is a change to all three.

---

## Setup

```bash
npm ci                 # not `npm install` — see below
npm run dev            # tsx server.ts -> http://localhost:3000
```

**Node `^22.22.2 || ^24.15.0 || >=26`.** Not 20 (end of life on 2026-04-30), not 23 or 25,
and not an early 22 or 24: `jsdom` declares exactly that range and `vitest` declares
`^20 || ^22 || >=24`, so the floor is where the two meet. Developed on 24.21.0 / npm 11.19.0
(`node -v; npm -v` is the current answer).

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
one to lint filenames. The hook blocks files over 1 MB, backup and archive extensions, log
files, OS droppings, names that look like a manual copy (`copy`, `-final`, `_backup`,
`_deprecated`), and what looks like a real API key assignment. Bypass a single commit with
`git commit --no-verify`.

---

## The checks

All seven, in the order CI runs them. (CI runs two more things this table does not:
`npm ci`, which fails when `package.json` and `package-lock.json` disagree and which
nothing you can run locally performs, and `scripts/check-dist.mjs`, which holds the built
pages to the policy that will serve them. That second one can be run by hand after
`npm run build` and `npm start` (`node scripts/check-dist.mjs --server
http://127.0.0.1:3000/`), but it is not in this table, which is why
`.github/workflows/checks.yml` runs more than this table lists — the *Definition of done*
below says seven for the same reason.)

| Command | What it catches |
|---|---|
| `npm run lint` | `tsc --noEmit` under `strict`. There is no ESLint. |
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | dead locals and parameters, stricter than `tsconfig.json` |
| `npm run lint:encoding` | mojibake — the highest-blast-radius check here, see below |
| `npm run lint:links` | a relative link, or a section heading quoted in the docs, that no longer resolves |
| `npm test` | the unit suite — pure helpers, plus the two outbound calls that can hang |
| `npm run test:rules` | the security-rule suite, against the Firestore emulator |
| `npm run build` && `npm run check:size` | a broken import, and artifact-size regression |

**Every baseline is clean**, so anything any of them prints is yours.

Two more are deliberately not in that table. `npm run smoke` checks the *deployed* site
over the network, read-only, and `.github/workflows/live.yml` runs it every three hours; it says
nothing about your change, which is not deployed. And `npm run bench:fidelity` generates the
cases under `scripts/fidelity/cases` through the real pipeline with your own Gemini key
and scores what comes back; it spends quota and takes minutes, so it is a benchmark
rather than a check and runs by hand. **A change to the prompt, the model order, a
repair pass or `thinkingBudget` should quote its scorecard before and after in the
commit message.** *The fidelity benchmark* in `docs/notes/gemini.md` says what it
measures and why.

For one `.repx` on its own, `npx tsx scripts/repx.ts audit|repair|pdf <file.repx>` runs
Forma's audit, its repair chain or a draft PDF from the command line, with no browser and
no key; `audit` exits 1 on an error. It is a tool for working on a report, not one of the
checks, and [`docs/skills/devexpress-repx/SKILL.md`](docs/skills/devexpress-repx/SKILL.md)
says what each finding and repair means.

This table deliberately does not say how many tests there are.
[`docs/notes/testing.md`](docs/notes/testing.md) is the only place that number is
written down, and it stays that way because copies of it drift: this file carried
"409 unit tests in 25 files" for a while after the suite had moved on, which is worse
than no number at all — a contributor trusts it and concludes their run is broken. Run
the suite if you want the count.

(This paragraph said `CLAUDE.md` until 2026-09-08. That was true until the test
inventory was carved out into `testing.md` on 2026-09-06, and `CLAUDE.md` now carries
no count at all — so the pointer sent you to a file that would not answer, which is the
one failure mode worse than a stale number. Same lesson as the paragraph itself.)

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

**One narrow exception, added 2026-09-01: images the committed documentation links to
live in [`docs/media/`](docs/media/).** The README needs a screenshot to be worth
reading, and a front door pointing at an image nobody may commit is a rule that cannot
be followed. The exception covers that case only — a debugging capture, a scratch
recording, or a screenshot you pasted into a PR thread is still none of the
repository's business. `docs/media/README.md` carries the size and format rules.

**Never commit commented-out code.** Git remembers it. Delete it. (A 2026-08-28 sweep
found zero commented-out blocks in this repository — keep it that way.)

### Adding a dependency

Justify it in the PR: what it does, why nothing already here does it, its installed and
bundle size, its maintenance status, and what removing it later would take. If an existing
dependency covers the job, use that one.

The bar is real. A 2026-08-28 audit of all 26 dependencies declared at the time found
**nothing to remove** — one library per job, no date library, no HTTP client (native `fetch`), no icon
package (the icons are inline SVG). More have arrived since, each for a job nothing here
did (the first two together: `7d1984a` added `compression` and its `@types/` package to
stop serving responses at three and a half times their size). Adding the next should feel
like a decision. Count them (`npm pkg get dependencies devDependencies`) rather than
trusting a number written here — nothing in the toolchain checks one, and
`git show <commit>:package.json` settles when one appeared.

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
  reason** — there are **ten** tracked, and the point is to keep it there. Check with
  `git ls-tree --name-only -d HEAD`, which is the whole verification. (This line said
  "eight, down from ten" until 2026-09-01, which matched no commit in either number;
  `CLAUDE.md` carried the same wrong pair, corrected itself, and this copy was missed.)
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
top-level clutter. All seven checks pass. If you changed something the documentation
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
   has no configuration for this project's second Vitest project, so it reports the
   rules test files under `tests/` and `@firebase/rules-unit-testing` as unused. They are
   not; removing them breaks the whole rules suite.
4. **`npm audit`**, read beside `comment:not-overridden` in `package.json`, which names
   what it still reports and why none of it ships (Firestore's Node.js transport and parts
   of `firebase-tools`, neither of which is in `dist/`). A finding that comment does not
   name is new and is yours to read. **Do not run `npm audit fix --force`** — npm's offered
   fix is a *major-version downgrade* of `firebase-tools`.
5. **`npm outdated`.** Upgrade deliberately, one major at a time, never as a side effect.
6. **Re-measure the bundle** with `npm run check:size` and tighten the budgets if the
   build shrank. A budget with slack in it is a budget that never fires.
7. **Check the font weight ranges still match what paints.** This item used to say
   `index.html` loaded three families and eleven weights from Google and that nobody had
   measured which were used, calling it the largest unanswered question about the site's
   weight. **It has been answered.** `index.html` now loads no font at all — the Material
   Symbols stylesheet went on 2026-08-27 and the Google Fonts links on 2026-08-30, both
   under audit PERF-002 — and the three families are self-hosted from `src/fonts/` as six
   variable `woff2` subsets totalling 230,672 B, each capped individually by
   `npm run check:size` and counted in its `dist/` total. So the bytes are now measured on
   every build rather than once a quarter. What is left is a judgement call the budget
   cannot make: the `font-weight` ranges in `src/index.css` are deliberately narrow, so a
   new `font-thin` or `font-black` somewhere renders in a weight nobody designed for.
   Widening a range costs no bytes on a variable face, which is exactly why the ranges have
   to be kept honest by hand. **Do not widen one without checking something paints it, and
   do not narrow one without checking nothing does.** The method is recorded in the
   typefaces comment above the `@font-face` block in `src/index.css`; commits `bb07957` and
   `887358a` carry the original measurement, which found faux-bold synthesis on 22 elements
   across five pages.

The 2026-08-28 cleanup that produced these rules is recorded in its commit messages —
32 commits merged as `9a8163c`, each stating what changed, what it was worth, and what was
verified. `git log 2ce6e56..9a8163c` is the record. (Twelve phase reports also existed
under `docs/cleanup/`; they were removed on 2026-08-29 and are recoverable from history
with `git show 7b7de66:docs/cleanup/09-results.md` or similar.)
