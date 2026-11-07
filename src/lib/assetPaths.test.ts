/**
 * Where the served files are (2026-11-07, site audit item 91). Outside a build
 * there is no `__FORMA_ASSETS__`, so these are the unversioned paths; what is
 * pinned is that every URL is absolute and names its own folder. A path that
 * lost its folder reached the browser once, while the change that versioned
 * them was being written: tesseract loaded `/worker.min.js` from the site's
 * root, and OCR read nothing. Nothing tested these until then.
 */
import { describe, expect, it } from 'vitest';
import { HANDWRITING_ASSET_BASE, MODEL_BASE, OCR_BASE, OCR_WORKER, PDF_FONT_BASE } from './assetPaths';
import { MODEL_URL } from './formaModel';
import { BOX_READER_URL } from './boxReader';
import { PDF_FONT_PATH } from './pdfFonts';
import { HANDWRITING_BASE, HANDWRITING_PROBE } from './handwriting';

describe('the served files', () => {
  it('are each in their own folder, outside a build unversioned', () => {
    expect([OCR_BASE, PDF_FONT_BASE, MODEL_BASE, HANDWRITING_ASSET_BASE]).toEqual(['/ocr/', '/pdf-fonts/', '/model/', '/handwriting/']);
  });

  it('are asked for by absolute paths in those folders', () => {
    expect(OCR_WORKER).toBe('/ocr/worker.min.js');
    expect(MODEL_URL).toBe('/model/formaModel.json');
    expect(BOX_READER_URL).toBe('/model/boxReader.json');
    expect(PDF_FONT_PATH).toBe('/pdf-fonts/');
    expect(HANDWRITING_BASE).toBe('/handwriting/');
    expect(HANDWRITING_PROBE).toBe('/handwriting/models/Xenova/trocr-small-handwritten/config.json');
  });
});
