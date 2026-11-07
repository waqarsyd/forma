/**
 * Where the files Forma serves beside its bundle live (2026-11-07, site audit
 * item 91): OCR's engine and languages, the PDF/A fonts, Forma's own model and
 * the handwriting model. The build puts each set under a folder named for its
 * contents (`/ocr/3f9a1c20b7/`, see `servedAssets` in vite.config.ts) and
 * passes the paths in as `__FORMA_ASSETS__`, so a new engine, font or model
 * gets a new URL and the old one can be cached for good, as the hashed bundle
 * is. They were at fixed paths (`/ocr/worker.min.js`) and revalidated on every
 * use, a round trip each before OCR could start.
 *
 * Outside a build (the unit tests, the scripts run with tsx) there is no
 * define, and the unversioned paths are the answer: `typeof` an undeclared
 * name is safe where reading it would throw.
 */
declare const __FORMA_ASSETS__: { ocr: string; pdfFonts: string; model: string; handwriting: string } | undefined;

const built = typeof __FORMA_ASSETS__ === 'object' && __FORMA_ASSETS__ ? __FORMA_ASSETS__ : null;

/** OCR's worker, core builds and language data. */
export const OCR_BASE = built?.ocr ?? '/ocr/';
/** OCR's worker script, which tesseract.js loads into its Web Worker. */
export const OCR_WORKER = `${OCR_BASE}worker.min.js`;
/** The fonts a PDF/A file embeds. */
export const PDF_FONT_BASE = built?.pdfFonts ?? '/pdf-fonts/';
/** Forma's own model and its box reader. */
export const MODEL_BASE = built?.model ?? '/model/';
/** The handwriting model, when the build carries it. */
export const HANDWRITING_ASSET_BASE = built?.handwriting ?? '/handwriting/';
