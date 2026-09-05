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
  recordCountFromLayout,
  decodeXmlText,
} from './reportPreview';

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
      { text: 'Item', weight: 3, bold: true, align: 'left' },
      { text: 'Amount', weight: 1, bold: false, align: 'right' },
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
    const result = run(34);
    const footerPage = result.pages.find((p) => p.bands.some((b) => b.band.kind === 'ReportFooter'))!;
    expect(footerPage.number).toBe(2);
    expect(footerPage.bands.some((b) => b.band.kind === 'PageHeader')).toBe(true);
  });

  it('never places a margin band as content', () => {
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
    // One record per sheet rather than an infinite loop or a dropped record.
    expect(result.records).toBe(4);
    for (const page of result.pages) {
      expect(page.bands.filter((b) => b.band.kind === 'Detail').length).toBeLessThanOrEqual(1);
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

  it('stops at the page cap and says how many records it dropped', () => {
    const result = paginate(structure, 5000, { maxPages: 3 });
    expect(result.pages).toHaveLength(3);
    expect(result.records).toBeLessThan(5000);
    expect(result.problems.join(' ')).toMatch(/records are not shown/);
  });

  it('honours non-zero margins from the root element', () => {
    const margined = banded.replace('Margins="0, 0, 0, 0"', 'Margins="50, 50, 100, 100"');
    const result = paginate(parseReportStructure(margined), 1);
    const header = result.pages[0].bands.find((b) => b.band.kind === 'PageHeader')!;
    expect(header.top).toBe(100);
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

  it('keeps every band of a nested grouping, in nesting order', () => {
    const s = parseReportStructure(grouped(['Region', 'Category'], []));
    const headers = s.bands.filter((b) => b.kind === 'GroupHeader');
    expect(headers.map((b) => b.name)).toEqual(['GroupRegion', 'GroupCategory']);
  });

  it('places every group header, not just the first', () => {
    // The bug this pins: `find` returned one band and the inner group vanished
    // from the preview while the file still contained it.
    const result = paginate(parseReportStructure(grouped(['Region', 'Category'], [])), 2);
    const placed = result.pages.flatMap((p) => p.bands.filter((b) => b.band.kind === 'GroupHeader'));
    expect(placed.map((b) => b.band.name)).toEqual(['GroupRegion', 'GroupCategory']);
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
    // Innermost group closes first, which is the reverse of the file order.
    expect(footers).toEqual(['FootCategory', 'FootRegion']);
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
    expect(controlOf(chartReport(cross)).crossTab).toEqual({
      rows: ['Region'], columns: ['Quarter'], data: ['Amount'],
    });
  });

  it('reports an absent collection as empty rather than as missing', () => {
    const cross =
      '<Item1 Ref="3" ControlType="XRCrossTab" Name="x" LocationFloat="0,0" SizeF="600,200">' +
      '<RowFields><Item1 Ref="6" FieldName="Region" /></RowFields></Item1>';
    expect(controlOf(chartReport(cross)).crossTab).toEqual({ rows: ['Region'], columns: [], data: [] });
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
