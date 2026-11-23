/**
 * The work of Forma's report tools, as it runs in a worker thread
 * (2026-11-24, the wave-4 review's REV4-3): everything that costs time or
 * memory in proportion to what a report holds. The thread that answers the
 * host only judges paths, reads and writes files and shapes results
 * (reportTools.ts); it hands a job here through workerPool.ts, and
 * worker.mjs runs `runJob` on it in a thread with a memory bound and a
 * deadline, so a report built to be slow or large costs its own call and
 * never the server.
 *
 * Every job opens the report first (`openReport` in reportFile.ts: refused
 * unless it is well-formed XML, its stored login taken out and the result
 * read again), then runs the module the web app runs: the audit, the chat's
 * outline and edits, the repair chain, the draft PDF. Lines read from the
 * file come back already folded by `fileLines`, for the result's `fromFile`.
 * Whatever a job returns crosses to the other thread by structured clone,
 * so it holds only data.
 *
 * The pipeline modules are imported inside each job, so a job loads only
 * what it uses. The tests run `runJob` in their own thread as well
 * (testClient.ts, `inThread`), which is where its coverage is measured.
 *
 * Pure ASCII.
 */
import type { AgentEdit } from '../lib/agentEdit';
import { fileLines, openReport, type LayoutKind } from './reportFile';
import { ToolRefusal } from './toolShape';

/** A Designer file read beside a `.vsrepx`, for the names it looks up (GAP1-3). */
export interface DesignerText {
  file: string;
  text: string;
  /** The Designer beside the file to be written, which loads it: losing one of its names is fatal there. */
  besideTarget: boolean;
}

/** Names a written `.vsrepx` lost that its Designer file looks up. */
export interface Dropped {
  names: string[];
  besideTarget: boolean;
  file: string;
}

/** The audit of a report, as data and as lines of text read from the file. */
export interface Audited {
  data: { errors: number; warnings: number; summary: string; findings: { severity: 'error' | 'warning'; code: string }[] };
  lines: string[];
  words: string;
}

/** What each job is sent, beyond its tool's name. `name` is the path as the caller sent it, for a refusal's words. */
export interface Jobs {
  audit: { name: string; text: string };
  outline: { name: string; text: string };
  repair: { name: string; text: string; target: LayoutKind; designers: DesignerText[] };
  edit: { name: string; text: string; target: LayoutKind; edits: AgentEdit[]; designers: DesignerText[] };
  pdf: { name: string; text: string; title: string };
}

/** What each job returns, beside what reading the report found. */
export interface Results {
  audit: { audit: Audited };
  outline: {
    counts: { bands: number; controls: number; fields: number; parameters: number; dataSources: number };
    outline: string[];
    dataSources: { name: string; connection: string; queries: string[] }[];
  };
  repair: { xml: string; repairs: string[]; said: string[]; audit: Audited; dropped: Dropped | null };
  edit: { changed: boolean; xml: string; applied: string[]; declined: string[]; unmarked: boolean; dropped: Dropped | null };
  pdf: { drawn: { bytes: Uint8Array; pages: number; problems: string[] } | null };
}

export type JobName = keyof Jobs;
export type Job = { [T in JobName]: { tool: T } & Jobs[T] }[JobName];
/** What reading the report found: whether a login was taken out, whether a connection changed, and the notices. */
export type ReportRead = { loginRemoved: boolean; connectionsChanged: boolean; notices: string[] };
export type Done<T extends JobName> = { report: ReportRead } & Results[T];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function audited(xml: string): Promise<Audited> {
  const { auditRepx } = await import('../lib/repxAudit');
  const audit = auditRepx(xml);
  return {
    data: { errors: audit.errors, warnings: audit.warnings, summary: audit.summary, findings: audit.findings.map(({ severity, code }) => ({ severity, code })) },
    lines: fileLines(audit.findings.map((f) => `${f.severity} ${f.code}: ${f.message}`)),
    words: audit.findings.length ? `${plural(audit.errors, 'error')} and ${plural(audit.warnings, 'warning')}` : 'no problems',
  };
}

/** The names `after` lost that the first Designer file sent looks up; null when it looks none of them up. */
async function droppedNames(before: string, after: string, designers: readonly DesignerText[]): Promise<Dropped | null> {
  const designer = designers[0];
  if (!designer) return null;
  const { designerLookups, namesDropped } = await import('../lib/vsReport');
  const names = namesDropped(before, after, designerLookups(designer.text));
  return names.length ? { names, besideTarget: designer.besideTarget, file: designer.file } : null;
}

const WORK: { [T in JobName]: (job: Jobs[T], xml: string) => Promise<Results[T]> } = {
  audit: async (_job, xml) => ({ audit: await audited(xml) }),

  outline: async (_job, xml) => {
    const [{ reportOutline }, { parseReportStructure }, { readEveryDataSource }] = await Promise.all([import('../lib/agentEdit'), import('../lib/reportPreview'), import('../lib/repxSqlDataSource')]);
    const structure = parseReportStructure(xml, undefined, { asWritten: true });
    const fields = new Set<string>();
    for (const band of structure.bands) {
      for (const c of band.controls) {
        if (c.field) fields.add(c.field);
        for (const row of c.rows) for (const cell of row.cells) if (cell.field) fields.add(cell.field);
      }
    }
    // Every SQL data source the file stores, a subreport's and one kept in ObjectStorage included (REV4-1).
    const sources = readEveryDataSource(xml);
    return {
      counts: {
        bands: structure.bands.length,
        controls: structure.bands.reduce((n, band) => n + band.controls.length, 0),
        fields: fields.size,
        parameters: structure.parameters.length,
        dataSources: sources.length,
      },
      outline: fileLines(reportOutline(xml).split('\n')),
      dataSources: sources.map((s) => ({ name: s.name, connection: s.connectionName, queries: s.queries.map((q) => q.name) })),
    };
  },

  repair: async (job, xml) => {
    const [{ repairRepx, versionOf }, { hasReportScripts }] = await Promise.all([import('../lib/repairChain'), import('../lib/shares')]);
    // The developer's own code is kept, as the generation keeps a user's (GAP1-3, SE-02b).
    const repaired = repairRepx(xml, { version: versionOf(xml), keepScripts: hasReportScripts(xml), target: job.target });
    const applied = repaired.steps.filter((s) => s.applied);
    return {
      xml: repaired.xml,
      repairs: applied.map((s) => s.name),
      said: fileLines(applied.map((s) => `${s.name}: ${s.reason}`)),
      audit: await audited(repaired.xml),
      dropped: job.target === 'vsrepx' ? await droppedNames(xml, repaired.xml, job.designers) : null,
    };
  },

  edit: async (job, xml) => {
    const [{ applyEdits }, { workingFileMark }] = await Promise.all([import('../lib/agentEdit'), import('../lib/repairChain')]);
    const outcome = applyEdits(xml, job.edits);
    const said = { applied: fileLines(outcome.applied), declined: fileLines(outcome.declined) };
    if (!outcome.changed) return { changed: false, xml: '', ...said, unmarked: false, dropped: null };
    // Written as a .repx, Visual Studio's working-file mark is neutralised (GAP1-2).
    const unmarked = job.target === 'repx' ? workingFileMark(outcome.xml, 'repx') : null;
    const out = unmarked?.applied ? unmarked.xml : outcome.xml;
    return { changed: true, xml: out, ...said, unmarked: unmarked?.applied === true, dropped: job.target === 'vsrepx' ? await droppedNames(xml, out, job.designers) : null };
  },

  pdf: async (job, xml) => {
    const { draftPdf } = await import('../lib/draftPdf');
    const drawn = await draftPdf(xml, job.title);
    return { drawn: drawn ? { bytes: drawn.bytes, pages: drawn.pages, problems: fileLines(drawn.problems) } : null };
  },
};

/** Opens the report a job carries and runs its tool's work on it. Throws a `ToolRefusal` in plain words. */
export async function runJob<T extends JobName>(job: Extract<Job, { tool: T }>): Promise<Done<T>> {
  const opened = openReport(job.text, job.name);
  const work = WORK[job.tool as T] as (job: Jobs[T], xml: string) => Promise<Results[T]>;
  const result = await work(job as unknown as Jobs[T], opened.xml);
  return { report: { loginRemoved: opened.loginRemoved, connectionsChanged: opened.connectionsChanged, notices: opened.notices }, ...result } as Done<T>;
}

/** Said when a report's parts nest past what a reading can follow; the shape check bounds the nesting first, so this is the backstop. */
export const TOO_DEEP = 'Forma stopped working on this report: its parts nest more deeply than a reading can follow. Nothing was written.';

/** How a job's failure crosses back to the thread that answers the host: a refusal's words, or an error's stack for the log. */
export function jobFailure(error: unknown): { refusal: string } | { error: string } {
  if (error instanceof ToolRefusal) return { refusal: error.message };
  if (error instanceof RangeError && /call stack/i.test(error.message)) return { refusal: TOO_DEEP };
  return { error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
}
