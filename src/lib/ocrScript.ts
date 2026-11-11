/**
 * OCR works out a page's language itself (2026-11-04). Until this date the
 * user ticked languages in Settings, and the owner's rule is that nobody
 * should be asked what the page already shows. Nothing is downloaded for an
 * English page that was not downloaded before.
 *
 * How, in `ocr.ts`, using the decisions made here:
 * 1. Every page is read in English first, as before.
 * 2. **A confident reading is a Latin-script page.** Its words say which
 *    language: French, German and Spanish each have function words English
 *    does not ("les", "und", "los"), and OCR in English reads those letters
 *    well enough to count them. A page that is clearly one of them is read
 *    again with that language and English together, for its accents.
 * 3. **An unsure reading may be another script.** English OCR on Arabic or
 *    Devanagari still finds the lines, only not their words. A few of those
 *    lines are read again with each other script Forma has (Arabic, Urdu,
 *    Hindi), which costs a second each; the one that reads them far more
 *    confidently than English did is the page's script, and the page is read
 *    again with it and English, since such pages carry English too.
 * 4. **Handwriting** is tried when the page is Latin and enough of its lines
 *    stayed unsure (`looksHandwritten`), and only when this site serves the
 *    handwriting model.
 *
 * Tesseract's own script detection (OSD) was the obvious tool and was not
 * used: it needs the legacy engine and a 10 MB model on every first OCR,
 * against the 360 MB a day the free hosting plan allows.
 */
import type { OcrLine, OcrPage } from './ocr';
import type { PixelBox } from './reportGeometry';

/** Scripts other than Latin that Forma can read, as Tesseract names their data. */
export const OTHER_SCRIPTS = ['ara', 'urd', 'hin'] as const;
/** Latin-script languages besides English. */
const LATIN_LANGUAGES = ['fra', 'deu', 'spa'] as const;

/** A page read this confidently in English is a Latin-script page. */
export const CONFIDENT = 70;
/** A line English read below this is garbled: the kind another script may read. */
const GARBLED = 40;
/** Another script must read the probed lines this many points more confidently than English did, on average. */
const SCRIPT_MARGIN = 12;

/** The page's confidence: its lines', weighted by how much text each holds. */
export function meanConfidence(lines: readonly OcrLine[]): number {
  let total = 0;
  let weight = 0;
  for (const line of lines) {
    const w = Math.max(1, line.text.length);
    total += line.confidence * w;
    weight += w;
  }
  return weight ? total / weight : 0;
}

/** Whether English read a page confidently enough to call it Latin script. */
export function readsAsLatin(page: OcrPage): boolean {
  return page.lines.length > 0 && meanConfidence(page.lines) >= CONFIDENT;
}

/**
 * The lines to try other scripts on: the widest of those English garbled, up
 * to six. Garbled rather than merely unsure, because a bilingual page's
 * widest unsure lines are its mixed ones, which no single script reads well;
 * measured on the owner's Arabic and English certificate, the three widest
 * unsure lines put Arabic 16 points above English, the six widest garbled
 * ones 28. Wide lines carry the most letters to judge by.
 */
export function probeLines(page: OcrPage, max = 6): PixelBox[] {
  return page.lines
    .filter((l) => l.confidence < GARBLED)
    .sort((a, b) => b.box.x1 - b.box.x0 - (a.box.x1 - a.box.x0))
    .slice(0, max)
    .map((l) => l.box);
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * The script that read the probed lines best, or null. It must beat English
 * by the margin on average and on at least two thirds of the lines, so one
 * line read well by chance does not decide a page. A page English could not
 * read and no other script could either is more likely a poor picture than a
 * foreign one.
 */
export function bestScript(english: readonly number[], scores: Readonly<Record<string, readonly number[]>>): string | null {
  const ranked = Object.entries(scores).sort((a, b) => mean(b[1]) - mean(a[1]));
  const [lang, score] = ranked[0] ?? [];
  if (!lang || !english.length || mean(score) < mean(english) + SCRIPT_MARGIN) return null;
  const wins = score.filter((s, i) => s > (english[i] ?? 0)).length;
  return wins * 3 >= english.length * 2 ? lang : null;
}

/** Function words that are common in one language and absent or rare in English. */
const FUNCTION_WORDS: Record<(typeof LATIN_LANGUAGES)[number], ReadonlySet<string>> = {
  fra: new Set(['le', 'les', 'des', 'du', 'et', 'est', 'une', 'pour', 'par', 'sur', 'aux', 'avec', 'dans', 'qui', 'que', 'pas', 'ce', 'cette', 'au', 'date', 'montant', 'facture']),
  deu: new Set(['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'von', 'zu', 'den', 'des', 'im', 'auf', 'für', 'ein', 'eine', 'dem', 'betrag', 'rechnung', 'datum']),
  spa: new Set(['el', 'los', 'las', 'del', 'y', 'en', 'por', 'para', 'con', 'una', 'es', 'que', 'se', 'al', 'como', 'fecha', 'importe', 'factura', 'total']),
};
const ENGLISH = new Set(['the', 'and', 'of', 'to', 'in', 'for', 'is', 'with', 'on', 'by', 'this', 'that', 'from', 'amount', 'invoice', 'date', 'total']);

/**
 * The Latin-script language a text is in, when it is clearly not English:
 * the language whose function words appear most, at least four times and at
 * least twice as often as English's. Null for English, and for too little text.
 */
export function latinLanguageOf(text: string): (typeof LATIN_LANGUAGES)[number] | null {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 12) return null;
  const english = words.filter((w) => ENGLISH.has(w)).length;
  let best: (typeof LATIN_LANGUAGES)[number] | null = null;
  let bestCount = 0;
  for (const lang of LATIN_LANGUAGES) {
    const count = words.filter((w) => FUNCTION_WORDS[lang].has(w)).length;
    if (count > bestCount) [best, bestCount] = [lang, count];
  }
  return best && bestCount >= 4 && bestCount >= english * 2 ? best : null;
}

/** Whether enough of a page stayed unsure to try reading it as handwriting: two lines and a quarter of them. */
export function looksHandwritten(page: OcrPage, below = CONFIDENT): boolean {
  const unsure = page.lines.filter((l) => l.confidence < below && l.words.length).length;
  return unsure >= 2 && unsure >= page.lines.length / 4;
}
