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
 * outline and edits, the repair chain, the draft PDF, and since the CLI and
 * Forma Designer work's wave 4 the conversion of an SSRS or FastReport
 * report (`convert`; finding GAP1-1 of its design audit and the owner's
 * decision OC7). That file is another program's XML and is opened the same
 * way first, so the converter's own small reader never meets a file the
 * shape check refuses, and one built to be slow or large costs its own
 * thread, within the same bounds. Since that wave's review (U1), `copy`: a
 * report as it reads once opened, for the command line's batch to write
 * when its words changed nothing, so its output folder holds every report
 * and a rerun with --skip-existing asks the AI nothing again. Since that
 * work's wave 5: `layout`, a database's layout read with no report opened
 * (the one job that opens none), what a caller says before any AI is asked;
 * `bind`, a report bound to the query a caller pinned with no AI (D1-11);
 * and a database given to `convert`, which binds the converted report
 * (GAP1-5): nodeDatabase.ts's work, here so a layout built to be slow or
 * large costs this thread, never the one that answers. Since that work's
 * wave 7 (D1-11, the owner's OC7), a database given to `edit`, so the
 * server's repx_edit makes the chat's `data` edit with no AI, through the
 * chat's own hook, and says what the report then binds. Lines read from the
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
import type { QueryJson } from '../lib/databaseAi';
import { ToolRefusal, type Voice } from './caller';
import { bindConverted, bindRepaired, bindReport, bindingOf, readDatabase, type Binding, type ChosenBy, type DatabaseJob, type DatabaseRead, type RepairChosenBy } from './nodeDatabase';
import { fileLines, openReport, type LayoutKind } from './reportFile';

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
  /**
   * With `database` (the command line's batch, since the CLI work's wave-8 review, W8R-1) the report repaired is bound
   * to it with no AI (nodeDatabase.ts `bindRepaired`); the server's repx_repair sends none.
   */
  repair: { name: string; text: string; target: LayoutKind; designers: DesignerText[]; database?: DatabaseJob };
  /**
   * With `database` (the CLI work's wave 7, D1-11): a `data` edit binds to it through the chat's own hook (databaseAi.ts
   * `dataEditHook`), at the report's own version, and what the report binds is read back; without one a `data` edit is
   * declined in the caller's words, never the Data tab's, which agentEdit.ts says when no hook is given.
   */
  edit: { name: string; text: string; target: LayoutKind; edits: AgentEdit[]; designers: DesignerText[]; database?: DatabaseJob };
  pdf: { name: string; text: string; title: string };
  /**
   * An SSRS (.rdl, .rdlc) or FastReport (.frx) report's text; `file` is its own name, which the converter reads its kind and the report's name from.
   * With `database` (the CLI work's wave 5, GAP1-5) the report made is bound to it with no AI (nodeDatabase.ts `bindConverted`).
   */
  convert: { name: string; text: string; file: string; database?: DatabaseJob };
  /** A report to write as it reads, once opened (since the CLI work's wave-4 review, U1): the batch's copy of a report its words left as it was. */
  copy: { name: string; text: string; target: LayoutKind };
  /**
   * A database's layout read, with no report (the CLI work's wave 5): what a caller says before any AI is asked or any
   * report read, the database and its objects, and the query it pinned held to the layout (nodeDatabase.ts `readDatabase`).
   */
  layout: { database: DatabaseJob };
  /** A report bound to the query pinned, with no AI (the CLI work's wave 5, D1-11): nodeDatabase.ts `bindReport`, then the audit. */
  bind: { name: string; text: string; target: LayoutKind; database: DatabaseJob };
}

/** What a result says of the database a job read: what was read, what was not, and the query pinned as JSON. */
export interface LayoutSaid {
  said: string[];
  notices: string[];
  database: string;
  query: QueryJson | null;
}

/** What each job returns, beside what reading the report found. */
export interface Results {
  audit: { audit: Audited };
  outline: {
    counts: { bands: number; controls: number; fields: number; parameters: number; dataSources: number };
    outline: string[];
    dataSources: { name: string; connection: string; queries: string[] }[];
  };
  /** With a database, what binding the report repaired did and how its query was chosen, and what the layout's files held that was not read; null and none without one. */
  repair: { xml: string; repairs: string[]; said: string[]; audit: Audited; dropped: Dropped | null; bound: { binding: Binding; chosenBy: RepairChosenBy | null } | null; notices: string[] };
  /** With a database, what the report binds, read back from the report written (or, with nothing changed, the report read), and what the layout's files held that was not read; null and none without one. */
  edit: { changed: boolean; xml: string; applied: string[]; declined: string[]; unmarked: boolean; dropped: Dropped | null; binding: Binding | null; notices: string[] };
  pdf: { drawn: { bytes: Uint8Array; pages: number; problems: string[] } | null };
  /**
   * The report made from it, repaired, with the converter's notices and its audit; null when it will not convert. With a
   * database, what binding it did (`bound`, null without one): the binding, how its query was chosen, and the layout read.
   */
  convert: { converted: { xml: string; notices: string[]; audit: Audited; bound: { binding: Binding; chosenBy: ChosenBy | null; layout: LayoutSaid } | null } | null };
  /** The report as opened (its login out), Visual Studio's working-file mark neutralised for a .repx, and its audit. */
  copy: { xml: string; unmarked: boolean; audit: Audited };
  layout: LayoutSaid;
  /** The report bound (`xml` '' when nothing could be), the note, the binding, the layout read, the working-file mark neutralised, and the audit of the report bound. */
  bind: { xml: string; note: string; binding: Binding; notices: string[]; layout: LayoutSaid; unmarked: boolean; audit: Audited | null };
}

export type JobName = keyof Jobs;
/**
 * A job: its tool, what that tool is sent, and whose words the refusals and
 * notices are in (caller.ts `Voice`; since the CLI and Forma Designer work's
 * wave 2, CLI-10), plain data, since a function cannot cross to the worker.
 */
export type Job = { [T in JobName]: { tool: T; voice: Voice } & Jobs[T] }[JobName];
/** What reading the report found: whether a login was taken out, whether a connection changed, and the notices. */
export type ReportRead = { loginRemoved: boolean; connectionsChanged: boolean; notices: string[] };
export type Done<T extends JobName> = { report: ReportRead } & Results[T];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The audit of a report as a result says it; the AI tools' work (genJobs.ts) says its report's the same way. */
export async function audited(xml: string): Promise<Audited> {
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

const WORK: { [T in JobName]: (job: Jobs[T], xml: string, voice: Voice) => Promise<Results[T]> } = {
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

  repair: async (job, xml, voice) => {
    const [{ repairRepx, versionOf }, { hasReportScripts }] = await Promise.all([import('../lib/repairChain'), import('../lib/shares')]);
    // The layout first, so one that cannot be read is refused before the repair's work, as convert reads it (nodeDatabase.ts).
    const db = job.database ? await readDatabase(job.database, voice) : null;
    // The developer's own code is kept, as the generation keeps a user's (GAP1-3, SE-02b).
    const repaired = repairRepx(xml, { version: versionOf(xml), keepScripts: hasReportScripts(xml), target: job.target });
    const applied = repaired.steps.filter((s) => s.applied);
    // With a database, the report repaired is bound with no AI at its own version, as bind writes one (W8R-1).
    const bound = db && job.database ? await bindRepaired(repaired.xml, db.schema, { connectionName: job.database.connectionName, voice, query: db.query, version: versionOf(xml) }) : null;
    const out = bound?.xml ?? repaired.xml;
    return {
      xml: out,
      repairs: applied.map((s) => s.name),
      said: fileLines(applied.map((s) => `${s.name}: ${s.reason}`)),
      audit: await audited(out),
      dropped: job.target === 'vsrepx' ? await droppedNames(xml, out, job.designers) : null,
      bound: bound ? { binding: bound.binding, chosenBy: bound.chosenBy } : null,
      notices: [...(db?.notices ?? [])],
    };
  },

  edit: async (job, xml, voice) => {
    const [{ applyEdits }, { workingFileMark, versionOf }] = await Promise.all([import('../lib/agentEdit'), import('../lib/repairChain')]);
    // The layout first, so one that cannot be read is refused before any edit is made (nodeDatabase.ts); a `data` edit binds
    // to it at the report's own version, as a repair writes it, through the chat's own hook (the CLI work's wave 7, D1-11).
    const db = job.database ? await readDatabase(job.database, voice) : null;
    const dbAi = db ? await import('../lib/databaseAi') : null;
    const connectionName = job.database?.connectionName;
    const hooks = {
      data:
        db && dbAi
          ? dbAi.dataEditHook(db.schema, versionOf(xml), () => undefined, connectionName !== undefined ? { connectionName } : {})
          : (unchanged: string) => ({ xml: unchanged, applied: false, reason: NO_DATABASE_EDIT[voice] }),
    };
    const outcome = applyEdits(xml, job.edits, hooks);
    const said = { applied: fileLines(outcome.applied), declined: fileLines(outcome.declined) };
    const notices = [...(db?.notices ?? [])];
    // What the report binds, read back from it as it will be written, or as it is when nothing changed (D1-9).
    const bindingFor = async (read: string) => (db ? bindingOf(read, db.schema) : null);
    if (!outcome.changed) return { changed: false, xml: '', ...said, unmarked: false, dropped: null, binding: await bindingFor(xml), notices };
    // Written as a .repx, Visual Studio's working-file mark is neutralised (GAP1-2).
    const unmarked = job.target === 'repx' ? workingFileMark(outcome.xml, 'repx') : null;
    const out = unmarked?.applied ? unmarked.xml : outcome.xml;
    return {
      changed: true,
      xml: out,
      ...said,
      unmarked: unmarked?.applied === true,
      dropped: job.target === 'vsrepx' ? await droppedNames(xml, out, job.designers) : null,
      binding: await bindingFor(out),
      notices,
    };
  },

  pdf: async (job, xml) => {
    const { draftPdf } = await import('../lib/draftPdf');
    const drawn = await draftPdf(xml, job.title);
    return { drawn: drawn ? { bytes: drawn.bytes, pages: drawn.pages, problems: fileLines(drawn.problems) } : null };
  },

  convert: async (job, xml, voice) => {
    // The web app's own conversion (lib/repxIntake.ts `importedReport`: lib/importForeign.ts, then the repair chain at
    // DevExpress 20.1, which it writes whatever version is asked). One that throws is one that will not convert, as the
    // intake has it (the re-audit's R5-07); its message stays here, since a library's words can quote the file (REV4-2).
    const { importedReport } = await import('../lib/repxIntake');
    // The layout first, so one that cannot be read is refused before the conversion's work (nodeDatabase.ts).
    const db = job.database ? await readDatabase(job.database, voice) : null;
    let made: Awaited<ReturnType<typeof importedReport>> = null;
    try {
      made = await importedReport(job.file, xml);
    } catch {
      made = null;
    }
    if (!made) return { converted: null };
    if (!db || !job.database) return { converted: { xml: made.xml, notices: [...made.notices], audit: await audited(made.xml), bound: null } };
    // A query the caller pinned binds every converted report (a batch's, the wave-5 review's BT-4); what binding did is in its notes.
    const done = await bindConverted(made.xml, { file: job.file, text: xml }, db.schema, { connectionName: job.database.connectionName, voice, query: db.query });
    return {
      converted: { xml: done.xml, notices: [...made.notices, ...db.notices], audit: await audited(done.xml), bound: { binding: done.binding, chosenBy: done.chosenBy, layout: await layoutSaid(db) } },
    };
  },

  copy: async (job, xml) => {
    // Nothing changed but what opening it takes out (its login) and, written as a .repx, the working-file mark (GAP1-2).
    const { workingFileMark } = await import('../lib/repairChain');
    const unmarked = job.target === 'repx' ? workingFileMark(xml, 'repx') : null;
    const out = unmarked?.applied ? unmarked.xml : xml;
    return { xml: out, unmarked: unmarked?.applied === true, audit: await audited(out) };
  },

  // Read before any report, so a caller says what it read before any AI is asked (layoutWork, below runJob).
  layout: async () => {
    throw new Error('a layout job opens no report');
  },

  bind: async (job, xml, voice) => {
    const db = await readDatabase(job.database, voice);
    if (!db.query) throw new ToolRefusal(BIND_NEEDS[voice]);
    const [{ versionOf, workingFileMark }] = await Promise.all([import('../lib/repairChain')]);
    // At the report's own version, as a repair writes it; the connection it already names kept (nodeDatabase.ts `bindReport`).
    const done = await bindReport(xml, db.schema, db.query, { connectionName: job.database.connectionName, version: versionOf(xml), voice });
    const layout = await layoutSaid(db);
    if (!done.binding.bound) return { xml: '', note: done.note, binding: done.binding, notices: [...db.notices], layout, unmarked: false, audit: null };
    const unmarked = job.target === 'repx' ? workingFileMark(done.xml, 'repx') : null;
    const out = unmarked?.applied ? unmarked.xml : done.xml;
    return { xml: out, note: done.note, binding: done.binding, notices: [...db.notices], layout, unmarked: unmarked?.applied === true, audit: await audited(out) };
  },
};

/**
 * Why a `data` edit is declined when no database layout came with the edits (the edit job's `database`), in the
 * caller's words. A decline is listed under fromFile.declined, beside the edit it declines, so the server's says a fact
 * and no next step: repx_edit refuses such a call before the job, in its own words (reportTools.ts
 * `DATA_NEEDS_DATABASE`, the wave-7 review's W7-MCP-3), so this is its fallback alone.
 */
const NO_DATABASE_EDIT: Record<Voice, string> = {
  mcp: 'no database layout came with the edits, so what the report reads cannot change',
  cli: 'no database layout was given, so what the report reads cannot change: the bind command binds a report with no AI',
};

/** What `bind` is told when no query was pinned: binding with no AI binds what the person names. */
const BIND_NEEDS: Record<Voice, string> = {
  mcp: 'Name what the report reads: a stored procedure, a table or view, or a query as JSON. Nothing was written.',
  cli: 'Name what the report reads with --procedure, --object or --query. Nothing was written.',
};

/** A layout read, as a result says it: what was read and not read, the database's name, and the query pinned as JSON. */
async function layoutSaid(db: DatabaseRead): Promise<LayoutSaid> {
  const { queryToJson } = await import('../lib/databaseAi');
  return { said: [...db.said], notices: [...db.notices], database: db.schema.database, query: db.query ? queryToJson(db.query) : null };
}

/** A layout job: the database read, no report opened (`Jobs['layout']`). */
async function layoutWork(job: Extract<Job, { tool: 'layout' }>): Promise<Done<'layout'>> {
  return { report: { loginRemoved: false, connectionsChanged: false, notices: [] }, ...(await layoutSaid(await readDatabase(job.database, job.voice))) };
}

/** Opens the report a job carries and runs its tool's work on it. Throws a `ToolRefusal` in plain words. */
export async function runJob<T extends JobName>(job: Extract<Job, { tool: T }>): Promise<Done<T>> {
  if (job.tool === 'layout') return layoutWork(job as Extract<Job, { tool: 'layout' }>) as unknown as Promise<Done<T>>;
  const withReport = job as Extract<Job, { text: string }>;
  const opened = openReport(withReport.text, withReport.name, job.voice);
  const work = WORK[job.tool as T] as (job: Jobs[T], xml: string, voice: Voice) => Promise<Results[T]>;
  const result = await work(job as unknown as Jobs[T], opened.xml, job.voice);
  return { report: { loginRemoved: opened.loginRemoved, connectionsChanged: opened.connectionsChanged, notices: opened.notices }, ...result } as Done<T>;
}

/** Said when a report's parts nest past what a reading can follow; the shape check bounds the nesting first, so this is the backstop. */
export const TOO_DEEP = 'Forma stopped working on this report: its parts nest more deeply than a reading can follow. Nothing was written.';

/**
 * How a job's failure crosses back to the thread that answers the host: a refusal's words, with what it carries for
 * `fromFile` (since the CLI work's wave 7, plain data), or an error's stack for the log.
 */
export function jobFailure(error: unknown): { refusal: string; fromFile?: Record<string, unknown> } | { error: string } {
  if (error instanceof ToolRefusal) return { refusal: error.message, ...(error.fromFile ? { fromFile: error.fromFile } : {}) };
  if (error instanceof RangeError && /call stack/i.test(error.message)) return { refusal: TOO_DEEP };
  return { error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
}
