/**
 * What the exported file prints, asserted rather than eyeballed.
 *
 * The pagination rules here are the ones a person checks by opening the report
 * in DevExpress and scrolling -- which is exactly the loop this feature exists
 * to remove, so it would be circular to verify them that way. They are asserted
 * against the documented band semantics instead: Detail once per record,
 * PageHeader on every sheet, ReportHeader on the first only, ReportFooter after
 * the last record, PageFooter on the bottom margin.
 *
 * The parser half is tested against the shape this project's own prompt emits,
 * plus the malformed variants that reach it in practice -- a truncated file, a
 * band with no controls, a table whose cells could be mistaken for controls of
 * the band.
 */
import { describe, it, expect } from 'vitest';
import {
  parseReportStructure,
  paginate,
  activeColumns,
  pageInfoText,
  cssColor,
  cssPadding,
  layoutBand,
  heldHeight,
  splitInstance,
  recordCountFromLayout,
  decodeXmlText,
  fontDecoration,
  safeLink,
  type BandInstance,
  type PaginatedReport,
  type PlacedBand,
  type PlacedControl,
} from './reportPreview';
import { reportToCsv } from './csvExport';
import { liftStyles } from './repxStyles';
import { repairCrossTabs } from './repxCrossTabs';

/** The banded shape reportBands.ts asks the model for. */
const banded = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="23.2.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" ReportUnit="HundredthsOfAnInch" Margins="0, 0, 0, 0" PageWidth="850" PageHeight="1100" Version="23.2">
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="0" />
    <Item2 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="200">
      <Controls>
        <Item1 Ref="3" ControlType="XRLabel" Name="title" Text="INVOICE" LocationFloat="20,20" SizeF="400,40" Font="Arial, 14pt, style=Bold" TextAlignment="MiddleLeft" Borders="Bottom" />
      </Controls>
    </Item2>
    <Item3 Ref="4" ControlType="PageHeaderBand" Name="PageHeader" HeightF="30">
      <Controls>
        <Item1 Ref="5" ControlType="XRTable" Name="headTable" LocationFloat="0,0" SizeF="800,30">
          <Rows>
            <Item1 Ref="6" ControlType="XRTableRow" Name="headRow" Weight="1">
              <Cells>
                <Item1 Ref="7" ControlType="XRTableCell" Name="h1" Text="Item" Weight="3" Font="Arial, 9pt, style=Bold" />
                <Item2 Ref="8" ControlType="XRTableCell" Name="h2" Text="Amount" Weight="1" TextAlignment="MiddleRight" />
              </Cells>
            </Item1>
          </Rows>
        </Item1>
      </Controls>
    </Item3>
    <Item4 Ref="9" ControlType="DetailBand" Name="Detail" HeightF="25">
      <Controls>
        <Item1 Ref="10" ControlType="XRLabel" Name="row" Text="Widget" LocationFloat="0,0" SizeF="600,25" />
      </Controls>
    </Item4>
    <Item5 Ref="11" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="60" />
    <Item6 Ref="12" ControlType="PageFooterBand" Name="PageFooter" HeightF="20">
      <Controls>
        <Item1 Ref="13" ControlType="XRPageInfo" Name="pn" LocationFloat="700,0" SizeF="100,20" PageInfo="NumberOfTotal" />
      </Controls>
    </Item6>
  </Bands>
</XtraReportsLayoutSerializer>`;

const structure = parseReportStructure(banded);
const kinds = (xml: string) => parseReportStructure(xml).bands.map((b) => b.kind);

describe('reading the report out of the REPX', () => {
  it('reads the page box, the unit and every band', () => {
    expect(structure.page).toEqual({ width: 850, height: 1100 });
    expect(structure.unit).toBe('HundredthsOfAnInch');
    expect(structure.bands.map((b) => b.kind)).toEqual([
      'TopMargin', 'ReportHeader', 'PageHeader', 'Detail', 'ReportFooter', 'PageFooter', 'BottomMargin',
    ].filter((k) => k !== 'BottomMargin'));
    expect(structure.problems).toEqual([]);
  });

  it('reads a control with its band-relative geometry and styling', () => {
    const title = structure.bands.find((b) => b.kind === 'ReportHeader')!.controls[0];
    expect(title).toMatchObject({
      type: 'XRLabel', name: 'title', text: 'INVOICE',
      x: 20, y: 20, width: 400, height: 40,
      fontSize: 14, fontFamily: 'Arial', bold: true, italic: false,
      align: 'left', vAlign: 'middle',
    });
    expect(title.borders).toEqual({ top: false, right: false, bottom: true, left: false });
  });

  it('reads a table as rows and cells, not as loose controls', () => {
    const header = structure.bands.find((b) => b.kind === 'PageHeader')!;
    // The trap: a flat scan would find the two XRTableCells as band controls
    // and draw them at cell coordinates, which do not exist.
    expect(header.controls).toHaveLength(1);
    expect(header.controls[0].type).toBe('XRTable');
    expect(header.controls[0].rows).toHaveLength(1);
    expect(header.controls[0].rows[0].cells).toEqual([
      {
        text: 'Item', weight: 3, fontSize: 9, fontFamily: 'Arial', bold: true, italic: false,
        align: 'left', vAlign: 'top', borders: { top: false, right: false, bottom: false, left: false },
        appearance: { Font: 'Arial, 9pt, style=Bold' }, canGrow: true, wordWrap: true, field: null,
        data: { expression: null, running: null, format: null }, rules: [], ownProps: ['Font'],
      },
      {
        // No font anywhere above it, so DevExpress 20.1's own default.
        text: 'Amount', weight: 1, fontSize: 9.75, fontFamily: 'Times New Roman', bold: false, italic: false,
        align: 'right', vAlign: 'middle', borders: { top: false, right: false, bottom: false, left: false },
        appearance: { Font: 'Times New Roman, 9.75pt', TextAlignment: 'MiddleRight' }, canGrow: true, wordWrap: true, field: null,
        data: { expression: null, running: null, format: null }, rules: [], ownProps: ['TextAlignment'],
      },
    ]);
  });

  it('sorts bands into print order however the file lists them', () => {
    const reversed = banded
      .replace(/(<Item3 Ref="4"[\s\S]*?<\/Item3>)\s*(<Item4 Ref="9"[\s\S]*?<\/Item4>)/, '$2$1');
    expect(kinds(reversed)).toEqual(kinds(banded));
    // ...and the Detail band really did move in the source, so this is not a
    // test of an unchanged string.
    expect(reversed).not.toBe(banded);
  });

it('does not read a SortFields item as a control of the band', () => {
    // <SortFields> is a sibling of <Controls> written BEFORE it, exactly like
    // <GroupFields> -- so a parser taking a band's first child collection reads
    // sort fields as controls and draws them at coordinates they do not have.
    const sorted = parseReportStructure(
      '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
      '<Bands><Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="40">' +
      '<SortFields><Item1 Ref="2" FieldName="OrderDate" SortOrder="Descending" /></SortFields>' +
      '<Controls><Item1 Ref="3" ControlType="XRLabel" Name="l" Text="x" SizeF="100,20" LocationFloat="0,0" /></Controls>' +
      '</Item1></Bands></XtraReportsLayoutSerializer>'
    ).bands[0];
    expect(sorted.controls.map((c) => c.name)).toEqual(['l']);
  });

  it('survives a band with no controls at all', () => {
    const footer = structure.bands.find((b) => b.kind === 'ReportFooter')!;
    expect(footer.height).toBe(60);
    expect(footer.controls).toEqual([]);
  });

  it('reports rather than throws on input it cannot use', () => {
    for (const [input, fragment] of [
      ['', 'no REPX'],
      ['<html><body>nope</body></html>', 'XtraReportsLayoutSerializer'],
      ['<XtraReportsLayoutSerializer PageWidth="850"></XtraReportsLayoutSerializer>', 'no <Bands>'],
    ] as const) {
      const result = parseReportStructure(input);
      expect(result.bands).toEqual([]);
      expect(result.problems.join(' ')).toContain(fragment);
    }
  });

  it('names an unrecognised band instead of dropping it silently', () => {
    const odd = banded.replace('ControlType="ReportFooterBand"', 'ControlType="SubBandBand"');
    const result = parseReportStructure(odd);
    expect(result.problems.join(' ')).toContain('SubBandBand');
    expect(result.bands.some((b) => b.kind === 'Unknown')).toBe(true);
  });

  it('decodes XML entities, ampersand last', () => {
    expect(decodeXmlText('Bolt &amp; Nut')).toBe('Bolt & Nut');
    expect(decodeXmlText('&amp;lt;')).toBe('&lt;');
    expect(decodeXmlText('&#8212;')).toBe('—');
  });
});

describe('paginating a real report', () => {
  // Usable body: 1100 page - 0 margins - 30 PageHeader - 20 PageFooter = 1050.
  // Page 1 also spends 200 on the ReportHeader.
  const run = (records: number) => paginate(structure, records);

  it('prints the ReportHeader on the first page only', () => {
    const result = run(80);
    expect(result.pages.length).toBeGreaterThan(1);
    const headerPages = result.pages.filter((p) => p.bands.some((b) => b.band.kind === 'ReportHeader'));
    expect(headerPages.map((p) => p.number)).toEqual([1]);
  });

  /*
   * The order of the two headers on page 1, which shipped wrong until 2026-09-06.
   *
   * DevExpress prints the ReportHeader ABOVE the PageHeader -- its "Print Order
   * of Bands" lists them that way and the designer stacks them that way -- and
   * `BAND_ORDER` in reportPreview.ts agreed. `paginate` did not: it opened every
   * page with the PageHeader and pushed the ReportHeader in afterwards, so the
   * column headings printed above the report title.
   *
   * The two tests above could not see it. "on the first page only" is a filter
   * over pages, and "230, then 25 per record" is a sum of both heights; both
   * pass just as happily with the bands the wrong way round. That is why this
   * asserts `top` and the emitted sequence rather than membership.
   */
  it('prints the ReportHeader above the PageHeader on page 1', () => {
    const [page] = run(2).pages;
    const reportHeader = page.bands.find((b) => b.band.kind === 'ReportHeader')!;
    const pageHeader = page.bands.find((b) => b.band.kind === 'PageHeader')!;
    expect(reportHeader.top).toBe(0);
    expect(pageHeader.top).toBe(200);
    expect(reportHeader.top).toBeLessThan(pageHeader.top);
  });

  it('emits page 1 in print order: ReportHeader, PageHeader, then the records', () => {
    const [page] = run(2).pages;
    // PageFooter is excluded because it is placed at page-open time onto the
    // bottom margin, so it is emitted second and sorting by `top` would be the
    // only way to include it meaningfully. Everything else is in print order.
    const order = page.bands
      .filter((b) => b.band.kind !== 'PageFooter')
      .map((b) => b.band.kind);
    expect(order).toEqual(['ReportHeader', 'PageHeader', 'Detail', 'Detail', 'ReportFooter']);
  });

  it('opens later pages with the PageHeader, with no ReportHeader above it', () => {
    const result = run(80);
    for (const page of result.pages.slice(1)) {
      const first = page.bands.filter((b) => b.band.kind !== 'PageFooter')[0];
      expect(first.band.kind).toBe('PageHeader');
      expect(first.top).toBe(0);
    }
  });

  it('repeats the PageHeader and PageFooter on every page', () => {
    const result = run(80);
    for (const page of result.pages) {
      expect(page.bands.filter((b) => b.band.kind === 'PageHeader')).toHaveLength(1);
      expect(page.bands.filter((b) => b.band.kind === 'PageFooter')).toHaveLength(1);
    }
  });

  it('puts the PageFooter on the bottom margin, not after the content', () => {
    const [page] = run(2).pages;
    const footer = page.bands.find((b) => b.band.kind === 'PageFooter')!;
    // 1100 page height - 0 bottom margin - 20 band height.
    expect(footer.top).toBe(1080);
    const lastDetail = page.bands.filter((b) => b.band.kind === 'Detail').at(-1)!;
    expect(lastDetail.top).toBeLessThan(footer.top);
  });

  it('prints the Detail band once per record, numbered in order', () => {
    const result = run(5);
    const details = result.pages.flatMap((p) => p.bands.filter((b) => b.band.kind === 'Detail'));
    expect(details).toHaveLength(5);
    expect(details.map((d) => d.record)).toEqual([1, 2, 3, 4, 5]);
    expect(result.records).toBe(5);
  });

  it('stacks records down the page at the band height', () => {
    const [page] = run(3).pages;
    const tops = page.bands.filter((b) => b.band.kind === 'Detail').map((b) => b.top);
    // ReportHeader 200 + PageHeader 30 = 230, then 25 per record.
    expect(tops).toEqual([230, 255, 280]);
  });

  it('flows onto a second page when the records run out of room', () => {
    // Page 1 fits (1050 - 200) / 25 = 34 records.
    const result = run(40);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].bands.filter((b) => b.band.kind === 'Detail')).toHaveLength(34);
    expect(result.pages[1].bands.filter((b) => b.band.kind === 'Detail')).toHaveLength(6);
  });

  it('prints the ReportFooter once, after the last record', () => {
    const result = run(6);
    const footers = result.pages.flatMap((p) => p.bands.filter((b) => b.band.kind === 'ReportFooter'));
    expect(footers).toHaveLength(1);
    const page = result.pages.at(-1)!;
    const lastDetail = page.bands.filter((b) => b.band.kind === 'Detail').at(-1)!;
    expect(footers[0].top).toBe(lastDetail.top + 25);
  });

  it('moves the ReportFooter to a new page when it does not fit', () => {
    // 34 records fill page 1 exactly, leaving no room for a 60-unit footer.
    // The footer needs a control to take room at all (parity row 41).
    const withTotal = banded.replace('<Item5 Ref="11" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="60" />',
      '<Item5 Ref="11" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="60"><Controls><Item1 Ref="14" ControlType="XRLabel" Name="total" Text="TOTAL" SizeF="200,20" /></Controls></Item5>');
    const result = paginate(parseReportStructure(withTotal), 34);
    const footerPage = result.pages.find((p) => p.bands.some((b) => b.band.kind === 'ReportFooter'))!;
    expect(footerPage.number).toBe(2);
    expect(footerPage.bands.some((b) => b.band.kind === 'PageHeader')).toBe(true);
  });

  it('places an empty margin band nowhere', () => {
    // A margin band with controls prints them on every page (row 38, below);
    // the prompt's margin bands are empty, so they place nothing.
    const placed = run(3).pages.flatMap((p) => p.bands.map((b) => b.band.kind));
    expect(placed).not.toContain('TopMargin');
    expect(placed).not.toContain('BottomMargin');
  });

  it('still renders one page with no records at all', () => {
    const result = run(0);
    expect(result.pages).toHaveLength(1);
    expect(result.records).toBe(0);
    expect(result.pages[0].bands.map((b) => b.band.kind)).toContain('ReportHeader');
    expect(result.pages[0].bands.map((b) => b.band.kind)).toContain('ReportFooter');
  });

  it('reports how many records fit a page', () => {
    expect(run(1).recordsPerPage).toBe(42); // (1100 - 30 - 20) / 25
  });

  it('diagnoses a page-tall Detail band instead of paginating forever', () => {
    // The shape the prompt asked for until 2026-09-03: one DetailBand at the
    // full page height, which prints the entire design once per record. 1100
    // exceeds the 1050 of usable body, so it can never fit.
    //
    // Forma no longer emits this -- reportBands.ts dropped the flat variant on
    // 2026-09-05 -- but an UPLOADED .repx can still be shaped this way, which is
    // the case that matters: the diagnosis has to survive the removal of the
    // thing that used to produce it.
    const pageTall = banded.replace('Name="Detail" HeightF="25"', 'Name="Detail" HeightF="1100"');
    const result = paginate(parseReportStructure(pageTall), 4);
    expect(result.problems.join(' ')).toMatch(/Detail band is 1100 units tall and only 1050 fit/);
    // One record per sheet rather than an infinite loop or a dropped record. A
    // sheet may also carry the empty remainder of the record before it, which
    // DevExpress carries over a break (c05), so only parts that print count.
    expect(result.records).toBe(4);
    for (const page of result.pages) {
      expect(page.bands.filter((b) => b.band.kind === 'Detail' && b.controls.length > 0).length).toBeLessThanOrEqual(1);
    }
  });

  it('stays quiet about a Detail band that is tall but does fit', () => {
    // The boundary the case above got wrong on the first try: 1000 units is
    // most of the page and still fits in the 1050 of body, so warning about it
    // would be crying wolf on a legitimately dense record.
    const tall = banded.replace('Name="Detail" HeightF="25"', 'Name="Detail" HeightF="1000"');
    const result = paginate(parseReportStructure(tall), 3);
    expect(result.problems.join(' ')).not.toMatch(/Detail band is/);
    expect(result.records).toBe(3);
  });

  it('lays out every page with no cap unless one is asked for', () => {
    // Parity row 16: the default was 50 pages until 2026-10-30, so c09's 10,000
    // records showed 50 of DevExpress's 213. Its comparison, all 213 pages
    // identical, runs outside the suite on the 10,000 rows.
    const result = paginate(structure, 5000);
    expect(result.pages.length).toBeGreaterThan(50);
    expect(result.records).toBe(5000);
    expect(result.problems.join(' ')).not.toMatch(/records are not shown/);
  });

  it('stops at the page cap a caller asks for and says how many records it dropped', () => {
    const result = paginate(structure, 5000, { maxPages: 3 });
    expect(result.pages).toHaveLength(3);
    expect(result.records).toBeLessThan(5000);
    expect(result.problems.join(' ')).toMatch(/records are not shown/);
  });

  it('honours non-zero margins from the root element', () => {
    const margined = banded.replace('Margins="0, 0, 0, 0"', 'Margins="50, 50, 100, 100"');
    const result = paginate(parseReportStructure(margined), 1);
    // The FIRST band on page 1 is what the top margin displaces, and on page 1
    // that is the ReportHeader. This asserted the PageHeader at 100 until
    // 2026-09-06, which was true only because the two headers were emitted in
    // the wrong order -- so it read as a margin test and was also pinning the
    // defect in place. The PageHeader now follows the 200-tall ReportHeader.
    const reportHeader = result.pages[0].bands.find((b) => b.band.kind === 'ReportHeader')!;
    expect(reportHeader.top).toBe(100);
    const header = result.pages[0].bands.find((b) => b.band.kind === 'PageHeader')!;
    expect(header.top).toBe(300);
    const footer = result.pages[0].bands.find((b) => b.band.kind === 'PageFooter')!;
    expect(footer.top).toBe(1100 - 100 - 20);
  });

  it('carries the parse problems through to the paginated result', () => {
    const result = paginate(parseReportStructure('<XtraReportsLayoutSerializer />'), 3);
    expect(result.problems.join(' ')).toContain('no <Bands>');
    expect(result.pages).toHaveLength(1);
  });
});

/**
 * Grouping, whose serialized shape was measured with `tools/RepxProbe` on
 * 2026-09-05 rather than taken from the class reference: `<GroupFields>` is a
 * sibling of `<Controls>` written before it, and its items carry `FieldName`
 * and no `ControlType`.
 */
describe('group bands', () => {
  const grouped = (headers: string[], footers: string[]) => `<?xml version="1.0"?>
<XtraReportsLayoutSerializer ReportUnit="HundredthsOfAnInch" Margins="0, 0, 0, 0" PageWidth="850" PageHeight="1100">
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="0" />
    <Item2 Ref="2" ControlType="PageHeaderBand" Name="PageHeader" HeightF="20" />
    ${headers.map((field, i) => `<Item${i + 3} Ref="${10 + i}" ControlType="GroupHeaderBand" Name="Group${field}" HeightF="24">
      <GroupFields><Item1 Ref="${20 + i}" FieldName="${field}" /></GroupFields>
      <Controls><Item1 Ref="${30 + i}" ControlType="XRLabel" Name="cap${field}" Text="${field}" LocationFloat="0,0" SizeF="400,20" /></Controls>
    </Item${i + 3}>`).join('\n    ')}
    <Item9 Ref="40" ControlType="DetailBand" Name="Detail" HeightF="22" />
    ${footers.map((field, i) => `<Item${i + 10} Ref="${50 + i}" ControlType="GroupFooterBand" Name="Foot${field}" HeightF="18" />`).join('\n    ')}
    <Item20 Ref="60" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="30" />
    <Item21 Ref="61" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="0" />
  </Bands>
</XtraReportsLayoutSerializer>`;

  it('reads a group header and the field it groups on', () => {
    const s = parseReportStructure(grouped(['Region'], []));
    const header = s.bands.find((b) => b.kind === 'GroupHeader')!;
    expect(header.name).toBe('GroupRegion');
    expect(header.height).toBe(24);
    // The caption control must still be found: <GroupFields> sits before
    // <Controls>, so a parser that took the first collection would read the
    // group field as the band's controls and draw nothing.
    expect(header.controls).toHaveLength(1);
    expect(header.controls[0].text).toBe('Region');
  });

  it('keeps every band of a nested grouping, in file order; nesting is decided at layout', () => {
    const s = parseReportStructure(grouped(['Region', 'Category'], []));
    const headers = s.bands.filter((b) => b.kind === 'GroupHeader');
    expect(headers.map((b) => b.name)).toEqual(['GroupRegion', 'GroupCategory']);
  });

  it('places every group header, not just the first, nested as DevExpress nests them', () => {
    // The bug this pins: `find` returned one band and the inner group vanished
    // from the preview while the file still contained it. The ORDER is
    // DevExpress's, measured in case s19: with no Level the band later in the
    // file is the outer group, so Category opens first here.
    const result = paginate(parseReportStructure(grouped(['Region', 'Category'], [])), 2);
    const placed = result.pages.flatMap((p) => p.bands.filter((b) => b.band.kind === 'GroupHeader'));
    expect(placed.map((b) => b.band.name)).toEqual(['GroupCategory', 'GroupRegion']);
  });

  it('nests by Level before file order, the higher level outside', () => {
    const leveled = grouped(['Region', 'Category'], ['Region', 'Category'])
      .replace('Name="GroupRegion"', 'Name="GroupRegion" Level="1"')
      .replace('Name="FootRegion"', 'Name="FootRegion" Level="1"');
    const bands = paginate(parseReportStructure(leveled), 1).pages[0].bands
      .filter((b) => b.band.kind === 'GroupHeader' || b.band.kind === 'GroupFooter')
      .sort((a, b) => a.top - b.top)
      .map((b) => b.band.name);
    expect(bands).toEqual(['GroupRegion', 'GroupCategory', 'FootCategory', 'FootRegion']);
  });

  it('prints group headers before the records and footers after', () => {
    const result = paginate(parseReportStructure(grouped(['Region'], ['Region'])), 3);
    const order = result.pages[0].bands
      .filter((b) => b.band.kind !== 'PageFooter')
      .sort((a, b) => a.top - b.top)
      .map((b) => b.band.kind);
    expect(order).toEqual([
      'PageHeader', 'GroupHeader', 'Detail', 'Detail', 'Detail', 'GroupFooter', 'ReportFooter',
    ]);
  });

  it('closes nested groups in the reverse of the order it opened them', () => {
    const result = paginate(parseReportStructure(grouped(['Region', 'Category'], ['Region', 'Category'])), 1);
    const footers = result.pages[0].bands
      .filter((b) => b.band.kind === 'GroupFooter')
      .sort((a, b) => a.top - b.top)
      .map((b) => b.band.name);
    // Innermost group closes first. With no Level the inner group is the
    // EARLIER band (measured, s19c), and a footer closes the group whose header
    // has its level, ties paired in file order -- so Region closes first.
    expect(footers).toEqual(['FootRegion', 'FootCategory']);
  });

  it('is unaffected when the report has no grouping at all', () => {
    const plain = paginate(structure, 3);
    expect(plain.pages[0].bands.some((b) => b.band.kind === 'GroupHeader')).toBe(false);
  });
});

/**
 * Charts and cross-tabs, whose serialized shape was measured with
 * `tools/RepxProbe emit-chart` on 2026-09-05. The two facts a reader would get
 * wrong from the class reference: series live in `<SeriesSerializable>` and
 * carry `ValueDataMembersSerializable`, and a bar chart writes NO view type
 * because it is the default.
 */
describe('charts and cross-tabs', () => {
  const series = (name: string, arg: string, value: string, view?: string) =>
    view
      ? `<Item1 Ref="7" Name="${name}" ArgumentDataMember="${arg}" ValueDataMembersSerializable="${value}">` +
        `<View Ref="8" TypeNameSerializable="${view}" /></Item1>`
      : `<Item1 Ref="7" Name="${name}" ArgumentDataMember="${arg}" ValueDataMembersSerializable="${value}" />`;

  const chartReport = (inner: string) => `<?xml version="1.0"?>
<XtraReportsLayoutSerializer ReportUnit="HundredthsOfAnInch" Margins="0, 0, 0, 0" PageWidth="850" PageHeight="1100">
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="0" />
    <Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="400">
      <Controls>${inner}</Controls>
    </Item2>
    <Item3 Ref="30" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="0" />
  </Bands>
</XtraReportsLayoutSerializer>`;

  const chart = (name: string, body: string, ref = 3) =>
    `<Item1 Ref="${ref}" ControlType="XRChart" Name="${name}" LocationFloat="0,0" SizeF="600,140">` +
    `<Chart Ref="${ref + 1}"><DataContainer Ref="${ref + 2}" ValidateDataMembers="true">` +
    `<SeriesSerializable>${body}</SeriesSerializable></DataContainer></Chart></Item1>`;

  const controlOf = (xml: string, i = 0) =>
    parseReportStructure(xml).bands.find((b) => b.kind === 'Detail')!.controls[i];

  it('reads a series with its argument and value fields', () => {
    const c = controlOf(chartReport(chart('chartSales', series('Sales', 'Region', 'Amount'))));
    expect(c.type).toBe('XRChart');
    expect(c.series).toEqual([{ name: 'Sales', argument: 'Region', value: 'Amount', view: '' }]);
  });

  it('leaves the view empty for a bar chart, which writes none', () => {
    const c = controlOf(chartReport(chart('c', series('S', 'R', 'A'))));
    expect(c.series[0].view).toBe('');
  });

  it('reads a non-default view type', () => {
    const c = controlOf(chartReport(chart('c', series('Mix', 'Category', 'Amount', 'PieSeriesView'))));
    expect(c.series[0].view).toBe('PieSeriesView');
  });

  it('does not read the next chart\'s series as this one\'s', () => {
    // Two charts in a band: an unbounded search for <SeriesSerializable> gives
    // the first chart both series and the second none.
    const xml = chartReport(
      chart('first', series('A', 'R', 'X'), 3).replace('<Item1 Ref="3"', '<Item1 Ref="3"') +
      chart('second', series('B', 'Q', 'Y'), 10).replace('<Item1 Ref="10"', '<Item2 Ref="10"').replace('</Item1>', '</Item2>'),
    );
    const structure = parseReportStructure(xml);
    const controls = structure.bands.find((b) => b.kind === 'Detail')!.controls;
    expect(controls).toHaveLength(2);
    expect(controls[0].series.map((s) => s.name)).toEqual(['A']);
    expect(controls[1].series.map((s) => s.name)).toEqual(['B']);
  });

  it('reads a chart with no series as having none, rather than throwing', () => {
    const bare = '<Item1 Ref="3" ControlType="XRChart" Name="empty" LocationFloat="0,0" SizeF="100,100" />';
    expect(controlOf(chartReport(bare)).series).toEqual([]);
  });

  it('reads a cross-tab\'s three field collections', () => {
    const cross =
      '<Item1 Ref="3" ControlType="XRCrossTab" Name="x" LocationFloat="0,0" SizeF="600,200">' +
      '<LayoutOptions Ref="4" /><PrintOptions Ref="5" />' +
      '<RowFields><Item1 Ref="6" FieldName="Region" /></RowFields>' +
      '<ColumnFields><Item1 Ref="7" FieldName="Quarter" /></ColumnFields>' +
      '<DataFields><Item1 Ref="8" FieldName="Amount" /></DataFields></Item1>';
    // Fields alone: DevExpress refuses to print it until it carries the generated 3 by 3 layout.
    expect(controlOf(chartReport(cross)).crossTab).toEqual({
      rows: ['Region'], columns: ['Quarter'], data: ['Amount'], printable: false, measured: true, layoutColumns: 3, layoutRows: 3,
    });
    expect(controlOf(repairCrossTabs(chartReport(cross)).xml).crossTab?.printable).toBe(true);
  });

  it('reports an absent collection as empty rather than as missing', () => {
    const cross =
      '<Item1 Ref="3" ControlType="XRCrossTab" Name="x" LocationFloat="0,0" SizeF="600,200">' +
      '<RowFields><Item1 Ref="6" FieldName="Region" /></RowFields></Item1>';
    expect(controlOf(chartReport(cross)).crossTab).toEqual({
      rows: ['Region'], columns: [], data: [], printable: false, measured: true, layoutColumns: 2, layoutRows: 3,
    });
  });

  it('leaves series and crossTab empty on an ordinary label', () => {
    const label = '<Item1 Ref="3" ControlType="XRLabel" Name="l" Text="x" LocationFloat="0,0" SizeF="10,10" />';
    const c = controlOf(chartReport(label));
    expect(c.series).toEqual([]);
    expect(c.crossTab).toBeNull();
  });
});

describe('choosing how many records to preview', () => {
  const layoutWith = (rows: number) => ({
    sections: [
      { type: 'header', elements: [{ type: 'label' }] },
      { type: 'detail', elements: [{ type: 'table', rows: Array.from({ length: rows }, () => ({})) }] },
    ],
  });

  it('uses the rows the model read, less the heading row', () => {
    expect(recordCountFromLayout(layoutWith(9))).toBe(8);
  });

  it('falls back when the detail section has no table to count', () => {
    expect(recordCountFromLayout(layoutWith(1))).toBe(3);
    expect(recordCountFromLayout({ sections: [{ type: 'detail', elements: [] }] })).toBe(3);
    expect(recordCountFromLayout(null)).toBe(3);
    expect(recordCountFromLayout(undefined, 7)).toBe(7);
  });

  it('ignores a table that is not in the detail section', () => {
    const headerTable = {
      sections: [{ type: 'header', elements: [{ type: 'table', rows: [{}, {}, {}, {}] }] }],
    };
    expect(recordCountFromLayout(headerTable)).toBe(3);
  });
});

/**
 * Checkboxes, and the one thing about them that is not obvious.
 *
 * `RepxProbe emit-marks` measured what DevExpress writes: a ticked box carries
 * BOTH `Checked="true"` and `CheckBoxState="Checked"`, and an unchecked one
 * carries neither. So an absent attribute is a real state rather than missing
 * information, and the reader must not treat it as unknown.
 */
describe('checkboxes', () => {
  const withControl = (control: string) =>
    parseReportStructure(
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
      '<Bands><Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="100"><Controls>' +
      control +
      '</Controls></Item1></Bands></XtraReportsLayoutSerializer>'
    ).bands[0].controls[0];

  it('reads a ticked box from the pair DevExpress writes', () => {
    const c = withControl('<Item1 Ref="2" ControlType="XRCheckBox" Name="c" Checked="true" CheckBoxState="Checked" Text="Paid" SizeF="200,20" LocationFloat="0,0" />');
    expect(c.checkState).toBe('checked');
    expect(c.text).toBe('Paid');
  });

  it('reads an untouched box as unchecked, because that is what the default means', () => {
    const c = withControl('<Item1 Ref="2" ControlType="XRCheckBox" Name="c" Text="Not paid" SizeF="200,20" LocationFloat="0,0" />');
    expect(c.checkState).toBe('unchecked');
  });

  it('reads the third state the bool cannot express', () => {
    const c = withControl('<Item1 Ref="2" ControlType="XRCheckBox" Name="c" CheckBoxState="Indeterminate" Text="Partial" SizeF="200,20" LocationFloat="0,0" />');
    expect(c.checkState).toBe('indeterminate');
  });

  it('prefers CheckBoxState when the two attributes disagree', () => {
    // The enum is the wider type, so it decides. A file with both saying
    // different things is malformed either way; this is the reading that can
    // represent every state rather than the one that cannot.
    const c = withControl('<Item1 Ref="2" ControlType="XRCheckBox" Name="c" Checked="true" CheckBoxState="Unchecked" Text="x" SizeF="200,20" LocationFloat="0,0" />');
    expect(c.checkState).toBe('unchecked');
  });

  it('still reads a half-written checkbox rather than refusing it', () => {
    // Leniency in the reader, not permission in the prompt: this pane exists to
    // show what the file says, and hiding a malformed control would hide the
    // defect instead of displaying it.
    const c = withControl('<Item1 Ref="2" ControlType="XRCheckBox" Name="c" Checked="true" Text="x" SizeF="200,20" LocationFloat="0,0" />');
    expect(c.checkState).toBe('checked');
  });

  it('leaves checkState null on every other control type', () => {
    const c = withControl('<Item1 Ref="2" ControlType="XRLabel" Name="l" Text="x" SizeF="200,20" LocationFloat="0,0" />');
    expect(c.checkState).toBeNull();
  });
});

/**
 * A band whose ItemN number collides with one of its own controls.
 *
 * Item numbering restarts inside every collection, so a band `<Item2>` holding
 * two controls contains a control also named `<Item2 />` — self-closing,
 * because most controls have no children. The span reader used to count that
 * self-closing tag as a nesting level, find no matching `</Item2>`, and return
 * null for the band's inner XML.
 *
 * **Every control in that band then vanished from the Preview while the
 * exported REPX stayed perfectly correct** — the silent class this pane exists
 * to catch, occurring in the pane itself. Found on 2026-09-05.
 */
describe('a band numbered the same as one of its controls', () => {
  const band = (n: number, controls: string) =>
    parseReportStructure(
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
      `<Bands><Item${n} Ref="1" ControlType="DetailBand" Name="Detail" HeightF="100"><Controls>` +
      controls +
      `</Controls></Item${n}></Bands></XtraReportsLayoutSerializer>`
    ).bands[0];

  const label = (n: number) =>
    `<Item${n} Ref="${n + 10}" ControlType="XRLabel" Name="l${n}" Text="x" SizeF="100,20" LocationFloat="0,0" />`;

  it('keeps the controls when the collision is on the first item', () => {
    expect(band(1, label(1)).controls).toHaveLength(1);
  });

  it('keeps every control when a later one collides with the band', () => {
    // The realistic shape: ReportHeader is Item2 and its second control is too.
    expect(band(2, label(1) + label(2) + label(3)).controls).toHaveLength(3);
  });

  it('still reads a band whose number collides with nothing', () => {
    expect(band(4, label(1) + label(2)).controls).toHaveLength(2);
  });

  it('does not confuse a nested collection for the band closing early', () => {
    const table =
      '<Item1 Ref="20" ControlType="XRTable" Name="t" SizeF="700,20" LocationFloat="0,0">' +
      '<Rows><Item1 Ref="21" ControlType="XRTableRow" Name="r" Weight="1">' +
      '<Cells><Item1 Ref="22" ControlType="XRTableCell" Name="c" Text="A" Weight="1" /></Cells>' +
      '</Item1></Rows></Item1>';
    const result = band(1, table + label(2));
    expect(result.controls.map((c) => c.type)).toEqual(['XRTable', 'XRLabel']);
    expect(result.controls[0].rows[0].cells[0].text).toBe('A');
  });
});

/**
 * Panels, and the coordinate system that makes them worth testing.
 *
 * `RepxProbe emit-container` measured it: a child's LocationFloat is written
 * verbatim and MEANS panel-relative, so a child at "10,10" inside a panel at
 * "100,100" prints at 110,110. The parser keeps x/y exactly as the file has
 * them -- an edit writes that number straight back -- and carries the panel's
 * position separately for the renderer to add.
 */
describe('panels', () => {
  const withBand = (controls: string) =>
    parseReportStructure(
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
      '<Bands><Item9 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="300"><Controls>' +
      controls +
      '</Controls></Item9></Bands></XtraReportsLayoutSerializer>'
    ).bands[0].controls;

  const panel =
    '<Item1 Ref="2" ControlType="XRPanel" Name="p" LocationFloat="100,100" SizeF="400,80" Borders="All"><Controls>' +
    '<Item1 Ref="3" ControlType="XRLabel" Name="inA" Text="A" LocationFloat="10,10" SizeF="200,20" />' +
    '<Item2 Ref="4" ControlType="XRLabel" Name="inB" Text="B" LocationFloat="10,40" SizeF="200,20" />' +
    '</Controls></Item1>';

  it('reads the panel and flattens its children in after it', () => {
    expect(withBand(panel).map((c) => c.name)).toEqual(['p', 'inA', 'inB']);
  });

  it('keeps a child x/y exactly as the file writes them', () => {
    // The value an edit writes back has to be the panel-relative one, so the
    // parser must not fold the offset in.
    const inA = withBand(panel).find((c) => c.name === 'inA')!;
    expect(inA.x).toBe(10);
    expect(inA.y).toBe(10);
  });

  it('carries the panel position as the child offset', () => {
    const [p, inA, inB] = withBand(panel);
    expect([p.offsetX, p.offsetY]).toEqual([0, 0]);
    expect([inA.offsetX, inA.offsetY]).toEqual([100, 100]);
    expect([inB.offsetX, inB.offsetY]).toEqual([100, 100]);
  });

  it('gives a control outside any panel a zero offset', () => {
    const plain = '<Item1 Ref="2" ControlType="XRLabel" Name="out" Text="x" LocationFloat="10,10" SizeF="100,20" />';
    expect(withBand(plain)[0].offsetX).toBe(0);
  });

  it('reads an empty panel without inventing children', () => {
    const empty = '<Item1 Ref="2" ControlType="XRPanel" Name="p" LocationFloat="0,0" SizeF="100,20" />';
    expect(withBand(empty).map((c) => c.name)).toEqual(['p']);
  });

  it('does not read a table row as a panel child', () => {
    // The depth guard that stops a table's cells being read as band controls
    // has to keep working now that one nesting level IS followed.
    const table =
      '<Item1 Ref="2" ControlType="XRTable" Name="t" LocationFloat="0,0" SizeF="700,20">' +
      '<Rows><Item1 Ref="3" ControlType="XRTableRow" Name="r" Weight="1">' +
      '<Cells><Item1 Ref="4" ControlType="XRTableCell" Name="c" Text="A" Weight="1" /></Cells>' +
      '</Item1></Rows></Item1>';
    expect(withBand(table).map((c) => c.name)).toEqual(['t']);
  });
});

/**
 * Shapes, and the default that is a real answer rather than a missing one.
 *
 * `RepxProbe emit-rich` measured it: the figure lives in a <Shape ShapeName>
 * child, and Ellipse writes NO element at all because it is the default. So an
 * XRShape with no child is a circle. Reading that as "unknown" would draw blank
 * space where DevExpress draws a filled ellipse -- the same class as CanGrow,
 * where absence means something specific.
 */
describe('shapes', () => {
  const shape = (child: string) =>
    parseReportStructure(
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
      '<Bands><Item9 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="200"><Controls>' +
      `<Item1 Ref="2" ControlType="XRShape" Name="s" SizeF="100,80" LocationFloat="0,0">${child}</Item1>` +
      '</Controls></Item9></Bands></XtraReportsLayoutSerializer>'
    ).bands[0].controls[0];

  it('reads the named figure', () => {
    expect(shape('<Shape Ref="3" ShapeName="Rectangle" />').shape).toBe('Rectangle');
    expect(shape('<Shape Ref="3" ShapeName="Line" />').shape).toBe('Line');
  });

  it('reads a shape with no child as an ellipse, because that is the default', () => {
    expect(shape('').shape).toBe('Ellipse');
  });

  it('reads a figure carrying its own parameter', () => {
    expect(shape('<Shape Ref="3" StarPointCount="6" ShapeName="Star" />').shape).toBe('Star');
  });

  it('leaves shape null on every other control type', () => {
    const label = parseReportStructure(
      '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
      '<Bands><Item9 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="50"><Controls>' +
      '<Item1 Ref="2" ControlType="XRLabel" Name="l" Text="x" SizeF="100,20" LocationFloat="0,0" />' +
      '</Controls></Item9></Bands></XtraReportsLayoutSerializer>'
    ).bands[0].controls[0];
    expect(label.shape).toBeNull();
  });

  it('does not read the next shape figure as this one', () => {
    // Two shapes in one band: the window has to be bounded by the control.
    const both = parseReportStructure(
      '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
      '<Bands><Item9 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="200"><Controls>' +
      '<Item1 Ref="2" ControlType="XRShape" Name="first" SizeF="100,80" LocationFloat="0,0" />' +
      '<Item2 Ref="3" ControlType="XRShape" Name="second" SizeF="100,80" LocationFloat="0,90"><Shape Ref="4" ShapeName="Star" /></Item2>' +
      '</Controls></Item9></Bands></XtraReportsLayoutSerializer>'
    ).bands[0].controls;
    expect(both.map((c) => c.shape)).toEqual(['Ellipse', 'Star']);
  });
});

/**
 * Watermarks, and the half that cannot be written.
 *
 * RepxProbe emit-mark: a TEXT watermark is six attributes; an IMAGE one is
 * ImageSource= carrying base64 -- 172 characters for a 4x4 bitmap. So the
 * parser reports a text watermark and reports null for an image one, which is
 * honest rather than lossy: the preview cannot draw a picture it does not have,
 * and a placeholder over every page would be worse than nothing.
 */
describe('watermarks', () => {
  const withMark = (mark: string) =>
    parseReportStructure(
      '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
      '<Bands><Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="20" /></Bands>' +
      mark +
      '</XtraReportsLayoutSerializer>'
    ).watermark;

  it('reads a text watermark with its appearance', () => {
    const mark = withMark('<Watermark Ref="7" Text="DRAFT" Font="Arial, 72pt, style=Bold" ForeColor="Silver" TextTransparency="150" TextDirection="BackwardDiagonal" />');
    expect(mark).toMatchObject({
      text: 'DRAFT', fontSize: 72, fontFamily: 'Arial', bold: true,
      color: 'Silver', transparency: 150, direction: 'BackwardDiagonal',
    });
  });

  it('reports null for an image watermark rather than half of one', () => {
    expect(withMark('<Watermark Ref="7" ImageSource="iVBORw0KGgo=" />')).toBeNull();
  });

  it('reports null when there is no watermark at all', () => {
    expect(withMark('')).toBeNull();
  });

  it('defaults transparency to opaque and direction to horizontal', () => {
    // DevExpress omits both when they are at their defaults, so absence is a
    // real answer here as it is for CanGrow and for a shape with no <Shape>.
    const mark = withMark('<Watermark Ref="7" Text="COPY" />');
    expect(mark?.transparency).toBe(255);
    expect(mark?.direction).toBe('Horizontal');
  });

  it('decodes entities in the caption', () => {
    expect(withMark('<Watermark Ref="7" Text="DRAFT &amp; COPY" />')?.text).toBe('DRAFT & COPY');
  });
});

/**
 * Multi-column detail, and the absence that means something.
 *
 * RepxProbe emit-cols: a band left alone writes NO <MultiColumn> element, so
 * null is "one column" rather than "not known" -- the same shape as CanGrow and
 * as a shape with no <Shape> child.
 */
describe('multi-column bands', () => {
  const band = (inner: string) =>
    parseReportStructure(
      '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
      `<Bands><Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="40">${inner}</Item1></Bands>` +
      '</XtraReportsLayoutSerializer>'
    ).bands[0];

  it('reads the declaration', () => {
    const b = band('<MultiColumn Ref="3" ColumnCount="3" ColumnSpacing="20" Layout="AcrossThenDown" Mode="UseColumnCount" />');
    expect(b.columns).toEqual({ count: 3, width: 0, spacing: 20, layout: 'AcrossThenDown', mode: 'UseColumnCount' });
  });

  it('reports null for a band that declares none', () => {
    expect(band('<Controls />').columns).toBeNull();
  });

  it('reads Layout, which is what the obsolete Direction property serializes as', () => {
    expect(band('<MultiColumn Ref="3" ColumnCount="2" Layout="DownThenAcross" />').columns?.layout).toBe('DownThenAcross');
  });

it('reads an absent Layout as DownThenAcross, which is the default', () => {
    // Measured with `RepxProbe render-cols`: with no Layout attribute, twelve
    // records filled the first column before any reached the second. This
    // parser said AcrossThenDown until that measurement, and every fixture set
    // Layout explicitly -- so the wrong default was invisible to the suite,
    // which is why it gets a case of its own.
    const b = band('<MultiColumn Ref="3" ColumnCount="2" ColumnSpacing="20" Mode="UseColumnCount" />');
    expect(b.columns?.layout).toBe('DownThenAcross');
  });

  it('paginates an unlabelled multi-column band down the first column', () => {
    const structure = parseReportStructure(
      '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PaperKind="Custom" PageWidth="900" PageHeight="1000">' +
      '<Bands><Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="100">' +
      '<MultiColumn Ref="2" ColumnCount="2" ColumnSpacing="20" Mode="UseColumnCount" />' +
      '<Controls><Item1 Ref="3" ControlType="XRLabel" Name="l" Text="x" SizeF="100,20" LocationFloat="0,0" /></Controls>' +
      '</Item1></Bands></XtraReportsLayoutSerializer>'
    );
    const placed = paginate(structure, 3).pages[0].bands.filter((b) => b.band.kind === 'Detail');
    // Down the first column, not across the row.
    expect(placed.map((b) => b.left)).toEqual([0, 0, 0]);
    expect(placed.map((b) => b.top)).toEqual([0, 100, 200]);
  });

  it('does not read a MultiColumn item as a control', () => {
    // It is a band-level child written BEFORE <Controls>, like SortFields and
    // GroupFields -- the third of them, and the reason that generalisation is
    // written down rather than rediscovered a fourth time.
    const b = band('<MultiColumn Ref="3" ColumnCount="2" /><Controls><Item1 Ref="4" ControlType="XRLabel" Name="l" Text="x" SizeF="10,10" LocationFloat="0,0" /></Controls>');
    expect(b.controls.map((c) => c.name)).toEqual(['l']);
  });
});

/**
 * Multi-column pagination.
 *
 * The one thing `place` cannot express: two records at the same height. So the
 * column flow is arithmetic on a rows x count grid rather than a vertical
 * cursor, and these tests are mostly about the grid being right at its edges --
 * the page break, the short first page, and the cursor left behind for whatever
 * follows the detail flow.
 */
describe('paginating into columns', () => {
  // A 900 by 1000 page needs PaperKind="Custom": without it DevExpress prints
  // Letter whatever the size written, and so does the Preview (parity row 44).
  const build = (count: number, layout: string, detailHeight: number, extra = '') =>
    parseReportStructure(
      '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PaperKind="Custom" PageWidth="900" PageHeight="1000">' +
      '<Bands>' +
      extra +
      `<Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="${detailHeight}">` +
      `<MultiColumn Ref="3" ColumnCount="${count}" ColumnSpacing="20" Layout="${layout}" Mode="UseColumnCount" />` +
      '<Controls><Item1 Ref="4" ControlType="XRLabel" Name="l" Text="x" SizeF="100,20" LocationFloat="0,0" /></Controls>' +
      '</Item2>' +
      '</Bands></XtraReportsLayoutSerializer>'
    );

  const details = (result: ReturnType<typeof paginate>, page = 0) =>
    result.pages[page].bands.filter((b) => b.band.kind === 'Detail');

  it('gives each column its share of the width, less the spacing', () => {
    // 900 wide, 3 columns, 20 spacing => (900 - 40) / 3.
    const placed = details(paginate(build(3, 'AcrossThenDown', 100), 3));
    expect(placed.map((b) => Math.round(b.width))).toEqual([287, 287, 287]);
    expect(placed.map((b) => Math.round(b.left))).toEqual([0, 307, 613]);
  });

  it('fills across then down', () => {
    const placed = details(paginate(build(2, 'AcrossThenDown', 100), 4));
    // Records 1,2 share the first row; 3,4 the second.
    expect(placed.map((b) => `${b.record}@${b.top},${Math.round(b.left)}`))
      .toEqual(['1@0,0', '2@0,460', '3@100,0', '4@100,460']);
  });

  it('fills down then across', () => {
    // 1000 tall, no margins or page furniture, detail 100 => 10 rows a page.
    const placed = details(paginate(build(2, 'DownThenAcross', 100), 4));
    // The first four go down the FIRST column, not across the row.
    expect(placed.map((b) => Math.round(b.left))).toEqual([0, 0, 0, 0]);
    expect(placed.map((b) => b.top)).toEqual([0, 100, 200, 300]);
  });

  it('breaks to a new page only when every column is full', () => {
    // 1000 / 250 = 4 rows, 2 columns => 8 per page.
    const result = paginate(build(2, 'AcrossThenDown', 250), 10);
    expect(result.pages).toHaveLength(2);
    expect(details(result, 0)).toHaveLength(8);
    expect(details(result, 1)).toHaveLength(2);
  });

  it('recomputes the grid for a shorter first page', () => {
    // A 400-unit ReportHeader leaves 600 on page one and 1000 after it, so the
    // first page fits fewer rows. Computing the grid once would under-fill
    // every later page, which reads as a bug in the report rather than here.
    // A control, or the header would take no room at all (parity row 41).
    const header = '<Item1 Ref="1" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="400"><Controls><Item1 Ref="5" ControlType="XRLabel" Name="t" Text="T" SizeF="100,20" /></Controls></Item1>';
    const result = paginate(build(2, 'AcrossThenDown', 200, header), 20);
    expect(details(result, 0)).toHaveLength(6);   // 3 rows x 2
    expect(details(result, 1)).toHaveLength(10);  // 5 rows x 2
  });

  it('leaves a single-column band exactly as it was', () => {
    // The regression that matters: everything without <MultiColumn> must be
    // untouched by this code path.
    const plain = parseReportStructure(
      '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PaperKind="Custom" PageWidth="900" PageHeight="1000">' +
      '<Bands><Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="100"><Controls><Item1 Ref="2" ControlType="XRLabel" Name="l" Text="x" SizeF="100,20" /></Controls></Item1></Bands></XtraReportsLayoutSerializer>'
    );
    const placed = details(paginate(plain, 3));
    expect(placed.map((b) => b.left)).toEqual([0, 0, 0]);
    expect(placed.map((b) => b.width)).toEqual([900, 900, 900]);
    expect(placed.map((b) => b.top)).toEqual([0, 100, 200]);
  });

  it('puts the report footer below the columns, not inside them', () => {
    const footer = '';
    const structure = build(2, 'AcrossThenDown', 100, footer);
    structure.bands.push({
      kind: 'ReportFooter', name: 'ReportFooter', height: 50, controls: [], columns: null, keepTogether: false,
      printOn: 'AllPages', printAtBottom: false, fields: [], level: 0, repeatEveryPage: false, groupUnion: 'None', pageBreak: 'None',
      sub: null, rules: [],
    });
    const result = paginate(structure, 4);
    const rf = result.pages[0].bands.find((b) => b.band.kind === 'ReportFooter')!;
    // Two rows of 100 used, so the footer starts at 200 rather than overlapping.
    expect(rf.top).toBe(200);
    expect(rf.left).toBe(0);
  });
});

/**
 * Gauges and sparklines, drawn as their SETTINGS rather than as data.
 *
 * RepxProbe emit-gauge: a gauge's numbers are flat attributes and
 * ViewType="Circular" is NEVER written because it is the default -- so an
 * absent view type is a dial, not an unknown. A sparkline needs no data source.
 */
describe('gauges and sparklines', () => {
  const control = (xml: string) =>
    parseReportStructure(
      '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
      '<Bands><Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="300"><Controls>' + xml +
      '</Controls></Item1></Bands></XtraReportsLayoutSerializer>'
    ).bands[0].controls[0];

  it('reads a circular gauge with its scale', () => {
    const g = control('<Item1 Ref="3" ControlType="XRGauge" Name="g" ActualValue="72" Minimum="0" Maximum="100" TargetValue="90" SizeF="200,200" LocationFloat="0,0" />');
    expect(g.meter).toEqual({ view: 'Circular', value: 72, target: 90, min: 0, max: 100, field: null, bound: null });
  });

  it('reads an absent ViewType as Circular, because that is the default', () => {
    expect(control('<Item1 Ref="3" ControlType="XRGauge" Name="g" SizeF="10,10" LocationFloat="0,0" />').meter?.view).toBe('Circular');
  });

  it('reads a linear gauge as linear', () => {
    expect(control('<Item1 Ref="3" ControlType="XRGauge" Name="g" ViewType="Linear" ActualValue="40" SizeF="10,10" LocationFloat="0,0" />').meter?.view).toBe('Linear');
  });

  it('names the bound property when the value is not a literal', () => {
    const g = control(
      '<Item1 Ref="3" ControlType="XRGauge" Name="g" SizeF="10,10" LocationFloat="0,0">' +
      '<ExpressionBindings><Item1 Ref="4" EventName="BeforePrint" PropertyName="ActualValue" Expression="[Pct]" /></ExpressionBindings></Item1>'
    );
    expect(g.meter?.value).toBeNull();
    expect(g.meter?.bound).toBe('ActualValue');
  });

  it('reads a sparkline field and view without needing a data source', () => {
    const s = control('<Item1 Ref="3" ControlType="XRSparkline" Name="s" DataMember="Monthly" ValueMember="Amount" SizeF="10,10" LocationFloat="0,0"><View Type="Bar" /><ValueRange Ref="4" /></Item1>');
    expect(s.meter?.field).toBe('Amount');
    expect(s.meter?.view).toBe('Bar');
  });

  it('leaves meter null on every other control type', () => {
    expect(control('<Item1 Ref="3" ControlType="XRLabel" Name="l" Text="x" SizeF="10,10" LocationFloat="0,0" />').meter).toBeNull();
  });
});

describe('bound fields, for the test-data preview', () => {
  const control = (xml: string) =>
    parseReportStructure(
      '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
      '<Bands><Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="300"><Controls>' + xml +
      '</Controls></Item1></Bands></XtraReportsLayoutSerializer>'
    ).bands[0].controls[0];

  it('reads the field a label\'s Text is bound to, in either attribute order', () => {
    const forward = control(
      '<Item1 Ref="3" ControlType="XRLabel" Name="l" Text="x" SizeF="10,10" LocationFloat="0,0">' +
        '<ExpressionBindings><Item1 Ref="4" EventName="BeforePrint" PropertyName="Text" Expression="[Company]" /></ExpressionBindings></Item1>',
    );
    expect(forward.field).toBe('Company');
    const reversed = control(
      '<Item1 Ref="3" ControlType="XRLabel" Name="l" Text="x" SizeF="10,10" LocationFloat="0,0">' +
        '<ExpressionBindings><Item1 Ref="4" Expression="sumSum([Amount])" PropertyName="Text" EventName="BeforePrint" /></ExpressionBindings></Item1>',
    );
    expect(reversed.field).toBe('Amount');
  });

  it('is null for a literal, and for a binding of some other property', () => {
    expect(control('<Item1 Ref="3" ControlType="XRLabel" Name="l" Text="x" SizeF="10,10" LocationFloat="0,0" />').field).toBeNull();
    const other = control(
      '<Item1 Ref="3" ControlType="XRLabel" Name="l" Text="x" SizeF="10,10" LocationFloat="0,0">' +
        '<ExpressionBindings><Item1 Ref="4" EventName="BeforePrint" PropertyName="ForeColor" Expression="[Overdue]" /></ExpressionBindings></Item1>',
    );
    expect(other.field).toBeNull();
  });

  it('reads each cell\'s own binding and not its neighbour\'s', () => {
    const table = control(
      '<Item1 Ref="3" ControlType="XRTable" Name="t" SizeF="400,20" LocationFloat="0,0"><Rows>' +
        '<Item1 Ref="4" ControlType="XRTableRow" Name="r" Weight="1"><Cells>' +
        '<Item1 Ref="5" ControlType="XRTableCell" Name="c1" Text="a" Weight="1"><ExpressionBindings><Item1 Ref="6" EventName="BeforePrint" PropertyName="Text" Expression="[Sku]" /></ExpressionBindings></Item1>' +
        '<Item2 Ref="7" ControlType="XRTableCell" Name="c2" Text="b" Weight="1" />' +
        '<Item3 Ref="8" ControlType="XRTableCell" Name="c3" Text="c" Weight="1"><ExpressionBindings><Item1 Ref="9" EventName="BeforePrint" PropertyName="Text" Expression="[Qty]" /></ExpressionBindings></Item3>' +
        '</Cells></Item1></Rows></Item1>',
    );
    expect(table.field).toBeNull();
    expect(table.rows[0].cells.map((c: { field: string | null }) => c.field)).toEqual(['Sku', null, 'Qty']);
  });
});

/*
 * Styles and inheritance, as DevExpress PRINTS them.
 *
 * Both fixtures were rendered through DevExpress 20.1 with `RepxProbe render`
 * on 2026-10-30 (row 3 of docs/proposals/devexpress-parity.md), and every
 * expectation below is what DevExpress actually drew for that control -- the
 * font, alignment and sides off its printed brick, and the colours it resolved.
 * Before this, the Preview read each control's own attributes and nothing else,
 * so a style sheet, which Forma's own style lift writes into most reports,
 * previewed as 9pt with no alignment and no borders.
 */
describe('styles and inheritance, as DevExpress prints them', () => {
  const doc = (root: string, bands: string, sheet: string) =>
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="R" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100" Version="20.1"${root}>` +
    `<Bands><Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />${bands}</Bands>` +
    `<StyleSheet>${sheet}</StyleSheet></XtraReportsLayoutSerializer>`;

  const S = '<Item1 Ref="30" Name="S" Font="Times New Roman, 14pt, style=Italic" ForeColor="Green" BackColor="LightBlue" TextAlignment="MiddleRight" Padding="8,8,4,4,100" Sides="All" BorderColor="Red" BorderWidth="3" />' +
    '<Item2 Ref="31" Name="T" ForeColor="Purple" />';

  const label = (n: number, name: string, attrs: string, children = '') =>
    children
      ? `<Item${n} Ref="${10 + n}" ControlType="XRLabel" Name="${name}" Text="${name}" LocationFloat="0,${n * 50}" SizeF="300,40" ${attrs}>${children}</Item${n}>`
      : `<Item${n} Ref="${10 + n}" ControlType="XRLabel" Name="${name}" Text="${name}" LocationFloat="0,${n * 50}" SizeF="300,40" ${attrs} />`;

  const props = doc('', '<Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="600"><Controls>' + [
    label(1, 'styleOnly', 'StyleName="S"'),
    label(2, 'ownAlignNoPriority', 'StyleName="S" TextAlignment="TopLeft"'),
    label(3, 'ownAlignPriority', 'StyleName="S" TextAlignment="TopLeft"', '<StylePriority UseTextAlignment="false" />'),
    label(4, 'ownBordersPriority', 'StyleName="S" Borders="None"', '<StylePriority UseBorders="false" />'),
    label(5, 'ownBackPriority', 'StyleName="S" BackColor="Yellow"', '<StylePriority UseBackColor="false" />'),
    label(6, 'ownPaddingPriority', 'StyleName="S" Padding="0,0,0,0,100"', '<StylePriority UsePadding="false" />'),
    label(7, 'ownBorderColorPriority', 'StyleName="S" BorderColor="Blue"', '<StylePriority UseBorderColor="false" />'),
    label(8, 'ownFontStyleSetsColour', 'StyleName="T" Font="Courier New, 9pt"'),
    label(9, 'dottedPriority', 'StyleName="S" Font="Arial, 20pt" StylePriority.UseFont="false"'),
    '<Item10 Ref="40" ControlType="XRTable" Name="tStyled" LocationFloat="400,100" SizeF="300,40" StyleName="S"><Rows>' +
      '<Item1 Ref="41" ControlType="XRTableRow" Name="tStyledRow" Weight="1"><Cells>' +
      '<Item1 Ref="42" ControlType="XRTableCell" Name="cellInherits" Text="I" Weight="1" />' +
      '<Item2 Ref="43" ControlType="XRTableCell" Name="cellOwnStyle" Text="J" Weight="1" StyleName="T" />' +
      '</Cells></Item1></Rows></Item10>',
    label(11, 'unknownStyle', 'StyleName="Missing" Font="Arial, 11pt"'),
  ].join('') + '</Controls></Item2>', S);

  const controls = parseReportStructure(props).bands.find((b) => b.kind === 'ReportHeader')!.controls;
  const byName = (name: string) => controls.find((c) => c.name === name)!;

  it('prints a style over the control, and lets a <StylePriority> child hand each property back', () => {
    // Font and alignment off DevExpress's printed bricks.
    expect(byName('styleOnly')).toMatchObject({ fontFamily: 'Times New Roman', fontSize: 14, italic: true, align: 'right', vAlign: 'middle' });
    expect(byName('styleOnly').borders).toEqual({ top: true, right: true, bottom: true, left: true });
    expect(byName('ownAlignNoPriority')).toMatchObject({ align: 'right', vAlign: 'middle' });
    expect(byName('ownAlignPriority')).toMatchObject({ align: 'left', vAlign: 'top' });
    expect(byName('ownBordersPriority').borders).toEqual({ top: false, right: false, bottom: false, left: false });
    expect(byName('ownBackPriority').appearance.BackColor).toBe('Yellow');
    expect(byName('ownPaddingPriority').appearance.Padding).toBe('0,0,0,0,100');
    expect(byName('ownBorderColorPriority').appearance.BorderColor).toBe('Blue');
    // Without the flag the style's value stands for every one of them.
    expect(byName('styleOnly').appearance).toEqual({
      Font: 'Times New Roman, 14pt, style=Italic', ForeColor: 'Green', BackColor: 'LightBlue',
      TextAlignment: 'MiddleRight', Padding: '8,8,4,4,100', Borders: 'All', BorderColor: 'Red',
    });
  });

  it('ignores a style\'s BorderWidth, which DevExpress printed 1 wide', () => {
    expect(byName('styleOnly').appearance.BorderWidth).toBeUndefined();
  });

  it('ignores the dotted StylePriority attribute, as DevExpress does', () => {
    expect(byName('dottedPriority')).toMatchObject({ fontFamily: 'Times New Roman', fontSize: 14 });
  });

  it('keeps a control\'s own value for a property its style does not set', () => {
    expect(byName('ownFontStyleSetsColour')).toMatchObject({ fontFamily: 'Courier New', fontSize: 9 });
    expect(byName('ownFontStyleSetsColour').appearance.ForeColor).toBe('Purple');
  });

  it('falls back to the control\'s own attributes when the style does not exist', () => {
    expect(byName('unknownStyle')).toMatchObject({ fontFamily: 'Arial', fontSize: 11 });
  });

  it('carries a table\'s style into its cells, fill and sides included, under a cell\'s own style', () => {
    const [inherits, own] = byName('tStyled').rows[0].cells;
    expect(inherits).toMatchObject({ fontFamily: 'Times New Roman', fontSize: 14, italic: true, align: 'right', vAlign: 'middle' });
    expect(inherits.appearance).toMatchObject({ BackColor: 'LightBlue', Borders: 'All', ForeColor: 'Green' });
    expect(own.appearance).toMatchObject({ ForeColor: 'Purple', BackColor: 'LightBlue', Font: 'Times New Roman, 14pt, style=Italic' });
  });

  const inherit = doc(
    ' Font="Verdana, 11pt" ForeColor="Maroon"',
    '<Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="300" Font="Georgia, 13pt" Borders="All" Padding="6,6,6,6,100" TextAlignment="MiddleCenter" BackColor="Lavender"><Controls>' +
      '<Item1 Ref="10" ControlType="XRLabel" Name="inBand" Text="band child" LocationFloat="0,0" SizeF="300,40" />' +
      '<Item2 Ref="11" ControlType="XRPanel" Name="panel" LocationFloat="0,60" SizeF="400,120" Borders="Left" BackColor="Wheat" ForeColor="Teal" StyleName="P"><Controls>' +
      '<Item1 Ref="12" ControlType="XRLabel" Name="inPanel" Text="panel child" LocationFloat="10,10" SizeF="300,40" />' +
      '<Item2 Ref="13" ControlType="XRLabel" Name="inPanelOwn" Text="own teal" LocationFloat="10,60" SizeF="300,40" ForeColor="Teal" />' +
      '</Controls></Item2></Controls></Item2>' +
      '<Item3 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="60"><Controls>' +
      '<Item1 Ref="20" ControlType="XRLabel" Name="inDetail" Text="detail child" LocationFloat="0,0" SizeF="300,40" />' +
      '</Controls></Item3>',
    '<Item1 Ref="30" Name="P" Font="Courier New, 8pt" />',
  );
  const all = parseReportStructure(inherit).bands.flatMap((b) => b.controls);
  const named = (name: string) => all.find((c) => c.name === name)!;

  it('inherits the report\'s font and colour into a band that sets neither', () => {
    expect(named('inDetail')).toMatchObject({ fontFamily: 'Verdana', fontSize: 11, align: 'left', vAlign: 'top' });
    expect(named('inDetail').appearance.ForeColor).toBe('Maroon');
    expect(named('inDetail').borders).toEqual({ top: false, right: false, bottom: false, left: false });
  });

  it('inherits a band\'s font, borders, padding, alignment and fill into its controls', () => {
    expect(named('inBand')).toMatchObject({ fontFamily: 'Georgia', fontSize: 13, align: 'center', vAlign: 'middle' });
    expect(named('inBand').borders).toEqual({ top: true, right: true, bottom: true, left: true });
    expect(named('inBand').appearance).toMatchObject({ Padding: '6,6,6,6,100', BackColor: 'Lavender', ForeColor: 'Maroon' });
  });

  it('drops a panel\'s own ForeColor, as DevExpress did, while its style and fill reach its children', () => {
    expect(named('panel').appearance.ForeColor).toBe('Maroon');
    expect(named('inPanel')).toMatchObject({ fontFamily: 'Courier New', fontSize: 8 });
    expect(named('inPanel').appearance).toMatchObject({ ForeColor: 'Maroon', BackColor: 'Wheat', Borders: 'Left' });
    expect(named('inPanelOwn').appearance.ForeColor).toBe('Teal');
  });

  it('prints in DevExpress 20.1\'s default font when nothing sets one', () => {
    const bare = doc('', '<Item2 Ref="3" ControlType="DetailBand" Name="Detail" HeightF="30"><Controls>' +
      '<Item1 Ref="4" ControlType="XRLabel" Name="plain" Text="x" LocationFloat="0,0" SizeF="100,20" /></Controls></Item2>', '');
    const plain = parseReportStructure(bare).bands.find((b) => b.kind === 'Detail')!.controls[0];
    expect(plain).toMatchObject({ fontFamily: 'Times New Roman', fontSize: 9.75, bold: false, align: 'left', vAlign: 'top' });
  });

  it('previews a report the same before and after Forma\'s own style lift', () => {
    // The lift moves shared appearance onto a <StyleSheet>; with styles now
    // resolved, the Preview must not be able to tell the difference.
    const HEAD = 'Font="Arial, 12pt, style=Bold" ForeColor="#1A2B3C" TextAlignment="MiddleCenter" Borders="Bottom"';
    const BODY = 'Font="Arial, 9pt" TextAlignment="TopRight"';
    const before = doc('', '<Item2 Ref="3" ControlType="DetailBand" Name="Detail" HeightF="200"><Controls>' + [
      label(1, 'h1', HEAD), label(2, 'h2', HEAD), label(3, 'h3', HEAD),
      label(4, 'b1', BODY), label(5, 'b2', BODY), label(6, 'b3', BODY), label(7, 'odd', 'Font="Arial, 10pt"'),
    ].join('') + '</Controls></Item2>', '').replace('<StyleSheet></StyleSheet>', '');
    const lifted = liftStyles(before);
    expect(lifted.applied).toBe(true);
    const look = (xml: string) => parseReportStructure(xml).bands.flatMap((b) => b.controls)
      .map(({ name, fontSize, fontFamily, bold, italic, align, vAlign, borders }) => ({ name, fontSize, fontFamily, bold, italic, align, vAlign, borders }));
    expect(look(lifted.xml)).toEqual(look(before));
  });
});

/*
 * Side margins and the printable width, as DevExpress PRINTS them.
 *
 * Every expectation here is a position DevExpress 20.1 drew for the same
 * report through `RepxProbe render` on 2026-10-30 (row 4 of
 * docs/proposals/devexpress-parity.md). Before this, every band was placed at
 * the page's left edge across its full width, so with a 60-unit left margin
 * every control previewed 60 units left of where it prints.
 */
describe('side margins and the printable width, as DevExpress prints them', () => {
  const withMargins = (margins: string, detailInner: string, header = '') =>
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="R" ReportUnit="HundredthsOfAnInch" Margins="${margins}" PageWidth="850" PageHeight="1100" Version="20.1">` +
    '<Bands><Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />' +
    `<Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="100"><Controls>${header || '<Item1 Ref="10" ControlType="XRLabel" Name="atOrigin" Text="ORIGIN" LocationFloat="0,0" SizeF="100,20" />'}</Controls></Item2>` +
    `<Item3 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="25">${detailInner}<Controls><Item1 Ref="13" ControlType="XRLabel" Name="cell" Text="cell" LocationFloat="0,0" SizeF="100,20" /></Controls></Item3>` +
    '<Item4 Ref="6" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" /></Bands></XtraReportsLayoutSerializer>';

  const detailSlots = (xml: string, records = 6) =>
    paginate(parseReportStructure(xml), records).pages[0].bands
      .filter((b) => b.record !== null)
      .map((b) => ({ record: b.record, left: b.left, width: b.width }));

  it('reads all four margins, in the order DevExpress writes them', () => {
    expect(parseReportStructure(withMargins('60, 40, 50, 30', '')).margins).toEqual({ left: 60, right: 40, top: 50, bottom: 30 });
  });

  it('starts every band at the left margin, as wide as the page less both margins', () => {
    // DevExpress printed the label at band 0,0 at page 60,50, and the printable width was 750.
    const report = paginate(parseReportStructure(withMargins('60, 40, 50, 50', '')), 3);
    expect(report.content).toEqual({ left: 60, width: 750 });
    for (const placed of report.pages[0].bands) {
      expect(placed.left).toBe(60);
      expect(placed.width).toBe(750);
    }
    expect(report.pages[0].bands[0]).toMatchObject({ top: 50 });
  });

  it('leaves a report with no side margins exactly where it was', () => {
    const report = paginate(parseReportStructure(withMargins('0, 0, 0, 0', '')), 2);
    expect(report.content).toEqual({ left: 0, width: 850 });
    expect(report.pages[0].bands.every((b) => b.left === 0 && b.width === 850)).toBe(true);
  });

  it('never makes the printable width negative', () => {
    expect(paginate(parseReportStructure(withMargins('500, 500, 0, 0', '')), 1).content.width).toBe(0);
  });

  it('prints one column for a ColumnCount with no Mode, as DevExpress did', () => {
    const slots = detailSlots(withMargins('60, 40, 50, 50', '<MultiColumn Ref="5" ColumnCount="2" ColumnSpacing="20" Layout="AcrossThenDown" />'));
    expect(slots.every((s) => s.left === 60 && s.width === 750)).toBe(true);
    expect(parseReportStructure(withMargins('0, 0, 0, 0', '<MultiColumn Ref="5" ColumnCount="2" />')).bands
      .find((b) => b.kind === 'Detail')!.columns!.mode).toBe('None');
  });

  it('divides the printable width for UseColumnCount: the second column at 385, each 365 wide', () => {
    const slots = detailSlots(withMargins('60, 40, 50, 50', '<MultiColumn Ref="5" ColumnCount="2" ColumnSpacing="20" Layout="AcrossThenDown" Mode="UseColumnCount" />'));
    expect(slots.slice(0, 2)).toEqual([
      { record: 1, left: 60, width: 365 },
      { record: 2, left: 60 + 385, width: 365 },
    ]);
  });

  it('fits as many declared-width columns as the printable width holds for UseColumnWidth', () => {
    // 200 wide with 20 spacing over 750: DevExpress printed three, at 0, 220 and 440.
    const slots = detailSlots(withMargins('60, 40, 50, 50', '<MultiColumn Ref="5" ColumnWidth="200" ColumnSpacing="20" Layout="AcrossThenDown" Mode="UseColumnWidth" />'));
    expect(slots.slice(0, 4)).toEqual([
      { record: 1, left: 60, width: 200 },
      { record: 2, left: 60 + 220, width: 200 },
      { record: 3, left: 60 + 440, width: 200 },
      { record: 4, left: 60, width: 200 },
    ]);
  });

  it('decides the columns DevExpress prints from the declaration and the printable width', () => {
    const decl = (mode: string, count = 2, width = 0) => ({ count, width, spacing: 20, layout: 'AcrossThenDown', mode });
    expect(activeColumns(null, 750)).toBeNull();
    expect(activeColumns(decl('None', 3), 750)).toBeNull();
    expect(activeColumns(decl('UseColumnCount', 1), 750)).toBeNull();
    expect(activeColumns(decl('UseColumnWidth', 2, 0), 750)).toBeNull();
    // Wider than half the area: only one fits, which is one column.
    expect(activeColumns(decl('UseColumnWidth', 2, 400), 750)).toBeNull();
    expect(activeColumns(decl('UseColumnCount', 3), 750)).toEqual({ count: 3, width: (750 - 40) / 3, spacing: 20, layout: 'AcrossThenDown' });
  });

  it('says when a control runs past the right margin, which DevExpress prints on an extra page', () => {
    const past = withMargins('60, 40, 50, 50', '', '<Item1 Ref="10" ControlType="XRLabel" Name="intoMargin" Text="x" LocationFloat="700,30" SizeF="80,20" />');
    const problems = paginate(parseReportStructure(past), 1).problems;
    expect(problems.some((p) => p.includes('intoMargin') && p.includes('extra page'))).toBe(true);
    // To the edge and no further printed on one page.
    const toEdge = withMargins('60, 40, 50, 50', '', '<Item1 Ref="10" ControlType="XRLabel" Name="toEdge" Text="x" LocationFloat="550,60" SizeF="200,20" />');
    expect(paginate(parseReportStructure(toEdge), 1).problems.some((p) => p.includes('right margin'))).toBe(false);
  });
});

/*
 * Hidden controls. DevExpress 20.1 printed no brick and no text at all for a
 * label carrying Visible="false" (case c01 of
 * docs/proposals/devexpress-parity.md, row 5); the Preview drew it.
 */
describe('hidden controls, which DevExpress does not print', () => {
  const header = (controls: string) =>
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="R" Margins="0, 0, 0, 0" PageWidth="850" PageHeight="1100">' +
    `<Bands><Item1 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="300"><Controls>${controls}</Controls></Item1></Bands></XtraReportsLayoutSerializer>`;
  const visibleOf = (xml: string) =>
    Object.fromEntries(parseReportStructure(xml).bands[0].controls.map((c) => [c.name, c.visible]));

  it('marks a control hidden only when the file says Visible="false", in any case', () => {
    const xml = header(
      '<Item1 Ref="3" ControlType="XRLabel" Name="shown" Text="a" LocationFloat="0,0" SizeF="100,20" />' +
      '<Item2 Ref="4" ControlType="XRLabel" Name="hidden" Text="b" LocationFloat="0,30" SizeF="100,20" Visible="false" />' +
      '<Item3 Ref="5" ControlType="XRLabel" Name="hiddenCaps" Text="c" LocationFloat="0,60" SizeF="100,20" Visible="False" />' +
      '<Item4 Ref="6" ControlType="XRLabel" Name="explicitTrue" Text="d" LocationFloat="0,90" SizeF="100,20" Visible="true" />' +
      // Bound to data: whether it shows depends on the record, so it is drawn.
      '<Item5 Ref="7" ControlType="XRLabel" Name="bound" Text="e" LocationFloat="0,120" SizeF="100,20">' +
      '<ExpressionBindings><Item1 Ref="8" EventName="BeforePrint" PropertyName="Visible" Expression="[Paid]" /></ExpressionBindings></Item5>',
    );
    expect(visibleOf(xml)).toEqual({ shown: true, hidden: false, hiddenCaps: false, explicitTrue: true, bound: true });
  });

  it('keeps a hidden control in the list, so edits still address the controls after it', () => {
    const xml = header(
      '<Item1 Ref="3" ControlType="XRLabel" Name="hidden" Text="b" LocationFloat="0,0" SizeF="100,20" Visible="false" />' +
      '<Item2 Ref="4" ControlType="XRLabel" Name="after" Text="a" LocationFloat="0,30" SizeF="100,20" />',
    );
    expect(parseReportStructure(xml).bands[0].controls.map((c) => c.name)).toEqual(['hidden', 'after']);
  });

  it('hides everything inside a hidden panel', () => {
    const xml = header(
      '<Item1 Ref="3" ControlType="XRPanel" Name="panel" LocationFloat="0,0" SizeF="300,100" Visible="false"><Controls>' +
      '<Item1 Ref="4" ControlType="XRLabel" Name="child" Text="x" LocationFloat="10,10" SizeF="100,20" />' +
      '</Controls></Item1>',
    );
    expect(visibleOf(xml)).toEqual({ panel: false, child: false });
  });

  it('does not report a hidden control as running past the margin', () => {
    const xml = header('<Item1 Ref="3" ControlType="XRLabel" Name="ghost" Text="x" LocationFloat="800,0" SizeF="200,20" Visible="false" />');
    expect(paginate(parseReportStructure(xml), 1).problems.some((p) => p.includes('right margin'))).toBe(false);
  });
});

/*
 * Page numbers. Every expectation is the text DevExpress 20.1 printed for the
 * same control on page 1 of 2, and page 2 of 2, through `RepxProbe render` on
 * 2026-10-30 (row 15 of docs/proposals/devexpress-parity.md). The Preview drew
 * "n / N" for every one of them.
 */
describe('page numbers, as DevExpress prints them', () => {
  const footer = (controls: string) =>
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="R" Margins="0, 0, 0, 0" PageWidth="850" PageHeight="1100">' +
    `<Bands><Item1 Ref="2" ControlType="PageFooterBand" Name="PageFooter" HeightF="100"><Controls>${controls}</Controls></Item1></Bands></XtraReportsLayoutSerializer>`;
  const info = (n: number, name: string, attrs: string) =>
    `<Item${n} Ref="${n + 10}" ControlType="XRPageInfo" Name="${name}" ${attrs} LocationFloat="0,0" SizeF="180,20" />`;

  const controls = parseReportStructure(footer([
    info(1, 'piNumber', 'PageInfo="Number"'),
    info(2, 'piNumberOfTotal', 'PageInfo="NumberOfTotal"'),
    info(3, 'piTotal', 'PageInfo="Total"'),
    info(4, 'piRomLow', 'PageInfo="RomLowNumber"'),
    info(5, 'piRomHi', 'PageInfo="RomHiNumber"'),
    info(6, 'piDateFmt', 'PageInfo="DateTime" TextFormatString="{0:yyyy-MM-dd}"'),
    info(7, 'piNoneText', 'PageInfo="None" Text="static text"'),
    info(8, 'piNumberFmt', 'PageInfo="Number" TextFormatString="Page {0}"'),
    info(9, 'piStart', 'PageInfo="Number" StartPageNumber="5"'),
    info(10, 'piOfTotalFmt', 'PageInfo="NumberOfTotal" TextFormatString="{0} / {1}"'),
    info(11, 'piNoKind', ''),
    info(12, 'piTotalFmt', 'PageInfo="Total" TextFormatString="{0} pages"'),
    info(13, 'piEmptyFormatItem', 'PageInfo="NumberOfTotal" TextFormatString="{0:} of {1}"'),
  ].join(''))).bands[0].controls;

  const printed = (page: number) =>
    Object.fromEntries(controls.map((c) => [c.name, pageInfoText(c.pageInfo!, page, 2, new Date(2026, 9, 30))]));

  it('prints each kind and format the way DevExpress did on page 1 of 2', () => {
    expect(printed(1)).toEqual({
      piNumber: '1', piNumberOfTotal: '1/2', piTotal: '2', piRomLow: 'i', piRomHi: 'I',
      piDateFmt: '2026-10-30', piNoneText: '', piNumberFmt: 'Page 1', piStart: '5',
      piOfTotalFmt: '1 / 2', piNoKind: '1/2', piTotalFmt: '2 pages', piEmptyFormatItem: '1 of 2',
    });
  });

  it('and on page 2 of 2', () => {
    expect(printed(2)).toMatchObject({
      piNumber: '2', piNumberOfTotal: '2/2', piRomLow: 'ii', piRomHi: 'II',
      piNumberFmt: 'Page 2', piStart: '6', piOfTotalFmt: '2 / 2', piNoKind: '2/2', piEmptyFormatItem: '2 of 2',
    });
  });

  it('prints a DateTime with no format as the long date', () => {
    const date = parseReportStructure(footer(info(1, 'd', 'PageInfo="DateTime"'))).bands[0].controls[0];
    expect(pageInfoText(date.pageInfo!, 1, 1, new Date(2026, 9, 30))).toBe('Friday, October 30, 2026');
  });

  it('reads the settings, defaulting an absent kind to NumberOfTotal and decoding the format', () => {
    const [c] = parseReportStructure(footer(info(1, 'x', 'TextFormatString="&quot;{0}&quot; &amp; more"'))).bands[0].controls;
    expect(c.pageInfo).toEqual({ kind: 'NumberOfTotal', format: '"{0}" & more', start: 1 });
    // Only XRPageInfo carries one.
    const label = parseReportStructure(footer('<Item1 Ref="3" ControlType="XRLabel" Name="l" Text="a" LocationFloat="0,0" SizeF="10,10" />')).bands[0].controls[0];
    expect(label.pageInfo).toBeNull();
  });

  it('cannot know the user name in a browser, so says so', () => {
    const user = parseReportStructure(footer(info(1, 'u', 'PageInfo="UserName"'))).bands[0].controls[0];
    expect(pageInfoText(user.pageInfo!, 1, 1)).toBe('[user name]');
  });
});

/*
 * Colour, fill, padding and borders, as DevExpress PRINTS them. The table
 * expectations are the sides DevExpress drew on each cell through
 * `RepxProbe render` on 2026-10-30 (row 6 of docs/proposals/devexpress-parity.md).
 */
describe('colour, fill, padding and borders, as DevExpress prints them', () => {
  const table = (attrs: string, rows: string[][]) =>
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="R" Margins="0, 0, 0, 0" PageWidth="850" PageHeight="1100">' +
    '<Bands><Item1 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="200"><Controls>' +
    `<Item1 Ref="3" ControlType="XRTable" Name="t" LocationFloat="0,0" SizeF="300,50" ${attrs}><Rows>` +
    rows.map((cells, r) =>
      `<Item${r + 1} Ref="${10 + r}" ControlType="XRTableRow" Name="row${r}" Weight="1"><Cells>` +
      cells.map((cellAttrs, c) => `<Item${c + 1} Ref="${20 + r * 10 + c}" ControlType="XRTableCell" Name="r${r}c${c}" Text="x" Weight="1" ${cellAttrs} />`).join('') +
      `</Cells></Item${r + 1}>`).join('') +
    '</Rows></Item1></Controls></Item1></Bands></XtraReportsLayoutSerializer>';
  const sidesOf = (xml: string) =>
    parseReportStructure(xml).bands[0].controls[0].rows.flatMap((row) => row.cells.map((cell) => {
      const b = cell.borders;
      return [b.top && 'Top', b.right && 'Right', b.bottom && 'Bottom', b.left && 'Left'].filter(Boolean).join(', ') || 'None';
    }));

  it('draws each shared edge once, by the cell to the left or above', () => {
    // DevExpress drew: All | Top, Right, Bottom / Right, Bottom, Left | Right, Bottom.
    expect(sidesOf(table('Borders="All"', [['', ''], ['', '']]))).toEqual([
      'Top, Right, Bottom, Left', 'Top, Right, Bottom', 'Right, Bottom, Left', 'Right, Bottom',
    ]);
  });

  it('drops a cell\'s own edge, style and all, when its neighbour already draws it', () => {
    // DevExpress drew m1c2's red 3-wide left border not at all: m1c1 draws Right.
    expect(sidesOf(table('', [['Borders="Right"', 'Borders="Left" BorderColor="Red" BorderWidth="3"'], ['Borders="Top"', 'Borders="Bottom"']])))
      .toEqual(['Right', 'None', 'Top', 'Bottom']);
  });

  it('keeps a top edge when the cell above draws no bottom', () => {
    expect(sidesOf(table('', [['', ''], ['Borders="Top"', 'Borders="Top"']]))).toEqual(['None', 'None', 'Top', 'Top']);
  });

  it('compares across the table when the rows are split differently', () => {
    // One wide cell above two narrow ones: both narrow tops are under its bottom.
    const xml = table('', [['Borders="Bottom"'], ['Borders="Top"', 'Borders="Top"']]);
    expect(sidesOf(xml)).toEqual(['Bottom', 'None', 'None']);
  });

  it('reads the three colour forms the file writes', () => {
    expect(cssColor('Navy')).toBe('Navy');
    expect(cssColor('#FF8800')).toBe('#FF8800');
    expect(cssColor('255,200,220,240')).toBe('rgb(200, 220, 240)'); // printed as #C8DCF0
    expect(cssColor('128,0,0,255')).toBe('rgba(0, 0, 255, 0.502)');
    expect(cssColor('10, 20, 30')).toBe('rgb(10, 20, 30)');
    expect(cssColor('')).toBeUndefined();
    expect(cssColor(undefined)).toBeUndefined();
  });

  it('turns Padding into CSS pixels in CSS order', () => {
    // left, right, top, bottom, in hundredths: 10 hundredths is 9.6px.
    expect(cssPadding('10,10,5,5,100')).toBe('4.8px 9.6px 4.8px 9.6px');
    expect(cssPadding('20,5,3,3,100')).toBe('2.88px 4.8px 2.88px 19.2px');
    // A different unit in the fifth place: 96 per inch is already pixels.
    expect(cssPadding('8,8,4,4,96')).toBe('4px 8px 4px 8px');
    expect(cssPadding('2,2,0,0')).toBe('0px 1.92px 0px 1.92px');
    expect(cssPadding('nonsense')).toBeUndefined();
  });
});

/*
 * Growing text and split records, against what DevExpress PRINTED.
 *
 * The fixture is case c02 of docs/proposals/devexpress-parity.md: a 50-unit
 * Detail band of 9pt Arial labels over 30 records, rendered through DevExpress
 * 20.1 with `RepxProbe render` on 2026-10-30. The measurer returns the lines
 * DevExpress itself printed for each note -- which the browser's canvas was
 * shown to reproduce exactly -- so every expectation below is a position,
 * height or page DevExpress drew, and the test asks whether the layout engine
 * arrives at the same place from the same lines.
 */
describe('growing text and split records, as DevExpress prints them', () => {
  const LONG = 'The delivery was split across two vehicles because the second pallet missed the cut-off, and the customer asked for the balance to be invoiced separately once it arrives. ';
  const note = (i: number) => ['', 'Short note.', LONG.slice(0, 120), LONG + LONG, 'Paid on account.', (LONG + LONG + LONG + LONG).slice(0, 380)][i % 6];
  // The lines DevExpress printed for each long note, at 216pt in Arial 9pt.
  const DX_LINES: Record<string, string[]> = {
    [note(2)]: ['The delivery was split across two vehicles because', 'the second pallet missed the cut-off, and the customer', 'asked for the'],
    [note(3)]: [
      'The delivery was split across two vehicles because', 'the second pallet missed the cut-off, and the customer',
      'asked for the balance to be invoiced separately once', 'it arrives. The delivery was split across two vehicles',
      'because the second pallet missed the cut-off, and the', 'customer asked for the balance to be invoiced', 'separately once it arrives.',
    ],
    [note(5)]: [
      'The delivery was split across two vehicles because', 'the second pallet missed the cut-off, and the customer',
      'asked for the balance to be invoiced separately once', 'it arrives. The delivery was split across two vehicles',
      'because the second pallet missed the cut-off, and the', 'customer asked for the balance to be invoiced',
      'separately once it arrives. The delivery was split', 'across two vehi',
    ],
  };
  const dxMeasure = (text: string) => DX_LINES[text] ?? (text ? [text] : []);
  const rows = Array.from({ length: 30 }, (_, k) => {
    const i = k + 1;
    return { Customer: `C${String(i).padStart(4, '0')}`, Notes: note(i), Extra: i % 4 === 0 ? `Extra line for record ${i}` : '' };
  });

  const bound = (n: number, name: string, field: string, x: number, y: number, w: number, extra = '') =>
    `<Item${n} Ref="${20 + n}" ControlType="XRLabel" Name="${name}" Font="Arial, 9pt"${extra} LocationFloat="${x},${y}" SizeF="${w},20">` +
    `<ExpressionBindings><Item1 Ref="${40 + n}" EventName="BeforePrint" PropertyName="Text" Expression="[${field}]" /></ExpressionBindings></Item${n}>`;
  const c02 = (detailAttrs = '') =>
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="R" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100" Version="20.1">' +
    '<Bands><Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />' +
    `<Item2 Ref="3" ControlType="DetailBand" Name="Detail" HeightF="50"${detailAttrs}><Controls>` +
    bound(1, 'lblName', 'Customer', 0, 0, 150) +
    bound(2, 'lblGrow', 'Notes', 160, 0, 300) +
    bound(3, 'lblNoWrap', 'Notes', 470, 0, 120, ' WordWrap="false"') +
    bound(4, 'lblNoGrow', 'Notes', 600, 0, 150, ' CanGrow="false"') +
    '<Item5 Ref="25" ControlType="XRLabel" Name="lblBelow" Text="BELOW-GROW" Font="Arial, 9pt" LocationFloat="160,25" SizeF="300,20" />' +
    bound(6, 'lblShrink', 'Extra', 0, 25, 150, ' CanShrink="true"') +
    '</Controls></Item2>' +
    '<Item3 Ref="4" ControlType="PageFooterBand" Name="PageFooter" HeightF="30"><Controls>' +
    '<Item1 Ref="30" ControlType="XRPageInfo" Name="pageOfTotal" PageInfo="NumberOfTotal" TextFormatString="Page {0} of {1}" LocationFloat="0,5" SizeF="300,20" />' +
    '</Controls></Item3>' +
    '<Item4 Ref="5" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" /></Bands></XtraReportsLayoutSerializer>';

  const run = (detailAttrs = '') => paginate(parseReportStructure(c02(detailAttrs)), 30, { measure: dxMeasure, rows });
  const details = (page: { bands: PlacedBand[] }) => page.bands.filter((b) => b.band.kind === 'Detail');
  const control = (placed: PlacedBand, name: string) => placed.controls.find((pc) => pc.control.name === name)!;

  it('puts every record on the page DevExpress printed it on', () => {
    const report = run();
    expect(report.pages).toHaveLength(3); // DevExpress: 3 pages
    expect(details(report.pages[0]).map((b) => b.record)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(details(report.pages[1]).map((b) => b.record)).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    expect(details(report.pages[2]).map((b) => b.record)).toEqual([23, 24, 25, 26, 27, 28, 29, 30]);
  });

  it('grows each record by its text and stacks them where DevExpress did', () => {
    const tops = details(run().pages[0]).map((b) => b.top);
    // DevExpress's record tops on page 1.
    [50, 100, 175.2, 307.9, 357.9, 505, 555, 605, 680.2, 812.9, 862.9].forEach((y, i) => expect(tops[i]).toBeCloseTo(y, 1));
  });

  it('grows the label by lines x 1.15em + 1.5pt, and holds WordWrap=false and CanGrow=false to one line', () => {
    const page = run().pages[0];
    const record = (n: number) => details(page).find((b) => b.record === n)!;
    expect(control(record(2), 'lblGrow').height).toBeCloseTo(45.2, 1); // 3 lines
    expect(control(record(3), 'lblGrow').height).toBeCloseTo(102.7, 1); // 7 lines
    expect(control(record(5), 'lblGrow').height).toBeCloseTo(117.07, 1); // 8 lines
    expect(control(record(5), 'lblNoWrap').height).toBe(20);
    expect(control(record(5), 'lblNoGrow').height).toBe(20);
    expect(control(record(5), 'lblGrow').lines).toEqual(DX_LINES[note(5)]);
  });

  it('pushes everything that starts below a growing label down by its growth, beside it or under it', () => {
    const record5 = details(run().pages[0]).find((b) => b.record === 5)!;
    // DevExpress: BELOW-GROW at 25 + 97.07, and the shrink label beside it too.
    expect(control(record5, 'lblBelow').y).toBeCloseTo(122.07, 1);
    expect(control(record5, 'lblShrink').y).toBeCloseTo(122.07, 1);
    expect(record5.height).toBeCloseTo(147.07, 1);
  });

  it('shrinks an empty CanShrink label to nothing and a one-line one to its line', () => {
    const page = run().pages[0];
    expect(control(details(page).find((b) => b.record === 1)!, 'lblShrink').height).toBe(0);
    // DevExpress: 16.0 for "Extra line for record 4" -- 10.35pt plus 1.17pt.
    expect(control(details(page).find((b) => b.record === 4)!, 'lblShrink').height).toBeCloseTo(16.0, 1);
  });

  it('splits a record across the page break at a line, as DevExpress did with C0023', () => {
    const report = run();
    const first = details(report.pages[1]).find((b) => b.record === 23)!;
    const rest = details(report.pages[2]).find((b) => b.record === 23)!;
    // Page 2: from 912.9 to the page footer at 1020, with seven of the eight lines.
    expect(first.top).toBeCloseTo(912.9, 1);
    expect(first.height).toBeCloseTo(107.1, 1);
    expect(control(first, 'lblGrow').lines).toEqual(DX_LINES[note(5)].slice(0, 7));
    expect(control(first, 'lblName').y).toBe(0);
    // Page 3: the last line at the top, BELOW-GROW at 71.5 and the next record at 96.5.
    expect(rest.top).toBeCloseTo(50, 6);
    expect(control(rest, 'lblGrow').lines).toEqual(['across two vehi']);
    expect(rest.top + control(rest, 'lblBelow').y).toBeCloseTo(71.5, 1);
    expect(rest.height).toBeCloseTo(46.5, 1);
    expect(details(report.pages[2])[1].top).toBeCloseTo(96.5, 1);
  });

  it('moves the record whole to the next page with KeepTogether="true", as DevExpress did', () => {
    const report = run(' KeepTogether="true"');
    expect(details(report.pages[1]).map((b) => b.record).at(-1)).toBe(22);
    const moved = details(report.pages[2])[0];
    expect(moved.record).toBe(23);
    expect(moved.top).toBe(50);
    expect(moved.height).toBeCloseTo(147.07, 1);
    expect(details(report.pages[2])[1].top).toBeCloseTo(197.1, 1); // DevExpress: C0024 at 197.1
  });

  it('lays every control out at its designed size when there is no measurer', () => {
    const report = paginate(parseReportStructure(c02()), 30, { rows });
    for (const placed of report.pages.flatMap(details)) {
      for (const pc of placed.controls) {
        expect(pc.lines).toBeNull();
        expect(pc.height).toBe(pc.control.height);
      }
    }
  });

  it('splits a fixed-height record between its controls, as DevExpress did', () => {
    // Case s14, printed: a 50-unit record with labels at 0 and 25, after a
    // 30-unit report header. Record 20 had 20 units left on page 1, so its top
    // label printed there and its second continued 5 units into page 2 -- its
    // own gap below the cut -- with record 21 after it at 30.
    const xml =
      '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer Ref="1" Name="R" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100">' +
      '<Bands><Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />' +
      '<Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="30"><Controls><Item1 Ref="10" ControlType="XRLabel" Name="title" Text="TITLE" LocationFloat="0,0" SizeF="300,20" /></Controls></Item2>' +
      '<Item3 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="50"><Controls>' +
      '<Item1 Ref="11" ControlType="XRLabel" Name="top" Text="row" LocationFloat="0,0" SizeF="300,20" />' +
      '<Item2 Ref="13" ControlType="XRLabel" Name="bottom" Text="SECOND LINE" LocationFloat="0,25" SizeF="300,20" />' +
      '</Controls></Item3><Item4 Ref="5" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" /></Bands></XtraReportsLayoutSerializer>';
    const report = paginate(parseReportStructure(xml), 25);
    const page1 = details(report.pages[0]);
    const page2 = details(report.pages[1]);
    expect(page1.map((b) => b.record)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(page1[19].controls.map((pc) => pc.control.name)).toEqual(['top']);
    expect(page2[0]).toMatchObject({ record: 20, top: 50 });
    expect(page2[0].controls.map((pc) => [pc.control.name, pc.y])).toEqual([['bottom', 5]]);
    expect(page2[1]).toMatchObject({ record: 21, top: 80 }); // DevExpress: 30 into the page's content
  });
});

describe('layoutBand and splitInstance, the rules on their own', () => {
  const band = (controls: string, attrs = '', height = 100) =>
    parseReportStructure(
      '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer Ref="1" Name="R" ReportUnit="HundredthsOfAnInch" PageWidth="850" PageHeight="1100">' +
      `<Bands><Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="${height}"${attrs}><Controls>${controls}</Controls></Item1></Bands></XtraReportsLayoutSerializer>`,
    ).bands[0];
  const label = (n: number, name: string, text: string, y: number, h = 20, extra = '') =>
    `<Item${n} Ref="${10 + n}" ControlType="XRLabel" Name="${name}" Text="${text}" Font="Arial, 10pt"${extra} LocationFloat="0,${y}" SizeF="300,${h}" />`;
  // Each "L" in a text is one line; 10pt Arial spacing is 11.5pt, 15.97 units.
  const byL = (text: string) => (text ? Array.from({ length: Math.max(1, (text.match(/L/g) ?? []).length) }, (_, i) => `line ${i + 1}`) : []);
  const ctx = { measure: byL, unit: 'HundredthsOfAnInch' };
  const line = (11.5 / 72) * 100;
  const grown = (lines: number) => ((lines * 11.5 + 1.5) / 72) * 100;
  const by = (inst: { controls: { control: { name: string } }[] }, name: string) => inst.controls.find((pc) => pc.control.name === name) as PlacedControl;

  it('cascades push-down through a chain of growing controls', () => {
    const inst = layoutBand(band(label(1, 'a', 'LLL', 0) + label(2, 'b', 'LL', 25) + label(3, 'c', 'x', 50)), 1, null, ctx);
    const growthA = grown(3) - 20;
    const growthB = grown(2) - 20;
    expect(by(inst, 'b').y).toBeCloseTo(25 + growthA, 6);
    expect(by(inst, 'c').y).toBeCloseTo(50 + growthA + growthB, 6);
    expect(inst.height).toBeCloseTo(100 + growthA + growthB, 6);
  });

  // Parity row 36. Until it, a band saying CanGrow="false" was held at its
  // designed height, which nothing had measured: s29g printed it growing.
  it('grows a band with its text whatever the band\'s CanGrow says (s29g)', () => {
    const inst = layoutBand(band(label(1, 'a', 'LLLLL', 0), ' CanGrow="false"'), 1, null, ctx);
    expect(by(inst, 'a').height).toBeCloseTo(grown(5), 6);
    expect(inst.height).toBeCloseTo(100 + grown(5) - 20, 6);
  });

  it('prints a band at least to its lowest visible control, plus growth (s29a, s29d)', () => {
    // A label placed past the bottom holds the band open: 140 for a declared 100.
    expect(layoutBand(band(label(1, 'a', 'x', 0) + label(2, 'past', 'x', 120)), 1, null, ctx).height).toBe(140);
    // Growth above it pushes it down, and the band ends at its new bottom.
    const grownBand = layoutBand(band(label(1, 'a', 'LLL', 0) + label(2, 'past', 'x', 120)), 1, null, ctx);
    expect(by(grownBand, 'past').y).toBeCloseTo(120 + grown(3) - 20, 6);
    expect(grownBand.height).toBeCloseTo(140 + grown(3) - 20, 6);
    // A hidden control holds nothing open (s29e).
    expect(layoutBand(band(label(1, 'a', 'x', 0) + label(2, 'hidden', 'x', 150, 20, ' Visible="false"')), 1, null, ctx).height).toBe(100);
  });

  it('reads a control written above its band\'s top at 0, a panel\'s child too (s29e)', () => {
    const b = band(label(1, 'neg', 'x', -30) +
      '<Item2 Ref="30" ControlType="XRPanel" Name="pnl" LocationFloat="300,10" SizeF="200,60"><Controls>' +
      '<Item1 Ref="31" ControlType="XRLabel" Name="kid" Text="k" LocationFloat="0,-20" SizeF="100,20" /></Controls></Item2>');
    expect(b.controls.find((c) => c.name === 'neg')!.y).toBe(0);
    expect(b.controls.find((c) => c.name === 'kid')).toMatchObject({ y: 0, offsetY: 10 });
  });

  it('reads a control written left of its band\'s or panel\'s edge at 0 (parity row 42, s29e2)', () => {
    // DevExpress's loader read -30,10 back as 0,10, and a panel's child at -10,-20 as 0,0.
    const b = band('<Item1 Ref="20" ControlType="XRLabel" Name="negx" Text="x" LocationFloat="-30,10" SizeF="200,20" />' +
      '<Item2 Ref="30" ControlType="XRPanel" Name="pnl" LocationFloat="300,10" SizeF="200,60"><Controls>' +
      '<Item1 Ref="31" ControlType="XRLabel" Name="kidneg" Text="k" LocationFloat="-10,-20" SizeF="100,20" /></Controls></Item2>');
    expect(b.controls.find((c) => c.name === 'negx')).toMatchObject({ x: 0, y: 10 });
    expect(b.controls.find((c) => c.name === 'kidneg')).toMatchObject({ x: 0, y: 0, offsetX: 300, offsetY: 10 });
  });

  it('splits a text taller than several pages into consecutive parts, every line exactly once', () => {
    const lines = 'L'.repeat(200);
    const xml = '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer Ref="1" Name="R" ReportUnit="HundredthsOfAnInch" Margins="0, 0, 0, 0" PageWidth="850" PageHeight="1100">' +
      `<Bands><Item1 Ref="2" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="20"><Controls>${label(1, 'terms', lines, 0)}</Controls></Item1></Bands></XtraReportsLayoutSerializer>`;
    const report = paginate(parseReportStructure(xml), 0, { measure: byL });
    const parts = report.pages.flatMap((p) => p.bands.filter((b) => b.band.kind === 'ReportFooter'));
    expect(parts.length).toBe(Math.ceil(200 / Math.floor(1100 / line + 1e-6)));
    expect(parts.flatMap((b) => by(b, 'terms').lines)).toEqual(byL(lines));
  });

  it('splits a table between rows and moves a control that cannot split whole', () => {
    const table = '<Item1 Ref="11" ControlType="XRTable" Name="t" LocationFloat="0,0" SizeF="300,60" Font="Arial, 10pt"><Rows>' +
      [1, 2, 3].map((r) => `<Item${r} Ref="${20 + r}" ControlType="XRTableRow" Name="r${r}" Weight="1"><Cells><Item1 Ref="${30 + r}" ControlType="XRTableCell" Name="c${r}" Text="x" Weight="1" /></Cells></Item${r}>`).join('') +
      '</Rows></Item1>' +
      '<Item2 Ref="12" ControlType="XRPictureBox" Name="pic" LocationFloat="400,0" SizeF="100,60" />';
    const inst = layoutBand(band(table, '', 60), 1, null, ctx);
    const [first, rest] = splitInstance(inst, 45, 'HundredthsOfAnInch');
    expect(by(first!, 't').rowHeights).toEqual([20, 20]);
    expect(by(rest!, 't')).toMatchObject({ rowStart: 2, rowHeights: [20], y: 0 });
    // The picture crossed the cut and cannot be divided, so it continues whole.
    expect(first!.controls.some((pc) => pc.control.name === 'pic')).toBe(false);
    expect(by(rest!, 'pic')).toMatchObject({ y: 0, height: 60 });
  });

  // Parity row 40, measured in s29s: DevExpress cuts a record at the foot of
  // the page even when nothing prints above the cut, and carries the band's
  // blank remainder only when a control's box crossed the foot.
  it('continues from the cut when nothing fits above it, leaving the space above behind', () => {
    // s29s5: a label wholly below the cut continues at its own gap below it.
    const below = layoutBand(band(label(1, 'a', 'x', 35)), 1, null, ctx);
    const [none, rest] = splitInstance(below, 20, 'HundredthsOfAnInch');
    expect(none).toBeNull();
    expect(rest!.height).toBeCloseTo(80, 6);
    expect(by(rest!, 'a').y).toBeCloseTo(15, 6);
    // s29s3: one straddling the cut below a gap continues at the very top.
    const straddling = layoutBand(band(label(1, 'a', 'x', 20), '', 50), 1, null, ctx);
    const [none2, rest2] = splitInstance(straddling, 30, 'HundredthsOfAnInch');
    expect(none2).toBeNull();
    expect(by(rest2!, 'a').y).toBe(0);
    expect(rest2!.height).toBeCloseTo(30, 6);
  });

  it('continues the instance itself when there is no room at all', () => {
    const inst = layoutBand(band(label(1, 'a', 'x', 10)), 1, null, ctx);
    expect(splitInstance(inst, 0, 'HundredthsOfAnInch')).toEqual([null, inst]);
  });

  it('drops the blank remainder of a record whose controls all fit (s29s1)', () => {
    const inst = layoutBand(band(label(1, 'a', 'x', 0), '', 50), 1, null, ctx);
    const [first, rest] = splitInstance(inst, 30, 'HundredthsOfAnInch');
    expect(first!.controls.map((pc) => pc.control.name)).toEqual(['a']);
    expect(rest).toBeNull();
  });

  it('carries the remainder when a box crossed the foot while its line fit (s29s4)', () => {
    const inst = layoutBand(band(label(1, 'a', 'x', 0, 35), '', 50), 1, null, ctx);
    const [first, rest] = splitInstance(inst, 30, 'HundredthsOfAnInch');
    expect(by(first!, 'a').height).toBe(30);
    expect(rest).toMatchObject({ height: 20, controls: [] });
  });
});

/*
 * Cases s29s1, s29s3 and s29s5 of docs/proposals/devexpress-parity.md, printed
 * through DevExpress 20.1 on 2026-10-31: 70 fixed records under a 20-unit page
 * header, with 30 units (20 for the 60-unit record) left at the foot of each
 * page. Every position is the label DevExpress printed, from the page's top.
 */
/*
 * Cases s29a and s29b of docs/proposals/devexpress-parity.md, printed through
 * DevExpress 20.1 on 2026-10-31: every content band holds a label at its top
 * and one placed past its bottom, over three records. s29b says
 * CanGrow="false" on every band and printed exactly the same. Positions are
 * DevExpress's, from the page's top; the margin bands' labels are row 38's.
 */
describe('a band holds every control placed in it, as DevExpress printed it (cases s29a, s29b)', () => {
  const lbl = (ref: number, n: number, name: string, y: number) => `<Item${n} Ref="${ref}" ControlType="XRLabel" Name="${name}" Text="${name}" LocationFloat="${n === 1 ? 0 : 300},${y}" SizeF="200,20" />`;
  const bandXml = (n: number, type: string, height: number, past: number, extra: string) =>
    `<Item${n} Ref="${n}" ControlType="${type}Band" Name="${type}" HeightF="${height}"${extra}><Controls>${lbl(n * 10, 1, `${type}0`, 0)}${lbl(n * 10 + 1, 2, `${type}past`, past)}</Controls></Item${n}>`;
  const xml = (extra: string) =>
    '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer Ref="99" Name="R" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100">' +
    '<Bands>' + bandXml(1, 'ReportHeader', 100, 120, extra) + bandXml(2, 'PageHeader', 50, 60, extra) + bandXml(3, 'Detail', 30, 40, extra) +
    bandXml(4, 'ReportFooter', 50, 60, extra) + bandXml(5, 'PageFooter', 50, 60, extra) + '</Bands></XtraReportsLayoutSerializer>';
  const PRINTED = ['ReportHeader0 50', 'ReportHeaderpast 170', 'PageHeader0 190', 'PageHeaderpast 250',
    'Detail0 270', 'Detailpast 310', 'Detail0 330', 'Detailpast 370', 'Detail0 390', 'Detailpast 430',
    'ReportFooter0 450', 'ReportFooterpast 510', 'PageFooter0 970', 'PageFooterpast 1030'];

  for (const [name, extra] of [['s29a', ''], ['s29b', ' CanGrow="false"']]) {
    it(`prints ${name} where DevExpress did`, () => {
      const report = paginate(parseReportStructure(xml(extra)), 3);
      expect(report.pages).toHaveLength(1);
      const at = report.pages[0].bands.flatMap((b) => b.controls.map((pc) => ({ s: `${pc.text} ${Math.round(b.top + pc.y)}`, y: b.top + pc.y })));
      expect(at.sort((p, q) => p.y - q.y).map((t) => t.s)).toEqual(PRINTED);
    });
  }
});

/*
 * Parity row 37, cases s29c and s29h, printed through DevExpress 20.1 on
 * 2026-10-31: a panel is laid out like a small band. s29c's positions are
 * DevExpress's, from the band's top; s29h's growth is the test measurer's.
 */
describe('a panel laid out like a small band, as DevExpress printed it (cases s29c, s29h)', () => {
  const lbl = (ref: number, name: string, x: number, y: number, text = name, h = 20) =>
    `<Item${ref} Ref="${ref}" ControlType="XRLabel" Name="${name}" Text="${text}" Font="Arial, 10pt" LocationFloat="${x},${y}" SizeF="${x ? 200 : 150},${h}" />`;
  const panel = (ref: number, y: number, h: number, kids: string, extra = '') =>
    `<Item${ref} Ref="${ref}" ControlType="XRPanel" Name="p${ref}" LocationFloat="0,${y}" SizeF="300,${h}"${extra}><Controls>${kids}</Controls></Item${ref}>`;
  const band = (height: number, controls: string) => parseReportStructure(
    '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer Ref="1" Name="R" ReportUnit="HundredthsOfAnInch" PageWidth="850" PageHeight="1100">' +
    `<Bands><Item1 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="${height}"><Controls>${controls}</Controls></Item1></Bands></XtraReportsLayoutSerializer>`,
  ).bands[0];
  const ys = (inst: BandInstance) => Object.fromEntries(inst.controls.map((pc) => [pc.control.name, [Math.round(pc.y * 100) / 100, Math.round(pc.height * 100) / 100]]));

  it('grows a panel to hold a child past its bottom and pushes what is below it (s29c)', () => {
    const b = band(200, lbl(3, 'R0', 0, 0) + panel(4, 30, 50, lbl(41, 'kid0', 0, 0) + lbl(42, 'kidpast', 0, 40, 'kidpast', 30)) +
      lbl(5, 'below', 0, 90) + lbl(6, 'beside', 400, 30) + lbl(7, 'under', 0, 150));
    const inst = layoutBand(b, null, null, { measure: null, unit: 'HundredthsOfAnInch' });
    expect(ys(inst)).toEqual({ R0: [0, 20], p4: [30, 70], kid0: [30, 20], kidpast: [70, 30], below: [110, 20], beside: [30, 20], under: [170, 20] });
    expect(inst.height).toBe(220);
    expect(heldHeight(b)).toBe(200);
  });

  it('holds a panel that says CanGrow="false" at its height, pushing nothing (s29c)', () => {
    const b = band(200, lbl(3, 'F0', 0, 0) + panel(4, 30, 50, lbl(41, 'fkid0', 0, 0) + lbl(42, 'fkidpast', 0, 40, 'fkidpast', 30), ' CanGrow="false"') + lbl(5, 'fbelow', 0, 90));
    const inst = layoutBand(b, null, null, { measure: null, unit: 'HundredthsOfAnInch' });
    expect(ys(inst)).toEqual({ F0: [0, 20], p4: [30, 50], fkid0: [30, 20], fkidpast: [70, 30], fbelow: [90, 20] });
    expect(inst.height).toBe(200);
  });

  it('lays a growing child out inside its panel and pushes only what is below the panel (s29h)', () => {
    // Each "L" is one line of 10pt Arial: 11.5pt spacing plus 1.5pt.
    const byL = (text: string) => Array.from({ length: Math.max(1, (text.match(/L/g) ?? []).length) }, (_, i) => `line ${i + 1}`);
    const growth = ((3 * 11.5 + 1.5) / 72) * 100 - 20;
    const b = band(150, panel(4, 10, 60, lbl(41, 'grow', 0, 0, 'LLL') + lbl(42, 'sib', 0, 30)) +
      lbl(5, 'below', 0, 80) + lbl(6, 'beside', 400, 10) + lbl(7, 'nextto', 400, 40));
    const inst = layoutBand(b, null, null, { measure: byL, unit: 'HundredthsOfAnInch' });
    const at = ys(inst);
    expect(at.p4[1]).toBeCloseTo(60 + growth, 1);
    expect(at.sib[0]).toBeCloseTo(40 + growth, 1);
    expect(at.below[0]).toBeCloseTo(80 + growth, 1);
    // Below the growing child's bottom in band terms, but beside the panel: it stays.
    expect(at.nextto[0]).toBe(40);
    expect(at.beside[0]).toBe(10);
    expect(inst.height).toBeCloseTo(150 + growth, 1);
  });
});

/*
 * Parity row 39, cases s29n1 to s29n5, printed through DevExpress 20.1 on
 * 2026-10-31 over three records named alpha, beta and gamma: a report with no
 * Detail band prints its report bands once, no group band, and "?" for every
 * total. Until this row the Preview printed each group and said "Preview
 * stopped at Infinity pages; 3 of 3 records are not shown".
 */
describe('a report with data and no Detail band, as DevExpress printed it (cases s29n)', () => {
  const ROWS = [{ Name: 'alpha' }, { Name: 'beta' }, { Name: 'gamma' }];
  const bound = (ref: number, name: string, y: number, expression: string, running = '') =>
    `<Item${ref} Ref="${ref}" ControlType="XRLabel" Name="${name}" LocationFloat="0,${y}" SizeF="200,20">` +
    (running ? `<Summary Ref="${ref}1" Running="${running}" />` : '') +
    `<ExpressionBindings><Item1 Ref="${ref}2" EventName="BeforePrint" PropertyName="Text" Expression="${expression}" /></ExpressionBindings></Item${ref}>`;
  const xml = (bands: string) => parseReportStructure(
    '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer Ref="1" Name="R" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100" DataMember="Items">' +
    `<Bands>${bands}</Bands></XtraReportsLayoutSerializer>`);
  const texts = (r: PaginatedReport) => r.pages.flatMap((p) => p.bands.flatMap((b) => b.controls.map((pc) => `${b.band.kind}:${pc.text}`)));

  it('prints the report header and footer, no group band, and "?" for a total (s29n1)', () => {
    const s = xml(
      '<Item1 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="30"><Controls><Item1 Ref="20" ControlType="XRLabel" Name="RH" Text="RH" SizeF="200,20" /></Controls></Item1>' +
      `<Item2 Ref="3" ControlType="GroupHeaderBand" Name="GroupHeader1" HeightF="30"><GroupFields><Item1 Ref="30" FieldName="Name" /></GroupFields><Controls>${bound(31, 'G', 0, '[Name]')}</Controls></Item2>` +
      `<Item3 Ref="4" ControlType="GroupFooterBand" Name="GroupFooter1" HeightF="30"><Controls>${bound(41, 'gcnt', 0, 'sumCount([Name])', 'Group')}</Controls></Item3>` +
      `<Item4 Ref="5" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="30"><Controls>${bound(51, 'cnt', 0, 'sumCount([Name])', 'Report')}</Controls></Item4>`);
    const r = paginate(s, ROWS.length, { rows: ROWS });
    expect(texts(r)).toEqual(['ReportHeader:RH', 'ReportFooter:?']);
    expect(r.problems.join(' ')).not.toMatch(/records are not shown/);
  });

  it('reads the first record in the header and the last in the footer (s29n4)', () => {
    const s = xml(
      `<Item1 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="30"><Controls>${bound(21, 'RHname', 0, '[Name]')}${bound(22, 'RHcount', 0, 'sumCount([Name])', 'Report')}</Controls></Item1>` +
      `<Item2 Ref="5" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="30"><Controls>${bound(51, 'RFname', 0, '[Name]')}</Controls></Item2>`);
    expect(texts(paginate(s, ROWS.length, { rows: ROWS }))).toEqual(['ReportHeader:alpha', 'ReportHeader:?', 'ReportFooter:gamma']);
  });

  it('says nothing about records without test data either', () => {
    const s = xml('<Item1 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="30"><Controls><Item1 Ref="20" ControlType="XRLabel" Name="RH" Text="RH" SizeF="200,20" /></Controls></Item1>');
    expect(paginate(s, 1).problems).toEqual([]);
  });

  it('says DevExpress refuses a report with a detail report and no Detail band of its own (s29n5)', () => {
    const s = xml('<Item1 Ref="2" ControlType="DetailReportBand" Name="DetailReport"><Bands><Item1 Ref="3" ControlType="DetailBand" Name="LinesDetail" HeightF="20" /></Bands></Item1>');
    expect(paginate(s, ROWS.length, { rows: ROWS }).problems.join(' ')).toMatch(/DevExpress will not print this report/);
  });
});

/*
 * Parity row 38, case s29m, printed through DevExpress 20.1 on 2026-10-31: 70
 * records under labels and a page number in both margin bands, the bands 80
 * and 70 tall over declared margins of 50. Positions are DevExpress's, from
 * the page's top; the CSV is the first and last lines of DevExpress's own.
 */
describe('controls in the margin bands, as DevExpress printed them (case s29m)', () => {
  const lbl = (ref: number, name: string, x: number, y: number) =>
    `<Item${ref % 10} Ref="${ref}" ControlType="XRLabel" Name="${name}" Text="${name}" LocationFloat="${x},${y}" SizeF="300,20" />`;
  const xml =
    '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer Ref="1" Name="R" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100">' +
    `<Bands><Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="80"><Controls>${lbl(21, 'TMtitle', 0, 10)}${lbl(22, 'TMright', 450, 50)}</Controls></Item1>` +
    `<Item2 Ref="3" ControlType="PageHeaderBand" Name="PageHeader" HeightF="30"><Controls>${lbl(31, 'PH', 0, 0)}</Controls></Item2>` +
    `<Item3 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="30"><Controls>${lbl(41, 'row', 0, 0)}</Controls></Item3>` +
    '<Item4 Ref="5" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="70"><Controls>' +
    '<Item1 Ref="51" ControlType="XRPageInfo" Name="BMpage" TextFormatString="Page {0} of {1}" LocationFloat="0,10" SizeF="300,20" />' +
    `${lbl(52, 'BMlit', 450, 40)}</Controls></Item4></Bands></XtraReportsLayoutSerializer>`;

  it('prints both margin bands\' controls on every page, the page number included', () => {
    const report = paginate(parseReportStructure(xml), 70);
    expect(report.pages).toHaveLength(3);
    report.pages.forEach((page) => {
      const at = Object.fromEntries(page.bands
        .filter((b) => b.band.kind === 'TopMargin' || b.band.kind === 'BottomMargin')
        .flatMap((b) => b.controls.map((pc) => [pc.control.name, [b.left + pc.control.x, b.top + pc.y]])));
      expect(at).toEqual({ TMtitle: [50, 10], TMright: [500, 50], BMpage: [50, 1040], BMlit: [500, 1070] });
      const pageNo = page.bands.flatMap((b) => b.controls).find((pc) => pc.control.name === 'BMpage')!.control.pageInfo!;
      expect(pageInfoText(pageNo, page.number, report.pages.length)).toBe(`Page ${page.number} of 3`);
    });
    // The content starts below the 80-unit top margin band, as it did printed.
    const first = report.pages[0].bands.find((b) => b.band.kind === 'PageHeader')!;
    expect(first.top).toBe(80);
    expect(report.pages.map((p) => p.bands.filter((b) => b.band.kind === 'Detail' && b.controls.length).length)).toEqual([31, 31, 8]);
  });

  it('exports the top margin band first and the bottom one last, as DevExpress\'s CSV did', () => {
    const lines = reportToCsv(parseReportStructure(xml), 70).split('\r\n');
    expect(lines.slice(0, 3)).toEqual(['TMtitle,', ',TMright', 'PH,']);
    expect(lines.slice(-3)).toEqual(['Page 1 of 1,', ',BMlit', '']);
  });
});

/*
 * Parity row 41, cases s29x1, s29x2, s29x3 and s29s6, printed through
 * DevExpress 20.1 on 2026-10-31: a band with no visible control takes no
 * room. Until this row the Preview drew each at its height.
 */
describe('a band with no visible control, as DevExpress printed it (cases s29x, s29s6)', () => {
  const label = (ref: number, name: string, extra = '') =>
    `<Controls><Item1 Ref="${ref}" ControlType="XRLabel" Name="${name}" Text="${name}" SizeF="200,20"${extra} /></Controls>`;
  const report = (bands: string) => parseReportStructure(
    '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer Ref="1" Name="R" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100">' +
    `<Bands>${bands}</Bands></XtraReportsLayoutSerializer>`);
  const top = (r: PaginatedReport, kind: string) => r.pages[0].bands.find((b) => b.band.kind === kind)!.top;

  it('puts the report footer straight after the header past empty bands (s29x1)', () => {
    const r = paginate(report(
      `<Item1 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="30">${label(20, 'RH')}</Item1>` +
      '<Item2 Ref="3" ControlType="PageHeaderBand" Name="PageHeader" HeightF="40" />' +
      '<Item3 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="30" />' +
      `<Item4 Ref="5" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="30">${label(50, 'RF')}</Item4>`), 3);
    expect(top(r, 'ReportFooter')).toBe(80);
  });

  it('gives no room to a band holding only a hidden label, or only a fill and borders (s29x2)', () => {
    const r = paginate(report(
      `<Item1 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="30">${label(20, 'RH')}</Item1>` +
      `<Item2 Ref="3" ControlType="PageHeaderBand" Name="PageHeader" HeightF="40">${label(30, 'hidden', ' Visible="false"')}</Item2>` +
      '<Item3 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="30" BackColor="LightYellow" />' +
      '<Item4 Ref="6" ControlType="GroupFooterBand" Name="GroupFooter1" HeightF="25" BackColor="LightBlue" Borders="All" />' +
      `<Item5 Ref="5" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="30">${label(50, 'RF')}</Item5>`), 3);
    expect(top(r, 'ReportFooter')).toBe(80);
  });

  it('leaves an empty page footer\'s room to the records, 33 a page (s29x3)', () => {
    const r = paginate(report(
      `<Item1 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="30">${label(40, 'row')}</Item1>` +
      '<Item2 Ref="5" ControlType="PageFooterBand" Name="PageFooter" HeightF="100" />'), 70);
    expect(r.pages.map((p) => p.bands.filter((b) => b.band.kind === 'Detail').length)).toEqual([33, 33, 4]);
  });

  it('prints no room for an empty group header before each record (s29s6)', () => {
    const r = paginate(report(
      '<Item1 Ref="3" ControlType="GroupHeaderBand" Name="GroupHeader1" HeightF="45" />' +
      `<Item2 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="30">${label(40, 'row')}</Item2>`), 13);
    expect(r.pages[0].bands.filter((b) => b.band.kind === 'Detail').map((b) => b.top).slice(0, 3)).toEqual([50, 80, 110]);
  });
});

/*
 * Parity row 45, cases s31a and s31d: expression bindings on anything but the
 * text, in the syntax DevExpress 20.1's serializer wrote, printed over five
 * records whose Qty is 1, 3, 5, 2 and 4. Each expectation is what printed.
 */
describe('expression bindings on appearance and visibility, as DevExpress printed them (cases s31a, s31d)', () => {
  const QTY = ['1', '3', '5', '2', '4'].map((Qty) => ({ Qty }));
  const binding = (ref: number, property: string, expression: string) =>
    `<Item${ref % 10} Ref="${ref}" EventName="BeforePrint" PropertyName="${property}" Expression="${expression}" />`;
  const label = (ref: number, name: string, bindings: string, extra = '') =>
    `<Item${ref} Ref="${ref}" ControlType="XRLabel" Name="${name}" Text="${name}" SizeF="150,20" LocationFloat="0,0"${extra}><ExpressionBindings>${bindings}</ExpressionBindings></Item${ref}>`;
  const report = (controls: string, sheet = '') => parseReportStructure(
    '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer Ref="1" Name="R" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50">' +
    `${sheet}<Bands><Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="30"><Controls>${controls}</Controls></Item1></Bands></XtraReportsLayoutSerializer>`);
  /** Each record's placement of the named control, or null where it did not print. */
  const per = (structure: ReturnType<typeof parseReportStructure>, name: string, rows = QTY) =>
    paginate(structure, rows.length, { rows }).pages[0].bands
      .filter((b) => b.band.kind === 'Detail')
      .map((b) => b.controls.find((pc) => pc.control.name === name)?.control ?? null);

  it('shows a label only on the records its Visible binding holds for (s31a)', () => {
    expect(per(report(label(3, 'vis', binding(30, 'Visible', '[Qty] &gt; 2'))), 'vis').map((c) => c !== null)).toEqual([false, true, true, false, true]);
  });

  it('colours, emboldens and resizes a label record by record (s31a, s31d)', () => {
    const red = "Iif([Qty] &gt; 2, 'Red', 'Blue')";
    const s = report(
      label(3, 'fore', binding(30, 'ForeColor', red)) +
      label(4, 'back', binding(40, 'BackColor', "Iif([Qty] &gt; 2, 'Yellow', 'White')")) +
      label(5, 'bold', binding(50, 'Font.Bold', '[Qty] &gt; 2') + binding(51, 'Font.Italic', '[Qty] &gt; 2')) +
      label(6, 'size', binding(60, 'Font.Size', 'Iif([Qty] &gt; 2, 14, 8)') + binding(61, 'Font.Name', "Iif([Qty] &gt; 2, 'Arial', 'Courier New')")) +
      label(7, 'bord', binding(70, 'Borders', "Iif([Qty] &gt; 2, 'All', 'None')") + binding(71, 'BorderColor', "Iif([Qty] &gt; 2, 'Red', 'Black')")) +
      label(8, 'algn', binding(80, 'TextAlignment', "Iif([Qty] &gt; 2, 'TopRight', 'TopLeft')")));
    expect(per(s, 'fore').map((c) => c!.appearance.ForeColor)).toEqual(['Blue', 'Red', 'Red', 'Blue', 'Red']);
    expect(per(s, 'back').map((c) => c!.appearance.BackColor)).toEqual(['White', 'Yellow', 'Yellow', 'White', 'Yellow']);
    expect(per(s, 'bold').map((c) => [c!.bold, c!.italic])).toEqual([[false, false], [true, true], [true, true], [false, false], [true, true]]);
    expect(per(s, 'size').map((c) => `${c!.fontFamily} ${c!.fontSize}`)).toEqual(['Courier New 8', 'Arial 14', 'Arial 14', 'Courier New 8', 'Arial 14']);
    expect(per(s, 'bord').map((c) => [c!.borders.top && c!.borders.left, c!.appearance.BorderColor])).toEqual([[false, 'Black'], [true, 'Red'], [true, 'Red'], [false, 'Black'], [true, 'Red']]);
    expect(per(s, 'algn').map((c) => c!.align)).toEqual(['left', 'right', 'right', 'left', 'right']);
  });

  it('lets a formatting rule win over a binding on the same property (s31d)', () => {
    const sheet = '<FormattingRuleSheet><Item1 Ref="90" Name="GreenHigh" Condition="[Qty] &gt; 2"><Formatting Ref="91" ForeColor="Green" /></Item1></FormattingRuleSheet>';
    const s = report(label(3, 'prio', binding(30, 'ForeColor', "Iif([Qty] &gt; 2, 'Red', 'Blue')") + '</ExpressionBindings><FormattingRuleLinks><Item1 Ref="31" Value="#Ref-90" /></FormattingRuleLinks><ExpressionBindings>'), sheet);
    expect(per(s, 'prio').map((c) => c!.appearance.ForeColor)).toEqual(['Blue', 'Green', 'Green', 'Blue', 'Green']);
  });

  it('colours a table cell by its own binding (s31d)', () => {
    const table = '<Item3 Ref="3" ControlType="XRTable" Name="tbl" SizeF="150,20" LocationFloat="0,0"><Rows><Item1 Ref="4" ControlType="XRTableRow" Name="tr" Weight="1"><Cells>' +
      `<Item1 Ref="5" ControlType="XRTableCell" Name="tc" Text="CELL" Weight="1"><ExpressionBindings>${binding(50, 'ForeColor', "Iif([Qty] &gt; 2, 'Red', 'Blue')")}</ExpressionBindings></Item1>` +
      '</Cells></Item1></Rows></Item3>';
    expect(per(report(table), 'tbl').map((c) => c!.rows[0].cells[0].appearance.ForeColor)).toEqual(['Blue', 'Red', 'Red', 'Blue', 'Red']);
  });

  it('evaluates nothing without test data, so the label prints as designed', () => {
    const s = report(label(3, 'vis', binding(30, 'Visible', '[Qty] &gt; 2') + binding(31, 'ForeColor', "'Red'")));
    const placed = paginate(s, 2).pages[0].bands.filter((b) => b.band.kind === 'Detail').map((b) => b.controls[0]?.control);
    expect(placed.map((c) => [c?.name, c?.appearance.ForeColor])).toEqual([['vis', undefined], ['vis', undefined]]);
  });
});

/*
 * Parity row 46, cases s31b and s32a to s32c, built and saved by DevExpress
 * 20.1 and printed over 45 records 30 to a page: a ten times, b thirty times
 * across the page break and the group break, c five times, and a null note
 * on every third. Each expectation is what printed.
 */
describe('suppressed and merged repeats, as DevExpress printed them (cases s31b, s32)', () => {
  const ROWS = Array.from({ length: 45 }, (_, i) => ({
    Idx: String(i + 1), Name: i < 10 ? 'a' : i < 40 ? 'b' : 'c', Region: i < 20 ? 'North' : 'South', Note: (i + 1) % 3 === 0 ? '' : `n${i + 1}`,
  }));
  const label = (ref: number, name: string, field: string, x: number, extra = '') =>
    `<Item${ref} Ref="${ref}" ControlType="XRLabel" Name="${name}" SizeF="100,20" LocationFloat="${x},0"${extra}>` +
    `<ExpressionBindings><Item1 Ref="${ref}0" EventName="BeforePrint" PropertyName="Text" Expression="[${field}]" /></ExpressionBindings></Item${ref}>`;
  const report = (detail: string, group = '') => parseReportStructure(
    '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer Ref="1" Name="R" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" DataMember="Items">' +
    `<Bands>${group}<Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="33.33"><Controls>${detail}</Controls></Item2></Bands></XtraReportsLayoutSerializer>`);
  /** Each page's printings of the named control, as text@top+height from the content's top. */
  const printed = (structure: ReturnType<typeof parseReportStructure>, name: string, rows = ROWS) =>
    paginate(structure, rows.length, { rows }).pages.map((page) => page.bands.flatMap((b) => b.controls
      .filter((pc) => pc.control.name === name)
      .map((pc) => `${pc.text}@${Math.round((b.top + pc.y - 50) * 10) / 10}+${Math.round(pc.height * 10) / 10}`)));

  it('prints a suppressed value once per run, across the page break (s32a)', () => {
    expect(printed(report(label(3, 'sup', 'Name', 0, ' ProcessDuplicatesMode="Suppress"')), 'sup')).toEqual([['a@0+20', 'b@333.3+20'], ['c@333.3+20']]);
  });

  it('and across a group break (s32c)', () => {
    const group = '<Item1 Ref="5" ControlType="GroupHeaderBand" Name="GroupHeader1" HeightF="25"><GroupFields><Item1 Ref="6" FieldName="Region" /></GroupFields>' +
      `<Controls>${label(7, 'grp', 'Region', 0)}</Controls></Item1>`;
    const all = printed(report(label(3, 'sup', 'Name', 0, ' ProcessDuplicatesMode="Suppress"'), group), 'sup').flat().map((t) => t.split('@')[0]);
    expect(all).toEqual(['a', 'b', 'c']);
  });

  it('merges a run into one box per page, its value printed again after the break (s32a)', () => {
    expect(printed(report(label(3, 'mrg', 'Name', 150, ' ProcessDuplicatesMode="Merge"')), 'mrg'))
      .toEqual([['a@0+320', 'b@333.3+653.3'], ['b@0+320', 'c@333.3+153.3']]);
  });

  it('carries a merged run once in the CSV, on its first line (s32a)', () => {
    const lines = reportToCsv(report(label(3, 'mrg', 'Name', 150, ' ProcessDuplicatesMode="Merge"') + label(4, 'idx', 'Idx', 450)), ROWS.length, { rows: ROWS }).split('\r\n');
    expect(lines.slice(0, 3)).toEqual(['a,1', ',2', ',3']);
    expect(lines[10]).toBe('b,11');
  });

  it('prints nothing for a null under ProcessNullValues="Suppress" (s31b)', () => {
    const notes = printed(report(label(3, 'nul', 'Note', 320, ' ProcessNullValues="Suppress"')), 'nul').flat().map((t) => t.split('@')[0]);
    expect(notes.slice(0, 4)).toEqual(['n1', 'n2', 'n4', 'n5']);
    expect(notes).toHaveLength(30);
  });

  it('suppresses and merges nothing without test data', () => {
    const s = report(label(3, 'sup', 'Name', 0, ' ProcessDuplicatesMode="Suppress"') + label(4, 'mrg', 'Name', 150, ' ProcessDuplicatesMode="Merge"'));
    const placed = paginate(s, 3).pages[0].bands.filter((b) => b.band.kind === 'Detail');
    expect(placed.map((b) => b.controls.length)).toEqual([2, 2, 2]);
  });
});

/*
 * Parity row 47, cases s31c, s33a and s33b, built and saved by DevExpress
 * 20.1: an `XRPageBreak` breaks the page where it sits. Each expectation is
 * where DevExpress printed the text, page and top from the content's top.
 */
describe('the XRPageBreak control, as DevExpress printed it (cases s31c, s33)', () => {
  const label = (ref: number, name: string, y: number, text: string) =>
    `<Item${ref} Ref="${ref}" ControlType="XRLabel" Name="${name}" Text="${text}" SizeF="100,20" LocationFloat="0,${y}" />`;
  const brk = (ref: number, y: number) => `<Item${ref} Ref="${ref}" ControlType="XRPageBreak" Name="brk${ref}" LocationFloat="0,${y}" />`;
  const report = (bands: string) => parseReportStructure(
    '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer Ref="1" Name="R" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50">' +
    `<Bands>${bands}</Bands></XtraReportsLayoutSerializer>`);
  const where = (r: PaginatedReport) => r.pages.flatMap((page, p) => page.bands.flatMap((b) => b.controls.map((pc) => `${p + 1}:${pc.text}@${Math.round(b.top + pc.y - 50)}`)));

  it('carries the report header past its break to page 2, at its gap below the break (s31c)', () => {
    const r = paginate(report(
      `<Item1 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="200"><Controls>${label(3, 'before', 0, 'BEFORE')}${brk(4, 160)}${label(5, 'after', 170, 'AFTER')}</Controls></Item1>` +
      `<Item2 Ref="6" ControlType="DetailBand" Name="Detail" HeightF="25"><Controls>${label(7, 'n', 0, 'row')}</Controls></Item2>`), 2);
    expect(where(r)).toEqual(['1:BEFORE@0', '2:AFTER@10', '2:row@40', '2:row@65']);
  });

  it('breaks inside every record of a Detail band, seven pages for six records (s33a)', () => {
    const r = paginate(report(
      `<Item1 Ref="2" ControlType="PageHeaderBand" Name="PageHeader" HeightF="25"><Controls>${label(3, 'ph', 0, 'HEADER')}</Controls></Item1>` +
      `<Item2 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="60"><Controls>${label(5, 'top', 0, 'top')}${brk(6, 25)}${label(7, 'bot', 35, 'bottom')}</Controls></Item2>`), 6);
    expect(r.pages).toHaveLength(7);
    expect(where(r).slice(0, 6)).toEqual(['1:HEADER@0', '1:top@25', '2:HEADER@0', '2:bottom@35', '2:top@60', '3:HEADER@0']);
  });

  it('breaks after each group footer that holds one (s33b)', () => {
    const rows = ['North', 'North', 'North', 'South', 'South', 'South'].map((Region, i) => ({ Region, Idx: String(i + 1) }));
    const r = paginate(report(
      '<Item1 Ref="2" ControlType="GroupHeaderBand" Name="GroupHeader1" HeightF="25"><GroupFields><Item1 Ref="3" FieldName="Region" /></GroupFields></Item1>' +
      `<Item2 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="25"><Controls>${label(5, 'idx', 0, 'row')}</Controls></Item2>` +
      `<Item3 Ref="6" ControlType="GroupFooterBand" Name="GroupFooter1" HeightF="30"><Controls>${label(7, 'end', 0, 'END')}${brk(8, 25)}</Controls></Item3>` +
      `<Item4 Ref="9" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="25"><Controls>${label(10, 'rf', 0, 'REPORT END')}</Controls></Item4>`), rows.length, { rows });
    expect(r.pages.map((p) => p.bands.flatMap((b) => b.controls.map((pc) => pc.text)))).toEqual([
      ['row', 'row', 'row', 'END'], ['row', 'row', 'row', 'END'], ['REPORT END'],
    ]);
  });

  it('breaks nothing on the one continuous page the CSV is laid out on', () => {
    const lines = reportToCsv(report(
      `<Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="60"><Controls>${label(5, 'top', 0, 'top')}${brk(6, 25)}${label(7, 'bot', 35, 'bottom')}</Controls></Item1>`), 2).split('\r\n');
    expect(lines).toEqual(['top', 'bottom', 'top', 'bottom', '']);
  });
});

/*
 * Parity row 48, cases s31c and s34a to s34d, built and saved by DevExpress
 * 20.1: cross-band lines and boxes. Each segment is where DevExpress printed
 * it, as left,top..right,bottom from the page's top left.
 */
describe('cross-band lines and boxes, as DevExpress printed them (cases s31c, s34)', () => {
  const ROWS = Array.from({ length: 70 }, (_, i) => ({ Idx: String(i + 1), Region: i < 10 ? 'North' : 'South' }));
  const label = (ref: number, name: string, text: string) =>
    `<Controls><Item1 Ref="${ref}" ControlType="XRLabel" Name="${name}" Text="${text}" LocationFloat="20,5" SizeF="100,20" /></Controls>`;
  const cross = (type: string, start: number, end: number, from: string, to: string, width: number) =>
    `<CrossBandControls><Item1 Ref="90" ControlType="${type}" Name="cb" WidthF="${width}" StartBand="#Ref-${start}" EndBand="#Ref-${end}" StartPointFloat="${from}" EndPointFloat="${to}" /></CrossBandControls>`;
  const report = (crossBands: string, bands: string) => parseReportStructure(
    '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer Ref="1" Name="R" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50">' +
    `${crossBands}<Bands>${bands}</Bands></XtraReportsLayoutSerializer>`);
  const segments = (r: PaginatedReport) => r.pages.map((p) => (p.crossBands ?? []).map((s) => `${s.kind}:${s.left},${s.top}..${s.left + s.width},${s.bottom}`));
  const groups = (pageBands = '') =>
    '<Item1 Ref="3" ControlType="GroupHeaderBand" Name="GroupHeader1" HeightF="30"><GroupFields><Item1 Ref="31" FieldName="Region" /></GroupFields>' + label(32, 'grp', 'GROUP') + '</Item1>' +
    `<Item2 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="30">${label(41, 'idx', 'row')}</Item2>` +
    `<Item3 Ref="5" ControlType="GroupFooterBand" Name="GroupFooter1" HeightF="30">${label(51, 'gf', 'END')}</Item3>` + pageBands;

  it('frames every page with a box from the page header to the page footer (s34a)', () => {
    const r = paginate(report(cross('XRCrossBandBox', 6, 7, '0,0', '0,30', 750),
      `<Item1 Ref="6" ControlType="PageHeaderBand" Name="PageHeader" HeightF="30">${label(61, 'ph', 'HEADER')}</Item1>` +
      `<Item2 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="30">${label(41, 'idx', 'row')}</Item2>` +
      `<Item3 Ref="7" ControlType="PageFooterBand" Name="PageFooter" HeightF="30">${label(71, 'pf', 'FOOTER')}</Item3>`), 70);
    expect(segments(r)).toEqual([['box:50,50..800,1050'], ['box:50,50..800,1050'], ['box:50,50..800,1050']]);
    expect(r.pages[0].crossBands![0].strokePx).toBe(2);
  });

  it('draws a group\'s line from its header to its footer, through every page between (s34b)', () => {
    const r = paginate(report(cross('XRCrossBandLine', 3, 5, '5,5', '5,25', 3), groups()), ROWS.length, { rows: ROWS });
    expect(segments(r)).toEqual([['line:55,55..58,405', 'line:55,415..58,1050'], ['line:55,50..58,1050'], ['line:55,50..58,280']]);
  });

  it('starts a continued line below the page header and stops it above the page footer (s34c)', () => {
    const pageBands = `<Item4 Ref="6" ControlType="PageHeaderBand" Name="PageHeader" HeightF="40">${label(61, 'ph', 'HEADER')}</Item4>` +
      `<Item5 Ref="7" ControlType="PageFooterBand" Name="PageFooter" HeightF="40">${label(71, 'pf', 'FOOTER')}</Item5>`;
    const r = paginate(report(cross('XRCrossBandLine', 3, 5, '5,5', '5,25', 3), groups(pageBands)), ROWS.length, { rows: ROWS });
    expect(segments(r)).toEqual([['line:55,95..58,445', 'line:55,455..58,1010'], ['line:55,90..58,1010'], ['line:55,90..58,480']]);
    // The line through record 58 at the foot of page 2 carried its 5 blank units
    // to page 3, as DevExpress did; without it they were dropped (s34d).
    const first = (rep: PaginatedReport) => rep.pages[2].bands.find((b) => b.band.kind === 'Detail' && b.controls.length)!.top;
    expect(first(r)).toBe(95);
    expect(first(paginate(report('', groups(pageBands)), ROWS.length, { rows: ROWS }))).toBe(90);
  });

  it('runs a line from the report header to the report footer across pages (s31c)', () => {
    const r = paginate(report(cross('XRCrossBandLine', 2, 9, '600,10', '600,30', 9),
      `<Item1 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="200"><Controls><Item1 Ref="21" ControlType="XRLabel" Name="b" Text="B" SizeF="100,20" /><Item2 Ref="22" ControlType="XRPageBreak" Name="brk" LocationFloat="0,160" /><Item3 Ref="23" ControlType="XRLabel" Name="a" Text="A" LocationFloat="200,170" SizeF="100,20" /></Controls></Item1>` +
      `<Item2 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="25">${label(41, 'n', 'row')}</Item2>` +
      `<Item3 Ref="9" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="40">${label(91, 'foot', 'FOOTER')}</Item3>`), 5);
    expect(segments(r)).toEqual([['line:650,60..659,1050'], ['line:650,50..659,245']]);
  });
});

describe('a record at the foot of a page, as DevExpress printed it (case s29s)', () => {
  const report = (detail: string, height: number) => paginate(parseReportStructure(
    '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer Ref="1" Name="R" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100">' +
    '<Bands><Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />' +
    '<Item2 Ref="3" ControlType="PageHeaderBand" Name="PageHeader" HeightF="20"><Controls><Item1 Ref="10" ControlType="XRLabel" Name="ph" Text="PH" LocationFloat="0,0" SizeF="200,20" /></Controls></Item2>' +
    `<Item3 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="${height}"><Controls>${detail}</Controls></Item3>` +
    '<Item4 Ref="5" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" /></Bands></XtraReportsLayoutSerializer>'), 70);
  const label = (y: number) => `<Item1 Ref="11" ControlType="XRLabel" Name="row" Text="row" LocationFloat="0,${y}" SizeF="200,20" />`;
  /** Each record's label as page:top, from the page's top edge. */
  const labels = (r: PaginatedReport) => r.pages.flatMap((page, p) => page.bands
    .filter((b) => b.band.kind === 'Detail')
    .flatMap((b) => b.controls.map((pc) => ({ record: b.record, at: `${p + 1}:${Math.round(b.top + pc.y)}` }))));
  const perPage = (r: PaginatedReport) => r.pages.map((page) => new Set(page.bands.filter((b) => b.band.kind === 'Detail' && b.controls.length).map((b) => b.record)).size);

  it('starts the next page straight under its header when the record\'s label fitted (s29s1)', () => {
    const r = report(label(0), 50);
    const at = labels(r);
    expect(at.find((x) => x.record === 20)!.at).toBe('1:1020');
    expect(at.find((x) => x.record === 21)!.at).toBe('2:70');
    expect(perPage(r)).toEqual([20, 20, 20, 10]);
  });

  it('continues a label that straddles the foot below a gap at the next page\'s top (s29s3)', () => {
    const at = labels(report(label(20), 50));
    expect(at.find((x) => x.record === 19)!.at).toBe('1:990');
    expect(at.filter((x) => x.record === 20).map((x) => x.at)).toEqual(['2:70']);
    expect(at.find((x) => x.record === 21)!.at).toBe('2:120');
  });

  it('continues a label wholly below the foot at its gap below the cut (s29s5)', () => {
    const at = labels(report(label(35), 60));
    expect(at.find((x) => x.record === 16)!.at).toBe('1:1005');
    expect(at.filter((x) => x.record === 17).map((x) => x.at)).toEqual(['2:85']);
    expect(at.find((x) => x.record === 18)!.at).toBe('2:145');
  });
});

/*
 * A growing table row, against case c03: the row takes its tallest cell's
 * height and every cell draws at it. DevExpress printed a 2-line note as a
 * 31.9-unit row and a 5-line one as 75, with each cell's 1px bottom border
 * counted, and fitted 22 rows on page 1 and 8 on page 2.
 */
describe('a growing table row, as DevExpress prints it', () => {
  const LONG = 'The delivery was split across two vehicles because the second pallet missed the cut-off, and the customer asked for the balance to be invoiced separately once it arrives. ';
  const note = (i: number) => ['', 'Short note.', LONG.slice(0, 120), LONG + LONG, 'Paid on account.', (LONG + LONG + LONG + LONG).slice(0, 380)][i % 6];
  // Line counts DevExpress printed in the 324pt Notes cell.
  const LINES: Record<string, number> = { [note(2)]: 2, [note(3)]: 5, [note(5)]: 5 };
  const measure = (text: string) => (text ? Array.from({ length: LINES[text] ?? 1 }, () => 'x') : []);
  const rows = Array.from({ length: 30 }, (_, k) => ({ Customer: `C${String(k + 1).padStart(4, '0')}`, Notes: note(k + 1), Amount: '1.00' }));
  const cell = (n: number, name: string, field: string, weight: number) =>
    `<Item${n} Ref="${60 + n}" ControlType="XRTableCell" Name="${name}" Weight="${weight}"><ExpressionBindings><Item1 Ref="${70 + n}" EventName="BeforePrint" PropertyName="Text" Expression="[${field}]" /></ExpressionBindings></Item${n}>`;
  const xml = '<?xml version="1.0" encoding="utf-8"?>' +
    '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="R" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100" Version="20.1">' +
    '<Bands><Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />' +
    '<Item2 Ref="3" ControlType="PageHeaderBand" Name="PageHeader" HeightF="25"><Controls><Item1 Ref="10" ControlType="XRLabel" Name="head" Text="Customer" Font="Arial, 9pt, style=Bold" LocationFloat="0,0" SizeF="750,25" /></Controls></Item2>' +
    '<Item3 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="25"><Controls>' +
    '<Item1 Ref="11" ControlType="XRTable" Name="tblRow" LocationFloat="0,0" SizeF="750,25" Borders="Left, Right, Bottom" Font="Arial, 9pt"><Rows>' +
    `<Item1 Ref="12" ControlType="XRTableRow" Name="row" Weight="1"><Cells>${cell(1, 'cCust', 'Customer', 1)}${cell(2, 'cNotes', 'Notes', 3)}${cell(3, 'cAmt', 'Amount', 1)}</Cells></Item1>` +
    '</Rows></Item1></Controls></Item3>' +
    '<Item4 Ref="5" ControlType="PageFooterBand" Name="PageFooter" HeightF="30" />' +
    '<Item5 Ref="6" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" /></Bands></XtraReportsLayoutSerializer>';

  it('grows the row to its tallest cell, bottom border included, and fits the rows DevExpress fitted', () => {
    const report = paginate(parseReportStructure(xml), 30, { measure, rows });
    const details = report.pages.map((p) => p.bands.filter((b) => b.band.kind === 'Detail'));
    const heightOf = (n: number) => details.flat().find((b) => b.record === n)!.height;
    expect(heightOf(1)).toBe(25);
    expect(heightOf(2)).toBeCloseTo(31.9, 1); // 2 lines
    expect(heightOf(3)).toBeCloseTo(75, 1); // 5 lines
    expect(details.map((d) => d.length)).toEqual([22, 8]);
  });
});

/*
 * PrintOn and PrintAtBottom, against case c04b as DevExpress PRINTED it:
 * 100 records of 30 units under a 150-unit report header; the page header marked
 * NotWithReportHeader, the page footer NotWithReportFooter, the report footer
 * PrintAtBottom (row 9 of docs/proposals/devexpress-parity.md).
 */
describe('PrintOn and PrintAtBottom, as DevExpress prints them', () => {
  const xml = (pageHeaderAttrs: string, reportFooterAttrs: string, pageFooterAttrs: string) =>
    '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer Ref="1" Name="R" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100">' +
    '<Bands><Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />' +
    '<Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="150"><Controls><Item1 Ref="10" ControlType="XRLabel" Name="title" Text="SALES REGISTER" LocationFloat="0,0" SizeF="750,60" /></Controls></Item2>' +
    `<Item3 Ref="4" ControlType="PageHeaderBand" Name="PageHeader" HeightF="30"${pageHeaderAttrs}><Controls><Item1 Ref="11" ControlType="XRLabel" Name="headings" Text="CUSTOMER" LocationFloat="0,0" SizeF="750,25" /></Controls></Item3>` +
    '<Item4 Ref="5" ControlType="DetailBand" Name="Detail" HeightF="30"><Controls><Item1 Ref="12" ControlType="XRLabel" Name="cust" Text="C" LocationFloat="0,0" SizeF="300,25" /></Controls></Item4>' +
    `<Item5 Ref="6" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="60"${reportFooterAttrs}><Controls><Item1 Ref="13" ControlType="XRLabel" Name="total" Text="Total" LocationFloat="450,0" SizeF="300,25" /></Controls></Item5>` +
    `<Item6 Ref="7" ControlType="PageFooterBand" Name="PageFooter" HeightF="30"${pageFooterAttrs}><Controls><Item1 Ref="14" ControlType="XRPageInfo" Name="pn" LocationFloat="0,5" SizeF="300,20" /></Controls></Item6>` +
    '<Item7 Ref="8" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" /></Bands></XtraReportsLayoutSerializer>';
  const kinds = (page: { bands: PlacedBand[] }) => page.bands.map((b) => b.band.kind);
  const count = (page: { bands: PlacedBand[] }) => page.bands.filter((b) => b.band.kind === 'Detail').length;

  it('prints the c04b layout DevExpress printed: 27, 31, 31 and 11 records', () => {
    const report = paginate(parseReportStructure(xml(' PrintOn="NotWithReportHeader"', ' PrintAtBottom="true"', ' PrintOn="NotWithReportFooter"')), 100);
    expect(report.pages.map(count)).toEqual([27, 31, 31, 11]);
    // No page header on the page with the report header; one everywhere else.
    expect(kinds(report.pages[0])).not.toContain('PageHeader');
    expect(report.pages.slice(1).every((p) => kinds(p).includes('PageHeader'))).toBe(true);
    // No page footer on the report footer's page; one on the other three.
    expect(kinds(report.pages[3])).not.toContain('PageFooter');
    expect(report.pages.slice(0, 3).every((p) => kinds(p).includes('PageFooter'))).toBe(true);
    // The report footer at the foot of the page, where its suppressed page footer would have been.
    expect(report.pages[3].bands.find((b) => b.band.kind === 'ReportFooter')!.top).toBe(990);
  });

  it('prints every band on every page with the default PrintOn, as the plain c04 case did', () => {
    const report = paginate(parseReportStructure(xml('', '', '')), 100);
    expect(report.pages.map(count)).toEqual([26, 31, 31, 12]); // DevExpress, case c04
    expect(report.pages.every((p) => kinds(p).includes('PageHeader') && kinds(p).includes('PageFooter'))).toBe(true);
    // Without PrintAtBottom the report footer follows the last record.
    const rf = report.pages[3].bands.find((b) => b.band.kind === 'ReportFooter')!;
    const last = report.pages[3].bands.filter((b) => b.band.kind === 'Detail').at(-1)!;
    expect(rf.top).toBe(last.top + last.height);
  });

  it('puts a PrintAtBottom footer just above a page footer that stays', () => {
    const report = paginate(parseReportStructure(xml('', ' PrintAtBottom="true"', '')), 100);
    const last = report.pages.at(-1)!;
    const rf = last.bands.find((b) => b.band.kind === 'ReportFooter')!;
    const pf = last.bands.find((b) => b.band.kind === 'PageFooter')!;
    expect(rf.top + rf.height).toBe(pf.top);
  });

  it('reads the flags alone or combined', () => {
    const both = paginate(parseReportStructure(xml('', '', ' PrintOn="NotWithReportHeader, NotWithReportFooter"')), 100);
    expect(kinds(both.pages[0])).not.toContain('PageFooter');
    expect(kinds(both.pages.at(-1)!)).not.toContain('PageFooter');
    expect(kinds(both.pages[1])).toContain('PageFooter');
  });
});


/*
 * Case s17b of docs/proposals/devexpress-parity.md, end to end: a summary of every
 * scope in the report and page bands and Detail, over 50 records on three pages,
 * printed through DevExpress 20.1 (`RepxProbe render`, 2026-10-30). Record 24 was
 * split across pages 1 and 2, so it counts on both, and with no group bands
 * `Group` printed "?" even in Detail. Every expectation is a string DevExpress drew,
 * prefixed by the page it drew it on. The grouped case, s17, is further down.
 */
describe('summaries over test data, as DevExpress printed them (case s17b)', () => {
  type Spec = [name: string, expression: string, x: number, y: number, running?: string, format?: string];
  const SPEC: Record<string, Spec[]> = {
    ReportHeader: [
      ["rh_report","sumSum([Qty])",0,0,"Report"],
      ["rh_page","sumSum([Qty])",125,0,"Page"],
      ["rh_group","sumSum([Qty])",250,0,"Group"],
      ["rh_none","sumSum([Qty])",375,0,""],
      ["rh_count","sumCount()",500,0,"Report"],
      ["rh_rrep","sumRunningSum([Qty])",625,0,"Report"],
      ["rh_qty","[Qty]",0,18],
    ],
    PageHeader: [
      ["ph_page","sumSum([Qty])",0,0,"Page"],
      ["ph_report","sumSum([Qty])",125,0,"Report"],
      ["ph_group","sumSum([Qty])",250,0,"Group"],
      ["ph_pcount","sumCount()",375,0,"Page"],
      ["ph_rrep","sumRunningSum([Qty])",500,0,"Report"],
      ["ph_rpage","sumRunningSum([Qty])",625,0,"Page"],
      ["ph_qty","[Qty]",0,18],
    ],
    Detail: [
      ["d_qty","[Qty]",0,0],
      ["d_group","sumSum([Qty])",60,0,"Group"],
      ["d_report","sumSum([Qty])",185,0,"Report"],
      ["d_page","sumSum([Qty])",310,0,"Page"],
      ["d_none","sumSum([Qty])",435,0,""],
      ["d_rgroup","sumRunningSum([Qty])",560,0,"Group"],
      ["d_recgroup","sumRecordNumber()",0,18,"Group"],
      ["d_recpage","sumRecordNumber()",125,18,"Page"],
      ["d_recreport","sumRecordNumber()",250,18,"Report"],
      ["d_rpage","sumRunningSum([Qty])",375,18,"Page"],
      ["d_avg","sumAvg([Qty])",500,18,"Group"],
      ["d_nullfmt","[Missing]",625,18,undefined,"Total: {0:c2}"],
    ],
    PageFooter: [
      ["pf_page","sumSum([Qty])",0,0,"Page"],
      ["pf_report","sumSum([Qty])",125,0,"Report"],
      ["pf_group","sumSum([Qty])",250,0,"Group"],
      ["pf_none","sumSum([Qty])",375,0,""],
      ["pf_rrep","sumRunningSum([Qty])",500,0,"Report"],
      ["pf_qty","[Qty]",0,18],
      ["pf_groupfmt","sumSum([Qty])",125,18,"Group","{0:c2}"],
    ],
    ReportFooter: [
      ["rf_report","sumSum([Qty])",0,0,"Report"],
      ["rf_page","sumSum([Qty])",125,0,"Page"],
      ["rf_rrep","sumRunningSum([Qty])",250,0,"Report"],
      ["rf_qty","[Qty]",0,18],
    ],
  };
  const ROWS = [{"Region":"North","Qty":"1"},{"Region":"North","Qty":"2"},{"Region":"North","Qty":"3"},{"Region":"North","Qty":"4"},{"Region":"North","Qty":"5"},{"Region":"North","Qty":"6"},{"Region":"North","Qty":"7"},{"Region":"North","Qty":"8"},{"Region":"North","Qty":"9"},{"Region":"North","Qty":"10"},{"Region":"North","Qty":"11"},{"Region":"North","Qty":"12"},{"Region":"North","Qty":"13"},{"Region":"North","Qty":"14"},{"Region":"North","Qty":"15"},{"Region":"South","Qty":"16"},{"Region":"South","Qty":"17"},{"Region":"South","Qty":"18"},{"Region":"South","Qty":"19"},{"Region":"South","Qty":"20"},{"Region":"South","Qty":"21"},{"Region":"South","Qty":"22"},{"Region":"South","Qty":"23"},{"Region":"South","Qty":"24"},{"Region":"South","Qty":"25"},{"Region":"South","Qty":"26"},{"Region":"South","Qty":"27"},{"Region":"South","Qty":"28"},{"Region":"South","Qty":"29"},{"Region":"South","Qty":"30"},{"Region":"South","Qty":"31"},{"Region":"South","Qty":"32"},{"Region":"South","Qty":"33"},{"Region":"South","Qty":"34"},{"Region":"South","Qty":"35"},{"Region":"West","Qty":"36"},{"Region":"West","Qty":"37"},{"Region":"West","Qty":"38"},{"Region":"West","Qty":"39"},{"Region":"West","Qty":"40"},{"Region":"West","Qty":"41"},{"Region":"West","Qty":"42"},{"Region":"West","Qty":"43"},{"Region":"West","Qty":"44"},{"Region":"West","Qty":"45"},{"Region":"West","Qty":"46"},{"Region":"West","Qty":"47"},{"Region":"West","Qty":"48"},{"Region":"West","Qty":"49"},{"Region":"West","Qty":"50"}];
  const PRINTED: Record<string, string[]> = {
    d_avg: ["p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p3:?","p3:?"],
    d_group: ["p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p3:?","p3:?"],
    d_none: ["p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p3:(blank)","p3:(blank)"],
    d_nullfmt: ["p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p3:(blank)","p3:(blank)"],
    d_page: ["p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:300","p1:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p2:900","p3:99","p3:99"],
    d_qty: ["p1:1","p1:2","p1:3","p1:4","p1:5","p1:6","p1:7","p1:8","p1:9","p1:10","p1:11","p1:12","p1:13","p1:14","p1:15","p1:16","p1:17","p1:18","p1:19","p1:20","p1:21","p1:22","p1:23","p1:24","p2:25","p2:26","p2:27","p2:28","p2:29","p2:30","p2:31","p2:32","p2:33","p2:34","p2:35","p2:36","p2:37","p2:38","p2:39","p2:40","p2:41","p2:42","p2:43","p2:44","p2:45","p2:46","p2:47","p2:48","p3:49","p3:50"],
    d_recgroup: ["p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p3:?","p3:?"],
    d_recpage: ["p1:1","p1:2","p1:3","p1:4","p1:5","p1:6","p1:7","p1:8","p1:9","p1:10","p1:11","p1:12","p1:13","p1:14","p1:15","p1:16","p1:17","p1:18","p1:19","p1:20","p1:21","p1:22","p1:23","p2:1","p2:2","p2:3","p2:4","p2:5","p2:6","p2:7","p2:8","p2:9","p2:10","p2:11","p2:12","p2:13","p2:14","p2:15","p2:16","p2:17","p2:18","p2:19","p2:20","p2:21","p2:22","p2:23","p2:24","p2:25","p3:1","p3:2"],
    d_recreport: ["p1:1","p1:2","p1:3","p1:4","p1:5","p1:6","p1:7","p1:8","p1:9","p1:10","p1:11","p1:12","p1:13","p1:14","p1:15","p1:16","p1:17","p1:18","p1:19","p1:20","p1:21","p1:22","p1:23","p2:24","p2:25","p2:26","p2:27","p2:28","p2:29","p2:30","p2:31","p2:32","p2:33","p2:34","p2:35","p2:36","p2:37","p2:38","p2:39","p2:40","p2:41","p2:42","p2:43","p2:44","p2:45","p2:46","p2:47","p2:48","p3:49","p3:50"],
    d_report: ["p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p3:1275","p3:1275"],
    d_rgroup: ["p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p1:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p2:?","p3:?","p3:?"],
    d_rpage: ["p1:1","p1:3","p1:6","p1:10","p1:15","p1:21","p1:28","p1:36","p1:45","p1:55","p1:66","p1:78","p1:91","p1:105","p1:120","p1:136","p1:153","p1:171","p1:190","p1:210","p1:231","p1:253","p1:276","p2:24","p2:49","p2:75","p2:102","p2:130","p2:159","p2:189","p2:220","p2:252","p2:285","p2:319","p2:354","p2:390","p2:427","p2:465","p2:504","p2:544","p2:585","p2:627","p2:670","p2:714","p2:759","p2:805","p2:852","p2:900","p3:49","p3:99"],
    pf_group: ["p1:?","p2:?","p3:?"],
    pf_groupfmt: ["p1:?","p2:?","p3:?"],
    pf_none: ["p1:(blank)","p2:(blank)","p3:(blank)"],
    pf_page: ["p1:300","p2:900","p3:99"],
    pf_qty: ["p1:24","p2:48","p3:50"],
    pf_report: ["p1:1275","p2:1275","p3:1275"],
    pf_rrep: ["p1:300","p2:1176","p3:1275"],
    ph_group: ["p1:?","p2:?","p3:?"],
    ph_page: ["p1:300","p2:900","p3:99"],
    ph_pcount: ["p1:24","p2:25","p3:2"],
    ph_qty: ["p1:1","p2:24","p3:49"],
    ph_report: ["p1:1275","p2:1275","p3:1275"],
    ph_rpage: ["p1:300","p2:900","p3:99"],
    ph_rrep: ["p1:300","p2:1176","p3:1275"],
    rf_page: ["p3:99"],
    rf_qty: ["p3:50"],
    rf_report: ["p3:1275"],
    rf_rrep: ["p3:1275"],
    rh_count: ["p1:50"],
    rh_group: ["p1:?"],
    rh_none: ["p1:(blank)"],
    rh_page: ["p1:300"],
    rh_qty: ["p1:1"],
    rh_report: ["p1:1275"],
    rh_rrep: ["p1:1275"],
  };

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  /** The same report RepxProbe rendered: Arial 7pt, 40-unit bands, 20-unit margins. */
  function scopesReport(): string {
    let ref = 100;
    const R = () => ++ref;
    const label = (n: number, [name, expression, x, y, running, format]: Spec) => {
      const summary = running === undefined ? '' : running === '' ? `<Summary Ref="${R()}" />` : `<Summary Ref="${R()}" Running="${running}" />`;
      return `<Item${n} Ref="${R()}" ControlType="XRLabel" Name="${name}"${format ? ` TextFormatString="${esc(format)}"` : ''} WordWrap="false" LocationFloat="${x},${y}" SizeF="120,16">${summary}` +
        `<ExpressionBindings><Item1 Ref="${R()}" EventName="BeforePrint" PropertyName="Text" Expression="${esc(expression)}" /></ExpressionBindings></Item${n}>`;
    };
    let item = 1;
    const bands = [`<Item${item++} Ref="${R()}" ControlType="TopMarginBand" Name="TopMargin" HeightF="20" />`];
    for (const [kind, controls] of Object.entries(SPEC)) {
      const inner = '<Controls>' + controls.map((c, i) => label(i + 1, c)).join('') + '</Controls>';
      bands.push(`<Item${item} Ref="${R()}" ControlType="${kind}Band" Name="${kind}" HeightF="40">${inner}</Item${item}>`);
      item++;
    }
    bands.push(`<Item${item} Ref="${R()}" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="20" />`);
    return '<?xml version="1.0" encoding="utf-8"?>' +
      '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Scopes" ReportUnit="HundredthsOfAnInch" Margins="20, 20, 20, 20" PageWidth="850" PageHeight="1100" Version="20.1" DataMember="Items" Font="Arial, 7pt">' +
      `<Bands>${bands.join('')}</Bands></XtraReportsLayoutSerializer>`;
  }

  it('prints every summary, field and format on the page DevExpress printed it on', () => {
    const report = paginate(parseReportStructure(scopesReport()), ROWS.length, { rows: ROWS });
    expect(report.pages).toHaveLength(3);
    const printed: Record<string, string[]> = {};
    report.pages.forEach((page, p) => {
      for (const band of page.bands) {
        for (const pc of band.controls) {
          if (pc.text === null) continue;
          (printed[pc.control.name] ??= []).push(`p${p + 1}:${pc.text === '' ? '(blank)' : pc.text}`);
        }
      }
    });
    for (const name of Object.keys(PRINTED)) expect([name, printed[name]]).toEqual([name, PRINTED[name]]);
    expect(Object.keys(printed).sort()).toEqual(Object.keys(PRINTED).sort());
  });

  it('prints a control\'s own text, as before, when there is no test data', () => {
    const report = paginate(parseReportStructure(scopesReport()), 3);
    const detail = report.pages[0].bands.find((b) => b.band.kind === 'Detail')!;
    expect(detail.controls.find((pc) => pc.control.name === 'd_report')!.text).toBe('');
  });
});

/*
 * Cases c05 to c05e of docs/proposals/devexpress-parity.md, end to end: 90
 * records grouped by Region, sorted by Customer descending within each group,
 * printed through DevExpress 20.1 (`RepxProbe render`, 2026-10-30) with
 * RepeatEveryPage, GroupUnion=WholePage, PageBreak=AfterBand, an orphaned
 * header, and GroupUnion=WithFirstDetail. Each page is written as DevExpress
 * printed it, read from the PDF it exported: a group header H:, a run of
 * customers first-last x count, and a group footer F: with its order count.
 * Records C0052 and C0088 print at the foot of their page with their box
 * crossing into the page footer, which is the line-fit rule in splitInstance.
 */
describe('groups from test data, as DevExpress printed them (cases c05 to c05e)', () => {
  const BASE = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"ParityCase\" ReportUnit=\"HundredthsOfAnInch\" Margins=\"50, 50, 50, 50\" PageWidth=\"850\" PageHeight=\"1100\" Version=\"20.1\" DataMember=\"Sales\"><CalculatedFields><Item1 Ref=\"2\" Name=\"AmountWithTax\" FieldType=\"Decimal\" Expression=\"[Amount] * 1.2\" DataMember=\"Sales\" /></CalculatedFields><Bands><Item1 Ref=\"3\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"50\"></Item1><Item2 Ref=\"5\" ControlType=\"PageHeaderBand\" Name=\"PageHeader\" HeightF=\"25\"><Controls><Item1 Ref=\"4\" ControlType=\"XRLabel\" Name=\"lblHead\" Text=\"GROUPED SALES\" Font=\"Arial, 9pt, style=Bold\" LocationFloat=\"0,0\" SizeF=\"750,20\" /></Controls></Item2><Item3 Ref=\"10\" ControlType=\"GroupHeaderBand\" Name=\"GroupHeader\" HeightF=\"30\" RepeatEveryPage=\"true\"><GroupFields><Item1 Ref=\"6\" FieldName=\"Region\" /></GroupFields><Controls><Item1 Ref=\"7\" ControlType=\"XRLabel\" Name=\"lblRegion\" TextFormatString=\"Region: {0}\" Font=\"Arial, 11pt, style=Bold\" LocationFloat=\"0,0\" SizeF=\"400,25\"><ExpressionBindings><Item1 Ref=\"8\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Region]\" /><Item2 Ref=\"9\" EventName=\"BeforePrint\" PropertyName=\"Bookmark\" Expression=\"[Region]\" /></ExpressionBindings></Item1></Controls></Item3><Item4 Ref=\"25\" ControlType=\"DetailBand\" Name=\"Detail\" HeightF=\"22\"><SortFields><Item1 Ref=\"11\" FieldName=\"Customer\" SortOrder=\"Descending\" /></SortFields><Controls><Item1 Ref=\"12\" ControlType=\"XRLabel\" Name=\"lblCust\" Font=\"Arial, 9pt\" LocationFloat=\"0,0\" SizeF=\"100,20\"><ExpressionBindings><Item1 Ref=\"13\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Customer]\" /></ExpressionBindings></Item1><Item2 Ref=\"14\" ControlType=\"XRLabel\" Name=\"lblDate\" TextFormatString=\"{0:dd MMM yyyy}\" Font=\"Arial, 9pt\" LocationFloat=\"100,0\" SizeF=\"130,20\"><ExpressionBindings><Item1 Ref=\"15\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[OrderDate]\" /></ExpressionBindings></Item2><Item3 Ref=\"16\" ControlType=\"XRLabel\" Name=\"lblAmt\" TextFormatString=\"{0:c2}\" Font=\"Arial, 9pt\" TextAlignment=\"TopRight\" LocationFloat=\"230,0\" SizeF=\"130,20\"><ExpressionBindings><Item1 Ref=\"17\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Amount]\" /></ExpressionBindings></Item3><Item4 Ref=\"18\" ControlType=\"XRLabel\" Name=\"lblTax\" TextFormatString=\"{0:c2}\" Font=\"Arial, 9pt\" TextAlignment=\"TopRight\" LocationFloat=\"370,0\" SizeF=\"130,20\"><ExpressionBindings><Item1 Ref=\"19\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[AmountWithTax]\" /></ExpressionBindings></Item4><Item5 Ref=\"20\" ControlType=\"XRLabel\" Name=\"lblRun\" TextFormatString=\"{0:c2}\" Font=\"Arial, 9pt\" TextAlignment=\"TopRight\" LocationFloat=\"510,0\" SizeF=\"130,20\"><Summary Ref=\"21\" Running=\"Report\" /><ExpressionBindings><Item1 Ref=\"22\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumRunningSum([Amount])\" /></ExpressionBindings></Item5><Item6 Ref=\"23\" ControlType=\"XRLabel\" Name=\"lblQty\" TextFormatString=\"{0:n0}\" Font=\"Arial, 9pt\" TextAlignment=\"TopRight\" LocationFloat=\"650,0\" SizeF=\"100,20\"><ExpressionBindings><Item1 Ref=\"24\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Qty]\" /></ExpressionBindings></Item6></Controls></Item4><Item5 Ref=\"32\" ControlType=\"GroupFooterBand\" Name=\"GroupFooter\" HeightF=\"30\"><Controls><Item1 Ref=\"26\" ControlType=\"XRLabel\" Name=\"lblSub\" TextFormatString=\"{0:c2}\" Font=\"Arial, 9pt, style=Bold\" TextAlignment=\"TopRight\" LocationFloat=\"230,0\" SizeF=\"130,20\"><Summary Ref=\"27\" Running=\"Group\" /><ExpressionBindings><Item1 Ref=\"28\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumSum([Amount])\" /></ExpressionBindings></Item1><Item2 Ref=\"29\" ControlType=\"XRLabel\" Name=\"lblCount\" TextFormatString=\"{0} orders\" Font=\"Arial, 9pt\" LocationFloat=\"0,0\" SizeF=\"220,20\"><Summary Ref=\"30\" Running=\"Group\" /><ExpressionBindings><Item1 Ref=\"31\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumCount([Customer])\" /></ExpressionBindings></Item2></Controls></Item5><Item6 Ref=\"36\" ControlType=\"ReportFooterBand\" Name=\"ReportFooter\" HeightF=\"30\"><Controls><Item1 Ref=\"33\" ControlType=\"XRLabel\" Name=\"lblGrand\" TextFormatString=\"{0:c2}\" Font=\"Arial, 9pt, style=Bold\" TextAlignment=\"TopRight\" LocationFloat=\"230,0\" SizeF=\"130,20\"><Summary Ref=\"34\" Running=\"Report\" /><ExpressionBindings><Item1 Ref=\"35\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumSum([Amount])\" /></ExpressionBindings></Item1></Controls></Item6><Item7 Ref=\"39\" ControlType=\"PageFooterBand\" Name=\"PageFooter\" HeightF=\"30\"><Controls><Item1 Ref=\"37\" ControlType=\"XRPageInfo\" Name=\"pageOfTotal\" TextFormatString=\"Page {0} of {1}\" PageInfo=\"NumberOfTotal\" LocationFloat=\"0,5\" SizeF=\"300,20\" /><Item2 Ref=\"38\" ControlType=\"XRPageInfo\" Name=\"pageRoman\" PageInfo=\"RomLowNumber\" TextAlignment=\"TopRight\" LocationFloat=\"550,5\" SizeF=\"200,20\" /></Controls></Item7><Item8 Ref=\"40\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"50\"></Item8></Bands></XtraReportsLayoutSerializer>\n";
  const VARIANTS: Record<string, [string, string][]> = {"c05-groups":[],"c05b-keepgroup":[["RepeatEveryPage=\"true\"","GroupUnion=\"WholePage\""]],"c05c-pagebreak":[[" RepeatEveryPage=\"true\"",""],["Name=\"GroupFooter\" HeightF=\"30\"","Name=\"GroupFooter\" HeightF=\"30\" PageBreak=\"AfterBand\""]],"c05d-orphan":[[" RepeatEveryPage=\"true\"",""],["Name=\"PageHeader\" HeightF=\"25\"","Name=\"PageHeader\" HeightF=\"315\""]],"c05e-union":[["RepeatEveryPage=\"true\"","GroupUnion=\"WithFirstDetail\""],["Name=\"PageHeader\" HeightF=\"25\"","Name=\"PageHeader\" HeightF=\"315\""]]};
  const REGIONS: Record<string, string> = { W: 'West', N: 'North', S: 'South' };
  const ROWS = "W,C0001,2026-08-22,984.68,20;W,C0002,2026-11-08,615.46,5;S,C0003,2026-03-11,109.29,11;S,C0004,2026-03-08,406.61,10;S,C0005,2026-10-19,548.97,6;S,C0006,2026-10-17,272.82,12;W,C0007,2026-08-01,680.99,15;N,C0008,2026-01-11,289.03999999999996,2;N,C0009,2026-01-22,314.14,7;W,C0010,2026-04-07,947.54,19;S,C0011,2026-06-28,204.12,3;N,C0012,2026-05-18,707.37,20;W,C0013,2026-07-04,948.55,13;S,C0014,2026-01-06,304.78,17;S,C0015,2026-09-25,343.78,17;S,C0016,2026-01-14,172.04999999999998,17;S,C0017,2026-01-14,934.13,11;S,C0018,2026-01-14,944.1,13;N,C0019,2026-07-22,507.65,3;N,C0020,2026-06-19,757.02,9;N,C0021,2026-01-28,120.12,16;W,C0022,2026-04-25,270.58,14;S,C0023,2026-07-19,822.03,12;W,C0024,2026-08-23,309.64,16;S,C0025,2026-01-05,132.41,9;S,C0026,2026-07-11,956.7,8;W,C0027,2026-06-07,330,12;W,C0028,2026-11-03,402.17,4;N,C0029,2026-12-21,858.26,2;S,C0030,2026-05-27,358.45,7;W,C0031,2026-04-02,651.8,12;W,C0032,2026-07-05,813.98,9;W,C0033,2026-01-22,850.67,5;W,C0034,2026-12-05,621.4,1;S,C0035,2026-11-02,616.61,12;W,C0036,2026-09-09,804.49,8;S,C0037,2026-10-16,100.68,11;S,C0038,2026-08-15,897.62,14;W,C0039,2026-05-03,441.01,5;W,C0040,2026-01-06,900.93,13;S,C0041,2026-03-21,925.88,16;W,C0042,2026-11-06,986.09,12;N,C0043,2026-08-14,639.64,16;N,C0044,2026-05-20,515.97,3;W,C0045,2026-02-11,956.37,9;N,C0046,2026-07-19,947.5,2;S,C0047,2026-06-15,206.07,4;S,C0048,2026-05-27,941.1,20;S,C0049,2026-05-25,472.32,2;S,C0050,2026-04-14,658.85,3;S,C0051,2026-06-13,334.77,17;S,C0052,2026-04-18,683.25,8;N,C0053,2026-05-11,268.8,18;S,C0054,2026-06-07,468.28999999999996,16;N,C0055,2026-11-01,701.29,8;S,C0056,2026-10-02,534.11,20;N,C0057,2026-12-26,769.7,11;W,C0058,2026-08-14,420.56,14;W,C0059,2026-02-27,215.69,3;S,C0060,2026-06-19,633.23,10;W,C0061,2026-05-10,758.22,13;S,C0062,2026-04-15,309.02,10;W,C0063,2026-12-05,475.17,17;W,C0064,2026-01-21,705.56,13;W,C0065,2026-02-06,998.28,18;N,C0066,2026-09-04,480.68,7;N,C0067,2026-02-26,351.34,13;N,C0068,2026-09-06,687.46,3;N,C0069,2026-03-09,571.06,2;S,C0070,2026-01-21,227.46,4;N,C0071,2026-11-11,640.81,17;S,C0072,2026-02-10,557.28,12;W,C0073,2026-01-09,975.23,15;S,C0074,2026-03-17,213.91,6;N,C0075,2026-10-26,459.2,1;N,C0076,2026-08-14,726.97,2;S,C0077,2026-11-08,710.75,19;S,C0078,2026-07-18,924.18,14;S,C0079,2026-12-03,853.99,16;S,C0080,2026-07-11,640.85,15;W,C0081,2026-06-11,108.98,14;N,C0082,2026-10-23,336.09999999999997,9;N,C0083,2026-12-11,784.39,2;S,C0084,2026-12-07,691.03,12;N,C0085,2026-05-16,302.53,15;N,C0086,2026-03-27,474.84,14;N,C0087,2026-06-18,526.23,15;S,C0088,2026-04-08,975.5699999999999,20;W,C0089,2026-04-10,184.84,10;W,C0090,2026-12-04,200.12,4".split(';').map((line) => {
    const [r, Customer, OrderDate, Amount, Qty] = line.split(',');
    return { Region: REGIONS[r], Customer, OrderDate, Amount, Qty };
  });
  const PRINTED: Record<string, string[][]> = {"c05-groups":[["H:North","C0087-C0008x25","F:25","H:South","C0088-C0052x14"],["H:South","C0051-C0003x23","F:37","H:West","C0090-C0034x16"],["H:West","C0033-C0001x12","F:28"]],"c05b-keepgroup":[["H:North","C0087-C0008x25","F:25"],["H:South","C0088-C0003x37","F:37"],["H:West","C0090-C0001x28","F:28"]],"c05c-pagebreak":[["H:North","C0087-C0008x25","F:25"],["H:South","C0088-C0003x37","F:37"],["H:West","C0090-C0001x28","F:28"],[]],"c05d-orphan":[["H:North","C0087-C0008x25","F:25","H:South","C0088-C0088x1"],["C0084-C0016x29"],["C0015-C0003x7","F:37","H:West","C0090-C0028x20"],["C0027-C0001x8","F:28"]],"c05e-union":[["H:North","C0087-C0008x25","F:25"],["H:South","C0088-C0018x28"],["C0017-C0003x9","F:37","H:West","C0090-C0032x18"],["C0031-C0001x10","F:28"]]};

  /** The same tokens from Forma's pages, every text in reading order. */
  const pagesOf = (report: PaginatedReport) => report.pages.map((page) => {
    const texts = page.bands.flatMap((band) => band.controls.map((pc) => ({
      y: band.top + pc.y, x: band.left + pc.control.x + pc.control.offsetX, s: (pc.text ?? '').trim(),
    }))).filter((t) => t.s).sort((a, b) => a.y - b.y || a.x - b.x).map((t) => t.s);
    const out: string[] = [];
    let run: { first: string; last: string; n: number } | null = null;
    const flush = () => { if (run) { out.push(`${run.first}-${run.last}x${run.n}`); run = null; } };
    for (const t of texts) {
      if (/^C\d{4}$/.test(t)) { if (run) { run.last = t; run.n++; } else run = { first: t, last: t, n: 1 }; continue; }
      const h = /^Region: (.+)$/.exec(t);
      const f = /^(\d+) orders$/.exec(t);
      if (h) { flush(); out.push(`H:${h[1]}`); } else if (f) { flush(); out.push(`F:${f[1]}`); }
    }
    flush();
    return out;
  });

  for (const [name, pairs] of Object.entries(VARIANTS)) {
    it(`prints ${name} page for page as DevExpress did`, () => {
      const repx = pairs.reduce((text, [from, to]) => text.replace(from, to), BASE);
      const report = paginate(parseReportStructure(repx), ROWS.length, { rows: ROWS });
      expect(pagesOf(report)).toEqual(PRINTED[name]);
    });
  }

  it('repeats a group header only on the pages its group continues onto', () => {
    const report = paginate(parseReportStructure(BASE), ROWS.length, { rows: ROWS });
    const heads = report.pages.map((p) => p.bands.filter((b) => b.band.kind === 'GroupHeader').length);
    expect(heads).toEqual([2, 2, 1]); // North and South; South again and West; West again
  });
});

/*
 * Case s17 of docs/proposals/devexpress-parity.md, end to end with its groups:
 * every summary scope in every band over 50 records in three groups on three
 * pages, record 21 split across the first break. Every expectation is a string
 * DevExpress 20.1 printed, prefixed by its page.
 */
describe('groups and summaries from test data, as DevExpress printed them (case s17)', () => {
  type Spec = [name: string, expression: string, x: number, y: number, running?: string, format?: string];
  const SPEC: Record<string, Spec[]> = {
    ReportHeader: [
      ["rh_report","sumSum([Qty])",0,0,"Report"],
      ["rh_page","sumSum([Qty])",125,0,"Page"],
      ["rh_group","sumSum([Qty])",250,0,"Group"],
      ["rh_none","sumSum([Qty])",375,0,""],
      ["rh_count","sumCount()",500,0,"Report"],
      ["rh_rrep","sumRunningSum([Qty])",625,0,"Report"],
      ["rh_qty","[Qty]",0,18],
    ],
    PageHeader: [
      ["ph_page","sumSum([Qty])",0,0,"Page"],
      ["ph_report","sumSum([Qty])",125,0,"Report"],
      ["ph_group","sumSum([Qty])",250,0,"Group"],
      ["ph_pcount","sumCount()",375,0,"Page"],
      ["ph_rrep","sumRunningSum([Qty])",500,0,"Report"],
      ["ph_rpage","sumRunningSum([Qty])",625,0,"Page"],
      ["ph_qty","[Qty]",0,18],
    ],
    GroupHeader: [
      ["gh_region","[Region]",0,0],
      ["gh_group","sumSum([Qty])",125,0,"Group"],
      ["gh_report","sumSum([Qty])",250,0,"Report"],
      ["gh_page","sumSum([Qty])",375,0,"Page"],
      ["gh_count","sumCount()",500,0,"Group"],
      ["gh_rsum","sumRunningSum([Qty])",625,0,"Group"],
      ["gh_qty","[Qty]",0,18],
    ],
    Detail: [
      ["d_qty","[Qty]",0,0],
      ["d_group","sumSum([Qty])",60,0,"Group"],
      ["d_report","sumSum([Qty])",185,0,"Report"],
      ["d_page","sumSum([Qty])",310,0,"Page"],
      ["d_none","sumSum([Qty])",435,0,""],
      ["d_rgroup","sumRunningSum([Qty])",560,0,"Group"],
      ["d_recgroup","sumRecordNumber()",0,18,"Group"],
      ["d_recpage","sumRecordNumber()",125,18,"Page"],
      ["d_recreport","sumRecordNumber()",250,18,"Report"],
      ["d_rpage","sumRunningSum([Qty])",375,18,"Page"],
      ["d_avg","sumAvg([Qty])",500,18,"Group"],
      ["d_nullfmt","[Missing]",625,18,undefined,"Total: {0:c2}"],
    ],
    GroupFooter: [
      ["gf_group","sumSum([Qty])",0,0,"Group"],
      ["gf_page","sumSum([Qty])",125,0,"Page"],
      ["gf_report","sumSum([Qty])",250,0,"Report"],
      ["gf_rsum","sumRunningSum([Qty])",375,0,"Group"],
      ["gf_rec","sumRecordNumber()",500,0,"Group"],
      ["gf_qty","[Qty]",0,18],
      ["gf_region","[Region]",125,18],
    ],
    PageFooter: [
      ["pf_page","sumSum([Qty])",0,0,"Page"],
      ["pf_report","sumSum([Qty])",125,0,"Report"],
      ["pf_group","sumSum([Qty])",250,0,"Group"],
      ["pf_none","sumSum([Qty])",375,0,""],
      ["pf_rrep","sumRunningSum([Qty])",500,0,"Report"],
      ["pf_qty","[Qty]",0,18],
      ["pf_groupfmt","sumSum([Qty])",125,18,"Group","{0:c2}"],
    ],
    ReportFooter: [
      ["rf_report","sumSum([Qty])",0,0,"Report"],
      ["rf_page","sumSum([Qty])",125,0,"Page"],
      ["rf_rrep","sumRunningSum([Qty])",250,0,"Report"],
      ["rf_qty","[Qty]",0,18],
    ],
  };
  const ROWS = [{"Region":"North","Qty":"1"},{"Region":"North","Qty":"2"},{"Region":"North","Qty":"3"},{"Region":"North","Qty":"4"},{"Region":"North","Qty":"5"},{"Region":"North","Qty":"6"},{"Region":"North","Qty":"7"},{"Region":"North","Qty":"8"},{"Region":"North","Qty":"9"},{"Region":"North","Qty":"10"},{"Region":"North","Qty":"11"},{"Region":"North","Qty":"12"},{"Region":"North","Qty":"13"},{"Region":"North","Qty":"14"},{"Region":"North","Qty":"15"},{"Region":"South","Qty":"16"},{"Region":"South","Qty":"17"},{"Region":"South","Qty":"18"},{"Region":"South","Qty":"19"},{"Region":"South","Qty":"20"},{"Region":"South","Qty":"21"},{"Region":"South","Qty":"22"},{"Region":"South","Qty":"23"},{"Region":"South","Qty":"24"},{"Region":"South","Qty":"25"},{"Region":"South","Qty":"26"},{"Region":"South","Qty":"27"},{"Region":"South","Qty":"28"},{"Region":"South","Qty":"29"},{"Region":"South","Qty":"30"},{"Region":"South","Qty":"31"},{"Region":"South","Qty":"32"},{"Region":"South","Qty":"33"},{"Region":"South","Qty":"34"},{"Region":"South","Qty":"35"},{"Region":"West","Qty":"36"},{"Region":"West","Qty":"37"},{"Region":"West","Qty":"38"},{"Region":"West","Qty":"39"},{"Region":"West","Qty":"40"},{"Region":"West","Qty":"41"},{"Region":"West","Qty":"42"},{"Region":"West","Qty":"43"},{"Region":"West","Qty":"44"},{"Region":"West","Qty":"45"},{"Region":"West","Qty":"46"},{"Region":"West","Qty":"47"},{"Region":"West","Qty":"48"},{"Region":"West","Qty":"49"},{"Region":"West","Qty":"50"}];
  const PRINTED: Record<string, string[]> = {
    d_avg: ["p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:25.5","p1:25.5","p1:25.5","p1:25.5","p1:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:43","p2:43","p2:43","p2:43","p2:43","p2:43","p2:43","p2:43","p3:43","p3:43","p3:43","p3:43","p3:43","p3:43","p3:43"],
    d_group: ["p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:510","p1:510","p1:510","p1:510","p1:510","p1:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:645","p2:645","p2:645","p2:645","p2:645","p2:645","p2:645","p2:645","p3:645","p3:645","p3:645","p3:645","p3:645","p3:645","p3:645"],
    d_none: ["p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p3:(blank)","p3:(blank)","p3:(blank)","p3:(blank)","p3:(blank)","p3:(blank)","p3:(blank)"],
    d_nullfmt: ["p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p3:(blank)","p3:(blank)","p3:(blank)","p3:(blank)","p3:(blank)","p3:(blank)","p3:(blank)"],
    d_page: ["p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p3:329","p3:329","p3:329","p3:329","p3:329","p3:329","p3:329"],
    d_qty: ["p1:1","p1:2","p1:3","p1:4","p1:5","p1:6","p1:7","p1:8","p1:9","p1:10","p1:11","p1:12","p1:13","p1:14","p1:15","p1:16","p1:17","p1:18","p1:19","p1:20","p1:21","p2:22","p2:23","p2:24","p2:25","p2:26","p2:27","p2:28","p2:29","p2:30","p2:31","p2:32","p2:33","p2:34","p2:35","p2:36","p2:37","p2:38","p2:39","p2:40","p2:41","p2:42","p2:43","p3:44","p3:45","p3:46","p3:47","p3:48","p3:49","p3:50"],
    d_recgroup: ["p1:1","p1:2","p1:3","p1:4","p1:5","p1:6","p1:7","p1:8","p1:9","p1:10","p1:11","p1:12","p1:13","p1:14","p1:15","p1:1","p1:2","p1:3","p1:4","p1:5","p2:6","p2:7","p2:8","p2:9","p2:10","p2:11","p2:12","p2:13","p2:14","p2:15","p2:16","p2:17","p2:18","p2:19","p2:20","p2:1","p2:2","p2:3","p2:4","p2:5","p2:6","p2:7","p2:8","p3:9","p3:10","p3:11","p3:12","p3:13","p3:14","p3:15"],
    d_recpage: ["p1:1","p1:2","p1:3","p1:4","p1:5","p1:6","p1:7","p1:8","p1:9","p1:10","p1:11","p1:12","p1:13","p1:14","p1:15","p1:16","p1:17","p1:18","p1:19","p1:20","p2:1","p2:2","p2:3","p2:4","p2:5","p2:6","p2:7","p2:8","p2:9","p2:10","p2:11","p2:12","p2:13","p2:14","p2:15","p2:16","p2:17","p2:18","p2:19","p2:20","p2:21","p2:22","p2:23","p3:1","p3:2","p3:3","p3:4","p3:5","p3:6","p3:7"],
    d_recreport: ["p1:1","p1:2","p1:3","p1:4","p1:5","p1:6","p1:7","p1:8","p1:9","p1:10","p1:11","p1:12","p1:13","p1:14","p1:15","p1:16","p1:17","p1:18","p1:19","p1:20","p2:21","p2:22","p2:23","p2:24","p2:25","p2:26","p2:27","p2:28","p2:29","p2:30","p2:31","p2:32","p2:33","p2:34","p2:35","p2:36","p2:37","p2:38","p2:39","p2:40","p2:41","p2:42","p2:43","p3:44","p3:45","p3:46","p3:47","p3:48","p3:49","p3:50"],
    d_report: ["p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p3:1275","p3:1275","p3:1275","p3:1275","p3:1275","p3:1275","p3:1275"],
    d_rgroup: ["p1:1","p1:3","p1:6","p1:10","p1:15","p1:21","p1:28","p1:36","p1:45","p1:55","p1:66","p1:78","p1:91","p1:105","p1:120","p1:16","p1:33","p1:51","p1:70","p1:90","p1:111","p2:133","p2:156","p2:180","p2:205","p2:231","p2:258","p2:286","p2:315","p2:345","p2:376","p2:408","p2:441","p2:475","p2:510","p2:36","p2:73","p2:111","p2:150","p2:190","p2:231","p2:273","p2:316","p3:360","p3:405","p3:451","p3:498","p3:546","p3:595","p3:645"],
    d_rpage: ["p1:1","p1:3","p1:6","p1:10","p1:15","p1:21","p1:28","p1:36","p1:45","p1:55","p1:66","p1:78","p1:91","p1:105","p1:120","p1:136","p1:153","p1:171","p1:190","p1:210","p2:21","p2:43","p2:66","p2:90","p2:115","p2:141","p2:168","p2:196","p2:225","p2:255","p2:286","p2:318","p2:351","p2:385","p2:420","p2:456","p2:493","p2:531","p2:570","p2:610","p2:651","p2:693","p2:736","p3:44","p3:89","p3:135","p3:182","p3:230","p3:279","p3:329"],
    gf_group: ["p1:120","p2:510","p3:645"],
    gf_page: ["p1:231","p2:736","p3:329"],
    gf_qty: ["p1:15","p2:35","p3:50"],
    gf_rec: ["p1:15","p2:20","p3:15"],
    gf_region: ["p1:North","p2:South","p3:West"],
    gf_report: ["p1:1275","p2:1275","p3:1275"],
    gf_rsum: ["p1:120","p2:510","p3:645"],
    gh_count: ["p1:15","p1:20","p2:15"],
    gh_group: ["p1:120","p1:510","p2:645"],
    gh_page: ["p1:231","p1:231","p2:736"],
    gh_qty: ["p1:1","p1:16","p2:36"],
    gh_region: ["p1:North","p1:South","p2:West"],
    gh_report: ["p1:1275","p1:1275","p2:1275"],
    gh_rsum: ["p1:120","p1:510","p2:645"],
    pf_group: ["p1:?","p2:?","p3:?"],
    pf_groupfmt: ["p1:?","p2:?","p3:?"],
    pf_none: ["p1:(blank)","p2:(blank)","p3:(blank)"],
    pf_page: ["p1:231","p2:736","p3:329"],
    pf_qty: ["p1:21","p2:43","p3:50"],
    pf_report: ["p1:1275","p2:1275","p3:1275"],
    pf_rrep: ["p1:231","p2:946","p3:1275"],
    ph_group: ["p1:?","p2:?","p3:?"],
    ph_page: ["p1:231","p2:736","p3:329"],
    ph_pcount: ["p1:21","p2:23","p3:7"],
    ph_qty: ["p1:1","p2:21","p3:44"],
    ph_report: ["p1:1275","p2:1275","p3:1275"],
    ph_rpage: ["p1:231","p2:736","p3:329"],
    ph_rrep: ["p1:231","p2:946","p3:1275"],
    rf_page: ["p3:329"],
    rf_qty: ["p3:50"],
    rf_report: ["p3:1275"],
    rf_rrep: ["p3:1275"],
    rh_count: ["p1:50"],
    rh_group: ["p1:?"],
    rh_none: ["p1:(blank)"],
    rh_page: ["p1:231"],
    rh_qty: ["p1:1"],
    rh_report: ["p1:1275"],
    rh_rrep: ["p1:1275"],
  };
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function report(): string {
    let ref = 100;
    const R = () => ++ref;
    const label = (n: number, [name, expression, x, y, running, format]: Spec) => {
      const summary = running === undefined ? '' : running === '' ? `<Summary Ref="${R()}" />` : `<Summary Ref="${R()}" Running="${running}" />`;
      return `<Item${n} Ref="${R()}" ControlType="XRLabel" Name="${name}"${format ? ` TextFormatString="${esc(format)}"` : ''} WordWrap="false" LocationFloat="${x},${y}" SizeF="120,16">${summary}` +
        `<ExpressionBindings><Item1 Ref="${R()}" EventName="BeforePrint" PropertyName="Text" Expression="${esc(expression)}" /></ExpressionBindings></Item${n}>`;
    };
    let item = 1;
    const bands = [`<Item${item++} Ref="${R()}" ControlType="TopMarginBand" Name="TopMargin" HeightF="20" />`];
    for (const [kind, controls] of Object.entries(SPEC)) {
      const group = kind === 'GroupHeader' ? `<GroupFields><Item1 Ref="${R()}" FieldName="Region" /></GroupFields>` : '';
      const inner = group + '<Controls>' + controls.map((c, i) => label(i + 1, c)).join('') + '</Controls>';
      bands.push(`<Item${item} Ref="${R()}" ControlType="${kind}Band" Name="${kind}" HeightF="40">${inner}</Item${item}>`);
      item++;
    }
    bands.push(`<Item${item} Ref="${R()}" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="20" />`);
    return '<?xml version="1.0" encoding="utf-8"?>' +
      '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Scopes" ReportUnit="HundredthsOfAnInch" Margins="20, 20, 20, 20" PageWidth="850" PageHeight="1100" Version="20.1" DataMember="Items" Font="Arial, 7pt">' +
      `<Bands>${bands.join('')}</Bands></XtraReportsLayoutSerializer>`;
  }

  it('prints every group, summary and field on the page DevExpress printed it on', () => {
    const result = paginate(parseReportStructure(report()), ROWS.length, { rows: ROWS });
    expect(result.pages).toHaveLength(3);
    const printed: Record<string, string[]> = {};
    result.pages.forEach((page, p) => {
      for (const band of page.bands) for (const pc of band.controls) {
        if (pc.text === null) continue;
        (printed[pc.control.name] ??= []).push(`p${p + 1}:${pc.text === '' ? '(blank)' : pc.text}`);
      }
    });
    for (const name of Object.keys(PRINTED)) expect([name, printed[name]]).toEqual([name, PRINTED[name]]);
  });
});

/*
 * Case s19: which group is the outer one. Two group headers and footers over
 * twelve records, written seven ways, page 1 in reading order as DevExpress 20.1
 * printed it. a and b: Level 1 and 0, in either file order. c: no Level, so the
 * later band is outer. d and e: only the outer band writes Level="1", as a
 * designer-saved file does. f and g: one footer, at Level 1 and with none.
 */
describe('nested groups, as DevExpress nests them (case s19)', () => {
  const ROWS = [{"Region":"B","Category":"Z","Qty":"1"},{"Region":"A","Category":"X","Qty":"2"},{"Region":"B","Category":"Y","Qty":"3"},{"Region":"A","Category":"Z","Qty":"4"},{"Region":"B","Category":"X","Qty":"5"},{"Region":"A","Category":"Y","Qty":"6"},{"Region":"B","Category":"Z","Qty":"7"},{"Region":"A","Category":"X","Qty":"8"},{"Region":"B","Category":"Y","Qty":"9"},{"Region":"A","Category":"Z","Qty":"10"},{"Region":"B","Category":"X","Qty":"11"},{"Region":"A","Category":"Y","Qty":"12"}];
  const PRINTED: Record<string, string[]> = {"a":["Region A","Category X","A/X 2","A/X 8","end Category 10","Category Y","A/Y 6","A/Y 12","end Category 18","Category Z","A/Z 4","A/Z 10","end Category 14","end Region 42","Region B","Category X","B/X 5","B/X 11","end Category 16","Category Y","B/Y 3","B/Y 9","end Category 12","Category Z","B/Z 1","B/Z 7","end Category 8","end Region 36"],"b":["Region A","Category X","A/X 2","A/X 8","end Category 10","Category Y","A/Y 6","A/Y 12","end Category 18","Category Z","A/Z 4","A/Z 10","end Category 14","end Region 42","Region B","Category X","B/X 5","B/X 11","end Category 16","Category Y","B/Y 3","B/Y 9","end Category 12","Category Z","B/Z 1","B/Z 7","end Category 8","end Region 36"],"c":["Category X","Region A","A/X 2","A/X 8","end Region 10","Region B","B/X 5","B/X 11","end Region 16","end Category 26","Category Y","Region A","A/Y 6","A/Y 12","end Region 18","Region B","B/Y 3","B/Y 9","end Region 12","end Category 30","Category Z","Region A","A/Z 4","A/Z 10","end Region 14","Region B","B/Z 1","B/Z 7","end Region 8","end Category 22"],"d":["Region A","Category X","A/X 2","A/X 8","end Category 10","Category Y","A/Y 6","A/Y 12","end Category 18","Category Z","A/Z 4","A/Z 10","end Category 14","end Region 42","Region B","Category X","B/X 5","B/X 11","end Category 16","Category Y","B/Y 3","B/Y 9","end Category 12","Category Z","B/Z 1","B/Z 7","end Category 8","end Region 36"],"e":["Region A","Category X","A/X 2","A/X 8","end Category 10","Category Y","A/Y 6","A/Y 12","end Category 18","Category Z","A/Z 4","A/Z 10","end Category 14","end Region 42","Region B","Category X","B/X 5","B/X 11","end Category 16","Category Y","B/Y 3","B/Y 9","end Category 12","Category Z","B/Z 1","B/Z 7","end Category 8","end Region 36"],"f":["Region A","Category X","A/X 2","A/X 8","Category Y","A/Y 6","A/Y 12","Category Z","A/Z 4","A/Z 10","end Region 42","Region B","Category X","B/X 5","B/X 11","Category Y","B/Y 3","B/Y 9","Category Z","B/Z 1","B/Z 7","end Region 36"],"g":["Region A","Category X","A/X 2","A/X 8","end Region 10","Category Y","A/Y 6","A/Y 12","end Region 18","Category Z","A/Z 4","A/Z 10","end Region 14","Region B","Category X","B/X 5","B/X 11","end Region 16","Category Y","B/Y 3","B/Y 9","end Region 12","Category Z","B/Z 1","B/Z 7","end Region 8"]};
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/"/g, '&quot;');
  function report(variant: string): string {
    let ref = 1;
    const R = () => ++ref;
    const label = (name: string, expression: string, x: number, running?: string) =>
      `<Item1 Ref="${R()}" ControlType="XRLabel" Name="${name}" LocationFloat="${x},0" SizeF="200,18">` +
      (running ? `<Summary Ref="${R()}" Running="${running}" />` : '') +
      `<ExpressionBindings><Item1 Ref="${R()}" EventName="BeforePrint" PropertyName="Text" Expression="${esc(expression)}" /></ExpressionBindings></Item1>`;
    const levelOf = (l: number) => (variant === 'c' || ('defg'.includes(variant) && l === 0) ? '' : ` Level="${l}"`);
    const header = (field: string, l: number) => (n: number) =>
      `<Item${n} Ref="${R()}" ControlType="GroupHeaderBand" Name="gh${field}"${levelOf(l)} HeightF="20">` +
      `<GroupFields><Item1 Ref="${R()}" FieldName="${field}" /></GroupFields><Controls>${label(`h${field}`, `'${field} ' + [${field}]`, l ? 0 : 20)}</Controls></Item${n}>`;
    const footer = (field: string, l: number) => (n: number) =>
      `<Item${n} Ref="${R()}" ControlType="GroupFooterBand" Name="gf${field}"${levelOf(l)} HeightF="20">` +
      `<Controls>${label(`f${field}`, `'end ${field} ' + sumSum([Qty])`, l ? 0 : 20, 'Group')}</Controls></Item${n}>`;
    const flipped = variant === 'b' || variant === 'e';
    const heads = flipped ? [header('Category', 0), header('Region', 1)] : [header('Region', 1), header('Category', 0)];
    const foots = variant === 'f' ? [footer('Region', 1)] : variant === 'g' ? [footer('Region', 0)]
      : flipped ? [footer('Category', 0), footer('Region', 1)] : [footer('Region', 1), footer('Category', 0)];
    const parts = [
      (n: number) => `<Item${n} Ref="${R()}" ControlType="TopMarginBand" Name="TopMargin" HeightF="20" />`,
      ...heads,
      (n: number) => `<Item${n} Ref="${R()}" ControlType="DetailBand" Name="Detail" HeightF="20"><Controls>${label('dQty', "[Region] + '/' + [Category] + ' ' + [Qty]", 40)}</Controls></Item${n}>`,
      ...foots,
      (n: number) => `<Item${n} Ref="${R()}" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="20" />`,
    ];
    return '<?xml version="1.0" encoding="utf-8"?>' +
      '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Nested" ReportUnit="HundredthsOfAnInch" Margins="20, 20, 20, 20" PageWidth="850" PageHeight="1100" Version="20.1" DataMember="Items" Font="Arial, 8pt">' +
      `<Bands>${parts.map((p, i) => p(i + 1)).join('')}</Bands></XtraReportsLayoutSerializer>`;
  }

  for (const variant of Object.keys(PRINTED)) {
    it(`nests variant ${variant} as DevExpress did`, () => {
      const page = paginate(parseReportStructure(report(variant)), ROWS.length, { rows: ROWS }).pages[0];
      const texts = page.bands.flatMap((band) => band.controls.map((pc) => ({ y: band.top + pc.y, s: pc.text ?? '' })))
        .sort((a, b) => a.y - b.y).map((t) => t.s);
      expect(texts).toEqual(PRINTED[variant]);
    });
  }
});

/*
 * Case s21: what every kind of text prints over an empty data source, as
 * DevExpress 20.1 printed it (`RepxProbe render`, 2026-10-30, a filter that
 * matched nothing). One page; every band once, Detail included; counts and
 * record numbers 0, a page sum 0, every other total blank.
 */
describe('an empty data source, as DevExpress printed it (case s21)', () => {
  const REPX = "<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"Empty\" ReportUnit=\"HundredthsOfAnInch\" Margins=\"20, 20, 20, 20\" PageWidth=\"850\" PageHeight=\"1100\" Version=\"20.1\" DataMember=\"Items\" FilterString=\"[Qty] &gt; 1000\" Font=\"Arial, 8pt\"><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"20\" /><Item2 Ref=\"3\" ControlType=\"ReportHeaderBand\" Name=\"ReportHeader\" HeightF=\"25\"><Controls><Item1 Ref=\"4\" ControlType=\"XRLabel\" Name=\"rhLiteral\" LocationFloat=\"0,0\" SizeF=\"180,18\" Text=\"REPORT\" /><Item2 Ref=\"5\" ControlType=\"XRLabel\" Name=\"rhField\" LocationFloat=\"190,0\" SizeF=\"180,18\"><ExpressionBindings><Item1 Ref=\"6\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"'first ' + [Name]\" /></ExpressionBindings></Item2><Item3 Ref=\"7\" ControlType=\"XRLabel\" Name=\"rhCount\" LocationFloat=\"380,0\" SizeF=\"180,18\" TextFormatString=\"{0} rows\"><Summary Ref=\"8\" Running=\"Report\" /><ExpressionBindings><Item1 Ref=\"9\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumCount()\" /></ExpressionBindings></Item3></Controls></Item2><Item3 Ref=\"10\" ControlType=\"PageHeaderBand\" Name=\"PageHeader\" HeightF=\"25\"><Controls><Item1 Ref=\"11\" ControlType=\"XRLabel\" Name=\"phLiteral\" LocationFloat=\"0,0\" SizeF=\"180,18\" Text=\"HEADINGS\" /><Item2 Ref=\"12\" ControlType=\"XRLabel\" Name=\"phPage\" LocationFloat=\"190,0\" SizeF=\"180,18\"><Summary Ref=\"13\" Running=\"Page\" /><ExpressionBindings><Item1 Ref=\"14\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumSum([Qty])\" /></ExpressionBindings></Item2></Controls></Item3><Item4 Ref=\"15\" ControlType=\"GroupHeaderBand\" Name=\"GroupHeader\" HeightF=\"25\"><GroupFields><Item1 Ref=\"16\" FieldName=\"Region\" /></GroupFields><Controls><Item1 Ref=\"17\" ControlType=\"XRLabel\" Name=\"ghLiteral\" LocationFloat=\"0,0\" SizeF=\"180,18\" Text=\"GROUP\" /><Item2 Ref=\"18\" ControlType=\"XRLabel\" Name=\"ghRegion\" LocationFloat=\"190,0\" SizeF=\"180,18\" TextFormatString=\"Region: {0}\"><ExpressionBindings><Item1 Ref=\"19\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Region]\" /></ExpressionBindings></Item2></Controls></Item4><Item5 Ref=\"20\" ControlType=\"DetailBand\" Name=\"Detail\" HeightF=\"25\"><Controls><Item1 Ref=\"21\" ControlType=\"XRLabel\" Name=\"dLiteral\" LocationFloat=\"0,0\" SizeF=\"180,18\" Text=\"LINE\" /><Item2 Ref=\"22\" ControlType=\"XRLabel\" Name=\"dName\" LocationFloat=\"190,0\" SizeF=\"180,18\"><ExpressionBindings><Item1 Ref=\"23\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Name]\" /></ExpressionBindings></Item2><Item3 Ref=\"24\" ControlType=\"XRLabel\" Name=\"dQty\" LocationFloat=\"380,0\" SizeF=\"180,18\" TextFormatString=\"{0:n2}\"><ExpressionBindings><Item1 Ref=\"25\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Qty]\" /></ExpressionBindings></Item3><Item4 Ref=\"26\" ControlType=\"XRLabel\" Name=\"dCalc\" LocationFloat=\"570,0\" SizeF=\"180,18\"><ExpressionBindings><Item1 Ref=\"27\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"'x' + [Qty]\" /></ExpressionBindings></Item4></Controls></Item5><Item6 Ref=\"28\" ControlType=\"GroupFooterBand\" Name=\"GroupFooter\" HeightF=\"25\"><Controls><Item1 Ref=\"29\" ControlType=\"XRLabel\" Name=\"gfLiteral\" LocationFloat=\"0,0\" SizeF=\"180,18\" Text=\"SUBTOTAL\" /><Item2 Ref=\"30\" ControlType=\"XRLabel\" Name=\"gfSum\" LocationFloat=\"190,0\" SizeF=\"180,18\" TextFormatString=\"{0:c2}\"><Summary Ref=\"31\" Running=\"Group\" /><ExpressionBindings><Item1 Ref=\"32\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumSum([Qty])\" /></ExpressionBindings></Item2></Controls></Item6><Item7 Ref=\"33\" ControlType=\"ReportFooterBand\" Name=\"ReportFooter\" HeightF=\"60\"><Controls><Item1 Ref=\"34\" ControlType=\"XRLabel\" Name=\"rfLiteral\" LocationFloat=\"0,0\" SizeF=\"180,18\" Text=\"TOTALS\" /><Item2 Ref=\"35\" ControlType=\"XRLabel\" Name=\"rfSum\" LocationFloat=\"190,0\" SizeF=\"180,18\"><Summary Ref=\"36\" Running=\"Report\" /><ExpressionBindings><Item1 Ref=\"37\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumSum([Qty])\" /></ExpressionBindings></Item2><Item3 Ref=\"38\" ControlType=\"XRLabel\" Name=\"rfCount\" LocationFloat=\"380,0\" SizeF=\"180,18\"><Summary Ref=\"39\" Running=\"Report\" /><ExpressionBindings><Item1 Ref=\"40\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumCount()\" /></ExpressionBindings></Item3><Item4 Ref=\"41\" ControlType=\"XRLabel\" Name=\"rfAvg\" LocationFloat=\"570,0\" SizeF=\"180,18\"><Summary Ref=\"42\" Running=\"Report\" /><ExpressionBindings><Item1 Ref=\"43\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumAvg([Qty])\" /></ExpressionBindings></Item4><Item5 Ref=\"44\" ControlType=\"XRLabel\" Name=\"rfMax\" LocationFloat=\"0,20\" SizeF=\"180,18\"><Summary Ref=\"45\" Running=\"Report\" /><ExpressionBindings><Item1 Ref=\"46\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumMax([Qty])\" /></ExpressionBindings></Item5><Item6 Ref=\"47\" ControlType=\"XRLabel\" Name=\"rfSumFmt\" LocationFloat=\"190,20\" SizeF=\"180,18\" TextFormatString=\"Total {0:c2}\"><Summary Ref=\"48\" Running=\"Report\" /><ExpressionBindings><Item1 Ref=\"49\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumSum([Qty])\" /></ExpressionBindings></Item6><Item7 Ref=\"50\" ControlType=\"XRLabel\" Name=\"rfCountFmt\" LocationFloat=\"380,20\" SizeF=\"180,18\" TextFormatString=\"{0} orders\"><Summary Ref=\"51\" Running=\"Report\" /><ExpressionBindings><Item1 Ref=\"52\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumCount([Name])\" /></ExpressionBindings></Item7><Item8 Ref=\"53\" ControlType=\"XRLabel\" Name=\"rfDCount\" LocationFloat=\"570,20\" SizeF=\"180,18\"><Summary Ref=\"54\" Running=\"Report\" /><ExpressionBindings><Item1 Ref=\"55\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumDCount([Name])\" /></ExpressionBindings></Item8><Item9 Ref=\"56\" ControlType=\"XRLabel\" Name=\"rfRun\" LocationFloat=\"0,40\" SizeF=\"180,18\"><Summary Ref=\"57\" Running=\"Report\" /><ExpressionBindings><Item1 Ref=\"58\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumRunningSum([Qty])\" /></ExpressionBindings></Item9><Item10 Ref=\"59\" ControlType=\"XRLabel\" Name=\"rfRec\" LocationFloat=\"190,40\" SizeF=\"180,18\"><Summary Ref=\"60\" Running=\"Report\" /><ExpressionBindings><Item1 Ref=\"61\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumRecordNumber()\" /></ExpressionBindings></Item10></Controls></Item7><Item8 Ref=\"62\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"20\" /></Bands></XtraReportsLayoutSerializer>";
  const PRINTED: Record<string, string> = {
    "rhCount": "0 rows",
    "rhField": "first ",
    "rhLiteral": "REPORT",
    "phPage": "0",
    "phLiteral": "HEADINGS",
    "ghRegion": "",
    "ghLiteral": "GROUP",
    "dCalc": "x",
    "dQty": "",
    "dName": "",
    "dLiteral": "LINE",
    "gfSum": "",
    "gfLiteral": "SUBTOTAL",
    "rfRec": "0",
    "rfRun": "",
    "rfDCount": "0",
    "rfCountFmt": "0 orders",
    "rfSumFmt": "",
    "rfMax": "",
    "rfAvg": "",
    "rfCount": "0",
    "rfSum": "",
    "rfLiteral": "TOTALS"
  };

  it('prints every band once, with what DevExpress printed in each control', () => {
    const report = paginate(parseReportStructure(REPX), 0, { rows: [] });
    expect(report.pages).toHaveLength(1);
    expect(report.records).toBe(0);
    const kinds = report.pages[0].bands.map((b) => b.band.kind);
    expect(kinds.filter((k) => k === 'Detail')).toHaveLength(1);
    const actual: Record<string, string> = {};
    for (const band of report.pages[0].bands) for (const pc of band.controls) if (pc.text !== null) actual[pc.control.name] = pc.text;
    expect(actual).toEqual(PRINTED);
  });

  it('prints no Detail at all when there is no data source, only the layout', () => {
    const report = paginate(parseReportStructure(REPX), 3);
    expect(report.pages[0].bands.filter((b) => b.band.kind === 'Detail')).toHaveLength(3);
  });
});

/*
 * Case c07 of docs/proposals/devexpress-parity.md: FilterString="[Region] =
 * ?Region" with a North default, printed through DevExpress 20.1 with South
 * supplied (`RepxProbe render`, 2026-10-30). The supplied value won: the 37
 * South records of 90, on one page, in data order, and the header bound to the
 * parameter printed South.
 */
describe('a report filter with a supplied parameter, as DevExpress printed it (case c07)', () => {
  const REPX = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"ParityCase\" ReportUnit=\"HundredthsOfAnInch\" Margins=\"50, 50, 50, 50\" PageWidth=\"850\" PageHeight=\"1100\" Version=\"20.1\" DataMember=\"Sales\" FilterString=\"[Region] = ?Region\"><Parameters><Item1 Ref=\"2\" Description=\"Region\" ValueInfo=\"North\" Name=\"Region\" /></Parameters><Bands><Item1 Ref=\"3\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"50\"></Item1><Item2 Ref=\"6\" ControlType=\"ReportHeaderBand\" Name=\"ReportHeader\" HeightF=\"40\"><Controls><Item1 Ref=\"4\" ControlType=\"XRLabel\" Name=\"lblParam\" Font=\"Arial, 11pt\" LocationFloat=\"0,0\" SizeF=\"400,25\"><ExpressionBindings><Item1 Ref=\"5\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"'Region: ' + ?Region\" /></ExpressionBindings></Item1></Controls></Item2><Item3 Ref=\"11\" ControlType=\"DetailBand\" Name=\"Detail\" HeightF=\"22\"><Controls><Item1 Ref=\"7\" ControlType=\"XRLabel\" Name=\"lblCust\" Font=\"Arial, 9pt\" LocationFloat=\"0,0\" SizeF=\"200,20\"><ExpressionBindings><Item1 Ref=\"8\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Customer]\" /></ExpressionBindings></Item1><Item2 Ref=\"9\" ControlType=\"XRLabel\" Name=\"lblRegion\" Font=\"Arial, 9pt\" LocationFloat=\"210,0\" SizeF=\"200,20\"><ExpressionBindings><Item1 Ref=\"10\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Region]\" /></ExpressionBindings></Item2></Controls></Item3><Item4 Ref=\"12\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"50\"></Item4></Bands></XtraReportsLayoutSerializer>\n";
  const REGIONS: Record<string, string> = { N: 'North', S: 'South', W: 'West' };
  const ROWS = "W0001,W0002,S0003,S0004,S0005,S0006,W0007,N0008,N0009,W0010,S0011,N0012,W0013,S0014,S0015,S0016,S0017,S0018,N0019,N0020,N0021,W0022,S0023,W0024,S0025,S0026,W0027,W0028,N0029,S0030,W0031,W0032,W0033,W0034,S0035,W0036,S0037,S0038,W0039,W0040,S0041,W0042,N0043,N0044,W0045,N0046,S0047,S0048,S0049,S0050,S0051,S0052,N0053,S0054,N0055,S0056,N0057,W0058,W0059,S0060,W0061,S0062,W0063,W0064,W0065,N0066,N0067,N0068,N0069,S0070,N0071,S0072,W0073,S0074,N0075,N0076,S0077,S0078,S0079,S0080,W0081,N0082,N0083,S0084,N0085,N0086,N0087,S0088,W0089,W0090".split(',').map((c) => ({ Region: REGIONS[c[0]], Customer: 'C' + c.slice(1) }));
  const PRINTED = {"header":"Region: South","regions":["South"],"customers":["C0003","C0004","C0005","C0006","C0011","C0014","C0015","C0016","C0017","C0018","C0023","C0025","C0026","C0030","C0035","C0037","C0038","C0041","C0047","C0048","C0049","C0050","C0051","C0052","C0054","C0056","C0060","C0062","C0070","C0072","C0074","C0077","C0078","C0079","C0080","C0084","C0088"]};
  const texts = (report: PaginatedReport) => report.pages.flatMap((p) => p.bands.flatMap((b) => b.controls.map((pc) => pc.text ?? '')));

  it('keeps the records the filter is true for, with the supplied value over the default', () => {
    const report = paginate(parseReportStructure(REPX), ROWS.length, { rows: ROWS, parameters: { Region: 'South' } });
    expect(report.pages).toHaveLength(1);
    const all = texts(report);
    expect(all.filter((t) => /^C\d{4}$/.test(t))).toEqual(PRINTED.customers);
    expect(all).toContain(PRINTED.header);
    expect([...new Set(all.filter((t) => /^(North|South|West)$/.test(t)))]).toEqual(PRINTED.regions);
  });

  it('uses the default when nothing is supplied', () => {
    const report = paginate(parseReportStructure(REPX), ROWS.length, { rows: ROWS });
    expect(texts(report)).toContain('Region: North');
    expect(report.records).toBe(ROWS.filter((r) => r.Region === 'North').length);
  });

  it('says so, and filters nothing, when the filter cannot be read', () => {
    const broken = REPX.replace('FilterString="[Region] = ?Region"', 'FilterString="[Region] = ("');
    const report = paginate(parseReportStructure(broken), ROWS.length, { rows: ROWS });
    expect(report.records).toBe(ROWS.length);
    expect(report.problems.join(' ')).toMatch(/filter .* could not be read/);
  });
});

/*
 * Case c06 of docs/proposals/devexpress-parity.md: a DetailReportBand over the
 * relation Orders.OrderLines, printed through DevExpress 20.1 (`RepxProbe
 * render`, 2026-10-30). Every order printed its lines header, one Detail per
 * line and a footer whose Running="Report" total was that order's own; orders
 * 5 and 10 have no lines and printed the header, one blank Detail and a blank
 * total. Each page below is DevExpress's, control=text in print order.
 */
describe('a detail report under each master record, as DevExpress printed it (case c06)', () => {
  const REPX = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"ParityCase\" ReportUnit=\"HundredthsOfAnInch\" Margins=\"50, 50, 50, 50\" PageWidth=\"850\" PageHeight=\"1100\" Version=\"20.1\" DataMember=\"Orders\"><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"50\"></Item1><Item2 Ref=\"5\" ControlType=\"DetailBand\" Name=\"Detail\" HeightF=\"30\"><Controls><Item1 Ref=\"3\" ControlType=\"XRLabel\" Name=\"lblOrder\" Font=\"Arial, 10pt, style=Bold\" LocationFloat=\"0,0\" SizeF=\"400,25\"><ExpressionBindings><Item1 Ref=\"4\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"'Order ' + [OrderID] + ' for ' + [Customer]\" /></ExpressionBindings></Item1></Controls></Item2><Item3 Ref=\"19\" ControlType=\"DetailReportBand\" Name=\"DetailReport\" Level=\"0\" DataMember=\"Orders.OrderLines\"><Bands><Item1 Ref=\"7\" ControlType=\"GroupHeaderBand\" Name=\"LinesHeader\" HeightF=\"22\"><Controls><Item1 Ref=\"6\" ControlType=\"XRLabel\" Name=\"lblLineHead\" Text=\"ITEM / QTY / PRICE\" Font=\"Arial, 8pt, style=Bold\" LocationFloat=\"40,0\" SizeF=\"500,20\" /></Controls></Item1><Item2 Ref=\"14\" ControlType=\"DetailBand\" Name=\"LinesDetail\" HeightF=\"20\"><Controls><Item1 Ref=\"8\" ControlType=\"XRLabel\" Name=\"lblItem\" Font=\"Arial, 9pt\" LocationFloat=\"40,0\" SizeF=\"200,18\"><ExpressionBindings><Item1 Ref=\"9\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Item]\" /></ExpressionBindings></Item1><Item2 Ref=\"10\" ControlType=\"XRLabel\" Name=\"lblQty\" Font=\"Arial, 9pt\" LocationFloat=\"250,0\" SizeF=\"100,18\"><ExpressionBindings><Item1 Ref=\"11\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Qty]\" /></ExpressionBindings></Item2><Item3 Ref=\"12\" ControlType=\"XRLabel\" Name=\"lblPrice\" TextFormatString=\"{0:c2}\" Font=\"Arial, 9pt\" LocationFloat=\"360,0\" SizeF=\"100,18\"><ExpressionBindings><Item1 Ref=\"13\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Price]\" /></ExpressionBindings></Item3></Controls></Item2><Item3 Ref=\"18\" ControlType=\"ReportFooterBand\" Name=\"LinesFooter\" HeightF=\"22\"><Controls><Item1 Ref=\"15\" ControlType=\"XRLabel\" Name=\"lblOrderTotal\" TextFormatString=\"Order total {0:c2}\" Font=\"Arial, 9pt, style=Bold\" LocationFloat=\"360,0\" SizeF=\"200,20\"><Summary Ref=\"16\" Running=\"Report\" /><ExpressionBindings><Item1 Ref=\"17\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"sumSum([Price])\" /></ExpressionBindings></Item1></Controls></Item3></Bands></Item3><Item4 Ref=\"22\" ControlType=\"PageFooterBand\" Name=\"PageFooter\" HeightF=\"30\"><Controls><Item1 Ref=\"20\" ControlType=\"XRPageInfo\" Name=\"pageOfTotal\" TextFormatString=\"Page {0} of {1}\" PageInfo=\"NumberOfTotal\" LocationFloat=\"0,5\" SizeF=\"300,20\" /><Item2 Ref=\"21\" ControlType=\"XRPageInfo\" Name=\"pageRoman\" PageInfo=\"RomLowNumber\" TextAlignment=\"TopRight\" LocationFloat=\"550,5\" SizeF=\"200,20\" /></Controls></Item4><Item5 Ref=\"23\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"50\"></Item5></Bands></XtraReportsLayoutSerializer>\n";
  const ORDERS = [{"OrderID":"1","Customer":"C0001","OrderDate":"2026-03-01"},{"OrderID":"2","Customer":"C0002","OrderDate":"2026-03-02"},{"OrderID":"3","Customer":"C0003","OrderDate":"2026-03-03"},{"OrderID":"4","Customer":"C0004","OrderDate":"2026-03-04"},{"OrderID":"5","Customer":"C0005","OrderDate":"2026-03-05"},{"OrderID":"6","Customer":"C0006","OrderDate":"2026-03-06"},{"OrderID":"7","Customer":"C0007","OrderDate":"2026-03-07"},{"OrderID":"8","Customer":"C0008","OrderDate":"2026-03-08"},{"OrderID":"9","Customer":"C0009","OrderDate":"2026-03-09"},{"OrderID":"10","Customer":"C0010","OrderDate":"2026-03-10"},{"OrderID":"11","Customer":"C0011","OrderDate":"2026-03-11"},{"OrderID":"12","Customer":"C0012","OrderDate":"2026-03-12"}];
  const LINES = [{"OrderID":"1","Item":"Item 1-1","Qty":"1","Price":"11"},{"OrderID":"2","Item":"Item 2-1","Qty":"1","Price":"12"},{"OrderID":"2","Item":"Item 2-2","Qty":"2","Price":"22"},{"OrderID":"3","Item":"Item 3-1","Qty":"1","Price":"13"},{"OrderID":"3","Item":"Item 3-2","Qty":"2","Price":"23"},{"OrderID":"3","Item":"Item 3-3","Qty":"3","Price":"33"},{"OrderID":"4","Item":"Item 4-1","Qty":"1","Price":"14"},{"OrderID":"4","Item":"Item 4-2","Qty":"2","Price":"24"},{"OrderID":"4","Item":"Item 4-3","Qty":"3","Price":"34"},{"OrderID":"4","Item":"Item 4-4","Qty":"4","Price":"44"},{"OrderID":"6","Item":"Item 6-1","Qty":"1","Price":"16"},{"OrderID":"7","Item":"Item 7-1","Qty":"1","Price":"17"},{"OrderID":"7","Item":"Item 7-2","Qty":"2","Price":"27"},{"OrderID":"8","Item":"Item 8-1","Qty":"1","Price":"18"},{"OrderID":"8","Item":"Item 8-2","Qty":"2","Price":"28"},{"OrderID":"8","Item":"Item 8-3","Qty":"3","Price":"38"},{"OrderID":"9","Item":"Item 9-1","Qty":"1","Price":"19"},{"OrderID":"9","Item":"Item 9-2","Qty":"2","Price":"29"},{"OrderID":"9","Item":"Item 9-3","Qty":"3","Price":"39"},{"OrderID":"9","Item":"Item 9-4","Qty":"4","Price":"49"},{"OrderID":"11","Item":"Item 11-1","Qty":"1","Price":"21"},{"OrderID":"12","Item":"Item 12-1","Qty":"1","Price":"22"},{"OrderID":"12","Item":"Item 12-2","Qty":"2","Price":"32"}];
  const PRINTED: string[][] = [["lblOrder=Order 1 for C0001","lblLineHead=ITEM / QTY / PRICE","lblPrice=$11.00","lblQty=1","lblItem=Item 1-1","lblOrderTotal=Order total $11.00","lblOrder=Order 2 for C0002","lblLineHead=ITEM / QTY / PRICE","lblPrice=$12.00","lblQty=1","lblItem=Item 2-1","lblPrice=$22.00","lblQty=2","lblItem=Item 2-2","lblOrderTotal=Order total $34.00","lblOrder=Order 3 for C0003","lblLineHead=ITEM / QTY / PRICE","lblPrice=$13.00","lblQty=1","lblItem=Item 3-1","lblPrice=$23.00","lblQty=2","lblItem=Item 3-2","lblPrice=$33.00","lblQty=3","lblItem=Item 3-3","lblOrderTotal=Order total $69.00","lblOrder=Order 4 for C0004","lblLineHead=ITEM / QTY / PRICE","lblPrice=$14.00","lblQty=1","lblItem=Item 4-1","lblPrice=$24.00","lblQty=2","lblItem=Item 4-2","lblPrice=$34.00","lblQty=3","lblItem=Item 4-3","lblPrice=$44.00","lblQty=4","lblItem=Item 4-4","lblOrderTotal=Order total $116.00","lblOrder=Order 5 for C0005","lblLineHead=ITEM / QTY / PRICE","lblPrice=","lblQty=","lblItem=","lblOrderTotal=","lblOrder=Order 6 for C0006","lblLineHead=ITEM / QTY / PRICE","lblPrice=$16.00","lblQty=1","lblItem=Item 6-1","lblOrderTotal=Order total $16.00","lblOrder=Order 7 for C0007","lblLineHead=ITEM / QTY / PRICE","lblPrice=$17.00","lblQty=1","lblItem=Item 7-1","lblPrice=$27.00","lblQty=2","lblItem=Item 7-2","lblOrderTotal=Order total $44.00","lblOrder=Order 8 for C0008","lblLineHead=ITEM / QTY / PRICE","lblPrice=$18.00","lblQty=1","lblItem=Item 8-1","lblPrice=$28.00","lblQty=2","lblItem=Item 8-2","lblPrice=$38.00","lblQty=3","lblItem=Item 8-3","lblOrderTotal=Order total $84.00","lblOrder=Order 9 for C0009"],["lblLineHead=ITEM / QTY / PRICE","lblPrice=$19.00","lblQty=1","lblItem=Item 9-1","lblPrice=$29.00","lblQty=2","lblItem=Item 9-2","lblPrice=$39.00","lblQty=3","lblItem=Item 9-3","lblPrice=$49.00","lblQty=4","lblItem=Item 9-4","lblOrderTotal=Order total $136.00","lblOrder=Order 10 for C0010","lblLineHead=ITEM / QTY / PRICE","lblPrice=","lblQty=","lblItem=","lblOrderTotal=","lblOrder=Order 11 for C0011","lblLineHead=ITEM / QTY / PRICE","lblPrice=$21.00","lblQty=1","lblItem=Item 11-1","lblOrderTotal=Order total $21.00","lblOrder=Order 12 for C0012","lblLineHead=ITEM / QTY / PRICE","lblPrice=$22.00","lblQty=1","lblItem=Item 12-1","lblPrice=$32.00","lblQty=2","lblItem=Item 12-2","lblOrderTotal=Order total $54.00"]];
  const related = (member: string, master: Record<string, string>) =>
    member === 'Orders.OrderLines' ? LINES.filter((l) => l.OrderID === master.OrderID) : [];
  const pagesOf = (report: PaginatedReport) => report.pages.map((page) =>
    [...page.bands].sort((a, b) => a.top - b.top).flatMap((band) => band.controls
      .filter((pc) => pc.text !== null && !pc.control.pageInfo)
      .sort((a, b) => a.y - b.y || (b.control.x - a.control.x))
      .map((pc) => `${pc.control.name}=${pc.text}`)));

  it('reads a DetailReportBand as a band holding its own report, not as an unknown band', () => {
    const s = parseReportStructure(REPX);
    const dr = s.bands.find((b) => b.kind === 'DetailReport')!;
    expect(dr.controls).toEqual([]);
    expect(dr.sub!.dataMember).toBe('Orders.OrderLines');
    expect(dr.sub!.bands.map((b) => b.kind)).toEqual(['GroupHeader', 'Detail', 'ReportFooter']);
    expect(s.problems.join(' ')).not.toMatch(/Unrecognised/);
  });

  it('prints every order\'s lines and own total on the page DevExpress printed them on', () => {
    const report = paginate(parseReportStructure(REPX), ORDERS.length, { rows: ORDERS, related });
    expect(pagesOf(report)).toEqual(PRINTED);
    expect(report.records).toBe(ORDERS.length);
  });

  it('prints each master as one with no lines, and says why, when the test data has no relation', () => {
    const report = paginate(parseReportStructure(REPX), ORDERS.length, { rows: ORDERS });
    const texts = report.pages.flatMap((p) => p.bands.flatMap((b) => b.controls.map((pc) => `${pc.control.name}=${pc.text}`)));
    expect(texts.filter((t) => t.startsWith('lblLineHead='))).toHaveLength(ORDERS.length);
    expect(texts.filter((t) => t.startsWith('lblItem='))).toEqual(ORDERS.map(() => 'lblItem='));
    expect(texts.filter((t) => t.startsWith('lblOrderTotal='))).toEqual(ORDERS.map(() => 'lblOrderTotal='));
    expect(report.problems.join(' ')).toMatch(/detail report "DetailReport" reads Orders\.OrderLines/);
  });

  it('draws the detail report once per master, with its literal text, when there is no test data', () => {
    const report = paginate(parseReportStructure(REPX), 2);
    const heads = report.pages.flatMap((p) => p.bands.filter((b) => b.band.name === 'LinesHeader'));
    expect(heads).toHaveLength(2);
    expect(heads[0].controls[0].text).toBe('ITEM / QTY / PRICE');
  });
});

/*
 * Case c08 of docs/proposals/devexpress-parity.md: a label whose NavigateUrl is
 * bound to an expression and one whose NavigateUrl is written on it, printed
 * through DevExpress 20.1 (`RepxProbe render`, 2026-10-30). Both became link
 * annotations in its PDF, one pair per record; the expected list is read from
 * those annotations, top to bottom.
 */
describe('links, as DevExpress printed them (case c08)', () => {
  const REPX = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"ParityCase\" ReportUnit=\"HundredthsOfAnInch\" Margins=\"50, 50, 50, 50\" PageWidth=\"850\" PageHeight=\"1100\" Version=\"20.1\" DataMember=\"Sales\"><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"50\"></Item1><Item2 Ref=\"7\" ControlType=\"DetailBand\" Name=\"Detail\" HeightF=\"22\"><Controls><Item1 Ref=\"3\" ControlType=\"XRLabel\" Name=\"lblLink\" Font=\"Arial, 9pt, style=Underline\" ForeColor=\"Blue\" LocationFloat=\"0,0\" SizeF=\"300,20\"><ExpressionBindings><Item1 Ref=\"4\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Customer]\" /><Item2 Ref=\"5\" EventName=\"BeforePrint\" PropertyName=\"NavigateUrl\" Expression=\"'https://example.com/customers/' + [Customer]\" /></ExpressionBindings></Item1><Item2 Ref=\"6\" ControlType=\"XRLabel\" Name=\"lblStatic\" Text=\"Static link\" Font=\"Arial, 9pt\" NavigateUrl=\"https://example.com/\" LocationFloat=\"310,0\" SizeF=\"300,20\" /></Controls></Item2><Item3 Ref=\"8\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"50\"></Item3></Bands></XtraReportsLayoutSerializer>\n";
  const ROWS = ["C0001","C0002","C0003","C0004","C0005","C0006","C0007","C0008","C0009","C0010","C0011","C0012"].map((Customer) => ({ Customer }));
  const PRINTED_LINKS = ["https://example.com/customers/C0001","https://example.com/","https://example.com/customers/C0002","https://example.com/","https://example.com/customers/C0003","https://example.com/","https://example.com/customers/C0004","https://example.com/","https://example.com/customers/C0005","https://example.com/","https://example.com/customers/C0006","https://example.com/","https://example.com/customers/C0007","https://example.com/","https://example.com/customers/C0008","https://example.com/","https://example.com/customers/C0009","https://example.com/","https://example.com/customers/C0010","https://example.com/","https://example.com/customers/C0011","https://example.com/","https://example.com/customers/C0012","https://example.com/"];

  it('links each placement where DevExpress did, literal and bound alike', () => {
    const report = paginate(parseReportStructure(REPX), ROWS.length, { rows: ROWS });
    const urls = report.pages.flatMap((p) => [...p.bands].sort((a, b) => a.top - b.top)
      .flatMap((b) => [...b.controls].sort((x, y) => x.control.x - y.control.x).map((pc) => pc.url).filter(Boolean)));
    expect(urls).toEqual(PRINTED_LINKS);
  });

  it('keeps the literal link without test data, and has no address to give a bound one', () => {
    const placed = paginate(parseReportStructure(REPX), 1).pages[0].bands
      .find((b) => b.band.kind === 'Detail')!.controls;
    expect(placed.map((pc) => [pc.control.name, pc.url])).toEqual([['lblLink', null], ['lblStatic', 'https://example.com/']]);
  });

  it('never links to anything but http, https or mailto', () => {
    expect(safeLink('https://example.com/a')).toBe('https://example.com/a');
    expect(safeLink(' mailto:someone@example.com ')).toBe('mailto:someone@example.com');
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('JavaScript:alert(1)')).toBeNull();
    expect(safeLink('data:text/html,hi')).toBeNull();
    expect(safeLink('/relative')).toBeNull();
    expect(safeLink(null)).toBeNull();
    const hostile = REPX.replace('NavigateUrl="https://example.com/"', 'NavigateUrl="javascript:alert(1)"');
    const placed = paginate(parseReportStructure(hostile), 1).pages[0].bands.find((b) => b.band.kind === 'Detail')!.controls;
    expect(placed.find((pc) => pc.control.name === 'lblStatic')!.url).toBeNull();
  });

  it('reads underline and strikeout out of a resolved font', () => {
    expect(fontDecoration('Arial, 9pt, style=Underline')).toBe('underline');
    expect(fontDecoration('Arial, 9pt, style=Bold, Strikeout')).toBe('line-through');
    expect(fontDecoration('Arial, 9pt, style=Underline, Strikeout')).toBe('underline line-through');
    expect(fontDecoration('Arial, 9pt, style=Bold')).toBeUndefined();
    expect(fontDecoration(undefined)).toBeUndefined();
  });
});

/*
 * Case s22a of docs/proposals/devexpress-parity.md: five formatting rules over
 * six records, printed through DevExpress 20.1 (`RepxProbe render`,
 * 2026-10-30). Each record below is every control DevExpress printed on it, as
 * name=text|colour|fill|weight: the later of two rules wins a property they
 * share, a hiding rule removes the amount on the zero record, and the band's
 * rule fills every label on the records with more than ten.
 */
describe('conditional formatting, as DevExpress printed it (case s22a)', () => {
  const REPX = "<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"Rules\" ReportUnit=\"HundredthsOfAnInch\" Margins=\"50, 50, 50, 50\" PageWidth=\"850\" PageHeight=\"1100\" Version=\"20.1\" DataMember=\"Items\" Font=\"Arial, 9pt\"><FormattingRuleSheet><Item1 Ref=\"11\" Name=\"High\" Condition=\"[Amount] &gt; 500\"><Formatting Ref=\"111\" ForeColor=\"Red\" Font=\"Arial, 9pt, style=Bold\" /></Item1><Item2 Ref=\"12\" Name=\"Negative\" Condition=\"[Amount] &lt; 0\"><Formatting Ref=\"112\" BackColor=\"255,255,238,238\" /></Item2><Item3 Ref=\"13\" Name=\"HideZero\" Condition=\"[Amount] = 0\"><Formatting Ref=\"113\" Visible=\"False\" /></Item3><Item4 Ref=\"14\" Name=\"Shade\" Condition=\"[Qty] &gt; 10\"><Formatting Ref=\"114\" BackColor=\"255,230,240,255\" /></Item4><Item5 Ref=\"15\" Name=\"Blue\" Condition=\"[Amount] &gt; 500\"><Formatting Ref=\"115\" ForeColor=\"Blue\" /></Item5></FormattingRuleSheet><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"50\" /><Item2 Ref=\"3\" ControlType=\"DetailBand\" Name=\"Detail\" HeightF=\"25\"><FormattingRuleLinks><Item1 Ref=\"30\" Value=\"#Ref-14\" /></FormattingRuleLinks><Controls><Item1 Ref=\"4\" ControlType=\"XRLabel\" Name=\"lblCust\" LocationFloat=\"0,0\" SizeF=\"200,20\"><ExpressionBindings><Item1 Ref=\"5\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Customer]\" /></ExpressionBindings></Item1><Item2 Ref=\"6\" ControlType=\"XRLabel\" Name=\"lblAmount\" TextFormatString=\"{0:c2}\" TextAlignment=\"TopRight\" LocationFloat=\"250,0\" SizeF=\"200,20\"><FormattingRuleLinks><Item1 Ref=\"31\" Value=\"#Ref-11\" /><Item2 Ref=\"32\" Value=\"#Ref-15\" /><Item3 Ref=\"33\" Value=\"#Ref-12\" /><Item4 Ref=\"34\" Value=\"#Ref-13\" /></FormattingRuleLinks><ExpressionBindings><Item1 Ref=\"7\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Amount]\" /></ExpressionBindings></Item2><Item3 Ref=\"8\" ControlType=\"XRLabel\" Name=\"lblAfter\" Text=\"AFTER\" LocationFloat=\"500,0\" SizeF=\"100,20\" /></Controls></Item2><Item3 Ref=\"9\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"50\" /></Bands></XtraReportsLayoutSerializer>";
  const ROWS = [{"Customer":"Plain","Amount":"100","Qty":"1"},{"Customer":"High","Amount":"600","Qty":"2"},{"Customer":"Negative","Amount":"-40","Qty":"3"},{"Customer":"Zero","Amount":"0","Qty":"4"},{"Customer":"HighShaded","Amount":"700","Qty":"12"},{"Customer":"Shaded","Amount":"50","Qty":"20"}];
  const PRINTED: string[][] = [["lblAfter=AFTER|#000000|none|regular","lblAmount=$100.00|#000000|none|regular","lblCust=Plain|#000000|none|regular"],["lblAfter=AFTER|#000000|none|regular","lblAmount=$600.00|#0000FF|none|bold","lblCust=High|#000000|none|regular"],["lblAfter=AFTER|#000000|none|regular","lblAmount=($40.00)|#000000|#FFEEEE|regular","lblCust=Negative|#000000|none|regular"],["lblAfter=AFTER|#000000|none|regular","lblCust=Zero|#000000|none|regular"],["lblAfter=AFTER|#000000|#E6F0FF|regular","lblAmount=$700.00|#0000FF|#E6F0FF|bold","lblCust=HighShaded|#000000|#E6F0FF|regular"],["lblAfter=AFTER|#000000|#E6F0FF|regular","lblAmount=$50.00|#000000|#E6F0FF|regular","lblCust=Shaded|#000000|#E6F0FF|regular"]];
  const NAMED: Record<string, string> = { red: '#FF0000', blue: '#0000FF', black: '#000000' };
  const hex = (css: string | undefined, fallback: string) => {
    if (!css) return fallback;
    const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
    if (rgb) return '#' + rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
    return NAMED[css.toLowerCase()] ?? css;
  };

  it('applies every rule per record, as DevExpress did', () => {
    const report = paginate(parseReportStructure(REPX), ROWS.length, { rows: ROWS });
    const detail = report.pages[0].bands.filter((b) => b.band.kind === 'Detail');
    const drawn = detail.map((b) => b.controls.map((pc) => {
      const look = pc.control.appearance;
      return `${pc.control.name}=${pc.text}|${hex(cssColor(look.ForeColor), '#000000')}|${look.BackColor ? hex(cssColor(look.BackColor), '') : 'none'}|${pc.control.bold ? 'bold' : 'regular'}`;
    }).sort());
    expect(drawn).toEqual(PRINTED);
  });

  it('fires nothing without test data, where there is no record to test', () => {
    const report = paginate(parseReportStructure(REPX), 2);
    const amount = report.pages[0].bands.find((b) => b.band.kind === 'Detail')!.controls.find((pc) => pc.control.name === 'lblAmount')!;
    expect(amount.control.bold).toBe(false);
    expect(amount.control.appearance.ForeColor).toBeUndefined();
  });

  it('reads the rule sheet and every link, in link order', () => {
    const s = parseReportStructure(REPX);
    expect(Object.values(s.rules).map((r) => r.name)).toEqual(['High', 'Negative', 'HideZero', 'Shade', 'Blue']);
    expect(s.rules['13'].visible).toBe(false);
    expect(s.rules['11'].appearance).toEqual({ ForeColor: 'Red', Font: 'Arial, 9pt, style=Bold' });
    const detail = s.bands.find((b) => b.kind === 'Detail')!;
    expect(detail.rules).toEqual(['14']);
    expect(detail.controls.find((c) => c.name === 'lblAmount')!.rules).toEqual(['11', '15', '12', '13']);
  });
});

/*
 * Case s22b of docs/proposals/devexpress-parity.md: an embedded subreport,
 * taller than its control, in the master's Detail band over three records, and
 * another in the report footer, printed through DevExpress 20.1 (`RepxProbe
 * render`, 2026-10-30). Each text below is "top text", in report units from
 * the top of the page, as DevExpress placed it; the CSV is its own file.
 */
describe('embedded subreports, as DevExpress printed them (case s22b)', () => {
  const REPX = "<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"Sub\" ReportUnit=\"HundredthsOfAnInch\" Margins=\"50, 50, 50, 50\" PageWidth=\"850\" PageHeight=\"1100\" Version=\"20.1\" DataMember=\"Items\" Font=\"Arial, 9pt\"><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"50\" /><Item2 Ref=\"3\" ControlType=\"DetailBand\" Name=\"Detail\" HeightF=\"50\"><Controls><Item1 Ref=\"4\" ControlType=\"XRLabel\" Name=\"lblCust\" LocationFloat=\"0,0\" SizeF=\"200,20\"><ExpressionBindings><Item1 Ref=\"5\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Customer]\" /></ExpressionBindings></Item1><Item2 Ref=\"6\" ControlType=\"XRSubreport\" Name=\"subDetail\" LocationFloat=\"0,25\" SizeF=\"400,20\"><ReportSource Ref=\"100\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"InD\" PageWidth=\"850\" PageHeight=\"1100\" Margins=\"0, 0, 0, 0\" Version=\"20.1\"><Bands><Item1 Ref=\"101\" ControlType=\"TopMarginBand\" Name=\"iTop\" HeightF=\"0\" /><Item2 Ref=\"102\" ControlType=\"ReportHeaderBand\" Name=\"iHeader\" HeightF=\"20\"><Controls><Item1 Ref=\"103\" ControlType=\"XRLabel\" Name=\"InDHead\" Text=\"InD HEADER\" LocationFloat=\"0,0\" SizeF=\"300,18\" /></Controls></Item2><Item3 Ref=\"104\" ControlType=\"DetailBand\" Name=\"iDetail\" HeightF=\"40\"><Controls><Item1 Ref=\"105\" ControlType=\"XRLabel\" Name=\"InDLine\" Text=\"InD LINE\" LocationFloat=\"0,0\" SizeF=\"300,18\" /><Item2 Ref=\"106\" ControlType=\"XRLabel\" Name=\"InDSecond\" Text=\"InD SECOND\" LocationFloat=\"0,20\" SizeF=\"300,18\" /></Controls></Item3><Item4 Ref=\"107\" ControlType=\"BottomMarginBand\" Name=\"iBottom\" HeightF=\"0\" /></Bands></ReportSource></Item2><Item3 Ref=\"7\" ControlType=\"XRLabel\" Name=\"lblBelow\" Text=\"BELOW\" LocationFloat=\"450,30\" SizeF=\"100,18\" /></Controls></Item2><Item3 Ref=\"8\" ControlType=\"ReportFooterBand\" Name=\"ReportFooter\" HeightF=\"30\"><Controls><Item1 Ref=\"9\" ControlType=\"XRSubreport\" Name=\"subFooter\" LocationFloat=\"0,0\" SizeF=\"400,20\"><ReportSource Ref=\"200\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"InF\" PageWidth=\"850\" PageHeight=\"1100\" Margins=\"0, 0, 0, 0\" Version=\"20.1\"><Bands><Item1 Ref=\"201\" ControlType=\"TopMarginBand\" Name=\"iTop\" HeightF=\"0\" /><Item2 Ref=\"202\" ControlType=\"ReportHeaderBand\" Name=\"iHeader\" HeightF=\"20\"><Controls><Item1 Ref=\"203\" ControlType=\"XRLabel\" Name=\"InFHead\" Text=\"InF HEADER\" LocationFloat=\"0,0\" SizeF=\"300,18\" /></Controls></Item2><Item3 Ref=\"204\" ControlType=\"DetailBand\" Name=\"iDetail\" HeightF=\"40\"><Controls><Item1 Ref=\"205\" ControlType=\"XRLabel\" Name=\"InFLine\" Text=\"InF LINE\" LocationFloat=\"0,0\" SizeF=\"300,18\" /><Item2 Ref=\"206\" ControlType=\"XRLabel\" Name=\"InFSecond\" Text=\"InF SECOND\" LocationFloat=\"0,20\" SizeF=\"300,18\" /></Controls></Item3><Item4 Ref=\"207\" ControlType=\"BottomMarginBand\" Name=\"iBottom\" HeightF=\"0\" /></Bands></ReportSource></Item1></Controls></Item3><Item4 Ref=\"10\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"50\" /></Bands></XtraReportsLayoutSerializer>";
  const ROWS = [{ Customer: 'A' }, { Customer: 'B' }, { Customer: 'C' }];
  const PRINTED: string[] = ["50 A","75 InD HEADER","80 BELOW","95 InD LINE","115 InD SECOND","137 B","162 InD HEADER","167 BELOW","182 InD LINE","202 InD SECOND","224 C","249 InD HEADER","254 BELOW","269 InD LINE","289 InD SECOND","311 InF HEADER","331 InF LINE","351 InF SECOND"];
  const CSV = "A,\r\nInD HEADER,\r\n,BELOW\r\nInD LINE,\r\nInD SECOND,\r\nB,\r\nInD HEADER,\r\n,BELOW\r\nInD LINE,\r\nInD SECOND,\r\nC,\r\nInD HEADER,\r\n,BELOW\r\nInD LINE,\r\nInD SECOND,\r\nInF HEADER,\r\nInF LINE,\r\nInF SECOND,\r\n";

  it('prints the inner report under every record and grows the band to hold it', () => {
    const report = paginate(parseReportStructure(REPX), ROWS.length, { rows: ROWS });
    const drawn: string[] = [];
    for (const band of report.pages[0].bands) {
      for (const pc of band.controls) {
        const top = band.top + pc.y;
        for (const inner of pc.inner ?? []) for (const ipc of inner.controls) drawn.push(`${top + inner.top + ipc.y} ${ipc.text}`);
        if (!pc.inner && pc.text) drawn.push(`${top} ${pc.text}`);
      }
    }
    expect(drawn.sort((a, b) => parseFloat(a) - parseFloat(b))).toEqual(PRINTED);
  });

  it('exports the inner report\'s lines in the CSV, byte for byte as DevExpress did', () => {
    expect(reportToCsv(parseReportStructure(REPX), ROWS.length, { rows: ROWS })).toBe(CSV);
  });

  it('reads a subreport loaded from a file as a box, and says so', () => {
    const byUrl = REPX.replace(/<Item2 Ref="6" ControlType="XRSubreport" Name="subDetail"[\s\S]*?<\/ReportSource><\/Item2>/, '<Item2 Ref="6" ControlType="XRSubreport" Name="subDetail" ReportSourceUrl="Lines.repx" LocationFloat="0,25" SizeF="400,20" />');
    const s = parseReportStructure(byUrl);
    const sub = s.bands.find((b) => b.kind === 'Detail')!.controls.find((c) => c.name === 'subDetail')!;
    expect(sub.subreport).toEqual({ structure: null, url: 'Lines.repx' });
    expect(s.problems.join(' ')).toMatch(/load another file \(Lines\.repx\)/);
    const placed = paginate(s, 1, { rows: ROWS }).pages[0].bands.find((b) => b.band.kind === 'Detail')!.controls.find((pc) => pc.control.name === 'subDetail')!;
    expect(placed.height).toBe(20);
  });
});

/*
 * Parity row 31: a cross-tab over the test data, against what DevExpress 20.1
 * printed (`RepxProbe render`, 2026-10-30). s25 has values that need deciding:
 * regions differing only in case, a missing region, integer quarters, decimal
 * amounts, an empty intersection and one whose only record has no amount. Its
 * second cross-tab carries a font, colours, borders, padding and alignment of
 * its own, none of which reached a cell. The ct cases are one field of each kind
 * and each with one collection missing, beside a label the grid pushes down.
 * Each cross-tab is written as Forma repairs one.
 */
describe('cross-tabs over test data, as DevExpress printed them (cases s25 and ct)', () => {
  const S25 = "<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"s25\" ReportUnit=\"HundredthsOfAnInch\" PageWidth=\"850\" PageHeight=\"1100\" Margins=\"50, 50, 50, 50\" Version=\"20.1\" DataMember=\"Items\" Font=\"Arial, 8pt\"><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"50\" /><Item2 Ref=\"3\" ControlType=\"ReportHeaderBand\" Name=\"ReportHeader\" HeightF=\"600\"><Controls><Item1 Ref=\"4\" ControlType=\"XRCrossTab\" Name=\"plain\" LocationFloat=\"0,0\" SizeF=\"300,75\"><LayoutOptions Ref=\"140\" /><PrintOptions Ref=\"141\" /><RowFields><Item1 Ref=\"142\" FieldName=\"Region\" /></RowFields><ColumnFields><Item1 Ref=\"143\" FieldName=\"Quarter\" /></ColumnFields><DataFields><Item1 Ref=\"144\" FieldName=\"Amount\" /></DataFields><ColumnDefinitions><Item1 Ref=\"164\" /><Item2 Ref=\"165\" /><Item3 Ref=\"166\" /></ColumnDefinitions><RowDefinitions><Item1 Ref=\"167\" Height=\"25\" /><Item2 Ref=\"168\" Height=\"25\" /><Item3 Ref=\"169\" Height=\"25\" /></RowDefinitions><Cells><Item1 Ref=\"155\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"0\" Text=\"Region\" /><Item2 Ref=\"156\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"0\" /><Item3 Ref=\"157\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"0\" Text=\"Grand Total\" /><Item4 Ref=\"158\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"1\" /><Item5 Ref=\"159\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"2\" Text=\"Grand Total\" /><Item6 Ref=\"160\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"1\" /><Item7 Ref=\"161\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"1\" /><Item8 Ref=\"162\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"2\" /><Item9 Ref=\"163\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"2\" /></Cells></Item1><Item2 Ref=\"5\" ControlType=\"XRCrossTab\" Name=\"styled\" LocationFloat=\"0,320\" SizeF=\"300,75\" Font=\"Arial, 8pt, style=Bold\" ForeColor=\"Red\" BackColor=\"LightYellow\" Borders=\"All\" Padding=\"4,4,2,2,100\" TextAlignment=\"MiddleCenter\"><LayoutOptions Ref=\"150\" /><PrintOptions Ref=\"151\" /><RowFields><Item1 Ref=\"152\" FieldName=\"Region\" /></RowFields><ColumnFields><Item1 Ref=\"153\" FieldName=\"Quarter\" /></ColumnFields><DataFields><Item1 Ref=\"154\" FieldName=\"Amount\" /></DataFields><ColumnDefinitions><Item1 Ref=\"179\" /><Item2 Ref=\"180\" /><Item3 Ref=\"181\" /></ColumnDefinitions><RowDefinitions><Item1 Ref=\"182\" Height=\"25\" /><Item2 Ref=\"183\" Height=\"25\" /><Item3 Ref=\"184\" Height=\"25\" /></RowDefinitions><Cells><Item1 Ref=\"170\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"0\" Text=\"Region\" /><Item2 Ref=\"171\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"0\" /><Item3 Ref=\"172\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"0\" Text=\"Grand Total\" /><Item4 Ref=\"173\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"1\" /><Item5 Ref=\"174\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"2\" Text=\"Grand Total\" /><Item6 Ref=\"175\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"1\" /><Item7 Ref=\"176\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"1\" /><Item8 Ref=\"177\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"2\" /><Item9 Ref=\"178\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"2\" /></Cells></Item2></Controls></Item2><Item3 Ref=\"6\" ControlType=\"DetailBand\" Name=\"Detail\" HeightF=\"0\" /><Item4 Ref=\"7\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"50\" /></Bands></XtraReportsLayoutSerializer>";
  const S25_ROWS: Record<string, string>[] = [{"Region":"b","Quarter":"10","Amount":"1.5"},{"Region":"B","Quarter":"2","Amount":"0.25"},{"Region":"a","Quarter":"1","Amount":"100"},{"Region":"Z","Quarter":"2","Amount":"3"},{"Region":"apple","Quarter":"1","Amount":"2.1"},{"Region":"Apple","Quarter":"10","Amount":"4"},{"Region":"b","Quarter":"10","Amount":"0.75"},{"Region":"","Quarter":"1","Amount":"7"},{"Region":"Z","Quarter":"1","Amount":""}];
  const S25_PRINTED: string[] = ["0.25@200,150 100x25","0.25@200,620 100x25","0.25@400,150 100x25","0.25@400,620 100x25","0@100,175 100x25","0@100,645 100x25","100@100,50 100x25","100@100,520 100x25","100@400,50 100x25","100@400,520 100x25","109.1@100,200 100x25","109.1@100,670 100x25","10@300,0 100x25","10@300,470 100x25","118.60@400,200 100x25","118.60@400,670 100x25","1@100,0 100x25","1@100,470 100x25","2.1@100,545 100x25","2.1@100,75 100x25","2.1@400,545 100x25","2.1@400,75 100x25","2.25@300,125 100x25","2.25@300,595 100x25","2.25@400,125 100x25","2.25@400,595 100x25","2@200,0 100x25","2@200,470 100x25","3.25@200,200 100x25","3.25@200,670 100x25","3@200,175 100x25","3@200,645 100x25","3@400,175 100x25","3@400,645 100x25","4@300,100 100x25","4@300,570 100x25","4@400,100 100x25","4@400,570 100x25","6.25@300,200 100x25","6.25@300,670 100x25","7@100,25 100x25","7@100,495 100x25","7@400,25 100x25","7@400,495 100x25","@0,25 100x25","@0,495 100x25","@100,100 100x25","@100,125 100x25","@100,150 100x25","@100,570 100x25","@100,595 100x25","@100,620 100x25","@200,100 100x25","@200,125 100x25","@200,25 100x25","@200,495 100x25","@200,50 100x25","@200,520 100x25","@200,545 100x25","@200,570 100x25","@200,595 100x25","@200,75 100x25","@300,150 100x25","@300,175 100x25","@300,25 100x25","@300,495 100x25","@300,50 100x25","@300,520 100x25","@300,545 100x25","@300,620 100x25","@300,645 100x25","@300,75 100x25","Apple@0,100 100x25","Apple@0,570 100x25","B@0,150 100x25","B@0,620 100x25","Grand Total@0,200 100x25","Grand Total@0,670 100x25","Grand Total@400,0 100x25","Grand Total@400,470 100x25","Region@0,0 100x25","Region@0,470 100x25","Z@0,175 100x25","Z@0,645 100x25","a@0,50 100x25","a@0,520 100x25","apple@0,545 100x25","apple@0,75 100x25","b@0,125 100x25","b@0,595 100x25"];
  const S25_CSV = "Region,1,2,10,Grand Total\r\n,7,,,7\r\na,100,,,100\r\napple,2.1,,,2.1\r\nApple,,,4,4\r\nb,,,2.25,2.25\r\nB,,0.25,,0.25\r\nZ,0,3,,3\r\nGrand Total,109.1,3.25,6.25,118.60\r\nRegion,1,2,10,Grand Total\r\n,7,,,7\r\na,100,,,100\r\napple,2.1,,,2.1\r\nApple,,,4,4\r\nb,,,2.25,2.25\r\nB,,0.25,,0.25\r\nZ,0,3,,3\r\nGrand Total,109.1,3.25,6.25,118.60\r\n";
  const CT: Record<string, { repx: string; csv: string }> = {"ct-111":{"repx":"<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"ct-111\" ReportUnit=\"HundredthsOfAnInch\" PageWidth=\"850\" PageHeight=\"1100\" Margins=\"50, 50, 50, 50\" Version=\"20.1\" DataMember=\"Items\" Font=\"Arial, 8pt\"><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"50\" /><Item2 Ref=\"3\" ControlType=\"ReportHeaderBand\" Name=\"ReportHeader\" HeightF=\"240\"><Controls><Item1 Ref=\"4\" ControlType=\"XRCrossTab\" Name=\"cross\" LocationFloat=\"0,10\" SizeF=\"300,75\"><LayoutOptions Ref=\"5\" /><PrintOptions Ref=\"6\" /><RowFields><Item1 Ref=\"21\" FieldName=\"Region\" /></RowFields><ColumnFields><Item1 Ref=\"22\" FieldName=\"Quarter\" /></ColumnFields><DataFields><Item1 Ref=\"23\" FieldName=\"Amount\" /></DataFields><ColumnDefinitions><Item1 Ref=\"33\" /><Item2 Ref=\"34\" /><Item3 Ref=\"35\" /></ColumnDefinitions><RowDefinitions><Item1 Ref=\"36\" Height=\"25\" /><Item2 Ref=\"37\" Height=\"25\" /><Item3 Ref=\"38\" Height=\"25\" /></RowDefinitions><Cells><Item1 Ref=\"24\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"0\" Text=\"Region\" /><Item2 Ref=\"25\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"0\" /><Item3 Ref=\"26\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"0\" Text=\"Grand Total\" /><Item4 Ref=\"27\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"1\" /><Item5 Ref=\"28\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"2\" Text=\"Grand Total\" /><Item6 Ref=\"29\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"1\" /><Item7 Ref=\"30\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"1\" /><Item8 Ref=\"31\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"2\" /><Item9 Ref=\"32\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"2\" /></Cells></Item1><Item2 Ref=\"7\" ControlType=\"XRLabel\" Name=\"below\" Text=\"BELOW\" LocationFloat=\"0,235\" SizeF=\"100,5\" /></Controls></Item2><Item3 Ref=\"8\" ControlType=\"DetailBand\" Name=\"Detail\" HeightF=\"0\" /><Item4 Ref=\"9\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"50\" /></Bands></XtraReportsLayoutSerializer>","csv":"Region,Q1,Q2,Q3,Q4,Grand Total\r\nNorth,30,150,270,390,840\r\nSouth,80,200,320,440,1040\r\nWest,110,230,350,470,1160\r\nGrand Total,220,580,940,1300,3040\r\nBELOW,,,,,\r\n"},"ct-011":{"repx":"<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"ct-011\" ReportUnit=\"HundredthsOfAnInch\" PageWidth=\"850\" PageHeight=\"1100\" Margins=\"50, 50, 50, 50\" Version=\"20.1\" DataMember=\"Items\" Font=\"Arial, 8pt\"><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"50\" /><Item2 Ref=\"3\" ControlType=\"ReportHeaderBand\" Name=\"ReportHeader\" HeightF=\"240\"><Controls><Item1 Ref=\"4\" ControlType=\"XRCrossTab\" Name=\"cross\" LocationFloat=\"0,10\" SizeF=\"300,50\"><LayoutOptions Ref=\"5\" /><PrintOptions Ref=\"6\" /><ColumnFields><Item1 Ref=\"21\" FieldName=\"Quarter\" /></ColumnFields><DataFields><Item1 Ref=\"22\" FieldName=\"Amount\" /></DataFields><ColumnDefinitions><Item1 Ref=\"29\" /><Item2 Ref=\"30\" /><Item3 Ref=\"31\" /></ColumnDefinitions><RowDefinitions><Item1 Ref=\"32\" Height=\"25\" /><Item2 Ref=\"33\" Height=\"25\" /></RowDefinitions><Cells><Item1 Ref=\"23\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"0\" /><Item2 Ref=\"24\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"0\" /><Item3 Ref=\"25\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"0\" Text=\"Grand Total\" /><Item4 Ref=\"26\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"1\" /><Item5 Ref=\"27\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"1\" /><Item6 Ref=\"28\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"1\" /></Cells></Item1><Item2 Ref=\"7\" ControlType=\"XRLabel\" Name=\"below\" Text=\"BELOW\" LocationFloat=\"0,235\" SizeF=\"100,5\" /></Controls></Item2><Item3 Ref=\"8\" ControlType=\"DetailBand\" Name=\"Detail\" HeightF=\"0\" /><Item4 Ref=\"9\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"50\" /></Bands></XtraReportsLayoutSerializer>","csv":",Q1,Q2,Q3,Q4,Grand Total\r\n,220,580,940,1300,3040\r\nBELOW,,,,,\r\n"},"ct-101":{"repx":"<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"ct-101\" ReportUnit=\"HundredthsOfAnInch\" PageWidth=\"850\" PageHeight=\"1100\" Margins=\"50, 50, 50, 50\" Version=\"20.1\" DataMember=\"Items\" Font=\"Arial, 8pt\"><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"50\" /><Item2 Ref=\"3\" ControlType=\"ReportHeaderBand\" Name=\"ReportHeader\" HeightF=\"240\"><Controls><Item1 Ref=\"4\" ControlType=\"XRCrossTab\" Name=\"cross\" LocationFloat=\"0,10\" SizeF=\"200,75\"><LayoutOptions Ref=\"5\" /><PrintOptions Ref=\"6\" /><RowFields><Item1 Ref=\"21\" FieldName=\"Region\" /></RowFields><DataFields><Item1 Ref=\"22\" FieldName=\"Amount\" /></DataFields><ColumnDefinitions><Item1 Ref=\"29\" /><Item2 Ref=\"30\" /></ColumnDefinitions><RowDefinitions><Item1 Ref=\"31\" Height=\"25\" /><Item2 Ref=\"32\" Height=\"25\" /><Item3 Ref=\"33\" Height=\"25\" /></RowDefinitions><Cells><Item1 Ref=\"23\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"0\" Text=\"Region\" /><Item2 Ref=\"24\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"0\" /><Item3 Ref=\"25\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"1\" /><Item4 Ref=\"26\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"2\" Text=\"Grand Total\" /><Item5 Ref=\"27\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"1\" /><Item6 Ref=\"28\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"2\" /></Cells></Item1><Item2 Ref=\"7\" ControlType=\"XRLabel\" Name=\"below\" Text=\"BELOW\" LocationFloat=\"0,235\" SizeF=\"100,5\" /></Controls></Item2><Item3 Ref=\"8\" ControlType=\"DetailBand\" Name=\"Detail\" HeightF=\"0\" /><Item4 Ref=\"9\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"50\" /></Bands></XtraReportsLayoutSerializer>","csv":"Region,\r\nNorth,840\r\nSouth,1040\r\nWest,1160\r\nGrand Total,3040\r\nBELOW,\r\n"},"ct-110":{"repx":"<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"ct-110\" ReportUnit=\"HundredthsOfAnInch\" PageWidth=\"850\" PageHeight=\"1100\" Margins=\"50, 50, 50, 50\" Version=\"20.1\" DataMember=\"Items\" Font=\"Arial, 8pt\"><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"50\" /><Item2 Ref=\"3\" ControlType=\"ReportHeaderBand\" Name=\"ReportHeader\" HeightF=\"240\"><Controls><Item1 Ref=\"4\" ControlType=\"XRCrossTab\" Name=\"cross\" LocationFloat=\"0,10\" SizeF=\"300,75\"><LayoutOptions Ref=\"5\" /><PrintOptions Ref=\"6\" /><RowFields><Item1 Ref=\"21\" FieldName=\"Region\" /></RowFields><ColumnFields><Item1 Ref=\"22\" FieldName=\"Quarter\" /></ColumnFields><ColumnDefinitions><Item1 Ref=\"32\" /><Item2 Ref=\"33\" /><Item3 Ref=\"34\" /></ColumnDefinitions><RowDefinitions><Item1 Ref=\"35\" Height=\"25\" /><Item2 Ref=\"36\" Height=\"25\" /><Item3 Ref=\"37\" Height=\"25\" /></RowDefinitions><Cells><Item1 Ref=\"23\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"0\" Text=\"Region\" /><Item2 Ref=\"24\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"0\" /><Item3 Ref=\"25\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"0\" Text=\"Grand Total\" /><Item4 Ref=\"26\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"1\" /><Item5 Ref=\"27\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"2\" Text=\"Grand Total\" /><Item6 Ref=\"28\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"1\" /><Item7 Ref=\"29\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"1\" /><Item8 Ref=\"30\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"2\" /><Item9 Ref=\"31\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"2\" /></Cells></Item1><Item2 Ref=\"7\" ControlType=\"XRLabel\" Name=\"below\" Text=\"BELOW\" LocationFloat=\"0,235\" SizeF=\"100,5\" /></Controls></Item2><Item3 Ref=\"8\" ControlType=\"DetailBand\" Name=\"Detail\" HeightF=\"0\" /><Item4 Ref=\"9\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"50\" /></Bands></XtraReportsLayoutSerializer>","csv":"Region,Q1,Q2,Q3,Q4,Grand Total\r\nNorth,,,,,\r\nSouth,,,,,\r\nWest,,,,,\r\nGrand Total,,,,,\r\nBELOW,,,,,\r\n"}};
  const CT_ROWS: Record<string, string>[] = [{"Region":"North","Category":"A","Quarter":"Q1","Half":"H1","Amount":"10","Target":"299"},{"Region":"North","Category":"B","Quarter":"Q1","Half":"H1","Amount":"20","Target":"298"},{"Region":"South","Category":"A","Quarter":"Q1","Half":"H1","Amount":"35","Target":"297"},{"Region":"South","Category":"B","Quarter":"Q1","Half":"H1","Amount":"45","Target":"296"},{"Region":"West","Category":"A","Quarter":"Q1","Half":"H1","Amount":"50","Target":"295"},{"Region":"West","Category":"B","Quarter":"Q1","Half":"H1","Amount":"60","Target":"294"},{"Region":"North","Category":"A","Quarter":"Q2","Half":"H1","Amount":"70","Target":"293"},{"Region":"North","Category":"B","Quarter":"Q2","Half":"H1","Amount":"80","Target":"292"},{"Region":"South","Category":"A","Quarter":"Q2","Half":"H1","Amount":"95","Target":"291"},{"Region":"South","Category":"B","Quarter":"Q2","Half":"H1","Amount":"105","Target":"290"},{"Region":"West","Category":"A","Quarter":"Q2","Half":"H1","Amount":"110","Target":"289"},{"Region":"West","Category":"B","Quarter":"Q2","Half":"H1","Amount":"120","Target":"288"},{"Region":"North","Category":"A","Quarter":"Q3","Half":"H2","Amount":"130","Target":"287"},{"Region":"North","Category":"B","Quarter":"Q3","Half":"H2","Amount":"140","Target":"286"},{"Region":"South","Category":"A","Quarter":"Q3","Half":"H2","Amount":"155","Target":"285"},{"Region":"South","Category":"B","Quarter":"Q3","Half":"H2","Amount":"165","Target":"284"},{"Region":"West","Category":"A","Quarter":"Q3","Half":"H2","Amount":"170","Target":"283"},{"Region":"West","Category":"B","Quarter":"Q3","Half":"H2","Amount":"180","Target":"282"},{"Region":"North","Category":"A","Quarter":"Q4","Half":"H2","Amount":"190","Target":"281"},{"Region":"North","Category":"B","Quarter":"Q4","Half":"H2","Amount":"200","Target":"280"},{"Region":"South","Category":"A","Quarter":"Q4","Half":"H2","Amount":"215","Target":"279"},{"Region":"South","Category":"B","Quarter":"Q4","Half":"H2","Amount":"225","Target":"278"},{"Region":"West","Category":"A","Quarter":"Q4","Half":"H2","Amount":"230","Target":"277"},{"Region":"West","Category":"B","Quarter":"Q4","Half":"H2","Amount":"240","Target":"276"}];
  const grids = (repx: string, rows: Record<string, string>[] | null) => {
    const s = parseReportStructure(repx);
    const out: string[] = [];
    for (const band of paginate(s, rows?.length ?? 1, { rows: rows ?? undefined }).pages[0].bands) {
      for (const pc of band.controls) {
        const left = band.left + pc.control.x - s.margins.left;
        const top = band.top + pc.y - s.margins.top;
        for (const c of pc.crossTab?.cells ?? []) out.push(`${c.text}@${left + c.x},${top + c.y} ${c.width}x${c.height}`);
      }
    }
    return out.sort();
  };

  it('prints every cell of s25 where DevExpress printed it, with its text', () => {
    expect(grids(S25, S25_ROWS)).toEqual(S25_PRINTED);
  });

  it('exports s25 as CSV byte for byte as DevExpress did', () => {
    expect(reportToCsv(parseReportStructure(S25), S25_ROWS.length, { rows: S25_ROWS })).toBe(S25_CSV);
  });

  for (const [name, { repx, csv }] of Object.entries(CT)) {
    it(`exports ${name} as CSV byte for byte as DevExpress did`, () => {
      expect(reportToCsv(parseReportStructure(repx), CT_ROWS.length, { rows: CT_ROWS })).toBe(csv);
    });
  }

  it('grows by whole cells and pushes the label below it down by the same', () => {
    const band = paginate(parseReportStructure(CT['ct-111'].repx), CT_ROWS.length, { rows: CT_ROWS }).pages[0].bands.find((b) => b.band.kind === 'ReportHeader')!;
    const cross = band.controls.find((pc) => pc.control.type === 'XRCrossTab')!;
    const below = band.controls.find((pc) => pc.control.name === 'below')!;
    // Designed 300 by 75, printed 600 by 125; the label moved from 235 to 285.
    expect([cross.height, cross.crossTab?.width, below.y]).toEqual([125, 600, 285]);
  });

  it('keeps drawing the structure where DevExpress was not measured or would not print', () => {
    const plain = (xml: string, rows: Record<string, string>[] | null = S25_ROWS) => grids(xml, rows).length;
    // No test data: nothing to total.
    expect(plain(S25, null)).toBe(0);
    // Two row fields, laid out as DevExpress generates them: nested, which this row does not draw.
    expect(plain("<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"ct-211\" ReportUnit=\"HundredthsOfAnInch\" PageWidth=\"850\" PageHeight=\"1100\" Margins=\"50, 50, 50, 50\" Version=\"20.1\" DataMember=\"Items\" Font=\"Arial, 8pt\"><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"50\" /><Item2 Ref=\"3\" ControlType=\"ReportHeaderBand\" Name=\"ReportHeader\" HeightF=\"240\"><Controls><Item1 Ref=\"4\" ControlType=\"XRCrossTab\" Name=\"cross\" LocationFloat=\"0,10\" SizeF=\"400,100\"><LayoutOptions Ref=\"5\" /><PrintOptions Ref=\"6\" /><RowFields><Item1 Ref=\"21\" FieldName=\"Region\" /><Item2 Ref=\"22\" FieldName=\"Category\" /></RowFields><ColumnFields><Item1 Ref=\"23\" FieldName=\"Quarter\" /></ColumnFields><DataFields><Item1 Ref=\"24\" FieldName=\"Amount\" /></DataFields><ColumnDefinitions><Item1 Ref=\"39\" /><Item2 Ref=\"40\" /><Item3 Ref=\"41\" /><Item4 Ref=\"42\" /></ColumnDefinitions><RowDefinitions><Item1 Ref=\"43\" Height=\"25\" /><Item2 Ref=\"44\" Height=\"25\" /><Item3 Ref=\"45\" Height=\"25\" /><Item4 Ref=\"46\" Height=\"25\" /></RowDefinitions><Cells><Item1 Ref=\"25\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"0\" Text=\"Region\" /><Item2 Ref=\"26\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"0\" Text=\"Category\" /><Item3 Ref=\"27\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"0\" /><Item4 Ref=\"28\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"3\" RowIndex=\"0\" Text=\"Grand Total\" /><Item5 Ref=\"29\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"1\" /><Item6 Ref=\"30\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"1\" /><Item7 Ref=\"31\" ControlType=\"XRCrossTabCell\" TextFormatString=\"Total {0}\" ColumnIndex=\"0\" RowIndex=\"2\" ColumnSpan=\"2\" /><Item8 Ref=\"32\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"3\" ColumnSpan=\"2\" Text=\"Grand Total\" /><Item9 Ref=\"33\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"1\" /><Item10 Ref=\"34\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"3\" RowIndex=\"1\" /><Item11 Ref=\"35\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"2\" /><Item12 Ref=\"36\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"3\" RowIndex=\"2\" /><Item13 Ref=\"37\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"3\" /><Item14 Ref=\"38\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"3\" RowIndex=\"3\" /></Cells></Item1><Item2 Ref=\"7\" ControlType=\"XRLabel\" Name=\"below\" Text=\"BELOW\" LocationFloat=\"0,235\" SizeF=\"100,5\" /></Controls></Item2><Item3 Ref=\"8\" ControlType=\"DetailBand\" Name=\"Detail\" HeightF=\"0\" /><Item4 Ref=\"9\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"50\" /></Bands></XtraReportsLayoutSerializer>", CT_ROWS)).toBe(0);
    // Fields alone, which DevExpress refuses to print.
    expect(plain(S25.replace(/<ColumnDefinitions>[\s\S]*?<\/Cells>/g, ''))).toBe(0);
    // A grid that would run past the right margin, which DevExpress continues on another page.
    expect(plain(S25.replace(/LocationFloat="0,0"/, 'LocationFloat="400,0"')) > 0 && plain(S25.replace(/LocationFloat="0,0"/, 'LocationFloat="400,0"')) < S25_PRINTED.length).toBe(true);
    // Amounts that are not numbers.
    expect(plain(S25, S25_ROWS.map((r) => ({ ...r, Amount: r.Amount ? `n${r.Amount}` : '' })))).toBe(0);
    // A summary setting on the data field.
    expect(plain(S25.replace(/FieldName="Amount" \/>/g, 'FieldName="Amount" SummaryType="Average" />'))).toBe(0);
  });
});

/*
 * Parity row 35: every band and control at its own Dpi, 100 when absent,
 * whatever ReportUnit says, as DevExpress 20.1 printed it (`RepxProbe render`,
 * 2026-10-30 and 31). s24 is one label one inch down and two wide, in tenths of
 * a millimetre and in pixels, with Dpi nowhere, on the root only, or everywhere.
 * s28b mixes them: a band with Dpi holding a label without, a band without
 * holding a label with, and a panel with Dpi holding a child without. Each text
 * is where DevExpress printed it on page 1, in 1/300 inch from the content's
 * top left, and `margins` are its left and right margins in the report's unit.
 */
describe('each band and control at its own Dpi, as DevExpress printed it (cases s24 and s28)', () => {
  const CASES: Record<string, { repx: string; texts: string[]; margins: number[] }> = {"s24-mm-none":{"repx":"<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"Dpi\" ReportUnit=\"TenthsOfAMillimeter\" Margins=\"254, 254, 254, 254\" PageWidth=\"2159\" PageHeight=\"2794\" Version=\"20.1\"><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"254\" /><Item2 Ref=\"3\" ControlType=\"ReportHeaderBand\" Name=\"ReportHeader\" HeightF=\"762\"><Controls><Item1 Ref=\"4\" ControlType=\"XRLabel\" Name=\"label\" Text=\"ONE INCH DOWN\" LocationFloat=\"0,254\" SizeF=\"508,127\" /></Controls></Item2><Item3 Ref=\"5\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"254\" /></Bands></XtraReportsLayoutSerializer>","texts":["ONE INCH DOWN@0,762"],"margins":[645,645]},"s24-mm-root":{"repx":"<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"Dpi\" ReportUnit=\"TenthsOfAMillimeter\" Margins=\"254, 254, 254, 254\" PageWidth=\"2159\" PageHeight=\"2794\" Version=\"20.1\" Dpi=\"254\"><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"254\" /><Item2 Ref=\"3\" ControlType=\"ReportHeaderBand\" Name=\"ReportHeader\" HeightF=\"762\"><Controls><Item1 Ref=\"4\" ControlType=\"XRLabel\" Name=\"label\" Text=\"ONE INCH DOWN\" LocationFloat=\"0,254\" SizeF=\"508,127\" /></Controls></Item2><Item3 Ref=\"5\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"254\" /></Bands></XtraReportsLayoutSerializer>","texts":["ONE INCH DOWN@0,762"],"margins":[254,254]},"s24-mm-all":{"repx":"<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"Dpi\" ReportUnit=\"TenthsOfAMillimeter\" Margins=\"254, 254, 254, 254\" PageWidth=\"2159\" PageHeight=\"2794\" Version=\"20.1\" Dpi=\"254\"><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"254\" Dpi=\"254\" /><Item2 Ref=\"3\" ControlType=\"ReportHeaderBand\" Name=\"ReportHeader\" HeightF=\"762\" Dpi=\"254\"><Controls><Item1 Ref=\"4\" ControlType=\"XRLabel\" Name=\"label\" Text=\"ONE INCH DOWN\" LocationFloat=\"0,254\" SizeF=\"508,127\" Dpi=\"254\" /></Controls></Item2><Item3 Ref=\"5\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"254\" Dpi=\"254\" /></Bands></XtraReportsLayoutSerializer>","texts":["ONE INCH DOWN@0,300"],"margins":[254,254]},"s24-px-none":{"repx":"<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"Dpi\" ReportUnit=\"Pixels\" Margins=\"96, 96, 96, 96\" PageWidth=\"816\" PageHeight=\"1056\" Version=\"20.1\"><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"96\" /><Item2 Ref=\"3\" ControlType=\"ReportHeaderBand\" Name=\"ReportHeader\" HeightF=\"288\"><Controls><Item1 Ref=\"4\" ControlType=\"XRLabel\" Name=\"label\" Text=\"ONE INCH DOWN\" LocationFloat=\"0,96\" SizeF=\"192,48\" /></Controls></Item2><Item3 Ref=\"5\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"96\" /></Bands></XtraReportsLayoutSerializer>","texts":["ONE INCH DOWN@0,288"],"margins":[92,92]},"s24-px-root":{"repx":"<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"Dpi\" ReportUnit=\"Pixels\" Margins=\"96, 96, 96, 96\" PageWidth=\"816\" PageHeight=\"1056\" Version=\"20.1\" Dpi=\"96\"><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"96\" /><Item2 Ref=\"3\" ControlType=\"ReportHeaderBand\" Name=\"ReportHeader\" HeightF=\"288\"><Controls><Item1 Ref=\"4\" ControlType=\"XRLabel\" Name=\"label\" Text=\"ONE INCH DOWN\" LocationFloat=\"0,96\" SizeF=\"192,48\" /></Controls></Item2><Item3 Ref=\"5\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"96\" /></Bands></XtraReportsLayoutSerializer>","texts":["ONE INCH DOWN@0,288"],"margins":[96,96]},"s24-px-all":{"repx":"<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"Dpi\" ReportUnit=\"Pixels\" Margins=\"96, 96, 96, 96\" PageWidth=\"816\" PageHeight=\"1056\" Version=\"20.1\" Dpi=\"96\"><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"96\" Dpi=\"96\" /><Item2 Ref=\"3\" ControlType=\"ReportHeaderBand\" Name=\"ReportHeader\" HeightF=\"288\" Dpi=\"96\"><Controls><Item1 Ref=\"4\" ControlType=\"XRLabel\" Name=\"label\" Text=\"ONE INCH DOWN\" LocationFloat=\"0,96\" SizeF=\"192,48\" Dpi=\"96\" /></Controls></Item2><Item3 Ref=\"5\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"96\" Dpi=\"96\" /></Bands></XtraReportsLayoutSerializer>","texts":["ONE INCH DOWN@0,300"],"margins":[96,96]},"s28b-roomy":{"repx":"<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1\" Name=\"Mixed\" ReportUnit=\"TenthsOfAMillimeter\" Margins=\"254, 254, 254, 254\" PageWidth=\"2159\" PageHeight=\"2794\" Version=\"20.1\" Dpi=\"254\"><Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"254\" Dpi=\"254\" /><Item2 Ref=\"3\" ControlType=\"ReportHeaderBand\" Name=\"ReportHeader\" HeightF=\"508\" Dpi=\"254\"><Controls><Item1 Ref=\"4\" ControlType=\"XRLabel\" Name=\"noDpi\" Text=\"LABEL NO DPI\" LocationFloat=\"254,127\" SizeF=\"508,50.8\" /></Controls></Item2><Item3 Ref=\"5\" ControlType=\"PageHeaderBand\" Name=\"PageHeader\" HeightF=\"254\"><Controls><Item1 Ref=\"6\" ControlType=\"XRLabel\" Name=\"withDpi\" Text=\"LABEL WITH DPI\" LocationFloat=\"254,127\" SizeF=\"508,50.8\" Dpi=\"254\" /></Controls></Item3><Item4 Ref=\"7\" ControlType=\"DetailBand\" Name=\"Detail\" HeightF=\"762\" Dpi=\"254\"><Controls><Item1 Ref=\"8\" ControlType=\"XRPanel\" Name=\"panel\" LocationFloat=\"254,0\" SizeF=\"1016,635\" Dpi=\"254\"><Controls><Item1 Ref=\"9\" ControlType=\"XRLabel\" Name=\"child\" Text=\"CHILD NO DPI\" LocationFloat=\"127,127\" SizeF=\"508,50.8\" /></Controls></Item1></Controls></Item4><Item5 Ref=\"10\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"254\" Dpi=\"254\" /></Bands></XtraReportsLayoutSerializer>","texts":["CHILD NO DPI@681,1743","LABEL NO DPI@762,381","LABEL WITH DPI@300,750"],"margins":[254,254]}};
  const laidOut = (repx: string) => {
    const s = parseReportStructure(repx);
    const k = 300 / ({ TenthsOfAMillimeter: 254, Pixels: 96 } as Record<string, number>)[s.unit];
    const top = Math.max(s.margins.top, s.bands.find((b) => b.kind === 'TopMargin')?.height ?? 0);
    const texts: string[] = [];
    for (const band of paginate(s, 1).pages[0].bands) {
      for (const pc of band.controls) {
        if (!pc.text) continue;
        const x = Math.round((band.left + pc.control.x + pc.control.offsetX - s.margins.left) * k);
        texts.push(`${pc.text}@${x},${Math.round((band.top + pc.y - top) * k)}`);
      }
    }
    return { texts: texts.sort(), margins: [s.margins.left, s.margins.right].map(Math.round) };
  };

  it('places every text of s24 where DevExpress printed it, with Dpi nowhere, on the root, or everywhere', () => {
    const variants = ['s24-mm-none', 's24-mm-root', 's24-mm-all', 's24-px-none', 's24-px-root', 's24-px-all'];
    expect(variants.map((n) => laidOut(CASES[n].repx))).toEqual(variants.map((n) => ({ texts: CASES[n].texts, margins: CASES[n].margins })));
  });

  it('reads a band and the control in it at their own Dpi, each without the other, as s28b printed', () => {
    expect(laidOut(CASES['s28b-roomy'].repx).texts).toEqual(CASES['s28b-roomy'].texts);
  });

  it('records each scale, so an edit can write the file\'s numbers back', () => {
    const s = parseReportStructure(CASES['s28b-roomy'].repx);
    const at = (kind: string) => s.bands.find((b) => b.kind === kind)!;
    expect([at('ReportHeader').dpiScale, at('PageHeader').dpiScale]).toEqual([1, 2.54]);
    expect(at('ReportHeader').controls[0]).toMatchObject({ name: 'noDpi', dpiScale: 2.54, x: 645.16, width: 1290.32 });
    expect(at('PageHeader').controls[0]).toMatchObject({ name: 'withDpi', dpiScale: 1, x: 254, width: 508 });
    const child = at('Detail').controls.find((c) => c.name === 'child')!;
    // Its offset is the panel\'s, at the panel\'s Dpi; its own position is at its own.
    expect([child.offsetX, child.x, child.dpiScale]).toEqual([254, 322.58, 2.54]);
  });

  it('changes nothing for a report written as DevExpress writes one', () => {
    const all = parseReportStructure(CASES['s24-mm-all'].repx);
    expect(all.bands.every((b) => b.dpiScale === 1 && b.controls.every((c) => c.dpiScale === 1))).toBe(true);
    const hundredths = parseReportStructure(CASES['s24-mm-none'].repx.replace('ReportUnit="TenthsOfAMillimeter"', 'ReportUnit="HundredthsOfAnInch"'));
    expect(hundredths.bands.every((b) => b.dpiScale === 1)).toBe(true);
  });

  it('reads an embedded subreport\'s report into its host\'s unit, each element at its own Dpi', () => {
    // A report in hundredths of an inch, its label 100 wide with no Dpi, inside a millimetre host: one inch is 254 there.
    const inner = '<ReportSource Ref="40" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" PageWidth="850" PageHeight="1100" Version="20.1"><Bands><Item1 Ref="41" ControlType="DetailBand" Name="InnerDetail" HeightF="30"><Controls><Item1 Ref="42" ControlType="XRLabel" Name="innerLabel" Text="IN" SizeF="100,20" /></Controls></Item1></Bands></ReportSource>';
    const host = CASES['s24-mm-all'].repx.replace(/<Item1 Ref="4" ControlType="XRLabel"[^>]*\/>/, `<Item1 Ref="4" ControlType="XRSubreport" Name="sub" LocationFloat="0,0" SizeF="508,127" Dpi="254">${inner}</Item1>`);
    const sub = parseReportStructure(host).bands.find((b) => b.kind === 'ReportHeader')!.controls[0].subreport!.structure!;
    expect(sub.unit).toBe('TenthsOfAMillimeter');
    expect(sub.bands[0]).toMatchObject({ height: 76.2, dpiScale: 2.54 });
    expect(sub.bands[0].controls[0]).toMatchObject({ width: 254, height: 50.8 });
  });
});
