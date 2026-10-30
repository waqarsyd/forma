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
 * standard and custom DATE formats, and whole numbers. Those are what page
 * numbers need, and each was printed through DevExpress 20.1 on 2026-10-30:
 * `{0:yyyy-MM-dd}` gave `2026-10-30`, no format gave `Friday, October 30,
 * 2026`, and `{0:} of {1}` gave `1 of 2`. Money and decimals (`c2`, `n2`,
 * `#,##0.00`) are deliberately absent until row 12 prints them, negatives
 * included: a guessed currency pattern previews a plausible wrong number.
 * Anything not implemented falls back to the value's plain text.
 */

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

/** One argument in one format specifier; see the header for what is covered. */
function formatOne(value: unknown, spec: string): string {
  if (value instanceof Date) return formatDate(value, spec);
  if (typeof value === 'number' && Number.isInteger(value) && (spec === '' || /^[dDgG]$/.test(spec))) {
    return String(value);
  }
  return value === null || value === undefined ? '' : String(value);
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
