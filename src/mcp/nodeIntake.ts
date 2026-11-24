/**
 * Taking a file in, in Node (2026-11-24, the MCP work's wave 7; finding
 * NODE-2 of the 2026-11-23 design audit): what lib/repxIntake.ts draws on
 * when the MCP server makes a report, where the browser hands in
 * lib/browserIntake.ts's.
 *
 * Run as it was, the intake threw on every picture in Node (FileReader,
 * createImageBitmap, Image, OffscreenCanvas and the document are the
 * browser's), lost every PDF, text layer and all (pdf.js was loaded through a
 * `?url` import only Vite understands), and refused a File built from a path,
 * which has no type, as "not a supported type". So:
 *
 * - `nodeDrawing`: @napi-rs/canvas for every canvas, decode and encode, so a
 *   picture is straightened, shrunk past MAX_IMAGE_EDGE and redrawn when the
 *   AI does not take its type, as in the browser; a file's data URL written
 *   as the browser's FileReader writes one.
 * - `withNodePdf`: pdf.js's legacy build, its worker given as a file URL
 *   (pdf.js runs it in this thread in Node, no Web Worker and no worker
 *   thread), and the standard fonts, character maps, colour profiles and
 *   wasm decoders from the installed pdfjs-dist, so a PDF that names
 *   Helvetica without embedding it still draws its text.
 * - `fileFrom`: a File whose type comes from its name's extension, as a
 *   browser types the files a person drops.
 *
 * ## Pictures past a size, and PDFs that never end
 *
 * A picture is decoded only when its header names a size within
 * `MAX_PICTURE_PIXELS` (`pictureSize`), and its pixels are let go as soon as
 * it is drawn (`releasePicture`): the wave-7 review (NODE7-PICTURE-MEMORY)
 * measured a 257 KB PNG, 46,000 pixels square, costing 2.1 GB to decode, two
 * 40,000-pixel ones taken in one after the other peaking at 3.2 GB because
 * the first was still held, and that memory is native, which no V8 heap
 * limit bounds. One past the budget is not decoded: it goes as it came where
 * the AI takes its type, and is told where it has to be drawn, as a picture
 * the browser cannot draw is.
 *
 * A PDF has no such check, and in this thread none would hold: the same
 * review measured a 611 KB one-page PDF of 20 million `cm` operators ending
 * the process in 67 seconds with V8's heap out of memory (no handler catches
 * that), a 1 MB one inflating to 1 GB taking 42 seconds at 2.4 GB, with the
 * event loop stalled up to 13.8 seconds at a time, and eight pages of it
 * still running at 180 seconds (NODE7-PDF-HEAP). A stop reaches the intake
 * between files and pages and destroys the document (`withNodePdf`'s
 * `signal`), but cannot interrupt pdf.js inside a step. So the intake, and
 * `make` in nodeGeneration.ts around it, must never run on the thread that
 * answers the protocol: the AI tools (wave 8) run them in a worker thread
 * with `resourceLimits` and a deadline sized for a generation
 * (generator.ts's, not workerPool.ts's 30 seconds), which the review measured
 * containing the 611 KB PDF (the worker ended out of memory after 31 seconds,
 * the host alive at 484 MB). `resourceLimits` bounds V8's heap only, not a
 * decoded picture or an ArrayBuffer, which is why the budget above and the
 * deadline are needed beside it.
 *
 * @napi-rs/canvas is a devDependency, as pdfjs-dist's optional one is
 * (package.json, comment:mcp): the server runs from a clone after a full
 * `npm ci`. Nothing here writes a file.
 *
 * Pure ASCII.
 */
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';
import type { Decoded, Drawing, IntakeSurface, PdfDocumentLike } from '../lib/repxIntake';

const requireHere = createRequire(import.meta.url);

/** A canvas `w` by `h`, whole pixels as a browser's are, and never empty. */
function sheet(w: number, h: number): IntakeSurface {
  return createCanvas(Math.max(1, Math.trunc(w)), Math.max(1, Math.trunc(h))) as unknown as IntakeSurface;
}

/**
 * The most pixels Node decodes one picture into (the header): a 48-megapixel
 * phone photograph and an A3 page scanned at 600 dpi (about 70 megapixels)
 * are inside it, the review's 1.6- and 2.1-gigapixel PNGs twenty times past
 * it. At four bytes a pixel it is 400 MB at most, held one picture at a time.
 */
export const MAX_PICTURE_PIXELS = 100_000_000;

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const le24 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, i: number, text: string) => [...text].every((c, k) => b[i + k] === c.charCodeAt(0));

/** A JPEG's size, from its first frame header (SOF0 to SOF15, which are not DHT, JPG or DAC). */
function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return i + 8 < b.length ? { w: be16(b, i + 7), h: be16(b, i + 5) } : null;
    }
    i += 2 + be16(b, i + 2);
  }
  return null;
}

/**
 * A picture's width and height as its header states them, read before
 * anything is decoded: PNG, JPEG, GIF, WebP and BMP, the raster pictures a
 * person attaches. Null for any other kind, or a header too short to say.
 */
export function pictureSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 'PNG') && ascii(b, 12, 'IHDR')) return { w: be32(b, 16), h: be32(b, 20) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
  if (b.length >= 10 && (ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a'))) return { w: le16(b, 6), h: le16(b, 8) };
  if (b.length >= 30 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) {
    if (ascii(b, 12, 'VP8 ') && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { w: le16(b, 26) & 0x3fff, h: le16(b, 28) & 0x3fff };
    if (ascii(b, 12, 'VP8L') && b[20] === 0x2f) {
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (ascii(b, 12, 'VP8X')) return { w: le24(b, 24) + 1, h: le24(b, 27) + 1 };
    return null;
  }
  if (b.length >= 26 && ascii(b, 0, 'BM')) {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (view.getUint32(14, true) === 12) return { w: view.getUint16(18, true), h: view.getUint16(20, true) };
    return { w: Math.abs(view.getInt32(18, true)), h: Math.abs(view.getInt32(22, true)) };
  }
  return null;
}

/** Why a picture of these bytes is not decoded here, or null when it may be (the header). */
export function notDrawn(bytes: Uint8Array): string | null {
  const size = pictureSize(bytes);
  if (!size) return 'its size could not be read from its header (Node draws PNG, JPEG, GIF, WebP and BMP)';
  if (size.w * size.h > MAX_PICTURE_PIXELS) return `it is ${size.w} by ${size.h} pixels, past the ${MAX_PICTURE_PIXELS / 1_000_000} million Node decodes`;
  return null;
}

let blank: Buffer | null = null;

/**
 * Lets a decoded picture's pixels go now, rather than whenever the collector
 * reaches it, by giving it a one-pixel picture in their place: measured on a
 * 20,000-pixel PNG, 431 MB down to 49 MB, where without it a second decode
 * held both (the header).
 */
export function releasePicture(image: Image): void {
  try {
    image.src = blank ??= createCanvas(1, 1).toBuffer('image/png');
  } catch {
    // Collected with the image, as before.
  }
}

/** A picture decoded by @napi-rs/canvas, or null when it cannot or may not be drawn (a TIFF, a damaged file, one past the budget). */
async function decode(file: Blob): Promise<Decoded | null> {
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const why = notDrawn(bytes);
    if (why) {
      const name = (file as Partial<File>).name;
      console.warn(`${name ? `"${name}"` : 'A picture'} is not drawn here: ${why}.`);
      return null;
    }
    const image = await loadImage(bytes);
    if (image.width && image.height) return { image, w: image.width, h: image.height, close: () => releasePicture(image) };
    releasePicture(image);
    return null;
  } catch {
    return null;
  }
}

/** A canvas as a data URL of `type`; `quality` from 0 to 1, as the browser's. */
function encode(drawn: IntakeSurface, type: string, quality?: number): Promise<string> {
  return (drawn as unknown as { toDataURLAsync(type: string, quality?: number): Promise<string> }).toDataURLAsync(type, quality);
}

/** A file as a data URL, as the browser's FileReader writes one: its type, or application/octet-stream with none. */
async function dataUrl(file: Blob): Promise<string> {
  return `data:${file.type || 'application/octet-stream'};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`;
}

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pending: Promise<Pdfjs> | null = null;

/** pdf.js's legacy build, loaded once, its worker given as a file URL; a failed load is tried again next time. */
export function loadNodePdfjs(): Promise<Pdfjs> {
  pending ??= (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(requireHere.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
    return pdfjs;
  })().catch((err) => {
    pending = null;
    throw err;
  });
  return pending;
}

/** One of the installed pdfjs-dist's folders, as pdf.js takes it: a path with forward slashes and a trailing one. */
export function pdfjsFolder(name: string): string {
  return `${join(dirname(requireHere.resolve('pdfjs-dist/package.json')), name).split(sep).join('/')}/`;
}

/**
 * Open a PDF, hand it to `use`, and release it however `use` ends, as
 * lib/pdf.ts `withPdfDocument` does in the browser (2026-11-11, the full
 * audit's PL-05). Stopped (`signal`), the document is destroyed at once, so
 * what pdf.js is still to do for it fails rather than runs on; what it is
 * doing inside one step it finishes first (the header).
 */
export async function withNodePdf<T>(data: ArrayBuffer | Uint8Array, use: (pdf: PdfDocumentLike) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const pdfjs = await loadNodePdfjs();
  const task = pdfjs.getDocument({
    data,
    standardFontDataUrl: pdfjsFolder('standard_fonts'),
    cMapUrl: pdfjsFolder('cmaps'),
    cMapPacked: true,
    iccUrl: pdfjsFolder('iccs'),
    wasmUrl: pdfjsFolder('wasm'),
  });
  const stop = () => void task.destroy().catch(() => undefined);
  if (signal?.aborted) stop();
  else signal?.addEventListener('abort', stop, { once: true });
  try {
    return await use(await task.promise);
  } finally {
    signal?.removeEventListener('abort', stop);
    await task.destroy();
  }
}

/** Node's drawing, as lib/repxIntake.ts takes it. */
export const nodeDrawing: Drawing = { canvas: sheet, pageCanvas: sheet, decode, encode, dataUrl, openPdf: withNodePdf };

/** The type a browser gives a dropped file of this name, for the types the intake decides by; '' for the rest, which it decides by name. */
const TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

/** A file's type from its name's extension, as a browser types a dropped file; '' when the intake decides by name. */
export function typeOfName(name: string): string {
  return TYPES[extname(name).toLowerCase()] ?? '';
}

/** A File of `bytes`, named as the file was and typed by its extension (`typeOfName`). */
export function fileFrom(name: string, bytes: Uint8Array): File {
  return new File([new Uint8Array(bytes)], basename(name), { type: typeOfName(name) });
}
