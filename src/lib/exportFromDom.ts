/**
 * What the RTF, DOCX, HTML and image exports need from the pages the Preview
 * draws (parity row 21). Browser only, loaded only when one of those exports
 * is asked for.
 *
 * - `picturesOf`: every chart the pages drew, as a PNG with its box in report
 *   units, for the exports that place a drawing as a picture, as DevExpress
 *   places its chart.
 * - `pageToPictures`: a page drawn to an image, cropped to what it prints.
 *   Given the continuous layout, that is DevExpress's default image export,
 *   one picture of the whole report: s54a's came out 384 pixels wide, its
 *   title's width, and as tall as its content; a report taller than a canvas
 *   can be comes out as several, in a .zip.
 */
import { pageOps } from './pdfFromDom';
import type { ExportPicture } from './exportItems';
import type { PdfImage, PdfOp } from './pdfWriter';
import { buildZip } from './zip';

const PX_PER_PT = 4 / 3;

// `<ArrayBuffer>` (2026-11-12, TypeScript 7): the PNG goes into a Blob, which takes a view of an ArrayBuffer only.
async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array<ArrayBuffer>> {
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
  if (!blob) throw new Error('The browser could not encode the picture.');
  return new Uint8Array(await blob.arrayBuffer());
}

/** An SVG element drawn to a PNG at twice its size. */
async function svgPng(svg: SVGSVGElement, width: number, height: number): Promise<Uint8Array | null> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(width));
  copy.setAttribute('height', String(height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * 2));
    canvas.height = Math.max(1, Math.round(height * 2));
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await canvasPng(canvas);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Every chart the pages drew, with its box in report units: `unitsPerPx` is
 * the report's units to one CSS pixel at true size.
 */
export async function picturesOf(pages: readonly HTMLElement[], unitsPerPx: number): Promise<ExportPicture[]> {
  const out: ExportPicture[] = [];
  for (let p = 0; p < pages.length; p++) {
    const origin = pages[p].getBoundingClientRect();
    for (const svg of pages[p].querySelectorAll<SVGSVGElement>('svg[role="img"]')) {
      const r = svg.getBoundingClientRect();
      const png = await svgPng(svg, r.width, r.height);
      if (!png) continue;
      out.push({
        page: p,
        left: (r.left - origin.left) * unitsPerPx,
        top: (r.top - origin.top) * unitsPerPx,
        right: (r.right - origin.left) * unitsPerPx,
        bottom: (r.bottom - origin.top) * unitsPerPx,
        png,
      });
    }
  }
  return out;
}

/** Where an operation draws, in points, for cropping to the content. */
function extent(op: PdfOp, measure: CanvasRenderingContext2D): [number, number, number, number] | null {
  switch (op.kind) {
    case 'fill':
    case 'image':
      return [op.x, op.y, op.x + op.w, op.y + op.h];
    case 'line':
      return [Math.min(op.x1, op.x2), Math.min(op.y1, op.y2), Math.max(op.x1, op.x2), Math.max(op.y1, op.y2)];
    case 'text': {
      measure.font = op.css ?? `${op.size * PX_PER_PT}px sans-serif`;
      const m = measure.measureText(op.text);
      const width = (m.width / PX_PER_PT);
      return [op.x, op.y - m.fontBoundingBoxAscent / PX_PER_PT, op.x + width, op.y + m.fontBoundingBoxDescent / PX_PER_PT];
    }
    default:
      return null;
  }
}

/**
 * The tallest canvas a browser draws: past 32,767 pixels Chrome encodes
 * nothing, and the export said only that the browser could not encode the
 * picture (the 2026-11-11 audit, PX-24: about 31 pages of content).
 */
export const MAX_CANVAS_PX = 32_767;

/**
 * Where a picture from `top` to `bottom` (points) is cut so that no part is
 * taller than `maxPt`: one part when it fits. Each cut falls in a gap between
 * the boxes (`[left, top, right, bottom]`), the lowest one that keeps the part
 * short enough, so no control is cut through; where no gap will do, at the
 * limit itself.
 */
export function pictureParts(top: number, bottom: number, boxes: readonly (readonly [number, number, number, number])[], maxPt: number): [number, number][] {
  const parts: [number, number][] = [];
  let start = top;
  while (bottom - start > maxPt) {
    const limit = start + maxPt;
    const straddles = (y: number) => boxes.some((b) => b[1] < y - 1e-6 && b[3] > y + 1e-6);
    const gaps = boxes.flatMap((b) => [b[1], b[3]]).filter((y) => y > start + 1e-6 && y <= limit && !straddles(y));
    const cut = gaps.length ? Math.max(...gaps) : limit;
    parts.push([start, cut]);
    start = cut;
  }
  parts.push([start, bottom]);
  return parts;
}

/** Draws `ops` onto a canvas covering the region given in points, at 96 dpi, as a PNG. */
async function regionPng(ops: readonly PdfOp[], images: readonly PdfImage[], left: number, top: number, right: number, bottom: number): Promise<Uint8Array<ArrayBuffer>> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((right - left) * PX_PER_PT));
  canvas.height = Math.max(1, Math.round((bottom - top) * PX_PER_PT));
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.scale(PX_PER_PT, PX_PER_PT);
  c.translate(-left, -top);
  const colour = (rgb: number[]) => `rgb(${rgb.map((v) => Math.round(v * 255)).join(',')})`;
  for (const op of ops) {
    // Faded as the Preview drew it (PX-15), a watermark at its opacity.
    if ('alpha' in op) c.globalAlpha = op.alpha ?? 1;
    switch (op.kind) {
      case 'fill':
        c.fillStyle = colour(op.colour);
        c.fillRect(op.x, op.y, op.w, op.h);
        break;
      case 'line':
        c.strokeStyle = colour(op.colour);
        c.lineWidth = op.width;
        c.setLineDash(op.dash ?? []);
        c.beginPath();
        c.moveTo(op.x1, op.y1);
        c.lineTo(op.x2, op.y2);
        c.stroke();
        break;
      case 'text':
        // In the font the Preview drew it in, so no stretching is needed;
        // turned about its start as the Preview turned it.
        c.font = op.css ?? `${op.size * PX_PER_PT}px sans-serif`;
        c.save();
        c.translate(op.x, op.y);
        if (op.angle) c.rotate(op.angle);
        c.scale(1 / PX_PER_PT, 1 / PX_PER_PT);
        c.fillStyle = colour(op.colour);
        c.fillText(op.text, 0, 0);
        c.restore();
        break;
      case 'image': {
        const img = images[op.image];
        const data = new ImageData(img.width, img.height);
        for (let i = 0, j = 0, k = 0; k < img.width * img.height; i += 4, j += 3, k++) {
          data.data[i] = img.rgb[j];
          data.data[i + 1] = img.rgb[j + 1];
          data.data[i + 2] = img.rgb[j + 2];
          data.data[i + 3] = img.alpha ? img.alpha[k] : 255;
        }
        c.drawImage(await createImageBitmap(data), op.x, op.y, op.w, op.h);
        break;
      }
      case 'clip':
        c.save();
        c.beginPath();
        c.rect(op.x, op.y, op.w, op.h);
        c.clip();
        break;
      case 'restore':
        c.restore();
        break;
      case 'link':
        break;
    }
    c.globalAlpha = 1;
  }
  return canvasPng(canvas);
}

/** A page's drawing operations, and the region the export crops it to, in points. */
async function cropped(page: HTMLElement) {
  const images: PdfImage[] = [];
  const ops = await pageOps(page, images);
  const origin = page.getBoundingClientRect();
  const controls = [...page.querySelectorAll<HTMLElement>('.rp-band > *:not(.rp-band-label):not(.rp-band-rule):not(.rp-drill)')].map((el) => el.getBoundingClientRect());
  const measure = document.createElement('canvas').getContext('2d')!;
  const boxes: [number, number, number, number][] = controls.length
    ? controls.map((r) => [r.left - origin.left, r.top - origin.top, r.right - origin.left, r.bottom - origin.top].map((v) => Math.round(v) / PX_PER_PT) as [number, number, number, number])
    : ops.map((op) => extent(op, measure)).filter((b): b is [number, number, number, number] => !!b);
  return {
    ops,
    images,
    boxes,
    left: Math.min(...boxes.map((b) => b[0])),
    top: Math.min(...boxes.map((b) => b[1])),
    right: Math.max(...boxes.map((b) => b[2])),
    bottom: Math.max(...boxes.map((b) => b[3])),
  };
}

/** What a report too tall for one picture is said to have become. */
const PICTURE_PARTS_NOTE = 'This report is too long for one picture, so it was saved as several, top to bottom, in one .zip.';

/**
 * The page as one PNG at 96 dpi, cropped to its controls' boxes, as
 * DevExpress crops: s54a's image was its 400-unit title's 384 pixels wide
 * though the title's text is far narrower, and ran to the bottom of its last
 * label's box. Without a control, to what it draws. When it is taller than a
 * canvas can be (PX-24), as several cut between controls, in a .zip named
 * after `base`, with a note that says so for the person who asked.
 * (`pageToPng`, which refused such a page, went on 2026-11-11 in the full
 * audit's cleanup once the Preview called this instead; `0cec241` has it.)
 */
export async function pageToPictures(page: HTMLElement, base: string): Promise<{ blob: Blob; extension: 'png' | 'zip'; note: string | null }> {
  const { ops, images, boxes, left, top, right, bottom } = await cropped(page);
  const parts = pictureParts(top, bottom, boxes, MAX_CANVAS_PX / PX_PER_PT);
  if (parts.length === 1) return { blob: new Blob([await regionPng(ops, images, left, top, right, bottom)], { type: 'image/png' }), extension: 'png', note: null };
  const entries: { name: string; content: Uint8Array }[] = [];
  for (const [i, [from, to]] of parts.entries()) {
    entries.push({ name: `${base}-${i + 1}.png`, content: await regionPng(ops, images, left, from, right, to) });
  }
  const zip = buildZip(entries, new Date(), { keepPaths: true });
  if (!zip.bytes) throw new Error(`the pictures could not be packed: ${zip.reason}.`);
  return { blob: new Blob([zip.bytes as BlobPart], { type: 'application/zip' }), extension: 'zip', note: PICTURE_PARTS_NOTE };
}
