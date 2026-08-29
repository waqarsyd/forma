# Phase 8 - Git history weight

Date: 2026-08-29
Branch: `chore/cleanup`

**Recommendation: do not rewrite history.** Not "not yet" - the numbers say there is
nothing worth rewriting it for, and they are not close.

**No rewrite was run.** One safe, non-rewriting operation *was* run - `git gc
--aggressive --prune=now`, which the prompt explicitly asks to report on - and it
recovered **more than four times what a full history rewrite could have targeted.**

---

## 8.1 The object store

```
$ git count-objects -vH          (before gc)
count: 27
size: 68.50 KiB
in-pack: 1128
packs: 2
size-pack: 4.98 MiB
```

556 blobs, **20.72 MB uncompressed**, packed into 4.98 MiB. That ~4:1 ratio is the first
thing worth noticing: this repository's history is overwhelmingly text that
delta-compresses extremely well.

## 8.2 The largest blobs, and why "largest" is the wrong question

| Bytes | Path |
|---|---|
| 2,984,020 | `assets/source/logo_white.png` |
| 539,491 | `package-lock.json` |
| 538,541 | `package-lock.json` |
| 534,033 | `package-lock.json` |
| 533,606 | `package-lock.json` |
| 530,905 | `package-lock.json` |
| 530,473 | `package-lock.json` |
| 295,261 | `assets/source/logo.png` |
| ~192,000 ↓ | `src/App.tsx` × 17 further entries |

Reading that table naively suggests 3.2 MB of `package-lock.json` and 3 MB of `App.tsx`
are bloating the repository. **They are not.** Six near-identical 530 KB JSON files
delta-compress to approximately one of them plus five small diffs, which is the entire
purpose of a packfile.

The single largest blob, `assets/source/logo_white.png` at 2.98 MB, exists **once** and
is **still in HEAD** - Phase 6 decided to keep it, and §6.4 recorded that re-encoding it
would *add* a blob rather than replace one.

## 8.3 The number that actually matters

Splitting every blob by whether HEAD still references it:

| Category | Blobs | Uncompressed |
|---|---|---|
| Reachable from HEAD | 222 | 5.85 MB |
| **Prior revisions of files that are still in HEAD** | **323** | **14.76 MB** |
| **Blobs whose path is gone from HEAD entirely** | **11** | **120.06 KB** |

The middle row is not waste. **It is version control.** Those 14.76 MB are what
`git log -p src/App.tsx` and `git blame` are made of:

| Prior revisions | File |
|---|---|
| 33 (5.54 MB) | `src/App.tsx` |
| 52 (2.48 MB) | `CLAUDE.md` |
| 5 (2.67 MB) | `package-lock.json` |
| 12 (0.67 MB) | `docs/notes/app-shell.md` |

`CLAUDE.md` has been revised **52 times** - more often than any source file in the
project, `App.tsx` included. That is a fact about how this repository works, not a
defect, and any rewrite that "reclaimed" it would be deleting the documentation's own
history.

**So the honest target for a history rewrite is the last row: 120.06 KB across 11
blobs.** Uncompressed. In a 4.98 MiB pack.

<details>
<summary>All 11, in full</summary>

```
27,433 B  audit/07-implementation.md          ← pre-move path (Phase 7)
20,247 B  PRD.md                              ← pre-move path (moved to docs/ long ago)
15,653 B  cleanup/07-restructure-proposal.md  ← pre-move path
14,532 B  cleanup/03-duplicates.md            ← pre-move path
13,528 B  cleanup/04-dead-code.md             ← pre-move path
13,504 B  cleanup/05-dependencies.md          ← pre-move path
10,919 B  cleanup/06-assets.md                ← pre-move path
 5,901 B  _not_required/.agents/skills/xcode_project_setup/SKILL.md
   825 B  _not_required/firebase-blueprint.json
   212 B  .vscode/launch.json
   184 B  _not_required/metadata.json
```

Seven of the eleven are documents **this cleanup itself** moved or edited. Three are the
files Phase 1 untracked; one is the launch config Phase 2 retired. There is no
accidentally-committed video, no leaked archive, no `node_modules` in the history of this
repository. Phase 2 reached the same conclusion from the other direction and this
confirms it with the blob-level numbers.
</details>

## 8.4 What `git gc --aggressive --prune=now` recovered - measured

Safe, no rewrite, no SHA changes. Checked first that it could not destroy anything:

```
$ git fsck --unreachable    → none, every object is reachable from a ref
$ git fsck --dangling       → none
```

With nothing unreachable, `--prune=now` had nothing to prune; the entire gain is
**repacking**. Two packs plus 27 loose objects became one pack:

| | Before | After |
|---|---|---|
| `.git/` on disk | 5.236 MB | **4.792 MB** |
| `size-pack` | 4.98 MiB | 4.63 MiB |
| packs | 2 | 1 |
| loose objects | 27 (68.50 KiB) | 0 |

**−454.4 KB, −8.47%, in 2.9 seconds.**

Integrity confirmed afterwards: `git fsck` exit 0 with no output, 145 commits reachable,
223 tracked files, 35 branches intact, working tree unchanged, and the unit suite still
409 passing.

## 8.5 The comparison that decides it

| Option | Recovers | Cost |
|---|---|---|
| `git gc --aggressive --prune=now` | **454.4 KB, measured** | 2.9 seconds. Nothing else. |
| Full history rewrite (git-filter-repo / BFG) | **≤120 KB uncompressed**, and far less after packing | Every commit SHA changes |

**The safe operation recovers roughly four times what the dangerous one could**, and the
dangerous one's ceiling is an over-estimate: those 120 KB are text that would
delta-compress against their surviving successors anyway, so the real packed saving is a
fraction of it.

### What a rewrite would actually cost here

Stated plainly, because the recommendation should be understood rather than trusted:

- **Every commit SHA changes.** All 145.
- **All 35 branches break.** The 33 `audit/*` branches are merged, but their commits
  would no longer exist under those hashes; every one would need re-creating or deleting.
- **Every clone must be re-cloned.** There is currently one, on this machine.
- **Every SHA cited anywhere becomes a dead reference.** `CLAUDE.md` cites `3f8b5aa`,
  `e88db4c`, `566d3f7`, `fbb0b3d` and `c0e9c51`; `docs/notes/` and the ten `docs/audit/`
  reports cite more; the eight `docs/cleanup/` reports cite roughly forty between them,
  including every commit made during this pass. **A rewrite would invalidate the
  evidence trail this entire cleanup was written to leave.**

The mitigating circumstance usually cited for a rewrite - no remote, no collaborators, a
single clone - is genuinely true here and would make it unusually cheap. It is still not
worth 120 KB.

## 8.6 If the answer were ever different

The one thing that could change this calculus is `assets/source/logo_white.png` at
2.98 MB - **50% of the packed repository in a single blob.** Phase 6 decided to keep it,
and that decision is where the size lives.

Two things worth writing down so the arithmetic is not re-derived incorrectly later:

1. **Removing it from HEAD would not shrink a clone.** The blob stays in history. Only a
   rewrite reclaims it - which is the whole point of this phase.
2. **Optimising it would make the repository larger.** Phase 6 measured a lossless
   re-encode at 1,981,386 B; committing that *adds* a blob while the 2.98 MB original
   stays reachable. Net effect on a clone: **+1.98 MB.**

So if the 3 MB ever genuinely matters - it does not today, at a 4.63 MiB total - the
sequence is: decide the masters do not belong in git at all, move them to object storage,
*and* rewrite history to drop the blob. All three, or none. Doing only the first two
costs effort and saves nothing.

## 8.7 Recommendation

**Do not rewrite history.** The gc has already recovered four times more, safely, and is
worth re-running occasionally - it is now in the Phase 10 guardrail list as a quarterly
item rather than a one-off.
