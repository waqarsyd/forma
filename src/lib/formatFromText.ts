/**
 * The format a value prints in, read off the page's own text (2026-11-11, the
 * full audit's CC-06).
 *
 * Forma's AI wrote no `TextFormatString` on any value in either picture case
 * of the Claude Code reference, only "Page {0} of {1}", and DevExpress printed
 * "10/14/2026 12:00 AM" (wrapped, then clipped), "1763.0", "18.0" and "1240"
 * where the page shows "14 Oct 2026", "1,763.00", "18.00" and "1,240". Forma
 * knows the page's text for every value it read, and `netFormat.ts` formats
 * as DevExpress does, so the format is found by trying the few a business page
 * uses and keeping the one that prints the page's text back exactly.
 *
 * - **Accepted only on an exact round trip.** A candidate is kept when
 *   `formatComposite` turns the value read out of the text into that text,
 *   character for character, for every sample given. Nothing is guessed: a
 *   text no candidate reproduces gets no format, and prints as it did.
 * - **Literal text around a number** is kept as the format's own: "USD
 *   1,957.86" is `USD {0:n2}`, "28.7%" is `{0:n1}%`. A percentage is not `p`,
 *   which multiplies by 100: the page's 28.7 is the value.
 * - **en-US**, as `netFormat.ts` is, which is what every DevExpress print in
 *   the parity table was made in. A day-first date is tried after month-first,
 *   so "05/06/2026" reads as May the 6th, as en-US prints it.
 *
 * `applyFormats` writes what was found onto the controls bound to a field;
 * `skeletonRepx.ts` uses `formatFor` as it builds a value or a total, and the
 * generation runs `applyFormats` over a report read from a picture.
 */
import { formatComposite } from './netFormat';
import { escapeXmlAttribute, unescapeXml } from './xmlEscape';

export interface PageFormat {
  /** A `TextFormatString`: `{0:n2}`, `USD {0:n2}`, `{0:dd MMM yyyy}`. */
  format: string;
  kind: 'number' | 'date';
  /** Each sample as the data would hold it: a plain number ("1763.00") or an ISO date ("2026-10-14"). */
  values: string[];
}

/**
 * A caption or a field name that says its column is a ratio: a percentage, a
 * rate, a margin or an average, which a total never sums (CC-05). Here, beside
 * the formats, because Forma's builder reads it as it writes a total, and
 * `totalsCheck.ts` as it checks one.
 */
export function isRatio(text: string): boolean {
  // A caption's words, or a field name's last word: MarginPct, TaxRate, not Separate.
  return /%|\b(margins?|rates?|pct|percent(age)?s?|ratios?|averages?|avg|mean)\b/i.test(text) || /[a-z0-9](Pct|Percent|Percentage|Rate|Ratio|Avg|Margin)$/.test(text);
}

/**
 * The narrower question a builder has to answer before it averages a total
 * nobody asked it to: does the caption or field *say* ratio, by a percent
 * sign or a word that means nothing else? "Margin" and "Rate" do not: a
 * sales report's "Gross Margin" is money beside Revenue and Cost, and an
 * Indian invoice's "Rate" column is often totalled, so both stay sums unless
 * the page's values carry a "%" (2026-11-11, the review of CC-05). `isRatio`
 * stays wider because it only ever raises a warning.
 */
export function saysRatio(text: string): boolean {
  return /%|\b(pct|percent(age)?s?|ratios?|averages?|avg|mean)\b/i.test(text) || /[a-z0-9](Pct|Percent|Percentage|Ratio|Avg|Average|Mean)$/.test(text);
}

/** A number with what prints around it; the prefix and suffix hold no digit. */
const NUMBER = /^([^\d]*?)(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)([^\d]*)$/;

/**
 * One text read as a number with what prints around it, or null. A minus
 * sign is a sign only at the start or after a space or a currency symbol:
 * the hyphen in "SKU-1001" or "INV-001" is part of a code, and reading it as
 * a minus made a product code a negative number and its format `SKU{0}`,
 * which DevExpress printed over the real "SKU-1001" as "SKUSKU-1001"
 * (2026-11-11, the review of CC-06). The hyphen then stays in the prefix,
 * where the letters around it reject the text.
 */
function numberParts(text: string): { prefix: string; number: string; suffix: string } | null {
  const m = NUMBER.exec(text);
  if (!m) return null;
  let [prefix, number] = [m[1], m[2]];
  if (number.startsWith('-') && prefix && !/[\s\p{Sc}]$/u.test(prefix)) [prefix, number] = [prefix + '-', number.slice(1)];
  return { prefix, number, suffix: m[3] };
}

/** `{` and `}` in literal text, as a composite format string writes them. */
const literal = (text: string) => text.replace(/\{/g, '{{').replace(/\}/g, '}}');

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const monthOf = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;

/**
 * The date shapes a page prints, each with the formats that could have
 * printed it and how to read the day, month and year back out of it.
 */
const DATES: { re: RegExp; formats: string[]; read: (m: RegExpExecArray, format: string) => [number, number, number] | null }[] = [
  {
    // 14 Oct 2026, 4 October 2026
    re: /^(\d{1,2}) ([A-Za-z]{3,9}) (\d{4})$/,
    formats: ['{0:dd MMM yyyy}', '{0:d MMM yyyy}', '{0:dd MMMM yyyy}', '{0:d MMMM yyyy}'],
    read: (m) => [Number(m[3]), monthOf(m[2]), Number(m[1])],
  },
  {
    // Oct 14, 2026, October 4, 2026
    re: /^([A-Za-z]{3,9}) (\d{1,2}), (\d{4})$/,
    formats: ['{0:MMM d, yyyy}', '{0:MMMM d, yyyy}', '{0:MMM dd, yyyy}'],
    read: (m) => [Number(m[3]), monthOf(m[1]), Number(m[2])],
  },
  {
    // 10/14/2026 (en-US), 14/10/2026
    re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    formats: ['{0:MM/dd/yyyy}', '{0:M/d/yyyy}', '{0:dd/MM/yyyy}', '{0:d/M/yyyy}'],
    read: (m, format) => (/\{0:d/.test(format) ? [Number(m[3]), Number(m[2]), Number(m[1])] : [Number(m[3]), Number(m[1]), Number(m[2])]),
  },
  {
    re: /^(\d{4})-(\d{2})-(\d{2})$/,
    formats: ['{0:yyyy-MM-dd}'],
    read: (m) => [Number(m[1]), Number(m[2]), Number(m[3])],
  },
];

/** The value one date text holds under one format, when the format prints it back exactly. */
function dateUnder(text: string, format: string): string | null {
  for (const shape of DATES) {
    if (!shape.formats.includes(format)) continue;
    const m = shape.re.exec(text);
    if (!m) return null;
    const ymd = shape.read(m, format);
    if (!ymd) return null;
    const [y, mo, d] = ymd;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const date = new Date(y, mo - 1, d);
    if (date.getMonth() !== mo - 1) return null;
    return formatComposite(format, [date]) === text ? iso(y, mo, d) : null;
  }
  return null;
}

/** The value one number text holds under one format, when the format prints it back exactly. */
function numberUnder(text: string, format: string): string | null {
  const parts = numberParts(text);
  if (!parts) return null;
  const value = parts.number.replace(/,/g, '');
  return formatComposite(format, [value]) === text ? value : null;
}

/** The candidates for one text, likeliest first; none for a text that is neither a number nor a date. */
function candidates(text: string): { format: string; kind: PageFormat['kind'] }[] {
  const dates = DATES.filter((d) => d.re.test(text)).flatMap((d) => d.formats.map((format) => ({ format, kind: 'date' as const })));
  if (dates.length) return dates;
  const parts = numberParts(text);
  if (!parts) return [];
  const [prefix, suffix] = [literal(parts.prefix), literal(parts.suffix)];
  /*
   * A letter around a number is a label or a code, not a format ("Page 2",
   * "Item 3 of 5", "ABC123", "A-12"). The one exception is a currency code
   * and a space before it, "USD 1,957.86"; with no space it is a code.
   */
  const currency = /^[A-Z]{3} $/.test(parts.prefix);
  if (/[A-Za-z]/.test(parts.suffix) || (/[A-Za-z]/.test(parts.prefix) && !currency)) return [];
  // An accounting negative, "(1,234.00)": the parentheses are the sign, and
  // `({0:n2})` would print a negative value as "(-1,234.00)". Not guessed.
  if (parts.prefix.endsWith('(') && parts.suffix.startsWith(')')) return [];
  const numbers = ['{0:n0}', '{0:n1}', '{0:n2}', '{0:n3}', '{0:n4}'].map((n) => `${prefix}${n}${suffix}`);
  // Literal text round a number with no separators: the value's own text
  // inside it ("#1042"). Never beside a letter, which only a code carries.
  if ((prefix || suffix) && !currency) numbers.push(`${prefix}{0}${suffix}`);
  return numbers.map((format) => ({ format, kind: 'number' as const }));
}

/**
 * The one format that prints every sample exactly as the page did, or null
 * when no candidate does, a sample is not a number or a date, or there is no
 * sample at all.
 */
export function formatFor(samples: string | readonly string[]): PageFormat | null {
  const texts = (typeof samples === 'string' ? [samples] : [...samples]).map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (!texts.length) return null;
  for (const c of candidates(texts[0])) {
    const values: string[] = [];
    for (const text of texts) {
      const value = c.kind === 'date' ? dateUnder(text, c.format) : numberUnder(text, c.format);
      if (value === null) break;
      values.push(value);
    }
    if (values.length === texts.length) return { format: c.format, kind: c.kind, values };
  }
  return null;
}

/**
 * What a sample is worth as data: the value its format reads out of it, or
 * the text itself when it has none (a name, a code, a word).
 */
export function valueOfText(text: string): string {
  return formatFor(text)?.values[0] ?? text.trim();
}

/**
 * Whether a format is nothing worth writing: whole numbers the page prints
 * with no separator, which `{0:n0}` prints no differently and would round if
 * the data held a fraction. A format with decimals is always worth writing,
 * whatever the samples: the page's "18.00" holds the decimals, the data's
 * 18.0 may not, and DevExpress printed "18.0".
 */
export function isPlain(format: PageFormat): boolean {
  return format.format === '{0:n0}' && format.values.every((v) => formatComposite(format.format, [v]) === v);
}

/** A `Text` binding's expression in one control's own part of the file. */
const TEXT_BINDING = /<Item\d+\b(?=[^>]*\sPropertyName="Text")[^>]*\sExpression="([^"]*)"/;

/** A control that prints text, by its opening tag. */
const TEXT_CONTROL = /<(Item\d+)\b([^>]*\sControlType="(?:XRLabel|XRTableCell)"[^>]*?)(\/?)>/g;

/**
 * The field a total is a total of: the one an aggregate reads, or, in a
 * weighted average (`sumSum([Revenue] * [MarginPct]) / sumSum([Revenue])`),
 * the one read least often, since the weight is read twice. Null for an
 * expression that totals nothing.
 */
function totalSubject(expression: string): string | null {
  if (!/^\s*sum\w*\s*\(/i.test(expression)) return null;
  const fields = [...expression.replace(/'(?:[^']|'')*'/g, "''").matchAll(/\[([^\][]+)\]/g)].map((m) => m[1]);
  if (!fields.length) return null;
  const count = (f: string) => fields.filter((g) => g === f).length;
  return [...new Set(fields)].sort((a, b) => count(a) - count(b))[0];
}

/**
 * A `TextFormatString` on each label and table cell that prints one field,
 * or a total of one (`totalSubject`), and has none: `values` names a field's format
 * for a record's value, `totals` for a total over it (a page often prints its
 * totals with the values' format, so the caller passes the values' format
 * there when the page shows no total). A control with a format of its own
 * keeps it; one whose expression is anything else is left alone.
 */
export function applyFormats(
  xml: string,
  formats: { values?: Readonly<Record<string, string>>; totals?: Readonly<Record<string, string>> },
): { xml: string; applied: boolean; reason: string; count: number } {
  let count = 0;
  const out = xml.replace(TEXT_CONTROL, (whole, tag: string, attrs: string, selfClosed: string, at: number) => {
    if (selfClosed || /\sTextFormatString="/.test(attrs)) return whole;
    // The control's own part: up to its first child control, or its end.
    const rest = xml.slice(at + whole.length);
    const end = rest.search(new RegExp(`</${tag}>|<Item\\d+\\b[^>]*\\sControlType="`));
    const own = end < 0 ? rest : rest.slice(0, end);
    const expression = unescapeXml(TEXT_BINDING.exec(own)?.[1] ?? '').trim();
    const value = /^\[([^\][]+)\]$/.exec(expression)?.[1];
    const total = totalSubject(expression);
    const format = value ? formats.values?.[value] : total ? formats.totals?.[total] ?? formats.values?.[total] : undefined;
    if (!format) return whole;
    count++;
    return `<${tag}${attrs} TextFormatString="${escapeXmlAttribute(format)}">`;
  });
  return count
    ? { xml: out, applied: true, reason: `wrote the page's format on ${count} value(s)`, count }
    : { xml, applied: false, reason: 'no value needed a format', count: 0 };
}
