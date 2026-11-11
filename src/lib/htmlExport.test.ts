/**
 * The HTML export beyond its layout, which exportItems.test.ts checks against
 * DevExpress's own: what it does with a character a page cannot hold, and
 * the alternative text of a picture (the 2026-11-11 audit, PX-12 and CP-14).
 */
import { describe, expect, it } from 'vitest';
import { parseReportStructure } from './reportPreview';
import { layoutContinuous, placedControls } from './csvExport';
import { reportToHtml } from './htmlExport';

const report = (controls: string) =>
  parseReportStructure(
    '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer Ref="1" Name="R" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100">' +
      `<Bands><Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="200"><Controls>${controls}</Controls></Item1></Bands></XtraReportsLayoutSerializer>`,
  );

/** A picture placed where the named control prints, as the Preview's drawing of it would be. */
function pictureAt(laid: ReturnType<typeof layoutContinuous>, name: string) {
  const at = placedControls(laid).find((p) => p.pc.control.name === name)!;
  const left = at.bandLeft + at.pc.control.x + at.pc.control.offsetX;
  const top = at.bandTop + at.pc.y;
  return { page: at.page.number - 1, left, top, right: left + at.pc.control.width, bottom: top + at.pc.height, png: new Uint8Array([137, 80, 78, 71]) };
}

describe('reportToHtml', () => {
  it('drops a control character in the data, keeping the text around it (PX-12)', () => {
    const structure = report('<Item1 Ref="3" ControlType="XRLabel" Name="l" Text="Caf&#233; A&#xB;B&#x1;" LocationFloat="0,0" SizeF="300,25" />');
    const html = reportToHtml(layoutContinuous(structure, 1), structure, 'T\u0000itle');
    expect(html).toContain('Café&nbsp;AB');
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(html)).toBe(false);
    expect(html).toContain('<title>Title</title>');
  });

  it('gives a picture its control\'s AccessibleDescription as alt text, and none an empty one (CP-14)', () => {
    const structure = report(
      '<Item1 Ref="3" ControlType="XRPictureBox" Name="logo" AccessibleDescription="Company logo &amp; name" LocationFloat="0,0" SizeF="200,100" />' +
        '<Item2 Ref="4" ControlType="XRPictureBox" Name="rule" LocationFloat="300,0" SizeF="200,100" />',
    );
    const laid = layoutContinuous(structure, 1);
    const html = reportToHtml(laid, structure, 'R', [pictureAt(laid, 'logo'), pictureAt(laid, 'rule')]);
    expect(html).toContain('<img alt="Company logo &amp; name" ');
    expect(html).toContain('<img alt="" ');
  });
});
