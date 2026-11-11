import { describe, it, expect } from 'vitest';
import { makeRightToLeft, toLogicalRtl } from './repxRtl';
import { parseReportStructure } from './reportPreview';

/*
 * A right-to-left page read as it is seen (2026-11-11, the full audit's
 * PL-04b): the AI and Forma's own readers write positions as the page shows
 * them, and DevExpress mirrors whatever is written under RightToLeft and
 * RightToLeftLayout (s63a). Turned round first, the report prints as the page
 * looked; the Preview draws what DevExpress printed in s63a to s63d, so it is
 * the judge here.
 */
const seen = (rootAttrs = ' Margins="50, 50, 50, 50"') =>
  `<?xml version="1.0" encoding="utf-8"?>\n<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="R" PageWidth="850" PageHeight="1100"${rootAttrs}>
  <Bands>
    <Item1 Ref="2" ControlType="PageHeaderBand" Name="PageHeader" HeightF="120">
      <Controls>
        <Item1 Ref="3" ControlType="XRLabel" Name="title" Text="فاتورة" TextAlignment="MiddleRight" LocationFloat="550, 0" SizeF="200, 40" />
        <Item2 Ref="4" ControlType="XRPanel" Name="box" LocationFloat="0, 50" SizeF="300, 60">
          <Controls>
            <Item1 Ref="5" ControlType="XRLabel" Name="inBox" Text="رقم" TextAlignment="TopLeft" LocationFloat="10, 5" SizeF="100, 20" />
          </Controls>
        </Item2>
      </Controls>
    </Item1>
    <Item2 Ref="6" ControlType="DetailBand" Name="Detail" HeightF="30">
      <Controls>
        <Item1 Ref="7" ControlType="XRTable" Name="row" LocationFloat="0, 0" SizeF="750, 30">
          <Rows>
            <Item1 Ref="8" ControlType="XRTableRow" Name="r1" Weight="1">
              <Cells>
                <Item1 Ref="9" ControlType="XRTableCell" Name="c1" Text="A" Weight="1" Borders="Left" TextAlignment="MiddleLeft" />
                <Item2 Ref="10" ControlType="XRTableCell" Name="c2" Text="B" Weight="2" />
                <Item3 Ref="11" ControlType="XRTableCell" Name="c3" Text="C" Weight="1" Borders="Right" />
              </Cells>
            </Item1>
          </Rows>
        </Item1>
      </Controls>
    </Item2>
  </Bands>
</XtraReportsLayoutSerializer>`;

/** Every control's printed left edge, width and alignment, and every row's cells, by name. */
function printed(xml: string) {
  const s = parseReportStructure(xml);
  const controls = s.bands.flatMap((b) => b.controls);
  return {
    // A panel's alignment prints nothing, so only text's is compared.
    at: Object.fromEntries(controls.map((c) => [c.name, { left: Math.round((c.x + (c.offsetX ?? 0)) * 100) / 100, width: c.width, ...(c.type === 'XRPanel' ? {} : { align: c.align }) }])),
    cells: controls.flatMap((c) => (c.rows ?? []).map((r) => r.cells.map((cell) => `${cell.text}:${cell.align}:${cell.borders.left ? 'L' : ''}${cell.borders.right ? 'R' : ''}`))),
  };
}

describe('toLogicalRtl', () => {
  it('prints, once made right to left, exactly as the page was seen', () => {
    const asSeen = printed(seen());
    const turned = printed(makeRightToLeft(toLogicalRtl(seen())));
    expect(turned.at).toEqual(asSeen.at);
    expect(turned.cells).toEqual(asSeen.cells);
    // And the page as seen, for the record: the title at the right, aligned right.
    expect(asSeen.at.title).toEqual({ left: 550, width: 200, align: 'right' });
  });

  it('mirrors across the band, and inside a panel across the panel', () => {
    const out = toLogicalRtl(seen());
    // A 850-wide Letter page with 50 on each side is 750 printable.
    expect(out).toMatch(/Name="title"[^>]*LocationFloat="0, 0"/);
    expect(out).toMatch(/Name="box"[^>]*LocationFloat="450, 50"/);
    expect(out).toMatch(/Name="inBox"[^>]*LocationFloat="190, 5"/);
    expect(out).toMatch(/Name="title"[^>]*TextAlignment="MiddleLeft"/);
  });

  it("reverses a row's cells, renumbered, with their left and right borders swapped", () => {
    const out = toLogicalRtl(seen());
    const cells = /<Cells>([\s\S]*?)<\/Cells>/.exec(out)![1];
    expect([...cells.matchAll(/<(Item\d+)[^>]*Name="(c\d)"/g)].map((m) => `${m[1]}=${m[2]}`)).toEqual(['Item1=c3', 'Item2=c2', 'Item3=c1']);
    expect(cells).toMatch(/Name="c3"[^>]*Borders="Left"/);
    expect(cells).toMatch(/Name="c1"[^>]*Borders="Right"/);
  });

  it('leaves a report already laid out right to left, and anything with no report root, as it was', () => {
    const once = makeRightToLeft(toLogicalRtl(seen()));
    expect(toLogicalRtl(once)).toBe(once);
    expect(toLogicalRtl('<root />')).toBe('<root />');
  });

  it("reads each control at its own Dpi and the paper as PaperKind's", () => {
    const mm = `<XtraReportsLayoutSerializer ReportUnit="TenthsOfAMillimeter" Dpi="254" PaperKind="A4" Margins="100, 100, 100, 100"><Bands><Item1 ControlType="DetailBand" Dpi="254"><Controls><Item1 ControlType="XRLabel" Name="x" Dpi="254" LocationFloat="0, 0" SizeF="500, 50" /></Controls></Item1></Bands></XtraReportsLayoutSerializer>`;
    // A4 is 2100 tenths of a millimetre wide: 2100 - 200 - 500 = 1400.
    expect(toLogicalRtl(mm)).toContain('LocationFloat="1400, 0"');
  });

  // The PIPE1 review: no Margins written is an inch each side at the report's own Dpi, not 100 of its units.
  it('takes an inch each side when no margins are written, whatever the Dpi', () => {
    const mm = `<XtraReportsLayoutSerializer ReportUnit="TenthsOfAMillimeter" Dpi="254" PaperKind="A4"><Bands><Item1 ControlType="DetailBand" Dpi="254"><Controls><Item1 ControlType="XRLabel" Name="x" Dpi="254" LocationFloat="0, 0" SizeF="500, 50" /></Controls></Item1></Bands></XtraReportsLayoutSerializer>`;
    // 2100 - 254 - 254 - 500 = 1092.
    expect(toLogicalRtl(mm)).toContain('LocationFloat="1092, 0"');
  });

  // The PIPE1 review: a label under a band that writes an alignment inherits it, already swapped; TopRight would override it.
  it('writes no alignment over one a label inherits', () => {
    const banded = `<XtraReportsLayoutSerializer PageWidth="850" PageHeight="1100" Margins="50, 50, 50, 50"><Bands><Item1 ControlType="DetailBand" Name="Detail" TextAlignment="MiddleCenter"><Controls><Item1 ControlType="XRLabel" Name="x" LocationFloat="0, 0" SizeF="100, 20" /></Controls></Item1><Item2 ControlType="PageFooterBand" Name="Foot"><Controls><Item1 ControlType="XRLabel" Name="y" LocationFloat="0, 0" SizeF="100, 20" /></Controls></Item2></Bands></XtraReportsLayoutSerializer>`;
    const out = toLogicalRtl(banded);
    expect(out).toMatch(/Name="x"(?![^>]*TextAlignment)[^>]*\/>/);
    expect(out).toMatch(/Name="y"[^>]*TextAlignment="TopRight"/);
  });
});

const report = (rootAttrs = '') =>
  `<?xml version="1.0" encoding="utf-8"?>\n<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="R" PageWidth="850" PageHeight="1100"${rootAttrs}>
  <Bands>
    <Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="40">
      <Controls>
        <Item1 Ref="3" ControlType="XRLabel" Name="caption" Text="Name" TextAlignment="TopLeft" LocationFloat="0, 0" SizeF="100, 20" />
      </Controls>
    </Item1>
  </Bands>
</XtraReportsLayoutSerializer>`;

describe('makeRightToLeft', () => {
  it('writes both attributes on the report root, and nowhere else', () => {
    const out = makeRightToLeft(report());
    const root = out.match(/<XtraReportsLayoutSerializer[^>]*>/)![0];
    expect(root).toContain('RightToLeft="Yes"');
    expect(root).toContain('RightToLeftLayout="Yes"');
    expect(out.match(/RightToLeft=/g)).toHaveLength(1);
  });

  it('overwrites a "No" rather than writing the attribute twice', () => {
    const out = makeRightToLeft(report(' RightToLeft="No"'));
    expect(out.match(/\sRightToLeft="/g)).toHaveLength(1);
    expect(out).toContain('RightToLeft="Yes"');
  });

  it('is idempotent', () => {
    const once = makeRightToLeft(report());
    expect(makeRightToLeft(once)).toBe(once);
  });

  it('leaves a document with no report root alone', () => {
    expect(makeRightToLeft('<root />')).toBe('<root />');
    expect(makeRightToLeft('')).toBe('');
  });

  it('is read by the Preview as a report that prints right to left, mirrored', () => {
    const s = parseReportStructure(makeRightToLeft(report()));
    const caption = s.bands.flatMap((b) => b.controls).find((c) => c.name === 'caption')!;
    expect(caption.rtl).toBe(true);
    expect(caption.align).toBe('right');
    // Mirrored across the printable width: what sat at the left edge now ends at the right.
    const width = s.page.width - s.margins.left - s.margins.right;
    expect(caption.x + caption.width).toBeCloseTo(width, 0);
  });
});
