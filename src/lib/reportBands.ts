/**
 * The REPX band structure the prompt asks the model to produce.
 *
 * ## What changed on 2026-09-03, and why there are still two shapes
 *
 * Until 2026-09-01 the prompt hard-coded exactly three bands — a zero-height
 * TopMargin, ONE DetailBand at the full page height, and a zero-height
 * BottomMargin — and every control went into that single band. It is a good
 * choice for the thing it was optimising: with one band starting at the paper's
 * top-left and `Margins="0,0,0,0"`, band-relative coordinates and page
 * coordinates are the same numbers, so the model cannot get the frame wrong.
 * Measured on a live run, that produces a genuinely faithful picture: 103
 * controls, 0 out of bounds, 0 overlapping, and a designer check on 2026-09-03
 * confirmed it matches its source image.
 *
 * It also produces something that is not a report. In DevExpress a `DetailBand`
 * prints **once per record**, so a Detail band the height of the page means
 * binding a data source makes the whole page repeat per row. There is no
 * `ReportHeader` to print a title once, no `PageHeader` to repeat column
 * headings across pages, and no `ReportFooter` for totals — the table arrives as
 * a static `XRTable` with every row hard-coded.
 *
 * `banded` is the only shape now: reproducing a picture was never the goal, and
 * a file that cannot take a data source fails at the one thing a `.repx` is for.
 *
 * **`flat` and its `VITE_FORMA_FLAT` flag were removed on 2026-09-05, and not
 * for the reason this comment used to give.** The plan was to keep it until the
 * banded shape had its own designer verdict — that verdict still has not
 * happened, and it stopped being the deciding question. Grouping, parameters,
 * charts, cross-tabs and summaries were all added to the banded branch and to
 * nothing else, so by the time anyone reached for the flag it would no longer
 * have produced the old report: it would have produced a report missing every
 * feature added since 2026-09-03, silently, at the moment someone was already
 * troubleshooting. A fallback that has rotted is worse than none, because it
 * looks like a way back.
 *
 * `git show 696ac75:src/lib/reportBands.ts` has the flat text if it is ever
 * wanted, and it is the version to read rather than reconstructing one.
 *
 * ## The part that will break first
 *
 * Coordinates. `flat` can tell the model "do NOT subtract anything" because the
 * only band starts at y=0. With stacked bands, each band's origin is its own top
 * edge, so a control 400 units down the page sitting in a band that starts at
 * 320 must be written as `LocationFloat="x,80"`. That subtraction is exactly the
 * class of error `src/lib/reportGeometry.ts` exists to contain — it renders a
 * plausible layout in the wrong place and never throws. The banded prompt
 * therefore spends most of its length on that one rule. Measured on the
 * 2026-09-01 A/B: zero controls fell outside their band, so the model does
 * perform the subtraction when told to.
 *
 * ## Two things elsewhere depend on this text
 *
 * - `src/lib/repxMargins.ts` declines with *"margin bands are missing"* if the
 *   document has no `TopMarginBand` and `BottomMarginBand`. The banded prompt
 *   invites the model to omit bands it has no content for, so it has to say
 *   explicitly that those two are never omitted, or the margin lift silently
 *   stops happening. The same lift declines with *"the first body band carries
 *   no controls"*, which the flat shape could never hit and this one can: an
 *   emitted-but-empty `ReportHeader` turns the margin lift off. That decline is
 *   correct — whitespace held as band height is a different edit — so the
 *   defence is the instruction to omit a band rather than emit it empty.
 * - The layout JSON keeps EVERY data row while the Detail band keeps one. That
 *   divergence is deliberate — the mockup is a picture of the source and the
 *   REPX is a bindable report — and both halves of it are stated in the prompt,
 *   because the rest of the prompt insists the two artifacts agree.
 */

/** Page geometry in the report's own units, as `pageSizeInUnits` returns it. */
export interface PageBox {
  width: number;
  height: number;
}

export interface RootStructureOptions {
  page: PageBox;
  reportUnit: string;
  targetVersion: string;
  targetSerializerVersion: string;
}

/**
 * The default: a real report skeleton instead of one page-sized band.
 *
 * Band order is not stylistic — XtraReports reads the sequence, and a
 * `PageHeaderBand` written after `Detail` is a different report. The order below
 * is the one the designer itself emits.
 */
function bandedRootStructure({ page, reportUnit, targetVersion, targetSerializerVersion }: RootStructureOptions): string {
  return `
          - ROOT STRUCTURE — A BANDED REPORT, NOT ONE PAGE-SIZED BAND.
            You are producing a real DevExpress report, so the page is split into bands that each play a different role at print time. Emit ONLY the content bands the design actually needs; omit any you have no content for, but keep the ones you emit in exactly this order. TopMargin and BottomMargin are NOT optional — always emit both, always at HeightF="0".

            <?xml version="1.0" encoding="utf-8"?>
            <XtraReportsLayoutSerializer SerializerVersion="${targetSerializerVersion}" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" ReportUnit="${reportUnit}" Margins="0, 0, 0, 0" PageWidth="${page.width}" PageHeight="${page.height}" Version="${targetVersion}">
              <Bands>
                <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="0" />
                <Item2 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="...">
                  <Controls><!-- printed ONCE, at the very start --></Controls>
                </Item2>
                <Item3 Ref="3" ControlType="PageHeaderBand" Name="PageHeader" HeightF="...">
                  <Controls><!-- repeated at the top of EVERY page --></Controls>
                </Item3>
                <Item4 Ref="4" ControlType="GroupHeaderBand" Name="GroupHeader" HeightF="..." RepeatEveryPage="true">
                  <GroupFields>
                    <Item1 Ref="5" FieldName="Region" />
                  </GroupFields>
                  <Controls><!-- printed once BEFORE each group. OMIT THIS BAND unless the design is grouped -- see GROUPING below. --></Controls>
                </Item4>
                <Item5 Ref="6" ControlType="DetailBand" Name="Detail" HeightF="...">
                  <Controls><!-- ONE repeating record. See DETAIL BAND below. --></Controls>
                </Item5>
                <Item6 Ref="7" ControlType="GroupFooterBand" Name="GroupFooter" HeightF="...">
                  <Controls><!-- printed once AFTER each group -- the per-group subtotal --></Controls>
                </Item6>
                <Item7 Ref="8" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="...">
                  <Controls><!-- printed ONCE, after the last record --></Controls>
                </Item7>
                <Item8 Ref="9" ControlType="PageFooterBand" Name="PageFooter" HeightF="...">
                  <Controls><!-- repeated at the bottom of EVERY page --></Controls>
                </Item8>
                <Item9 Ref="10" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="0" />
              </Bands>
            </XtraReportsLayoutSerializer>

          - WHICH BAND EACH PIECE OF THE DESIGN BELONGS IN.
            Decide this from what the content *is*, not from where it sits on the page:
            - ReportHeader — the document title, the issuing company, the invoice/report number, dates, and the "bill to"/"ship to"/"terms" blocks. Anything that identifies this one document and would be wrong to print twice.
            - PageHeader — the COLUMN HEADING ROW of the main table, and any running title. This repeats, so a reader on page 3 still knows what each column means.
            - Detail — exactly ONE row of the repeating data. See below; this is the band most often got wrong.
            - GroupHeader / GroupFooter — ONLY when the rows break into runs by a shared value with something printed at each break. See GROUPING below for the visible test; if the design shows no such break, omit both bands.
            - ReportFooter — the GRAND total, tax and sign-off blocks, terms paragraphs that close the document. A total that repeats partway down the page is a GROUP footer, not this one.
            - PageFooter — page numbers (XRPageInfo), the registration line, anything repeated at the foot of every sheet.
            WHETHER THE DESIGN HAS REPEATING ROWS IS A TEST, NOT A JUDGEMENT CALL. Apply it before you decide:
            **a heading row with two or more rows of like-kind values aligned under the same columns IS repeating data**, and that block belongs in Detail as ONE row. Nothing else about the document changes that.
            - A form can, and usually does, contain repeating data. A job card, a worksheet, a delivery note and a service report are all forms whose middle is a grid of operations or items — that grid is the repeating data, and the fixed boxes around it are the ReportHeader. "It is a form" is NOT a reason to leave Detail out.
            - Ask it of the ROWS, not of the page. A single-record letter has no such block anywhere. A job card has one in the middle of it.
            Only when NO block anywhere in the design passes that test — a certificate, a single-record letter, a title page — put the body in ReportHeader, leave Detail out, and say so in the markdown specification.
            THE COST OF GETTING THIS WRONG IS THE WHOLE ARTIFACT. DevExpress treats DetailBand as a mandatory band. A report without one prints its content exactly once and CANNOT be bound to a data source, so it is a picture of the document rather than a report that can produce it for every record. The output still opens in the designer and still looks right, which is why this is stated at length instead of left to judgement.

          - GROUPING — ONLY WHEN THE DESIGN ACTUALLY GROUPS, AND THE TEST IS VISIBLE.
            A grouped report is one whose rows are broken into runs by a shared value, with something printed at each break. You are looking for ONE of these in the source document, not for a feeling that the data could be grouped:
            - a heading line INSIDE the table that is not a data row — "North Region", "Category: Fasteners", a bare bold value on its own across the full width — with like rows beneath it, then another such line, then more rows;
            - a SUBTOTAL line partway down — "Region total", "Subtotal" — repeating at each break, as distinct from the single grand total at the end.
            If neither appears, the document is NOT grouped: omit both GroupHeaderBand and GroupFooterBand entirely. A flat list of forty rows with one total at the bottom is an ungrouped report, and inventing a grouping changes what the file prints.
            When it IS grouped:
            - \`<GroupFields>\` is a SIBLING of \`<Controls>\` and is written BEFORE it. Its items carry \`FieldName\` and NO \`ControlType\` — that is the one place besides \`<ExpressionBindings>\` where an item has no control type, and it is measured from the DevExpress serializer rather than inferred.
            - \`FieldName\` is the DATA field the rows break on, spelled as the data spells it — the same name you would put in an expression, WITHOUT the square brackets. If the source shows a caption like "Region: North", the field is \`Region\`.
            - Do NOT write a \`SortOrder\` attribute. The serializer omits it for the ascending default, so writing one adds a difference from what DevExpress itself produces for no gain.
            - The group header usually restates the value it groups on, which is an ordinary expression binding to the same field: \`Expression="[Region]"\`.
            - A per-group subtotal is a cell carrying \`<Summary Ref="..." Running="Group" FormatString="{0:c2}" />\` BEFORE its \`<ExpressionBindings>\`, with the expression \`sumSum([Amount])\`. \`Running="Group"\` is the whole difference between a group subtotal and the grand total in ReportFooter — the expression is identical, so omitting it silently produces a running total of the entire report at every break.
            - Emit GroupFooter only if the design actually shows a per-group line. A GroupHeaderBand alone is normal and correct.
            - In the layout JSON these are sections of \`"type": "group"\`, in the same position and order as the bands.

          - A CHART IN THE SOURCE IS AN XRChart, NOT A PICTURE OF ONE.
            If the document shows a bar, column, line or pie chart, emit an \`XRChart\`. Drawing it as labels and rectangles reproduces the picture and produces a report that can never plot anything.

            <Item1 Ref="4" ControlType="XRChart" Name="chartByRegion" LocationFloat="20,50" SizeF="600,140">
              <Chart Ref="5">
                <DataContainer Ref="6" ValidateDataMembers="true">
                  <SeriesSerializable>
                    <Item1 Ref="7" Name="Sales" ArgumentDataMember="Region" ValueDataMembersSerializable="Amount" />
                  </SeriesSerializable>
                </DataContainer>
                <Diagram Ref="8" TypeNameSerializable="XYDiagram">
                  <AxisX Ref="9" VisibleInPanesSerializable="-1" />
                  <AxisY Ref="10" VisibleInPanesSerializable="-1" />
                </Diagram>
              </Chart>
            </Item1>

            - \`ArgumentDataMember\` is the field along the category axis — what the bars or slices are OF — and \`ValueDataMembersSerializable\` is the field plotted, comma-separated for more than one. Both are plain field names, no brackets. Read them from the chart's own axis titles and legend.
            - The series item carries NO \`ControlType\`, like a group field and an expression binding.
            - **A bar or column chart writes no view type at all** — that is the default. For anything else add \`<View Ref="..." TypeNameSerializable="PieSeriesView" />\` (or \`LineSeriesView\`, \`AreaSeriesView\`, \`ScatterLineSeriesView\`) as a child of the series item.
            - A **pie** chart takes NO \`<Diagram>\` element. Only the XY types do.
            - A chart with no \`<SeriesSerializable>\` is an empty frame on the page and looks exactly like a chart waiting for data, so always emit at least one series.

          - A MATRIX WITH TOTALS DOWN AND ACROSS IS AN XRCrossTab.
            A region-by-quarter grid, a category-by-month grid — anything whose rows and columns are both VALUES with a figure at each intersection — is a cross-tab, not a table. A table has fixed columns; a cross-tab grows a column per distinct value in the data.

            <Item1 Ref="17" ControlType="XRCrossTab" Name="crossByQuarter" LocationFloat="20,10" SizeF="810,220">
              <LayoutOptions Ref="18" />
              <PrintOptions Ref="19" />
              <RowFields><Item1 Ref="20" FieldName="Region" /></RowFields>
              <ColumnFields><Item1 Ref="21" FieldName="Quarter" /></ColumnFields>
              <DataFields><Item1 Ref="22" FieldName="Amount" /></DataFields>
            </Item1>

            - The row field is what the LEFT-hand column lists, the column field what the HEADING ROW lists, and the data field what sits at each intersection. Get those three from the grid's own labels.
            - The items carry \`FieldName\` and no \`ControlType\`; \`<LayoutOptions />\` and \`<PrintOptions />\` are written empty.
            - All three collections are required. A cross-tab missing one prints nothing where the grid was.
            - When the columns are FIXED headings rather than values from the data — "Item, Qty, Amount" — it is an ordinary XRTable, and the DETAIL BAND rules above apply instead.

          - PARAMETERS — ONLY WHEN THE DESIGN SHOWS THE READER BEING ASKED SOMETHING.
            Look for a criteria block near the top: "Date range: ____ to ____", "Region: All", "Customer: [blank]", a filled-in filter line, or a from/to pair printed as part of the header. Those are values the reader supplies before the report runs, and they belong in a \`<Parameters>\` collection, which is a child of the root written BEFORE \`<Bands>\`:

            <Parameters>
              <Item1 Ref="1" Name="DateFrom" Description="From date" Type="System.DateTime" ValueInfo="2026-01-01" />
              <Item2 Ref="2" Name="Region" Description="Region" ValueInfo="North" />
            </Parameters>

            - \`Name\` is an identifier: letters, digits and underscore, no spaces. \`Description\` is what the reader is shown, so it is the label as the document words it.
            - \`ValueInfo\` — NOT \`Value\` — carries the default, written as text.
            - \`Type\` is one of \`System.String\`, \`System.DateTime\`, \`System.Int32\`, \`System.Decimal\`, \`System.Double\`, \`System.Boolean\`. Omit it entirely for a string, which is the default. **Write the plain type name; do not attempt an \`ObjectStorage\` section — a later pass converts it into the form DevExpress actually reads.**
            - \`MultiValue="true"\` when the document shows a list being chosen from.
            - USE every parameter you declare, in one of the two ways, or do not declare it. In the report's \`FilterString\` attribute on the root: \`FilterString="[OrderDate] &gt;= ?DateFrom"\` — note the \`?Name\` form and that \`>\` must be written \`&gt;\`. Or in a control's expression: \`Expression="'Region: ' + [Parameters.Region]"\` — note the \`[Parameters.Name]\` form. A declared parameter nobody uses still stops the reader and asks them a question that changes nothing.
            - If the design shows no such block, emit NO \`<Parameters>\` element. An invented parameter turns a report that runs into one that interrogates the reader first.

          - THE DETAIL BAND IS ONE ROW, NOT THE TABLE.
            This is the whole point of the exercise. A DetailBand is printed once PER RECORD, so it must contain a single row's worth of controls:
            - HeightF is ONE ROW's height, not the table's height.
            - Emit an XRTable holding exactly ONE XRTableRow — the same columns, in the same order, with the SAME cell Weight values and the same LocationFloat x and SizeF width as the heading table you put in PageHeader. Those two tables print directly above one another, so any difference in weights shows up as columns that do not line up.
            - Give that row the FIRST data row's text as placeholder content, so the row is recognisable in the designer.
            - Put it at y=0 inside the band.
            - Do NOT emit an XRTable containing every row. Do NOT repeat the data rows. Do NOT put the column headings in this band — they belong in PageHeader.
            The remaining rows are not lost: they are what the data source will supply, and they still appear in full in the markdown specification and in the layout JSON.

          - COORDINATE FRAME — THE SINGLE MOST COMMON WAY THIS OUTPUT COMES OUT WRONG.
            A control's LocationFloat is measured from the TOP-LEFT OF ITS OWN BAND. Bands stack down the page in the order above, so a band's top edge is the sum of the heights of the bands before it.
            - X is unchanged: it is the same number as on the page, because Margins are zero and every band starts at the page's left edge.
            - Y MUST BE CONVERTED. Take the y you measured on the page and SUBTRACT the top edge of the band you are putting the control in.
            - Worked example. Bands so far: ReportHeader HeightF="320", PageHeader HeightF="28". PageHeader's top edge is therefore 320. A column heading you measured at y=336 on the page is written inside PageHeader as LocationFloat="x,16" — because 336 - 320 = 16.
            - Every control must satisfy 0 <= y and y + height <= its own band's HeightF. A control whose y is still a page coordinate will be far below its band and will silently vanish or push the band to a second page.
            - Set each band's HeightF to the real extent of the content you put in it, then check the sum: the emitted bands should account for the design's vertical space without exceeding ${page.height}.
            - Every control must still satisfy x + width <= ${page.width}.
            - Do NOT set non-zero Margins. Do NOT give the margin bands a height.

          - THE LAYOUT JSON MIRRORS THESE BANDS.
            The "sections" of the layout described below are the same bands in the same order — one section per content band you emit, named after it, with the same height, and with each element's y measured from that section's own top edge exactly as its LocationFloat is. Do not emit margin bands as sections. The ONE deliberate difference is the repeating data: the detail SECTION carries every row you can read, because the mockup is a picture of the source, while the Detail BAND carries one.
`;
}

/**
 * The ROOT STRUCTURE section of the prompt, in whichever shape is selected.
 *
 * Returned as prompt text rather than a structure because that is what it is —
 * keeping it here rather than inline in `geminiService.ts` is what lets both
 * variants be asserted without calling the model.
 */
export function rootStructurePrompt(options: RootStructureOptions): string {
  return bandedRootStructure(options);
}

/**
 * How many rows of a repeating region go into the REPX.
 *
 * This sentence closes the rule under "AN ALIGNED, REPEATING REGION IS A TABLE",
 * which otherwise ends by demanding every row — correct for the flat shape and
 * for the layout JSON in both, and flatly wrong for a banded Detail band. The
 * two artifacts are required to agree everywhere else in the prompt, so the one
 * place they deliberately do not has to be said out loud.
 */
export function tableRowsRule(): string {
  return 'Reproduce EVERY row and column you can read in the layout JSON and in the markdown specification — the mockup is a picture of the source, so nothing is dropped there. In repxContent the same region is SPLIT ACROSS BANDS as described under ROOT STRUCTURE above: the heading row goes in PageHeader, ONE data row goes in Detail, and any totals row goes in ReportFooter. That is the one place the two artifacts are meant to differ, and it is why the file can be bound to data at all.';
}
