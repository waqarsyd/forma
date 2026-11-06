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
import { useState } from 'react';
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

/* The field a group breaks on, chosen above the paper (2026-11-04). */
describe('choosing the grouping field', () => {
  const grouped = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Grouped" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100" Version="20.1">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />
    <Item2 Ref="3" ControlType="GroupHeaderBand" Name="GroupHeader1" HeightF="25">
      <GroupFields><Item1 Ref="4" FieldName="Region" /></GroupFields>
      <Controls>
        <Item1 Ref="5" ControlType="XRLabel" Name="lblGroup" LocationFloat="0,0" SizeF="200,20">
          <ExpressionBindings><Item1 Ref="6" EventName="BeforePrint" PropertyName="Text" Expression="[Region]" /></ExpressionBindings>
        </Item1>
      </Controls>
    </Item2>
    <Item3 Ref="7" ControlType="DetailBand" Name="Detail" HeightF="25">
      <Controls>
        <Item1 Ref="8" ControlType="XRLabel" Name="lblCust" LocationFloat="0,0" SizeF="200,20">
          <ExpressionBindings><Item1 Ref="9" EventName="BeforePrint" PropertyName="Text" Expression="[Customer]" /></ExpressionBindings>
        </Item1>
      </Controls>
    </Item3>
    <Item4 Ref="10" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" />
  </Bands>
</XtraReportsLayoutSerializer>`;
  const rows = [
    { Region: 'North', Country: 'Oman', Customer: 'C1' },
    { Region: 'North', Country: 'Qatar', Customer: 'C2' },
  ];

  it('offers the fields the report binds and the test rows hold, and edits through the undo path', () => {
    const onEdit = vi.fn();
    render(<ReportPreview repxContent={grouped} layout={null} title="Grouped" records={rows} onEdit={onEdit} />);
    const choice = screen.getByLabelText('Field GroupHeader1 groups by') as HTMLSelectElement;
    expect(choice.value).toBe('Region');
    expect([...choice.options].map((o) => o.value)).toEqual(['Country', 'Customer', 'Region']);
    fireEvent.change(choice, { target: { value: 'Country' } });
    expect(onEdit).toHaveBeenCalledTimes(1);
    const [xml, reason] = onEdit.mock.calls[0];
    expect(xml).toContain('FieldName="Country"');
    expect(xml).toContain('Expression="[Country]"');
    expect(reason).toBe('grouped GroupHeader1 by Country instead of Region');
    expect((screen.getByText('Undo') as HTMLButtonElement).disabled).toBe(false);
  });

  it('is not offered where the report cannot be edited', () => {
    render(<ReportPreview repxContent={grouped} layout={null} title="Grouped" records={rows} />);
    expect(screen.queryByLabelText('Field GroupHeader1 groups by')).toBeNull();
  });
});

/* A chart's title, axis titles and legend, drawn over test data (2026-11-04). */
describe('what a chart shows besides its data', () => {
  const report = (legend: string) => `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Chart" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100" Version="20.1">
  <Bands>
    <Item1 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="320">
      <Controls>
        <Item1 Ref="3" ControlType="XRChart" Name="chartSales" SizeF="600,300" LocationFloat="0,0"><Chart Ref="4">
          <DataContainer Ref="5" ValidateDataMembers="true"><SeriesSerializable><Item1 Ref="6" Name="Sales" ArgumentDataMember="Region" ValueDataMembersSerializable="Amount" /></SeriesSerializable></DataContainer>
          ${legend}
          <Titles><Item1 Ref="8" Text="Sales by Region" /></Titles>
          <Diagram Ref="10" TypeNameSerializable="XYDiagram"><AxisX Ref="11" VisibleInPanesSerializable="-1"><Title Ref="12" Visibility="True" Text="Region" /></AxisX><AxisY Ref="13" VisibleInPanesSerializable="-1"><Title Ref="14" Visibility="True" Text="Amount (USD)" /></AxisY></Diagram>
        </Chart></Item1>
      </Controls>
    </Item1>
  </Bands>
</XtraReportsLayoutSerializer>`;
  const rows = [{ Region: 'North', Amount: '120' }, { Region: 'South', Amount: '80' }];
  const svgTexts = () => [...document.querySelectorAll('svg text')].map((t) => t.textContent);

  it('draws the title and both axis titles, and names the chart by its title', () => {
    render(<ReportPreview repxContent={report('<Legend Ref="7" Visibility="True" Name="Default Legend" />')} layout={null} title="Chart" records={rows} />);
    expect(svgTexts()).toEqual(expect.arrayContaining(['Sales by Region', 'Region', 'Amount (USD)', 'Sales']));
    expect(screen.getByRole('img', { name: 'Sales by Region' })).toBeTruthy();
  });

  it('draws no legend where the file hides it', () => {
    render(<ReportPreview repxContent={report('<Legend Ref="7" Visibility="False" Name="Default Legend" />')} layout={null} title="Chart" records={rows} />);
    expect(svgTexts()).not.toContain('Sales');
    expect(svgTexts()).toContain('Sales by Region');
  });
});

/* Deleting and adding a control, a table cell retyped, and multi-select (2026-11-04). */
describe('editing in the pane', () => {
  const editable = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Edit" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100" Version="20.1">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />
    <Item2 Ref="3" ControlType="DetailBand" Name="Detail" HeightF="120">
      <Controls>
        <Item1 Ref="4" ControlType="XRLabel" Name="a" Text="ALPHA" LocationFloat="0,0" SizeF="100,20" />
        <Item2 Ref="5" ControlType="XRLabel" Name="b" Text="BETA" LocationFloat="200,0" SizeF="100,20" />
        <Item3 Ref="6" ControlType="XRTable" Name="t" LocationFloat="0,40" SizeF="300,25">
          <Rows><Item1 Ref="7" ControlType="XRTableRow" Name="r" Weight="1"><Cells>
            <Item1 Ref="8" ControlType="XRTableCell" Name="c1" Text="ONE" Weight="1" />
            <Item2 Ref="9" ControlType="XRTableCell" Name="c2" Text="TWO" Weight="1" />
          </Cells></Item1></Rows>
        </Item3>
      </Controls>
    </Item2>
    <Item3 Ref="10" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" />
  </Bands>
</XtraReportsLayoutSerializer>`;

  /** The pane as App holds it: each edit becomes its content. */
  function Holder({ onEdit }: { onEdit: (xml: string, reason: string) => void }) {
    const [xml, setXml] = useState(editable);
    return <ReportPreview repxContent={xml} layout={null} title="Edit" onEdit={(next, reason) => { setXml(next); onEdit(next, reason); }} />;
  }
  const hits = () => [...document.querySelectorAll('.rp-hit')] as HTMLElement[];

  // A request picked in the log outlines what it changed (2026-11-05).
  it('outlines the controls named in highlight, and only those', () => {
    render(<ReportPreview repxContent={editable} layout={null} title="Edit" onEdit={() => {}} highlight={['b', 't']} />);
    // The Detail band prints once per record: a, b and t in every placement.
    const flags = hits().map((h) => h.classList.contains('is-changed'));
    expect(flags.length % 3).toBe(0);
    for (let i = 0; i < flags.length; i += 3) expect(flags.slice(i, i + 3)).toEqual([false, true, true]);
  });

  // The workspace keeps one history at the bench's corner (2026-11-05), and
  // reads Ctrl+Z itself on every pane (2026-11-06).
  it('keeps no history of its own when the workspace keeps it: no Undo, and Ctrl+Z is left alone', () => {
    const onEdit = vi.fn();
    render(<ReportPreview repxContent={editable} layout={null} title="Edit" onEdit={onEdit} historyElsewhere />);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    fireEvent.pointerDown(hits()[0]);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onEdit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  // Keys meant for a menu or a dialog are not edits (2026-11-06, the workspace audit).
  it('leaves the arrows and Delete alone while a menu or dialog is open, or when they went to one', async () => {
    const { addLayer } = await import('../lib/layers');
    const onEdit = vi.fn();
    render(<Holder onEdit={onEdit} />);
    fireEvent.pointerDown(hits()[0]);
    const release = addLayer({ id: 'share', close: () => undefined });
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    release();
    expect(onEdit).not.toHaveBeenCalled();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    menu.appendChild(item);
    document.body.appendChild(menu);
    fireEvent.keyDown(item, { key: 'ArrowDown' });
    menu.remove();
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('selects more with Shift+click, and deletes them all as one step', () => {
    const onEdit = vi.fn();
    render(<Holder onEdit={onEdit} />);
    fireEvent.pointerDown(hits()[0]);
    fireEvent.pointerDown(hits()[1], { shiftKey: true });
    expect(screen.getByText('2 selected')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onEdit).toHaveBeenCalledTimes(1);
    const [xml, reason] = onEdit.mock.calls[0];
    expect(reason).toBe('deleted 2 controls');
    expect(xml).not.toContain('Name="a"');
    expect(xml).not.toContain('Name="b"');
    expect(xml).toContain('<Item1 Ref="6" ControlType="XRTable" Name="t"');
  });

  it('nudges every selected control by the same step', () => {
    const onEdit = vi.fn();
    render(<Holder onEdit={onEdit} />);
    fireEvent.pointerDown(hits()[0]);
    fireEvent.pointerDown(hits()[1], { shiftKey: true });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const [xml, reason] = onEdit.mock.calls[0];
    expect(reason).toBe('moved 2 controls');
    expect(xml).toContain('Name="a" Text="ALPHA" LocationFloat="1,0"');
    expect(xml).toContain('Name="b" Text="BETA" LocationFloat="201,0"');
  });

  it('adds a label under the selected control', () => {
    const onEdit = vi.fn();
    render(<Holder onEdit={onEdit} />);
    fireEvent.pointerDown(hits()[0]);
    fireEvent.click(screen.getByText('Add label'));
    const [xml, reason] = onEdit.mock.calls[0];
    expect(reason).toBe('added XRLabel "label1"');
    expect(xml).toContain('Name="label1" Text="New label" TextAlignment="TopLeft" LocationFloat="0, 24"');
  });

  it('retypes the table cell double-clicked', () => {
    const onEdit = vi.fn();
    render(<Holder onEdit={onEdit} />);
    // The Detail band prints three placeholder records: the table of the first.
    fireEvent.doubleClick(hits()[2]);
    const field = screen.getByLabelText("Edit the cell's text") as HTMLInputElement;
    expect(field.value).toBe('ONE');
    fireEvent.change(field, { target: { value: 'FIRST' } });
    fireEvent.blur(field);
    const [xml, reason] = onEdit.mock.calls[0];
    expect(reason).toBe('retyped XRTableCell "c1"');
    expect(xml).toContain('Name="c1" Text="FIRST"');
  });

  it('retypes a label in a Detail band printed once per record, in the one placement clicked', () => {
    const onEdit = vi.fn();
    render(<Holder onEdit={onEdit} />);
    fireEvent.doubleClick(hits()[0]);
    // One editor, not one per record, each taking the focus from the last.
    expect(screen.getAllByLabelText("Edit the control's text")).toHaveLength(1);
    const field = screen.getByLabelText("Edit the control's text") as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'FIRST' } });
    fireEvent.blur(field);
    expect(onEdit.mock.calls[0][1]).toBe('retyped XRLabel "a"');
  });

  it('says why when an edit is declined', () => {
    const named = editable.replace('Name="Detail" HeightF="120"', 'Name="Detail" HeightF="120" DrillDownControl="#Ref-4"');
    const onEdit = vi.fn();
    render(<ReportPreview repxContent={named} layout={null} title="Edit" onEdit={onEdit} />);
    fireEvent.pointerDown(hits()[0]);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onEdit).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('is named elsewhere in the report (#Ref-4)');
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
 * A picture box draws its image (2026-11-04), as DevExpress 20.1 printed every
 * Sizing mode (lib/pictureBox.ts): until then the Preview drew a dashed box
 * saying "image", so no picture reached the page or any export.
 */
describe('a picture box in the Preview', () => {
  // A 2-by-1-pixel PNG at 96 dpi: IHDR only, enough for its header to be read.
  const png = (() => {
    const b = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0, 0, 0, 0];
    return btoa(String.fromCharCode(...b));
  })();
  const pictured = (attrs: string) => `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Pictured" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100" Version="20.1">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />
    <Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="120"><Controls><Item1 Ref="4" ControlType="XRPictureBox" Name="logo" LocationFloat="0,0" SizeF="200,100" ${attrs} /></Controls></Item2>
    <Item3 Ref="5" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" />
  </Bands>
</XtraReportsLayoutSerializer>`;

  it('draws a zoomed image fitted in its box, centred, as a picture the exports take', () => {
    const { container } = render(<ReportPreview repxContent={pictured(`Sizing="ZoomImage" ImageSource="img,${png}"`)} layout={null} title="Pictured" />);
    const svg = container.querySelector('svg[role="img"][aria-label="logo"]')!;
    const image = svg.querySelector('image')!;
    expect(image.getAttribute('href')).toBe(`data:image/png;base64,${png}`);
    // 2:1 in a 200 by 100 box: the full box, no room either way.
    expect(Number(image.getAttribute('width'))).toBeCloseTo(Number(svg.getAttribute('width')), 3);
    expect(Number(image.getAttribute('y'))).toBeCloseTo(0, 3);
  });

  it('keeps a dashed box naming what it would show when it has no image of its own', () => {
    render(<ReportPreview repxContent={pictured('ImageUrl="https://example.com/logo.png"')} layout={null} title="Pictured" />);
    expect(screen.getByText('image from a URL')).toBeTruthy();
  });
});

/*
 * A label's Angle turns its text (parity row 49). DevExpress aligned the turned
 * text's bounding box in the label's box by TextAlignment (s35): at 90 degrees
 * a line reads upwards, so its box is a line tall across and its length down.
 */
describe('turned text in the Preview', () => {
  const turned = (attrs: string) => `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Turned" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100" Version="20.1">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />
    <Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="200">
      <Controls>
        <Item1 Ref="4" ControlType="XRLabel" Name="lbl" Text="TURNED" ${attrs} LocationFloat="0,0" SizeF="100,150" />
      </Controls>
    </Item2>
    <Item3 Ref="5" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" />
  </Bands>
</XtraReportsLayoutSerializer>`;
  const box = (attrs: string) => {
    render(<ReportPreview repxContent={turned(attrs)} layout={null} title="Turned" />);
    const text = screen.getByText('TURNED');
    return { text, box: text.parentElement as HTMLElement, frame: text.parentElement!.parentElement as HTMLElement };
  };

  it('turns the text a quarter turn and sets its box upright at the top left', () => {
    const { text, box: b, frame } = box('Angle="90"');
    expect(text.style.transform).toBe('translate(-50%, -50%) rotate(-90deg)');
    expect(parseFloat(b.style.height)).toBeGreaterThan(parseFloat(b.style.width));
    expect([frame.style.justifyContent, frame.style.alignItems]).toEqual(['flex-start', 'flex-start']);
  });

  it('centres the turned box when the label is centred', () => {
    const { frame } = box('Angle="90" TextAlignment="MiddleCenter"');
    expect([frame.style.justifyContent, frame.style.alignItems]).toEqual(['center', 'center']);
  });

  it('draws a level label as it was', () => {
    const { text } = box('');
    expect(text.style.transform).toBe('');
  });
});

/*
 * DevExpress draws text unkerned, in every font measured (parity row 53, s39):
 * its widths were Edge's with kerning off, up to 24 units longer than kerned.
 * The page turns kerning off for everything drawn on it, the print host too.
 */
describe('kerning in the Preview', () => {
  it('draws the page unkerned', () => {
    const { container } = render(<ReportPreview repxContent={geometry} layout={null} title="Kerning" />);
    const css = [...container.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
    const page = css.slice(css.indexOf('.rp-page {'), css.indexOf('}', css.indexOf('.rp-page {')));
    expect(page).toContain('font-kerning: none');
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

  // The chat's export tool (2026-11-05): made once per request, then reported done.
  it('makes an export the chat asked for, once per request', () => {
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: vi.fn(() => 'blob:csv'), revokeObjectURL: vi.fn() }));
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    const done = vi.fn();
    const request = { format: 'csv' as const, nonce: 7 };
    const { rerender } = render(<ReportPreview repxContent={geometry} layout={null} title="Geometry Case" exportRequest={request} onExportRequestDone={done} />);
    expect(clicked).toEqual(['Geometry_Case.csv']);
    expect(done).toHaveBeenCalledTimes(1);
    rerender(<ReportPreview repxContent={geometry} layout={null} title="Geometry Case" exportRequest={request} onExportRequestDone={done} />);
    expect(clicked).toHaveLength(1);
    click.mockRestore();
    vi.unstubAllGlobals();
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });

  // The workspace's Export panel has every format (2026-11-06): no second row of them on the pane.
  it('draws no export buttons when told not to, and still makes an export asked for', () => {
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: vi.fn(() => 'blob:csv'), revokeObjectURL: vi.fn() }));
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    render(<ReportPreview repxContent={geometry} layout={null} title="Geometry Case" exportButtons={false} exportRequest={{ format: 'csv', nonce: 8 }} />);
    expect(screen.queryByText('Export CSV')).toBeNull();
    expect(screen.queryByText('Export PDF')).toBeNull();
    expect(screen.queryByLabelText('Export in another format')).toBeNull();
    expect(clicked).toEqual(['Geometry_Case.csv']);
    click.mockRestore();
    vi.unstubAllGlobals();
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });
});

/*
 * Drill-down (2026-11-01, s56): a toggle beside each group's label, as
 * DevExpress's viewer has, opening or closing that group's records. s56a as
 * the serializer wrote it: collapsed, so DevExpress printed no customer.
 */
describe('a drill-down group in the pane', () => {
  const S56A = "<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"0\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a\" Name=\"s56a-drill-collapsed\" Margins=\"50, 50, 50, 50\" PageWidth=\"850\" PageHeight=\"1100\" Version=\"20.1\" DataMember=\"Items\"><Bands><Item1 Ref=\"1\" ControlType=\"TopMarginBand\" HeightF=\"50\" /><Item2 Ref=\"2\" ControlType=\"ReportHeaderBand\" HeightF=\"40\"><Controls><Item1 Ref=\"3\" ControlType=\"XRLabel\" Name=\"title\" Text=\"Sales report\" SizeF=\"400,30\" LocationFloat=\"0,0\" /></Controls></Item2><Item3 Ref=\"4\" ControlType=\"GroupHeaderBand\" HeightF=\"30\"><GroupFields><Item1 Ref=\"5\" FieldName=\"Region\" /></GroupFields><Controls><Item1 Ref=\"6\" ControlType=\"XRLabel\" Name=\"region\" SizeF=\"300,25\" LocationFloat=\"0,0\"><ExpressionBindings><Item1 Ref=\"7\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Region]\" /></ExpressionBindings></Item1></Controls></Item3><Item4 Ref=\"8\" ControlType=\"DetailBand\" DrillDownExpanded=\"false\" DrillDownControl=\"#Ref-6\" HeightF=\"25\"><Controls><Item1 Ref=\"9\" ControlType=\"XRLabel\" Name=\"customer\" SizeF=\"300,25\" LocationFloat=\"20,0\"><ExpressionBindings><Item1 Ref=\"10\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Customer]\" /></ExpressionBindings></Item1></Controls></Item4><Item5 Ref=\"11\" ControlType=\"ReportFooterBand\" HeightF=\"30\"><Controls><Item1 Ref=\"12\" ControlType=\"XRLabel\" Name=\"totals\" Text=\"Totals\" SizeF=\"300,25\" LocationFloat=\"0,0\" /></Controls></Item5><Item6 Ref=\"13\" ControlType=\"BottomMarginBand\" HeightF=\"50\" /></Bands></XtraReportsLayoutSerializer>";
  const ROWS = Array.from({ length: 45 }, (_, k) => ({
    Region: ['North', 'South', 'West'][k % 3],
    Customer: `Customer ${String(k + 1).padStart(2, '0')}`,
    Amount: String((k + 1) * 10),
  }));

  it('starts as the file says, and opens and closes one group at a time', () => {
    render(<ReportPreview repxContent={S56A} records={ROWS} />);
    const customers = () => screen.queryAllByText(/^Customer \d+$/).length;
    expect(customers()).toBe(0);
    const south = screen.getByRole('button', { name: 'Expand South' });
    expect(south.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('button', { name: /^Expand (North|South|West)$/ })).toHaveLength(3);
    fireEvent.click(south);
    expect(customers()).toBe(15);
    expect(screen.getByRole('button', { name: 'Collapse South' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse South' }));
    expect(customers()).toBe(0);
  });
});