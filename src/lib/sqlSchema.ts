/**
 * A SQL Server database's layout, read without connecting to it (2026-11-08,
 * the SQL Server programme, checklist items 8 and 9; docs/notes/gemini.md,
 * *The SQL data source, measured*).
 *
 * Three ways in, one model out:
 *
 * - **Forma's layout script** (`sqlSchemaScript.ts`), run once in SSMS: the
 *   whole catalog with each procedure's result columns described without
 *   running it, and the reason when it cannot be. The complete answer.
 * - **SSMS "Generate Scripts" text**: CREATE TABLE, CREATE VIEW, CREATE
 *   PROCEDURE and ALTER TABLE ... FOREIGN KEY. Columns, keys and parameters
 *   with their defaults; what a procedure returns is not in its declaration,
 *   so that is left for the script to say.
 * - **A .repx's own data source**: read by `repxSqlDataSource.ts`, the part of
 *   the database an existing report already uses.
 *
 * Nothing here opens a connection or keeps one: the model has no server, no
 * login and no password, by construction. What it does keep is names, types
 * and (when the user ran the sample script) a few rows, which the owner
 * allowed to go to the AI on 2026-11-08.
 */

export type SqlObjectKind = 'table' | 'view';

export interface SqlColumn {
  name: string;
  /** The SQL type's name, `nvarchar`, `decimal`; empty when a script does not say. */
  type: string;
  /** Characters for a character type, bytes otherwise; -1 for `max`. */
  length?: number;
  precision?: number;
  scale?: number;
  nullable?: boolean;
  identity?: boolean;
  computed?: boolean;
}

export interface SqlObject {
  schema: string;
  name: string;
  kind: SqlObjectKind;
  columns: SqlColumn[];
  primaryKey: string[];
}

export interface SqlForeignKey {
  name: string;
  /** `dbo.Orders`, the table holding the key. */
  table: string;
  /** `dbo.Customers`, the table it points at. */
  references: string;
  columns: { column: string; referencedColumn: string }[];
}

export interface SqlParameter {
  /** With its `@`. */
  name: string;
  type: string;
  length?: number;
  precision?: number;
  scale?: number;
  output: boolean;
  /** The default as written in the procedure, `NULL`, `'2026-01-01'`, `0`; absent when there is none. */
  defaultValue?: string;
}

export interface SqlProcedure {
  schema: string;
  name: string;
  parameters: SqlParameter[];
  /** The first result set's columns; empty when it could not be described. */
  result: SqlColumn[];
  /** Why the result could not be described: `TEMPORARY_TABLE`, `DYNAMIC_SQL`, `CONFLICTING_RESULTS`, or `NOT_DESCRIBED` from a script. */
  resultError?: { type: string; message: string };
}

export interface SqlSchema {
  source: 'export' | 'script' | 'repx';
  database: string;
  sqlVersion?: string;
  objects: SqlObject[];
  foreignKeys: SqlForeignKey[];
  procedures: SqlProcedure[];
  /** Sample rows by `schema.name`, from the sample script; values as SQL Server wrote them. */
  samples?: Record<string, Record<string, unknown>[]>;
}

/** Rows kept per object and characters kept per value, whatever the script returned. */
export const MAX_SAMPLE_ROWS = 10;
export const MAX_SAMPLE_VALUE = 200;
/** Sample values per column the AI is shown, when the database is shared with it (the Docs page states it). */
export const AI_SAMPLE_VALUES = 3;
/**
 * The longest name SQL Server allows (`sysname`), and so the longest the AI
 * is shown of a name read from a file; a longer one is cut to it (2026-11-24,
 * finding SEC-7 of the CLI and Forma Designer work's design audit).
 */
export const MAX_AI_NAME = 128;
/** Characters of one sample value as the AI is shown it, its quotes and escapes counted; the reader keeps 200 of the value itself (SEC-7). */
export const MAX_AI_VALUE = 400;
/** Columns, or a procedure's parameters or result columns, the AI is shown of one object; the rest are counted (SEC-7). */
export const MAX_AI_COLUMNS = 100;

const ENTITIES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
/**
 * The C0 and C1 controls, DEL, and the two separators some readers end a
 * line at (U+2028 and U+2029, made from their codes: either one written into
 * a regular expression's source ends the line it is written on).
 */
const CONTROLS = new RegExp(`[\\u0000-\\u001f\\u007f-\\u009f${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

/**
 * Text read from a layout, as the AI is shown it (2026-11-24, SEC-7). The
 * layout is fenced as `<database>` data in the request, and a layout file is
 * someone's text: the design audit measured a table named
 * `Orders</database>` with a line of instructions after it closing the fence,
 * the instructions then reading as the request's own. So `&`, `<` and `>` are
 * written as XML writes them (`queryFromJson` reads them back, should the AI
 * echo them), a control character as `\u` and its code, so a name cannot
 * start a line of its own, and a name past `max` characters is cut to it.
 * A name with none of these, as nearly every real one is and every one of
 * FormaSample's, is shown exactly as it was.
 */
export function aiText(value: string, max = MAX_AI_NAME): string {
  const chars = Array.from(value);
  const cut = chars.length > max ? `${chars.slice(0, max).join('')}…` : value;
  return cut.replace(CONTROLS, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).replace(/[&<>]/g, (c) => ENTITIES[c]);
}

/** A sample value as the AI is shown it: as JSON, escaped and cut as `aiText` does (SEC-7). */
export function aiValue(value: unknown): string {
  return aiText(JSON.stringify(value) ?? String(value), MAX_AI_VALUE);
}

/* ------------------------------------------------------------- types */

/** `nvarchar(80)`, `decimal(10,2)`, `nvarchar(max)`, `int` into a column's type fields. */
export function parseTypeName(text: string): Pick<SqlColumn, 'type' | 'length' | 'precision' | 'scale'> {
  const m = /^\s*\[?([A-Za-z_][\w ]*?)\]?\s*(?:\(\s*([^)]*)\))?\s*$/.exec(text);
  if (!m) return { type: text.trim().toLowerCase() };
  const type = m[1].trim().toLowerCase();
  const args = (m[2] ?? '').split(',').map((a) => a.trim()).filter(Boolean);
  if (!args.length) return { type };
  if (/^(decimal|numeric)$/.test(type)) return { type, precision: Number(args[0]), scale: Number(args[1] ?? 0) };
  if (/^(datetime2|time|datetimeoffset)$/.test(type)) return { type, scale: Number(args[0]) };
  if (/^(float)$/.test(type)) return { type, precision: Number(args[0]) };
  return { type, length: /^max$/i.test(args[0]) ? -1 : Number(args[0]) };
}

/** The type as a person reads it: `nvarchar(80)`, `decimal(10,2)`, `int`. */
export function typeLabel(c: Pick<SqlColumn, 'type' | 'length' | 'precision' | 'scale'>): string {
  if (!c.type) return '';
  if (/^(decimal|numeric)$/.test(c.type) && c.precision) return `${c.type}(${c.precision},${c.scale ?? 0})`;
  if (/char|binary/.test(c.type) && c.length !== undefined && c.length !== 0) return `${c.type}(${c.length === -1 ? 'max' : c.length})`;
  return c.type;
}

/* ---------------------------------------------------- the export JSON */

/** The outermost braces of a text, parsed as JSON; null when they are not there or do not parse. */
function braces(text: string): unknown | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Every export a text holds: the JSON inside each `<?forma ...?>`, or, when
 * it has none, the outermost braces of whatever was pasted. A file can hold a
 * layout and its sample rows both, in either order (2026-11-24, finding D1-6
 * of the CLI and Forma Designer work's design audit: the first alone was
 * read, so with the samples first the layout was lost).
 */
function exportsIn(text: string): unknown[] {
  const found = [...text.matchAll(/<\?forma\s+([\s\S]*?)\?>/g)].map((m) => braces(m[1]));
  return found.length ? found : [braces(text)];
}

/** The JSON inside `<?forma ...?>`, or the outermost braces of whatever was pasted: the first export a text holds. */
export function unwrapExport(text: string): unknown | null {
  return exportsIn(text)[0] ?? null;
}

/** The first export of this format a text holds. */
function exportOf(text: string, format: string): Record<string, unknown> | null {
  for (const found of exportsIn(text)) {
    const doc = asRecord(found);
    if (doc?.format === format) return doc;
  }
  return null;
}

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const asText = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const asNumber = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** An object, or one SQL Server wrote as a string (a FOR JSON subquery it did not recognise as JSON). */
function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function columnFromExport(raw: Record<string, unknown>): SqlColumn {
  const c: SqlColumn = { name: asText(raw.name), type: asText(raw.type).toLowerCase() };
  const length = asNumber(raw.length);
  if (length !== undefined && /char|binary/.test(c.type)) c.length = length;
  const precision = asNumber(raw.precision);
  if (precision && /^(decimal|numeric)$/.test(c.type)) {
    c.precision = precision;
    c.scale = asNumber(raw.scale) ?? 0;
  }
  if (typeof raw.nullable === 'boolean') c.nullable = raw.nullable;
  if (raw.identity === true) c.identity = true;
  if (raw.computed === true) c.computed = true;
  return c;
}

/** A described result column: its type arrives as `nvarchar(80)`. */
function resultColumn(raw: Record<string, unknown>): SqlColumn {
  const c: SqlColumn = { name: asText(raw.name), ...parseTypeName(asText(raw.type)) };
  if (typeof raw.nullable === 'boolean') c.nullable = raw.nullable;
  return c;
}

/** The layout script's answer, or null when the text is not one. */
export function readSchemaExport(text: string): SqlSchema | null {
  const doc = exportOf(text, 'forma-sql-schema');
  if (!doc) return null;
  const objects: SqlObject[] = asArray<Record<string, unknown>>(doc.objects).map((o) => ({
    schema: asText(o.schema) || 'dbo',
    name: asText(o.name),
    kind: o.kind === 'view' ? 'view' : 'table',
    columns: asArray<Record<string, unknown>>(o.columns).map(columnFromExport),
    primaryKey: asArray<Record<string, unknown>>(o.primaryKey).map((k) => asText(k.name)),
  }));
  const foreignKeys: SqlForeignKey[] = asArray<Record<string, unknown>>(doc.foreignKeys).map((f) => ({
    name: asText(f.name),
    table: asText(f.table),
    references: asText(f.references),
    columns: asArray<Record<string, unknown>>(f.columns).map((c) => ({ column: asText(c.column), referencedColumn: asText(c.referencedColumn) })),
  }));
  const procedures: SqlProcedure[] = asArray<Record<string, unknown>>(doc.procedures).map((p) => {
    const name = asText(p.name);
    const declared = parseProcedureHeader(asText(p.header));
    const parameters: SqlParameter[] = asArray<Record<string, unknown>>(p.parameters).map((raw) => {
      const c = columnFromExport(raw);
      const param: SqlParameter = { name: c.name, type: c.type, output: raw.output === true };
      if (c.length !== undefined) param.length = c.length;
      if (c.precision !== undefined) {
        param.precision = c.precision;
        param.scale = c.scale;
      }
      const found = declared.find((d) => d.name.toLowerCase() === c.name.toLowerCase());
      if (found?.defaultValue !== undefined) param.defaultValue = found.defaultValue;
      return param;
    });
    const error = asRecord(p.resultError);
    const proc: SqlProcedure = {
      schema: asText(p.schema) || 'dbo',
      name,
      parameters,
      result: asArray<Record<string, unknown>>(p.result).map(resultColumn),
    };
    if (error) proc.resultError = { type: asText(error.type) || 'UNKNOWN', message: asText(error.message) };
    return proc;
  });
  return {
    source: 'export',
    database: asText(doc.database),
    sqlVersion: asText(doc.sqlVersion) || undefined,
    objects,
    foreignKeys,
    procedures,
  };
}

/** The sample script's answer: rows by `schema.name`, bounded. */
export function readSampleExport(text: string): { database: string; samples: Record<string, Record<string, unknown>[]> } | null {
  const doc = exportOf(text, 'forma-sql-sample');
  if (!doc) return null;
  const samples: Record<string, Record<string, unknown>[]> = {};
  for (const s of asArray<Record<string, unknown>>(doc.samples)) {
    const key = asText(s.object);
    if (!key) continue;
    samples[key] = asArray<Record<string, unknown>>(s.rows)
      .slice(0, MAX_SAMPLE_ROWS)
      .map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' && v.length > MAX_SAMPLE_VALUE ? `${v.slice(0, MAX_SAMPLE_VALUE)}…` : v])));
  }
  return { database: asText(doc.database), samples };
}

/* ------------------------------------------------ T-SQL declarations */

/** The text with comments removed and string literals left exactly as they were. */
export function stripComments(sql: string): string {
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      const end = closingQuote(sql, i);
      out += sql.slice(i, end + 1);
      i = end;
    } else if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 1;
      out += ' ';
    } else out += ch;
  }
  return out;
}

function closingQuote(sql: string, open: number): number {
  for (let i = open + 1; i < sql.length; i++) {
    if (sql[i] === "'") {
      if (sql[i + 1] === "'") i++;
      else return i;
    }
  }
  return sql.length - 1;
}

/** Splits on commas at the top level: not inside parentheses, quotes or brackets. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") i = closingQuote(text, i);
    else if (ch === '[') i = Math.max(i, text.indexOf(']', i));
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

/** The index just past the parenthesis that closes the one at `open`. */
function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") i = closingQuote(text, i);
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

const IDENT = String.raw`(?:\[[^\]]+\]|"[^"]+"|[A-Za-z_#@][\w@#$]*)`;
const QUALIFIED = String.raw`${IDENT}(?:\s*\.\s*${IDENT}){0,2}`;

function unquote(part: string): string {
  const p = part.trim();
  if ((p.startsWith('[') && p.endsWith(']')) || (p.startsWith('"') && p.endsWith('"'))) return p.slice(1, -1);
  return p;
}

/** `[dbo].[Orders]` or `Orders` into `{ schema, name }`, `dbo` when unqualified. */
function parseQualifiedName(text: string): { schema: string; name: string } {
  const parts = (text.match(new RegExp(IDENT, 'g')) ?? []).map(unquote);
  if (parts.length >= 2) return { schema: parts[parts.length - 2], name: parts[parts.length - 1] };
  return { schema: 'dbo', name: parts[0] ?? text.trim() };
}

function columnList(text: string): string[] {
  return splitTopLevel(text).map((c) => unquote(c.replace(/\s+(ASC|DESC)\s*$/i, '')));
}

/**
 * A procedure's `WITH RECOMPILE, ENCRYPTION, EXECUTE AS ...` options, at the
 * end of its parameter list. The name after EXECUTE AS is a quoted string or a
 * run with no space, comma or quote (2026-11-12, CodeQL js/redos): it was
 * `\S+`, which could take the commas of the options after it, so each option
 * split two ways and the work doubled with each one; 22 options took 1.8 s.
 */
const WITH_OPTION = String.raw`(?:RECOMPILE|ENCRYPTION|EXECUTE\s+AS\s+(?:'(?:[^']|'')*'|[^\s,']+))`;
const WITH_OPTIONS = new RegExp(String.raw`\bWITH\s+${WITH_OPTION}(?:\s*,\s*${WITH_OPTION})*\s*$`, 'i');

/**
 * A procedure's declared parameters: everything between its name and the
 * first top-level `AS`, the way SSMS scripts it and the way the layout script
 * keeps it (`header`). Defaults are kept as written, `NULL` included.
 */
export function parseProcedureHeader(header: string): SqlParameter[] {
  const clean = stripComments(header);
  const at = clean.indexOf('@');
  if (at < 0) return [];
  // Nothing but the name may come before the list: an @ further on is the body's.
  const before = clean.slice(0, at).trim();
  const head = new RegExp(String.raw`^(?:${QUALIFIED})?\s*\(?$`).test(before) || before === '' || before === '(';
  if (!head) return [];
  let list: string;
  if (before.endsWith('(')) {
    // `CREATE PROC p (@a int, @b int) AS`: the list is the parenthesis.
    const open = clean.lastIndexOf('(', at);
    list = clean.slice(at, matchParen(clean, open));
  } else {
    // Otherwise it ends at the first top-level AS that starts the body. `@p AS int`
    // is T-SQL's optional AS before a parameter's type, and does not count; nor
    // does the AS of `WITH EXECUTE AS OWNER` (2026-11-12), which ended the list
    // there and left "with execute" in the last parameter's type.
    let depth = 0;
    let end = clean.length;
    for (let i = at; i < clean.length; i++) {
      const ch = clean[i];
      if (ch === "'") i = closingQuote(clean, i);
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (depth === 0 && /\s/.test(clean[i - 1] ?? ' ') && /^AS(\s|$)/i.test(clean.slice(i, i + 3))) {
        const previous = /(\S+)\s*$/.exec(clean.slice(at, i))?.[1] ?? '';
        if (previous.startsWith('@') || /^EXECUTE$/i.test(previous)) continue;
        end = i;
        break;
      }
    }
    list = clean.slice(at, end);
  }
  list = list.trim().replace(WITH_OPTIONS, '');
  return splitTopLevel(list)
    .filter((p) => p.startsWith('@'))
    .map((p) => {
      const m = /^(@[\w@#$]+)\s+(?:AS\s+)?([\s\S]*?)$/i.exec(p.trim());
      if (!m) return null;
      let rest = m[2];
      const output = /\b(OUTPUT|OUT)\b/i.test(rest.replace(/'(?:[^']|'')*'/g, "''"));
      rest = rest.replace(/\s+(OUTPUT|OUT|READONLY)\b/gi, '').trim();
      const eq = rest.indexOf('=');
      const typeText = (eq >= 0 ? rest.slice(0, eq) : rest).trim();
      const param: SqlParameter = { name: m[1], ...parseTypeName(typeText.replace(/\s+(VARYING|NULL|NOT NULL)$/i, '')), output };
      if (eq >= 0) param.defaultValue = rest.slice(eq + 1).trim();
      return param;
    })
    .filter((p): p is SqlParameter => p !== null);
}

const CONSTRAINT_START = /^(CONSTRAINT\b|PRIMARY\s+KEY\b|FOREIGN\s+KEY\b|UNIQUE\b|CHECK\b|INDEX\b|PERIOD\s+FOR\b)/i;

function parseTableBody(body: string, table: { schema: string; name: string }, fks: SqlForeignKey[]): { columns: SqlColumn[]; primaryKey: string[] } {
  const columns: SqlColumn[] = [];
  let primaryKey: string[] = [];
  const tableName = `${table.schema}.${table.name}`;
  for (const item of splitTopLevel(body)) {
    if (CONSTRAINT_START.test(item)) {
      const named = /^CONSTRAINT\s+(\S+)\s+/i.exec(item);
      const rest = named ? item.slice(named[0].length) : item;
      const pk = /^PRIMARY\s+KEY\b[^(]*\(([^)]*)\)/i.exec(rest);
      if (pk) primaryKey = columnList(pk[1]);
      const fk = new RegExp(String.raw`^FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+(${QUALIFIED})\s*\(([^)]*)\)`, 'i').exec(rest);
      if (fk) {
        const from = columnList(fk[1]);
        const to = columnList(fk[3]);
        const ref = parseQualifiedName(fk[2]);
        fks.push({ name: named ? unquote(named[1]) : `FK_${table.name}_${ref.name}`, table: tableName, references: `${ref.schema}.${ref.name}`, columns: from.map((c, i) => ({ column: c, referencedColumn: to[i] ?? c })) });
      }
      continue;
    }
    const m = new RegExp(String.raw`^(${IDENT})\s+([\s\S]*)$`).exec(item);
    if (!m) continue;
    const name = unquote(m[1]);
    const rest = m[2].trim();
    if (/^AS\b/i.test(rest)) {
      columns.push({ name, type: '', computed: true });
      continue;
    }
    const typeMatch = new RegExp(String.raw`^(${IDENT}(?:\s*\.\s*${IDENT})?)\s*(\([^)]*\))?`).exec(rest);
    const typeName = typeMatch ? unquote(typeMatch[1].split('.').pop() ?? typeMatch[1]) + (typeMatch[2] ?? '') : '';
    const col: SqlColumn = { name, ...parseTypeName(typeName) };
    const tail = rest.slice(typeMatch?.[0].length ?? 0);
    if (/\bNOT\s+NULL\b/i.test(tail)) col.nullable = false;
    else if (/\bNULL\b/i.test(tail)) col.nullable = true;
    if (/\bIDENTITY\b/i.test(tail)) col.identity = true;
    if (/\bPRIMARY\s+KEY\b/i.test(tail)) primaryKey = [name];
    const inlineFk = new RegExp(String.raw`\bREFERENCES\s+(${QUALIFIED})\s*\(([^)]*)\)`, 'i').exec(tail);
    if (inlineFk) {
      const ref = parseQualifiedName(inlineFk[1]);
      fks.push({ name: `FK_${table.name}_${ref.name}`, table: tableName, references: `${ref.schema}.${ref.name}`, columns: [{ column: name, referencedColumn: columnList(inlineFk[2])[0] ?? name }] });
    }
    columns.push(col);
  }
  return { columns, primaryKey };
}

/** The columns a view's SELECT names: an alias, or the last part of the expression. */
function viewColumns(selectBody: string): SqlColumn[] {
  const from = /\bFROM\b/i.exec(selectBody);
  const list = selectBody.slice(0, from ? from.index : undefined).replace(/^\s*SELECT\s+(DISTINCT\s+)?(TOP\s*\(?\s*\d+\s*\)?\s*(PERCENT\s+)?)?/i, '');
  return splitTopLevel(list)
    .map((expr) => {
      const alias = new RegExp(String.raw`\bAS\s+(${IDENT})\s*$`, 'i').exec(expr) ?? new RegExp(String.raw`^(${IDENT})\s*=`).exec(expr);
      if (alias) return unquote(alias[1]);
      const last = new RegExp(String.raw`(${IDENT})\s*$`).exec(expr);
      return last && !/\)\s*$/.test(expr) ? unquote(last[1]) : '';
    })
    .filter((n) => n && n !== '*')
    .map((name) => ({ name, type: '' }));
}

/**
 * SSMS "Generate Scripts" text, or any CREATE TABLE / VIEW / PROCEDURE text,
 * into the model. A procedure's result is not in its declaration, so it is
 * left empty with `NOT_DESCRIBED`, and the layout script says the rest.
 */
export function readSchemaScript(text: string, database = ''): SqlSchema | null {
  const sql = stripComments(text);
  const objects: SqlObject[] = [];
  const foreignKeys: SqlForeignKey[] = [];
  const procedures: SqlProcedure[] = [];
  const create = new RegExp(String.raw`\bCREATE\s+(?:OR\s+ALTER\s+)?(TABLE|VIEW|PROCEDURE|PROC)\s+(${QUALIFIED})`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = create.exec(sql))) {
    const kind = m[1].toUpperCase();
    const name = parseQualifiedName(m[2]);
    const after = m.index + m[0].length;
    if (kind === 'TABLE') {
      const open = sql.indexOf('(', after);
      if (open < 0) continue;
      const close = matchParen(sql, open);
      const body = parseTableBody(sql.slice(open + 1, close), name, foreignKeys);
      objects.push({ ...name, kind: 'table', ...body });
    } else if (kind === 'VIEW') {
      const as = /\bAS\b/i.exec(sql.slice(after));
      if (!as) continue;
      const start = after + as.index + 2;
      const next = sql.slice(start).search(/\n\s*GO\b|\bCREATE\s+(OR\s+ALTER\s+)?(TABLE|VIEW|PROC)/i);
      objects.push({ ...name, kind: 'view', columns: viewColumns(sql.slice(start, next < 0 ? undefined : start + next)), primaryKey: [] });
    } else {
      procedures.push({
        ...name,
        parameters: parseProcedureHeader(sql.slice(after, after + 4000)),
        result: [],
        resultError: { type: 'NOT_DESCRIBED', message: 'A script declares what a procedure takes, not what it returns. Run Forma’s layout script for its result columns.' },
      });
    }
  }
  const alter = new RegExp(String.raw`\bALTER\s+TABLE\s+(${QUALIFIED})\s+(?:WITH\s+(?:NO)?CHECK\s+)?ADD\s+(?:CONSTRAINT\s+(${IDENT})\s+)?(FOREIGN\s+KEY|PRIMARY\s+KEY)[^(]*\(([^)]*)\)(?:\s*REFERENCES\s+(${QUALIFIED})\s*\(([^)]*)\))?`, 'gi');
  while ((m = alter.exec(sql))) {
    const table = parseQualifiedName(m[1]);
    if (/^PRIMARY/i.test(m[3])) {
      const target = objects.find((o) => o.schema === table.schema && o.name === table.name);
      if (target) target.primaryKey = columnList(m[4]);
    } else if (m[5]) {
      const ref = parseQualifiedName(m[5]);
      const from = columnList(m[4]);
      const to = columnList(m[6] ?? '');
      foreignKeys.push({ name: m[2] ? unquote(m[2]) : `FK_${table.name}_${ref.name}`, table: `${table.schema}.${table.name}`, references: `${ref.schema}.${ref.name}`, columns: from.map((c, i) => ({ column: c, referencedColumn: to[i] ?? c })) });
    }
  }
  if (!objects.length && !procedures.length) return null;
  const use = /\bUSE\s+(\[[^\]]+\]|\w+)/i.exec(sql);
  return { source: 'script', database: database || (use ? unquote(use[1]) : ''), objects, foreignKeys, procedures };
}

/* ------------------------------------------------------------ intake */

export type DatabaseText =
  | {
      kind: 'schema';
      schema: SqlSchema;
      /**
       * Sample rows the same text holds beside the layout, in either order
       * (2026-11-25, the CLI and Forma Designer work's wave-5 review,
       * W5-PB-7): never in `schema` here, so each caller decides whether they
       * go (the browser's attaching shares them, as two files did; the
       * command line's and the MCP server's only on the person's own act,
       * OC6), and none drops them without a word.
       */
      rows?: { database: string; samples: Record<string, Record<string, unknown>[]> };
    }
  | { kind: 'sample'; database: string; samples: Record<string, Record<string, unknown>[]> }
  /**
   * Forma's own export, or a file of one, that cannot be read as it is: cut
   * short, damaged, or in an encoding that lost characters. `reason` reads
   * after what it is about: `"forma-schema.txt" ${reason}`, or `This ${reason}`.
   */
  | { kind: 'damaged'; reason: string };

/**
 * Where SSMS cuts a large answer: an XML cell is kept up to Results to Grid's
 * XML data limit (1, 2 or 5 MB, or Unlimited), Microsoft's page on those
 * options says, so a large database's layout can arrive cut there.
 */
const WHOLE_ANSWER = "SSMS keeps as much of an XML cell as Tools > Options > Query Results > SQL Server > Results to Grid > XML data allows, so set that to Unlimited for a large database.";

const DAMAGED: Readonly<Record<'layout' | 'sample', string>> = {
  layout: `holds Forma's database layout cut short or damaged, so none of it was read: run Forma's layout script again and save its whole answer. ${WHOLE_ANSWER}`,
  sample: `holds Forma's sample rows cut short or damaged, so none of them were read: run the sample script again and save its whole answer. ${WHOLE_ANSWER}`,
};

/** What Forma's own script given in place of its answer is told (W5-PB-6): the likeliest slip of the sqlcmd route, where the .txt sits beside the .sql. */
const SCRIPT_NOT_ANSWER: Readonly<Record<'layout' | 'sample', string>> = {
  layout: "is Forma's layout script, not what it answers: run it against the database (in SSMS, or with sqlcmd) and give the answer it writes.",
  sample: "is Forma's sample script, not what it answers: run it against the database (in SSMS, or with sqlcmd) and give the answer it writes.",
};

/** Forma's layout or sample script itself: the format it names, and the one cell it answers in. */
const FORMA_SCRIPT = /N'forma-sql-(schema|sample)'\s+AS\s+\[format\]|\[processing-instruction\(forma\)\]/i;
/**
 * Forma's own export, as it starts: its processing instruction, or its JSON
 * pasted bare. Only text that starts one is read as an export that did not
 * read (W5-PB-6): a note that merely names the format is data, as it was.
 */
const FORMA_EXPORT = /<\?forma\s|"format"\s*:\s*"forma-sql-(?:schema|sample)"/;

/**
 * Whether a pasted or attached text is a database's layout or sample rows,
 * and what it holds. Forma's own export that starts and does not read (cut
 * short, or damaged on the way) is `damaged`, never read as anything else
 * (2026-11-24, finding D1-3 of the CLI and Forma Designer work's design
 * audit): a procedure's text inside the export can hold `CREATE TABLE #t`,
 * so a layout missing its last three characters was read as a CREATE script
 * of one table, `#t`, and the AI told the database was that table. Forma's
 * own script given in place of its answer is said as that (the wave-5
 * review, W5-PB-6: it was told it was an export cut short, and to change an
 * SSMS setting). A text holding a layout and sample rows both gives the
 * layout, with the rows apart (`rows`).
 */
export function readDatabaseText(text: string, fallbackName = ''): DatabaseText | null {
  const schema = /forma-sql-schema/.test(text) ? readSchemaExport(text) : null;
  const sample = /forma-sql-sample/.test(text) ? readSampleExport(text) : null;
  if (schema) return sample ? { kind: 'schema', schema, rows: sample } : { kind: 'schema', schema };
  if (sample) return { kind: 'sample', ...sample };
  const script = FORMA_SCRIPT.exec(text);
  if (script) return { kind: 'damaged', reason: SCRIPT_NOT_ANSWER[script[1]?.toLowerCase() === 'sample' || /forma-sql-sample/.test(text) ? 'sample' : 'layout'] };
  if (FORMA_EXPORT.test(text)) return { kind: 'damaged', reason: /forma-sql-schema/.test(text) || !/forma-sql-sample/.test(text) ? DAMAGED.layout : DAMAGED.sample };
  if (/\bCREATE\s+(OR\s+ALTER\s+)?(TABLE|VIEW|PROC(EDURE)?)\b/i.test(text)) {
    // The script's own USE names the database, and the fallback only a script
    // with none (2026-11-24, D1-5: the fallback, a file's name, was passed as
    // the name and won over USE, so a layout saved as "forma-schema.sql"
    // wrote reports connected to "forma-schema").
    const schema = readSchemaScript(text);
    if (schema) return { kind: 'schema', schema: schema.database ? schema : { ...schema, database: fallbackName } };
  }
  return null;
}

/**
 * A file's text by its byte order mark: UTF-16 little- or big-endian, else
 * UTF-8, the mark dropped (2026-11-24, finding D1-4 of the CLI and Forma
 * Designer work's design audit). sqlcmd's `-u` writes UTF-16LE with the mark,
 * and so does Windows PowerShell 5.1 redirecting a command's output with `>`;
 * read as UTF-8 either came back as no layout at all.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder().decode(bytes);
}

/**
 * What a file written in a code page is told (2026-11-25, the wave-5 review,
 * BT-5): the letters the code page lacked are not in the file, so saving it
 * again cannot bring them back; only writing it as UTF-8 from the start can.
 */
const WRITE_AS_UTF8 = "write it again as UTF-8 from the start, with sqlcmd's -f 65001 (or -u) or SSMS saving its answer as UTF-8, since the letters are not in this file to recover.";

/**
 * What keeps a file's text from being read as it was written, in words that
 * name the fix (D1-4), or null: characters that were not UTF-8, which a
 * decoder turns into U+FFFD; or NUL characters, which are what UTF-16
 * without its mark reads as. Over a whole file, for one that could not be
 * read as a layout at all; a layout read is judged by its names alone
 * (`namesLost`).
 */
export function encodingProblem(text: string): string | null {
  if (text.includes('�')) return `holds characters that are not UTF-8, as a file written in a code page does (sqlcmd without -f 65001 writes one), so it cannot be read as it was written: ${WRITE_AS_UTF8}`;
  if (text.includes('\u0000')) return 'holds NUL characters, as UTF-16 does when it has no byte order mark: save it again as UTF-8, or as UTF-16 with its mark.';
  return null;
}

/** Characters a code page turned into question marks: two or more together, or a name of nothing else (BT-5). */
const LOST_TO_A_CODE_PAGE = /\?\?|^\s*\?+\s*$/;

/** Every name a layout holds, as the AI and the writer would use them. */
function namesOf(schema: SqlSchema): string[] {
  return [
    schema.database,
    ...schema.objects.flatMap((o) => [o.schema, o.name, ...o.columns.map((c) => c.name)]),
    ...schema.procedures.flatMap((p) => [p.schema, p.name, ...p.parameters.map((x) => x.name), ...p.result.map((c) => c.name)]),
    ...schema.foreignKeys.flatMap((f) => [f.table, f.references, ...f.columns.flatMap((c) => [c.column, c.referencedColumn])]),
  ];
}

/**
 * Why a layout's names cannot be the database's, or null (2026-11-25, the
 * wave-5 review, BT-5 and W5-PB-7): a name holding U+FFFD, a character that
 * was not UTF-8; or a name holding two question marks together, or nothing
 * else, which is what a code page lacking a script's letters writes for
 * them (sqlcmd without -f 65001 wrote an Arabic table `dbo.مبيعات` as
 * `dbo.??????`, plain ASCII, which read without complaint, and the AI and
 * the writer then named a table that does not exist). One question mark, as
 * in a column `Paid?` an Access migration brings, is a name. Only names are
 * judged: a comment or a procedure's body in another code page names
 * nothing, so an SSMS script whose one odd byte is in a comment is read.
 */
export function namesLost(schema: SqlSchema): string | null {
  const names = namesOf(schema);
  if (names.some((n) => n.includes('�'))) return `holds names with characters that are not UTF-8, as a file written in a code page does (sqlcmd without -f 65001 writes one), so they would be read wrong: ${WRITE_AS_UTF8}`;
  if (names.some((n) => LOST_TO_A_CODE_PAGE.test(n))) return `holds names whose letters were lost to a code page, so they read as question marks (sqlcmd without -f 65001 writes a name in another script so): ${WRITE_AS_UTF8}`;
  return null;
}

/** Why sample rows' names, their objects' and columns', cannot be the database's, or null (`namesLost`'s rule). */
function sampleNamesLost(found: { database: string; samples: Record<string, Record<string, unknown>[]> }): string | null {
  return namesLost({ source: 'export', database: found.database, objects: Object.entries(found.samples).map(([name, rows]) => ({ schema: '', name, kind: 'table', columns: [...new Set(rows.flatMap((r) => Object.keys(r)))].map((c) => ({ name: c, type: '' })), primaryKey: [] })), foreignKeys: [], procedures: [] });
}

/**
 * A file's bytes as `readDatabaseText` reads its text: decoded by its byte
 * order mark (`decodeText`), its name, less the extension, the fallback for a
 * script that names no database. A layout or sample rows whose names lost
 * characters on the way are `damaged`, said with the fix (`namesLost`); a
 * file that is neither is null, whatever its encoding, so the intake can
 * read it as data.
 */
export function readDatabaseBytes(bytes: Uint8Array, name: string): DatabaseText | null {
  const found = readDatabaseText(decodeText(bytes), name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''));
  if (!found || found.kind === 'damaged') return found;
  const lost = found.kind === 'schema' ? namesLost(found.schema) ?? (found.rows ? sampleNamesLost(found.rows) : null) : sampleNamesLost(found);
  return lost ? { kind: 'damaged', reason: lost } : found;
}

/**
 * A file's sample rows, wherever in it they are, a layout beside them or not
 * (D1-6): read as `readDatabaseBytes` reads a layout, cut short or with names
 * lost said the same way. Null when the file holds none.
 */
export function readSampleBytes(bytes: Uint8Array): Extract<DatabaseText, { kind: 'sample' | 'damaged' }> | null {
  const text = decodeText(bytes);
  if (!/forma-sql-sample/.test(text)) return null;
  const sample = readSampleExport(text);
  if (!sample) return FORMA_SCRIPT.test(text) ? { kind: 'damaged', reason: SCRIPT_NOT_ANSWER.sample } : FORMA_EXPORT.test(text) ? { kind: 'damaged', reason: DAMAGED.sample } : null;
  const lost = sampleNamesLost(sample);
  return lost ? { kind: 'damaged', reason: lost } : { kind: 'sample', ...sample };
}

/** Sample rows put beside the layout they belong to, matched by `schema.name`. */
export function withSamples(schema: SqlSchema, samples: Record<string, Record<string, unknown>[]>): SqlSchema {
  return { ...schema, samples: { ...(schema.samples ?? {}), ...samples } };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "FormaSample: 3 tables, 1 view, 5 procedures (1 whose result cannot be read: a temp table)". */
export function summarizeSchema(schema: SqlSchema): string {
  const tables = schema.objects.filter((o) => o.kind === 'table').length;
  const views = schema.objects.length - tables;
  const unreadable = schema.procedures.filter((p) => p.resultError && p.resultError.type !== 'NOT_DESCRIBED');
  const reasons = [...new Set(unreadable.map((p) => REASONS[p.resultError!.type] ?? p.resultError!.type.toLowerCase().replace(/_/g, ' ')))];
  const parts = [plural(tables, 'table'), plural(views, 'view'), plural(schema.procedures.length, 'procedure')];
  const tail = unreadable.length ? ` (${unreadable.length} whose result cannot be read: ${reasons.join(', ')})` : '';
  return `${schema.database || 'Database'}: ${parts.join(', ')}${tail}`;
}

const REASONS: Record<string, string> = {
  TEMPORARY_TABLE: 'a temp table',
  DYNAMIC_SQL: 'dynamic SQL',
  CONFLICTING_RESULTS: 'branches returning different columns',
  CONFLICTING_TYPES: 'branches returning different types',
};

/** The advice for a procedure whose result cannot be described. */
export function resultFix(type: string): string {
  switch (type) {
    case 'TEMPORARY_TABLE':
      return 'Use a table variable instead of a #temp table, or end the procedure with EXEC ... WITH RESULT SETS, so SQL Server (and DevExpress, which fails the same way) can read its columns without running it.';
    case 'DYNAMIC_SQL':
      return 'Add WITH RESULT SETS to the EXEC that runs the dynamic SQL, so its columns can be read without running it.';
    case 'CONFLICTING_RESULTS':
    case 'CONFLICTING_TYPES':
      return 'Make every branch return the same columns in the same order and types, or split the procedure in two.';
    case 'NOT_DESCRIBED':
      return 'Run Forma’s layout script for this database; a CREATE PROCEDURE script does not say what the procedure returns.';
    default:
      return 'Run the procedure once in SSMS to see what it returns, and check it with sp_describe_first_result_set.';
  }
}

/** "dbo.Orders (3 rows), dbo.vOrderTotals (3 rows)". */
export function summarizeSamples(samples: Record<string, Record<string, unknown>[]>): string {
  return Object.entries(samples).map(([name, rows]) => `${name} (${plural(rows.length, 'row')})`).join(', ');
}

/* --------------------------------------------------------- for the AI */

/** Characters of one object's sample rows given on their own, before their layout, as the AI is shown them (SEC-7). */
const MAX_AI_ROWS_TEXT = 4000;

/**
 * Characters of a database's layout the AI is shown at most, names only and
 * with sample values (2026-11-25, the CLI and Forma Designer work's wave-5
 * review, W5-PB-2): every cap before this one bounded a name or an object,
 * so twelve objects of a hostile layout at every cap still came to 640,000
 * characters with names only and 2.2 million with values, sent again with
 * every generation, chat turn and batch file. FormaSample's is about 2,900;
 * an ERP's twelve likeliest objects of forty columns about 15,000. Filled
 * object by object, the likeliest first, and column by column within the
 * one that meets the end, with what was left counted.
 */
export const MAX_AI_LAYOUT = 32_000;
export const MAX_AI_LAYOUT_SAMPLES = 48_000;
/** Objects whose sample rows are shown on their own, before their layout (`samplesForAi`): as many as a layout lists (databaseAi.ts `MAX_AI_OBJECTS`). */
const MAX_AI_SAMPLE_OBJECTS = 12;

/** Sample rows on their own, before the layout they belong to has been read. */
export function samplesForAi(database: string, samples: Record<string, Record<string, unknown>[]>): string {
  const lines = [`SAMPLE ROWS from database "${aiText(database || 'unnamed')}". Bind the report's fields to these column names exactly.`];
  const entries = Object.entries(samples);
  for (const [name, rows] of entries.slice(0, MAX_AI_SAMPLE_OBJECTS)) lines.push(`- ${aiText(name)}: ${aiText(JSON.stringify(rows.slice(0, AI_SAMPLE_VALUES)), MAX_AI_ROWS_TEXT)}`);
  if (entries.length > MAX_AI_SAMPLE_OBJECTS) lines.push(`(${entries.length - MAX_AI_SAMPLE_OBJECTS} more objects not listed.)`);
  return lines.join('\n');
}

function columnText(c: SqlColumn, key: { pk: Set<string>; fk: Map<string, { table: string; column: string }> }): string {
  const fk = key.fk.get(c.name);
  // Each part of the key's target capped as a name is (W5-PB-2): `dbo.Customers.CustomerID`, a schema, a table and a column.
  const target = fk ? `${fk.table.split('.').map((part) => aiText(part)).join('.')}.${aiText(fk.column)}` : '';
  const marks = [key.pk.has(c.name) ? 'PK' : '', fk ? `FK->${target}` : '', c.nullable === false ? 'not null' : ''].filter(Boolean);
  return `${aiText(c.name)} ${aiText(typeLabel(c)) || '?'}${marks.length ? ` ${marks.join(' ')}` : ''}`;
}

/**
 * A line of parts, whole (`more`, what a cap left out, and `tail`) when it
 * fits in `room`; else without `tail`; else as many of its parts as fit and
 * how many more there are, those a cap left out (`extra`) counted too
 * (`listed(n)`); null when not one part fits (W5-PB-2).
 */
function fitted(line: { head: string; parts: readonly string[]; more: string; extra: number; tail: string }, room: number, listed: (n: number) => string): string | null {
  const { head, parts, more, extra, tail } = line;
  const whole = `${head}${parts.join(', ')}${more}`;
  if (whole.length + tail.length <= room) return `${whole}${tail}`;
  if (whole.length <= room) return whole;
  let cut = head;
  for (let i = 0; i < parts.length; i++) {
    const next = `${cut}${i ? ', ' : ''}${parts[i]}`;
    if (next.length + listed(parts.length - i - 1 + extra).length > room) return i ? `${cut}${listed(parts.length - i + extra)}` : null;
    cut = next;
  }
  return `${cut}${listed(extra)}`;
}

/** What a line cut at the budget says of its columns left out. */
const columnsLeft = (n: number) => (n ? ` (${n} more columns not listed)` : '');

function sampleText(rows: Record<string, unknown>[] | undefined, columns: string[]): string {
  if (!rows?.length) return '';
  const values = columns
    .map((name) => {
      const seen = rows.map((r) => r[name]).filter((v) => v !== null && v !== undefined && v !== '').slice(0, AI_SAMPLE_VALUES);
      return seen.length ? `${aiText(name)}=${seen.map(aiValue).join('|')}` : '';
    })
    .filter(Boolean);
  return values.length ? `\n    e.g. ${values.join('; ')}` : '';
}

/** The first `MAX_AI_COLUMNS` of a list, and how many more there are, as one object's line counts them (SEC-7). */
export function capped<T>(items: readonly T[]): { shown: readonly T[]; more: string } {
  return items.length > MAX_AI_COLUMNS ? { shown: items.slice(0, MAX_AI_COLUMNS), more: ` (${items.length - MAX_AI_COLUMNS} more)` } : { shown: items, more: '' };
}

/**
 * The layout as compact text for the AI: one line per object, keys marked,
 * and sample values when the user ran the sample script (the owner allowed
 * names and values on 2026-11-08). Capped at `maxObjects`, with the rest
 * counted, so a large database does not spend the free tier, at
 * `MAX_AI_COLUMNS` columns an object, and at `MAX_AI_LAYOUT` characters in
 * all (`MAX_AI_LAYOUT_SAMPLES` with sample values), what is left counted.
 * Every name, type, default and value read from the file is shown through
 * `aiText` (SEC-7), so none can close the `<database>` fence it is written in
 * or start a line of its own.
 */
export function schemaForAi(schema: SqlSchema, maxObjects = 80, order?: readonly string[]): string {
  const lines: string[] = [`DATABASE "${aiText(schema.database || 'unnamed')}" (SQL Server${schema.sqlVersion ? ` ${aiText(schema.sqlVersion, 32)}` : ''}). Bind the report's fields to these names exactly.`];
  const budget = schema.samples && Object.keys(schema.samples).length ? MAX_AI_LAYOUT_SAMPLES : MAX_AI_LAYOUT;
  // Room kept for the line that counts the objects left out.
  let used = lines[0].length + 48;
  const listed = [...schema.objects.map((o) => ({ o })), ...schema.procedures.map((p) => ({ p }))];
  // The likeliest first when the caller ranked them (databaseAi.ts, 2026-11-09), so the cap drops the least likely.
  // Each name's first place in the order, looked up once (SEC-7's review of a large layout: an indexOf per comparison was quadratic).
  const rank = new Map<string, number>();
  order?.forEach((name, i) => {
    if (!rank.has(name)) rank.set(name, i);
  });
  const at = (item: (typeof listed)[number]) => rank.get('o' in item ? `${item.o.schema}.${item.o.name}` : `${item.p.schema}.${item.p.name}`) ?? Number.MAX_SAFE_INTEGER;
  const items = order ? [...listed].sort((a, b) => at(a) - at(b)) : listed;
  const shown = items.slice(0, maxObjects);
  let left = items.length - shown.length;
  for (const [i, item] of shown.entries()) {
    let line: string | null;
    if ('o' in item) {
      const o = item.o;
      const full = `${o.schema}.${o.name}`;
      const fk = new Map<string, { table: string; column: string }>();
      for (const f of schema.foreignKeys.filter((f) => f.table === full)) for (const c of f.columns) fk.set(c.column, { table: f.references, column: c.referencedColumn });
      const columns = capped(o.columns);
      const kind = o.kind === 'view' ? 'view' : 'table';
      const parts = columns.shown.map((c) => columnText(c, { pk: new Set(o.primaryKey), fk }));
      const tail = sampleText(schema.samples?.[full], columns.shown.map((c) => c.name));
      line = fitted({ head: `- ${aiText(o.schema)}.${aiText(o.name)} (${kind}): `, parts, more: columns.more, extra: o.columns.length - columns.shown.length, tail }, budget - used, columnsLeft);
    } else {
      const p = item.p;
      const parameters = capped(p.parameters);
      const params = parameters.shown.map((x) => `${aiText(x.name)} ${aiText(typeLabel(x))}${x.defaultValue !== undefined ? ` = ${aiText(x.defaultValue)}` : ''}${x.output ? ' OUTPUT' : ''}`).join(', ') + parameters.more;
      const results = capped(p.result);
      const head = `- ${aiText(p.schema)}.${aiText(p.name)}(${params}) procedure -> `;
      line = p.result.length
        ? fitted({ head, parts: results.shown.map((c) => `${aiText(c.name)} ${aiText(typeLabel(c))}`), more: results.more, extra: p.result.length - results.shown.length, tail: '' }, budget - used, columnsLeft)
        : fitted({ head, parts: [`(result unknown: ${aiText(p.resultError?.type ?? 'not described', 32)})`], more: '', extra: 0, tail: '' }, budget - used, () => '');
    }
    // An object that does not fit ends the list: the rest are less likely, and counted.
    if (line === null) {
      left += shown.length - i;
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  if (left) lines.push(`(${left} more objects not listed.)`);
  return lines.join('\n');
}
