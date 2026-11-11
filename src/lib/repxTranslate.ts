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
 * replaced, kept as a revision beside the original.
 *
 * Unless the words ask to keep both languages ("add German", "in English
 * and German", "bilingual"): then the report keeps its own texts and gains
 * DevExpress's `LocalizationItems` for the second (`localizeRepx`, 2026-11-11,
 * the full audit's CP-06, measured with `RepxProbe emit-localize`), and the
 * Preview's language switch shows either (`inCulture`).
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
 * A report in two languages (2026-11-11, the full audit's CP-06), as
 * `RepxProbe emit-localize` measured DevExpress 20.1 writing and reading it:
 *
 * - each item is `<ItemN Ref Component="#Ref-<control>" Culture Path Data/>`
 *   in a `<LocalizationItems>` collection of the report, after `</Bands>`;
 * - once a file has any, the loader drops EVERY control's own `Text` and
 *   `Font`, named by an item or not (its place, size and table weights
 *   stay): the first language prints only from `Culture="Default"` items,
 *   which the designer's own save writes for `Font`, `LocationFloat`, `SizeF`
 *   and `Text`. So a `Default` item is written for the `Text` and `Font` of
 *   every control that has one, and the control keeps its attributes too,
 *   which Forma's own readers go on using;
 * - a neutral culture ("de") serves "de-DE" and "de-AT", and not the other
 *   way, so the second language is written neutral.
 */
const LOCALIZATION_BLOCK = /<LocalizationItems>([\s\S]*?)<\/LocalizationItems>\s*/;
const LOCALIZATION_ITEM = /<Item\d+\b([^>]*?)\/>/g;
const CONTROL_TAG = /<Item\d+\b([^>]*\bControlType="XR[^"]*"[^>]*)>/g;
const attrOf = (attrs: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1];

/** One localization item: whose, in which culture, which property, and the value as the file writes it (escaped). */
export interface LocalizationItem {
  component: string;
  culture: string;
  path: string;
  data: string;
}

/** The report's localization items, in file order. */
export function localizationItems(xml: string): LocalizationItem[] {
  const block = LOCALIZATION_BLOCK.exec(xml)?.[1];
  if (!block) return [];
  return [...block.matchAll(LOCALIZATION_ITEM)].flatMap((m) => {
    const component = attrOf(m[1], 'Component')?.replace(/^#Ref-/, '');
    const culture = attrOf(m[1], 'Culture');
    const path = attrOf(m[1], 'Path');
    const data = attrOf(m[1], 'Data');
    return component && culture !== undefined && path && data !== undefined ? [{ component, culture, path, data }] : [];
  });
}

/** The languages a report carries besides its own, as their culture names ("de", "fr-FR"), in file order. */
export function reportCultures(xml: string): string[] {
  return [...new Set(localizationItems(xml).map((i) => i.culture).filter((c) => c && c !== 'Default'))];
}

/** The culture a language is written under: its neutral code ("de" for German), or null when Forma does not know one. */
export function cultureOf(language: string): string | null {
  const name = languageName(language);
  // Norwegian's ISO 639-1 "no" is not a .NET culture; Bokmal is what it means.
  if (name === 'Norwegian') return 'nb';
  return LANGUAGES[name]?.find((a) => /^[a-z]{2}$/.test(a)) ?? null;
}

/** The English name of a culture's language ("de-DE" is German), or the culture as written. */
export function cultureName(culture: string): string {
  const code = culture.split('-')[0].toLowerCase();
  if (code === 'nb' || code === 'nn') return 'Norwegian';
  return BY_ALIAS.get(code) ?? culture;
}

/**
 * The report with its texts kept and a second language added as
 * `LocalizationItems` under `culture`: each typed text with a translation
 * gets an item in that culture, and every control's own `Text` and `Font`
 * a `Default` item (see above), unless the file has one already. A culture
 * the file already carries is replaced text for text. Returns the file and
 * how many controls have the second language.
 */
export function localizeRepx(xml: string, culture: string, translations: ReadonlyMap<string, string>): { xml: string; changed: number } {
  const key = itemKey;
  const items = new Map(localizationItems(xml).map((i) => [key(i), i] as const));
  let changed = 0;
  for (const m of xml.matchAll(CONTROL_TAG)) {
    const attrs = m[1];
    const ref = attrOf(attrs, 'Ref');
    if (!ref) continue;
    for (const path of ['Text', 'Font']) {
      const own = attrOf(attrs, path);
      const k = key({ component: ref, culture: 'Default', path });
      if (own !== undefined && !items.has(k)) items.set(k, { component: ref, culture: 'Default', path, data: own });
    }
    const text = attrOf(attrs, 'Text');
    if (text === undefined) continue;
    const item = /^<(Item\d+)/.exec(m[0])![1];
    if (boundText(xml, item, attrs, m.index! + m[0].length)) continue;
    const to = translations.get(unescape(text))?.trim();
    if (!to) continue;
    items.set(key({ component: ref, culture, path: 'Text' }), { component: ref, culture, path: 'Text', data: escapeXmlAttribute(to) });
    changed++;
  }
  if (!changed) return { xml, changed: 0 };
  return { xml: writeLocalization(xml, [...items.values()]), changed };
}

const itemKey = (i: Pick<LocalizationItem, 'component' | 'culture' | 'path'>) => `${i.component}|${i.culture}|${i.path}`;

/** The report with its `<LocalizationItems>` written as `items`, after `</Bands>`; an item keeps its Ref, a new one takes one past every Ref in the file. */
function writeLocalization(xml: string, items: readonly LocalizationItem[]): string {
  // New Refs past every Ref in the file: a repeated Ref makes the loader drop content.
  let next = Math.max(0, ...[...xml.matchAll(/\bRef="(\d+)"/g)].map((r) => Number(r[1]))) + 1;
  const block = LOCALIZATION_BLOCK.exec(xml)?.[1] ?? '';
  const reused = new Map<string, string>();
  for (const m of block.matchAll(LOCALIZATION_ITEM)) {
    const ref = attrOf(m[1], 'Ref');
    const component = attrOf(m[1], 'Component')?.replace(/^#Ref-/, '');
    if (ref && component) reused.set(`${component}|${attrOf(m[1], 'Culture')}|${attrOf(m[1], 'Path')}`, ref);
  }
  const without = xml.replace(LOCALIZATION_BLOCK, '');
  if (!items.length) return without;
  const body = items
    .map((i, n) => `<Item${n + 1} Ref="${reused.get(itemKey(i)) ?? next++}" Component="#Ref-${i.component}" Culture="${i.culture}" Path="${i.path}" Data="${i.data}" />`)
    .join('\n    ');
  const written = `<LocalizationItems>\n    ${body}\n  </LocalizationItems>`;
  // The report's own </Bands> is the last one (2026-11-11, the review of
  // CP-06): a DetailReportBand carries a <Bands> of its own that closes
  // first, and items written there belong to the detail band, not the report.
  const at = without.lastIndexOf('</Bands>');
  return at === -1
    ? without.replace(/\s*<\/XtraReportsLayoutSerializer>\s*$/, () => `\n  ${written}\n</XtraReportsLayoutSerializer>`)
    : `${without.slice(0, at + '</Bands>'.length)}\n  ${written}${without.slice(at + '</Bands>'.length)}`;
}

/**
 * A report in two languages kept true to itself after an edit (CP-06): its
 * first language prints from the `Default` items, not from the controls, so
 * an edit to a control's `Text` or `Font` is written to its `Default` item
 * as well (a new control gains one), and the items of a control that is
 * gone are dropped, a `Component` naming no Ref being a file DevExpress
 * cannot load. A report with no `LocalizationItems` comes back as it was.
 */
export function syncLocalization(xml: string): string {
  if (!xml.includes('<LocalizationItems>')) return xml;
  const existing = localizationItems(xml);
  const refs = new Set([...xml.matchAll(/\sRef="(\d+)"/g)].map((r) => r[1]));
  const items = new Map(existing.filter((i) => refs.has(i.component)).map((i) => [itemKey(i), i] as const));
  let changed = items.size !== existing.length;
  for (const m of xml.matchAll(CONTROL_TAG)) {
    const ref = attrOf(m[1], 'Ref');
    if (!ref) continue;
    for (const path of ['Text', 'Font']) {
      const own = attrOf(m[1], path);
      if (own === undefined) continue;
      const k = itemKey({ component: ref, culture: 'Default', path });
      if (items.get(k)?.data === own) continue;
      items.set(k, { component: ref, culture: 'Default', path, data: own });
      changed = true;
    }
  }
  return changed ? writeLocalization(xml, [...items.values()]) : xml;
}

/**
 * A retype made while the Preview shows another language, written to that
 * language (2026-11-11, the review of CP-06). The Preview edits the file as
 * it is, so a label retyped while German shows lands in the control's own
 * `Text`, which `syncLocalization` then copies into the `Default` item: the
 * German would replace the English and the German item keep its old words.
 * Here every control of `before` whose `Text` differs in `after` gets its
 * `Text` back and the new words go to its item in `culture`. Controls new
 * in `after` are left alone; with no culture the file comes back as it is.
 */
export function retypeInCulture(before: string, after: string, culture: string): string {
  if (!culture || before === after) return after;
  const own = new Map<string, string | undefined>();
  for (const m of before.matchAll(CONTROL_TAG)) {
    const ref = attrOf(m[1], 'Ref');
    if (ref) own.set(ref, attrOf(m[1], 'Text'));
  }
  const items = new Map(localizationItems(after).map((i) => [itemKey(i), i] as const));
  let moved = 0;
  const restored = after.replace(CONTROL_TAG, (whole: string, attrs: string) => {
    const ref = attrOf(attrs, 'Ref');
    if (!ref || !own.has(ref)) return whole;
    const was = own.get(ref);
    const now = attrOf(attrs, 'Text');
    if (now === was || now === undefined) return whole;
    items.set(itemKey({ component: ref, culture, path: 'Text' }), { component: ref, culture, path: 'Text', data: now });
    moved++;
    return was === undefined
      ? whole.replace(/\sText="[^"]*"/, '')
      : whole.replace(/\sText="[^"]*"/, () => ` Text="${was}"`);
  });
  return moved ? writeLocalization(restored, [...items.values()]) : after;
}

/**
 * The report as it prints in `culture` (DevExpress's ApplyLocalization): each
 * control's `Text` and `Font` taken from that culture's items, else its
 * neutral parent's ("de" for "de-DE"), else the `Default` items; null or ''
 * is the report's own language. The Preview draws this for its language
 * switch; nothing is written back.
 */
export function inCulture(xml: string, culture: string | null): string {
  const items = localizationItems(xml);
  if (!items.length) return xml;
  const parent = culture?.split('-')[0] ?? '';
  const order = [culture ?? '', parent, 'Default'].filter((c, n, all) => c && all.indexOf(c) === n);
  const value = (component: string, path: string) => {
    for (const c of order) {
      const found = items.find((i) => i.component === component && i.culture === c && i.path === path);
      if (found) return found.data;
    }
    return undefined;
  };
  return xml.replace(CONTROL_TAG, (whole: string, attrs: string) => {
    const ref = attrOf(attrs, 'Ref');
    if (!ref) return whole;
    let out = whole;
    for (const path of ['Text', 'Font']) {
      const to = value(ref, path);
      if (to === undefined) continue;
      const written = ` ${path}="${to}"`;
      out = attrOf(out, path) !== undefined
        ? out.replace(new RegExp(`\\s${path}="[^"]*"`), () => written)
        : out.replace(/\s*(\/?)>$/, (_m, slash: string) => `${written}${slash ? ' /' : ''}>`);
    }
    return out;
  });
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
const LANGUAGE_NAME = `(?:${NAME_ALIASES.map(escapeRe).join('|')})`;
/**
 * "in English and German", "into English & French": two names joined after
 * in, into or to, the second captured (the first, after a translate verb,
 * may stand alone: "translate it, English and German").
 */
const LANGUAGE_PAIR = new RegExp(`(?<![\\p{L}\\p{N}])((?:in|into|to)\\s+)?(${LANGUAGE_NAME})\\s*(?:and|&|\\+|/)\\s*(${LANGUAGE_NAME})${WORD_END}${NOT_LANGUAGE}`, 'giu');
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
  // "in English and German": the language after "and" is the one added
  // (CP-06), as English is what nearly every report here is written in. A
  // pair that does not start with English ("into German and French") keeps
  // its first, as it did before pairs were read (2026-11-11, the review).
  const verb = TRANSLATE_VERB.exec(message);
  const pair = [...message.matchAll(LANGUAGE_PAIR)].find((m) => (m[1] || verb) && meansLanguage(m[2]) && meansLanguage(m[3]));
  if (pair) return languageName(pair[2]) === 'English' ? languageName(pair[3]) : languageName(pair[2]);
  if (verb) {
    const after = message.slice(verb.index);
    const named = pick(after, AFTER_VERB, true);
    if (named) return named;
    const m = /\b(?:into|to|in)\s+([A-Z][\p{L}-]+(?:\s[A-Z][\p{L}-]+)?)/u.exec(after);
    if (m) return languageName(m[1]);
  }
  return pick(message, IN_LANGUAGE, false);
}

/*
 * Whether the words ask for both languages rather than one in place of the
 * other (2026-11-11, the full audit's CP-06), decided from the words and
 * never asked: "bilingual", "in two languages", "in English and German",
 * "add German", "keep the English", "German as well", "alongside English".
 */
/** A word about the report's look rather than its language, after "keep the original" or "keep the English". */
const LOOK_WORD =
  '(?:layout|layouts|look|looks|design|format\\w*|fonts?|style|styles|styling|positions?|placement|sizes?|sizing|spacing|alignment|colou?rs?|structure|template|margins?|widths?|heights?|order|numerals?|digits?|dates?)\\b';
const BOTH_LANGUAGES = new RegExp(
  [
    '\\bbi-?lingual\\b',
    '\\b(?:two|both|2)\\s+languages\\b',
    `(?<![\\p{L}\\p{N}])${LANGUAGE_NAME}\\s*(?:and|&|\\+|/)\\s*${LANGUAGE_NAME}${WORD_END}${NOT_LANGUAGE}`,
    `\\badd(?:ing)?\\s+(?:an?\\s+)?${LANGUAGE_NAME}${WORD_END}(?!\\s+(?:font|fonts|title|label|heading|text|column|caption|numerals?|date|format)\\b)`,
    // Never "keep the original layout" or "keep the English font", which are
    // about the look (2026-11-11, the review of CP-06: "translate it into
    // German but keep the original layout" read as two languages).
    `\\bkeep(?:ing)?\\s+(?:the\\s+)?(?:${LANGUAGE_NAME}|original)${WORD_END}(?!\\s+${LOOK_WORD})`,
    `(?<![\\p{L}\\p{N}])${LANGUAGE_NAME}\\s+(?:as well|too|alongside|beside|next to)\\b`,
    `\\b(?:alongside|beside|as well as|in addition to)\\s+(?:the\\s+)?${LANGUAGE_NAME}${WORD_END}`,
  ].join('|'),
  'iu',
);

/** Whether a translation request keeps the report's own language beside the new one. */
export function keepsBoth(words: string): boolean {
  return BOTH_LANGUAGES.test(words);
}

/**
 * A translation put into the report the way the words ask: beside its own
 * language when they ask for both and Forma knows the language's culture,
 * else in place of it. `bilingual` says which was done.
 */
export function placeTranslations(
  xml: string,
  translations: ReadonlyMap<string, string>,
  language: string,
  words: string,
): { xml: string; changed: number; bilingual: boolean } {
  const culture = keepsBoth(words) ? cultureOf(language) : null;
  if (culture) {
    const out = localizeRepx(xml, culture, translations);
    if (out.changed) return { ...out, bilingual: true };
  }
  const replaced = applyTranslations(xml, translations);
  return { xml: syncLocalization(replaced.xml), changed: replaced.changed, bilingual: false };
}

/** What the reply says of a finished translation, in plain words. */
export function translatedLine(language: string, bilingual: boolean): string {
  return bilingual
    ? `Done, the report now carries ${language} beside its own language. Switch between them in the Preview.`
    : `Done, the report is in ${language}. Some labels are longer now; worth a look in the Preview.`;
}
