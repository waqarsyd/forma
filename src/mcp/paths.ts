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
 * answer. Then a lexical check against the roots keeps a path spelled outside
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
 * rename would silently replace it, on Windows too).
 *
 * Pure ASCII, as everything an MCP server may print.
 */
import { constants, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import type { PlatformPath } from 'node:path';
import { fileURLToPath as nodeFileURLToPath } from 'node:url';

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

const isWin = (p: PlatformPath) => p.sep === '\\';
const shown = (raw: string) => JSON.stringify(raw.length > 200 ? `${raw.slice(0, 200)}...` : raw);

/** Windows' reserved device names, which open a device whatever the folder or extension. */
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|conin\$|conout\$)$/i;
/** Characters Windows refuses in a file name (':' is judged on its own). */
const WIN_BAD = /[<>"|?*]/;
/** Names that hold credentials, from .gitignore's patterns, never read or written by a tool. */
const CREDENTIAL = [/^key\.txt$/i, /\.key$/i, /apikey/i, /api-key/i, /^secrets\.json$/i, /firebase-adminsdk.*\.json$/i, /^service-account.*\.json$/i, /^firebase-applet-config\.json$/i, /^\.env/i, /^\.mcp\.json$/i];

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
  const no = (reason: string): PathVerdict => ({ ok: false, reason });
  if (typeof raw !== 'string' || raw === '') return no('Send the full path to the file.');
  const win = isWin(path);
  if (/^["'].*["']$/s.test(raw.trim())) return no(`${shown(raw)} is in quotes; send the path without them.`);
  if (raw.trim() !== raw) return no(`${shown(raw)} starts or ends with a space; send the path without it.`);
  if (/[\u0000-\u001f\u007f]/.test(raw)) return no(`${shown(raw)} holds a control character; send the path as the file system spells it.`);
  if (/^file:/i.test(raw)) {
    let fixed = '';
    try {
      fixed = fileUrlToPath(raw, path);
    } catch {
      /* no corrected path to offer */
    }
    return no(`${shown(raw)} is a URL; send a path${fixed ? `, ${shown(fixed)}` : ''}.`);
  }
  if (/^[\\/]{2}/.test(raw)) {
    if (!win) return no(`${shown(raw)} starts with two slashes; send it with one.`);
    const drive = /^[\\/]{2}([A-Za-z])[\\/](.*)$/.exec(raw);
    const hint = drive ? ` If you meant drive ${drive[1].toUpperCase()}:, send ${shown(`${drive[1].toUpperCase()}:\\${drive[2].replace(/\//g, '\\')}`)}.` : '';
    return no(`${shown(raw)} names a path on another computer, which this server never opens.${hint}`);
  }
  if (/^~(?:[\\/]|$)/.test(raw)) {
    const fixed = home ? path.join(home, raw.slice(2)) : '';
    return no(`${shown(raw)} starts with ~; send the full path of the home folder${fixed ? `, ${shown(fixed)}` : ''}.`);
  }
  if (win) {
    const msys = /^\/([A-Za-z])(?:\/(.*))?$/.exec(raw) ?? /^\/mnt\/([A-Za-z])(?:\/(.*))?$/.exec(raw);
    if (msys) {
      const fixed = `${msys[1].toUpperCase()}:\\${(msys[2] ?? '').replace(/\//g, '\\')}`;
      return no(`${shown(raw)} is a Git Bash or WSL path; send ${shown(fixed)}.`);
    }
    if (/^\//.test(raw)) return no(`${shown(raw)} is a Unix path; send the full Windows path, with its drive letter.`);
    if (/^\\/.test(raw)) return no(`${shown(raw)} starts at the root of whichever drive is current; send it with its drive letter.`);
    if (/^[A-Za-z]:(?![\\/])/.test(raw)) return no(`${shown(raw)} is relative to the current folder of drive ${raw[0].toUpperCase()}:; send the full path, for example ${raw[0].toUpperCase()}:\\folder\\${raw.slice(2) || 'file'}.`);
    if (!/^[A-Za-z]:[\\/](?![\\/])/.test(raw)) return no(`${shown(raw)} is not a full path; send the full path (this server cannot see your shell's current folder).`);
    if (raw.indexOf(':', 2) !== -1) return no(`${shown(raw)} has a ':' after the drive letter, which names a hidden stream of a file; send a plain file path.`);
    const segments = raw.slice(3).split(/[\\/]/);
    for (const s of segments) {
      if (WIN_BAD.test(s)) return no(`${shown(raw)} holds a character Windows does not allow in a file name.`);
      if (s !== '.' && s !== '..' && /[ .]$/.test(s)) return no(`${shown(raw)} has a name ending in a space or a dot, which Windows cannot open; send the name without it.`);
      if (DEVICE.test(s.split('.')[0])) return no(`${shown(raw)} names a Windows device (${s.split('.')[0].toUpperCase()}), not a file.`);
    }
  } else {
    if (/^[A-Za-z]:[\\/]/.test(raw)) return no(`${shown(raw)} is a Windows path, and this server runs on another system; send a full path such as /home/me/report.repx.`);
    if (!raw.startsWith('/')) return no(`${shown(raw)} is not a full path; send the full path (this server cannot see your shell's current folder).`);
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

/** Why a name may not be read or written by a tool, or null. */
function nameRefusal(target: string, root: string, path: PlatformPath, forWrite: boolean): string | null {
  const segments = path.relative(root, target).split(path.sep).filter(Boolean);
  const base = path.basename(target);
  if (CREDENTIAL.some((re) => re.test(base))) return `${shown(target)} is named as a file of credentials, which a tool never opens.`;
  const dot = segments.find((s) => s.startsWith('.'));
  if (dot) return `${shown(target)} is inside ${shown(dot)}; a tool never ${forWrite ? 'writes into' : 'reads from'} a dot-folder or a dot-file.`;
  if (forWrite && segments.some((s) => s.toLowerCase() === 'node_modules')) return `${shown(target)} is inside node_modules; a tool never writes there.`;
  return null;
}

const outside = (raw: string) => `${shown(raw)} is outside the folders this server may use; forma_status lists them.`;

export interface TargetOptions {
  /** The extensions this tool reads or writes, lower case with the dot; any when absent. */
  extensions?: readonly string[];
}

/**
 * A file a tool may read: fully qualified, inside a root once links are
 * followed, an existing file, not a credential or a dot-file, and of one of
 * the tool's extensions under its own name and its real one. Returns the
 * real path to open.
 */
export function resolveReadPath(raw: unknown, roots: readonly Root[], sys: PathSystem, options: TargetOptions & { maxBytes?: number } = {}): PathVerdict {
  const found = located(raw, roots, sys, options);
  if (!found.ok) return found;
  const { target, real, root } = found;
  const { path, fs } = sys;
  const named = nameRefusal(real, root, path, false);
  if (named) return { ok: false, reason: named };
  if (!fs.lexists(real)) return { ok: false, reason: `There is no file at ${shown(target)}.` };
  const stat = fs.stat(real);
  if (!stat.isFile()) return { ok: false, reason: `${shown(target)} is not a file.` };
  if (options.maxBytes !== undefined && stat.size > options.maxBytes) return { ok: false, reason: `${shown(target)} is ${stat.size} bytes, more than the ${options.maxBytes} this tool reads.` };
  return { ok: true, path: real };
}

/**
 * A file a tool may write: fully qualified, inside a root once links are
 * followed (the nearest existing folder's, for a file not there yet), not in
 * a dot-folder or node_modules, of one of the tool's extensions under its own
 * name and its real one. Whether it already exists is `writeOutput`'s
 * business, at the moment of writing.
 */
export function resolveWritePath(raw: unknown, roots: readonly Root[], sys: PathSystem, options: TargetOptions = {}): PathVerdict {
  const found = located(raw, roots, sys, options);
  if (!found.ok) return found;
  const { target, real, root } = found;
  const { path, fs } = sys;
  if (path.relative(root, real) === '') return { ok: false, reason: `${shown(target)} is a folder this server may use, not a file in it.` };
  const named = nameRefusal(real, root, path, true);
  if (named) return { ok: false, reason: named };
  if (fs.lexists(real) && !fs.stat(real).isFile()) return { ok: false, reason: `${shown(target)} is a folder, not a file.` };
  return { ok: true, path: real };
}

type Located = { ok: true; target: string; real: string; root: string } | { ok: false; reason: string };

/** What reads and writes share: the checks before the file system, the walk of the links on the way, the real path, and its root. */
function located(raw: unknown, roots: readonly Root[], sys: PathSystem, options: TargetOptions): Located {
  const target = checked(raw, roots, sys, options);
  if (!target.ok) return target;
  const { path } = sys;
  let real: string;
  try {
    if (isWin(path)) {
      const why = linksOnTheWay(target.path, sys);
      if (why === 'remote') return { ok: false, reason: `${shown(target.path)} goes through a link to another computer, which this server never opens.` };
      if (why === 'too many') return { ok: false, reason: `${shown(target.path)} goes through more than ${MAX_LINKS} links; send the file's real path.` };
    }
    real = realTarget(target.path, sys);
  } catch {
    return { ok: false, reason: `${shown(target.path)} could not be resolved on this computer.` };
  }
  const root = realRootOf(real, roots, path);
  if (!root) return { ok: false, reason: outside(target.path) };
  const wrongKind = extensionRefusal(real, path, options);
  if (wrongKind) return { ok: false, reason: `${shown(target.path)} leads to ${shown(real)}, which ${wrongKind}` };
  return { ok: true, target: target.path, real, root };
}

/** Why a name is not one of the tool's extensions, or null. */
function extensionRefusal(name: string, path: PlatformPath, options: TargetOptions): string | null {
  if (!options.extensions || options.extensions.includes(path.extname(name).toLowerCase())) return null;
  return `is not a ${options.extensions.join(' or ')} file.`;
}

/** The string checks, the extension and the lexical root check: everything before the first file-system call. */
function checked(raw: unknown, roots: readonly Root[], sys: PathSystem, options: TargetOptions): PathVerdict {
  const parsed = parseToolPath(raw, sys.path, sys.home);
  if (!parsed.ok) return parsed;
  const wrongKind = extensionRefusal(parsed.path, sys.path, options);
  if (wrongKind) return { ok: false, reason: `${shown(parsed.path)} ${wrongKind}` };
  if (!roots.length) return { ok: false, reason: 'No folder is set for this server to use; forma_status says how to set one.' };
  if (!spelledInside(parsed.path, roots, sys.path)) return { ok: false, reason: outside(parsed.path) };
  return parsed;
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

/** What `writeOutput` did. `beside` means the name was taken by other content, so the file went beside it. */
export type WriteStatus = 'written' | 'unchanged' | 'replaced' | 'beside';

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const code = (e: unknown) => (e as { code?: string })?.code;

/**
 * Writes `data` to `target` (a path `resolveWritePath` admitted) without ever
 * replacing a file the caller did not ask to replace. The same content
 * already there is success, `unchanged`, so a host repeating a call gets the
 * same answer. Other content there means the file goes beside it as
 * `name (2).ext`, and the result names that path. With `overwrite` the file
 * is replaced, through a rename, so a reader never sees half a file.
 *
 * The temporary file is named `<name>.forma-partial-<random>` in the same
 * folder, so a process ended mid-write (Claude Code ends a stdio server's
 * process tree 300 ms after closing its stdin, on Windows) leaves a leftover
 * anyone can recognise, never a half-written file under the final name.
 */
export function writeOutput(target: string, data: Uint8Array, wfs: WriteFs, path: PlatformPath, options: { overwrite?: boolean; random?: () => string } = {}): { path: string; status: WriteStatus } {
  const dir = path.dirname(target);
  wfs.mkdir(dir);
  const temp = path.join(dir, `${path.basename(target)}.forma-partial-${(options.random ?? (() => Math.random().toString(36).slice(2, 10)))()}`);
  wfs.writeNew(temp, data);
  try {
    if (options.overwrite) {
      const existed = wfs.exists(target);
      wfs.rename(temp, target);
      return { path: target, status: existed ? 'replaced' : 'written' };
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
