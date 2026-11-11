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

  // 2026-11-11, the full audit's PR-16: four copies of the recogniser were what a phone's tab was closed over.
  it('uses one worker on a machine with 4 GB or less', async () => {
    const { poolSize } = await import('./paddle');
    expect([poolSize(8, 4), poolSize(8, 2), poolSize(8, 8), poolSize(8, undefined)]).toEqual([1, 1, 4, 4]);
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

/*
 * Each worker is sent its own regions, not the page (2026-11-11, the full
 * audit's PR-16 and PL-28): cut out, stacked, and transferred.
 */
describe('the regions a worker reads', () => {
  /** A page whose every pixel says where it is: red its x, green its y. */
  const page = (width: number, height: number) => {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set([x, y, 7, 255], (y * width + x) * 4);
    return { rgba, width, height };
  };
  const pixel = (p: { rgba: Uint8ClampedArray; width: number }, x: number, y: number) => [...p.rgba.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4)];

  it('are cut out and stacked, each where its cut of the stack is its cut of the page', async () => {
    const { stackRegions } = await import('./paddle');
    const source = page(200, 100);
    const boxes = [
      { x0: 10.4, y0: 5.6, x1: 50.2, y1: 20.1 },
      { x0: 100, y0: 60, x1: 180.5, y1: 75 },
    ];
    const stack = stackRegions(source, boxes);
    // 41 wide by 16 high, then 81 by 15: as wide as the widest, as high as both.
    expect([stack.width, stack.height]).toEqual([81, 31]);
    expect(stack.rgba.length).toBe(81 * 31 * 4);
    expect(pixel(stack, 0, 0)).toEqual(pixel(source, 10, 5));
    expect(pixel(stack, 40, 15)).toEqual(pixel(source, 50, 20));
    expect(pixel(stack, 0, 16)).toEqual(pixel(source, 100, 60));
    expect(pixel(stack, 80, 30)).toEqual(pixel(source, 180, 74));
    // The boxes keep their fractions, so the worker's floor and ceiling cut the same pixels.
    expect(stack.boxes[0].x0).toBeCloseTo(0.4);
    expect(stack.boxes[0].y0).toBeCloseTo(0.6);
    expect(stack.boxes[1]).toEqual({ x0: 0, y0: 16, x1: 80.5, y1: 31 });
  });

  it('are put back on the page with every word', async () => {
    const { stackRegions, unstacked } = await import('./paddle');
    const stack = stackRegions(page(200, 100), [{ x0: 10, y0: 5, x1: 50, y1: 20 }, { x0: 100, y0: 60, x1: 180, y1: 75 }]);
    const onStack = { ...line('Total', 0), box: stack.boxes[1], words: [{ text: 'Total', confidence: 95, box: { x0: 4, y0: 15, x1: 40, y1: 30 } }] };
    const back = unstacked(onStack, stack.offsets[1])!;
    expect(back.box).toEqual({ x0: 100, y0: 60, x1: 180, y1: 75 });
    expect(back.words[0].box).toEqual({ x0: 104, y0: 60, x1: 140, y1: 75 });
    expect(unstacked(null, stack.offsets[0])).toBeNull();
  });

  it("send the detector a copy and each reader its stack, transferred, and read back in the page's places", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    vi.stubGlobal('navigator', { hardwareConcurrency: 3 });
    const sent: { request: { op: string; rgba: Uint8ClampedArray; width: number; height: number; boxes?: { x0: number; y0: number; x1: number; y1: number }[]; id: number }; transfer: ArrayBuffer[] }[] = [];
    class FakeWorker extends EventTarget {
      postMessage(request: (typeof sent)[number]['request'], transfer: ArrayBuffer[]) {
        sent.push({ request, transfer });
        const reply = request.op === 'detect'
          ? { id: request.id, boxes: [{ x0: 10, y0: 5, x1: 50, y1: 20 }, { x0: 100, y0: 60, x1: 180, y1: 75 }] }
          : { id: request.id, lines: request.boxes!.map((b) => ({ text: 'w', confidence: 95, box: b, words: [{ text: 'w', confidence: 95, box: b }] })) };
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: reply })));
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    const source = page(200, 100);
    const input = { width: 200, height: 100, getContext: () => ({ getImageData: () => ({ data: source.rgba }) }) } as unknown as HTMLCanvasElement;
    const { readWithPaddle } = await import('./paddle');
    const read = await readWithPaddle(input, { width: 200, height: 100, dpi: null }, 1);

    const detect = sent.find((s) => s.request.op === 'detect')!;
    expect(detect.request.rgba).not.toBe(source.rgba);
    expect(detect.transfer).toEqual([detect.request.rgba.buffer]);
    const readers = sent.filter((s) => s.request.op === 'recognize');
    expect(readers).toHaveLength(2);
    for (const r of readers) {
      expect(r.transfer).toEqual([r.request.rgba.buffer]);
      // A strip of the page, never the page.
      expect(r.request.rgba.length).toBeLessThan(source.rgba.length / 4);
    }
    expect(read.lines.map((l) => l.box)).toEqual([{ x0: 10, y0: 5, x1: 50, y1: 20 }, { x0: 100, y0: 60, x1: 180, y1: 75 }]);
  });

  // The PIPE1 review: an already-aborted signal fires no `abort`, so a reading stopped while it waited posted a whole page.
  it('posts nothing for a reading already stopped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    vi.stubGlobal('navigator', { hardwareConcurrency: 3 });
    const posted: unknown[] = [];
    class FakeWorker extends EventTarget {
      postMessage(request: unknown) {
        posted.push(request);
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    const source = page(200, 100);
    const input = { width: 200, height: 100, getContext: () => ({ getImageData: () => ({ data: source.rgba }) }) } as unknown as HTMLCanvasElement;
    const { readWithPaddle } = await import('./paddle');
    const stop = new AbortController();
    stop.abort();
    await expect(readWithPaddle(input, { width: 200, height: 100, dpi: null }, 1, { signal: stop.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(posted).toEqual([]);
  });
});
