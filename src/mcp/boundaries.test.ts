/**
 * The boundaries Forma's MCP server rests on, held by reading the sources
 * (2026-11-24, the MCP work's wave 3; findings TST-5, PROTO-10, SEC-9 and
 * SEC-12, and T2, T4, T7 and PS-7 of the wave-3 review). No test held
 * src/server apart before this one, so it covers that folder's half of the
 * rule too.
 *
 * - src/mcp is Node only: nothing outside it imports it (tests aside), as
 *   nothing but server.ts imports src/server, and only src/mcp and
 *   src/server import a Node built-in, so none can reach the browser
 *   bundle, where Vite would replace it with a stub that fails only at run
 *   time. Only test files import testFs.ts, the tests' file system.
 * - src/mcp reaches no browser-only module through any import it makes,
 *   static or lazy, however deep the walk goes: not the OCR and PDF worker
 *   modules (handwriting.ts, paddle.ts, paddleWorker.ts, pdf.ts), not a
 *   `?url` or `?worker` import, not `new Worker(new URL(...))`, not the
 *   components or the app's entries. A lazy import whose specifier is not a
 *   string literal is refused there, because no walk can follow it.
 * - Nothing src/mcp reaches writes to stdout behind the guard's back: no
 *   write to descriptor 1, no child that inherits stdout (stdio inherited,
 *   descriptor 1 or process.stdout handed over, or a fork, which inherits by
 *   default), no use of stdout's descriptor or its end. The guard cannot
 *   catch those (stdoutGuard.ts says why).
 * - The entry's order (stdio.ts): the stdout guard is its only static
 *   import and is installed before its first lazy import; the guard imports
 *   only Node built-ins and problemReport, which imports nothing; the
 *   launcher, run.mjs, loads only tsx's loader and the entry.
 * - Never the v1 SDK, @modelcontextprotocol/sdk: it is in the tree (through
 *   firebase-tools and @google/genai) and would resolve silently, speaking
 *   only the 2025 protocol.
 * - Stdio only, no port: src/mcp opens no listener of any kind, which is
 *   what makes it the user's own program rather than a server (PRD section 6).
 * - Only src/mcp may read a key from the environment, and within it only
 *   the entry touches the environment at all; it never loads dotenv.
 *   Outside it, the reads that exist are named below with their reasons, so
 *   a new one fails here until someone decides it belongs.
 *
 * The sources are read with regular expressions over the raw text, and the
 * first two cases of each reader show the shapes it finds. A comment can
 * make a check fail (reword the comment). What they cannot see: a specifier
 * or a variable name built at run time outside a lazy import (a computed
 * `require`, an environment object handed to a function and read there).
 * The readers find the shapes this codebase writes; they are not a parser.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CLONE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (abs: string) => relative(CLONE, abs).split(sep).join('/');
const isTest = (p: string) => /\.test\.(ts|tsx|mjs|js)$/.test(p);
const CODE = /\.(ts|tsx|mts|cts|mjs|js|cjs)$/;

function filesUnder(dir: string): string[] {
  return (readdirSync(join(CLONE, dir), { recursive: true }) as string[])
    .map((p) => join(CLONE, dir, p))
    .filter((p) => CODE.test(p) && !p.endsWith('.d.ts') && !p.includes(`${sep}node_modules${sep}`));
}

const SRC = filesUnder('src');
const SCRIPTS = filesUnder('scripts');
const ROOT = ['server.ts', 'vite.config.ts', 'vitest.config.ts', 'vitest.rules.config.ts'].map((f) => join(CLONE, f)).filter(existsSync);
const inMcp = (abs: string) => rel(abs).startsWith('src/mcp/');
const inServer = (abs: string) => rel(abs).startsWith('src/server/');
const text = (abs: string) => readFileSync(abs, 'utf8');
/** The source without its comments, for the checks of order (never for the import readers, which must see everything). */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

/** A comment allowed between `import(` and its specifier, as `/* @vite-ignore *\/` is written in this codebase. */
const COMMENTS = String.raw`(?:\/\*[\s\S]*?\*\/\s*)*`;
const STATIC_SPECIFIERS = [
  /\bimport\s+(?:type\s+)?[\w*{}\s,$]+?\s+from\s*['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
];
const SPECIFIERS = [...STATIC_SPECIFIERS, new RegExp(String.raw`\bimport\(\s*${COMMENTS}['"\`]([^'"\`]+)['"\`]\s*\)`, 'g'), new RegExp(String.raw`\brequire\(\s*${COMMENTS}['"]([^'"]+)['"]\s*\)`, 'g')];

/** Every module specifier a source names, static, lazy or required. */
function specifiersOf(source: string): string[] {
  return SPECIFIERS.flatMap((re) => [...source.matchAll(re)].map((m) => m[1]));
}

/** Only the specifiers evaluated before a module's body runs. */
function staticSpecifiersOf(source: string): string[] {
  return STATIC_SPECIFIERS.flatMap((re) => [...source.matchAll(re)].map((m) => m[1]));
}

/** Every lazy import whose specifier no walk can follow: not a string literal, or a template with a placeholder. */
function computedImportsOf(source: string): number {
  const opened = [...source.matchAll(new RegExp(String.raw`\bimport\s*\(\s*${COMMENTS}(\S)`, 'g'))].filter((m) => !`'"\``.includes(m[1])).length;
  const templated = [...source.matchAll(new RegExp(String.raw`\bimport\s*\(\s*${COMMENTS}\`[^\`]*\$\{`, 'g'))].length;
  return opened + templated;
}

/** The file a relative specifier lands on, or null for a package or a file that is not there. A `.js` specifier finds its `.ts` source, as TypeScript resolves it. */
function resolveRelative(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec.split('?')[0]);
  const asSource = /\.m?js$/.test(base) ? [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), base.replace(/\.mjs$/, '.mts')] : /\.cjs$/.test(base) ? [base.replace(/\.cjs$/, '.cts')] : [];
  for (const candidate of [base, ...asSource, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.mjs`, `${base}.js`, `${base}.cjs`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && CODE.test(candidate)) return candidate;
  }
  return null;
}

const isBuiltin = (spec: string) => spec.startsWith('node:') || builtinModules.includes(spec.split('/')[0]);

/** What writes to stdout without going through process.stdout's write, which the guard cannot catch. */
const STDOUT_BYPASSES: [RegExp, string][] = [
  [/\bwriteSync\s*\(\s*1\s*,/, 'writes to descriptor 1 directly'],
  [/\bprocess\s*\.\s*stdout\s*\.\s*fd\b/, "uses stdout's descriptor"],
  [/\bprocess\s*\.\s*stdout\s*\.\s*end\b/, 'ends stdout'],
  [/\bstdio\s*:\s*['"]inherit['"]/, 'starts a child that inherits stdout'],
  [/\bstdio\s*:\s*\[[^\]]*(?:['"]inherit['"]|\bprocess\s*\.\s*stdout\b)/, 'starts a child that inherits stdout'],
  [/\bstdio\s*:\s*\[\s*[^,\]]+,\s*1\s*[,\]]/, 'hands descriptor 1 to a child'],
  [/\bfork\s*\(/, 'forks a child, which inherits stdout by default'],
];
const stdoutBypassesOf = (source: string) => STDOUT_BYPASSES.filter(([re]) => re.test(source)).map(([, why]) => why);

describe('the import boundaries', () => {
  it('reads every shape of import it is meant to', () => {
    const sample = [
      "import a from './a';",
      "import type { B } from './b';",
      "import {\n  c,\n  d as e,\n} from './c';",
      "export * from './d';",
      "export { f } from './e';",
      "import './f';",
      "const g = await import('./g');",
      "const h = require('./h');",
      "const i = await import(/* @vite-ignore */ './i');",
      "const j = await import(\n  /* one */ /* two */ './j'\n);",
    ].join('\n');
    expect(specifiersOf(sample).sort()).toEqual(['./a', './b', './c', './d', './e', './f', './g', './h', './i', './j']);
    expect(staticSpecifiersOf(sample).sort()).toEqual(['./a', './b', './c', './d', './e', './f']);
    expect(computedImportsOf(sample)).toBe(0);
    expect(computedImportsOf('await import(spec); await import(/* @vite-ignore */ FAKE); await import(`./${name}`); await import(`./plain`);')).toBe(3);
  });

  it('finds the source of a .js specifier, as TypeScript does, so a re-export through one is seen', () => {
    const from = join(CLONE, 'src', 'lib', 'any.ts');
    expect(resolveRelative(from, '../mcp/paths.js')).toBe(join(CLONE, 'src', 'mcp', 'paths.ts'));
    expect(resolveRelative(from, '../mcp/paths')).toBe(join(CLONE, 'src', 'mcp', 'paths.ts'));
    expect(resolveRelative(join(CLONE, 'src', 'mcp', 'run.mjs'), './stdio.ts')).toBe(join(CLONE, 'src', 'mcp', 'stdio.ts'));
  });

  it('nothing outside src/mcp imports it, tests aside, and nothing outside it imports the MCP SDK', () => {
    const offenders = [...SRC.filter((f) => !inMcp(f) && !isTest(f)), ...SCRIPTS.filter((f) => !isTest(f)), ...ROOT].flatMap((file) =>
      specifiersOf(text(file))
        .filter((spec) => spec.startsWith('@modelcontextprotocol/') || (resolveRelative(file, spec) !== null && inMcp(resolveRelative(file, spec) as string)))
        .map((spec) => `${rel(file)} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it('only test files import testFs.ts, the in-memory file system', () => {
    const offenders = [...SRC, ...SCRIPTS]
      .filter((f) => !isTest(f))
      .flatMap((file) =>
        specifiersOf(text(file))
          .filter((spec) => {
            const target = resolveRelative(file, spec);
            return target !== null && rel(target) === 'src/mcp/testFs.ts';
          })
          .map((spec) => `${rel(file)} -> ${spec}`),
      );
    expect(offenders).toEqual([]);
  });

  it('outside src/server only server.ts imports it, tests aside', () => {
    const offenders = [...SRC.filter((f) => !inServer(f) && !isTest(f)), ...SCRIPTS.filter((f) => !isTest(f)), ...ROOT.filter((f) => rel(f) !== 'server.ts')].flatMap((file) =>
      specifiersOf(text(file))
        .filter((spec) => {
          const target = resolveRelative(file, spec);
          return target !== null && inServer(target);
        })
        .map((spec) => `${rel(file)} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it('only src/mcp and src/server import a Node built-in, so none can reach the browser bundle', () => {
    const offenders = SRC.filter((f) => !inMcp(f) && !inServer(f) && !isTest(f)).flatMap((file) =>
      specifiersOf(text(file))
        .filter(isBuiltin)
        .map((spec) => `${rel(file)} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it('src/mcp reaches no browser-only module and nothing that writes to stdout behind the guard, through any import, static or lazy, however deep', () => {
    const start = SRC.filter((f) => inMcp(f) && !isTest(f));
    const seen = new Set<string>(start);
    const queue = [...start];
    const problems: string[] = [];
    const FORBIDDEN = /^src\/(lib\/(handwriting|paddle|paddleWorker|pdf)\.ts|components\/|App\.tsx$|main\.tsx$|PublicSite\.tsx$)/;
    while (queue.length) {
      const file = queue.shift() as string;
      const source = text(file);
      if (/new\s+Worker\s*\(\s*new\s+URL\s*\(/.test(source)) problems.push(`${rel(file)} starts a browser worker`);
      if (computedImportsOf(source)) problems.push(`${rel(file)} imports a specifier built at run time, which no walk can follow`);
      for (const why of stdoutBypassesOf(source)) problems.push(`${rel(file)} ${why}`);
      for (const spec of specifiersOf(source)) {
        if (/\?(url|worker|raw|inline)\b/.test(spec)) problems.push(`${rel(file)} -> ${spec}`);
        const target = resolveRelative(file, spec);
        if (!target) continue;
        if (FORBIDDEN.test(rel(target))) problems.push(`${rel(file)} -> ${rel(target)}`);
        if (!seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
    expect(problems).toEqual([]);
    // The walk really happened: the launcher's and the entry's lazy imports were followed.
    expect([...seen].map(rel)).toEqual(expect.arrayContaining(['src/mcp/run.mjs', 'src/mcp/stdio.ts', 'src/mcp/formaServer.ts', 'src/mcp/roots.ts', 'src/lib/problemReport.ts']));
  });

  it('finds every shape of write to stdout that the guard cannot catch', () => {
    const shapes = [
      "writeSync(1, 'x')",
      'const fd = process.stdout.fd;',
      'process.stdout.end(chunk)',
      "spawn(cmd, args, { stdio: 'inherit' })",
      "spawnSync(cmd, { stdio: ['pipe', 'inherit', 'pipe'] })",
      'spawn(cmd, { stdio: [0, process.stdout, 2] })',
      "spawn(cmd, { stdio: ['pipe', 1, 'pipe'] })",
      "fork('./child.js')",
    ];
    for (const shape of shapes) expect(stdoutBypassesOf(shape), shape).not.toEqual([]);
    expect(stdoutBypassesOf("spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }); writeSync(fd, 'x'); target.stdout.end = f;")).toEqual([]);
  });

  it('never imports the v1 SDK, anywhere in src', () => {
    const offenders = SRC.filter((f) => specifiersOf(text(f)).some((s) => s === '@modelcontextprotocol/sdk' || s.startsWith('@modelcontextprotocol/sdk/'))).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("the entry's order", () => {
  it('installs the stdout guard before anything else loads: its only static import, called before the first lazy import', () => {
    const entry = text(join(CLONE, 'src', 'mcp', 'stdio.ts'));
    expect(staticSpecifiersOf(entry)).toEqual(['./stdoutGuard']);
    const body = code(entry);
    const installed = body.indexOf('installStdoutGuard(');
    const firstLazy = body.search(/\bimport\s*\(/);
    expect(installed).toBeGreaterThan(-1);
    expect(firstLazy).toBeGreaterThan(installed);
  });

  it('the guard imports only Node built-ins and problemReport, and problemReport imports nothing', () => {
    expect(specifiersOf(text(join(CLONE, 'src', 'mcp', 'stdoutGuard.ts'))).filter((s) => !isBuiltin(s))).toEqual(['../lib/problemReport']);
    expect(specifiersOf(text(join(CLONE, 'src', 'lib', 'problemReport.ts')))).toEqual([]);
  });

  it("the launcher loads only tsx's loader and then the entry", () => {
    const launcher = text(join(CLONE, 'src', 'mcp', 'run.mjs'));
    expect(staticSpecifiersOf(launcher)).toEqual(['tsx/esm/api']);
    expect(specifiersOf(launcher)).toEqual(['tsx/esm/api', './stdio.ts']);
  });
});

describe('stdio only, no port', () => {
  const mcp = SRC.filter((f) => inMcp(f) && !isTest(f));

  it('src/mcp imports nothing that listens, and calls nothing that would', () => {
    const LISTENERS = /^(node:)?(http|https|http2|net|dgram|tls|cluster)$|^(express|ws|fastify|hono|koa)(\/|$)/;
    const problems = mcp.flatMap((file) => {
      const source = text(file);
      return [
        ...specifiersOf(source).filter((s) => LISTENERS.test(s)).map((s) => `${rel(file)} imports ${s}`),
        ...(/\.listen\s*\(|\bcreateServer\s*\(|\bcreateMcpHandler\b|StreamableHTTP|legacyStatelessFallback/.test(source) ? [`${rel(file)} would open a listener`] : []),
      ];
    });
    expect(problems).toEqual([]);
  });

  it('serves through serveStdio, in the entry', () => {
    const entry = text(join(CLONE, 'src', 'mcp', 'stdio.ts'));
    expect(specifiersOf(entry)).toContain('@modelcontextprotocol/server/stdio');
    expect(entry).toMatch(/\bserveStdio\(/);
  });
});

/** A read of an environment variable whose name says it holds a key, a token, a secret or a password. */
const KEY_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i;

const ENV = String.raw`(?:process\.env|import\.meta\.env)`;

/**
 * Every environment variable a source reads by name: process.env.X,
 * process.env['X'], process['env'], a destructuring, import.meta.env.X, and
 * the same through an alias (`const e = process.env`, a parameter defaulting
 * to process.env, `env` imported or destructured from process).
 */
function envReadsOf(source: string): string[] {
  const s = source.replace(/\bprocess\s*\[\s*['"`]env['"`]\s*\]/g, 'process.env');
  const aliases = [
    ...[...s.matchAll(new RegExp(String.raw`\b(\w+)\s*=\s*${ENV}(?![\w.?[])`, 'g'))].map((m) => m[1]),
    ...[...s.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*['"](?:node:)?process['"]/g), ...s.matchAll(/\{([^{}]*)\}\s*=\s*process\b(?!\s*\.)/g)].flatMap((m) =>
      m[1]
        .split(',')
        .map((p) => p.trim())
        .filter((p) => /^env\b/.test(p))
        .map((p) => p.split(/\s*(?:\bas\b|:)\s*/)[1] ?? 'env'),
    ),
  ];
  const holders = [`\\b${ENV}`, ...aliases.map((a) => String.raw`(?<![\w.])${a}`)];
  const names = holders.flatMap((h) => [
    ...[...s.matchAll(new RegExp(String.raw`${h}\??\.(\w+)|${h}\??\.?\[\s*['"\`](\w+)['"\`]\s*\]`, 'g'))].map((m) => m[1] ?? m[2]),
    ...[...s.matchAll(new RegExp(String.raw`\{([^{}]*)\}\s*=\s*${h}\b`, 'g'))].flatMap((m) =>
      m[1]
        .split(',')
        .map((p) => p.split(':')[0].replace(/=.*$/, '').trim())
        .filter(Boolean),
    ),
  ]);
  return [...new Set(names)];
}

/** True when a source touches the environment at all, in any shape envReadsOf knows. */
const touchesEnv = (source: string) =>
  /\bprocess\s*\??\.\s*env\b|\bprocess\s*\[\s*['"`]env['"`]\s*\]|\bfrom\s*['"](?:node:)?process['"]|\brequire\(\s*['"](?:node:)?process['"]\s*\)|\{[^{}]*\benv\b[^{}]*\}\s*=\s*process\b/.test(source);

/**
 * The key reads that exist outside src/mcp, each a decision already taken:
 * the fidelity benchmark reads the owner's own key (FORMA_BENCH_KEY, as
 * gemini.md's *The fidelity benchmark* says); the weekly learning job checks
 * whether Google's application credential is set, without reading it; and
 * the owner's admin scripts locate that credential's file by the same
 * variable (google.mjs, run only on the owner's own PC, as CLAUDE.md's
 * owner-only operations say; found once the reader followed an alias).
 */
const KNOWN_OUTSIDE: Record<string, string[]> = {
  'scripts/admin/google.mjs': ['GOOGLE_APPLICATION_CREDENTIALS'],
  'scripts/fidelity/chatEdits.ts': ['FORMA_BENCH_KEY'],
  'scripts/fidelity/chatJudge.ts': ['FORMA_BENCH_KEY'],
  'scripts/fidelity/run.ts': ['FORMA_BENCH_KEY'],
  'scripts/model/learn-week.ts': ['GOOGLE_APPLICATION_CREDENTIALS'],
};

describe('only src/mcp reads a key from the environment', () => {
  it('finds every shape of read it is meant to', () => {
    const sample = [
      'a = process.env.FORMA_GEMINI_KEY; b = process.env[\'X_TOKEN\']; c = process.env?.HOST; const { GEMINI_API_KEY, PORT: p } = process.env; d = import.meta.env.VITE_SECRET;',
      "const e = process.env; f = e.ALIASED_KEY; g = process['env'].BRACKET_SECRET;",
      'function h(env = process.env) { return env.PARAM_TOKEN; }',
      "import { env as penv } from 'node:process'; i = penv.IMPORTED_PASSWORD;",
      'const { env: denv } = process; j = denv.DESTRUCTURED_CREDENTIAL;',
    ].join('\n');
    expect(envReadsOf(sample).sort()).toEqual(['ALIASED_KEY', 'BRACKET_SECRET', 'DESTRUCTURED_CREDENTIAL', 'FORMA_GEMINI_KEY', 'GEMINI_API_KEY', 'HOST', 'IMPORTED_PASSWORD', 'PARAM_TOKEN', 'PORT', 'VITE_SECRET', 'X_TOKEN']);
    for (const shape of ['process.env.X', "process['env']", 'process?.env', "import { env } from 'node:process'", "import process from 'process'", "require('node:process')", 'const { env } = process;']) expect(touchesEnv(shape), shape).toBe(true);
    expect(touchesEnv('const environment = options.env; spawn(cmd, { env: childEnv });')).toBe(false);
  });

  it('no source outside src/mcp reads one, beyond the reads already decided', () => {
    const found: Record<string, string[]> = {};
    for (const file of [...SRC.filter((f) => !inMcp(f) && !isTest(f)), ...SCRIPTS.filter((f) => !isTest(f)), ...ROOT]) {
      const keys = envReadsOf(text(file)).filter((name) => KEY_NAME.test(name));
      if (keys.length) found[rel(file)] = keys;
    }
    expect(found).toEqual(KNOWN_OUTSIDE);
  });

  it('within src/mcp only the entry touches the environment, and nothing loads dotenv', () => {
    const mcp = SRC.filter((f) => inMcp(f) && !isTest(f));
    expect(mcp.filter((f) => touchesEnv(text(f))).map(rel)).toEqual(['src/mcp/stdio.ts']);
    expect(mcp.filter((f) => specifiersOf(text(f)).some((s) => s.startsWith('dotenv'))).map(rel)).toEqual([]);
  });
});
