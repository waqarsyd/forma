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
 * A page the companion would refuse never calls it: the `/sql/` routes answer
 * a page served from this PC alone (`designerLocalOrigin`), and since
 * 2026-11-09, when Forma's website may hand a report to the designer, that is
 * narrower than `designerReachableFrom`. The website explains how instead.
 *
 * What a person reads is said in the product's name, Forma Designer, and in
 * plain words with the way forward (2026-11-11, the full audit, SD-09): until
 * then a fill with no DevExpress said "The companion answered 424.", a
 * companion not running "Is RepxDesigner.exe --serve running?", and one from
 * before these routes answered 404 with nothing mapped. "Companion" stays the
 * code's word for it.
 */
import { DESIGNER_CLIENT_HEADER, DESIGNER_ORIGIN, designerLocalOrigin } from './designerBridge';
import { DEVEXPRESS_TRIAL_URL } from './designerRelease';

/** Where a problem is put right: Forma's download page, or DevExpress's trial. */
export interface CompanionLink {
  href: string;
  label: string;
}

/** A problem with Forma Designer's answer, in words, and the link that puts it right when there is one. */
export class CompanionProblem extends Error {
  readonly link?: CompanionLink;
  constructor(message: string, link?: CompanionLink) {
    super(message);
    this.name = 'CompanionProblem';
    this.link = link;
  }
}

/**
 * The page ports the `/sql/` routes answer without being told (2026-11-11,
 * SE-05, Program.cs's PagePorts): 3000 for npm run dev and npm start, 3001 for
 * the mock server. Another needs Forma Designer started with `--page-port N`,
 * and until then the browser sees its refusal as no answer at all.
 */
export const COMPANION_PAGE_PORTS: readonly number[] = [3000, 3001];

/** The port note for a page Forma Designer may refuse, or '' for one it answers. */
export function pagePortNote(origin: string): string {
  if (!designerLocalOrigin(origin)) return '';
  const port = Number(/:(\d+)$/.exec(origin)?.[1] ?? 80);
  return COMPANION_PAGE_PORTS.includes(port)
    ? ''
    : ` It reads databases only for Forma at port 3000 or 3001, and this page is at port ${port}: start Forma Designer with --page-port ${port} to use it here.`;
}

const pageOrigin = () => (typeof window === 'undefined' ? '' : window.location.origin);

/** Not running, or from before the `/sql/` routes (it answers them 404). */
export function notRunning(origin = pageOrigin()): CompanionProblem {
  return new CompanionProblem(
    `Forma Designer is not running, or is older than this feature. Start it from the Start menu, or download the latest.${pagePortNote(origin)}`,
    { href: '/download', label: 'Download Forma Designer' },
  );
}

/** A fill is DevExpress filling the report's own data source, so with no DevExpress there is none (424). */
export const NO_DEVEXPRESS_FOR_ROWS = new CompanionProblem(
  'Live rows need DevExpress Reporting on this PC, since it fills the report as DevExpress does. Its free trial is at devexpress.com.',
  { href: DEVEXPRESS_TRIAL_URL, label: 'Get the DevExpress trial' },
);

/** A connection the report or the person names that Forma Designer does not keep. */
function missingConnection(names: readonly string[]): string {
  return `Forma Designer keeps no connection named ${names.join(', ')}. Add it from its tray menu, SQL Server connections.`;
}

/**
 * An answer that is not the result, in words. A failure the database or
 * DevExpress reported carries its own message (which names what is wrong)
 * after the .NET type name, which says nothing to a person and goes.
 */
function companionProblem(status: number, body: { error?: string; missing?: string[] } = {}): CompanionProblem {
  if (status === 404 && body.missing?.length) return new CompanionProblem(missingConnection(body.missing));
  if (status === 404) return notRunning();
  if (status === 424) return NO_DEVEXPRESS_FOR_ROWS;
  const said = body.error?.replace(/^[\w.]*Exception:\s*/, '').trim();
  return new CompanionProblem(said ? `Forma Designer could not read the database: ${said}` : 'Forma Designer could not read the database.');
}

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
  | { kind: 'error'; message: string; link?: CompanionLink };

/** Whether this page may ask the companion's SQL Server routes: a page served from this PC only. */
export function companionReachableFrom(origin: string): boolean {
  return designerLocalOrigin(origin);
}

async function call(path: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // The caller's own signal too: the Preview's Cancel on Live rows (2026-11-11, SD-14c).
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener('abort', () => controller.abort(), { once: true });
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

/** The body of an answer, or a CompanionProblem in words; no answer at all is "not running". */
async function text(path: string, timeoutMs: number): Promise<string> {
  let res: Response;
  try {
    res = await call(path, {}, timeoutMs);
  } catch {
    // The browser's own "Failed to fetch", or a refusal it shows as one (a port the routes do not answer).
    throw notRunning();
  }
  const body = await res.text();
  if (res.ok) return body;
  let json: { error?: string; missing?: string[] } = {};
  try {
    json = JSON.parse(body) as typeof json;
  } catch {
    // Plain text: an older Forma Designer's "Not found", or nothing.
  }
  throw companionProblem(res.status, json);
}

/** Forma's layout script's output, run by the companion: what `readDatabaseText` reads (item 35). */
export async function companionLayout(connection: string): Promise<string> {
  return text(`/sql/schema?connection=${encodeURIComponent(connection)}`, 180_000);
}

/** The sample script's output for these tables or views, built by the companion. */
export async function companionSamples(connection: string, objects: readonly string[], rows = 5): Promise<string> {
  const query = `connection=${encodeURIComponent(connection)}&objects=${encodeURIComponent(objects.join(','))}&rows=${rows}`;
  return text(`/sql/sample?${query}`, 120_000);
}

/**
 * The report filled from the database (item 37): each query's first rows, as
 * DevExpress filled them on the PC, with the parameter values the reader
 * typed. A stored procedure runs only with `procedures`, which only the
 * button that names them sets. `signal` stops waiting for it (the Preview's
 * Cancel, 2026-11-11, SD-14c); the caller then reads nothing from the result.
 */
export async function companionFill(repx: string, values: Readonly<Record<string, string>>, procedures = false, signal?: AbortSignal): Promise<FillResult> {
  const params = Object.entries(values).filter(([, v]) => v !== '').map(([k, v]) => `p.${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  const query = [procedures ? 'procedures=1' : '', ...params].filter(Boolean).join('&');
  let res: Response;
  try {
    res = await call(`/sql/fill${query ? `?${query}` : ''}`, { method: 'POST', body: repx, headers: { 'content-type': 'text/xml' }, signal }, 120_000);
  } catch {
    const problem = notRunning();
    return { kind: 'error', message: problem.message, link: problem.link };
  }
  const body = (await res.json().catch(() => ({}))) as { queries?: FilledQuery[]; missing?: string[]; procedures?: string[]; error?: string };
  if (res.ok && body.queries) return { kind: 'filled', queries: body.queries };
  if (res.status === 404 && body.missing) return { kind: 'missing', names: body.missing };
  if (res.status === 409 && body.procedures) return { kind: 'procedures', names: body.procedures };
  const problem = companionProblem(res.status, body);
  return { kind: 'error', message: problem.message, ...(problem.link ? { link: problem.link } : {}) };
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
