/**
 * pdf.js, loaded when a PDF arrives rather than when the page does.
 *
 * `App.tsx` had `import * as pdfjs from 'pdfjs-dist'` at the top and
 * `pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker` at module scope, so the
 * engine landed in the eager bundle and every visitor to the landing page, the
 * features page or the privacy policy downloaded and parsed a PDF library they
 * would never use (audit PERF-001). It is the largest single dependency in the
 * project — 38 MB on disk — and it is needed by exactly one function.
 *
 * The worker file itself was already a separate chunk that pdf.js fetches on
 * demand; what was eager was the ~350 KB engine that fetches it.
 *
 * Memoised because `ingestFile` runs once per dropped file, and a multi-file
 * drop calls it in parallel. Without the shared promise a five-file drop starts
 * five imports; the module system would dedupe the network fetch, but the
 * worker would be configured five times and the intent would be unclear to the
 * next reader.
 */
type Pdfjs = typeof import('pdfjs-dist');

let pending: Promise<Pdfjs> | null = null;

/**
 * Load pdf.js and point it at its worker.
 *
 * The worker must be configured *before* the module is handed over: calling
 * `getDocument` without a `workerSrc` fails in a way that reads as a corrupt
 * PDF rather than as a missing worker, which is a bad half-hour for whoever
 * hits it.
 */
export function loadPdfjs(): Promise<Pdfjs> {
  if (!pending) {
    pending = (async () => {
      const [pdfjs, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.mjs?url'),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return pending;
}

/** Test seam. Not for application use — the memo is deliberate at runtime. */
export function resetPdfjsForTests(): void {
  pending = null;
}
