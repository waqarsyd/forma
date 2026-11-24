/**
 * The intake as the browser runs it (2026-11-24, the MCP work's wave 7,
 * NODE-2): lib/repxIntake.ts drawing on the browser's own canvases, with
 * pdf.js loaded through lib/pdf.ts, its worker and all. The drawing was
 * written inside repxIntake.ts until then; it moved here unchanged when the
 * drawing became a seam, so the MCP server can hand in its Node drawing
 * (src/mcp/nodeIntake.ts) and reach repxIntake.ts without reaching a
 * document, a Web Worker or the `?url` import pdf.ts makes, which only Vite
 * understands (src/mcp/boundaries.test.ts walks every import it makes).
 *
 * App takes files in through `ingestFile` here, and Batch's files reach the
 * generation core with `browserDrawing` (lib/batchRun.ts).
 */
import { ingestFile as ingestWith, type Decoded, type Drawing, type IngestResult, type IntakeSurface } from './repxIntake';
import { withPdfDocument } from './pdf';

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

type Surface = HTMLCanvasElement | OffscreenCanvas;

/** A sheet to draw a picture on: an OffscreenCanvas where the browser has one, else a canvas in the page. */
function canvas(w: number, h: number): IntakeSurface {
  const sheet: Surface = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  return sheet as unknown as IntakeSurface;
}

/** A canvas in the page, which pdf.js renders a page onto. */
function pageCanvas(w: number, h: number): IntakeSurface {
  return Object.assign(document.createElement('canvas'), { width: w, height: h }) as unknown as IntakeSurface;
}

/** A sheet as a data URL. */
async function encode(sheet: IntakeSurface, type: string, quality?: number): Promise<string> {
  const drawn = sheet as unknown as Surface;
  if ('toDataURL' in drawn) return drawn.toDataURL(type, quality);
  return readAsDataUrl(await drawn.convertToBlob({ type, quality }));
}

/** A picture decoded, or null when the browser cannot draw it (a TIFF in Chrome). */
async function decode(file: Blob, dataUrl: string): Promise<Decoded | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width && bitmap.height) return { image: bitmap, w: bitmap.width, h: bitmap.height, close: () => bitmap.close() };
    } catch {
      // An <img> below, which decodes some pictures a bitmap will not.
    }
  }
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    return img.naturalWidth && img.naturalHeight ? { image: img, w: img.naturalWidth, h: img.naturalHeight, close: () => undefined } : null;
  } catch {
    return null;
  }
}

/** The browser's drawing, as lib/repxIntake.ts takes it. */
export const browserDrawing: Drawing = { canvas, pageCanvas, decode, encode, dataUrl: readAsDataUrl, openPdf: withPdfDocument };

/** One dropped or picked file taken in, drawn on the browser's canvases (lib/repxIntake.ts `ingestFile`). */
export function ingestFile(file: File, uploadId: string, reportUnit?: string): Promise<IngestResult> {
  return ingestWith(file, uploadId, reportUnit, browserDrawing);
}
