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
import { GEMINI_BASE_URL, geminiClientOptions } from '../lib/genai';

const here = fileURLToPath(new URL('.', import.meta.url));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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

  /*
   * 2026-11-23, the MCP design audit's SEC-1: the SDK's Node build reads where
   * to send a request from the environment even when a key is passed, and in
   * Node no connect-src stands behind it. Every client is built with
   * geminiClientOptions, and those options must win over every variable.
   */
  it("goes only to Gemini's own address, whatever the environment says", async () => {
    const { GoogleGenAI } = await import('@google/genai');
    type Client = { apiClient: { getBaseUrl(): string; getApiVersion(): string } };
    vi.unstubAllEnvs();
    const plain = (new GoogleGenAI({ apiKey: 'not-a-key' }) as unknown as Client).apiClient;
    // The options are the SDK's own defaults, so the browser's requests do not move.
    expect([plain.getBaseUrl(), plain.getApiVersion()]).toEqual([GEMINI_BASE_URL, geminiClientOptions('x').apiVersion]);
    vi.stubEnv('GOOGLE_GEMINI_BASE_URL', 'https://elsewhere.example/');
    vi.stubEnv('GOOGLE_VERTEX_BASE_URL', 'https://elsewhere.example/');
    vi.stubEnv('GOOGLE_GENAI_USE_VERTEXAI', 'true');
    vi.stubEnv('GOOGLE_GENAI_USE_ENTERPRISE', 'true');
    vi.stubEnv('GOOGLE_GENAI_API_VERSION', 'v9');
    const ai = new GoogleGenAI(geminiClientOptions('not-a-key'));
    expect(ai.vertexai).toBe(false);
    const client = (ai as unknown as Client).apiClient;
    expect(client.getBaseUrl()).toBe(GEMINI_BASE_URL);
    expect(client.getApiVersion()).toBe('v1');
  });

  it('is never handed to a Gemini client built without those options, anywhere in src or scripts', () => {
    const root = join(here, '..', '..');
    const sources = ['src', 'scripts'].flatMap((dir) =>
      (readdirSync(join(root, dir), { recursive: true }) as string[])
        .map((name) => join(dir, name))
        .filter((name) => /\.(tsx?|mjs|js)$/.test(name) && !/\.test\.tsx?$/.test(name)),
    );
    expect(sources.length).toBeGreaterThan(50);
    const offenders = sources.flatMap((name) => {
      const src = readFileSync(join(root, name), 'utf8');
      return [...src.matchAll(/GoogleGenAI\s*\(/g)]
        .filter((m) => !/^\s*geminiClientOptions\(/.test(src.slice((m.index ?? 0) + m[0].length)))
        .map(() => name);
    });
    expect(offenders).toEqual([]);
  });
});
