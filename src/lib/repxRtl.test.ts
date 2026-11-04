import { describe, it, expect } from 'vitest';
import { makeRightToLeft } from './repxRtl';
import { parseReportStructure } from './reportPreview';

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
