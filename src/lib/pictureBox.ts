/**
 * An `XRPictureBox` as DevExpress 20.1 prints it (2026-11-04, the parity
 * programme's open item: the Preview drew a dashed "image" box for every
 * picture, so none reached the page or any export).
 *
 * Measured, not read from the documentation, with `RepxProbe render` over a
 * case holding every `Sizing` mode with a small image and a large one,
 * alignment variants, and the same pixels at 96 and 192 dpi (the case's
 * builder is forma-parity-work/picture/make_case.py, outside the repository).
 * What 20.1 printed:
 * - **Normal**: the image at its own size, from the top left, clipped.
 * - **StretchImage**: the image fills the box.
 * - **AutoSize**: the box takes the image's size.
 * - **CenterImage**: its own size, centred, clipped.
 * - **ZoomImage**: scaled to fit with its proportions, centred.
 * - **Squeeze**: as ZoomImage when larger than the box either way, else its
 *   own size, centred.
 * - **Tile**: repeated at its own size from the top left.
 * - **`ImageAlignment`**, when written, places the image in every mode.
 *   CenterImage with TopLeft printed at the top left; `Default` is each
 *   mode's own placement above.
 * - **Its own size** comes from its resolution (`UseImageResolution`, true by
 *   default): 80 by 40 pixels at 192 dpi printed half as large as at 96. A
 *   file that says nothing of its resolution is 96 dpi.
 * The Preview draws it as an SVG the size of the box (`ReportPreview`), which
 * clips as DevExpress does, and which the PDF, image, RTF, DOCX and HTML
 * exports already take from the page as a picture.
 */
import { unitsPerInch } from './reportGeometry';

export const PICTURE_SIZINGS = ['Normal', 'StretchImage', 'AutoSize', 'CenterImage', 'ZoomImage', 'Squeeze', 'Tile'] as const;
export type PictureSizing = (typeof PICTURE_SIZINGS)[number];

export const PICTURE_ALIGNMENTS = [
  'Default',
  'TopLeft',
  'TopCenter',
  'TopRight',
  'MiddleLeft',
  'MiddleCenter',
  'MiddleRight',
  'BottomLeft',
  'BottomCenter',
  'BottomRight',
] as const;
export type PictureAlignment = (typeof PICTURE_ALIGNMENTS)[number];

/** An image a report carries: a data URL the browser can draw, and its pixels and resolution when its header says. */
export interface PictureSource {
  dataUrl: string;
  pixels: { width: number; height: number } | null;
  /** Dots per inch, 96 when the file does not say. */
  dpi: number;
}

/** A picture box's settings, as the file writes them. */
export interface PreviewPicture {
  /** `ImageSource`, decoded; null when the picture comes from a URL, a binding, or nothing. */
  source: PictureSource | null;
  /** `ImageUrl`, which a browser page cannot be relied on to load. */
  url: string | null;
  sizing: PictureSizing;
  alignment: PictureAlignment;
  useImageResolution: boolean;
}

const bytesOf = (base64: string, max: number) => {
  const head = base64.replace(/\s+/g, '').slice(0, Math.ceil(max / 3) * 4);
  const text = atob(head.length % 4 ? head.slice(0, head.length - (head.length % 4)) : head);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
};

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const i32le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);

/** The pixels and resolution a raster image's header states, and its media type. */
export function imageHeader(b: Uint8Array): { mime: string; pixels: { width: number; height: number } | null; dpi: number | null } | null {
  // PNG: IHDR holds the size; a pHYs chunk before the image data, the resolution in pixels per metre.
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const pixels = b.length >= 24 ? { width: u32be(b, 16), height: u32be(b, 20) } : null;
    let dpi: number | null = null;
    for (let i = 8; i + 8 <= b.length; ) {
      const length = u32be(b, i);
      const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
      if (type === 'pHYs' && i + 17 <= b.length && b[i + 16] === 1) dpi = u32be(b, i + 8) * 0.0254;
      if (type === 'IDAT' || type === 'IEND') break;
      i += 12 + length;
    }
    return { mime: 'image/png', pixels, dpi };
  }
  // JPEG: a JFIF APP0 segment holds the density, a start-of-frame the size.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let pixels: { width: number; height: number } | null = null;
    let dpi: number | null = null;
    for (let i = 2; i + 4 <= b.length && b[i] === 0xff; ) {
      const marker = b[i + 1];
      const length = u16be(b, i + 2);
      if (marker === 0xe0 && String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]) === 'JFIF') {
        const units = b[i + 11];
        const density = u16be(b, i + 12);
        if (density && units === 1) dpi = density;
        else if (density && units === 2) dpi = density * 2.54;
      }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && i + 9 <= b.length) {
        pixels = { height: u16be(b, i + 5), width: u16be(b, i + 7) };
        break;
      }
      i += 2 + length;
    }
    return { mime: 'image/jpeg', pixels, dpi };
  }
  // GIF: the logical screen size, and no resolution at all.
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { mime: 'image/gif', pixels: b.length >= 10 ? { width: u16le(b, 6), height: u16le(b, 8) } : null, dpi: null };
  }
  // BMP: the size and the horizontal resolution, in pixels per metre.
  if (b[0] === 0x42 && b[1] === 0x4d) {
    const ppm = b.length >= 42 ? i32le(b, 38) : 0;
    return { mime: 'image/bmp', pixels: b.length >= 26 ? { width: i32le(b, 18), height: Math.abs(i32le(b, 22)) } : null, dpi: ppm > 0 ? ppm * 0.0254 : null };
  }
  return null;
}

/**
 * `ImageSource` as DevExpress writes it: `img,` and the image's base64, or
 * `svg,` and an SVG's. Null for anything else, which the Preview draws as an
 * empty picture box rather than guessing at.
 */
export function parseImageSource(value: string | null | undefined): PictureSource | null {
  if (!value) return null;
  const comma = value.indexOf(',');
  if (comma < 0) return null;
  const kind = value.slice(0, comma).trim();
  const base64 = value.slice(comma + 1).trim();
  if (!base64) return null;
  if (kind === 'svg') return { dataUrl: `data:image/svg+xml;base64,${base64}`, pixels: null, dpi: 96 };
  if (kind !== 'img') return null;
  let header: ReturnType<typeof imageHeader> = null;
  try {
    header = imageHeader(bytesOf(base64, 65536));
  } catch {
    return null;
  }
  if (!header) return null;
  return { dataUrl: `data:${header.mime};base64,${base64}`, pixels: header.pixels, dpi: header.dpi && header.dpi > 1 ? header.dpi : 96 };
}

/** The picture box's settings out of its attributes. */
export function parsePicture(attr: (name: string) => string | null): PreviewPicture {
  const sizing = attr('Sizing');
  const alignment = attr('ImageAlignment');
  return {
    source: parseImageSource(attr('ImageSource')),
    url: attr('ImageUrl') || null,
    sizing: (PICTURE_SIZINGS as readonly string[]).includes(sizing ?? '') ? (sizing as PictureSizing) : 'Normal',
    alignment: (PICTURE_ALIGNMENTS as readonly string[]).includes(alignment ?? '') ? (alignment as PictureAlignment) : 'Default',
    useImageResolution: (attr('UseImageResolution') ?? '').toLowerCase() !== 'false',
  };
}

/** The image's own size in the report's unit: its pixels at its resolution, or at 96 dpi when it is not to be used. */
export function naturalSize(source: PictureSource, useImageResolution: boolean, unit: string): { w: number; h: number } | null {
  if (!source.pixels) return null;
  const dpi = useImageResolution ? source.dpi : 96;
  const per = unitsPerInch(unit) / dpi;
  return { w: source.pixels.width * per, h: source.pixels.height * per };
}

/** Where the image prints in its box, from the box's top left, in the report's unit; `tile` when it repeats from there. */
export interface PictureRect {
  x: number;
  y: number;
  w: number;
  h: number;
  tile?: true;
}

const DEFAULT_ALIGNMENT: Record<PictureSizing, PictureAlignment> = {
  Normal: 'TopLeft',
  StretchImage: 'TopLeft',
  AutoSize: 'TopLeft',
  CenterImage: 'MiddleCenter',
  ZoomImage: 'MiddleCenter',
  Squeeze: 'MiddleCenter',
  Tile: 'TopLeft',
};

function place(box: { w: number; h: number }, size: { w: number; h: number }, alignment: PictureAlignment): PictureRect {
  const [v, h] = /^(Top|Middle|Bottom)(Left|Center|Right)$/.exec(alignment)!.slice(1);
  const x = h === 'Left' ? 0 : h === 'Center' ? (box.w - size.w) / 2 : box.w - size.w;
  const y = v === 'Top' ? 0 : v === 'Middle' ? (box.h - size.h) / 2 : box.h - size.h;
  return { x, y, w: size.w, h: size.h };
}

/**
 * Where a picture prints in a box of `box`, given its own size (`natural`,
 * null when its header did not say, which is drawn as ZoomImage would). For
 * AutoSize the box itself becomes the image's size: the caller draws the box
 * at `w` by `h`.
 */
export function pictureRect(box: { w: number; h: number }, natural: { w: number; h: number } | null, sizing: PictureSizing, alignment: PictureAlignment): PictureRect {
  const align = alignment === 'Default' ? DEFAULT_ALIGNMENT[sizing] : alignment;
  if (sizing === 'StretchImage') return { x: 0, y: 0, w: box.w, h: box.h };
  if (!natural || natural.w <= 0 || natural.h <= 0) return place(box, fit(box, natural ?? box), align);
  switch (sizing) {
    case 'AutoSize':
      return { x: 0, y: 0, w: natural.w, h: natural.h };
    case 'ZoomImage':
      return place(box, fit(box, natural), align);
    case 'Squeeze':
      return place(box, natural.w > box.w || natural.h > box.h ? fit(box, natural) : natural, align);
    case 'Tile':
      return { x: 0, y: 0, w: natural.w, h: natural.h, tile: true };
    default:
      return place(box, natural, align);
  }
}

/** `size` scaled to fit inside `box`, proportions kept. */
function fit(box: { w: number; h: number }, size: { w: number; h: number }): { w: number; h: number } {
  const scale = Math.min(box.w / size.w, box.h / size.h);
  return { w: size.w * scale, h: size.h * scale };
}
