/**
 * Fail if a build artifact grows past its budget.
 *
 * This exists because of a defect that every other check in this project missed.
 * `src/index.css` had a bare `@import "tailwindcss"`, so Tailwind scanned all 110
 * markdown files and generated real utilities from class names quoted in prose --
 * `.bg-user-msg` was shipping to every visitor because a cleanup report contained
 * the sentence explaining that the token was dead. tsc was clean, 409 tests
 * passed, the build succeeded, and the stylesheet quietly grew. Nothing was
 * watching the size, so nothing said so.
 *
 * The budgets below are set from the 2026-08-29 build with a deliberately small
 * headroom. They are meant to be *tight enough to trip*: a budget with 50% slack
 * is a budget that never fires, and the failure this catches was 1.1% of one file.
 *
 * When a budget legitimately needs raising, raise it in the same commit as the
 * change that needs it and say why in the message. A budget bumped in its own
 * commit, with no explanation, is how this check stops meaning anything.
 *
 * There is one standing exception, and it is the other way a budget stops
 * meaning anything: a cap that has crept up to ~99% of its artifact trips on the
 * next routine change, and what that teaches is to raise the number without
 * reading it. Retuning such a cap on its own is legitimate -- it is maintenance
 * of the check, not an excuse for a regression -- provided the comment says what
 * it measured and why the new number is where it is. See TOTAL_MAX, retuned this
 * way on 2026-09-05. The test of the difference is simple: a raise made because
 * something grew names the growth; a retune names the percentage.
 *
 * That test has one gap, found on 2026-09-06 and written up on the geminiService-
 * cap below: growth that stays UNDER a budget is invisible until it is nearly over
 * it, so a cap can arrive at 97% with real growth behind it and no single commit to
 * name. Both categories then apply at once. The habit that catches it earlier is
 * reading the percentages on a GREEN run -- a passing check says nothing about how
 * nearly it failed, and `--print` exists for exactly that.
 *
 * And when you do sweep the percentages, sort the caps into two kinds first --
 * learned on 2026-09-06, doing exactly that. Caps on artifacts THIS SOURCE can
 * move (index-, geminiService-, index.css, TOTAL_MAX) earn the 93-94% band,
 * because routine work pushes them and a tight cap is what makes them useful.
 * Caps on VENDORED artifacts do not: pdf.worker- at 96.6%, pdf- at 95.2%,
 * firebase- at 93.8% and the woff2 files move only when a dependency or a font is
 * deliberately upgraded -- both pdf artifacts were byte-identical across the
 * 111 kB build diff recorded under TOTAL_MAX. Nothing routine can trip them, so
 * their percentages carry no warning, and when one DOES fire the firing is the
 * whole point. Leave those where they sit. A sweep that raises them is doing the
 * precise thing this file exists to prevent: raising a number instead of reading
 * it.
 *
 * Usage:  node scripts/check-bundle-size.mjs        (exit 1 on any breach)
 *         node scripts/check-bundle-size.mjs --print (report only, exit 0)
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DIST = 'dist';
const PRINT_ONLY = process.argv.includes('--print');

/**
 * Matched as a prefix against the filename, because Vite fingerprints every
 * chunk. `index-` matched the eager entry chunk *and* the lazily loaded genai
 * chunk, both budgeted by the entry's number, until 2026-11-11, when the genai
 * chunk was named (TC-10) and given a budget of its own. A prefix matches in
 * every folder of dist/ and every budget is applied, not the first match, so
 * a new prefix must not be the start of any other file's name.
 *
 * Retuned together on 2026-11-12, for Vite 8 (owner decision 18), a retune
 * naming each percentage. Vite 8 bundles with Rolldown and minifies with Oxc
 * where Vite 6 used Rollup and esbuild, which moved every chunk at once with no
 * change in what it holds, and mostly down: the same source came out 313 kB
 * smaller (dist/ total 6,709,090 -> 6,395,508). A cap left where it was would
 * keep that as headroom and could not fire, so each cap that moved three points
 * or more, or tripped, is set back to the percentage it held under Vite 6:
 * index- 328,835 -> 302,992 B, 322_500 (93.9%); gemini-sdk- 278,414 -> 256,349,
 * 273_000 (93.9%); ocr-engine- 15,829 -> 17,252, 18_500 (93.3%), Rolldown's
 * CommonJS interop for tesseract.js; ReportPreview- 99,789 -> 96,629, 102_500
 * (94.3%); DocsPage- 79,537 -> 81,521, 86_500 (94.2%), out of the 99.4% it had
 * crept to; reportPreview- 64,865 -> 61,825, 66_000 (93.7%); FeaturesPage-
 * 45,392 -> 46,243, 49_000 (94.4%), out of 96.6%; geminiService- 129,299 ->
 * 124,894, 133_000 (93.9%); pdf- 501,336 -> 444,231, 468_000 (94.9%); firebase-
 * 172,964 -> 107,168, 112_000 (95.7%); firestore- 449,408 -> 346,913, 369_000
 * (94.0%); transformers.web 890,205 -> 836,276 in a FORMA_HANDWRITING=1 build,
 * 890_000 (94.0%). The rest moved less than three points and stay. The eager
 * total below is new with the same change: Rolldown split the entry.
 */
const BUDGETS = [
  // Lowered from 1,160,000 on 2026-09-01, when Firebase was deferred behind
  // lib/firebaseClient.ts and the entry chunk fell from 1,121,920 B to 619,380 B
  // -- 502,540 B, 45% of it, off the critical path. A cap left at 1,160,000
  // would have had 87% headroom and could never fire again, which is the failure
  // this whole script exists to prevent. Tightened to sit just above the new
  // measurement instead.
  // Lowered again from 660_000 on 2026-09-04, when services/geminiService.ts was
  // deferred behind lib/geminiClient.ts and the entry chunk fell from 649,111 B
  // to 588,368 B -- 60,743 B, including 19,615 B of mega-prompt that every
  // visitor to the landing page was downloading to read marketing copy. Left at
  // 660_000 the cap would have had 11% headroom against a chunk that had just
  // shrunk by 9%, which is the same "can never fire again" failure the
  // 2026-09-01 entry applies. Tightened to sit just above the new measurement,
  // exactly as that one was.
  //
  // 625_000 rather than 600_000, which was tried first and is the mistake this
  // whole file is about: it put the chunk at 98.1%, so the next routine change
  // would have tripped a size check for no reason and taught someone to raise
  // the number instead of reading it. 588,368 against 625_000 is 94.1%, which is
  // where the 2026-09-01 cap and the firebase- cap both sit. Tight enough to
  // trip on a regression, loose enough that only a regression trips it.
  //
  // Raised to 655_000 on 2026-10-30. It did not trip, and both of the header's
  // categories apply. The growth this commit names is +6,152 B, 607,333 ->
  // 613,485, for parity row 30. `lib/repxCrossTabs.ts` is on the eager path
  // because `repxAudit` imports it to find cross-tabs DevExpress cannot print,
  // and `App.tsx` imports `repxAudit` statically for the status bar. The
  // percentage is 98.2%, the state the header says to retune out of, reached
  // by growth that fitted in silence: 588,368 -> 607,333 B since the cap was
  // set on 2026-09-04, across eight weeks of features not attributed here.
  // 655_000 puts it at 93.7%. Every landing-page visitor pays for this chunk,
  // so the next real cut belongs here: the audit, or the Preview engine
  // behind it, deferred the way geminiService was.
  //
  // Raised to 696_000 on 2026-11-02, at 654,018 B (99.9%) without tripping,
  // for Forma's own model and what came with it (docs/proposals/own-model.md):
  // 649,394 -> 654,018, +4,624 B over the day.
  //   +1,682  the chat box's offline branch, designOffline, which has to be
  //           in App.tsx because it is the send handler's
  //   +1,713  the provider gate (aiReady), its settings kept and read at
  //           start-up, and the lazy settings panels registered
  //   +1,229  memory: a "remember" message kept, kept reports' style
  //           recorded, remembered preferences passed to a generation
  // Each feature's body (the generator, the model, the adapter, the panels,
  // memory) is in lazy chunks; these are the call sites. 696_000 is 94.0%,
  // the band this file keeps, and the cut named above is still owed.
  //
  // Lowered to 672_000 on 2026-11-04, when the cut was made: App.tsx loads
  // repxAudit on demand (its REPX-pane box, the batch run and the repair loop
  // all wait for a result anyway), and the audit with the cross-tab, layout
  // and accessibility checks it imports left the entry chunk. 663,826 ->
  // 631,562 B, -32,264, and repxAudit-*.js is 29,347 B of its own. Left at
  // 696_000 the cap would sit at 90.7% with room to hide a regression;
  // 672_000 puts it at 94.0%.
  //
  // Left at 672_000 on 2026-11-05, and cut under rather than raised. It had
  // reached 660,284 B (98.3%) without tripping: 631,562 -> 646,183 B across
  // the sidebar, settings and token-saving work of 2026-11-04 and -05, then
  // -> 660,284, +14,101 B, for the chat's agent features the same day (Stop
  // on a reply, Markdown, reply actions, saving on its own, the edits, tools,
  // selection and versions; each body is lazy, these were App's call sites).
  // The cut: ChatThread and Composer, which only the workspace shows, load
  // on demand from App.tsx, -13,264 B to 647,020 B (96.3%). Still above the
  // 93-94% band; the next cut is the same kind, more of the workspace out of
  // what every landing-page visitor downloads.
  //
  // Cut under again on 2026-11-06, at 664,823 B (98.9%) after Stitch's command
  // menu, right-click menu, zoom field and clean screen (each body lazy, these
  // were App's call sites). The cut was that kind: the Mockup (ReportMockup
  // and its table, chart and picture helpers) and the REPX pane (RepxViewer)
  // were components defined inside App.tsx; they are now their own lazy
  // files, -13,496 B to 651,327 B (96.9%), and App.tsx is ~700 lines shorter.
  //
  // Lowered to 582_000 on 2026-11-07, when the cut this comment kept naming
  // was found and made. At 659,539 B (98.1%) after the agent audit's batches
  // A to C, a source-mapped build attributed 54,228 B of the chunk to
  // reportPreview.ts and some 65 kB more to what it reads (criteria,
  // textMeasure, reportData, netFormat, repxEdit, repxCrossTabs, pictureBox):
  // the whole Preview engine, on the landing page. One line put it there:
  // repxBindingPlan.ts, which App imports for its first render, imported
  // escapeXmlAttribute from repxEdit.ts, which imports reportPreview. The
  // helper now has a module of its own (lib/xmlEscape.ts), and the chunk is
  // 547,264 B, -112,275 (-17%), the total unchanged. 582_000 is 94.0%.
  //
  // Lowered to 446_000 on 2026-11-08 (the site audit's batch SG, item 42),
  // when the public pages stopped loading the workspace: main.tsx draws them
  // from PublicSite.tsx and loads App.tsx only on /workspace. At 567,446 B
  // (97.5%) before, 419,174 B after, -148,272 (-26%); what is left is React,
  // motion and the home page. 446_000 is 94.0%, so the workspace creeping
  // back into the entry trips it. (The genai chunk shared the prefix then,
  // at 278 kB under it, until the change below.)
  //
  // Lowered to 412_000 on 2026-11-11 (the full audit's TC-10), when the genai
  // and tesseract chunks were named in vite.config.ts and stopped sharing this
  // prefix: it watches the entry alone now, 387,396 B in the build of
  // 2026-11-11 19:47 (wave 10's merge). 446_000 would leave it at 86.9%, room
  // to hide a regression; 412_000 is 94.0%.
  //
  // Lowered to 318_000 on 2026-11-12 (owner decision 18), when the home page
  // left the entry and joined the lazy public pages (publicPages.tsx,
  // `HomePage`), taking the header, footer, icons and menus only it had pulled
  // in: 388,437 -> 298,570 B, -89,867. Its head preloads its chunk beside the
  // entry. 412_000 would sit at 72.5%; 318_000 is 93.9%. React 19.3 and motion
  // 12.43, which this cut made room for, come in the next commit with their own
  // readout.
  //
  // Raised to 350_000 the same day, for exactly that: 298,570 -> 328,835 B,
  // +30,265. A source-mapped build puts react-dom at 209,766 B of it (+28,875
  // on 19.2.4's 180,891), motion-dom +717, react +323, scheduler +54. Still
  // 59,602 B under 1.6.0's entry. 350_000 is 94.0%.
  //
  // Retuned to 322_500 the same day for Vite 8 (the paragraph above BUDGETS):
  // 302,992 B, 93.9%. Since Vite 8 this is the entry file alone; what it
  // imports statically has its own budget, the eager total.
  //
  // Raised to 334_500 the same day for motion 12.43 -> 14.13 (the majors the
  // owner asked finished beyond decision 18): 302,992 -> 314,336 B, +11,344,
  // motion's DOM animation features growing in the entry. No fix this app
  // needed came with it; taken to stay current, with the entry still 74 kB
  // under 1.6.0's. 94.0%.
  { prefix: 'index-', ext: '.js', max: 334_500, note: 'eager entry chunk (the public site)' },
  /*
   * The Gemini SDK and tesseract.js, named chunks since 2026-11-11 (TC-10;
   * chunkFileNames in vite.config.ts), each loaded only when a request or a
   * picture needs it. Measured as index-*.js in the same 19:47 build:
   * 278,415 B and 15,829 B. Vendored, so they move with an upgrade
   * (@google/genai 3 is Owner decision 18), and 296_000 is 94.1%; 17_000 is
   * 93.1%.
   *
   * Every budget here applies to every file whose name it matches, anywhere
   * in dist/, so a prefix must be one no other file starts with. The first
   * draft named the OCR chunk `tesseract-`, which the three
   * tesseract-core-*.wasm.js builds in dist/ocr/ (about 3.9 MB each) also
   * start with: three breaches of a 17 kB cap on every build.
   */
  // Raised to 424_000 on 2026-11-12 for @google/genai 1.45 -> 3.2.0 (owner
  // decision 18, taken on its before/after benchmark): 256,349 -> 398,411 B
  // (+142,062; gzip 51.73 -> 74.79 kB), all of it the SDK's own single web
  // bundle (dist/web/index.mjs, 389,778 B), so nothing to leave out. Loaded
  // with a person's first request, never by the public pages. 94.0%.
  { prefix: 'gemini-sdk-', ext: '.js', max: 424_000, note: '@google/genai, lazy, loaded with the first request' },
  { prefix: 'ocr-engine-', ext: '.js', max: 18_500, note: 'tesseract.js, lazy, loaded with the first picture' },
  /*
   * The six largest route and pane chunks, unbudgeted until 2026-11-11 (TC-10):
   * each grew with no number watching it. Measured in the 19:47 build above
   * and set at 94%, the band this file keeps. Case matters: `ReportPreview-`
   * is the Preview pane's component, `reportPreview-` the engine it draws with.
   */
  { prefix: 'ReportPreview-', ext: '.js', max: 102_500, note: 'the Preview pane, lazy (96,629 B at 94.3%, Vite 8)' },
  { prefix: 'DocsPage-', ext: '.js', max: 86_500, note: 'the Docs page, lazy (81,521 B at 94.2%, Vite 8)' },
  { prefix: 'reportPreview-', ext: '.js', max: 66_000, note: 'the Preview engine, lazy (61,825 B at 93.7%, Vite 8)' },
  // Raised to 55,500 on 2026-11-12, at 51,921 B (102.8%): the 1.6.0 entry, the full audit's release note, in a visitor's words (DOCS, dc85c04). 93.6%.
  { prefix: 'releases-', ext: '.js', max: 55_500, note: 'the changelog and What\'s new, lazy (51,921 B at 93.6%)' },
  { prefix: 'FeaturesPage-', ext: '.js', max: 49_000, note: 'the Features page, lazy (46,243 B at 94.4%, Vite 8)' },
  { prefix: 'DatabasePanel-', ext: '.js', max: 37_700, note: 'the Data tab\'s database, lazy (35,468 B at 94.1%)' },
  // The workspace itself (2026-11-08), lazy since the cut above, budgeted so
  // it is watched like the rest: 143,209 B, 152_500 is 93.9%.
  // Raised to 159_000 the same day, at 149,354 B (97.9%): the site audit's
  // batches SH and SI put the projects index and its reconciliation, the
  // export of every project, the key's hand-off to a new tab and an error
  // boundary around each area into the workspace. 159_000 is 93.9%.
  // Raised to 168_500 on 2026-11-10, a RAISE naming the growth, tripped at
  // 159,464 B: the AI accuracy programme put +9,324 B into the workspace
  // since 149,354 B, under the cap until batch AG. Measured per batch: AF's
  // free chain across providers and the page reader +1,698 B (153,462 ->
  // 155,160), AG's facts route, docs, plan and batch hand-over +4,304 B to
  // 159,464, cut to 158,678 by moving the plan's files, the kept batch's
  // result and the docs lookup into their lazy modules (jobPlan.ts,
  // batchCheckpoint.ts, docsKnowledge.ts); AB to AE's model choice, page
  // resolution, OCR stages and coverage readout the rest, not attributed.
  // 168_500 is 94.2%.
  { prefix: 'App-', ext: '.js', max: 168_500, note: 'the workspace, loaded on /workspace' },
  /*
   * The generation service, lazy as of 2026-09-04.
   *
   * Budgeted because it is almost entirely one template literal, and prompt text
   * is the thing in this repository most likely to grow without anyone noticing:
   * every fidelity fix so far has added prose to it, and nothing else measures
   * it. The other direction -- the whole service silently returning to the eager
   * path, which is what a value import in App.tsx would do -- does not show up
   * here. It shows up as the entry chunk jumping ~61 kB against the cap above.
   */
  // Raised from 70_000 on 2026-09-05, and this is the case the budget was put
  // here for: the chunk is almost entirely one template literal, and it grew
  // 63,492 -> 70,651 B when the prompt gained a GROUPING section and a
  // PARAMETERS section. Two features, ~7.2 kB of instruction, and nothing else
  // in the build would have said so.
  //
  // 75_000 puts it at 94.2%, where the index- and firebase- caps sit. This is a
  // raise, not a retune, so per the header it names the growth: grouping and
  // parameters, in the commit that added them.
  //
  // Raised again to 78_000 on 2026-09-05, same day, same reason, one feature
  // later: 70,651 -> 73,565 B, +2,914 B, when `7e756f9` added the CHARTS AND
  // CROSS-TABS section. That is 39 lines of prompt asking for a real `XRChart`
  // and `XRCrossTab` instead of a picture of one. 78_000 puts it back at 94.3%.
  //
  // **The growth is not in this file's own module, and that is worth knowing
  // before hunting it.** `geminiService.ts` imports `rootStructurePrompt` from
  // `lib/reportBands.ts`, and every prompt section since the banded skeleton has
  // been added there -- so the chunk this cap watches grows from a file whose
  // name does not appear in the artifact list. Three raises in two days is not
  // drift: the mega-prompt is where features are specified, so a cap on it fires
  // roughly once per feature. If it ever fires without a prompt change behind
  // it, that is the interesting case and the one this budget is really for.
  //
  // And again to 81_000 the same day: 73,565 -> 75,740 B, +2,175 B, for the
  // XRCheckBox and cross-band-control sections. That is the third raise in one
  // day and the fourth overall, which is the cadence the paragraph above
  // predicts rather than a sign of anything wrong -- each one names a feature.
  // 81_000 puts it at 93.5%.
  //
  // Raised to 85_000 on 2026-09-05, and this is the case the paragraph above
  // called "the interesting one": it fired WITHOUT a prompt change behind it.
  // 76,751 -> 79,327 B, +2,576 B, and the cause is `lib/repxStyles.ts` -- a new
  // module the service imports, so genuinely new code rather than more
  // instruction text. Checked before raising: the prompt itself got SHORTER in
  // the same session (the flat fallback went, and the optional sections are now
  // conditional), so the two movements are unrelated and both are intended.
  //
  // Worth knowing for next time: this cap now watches a chunk that grows from
  // three separate places -- `geminiService.ts`, `lib/reportBands.ts` (the
  // prompt), and any pure module the service imports for an output pass. A raise
  // should say which. 85_000 puts it at 93.3%.
  //
  // Retuned to 90_000 on 2026-09-05 -- a RETUNE, so per the header it names the
  // percentage rather than a growth: 83,134 B is 97.8% of 85,000, close enough
  // to the ~99% the header warns about that the next routine edit trips it, and
  // what that teaches is to raise the number without reading it.
  //
  // Worth recording because it corrects an expectation set earlier the same
  // day. Splitting the containers block into four was expected to relieve this
  // cap and did the opposite: 82,818 -> 83,134 B, because four constants and
  // four conditional interpolations cost slightly more than one of each. **That
  // split buys per-REQUEST prompt size, not bundle size** -- a .repx with only a
  // checkbox now sends 921 bytes of that block instead of 5,074. The two
  // measurements move independently and confusing them is easy: this chunk holds
  // every block whether or not a given request sends it.
  //
  // Raised to 95_000 on 2026-09-05, naming the growth: 83,134 -> 88,340 B across
  // the conditional-formatting, calculated-field, sorting and watermark blocks,
  // roughly 1.3 kB of instruction text each. 95_000 puts it at 93.0%.
  //
  // **Six movements on this cap in one day is the honest shape of the work, not
  // drift.** Each names a feature. What would be worth stopping for is a raise
  // with no feature behind it -- and one nearly happened: the containers split
  // moved this number without adding anything, which is why that entry says so
  // explicitly. Read the reason before the number.
  //
  // Raised to 100_000 on 2026-09-05, naming the growth: 88,340 -> 93,874 B for
  // the multi-column, bookmark and gauge/sparkline blocks. 100_000 puts it at
  // 93.9%.
  //
  // **This cap has moved eight times in one day and that is worth reading, not
  // just counting.** Every move but one names a feature; the exception is the
  // containers split, which is flagged above as the case worth stopping for.
  // The prompt grows once per feature because the prompt is where features are
  // specified — so the number tracking it grows too, and a cap that never moved
  // would mean nothing had shipped. The signal to act on is a move with no
  // reason beside it.
  //
  // Retuned to 104_000 on 2026-09-06, and this one does not fit the header's two
  // categories cleanly, which is the part worth recording.
  //
  // It names the percentage, as a retune must: 97,274 B is 97.3% of 100,000,
  // which is the state the header rejects — a cap the next routine change trips
  // teaches whoever meets it to raise the number rather than read it.
  //
  // But there IS growth behind it, and the growth never tripped anything.
  // 93,874 -> 97,274 B, +3,400 B over four commits since the gauge raise: the
  // table-of-contents section (`ebb620c`), the character-comb section
  // (`0dc38f7`) and the XRPdfContent refusal (`a6d9dec`), plus two near-neutral
  // rewrites of the multi-column instruction (`3cb9aff` at 18/18 lines and
  // `05236ff` at 34/33) that corrected what it said rather than adding to it.
  // Every one of them fit, so the cap absorbed all four in silence and then
  // surfaced as a percentage with no single commit to blame.
  //
  // **So the header's split -- a raise names the growth, a retune names the
  // percentage -- has a gap: growth UNDER a cap is invisible until it is nearly
  // over it.** A passing check says nothing about how nearly it failed, which is
  // the same thing the 2026-09-05 TOTAL_MAX entry found the hard way. Both point
  // at one habit: read the percentages on a GREEN run, not only on a red one.
  //
  // 104_000 puts it at 93.5%, where the 81_000 entry sat, inside the 93-94% band
  // every other cap in this file uses.
  //
  // Raised to 112_000 on 2026-10-28, a RAISE, naming the growth: 104,681 B
  // against 104,000, and all of it is new code in the service rather than
  // prompt text -- the runaway-stream detector and its retries, the
  // description-mode framing for Prompt-to-Report, `clarifyReportRequest`,
  // `generateTestData`, and the `repxOverlaps` import for the FixLayoutErrors
  // pass. Four features in one day, which is the cadence the entries above
  // predict for a chunk that is where features are specified. The first three
  // fitted under the old cap in silence, which is the "growth under a cap is
  // invisible" gap the 2026-09-06 entry describes; the fourth tripped it by
  // 681 B. 112_000 puts it at 93.5%.
  //
  // Raised to 120_000 on 2026-10-30, a RAISE that also carries the gap the
  // 2026-09-06 entry describes, so both halves are named. This commit grew it
  // 108,735 -> 112,233 B, +3,498 B, for parity row 29: `lib/repxGroups.ts`,
  // an output pass that numbers nested groups, and the NESTED GROUPS
  // instruction in the prompt's grouping section. That tripped the cap by
  // 233 B. The 104,681 -> 108,735 B before it, +4,054 B, had fitted in
  // silence. It came from Prompt-to-Expression (`d985720`) and parity rows 1,
  // 2 and 5 (`20a8e27`, `dd80fcc`, `20441fb`), the totals repair and its
  // prompt sentence among them. Measured by building HEAD before this change,
  // not inferred. 120_000 puts it at 93.5%.
  //
  // Raised to 128_000 on 2026-11-05, a RAISE carrying both halves again. This
  // commit grew it 115,452 -> 119,839 B, +4,387 B, for the chat that edits an
  // open report: `REPORT_CHAT_INSTRUCTIONS`, the edits' response schema and
  // `buildMockReportReply`. It first tripped the cap by 219 B because the
  // service imported `lib/agentEdit.ts` and with it `repxEdit.ts`; that import
  // is now a type only (App loads the edit library on demand), so what is left
  // is prompt and schema. The 112,233 -> 115,452 B before it, +3,219 B, had
  // fitted in silence: the REPX-only answer and the draft-and-correct path of
  // the same week. Measured by building HEAD in a throwaway worktree, not
  // inferred. 128_000 puts it at 93.6%.
  //
  // Raised to 138_000 on 2026-11-10, a RAISE carrying both halves again. This
  // commit grew it 127,110 -> 129,876 B, +2,766 B, for the AI accuracy
  // programme's batch AD: `lib/readCoverage.ts`, an output pass that finds the
  // captions Forma read in the finished REPX, and the one capped retry that names
  // what was missing. The 119,839 -> 127,110 B before it, +7,271 B, had fitted in
  // silence, taking the cap to 99.3%: 19 commits to the service and its prompt
  // module after the raise (36da972), counted with `git log 36da972..d32e682` on
  // geminiService.ts and reportBands.ts, the agent audit's batches of 2026-11-07,
  // the SQL Server programme's of 2026-11-09 and batch AB among them. Measured by building HEAD
  // (d32e682) in a throwaway worktree, not inferred. 138_000 puts it at 94.1%.
  { prefix: 'geminiService-', ext: '.js', max: 133_000, note: 'the mega-prompt + generation service + its output passes, lazy' },
  // Raised from 112,000 on 2026-08-30: the six @font-face rules for the
  // self-hosted families add ~1,935 B of CSS, which took this to 98.4% of the
  // old cap -- tight enough that the next unrelated line would have tripped it
  // and sent someone hunting a Tailwind leak that was not there.
  //
  // Swept on 2026-09-06 at 95.3% and deliberately LEFT at 116,000, because the
  // measurement says the percentage is misleading: across the day that added nine
  // lazy chunks and a dozen prompt features, this file moved 110,307 -> 110,566 B.
  // +259 B. Tailwind reuses utilities, so the stylesheet grows far slower than the
  // code around it, and 5,434 B of headroom is a long way off at that pace.
  // Recorded so the next percentage sweep does not re-litigate it -- and note this
  // is the cap the whole script was written for, so loosening it on a number alone
  // would blunt the one detector aimed at the founding defect.
  //
  // Raised to 120_000 on 2026-11-05, a RAISE naming the growth, at 113,006 B
  // (97.4%) without tripping. Not a Tailwind leak: 110,128 -> 113,006 B,
  // +2,878 B, is hand-written workspace.css for the chat made a chat that
  // day: Forma's replies as Markdown (lists, code, tables), the actions under
  // a reply and a message, Undo and the redesign question, the selection
  // chip, the bubbles on the right, the versions and the way back to the
  // latest message, and the sidebar's search. The single stylesheet has no
  // cut to make the way a chunk does. 120_000 puts it at 94.2%.
  //
  // Raised to 129_000 the same night, a RAISE naming the growth, tripped at
  // 120,567 B. 115,199 -> 121,039 B, +5,840 B, is hand-written workspace.css
  // for the conversation floating over the report as Google Stitch's does
  // (the owner's request): the reply card and its pill, the request log, the
  // box as a two-row bar with its focus edge, and their stacked layout. The
  // composer's overlap of the old chat column went with the column, -472 B,
  // which is the 121,039 -> 120,567. More of the same layout is approved and
  // still to come (a selection toolbar, the corner's Undo, the queue), so
  // expect another raise naming those. 129_000 puts it at 93.5%.
  //
  // Not raised on 2026-11-06, at 128,926 B (99.9%): the stylesheet does have a
  // cut, which the "no cut" sentence above missed. CSS a lazy component
  // imports is emitted beside its chunk, not into this file, so the styles of
  // the lazy menus and panels (the selection toolbar, the command menu and the
  // shortcuts list, the right-click menu, the zoom field, Usage today) moved
  // to src/components/overlays.css: 128,926 -> 123,655 B, and overlays-*.css
  // is 5.2 kB of its own. The next lazy component's styles go there too.
  //
  // Raised to 133_000 on 2026-11-11, an INTERIM raise carrying both halves.
  // The silent half: 123,655 -> 128,807 B, +5,152 B, fitted under the cap with
  // no entry between 2026-11-06 and a76e367 (the Stitch thread panel and its
  // box, the database and designer programmes, the full audit's fixes), and
  // left 193 B, found by the 2026-11-11 audit (TC-04) rather than by a commit.
  // This half: 128,807 -> 129,386 B, +579 B, measured by building the tree with
  // wave 1 of that audit's fixes in it, for its focus batch (FO): the pointer
  // reset of Chrome's own ring and the split public-form rules in index.css, and
  // the search pills, selection fills and sentence-case reply actions in
  // workspace.css. That tripped the cap by 386 B. 133_000 is 97.3%, deliberately
  // above the 93-94% band and deliberately temporary: the cut is PR-08 (wave 7
  // of the same plan), which moves the workspace's rules, about 35% of this
  // file, out of the entry stylesheet into a lazily loaded one, and then resets
  // this cap to 94% of what is left. Until then each batch that grows the file
  // names its growth here.
  //
  // Retuned to 91_000 on 2026-11-11, the cut the interim raise above waited
  // for (PR-08): index.css no longer imports workspace.css, which App.tsx and
  // SharedReportPage.tsx import instead, so the workspace's rules arrive with
  // the workspace. 132,299 -> 85,665 B, -46,634 B, off the stylesheet every
  // public page waits for before it paints. 91_000 is 94.1%, back in the band;
  // the interim 133_000 is gone with the reason for it.
  { prefix: 'index-', ext: '.css', max: 91_000, note: 'the public stylesheet: Tailwind, tokens, the public pages' },
  // The workspace's own stylesheet (2026-11-11, PR-08), split from the one
  // above. Vite names it after workspace.css rather than App, because the
  // shared report page imports it too and it is emitted once for both.
  // 45,588 B; 48_500 is 94.0%. The lazy panels' rules still go to
  // components/overlays.css, which is emitted beside their own chunks.
  { prefix: 'workspace-', ext: '.css', max: 48_500, note: 'the workspace stylesheet, loaded with the workspace and /s/{id}' },
  // Raised on 2026-11-12 with pdfjs-dist 5.5.207 -> 6.5.438 (owner decision 18:
  // GHSA-hq66-cqwq-w95j leaves no safe 5.x past 5.5.207), the firing these
  // vendored caps exist for: the worker 2,174,484 -> 2,248,830 B (+74,346, 99.9%
  // of the old 2_250_000) and the entry 447,505 -> 501,336 B (+53,831, over the
  // old 470_000). Both load only when a PDF is attached. 2_330_000 is 96.5% and
  // 528_000 is 94.9%, the headroom each had before.
  { prefix: 'pdf.worker-', ext: '.mjs', max: 2_330_000, note: 'pdfjs worker, lazy' },
  // Retuned to 468_000 the same day for Vite 8: 444,231 B, 94.9% as before.
  { prefix: 'pdf-', ext: '.js', max: 468_000, note: 'pdfjs entry, lazy' },
  { prefix: 'Markdown-', ext: '.js', max: 175_000, note: 'react-markdown + remark-gfm, lazy' },
  /*
   * The Firebase SDK, lazy as of 2026-09-01 and grouped into one chunk by the
   * manualChunks block in vite.config.ts.
   *
   * Budgeted because it is now the largest thing that is *not* on the critical
   * path, and the way that silently reverts is a static `import` of
   * `services/firebase` creeping back into the eager graph. That would not show
   * up here -- it shows up as the entry chunk jumping ~500 kB against its own
   * cap. This budget catches the other direction: the SDK itself growing.
   *
   * Split in two on 2026-11-01, when the repository audit found the chunk was
   * fetched by every page for the header's auth state: `firebase-` is now the
   * app and auth, 169,880 B, which every page still loads; `firestore-` is the
   * database, 449,408 B, loaded once someone signs in. The two come to 227 B
   * more than the one chunk did. Both caps are retuned to about 94%, where the
   * vendored caps sit: 660,000 left on the auth half would have had 74% headroom
   * and could not have fired, and the half the split protects is precisely the
   * one whose growth now reaches every visitor. The 2.9 kB `firebase-` beside it
   * is services/firebase.ts itself and matches this prefix too.
   */
  // Retuned for Vite 8 on 2026-11-12 (the paragraph above BUDGETS): firebase-
  // 107,168 B at 112_000 (95.7%), firestore- 346,913 B at 369_000 (94.0%). The
  // first Vite 8 build had put the SDK's shared internals in App Check's chunk,
  // which this cap could not see: auth imported the 41 kB `appcheck` chunk on
  // every page. vite.config.ts's codeSplitting groups explain the fix.
  //
  // Raised the same day for firebase 12.12.1 -> 13.3.0, the owner's choice
  // (decision 18) made with these numbers in hand, the firing these vendored
  // caps exist for: firebase- 107,168 -> 110,556 B (+3,388), 117_500 (94.1%);
  // firestore- 346,913 -> 584,217 B (+237,304), 621_500 (94.0%), of which
  // 149,959 B is re2js, a regular-expression engine Firestore 4.20 imports,
  // and the rest Firestore's own growth. Every signed-in visitor downloads it;
  // no advisory was fixed (package.json, comment:not-overridden).
  { prefix: 'firebase-', ext: '.js', max: 117_500, note: 'firebase app + auth, lazy, loaded by every page' },
  { prefix: 'firestore-', ext: '.js', max: 621_500, note: 'firestore, lazy, loaded once signed in' },
  /*
   * Every self-hosted font, checked individually. An empty prefix matches all
   * of them; the cap is the largest (inter-latin-ext, 85,068 B) plus a little.
   *
   * Worth watching per-file rather than only in the total, because the failure
   * mode here is silent and specific: fetching a STATIC instance instead of a
   * variable face, or a subset wider than latin-ext, changes one file's size
   * and nothing else. See src/fonts/README.md for how to refresh them.
   */
  { prefix: '', ext: '.woff2', max: 90_000, note: 'a single self-hosted font subset' },
  /*
   * OCR's runtime under dist/ocr/ (2026-11-01; see servedAssets('ocr', ...) in vite.config.ts):
   * vendored from tesseract.js 7.0.0, tesseract.js-core 7.0.0 and
   * @tesseract.js-data/eng 1.0.0, copied at build, never committed. Each budget
   * sits at about 94%, as the other vendored caps do; nothing routine moves
   * them, only an upgrade of one of those packages. A browser downloads the
   * worker, the data and ONE of the three core builds, the first time OCR runs.
   */
  { prefix: 'tesseract-core-', ext: '-lstm.wasm.js', max: 4_150_000, note: 'one OCR core build per browser, lazy' },
  { prefix: 'worker.min', ext: '.js', max: 118_000, note: 'the OCR worker, lazy' },
  { prefix: 'eng.traineddata', ext: '.gz', max: 3_140_000, note: 'English OCR data, best_int, lazy' },
  /*
   * The six languages the owner approved on 2026-11-04, from @tesseract.js-data
   * 1.0.0's best_int data like English's. Each is fetched only when a page
   * needs it (lib/ocrScript.ts): Arabic, Urdu and Hindi to probe a page English
   * garbled, the other three for a page in one. None adds to what an English
   * reader of a clean page downloads.
   */
  { prefix: 'ara.traineddata', ext: '.gz', max: 1_770_000, note: 'Arabic OCR data, when a page needs it' },
  { prefix: 'hin.traineddata', ext: '.gz', max: 1_480_000, note: 'Hindi OCR data, when a page needs it' },
  { prefix: 'urd.traineddata', ext: '.gz', max: 1_090_000, note: 'Urdu OCR data, when a page needs it' },
  { prefix: 'fra.traineddata', ext: '.gz', max: 753_000, note: 'French OCR data, when a page needs it' },
  { prefix: 'deu.traineddata', ext: '.gz', max: 1_420_000, note: 'German OCR data, when a page needs it' },
  { prefix: 'spa.traineddata', ext: '.gz', max: 2_240_000, note: 'Spanish OCR data, when a page needs it' },
  /*
   * Handwriting (2026-11-04, lib/handwriting.ts), opt-in. The runtime is from
   * @huggingface/transformers 3.7.6 and its onnxruntime-web; the model is
   * pinned by SHA-256 in scripts/fetch-handwriting.mjs and is optional here,
   * since a build made without fetching it (CI's) has none. Transformers.js is
   * optional too since 2026-11-11 (the full audit's RH-13): a build without
   * FORMA_HANDWRITING=1 compiles the handwriting branch out of lib/ocr.ts
   * (`__FORMA_HANDWRITING__`), so its 890 kB chunk is not emitted at all.
   */
  // Retuned to 890_000 for Vite 8 on 2026-11-12: 836,276 B in a
  // FORMA_HANDWRITING=1 build, 94.0%. A build without handwriting no longer
  // emits the chunk at all: Rolldown drops the import that the false
  // __FORMA_HANDWRITING__ makes unreachable, where Rollup shipped 890 kB that
  // nothing could load.
  { prefix: 'transformers.web', ext: '.js', max: 890_000, note: 'Transformers.js, handwriting only', optional: true },
  { prefix: 'ort-wasm-simd-threaded', ext: '.wasm', max: 22_970_000, note: "ONNX Runtime's WebAssembly, handwriting and PaddleOCR" },
  { prefix: 'encoder_model_quantized', ext: '.onnx', max: 24_550_000, note: 'TrOCR encoder, handwriting only', optional: true },
  { prefix: 'decoder_model_merged_quantized', ext: '.onnx', max: 43_110_000, note: 'TrOCR decoder, handwriting only', optional: true },
  /*
   * PaddleOCR (2026-11-10, the AI accuracy programme, batch AC; lib/paddle.ts):
   * its worker, which carries ONNX Runtime's JavaScript (403,548 B), and
   * PaddlePaddle's two models, pinned by SHA-256 in scripts/fetch-paddle.mjs and
   * optional here, since a build made without fetching them (CI's) has none:
   * 4,826,518 B and 7,848,423 B. All at 94%, as the vendored caps sit. The
   * WebAssembly it runs on is handwriting's, budgeted above, one file for both.
   */
  { prefix: 'paddleWorker', ext: '.js', max: 429_000, note: 'PaddleOCR worker with ONNX Runtime, when a picture is read' },
  { prefix: 'det', ext: '.onnx', max: 5_135_000, note: 'PaddleOCR text detector', optional: true },
  { prefix: 'rec-en', ext: '.onnx', max: 8_350_000, note: 'PaddleOCR English recogniser', optional: true },
  /*
   * The twelve Liberation faces a PDF/A file embeds (2026-11-02, parity row
   * 72; see PDF_FONT_ASSETS in vite.config.ts and assets/pdf-fonts/README.md),
   * committed unmodified from the 2.1.5 release. The largest is
   * LiberationSans-Italic at 415,816 B, so this sits at 94% as the vendored
   * caps above do. Nothing routine moves them: only a different release would,
   * and that is a change to the README's checksums too.
   */
  { prefix: 'Liberation', ext: '.ttf', max: 442_000, note: 'one PDF/A font face, lazy' },
  /*
   * Forma's own model (2026-11-02; see MODEL_ASSETS in vite.config.ts), learned
   * from the structure of the owner's 359 reports: 186,783 B as first learned,
   * so 94% as the vendored caps sit. Retraining on more reports moves it, and
   * that is a reason to read the archetype count before raising this.
   */
  { prefix: 'formaModel', ext: '.json', max: 198_000, note: 'the offline model, lazy' },
  /*
   * Forma's box reader (2026-11-04, src/lib/boxReader.ts): two small networks,
   * 7,552 weights at five decimals, 68,705 B as first trained, so 94%. More
   * features or a wider hidden layer move it; read the weight count in the
   * training script's last line before raising this.
   *
   * Raised from 73_000 the same day, naming the growth: 68,705 -> 94,270 B for
   * the second look at each line (a third network, 2,560 weights) and nine
   * more features, added to read group footers and their totals. 10,432
   * weights in all; 100_000 puts it at 94.3%.
   */
  { prefix: 'boxReader', ext: '.json', max: 100_000, note: "Forma's box reader, lazy" },
];

/**
 * The whole deployable payload, as a backstop for anything the list above misses.
 *
 * Raised from 4,600,000 on 2026-08-30 for the self-hosted fonts (audit
 * PERF-002): six woff2 files, 230,672 B, which took the total from 4,468,367 to
 * 4,699,146 and tripped this check exactly as it should have. The bytes moved
 * from Google's origin to ours rather than appearing from nowhere -- a typical
 * page still fetches three of the six, the same three it fetched before -- but
 * they are in `dist/` now, so the budget has to say so.
 *
 * Raised again from 4,840,000 on 2026-09-01, to 4,847,691 measured + headroom.
 * Deferring Firebase (see lib/firebaseClient.ts) took 502,540 B off the entry
 * chunk but added 148,489 B to the total: code-splitting is not free, and the
 * same modules spread across more chunks tree-shake and dedupe less well than
 * they did in one. Grouping the SDK with manualChunks was tried against this and
 * recovered only ~3 kB, so the cost is inherent rather than a chunking mistake.
 *
 * It is a deliberate trade and worth stating plainly: every visitor now
 * downloads ~500 kB less to see a page, and only the ones who sign in ever fetch
 * the 619 kB Firebase chunk at all. The total is the wrong number to optimise
 * for when most of it is never requested -- but it still gets a budget, because
 * something has to notice if it doubles.
 *
 * Raised from 4,900,000 on 2026-09-05, against 4,890,175 measured -- 99.8%, or
 * about 9.8 kB of headroom. Nothing had breached it. That is the reason to move
 * it, not a reason to leave it: the 2026-09-04 entry on the `index-` cap above
 * rejected a number that would have sat at 98.1% as "the mistake this whole file
 * is about", because a cap the next routine change trips teaches people to raise
 * the number rather than read it. The total had drifted past that line one small
 * commit at a time and nobody had noticed, since a passing check says nothing
 * about how nearly it failed.
 *
 * 5,200,000 puts it at 94.0%, which is exactly where the `index-` and
 * `firebase-` caps sit. That is the standard this file already applies to every
 * per-file budget, applied here for the first time.
 *
 * The header says to raise a budget in the same commit as the change that needs
 * it, and this raise had no such change. The rule is aimed at a bump smuggled in
 * to make a red check green; the reasoning above is what it actually asks for.
 * Note also what the total is FOR: it is the backstop for what the per-file list
 * misses, and it is meant to catch a doubling. 310 kB of headroom still does
 * that, and the per-file caps -- which are the sensitive detectors -- are
 * untouched.
 *
 * Raised to 5,350,000 on 2026-09-06, naming the growth -- and the attribution was
 * MEASURED, not assumed: `7822651` (the commit the 5,200,000 came from) was built
 * in a detached checkout and its dist/ diffed against HEAD. Worth the two builds,
 * because a 111 kB rise could equally have been a lazy import going static, which
 * is the exact failure the index- cap watches for and which raising this number
 * would have buried.
 *
 * 4,890,175 -> 5,001,385 B, +111,210, decomposing cleanly:
 *
 *    -87,587  the EAGER ENTRY CHUNK, down 14.7%
 *   +164,592  nine new lazy chunks -- ContactPage, DocsPage, FeaturesPage,
 *             LegalPage, NotFoundPage, ReportPreview, DataBinding, BatchPanel,
 *             RevisionsPanel
 *    +33,800  geminiService-, the day's prompt sections
 *       +405  index.css, accountData, rounding
 *
 * So +76,994 of it is the price of route-level splitting -- the same "code-
 * splitting is not free" effect the 2026-09-01 entry above measured at 148,489 B.
 * The total went UP because every visitor now downloads 87,587 B LESS. That
 * tension is permanent, and it is the strongest argument for treating this number
 * as a backstop rather than something to optimise.
 *
 * The 93-94% band was kept anyway, and the measurement is why. Every byte of that
 * +164,592 landed in chunks NO per-file budget matches, so this total is the only
 * thing watching them. That also corrects the paragraph above: the per-file caps
 * are the sensitive detectors for what they cover, and nine of the largest chunks
 * in the build are not covered at all. A loose total would leave 164 kB guarded by
 * nothing. If moving this number every few days becomes tiresome, the fix is
 * per-chunk budgets for the route chunks, not more headroom here.
 *
 * Raised to 5,680,000 on 2026-11-02, at 5,336,452 B (99.7%) without tripping:
 * +335,067 since the 5,001,385 measured on 2026-09-06, across eight weeks of the
 * parity programme's exporters and the OCR glue, not attributed here, and on
 * this day the lazy chunks of Forma's own model (the offline generator, the
 * provider adapter and the Settings panels, memory) and the PDF/A writer, plus
 * the entry chunk's +4,624 itemised on its own cap above. The fonts and the
 * model themselves are budgeted apart, below. 5,680,000 is 94.0%; per-chunk
 * caps for the route chunks are still the better fix this paragraph names.
 *
 * Retuned to 6,010,000 on 2026-11-07, at 5,652,847 B (99.5%) without
 * tripping: +316,395 since 5,336,452 on 2026-11-02, across the workspace
 * audit, Stitch's agent card and command menu, sharing, the Settings,
 * account and OCR redesigns, the changelog and its feed, and the agent
 * audit's first three batches, not attributed here. The same day's cut on
 * the `index-` cap moved 112 kB from the entry chunk into lazy ones and left
 * this number where it was, which is this paragraph's standing point: the
 * total is a backstop, not what a visitor downloads. 6,010,000 is 94.1%.
 *
 * Raised to 6,255,000 on 2026-11-08, at 5,878,818 B (97.8%) without
 * tripping: +88,168 of it is /licenses.txt, the third-party notices the
 * site audit's batch SE writes at build (fetched only from the footer's
 * link), and the rest the agent audit's later batches and the site audit's
 * first four, not attributed here. 6,255,000 is 94.0%.
 *
 * Raised to 6,630,000 on 2026-11-10, at 6,232,026 B (99.6%) without
 * tripping, a RAISE naming the growth and a retune both, since it had crept
 * under the cap for three programmes: +301,969 B came with the SQL Server
 * programme (1.2.0) and the Forma Designer download (1.3.0), not attributed
 * here, and +51,239 B with the AI accuracy programme (1.4.0), measured file
 * by file against a build of 91236c0, the commit before it: reportFacts
 * +6,341 (its own chunk), App +5,268, the changelog feed and releases
 * +9,673, geminiService +3,584, docsSearch +4,433 as its own chunk against
 * DocsPage -4,340, PaddleOCR's main-thread side +3,060, docsKnowledge
 * +2,803, batchCheckpoint +2,680, the Settings dialog +2,469, jobPlan
 * +2,328, the thread +1,939, fallbackChain +1,714, BatchPanel +1,551,
 * localModels +1,402, the rest under 1,100 each. 6,630,000 is 94.0%.
 *
 * Raised to 6,760,000 on 2026-11-12, at 6,669,407 B (100.6%, tripped): the
 * whole +128,177 B since 1.6.0's build is pdfjs-dist 5.5.207 -> 6.5.438
 * (owner decision 18), its worker +74,346 and its entry +53,831, both lazy and
 * itemised on their caps above; every other artifact was byte-identical in
 * size. 6,760,000 is 98.7%, where 1.6.0's build stood (6,541,230 of
 * 6,630,000): a raise naming the growth, not a retune, so the band is not
 * reset here.
 *
 * Raised to 6,800,000 the same day, at 6,709,090 B (99.2%), for the next two
 * steps of decision 18: the home page leaving the entry, +9,134 B (the same
 * code in more chunks, each with its own wrapper, and each page's head naming
 * more of them), then React 19.3.1 and motion 12.43, +30,549 B, react-dom
 * +28,875 of it (itemised on the `index-` cap). 6,800,000 is 98.7% again.
 *
 * Left at 6,800,000 through Vite 8 (6,395,508 B, 94.1%), and raised to
 * 7,060,000 the same day for firebase 13: 6,395,588 -> 6,639,195 B, +243,607,
 * the Firestore chunk +237,304 and auth +3,388 (itemised on their caps) and
 * the rest chunk names and wrappers. 7,060,000 is 94.0%.
 *
 * Raised to 7,215,000 the same day for @google/genai 3: 6,639,195 ->
 * 6,781,308 B, +142,113, the SDK's chunk +142,062 (itemised on its cap).
 * 94.0%.
 */
const TOTAL_MAX = 7_215_000;

if (!existsSync(DIST)) {
  console.error(`No ${DIST}/ directory. Run \`npm run build\` first.`);
  process.exit(1);
}

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push({ name: entry, path: full, size: statSync(full).size });
  }
  return out;
};

const files = walk(DIST);
/*
 * dist/ocr/ is counted apart from everything else. Its 14.8 MB (2026-11-01) is
 * the OCR engine the owner approved running in the browser, fetched only by
 * someone who runs OCR, one of its three core builds at that. Folded into the
 * total above it would have needed a cap nearly four times as large, and a cap
 * that large guards the app's own code from nothing.
 */
const OCR_DIR = join(DIST, 'ocr');
const isOcr = (f) => f.path.startsWith(OCR_DIR);
/*
 * dist/pdf-fonts/ likewise (2026-11-02): 4,359,164 B of fonts plus their
 * licence, fetched a face at a time and only by someone writing a PDF/A file.
 * Counted in the total it would have nearly doubled that cap's headroom for
 * bytes almost nobody downloads.
 */
const FONT_DIR = join(DIST, 'pdf-fonts');
const isPdfFont = (f) => f.path.startsWith(FONT_DIR);
// And dist/model/ (2026-11-02), the offline model, fetched only when it is used; its own budget is above.
const MODEL_DIR = join(DIST, 'model');
const isModel = (f) => f.path.startsWith(MODEL_DIR);
/*
 * Handwriting (2026-11-04) likewise: the model under dist/handwriting/ (only
 * when npm run fetch:handwriting ran), and the two files Vite emits into
 * assets/ for it, Transformers.js and ONNX Runtime's WebAssembly, all fetched
 * only by someone who turned handwriting on. About 88 MB together; folded into
 * the total above they would make its cap guard nothing.
 */
const HANDWRITING_DIR = join(DIST, 'handwriting');
const isHandwriting = (f) => f.path.startsWith(HANDWRITING_DIR) || /^(ort-wasm-simd-threaded|transformers\.web)/.test(f.name);
/*
 * PaddleOCR (2026-11-10) likewise: the models under dist/paddle/ (when
 * npm run fetch:paddle ran) and its worker, fetched only when a picture is read.
 * 13,082,453 B together; the WebAssembly it shares is counted with handwriting.
 */
const PADDLE_DIR = join(DIST, 'paddle');
const isPaddle = (f) => f.path.startsWith(PADDLE_DIR) || f.name.startsWith('paddleWorker');
/*
 * The built pages (2026-11-08, the site audit's batch SB): one HTML file per
 * route at dist/'s root, every prerendered public route drawn in full at build
 * so a crawler reads them (src/prerender.tsx; seven pages when this was
 * written, sixteen routes by 2026-11-11). 424,564 B that day, of which a
 * visitor downloads the one page they open, compressed. Counted apart, as the
 * OCR engine is, so they do not consume the total's headroom for code; the
 * changelog's page grows with every release, which is what this cap watches.
 * 452,000 is 93.9%.
 *
 * Raised to 474,000 the same day, at 445,703 B (98.6%): the site audit's batch
 * SC put twenty corrected claims, seven fidelity rows, a Preview card and a
 * data-format card on the Features page and the Docs page, which the build
 * draws into both pages' HTML. Copy a visitor reads, not drift. 94.0%.
 *
 * Raised to 527,000 the same night, at 495,254 B (104.5%, over): batch SD put
 * seven articles on the Docs page (choosing an AI, the workspace, data and
 * binding, sharing, memory and the library, the audit's findings, and every
 * keyboard shortcut), and docs.html went from about 93 KB to 143 KB. Each is
 * a page of the product a visitor could not read about before. 94.0%.
 *
 * Raised to 558,000 the next morning, at 524,283 B (99.5%): batch SE added
 * a page, /accessibility, and rewrote the terms and the privacy policy at
 * about twice their length, with a footer line on every page. 94.0%.
 *
 * Raised to 584,000 the same day, at 548,479 B (98.3%): batch SF drew a skip
 * link, a GitHub link, a Resources column and a legal bar into every page's
 * header and footer, and table semantics into the Features matrix — about
 * 2.6 kB on each of the nine pages. 93.9%.
 *
 * Raised to 756,000 on 2026-11-08, at 711,121 B (121.8%): batch SJ added
 * seven pages (security, pricing, examples, compare and migrate, about,
 * self-hosting and the FAQ), each about 20 kB drawn in full with its header
 * and footer, and a Pricing link and a Help column on every page. 94.1%.
 *
 * Raised to 836,000 on 2026-11-09, at 785,425 B (103.9%, over): the owner's
 * download programme added a page, /download (23.6 kB drawn in full), a
 * "Download for Windows" link in every page's footer, a Docs article on
 * opening a report in the designer and an FAQ answer drawn into both the Docs
 * and the FAQ pages, and longer terms and privacy paragraphs on 127.0.0.1.
 * Copy a visitor reads, not drift. The cap was first breached by the page's own
 * batch (WG, f3b5d77), whose check run was read with its last lines cut off;
 * this is the raise that batch should have carried. 93.9%.
 *
 * Raised to 907,000 on 2026-11-12, at 852,999 B (102.0%, over): the full
 * audit's public pages said what the waves built (FIX2D: Compare with the
 * original, two-language reports, SSRS and FastReport import, Word and Excel
 * templates, straightened scans, the print check, learning from kept reports,
 * Batch made like single reports, exports in one .zip, the write limits) on
 * the Features, Docs, FAQ and info pages, the privacy policy named every
 * stored item and what a kept report sends (LG, FIX2D), and PPUB's font
 * preload and module-preload links went into every page's head. Copy a
 * visitor reads and two lines per page, not drift. 94.0%.
 */
const isPage = (f) => f.name.endsWith('.html') && dirname(f.path) === DIST;
const pagesTotal = files.filter(isPage).reduce((a, f) => a + f.size, 0);
const PAGES_TOTAL_MAX = 907_000;
const total = files.filter((f) => !isOcr(f) && !isPdfFont(f) && !isModel(f) && !isHandwriting(f) && !isPaddle(f) && !isPage(f)).reduce((a, f) => a + f.size, 0);
const paddleTotal = files.filter(isPaddle).reduce((a, f) => a + f.size, 0);
// 13,082,453 B with the models (2026-11-10), so 94.0%.
const PADDLE_TOTAL_MAX = 13_920_000;
const handwritingTotal = files.filter(isHandwriting).reduce((a, f) => a + f.size, 0);
// 90,597,142 B with the model (2026-11-04), so 94.0%.
const HANDWRITING_TOTAL_MAX = 96_400_000;
const ocrTotal = files.filter(isOcr).reduce((a, f) => a + f.size, 0);
/*
 * 15,700,000 until 2026-11-04, when the six OCR languages the owner approved
 * added 8,216,036 B of data (22,981,939 B in all). Each language is its own
 * file, fetched only by someone who chose it, so an English reader downloads
 * what they did before; 24,450,000 puts the total back at 94.0%.
 */
const OCR_TOTAL_MAX = 24_450_000;
const fontTotal = files.filter(isPdfFont).reduce((a, f) => a + f.size, 0);
const FONT_TOTAL_MAX = 4_640_000;

/*
 * The eager total (2026-11-12, owner decision 18): the entry chunk and every
 * chunk it imports statically, followed to the end, which is what a visitor
 * downloads before the first draw of any page. The `index-` cap above measured
 * that while it was one file. Rollup kept a module the entry shared with a lazy
 * chunk inside the entry; Rolldown (Vite 8) gives such modules chunks of their
 * own, and the first Vite 8 build split the entry into twelve files (react,
 * react-dom, the JSX runtime, the router, the preload helper and six more),
 * 21,742 B that `index-` no longer saw. Growth in any of them is growth every
 * visitor pays, so this follows the imports rather than a name.
 *
 * The entry is the script dist/index.html names; a static import is a
 * `from"./x.js"` or `import"./x.js"` in it, never `import("./x.js")`, which is
 * a dynamic import and loads later. 324,734 B in the first Vite 8 build (the
 * entry 302,992 and eleven chunks), against 328,835 B for the single-file entry
 * of the last Vite 6 build. 345_500 is 94.0%.
 *
 * Raised to 357_500 the same day for motion 14: 324,767 -> 336,137 B,
 * +11,370, nearly all of it in the entry (itemised on the `index-` cap).
 * 94.0%.
 */
const EAGER_TOTAL_MAX = 357_500;
const STATIC_IMPORT = /(?:\bfrom|\bimport)\s*["']\.\/([^"'()]+?\.m?js)["']/g;
const assetsDir = join(DIST, 'assets');
const indexHtml = join(DIST, 'index.html');
const entryName = existsSync(indexHtml) ? /<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/.exec(readFileSync(indexHtml, 'utf8'))?.[1] : undefined;
const eager = new Set();
for (const queue = entryName ? [entryName] : []; queue.length; ) {
  const name = queue.shift();
  if (eager.has(name) || !existsSync(join(assetsDir, name))) continue;
  eager.add(name);
  for (const m of readFileSync(join(assetsDir, name), 'utf8').matchAll(STATIC_IMPORT)) queue.push(m[1]);
}
const eagerTotal = [...eager].reduce((a, name) => a + statSync(join(assetsDir, name)).size, 0);

const rows = [];
const breaches = [];

for (const budget of BUDGETS) {
  const matches = files.filter(
    (f) => f.name.startsWith(budget.prefix) && f.name.endsWith(budget.ext),
  );
  if (matches.length === 0) {
    // The handwriting model is fetched separately (npm run fetch:handwriting)
    // and CI builds without it; its budgets apply when it is there.
    if (budget.optional) continue;
    breaches.push(
      `MISSING  ${budget.prefix}*${budget.ext} — no artifact matched. Either the build ` +
        `changed shape or it did not run; a budget that matches nothing is not passing, ` +
        `it is blind.`,
    );
    continue;
  }
  for (const m of matches) {
    const pct = ((m.size / budget.max) * 100).toFixed(1);
    rows.push({ name: m.name, size: m.size, max: budget.max, pct, note: budget.note });
    if (m.size > budget.max) {
      breaches.push(
        `OVER     ${m.name} — ${m.size.toLocaleString()} B exceeds the ` +
          `${budget.max.toLocaleString()} B budget by ${(m.size - budget.max).toLocaleString()} B (${budget.note})`,
      );
    }
  }
}

rows.push({ name: `eager total (${eager.size} files)`, size: eagerTotal, max: EAGER_TOTAL_MAX, pct: ((eagerTotal / EAGER_TOTAL_MAX) * 100).toFixed(1), note: 'the entry and what it imports statically' });
if (!entryName || eager.size === 0) {
  breaches.push('MISSING  the entry chunk — dist/index.html names no module script, or its file is not in dist/assets. The eager total cannot be measured.');
} else if (eagerTotal > EAGER_TOTAL_MAX) {
  breaches.push(`OVER     eager total — ${eagerTotal.toLocaleString()} B in ${eager.size} files exceeds the ${EAGER_TOTAL_MAX.toLocaleString()} B budget (${[...eager].join(', ')})`);
}
rows.push({ name: 'dist/ total', size: total, max: TOTAL_MAX, pct: ((total / TOTAL_MAX) * 100).toFixed(1), note: 'everything deployed but dist/ocr, dist/pdf-fonts, dist/model, handwriting, PaddleOCR and the pages' });
rows.push({ name: 'pages total', size: pagesTotal, max: PAGES_TOTAL_MAX, pct: ((pagesTotal / PAGES_TOTAL_MAX) * 100).toFixed(1), note: 'one HTML page per route, the marketing pages drawn in full' });
if (pagesTotal > PAGES_TOTAL_MAX) {
  breaches.push(`OVER     pages total — ${pagesTotal.toLocaleString()} B exceeds the ${PAGES_TOTAL_MAX.toLocaleString()} B budget`);
}
rows.push({ name: 'dist/ocr/ total', size: ocrTotal, max: OCR_TOTAL_MAX, pct: ((ocrTotal / OCR_TOTAL_MAX) * 100).toFixed(1), note: 'the OCR engine, lazy' });
rows.push({ name: 'dist/pdf-fonts/ total', size: fontTotal, max: FONT_TOTAL_MAX, pct: ((fontTotal / FONT_TOTAL_MAX) * 100).toFixed(1), note: 'PDF/A fonts, lazy' });
rows.push({ name: 'handwriting total', size: handwritingTotal, max: HANDWRITING_TOTAL_MAX, pct: ((handwritingTotal / HANDWRITING_TOTAL_MAX) * 100).toFixed(1), note: 'TrOCR and its runtime, opt-in' });
rows.push({ name: 'PaddleOCR total', size: paddleTotal, max: PADDLE_TOTAL_MAX, pct: ((paddleTotal / PADDLE_TOTAL_MAX) * 100).toFixed(1), note: 'its worker and models, when a picture is read' });
if (paddleTotal > PADDLE_TOTAL_MAX) {
  breaches.push(`OVER     PaddleOCR total — ${paddleTotal.toLocaleString()} B exceeds the ${PADDLE_TOTAL_MAX.toLocaleString()} B budget`);
}
if (handwritingTotal > HANDWRITING_TOTAL_MAX) {
  breaches.push(`OVER     handwriting total — ${handwritingTotal.toLocaleString()} B exceeds the ${HANDWRITING_TOTAL_MAX.toLocaleString()} B budget`);
}
if (ocrTotal > OCR_TOTAL_MAX) {
  breaches.push(`OVER     dist/ocr/ total — ${ocrTotal.toLocaleString()} B exceeds the ${OCR_TOTAL_MAX.toLocaleString()} B budget`);
}
if (fontTotal > FONT_TOTAL_MAX) {
  breaches.push(`OVER     dist/pdf-fonts/ total — ${fontTotal.toLocaleString()} B exceeds the ${FONT_TOTAL_MAX.toLocaleString()} B budget`);
}
if (total > TOTAL_MAX) {
  breaches.push(
    `OVER     dist/ total — ${total.toLocaleString()} B exceeds the ${TOTAL_MAX.toLocaleString()} B budget`,
  );
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('artifact', 34)} ${pad('bytes', 12)} ${pad('budget', 12)} used`);
for (const r of rows) {
  console.log(
    `${pad(r.name, 34)} ${pad(r.size.toLocaleString(), 12)} ${pad(r.max.toLocaleString(), 12)} ${r.pct}%`,
  );
}

if (PRINT_ONLY) process.exit(0);

if (breaches.length) {
  console.error('\nBundle size budget exceeded:\n');
  for (const b of breaches) console.error(`  ${b}`);
  console.error(
    '\nIf the growth is intended, raise the budget in scripts/check-bundle-size.mjs in\n' +
      'the SAME commit as the change, and say why. If it is not intended, the usual\n' +
      'causes are a new dependency in the eager path, a lazy import that became\n' +
      'static, or Tailwind generating utilities from something it should not be\n' +
      'scanning — see the @source note at the top of src/index.css.\n',
  );
  process.exit(1);
}

console.log('\nAll artifacts within budget.');
