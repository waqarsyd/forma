# The Gemini path

Split out of `CLAUDE.md` on 2026-08-13, carried across unchanged at the time apart from heading levels and the cross-references, which name the note they point at instead of saying "above". **It has grown since, so do not read it as a snapshot of that date** — every note here has taken new material in the weeks after the split, and `git log -- docs/notes/` is the record of what arrived when. (This paragraph claimed the text was still unchanged until 2026-08-20, by which point all four notes had been edited four or more times.) It is incident history — the reason a thing is the way it is, which the code cannot tell you. **Nothing here is loaded automatically**: `CLAUDE.md` routes to this file, and reading its one-line summary of this area is not a substitute for opening it before you change that area.

## The Gemini call runs in the browser, not on the server

`src/App.tsx` imports `analyzeReportDesign` from `src/services/geminiService.ts` **directly**, so it is bundled into the client and the request goes from the user's browser straight to Google.

**Forma is bring-your-own-key, and the application owns no key at all.** The only key in play is the one the user types into the config modal, which reaches `analyzeReportDesign` as `config.customApiKey`. There is no environment fallback, no `readEnv()` helper, and no server-side key. If `config.customApiKey` is empty the service throws `MissingApiKeyError`, which `App.tsx` catches to open the config modal.

This is the correction to a real incident, so do not undo it: `vite.config.ts` used to set `envPrefix: ['VITE_', 'GEMINI_']`, which inlined `GEMINI_API_KEY` into the shipped JS. Google's secret scanner found the key and revoked it — `403 PERMISSION_DENIED`, *"Your API key was reported as leaked."* The prefix list is now `['VITE_']` only. **Never re-add `'GEMINI_'` to `envPrefix`, and never reintroduce an env read on the key path in `geminiService.ts`.** To confirm what the browser actually receives, fetch the transformed module from the dev server (`curl localhost:3000/src/services/geminiService.ts`) — the injected `import.meta.env = {...}` prelude is the ground truth, and it must contain no key.

Because the key belongs to the user rather than to Forma, proxying generation through the server would be a step **backwards**: the server would become custodian of every user's third-party credential. `POST /api/generate-report` and `GET /api/debug-key` have both been deleted from `server.ts` for that reason, along with the `analyzeReportDesign` import. The server is now key-free and must stay that way; `GET /api/health` is all that remains.

**`app.use("/api", …)` returns a JSON 404 for anything else, and its position matters.** It sits after every real API route and before the dev/prod branch, so it covers both. Without it the production catch-all (`app.get('*')`) answered *any* `/api/*` probe with **200 and `index.html`** — so the deleted `/api/generate-report` and `/api/debug-key` looked like live endpoints to any client checking the status code rather than the body. Register new API routes **above** this guard or they will 404.

**`.env` does not contain a Gemini key and must not.** A `GEMINI_API_KEY` left in that file is inert — nothing reads it, and `envPrefix: ['VITE_']` will not carry it to the browser, so nothing is inlined into the client bundle either. `API_KEY` is gone entirely.

`.env.example` documents **three** optional variables — `VITE_FORMA_MOCK`, `HOST` and `HTTPS` — and `server.ts` loads them via `import "dotenv/config"`. `.env*` is gitignored except `.env.example`, whose comments say the same thing this paragraph does.

**`APP_URL` is not among them, and this note said it was until 2026-09-06** (as did `CLAUDE.md` until 2026-09-01, which is the more interesting half: the same wrong fact survived in two places and was corrected in one). It was removed on 2026-08-27 as read by nothing — audit INV-006 — and `.env.example` keeps a comment where it stood, explaining why a variable nobody reads is worse than no variable at all. A copy still sits in this machine's untracked `.env` and is inert. Do not restore it to the example, and do not write code that reads it.

## Where the user's key lives

`src/services/keyVault.ts` holds the whole storage story. Three tiers, and the key is never persisted in plaintext anywhere:

| Tier | Store | Lifetime |
|---|---|---|
| Working copy | `sessionStorage['geminiApiKey:session']` | Erased by the browser when the tab closes |
| Durable copy (opt-in, signed in) | Firestore `users/{uid}/vault/geminiKey` | AES-GCM **ciphertext only** |
| Legacy plaintext | `localStorage['customGeminiApiKey']` | **Purged on boot** by `purgeLegacyPlaintextKey()` |

`sessionStorage` is deliberate: the browser guarantees that erasure, whereas a `beforeunload` handler does not fire on crash, force-quit or mobile tab eviction.

The Firestore copy is **zero-knowledge**. `encryptApiKey()` derives an AES-GCM key from a user passphrase via PBKDF2-SHA256 (310k iterations, per-record salt and IV) and uploads only `{v, ciphertext, iv, salt, iterations}`. The passphrase never leaves the browser, so **a forgotten passphrase is unrecoverable by design** — there is no reset path, because one would mean the operator could read the key. Say so in any UI that sets a passphrase. `decryptApiKey()` honours each record's own `iterations`, so raising the constant never orphans existing records. `firestore.rules` pins that document's shape via `isValidKeyVault()` and rejects an `iterations` below 100000.

`crypto.subtle` exists only in a secure context (HTTPS or localhost). Over plain HTTP to a LAN IP it is `undefined`, so `isVaultAvailable()` gates the sync UI rather than letting it crash. Sign-out clears the session key and all vault state; the ciphertext in Firestore survives.

`scripts/build-server.mjs` defines `'import.meta.env': 'undefined'`. `server.ts` no longer imports `geminiService.ts`, so that define is now belt-and-braces rather than load-bearing.

### Containment, measured rather than asserted (2026-08-29)

The table above is the design. Until this date nothing had checked that the running app matches it — the claim "Forma ships no key of its own" is printed on the workspace, the landing page and the privacy policy, and it was resting entirely on reading the source.

Driven with a real key through the actual UI, mid-run:

| Where | Present |
|---|---|
| `sessionStorage['geminiApiKey:session']` | **yes** — the design |
| Any `localStorage` entry | no |
| `document.cookie` | no |
| Anywhere in the rendered DOM | no |

The hosts contacted during a generation were `generativelanguage.googleapis.com`, `firestore.googleapis.com`, Google Fonts, the loopback dev server, and the `127.0.0.1:7317` designer probe. **No server belonging to this project appears in that list**, which is the whole point of *The Gemini call runs in the browser* above.

Two things worth keeping if you repeat this:

- **Test the containment, not just the feature.** The interesting assertion is not "generation worked" but "the key is in exactly one place and no other". A leak here would not throw and no test would fail; it would simply be true.
- **Never let the key reach a file.** Pass it through an environment variable, redact it from anything printed, and use a throwaway browser profile you delete afterwards — `sessionStorage` can be written into a profile's session-restore data. `.gitignore` carries credential patterns as a backstop (see *Read this first* in `CLAUDE.md`), and a backstop is not a plan.

## `geminiService.ts` is a single mega-prompt

Everything the model needs — spatial mapping rules (1 inch = 100 units, Letter = 850×1100), a DevExpress XML "cheat sheet" of exact `ControlType` strings, XML-escaping rules, and the `ReportConfig` settings interpolated as `configInstructions` — lives in one template literal, paired with a `responseSchema` that forces `{markdown, layout, repxContent}`. Prompt text and schema must stay in sync; the schema is what guarantees parseable output. Defaults: `temperature: 0`, `maxOutputTokens: 65536`, and the model is **detected at request time** rather than defaulted — see below.

**An example in the prompt outranks an instruction below it, and that is not a theory.** The ROOT STRUCTURE block tells the model it MUST wrap `repxContent` "exactly like this" and then shows a literal `<XtraReportsLayoutSerializer …>`. That literal hardcoded `SerializerVersion="23.2.3.0"` / `Version="23.2"` while the user's chosen version arrived in `configInstructions`, which is interpolated **after** it. The model copied what it had just been shown, so **every generation came out 23.2 whatever the dropdown said** — the setting rendered, saved, and did nothing, for as long as the feature existed. Both attributes now interpolate `targetVersion` (from `config.version`, still defaulting to 23.2) and `targetSerializerVersion` (`X.Y.3.0`). The rule this leaves behind: **anything the config can change must be interpolated into the example itself**, not stated near it. A second copy of a value in a template literal is a second source of truth, and the concrete one wins.

`X.Y.3.0` is inferred from the two real files available to check — Forma's own `23.2.3.0` output and a `20.1.3.0` layout written by the installed designer. It is a pattern, not a lookup; if some release needs an exact build number, add a map keyed by version rather than widening the guess.

**The two artifacts can disagree about how many bands the report has, and the UI reports the `layout` one.** `layout.sections` and the REPX's `<Bands>` are meant to describe the same structure — the prompt says so explicitly, requiring a section's coordinates to be measured from its own top-left "exactly like a control's `LocationFloat` inside its band, so the two artifacts carry the same numbers". Nothing enforces it. The band count in the bench header and the status bar both read `result.layout.sections.length` (`App.tsx`), so they describe the mockup, not the file you download.

Observed on 2026-08-29, one generation from a two-page PDF: the readout said **2 bands** while `repxContent` carried a single `DetailBand` between two zero-height margin bands. Both artifacts were internally valid — the viewer's own `checkRepx` returned *"Valid DevExpress report XML"* — they simply described different structures. This is **one sample from a synthetic fixture**, so it is recorded as something to watch rather than a fault to fix: the honest reading is that the count is a property of the mockup and is labelled as if it were a property of the report. If it turns out to diverge on real documents, the fix is to source the number from the REPX (which is what gets exported) or to stop calling it "bands", not to make the model try harder. **Partly addressed on 2026-09-03**: the banded prompt asks for the layout's sections to mirror the emitted bands one for one, so the two structures now agree by instruction — which is not the same as being enforced.

**Why the version list reaches back to 20.1.** The ERP this was first built for is built against `DevExpress.XtraReports.v20.1` and its templates declare `SerializerVersion 20.1.3.0`, so a matching file drops straight into that codebase. 20.1 is also what is installed on the development machine, which is what `tools/RepxDesigner` is built against. **This paragraph used to add that a newer `.repx` will not open in an older designer, and that 20.1 was therefore the only version openable here. That was wrong** — see *SerializerVersion is a label, not a gate* below for the measurement. Verified end-to-end on 2026-08-13: generated with v20.1 selected, `SerializerVersion="20.1.3.0"` confirmed in the REPX pane, exported, and opened in a real 20.1 designer **with every control present**. Nothing automated covers this — the suite cannot open a designer — so it is a manual check to repeat whenever the ROOT STRUCTURE block or the version list changes. The version list is also restated in four UI surfaces and `docs/PRD.md` §2.4; they move together.

## The model is auto-detected, and there is no model picker

`resolveModel()` sends a 1-token probe to every candidate in `MODEL_PREFERENCE` **concurrently** (`Promise.all`), then picks the first *preferred* model that answered — not the first to reply. Probing used to be sequential and `await`ed one candidate at a time, which charged a full round-trip per rejected model before the real request could start; a key without access to the leading model paid that several times over on the first generation of every session. The probes are one token each, so firing all of them costs nothing that matters. A key-level rejection takes priority over a quota verdict when reading results, since it repeats for every candidate and is the real cause. The winner is cached in `sessionStorage['geminiModel:session']` so the cost is paid once per session. `config.modelName` still exists as a code-level pin (no UI) and skips detection when set.

`analyzeReportDesign` logs a timing breakdown (`model detection Xms, request Yms, total Zms`) plus the attachment payload size. Total wall-clock alone could not separate "detection was slow" from "the upload was slow" from "the model wrote a lot of XML" — three different problems with three different fixes. Read it in the browser's DevTools console — there is no in-app log viewer any more, see *`src/App.tsx` is the whole app* in [`app-shell.md`](app-shell.md).

This replaced a hardcoded `gemini-2.5-flash` default plus a dropdown, and the reason is worth keeping in mind before anyone re-adds either: **Google retires models "for new users."** Existing projects keep working while every freshly created key gets `404 — no longer available to new users`. Measured on a live key in this repo: `gemini-2.5-flash` and `gemini-2.5-flash-lite` both 404'd; `gemini-pro-latest`, `gemini-2.5-pro` and the `gemini-2.0-*` family returned 429 (no free-tier quota); only `gemini-flash-latest` and `gemini-flash-lite-latest` actually worked. The old dropdown also offered "Gemini 3.5 Flash/Pro", which existed for no one. A hardcoded id is a time bomb here, so `MODEL_PREFERENCE` **leads** with `gemini-flash-latest` — Google repoints the aliases, and whatever it points at is by definition still issued to new keys. The list is not aliases-only, though, and the interleaving is deliberate: `gemini-flash-latest, gemini-2.5-flash, gemini-flash-lite-latest, gemini-2.0-flash, gemini-pro-latest`. The hardcoded ids sit below an alias as fallbacks for a key that *does* still have access to them, and cost nothing to keep now that the probes fire concurrently. Only the lead position is load-bearing; do not promote a pinned id above it.

**Never resolve models from `models.list`.** That endpoint is not a reliable guide to what a key can call — it advertised `gemini-2.5-flash` with `generateContent` support while the real call 404'd. Only an actual request tells the truth, which is why `validateApiKey()` is implemented *as* a `resolveModel()` call rather than a catalogue lookup, and why it returns the chosen model for the UI to display.

**But it is now read for *discovery*, and the difference is the whole point** (2026-08-26). The rule above says the catalogue is unreliable about what a key can **call**; it is perfectly reliable about what **exists**, and those are different questions. The problem it answers was raised as "if a user pastes a fresh key in a year, does our hard-coded list still work?" — a fair question, because two of the five entries are aliases that track forward and three are pinned ids that cannot. `discoverModels()` reads `GET /v1beta/models`, `src/lib/modelCatalog.ts` filters and ranks what comes back, and every survivor is still confirmed by the same 1-token probe as before. **Catalogue proposes, probe disposes**; nothing was promoted to being believed.

Three things in that module are load-bearing and all fail silently:

- **The filter is deliberately mean.** `generateContent` must be *present* in `supportedGenerationMethods` — an entry that does not say is refused rather than given the benefit of the doubt — and the embedding, AQA, Imagen, Veo, TTS, Gemma and LearnLM families are excluded by name even though several of them do advertise `generateContent`. A wrongly admitted id does not cost a wasted probe; if it wins, it becomes the model every generation uses.
- **Dated, `-exp` and `-preview` variants are skipped.** One family can carry half a dozen snapshots, each of which would be a live probe request, to reach models that are by their own labelling not the ones to depend on. The stable name for the same generation is in the list beside them.
- **Ranking is by tier before recency: flash, then lite, then pro.** Rank by recency alone and a brand-new pro model leads the probe list, so the first key with pro access starts paying pro prices for every report with nothing in the UI to say so. `-latest` counts as newest within its tier, which is what the alias means.

`mergeCandidates` keeps `MODEL_PREFERENCE` in its exact order at the front and appends only what the curated list has never heard of, capped at ten candidates total. So the ordinary case is byte-for-byte the behaviour that was measured and tuned; discovery changes nothing until the curated ids stop working, which is precisely when it earns its keep. Discovery failing — no network, a blocked endpoint, an unexpected shape — resolves to an empty list, never an error, and the curated order is used exactly as before.

Verified over CDP against a mocked catalogue: with all five curated ids returning 404 and the catalogue advertising `gemini-7-flash`, `gemini-7-pro`, an embedding model, an Imagen model and a dated preview, the app probes the five curated plus exactly `gemini-7-flash` and `gemini-7-pro` (flash first), settles on `gemini-7-flash` and generates the report. With the catalogue returning something unusable, `gemini-flash-latest` still wins as it always did. **The residual risk is multimodality**: the probe is text-only, so a discovered model that accepts text but not images would pass it and fail at generation. Every Gemini text model to date has been multimodal; if that stops being true, the fix is to make the probe carry a 1×1 image rather than to re-freeze the list.

Order is deliberate: flash tiers precede pro because each user pays for their own usage. If a cached model 404s mid-generation, `analyzeReportDesign` clears the cache, re-resolves and retries **once**, silently — unless `config.modelName` was pinned, which is treated as an explicit instruction.

A **503 / `UNAVAILABLE`** is a different failure and is handled separately: it means Google's capacity for that model is momentarily exhausted, not that anything is wrong with the key, the model id, or the request. `analyzeReportDesign` retries the *same* model up to twice with a 2s then 4s backoff (plus up to 500ms of jitter — without it, every tab that got a 503 in the same second retries in the same second, which is how a busy model stays busy), using `sleep(ms, signal)` so pausing during the wait still aborts. Both retry paths share one loop and their counters are independent, so a re-detect followed by an overload cannot loop indefinitely.

**When those retries are spent it now changes model, and the earlier advice here not to was wrong** (2026-08-26, prompted by a user hitting the 503 message in practice). The reasoning that produced it — "it is upstream load, so the only remedies are backoff and waiting" — quietly assumed one capacity pool. There isn't one: a 503 is *that model's* capacity, and `MODEL_PREFERENCE` holds four alternatives that this key was **already probed against** at resolve time and already known to work. Giving up after ~6 seconds on one model while four known-good ones sat unused was leaving the easiest possible recovery on the table. `resolveModel` now keeps the whole usable set (`geminiModels:session`) rather than discarding everything but the winner, and the overload path walks it in preference order, resetting the retry counter per model.

Two deliberate limits on that. The fallback is **not** cached as the session's model, so the preferred one is tried first again next time once capacity returns; and `pinnedModel` opts out entirely, for the same reason the 404 re-detect does. If every usable model 503s, the error names them all — "try again" reads very differently when the user can see it was not one unlucky model. Verified over CDP against a mocked endpoint: with `gemini-flash-latest` returning 503 to every stream request, the run retries it three times, falls back to `gemini-2.5-flash` and produces the report with no error at all; with all five refusing, it walks the whole list and stops with the combined message after ~42s. That first case previously ended in the message the user reported.

`toFriendlyError` also unwraps provider JSON: these SDK errors often carry the whole `{"error":{"code":503,...}}` blob as their `message`, and rendering that verbatim showed the user a wall of braces. It now extracts `error.message` when the text parses as JSON.

Refinement turns pass `previousState` (prior `layout` + `repxContent`) so the model edits rather than regenerates — the prompt leans hard on "preserve the existing structure."

**Grids are now real tables on both sides.** Earlier revisions required a deliberate asymmetry — a real `<XRTable>` in `repxContent`, but the same grid **decomposed into per-cell `"label"` elements** in the `layout` JSON — because `ReportMockup`'s `"table"` branch was a hardcoded placeholder printing "Data Row 1" / "Data Row 2". That branch now renders the element's real `rows`/`cells`, so the prompt asks for one `"table"` element with a populated `rows` array instead. Weights are relative (like `XRTableCell`'s), so the model no longer hand-computes per-cell coordinates. Layouts saved before this change still contain decomposed labels and render fine — the label path is unchanged.

The `layout` element schema carries visual fidelity beyond geometry: `bold`, `italic`, `fontFamily`, `verticalAlign`, `wrap`, per-side `borderTop/Right/Bottom/Left` + `borderColor`, and `chartType`/`chartValues`. **All are optional and the renderer falls back to the old behaviour when absent**, which is what keeps previously-saved reports rendering. `hasBorder` is retained as the legacy all-four-sides flag; `borderStyleFor()` prefers per-side flags and falls back to it.

**Picture location is asked for in Gemini's own detection format, and that choice is load-bearing.** `"image"` elements carry `box2d: [ymin, xmin, ymax, xmax]`, each value normalised to **0–1000**, y before x, top-left origin. Asked instead for the more obvious `{x, y, width, height}` fractions, the model answered `{0,0,1,1}` — the entire page — for *every* picture in a multi-image design, so one box showed the whole upload and the rest were empty. Requesting the format it is actually trained to emit for object detection is what makes it localise. `boxToSourceRect()` converts to fractions; **the order really is y-first**, and reading it x-first transposes every crop into a plausible-looking wrong position rather than an obvious failure. This *is* now asserted: `boxToSourceRect`/`sourceRectFor` moved to **`src/lib/sourceRect.ts`** and `src/lib/sourceRect.test.ts` pins the ordering with a deliberately asymmetric box, so transposing it fails the suite. End-to-end the crop is still unverified — for that, check by hand against a design whose logo is off-centre in both axes, since a centred one looks identical under either reading. `sourceRectFor()` prefers `box2d` and falls back to the legacy field so reports saved before this change still render.

The legacy `sourceRect` is a rectangle in **fractions (0–1)** of one uploaded file, plus an optional `sourceImageIndex`. `cropSourceRegion()` crops that region out of the user's actual upload via a canvas and shows the real logo instead of a grey placeholder. Fractions rather than pixels because the model does not know the file's true dimensions. It returns `null` on a bad rect, a non-image upload, or a decode failure, and `MockupImage` falls back to the icon placeholder — so this degrades quietly rather than showing a broken image. The images come from `mockupSourceImages`, which prefers live `previews` and falls back to the last user message's `images`, so cropping still works for a report reloaded from history.

**`sourceRect` is validated, not trusted, and the reason is a real failure mode.** On a design containing *several* pictures the model would return one rectangle spanning the whole page, so a single picture box displayed the entire upload while every other image element came out empty. `cropSourceRegion()` now rejects a rectangle that is more than 90% of either dimension or over half the source area, and one whose aspect ratio differs from the target element's by more than 4×, logging which element was rejected. **A wrong crop is worse than no crop** — rejection falls back to the clean placeholder, which is the correct rendering for "could not locate this picture". The thresholds are a judgement call with no test behind them: tightening them silently stops legitimate artwork from cropping, so if you touch them, re-check the shapes they were chosen to admit — square logo, wide banner, tall signature, quarter-page photo. The prompt's "IMAGES AND LOGOS" block is the other half: it requires one element per picture, tight non-overlapping rectangles, and explicitly tells the model to omit `sourceRect` rather than guess. Keep both halves in sync.

Still decorative stand-ins, ignoring their real content: `"gauge"` and `"barcode"`. `"chart"` follows `chartType`/`chartValues` but is still stylized, not a real charting library.

**A truncated report used to be reported as a malformed one, and that mattered because truncation is the failure this app actually has.** The response is one schema-constrained JSON object, so a generation that runs out of output budget arrives as valid-JSON-until-it-isn't — usually cut mid-string inside `repxContent`, which is by far the largest field. `JSON.parse` throws, and until 2026-08-26 the catch said *"The AI returned a malformed report. Try generating again."* `finishReason` was consulted **only when the body came back empty**, which is the rarer case: a model that has been writing for a minute almost always has emitted something before it hits the ceiling. So the common failure blamed the model for bad output when the output was fine as far as it got, and told the user to retry — which, for the same input, fails identically every time.

The catch now checks `finishReason` on a failed parse: `MAX_TOKENS` gets a message naming the real cause and saying *not* to just retry, `SAFETY`/`PROHIBITED_CONTENT` gets its own, and only an unexplained parse failure is still called malformed. It also logs the received length, the `finishReason` and the last 120 characters, which is what makes the next report of this diagnosable rather than anecdotal. Reproduced over CDP by fulfilling the stream with 62% of a valid payload plus `finishReason: MAX_TOKENS` — see the harness pattern in [`app-shell.md`](app-shell.md); the whole client path (probe, stream, scanner, parse, render) runs against a mocked endpoint with no API key, and the one non-obvious requirement is that the SDK's `x-goog-api-key` header makes every call CORS-preflighted, so the interceptor must answer `OPTIONS` as well as `POST`.

**This changes the diagnosis, not the cause.** `maxOutputTokens` is already at 65536, the ceiling for these models, so there is no headroom to buy. The two real levers are both unmeasured: capping `config.thinkingBudget` (thinking is billed and *budgeted* like output, so a long silent reasoning pass eats the room the report needs — the field exists and is deliberately unset, and the comment on it says the trade should be measured, not assumed), and splitting the request so `repxContent` is generated separately from `markdown` + `layout`. Do not pick one from the armchair; a key and a large real design are what settle it.

## The units audit (2026-08-26)

A full read of the generation path, asked for as "does the .repx actually match the design, pixel for pixel". Four defects, all of the same family: **the pipeline had four coordinate systems and encoded three of them as bare literals in two files.** Every one failed silently — a wrong factor renders a plausible layout in the wrong place, never an error, and both artifacts look internally consistent while disagreeing with each other.

`src/lib/reportGeometry.ts` now owns all of them, under test (`reportGeometry.test.ts`), and is the only place a conversion should ever be written again.

1. **The page margin moved every control, and the extracted PDF coordinates made it certain.** The prompt hardcoded `Margins="100, 100, 100, 100"` with 100-unit margin bands, while telling the model that PDF-extracted coordinates are page-absolute and "need no conversion" for `LocationFloat`. But `LocationFloat` is measured from the **band**, and a band starts at the left margin. So a design mapped faithfully onto an 850-wide page was emitted into a band 650 wide and offset by 100: the whole report shifted an inch right and down, and the rightmost 200 units fell outside the printable area, where DevExpress clips them or pushes them to a second page. Margins are now `0` with zero-height margin bands, which makes the band's coordinate space identical to the paper's, and the prompt says so explicitly under *COORDINATE FRAME*. **Trade-off worth knowing:** zero margins means a physical printer's own unprintable edge is no longer reserved. That is the right call for a tool whose job is to reproduce an uploaded design — the design's own whitespace is already in its coordinates, and adding a margin on top double-counts it.

2. **Font size was in the wrong unit and nothing said so.** `fontSize` in the layout is in report units, like every other number there, and the mockup renders it correctly. But a DevExpress `Font` size is in **typographic points, always — it is the one value in the file that does not follow `ReportUnit`.** The cheat sheet never mentioned fonts at all, so a model carrying the layout number straight across produced text 39% too large at the default unit. The prompt now gives the conversion explicitly, with the arithmetic worked out in the prompt text itself. `unitsToPoints()` exists mainly so that number is computed rather than typed.

3. **The REPX was never asked for any appearance at all.** The `layout` schema carries `bold`, `italic`, `fontFamily`, `color`, `backgroundColor`, `textAlign`, `verticalAlign`, `wrap` and per-side borders; the DevExpress cheat sheet asked only for geometry and text. So the mockup could be a faithful reproduction while the exported file — the one the user opens and prints — was black Arial 9.75pt, left-aligned, unbordered, on white. A new *APPEARANCE IS PART OF THE REPORT* block maps each layout property to its `Font` / `ForeColor` / `BackColor` / `TextAlignment` / `Borders` / `WordWrap` equivalent.

4. **`pageSize` and `unit` were settings that did nothing.** The dialog offers Letter/A4/Legal and three report units; the prompt hardcoded `PageWidth="850" PageHeight="1100"` and `ReportUnit="HundredthsOfAnInch"`, then separately told the model to "adjust page dimensions accordingly" — contradicting itself and the user's setting. `FeaturesPage` advertised *"written into the XML along with the margins, so the sheet you review and the sheet that prints are the same size"*, which was false for two of the three sizes. Page dimensions now come from `pageSizeInUnits()`, and the unit flows all the way through: prompt, REPX root, PDF text extraction, and the mockup's px conversion. Note **A4 is 827 × 1169 units, not 850 × 1100**, and tenths-of-a-millimetre is **254** per inch, not 250 — the sort of number that looks right and is 1.6% wrong on every coordinate forever.

### The follow-up (2026-08-27): the tables were right and their callers were not

The audit above put every conversion in one place. It did not stop anything from
handing that place a value it could not convert, and `mergeStoredConfig` checked only that a
restored `unit` or `pageSize` was a *string*. So any string was accepted and then converted with
the **default** factor — the same silent-plausible-wrong failure, arriving through the one door
`reportGeometry.ts` did not guard: its callers.

Two values made it more than theoretical. **`Document` is a real `ReportUnit` member the table
simply did not carry**, so a legitimate setting converted at 100 units per inch instead of 300 — a
1-inch box written as 100 units, a 16-unit font emitted as 11.52pt instead of 3.84pt, a report at a
third of its intended size with both artifacts internally consistent. And **`Tabloid` fell back to
Letter, whose dimensions it matched exactly** at the default unit (850 × 1100 either way), so that
wrong answer was indistinguishable from the right one even to someone checking the output.

The value also travels further than the geometry: `geminiService` writes it verbatim into
`ReportUnit="…"`, so an unsupported string does not merely mis-scale — it lands in the XML and
DevExpress refuses the file. `config.unit || 'HundredthsOfAnInch'` passed anything non-empty
straight through, `"../../etc"` included.

Fixed in three places at once: the tables now carry all four `ReportUnit` members and Tabloid;
`mergeStoredConfig` validates the **domain**, dropping an unsupported value for the default rather
than throwing; and `geminiService` resolves both before use. Validation is **case-sensitive on
purpose** — DevExpress matches the enum name exactly, so normalising `"pixels"` would help right up
until it produced a file the designer refuses. The fallbacks remain as a second line of defence but
now `console.warn` with the offending value and the supported list, because the silence was the
actual defect.

**The table now leads and the dialog is a subset of it.** The old comment said the table matched
"what the config dialog offers", and matching the dialog rather than the enum is exactly how
`Document` went missing. In this direction a dropdown gaining an option is safe; the reverse was
not. The dialog still offers three units and three page sizes — exposing `Document` and `Tabloid`
is a product decision, and the geometry is ready either way.

**`checkRepx` would not have caught any of this, and now it would.** It passed the margined output happily — the XML parsed, the root was right, a `<Bands>` existed. It now measures every control against the printable area and its band and reports what will not fit, without blocking the export; see *`checkRepx` now measures the geometry* in [`app-shell.md`](app-shell.md). Verified against a deliberately mis-margined report driven through the real app: it named both offending controls and the band overflow, and Export stayed enabled.

**Partly verified on 2026-08-27, and the important half still is not.** A real generation was finally run against the live API with a temporary key. What it established: the pipeline works end to end (86.5s, a three-section layout, 2,887 characters of REPX), `checkRepx` accepts real model output with no warnings, the tags balance and the root closes, and `ReportUnit`/`PageWidth` arrive in the XML as configured. The 503 retry-and-fallback path also fired for real — `gemini-flash-latest` was overloaded, retried twice with backoff, fell back to `gemini-2.5-flash` and succeeded.

What it did **not** establish is fidelity, which is what this section is about. The input was `public/og-card.png`, a marketing card — not a PDF whose artwork starts at a known offset — so nothing was measured against a source. Worse for the purposes of item 2 above: **the output contained no `Font=` attributes at all**, so the points conversion that `unitsToPoints()` exists to serve was never exercised. The model's choice on that input, not a defect, but it means the font fix remains unproven against real output.

The honest test is unchanged and still owed: generate from a PDF whose artwork starts at a known offset, open the `.repx` in the designer, and measure a known element against the source. Treat item 2 in particular as a corrected instruction rather than confirmed fidelity.

The truncation bug did not reproduce either — but a three-section report from a marketing card is at the small end of what the product handles, and that bug is reported on larger ones. The parse-or-explain branch that decides how truncation is *reported* is now covered by fixtures in `src/lib/analysisResponse.test.ts`, including a payload cut off at 62%.

**Mock mode is opt-in:** set `VITE_FORMA_MOCK=true` and the service sleeps 3s and returns `MOCK_INVOICE_RESPONSE` without calling Gemini. It previously triggered whenever the key was missing *or the prompt merely contained the word "mock"* — under bring-your-own-key that was actively harmful, since a first-time visitor with no key, or anyone asking to "mock up an invoice", silently received a canned fake report with no way to tell it was not real output. A missing key now throws `MissingApiKeyError` instead. This env flag is the **only** remaining source of canned output; the `TEST_REPORT_LAYOUT` / `TEST_REPORT_MARKDOWN` / `TEST_REPORT_REPX` constants and their "Load Test Mockup" action are gone (the action had already been removed, leaving ~190 lines of orphaned fake-report data behind).

## The margin is drawn, not declared (2026-09-02)

Item 1 of the units audit above — *nothing has been opened in the real DevExpress designer* — was finally paid on 2026-09-02. A generated invoice was opened in a real 20.1 designer beside its source image, and the verdict was that **it matches**. What the eye caught instead was structural: the report declares no margins at all.

**The measurement.** `Margins="0, 0, 0, 0"`, both margin bands at `HeightF="0"`, and a content box of x 48..802, y 48..590 on an 850-wide page. A symmetric 48-unit (0.48in) border, present in the output as whitespace and absent from its structure. The model reproduced the design's margin faithfully — it just drew it, by pushing all 31 top-level controls inward, rather than declaring it.

On screen the two are indistinguishable, which is exactly why this survived a matching visual check. The cost is everything downstream of the picture: the file claims the whole sheet is printable, so a designer opening it gets no margin guides, a printer gets no non-printable-zone protection, and any band added later inherits one that runs to the paper edge.

**It is the prompt working as designed, not the model failing.** The ROOT STRUCTURE block pins the zeros and says why, under the heading *"COORDINATE FRAME — the single most common way this output comes out wrong"*: zero margins make a band's coordinate space identical to the paper's, so PHASE 1 coordinates and an extracted PDF text layer can be written straight into `LocationFloat`. Real margins would hand the model a subtraction to perform on every coordinate, and a control that keeps its paper coordinate lands silently in the wrong place and never throws.

**So the fix is arithmetic in `src/lib/repxMargins.ts`, not an instruction.** `liftReportMargins()` runs on every successful generation, at the single choke point in `analyzeReportDesign` where the parsed response is returned. It measures the content box, moves that whitespace into `Margins` and the two margin bands, and subtracts it back off the coordinates. A pure translation — same ink, same places — verified on the real file: 31 `LocationFloat` values rebased, **zero moved on paper**.

Three details are load-bearing:

- **Only top-level controls move.** An `XRTableCell` is positioned against its `XRTableRow`, not the band, so shifting it would move it twice. The parser is a tag stack rather than a regex over `<Band>…</Band>`, because `TopMarginBand` is self-closing and a non-greedy pair match swallows the next band's contents — the mistake that produced 22 phantom overflow reports when the banded and flat outputs were first compared on 2026-09-01.
- **Only left and top are measured; right mirrors left and bottom mirrors top**, each capped by the space actually free. The other two edges measure nothing — no control need approach the right edge (a page of short left-aligned labels leaves 700 units clear, which is empty space, not a 7in margin), and the last band's height is the model's choice rather than its content's.
- **The first body band absorbs the vertical shift**, losing the top margin from both its controls' y and its own height. Bands stack, so every band after it keeps its paper position untouched: the margin pushes them all down by T and the shorter first band pulls them back up by T.

It declines, with a reason, rather than guessing: when the report already declares margins, when the margin bands are absent, when any measured edge is under 0.1in — which is what full bleed looks like, and lifting a margin under a background block running to the paper edge would clip it — or when the arithmetic would produce a negative coordinate. A lift wider than 1.5in is clamped rather than declined, since any value up to the measured whitespace is safe.

**What this does not fix.** Everything lands in one `DetailBand`, which is the larger problem: a `DetailBand` prints once per record, so binding a data source makes the whole page repeat per row. **Fixed the next day** — see *The report is banded now* below. The margin lift is orthogonal to it and applies to banded output too, which `repxMargins.test.ts` covers directly; the couplings between the two are listed in that section.

## A cheat sheet is not an instruction (2026-09-03)

The owner's standing complaint about "inconsistency" had one reproducible cause: **the same ruled line-item grid came back as a real `XRTable` on one run and as 23 flat `XRLabel`s on the next**, and the difference was whether the user's own prompt happened to say the word *table*. Naming it — *"the line items are a real table with a header row"* — produced the table every time; a generic *"recreate this invoice"* usually did not.

**Nothing in the prompt was wrong. Something was missing.** PHASE 2's cheat sheet showed `XRTable` / `XRTableRow` / `XRTableCell` syntax perfectly, and the layout section told the model to emit `"type": "table"` for a grid. Neither said **when a region is a grid**. Faced with an aligned block of text the model was free to read it either way, and the labels are the path of less resistance — every cell's coordinates are already in hand from PHASE 1, whereas a table demands recognising the structure first. So the output tracked the wording of the request, which is exactly what "inconsistent" looks like from outside.

The fix is a recognition rule, `AN ALIGNED, REPEATING REGION IS A TABLE`, and four things about its shape are deliberate:

- **The signal is column alignment, not borders.** The rule says so twice, because the obvious heuristic — "it has lines around it" — misses the common invoice whose line items are separated by a single rule under the headings, or by nothing at all.
- **It states the cost, not just the rule.** A grid of labels *looks identical in the preview*, so there is no feedback anywhere in the app that would teach the model otherwise. What it loses is everything that made the artifact a `.repx` instead of a picture: those columns cannot be re-bound to a data source, resized, or repeated per record.
- **It forbids the arithmetic rather than describing it.** `An XRTableCell has no LocationFloat and no SizeF` — column widths are relative `Weight` values distributed across the table's own `SizeF`. Left implicit, a model that has just written 31 absolute coordinates will happily write 23 more into the cells.
- **It is repeated in PHASE 1.** That is not redundancy: PHASE 1 asks the model to *list the elements*, so a grid enumerated there as 23 labels is a decision already taken by the time PHASE 2 is read. The rule has to land before the enumeration, and be there to point back to after it.

The existing `DEVEXPRESS TABLES` line near the end was rewritten to reference the rule rather than restate the syntax — it had been asking for the cells' `LocationFloat` and `SizeF` to "match the requested design perfectly", which is the wrong instruction for a control that has neither.

**This is a prompt change, so nothing in the suite covers it** — the tests assert on the stream scanner and the response parser, not on prose. It was verified by reading, and the check that matters is a live run against a ruled grid with a prompt that does not use the word "table". Related: font sizes still come out ~20-25% small (the units audit's item 2), which is the same class of defect — self-consistent output, nothing throws, only visible against the source.

## The report is banded now, so it stops repeating per row (2026-09-03)

Until this date the prompt prescribed exactly three bands: a zero-height `TopMargin`, **one `DetailBand` at the full page height** holding every control, and a zero-height `BottomMargin`. A `DetailBand` prints **once per record**, so the first thing that happens when someone binds a data source to that file is that the entire page repeats for every row. There is no `ReportHeader` to print the title once, no `PageHeader` to carry column headings onto page two, and no `ReportFooter` for the totals — the line items arrive as a static `XRTable` with all eight rows hard-coded.

That shape was not an accident, and this is the trade it was making. With one band starting at the paper's top-left and `Margins="0,0,0,0"`, band coordinates and page coordinates are **the same numbers**, so the model can write PHASE 1 measurements and PDF-extracted positions straight into `LocationFloat` with no arithmetic. It works: 103 controls, zero out of bounds, zero overlapping, and a designer check on 2026-09-03 confirmed the output matches its source image. What it produces is a faithful picture of a report rather than a report.

**`src/lib/reportBands.ts` now holds both shapes and banded is the default.** The prototype was built and measured on 2026-09-01 (`11555e2`), reverted the same night (`11f9051`) pending the designer verdict, and is restored here as the shipping shape. **Both shapes lived here until 2026-09-05, when the flat one and its `VITE_FORMA_FLAT` flag were removed.** It was kept as a fallback on the grounds that flat had a designer check behind it and banded did not. That is still true — see *Not validated in a designer* below — but it stopped being the deciding question. Grouping, parameters, charts, cross-tabs and summaries were each added to the banded branch and to nothing else, so by 2026-09-05 the flag would not have returned the old report: it would have returned one missing every feature added since 2026-09-03, silently, at the moment someone was already troubleshooting a bad result. **A fallback that has rotted is worse than no fallback, because it looks like a way back.** The flat text is at `git show 696ac75:src/lib/reportBands.ts`.

**The A/B, same invoice, same key, same model, from the 2026-09-01 run:**

| | flat | banded |
|---|---|---|
| bands | Detail H=600, all 103 controls | ReportHeader 240 / PageHeader 25 / **Detail 20** / ReportFooter 160 / PageFooter 50 |
| controls | 103 in one band | 48 across 21 / 9 / **9** / 7 / 2 |
| data rows | all 8 hard-coded | 1 placeholder, the rest left to the data source |
| size | 20,608 chars | 10,547 |

**Band-relative Y is the risk, and essentially the whole risk.** Flat can say "subtract nothing"; stacked bands each have their own origin, so a heading measured at y=336 sitting in a `PageHeader` whose top edge is 320 must be written `LocationFloat="x,16"`. Get it wrong and the control sits far below its band — silently, because nothing throws. It is the same failure class `reportGeometry.ts` exists to contain, so the banded prompt carries the worked example rather than only the rule. The A/B says the model performs the subtraction when told to: **zero controls fell outside their band in either file**, checked with a tag-stack parser. (An earlier regex check reported 22 and 21 failures and was wrong — `TopMarginBand` is self-closing, so a non-greedy match swallows the following band's contents. The same trap is why `repxMargins.ts` parses with a stack.)

Four couplings, all of which will outlive the memory of this change:

- **The two artifacts now differ on purpose, in exactly one place.** The layout JSON keeps **every** data row, because the mockup is a picture of the source and a preview showing one row where the source has eight reads as the truncation bug. The `Detail` band keeps **one**. Everything else in the prompt insists the two artifacts agree, so this exception is stated in both of them — `tableRowsRule()` is the sentence that closes the table rule, and it is the only part of that rule that changes between shapes.
- **The margin lift depends on two sentences in this prompt.** `liftReportMargins` declines outright when the margin bands are missing, and the banded prompt invites the model to omit bands it has no content for — hence "TopMargin and BottomMargin are NOT optional". It also declines when *the first body band carries no controls*, which the flat shape could never trigger and this one can: an emitted-but-empty `ReportHeader` silently turns the margin lift off. The decline is right (whitespace held as band height is a different edit), so the defence is the instruction to omit a band rather than emit it empty.
- **The heading row and the Detail row are two tables that must agree.** They print directly above one another, so the prompt requires the same cell `Weight` values, the same x and the same width in both. This is the one table defect the preview cannot show, because the layout JSON draws them as a single table.
- **The band-count readout finally means something.** `App.tsx` reads `result.layout.sections.length`, which describes the mockup rather than the file — recorded above as something to watch. The banded prompt now asks for the layout's sections to mirror the bands one for one, minus the margin bands, so the two structures agree by instruction rather than by luck.

**Not validated in a designer.** The A/B measured structure, not appearance, and the open question is unchanged from the day the prototype was written: whether the band *heights* suit their content. Generate one document, open it in DevExpress 20.1, and look at it. If it is worse than the flat output, `VITE_FORMA_FLAT=true` is the way back and this note is the record of what the trade was.

## The fonts were measured off the ink (2026-09-03)

Every generated report came back with text **20-25% too small**, uniformly. The sample that pinned it: a 30-unit brand line arrived as `17.28pt`, where the same measurement done against an 8.5in page gives `21.6pt`. Nothing throws, and both artifacts agree with each other — the mockup renders the same small text the REPX carries — so it is only visible against the source.

**It is not the conversion.** `unitsToPoints()` is correct and under test, and the units audit's item 2 above already fixed the unit confusion in the other direction. The number arriving in the layout's `fontSize` was simply too small before any conversion touched it.

**A font's size is not the height of its letters, and nothing in the prompt said so.** The em size is the number in a font dialog; the capitals of a typical face stand at about 0.7 of it and the lowercase at about half. A model measuring the visible ink of a heading and reporting that as `fontSize` therefore lands ~30% low, which brackets the 20-25% observed. The prompt's only guidance was *"Match relative sizes carefully — a title must be visibly larger than body text"* — advice about **ratios**, which the model was already getting right. The absolute scale was never mentioned, so there was nothing to be wrong about and nothing to check against.

The rule now names the em size, gives two ways to measure that are not the ink — baseline-to-baseline spacing is 1.15-1.25× the size, or cap height ÷ 0.7 — and then **hands the model an anchor to check its own answer against**: ordinary printed body text is 9-11pt, interpolated into the layout's own unit by `pointsToUnits()` so it reads as a range of layout numbers rather than a conversion to perform. Body text below that range means the ink was measured and *every* size is small by the same fraction, so they scale back up together.

**The PDF path did not need a heuristic at all — it was discarding an exact answer.** pdf.js sets a text item's `height` to `Math.hypot(trm[2], trm[3])` (`pdf.worker.mjs`), the text transform's vertical scale, which **is the font's em size in points**. `extractPdfPageText` was already emitting it as `h=`, and the prompt was already telling the model that extracted numbers are exact and beat the page image — but it labelled that one as a height, so it became a box dimension and the font size got re-guessed from pixels beside it. Both the attachment header and *SOURCE PRECEDENCE* now say what `h` is: the string's exact font size as well as its height. For any PDF with a text layer this removes the estimate entirely.

Three things worth knowing before touching this again:

- **Do not "fix" it in code with a multiplier.** A blanket scale-up would corrupt the two paths that are already exact — a PDF's text layer and an uploaded `.repx`, both of which carry real font sizes — to compensate for a path that is an estimate. That is the opposite of the margin lift, which was safe precisely because it was arithmetic on numbers the model had got *right*.
- **`h` is 0 for vertical fonts**, which is the same branch that leaves them unsized in pdf.js. The prompt says so, and says to fall back to the image for those.
- **Nothing in the suite covers any of this.** It is prompt prose plus one line of extracted text. Verified by reading; the check that settles it is a generation from a PDF with a real text layer, then measuring a known heading in the designer against the source.

## The report that finished without the REPX finishing (2026-09-03)

There are **two** truncations in this pipeline and they had been discussed as one. Separating them is most of the fix.

**The loud one** cuts the response itself: `finishReason` comes back `MAX_TOKENS`, the JSON does not parse, and there is no report at all. `analysisResponse.ts` owns it and has since 2026-08-26, when it turned out that a cut-off-but-non-empty body fell through to *"The AI returned a malformed report. Try generating again"* — advice that fails identically every time, because the same input hits the same limit. That case is **explained, not fixed**, and still is.

**The quiet one is the one users actually reported.** The model returns a complete, valid JSON object — normal `finishReason`, intact `layout.sections`, a readable markdown spec, a mockup that draws — and inside it the `repxContent` string simply stops. Measured on a real generation: **896 bytes ending mid-attribute at `... Name=`**. Every signal the app had said success. The only broken artifact was the only one anybody opens in DevExpress, and `checkRepx` catches it at Export — at the far end of the wait, with nothing to be done but run the whole generation again.

**So it is caught at the parse now, and repaired there.** `src/lib/repxTruncation.ts` answers *did the model stop writing* — no DOM, no dependencies, pure string work, so it runs inside the service and under the node test environment. It is deliberately not `checkRepx`: that one answers *will the designer open this*, which a hand-written malformation fails just as a truncation does, and it needs a browser `DOMParser`. Truncation is a specific enough diagnosis to act on, which a generic parse failure is not.

**The repair is one focused rewrite of the XML alone**, and three things make it likely to fit where the first attempt did not:

- **It writes one artifact.** The markdown and the layout already exist and are correct, so the entire output budget goes to the XML.
- **It answers in raw XML, not XML escaped inside a JSON string.** Every quote in a DevExpress document is an attribute delimiter; escaping them all is pure overhead on the one artifact that ran out of room.
- **It transcribes rather than designs.** The layout it is handed carries every position, size, font, colour, border and table cell, so there is no measuring left to do — and no images are re-sent, because the layout *is* the specification by then and re-uploading the page would put the expensive half of the first request into the one meant to be cheap.

One attempt, and any failure leaves the original untouched: the rewrite is checked for completeness the same way the original was, and a rewrite that also stops early is discarded with a logged reason. Throwing here would lose a report that still has a working mockup and spec.

**Two things were considered and deliberately not done.**

*Reordering the response schema* so the XML is written before the layout — the standing suggestion from the day the bug was filed. It buys nothing on its own: if the JSON is cut anywhere it is unparseable everywhere, so field order only pays if partial JSON is salvaged, and salvage is real machinery for a failure that **three live runs could not reproduce**. If it is ever built, the order to want is layout before `repxContent`, so a hard cut leaves a complete layout and the rewrite above can finish the job. (Note the schema already emits `markdown`, `repxContent`, `layout` — the XML is second, not last, which the original report of this bug assumed.)

*Closing the open tags locally* to make a truncated document well-formed. It would turn a file the designer refuses into a file the designer opens with content silently missing, and `checkRepx` would then pass it. That is a worse failure, not a smaller one.

**The first-order mitigation landed earlier the same day and is not in this section.** The banded skeleton cut a dense invoice from 20,608 characters to 10,547 — the surest way not to run out of output budget is to need less of it.

**Not validated live.** No key was used for any of this: the detection is covered by fixtures cut the way the real one was, and the rewrite path has never run against Gemini. The honest test is a document that actually triggers the quiet truncation, and nobody has one — three attempts with dense invoices produced complete XML every time. Watch the console for *"The generated REPX is unfinished"*; that line firing is the first real evidence either way. The user is told nothing today beyond the existing Export refusal — threading a "this was repaired" notice through to the UI is the obvious next step and touches `App.tsx`, so it was left out.

## DevExpress can be asked directly, and it answers (2026-09-04)

**The most useful thing in this section is the method, not the findings.** Every REPX question this project could not settle from the documentation had been queued behind "open the designer and look" — a manual step that needs the owner's own desktop, because a GUI process started from an agent shell paints where nobody can see it. Four such questions had been waiting.

None of them needed the designer. `XtraReport.SaveLayoutToXml` and `LoadLayoutFromXml` are **library calls on an installed assembly**, with no window anywhere near them. A twenty-line console program compiled with `csc.exe` against `C:\Program Files (x86)\DevExpress 20.1\Components\Bin\Framework\*.dll` writes a report and prints exactly what the serializer produced — and, run the other way, says whether a file we generated loads and what it contains when it does. That turns "we think the XML looks like this" into a measurement, and it is repeatable in an agent shell in about a minute. **Reach for it before writing REPX syntax from a class reference.** The DevExpress API docs describe objects; they do not describe the file, and the file is what this app emits.

### `Ref` must be unique, and a duplicate deletes content

The finding that matters most, because the failure is silent and the app was exposed to it.

DevExpress uses `Ref` as **object identity** when loading. Two elements carrying the same value are not two objects with a clashing label — the loader treats the second as *the same object* as the first and discards what it said. Measured on one document differing only in its `Ref` values:

| | cells | bindings | texts |
|---|---|---|---|
| unique | 6 | 3 | all six |
| duplicated | 3 | 0 | header row only — the detail row was gone |

No exception, no warning, and a file that opens in the designer with controls missing.

Sequence, by contrast, is irrelevant: a document renumbered 101..114 loads fine, and an element with **no `Ref` at all** loads fine and re-saves byte-identically with `Ref` regenerated 0..19. It is write-side bookkeeping in every respect except uniqueness.

**Nothing was stopping a collision.** The prompt never asked for unique numbering, `checkRepx` parses for well-formedness and does not look at `Ref`, and the cheat sheet's snippets each restart from the bottom — the label example opens `Ref="1"` while ROOT STRUCTURE above it has already used `Ref="1"` for the `TopMarginBand`. That is precisely the shape *A cheat sheet is not an instruction* and the version-attribute incident both describe: a concrete example outranks whatever is said near it. `src/lib/repxRefs.ts` now renumbers repeats above the document maximum, keeping the first occurrence and leaving bare back-references alone; it runs first in `analyzeReportDesign`'s post-processing because every pass after it assumes the document DevExpress will load is the document we are looking at.

**Still inferred for the model's own output.** No live generation has been checked for collisions. The pass is silent when there is nothing to do and logs a warning when there is, so the next real generation settles it.

### `ItemN` is a position, `Ref` is an identity, and confusing them empties the report

The most expensive thing found this way, and it was **self-inflicted by the fix above**.

Every collection member is named for its index *within its own collection*: `<Rows><Item1><Item2></Rows>`, and inside each row `<Cells><Item1><Item2></Cells>`. The numbering restarts at 1 in every container. DevExpress looks members up by that name, so a `<Cells>` whose first child is `Item14` contains no `Item1` and **is read as an empty collection**.

The `Ref` rule added on 2026-09-04 said to number "straight through ... do NOT restart numbering inside a band, a table or a row". That is right for `Ref` and precisely wrong for `ItemN`, and the model applied it to both — the next real generation came back with `Item12/Ref="12"`, `Item13/Ref="13"`, `Item14/Ref="14"`, the two locked together. Measured on that report, changing nothing but the names:

    as generated   3 tables and 44 cells declared  ->  0 tables,  0 cells loaded
    renumbered     3 tables and 44 cells declared  ->  3 tables, 44 cells, 12 bindings loaded

No exception, no warning, a file that opens in the designer with every table missing. The user's report of "inaccurate" output was this.

Two lessons worth more than the fix. **A prompt rule about one attribute can be generalised by the model to a different one that looks like it** — "do not restart numbering" was heard as a statement about numbering in general. And **`RepxProbe inspect` caught it in one command on the first export**, where reading the XML by eye had not: the file looks entirely reasonable. `src/lib/repxItems.ts` now repairs it in code and runs first in the post-processing, before anything else reads the structure.

### `XRPageInfo` — the enum the cheat sheet never listed

Same generation, same diffing method: comparing our XML against DevExpress's own re-save of it showed `PageInfo="NumberOfPagesNoWith  PageNumber"` **dropped entirely** and `Format=` rewritten as `TextFormatString=`. The model invented an enum value by concatenating two ideas, because the cheat sheet showed exactly one example (`PageInfo="DateTime"`) and never said the property was an enum.

The eight members are `None`, `Number`, `NumberOfTotal`, `Total`, `RomLowNumber`, `RomHiNumber`, `DateTime`, `UserName`; "Page 1 of 12" is `NumberOfTotal` plus `TextFormatString="Page {0} of {1}"`. All now in the prompt. **Diffing an artifact against its own re-save is a cheap general audit** — DevExpress silently normalises what it understands and drops what it does not, so the difference is a list of everything being emitted wrongly.

### The binding syntax, transcribed rather than guessed

```xml
<Item1 Ref="10" ControlType="XRTableCell" Name="cellDesc" Weight="3" Text="Widget">
  <ExpressionBindings>
    <Item1 Ref="11" EventName="BeforePrint" PropertyName="Text" Expression="[Description]" />
  </ExpressionBindings>
</Item1>
```

Four things in there shape the code. It is `ExpressionBindings`, not the legacy `DataBindings`, and no report-level mode attribute appears. **The binding item carries no `ControlType`** — unlike every other element, which matters because the helpers locate things *by* `ControlType` and a binding is therefore invisible to them. `Text=` survives alongside the binding and is kept, as a fallback for a field that never resolves. A summary is an ordinary expression, `Expression="sumSum([Amount])"`, and `TextFormatString="{0:c2}"` is a plain cell attribute — so neither needed new structure.

### What binding does, and the two bugs that only the round trip found

`repxBindings.ts` derives a field name per column heading and decides whether a column earns a format; `repxBindingPlan.ts` locates the rows, proves they correspond, and splices.

**The flag that gated this is gone (2026-09-05).** It ran the pass over every generation, off by default because binding changes what the report *says* — a bound cell shows a field name where the source showed a number — and because the names were a guess at a schema taken from headings. The Data tab replaced it: a real schema in, a mapping the user corrects, and the names come from the data instead of the document. Keeping the flag would have meant maintaining two answers to one question with the worse one selectable, and a flag nobody turns on is a code path nobody tests.

One thing had to move with it. `bindFooterTotals` derived its own names independently, which was safe only while both passes derived identically. Given a real mapping they diverge — a detail row bound to `NET_AMOUNT` under a footer that derives `Amount` emits `sumSum([Amount])`, a field the source does not have, and the report opens with a total that prints nothing. It now takes the same mapping, and the Data tab passes one mapping to both.

The correspondence check is the design. Headings live in `PageHeader` and the data row in `Detail` — two tables in two bands with nothing tying them together — so binding column *n* to heading *n* is an assumption that fails exactly when a header cell spans two columns. When the counts disagree it declines, because a confident wrong field name in a file the user trusts is worse than no binding.

Two defects survived unit tests and were caught by loading the output back:

- **The wiring order was impossible.** `bindFooterTotals` called `planDetailBinding`, which declines once the detail row is bound, so the detail-then-totals order could never have applied a total. The two callers disagree about what "already bound" means — a stop condition for one, the expected state for the other — and folding that judgement into the shared analysis is what made the order unsatisfiable.
- **A sum was bound over a label.** The loader read back `ReportFooter.cell2: sumSum([UnitPrice])` on a cell whose text was `"Total"`. A binding overrides `Text` at print time, so the label would have silently become a number. The footer pass now also requires the cell to hold a figure itself.

### Grouping, measured the same way (2026-09-05)

Step 4 of the build order needed group bands, and `GroupFields` is exactly the kind of thing the class reference describes as an object and never as a file. So it was asked rather than guessed: `RepxProbe emit-group` builds a report with a `GroupHeaderBand`, a grouping field, `RepeatEveryPage`, a group-scoped summary and a `GroupFooterBand`, and prints what the serializer writes.

```xml
<Item3 Ref="7" ControlType="GroupHeaderBand" Name="GroupHeader" RepeatEveryPage="true" HeightF="20">
  <GroupFields>
    <Item1 Ref="8" FieldName="Category" />
  </GroupFields>
  <Controls>…</Controls>
</Item3>
…
<Item1 Ref="23" ControlType="XRTableCell" Name="cellGroupTotal" Weight="1">
  <Summary Ref="24" FormatString="{0:c2}" Running="Group" />
  <ExpressionBindings>
    <Item1 Ref="25" EventName="BeforePrint" PropertyName="Text" Expression="sumSum([Amount])" />
  </ExpressionBindings>
</Item1>
```

Four things in there shape the prompt and the audit:

- **`<GroupFields>` is a sibling of `<Controls>`, written before it.** A parser that takes a band's first child collection reads the grouping fields as its controls; `reportPreview.ts` has a test asserting the caption control is still found, because that is the shape that would silently draw an empty band.
- **A group field item carries no `ControlType`.** It is the second place after an `ExpressionBindings` item where that is true, and for the same reason it is invisible to anything that locates elements by control type.
- **`SortOrder` is omitted for the ascending default** — it was set *explicitly* to `Ascending` in the probe and still did not appear. So the prompt says not to write one, which keeps Forma's output identical to what DevExpress itself produces.
- **A group subtotal differs from the grand total only by `Running="Group"`.** The expression is the same `sumSum([Amount])`, so leaving `Running` off does not fail — it produces a running total of the whole report at every group break, which reads as a plausible number and is wrong. `Func="Sum"` is omitted as the default, so `Running` really is the whole discriminator.

Both files round-trip: the designer's own output and a hand-written Forma-shaped one (`Margins="0, 0, 0, 0"`, our `ItemN` numbering, unqualified `ControlType`) each load with nothing lost, and re-save with the group fields, `RepeatEveryPage` and the group `Summary` intact.

`repxAudit.ts` gained two checks from this, both for failures DevExpress accepts silently: a `GroupHeaderBand` with no `<GroupFields>` groups by nothing and prints once, which looks like a heading; and a `GroupFooterBand` with no header never breaks, so its subtotal becomes a second grand total above the real one.

### Parameters, and the first measurement that was a negative result (2026-09-05)

`RepxProbe emit-params` settled how a parameter serializes, and the shape is not guessable:

```xml
<Parameters>
  <Item1 Ref="2" Description="From date" ValueInfo="2026-01-01" Name="DateFrom" Type="#Ref-1" />
  <Item2 Ref="4" Description="Region" ValueInfo="North" Name="Region" />
</Parameters>
…
<ObjectStorage>
  <Item1 ObjectType="DevExpress.XtraReports.Serialization.ObjectStorageInfo, DevExpress.XtraReports.v20.1"
         Ref="1" Content="System.DateTime" Type="System.Type" />
</ObjectStorage>
```

The default is **`ValueInfo`**, not `Value`. A **string** parameter carries **no `Type` at all**. And any other type is a **`#Ref-N` pointer into an `<ObjectStorage>` block at the end of the document**, whose `ObjectType` is assembly-qualified and therefore version-specific.

**Then the measurement that mattered.** A hand-written file declaring `Type="System.DateTime"` inline — the form anyone would write from the class reference — loads without complaint, and the parameter comes back as `System.String` holding the text `2026-01-01`. `System.Int32` likewise. No exception, no warning, the file opens in the designer and the report's date filter compares strings.

That is the first time the probe has been used to establish that an obvious form is *wrong* rather than to discover the right one, and it is the better use of it. Everything else in this section could eventually have been found by trial; this could not, because the trial succeeds.

**So the conversion is code, not prompt.** Asking the model for an `ObjectStorage` section means asking it to allocate a `Ref` unique across a part of the document it never otherwise touches, and `Ref` collisions are already what `repxRefs.ts` exists to repair. The prompt asks for the readable `Type="System.DateTime"`; `liftParameterTypes` in `repxParameters.ts` rewrites it, allocating refs above every `Ref` already present, sharing one entry between parameters of the same type, merging into an existing `ObjectStorage` rather than writing a second, and removing a redundant `System.String` because that is what the serializer does. It declines on a type it does not recognise, since a bad `ObjectStorage` entry can stop the file loading at all — worse than a parameter that quietly falls back to string.

Verified end to end rather than by unit test alone: a file with inline types went through the real lift and back into DevExpress, which then reported `DateFrom : System.DateTime` and `MaxRows : System.Int32`. `RepxProbe inspect` grew a parameter readout for exactly this, and it prints `PARAMETERS LOST` when the declared and loaded counts disagree.

### Charts and cross-tabs, and the pattern that finally became a rule (2026-09-05)

`RepxProbe emit-chart`. Smaller than feared — a chart is about fifteen lines, not the hundred a designer file suggests:

```xml
<Item1 Ref="3" ControlType="XRChart" Name="chartSales" SizeF="600,300" LocationFloat="0,0">
  <Chart Ref="4">
    <DataContainer Ref="5" ValidateDataMembers="true">
      <SeriesSerializable>
        <Item1 Ref="6" Name="Sales" ArgumentDataMember="Region" ValueDataMembersSerializable="Amount" />
        <Item2 Ref="7" Name="Trend" ArgumentDataMember="Region" ValueDataMembersSerializable="Target">
          <View Ref="8" TypeNameSerializable="LineSeriesView" />
        </Item2>
      </SeriesSerializable>
    </DataContainer>
    <Diagram Ref="10" TypeNameSerializable="XYDiagram">…</Diagram>
  </Chart>
</Item1>
```

- The collection is **`SeriesSerializable`**, not `Series`, and the plotted field is **`ValueDataMembersSerializable`**, not `ValueDataMembers`. Both would be guessed wrong from the class reference, which names the properties.
- **A bar series writes no view type at all.** The probe set `ViewType.Bar` explicitly and nothing appeared; the `Line` series beside it produced `<View TypeNameSerializable="LineSeriesView" />`. So bar is the default and every other type is an extra child element.
- **A pie chart has no `<Diagram>`.** The XY types write one with `AxisX`/`AxisY`; the pie wrote none.

The cross-tab is three sibling collections next to an empty `<LayoutOptions />` and `<PrintOptions />`:

```xml
<RowFields><Item1 Ref="16" FieldName="Region" /></RowFields>
<ColumnFields><Item1 Ref="17" FieldName="Quarter" /></ColumnFields>
<DataFields><Item1 Ref="18" FieldName="Amount" /></DataFields>
```

**Four measurements in, the pattern is a rule.** An item in a collection carries no `ControlType` — expression bindings, group fields, chart series, and all three cross-tab field lists. Anything in this codebase that locates elements *by* `ControlType` is blind to every one of them, which is why `repxBindingPlan.ts` uses a substring test for bindings and why `reportPreview.ts` reads these collections by name rather than by type. Assume the next collection behaves the same way and check rather than infer.

Both a designer-written file and a hand-written Forma-shaped one load with the series and fields intact — `RepxProbe inspect` reports the view type DevExpress actually built, so `SideBySideBarSeriesView` coming back from a series that declared nothing is the confirmation that bar is the default rather than a guess that happened to work.

`repxAudit.ts` gained two checks, both for controls that load happily and print an empty frame: a chart with no series, and a cross-tab missing one of its three collections.

**`{0:n0}` is deliberately never emitted.** It renders 12345 as "12,345", which is right for a quantity and wrong for an invoice number, order id, product code or year — all columns of bare integers that one sample value cannot distinguish from a count. A format that mangles an identifier is worse than none, because the unformatted column was already correct. Currency and dates only, where the meaning is not in doubt.

### Auto-sizing: the bug that was not there (2026-09-05)

`RepxProbe emit-grow`, and the answer is that **there was nothing to fix**. It is recorded because the reasoning that produced the "defect" is reasonable, cheap to repeat, and wrong.

The claim was: DevExpress clips a label whose text is longer than its box unless `CanGrow` is set, `git grep CanGrow -- src/` finds nothing, therefore every generated report silently truncates any value longer than the sample the model saw. Plausible, matches a real DevExpress behaviour, and it is the same shape as the units and `Ref` defects — renders fine, fails on real data.

The measurement sets each property both ways on separate controls, so whichever value is *absent* from the file is the default:

| set to | written? | so the default is |
|---|---|---|
| `CanGrow = true` on `XRLabel` | **no** | `true` |
| `CanGrow = false` on `XRLabel` | yes | — |
| `WordWrap = true` | **no** | `true` |
| `WordWrap = false` | yes | — |
| `CanShrink = true` | yes | `false` |
| `CanGrow = true` on `XRTableCell` | **no** | `true` |
| `CanGrow = true` on `DetailBand` | **no** | `true` |

**Labels, table cells and bands all grow by default.** Emitting `CanGrow="true"` would put a redundant attribute on every control in every file — the same waste the grouping probe found for `SortOrder`, which DevExpress also omits when it is the default. Forma's silence is the correct output.

Two things follow. **`CanShrink` is the only one of the three that has to be asked for**, so if a report should collapse an empty row it needs it explicitly. And **the only real risk in this area is the opposite of the one suspected**: a `CanGrow="false"` or `WordWrap="false"` in generated output *would* clip, because those are non-defaults that have to be written deliberately.

**And one of them is asked for, deliberately.** The APPEARANCE block instructs `WordWrap="false"` on single-line labels *"so they clip instead of reflowing, matching the wrap flag in the layout"* — a design decision about fidelity to the source, not an oversight, and the measurement is what makes it legible as one: it is the non-default, so it is written, so it does exactly what it says. If a report ever turns out to be truncating a caption, that line is where to look, and the question to ask is whether the source really was a single-line label. `CanGrow` is untouched by any instruction and stays at its permissive default.

**The method note, which is the transferable part.** A grep for an absent attribute proves the attribute is absent. It says nothing about what the absence *means* — and for a serializer that omits every default, absence is the normal case rather than the exceptional one. Two of the five things this probe has now settled were negative results (`Type=` inline is ignored; auto-sizing needs nothing), and both looked like defects until measured. **Reach for `RepxProbe` before writing the fix, not only before writing the syntax.**

### The style sheet, and one attribute that changes its name (2026-09-05)

`RepxProbe emit-styles`. Every control the model writes carries its own `Font` and `ForeColor`, so a report using one heading treatment forty times repeats it forty times and restyling means forty edits that have to agree. This was the last remaining gap that improves *every* report rather than the subset containing a particular control.

```xml
  </Bands>
  <StyleSheet>
    <Item1 Ref="11" Name="HeadingStyle" Font="Arial, 12pt, style=Bold" ForeColor="255,26,43,60" Sides="Bottom" />
  </StyleSheet>
```

- **`<StyleSheet>` is a root-level collection, a sibling of `<Bands>`, written after it.**
- **A control refers to a style by NAME — `StyleName="HeadingStyle"` — not by a `#Ref-N` pointer.** That is why this one needs no change in `repxRefs.ts`, unlike parameters and cross-band controls, and it was worth checking rather than assuming given the other two.
- **A control's `Borders` is a style's `Sides`.** Same concept, different attribute name. Writing `Borders=` inside a style is silently ignored — the one thing here that trial and error would not have found, because the file still loads and the border simply never appears.
- An explicit attribute on the control still wins: `StyleName="HeadingStyle" ForeColor="Red"` writes both and the red survives. That is what makes hoisting safe.
- Tables carry `OddStyleName` and `EvenStyleName` of their own.
- A style item carries a `Ref` and **no `ControlType`** — the sixth collection where that holds, after bindings, group fields, chart series, cross-tab fields and checkbox bindings.

**So it is arithmetic on the output, not a prompt instruction** — `src/lib/repxStyles.ts`, the same shape as the margin lift and the parameter lift, and for the same reason: spotting that forty controls share an appearance is a global property of the document, and the model writes controls one at a time. `liftStyles` groups controls whose appearance attributes are **exactly** equal, hoists the whole set onto a named style, and deletes exactly that set from each member. Equality of the full set is what makes it provably equivalent; near-matches are left alone rather than approximated, because merging them would silently give one control a property it never had.

**Verified through the loader, not just by its own tests.** A lifted file was written out and `RepxProbe inspect` re-saved it through DevExpress: all six labels came back with their `StyleName`, the sheet came back with both styles, `Sides="Bottom"` was understood, and the hex `ForeColor="#1A2B3C"` was resolved to `255,26,43,60` — which incidentally confirms hex is accepted where the prompt already uses it.

**One gap left deliberately.** `BorderColor` and `BorderWidth` are not hoisted, because their spelling inside a style was never measured and a guessed attribute name is *silently ignored* rather than rejected — the exact failure the `Borders`/`Sides` finding demonstrates. They stay on the control, where they still apply.

### Shapes yes, rich text no (2026-09-05)

`RepxProbe emit-rich`, the last two controls from the DevExpress comparison that turn up in ordinary documents. One is cheap; the other is the third negative result.

**`XRShape` is straightforward, with one default worth knowing.**

```xml
<Item3 Ref="5" ControlType="XRShape" Name="shapeRectangle" SizeF="200,80" LocationFloat="0,140">
  <Shape Ref="6" ShapeName="Rectangle" />
</Item3>
```

- The figure is a `<Shape ShapeName="…" />` child — `Rectangle`, `Line`, `Star`, `Arrow`, `Bracket` and the rest.
- **`Ellipse` writes no `<Shape>` element at all**, because it is the default. So a bare `XRShape` is a circle, not an unknown, and a rectangle has to say so or it comes out round. `reportPreview.ts` reads absence as Ellipse for that reason.
- A figure with a parameter carries it on the same element: `<Shape StarPointCount="6" ShapeName="Star" />`.
- The item carries a `Ref` and **no `ControlType`** — the seventh collection where that holds.

**`XRRichText` cannot be authored, and that is the finding.** Its content serializes as `SerializableRtfString="…"`: a **base64-encoded UTF-16 RTF document**, about 2.5 kB for a single sentence. Setting `.Html` produced RTF as well — there is no HTML or plain-text form in the file at all.

So a language model cannot write one. Asking for it would produce a blob that either fails to load or loads as an empty box, silently, with the rest of the report intact around it. Generating the RTF in code is possible but buys only one thing an `XRLabel` cannot do — formatting that varies *within* a paragraph — at the cost of an RTF encoder whose failure mode is that same empty box.

**The prompt therefore says: do not create one; if the uploaded `.repx` has one, copy its `SerializableRtfString` across byte for byte.** That covers the case that actually occurs — fidelity to a legacy file — and refuses the case that does not. The Preview draws it as a marked block rather than decoding it, because empty space where the printed report has a paragraph reads as a control that got lost.

**Three negative results now** — inline parameter `Type=` ignored, auto-sizing needing nothing, and this. All three looked like gaps beforehand. That is a third of what this tool has been asked, and it is the argument for reaching for it before writing the fix rather than only before writing the syntax.

### Conditional formatting, and the fourth pointer (2026-09-05)

`RepxProbe emit-rules`. "Print overdue amounts in red" is what every statement and aged-debt report does, and Forma could not express it at all.

```xml
  <FormattingRuleSheet>
    <Item1 Ref="1" Name="OverdueRule" Condition="[DaysOverdue] &gt; 30">
      <Formatting Ref="2" Font="Arial, 9pt, style=Bold" ForeColor="Red" />
    </Item1>
  </FormattingRuleSheet>
  <Bands>
    <Item2 Ref="6" ControlType="DetailBand" Name="Detail" HeightF="60">
      <FormattingRuleLinks><Item1 Ref="7" Value="#Ref-1" /></FormattingRuleLinks>
```

- **The sheet is root-level and written BEFORE `<Bands>`** — the opposite side from `<StyleSheet>`, which is written after. Two root collections, opposite ends, no reason visible in either.
- **A control links a rule by `#Ref-N`, in a `Value` attribute — the fourth pointer in this format**, after a parameter's `Type` and a cross-band control's `StartBand`/`EndBand`. Bands take links the same way, which is how a whole row is highlighted.
- Link order is application order. The link item carries a `Ref` and **no `ControlType`** — the eighth collection where that holds.
- `Condition` is an ordinary expression, XML-escaped.

**`repxRefs.ts` needed no change, and that is worth knowing rather than assuming.** Its `REF_POINTER` matched `Value="#Ref-1"` on the first try because it matches the attribute *value* rather than any particular attribute name — so the ambiguity warning already fires when a linked rule's `Ref` is renumbered. Only the warning's wording was extended to name rule links. **Keep that property if the pattern is ever edited: a fifth pointer attribute should need no change either.**

**The prompt does not let the model invent a rule from an image, and the reason is not caution.** Conditional formatting is a *behaviour*; a scanned page shows one row that happened to be overdue the day it printed, not the condition. So a rule is emitted only when the uploaded `.repx` already has one or the user asks in words — the same shape as the subreport and rich-text decisions, arrived at from a different direction.

**Two audit checks, both for failures of behaviour rather than of content**, which is why nothing above them could have caught these: a link naming a `Ref` that is not a rule (an **error** — it never fires, so the report prints as though the condition was never met), and a rule nothing links to (a warning — usually the link went on the wrong element).

### Calculated fields, and a requirement that is not there (2026-09-05)

`RepxProbe emit-calc`. A total column written as the literal 37.50 is correct once and wrong for every other row; written as `[Quantity] * [UnitPrice]` it is correct for all of them. That is the difference between a picture and a report, and it was the last data-shaping feature entirely missing.

```xml
  <CalculatedFields>
    <Item1 Ref="1" Name="LineTotal" FieldType="Decimal" Expression="[Quantity] * [UnitPrice]" />
    <Item2 Ref="2" Name="Margin" FieldType="Decimal" Expression="[Price] - [Cost]" DataMember="Orders" />
  </CalculatedFields>
```

**The finding that decided whether this was possible at all is a negative one about a requirement.** `CalculatedField` has `DataSource` and `DataMember` properties, and Forma never opens a connection — that is a stated boundary, not a gap. If either were required, a generated calculated field would name a connection that does not exist. Neither is: `DataMember` is written only when set, and the first field above is complete without it.

- The collection is root-level and written **before** `<Bands>`, like `<FormattingRuleSheet>` and unlike `<StyleSheet>`.
- `FieldType` is written every time, including for `String` — one of the few things here that is *not* omitted for a default.
- **A control references a calculated field exactly as it references a real one**: `Expression="[LineTotal]"`, with nothing to say it is calculated. Convenient for the model, unhelpful for checking — nothing in a binding can tell us whether a name resolves, which is why the audit checks are all about the declarations rather than the uses.

**The prompt forbids inventing one from a heading.** "Total" next to "Amount" is not evidence of a formula. A calculated field with a guessed expression produces confidently wrong numbers on real data, which is worse than the literal it replaced — so it is emitted only where the arithmetic is visible in the source, a column whose printed values are plainly the product or difference of two others on the same row.

Three audit checks, all silent failures: an empty `Expression` (**error** — every bound cell prints blank), two fields sharing a `Name` (**error** — the later wins and bindings compute the wrong thing), and a field nothing uses (warning — usually the cell that should carry it still holds a literal).

### Sorting, and two collections that look identical (2026-09-05)

`RepxProbe emit-sort`. Three answers, and the third is a trap.

```xml
<Item3 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="20">
  <SortFields>
    <Item1 Ref="5" FieldName="CustomerName" />
    <Item2 Ref="6" FieldName="OrderDate" SortOrder="Descending" />
  </SortFields>
  <Controls> ... </Controls>
```

- **Sorting is a property of the DetailBand, not of the report** — which is not what "sort fields" suggests. On any other band DevExpress keeps the collection and never applies it, so a sort on a PageHeader is a sort that silently does not happen. `repxAudit.ts` warns about exactly that.
- **`SortOrder` is written only for `Descending`.** Ascending is the default and writes nothing, confirming what `emit-group` found for `<GroupFields>`. The prompt has to say so, or the model writes `SortOrder="Ascending"` and produces a file DevExpress would not have written.
- **`<SortFields>` and `<GroupFields>` have identical item shapes** — `FieldName` plus an optional `SortOrder`, no `ControlType` — so **only the parent element name distinguishes them**. Anything reading these has to key on the parent: an audit that did not would report every grouped report as mis-sorted, and a preview parser that took a band's first child collection would read sort fields as controls. Both are pinned by tests now.

That last point is the same shape as the `<GroupFields>` finding recorded above, arriving a second time. **Assume any new band-level collection is written before `<Controls>` and shaped like these two**, and check the parent name rather than the item.

### Watermarks, and half a feature (2026-09-05)

`RepxProbe emit-mark`, and the answer splits the way rich text did.

**A text watermark is six attributes and fully authorable**, written as a single element AFTER `</Bands>` — the same side as `<StyleSheet>`, the opposite side from `<FormattingRuleSheet>` and `<CalculatedFields>`:

```xml
<Watermark Ref="7" TextDirection="BackwardDiagonal" Text="DRAFT" Font="Arial, 72pt, style=Bold" ForeColor="Silver" TextTransparency="150" />
```

**An image watermark is not.** It writes `ImageSource="…"` carrying base64 — **172 characters for a 4x4 bitmap** — so a real picture is enormous and a model cannot author one. The prompt asks for text watermarks and, for an uploaded file that has an image one, to copy `ImageSource` across byte for byte.

Three smaller things worth having written down:

- `TextTransparency` is 0–255 and **255 is opaque**, which is the opposite of what the name suggests to most readers; 0 makes the watermark invisible. The prompt gives a usable range rather than asking the model to reason about it.
- The element carries a `Ref` and no `ControlType`, like every other non-control element here.
- `ForeColor="Silver"` came back for a `#C0C0C0` input — DevExpress resolves to a named colour where one exists, as it did for `ForeColor="Red"` in the formatting-rule probe.

The Preview draws it behind the bands on every page, with `pointer-events: none`. That last part is not incidental: the watermark covers the whole sheet, and without it nothing underneath could be selected or dragged — the same mistake the panel wrapper made earlier the same day, which is why it is stated rather than assumed.

### Multi-column detail, and a third element before `<Controls>` (2026-09-05)

`RepxProbe emit-cols`. Records flowing into columns — a label sheet, a phone list, a two-up catalogue.

```xml
<Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="40">
  <MultiColumn Ref="3" ColumnCount="3" ColumnSpacing="20" Layout="AcrossThenDown" Mode="UseColumnCount" />
  <Controls> ... </Controls>
```

- **It is a child of the BAND, written before `<Controls>`** — the third band-level element to sit there, after `<GroupFields>` and `<SortFields>`. The generalisation written when the second one turned up held for the third, which is the only real evidence a generalisation ever gets.
- **A band left alone writes nothing at all**, so absence means one column rather than "not configured". Same shape as `CanGrow` and as a shape with no `<Shape>` child.
- **The attribute is `Layout`, not `Direction`.** The API property called `Direction` is obsolete and the serializer writes `Layout`, so code written from the class reference names an attribute that does not exist.
- **`Mode` decides which size property is read.** `UseColumnCount` reads `ColumnCount` and ignores `ColumnWidth`; `UseColumnWidth` does the reverse. Setting one and declaring the other mode is silently a single-column report.
- `DetailReportBand` writes `Level="0"`, noticed in passing and worth knowing before something tries to parse one.

**The Preview draws the columns as of the same day.** `PlacedBand` gained a `left` and a `width`, and `paginate` lays the records on a `rows × count` grid rather than advancing a single vertical cursor — which is the one thing that cannot describe two records at the same height. Only the Detail band is divided; headers, footers and group bands keep the full page width. The grid is **recomputed per page**, because the first page is shorter by the height of the ReportHeader, and computing it once would under-fill every page after it in a way that reads as a bug in the report rather than in the paginator.

**One thing here is still unmeasured, and the prompt was corrected rather than left asserting it.** The block first said the band keeps the full page width and DevExpress divides it, so controls should *not* be narrowed. That was inferred, not measured — and driving the app showed the consequence immediately: a table sized to the page overflows its column. The prompt now says to size controls to one column, `(850 − 40) / 3 = 270` for three columns with 20 spacing.

**That question is now answered, by the first probe here that measures RENDERING rather than serialization.** `RepxProbe render-cols` calls `CreateDocument()` and reads the bricks — the positioned rectangles DevExpress produces when it actually lays the report out.

| | |
|---|---|
| an over-wide control | **is not clipped.** A label declared at the full page width came back at the full page width, so it prints straight over the next column. The page then looks like overlapping content rather than a width mistake, which is why the prompt now says to size controls to one column and says *why*. |
| column 2's x offset | `(columnWidth + spacing)`, exactly as the paginator computes it. |
| **the default `Layout`** | **`DownThenAcross`** — twelve records filled the first column before any reached the second. |

**That last one was a live bug in this repository.** `parseColumns` defaulted to `AcrossThenDown`, so a `<MultiColumn>` with no `Layout` attribute would have been previewed filling across the page when DevExpress fills down it. Every fixture in the suite set `Layout` explicitly, so the wrong default was invisible to 85 passing tests — it now has a case of its own, and so does the pagination that depends on it.

**Two API traps in the brick walk**, both the same shape and both costing a run that printed nothing at all: `Page.InnerBricks` holds the children, not `Page.Bricks`; and a `CompositeBrick` likewise keeps its children in `InnerBricks` while `Bricks` is also present and non-empty. Walking `Bricks` finds nothing and looks exactly like an empty page.

One observation deliberately left unexplained: column 2's first record started 180 document units down rather than at 0. Nothing here depends on it and no explanation was measured, so none is offered.

### Bookmarks, and a prediction that held (2026-09-05)

`RepxProbe emit-book`. The document map beside a long report, and the outline it exports into a PDF.

```xml
<Item1 Ref="3" ControlType="XRLabel" Name="labelSection" Text="Northern Region" Bookmark="Northern Region" ... />
<Item2 Ref="4" ControlType="XRLabel" Name="labelCustomer" Text="Acme Ltd" Bookmark="Acme Ltd" BookmarkParent="#Ref-3" ... />
```

- **`BookmarkParent` is a `#Ref-N` pointer at another CONTROL — the fifth pointer attribute in this format.**
- A bookmark can be an expression: an `<ExpressionBindings>` item with `PropertyName="Bookmark"`. That is the useful form inside a Detail band, where a literal repeats once per record.
- `BookmarkDuplicateSuppress = true` wrote **nothing at all**. What that means is not established — it could be the default or it could be unserialized — so nothing was built on it and nothing is claimed about it here. Recording the observation without the inference is the point.

**The prediction in `repxRefs.ts` was written after the fourth pointer and tested against the fifth, and it held.** That module says its pattern needs no change for a new pointer attribute because it matches the attribute *value* rather than the name. `BookmarkParent="#Ref-3"` was left alone and the ambiguity warning fired, with no code change — only the warning's wording gained the fifth name. That is the difference between a property and a coincidence, and it is why the comment now says a *sixth* should need no change either: keying on attribute names would have cost two changes already.

Two audit checks, both flat-map failures rather than load failures: a `BookmarkParent` naming a control that carries no `Bookmark` of its own (the child cannot nest, so it lands at the top level beside the section it belongs inside), and a literal `Bookmark=` on a control in the Detail band (forty rows, forty identical entries — the map becomes useless in exactly the reports long enough to need one).

### Gauges and sparklines, and a half-feature that had been there all along (2026-09-05)

`RepxProbe emit-gauge`. The reason to do these two now was not that they are common — it is that **`gauge` has been a valid element type in the LAYOUT schema since long before today while the prompt gave no REPX syntax for it at all.** The model could put a gauge in the mockup, the mockup drew it, and the exported file simply never contained one. That is the layout/REPX divergence the prompt forbids everywhere else, sitting in the schema unnoticed.

```xml
<Item1 Ref="3" ControlType="XRGauge" Name="g" TargetValue="90" ActualValue="72" Minimum="0" Maximum="100" ... />
<Item2 Ref="4" ControlType="XRGauge" Name="g2" ViewStyle="Horizontal" ViewType="Linear" ActualValue="40" ... />
<Item5 Ref="8" ControlType="XRSparkline" Name="s" DataMember="Monthly" ValueMember="Amount" ...>
  <View Type="Line" />
  <ValueRange Ref="10" />
</Item5>
```

- **`ViewType="Circular"` is never written** — Circular is the default, so a dial is just its four numbers. Setting `Linear` also writes `ViewStyle="Horizontal"` as a side effect, which nothing asked for.
- A gauge's value binds like any other property: `PropertyName="ActualValue"`. Inside a Detail band that is almost always what is wanted.
- **A sparkline needs no data source.** `DataMember` and `ValueMember` are flat attributes — the same answer calculated fields gave, and the second time that question has come back positive.
- **`<View Type="Line" />` is the one child element in this format that carries no `Ref`** — while still consuming a number in the sequence. So a gap in the Ref numbering is normal and is *not* evidence of a dropped element, which is worth knowing before something reads a gap as damage.
- Building the probe needed `DevExpress.XtraGauges.v20.1.Core` referenced, because `XRGauge.ViewType`'s enum lives there. **The `.repx` itself needs nothing extra** — the `ControlType` is a bare `XRGauge` — so the file stays portable; only C# touching the enum pays. The namespace was found by reflecting on the assembly rather than guessed, after two wrong guesses.

The Preview draws both as their **settings** rather than their data: the range, the literal value if there is one, the bound property name if there is not. Same decision as charts and cross-tabs — a needle at an invented position on a page someone is checking for accuracy is worse than no needle.

**One signal was narrowed while doing this.** `XRSparkline` had been a *charts* signal in `promptSections`, so a report containing a sparkline pulled in three kilobytes of chart and cross-tab syntax it had no use for. It is now only a gauges signal, and a test pins that the two sections do not drag each other in.

### The table of contents, and an exception that names the wrong rule (2026-09-05)

`RepxProbe emit-toc`. Folded into the bookmarks section rather than given its own, because the two are useless apart: a table of contents lists bookmarks, and a report with neither needs neither.

```xml
<Item1 Ref="3" ControlType="XRTableOfContents" Name="tocStyled" LocationFloat="0,220">
  <LevelTitle Ref="4" Text="Contents" Font="Arial, 16pt, style=Bold" Padding="0,0,0,0,100" />
  <LevelDefault Ref="5" Height="177" Font="Arial, 11pt, style=Bold" Padding="0,0,0,0,100" />
</Item1>
```

- **No `SizeF` is written.** It was set to 800x200 and discarded — the control sizes itself from the entries it finds, so `LocationFloat` is written and the size is not. That is the first control here that ignores a size outright.
- `LevelTitle` is the heading, `LevelDefault` styles the rows; both are children with their own `Ref`. `LevelDefault` came back carrying `Height="177"`, computed rather than set.

**This is one of the very few places DevExpress throws instead of silently ignoring — and the message names the wrong constraint.** Adding a second table of contents raises *"The Table Of Contents can be placed only into Report Header and Report Footer bands"*, which is a true statement about a different rule: the band was already a ReportHeader. The actual violation is that a report may hold only **one**. Isolating it took adding the two controls separately and watching which call threw; the first succeeded.

So the audit checks neither placement rule — a file breaking either never loads at all — and checks the one DevExpress accepts: **a contents page in a report with no bookmarks**, which prints a "Contents" heading over an empty page. That is the worst version of this control, because the heading makes it look like the content is still coming.

### The character comb, and a default that goes the other way (2026-09-05)

`RepxProbe emit-comb`. One boxed cell per character — how a form asks for a postcode, a reference or an account number.

```xml
<Item1 Ref="3" ControlType="XRCharacterComb" Name="combPlain" Text="AB12" SizeF="400,40" LocationFloat="0,0" />
<Item2 Ref="4" ControlType="XRCharacterComb" Name="combSized" CellWidth="30" CellHeight="40" CellHorizontalSpacing="6" CellVerticalSpacing="4" CellSizeMode="Custom" ... />
```

- **Every cell metric has a default, and an untouched comb writes none of them** — just `Text`, `SizeF` and `LocationFloat`.
- `CellSizeMode="Custom"` is the pairing again: set the cell size *and* the mode, or the size is ignored. That is the third control with this shape, after `MultiColumn`'s `Mode`/`ColumnCount` and the parameter's `Type`. **Assume any DevExpress size property has a mode that switches it on.**
- **`Borders="All"` was set and NOT written**, so `All` is a comb's default — the opposite way round from an `XRPanel`, where `Borders="All"` *is* written. A default is per-control, not per-attribute, and reading one control's behaviour onto another is how this gets wrong.
- Text binds normally, which on a form filled from data is what it should be.

Two properties guessed from the class reference did not exist (`CellBorderWidth`, `CellBorderColor`) and the `CellSizeMode` enum was in `DevExpress.XtraPrinting`, not `…UI`. Both were settled by **reflecting on the installed assembly** rather than by a third guess, which is now the faster move whenever a property name is uncertain:

```powershell
$asm = [Reflection.Assembly]::LoadFrom("$bin\DevExpress.XtraReports.v20.1.dll")
$asm.GetType('DevExpress.XtraReports.UI.XRCharacterComb').GetProperties() | Where-Object DeclaringType -eq $_
```

### The two PDF controls, and one that does not exist (2026-09-05)

The last two names on the DevExpress comparison. **Reflection answered both before a probe was written**, which is the note worth taking from this one.

**`XRPdfSignature` is not in DevExpress 20.1 at all.** It is a later addition, so it was never a gap against the version this project targets — the comparison list had been read off the *current* documentation. Anything taken from `docs.devexpress.com` describes the newest release; the installed assembly is the authority for what 20.1 has, and `\$asm.GetType(...)` settles it in a second.

**`XRPdfContent` is authorable, and still refused.** `RepxProbe emit-pdf` shows two forms — `SourceUrl="Terms.pdf"`, a plain path, and `SourceSerializable="…"`, the whole PDF as base64. So unlike `XRRichText` this is not a blob-only control. It is refused anyway, for the subreport's reason: the model has no basis to invent either one. A path names a file that will not exist on the reader's machine, and base64 means inventing a document. The prompt says do not create one; if an uploaded `.repx` has one, copy the attribute across byte for byte.

**And a measurement that outgrew the question.** A control set to `SizeF="800,400"` came back `650` wide — which is 850 less the default 100-unit margins. Re-running with `Margins` zeroed returned **850**, not the 800 that was set. So `XRPdfContent` does not clamp to the printable width, it *is* the printable width: the `SizeF` width is ignored outright and the height is honoured. Worth knowing before anyone spends effort computing a number the control discards — and worth the second run, because "it clamped to the margins" was a tidy explanation that happened to be wrong.

### SerializerVersion is a label, not a gate (2026-09-06)

**The claim that was wrong.** `App.tsx`'s version picker has said since it was
written that "a newer `.repx` does not open in an older designer", and it is the
stated reason the picker offers 20.1 at all. A generated invoice came back looking
badly wrong in the designer, the file declared `SerializerVersion="24.1.3.0"`, the
installed assembly is `DevExpress.XtraReports.v20.1`, and the diagnosis wrote
itself. It was asserted twice, and a warning was built on it.

**The measurement.** `RepxProbe inspect` loads a file through the DevExpress
assemblies actually installed here, which is the whole reason that tool exists.
Run against the real 24.1 file:

```
raw text : 4 tables, 21 cells, 65 distinct Ref values
loaded   : 4 tables, 21 cells, 0 bindings
           nothing lost: every declared cell survived the load.
exit code: 0
```

Nothing was discarded. On re-save the 20.1 loader simply rewrote the tag:

| attribute | in the file | after a 20.1 load and save |
|---|---|---|
| `SerializerVersion` | `24.1.3.0` | `20.1.3.0` |
| `Version` | `24.1.3.0` | `20.1.3.0` |
| bands, geometry, page size | | unchanged |

**So the version number is not what breaks a file.** What would break one is a
control or a property the older assembly has never heard of — the tag is only a
cheap signal that such a thing *might* be present. Forma emits a conservative
control set, so in practice the tag alone is cosmetic. `designerVersionWarning`
in `designerBridge.ts` now says "usually harmless" and names the real hazard
rather than predicting a mangled layout, and a test asserts it does **not** say
"mangled" — because that wording sends the next person hunting a version problem
instead of the defect in front of them.

**What was actually wrong with that report**, measured with `parseReportStructure`
and `auditRepx` rather than guessed:

- the `ReportHeader` band is 240 units tall and its controls reach y=252, so the
  content overflows the band it is in;
- two `XRLabel`s of 850x136 and 850x104 carry no text at all — full-page-width
  colour blocks drawn as labels, reaching the paper edge under `Margins="0, 0, 0, 0"`;
- a `GroupHeaderBand` with no `<GroupFields>`, which prints once and looks like a
  heading rather than a grouping (the audit reported this);
- six content bands against four layout sections, so the preview was not showing
  what the file contained (the audit reported this too).

**The transferable part.** The version was a plausible explanation that fit every
visible fact, and it was wrong. The tool that settled it in one command already
existed and had existed for days — `tools/RepxProbe` is in this repository
precisely because "the DevExpress documentation describes the object model, not
the file". Reaching for it before asserting is the whole discipline, and it is
cheap: this took one command and thirty seconds.

**Still unmeasured, and it is the interesting half.** `inspect` proves the loader
kept every control. It says nothing about how the report *looks* — band heights
against their content, whether those full-width blocks land where the design had
them, whether the overflow is visible. Only opening it in the real designer shows
that, and that is a thing only someone at the machine can do.

## The API key gates the entire workspace

`hasApiKey` in `App.tsx` is the single derived gate. `handleGenerate` and `handleResume` both check it and open the config modal rather than relying on `MissingApiKeyError` to surface later — so nothing enters the transcript and no loader appears before a request is known to be possible. The composer input is disabled, the send button is disabled, and a click-through banner sits above the composer explaining why. Keep every new workspace action behind this same check.

## Chat and report generation are separate paths

Typing "hello" used to produce a full mockup report, because `handleGenerate` sent **every** message to `analyzeReportDesign`. Routing is now:

- **Attachments present** → report generation, no classification step. An upload is an unambiguous request to build something.
- **No attachments** → `chatReply()` — a small, cheap turn (no images, no report schema, `maxOutputTokens: 512`) returning `{reply, wantsReport}`. It answers the message and decides whether a report was actually being asked for. `wantsReport: true` falls through to generation; otherwise the reply is simply posted.

`chatReply` shares the key and `resolveModel()` with the main path, so it costs nothing extra to keep in sync. `isChatting` drives a light indicator, deliberately distinct from the full generation card — a chat turn is seconds, a generation is not.

**`chatReply` asks for `thinkingBudget: 0`, and that is the whole reason it is fast.** These models otherwise reason silently before emitting a character, which for "hello" *was* the entire wait — and it is timed and billed exactly like output. Chat is two or three sentences plus a yes/no classification, so it needs none of it. **Do not copy this to `analyzeReportDesign`**: spatial layout reading is a genuinely hard task and keeps the model's default. That path exposes `ReportConfig.thinkingBudget` instead, unset by default, to be tuned only against measured `thoughtsTokenCount`.

**`thinkingBudget: 0` is requested, never assumed.** Support varies by model — some reject the field outright, the pro tiers refuse to let it reach zero, and both fail with a bare `400 INVALID_ARGUMENT` that says nothing about which argument. Sending it unconditionally broke chat entirely on one key. `chatReply` now retries once without it and records the model in `thinkingUnsupportedForModel`, so the wasted request costs one per model per session rather than one per message. Never reinstate an unconditional `thinkingConfig`.

`asReadableError()` unwraps provider errors before they reach the UI. These arrive with the upstream JSON envelope stuffed into `.message` — **sometimes nested twice** — which rendered as a wall of braces and escaped newlines in the chat pane. It peels up to three layers, passes `AbortError` through untouched, and falls back to the original text when nothing parses.

The reply also streams. The response is schema-constrained JSON so it cannot be `JSON.parse`d until the last chunk, but `reply` is the **first** property, so `extractPartialReply()` scans its characters out of the incomplete object and types them into the bubble as they arrive. Its contract — every possible chunk split must yield a clean prefix, never JSON punctuation, never a dangling escape — is unenforced, and a violation shows up as stray `\` or `","wantsReport` flickering in the bubble rather than as an error. That contract is now enforced: `src/services/geminiService.test.ts` runs the scanner over **every** split point of several replies (embedded quotes, newlines, Windows paths, unicode) and asserts each result is a clean prefix that only ever grows, plus a dedicated split-mid-escape case. Run `npm test` after touching it rather than walking it by hand. One trap worth knowing if you extend those tests: a reply containing a literal backslash (`C:\reports`) has legitimate prefixes ending in `\`, so "never ends with a backslash" is only a valid assertion for replies that contain none. If you reorder the schema so `reply` is no longer first, progressive display silently stops working.
