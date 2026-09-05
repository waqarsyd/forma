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
    // This is the flat shape reportBands.ts keeps behind VITE_FORMA_FLAT: one
    // DetailBand at the full page height, which prints the entire design once
    // per record. 1100 exceeds the 1050 of usable body, so it can never fit.
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
