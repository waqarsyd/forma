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
import { render, screen, cleanup } from '@testing-library/react';
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
