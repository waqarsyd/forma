/**
 * DevExpress's criteria language: parsed, and evaluated the way DevExpress
 * evaluates it, so the Preview prints what the report prints.
 *
 * Every expression in a report -- a binding's `Expression`, a calculated
 * field, a `FilterString`, a summary -- is this language. The semantics below
 * were measured by printing 44 expressions and 11 summaries through
 * DevExpress 20.1 with `RepxProbe render` on 2026-10-30 (row 12 of
 * `docs/proposals/devexpress-parity.md`), and the types follow .NET's:
 *
 * - **whole numbers are integers** (`bigint` here): `[Qty] / 4` printed 0, 1,
 *   1, 2 -- truncating -- and `[Qty] % 4` the remainder;
 * - **decimals are `NetDecimal`**, scale kept: `[Qty] * [Price]` printed
 *   `4.0` for 8 x 0.5, and a decimal divided by 3 printed 28 places;
 * - **a literal with a decimal point is a double**: `[Qty] / 4.0` printed 0.25,
 *   1, 1.5, and `Round([Price] * 1.175, 2)` rounded a double;
 * - **`Round` rounds half to even**: `Round(2.5)` printed 2, `Round(3.5)` 4,
 *   `Round(-2.5)` -2;
 * - **`+` with a string on either side concatenates**: `'Q' + [Qty]` printed Q1;
 * - **`Substring` counts from 0**: `Substring('Alpha', 1, 2)` printed `lp`;
 * - **a field the data does not have is null**, which prints nothing;
 * - **booleans print as `True` and `False`**, dates in the general pattern;
 * - **`Iif` takes condition-value pairs and a final else**.
 *
 * Aggregates (`sumSum`, `sumAvg`, `sumRunningSum`, ...) are evaluated by the
 * caller, which knows which records a summary runs over; see `Env.aggregate`.
 */
import { NetDecimal } from './netDecimal';

/** A value as .NET would hold it: integers as bigint, doubles as number. */
export type Value = null | boolean | string | Date | bigint | number | NetDecimal;

export type Node =
  | { kind: 'lit'; value: Value }
  | { kind: 'field'; name: string }
  | { kind: 'param'; name: string }
  | { kind: 'unary'; op: string; arg: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] }
  | { kind: 'in'; arg: Node; list: Node[] }
  | { kind: 'between'; arg: Node; low: Node; high: Node }
  | { kind: 'isnull'; arg: Node; negate: boolean };

export interface Env {
  field(name: string): Value;
  param(name: string): Value;
  /** An aggregate over the records the current summary runs over. */
  aggregate?(name: string, args: Node[]): Value;
  now?: Date;
}

// ------------------------------------------------------------------ lexing

type Token =
  | { t: 'num'; v: string }
  | { t: 'str'; v: string }
  | { t: 'date'; v: string }
  | { t: 'field'; v: string }
  | { t: 'param'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string };

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "'") {
      let s = '';
      i++;
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") { s += "'"; i += 2; continue; }
        if (text[i] === "'") break;
        s += text[i++];
      }
      i++;
      out.push({ t: 'str', v: s });
      continue;
    }
    if (ch === '[') {
      const end = text.indexOf(']', i);
      if (end === -1) throw new Error('unclosed [');
      out.push({ t: 'field', v: text.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (ch === '#') {
      const end = text.indexOf('#', i + 1);
      if (end === -1) throw new Error('unclosed #');
      out.push({ t: 'date', v: text.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (ch === '?') {
      const m = /^\?([A-Za-z_]\w*)/.exec(text.slice(i));
      if (!m) throw new Error('bad parameter');
      out.push({ t: 'param', v: m[1] });
      i += m[0].length;
      continue;
    }
    const num = /^(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?([mMdDfF])?/.exec(text.slice(i));
    if (num && /[\d.]/.test(ch)) {
      out.push({ t: 'num', v: num[0] });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][\w.]*/.exec(text.slice(i));
    if (id) {
      out.push({ t: 'id', v: id[0] });
      i += id[0].length;
      continue;
    }
    const op = /^(==|<>|!=|<=|>=|&&|\|\||[-+*/%<>=(),!^])/.exec(text.slice(i));
    if (!op) throw new Error(`unexpected "${ch}"`);
    out.push({ t: 'op', v: op[0] });
    i += op[0].length;
  }
  return out;
}

// ----------------------------------------------------------------- parsing

const KEYWORD = (t: Token | undefined, word: string) => !!t && t.t === 'id' && t.v.toLowerCase() === word;

/** Parse an expression. Throws on syntax the language does not have. */
export function parseCriteria(text: string): Node {
  const tokens = tokenize(text);
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const expectOp = (v: string) => {
    if (!isOp(v)) throw new Error(`expected "${v}"`);
    p++;
  };

  const parseOr = (): Node => {
    let left = parseAnd();
    while (KEYWORD(peek(), 'or') || isOp('||')) { p++; left = { kind: 'binary', op: 'or', left, right: parseAnd() }; }
    return left;
  };
  const parseAnd = (): Node => {
    let left = parseNot();
    while (KEYWORD(peek(), 'and') || isOp('&&')) { p++; left = { kind: 'binary', op: 'and', left, right: parseNot() }; }
    return left;
  };
  const parseNot = (): Node => {
    if (KEYWORD(peek(), 'not') || isOp('!')) { p++; return { kind: 'unary', op: 'not', arg: parseNot() }; }
    return parseCompare();
  };
  const parseCompare = (): Node => {
    const left = parseAdd();
    const t = peek();
    if (t?.t === 'op' && ['=', '==', '<>', '!=', '<', '<=', '>', '>='].includes(t.v)) {
      p++;
      const op = t.v === '==' ? '=' : t.v === '!=' ? '<>' : t.v;
      return { kind: 'binary', op, left, right: parseAdd() };
    }
    if (KEYWORD(t, 'in')) {
      p++;
      expectOp('(');
      const list: Node[] = [];
      if (!isOp(')')) { do { list.push(parseOr()); } while (isOp(',') && ++p); }
      expectOp(')');
      return { kind: 'in', arg: left, list };
    }
    if (KEYWORD(t, 'between')) {
      p++;
      expectOp('(');
      const low = parseOr();
      expectOp(',');
      const high = parseOr();
      expectOp(')');
      return { kind: 'between', arg: left, low, high };
    }
    if (KEYWORD(t, 'like')) {
      p++;
      return { kind: 'binary', op: 'like', left, right: parseAdd() };
    }
    if (KEYWORD(t, 'is')) {
      p++;
      const negate = KEYWORD(peek(), 'not');
      if (negate) p++;
      if (!KEYWORD(peek(), 'null')) throw new Error('expected Null');
      p++;
      return { kind: 'isnull', arg: left, negate };
    }
    return left;
  };
  const parseAdd = (): Node => {
    let left = parseMul();
    while (isOp('+') || isOp('-')) { const op = tokens[p++].v; left = { kind: 'binary', op, left, right: parseMul() }; }
    return left;
  };
  const parseMul = (): Node => {
    let left = parseUnary();
    while (isOp('*') || isOp('/') || isOp('%')) { const op = tokens[p++].v; left = { kind: 'binary', op, left, right: parseUnary() }; }
    return left;
  };
  const parseUnary = (): Node => {
    if (isOp('-')) { p++; return { kind: 'unary', op: '-', arg: parseUnary() }; }
    if (isOp('+')) { p++; return parseUnary(); }
    return parsePrimary();
  };
  const parsePrimary = (): Node => {
    const t = peek();
    if (!t) throw new Error('unexpected end');
    p++;
    switch (t.t) {
      case 'num': return { kind: 'lit', value: numberLiteral(t.v) };
      case 'str': return { kind: 'lit', value: t.v };
      case 'date': return { kind: 'lit', value: parseDate(t.v) };
      case 'param': return { kind: 'param', name: t.v };
      case 'field':
        return t.v.startsWith('Parameters.') ? { kind: 'param', name: t.v.slice('Parameters.'.length) } : { kind: 'field', name: t.v };
      case 'op':
        if (t.v === '(') { const e = parseOr(); expectOp(')'); return e; }
        throw new Error(`unexpected "${t.v}"`);
      case 'id': {
        const word = t.v.toLowerCase();
        if (word === 'true') return { kind: 'lit', value: true };
        if (word === 'false') return { kind: 'lit', value: false };
        if (word === 'null') return { kind: 'lit', value: null };
        if (isOp('(')) {
          p++;
          const args: Node[] = [];
          if (!isOp(')')) { do { args.push(parseOr()); } while (isOp(',') && ++p); }
          expectOp(')');
          return { kind: 'call', name: word, args };
        }
        // A bare name is a field, as the criteria parser reads one.
        return { kind: 'field', name: t.v };
      }
    }
    throw new Error('unexpected token');
  };

  const node = parseOr();
  if (p < tokens.length) throw new Error(`unexpected "${tokens[p].v}"`);
  return node;
}

function numberLiteral(text: string): Value {
  const suffix = text.slice(-1).toLowerCase();
  if (suffix === 'm') return NetDecimal.parse(text.slice(0, -1)) ?? 0n;
  if (suffix === 'd' || suffix === 'f') return Number(text.slice(0, -1));
  if (/^\d+$/.test(text)) return BigInt(text);
  return Number(text);
}

/** `2026-03-05`, `2026-03-05T14:07` or `2026-03-05 14:07:09`, local time. */
export function parseDate(text: string): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(text.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
}

// -------------------------------------------------------------- arithmetic

const isInt = (v: Value): v is bigint => typeof v === 'bigint';
const isDec = (v: Value): v is NetDecimal => v instanceof NetDecimal;
const isDbl = (v: Value): v is number => typeof v === 'number';
const isNum = (v: Value) => isInt(v) || isDec(v) || isDbl(v);

export function toNumber(v: Value): number {
  if (isInt(v)) return Number(v);
  if (isDec(v)) return v.toNumber();
  if (isDbl(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') return Number(v);
  if (v instanceof Date) return v.getTime();
  return Number.NaN;
}

const toDec = (v: Value): NetDecimal => (isDec(v) ? v : isInt(v) ? NetDecimal.fromInt(v) : NetDecimal.fromNumber(toNumber(v)));

/** .NET's promotion: any double makes a double, then any decimal a decimal, else integers. */
function arith(op: string, a: Value, b: Value): Value {
  if (a === null || b === null) return null;
  if (!isNum(a) || !isNum(b)) {
    if (a instanceof Date && isNum(b)) return null;
    return null;
  }
  if (isDbl(a) || isDbl(b)) {
    const x = toNumber(a);
    const y = toNumber(b);
    switch (op) {
      case '+': return x + y;
      case '-': return x - y;
      case '*': return x * y;
      case '/': return y === 0 ? null : x / y;
      case '%': return y === 0 ? null : x % y;
    }
  }
  if (isDec(a) || isDec(b)) {
    const x = toDec(a);
    const y = toDec(b);
    switch (op) {
      case '+': return x.add(y);
      case '-': return x.sub(y);
      case '*': return x.mul(y);
      case '/': return x.div(y);
      case '%': {
        const q = x.div(y);
        if (!q) return null;
        const whole = new NetDecimal(q.mantissa / 10n ** BigInt(q.scale), 0);
        return x.sub(whole.mul(y));
      }
    }
  }
  const x = a as bigint;
  const y = b as bigint;
  switch (op) {
    case '+': return x + y;
    case '-': return x - y;
    case '*': return x * y;
    case '/': return y === 0n ? null : x / y;
    case '%': return y === 0n ? null : x % y;
  }
  return null;
}

/** -1, 0 or 1; null when the two cannot be compared. */
export function compareValues(a: Value, b: Value): number | null {
  if (a === null || b === null) return null;
  if (isNum(a) && isNum(b)) {
    if ((isDec(a) || isInt(a)) && (isDec(b) || isInt(b))) return toDec(a).compare(toDec(b));
    const x = toNumber(a);
    const y = toNumber(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (a instanceof Date && b instanceof Date) return Math.sign(a.getTime() - b.getTime());
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  const x = valueText(a);
  const y = valueText(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

const truthy = (v: Value): boolean => v === true || (isNum(v) && toNumber(v) !== 0);

/** Whether a condition holds: true, or a non-zero number. Null does not. */
export const isTrue = truthy;

// ---------------------------------------------------------------- printing

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A double as .NET Framework prints one: 15 significant digits, no trailing zeros. */
export function doubleText(x: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'NaN' : x > 0 ? 'Infinity' : '-Infinity';
  if (x === 0) return '0';
  const precise = Number(x.toPrecision(15));
  const plain = String(precise);
  if (!/e/i.test(plain)) return plain;
  // .NET writes E+XX with at least two exponent digits.
  const [mant, exp] = precise.toExponential().split('e');
  const n = Number(exp);
  return `${mant}E${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
}

/** How a value prints with no format string: what DevExpress printed. */
export function valueText(v: Value): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return doubleText(v);
  if (v instanceof NetDecimal) return v.toString();
  if (v instanceof Date) {
    const h = v.getHours() % 12 || 12;
    const mm = String(v.getMinutes()).padStart(2, '0');
    const ss = String(v.getSeconds()).padStart(2, '0');
    return `${v.getMonth() + 1}/${v.getDate()}/${v.getFullYear()} ${h}:${mm}:${ss} ${v.getHours() < 12 ? 'AM' : 'PM'}`;
  }
  return String(v);
}

// -------------------------------------------------------------- evaluating

const roundEven = (x: number, places: number): number => {
  const f = 10 ** places;
  const y = x * f;
  const floor = Math.floor(y);
  const diff = y - floor;
  // Treat a binary hair either side of .5 as the .5 it was written as.
  const r = Math.abs(diff - 0.5) < 1e-9 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(y);
  return r / f;
};

const addTo = (date: Value, apply: (d: Date) => void): Value => {
  if (!(date instanceof Date)) return null;
  const d = new Date(date.getTime());
  apply(d);
  return d;
};

const asInt = (v: Value): number => Math.trunc(toNumber(v));

function callFunction(name: string, args: Node[], env: Env): Value {
  const ev = (i: number) => evaluate(args[i], env);
  const text = (i: number) => valueText(ev(i));
  switch (name) {
    case 'iif': {
      // Condition, value, condition, value, ..., else.
      for (let i = 0; i + 1 < args.length; i += 2) if (truthy(ev(i))) return ev(i + 1);
      return args.length % 2 === 1 ? ev(args.length - 1) : null;
    }
    case 'isnull': return args.length === 1 ? ev(0) === null : (ev(0) ?? ev(1));
    case 'isnullorempty': { const v = ev(0); return v === null || v === ''; }
    case 'concat': return args.map((_, i) => text(i)).join('');
    case 'upper': return text(0).toUpperCase();
    case 'lower': return text(0).toLowerCase();
    case 'trim': return text(0).trim();
    case 'len': return BigInt(text(0).length);
    case 'substring': {
      const s = text(0);
      const start = asInt(ev(1));
      return args.length > 2 ? s.substr(start, asInt(ev(2))) : s.slice(start);
    }
    case 'replace': return text(0).split(text(1)).join(text(2));
    case 'contains': return text(0).includes(text(1));
    case 'startswith': return text(0).startsWith(text(1));
    case 'endswith': return text(0).endsWith(text(1));
    case 'charindex': return BigInt(text(1).indexOf(text(0)));
    case 'padleft': return text(0).padStart(asInt(ev(1)), args.length > 2 ? text(2) : ' ');
    case 'padright': return text(0).padEnd(asInt(ev(1)), args.length > 2 ? text(2) : ' ');
    case 'tostr': return text(0);
    case 'toint': case 'tolong': return BigInt(Math.trunc(toNumber(ev(0))));
    case 'todecimal': { const v = ev(0); return isDec(v) ? v : typeof v === 'string' ? NetDecimal.parse(v) : toDec(v); }
    case 'todouble': case 'tofloat': return toNumber(ev(0));
    case 'abs': {
      const v = ev(0);
      return isInt(v) ? (v < 0n ? -v : v) : isDec(v) ? v.abs() : isDbl(v) ? Math.abs(v) : null;
    }
    case 'round': {
      const v = ev(0);
      const places = args.length > 1 ? asInt(ev(1)) : 0;
      if (v === null) return null;
      if (isInt(v)) return v;
      if (isDec(v)) return v.roundEven(places);
      return roundEven(toNumber(v), places);
    }
    case 'floor': { const v = ev(0); return v === null ? null : isInt(v) ? v : isDec(v) ? NetDecimal.fromNumber(Math.floor(v.toNumber())) : Math.floor(toNumber(v)); }
    case 'ceiling': { const v = ev(0); return v === null ? null : isInt(v) ? v : isDec(v) ? NetDecimal.fromNumber(Math.ceil(v.toNumber())) : Math.ceil(toNumber(v)); }
    case 'max': { const a = ev(0); const b = ev(1); const c = compareValues(a, b); return c === null ? null : c >= 0 ? a : b; }
    case 'min': { const a = ev(0); const b = ev(1); const c = compareValues(a, b); return c === null ? null : c <= 0 ? a : b; }
    case 'power': return toNumber(ev(0)) ** toNumber(ev(1));
    case 'sqrt': return Math.sqrt(toNumber(ev(0)));
    case 'formatstring': return formatter ? formatter(text(0), args.slice(1).map((_, i) => ev(i + 1))) : text(0);
    case 'now': return env.now ?? new Date();
    case 'today': { const n = env.now ?? new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
    case 'getyear': { const d = ev(0); return d instanceof Date ? BigInt(d.getFullYear()) : null; }
    case 'getmonth': { const d = ev(0); return d instanceof Date ? BigInt(d.getMonth() + 1) : null; }
    case 'getday': { const d = ev(0); return d instanceof Date ? BigInt(d.getDate()) : null; }
    case 'gethour': { const d = ev(0); return d instanceof Date ? BigInt(d.getHours()) : null; }
    case 'getminute': { const d = ev(0); return d instanceof Date ? BigInt(d.getMinutes()) : null; }
    case 'getsecond': { const d = ev(0); return d instanceof Date ? BigInt(d.getSeconds()) : null; }
    case 'getdayofweek': { const d = ev(0); return d instanceof Date ? DAYS[d.getDay()] : null; }
    case 'getdate': { const d = ev(0); return d instanceof Date ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null; }
    case 'adddays': return addTo(ev(0), (d) => d.setDate(d.getDate() + asInt(ev(1))));
    case 'addmonths': return addTo(ev(0), (d) => d.setMonth(d.getMonth() + asInt(ev(1))));
    case 'addyears': return addTo(ev(0), (d) => d.setFullYear(d.getFullYear() + asInt(ev(1))));
    case 'addhours': return addTo(ev(0), (d) => d.setHours(d.getHours() + asInt(ev(1))));
    case 'addminutes': return addTo(ev(0), (d) => d.setMinutes(d.getMinutes() + asInt(ev(1))));
    case 'datediffday': {
      const a = ev(0); const b = ev(1);
      if (!(a instanceof Date) || !(b instanceof Date)) return null;
      const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
      return BigInt(day(b) - day(a));
    }
    case 'datediffmonth': {
      const a = ev(0); const b = ev(1);
      return a instanceof Date && b instanceof Date ? BigInt((b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth()) : null;
    }
    case 'datediffyear': {
      const a = ev(0); const b = ev(1);
      return a instanceof Date && b instanceof Date ? BigInt(b.getFullYear() - a.getFullYear()) : null;
    }
  }
  if (name.startsWith('sum') && env.aggregate) return env.aggregate(name, args);
  throw new Error(`unknown function ${name}`);
}

/** Set by netFormat, so FormatString() formats exactly as a TextFormatString does. */
let formatter: ((format: string, args: Value[]) => string) | null = null;
export function setFormatter(f: (format: string, args: Value[]) => string): void {
  formatter = f;
}

const likeRegex = (pattern: string) =>
  new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'is');

/** Evaluate a parsed expression. A null anywhere in arithmetic is null. */
export function evaluate(node: Node, env: Env): Value {
  switch (node.kind) {
    case 'lit': return node.value;
    case 'field': return env.field(node.name);
    case 'param': return env.param(node.name);
    case 'unary': {
      const v = evaluate(node.arg, env);
      if (node.op === 'not') return v === null ? null : !truthy(v);
      if (isInt(v)) return -v;
      if (isDec(v)) return v.neg();
      if (isDbl(v)) return -v;
      return null;
    }
    case 'in': {
      const v = evaluate(node.arg, env);
      return node.list.some((item) => compareValues(v, evaluate(item, env)) === 0);
    }
    case 'between': {
      const v = evaluate(node.arg, env);
      const lo = compareValues(v, evaluate(node.low, env));
      const hi = compareValues(v, evaluate(node.high, env));
      return lo !== null && hi !== null && lo >= 0 && hi <= 0;
    }
    case 'isnull': {
      const isNull = evaluate(node.arg, env) === null;
      return node.negate ? !isNull : isNull;
    }
    case 'call': return callFunction(node.name, node.args, env);
    case 'binary': {
      if (node.op === 'and') return truthy(evaluate(node.left, env)) && truthy(evaluate(node.right, env));
      if (node.op === 'or') return truthy(evaluate(node.left, env)) || truthy(evaluate(node.right, env));
      const a = evaluate(node.left, env);
      const b = evaluate(node.right, env);
      if (node.op === '+' && (typeof a === 'string' || typeof b === 'string')) return valueText(a) + valueText(b);
      if (node.op === 'like') return a !== null && b !== null && likeRegex(valueText(b)).test(valueText(a));
      if (['=', '<>', '<', '<=', '>', '>='].includes(node.op)) {
        const c = compareValues(a, b);
        if (c === null) return node.op === '<>' ? a !== b : node.op === '=' ? a === b : false;
        switch (node.op) {
          case '=': return c === 0;
          case '<>': return c !== 0;
          case '<': return c < 0;
          case '<=': return c <= 0;
          case '>': return c > 0;
          case '>=': return c >= 0;
        }
      }
      return arith(node.op, a, b);
    }
  }
}

const cache = new Map<string, Node | Error>();

/**
 * Parse once, evaluate, and print. An expression that will not parse prints
 * nothing, as a binding DevExpress cannot evaluate does.
 */
export function evaluateText(expression: string, env: Env): Value {
  let node = cache.get(expression);
  if (!node) {
    try { node = parseCriteria(expression); } catch (e) { node = e as Error; }
    cache.set(expression, node);
  }
  if (node instanceof Error) return null;
  try { return evaluate(node, env); } catch { return null; }
}
