/**
 * A report's typed texts, collected for translation and put back translated
 * (2026-11-10, the first of the gaps `docs/proposals/ai-designers.md` found
 * beside DevExpress's "Localize with AI").
 *
 * What is translated is every typed `Text` of a label or a table cell: the
 * captions, the title, the notes. What is not: a text bound to a field or an
 * expression (the data prints there, not the text), a page number's format,
 * and anything with no letters in it (a number, a dash, a currency sign). The
 * layout is untouched, every control keeping its place, size and font, so a
 * longer translation may wrap or clip as it would in the designer; the
 * Preview shows which. The translated report is a copy with the texts
 * replaced, kept as a revision beside the original, rather than DevExpress's
 * per-language `LocalizationItems`, which Forma has not measured.
 *
 * The AI is asked once with every distinct text and answers each
 * (`services/translate.ts`); `applyTranslations` puts them back by exact
 * match, escaped as the file writes them, and counts what it changed.
 */
import { escapeXmlAttribute } from './xmlEscape';

const TEXT_CONTROLS = /<(Item\d+)\b([^>]*\bControlType="(?:XRLabel|XRTableCell|XRCheckBox|XRRichText)"[^>]*)>/g;
const TEXT_ATTR = /\sText="([^"]*)"/;
const BOUND = /<ExpressionBindings>[\s\S]*?PropertyName="Text"/;

const unescape = (v: string) => v.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Whether the control's own children bind its Text: a self-closing tag has none, an open one is read to its closing tag. */
function boundText(xml: string, item: string, attrs: string, end: number): boolean {
  if (attrs.trimEnd().endsWith('/')) return false;
  const close = xml.indexOf(`</${item}>`, end);
  return BOUND.test(xml.slice(end, close === -1 ? end + 600 : close));
}

/** Whether a text is words to translate: it holds a letter, and is not a field or expression placeholder. */
export function translatable(text: string): boolean {
  const t = text.trim();
  return /\p{L}/u.test(t) && !/^\[.*\]$/.test(t) && !/^\{\d+/.test(t);
}

/** The distinct typed texts of a report's labels and cells, in file order, with how many controls print each. */
export function collectTexts(xml: string): { text: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of xml.matchAll(TEXT_CONTROLS)) {
    const text = TEXT_ATTR.exec(m[2])?.[1];
    if (text === undefined) continue;
    // A label bound to a field prints the field; its typed text never shows.
    if (boundText(xml, m[1], m[2], m.index! + m[0].length)) continue;
    const plain = unescape(text);
    if (!translatable(plain)) continue;
    counts.set(plain, (counts.get(plain) ?? 0) + 1);
  }
  return [...counts].map(([text, count]) => ({ text, count }));
}

/**
 * The report with each typed text replaced by its translation, where one was
 * given; a text with no translation, or an empty one, stays. Returns the
 * file and how many controls changed.
 */
export function applyTranslations(xml: string, translations: ReadonlyMap<string, string>): { xml: string; changed: number } {
  let changed = 0;
  const out = xml.replace(TEXT_CONTROLS, (whole, item: string, attrs: string, offset: number) => {
    const m = TEXT_ATTR.exec(attrs);
    if (!m) return whole;
    if (boundText(xml, item, attrs, offset + whole.length)) return whole;
    const plain = unescape(m[1]);
    const to = translations.get(plain)?.trim();
    if (!to || to === plain) return whole;
    changed++;
    return whole.replace(m[0], ` Text="${escapeXmlAttribute(to)}"`);
  });
  return { xml: out, changed };
}

/** The language a request names, as "translate it into German" or "in French": the word after into/to/in, or null. */
export function languageAsked(message: string): string | null {
  const m = /\b(?:[Tt]ranslat\w*|[Ll]ocali[sz]\w*)\b[^.?!]*?\b(?:into|to|in)\s+([A-Z][\p{L}-]+(?:\s[A-Z][\p{L}-]+)?)/u.exec(message);
  return m?.[1] ?? null;
}
