/**
 * Which field a report's column prints (2026-11-09, the SQL Server
 * programme, item 23): by its heading and by the value it shows, with a
 * confidence, so the Data tab can say how sure each suggestion is and list
 * the columns nothing matched with the likeliest fields as one-click fixes.
 *
 * `suggestMapping` (dataSource.ts) matched names alone, exactly then by
 * containment, and said nothing about how sure it was. A database brings two
 * more kinds of evidence: the layout's sample values, and its types. A
 * column headed "Cust." showing "Alfreds" is `CompanyName` when the sample
 * rows hold "Alfreds", whatever the heading says, and a column showing
 * "1,240.50" is not a `datetime`. A value found in the samples is strong
 * evidence; a type that cannot hold the value shown counts against.
 *
 * Pure, so the Data tab (and `databaseAi.ts`, for the words) can share it.
 */
import type { FieldType } from './dataSource';

/* ------------------------------------------------------------ words */

const STOP = new Set([
  'the', 'an', 'of', 'and', 'or', 'by', 'for', 'with', 'per', 'to', 'in', 'on', 'from', 'at', 'as', 'is', 'it', 'this', 'that',
  'report', 'list', 'all', 'each', 'every', 'show', 'make', 'me', 'my', 'our', 'please', 'add', 'new', 'page',
  'usp', 'sp', 'tbl', 'vw', 'dbo', 'fn',
]);

/** Short forms a heading uses for what a column spells out. */
export const SYNONYMS: Record<string, string> = {
  qty: 'quantity', amt: 'amount', no: 'number', num: 'number', nbr: 'number', desc: 'description', dt: 'date',
  cust: 'customer', inv: 'invoice', prod: 'product', addr: 'address', tel: 'phone', telephone: 'phone', mobile: 'phone',
  co: 'company', comp: 'company', dept: 'department', emp: 'employee',
};

function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(sses|xes|ches|shes)$/.test(word)) return word.slice(0, -2);
  return word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/** "usp_SalesByRegion" and "sales by region" both into `sale`, `region`. */
export function wordsOf(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => SYNONYMS[w] ?? w)
    .map(stem);
}

/* ------------------------------------------------------------ evidence */

export interface ColumnEvidence {
  /** The heading above the column, as the report prints it. */
  heading: string;
  /** What the column shows in the report or its source, when known. */
  sample?: string;
}

export interface FieldEvidence {
  name: string;
  type: FieldType;
  /** Values the field holds, from the database's sample rows or a pasted sample. */
  samples?: readonly string[];
}

export type MatchLevel = 'high' | 'medium' | 'low';

export interface ColumnMatch {
  field: string | null;
  /** 0 to 1. */
  score: number;
  level: MatchLevel | null;
  /** Why, in a few words: "the heading is its name", "its value is in the samples". */
  why: string;
  /** The next likeliest fields, for a one-click fix. */
  alternatives: string[];
}

/** Below this nothing is suggested: a hole in the form beats a confident wrong field. */
export const MATCH_FLOOR = 0.45;

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
/** A value as it compares: "1,240.50" and "1240.5" are one number; text by its letters, case aside. */
const valueKey = (value: string) => {
  const text = value.trim().toLowerCase().replace(/^[$€£₹]\s*/, '').replace(/,(?=\d{3}\b)/g, '');
  return /^-?\d+(\.\d+)?$/.test(text) ? String(Number(text)) : text;
};

function looksLike(sample: string): FieldType | null {
  const s = sample.trim();
  if (!s) return null;
  if (/^(true|false|yes|no)$/i.test(s)) return 'boolean';
  if (/^[-+(]?[$€£₹]?\s*\d[\d,]*(\.\d+)?\)?%?$/.test(s)) return 'number';
  if (/^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/.test(s) || /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d/i.test(s)) return 'date';
  return /[a-z]/i.test(s) ? 'string' : null;
}

/** How likely a field is the one a column prints, and why. */
export function scoreMatch(column: ColumnEvidence, field: FieldEvidence): { score: number; why: string } {
  const why: string[] = [];
  let score = 0;
  const head = squash(column.heading);
  const name = squash(field.name);
  if (head && head === name) {
    score = 1;
    why.push('the heading is its name');
  } else if (head.length >= 3 && name.length >= 3 && (name.includes(head) || head.includes(name))) {
    score = 0.75;
    why.push('the heading holds its name');
  } else {
    const a = new Set(wordsOf(column.heading));
    const b = new Set(wordsOf(field.name));
    const shared = [...a].filter((w) => b.has(w)).length;
    if (shared && a.size && b.size) {
      const whole = shared === a.size || shared === b.size;
      score = whole ? 0.7 : 0.4 * (shared / Math.max(a.size, b.size));
      why.push(whole ? 'the same words' : 'some of the same words');
    }
  }
  const sample = column.sample?.trim() ?? '';
  if (sample && field.samples?.length) {
    const key = valueKey(sample);
    if (field.samples.some((v) => valueKey(String(v)) === key)) {
      score = score ? Math.min(1, score + 0.35) : 0.55;
      why.push('its value is in the samples');
    }
  }
  const shape = looksLike(sample);
  // A text column takes anything; any other cannot hold a value of another shape.
  if (shape && field.type !== 'string') {
    if (shape === field.type) score = Math.min(1, score + (score ? 0.05 : 0));
    else {
      score = Math.max(0, score - 0.35);
      why.push(`"${sample}" is not a ${field.type}`);
    }
  }
  return { score: Math.round(score * 100) / 100, why: why.join(', ') };
}

const levelOf = (score: number): MatchLevel => (score >= 0.85 ? 'high' : score >= 0.6 ? 'medium' : 'low');

/**
 * Each column's field, the likeliest pairs first and each field used once
 * (two columns printing one field is a mistake worth seeing), with how sure.
 */
export function matchColumns(columns: readonly ColumnEvidence[], fields: readonly FieldEvidence[]): ColumnMatch[] {
  const scores = columns.map((c) => fields.map((f) => scoreMatch(c, f)));
  const pairs = scores.flatMap((row, i) => row.map((s, k) => ({ i, k, ...s }))).filter((p) => p.score >= MATCH_FLOOR).sort((a, b) => b.score - a.score || a.i - b.i || a.k - b.k);
  const taken = new Set<number>();
  const chosen = new Map<number, (typeof pairs)[number]>();
  for (const p of pairs) {
    if (chosen.has(p.i) || taken.has(p.k)) continue;
    chosen.set(p.i, p);
    taken.add(p.k);
  }
  return columns.map((_, i) => {
    const pick = chosen.get(i);
    const alternatives = scores[i]
      .map((s, k) => ({ k, score: s.score }))
      .filter((s) => s.k !== pick?.k && s.score >= 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => fields[s.k].name);
    return pick
      ? { field: fields[pick.k].name, score: pick.score, level: levelOf(pick.score), why: pick.why, alternatives }
      : { field: null, score: 0, level: null, why: 'nothing matched its heading or its value', alternatives };
  });
}

/**
 * A field renamed everywhere the report prints or groups by it: every
 * `[Old]` in an expression (a total's `sumSum([Old])` too) and a group's
 * `FieldName`. The one-click fix for a column bound to a field the chosen
 * query does not have; `Text`, the fallback, is left as it was.
 *
 * `where`, given an attribute's offset in `xml`, says whether that place is
 * renamed (2026-11-11, the full audit, SD-26): a rename found for one query
 * leaves a detail band reading another query's field of the same name alone.
 * Both attributes are found in one pass, so every offset is the input's.
 */
export function renameField(xml: string, from: string, to: string, where?: (at: number) => boolean): { xml: string; count: number } {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const field = new RegExp(`^${esc}$`, 'i');
  let count = 0;
  const out = xml.replace(/(\s(?:Expression|FieldName)=")([^"]*)(")/g, (whole: string, a: string, value: string, b: string, at: number) => {
    if (where && !where(at)) return whole;
    if (a.includes('FieldName')) {
      if (!field.test(value)) return whole;
      count++;
      return `${a}${to}${b}`;
    }
    const next = value.replace(new RegExp(`\\[${esc}\\]`, 'gi'), () => {
      count++;
      return `[${to}]`;
    });
    return `${a}${next}${b}`;
  });
  return { xml: out, count };
}
