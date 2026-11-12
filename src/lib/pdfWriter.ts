/**
 * Forma's own PDF writer (parity row 18), beside the browser's print path.
 *
 * Printing is still the PDF export that looks exactly like the Preview,
 * because the browser draws it with the fonts the Preview uses. What printing
 * cannot add is an outline, the bookmark pane a PDF reader shows, which is how
 * DevExpress exports a report's bookmarks. This module writes a PDF that has
 * one: `reportOutline` builds it from the paginated report, as DevExpress
 * built it in s54, and `writePdf` serializes pages of drawing operations,
 * which `pdfFromDom` reads off the Preview's own pages.
 *
 * The fonts are the PDF standard ones, which every reader has and nothing
 * needs embedding for: Helvetica, Times and Courier, which Arial, Times New
 * Roman and Courier New are drawn to the metrics of. Text is encoded as
 * Windows-1252. A report that asks for PDF/A (row 72, `doc.pdfa`), and since
 * 2026-11-11 any whose text Windows-1252 cannot hold (`doc.fonts`, PX-14),
 * gets the Liberation faces embedded instead, which also print Latin
 * Extended, Greek and Cyrillic; see pdfA.ts and pdfFonts.ts. A script they do
 * not hold is refused with a reason (`unprintableReason`) rather than printed
 * as question marks. Everything here is pure, so it runs under Node for the tests.
 */
import { unitsPerInch } from './reportGeometry';
import { bookmarkMarks, type PaginatedReport } from './reportPreview';
import { md5, pdfEncryption, type PdfSecurity } from './pdfCrypto';
import { cidSet, descriptorFlags, descriptorMetrics, glyphRun, subsetTag, toUnicodeCMap, widthsArray } from './pdfFonts';
import { subsetTrueType, type TrueTypeFont } from './trueType';
import { flattenOnWhite, PDFA_WITH_PASSWORD, pdfDate, srgbIccProfile, SRGB_CONDITION, xmpPacket, type PdfAPart } from './pdfA';

/** One entry of the outline: its title, the page it opens (0-based) and how far down it, in points. */
export interface OutlineEntry {
  title: string;
  page: number;
  y: number;
  children: OutlineEntry[];
}

/**
 * The outline DevExpress exports for a report's bookmarks, measured in s54a
 * to s54c:
 *
 * - The root is the report's own `Bookmark`, or its `Name` without one, and
 *   opens the top of the first page.
 * - Under it, every bookmark the report prints, in the order it prints them,
 *   each opening its page at the control's top.
 * - A bookmark whose `BookmarkParent` names another control sits under the
 *   last printed instance of that control's bookmark: each customer under
 *   the region printed above it. Without a parent, or a parent that printed
 *   none, it sits under the root.
 *
 * A control cut across two pages is listed once, at its first part.
 */
export function reportOutline(report: PaginatedReport, rootTitle: string): OutlineEntry {
  const toPoints = (units: number) => (units / unitsPerInch(report.unit)) * 72;
  const root: OutlineEntry = { title: rootTitle, page: 0, y: 0, children: [] };
  const latest = new Map<string, OutlineEntry>();
  for (const mark of bookmarkMarks(report)) {
    const entry: OutlineEntry = { title: mark.title, page: mark.page, y: toPoints(mark.y), children: [] };
    ((mark.parent && latest.get(mark.parent)) || root).children.push(entry);
    if (mark.ref) latest.set(mark.ref, entry);
  }
  return root;
}
export type StandardFont =
  | 'Helvetica' | 'Helvetica-Bold' | 'Helvetica-Oblique' | 'Helvetica-BoldOblique'
  | 'Times-Roman' | 'Times-Bold' | 'Times-Italic' | 'Times-BoldItalic'
  | 'Courier' | 'Courier-Bold' | 'Courier-Oblique' | 'Courier-BoldOblique';

/** An RGB colour, each 0 to 1. */
export type Rgb = [number, number, number];

/**
 * What a page draws, in points from its top left corner. A clip applies to
 * everything after it until the matching restore. `alpha`, where given and
 * below 1, is how opaque the mark is, as an element's CSS opacity made it in
 * the Preview: a watermark at 20% (2026-11-11, the full audit's PX-15).
 */
export type PdfOp =
  | { kind: 'fill'; x: number; y: number; w: number; h: number; colour: Rgb; alpha?: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width: number; colour: Rgb; dash?: number[]; alpha?: number }
  /**
   * `y` is the baseline; `scale` stretches the line horizontally, 1 for none;
   * `angle`, in radians, turns it about (x, y), clockwise as the page is seen,
   * as a turned label or a diagonal watermark is drawn.
   */
  | {
      kind: 'text'; x: number; y: number; size: number; font: StandardFont; colour: Rgb; text: string; scale: number;
      /** The CSS font it was drawn in, for a renderer that has it. */ css?: string;
      angle?: number; alpha?: number;
    }
  | { kind: 'image'; x: number; y: number; w: number; h: number; image: number; alpha?: number }
  | { kind: 'clip'; x: number; y: number; w: number; h: number }
  | { kind: 'restore' }
  | { kind: 'link'; x: number; y: number; w: number; h: number; uri: string };

/** An image's pixels: 8-bit RGB, and an optional 8-bit alpha. */
export interface PdfImage {
  width: number;
  height: number;
  rgb: Uint8Array;
  alpha?: Uint8Array;
}

export interface PdfPage {
  width: number;
  height: number;
  ops: PdfOp[];
}

export interface PdfDocument {
  title: string;
  pages: PdfPage[];
  images?: PdfImage[];
  outline?: OutlineEntry | null;
  /** zlib-compresses a stream; without one, streams are written uncompressed. */
  deflate?: ((bytes: Uint8Array) => Promise<Uint8Array>) | null;
  /** The report's PDF passwords (row 73); the file is encrypted as DevExpress encrypts its own. */
  security?: PdfSecurity | null;
  /** Random bytes for the encryption's identifier, keys and salts; the platform's unless a test fixes them. */
  random?: (n: number) => Uint8Array;
  /**
   * PDF/A (row 72): the part the report asks for, the embedded face for each
   * standard font the pages use (see pdfFonts.ts), and the moment written,
   * which the information dictionary and the XMP both carry; now unless a
   * test fixes it. A PDF/A file is never encrypted.
   */
  pdfa?: { part: PdfAPart; fonts: Partial<Record<StandardFont, TrueTypeFont>>; date?: Date } | null;
  /**
   * Faces to embed for the standard fonts outside PDF/A, as PDF/A embeds
   * them, for text Windows-1252 cannot hold: Polish, Czech, Turkish, Greek,
   * Russian (2026-11-11, the full audit's PX-14). Until then every such
   * character printed as "?". Ignored when `pdfa` brings its own.
   */
  fonts?: Partial<Record<StandardFont, TrueTypeFont>> | null;
}

/** Whether Windows-1252 holds every character of `text`, so the standard fonts print it. */
export function fitsWinAnsi(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) continue;
    if (!CP1252_HIGH.includes(ch)) return false;
  }
  return true;
}

/** The writing systems the Liberation faces do not hold, by the name a person knows them by. */
const UNHELD_SCRIPTS: [RegExp, string][] = [
  [/\p{Script=Arabic}/u, 'Arabic'],
  [/\p{Script=Hebrew}/u, 'Hebrew'],
  [/\p{Script=Devanagari}/u, 'Hindi'],
  [/\p{Script=Bengali}/u, 'Bengali'],
  [/\p{Script=Gurmukhi}/u, 'Punjabi'],
  [/\p{Script=Gujarati}/u, 'Gujarati'],
  [/\p{Script=Tamil}/u, 'Tamil'],
  [/\p{Script=Telugu}/u, 'Telugu'],
  [/\p{Script=Thai}/u, 'Thai'],
  [/\p{Script=Hangul}/u, 'Korean'],
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, 'Japanese'],
  [/\p{Script=Han}/u, 'Chinese'],
];

/**
 * Why Forma's own PDF cannot print these pages, or null when it can
 * (2026-11-11, the full audit's PX-14). With `faces` (the embedded ones),
 * a letter the face for its font lacks; without, a letter outside
 * Windows-1252. A letter only: a symbol or an emoji the font lacks still
 * prints as "?", where a whole line of Arabic as question marks is not a
 * file worth writing. The browser's print path, Export's "PDF", draws every
 * script the Preview shows, so the reason says so.
 */
export function unprintableReason(pages: readonly PdfPage[], faces: Partial<Record<StandardFont, TrueTypeFont>> | null): string | null {
  for (const page of pages) {
    for (const op of page.ops) {
      if (op.kind !== 'text') continue;
      const face = faces?.[op.font];
      for (const ch of op.text) {
        if (!/[\p{L}\p{M}]/u.test(ch)) continue;
        const held = face ? !!face.glyphOf(ch.codePointAt(0)!) : fitsWinAnsi(ch);
        if (held) continue;
        const script = UNHELD_SCRIPTS.find(([re]) => re.test(ch))?.[1];
        return script
          ? `This report has ${script} text that PDF with outline cannot hold; PDF keeps it as shown.`
          : 'This report has text that PDF with outline cannot hold; PDF keeps it as shown.';
      }
    }
  }
  return null;
}

/** Windows-1252's characters from 0x80 to 0x9F; the rest of the range below 0x100 is Latin-1. */
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

/** A text as a PDF hex string in Windows-1252; "?" for what it cannot hold. */
export function winAnsiHex(text: string): string {
  let hex = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    let byte: number;
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) byte = code;
    else {
      const high = CP1252_HIGH.indexOf(ch);
      byte = high >= 0 ? 0x80 + high : 0x3f;
    }
    hex += byte.toString(16).padStart(2, '0');
  }
  return `<${hex}>`;
}

/** A text in UTF-16BE with its byte-order mark, as titles may be anything. */
function utf16Bytes(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xfe;
  out[1] = 0xff;
  for (let i = 0; i < text.length; i++) {
    out[2 + i * 2] = text.charCodeAt(i) >> 8;
    out[3 + i * 2] = text.charCodeAt(i) & 0xff;
  }
  return out;
}
const hexOf = (bytes: Uint8Array) => `<${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}>`;
const latin1Bytes = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0) & 0xff));

const num = (n: number) => (Math.abs(n) < 1e-6 ? '0' : String(Number(n.toFixed(3))));
const rgb = (c: Rgb) => c.map((v) => num(Math.min(1, Math.max(0, v)))).join(' ');

/**
 * One page's content stream, and the fonts, images and opacities it uses. A
 * mark with an `alpha` is drawn under an ExtGState of that opacity, or, where
 * `transparency` is false (PDF/A-1 forbids it), in its colour mixed with the
 * white page as the eye sees it there.
 */
function contentOf(
  page: PdfPage,
  fontIndex: (f: StandardFont) => number,
  showText: (op: Extract<PdfOp, { kind: 'text' }>) => string,
  transparency = true,
) {
  const H = page.height;
  const out: string[] = [];
  const images = new Set<number>();
  const alphas: number[] = [];
  const faded = (alpha: number | undefined) => alpha !== undefined && alpha < 1 - 1e-3;
  const tint = (c: Rgb, alpha: number | undefined): Rgb =>
    !transparency && faded(alpha) ? (c.map((v) => 1 - alpha! * (1 - v)) as Rgb) : c;
  const push = (alpha: number | undefined, body: string) => {
    if (!transparency || !faded(alpha)) return out.push(body);
    const a = Math.round(Math.max(0, alpha!) * 1000) / 1000;
    let k = alphas.indexOf(a);
    if (k < 0) k = alphas.push(a) - 1;
    return out.push(`q /GA${k} gs ${body} Q`);
  };
  for (const op of page.ops) {
    switch (op.kind) {
      case 'fill':
        push(op.alpha, `${rgb(tint(op.colour, op.alpha))} rg ${num(op.x)} ${num(H - op.y - op.h)} ${num(op.w)} ${num(op.h)} re f`);
        break;
      case 'line':
        push(op.alpha, `${rgb(tint(op.colour, op.alpha))} RG ${num(op.width)} w [${(op.dash ?? []).map(num).join(' ')}] 0 d ${num(op.x1)} ${num(H - op.y1)} m ${num(op.x2)} ${num(H - op.y2)} l S`);
        break;
      case 'text': {
        if (!op.text) break;
        // Turned clockwise on the page, which is anticlockwise in the PDF's upward y.
        const cos = Math.cos(op.angle ?? 0);
        const sin = Math.sin(op.angle ?? 0);
        const matrix = `${num(cos)} ${num(-sin)} ${num(sin)} ${num(cos)} ${num(op.x)} ${num(H - op.y)}`;
        push(op.alpha, `BT /F${fontIndex(op.font)} ${num(op.size)} Tf ${num(op.scale * 100)} Tz ${rgb(tint(op.colour, op.alpha))} rg ${matrix} Tm ${showText(op)} Tj ET`);
        break;
      }
      case 'image':
        images.add(op.image);
        push(op.alpha, `q ${num(op.w)} 0 0 ${num(op.h)} ${num(op.x)} ${num(H - op.y - op.h)} cm /Im${op.image} Do Q`);
        break;
      case 'clip':
        out.push(`q ${num(op.x)} ${num(H - op.y - op.h)} ${num(op.w)} ${num(op.h)} re W n`);
        break;
      case 'restore':
        out.push('Q');
        break;
      case 'link':
        break;
    }
  }
  return { stream: out.join('\n'), images, alphas };
}

const encoder = new TextEncoder();

/**
 * The document as PDF bytes: 1.4, or encrypted as `doc.security` asks, 1.6
 * or 1.7 as DevExpress wrote the same level (s61). Encrypted, every string
 * and stream is under its object's key, and only the encryption dictionary
 * and the trailer are not.
 */
// `<ArrayBuffer>` (2026-11-12, TypeScript 7): its bytes go into a Blob, which
// takes a view of an ArrayBuffer only; they are always a fresh array.
export async function writePdf(doc: PdfDocument): Promise<Uint8Array<ArrayBuffer>> {
  const pdfa = doc.pdfa ?? null;
  // DevExpress refuses PDF/A with a password and writes nothing (s62a, s62b).
  if (pdfa && doc.security) throw new Error(PDFA_WITH_PASSWORD);
  const written = pdfa?.date ?? new Date();
  const deflate = doc.deflate ?? null;
  const enc = doc.security ? await pdfEncryption(doc.security, doc.random) : null;
  const objects: (Uint8Array[] | null)[] = [null]; // 1-based object numbers
  const reserve = () => objects.push(null) - 1;
  const set = (n: number, ...parts: (string | Uint8Array)[]) => {
    objects[n] = parts.map((p) => (typeof p === 'string' ? encoder.encode(p) : p));
  };
  const stream = async (n: number, dict: string, data: Uint8Array): Promise<(string | Uint8Array)[]> => {
    const compressed = deflate ? await deflate(data) : data;
    const packed = enc ? enc.encrypt(n, compressed) : compressed;
    const filter = deflate ? ' /Filter /FlateDecode' : '';
    return [`<< ${dict}${filter} /Length ${packed.length} >>\nstream\n`, packed, '\nendstream'];
  };
  /** A string of object `n`: encrypted and in hex, or as written unencrypted. */
  const str = (n: number, bytes: Uint8Array, plain: string) => (enc ? hexOf(enc.encrypt(n, bytes)) : plain);

  const catalog = reserve();
  const pagesNode = reserve();
  const fonts: StandardFont[] = [];
  const fontIndex = (f: StandardFont) => {
    let i = fonts.indexOf(f);
    if (i < 0) i = fonts.push(f) - 1;
    return i;
  };
  // The faces embedded: PDF/A's own, or those given for text beyond Windows-1252.
  const faces = pdfa ? pdfa.fonts : doc.fonts ?? null;
  /** With embedded faces, the glyphs each font's text used and the character each stands for. */
  const used = new Map<StandardFont, Map<number, number>>();
  const showText = (op: Extract<PdfOp, { kind: 'text' }>) => {
    if (!faces) return winAnsiHex(op.text);
    const face = faces[op.font];
    if (!face) throw new Error(`No embedded face was supplied for ${op.font}.`);
    const run = glyphRun(face, op.text);
    let glyphs = used.get(op.font);
    if (!glyphs) used.set(op.font, (glyphs = new Map()));
    for (const [g, cp] of run.glyphs) if (!glyphs.has(g)) glyphs.set(g, cp);
    return run.hex;
  };
  const contents = doc.pages.map((page) => contentOf(page, fontIndex, showText, pdfa?.part !== 1));
  const fontObjects: number[] = [];
  for (const name of fonts) {
    const n = reserve();
    fontObjects.push(n);
    if (!faces) {
      set(n, `<< /Type /Font /Subtype /Type1 /BaseFont /${name}${name.startsWith('Symbol') ? '' : ' /Encoding /WinAnsiEncoding'} >>`);
      continue;
    }
    // Embedded as DevExpress embeds its PDF/A fonts (s60b): Type 0 over a
    // CIDFontType2, glyph ids as codes, the subset, its CIDSet and a Unicode map.
    const face = faces[name]!;
    const glyphMap = used.get(name) ?? new Map<number, number>();
    const glyphs = [...glyphMap.keys()];
    const base = `${subsetTag(face.postscriptName, glyphs)}+${face.postscriptName}`;
    const program = subsetTrueType(face, glyphs);
    const file = reserve();
    set(file, ...(await stream(file, `/Length1 ${program.length}`, program)));
    const slots = reserve();
    set(slots, ...(await stream(slots, '', cidSet(face.numGlyphs))));
    const descriptor = reserve();
    set(
      descriptor,
      `<< /Type /FontDescriptor /FontName /${base} /Flags ${descriptorFlags(face, name.startsWith('Times'))} ${descriptorMetrics(face)}` +
        ` /CIDSet ${slots} 0 R /FontFile2 ${file} 0 R >>`,
    );
    const cid = reserve();
    // Through `str` since 2026-11-11: faces can now be embedded in an
    // encrypted file (PX-14), where these two strings are under `cid`'s key
    // like every other. Unencrypted, `str` writes them exactly as before.
    const registry = str(cid, encoder.encode('Adobe'), '(Adobe)');
    const ordering = str(cid, encoder.encode('Identity'), '(Identity)');
    set(
      cid,
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${base} /CIDSystemInfo << /Registry ${registry} /Ordering ${ordering} /Supplement 0 >>` +
        ` /FontDescriptor ${descriptor} 0 R /DW 1000 /W ${widthsArray(face, glyphs)} /CIDToGIDMap /Identity >>`,
    );
    const unicode = reserve();
    set(unicode, ...(await stream(unicode, '', encoder.encode(toUnicodeCMap(glyphMap)))));
    set(n, `<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${unicode} 0 R >>`);
  }

  const imageObjects: number[] = [];
  for (const image of doc.images ?? []) {
    // PDF/A-1 forbids transparency: the picture is flattened, as DevExpress's is (s62d).
    const flatten = pdfa?.part === 1 && image.alpha;
    let smask = '';
    if (image.alpha && !flatten) {
      const m = reserve();
      set(m, ...(await stream(m, `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8`, image.alpha)));
      smask = ` /SMask ${m} 0 R`;
    }
    const n = reserve();
    const pixels = flatten ? flattenOnWhite(image.rgb, image.alpha!) : image.rgb;
    set(n, ...(await stream(n, `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${smask}`, pixels)));
    imageObjects.push(n);
  }

  const fontDict = `<< ${fontObjects.map((n, i) => `/F${i} ${n} 0 R`).join(' ')} >>`;
  const pageObjects: number[] = [];
  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i];
    const { stream: body, images, alphas } = contents[i];
    const content = reserve();
    set(content, ...(await stream(content, '', encoder.encode(body))));
    const annots: number[] = [];
    for (const op of page.ops) {
      if (op.kind !== 'link') continue;
      const a = reserve();
      const uri = str(a, latin1Bytes(op.uri), `(${op.uri.replace(/[\\()]/g, (c) => `\\${c}`)})`);
      // PDF/A asks every annotation to print (flag 4).
      set(a, `<< /Type /Annot /Subtype /Link /Rect [${num(op.x)} ${num(page.height - op.y - op.h)} ${num(op.x + op.w)} ${num(page.height - op.y)}] /Border [0 0 0]${pdfa ? ' /F 4' : ''} /A << /S /URI /URI ${uri} >> >>`);
      annots.push(a);
    }
    const xobjects = [...images].map((k) => `/Im${k} ${imageObjects[k]} 0 R`).join(' ');
    const states = alphas.map((a, k) => `/GA${k} << /Type /ExtGState /ca ${num(a)} /CA ${num(a)} >>`).join(' ');
    const n = reserve();
    set(
      n,
      `<< /Type /Page /Parent ${pagesNode} 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}]` +
        ` /Resources << /Font ${fontDict}${xobjects ? ` /XObject << ${xobjects} >>` : ''}${states ? ` /ExtGState << ${states} >>` : ''} >>` +
        ` /Contents ${content} 0 R${annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(' ')}]` : ''} >>`,
    );
    pageObjects.push(n);
  }
  set(pagesNode, `<< /Type /Pages /Kids [${pageObjects.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageObjects.length} >>`);

  // The outline: the root is an entry of its own under the outline
  // dictionary, as DevExpress writes it, with the bookmarks beneath it.
  let outlinesRef = '';
  if (doc.outline && pageObjects.length) {
    const outlines = reserve();
    const dest = (e: OutlineEntry) => {
      const page = Math.min(e.page, pageObjects.length - 1);
      return `[${pageObjects[page]} 0 R /XYZ 0 ${num(doc.pages[page].height - e.y)} null]`;
    };
    const count = (e: OutlineEntry): number => e.children.reduce((s, c) => s + 1 + count(c), 0);
    const place = (entries: OutlineEntry[], parent: number): number[] => {
      const refs = entries.map(() => reserve());
      entries.forEach((e, i) => {
        const kids = e.children.length ? place(e.children, refs[i]) : [];
        set(
          refs[i],
          `<< /Title ${str(refs[i], utf16Bytes(e.title), hexOf(utf16Bytes(e.title)))} /Parent ${parent} 0 R /Dest ${dest(e)}` +
            (i > 0 ? ` /Prev ${refs[i - 1]} 0 R` : '') +
            (i < refs.length - 1 ? ` /Next ${refs[i + 1]} 0 R` : '') +
            (kids.length ? ` /First ${kids[0]} 0 R /Last ${kids[kids.length - 1]} 0 R /Count ${count(e)}` : '') +
            ' >>',
        );
      });
      return refs;
    };
    const [top] = place([doc.outline], outlines);
    set(outlines, `<< /Type /Outlines /First ${top} 0 R /Last ${top} 0 R /Count ${1 + count(doc.outline)} >>`);
    outlinesRef = ` /Outlines ${outlines} 0 R /PageMode /UseOutlines`;
  }
  // PDF/A's XMP, never compressed so that it reads without a PDF parser, and
  // the sRGB output intent DevExpress's exports carry (s60).
  let pdfaRefs = '';
  if (pdfa) {
    const meta = reserve();
    const xmp = encoder.encode(xmpPacket({ part: pdfa.part, title: doc.title, producer: 'Forma', date: written }));
    set(meta, `<< /Type /Metadata /Subtype /XML /Length ${xmp.length} >>\nstream\n`, xmp, '\nendstream');
    const icc = reserve();
    set(icc, ...(await stream(icc, '/N 3', srgbIccProfile())));
    pdfaRefs =
      ` /Metadata ${meta} 0 R /OutputIntents [<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (${SRGB_CONDITION})` +
      ` /Info (${SRGB_CONDITION}) /DestOutputProfile ${icc} 0 R >>]`;
  }
  set(catalog, `<< /Type /Catalog /Pages ${pagesNode} 0 R${outlinesRef}${pdfaRefs} >>`);
  const info = reserve();
  const dates = pdfa ? ` /CreationDate (${pdfDate(written)}) /ModDate (${pdfDate(written)})` : '';
  set(info, `<< /Title ${str(info, utf16Bytes(doc.title), hexOf(utf16Bytes(doc.title)))} /Producer ${str(info, latin1Bytes('Forma'), '(Forma)')}${dates} >>`);
  // The encryption dictionary is an object of its own, never itself encrypted.
  const encrypt = enc ? reserve() : 0;
  if (enc) set(encrypt, enc.dictionary);

  // Serialize, recording each object's offset for the cross-reference table.
  const chunks: Uint8Array[] = [encoder.encode(`%PDF-${enc ? enc.version : '1.4'}\n%\xe2\xe3\xcf\xd3\n`)];
  let offset = chunks[0].length;
  const offsets: number[] = [0];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = offset;
    const parts = [encoder.encode(`${n} 0 obj\n`), ...(objects[n] ?? [encoder.encode('null')]), encoder.encode('\nendobj\n')];
    for (const p of parts) {
      chunks.push(p);
      offset += p.length;
    }
  }
  const xref = [`xref\n0 ${objects.length}\n0000000000 65535 f \n`, ...offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  // PDF/A asks for a file identifier; one derived from the content is stable for a test.
  const fileId = pdfa ? md5(encoder.encode(`${doc.title}\n${written.toISOString()}\n${offset}`)) : null;
  const secured = enc
    ? ` /Encrypt ${encrypt} 0 R /ID [${hexOf(enc.id)} ${hexOf(enc.id)}]`
    : fileId
      ? ` /ID [${hexOf(fileId)} ${hexOf(fileId)}]`
      : '';
  chunks.push(encoder.encode(`${xref}trailer\n<< /Size ${objects.length} /Root ${catalog} 0 R /Info ${info} 0 R${secured} >>\nstartxref\n${offset}\n%%EOF\n`));
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return bytes;
}

/** zlib compression where the platform has it, for `PdfDocument.deflate`. */
export function platformDeflate(): ((bytes: Uint8Array) => Promise<Uint8Array<ArrayBuffer>>) | null {
  if (typeof CompressionStream === 'undefined') return null;
  return async (bytes) => new Uint8Array(await new Response(new Blob([ownBuffer(bytes)]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}

/**
 * The bytes as a view of an ArrayBuffer, which a Blob takes and a view of a
 * SharedArrayBuffer is not (2026-11-12, TypeScript 7's DOM types say so): the
 * same view when its buffer is one already, else a copy. This app never makes
 * a SharedArrayBuffer (it would need cross-origin isolation), so the copy is
 * the type's case, not a path that runs; the test checks both.
 */
export function ownBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : new Uint8Array(bytes);
}
