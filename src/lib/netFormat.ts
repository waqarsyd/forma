/**
 * .NET composite formatting, as far as a report prints it.
 *
 * DevExpress formats every value it prints with .NET's own rules:
 * `TextFormatString="Page {0} of {1}"`, `{0:yyyy-MM-dd}`, `{0:c2}`. To preview
 * what DevExpress will print, this pane needs the same rules, and it is the one
 * place they may be written, so a page number and (from parity row 12) a data
 * cell format identically.
 *
 * ## Culture
 *
 * en-US, fixed. DevExpress formats in the culture of the machine running the
 * report, which the browser cannot know; en-US is what every measurement in
 * `docs/proposals/devexpress-parity.md` was printed in, so this matches those
 * exactly and is a stated assumption everywhere else.
 *
 * ## What is implemented, and what is not yet
 *
 * Composite strings (`{index[,alignment][:format]}` with `{{` and `}}`), the
 * standard and custom DATE formats, and -- since row 12 printed them -- the
 * standard and custom NUMBER formats. Every case was printed through
 * DevExpress 20.1 on 2026-10-30, twenty number formats over twelve values
 * chosen to expose sign, zero and rounding (case s15):
 *
 * - **midpoints round away from zero**: 2.345 -> `2.35`, 2.355 -> `2.36`,
 *   2.5 -> `3` with `c0`, -2.5 -> `-3`; decimal and double columns printed
 *   identically, so a double is formatted through its 15 significant digits;
 * - **currency negatives are bracketed**: `($1,234.50)`;
 * - `p` multiplies by 100 and groups: `123,450.00%`; `e2` writes a three-digit
 *   exponent: `1.23e+003`; `x` writes a negative int in 32-bit two's
 *   complement: `fffffff9`;
 * - a custom format's sections apply to positive, negative and zero:
 *   `#,##0.00;(#,##0.00);Zero` printed `(1,234.50)` and `Zero`.
 *
 * A format this does not know prints the value's plain text.
 */

import { NetDecimal } from './netDecimal';
import { parseDate, setFormatter, valueText, type Value } from './criteria';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** en-US standard date patterns, as .NET defines them. */
const STANDARD_DATE: Record<string, string> = {
  d: 'M/d/yyyy',
  D: 'dddd, MMMM d, yyyy',
  t: 'h:mm tt',
  T: 'h:mm:ss tt',
  f: 'dddd, MMMM d, yyyy h:mm tt',
  F: 'dddd, MMMM d, yyyy h:mm:ss tt',
  g: 'M/d/yyyy h:mm tt',
  G: 'M/d/yyyy h:mm:ss tt',
  M: 'MMMM d',
  m: 'MMMM d',
  Y: 'MMMM yyyy',
  y: 'MMMM yyyy',
  s: "yyyy'-'MM'-'dd'T'HH':'mm':'ss",
};

/**
 * A date in a .NET custom or standard date format.
 *
 * An empty format is .NET's `G`. A DateTime printed with NO format string at
 * all is a different case and is the caller's choice: `XRPageInfo` prints the
 * long date, `D`, which is what DevExpress drew.
 */
export function formatDate(date: Date, format: string): string {
  const pattern = format.length === 1 && STANDARD_DATE[format] ? STANDARD_DATE[format] : format || STANDARD_DATE.G;
  let out = '';
  for (let i = 0; i < pattern.length; ) {
    const ch = pattern[i];
    if (ch === "'" || ch === '"') {
      const end = pattern.indexOf(ch, i + 1);
      out += pattern.slice(i + 1, end === -1 ? undefined : end);
      i = end === -1 ? pattern.length : end + 1;
      continue;
    }
    if (ch === '\\') {
      out += pattern[i + 1] ?? '';
      i += 2;
      continue;
    }
    let run = 1;
    while (pattern[i + run] === ch) run++;
    const hours12 = date.getHours() % 12 || 12;
    switch (ch) {
      case 'd':
        out += run === 1 ? date.getDate() : run === 2 ? pad(date.getDate(), 2) : run === 3 ? DAYS[date.getDay()].slice(0, 3) : DAYS[date.getDay()];
        break;
      case 'M':
        out += run === 1 ? date.getMonth() + 1 : run === 2 ? pad(date.getMonth() + 1, 2) : run === 3 ? MONTHS[date.getMonth()].slice(0, 3) : MONTHS[date.getMonth()];
        break;
      case 'y':
        out += run <= 2 ? pad(date.getFullYear() % 100, run) : pad(date.getFullYear(), run);
        break;
      case 'H':
        out += pad(date.getHours(), Math.min(run, 2));
        break;
      case 'h':
        out += pad(hours12, Math.min(run, 2));
        break;
      case 'm':
        out += pad(date.getMinutes(), Math.min(run, 2));
        break;
      case 's':
        out += pad(date.getSeconds(), Math.min(run, 2));
        break;
      case 't':
        out += (date.getHours() < 12 ? 'AM' : 'PM').slice(0, run === 1 ? 1 : 2);
        break;
      default:
        out += ch.repeat(run);
    }
    i += run;
  }
  return out;
}

// ----------------------------------------------------------------- numbers

/** Thousands separators, en-US. */
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** A numeric value as an exact decimal, or null when it is not one. */
function asDecimal(value: unknown): NetDecimal | null {
  if (value instanceof NetDecimal) return value;
  if (typeof value === 'bigint') return NetDecimal.fromInt(value);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) && Math.abs(value) < 2 ** 53 ? NetDecimal.fromInt(BigInt(value)) : NetDecimal.fromNumber(value);
  }
  return null;
}

/** Whole and fractional digits of |d| rounded half away to `places`. */
function digitsOf(d: NetDecimal, places: number): { negative: boolean; whole: string; fraction: string } {
  const rounded = d.roundAway(places);
  const text = rounded.abs().toString();
  const [whole, fraction = ''] = text.split('.');
  return { negative: rounded.sign() < 0, whole, fraction: fraction.padEnd(places, '0') };
}

function standardNumber(value: unknown, letter: string, precisionText: string): string | null {
  const d = asDecimal(value);
  if (!d) return null;
  const lower = letter.toLowerCase();
  const precision = precisionText === '' ? null : Number(precisionText);
  const fixed = (places: number, grouped: boolean) => {
    const { negative, whole, fraction } = digitsOf(d, places);
    const body = (grouped ? group(whole) : whole) + (places ? `.${fraction}` : '');
    return { negative, body };
  };
  switch (lower) {
    case 'c': {
      const { negative, body } = fixed(precision ?? 2, true);
      return negative ? `($${body})` : `$${body}`;
    }
    case 'n': { const { negative, body } = fixed(precision ?? 2, true); return (negative ? '-' : '') + body; }
    case 'f': { const { negative, body } = fixed(precision ?? 2, false); return (negative ? '-' : '') + body; }
    case 'p': {
      const { negative, whole, fraction } = digitsOf(d.mul(NetDecimal.fromInt(100n)), precision ?? 2);
      const places = precision ?? 2;
      return `${negative ? '-' : ''}${group(whole)}${places ? `.${fraction}` : ''}%`;
    }
    case 'e': {
      const places = precision ?? 6;
      const x = d.toNumber();
      if (x === 0) return `${(0).toFixed(places)}${letter}+000`;
      let exponent = Math.floor(Math.log10(Math.abs(x)));
      let mantissa = NetDecimal.fromNumber(x / 10 ** exponent).roundAway(places);
      if (Math.abs(mantissa.toNumber()) >= 10) {
        exponent += 1;
        mantissa = NetDecimal.fromNumber(x / 10 ** exponent).roundAway(places);
      }
      const m = digitsOf(mantissa, places);
      return `${m.negative ? '-' : ''}${m.whole}${places ? `.${m.fraction}` : ''}${letter}${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(3, '0')}`;
    }
    case 'd': {
      // Whole numbers only; .NET refuses `d` for a fraction.
      if (d.scale !== 0 && d.roundAway(0).compare(d) !== 0) return null;
      const n = d.roundAway(0);
      const text = n.abs().toString().padStart(precision ?? 1, '0');
      return (n.sign() < 0 ? '-' : '') + text;
    }
    case 'x': {
      if (d.scale !== 0) return null;
      const hex = BigInt.asUintN(32, d.mantissa).toString(16).padStart(precision ?? 1, '0');
      return letter === 'X' ? hex.toUpperCase() : hex;
    }
    case 'g': case 'r': return valueText(value as Value);
  }
  return null;
}

/** Split a custom format into its ;-sections, respecting quotes and escapes. */
function sections(format: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < format.length; i++) {
    const ch = format[i];
    if (quote) { current += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; continue; }
    if (ch === '\\') { current += ch + (format[i + 1] ?? ''); i++; continue; }
    if (ch === ';') { out.push(current); current = ''; continue; }
    current += ch;
  }
  out.push(current);
  return out;
}

/** Apply one custom section, e.g. `#,##0.00` or `(#,##0.00)`, to a magnitude. */
function customSection(section: string, d: NetDecimal, withSign: boolean): string {
  // Separate literal text from the number pattern.
  let prefix = '';
  let suffix = '';
  let pattern = '';
  let seenDigit = false;
  let percent = false;
  for (let i = 0; i < section.length; i++) {
    const ch = section[i];
    let literal: string | null = null;
    if (ch === "'" || ch === '"') {
      const end = section.indexOf(ch, i + 1);
      literal = section.slice(i + 1, end === -1 ? undefined : end);
      i = end === -1 ? section.length : end;
    } else if (ch === '\\') {
      literal = section[i + 1] ?? '';
      i++;
    } else if ('0#.,'.includes(ch)) {
      pattern += ch;
      seenDigit = seenDigit || ch === '0' || ch === '#';
      continue;
    } else {
      if (ch === '%') percent = true;
      literal = ch;
    }
    if (seenDigit || pattern) suffix += literal;
    else prefix += literal;
  }
  const point = pattern.indexOf('.');
  const intPattern = point === -1 ? pattern : pattern.slice(0, point);
  const fracPattern = point === -1 ? '' : pattern.slice(point + 1);
  const minInt = (intPattern.match(/0/g) ?? []).length;
  const minFrac = (fracPattern.match(/0/g) ?? []).length;
  const maxFrac = (fracPattern.match(/[0#]/g) ?? []).length;
  const grouped = /[0#],[0#]/.test(intPattern);
  const value = percent ? d.mul(NetDecimal.fromInt(100n)) : d;
  const { negative, whole, fraction } = digitsOf(value, maxFrac);
  let frac = fraction;
  while (frac.length > minFrac && frac.endsWith('0')) frac = frac.slice(0, -1);
  let intText = whole === '0' && minInt === 0 ? '' : whole.padStart(minInt, '0');
  if (grouped) intText = group(intText);
  const number = intText + (frac ? `.${frac}` : '');
  return `${withSign && negative ? '-' : ''}${prefix}${number}${suffix}`;
}

function customNumber(value: unknown, format: string): string | null {
  const d = asDecimal(value);
  if (!d) return null;
  const parts = sections(format);
  const places = (s: string) => {
    const point = s.indexOf('.');
    return point === -1 ? 0 : (s.slice(point + 1).match(/[0#]/g) ?? []).length;
  };
  const rounded = d.roundAway(places(parts[0]));
  if (rounded.isZero() && parts.length >= 3) return customSection(parts[2], d.abs(), false);
  if (d.sign() < 0 && parts.length >= 2 && parts[1] !== '') return customSection(parts[1], d.abs(), false);
  return customSection(parts[0], d, true);
}

/** A string from test data, read as the type a format string expects. */
function coerce(value: unknown, spec: string): unknown {
  if (typeof value !== 'string' || spec === '') return value;
  if (/^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  const decimal = NetDecimal.parse(value);
  if (decimal) return decimal;
  return parseDate(value) ?? value;
}

/** One argument in one format specifier; see the header for what is covered. */
function formatOne(raw: unknown, spec: string): string {
  const value = coerce(raw, spec);
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatDate(value, spec);
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (spec === '') return valueText(value as Value);
  const standard = /^([cCnNfFpPeEdDxXgGrR])(\d{0,2})$/.exec(spec);
  const text = standard ? standardNumber(value, standard[1], standard[2]) : customNumber(value, spec);
  return text ?? valueText(value as Value);
}

/**
 * `.NET String.Format`: `{index[,alignment][:format]}`, with `{{` and `}}` as
 * literal braces. An index with no argument prints nothing here rather than
 * throwing; what DevExpress does with one has not been measured.
 */
export function formatComposite(format: string, args: readonly unknown[]): string {
  let out = '';
  for (let i = 0; i < format.length; i++) {
    const ch = format[i];
    if (ch === '{' && format[i + 1] === '{') { out += '{'; i++; continue; }
    if (ch === '}' && format[i + 1] === '}') { out += '}'; i++; continue; }
    if (ch !== '{') { out += ch; continue; }
    const close = format.indexOf('}', i);
    if (close === -1) { out += format.slice(i); break; }
    const m = /^(\d+)(?:,(-?\d+))?(?::(.*))?$/.exec(format.slice(i + 1, close));
    if (!m) { out += format.slice(i, close + 1); i = close; continue; }
    let text = formatOne(args[Number(m[1])], m[3] ?? '');
    const width = m[2] ? Number(m[2]) : 0;
    if (width > 0) text = text.padStart(width);
    else if (width < 0) text = text.padEnd(-width);
    out += text;
    i = close;
  }
  return out;
}

// FormatString() inside an expression formats exactly as TextFormatString does.
setFormatter(formatComposite);

/** Lower-case Roman numerals, as `RomLowNumber` prints them: `i`, `ii`, `iv`. */
export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n <= 0) return String(n);
  const table: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let out = '';
  let rest = n;
  for (const [value, letters] of table) {
    while (rest >= value) { out += letters; rest -= value; }
  }
  return out;
}
