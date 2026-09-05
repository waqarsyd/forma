/**
 * The fields a report can bind to, read from whatever the user has to hand.
 *
 * ## Why this exists at all
 *
 * `repxBindings.ts` derives a field name from a column heading: "Item
 * Description" becomes `[ItemDescription]`. That is a good guess and it is
 * still a guess -- it is the report telling us what it thinks the data is
 * called, when the data is the authority. A report bound to `[ItemDescription]`
 * against a source whose column is `DESCR` fails at run time in the one place
 * nobody looks, and the derived name is confident enough that nobody checks.
 *
 * So the user pastes what they actually have. Nobody keeps their schema in one
 * format, and the point of accepting four is that none of them requires the
 * user to retype anything:
 *
 * - a **JSON sample** -- an array of rows out of an API, or one object
 * - **CSV**, header row plus data, straight out of a spreadsheet export
 * - a **`CREATE TABLE`** statement, straight out of a schema dump
 * - a **plain list** of column names, when that is all they know
 *
 * Detection is by shape rather than by asking, because a paste box with a
 * format dropdown beside it is a question the paste already answers.
 *
 * ## Nothing here talks to a database
 *
 * Deliberately, and it is the same argument as the API key. A live connection
 * means credentials, which means either a server that holds them -- explicitly
 * out of scope in PRD 6 -- or a browser reaching a customer database directly.
 * A pasted sample gives the field names, the types and a real value to format
 * against, which is everything binding needs and none of what it would cost.
 */

export type FieldType = 'string' | 'number' | 'date' | 'boolean';

export interface DataField {
  /** The field name as the source spells it. Never invented. */
  name: string;
  type: FieldType;
  /** A real value from the source, for the format inference and the preview. */
  sample: string;
}

export type DataSourceKind = 'json' | 'csv' | 'sql' | 'list' | 'none';

export interface DataSource {
  kind: DataSourceKind;
  fields: DataField[];
  /** Rows actually read. 0 for a schema-only paste. */
  rowCount: number;
  /** What could not be read, in words worth showing the user. */
  problems: string[];
}

const EMPTY: DataSource = { kind: 'none', fields: [], rowCount: 0, problems: [] };

/** ISO-ish dates and the common written forms; deliberately not exhaustive. */
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}([T ]|$)|^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/;
const NUMERIC_VALUE = /^-?[$£€]?\s?-?[\d,]+(\.\d+)?%?$/;

/**
 * A field name safe to put inside `[…]` and inside an XML attribute.
 *
 * Spaces are kept: DevExpress reads `[Unit Price]` and a source really can
 * spell it that way. A `]` or a quote is removed rather than escaped, because
 * either would end the expression or the attribute early -- and a field whose
 * name contains one is not a field this can bind to whatever we do.
 */
export function cleanFieldName(raw: string): string {
  return raw
    .replace(/[[\]"'<>&]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function typeOfValue(value: unknown): FieldType {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  const text = String(value ?? '').trim();
  if (!text) return 'string';
  if (DATE_VALUE.test(text)) return 'date';
  if (NUMERIC_VALUE.test(text)) return 'number';
  if (/^(true|false|yes|no)$/i.test(text)) return 'boolean';
  return 'string';
}

/** SQL types map onto the four the report cares about, not onto themselves. */
function typeOfSqlType(sqlType: string): FieldType {
  const t = sqlType.toLowerCase();
  if (/(int|dec|numeric|float|real|double|money|number)/.test(t)) return 'number';
  if (/(date|time)/.test(t)) return 'date';
  if (/(bool|bit)/.test(t)) return 'boolean';
  return 'string';
}

const asSample = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  return String(value);
};

/**
 * Fields from an array of row objects.
 *
 * Keys are unioned across every row rather than taken from the first, because
 * a JSON API omits nulls and the first row is the one most likely to be
 * missing an optional column. Order follows first appearance, which is the
 * order a person reading the sample would expect.
 */
function fieldsFromRows(rows: Record<string, unknown>[]): DataField[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }
  }
  return order.map((key) => {
    const firstReal = rows.find((r) => r[key] !== null && r[key] !== undefined && r[key] !== '');
    const value = firstReal ? firstReal[key] : '';
    return { name: cleanFieldName(key), type: typeOfValue(value), sample: asSample(value) };
  }).filter((f) => f.name !== '');
}

function parseJson(text: string): DataSource {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      kind: 'json',
      fields: [],
      rowCount: 0,
      problems: [`That looks like JSON but it did not parse: ${(error as Error).message}`],
    };
  }

  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const objectRows = rows.filter(
    (r): r is Record<string, unknown> => typeof r === 'object' && r !== null && !Array.isArray(r),
  );

  if (!objectRows.length) {
    return {
      kind: 'json',
      fields: [],
      rowCount: 0,
      problems: ['This JSON has no objects in it, so there are no field names to read. Paste a row, or an array of rows.'],
    };
  }

  const problems: string[] = [];
  if (objectRows.length < rows.length) {
    problems.push(`Ignored ${rows.length - objectRows.length} entries that were not objects.`);
  }
  const fields = fieldsFromRows(objectRows);
  if (!fields.length) problems.push('No usable field names were found in this JSON.');
  return { kind: 'json', fields, rowCount: objectRows.length, problems };
}

/** Split one delimited line, honouring double quotes around a value. */
function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      out.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  out.push(cell);
  return out.map((c) => c.trim());
}

function parseCsv(text: string): DataSource {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return EMPTY;
  // Tab wins where both appear: a spreadsheet paste is tab-separated and its
  // cells legitimately contain commas.
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = splitDelimited(lines[0], delimiter);
  const dataRows = lines.slice(1).map((l) => splitDelimited(l, delimiter));
  const problems: string[] = [];

  const fields = headers.map((header, i) => {
    const sample = dataRows.map((r) => r[i]).find((v) => v !== undefined && v !== '') ?? '';
    return { name: cleanFieldName(header), type: typeOfValue(sample), sample };
  }).filter((f) => f.name !== '');

  if (fields.length < headers.length) {
    problems.push(`${headers.length - fields.length} column(s) had no usable name and were skipped.`);
  }
  const ragged = dataRows.filter((r) => r.length !== headers.length).length;
  if (ragged) {
    problems.push(`${ragged} row(s) do not have ${headers.length} columns. The header row decides the fields.`);
  }
  return { kind: 'csv', fields, rowCount: dataRows.length, problems };
}

/**
 * Columns out of a `CREATE TABLE`.
 *
 * Only the column list is read. Constraints, keys and indexes are skipped by
 * name rather than parsed, because a report binds to columns and everything
 * else in the statement is noise for this purpose.
 */
const CONSTRAINT = /^(primary|foreign|unique|key|constraint|index|check)\b/i;

/*
 * Name then type, and the name is the FIRST token rather than "everything up
 * to the last one".
 *
 * A single `[\w ]+` for the name looks equivalent and is not: it matches
 * spaces, so on `ShippedOn DATETIME2 NULL` -- a column whose type carries no
 * parentheses to stop it -- greedy backtracking gives back the minimum and
 * lands on a column named "ShippedOn DATETIME2" of type NULL. It only appears
 * to work on `NVARCHAR(200)` and `DECIMAL(10,2)`, where the bracket happens to
 * halt the match in the right place. Two explicit patterns instead: a quoted
 * name may contain spaces because the quoting delimits it, a bare one may not.
 */
const QUOTED_COLUMN = /^[`"[]([^`"\]]+)[`"\]]\s+([A-Za-z]\w*)/;
const BARE_COLUMN = /^(\w+)\s+([A-Za-z]\w*)/;

function parseSql(text: string): DataSource {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open === -1 || close <= open) {
    return { kind: 'sql', fields: [], rowCount: 0, problems: ['No column list was found between parentheses.'] };
  }

  const body = text.slice(open + 1, close);
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    // Only a comma at depth 0 separates columns; DECIMAL(10,2) has its own.
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);

  const fields: DataField[] = [];
  for (const part of parts) {
    const line = part.trim();
    if (!line) continue;
    // Tested with any opening quote removed, so `[PRIMARY KEY]` as a column
    // name is not mistaken for the constraint it is named after.
    if (CONSTRAINT.test(line.replace(/^[`"[]/, ''))) continue;
    const match = QUOTED_COLUMN.exec(line) ?? BARE_COLUMN.exec(line);
    if (!match) continue;
    const name = cleanFieldName(match[1]);
    if (name) fields.push({ name, type: typeOfSqlType(match[2]), sample: '' });
  }

  return {
    kind: 'sql',
    fields,
    rowCount: 0,
    problems: fields.length ? [] : ['No columns were found in that CREATE TABLE statement.'],
  };
}

function parseList(text: string): DataSource {
  const names = text
    .split(/[\n,;]+/)
    .map((n) => cleanFieldName(n))
    .filter(Boolean);
  if (!names.length) return EMPTY;
  return {
    kind: 'list',
    fields: names.map((name) => ({ name, type: 'string' as FieldType, sample: '' })),
    rowCount: 0,
    problems: [],
  };
}

/**
 * Read whatever was pasted.
 *
 * Detection is by shape and the order matters: JSON is checked first because a
 * JSON array full of commas would otherwise read as CSV, and `CREATE TABLE` is
 * checked before CSV because a column list contains commas too. The plain list
 * is last precisely because it accepts anything -- it is the fallback, not a
 * format that can be detected.
 */
export function parseDataSource(input: string | undefined | null): DataSource {
  const text = (input ?? '').trim();
  if (!text) return EMPTY;

  if (text.startsWith('[') || text.startsWith('{')) return parseJson(text);
  if (/\bcreate\s+table\b/i.test(text)) return parseSql(text);
  if (/\r?\n/.test(text) && /[,\t]/.test(text.split(/\r?\n/)[0])) return parseCsv(text);
  return parseList(text);
}

// ------------------------------------------------------------------ mapping

/** Letters and digits only, lowercased -- "Unit Price" and "unit_price" match. */
const squash = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Suggest which field belongs to which column.
 *
 * Exact squashed match first across every column, then containment, so a
 * confident pairing is never stolen by a loose one earlier in the list --
 * "Price" would otherwise claim `UnitPrice` before `Unit Price` reached it.
 * Each field is used at most once: two columns bound to one field is a report
 * that prints the same value twice, which is a mistake worth making visible
 * rather than resolving quietly.
 *
 * Returns one entry per heading, `null` where nothing matched. A suggestion is
 * a starting point for the user to correct, never an answer -- which is why
 * the unmatched case is a hole in the form rather than a best guess.
 */
export function suggestMapping(
  headings: readonly string[],
  fields: readonly DataField[],
): (string | null)[] {
  const result: (string | null)[] = headings.map(() => null);
  const used = new Set<string>();

  const claim = (index: number, field: DataField) => {
    result[index] = field.name;
    used.add(field.name);
  };

  headings.forEach((heading, i) => {
    const key = squash(heading);
    if (!key) return;
    const exact = fields.find((f) => !used.has(f.name) && squash(f.name) === key);
    if (exact) claim(i, exact);
  });

  headings.forEach((heading, i) => {
    if (result[i]) return;
    const key = squash(heading);
    if (!key) return;
    const loose = fields.find((f) => {
      if (used.has(f.name)) return false;
      const name = squash(f.name);
      return name.includes(key) || key.includes(name);
    });
    if (loose) claim(i, loose);
  });

  return result;
}
