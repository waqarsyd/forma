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
import { escapeXmlAttribute, unescapeXml } from './xmlEscape';

const TEXT_CONTROLS = /<(Item\d+)\b([^>]*\bControlType="(?:XRLabel|XRTableCell|XRCheckBox|XRRichText)"[^>]*)>/g;
const TEXT_ATTR = /\sText="([^"]*)"/;
const BOUND = /<ExpressionBindings>[\s\S]*?PropertyName="Text"/;

// Character references too (the 2026-11-11 audit, RH-04): a two-line caption
// went to the AI as "Total&#xD;&#xA;due", and its translation came back to
// print those characters, or on one line.
const unescape = unescapeXml;

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
    // A replacer, never the translation in a replacement string (2026-11-11, the
    // full audit's PX-02): "Preis ($'000)" wrote the rest of the tag into the text.
    const written = ` Text="${escapeXmlAttribute(to)}"`;
    return whole.replace(m[0], () => written);
  });
  return { xml: out, changed };
}

/*
 * The languages a request can name, each under the one English name Forma
 * uses for it (2026-11-11, the full audit's CV-01 and TC-02): the English
 * name, the language's own name, and its ISO code. "Generate the report in
 * German" was answered with a button whenever the model wrote the language
 * as "de", "Deutsch" or "German (Germany)", and "I need it in espanol" was
 * not read as a language at all, because only "translate ... into X" was.
 */
const LANGUAGES: Readonly<Record<string, readonly string[]>> = {
  English: ['english', 'en'],
  German: ['german', 'deutsch', 'de'],
  French: ['french', 'francais', 'français', 'fr'],
  Spanish: ['spanish', 'espanol', 'español', 'castellano', 'es'],
  Italian: ['italian', 'italiano', 'it'],
  Portuguese: ['portuguese', 'portugues', 'português', 'pt'],
  Dutch: ['dutch', 'nederlands', 'nl'],
  Arabic: ['arabic', 'ar'],
  Hindi: ['hindi', 'hi'],
  Urdu: ['urdu', 'ur'],
  Bengali: ['bengali', 'bangla', 'bn'],
  Tamil: ['tamil', 'ta'],
  Telugu: ['telugu', 'te'],
  Marathi: ['marathi', 'mr'],
  Gujarati: ['gujarati', 'gu'],
  Punjabi: ['punjabi', 'pa'],
  Chinese: ['chinese', 'mandarin', 'zh'],
  Japanese: ['japanese', 'ja'],
  Korean: ['korean', 'ko'],
  Russian: ['russian', 'ru'],
  Ukrainian: ['ukrainian', 'uk'],
  Polish: ['polish', 'polski', 'pl'],
  Turkish: ['turkish', 'turkce', 'türkçe', 'tr'],
  Greek: ['greek', 'el'],
  Hebrew: ['hebrew', 'he'],
  Persian: ['persian', 'farsi', 'fa'],
  Swedish: ['swedish', 'svenska', 'sv'],
  Norwegian: ['norwegian', 'norsk', 'no'],
  Danish: ['danish', 'dansk', 'da'],
  Finnish: ['finnish', 'suomi', 'fi'],
  Czech: ['czech', 'cs'],
  Romanian: ['romanian', 'ro'],
  Hungarian: ['hungarian', 'magyar', 'hu'],
  Indonesian: ['indonesian', 'bahasa indonesia', 'id'],
  Malay: ['malay', 'bahasa melayu', 'ms'],
  Thai: ['thai', 'th'],
  Vietnamese: ['vietnamese', 'vi'],
};

const BY_ALIAS = new Map(Object.entries(LANGUAGES).flatMap(([name, aliases]) => aliases.map((a) => [a, name] as const)));

/*
 * Where the words alone name a language, without a translate verb, only a
 * language's name counts, never its two-letter code (2026-11-11, the review
 * of the full audit's CV-01): "keep the font sizes in pt", "add a total in
 * ar" and "remember to de-duplicate the rows" are report talk, and read as
 * Portuguese, Arabic and German they translated a first build unasked. A
 * code is read only after "translate" or "localise", and "polish" only as
 * "Polish" ("polish the layout" is an everyday verb).
 */
const NAME_ALIASES = [...BY_ALIAS.keys()].filter((a) => a.length > 2).sort((a, b) => b.length - a.length);
/**
 * Codes that are everyday words even after a translate verb ("translate the
 * title and add a total to it", "say hi to", "in ur report"), which name a
 * language only as a tool's language the model wrote.
 */
const EVERYDAY_CODES = new Set(['it', 'no', 'hi', 'id', 'he', 'ur', 'mr', 'pa', 'ta', 'te', 'th', 'uk', 'ms', 'da', 'el', 'fa']);
/** Every alias but those, codes included, longest first so "bahasa indonesia" wins over a shorter one. */
const ALL_ALIASES = [...BY_ALIAS.keys()].filter((a) => !EVERYDAY_CODES.has(a)).sort((a, b) => b.length - a.length);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Not part of a longer word, a hyphenated word ("de-duplicate") or an identifier. */
const WORD_END = '(?![\\p{L}\\p{N}_-])';
/** "in Arabic numerals", "in Hindi script": the language describes something else. */
const NOT_LANGUAGE = '(?!\\s+(?:numerals?|numbers?|digits?|font|fonts|style|format|order|letters|script|keyboard)\\b)';
/** "in German", "into Español", "to French": a language's name after in, into or to. */
const IN_LANGUAGE = new RegExp(
  `(?<![\\p{L}\\p{N}])(in|into|to)\\s+(${NAME_ALIASES.map(escapeRe).join('|')})${WORD_END}${NOT_LANGUAGE}`,
  'giu',
);
const TRANSLATE_VERB = /\b(?:translat\w*|locali[sz]\w*)\b/i;
/** After a translate verb, a code counts too: "translate it to de". */
const AFTER_VERB = new RegExp(
  `(?<![\\p{L}\\p{N}])(in|into|to)\\s+(${ALL_ALIASES.map(escapeRe).join('|')})${WORD_END}${NOT_LANGUAGE}`,
  'giu',
);

/**
 * The one English name for a language however it was written ("de",
 * "Deutsch", "German (Germany)", "zh-Hans" are all one name), or the name as
 * written, trimmed, when Forma does not know it; empty for nothing.
 */
export function languageName(raw: string | null | undefined): string {
  const plain = (raw ?? '').trim().replace(/\s*\(.*\)\s*$/, '').replace(/[-_][A-Za-z]{2,4}$/, '').trim();
  if (!plain) return '';
  return BY_ALIAS.get(plain.toLowerCase()) ?? plain.slice(0, 40);
}

/** Whether an alias, as written in the words, is a language there: "polish" in lower case is the verb. */
const meansLanguage = (written: string) => written.toLowerCase() !== 'polish' || written === 'Polish';

/**
 * Whether the words name a language by its name, as a word of their own. A
 * code is not looked for: "pt" or "de" in the words is report talk far more
 * often than a language, and a request that names a code with a translate
 * verb is read by `languageAsked` instead.
 */
export function namesLanguage(words: string, language: string): boolean {
  const name = languageName(language);
  if (!name) return false;
  const aliases = (LANGUAGES[name] ?? [name.toLowerCase()]).filter((a) => a.length > 2);
  return aliases.some((a) =>
    [...words.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(a)}${WORD_END}`, 'giu'))].some((m) => meansLanguage(m[0])),
  );
}

/**
 * Of the languages a pattern finds, the one asked for: the first after
 * "into", else the last ("translate the labels in English to German" asks
 * for German, the English being what they are now).
 */
function pick(message: string, re: RegExp, verbFirst: boolean): string | null {
  const found = [...message.matchAll(re)].filter((m) => verbFirst || meansLanguage(m[2]));
  if (!found.length) return null;
  const into = found.find((m) => m[1].toLowerCase() === 'into');
  return languageName((into ?? found[found.length - 1])[2]);
}

/**
 * The language a request names, as its English name, or null: "translate it
 * into German", and since 2026-11-11 without the verb too, "in French",
 * "into Español". A code ("to de") is read only after a translate verb, and
 * a language Forma does not list only after "translate ... into", as it was
 * written.
 */
export function languageAsked(message: string): string | null {
  const verb = TRANSLATE_VERB.exec(message);
  if (verb) {
    const after = message.slice(verb.index);
    const named = pick(after, AFTER_VERB, true);
    if (named) return named;
    const m = /\b(?:into|to|in)\s+([A-Z][\p{L}-]+(?:\s[A-Z][\p{L}-]+)?)/u.exec(after);
    if (m) return languageName(m[1]);
  }
  return pick(message, IN_LANGUAGE, false);
}
