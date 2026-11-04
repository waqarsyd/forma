import { describe, it, expect, afterEach } from 'vitest';
import { OCR_LANGUAGES, isOcrLanguage, ocrLanguageString, setOcrLanguages, tesseractLanguages, validOcrLanguages } from './ocrLanguages';

afterEach(() => setOcrLanguages([]));

describe('the OCR languages', () => {
  it('offers the six the owner approved, by their Tesseract names', () => {
    expect(OCR_LANGUAGES.map((l) => l.code)).toEqual(['ara', 'hin', 'urd', 'fra', 'deu', 'spa']);
    expect(isOcrLanguage('urd')).toBe(true);
    expect(isOcrLanguage('eng')).toBe(false);
  });

  it('keeps only offered languages, once each, in the list order', () => {
    expect(validOcrLanguages(['spa', 'xx', 'ara', 'spa', 3])).toEqual(['ara', 'spa']);
    expect(validOcrLanguages('ara')).toEqual([]);
    expect(validOcrLanguages(null)).toEqual([]);
  });

  it('always reads English, then what was chosen', () => {
    expect(tesseractLanguages([])).toBe('eng');
    expect(tesseractLanguages(['fra', 'ara'])).toBe('eng+ara+fra');
    expect(tesseractLanguages(['../eng'])).toBe('eng');
  });

  it('holds the choice for the next OCR run', () => {
    expect(ocrLanguageString()).toBe('eng');
    setOcrLanguages(['hin', 'urd']);
    expect(ocrLanguageString()).toBe('eng+hin+urd');
    setOcrLanguages(undefined);
    expect(ocrLanguageString()).toBe('eng');
  });
});
