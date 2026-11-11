# The AI report designers, compared (2026-11-10)

Item 28 of the owner's AI accuracy programme (batch AH): the leading report
designers' AI features, captured from their public demos with REA where a demo
exists and read from their documentation where none does, set feature by
feature beside Forma. A dated record, not live documentation: these products
move every quarter. What is a gap for Forma is listed at the end as candidates
for the owner to choose from; none is built by this record.

## How it was captured

REA's `capture_browser_scenario` launched its own browser, loaded each public
demo page, waited for it to settle and kept the page's accessibility tree, no
login, no cookies accepted and nothing submitted, so no vendor's AI was asked
anything on Forma's behalf. Three captures:

| Page | What it showed | REA evidence |
|---|---|---|
| demos.devexpress.com/blazor/AIPoweredExtensions/AIReportDesigner | DevExpress Reporting 26.1.6, the Web Report Designer with four AI features listed and the designer drawn (a Test Data button beside Preview) | `ev_3434de19d51c` |
| demos.telerik.com/reporting/ai-insights | Telerik Reporting's viewer with an AI prompt button over a report's data | `ev_7ba820700017` |
| demos.telerik.com/reporting/ai-report-generator | Telerik's Web Report Designer with a Sparkles button on the canvas and an "AI description" property on items | `ev_c9aaf77059d6` |

Stimulsoft, ActiveReports (MESCIUS) and Bold Reports were searched for a public
demo of an AI report designer and none was found; what they offer is read from
their own release notes, linked below, and marked so.

## Feature by feature

| | Forma | DevExpress 26.1 | Telerik 2026 Q3 | Stimulsoft 2026.2 | ActiveReports v20 |
|---|---|---|---|---|---|
| A report from a description | Yes, in the chat, with clarifying questions | Yes: Prompt-to-Report in the report wizard, a preview (CTP), with predefined prompts, with or without a data source | Charts and gauges; tables, crosstabs and lists since 2026 Q3 | Dashboards, in the BI designer, not paginated reports (release notes) | A command-line report builder an AI agent drives, .rdlx (docs) |
| A report from a picture, scan or PDF | Yes: OCR in the browser, Forma's box reader, the AI correcting the draft | Not seen | Not seen | Not seen | Image to report, 2026 (release news) |
| A chat that edits the open report | Yes, in place, with Undo, a plan for heavy jobs | Planned: an AI chat assistant on the v26.1 roadmap | Edits the chart or gauge it made | An assistant for dashboards | No |
| An expression from a sentence | Yes | Yes, in the expression and filter editors | Not seen | Not seen | Not seen |
| Test data for the preview | Yes | Yes: "Smart Preview with AI-generated Data" | Not seen | Data generated from a sentence (release notes) | Not seen |
| Translation of a report | No | Yes: "Localize with AI" in the localization editor | Not seen | Not seen | Not seen |
| Questions about a report's data | No: Forma answers about its structure (batch AG) | A separate Report Viewer AI demo, listed in the demo menu and not captured | Yes: AI Insights in the viewer, predefined and own prompts, consent asked first | Not seen | Explore: visualizations suggested from field names (release notes) |
| What is sent to the AI | The picture and what OCR read; a database only when shared, names and sample values | The prompt and the report, to the customer's own AI | Schemas, not business data (docs) | Not stated | Field names and types, never the data (release notes) |
| Which AI, and its cost | Free: the user's Gemini key, a local AI or OpenRouter's free models, and Forma's own model with none | The customer's Azure OpenAI or OpenAI ("bring your own key", no built-in model), with a subscription | A built-in or custom AI client, with a licence or trial | A licence | A licence and the customer's AI |
| When the AI reaches its limit | The next free AI the user set up, then Forma's own draft (batch AF) | Not documented; the demo warns it is rate-limited | Not documented | Not documented | Not documented |
| Answers about the product itself | Yes, from Forma's own docs (batch AG) | No | A documentation MCP server for coding assistants | No | AI agent tools for developers |

## What it says about Forma

**Where Forma is ahead, and should stay:** a report from a picture of the old
one, which only ActiveReports has begun; a chat that edits in place, which
DevExpress has only planned; free use with a fallback when a limit is reached,
which no vendor documents; and the answers grounded in the report's own facts
and Forma's own documentation.

**Gaps, as candidates for the owner** (not built here; each would be its own
item with its own measurement):
1. ~~**Translating a report** into another language~~ **Built the same day**,
   as the chat's `translate` tool (`src/lib/repxTranslate.ts`): every typed
   caption sent once, the texts put back, the layout untouched, as a revision
   beside the original rather than DevExpress's per-language
   `LocalizationItems`. Those were measured with `RepxProbe emit-localize`
   and built on 2026-11-11 (the full audit's CP-06): a report can carry a
   second language, with a Language switch on the Preview; see *A report in
   two languages* in [`docs/notes/gemini.md`](../notes/gemini.md).
2. ~~**Questions about the report's data in the Preview**~~ **Built the same
   day** (`src/lib/previewRows.ts`): a question about the data is held while
   Forma asks in the thread whether the Preview's rows may go, with how many
   and which fields; sent, the reply says so. Live rows never go.
3. ~~**An AI description on a control**~~ **Built the same day**: *Describe
   for the AI* in the control's menu on the Preview, the chat's `describe`
   edit writing `AccessibleDescription`, and the outline showing it, so
   "the tax line" finds the control described as the tax line.

## Addendum, 2026-11-11: four rows were wrong, and so was "ahead"

The next day's full audit read each vendor's own pages again (its competitors part, CP-10)
and found this record wrong in four places, each in Forma's favour. The table above is left
as written, so the record shows what was believed; these are the corrections:

- **DevExpress, a report from a description** (the first row): on the 26.1 WinForms and Web
  pages Prompt-to-Report is no longer labelled a preview (CTP); it runs as "a structured
  agentic workflow composed of specialized agents" and asks clarifying questions.
- **DevExpress, a chat that edits the open report** (the third row): not planned but
  shipping, in the WinForms designer, as "Modify Reports" (CTP since 25.1, .NET 8 and
  later): bands and controls added and removed, properties changed, binding, grouping,
  sorting and filtering, margins and paper, with `FixLayoutErrors` and three retries. The
  Web and WPF chat assistant was postponed to v26.2 (December 2026).
- **Telerik, the same row**: the 2026 Q3 AI Report Generator creates and edits tables,
  crosstabs and lists (groups and aggregates included) besides charts and gauges, with an
  inline "Undo Changes".
- **Stimulsoft, both rows**: reports, not only dashboards, from a single text request since
  2025 (lists, grouped, master-detail), and since 2026.3 a built-in assistant that edits
  reports in the Standalone Designer and checks expressions.

**Where Forma is ahead, restated.** Not "a chat that edits in place", which DevExpress ships
in one designer and Telerik and Stimulsoft in theirs. What no vendor offers together:
**in a browser**, with nothing to install; **free**, on the user's own free key, a local AI
or OpenRouter's free models, with the next one taking over at a limit; **from a picture**
of the old report, a scan or a PDF (ActiveReports' "Image to Report" alone comes close, and
it needs Azure Document Intelligence credentials); **for older versions**, DevExpress 20.1
included, where DevExpress's own AI features begin at 24.2 and need a subscription; and
**with Undo** on every change the chat makes, as one history with the Preview's own edits.

**One more candidate, recorded rather than built** (CP-16): a shared report is a read-only
copy, while Google Stitch and Claude now share for working together. The free first step
would be letting a viewer duplicate a shared report into their own projects. The audit
recommends it for later, starting there; it is the owner's to choose (decision 23 of that
audit).

## Sources

DevExpress: the captured demo; [Prompt-to-Report in the Web Report Designer](https://docs.devexpress.com/XtraReports/405485/ai-powered-functionality/web-reporting/prompt-to-report-in-web-report-designer);
[Reporting roadmap, June 2026 (v26.1)](https://community.devexpress.com/Blogs/reporting/archive/2026/02/23/reporting-amp-bi-dashboard-june-2026-roadmap-v26-1.aspx).
Telerik: the two captured demos; [AI Report Generator in the Web Report Designer](https://www.telerik.com/products/reporting/documentation/wrd-user-guide/wrd-genai-usage).
Stimulsoft: [Reports and Dashboards 2026.2 released](https://www.stimulsoft.com/en/blog/news/stimulsoft-reports-and-dashboards-2026-2-has-been-released).
ActiveReports: [Report Builder CLI](https://developer.mescius.com/activereportsnet/docs/developers/ai-agent-tools/report-builder-cli);
[Turn images into editable reports](https://www.componentsource.com/ko/news/2026/02/24/turn-images-editable-reports) (ComponentSource, 2026-02-24).
Bold Reports: [MCP server](https://help.boldreports.com/mcp-server/), a documentation assistant for coding tools; no AI report designer found.
