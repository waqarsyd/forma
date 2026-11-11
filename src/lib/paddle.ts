/**
 * PaddleOCR's side of reading a picture (2026-11-10, the AI accuracy
 * programme, batch AC): whether this site serves its models, and a page read
 * by them in workers (lib/paddleWorker.ts, steps in lib/paddleOcr.ts).
 * lib/ocr.ts decides when it reads and when Tesseract does.
 */
import { PADDLE_ASSET_BASE } from './assetPaths';
import type { OcrLine } from './ocr';
import { MIN_READ_SHARE, pageFromRegions, readShare, readingOrder, type PaddlePage } from './paddleOcr';
import type { PaddleReply, PaddleRequest } from './paddleWorker';
import type { PixelBox } from './reportGeometry';

const PADDLE_BASE = PADDLE_ASSET_BASE;

let served: Promise<boolean> | null = null;

/**
 * Whether this site serves PaddleOCR's models, which a build without
 * `npm run fetch:paddle` does not (vite.config.ts). Asked once per page load,
 * of the recogniser's small settings file. Anything but HTML counts: a site
 * that rewrites every unknown path to its index, as the hosted one does,
 * answers a missing file with HTML and a 200.
 */
export function paddleServed(): Promise<boolean> {
  served ??= fetch(`${PADDLE_BASE}rec-en.yml`, { method: 'HEAD' })
    .then((r) => r.ok && !/html/i.test(r.headers.get('content-type') ?? ''))
    .catch(() => false);
  return served;
}

/**
 * How many workers read a page's regions at once: one fewer than the
 * machine's cores, at most four, at least one. Each runs ONNX Runtime on one
 * thread with its own copy of the recogniser (7.8 MB) and its runtime. One
 * alone on a machine with 4 GB or less (2026-11-11, the full audit's PR-16),
 * as `navigator.deviceMemory` says, where four copies of both were what a
 * phone's tab was closed over.
 */
export function poolSize(cores: number | undefined, memoryGb?: number): number {
  if (memoryGb !== undefined && memoryGb <= 4) return 1;
  return Math.max(1, Math.min(4, (cores || 2) - 1));
}

/**
 * The regions shared out among `n` workers, each region to whichever has the
 * least to read so far, widest first: a region costs about its width at the
 * recogniser's height. Indices into `boxes`.
 */
export function shareRegions(boxes: readonly PixelBox[], n: number): number[][] {
  const groups: number[][] = Array.from({ length: n }, () => []);
  const load = new Array<number>(n).fill(0);
  const cost = (b: PixelBox) => Math.max(320, (48 * (b.x1 - b.x0)) / Math.max(1, b.y1 - b.y0));
  const order = boxes.map((b, i) => ({ i, c: cost(b) })).sort((a, b) => b.c - a.c);
  for (const { i, c } of order) {
    let k = 0;
    for (let j = 1; j < n; j++) if (load[j] < load[k]) k = j;
    groups[k].push(i);
    load[k] += c;
  }
  return groups;
}

let workers: Worker[] = [];
let nextId = 0;

/** End a reading in progress, for a stopped run; the next reading starts the workers again. */
export function stopPaddle(): void {
  for (const w of workers) w.terminate();
  workers = [];
}

function pool(n: number): Worker[] {
  while (workers.length < n) workers.push(new Worker(new URL('./paddleWorker.ts', import.meta.url), { type: 'module' }));
  return workers.slice(0, n);
}

type Payload = { op: 'detect' } | { op: 'recognize'; boxes: PixelBox[] };
type Picture = { rgba: Uint8ClampedArray; width: number; height: number };

/** A group's regions cut out of the page and stacked, with where each came from. */
export interface StackedRegions extends Picture {
  /** Each region's box on the stack, in the order given. */
  boxes: PixelBox[];
  /** What to add to a box on the stack to put it back on the page. */
  offsets: { dx: number; dy: number }[];
}

/**
 * The regions one worker reads, cut out of the page and stacked one above
 * another (2026-11-11, the full audit's PR-16 and PL-28). Every worker was
 * sent the whole page, a structured copy each: a 2,400 x 1,500 screenshot is
 * 14 MB of RGBA, so four workers held four copies and their RGB conversions,
 * and the main thread a fifth, to read a few strips of it each.
 *
 * Each region is cut as `cropRgb` in lib/paddleOcr.ts cuts it (floor and
 * ceiling of its box, clamped to the page) and placed at a whole row of the
 * stack, so the worker's own cut of each box on the stack is the same pixels
 * it would have cut from the page, and a line read there differs from one
 * read on the page only by `offsets`.
 */
export function stackRegions(picture: Picture, boxes: readonly PixelBox[]): StackedRegions {
  const cuts = boxes.map((b) => {
    const x0 = Math.max(0, Math.min(picture.width - 1, Math.floor(b.x0)));
    const y0 = Math.max(0, Math.min(picture.height - 1, Math.floor(b.y0)));
    const x1 = Math.max(x0 + 1, Math.min(picture.width, Math.ceil(b.x1)));
    const y1 = Math.max(y0 + 1, Math.min(picture.height, Math.ceil(b.y1)));
    return { x0, y0, w: x1 - x0, h: y1 - y0 };
  });
  const width = Math.max(1, ...cuts.map((c) => c.w));
  const height = Math.max(1, cuts.reduce((sum, c) => sum + c.h, 0));
  const rgba = new Uint8ClampedArray(width * height * 4);
  const out: PixelBox[] = [];
  const offsets: { dx: number; dy: number }[] = [];
  let top = 0;
  cuts.forEach((c, i) => {
    for (let y = 0; y < c.h; y++) {
      const from = ((c.y0 + y) * picture.width + c.x0) * 4;
      rgba.set(picture.rgba.subarray(from, from + c.w * 4), (top + y) * width * 4);
    }
    const b = boxes[i];
    out.push({ x0: b.x0 - c.x0, y0: b.y0 - c.y0 + top, x1: b.x1 - c.x0, y1: b.y1 - c.y0 + top });
    offsets.push({ dx: c.x0, dy: c.y0 - top });
    top += c.h;
  });
  return { rgba, width, height, boxes: out, offsets };
}

/** A line read on the stack, put back where it is on the page. */
export function unstacked(line: OcrLine | null, offset: { dx: number; dy: number }): OcrLine | null {
  if (!line) return null;
  const move = (b: PixelBox): PixelBox => ({ x0: b.x0 + offset.dx, y0: b.y0 + offset.dy, x1: b.x1 + offset.dx, y1: b.y1 + offset.dy });
  return { ...line, box: move(line.box), words: line.words.map((w) => ({ ...w, box: move(w.box) })) };
}

/**
 * One request to one worker, its progress reported, ended by `signal`. The
 * picture's bytes are transferred, not copied (PR-16): the caller gives a
 * buffer of its own for each request and does not read it after.
 */
function ask<T>(w: Worker, payload: Payload, picture: Picture, signal: AbortSignal | undefined, onProgress: (fraction: number) => void, take: (reply: PaddleReply) => T | undefined): Promise<T> {
  const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
    // A signal already aborted fires no `abort`: a reading stopped while it
    // waited would otherwise post a whole page to the next reading's workers
    // and report its progress as that reading's (the PIPE1 review).
    if (signal?.aborted) {
      reject(new DOMException('OCR was stopped.', 'AbortError'));
      return;
    }
    const done = () => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onMessage = (event: MessageEvent<PaddleReply>) => {
      const reply = event.data;
      if (reply.id !== id) return;
      if ('progress' in reply) return onProgress(reply.progress);
      done();
      if ('error' in reply) return reject(new Error(reply.error));
      const value = take(reply);
      if (value === undefined) reject(new Error('PaddleOCR answered with something else.'));
      else resolve(value);
    };
    const onError = (event: ErrorEvent) => {
      done();
      stopPaddle();
      reject(new Error(event.message || 'PaddleOCR could not start.'));
    };
    const onAbort = () => {
      done();
      stopPaddle();
      reject(new DOMException('OCR was stopped.', 'AbortError'));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    const request: PaddleRequest = { id, base: PADDLE_BASE, ...picture, ...payload };
    w.postMessage(request, [picture.rgba.buffer]);
  });
}

/**
 * Read `input`, a picture of a page drawn `scale` times its size, with
 * PaddleOCR, as an `OcrPage` of `image`'s own size: boxes divided back by
 * `scale`, as Tesseract's are. One worker finds the regions; then they are
 * shared out among the pool (`shareRegions`) and put back in reading order.
 */
export async function readWithPaddle(
  input: HTMLCanvasElement,
  image: { width: number; height: number; dpi: number | null },
  scale: number,
  options: { onProgress?: (status: string, progress: number) => void; signal?: AbortSignal } = {},
): Promise<PaddlePage> {
  const picture = { rgba: input.getContext('2d')!.getImageData(0, 0, input.width, input.height).data, width: input.width, height: input.height };
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number });
  const team = pool(poolSize(nav?.hardwareConcurrency, nav?.deviceMemory));
  options.onProgress?.('finding the text', 0);
  // A copy for the detector, transferred; the page itself stays here for the cuts below.
  const found = await ask(team[0], { op: 'detect' }, { ...picture, rgba: picture.rgba.slice() }, options.signal, () => undefined, (r) => ('boxes' in r ? r.boxes : undefined));
  const boxes = readingOrder(found);
  const groups = shareRegions(boxes, team.length).filter((g) => g.length);
  // Each worker its own regions, cut out and stacked (stackRegions), not the page.
  const stacks = groups.map((g) => stackRegions(picture, g.map((i) => boxes[i])));
  const progress = new Array<number>(groups.length).fill(0);
  const report = () => options.onProgress?.('recognizing text', progress.reduce((a, p, k) => a + p * groups[k].length, 0) / Math.max(1, boxes.length));
  const read = await Promise.all(
    stacks.map((s, k) =>
      ask(team[k], { op: 'recognize', boxes: s.boxes }, { rgba: s.rgba, width: s.width, height: s.height }, options.signal, (p) => {
        progress[k] = p;
        report();
      }, (r) => ('lines' in r ? r.lines : undefined)),
    ),
  );
  const lines: (OcrLine | null)[] = new Array<OcrLine | null>(boxes.length).fill(null);
  groups.forEach((g, k) => g.forEach((i, n) => (lines[i] = unstacked(read[k][n] ?? null, stacks[k].offsets[n]))));
  return scaled(pageFromRegions(picture, image.dpi, boxes, lines), image, scale);
}

/** A page read at `scale` times the picture's size, at the picture's own size. */
export function scaled(page: PaddlePage, image: { width: number; height: number }, scale: number): PaddlePage {
  if (scale === 1) return page;
  const box = (b: { x0: number; y0: number; x1: number; y1: number }) => ({ x0: b.x0 / scale, y0: b.y0 / scale, x1: b.x1 / scale, y1: b.y1 / scale });
  return {
    ...page,
    width: image.width,
    height: image.height,
    lines: page.lines.map((l) => ({ ...l, box: box(l.box), words: l.words.map((w) => ({ ...w, box: box(w.box) })) })),
  };
}

/** Whether PaddleOCR read enough of the page's text regions for the page to be in its recogniser's script (`MIN_READ_SHARE`). */
export function inItsScript(page: PaddlePage): boolean {
  return readShare(page) >= MIN_READ_SHARE;
}
