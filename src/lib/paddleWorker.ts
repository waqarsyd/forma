/**
 * PaddleOCR in a worker (2026-11-10, the AI accuracy programme, batch AC), so
 * the page stays responsive while the models run and a stopped reading can be
 * ended by terminating it (lib/paddle.ts). The steps are lib/paddleOcr.ts's.
 *
 * A worker does one of two things when asked: find a page's text regions, or
 * read some of them. lib/paddle.ts asks one worker for the regions and shares
 * the reading among several, because ONNX Runtime has one thread here (threads
 * need a cross-origin isolated page, which Forma's is not: Google's sign-in
 * pop-up needs the opener policy that rules it out), and reading the regions
 * is most of the time: 11 of 15.7 seconds on one thread for a 2,400 x 1,500
 * screenshot, measured 2026-11-10. Each worker loads only the model it uses.
 *
 * Everything comes from this site: the models from `/paddle/<version>/`, and
 * ONNX Runtime's glue and WebAssembly from the build's own assets.
 *
 * ONNX Runtime's CPU-only build since 2026-11-12, not the JSEP one handwriting
 * uses. They shared one copy until then, but onnxruntime-web 1.31 (with
 * Transformers.js 4) grew the JSEP WebAssembly from 21.6 to 28.4 MB, and
 * PaddleOCR runs on the CPU (`executionProviders: ['wasm']`): JSEP adds only
 * WebGPU and WebNN, which it never asks for. The plain build is 14.3 MB, so a
 * first English picture now downloads half what it did, and a deploy without
 * handwriting, the usual one, ships only this. A handwriting build ships both.
 */
// The package's own declaration of the module, which its package.json exports
// do not reach under "bundler" resolution.
/// <reference path="../../node_modules/onnxruntime-web/types.d.ts" />
import * as ort from 'onnxruntime-web/wasm';
import ortMjs from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import ortWasm from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import type { OcrLine } from './ocr';
import { characterDict, DETECT_LONG_SIDE, detectRegions, RECOGNIZE_MIN_WIDTH, recognizeRegions, rgbFromRgba, type OrtSessionLike } from './paddleOcr';
import type { PixelBox } from './reportGeometry';


/** A page to find the regions of, or regions of it to read; the picture as a canvas's RGBA bytes. */
export type PaddleRequest = {
  id: number;
  base: string;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
} & ({ op: 'detect' } | { op: 'recognize'; boxes: PixelBox[] });

/** The worker's answers: progress through its regions, the regions found, the regions read, or why not. */
export type PaddleReply =
  | { id: number; progress: number }
  | { id: number; boxes: PixelBox[] }
  | { id: number; lines: (OcrLine | null)[] }
  | { id: number; error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PaddleRequest>) => void) | null;
  postMessage(reply: PaddleReply): void;
};

const tensor = (data: Float32Array, dims: number[]) => new ort.Tensor('float32', data, dims);
const sessions = new Map<string, Promise<OrtSessionLike>>();
let dict: Promise<string[]> | null = null;

async function fetched(base: string, name: string): Promise<Response> {
  const res = await fetch(`${base}${name}`);
  if (!res.ok) throw new Error(`PaddleOCR's ${name} answered ${res.status}.`);
  return res;
}

/** A model's session, made once per worker. */
function session(base: string, name: string): Promise<OrtSessionLike> {
  let s = sessions.get(name);
  if (!s) {
    ort.env.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };
    ort.env.wasm.numThreads = 1;
    // Errors only (2026-11-12): at its default, warning, loading det.onnx printed
    // 108 "Removing initializer ... not used" notices from the graph optimizer
    // through console.error, a wall of red in DevTools on every page read that
    // hid any real error behind it. The notices change nothing about the reading.
    ort.env.logLevel = 'error';
    s = fetched(base, name)
      .then((r) => r.arrayBuffer())
      .then((bytes) => ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'], logSeverityLevel: 3 }))
      .then((made) => made as unknown as OrtSessionLike);
    s.catch(() => sessions.delete(name));
    sessions.set(name, s);
  }
  return s;
}

function characters(base: string): Promise<string[]> {
  if (!dict) {
    dict = fetched(base, 'rec-en.yml').then(async (r) => characterDict(await r.text()));
    dict.catch(() => {
      dict = null;
    });
  }
  return dict;
}

scope.onmessage = (event) => {
  const request = event.data;
  const { id, base } = request;
  void (async () => {
    try {
      const img = rgbFromRgba(request.rgba, request.width, request.height);
      if (request.op === 'detect') {
        scope.postMessage({ id, boxes: await detectRegions(await session(base, 'det.onnx'), img, tensor, DETECT_LONG_SIDE) });
      } else {
        const [rec, list] = await Promise.all([session(base, 'rec-en.onnx'), characters(base)]);
        scope.postMessage({ id, lines: await recognizeRegions(rec, list, img, request.boxes, tensor, (progress) => scope.postMessage({ id, progress }), RECOGNIZE_MIN_WIDTH) });
      }
    } catch (err) {
      scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  })();
};
