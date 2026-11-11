/**
 * Turning library chunks into vectors, with the user's own key.
 *
 * Milestone 4 of `docs/proposals/rag.md`. The one part of this feature that leaves
 * the browser, and it leaves it the same way everything else here does: the app
 * owns no key, the user supplies theirs, and the request goes straight to Google
 * from the page. `https://generativelanguage.googleapis.com` is already in
 * `CONNECT_SRC` in `src/server/securityHeaders.ts`, so this adds no origin and is
 * not a change to the app's security claim.
 *
 * ## The model is discovered, never named here
 *
 * `docs/notes/gemini.md` records why generation detects its model at runtime: a
 * hardcoded id goes stale and fails as a 404 that reads like a broken app.
 * Embedding has the same problem and a worse consequence — a wrong id there
 * fails a whole import rather than one request. So `embeddingFromCatalog` asks the
 * catalogue which embedding models this key can call, exactly as
 * `usableFromCatalog` does for generation, and the first workable answer wins.
 *
 * **Whichever model answered is recorded on every vector it produced.**
 * `embedStore.searchable()` compares on it, so the day the catalogue's answer
 * changes the library reports itself as needing re-embedding instead of silently
 * comparing two spaces. That is the whole reason this returns the model alongside
 * the vectors rather than just the vectors.
 *
 * ## What is embedded is the caption, not the XML
 *
 * `repxChunks.ts` writes a caption for each fragment — *"label in the page footer:
 * Arial 8.75pt, middle right aligned"* — and that is what goes to the embedding
 * model. Angle brackets embed badly: two controls differing only in their
 * `LocationFloat` are near-identical as XML and describe different things, while
 * the captions say what each one *is*. The XML stays as the payload retrieval
 * returns, and never becomes the thing it is found by.
 *
 * ## Batching, and a number that is guessed rather than measured
 *
 * `BATCH_SIZE` is deliberately conservative. The real per-request ceiling was not
 * measured — it is a property of the endpoint rather than of this code, and
 * discovering it costs the user's quota — so this sends small batches and treats a
 * rejected one as a reason to split rather than to fail. **If a batch is refused
 * for being too large, the halving retry below absorbs it**, which is why the
 * exact ceiling never needed to be known. Raise the constant only with a
 * measurement, and remember 341 chunks is an entire real library: this is not a
 * throughput problem.
 *
 * ## A partial result is a success
 *
 * The caller is `embedStore.withVectors`, which attaches by id and leaves the rest
 * pending. So a run that embeds 300 of 341 chunks is not a failure to be rolled
 * back — it is 300 chunks that never need embedding again. Only a total failure,
 * where nothing was obtained and the reason will not change on retry, throws.
 */
import { loadGenAI } from '../lib/genai';
import { classifyGeminiError } from '../lib/geminiErrors';
import { embeddingFromCatalog, type CatalogEntry } from '../lib/modelCatalog';
import type { LibraryEntry } from '../lib/embedStore';

/** How many chunks go in one request. See the header before raising it. */
export const BATCH_SIZE = 32;

/** The smallest batch worth splitting to. Below this a failure is a real failure. */
const MIN_BATCH = 1;

export interface EmbedResult {
  /** Chunk id to vector, for `withVectors`. Absent ids stay pending. */
  vectors: Map<string, Float32Array>;
  /** The model that produced them, to record alongside. */
  model: string;
  /** How many chunks were asked for but not returned. */
  missing: number;
}

export interface EmbedOptions {
  apiKey: string;
  /** Skip discovery and use this model. For a caller that already resolved one. */
  model?: string;
  /** Progress, for an import of a few hundred chunks. */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Which embedding model this key can call.
 *
 * Reads the same catalogue endpoint generation uses. A key that cannot list models
 * cannot embed either, so the failure is reported rather than guessed around.
 */
export async function resolveEmbeddingModel(apiKey: string, signal?: AbortSignal): Promise<string> {
  let entries: CatalogEntry[] | undefined;
  try {
    // The key in the x-goog-api-key header, as geminiService's catalogue read
    // sends it (2026-11-11, the full audit, SE-11): it was in the query
    // string, which puts it in the console's network log, in screenshots of
    // that log and in any proxy's access log. pageSize as that read asks too,
    // so an embedding model past the first page of 50 is still found.
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': apiKey },
      signal,
    });
    if (!response.ok) throw new Error(`The model catalogue could not be read (HTTP ${response.status}).`);
    const body = (await response.json()) as { models?: CatalogEntry[] };
    entries = body.models;
  } catch (error) {
    if (signal?.aborted) throw error;
    throw classifyGeminiError(error);
  }

  const [model] = embeddingFromCatalog(entries);
  if (!model) {
    throw new Error(
      'This key cannot call any embedding model, so a report library cannot be built with it. ' +
        'Check the key has the Generative Language API enabled.',
    );
  }
  return model;
}

/**
 * Embed a handful of plain texts — the query side of retrieval.
 *
 * Separate from `embedEntries` because the two have opposite shapes and opposite
 * failure rules. That one embeds hundreds of library chunks, keys them by id and
 * treats a partial result as a success. This embeds the six-or-fewer queries of one
 * refine, keys them by position, and has nothing useful to return if any are
 * missing: a search needs its query vector or there is no search.
 *
 * One request, no halving. Six short captions are not a batch-size problem, and a
 * failure here is a failed refine rather than a partly-built library.
 */
export async function embedTexts(
  texts: readonly string[],
  options: EmbedOptions,
): Promise<{ vectors: Float32Array[]; model: string }> {
  if (texts.length === 0) return { vectors: [], model: options.model ?? '' };

  const model = options.model ?? (await resolveEmbeddingModel(options.apiKey, options.signal));
  const { GoogleGenAI } = await loadGenAI();
  const ai = new GoogleGenAI({ apiKey: options.apiKey });

  let response: { embeddings?: { values?: number[] }[] };
  try {
    response = (await ai.models.embedContent({ model, contents: texts.slice() })) as typeof response;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw classifyGeminiError(error);
  }

  const embeddings = response.embeddings ?? [];
  if (embeddings.length !== texts.length) {
    throw new Error('The embedding service answered with a different number of vectors than it was asked for.');
  }

  const vectors = embeddings.map((embedding) => {
    const values = embedding?.values;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error('The embedding service returned an empty vector for a query.');
    }
    return Float32Array.from(values);
  });

  return { vectors, model };
}

/** One request. Separated so the halving retry has something to call. */
async function embedBatch(
  ai: { models: { embedContent: (params: unknown) => Promise<unknown> } },
  model: string,
  batch: readonly LibraryEntry[],
): Promise<Map<string, Float32Array>> {
  const response = (await ai.models.embedContent({
    model,
    contents: batch.map((entry) => entry.chunk.caption),
  })) as { embeddings?: { values?: number[] }[] };

  const out = new Map<string, Float32Array>();
  const embeddings = response.embeddings ?? [];

  // Position is the only thing tying a returned embedding to its input, so a
  // response of a different length cannot be trusted to line up -- taking the
  // first N would attach vectors to the wrong chunks, and nothing downstream
  // could tell. Treat it as a batch that produced nothing.
  if (embeddings.length !== batch.length) return out;

  for (let i = 0; i < batch.length; i++) {
    const values = embeddings[i]?.values;
    if (Array.isArray(values) && values.length > 0) {
      out.set(batch[i].id, Float32Array.from(values));
    }
  }
  return out;
}

/**
 * Embed a set of library entries.
 *
 * Returns what it got. A batch that fails is halved and retried; a single chunk
 * that still fails is skipped, because one unembeddable fragment must not cost the
 * other three hundred. If nothing at all came back, the underlying error is thrown
 * rather than an empty success — an import that silently embedded nothing looks
 * exactly like one that worked.
 */
export async function embedEntries(
  entries: readonly LibraryEntry[],
  options: EmbedOptions,
): Promise<EmbedResult> {
  const vectors = new Map<string, Float32Array>();
  if (entries.length === 0) return { vectors, model: options.model ?? '', missing: 0 };

  const model = options.model ?? (await resolveEmbeddingModel(options.apiKey, options.signal));
  const { GoogleGenAI } = await loadGenAI();
  const ai = new GoogleGenAI({ apiKey: options.apiKey });

  let firstError: unknown = null;
  let done = 0;

  const run = async (batch: readonly LibraryEntry[]): Promise<void> => {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
      const got = await embedBatch(ai as never, model, batch);
      for (const [id, vector] of got) vectors.set(id, vector);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      firstError ??= error;
      if (batch.length > MIN_BATCH) {
        const half = Math.ceil(batch.length / 2);
        await run(batch.slice(0, half));
        await run(batch.slice(half));
        return;
      }
      // A single chunk that will not embed is skipped, not fatal.
    }

    done += batch.length;
    options.onProgress?.(Math.min(done, entries.length), entries.length);
  };

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    await run(entries.slice(i, i + BATCH_SIZE));
  }

  if (vectors.size === 0 && firstError) throw classifyGeminiError(firstError);

  return { vectors, model, missing: entries.length - vectors.size };
}
