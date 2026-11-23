/**
 * The cases that matter are the ones that would corrupt a stored library rather
 * than fail visibly.
 *
 * **A response of the wrong length**, because position is the only thing tying an
 * embedding to its input: taking the first N would attach vectors to the wrong
 * chunks permanently, and nothing downstream could tell.
 *
 * **A partial result being a success**, because `withVectors` attaches by id and
 * leaves the rest pending — rolling back 300 good vectors over 41 bad ones would
 * spend the user's quota again for nothing.
 *
 * As elsewhere in this suite the loops sit inside a single case, so the grep and the
 * run agree.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { embedEntries, embedTexts, resolveEmbeddingModel, BATCH_SIZE } from './embeddings';
import { addChunks, withVectors, searchable, entriesToEmbed, type LibraryEntry } from '../lib/embedStore';
import type { RepxChunk } from '../lib/repxChunks';

const embedContent = vi.fn();

vi.mock('../lib/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/genai')>()),
  loadGenAI: async () => ({
    GoogleGenAI: class {
      models = { embedContent };
    },
  }),
}));

const chunk = (caption: string, xml = `<Item1 ControlType="XRLabel" />${caption}`): RepxChunk => ({
  kind: 'control',
  controlType: 'XRLabel',
  band: 'DetailBand',
  caption,
  xml,
  source: 'a.repx',
  redacted: 0,
  start: 0,
});

const library = (n: number): LibraryEntry[] =>
  addChunks([], Array.from({ length: n }, (_, i) => chunk(`caption ${i}`))).entries;

/** A response shaped like the SDK's, with one vector per input. */
const answers = (count: number, dims = 3) => ({
  embeddings: Array.from({ length: count }, (_, i) => ({ values: Array.from({ length: dims }, () => i + 1) })),
});

beforeEach(() => {
  embedContent.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-x', supportedGenerationMethods: ['embedContent'] },
        ],
      }),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveEmbeddingModel', () => {
  it('picks an embedding model from the catalogue rather than naming one', async () => {
    expect(await resolveEmbeddingModel('k')).toBe('text-embedding-x');
  });

  it('refuses when the key can call no embedding model, instead of guessing an id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }),
      })),
    );
    await expect(resolveEmbeddingModel('k')).rejects.toThrow(/cannot call any embedding model/);
  });

  it('reports a catalogue that cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })));
    await expect(resolveEmbeddingModel('k')).rejects.toThrow();
  });
});

describe('embedEntries', () => {
  it('returns nothing for nothing, without a network call', async () => {
    const result = await embedEntries([], { apiKey: 'k' });
    expect(result.vectors.size).toBe(0);
    expect(embedContent).not.toHaveBeenCalled();
  });

  it('embeds the caption, not the XML', async () => {
    embedContent.mockResolvedValue(answers(2));
    await embedEntries(library(2), { apiKey: 'k' });
    expect(embedContent.mock.calls[0][0].contents).toEqual(['caption 0', 'caption 1']);
  });

  it('records the model it used, which is what makes a model change a re-embed', async () => {
    embedContent.mockResolvedValue(answers(1));
    const result = await embedEntries(library(1), { apiKey: 'k' });
    expect(result.model).toBe('text-embedding-x');

    // Ids are content-derived, so the same chunk rebuilt gives the same id --
    // that is the dedup property, and it is what lets a vector attach at all.
    const entries = withVectors(library(1), result.vectors, result.model);
    expect(searchable(entries, 'text-embedding-x')).toHaveLength(1);
    expect(searchable(entries, 'another-model')).toHaveLength(0);
    expect(entriesToEmbed(entries, 'another-model')).toHaveLength(1);
  });

  it('keys vectors by chunk id, so withVectors can attach them', async () => {
    const entries = library(2);
    embedContent.mockResolvedValue(answers(2));
    const { vectors } = await embedEntries(entries, { apiKey: 'k' });

    expect([...vectors.keys()].sort()).toEqual(entries.map((e) => e.id).sort());
    const attached = withVectors(entries, vectors, 'text-embedding-x');
    expect(searchable(attached, 'text-embedding-x')).toHaveLength(2);
    expect(attached[0].vector).toBeInstanceOf(Float32Array);
  });

  it('splits into batches and reports progress', async () => {
    const entries = library(BATCH_SIZE + 5);
    embedContent.mockImplementation(async (params: { contents: string[] }) => answers(params.contents.length));
    const seen: number[] = [];

    const { vectors, missing } = await embedEntries(entries, { apiKey: 'k', onProgress: (d) => seen.push(d) });

    expect(embedContent).toHaveBeenCalledTimes(2);
    expect(vectors.size).toBe(entries.length);
    expect(missing).toBe(0);
    expect(seen[seen.length - 1]).toBe(entries.length);
  });

  it('discards a batch whose response length does not match the request', async () => {
    // Position is the only alignment there is. A short response must not be
    // treated as "the first two worked".
    embedContent.mockResolvedValue(answers(1));
    const { vectors, missing } = await embedEntries(library(2), { apiKey: 'k' });
    expect(vectors.size).toBe(0);
    expect(missing).toBe(2);
  });

  it('skips an embedding that came back empty rather than storing a zero vector', async () => {
    // A zero-length vector reads as "embedded" and scores 0 against everything.
    embedContent.mockResolvedValue({ embeddings: [{ values: [1, 2, 3] }, { values: [] }] });
    const { vectors, missing } = await embedEntries(library(2), { apiKey: 'k' });
    expect(vectors.size).toBe(1);
    expect(missing).toBe(1);
  });

  it('halves a failing batch instead of losing all of it', async () => {
    const entries = library(4);
    let call = 0;
    embedContent.mockImplementation(async (params: { contents: string[] }) => {
      call++;
      if (call === 1) throw new Error('batch too large');
      return answers(params.contents.length);
    });

    const { vectors, missing } = await embedEntries(entries, { apiKey: 'k' });
    expect(vectors.size).toBe(4);
    expect(missing).toBe(0);
    expect(embedContent.mock.calls.length).toBeGreaterThan(1);
  });

  it('skips one unembeddable chunk rather than failing the whole import', async () => {
    const entries = library(2);
    embedContent.mockImplementation(async (params: { contents: string[] }) => {
      if (params.contents.includes('caption 1')) throw new Error('nope');
      return answers(params.contents.length);
    });

    const { vectors, missing } = await embedEntries(entries, { apiKey: 'k' });
    expect(vectors.size).toBe(1);
    expect(missing).toBe(1);
  });

  it('throws when nothing at all came back, because a silent empty import looks like success', async () => {
    embedContent.mockRejectedValue(new Error('the key was rejected'));
    await expect(embedEntries(library(2), { apiKey: 'k' })).rejects.toThrow();
  });

  it('takes a caller-supplied model and skips discovery entirely', async () => {
    embedContent.mockResolvedValue(answers(1));
    const result = await embedEntries(library(1), { apiKey: 'k', model: 'given-model' });
    expect(result.model).toBe('given-model');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('embeds nothing and asks nothing when given no texts', async () => {
    const result = await embedTexts([], { apiKey: 'k' });
    expect(result.vectors).toEqual([]);
    expect(embedContent).not.toHaveBeenCalled();
  });

  it('embeds queries in one request, keeping their order', async () => {
    embedContent.mockResolvedValue({ embeddings: [{ values: [1, 0] }, { values: [0, 1] }] });
    const { vectors, model } = await embedTexts(['first', 'second'], { apiKey: 'k' });

    expect(embedContent).toHaveBeenCalledTimes(1);
    expect(embedContent.mock.calls[0][0].contents).toEqual(['first', 'second']);
    expect(Array.from(vectors[0])).toEqual([1, 0]);
    expect(Array.from(vectors[1])).toEqual([0, 1]);
    expect(model).toBe('text-embedding-x');
  });

  it('throws on a length mismatch, unlike the library path which discards', async () => {
    // A search needs its query vector. There is no partial success to salvage.
    embedContent.mockResolvedValue(answers(1));
    await expect(embedTexts(['a', 'b'], { apiKey: 'k' })).rejects.toThrow(/different number of vectors/);
  });

  it('throws rather than returning an empty query vector', async () => {
    // An empty vector scores 0 against everything and would read as "no matches".
    embedContent.mockResolvedValue({ embeddings: [{ values: [] }] });
    await expect(embedTexts(['a'], { apiKey: 'k' })).rejects.toThrow(/empty vector/);
  });

  it('skips discovery when the caller already has a model', async () => {
    embedContent.mockResolvedValue(answers(1));
    await embedTexts(['a'], { apiKey: 'k', model: 'given' });
    expect(fetch).not.toHaveBeenCalled();
    expect(embedContent.mock.calls[0][0].model).toBe('given');
  });

  it('stops on an abort rather than working through the remaining batches', async () => {
    const controller = new AbortController();
    const entries = library(BATCH_SIZE * 2);
    embedContent.mockImplementation(async (params: { contents: string[] }) => {
      controller.abort();
      return answers(params.contents.length);
    });

    await expect(
      embedEntries(entries, { apiKey: 'k', model: 'given-model', signal: controller.signal }),
    ).rejects.toThrow();
    expect(embedContent).toHaveBeenCalledTimes(1);
  });
});
