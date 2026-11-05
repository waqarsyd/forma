# Testing

Split out of `CLAUDE.md` on 2026-09-06, carried across unchanged apart from heading
levels, the cross-references, and the inventory — which was a run-on sentence and is a
table here. The reason for the split is the same one that produced the other four notes
on 2026-08-13, and this time it can be quantified: the inventory below was **8,400
characters, 12% of a file loaded in full into every session**, spent carrying a table
that `npx vitest run` reproduces in thirty seconds. `CLAUDE.md` keeps the two facts a
session needs regardless of what it is touching — that the suites exist and cover
little, and that you recount by running them — and routes here for the rest.

**Nothing here is loaded automatically.** Reading `CLAUDE.md`'s two-bullet summary of
this area is not a substitute for opening this file before you change it.

**This note is the only place in the repo the counts are written down.** The *Commands*
block in `CLAUDE.md` and the *Testing* section of `README.md` both describe the suites
without numbering them, on purpose — three copies of "38" drifted apart once already. If
you add a test, this is the file to update, and it should stay the only one.

## There are two test suites, and between them they still cover little

`npm test` runs Vitest over **2,402 tests in 125 files** — under the `node` environment
by default, with the files that genuinely need a DOM, marked in the inventory below,
opting into jsdom on their own first line; see `vitest.config.ts` for why that split is
load-bearing rather than tidiness, and `CLAUDE.md` for the cold-cache cliff that makes those fail in a way
that looks like a broken install.

They cover the pure helpers in `src/lib`, the config-persistence allowlist in
`reportConfigStore.ts`, the stream scanner in `geminiService.ts`, the `history` /
`location` handling in `router.ts` (the one file that is not a pure helper — it *needs*
the jsdom environment rather than merely tolerating it), the per-route titles and view
mapping in `routes.ts`, which also reads `index.html` off disk to check the home title
against the `<title>` tag, and — added by the 2026-08-27 audit — the AES-GCM key vault,
the two outbound calls that can hang, the server's response headers and bind address,
and the privacy policy's third-party disclosure, which `legalDisclosure.test.ts` checks
by reading `ContactPage.tsx` and `index.html` off disk the same way.

Each was chosen because it encodes an invariant that fails *plausibly* rather than
loudly.

**As of 2026-09-05 that is no longer the whole story, but the gap is still large.**
`App.tsx`'s view state machine and its attachment budget were extracted into
`lib/workspaceView.ts` and `lib/attachmentBudget.ts` and are now tested — which is the
route `CLAUDE.md` has always prescribed ("raise the number by shrinking `App.tsx`"), not
a widening of the coverage scope. And the first two **component** tests exist, on
`DataBinding` and `BatchPanel`, using `@testing-library/react` (a devDependency, so no
bundle cost) with `// @vitest-environment jsdom` on line 1 like every other DOM file.
Three more have joined them since; the table above is where the current set lives.

**The chat was unpicked out of `App.tsx` over 2026-09-07 and 08**, in three commits, and
took the component count to four: `lib/chatSession` holds the transcript rules,
`ChatThread` draws it, `Composer` is the box you type in. `AccountDialog` followed on
2026-09-08 and made it **five**, which is the number the table above is the authority for
— that sentence describes the day the chat was extracted, not the count today, and the
distinction is the only reason it still reads "four". **The order is the part worth
copying** — each component's render tests were written and passing *before* `App.tsx` was
switched over to it, because an extract-then-check is unverified by construction, and
that is the order that produced the bug `DataBinding` was added after. Each was then
mutated to confirm the tests could actually fail, and each swap was checked against the
running app by pixel-comparing screenshots with the run before it. Two real defects fell
out of doing it that way rather than out of the suite: Enter bypassed the send button's
`disabled` entirely, re-entering `handleGenerate` mid-request, and clicking send dropped
keyboard focus because the button disables under itself.

**Everything else is still unenforced**: `App.tsx` is several thousand lines and what has
been extracted is a small fraction of them, most components still have no render test,
and `ReportPreview` has none because its portal, `ResizeObserver` and `window.print` are
browser behaviour rather than logic — the `run-forma` skill drives those instead.
Where the documentation calls something an invariant and it is not in one of these
files, you check it by hand or it ships broken.

## The inventory

Paths are relative to `src/`. Verified against `npx vitest run --reporter=json` on
2026-09-06.

| File | Tests | |
|---|---:|---|
| `components/AccountDialog` | 23 | jsdom |
| `components/BatchPanel` | 15 | jsdom; since 2026-11-04 also a chosen folder queued by path, a drop on the panel, and two at a time with a quota failure stopping both workers |
| `components/ChatThread` | 40 | jsdom; since 2026-11-05 an empty conversation showing nothing (from 2026-11-01 until then, the predefined descriptions it started from); since 2026-11-01 a description's questions asked as a form holding their suggestions; since 2026-11-04 the working dots named for a screen reader before the first token, and a reply drawn as its words with no buttons; and editing and withdrawing a sent message, and searching the transcript |
| `components/Composer` | 31 | jsdom, 6 from one loop (the no-key case left it on 2026-11-02, when a missing key stopped locking the box; since 2026-11-05 one test locks it again with no key, sends nothing and offers the key button in place of the send); a clean composer (2026-11-04): nothing under the box with or without a key, and the send a Stop while a generation runs; the one chat box (2026-11-01): no separate Describe or OCR button, an attached image shown as the file alone and sent at once, its text read after the message goes (2026-11-03; until then its reading showed on its chip and held the send), a pasted image attached |
| `components/DataBinding` | 18 | jsdom |
| `components/LibraryPanel` | 17 | jsdom |
| `components/NotFoundPage` | 2 | jsdom; the 404 page's `noindex`, added while it is shown and taken away when it goes |
| `components/OcrDialog` | 7 | jsdom, the engine replaced; pages read one at a time, a failed page left out and said so, Stop aborting the run, low-confidence text listed and named or left out, a report built after the app's checks, a PDF page read at its resolution, and pages the chat box read already shown without reading them again |
| `components/ReportPreview` | 29 | jsdom; since 2026-11-04 also Shift+click selection deleted and nudged as one step, Add label, a table cell retyped, a label retyped in one placement of a repeated band, and a declined edit saying why; since 2026-11-04 also the grouping field chosen above the paper, through the undo path and only where the pane edits; inline styles computed from the file, against what DevExpress printed; a parameter value typed over test data; a link as an anchor; a cross-band box and line; turned text; the page drawn unkerned; Export CSV; a drill-down group opened and closed by its toggle; a picture box drawn as its image zoomed into its box, and a dashed box naming what it would show when it has no image (2026-11-04) |
| `components/legalDisclosure` | 9 | 3 from one loop |
| `lib/analysisResponse` | 14 | 4 from two `it(` sharing one loop; since 2026-11-05 the answer is the REPX as raw XML: unwrapped from a fence, a preamble or the old JSON shape, cut off told from malformed, an unfinished document with a normal finish kept |
| `lib/aiProvider` | 7 | jsdom (storage); the workspace open only with the Gemini key in, whichever AI is chosen, and that AI ready (2026-11-05); which AI answers: Automatic as Gemini, key or no key, since Forma Offline went into it on 2026-11-05, and the retired Gemini and Forma Offline choices read as Automatic, ready only with what each provider needs, Forma's vision model found as a helper beside any AI or as the Local AI model itself and alone only then, the choice kept in localStorage and the OpenRouter key only in this tab's sessionStorage, an unknown provider ignored |
| `lib/announcements` | 7 |  |
| `lib/autoConfig` | 13 | the settings Forma works out per request (2026-11-04): a report's version, unit, paper, orientation, direction and its stored procedure out of DevExpress's base64 data source; a PDF page's paper by its points; A4 and tabloid in words always, letter and legal only beside a paper word; the region's paper; right to left from the script; EXEC, CREATE PROCEDURE and "stored procedure"; the order report, page, words, learned, region |
| `lib/attachmentBudget` | 12 |  |
| `lib/attachmentParts` | 14 | 6 from one loop |
| `lib/attachments` | 9 |  |
| `lib/batchQueue` | 24 |  |
| `lib/boxText` | 5 | the boxes design for the vision model: its question word for word with render.py's, boxes numbered in reading order and read back, an answer read tolerantly, made a skeleton on the boxes' places, and scored box by box |
| `lib/boxReader` | 16 | Forma's box reader: texts grouped into the lines they print on; every line's and text's features finite and as many as the model reads; a small network's arithmetic; the second look given each line's own, neighbours' and lookalikes' first scores; a band that cannot follow the one above never decoded; a footer read as a record settled as the report's or a group's, its figure under the amounts a total, and a record with a field missing left a record; a skeleton keeping each band once and one record, a one-line record whose code recurs by chance and a two-line one, with every text where OCR read it; made a report with fields named after the captions; the shipped reader reading these features, holding no string but its names, and reading a plain listing as headings over records with its page number at the foot; a heading row taken for a record given back to the header; a report built from an OCR page and nothing from an empty one; a reader trained on other features refused, and fetched again |
| `lib/chatSession` | 31 | since 2026-11-04 also withdrawing a turn and the transcript search: a query taken as text, and cut correctly where lower-casing changes a length |
| `lib/contactSubmit` | 6 |  |
| `lib/criteria` | 10 | DevExpress's expression language; the 44 expressions and 11 totals of parity case s16, each a string DevExpress printed |
| `lib/csvExport` | 6 | CSV export; three expectations are DevExpress's own exported files, byte for byte |
| `lib/dataSource` | 29 |  |
| `lib/datetime` | 12 |  |
| `lib/designerBridge` | 38 | 8 from one loop |
| `lib/draftText` | 11 | jsdom (`checkRepx`); Forma's draft as the AI corrects it (2026-11-05): written line by line with its words, fields, groups and colours and read back exactly; words with spaces, quotes and a bar; a line and a table written with no role, font or alignment, quoted from the first measured answers; the borders and length a model drops before its words, an alignment written as a word, a length left out, a total written as `sumSum([Amount])` and a fence forgiven; words only for text and a field only for a value or a total; what cannot be read skipped and named; the report built from it carrying them, in the version asked for, a file the designer opens; the rules naming every band and role |
| `lib/embedStore` | 20 |  |
| `lib/exportItems` | 4 | the RTF, DOCX and HTML exports read back against DevExpress's of s54a: every frame's page and twips, a section per page, every HTML cell's place in the grid; and RTF text escaping |
| `lib/expressions` | 8 | the expression reference and the check a generated one is held to, including that an aggregate in a column prints blank |
| `lib/fidelity` | 18 | the benchmark's scorer; the runner under `scripts/fidelity/` is not in the suite |
| `lib/folderDrop` | 9 | the batch panel's folders and drops: a folder read to its end past the reader's first batch of 100, what the batch takes by type or name, path order, the 500 cap |
| `lib/formaModel` | 12 | Forma's own model over made-up reports: a skeleton keeps the structure and every text's role and none of its words, the paper named either way up, the feature vector; a Crystal Reports layout (`skeletonFromLayout`) named, margined and titled as a parsed report is, with unknown kinds, roles and non-finite numbers held to the vocabulary; `categoryOf` naming a generic category and never the folder; the house style by role, two kinds of report with their categories, the archetype a request names ranked first, the same clusters every time; `unexpectedStrings` empty and naming what is slipped in; and the shipped `assets/model/formaModel.json` holding no string outside its vocabulary |
| `lib/formaTeam` | 10 | since 2026-11-05 the reply naming the AI as correcting Forma's draft and Forma as building the report; Forma's team: the vision model's draft told to the AI in the report's own unit, with OCR's words, bound values and totals named, a long text cut and the boxes capped, and the image said to win; the box reader's draft said to be the box reader's; the house style told as defaults, nothing when it holds nothing, and the shipped model's style read; who took part named in order; why the AI did not answer in a few words, and what the stand-in draft was made from |
| `lib/firebaseClient` | 4 | the auth and Firestore halves of the loader against mocks, and the imports that would undo the split against the source |
| `lib/geminiClient` | 6 |  |
| `lib/handwriting` | 5 | handwriting read again by TrOCR: only the lines Tesseract read below 70, each cut with room around its ink, put back as one word over the line, a line read as nothing kept |
| `lib/geminiErrors` | 28 | since 2026-11-02 also which quota a 429 is (daily or per minute), the count to midnight Pacific when daily quotas reset, and a spent daily allowance named as one, with a local AI or OpenRouter offered meanwhile (Forma Offline until 2026-11-05) |
| `lib/generationProgress` | 22 |  |
| `lib/houseStyle` | 18 |  |
| `lib/libraryDb` | 12 | record mapping only; no IndexedDB in jsdom |
| `lib/memory` | 7 | jsdom (storage); Forma's memory: a message asking to remember known from a request, its words kept with the paper, orientation, face and sizes it names; a kept report's style kept with none of its words; the newest 30 kept, a style learned from two; the user's words winning over their reports and a switched-off memory skipped; what an AI is told; read back from this browser |
| `lib/mockupRows` | 12 |  |
| `lib/modelCache` | 17 |  |
| `lib/modelCatalog` | 24 |  |
| `lib/netDecimal` | 8 | .NET's decimal: scale, exact sums, 28-place division, both roundings |
| `lib/netFormat` | 15 | .NET composite, date and number formatting in en-US; every cell of parity case s15's format table is a string DevExpress drew |
| `lib/ocr` | 4 | Tesseract's blocks read as words and lines with boxes and confidence, enlarged boxes divided back |
| `lib/ocrScript` | 8 | OCR working out a page's language (2026-11-04): a page's confidence weighted by its text, a confident page taken as Latin script, the widest garbled lines probed and not the mixed ones, the owner's certificate's measured scores choosing Arabic, a script not far enough ahead or winning on too few lines refused, French, German and Spanish known by their function words and English left as English, handwriting tried only when enough lines stay unsure |
| `lib/ocrLayout` | 14 | OCR to layout: a label at its text, a line split at a gap wider than it is tall and between two amounts however close, but not inside a number with a space between its thousands, aligned rows as a table and a row that does not line up kept out of it, a table sized by its cells' widths when their boxes take in the borders, the text for the model, low-confidence words flagged, picture readings set aside, margins fitted to the content, a screenshot fitted to the printable width, the font from the ink |
| `lib/ocrRepx` | 6 | jsdom; a detected layout written as a .repx: the app's own checks pass, every label and cell where the layout put it on the report header, a page break per page, labels as wide as Arial prints them, the Mockup's layout and the spec from the same controls, Dpi and paper by the repair passes, flagged text named or left out |
| `lib/offlineGenerator` | 7 | jsdom (`checkRepx`); reports designed by Forma's own model over the shipped model: the words read for category, columns, grouping, totals and page; field names, captions, types and titles; a grouped payroll report that opens, passes the audit and prints its records, group totals and grand total; a pasted schema and a given title winning; the house style and a remembered paper; a named kind of report starting from its usual columns; the category's pattern chosen |
| `lib/panelSize` | 13 |  |
| `lib/sidebar` | 5 | the workspace sidebar as Gemini's and ChatGPT's (2026-11-04): the stacked breakpoint at 880px, the measured widths, Ctrl+B or Cmd+B and none of its neighbours, the toggle's name |
| `lib/pdf` | 5 |  |
| `lib/pdfA` | 15 | PDF/A (row 72) against s60 and s62: the root's `PdfACompatibility` read, dates and XMP that agree, the sRGB ICC 2.1 profile's header, tags and curve, pictures flattened over white; the embedded fonts' `?` for a missing character, widths, Unicode map in blocks of a hundred and beyond the BMP, CIDSet, subset tag; a written PDF/A file (1.4, output intent, uncompressed XMP, Type 0 over CIDFontType2, CIDSet, `Length1`, identifier, dates, link print flag, no SMask for part 1), read back as text by pdf.js; PDF/A with a password refused; a report not asking for it unchanged. The same writer's files passed veraPDF 1.30.3 as 1b, 2b and 3b |
| `lib/pdfCrypto` | 8 | 3 from one loop; MD5, RC4 and AES-128/256 against their published vectors; the file's `PasswordSecurityOptions` as DevExpress wrote them (s61); Forma's encrypted PDF opened by pdf.js at AES-128, RC4 and AES-256 with either password, its text, title, link and outline read, and refused without; the permissions under each password (row 73) |
| `lib/pictureBox` | 11 | an XRPictureBox as DevExpress 20.1 printed every Sizing mode (row 76): PNG, JPEG, GIF and BMP headers read for the pixels and the DPI, 96 when unsaid; the settings with their defaults; the same pixels at 192 dpi half as large; Normal, CenterImage, StretchImage, AutoSize, ZoomImage, Squeeze and Tile in a 180 by 100 box, with a small and a large image; a written ImageAlignment in every mode; an image of unknown size drawn zoomed |
| `lib/pdfWriter` | 5 | pdfjs warmed in a `beforeAll` since 2026-11-02, when its cold import timed the first case out in a full run; the PDF outline against DevExpress's for s54a to s54c, Windows-1252 text, and a written PDF read back with pdfjs: pages, text, an image, a link and the outline, compressed and not |
| `lib/promptSections` | 48 |  |
| `lib/promptToReport` | 11 | the pure half of Prompt-to-Report (its six predefined prompts and their test went on 2026-11-05); a description typed into the chat box, its fenced or CREATE TABLE schema taken as the data source |
| `lib/reportBands` | 14 | since 2026-11-05 no layout JSON or markdown asked for, and no row cap |
| `lib/reportConfigStore` | 14 | since 2026-11-04 only the version and unit learned from the user's reports are kept, a version only as major and minor, and what earlier builds stored for the paper, header, footer, direction, procedure and OCR retired on the way in |
| `lib/reportData` | 23 | 7 from one loop: every summary scope in every band of parity case s17, against DevExpress's own pages and groups; then sorting, group runs and filtering |
| `lib/reportGeometry` | 43 |  |
| `lib/reportPreview` | 304 | 32 from eight loops, the fifth an `it.each` over the four table-of-contents placements, the sixth over two drill-down cases, the seventh over four s57 page feet and the eighth over four right-to-left cases: parity cases c05 to c05e page for page, the seven s19 nesting variants, the four one-field-per-kind cross-tabs' CSVs, and s29a and s29b; a chart's points over test data against DevExpress's, and its pie shares (row 32); drill-down collapsed (s56a, s56d) label for label, expanded as none, one group toggled, and the CSVs byte for byte (row 69); a one-line record at the foot of the page kept while its line fits and moved whole once it does not, with a page footer and without, against DevExpress's PDFs (s57); interactive sorting leaving the data and `SortFields` orders as DevExpress printed them (s58); right to left, every label's and cell's aligned edge against DevExpress's PDFs of s63a to s63d, and the file's own x kept for edits (row 75) |
| `lib/repx` | 24 | jsdom |
| `lib/repxAccessibility` | 21 | one loop of five control types inside one case |
| `lib/repxAudit` | 94 |  |
| `lib/repxBindingPlan` | 67 |  |
| `lib/repxBindings` | 33 |  |
| `lib/repxChunks` | 22 |  |
| `lib/repxCrossTabs` | 37 | 24 from one loop: every field shape DevExpress's `GenerateLayout()` produced, cell for cell, ten of them unseen when the rule was written |
| `lib/repxDpi` | 11 | Dpi in millimetre and pixel reports; the expectations are files DevExpress saved, stripped and repaired back |
| `lib/repxEdit` | 33 | since 2026-11-04 also deleting a control (its siblings numbered again, an emptied Controls removed, one named by `#Ref` declined), adding a label in its band's Dpi, and retyping a table cell (a bound one declined) |
| `lib/repxGroups` | 12 | nested groups written without `Level`; parity case s19, written as DevExpress printed it inside out, repaired and paginated into the nesting it printed with `Level` |
| `lib/repxGroupField` | 7 | the field a group breaks on, rewritten with its heading's binding and nothing outside the band; a header grouping by nothing given a field list with a fresh Ref; two groups by region becoming three by country over the same rows |
| `lib/repxItems` | 12 |  |
| `lib/repxLayout` | 11 | controls past the printable width or their band, bands taller than the page, inside a detail report too |
| `lib/repxMargins` | 24 |  |
| `lib/repxOverlaps` | 11 | FixLayoutErrors: overlapping siblings found and moved apart |
| `lib/repxPaper` | 10 | the paper DevExpress prints on, and naming it as its serializer does; parity row 44 |
| `lib/repxParameters` | 24 |  |
| `lib/repxRefs` | 26 |  |
| `lib/repxRtl` | 5 | the Settings checkbox's right to left, on the report root only, idempotent, and read back by the Preview as mirrored |
| `lib/repxStyles` | 18 |  |
| `lib/repxSummaries` | 19 | totals with no running scope, which DevExpress prints blank; each fixture is a shape it was made to print |
| `lib/repxTruncation` | 19 |  |
| `lib/repxViews` | 12 | the Mockup, the Spec and the title read off the REPX (2026-11-05): a section per content band in print order, x from the paper's edge and the top margin in the first section, font sizes in report units, a field as `[Field]`, a picture cropped from the upload only before the Detail band, what DevExpress does not print left out; the title from `DisplayName`, the largest text before Detail, or the `Name` |
| `lib/revisions` | 21 |  |
| `lib/revisionStore` | 26 |  |
| `lib/router` | 17 | jsdom |
| `lib/routes` | 16 |  |
| `lib/runawayOutput` | 10 |  |
| `lib/savedReport` | 33 | jsdom |
| `lib/skeletonRepx` | 11 | jsdom (`checkRepx`); a skeleton made a report again (milestone 6): written and read back through the Preview's parser as the same skeleton, caption lengths and A4's exact size aside; a file the app opens with no audit error; titles and captions in the words read inside their boxes, a placeholder where none was, "Total" in a footer; values bound to fields named after the caption over their column, totals summing that field at their band's scope; a date or a page number as the page showed; the empty Detail band DevExpress expects; the Mockup's sections and the spec; several pages' skeletons joined, the first page's bands kept and a later page's footers added where DevExpress prints them (2026-11-04) |
| `lib/skeletonText` | 21 | the text Forma's vision model learns to write (milestone 6): a skeleton written and read back exactly, one line per band, control and table row, places rounded to whole hundredths; a model's answer read tolerantly, each skipped line named, a malformed row skipped whole, no page line refused; bands as tall as DevExpress prints them; a variant with the same structure in other places, every control inside its band and the printable width, no word added, the same for the same seed; the instruction word for word as `train_vision.py` asks it, read from the script; the scorer, perfect on the right answer, pairing controls by place within a band; the page scorer that sets the model beside OCR, its fixed bands laid out as render.py draws them, a box right at half overlap and a text found where something was read inside it, readings among the records ignored; a font outside the public list found as a stray word, and replaced by Arial in labels and cells alike |
| `lib/sourceRect` | 14 |  |
| `lib/textMeasure` | 52 | 24 from one `it.each`; line breaking and spacing as DevExpress printed them, one line and several in ten fonts; the canvas broke 18 of 18 printed texts identically; the slack a line may overrun its box by, the faces GDI does not kern, and one line at the full spacing when it fits only kerned (row 59); which families have a synthesized bold and how far it widens (row 60), and the two widenings of the families that widen otherwise, against DevExpress's breaks and short lines (row 67); the families GDI does not kern (row 61); line metrics outside the table (row 63); the face the browser knows a GDI family name by (row 62); since 2026-11-04 also turned text laid out twice as DevExpress prints it (parity row 54), over fake widths, and one line as GDI+'s ascent and descent |
| `lib/themeTransition` | 15 | jsdom |
| `lib/tokenUsage` | 15 |  |
| `lib/trueType` | 6 | the committed Liberation faces read for a PDF descriptor (Arial's 905 and -212, a space of 277.832, as DevExpress's s60b); a subset keeping every glyph slot with outlines only for the glyphs used and the components of a composite, the nine tables, long `loca`, checksums a font reader accepts; a CFF font refused |
| `lib/userInstructions` | 9 |  |
| `lib/vectorSearch` | 14 |  |
| `lib/workspaceView` | 11 |  |
| `lib/xlsxExport` | 19 | 8 from one loop; Excel export; the expectations are DevExpress's own workbooks read into grids, one by fingerprint; the file's `<Xlsx>` options, every file, sheet, gridline setting and cell of s62a to s62h (row 74) |
| `lib/zip` | 25 |  |
| `server/bindHost` | 6 |  |
| `server/hostingConfig` | 9 | reads `firebase.json` off disk |
| `server/securityHeaders` | 27 |  |
| `server/staticCache` | 10 |  |
| `services/chatRetry` | 10 |  |
| `services/compatClient` | 9 | local AI and OpenRouter in the shape of Gemini's SDK, against a fake OpenAI-compatible server: text and images as chat messages, the response schema as a JSON Schema, the answer read back in Gemini's words (`length` as `MAX_TOKENS`), a server refusing the schema asked for a JSON object then plain text, a streamed answer, a 429 keeping its status, the models offered (OpenRouter's free ones, image readers first), and `compatEndpoint` |
| `services/draftCorrection` | 5 | Forma drafts and the AI corrects, against a stubbed network (2026-11-05): the rules, the draft and the picture sent, not the mega-prompt or OCR's text, thinking at `DRAFT_THINKING_BUDGET` unless the user set one; the report built from the answer; an answer that is no draft refused; a refinement or another unit designing as before |
| `services/embeddings` | 20 | SDK mocked, as `geminiService` is |
| `services/formaVision` | 5 | Forma's vision model through the Local AI endpoint, against a stubbed server: the picture then the instruction at temperature 0, the answer read as a skeleton with its text kept, a page that is not an image refused before asking; the model known by the name it was imported under |
| `services/generationRetry` | 17 | since 2026-11-05 an answer that finishes before its REPX does made again, what it wrote kept once the retries are spent, and the Mockup, the Spec and the title read off the REPX; since 2026-11-04 a retry after a loop asked at temperature 0.4 and the retry of a truncated stream left at 0; since 2026-11-02 also a model out of its daily allowance left for the next, every model out named as a daily limit, and an answer cut off by its thinking asked once more with thinking capped, not when the user set a budget; the generation path's runaway and truncated-stream retries, against a stubbed stream |
| `services/geminiService` | 38 | 7 of these come from one loop; since 2026-11-02 also the chat turn's instructions taking a written description as enough, and `generateSmall` turning thinking off for the small calls, asking a refusing model again with room, and not mistaking a rejected key for a refusal |
| `services/keyVault` | 21 | jsdom |
| `services/library` | 15 | storage and embedding injected |
| `services/modelResolution` | 35 | jsdom; since 2026-11-02 also the curated list probed without the catalogue when one of it answers, the choice remembered a day for the same key only, and the small calls sent to a Flash-Lite |
| `services/promptToExpression` | 4 | a sentence to an expression, checked against the fields, against a stubbed reply |
| `services/promptToReport` | 8 | description-mode framing, the overlap repair and the clarification call, and Forma's team brief placed ahead of the remembered preferences and the user's words, against a stubbed stream |
| `services/testData` | 4 | AI-generated sample rows, keyed by bound field, against a stubbed reply |

**Total: 2,402 in 125 files** — and that total is the arithmetic sum of the column above
it, which is the point of writing both down. A mismatch between them is the cheapest
possible signal that this table went stale, so adding a case changes **two** numbers
here, not one.

It has worked, late: `reportBands` was recorded as 16 and had been 17 since `183cce5`,
which added a case and bumped only the total. Corrected 2026-09-05 — but the entry sat
wrong for four commits, which is how long a one-file discrepancy can hide when nobody
adds up thirty-nine numbers. The table format is partly a response to that: a column is
easier to sum than a paragraph, and `npx vitest run --reporter=json` will produce the
whole thing for you.

## Recount by running the suite, never by grepping

A grep for `\bit(` answers **2284** against a real 2,402 and will talk you into
"correcting" numbers that were already right. **Ten** files generate cases from a loop,
and they are marked in the table above: `geminiService` produces seven of its 33 from
one `it(` over split points, `designerBridge` eight of its 38 over Windows reserved
device names, `attachmentParts` six of its fourteen over malformed data URLs,
`legalDisclosure` three of its nine over the disclosure table, `Composer` eight of its 35
from **two** `it(` sharing one loop over the four conditions that must block a send,
`analysisResponse` four of its fourteen from **two** `it(` sharing one loop over stop
reasons — the shape `Composer` now also has — `reportData` seven of its 23 from one
`it(` over the bands of parity case s17, `reportPreview` twenty-two of its 280 from five
`it(`, one over the five c05 cases, one over the seven s19 nesting variants, one over four cross-tabs, one over s29a and s29b and an `it.each` over s55a to s55d,
`repxCrossTabs` twenty-four of its 37 from one `it(` over the field shapes DevExpress generated, and `textMeasure` twenty-four of its 45 from one `it.each` over DevExpress's synthesized-bold measurements, which the grep does not count at all because it is not spelled `it(`.

**The shortfall is a constant, not a coincidence** — every other file adds as many tests
as it has `it(` calls, so both totals move together. **A change in the *gap* is the
signal worth reading**: it means a loop was added or removed, and nothing else does it.

**It was 22 from the split until 2026-09-08, and it is 28 now.** `Composer`'s loop is
what moved it — one `for` over four blocking conditions, each asserting both that Enter
is refused and that the button is disabled, so two `it(` calls became eight tests and the
gap grew by six. That is the mechanism working as designed rather than a discrepancy to
hunt: the number changed because a loop was genuinely added, which is exactly what this
paragraph exists to let you conclude in one step.

**It is 44 as of 2026-10-30**, and the same reading applies twice. `reportData` added
one `for` over seven bands, so one `it(` became seven tests and the gap grew by six.
`reportPreview` then added two: five c05 cases from one `it(` and seven s19 variants from
another, ten more. It is **67** after parity row 30: `repxCrossTabs` added one `for` over
24 shapes, so one `it(` became 24 tests and the gap grew by 23. It is **70** after row 31,
whose loop over four cross-tabs added three more, and **71** after row 36, whose loop over s29a and s29b
added one. It is **95** after row 67: `textMeasure` added one `it.each` over 24 of DevExpress's
synthesized-bold measurements, which the grep cannot see at all, so the gap grew by 24. The ten loop
files account for all of it, so every other file's grep count still matches the table. It is **99** after row 68, whose `it.each` over four table-of-contents placements added four the grep cannot see.

Two ways the arithmetic goes wrong:

- **The gap can close from the wrong end.** Prose mentioning the vitest call counts as a
  grep hit, so a file discussing this trap inflates the grep instead of deflating it and
  the two errors quietly cancel. `repxBindings.test.ts` deliberately avoids naming the
  call in its own header comment for this reason. This note is not swept by that grep —
  it lives in `docs/` and the pathspec is `src/**/*.test.ts` — but keep the habit.
- **The word boundary is load-bearing.** A bare `it(` also matches `omit(`, which scores
  `repx.test.ts` at 27 instead of 24. Every file outside the ten loop files has a grep
  count matching this table exactly, but only with `\b`.

## The rules suite is three files, and the second is the non-obvious one

`npm run test:rules` runs **70 tests in three files** against the Firestore emulator:

| File | Tests | What it proves |
|---|---:|---|
| `tests/firestore.rules.test.ts` | 45 | account isolation, document shape, the key vault, the version subcollection |
| `tests/accountDeletion.test.ts` | 15 | deleting an account really removes the reports, **their version history** and the encrypted key |
| `tests/revisionRoundTrip.test.ts` | 10 | a history saved and read back through the same `saveRevisions` / `loadRevisions` the app calls |

`accountDeletion` earns its place because **Firestore does not delete a subcollection
with its parent document**, so a report removed with a bare `deleteDoc` strands its
whole history — and the result is indistinguishable from a clean delete. It runs through
an authenticated context with the production rules enforced.

`revisionRoundTrip` exists because the other two cannot see each other: a plan that is
right in memory and a rule that is right in isolation still produce nothing useful if
the read comes back in an order the numbering did not expect, and `fromVersionDocuments`
numbers downwards from the newest on the strength of the caller's `orderBy`.

## Test placement is two conventions, and the split is load-bearing

Colocated `*.test.ts` beside the module for the unit suite; `tests/` at the **root**,
outside `src/`, for anything needing the Firestore emulator. That is *why* it is outside
— it is what stops `npm test` trying to start a JVM.

**A module can have a file in both**, and `revisionStore` is the first:
`src/lib/revisionStore.test.ts` covers the planning and numbering against arrays, while
`tests/revisionRoundTrip.test.ts` drives the same functions against real Firestore
through an injected `VersionIo`. Neither is redundant — the array test cannot see an
ordering the emulator returns, and the emulator test is too slow to enumerate edge cases
in.

**The `src/server/` tests stay under `src/` for a reason that is easy to undo.**
`vitest.config.ts` has `include: ['src/**/*.test.{ts,tsx}']`, so moving them to a
root-level `server/` would silently drop **forty-two** cases — `6 + 26 + 10`, from the
inventory above. If you ever do move them, widen that include in the same commit and
check the count against the total. (Forty-two is the durable number here. `CLAUDE.md`
used to write it as a before-and-after pair of suite totals, which was stale within days
of every commit; the subtraction is the fact, not the endpoints.)

## A component test's job is what the user is shown, not how it looks

The two that exist were written after three render defects shipped in one day:

1. a pane that said "cannot be bound yet" immediately after a successful bind;
2. a button styled with a modifier class that does not exist;
3. JSX dropping the space before a word.

**Only the first is a component test's business** — it is state logic, and there is a
test that fails if the ordering is restored. The second and third are what looking at a
screenshot is for, which is why the `run-forma` skill exists alongside these tests and
not instead of them.

## What `npm run test:coverage` measures, and the two zeroes that are not gaps

The number it prints is scoped on purpose. `vitest.config.ts` includes only
`src/lib/**` and `src/services/**` — `App.tsx` and the twenty components are **not** in
the denominator, because counting code that cannot be unit-tested until `App.tsx` is
broken up would move the figure for reasons unrelated to whether anything got safer. Do
not "fix" that by widening the include list; **raise the number by shrinking `App.tsx`**,
which is what `workspaceView` and `attachmentBudget` were.

**Two zeroes in the report are not untested paths.** `src/lib/accountData.ts` reads 0%
because everything exercising it lives in `tests/accountDeletion.test.ts`, which runs
under the *other* config against the emulator and is not in this run at all.
`src/services/firebase.ts` reads 0% because it is the Firebase singleton — importing it
initialises an app, and there is nothing in it to unit-test.

The config says all of this at the point of use; read the comment there before changing
the block.

## Running one file, and what that does not buy you

Run a single test file with `npx vitest run src/lib/repx.test.ts`, or a single case with
`-t "<name>"`. **Narrowing to one file buys clarity, not time.** The numbers `CLAUDE.md`
used to give (~30s against ~34s) were measured cold and are wrong by an order of
magnitude: re-measured 2026-08-20, the first `npm test` of a session took 52s and the
very next one 4.6s, while a single file is ~5s either way. Warm, one file and all
fifty-two cost about the same.

Read a slow first run as a cold cache, not as a hang — and never quote a timing anywhere
in this repository that came from a cold run.

## A cold cache can look exactly like a broken install

**Until 2026-08-28 a cold cache did worse than crawl: it made the suite fail outright.**
jsdom's entry loads synchronously, and cold it was measured at **113 seconds** in one
process on this machine against 1.4s warm — while vitest gives a worker **60 seconds** to
report in (`START_TIMEOUT`, hardcoded in vitest's dist with no config option feeding it).
Every worker died before starting, and all 25 files of the day reported
`[vitest-pool-runner]: Timeout waiting for worker to respond`, which reads as a broken
pool or a broken install and is really a stopwatch.

**If you see that error, the suite is not broken and neither is your install. But do not
just run it again** — that was the advice until 2026-09-04 and it is wrong. Each worker
is killed at the 60s mark *before* it finishes populating the cache, so every re-run pays
the full cold price and dies in exactly the same place; you can repeat it all afternoon.
The warm-up has to happen **outside** vitest, in a process nothing is timing:

```powershell
node -e "import('jsdom')"    # takes as long as it takes; then npm test
```

Measured on 2026-09-04: that import took **507 seconds**, the second one 1.69s, and
`npm test` then ran green in 4.52s. The cold figure is 4.5x the 113s recorded in 2026-08
— this is a shared machine and the cold cost tracks I/O contention, so **re-measure
rather than trusting either number**. What is stable is the shape (one enormous first
load, then ~1.5s) and the 60s ceiling it has to fit under. `README.md` carries the same
figures, so re-measuring is a change to two files.

**The environment split narrowed the cliff without removing it.** Keeping the majority of
files under `node` cut summed environment setup from ~66s to ~8s and took the cliff from
every worker down to the ones that opt in — and it still fires: `themeTransition.test.ts`
died on both 2026-09-02 and 2026-09-04. The jsdom files are marked in the inventory above.
**When only the jsdom files fail and every other file passes, this is what you are
looking at.**

*Measured 2026-09-08:* **11 jsdom files holding 251 tests, 48 node files holding 1,063.**

(Read that as a dated measurement, not a maintained figure. The sentence above used to
carry the numbers inline and has been wrong three times: "24 of the 30 files … 366 tests"
until 2026-09-06, then "44 of the 52 … 935" for a suite that was already 53 files and 985
node tests, then "the eight jsdom files hold 167" for eleven files holding 251. Three
corrections is enough evidence that a hand-maintained split does not survive, so the
prose no longer depends on one — the shape of the failure is the part worth recognising,
and the arithmetic is one command away.

**Derive it, do not adjust it.** The jsdom files are the ones with
`// @vitest-environment jsdom` on line 1; sum their rows in the table above for the jsdom
figure, and the node figure is the table's total minus that. Both fall out of the
inventory, which is the only thing here anyone actually keeps current.)

**One red file after a cold run was the same stopwatch wearing a different error, and
the fix was not where two attempts looked for it.** From 2026-09-05 to 2026-10-28,
`src/services/chatRetry.test.ts` failed its first case — *retries and returns the reply
instead of failing* — with `Test timed out in 5000ms` in roughly one full-suite run in
ten, never when run alone, and on 2026-10-28 for the first time on the CI runner. The
test advances a fake clock through two backoffs, so both fixes tried on 2026-09-08
adjusted the clock, and both made it fail more often; the file's `runTurn` comment kept
that record and said the next attempt should start by finding what was still pending
when the budget expired. The answer was the SDK. `chatReply` reaches `@google/genai`
through `loadGenAI()`, which imports it on first use so the landing page does not carry
it, and in this file the first use was inside the first test — so the first test paid
for loading the SDK from disk against its own 5s budget while every later test found the
module cached. Measured with the file alone and warm: the first case took 250ms and the
other nine took 2 to 9ms, and a fresh Node process imports the package in ~150ms. Under a
full suite, with a cold cache or on CI (which is cold every time), that one import
occasionally exceeded 5s. The fix is a `beforeAll` in that file that imports the SDK
with a 60s budget of its own, before any test's clock starts; the first case then
measures 49ms. `resetGenAIForTests()` clears only the memoised promise, not Node's
module cache, so warming the module once is enough and every test still exercises
`loadGenAI()`. **The general lesson is the one above with a different lazy loader**: a
dependency that is loaded on first use lands its cold cost inside whichever test uses it
first, and that test's duration will be an order of magnitude above its neighbours' even
when it passes. `src/lib/pdf.ts` and `src/lib/firebaseClient.ts` are the other two
loaders, so a first-case-only timeout in a file that reaches either should start here.

**`--reporter=basic` no longer exists.** Vitest 4 removed it, and an unknown reporter
name is treated as a module to import, so the failure is a `Failed to load custom
Reporter from basic` / `Failed to load url basic (resolved id: basic)` stack trace with
Vite frames in it — which reads like a broken config rather than a bad flag value.
`vitest.config.ts` already sets `reporters: 'default'`; pass `--reporter=dot` for the
terse output `basic` used to give. Verified on vitest 4.1.10.

## Three configs, and the rules suite uses its own

`npm run test:rules` is `firebase emulators:exec --only firestore "vitest run --config
vitest.rules.config.ts"`. **The emulator wrapper is what supplies the Firestore
instance**, so `vitest run --config vitest.rules.config.ts` on its own has nothing to
talk to. `tests/firestore.rules.test.ts` sits outside `src/`, which is why the default
config never picks it up and `npm test` cannot run it by accident.

`vitest.config.ts` is deliberately separate from `vite.config.ts` — that one carries the
"Do not modify" HMR block and is loaded by the dev server. Tests live beside what they
test as `*.test.ts`, and the default config only picks up `src/**/*.test.ts`.

## Running a single rules case: use a space-free regex

**Do not try to nest quotes.** The `-t` flag has to go *inside* the quoted command the
emulator wrapper runs, and PowerShell 5.1 re-parses that string before `firebase` ever
sees it, so the obvious `-t \"lets a user read their own report\"` arrives mangled
(observed: `Script "… -t " lets a user read their own report\" exited with code 1`).
`-t` is a **regex**, so a `.` in place of each space sidesteps quoting entirely:

```powershell
npx firebase emulators:exec --only firestore "npx vitest run --config vitest.rules.config.ts -t lets.a.user.read.their.own.report"
```

Verified: `1 passed | 28 skipped`. A distinctive single word (`-t isolation`) works the
same way and is shorter.
