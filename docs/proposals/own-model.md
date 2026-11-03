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
11,558 controls. The 6,399 Crystal Reports `.rpt` files were set aside as
unreadable without the Crystal runtime. That was wrong: the runtime is
installed (CrystalDecisions 13.0.2000.0 in the GAC). Since 2026-11-03 they are
read for their structure; see *More data* under milestone 6.

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

### The dataset is the skeletons, drawn on Kaggle (2026-11-03)

The dataset was uploaded from the owner's browser through the Chrome
extension, which takes files of up to 10 MB. The drawn dataset is a 48.5 MB
zip, while the skeletons alone, `examples.jsonl`, are 4.7 MB. So the private
dataset `waqarsayyed/forma-report-skeletons` holds the skeletons. The
script draws the pages on Kaggle with the same `render.py` and faces, cloned
from the public repository into `/tmp`.

### The smoke run (2026-11-03)

The first run on Kaggle, with `--setup` then `--smoke`, worked end to end in
24 minutes.
- **The GPU:** Kaggle now offers only "GPU T4 x2" and TPU, with no P100, as
  the research said.
- **Setup:** Unsloth's installs took about 12 minutes.
- **Drawing:** 1,436 pages were drawn on Kaggle.
- **Training:** 20 steps on 40 images, 19 seconds a step, with 23.1 million
  of 2.24 billion parameters trained. The loss went from 1.19 to 0.38.
- **The answers:** all three held-out answers were valid skeleton text, a
  page line, then bands, then controls with their fonts. Their lengths were
  wrong: 159 lines, 7 and 149, where the right answers have 31, 31 and 27.
  After 40 images the model has learned the format, not when to stop, which
  is what the full run is for.

The full run, Version 1 of the notebook `forma-vision-train`, started the
same day: `--setup`, `--train --predict 5`, then `--export`, as a saved
version on the T4.

### Forma's half (built 2026-11-03)

- **`src/lib/skeletonRepx.ts`** makes a skeleton a report again: the .repx,
  the Mockup's layout and the spec.
  - **Words:** titles and captions take the words OCR read inside their
    boxes. That is only possible in the bands whose place on the page does
    not depend on the records: the margins, the headers above the first
    record, the first record and the page footer. A caption with nothing
    read keeps a placeholder, "Total" in a footer and "Caption" elsewhere.
  - **Fields:** values are bound to fields named after the caption over
    their column. Totals sum that field, running over their band.
  - **The test:** read back through the Preview's parser, the report gives
    the skeleton it was written from. The only differences are caption
    lengths and A4's exact size, which `repairPaper` writes as DevExpress
    does.
- **`src/services/formaVision.ts`** asks the model through the Local AI
  endpoint the one question it was trained on: the picture, then
  `VISION_INSTRUCTION`, at temperature 0.
  - **A drift check:** that sentence is held to the training script's copy
    by a test that reads the script.
  - **Which model:** a model counts as Forma's by its name, which must
    contain "forma-vision".
- **The chat box** routes a picture there when the Local AI model is
  "forma-vision". When the model cannot be reached, or answers with no page
  line, the report is built from OCR alone and the reply says why. Only the
  first page is read.
- **`scripts/model/evaluate.ts`** scores `predictions.jsonl` with
  `scoreSkeleton`:
  - bands are paired by kind;
  - controls are paired by place within a band, at half overlap;
  - it reports recall, precision, and the kind and role of what it found.
- **`train_vision.py --check`** runs the exported model as users will. It
  needs no GPU hours: it runs in a CPU session with the exporting version as
  input.
  - **llama.cpp:** the engine LM Studio runs, through its multimodal CLI.
  - **Ollama:** the model and its projector are imported, then asked
    through Ollama's OpenAI-compatible endpoint exactly as Forma asks. This
    is the import that failed for Qwen3.5 through 2026.

### Version 1 wrote one layout for every page (2026-11-03)

The full run trained on 1,192 page images in 46 minutes, with an average
loss of 0.232.
- **The answers:** all five held-out answers were the same text, word for
  word. The model had learned to write the most common layout whatever the
  picture showed.
- **The score misleads:** three of the five pages have exactly that layout,
  so `evaluate.ts` scored the three distinct pages at an F1 of 81%. On the
  one page that differs, it found 9 of 20 controls.
- **The cause is the data, not the training:**
  - the 359 skeletons hold only 199 different texts;
  - one layout is 53 of them;
  - 28 of the 40 held-out pages had an exact copy in training.
  Writing the commonest layout was the cheapest way to lower the loss, and
  the held-out pages could not show it.

Version 2's dataset answers this (`npm run model:dataset`, 2026-11-03):
- **Each layout once:** the 199 distinct texts, not the 359 copies.
- **Near-copies held out together:** the same paper, with four fifths of the
  controls in the same places. That makes 82 groups. 20% of them are held
  out, 12 groups and 20 layouts, none with a twin in training.
- **Variants:** each trained layout as it is and in six variants by
  `perturbSkeleton`. Margins move by up to 20, controls by up to 12 across
  and 4 down, widths by up to 15% and band heights by up to 10, and one
  control in seven is left out. The right answer can then only be read off
  the picture: 1,253 skeletons, each drawn twice.
- **Size:** packed, it is 17 MB of text and a 0.8 MB zip, which goes
  through the browser.

**Version 1's export failed**, and that was a fault in the script.
- **What happened:** installing llama.cpp's converter requirements
  downgraded `transformers`. The older version could not read what 5.2 had
  saved: "Tokenizer class TokenizersBackend does not exist".
- **The fix:** the export now installs only the converter's `gguf` package.
- **Where it runs:** merging the adapter needs the GPU (`--merge`), and
  converting does not. So a CPU session with the training version as input
  runs `--export --check`, without spending GPU hours.

### Version 2 reads each picture, and places little (2026-11-03)

Version 2 trained on dataset v2: 2,346 page images, after the length cap
left out 160, in 85 minutes, with a loss of 0.411. It answered all 20
held-out layouts, none with a twin in training. The scorer gave:

| Measure | Version 2 |
|---|---|
| Different answers for different pages | 20 of 20 (Version 1: one answer for every page) |
| An answer with a page line | 100% |
| The paper and orientation right | 65% |
| Bands found | 57.5%, and 60.5% of those written were right |
| Controls at half overlap within their band | recall 10.0%, precision 13.7%, F1 11.6% |
| Of those found, the right kind and the right role | 46.8% and 97.2% |

**Collapse is fixed:** every page gets its own answer, valid and parsed.

**Placement is not usable yet:** about one control in ten lands where the
page has it. OCR's own build places every text it reads where the page
printed it, so for placing controls the OCR path is still the better one.
The likely cause is too little to learn from. There are 199 distinct
layouts in 82 families, and the variants move them but add no new ones.
Answer length also wanders: 174 lines for a page of 14, and 27 for one of
136.

**The deployment path works.** The first CPU export, of Version 1's merged
model, wrote `forma-vision-Q8_0.gguf` (2,077 MB, 8.5 bits per weight) and
its projector (668 MB) with llama.cpp's own converter and quantizer. The
check after it found no projector, because `--outfile` names the file
exactly and the script looked for "mmproj". The projector is now written
as `mmproj-forma-vision-f16.gguf`, the name LM Studio pairs by, and the
check accepts the first export's name too.

### The deployment check (2026-11-03)

Version 2's export, run on the CPU from its merged model:
- **The files:** `forma-vision-Q8_0.gguf` at 2,077 MB, and
  `mmproj-forma-vision-f16.gguf` at 668 MB.
- **llama.cpp** answered both held-out pages with skeleton text through its
  multimodal CLI. That is the engine LM Studio runs.
- **Ollama** imported the model and its projector and listed vision among
  its capabilities, which is the import the research had flagged as failing
  through 2026. But asked through its OpenAI-compatible endpoint, as Forma
  asks, it answered empty. The Modelfile had no chat template. The check
  now copies the template, renderer, parser and parameters from Ollama's
  own `qwen3.5:2b`, and records what an empty reply held.

### More data: SUNFACET, and the Crystal reports (2026-11-03)

The owner added a second product's report folder, SUNFACET: 22,623 files,
4.43 GB. It was copied beside the training data, outside the repository.
- **Its 546 `.repx`** became skeletons with a clean leak check. The shipped
  model was not touched: `--out` pointed into the data folder. They added
  only **19 new layouts**, since 905 skeletons across both products hold
  218 distinct texts. The two products share templates.
  `npm run model:dataset` now takes `--data` more than once. The first set
  keeps its ids, so its held-out layouts stay the ones scored before.
- **The Crystal reports are where the variety is.**
  - **Counts:** 21,776 in SUNFACET and 6,399 in SBS.JMS, which by content
    are 4,691 unique files. Twenty of them gave 20 distinct layouts in 15
    groups.
  - **`scripts/model/crystal.ps1`** opens each unique file with the
    installed runtime. One band is written per area, with its sections
    stacked. It writes only structure: kinds, places in hundredths of an
    inch (twips / 14.4), fonts, alignment, borders, and each text's role
    and length. No text, formula, field name or path is written, and the
    console prints counts only.
  - **Engine crashes:** some reports crash the Crystal engine itself, which
    ends the process with nothing to catch. Every shard of the first run
    died within about 80 files. A marker is now written before each file
    is opened, a supervisor reruns the shard, and the rerun skips that
    file.
  - **The TypeScript half:** `scripts/model/crystal.ts` numbers the layouts
    into `skeletons/` through `skeletonFromLayout` (`reportSkeleton.ts`).
    That function holds them to the skeleton's vocabulary, names the
    paper and finds the title, as for a parsed report.
  - **The run:** 16 processes took about 25 minutes. They wrote 4,155
    layouts from SUNFACET and 3,503 from SBS.JMS. About 300 files crashed
    the engine or failed to open, and were skipped. One SBS.JMS layout
    could not be converted, and none came out empty.

### Version 4's dataset (2026-11-03)

`npm run model:dataset` over all four sets (SBS.JMS `.repx`, SUNFACET
`.repx`, and both Crystal sets) gives:
- **8,562 skeletons and 4,235 distinct layouts.** No stray words; 378 rare
  fonts became Arial.
- **2,030 groups of near-copies,** against version 2's 82. That count is
  the variety the model lacked.
- **What was packed:** the GPU time is for about 3,000 pages, so
  `--max-train 2600 --max-eval 40 --augment 0`. That means 2,600 layouts
  from 1,620 groups and no variants, since real variety now replaces
  them. The 40 held-out pages from 32 groups include **all 20 that
  version 2 was scored on**, so the two compare directly.
- **Size:** targets have a median of 4,306 characters and a 90th
  percentile of 9,614, longer than SBS.JMS's. The zip is 4.93 MB.

Three things in the packer had to change before those numbers were right:
- **Speed:** grouping compared every pair, which is hours at this size.
  A pair is now scored only when it could reach four fifths. That bound
  is exact, because controls match only within bands of the same kind.
- **Which pages are held out:** the groups came out the same, but joining
  pairs as they were found moved 7 of version 2's 20 held-out layouts
  into training. A group is held out by its first layout's number, and
  that first layout depends on join order. The pairs are now joined in
  the old loop's order.
- **Ids across sets:** a layout repeated across sets took the later
  set's id. Within a set the last copy still stands for a layout, as
  version 2 chose; across sets, the earlier set keeps it.

### The model beside OCR, on the page (2026-11-03)

`scoreSkeleton` pairs controls within bands, which OCR cannot be scored by:
it knows no bands. So `npx tsx scripts/model/evaluate.ts --pages <dir>`
also scores on the page:
- **The pages:** the held-out pages, drawn here by `render.py` from the
  same seed as on Kaggle.
- **Only the fixed bands:** the margins, report and page headers, and
  page footer (`fixedPlaces` in `skeletonText.ts`). On a drawn page the
  Detail band repeats a random number of times.
- **The OCR side:** Forma's own OCR code, run in Node with the app's
  language data.
- **Two measures** (`scorePlaces`), because OCR boxes the ink and a
  skeleton boxes the control: whether a text was found where it prints,
  and whether its box is right at half overlap.

On version 4's 40 held-out pages:

| Reader | Text found where it prints | Box right (recall) |
|---|---|---|
| OCR, scale known | 55.7% | 10.9% |
| OCR, as the app read a screenshot until this change | 21.8% | 1.1% |
| OCR, as the app reads one now | 51.5% | 9.4% |

On version 2's 20 of them, version 2 found **11.0%** of texts where they
print, and OCR 54.8% with the scale known. So version 2 places worse than
OCR does. Version 4 is scored the same way when it finishes.

The middle row was a defect in the app, not in OCR. A screenshot was
always fitted inside the page's margins, so a full-page picture, which
carries its own margins, came out pushed in and shrunk.
`reportGeometry.ts` now knows a picture with a paper's shape as that
whole page (`paperOfImage`, `placeImage`); see the OCR bullets in
`docs/notes/app-shell.md`.

### Still to build

1. Train version 4 on Kaggle and score it on the same 20 pages, plus the 20 new
   ones, band by band and on the page beside OCR.
2. The Ollama check again, with the chat template.
3. If version 4 still places poorly, give the model OCR's boxes with the
   picture and ask only for what OCR cannot tell: bands, roles and kinds.
   Version 2 already gets most of those right: 97% of roles among the
   controls it found.
4. More than one page per picture, and the model's answer streamed as it
   is written.

## Forma's team: every part in its role (2026-11-03)

The owner's request, while version 4 was being built: merge the AI's report
creation, OCR and Forma's own model, so that "all will help each other and
play their role to create the requested report". Until then a request took
one path:
- the AI, with OCR's words beside the picture;
- OCR alone, or Forma's own model for words, with no key;
- the vision model alone, on Local AI.

Now one AI generation brings the rest along (`lib/formaTeam.ts`, and
`prepareTeam` in `App.tsx`):

| Part | Role |
|---|---|
| OCR | reads the words and where they sit |
| Forma's vision model | reads the layout, when named as a helper beside any AI |
| Forma's own model | gives the house style, for a report described in words |
| Memory | the user's remembered preferences, as before |
| The AI | designs the report, told the above as hints it may overrule |
| Repairs and audit | check the result, as before |
| Forma's own draft | stands in when the AI cannot answer |

Three decisions in it:
- **Hints, not instructions.** Version 2 places 11.6% of controls
  correctly, and an AI told to obey its draft would copy the mistakes.
  The draft says the image wins, and both briefs come before the user's
  preferences and words.
- **The house style only for words.** A picture shows its own style.
- **The draft replaces an error, never a report.** It stands in only when
  the AI fails, and is recorded as a revision like any other result.

Its effect on a generation is unmeasured until `bench:fidelity` runs with
the owner's key. The stand-ins were checked in the owner's Chrome with
Local AI pointed at a closed port. The vision brief needs a vision model
running, and waits for version 4's export. The rest is recorded under
*One request, every part of Forma in its role* in
`docs/notes/app-shell.md`.

## What comes next

Each is its own milestone, with tests, docs and the checks, and is recorded
here as it is built:

1. **The vision model of milestone 6**, above, to its end.
