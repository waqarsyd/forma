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

/** The JSON inside `<?forma ...?>`, or the outermost braces of whatever was pasted. */
export function unwrapExport(text: string): unknown | null {
  const pi = /<\?forma\s+([\s\S]*?)\?>/.exec(text);
  let body = pi ? pi[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  body = body.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
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
  const doc = asRecord(unwrapExport(text));
  if (!doc || doc.format !== 'forma-sql-schema') return null;
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
  const doc = asRecord(unwrapExport(text));
  if (!doc || doc.format !== 'forma-sql-sample') return null;
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
  | { kind: 'schema'; schema: SqlSchema }
  | { kind: 'sample'; database: string; samples: Record<string, Record<string, unknown>[]> };

/** Whether a pasted or attached text is a database's layout or sample rows, and what it holds. */
export function readDatabaseText(text: string, fallbackName = ''): DatabaseText | null {
  if (/forma-sql-schema/.test(text)) {
    const schema = readSchemaExport(text);
    if (schema) return { kind: 'schema', schema };
  }
  if (/forma-sql-sample/.test(text)) {
    const sample = readSampleExport(text);
    if (sample) return { kind: 'sample', ...sample };
  }
  if (/\bCREATE\s+(OR\s+ALTER\s+)?(TABLE|VIEW|PROC(EDURE)?)\b/i.test(text)) {
    const schema = readSchemaScript(text, fallbackName);
    if (schema) return { kind: 'schema', schema };
  }
  return null;
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

/** Sample rows on their own, before the layout they belong to has been read. */
export function samplesForAi(database: string, samples: Record<string, Record<string, unknown>[]>): string {
  const lines = [`SAMPLE ROWS from database "${database || 'unnamed'}". Bind the report's fields to these column names exactly.`];
  for (const [name, rows] of Object.entries(samples)) lines.push(`- ${name}: ${JSON.stringify(rows.slice(0, AI_SAMPLE_VALUES))}`);
  return lines.join('\n');
}

function columnText(c: SqlColumn, key: { pk: Set<string>; fk: Map<string, string> }): string {
  const marks = [key.pk.has(c.name) ? 'PK' : '', key.fk.has(c.name) ? `FK->${key.fk.get(c.name)}` : '', c.nullable === false ? 'not null' : ''].filter(Boolean);
  return `${c.name} ${typeLabel(c) || '?'}${marks.length ? ` ${marks.join(' ')}` : ''}`;
}

function sampleText(rows: Record<string, unknown>[] | undefined, columns: string[]): string {
  if (!rows?.length) return '';
  const values = columns
    .map((name) => {
      const seen = rows.map((r) => r[name]).filter((v) => v !== null && v !== undefined && v !== '').slice(0, AI_SAMPLE_VALUES);
      return seen.length ? `${name}=${seen.map((v) => JSON.stringify(v)).join('|')}` : '';
    })
    .filter(Boolean);
  return values.length ? `\n    e.g. ${values.join('; ')}` : '';
}

/**
 * The layout as compact text for the AI: one line per object, keys marked,
 * and sample values when the user ran the sample script (the owner allowed
 * names and values on 2026-11-08). Capped at `maxObjects`, with the rest
 * counted, so a large database does not spend the free tier.
 */
export function schemaForAi(schema: SqlSchema, maxObjects = 80, order?: readonly string[]): string {
  const lines: string[] = [`DATABASE "${schema.database || 'unnamed'}" (SQL Server${schema.sqlVersion ? ` ${schema.sqlVersion}` : ''}). Bind the report's fields to these names exactly.`];
  const listed = [...schema.objects.map((o) => ({ o })), ...schema.procedures.map((p) => ({ p }))];
  // The likeliest first when the caller ranked them (databaseAi.ts, 2026-11-09), so the cap drops the least likely.
  const at = (item: (typeof listed)[number]) => {
    const i = order?.indexOf('o' in item ? `${item.o.schema}.${item.o.name}` : `${item.p.schema}.${item.p.name}`) ?? -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const items = order ? [...listed].sort((a, b) => at(a) - at(b)) : listed;
  for (const item of items.slice(0, maxObjects)) {
    if ('o' in item) {
      const o = item.o;
      const full = `${o.schema}.${o.name}`;
      const fk = new Map<string, string>();
      for (const f of schema.foreignKeys.filter((f) => f.table === full)) for (const c of f.columns) fk.set(c.column, `${f.references}.${c.referencedColumn}`);
      lines.push(`- ${full} (${o.kind}): ${o.columns.map((c) => columnText(c, { pk: new Set(o.primaryKey), fk })).join(', ')}${sampleText(schema.samples?.[full], o.columns.map((c) => c.name))}`);
    } else {
      const p = item.p;
      const params = p.parameters.map((x) => `${x.name} ${typeLabel(x)}${x.defaultValue !== undefined ? ` = ${x.defaultValue}` : ''}${x.output ? ' OUTPUT' : ''}`).join(', ');
      const result = p.result.length ? p.result.map((c) => `${c.name} ${typeLabel(c)}`).join(', ') : `(result unknown: ${p.resultError?.type ?? 'not described'})`;
      lines.push(`- ${p.schema}.${p.name}(${params}) procedure -> ${result}`);
    }
  }
  if (items.length > maxObjects) lines.push(`(${items.length - maxObjects} more objects not listed.)`);
  return lines.join('\n');
}
