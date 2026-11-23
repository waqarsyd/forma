/**
 * A file system in memory, for the MCP server's tests only (nothing the
 * server runs imports it, which boundaries.test.ts holds): folders, files,
 * and links that a realpath follows (a junction on Windows is a link here),
 * spelled the way the platform spells them and matched case-insensitively on
 * Windows, as NTFS matches. It lets the Windows path rules run on CI's Linux
 * runners (finding TST-4).
 *
 * Every call follows the links in the folders above the path it names, as
 * lstat and readlink do, and never the last component itself. `calls`
 * records every call, so a test can show that a refused path never reached
 * the file system, and records `network <target>` whenever a call would have
 * gone through a link to another computer (a target starting with two
 * slashes), which Windows would have answered by opening an SMB connection.
 * `untouchable()` records every call too, and throws on each, so a test that
 * asserts its `calls` are empty holds even where the code under test catches
 * the throw (finding T1 of the wave-3 review).
 *
 * Pure ASCII.
 */
import type { PlatformPath } from 'node:path';
import type { PathFs } from './paths';

export interface FakeTree {
  dirs?: string[];
  files?: Record<string, number>;
  links?: Record<string, string>;
}

type Node = { kind: 'dir' | 'file' | 'link'; spelled: string; size: number; target?: string };

export function fakeFs(path: PlatformPath, tree: FakeTree): PathFs & { calls: string[] } {
  const win = path.sep === '\\';
  const key = (p: string) => (win ? p.toLowerCase() : p);
  const nodes = new Map<string, Node>();
  const add = (p: string, node: Omit<Node, 'spelled'>) => {
    let cur = path.dirname(p);
    while (!nodes.has(key(cur))) {
      nodes.set(key(cur), { kind: 'dir', spelled: cur, size: 0 });
      const up = path.dirname(cur);
      if (up === cur) break;
      cur = up;
    }
    nodes.set(key(p), { ...node, spelled: p });
  };
  for (const d of tree.dirs ?? []) add(d, { kind: 'dir', size: 0 });
  for (const [f, size] of Object.entries(tree.files ?? {})) add(f, { kind: 'file', size });
  for (const [l, target] of Object.entries(tree.links ?? {})) add(l, { kind: 'link', size: 0, target });
  const calls: string[] = [];
  const enoent = (p: string) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });

  /** Follows a link's target, recording a reach for another computer and failing it, as an unreachable share fails. */
  const follow = (target: string, depth: number) => {
    if (/^[\\/]{2}/.test(target)) {
      calls.push(`network ${target}`);
      throw enoent(target);
    }
    return realpath(path.resolve(target), depth + 1);
  };

  const realpath = (p: string, depth = 0): string => {
    if (depth > 20) throw enoent(p);
    const { root } = path.parse(p);
    let cur = nodes.get(key(root))?.spelled ?? root;
    for (const s of p.slice(root.length).split(path.sep).filter(Boolean)) {
      const node = nodes.get(key(path.join(cur, s)));
      if (!node) throw enoent(p);
      cur = node.kind === 'link' ? follow(node.target as string, depth) : node.spelled;
    }
    return cur;
  };

  /** The node at `p` with every link above it followed and `p` itself not, as lstat sees it. */
  const lnode = (p: string): Node | undefined => {
    if (path.parse(p).root === p) return nodes.get(key(p)) ?? { kind: 'dir', spelled: p, size: 0 };
    let parent: string;
    try {
      parent = realpath(path.dirname(p));
    } catch {
      return undefined;
    }
    return nodes.get(key(path.join(parent, path.basename(p))));
  };

  return {
    calls,
    lexists: (p) => {
      calls.push(`lexists ${p}`);
      return lnode(p) !== undefined;
    },
    readlink: (p) => {
      calls.push(`readlink ${p}`);
      const node = lnode(p);
      return node?.kind === 'link' ? (node.target as string) : null;
    },
    realpath: (p) => {
      calls.push(`realpath ${p}`);
      return realpath(p);
    },
    stat: (p) => {
      calls.push(`stat ${p}`);
      const node = nodes.get(key(realpath(p)));
      const kind = node?.kind ?? 'dir';
      return { isFile: () => kind === 'file', isDirectory: () => kind === 'dir', size: node?.size ?? 0 };
    },
  };
}

/** A file system that records every call and throws on each: a test asserts its `calls` stay empty. */
export function untouchable(): PathFs & { calls: string[] } {
  const calls: string[] = [];
  const refuse = (what: string, p: string): never => {
    calls.push(`${what} ${p}`);
    throw new Error(`the file system was asked to ${what} ${p}`);
  };
  return {
    calls,
    lexists: (p) => refuse('lexists', p),
    readlink: (p) => refuse('readlink', p),
    realpath: (p) => refuse('realpath', p),
    stat: (p) => refuse('stat', p),
  };
}
