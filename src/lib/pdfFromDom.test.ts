// @vitest-environment jsdom
/**
 * What "PDF with outline" and the picture export read off the Preview's
 * drawn pages (the 2026-11-11 audit, PX-15 and TC-08b, and PX-24). jsdom
 * lays nothing out and draws nothing, so each element's box, computed style
 * and the canvas's measuring are stubbed, on a page of a band clipped at the
 * margin holding a label, and a turned, faded watermark: what is checked is
 * how pageOps reads them, which until now no test reached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { insetOf, pageOps, turnOf } from './pdfFromDom';
import { MAX_CANVAS_PX, pictureParts } from './exportFromDom';
import type { PdfImage, PdfOp } from './pdfWriter';

const CHAR = 6;

/** A rectangle as getBoundingClientRect returns one. */
const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

const styles = new Map<Element, Record<string, string>>();
const boxes = new Map<Element, DOMRect>();

function style(el: Element): CSSStyleDeclaration {
  const own = styles.get(el) ?? {};
  const all: Record<string, string> = {
    display: 'block', visibility: 'visible', opacity: '1', 'background-color': 'rgba(0, 0, 0, 0)',
    overflow: 'visible', 'overflow-x': 'visible', 'overflow-y': 'visible', 'clip-path': 'none', transform: 'none',
    'font-family': 'Arial', 'font-weight': '400', 'font-style': 'normal', 'font-size': '13px', color: 'rgb(0, 0, 0)',
    'line-height': 'normal', 'text-align': 'start', ...own,
  };
  const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const decl: Record<string, unknown> = { getPropertyValue: (name: string) => all[name] ?? (name.startsWith('border-') && name.endsWith('-width') ? '0px' : '') };
  for (const [k, v] of Object.entries(all)) decl[camel(k)] = v;
  return decl as unknown as CSSStyleDeclaration;
}

function element(tag: string, box: DOMRect, own: Record<string, string> = {}, text?: string, className?: string): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.appendChild(document.createTextNode(text));
  styles.set(el, own);
  boxes.set(el, box);
  el.getBoundingClientRect = () => box;
  return el;
}

// jsdom's Range measures nothing (it may not have the method at all), so it is set, not spied on.
const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');

beforeEach(() => {
  vi.stubGlobal('getComputedStyle', (el: Element) => style(el));
  // Each character of a text node one CHAR wide, from its element's corner.
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: function (this: Range) {
      const owner = boxes.get(this.startContainer.parentElement!)!;
      return rect(owner.left + this.startOffset * CHAR, owner.top, CHAR, 10);
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    font: '',
    measureText: (text: string) => ({ width: text.length * CHAR, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }),
  }) as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (rangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeRect);
  else delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  styles.clear();
  boxes.clear();
});

/** A page with a band clipped 50px inside its right edge holding a label, and a watermark turned -45 degrees at 20%. */
function page(): HTMLElement {
  const sheet = element('div', rect(0, 0, 800, 1000), {}, undefined, 'rp-page');
  const band = element('div', rect(0, 100, 600, 50), { 'clip-path': 'inset(-100000px 50px -100000px -100000px)' }, undefined, 'rp-band');
  const label = element('div', rect(10, 120, 200, 20), { 'background-color': 'rgb(255, 255, 0)' }, 'Total');
  band.appendChild(label);
  const mark = element('span', rect(300, 450, 85, 85), {
    opacity: '0.2', transform: 'matrix(0.707107, -0.707107, 0.707107, 0.707107, 0, 0)', 'line-height': '20px', color: 'rgb(153, 153, 153)',
  }, 'DRAFT');
  Object.defineProperty(mark, 'offsetWidth', { value: 100 });
  Object.defineProperty(mark, 'offsetHeight', { value: 20 });
  sheet.append(band, mark);
  return sheet;
}

describe('pageOps', () => {
  it('reads a label\'s fill and its text where the browser put it', async () => {
    const ops = await pageOps(page(), []);
    expect(ops.find((o) => o.kind === 'fill')).toEqual({ kind: 'fill', x: 7.5, y: 90, w: 150, h: 15, colour: [1, 1, 0] });
    const total = ops.find((o): o is Extract<PdfOp, { kind: 'text' }> => o.kind === 'text' && o.text === 'Total')!;
    expect(total).toMatchObject({ x: 7.5, y: 96, size: 9.75, font: 'Helvetica', scale: 1 });
    expect(total.angle).toBeUndefined();
    expect(total.alpha).toBeUndefined();
  });

  it('clips a band at the margin as the pane does, around its controls (PX-15)', async () => {
    const ops = await pageOps(page(), []);
    const kinds = ops.map((o) => (o.kind === 'text' ? `text:${o.text}` : o.kind));
    expect(kinds.slice(0, 4)).toEqual(['clip', 'fill', 'text:Total', 'restore']);
    const clip = ops[0] as Extract<PdfOp, { kind: 'clip' }>;
    // The right edge 50px inside the band's 600, in points; the rest reaches far out.
    expect(clip.x + clip.w).toBeCloseTo(550 * 0.75, 6);
    expect(clip.x).toBeLessThan(-1000);
    expect(clip.y + clip.h).toBeGreaterThan(1000);
  });

  it('writes a turned, faded watermark as one turned line at its opacity, not a staircase (PX-15)', async () => {
    const ops = await pageOps(page(), []);
    const drafts = ops.filter((o): o is Extract<PdfOp, { kind: 'text' }> => o.kind === 'text' && /D|R|A|F|T/.test(o.text) && o.text !== 'Total');
    expect(drafts).toHaveLength(1);
    const [draft] = drafts;
    expect(draft.text).toBe('DRAFT');
    expect(draft.alpha).toBeCloseTo(0.2, 6);
    expect(draft.angle).toBeCloseTo(-Math.PI / 4, 4);
    // The line starts half its width left of the centre and a baseline down,
    // turned with the element: centre (342.5, 492.5), local (-50, 3).
    const k = Math.SQRT1_2;
    expect(draft.x).toBeCloseTo((342.5 + k * -50 + k * 3) * 0.75, 2);
    expect(draft.y).toBeCloseTo((492.5 - k * -50 + k * 3) * 0.75, 2);
    expect(draft.colour.map((v) => Math.round(v * 255))).toEqual([153, 153, 153]);
  });

  it('carries an ancestor\'s opacity to what its children draw', async () => {
    const sheet = element('div', rect(0, 0, 800, 1000));
    const faded = element('div', rect(0, 0, 400, 100), { opacity: '0.5' });
    const inner = element('div', rect(10, 10, 100, 20), { opacity: '0.5', 'background-color': 'rgb(0, 0, 255)' }, 'Hi');
    faded.appendChild(inner);
    sheet.appendChild(faded);
    const images: PdfImage[] = [];
    const ops = await pageOps(sheet, images);
    expect(ops.find((o) => o.kind === 'fill')).toMatchObject({ alpha: 0.25 });
    expect(ops.find((o) => o.kind === 'text')).toMatchObject({ text: 'Hi', alpha: 0.25 });
  });
});

describe('insetOf and turnOf', () => {
  it('reads a clip-path inset in pixels, in any of its shorthand forms, and nothing else', () => {
    expect(insetOf('inset(-100000px 12.5px -100000px -100000px)')).toEqual({ top: -100000, right: 12.5, bottom: -100000, left: -100000 });
    expect(insetOf('inset(5px)')).toEqual({ top: 5, right: 5, bottom: 5, left: 5 });
    expect(insetOf('inset(5px 10px)')).toEqual({ top: 5, right: 10, bottom: 5, left: 10 });
    expect(insetOf('inset(1px 2px 3px 4px round 6px)')).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
    expect(insetOf('none')).toBeNull();
    expect(insetOf('inset(10%)')).toBeNull();
    expect(insetOf('circle(50px)')).toBeNull();
  });

  it('reads a turn from a computed transform, and none from a move or none', () => {
    expect(turnOf('matrix(0, 1, -1, 0, 5, 5)')).toEqual({ a: 0, b: 1, c: -1, d: 0 });
    expect(turnOf('matrix(1, 0, 0, 1, -50, -10)')).toBeNull();
    expect(turnOf('none')).toBeNull();
  });
});

// PX-24: past 32,767 pixels a browser draws no canvas, about 31 pages of a
// report laid out as one picture.
describe('pictureParts, where a picture too tall for one canvas is cut', () => {
  const max = MAX_CANVAS_PX * 0.75;
  it('keeps a picture that fits in one part', () => {
    expect(pictureParts(0, 1000, [[0, 0, 10, 1000]], max)).toEqual([[0, 1000]]);
    expect(pictureParts(10, 10 + max, [], max)).toEqual([[10, 10 + max]]);
  });

  it('cuts a taller one between controls, never through one, each part within the limit', () => {
    // Rows of controls 20pt tall every 30pt, down 60,000pt.
    const rows = Array.from({ length: 2000 }, (_, i) => [0, i * 30, 100, i * 30 + 20] as [number, number, number, number]);
    const parts = pictureParts(0, 60_000, rows, max);
    expect(parts.length).toBe(3);
    expect(parts[0][0]).toBe(0);
    expect(parts[parts.length - 1][1]).toBe(60_000);
    for (let i = 0; i < parts.length; i++) {
      const [from, to] = parts[i];
      expect(to - from).toBeLessThanOrEqual(max);
      if (i) expect(from).toBe(parts[i - 1][1]);
      // A cut lies in a gap: no row straddles it.
      expect(rows.some(([, top, , bottom]) => top < to - 1e-6 && bottom > to + 1e-6)).toBe(false);
    }
  });

  it('cuts at the limit where one control is taller than a picture can be', () => {
    expect(pictureParts(0, 2 * max + 5, [[0, 0, 10, 2 * max + 5]], max)).toEqual([[0, max], [max, 2 * max], [2 * max, 2 * max + 5]]);
  });
});
