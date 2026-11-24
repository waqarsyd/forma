/**
 * PaddleOCR's Node reader (2026-11-24, the MCP work's wave 7, NODE-5): the
 * one the MCP server and the measuring scripts share. Its pins are held to
 * scripts/fetch-paddle.mjs's, the models are refused unless each is the
 * pinned file, and a picture is read as the app reads it. The reader is
 * stood in for; the real models are read by nodeMakeReport.test.ts where
 * vendor/paddle holds them.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PaddlePage, PaddleReader, Rgb } from '../lib/paddleOcr';
import { CLONE } from './nodeGeneration';
import { PADDLE_PINS, pinnedModelsIn, readAsTheApp } from './nodePaddle';

const folders: string[] = [];
afterEach(() => {
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
});

describe("PaddleOCR's models in Node", () => {
  it('pins each model to the SHA-256 npm run fetch:paddle pins it to', () => {
    const script = readFileSync(join(CLONE, 'scripts', 'fetch-paddle.mjs'), 'utf8');
    const pinned = Object.fromEntries([...script.matchAll(/'([\w.-]+)': \[[^\]]*'([0-9a-f]{64})'\]/g)].map((m) => [m[1], m[2]]));
    expect(pinned).toEqual(PADDLE_PINS);
  });

  it('reads with them only when every one is there and is the pinned file', () => {
    const folder = mkdtempSync(join(tmpdir(), 'forma-paddle-'));
    folders.push(folder);
    expect(pinnedModelsIn(folder)).toEqual({ ok: false, why: `det.onnx is not in ${folder}` });
    for (const name of Object.keys(PADDLE_PINS)) writeFileSync(join(folder, name), 'not the model');
    const refused = pinnedModelsIn(folder);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.why).toMatch(/^det\.onnx in .* is not the pinned file \(SHA-256 [0-9a-f]{64}\)$/);
  });
});

describe('a picture read as the app reads it', () => {
  /** A reader that says what size it was handed, as one line across the picture. */
  const sizing: PaddleReader & { sizes: number[][] } = {
    sizes: [],
    async read(img: Rgb): Promise<PaddlePage> {
      this.sizes.push([img.width, img.height]);
      const box = { x0: 0, y0: 0, x1: img.width, y1: img.height };
      return { width: img.width, height: img.height, dpi: null, detected: 1, lines: [{ text: 'Total', confidence: 99, box, words: [{ text: 'Total', confidence: 99, box }] }] };
    },
  };
  const rgb = (width: number, height: number): Rgb => ({ width, height, data: new Uint8Array(width * height * 3).fill(255) });

  it('draws a picture narrower than 1,600 pixels at twice its size, and brings the boxes back to it', async () => {
    const page = await readAsTheApp(sizing, rgb(800, 600));
    expect(sizing.sizes.pop()).toEqual([1600, 1200]);
    expect([page.width, page.height]).toEqual([800, 600]);
    expect(page.lines[0].box).toEqual({ x0: 0, y0: 0, x1: 800, y1: 600 });
  });

  it('reads a wider one at its own size', async () => {
    const page = await readAsTheApp(sizing, rgb(2000, 1000));
    expect(sizing.sizes.pop()).toEqual([2000, 1000]);
    expect(page.lines[0].box).toEqual({ x0: 0, y0: 0, x1: 2000, y1: 1000 });
  });
});
