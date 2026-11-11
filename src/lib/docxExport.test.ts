/**
 * The Word export beyond its frames, which exportItems.test.ts checks against
 * DevExpress's own: a character XML cannot hold, which made Word refuse the
 * whole document, and a picture's description (the 2026-11-11 audit, PX-12
 * and CP-14).
 */
import { describe, expect, it } from 'vitest';
import { paginate, parseReportStructure } from './reportPreview';
import { placedControls } from './csvExport';
import { reportToDocx } from './docxExport';

const report = (controls: string) =>
  parseReportStructure(
    '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer Ref="1" Name="R" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 50, 50" PageWidth="850" PageHeight="1100">' +
      `<Bands><Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="200"><Controls>${controls}</Controls></Item1></Bands></XtraReportsLayoutSerializer>`,
  );

/** A store-only zip's entry, by name. */
function unzip(bytes: Uint8Array, name: string): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 0; view.getUint32(at, true) === 0x04034b50;) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const start = at + 30 + nameLength + view.getUint16(at + 28, true);
    if (new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength)) === name) {
      return new TextDecoder().decode(bytes.subarray(start, start + size));
    }
    at = start + size;
  }
  throw new Error(`no ${name}`);
}

describe('reportToDocx', () => {
  it('writes a document XML can hold when the data carries a control character (PX-12)', () => {
    const structure = report('<Item1 Ref="3" ControlType="XRLabel" Name="l" Text="Caf&#233; A&#xB;B" LocationFloat="0,0" SizeF="300,25" />');
    const xml = unzip(reportToDocx(paginate(structure, 1), structure), 'word/document.xml');
    expect(xml).toContain('>Café AB</w:t>');
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml)).toBe(false);
  });

  it('describes a picture with its control\'s AccessibleDescription, as Word reads it out (CP-14)', () => {
    const structure = report('<Item1 Ref="3" ControlType="XRPictureBox" Name="logo" AccessibleDescription="Company logo" LocationFloat="0,0" SizeF="200,100" />');
    const laid = paginate(structure, 1);
    const at = placedControls(laid).find((p) => p.pc.control.name === 'logo')!;
    const left = at.bandLeft + at.pc.control.x;
    const top = at.bandTop + at.pc.y;
    const picture = { page: 0, left, top, right: left + 200, bottom: top + 100, png: new Uint8Array([137, 80, 78, 71]) };
    const xml = unzip(reportToDocx(laid, structure, [picture]), 'word/document.xml');
    expect(xml).toContain('<wp:docPr id="1" name="Picture 1" descr="Company logo"/>');
  });
});
