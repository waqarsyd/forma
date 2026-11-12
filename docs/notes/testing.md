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

`npm test` runs Vitest over every `src/**/*.test.ts[x]` file (the total is the line under
the inventory below) — under the `node` environment
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
been extracted is a small fraction of them, and many components still have no render
test. `ReportPreview`'s portal, `ResizeObserver` and `window.print` are browser behaviour
rather than logic, so its jsdom tests cover the editing and exports around them and the
`run-forma` skill drives the rest.
Where the documentation calls something an invariant and it is not in one of these
files, you check it by hand or it ships broken.

## The inventory

Paths are relative to `src/`. Every row's count was taken from `npx vitest run
--reporter=json` on 2026-11-11, on `0cec241` with every file passing, and a row was added
for each test file the full audit's waves created.

| File | Tests | |
|---|---:|---|
| `components/AccountDialog` | 25 | jsdom; since 2026-11-07 shaped as Settings, so each case opens its section first, and two more: the sections a password account has, opened at Profile, and a line about what happened kept with its section |
| `components/BatchPanel` | 21 | since 2026-11-10 (batch AG) a pause on the day's allowance in its own words and a stop on a rejected key, and the files a plan in the chat sent queued and started, then cleared; jsdom; since 2026-11-04 also a chosen folder queued by path, a drop on the panel, and two at a time with a quota failure stopping both workers |
| `components/ChatThread` | 46 | since 2026-11-07 (batch J) Copy saying so when there is no clipboard; since 2026-11-07 (batch I) no live region of its own, and the keyboard following Forma's questions from one to the next; since 2026-11-07 (batch H) Forma's replies only, the person's message, its pictures and its failure being the card's pill's, a search marked with nothing hidden, and a code block's Copy; since 2026-11-07 (batch F) a reply's offered export and designer as buttons, run only when pressed; since 2026-11-07 a Redo on a reply whose change was taken back, Undone dropped once it is made again, and no Try again on a reply Forma wrote of its own accord; since 2026-11-06 editing, withdrawing and the versions of a sent message moved to `RequestCard`, whose pill owns them, with their seven tests; since 2026-11-05 the questions one at a time, with a summary; since 2026-11-05 the time and the cost beside the icons; since 2026-11-05 the versions of a message, and editing one sent with pictures; since 2026-11-05 the way back to the latest message; since 2026-11-05 Redesign / Not now; since 2026-11-05 Undo on a change still the latest; since 2026-11-05 Copy, the rating and Try again under a reply; since 2026-11-05 a reply as Markdown, a link opening in a new tab, the person's words as typed, and a reply plain under a search; jsdom; since 2026-11-05 an empty conversation showing nothing (from 2026-11-01 until then, the predefined descriptions it started from); since 2026-11-01 a description's questions asked as a form holding their suggestions; since 2026-11-04 the working dots named for a screen reader before the first token, and a reply drawn as its words with no buttons; and editing and withdrawing a sent message, and searching the transcript |
| `components/Composer` | 63 | since 2026-11-08 "+" opening the picker with no menu between, the "/" Tools menu (opened by its button and by "/" in an empty box, a tool filling the box under what is typed, sentences only with no check, test data or Export, the tools held until a report is open) and the house style switch saying which way it is; since 2026-11-07 (batch I) listening that ends on send and on typing and says where the sound goes, the caret kept after Stop and Queue, a file's notice tied to the box, and the model another AI answers with; since 2026-11-07 (batch H) "Reading the file…" while a file is read, and the files a queued message carries; since 2026-11-07 (batch G) a paused queue with Resume, and Escape stopping Forma only while it works; since 2026-11-06 an empty box sending nothing, by the button or Enter, Stop beside Queue while words are typed, and the error line's close; since 2026-11-06 the up arrow bringing back earlier messages; since 2026-11-05 the queue, as Stitch's tray; since 2026-11-05 the model menu as Stitch's tiers; since 2026-11-05 the model picker; since 2026-11-05 a spoken message; since 2026-11-05 also the Preview's selection above the box; since 2026-11-05 the send is a Stop while a reply is written too; jsdom, 6 from one loop (the no-key case left it on 2026-11-02, when a missing key stopped locking the box; since 2026-11-05 one test locks it again with no key, sends nothing and offers the key button in place of the send); a clean composer (2026-11-04): nothing under the box with or without a key, and the send a Stop while a generation runs; the one chat box (2026-11-01): no separate Describe or OCR button, an attached image shown as the file alone and sent at once, its text read after the message goes (2026-11-03; until then its reading showed on its chip and held the send), a pasted image attached |
| `components/DatabasePanel` | 20 | jsdom; the Data tab's database (2026-11-08, batches DC and DD; from Phase 2 a layout read through the companion and none answering said; from batch DG the report's own source shown, a rename fixed in one click and the report's layout adopted; from 2026-11-09, batch DE, the switch that shares it with the AI, and SQL from a sentence only when shared, held to the layout; the connection by name, several values, a lookup and its cascade handed to the writer): the layout script and kept databases with none, tables, views and procedures grouped and found by column, a table's keys, a procedure's reason and fix, the foreign key's join, the fields handed to the mapping, Bind only with a target, the options written into the query, and custom SQL taken only as one SELECT |
| `components/OpenInDesigner` | 10 | jsdom; **jsdom's user agent carries the platform the suite runs on**, "(win32)" here and "(linux)" on CI, which `onWindows` reads as not Windows, so all five first tests passed here and failed on CI for two pushes (45b42dd, f3b5d77) until each test stated a Windows agent; a sixth states Linux on purpose and gets the Windows-only step, asking nothing. Open in designer as a dialog that asks for what is missing (2026-11-09, batch WF), the companion a stubbed fetch answering as measured: nothing answering starts it and offers the download, no DevExpress offers devexpress.com's trial and says it is a separate product, a too-old version is named, a healthy one is handed the report, and Export .repx closes it from any step |
| `components/publicClaims` | 74 | cases from `it.each` tables of required and refused claims; since 2026-11-11 (the full audit's PSA, LG and PPUB) the hero scanner read too, with whitespace collapsed, the old CSP claim, the bare “Your key, never:” and the old Download all name refused, and Settings → Learning required on /faq, /security and the Docs; since 2026-11-09 (the download programme, batch WG) the download page's requirements read from the companion (.NET from the project, the oldest DevExpress from `DevExpressLocator.Oldest`, the trial address from its `TrialUrl`, the port), its file only GitHub's release, DevExpress said not to be included, and no form, address or tracking on it; since 2026-11-09 (the SQL Server programme, batch DH) the SQL Server article's numbers read from the code and a connection to your database refused; 17 from one table; since 2026-11-08 (batch SL, item 88) the numbers the pages give read from the constants: the PDF page limit on the home, Features and Docs pages, the attachment count and file size, the password length, the revisions a project keeps and the examples counted; batch SE's: no project saved only when you choose to, the footer's copyright read from LICENSE and its DevExpress notice, and the contact page's security route as SECURITY.md gives it; what the home, Features and Docs pages claim, held to the code (2026-11-08, the site audit's batches SC and SD): sixteen claims Forma no longer makes refused (SD's four: an upload as the only way to start a report, an unverified account missing nothing, the account dialog in columns, a docs fix promised for feedback nobody receives), an article on the Docs page for each part of the workspace, every section of Settings and of the account dialog named there, and the shortcuts printed from the dialog's own list; SC's twelve (a Pause, a progress bar, a page read visually, a configuration panel, no model picker, no licence, billed by Google, a key never stored, nothing to configure, a folder drop not supported, the spec as .txt), and the licence, the papers, the data formats, Batch's parallel runs, the Export panel's formats and OCR read from the code |
| `components/ConversationPanel` | 26 | the conversation as a thread in a panel (2026-11-08), as Stitch's since it changed: every request a section with its ask pinned at its top, Forma working in the newest, the box at the foot and folded with the panel, the eye that shows what a request changed and the request shown marked; the header's search (marks in asks and replies, opened from outside, Escape clears) and download, neither before there is a conversation; and the card's eighteen, moved with `RequestCard.tsx` (renamed by `git mv`): the pill, its first line until opened, the fold kept over an edit, Try again only where there is a message, the time sent, the pictures, the one status region, and the pill's edit, withdraw and versions. The log's six went with `RequestLog.tsx`. jsdom |
| `components/SelectionToolbar` | 2 | the toolbar over a selection on Preview (2026-11-05), as Stitch's: the selection named, Format from its menu, Edit text for one control only, Delete and Clear under More. jsdom |
| `components/UpdateBanner` | 6 | a newer Forma taking over the tab said with a reload (2026-11-10, the full audit): when the tab had a worker, not on a worker's first claim, nothing without a worker, and stopped when told. jsdom |
| `components/UsageSettings` | 2 | Usage today at the top of Settings (2026-11-05), as Stitch's daily credits, the General section's first row since 2026-11-07: requests by model, most first, a bar only against a limit Google stated, the time to the reset, and the empty day. jsdom |
| `components/CommandMenu` | 5 | the command menu, Ctrl+K (2026-11-06), as Stitch's: narrowed by every word typed, the arrows and Enter running the highlighted command, the empty answer and Escape; and the shortcuts list beside it, by group, with Cmd on a Mac and Ctrl on a PC. jsdom |
| `components/ExportPanel` | 5 | every way out in one panel (2026-11-06), as Stitch's Export: the .repx from its first row, each print format asked of the Preview by its own name, the designer greyed for a report with no XML, and Escape. jsdom |
| `components/ProjectMenu` | 5 | since 2026-11-08 the project's own four rows and none of the workspace's, which were the main menu's for a day; the open project's menu from its title (2026-11-06), as Stitch's: Rename in place and nothing sent for an unchanged name, a Delete that asks once and Keep, opened at Rename's field or Delete's question, Duplicate and Archive and no Download (Export has it), and what an unsaved project cannot do greyed. jsdom |
| `components/ChangelogPage` | 7 | the changelog (2026-11-07): every release drawn newest first as an article with its anchor and date, the version linked to its GitHub release, a kind filter kept in the address and cleared, a filter read from the address, the empty result with Clear filters, a link copied per entry, and the feed and GitHub offered to follow it. jsdom |
| `components/HelpMenu` | 5 | the corner's "?" (2026-11-06), as Stitch's (with Docs, the FAQ, Discussions and Privacy since 2026-11-08, and one What's new opening the changelog and the command menu beside the shortcuts the same day): the theme in force marked and the one chosen handed back, What's new opening on the newest note, the shortcuts closing the menu, help and feedback in a new tab, the line that Forma can make mistakes, and Escape. jsdom |
| `components/HomeStart` | 4 | the empty workspace as a home (2026-11-06), as Stitch's: a recent project opened and All projects, the starting point picked handed back, and no project list when there is none. jsdom |
| `components/PinProject` | 1 | the pin beside the title (2026-11-06, `RateReport` until then, whose star and thumbs it replaced): pinning and unpinning the project, saying which, and no rating, which the reply card keeps. jsdom |
| `components/ShareDialog` | 10 | sharing a report (2026-11-06), as Stitch's: sign-in asked for and nothing written when signed out, the project saved first and a restricted copy written with the people added, an existing share's access changed at once and sharing stopped, a person put back when their removal could not be written, and a typed address that is not one; since `37beb3d` (2026-11-08) an unverified account asked to verify first and the most shares an account may make, both writing nothing (recorded as 5 until 2026-11-10, when the suite's own count was set against this table). Firebase is a stand-in; the emulator suite proves the rules. jsdom |
| `components/SharedReportPage` | 4 | a shared link opened (2026-11-06): the report, its name and its download when it may be read, and otherwise a page asking a visitor to sign in or naming the account that is signed in. jsdom |
| `components/ZoomField` | 6 | the zoom's number as a field you type a size into (2026-11-06, the owner's request): 150 and 150% alike inside 10% to 400%, nothing set when nothing changed, Escape putting the number back, the arrows stepping by ten, Stitch's 100% / Fit / Selection, and a choice from the menu kept over the size typed before it, the bug the owner's Chrome found. jsdom |
| `components/useMenuKeys` | 2 | what a menu owes a keyboard (2026-11-06, the workspace audit): focus on its first item, the arrows past a disabled item and round the ends, Home and End, and focus back to the button that opened it. jsdom |
| `components/SettingsDialog` | 13 | Settings as ChatGPT's (2026-11-07, the owner's request): opened at the Gemini key while there is none and at General once there is, the sections by click and by the arrows, Home and End, a choice applied as it is made with no Save or Cancel, Add it from the AI section to the key, the key checked and cleared with a line that says so, Forget everything asking first and Cancel keeping the memory, the stored key forgotten only after asking, and Close and Escape. Firebase and the Gemini client are stand-ins. jsdom |
| `components/DataBinding` | 24 | jsdom; since 2026-11-09 (batch DE) how sure each match is, the likeliest field in one click for a column left unmatched, and a bound report's field the database lacks renamed in one click; since 2026-11-08 a pasted SQL Server layout goes to App once, its line shown and the box emptied, an ordinary sample is left to the mapping, and a label bound on its own leaves the table's mapping open |
| `components/LibraryPanel` | 25 | jsdom |
| `components/MobileNav` | 3 | jsdom; the phone menu is a modal dialog (2026-11-08, site audit item 41): focus inside, Escape closes it and gives focus back to its button once the sheet's exit animation unmounts it, sentence-case labels and the repository's link |
| `components/infoPages` | 13 | 8 from one table, one per page the site audit's batch SJ added (2026-11-08) and the download page (2026-11-09): a route, a title, a case in `viewForRoute`, a description, a sitemap entry, a prerendered file and a hosting rewrite on both sites; the list `publicPageFor` draws equal to the pages `infoPages.tsx` defines; the share limit, the six starting points and no shares listed until there are some, read from the code; and `public/security.txt` valid under RFC 9116, with the contact SECURITY.md gives and an `Expires` still to come, which fails on purpose once it passes |
| `prerender` | 101 | since 2026-11-11 (batch PPUB) per-route cases under three describes, the eager reveal and the preloads the build writes; four from one `describe.each` over every page (sixteen since the download page, 2026-11-09) `renderRoute` draws, which is the markup the build ships (2026-11-08, the site audit's batch SL, item 88): one heading, the main landmark its skip link names, real words and the footer; no two elements with one id; every link to a section on the page, to another page and the section it names there, or to a file the site serves, resolving; and every new-tab link with `noopener` and every image with an `alt`. Checked by breaking one cross-page link, which it named |
| `components/publicContrast` | 12 | 11 from one table; the public pages' colours read out of `src/index.css` and every pairing a visitor reads computed against WCAG's 4.5:1, light and dark (2026-11-08, site audit item 17), and the bright brand orange kept for what carries no words |
| `components/NotFoundPage` | 2 | jsdom; the 404 page's `noindex`, added while it is shown and taken away when it goes |
| `components/OcrDialog` | 7 | jsdom, the engine replaced; pages read one at a time, a failed page left out and said so, Stop aborting the run and the pages not read marked stopped (2026-11-06), low-confidence text listed and named or left out, a report built after the app's checks, a PDF page read at its resolution, and pages the chat box read already shown without reading them again; `reportNameFor`'s case moved to `lib/ocrRepx` on 2026-11-06 |
| `components/ReportPreview` | 53 | since 2026-11-09 (batch DF) a database's sample rows on request and a multi-value parameter asked from its list, filtering them; since 2026-11-08 Mark an area, every control the box touches selected once and the tool handed back, and Escape leaving it with nothing selected; since 2026-11-06 the arrows and Delete left alone while a menu or dialog is open, a group kept whole when one of it is pressed, and the whole selection cleared when the paper is pressed; since 2026-11-06 no export buttons where the Export panel has them, an export asked for still made; since 2026-11-05 Ctrl+Z handed to the workspace's history; since 2026-11-05 the outline of what a request changed; since 2026-11-05 an export the chat asked for, made once; jsdom; since 2026-11-04 also Shift+click selection deleted and nudged as one step, Add label, a table cell retyped, a label retyped in one placement of a repeated band, and a declined edit saying why; since 2026-11-04 also the grouping field chosen above the paper, through the undo path and only where the pane edits; inline styles computed from the file, against what DevExpress printed; a parameter value typed over test data; a link as an anchor; a cross-band box and line; turned text; the page drawn unkerned; Export CSV; a drill-down group opened and closed by its toggle; a picture box drawn as its image zoomed into its box, and a dashed box naming what it would show when it has no image (2026-11-04) |
| `components/RepxViewer` | 7 | jsdom; what the report kept of the page (2026-11-10, batch AD): the share kept read out beside the usage, each text left out named, and nothing more when it kept it all or carried no draft |
| `components/legalDisclosure` | 72 | loops over the disclosure table, the storage names and the learning numbers, so count by running it; since 2026-11-11 (the full audit's LG and LRN) every storage name in `src` read out and a policy phrase required for each, what a sign-out clears mapped to its sentence, the learning numbers and defaults held to `learning.ts`, the deletion promise kept only while `pull-learning.ts` reconciles, and `forma-projects` named; OpenRouter and dictation joined the disclosure table and the closed-set count on 2026-11-08 (the site audit's batch SE) |
| `components/ContactPage` | 3 | the contact page's topics (2026-11-11, batch PSB): no security topic and where a security issue goes instead, the shared-link topic when a shared report sends someone here, and no line for recruiters. jsdom |
| `components/LearningSettings` | 6 | Settings → Learning (2026-11-11, the full audit): how many events the account holds, what account deletion leaves (a day's count, no ids), nothing counted signed out, the account's switches rather than the last person's in this browser, a change written to the account or kept here as not yet sent, and one made before the account's copy arrives kept. jsdom |
| `components/LoginPage` | 7 | sign-in (2026-11-11, batch PSB): what an account adds, the verification notice handed back after an email sign-up only, the mode as two toggle buttons, Tab kept inside the card, a skip link to it, a refusal in the visitor's terms, and 16px fields below the desktop width so a phone does not zoom. jsdom |
| `components/MemorySettings` | 7 | cases from a loop over the two Forget buttons; Settings → Memory's *Learned from your changes* (2026-11-11, batch LRN2): listed apart from what the person said, in plain words, switched off and still kept, forgotten with what it was counted from; and Forget kept reports or Forget everything taking the kept reports out of the library too, Cancel leaving it. jsdom |
| `components/OfflineBanner` | 5 | the offline notice (2026-11-11, batch SAAS): at the top of the workspace, clear of the box, saying what is typed is kept; at the foot of a public page; nothing online; a sign-in's word kept until dismissed; and the only offline notice the workspace draws. jsdom |
| `components/PreviewRail` | 2 | the Preview's rail (2026-11-11, batch FEAT1): Compare with the original offered only when there is an original, toggling back to Select, and Select and Mark an area as they were. jsdom |
| `components/ProjectsPanel` | 10 | the Projects panel as its own lazy component (2026-11-11, batch WSX1): a row opened from its name button, the open project marked and its reopening left to App, the name drawn by `.wb-card-open` with no focus edge, a row saying it is opening, the trash deleting at once (the Undo is App's toast), a rename's Escape kept for the rename, Clear all asking once, a failed list told from an empty one, and the search's Escape. jsdom |
| `lib/analysisResponse` | 14 | 4 from two `it(` sharing one loop; since 2026-11-05 the answer is the REPX as raw XML: unwrapped from a fence, a preamble or the old JSON shape, cut off told from malformed, an unfinished document with a normal finish kept |
| `lib/aiProvider` | 9 | jsdom (storage); since 2026-11-10 (batch AF) the page reader found on the Local AI server whichever AI designs; since 2026-11-07 which model answers when it is not Gemini's, for the box (`answeringModel`); the workspace open only with the Gemini key in, whichever AI is chosen, and that AI ready (2026-11-05); which AI answers: Automatic as Gemini, key or no key, since Forma Offline went into it on 2026-11-05, and the retired Gemini and Forma Offline choices read as Automatic, ready only with what each provider needs, Forma's vision model found as a helper beside any AI or as the Local AI model itself and alone only then, the choice kept in localStorage and the OpenRouter key only in this tab's sessionStorage, an unknown provider ignored |
| `lib/announcements` | 8 | since 2026-11-07 the notes are the releases marked to announce, and the ids readers had seen are kept |
| `lib/composerStore` | 7 | what the box keeps over a reload (2026-11-07, agent audit items 69 and 71): a draft per project, an older build's single draft given to the project its tab had open, a new report's words moved to its id at its first save, the newest kept when there are too many; the queue only for its own project, kept as its words when its files will not fit, each saying so |
| `lib/assetPaths` | 2 | the served OCR, font and model files (2026-11-08, site audit item 91): each in its own folder and asked for by an absolute path, unversioned outside a build; written after a path lost its folder in the browser and nothing caught it |
| `lib/databaseAi` | 19 | a shared database and the AI (2026-11-09, batch DE): the likeliest objects first, the section with and without a chosen query, the chat's JSON of what the report reads, the `<?forma-query?>` lifted out, a query held to the layout (a join's columns from the foreign key, a filter in the measured form, what cannot be held dropped and said, a missing table, procedure or SQL refused), the object guessed from what is bound, custom SQL held to the layout, the data source written and why, and the chat's `data` and `group` edits, the group in print order and outside the last, its total, and the audit after |
| `lib/fieldMatch` | 7 | a column matched to a field (2026-11-09, batch DE, item 23): the words of a name, a heading against a field by name, words, sample value and type, every column's likeliest with how sure and the alternatives, and a field renamed in every expression and group |
| `lib/repxSqlWriter` | 18 | the SQL data source written (2026-11-08, batch DD), its strings what DevExpress 20.1 wrote (`emit-sql`, `emit-sql-params`) and reports like it filled by DevExpress over LocalDB (`sql-fill`): every SQL type's result-schema name, the connection by name, a built query's join, multi-value filter, descending sort, Top and distinct, the detail query, relation, lookup query and typed views, a procedure without its OUTPUT and a multi-value one joined, custom SQL escaped, parameters typed with defaults, the report pointed at the source, the lookup in ObjectStorage, a calculated field and a detail band whose total prints, a round trip the audit passes, a replace keeping its Ref, the refusals, a stored login found and stripped, the audit's field, parameter and DataMember findings, the connection entry and the Spec, and the Mockup and the audit agreeing on a detail band; since 2026-11-12 a relation and a calculated field named with XML and pattern characters written once |
| `lib/seo` | 13 | jsdom (`applyHead`); each page's head (2026-11-08, the site audit's batch SB): every route its own title and description, the public pages indexed at their canonical address and the rest not, the file each path is served from, the head written into index.html and kept in step on the live page, the home page's JSON-LD, and the sitemap, robots.txt, security.txt (the public address, never the git one) and llms.txt |
| `lib/sqlCompanion` | 10 | the companion on the user's PC (2026-11-09, Phase 2), its fill what the companion answered over the made-up FormaSample: the companion's copy of the layout script equal to `SCHEMA_SCRIPT`, who may call it, the header that forces the preflight, no companion read as null, a connection it lacks named, each answer of a fill mapped, a procedure asked for only when told, every .NET type into a hint, and a fill into the Preview's rows, detail rows and lookup lists |
| `lib/sqlDrift` | 13 | a report's own data source (2026-11-09, batch DG), its outcomes what DevExpress printed over the made-up FormaSample changed by `sql-fill --before`: a query read back and written again the same, a procedure and custom SQL read back, a dropped source carried back with its parameter and pointer, a fresh number when the old one is taken, nothing carried over a source of its own, the measured rename and type change found and fixed, a dropped column said, a procedure's OUTPUT, missing and new parameters, custom SQL and a missing table, the report's copy merged, a replaced source's own parameters removed and a used one kept |
| `lib/sqlPreview` | 10 | the Preview over a database (2026-11-09, batch DF), its expectations what DevExpress printed over the made-up FormaSample (`sql-fill`): each SQL type read as SqlClient hands it over, the AI's types and the Preview's hints, a query's sample rows joined, sorted and cut, an inner join's misses said and a left outer's kept, none for a procedure, the filter by field name, the orders report printed line for line with several regions and with one, a detail's rows by the relation's keys, and a lookup list with its cascade |
| `lib/sqlQuery` | 8 | what a report reads from a SQL Server database (2026-11-08, batch DC): joins both ways from foreign keys (a nullable key left outer), every field with its kind, a joined table's and the names that collide, a procedure's and custom SQL's, custom SQL's check (one SELECT, nothing that writes, runs, grants or creates), the report parameters each kind needs, and the DataMember name |
| `lib/sqlSchema` | 21 | the SQL Server programme (2026-11-08): over real engine output (the layout and sample scripts run over the made-up FormaSample on LocalDB, and the .repx `RepxProbe emit-sql` wrote), the scripts only read, every column, key, parameter default and described result, the first of two result sets, a temp table's reason, the one-cell and sqlcmd forms, SSMS Generate Scripts text, a .repx's data source and a stored login, the AI's text, and five layouts kept per device; since 2026-11-12 a header's WITH EXECUTE AS read as an option, and a long run of WITH options read at once (CodeQL js/redos) |
| `lib/staleChunks` | 5 | jsdom; a tab open across a deploy (2026-11-08, site audit item 1): each browser's words for a chunk that could not be fetched, one reload and not a second soon after, and only for Vite's preload error or a failed import |
| `lib/chatTurn` | 21 | since 2026-11-08 (batch K) the turn's control flow out of App: the queue's next step and its pauses, Resume, Steer, the questions waited on, the report a resend starts from, and how a turn that ended is said; how the chat box routes a message before any AI is asked (2026-11-07, the agent audit's batch B): a memory only from "remember" or "from now on", a plain build only when it says what the report shows, a reply to Forma's questions read as the answer, a question or a new request, and the selection named for a redesign |
| `lib/replyChanges` | 4 | the replies' changes kept in the tab for a reload (2026-11-07, agent audit item 52): only the open project's come back, the newest kept and fewer while too large, and anything unreadable or empty is nothing |
| `lib/releases` | 23 | the release notes behind /changelog (2026-11-07): since 2026-11-11 (PS-03, PS-16) every version the list carries was tagged on GitHub apart from the one the next deploy tags, the announced releases are the ones a visitor would want told, and the notes since 1.4.0 name no engine or model; since 2026-11-08 (site audit items 43 and 108) the versions numbered newest first with the newest equal to package.json's and the lockfile's, versions compared as numbers, a GitHub release's notes gathered from every release since the previous version, and the area labels `scripts/github-setup.mjs` makes held to the changelog's areas; newest first, slug ids and ISO dates, every release with a change of a known kind and area, 1.0.0's version; grouping by kind and month, filtering and its query string, and the Atom feed's shape, links and escaping |
| `lib/clipboard` | 3 | one copy for every Copy in the workspace (2026-11-06, the workspace audit): the clipboard when the page has one, a hidden field and `execCommand` where there is none, as on plain HTTP, and false when neither works; the document is stubbed, so `node` |
| `lib/initials` | 3 | one initials rule for the avatar and the account menu (2026-11-06): the first letters of a name's first two words, an address read the same way, and a question mark |
| `lib/layers` | 5 | the layer stack behind every Escape (2026-11-06, the workspace audit): only the topmost layer closes and the key goes no further, an Escape a field used left alone and every other key, nothing with nothing open, what is open and on top, and a key on a menu, a dialog or the conversation told from one on the report |
| `lib/autoConfig` | 13 | the settings Forma works out per request (2026-11-04): a report's version, unit, paper, orientation, direction and its stored procedure out of DevExpress's base64 data source; a PDF page's paper by its points; A4 and tabloid in words always, letter and legal only beside a paper word; the region's paper; right to left from the script; EXEC, CREATE PROCEDURE and "stored procedure"; the order report, page, words, learned, region |
| `lib/attachmentBudget` | 15 |  |
| `lib/attachmentParts` | 14 | 6 from one loop |
| `lib/attachments` | 9 |  |
| `lib/batchQueue` | 27 |  |
| `lib/boxTools` | 4 | the box's Tools (2026-11-08): distinct ids, a label, a note and words for every tool, no step of its own (the check, test data and Export each having a place), and the place to fill in taken out with the caret put there |
| `lib/boxText` | 5 | the boxes design for the vision model: its question word for word with render.py's, boxes numbered in reading order and read back, an answer read tolerantly, made a skeleton on the boxes' places, and scored box by box |
| `lib/boxReader` | 21 | Forma's box reader: since 2026-11-10 (batch AE) a page number on the last line read as page information, beside its caption or as "Page: 3 of 9", but not a count beside a figure or a number high on the page, and a total in a Detail line as a value while a record's own number stays page information; since 2026-11-05 a column that changes from record to record read as values and one that never does, holding no digit, as captions; texts grouped into the lines they print on; every line's and text's features finite and as many as the model reads; a small network's arithmetic; the second look given each line's own, neighbours' and lookalikes' first scores; a band that cannot follow the one above never decoded; a footer read as a record settled as the report's or a group's, its figure under the amounts a total, and a record with a field missing left a record; a skeleton keeping each band once and one record, a one-line record whose code recurs by chance and a two-line one, with every text where OCR read it; made a report with fields named after the captions; the shipped reader reading these features, holding no string but its names, and reading a plain listing as headings over records with its page number at the foot; a heading row taken for a record given back to the header; a report built from an OCR page and nothing from an empty one; a reader trained on other features refused, and fetched again |
| `lib/chatSession` | 61 | since 2026-11-07 (batch J) the conversation a chat turn carries, by size, with what came before it named (`conversationContext`); since 2026-11-07 (batch I) what a screen reader hears when a request settles (`requestAnnouncement`); since 2026-11-07 (batch H) Forma's questions and a redesign's outcome in the Markdown export; since 2026-11-07 Forma's questions written into the conversation the model is sent; since 2026-11-07 a failure marked on the request that asked (`markAskError`) and a message left unanswered by a reload marked so (`markInterrupted`); since 2026-11-05 the transcript as requests (requestsOf, requestTitle, requestState, requestMatches); since 2026-11-05 the conversation as a Markdown file; since 2026-11-05 a message's time read off its id; since 2026-11-05 the versions an edit or a Try again keeps; since 2026-11-05 a typed yes to a redesign; since 2026-11-05 the message a reply answered; since 2026-11-05 the sidebar's Search over the saved projects, their names and chats, a query taken as text; since 2026-11-04 also withdrawing a turn and the transcript search: a query taken as text, and cut correctly where lower-casing changes a length |
| `lib/contactSubmit` | 8 | a 2xx FormSubmit did not accept, or that cannot be read, is not sent (2026-11-08, site audit item 45) |
| `lib/criteria` | 10 | DevExpress's expression language; the 44 expressions and 11 totals of parity case s16, each a string DevExpress printed |
| `lib/csvExport` | 8 | CSV export; three expectations are DevExpress's own exported files, byte for byte |
| `lib/csvSafety` | 3 | the "Safe for spreadsheets" switch kept in this browser (2026-11-11, batch PXB, read by the Export panel without loading the CSV writer); since the re-audit's R3-09 it reads off where storage is refused rather than showing on and being ignored |
| `lib/dataSource` | 29 |  |
| `lib/datetime` | 12 |  |
| `lib/keyHandoff` | 3 | the keys reaching a new tab (2026-11-08, site audit item 105): a tab with no key asks and one with a key answers, neither does when turned off, and the setting is on until turned off |
| `lib/problemReport` | 4 | which build runs and a problem report (items 103 and 64): the version in front since item 43, the short commit and the day, the commit's link, and an issue prefilled with the area, the error, the build and the page without its query |
| `lib/projectExport` | 7 | every saved project in one .zip (items 59 and 66): each as JSON, its .repx beside it, and a README |
| `lib/storagePersist` | 2 | asking the browser to keep local projects (item 60): once, not when it already does, and no where it cannot |
| `lib/authDomain` | 3 | sign-in's domain and App Check (2026-11-08, site audit items 98 and 56): the page's own host only once listed, a redirect only where it can come back, and, App Check on since the owner's reCAPTCHA key the same day, exactly its origins in the CSP while sign-in's own hosts are still unlisted |
| `lib/serviceWorker` | 5 | the offline worker (2026-11-08, site audit item 55): pages from the network first, hashed files from the cache, the handwriting model, the worker itself and Firebase's paths left to the network, and the source it writes parsing with the same routing rule |
| `lib/signOut` | 17 | since 2026-11-10 (the full audit) the learning events deleted on sign-out by their store's name; since 2026-11-10 (batch AG) the kept batch deleted on sign-out by its store's name; since 2026-11-09 the database layouts kept on the device deleted, by the store's own name, and IndexedDB that throws survived; what a sign-out removes from the tab (2026-11-08, the site audit's batch SG), shared by the public site and App: every session key and nothing else, storage that throws, and each key spelled as the module that writes it |
| `lib/docsSearch` | 8 | the Docs page's search and feedback (2026-11-08, the site audit's batch SD): an article found by the words it says and not only its title and keywords, every word of the query needed, and the feedback as a GitHub issue prefilled with what was typed and the article |
| `lib/designerBridge` | 57 | since 2026-11-11 (batches SDC, CCC and PERF) /health's `inspects` flag, POST /inspect and /render asked only after a Forma Designer that has them answered in the page, a body that is not JSON read as an unreadable answer, and the findings kept under the file's own REPX; 8 from one loop; batch WF (2026-11-09) took out the five on the probe's throttle with the probe, and added /health read in both shapes, Windows from the platform or the user agent, a 424 carried as DesignerRefused, and every step of the Open in designer dialog with a newer download named; since batch WE the website reaching it from Forma's own sites and no preview channel, looking for it on load only from a page served from the PC, the companion's own list of sites and routes read from Program.cs, and the browser's loopback permission read without asking |
| `lib/designerRelease` | 6 | the Forma Designer download's record (2026-11-09, batch WD), written by `scripts/package-designer.ts`: its version the companion's own `AssemblyInfo.cs`, a real SHA-256, size, date and tag, the GitHub release address, a package of the program and its three texts and nothing of DevExpress, the download's texts in ASCII saying DevExpress is not included, and an older running copy told by number |
| `lib/draftText` | 12 | jsdom (`checkRepx`); Forma's draft as the AI corrects it (2026-11-05): written line by line with its words, fields, groups and colours and read back exactly; words with spaces, quotes and a bar; a line and a table written with no role, font or alignment, quoted from the first measured answers; the borders and length a model drops before its words, an alignment written as a word, a length left out, a total written as `sumSum([Amount])` and a fence forgiven; words only for text and a field only for a value or a total; what cannot be read skipped and named; the report built from it carrying them, in the version asked for, a file the designer opens; the rules naming every band and role |
| `lib/embedStore` | 20 |  |
| `lib/exportItems` | 5 | the RTF, DOCX and HTML exports read back against DevExpress's of s54a: every frame's page and twips, a section per page, every HTML cell's place in the grid; RTF text escaping, and since 2026-11-12 a link escaped for its field code before RTF |
| `lib/expressions` | 8 | the expression reference and the check a generated one is held to, including that an aggregate in a column prints blank |
| `lib/fallbackChain` | 14 | the free chain across providers on a limit (2026-11-10, the AI accuracy programme's batch AF): a 429, a spent allowance or a rate limit on the error or its cause, and nothing else; OpenRouter then Local AI after Gemini, Gemini then Local AI after OpenRouter, each only when set up, and nothing after Local AI; the AI chosen answering with no note, the next asked on a limit and named in the note, any other error thrown as it was, the last AI's thrown when none answers, a stop obeyed at once |
| `lib/fidelity` | 26 | the benchmark's scorer, with the database case's bindings and data source checks (2026-11-09); the runner under `scripts/fidelity/` is not in the suite |
| `lib/folderDrop` | 10 | the batch panel's folders and drops: a folder read to its end past the reader's first batch of 100, what the batch takes by type or name, path order, the 500 cap |
| `lib/formaModel` | 15 | Forma's own model over made-up reports: a skeleton keeps the structure and every text's role and none of its words, the paper named either way up, the feature vector; a Crystal Reports layout (`skeletonFromLayout`) named, margined and titled as a parsed report is, with unknown kinds, roles and non-finite numbers held to the vocabulary; `categoryOf` naming a generic category and never the folder; the house style by role, two kinds of report with their categories, the archetype a request names ranked first, the same clusters every time; `unexpectedStrings` empty and naming what is slipped in; and the shipped `assets/model/formaModel.json` holding no string outside its vocabulary |
| `lib/formaTeam` | 11 | since 2026-11-10 (the full audit) the team line naming nobody, mock mode alone saying a canned report stood in, and the stand-in draft handed over with no OCR or model named; Forma's team: the vision model's draft told to the AI in the report's own unit, with OCR's words, bound values and totals named, a long text cut and the boxes capped, and the image said to win; the box reader's draft said to be the box reader's; the house style told as defaults, nothing when it holds nothing, and the shipped model's style read; who took part named in order; why the AI did not answer in a few words, and what the stand-in draft was made from |
| `lib/firebaseClient` | 6 | the auth and Firestore halves of the loader against mocks, App Check started once on the auth client's app and never for a signed-out reader (2026-11-08), and the imports that would undo the split against the source |
| `lib/geminiClient` | 6 |  |
| `lib/handwriting` | 5 | handwriting read again by TrOCR: only the lines Tesseract read below 70, each cut with room around its ink, put back as one word over the line, a line read as nothing kept |
| `lib/geminiErrors` | 36 | since 2026-11-10 (batch AF) OpenRouter's refusal for the account's data policy said as the privacy setting to change, not a missing model; since 2026-11-07 (batch E) a Local AI or OpenRouter failure in its own words, a pinned model's spent allowance, offline, one overload test and the cause kept; since 2026-11-05 dailyLimitOf; since 2026-11-02 also which quota a 429 is (daily or per minute), the count to midnight Pacific when daily quotas reset, and a spent daily allowance named as one, with a local AI or OpenRouter offered meanwhile (Forma Offline until 2026-11-05) |
| `lib/generationProgress` | 20 |  |
| `lib/houseStyle` | 20 |  |
| `lib/libraryDb` | 16 | the record mapping, and since 2026-11-11 (batch LRN2) the `kept` store over fake-indexeddb: the version 1 to 2 upgrade, records by owner only, the newest twenty |
| `lib/reportFacts` | 11 | the open report's facts counted from the file (2026-11-10, the AI accuracy programme's batch AG): bands, controls, fields printed or computed from, totals with their function, field and scope, groups and paper; the data's fields from the data source a report declares, or a database App knows, null when nothing says; an expression's fields, never a parameter or a string; the facts block told to the AI; a plain question about fields, totals, groups, bands, parameters, controls or paper answered with no AI, and a change or anything else left to it, and since batch AH a question about one column, band, total or parameter left to it too (found by the chat judge's dry run); a field a reply names that the data lacks, only when the data is known |
| `lib/inputModality` | 7 | pointer or keyboard on the root (2026-11-10, the full audit): a press and a key that moves focus read as each, typing and Enter as nothing, and the attribute following the last of them until stopped. jsdom |
| `lib/learning` | 35 | since 2026-11-11 (batches LRN and PRIV) the kinds `kept` and `undo`, the fixed lists the rules accept (each held to `firestore.rules` by a test), sends one at a time, a whole report capped at 700,000 UTF-8 bytes with `dropped` saying what was left out, and the events over fake-indexeddb; what Forma may learn from each use (2026-11-10, the full audit): the settings' defaults and a bad value, the scrub leaving a sound skeleton as it is and stripping any other string wherever it sits, the skeleton as JSON or nothing when too big, an event on the structure tier carrying no report or words and on the full tier carrying both within their limits, every field present with its default, the operations capped, ids unique within a millisecond, the source named from what was staged, and the summary by kind |
| `lib/previewRows` | 4 | the rows the Preview prints with a question about the data (2026-11-10, the second gap of `docs/proposals/ai-designers.md`): a question about figures or a printed field taken and a change or a layout question left; the fields named a row a line at most MAX_ROWS, the budget kept, nothing with no rows; what Forma asks before they go and says when they went |
| `lib/repxTranslate` | 21 | since 2026-11-11 (batch FEAT1, CP-06) a second language written as DevExpress's LocalizationItems in the form `RepxProbe emit-localize` measured: every control's Text and Font as a Default item, the block after the report's own Bands, and a text retyped in the shown language written to that language; a report's typed texts for translation (2026-11-10, the first gap of `docs/proposals/ai-designers.md`): every typed text with letters once each, not a number, a dash, a bound label or a page number; each translation put back escaped and the rest byte for byte as it was; the language a request names |
| `lib/jobPlan` | 12 | the plan a heavy message gets first (2026-11-10, batch AG): each file once with its pages, three files or nine pages planned and one eight-page document not, the reply and the steps with their requests counted, a file left out and counted again, a report for each in Batch and what was started; started, the pages and texts of the files kept, and Batch handed the files themselves or a picture rebuilt from its page |
| `lib/batchCheckpoint` | 9 | the batch kept in the browser, its pure half (2026-11-10, batch AG): a file running when the tab went done again and what was done kept, what is said over it and from when, which failures stop it (a limit, the key), and a kept row opened as a report read off its REPX |
| `lib/chatJudge` | 6 | the chat judged (2026-11-10, the AI accuracy programme's batch AH): twenty requests each named once with where its words come from, across every kind; an edit made with the op asked passing, and a declined edit, a wrong action, a missing fact and an invented field failing; the judge asked against what the assistant was given, with the rubric; its JSON read, fenced or not, and nothing else; a run summed |
| `components/PlanCard` | 3 | the plan in a reply (2026-11-10, batch AG): files ticked and the steps counted again, a report for each started with what is ticked, nothing to start with nothing ticked, Not now, and what was started once answered. jsdom |
| `components/docsCorpus` | 5 | the Docs page drawn off screen as the chat draws it (2026-11-10, batch AG): every article read with its heading and its words, a note's label not run into its paragraph; 21 questions a person might ask, each given the article that answers it, measured 21 first of 21 (20 with a plural's s as the only stemming); nothing for a change or for words the docs do not hold, and the page drawn only for a question; the budget kept, each article under its title. jsdom |
| `lib/localModels` | 5 | the Ollama pair suggested for 8 GB and for 16 GB or more, with its pull commands and only models from Ollama's own library (2026-11-10, batch AF); the question each page reader is asked, and its text under a header that sends positions to OCR's reading, its fence dropped, an empty answer sent as nothing and a runaway one cut |
| `lib/licenceNotice` | 4 | /licenses.txt (2026-11-08, site audit item 97): a shared licence text printed once under every package, a package listed once, a missing licence file pointed at the licence's text, every shape of a licence field, and the package a bundled module came from |
| `lib/memory` | 18 | since 2026-11-11 (batches PRIV, LRN and LRN2) the memory kept per account, a memory said for one project applied there only, the person's style from two kept reports (`personalStyle`) in hundredths of an inch whatever the report's unit; since 2026-11-07 only "remember" and "from now on" kept, and a name said as not wanted, or after the first wanted, not a hint; jsdom (storage); Forma's memory: a message asking to remember known from a request, its words kept with the paper, orientation, face and sizes it names; a kept report's style kept with none of its words; the newest 30 kept, a style learned from two; the user's words winning over their reports and a switched-off memory skipped; what an AI is told; read back from this browser |
| `lib/mockupRows` | 12 |  |
| `lib/modelCache` | 19 | the overload cooldown, and since 2026-11-09 the cache telling a listener when it moves (the chat box's model menu, filled after Check key without a reload), every listener told even when one throws |
| `lib/modelCatalog` | 24 |  |
| `lib/netDecimal` | 8 | .NET's decimal: scale, exact sums, 28-place division, both roundings |
| `lib/netFormat` | 15 | .NET composite, date and number formatting in en-US; every cell of parity case s15's format table is a string DevExpress drew |
| `lib/ocr` | 10 | Tesseract's blocks read as words and lines with boxes and confidence, enlarged boxes divided back |
| `lib/ocrScript` | 8 | OCR working out a page's language (2026-11-04): a page's confidence weighted by its text, a confident page taken as Latin script, the widest garbled lines probed and not the mixed ones, the owner's certificate's measured scores choosing Arabic, a script not far enough ahead or winning on too few lines refused, French, German and Spanish known by their function words and English left as English, handwriting tried only when enough lines stay unsure |
| `lib/ocrLayout` | 19 | OCR to layout: a label at its text, a line split at a gap wider than it is tall and between two amounts however close, but not inside a number with a space between its thousands, aligned rows as a table and a row that does not line up kept out of it, a table sized by its cells' widths when their boxes take in the borders, the text for the model, low-confidence words flagged, picture readings set aside, margins fitted to the content, a screenshot fitted to the printable width, the font from the ink; since 2026-11-10 a word flagged by the threshold of the engine that read the page, 95 for PaddleOCR and 60 for Tesseract |
| `lib/ocrRepx` | 9 | jsdom; since 2026-11-06 `reportNameFor`, moved from `OcrDialog`'s test with the re-export; a detected layout written as a .repx: the app's own checks pass, every label and cell where the layout put it on the report header, a page break per page, labels as wide as Arial prints them, the Mockup's layout and the spec from the same controls, Dpi and paper by the repair passes, flagged text named or left out; since 2026-11-12 a backslash in an unsure text escaped in the spec's table as a pipe is |
| `lib/offlineGenerator` | 9 | jsdom (`checkRepx`); reports designed by Forma's own model over the shipped model: the words read for category, columns, grouping, totals and page; field names, captions, types and titles; a grouped payroll report that opens, passes the audit and prints its records, group totals and grand total; a pasted schema and a given title winning; the house style and a remembered paper; a named kind of report starting from its usual columns; the category's pattern chosen |
| `lib/paddleOcr` | 16 | PaddleOCR's steps around its two models (2026-11-10, the AI accuracy programme's batch AC): the recogniser's character list, greedy CTC, the detector map's regions grown by the unclip distance and the faint and tiny ones dropped, the detector's input in multiples of 32 and BGR, pictures resized and cropped, reading order, a line split into words at the space class, the reader end to end over two fake sessions, a page in another script told by the share of its regions read rather than by confidence, and the recogniser's narrowest input reaching it |
| `lib/paddle` | 11 | the main-thread side: the served check that refuses the index page a site answers every unknown path with, asked once, a page read enlarged brought back to the picture's size, a page left to Tesseract, and the regions shared among the worker pool |
| `lib/sidebar` | 5 | the workspace sidebar as Gemini's and ChatGPT's (2026-11-04): the stacked breakpoint at 880px, the measured widths, Ctrl+B or Cmd+B and none of its neighbours, the toggle's name |
| `lib/pdf` | 7 |  |
| `lib/pdfA` | 15 | PDF/A (row 72) against s60 and s62: the root's `PdfACompatibility` read, dates and XMP that agree, the sRGB ICC 2.1 profile's header, tags and curve, pictures flattened over white; the embedded fonts' `?` for a missing character, widths, Unicode map in blocks of a hundred and beyond the BMP, CIDSet, subset tag; a written PDF/A file (1.4, output intent, uncompressed XMP, Type 0 over CIDFontType2, CIDSet, `Length1`, identifier, dates, link print flag, no SMask for part 1), read back as text by pdf.js; PDF/A with a password refused; a report not asking for it unchanged. The same writer's files passed veraPDF 1.30.3 as 1b, 2b and 3b |
| `lib/pdfCrypto` | 8 | 3 from one loop; MD5, RC4 and AES-128/256 against their published vectors; the file's `PasswordSecurityOptions` as DevExpress wrote them (s61); Forma's encrypted PDF opened by pdf.js at AES-128, RC4 and AES-256 with either password, its text, title, link and outline read, and refused without; the permissions under each password (row 73) |
| `lib/pictureBox` | 11 | an XRPictureBox as DevExpress 20.1 printed every Sizing mode (row 76): PNG, JPEG, GIF and BMP headers read for the pixels and the DPI, 96 when unsaid; the settings with their defaults; the same pixels at 192 dpi half as large; Normal, CenterImage, StretchImage, AutoSize, ZoomImage, Squeeze and Tile in a 180 by 100 box, with a small and a large image; a written ImageAlignment in every mode; an image of unknown size drawn zoomed |
| `lib/pdfWriter` | 9 | pdfjs warmed in a `beforeAll` since 2026-11-02, when its cold import timed the first case out in a full run; the PDF outline against DevExpress's for s54a to s54c, Windows-1252 text, and a written PDF read back with pdfjs: pages, text, an image, a link and the outline, compressed and not |
| `lib/promptSections` | 48 |  |
| `lib/promptToReport` | 9 | the pure half of Prompt-to-Report (its six predefined prompts and their test went on 2026-11-05); a description typed into the chat box, its fenced or CREATE TABLE schema taken as the data source |
| `lib/readCoverage` | 8 | what a report kept of what Forma read on the page (2026-11-10, batch AD): the draft's titles and captions, in labels and cells, with their bands, values and totals not; found whatever the case and punctuation, as whole words, the top margin counting as the page header; and asking once more only for a real loss, the note naming at most twenty texts |
| `lib/reportBands` | 14 | since 2026-11-05 no layout JSON or markdown asked for, and no row cap |
| `lib/reportConfigStore` | 14 | since 2026-11-04 only the version and unit learned from the user's reports are kept, a version only as major and minor, and what earlier builds stored for the paper, header, footer, direction, procedure and OCR retired on the way in |
| `lib/reportData` | 28 | since 2026-11-09 (batch DF) a hinted column typed as its hint, a multi-value parameter expanded in a filter, and each record's own row kept through a filter and a sort; 7 from one loop: every summary scope in every band of parity case s17, against DevExpress's own pages and groups; then sorting, group runs and filtering |
| `lib/reportGeometry` | 47 |  |
| `lib/reportPreview` | 310 | 32 from eight loops, the fifth an `it.each` over the four table-of-contents placements, the sixth over two drill-down cases, the seventh over four s57 page feet and the eighth over four right-to-left cases: parity cases c05 to c05e page for page, the seven s19 nesting variants, the four one-field-per-kind cross-tabs' CSVs, and s29a and s29b; a chart's points over test data against DevExpress's, and its pie shares (row 32); drill-down collapsed (s56a, s56d) label for label, expanded as none, one group toggled, and the CSVs byte for byte (row 69); a one-line record at the foot of the page kept while its line fits and moved whole once it does not, with a page footer and without, against DevExpress's PDFs (s57); interactive sorting leaving the data and `SortFields` orders as DevExpress printed them (s58); right to left, every label's and cell's aligned edge against DevExpress's PDFs of s63a to s63d, and the file's own x kept for edits (row 75) |
| `lib/repx` | 24 | jsdom |
| `lib/repxAccessibility` | 21 | one loop of five control types inside one case |
| `lib/repxAudit` | 106 | since 2026-11-11 (batches SC and CCA) report-has-scripts, expression-invalid, expression-field-unknown, and margins and a page size that are not whole numbers |
| `lib/repxBindingPlan` | 67 |  |
| `lib/repxBindings` | 33 |  |
| `lib/repxChunks` | 22 |  |
| `lib/repxCrossTabs` | 37 | 24 from one loop: every field shape DevExpress's `GenerateLayout()` produced, cell for cell, ten of them unseen when the rule was written |
| `lib/repxDpi` | 11 | Dpi in millimetre and pixel reports; the expectations are files DevExpress saved, stripped and repaired back |
| `lib/repxEdit` | 56 | cases from a loop; since 2026-11-07 a line break written as the serializer writes one, with Multiline on; since 2026-11-06 duplicating a control (fresh Refs and free names in everything it holds, a self-referring one declined, and one linking outside itself, such as to its formatting rule, copied with the link); since 2026-11-04 also deleting a control (its siblings numbered again, an emptied Controls removed, one named by `#Ref` declined), adding a label in its band's Dpi, and retyping a table cell (a bound one declined) |
| `lib/repxGroups` | 12 | nested groups written without `Level`; parity case s19, written as DevExpress printed it inside out, repaired and paginated into the nesting it printed with `Level` |
| `lib/repxGroupField` | 7 | the field a group breaks on, rewritten with its heading's binding and nothing outside the band; a header grouping by nothing given a field list with a fresh Ref; two groups by region becoming three by country over the same rows |
| `lib/repxItems` | 12 |  |
| `lib/repxLayout` | 11 | controls past the printable width or their band, bands taller than the page, inside a detail report too |
| `lib/repxMargins` | 31 |  |
| `lib/repxOverlaps` | 11 | FixLayoutErrors: overlapping siblings found and moved apart |
| `lib/repxPaper` | 11 | the paper DevExpress prints on, and naming it as its serializer does; parity row 44 |
| `lib/repxParameters` | 26 | since 2026-11-09 a lifted parameter's type read from its ObjectStorage entry |
| `lib/repxRefs` | 26 |  |
| `lib/repxRtl` | 12 | the Settings checkbox's right to left, on the report root only, idempotent, and read back by the Preview as mirrored |
| `lib/repxStyles` | 18 |  |
| `lib/repxSummaries` | 19 | totals with no running scope, which DevExpress prints blank; each fixture is a shape it was made to print |
| `lib/repxTruncation` | 19 |  |
| `lib/repxViews` | 12 | the Mockup, the Spec and the title read off the REPX (2026-11-05): a section per content band in print order, x from the paper's edge and the top margin in the first section, font sizes in report units, a field as `[Field]`, a picture cropped from the upload only before the Detail band, what DevExpress does not print left out; the title from `DisplayName`, the largest text before Detail, or the `Name` |
| `lib/agentEdit` | 130 | cases from tables of edits, so count by running it; since 2026-11-11 (batches CH, VO1, BW and BW2) a guarded tool the model brings alone dropped rather than offered, every edit said in plain words, and a changed part named by kind and caption (“the Amount heading”); since 2026-11-10 (batch AG) a bind or group only to a field the report's data has, as the data spells it, and any when the data is not known; since 2026-11-07 (batch J) one parse per version of the file; since 2026-11-07 (batch F) the tools split into those run at once and those offered; since 2026-11-07 (batch E) quoted booleans and numbers read as what they say; since 2026-11-07 (batch D) duplicate, band height, borders, a line, a format, a binding and a page number, a table's row, column and every cell, .NET's colour names, a charSet kept, an added label's band font and name, a colour described as a recolour, each tool once, the second pass's message and the undo tool, tool lines under Started; since 2026-11-07 (batch C) a right-to-left report outlined and edited as written with alignments as they print, a control in a panel, two controls of one name, a long table, colours, borders, a format, a total and an expression in the outline and an expression not retyped, landscape on a Custom paper, absent margins, and tools with no pane or format; since 2026-11-07 an added label's font, and the brief and a new report read from the answer; since 2026-11-06 an alignment sent with no side taking the one side the request names; since 2026-11-05 formatEdits, for the selection toolbar; since 2026-11-05 changedControls, for the log's outline; since its first day also the tools the chat runs; the chat's edits to an open report (2026-11-05): the outline the model is shown, its answer checked before Forma acts on it, each edit made by splices and found by name, a font made bold keeping its family and size, a style priority set back, declines with their reasons, the paper and margins, the 40-edit limit, and what changed read off the file |
| `lib/revisions` | 21 |  |
| `lib/revisionStore` | 30 | since 2026-11-11 (batch LRN2) the versions in ten fixed slots, v0 to v9, overwritten rather than deleted, older ids moved into slots at the next save |
| `lib/router` | 20 | jsdom; since 2026-11-07 a fragment that is not a route is kept as the section it names, and `scrollToHash` reaches a section already there or one that renders later |
| `lib/routes` | 19 | since 2026-11-07 a tab's title for a question waiting and a request that failed; since 2026-11-06 a shared report's /s/{id} opened as its own page and named as one, a malformed one as nowhere; since 2026-11-05 the title of a tab that finished something unseen |
| `lib/shortcuts` | 9 | since 2026-11-08 M and V as Mark an area and Select, never while typing or with a modifier; since 2026-11-06 Ctrl+Z as undo and Ctrl+Shift+Z or Ctrl+Y as redo, left to a field; since 2026-11-06 Stitch's too, Ctrl+K, Ctrl+Backslash, ? and the zoom keys by the physical key, left to a field being typed in; the chat's keyboard shortcuts, ChatGPT's own (2026-11-05): Ctrl+Shift+O, Shift+Esc and Ctrl+Shift+C read exactly, nothing else held, never mid-composition, and each written as a PC and a Mac write it |
| `lib/workingTips` | 4 | the tip above the box while Forma works (2026-11-06), as Stitch's: distinct sentences short enough for one line, walked from a starting point and wrapping round, and Ctrl written as the Command key on a Mac |
| `lib/startingPoints` | 2 | the empty workspace's starting points (2026-11-06), the six removed on 2026-11-05 back word for word with a one-line gist each, and the recent projects newest first with the archived left out |
| `lib/shares` | 13 | a shared report's copy (2026-11-06): 22 base64url random characters for its id, invitees trimmed, lower-cased, unique and capped as the rules compare them, exactly the fields the rules pin with the conversation left out, a report too large declined, and the link built and read back |
| `lib/requestCount` | 4 | since 2026-11-05 the limits Google stated; requests sent to each Gemini model today (2026-11-05): the Pacific day, a count per model that starts again at zero the next day, and storage that will not read or write |
| `lib/modelTiers` | 4 | since 2026-11-08 Auto naming the model it runs on once the key's probe has found it, and each tier worded as Stitch's ("Gemini 3.6 Flash for new reports and redesigns"); the box's model menu as named tiers (2026-11-05), as Stitch names its two: a model's id read as a person would, Fast as the first Flash-Lite and Balanced the first Flash in the probe's order, a tier with no model left out |
| `lib/dataFiles` | 9 | data files attached in the chat (2026-11-05): the kinds taken, quoted CSV, a CSV and a JSON array as fields and first rows, a workbook's first sheet with shared strings, a deflated Word document read through the zip reader, and what a bad file says |
| `lib/runawayOutput` | 10 |  |
| `lib/savedReport` | 49 | since 2026-11-08 (site audit item 63) the projects index: the search text and its cap, an entry with the project's own name, time and message count, a listed entry with no content that never throws, and content kept where the same save is already here; earlier: since 2026-11-07 a name from the first words giving way to the report's title; since 2026-11-05 pinned and archived projects kept on this device; since 2026-11-05 the session signature the workspace saves on, and a project's name; jsdom |
| `lib/skeletonRepx` | 24 | jsdom (`checkRepx`); a skeleton made a report again (milestone 6): written and read back through the Preview's parser as the same skeleton, caption lengths and A4's exact size aside; a file the app opens with no audit error; titles and captions in the words read inside their boxes, a placeholder where none was, "Total" in a footer; values bound to fields named after the caption over their column, totals summing that field at their band's scope; a date or a page number as the page showed; the empty Detail band DevExpress expects; the Mockup's sections and the spec; several pages' skeletons joined, the first page's bands kept and a later page's footers added where DevExpress prints them (2026-11-04) |
| `lib/skeletonText` | 25 | the text Forma's vision model learns to write (milestone 6): a skeleton written and read back exactly, one line per band, control and table row, places rounded to whole hundredths; a model's answer read tolerantly, each skipped line named, a malformed row skipped whole, no page line refused; bands as tall as DevExpress prints them; a variant with the same structure in other places, every control inside its band and the printable width, no word added, the same for the same seed; the instruction word for word as `train_vision.py` asks it, read from the script; the scorer, perfect on the right answer, pairing controls by place within a band; the page scorer that sets the model beside OCR, its fixed bands laid out as render.py draws them, a box right at half overlap and a text found where something was read inside it, readings among the records ignored; a font outside the public list found as a stray word, and replaced by Arial in labels and cells alike |
| `lib/sourceRect` | 14 |  |
| `lib/textMeasure` | 52 | 24 from one `it.each`; line breaking and spacing as DevExpress printed them, one line and several in ten fonts; the canvas broke 18 of 18 printed texts identically; the slack a line may overrun its box by, the faces GDI does not kern, and one line at the full spacing when it fits only kerned (row 59); which families have a synthesized bold and how far it widens (row 60), and the two widenings of the families that widen otherwise, against DevExpress's breaks and short lines (row 67); the families GDI does not kern (row 61); line metrics outside the table (row 63); the face the browser knows a GDI family name by (row 62); since 2026-11-04 also turned text laid out twice as DevExpress prints it (parity row 54), over fake widths, and one line as GDI+'s ascent and descent |
| `lib/themeTransition` | 16 | jsdom; since 2026-11-06 a click made during the wipe ending it and passed to the control under the pointer |
| `lib/tokenUsage` | 16 | since 2026-11-07 two requests' usage added |
| `lib/trueType` | 6 | the committed Liberation faces read for a PDF descriptor (Arial's 905 and -212, a space of 277.832, as DevExpress's s60b); a subset keeping every glyph slot with outlines only for the glyphs used and the components of a composite, the nine tables, long `loca`, checksums a font reader accepts; a CFF font refused |
| `lib/userInstructions` | 9 |  |
| `lib/vectorSearch` | 14 |  |
| `lib/workspaceView` | 11 |  |
| `lib/xlsxExport` | 25 | 8 from one loop; Excel export; the expectations are DevExpress's own workbooks read into grids, one by fingerprint; the file's `<Xlsx>` options, every file, sheet, gridline setting and cell of s62a to s62h (row 74); since 2026-11-12 a quote or a backslash in a format's literal written outside its quotes |
| `lib/zip` | 25 |  |
| `lib/batchRun` | 7 | one Batch file made as a single report is (2026-11-11, batch BW): each file's pages read afresh, never through the chat's cache, so a later batch never gets an earlier file's text; a page it could not read skipped and tried again next time; the reading's notices on the row and its learning event under no project; nothing asked once the batch is stopped |
| `lib/cloudPayload` | 3 | what of a project fits Firestore's document (2026-11-11, batch PXB): kept whole when it fits, every picture left out (earlier versions' too) when only that fits, nothing written when the words alone are over |
| `lib/corrections` | 11 | the ledger of what a person changes in Forma's reports (2026-11-11, batch LRN2): a report's style by kind of text and its margins, nothing of the words; each changed part at the value kept, an undo counting against it, one report once and the newest kept; a habit learned from two reports and not one, not against an undo, said in plain words as a memory of its own, switched off, forgotten with what it was counted from; and the house style carrying only the habits switched on |
| `lib/deferredDelete` | 9 | a project's delete with Undo (2026-11-11, batch WSX1): hidden at once and deleted after the wait, hidden until its deletion has settled, kept on Undo, a group partly taken back, deletions one after another (WS-27), the next run when one throws, flush; and `signOutKeeping`'s order: the last change kept, then sign-out, then the browser cleared, even when the save or the sign-out fails |
| `lib/deskew` | 10 | a picture straightened at intake (2026-11-11, batch FEAT1): ink told from paper, a phone photo a few degrees off either way, a straight page left alone, a page on its side and which side, only a page-shaped picture turned (never a logo or a barcode), no half turn, too little ink left alone |
| `lib/docsKnowledge` | 1 | each Docs article told to the chat headed by the link a reply points to (2026-11-11, the full audit) |
| `lib/docxExport` | 2 | the Word export (2026-11-11, batch PXA): a control character in the data dropped so the XML holds (PX-12), and a picture described by its control's accessible description (CP-14) |
| `lib/htmlExport` | 2 | the HTML export (2026-11-11, batch PXA): a control character in the data dropped with the text around it kept (PX-12), and a picture's alt text from its control's accessible description, none for an empty one (CP-14) |
| `lib/docxLayout` | 8 | a Word template read into Forma's draft (2026-11-11, batch FEAT1): the page and margins from the last section in hundredths, the paragraphs around the table with size, weight and alignment, the table's columns, row height and cells, a bold switched off, a merge field's name, and the draft written and read back; null for a zip with no Word document |
| `lib/download` | 4 | every download through one helper (2026-11-11, batch BW): a link attached to the page, clicked and removed, its address let go a minute later, text saved with its type, and a name a file system takes. jsdom |
| `lib/downloadEverything` | 4 | Settings' "Download everything (.zip)" (2026-11-11, batch BW2, lazy): since the re-audit's R3-13 a person with memories but no projects still gets a .zip, and a part that could not be read is named in its README |
| `lib/inspectionGuard` | 6 | what may be handed to DevExpress on the person's PC unasked (2026-11-11, the re-audit's R5-03): DevExpress's own report types, .NET value types and the SQL data source pass; any other ControlType, ObjectType or parameter Type is refused, a data source's Base64 read for the same, and a picture, style sheet, XML data or subreport naming another computer, a `file:` address or a drive refused |
| `lib/reportFile` | 4 | whether an attachment is a report Forma builds on (2026-11-11, the re-audit's R3-08), one predicate for App and Batch: a .repx, .rdl, .rdlc or .frx whose text holds a DevExpress report; an RDL that did not convert is a source to design from, and with no text the name decides |
| `lib/exportJob` | 8 | exports as jobs that queue (2026-11-11, batch PXB): which PDF a job writes, each format once in the order asked, what is said while it writes and where the file went, a .zip named for what it holds, the reply's "Exporting it as" replaced once, and a script Forma's PDF cannot hold printed instead and said |
| `lib/focusRules` | 12 | the owner's focus rule read out of every stylesheet and inline style (2026-11-11, batch FO): the checks themselves, then no border, outline, ring or gradient edge on a pointer focus, since 2026-11-12 the composer's gradient edge kept for the keyboard and no longer allowlisted, no orange or amber edge in the workspace, a selection by fill or blue, the keyboard given a ring back wherever one is turned off, a flagged public field's red edge kept, and the pointer reset last in `index.css` |
| `lib/formatFromText` | 22 | 13 from one `it.each`; a value's format read off the page's text (2026-11-11, batch CCB): dates, numbers, money and percentages as .NET formats, kept only when it prints every sample, none for a code or text, `isRatio` and the narrower `saysRatio`, and `applyFormats` on the values and totals that print one field |
| `lib/importForeign` | 30 | SSRS and FastReport files as DevExpress reports (2026-11-11, batch FEAT1): XML text, CDATA and entities, SSRS lengths, fields, parameters, totals and page numbers converted and the rest kept as text, each table row in the band that prints it, totals with their running scope, what sits beside or below the table under its total row, no repair errors and the paper named, a 2005 Table, an `.frx` mapped, the name and the notices; since 2026-11-12 a comment skipped where it starts, not inside a CDATA section or a processing instruction |
| `lib/learningLoop` | 12 | the per-person learning loop (2026-11-11, batch LRN2): a kept report teaching the memory and joining the library without its words, once, nothing with learning off, a habit from two reports forgotten on Forget and held back by an undo; the nearest kept report given stripped to a first report only, never someone else's, nothing after Forget, "Laid out like" only when it visibly is; a described report given the person's style from two kept reports. jsdom |
| `lib/learningPipeline` | 22 | the owner's pull and training (2026-11-11, batch LO): paging by cursor, never offset; where the next pull begins, unmoved by a made-up time and a lookback for late syncs; a skeleton rebuilt from its keys, public fonts only, nothing outside the vocabulary; the training set one per skeleton and capped per account, unverified, deleted, mock and undone left out, accounts as pseudonyms; `reconcile`; and the gate: six described cases, the shipped model passing against itself and a damaged one failing |
| `lib/ocrAttach` | 6 | OCR's reading sent with the message (2026-11-11, batch PIPE1): a report of every text read, unsure words marked, nothing from nothing, the reading as the layout the audit checks the AI against, one text per page tied to its upload, and a picture's dpi |
| `lib/pageRows` | 5 | the page's own records read off OCR's grid (2026-11-11, batch CCB): under the fields the report prints, with groups and totals; a column with no heading placed by where it prints; a summary line after a subtotal no record and a record starting "Total" a record; a wrapped description skipped; each value's format |
| `lib/panelReturn` | 4 | where focus goes when Escape closes a side panel (2026-11-11, batch BW): nothing outside the rail, Search projects when it opened Projects, the panel's rail button otherwise, the menu button where the rail is in the closed drawer. jsdom |
| `lib/pdfFromDom` | 13 | PDF with outline drawn from the pane (2026-11-11, batches PXA and PXB): a label's fill and text where the browser put it, a band clipped at the margin, a turned faded watermark as one line, an ancestor's opacity, the Liberation faces fetched or refused in plain words (Arabic named), nothing fetched for standard-font text, clip insets and turns read, and a picture too tall for one canvas cut between controls. jsdom |
| `lib/plainKind` | 7 | a part named in people's words (2026-11-11, batch VO1): each control type, a fully qualified one, an unknown one split into words, never a class name, and bands by kind or own name |
| `lib/printCheck` | 14 | the report printed with the page's records before it is answered (2026-11-11, batch CCB): nothing wrong in a report that prints the page, too many pages, a control past the margin, a bound text printing nothing, a group's field from the page's headings, one group where the page shows several, nothing without records; `findingsToFix`; `fixUntilPrints` asking once and keeping the better answer, stopping when told |
| `lib/projectStore` | 9 | projects kept signed out in IndexedDB `forma-projects` (2026-11-11, batch BW2): the old `savedReports` list moved in once and removed, both kept when an old tab wrote it after the move, a save at the top and a rename in place, one record per save, two saves close together both kept, nothing changed by a failed write, an unlisted project still listed, and `localStorage` where there is no IndexedDB. jsdom, fake-indexeddb |
| `lib/repairChain` | 7 | the one repair order (2026-11-11, batch PIPE2): the passes in the order the generation always ran them, nothing changed beyond the inline passes but the scripts, whole margins and a calculated group field, code the answer carried taken out and the user's kept |
| `lib/repxBlobs` | 5 | embedded data sent as a placeholder (2026-11-11, batch PIPE2): a 300 KB picture restored byte for byte, one placeholder per value across reports, short values left, an unknown placeholder removed, a report told from other text |
| `lib/repxCalculatedFields` | 6 | the calculated-field repair (2026-11-11, batch CCA, CC-04): the group field declared as the expression its header prints, added to a block already there, in the report's own data member as `emit-calc` measured; an unreadable expression, a bare field, a total or an unknown field declined; with no schema a derivation only |
| `lib/repxIntake` | 24 | file intake out of App (2026-11-11, batches PIPE1, FEAT1 and PERF): a template's correction only when the words ask, a long PDF's pages, a PDF page's text placed by its baseline and turn, pictures the AI takes and TIFF's word, a page's reading key, an uploaded `.repx`'s login removed and said, Crystal to its PDF and SSRS opened as a repaired report, and what the page shows the report lacks in words |
| `lib/repxSqlDataSource` | 7 | a redesign's garbled data source (2026-11-11, batches XW and PXB): the old source put back, what pointed at a garbled one moved onto it, other components kept, a sound own source left alone, a garbled one beside it removed; and `detailRegions`, `memberAt`, `resolveMember` |
| `lib/sourceAgreement` | 9 | cases from a loop over the reference pairs; where the report printed against where the page did (2026-11-11, batch CCC): the reference pairs' v2 scored above v1 and sales v1 fitted as the reference was, a report left alone when nothing prints closer; the ink's middle and left edge, the nearest same words within 3 px (150 dpi when unknown), a margin counted twice, a face to measure in |
| `lib/sourceAlign` | 7 | Compare with the original (2026-11-11, batch FEAT1): the ink box, a blank or transparent picture, a speck at the edge ignored, a whole page covering the page, a screenshot fitted by its ink, the fallback at the top left |
| `lib/sqlSchemaStore` | 6 | the database layouts kept on this device (2026-11-11, the full audit): kept and read back newest first, an import again replacing it with its sample rows kept, five at most, one forgotten, a nameless one as "Database", and no IndexedDB failing quietly. fake-indexeddb |
| `lib/totalsCheck` | 8 | totals against the page's figures (2026-11-11, batches CCB and CCC): a percentage summed warned of by caption or field, the message as two sentences, a money margin or rate left alone (`saysRatio`), a total that works out otherwise named, only the right kind warned of, nothing without records, and a total rewritten only to the one form that prints the page |
| `lib/withdraw` | 5 | withdrawing a message undoes its change (2026-11-11, batch BW2): the newest reply with an Undo, nothing for a request that changed nothing, the report's Undo while the change is last so Redo still works, the report put back otherwise, and the requests named in the question |
| `lib/workspaceVoice` | 11 | owner rule 1 over `App.tsx` and the workspace components (2026-11-11, batch VO1, widened by BW and BW2): every reply, revision, error and notice read, the Data tab's and the Preview's own lines included, none naming a part of Forma; the library and the text review saying what they hold; a revision's label in plain words with no count |
| `lib/xlsxLayout` | 8 | an Excel template read into Forma's draft (2026-11-11, batch FEAT1): paper, orientation and margins, the rows above the headings as the header, the headings and record with column widths and no data, a self-closing empty row, null for an empty workbook, and the draft bound to placeholders or headings |
| `lib/xmlEscape` | 6 | XML read and written safely (2026-11-11, batch PXA): the named entities and character references decoded in one pass, a reference to no character left as written, `escapeXmlAttribute` read back, characters XML 1.0 cannot hold dropped, a lone surrogate too |
| `lib/xmlReplace` | 8 | every REPX writer through a replacer function (2026-11-11, batch XW): a `$` pattern typed into a label, a style, a group field, a binding, a total, a SQL default or a connection name written as given |
| `server/ownerScripts` | 14 | the owner's scripts against stand-ins (2026-11-11, batch LO): `pull-learning.ts` learning only from verified accounts and a real AI, resuming, removing what was cleared, not stopped by a made-up time, counting before it reads and refusing a folder inside the repository; `train.ts` emptying what it rebuilds; `gate.ts`; `deploy.mjs` taking the Forma Designer zip only by digest and size; the admin scripts reading the credential, listing orphans and deleting nothing, counting with aggregation and backing up every collection the rules name |
| `server/appRoutes` | 4 | since 2026-11-08 each route rewritten to its own page and a share kept out of search results; which paths are the app's (2026-11-08, site audit items 1 and 52): every route and a shared report, and not an unknown page, a stale chunk, a file or a malformed share; the rewrites firebase.json is derived from |
| `server/bindHost` | 6 |  |
| `server/hostingConfig` | 10 | reads `firebase.json` off disk; since 2026-11-08 the rewrites derived from the routes and every cache rule from staticCache.ts, in order |
| `server/securityHeaders` | 29 | since 2026-11-11 (batch PPUB) the development policy reaching the Auth and Firestore emulators, the production policy unchanged; since 2026-11-05 the microphone the page's own and no frame's |
| `server/staticCache` | 11 | since 2026-11-08 a picture an hour, as firebase.json has it, and the versioned OCR, font and model folders cached for good |
| `services/firebase` | 9 | the account's emails and deletion against a mocked Firebase (2026-11-11, batches SC and SAAS): a reset sent back to sign-in and a verification or address change to the workspace (SA-09), the email still sent when Firebase will not send people to this host and not resent on any other failure; a verification made elsewhere reaching the token (SA-08); and account deletion starting App Check before the database, deleting the user after the data and then what this browser kept for it (SA-25) |
| `services/keyNotInUrl` | 2 | the Gemini key never written into a URL anywhere in `src/services`, and sent to the embedding catalogue as `x-goog-api-key` (2026-11-11, batch SC) |
| `services/chatRetry` | 20 | since 2026-11-10 (batch AG) the Docs articles fenced with the conversation, the docs rule told and a longer answer allowed; since 2026-11-08 (batch K) a turn on an open report end to end: its edits and a redesign's brief as written, the reply typed out without its object, and a cut-off or unreadable answer changing nothing; since 2026-11-07 (batch F) the request a turn sends: instructions in the system part, the report and conversation fenced as data, a picture after them; since 2026-11-07 a retired model looked for again once, where the test pinned giving up at the first 404 |
| `services/compatClient` | 13 | since 2026-11-07 a 400 not about the format asked once, a reasoning model that wrote no answer named, a context too small caught, and the output floor; local AI and OpenRouter in the shape of Gemini's SDK, against a fake OpenAI-compatible server: text and images as chat messages, the response schema as a JSON Schema, the answer read back in Gemini's words (`length` as `MAX_TOKENS`), a server refusing the schema asked for a JSON object then plain text, a streamed answer, a 429 keeping its status, the models offered (OpenRouter's free ones, image readers first), and `compatEndpoint` |
| `services/draftCorrection` | 8 | Forma drafts and the AI corrects, against a stubbed network (2026-11-05): the rules, the draft and the picture sent, not the mega-prompt or OCR's text, thinking at `DRAFT_THINKING_BUDGET` unless the user set one; the report built from the answer; an answer that is no draft refused; a refinement or another unit designing as before; since 2026-11-10 (the AI accuracy programme, batch AD) a report that left out what Forma read asked for once more, naming it, the better answer kept, never a third time, and no second request when the first kept it all |
| `services/embeddings` | 20 | SDK mocked, as `geminiService` is |
| `services/formaVision` | 5 | Forma's vision model through the Local AI endpoint, against a stubbed server: the picture then the instruction at temperature 0, the answer read as a skeleton with its text kept, a page that is not an image refused before asking; the model known by the name it was imported under |
| `services/generationRetry` | 19 | since 2026-11-05 an answer that finishes before its REPX does made again, what it wrote kept once the retries are spent, and the Mockup, the Spec and the title read off the REPX; since 2026-11-04 a retry after a loop asked at temperature 0.4 and the retry of a truncated stream left at 0; since 2026-11-02 also a model out of its daily allowance left for the next, every model out named as a daily limit, and an answer cut off by its thinking asked once more with thinking capped, not when the user set a budget; the generation path's runaway and truncated-stream retries, against a stubbed stream |
| `services/geminiService` | 70 | since 2026-11-11 (batches PIPE2, CCB, CCC and PERF) the request budget shared by the repeats, the stall windows, the forma-blob stash, the print check before answering, and the inspection after the reply; since 2026-11-07 (batch E) the fallback's choice and a JSON answer read tolerantly; since 2026-11-07 (batch D) every new edit, the table rule and the undo tool in the instructions; since 2026-11-07 the papers offered being the edit's own, and the model allowed to say what the outline does not show; since 2026-11-07 the new report, the brief and the memory in the chat's instructions; since 2026-11-05 the report turn's instructions; 7 of these come from one loop; since 2026-11-02 also the chat turn's instructions taking a written description as enough, and `generateSmall` turning thinking off for the small calls, asking a refusing model again with room, and not mistaking a rejected key for a refusal |
| `services/keyVault` | 21 | jsdom |
| `services/library` | 23 | since 2026-11-11 (batch LRN2) the kept reports: stripped as an added file is, never embedded, the newest twenty, by owner, and the nearest one to a first report by shape; storage and embedding injected |
| `services/modelResolution` | 37 | jsdom; since 2026-11-02 also the curated list probed without the catalogue when one of it answers, the choice remembered a day for the same key only, and the small calls sent to a Flash-Lite; since 2026-11-10 that list names no retired Gemini (1.x, 2.0, 2.5) and a page picture asks for high resolution |
| `services/promptToExpression` | 4 | a sentence to an expression, checked against the fields, against a stubbed reply |
| `services/promptToReport` | 8 | description-mode framing, the overlap repair and the clarification call, and Forma's team brief placed ahead of the remembered preferences and the user's words, against a stubbed stream |
| `services/testData` | 4 | AI-generated sample rows, keyed by bound field, against a stubbed reply |

**Total: 4,211 in 252 files**, recounted from a fresh run on 2026-11-12 after the CodeQL
triage added seven cases (two in `sqlSchema`, one each in `repxSqlWriter`, `exportItems`,
`ocrRepx`, `xlsxExport` and `importForeign`) to the 4,204 the run after the full audit's
last merges counted (the re-audit's FIX2A to FIX2D, the docs pass and the cleanup), with
every row above set from that run's per-file counts. That total is the arithmetic sum of
the column above it, which is the point of writing both down. A mismatch between them is the cheapest
possible signal that this table went stale, so adding a case changes **two** numbers
here, not one.

It has worked, late: `reportBands` was recorded as 16 and had been 17 since `183cce5`,
which added a case and bumped only the total. Corrected 2026-09-05 — but the entry sat
wrong for four commits, which is how long a one-file discrepancy can hide when nobody
adds up thirty-nine numbers. The table format is partly a response to that: a column is
easier to sum than a paragraph, and `npx vitest run --reporter=json` will produce the
whole thing for you.

## Recount by running the suite, never by grepping

A grep for `\bit(` answers **3,737 against a real 4,098** (2026-11-11, on `0cec241`), and
will talk you into "correcting" numbers that were already right. The gap is every case a
loop makes beyond the one `it(` that writes it, plus every case the grep cannot see at all
because it is spelled `it.each` or runs under a `describe.each`. On that day it came from
twenty-one files, each marked in the table above as making cases from a loop:
`prerender` (four `it(` once per page under a `describe.each`), `legalDisclosure`,
`publicClaims`, `publicContrast` and `infoPages` (tables of claims, pages and storage
names), `reportPreview` (the parity cases c05, s19, the cross-tabs, s29 and s55, the
table-of-contents placements, drill-down, s57 and right to left), `agentEdit` and
`repxEdit` (tables of edits), `textMeasure` (DevExpress's synthesized-bold measurements),
`repxCrossTabs` (the field shapes DevExpress generated), `formatFromText` (the page's
dates and numbers), `xlsxExport`, `designerBridge` (Windows reserved device names),
`geminiService` (split points), `reportData` (the bands of parity case s17), `attachmentParts`
(malformed data URLs), `Composer` (the conditions that must block a send), `pdfCrypto`,
`analysisResponse` (stop reasons), `MemorySettings` and `sourceAgreement`. The per-file
figures are deliberately not written here: they went stale one by one, and the two
totals are the pair worth comparing.

**The shortfall is a constant, not a coincidence** — every other file adds as many tests
as it has `it(` calls, so both totals move together. **A change in the *gap* is the
signal worth reading**: it means a loop was added or removed, and nothing else does it.
It was 22 when this note was split out (2026-09-06), 99 after parity row 68, 217 on 2026-11-10 and 361 on 2026-11-11, each step a loop or a table genuinely
added. To find which file moved it, compare each file's run count with its grep count:
only the loop files differ.

Two ways the arithmetic goes wrong:

- **The gap can close from the wrong end.** Prose mentioning the vitest call counts as a
  grep hit, so a file discussing this trap inflates the grep instead of deflating it and
  the two errors quietly cancel. `repxBindings.test.ts` deliberately avoids naming the
  call in its own header comment for this reason. This note is not swept by that grep —
  it lives in `docs/` and the pathspec is `src/**/*.test.ts` — but keep the habit.
- **The word boundary is load-bearing.** A bare `it(` also matches `omit(`, which scores
  `repx.test.ts` at 27 instead of 24. Every file outside the loop files has a grep
  count matching this table exactly, but only with `\b`.

## The rules suite, and why the second file is the non-obvious one

`npm run test:rules` runs four files against the Firestore emulator, **118 tests**
(recounted from a fresh run on 2026-11-12, after the full audit's last merges):

| File | Tests | What it proves |
|---|---:|---|
| `tests/firestore.rules.test.ts` | 80 | account isolation, document shape, the key vault, the version subcollection; since 2026-11-06 the shared copies: only the owner writes or lists them, a link share is read by anyone, a restricted one only by the owner and an invitee whose address is **verified**, whatever its letter case; since 2026-11-11 (the full audit) a restricted share's invitees in `shares/{id}/acl/emails`, readable by the owner alone, the learning documents and their fixed lists, the usage counts (at most 1,000 projects, 300 learning events a server day two seconds apart, a verified address, `idsCleared` only at zero projects), and the version slots v0 to v9 |
| `tests/accountDeletion.test.ts` | 25 | deleting an account really removes the reports, **their version history** and the encrypted key; since 2026-11-06 a deleted project takes its shares and a deleted account every share it made; since 2026-11-11 the learning events and the usage document's ids |
| `tests/revisionRoundTrip.test.ts` | 12 | a history saved and read back through the same `saveRevisions` / `loadRevisions` the app calls; since 2026-11-11 (batch LRN2) in the ten slots v0 to v9, older ids moved into slots at the next save |
| `tests/projectDeletes.test.ts` | 1 | two shared projects deleted one after another leave the account's share count at zero (2026-11-11, batch WSX1): side by side, both writes read the same count and the rules let it move by one, so one was left behind |

**The four read the emulator's address from `FIRESTORE_EMULATOR_HOST`** (2026-11-06), which `firebase emulators:exec` sets for the process it starts, and fall back to 8181 as `firebase.json` sets it. **The port was 8080, Firebase's default, until 2026-11-08**, and on the shared server this was written on Windows' HTTP service holds 8080 on every address for another program's `192.168.1.114:8080` registration. A throwaway config naming another port got the suite through by hand, but `scripts/deploy.mjs` runs `npm run test:rules` with the committed config, so a deploy from that machine stopped there with nothing deployed. 8181 is no Firebase emulator's default, and the move is `firebase.json`, the assertion in `hostingConfig.test.ts` and the fallbacks. If 8181 is ever taken too, the throwaway config still works: `npx firebase emulators:exec --config <that file> --only firestore "npx vitest run --config vitest.rules.config.ts"`, deleting the file afterwards.

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
root-level `server/` would silently drop every case in them: the sum of the `server/`
rows in the inventory above, which `npx vitest run src/server` prints. If you ever do move
them, widen that include in the same commit and check the count against the total. (This
paragraph used to carry the sum, "forty-two", which was stale once `hostingConfig`,
`appRoutes` and `ownerScripts` arrived; the rows are where the number lives.)

## A component test's job is what the user is shown, not how it looks

The first two were written after three render defects shipped in one day:

1. a pane that said "cannot be bound yet" immediately after a successful bind;
2. a button styled with a modifier class that does not exist;
3. JSX dropping the space before a word.

**Only the first is a component test's business** — it is state logic, and there is a
test that fails if the ordering is restored. The second and third are what looking at a
screenshot is for, which is why the `run-forma` skill exists alongside these tests and
not instead of them.

## What `npm run test:coverage` measures, and the two zeroes that are not gaps

The number it prints is scoped on purpose. `vitest.config.ts` includes only
`src/lib/**`, `src/services/**` and `src/server/**` — `App.tsx` and the components are
**not** in the denominator, because counting code that cannot be unit-tested until
`App.tsx` is broken up would move the figure for reasons unrelated to whether anything got
safer. Do not "fix" that by widening the include list; **raise the number by shrinking
`App.tsx`**, which is what `workspaceView` and `attachmentBudget` were. **Since 2026-11-11
(the full audit, TC-11) the number is enforced**: the `thresholds` block fails the run
under its floors, CI's unit step is this command, and the config's comment says how the
floors were set and when one may move.

**Zeroes in the report are not always untested paths.** `src/lib/accountData.ts` reads 0%
because everything exercising it lives in `tests/accountDeletion.test.ts`, which runs
under the *other* config against the emulator and is not in this run at all.
`src/services/firebase.ts` read 0% as the Firebase singleton until
`services/firebase.test.ts` (2026-11-11) exercised its account helpers against a mocked
SDK; read the report rather than this sentence for what it scores now.

The config says all of this at the point of use; read the comment there before changing
the block.

## Running one file, and what that does not buy you

Run a single test file with `npx vitest run src/lib/repx.test.ts`, or a single case with
`-t "<name>"`. **Narrowing to one file buys clarity first.** When the suite was
fifty-two files (re-measured 2026-08-20) the first `npm test` of a session took 52s and the
very next one 4.6s, while a single file was ~5s either way, so warm, one file and all of
them cost about the same. The suite is several times that size now, so a warm full run
takes noticeably longer than one file; no timing is written here, because each one went
stale or was measured cold.

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
