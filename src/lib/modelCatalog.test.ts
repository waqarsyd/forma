import { describe, it, expect } from 'vitest';
import { usableFromCatalog, rankDiscovered, mergeCandidates, type CatalogEntry } from './modelCatalog';

/**
 * Both halves of this file fail *plausibly*. A filter that lets the wrong
 * family through sends a report generation to an embedding model; an order that
 * puts pro first silently spends the user's own money on the expensive tier for
 * every report. Neither throws, and neither is visible in the UI — the app just
 * quietly behaves worse or costs more.
 */
const entry = (name: string, methods: string[] = ['generateContent']): CatalogEntry => ({
  name: `models/${name}`,
  supportedGenerationMethods: methods,
});

describe('usableFromCatalog', () => {
  it('keeps gemini models that can generate content, without the models/ prefix', () => {
    expect(usableFromCatalog([entry('gemini-3-flash'), entry('gemini-3-pro')]))
      .toEqual(['gemini-3-flash', 'gemini-3-pro']);
  });

  it('drops families that cannot produce a report', () => {
    // Every one of these can appear with generateContent in supportedGenerationMethods.
    const catalogue = [
      entry('gemini-embedding-001'),
      entry('text-embedding-004'),
      entry('imagen-4.0-generate-001'),
      entry('veo-3.0-generate-001'),
      entry('gemini-2.5-flash-tts'),
      entry('gemma-3-27b-it'),
      entry('learnlm-2.0-flash'),
      entry('gemini-3-flash'),
    ];
    expect(usableFromCatalog(catalogue)).toEqual(['gemini-3-flash']);
  });

  it('drops experimental, preview and dated snapshots', () => {
    const catalogue = [
      entry('gemini-2.5-flash-exp'),
      entry('gemini-2.5-flash-preview-05-20'),
      entry('gemini-2.0-flash-exp-image-generation'),
      entry('gemini-2.5-flash'),
    ];
    expect(usableFromCatalog(catalogue)).toEqual(['gemini-2.5-flash']);
  });

  it('requires generateContent rather than assuming it', () => {
    // An entry that does not say gets no benefit of the doubt: a model admitted
    // wrongly does not cost a wasted probe, it becomes the model every
    // generation uses.
    expect(usableFromCatalog([entry('gemini-3-flash', ['embedContent'])])).toEqual([]);
    expect(usableFromCatalog([{ name: 'models/gemini-3-flash' }])).toEqual([]);
  });

  it('survives a response that is not the shape it expects', () => {
    expect(usableFromCatalog(undefined)).toEqual([]);
    expect(usableFromCatalog([])).toEqual([]);
    expect(usableFromCatalog([{}, { name: 'models/gemini-3-flash' }])).toEqual([]);
  });

  it('de-duplicates', () => {
    expect(usableFromCatalog([entry('gemini-3-flash'), entry('gemini-3-flash')]))
      .toEqual(['gemini-3-flash']);
  });
});

describe('rankDiscovered', () => {
  it('puts cheap tiers before expensive ones', () => {
    // The failure this guards: rank by recency alone and a brand-new pro model
    // leads the probe list, so the first key with pro access starts paying pro
    // prices for every report with nothing in the UI to say so.
    expect(rankDiscovered(['gemini-9-pro', 'gemini-2-flash'])).toEqual(['gemini-2-flash', 'gemini-9-pro']);
  });

  it('orders flash, then lite, then pro', () => {
    expect(rankDiscovered(['gemini-4-pro', 'gemini-4-flash-lite', 'gemini-4-flash']))
      .toEqual(['gemini-4-flash', 'gemini-4-flash-lite', 'gemini-4-pro']);
  });

  it('prefers the newer generation within a tier', () => {
    expect(rankDiscovered(['gemini-2.5-flash', 'gemini-4-flash', 'gemini-3.5-flash']))
      .toEqual(['gemini-4-flash', 'gemini-3.5-flash', 'gemini-2.5-flash']);
  });

  it('treats a -latest alias as the newest thing there is', () => {
    // It is the one id that cannot go stale: Google repoints it.
    expect(rankDiscovered(['gemini-7-flash', 'gemini-flash-latest']))
      .toEqual(['gemini-flash-latest', 'gemini-7-flash']);
  });

  it('is stable for names it cannot rank', () => {
    expect(rankDiscovered(['gemini-zeta', 'gemini-alpha'])).toEqual(['gemini-alpha', 'gemini-zeta']);
  });
});

describe('mergeCandidates', () => {
  const CURATED = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-pro-latest'];

  it('leaves the curated order exactly as it is', () => {
    // That order is measured and deliberate; discovery exists to extend the
    // list, never to reshuffle it.
    const merged = mergeCandidates(CURATED, ['gemini-4-flash']);
    expect(merged.slice(0, 3)).toEqual(CURATED);
  });

  it('appends models the curated list has never heard of', () => {
    expect(mergeCandidates(CURATED, ['gemini-4-pro', 'gemini-4-flash']))
      .toEqual([...CURATED, 'gemini-4-flash', 'gemini-4-pro']);
  });

  it('does not list a curated model twice', () => {
    const merged = mergeCandidates(CURATED, ['gemini-2.5-flash', 'gemini-4-flash']);
    expect(merged.filter((m) => m === 'gemini-2.5-flash')).toHaveLength(1);
  });

  it('caps the list, because every candidate is a live request', () => {
    const many = Array.from({ length: 30 }, (_, i) => `gemini-${i + 1}-flash`);
    expect(mergeCandidates(CURATED, many, 6)).toHaveLength(6);
  });

  it('returns the curated list unchanged when discovery found nothing', () => {
    // The offline / blocked-endpoint path: no catalogue must never mean no models.
    expect(mergeCandidates(CURATED, [])).toEqual(CURATED);
  });
});
