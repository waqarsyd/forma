/**
 * pdf.js is loaded when a PDF arrives, not when the page does.
 *
 * It was a static `import * as pdfjs from 'pdfjs-dist'` in `App.tsx`, with the
 * worker configured at module scope — so every visitor to the landing page, the
 * features page and the privacy policy downloaded and parsed a PDF engine they
 * would never use (audit PERF-001).
 *
 * The loader is memoised because `ingestFile` can be called several times in a
 * session — a multi-file drop is one call per file — and because configuring
 * `GlobalWorkerOptions.workerSrc` twice is wasteful rather than harmful, which
 * is exactly the sort of thing that goes unnoticed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The real module is 38 MB on disk and needs a browser worker; what matters
// here is the loading contract, so the import itself is stubbed.
const getDocument = vi.fn();
const globalWorkerOptions: { workerSrc?: string } = {};
const loadCount = { pdfjs: 0, worker: 0 };

vi.mock('pdfjs-dist', () => {
  loadCount.pdfjs++;
  return { getDocument, GlobalWorkerOptions: globalWorkerOptions };
});

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => {
  loadCount.worker++;
  return { default: '/assets/pdf.worker.mjs' };
});

import { loadPdfjs, resetPdfjsForTests } from './pdf';

beforeEach(() => {
  resetPdfjsForTests();
  loadCount.pdfjs = 0;
  loadCount.worker = 0;
  delete globalWorkerOptions.workerSrc;
});

describe('loadPdfjs', () => {
  it('returns the module', async () => {
    const pdfjs = await loadPdfjs();
    expect(pdfjs.getDocument).toBe(getDocument);
  });

  it('configures the worker before handing the module over', async () => {
    // Calling getDocument with no workerSrc set fails at runtime in a way that
    // reads as a corrupt PDF rather than a missing worker.
    const pdfjs = await loadPdfjs();
    expect(globalWorkerOptions.workerSrc).toBe('/assets/pdf.worker.mjs');
    expect(pdfjs).toBeDefined();
  });

  it('hands every caller the same promise', () => {
    // This is the memo, and it is the only part observable from a test: the ES
    // module cache dedupes the `import()` itself whether or not we memoise, so
    // counting factory invocations proves nothing. Promise identity does.
    const first = loadPdfjs();
    expect(loadPdfjs()).toBe(first);
    expect(loadPdfjs()).toBe(first);
  });

  it('holds for concurrent callers, which is the real case', async () => {
    // A multi-file drop calls ingestFile once per file, in parallel.
    const [a, b] = await Promise.all([loadPdfjs(), loadPdfjs()]);
    expect(a).toBe(b);
  });

  it('does nothing until it is called', () => {
    // Importing this module must not configure the worker, because that would
    // mean it had pulled pdf.js in with it — the eager import all over again.
    expect(globalWorkerOptions.workerSrc).toBeUndefined();
  });
});
