import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaddlePage } from './paddleOcr';

/*
 * PaddleOCR's main-thread side (2026-11-10, batch AC): whether the site
 * serves the models, the page back at the picture's own size, and when a
 * reading is left to Tesseract. The worker and the models run in a browser.
 */

const line = (text: string, x0: number) => ({
  text,
  box: { x0, y0: 20, x1: x0 + 100, y1: 40 },
  confidence: 95,
  words: [{ text, box: { x0, y0: 20, x1: x0 + 100, y1: 40 }, confidence: 95 }],
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('whether the site serves PaddleOCR', () => {
  it('counts a file, and not the index page a site answers every unknown path with', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })));
    expect(await (await import('./paddle')).paddleServed()).toBe(false);
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200, headers: { 'content-type': 'application/octet-stream' } })));
    expect(await (await import('./paddle')).paddleServed()).toBe(true);
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect(await (await import('./paddle')).paddleServed()).toBe(false);
  });

  it('asks once a page load', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const { paddleServed } = await import('./paddle');
    await paddleServed();
    await paddleServed();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('a page read enlarged', () => {
  it('comes back at the picture own size, every box divided', async () => {
    const { scaled } = await import('./paddle');
    const page: PaddlePage = { width: 1600, height: 2000, dpi: 96, lines: [line('Total', 200)], detected: 1 };
    const back = scaled(page, { width: 800, height: 1000 }, 2);
    expect([back.width, back.height]).toEqual([800, 1000]);
    expect(back.lines[0].box).toEqual({ x0: 100, y0: 10, x1: 150, y1: 20 });
    expect(back.lines[0].words[0].box).toEqual({ x0: 100, y0: 10, x1: 150, y1: 20 });
    expect(scaled(page, { width: 1600, height: 2000 }, 1)).toBe(page);
  });
});

describe('a page left to Tesseract', () => {
  it('is one where PaddleOCR read too few of the regions it found', async () => {
    const { inItsScript } = await import('./paddle');
    expect(inItsScript({ width: 1, height: 1, dpi: null, lines: [line('A', 0), line('B', 200), line('C', 400)], detected: 4 })).toBe(true);
    expect(inItsScript({ width: 1, height: 1, dpi: null, lines: [line('10234', 0)], detected: 4 })).toBe(false);
  });
});

describe('sharing a page among workers', () => {
  it('uses one fewer worker than the cores, at most four and at least one', async () => {
    const { poolSize } = await import('./paddle');
    expect([poolSize(48), poolSize(4), poolSize(2), poolSize(1), poolSize(undefined)]).toEqual([4, 3, 1, 1, 1]);
  });

  it('gives each region to one worker, balancing the width each reads', async () => {
    const { shareRegions } = await import('./paddle');
    const box = (w: number) => ({ x0: 0, y0: 0, x1: w, y1: 20 });
    // One wide line and six narrow ones: the wide one alone, the narrow ones shared by the rest.
    const boxes = [box(2000), box(100), box(100), box(100), box(100), box(100), box(100)];
    const groups = shareRegions(boxes, 3);
    expect(groups.flat().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(groups.find((g) => g.includes(0))).toEqual([0]);
    expect(groups.map((g) => g.length).sort()).toEqual([1, 3, 3]);
  });
});
