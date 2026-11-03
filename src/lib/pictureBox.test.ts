/**
 * An XRPictureBox as DevExpress 20.1 printed it (2026-11-04): every number
 * below is a case of `RepxProbe render` over every Sizing mode, read off its
 * PNG at 96 dpi, where a hundredth of an inch is 0.96 pixel.
 */
import { describe, expect, it } from 'vitest';
import { imageHeader, naturalSize, parseImageSource, parsePicture, pictureRect } from './pictureBox';

/** A minimal PNG header: signature, IHDR with the size, and a pHYs chunk with the resolution. */
function pngBytes(width: number, height: number, dpi?: number): Uint8Array {
  const out: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (type: string, data: number[]) => out.push(...u32(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0);
  chunk('IHDR', [...u32(width), ...u32(height), 8, 2, 0, 0, 0]);
  if (dpi) {
    const ppm = Math.round(dpi / 0.0254);
    chunk('pHYs', [...u32(ppm), ...u32(ppm), 1]);
  }
  chunk('IDAT', [0]);
  return new Uint8Array(out);
}
const base64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

describe('the image a report carries', () => {
  it('reads a PNG\'s pixels and resolution from its header, 96 dpi when it does not say', () => {
    const at192 = parseImageSource(`img,${base64(pngBytes(80, 40, 192))}`)!;
    expect(at192.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(at192.pixels).toEqual({ width: 80, height: 40 });
    expect(at192.dpi).toBeCloseTo(192, 0);
    expect(parseImageSource(`img,${base64(pngBytes(80, 40))}`)!.dpi).toBe(96);
  });

  it('reads a JPEG\'s, a GIF\'s and a BMP\'s, and refuses what it cannot', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, 0, 150, 0, 150, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 30, 0, 60, 3]);
    expect(imageHeader(jpeg)).toEqual({ mime: 'image/jpeg', pixels: { width: 60, height: 30 }, dpi: 150 });
    expect(imageHeader(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 20, 0, 10, 0]))).toEqual({ mime: 'image/gif', pixels: { width: 20, height: 10 }, dpi: null });
    expect(parseImageSource('img,AAAA')).toBeNull();
    expect(parseImageSource('url,abc')).toBeNull();
    expect(parseImageSource(null)).toBeNull();
    expect(parseImageSource('svg,PHN2Zy8+')!.dataUrl).toBe('data:image/svg+xml;base64,PHN2Zy8+');
  });

  it('reads the settings, with DevExpress\'s defaults for what is not written', () => {
    const attrs: Record<string, string> = { Sizing: 'ZoomImage', ImageAlignment: 'BottomRight', UseImageResolution: 'false' };
    expect(parsePicture((n) => attrs[n] ?? null)).toMatchObject({ sizing: 'ZoomImage', alignment: 'BottomRight', useImageResolution: false, source: null, url: null });
    expect(parsePicture(() => null)).toMatchObject({ sizing: 'Normal', alignment: 'Default', useImageResolution: true });
    expect(parsePicture((n) => (n === 'Sizing' ? 'Cover' : null)).sizing).toBe('Normal');
  });

  it('sizes the image by its resolution: the same pixels at 192 dpi print half as large', () => {
    const at96 = parseImageSource(`img,${base64(pngBytes(80, 40, 96))}`)!;
    const at192 = parseImageSource(`img,${base64(pngBytes(80, 40, 192))}`)!;
    // A PNG states pixels per metre, so 96 dpi is stored as 3,780: 96.01.
    expect(naturalSize(at96, true, 'HundredthsOfAnInch')!.w).toBeCloseTo((80 * 100) / 96, 1);
    expect(naturalSize(at96, true, 'HundredthsOfAnInch')!.h).toBeCloseTo((40 * 100) / 96, 1);
    expect(naturalSize(at192, true, 'HundredthsOfAnInch')!.w).toBeCloseTo((80 * 100) / 192, 1);
    expect(naturalSize(at192, false, 'HundredthsOfAnInch')!.w).toBeCloseTo((80 * 100) / 96, 6);
  });
});

describe('where 20.1 printed it in a 180 by 100 box', () => {
  const box = { w: 180, h: 100 };
  const small = { w: 83.33, h: 41.67 }; // 80 by 40 pixels at 96 dpi
  const large = { w: 416.67, h: 312.5 }; // 400 by 300 pixels at 96 dpi

  it('Normal: its own size from the top left, clipped; CenterImage: centred', () => {
    expect(pictureRect(box, small, 'Normal', 'Default')).toEqual({ x: 0, y: 0, ...small });
    expect(pictureRect(box, large, 'Normal', 'Default')).toEqual({ x: 0, y: 0, ...large });
    expect(pictureRect(box, small, 'CenterImage', 'Default')).toEqual({ x: (180 - 83.33) / 2, y: (100 - 41.67) / 2, ...small });
  });

  it('StretchImage fills the box; AutoSize makes the box the image', () => {
    expect(pictureRect(box, small, 'StretchImage', 'Default')).toEqual({ x: 0, y: 0, w: 180, h: 100 });
    expect(pictureRect(box, large, 'AutoSize', 'Default')).toEqual({ x: 0, y: 0, ...large });
  });

  it('ZoomImage fits it with its proportions, centred, larger or smaller', () => {
    const zoomedSmall = pictureRect(box, small, 'ZoomImage', 'Default');
    expect(zoomedSmall.w).toBeCloseTo(180, 1);
    expect(zoomedSmall.h).toBeCloseTo(90, 1);
    expect(zoomedSmall.y).toBeCloseTo(5, 1);
    const zoomedLarge = pictureRect(box, large, 'ZoomImage', 'Default');
    expect(zoomedLarge.h).toBeCloseTo(100, 1);
    expect(zoomedLarge.w).toBeCloseTo(133.33, 1);
    expect(zoomedLarge.x).toBeCloseTo((180 - 133.33) / 2, 1);
  });

  it('Squeeze shrinks only what is larger than the box', () => {
    expect(pictureRect(box, small, 'Squeeze', 'Default')).toEqual({ x: (180 - 83.33) / 2, y: (100 - 41.67) / 2, ...small });
    expect(pictureRect(box, large, 'Squeeze', 'Default').h).toBeCloseTo(100, 1);
  });

  it('Tile repeats it at its own size from the top left', () => {
    expect(pictureRect(box, small, 'Tile', 'Default')).toEqual({ x: 0, y: 0, ...small, tile: true });
  });

  it('places it by ImageAlignment in every mode when one is written', () => {
    expect(pictureRect(box, small, 'Normal', 'BottomRight')).toEqual({ x: 180 - 83.33, y: 100 - 41.67, ...small });
    expect(pictureRect(box, small, 'CenterImage', 'TopLeft')).toEqual({ x: 0, y: 0, ...small });
    const zoomTopLeft = pictureRect(box, small, 'ZoomImage', 'TopLeft');
    expect(zoomTopLeft.x).toBe(0);
    expect(zoomTopLeft.y).toBe(0);
  });

  it('draws an image of unknown size as ZoomImage would, filling the box', () => {
    expect(pictureRect(box, null, 'Normal', 'Default')).toEqual({ x: 0, y: 0, w: 180, h: 100 });
  });
});
