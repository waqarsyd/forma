/**
 * Forma Designer's command-line verbs, started from Forma's Node side
 * (2026-11-25, the CLI and Forma Designer work's wave 6; findings D2-1,
 * D2-5, D2-6, D2-10, D2-11 and SEC-5 of its design audit,
 * `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`, and the
 * owner's OC1 and OC6). Forma Designer (tools/RepxDesigner, its README's
 * *Verbs for Forma's command line*) keeps a person's SQL Server connections
 * on their PC, a SQL login's secret encrypted for their Windows account, and
 * since that wave answers three verbs with one line of JSON and an exit
 * code: `sql-list` (the connections kept, by name, with each one's database
 * and how it signs in), `sql-schema` (Forma's layout script's one cell for a
 * connection, which lib/layoutFile.ts reads as it reads that script's answer
 * saved as a file) and `sql-sample` (the sample script's answer for the
 * tables named). This module starts them, and nothing else: the program as
 * a child with its standard output piped, so no network, no port and no
 * Origin are involved, and the caller is this Windows user by construction
 * (the owner chose this route over admitting a caller other than a page to
 * the `--serve` listener: OC1). The command line's `connections` and
 * `--connection` use it (commandLine.ts, *A database*), and since that
 * work's wave 7 the MCP server's `database_connections` and `connection`
 * argument, for the names the person lists in its entry alone
 * (databaseTools.ts).
 *
 * - **Where it is, worked out in the entry** (`designerPlace`, D2-11): the
 *   per-user install, `<LOCALAPPDATA>\Programs\Forma Designer\RepxDesigner.exe`
 *   (Installer.cs), or FORMA_DESIGNER, the full path of a copy built from
 *   source. Only an entry reads the environment (boundaries.test.ts), so the
 *   entry hands both values here and passes down what this gives back, as
 *   the roots are passed down. A full path on a drive only: never PATH,
 *   never a bare name (one would run a RepxDesigner.exe planted in the
 *   folder a command runs in, SEC-5), never a share, whose path Windows
 *   would answer by sending this Windows sign-in to it. Off Windows, words:
 *   Forma Designer runs on Windows.
 * - **What is started** (SEC-5): only that file, and only when neither it
 *   nor its folder is a link (a junction among them); with no shell, its
 *   own folder as the working folder, standard input closed, standard
 *   output and error piped (boundaries.test.ts's rule for src/mcp: nothing
 *   inherits the protocol's stdout), no window, and an environment the
 *   entry built from Windows' own variables alone (`DESIGNER_ENV`,
 *   `designerEnvFrom`, called after the keys were deleted), so no key of
 *   any program reaches it, whatever the person's environment holds.
 * - **Old builds never started with a verb** (D2-1, D2-8): before a start,
 *   the install's file version is read from the file itself, its
 *   VS_FIXEDFILEINFO (`peFileVersion`), never by starting it and never
 *   from `--installed` or the registry, which describe what was installed
 *   rather than the file about to run; nothing older than
 *   lib/designerRelease.ts's DESIGNER_VERBS_SINCE (1.2.0) is started.
 *   FORMA_DESIGNER's copy built from source is not held to it, since its
 *   file says 1.1.0.0 until the owner raises and packs it, but it is held to
 *   `DESIGNER_CHECK_SINCE` (1.0.0): a build older than 2026-11-09 has no
 *   `--check`, so the sentinel would not keep its window shut, and its file
 *   says 0.0.0.0 (the wave's review, R6-6). Every call ends
 *   with the sentinel `--check --no-load`, which Forma Designer 1.1.0 and
 *   1.0.0 answer by printing `--check`'s JSON and exiting, with no window
 *   and no DevExpress loaded, where a verb alone would be opened as a
 *   report path, a message box nobody closes; so the answer is trusted by
 *   its envelope first (`"formaDesignerVerb":1`, the verb asked) and by
 *   its exit code second, since `--check` exits 0 too.
 * - **Bounded** (D2-5, D2-6): asynchronously, never spawnSync (whose 1 MiB
 *   buffer killed a large layout mid-answer, measured by the audit), its
 *   output collected up to `DESIGNER_MAX_OUTPUT`, past which it is killed
 *   and said so; a deadline (its own `--seconds`, which Forma Designer keeps
 *   by itself, then ten seconds more here) and the caller's stop each kill
 *   it. The call ends when the program has exited and its pipes are read,
 *   or `DRAIN_MS` after it exited or was killed, whichever is first, so a
 *   process it started that holds its pipes open cannot keep the call past
 *   its deadline or a stop (the wave's review, N6-2: the call waited on the
 *   pipes' close, which every holder of them must make). It runs on the
 *   thread that called, before any job starts, never
 *   inside a worker thread: ending a worker leaves the children it started
 *   running (measured by the audit, D2-6), so the layout is read here and
 *   handed to the job as the bytes a layout file's would be.
 * - **Names checked before they are passed** (SEC-2): a connection's name
 *   by Forma Designer's own rule (lib/databaseAi.ts `DESIGNER_NAME`, which
 *   begins with a letter, a digit or `_`, so no name reads as a switch to
 *   an older build either), and then found among the names `sql-list`
 *   gives; each table or view as `schema.name`, neither part beginning with
 *   `-` nor holding `.` or `,`, at most 20, which Forma Designer checks
 *   against its catalog again before quoting each.
 * - **Its words** reach a person (and, since wave 7, a host's model): Forma
 *   Designer's own, which never carry the saved sign-in or the server (its
 *   `SqlCompanion.Explain`, D2-7), with every control character taken out
 *   here, and, where they are SQL Server's own first line (`sql`,
 *   `failed`), whatever they quote put as '...' here as Forma Designer puts
 *   it (`unquoted`), since a row's value can be quoted there (245's
 *   "converting the varchar value '...'"; the wave's review, N6-3); nothing
 *   else it prints is repeated. Those first lines can still name a table, a
 *   view or a database outside quotes, so in the server's voice they are the
 *   refusal's `fromFile.designer` (caller.ts `ToolRefusal`, since wave 7,
 *   D1-10), never its words. A table it could not sample (a view over a
 *   table since dropped, a value that fails a computed column) is left out
 *   and named with SQL Server's number alone (`unread`, R6-2). The
 *   connection's name it gives back in its own case (`connection`) is what
 *   a report bound through it names (D2-10).
 * - **Another connections file is never named from here**: the verbs take
 *   `--store`, which a test or a measurement passes through its own
 *   `DesignerStart`, and nothing in this module can (the wave's review,
 *   N6-5): Forma Designer reads whatever file it is given, so a store
 *   chosen by a caller could point Windows authentication at a server of
 *   that caller's choosing.
 *
 * Pure ASCII.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { lstat, open } from 'node:fs/promises';
import { dirname, win32 } from 'node:path';
import { DESIGNER_VERBS_SINCE, designerIsOlder } from '../lib/designerRelease';
import { CallStopped, ToolRefusal, UNSAFE_IN_LINE, quoted, type Voice } from './caller';

/** The verbs, each the first argument of a call (Verbs.cs `Names`). */
export const DESIGNER_VERBS = ['sql-list', 'sql-schema', 'sql-sample'] as const;
export type DesignerVerb = (typeof DESIGNER_VERBS)[number];

/** What every call ends with, in this order (Verbs.cs `Sentinel`): an older Forma Designer answers it with `--check`. */
export const DESIGNER_SENTINEL = ['--check', '--no-load'] as const;

/** Forma Designer's exit codes for a verb (Verbs.cs; 3 is `--check`'s). */
export const DESIGNER_EXIT = { done: 0, usage: 2, notKept: 4, sqlFailed: 5, deadline: 6 } as const;

/** The seconds a verb is given when the caller says none, as Forma Designer's own default (Verbs.cs `DefaultSeconds`), and the most it takes. */
export const DESIGNER_DEFAULT_SECONDS = 120;
export const DESIGNER_MAX_SECONDS = 3600;
/** The rows of each table `sql-sample` reads at most, and the tables (Verbs.cs `MaxRows`, `MaxObjects`). */
export const DESIGNER_MAX_ROWS = 50;
export const DESIGNER_MAX_OBJECTS = 20;

/** The most a verb's answer may print before it is killed: a layout of a large database, with every procedure's header, is a few MB. */
export const DESIGNER_MAX_OUTPUT = 64 * 1024 * 1024;
/** Kept of what it writes on stderr, for the log only. */
const MAX_STDERR = 64 * 1024;
/** After a verb's own deadline, before it is killed here: its watchdog prints the deadline's line five seconds after it. */
const GRACE_MS = 10_000;
/**
 * After the program exits or is killed, how long its pipes are still read
 * before the call ends without their close (the header's *Bounded*): what
 * it wrote is in the pipe by then, and a process it started may hold them.
 */
export const DRAIN_MS = 1_500;
/**
 * The oldest Forma Designer FORMA_DESIGNER's copy may be: 1.0.0, the first
 * whose file has a version (AssemblyInfo.cs, d524340, 2026-11-09), every one
 * of which has `--check` (Entry.cs, c13877a, the same day and before it), so
 * the sentinel answers it with no window (the wave's review, R6-6).
 */
export const DESIGNER_CHECK_SINCE = '1.0.0';
/** `sql-list` reads one file and opens no connection. */
const LIST_MS = 30_000;
/** What is read of a program for its version: its headers and section table, which lie in its first pages. */
const HEAD_BYTES = 64 * 1024;
/** The largest resource section read: RepxDesigner.exe, about 125 KB, has a few KB of resources; Node's own program a few hundred. */
const MAX_RESOURCE_BYTES = 16 * 1024 * 1024;

/** The per-user install under LOCALAPPDATA (Installer.cs `ProgramDir`, and the program's own name). */
export const DESIGNER_INSTALL = ['Programs', 'Forma Designer', 'RepxDesigner.exe'] as const;
const DESIGNER_EXE = 'RepxDesigner.exe';

/**
 * The environment Forma Designer is started with: Windows' own variables and
 * no other, so no key reaches it whatever the person's environment holds
 * (SEC-3, SEC-5). A .NET Framework program needs the system folders (Windows
 * Sockets fails without SystemRoot), the temporary folder and the profile's
 * folders; nothing it reads is a secret.
 */
export const DESIGNER_ENV = [
  'SystemRoot',
  'SystemDrive',
  'windir',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERNAME',
  'USERDOMAIN',
  'COMPUTERNAME',
  'PATH',
  'PATHEXT',
  'ComSpec',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'CommonProgramFiles',
  'CommonProgramFiles(x86)',
  'CommonProgramW6432',
  'ALLUSERSPROFILE',
  'PUBLIC',
  'OS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_ARCHITEW6432',
  'NUMBER_OF_PROCESSORS',
] as const;

/**
 * The environment Forma Designer is started with, from the entry's own,
 * read by DESIGNER_ENV's names and no other (boundaries.test.ts hands it a
 * proxy that fails on any other read, as it does `takeAiEnv`). An entry
 * calls it after the keys were deleted, so even a key under one of these
 * names could not be one Forma took.
 */
export function designerEnvFrom(source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of DESIGNER_ENV) {
    const value = source[name];
    if (typeof value === 'string' && value !== '') env[name] = value;
  }
  return env;
}

/** Where Forma Designer is, as an entry worked it out: the program's full path and where it came from, or why it cannot be found. */
export type DesignerPlace = { ok: true; exe: string; from: 'install' | 'override' } | { ok: false; reason: string };

/** A full path on a drive of this computer: never a share, a device path or a relative one. */
const ON_A_DRIVE = /^[A-Za-z]:[\\/]/;

/**
 * Where Forma Designer is (the header), from what the entry read: its
 * platform, LOCALAPPDATA and FORMA_DESIGNER. Pure; nothing is looked at on
 * disk until a verb is started, so an install made after the entry ran is
 * found.
 */
export function designerPlace(given: { platform: string; localAppData?: string; override?: string }): DesignerPlace {
  if (given.platform !== 'win32') return { ok: false, reason: 'Forma Designer runs on Windows, and this computer is not running Windows.' };
  const override = given.override?.trim();
  if (override) {
    const exe = win32.normalize(override);
    if (!ON_A_DRIVE.test(override) || !win32.isAbsolute(exe)) return { ok: false, reason: "FORMA_DESIGNER is not a full path on a drive of this computer, beginning with the drive's letter, such as C:\\, so it was not used." };
    if (win32.basename(exe).toLowerCase() !== DESIGNER_EXE.toLowerCase()) return { ok: false, reason: `FORMA_DESIGNER names a program other than ${DESIGNER_EXE}, so it was not used.` };
    return { ok: true, exe, from: 'override' };
  }
  const local = given.localAppData?.trim();
  if (!local || !ON_A_DRIVE.test(local)) {
    return { ok: false, reason: "LOCALAPPDATA is not a folder on a drive of this computer, so Forma Designer's install for this Windows user cannot be found; FORMA_DESIGNER can name RepxDesigner.exe by its full path." };
  }
  return { ok: true, exe: win32.join(local, ...DESIGNER_INSTALL), from: 'install' };
}

/** How a child is started: Node's spawn, or a test's stand-in. Always with these options. */
export type DesignerStart = (file: string, args: readonly string[], options: SpawnOptions & { stdio: ['ignore', 'pipe', 'pipe'] }) => ChildProcess;

/** What the command line and the server hand this module: where Forma Designer is and the environment it gets, both from the entry. */
export interface DesignerSetup {
  place: DesignerPlace;
  /** Built by the entry with `designerEnvFrom`, after the keys were deleted. */
  env: Record<string, string>;
  /**
   * How the child is started; Node's spawn by default. A test or a
   * measurement that must keep out of the profile's connections adds
   * `--store <file>` here, before the sentinel: nothing else can name
   * another connections file (the header).
   */
  start?: DesignerStart;
  /** Reads a program's file version, a.b.c, or null when it cannot be read; `fileVersionOf` by default. */
  versionOf?: (exe: string) => Promise<string | null>;
}

/** What one start is given by its caller. */
export interface DesignerCall {
  voice: Voice;
  /** Kills the child when aborted: Ctrl+C, or a host's cancellation. */
  signal?: AbortSignal;
  /** The verb's own `--seconds`; DESIGNER_DEFAULT_SECONDS by default. */
  seconds?: number;
  /** When the child is killed here; the verb's seconds and ten more by default (a test's own, shorter). */
  deadlineMs?: number;
  /** The most its answer may print; DESIGNER_MAX_OUTPUT by default (a test's own, smaller). */
  maxOutput?: number;
  /** A line for the caller's log (what Forma Designer wrote on stderr); scrubbed by the caller. */
  log?: (line: string) => void;
}

/** A refusal in Forma Designer's words, with its `problem` (Verbs.cs: usage, not-kept, sign-in, database, unreachable, sql, failed, deadline) when it gave one. */
export class DesignerRefusal extends ToolRefusal {
  readonly problem: string | null;
  readonly number: number | null;
  constructor(message: string, problem: string | null = null, number: number | null = null, fromFile?: Record<string, unknown>) {
    super(message, fromFile);
    this.problem = problem;
    this.number = number;
  }
}

/**
 * What a refusal leaves the person to do next, which each caller says in its
 * own words after it (commandLine.ts and databaseTools.ts, `withWayOn`):
 *
 * - `file`, the layout given as a file instead, for one made before Forma
 *   Designer answered anything (not installed, older than 1.2.0, a link, a
 *   program that would not start or did not answer as it does: no
 *   `problem`), and for a sign-in whose own words already send the person
 *   to its SQL Server connections (a secret this Windows account cannot read);
 * - `again`, the same command or call once more or the file, for a deadline,
 *   Forma Designer's own or the kill here;
 * - `check`, the connection in Forma Designer's tray menu or the file, for
 *   SQL Server refusing the saved sign-in, not opening the database, not
 *   reached, or failing (`sql`, `failed`);
 * - null for an answer that says its own next step (no connection kept under
 *   that name) and for Forma's own mistake (`usage`).
 *
 * Until the CLI work's wave-8 review (W8R-5) only the first was said, so
 * `connections` past its deadline, a sign-in SQL Server refused, and SQL
 * Server's own words each ended a command, or a call, with nothing to do.
 */
export function designerNext(error: DesignerRefusal): 'file' | 'again' | 'check' | null {
  if (error.problem === null) return 'file';
  if (error.problem === 'deadline') return 'again';
  if (error.problem === 'not-kept' || error.problem === 'usage') return null;
  return /SQL Server connections/.test(error.message) ? 'file' : 'check';
}

/* ------------------------------------------------------------ the program's own version */

/**
 * A Windows program's file version, `a.b.c`, read from its VS_FIXEDFILEINFO
 * without starting it (D2-1): the PE headers to the resource section, its
 * RT_VERSION entry, VS_VERSION_INFO, and the fixed block's signature
 * 0xFEEF04BD, then dwFileVersionMS and dwFileVersionLS. Null for anything
 * that is not such a program, or reads outside itself.
 */
export function peFileVersion(bytes: Uint8Array): string | null {
  return versionIn(spanOf([[0, bytes]]));
}

/** Reads `n` bytes at a file offset from what was read of the file, or throws a RangeError: never past what is there. */
type Read = (at: number, n: number) => DataView;

/** A `Read` over the parts read of a file, each at its offset. */
function spanOf(parts: readonly (readonly [number, Uint8Array])[]): Read {
  return (at, n) => {
    for (const [start, b] of parts) {
      if (Number.isInteger(at) && at >= start && at + n <= start + b.byteLength) return new DataView(b.buffer, b.byteOffset + at - start, n);
    }
    throw new RangeError('outside what was read');
  };
}

/** What the headers say of the resources: the directory's offset in the file, how an address maps to one, and the section holding it, as stored. */
interface Resources {
  root: number;
  offsetOf(rva: number): number;
  section: { start: number; size: number };
}

/** The PE headers read to the resource directory (the header's steps), or null for what is not such a program. Throws a RangeError. */
function resourcesOf(read: Read): Resources | null {
  const u16 = (at: number) => read(at, 2).getUint16(0, true);
  const u32 = (at: number) => read(at, 4).getUint32(0, true);
  if (u16(0) !== 0x5a4d) return null; // MZ
  const pe = u32(0x3c);
  if (u32(pe) !== 0x00004550) return null; // PE\0\0
  const sections = u16(pe + 6);
  const optional = pe + 24;
  const table = optional + u16(pe + 20);
  const magic = u16(optional);
  if (magic !== 0x10b && magic !== 0x20b) return null; // PE32, PE32+
  const directories = optional + (magic === 0x10b ? 96 : 112);
  if (u32(optional + (magic === 0x10b ? 92 : 108)) < 3) return null;
  const resources = u32(directories + 2 * 8);
  if (!resources) return null;
  const sectionOf = (rva: number) => {
    for (let i = 0; i < sections; i++) {
      const s = table + i * 40;
      const va = u32(s + 12);
      if (rva >= va && rva < va + Math.max(u32(s + 8), u32(s + 16))) return { va, start: u32(s + 20), size: u32(s + 16) };
    }
    throw new RangeError('in no section');
  };
  const holding = sectionOf(resources);
  const offsetOf = (rva: number) => {
    const s = sectionOf(rva);
    return rva - s.va + s.start;
  };
  return { root: offsetOf(resources), offsetOf, section: { start: holding.start, size: holding.size } };
}

/** The version from what was read (`peFileVersion`'s steps), or null. */
function versionIn(read: Read): string | null {
  try {
    const found = resourcesOf(read);
    return found ? fixedVersion(read, found) : null;
  } catch {
    return null;
  }
}

function fixedVersion(read: Read, { root, offsetOf }: Resources): string | null {
  const u16 = (at: number) => read(at, 2).getUint16(0, true);
  const u32 = (at: number) => read(at, 4).getUint32(0, true);
  /** The entry of a resource directory with this id (any, when none is given): its offset field, or -1. */
  const entry = (dir: number, id?: number): number => {
    const count = u16(dir + 12) + u16(dir + 14);
    for (let i = 0; i < count && i < 4096; i++) {
      const at = dir + 16 + i * 8;
      const name = u32(at);
      if (id === undefined || ((name & 0x80000000) === 0 && name === id)) return u32(at + 4);
    }
    return -1;
  };
  const isDir = (field: number) => field >= 0 && (field & 0x80000000) !== 0;
  const type = entry(root, 16); // RT_VERSION
  if (!isDir(type)) return null;
  const name = entry(root + (type & 0x7fffffff));
  if (!isDir(name)) return null;
  const language = entry(root + (name & 0x7fffffff));
  if (language < 0 || isDir(language)) return null;
  const start = offsetOf(u32(root + language));
  // VS_VERSIONINFO: its length, its value's length and its type, the key in UTF-16 with its end, padded to 32 bits, then the block.
  const key = 'VS_VERSION_INFO';
  for (let i = 0; i < key.length; i++) if (u16(start + 6 + i * 2) !== key.charCodeAt(i)) return null;
  const fixed = start + ((6 + (key.length + 1) * 2 + 3) & ~3);
  if (u32(fixed) !== 0xfeef04bd) return null;
  const ms = u32(fixed + 8);
  const ls = u32(fixed + 12);
  return `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}`;
}

/**
 * A program's file version read from the file (`peFileVersion`), or null
 * when it cannot be read: its headers, then the one section holding its
 * resources, never the whole file (Node's own program is 94 MB).
 */
export async function fileVersionOf(exe: string): Promise<string | null> {
  try {
    const file = await open(exe, 'r');
    try {
      const { size } = await file.stat();
      const at = async (start: number, n: number) => {
        const bytes = new Uint8Array(Math.max(0, Math.min(n, size - start)));
        const { bytesRead } = await file.read(bytes, 0, bytes.byteLength, start);
        return bytes.subarray(0, bytesRead);
      };
      const head = await at(0, HEAD_BYTES);
      const found = resourcesOf(spanOf([[0, head]]));
      if (!found || found.section.size > MAX_RESOURCE_BYTES) return null;
      return versionIn(spanOf([[0, head], [found.section.start, await at(found.section.start, found.section.size)]]));
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ starting a verb */

/** Forma Designer's words, as they are repeated: one line, no control character, short. */
const said = (text: unknown): string => {
  const line = String(text ?? '').replace(UNSAFE_IN_LINE, ' ').replace(/\s+/g, ' ').trim();
  return line.length > 500 ? `${line.slice(0, 500)}...` : line;
};

/**
 * SQL Server's words with whatever they quote put as '...', from the first
 * quote to the last, so a value holding a quote of its own goes whole, and
 * to the end when no quote closes it, as in words cut short (the header's
 * *Its words*; Verbs.cs `Unquoted` does the same before printing). Before
 * the words are cut to a line's length, so a cut never leaves a quote open.
 */
export function unquoted(words: string): string {
  const first = words.indexOf("'");
  if (first < 0) return words;
  const last = words.lastIndexOf("'");
  return `${words.slice(0, first)}'...'${last > first ? words.slice(last + 1) : ''}`;
}

/** The program, judged before it is started (the header): there, a file, neither it nor its folder a link, and new enough. */
async function startable(setup: DesignerSetup, voice: Voice): Promise<string> {
  const place = setup.place;
  if (!place.ok) throw new DesignerRefusal(place.reason);
  const { exe, from } = place;
  const q = quoted(exe, voice);
  const folder = dirname(exe);
  let file;
  let dir;
  try {
    file = await lstat(exe);
    dir = await lstat(folder);
  } catch {
    throw new DesignerRefusal(
      from === 'install'
        ? `Forma Designer is not installed for this Windows user: there is no ${q}. Reading a database through it needs Forma Designer ${DESIGNER_VERBS_SINCE} or later.`
        : `FORMA_DESIGNER names ${q}, which is not there.`,
    );
  }
  if (file.isSymbolicLink() || dir.isSymbolicLink()) throw new DesignerRefusal(`${q} is a link, or in a folder that is one, so it was not started: Forma starts Forma Designer only where it really is.`);
  if (!file.isFile()) throw new DesignerRefusal(`${q} is not a program, so it was not started.`);
  const version = await (setup.versionOf ?? fileVersionOf)(exe);
  if (from === 'install') {
    if (!version) throw new DesignerRefusal(`The version of ${q} cannot be read from the file, so it was not started: reading a database through Forma Designer needs ${DESIGNER_VERBS_SINCE} or later.`);
    if (designerIsOlder(version, DESIGNER_VERBS_SINCE)) {
      throw new DesignerRefusal(`Forma Designer ${version} is installed, and reading a database through it needs Forma Designer ${DESIGNER_VERBS_SINCE} or later, so it was not started.`);
    }
  } else if (!version || designerIsOlder(version, DESIGNER_CHECK_SINCE)) {
    // A copy built from source may say 1.1.0 and have the verbs; one older than 1.0.0 has no --check either (R6-6).
    throw new DesignerRefusal(
      `FORMA_DESIGNER names ${q}, ${version ? `a Forma Designer ${version}` : 'whose version cannot be read from the file'}, so it was not started: a Forma Designer older than ${DESIGNER_CHECK_SINCE} has no --check, which keeps one without the verbs from opening a window. Name a RepxDesigner.exe built from this clone's source.`,
    );
  }
  return exe;
}

/** What one start gave back: how it ended and what it printed. */
interface Ended {
  code: number | null;
  out: Buffer;
  why: 'deadline' | 'cap' | 'stopped' | null;
  error: NodeJS.ErrnoException | null;
}

/** Starts the program with `args` (the header's options), collects its answer within the bounds, and kills it at the deadline, the cap or a stop. */
function started(start: DesignerStart, exe: string, args: readonly string[], env: Record<string, string>, call: DesignerCall, deadlineMs: number): Promise<Ended> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = start(exe, args, { cwd: dirname(exe), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
    } catch (error) {
      resolve({ code: null, out: Buffer.alloc(0), why: null, error: error as NodeJS.ErrnoException });
      return;
    }
    const out: Buffer[] = [];
    let bytes = 0;
    let errText = '';
    let why: Ended['why'] = null;
    let error: NodeJS.ErrnoException | null = null;
    let code: number | null = null;
    let ended = false;
    let drain: NodeJS.Timeout | undefined;
    const finish = () => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      clearTimeout(drain);
      call.signal?.removeEventListener('abort', onAbort);
      // Pipes another process may still hold (one the program started inherits them) are let go here, not waited for.
      child.stdout?.destroy();
      child.stderr?.destroy();
      const first = said(errText.split(/\r?\n/).find((l) => l.trim()) ?? '');
      if (first) call.log?.(`Forma Designer wrote on stderr: ${first}`);
      resolve({ code, out: Buffer.concat(out), why, error });
    };
    // Once the program has exited or been killed: what is left in its pipes for DRAIN_MS, then the call ends (N6-2).
    const draining = () => {
      if (!ended && drain === undefined) drain = setTimeout(finish, DRAIN_MS);
    };
    const kill = (reason: NonNullable<Ended['why']>) => {
      if (why) return;
      why = reason;
      child.kill('SIGKILL');
      draining();
    };
    const timer = setTimeout(() => kill('deadline'), deadlineMs);
    const onAbort = () => kill('stopped');
    call.signal?.addEventListener('abort', onAbort, { once: true });
    const most = call.maxOutput ?? DESIGNER_MAX_OUTPUT;
    child.stdout?.on('data', (chunk: Buffer) => {
      if (why) return;
      bytes += chunk.length;
      if (bytes > most) kill('cap');
      else out.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (errText.length < MAX_STDERR) errText += chunk.toString('utf8').slice(0, MAX_STDERR - errText.length);
    });
    child.on('error', (e) => {
      error = e as NodeJS.ErrnoException;
      draining();
    });
    child.on('exit', (exitCode) => {
      code = exitCode;
      draining();
    });
    // Every holder of its pipes has closed them: all it wrote is read.
    child.on('close', (exitCode) => {
      if (code === null) code = exitCode;
      finish();
    });
  });
}

/** A verb's answer: its envelope, read (`ok` and its own field), or why it is not one. */
interface Envelope {
  formaDesignerVerb: 1;
  verb: string;
  version?: string;
  ok: boolean;
  problem?: string;
  error?: string;
  number?: number;
  connection?: unknown;
  connections?: unknown;
  layout?: unknown;
  samples?: unknown;
  unread?: unknown;
}

/** The first line of the answer that is a JSON object, or null. */
function firstObject(text: string): Record<string, unknown> | null {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** What a verb was doing, in words, for a failure's sentence. */
const DOING: Record<DesignerVerb, (connection: string) => string> = {
  'sql-list': () => 'list the connections it keeps',
  'sql-schema': (c) => `read the layout of the connection ${c}`,
  'sql-sample': (c) => `read sample rows through the connection ${c}`,
};

/**
 * A refusal's words when SQL Server's own words are carried apart, by whose they are (since the CLI work's wave 7, D1-10):
 * the server's say where those words are; the command line's, null, prints them in its words, as a person reads them.
 */
const SQL_WORDS_APART: Record<Voice, ((doing: string, number: number | null) => string) | null> = {
  mcp: (doing, number) => `Forma Designer could not ${doing}${number === null ? '' : ` (SQL Server's error ${number})`}; what it answered is under fromFile.designer.`,
  cli: null,
};

/**
 * Starts one verb (the header) and returns its envelope, `ok` and with the
 * verb's own field; anything else is a `DesignerRefusal` in words, or a
 * `CallStopped` when the caller stopped it.
 */
async function runVerb(setup: DesignerSetup, verb: DesignerVerb, options: readonly string[], call: DesignerCall, connection = ''): Promise<Envelope> {
  const exe = await startable(setup, call.voice);
  if (call.signal?.aborted) throw new CallStopped();
  const seconds = call.seconds ?? DESIGNER_DEFAULT_SECONDS;
  const args = [verb, ...options, ...DESIGNER_SENTINEL];
  const deadlineMs = call.deadlineMs ?? (verb === 'sql-list' ? LIST_MS : seconds * 1000 + GRACE_MS);
  const ended = await started(setup.start ?? (spawn as DesignerStart), exe, args, setup.env, call, deadlineMs);
  const doing = DOING[verb](connection);
  if (ended.why === 'stopped') throw new CallStopped();
  if (ended.error) throw new DesignerRefusal(`Forma Designer could not be started to ${doing}${ended.error.code ? ` (${ended.error.code})` : ''}.`);
  if (ended.why === 'deadline') {
    const s = Math.max(1, Math.ceil(deadlineMs / 1000));
    throw new DesignerRefusal(`Forma Designer did not ${doing} within ${s} second${s === 1 ? '' : 's'}, so it was stopped and nothing was read.`, 'deadline');
  }
  if (ended.why === 'cap') throw new DesignerRefusal(`Forma Designer's answer to ${doing} passed ${(call.maxOutput ?? DESIGNER_MAX_OUTPUT) / 1024 / 1024} MB, so it was stopped and nothing was read.`);
  const answer = firstObject(ended.out.toString('utf8'));
  if (answer && answer.formaDesignerVerb !== 1 && answer.app === 'RepxDesigner') {
    // --check's JSON: a Forma Designer without the verbs took the sentinel (D2-1).
    throw new DesignerRefusal(`${quoted(exe, call.voice)} answered as a Forma Designer older than ${DESIGNER_VERBS_SINCE} does, without the verbs that read a database, so nothing was read.`);
  }
  if (!answer || answer.formaDesignerVerb !== 1 || answer.verb !== verb || typeof answer.ok !== 'boolean') {
    throw new DesignerRefusal(`Forma Designer's answer to ${doing} is not the one line it gives${ended.code === null ? '' : ` (it ended with exit code ${ended.code})`}, so nothing was read.`);
  }
  const envelope = answer as unknown as Envelope;
  if (!envelope.ok) {
    const number = typeof envelope.number === 'number' ? envelope.number : null;
    const problem = typeof envelope.problem === 'string' ? said(envelope.problem) : null;
    if (problem === 'usage') throw new DesignerRefusal(`Forma Designer refused the call Forma made to ${doing}, which is Forma's mistake: ${said(envelope.error)}`, problem, number);
    // SQL Server's own first line can quote a row's value (N6-3): what it quotes is never repeated, whatever Forma Designer did.
    const sqls = problem === 'sql' || problem === 'failed';
    const words = sqls ? said(unquoted(String(envelope.error ?? ''))) : said(envelope.error);
    // It can still name a table, view or database outside quotes: the server's voice carries those words apart, as data
    // under fromFile.designer, never in its own (the CLI work's wave 7, D1-10); a person reads them in the words.
    const apart = SQL_WORDS_APART[call.voice];
    if (sqls && words && apart) throw new DesignerRefusal(apart(doing, number), problem, number, { designer: words });
    throw new DesignerRefusal(`Forma Designer could not ${doing}: ${words || 'it gave no reason'}`, problem, number);
  }
  if (ended.code !== DESIGNER_EXIT.done) throw new DesignerRefusal(`Forma Designer said it could ${doing}, but ended with exit code ${ended.code}, so nothing it printed was read.`);
  return envelope;
}

/* ------------------------------------------------------------ the three verbs */

/**
 * A connection Forma Designer keeps: its name, how it signs in, and its
 * database (never a server, never a secret), and whether its name can be
 * passed to it (`usable`): a name kept by Forma Designer 1.1.0 or older may
 * begin with `.` or `-`, which its rule and `DESIGNER_NAME` refuse since
 * 2026-11-25 (SEC-2), so such a connection is listed but cannot be read
 * until it is added again under another name (the wave's review, N6-6).
 */
export interface DesignerConnection {
  name: string;
  signIn: 'windows' | 'login';
  database: string;
  usable: boolean;
}

/** How a connection kept under a name Forma cannot pass is made usable (`DesignerConnection.usable`). */
export const RENAME_TO_USE = "Add it again in Forma Designer's SQL Server connections under a name that begins with a letter, a digit or _, and remove the old one.";

/** The connections Forma Designer keeps for this Windows user (`sql-list`). */
export async function designerConnections(setup: DesignerSetup, call: DesignerCall): Promise<DesignerConnection[]> {
  const envelope = await runVerb(setup, 'sql-list', [], call);
  const list = envelope.connections;
  const fine = Array.isArray(list) && list.every((c) => c && typeof c === 'object' && typeof c.name === 'string' && typeof c.database === 'string' && (c.mode === 'windows' || c.mode === 'login'));
  if (!fine) throw new DesignerRefusal("Forma Designer's list of connections is not in the form it gives, so nothing was read.");
  const { DESIGNER_NAME } = await import('../lib/databaseAi');
  return (list as { name: string; mode: 'windows' | 'login'; database: string }[]).map((c) => ({ name: c.name, signIn: c.mode, database: c.database, usable: DESIGNER_NAME.test(c.name) }));
}

/** A table or view as the sample verb names it: `schema.name`. */
export interface DesignerObject {
  schema: string;
  name: string;
}

/** A table or view named for sample rows that SQL Server could not read, left out: its name as passed, and SQL Server's number (never its words, which can quote a value). */
export interface DesignerUnread {
  object: string;
  number: number | null;
}

/**
 * What `designerRead` read: the connection's name in Forma Designer's own case, its layout, its sample rows when asked
 * for, what of them could not be read, and the tables or views named that the database does not have (`notFound`, as
 * passed: Forma Designer looks each up in the catalog first and leaves one it does not find out with no word, so they
 * are the names neither among the rows nor unread; the wave-7 review's W7-MCP-4).
 */
export interface DesignerRead {
  connection: string;
  layout: string;
  samples: string | null;
  unread: DesignerUnread[];
  notFound: string[];
}

/** Why a table or view cannot be passed to the sample verb, or null (the header): neither part beginning with -, holding . or , or a control character. */
function objectProblem(o: DesignerObject): string | null {
  for (const part of [o.schema, o.name]) {
    if (!part || part.length > 128 || part.startsWith('-') || /[.,]/.test(part) || part.replace(UNSAFE_IN_LINE, '') !== part) {
      return `${said(`${o.schema}.${o.name}`)} cannot be read through Forma Designer, which names a table or view as schema.name: neither part may begin with - or hold . or ,`;
    }
  }
  return null;
}

/**
 * A connection's layout, and with `samples` the sample rows of those tables
 * or views, through Forma Designer (`sql-list`, `sql-schema`, `sql-sample`):
 * the name checked by Forma Designer's own rule and found among those it
 * keeps (SEC-2) before the layout is asked for under the name it keeps.
 * The sample rows only when the caller passes them, as the person's own act
 * (OC6), with the tables or views named that SQL Server could not read
 * (`unread`) and those the database does not have (`notFound`), each said by
 * the caller. Each verb is given `call.seconds`.
 */
export async function designerRead(setup: DesignerSetup, connection: string, call: DesignerCall, samples?: { objects: readonly DesignerObject[]; rows: number }): Promise<DesignerRead> {
  const { DESIGNER_NAME } = await import('../lib/databaseAi');
  if (!DESIGNER_NAME.test(connection)) {
    throw new DesignerRefusal('A Forma Designer connection is named with letters, digits, _, . and -, beginning with a letter, a digit or _, at most 128.', 'usage');
  }
  if (samples) {
    if (!samples.objects.length || samples.objects.length > DESIGNER_MAX_OBJECTS) throw new DesignerRefusal(`Forma Designer reads sample rows of 1 to ${DESIGNER_MAX_OBJECTS} tables or views at a time.`, 'usage');
    if (!Number.isInteger(samples.rows) || samples.rows < 1 || samples.rows > DESIGNER_MAX_ROWS) throw new DesignerRefusal(`Forma Designer reads 1 to ${DESIGNER_MAX_ROWS} rows of each table or view.`, 'usage');
    for (const o of samples.objects) {
      const problem = objectProblem(o);
      if (problem) throw new DesignerRefusal(`${problem}.`, 'usage');
    }
  }
  const seconds = call.seconds ?? DESIGNER_DEFAULT_SECONDS;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > DESIGNER_MAX_SECONDS) throw new DesignerRefusal(`Forma Designer is given 1 to ${DESIGNER_MAX_SECONDS} seconds.`, 'usage');
  const kept = (await designerConnections(setup, call)).find((c) => c.name.toLowerCase() === connection.toLowerCase());
  if (!kept) throw new DesignerRefusal(`Forma Designer keeps no connection named ${connection} for this Windows user. Add it from its tray menu, SQL Server connections.`, 'not-kept');
  const time = ['--seconds', String(seconds)];
  const schema = await runVerb(setup, 'sql-schema', ['--connection', kept.name, ...time], call, kept.name);
  if (typeof schema.layout !== 'string' || !schema.layout || typeof schema.connection !== 'string') throw new DesignerRefusal(`Forma Designer's layout of the connection ${kept.name} is empty, so nothing was read.`);
  let rows: string | null = null;
  const unread: DesignerUnread[] = [];
  const notFound: string[] = [];
  if (samples) {
    const named = samples.objects.map((o) => `${o.schema}.${o.name}`);
    const sample = await runVerb(setup, 'sql-sample', ['--connection', kept.name, '--objects', named.join(','), '--rows', String(samples.rows), ...time], call, kept.name);
    if (typeof sample.samples !== 'string' || !sample.samples) throw new DesignerRefusal(`Forma Designer's sample rows through the connection ${kept.name} are empty, so nothing was read.`);
    rows = sample.samples;
    const answered = new Set<string>();
    // The tables SQL Server could not read, each left out (R6-2): named as passed, never with SQL Server's words.
    for (const u of Array.isArray(sample.unread) ? sample.unread : []) {
      if (u && typeof u === 'object' && typeof u.object === 'string') {
        unread.push({ object: said(u.object), number: typeof u.number === 'number' && Number.isInteger(u.number) ? u.number : null });
        answered.add(u.object.toLowerCase());
      }
    }
    // The ones the catalog has, among the rows under the name passed (Sql.cs Samples); any other was not found (W7-MCP-4).
    // Rows that cannot be read are the layout reader's to refuse, so they name no table missing here.
    const { readSampleExport } = await import('../lib/sqlSchema');
    const read = readSampleExport(rows);
    if (read) {
      for (const key of Object.keys(read.samples)) answered.add(key.toLowerCase());
      for (const name of named) if (!answered.has(name.toLowerCase())) notFound.push(said(name));
    }
  }
  return { connection: schema.connection, layout: schema.layout, samples: rows, unread, notFound };
}
