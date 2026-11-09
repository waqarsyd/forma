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

export const PADDLE_BASE = PADDLE_ASSET_BASE;

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
 * thread with its own copy of the recogniser (7.8 MB).
 */
export function poolSize(cores: number | undefined): number {
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

/** One request to one worker, its progress reported, ended by `signal`. */
function ask<T>(w: Worker, payload: Payload, picture: { rgba: Uint8ClampedArray; width: number; height: number }, signal: AbortSignal | undefined, onProgress: (fraction: number) => void, take: (reply: PaddleReply) => T | undefined): Promise<T> {
  const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
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
    w.postMessage(request);
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
  const team = pool(poolSize(typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency));
  options.onProgress?.('finding the text', 0);
  const found = await ask(team[0], { op: 'detect' }, picture, options.signal, () => undefined, (r) => ('boxes' in r ? r.boxes : undefined));
  const boxes = readingOrder(found);
  const groups = shareRegions(boxes, team.length).filter((g) => g.length);
  const progress = new Array<number>(groups.length).fill(0);
  const report = () => options.onProgress?.('recognizing text', progress.reduce((a, p, k) => a + p * groups[k].length, 0) / Math.max(1, boxes.length));
  const read = await Promise.all(
    groups.map((g, k) =>
      ask(team[k], { op: 'recognize', boxes: g.map((i) => boxes[i]) }, picture, options.signal, (p) => {
        progress[k] = p;
        report();
      }, (r) => ('lines' in r ? r.lines : undefined)),
    ),
  );
  const lines: (OcrLine | null)[] = new Array<OcrLine | null>(boxes.length).fill(null);
  groups.forEach((g, k) => g.forEach((i, n) => (lines[i] = read[k][n] ?? null)));
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
