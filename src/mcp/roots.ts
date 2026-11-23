/**
 * The folders an MCP tool may read and write, and where they came from
 * (2026-11-24, the MCP work's wave 3; findings GAP3-1, GAP3-2, GAP2-4 and
 * SEC-4 of the 2026-11-23 design audit).
 *
 * In this order, the first that answers wins:
 *
 *   1. FORMA_MCP_ROOTS, set in the server's entry in the host: full paths,
 *      separated by the platform's delimiter (';' on Windows, ':'
 *      elsewhere). While it is set it is the only source, so a mistake in it
 *      refuses every file tool with words naming the entry, rather than
 *      falling through to a folder nobody chose.
 *   2. The client's roots, when the client declared the roots capability:
 *      Claude Code answers with its launch folder and every --add-dir
 *      folder, and other hosts may answer with the open solution. Asked for
 *      differently in each era (below), and never fatal: a client that
 *      declares roots and then fails to list them only moves this on to 3.
 *   3. CLAUDE_PROJECT_DIR, which Claude Code sets for the servers it starts.
 *   4. None: every file tool refuses, and the message names each host's
 *      recipe (`noRootMessage`).
 *
 * Asking the client is gated by hand, because the SDK does not gate it the
 * same way in both eras (measured in the audit, GAP3-2). On a 2025-era
 * connection the SDK would send roots/list to a client that never declared
 * roots, and a silent client then holds the call for the SDK's 60-second
 * default; so `listRoots` is called only when the initialize capabilities
 * name roots, with a 5-second timeout, and its answer (or its failure) is
 * kept for the connection until the client says the list changed. On a
 * 2026-07-28 request, asking without the capability fails the whole call
 * (-32021), and `getClientCapabilities()` is undefined there, so the
 * request's own envelope is read; the ask is an `input_required` result the
 * client fulfils and retries, never the legacy shim. Which of the two applies
 * is the connection's era (`eraOf` in toolShape.ts), never the request's: a
 * 2025-era request that carries the 2026-07-28 envelope keys is answered as
 * 2025-era, and its envelope is not read.
 *
 * Every root, whatever its source, goes through the same full-path test as a
 * tool argument (paths.ts) before any file-system call, then
 * `realpathSync.native`, and is kept both as spelled and as it really is
 * (`Root`, finding PS-2 of the wave-3 review). Refused, on the real path: a
 * whole drive; the whole home folder or any folder that holds it, such as
 * C:\Users or /home (PS-3); a dot-folder itself, such as .git, .claude or
 * ~/.ssh, and any folder inside .git, .ssh, .gnupg or node_modules (PS-4),
 * because the rule that keeps tools out of dot-folders (paths.ts) only looks
 * below a root. A folder further inside some other dot-folder is accepted, so
 * a Claude Code worktree under .claude/worktrees stays usable; its own .git
 * and .claude are still refused below it. A client's root is converted from
 * its file: URI with `url.fileURLToPath`, never by slicing the string.
 *
 * Pure ASCII.
 */
import { CLIENT_CAPABILITIES_META_KEY, inputRequired, inputResponse, type InputRequiredResult, type McpServer, type ServerContext } from '@modelcontextprotocol/server';
import { fileUrlToPath, isInside, parseToolPath, type PathSystem, type Root } from './paths';

/** Which protocol era the connection negotiated: 2026-07-28, or a 2025-era revision through initialize (`eraOf` in toolShape.ts). */
export type Era = 'modern' | 'legacy';

/** Where the folders in effect came from. */
export type RootSource = 'FORMA_MCP_ROOTS' | 'client' | 'CLAUDE_PROJECT_DIR';

/** Folders that passed, and the words for each that did not. */
export interface RootList {
  roots: Root[];
  problems: string[];
}

/** The two environment variables, read once at start-up; a field is absent when its variable is unset or blank. */
export interface EnvRoots {
  forma?: RootList;
  claude?: RootList;
}

/** What a tool learns about its folders: the list, why there is none, or a question for the client first. */
export type RootsOutcome =
  | { kind: 'roots'; source: RootSource; roots: Root[]; notes: string[] }
  | { kind: 'none'; why: string; notes: string[] }
  | { kind: 'ask'; result: InputRequiredResult };

const shown = (raw: string) => JSON.stringify(raw.length > 200 ? `${raw.slice(0, 200)}...` : raw);

/** Folders a root may never be inside, wherever they are: a repository's internals, keys, packages. */
const NEVER_INSIDE = ['.git', '.ssh', '.gnupg', 'node_modules'];

/**
 * One root, judged: the folder as spelled and as it really is, or why it
 * cannot be one. `label` names where it came from, so the words point at
 * what to fix.
 */
export function checkRoot(raw: string, label: string, sys: PathSystem): { root: Root } | { problem: string } {
  const { path, fs } = sys;
  if (/^\.{1,2}([\\/]|$)/.test(raw)) {
    const advice = label.startsWith('FORMA_MCP_ROOTS') ? ' In Claude Code, leave FORMA_MCP_ROOTS unset: the server reads CLAUDE_PROJECT_DIR itself.' : '';
    return { problem: `${label} ${shown(raw)} is not a full path; write the folder's full path.${advice}` };
  }
  if (/\$\{[^}]*\}|^\$[A-Za-z_]|%[A-Za-z_]+%/.test(raw)) {
    return { problem: `${label} ${shown(raw)} is a variable the host did not expand; write the folder's full path.` };
  }
  const parsed = parseToolPath(raw, path, sys.home);
  if (!parsed.ok) return { problem: `${label}: ${parsed.reason.replace(/\bsend\b/g, 'write')}` };
  let real: string;
  try {
    real = fs.realpath(parsed.path);
  } catch {
    return { problem: `${label} ${shown(raw)} does not exist on this computer.` };
  }
  if (!fs.stat(real).isDirectory()) return { problem: `${label} ${shown(raw)} is not a folder.` };
  const { root: drive } = path.parse(real);
  if (drive === real) return { problem: `${label} ${shown(raw)} is a whole drive; name a project's folder.` };
  if (sys.home) {
    let home = sys.home;
    try {
      home = fs.realpath(sys.home);
    } catch {
      /* compared as written */
    }
    if (isInside(home, real, path)) return { problem: `${label} ${shown(raw)} ${path.relative(real, home) === '' ? 'is' : 'holds'} the whole home folder; name a project's folder.` };
  }
  const segments = real.slice(drive.length).split(path.sep).filter(Boolean);
  const same = (s: string) => (path.sep === '\\' ? s.toLowerCase() : s);
  const own = segments[segments.length - 1];
  const at = segments.findIndex((s) => NEVER_INSIDE.includes(same(s)));
  if (at !== -1) return { problem: `${label} ${shown(raw)} is ${at === segments.length - 1 ? 'the folder' : 'inside'} ${shown(segments[at])}, which tools never use; name a project's folder.` };
  if (own.startsWith('.')) return { problem: `${label} ${shown(raw)} is the dot-folder ${shown(own)}, which tools never use; name a project's folder.` };
  return { root: { path: parsed.path, real } };
}

function collect(entries: { raw: string; label: string }[], sys: PathSystem): RootList {
  const out: RootList = { roots: [], problems: [] };
  const same = (a: string, b: string) => sys.path.relative(a, b) === '';
  for (const { raw, label } of entries) {
    const verdict = checkRoot(raw, label, sys);
    if ('problem' in verdict) out.problems.push(verdict.problem);
    else if (!out.roots.some((r) => same(r.path, verdict.root.path) && same(r.real, verdict.root.real))) out.roots.push(verdict.root);
  }
  return out;
}

/** One line for each root whose spelling leads somewhere else, so a person sees both. */
function linkNotes(roots: readonly Root[], sys: PathSystem): string[] {
  return roots.filter((r) => sys.path.relative(r.path, r.real) !== '').map((r) => `${shown(r.path)} is ${shown(r.real)} once links are followed; a path under either is used.`);
}

/** The roots the two environment variables name, judged once when the server starts. */
export function readEnvRoots(env: { FORMA_MCP_ROOTS?: string; CLAUDE_PROJECT_DIR?: string }, sys: PathSystem): EnvRoots {
  const out: EnvRoots = {};
  const forma = env.FORMA_MCP_ROOTS;
  if (forma !== undefined && forma.trim() !== '') {
    const entries = forma.split(sys.path.delimiter).filter((e) => e !== '');
    out.forma = entries.length ? collect(entries.map((raw) => ({ raw, label: 'FORMA_MCP_ROOTS entry' })), sys) : { roots: [], problems: ['FORMA_MCP_ROOTS is set but names no folder.'] };
  }
  const claude = env.CLAUDE_PROJECT_DIR;
  if (claude !== undefined && claude.trim() !== '') out.claude = collect([{ raw: claude, label: 'CLAUDE_PROJECT_DIR' }], sys);
  return out;
}

/** The roots a client listed (untrusted): file: URIs only, each judged as a root from the environment is. */
export function rootsFromClient(list: unknown, sys: PathSystem): RootList {
  if (!Array.isArray(list)) return { roots: [], problems: ["The client's list of roots was not a list."] };
  const entries: { raw: string; label: string }[] = [];
  const problems: string[] = [];
  for (const item of list) {
    const uri = (item as { uri?: unknown } | null)?.uri;
    if (typeof uri !== 'string') {
      problems.push("A root the client listed has no URI; it was skipped.");
      continue;
    }
    if (!/^file:/i.test(uri)) {
      problems.push(`The client's root ${shown(uri)} is not a file: URI; it was skipped.`);
      continue;
    }
    try {
      entries.push({ raw: fileUrlToPath(uri, sys.path), label: `The client's root ${shown(uri)}, as the path` });
    } catch {
      problems.push(`The client's root ${shown(uri)} is not a file path this computer can open; it was skipped.`);
    }
  }
  const judged = collect(entries, sys);
  return { roots: judged.roots, problems: [...problems, ...judged.problems] };
}

/** Why there is no folder, and how each host sets one. Under 2,000 characters, as every refusal. */
export function noRootMessage(sys: PathSystem): string {
  const win = sys.path.sep === '\\';
  const several = win ? "separated by ';'" : "separated by ':'";
  return [
    'No folder is set for this server to read or write.',
    `Set FORMA_MCP_ROOTS in the server's entry in your host to a folder's full path (several ${several}).`,
    'Claude Code sets CLAUDE_PROJECT_DIR for the server when it runs in your project, or add --env FORMA_MCP_ROOTS=<full path> to claude mcp add.',
    win ? 'Visual Studio 2022: in <solution folder>\\.vs\\mcp.json, which stays out of source control.' : '',
    'VS Code: in ~/.copilot/mcp-config.json.',
    "Claude Desktop: in claude_desktop_config.json, under the server's env.",
    'A whole drive, the home folder or a folder holding it, and a dot-folder such as .git are refused.',
  ].filter(Boolean).join(' ');
}

/** True when the request's own 2026-07-28 envelope declares the roots capability. */
function envelopeDeclaresRoots(ctx: ServerContext): boolean {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  const caps = envelope?.[CLIENT_CAPABILITIES_META_KEY] as { roots?: unknown } | undefined;
  return caps?.roots !== undefined && caps.roots !== null;
}

const plain = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 160);

/** Waits for `answer`, or stops waiting when `signal` aborts; the answer itself goes on for whoever else waits on it. */
function untilAborted<T>(answer: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    answer.then(
      (value) => {
        signal.removeEventListener('abort', stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', stop);
        reject(error);
      },
    );
  });
}

/**
 * The function every file tool asks for its folders, made once per server
 * instance (one per connection), so a 2025-era connection's answer is kept
 * for that connection only.
 *
 * On a 2025-era connection the request itself is kept, not only its answer
 * (finding PS-10 of the wave-3 review): Claude Code runs read-only tools in
 * parallel, and each call that started before the first roots/list settled
 * would otherwise send its own and wait its own timeout. Each call waits on
 * the one request with its own signal, so a cancelled call stops waiting
 * while the request goes on for the others; the request is bounded by the
 * timeout whoever waits.
 */
export function createRootResolver(server: McpServer, envRoots: EnvRoots, sys: PathSystem, options: { timeoutMs?: number } = {}): (ctx: ServerContext, era: Era) => Promise<RootsOutcome> {
  const timeout = options.timeoutMs ?? 5000;
  let legacy: Promise<RootList> | undefined;
  server.server.setNotificationHandler('notifications/roots/list_changed', () => {
    legacy = undefined;
  });

  const legacyRoots = async (signal: AbortSignal): Promise<RootList | undefined> => {
    // getClientCapabilities is the initialize-scoped answer, which is what a 2025-era connection has.
    if (!server.server.getClientCapabilities()?.roots) return undefined;
    legacy ??= server.server.listRoots(undefined, { timeout }).then(
      (answer) => rootsFromClient(answer.roots, sys),
      (e: unknown): RootList => ({ roots: [], problems: [`The client declared roots but did not list them (${plain(e)}).`] }),
    );
    return untilAborted(legacy, signal);
  };

  const modernRoots = (ctx: ServerContext): RootList | 'ask' | undefined => {
    if (!envelopeDeclaresRoots(ctx)) return undefined;
    const view = inputResponse(ctx.mcpReq.inputResponses, 'roots');
    if (view.kind === 'roots') return rootsFromClient(view.roots, sys);
    // A retry that came back without the list is answered, never asked again: no loop.
    if (ctx.mcpReq.inputResponses !== undefined || ctx.mcpReq.droppedInputResponseKeys?.length) {
      return { roots: [], problems: ['The client was asked for its roots and did not list them.'] };
    }
    return 'ask';
  };

  return async (ctx, era) => {
    const notes: string[] = [];
    const found = (source: RootSource, roots: Root[]): RootsOutcome => ({ kind: 'roots', source, roots, notes: [...notes, ...linkNotes(roots, sys)] });
    const fromEnv = (list: RootList, source: RootSource, fix: string): RootsOutcome =>
      list.problems.length ? { kind: 'none', why: `${list.problems.join(' ')} ${fix}`, notes } : found(source, list.roots);

    if (envRoots.forma) return fromEnv(envRoots.forma, 'FORMA_MCP_ROOTS', "Fix FORMA_MCP_ROOTS in this server's entry in your host; while it is set, it is the only source of folders.");

    // The era is the connection's; a 2025-era request's envelope is never read (PS-1).
    const client = era === 'legacy' ? await legacyRoots(ctx.mcpReq.signal) : modernRoots(ctx);
    if (client === 'ask') return { kind: 'ask', result: inputRequired({ inputRequests: { roots: inputRequired.listRoots() } }) };
    if (client) {
      notes.push(...client.problems);
      if (client.roots.length) return found('client', client.roots);
    }

    if (envRoots.claude) return fromEnv(envRoots.claude, 'CLAUDE_PROJECT_DIR', 'Start Claude Code in the project folder, or set FORMA_MCP_ROOTS.');
    return { kind: 'none', why: noRootMessage(sys), notes };
  };
}
