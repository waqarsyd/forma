# Project structure

The repository's file layout, with a note on every file or folder that needs one. It moved here from the README on 2026-11-21 to keep the README short, and it is still the only copy: a new file under `src/lib` or `src/services` is also an edit to its `lib/` or `services/` entry below. The README keeps a one-table overview, [*Project structure*](../README.md#project-structure).

```
src/
  App.tsx              the workspace and the chat, loaded on /workspace
  PublicSite.tsx       every public page and the sign-in dialog, without
                       the workspace (the entry since 2026-11-08)
  main.tsx             entry point: PublicSite, or App on /workspace, the
                       offline banner and the offline worker's registration
  index.css            tokens, marketing pages, shared chrome (Tailwind v4, no config file)
  workspace.css        the workspace shell only — every `wb-` class lives here
                       but the lazy menus', in components/overlays.css
  vite-env.d.ts        Vite's ambient types; the one file here not in
                       PascalCase.tsx / camelCase.ts form, because Vite names it
  components/          LandingPage, FeaturesPage, DocsPage, ContactPage,
                       ChangelogPage (/changelog, every release),
                       LoginPage, LegalPage (/terms, /privacy and /accessibility),
                       InfoPage and InfoRoutePage (/security, /pricing, /examples,
                       /compare, /about, /self-host and /faq, their words in
                       infoPages.tsx, the FAQ in faqs.tsx, which Docs shows too),
                       publicPages.tsx (which page a public route draws, shared
                       by PublicSite and App),
                       SiteHeader, SiteFooter, MobileNav, Logo,
                       AccountDialog, UserAvatar, NotFoundPage,
                       OcrDialog (the review the image viewer opens: the text
                       OCR read, its detected layout drawn over the source,
                       and Build .repx with no model),
                       SettingsDialog (Settings as ChatGPT's: General, AI,
                       Gemini key, Memory and Learning, a change taking effect
                       as it is made), in the frame SectionedDialog draws for
                       it and for AccountDialog, whose sections are
                       ProviderSettings (which AI answers:
                       Automatic, which is Gemini, a local AI or OpenRouter's
                       free models; Forma Offline went into Automatic on
                       2026-11-05),
                       MemorySettings (what Forma remembers, to switch off,
                       change or forget), LearningSettings (what Forma may
                       learn from use, its two switches and the button that
                       deletes what was kept), ErrorReportSettings (General's
                       "Send error reports", off until turned on) and
                       UsageSettings (the day's requests),
                       ConversationPanel (the thread down the left: every
                       request with its ask pinned, the box at its foot,
                       search and download), ChatThread
                       (the transcript inside it, lifted out of App.tsx
                       once chatSession.ts held its rules — Forma's working
                       dots pass through as children, because that is generation
                       state and not conversation), Composer (staged
                       attachments, the notice lines and the box you type in;
                       one composer does both jobs, and which one is App.tsx's
                       decision, not this component's), BoxMenus (the box's
                       "/" Tools menu), PlanCard (the plan a heavy job is
                       told, which starts at once), and Markdown — which
                       is its own module so react-markdown can be lazy-loaded.
                       The workspace's panes and menus are here too, each
                       loaded on demand: ReportPreview, ReportMockup,
                       RepxViewer, DataBinding with DatabasePanel (the Data
                       tab's SQL Server database), ConsentQuestion (what the
                       Data tab and Live rows ask before the layout goes to
                       the AI or a stored procedure runs), the selection toolbar
                       (SelectionToolbar), the command menu (CommandMenu),
                       the shortcuts list (ShortcutsDialog), the right-click
                       menu (ControlMenu), the zoom field (ZoomField), the
                       corner's help (HelpMenu), the Export
                       panel (ExportPanel), the project menu at the top left
                       (ProjectMenu), the pin beside it (PinProject), the
                       empty workspace's home
                       (HomeStart), the Share dialog (ShareDialog) and the
                       page a shared link opens (SharedReportPage), the
                       Preview's rail (PreviewRail: Select, Mark an area and
                       Compare with the original), the side panels
                       (ProjectsPanel, with a delete's Undo; BatchPanel,
                       RevisionsPanel, LibraryPanel),
                       Open in designer's dialog (OpenInDesigner), with
                       overlays.css holding those menus' styles.
                       Around both the site and the workspace: ErrorBoundary
                       (one per area, so a fault in one leaves the rest
                       working), OfflineBanner (the network lost and back),
                       UpdateBanner (a newer Forma has taken over the
                       tab) and OtherHostNotice (on another of the addresses
                       that serve Forma, which is its own and why it
                       matters). docsCorpus draws the Docs page's articles as
                       text for the chat.
                       The files that are not components are the shared
                       hooks (useFocusTrap; useLayer, which puts a menu or
                       dialog on the Escape stack; useMenuKeys, a menu's
                       arrow keys and focus return; useFitScale, the zoom
                       that fits a page to its pane; useTheme, the theme the
                       site and the workspace share; useLinkNavigation, an
                       in-app link as a client-side navigation), overlays.css,
                       dialogs.css (the three dialogs' shared look), ocr.css,
                       markdown.css and the tests:
                       legalDisclosure, which reads ContactPage and
                       index.html off disk, and the component render tests,
                       the only ones outside lib/, services/, server/ and
                       mcp/.
                       AccountDialog's mocks Firebase and covers the
                       surface — which control is enabled when, and what it
                       says when it fails; what a deletion actually removes is
                       proved separately in tests/accountDeletion.test.ts,
                       against the emulator
    landing/           figures used by the marketing pages: HeroScanner,
                       SheetRuler, StepFigures, VaultFigure,
                       AnnouncementDock, sections, icons
  lib/                 the pure helpers, nearly all under test. reportTypes
                       holds the report shape — it lives here rather than in
                       services/ so nothing in this layer has to import upward.
                       repx, sourceRect, reportGeometry (every unit conversion
                       in the pipeline, and the only place one may be written),
                       repxMargins (moves a margin the model drew as whitespace
                       into the report's own Margins and margin bands),
                       reportBands (the band skeleton the prompt asks for — a
                       real ReportHeader / PageHeader / one-row Detail /
                       ReportFooter / PageFooter; the old single page-sized
                       DetailBand and its VITE_FORMA_FLAT flag were removed on
                       2026-09-05, once the fallback could no longer produce a
                       comparable report),
                       promptSections (which optional blocks the mega-prompt
                       carries for a given request — a section is dropped only
                       when an uploaded .repx proves the feature is absent, so
                       an image or a bare instruction still gets all of them),
                       repxTruncation (did the model stop writing the XML
                       part-way, asked at the parse rather than at Export),
                       repxBindings (column headings to DevExpress field names
                       for expression bindings — derived in code so the guess
                       is testable, not left to the prompt),
                       repxStyles (hoists an appearance shared by three or
                       more controls onto a <StyleSheet>, so a migrated
                       report can be restyled in one place -- a control's
                       Borders is a style's Sides, which is the kind of
                       thing only a measurement finds),
                       repxSummaries (a total with no running scope prints
                       blank in DevExpress; scopes the ones whose band
                       decides it, and finds the rest for the audit),
                       repxGroups (nested groups nest by Level, not by file
                       order; numbers the ones written without it from the
                       top, so they do not print inside out),
                       repxCrossTabs (a cross-tab written as its fields alone
                       throws when DevExpress prints it; writes the layout
                       DevExpress generates from those fields),
                       repxDpi (DevExpress reads every band and control at
                       its own Dpi, 100 when absent; writes the report's on
                       each, so millimetre reports print at their size),
                       repxPaper (DevExpress prints on PaperKind's paper,
                       Letter when absent; names the paper the written size
                       is, so A4 and landscape reports print on it),
                       repxAudit (asks what is still wrong with the finished
                       report after every repair has run — errors mean content
                       will be lost, warnings mean it opens and is a worse
                       report than it should be),
                       repairChain (every repair a generated report goes
                       through, in one function and in its load-bearing
                       order, for the AI's answer and Forma's own drafts
                       alike; since 2026-11-24 also Visual Studio's
                       working-file mark, neutralised in a .repx),
                       vsReport (a .NET solution's report files told apart
                       by name: .repx and .vsrepx read, a C# or VB report
                       refused with how to save a .repx, and the names a
                       report class's Designer file looks up),
                       repxBlobs (pictures, rich text and embedded
                       data set aside while a report goes to the AI and put
                       back after, byte for byte),
                       repxCalculatedFields (a group on a field nothing has,
                       made into the calculated field its header prints),
                       pageRows, printCheck, totalsCheck and formatFromText
                       (the report printed with the records the page shows
                       before it is answered: extra pages, clipped text,
                       blank cells and collapsed groups found; a total checked
                       against the figure the page prints; a value's format
                       kept only when it prints the page's text back exactly),
                       repxAccessibility (the contrast, text-size and
                       alternative-text checks DevExpress's own designer runs on
                       every edit, measured from its analyzer's output and
                       appended to the audit as one warning per check),
                       reportPreview (reads the exported REPX back and lays it
                       out across real pages — Detail once per record,
                       PageHeader on every sheet — which is what the Preview
                       pane and the PDF export are drawn from),
                       pictureBox (an XRPictureBox's image and where it
                       prints, by Sizing, ImageAlignment and its own DPI, as
                       DevExpress 20.1 printed each mode),
                       netFormat (.NET composite, date and number formatting,
                       so a page number or a value previews as DevExpress
                       prints it),
                       netDecimal (.NET's decimal, so 8 x 0.5 previews as 4.0
                       and a sum of prices is exact, as DevExpress prints them),
                       criteria (DevExpress's expression language, evaluated
                       with .NET's types over the Preview's test data),
                       reportData (test rows typed by column, calculated
                       fields, parameter defaults, their print order and
                       groups, and which records each printed band's totals
                       and fields read),
                       csvExport (the report as CSV, laid out on one
                       continuous page the way DevExpress exports it --
                       byte for byte, on thirteen measured reports),
                       xlsxExport (the report as an Excel workbook: the
                       layout as a grid of merged cells, numbers and dates
                       kept as values, format strings converted -- cell for
                       cell the same as DevExpress's own workbooks),
                       pdfWriter (Forma's own PDF, written beside the
                       browser's print path so that it can carry the
                       report's bookmarks as an outline -- the outline the
                       same as DevExpress's, entry for entry),
                       draftPdf (a report drawn as a draft PDF with no
                       browser, laid out by the Preview's engine with no
                       data, in the standard fonts: what the command line's
                       pdf and the MCP server's repx_pdf write),
                       pdfCrypto (that PDF encrypted under the report's own
                       passwords, AES-128, RC4 or AES-256 as DevExpress
                       encrypts its export, opened by pdf.js to check),
                       pdfA, pdfFonts and trueType (that PDF as PDF/A when
                       the report asks: the Liberation faces subset and
                       embedded as DevExpress embeds its fonts, an sRGB
                       output intent, XMP; refused with a password, as
                       DevExpress refuses it; passed by veraPDF),
                       exportItems with docxExport, rtfExport and htmlExport
                       (Word and RTF page by page as positioned frames, HTML
                       as one continuous table, each frame and cell where
                       DevExpress's own export put it), pdfFromDom and
                       exportFromDom (what those exports read off the pages
                       the Preview has drawn, loaded only when one is asked
                       for),
                       paddleOcr, paddle and paddleWorker (PaddleOCR's
                       PP-OCRv5 reading an English page in browser workers:
                       one finds the text, up to four read it),
                       ocr, ocrLayout and ocrRepx (an image or a scan read
                       in the browser, by PaddleOCR or Tesseract.js: every word with its
                       box and confidence, aligned rows as an XRTable and the
                       rest as XRLabels, low-confidence text flagged),
                       ocrRead (which engine reads a page and in which
                       language, with the engines handed in: the browser's
                       rule, which the MCP server's Node reader follows too),
                       ocrAttach (what a picture's reading becomes once it is
                       attached, its text going with the message as a PDF's
                       text layer does; the reading itself is ocr's readPage),
                       ocrScript (the language of a picture worked out from its
                       reading: Arabic, Hindi, Urdu, French, German or Spanish
                       beside English, and when to try handwriting),
                       autoConfig (the DevExpress version, unit, paper, right to
                       left and stored procedure, worked out from what a request
                       brings instead of chosen in Settings),
                       textMeasure (how many lines a text breaks into and how
                       tall that prints, so the Preview grows controls and
                       breaks pages where DevExpress does),
                       revisions (the report's history, and a
                       structural diff by control name — added, removed,
                       moved, resized, retyped — because the model rewrites
                       whitespace freely and a line diff of two REPX files is
                       almost entirely noise),
                       revisionStore (that history on its way to Firestore and
                       back — one document per version in a subcollection,
                       because ten snapshots inline would break the report's
                       size budget several times over; signed out it stays in
                       memory, because localStorage is one shared quota across
                       every project),
                       mockupRows (which detail tables repeat a heading row an
                       earlier band already drew, so the Mockup draws it once —
                       a rendering rule rather than a data fix, because the
                       row's presence is what the record count is derived from),
                       workspaceView (which pane the bench shows, held in two
                       pieces of state — extracted from App.tsx so the pair
                       can be round-trip tested, because a plate present in
                       the derivation and not the setter highlights its
                       button and never opens its pane),
                       chatSession (the review column's transcript as data:
                       whether a turn is conversation or work, the history
                       the model is actually sent, and the two rewrites a
                       retry performs — generic over the report and metadata
                       types so nothing here imports upward),
                       attachmentBudget (how many files are staged and how
                       many more fit — counted as FILES, which is what an
                       eight-page PDF spending sixteen of twelve slots was
                       about),
                       batchQueue (the state of a folder of source documents
                       being turned into a report each — pending, running,
                       done, failed — and the audit verdict per row, because
                       the point of running forty files is knowing which of
                       the forty are worth opening),
                       folderDrop (a dropped or chosen folder as its files,
                       read to the end past the browser's batches of 100),
                       zip (a store-only ZIP writer, ~150 lines against a
                       ~30 kB dependency, so a batch comes back as one archive
                       instead of forty download prompts),
                       fidelity (the arithmetic of the fidelity benchmark:
                       reads bands, controls, surviving phrases, font sizes,
                       margins and the audit out of a generation and compares
                       them with a case's expectations; the runner that spends
                       quota is scripts/fidelity/run.ts),
                       reportSkeleton and formaModel (Forma's own model: a
                       report reduced to its structure with every word taken
                       out, the house style and kinds of report learned from
                       a set of skeletons, and the check that a model holds
                       no word outside its vocabulary),
                       skeletonText (a skeleton as the compact text the vision
                       model learns to write, read back tolerantly from its
                       answer, scored against the right one, and the check
                       that no word but a public font's leaves the machine),
                       boxText (the boxes design: the vision model given the
                       text read on a page as numbered boxes, and asked only
                       for its bands and each box's band and role),
                       boxReader (Forma's box reader: two small networks,
                       learned on the CPU, that put each text OCR read in its
                       band and give it its role, decoded in print order and
                       made a skeleton at the places OCR read), readerPairs
                       (the box reader learning from use: a page sent kept as
                       numbers alone, labelled by the report kept from it,
                       checked on the owner's side and made the rows
                       scripts/model/boxes.ts --pairs trains on),
                       skeletonRepx (the report a skeleton describes, its
                       words from what OCR read in each box, its values bound
                       to fields named after their column's caption),
                       offlineGenerator (a report designed by that model with
                       no AI service: the words read for kind, columns,
                       grouping and totals, the pattern chosen, the house
                       style applied, a .repx the audit passes),
                       aiProvider (which AI answers -- Automatic, which is Gemini,
                       a local AI or OpenRouter -- and when one is ready, which is
                       what opens the workspace; the
                       OpenRouter key kept like the Gemini key; Forma's vision
                       model and a page reader as helpers beside any of them),
                       fallbackChain (on a limit, the next AI the user set up
                       answers and the reply says so; never away from a local
                       AI), aiLimit (which limit an AI met, the minute's or
                       the day's, and when it lifts, read off the error
                       itself; since the CLI and Forma Designer work's
                       wave 3, for Node alone: the MCP server's and the
                       command line's work, and the parks they keep; no
                       browser chunk loads it), localModels (the Ollama pair
                       suggested for the computer's memory, and the page
                       reader's text and the question it is asked),
                       reportFacts (the open report's
                       fields, totals, groups and bands counted from the file:
                       a plain question answered with no AI, the facts told to
                       the AI, a field the data lacks refused), docsKnowledge
                       (the Docs articles a question about Forma is given),
                       jobPlan (the plan a heavy message gets first),
                       batchCheckpoint (a batch kept in the browser to carry
                       on after a limit or a reload), repxTranslate (a report's
                       typed texts collected for translation and put back, the
                       layout untouched), previewRows (the rows the Preview
                       prints sent with a question about the data, after the
                       consent asked in the thread), learning (what Forma may
                       learn from each use: structure by default, whole
                       reports on an opt-in switch, kept on the device and
                       under the account), learningPipeline (the owner's
                       side of it, the parts that can be tested: the pull,
                       the gate a new model passes before it ships, the
                       weekly run), inputModality (pointer or keyboard
                       on the root, so a click shows no focus ring), chatJudge (the twenty
                       chat requests the benchmark scores, the checks code makes
                       and the judge's rubric),
                       formaTeam (one request with every part in its role:
                       Forma's draft of the page and the house style told to
                       the AI as hints, and Forma's own draft standing in when
                       the AI fails; the reply is the result and does not say
                       which parts took part),
                       memory (what the user asked Forma to remember and the
                       style of the reports they keep, never their words,
                       applied to the next report),
                       expressions (the DevExpress expression reference the
                       model is shown for Prompt-to-Expression, and the check
                       a generated expression is held to -- balance, not SQL,
                       and no field the data lacks),
                       promptToReport (the pure half of Prompt-to-Report:
                       the brief a description run
                       opens the prompt with, the follow-up answers and the
                       repair decision; the wizard is the chat box, whose
                       questions are a form in the thread, and the
                       clarification call is in geminiService),
                       repxLayout (controls past the page or their band and
                       bands taller than the page, the other half of the
                       analyzer's layout group, appended to the audit),
                       repxOverlaps (overlapping sibling controls found for
                       the audit and moved apart after a description run --
                       DevExpress's FixLayoutErrors -- through repxEdit so
                       every other byte survives),
                       runawayOutput (is the stream's tail a short fragment
                       repeated to fill 512 characters -- a model stuck on a
                       number, which the benchmark found running four minutes
                       to the output ceiling before anything noticed; the
                       stream reader cuts it off and the request is retried),
                       repxParameters (the parameters a report asks for before
                       it prints, and the lift that makes a typed one work —
                       DevExpress silently ignores an inline Type and loads a
                       String, so the real form is a #Ref pointer into an
                       ObjectStorage block, written here rather than asked of
                       the model),
                       repxEdit (move, resize and retype one control by
                       splicing its opening tag — the direct manipulation the
                       Preview pane offers, written into the REPX itself so
                       every other byte the model wrote survives; its XML
                       escaping is xmlEscape, a module of its own so the
                       Preview engine stays out of the entry chunk),
                       plainKind (a part of a report and a band named in the
                       words a person uses, for every edit that says what it
                       did),
                       dataSource (reads the fields out of whatever the user
                       pastes — a JSON row, a CSV export, a CREATE TABLE or a
                       list of names — and suggests which column each belongs
                       to, so binding uses the data's own field names instead
                       of names guessed from the column headings),
                       userInstructions (an empty composer means "no request",
                       not an invented one — the two cases are different
                       prompts rather than one with a placeholder in it),
                       repxItems (ItemN is a position inside its own collection
                       and restarts at Item1 in each — a document-wide sequence
                       makes DevExpress read every collection as empty and drop
                       the tables silently),
                       repxRefs (makes the model's Ref values unique — a repeat
                       makes DevExpress alias two elements onto one and drop
                       the second's content, with no error anywhere),
                       repxRtl (the Settings checkbox's right to left, written
                       on the report root however the report was made),
                       repxGroupField (the field a group breaks on, chosen
                       above the Preview's paper, its heading following),
                       repxBindingPlan (finds the header and detail rows, proves
                       they describe the same columns, and binds the detail row
                       to one field each — declining rather than guess when the
                       two rows do not correspond),
                       repxChunks (splits a report into the bands and controls
                       an example is made of, replacing every value with a
                       placeholder on the way — a model shown an example copies
                       it, and a kept Ref makes the loader discard content),
                       embedStore (what the report library holds, what still
                       needs embedding, and what is safe to search — identity is
                       the content, so re-importing a file costs no quota and an
                       edited fragment never keeps the old text's vector),
                       vectorSearch (cosine similarity and top-k over a few
                       hundred vectors, by brute force: at this size an index
                       costs more bundle and CSP than the scan it replaces),
                       libraryDb (the library in IndexedDB — chosen over
                       localStorage because this app has already exhausted that
                       quota once, and because IndexedDB stores a Float32Array
                       natively at 4 bytes a dimension instead of ~13 characters
                       as JSON),
                       houseStyle (what a retrieval turns into: the queries a
                       draft asks, and the fenced block of examples appended to a
                       refine — formatting to copy, values never, and nothing
                       inside treated as an instruction. These five back the
                       report library in docs/proposals/rag.md, alongside
                       services/library.ts, components/LibraryPanel.tsx and
                       the rail's sixth panel in App.tsx),
                       attachments, sidebar (the workspace sidebar
                       opening and closing as Gemini's and ChatGPT's do: the
                       phone breakpoint, Ctrl+B, the toggle's name),
                       seo (each page's title, description, preview, canonical
                       address and robots, and the sitemap, robots.txt,
                       security.txt and llms.txt), assetPaths (where the
                       OCR engine, the PDF/A fonts
                       and the models are served, in folders named for
                       their contents), staleChunks (a tab open across a
                       deploy reloads once for the new build), releases
                       (the release notes behind /changelog,
                       its Atom feed and What's new), announcements,
                       replyChanges (the chat's changes kept in the tab, so
                       a reply's Undo and Redo outlive a reload), chatTurn
                       (what the chat box keeps as a memory, sends straight
                       to a design, or reads as an answer), composerStore
                       (an unsent draft per project, and the queue, kept in
                       the tab over a reload), boxTools (what the box's "/"
                       Tools menu offers, each a sentence to finish and
                       send), repxIntake (what a dropped or picked file
                       brings in, loaded only when one arrives, drawn on the
                       canvases it is handed), browserIntake (the browser's:
                       OffscreenCanvas and the DOM, pdf.js through pdf), buildInfo (which build runs,
                       for Settings and a problem report), problemReport (a
                       GitHub issue prefilled when an area fails),
                       keyRedact (the one key scrubber the error reports,
                       the problem report and the MCP server share: both
                       Gemini key forms and OpenRouter's, for the reports
                       other sk- keys and a bearer token too, and the values
                       a process was given),
                       errorSink (where an error caught on the page goes:
                       nowhere unless error reports are on; a few lines the
                       error boundaries import) and errorReport (the opt-in
                       error reports: the message scrubbed and cut to 200
                       characters, noise left out, each sent once a page,
                       and the switch kept per account in this browser),
                       projectExport (every saved project in one .zip),
                       downloadEverything (Settings' Download everything,
                       loaded on its click) and deviceToAccount (this
                       browser's projects added to the account), cloudPayload
                       (what a signed-in save writes), promptBox (the box's
                       words, held outside App so typing redraws only the
                       box), panelReturn (where focus goes when Escape closes
                       a side panel), withdraw (what a withdrawn message
                       takes back), exportJob (exports that queue, several
                       saved as one .zip) with csvSafety (Safe for
                       spreadsheets, apart from the CSV writer),
                       testDataRun (the Test data request, which Stop
                       reaches), visionDraft (a picture's report built from
                       the vision readings), learningLoop (the reports a
                       person keeps, their library and the example a first
                       report is shown) with corrections (what a person
                       changes the same way twice, learned as a memory),
                       sourceAgreement (whether the report prints where the
                       page printed, and fitGeometry, which moves it there),
                       storagePersist (asking the browser to keep local
                       projects), keyHandoff (the keys reaching a new
                       tab), passwordPolicy (the
                       shortest password a form accepts), authDomain
                       (sign-in on the site's own host, on since
                       2026-11-12) and appCheck (App
                       Check with reCAPTCHA Enterprise, on since 2026-11-08,
                       enforced after a week), signOut (what a sign-out
                       removes from the tab), serviceWorker (the offline
                       worker /sw.js is written from at build),
                       licenceNotice (the
                       third-party notices /licenses.txt is written
                       from at build), docsSearch (the Docs page's
                       search over each article's words, and its feedback
                       as a prefilled GitHub issue), datetime,
                       modelCatalog, reportConfigStore, designerBridge,
                       geminiClient (loads the generation service on demand, so
                       its 19.6 kB prompt is not on every page load) and
                       modelCache (the session's resolved model — eager, because
                       a synchronous effect clears it),
                       analysisResponse (the REPX out of the AI's answer, and
                       whether a failed one was cut off or malformed),
                       repxViews (the Mockup, the Spec and the title read off
                       the REPX, which the AI no longer writes),
                       draftText (Forma's draft of a picture as the AI
                       corrects it, one short line per control, and the
                       corrected draft read back for Forma to build),
                       readCoverage (did the report keep the captions and
                       titles the page shows; asked once more, capped, when
                       too many are missing),
                       agentEdit (the open report as the chat's model sees
                       it, the edits it asks for made in place, and what
                       changed, read off the file), editLanguage (those
                       edits by op and the words that tell a model each,
                       shared by the chat's prompt and the MCP server's
                       repx_edit), shortcuts (ChatGPT's
                       keyboard shortcuts for the chat, and Stitch's for
                       the workspace), workingTips (the tip above the box
                       while Forma works), startingPoints (the empty
                       workspace's starting points and recent projects),
                       shares (a shared report's copy, link and invitees,
                       as firestore.rules pins them), requestCount
                       (requests sent to each model today, and the
                       limits Google stated, for the chat box's model
                       picker and Settings' Usage today), modelTiers (that
                       picker's Auto, Fast and Balanced, each naming
                       its model), dataFiles (CSV, JSON,
                       Excel, Word and the rest attached in the chat,
                       read in the browser as the report's data),
                       sqlSchema + sqlSchemaScript + sqlSchemaStore (a SQL
                       Server database's layout, read from Forma's script or
                       an SSMS file with no connection, and kept on the
                       device), layoutFile (a layout read from a file, by its
                       byte order mark, a report's own source or sample rows
                       beside it, and one among a request's files made its
                       database step), sqlFixtures (test-only: the FormaSample
                       captures the layout tests share), repxSqlDataSource
                       (the SQL data source inside a .repx), sqlQuery (what
                       a report reads from it: a
                       table with its joins, a procedure, or checked custom
                       SQL), repxSqlWriter (that query written into the
                       report as DevExpress's SqlDataSource, by connection
                       name, as measured and run by DevExpress),
                       databaseAi (a shared database shown to the AI, escaped
                       and capped, the query it names held to the layout, and
                       the one step every caller builds), fieldMatch (a
                       column matched to a field by heading and value),
                       sqlPreview (the Preview over the database's sample
                       rows, typed as DevExpress prints each SQL type),
                       sqlDrift (a report's own data source read back, kept
                       through a redesign and checked against a newer layout),
                       sqlCompanion (Forma Designer on your PC reading your SQL
                       Server for the Data tab and the Preview, by connection name),
                       designerRelease (the Forma Designer download's version,
                       size, SHA-256 and release, written by its packing script),
                       layers (the stack of open menus and dialogs, so one
                       Escape closes only the topmost and keys meant for
                       one stay there), clipboard (every Copy, with a
                       fallback for plain HTTP), initials (the avatar's
                       letters),
                       geminiErrors (what the user is told when a
                       request fails), savedReport + accountData (the two
                       storage shapes and the document layout),
                       tokenUsage (what a generation cost, formatted for the
                       REPX pane -- the numbers were logged to the console
                       from the day streaming landed, which turned out not to
                       count as having them),
                       contactSubmit, generationProgress (the progress's whole
                       state machine, read by a screen reader since the progress
                       card became working dots) and attachmentParts, themeTransition
                       (the circular wipe the theme toggle opens from, and its
                       fallbacks), and the routing pair router (real
                       history/location, so not pure) + routes.
                       Since 2026-11-10 and 11: importForeign (an SSRS .rdl /
                       .rdlc or a FastReport .frx opened as a DevExpress
                       report), docxLayout and xlsxLayout (a Word or Excel
                       template's page, table and fonts as a draft the AI
                       corrects), deskew (a crooked scan or phone photo
                       straightened once at intake), reportFile (whether an
                       attachment is a report to build on or a page to design
                       from), pageReading (the Local AI page reader's text
                       beside OCR's), sourceAlign (Compare with the original:
                       the source page under the Preview's), batchRun (one
                       Batch file made as a single report is), projectStore
                       (signed-out projects in IndexedDB, one transaction per
                       change), deferredDelete (a deleted project's few seconds
                       of Undo) and inspectionGuard (what may go to DevExpress
                       on the person's own PC without a click).
                       Since 2026-11-24: generationCore (the one way a report
                       is made, which the workspace and batchRun call and the
                       MCP server's AI tools call in Node: the pages
                       read, Forma's team, the request through the free
                       chain, the fix, the translation and the stand-in,
                       with what the browser owns handed in; the MCP server
                       hands in Node's, src/mcp/nodeGeneration).
                       Plus motion tokens, and pdf + genai + firebaseClient —
                       three loaders that exist so their dependencies stay out of
                       the eager bundle, and are the only files here that are not
                       pure. firestoreOps sits beside the last of them holding
                       the OperationType enum, deliberately free of any
                       firebase/* import so referencing it cannot drag the SDK
                       back into the entry chunk
  services/            geminiService (+ tests, and modelResolution.test.ts,
                       chatRetry.test.ts, generationRetry.test.ts,
                       promptToReport.test.ts, promptToExpression.test.ts
                       and testData.test.ts beside it), firebase, keyVault
                       (+ tests; the vault's storage rules are covered by
                       tests/ as well), and the report library's two:
                       embeddings (the embedding call, on the user's own key)
                       and library (import, remove and retrieve), each + tests;
                       compatClient (local AI and OpenRouter in the shape of
                       Gemini's SDK) and formaVision (Forma's vision model
                       asked through the local endpoint), each + tests;
                       pageReader (a page reader such as glm-ocr, asked for
                       a picture's text through the same endpoint)
  server/              securityHeaders, bindHost, staticCache and appRoutes
                       (+ tests) — what server.ts sends, where it listens,
                       how long dist/ is cached for, and which paths are
                       the app's rather than a 404. Under src/ but never bundled
                       into the client; server.ts is the only importer outside
                       the tests (hostingConfig.test.ts holds firebase.json's
                       headers to them)
  mcp/                 Forma's MCP server (2026-11-24) and, since the CLI
                       and Forma Designer work's wave 4, its command line,
                       Node only like server/, run from a clone through tsx,
                       never bundled and never in dist/: run.mjs (the launcher a
                       host runs with plain node: registers tsx's loader in
                       one process, then loads the entry), stdio.ts (the
                       entry: the stdout guard first, then serveStdio serving
                       both protocol eras; it and run.mjs are outside
                       coverage, running only in a spawned process),
                       stdoutGuard (only the protocol reaches stdout; console,
                       stray writes and stdout's end go to stderr, keys taken
                       out, by their shape and, once the entry hands them
                       over, by the values the server was given),
                       formaServer (the factory: name, version,
                       instructions, the tools registered from toolList,
                       the REPX skill attached), version (Forma's version
                       from package.json, for both entries, with no SDK),
                       toolList (the tools in their order, each read-only
                       or not and needing an AI or not: a pure list, no
                       SDK, which publicClaims.test.ts holds the Docs page
                       and README to),
                       toolShape (defineTool, the one wrapper every tool goes
                       through: every hint set, object schemas, plain isError
                       results, text read from a file framed as data), caller
                       (what every caller is told, the server's host or the
                       command line: a refusal in plain words, the longest
                       string read from a file a result carries, the one
                       way a result is made safe to show, keys out and then
                       the clip, and whose voice the words are in, a path
                       quoted as JSON for a model and plainly for a person;
                       no zod, no SDK), paths
                       (which path a tool may read or write: full paths only,
                       the corrected path handed back, roots held as spelled
                       and as they really are, checked before and after links
                       are followed, no link to another computer ever
                       followed, writes that never replace a file unless
                       asked; since the CLI and Forma Designer work's wave 2
                       the command line's mode, a working folder in place of
                       roots, a relative path resolved against it, each path
                       judged by where it really is, so no link the working
                       folder holds is followed out of it whatever name it
                       was reached by, in a person's words, and what a
                       write does with a taken
                       name: beside, refuse or replace; the real platform's
                       rules, nodeSystem), roots (the folders, from FORMA_MCP_ROOTS, the
                       client's roots asked for per connection era, or
                       CLAUDE_PROJECT_DIR, else each host's recipe),
                       statusTool (forma_status, the first tool),
                       reportTools (repx_audit, repx_outline, repx_repair,
                       repx_edit and repx_pdf, the tools that need no AI:
                       the web app's audit, outline, edits, repair chain
                       and draft PDF on a .repx or .vsrepx; the three that
                       write each writing a file, and all five returning a
                       summary), reportFile (the one way they read a report,
                       a C# or VB report refused, a file that is not
                       well-formed XML refused and its stored login taken
                       out first, wherever it is stored, and write one,
                       never replacing a file unless asked and an edit never
                       into a .vsrepx whose Designer file loses a name),
                       pipeline (the tools' work, run in a worker thread:
                       the report opened, then the web app's module; and
                       the copy the command line's batch writes of a report
                       its words left as it was),
                       worker.mjs (that thread's entry: registers tsx, runs
                       pipeline; outside coverage, as run.mjs is),
                       workerPool (starts it with a memory bound and a
                       deadline, ends it on either or on a cancellation, and
                       keeps one idle), layoutCalls (since the CLI and Forma
                       Designer work's wave 4, the five report tools' steps
                       on the thread that answers, which the command line
                       makes too: the report read, the work on the pipeline,
                       the notices, the file written by the caller's rule
                       for a taken name; and convert, an SSRS or FastReport
                       report made into a .repx with no AI, in the pipeline's
                       thread, and the batch's write of a report as it
                       reads or as converted), skillResource (the REPX skill served
                       as a resource, with a preface telling a model to send
                       full paths), testFs and testClient (a file system and
                       a client in memory, and a pipeline in the test's own
                       thread, for the tests only, and outside coverage).
                       Since wave 7, Node's versions of what the generation
                       core is handed: nodeGeneration (assembles them for
                       makeReport, Forma's models from assets/model and
                       OCR's language data read as it starts and failing
                       loudly, a page OCR could not read said in the
                       result, the model probe kept in Forma's own per-user
                       folder, the mock, its translation too, and the model
                       pin, text measured on @napi-rs/canvas, each stage
                       told to the AI tools' progress; since wave 10 the
                       fidelity benchmark's parts too), nodeIntake (files drawn on
                       @napi-rs/canvas, a picture decoded only within a size
                       its header states, PDFs opened with pdf.js's legacy
                       build and stopped between pages, a File typed by its
                       extension), nodeOcr (a page read by the browser's
                       rule: PaddleOCR where vendor/paddle holds its pinned
                       models, else Tesseract from the installed language
                       data gathered into Forma's folder, nothing written to
                       the working folder), nodePaddle (PaddleOCR through
                       onnxruntime-node, the one Node reader, which
                       scripts/model/paddleOcr.ts shares) and, since the CLI
                       and Forma Designer work's wave 1, nodeFonts (the
                       metric-compatible faces registered for Arial, Times
                       New Roman, Courier New, Calibri and Cambria where the
                       machine lacks them, each with its weight and style,
                       from one face table; a canvas that measures nothing
                       refused; the families a report names that were
                       measured in a stand-in, found by measuring).
                       Since wave 8, the two tools that call an AI:
                       aiSettings (which AI they ask, from the values the
                       entry copies out of its environment: FORMA_GEMINI_KEY,
                       FORMA_PROVIDER, OpenRouter's and Local AI's, the model
                       pin, the locale and the mock switch; the web app's
                       gate, Local AI on this computer only, and the
                       refusal that names what to set; since the CLI and
                       Forma Designer work's wave 2, takeAiEnv, what every
                       entry takes out of its environment and deletes from
                       it, one list for the server's and the command line's,
                       and the words in each one's voice), aiTools
                       (generate_report and revise_report as the server
                       offers them: their schemas, the folders asked for,
                       the progress, the summary and the line in the log
                       naming the file written), reportCalls (their steps on
                       the thread that answers, since the CLI and Forma
                       Designer work's wave 2 for the server and the command
                       line alike: the gate, the call's words and paths
                       judged through the caller's policy, the files read
                       at the call's turn, a failure's keys out before its
                       cut, the report written by the policy's rule for a
                       taken name, the result as plain data, unscrubbed
                       until its caller shows it through caller's; no SDK,
                       no zod),
                       genJobs (their work: makeReport through
                       nodeGeneration, and revise_report as the chat's own
                       path, stateless; the mock and a test's stand-ins
                       handed in), genWorker.mjs (that work's thread:
                       registers tsx, runs genJobs; outside coverage, as
                       worker.mjs is) and generator (starts it with a
                       generation's memory bound and deadline, ends it on a
                       cancellation, a queue of one for the whole process,
                       and progress that only goes up; since the CLI and
                       Forma Designer work's wave 3, a thread of its own for
                       each job when asked, the command line's batch), and
                       since that wave modelParks (the models a limit parked,
                       kept in a file in Forma's folder by the key's tag as
                       each limit happens, so a thread started afresh asks
                       none of them again; and the soonest the key can be
                       asked again when every model it can call is parked,
                       which the command line's batch reads before each
                       file; Forma's per-user folder named here too).
                       Since the CLI and Forma Designer work's wave 4, the
                       command line, a second entry: cli.mjs (the launcher a
                       person or a CI step runs with plain node, in run.mjs's
                       form, the clone's tsconfig named), cliEntry.ts (the
                       entry, in stdio.ts's order: the stdout guard with the
                       command line's options, the AI's environment taken
                       and its keys deleted, then main; it and cli.mjs are
                       outside coverage, running only in a spawned process),
                       commandLine (main(argv, io): the arguments, every
                       command, the AI gate for generate and revise, the
                       results on stdout or as JSON Lines, the exit codes, a
                       stop on Ctrl+C, and the batch's loop: one file at a
                       time, the gate only when a route asks the AI, a
                       minute's limit waited out, the day's stopping the
                       rest, each file it leaves listed as not started),
                       cliCommands (the commands in their order, each
                       needing an AI, not, or by route, and the launcher's
                       path: a pure list, no import) and folderBatch (the
                       batch's plan, decided before a file is read: the
                       folder walked level by level with no link followed,
                       each file's route by its kind, every name it writes,
                       and what a limit does).
                       Since that work's wave 5, nodeDatabase (a database's
                       layout in a work thread: read by lib/layoutFile with
                       the sample rows the person passed, the query a caller
                       pinned held to it, a procedure it does not describe
                       refused; the binding read back from the report
                       written; a report bound with no AI; an SSRS report's
                       own DataSet read and the converted report bound to
                       it), which genJobs and pipeline run, and layoutCalls
                       reads a layout and binds a report with on the
                       pipeline (the command line's --database, bind,
                       convert --database and sql-script).
                       Since that work's wave 6, designerVerbs (the one
                       program src/mcp starts: Forma Designer's command-line
                       verbs, sql-list, sql-schema and sql-sample, coming
                       with Forma Designer 1.2.0; where it is, worked out
                       from the values the entry read, the per-user install
                       or FORMA_DESIGNER; the environment it gets, Windows'
                       own variables; the exe's own version read from the
                       file before any start; the sentinel on every call,
                       its envelope trusted before its exit code; started
                       asynchronously, its output capped, killed at a
                       deadline or a stop, the call ended soon after it
                       exits whoever holds its pipes; SQL Server's quoted
                       words never repeated), which the command line's
                       connections and --connection run.
                       Tests beside them: stdoutGuard, toolShape, paths,
                       roots, formaServer and reportTools each have one
                       (formaServer's drives forma_status in both eras and
                       holds the list to toolList; reportTools' drives the
                       five report tools on files in a scratch folder, in
                       the test's thread and in the worker, and the
                       worker's bounds), and so do nodeGeneration,
                       nodeIntake, nodeOcr, nodePaddle and nodeFonts; nodeMakeReport
                       runs makeReport end to end in Node on a picture and
                       two PDFs drawn in the test, the AI stood in;
                       aiSettings, generator and aiTools have one each
                       (aiTools' drives both AI tools in both eras, the AI
                       stood in: the refusal, the queue, progress, a
                       cancellation, the switch note, no key in any result),
                       and so does reportCalls (the same calls as the
                       command line makes them: a working folder, a
                       person's words, a taken name refused), and modelParks
                       (the file, and a park one thread records honoured by
                       the next, in fresh modules and in real worker
                       threads, the network stubbed); cliVoice.test.ts
                       holds what the command line is told to none of the
                       server's words, read from the source of every module
                       it runs and heard from its calls;
                       stdio.test.ts spawns the exact command a host runs;
                       commandLine.test.ts calls the command line in its own
                       thread, every command and exit code, convert and the
                       batch on a folder of every kind it meets, and spawns
                       the exact command a person runs, from outside the
                       clone; folderBatch.test.ts holds the batch's walk (on
                       both platforms' path rules, and on the real disk with
                       a junction or link out of the folder), its routes,
                       names and limit rule; nodeDatabase.test.ts holds the
                       database's functions, and cliDatabase.test.ts the
                       command line's --database, --samples, bind, convert
                       --database, sql-script and a batch over the
                       FormaSample captures written to files, in process and
                       spawned from outside the clone; designerVerbs.test.ts
                       holds the verbs' helper and the command line's
                       connections and --connection against a Node stand-in
                       for the exe written at run time, so it runs on Linux
                       too;
                       boundaries.test.ts holds src/mcp and src/server
                       apart from the browser code
  fonts/               the three self-hosted typefaces as variable woff2, their
                       SIL OFL licences, and a README — referenced from
                       index.css so Vite fingerprints them; see the typefaces
                       block there for why they are not in public/
tests/                 Firestore rules tests (emulator)
tools/RepxDesigner/    optional Windows companion that opens a generated .repx
                       in the real DevExpress designer — C# and MSBuild, with
                       its own README; nothing in the web app depends on it;
                       downloaded as Forma Designer (scripts/package-designer.ts);
                       Verbs.cs (since 2026-11-25, coming with 1.2.0) its
                       command-line verbs, sql-list, sql-schema and
                       sql-sample, which print one line of JSON and exit,
                       which Forma's command line starts (src/mcp/designerVerbs.ts)
tools/RepxProbe/       console tool that asks DevExpress what a .repx really
                       contains — `emit` prints what the serializer writes,
                       `inspect` reports what the loader sees and fails when a
                       file silently lost content; its own README too
public/                static assets served at / — the logo pair (PNG + WebP,
                       light and dark), favicon.png and favicon.ico, icons/
                       (the installed app's icons, maskable among them),
                       manifest.webmanifest, security.txt, and the
                       pre-rendered og-card.png
assets/source/         og-card.html, the page public/og-card.png is rendered
                       from (not deployed). The full-resolution logo masters
                       lived here until 2026-08-29; they are gitignored now —
                       2.8 MB backing 256px files already in public/
assets/model/          formaModel.json, Forma's own model, learned by
                       scripts/model/train.ts from the structure of the
                       owner's reports (never their words), and
                       boxReader.json, the box reader's two small networks;
                       both served at /model/
assets/pdf-fonts/      the twelve Liberation 2.1.5 faces a PDF/A file embeds
                       and their SIL OFL licence, unmodified; served at
                       /pdf-fonts/ and copied into dist/ at build (README
                       there: provenance and checksums); in Node they also
                       measure Arial, Times New Roman and Courier New where
                       the machine lacks them (src/mcp/nodeFonts.ts)
assets/metric-fonts/   Carlito 1.104 (OFL) and Caladea 1.002 (Apache-2.0),
                       unmodified with their licences, which measure Calibri
                       and Cambria in Node where the machine lacks them;
                       never served or embedded (README there: provenance,
                       checksums, and how close they measure)
docs/                  PRD.md, project-structure.md (this tree),
                       project-hierarchy.md (every place a change has to
                       reach, written from scripts/check-hierarchy.mjs),
                       deploying.md (hosting, deploys, releases, rolling back
                       and the owner's settings), design/DESIGN.md, notes/ (architecture + incident
                       history), proposals/ (designs still being proven, and
                       the measured DevExpress parity table), skills/devexpress-repx
                       (what Forma measured about the REPX format, written for
                       a person or a coding assistant editing a .repx by hand;
                       Forma's command line, src/mcp/cli.mjs, runs its audit
                       and repair, and the MCP server serves it as a resource) and audit/README.md (a one-line index of the
                       2026-08-27 findings, whose IDs are cited throughout the
                       code — a dated record; read notes/ for what is current)
  media/               images the documentation links to, and the only place a
                       committed screenshot belongs; nothing here is read by the
                       build. Has its own README with the capture rules
.github/               workflows (checks.yml, which runs the seven checks plus
                       `npm ci`, `node --check` on two scripts and
                       check-dist.mjs, the first job on Node 24.15.0 and the
                       newest 24 and the rules job on 24;
                       codeql.yml; live.yml, which checks the live site every
                       three hours), three issue templates, a PR template,
                       dependabot.yml, CODEOWNERS, SUPPORT.md and the main
                       branch's ruleset (rulesets/main.json)
.githooks/             opt-in pre-commit guard; enable with
                       `git config core.hooksPath .githooks`; it also runs
                       the project hierarchy check on every commit
.claude/               settings.json — the committed permission allowlist, so
                       the documented checks run without prompting — and
                       skills/run-forma (how a session launches and drives
                       the app, with its dependency-free driver drive.mjs)
scripts/               dev.mjs (npm run dev:log) and build-server.mjs; the
                       encoding, doc-pointer and bundle-size checks that three
                       of the seven checks call, and check-dist.mjs (the built
                       pages held to the policy that serves them, run by CI
                       and by deploy.mjs); check-hierarchy.mjs (the project
                       hierarchy, and what a staged change must also reach,
                       run by the pre-commit hook); the owner's deploy.mjs (release-notes.ts writes
                       each release's notes, designer-asset.mjs checks the
                       Forma Designer zip on its release), smoke.mjs,
                       backup.mjs and github-setup.mjs (the repository's
                       settings, labels, milestones and roadmap); admin/
                       (the owner's, on the owner's own PC: google.mjs, how
                       those scripts reach Firebase with no dependency;
                       orphans.mjs, data an account left behind; stats.mjs,
                       usage as counts only; pull-errors.ts, the error reports
                       people chose to send, saved and then deleted from
                       Firestore); make-icons.mjs,
                       fetch-handwriting.mjs and fetch-paddle.mjs (the
                       picture reader's models, SHA-256 pinned);
                       package-designer.ts and companion-scripts.ts (Forma
                       Designer's zip, and the layout script and, since
                       2026-11-25, the sample SQL it runs, written into
                       its SqlScripts.cs);
                       repx.ts (since the CLI and Forma Designer work's wave
                       4 a forwarder to Forma's command line's entry,
                       src/mcp/cliEntry.ts, so `npx tsx scripts/repx.ts
                       audit|repair|pdf <file>` keeps working from the clone,
                       a second argument to repair and pdf handed on as
                       --out; the command line is src/mcp/cli.mjs);
                       fidelity/, the benchmark's runner, which makes each
                       report through the generation core with
                       src/mcp/nodeGeneration's parts, formaDraft.ts (Forma's
                       own draft with no AI asked, which the runner and
                       src/mcp/nodeMakeReport.test.ts both call), and its
                       cases; and
                       model/, which learns Forma's own model and packs and
                       draws the vision model's training set (render.py needs
                       Python 3 and Pillow), with kaggle/train_vision.py, the
                       fine-tune that runs on Kaggle's free GPU,
                       evaluate.ts, which scores its answers, and the
                       learning loop that runs on the owner's PC:
                       pull-learning.ts (which deletes from Firestore what it
                       has saved once it is 90 days old), gate.ts (whether a
                       new model may ship) and learn-week.ts (the three in a
                       row, weekly)
server.ts              Express server: the development server (Vite in
                       middleware mode) and the self-hosted `npm start`; the
                       deployed site is Firebase Hosting serving dist/
                       statically, so it never runs this file
firestore.rules        the actual security boundary
firestore.indexes.json the composite indexes the owner's learning pull needs,
                       deployed with the rules
firebase.json          the rules and indexes paths, databaseId, the two
                       hosting sites (their headers restated from
                       src/server/), and the emulator port
firebase-applet-config.json
                       your Firebase web config — see the Firebase section
                       above, including the databaseId that must match
                       firebase.json's
```
