/**
 * The REPX band structure the prompt asks the model to produce.
 *
 * ## Why this is a switch and not just an edit
 *
 * Until 2026-09-01 the prompt hard-coded exactly three bands — a zero-height
 * TopMargin, ONE DetailBand at the full page height, and a zero-height
 * BottomMargin — and every control went into that single band. It is a good
 * choice for the thing it was optimising: with one band starting at the paper's
 * top-left and `Margins="0,0,0,0"`, band-relative coordinates and page
 * coordinates are the same numbers, so the model cannot get the frame wrong.
 * Measured on a live run, that produces a genuinely faithful picture: 103
 * controls, 0 out of bounds, 0 overlapping.
 *
 * It also produces something that is not a report. In DevExpress a `DetailBand`
 * repeats **once per record**, so a Detail band the height of the page means
 * binding a data source makes the whole page repeat per row. There is no
 * `ReportHeader` to print a title once, no `PageHeader` to repeat column
 * headings across pages, and no `ReportFooter` for totals — the table is a
 * static `XRTable` with every row hard-coded instead.
 *
 * So the two shapes optimise for different things and cannot both be the
 * default. `banded` is the prototype; `flat` is what ships until an A/B on real
 * documents says otherwise.
 *
 * ## The part that will break first
 *
 * Coordinates. `flat` can tell the model "do NOT subtract anything" because the
 * only band starts at y=0. With stacked bands, each band's origin is its own top
 * edge, so a control 400 units down the page sitting in a band that starts at
 * 320 must be written as `LocationFloat="x,80"`. That subtraction is exactly the
 * class of error `src/lib/reportGeometry.ts` exists to contain — it renders a
 * plausible layout in the wrong place and never throws. The banded prompt
 * therefore spends most of its length on that one rule.
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
 * Is the banded prototype on?
 *
 * Env-driven rather than a `ReportConfig` field on purpose. `reportConfigStore`
 * persists config through an allowlist whose whole job is keeping the API key
 * off disk; adding a field there for an experiment means touching the one piece
 * of storage code with a security invariant. A `VITE_` flag is the same shape as
 * `VITE_FORMA_MOCK`, needs no persistence, and disappears when the experiment
 * ends.
 */
export function bandedLayoutEnabled(env: Record<string, string | undefined>): boolean {
  return env.VITE_FORMA_BANDED === 'true';
}

/** The original single-band structure. Unchanged behaviour. */
function flatRootStructure({ page, reportUnit, targetVersion, targetSerializerVersion }: RootStructureOptions): string {
  return `
          - ROOT STRUCTURE: The entire repxContent MUST be wrapped exactly like this:
            <?xml version="1.0" encoding="utf-8"?>
            <XtraReportsLayoutSerializer SerializerVersion="${targetSerializerVersion}" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" ReportUnit="${reportUnit}" Margins="0, 0, 0, 0" PageWidth="${page.width}" PageHeight="${page.height}" Version="${targetVersion}">
              <Bands>
                <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="0" />
                <Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="${page.height}">
                  <Controls>
                    <!-- Your controls go here -->
                  </Controls>
                </Item2>
                <Item3 Ref="3" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="0" />
              </Bands>
            </XtraReportsLayoutSerializer>

          - COORDINATE FRAME — the single most common way this output comes out wrong.
            A control's LocationFloat is measured from the TOP-LEFT OF ITS BAND, and a band begins at the page's left margin. The margins above are therefore ZERO on purpose: it makes the band's coordinate space identical to the paper's, so the numbers from PHASE 1 and from any extracted PDF text can be used directly.
            - Do NOT set non-zero Margins. Do NOT give the margin bands a height.
            - Do NOT subtract or add anything to the PHASE 1 coordinates when writing LocationFloat.
            - Every control must satisfy x + width <= ${page.width} and fit inside its band's height. Anything wider than the page is silently clipped or pushed onto a second page by the designer.
            - Make the Detail band tall enough to contain the tallest element you place in it.
`;
}

/**
 * The banded prototype: a real report skeleton instead of one page-sized band.
 *
 * Band order is not stylistic — XtraReports reads the sequence, and a
 * `PageHeaderBand` written after `Detail` is a different report. The order below
 * is the one the designer itself emits.
 */
function bandedRootStructure({ page, reportUnit, targetVersion, targetSerializerVersion }: RootStructureOptions): string {
  return `
          - ROOT STRUCTURE — A BANDED REPORT, NOT ONE PAGE-SIZED BAND.
            You are producing a real DevExpress report, so the page is split into bands that each play a different role at print time. Emit ONLY the bands the design actually needs; omit any band you have no content for, but keep the ones you emit in exactly this order:

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
                <Item4 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="...">
                  <Controls><!-- ONE repeating record. See DETAIL BAND below. --></Controls>
                </Item4>
                <Item5 Ref="5" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="...">
                  <Controls><!-- printed ONCE, after the last record --></Controls>
                </Item5>
                <Item6 Ref="6" ControlType="PageFooterBand" Name="PageFooter" HeightF="...">
                  <Controls><!-- repeated at the bottom of EVERY page --></Controls>
                </Item6>
                <Item7 Ref="7" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="0" />
              </Bands>
            </XtraReportsLayoutSerializer>

          - WHICH BAND EACH PIECE OF THE DESIGN BELONGS IN.
            Decide this from what the content *is*, not from where it sits on the page:
            - ReportHeader — the document title, the issuing company, the invoice/report number, dates, and the "bill to"/"ship to"/"terms" blocks. Anything that identifies this one document and would be wrong to print twice.
            - PageHeader — the COLUMN HEADING ROW of the main table, and any running title. This repeats, so a reader on page 3 still knows what each column means.
            - Detail — exactly ONE row of the repeating data. See below; this is the band most often got wrong.
            - ReportFooter — subtotal, tax and grand-total lines, sign-off blocks, terms paragraphs that close the document.
            - PageFooter — page numbers (XRPageInfo), the registration line, anything repeated at the foot of every sheet.
            If the design genuinely has no repeating rows — a certificate, a form, a single-record letter — put the body in ReportHeader, leave Detail out entirely rather than emitting an empty one, and say so in the markdown specification.

          - THE DETAIL BAND IS ONE ROW, NOT THE TABLE.
            This is the whole point of the exercise. A DetailBand is printed once PER RECORD, so it must contain a single row's worth of controls:
            - HeightF is ONE ROW's height, not the table's height.
            - Put one XRLabel per column, positioned at that column's x and width, with y=0 inside the band.
            - Use the FIRST data row's text as the placeholder content for each cell, so the row is recognisable in the designer.
            - Do NOT emit an XRTable containing every row. Do NOT repeat the data rows. Do NOT put the column headings in this band — they belong in PageHeader.
            The remaining rows are not lost: they are what the data source will supply. Record every row you can read in the markdown specification and in the layout JSON so nothing is thrown away.

          - COORDINATE FRAME — THE SINGLE MOST COMMON WAY THIS OUTPUT COMES OUT WRONG.
            A control's LocationFloat is measured from the TOP-LEFT OF ITS OWN BAND. Bands stack down the page in the order above, so a band's top edge is the sum of the heights of the bands before it.
            - X is unchanged: it is the same number as on the page, because Margins are zero and every band starts at the page's left edge.
            - Y MUST BE CONVERTED. Take the y you measured on the page and SUBTRACT the top edge of the band you are putting the control in.
            - Worked example. Bands so far: ReportHeader HeightF="320", PageHeader HeightF="28". PageHeader's top edge is therefore 320. A column heading you measured at y=336 on the page is written inside PageHeader as LocationFloat="x,16" — because 336 - 320 = 16.
            - Every control must satisfy 0 <= y and y + height <= its own band's HeightF. A control whose y is still a page coordinate will be far below its band and will silently vanish or push the band to a second page.
            - Set each band's HeightF to the real extent of the content you put in it, then check the sum: the emitted bands should account for the design's vertical space without exceeding ${page.height}.
            - Every control must still satisfy x + width <= ${page.width}.
            - Do NOT set non-zero Margins. Do NOT give the margin bands a height.
`;
}

/**
 * The ROOT STRUCTURE section of the prompt, in whichever shape is selected.
 *
 * Returned as prompt text rather than a structure because that is what it is —
 * keeping it here rather than inline in `geminiService.ts` is what lets both
 * variants be asserted without calling the model.
 */
export function rootStructurePrompt(options: RootStructureOptions, banded: boolean): string {
  return banded ? bandedRootStructure(options) : flatRootStructure(options);
}
