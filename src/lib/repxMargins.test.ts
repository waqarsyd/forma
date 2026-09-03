/**
 * The invariant these tests exist for is not "the attributes changed" — it is
 * that the ink does not move. A lift is a translation: whatever the paper
 * coordinate of a control was before, it must be the same after, with the
 * difference now carried by the margin instead of by the control. Every
 * positive case below checks that round-trip, because an edit that writes
 * plausible margins and shifts the design by half an inch would look correct in
 * a diff and be wrong on paper.
 */
import { describe, it, expect } from 'vitest';
import { liftReportMargins } from './repxMargins';

/** Build a flat single-Detail report of the shape the mega-prompt asks for. */
function flat(
  controls: string,
  opts: { margins?: string; detail?: number; width?: number; height?: number; unit?: string } = {}
): string {
  const {
    margins = '0, 0, 0, 0',
    detail = 600,
    width = 850,
    height = 1100,
    unit = 'HundredthsOfAnInch',
  } = opts;
  return `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="23.2.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" ReportUnit="${unit}" Margins="${margins}" PageWidth="${width}" PageHeight="${height}" Version="23.2">
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="0" />
    <Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="${detail}">
      <Controls>
${controls}
      </Controls>
    </Item2>
    <Item3 Ref="9" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="0" />
  </Bands>
</XtraReportsLayoutSerializer>`;
}

const label = (name: string, x: number, y: number, w = 100, h = 20) =>
  `        <Item Ref="${name}" ControlType="XRLabel" Name="${name}" Text="x" LocationFloat="${x},${y}" SizeF="${w},${h}" />`;

/** Every top-level LocationFloat in document order. */
function locations(xml: string): [number, number][] {
  return [...xml.matchAll(/LocationFloat="([\d.-]+),([\d.-]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

const attr = (xml: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(xml)?.[1];

const bandHeight = (xml: string, band: string) =>
  Number(new RegExp(`ControlType="${band}"[^>]*HeightF="([\\d.]+)"`).exec(xml)?.[1]);

describe('liftReportMargins', () => {
  it('lifts a symmetric drawn margin into the report structure', () => {
    const result = liftReportMargins(flat([label('a', 48, 48), label('b', 48, 300)].join('\n')));

    expect(result.applied).toBe(true);
    expect(result.margins).toEqual({ left: 48, right: 48, top: 48, bottom: 48 });
    expect(attr(result.xml, 'Margins')).toBe('48, 48, 48, 48');
    expect(bandHeight(result.xml, 'TopMarginBand')).toBe(48);
    expect(bandHeight(result.xml, 'BottomMarginBand')).toBe(48);
  });

  it('leaves every control at the same place on the paper', () => {
    const before = flat([label('a', 48, 48), label('b', 120, 300), label('c', 700, 570, 102, 20)].join('\n'));
    const after = liftReportMargins(before);
    const { left, top } = after.margins!;

    const originals = locations(before);
    locations(after.xml).forEach(([x, y], i) => {
      // Margins were zero before, so the original coordinate IS the paper
      // coordinate; afterwards the band starts at the margin.
      expect([left + x, top + y]).toEqual(originals[i]);
    });
  });

  it('shrinks the first body band by exactly the top lift, preserving its slack', () => {
    const result = liftReportMargins(flat(label('a', 48, 48), { detail: 600 }));
    expect(bandHeight(result.xml, 'DetailBand')).toBe(552);
  });

  it('keeps the bands inside the printable area', () => {
    const result = liftReportMargins(flat(label('a', 48, 48), { detail: 600 }));
    const { top, bottom } = result.margins!;
    expect(top + bandHeight(result.xml, 'DetailBand') + bottom).toBeLessThanOrEqual(1100);
  });

  it('gives back bottom margin rather than overflowing a tall band', () => {
    // Detail nearly fills the page, so a symmetric bottom margin cannot fit.
    const result = liftReportMargins(flat(label('a', 48, 48), { detail: 1080 }));
    expect(result.applied).toBe(true);
    expect(result.margins!.top).toBe(48);
    expect(result.margins!.bottom).toBe(20);
    expect(48 + bandHeight(result.xml, 'DetailBand') + 20).toBe(1100);
  });

  it('does not move nested table cells, which are relative to their own row', () => {
    const table = `        <Item Ref="t" ControlType="XRTable" Name="t" LocationFloat="48,300" SizeF="754,40">
          <Rows>
            <Item Ref="r" ControlType="XRTableRow" Name="r" Weight="1">
              <Cells>
                <Item Ref="c" ControlType="XRTableCell" Name="c" Text="d" Weight="1" LocationFloat="0,0" SizeF="100,20" />
              </Cells>
            </Item>
          </Rows>
        </Item>`;
    const result = liftReportMargins(flat([label('a', 48, 48), table].join('\n')));

    expect(result.applied).toBe(true);
    // The table moves; the cell inside it does not.
    expect(result.xml).toContain('Name="t" LocationFloat="0,252"');
    expect(result.xml).toContain('Name="c" Text="d" Weight="1" LocationFloat="0,0"');
  });

  it('handles a banded report, shifting y only in the first band', () => {
    const banded = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" ReportUnit="HundredthsOfAnInch" Margins="0, 0, 0, 0" PageWidth="850" PageHeight="1100" Version="23.2">
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="0" />
    <Item2 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="240">
      <Controls>
${label('h', 50, 50)}
      </Controls>
    </Item2>
    <Item3 Ref="5" ControlType="DetailBand" Name="Detail" HeightF="120">
      <Controls>
${label('d', 50, 10)}
      </Controls>
    </Item3>
    <Item4 Ref="8" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="0" />
  </Bands>
</XtraReportsLayoutSerializer>`;
    const result = liftReportMargins(banded);

    expect(result.applied).toBe(true);
    expect(bandHeight(result.xml, 'ReportHeaderBand')).toBe(190);
    // Detail keeps its height and its control keeps its y: the taller top
    // margin and the shorter header cancel out.
    expect(bandHeight(result.xml, 'DetailBand')).toBe(120);
    expect(locations(result.xml)).toEqual([
      [0, 0],
      [0, 10],
    ]);
  });

  it('mirrors left onto right rather than declaring the empty space a margin', () => {
    // Nothing comes near the right edge: 850 - 148 = 702 units are free, which
    // is whitespace, not a 7in margin.
    const result = liftReportMargins(flat(label('a', 48, 48, 100, 20)));
    expect(result.margins).toMatchObject({ left: 48, right: 48 });
  });

  it('caps the mirrored right margin at the space actually free', () => {
    // A wide left border with content running close to the right edge: the
    // mirror would clip, so the measurement wins.
    const result = liftReportMargins(flat(label('a', 120, 48, 700, 20)));
    expect(result.margins).toMatchObject({ left: 120, right: 30 });
    expect(120 + 700 + 30).toBe(850);
  });

  it('clamps an unusually wide border instead of declining', () => {
    const result = liftReportMargins(flat(label('a', 300, 300), { detail: 700 }));
    expect(result.applied).toBe(true);
    // 1.5in at 100 units/in, not the measured 300.
    expect(result.margins!.left).toBe(150);
    expect(locations(result.xml)[0]).toEqual([150, 150]);
  });

  it('scales the clamp with the report unit', () => {
    // TenthsOfAMillimeter: 254 units per inch, so the 1.5in cap is 381.
    const result = liftReportMargins(
      flat(label('a', 500, 500), { unit: 'TenthsOfAMillimeter', width: 2159, height: 2794, detail: 1200 })
    );
    expect(result.applied).toBe(true);
    expect(result.margins!.left).toBe(381);
  });

  describe('declines rather than guessing when', () => {
    it('the report already declares margins', () => {
      const before = flat(label('a', 48, 48), { margins: '50, 50, 50, 50' });
      const result = liftReportMargins(before);
      expect(result.applied).toBe(false);
      expect(result.reason).toContain('already declares margins');
      expect(result.xml).toBe(before);
    });

    it('a control reaches the left paper edge, as a full-bleed design does', () => {
      const result = liftReportMargins(flat([label('bleed', 0, 0, 850, 60), label('a', 48, 100)].join('\n')));
      expect(result.applied).toBe(false);
      expect(result.reason).toContain('paper edge');
    });

    it('a control reaches the right paper edge', () => {
      const result = liftReportMargins(flat([label('a', 48, 48), label('wide', 48, 100, 802, 20)].join('\n')));
      expect(result.applied).toBe(false);
      expect(result.reason).toContain('paper edge');
    });

    it('the whitespace is too thin to be a margin', () => {
      const result = liftReportMargins(flat(label('a', 5, 5)));
      expect(result.applied).toBe(false);
      expect(result.reason).toContain('paper edge');
    });

    it('the margin bands are missing', () => {
      const noBands = flat(label('a', 48, 48)).replace(/<Item1[^>]*TopMarginBand[^>]*\/>/, '');
      const result = liftReportMargins(noBands);
      expect(result.applied).toBe(false);
      expect(result.reason).toContain('margin bands are missing');
    });

    it('there is nothing positioned to measure', () => {
      const result = liftReportMargins(flat(''));
      expect(result.applied).toBe(false);
      expect(result.reason).toContain('no positioned controls');
    });

    it('the input is not a report at all', () => {
      for (const input of ['', '   ', '<html></html>', undefined, null]) {
        const result = liftReportMargins(input);
        expect(result.applied).toBe(false);
        expect(result.xml).toBe(input ?? '');
      }
    });
  });

  it('produces valid XML that still parses as one report', () => {
    const result = liftReportMargins(flat([label('a', 48, 48), label('b', 48, 300)].join('\n')));
    // Idempotent: a second pass finds declared margins and leaves it alone.
    const second = liftReportMargins(result.xml);
    expect(second.applied).toBe(false);
    expect(second.xml).toBe(result.xml);
  });
});
