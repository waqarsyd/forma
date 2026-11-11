/**
 * Embedded data kept aside while a report goes to the AI (2026-11-11, the
 * full audit, PL-03): out as `forma-blob:N`, back exactly as it was.
 */
import { describe, expect, it } from 'vitest';
import { isRepxText, restoreBlobs, stashBlobs } from './repxBlobs';

/** A deterministic base64-looking string of `length` characters. */
const base64 = (length: number, seed = 0) => {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < length; i++) out += abc[(i * 7 + seed * 13 + (i >> 5)) % 64];
  return `${out}==`;
};

const LOGO = `img,${base64(300_000)}`;
const RTF = base64(4_000, 1);
const report = `<XtraReportsLayoutSerializer Ref="0" ControlType="XtraReport" Name="Report1">
  <Bands><Item1 Ref="1" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="100"><Controls>
    <Item1 Ref="2" ControlType="XRPictureBox" Name="logo" ImageSource="${LOGO}" LocationFloat="0,0" SizeF="100,50" />
    <Item2 Ref="3" ControlType="XRRichText" Name="terms" SerializableRtfString="${RTF}" LocationFloat="0,50" SizeF="300,50" />
    <Item3 Ref="4" ControlType="XRLabel" Name="title" Text="Invoice" LocationFloat="100,0" SizeF="200,30" />
  </Controls></Item1></Bands>
</XtraReportsLayoutSerializer>`;

describe('stashing embedded data', () => {
  it('sends a 300 KB picture as a placeholder and restores it byte for byte', () => {
    const { xml, blobs } = stashBlobs(report);
    expect(xml.length).toBeLessThan(10_000);
    expect(xml).toContain('ImageSource="forma-blob:1"');
    expect(xml).toContain('SerializableRtfString="forma-blob:2"');
    expect(xml).toContain('Text="Invoice"');
    expect(restoreBlobs(xml, blobs)).toBe(report);
  });

  it('gives a value sent twice one placeholder, across reports', () => {
    const first = stashBlobs(report);
    const second = stashBlobs(`<Item1 Ref="9" ImageSource="${LOGO}" />`, first.blobs);
    expect(second.xml).toBe('<Item1 Ref="9" ImageSource="forma-blob:1" />');
    expect(first.blobs.size).toBe(2);
  });

  it('leaves ordinary values and short base64 alone', () => {
    const plain = `<Item1 Ref="1" Text="${'Lorem ipsum '.repeat(30)}" Name="${base64(50)}" />`;
    expect(stashBlobs(plain).xml).toBe(plain);
  });

  it('removes a placeholder it does not hold, attribute and all', () => {
    const { blobs } = stashBlobs(report);
    expect(restoreBlobs('<Item1 Ref="2" ImageSource="forma-blob:7" Name="logo" />', blobs)).toBe('<Item1 Ref="2" Name="logo" />');
    expect(restoreBlobs('<Item1 Ref="2" ImageSource="forma-blob:1" />', blobs)).toBe(`<Item1 Ref="2" ImageSource="${LOGO}" />`);
  });

  it('knows a report from other text', () => {
    expect(isRepxText(report)).toBe(true);
    expect(isRepxText('Name,Amount\nAcme,12')).toBe(false);
  });
});
