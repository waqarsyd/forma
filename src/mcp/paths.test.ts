/**
 * The MCP server's path rules (paths.ts), under both platforms' rules on
 * every OS, so CI's Linux runners hold the Windows cases too (finding
 * TST-4), and the refusals before any file-system call proved with a file
 * system that records every call and fails on each (GAP2-2, and T1 of the
 * wave-3 review: the code under test catches a throw, so the record is what
 * proves it). The wave-3 review's PS-2 (a root reached through a link), PS-5
 * (a link named for another kind of file) and PS-6 (a link to another
 * computer, never followed) are held here too.
 */
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, mkdirSync, existsSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve, win32, type PlatformPath } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { describePath, isInside, nodePathFs, nodeSystem, nodeWriteFs, parsePath, parseToolPath, resolveReadPath, resolveWritePath, voiceOf, writeOutput, type Root, type WorkingFolder, type WriteFs } from './paths';
import { checkRoot } from './roots';
import { fakeFs, untouchable } from './testFs';

const q = (s: string) => JSON.stringify(s);
/** A root whose spelling is already its real path. */
const plainRoot = (p: string): Root => ({ path: p, real: p });

describe('parseToolPath, Windows rules', () => {
  const home = 'C:\\Users\\me';
  const refused = (raw: unknown) => {
    const v = parseToolPath(raw, win32, home);
    if (v.ok) throw new Error(`admitted ${String(raw)}`);
    return v.reason;
  };

  it('admits a full path with either separator, and folds . and ..', () => {
    expect(parseToolPath('G:\\a\\x.repx', win32)).toEqual({ ok: true, path: 'G:\\a\\x.repx' });
    expect(parseToolPath('G:/a/x.repx', win32)).toEqual({ ok: true, path: 'G:\\a\\x.repx' });
    expect(parseToolPath('g:\\a\\x.repx', win32).ok).toBe(true);
    expect(parseToolPath('G:\\a\\..\\b\\.\\x.repx', win32)).toEqual({ ok: true, path: 'G:\\b\\x.repx' });
    expect(parseToolPath('G:\\a\\..x.repx', win32)).toEqual({ ok: true, path: 'G:\\a\\..x.repx' });
  });

  it.each([
    ['x.repx', /not a full path.*current folder/],
    ['.\\x.repx', /not a full path/],
    ['..\\x.repx', /not a full path/],
    ['G:x.repx', /relative to the current folder of drive G:/],
    ['C:x.repx', /relative to the current folder of drive C:/],
    ['\\a\\x.repx', /root of whichever drive is current/],
    ['/tmp/x.repx', /Unix path/],
    ['"G:\\a\\x.repx"', /in quotes/],
    [' G:\\a\\x.repx', /space/],
    ['G:\\a\\x.repx ', /space/],
    ['G:\\a\\x.repx\t', /space/],
    ['G:\\a\\x.repx.', /ending in a space or a dot/],
    ['G:\\a b \\x.repx', /ending in a space or a dot/],
    ['G:\\a\u0000\\x.repx', /control character/],
    ['G:\\a\\x.repx:hidden', /':' after the drive letter/],
    ['G:\\a\\CON', /device \(CON\)/],
    ['G:\\a\\nul.repx', /device \(NUL\)/],
    ['G:\\a\\COM1.txt', /device \(COM1\)/],
    ['G:\\a\\x?.repx', /does not allow/],
    ['', /Send the full path/],
  ])('refuses %j', (raw, words) => {
    expect(refused(raw)).toMatch(words);
  });

  it('refuses what is not a string', () => {
    expect(refused(undefined)).toMatch(/Send the full path/);
    expect(refused(42)).toMatch(/Send the full path/);
  });

  it.each([
    ['/g/a/x.repx', 'G:\\a\\x.repx'],
    ['/c/Users/u/x.repx', 'C:\\Users\\u\\x.repx'],
    ['/mnt/g/a/x.repx', 'G:\\a\\x.repx'],
    ['/g', 'G:\\'],
  ])('hands back the Windows path for the Git Bash or WSL path %j, and opens nothing', (raw, fixed) => {
    expect(refused(raw)).toContain(q(fixed));
  });

  it('hands back the path for a file: URL and for ~, and never acts on either', () => {
    expect(refused('file:///G:/a/x.repx')).toContain(`is a URL; send a path, ${q('G:\\a\\x.repx')}`);
    expect(refused('~/x.repx')).toContain(q('C:\\Users\\me\\x.repx'));
    expect(refused('~\\x.repx')).toContain(q('C:\\Users\\me\\x.repx'));
    expect(parseToolPath('~/x.repx', win32)).toEqual({ ok: false, reason: expect.not.stringContaining('Users') });
    expect(refused('file://')).toMatch(/is a URL; send a path\.$/);
  });

  it.each(['\\\\host\\share\\x.repx', '//host/share/x.repx', '/\\host\\share\\x.repx', '\\\\?\\UNC\\host\\share\\x.repx', '\\\\.\\UNC\\host\\share\\x.repx', '//g/DevFiles/forma/x.repx'])(
    'refuses %j as a path on another computer',
    (raw) => {
      expect(refused(raw)).toMatch(/another computer, which this server never opens/);
    },
  );

  it.each([
    ['\\\\?\\G:\\x.repx', 'G:\\x.repx'],
    ['\\\\.\\G:\\x.repx', 'G:\\x.repx'],
    ['//?/g:/Reports/x.repx', 'G:\\Reports\\x.repx'],
  ])('refuses %j, a path on a drive of this computer in its long form, handing back the plain one', (raw, plain) => {
    // The CLI work's wave-2 review, SEC-W2-6: these were refused as paths on another computer, which they are not.
    expect(refused(raw)).toBe(`${q(raw)} is the long form of a path on drive ${plain[0]}:; send it as ${q(plain)}.`);
  });

  it('offers the drive for the Git Bash slip //g/...', () => {
    expect(refused('//g/DevFiles/forma/x.repx')).toContain(`If you meant drive G:, send ${q('G:\\DevFiles\\forma\\x.repx')}`);
  });
});

describe('parseToolPath, POSIX rules', () => {
  const refused = (raw: string) => {
    const v = parseToolPath(raw, posix, '/home/me');
    if (v.ok) throw new Error(`admitted ${raw}`);
    return v.reason;
  };

  it('admits a full path and folds . and ..', () => {
    expect(parseToolPath('/home/u/x.repx', posix)).toEqual({ ok: true, path: '/home/u/x.repx' });
    expect(parseToolPath('/home/u/../v/./x.repx', posix)).toEqual({ ok: true, path: '/home/v/x.repx' });
  });

  it.each([
    ['x.repx', /not a full path/],
    ['./x.repx', /not a full path/],
    ['../x.repx', /not a full path/],
    ['G:\\x.repx', /Windows path/],
    ['G:/x.repx', /Windows path/],
    ['//host/x.repx', /two slashes/],
    ['"/home/u/x.repx"', /in quotes/],
    ['/home/u/x.repx ', /space/],
    ['/home/u/\u0007x.repx', /control character/],
  ])('refuses %j', (raw, words) => {
    expect(refused(raw)).toMatch(words);
  });

  it('hands back the path for ~ and a file: URL', () => {
    expect(refused('~/x.repx')).toContain(q('/home/me/x.repx'));
    expect(refused('file:///home/u/x.repx')).toContain(q('/home/u/x.repx'));
  });
});

describe('isInside', () => {
  it('compares Windows paths without case, by whole segments', () => {
    expect(isInside('g:\\devfiles\\forma\\a.repx', 'G:\\DevFiles\\forma', win32)).toBe(true);
    expect(isInside('G:\\DevFiles\\forma', 'G:\\DevFiles\\forma', win32)).toBe(true);
    expect(isInside('C:\\DevFiles\\forma\\a.repx', 'G:\\DevFiles\\forma', win32)).toBe(false);
    expect(isInside('G:\\DevFiles\\forma-evil\\a.repx', 'G:\\DevFiles\\forma', win32)).toBe(false);
    expect(isInside('G:\\DevFiles\\forma\\..x.repx', 'G:\\DevFiles\\forma', win32)).toBe(true);
    expect(isInside('G:\\DevFiles\\a.repx', 'G:\\DevFiles\\forma', win32)).toBe(false);
  });

  it('compares POSIX paths with case', () => {
    expect(isInside('/home/u/Forma/a.repx', '/home/u/forma', posix)).toBe(false);
    expect(isInside('/home/u/forma/a.repx', '/home/u/forma', posix)).toBe(true);
    expect(isInside('/home/u/forma-evil/a.repx', '/home/u/forma', posix)).toBe(false);
  });
});

/**
 * One scene, spelled for each platform: a project folder, a folder outside
 * it, a junction from one to the other, a link named as a report that leads
 * to another kind of file, and a junction that leads to the project, as a
 * root reached through a link is spelled.
 */
function scene(path: PlatformPath) {
  const at = (...parts: string[]) => (path === win32 ? `G:\\${parts.join('\\')}` : `/srv/${parts.join('/')}`);
  const fs = fakeFs(path, {
    dirs: [at('proj', 'sub'), at('outside')],
    files: {
      [at('proj', 'a.repx')]: 100,
      [at('proj', 'a.pdf')]: 100,
      [at('proj', 'data.json')]: 100,
      [at('proj', 'big.repx')]: 9_000_000,
      [at('proj', '.git', 'config.repx')]: 10,
      [at('proj', 'service-account-x.json')]: 10,
      [at('proj', 'appsettings.Development.json')]: 10,
      [at('proj', 'local.settings.json')]: 10,
      [at('proj', 'connections.txt')]: 10,
      [at('outside', 'secret.repx')]: 10,
    },
    links: { [at('proj', 'link')]: at('outside'), [at('proj', 'dead')]: at('nowhere'), [at('proj', 'alias.repx')]: at('proj', 'data.json'), [at('jroot')]: at('proj') },
  });
  return { at, fs, sys: { path, fs }, roots: [plainRoot(at('proj'))] };
}

describe.each([
  ['Windows', win32],
  ['POSIX', posix],
] as const)('resolveReadPath, %s rules', (_name, path) => {
  it('opens a file in a root, at the real path', () => {
    const { at, sys, roots } = scene(path);
    expect(resolveReadPath(at('proj', 'a.repx'), roots, sys)).toEqual({ ok: true, path: at('proj', 'a.repx') });
    expect(resolveReadPath(at('proj', 'sub', '..', 'a.repx'), roots, sys)).toEqual({ ok: true, path: at('proj', 'a.repx') });
  });

  it('refuses a path outside every root before any file-system call', () => {
    const { at, fs, sys, roots } = scene(path);
    expect(resolveReadPath(at('outside', 'secret.repx'), roots, sys)).toEqual({ ok: false, reason: expect.stringMatching(/outside the folders.*forma_status/) });
    expect(fs.calls).toEqual([]);
  });

  it('follows a junction or symlink before deciding, and refuses one that leads out', () => {
    const { at, sys, roots } = scene(path);
    expect(resolveReadPath(at('proj', 'link', 'secret.repx'), roots, sys)).toEqual({ ok: false, reason: expect.stringMatching(/outside the folders/) });
    expect(resolveReadPath(at('proj', 'dead'), roots, sys)).toEqual({ ok: false, reason: expect.stringMatching(/could not be resolved/) });
  });

  it('refuses what is missing, a folder, a dot-folder, a credential, another extension and a file too large', () => {
    const { at, sys, roots } = scene(path);
    const reason = (raw: string, options = {}) => {
      const v = resolveReadPath(raw, roots, sys, options);
      return v.ok ? 'admitted' : v.reason;
    };
    expect(reason(at('proj', 'missing.repx'))).toMatch(/There is no file/);
    expect(reason(at('proj', 'sub'))).toMatch(/is not a file/);
    expect(reason(at('proj', '.git', 'config.repx'))).toMatch(/dot-folder or a dot-file/);
    expect(reason(at('proj', 'service-account-x.json'))).toMatch(/credentials/);
    // The files a .NET project keeps its connection strings in (W8C-5).
    for (const name of ['appsettings.Development.json', 'local.settings.json', 'connections.txt']) expect(reason(at('proj', name)), name).toMatch(/credentials/);
    expect(reason(at('proj', 'a.pdf'), { extensions: ['.repx'] })).toMatch(/is not a \.repx file/);
    expect(reason(at('proj', 'big.repx'), { maxBytes: 5_000_000 })).toMatch(/9000000 bytes, more than the 5000000/);
    expect(resolveReadPath(at('proj', 'a.repx'), [], sys)).toEqual({ ok: false, reason: expect.stringMatching(/No folder is set/) });
  });

  it('judges the extension again on where a link leads, so a link named as a report opens no other kind of file', () => {
    const { at, sys, roots } = scene(path);
    expect(resolveReadPath(at('proj', 'alias.repx'), roots, sys, { extensions: ['.repx'] })).toEqual({ ok: false, reason: expect.stringMatching(/alias\.repx.*leads to .*data\.json.*which is not a \.repx file/) });
    expect(resolveReadPath(at('proj', 'alias.repx'), roots, sys)).toEqual({ ok: true, path: at('proj', 'data.json') });
  });

  it('admits a path spelled through the link a root was reached by, and checks where it lands against the real path only', () => {
    const { at, sys } = scene(path);
    const linked: Root[] = [{ path: at('jroot'), real: at('proj') }];
    expect(resolveReadPath(at('jroot', 'a.repx'), linked, sys)).toEqual({ ok: true, path: at('proj', 'a.repx') });
    expect(resolveReadPath(at('proj', 'a.repx'), linked, sys)).toEqual({ ok: true, path: at('proj', 'a.repx') });
    // The spelling admits the path to the file system; where it really lands decides. Here the
    // spelling has since come to name another folder (a junction replaced by a real one).
    const replaced: Root[] = [{ path: at('outside'), real: at('proj') }];
    expect(resolveReadPath(at('outside', 'secret.repx'), replaced, sys)).toEqual({ ok: false, reason: expect.stringMatching(/outside the folders/) });
    expect(resolveWritePath(at('outside', 'new.repx'), replaced, sys)).toEqual({ ok: false, reason: expect.stringMatching(/outside the folders/) });
  });
});

describe('a link on the way to another computer, Windows rules', () => {
  /** A project holding a link to a share, a link to a local folder that is itself a link to a share, and a loop. */
  function remote() {
    const fs = fakeFs(win32, {
      dirs: ['G:\\proj', 'G:\\relay'],
      files: { 'G:\\proj\\a.repx': 1 },
      links: { 'G:\\proj\\uncl': '\\\\host\\share\\', 'G:\\proj\\fwd': '//host/share/', 'G:\\proj\\hop': 'G:\\relay\\far', 'G:\\relay\\far': '\\\\host\\share\\', 'G:\\proj\\l1': 'G:\\proj\\l2', 'G:\\proj\\l2': 'G:\\proj\\l1' },
    });
    return { fs, sys: { path: win32, fs }, roots: [plainRoot('G:\\proj')] };
  }

  it.each(['G:\\proj\\uncl\\x.repx', 'G:\\proj\\fwd\\x.repx', 'G:\\proj\\hop\\x.repx', 'G:\\proj\\uncl\\deep\\new.repx'])('refuses %j without ever following the link', (raw) => {
    const { fs, sys, roots } = remote();
    expect(resolveReadPath(raw, roots, sys)).toEqual({ ok: false, reason: expect.stringMatching(/goes through a link to another computer, which this server never opens/) });
    expect(resolveWritePath(raw, roots, sys)).toEqual({ ok: false, reason: expect.stringMatching(/goes through a link to another computer/) });
    expect(fs.calls.filter((c) => c.startsWith('network'))).toEqual([]);
  });

  it('refuses a loop of links in plain words, and opens a file whose way stays on this computer', () => {
    const { sys, roots } = remote();
    expect(resolveReadPath('G:\\proj\\l1\\x.repx', roots, sys)).toEqual({ ok: false, reason: expect.stringMatching(/more than 40 links/) });
    expect(resolveReadPath('G:\\proj\\a.repx', roots, sys)).toEqual({ ok: true, path: 'G:\\proj\\a.repx' });
  });
});

describe.each([
  ['Windows', win32],
  ['POSIX', posix],
] as const)('resolveWritePath, %s rules', (_name, path) => {
  it('admits a new file in a root, and in a new folder inside it', () => {
    const { at, sys, roots } = scene(path);
    expect(resolveWritePath(at('proj', 'out.repx'), roots, sys)).toEqual({ ok: true, path: at('proj', 'out.repx') });
    expect(resolveWritePath(at('proj', 'new', 'deep', 'out.repx'), roots, sys)).toEqual({ ok: true, path: at('proj', 'new', 'deep', 'out.repx') });
  });

  it('refuses a path outside every root before any file-system call', () => {
    const { at, fs, sys, roots } = scene(path);
    expect(resolveWritePath(at('outside', 'new.repx'), roots, sys)).toEqual({ ok: false, reason: expect.stringMatching(/outside the folders.*forma_status/) });
    expect(fs.calls).toEqual([]);
  });

  it('refuses a new file under a junction that leads out of the root, and an existing link named as a report that leads to another kind', () => {
    const { at, sys, roots } = scene(path);
    expect(resolveWritePath(at('proj', 'link', 'new.repx'), roots, sys)).toEqual({ ok: false, reason: expect.stringMatching(/outside the folders/) });
    expect(resolveWritePath(at('proj', 'alias.repx'), roots, sys, { extensions: ['.repx'] })).toEqual({ ok: false, reason: expect.stringMatching(/leads to .*data\.json.*not a \.repx file/) });
  });

  it('never writes into .git, .claude, any dot-folder or node_modules, nor over a folder or a root', () => {
    const { at, sys, roots } = scene(path);
    const reason = (raw: string) => {
      const v = resolveWritePath(raw, roots, sys);
      return v.ok ? 'admitted' : v.reason;
    };
    expect(reason(at('proj', '.git', 'hooks', 'pre-commit.repx'))).toMatch(/inside ".git"/);
    expect(reason(at('proj', '.claude', 'settings.repx'))).toMatch(/inside ".claude"/);
    expect(reason(at('proj', '.vscode', 'x.repx'))).toMatch(/dot-folder/);
    expect(reason(at('proj', 'node_modules', 'x.repx'))).toMatch(/inside node_modules/);
    expect(reason(at('proj', 'sub'))).toMatch(/is a folder, not a file/);
    expect(reason(at('proj'))).toMatch(/is a folder this server may use/);
    expect(resolveWritePath(at('proj', 'out.pdf'), roots, sys, { extensions: ['.repx'] })).toEqual({ ok: false, reason: expect.stringMatching(/not a \.repx file/) });
  });
});

describe('the refusals that come before the file system', () => {
  it.each(['\\\\host\\share\\x.repx', '//host/share/x.repx', '/\\host\\share\\x.repx', '//g/DevFiles/forma/x.repx', '\\\\?\\G:\\x.repx', '\\\\.\\G:\\x.repx', 'C:\\elsewhere\\x.repx', '/g/proj/x.repx', 'G:\\proj\\x.repx:ads'])(
    'refuses %j for reading and writing without touching it',
    (raw) => {
      const fs = untouchable();
      const sys = { path: win32, fs };
      for (const verdict of [resolveReadPath(raw, [plainRoot('G:\\proj')], sys), resolveWritePath(raw, [plainRoot('G:\\proj')], sys)]) {
        expect(verdict).toEqual({ ok: false, reason: expect.stringMatching(/another computer|long form of a path on drive|outside the folders|Git Bash|stream/) });
        expect(verdict).not.toEqual({ ok: false, reason: expect.stringMatching(/could not be resolved/) });
      }
      expect(fs.calls).toEqual([]);
    },
  );
});

describe('describePath', () => {
  it('gives an example only for the platform the server runs on', () => {
    expect(describePath(win32, 'The report.')).toBe('The report. The full path, for example G:\\Reports\\invoice.repx. Not relative, not ~, not a Git Bash /g/... path.');
    expect(describePath(posix, 'The report.')).toMatch(/\/home\/me\/reports\/invoice\.repx\. Not relative, not ~\.$/);
  });
});

/**
 * The command line's mode (2026-11-24, the CLI and Forma Designer work's
 * wave 2, CLI-3 and SEC-4): a working folder in place of roots, a relative
 * path resolved against it, every other check the server's, in a person's
 * words. The scene, spelled for each platform: the folder the command runs
 * in, inside a dot-folder the person chose; a folder outside it; a junction
 * from one to the other; a file link outside it that leads back in; and a
 * credential, a big file and a dot-folder of its own. Since the wave-2
 * review (SEC-W2-2), another name for the working folder too, a link to it
 * (as a junction, a symlink, a subst drive or the shell's logical `$PWD`
 * names it), and a file link in it that leads out.
 */
function cliScene(path: PlatformPath) {
  const at = (...parts: string[]) => (path === win32 ? `G:\\${parts.join('\\')}` : `/srv/${parts.join('/')}`);
  const base = at('home', '.work', 'proj');
  const fs = fakeFs(path, {
    dirs: [at('home', '.work', 'proj', 'sub'), at('elsewhere'), at('home', '.cache')],
    files: {
      [at('home', '.work', 'proj', 'a.repx')]: 100,
      [at('home', '.work', 'proj', 'page.png')]: 100,
      [at('home', '.work', 'proj', 'big.png')]: 30_000_000,
      [at('home', '.work', 'proj', 'appsettings.json')]: 10,
      [at('home', '.work', 'proj', '.git', 'x.repx')]: 10,
      [at('elsewhere', 'scan.png')]: 100,
      [at('home', '.cache', 'x.repx')]: 10,
    },
    links: {
      [at('home', '.work', 'proj', 'link')]: at('elsewhere'),
      [at('elsewhere', 'back.repx')]: at('home', '.work', 'proj', 'a.repx'),
      [at('alias')]: at('home', '.work', 'proj'),
      [at('home', '.work', 'proj', 'leak.png')]: at('elsewhere', 'scan.png'),
    },
  });
  const scope: WorkingFolder = { base };
  return { at, base, fs, sys: { path, fs, home: at('home') }, scope };
}

/** A refusal speaks to a person: none of the words a host's model is told. */
const MODEL_WORDS = /\bsend\b|this server|forma_status|\ba tool\b/i;

describe.each([
  ['Windows', win32],
  ['POSIX', posix],
] as const)("the command line's working folder, %s rules", (_name, path) => {
  const sep = path.sep;
  const reason = (v: { ok: boolean; reason?: string }) => (v.ok ? 'admitted' : (v.reason as string));

  it('resolves a relative path against the working folder, once, then judges what it names as any path', () => {
    const { at, base, sys, scope } = cliScene(path);
    expect(voiceOf(scope)).toBe('cli');
    expect(voiceOf([])).toBe('mcp');
    expect(parsePath('a.repx', scope, sys)).toEqual({ ok: true, path: at('home', '.work', 'proj', 'a.repx') });
    expect(parsePath(`sub${sep}..${sep}a.repx`, scope, sys)).toEqual({ ok: true, path: at('home', '.work', 'proj', 'a.repx') });
    expect(resolveReadPath('a.repx', scope, sys, { extensions: ['.repx'] })).toEqual({ ok: true, path: at('home', '.work', 'proj', 'a.repx') });
    expect(resolveReadPath(`.${sep}page.png`, scope, sys)).toEqual({ ok: true, path: at('home', '.work', 'proj', 'page.png') });
    expect(resolveWritePath(`out${sep}deep${sep}new.repx`, scope, sys, { extensions: ['.repx'] })).toEqual({ ok: true, path: at('home', '.work', 'proj', 'out', 'deep', 'new.repx') });
    // A full path, and a relative one that leaves the working folder, name a file the person chose, wherever it is.
    expect(resolveReadPath(at('elsewhere', 'scan.png'), scope, sys)).toEqual({ ok: true, path: at('elsewhere', 'scan.png') });
    expect(resolveReadPath(`..${sep}..${sep}..${sep}elsewhere${sep}scan.png`, scope, sys)).toEqual({ ok: true, path: at('elsewhere', 'scan.png') });
    expect(base).toBe(at('home', '.work', 'proj'));
  });

  it('refuses a path named inside the working folder that a link leads out of, and a file link out of the folder it is named in', () => {
    const { at, sys, scope } = cliScene(path);
    expect(reason(resolveReadPath(`link${sep}scan.png`, scope, sys))).toMatch(/leads through a link to .*scan\.png", outside the folder the command is run in; Forma follows no link out of it\.$/);
    expect(reason(resolveWritePath(`link${sep}new.repx`, scope, sys))).toMatch(/outside the folder the command is run in/);
    expect(reason(resolveReadPath(at('elsewhere', 'back.repx'), scope, sys))).toMatch(/leads through a link to .*a\.repx", outside the folder it is named in/);
    expect(reason(resolveReadPath('leak.png', scope, sys))).toMatch(/leads through a link to .*scan\.png", outside the folder the command is run in; Forma follows no link out of it\.$/);
  });

  it('judges a path by where it really is, never by its spelling: through another name for the working folder, a link the folder holds is still refused (SEC-W2-2)', () => {
    const { at, sys, scope } = cliScene(path);
    const outOf = /outside the folder the command is run in; Forma follows no link out of it\.$/;
    // The working folder spelled as itself, a path spelled through the link to it: a directory link and a file link out are refused.
    expect(reason(resolveReadPath(at('alias', 'link', 'scan.png'), scope, sys))).toMatch(outOf);
    expect(reason(resolveWritePath(at('alias', 'link', 'new.repx'), scope, sys))).toMatch(outOf);
    expect(reason(resolveReadPath(at('alias', 'leak.png'), scope, sys))).toMatch(outOf);
    // The working folder given by the link to it, as a shell's logical $PWD or a subst drive names it: the same.
    const aliased: WorkingFolder = { base: at('alias') };
    expect(reason(resolveReadPath(`link${sep}scan.png`, aliased, sys))).toMatch(outOf);
    expect(reason(resolveReadPath(at('home', '.work', 'proj', 'link', 'scan.png'), aliased, sys))).toMatch(outOf);
    // What stays in it is read at its real place, whichever name reached it, and below it no dot-folder is looked for.
    expect(resolveReadPath(at('alias', 'a.repx'), scope, sys)).toEqual({ ok: true, path: at('home', '.work', 'proj', 'a.repx') });
    expect(resolveReadPath('page.png', aliased, sys)).toEqual({ ok: true, path: at('home', '.work', 'proj', 'page.png') });
    expect(resolveWritePath(at('alias', 'out', 'r.repx'), scope, sys)).toEqual({ ok: true, path: at('home', '.work', 'proj', 'out', 'r.repx') });
    // A link in a folder above the working folder, reached by .. from a subfolder, is not in the folder the command runs in:
    // followed, by design (paths.ts's header), as any directory link on the way to a folder elsewhere is.
    const below: WorkingFolder = { base: at('home', '.work', 'proj', 'sub') };
    expect(resolveReadPath(`..${sep}link${sep}scan.png`, below, sys)).toEqual({ ok: true, path: at('elsewhere', 'scan.png') });
  });

  it('looks for dot-folders below the working folder, or below the drive outside it, so only the folder the command runs in may be one', () => {
    const { at, sys, scope } = cliScene(path);
    // The working folder is inside .work, which the person chose: nothing below it is refused for that.
    expect(resolveReadPath('a.repx', scope, sys).ok).toBe(true);
    // In plain quotes, as a person copies a path (the CLI work's wave-4 review, U8), never JSON's escapes.
    expect(reason(resolveReadPath(`.git${sep}x.repx`, scope, sys))).toBe(`"${at('home', '.work', 'proj', '.git', 'x.repx')}" is inside ".git"; Forma never reads from a dot-folder or a dot-file; only the folder the command is run in may be one.`);
    expect(reason(resolveWritePath(`.claude${sep}x.repx`, scope, sys))).toMatch(/is inside "\.claude"; Forma never writes into a dot-folder/);
    expect(reason(resolveWritePath(`node_modules${sep}x.repx`, scope, sys))).toMatch(/is inside node_modules; Forma never writes there; only the folder the command is run in may be inside it\.$/);
    expect(reason(resolveReadPath(at('home', '.cache', 'x.repx'), scope, sys))).toMatch(/is inside "\.cache"/);
    expect(reason(resolveWritePath(at('home', '.cache', 'out.repx'), scope, sys))).toMatch(/is inside "\.cache"/);
  });

  it("refuses a credential, another kind, a file too large and a folder, in a person's words", () => {
    const { sys, scope } = cliScene(path);
    const said = [
      reason(resolveReadPath('appsettings.json', scope, sys)),
      reason(resolveReadPath('page.png', scope, sys, { extensions: ['.repx'] })),
      reason(resolveReadPath('big.png', scope, sys, { maxBytes: 20_000_000 })),
      reason(resolveReadPath('sub', scope, sys)),
      reason(resolveWritePath('sub', scope, sys)),
      reason(resolveReadPath('missing.png', scope, sys)),
    ];
    expect(said[0]).toMatch(/named as a file of credentials, which Forma never opens\.$/);
    expect(said[1]).toMatch(/is not a \.repx file/);
    expect(said[2]).toMatch(/30000000 bytes, more than the 20000000 Forma reads\.$/);
    expect(said[3]).toMatch(/is not a file/);
    expect(said[4]).toMatch(/is a folder, not a file/);
    expect(said[5]).toMatch(/There is no file at/);
    for (const s of said) expect(s).not.toMatch(MODEL_WORDS);
  });
});

describe("the command line's refusals before the file system, Windows rules", () => {
  it.each([
    ['\\\\host\\share\\x.repx', /another computer, which Forma never opens/],
    ['//host/share/x.repx', /another computer, which Forma never opens/],
    ['/\\host\\share\\x.repx', /another computer, which Forma never opens/],
    // A path in plain quotes, single backslashes, as a person copies it back to a shell (the wave-4 review's U8).
    ['//g/DevFiles/x.repx', /If you meant drive G:, give "G:\\DevFiles\\x\.repx"\.$/],
    ['\\\\?\\G:\\very\\long\\x.png', /^"\\\\\?\\G:\\very\\long\\x\.png" is the long form of a path on drive G:; give it as "G:\\very\\long\\x\.png"\.$/],
    ['\\\\.\\G:\\x.png', /long form of a path on drive G:; give it as "G:\\x\.png"/],
    ['/g/DevFiles/x.repx', /Git Bash or WSL path; give "G:\\DevFiles\\x\.repx"/],
    ['~\\x.repx', /starts with ~; give the full path of the home folder/],
    ['file:///G:/a/x.repx', /is a URL; give a path, "G:\\a\\x\.repx"/],
    ['x.repx:hidden', /has a ':', which names a hidden stream of a file; give a plain file path/],
    ['G:\\proj\\x.repx:ads', /after the drive letter/],
    ['G:x.repx', /relative to the current folder of drive G:; give the full path/],
    ['\\a\\x.repx', /root of whichever drive is current; give it with its drive letter/],
    ['"x.repx"', /in quotes; give the path without them/],
    [' x.repx', /space; give the path without it/],
    ['sub\\CON', /device \(CON\)/],
    ['sub\\nul.repx', /device \(NUL\)/],
    ['a?.repx', /does not allow/],
    ['sub. \\x.repx', /ending in a space or a dot/],
    ['', /^Give the path to the file\.$/],
  ])('refuses %j without touching the disk', (raw, words) => {
    const fs = untouchable();
    const sys = { path: win32, fs, home: 'C:\\Users\\me' };
    for (const verdict of [parsePath(raw, { base: 'G:\\proj' }, sys), resolveReadPath(raw, { base: 'G:\\proj' }, sys), resolveWritePath(raw, { base: 'G:\\proj' }, sys)]) {
      expect(verdict).toEqual({ ok: false, reason: expect.stringMatching(words) });
      expect(verdict.ok ? '' : verdict.reason).not.toMatch(MODEL_WORDS);
    }
    expect(fs.calls).toEqual([]);
  });

  it('refuses every path when the command runs in a folder on another computer, without touching the disk', () => {
    const fs = untouchable();
    const sys = { path: win32, fs };
    for (const raw of ['x.repx', 'G:\\proj\\x.repx']) {
      expect(resolveReadPath(raw, { base: '\\\\host\\share\\work' }, sys)).toEqual({ ok: false, reason: expect.stringMatching(/^Forma cannot use the folder the command is run in: "\\\\host\\share\\work" names a path on another computer, which Forma never opens\.$/) });
    }
    expect(fs.calls).toEqual([]);
  });

  it("refuses a link on the way to another computer, the working folder's own way included, never following it", () => {
    const fs = fakeFs(win32, {
      dirs: ['G:\\proj'],
      files: { 'G:\\proj\\a.repx': 1 },
      links: { 'G:\\proj\\uncl': '\\\\host\\share\\' },
    });
    const sys = { path: win32, fs };
    expect(resolveReadPath('uncl\\x.repx', { base: 'G:\\proj' }, sys)).toEqual({ ok: false, reason: expect.stringMatching(/goes through a link to another computer, which Forma never opens\.$/) });
    expect(resolveReadPath('G:\\proj\\a.repx', { base: 'G:\\proj\\uncl\\work' }, sys)).toEqual({ ok: false, reason: expect.stringMatching(/^Forma cannot use the folder the command is run in: .* goes through a link to another computer/) });
    expect(resolveReadPath('a.repx', { base: 'G:\\proj' }, sys)).toEqual({ ok: true, path: 'G:\\proj\\a.repx' });
    expect(fs.calls.filter((c) => c.startsWith('network'))).toEqual([]);
  });
});

describe("the command line's refusals before the file system, POSIX rules", () => {
  it.each([
    ['G:\\x.repx', /Windows path, and Forma is running on another system; give a path such as/],
    ['//host/x.repx', /two slashes; give it with one/],
    ['~/x.repx', /starts with ~; give the full path of the home folder, "\/home\/me\/x\.repx"/],
    ['file:///home/u/x.repx', /is a URL; give a path, "\/home\/u\/x\.repx"/],
    ['x.repx ', /space/],
  ])('refuses %j without touching the disk', (raw, words) => {
    const fs = untouchable();
    const sys = { path: posix, fs, home: '/home/me' };
    const verdict = resolveReadPath(raw, { base: '/srv/proj' }, sys);
    expect(verdict).toEqual({ ok: false, reason: expect.stringMatching(words) });
    expect(verdict.ok ? '' : verdict.reason).not.toMatch(MODEL_WORDS);
    expect(fs.calls).toEqual([]);
  });

  it('resolves a relative name against the working folder', () => {
    expect(parsePath('in/a.png', { base: '/srv/proj' }, { path: posix, fs: untouchable() })).toEqual({ ok: true, path: '/srv/proj/in/a.png' });
    expect(parsePath('../a.png', { base: '/srv/proj' }, { path: posix, fs: untouchable() })).toEqual({ ok: true, path: '/srv/a.png' });
  });
});

describe("the server's words are unchanged by the command line's mode", () => {
  it('still refuses a relative path, and names forma_status when a path is outside', () => {
    const fs = untouchable();
    expect(parsePath('x.repx', [plainRoot('G:\\proj')], { path: win32, fs })).toEqual({ ok: false, reason: expect.stringMatching(/not a full path; send the full path \(this server cannot see your shell's current folder\)/) });
    expect(resolveReadPath('C:\\x.repx', [plainRoot('G:\\proj')], { path: win32, fs })).toEqual({ ok: false, reason: expect.stringMatching(/outside the folders this server may use; forma_status lists them/) });
    expect(fs.calls).toEqual([]);
  });
});

const OWNER_WORK = resolve('..', 'forma-model-data-kept-not-in-git', 'forma-model-data', 'work');
const scratch = mkdtempSync(join(existsSync(OWNER_WORK) ? OWNER_WORK : tmpdir(), 'mcp-paths-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('on this computer', () => {
  it('refuses a real junction or symlink that leads out of the root, and opens the file inside', () => {
    const base = mkdtempSync(join(scratch, 'link-'));
    const root = join(base, 'root');
    const outside = join(base, 'outside');
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.repx'), 'x');
    writeFileSync(join(root, 'mine.repx'), 'x');
    symlinkSync(outside, join(root, 'link'), 'junction');
    const sys = { path: process.platform === 'win32' ? win32 : posix, fs: nodePathFs };
    const roots = [plainRoot(realpathSync.native(root))];
    expect(resolveReadPath(join(root, 'link', 'secret.repx'), roots, sys)).toEqual({ ok: false, reason: expect.stringMatching(/outside the folders/) });
    expect(resolveWritePath(join(root, 'link', 'new.repx'), roots, sys)).toEqual({ ok: false, reason: expect.stringMatching(/outside the folders/) });
    expect(resolveReadPath(join(root, 'mine.repx'), roots, sys)).toEqual({ ok: true, path: join(roots[0].real, 'mine.repx') });
  });

  it('admits paths spelled through a junction that a root was given as, reading and writing at the real place', () => {
    const base = realpathSync.native(mkdtempSync(join(scratch, 'jroot-')));
    const real = join(base, 'realroot');
    mkdirSync(real);
    writeFileSync(join(real, 'a.repx'), 'x');
    symlinkSync(real, join(base, 'jroot'), 'junction');
    const sys = { path: process.platform === 'win32' ? win32 : posix, fs: nodePathFs };
    const judged = checkRoot(join(base, 'jroot'), 'FORMA_MCP_ROOTS entry', sys);
    expect(judged).toEqual({ root: { path: join(base, 'jroot'), real } });
    const roots = 'root' in judged ? [judged.root] : [];
    expect(resolveReadPath(join(base, 'jroot', 'a.repx'), roots, sys)).toEqual({ ok: true, path: join(real, 'a.repx') });
    expect(resolveWritePath(join(base, 'jroot', 'new.repx'), roots, sys)).toEqual({ ok: true, path: join(real, 'new.repx') });
  });

  it('reads a hard link as the file it is: out of these checks\' scope, as paths.ts says', () => {
    const base = realpathSync.native(mkdtempSync(join(scratch, 'hard-')));
    mkdirSync(join(base, 'root'));
    mkdirSync(join(base, 'outside'));
    writeFileSync(join(base, 'outside', 'other.repx'), '<other/>');
    linkSync(join(base, 'outside', 'other.repx'), join(base, 'root', 'hl.repx'));
    const sys = { path: process.platform === 'win32' ? win32 : posix, fs: nodePathFs };
    expect(resolveReadPath(join(base, 'root', 'hl.repx'), [plainRoot(join(base, 'root'))], sys)).toEqual({ ok: true, path: join(base, 'root', 'hl.repx') });
  });

  it("reads a link's target as written without following it: a junction's folder, and a symlink's share", (ctx) => {
    const base = realpathSync.native(mkdtempSync(join(scratch, 'readlink-')));
    mkdirSync(join(base, 'real'));
    symlinkSync(join(base, 'real'), join(base, 'junc'), 'junction');
    expect(nodePathFs.readlink(join(base, 'junc'))).toBe(join(base, 'real'));
    expect(nodePathFs.readlink(join(base, 'real'))).toBeNull();
    expect(nodePathFs.readlink(join(base, 'missing'))).toBeNull();
    try {
      // The .invalid name never resolves; and nothing here goes through the link, only reads it.
      symlinkSync('//nohost.invalid/share/', join(base, 'unc'), 'dir');
    } catch (e) {
      if ((e as { code?: string }).code === 'EPERM') return ctx.skip();
      throw e;
    }
    expect(nodePathFs.readlink(join(base, 'unc'))).toMatch(/^[\\/]{2}nohost\.invalid[\\/]share[\\/]$/);
  });

  it("judges the command line's relative paths against a real working folder, and refuses a real junction out of it", () => {
    // CLI-3 and SEC-1: a directory link a checkout carries out of the folder the command runs in is never followed out.
    const base = realpathSync.native(mkdtempSync(join(scratch, 'cli-')));
    const work = join(base, 'work');
    const outside = join(base, 'outside');
    mkdirSync(work);
    mkdirSync(outside);
    writeFileSync(join(work, 'page.png'), 'x');
    writeFileSync(join(outside, 'secret.png'), 'x');
    symlinkSync(outside, join(work, 'link'), 'junction');
    const sys = nodeSystem();
    const scope: WorkingFolder = { base: work };
    expect(resolveReadPath('page.png', scope, sys)).toEqual({ ok: true, path: join(work, 'page.png') });
    expect(resolveReadPath(join('link', 'secret.png'), scope, sys)).toEqual({ ok: false, reason: expect.stringMatching(/outside the folder the command is run in; Forma follows no link out of it/) });
    expect(resolveWritePath(join('link', 'new.repx'), scope, sys)).toEqual({ ok: false, reason: expect.stringMatching(/outside the folder the command is run in/) });
    // The same file named by its own full path is the person's to name.
    expect(resolveReadPath(join(outside, 'secret.png'), scope, sys)).toEqual({ ok: true, path: join(outside, 'secret.png') });
    expect(resolveWritePath(join('out', 'r.repx'), scope, sys, { extensions: ['.repx'] })).toEqual({ ok: true, path: join(work, 'out', 'r.repx') });
    // SEC-W2-2, the review's probe on real links: the working folder reached through another link to it, its own link out still refused.
    const alias = join(base, 'work-alias');
    symlinkSync(work, alias, 'junction');
    expect(resolveReadPath(join(alias, 'link', 'secret.png'), scope, sys)).toEqual({ ok: false, reason: expect.stringMatching(/outside the folder the command is run in; Forma follows no link out of it/) });
    expect(resolveReadPath(join('link', 'secret.png'), { base: alias }, sys)).toEqual({ ok: false, reason: expect.stringMatching(/outside the folder the command is run in/) });
    expect(resolveReadPath(join(alias, 'page.png'), scope, sys)).toEqual({ ok: true, path: join(work, 'page.png') });
    // From a subfolder, a link in the folder above reached by .. is followed, by design (paths.ts's header).
    mkdirSync(join(work, 'sub'));
    expect(resolveReadPath(join('..', 'link', 'secret.png'), { base: join(work, 'sub') }, sys)).toEqual({ ok: true, path: join(outside, 'secret.png') });
  });
});

describe('writeOutput', () => {
  const sys = process.platform === 'win32' ? win32 : posix;
  const bytes = (s: string) => new TextEncoder().encode(s);

  it('writes a new file, answers a repeat with the same content as unchanged, and puts other content beside it', () => {
    const dir = mkdtempSync(join(scratch, 'write-'));
    const target = join(dir, 'new', 'out.repx');
    expect(writeOutput(target, bytes('one'), nodeWriteFs, sys)).toEqual({ path: target, status: 'written' });
    expect(writeOutput(target, bytes('one'), nodeWriteFs, sys)).toEqual({ path: target, status: 'unchanged' });
    expect(writeOutput(target, bytes('two'), nodeWriteFs, sys)).toEqual({ path: join(dir, 'new', 'out (2).repx'), status: 'beside' });
    expect(writeOutput(target, bytes('two'), nodeWriteFs, sys)).toEqual({ path: join(dir, 'new', 'out (2).repx'), status: 'unchanged' });
    expect(readFileSync(target, 'utf8')).toBe('one');
    expect(readdirSync(join(dir, 'new')).sort()).toEqual(['out (2).repx', 'out.repx']);
  });

  it('replaces only when asked, and leaves no partial file', () => {
    const dir = mkdtempSync(join(scratch, 'write-'));
    const target = join(dir, 'out.repx');
    writeFileSync(target, 'old');
    expect(writeOutput(target, bytes('new'), nodeWriteFs, sys, { ifExists: 'replace' })).toEqual({ path: target, status: 'replaced' });
    expect(readFileSync(target, 'utf8')).toBe('new');
    expect(writeOutput(join(dir, 'fresh.repx'), bytes('x'), nodeWriteFs, sys, { ifExists: 'replace' })).toEqual({ path: join(dir, 'fresh.repx'), status: 'written' });
    expect(readdirSync(dir).filter((n) => n.includes('forma-partial'))).toEqual([]);
  });

  /** A file system in memory whose link can be made to fail, for the cases a real disk will not stage on demand. */
  function memoryWrites(linkError?: string) {
    const files = new Map<string, Uint8Array>();
    const used: string[] = [];
    const exists = (code: string) => Object.assign(new Error(code), { code });
    const wfs: WriteFs = {
      mkdir: () => used.push('mkdir'),
      writeNew: (p, d) => {
        if (files.has(p)) throw exists('EEXIST');
        files.set(p, d);
      },
      link: (from, to) => {
        used.push('link');
        if (linkError) throw exists(linkError);
        if (files.has(to)) throw exists('EEXIST');
        files.set(to, files.get(from) as Uint8Array);
      },
      rename: () => {
        throw new Error('not used');
      },
      copyNew: (from, to) => {
        used.push('copy');
        if (files.has(to)) throw exists('EEXIST');
        files.set(to, files.get(from) as Uint8Array);
      },
      read: (p) => files.get(p) as Uint8Array,
      exists: (p) => files.has(p),
      unlink: (p) => files.delete(p),
    };
    return { files, used, wfs };
  }

  it('copies without replacing where hard links are not supported, as on FAT', () => {
    const { files, used, wfs } = memoryWrites('EPERM');
    files.set('/x/out.repx', bytes('other'));
    expect(writeOutput('/x/out.repx', bytes('mine'), wfs, posix, { random: () => 'r' })).toEqual({ path: '/x/out (2).repx', status: 'beside' });
    expect(used).toContain('copy');
    expect([...files.keys()].sort()).toEqual(['/x/out (2).repx', '/x/out.repx']);
  });

  it('passes on any other failure, and still removes its partial file', () => {
    const { files, wfs } = memoryWrites('EACCES');
    expect(() => writeOutput('/x/out.repx', bytes('mine'), wfs, posix, { random: () => 'r' })).toThrow('EACCES');
    expect([...files.keys()]).toEqual([]);
  });

  // The command line's modes (2026-11-24, the CLI and Forma Designer work's wave 2, CLI-6).
  it("refuses a taken name with other content, writing nothing and leaving no partial file, and finds the same bytes unchanged", () => {
    const dir = mkdtempSync(join(scratch, 'refuse-'));
    const target = join(dir, 'out.repx');
    expect(writeOutput(target, bytes('one'), nodeWriteFs, sys, { ifExists: 'refuse' })).toEqual({ path: target, status: 'written' });
    expect(writeOutput(target, bytes('one'), nodeWriteFs, sys, { ifExists: 'refuse' })).toEqual({ path: target, status: 'unchanged' });
    expect(writeOutput(target, bytes('two'), nodeWriteFs, sys, { ifExists: 'refuse' })).toEqual({ path: target, status: 'exists' });
    expect(readFileSync(target, 'utf8')).toBe('one');
    expect(readdirSync(dir)).toEqual(['out.repx']);
  });

  it('refuses, on disk, a file that appeared after its path was judged free and before the write: the check that counts is the one at the write', () => {
    const dir = realpathSync.native(mkdtempSync(join(scratch, 'race-')));
    const target = join(dir, 'out.repx');
    const pathSys = { path: sys, fs: nodePathFs };
    expect(resolveWritePath(target, { base: dir }, pathSys)).toEqual({ ok: true, path: target });
    writeFileSync(target, 'theirs');
    expect(writeOutput(target, bytes('ours'), nodeWriteFs, sys, { ifExists: 'refuse' })).toEqual({ path: target, status: 'exists' });
    expect(readFileSync(target, 'utf8')).toBe('theirs');
    expect(readdirSync(dir)).toEqual(['out.repx']);
  });

  /** A file system in memory where another writer's file lands at `target` once the partial file is written, between the check and the placing. */
  function raced(target: string, theirs: Uint8Array, linkError?: string) {
    const made = memoryWrites(linkError);
    const writeNew = made.wfs.writeNew;
    let renamed = false;
    made.wfs.writeNew = (p, d) => {
      writeNew(p, d);
      made.files.set(target, theirs);
    };
    made.wfs.rename = (from, to) => {
      renamed = true;
      made.files.set(to, made.files.get(from) as Uint8Array);
      made.files.delete(from);
    };
    return { ...made, renamed: () => renamed };
  }

  it.each([
    ['refuse', { path: '/x/out.repx', status: 'exists' }, 'theirs'],
    ['replace', { path: '/x/out.repx', status: 'replaced' }, 'ours'],
    ['beside', { path: '/x/out (2).repx', status: 'beside' }, 'theirs'],
  ] as const)('with %s, says what happened to a file that appeared between the check and the write', (ifExists, said, left) => {
    const { files, wfs } = raced('/x/out.repx', bytes('theirs'));
    expect(writeOutput('/x/out.repx', bytes('ours'), wfs, posix, { ifExists, random: () => 'r' })).toEqual(said);
    expect(new TextDecoder().decode(files.get('/x/out.repx'))).toBe(left);
    expect([...files.keys()].filter((k) => k.includes('forma-partial'))).toEqual([]);
  });

  it('replaces by a rename only when the name is taken, so a free name is written, and refuses through the copy where links are not supported', () => {
    const free = raced('/elsewhere/other.repx', bytes('unrelated'));
    expect(writeOutput('/x/out.repx', bytes('ours'), free.wfs, posix, { ifExists: 'replace', random: () => 'r' })).toEqual({ path: '/x/out.repx', status: 'written' });
    expect(free.renamed()).toBe(false);
    const fat = raced('/x/out.repx', bytes('theirs'), 'EPERM');
    expect(writeOutput('/x/out.repx', bytes('ours'), fat.wfs, posix, { ifExists: 'refuse', random: () => 'r' })).toEqual({ path: '/x/out.repx', status: 'exists' });
    expect(fat.used).toContain('copy');
    expect(new TextDecoder().decode(fat.files.get('/x/out.repx'))).toBe('theirs');
  });
});
