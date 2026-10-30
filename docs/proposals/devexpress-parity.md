# DevExpress parity: measured behaviour and comparison

Status: proposal, 2026-10-30. Phases 1 to 3 of the owner's parity programme are done, and **the owner approved every row of the comparison table at the end on 2026-10-30**, to be built one row at a time starting with row 1. When an approved row is built and proven, its reasoning moves into the note that owns its area and the row here is marked done. **By the end of 2026-10-30:** rows 1 to 17, 19 and 20 are built. Rows 18 and 21 were approved as "defer" and "do not adopt now", and row 22 has been measured. Rows 26 to 29, proposed after the table, were approved the same day; rows 26, 27 and 29 are built and row 28 has been measured. Rows 30 to 32, proposed from that measurement, were approved the same day: rows 30 and 31 are built, and row 32 was approved as "do not adopt". Row 33, found while building row 30, was approved on 2026-10-31 and is built.

## Method

Clean-room. Nothing here comes from DevExpress source, decompiled binaries or copied documentation text. Every statement in the spec section is a measurement of what DevExpress 20.1, the version installed on the development machine, actually printed for a report Forma's own harness wrote.

- **Ground truth.** `RepxProbe render <case-dir>` was added for this work. It loads a case's `report.repx` with `LoadLayoutFromXml`, binds `data.json` as a `DataSet`, lays the report out with `CreateDocument()` and writes `render.json`. That file holds every brick on every page: its rectangle, the control that produced it and its resolved style. The command then exports PDF, XLSX, DOCX, RTF, CSV, PNG and HTML. The culture is pinned to en-US so currency and dates read the same on any machine. See the RepxProbe [README](../../tools/RepxProbe/README.md).
- **Reading the output.** PDFs were read with the `pdfjs-dist` already in Forma's dependencies, for text positions, fonts, outline and link annotations, plus a raw scan for embedded font programs. XLSX and DOCX files were unzipped and their XML read directly. REA's artifact inspector confirmed the Excel package's container integrity; it does not interpret spreadsheet contents, so cell-level findings rest on the direct read.
- **Forma's side.** The same `report.repx` went through `parseReportStructure` and `paginate` from `src/lib/reportPreview.ts`, which is what the Preview pane and its PDF export draw.
- **Units.** Bricks are in 1/300 inch. Every figure below is converted to the report's unit, hundredths of an inch, on a Letter page of 850 by 1100.

Not measured at first: DevExpress versions above 20.1; subreports; charts and cross-tabs over real data; conditional formatting at print time; and Forma's printed PDF, which was assessed from its code path rather than rendered. Rows 22 and 28 measured the subreports, the formatting, the charts and the cross-tabs afterwards, in cases s22 and s23.

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
| s15-formats | Twenty number formats over twelve decimal and double values chosen for sign, zero and midpoint rounding, and six over twelve integers. |
| s16-exprs | Forty-four expressions over six typed records, a calculated field, and eleven report totals. |
| s17-scopes | Every summary scope, a running sum, a record number and a bound field in every band, over 50 records in three groups on three pages. |
| s17b-nogroup | s17 without the group bands. |
| s18-invoice | An invoice as Forma writes one: a bound table, a calculated line total, money formats, a page total and a grand total, over 40 records with wrapping text. |
| s19a to s19g | Two nested group headers and their footers over twelve records, with `Level` in either order, with none, with only the outer one, and with a single footer. |
| s20-pfgap | A page footer whose only label sits 40 units down or at its top, to see whether content may use the empty part of the band. |
| s21-empty | Every kind of text in every band over a data source filtered to nothing: literals, fields, expressions, and each aggregate in each scope. |
| s22a-rules | Five formatting rules over six records: a colour and bold, a fill, a hide, a band-level fill, and two rules setting the same property on one label. |
| s22b-subreport | An embedded subreport taller than its control in the master's Detail band, a label beside it, and a second subreport in the report footer. |
| s23-data | A bar-and-line chart, a pie and a cross-tab of Amount by Region and Quarter in the report header, over twelve records. The controls are what the serializer wrote for `RepxProbe emit-chart`. |
| s23-gen and variants | s23 with the cross-tab's layout generated by DevExpress, then without its cells, without its row definitions, at its designed size, and with no column field or no data field. |
| s23 shapes | `GenerateLayout()` for 24 field shapes from 0-0-0 to 3-3-1, and for two shapes in each report unit. |
| s23 ct cases | Ten cross-tabs written as the prompt teaches, over 24 records, in all three units: each printed unrepaired, after Forma's repair, and with DevExpress's own generated layout. |
| s24-dpi | One label one inch down and two wide, in a millimetre and a pixel report, with `Dpi` written nowhere, on the root only, or on every band and control. |
| s25-crosstab | Two cross-tabs of Amount by Region and Quarter over nine records: regions differing only in case, a missing region, integer quarters, decimal amounts, an empty intersection and one whose only record has no amount. The second carries its own font, colours, borders, padding and alignment. |
| s26-origin | One label at 50,20, exported to Excel, to see where the sheet starts. |
| s27 | A report holding every kind of band and control, saved by DevExpress in tenths of a millimetre and pixels; and the s18 invoice converted to each by DevExpress, with every `Dpi` stripped, printed unrepaired and repaired. |

## How DevExpress 20.1 behaves

### Layout precision

- Band content starts at the left and top margins. With `Margins="60, 40, 50, 50"` a control at band position 0,0 printed at page position 60,50, and the printable width was 750, which is 850 less both side margins.
- A control past the printable width is clipped at the right margin, and the clipped part prints on an extra page. That held both for one reaching only into the margin and for one past the page edge; each made a one-page report two pages.
- A `<MultiColumn>` with no `Mode` prints one column. `UseColumnCount` divides the printable width: two columns with 20 spacing over 750 put the second at 385. `UseColumnWidth` keeps the declared width and fits as many as the printable width holds: 200 wide with 20 spacing gave three, at 0, 220 and 440.
- Text sits exactly on the control's edge. Default label padding is zero, so left-aligned text began at the control's left edge and right-aligned text ended at its right edge, to the hundredth of a point in the PDF. Centred text was centred on the control's midpoint.
- A border is drawn inside the control's rectangle, and padding sits inside the border. A 2px border plus 10 units of padding put the text 8.7pt in from the control's edge: 7.2pt of padding and 1.5pt of border.
- Table cells divide the row by `Weight`. Weights 1, 2 and 1 over 750 gave 187.5, 375 and 187.5. Cells inherit the table's font.
- Table borders are not doubled. With `Borders="All"` on a table, the first cell drew all four sides and each later cell drew only top, right and bottom, so a shared edge prints once. Between rows the same holds: on a two-by-two table the lower cells dropped their tops. A cell drops an edge its left or upper neighbour already draws, and the shared edge prints in the neighbour's style. A cell writing its own red, 3-wide left border beside a neighbour drawing `Right` printed no border of its own.
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
- **The height formula, measured over nine fonts:** the lines, times a line spacing that is a fixed ratio of the font size, plus 1.5pt, plus vertical padding and top and bottom borders. The ratios: Arial and Times New Roman 1.15, Verdana 1.2153, Tahoma 1.207, Segoe UI 1.33, Calibri 1.221, Georgia 1.1363, Courier New 1.1328; bold does not change it. A shrinking control uses 1.17pt instead of 1.5pt.
- Lines break greedily at spaces and also after a hyphen ("cut-" then "off,"), and a line exactly as wide as the area does not fit. A browser canvas following those rules broke all 18 printed texts identically.
- A fixed-height record that only partly fits is split between its controls: the top label stayed, and the label below continued at the top of the next page at its own gap below the cut.

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
- Page numbers follow their kind and format: `NumberOfTotal` with `Page {0} of {1}` printed "Page 1 of 4", and `RomLowNumber` printed "i", "ii" and so on. With no format, `NumberOfTotal` prints `1/2` with no spaces, `Total` prints `2`, `RomHiNumber` `I`, and `DateTime` the long date, `Friday, October 30, 2026`. A file with no `PageInfo` prints as `NumberOfTotal`. `None` prints nothing, even with `Text` set. `StartPageNumber="5"` numbered pages 1 and 2 as 5 and 6.

### Grouping, sorting and totals

- Groups print in ascending order of the group field, whatever order the data arrived in.
- `SortFields` on the Detail band sorts within each group; a descending sort on Customer was honoured.
- `RepeatEveryPage="true"` reprinted the group header at the top of each page the group continued onto.
- `GroupUnion="WholePage"` moved a group that did not fit in the remaining space to the next page whole, so c05b printed one group per page.
- `PageBreak="AfterBand"` on the group footer started a new page after every group, including the last, so the grand total printed alone on page 4.
- **Orphan control.** By default a group header that fits at the foot of a page prints there even when its first record does not fit, leaving the header alone at the bottom. `GroupUnion="WithFirstDetail"` moved the header to the next page with its first record.
- **Nesting follows `Level`** (s19). The higher level is the outer group whatever the file order. A missing `Level` is 0, and between equal levels the later band is outer. A group footer closes the group whose header declares its level.
- **A label stays on its page when its text line fits above the break, even if its box does not.** In c05 and c05d, records C0052 and C0088 printed at the foot of page 1 with their boxes 1 and 5 units into the page footer's band. The rest of their band carried to the next page, pushing its first record down by 3 and 7 units. In s20 a label whose line did not fit moved whole, and the page footer's empty top was never used.
- Subtotals, counts, a running sum, a calculated field and the grand total all matched the data to the cent.
- **An aggregate needs a `Summary` element.** `sumSum([Amount])` with no `<Summary>` printed blank, in a group footer and in the report footer alike. `Running="Group"` printed each group's total. `Running="Report"` printed the whole report's total, in a group footer too. `Running="Group"` in the report footer printed "?".
- `sumRunningSum` with `Running="Report"` accumulated across group boundaries.
- **A total is the whole scope's wherever it prints** (s17). `sumSum` with `Running="Group"` printed the group's total on every Detail record and in the group header, before the group's records. `Running="Page"` printed the whole page's total in the page header.
- **A page is every record with any part on it.** A record split across a break counted on both pages, and every part of it read the page it finished on: the part of record 21 left on page 1 printed page 2's total, and its part on page 2 numbered itself 1 there.
- **A running summary runs to the end of its band's extent.** In Detail it runs through the current record. In a group header or footer it runs through the group's last record, in a page header or footer through the page's, and in the report header or footer through the report's. So `sumRunningSum` in a group header printed the group's full total.
- **A bound field reads the extent's first record in a header and its last in a footer.** `[Qty]` printed 1, 16 and 36 in the three group headers and 15, 35 and 50 in the footers.
- `Running="Group"` prints "?" in the report and page bands, with or without a format string. With no group bands it prints "?" in Detail too (s17b). A summary with no `Running` printed nothing everywhere.
- A null value printed nothing, even inside a format string such as `Total: {0:c2}`.

### Expressions and formats

- **Arithmetic follows .NET types.** Integers divide by truncating: `[Qty] / 4` printed 0, 1 and 2. Decimals keep their scale: 8 times 0.5 printed `4.0`, and six prices summed to `163.323` exactly. A decimal division that does not end runs to 28 places, or fewer when the digits would not fit: 12.5 / 3 printed `4.1666666666666666666666666667`. A literal with a decimal point is a double, so `[Qty] / 4.0` printed 0.25.
- `Round` rounds half to even: `Round(2.5)` printed 2 and `Round(-2.5)` printed -2. `Substring` counts from 0. Booleans print `True` and `False`, and `+` with a string on either side concatenates. A field the data does not have prints nothing.
- **Format strings round half away from zero.** 2.345 with `{0:c}` printed `$2.35` and 2.5 with `{0:c0}` printed `$3`. Decimal and double values printed identically.
- Currency negatives are bracketed: `($1,234.50)`. `p` multiplies by 100 and groups thousands. `e2` writes a three-digit exponent, `1.23e+003`. `x` writes a negative integer in 32-bit two's complement. A custom format's sections apply to positive, negative and zero values.

### Master-detail

- A `DetailReportBand` prints its own bands after each master record: its header, the related rows and its footer, whose `Running="Report"` total is that master's own total.
- A master with no related rows still printed the detail header, one blank detail line and the detail footer.

### Filtering and parameters

- A `FilterString` that compares a field with a parameter filters the rows, and the parameter's supplied value wins over its default. With South supplied, 37 South rows printed, and the parameter's value printed in the header.

### Empty data

- With an empty data source the Detail band printed once, blank. Totals printed blank, not zero. Every header and footer still printed on the single page.
- In more detail (s21, a filter that matched nothing): a literal label printed its text, and a missing field joined to text printed the text. `sumCount`, `sumDCount` and `sumRecordNumber` printed 0. `sumSum`, `sumAvg`, `sumMax` and `sumRunningSum` printed nothing, except a sum with `Running="Page"`, which printed 0. The group header and footer printed once.

### Export fidelity

- **PDF.** Version 1.4. Every font is embedded as a subset with a Unicode map, so text can be selected and searched. Bookmarks become the PDF outline, nested under the report's name. Literal and bound `NavigateUrl` both become link annotations.
- **Excel.** A single sheet that reproduces the layout: column boundaries come from control edges, and merged cells span controls wider than one column. c05's 99 rows needed 373 merges. Numbers and dates stay numbers and dates, with the report's format string converted to an Excel number format. A literal prefix such as `Total {0:c2}` becomes part of that format, and `{0:dd MMM yyyy}` becomes `dd MMM yyyy`. Page headers and footers appear once, not once per page. Hyperlinks are kept. Asking for a data-aware export changed nothing in 20.1: the file was the same as the default.
- **Word.** Every control becomes an absolutely positioned frame, with one section per page. Even an `XRTable` is not a Word table. Links are kept as `HYPERLINK` fields.
- **CSV.** One line per row of the layout, holding the formatted text: "$1,001.07" with its quotes, not 1001.07. In full: the report is laid out as one continuous page, so the page header and footer appear once and nothing breaks, and `PrintOn`, `PrintAtBottom` and `PageBreak` change nothing (c04b and c05c exported the same files as c04 and c05). There is a line for every distinct control top and a column for every distinct left edge across the report, cells included. Fields are quoted only when they need it, lines end CRLF, and there is no byte-order mark.
- **Image and HTML.** A PNG of a Letter page at 96 dpi was 818 by 1058 pixels. The HTML export carries the link targets.

### Performance

| 10,000 rows | Result |
|---|---|
| Layout | 2.3 s for 213 pages at 47 rows per page |
| PDF | 2.2 s, 667 kB |
| XLSX | 1.3 s, 453 kB, one sheet of 10,003 rows |
| CSV | 0.3 s, 329 kB |
| DOCX | 1.3 s, 388 kB, 213 sections |

### Conditional formatting and subreports (measured for row 22)

- **A formatting rule applies per record.** In s22a a label linked to "High" (`[Amount] > 500`, red and bold) printed red and bold on exactly the records over 500.
- **Two rules setting one property: the later link wins, and properties merge.** "High" then "Blue" both held for 600, and the label printed blue *and* bold.
- **A rule with `Visible="False"` removes the control for that record.** The record with 0 printed no amount brick, and its band kept its height.
- **A rule linked to the band reaches its controls through inheritance.** "Shade" on the Detail band gave every label on the shaded records its fill, with the label's own rules still applying on top.
- **An embedded subreport prints its whole report at the control's place, once per master record.** In s22b each of three records printed the inner report's header and its Detail band once, since that report has no data. The report footer's subreport printed once.
- **The control grows to the inner report's height, and the band with it**, by the same rule as growing text: the 50-unit Detail band printed 87 tall, which is 50 + 85 − 48. A label beside the subreport stayed where it was.
- Not measured: a subreport with its own data source or parameter bindings. `RepxProbe render` binds data to the master report and, since row 28, to charts and cross-tabs.

### Charts and cross-tabs over data (measured for row 28)

`RepxProbe render` now hands a chart or a cross-tab the report's data when it has none of its own, as an application binding the report does. It also writes each chart's plotted points into `render.json`.

- **A cross-tab written as its three field lists alone cannot be printed.** That is what the serializer writes for `emit-chart` and what Forma's prompt teaches. In s23-data, `CreateDocument()` threw "The number of columns in the generated layout does not match the number of items in the ColumnDefinitions collection", and it threw the same way with no data. Loading succeeds and keeps the fields, which is all `RepxProbe inspect` and the 2026-09-05 measurement checked.
- **A printable cross-tab carries the layout DevExpress generates from its fields.** That is a `<ColumnDefinitions>` of empty items, a `<RowDefinitions>` of items with `Height="25"`, and a `<Cells>` of `XRCrossTabCell` items. Each cell carries `ColumnIndex` and `RowIndex`, and some carry `RowSpan` or `ColumnSpan`. The texts are the row fields' names in the header, `Grand Total`, and the data fields' names when there are two or more. A subtotal header has `TextFormatString="Total {0}"`. Generating the layout also resized the control to 100 by 25 per cell. A file without the cells threw "No cell found at the following indexes", and one without the row definitions threw the row-count version of the first error.
- **The counts follow from the field counts alone**, across fourteen shapes from no fields of a kind up to three row fields and two data fields. With R row, C column and D data fields, and D taken as at least 1:
  - there are max(R, 1) + D × (C + 1) columns when C ≥ 1, else max(R, 1) + D;
  - there are max(C, 1) rows, plus 1 when D ≥ 2, plus 1, plus R.
  
  Where the spans fall is recorded per shape in the measurement, not reduced to a formula.
- **What it prints, for one field of each kind:** a header row with the row field's name, each column value in ascending order and `Grand Total`. Below it come one row per row value, ascending, then `Grand Total`. Each intersection holds the sum, unformatted (`100`, `7820`), with the row totals on the right and the column totals along the bottom. The CSV holds that grid and nothing from the charts.
- **The cross-tab grows by whole cells.** Designed at 300 by 75, it printed 600 by 125, and the pie chart below it moved down by the same 50, from 540 to 590.
- **Cells share out the control's own size.** At 600 by 200 with three columns and three rows, every cell printed 200 by 66.7 units, and the six columns ran past the page. DevExpress continued the grid on a second page, repeating the row-header column.
- **A missing collection still prints.** With no column field DevExpress printed each region's total. With no data field it printed the grid of regions and quarters with empty cells. So the audit's `crosstab-missing-fields` warning and the prompt's sentence that such a cross-tab "prints nothing" are wrong.
- **A chart prints as one picture at the control's size, with no text and nothing in the CSV.** Its points are one per record, in record order, as the data holds them, not aggregated: the bar series over Region had twelve points for three regions.

### A cross-tab's values (measured for row 31)

- **Order.** A missing value comes first, then text by en-US collation, then numbers by value: the regions printed blank, a, apple, Apple, b, B, Z, and the quarters 1, 2, 10. Text groups by exact value, so b and B are two rows.
- **Intersections.** Each holds the sum of its records' values in the data's own type, unformatted, keeping a decimal's scale: 109.1, 2.25, 118.60. It is blank where no record falls, and 0 where records fall but none has a value.
- **Appearance.** Every cell printed in DevExpress's default Times New Roman 9.75pt, black, top left, with no padding, fill or border. That held in a report whose font was Arial 8pt, and in a cross-tab that set its own font, colours, borders, padding and alignment: none of them reached a cell.
- **Missing fields.** With no row field, one row of column totals under an empty header. With no column field, one column of row totals under an empty header. With no data field, the full grid with every value cell empty.
- **The workbook.** Values are typed: quarters are numbers, regions text with Excel's text format, captions General. Empty cells are absent. **The sheet starts at the content's top-left corner, not at the first control.** In s26 a label at 50,20 sat in B2, after a half-inch column and a 20-unit row, and s23's cross-tab at y=10 came after a 10-unit row. Every earlier case had a control at both edges, which is why row 19 never saw it.

### Report units and Dpi (measured while building row 30)

- **Every band and control is read at its own `Dpi`, 100 when absent, whatever `ReportUnit` says.** In s24 a label meant to sit one inch down and two inches wide printed 2.54 inches down and 5.08 wide in a millimetre report with no `Dpi` written, and 0.96 down and 1.92 wide in a pixel one. `Dpi` on the root alone changed nothing for the label. Written on the bands and controls too, as DevExpress's serializer writes it, the label printed at one inch.
- **The root's margins follow the same rule.** With no `Dpi` anywhere, margins of 254 tenths of a millimetre printed as 2.54 inches, on paper of the right size.
- **DevExpress 20.1's `ReportUnit` has three members:** `HundredthsOfAnInch`, `TenthsOfAMillimeter` and `Pixels`. `Document`, which `reportGeometry.ts` carries, is not one of them in 20.1.
- Forma wrote `Dpi` nowhere, so its millimetre and pixel reports printed at the wrong scale in DevExpress while looking right in its own panes. Row 33 below fixes it.
- **Where the serializer writes `Dpi`** (s27): on the root, every band, including sub-bands and detail reports, and every control. That covered 17 kinds, table rows and cells and cross-tab cells included. Never on styles, rules, parameters, calculated fields, field items, definitions, chart internals or the watermark. An embedded subreport's report keeps its own unit, and `Padding` carries its own dpi as its fifth value.
- **The s18 invoice, converted by DevExpress to tenths of a millimetre with every `Dpi` stripped**, printed on nine pages where the original prints on two. With `Dpi` written back on those elements it printed the original's 261 boxes exactly. In pixels it printed exactly what DevExpress's own pixel conversion prints. That sits 2/300 of an inch off the hundredths original at the page footer, because the conversion rounds a 22-unit band to 21.12 pixels.

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
| 4 | Margins and printable width in Preview | Yes | Yes | **Done 2026-10-30** | DevExpress: Forma drew everything left by the left margin | Done: bands start at the left margin across the printable width and clip at the right margin; columns follow `Mode`, including the measured one-column default and `UseColumnWidth`; overflow past the margin is reported as DevExpress's extra page, in the Preview and the audit |
| 5 | Hidden controls | Yes | Yes | **Done 2026-10-30** | DevExpress: Forma drew them | Done: hidden controls and the contents of a hidden panel are kept for editing but not drawn, and the overlap and layout checks skip them |
| 6 | Colour, fill, padding, border width and colour, shared table borders | No | Yes | **Done 2026-10-30** | DevExpress: Forma's PDF lost visible formatting | Done: every resolved colour, fill, padding and border is drawn; table cells share edges by DevExpress's measured rule; a render test checks the pane against what DevExpress printed. Dashed borders are not drawn, since nothing measured them |
| 7 | Text growth, push-down, band growth, row growth, shrink | No | Yes | **Done 2026-10-30** | DevExpress: page breaks fell in the wrong place for any report with long text | Done: `layoutBand` and `textMeasure.ts`. The browser canvas broke 18 of 18 printed texts identically, and the app's engine in Edge placed 190 records of four printed reports on DevExpress's pages to a tenth of a unit. Multi-column records and panels do not grow yet |
| 8 | Splitting a record across pages, and keep-together | No | Yes | **Done 2026-10-30** | DevExpress | Done with 7: `splitInstance` splits at lines, rows and controls, reproducing DevExpress's split positions exactly; `KeepTogether` moves the record whole |
| 9 | `PrintOn` and `PrintAtBottom` | No | Yes | **Done 2026-10-30** | DevExpress | Done: page headers and footers skip the report header's or footer's page as flagged, the freed room is used, and `PrintAtBottom` puts the report footer at the foot of its page. The c04b case reproduces exactly. A page header marked `NotWithReportFooter` still prints, unmeasured |
| 10 | Groups from data, repeated headers, `GroupUnion`, `PageBreak` | Partial | Yes | **Done 2026-10-30** | DevExpress | Done: records are sorted by the group fields and Detail's `SortFields`, each level breaks into runs, and headers and footers print per group with `RepeatEveryPage`, both `GroupUnion` modes and every `PageBreak` mode. Nesting follows `Level` as s19 measured, and a label whose line fits stays at the foot of its page. c05 to c05e, s17 and s19 match DevExpress's PDF page for page, in Node and in Edge. Without test data the Preview still draws one group, now repeated where `RepeatEveryPage` says |
| 11 | Sorting, filtering, entering a parameter value | Written to file only | Yes | **Done 2026-10-30** | DevExpress | Done: sorting came with row 10. The report's `FilterString` keeps only the records it is true for, reading the parameters' values. Over test data each parameter above the paper takes a value, and that value wins over the file's default, as c07 printed. c07 matches DevExpress's PDF, and typing South in Edge turned 25 North records into its 37 South ones. A multi-value parameter takes one value, and a filter that will not parse is reported and ignored |
| 12 | Totals, running sums, calculated fields, format strings in Preview | Written to file only | Yes | **Done 2026-10-30** | DevExpress | Done: `criteria.ts` evaluates DevExpress's expression language with .NET types, `netDecimal.ts` carries decimals, `netFormat.ts` formats numbers, and `reportData.ts` gives each band its scope as s17 measured. Every expression in s16, every format in s15 and every scope in s17 matches what DevExpress printed. In Edge, all 175 texts of s18 matched on the same pages. Group scopes became real groups with row 10 |
| 13 | Empty data source | Yes | Yes | **Done 2026-10-30** | DevExpress: printing the Detail band once shows the report's shape | Done: an empty row set is an empty data source. The Detail band prints once with every group band around it, and counts, record numbers and a page sum print 0 while other totals print nothing, as s21 measured. c04e and all 23 controls of s21 match DevExpress. No test data still means the layout's own record count |
| 14 | Master-detail | Written by hand only | Yes | **Done 2026-10-30** | DevExpress | Done: a `DetailReportBand` is read as a report of its own and printed after each master record, with its groups, one Detail per related row and its footer, its totals running over that master's rows. Related rows come from a relation lookup. The Preview's flat test data has none, so it shows each master as DevExpress prints one with no lines, and says so. c06 matches DevExpress page for page given the relation. Nested controls are drawn and bounds-checked but not editable, and a detail report inside a detail report is not drawn |
| 15 | Page numbers | Partial | Yes | **Done 2026-10-30** | DevExpress: Forma drew "n / N" for every kind | Done: all eight kinds, their formats, the absent-kind default and `StartPageNumber`, through a new `netFormat.ts` that row 12 extends to values |
| 16 | Long reports | 50-page cap | 213 pages in 2.3 s | **Done 2026-10-30** | DevExpress for length; Forma's pagination itself is fast, at 2,703 pages in 9.5 ms | Done: `paginate` has no cap unless a caller asks, and the pane fills in only the pages within two of the viewport, every frame kept at full size. c09's 10,000 records lay out in 240 ms with the text evaluated, and all 213 pages match DevExpress's PDF, 40,853 texts. In Edge the first page painted in about half a second, with 5 to 8 pages drawn at a time. The printed copy draws every page |
| 17 | PDF links | No | Yes | **Done 2026-10-30** | DevExpress | Done: a label's `NavigateUrl`, literal or bound and evaluated over the test data, is drawn as an anchor in the label's own colour and decoration, so underline and strikeout are now read too. Only http, https and mailto become links. Edge's printed PDF of c08 carried the same 24 link annotations, in the same order, as DevExpress's. Links on table cells and other control types are not drawn yet |
| 18 | PDF outline from bookmarks | No | Yes | Missing | DevExpress | Candidate: printing from the browser cannot add one, so this needs Forma's own PDF writer; defer |
| 19 | Excel export | No | Yes | **Done 2026-10-30** | DevExpress | Done: Export XLSX. `xlsxExport.ts` writes one sheet from the continuous layout. Column and row boundaries sit at control edges, sized from pixel-rounded positions, and a merge spans each wide control. Values are numbers and date serials with the format string converted, every cell has its font, colour and alignment, and links are kept, all through the existing zip writer. All thirteen workbooks DevExpress exported, c09's 40,007 cells and 20,005 merges included, come out cell for cell the same. The growing cases need the browser's measurer, which the pane passes. The files open in DevExpress's own spreadsheet engine and display what DevExpress printed. Borders are not written |
| 20 | CSV export | No | Yes | **Done 2026-10-30** | DevExpress | Done: Export CSV beside Export PDF. `csvExport.ts` lays the report out on one continuous page, with page settings neutral as DevExpress's export showed. It writes a line per distinct top and a column per distinct left edge, holding the printed text. All thirteen cases DevExpress exported come out byte for byte the same, c09's 10,003 lines included |
| 21 | Word, RTF, image and HTML export | No | Yes | Missing | DevExpress, but Forma's users open the file in DevExpress, which exports it there | Do not adopt now |
| 22 | Subreports, charts and cross-tabs from data, conditional formatting | Partial | Yes | **Measured 2026-10-30** | DevExpress | Measured: conditional formatting and embedded subreports, in s22a and s22b. Charts and cross-tabs over data needed probe support first, and row 28 measured them. The decisions are rows 26 to 29 below, all approved |
| 23 | AI generation, Prompt-to-Report, Prompt-to-Expression, test data | Yes | Newer versions have AI features | Works | Forma for 20.1 users, who have none of these | Keep |
| 24 | Audit, accessibility checks, layout checks, overlap repair | Yes | The designer's analyzer | Works | Comparable; Forma's runs on every generation | Keep, and add the check in row 1 |
| 25 | Revisions, batch, designer companion, version targeting | Yes | No | Works | Forma only | Keep |

**Proposed after row 22's measurements and row 10's finding, and approved by the owner on 2026-10-30, to be built one at a time from row 26.**

| # | Feature | In Forma | In DevExpress | Forma status | Which behaves better and why | Recommendation |
|---|---|---|---|---|---|---|
| 26 | Conditional formatting in the Preview | Written to file only | Yes | **Done 2026-10-30** | DevExpress: Forma's prompt writes formatting rules, and the Preview drew every record as if none fired | Done: the rule sheet and every band's, control's and cell's links are read. Each linked rule is evaluated per record over the test data, later links win property by property, and `Visible="False"` drops the control. A band's rule reaches only the properties a control inherits, past any a panel, table or row sets. All six records of s22a print what DevExpress printed. The changed appearance reaches growth, drawing and both exports |
| 27 | Embedded subreports in the Preview | Kept from uploads only | Yes | **Done 2026-10-30** | DevExpress: the inner report prints in full and grows its control and band | Done: an embedded `ReportSource` is parsed as a report of its own and laid out once, without page bands or margins. It is drawn inside the control, which grows to its height, the band with it. Every text of s22b lands where DevExpress placed it, and the CSV and workbook carry its lines as DevExpress's did. A `ReportSourceUrl` stays a labelled box, and the pane names the file. A subreport with its own data waits for that to be measured |
| 28 | Charts and cross-tabs over test data | Structure only | Yes | **Measured 2026-10-30** | DevExpress, and the measurement found a defect in Forma's files | Measured in s23. `RepxProbe render` now gives both controls their data and records a chart's points. The decisions are rows 30 to 32 below, waiting for approval |
| 29 | Nested groups without `Level` | Written outer-first | Nests later-outer | **Done 2026-10-30** | DevExpress decides, and a generated nested grouping comes out inverted (s19c) | Done: the prompt's grouping section asks for `Level`, outermost highest, and says why. `repairGroupLevels` numbers the headers from the top when no group band declares a level, writing it only above 0 as the designer does. A footer goes with the group it names in its text or a binding, and otherwise in the order footers print, innermost first. That is the one refinement on what was approved, because file order says nothing about which group a footer closes. Repaired, s19c prints the nesting DevExpress printed for the levelled file |

**Proposed after row 28's measurements, and approved by the owner on 2026-10-30, to be built one at a time from row 30.**

| # | Feature | In Forma | In DevExpress | Forma status | Which behaves better and why | Recommendation |
|---|---|---|---|---|---|---|
| 30 | A cross-tab DevExpress can print | Fields only | Generates definitions and cells | **Done 2026-10-30** | DevExpress, and the defect was Forma's: every cross-tab Forma wrote threw when DevExpress printed it | Done: `repairCrossTabs` writes the layout `crossTabLayout` generates, which matched every cell of all 24 shapes DevExpress generated, ten of them unseen when the rule was written. Cells are one inch by a quarter inch in the control's own `Dpi`, measured in all three units. Ten prompt-shaped cross-tabs that threw now print box for box what DevExpress's own layout prints, with an identical CSV. The audit's `crosstab-no-layout` error reports one without the layout, `crosstab-missing-fields` now fires only for a missing data field, and the prompt asks for fields only and always a data field |
| 31 | A cross-tab's values over test data | Field names only | Prints the grid of sums | **Done 2026-10-30** | DevExpress | Done for up to one field of each kind. The Preview draws the grid from the test rows before the report's filter, with order, blanks, zeros, sums and appearance as s25 printed. The control grows by whole cells and pushes what is below, and the CSV and workbook carry the grid. s25 and the four one-field-per-kind cases match DevExpress cell for cell in the pane and the CSV, and in the workbook in Edge. Doing so found and fixed the workbook's origin, an omission from row 19. Nested fields, two data fields, a grid wider than the page, a summary setting and styled cells keep the structure drawing |
| 32 | A chart's values over test data | Frame, and the binding in words | A picture of one point per record | Structure only | Neither: no export can be compared with a picture, and drawing it means a charting engine in the Preview | **Not adopted, as approved 2026-10-30**: the frame and the binding in words stay. The measured points are recorded above for when this is reconsidered |

**Proposed while building row 30, and approved by the owner on 2026-10-31.**

| # | Feature | In Forma | In DevExpress | Forma status | Which behaves better and why | Recommendation |
|---|---|---|---|---|---|---|
| 33 | `Dpi` in millimetre and pixel reports | Never written | Reads each band and control at its own `Dpi`, 100 when absent | **Done 2026-10-31** | DevExpress defines the format, and the defect was Forma's: 2.54 times too large in millimetres, 4% too small in pixels (s24) | Done: `repairDpi` writes the report's `Dpi` on exactly the elements DevExpress's serializer writes it on, measured from a report holding every kind, and leaves the numbers alone. Stripped of `Dpi`, DevExpress's own files come back with the same elements and values. The s18 invoice as Forma would write it in millimetres went from nine pages to the original's two, every box in place, and s24's label sat at one inch |

Rows 1 to 5 and 15 are fixes to behaviour Forma already claims. Rows 6 to 14 and 16 to 17 make the Preview a faithful picture of what DevExpress prints. Rows 18 to 22 are separate decisions.

## Reproducing

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\MSBuild\Current\Bin\MSBuild.exe" `
    tools\RepxProbe\RepxProbe.csproj /p:Configuration=Release
tools\RepxProbe\bin\Release\RepxProbe.exe render <case-dir> <out-dir>
```

The case generator and the analyser that produced these numbers were written for this session and are not yet in the repository. Step 5 of the programme, the automated comparison, is where they belong: the DevExpress output becomes committed expected values that the unit suite checks Forma's Preview against, since CI cannot run DevExpress. Row 12 began that: the printed values of s15, s16, s17 and s17b are written into `netFormat.test.ts`, `criteria.test.ts`, `reportData.test.ts` and `reportPreview.test.ts` as literals. Row 10 added c05 to c05e, read from the PDFs DevExpress exported, and s17 and s19.

**The brick dump can miss what prints.** In c05 DevExpress's PDF has records C0052 and C0034 at the foot of their pages, while `render.json` has no brick for either. A record whose box crosses into the page footer appears to be stored where the dump does not reach. Read the PDF before concluding DevExpress dropped something.
