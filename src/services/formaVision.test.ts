import { afterEach, describe, expect, it, vi } from 'vitest';
import { VISION_INSTRUCTION } from '../lib/skeletonText';
import { imagePart, isFormaVisionModel, readSkeleton } from './formaVision';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const page = 'data:image/png;base64,iVBORw0KGgo=';

afterEach(() => vi.unstubAllGlobals());

describe('readSkeleton', () => {
  it('asks the local model exactly what it was trained on: the picture, then the instruction, at temperature 0', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ choices: [{ message: { content: 'page A4 portrait 827 1169 50 50 50 50\nband Detail 20 0' }, finish_reason: 'stop' }] }));
    vi.stubGlobal('fetch', fetch);
    await readSkeleton({ baseUrl: 'http://localhost:11434/v1/', model: 'forma-vision' }, page);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'forma-vision', temperature: 0, max_tokens: 4096 });
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: page } },
          { type: 'text', text: VISION_INSTRUCTION },
        ],
      },
    ]);
  });

  it('reads the answer as a skeleton, keeping the text as written', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ choices: [{ message: { content: 'page A4 portrait 827 1169 50 50 50 50\nband Detail 20 0\nwobble' } }] })));
    const read = await readSkeleton({ baseUrl: 'http://localhost:1234/v1', model: 'forma-vision-q8' }, page);
    expect(read.skeleton?.bands.map((b) => b.kind)).toEqual(['Detail']);
    expect(read.problems).toEqual(['line 3: not understood']);
    expect(read.text).toContain('wobble');
  });

  it('refuses a page that is not an image before asking anything', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(readSkeleton({ baseUrl: 'http://localhost:11434/v1', model: 'forma-vision' }, 'not a data url')).rejects.toThrow(/not an image/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('isFormaVisionModel and imagePart', () => {
  it("knows Forma's model by the name it was imported under", () => {
    expect(isFormaVisionModel('forma-vision')).toBe(true);
    expect(isFormaVisionModel('waqarsayyed/Forma-Vision-Q8_0')).toBe(true);
    expect(isFormaVisionModel('qwen3.5:2b')).toBe(false);
    expect(isFormaVisionModel(undefined)).toBe(false);
  });

  it("splits a data URL into the image's type and bytes", () => {
    expect(imagePart(page)).toEqual({ mimeType: 'image/png', data: 'iVBORw0KGgo=' });
    expect(imagePart('https://example.com/a.png')).toBeNull();
  });
});
