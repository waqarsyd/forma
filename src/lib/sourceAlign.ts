/**
 * Where the original goes under the Preview's page (2026-11-11, the full
 * audit's CP-03, "Compare with the original"): the picture or PDF page a
 * report was made from, drawn under the report as it prints, so a caption a
 * few millimetres off, a column too narrow or a missing line shows at a
 * glance.
 *
 * A picture with the page's own shape (a scan, a photo of a whole page, a
 * rendered PDF page) is the page, and covers it. Anything else is a cropped
 * screenshot of part of a page, whose edges are wherever the person cut: it
 * is fitted by its ink, the box round everything printed on it, to the
 * printed report's content, the box round every control on the page, by the
 * widths (a record count that differs between the two makes the heights
 * disagree, and the widths do not). A picture with no ink, or a page with no
 * control, is laid at the top left at the page's width.
 *
 * Pure: the browser reads the picture's pixels and the Preview the page's
 * controls, and this works out the rest.
 */

/** A box, from its top left corner to its bottom right. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** How dark a pixel must be to be ink: luminance below this, of 255. */
export const INK_THRESHOLD = 170;
/** How close two shapes must be to be the same page: 3% in their height to width ratio. */
const SAME_SHAPE = 0.03;

/**
 * The box round everything printed on a picture, from its RGBA pixels, or
 * null when nothing is. A row or a column counts only when at least
 * `minimum` of its pixels are ink, so a speck of noise near an edge does not
 * stretch the box; transparent pixels are paper.
 */
export function inkBounds(data: ArrayLike<number>, width: number, height: number, threshold = INK_THRESHOLD): Box | null {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return null;
  const rows = new Uint32Array(height);
  const cols = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < threshold) {
        rows[y]++;
        cols[x]++;
      }
    }
  }
  const minimum = (n: number) => Math.max(1, Math.floor(n * 0.002));
  const first = (a: Uint32Array, m: number) => a.findIndex((v) => v >= m);
  const last = (a: Uint32Array, m: number) => {
    for (let i = a.length - 1; i >= 0; i--) if (a[i] >= m) return i;
    return -1;
  };
  const y0 = first(rows, minimum(width));
  const x0 = first(cols, minimum(height));
  if (y0 < 0 || x0 < 0) return null;
  return { x0, y0, x1: last(cols, minimum(height)) + 1, y1: last(rows, minimum(width)) + 1 };
}

/** The box round a set of boxes, or null for none. */
export function unionBox(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  return boxes.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
}

/** Whether a picture has the page's shape: a whole page, not a piece of one. */
export function isWholePage(picture: { width: number; height: number }, page: { width: number; height: number }): boolean {
  if (!(picture.width > 0 && picture.height > 0 && page.width > 0 && page.height > 0)) return false;
  const a = picture.height / picture.width;
  const b = page.height / page.width;
  return Math.abs(a - b) / b <= SAME_SHAPE;
}

/**
 * Where to draw a picture under a page, in the page's own coordinates: the
 * whole page for a picture of one, else its ink fitted to the page's content
 * (see above). `ink` is in the picture's pixels; `content` in the page's
 * coordinates.
 */
export function placeSource(
  picture: { width: number; height: number; ink: Box | null },
  page: { width: number; height: number; content: Box | null },
): Box {
  if (isWholePage(picture, page)) return { x0: 0, y0: 0, x1: page.width, y1: page.height };
  const { ink, content } = picture.ink && page.content ? { ink: picture.ink, content: page.content } : { ink: null, content: null };
  const inkWide = ink ? ink.x1 - ink.x0 : 0;
  const contentWide = content ? content.x1 - content.x0 : 0;
  if (!ink || !content || inkWide <= 0 || contentWide <= 0) {
    const scale = picture.width > 0 ? page.width / picture.width : 1;
    return { x0: 0, y0: 0, x1: page.width, y1: picture.height * scale };
  }
  const scale = contentWide / inkWide;
  const x0 = content.x0 - ink.x0 * scale;
  const y0 = content.y0 - ink.y0 * scale;
  return { x0, y0, x1: x0 + picture.width * scale, y1: y0 + picture.height * scale };
}
