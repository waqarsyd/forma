# DevExpress parity: measured behaviour and comparison

Status: proposal, 2026-10-30. Phases 1 to 3 of the owner's parity programme are done, and **the owner approved every row of the comparison table at the end on 2026-10-30**, to be built one row at a time starting with row 1. When an approved row is built and proven, its reasoning moves into the note that owns its area and the row here is marked done.

## Method

Clean-room. Nothing here comes from DevExpress source, decompiled binaries or copied documentation text. Every statement in the spec section is a measurement of what DevExpress 20.1, the version installed on the development machine, actually printed for a report Forma's own harness wrote.

- **Ground truth.** `RepxProbe render <case-dir>` was added for this work. It loads a case's `report.repx` with `LoadLayoutFromXml`, binds `data.json` as a `DataSet`, lays the report out with `CreateDocument()` and writes `render.json`. That file holds every brick on every page: its rectangle, the control that produced it and its resolved style. The command then exports PDF, XLSX, DOCX, RTF, CSV, PNG and HTML. The culture is pinned to en-US so currency and dates read the same on any machine. See the RepxProbe [README](../../tools/RepxProbe/README.md).
- **Reading the output.** PDFs were read with the `pdfjs-dist` already in Forma's dependencies, for text positions, fonts, outline and link annotations, plus a raw scan for embedded font programs. XLSX and DOCX files were unzipped and their XML read directly. REA's artifact inspector confirmed the Excel package's container integrity; it does not interpret spreadsheet contents, so cell-level findings rest on the direct read.
- **Forma's side.** The same `report.repx` went through `parseReportStructure` and `paginate` from `src/lib/reportPreview.ts`, which is what the Preview pane and its PDF export draw.
- **Units.** Bricks are in 1/300 inch. Every figure below is converted to the report's unit, hundredths of an inch, on a Letter page of 850 by 1100.

Not measured: DevExpress versions above 20.1; subreports; charts and cross-tabs over real data; conditional formatting at print time; and Forma's printed PDF, which was assessed from its code path rather than rendered.

## Cases

| Case | What it isolates |
|---|---|
| c01-geometry | Margins, alignment, fonts, borders, colours, padding, a hidden control, a style sheet, table cell weights. No data. |
| c02-text | A growing label, `WordWrap=false`, `CanGrow=false`, `CanShrink`, a control below a growing one, a record crossing a page break. 30 rows. |
| c02k-keep | c02 with `KeepTogether=true` on the Detail band. |
| c03-table | A table row whose middle cell wraps. |
| c04-pages | Report and page headers and footers over 100 rows; a grand total with and without `Running`; two page-number kinds. |
| c04b-printon | c04 with `PrintOn` on both page bands and `PrintAtBottom` on the report footer. |
| c04e-empty | c04 over an empty data source. |
| c05-groups | Group by Region with `RepeatEveryPage`, a descending sort, subtotal, count, running sum, calculated field, date and money formats, bookmarks. 90 rows. |
| c05b-keepgroup | c05 with `GroupUnion=WholePage`. |
| c05c-pagebreak | c05 with `PageBreak=AfterBand` on the group footer. |
| c05d-orphan | A group header that fits at the foot of a page while its first record does not. |
| c05e-union | c05d with `GroupUnion=WithFirstDetail`. |
| c06-master-detail | A `DetailReportBand` over a relation, including masters with no lines. |
| c07-filter | `FilterString="[Region] = ?Region"`, default North, rendered with South supplied. |
| c08-links | `NavigateUrl`, literal and bound, through PDF, Excel, Word and HTML. |
| c09-large | 10,000 rows: layout time, page count, export time and size. |
| c10-summary | Aggregate cells with no `Summary` element, with `Running="Group"` and with `Running="Report"`, in a group footer and a report footer. |

## How DevExpress 20.1 behaves

### Layout precision

- Band content starts at the left and top margins. With `Margins="60, 40, 50, 50"` a control at band position 0,0 printed at page position 60,50, and the printable width was 750, which is 850 less both side margins.
- Text sits exactly on the control's edge. Default label padding is zero, so left-aligned text began at the control's left edge and right-aligned text ended at its right edge, to the hundredth of a point in the PDF. Centred text was centred on the control's midpoint.
- A border is drawn inside the control's rectangle, and padding sits inside the border. A 2px border plus 10 units of padding put the text 8.7pt in from the control's edge: 7.2pt of padding and 1.5pt of border.
- Table cells divide the row by `Weight`. Weights 1, 2 and 1 over 750 gave 187.5, 375 and 187.5. Cells inherit the table's font.
- Table borders are not doubled. With `Borders="All"` on a table, the first cell drew all four sides and each later cell drew only top, right and bottom, so a shared edge prints once.
- A control with `Visible="false"` produces no output at all.

### Appearance and styles

- `ForeColor`, `BackColor`, `BorderColor`, `BorderWidth` and `Padding` all reach the printed page as written.
- **A style beats the control's own attribute.** A control carrying `StyleName="Heading"` and its own `Font="Arial, 8pt"` printed in the style's 16pt bold, and a `ForeColor="Red"` beside a style's colour printed in the style's colour. The control's value wins only for a property the style does not set, or when the control carries a `<StylePriority UseFont="false" />` child element for that property; printed that way, the red and a 20pt font both won. The dotted attribute `StylePriority.UseFont="false"` is ignored.
- A style's `Sides`, `Font`, `ForeColor`, `BackColor`, `TextAlignment`, `Padding` and `BorderColor` all applied. A style's `BorderWidth="2"` did not: the border printed 1 wide. Forma's style lift already leaves `BorderWidth` on the control, which this confirms is right.
- Each `StylePriority` flag works under its property's name as a child element: `UseFont`, `UseForeColor`, `UseBackColor`, `UseTextAlignment`, `UsePadding`, `UseBorders` and `UseBorderColor` all handed the property back to the control.
- Appearance inherits all the way down. A Detail label with nothing of its own printed in the report's font and colour. A band's font, borders, padding, alignment and fill reached its controls. A table's style reached its cells, fill and sides included, and a cell's own style overrode only what it set.
- An `XRPanel`'s own `ForeColor` is dropped, with or without a style on the panel, so its children print in the band's colour. A child's own `ForeColor` still applies.
- With no font set anywhere, 20.1 printed Times New Roman 9.75pt.

### Text handling

- **Text grows by default.** A 300-wide label at 9pt grew from 20 to 45.2 units for 120 characters, to 102.7 for about 330 and to 117.1 for 380.
- A control below a growing one moves down by the same amount. The label at y=25 printed at 25 plus the growth.
- The band grows with its content. A 50-unit Detail band printed 75.2, 152.7 and 167.1 tall for those three records.
- `WordWrap="false"` kept the label one line high and clipped the text. `CanGrow="false"` kept the label 20 high and clipped.
- `CanShrink="true"` with empty text shrank the control to 0. With one line of text it shrank to 16, which is that line's height.
- A table row takes its tallest cell's height, and every cell in the row is drawn at that height, so the borders stay aligned. The same 330-character note made a row 75 tall in a 450-wide cell.

### Pagination

- With fixed heights, records per page matched simple arithmetic: c04 printed 26, 31, 31 and 12 records on four pages.
- **By default a record that will not fit is split at a line boundary.** In c02, record C0023's first lines printed at the foot of page 2 and the rest of its note continued at the top of page 3, with the controls below it pushed after the continuation.
- With `KeepTogether="true"` on the Detail band, the same record moved to page 3 whole.
- The 30 growing records of c02 needed 3 pages, at 11, 12 and 7 records per page. The growing table in c03 needed 2 pages, at 22 and 8.

### Headers and footers

- On page 1 the report header prints above the page header.
- `PrintOn="NotWithReportHeader"` on the page header removed it from page 1, which then held 27 records instead of 26.
- `PrintOn="NotWithReportFooter"` on the page footer removed it from the page carrying the report footer.
- `PrintAtBottom="true"` placed the report footer at the bottom of the last page instead of directly after the last record.
- The page footer prints at the same position on every page, directly above the bottom margin.
- Page numbers follow their kind and format: `NumberOfTotal` with `Page {0} of {1}` printed "Page 1 of 4", and `RomLowNumber` printed "i", "ii" and so on.

### Grouping, sorting and totals

- Groups print in ascending order of the group field, whatever order the data arrived in.
- `SortFields` on the Detail band sorts within each group; a descending sort on Customer was honoured.
- `RepeatEveryPage="true"` reprinted the group header at the top of each page the group continued onto.
- `GroupUnion="WholePage"` moved a group that did not fit in the remaining space to the next page whole, so c05b printed one group per page.
- `PageBreak="AfterBand"` on the group footer started a new page after every group, including the last, so the grand total printed alone on page 4.
- **Orphan control.** By default a group header that fits at the foot of a page prints there even when its first record does not fit, leaving the header alone at the bottom. `GroupUnion="WithFirstDetail"` moved the header to the next page with its first record.
- Subtotals, counts, a running sum, a calculated field and the grand total all matched the data to the cent.
- **An aggregate needs a `Summary` element.** `sumSum([Amount])` with no `<Summary>` printed blank, in a group footer and in the report footer alike. `Running="Group"` printed each group's total. `Running="Report"` printed the whole report's total, in a group footer too. `Running="Group"` in the report footer printed "?".
- `sumRunningSum` with `Running="Report"` accumulated across group boundaries.

### Master-detail

- A `DetailReportBand` prints its own bands after each master record: its header, the related rows and its footer, whose `Running="Report"` total is that master's own total.
- A master with no related rows still printed the detail header, one blank detail line and the detail footer.

### Filtering and parameters

- A `FilterString` that compares a field with a parameter filters the rows, and the parameter's supplied value wins over its default. With South supplied, 37 South rows printed, and the parameter's value printed in the header.

### Empty data

- With an empty data source the Detail band printed once, blank. Totals printed blank, not zero. Every header and footer still printed on the single page.

### Export fidelity

- **PDF.** Version 1.4. Every font is embedded as a subset with a Unicode map, so text can be selected and searched. Bookmarks become the PDF outline, nested under the report's name. Literal and bound `NavigateUrl` both become link annotations.
- **Excel.** A single sheet that reproduces the layout: column boundaries come from control edges, and merged cells span controls wider than one column. c05's 99 rows needed 373 merges. Numbers and dates stay numbers and dates, with the report's format string converted to an Excel number format. A literal prefix such as `Total {0:c2}` becomes part of that format, and `{0:dd MMM yyyy}` becomes `dd MMM yyyy`. Page headers and footers appear once, not once per page. Hyperlinks are kept. Asking for a data-aware export changed nothing in 20.1: the file was the same as the default.
- **Word.** Every control becomes an absolutely positioned frame, with one section per page. Even an `XRTable` is not a Word table. Links are kept as `HYPERLINK` fields.
- **CSV.** One line per row of the layout, holding the formatted text: "$1,001.07" with its quotes, not 1001.07.
- **Image and HTML.** A PNG of a Letter page at 96 dpi was 818 by 1058 pixels. The HTML export carries the link targets.

### Performance

| 10,000 rows | Result |
|---|---|
| Layout | 2.3 s for 213 pages at 47 rows per page |
| PDF | 2.2 s, 667 kB |
| XLSX | 1.3 s, 453 kB, one sheet of 10,003 rows |
| CSV | 0.3 s, 329 kB |
| DOCX | 1.3 s, 388 kB, 213 sections |

### Documented by DevExpress, not measured here

Subreports that embed another report; charts and cross-tabs drawn from data; conditional formatting rules; a table of contents; drill-down and interactive sorting in the viewer; report merging; PDF/A, password and signature options; per-page or per-file Excel export modes; right-to-left layout. These are listed so the comparison does not imply they were checked.

## Where Forma differs

Forma's Preview has no data source unless the Test data button supplies up to twenty rows, so the comparison is of structure, geometry and pagination over the same record count.

| Case | DevExpress | Forma | Difference |
|---|---|---|---|
| c01 | Every control at its band position plus the 60-unit left margin | Every control 60 units further left | Left margin ignored |
| c01 | Styled controls in the style's 16pt bold navy with a bottom border | 9pt regular, no border; the override control in its own 8pt | Style sheet not read, and no style priority |
| c01 | Hidden control absent; colours, padding and 2px red border drawn | Hidden control drawn; no colour, no padding, every border 1px black | Visibility and appearance ignored |
| c02 | 3 pages: 11, 12, 7 records | 2 pages: 19, 11 | No growth, no split |
| c03 | 2 pages: 22, 8 rows | 1 page: 30 rows | No row growth; cells clip with an ellipsis |
| c04 | 26, 31, 31, 12 | 26, 31, 31, 12 | Identical |
| c04 | "Page 1 of 4", "i" | "1 / 4" for both | Page-number kind and format ignored |
| c04b | 27, 31, 31, 11; no page footer on page 4; footer at page bottom | 26, 31, 31, 12, everything printed | `PrintOn` and `PrintAtBottom` ignored |
| c04e | Detail once, blank | No Detail band | Empty-data rule differs |
| c05 | 38, 38, 12 with three groups and repeated headers | 41, 42, 7 with one group | No data-driven groups |
| c05b, c05c, c05d, c05e | Groups moved, broken and kept with their first record as set | Same as c05 | `GroupUnion` and `PageBreak` ignored |
| c06 | Header, lines and total under every order, on 2 pages | Orders only, on 1 page | Detail report not drawn |
| c07 | 37 filtered rows on 1 page | 90 rows on 3 pages | No filter |
| c09 | 213 pages | 50 pages, the rest cut with a message | Page cap |
| c10 | Blank where no `Summary` | Not evaluated | Shows the cell's literal text |

## Comparison and recommendations

Rows marked **Fix** correct something Forma does wrong. **Adopt** brings in DevExpress behaviour Forma lacks. **Keep** leaves a Forma-only feature alone. Nothing existing is removed by any row.

| # | Feature | In Forma | In DevExpress | Forma status | Which behaves better and why | Recommendation |
|---|---|---|---|---|---|---|
| 1 | Totals written by the Data tab | Yes | Yes | **Done 2026-10-30** | DevExpress, and the defect was Forma's: totals were written with no `Summary` element and printed blank | Done: the writer adds the scope and a money format, `repairSummaries` scopes model output in group and report footers, the audit reports the rest, the prompt is corrected. Printed through DevExpress afterwards: `$6,081.03` where there was a blank. See gemini.md, the section on a total with no running scope |
| 2 | Style priority in Forma's docs | Yes | Yes | **Done 2026-10-30** | DevExpress is the definition; the style lift was safe, but its comment said a control's attribute wins | Done: corrected in `repxStyles.ts`, its tests, both READMEs and gemini.md, with the `StylePriority` child element measured; a test now states the invariant that actually makes the lift safe |
| 3 | Style sheet in Preview | Yes | Yes | **Done 2026-10-30** | DevExpress: 23 of 33 controls in a real generated invoice previewed in the wrong font | Done: `resolveAppearance` applies style, `StylePriority`, own value and inheritance in the order DevExpress printed; cells carry their own font and alignment; the default font is DevExpress's. Colours and padding are resolved and wait on row 6 to be drawn |
| 4 | Margins and printable width in Preview | Yes | Yes | Broken | DevExpress: Forma draws everything left by the left margin | Fix: offset by the left margin; printable width is page less both margins, multi-column included |
| 5 | Hidden controls | Yes | Yes | Broken | DevExpress | Fix: skip `Visible="false"` |
| 6 | Colour, fill, padding, border width and colour, shared table borders | No | Yes | Missing | DevExpress: Forma's PDF loses visible formatting | Adopt |
| 7 | Text growth, push-down, band growth, row growth, shrink | No | Yes | Missing | DevExpress: page breaks fall in the wrong place for any report with long text | Adopt, measuring text in the browser; expect small line-break differences from DevExpress's own font metrics |
| 8 | Splitting a record across pages, and keep-together | No | Yes | Missing | DevExpress | Adopt with 7 |
| 9 | `PrintOn` and `PrintAtBottom` | No | Yes | Missing | DevExpress | Adopt |
| 10 | Groups from data, repeated headers, `GroupUnion`, `PageBreak` | Partial | Yes | One group drawn | DevExpress | Adopt over test data |
| 11 | Sorting, filtering, entering a parameter value | Written to file only | Yes | Not previewed | DevExpress | Adopt over test data, with a value field per parameter |
| 12 | Totals, running sums, calculated fields, format strings in Preview | Written to file only | Yes | Literal text shown | DevExpress | Adopt: evaluate the aggregate and arithmetic subset Forma writes, and apply `TextFormatString` |
| 13 | Empty data source | Yes | Yes | Differs | DevExpress: printing the Detail band once shows the report's shape | Adopt |
| 14 | Master-detail | Written by hand only | Yes | Broken in Preview | DevExpress | Adopt |
| 15 | Page numbers | Partial | Yes | Always "n / N" | DevExpress | Fix: honour the kind and the format string |
| 16 | Long reports | 50-page cap | 213 pages in 2.3 s | Partial | DevExpress for length; Forma's pagination itself is fast, at 2,703 pages in 9.5 ms | Adopt: render pages on demand and lift the cap |
| 17 | PDF links | No | Yes | Missing | DevExpress | Adopt: draw `NavigateUrl` as a real link, which the browser's PDF keeps |
| 18 | PDF outline from bookmarks | No | Yes | Missing | DevExpress | Candidate: printing from the browser cannot add one, so this needs Forma's own PDF writer; defer |
| 19 | Excel export | No | Yes | Missing | DevExpress | Candidate: one sheet, real numbers and dates, merged cells; Forma's existing zip writer makes it possible without a dependency |
| 20 | CSV export | No | Yes | Missing | DevExpress | Candidate: one line per layout row of formatted text; cheap once 12 exists |
| 21 | Word, RTF, image and HTML export | No | Yes | Missing | DevExpress, but Forma's users open the file in DevExpress, which exports it there | Do not adopt now |
| 22 | Subreports, charts and cross-tabs from data, conditional formatting | Partial | Yes | Not measured | Unknown until measured | Measure first with `render`, then decide |
| 23 | AI generation, Prompt-to-Report, Prompt-to-Expression, test data | Yes | Newer versions have AI features | Works | Forma for 20.1 users, who have none of these | Keep |
| 24 | Audit, accessibility checks, layout checks, overlap repair | Yes | The designer's analyzer | Works | Comparable; Forma's runs on every generation | Keep, and add the check in row 1 |
| 25 | Revisions, batch, designer companion, version targeting | Yes | No | Works | Forma only | Keep |

Rows 1 to 5 and 15 are fixes to behaviour Forma already claims. Rows 6 to 14 and 16 to 17 make the Preview a faithful picture of what DevExpress prints. Rows 18 to 22 are separate decisions.

## Reproducing

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\MSBuild\Current\Bin\MSBuild.exe" `
    tools\RepxProbe\RepxProbe.csproj /p:Configuration=Release
tools\RepxProbe\bin\Release\RepxProbe.exe render <case-dir> <out-dir>
```

The case generator and the analyser that produced these numbers were written for this session and are not yet in the repository. Step 5 of the programme, the automated comparison, is where they belong: the DevExpress output becomes committed expected values that the unit suite checks Forma's Preview against, since CI cannot run DevExpress.
