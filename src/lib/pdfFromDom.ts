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
 * - a box that clips its content, as a clip, and a band's `clip-path` inset,
 *   which is how the pane clips a band at the margins (parity row 64);
 * - an element's opacity, carried to what it draws, and the text of a turned
 *   element (a turned label, a diagonal watermark) turned with it; and a
 *   link, as a link.
 *
 * Text Windows-1252 cannot hold (Polish, Greek, Russian) is written in the
 * Liberation faces, embedded; a script they do not hold either (Arabic,
 * Hindi, Chinese) writes no file, and the reason says the print path keeps
 * it (2026-11-11, the full audit's PX-14). Until then it printed as "?", and
 * the clip, the opacity and the turn were dropped (PX-15): a 20% "DRAFT" at
 * 45 degrees came out as solid grey letters in a staircase.
 */
import { fitsWinAnsi, platformDeflate, reportOutline, unprintableReason, writePdf, type PdfImage, type PdfOp, type Rgb, type StandardFont } from './pdfWriter';
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

/**
 * A `clip-path: inset(...)` as its four insets in pixels, or null for any
 * other clip. The pane writes a band's in pixels (`ReportPreview`), so
 * lengths in other units are not read; `round` corners are ignored.
 */
export function insetOf(clipPath: string | null | undefined): { top: number; right: number; bottom: number; left: number } | null {
  const m = /^inset\(([^)]*)\)$/.exec((clipPath ?? '').trim());
  if (!m) return null;
  const values = m[1].split(/\s+round\s+/)[0].trim().split(/\s+/);
  if (!values.length || values.length > 4 || values.some((v) => !/^-?[\d.]+(px)?$/.test(v))) return null;
  const [top, right = top, bottom = top, left = right] = values.map((v) => Number.parseFloat(v));
  return { top, right, bottom, left };
}

/** An element's own turn, the linear part of its computed transform, or null when it is not turned. */
export function turnOf(transform: string | null | undefined): { a: number; b: number; c: number; d: number } | null {
  const m = /^matrix\(([^)]*)\)$/.exec((transform ?? '').trim());
  if (!m) return null;
  const [a, b, c, d] = m[1].split(',').map((v) => Number(v));
  if (![a, b, c, d].every(Number.isFinite) || (Math.abs(b) < 1e-6 && Math.abs(c) < 1e-6)) return null;
  return { a, b, c, d };
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

  /*
   * The text of a turned element, each of its lines one turned run (PX-15).
   * Read character by character, a turned line came out as a staircase of
   * level ones. The element's layout box, before the turn, is its offset
   * size, and the turn is about its centre, which is where the browser's
   * bounding box of the turned element is centred too.
   */
  const turnedText = (node: Text, el: HTMLElement, style: CSSStyleDeclaration, turn: { a: number; b: number; c: number; d: number }, alpha: number) => {
    const r = el.getBoundingClientRect();
    const cx = (r.left + r.right) / 2 - origin.left;
    const cy = (r.top + r.bottom) / 2 - origin.top;
    const { font, metricFamily } = standardFont(style);
    const sizePx = Number.parseFloat(style.fontSize);
    const colour = colourOf(style.color)?.rgb ?? [0, 0, 0];
    const c = context();
    const css = `${style.fontStyle} ${style.fontWeight} ${sizePx}px ${style.fontFamily}`;
    c.font = css;
    const metrics = c.measureText('Hg');
    const ascent = metrics.fontBoundingBoxAscent;
    const lineHeight = Number.parseFloat(style.lineHeight) || (ascent + metrics.fontBoundingBoxDescent);
    const halfLeading = (lineHeight - (ascent + metrics.fontBoundingBoxDescent)) / 2;
    const angle = Math.atan2(turn.b, turn.a);
    node.data.split('\n').forEach((raw, i) => {
      const text = raw.replace(/\s+$/, '');
      if (!text.trim()) return;
      c.font = css;
      const drawn = c.measureText(text).width;
      c.font = `${style.fontStyle} ${style.fontWeight} ${sizePx}px "${metricFamily}"`;
      const standard = c.measureText(text).width;
      const lx = style.textAlign === 'center' ? -drawn / 2 : style.textAlign === 'right' || style.textAlign === 'end' ? el.offsetWidth / 2 - drawn : -el.offsetWidth / 2;
      const ly = -el.offsetHeight / 2 + i * lineHeight + halfLeading + ascent;
      ops.push({
        kind: 'text',
        x: (cx + turn.a * lx + turn.c * ly) * PT_PER_PX,
        y: (cy + turn.b * lx + turn.d * ly) * PT_PER_PX,
        size: sizePx * PT_PER_PX,
        font,
        colour,
        text,
        scale: standard > 0 && drawn > 0 ? Math.min(2, Math.max(0.5, drawn / standard)) : 1,
        css,
        angle,
        ...(alpha < 1 ? { alpha } : {}),
      });
    });
  };

  const walk = async (el: Element, inherited: number) => {
    if (SKIPPED.some((c) => el.classList.contains(c))) return;
    const style = getComputedStyle(el);
    const opacity = Number.parseFloat(style.opacity);
    if (style.display === 'none' || style.visibility === 'hidden' || opacity === 0) return;
    // How opaque what it draws is: its own opacity times every ancestor's.
    const alpha = inherited * (Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1);
    const faded = alpha < 1 ? { alpha } : {};
    const r = el.getBoundingClientRect();
    const b = box(r);

    if (el !== page && !el.classList.contains('rp-band')) {
      const fill = colourOf(style.backgroundColor);
      if (fill && fill.alpha > 0.5 && b.w > 0 && b.h > 0) ops.push({ kind: 'fill', ...b, colour: fill.rgb, ...faded });
    }
    if (el instanceof HTMLImageElement || el instanceof SVGSVGElement) {
      const image = await rasterize(el, r.width, r.height);
      if (image) ops.push({ kind: 'image', ...b, image: images.push(image) - 1, ...faded });
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
        ...faded,
      });
    }
    if (el instanceof HTMLAnchorElement && el.href && /^(https?|mailto):/i.test(el.href)) {
      ops.push({ kind: 'link', ...b, uri: el.href });
    }

    const clips = el !== page && (style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowY === 'hidden');
    if (clips) ops.push({ kind: 'clip', ...b });
    // A band clipped at the margins as the pane clips it (PX-15): without this,
    // what ran past the right margin printed on its page and again on the
    // page parity row 64 adds for it.
    const inset = el !== page ? insetOf(style.getPropertyValue('clip-path') || style.clipPath) : null;
    if (inset) {
      ops.push({
        kind: 'clip',
        x: b.x + inset.left * PT_PER_PX,
        y: b.y + inset.top * PT_PER_PX,
        w: Math.max(0, b.w - (inset.left + inset.right) * PT_PER_PX),
        h: Math.max(0, b.h - (inset.top + inset.bottom) * PT_PER_PX),
      });
    }
    const turn = el instanceof HTMLElement ? turnOf(style.transform) : null;
    for (const child of [...el.childNodes]) {
      if (child instanceof Element) await walk(child, alpha);
      else if (child instanceof Text && child.data.trim() && turn) turnedText(child, el as HTMLElement, style, turn, alpha);
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
            ...faded,
          });
        }
      }
    }
    if (inset) ops.push({ kind: 'restore' });
    if (clips) ops.push({ kind: 'restore' });
  };

  await walk(page, 1);
  return ops;
}

/** What the Preview shows when the faces this PDF needs could not be loaded. */
export const FACES_UNAVAILABLE = 'The letters this PDF needs could not be loaded. Check the connection and try again.';

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
  // The Liberation faces are embedded for PDF/A, and for text Windows-1252
  // cannot hold (PX-14); a letter they lack too means no file, and the reason.
  const used = new Set<StandardFont>();
  let beyond = false;
  for (const page of pdfPages) {
    for (const op of page.ops) {
      if (op.kind !== 'text' || !op.text) continue;
      used.add(op.font);
      if (!beyond && !fitsWinAnsi(op.text)) beyond = true;
    }
  }
  const embed = !!pdfa || beyond;
  let embedded: Partial<Record<StandardFont, TrueTypeFont>> = {};
  if (embed) {
    try {
      embedded = Object.fromEntries(await Promise.all([...used].map(async (font) => [font, await loadFace(LIBERATION_FACE[font])] as const)));
    } catch {
      // Since PX-14 an ordinary Polish or Greek report reaches this fetch, so
      // offline or a failed load must not show a file name and a status code
      // (the PXA review, 2026-11-11): the person is told what to do instead.
      throw new Error(FACES_UNAVAILABLE);
    }
  }
  // Only text beyond Windows-1252 can be refused: without it every letter is
  // one the standard fonts and the faces both hold, so the scan is skipped.
  const refused = beyond ? unprintableReason(pdfPages, embedded) : null;
  if (refused) throw new Error(refused);
  const outline = reportOutline(report, rootTitle);
  const bytes = await writePdf({
    title,
    pages: pdfPages,
    images,
    outline: outline.children.length ? outline : null,
    deflate: platformDeflate(),
    security,
    pdfa: pdfa ? { part: pdfa, fonts: embedded } : null,
    fonts: !pdfa && beyond ? embedded : null,
  });
  return new Blob([bytes], { type: 'application/pdf' });
}
