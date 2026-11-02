/**
 * The Preview's pages as a PDF of Forma's own writing, with the report's
 * bookmarks as its outline (parity row 18). Browser only, and loaded only
 * when that export is asked for.
 *
 * It reads the pages the Preview has already drawn, at true size, rather
 * than drawing the report a second way: every control the Preview can show
 * reaches the PDF through the same layout and appearance, and a fix to the
 * Preview is a fix to this. What it reads:
 *
 * - each element's fill and its borders, solid, dashed or dotted;
 * - each line of text, from where the browser put each character, in the
 *   standard font nearest its family (Arial and the rest as Helvetica, Times
 *   New Roman as Times, Courier New as Courier), stretched to the width the
 *   browser measured, so a line lands where the Preview drew it;
 * - pictures and drawings (an image, or an SVG such as a chart) as pixels;
 * - a box that clips its content, as a clip; and a link, as a link.
 *
 * What it does not: turned text prints level, at its box, and a character
 * outside Windows-1252 prints as "?" (in a PDF/A file, a character outside
 * the Liberation faces: they also hold Latin Extended, Greek and Cyrillic).
 * The browser's print path keeps doing both exactly.
 */
import { platformDeflate, reportOutline, writePdf, type PdfImage, type PdfOp, type Rgb, type StandardFont } from './pdfWriter';
import type { PaginatedReport } from './reportPreview';
import type { PdfSecurity } from './pdfCrypto';
import { PDFA_WITH_PASSWORD, type PdfAPart } from './pdfA';
import { LIBERATION_FACE, PDF_FONT_PATH } from './pdfFonts';
import { parseTrueType, type TrueTypeFont } from './trueType';

const PT_PER_PX = 0.75;
/** What the print stylesheet hides: captions and band labels are the pane's, not the report's. */
// The drill-down toggle is the viewer's, never the report's (s56).
const SKIPPED = ['rp-caption', 'rp-band-label', 'rp-band-rule', 'rp-drill'];

/** A CSS colour as RGB and its alpha, or null when it draws nothing. */
function colourOf(css: string): { rgb: Rgb; alpha: number } | null {
  const m = /rgba?\(([^)]+)\)/.exec(css);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  const alpha = parts.length > 3 ? parts[3] : 1;
  if (!(alpha > 0)) return null;
  return { rgb: [parts[0] / 255, parts[1] / 255, parts[2] / 255], alpha };
}

/** The standard font a computed font is drawn in, and the installed family whose metrics it shares. */
function standardFont(style: CSSStyleDeclaration): { font: StandardFont; metricFamily: string } {
  const family = style.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
  const bold = Number.parseInt(style.fontWeight, 10) >= 600;
  const italic = style.fontStyle === 'italic' || style.fontStyle.startsWith('oblique');
  if (/times|serif$|georgia|garamond|book antiqua|cambria/.test(family) && !/sans/.test(family)) {
    const font = bold ? (italic ? 'Times-BoldItalic' : 'Times-Bold') : italic ? 'Times-Italic' : 'Times-Roman';
    return { font, metricFamily: 'Times New Roman' };
  }
  if (/courier|consolas|mono|lucida console/.test(family)) {
    const font = bold ? (italic ? 'Courier-BoldOblique' : 'Courier-Bold') : italic ? 'Courier-Oblique' : 'Courier';
    return { font, metricFamily: 'Courier New' };
  }
  const font = bold ? (italic ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : italic ? 'Helvetica-Oblique' : 'Helvetica';
  return { font, metricFamily: 'Arial' };
}

let measure: CanvasRenderingContext2D | null = null;
function context(): CanvasRenderingContext2D {
  if (!measure) measure = document.createElement('canvas').getContext('2d')!;
  return measure;
}

/** An element drawn to pixels at twice its size: an image, or an SVG serialized and loaded as one. */
async function rasterize(el: Element, width: number, height: number): Promise<PdfImage | null> {
  const w = Math.max(1, Math.round(width * 2));
  const h = Math.max(1, Math.round(height * 2));
  let source: CanvasImageSource | null = null;
  let revoke: string | null = null;
  try {
    if (el instanceof HTMLImageElement) {
      if (!el.complete) await el.decode().catch(() => undefined);
      source = el;
    } else if (el instanceof SVGSVGElement) {
      const copy = el.cloneNode(true) as SVGSVGElement;
      copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      copy.setAttribute('width', String(width));
      copy.setAttribute('height', String(height));
      revoke = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
      const img = new Image();
      img.src = revoke;
      await img.decode();
      source = img;
    }
    if (!source) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d')!;
    c.drawImage(source, 0, 0, w, h);
    const { data } = c.getImageData(0, 0, w, h);
    const rgb = new Uint8Array(w * h * 3);
    const alpha = new Uint8Array(w * h);
    let opaque = true;
    for (let i = 0, j = 0, k = 0; i < data.length; i += 4, j += 3, k++) {
      rgb[j] = data[i];
      rgb[j + 1] = data[i + 1];
      rgb[j + 2] = data[i + 2];
      alpha[k] = data[i + 3];
      if (data[i + 3] !== 255) opaque = false;
    }
    return { width: w, height: h, rgb, ...(opaque ? {} : { alpha }) };
  } catch {
    // A picture the browser will not hand over (a tainted canvas) is left out.
    return null;
  } finally {
    if (revoke) URL.revokeObjectURL(revoke);
  }
}

/** The lines a text node was laid out in, from where each character landed. */
function textLines(node: Text): { text: string; left: number; top: number; right: number }[] {
  const range = document.createRange();
  const lines: { text: string; left: number; top: number; right: number }[] = [];
  const value = node.data;
  let current: { text: string; left: number; top: number; right: number } | null = null;
  for (let i = 0; i < value.length; i++) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const r = range.getBoundingClientRect();
    // A collapsed character, such as a line break the layout did not draw.
    if (!r.width && !r.height) continue;
    if (!current || Math.abs(r.top - current.top) > r.height / 2) {
      current = { text: '', left: r.left, top: r.top, right: r.right };
      lines.push(current);
    }
    current.text += value[i];
    current.right = Math.max(current.right, r.right);
  }
  return lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+$/, '').replace(/\n/g, '') }))
    .filter((l) => l.text.trim());
}

/** The drawing operations of one page element, in points from its top left corner. */
export async function pageOps(page: HTMLElement, images: PdfImage[]): Promise<PdfOp[]> {
  const origin = page.getBoundingClientRect();
  const ops: PdfOp[] = [];
  const box = (r: DOMRect) => ({
    x: (r.left - origin.left) * PT_PER_PX,
    y: (r.top - origin.top) * PT_PER_PX,
    w: r.width * PT_PER_PX,
    h: r.height * PT_PER_PX,
  });

  const walk = async (el: Element) => {
    if (SKIPPED.some((c) => el.classList.contains(c))) return;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
    const r = el.getBoundingClientRect();
    const b = box(r);

    if (el !== page && !el.classList.contains('rp-band')) {
      const fill = colourOf(style.backgroundColor);
      if (fill && fill.alpha > 0.5 && b.w > 0 && b.h > 0) ops.push({ kind: 'fill', ...b, colour: fill.rgb });
    }
    if (el instanceof HTMLImageElement || el instanceof SVGSVGElement) {
      const image = await rasterize(el, r.width, r.height);
      if (image) ops.push({ kind: 'image', ...b, image: images.push(image) - 1 });
      return;
    }
    const sides = [
      ['Top', b.x, b.y, b.x + b.w, b.y],
      ['Right', b.x + b.w, b.y, b.x + b.w, b.y + b.h],
      ['Bottom', b.x, b.y + b.h, b.x + b.w, b.y + b.h],
      ['Left', b.x, b.y, b.x, b.y + b.h],
    ] as const;
    for (const [side, x1, y1, x2, y2] of sides) {
      const width = Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`));
      const line = style.getPropertyValue(`border-${side.toLowerCase()}-style`);
      const colour = colourOf(style.getPropertyValue(`border-${side.toLowerCase()}-color`));
      if (!(width > 0) || line === 'none' || line === 'hidden' || !colour) continue;
      const w = width * PT_PER_PX;
      // The stroke is centred on the line, so it is drawn half a width inside the box.
      const inset = side === 'Top' || side === 'Left' ? w / 2 : -w / 2;
      const horizontal = side === 'Top' || side === 'Bottom';
      ops.push({
        kind: 'line',
        x1: horizontal ? x1 : x1 + inset,
        y1: horizontal ? y1 + inset : y1,
        x2: horizontal ? x2 : x2 + inset,
        y2: horizontal ? y2 + inset : y2,
        width: w,
        colour: colour.rgb,
        ...(line === 'dashed' ? { dash: [w * 3, w * 2] } : line === 'dotted' ? { dash: [w, w] } : {}),
      });
    }
    if (el instanceof HTMLAnchorElement && el.href && /^(https?|mailto):/i.test(el.href)) {
      ops.push({ kind: 'link', ...b, uri: el.href });
    }

    const clips = el !== page && (style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowY === 'hidden');
    if (clips) ops.push({ kind: 'clip', ...b });
    for (const child of [...el.childNodes]) {
      if (child instanceof Element) await walk(child);
      else if (child instanceof Text && child.data.trim()) {
        const { font, metricFamily } = standardFont(style);
        const sizePx = Number.parseFloat(style.fontSize);
        const colour = colourOf(style.color)?.rgb ?? [0, 0, 0];
        const c = context();
        const css = `${style.fontStyle} ${style.fontWeight} ${sizePx}px ${style.fontFamily}`;
        c.font = css;
        const ascent = c.measureText('Hg').fontBoundingBoxAscent;
        c.font = `${style.fontStyle} ${style.fontWeight} ${sizePx}px "${metricFamily}"`;
        for (const line of textLines(child)) {
          const standard = c.measureText(line.text).width;
          const drawn = line.right - line.left;
          const scale = standard > 0 && drawn > 0 ? Math.min(2, Math.max(0.5, drawn / standard)) : 1;
          ops.push({
            kind: 'text',
            x: (line.left - origin.left) * PT_PER_PX,
            y: (line.top - origin.top + ascent) * PT_PER_PX,
            size: sizePx * PT_PER_PX,
            font,
            colour,
            text: line.text,
            scale,
            css,
          });
        }
      }
    }
    if (clips) ops.push({ kind: 'restore' });
  };

  await walk(page);
  return ops;
}

/** The Liberation faces fetched so far this session, by file. */
const faces = new Map<string, Promise<TrueTypeFont>>();

/** A Liberation face from the site's own /pdf-fonts/, fetched once. */
function loadFace(file: string): Promise<TrueTypeFont> {
  let face = faces.get(file);
  if (!face) {
    face = fetch(`${PDF_FONT_PATH}${file}`).then(async (r) => {
      if (!r.ok) throw new Error(`The font ${file} could not be fetched (${r.status}).`);
      return parseTrueType(new Uint8Array(await r.arrayBuffer()));
    });
    face.catch(() => faces.delete(file));
    faces.set(file, face);
  }
  return face;
}

/**
 * The PDF of `pages`, the Preview's `.rp-page` elements drawn at true size,
 * with `report`'s bookmarks as its outline under `rootTitle`. No outline when
 * the report has no bookmarks, as DevExpress writes none then. Encrypted under
 * the report's own passwords when it has any (row 73). PDF/A when the report
 * asks for it (row 72), with the Liberation faces its text uses embedded; a
 * report asking for PDF/A and a password is refused, as DevExpress refuses it.
 */
export async function pagesToPdf(
  pages: HTMLElement[],
  report: PaginatedReport,
  title: string,
  rootTitle: string,
  options: { security?: PdfSecurity | null; pdfa?: PdfAPart | null } = {},
): Promise<Blob> {
  const { security = null, pdfa = null } = options;
  if (pdfa && security) throw new Error(PDFA_WITH_PASSWORD);
  const images: PdfImage[] = [];
  const pdfPages = [];
  for (const page of pages) {
    const r = page.getBoundingClientRect();
    pdfPages.push({ width: r.width * PT_PER_PX, height: r.height * PT_PER_PX, ops: await pageOps(page, images) });
  }
  let embedded: Partial<Record<StandardFont, TrueTypeFont>> = {};
  if (pdfa) {
    const used = new Set<StandardFont>();
    for (const page of pdfPages) for (const op of page.ops) if (op.kind === 'text' && op.text) used.add(op.font);
    embedded = Object.fromEntries(await Promise.all([...used].map(async (font) => [font, await loadFace(LIBERATION_FACE[font])] as const)));
  }
  const outline = reportOutline(report, rootTitle);
  const bytes = await writePdf({
    title,
    pages: pdfPages,
    images,
    outline: outline.children.length ? outline : null,
    deflate: platformDeflate(),
    security,
    pdfa: pdfa ? { part: pdfa, fonts: embedded } : null,
  });
  return new Blob([bytes], { type: 'application/pdf' });
}
