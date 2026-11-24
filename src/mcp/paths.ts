/**
 * Which file an MCP tool may read or write, worked out from the path string a
 * host's model sent (2026-11-24, the MCP work's wave 3; findings GAP2-1 to
 * GAP2-4, SEC-4, SEC-5 and TST-4 of the 2026-11-23 design audit).
 *
 * A path argument must be fully qualified: `G:\Reports\a.repx` on Windows,
 * `/home/me/a.repx` elsewhere. Nothing is resolved against a root, the
 * server's working folder or the home folder, because an MCP server cannot
 * see the shell the model ran `cd` in: a relative name would open a file of
 * the same name somewhere else, and a write would land beside it with no
 * error. Every other form is refused with a message that hands back the
 * corrected path where one can be worked out (a Git Bash `/g/...` path, a
 * `file:` URL, `~`), and never acted on. That is a deliberate departure from
 * Claude Code's own Read tool, which accepts all of these, and from its docs,
 * which suggest resolving names against CLAUDE_PROJECT_DIR.
 *
 * The order is the security of it. The string is judged first, raw, with no
 * file-system call: a UNC path (`\\host\share`, `//host/share`, the mixed
 * `/\host`, and the Git Bash slip `//g/...`, all UNC to Windows) would make a
 * realpath call open an SMB connection, which sends the Windows sign-in to
 * answer. A path on a drive in Windows' long or device form (`\\?\C:\...`,
 * `\\.\C:\...`) is refused there too, with the plain path handed back.
 * Then a lexical check against the roots keeps a path spelled outside
 * them away from the file system. Each root is held twice (`Root`): as the
 * host or the user spelled it, and as it really is once links are followed,
 * so a root reached through a junction, a symlink, a subst or mapped drive or
 * an 8.3 name admits the paths spelled the user's way too (finding PS-2 of
 * the wave-3 review); that is safe here because no UNC spelling got this far.
 *
 * A path spelled inside a root can still reach another computer through a
 * link on its way: a directory symlink to `\\host\share`, which a cloned
 * repository or an extracted archive can carry, is followed by any lstat or
 * realpath of a path below it (finding PS-6). So on Windows every existing
 * component is lstat'd from the drive down, which never follows the
 * component itself; a link's target is read as written and refused when it
 * names another computer, never followed to find out, and a target on this
 * computer is walked the same way before anything goes through the link.
 * Only then is the nearest existing ancestor resolved with
 * `realpathSync.native` (so junctions and symlinks are followed, and a new
 * file under a junction that leads out is caught), and the result checked
 * against the roots' real paths, never their spellings. The roots themselves
 * were realpath'd when they were read (roots.ts). The extension is judged
 * again on the real path, so a link named `x.repx` that leads to any other
 * file is refused.
 *
 * A hard link is a file in its folder by the file system's own meaning, and
 * is read as one: making one takes access to the file it names already,
 * these tools make none that outlives a call (`writeOutput`'s temporary name
 * is removed before it returns), and refusing every file with a second name
 * would refuse what hard-link backups hold and what an interrupted write of
 * this server leaves behind. So a hard link to a file outside a root, put
 * inside one by someone who could read that file, is read; that is out of
 * these checks' scope.
 *
 * Every function takes the platform's path module (`path.win32` or
 * `path.posix`) and the file-system calls it may make, so the Windows rules
 * are tested on CI's Linux runners too, and the refusals are tested with a
 * file system that fails the test if it is touched.
 *
 * Writes go only into a root, never into a dot-folder (`.git`, `.claude`,
 * `.vscode`...) or `node_modules`, and never replace an existing file unless
 * the caller asked. `writeOutput` makes that true at the moment of writing,
 * not only when it was checked: the bytes go to a temporary file, which is
 * then hard-linked to its name (a link fails when the name exists, where a
 * rename would silently replace it, on Windows too). What it does when the
 * name is taken is the caller's (`IfExists`, since the CLI and Forma
 * Designer work's wave 2, CLI-6): the MCP server writes beside it, as
 * `name (2).ext`, since no person can be asked; the command line refuses,
 * so a rerun in CI never piles up copies, or replaces when the person said
 * so.
 *
 * ## The command line's mode
 *
 * Since that wave (2026-11-24, findings CLI-3 and SEC-4 of its design audit,
 * `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`) the same
 * functions judge the command line's paths, so its rules stay one copy: the
 * caller hands in a `WorkingFolder` where the server hands in its roots
 * (`PathScope`). A person, or a CI step, sees the folder the command runs
 * in, and so does the program, so a relative path is resolved against it,
 * once, before anything else; every other form above is refused as it is
 * for a model (a UNC path on the raw string, a Git Bash or `~` path with the
 * corrected one handed back, a device, a stream), and every step after the
 * string runs unchanged: the links on the way walked on Windows, the real
 * path, the extension judged on it, the credential names, the size. The
 * working folder itself passes the same tests first: one named by a UNC
 * path, or reached through a link to another computer, refuses every path.
 * A mapped network drive is not told apart: its letter is the person's own
 * mapping, so a working folder or a path on `Z:\` is used as any drive is,
 * and Forma reads and writes over the share the person mapped (the CLI
 * work's wave-2 review, SEC-W2-5; refusing one would take asking Windows for
 * the drive's type, which is the owner's call).
 *
 * There are no roots, and the named files' folders are not made into a list
 * of them. Each path has one folder it must really be in, decided by where
 * it really is, never by how it was spelled (the wave-2 review's SEC-W2-2:
 * until then a path spelled through another name for the working folder, a
 * junction or symlink to it, a subst drive, an 8.3 name, or the shell's
 * logical `$PWD` against Node's physical working folder, was judged as named
 * outside it, and a link the checkout carried out of it was followed). The
 * working folder is what a checkout lands in, so no link that really is in
 * it (its own folder's real path, and its name) may lead out of it, a
 * directory link a repository carries (SEC-1's way to send a CI runner's
 * files to the AI) or a file link alike; and a path whose folder really is
 * in it must land in it. A path whose folder is elsewhere must land in that
 * folder, since a person may name any file on their own computer, but a file
 * link planted beside it (`rows.json` leading to `~/.docker/config.json`) is
 * refused too. A directory link on the way to a folder elsewhere is followed,
 * as the person's own: so is one in a folder above the working folder that a
 * command run in a subfolder reaches by `..`, by design, since that folder is
 * not the one the command runs in. A union of the named folders could catch
 * none of these (the link is in the folder's own path, and one named
 * folder's link could reach another's), and would have to be built before
 * any path was judged; `--out` needs no place in it, since an output is
 * judged by the same rule as any path. Dot-folders and `node_modules` are
 * looked for below the working folder, for a path that lands in it, and
 * below the drive otherwise, so only the folder the command runs in may
 * itself be one: the person chose it. The refusals speak to a person
 * (`Voice`): "give" where a model is told "send", and "Forma" where it is
 * told "this server"; and a path is quoted in plain double quotes, never as
 * JSON, so a Windows path reads with single backslashes and can be copied
 * back to a shell (caller.ts `quoted`; the wave-4 review's U8), any control
 * character in it shown as `?`.
 *
 * Pure ASCII, as everything an MCP server may print.
 */
import { constants, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32, type PlatformPath } from 'node:path';
import { fileURLToPath as nodeFileURLToPath } from 'node:url';
import { quoted, type Voice } from './caller';

/** A refusal's words, sent to the host's model as they are. */
export type PathVerdict = { ok: true; path: string } | { ok: false; reason: string };

/** The file-system calls the checks may make. Node's are in `nodePathFs`. */
export interface PathFs {
  /** True when something is at `p`, a dangling link included (lstat, not stat). */
  lexists(p: string): boolean;
  /** The target a link or junction at `p` names, as written, without following `p` itself (lstat, then readlink); null when `p` is no link or is not there. */
  readlink(p: string): string | null;
  /** `fs.realpathSync.native`: links and junctions followed, the case the disk keeps. Throws when it cannot. */
  realpath(p: string): string;
  /** `fs.statSync`, following links. */
  stat(p: string): { isFile(): boolean; isDirectory(): boolean; size: number };
}

/** Node's own calls, for the server; tests hand in their own. */
export const nodePathFs: PathFs = {
  lexists: (p) => {
    try {
      lstatSync(p);
      return true;
    } catch {
      return false;
    }
  },
  // Node's lstat calls a junction a symbolic link too, and readlink gives a UNC target as \\host\share\ (measured 2026-11-24).
  readlink: (p) => {
    try {
      return lstatSync(p).isSymbolicLink() ? readlinkSync(p) : null;
    } catch {
      return null;
    }
  },
  realpath: (p) => realpathSync.native(p),
  stat: (p) => statSync(p),
};

/**
 * A folder the tools may use, held twice (finding PS-2 of the wave-3
 * review): `path` as the host or the user spelled it, resolved but with no
 * link followed, which is what their paths start with; `real` once every link
 * and junction is followed, which is what a file's real path is checked
 * against.
 */
export interface Root {
  path: string;
  real: string;
}

/** The platform a path is judged for. */
export interface PathSystem {
  path: PlatformPath;
  fs: PathFs;
  /** The home folder, only to hand back a corrected path for `~`. */
  home?: string;
}

/** The real platform's path rules, file system and home folder (in formaServer.ts until the CLI and Forma Designer work's wave 2). */
export function nodeSystem(platform: string = process.platform): PathSystem {
  return { path: platform === 'win32' ? win32 : posix, fs: nodePathFs, home: homedir() };
}

/** The command line's working folder, in place of roots (the header's *The command line's mode*). */
export interface WorkingFolder {
  /** The folder the command runs in, a full path: the entry reads it, nothing here does. */
  base: string;
}

/** Where a caller's paths may lead: the MCP server's roots, or the command line's working folder. */
export type PathScope = readonly Root[] | WorkingFolder;

const inFolder = (scope: PathScope): scope is WorkingFolder => 'base' in scope;

/** Whose words a scope's refusals are in: the server's roots speak to a model, a working folder to a person. */
export const voiceOf = (scope: PathScope): Voice => (inFolder(scope) ? 'cli' : 'mcp');

/** The few words a refusal says differently to a host's model and to a person at a command line (CLI-10). */
const WORDS = {
  mcp: {
    voice: 'mcp',
    give: 'send',
    Give: 'Send',
    full: 'full ',
    never: 'this server never opens',
    who: 'a tool',
    reads: 'this tool reads',
    runs: 'this server runs',
    notFull: "send the full path (this server cannot see your shell's current folder)",
    aside: '',
    nodeAside: '',
  },
  cli: {
    voice: 'cli',
    give: 'give',
    Give: 'Give',
    full: '',
    never: 'Forma never opens',
    who: 'Forma',
    reads: 'Forma reads',
    runs: 'Forma is running',
    notFull: 'give the full path',
    aside: '; only the folder the command is run in may be one',
    nodeAside: '; only the folder the command is run in may be inside it',
  },
} as const satisfies Record<Voice, Record<string, string>>;
type Words = (typeof WORDS)[Voice];

const isWin = (p: PlatformPath) => p.sep === '\\';
/** A path as `w`'s refusals quote it (caller.ts `quoted`), cut at 200 characters. */
const shown = (raw: string, w: Words) => quoted(raw.length > 200 ? `${raw.slice(0, 200)}...` : raw, w.voice);

/** Windows' reserved device names, which open a device whatever the folder or extension. */
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|conin\$|conout\$)$/i;
/** Characters Windows refuses in a file name (':' is judged on its own). */
const WIN_BAD = /[<>"|?*]/;
/**
 * Names that hold credentials, never read or written by a tool: .gitignore's
 * patterns, and since the wave-8 review (W8C-5) the files a .NET project
 * keeps its connection strings in (appsettings*.json, local.settings.json)
 * and a connections*.txt, which generate_report would otherwise send to the
 * AI as data.
 */
const CREDENTIAL = [
  /^key\.txt$/i,
  /\.key$/i,
  /apikey/i,
  /api-key/i,
  /^secrets\.json$/i,
  /firebase-adminsdk.*\.json$/i,
  /^service-account.*\.json$/i,
  /^firebase-applet-config\.json$/i,
  /^\.env/i,
  /^\.mcp\.json$/i,
  /^appsettings.*\.json$/i,
  /^local\.settings\.json$/i,
  /^connections.*\.txt$/i,
];

/**
 * The tool argument's description, written for the platform the server runs
 * on so a model on Windows sees only a Windows example.
 */
export function describePath(path: PlatformPath, purpose: string): string {
  const example = isWin(path) ? 'G:\\Reports\\invoice.repx' : '/home/me/reports/invoice.repx';
  const not = isWin(path) ? 'Not relative, not ~, not a Git Bash /g/... path.' : 'Not relative, not ~.';
  return `${purpose} The full path, for example ${example}. ${not}`;
}

/**
 * Judges the raw string a model sent, before any normalisation and with no
 * file-system call. An admitted path comes back resolved (separators made
 * the platform's, `.` and `..` segments folded); a refused one comes back
 * with words that name the fix.
 */
export function parseToolPath(raw: unknown, path: PlatformPath, home?: string): PathVerdict {
  return readRaw(raw, path, home, WORDS.mcp);
}

/**
 * A path as its caller's scope reads it, with no file-system call: the MCP
 * server's paths by `parseToolPath`; the command line's with a relative one
 * resolved against the working folder, which must itself be a full path
 * (the header's *The command line's mode*), in a person's words.
 */
export function parsePath(raw: unknown, scope: PathScope, sys: PathSystem): PathVerdict {
  if (!inFolder(scope)) return parseToolPath(raw, sys.path, sys.home);
  const base = workingFolder(scope, sys);
  return base.ok ? readRaw(raw, sys.path, sys.home, WORDS.cli, base.path) : base;
}

/** The working folder, judged as any full path is, in a person's words. */
function workingFolder(scope: WorkingFolder, sys: PathSystem): PathVerdict {
  const base = readRaw(scope.base, sys.path, sys.home, WORDS.cli);
  return base.ok ? base : { ok: false, reason: `Forma cannot use the folder the command is run in: ${base.reason}` };
}

/**
 * The raw-string checks, in `w`'s words. With `base`, the command line's
 * working folder, a relative path is that folder's: its own names are held
 * to Windows' rules first, then it is resolved; without one it is refused.
 */
function readRaw(raw: unknown, path: PlatformPath, home: string | undefined, w: Words, base?: string): PathVerdict {
  const no = (reason: string): PathVerdict => ({ ok: false, reason });
  if (typeof raw !== 'string' || raw === '') return no(`${w.Give} the ${w.full}path to the file.`);
  const win = isWin(path);
  if (/^["'].*["']$/s.test(raw.trim())) return no(`${shown(raw, w)} is in quotes; ${w.give} the path without them.`);
  if (raw.trim() !== raw) return no(`${shown(raw, w)} starts or ends with a space; ${w.give} the path without it.`);
  if (/[\u0000-\u001f\u007f]/.test(raw)) return no(`${shown(raw, w)} holds a control character; ${w.give} the path as the file system spells it.`);
  if (/^file:/i.test(raw)) {
    let fixed = '';
    try {
      fixed = fileUrlToPath(raw, path);
    } catch {
      /* no corrected path to offer */
    }
    return no(`${shown(raw, w)} is a URL; ${w.give} a path${fixed ? `, ${shown(fixed, w)}` : ''}.`);
  }
  if (/^[\\/]{2}/.test(raw)) {
    if (!win) return no(`${shown(raw, w)} starts with two slashes; ${w.give} it with one.`);
    // \\?\C:\... and \\.\C:\... name a file on this computer's drive C:, in the long and device forms tools print for long
    // names: refused all the same, still before any file-system call, with the plain path to give instead (the CLI work's
    // wave-2 review, SEC-W2-6: until then the refusal said the path was on another computer, which it is not).
    const long = /^[\\/]{2}[?.][\\/]([A-Za-z]):[\\/](.*)$/s.exec(raw);
    if (long) return no(`${shown(raw, w)} is the long form of a path on drive ${long[1].toUpperCase()}:; ${w.give} it as ${shown(`${long[1].toUpperCase()}:\\${long[2].replace(/\//g, '\\')}`, w)}.`);
    const drive = /^[\\/]{2}([A-Za-z])[\\/](.*)$/.exec(raw);
    const hint = drive ? ` If you meant drive ${drive[1].toUpperCase()}:, ${w.give} ${shown(`${drive[1].toUpperCase()}:\\${drive[2].replace(/\//g, '\\')}`, w)}.` : '';
    return no(`${shown(raw, w)} names a path on another computer, which ${w.never}.${hint}`);
  }
  if (/^~(?:[\\/]|$)/.test(raw)) {
    const fixed = home ? path.join(home, raw.slice(2)) : '';
    return no(`${shown(raw, w)} starts with ~; ${w.give} the full path of the home folder${fixed ? `, ${shown(fixed, w)}` : ''}.`);
  }
  if (win) {
    const msys = /^\/([A-Za-z])(?:\/(.*))?$/.exec(raw) ?? /^\/mnt\/([A-Za-z])(?:\/(.*))?$/.exec(raw);
    if (msys) {
      const fixed = `${msys[1].toUpperCase()}:\\${(msys[2] ?? '').replace(/\//g, '\\')}`;
      return no(`${shown(raw, w)} is a Git Bash or WSL path; ${w.give} ${shown(fixed, w)}.`);
    }
    if (/^\//.test(raw)) return no(`${shown(raw, w)} is a Unix path; ${w.give} the full Windows path, with its drive letter.`);
    if (/^\\/.test(raw)) return no(`${shown(raw, w)} starts at the root of whichever drive is current; ${w.give} it with its drive letter.`);
    if (/^[A-Za-z]:(?![\\/])/.test(raw)) return no(`${shown(raw, w)} is relative to the current folder of drive ${raw[0].toUpperCase()}:; ${w.give} the full path, for example ${raw[0].toUpperCase()}:\\folder\\${raw.slice(2) || 'file'}.`);
    const relative = !/^[A-Za-z]:[\\/](?![\\/])/.test(raw);
    if (relative && base === undefined) return no(`${shown(raw, w)} is not a full path; ${w.notFull}.`);
    if (relative ? raw.includes(':') : raw.indexOf(':', 2) !== -1) {
      return no(`${shown(raw, w)} has a ':'${relative ? '' : ' after the drive letter'}, which names a hidden stream of a file; ${w.give} a plain file path.`);
    }
    const segments = (relative ? raw : raw.slice(3)).split(/[\\/]/);
    for (const s of segments) {
      if (WIN_BAD.test(s)) return no(`${shown(raw, w)} holds a character Windows does not allow in a file name.`);
      if (s !== '.' && s !== '..' && /[ .]$/.test(s)) return no(`${shown(raw, w)} has a name ending in a space or a dot, which Windows cannot open; ${w.give} the name without it.`);
      if (DEVICE.test(s.split('.')[0])) return no(`${shown(raw, w)} names a Windows device (${s.split('.')[0].toUpperCase()}), not a file.`);
    }
    if (relative) return { ok: true, path: path.resolve(base as string, raw) };
  } else {
    if (/^[A-Za-z]:[\\/]/.test(raw)) return no(`${shown(raw, w)} is a Windows path, and ${w.runs} on another system; ${w.give} a ${w.full}path such as /home/me/report.repx.`);
    if (!raw.startsWith('/')) {
      if (base === undefined) return no(`${shown(raw, w)} is not a full path; ${w.notFull}.`);
      return { ok: true, path: path.resolve(base, raw) };
    }
  }
  return { ok: true, path: path.resolve(raw) };
}

/** A `file:` URL as a path of the given platform; `url.fileURLToPath`, never `URL.pathname`. */
export function fileUrlToPath(uri: string, path: PlatformPath): string {
  // Node's own conversion, told which platform's rules to use, so a Windows
  // client's file:///c%3A/... is read the same on a Linux test runner.
  return nodeFileURLToPath(uri, { windows: isWin(path) });
}

/** True when `target` is `root` or below it, judged segment by segment (case-insensitively on Windows). */
export function isInside(target: string, root: string, path: PlatformPath): boolean {
  const r = path.relative(root, target);
  if (r === '') return true;
  if (path.isAbsolute(r)) return false;
  return r !== '..' && !r.startsWith(`..${path.sep}`);
}

/** The real path of the root a resolved path is inside, judged against the real paths only. */
const realRootOf = (real: string, roots: readonly Root[], path: PlatformPath) => roots.find((root) => isInside(real, root.real, path))?.real;

/** True when a path as spelled is inside a root as spelled or as it really is: the check before any file-system call. */
const spelledInside = (target: string, roots: readonly Root[], path: PlatformPath) => roots.some((root) => isInside(target, root.path, path) || isInside(target, root.real, path));

/**
 * A link target that leaves this computer's drives: `\\host\share`,
 * `//host/share`, `\\?\UNC\...`, `\??\UNC\...` and the other device forms.
 * `\\?\C:\` and `\??\C:\` are this computer's drives and are walked like any
 * other path.
 */
const leavesTheDrives = (target: string) => /^(?:[\\/]{2}|\\\?\?\\)/.test(target) && !/^(?:\\\\\?\\|\\\?\?\\)[A-Za-z]:[\\/]/.test(target);

/** How many links one path may go through, chains and loops included. */
const MAX_LINKS = 40;

/**
 * Whether the way to `target` can be walked without leaving this computer:
 * null when it can, else why not (finding PS-6). Every existing component
 * from the drive down is lstat'd, which never follows the component itself;
 * a link's target is read as written, refused when it leaves the drives, and
 * otherwise walked the same way before anything goes through the link. A
 * relative target is read against the link's own folder, whose real path is
 * safe to ask for because every link on the way to it was walked already.
 */
function linksOnTheWay(target: string, sys: PathSystem, budget = { links: MAX_LINKS }): 'remote' | 'too many' | null {
  const { path, fs } = sys;
  const { root } = path.parse(target);
  let cur = root;
  for (const segment of target.slice(root.length).split(path.sep).filter(Boolean)) {
    cur = path.join(cur, segment);
    const link = fs.readlink(cur);
    if (link === null) {
      if (!fs.lexists(cur)) return null;
      continue;
    }
    if (leavesTheDrives(link)) return 'remote';
    if (--budget.links < 0) return 'too many';
    const next = path.isAbsolute(link) ? path.resolve(path.dirname(cur), link) : path.resolve(fs.realpath(path.dirname(cur)), link);
    const why = linksOnTheWay(next, sys, budget);
    if (why) return why;
  }
  return null;
}

/** Where a path lands once every link and junction on its way is followed; a new file's missing folders kept as named. */
function realTarget(target: string, sys: PathSystem): string {
  const { path, fs } = sys;
  const rest: string[] = [];
  let cur = target;
  while (!fs.lexists(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    rest.unshift(path.basename(cur));
    cur = parent;
  }
  const real = fs.realpath(cur);
  return rest.length ? path.join(real, ...rest) : real;
}

/**
 * The first link on the way to `target` that really is in the working folder
 * `base` (a real path) and leads out of it: where that link leads, or null
 * when there is none (the header's *The command line's mode*; the CLI work's
 * wave-2 review, SEC-W2-2). Where a link is, is its own folder's real path
 * and its name, so the answer is the same whichever name the path was
 * spelled through: the working folder's own, a junction or symlink to it, a
 * subst drive, an 8.3 name, or the shell's `$PWD` against Node's physical
 * working folder. On Windows it runs after `linksOnTheWay` has cleared the
 * way, so every real path it asks for is on this computer.
 */
function linkOutOf(target: string, base: string, sys: PathSystem): string | null {
  const { path, fs } = sys;
  const { root } = path.parse(target);
  let cur = root;
  for (const segment of target.slice(root.length).split(path.sep).filter(Boolean)) {
    cur = path.join(cur, segment);
    if (fs.readlink(cur) === null) {
      if (!fs.lexists(cur)) return null;
      continue;
    }
    if (!isInside(path.join(fs.realpath(path.dirname(cur)), segment), base, path)) continue;
    const leads = realTarget(cur, sys);
    if (!isInside(leads, base, path)) return leads;
  }
  return null;
}

/**
 * Why a name may not be read or written, or null. `below` is the folder
 * dot-folders and node_modules are looked for under: the root, for the
 * server; for the command line, the working folder or the drive (the
 * header's *The command line's mode*).
 */
function nameRefusal(target: string, below: string, path: PlatformPath, forWrite: boolean, w: Words): string | null {
  const segments = path.relative(below, target).split(path.sep).filter(Boolean);
  const base = path.basename(target);
  if (CREDENTIAL.some((re) => re.test(base))) return `${shown(target, w)} is named as a file of credentials, which ${w.who} never opens.`;
  const dot = segments.find((s) => s.startsWith('.'));
  if (dot) return `${shown(target, w)} is inside ${shown(dot, w)}; ${w.who} never ${forWrite ? 'writes into' : 'reads from'} a dot-folder or a dot-file${w.aside}.`;
  if (forWrite && segments.some((s) => s.toLowerCase() === 'node_modules')) return `${shown(target, w)} is inside node_modules; ${w.who} never writes there${w.nodeAside}.`;
  return null;
}

const outside = (target: string) => `${shown(target, WORDS.mcp)} is outside the folders this server may use; forma_status lists them.`;

export interface TargetOptions {
  /** The extensions this tool reads or writes, lower case with the dot; any when absent. */
  extensions?: readonly string[];
}

/**
 * A file a tool, or the command line, may read: inside a root once links
 * are followed (for the command line, in the folder it must really be in),
 * an existing file, not a credential or a dot-file, and of one of the
 * caller's extensions under its own name and its real one. Returns the real
 * path to open.
 */
export function resolveReadPath(raw: unknown, scope: PathScope, sys: PathSystem, options: TargetOptions & { maxBytes?: number } = {}): PathVerdict {
  const found = located(raw, scope, sys, options);
  if (!found.ok) return found;
  const { target, real, below } = found;
  const { path, fs } = sys;
  const w = WORDS[voiceOf(scope)];
  const named = nameRefusal(real, below, path, false, w);
  if (named) return { ok: false, reason: named };
  if (!fs.lexists(real)) return { ok: false, reason: `There is no file at ${shown(target, w)}.` };
  const stat = fs.stat(real);
  if (!stat.isFile()) return { ok: false, reason: `${shown(target, w)} is not a file.` };
  if (options.maxBytes !== undefined && stat.size > options.maxBytes) return { ok: false, reason: `${shown(target, w)} is ${stat.size} bytes, more than the ${options.maxBytes} ${w.reads}.` };
  return { ok: true, path: real };
}

/**
 * A file a tool, or the command line, may write: inside a root once links
 * are followed (the nearest existing folder's, for a file not there yet; for
 * the command line, in the folder it must really be in), not in a dot-folder
 * or node_modules, of one of the caller's extensions under its own name and
 * its real one. Whether it already exists is `writeOutput`'s business, at
 * the moment of writing.
 */
export function resolveWritePath(raw: unknown, scope: PathScope, sys: PathSystem, options: TargetOptions = {}): PathVerdict {
  const found = located(raw, scope, sys, options);
  if (!found.ok) return found;
  const { target, real, root, below } = found;
  const { path, fs } = sys;
  const w = WORDS[voiceOf(scope)];
  if (path.relative(root, real) === '') return { ok: false, reason: `${shown(target, w)} is a folder${inFolder(scope) ? ', not a file' : ' this server may use, not a file in it'}.` };
  const named = nameRefusal(real, below, path, true, w);
  if (named) return { ok: false, reason: named };
  if (fs.lexists(real) && !fs.stat(real).isFile()) return { ok: false, reason: `${shown(target, w)} is a folder, not a file.` };
  return { ok: true, path: real };
}

/**
 * A folder the command line may list (since the CLI and Forma Designer
 * work's wave 4, 2026-11-24: its audit of a folder): judged as a file to
 * read is, the string before any file-system call, the links on the way
 * walked so none to another computer is followed, and the folder it must
 * really be in, so no link the working folder holds leads out of it; then
 * an existing folder, not a dot-folder below the working folder. Returns its
 * real path. Nothing in it is admitted by this: each file a listing finds is
 * judged on its own, by `resolveReadPath`. Never `fs.stat` on a path before
 * this: a stat follows a junction to a share, which sends the Windows
 * sign-in (GAP2-2, PS-6).
 */
export function resolveFolderPath(raw: unknown, scope: PathScope, sys: PathSystem): PathVerdict {
  const found = located(raw, scope, sys, {});
  if (!found.ok) return found;
  const { target, real, below } = found;
  const { path, fs } = sys;
  const w = WORDS[voiceOf(scope)];
  const named = nameRefusal(real, below, path, false, w);
  if (named) return { ok: false, reason: named };
  if (!fs.lexists(real)) return { ok: false, reason: `There is no folder at ${shown(target, w)}.` };
  if (!fs.stat(real).isDirectory()) return { ok: false, reason: `${shown(target, w)} is not a folder.` };
  return { ok: true, path: real };
}

/** Where a path really lands: `root`, the folder it must be in; `below`, the folder the name rules look under. */
type Located = { ok: true; target: string; real: string; root: string; below: string } | { ok: false; reason: string };

/** What reads and writes share: the checks before the file system, the walk of the links on the way, the real path, and its root. */
function located(raw: unknown, scope: PathScope, sys: PathSystem, options: TargetOptions): Located {
  const target = checked(raw, scope, sys, options);
  if (!target.ok) return target;
  const { path } = sys;
  const w = WORDS[voiceOf(scope)];
  const remote = (p: string) => `${shown(p, w)} goes through a link to another computer, which ${w.never}.`;
  let real: string;
  let base: string | null = null;
  let folder: string | null = null;
  try {
    if (isWin(path)) {
      const why = linksOnTheWay(target.path, sys);
      if (why === 'remote') return { ok: false, reason: remote(target.path) };
      if (why === 'too many') return { ok: false, reason: `${shown(target.path, w)} goes through more than ${MAX_LINKS} links; ${w.give} the file's real path.` };
      // The working folder is walked as any path is before its real path is asked for: a junction to a share is never followed.
      const baseWhy = target.base === null ? null : linksOnTheWay(target.base, sys);
      if (baseWhy) return { ok: false, reason: `Forma cannot use the folder the command is run in: ${baseWhy === 'remote' ? remote(target.base as string) : `${shown(target.base as string, w)} goes through more than ${MAX_LINKS} links.`}` };
    }
    real = realTarget(target.path, sys);
    if (target.base !== null) {
      base = realTarget(target.base, sys);
      // Whether a path is in the working folder is where it really is, never how it was spelled (SEC-W2-2): no link that is
      // really in the working folder may lead out of it, and a path whose folder is really in it must land in it.
      const out = linkOutOf(target.path, base, sys);
      if (out !== null) return { ok: false, reason: `${shown(target.path, w)} leads through a link to ${shown(isInside(real, base, path) ? out : real, w)}, outside the folder the command is run in; Forma follows no link out of it.` };
      const named = realTarget(path.dirname(target.path), sys);
      folder = isInside(named, base, path) ? base : named;
    }
  } catch {
    return { ok: false, reason: `${shown(target.path, w)} could not be resolved on this computer.` };
  }
  let root: string;
  let below: string;
  if (base === null || folder === null) {
    const found = realRootOf(real, scope as readonly Root[], path);
    if (!found) return { ok: false, reason: outside(target.path) };
    root = below = found;
  } else {
    // Named inside the working folder, it must really be there; named outside it, in the folder it is named in.
    if (!isInside(real, folder, path)) {
      const where = folder === base ? 'the folder the command is run in' : 'the folder it is named in';
      return { ok: false, reason: `${shown(target.path, w)} leads through a link to ${shown(real, w)}, outside ${where}; Forma follows no link out of it.` };
    }
    root = folder;
    below = isInside(real, base, path) ? base : path.parse(real).root;
  }
  const wrongKind = extensionRefusal(real, path, options);
  if (wrongKind) return { ok: false, reason: `${shown(target.path, w)} leads to ${shown(real, w)}, which ${wrongKind}` };
  return { ok: true, target: target.path, real, root, below };
}

/** Why a name is not one of the tool's extensions, or null. */
function extensionRefusal(name: string, path: PlatformPath, options: TargetOptions): string | null {
  if (!options.extensions || options.extensions.includes(path.extname(name).toLowerCase())) return null;
  return `is not a ${options.extensions.join(' or ')} file.`;
}

/** A path admitted by the checks before the file system; `base` is the command line's working folder, null for the server. */
type Checked = { ok: true; path: string; base: string | null } | { ok: false; reason: string };

/** The string checks, the extension and the lexical root check: everything before the first file-system call. */
function checked(raw: unknown, scope: PathScope, sys: PathSystem, options: TargetOptions): Checked {
  const base = inFolder(scope) ? workingFolder(scope, sys) : null;
  if (base && !base.ok) return base;
  const parsed = base ? readRaw(raw, sys.path, sys.home, WORDS.cli, base.path) : parseToolPath(raw, sys.path, sys.home);
  if (!parsed.ok) return parsed;
  const wrongKind = extensionRefusal(parsed.path, sys.path, options);
  if (wrongKind) return { ok: false, reason: `${shown(parsed.path, WORDS[voiceOf(scope)])} ${wrongKind}` };
  if (base) return { ok: true, path: parsed.path, base: base.path };
  const roots = scope as readonly Root[];
  if (!roots.length) return { ok: false, reason: 'No folder is set for this server to use; forma_status says how to set one.' };
  if (!spelledInside(parsed.path, roots, sys.path)) return { ok: false, reason: outside(parsed.path) };
  return { ok: true, path: parsed.path, base: null };
}

/** The file-system calls `writeOutput` makes. Node's are in `nodeWriteFs`. */
export interface WriteFs {
  mkdir(p: string): void;
  writeNew(p: string, data: Uint8Array): void;
  link(from: string, to: string): void;
  rename(from: string, to: string): void;
  copyNew(from: string, to: string): void;
  read(p: string): Uint8Array;
  exists(p: string): boolean;
  unlink(p: string): void;
}

/** Node's own calls, for the server; tests hand in their own. */
export const nodeWriteFs: WriteFs = {
  mkdir: (p) => mkdirSync(p, { recursive: true }),
  writeNew: (p, data) => writeFileSync(p, data, { flag: 'wx' }),
  link: (from, to) => linkSync(from, to),
  rename: (from, to) => renameSync(from, to),
  copyNew: (from, to) => copyFileSync(from, to, constants.COPYFILE_EXCL),
  read: (p) => readFileSync(p),
  exists: (p) => existsSync(p),
  unlink: (p) => unlinkSync(p),
};

/**
 * What `writeOutput` did. `beside`: the name was taken by other content, so
 * the file went beside it. `exists`: the name was taken by other content and
 * the caller asked for that name or nothing, so nothing was written.
 */
export type WriteStatus = 'written' | 'unchanged' | 'replaced' | 'beside' | 'exists';

/** What a write that never refuses a name can have done: every status but `exists`. */
export type PlacedStatus = Exclude<WriteStatus, 'exists'>;

/**
 * What a write does when its name holds other content (CLI-6): `beside`, the
 * MCP server's, writes `name (2).ext`; `replace` replaces it, only when the
 * person asked; `refuse`, the command line's, writes nothing and says
 * `exists`, so a rerun never piles up copies and a resume can skip the input.
 */
export type IfExists = 'beside' | 'replace' | 'refuse';

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const code = (e: unknown) => (e as { code?: string })?.code;

/**
 * Writes `data` to `target` (a path `resolveWritePath` admitted) without ever
 * replacing a file the caller did not ask to replace. The same content
 * already there is success, `unchanged`, so a host repeating a call gets the
 * same answer. Other content there is `ifExists`'s to decide: beside it as
 * `name (2).ext` (the default), with the result naming that path; nothing
 * written, `exists`, the temporary file removed; or replaced, through a
 * rename, so a reader never sees half a file.
 *
 * Whether the name is taken is decided at the moment of placing the file, by
 * the hard link (or the copy that refuses to replace) failing, never by a
 * look beforehand: a file that appears after the caller judged the path, or
 * after the bytes were written, is found then, kept, and said. A replace
 * links first too, so its status says `written` only when the name was free
 * at that moment; until the CLI work's wave 2 it looked first and renamed
 * after, and a file that appeared between the two was replaced under a
 * `written`.
 *
 * The temporary file is named `<name>.forma-partial-<random>` in the same
 * folder, so a process ended mid-write (Claude Code ends a stdio server's
 * process tree 300 ms after closing its stdin, on Windows) leaves a leftover
 * anyone can recognise, never a half-written file under the final name.
 */
export function writeOutput(target: string, data: Uint8Array, wfs: WriteFs, path: PlatformPath, options: { ifExists?: IfExists; random?: () => string } = {}): { path: string; status: WriteStatus } {
  const ifExists = options.ifExists ?? 'beside';
  const dir = path.dirname(target);
  wfs.mkdir(dir);
  const temp = path.join(dir, `${path.basename(target)}.forma-partial-${(options.random ?? (() => Math.random().toString(36).slice(2, 10)))()}`);
  wfs.writeNew(temp, data);
  try {
    if (ifExists !== 'beside') {
      try {
        placeNew(temp, target, wfs);
        return { path: target, status: 'written' };
      } catch (e) {
        if (code(e) !== 'EEXIST') throw e;
      }
      if (ifExists === 'replace') {
        wfs.rename(temp, target);
        return { path: target, status: 'replaced' };
      }
      return { path: target, status: sameBytes(wfs.read(target), data) ? 'unchanged' : 'exists' };
    }
    const ext = path.extname(target);
    const stem = target.slice(0, target.length - ext.length);
    for (let n = 1; n <= 99; n++) {
      const candidate = n === 1 ? target : `${stem} (${n})${ext}`;
      try {
        placeNew(temp, candidate, wfs);
        return { path: candidate, status: n === 1 ? 'written' : 'beside' };
      } catch (e) {
        if (code(e) !== 'EEXIST') throw e;
        if (sameBytes(wfs.read(candidate), data)) return { path: candidate, status: 'unchanged' };
      }
    }
    throw new Error(`Ninety-nine files beside ${target} already hold other content; name another output.`);
  } finally {
    if (wfs.exists(temp)) wfs.unlink(temp);
  }
}

/** A hard link, which fails when the name exists; a copy that refuses to replace where links are not supported (FAT, some shares). */
function placeNew(temp: string, target: string, wfs: WriteFs): void {
  try {
    wfs.link(temp, target);
  } catch (e) {
    if (code(e) === 'EEXIST') throw e;
    if (!['EPERM', 'ENOTSUP', 'EXDEV', 'EOPNOTSUPP', 'ENOSYS'].includes(code(e) ?? '')) throw e;
    wfs.copyNew(temp, target);
  }
}
