<!--
  Keep this short. The commit message is where the reasoning belongs — this
  repository leans on `git log` as its record, and several decisions in the
  source cite a commit by hash rather than a document.
-->

## What this changes, and why

<!-- The why matters more than the what. A diff shows what changed. -->

## Checks

All six are documented in CONTRIBUTING.md. Run them locally — CI runs the same
ones, and `npm ci` there will also fail if `package.json` and the lockfile
disagree.

- [ ] `npm run lint` — clean baseline, so anything it prints is yours
- [ ] `npm run lint:encoding` — mojibake; the highest-blast-radius check here
- [ ] `npm test`
- [ ] `npm run test:rules` — only if you touched `firestore.rules` (needs Java)
- [ ] `npm run build && npm run check:size` — only if you touched the bundle

## If you changed one of these, say so

- [ ] **A number that appears in the app's own copy.** The marketing and docs
      pages quote real figures — attachment and page caps, the DevExpress version
      list, page sizes, units. They are read out of the code and go stale
      silently.
- [ ] **The test count.** `CLAUDE.md` is the only place it is written down, and
      the per-file numbers must still sum to the total.
- [ ] **A file under `src/lib` or `src/services`.** `README.md`'s project-structure
      block lists them and is the only copy of that layout.
- [ ] **A unit conversion.** `src/lib/reportGeometry.ts` is the only place one may
      be written. A mismatch renders a plausible layout in the wrong place and
      never throws.
- [ ] **Something you removed.** Leave a comment naming the commit it can be
      recovered from. Git history is this project's recovery mechanism.

## Anything you could not verify

<!--
  Say it plainly rather than leaving it implied. "I could not test the designer
  hand-off, no DevExpress install" is a useful sentence and costs nothing.
-->
