# Retrieval over the user's own report library

**Status: built and wired, not yet evaluated.** Written 2026-09-23 as a proposal, and
every milestone in *Build order* was built by 2026-09-24. The comparison under *How we
would know it worked* has not been run, so whether retrieval brings a refine closer to
house style is still unmeasured — and that result, not the code existing, is what
decides the move into `../notes/` described below.

This file is in `docs/proposals/` rather than `docs/notes/` deliberately. The five
notes are current and maintained against the code, so a session greps them for what
is true now; a sixth note describing an unbuilt design would be a pointer that
resolves to nothing, which is the failure the documentation rules here already warn
about. If this ships, the reasoning moves into `../notes/` and this file goes away.
If it is rejected, this file records why, which is the more likely value.

---

## What this is for

One job: **generate a report that follows the conventions of the reports this
organisation already writes.** Font stack, heading treatment, margin habits, how
totals are presented, what a footer carries, which fields are abbreviated.

That is not a syntax problem. The generated XML is already valid — the repair and
audit passes in `src/lib` see to that. It is a *house style* problem, and the only
place the house style is written down is in the existing `.repx` files themselves.

Everything else discussed under the RAG heading — teaching the model DevExpress
syntax, shrinking the prompt — is **out of scope here** and covered elsewhere:

- Syntax grounding belongs to [`RepxProbe`](../../tools/RepxProbe/README.md), which
  measures what the serializer actually writes. Retrieval over vendor documentation
  would inject the exact class of plausible-but-wrong syntax that tool exists to
  replace.
- Prompt size is already handled by `sectionsFor` in
  [`promptSections.ts`](../../src/lib/promptSections.ts), which gates sections on
  evidence.

**Note this feature costs tokens rather than saving them.** Retrieved fragments are
added to the request. Anyone approaching this hoping to reduce spend is reading the
wrong proposal.

## Why retrieval is the right tool here, when it is the wrong tool elsewhere

Retrieval needs a query. The header of
[`promptSections.ts`](../../src/lib/promptSections.ts) states the problem that kills
most retrieval ideas in this codebase:

> Whether a document contains a chart is something only the model can tell us, after
> it has looked, and by then the prompt has been sent.

On the primary path the input is a screenshot or a PDF. There is no text to match
against a corpus, so any scheme that retrieves *before* the first generation is
guessing — and guessing in the omitting direction produces a silently worse report
rather than an error.

House style does not have that problem, because of when it applies.

### Retrieval belongs on the refine pass, not the first pass

The first generation transcribes the document. The result is `repxContent` — real
XML, real control names, real field labels. **That is the query.** It is text, it is
specific, and it exists precisely when the retrieval is wanted.

So the shape is:

1. Generate as today. Nothing changes.
2. The draft, plus anything the user typed, becomes the retrieval query.
3. Retrieve the closest fragments from the user's own library.
4. Offer a refinement: *bring this in line with your existing reports*.

This costs nothing on the common path, needs no change to the first request, and
sidesteps the chicken-and-egg entirely. The refine loop already exists — the
generation path already carries `previousRepx` — so this is an additional evidence
source on a path that is built, not a new mode.

## The corpus

The user's own `.repx` files. Intake can reuse the batch path, which already accepts
`.repx` and already processes one file at a time for quota reasons.

Scale to design for: **tens to a few hundred reports.** Nobody has a million. Every
decision below follows from that number, and the number should be challenged before
any of it is built.

## Chunking

**Chunk by structure, not by character count.** A `.repx` is a tree; splitting it
every 500 characters severs a control from the band that positions it and produces
fragments that mean nothing.

One chunk per meaningful unit: a band, or a control that carries appearance worth
copying. Each chunk stores

- the XML fragment itself,
- a short generated caption in plain words (*"page footer: page number right
  aligned, 8pt, thin rule above"*) — this is what gets embedded, because prose
  embeds far better than angle brackets,
- metadata: control type, band, font, size, alignment, source file.

The caption is the retrieval surface, the fragment is the payload, the metadata is
what makes the result filterable without a model.

### Strip the data on the way in

Fragments carry field names, company names, addresses and sample values. Values are
not house style, and a model given an example copies it. **Abbreviate literals to
placeholders at chunk time**, before anything is stored. This is a correctness rule,
not a privacy nicety: the failure it prevents is a generated invoice carrying
another client's name because a retrieved fragment happened to contain it.

## Embeddings

Gemini's embedding endpoint, called with the user's own key, exactly as generation is
today.

This is the part that fits the architecture almost suspiciously well:
`https://generativelanguage.googleapis.com` is **already** in `CONNECT_SRC` in
[`securityHeaders.ts`](../../src/server/securityHeaders.ts). No new origin, no CSP
change, no third party that could not already see a request, and the bring-your-own-key
position is unchanged — the app still owns no key and still calls Google from the
browser.

Rules:

- **Embed at import time, never per generation.** A library of 200 reports is embedded
  once. The only per-request embedding is the query itself, which is one call.
- **Cache by content hash.** Re-importing an unchanged file must cost nothing.
- **Version the store with the model id.** Changing embedding model invalidates every
  stored vector; a store that does not record which model produced it will silently
  compare vectors from two different spaces and return confident nonsense.

## Storage

Follow the split [`persistence.md`](../notes/persistence.md) already describes.

**Local first, and possibly local only.** IndexedDB, not `localStorage` (vectors are
binary and large) and emphatically not `sessionStorage`, which is a small synchronous
string store and is where the API key lives.

Firestore sync is a second milestone at best. Two reasons to be reluctant: the cloud
save budget is a real constraint, and `firestore.rules` is covered by 70 tests that
any new collection has to extend rather than bypass. A vector store is a poor fit for
a document database and a good fit for a local one.

## Retrieval: no vector database

**Brute-force cosine similarity, in plain JavaScript, over `Float32Array`.**

Run the arithmetic before reaching for a library. 500 chunks at 768 dimensions is
384,000 floats — about 1.5 MB in memory, and a full scan is 384,000 multiply-adds.
That is sub-millisecond, once, on a refine action the user explicitly clicked.

An approximate-nearest-neighbour index — Voy, Orama, anything WASM — exists to avoid
scanning millions of vectors. At this scale the index is slower to load than the scan
it replaces, and it costs:

- bundle budget, which has roughly 332 KB of headroom in total and about 2.4 KB in
  `geminiService` specifically (`npm run check:size` prints both), and
- `'wasm-unsafe-eval'` in `script-src`, which is a change to the security posture
  documented in [`securityHeaders.ts`](../../src/server/securityHeaders.ts).

Paying those for a 500-element loop would be indefensible. **If the corpus is ever
genuinely large, revisit this section and nothing else** — the interface either side
of it does not change.

Retrieve a small `k`. Three to five fragments. More is not better: it dilutes the
prompt and raises the chance that one irrelevant example drags the output sideways.

## Augmentation

Retrieved fragments go into the refine request as *examples of existing house style*,
labelled as such and clearly separated from the report being edited. The distinction
has to be explicit in the prompt, or the model merges an example into the output.

This composes with `sectionsFor` rather than replacing it: sections teach syntax,
fragments show convention. They are independent and should stay that way.

## What could go wrong

The list that matters more than the design.

1. **The model copies the example.** The single most likely failure. Mitigated by
   placeholder-stripping at chunk time, by labelling fragments as style references,
   and by keeping `k` small — but it will still happen sometimes and needs watching
   in real output.
2. **Prompt injection from the corpus.** The corpus is user-supplied files, and a
   `.repx` can contain arbitrary text in a label. That text reaches the model inside
   the prompt. The corpus is the user's own, so this is not an attack from a stranger
   — but a report containing the words *ignore previous instructions* is a plausible
   accident, and fragments should be fenced and treated as data.
3. **Stale conventions.** Old reports encode the old house style. Retrieval is
   confidently wrong in a way that looks like a bug in generation. Import needs a way
   to mark a subset as canonical.
4. **Silent no-op.** If nothing relevant is retrieved, tokens were spent for nothing
   and the user cannot tell. Log what was retrieved and why, the way
   `describeSections` already explains a short prompt.
5. **Embedding-model drift**, covered by versioning the store above.
6. **Import cost.** 200 reports is 200 embedding calls against the user's own quota.
   Cheap, but not free, and it must be visible before it starts rather than after.

## Constraints this must not break

- No server. `../PRD.md` §6 puts server-side generation out of scope, which rules out
  hosted vector databases by the same argument.
- No new `connect-src` origin.
- No CSP relaxation, which means no WASM.
- Bundle budgets stay green: `npm run build; npm run check:size`.
- `src/lib` is browser code and gets colocated `camelCase.ts` files with colocated
  tests; no barrel files. See the structure conventions in `CLAUDE.md`.

## Build order

Each milestone is independently useful and independently testable. The first four
touch no UI and make no network call of their own except where stated.

| # | Module | What it does | Tests |
|---|---|---|---|
| 1 | `src/lib/repxChunks.ts` | **Built 2026-09-23.** Splits a `.repx` into captioned, value-stripped chunks | 19, pure |
| 2 | `src/lib/embedStore.ts` | **Built 2026-09-23.** Content-hash identity, model versioning, what needs embedding, what is safe to search. Storage is an interface with no implementation — see below | 20, pure |
| 3 | `src/lib/vectorSearch.ts` | **Built 2026-09-23.** Cosine similarity, top-k, filtering | 14, pure |
| 4 | `src/services/embeddings.ts` | **Built 2026-09-23.** Model discovery, batching, the halving retry, partial results | 15, SDK mocked |
| 2b | `src/lib/libraryDb.ts` | **Built 2026-09-23.** The IndexedDB implementation of `LibraryStorage` | 12, record mapping |
| 5 | `src/lib/houseStyle.ts` | **Built 2026-09-23.** Queries from a draft, merged results, the fenced block; `previousState.houseStyle` carries it into the refine prompt | 18, pure |
| 6a | `src/services/library.ts` | **Built 2026-09-23.** Import and retrieval, with storage and embedding injected | 15 |
| 6b | `src/components/LibraryPanel.tsx` | **Built 2026-09-23.** The file list, the import, the canonical ticks | 17, jsdom |
| 6c | `App.tsx` rail wiring | **Built 2026-09-24.** A sixth `RailPanel`, and the refine call passing `houseStyle` | driven in headless Edge |

Milestone 1 alone is worth having even if the rest is abandoned: a structural `.repx`
chunker with values stripped is useful for diffing and for the audit pass.

### Milestone 1, measured against a real report

Built 2026-09-23 and run against `rptWorkerLedger_DJ.repx`, a 67 kB production report
from an SBS.JMS application — 54 chunks, 9 bands, 45 controls, 999 values redacted and
**no redactable attribute left carrying a real value**.

It found four defects that the hand-written fixtures could not, and every one of them
was a wrong assumption rather than a slip:

1. **`ControlType` can be assembly-qualified.** That report's root is
   `SBS.JMS.frmReport_DevViewer, SBS.JMS, Version=2.12.15.101, Culture=neutral,
   PublicKeyToken=null`. Taking the last dot-separated segment answered
   `101, Culture=neutral, PublicKeyToken=null`. Any report subclassed inside a host
   application looks like this, so it is the normal case.
2. **Bands nest.** Five `SubBand`s held most of the content, so attributing a control
   to its *nearest* band filed 44 of them under `sub band` and captioned nine real
   bands `empty`. Attribution now walks to the outermost band.
3. **Cross-band controls belong to no band.** `XRCrossBandBox` lives in the report's
   own `<CrossBandControls>`, so a rule that only looked for a band parent dropped it
   silently.
4. **Table cells carry `ControlType`.** All 47 of them do, `Text` and all. The
   fixtures had assumed otherwise on the strength of a rule that is only true of chart
   series, and the nesting rule — not the absence of an attribute — is what keeps them
   out of the chunk list.

**Known limitation, not fixed.** A band whose content sits in sub-bands reports its own
`HeightF`, so the page header captions as `2 tall, containing 27 labels`. The number is
accurate and reads as nonsense. Either sum the sub-bands or stop naming height on a band
that has them; it is a caption decision, and the caption is what gets embedded.

### Milestones 2 and 3, and the one decision they stop in front of

Both built 2026-09-23 and both pure, so both are fully under test. `vectorSearch` is
about forty lines and takes no dependency, which is this proposal's central argument
made concrete: at a few hundred vectors an approximate index is slower to load than
the scan it replaces, and it would cost `'wasm-unsafe-eval'` and most of the bundle
headroom to find out.

Two guards are worth naming because they defend the same failure from opposite sides.
`cosine` **throws** on a dimension mismatch, because a similarity score between two
embedding spaces is in range, plausible and meaningless, and nothing downstream can
detect it. `searchable()` then makes that throw unreachable in normal use by returning
only entries embedded with the model being searched. The last line of defence exists so
that the first one failing is loud rather than quiet.

**`embedStore` ships with a storage interface and no implementation, on purpose.** The
arithmetic decides it and the arithmetic is uncomfortable: 500 chunks at 768 dimensions
is ~1.5 MB as binary but **3-4 MB as JSON**, since a float serialises to about eight
characters. This project has never used IndexedDB — every store in `src/lib` is
`localStorage` or Firestore — and 3-4 MB does not fit the ~5 MB an origin gets for
everything it keeps. So the real choice is one of:

1. **IndexedDB**, and accept the first use of it in this codebase, with whatever test
   strategy that implies (no `fake-indexeddb` dependency exists here today).
2. **A hard cap on library size** — a few dozen reports, which may be all a house style
   needs, and `localStorage` continues to serve.
3. **Quantise the vectors** — 8-bit integers rather than JSON floats cut it by roughly
   four, at a small and measurable cost in retrieval quality.

Nothing else in the design changes whichever is picked, which is why the seam is where
it is. **Open question 1 decides it**: a library of thirty reports and a library of a
thousand do not want the same answer.

### Settled 2026-09-23, by measuring the real library rather than choosing

Nineteen production `.repx` files were chunked end to end. **341 chunks, 82 bands, 259
controls, 567.8 kB of chunk text, 328 distinct fragments, 9,695 values redacted and no
redactable attribute left holding a real value.** Every file parsed; none failed.

That settles four of the five open questions:

1. **Library size: tens, not hundreds.** 19 reports. Brute-force search is right and
   stays right, and `BATCH_SIZE` is not a throughput problem.
2. **Local-only for v1: yes.** A saved Firestore document is budgeted at 900 kB
   (`App.tsx`), and this library is ~1.6 MB with vectors, so cloud sync is not a drop-in
   even if it were wanted.
3. **Curation is required, not optional.** The folder holds 13 exact duplicate
   fragments, five `Job_Card_Report (1)…(5)` variants and two near-empty files of 1 and
   3 chunks. Importing a folder wholesale would fill the library with drafts.
5. **Two-phase is fine** — the refine loop already carries `previousRepx`.

**And the storage choice went the other way from the first recommendation.**
`localStorage` was rejected on the project's own evidence: `savedReport.ts` records
`QuotaExceededError: The 5000000-code unit storage quota has been exceeded` as something
that has already happened here, and `persistence.md` states the signed-out save path has
no budget — so those 5 MB already carry one unbounded consumer. IndexedDB also persists
`Float32Array` natively at 4 bytes a dimension, which removes the quantisation codec
from the plan entirely rather than making it optional.

### Milestone 5, and the one seam that is now live

`houseStyle.ts` builds the queries and the block; `analyzeReportDesign` takes it as
`previousState.houseStyle` and appends it to the refine context. **The prompt builder
performs no retrieval of its own** — it would otherwise need the IndexedDB library and an
embedding request on every generation, including the first pass where retrieval has
nothing to offer. The caller retrieves and hands over a string, and an empty string
appends nothing.

Two things that are still unenforced, stated rather than left to be discovered:

- **The wiring itself has no test.** `geminiService.test.ts` covers the exported pure
  helpers; nothing in this repo assembles a prompt and asserts on it, and building that
  harness is a larger job than the one-line interpolation it would check. The block
  itself is fully tested in `houseStyle.test.ts`.
- **`MAX_EXAMPLES` (4) and `DEFAULT_MIN_SCORE` (0.45) are placed, not measured.** The
  five-held-out-reports plan below is what should set them, and it cannot run until
  milestone 6 makes a library exist.

**The injection worry turns out to be mostly answered already.** `repxChunks` redacts
`Text`, `Name`, `Expression`, field names and URLs before storage — for leak reasons —
which removes nearly all free prose from a fragment before it can reach a prompt.
`StyleName`, `TextFormatString`, font names and text between elements survive, so the
block still fences its examples and still says in plain words that nothing inside them is
an instruction.

### Milestone 6, and the part of it that is not done

`services/library.ts` holds the two things a person does — fill the library, use it —
with the store and both embedding calls injected, which is the only way the ordering
rule below could be tested at all.

**The import saves before it embeds.** Chunking is local and instant; embedding is a
network request that can fail halfway. Writing the entries first means a failed request
costs nothing: the chunks are in the library, `entriesToEmbed` names them next time, and
the retry asks only for what is still missing. The reverse order would have a network
failure discard work already done locally, and there is a test that fails if anyone
swaps them.

`LibraryPanel.tsx` lists one row per file rather than per chunk, takes `.repx` only, and
names a file that produced nothing instead of dropping it silently — `Sample empt
report..repx` in the real corpus is exactly that case.

**Canonical is per file and off by default**, which answers open question 3 as an
explicit act rather than an import path. The corpus is the argument: five
`Job_Card_Report (1)…(5)` variants and two near-empty stubs would otherwise become
examples of how this organisation formats reports.

### 6c, and the three things only the running app showed

Wired 2026-09-24 and driven through headless Edge with the `run-forma` skill: a sixth
`RailPanel`, the panel lazy-loaded beside its neighbours, and `retrieveHouseStyle`
feeding `previousState.houseStyle` on the refine path only.

**The import refresh had to move into a `finally`.** `importReports` writes the chunks
and *then* embeds, so when embedding fails the function throws after the write — and the
`await refreshLibrary()` that followed it never ran. Importing `Invoice.repx` with a key
that could not embed left the panel saying *"Nothing here yet"* over a store holding 31
fragments. Neither unit suite could see it: `importReports` saved correctly and
`LibraryPanel` displayed the error correctly, and the defect lived in the glue between
them. It is the exact failure the save-before-embed ordering exists to make survivable,
hidden by the thing reporting it.

**The library service had to become a dynamic import.** Importing `services/library` at
the top of `App.tsx` put the chunker, the store, the search and the embedding client into
the **entry** chunk — measured at +17,318 B, 82.2% to 84.9% of that artifact's budget —
which every visitor to the landing page downloads. `lib/geminiClient.ts` made this same
move for the same reason; deferring it brought the chunk back to 82.5%.

**The panel had to borrow the styling its neighbour uses.** `lp-` classes carry no rules
of their own, exactly like `BatchPanel`'s `bp-` ones, so the import control rendered as
plain body text until it took `wb-pill wb-pill--outline` — and the rows needed real CSS,
because a name, a count and a button on one line run together without it. The button now
sits above the prose, as `BatchPanel`'s does.

Verified in the browser: 31 fragments from `Invoice.repx` and 11 from
`Job_Card_Report.repx` reaching IndexedDB with `Ref`, `Name` and `Text` redacted and
geometry intact; ticking a file writing `["Invoice.repx"]` to `libraryCanonical`; the
kicker reading `1 in use`; and the *"Nothing is used until you do"* prompt disappearing
once something is canonical.

**One finding worth acting on beyond storage.** Across all 19 reports there is not a
single `XRChart`, `XRCrossTab`, `XRGauge`, `XRSparkline`, `XRCharacterComb` or
`XRCheckBox`. The corpus is `XRLabel` (149), `XRTable` (57), `XRPictureBox` (18),
`XRPageInfo` (15), `XRLine` (15), `XRBarCode` (6), with `ExpressionBindings` (142) and
`GroupHeaderBand` (7). Effort aimed at chart and gauge syntax buys this library nothing;
tables, labels, pictures, barcodes, grouping and bindings are what it is made of.

## How we would know it worked

State this before building, because "it feels better" is not measurable and this
feature is exactly the kind that can appear to work while doing nothing.

Hold back five reports from the library. Generate each from its own source document
twice — once as today, once with retrieval — and compare both against the real report
for font, heading treatment, margins and footer content. If the retrieval run is not
visibly closer on a majority, the feature is not earning its tokens.

*The harness for this exists as of 2026-10-28:* `npm run bench:fidelity` scores a
generation against a case file's expectations for exactly those things (font median,
bands, surviving phrases, declared margins, the audit), and a held-back real report goes
in a `local-*` case directory that git ignores. What it does not yet do is run the
retrieval variant: `analyzeReportDesign` takes `houseStyle` through `previousState`, so
the "with retrieval" run needs a runner option that retrieves against a seeded library
first. That option is the remaining piece of this evaluation. See *The fidelity
benchmark* in `docs/notes/gemini.md`.

## Open questions

1. How large is the real library? Everything above assumes hundreds. Thousands changes
   the retrieval section; tens might mean sending a couple of whole reports and
   skipping retrieval altogether.
2. Is local-only storage acceptable for a first version, or is cross-device sync the
   point of it?
3. Who decides what is canonical — every imported report, or an explicitly blessed
   subset?
4. Should this ever run automatically on refine, or only when the user asks? Automatic
   spends tokens without being asked, which cuts against how the rest of the app
   behaves.
5. Is the two-phase shape acceptable, given it means house style never applies to the
   very first draft?
