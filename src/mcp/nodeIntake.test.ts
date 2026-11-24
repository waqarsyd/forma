/**
 * Taking a file in, in Node (2026-11-24, the MCP work's wave 7, NODE-2):
 * lib/repxIntake.ts's drawing seam with nodeIntake.ts's drawing handed in,
 * pdf.js's legacy build as Node's PDF loader, and a File typed by its name;
 * since the wave-7 review, a picture's size read from its header and one past
 * the budget never decoded (NODE7-PICTURE-MEMORY), and a PDF stopped between
 * its pages (NODE7-PDF-HEAP). Every picture and PDF is made here; nothing is
 * read from disk but the installed packages.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it, vi } from 'vitest';
import { ingestFile } from '../lib/repxIntake';
import { fileFrom, MAX_PICTURE_PIXELS, nodeDrawing, notDrawn, pdfjsFolder, pictureSize, releasePicture, typeOfName, withNodePdf } from './nodeIntake';

/** A picture `w` by `h` with a few dark lines on white, encoded as `type`. */
function picture(w: number, h: number, type: 'image/png' | 'image/gif' | 'image/jpeg'): Buffer {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000000';
  for (let y = 40; y < h - 20; y += 60) ctx.fillRect(30, y, w - 60, 8);
  return type === 'image/png' ? canvas.toBuffer('image/png') : type === 'image/gif' ? canvas.toBuffer('image/gif') : canvas.toBuffer('image/jpeg', 90);
}

/** A one-page PDF whose text is in a text layer. */
function digitalPdf(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null as string | null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = 'BT /F1 24 Tf 72 700 Td (INVOICE 1001) Tj ET';
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  return pdfOf(objects as string[]);
}

/** A PDF of `pages` pages, each with one line of text. */
function pagesPdf(pages: number): Uint8Array {
  const kids = Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (let i = 0; i < pages; i++) {
    const stream = `BT /F1 24 Tf 72 700 Td (PAGE ${i + 1}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  return pdfOf(objects);
}

/** A PDF of the given objects, its cross-reference table counted as it is written. */
function pdfOf(objects: string[]): Uint8Array {
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const sizeOf = async (dataUrl: string) => {
  const image = await loadImage(Buffer.from(dataUrl.split(',')[1], 'base64'));
  return [image.width, image.height];
};

describe('a file built from a path is typed as a browser types a dropped one', () => {
  it('takes the type from the extension, whatever its case, and leaves the rest to the name', () => {
    expect(typeOfName('scan.PNG')).toBe('image/png');
    expect(typeOfName('photo.jpeg')).toBe('image/jpeg');
    expect(typeOfName('C:\\reports\\page.TIF')).toBe('image/tiff');
    expect(typeOfName('statement.pdf')).toBe('application/pdf');
    expect(typeOfName('invoice.repx')).toBe('');
    expect(typeOfName('rows.csv')).toBe('');
    // A path in the platform's own form, as the server is given one: a Windows path on Linux is not
    // a path there (a backslash is a character of the name), which CI's Linux found on 842f75b.
    const file = fileFrom(join('someone', 'reports', 'scan.png'), new Uint8Array([1, 2, 3]));
    expect([file.name, file.type, file.size]).toEqual(['scan.png', 'image/png', 3]);
  });

  it('so a picture is taken in as one, where a File with no type was refused', async () => {
    const bytes = picture(400, 300, 'image/png');
    const untyped = await ingestFile(new File([new Uint8Array(bytes)], 'scan.png'), 'u0', undefined, nodeDrawing);
    expect(untyped.images).toEqual([]);
    expect(untyped.notices[0]).toMatch(/is not a supported type/);
    const typed = await ingestFile(fileFrom('scan.png', bytes), 'u1', undefined, nodeDrawing);
    expect(typed.notices).toEqual([]);
    expect(typed.imageMeta).toEqual([{ uploadId: 'u1', file: 'scan.png' }]);
  });
});

describe("the intake draws on @napi-rs/canvas in Node, as on the browser's canvases", () => {
  it('sends a small picture of a type the AI takes exactly as it came, as the browser does', async () => {
    const bytes = picture(400, 300, 'image/png');
    const taken = await ingestFile(fileFrom('small.png', bytes), 'u1', undefined, nodeDrawing);
    expect(taken.images).toEqual([`data:image/png;base64,${bytes.toString('base64')}`]);
  });

  it('shrinks a picture past MAX_IMAGE_EDGE to it, as a JPEG', async () => {
    // A photograph's grain, which a JPEG holds in fewer bytes than the PNG: a straight picture is never sent larger than it came.
    const canvas = createCanvas(3000, 1000);
    const ctx = canvas.getContext('2d');
    const grain = ctx.createImageData(3000, 1000);
    let seed = 7;
    for (let i = 0; i < grain.data.length; i++) grain.data[i] = i % 4 === 3 ? 255 : (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 0xff;
    ctx.putImageData(grain, 0, 0);
    const taken = await ingestFile(fileFrom('wide.png', canvas.toBuffer('image/png')), 'u1', undefined, nodeDrawing);
    expect(taken.images[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(await sizeOf(taken.images[0])).toEqual([2048, 683]);
  });

  it('draws again a picture the AI does not take, as a PNG, and tells of one it cannot draw', async () => {
    const taken = await ingestFile(fileFrom('scan.gif', picture(500, 400, 'image/gif')), 'u1', undefined, nodeDrawing);
    expect(taken.notices).toEqual([]);
    expect(taken.images[0]).toMatch(/^data:image\/png;base64,/);
    expect(await sizeOf(taken.images[0])).toEqual([500, 400]);
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const damaged = await ingestFile(fileFrom('broken.gif', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3])), 'u2', undefined, nodeDrawing).finally(() => quiet.mockRestore());
    expect(damaged.images).toEqual([]);
    expect(damaged.notices).toEqual(['"broken.gif" could not be read as a picture. Save it as PNG or JPEG and attach that.']);
  });

  it("writes a file's data URL as the browser's FileReader does, its type or octet-stream", async () => {
    expect(await nodeDrawing.dataUrl(new Blob([new Uint8Array([104, 105])], { type: 'text/plain' }))).toBe('data:text/plain;base64,aGk=');
    expect(await nodeDrawing.dataUrl(new Blob([new Uint8Array([104, 105])]))).toBe('data:application/octet-stream;base64,aGk=');
  });
});

describe('a picture past a size is never decoded, and one decoded is let go (the wave-7 review, NODE7-PICTURE-MEMORY)', () => {
  /** A PNG's signature and header naming `w` by `h`, and nothing after: what the size is read from. */
  const pngHeader = (w: number, h: number) => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(b, 0);
    b.write('IHDR', 12, 'latin1');
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    b[24] = 1;
    return b;
  };

  it("reads a picture's size from its header, for the kinds a person attaches, before anything is decoded", () => {
    const canvas = createCanvas(321, 123);
    canvas.getContext('2d').fillRect(10, 10, 50, 50);
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const) expect(pictureSize(canvas.toBuffer(type as 'image/png')), type).toEqual({ w: 321, h: 123 });
    expect(pictureSize(canvas.toBuffer('image/webp', 100))).toEqual({ w: 321, h: 123 });
    // A BMP, its header written here: Windows' (40 bytes, rows upward or downward) and OS/2's (12 bytes).
    const bmp = Buffer.alloc(54);
    bmp.write('BM', 0, 'latin1');
    bmp.writeUInt32LE(40, 14);
    bmp.writeInt32LE(640, 18);
    bmp.writeInt32LE(-480, 22);
    expect(pictureSize(bmp)).toEqual({ w: 640, h: 480 });
    bmp.writeUInt32LE(12, 14);
    bmp.writeUInt16LE(64, 18);
    bmp.writeUInt16LE(48, 20);
    expect(pictureSize(bmp)).toEqual({ w: 64, h: 48 });
    expect(pictureSize(pngHeader(46_000, 46_000))).toEqual({ w: 46_000, h: 46_000 });
    // Anything else, or too little to say, has no size here, and is not decoded.
    expect(pictureSize(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"/>'))).toBeNull();
    expect(pictureSize(pngHeader(10, 10).subarray(0, 20))).toBeNull();
    expect(notDrawn(new Uint8Array([1, 2, 3]))).toMatch(/^its size could not be read from its header/);
    expect(notDrawn(pngHeader(10_000, 10_000))).toBeNull();
    expect(notDrawn(pngHeader(10_000, 10_001))).toBe(`it is 10000 by 10001 pixels, past the ${MAX_PICTURE_PIXELS / 1_000_000} million Node decodes`);
  });

  it('sends one past the budget as it came where the AI takes its type, tells of one that had to be drawn, and says why in the log', async () => {
    // The review's 46,000-pixel PNG cost 2.1 GB to decode: its header alone says so here.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const huge = pngHeader(46_000, 46_000);
      const kept = await ingestFile(fileFrom('huge.png', huge), 'u1', undefined, nodeDrawing);
      expect(kept.images).toEqual([`data:image/png;base64,${huge.toString('base64')}`]);
      expect(kept.notices).toEqual([]);
      expect(warn).toHaveBeenCalledWith('"huge.png" is not drawn here: it is 46000 by 46000 pixels, past the 100 million Node decodes.');
      const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0xb0, 0xb3, 0xb0, 0xb3, 0, 0, 0]);
      const drawn = await ingestFile(fileFrom('huge.gif', gif), 'u2', undefined, nodeDrawing);
      expect(drawn.images).toEqual([]);
      expect(drawn.notices).toEqual(['"huge.gif" could not be read as a picture. Save it as PNG or JPEG and attach that.']);
    } finally {
      warn.mockRestore();
    }
  });

  it("lets a decoded picture's pixels go once it is drawn", async () => {
    const image = await loadImage(picture(300, 200, 'image/png'));
    releasePicture(image);
    await vi.waitFor(() => expect([image.width, image.height]).toEqual([1, 1]));
  });
});

describe("pdf.js's legacy build, Node's PDF loader", () => {
  it('stops a PDF between its pages once stopped, telling nothing, and destroys a document stopped before it opens', async () => {
    // The wave-7 review's NODE7-PDF-HEAP: a stop never reached the intake.
    const stopping = new AbortController();
    // Stopped as the first page, drawn, is written out: it is kept, and the second is never opened.
    const drawing = { ...nodeDrawing, encode: (canvas: Parameters<typeof nodeDrawing.encode>[0], type: string, quality?: number) => (stopping.abort(), nodeDrawing.encode(canvas, type, quality)) };
    const taken = await ingestFile(fileFrom('three.pdf', pagesPdf(3)), 'u1', undefined, drawing, stopping.signal);
    expect(taken.imageMeta.map((m) => m.page)).toEqual([1]);
    expect(taken.notices).toEqual([]);
    // Stopped while a page is drawn, the document is destroyed under it, and nothing is told either.
    const midway = new AbortController();
    const drawingMidway = { ...nodeDrawing, pageCanvas: (w: number, h: number) => (midway.abort(), nodeDrawing.pageCanvas(w, h)) };
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cut = await ingestFile(fileFrom('three.pdf', pagesPdf(3)), 'u2', undefined, drawingMidway, midway.signal).finally(() => quiet.mockRestore());
    expect([cut.images, cut.notices]).toEqual([[], []]);
    const use = vi.fn(async () => 'used');
    await expect(withNodePdf(pagesPdf(1), use, AbortSignal.abort())).rejects.toThrow();
    expect(use).not.toHaveBeenCalled();
    expect(await withNodePdf(pagesPdf(2), async (pdf) => pdf.numPages)).toBe(2);
  });

  it('reads a PDF: its text layer, and its page drawn in the font it names, at its size in points', async () => {
    const taken = await ingestFile(fileFrom('invoice.pdf', digitalPdf()), 'u1', 'HundredthsOfAnInch', nodeDrawing);
    expect(taken.notices).toEqual([]);
    expect(taken.texts).toHaveLength(1);
    expect(taken.texts[0]).toMatchObject({ uploadId: 'u1', file: 'invoice.pdf', page: 1 });
    expect(taken.texts[0].text).toContain('"INVOICE 1001"');
    expect(taken.images).toHaveLength(1);
    expect(taken.images[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(taken.imageMeta).toEqual([{ uploadId: 'u1', file: 'invoice.pdf', page: 1, pagePoints: { width: 612, height: 792 } }]);
    // Drawn at 2.5 times its size in points, as the browser draws it: 1530 by 1980.
    expect(await sizeOf(taken.images[0])).toEqual([1530, 1980]);
  });

  it('tells of a file that will not read as a PDF, and keeps no part of it', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const taken = await ingestFile(fileFrom('broken.pdf', new TextEncoder().encode('%PDF-1.4\nnot a document')), 'u1', undefined, nodeDrawing).finally(() => quiet.mockRestore());
    expect(taken.images).toEqual([]);
    expect(taken.texts).toEqual([]);
    expect(taken.notices).toEqual(['"broken.pdf" could not be read as a PDF.']);
  });

  it('releases the document however its use ends, and opens the next', async () => {
    await expect(withNodePdf(digitalPdf(), async () => Promise.reject(new Error('the use failed')))).rejects.toThrow('the use failed');
    expect(await withNodePdf(digitalPdf(), async (pdf) => pdf.numPages)).toBe(1);
  });

  it('takes its fonts, character maps, colour profiles and decoders from the installed package', () => {
    for (const name of ['standard_fonts', 'cmaps', 'iccs', 'wasm']) {
      const folder = pdfjsFolder(name);
      expect(folder.endsWith(`/${name}/`)).toBe(true);
      expect(existsSync(folder)).toBe(true);
    }
  });
});

describe('a report attached, checked with no DOM', () => {
  it('reads a .repx without the false "could not be checked", and still tells of one that does not parse', async () => {
    const xml = '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0"><Bands><Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="100" /></Bands></XtraReportsLayoutSerializer>';
    const good = await ingestFile(fileFrom('invoice.repx', new TextEncoder().encode(xml)), 'u1', undefined, nodeDrawing);
    expect(good.notices).toEqual([]);
    expect(good.texts[0].text).toContain('XtraReportsLayoutSerializer');
    const broken = await ingestFile(fileFrom('broken.repx', new TextEncoder().encode(xml.replace('</Bands>', ''))), 'u2', undefined, nodeDrawing);
    expect(broken.notices).toEqual([expect.stringMatching(/^"broken\.repx": This XML does not parse/)]);
  });
});
