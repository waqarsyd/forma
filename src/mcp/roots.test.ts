/**
 * Where the MCP server's folders come from (roots.ts): the two environment
 * variables and a client's list, judged by the same full-path rule as a tool
 * argument, under both platforms' rules (findings GAP2-4, GAP3-1, SEC-4),
 * each kept as spelled and as it really is, and refused when it holds the
 * home folder or is a dot-folder (PS-2, PS-3 and PS-4 of the wave-3 review).
 * The per-era asking is held through the server itself, in
 * formaServer.test.ts.
 */
import { posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import type { Root } from './paths';
import { checkRoot, createRootResolver, noRootMessage, readEnvRoots, rootsFromClient } from './roots';
import { fakeFs, untouchable } from './testFs';

const winSys = () => ({
  path: win32,
  home: 'C:\\Users\\me',
  fs: fakeFs(win32, {
    dirs: ['G:\\a', 'G:\\b', 'C:\\Users\\me', 'C:\\Users\\dev\\My Reports', 'G:\\c\\Users\\x', 'G:\\repo\\.git\\hooks', 'G:\\repo\\.claude\\worktrees\\fix', 'G:\\repo\\node_modules\\pkg'],
    files: { 'G:\\a\\file.repx': 1 },
    links: { 'G:\\ja': 'G:\\a', 'G:\\jgit': 'G:\\repo\\.git' },
  }),
});
const posixSys = () => ({ path: posix, home: '/home/me', fs: fakeFs(posix, { dirs: ['/srv/a', '/srv/b', '/home/me/.ssh/keys', '/home/me/proj'] }) });
/** A root whose spelling is already its real path. */
const plain = (p: string): Root => ({ path: p, real: p });

describe('readEnvRoots', () => {
  it("reads FORMA_MCP_ROOTS with the platform's delimiter, skipping an empty entry and a repeat, and keeps each as spelled and as it is", () => {
    expect(readEnvRoots({ FORMA_MCP_ROOTS: 'G:\\a;g:\\B;G:\\a\\;' }, winSys())).toEqual({ forma: { roots: [plain('G:\\a'), { path: 'g:\\B', real: 'G:\\b' }], problems: [] } });
    expect(readEnvRoots({ FORMA_MCP_ROOTS: '/srv/a:/srv/b' }, posixSys())).toEqual({ forma: { roots: [plain('/srv/a'), plain('/srv/b')], problems: [] } });
  });

  it('keeps a root reached through a junction under both names, and a second spelling of the same folder beside it', () => {
    expect(readEnvRoots({ FORMA_MCP_ROOTS: 'G:\\ja;G:\\a' }, winSys())).toEqual({ forma: { roots: [{ path: 'G:\\ja', real: 'G:\\a' }, plain('G:\\a')], problems: [] } });
  });

  it('reads CLAUDE_PROJECT_DIR as one folder, and leaves out a variable that is unset or blank', () => {
    expect(readEnvRoots({ CLAUDE_PROJECT_DIR: 'G:\\a' }, winSys())).toEqual({ claude: { roots: [plain('G:\\a')], problems: [] } });
    expect(readEnvRoots({ FORMA_MCP_ROOTS: '  ', CLAUDE_PROJECT_DIR: '' }, winSys())).toEqual({});
    expect(readEnvRoots({ FORMA_MCP_ROOTS: ';' }, winSys())).toEqual({ forma: { roots: [], problems: ['FORMA_MCP_ROOTS is set but names no folder.'] } });
  });

  it('names the entry and its fix for a Git Bash path, a relative one, and a variable left unexpanded', () => {
    const { forma } = readEnvRoots({ FORMA_MCP_ROOTS: 'G:\\a;/g/DevFiles/forma;.;${CLAUDE_PROJECT_DIR:-.};%USERPROFILE%' }, winSys());
    expect(forma?.roots).toEqual([plain('G:\\a')]);
    expect(forma?.problems).toEqual([
      'FORMA_MCP_ROOTS entry: "/g/DevFiles/forma" is a Git Bash or WSL path; write "G:\\\\DevFiles\\\\forma".',
      'FORMA_MCP_ROOTS entry "." is not a full path; write the folder\'s full path. In Claude Code, leave FORMA_MCP_ROOTS unset: the server reads CLAUDE_PROJECT_DIR itself.',
      'FORMA_MCP_ROOTS entry "${CLAUDE_PROJECT_DIR:-.}" is a variable the host did not expand; write the folder\'s full path.',
      'FORMA_MCP_ROOTS entry "%USERPROFILE%" is a variable the host did not expand; write the folder\'s full path.',
    ]);
  });

  it('refuses a Git Bash root before the file system, even where its misreading exists as a folder', () => {
    // On Windows /c/Users/x resolves onto the current drive, and G:\c\Users\x exists in this scene.
    const fs = untouchable();
    expect(checkRoot('/c/Users/x', 'FORMA_MCP_ROOTS entry', { path: win32, fs })).toEqual({ problem: expect.stringContaining('"C:\\\\Users\\\\x"') });
    expect(fs.calls).toEqual([]);
  });

  const winProblem = (raw: string) => {
    const v = checkRoot(raw, 'CLAUDE_PROJECT_DIR', winSys());
    return 'problem' in v ? v.problem : v.root;
  };
  const posixProblem = (raw: string) => {
    const v = checkRoot(raw, 'CLAUDE_PROJECT_DIR', posixSys());
    return 'problem' in v ? v.problem : v.root;
  };

  it('refuses a whole drive, the whole home folder, a folder that is not there and a file', () => {
    expect(winProblem('G:\\')).toMatch(/is a whole drive/);
    expect(winProblem('c:\\users\\ME')).toMatch(/is the whole home folder/);
    expect(winProblem('G:\\missing')).toMatch(/does not exist/);
    expect(winProblem('G:\\a\\file.repx')).toMatch(/is not a folder/);
    expect(posixProblem('/')).toMatch(/is a whole drive/);
    expect(posixProblem('/home/me')).toMatch(/is the whole home folder/);
  });

  it("refuses a folder that holds the home folder, every profile's or its parent's", () => {
    expect(winProblem('C:\\Users')).toMatch(/"C:\\\\Users" holds the whole home folder/);
    expect(winProblem('c:\\users')).toMatch(/holds the whole home folder/);
    expect(posixProblem('/home')).toMatch(/"\/home" holds the whole home folder/);
    expect(winProblem('C:\\Users\\dev\\My Reports')).toEqual(plain('C:\\Users\\dev\\My Reports'));
    expect(posixProblem('/home/me/proj')).toEqual(plain('/home/me/proj'));
  });

  it('refuses a dot-folder as a root, and any folder inside .git, .ssh or node_modules, whatever leads there', () => {
    expect(winProblem('G:\\repo\\.git')).toMatch(/is the folder "\.git", which tools never use/);
    expect(winProblem('G:\\repo\\.git\\hooks')).toMatch(/is inside "\.git"/);
    expect(winProblem('G:\\jgit')).toMatch(/is the folder "\.git"/);
    expect(winProblem('G:\\repo\\.claude')).toMatch(/is the dot-folder "\.claude"/);
    expect(winProblem('G:\\repo\\node_modules\\pkg')).toMatch(/is inside "node_modules"/);
    expect(posixProblem('/home/me/.ssh')).toMatch(/is the folder "\.ssh"/);
    expect(posixProblem('/home/me/.ssh/keys')).toMatch(/is inside "\.ssh"/);
  });

  it('accepts a Claude Code worktree under .claude/worktrees, whose own dot-folders stay refused below it', () => {
    expect(winProblem('G:\\repo\\.claude\\worktrees\\fix')).toEqual(plain('G:\\repo\\.claude\\worktrees\\fix'));
  });
});

describe('rootsFromClient', () => {
  it("converts a Windows client's file: URI with fileURLToPath, never by slicing it", () => {
    expect(rootsFromClient([{ uri: 'file:///c%3A/Users/dev/My%20Reports', name: 'Reports' }], winSys())).toEqual({ roots: [{ path: 'c:\\Users\\dev\\My Reports', real: 'C:\\Users\\dev\\My Reports' }], problems: [] });
    expect(rootsFromClient([{ uri: 'file:///srv/a' }], posixSys())).toEqual({ roots: [plain('/srv/a')], problems: [] });
  });

  it("refuses a client's root that holds the home folder or is a repository's .git, as from the environment", () => {
    const { roots, problems } = rootsFromClient([{ uri: 'file:///C:/Users' }, { uri: 'file:///G:/repo/.git' }, { uri: 'file:///G:/a' }], winSys());
    expect(roots).toEqual([plain('G:\\a')]);
    expect(problems).toEqual([expect.stringMatching(/holds the whole home folder/), expect.stringMatching(/is the folder "\.git"/)]);
  });

  it('skips what is not a file: URI, a root on another computer, and a list that is not one, saying so', () => {
    const { roots, problems } = rootsFromClient([{ uri: 'https://example.com/a' }, { name: 'no uri' }, null, { uri: 'file://server/share/x' }, { uri: 'file:///G:/a' }], winSys());
    expect(roots).toEqual([plain('G:\\a')]);
    expect(problems).toEqual([
      'The client\'s root "https://example.com/a" is not a file: URI; it was skipped.',
      'A root the client listed has no URI; it was skipped.',
      'A root the client listed has no URI; it was skipped.',
      expect.stringMatching(/^The client's root "file:\/\/server\/share\/x", as the path: .* another computer/),
    ]);
    expect(rootsFromClient({ roots: [] }, winSys())).toEqual({ roots: [], problems: ["The client's list of roots was not a list."] });
    expect(rootsFromClient([{ uri: 'file://server/share' }], posixSys()).problems[0]).toMatch(/not a file path this computer can open/);
  });
});

describe('createRootResolver on a 2025-era connection', () => {
  /** A server whose client declared roots and never answers roots/list. */
  function silentClient() {
    const listed: number[] = [];
    const server = {
      server: {
        setNotificationHandler: () => undefined,
        getClientCapabilities: () => ({ roots: {} }),
        listRoots: () => {
          listed.push(1);
          return new Promise(() => undefined);
        },
      },
    } as unknown as McpServer;
    return { listed, resolve: createRootResolver(server, {}, posixSys(), { timeoutMs: 60_000 }) };
  }
  const ctxWith = (signal: AbortSignal) => ({ mcpReq: { signal } }) as unknown as ServerContext;

  it('stops waiting when its call is cancelled, while the one request goes on for the others', async () => {
    const { listed, resolve } = silentClient();
    const cancelled = new AbortController();
    const first = resolve(ctxWith(cancelled.signal), 'legacy');
    const second = resolve(ctxWith(new AbortController().signal), 'legacy');
    cancelled.abort(new Error('cancelled by the client'));
    await expect(first).rejects.toThrow('cancelled by the client');
    expect(listed).toHaveLength(1);
    const settled = await Promise.race([second.then(() => 'settled'), new Promise((done) => setTimeout(() => done('still waiting'), 50))]);
    expect(settled).toBe('still waiting');
  });
});

describe('noRootMessage', () => {
  it("names each host's recipe, with the platform's delimiter, under 2,000 characters", () => {
    const win = noRootMessage(winSys());
    expect(win).toMatch(/FORMA_MCP_ROOTS.*separated by ';'/);
    expect(win).toMatch(/CLAUDE_PROJECT_DIR/);
    expect(win).toMatch(/Visual Studio 2022: in <solution folder>\\\.vs\\mcp\.json/);
    expect(win).toMatch(/VS Code: in ~\/\.copilot\/mcp-config\.json/);
    expect(win).toMatch(/Claude Desktop: in claude_desktop_config\.json/);
    expect(win.length).toBeLessThan(2000);
    const other = noRootMessage(posixSys());
    expect(other).toMatch(/separated by ':'/);
    expect(other).not.toMatch(/Visual Studio/);
  });
});
