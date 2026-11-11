/**
 * The user's Gemini key travels in a header, never in a URL (2026-11-11, the
 * full audit, SE-11). The report library's catalogue read put it in the query
 * string, so it sat in the browser's network log, in any screenshot of that
 * log attached to a bug report, and in a proxy's access log, while every other
 * call in this folder sent it as `x-goog-api-key`. Nothing caught it because
 * nothing reads a request's URL; this does, for every service file, and checks
 * the one call that was wrong now sends the header.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveEmbeddingModel } from './embeddings';

const here = fileURLToPath(new URL('.', import.meta.url));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Gemini key in a request', () => {
  it('is never written into a URL in src/services', () => {
    const files = readdirSync(here).filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name));
    expect(files.length).toBeGreaterThan(3);
    const offenders = files.filter((name) => /https?:\/\/[^\s'"`]*[?&]key=/.test(readFileSync(join(here, name), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('goes to the embedding catalogue as x-goog-api-key', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ models: [{ name: 'models/text-embedding-x', supportedGenerationMethods: ['embedContent'] }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await resolveEmbeddingModel('AIza-test-key');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain('AIza-test-key');
    expect(url).not.toMatch(/[?&]key=/);
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-test-key');
  });
});
