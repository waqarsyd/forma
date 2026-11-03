# Forma's own model

The owner's request of 2026-11-02, and the record of building it. This is a
proposal rather than a note because most of it is still being built and none
of it has been proven against real requests yet; when it has, the reasoning
moves into `docs/notes/` and this file goes, as `rag.md` will.

## The request

Gemini's free tier ran out before a single report could be tested, and the
owner ruled out paying for it: Forma is free on purpose. The owner asked for
three things instead:

- "Create our own AI model", learned from the reports their company has
  built over the years.
- API setup options and a memory feature, after the open-source **Hermes
  Agent** (Nous Research), which is provider-agnostic (OpenRouter, Ollama,
  LM Studio, an endpoint of one's own) and keeps a persistent memory of the
  user's preferences that it reviews and reuses.
- Built now, with more to follow.

## What was decided, and by whom

The owner answered three questions on 2026-11-02:

| Question | Answer |
|---|---|
| The reports are client material: client names in their folders, their queries, their logos. How is the training set handled? | **Local and sanitized.** The reports and the training set stay on the owner's machine, outside the repository. What ships with the public app is learned from structure only. |
| This machine has no GPU (128 GB of memory, 48 cores). Where is the model trained? | **Here, on the processors, first.** A model that needs no GPU and runs in the browser, with a neural model to follow. |
| Which AI options does the provider setup offer? | **All four:** Forma Offline (the model of its own, no key), Gemini with the user's free key, local AI (Ollama, LM Studio), and OpenRouter's free models. |

The memory feature follows Hermes Agent's documented shape, local first: it
remembers preferences given in the chat or shown by edits, learns from the
reports a user keeps, and shows all of it in a panel where each memory can be
read, changed or forgotten.

## The training set

The owner's folder held 6,818 files. Of those, 359 were `.repx`, 358 of them
DevExpress 20.1, Forma's own target, and every one parses with Forma's parser:
11,558 controls. The 6,399 Crystal Reports `.rpt` files cannot be read
without the Crystal runtime, which this machine does not have; they are the
largest source left for a later round.

The reports carry no connection strings or passwords. They do carry client
material: client names in their folder names, 91 database queries and 92
embedded pictures, logos among them.

## Structure only

A report reaches the model only as its skeleton (`src/lib/reportSkeleton.ts`):
its paper, margins and bands, and each control's kind, place, size, font,
alignment, borders and the role its text plays (a title, a caption, a bound
value, a total, page information). Never the text itself (a caption keeps its
length), a field, control or report name, a query, a parameter or a picture.

The rule is enforced, not promised. `unexpectedStrings` in
`src/lib/formaModel.ts` lists every string in a model that is not in the fixed
vocabulary a model may hold: the house fonts, an archetype label, a category,
a band kind, a role, a control kind, an alignment, a paper, a feature name, an
id or the date. `scripts/model/train.ts` refuses to write the model unless that
list is empty, and unless no font it names shares a word with a folder name.
Its console output is counts and shares only, so no report's words reach a
terminal or a log. `formaModel.test.ts` runs the same check on the shipped
file.

A category is never a folder name either. `categoryOf` maps a path or a
request onto one of nine generic words (`document`, `label`, `payroll`,
`stock`, `sales`, `accounts`, `manufacturing`, `cheque`, `catalogue`) by the
words in `CATEGORY_WORDS`. A folder named after a client contributes only the
generic word beside it ("Document Printing" gives `document`).

## The model (milestone 1, 2026-11-02)

`learnModel` learns two things, with no neural network:

- **House style:** for each role, the face, the median size and how often it
  is bold; the median margins of each paper; the median height of each kind
  of band; the median height of a record's line.
- **Archetypes:** the kinds of report in the set. Ten are found by k-medoids
  over each report's feature vector (`skeletonFeatures`, 15 numbers: page,
  heading share, how a record prints, groups, totals, lines, pictures, footers,
  subreports). Each keeps the skeleton of its most typical report as the
  pattern for a new one. To those, for each category with at least five
  reports, its own most typical report is added.

The first seeding (start from the most central report, add the furthest)
made outliers into medoids, and one cluster held 63% of the set. k-medoids++
seeding with 16 restarts, keeping the tightest result, spread it out.

Learned from the 359 reports, the model holds:

- **The house style:**
  - titles in Arial 12pt, bold 99% of the time;
  - captions 8.75pt, values 8pt, totals 7.75pt and bold 85% of the time;
  - Arial for 89% of text, DIN Pro Bold most of the rest;
  - A4 for 36% of reports, Letter 35%, A4 landscape 12%.
- **14 archetypes:**
  - documents (32%);
  - two kinds of manufacturing register, landscape (22% and 14%);
  - stock and payroll registers;
  - single-category payroll, stock, sales and label reports;
  - forms;
  - small labels.

It is `assets/model/formaModel.json`, 186,783 bytes. It is served at
`/model/` by `servedAssets` in `vite.config.ts`, budgeted on its own in
`check:size` and fetched only when it is used. To learn it again:

```powershell
npm run model:train -- --reports <the reports folder> --data <a folder OUTSIDE the repository>
```

`--data` receives one skeleton per report and an index naming each report's
file. Keep it outside the repository, since its folder names can name a
client; the script refuses a path inside it.

## The offline generator (milestone 2, 2026-11-02)

With no key, the chat box no longer stops: `designOffline` in `App.tsx`
answers instead of Gemini.

**Words that ask for a report** go to `generateOffline` in
`src/lib/offlineGenerator.ts`, with the model fetched once from `/model/`:

1. **Reading the words** (`readRequest`). It takes:
   - the category they name;
   - the columns they list, or a pasted schema's fields, which win;
   - what they group by, whether they total, and whether the page turns.

   A list's subject that is itself a kind of report ("a stock register") is
   not a column. That kind's usual columns are used, joined by the group
   field and the measures the words mention, so "a stock register grouped by
   warehouse with totals" gives Item, Warehouse, Opening, Received, Issued
   and Balance, grouped by Warehouse, with the last three totalled.
2. **Choosing the pattern.** The best-ranked archetype gives the paper and
   orientation, whether the heading is ruled, and whether the page footer
   carries the date.
3. **Writing the report.** A title, a heading row of captions, a record row
   of bound values with number and date formats, and when asked a group
   header, a group total and a grand total, with `Running` set as
   `repxSummaries.ts` measured. Faces, sizes and bold come from the house
   style, the margins from the paper's median, and the columns share the
   width by what they hold. The same passes as any written report follow:
   unique `Ref`s, `Dpi`, `PaperKind`.

The design fills every pane: the `.repx`, the Mockup's layout, and a spec
naming the pattern used. Its tests read each design back as the app reads any
report: it parses, the audit finds no error, and over records it prints the
values, each group's total and the grand total.

**An image** is built from the text OCR read, by `buildFromRead` in
`ocrAttach.ts`, the build the OCR review's Build .repx makes, now shared.
The owner's bilingual certificate, which Gemini could not finish because
thinking took its whole output limit, built this way with no model.

**Anything else** gets `OFFLINE_HELP`: a question, or a PDF's text or a
`.repx` that needs a model to read. The reply says what works offline and
how a free key adds the rest.

The composer's lock went with it. The box and the send button are live with
no key, and the banner under them reads "Working offline, with Forma's own
model". Resume, Test data, Prompt-to-Expression and the chat turn still need
a key.

What it does not do yet:
- read a picture's design (borders, fills, logos), which OCR cannot see;
- change an open report from words;
- use the archetype's own control placement. It takes the pattern's
  structure and style, not its exact layout, because a skeleton keeps no
  captions to put back.
## Provider setup (milestone 3, 2026-11-02)

The settings dialog now asks which AI answers, in a panel of its own
(`ProviderSettings.tsx`, loaded with the dialog). The choices:

- **Automatic** (the default): Gemini when a key is in, Forma Offline
  otherwise, which is how milestone 2 behaved.
- **Forma Offline**: the model of Forma's own and OCR, whatever key is in.
- **Gemini**, with the user's key, as before.
- **Local AI**: Ollama or LM Studio on the user's own computer. The panel
  has its address (Ollama's `http://localhost:11434/v1` by default) and a
  model, and "Find models" lists what the server has, image readers first.
  A server that cannot be reached is told about plainly: Ollama needs
  `OLLAMA_ORIGINS` set to the site's address, and LM Studio needs CORS on.
- **OpenRouter**: a key of the user's own and one of its free models, which
  "Find free models" lists (ids ending `:free`).

`lib/aiProvider.ts` keeps the choice and decides `aiReady`, which replaced
the Gemini key as the workspace's AI gate. The choice, the address and the
models are preferences in localStorage. The OpenRouter key is not: it is
kept like the Gemini key, in this tab's sessionStorage, never on disk.

**One path for every provider.** `compatClient.ts` answers the two calls
geminiService.ts makes of Gemini's SDK, `generateContent` and
`generateContentStream`, over the OpenAI-compatible `/chat/completions`
that all three speak. So the retries, the runaway check, the repairs and
the audit run unchanged for any provider:
- `withProvider` gives such a provider's model as the pinned model, so
  Gemini's model detection and probing never run for it;
- `clientFor` hands the adapter in place of the SDK;
- the response schema goes as a JSON Schema, and a server that refuses it is
  asked for a JSON object, then for plain text;
- a 429 keeps its status, so it is still a quota.
A second generation path was not written: the chat and generation paths have
drifted apart three times already (gemini.md).

**The security policy grew, on purpose.** `connect-src` now names:
- Ollama's and LM Studio's ports on loopback, both `localhost` and
  `127.0.0.1`;
- `https://openrouter.ai`.
`firebase.json` restates them for both hosting sites. A server on another
port or machine is not reachable: allowing `http:` or `*` would let an
injected script send a stolen key anywhere, which the list exists to
prevent.

Checked in the owner's Chrome:
- the panel lists the five choices with Automatic chosen;
- Local AI shows Ollama's address;
- "Find models" with no Ollama running gives the guidance above;
- the choice is kept without its key.

Covered by tests only:
- Forma Offline chosen with a Gemini key keeps the box offline
  (`aiProvider.test.ts`).
- The adapter, which is tested against a fake server.

Not checked against a real local model or an OpenRouter key: neither was
available on this machine.
## Memory (milestone 4, 2026-11-02)

Forma remembers how its user works, local-first and free, after Hermes
Agent's persistent memory (`src/lib/memory.ts`). It learns two ways:

- **What the user says.** A message that starts "remember", "always", "from
  now on", "never", "I prefer" or "by default" is kept as a memory, never
  designed or sent to a model. That works with or without a key. Its words
  are read for hints Forma's own model can apply: a paper, an orientation, a
  face, and the size of titles, captions, values or totals ("titles 14pt").
  The reply says what will be applied.
- **What the user's reports show.** Each report kept, by Export .repx or
  Save, leaves its style and no word of it: paper, orientation, face, and
  the size of each role. That is the skeleton's rule applied to the user's
  own reports. The newest 30 are kept, and a style is learned from two.

Both are used on the next report:
- Forma's own model takes the paper, orientation, face and sizes as its
  preferences. What the user said wins over what their reports show, and
  newer over older.
- An AI provider is told them as the user's standing preferences
  (`instructionsOf`), as a block of their own placed just before the
  request's instructions, so the request wins. With nothing remembered,
  nothing is added and the prompt is exactly as before.

Settings has a Memory section (`MemorySettings.tsx`, loaded with the
dialog). It shows each memory, to switch off, change or forget; a box to
add one; what the kept reports have taught; a switch to stop learning from
them; and "Forget everything". It all lives in this browser's
localStorage, under `forma.memory`.

Checked in the owner's Chrome, with no key:
- "Remember: always use A4 landscape and Tahoma" was kept, and the reply
  said A4 paper, landscape and Tahoma would be applied;
- the next request, "Create a stock register grouped by warehouse with
  totals", came out on A4 landscape (11.69 × 8.27 in);
- the Memory section showed the memory with its switch and Forget.
Its first layout used the dialog's note style without the icon its grid
expects, and every word wrapped onto its own line. Each note now carries
one.
## Gemini quota savings (milestone 5, 2026-11-02)

A free Gemini key now goes further. The five changes are recorded in
gemini.md, under *A generation can spend its whole output limit thinking*:
- the curated models are probed before the catalogue;
- the choice is remembered a day for the same key;
- a spent quota moves on to the next model, with a message that says it was
  the daily allowance and when it resets;
- the small calls go to Flash-Lite;
- a plain build request skips the chat turn.
An answer cut off by its own thinking, the owner's certificate, is asked
once more with thinking capped. All of it is covered by the generation and
model-resolution tests against a stubbed network. None of it has been run
against the owner's key, whose quota was spent for the day.
## A vision model (milestone 6, started 2026-11-03)

A small open vision model, fine-tuned to look at a picture of a report page
and write its skeleton. Forma then builds the report from the skeleton.

### What the owner decided

The owner answered two questions on 2026-11-03. Training runs on free GPU
time on the owner's own Kaggle account (about 30 hours a week), since the
machine that learned milestone 1 has no GPU.

| Question | Answer |
|---|---|
| What may be uploaded to Kaggle, as a private dataset, to train on? | **The skeletons, drawn.** The 359 structure-only skeletons, each drawn as page images with placeholder text. Not the reports themselves. |
| Where does the trained model run for users? | **Local AI first.** It is exported as GGUF for Ollama and LM Studio, behind the Local AI provider of milestone 3. The browser comes later, if at all. |

The answer to the second question needs one new piece in Forma: a converter
from a skeleton to a report. Until 2026-11-03 a skeleton only went one way,
from a report to its structure.

### The training set (built 2026-11-03)

- **The format the model writes** is `src/lib/skeletonText.ts`: one line per
  band, control and table row, in fixed positions and whole hundredths of an
  inch. As JSON a skeleton averages 11 kB. As text the median is 1,370
  characters, the 90th percentile 6,714 and the largest 11,799. The same
  module reads a model's answer back, skipping and naming any line it cannot
  read.
- **`npm run model:dataset`** packs the skeletons
  (`scripts/model/dataset.ts`). It reads only the `skeletons/` folder, never
  `index.json`, which names the report files.
  - **Fonts:** a font family is the one string in a skeleton that a report
    chose, so every family outside `PUBLIC_FONTS` becomes Arial. On the
    owner's set that was 45 places in four rare families. DIN Pro is on the
    list: 103 reports use it, and the shipped model already names it.
  - **Leak check:** `strayWords` then checks every target, and the script
    writes nothing if a single stray word is left.
  - **Band heights:** each band is written as tall as it prints, because a
    picture shows the printed height. One Detail band was drawn 3.7 high
    under labels 17.5 high, and DevExpress prints it 17.5 high.
  - **Split:** 319 examples to train on and 40 held out for evaluation, the
    same 40 on every run.
- **`python scripts/model/render.py <dataset>`** draws each skeleton four
  times at 100 dpi, in the Liberation faces of `assets/pdf-fonts`. Every word
  is a placeholder.
  - **What a version varies:** the words, how many records the Detail band
    repeats for (so a page of twenty rows is still one Detail band), and a
    little print noise on three of the four.
  - **Columns:** each column keeps one kind of value (dates, amounts or
    codes), as a real report's would.
  - **Output:** 1,436 images, 60 MB, in the dataset folder outside the
    repository, with `train.jsonl`, `eval.jsonl` and `dataset-metadata.json`.
  - **Upload:** `kaggle datasets create -p <dataset>`, which is private
    unless `--public` is given. Set the owner in `dataset-metadata.json`
    first.

### The model and the toolchain (researched 2026-11-03, not yet run)

These are from published sources, not yet measured here:
- **The model:** Qwen3.5-2B, Apache-2.0, the strongest of the permissively
  licensed small models on document benchmarks (OCRBench 84.5 on its model
  card). Excluded:
  - Qwen2.5-VL-3B, whose licence is non-commercial;
  - Gemma 3, which is gated;
  - LFM2.5-VL, which has a licence of its own.
- **Training:** Unsloth's Qwen3.5 vision notebook, a 16-bit LoRA in fp16 on
  **one T4**.
  - Unsloth needs compute capability 7.0, so Kaggle's P100 (6.0) is out.
    Kaggle also said in September 2026 that the P100 is being retired.
  - The sequence length has to rise to about 6,144: the largest target plus
    the image.
- **Export:** merge in 16-bit, then convert with llama.cpp's own
  `convert_hf_to_gguf.py` into the model and its `--mmproj` vision projector.
  Then `llama-quantize` to Q8_0, with the projector kept at F16. A direct
  quantized export from Unsloth garbled a Qwen-VL model's output (unsloth
  #3899).
- **The risk to test first:** LM Studio and llama.cpp run this architecture
  with vision. Importing a separate projector into Ollama for Qwen3.5 failed
  through 2026 (ollama #14575). Import the BASE model's GGUF into Ollama and
  check that `ollama show` lists vision before spending GPU hours. If it does
  not, the fallback is SmolVLM2-2.2B (Apache-2.0, weaker on documents),
  trained with plain TRL.

### The training script (built 2026-11-03, not yet run)

`scripts/model/kaggle/train_vision.py` is the whole Kaggle side. A notebook
downloads it from GitHub and runs it in four steps. The script's doc comment
has the commands and the notebook settings.
1. **`--setup`** installs what Unsloth's own Qwen3.5 notebook installs.
2. **`--smoke`** trains 20 steps on 40 images and answers 3 held-out pages,
   which proves every step for minutes of quota.
3. **`--train`** is the full run, one epoch.
4. **`--export`** writes the GGUF and the projector through llama.cpp.

It refuses a GPU below compute capability 7.0 by name, and uses one GPU even
when Kaggle gives two. Pages whose text is over 8,000 characters are left out
of this first run, so they fit the 6,144-token sequence with their image:
84 of the 1,276 training images and 16 of the 160 held out. It writes the
model's answer for each held-out page beside the right one, in
`predictions.jsonl`, for the Forma side to score with `textToSkeleton`.

### Still to build

1. The first Kaggle runs, smoke then full, and what they measure.
2. The evaluation on the held-out pages: bands and controls found, and their
   places, against today's offline model.
3. Forma's half: a skeleton to a report, its texts filled in by OCR. Then
   the model behind the Local AI provider.

## What comes next

Each is its own milestone, with tests, docs and the checks, and is recorded
here as it is built:

1. **The vision model of milestone 6**, above, to its end.
