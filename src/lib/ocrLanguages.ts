/**
 * The languages OCR reads besides English (2026-11-04). The owner approved
 * Arabic, Hindi, Urdu, French, German and Spanish; each is Tesseract's
 * best_int data from @tesseract.js-data 1.0.0, served from this site's own
 * `/ocr/` as English is (vite.config.ts) and fetched only by someone who
 * chose it in Settings. English is always read, since a report in another
 * language still carries English: codes, totals, the DevExpress page info.
 *
 * Kept apart from `ocr.ts` so that Settings and App can name and set the
 * choice without loading the OCR module; `ocr.ts` reads it when it creates
 * its engine, and creates a new one when the choice changes.
 */

export const OCR_LANGUAGES = [
  { code: 'ara', name: 'Arabic' },
  { code: 'hin', name: 'Hindi' },
  { code: 'urd', name: 'Urdu' },
  { code: 'fra', name: 'French' },
  { code: 'deu', name: 'German' },
  { code: 'spa', name: 'Spanish' },
] as const;

export type OcrLanguage = (typeof OCR_LANGUAGES)[number]['code'];

const CODES: readonly string[] = OCR_LANGUAGES.map((l) => l.code);

/** The languages in `raw` that OCR offers, once each, in the list's order; anything else is dropped. */
export function validOcrLanguages(raw: unknown): OcrLanguage[] {
  if (!Array.isArray(raw)) return [];
  const chosen = new Set(raw.filter((x): x is string => typeof x === 'string'));
  return OCR_LANGUAGES.map((l) => l.code).filter((c) => chosen.has(c));
}

/** The language string Tesseract is created with: English, then the chosen languages. */
export function tesseractLanguages(chosen: readonly string[] | undefined): string {
  return ['eng', ...validOcrLanguages(chosen ?? [])].join('+');
}

let current: OcrLanguage[] = [];

/** Set the languages the next OCR run reads; App calls it when Settings change. */
export function setOcrLanguages(chosen: readonly string[] | undefined): void {
  current = validOcrLanguages(chosen ?? []);
}

/** The languages OCR reads now, as Tesseract names them. */
export function ocrLanguageString(): string {
  return tesseractLanguages(current);
}

/** Whether `code` is a language OCR offers. */
export const isOcrLanguage = (code: string): code is OcrLanguage => CODES.includes(code);
