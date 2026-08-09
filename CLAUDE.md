# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read this first

Four constraints change how you work here before you touch anything:

- **There are now two test suites, and between them they still cover little.** `npm test` runs Vitest (jsdom) over 38 tests in `src/lib/repx.test.ts`, `src/lib/sourceRect.test.ts` and `src/services/geminiService.test.ts`, covering four pure helpers chosen because each encodes an invariant that fails *plausibly* rather than loudly. `npm run test:rules` runs 29 tests in `tests/firestore.rules.test.ts` against the Firestore emulator — account isolation, document shape, and the key vault. **Everything else is still unenforced**: no component test, no render test, and nothing touching `App.tsx`'s stateful logic. Where this document calls something an invariant and it is not in one of those files, you check it by hand or it ships broken.
- **`npm run test:rules` needs Java** (the Firestore emulator is a JVM process). A Temurin JRE 21 is installed at `%LOCALAPPDATA%\Programs\Temurin\jdk-21.0.12+8-jre` with `JAVA_HOME` and `PATH` set at user scope — no admin was required, and nothing was installed system-wide. On a machine without it, that script fails with a Java-not-found error while `npm test` still works.
- **`tsconfig.json` does not enable `strict`**, so a clean `tsc` proves much less than it looks like. Type errors that matter will not surface on their own — read carefully rather than trusting the exit code. The baseline *is* clean, so anything `tsc` prints is yours.
- **The working tree is not a git repository** — there is a `.gitignore` but no `.git`. No `git diff` to review your own changes against, no history to consult, no revert. Read before you overwrite, and prefer targeted edits to rewrites.
- **The app owns no Gemini API key.** Each user supplies their own at runtime and the browser calls Google directly with it. This is the correction to a real leak incident — see "The Gemini call runs in the browser".

Stack: React 19, Vite 6, Tailwind v4, TypeScript, Express (dev *and* prod server), Firebase Auth + Firestore, Gemini via `@google/genai`. Entry points are `server.ts`, `src/main.tsx` → `src/App.tsx`, and `src/services/geminiService.ts`.

Most of this file is incident history — the reason a thing is the way it is, which the code cannot tell you. Jump to the section that owns what you are touching rather than reading straight through:

| If you are touching… | Read |
|---|---|
| the API key, `.env`, `envPrefix`, anything server-side | *The Gemini call runs in the browser* + *Where the user's key lives* |
| a model id, a 404/429/503, `thinkingBudget` | *The model is auto-detected* + *Chat and report generation are separate paths* |
| the prompt, `layout` schema, mockup rendering, image crops | *`geminiService.ts` is a single mega-prompt* |
| file upload, PDF handling, `.repx` intake | *`src/App.tsx` is the whole app* (File intake) |
| saving/loading reports, sign-in, `firestore.rules` | *Persistence: two divergent shapes* |
| theme, tokens, animation, the logo | *Styling and motion* |

## Project

**Forma** — an AI-powered DevExpress report designer. The user uploads an image, PDF, or `.repx` file; Gemini analyzes it and returns three artifacts in one structured JSON response: a markdown spec, a `layout` JSON used to draw an in-browser mockup, and `repxContent` — valid DevExpress `XtraReportsLayoutSerializer` XML that downloads as a `.repx` file. See `PRD.md` for the product spec — it is the single copy, kept current against the code, including its "not yet exposed in the UI" note (RTL, stored-procedure name, data-binding schema), its §5 record of the resolved key exposures, and its §6 statement that **moving generation server-side is explicitly out of scope**, not future work. (A stale `public/PRD.pdf` used to shadow it; it was unreferenced and has been deleted.) `PRD.md` was rewritten on 2026-08-02 to catch up with the bring-your-own-key rework — it had still been describing a `localStorage`-stored key, a model dropdown, an application-owned quota, and a server-side generation endpoint. If you change any of those areas, update it in the same pass.

`metadata.json` still names the app "DevExpress Report AI Designer" — it is AI Studio applet metadata, and the only place the pre-Forma name survives. `package.json`'s `"name": "react-example"` is likewise a leftover scaffold value, not a product name.

## Commands

```powershell
npm run dev          # tsx server.ts -> Express + Vite middleware on http://localhost:3000
npm run dev:log      # same server, output also mirrored to dev-server.log (gitignored)
npm run build        # vite build (client) + esbuild (server) -> dist/
npm run build:server # server bundle only -> dist/server.cjs
npm start            # node dist/server.cjs -- serves dist/ statically, no Vite
npm run lint         # tsc --noEmit  (there is still no ESLint config)
npm test             # vitest run -- 38 unit tests over the pure helpers in src/lib + geminiService
npm run test:watch   # the same suite in watch mode
npm run test:rules   # 29 security-rule tests against the Firestore emulator (needs Java)
npm run clean        # removes dist/ (node fs.rmSync, works on Windows and POSIX)
npm run preview      # vite preview against dist/
```

- **Never run bare `vite dev`.** The dev server is `server.ts`; Vite runs in middleware mode inside it.
- The dev server belongs in the user's own terminal, not an agent background shell — it is long-lived and browser-facing. When you need to see its output, ask the user to run `npm run dev:log` and read `dev-server.log`; only take the port yourself for a short, self-contained check, and free it afterwards.
- `scripts/build-server.mjs` bundles `server.ts` with esbuild, keeping `node_modules` external and baking in `NODE_ENV=production` — so the started server takes the static-file branch and the Vite import is dead code. `npm start` therefore requires `npm run build` first, and must run from the repo root (the static path is `process.cwd()/dist`).
- **`.env` does not contain a Gemini key and must not.** It holds `APP_URL` plus the optional `VITE_FORMA_MOCK`, and `server.ts` loads it via `import "dotenv/config"` — but the server has no key-bearing routes left, and `envPrefix: ['VITE_']` means a `GEMINI_API_KEY` set there reaches neither the server code nor the browser. Nothing is inlined into the client bundle. `.env*` is gitignored except `.env.example`, whose comments say the same thing.
- Run a single test file with `npx vitest run src/lib/repx.test.ts`, or a single case with `-t "<name>"`. `vitest.config.ts` is deliberately separate from `vite.config.ts` — that one carries the "Do not modify" HMR block and is loaded by the dev server. Tests live beside what they test as `*.test.ts`; the config only picks up `src/**/*.test.ts`. See "Read this first" for what the suite does *not* cover, and for the no-git constraint.
- `.claude/settings.local.json` carries a permission allowlist (`npm run *`, `npm ls *`, `Get-Process`, `New-Item`, plus some one-off probes), so those run without a prompt. `dev-server.log` is gitignored by the blanket `*.log`, not by name.
- **`.antigravity/` is editor state, not project data** — a single ~23 MB `.pbtxt`. Nothing reads it, nothing builds from it, and it matches no `.gitignore` pattern, so a recursive listing or a "what's in this repo" sweep will trip over it. Don't read it, don't index it, and don't count it as source.
- `vite.config.ts` gates HMR on `DISABLE_HMR !== 'true'` and carries an explicit *"Do not modify — file watching is disabled to prevent flickering during agent edits"* comment. Leave that block alone.
- Symbol names in this document are stable; line numbers are not. Grep for the identifier rather than jumping to a remembered offset — `src/App.tsx` has already grown past every line number an earlier revision of this file recorded.

## Architecture

### The Gemini call runs in the browser, not on the server

`src/App.tsx` imports `analyzeReportDesign` from `src/services/geminiService.ts` **directly**, so it is bundled into the client and the request goes from the user's browser straight to Google.

**Forma is bring-your-own-key, and the application owns no key at all.** The only key in play is the one the user types into the config modal, which reaches `analyzeReportDesign` as `config.customApiKey`. There is no environment fallback, no `readEnv()` helper, and no server-side key. If `config.customApiKey` is empty the service throws `MissingApiKeyError`, which `App.tsx` catches to open the config modal.

This is the correction to a real incident, so do not undo it: `vite.config.ts` used to set `envPrefix: ['VITE_', 'GEMINI_']`, which inlined `GEMINI_API_KEY` into the shipped JS. Google's secret scanner found the key and revoked it — `403 PERMISSION_DENIED`, *"Your API key was reported as leaked."* The prefix list is now `['VITE_']` only. **Never re-add `'GEMINI_'` to `envPrefix`, and never reintroduce an env read on the key path in `geminiService.ts`.** To confirm what the browser actually receives, fetch the transformed module from the dev server (`curl localhost:3000/src/services/geminiService.ts`) — the injected `import.meta.env = {...}` prelude is the ground truth, and it must contain no key.

Because the key belongs to the user rather than to Forma, proxying generation through the server would be a step **backwards**: the server would become custodian of every user's third-party credential. `POST /api/generate-report` and `GET /api/debug-key` have both been deleted from `server.ts` for that reason, along with the `analyzeReportDesign` import. The server is now key-free and must stay that way; `GET /api/health` is all that remains.

**`app.use("/api", …)` returns a JSON 404 for anything else, and its position matters.** It sits after every real API route and before the dev/prod branch, so it covers both. Without it the production catch-all (`app.get('*')`) answered *any* `/api/*` probe with **200 and `index.html`** — so the deleted `/api/generate-report` and `/api/debug-key` looked like live endpoints to any client checking the status code rather than the body. Register new API routes **above** this guard or they will 404.

`.env` is now only `APP_URL` plus the optional `VITE_FORMA_MOCK`. A `GEMINI_API_KEY` left in that file is inert — nothing reads it, and `envPrefix` will not carry it to the browser. `API_KEY` is gone entirely.

### Where the user's key lives

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

### `geminiService.ts` is a single mega-prompt

Everything the model needs — spatial mapping rules (1 inch = 100 units, Letter = 850×1100), a DevExpress XML "cheat sheet" of exact `ControlType` strings, XML-escaping rules, and the `ReportConfig` settings interpolated as `configInstructions` — lives in one template literal, paired with a `responseSchema` that forces `{markdown, layout, repxContent}`. Prompt text and schema must stay in sync; the schema is what guarantees parseable output. Defaults: `temperature: 0`, `maxOutputTokens: 65536`, and the model is **detected at request time** rather than defaulted — see below.

### The model is auto-detected, and there is no model picker

`resolveModel()` sends a 1-token probe to every candidate in `MODEL_PREFERENCE` **concurrently** (`Promise.all`), then picks the first *preferred* model that answered — not the first to reply. Probing used to be sequential and `await`ed one candidate at a time, which charged a full round-trip per rejected model before the real request could start; a key without access to the leading model paid that several times over on the first generation of every session. The probes are one token each, so firing all of them costs nothing that matters. A key-level rejection takes priority over a quota verdict when reading results, since it repeats for every candidate and is the real cause. The winner is cached in `sessionStorage['geminiModel:session']` so the cost is paid once per session. `config.modelName` still exists as a code-level pin (no UI) and skips detection when set.

`analyzeReportDesign` logs a timing breakdown (`model detection Xms, request Yms, total Zms`) plus the attachment payload size. Total wall-clock alone could not separate "detection was slow" from "the upload was slow" from "the model wrote a lot of XML" — three different problems with three different fixes. Read it in the in-app `DebugConsole`.

This replaced a hardcoded `gemini-2.5-flash` default plus a dropdown, and the reason is worth keeping in mind before anyone re-adds either: **Google retires models "for new users."** Existing projects keep working while every freshly created key gets `404 — no longer available to new users`. Measured on a live key in this repo: `gemini-2.5-flash` and `gemini-2.5-flash-lite` both 404'd; `gemini-pro-latest`, `gemini-2.5-pro` and the `gemini-2.0-*` family returned 429 (no free-tier quota); only `gemini-flash-latest` and `gemini-flash-lite-latest` actually worked. The old dropdown also offered "Gemini 3.5 Flash/Pro", which existed for no one. A hardcoded id is a time bomb here; `-latest` aliases lead the preference list because Google repoints them.

**Never resolve models from `models.list`.** That endpoint is not a reliable guide to what a key can call — it advertised `gemini-2.5-flash` with `generateContent` support while the real call 404'd. Only an actual request tells the truth, which is why `validateApiKey()` is implemented *as* a `resolveModel()` call rather than a catalogue lookup, and why it returns the chosen model for the UI to display.

Order is deliberate: flash tiers precede pro because each user pays for their own usage. If a cached model 404s mid-generation, `analyzeReportDesign` clears the cache, re-resolves and retries **once**, silently — unless `config.modelName` was pinned, which is treated as an explicit instruction.

A **503 / `UNAVAILABLE`** is a different failure and is handled separately: it means Google's capacity for that model is momentarily exhausted, not that anything is wrong with the key, the model id, or the request. `analyzeReportDesign` retries the *same* model up to twice with a 2s then 4s backoff before surfacing anything, using `sleep(ms, signal)` so pausing during the wait still aborts. Both retry paths share one loop and their counters are independent, so a re-detect followed by an overload cannot loop indefinitely. Don't "fix" a reported 503 by changing models or the prompt — it is upstream load, and the only real remedies are the backoff already in place and waiting.

`toFriendlyError` also unwraps provider JSON: these SDK errors often carry the whole `{"error":{"code":503,...}}` blob as their `message`, and rendering that verbatim showed the user a wall of braces. It now extracts `error.message` when the text parses as JSON.

Refinement turns pass `previousState` (prior `layout` + `repxContent`) so the model edits rather than regenerates — the prompt leans hard on "preserve the existing structure."

**Grids are now real tables on both sides.** Earlier revisions required a deliberate asymmetry — a real `<XRTable>` in `repxContent`, but the same grid **decomposed into per-cell `"label"` elements** in the `layout` JSON — because `ReportMockup`'s `"table"` branch was a hardcoded placeholder printing "Data Row 1" / "Data Row 2". That branch now renders the element's real `rows`/`cells`, so the prompt asks for one `"table"` element with a populated `rows` array instead. Weights are relative (like `XRTableCell`'s), so the model no longer hand-computes per-cell coordinates. Layouts saved before this change still contain decomposed labels and render fine — the label path is unchanged.

The `layout` element schema carries visual fidelity beyond geometry: `bold`, `italic`, `fontFamily`, `verticalAlign`, `wrap`, per-side `borderTop/Right/Bottom/Left` + `borderColor`, and `chartType`/`chartValues`. **All are optional and the renderer falls back to the old behaviour when absent**, which is what keeps previously-saved reports rendering. `hasBorder` is retained as the legacy all-four-sides flag; `borderStyleFor()` prefers per-side flags and falls back to it.

**Picture location is asked for in Gemini's own detection format, and that choice is load-bearing.** `"image"` elements carry `box2d: [ymin, xmin, ymax, xmax]`, each value normalised to **0–1000**, y before x, top-left origin. Asked instead for the more obvious `{x, y, width, height}` fractions, the model answered `{0,0,1,1}` — the entire page — for *every* picture in a multi-image design, so one box showed the whole upload and the rest were empty. Requesting the format it is actually trained to emit for object detection is what makes it localise. `boxToSourceRect()` converts to fractions; **the order really is y-first**, and reading it x-first transposes every crop into a plausible-looking wrong position rather than an obvious failure. This *is* now asserted: `boxToSourceRect`/`sourceRectFor` moved to **`src/lib/sourceRect.ts`** and `src/lib/sourceRect.test.ts` pins the ordering with a deliberately asymmetric box, so transposing it fails the suite. End-to-end the crop is still unverified — for that, check by hand against a design whose logo is off-centre in both axes, since a centred one looks identical under either reading. `sourceRectFor()` prefers `box2d` and falls back to the legacy field so reports saved before this change still render.

The legacy `sourceRect` is a rectangle in **fractions (0–1)** of one uploaded file, plus an optional `sourceImageIndex`. `cropSourceRegion()` crops that region out of the user's actual upload via a canvas and shows the real logo instead of a grey placeholder. Fractions rather than pixels because the model does not know the file's true dimensions. It returns `null` on a bad rect, a non-image upload, or a decode failure, and `MockupImage` falls back to the icon placeholder — so this degrades quietly rather than showing a broken image. The images come from `mockupSourceImages`, which prefers live `previews` and falls back to the last user message's `images`, so cropping still works for a report reloaded from history.

**`sourceRect` is validated, not trusted, and the reason is a real failure mode.** On a design containing *several* pictures the model would return one rectangle spanning the whole page, so a single picture box displayed the entire upload while every other image element came out empty. `cropSourceRegion()` now rejects a rectangle that is more than 90% of either dimension or over half the source area, and one whose aspect ratio differs from the target element's by more than 4×, logging which element was rejected. **A wrong crop is worse than no crop** — rejection falls back to the clean placeholder, which is the correct rendering for "could not locate this picture". The thresholds are a judgement call with no test behind them: tightening them silently stops legitimate artwork from cropping, so if you touch them, re-check the shapes they were chosen to admit — square logo, wide banner, tall signature, quarter-page photo. The prompt's "IMAGES AND LOGOS" block is the other half: it requires one element per picture, tight non-overlapping rectangles, and explicitly tells the model to omit `sourceRect` rather than guess. Keep both halves in sync.

Still decorative stand-ins, ignoring their real content: `"gauge"` and `"barcode"`. `"chart"` follows `chartType`/`chartValues` but is still stylized, not a real charting library.

**Mock mode is opt-in:** set `VITE_FORMA_MOCK=true` and the service sleeps 3s and returns `MOCK_INVOICE_RESPONSE` without calling Gemini. It previously triggered whenever the key was missing *or the prompt merely contained the word "mock"* — under bring-your-own-key that was actively harmful, since a first-time visitor with no key, or anyone asking to "mock up an invoice", silently received a canned fake report with no way to tell it was not real output. A missing key now throws `MissingApiKeyError` instead. This env flag is the **only** remaining source of canned output; the `TEST_REPORT_LAYOUT` / `TEST_REPORT_MARKDOWN` / `TEST_REPORT_REPX` constants and their "Load Test Mockup" action are gone (the action had already been removed, leaving ~190 lines of orphaned fake-report data behind).

### The API key gates the entire workspace

`hasApiKey` in `App.tsx` is the single derived gate. `handleGenerate` and `handleResume` both check it and open the config modal rather than relying on `MissingApiKeyError` to surface later — so nothing enters the transcript and no loader appears before a request is known to be possible. The composer input is disabled, the send button is disabled, and a click-through banner sits above the composer explaining why. Keep every new workspace action behind this same check.

### Chat and report generation are separate paths

Typing "hello" used to produce a full mockup report, because `handleGenerate` sent **every** message to `analyzeReportDesign`. Routing is now:

- **Attachments present** → report generation, no classification step. An upload is an unambiguous request to build something.
- **No attachments** → `chatReply()` — a small, cheap turn (no images, no report schema, `maxOutputTokens: 512`) returning `{reply, wantsReport}`. It answers the message and decides whether a report was actually being asked for. `wantsReport: true` falls through to generation; otherwise the reply is simply posted.

`chatReply` shares the key and `resolveModel()` with the main path, so it costs nothing extra to keep in sync. `isChatting` drives a light indicator, deliberately distinct from the full generation card — a chat turn is seconds, a generation is not.

**`chatReply` asks for `thinkingBudget: 0`, and that is the whole reason it is fast.** These models otherwise reason silently before emitting a character, which for "hello" *was* the entire wait — and it is timed and billed exactly like output. Chat is two or three sentences plus a yes/no classification, so it needs none of it. **Do not copy this to `analyzeReportDesign`**: spatial layout reading is a genuinely hard task and keeps the model's default. That path exposes `ReportConfig.thinkingBudget` instead, unset by default, to be tuned only against measured `thoughtsTokenCount`.

**`thinkingBudget: 0` is requested, never assumed.** Support varies by model — some reject the field outright, the pro tiers refuse to let it reach zero, and both fail with a bare `400 INVALID_ARGUMENT` that says nothing about which argument. Sending it unconditionally broke chat entirely on one key. `chatReply` now retries once without it and records the model in `thinkingUnsupportedForModel`, so the wasted request costs one per model per session rather than one per message. Never reinstate an unconditional `thinkingConfig`.

`asReadableError()` unwraps provider errors before they reach the UI. These arrive with the upstream JSON envelope stuffed into `.message` — **sometimes nested twice** — which rendered as a wall of braces and escaped newlines in the chat pane. It peels up to three layers, passes `AbortError` through untouched, and falls back to the original text when nothing parses.

The reply also streams. The response is schema-constrained JSON so it cannot be `JSON.parse`d until the last chunk, but `reply` is the **first** property, so `extractPartialReply()` scans its characters out of the incomplete object and types them into the bubble as they arrive. Its contract — every possible chunk split must yield a clean prefix, never JSON punctuation, never a dangling escape — is unenforced, and a violation shows up as stray `\` or `","wantsReport` flickering in the bubble rather than as an error. That contract is now enforced: `src/services/geminiService.test.ts` runs the scanner over **every** split point of several replies (embedded quotes, newlines, Windows paths, unicode) and asserts each result is a clean prefix that only ever grows, plus a dedicated split-mid-escape case. Run `npm test` after touching it rather than walking it by hand. One trap worth knowing if you extend those tests: a reply containing a literal backslash (`C:\reports`) has legitimate prefixes ending in `\`, so "never ends with a backslash" is only a valid assertion for replies that contain none. If you reorder the schema so `reply` is no longer first, progressive display silently stops working.

### `src/App.tsx` is the whole app

It is several thousand lines (a figure that only ever grows — don't trust a number written here, and don't reintroduce one into this heading where it will silently rot). It holds the workspace, chat and config modal, plus two components still defined inline: `DebugConsole` (in-app log viewer that patches through `console.*`) and `ReportMockup` (renders `layout` as absolutely-positioned divs).

**All five page-level surfaces now live in `src/components/`**: `LandingPage`, `FeaturesPage`, `DocsPage`, `ContactPage` and `LoginPage`, alongside `MobileNav`, `UserAvatar` and `Logo`. The four marketing pages take the same props — `onEnterWorkspace`, `onSignIn`, `onSignUp`, `user`, `logOut`, `isDarkMode`, `setIsDarkMode` — so a change to one header usually belongs in all four. `LandingPage` was extracted on 2026-08-09; it had been inline while its three siblings were not, which is why header fixes kept having to be applied to it separately. Note that pulling it out orphaned `MobileNav`'s import in `App.tsx`, since the landing page was its only consumer there — the unused sweep catches that class of leftover.

Expect to work inside `App.tsx` for workspace features; prefer extracting new surfaces into `src/components/` rather than growing it.

The `DebugConsole`'s "Run Diagnostics" and "Check System Health" menu actions (`handleRunDiagnostics`, `handleCheckSystemHealth`) `console.log` hardcoded strings — "Latency Nominal at 24ms", "Local Database state: Online" — and probe nothing. Don't read their output as a signal, and don't build on them without replacing the bodies. `elapsedTime` next to them *is* real (wall-clock around the request) and is shown on the progress card. A sibling `latency` state was write-only and has been removed; the real per-phase numbers now come from the timing breakdown `analyzeReportDesign` logs.

**Finding unused code:** there is no ESLint, and `tsconfig.json` enables neither `noUnusedLocals` nor `noUnusedParameters`, so dead code accumulates silently and `npm run lint` will not tell you. Run `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` to see it without editing the config. As of 2026-08-09 that sweep is **completely clean**, so treat *any* hit as newly introduced. (It previously reported two, both in `FeaturesPage.tsx`. `heroInView` marked a visibility gate that was never wired; the looping hero animation it was meant to gate had since been reduced to static dots, so there was nothing left to gate and it went. The unused `idx` map parameter went with it. The gate that was actually missing is now on the bento grid's scanning laser — see `bentoInView`.)

**`ReportMockup` is a scaled pixel sheet, not a responsive layout.** Every coordinate from `layout` is multiplied by `0.96` and set as an absolute `left/top/width/height`; the page cannot reflow, so a `ResizeObserver` measures the viewport and applies `transform: scale()` to the whole sheet, with an outer stage div sized to the post-scale footprint so nothing overlaps. Everything inside the sheet is drawn against the **theme-invariant `--paper` / `--on-paper` tokens** — deliberately identical in `:root` and `.dark`, since a rendered report must look the same in both themes. Using `bg-card`/`text-foreground` or any other flipping token inside the sheet is a bug, not a shortcut.

**Routing is `window.location.hash`**, driven by one `useEffect` on `hashchange` that maps `#workspace | #login | #signup | #features | #docs | #contact` (and `''` = landing) onto boolean state. There is no router library. Any new page needs a branch there *and* a `setLastViewHash` update if it should be restorable after login.

Two pieces of view state shape the workspace: `activeTab: 'spec' | 'ui'` switches the result pane between the markdown spec and the `ReportMockup`, and `mobilePane: 'chat' | 'canvas'` turns the two panes into tabs below `md` (ignored at `md`+, where both render). A finished result force-flips `mobilePane` to `canvas` so phone users see it. A third, `specView: 'spec' | 'repx'`, chooses between the markdown write-up and `RepxViewer` inside the spec tab — that tab was named "Specs & REPX" from the start but rendered only the markdown until the viewer was added.

`RepxViewer` is dependency-free, and its three pure helpers now live in **`src/lib/repx.ts`** (moved out of `App.tsx` so they could be unit-tested without importing the app, pdf.js and Firebase into a test run — `src/lib/repx.test.ts` covers them): `formatXml()` re-indents (safe here only because DevExpress REPX is attribute-based with no meaningful text nodes — do not reuse it for general XML), `tokenizeXml()` returns **tokens rather than an HTML string** so the XML renders as React text nodes and can never be injected as markup, and `checkRepx()` runs a `DOMParser` pass asserting the document parses, that the root is `XtraReportsLayoutSerializer`, and that `<Bands>` exists. That check is the only thing standing between a malformed generation and the user discovering it when DevExpress refuses the file. `copyText()` stays in `App.tsx` (it touches the DOM directly) and falls back to a hidden textarea plus `execCommand` because `navigator.clipboard` is undefined outside a secure context — the same LAN-over-HTTP case that `isVaultAvailable()` guards.

**File intake is now a single path.** `handleFileChange` (picker) and `handleDrop` (drag-and-drop) both call `ingestFiles()`, which loops `ingestFile()` per file. These were two near-identical copies that had to be edited in lockstep; that duplication is gone and must not come back. (A parallel `files: File[]` state also used to exist; it was write-only — set in four places, read nowhere — and has been removed.)

Intake produces **two** outputs, deliberately kept apart:

- `previews: string[]` — image data URLs only. Everything downstream depends on this staying image-only: the thumbnail strip, `sourceRect` logo cropping, and the `images` field persisted on saved reports.
- `attachmentTexts: TextAttachment[]` — text recovered *from the files themselves*.

**The text side is where `.repx` accuracy comes from.** A digital PDF already contains every string and its exact position; rasterizing and asking the model to read it back out of pixels throws that away. `extractPdfPageText()` pulls it via `page.getTextContent()` and converts it into the report's own grid — **hundredths of an inch, origin top-left** — so the model can use the numbers directly. Two conversions matter, and nothing checks either one: PDF points are 1/72" (`PT_TO_REPORT_UNITS = 100/72`, which maps a 612×792pt Letter page exactly onto the 850×1100 report grid), and PDF y is a **baseline measured from the bottom**, so `yTop = pageHeight - (baselineY + height)`. Get either wrong and every coordinate is silently off.

`MAX_TEXT_ITEMS_PER_PAGE` (400) caps extracted strings per page so a dense page cannot flood the prompt — and unlike the page cap, **this one is silent**: it `break`s out of the loop with no `uploadNotices` entry, so a very text-heavy page loses its tail with nothing surfaced to the user. If accuracy is missing from the *bottom* of a busy page, check this before blaming the model.

The prompt's **SOURCE PRECEDENCE** block tells the model this extracted text is exact and outranks the page image for strings and positions, while the image remains authoritative for borders, fills, logos and visual structure. Keep those two halves in sync.

- **PDF**: up to `MAX_PDF_PAGES` (8) pages, each rendered at `PDF_RENDER_SCALE` (2.5, ~250 DPI) *and* text-extracted. Pages beyond the cap produce a user-visible notice rather than vanishing — page 1 used to be the silent hard limit. The canvas is **filled white before rendering** (pdf.js draws onto transparency; JPEG has no alpha, so skipping this turns the page black) and the result goes through `optimizeImageDataUrl()`, which matters now that 2.5 can exceed the edge cap. A PDF with no text layer is a scan: that is detected and reported, not treated as a failure.
- **Images**: `readAsDataUrl()` then `optimizeImageDataUrl()`, which caps the long edge at `MAX_IMAGE_EDGE` (2048) and re-encodes as JPEG. Anything already under both that cap and `REENCODE_THRESHOLD_BYTES` is untouched; it returns the original on any failure and never returns a larger payload than it was given, so it can only help. The cap is deliberately generous — lowering it trades real fidelity for speed.
- **`.repx`**: read with `file.text()` as a real string, validated with `checkRepx()` (the same check the REPX viewer uses) and attached as text. It used to be base64-relabelled `text/plain` and never decoded — 33% larger for no benefit, and impossible to validate before spending a request.

Unsupported files, oversized files (`MAX_FILE_BYTES`), and the `MAX_ATTACHMENTS` cap all surface through `uploadNotices`. Dropping a `.docx` previously matched no branch and did nothing at all, with no feedback.

**Attachments are not always images.** `analyzeReportDesign` takes `AttachmentPart[]` — a union of `{inlineData}` and `{text}` — and text parts are ordered **first** so exact strings are in context before the page images. Anything that reasons over attachment counts must consider both lists: `handleGenerate`'s chat-vs-report routing, its empty guard, and the send button all check `previews.length === 0 && attachmentTexts.length === 0`. A `.repx`-only upload has no images at all, and checking `previews` alone would wrongly route it to chat.

pdf.js is wired at module scope with a Vite-specific import — `import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url'` assigned to `pdfjs.GlobalWorkerOptions.workerSrc`. The `?url` suffix is what keeps the worker out of the main bundle; swapping it for a CDN string or a bare import breaks PDF intake at runtime, not at build time.

`previews` are split back into `{inlineData: {data, mimeType}}` parts at request time inside both `handleGenerate` and `handleResume` — duplicated again, once for the initial run and once for resume.

**Export** goes through `downloadDesign`: it prefers `result.repxContent` (Blob as `application/xml`, filename `<title>.repx`) and silently degrades to `result.content` as `.txt` when the model returned no XML. The `.repx` filename is the report title with whitespace collapsed to underscores.

**Progress is real once output starts; cancellation is real throughout.** The request is streamed — `analyzeReportDesign` calls `ai.models.generateContentStream` and accumulates chunks, taking an optional 6th argument `onProgress` that fires (throttled to ~120ms) with `{chars, percent, elapsedMs}`. The response is a single schema-constrained JSON object, so it still cannot be *parsed* until the last chunk lands; what streaming buys is a progress bar driven by output actually received rather than a timer inventing percentages. `percent` is asymptotic (`1 - e^(-chars/EXPECTED_RESPONSE_CHARS)`) and deliberately caps at 95 — only the parsed result reaches 100, so the bar can never claim completion early. `EXPECTED_RESPONSE_CHARS` only shapes the curve; being wrong makes the bar move faster or slower, never wrong.

`App.tsx` still starts the old 2.5s `setInterval` because model detection and the upload genuinely produce no signal. `handleStreamProgress` **clears that interval on its first call** and takes over — both handlers share the one callback so they cannot drift.

**The bar can never go backwards, and two mechanisms are what guarantee it.** `PRE_STREAM_CEILING` (14) clamps everything the simulated interval may claim, so the pre-stream phase cannot outrun what the stream will report on its first real chunk — without it the interval could sit at 30% while the first chunk honestly said 6%, and the bar would visibly retreat. `advanceProgress` is the second half: it is the *only* way `analyzingProgress` is written, and it takes `next > prev ? next : prev`, so a lower value is discarded rather than rendered. `handleStreamProgress` then floors the stream at `PRE_STREAM_CEILING + 1` so the handover is always a step forward. Both are shared by `handleGenerate` and `handleResume` for the same anti-drift reason as the callback itself. If you add any new progress writer, route it through `advanceProgress` — `setAnalyzingProgress` directly is the bug. The `finally` blocks and `handlePause`/`handleStop` all null-check `loadingIntervalRef.current`, which is required now that the stream nulls it mid-flight. Pause and stop abort a per-run `AbortController` whose `signal` is threaded into `analyzeReportDesign` as the 5th argument and handed to the SDK via `config.abortSignal`, tearing down the in-flight fetch. Two consequences worth knowing: the SDK's abort is **client-side only**, so Google may still finish and bill for the generation; and a cancelled call rejects with a `DOMException` named `AbortError` that `geminiService.ts` deliberately rethrows unwrapped, so callers can distinguish cancellation from a real model error. Both `handleGenerate` and `handleResume` guard on `signal.aborted` in their `catch` and `finally` blocks — pause leaves `isAnalyzing` true so the resume path can re-issue the request, while `handleStop` resets the workspace itself.

### Persistence: two divergent shapes

| | Signed in | Signed out |
|---|---|---|
| Store | Firestore `users/{uid}/reports/{reportId}` | `localStorage['savedReports']` |
| `timestamp` | `number` (epoch ms) | ISO string |
| `messages` / `result` | JSON **strings** | live objects |

That divergence is *on disk only*. The `onSnapshot` handler converts back on read — `timestamp` to an ISO string, `messages`/`result` through `JSON.parse` — so the in-memory `SavedReport` shape is identical on both paths and `handleLoadReport` needs no branch.

`firestore.rules` enforces the flat-string cloud shape (`isValidSavedReport` requires exactly `id, name, timestamp:number, messages:string, result:string, userId == auth.uid`). It uses `hasOnly` as well as `hasAll`, so **any new field written by `handleSaveReport` must be added there or the write is rejected** — the earlier `keys().size() >= 6` accepted arbitrary extra fields and no longer does. Reads convert back in the `onSnapshot` handler. Note `firebase-blueprint.json` documents a *different* `SavedReport` entity (`targetFormat`, `repxContent`, `layout`, `content`) that matches neither the rules nor the code; treat it as stale.

Firestore is reached via `getFirestore(app, firebaseConfig.firestoreDatabaseId)`, and **the `databaseId` in `firebase-applet-config.json` and `firebase.json` must stay identical** — a mismatch silently talks to the wrong database.

As of 2026-08-09 the project is **`forma-201ba`** on the **`(default)`** database, Standard edition. It was previously the AI Studio project `gen-lang-client-0000000000` on a named Enterprise database; that project had no Firebase enabled and could not be administered, which is why Google sign-in always failed with `auth/unauthorized-domain` (see below). Two consequences of the move: `firebase.json` no longer carries `edition`/`dataAccessMode`, which are Enterprise-only and break a Standard deploy; and **`.firebaserc` is the file that decides the deploy target** — `firebase use <id>` sets only the CLI's own per-directory state, so a stale `.firebaserc` will happily deploy to the old project from a fresh shell or CI. It was stale exactly this way once.

**`firebase-applet-config.json` commits a real `AIzaSy…` string, and that is correct — do not "fix" it.** A Firebase Web API key is a public project identifier, not a secret: it ships in every Firebase web app by design, and `firestore.rules` plus the authorized-domain list are what actually protect the data. It is *not* the same kind of value as the Gemini key whose leak is described above, and the two must not be conflated — removing it or moving it behind an env var breaks Firebase init for no security gain. The rule that matters is the narrower one: no **Gemini** key in any committed file, `.env` included.

**There is no auth fallback, and reintroducing one is not an option.** A failed sign-in is a failure. Until 2026-08-09 both sign-in paths fabricated a user with `uid: 'local-dev-user-id'` / "Local Developer" on two Firebase error codes — `auth/unauthorized-domain` (Google) and `auth/configuration-not-found` (email) — handing out a workspace session with **no credential check of any kind**. It has been removed outright: from `LoginPage.handleGoogleSignIn`, from `LoginPage.handleSubmit`, and from `App.handleLoginSuccess`, which is where the session was actually manufactured. `local-dev-user-id` now appears nowhere in `src/`, and grepping the production bundle for it returns nothing.

The history is worth keeping because the same mistake has been made twice here in escalating forms:

1. The email path once matched on **message text** — `err.message?.includes('configuration') || err.message?.includes('network')`. Firebase's `auth/network-request-failed` message contains "network", so **any dropped connection during sign-in signed the visitor in regardless of the password they typed.** That was narrowed to exact codes.
2. Exact codes were still a bypass. `auth/unauthorized-domain` is precisely what a *deployed* site returns when its domain is missing from Firebase's authorized-domain list — so one configuration slip would have let every visitor who clicked "Sign in with Google" into the workspace. Gating it to `import.meta.env.DEV` was considered and rejected: a credential-free path is a liability whether or not it ships, because it trains the codebase to treat auth failure as recoverable.

Both configuration codes now map to real text in `AUTH_MESSAGES` so a misconfigured project *says so* rather than papering over it. The single `loginModal` definition in `App.tsx` (rendered as `{loginModal}` in both the landing and workspace trees) remains the right structure — two copies drifted once, one restoring `lastViewHash` and the other hardcoding `#workspace`.

Because that uid can no longer exist, the `user.uid !== 'local-dev-user-id'` guards that used to sit in `handleSaveReport`, `handleDeleteReport`, the `onSnapshot` fetch effect and `canUseVault` are gone too. The branch is simply **signed in → Firestore, signed out → `localStorage`**, and save and delete must keep the same shape as each other so a report is always removed from wherever it was written.

**Signing out clears the documents, not just the credential.** `handleLogOut` used to drop the API key and vault state but leave `messages`, `result`, `previews` and `attachmentTexts` in place — so the next person at that browser saw the previous user's uploaded design, the text extracted from their PDFs, and the generated report. It now calls `handleClearChat()` as well. The same clearing runs from the `onAuthStateChanged` listener when a session ends **elsewhere** (another tab, a revoked token); `previousUidRef` distinguishes that from the initial `null` every signed-out visitor gets on load, which must not wipe their work.

**Form validation lives in one pure `validate(mode, values)` in `LoginPage.tsx`**, returning a `FieldErrors` record rendered under each input, not in the single banner it used to share. Three things about it are deliberate:

- The form carries **`noValidate`**. `required` and `type="email"` are still on the inputs for their `aria-required` / semantic value, but the browser's native bubbles are suppressed so two mechanisms cannot disagree about the same field with different wording.
- **Nothing renders `err.message`.** Firebase codes go through the `AUTH_MESSAGES` map; the raw message is the `Firebase: Error (auth/…)` envelope, and on sign-in it distinguishes `auth/user-not-found` from `auth/wrong-password`. Both map to one string, and `sendPasswordReset` swallows `auth/user-not-found` entirely, so neither path becomes an account-enumeration oracle. Keep any new code you add to that map on the same side of that line.
- Checks are ordered so a too-short password reports its own length problem rather than surfacing as "passwords do not match" against a half-typed confirmation, and `validate` is pure so the submit path and any future on-blur path cannot drift.

Email and display name are trimmed **at submit, not in `onChange`** — trimming per keystroke makes the space bar look broken. A whitespace-only display name is rejected rather than reaching `updateProfile` as a blank.

**`handleFirestoreError` re-throws.** `src/services/firebase.ts` exports it as the shared Firestore error handler, and it does two things worth knowing before you call it: it `console.error`s a JSON blob that includes the signed-in user's uid and email, and then it **throws a new `Error` whose `message` is that same JSON string**. So it is a rethrow, not a swallow — every call site sits in a `catch` that immediately re-raises. `handleSaveReport` and `handleDeleteReport` call it from `catch` blocks in `async` handlers with nothing above them, so a rules rejection becomes an unhandled promise rejection and the user sees no feedback at all. If you surface Firestore errors in the UI, don't render `err.message` raw — it is a JSON dump containing the user's email.

**Expected console noise:** `src/services/firebase.ts` calls `testConnection()` at import time, reading `test/connection` — a path the global deny in `firestore.rules` rejects. The resulting permission error on every page load is normal, not a regression.

`localStorage` keys in use: `savedReports`, `darkMode`. (`selectedAiModel` is gone with the model dropdown, and is actively deleted on boot — a stored `gemini-2.5-flash` would pin a retired model and defeat detection.) **`customGeminiApiKey` is gone** — it held the API key in plaintext on disk, and `purgeLegacyPlaintextKey()` now deletes it on boot. The key lives in `sessionStorage['geminiApiKey:session']` instead; see "Where the user's key lives" above. Nothing that touches the key may be written to `localStorage`.

`handleSaveReport` persists only `messages` and `result`, never `config` — so the key has never leaked into a saved report, and it must stay that way if you extend what gets saved.

### Styling and motion

Tailwind v4 via `@tailwindcss/vite` — no `tailwind.config.js`. Design tokens live in `src/index.css` under `@theme`: semantic `--color-background`/`--color-card`/… (whose light/dark values are the `:root` / `.dark` custom properties in `@layer base`), plus a Material-style landing-page palette and `--font-*` / `--text-*` scales. Dark mode toggles the `dark` class on `document.documentElement` — but *how* that class gets there is a four-part mechanism, below. Path alias `@/*` resolves to the repo root, not `src/`.

**Theme resolution spans four places that must change together.** `document.documentElement.classList.toggle('dark', …)` is the easy half; the rest is not obvious from any one file:

- **`index.html` carries an inline pre-paint bootstrap.** It reads `localStorage['darkMode']`, falls back to `matchMedia('(prefers-color-scheme: dark)')`, and sets the class before the bundle loads. It is inline and dependency-free on purpose — a module import runs *after* first paint, which is exactly the flash of light theme it exists to prevent. `App.tsx`'s `useState` initialiser mirrors that same resolution order; if you change one, change both or the app will repaint on hydration.
- **Persistence lives in `setTheme` (the user's action), never in an effect.** StrictMode double-invokes effects in dev, so an effect-based write would persist the *system-derived* value on mount and permanently detach the user from `prefers-color-scheme`. The syncing effect toggles the class and nothing else.
- **The OS is followed for as long as the user has never chosen.** A `matchMedia` `change` listener updates the theme only while `localStorage['darkMode'] === null`. An explicit choice writes the key and ends the following, which is why the listener re-reads storage rather than capturing a flag.
- **`isFirstThemeRun` suppresses the transition on mount.** The bootstrap already painted the correct theme, so animating on the first effect run would animate a change that never happened. Only a genuine toggle animates.

**Two icon systems coexist, and new code should default to Material Symbols.** `material-symbols-outlined` (loaded by `<link>` in `index.html`, alongside the fonts) accounts for the large majority of icons — nearly all of them in `App.tsx`; `lucide-react` is imported in a handful of files. Neither is being migrated to the other. Match the file you are editing rather than introducing the second system into a surface that only uses one, and remember the Material icons depend on that Google Fonts `<link>` — they render as literal ligature text if it fails, which is the tell.

Three token sets are duplicated by hand and must be changed together:

- **Motion** — `--ease-*` and `--duration-*` in `src/index.css` mirror `EASE` / `DURATION` in `src/lib/motion.ts` (CSS in ms, Framer Motion in seconds). Both files say so at the top.
- **Landing palette / typography** — the `@theme` block mirrors the YAML frontmatter in `public/LoginPage/DESIGN.md` (and its verbatim copy at `public/LoginPage/Contact&InquirePage/DESIGN.md` — same hash, so edit both), which is the design source of truth.
- **Fonts** — `--font-title-md`, `--font-body-lg`, `--font-code-sm` etc. name Hanken Grotesk / Inter / JetBrains Mono, which are loaded by `<link>` in `index.html`, not by the `@import` in `index.css` (that one only pulls Roboto).

**The logo goes through `src/components/Logo.tsx` — never an inline `<img>`.** Twelve call sites across `App.tsx`, `ContactPage`, `DocsPage`, `FeaturesPage` and `LoginPage` each used to hardcode the same ~700-character `lh3.googleusercontent.com/aida-public/…` URL. Three rules the component exists to hold:

- **Local asset, not that CDN.** It was an AI Studio-hosted file the project does not own and cannot re-issue. Measured with the host blocked: every logo in the app rendered as a broken image. `public/logo.png` ships in the repo and was already the favicon in `index.html`. Do not reintroduce a remote URL for branding.
- **`width` and `height` are always set, and removing them is a visible regression.** With `h-8 w-auto` and no intrinsic size, the box collapsed to the width of its *alt text* until the image arrived — measured at **106.2px instead of 32px**, so the wordmark beside it started ~74px too far right and snapped left on load. Both dimensions are now declared, and the box stays reserved even when the asset never loads.
- **Dark mode swaps the file via the `dark:` class variant, not `prefers-color-scheme`.** The app toggles `.dark` on `document.documentElement`, so a `<picture>` media query would ignore the in-app theme switch. Both variants render and Tailwind hides one; swapping `src` in an effect would flash the wrong mark on first paint. `logo_white.png` is the dark-surface variant (white triangle instead of navy) and had been sitting unreferenced.

- **WebP is offered via `<source>`; the `<img>`'s `.png` is the real fallback, not decoration.** Do not collapse the `<picture>` into a bare `<img src=".webp">`. Verified with `*.webp` blocked: the PNG loads and the layout is unchanged.

Assets were downscaled to 256×256 against the largest on-screen use (56 CSS px, with 3× DPR headroom), then encoded to WebP at q=0.94: **3.28 MB → ~18 KB actually served** (8.4 + 9.5 KB), with the 84 KB of PNG retained only as fallback. The lossy step is measurably invisible — the alpha channel round-trips exactly (`maxAlphaDelta 0`) and the large RGB deltas are confined to fully-transparent pixels where RGB is undefined. **There is no vector source and it is not worth manufacturing one**: the mark is gradient/shaded artwork that only ever existed as raster, so an auto-trace would look worse than what ships. WebP is the end of the line for size here.

The full-resolution originals (659px and 2048px) are preserved in **`assets-source/`**, which is outside `public/` on purpose — anything in `public/` is copied verbatim into `dist/`, so keeping them there would have shipped 3 MB of unused PNG. `index.html` still points the favicon at `/logo.png`: broadest support for the one request that happens before any component code runs.

The animation dependency is **`motion` v12, imported as `motion/react`** — not the legacy `framer-motion` package, which is not installed. "Framer Motion" below means that import. Every animated file uses `from 'motion/react'`; keep new ones consistent or the bundle picks up two copies.

The division of labour for animation is a convention, not a preference: **hover / press / focus / colour go through the CSS helpers** (`.u-transition`, `.u-transition-fast`, `.u-press`, `.u-focus-ring`, `.u-tap`) in `@layer components`; **mount / unmount / reorder / tab switches go through Framer Motion** using the presets in `src/lib/motion.ts`. Do not hardcode durations or easings in components.

Reduced motion is covered in three layers, and each one only reaches what the others cannot: the `prefers-reduced-motion` media query in `index.css` reaches CSS transitions only; `<MotionConfig reducedMotion="user">` in `src/main.tsx` covers every Framer animation in the app (transform and layout animations dropped, opacity kept, so content still arrives without sliding); and `respectReducedMotion()` collapses individual layout-affecting variants. New animated components inherit the `MotionConfig` for free — don't reimplement it per component.

`src/main.tsx` is otherwise just the mount point: `StrictMode` → `MotionConfig` → a class `ErrorBoundary` → `App`. Any render-time throw anywhere in the tree is swallowed into a full-page "Something went wrong" card with a reload button, so a crashed app looks like that panel rather than a stack trace — check the browser console (or the in-app `DebugConsole`) for the real error.

## Firebase skills

`.agents/skills/` contains Firebase's official skill packs — `firebase_basics`, `firebase_auth_basics`, `firebase_firestore`, `firebase_security_rules_auditor`, `firebase_hosting_basics`, `firebase_app_hosting_basics`, plus `firebase_ai_logic_basics`, `firebase_crashlytics`, `firebase_data_connect_basics` and `firebase_remote_config_basics` for products this app does not use. Consult the relevant `SKILL.md` before changing `firestore.rules`, auth flows, or deployment config. (`xcode_project_setup` ships in the same folder and is irrelevant here.)
