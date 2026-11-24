/**
 * The one way a report tool of Forma's MCP server reads a report and writes
 * one (2026-11-24, the MCP work's wave 4; findings SEC-3, GAP1-1, GAP1-2,
 * GAP1-3 and PROTO-5 of the 2026-11-23 design audit). Every path goes
 * through paths.ts's `resolveReadPath` and `resolveWritePath`, every write
 * through its `writeOutput`, never around them.
 *
 * Reading is in two halves, since the wave-4 review (REV4-3): `readReport`
 * judges the path and reads the file on the thread that answers the host,
 * and `openReport` does everything that costs time in proportion to what
 * the file holds, in the worker thread a tool's work runs in (pipeline.ts,
 * workerPool.ts).
 *
 * - A report layout is a `.repx` or a `.vsrepx`: the same serializer XML,
 *   the second Visual Studio's working file for a report class (GAP1-2).
 * - A `.cs` or `.vb` file is refused by its name, never opened, in words
 *   that say how to get a .repx out of it, or that name the `.vsrepx` beside
 *   it when there is one (GAP1-1, `codeReportMessage` in lib/vsReport.ts).
 * - A file that is not well-formed XML is refused before any pattern reads
 *   it (`xmlShapeProblem`, one pass over the text): the review measured
 *   small malformed files, a run of unclosed tags, that held a tool's
 *   patterns for minutes. A document type is refused too, since a layout
 *   never declares one and its entities are what an expansion attack uses.
 * - The stored database login is taken out before anything else sees the
 *   text (SEC-3), as the web app's intake takes it out of an uploaded .repx
 *   (`withoutStoredLogin`, shared with repxIntake.ts): every data source the
 *   file stores, wherever DevExpress put it, then keeps its connection by
 *   name only. The result is read again, and a login still found there (in
 *   a connection left open, say) refuses the report, so nothing is returned
 *   or written from it (REV4-1). Every result says whether a login was
 *   removed (`loginRemoved`, and a notice when it was). A file whose
 *   connection was stored by more than its name is never written over in
 *   place, because the writing would take its connection out of it too.
 *
 * Writing:
 *
 * - An output is named by the caller, or put beside the input under the
 *   tool's own suffix (`outputPath`), and written by `writeReport`, which
 *   never replaces a file unless the call asked to.
 * - A `.vsrepx` is written only from a `.vsrepx` (`targetKind`), and the
 *   working-file mark is neutralised in any `.repx` (repairChain.ts,
 *   `workingFileMark`).
 * - Writing a `.vsrepx` reads its report class's Designer file, beside it
 *   (`designerFor`), and the worker reads the names it looks up (GAP1-3):
 *   repx_edit does not write a layout that lost one of them where that
 *   Designer loads it, since that field would be null when the report runs;
 *   repx_repair writes all the same, with a notice naming them.
 *
 * Text read from a file is returned only through `fileLines`, which keeps
 * every line within what toolShape.ts lets a string read from a file carry,
 * so a long line is continued rather than cut.
 *
 * Pure ASCII.
 */
import { readFileSync } from 'node:fs';
import { MAX_FILE_BYTES } from '../lib/attachmentBudget';
import { withoutStoredLogin } from '../lib/repxSqlDataSource';
import { codeReportClass, codeReportMessage, reportFileKind } from '../lib/vsReport';
import { parseToolPath, resolveReadPath, resolveWritePath, writeOutput, type PathSystem, type Root, type WriteFs, type WriteStatus } from './paths';
import { MAX_FILE_TEXT, ToolRefusal } from './toolShape';

/** What a report tool reads and writes. */
export const LAYOUT_EXTENSIONS = ['.repx', '.vsrepx'] as const;

export type LayoutKind = 'repx' | 'vsrepx';

/** Said in every result when a login was taken out. */
export const LOGIN_REMOVED =
  'This report kept a database login. Forma removed it before reading the report: nothing this tool returns or writes carries it, and the file you named is unchanged.';

/** Said when a written report's connection, kept with more than its name but no login, is now stored by name only. */
export const CONNECTION_BY_NAME =
  "The file written stores its data source's connection by name only, as Forma writes every connection; the application's configuration supplies the rest.";

/** A report file as the thread that answers the host reads it: judged by its path, its text not yet opened. */
export interface ReportFile {
  /** The file read: its real path, every link followed. */
  path: string;
  /** The path as the caller spelled it, resolved: an output beside the input is named from it. */
  spelled: string;
  kind: LayoutKind;
  /** The file's text as it is on disk, login and all: only `openReport` reads it. */
  text: string;
}

/** A report's text as a tool works on it, once `openReport` has taken its login out. */
export interface OpenedReport {
  /** The text every tool works on, every connection stored by name only. */
  xml: string;
  loginRemoved: boolean;
  /** A connection was stored by more than its name, a login or not, and is now stored by name only. */
  connectionsChanged: boolean;
  /** Notices in this server's own words, never text from the file. */
  notices: string[];
}

const shown = (p: string) => JSON.stringify(p);
const readText = (p: string) => readFileSync(p, 'utf8');
const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\r' || c === '\n';

/** The deepest a layout's elements may nest. A report with subreports and panels in tables nests a few dozen deep. */
export const MAX_DEPTH = 256;

/** An XML name, read where it starts. */
const XML_NAME = /[A-Za-z_:\u00C0-\uFFFF][\w.:\u00B7\u00C0-\uFFFF-]*/y;

/**
 * Why a text is not well-formed XML, in plain words with a line and column,
 * or null when it is (2026-11-24, the wave-4 review's REV4-3). One pass:
 * every tag opens and closes before the next begins, every attribute value
 * is quoted and holds no `<`, every element closes in order, one root,
 * nesting no deeper than `MAX_DEPTH`, and no document type. Each character is
 * looked at a bounded number of times, so it takes the same time on any file
 * of a size; the patterns that read a report after it never meet the shapes
 * that made them take minutes. Entities are not checked: no reading here
 * expands one. Exported for its tests.
 */
export function xmlShapeProblem(text: string): string | null {
  const stack: string[] = [];
  let roots = 0;
  const nameAt = (i: number) => {
    XML_NAME.lastIndex = i;
    return XML_NAME.exec(text)?.[0] ?? '';
  };
  const skip = (i: number) => {
    while (isSpace(text[i])) i++;
    return i;
  };
  const at = (i: number, why: string) => {
    const before = text.slice(0, i);
    return `${why} (line ${before.split('\n').length}, column ${i - before.lastIndexOf('\n')})`;
  };
  const skipTo = (from: number, close: string) => {
    const end = text.indexOf(close, from);
    return end < 0 ? -1 : end + close.length;
  };
  let i = 0;
  for (;;) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    const aside = (
      [
        ['<!--', '-->', 'a comment'],
        ['<![CDATA[', ']]>', 'a CDATA section'],
        ['<?', '?>', 'a processing instruction'],
      ] as const
    ).find(([open]) => text.startsWith(open, lt));
    if (aside) {
      i = skipTo(lt + aside[0].length, aside[1]);
      if (i < 0) return at(lt, `${aside[2]} never ends`);
      continue;
    }
    if (text.startsWith('<!', lt)) return at(lt, 'it declares a document type, which a DevExpress layout never does');
    if (text[lt + 1] === '/') {
      const name = nameAt(lt + 2);
      const end = skip(lt + 2 + name.length);
      if (!name || text[end] !== '>') return at(lt, 'a closing tag is not closed');
      if (stack.pop() !== name) return at(lt, 'a closing tag does not match the element it closes');
      i = end + 1;
      continue;
    }
    const name = nameAt(lt + 1);
    if (!name) return at(lt, "a '<' begins no tag");
    if (!stack.length && roots++) return at(lt, 'a second root element follows the first');
    let j = lt + 1 + name.length;
    for (;;) {
      const k = skip(j);
      if (text[k] === '>') {
        stack.push(name);
        if (stack.length > MAX_DEPTH) return at(lt, `its elements nest more than ${MAX_DEPTH} deep`);
        i = k + 1;
        break;
      }
      if (text[k] === '/' && text[k + 1] === '>') {
        i = k + 2;
        break;
      }
      const attr = k === j ? '' : nameAt(k);
      if (!attr) return at(k, 'a tag is not closed before something else begins');
      let v = skip(k + attr.length);
      if (text[v] !== '=') return at(k, 'an attribute has no value');
      v = skip(v + 1);
      const quote = text[v];
      if (quote !== '"' && quote !== "'") return at(k, 'an attribute value is not in quotes');
      const end = text.indexOf(quote, v + 1);
      if (end < 0) return at(k, 'an attribute value never ends');
      if (text.slice(v + 1, end).includes('<')) return at(k, "an attribute value holds a '<'");
      j = end + 1;
    }
  }
  if (stack.length) return at(text.length, `it ends with ${stack.length} element${stack.length === 1 ? '' : 's'} still open`);
  return roots ? null : 'it has no root element';
}

/**
 * A report's text opened for a tool, in the worker thread: refused unless it
 * is well-formed XML, its stored login taken out, and refused when one is
 * still there after that (REV4-1). `name` is the path as the caller sent it,
 * for the refusal's words. Throws a `ToolRefusal` in plain words.
 */
export function openReport(text: string, name: string): OpenedReport {
  const problem = xmlShapeProblem(text);
  if (problem) throw new ToolRefusal(`${shown(name)} is not well-formed XML, so Forma does not read it: ${problem}.`);
  const clean = withoutStoredLogin(text);
  if (clean.loginLeft) {
    throw new ToolRefusal(
      `${shown(name)} keeps a database login in a data source Forma could not read cleanly, so no tool reads it and nothing is written from it. Save the report with its connection stored by name only, then send it again.`,
    );
  }
  return { xml: clean.xml, loginRemoved: clean.hadLogin, connectionsChanged: clean.xml !== text, notices: clean.hadLogin ? [LOGIN_REMOVED] : [] };
}

/** Why a C# or VB file is refused, naming the `.vsrepx` beside it when there is one (a stat through the path rules, no read); generate_report's too. */
export function codeRefusal(spelled: string, roots: readonly Root[], sys: PathSystem): string {
  const { path } = sys;
  const dir = path.dirname(spelled);
  const cls = codeReportClass(spelled);
  const sibling = path.join(dir, `${cls}.vsrepx`);
  const layout = resolveReadPath(sibling, roots, sys, { extensions: ['.vsrepx'] }).ok ? sibling : null;
  return codeReportMessage(spelled, layout, path.join(dir, `${cls}.repx`));
}

/**
 * Reads the report at the path a tool was sent: judged by paths.ts, a
 * `.repx` or `.vsrepx` of at most the web app's file size, whose text names
 * DevExpress's layout element. Its text is opened only by `openReport`, in
 * the worker. Throws a `ToolRefusal` in plain words.
 */
export function readReport(raw: unknown, roots: readonly Root[], sys: PathSystem, read: (p: string) => string = readText): ReportFile {
  const parsed = parseToolPath(raw, sys.path, sys.home);
  if (!parsed.ok) throw new ToolRefusal(parsed.reason);
  if (reportFileKind(parsed.path) === 'code') throw new ToolRefusal(codeRefusal(parsed.path, roots, sys));
  const found = resolveReadPath(raw, roots, sys, { extensions: LAYOUT_EXTENSIONS, maxBytes: MAX_FILE_BYTES });
  if (!found.ok) throw new ToolRefusal(found.reason);
  const text = read(found.path);
  if (!/<XtraReportsLayoutSerializer\b/.test(text)) {
    throw new ToolRefusal(`${shown(parsed.path)} is not the XML layout DevExpress writes (it has no XtraReportsLayoutSerializer element), so Forma cannot read it.`);
  }
  return { path: found.path, spelled: parsed.path, kind: reportFileKind(found.path) === 'vsrepx' ? 'vsrepx' : 'repx', text };
}

/** A path beside `spelled`, its extension replaced by `suffix`. */
export function besideName(spelled: string, suffix: string, sys: PathSystem): string {
  const { path } = sys;
  return path.join(path.dirname(spelled), `${path.basename(spelled, path.extname(spelled))}${suffix}`);
}

/**
 * Where a tool writes: `output` when the caller named one, else beside the
 * input under `suffix`; judged by paths.ts for a write of one of
 * `extensions`. Throws a `ToolRefusal` in plain words.
 */
export function outputPath(output: string | undefined, report: ReportFile, suffix: string, extensions: readonly string[], roots: readonly Root[], sys: PathSystem): string {
  const raw = output === undefined || output === '' ? besideName(report.spelled, suffix, sys) : output;
  const verdict = resolveWritePath(raw, roots, sys, { extensions });
  if (!verdict.ok) throw new ToolRefusal(verdict.reason);
  return verdict.path;
}

/** What a written report is, by the name it is written under; a `.vsrepx` only from a `.vsrepx`. */
export function targetKind(target: string, report: ReportFile): LayoutKind {
  const kind: LayoutKind = reportFileKind(target) === 'vsrepx' ? 'vsrepx' : 'repx';
  if (kind === 'vsrepx' && report.kind !== 'vsrepx') {
    throw new ToolRefusal(`${shown(target)} is a .vsrepx, the layout file of a report class in a Visual Studio project; a .repx is written as a .repx. Name a .repx output.`);
  }
  return kind;
}

/** True when two real paths name one file (case aside on Windows). */
export const sameFile = (a: string, b: string, sys: PathSystem) => sys.path.relative(a, b) === '';

/** What a write did, as a result says it (a type, not an interface, so a result's loose schema takes it). */
export type Written = {
  path: string;
  status: WriteStatus;
  bytes: number;
};

/** Writes `data` to `target` through `writeOutput`, replacing a file only when `overwrite` is true. */
export function writeReport(target: string, data: string | Uint8Array, wfs: WriteFs, sys: PathSystem, overwrite = false): Written {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const done = writeOutput(target, bytes, wfs, sys.path, { overwrite });
  return { path: done.path, status: done.status, bytes: bytes.length };
}

/**
 * The Designer file of the report class a `.vsrepx` belongs to, beside it
 * (`Report1.Designer.cs` or `.vb` for `Report1.vsrepx`), and its text, which
 * the worker reads for the names it looks up (`designerLookups`); null when
 * there is none, or none the path rules let a tool read.
 */
export function designerFor(layout: string, roots: readonly Root[], sys: PathSystem, read: (p: string) => string = readText): { file: string; text: string } | null {
  const { path } = sys;
  const base = path.join(path.dirname(layout), path.basename(layout, path.extname(layout)));
  for (const ext of ['.cs', '.vb']) {
    const candidate = `${base}.Designer${ext}`;
    const found = resolveReadPath(candidate, roots, sys, { extensions: [ext], maxBytes: MAX_FILE_BYTES });
    if (found.ok) return { file: candidate, text: read(found.path) };
  }
  return null;
}

/**
 * Lines of text read from a file, each folded to one line and, when longer
 * than a string read from a file may be (`MAX_FILE_TEXT`), continued on the
 * next line after "... " rather than cut. Empty lines are dropped.
 */
export function fileLines(texts: readonly string[], max = MAX_FILE_TEXT): string[] {
  const out: string[] = [];
  for (const text of texts) {
    let rest = text.replace(/\s+/g, ' ').trim();
    if (!rest) continue;
    let lead = '';
    while (lead.length + rest.length > max) {
      const room = max - lead.length;
      let cut = rest.lastIndexOf(' ', room);
      if (cut < room / 2) cut = room;
      out.push(lead + rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
      lead = '... ';
    }
    out.push(lead + rest);
  }
  return out;
}
