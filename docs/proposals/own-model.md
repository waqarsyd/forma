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

**Reversed on 2026-11-05, as the entry point.** The owner merged Automatic
and Forma Offline and made the key the entry point to any work: with no AI
set up the chat box is locked again and `designOffline` is gone. The
generator below is unchanged and still designs, as the draft that stands in
when the AI set up fails to answer. What follows is the record of the three
days it answered with no key.

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
Since 2026-11-04 Forma's box reader puts that reading in bands first; see
*Forma's box reader* below.
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
  Since 2026-11-07 (the agent audit's batch E) a request also needs room:
  Ollama's default context drops the head of a long request without a
  word, so the panel says to start it with `OLLAMA_CONTEXT_LENGTH=32768`,
  and `contextTooSmall` in `compatClient.ts` fails a request whose prompt
  the server counted at under half of what was sent. An answer is given at
  least `MIN_COMPAT_OUTPUT_TOKENS` (4,096), since a reasoning model thinks
  inside that limit, and one that thought it all away is named as such;
  a 400 asks again without the schema only when it is about the format; a
  schema-less answer is read from its first brace to its last, with its
  quoted "false" read as false; and a failure is said in the provider's
  own terms rather than Google's (`classifyGeminiError`'s `FailureContext`).
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

- **What the user says.** A message that starts "remember" or "from now on"
  is kept as a memory, never designed or sent to a model. That works with or
  without a key. Until 2026-11-07 "always", "never", "I prefer", "by default"
  and "note that" did too, so "Never mind, make the title red" was kept and
  told to every report after it; the owner chose the two openings in the
  agent audit, and the rest now go to the agent (`isRememberMessage` in
  `lib/chatTurn.ts`, the one copy of the rule). Its words are read for hints
  Forma's own model can apply: a paper, an orientation, a face, and the size
  of titles, captions, values or totals ("titles 14pt"). A name said as not
  wanted is not a hint and the first wanted wins (`hintsOf`, 2026-11-07):
  "never use Letter" asks for no paper and "Tahoma instead of Arial" is
  Tahoma, where the first name in Forma's own list won wherever it stood.
  The reply says what will be applied. Since the same day the chat, its
  questions and the labels it adds are given the memory too, not only a
  generation, as the reply had always promised.
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
OCR does. Version 4 did no better; see the next section.

The middle row was a defect in the app, not in OCR. A screenshot was
always fitted inside the page's margins, so a full-page picture, which
carries its own margins, came out pushed in and shrunk.
`reportGeometry.ts` now knows a picture with a paper's shape as that
whole page (`paperOfImage`, `placeImage`); see the OCR bullets in
`docs/notes/app-shell.md`.

### Version 4 loops on every page (2026-11-04)

Kaggle's Version 3 of *Forma vision train*, on version 4's data. It trained
on 2,245 pages; 355 more were left out as over 8,000 characters. One epoch
took 1.7 GPU hours, and the loss fell from 0.85 to 0.46. Answering the 40
held-out pages took another 3.5 hours, 5.3 in all.

| On the held-out pages | Version 2 | Version 4 | OCR, scale known |
|---|---|---|---|
| Text found where it prints, version 2's 20 pages | 11.0% | 14.2% | 54.8% |
| Text found where it prints, all 40 | | 13.1% | 55.7% |
| Controls at half overlap in their band, F1, version 2's 20 | 11.6% | 0.0% | |
| Bands found, all 40 | | 16.9% | |
| Paper and orientation right, all 40 | | 62.5% | |

All 40 answers loop. Each repeats one line, starting at about its tenth
line, until the 4,096-token limit, so every answer is about 150 lines
whatever the page. That is why answering took 3.5 hours. More data did
not help: version 4 learned the format and the opening lines, then fell
into repetition under greedy decoding. It places far worse than OCR, so
the boxes design below gets its one run.

Two changes came out of it:
- **`loop_guard` in `train_vision.py`** stops an answer whose last 16
  lines hold two different lines or fewer. It was tested with stand-in
  modules: it ignores a long answer that never repeats, and stops a
  one-line loop at character 720 of 4,361. A row stopped that way says
  `"stopped": "loop"`.
- **The held-out pages are also asked with OCR's boxes.**
  `evaluate.ts --ocr-prompts` writes `eval-ocr.jsonl` from the same OCR
  reading at known scale. With it in the dataset, `train_vision.py
  --boxes` answers those too, into `predictions-ocr.jsonl`. The exact
  boxes the drawing recorded give an upper bound; OCR's give what Forma
  will really get. OCR's boxes are line boxes, taller than the drawn ink:
  r5's first box is `109 131 59 12` read, against `109 133 60 7` drawn.

The model was not exported. The deployment check is a test of the
toolchain, not of the model, so it waits for the boxes run's model.

### The boxes design (built 2026-11-04)

The owner approved one more training run if version 4 still places worse
than OCR, for this design. Version 2 found 11% of a page's text where it
prints, OCR 55%: placing things is what OCR already does. So the model is
given the page and the text read on it, as numbered boxes, and asked only
for what OCR cannot tell:
- the bands, each where it first prints, with its top and height;
- under each band, the number and role of each box printed there.

A box in a repeated record is not listed, because it is the same control
printing again. The places come from the boxes, so they are as good as the
reading.

- **Training pairs:** `render.py --boxes` records each text's ink box as it
  draws, with the band, the band's appearance and the role. Recording
  draws nothing from the random generator, so the pages are the same as
  without it; the image hash was checked. Training pages get boxes a pixel
  or two off and 3% missed, as OCR reads; held-out pages keep exact ones.
- **Training:** `train_vision.py --boxes` asks each page its own question,
  in training, prediction and the deployment check.
- **The Forma side:** `src/lib/boxText.ts` holds the question (a test keeps
  it word for word with render.py's), reads an answer, makes it a skeleton
  on the boxes' places, and scores it box by box.
- **Its length:** measured on 300 of version 4's layouts. The median page
  has 91 boxes (90th percentile 274, most 547). Question and answer
  together run a median 2,390 characters, against the skeleton text's
  2,784, so a run costs about what version 4's did. Only 3 of the 300 are
  over the 8,000-character limit, against 23 skeletons. The limit now
  counts the question as well as the answer, because in this design the
  question carries every box.

### The boxes run lists the boxes and reads little (2026-11-04)

The one approved run: Kaggle's Version 4 of *Forma vision train*, on
version 4's data drawn with `--boxes`.
- **Training:** one epoch on 2,490 pages. 110 were left out as over 8,000
  characters, and so was 1 of the 40 held-out pages. Training took 6,739 s
  (1.9 GPU hours), 4.2 hours in all with the answers. The loss fell from
  1.17 to about 0.73 in the first tenth of the epoch and then stayed
  between 0.69 and 0.74.
- **Asked twice:** the 39 held-out pages with the boxes recorded while
  drawing them, and all 40 with OCR's boxes from `eval-ocr.jsonl`.
- **Scored:** with `boxText.ts`, in the browser as before. Beside them is
  the right answer, scored the same way: the ceiling of the design.

| On the held-out pages | Exact boxes | OCR's boxes | Right answer | OCR alone |
|---|---|---|---|---|
| Text found where it prints, all | 91.3% | 52.4% | 94.9% | 55.7% |
| Text found where it prints, version 2's 20 | 98.1% | 47.7% | 100.0% | 54.8% |
| Boxes listed in the right band | 23.2% | | 100% | |
| In the right band with the right role | 8.7% | | 100% | |
| Bands found, against the right answer | 43.0% | | 100% | |
| Paper and orientation right | 61.5% | 65.0% | 100% | |

**With OCR's boxes it places worse than OCR alone**, 52.4% against 55.7%,
so Forma's vision path does not ask it. The first row mostly measures the
boxes, not the model. The places come from the boxes, so any answer that
lists them scores near the right answer's 94.9%. What the model adds is
which band each box is in and what role it plays, and there it is weak:
- **Bands and roles:** even with the exact boxes, 23% of boxes are in the
  right band, and 9% have the right role as well.
- **The page line:** it never wrote the right one. The 39 answers hold
  five distinct page lines.
- **How it answers:** it lists the boxes in order, nearly all as `value`.
  Of the 39 exact-box answers:
  - the median is 171 lines, against 41 in the right answers;
  - 22 go on past the last box, 922 lines in all;
  - 20 list a box twice;
  - 12 were stopped by `loop_guard`, and 13 of the 40 asked with OCR's
    boxes.

  With OCR's boxes, about 1,000 of its lines copy the question's box lines
  back.

The flat loss and the stock page line read the same way: the model learned
the answer's format and its commonest content, not to read the page or the
numbers. Version 2 got roles right for 97% of the controls it found; this
run did not keep that. **The approved GPU run is spent**, and a next step is
the owner's to choose (see *Still to build*).

**Scoring it found a defect in `boxAnswerToSkeleton`.** It made every box
a label with a length of 0, which a skeleton reads as an empty caption. So
each box called a caption scored as printing nothing, and the right answer
itself found only 59.1% of the text where it prints. Before the fix, the
table's first row read 77.4%, 40.6% and 59.1%. A caption made from a box
now has a length estimated from its width, since the question carries
numbers only.

### The deployment check on the boxes run's model (2026-11-04)

*Forma vision export* Version 3 ran on Kaggle's CPU for 55 minutes, on the
boxes run's merged model:
- **The files:** the Q8_0 model is 2,077 MB and the projector 668 MB, as
  before.
- **llama.cpp** answered both pages.
- **Ollama** now imports the model with the chat template copied from
  `qwen3.5:2b`, lists vision, and generates. Both answers came back with
  empty `content` and finished on length. The whole answer was in the
  message's `reasoning`: Ollama's qwen3.5 parser treats what the model
  writes as thinking, and the fine-tuned model never closes it.

Fixing that means one of three changes: leave PARSER and RENDERER out of
the Modelfile, ask with thinking off, or read `reasoning` when `content` is
empty. None was made, because no vision model is wired into Forma.

**The fix, checked (2026-11-04 and 05).** `84ae9ec` made the check import
`forma-vision` with `qwen3.5:2b`'s template, renderer and parameters but not
its parser, and a second import, `forma-vision-parsed`, with the parser,
asked with thinking off. The first two runs after it (Versions 4 and 5)
tested nothing: the notebook's one cell downloads `train_vision.py` from a
commit pinned in its URL, `847d2c1`, not from `main`, and that pin had not
moved. With the pin at `84ae9ec`, Version 6 ran on the CPU for 59 minutes:
- llama.cpp answered both pages, 153 and 80 lines, as before.
- `forma-vision` imported with vision listed and thinking not, and **Ollama
  answered both pages as Forma asks**, each with its page line.
- `forma-vision-parsed` listed thinking too, and answered with
  `reasoning_effort: none` through the OpenAI endpoint and with
  `think: false` through the native one.
- **Ollama's answers are shorter than llama.cpp's** for the same pages: 39
  lines against 153, and 30 against 80, and their first line names other
  margins (100 at the top and 50 at the bottom, against 20 and 30). Both
  were asked at temperature 0 with the same token cap, so the difference is
  in how Ollama runs the model, its template or its sampling. Measure it
  before Forma relies on Ollama for the vision model; llama.cpp is the
  runtime that reads a page whole.

So leaving the parser out works, and is what the Modelfile should do.

### Forma's box reader (2026-11-04)

The owner's choice after the boxes run: "go with the CPU classifier
option". OCR already places the text, so the reader does not look at the
picture at all. It reads the boxes OCR found and the characters in them,
and says which band each text is in and what role it plays. It is two
small networks, learned on this server's CPU and shipped as
`assets/model/boxReader.json`: 7,552 weights, 68,705 bytes.

**Since 2026-11-05 its draft is what the AI corrects.** The owner asked for
Forma to draft and the AI to correct, so a first generation from a picture
sends the reader's draft (or the vision model's) in a compact text form,
`lib/draftText.ts`, and the AI answers with the corrected draft instead of
designing the REPX; Forma builds the report from it. Built as it stands,
with no AI, the draft scores 7/14 and 11/16 on the benchmark's cases. See
*Forma drafts, the AI corrects* in `docs/notes/gemini.md`.

How it reads a page (`src/lib/boxReader.ts`):
- **Lines.** The texts are grouped into the lines they print on.
- **A band per line.** The line network weighs 33 features of each line:
  - its place on the page and the gaps around it;
  - how many lines share its shape, which is how records show;
  - where it sits against the records;
  - whether its texts stand in the records' columns;
  - what characters it holds.

  The bands are then decoded together in DevExpress's print order, the
  odds of each band following another learned from the training pages and
  weighted 0.2 against the line's own scores.
- **A role per text.** The text network weighs 71 features: the text's
  place in its line and column, its characters, its line's band and the
  line's features. Three of them say whether the texts in its column, on
  lines shaped like its own, read the same or differ.
- **One settled fact.** A row of column headings lines up with the records
  under it and reads as one more record. `settleRecords` gives the line
  that opens a run of records back to the header band above it when the
  line holds no digit and the next line has one in a column under it.
- **The skeleton.** Each band keeps its first appearance, and the records
  only their first. The first record is the first stretch of lines that
  repeats for two more periods; where several periods fit, the shortest
  under which every line holds a text reading word for word as it did a
  period earlier. Each text becomes a label (a page number an
  XRPageInfo), sized as OCR's own build sizes one, at the place OCR read
  it. Bands stack from the top margin as DevExpress prints the first page,
  so nothing moves. `skeletonToDesign` makes it a report:
  - titles and captions take OCR's words;
  - values are bound to fields named after the captions above them;
  - totals sum those fields.
- **A guard.** `readerCoverage` counts what a design would lose: a band
  that prints once, seen a second time, or a line among the records shaped
  like none of them. Over 15% of a page, OCR's copy is built instead.

How it was trained (`scripts/model/boxes.ts`, `npx tsx`, no npm script):
- **The data.** `render.py --labels` writes every text it draws with its
  box, band and role. The words are the script's placeholders. Version 4's
  2,640 layouts, twice each, made 5,280 pages in under four minutes; 80 are
  held out.
- **As OCR reads them.** 2,600 training pages were read by OCR as the app
  reads a picture (`scripts/model/ocrPages.ts`, taken out of `evaluate.ts`,
  12 Tesseract workers, about 25 minutes). Each text read takes the band
  and role of the drawn text it covers most. The drawn boxes of every
  training page come too, jittered, thinned and run together as OCR does.
- **The sizes.** 7,378 pages, 209,453 lines and 810,852 texts. One layout
  in twenty is held out to choose the transition weight, by the mean of
  each band's accuracy. Training takes about five minutes.

Measured on the 40 held-out pages as OCR read them (`v5-eval-pages`, drawn
again after the caption fix below), beside the vision model's boxes run:

| On OCR's reading of the held-out pages | Vision model | Box reader |
|---|---|---|
| Texts of each band's first appearance: right band | 23.2% | 72.8% |
| … right band and role | 8.7% | 66.5% |
| All texts: band, role, both right | | 88.3%, 91.8%, 83.4% |
| Text found where it prints (OCR's own build: 53.9%) | 52.4% | 52.2% |
| Box right at half overlap (OCR's own build: 14.0%) | | 13.7% |
| Pages built banded; the rest as OCR's copy | | 33 of 40 |

By band, the page footer is right for all 9 of its texts, Detail for
94.7%, the report header for 89.2%, the report footer for 83.5%, a group
header for 76.3%, the page header for 71.5% and a group footer for 64.1%;
the two margins' four texts are all wrong. By role, values are right for
95.7%, captions for 89.6%, titles for all 20, page numbers for 84.6% and
totals for 51.2%.

**It places text as OCR does and adds what OCR cannot: the bands, the roles
and a design.** Its places come from OCR, so on the page it stays within
1.7 points of OCR's own build, sized alike. What it adds is the structure,
which the vision model never got: the band of each band's first
appearance right three times as often, band and role more than seven
times. It is wired in three places:
- **As the AI's brief.** With no vision model, Forma's team tells the AI
  the reader's draft (`draftBrief(…, 'reader')`).
- **As the stand-in.** The same draft is used when the AI cannot answer.
- **As the build with no key.** A picture is built banded, with OCR's
  copy kept as the revision before it (`buildWithReader`).

Checked in the owner's Chrome with no key, on held-out page r100: 20
records under a header block and a total. The reply was "Built … with
Forma's box reader putting each text in its band: 4 bands". The Preview
printed:
- the report header's captions;
- the page header;
- one record of five bound fields, three times over test data;
- the report footer's total.

What it took, in the order it was found:
1. **Trained on drawn boxes alone**, it was right about the band of 88% of
   texts with the drawn boxes and 75% with OCR's. Trained on OCR's
   reading of the same kind of page, 88% with either.
2. **Unweighted, the rare bands were read as records**: the page footer
   was right for 56%. Weighting each class by the square root of its
   rarity, at most five times, made it 100%.
3. **`render.py` drew a fresh random caption in every record**, where a
   report prints its static text the same each time, so "a column of one
   word is a caption" could not be learned. Captions are now drawn once
   per control on a page. This changes the Kaggle dataset too, for the
   better.
4. **Decoded at full weight**, a record after a record was so likely that
   a page number at the foot of a short listing became one more record.
   Choosing the weight by overall accuracy picked 1, because records are
   most lines; by the mean of each band's accuracy, 0.2.
5. **A second settled rule was measured and left out.** It said that a
   caption whose column reads differently on the next record is a value.
   It took captions from 93.7% right to 77.4% on the drawn boxes.
6. **The first live run built a four-record Detail band** of 22 fields: a
   code had recurred four lines apart by chance, and counting matches
   preferred that period. The period rule above fixed it; a test pins
   both cases.
7. **Labels sized to the ink wrapped mid-word** in the Preview
   ("Designatio" over "n"). They are now sized as OCR's own build sizes
   them, and a title allows for bold.

Its weak spots, in order: totals, group footers, the margins, and names in
records, which a hand-made listing showed it can call captions. It is
measured on drawn pages only: a scan of a real report has never been
scored, and doing so would need real reports' pictures, which are client
material and stay on this machine.

### Totals and group footers (2026-11-04)

The owner's request after the reader shipped: "improve the totals and group
footers". The first step was measuring exactly what was wrong.
- **"Totals 51% right" mixed two things.** Some were running totals
  printed in every record, which read as values to the eye. The rest were
  the totals a footer sums, which the reader already read as totals 71.5%
  of the time, and 59.7% in the right footer as well.
- **The misses had three causes:**
  - OCR ran amounts together: "894 213,086.00 184,088.14" was one text,
    because a line was split only where a gap was wider than the line was
    tall.
  - The number test failed on OCR's debris, as in "474,045." and
    "288] 328,304.67".
  - A group footer recurs once a group, and the reader counted any line
    whose shape recurred as a record.
- **Forty pages were too few to judge by.** Footers are a few lines on a
  few pages, and one page decoded differently moved the scores by twenty
  points. Every change was also scored on the training layouts held out of
  training, as OCR read them: 280 pages. The scores that matter most are
  on what a design keeps, each band's first appearance.

What changed:
1. **`ocrLayout.ts` splits two amounts side by side**, however close.
   "1 250.00", digits with a space between thousands, stays one. OCR alone
   then found 55.7% of text where it prints on the held-out pages, against
   55.5%.
2. **The reader's features.**
   - The number test ignores OCR's rules and stray dots.
   - A record is a line in a run of lines alike one after another.
   - Two line features say how long that run is and how often its shape
     recurs elsewhere: a group's footer is a run of one that recurs.
   - A text's column is compared only within its run.
   - A new text feature says when a figure stands under a column of the
     records' figures, where a total stands.
3. **Two footer rules in `settleRecords`**, each measured apart:
   - The line after a run of records, with fewer texts than a record and
     shaped like none of them, with a figure under the records' columns, is
     a footer. Records after it, or group headers on the page, make it a
     group's; otherwise it is the report's. It must not be followed by one
     more record, since a record OCR read a little differently breaks the
     run too. Without that condition, records fell from 94.4% right to
     89.5%.
   - In a group footer, a figure under the records' columns is a total. In
     a report footer, half the numbers are values in the training reports,
     so the network decides there.
4. **Every training page read by OCR**: 5,182, twice as many as before.
5. **A second look at each line.** A third network, 2,560 weights, reads
   each line with the first network's scores for it, the line above, the
   line below and the lines shaped like it (`contextFeatures`). It learns
   from first scores given by networks that never saw those pages: two,
   each trained on half the layouts. The transition weight is now 0.5.

The features and rules alone did not help on OCR's reading. On the 280
pages, group footers went from 71.7% right to 66.3%. The data and the
second look made the difference:

| Band and role right, in each band's first appearance | Shipped | Now |
|---|---|---|
| Footer totals: 280 held-out pages, as OCR read them | 48.4% | 52.7% |
| Footer totals: the 40 held-out pages, as OCR read them | 43.4% | 63.8% |
| Footer totals: the 40 pages' drawn boxes | 53.2% | 76.6% |
| Group footer band: 280 pages | 58.4% | 54.7% |
| Group footer band: 40 pages | 23.1% | 50.9% |
| Group footer band: drawn boxes | 46.0% | 66.4% |
| Group header band: 280 pages | 52.0% | 55.4% |
| Every text, both right: 280 pages | 76.9% | 81.0% |
| Every text, both right: 40 pages | 66.5% | 71.0% |

Over all texts, the 280 pages went from 83.0% right in band and role to
85.8%, and the 40 pages from 83.4% to 85.3%. Text found where it prints
went from 52.2% to 53.1%, against 54.1% for OCR's own build sized alike.
Six of the 40 pages fall back to OCR's copy, against seven.

**Totals improved on every set.** **Group footers improved on two and lost
3.7 points on the largest.** What is left there is mostly footers read as
records: 603 texts on the 280 pages. The model is 94,270 bytes and 10,432
weights.

Checked in the owner's Chrome with no key, on held-out page r100, where a
footer line "Weight 202 454,870.63" follows twenty records on a page with
no group. It became the report footer with a sum over the report
(`sumSum`, `Running="Report"`). One of its two figures is that total; the
other stayed a value, as the network decides in a report footer.

### The box reader on the company's real reports (2026-11-04)

Every score above is on drawn pages: layouts learned from the reports, then
drawn by Forma. The owner approved scoring the reader on the company's own
reports, printed by DevExpress, with only the scores kept.
`scripts/model/realScore.ts` does it, in a work folder outside the
repository:
- It takes one `.repx` per distinct layout from the report folders: 219 of
  906 files.
- It fills each with made-up data and prints it with `RepxProbe render`, at
  100 dpi. DevExpress could print 200 of them here.
- OCR reads each picture as the app does, and the reader runs over that
  reading.
- Each printed text's true band and role come from the control that printed
  it, through the bricks DevExpress writes (`printedTruth.ts`). Those are the
  parsed layout's band and `skeletonOf`'s role.

Nothing the reports contain is printed or kept, only counts.

**The shipped reader (v1) on 200 real pages, 7,587 texts:**
- Band and role both right: 55.8% (band 75.2%, role 67.0%).
- Each control's first appearance, which is what a design keeps: 30.4%.
- Totals in a footer: 6.3%.
- By band: Detail 91.7%, PageFooter 94.5%, PageHeader 52.7%, ReportHeader
  39.4%, GroupHeader 30.2%, GroupFooter 15.6%. Page information is right
  83.9% of the time.

Against the 81.0% on drawn pages, the real pages show what drawing leaves
out: headers, group bands and footers as DevExpress prints them.

**Two versions trained on printed pages, neither shipped.**
`scripts/model/printed.ts` prints training pages from the Crystal
skeletons by the same route as real reports: Forma's design, then
DevExpress's print, labelled from the bricks. It wrote 2,860 pages, used
beside the drawn ones.
- **v2** reached 54.3% both right, 31.9% on first appearances and 19.7% on
  footer totals. Detail fell, and page information fell to 46.8%. Its
  training pages had page information printed in record bands.
- **v3** dropped page information from the record bands. It reached 52.0%
  both right, 30.4% on first appearances and 10.5% on footer totals.
  - Header and footer bands rose: PageHeader 68.5%, ReportHeader 63.0%,
    ReportFooter 55.9%, GroupHeader 33.1%.
  - Detail fell from 91.7% to 83.8%. Its commonest error is Detail read as
    GroupHeader, 454 texts, because the printed layouts are richer in
    groups than the real ones.
  - Page information fell to 9.7%. The printed pages hold it on only 80
    lines of 2,860 pages, so the drawn pages' examples are outweighed.

v1 stays the model in `assets/model/boxReader.json`. If printed pages are
tried again, they need their group share matched to the real reports'. They
also need page information in the page bands as often as real reports
carry it.

### The weak spots, worked on the real reports (2026-11-05)

The owner: "pause vision model, fix box reader weak spots". Everything here
was measured on the 200 real pages above (`realScore.ts`, scores only) and
on the drawn pages' 280 held-out layouts, the real pages deciding. Two
options were added for it: `realScore.ts --dump`, each line's structure
with its words masked to their character classes, written outside the
repository, and `--rules` on both scripts, to switch each rule.

**What the real pages showed.** The commonest band errors were group
footers read as records (478 texts) and group headers read as records
(342), then group headers read as page headers (117) and page headers as
report headers (112). The commonest role error was values read as captions
(916). The masked lines and the page kinds explained much of it: the
training pages do not look like the company's first pages.

| Pages with… | Real reports | Drawn pages | Printed pages |
|---|---|---|---|
| a report header | 10% | 85% | 88% |
| a page header | 35% | 94% | 96% |
| a group band | 41% | 51% | 57% |
| page information | 31% | 37% | 3% |

Many real reports keep their first content in group headers or in Detail,
so a reader that learned that a page opens with a report header and a page
header reads them that way. Some "group header read as a record" is a
report whose master record is a group header: read as Detail, it still
prints once per record.

**Rules, each measured apart, and all but one left out:**

| On the real pages, band and role both right | |
|---|---|
| The shipped reader | 55.8% |
| *above*: lines read as records above the first run of them, shaped like none, to the header | 52.9% |
| *loose*: a footer as long as a record, with no figure | 52.4% |
| *chain*: a footer running on over several lines | 42.9% |
| *headings*: a heading row under a title both read as records | 56.3% |
| **the column rule (`settleColumns`), shipped** | **59.2%** |

Real records break the shape a rule looks for often enough that every rule
which moves lines out of Detail by shape takes real records with it: Detail
fell from 91.7% right to between 66% and 87%. The column rule reads names in
records instead: in a run of three or more records, a text whose column, on
the records shaped like its own line, mostly reads differently is a value,
and one that reads the same in every record and holds no digit is a
caption. Values went from 74.8% right to 79.9%, captions from 48.0% to
44.5%, and on the drawn pages band and role together from 85.8% to 85.0%:
compared across every line of a run, captions there fell to 83.5%, since a
record of two lines puts a caption over the other line's values. A page
number rule was measured too and left out: with the shipped model it added
nothing (page information was already 83.9% right) and cost the drawn pages
1.8 points.

**Training weighted to the real page kinds, measured and not shipped.**
`boxes.ts --match <file>` weights each training page by the real share of
its kind (whether it has a report header, a page header, a group band,
page information) over the training share, the shares counted from the
dump, nothing a report says. `--match-power` softens it.

| Real pages, with the column rule | v1 shipped | v4a matched | v4b + printed | v4d half-matched |
|---|---|---|---|---|
| Band and role both right | 59.2% | 60.3% | 57.9% | 58.6% |
| Each control's first appearance | 31.5% | 35.9% | 35.4% | 30.0% |
| Footer totals | 6.3% | 13.4% | 14.7% | 7.8% |
| Page header | 52.7% | 84.2% | 89.3% | 73.2% |
| Report header | 39.4% | 9.4% | 7.9% | 14.2% |
| Pages built banded | 126 | 104 | 120 | 125 |

v4a reads the real pages best and fixes the customer list (its title and
headings to the report header), but 22 fewer pages pass `readerCoverage`,
and a page that fails it has no draft for the AI to correct (*Forma
drafts, the AI corrects* in `docs/notes/gemini.md`), so it goes down the
full path. It also falls to 80.5% on the drawn pages. Weighted, the role
network lost page information (83.9% to 9.7%): its training examples sit on
pages with report headers, which the weighting turns down, so `--match`
weights the band networks alone unless `--match-roles` is given. Trained
models and results are in `forma-model-data\boxreader-v4a` to `v4d`.

**What is still weak**: group footers (15.6% right on the real pages) and
group headers (30.2%), and the customer list's title and headings, read as
records with the shipped model. The next attempt that measures as
promising is a retrain that keeps v4a's reading without losing the banded
pages: the coverage check, rather than the model, may be what the matched
reading fails.

### Still to build

1. ~~Train version 4 and score it~~: done 2026-11-04. It loops on every
   page and places 13.1% of text, against OCR's 55.7%.
2. ~~Train the boxes design once and score it~~: done 2026-11-04. With
   OCR's boxes it places 52.4% against OCR's 55.7%, and it puts 23% of
   boxes in the right band, so Forma's vision path does not ask it.
3. ~~The Ollama check again, with the chat template~~: done 2026-11-04.
   llama.cpp answers; Ollama generated into `reasoning`. ~~Fix it~~: done,
   checked by Version 6 on 2026-11-05: without the qwen3.5 parser Ollama
   answers both pages, though shorter than llama.cpp does (see *The
   deployment check on the boxes run's model*).
4. ~~More than one page per picture~~: done 2026-11-04. The vision model
   reads an upload's first page and, when there are more, its last, and
   `mergePageSkeletons` (`skeletonRepx.ts`) keeps the first page's bands
   and adds the kinds only the last shows: group and report footers and
   their totals. Streaming the model's answer as it is written is no
   longer wanted, since the minimal chat (2026-11-04) shows working dots
   and not the answer's text.
5. ~~The owner's decision, before any more GPU~~: the CPU classifier,
   2026-11-04, built as *Forma's box reader* above and wired in.
6. **The box reader's weak spots**: ~~totals~~, improved 2026-11-04 (see
   *Totals and group footers*). Group footers read as records, about one
   footer text in three on the largest held-out set, and names in records.
   ~~A check on real reports~~: done 2026-11-04, 55.8% both right on 200
   printed pages (see *The box reader on the company's real reports*). Two
   versions trained on printed pages did not beat it and were not shipped.
   ~~Names in records~~: the column rule, 2026-11-05, 59.2% on the same
   pages (see *The weak spots, worked on the real reports*). Group footers
   and headers remain.
7. ~~The brief's effect on a generation~~: measured 2026-11-04 with
   `bench:fidelity --brief`. The invoice scored the same with it, 16/16.
   The customer list looped in one run, and its brief was a poor reading of
   its page. See the runs of that date under *The fidelity benchmark* in
   `gemini.md`.
8. **The customer list is the box reader's plainest failure**, and it is a
   committed, synthetic page. OCR reads its 23 lines cleanly, and
   `detectLayout` finds the 21-row table. The reader then puts every line
   but the footer in Detail: the title, the heading row and all twenty
   records. The design keeps a band's first appearance, so the brief loses
   the title and its run date. It shows the heading row as the record, with
   three of six columns bound. This is the weakness the real reports
   measure, page and report headers read as Detail, on the simplest page
   there is. Until the reader reads it, whether the brief helps a
   generation stays unproven: the invoice scored the same with it.

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
running, and waits for an exported model worth running. Version 4 loops
(see *Version 4 loops on every page*), and the boxes run places worse than
OCR alone (see *The boxes run lists the boxes and reads little*). Since
2026-11-04 Forma's box reader gives a draft and a brief without one (see
*Forma's box reader*). The rest is recorded under
*One request, every part of Forma in its role* in
`docs/notes/app-shell.md`.

## All of the company's reports, counted (2026-11-10)

The owner asked on 2026-11-10 for everything in the SUNFACET share to train
Forma's AI, "don't leave anything" (`forma-audit/ai-accuracy-2026-11-10.md`,
batch AA). The owner's decision that day: **the company's material stays on
this machine.** Structure trains what ships, as it has since 2026-11-02, and
real content is used only for local training and scoring; nothing real goes
to Gemini, OpenRouter or Kaggle.

Two scripts count it, both writing only to `forma-model-data` and printing
counts: `scripts/model/inventory.ts` (every file by type, size and distinct
content by MD5; a remote-desktop `.rdp` is counted and never opened) and
`scripts/model/sqlStats.ts` (the SQL scripts as statement, join, parameter
and type counts, with no name, literal or comment kept).

**The share is much smaller than its file count.** Copies dominate:

| | Files on the share | Distinct | With the 23 archives unpacked | Distinct |
|---|---|---|---|---|
| Crystal `.rpt` | 21,776 | 4,365 | 50,072 | 4,366 |
| DevExpress `.repx` | 547 | 203 | 1,146 | 203 |
| `.sql` | 210 | 10 | 469 | 11 |
| `.pdf` | 12 | 6 | 36 | 6 |

The archives (1.3 GB, 4.36 GB unpacked) are backups of the share: the 23
archives nested inside them are byte-identical to the outer ones, and they
add one Crystal report and one SQL script. Re-running `crystal.ps1` over the
whole share, and then over the unpacked archives, wrote no new layout: every
distinct `.rpt` had been read on 2026-11-03, 4,155 of them, and the other 211
(the archives' one new report among them) crash the Crystal engine on every
attempt and stay recorded as failed. So *all of it*, for Forma's own model, is
the 4,155 Crystal layouts and the 203 DevExpress layouts it already learns
from. More variety has to come from elsewhere: synthetic reports and openly
licensed report sets (batch AE).

**The SQL scripts** (10 distinct): 28 tables created, 3 procedures created and
7 altered, three of them with ten or more parameters; 230 SELECTs, most with
no join and nine with six or more; 173 temporary-table uses and 8 dynamic SQL
calls, the shapes that give a procedure no readable schema (*The SQL data
source, measured* in `docs/notes/gemini.md`).

**A private evaluation set**, in `forma-model-data\eval-real`, never
committed: the 6 distinct PDFs (19 pages; 18 with a text layer, one a scan)
beside the 600 printed real pages `realScore.ts` made on 2026-11-04.

## A better page reader under the box reader (2026-11-10)

The owner's decision of 2026-11-10 put a better page reader before any GPU
training (batch AC). PaddleOCR's PP-OCRv5 replaced Tesseract as the reader of
an English picture (docs/notes/app-shell.md, *OCR reads the text of an image
or a scan*), and the box reader was scored again on the same 200 printed
company reports, the model unchanged and trained on Tesseract's readings,
with `realScore.ts --cases-only` and `--ocr-cache` (new, so two readings of
the same pages compare exactly), PaddleOCR as the app runs it (the page drawn
twice its size, the detector reading it whole, the recogniser's narrowest
input 96):

| From the reading of | Printed texts found | Band right | Role right | Both | Group footers | Group headers | Footer totals | Pages built banded |
|---|---|---|---|---|---|---|---|---|
| Tesseract (the app until then) | 7,587 | 75.2% | 70.3% | 59.2% | 15.6% | 30.2% | 6.3% | 126 |
| PaddleOCR, as the app reads | 16,838 | 79.8% | 73.6% | 65.1% | 41.8% | 16.2% | 18.0% | 144 |

So the reader starts from more than twice the text and places more of it,
and group headers are the one band that got worse, most likely because the
reader learned them from Tesseract's lines, which run across a page (15 lines
on the screenshot PaddleOCR found 117 regions in) where PaddleOCR's regions
stop at each cell. Retraining it on PaddleOCR's readings is batch AE.

**A layout detector, measured and not adopted.** PP-DocLayout-S (PicoDet, 23
classes, Apache-2.0, 4.9 MB in a third-party ONNX export) was run over the
same 200 pages by `scripts/model/layoutCompare.ts`, each printed text taking
the class of the smallest region holding it. It reads a report page as
`chart`, `image` and `table` almost everywhere; its `header` class held 0.5%
of the report headers' texts and none of the page headers', and no class
picked out group headers (30% right by the reader) or group footers (16%).
Its `footer` held 44% of the page footers' texts, where the reader is already
at 94.5%. Its larger siblings are 130 MB and more, too large for a browser.
Report bands are a layout no document dataset labels, which is the reader's
case for being Forma's own.

## The box reader retrained for PaddleOCR, on every layout (2026-11-10)

Batch AE of the owner's AI accuracy programme: the reader learned again now
that the app reads an English picture with PaddleOCR, on every company layout
rather than a cap of 2,640, and on report layouts from outside the company.
Every model was scored on the 200 company reports printed by DevExpress, read
by PaddleOCR as the app reads them (`realScore.ts --cases-only --ocr-cache`),
the real pages deciding as before, and on the drawn pages held out.

**The data, all of it outside the repository** (`forma-model-data`):
- The 5,280 drawn pages of version 4's 2,640 layouts, read again by PaddleOCR
  (`scripts/model/paddlePages.ts`, four folders side by side, about an hour).
- **Every distinct company layout**: `npm run model:dataset` over the four
  sets with no cap packs 4,342 layouts, 1,524 of them new to the reader, drawn
  twice each (3,048 pages, `boxreader-v5b`). Their ids were prefixed `v5-`,
  since 606 of them had been given ids another layout carried in version 4.
- **FastReport's demo reports**, MIT (github.com/FastReports/FastReport at
  8909466f7fe9, `Demos/Reports`, the licence and commit kept beside the files):
  `scripts/model/fastreport.ts` writes each page as a minimal REPX that
  DevExpress loads ("nothing lost", `RepxProbe inspect`) and reads it with
  Forma's own `skeletonOf`, so a FastReport text takes its role as a company
  report's does. 112 pages became skeletons; 15 with a data band inside
  another (master and detail) and 12 with none were left out and counted. 100
  of the 1,524 new layouts are theirs.
- **Microsoft's paginated report samples**, MIT (github.com/microsoft/
  Reporting-Services at acc2ee0d1884): downloaded with their licence and not
  converted. They are seven, built of nested tables and charts, and would add
  0.2% to the layouts for a converter of their own.
- **The 2,860 pages DevExpress printed** from the Crystal skeletons
  (`printed.ts`, 2026-11-04), read by PaddleOCR.

**Each page as both engines read it.** The app reads English with PaddleOCR
and other scripts with Tesseract, so the reader meets both. `boxes.ts --cache
paddle-cache.json,ocr-cache.json` learns each page as each read it, and that
was what made the difference: trained on PaddleOCR's readings alone the reader
read the drawn pages far better and the real ones worse (v5a below).

**A page-number rule** (`settlePageNumbers`, `pages` in `DEFAULT_RULES`). On
the real pages page information is a bare number beside a caption of its own
on the last line in 58 of its 68 prints ("Page No." and "7"), and the
retrained readers took it for a value. On the last line, at or below nine
tenths of the page and of at most three texts, a text shaped like a page
number is page information when the line's other texts hold no digit. It took
the retrained reader's page information on the real pages from 52.5% to
94.9%, and changed nothing on the drawn pages.

**A records rule** (`records`, also in `DEFAULT_RULES`): in a Detail line a
total is a value. The retrained readers took a column of figures alike from
record to record for totals, which a design prints as a running sum in every
record; `boxReader.test.ts`'s plain listing caught it. It leaves page
information alone: a record's own number (`RecordNumber`) is page information
printed in Detail, as the company's Crystal layouts do, and a first version
that took it too cost the drawn pages 90 points of it.

| On the 200 real pages, read by PaddleOCR | Both right | First appearance | Footer totals | Group headers | Group footers | Detail | Page info | Pages banded |
|---|---|---|---|---|---|---|---|---|
| v1, the reader shipped until now, the app's rules then | 65.1% | 37.1% | 18.0% | 16.2% | 41.8% | 96.3% | 79.7% | 144 |
| v1 with the two new rules | 66.0% | 37.9% | 18.0% | 16.2% | 41.8% | 96.3% | 100% | 144 |
| v5a: v1's pages, PaddleOCR's readings only | 56.7% | 31.0% | 17.9% | 19.9% | 35.3% | 89.7% | 15.3% | 139 |
| v5a with the second look (`--context`) | 59.6% | 35.1% | 34.9% | 25.6% | 36.3% | 89.3% | 15.3% | 134 |
| v5c: v1's pages, both engines' readings | 65.2% | 39.4% | 21.7% | 32.5% | 41.1% | 94.4% | 18.6% | 148 |
| v5d: v5c and every layout, FastReport's among them | 64.8% | 39.0% | 33.7% | 35.4% | 37.7% | 94.8% | 39.0% | 156 |
| v5e: v5c and the 2,860 pages DevExpress printed | 63.7% | 46.1% | 55.8% | 39.7% | 58.3% | 87.5% | 52.5% | 152 |
| v5f: all of it | 62.2% | 44.6% | 61.5% | 40.5% | 61.5% | 84.1% | 98.3% | 146 |
| **v5e with the two new rules, shipped** | **66.2%** | **47.0%** | **55.8%** | **39.7%** | **58.3%** | **87.5%** | **94.9%** | **152** |

v5f was scored with the page rule only; every other row but the first and the last two with the app's rules of the morning.

**v5e ships** (`assets/model/boxReader.json`, 94,700 bytes, inside its budget), with both rules on. The scores that matter most here have long been each band's first appearance, what a design keeps, and on those it is 47.0% against 37.9% for v1 with the same rules, with footer totals at 55.8% against 18.0%, group footers 58.3% against 41.8%, group headers 39.7% against 16.2% and the page header 74.7% against 55.7%, and 152 pages built banded against 144. Overall it is level, 66.2% against 66.0%. What it gives up is Detail, 87.5% against 96.3%, records read as group bands, and the report header, 50.9% against 61.4%; the printed pages are richer in groups than the real reports, as version 3 found. The DevExpress-printed pages carried it where more drawn layouts did not: v5d read more pages banded, and v5f, with everything, lost Detail and the report header further. On the drawn pages, each model with the rules it runs: the 40 held-out pages as PaddleOCR reads them 88.5% both right against 82.1%, first appearances 78.0% against 72.1% and footer totals 86.3% against 73.5%, but three more of the 40 built as OCR's copy (9 against 6); the 560 held-out layouts 86.3% against 87.5%, their first appearances 81.8% against 81.2%. The models and every score are in `forma-model-data\boxreader-v5a` to `v5f`, the reader shipped until now beside them as `boxreader-v1\shipped-before-v5e.json`.

## What comes next

Each is its own milestone, with tests, docs and the checks, and is recorded
here as it is built:

1. ~~**The vision model of milestone 6**, above, to its end.~~ **Paused by
   the owner on 2026-11-05**: "pause vision model, fix box reader weak
   spots". Its best version placed 52.4% of text against OCR's 55.7%, and
   since the same day Forma drafts and the AI corrects (*Forma drafts, the AI
   corrects* in `docs/notes/gemini.md`), which needs the box reader's draft,
   not a vision model's. The training script, the datasets on Kaggle and the
   Ollama export stay as they are; a vision model named in Settings is still
   used as a helper.
2. **The box reader's weak spots**, from *Still to build* item 6, measured on
   the company's real reports as well as the drawn pages.
