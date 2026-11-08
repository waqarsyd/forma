/**
 * The SQL Server companion, from the browser (2026-11-09, the SQL Server
 * programme, Phase 2, checklist items 35 to 37).
 *
 * The designer companion (tools/RepxDesigner) gained routes under `/sql/`,
 * behind the same two guards as `/open`: a Forma origin served from this
 * machine, and the `x-forma-client` header that forces a preflight. The page
 * only ever names a connection; the connections, and any login's password,
 * are entered at the companion and kept on the PC, encrypted for that Windows
 * user (the owner's rule of 2026-11-08: a credential is held on the user's
 * own PC and nowhere else). Nothing here sends SQL: the layout is Forma's own
 * script, kept in the companion; samples are built there from checked names;
 * a fill runs the report's own data source.
 *
 * A page the companion would refuse never calls it (`designerReachableFrom`):
 * the deployed site explains how instead, as it does for the designer.
 */
import { DESIGNER_CLIENT_HEADER, DESIGNER_ORIGIN, designerReachableFrom } from './designerBridge';

export interface CompanionConnection {
  name: string;
  mode: 'windows' | 'login';
  database: string;
}

export interface FilledQuery {
  name: string;
  columns: { name: string; type: string }[];
  /** Each row's values in column order: a number, text, a boolean or null; a decimal and a date as text. */
  rows: unknown[][];
}

export type FillResult =
  | { kind: 'filled'; queries: FilledQuery[] }
  /** The connections the report names that the companion does not keep. */
  | { kind: 'missing'; names: string[] }
  /** Stored procedures that run only when the person asks (item 35). */
  | { kind: 'procedures'; names: string[] }
  | { kind: 'error'; message: string };

/** Whether this page may ask the companion at all. */
export function companionReachableFrom(origin: string): boolean {
  return designerReachableFrom(origin);
}

async function call(path: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${DESIGNER_ORIGIN}${path}`, { ...init, signal: controller.signal, headers: { ...(init.headers ?? {}), [DESIGNER_CLIENT_HEADER]: '1' } });
  } finally {
    clearTimeout(timer);
  }
}

/** The connections the companion keeps, or null when no companion answers. */
export async function companionConnections(): Promise<CompanionConnection[] | null> {
  try {
    const res = await call('/sql/connections', {}, 2_000);
    if (!res.ok) return null;
    const body = (await res.json()) as { connections?: CompanionConnection[] };
    return Array.isArray(body.connections) ? body.connections : [];
  } catch {
    return null;
  }
}

async function text(res: Response): Promise<string> {
  const body = await res.text();
  if (res.ok) return body;
  try {
    const json = JSON.parse(body) as { error?: string; missing?: string[] };
    if (json.missing) throw new Error(`The companion keeps no connection named ${json.missing.join(', ')}.`);
    throw new Error(json.error ?? `The companion answered ${res.status}.`);
  } catch (err) {
    if (err instanceof Error && !(err instanceof SyntaxError)) throw err;
    throw new Error(`The companion answered ${res.status}.`);
  }
}

/** Forma's layout script's output, run by the companion: what `readDatabaseText` reads (item 35). */
export async function companionLayout(connection: string): Promise<string> {
  return text(await call(`/sql/schema?connection=${encodeURIComponent(connection)}`, {}, 180_000));
}

/** The sample script's output for these tables or views, built by the companion. */
export async function companionSamples(connection: string, objects: readonly string[], rows = 5): Promise<string> {
  const query = `connection=${encodeURIComponent(connection)}&objects=${encodeURIComponent(objects.join(','))}&rows=${rows}`;
  return text(await call(`/sql/sample?${query}`, {}, 120_000));
}

/**
 * The report filled from the database (item 37): each query's first rows, as
 * DevExpress filled them on the PC, with the parameter values the reader
 * typed. A stored procedure runs only with `procedures`, which only the
 * button that names them sets.
 */
export async function companionFill(repx: string, values: Readonly<Record<string, string>>, procedures = false): Promise<FillResult> {
  const params = Object.entries(values).filter(([, v]) => v !== '').map(([k, v]) => `p.${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  const query = [procedures ? 'procedures=1' : '', ...params].filter(Boolean).join('&');
  let res: Response;
  try {
    res = await call(`/sql/fill${query ? `?${query}` : ''}`, { method: 'POST', body: repx, headers: { 'content-type': 'text/xml' } }, 120_000);
  } catch {
    return { kind: 'error', message: 'The companion did not answer. Is RepxDesigner.exe --serve running?' };
  }
  const body = (await res.json().catch(() => ({}))) as { queries?: FilledQuery[]; missing?: string[]; procedures?: string[]; error?: string };
  if (res.ok && body.queries) return { kind: 'filled', queries: body.queries };
  if (res.status === 404 && body.missing) return { kind: 'missing', names: body.missing };
  if (res.status === 409 && body.procedures) return { kind: 'procedures', names: body.procedures };
  return { kind: 'error', message: body.error ?? `The companion answered ${res.status}.` };
}

/* ------------------------------------------------------------ into the Preview */

/** A .NET type, as DevExpress filled it, into the hint `typeRows` reads (lib/sqlPreview.ts). */
export function hintOfNetType(type: string): string {
  switch (type) {
    case 'Int16': case 'Int32': case 'Int64': case 'Byte': case 'SByte': case 'UInt16': case 'UInt32': case 'UInt64':
      return 'int';
    // The companion writes a decimal with its own scale ("31.00"), so the value carries it.
    case 'Decimal':
      return 'decimal';
    case 'Double': case 'Single':
      return 'double';
    case 'DateTime':
      return 'date';
    case 'DateTimeOffset':
      return 'dto';
    case 'Boolean':
      return 'bool';
    case 'Guid':
      return 'guid';
    default:
      return 'string';
  }
}

const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** One query's rows as the Preview's string rows. */
export function rowsOf(query: FilledQuery): Record<string, string>[] {
  return query.rows.map((row) => Object.fromEntries(query.columns.map((c, i) => [c.name, cell(row[i])])));
}

/**
 * A fill into what the Preview takes (item 37): the rows of the query the
 * report reads, every field's type, a detail report's rows by its relation's
 * keys, and each lookup query's values for its parameter.
 */
export function previewFromFill(
  queries: readonly FilledQuery[],
  main: string,
  relations: readonly { name: string; master: string; detail: string; keys: { master: string; detail: string }[] }[],
  lookups: readonly { parameter: string; dataMember: string; valueMember: string }[],
): {
  rows: Record<string, string>[];
  hints: Record<string, string>;
  related: (dataMember: string, master: Record<string, string>) => Record<string, string>[] | null;
  choices: Record<string, string[]>;
} {
  const byName = new Map(queries.map((q) => [q.name, q]));
  const hints: Record<string, string> = {};
  for (const q of queries) for (const c of q.columns) if (!(c.name in hints)) hints[c.name] = hintOfNetType(c.type);
  const choices: Record<string, string[]> = {};
  for (const l of lookups) {
    const q = byName.get(l.dataMember);
    if (q) choices[l.parameter] = [...new Set(rowsOf(q).map((r) => r[l.valueMember] ?? '').filter(Boolean))];
  }
  return {
    rows: byName.get(main) ? rowsOf(byName.get(main)!) : [],
    hints,
    related: (dataMember, master) => {
      const relation = relations.find((r) => r.name === dataMember.split('.').pop());
      const detail = relation ? byName.get(relation.detail) : undefined;
      if (!relation || !detail) return null;
      return rowsOf(detail).filter((r) => relation.keys.every((k) => (r[k.detail] ?? '') === (master[k.master] ?? '')));
    },
    choices,
  };
}
