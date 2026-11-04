import { describe, it, expect } from 'vitest';
import type { OcrLine, OcrPage } from './ocr';
import { bestScript, latinLanguageOf, looksHandwritten, meanConfidence, probeLines, readsAsLatin } from './ocrScript';

const line = (text: string, confidence: number, x1 = 400): OcrLine => ({
  text,
  confidence,
  box: { x0: 0, y0: 0, x1, y1: 20 },
  words: text.split(' ').map((w) => ({ text: w, confidence, box: { x0: 0, y0: 0, x1: 10, y1: 10 } })),
});
const page = (lines: OcrLine[]): OcrPage => ({ width: 1000, height: 1400, dpi: null, lines });

describe("working out a page's script", () => {
  it('weighs each line by its text, so a long sure line outweighs a short unsure one', () => {
    expect(meanConfidence([line('a long line read with confidence', 90), line('x', 10)])).toBeGreaterThan(85);
    expect(meanConfidence([])).toBe(0);
  });

  it('calls a confidently read page Latin script', () => {
    expect(readsAsLatin(page([line('Invoice number 1042', 92), line('Total due 300.00', 88)]))).toBe(true);
    expect(readsAsLatin(page([line('lj!| ~;', 31), line('jl/', 22)]))).toBe(false);
    expect(readsAsLatin(page([]))).toBe(false);
  });

  it('probes the widest lines English garbled, six at most, and not the merely unsure mixed ones', () => {
    const lines = [line('a', 30, 100), line('b', 30, 900), line('c', 95, 1000), line('mixed', 55, 1200), line('e', 20, 700), ...Array.from({ length: 6 }, (_, i) => line('f', 10, 200 + i))];
    expect(probeLines(page(lines)).map((b) => b.x1)).toEqual([900, 700, 205, 204, 203, 202]);
  });

  it("takes the script the owner's certificate measured: Arabic, ahead on every garbled line", () => {
    // English, Arabic, Urdu and Hindi on the six widest garbled lines, measured 2026-11-04.
    const english = [35, 37, 31, 39, 22, 12];
    expect(bestScript(english, { ara: [55, 46, 50, 65, 54, 73], urd: [50, 45, 38, 41, 52, 57], hin: [12, 19, 17, 19, 14, 16] })).toBe('ara');
  });

  it('takes no script that is not far ahead on average, or wins on too few lines, or when nothing was probed', () => {
    expect(bestScript([30, 30, 30], { ara: [40, 38, 41] })).toBeNull();
    expect(bestScript([30, 30, 30], { ara: [95, 20, 25] })).toBeNull();
    expect(bestScript([], { ara: [] })).toBeNull();
  });
});

describe('the language of a Latin-script page', () => {
  it('knows French, German and Spanish by their function words', () => {
    expect(latinLanguageOf('Facture numéro 1042 pour les services du mois de mars, avec la date et le montant total des articles')).toBe('fra');
    expect(latinLanguageOf('Rechnung Nummer 1042 für die Leistungen im März, mit dem Datum und der Betrag der Artikel ist hier')).toBe('deu');
    expect(latinLanguageOf('Factura número 1042 para los servicios del mes de marzo, con la fecha y el importe de las partidas')).toBe('spa');
  });

  it('leaves English, and too little text, as English', () => {
    expect(latinLanguageOf('Invoice number 1042 for the services of March, with the date and the total amount of the items')).toBeNull();
    expect(latinLanguageOf('Total 300.00')).toBeNull();
  });
});

describe('handwriting', () => {
  it('is tried when two lines and a quarter of the page stayed unsure', () => {
    expect(looksHandwritten(page([line('Dear sir', 40), line('thank you', 35), line('Signed', 90), line('Date', 92)]))).toBe(true);
    expect(looksHandwritten(page([line('noise', 40), ...Array.from({ length: 9 }, () => line('printed', 95))]))).toBe(false);
  });
});
