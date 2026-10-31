// @vitest-environment jsdom
/**
 * The Preview's drawing, checked against what DevExpress printed.
 *
 * The other component tests here deliberately assert no styling, because a
 * class name passes whether or not the CSS behind it exists. These assert
 * inline styles, and for the opposite reason: each one is a value COMPUTED
 * from the report file -- a colour, a padding, a border, a margin offset --
 * whose whole job is to reach the page the way DevExpress prints it. The
 * fixture is the geometry case of docs/proposals/devexpress-parity.md, printed
 * through DevExpress 20.1 with `RepxProbe render` on 2026-10-30; every
 * expectation names what DevExpress drew for the same control.
 *
 * The engine underneath has its own tests in `lib/reportPreview.test.ts`.
 * This file exists because those cannot see whether a resolved value is ever
 * drawn: before parity rows 3 to 6 the engine could have been right and the
 * pane still have drawn every border 1px black.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ReportPreview from './ReportPreview';

afterEach(cleanup);

beforeAll(() => {
  // jsdom has no ResizeObserver; the pane only uses it to fit the page to the
  // viewport, which nothing here measures.
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

const geometry = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Geometry" ReportUnit="HundredthsOfAnInch" Margins="60, 40, 50, 50" PageWidth="850" PageHeight="1100" Version="20.1">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />
    <Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="400">
      <Controls>
        <Item1 Ref="10" ControlType="XRLabel" Name="lblBox" Text="PADDED BOX" LocationFloat="0,140" SizeF="300,40" Font="Arial, 10pt" Borders="All" BorderWidth="2" BorderColor="Red" ForeColor="Blue" BackColor="LightYellow" Padding="10,10,5,5,100" />
        <Item2 Ref="11" ControlType="XRLabel" Name="lblHidden" Text="HIDDEN" LocationFloat="400,140" SizeF="200,25" Visible="false" />
        <Item3 Ref="12" ControlType="XRLabel" Name="lblStyled" Text="STYLED OVERRIDE" LocationFloat="500,200" SizeF="250,30" StyleName="Heading" Font="Arial, 8pt" />
        <Item4 Ref="13" ControlType="XRTable" Name="tbl" LocationFloat="0,250" SizeF="300,50" Borders="All" Font="Arial, 9pt">
          <Rows>
            <Item1 Ref="14" ControlType="XRTableRow" Name="r1" Weight="1"><Cells>
              <Item1 Ref="15" ControlType="XRTableCell" Name="r1c1" Text="CELL-A" Weight="1" />
              <Item2 Ref="16" ControlType="XRTableCell" Name="r1c2" Text="CELL-B" Weight="1" BackColor="255,200,220,240" />
            </Cells></Item1>
            <Item2 Ref="17" ControlType="XRTableRow" Name="r2" Weight="1"><Cells>
              <Item1 Ref="18" ControlType="XRTableCell" Name="r2c1" Text="CELL-C" Weight="1" />
              <Item2 Ref="19" ControlType="XRTableCell" Name="r2c2" Text="CELL-D" Weight="1" />
            </Cells></Item2>
          </Rows>
        </Item4>
      </Controls>
    </Item2>
    <Item3 Ref="4" ControlType="PageFooterBand" Name="PageFooter" HeightF="30">
      <Controls>
        <Item1 Ref="20" ControlType="XRPageInfo" Name="pageNo" PageInfo="NumberOfTotal" TextFormatString="Page {0} of {1}" LocationFloat="0,5" SizeF="300,20" />
      </Controls>
    </Item3>
    <Item4 Ref="5" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" />
  </Bands>
  <StyleSheet>
    <Item1 Ref="30" Name="Heading" Font="Arial, 16pt, style=Bold" ForeColor="Navy" Sides="Bottom" />
  </StyleSheet>
</XtraReportsLayoutSerializer>`;

const draw = () => render(<ReportPreview repxContent={geometry} />);
const styleOf = (text: string) => (screen.getByText(text) as HTMLElement).style;

describe('ReportPreview draws what DevExpress printed', () => {
  it('draws a control in its own colour, fill, padding and border', () => {
    draw();
    const box = styleOf('PADDED BOX');
    // DevExpress drew fore #0000FF, back #FFFFE0, a 2-wide #FF0000 border all
    // round, and the text 8.7pt inside the edge: 7.2pt padding and the border.
    expect(box.color).toBe('blue');
    expect(box.background.toLowerCase()).toContain('lightyellow');
    expect(box.borderTop).toBe('2px solid red');
    expect(box.borderLeft).toBe('2px solid red');
    // jsdom shortens equal pairs, so compare the four sides.
    expect([box.paddingTop, box.paddingRight, box.paddingBottom, box.paddingLeft]).toEqual(['4.8px', '9.6px', '4.8px', '9.6px']);
  });

  it('draws a styled control in its style, over its own font', () => {
    draw();
    const styled = styleOf('STYLED OVERRIDE');
    // DevExpress drew Arial 16pt bold, navy, bottom border only.
    expect(styled.fontSize).toBe('16pt');
    expect(styled.fontWeight).toBe('700');
    expect(styled.color).toBe('navy');
    expect(styled.borderBottom).toBe('1px solid rgb(0, 0, 0)');
    expect(styled.borderTop).toBe('');
  });

  it('does not draw a hidden control at all', () => {
    draw();
    expect(screen.queryByText('HIDDEN')).toBeNull();
  });

  it('draws each shared table edge once, and a cell in its own fill', () => {
    draw();
    // DevExpress drew: All | Top, Right, Bottom / Right, Bottom, Left | Right, Bottom.
    const sides = (text: string) => {
      const s = styleOf(text);
      return [s.borderTop && 'T', s.borderRight && 'R', s.borderBottom && 'B', s.borderLeft && 'L'].filter(Boolean).join('');
    };
    expect([sides('CELL-A'), sides('CELL-B'), sides('CELL-C'), sides('CELL-D')]).toEqual(['TRBL', 'TRB', 'RBL', 'RB']);
    expect(styleOf('CELL-B').background).toBe('rgb(200, 220, 240)');
    // A table's frame draws no border of its own; its cells do.
    const frame = screen.getByText('CELL-A').closest('div[style*="flex-direction: column"]') as HTMLElement;
    expect(frame.style.borderTop).toBe('');
  });

  it('starts every band at the left margin', () => {
    const { container } = draw();
    // 60 hundredths of an inch is 57.6px at 96 per inch.
    const bands = [...container.querySelectorAll<HTMLElement>('.rp-band')];
    expect(bands.length).toBeGreaterThan(0);
    for (const band of bands) expect(Number.parseFloat(band.style.left)).toBeCloseTo(57.6, 6);
  });

  it('prints the page number in its own format', () => {
    draw();
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();
  });
});

/*
 * Over test data, a parameter takes a value above the paper and the report's
 * FilterString reads it -- c07's behaviour, where the supplied value won over
 * the default. Without test data the parameter is shown, not asked.
 */
describe('parameters over test data', () => {
  const filtered = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Filtered" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100" Version="20.1" FilterString="[Region] = ?Region">
  <Parameters><Item1 Ref="2" Description="Region" ValueInfo="North" Name="Region" /></Parameters>
  <Bands>
    <Item1 Ref="3" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />
    <Item2 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="25">
      <Controls>
        <Item1 Ref="5" ControlType="XRLabel" Name="lblCust" LocationFloat="0,0" SizeF="200,20">
          <ExpressionBindings><Item1 Ref="6" EventName="BeforePrint" PropertyName="Text" Expression="[Customer]" /></ExpressionBindings>
        </Item1>
      </Controls>
    </Item2>
    <Item3 Ref="7" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" />
  </Bands>
</XtraReportsLayoutSerializer>`;
  const rows = [
    { Region: 'North', Customer: 'NORTH-ONE' },
    { Region: 'South', Customer: 'SOUTH-ONE' },
    { Region: 'North', Customer: 'NORTH-TWO' },
  ];

  it('prints the records the filter keeps with the default, then with the value typed in', () => {
    render(<ReportPreview repxContent={filtered} layout={null} title="Filtered" records={rows} />);
    expect(screen.getByText('NORTH-ONE')).toBeTruthy();
    expect(screen.queryByText('SOUTH-ONE')).toBeNull();
    const field = screen.getByLabelText('Value for Region') as HTMLInputElement;
    expect(field.value).toBe('North');
    fireEvent.change(field, { target: { value: 'South' } });
    expect(screen.getByText('SOUTH-ONE')).toBeTruthy();
    expect(screen.queryByText('NORTH-ONE')).toBeNull();
  });

  it('shows the parameter without a field when there is no test data', () => {
    render(<ReportPreview repxContent={filtered} layout={null} title="Filtered" />);
    expect(screen.queryByLabelText('Value for Region')).toBeNull();
    expect(screen.getByText('North')).toBeTruthy();
  });
});

/*
 * A label with a NavigateUrl is drawn as an anchor, in its own colour and
 * decoration, so the browser's printed PDF keeps the link as DevExpress's did
 * (c08). A javascript: address is never made a link.
 */
describe('links in the Preview', () => {
  const linked = (url: string) => `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Links" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100" Version="20.1">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />
    <Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="40">
      <Controls>
        <Item1 Ref="4" ControlType="XRLabel" Name="lblLink" Text="LINKED" NavigateUrl="${url}" Font="Arial, 9pt, style=Underline" ForeColor="Blue" LocationFloat="0,0" SizeF="300,20" />
      </Controls>
    </Item2>
    <Item3 Ref="5" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" />
  </Bands>
</XtraReportsLayoutSerializer>`;

  it('draws the label as an anchor in its own colour and underline', () => {
    render(<ReportPreview repxContent={linked('https://example.com/')} layout={null} title="Links" />);
    const a = screen.getByText('LINKED').closest('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('https://example.com/');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.style.color).toBe('blue');
    expect(a.style.textDecoration).toBe('underline');
  });

  it('draws no anchor for a javascript: address', () => {
    render(<ReportPreview repxContent={linked('javascript:alert(1)')} layout={null} title="Links" />);
    expect(screen.getByText('LINKED').closest('a')).toBeNull();
  });
});

/*
 * Cross-band lines and boxes, drawn over the bands they cross (parity row 48):
 * a box as its frame, 2 pixels when no BorderWidth is written, as DevExpress
 * printed s34a; a line down the middle of its strip.
 */
describe('cross-band controls in the Preview', () => {
  const crossed = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Cross" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100" Version="20.1">
  <CrossBandControls>
    <Item1 Ref="10" ControlType="XRCrossBandBox" Name="frame" WidthF="750" StartBand="#Ref-3" EndBand="#Ref-5" StartPointFloat="0,0" EndPointFloat="0,30" />
    <Item2 Ref="11" ControlType="XRCrossBandLine" Name="rule" WidthF="3" StartBand="#Ref-3" EndBand="#Ref-5" StartPointFloat="5,5" EndPointFloat="5,25" />
  </CrossBandControls>
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />
    <Item2 Ref="3" ControlType="PageHeaderBand" Name="PageHeader" HeightF="30"><Controls><Item1 Ref="4" ControlType="XRLabel" Name="ph" Text="HEADER" LocationFloat="10,5" SizeF="200,20" /></Controls></Item2>
    <Item3 Ref="5" ControlType="PageFooterBand" Name="PageFooter" HeightF="30"><Controls><Item1 Ref="6" ControlType="XRLabel" Name="pf" Text="FOOTER" LocationFloat="10,5" SizeF="200,20" /></Controls></Item3>
    <Item4 Ref="7" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" />
  </Bands>
</XtraReportsLayoutSerializer>`;

  it('draws the box as a 2-pixel frame and the line down its strip', () => {
    const { container } = render(<ReportPreview repxContent={crossed} layout={null} title="Cross" />);
    const drawn = [...container.querySelectorAll<HTMLElement>('div[aria-hidden]')].filter((d) => d.style.pointerEvents === 'none' && d.style.position === 'absolute');
    const box = drawn.find((d) => d.style.border);
    const line = drawn.find((d) => d.style.background && !d.style.border);
    expect(box?.style.border).toBe('2px solid rgb(0, 0, 0)');
    expect(line?.style.width).toBe('1px');
  });
});

/*
 * Export CSV hands the browser a file named after the report, holding what the
 * pane shows laid out as DevExpress exports CSV (parity row 20).
 */
describe('Export CSV', () => {
  it('downloads the report as CSV, named after its title', async () => {
    let blob: Blob | null = null;
    const create = vi.fn((b: Blob) => { blob = b; return 'blob:csv'; });
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: create, revokeObjectURL: vi.fn() }));
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    render(<ReportPreview repxContent={geometry} layout={null} title="Geometry Case" />);
    fireEvent.click(screen.getByText('Export CSV'));
    expect(clicked).toEqual(['Geometry_Case.csv']);
    const text = await (blob as unknown as Blob).text();
    expect(text.split('\r\n')[0]).toContain('PADDED BOX');
    expect(text.endsWith('\r\n')).toBe(true);
    click.mockRestore();
    vi.unstubAllGlobals();
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });
});