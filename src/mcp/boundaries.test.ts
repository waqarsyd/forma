/**
 * The boundaries Forma's MCP server rests on, held by reading the sources
 * (2026-11-24, the MCP work's wave 3; findings TST-5, PROTO-10, SEC-9 and
 * SEC-12, and T2, T4, T7 and PS-7 of the wave-3 review). No test held
 * src/server apart before this one, so it covers that folder's half of the
 * rule too.
 *
 * - src/mcp is Node only: nothing outside it imports it (tests aside, and
 *   one script, which shares PaddleOCR's Node reader, nodePaddle.ts), as
 *   nothing but server.ts imports src/server, and only src/mcp and
 *   src/server import a Node built-in, so none can reach the browser
 *   bundle, where Vite would replace it with a stub that fails only at run
 *   time. Only test files import testFs.ts and testClient.ts, the tests'
 *   file system and client, and lib/sqlFixtures.ts, the database captures
 *   the layout tests share (`TEST_ONLY`).
 * - src/mcp reaches no browser-only module through any import it makes
 *   (a type-only import aside, which is erased and loads nothing),
 *   static or lazy, however deep the walk goes: not the OCR and PDF worker
 *   modules (handwriting.ts, paddle.ts, paddleWorker.ts, pdf.ts), not a
 *   `?url` or `?worker` import, not `new Worker(new URL(...))`, not the
 *   components or the app's entries. A lazy import whose specifier is not a
 *   string literal is refused there, because no walk can follow it.
 * - Nothing src/mcp reaches writes to stdout behind the guard's back: no
 *   write to descriptor 1, no child that inherits stdout (stdio inherited,
 *   descriptor 1 or process.stdout handed over, or a fork, which inherits by
 *   default), no use of stdout's descriptor or its end, and no worker thread
 *   whose stdout is not its own (piped into this process's otherwise). The
 *   guard cannot catch those (stdoutGuard.ts says why). The one worker thread
 *   is a Node one (2026-11-24, the wave-4 review's REV4-3): workerPool.ts
 *   starts worker.mjs, which loads only tsx's loader and pipeline.ts, and the
 *   walk below reads both as files of src/mcp.
 * - Each entry's order (`ENTRIES`: stdio.ts, and since the CLI and Forma
 *   Designer work's wave 4 the command line's cliEntry.ts): the stdout guard is its only
 *   static import and is installed before its first lazy import, which is
 *   aiSettings.ts, a module that loads no package at all; the AI's
 *   environment is taken there (`takeAiEnv`), in the entry's own voice, and
 *   applied with exactly what that gave (its keys to the guard, its names
 *   deleted, nothing of the entry's own) before the next lazy import, so
 *   before anything can load the Gemini SDK or start a worker (2026-11-24,
 *   the CLI and Forma Designer work's CLI-9 and TEST-2, and SEC-W2-1 of its
 *   wave-2 review; stdio.test.ts shows the keys reaching the guard, with a
 *   key in a shape no pattern knows). The guard imports only Node
 *   built-ins and the key scrubber the web app shares (lib/keyRedact.ts
 *   since wave 8), which imports nothing; each launcher, run.mjs and the
 *   command line's cli.mjs, loads only tsx's loader and its entry. And the
 *   command line's entry is wired as its header says (`cliWiringProblems`,
 *   the wave-4 review's SEC-W4-4: with the guard's options cut back, or
 *   `main` handed a scrubber that takes nothing out, or a copy of the
 *   environment made before the keys were deleted, every case still
 *   passed): the guard's exact options, `main` handed the guard's
 *   scrubber, log and `protocolOut`, and no reference to the environment
 *   before the keys are deleted but `takeAiEnv`'s; commandLine.test.ts shows
 *   a key reaching neither stream, and a rejection ending the run with 70,
 *   in the process it spawns. The AI tools' worker thread (genWorker.mjs,
 *   wave 8) is a Node one of worker.mjs's shape, started only by
 *   generator.ts.
 * - Never the v1 SDK, @modelcontextprotocol/sdk: it is in the tree (through
 *   firebase-tools and @google/genai) and would resolve silently, speaking
 *   only the 2025 protocol.
 * - Stdio only, no port: src/mcp opens no listener of any kind, which is
 *   what makes it the user's own program rather than a server (PRD section 6).
 * - Only src/mcp may read a key from the environment, and within it only
 *   the entries touch the environment at all, never loading dotenv. Each
 *   hands its environment to aiSettings.ts's `takeAiEnv`, which is the one
 *   shape below these readers cannot see, decided (CLI-9): its own test
 *   hands it a proxy that fails on any read of a name it does not list.
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
import type { Voice } from './caller';

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

/**
 * The entries of src/mcp, the only files in it that may touch the
 * environment, each held to the same order below and to taking its
 * environment in its own voice, the one given here (2026-11-24, findings
 * CLI-9 and TEST-2 of the command line's design audit, and SEC-W2-1 of that
 * work's wave-2 review): the MCP server's, and since that work's wave 4 the
 * command line's (2026-11-24, CLI-1), which joined this map as one line. A
 * third file that touched the environment would fail the environment case,
 * as any other file would, and an entry that copied the other's line, voice
 * and all, would fail the voice.
 */
const ENTRIES: Record<string, Voice> = { 'src/mcp/stdio.ts': 'mcp', 'src/mcp/cliEntry.ts': 'cli' };
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

/**
 * Every specifier a module loads when it runs: all of `specifiersOf` but a
 * whole `import type ... from` or `export type ... from`, which TypeScript
 * and tsx erase, so the module it names is never loaded through it
 * (2026-11-24, the MCP work's wave 4: the chat's outline and edits, in
 * agentEdit.ts, name a type of geminiService.ts through repxTranslate.ts, and
 * geminiService's own type imports name the OCR modules, none of which the
 * server ever loads). `import { a, type B }` still loads its module and is
 * still followed.
 */
function runtimeSpecifiersOf(source: string): string[] {
  return specifiersOf(source.replace(/\b(?:import|export)\s+type\s+(?:[\w*{}\s,$]+?|\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s*['"][^'"]+['"]/g, ''));
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
  // A worker thread's stdout is piped into this process's unless it is its own (2026-11-24, REV4-3: workerPool.ts).
  [/\bnew\s+Worker\s*\((?![^)]*\bstdout\s*:\s*true)/, "starts a worker thread whose stdout is piped into this process's"],
];
const stdoutBypassesOf = (source: string) => STDOUT_BYPASSES.filter(([re]) => re.test(source)).map(([, why]) => why);

/**
 * The imports of src/mcp from outside it, each a script, which is Node too, so
 * nothing reaches the browser through one; anything else that imports src/mcp
 * still fails here:
 *
 * - PaddleOCR's Node reader (2026-11-24, the MCP work's wave 7, finding
 *   NODE-5), which the measuring scripts and the MCP server share so neither
 *   keeps a copy (nodePaddle.ts says so).
 * - The generation core's Node parts and the File a path becomes (wave 10,
 *   finding NODE-9): the fidelity benchmark makes each report as the MCP
 *   server's generate_report does, so it measures what that tool ships,
 *   rather than keeping a third copy of the pipeline.
 * - The command line's entry (2026-11-24, the CLI and Forma Designer work's
 *   wave 4, CLI-1): scripts/repx.ts, the command line until then, forwards
 *   to it, so its documented form keeps working with the entry's order, the
 *   guard first and the environment taken there, never in the script.
 */
const SHARED_WITH_SCRIPTS = [
  'scripts/fidelity/run.ts -> ../../src/mcp/nodeGeneration',
  'scripts/fidelity/run.ts -> ../../src/mcp/nodeIntake',
  'scripts/model/paddleOcr.ts -> ../../src/mcp/nodePaddle',
  'scripts/repx.ts -> ../src/mcp/cliEntry',
];

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
    // A type-only import is erased and loads nothing; one with a value beside its types loads its module.
    const typed = "import type { A } from './erased';\nimport type {\n  B,\n} from './erased2';\nexport type { C } from './erased3';\nimport { d, type E } from './loaded';\nimport { type F } from './loaded2';";
    expect(runtimeSpecifiersOf(typed).sort()).toEqual(['./loaded', './loaded2']);
  });

  it('finds the source of a .js specifier, as TypeScript does, so a re-export through one is seen', () => {
    const from = join(CLONE, 'src', 'lib', 'any.ts');
    expect(resolveRelative(from, '../mcp/paths.js')).toBe(join(CLONE, 'src', 'mcp', 'paths.ts'));
    expect(resolveRelative(from, '../mcp/paths')).toBe(join(CLONE, 'src', 'mcp', 'paths.ts'));
    expect(resolveRelative(join(CLONE, 'src', 'mcp', 'run.mjs'), './stdio.ts')).toBe(join(CLONE, 'src', 'mcp', 'stdio.ts'));
  });

  it('nothing outside src/mcp imports it, tests aside and the imports the scripts share (SHARED_WITH_SCRIPTS), and nothing outside it imports the MCP SDK', () => {
    const offenders = [...SRC.filter((f) => !inMcp(f) && !isTest(f)), ...SCRIPTS.filter((f) => !isTest(f)), ...ROOT].flatMap((file) =>
      specifiersOf(text(file))
        .filter((spec) => spec.startsWith('@modelcontextprotocol/') || (resolveRelative(file, spec) !== null && inMcp(resolveRelative(file, spec) as string)))
        .map((spec) => `${rel(file)} -> ${spec}`),
    );
    // Sorted: the order a folder is listed in is the file system's, not the same on every OS.
    expect([...new Set(offenders)].sort()).toEqual([...SHARED_WITH_SCRIPTS].sort());
  });

  /*
   * Test code that lives beside the code it tests: the in-memory file system
   * and client, and since 2026-11-24 (the CLI and Forma Designer work's wave
   * 5, D1-12) lib/sqlFixtures.ts, the FormaSample captures every test that
   * reads a database layout shares. Coverage leaves all three out
   * (vitest.config.ts), which is right only while nothing else loads them.
   */
  const TEST_ONLY = ['src/mcp/testFs.ts', 'src/mcp/testClient.ts', 'src/lib/sqlFixtures.ts'];

  it('only test files import testFs.ts, testClient.ts and sqlFixtures.ts, the in-memory file system, client and database captures', () => {
    expect(TEST_ONLY.filter((f) => !existsSync(join(CLONE, f)))).toEqual([]);
    const offenders = [...SRC, ...SCRIPTS]
      .filter((f) => !isTest(f))
      .flatMap((file) =>
        specifiersOf(text(file))
          .filter((spec) => {
            const target = resolveRelative(file, spec);
            return target !== null && TEST_ONLY.includes(rel(target));
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
      for (const spec of runtimeSpecifiersOf(source)) {
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
    expect([...seen].map(rel)).toEqual(
      expect.arrayContaining(['src/mcp/run.mjs', 'src/mcp/stdio.ts', 'src/mcp/formaServer.ts', 'src/mcp/roots.ts', 'src/lib/keyRedact.ts', 'src/mcp/genWorker.mjs', 'src/mcp/genJobs.ts', 'src/mcp/cli.mjs', 'src/mcp/cliEntry.ts', 'src/mcp/commandLine.ts']),
    );
  });

  it("the command line's layer loads neither the MCP SDK nor zod, nor any module only the server needs, through any import of Forma's own, static or lazy", () => {
    // 2026-11-24, findings CLI-2 and SEC-4 of the command line's design audit: what the command line imports on its
    // main thread (the calls, the path rules, reading and writing a report, the AI's settings, the two generators, the stdout
    // guard, Forma's version) and the work its two threads run (genJobs.ts, pipeline.ts). ToolRefusal lived in toolShape.ts,
    // which loads zod, so every one of them loaded zod until it moved to caller.ts. A package's own dependencies are not
    // walked (@google/genai depends on zod itself, inside the AI tools' thread); what is held is that Forma's modules never
    // name either on the command line's way. CLI_LAYER is the one list of that layer: cliVoice.test.ts reads it from this
    // file and walks from it, so whatever the layer loads has its words read. SERVER_ONLY names the server's own modules and
    // the tests' helpers, which the layer never reaches, toolList.ts (every MCP tool's name) among them since the wave-2
    // review (SEC-W2-4: an import of it from the layer passed here, and cliVoice.test.ts skipped it by name).
    // Since wave 4 (2026-11-24) the command line itself is the head of its layer: its launcher, its entry, commandLine.ts, its
    // table, and layoutCalls.ts, the report tools' steps it shares with the server; since that wave's second part folderBatch.ts,
    // the batch's walk, routes and names, and modelParks.ts, whose kept parks the batch reads on its own thread.
    const CLI_LAYER = ['cli.mjs', 'cliEntry.ts', 'commandLine.ts', 'cliCommands.ts', 'layoutCalls.ts', 'folderBatch.ts', 'modelParks.ts', 'reportCalls.ts', 'paths.ts', 'reportFile.ts', 'caller.ts', 'version.ts', 'aiSettings.ts', 'generator.ts', 'workerPool.ts', 'stdoutGuard.ts', 'genJobs.ts', 'pipeline.ts'].map((f) => join(CLONE, 'src', 'mcp', f));
    const SERVER_ONLY = ['toolShape.ts', 'formaServer.ts', 'aiTools.ts', 'reportTools.ts', 'statusTool.ts', 'roots.ts', 'skillResource.ts', 'toolList.ts', 'stdio.ts', 'run.mjs', 'testFs.ts', 'testClient.ts'].map((f) => `src/mcp/${f}`);
    const seen = new Set<string>(CLI_LAYER);
    const queue = [...CLI_LAYER];
    const problems: string[] = [];
    while (queue.length) {
      const file = queue.shift() as string;
      for (const spec of runtimeSpecifiersOf(text(file))) {
        if (spec === 'zod' || spec.startsWith('zod/') || spec.startsWith('@modelcontextprotocol/')) problems.push(`${rel(file)} -> ${spec}`);
        const target = resolveRelative(file, spec);
        if (!target) continue;
        if (SERVER_ONLY.includes(rel(target))) problems.push(`${rel(file)} -> ${rel(target)}`);
        if (!seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
    expect(problems).toEqual([]);
    // The walk really happened: it reached the Node parts, the web app's generation core, and the scrubber.
    expect([...seen].map(rel)).toEqual(expect.arrayContaining(['src/mcp/nodeGeneration.ts', 'src/lib/generationCore.ts', 'src/lib/keyRedact.ts', 'src/services/geminiService.ts']));
    // And it would have caught the import it was written for.
    expect(runtimeSpecifiersOf(text(join(CLONE, 'src', 'mcp', 'toolShape.ts')))).toContain('zod');
  });

  it('no two modules of src/mcp share a name, so an import without an extension means one file to Vite, tsx and the walks here alike', () => {
    // 2026-11-24, the command line's wave 4: beside cli.mjs, a cli.ts was what `import('./cli')` named to tsc and to the
    // walks above, which try .ts first, while Vitest's resolver took the launcher, .mjs first, and ran it inside the test.
    const names = SRC.filter((f) => inMcp(f)).map((f) => rel(f).replace(/\.[^./]+$/, ''));
    expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
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
      'new Worker(file, { resourceLimits: limits })',
      'new Worker(file)',
    ];
    for (const shape of shapes) expect(stdoutBypassesOf(shape), shape).not.toEqual([]);
    expect(stdoutBypassesOf("spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }); writeSync(fd, 'x'); target.stdout.end = f;")).toEqual([]);
    expect(stdoutBypassesOf('new Worker(file, { resourceLimits: { maxOldGenerationSizeMb: 512 }, stdout: true, stderr: true })')).toEqual([]);
  });

  it('never imports the v1 SDK, anywhere in src', () => {
    const offenders = SRC.filter((f) => specifiersOf(text(f)).some((s) => s === '@modelcontextprotocol/sdk' || s.startsWith('@modelcontextprotocol/sdk/'))).map(rel);
    expect(offenders).toEqual([]);
  });
});

/** Where each lazy import in a source begins, and the specifier it names, in order. */
function lazyImportsOf(source: string): { at: number; spec: string }[] {
  return [...source.matchAll(new RegExp(String.raw`\bimport\s*\(\s*${COMMENTS}['"\`]([^'"\`]+)['"\`]\s*\)`, 'g'))].map((m) => ({ at: m.index ?? -1, spec: m[1] }));
}

/**
 * What is wrong with an entry's hardening (aiSettings.ts's header), with
 * `voice` the one ENTRIES gives it. In order: its first lazy import is
 * aiSettings.ts; then exactly one call of takeAiEnv, destructured where it is
 * made, `const { ..., secrets, remove } = takeAiEnv(process.env, '<voice>')`,
 * in the entry's own voice; then `guard.addSecrets(secrets)`, the only call
 * that hands the guard keys, with that `secrets` and nothing else; then
 * `for (const name of remove) delete process.env[name]`, over that `remove`;
 * all of it before the next lazy import. And `secrets` and `remove` bound and
 * used nowhere else (the wave-2 review's SEC-W2-1: the reader once checked
 * only that calls of these names came in this order, so `addSecrets([])`, the
 * guard handed Forma's two keys alone, a list of its own to delete, and
 * another entry's voice all passed); no other deletion from, or write to, the
 * environment. Empty when it is right. `body` is the source without its
 * comments.
 */
function hardeningProblems(body: string, voice: Voice): string[] {
  const problems: string[] = [];
  const lazy = lazyImportsOf(body);
  if (lazy[0]?.spec !== './aiSettings') problems.push(`its first lazy import is ${lazy[0]?.spec ?? 'nothing'}, not ./aiSettings`);
  const takes = [...body.matchAll(/\bconst\s*\{([^{}]*)\}\s*=\s*takeAiEnv\(\s*process\.env\s*,\s*'(\w+)'\s*\)/g)];
  if (takes.length !== 1 || (body.match(/\btakeAiEnv\b/g) ?? []).length !== 2) problems.push('takeAiEnv(process.env, voice) is not imported once and called once, its result destructured where it is called');
  const take = takes[0];
  if (take && take[2] !== voice) problems.push(`it takes its environment in the voice '${take[2]}', not its own, '${voice}'`);
  const fields = (take?.[1] ?? '').split(',').map((f) => f.trim());
  if (!fields.includes('secrets') || !fields.includes('remove')) problems.push("takeAiEnv's secrets and remove are not destructured by those names");
  const taken = take?.index ?? -1;
  const secrets = body.search(/\bguard\.addSecrets\(\s*secrets\s*\)/);
  const deleted = body.search(/\bfor\s*\(\s*const\s+(\w+)\s+of\s+remove\s*\)\s*delete\s+process\.env\[\s*\1\s*\]/);
  if (taken < 0 || taken < (lazy[0]?.at ?? Infinity)) problems.push('takeAiEnv(process.env, voice) is not called after aiSettings.ts is imported');
  if (secrets < 0 || secrets < taken) problems.push('the keys takeAiEnv gave do not reach the guard, by guard.addSecrets(secrets), after they are taken');
  if ((body.match(/\baddSecrets\s*\(/g) ?? []).length !== 1) problems.push('the guard is handed keys other than by guard.addSecrets(secrets)');
  if (deleted < 0 || deleted < secrets) problems.push('the names takeAiEnv gave (remove) are not deleted after the keys reach the guard');
  for (const name of ['secrets', 'remove']) {
    // The destructuring and the one use: any other binding, assignment or use of either name is a list of the entry's own.
    if ((body.match(new RegExp(String.raw`(?<![\w$.])${name}(?![\w$])`, 'g')) ?? []).length !== 2) problems.push(`${name} is bound or used other than by takeAiEnv's destructuring and its one use`);
  }
  if ((lazy[1]?.at ?? Infinity) < Math.max(taken, secrets, deleted)) problems.push(`${lazy[1].spec} is imported before the hardening is done`);
  if ((body.match(/\bdelete\s+process\.env\b/g) ?? []).length !== 1) problems.push('it deletes from the environment other than by the list aiSettings.ts gives');
  if (/\bprocess\.env(?:\.\w+|\[[^\]]+\])\s*=[^=]/.test(body)) problems.push('it writes to the environment');
  return problems;
}

/**
 * What is wrong with the command line's entry's wiring (cliEntry.ts's
 * header, the wave-4 review's SEC-W4-4), `body` without its comments: the
 * guard installed once with exactly the command line's options (its prefix,
 * a rejection that fails the run, 70 after either); `main` called once and
 * handed the guard's scrubber, its log for stderr and its `protocolOut` for
 * stdout, nothing else under those names; and no reference to the
 * environment before the keys are deleted but `takeAiEnv`'s argument, so no
 * copy of it with the keys can be made for a worker or a child to inherit.
 * Empty when it is right.
 */
function cliWiringProblems(body: string): string[] {
  const problems: string[] = [];
  if ((body.match(/\binstallStdoutGuard\s*\(/g) ?? []).length !== 1 || !/\binstallStdoutGuard\(\s*\{\s*prefix:\s*'forma: ',\s*onRejection:\s*'fail',\s*fatalExitCode:\s*70\s*,?\s*\}\s*\)/.test(body)) {
    problems.push("the guard is not installed once with { prefix: 'forma: ', onRejection: 'fail', fatalExitCode: 70 }");
  }
  const calls = [...body.matchAll(/\bawait\s+main\s*\(/g)];
  const at = calls[0]?.index ?? -1;
  const end = at < 0 ? -1 : body.indexOf('\n});', at);
  const call = at < 0 || end < 0 ? '' : body.slice(at, end);
  if (calls.length !== 1 || (body.match(/\bmain\s*\(/g) ?? []).length !== 1) problems.push('main is not called once, awaited');
  if ((call.match(/\bredact\s*:/g) ?? []).length !== 1 || !/\bredact\s*:\s*guard\.redact\s*,/.test(call)) problems.push("main is not handed the guard's scrubber, redact: guard.redact");
  if ((call.match(/\berr\s*:/g) ?? []).length !== 1 || !/\berr\s*:\s*\(\s*line\s*\)\s*=>\s*guard\.log\(\s*line\s*\)\s*,/.test(call)) problems.push("main's stderr is not the guard's log, err: (line) => guard.log(line)");
  if ((call.match(/\bout\s*:/g) ?? []).length !== 1 || !/\bout\s*:\s*\(\s*text\s*\)\s*=>\s*\{\s*guard\.protocolOut\.write\(\s*text\s*\);\s*\}\s*,/.test(call)) problems.push("main's stdout is not the guard's protocolOut alone");
  const deleted = body.search(/\bfor\s*\(\s*const\s+(\w+)\s+of\s+remove\s*\)\s*delete\s+process\.env\[\s*\1\s*\]/);
  const taken = body.search(/\btakeAiEnv\(\s*process\.env\s*,/);
  const before = [...body.matchAll(/\bprocess\.env\b/g)].map((m) => m.index ?? -1).filter((i) => deleted < 0 || i < deleted);
  if (before.some((i) => i !== body.indexOf('process.env', taken))) problems.push('the environment is referred to before its keys are deleted other than by takeAiEnv(process.env, ...)');
  return problems;
}

describe("the command line's entry's wiring", () => {
  it('is what its header says: the guard, main and the environment (SEC-W4-4)', () => {
    expect(cliWiringProblems(code(text(join(CLONE, 'src', 'mcp', 'cliEntry.ts'))))).toEqual([]);
  });

  it('refuses the ways of breaking it the wave-4 review found every case passing: the guard cut back, a scrubber that takes nothing out, a copy of the environment with the keys, and the rest', () => {
    const right = code(text(join(CLONE, 'src', 'mcp', 'cliEntry.ts')));
    expect(cliWiringProblems(right)).toEqual([]);
    const broken = (from: string | RegExp, to: string) => {
      const changed = right.replace(from, to);
      expect(changed, String(from)).not.toBe(right);
      return cliWiringProblems(changed);
    };
    // M1: the guard with the server's defaults (a rejection goes on, 1 after a crash).
    expect(broken("installStdoutGuard({ prefix: 'forma: ', onRejection: 'fail', fatalExitCode: 70 })", "installStdoutGuard({ prefix: 'forma: ' })")).not.toEqual([]);
    expect(broken("fatalExitCode: 70", 'fatalExitCode: 1')).not.toEqual([]);
    // M17: main handed a scrubber that takes nothing out, or stderr and stdout around the guard.
    expect(broken('redact: guard.redact,', 'redact: (text: string) => text,')).not.toEqual([]);
    expect(broken('err: (line) => guard.log(line),', 'err: (line) => console.error(line),')).not.toEqual([]);
    expect(broken('guard.protocolOut.write(text);', 'process.stdout.write(text);')).not.toEqual([]);
    // M15: a copy of the environment, keys and all, after takeAiEnv and before the delete.
    expect(broken('guard.addSecrets(secrets);', 'guard.addSecrets(secrets);\nconst kept = { ...process.env };')).not.toEqual([]);
  });
});

describe("the entry's order", () => {
  it.each(Object.keys(ENTRIES))('%s installs the stdout guard before anything else loads: its only static import, called before the first lazy import', (entryPath) => {
    const entry = text(join(CLONE, entryPath));
    expect(staticSpecifiersOf(entry)).toEqual(['./stdoutGuard']);
    const body = code(entry);
    const installed = body.indexOf('installStdoutGuard(');
    const firstLazy = body.search(/\bimport\s*\(/);
    expect(installed).toBeGreaterThan(-1);
    expect(firstLazy).toBeGreaterThan(installed);
  });

  it("reads the hardening it is meant to, and refuses the ways of breaking it written here: a step out of order or left out, the guard handed other keys or another list deleted than takeAiEnv's, another voice, any other deletion or write", () => {
    const lines = {
      guard: 'const guard = installStdoutGuard();',
      settings: "const { readAiSettings, takeAiEnv } = await import('./aiSettings');",
      take: "const { aiEnv, secrets, remove } = takeAiEnv(process.env, 'cli');",
      secrets: 'guard.addSecrets(secrets);',
      remove: 'for (const name of remove) delete process.env[name];',
      next: "const { workerGenerator } = await import('./generator');",
    };
    const shape = (...keys: (keyof typeof lines)[]) => keys.map((k) => lines[k]).join('\n');
    const right = shape('guard', 'settings', 'take', 'secrets', 'remove', 'next');
    expect(hardeningProblems(right, 'cli')).toEqual([]);
    // The order, and a step left out.
    expect(hardeningProblems(shape('guard', 'next', 'settings', 'take', 'secrets', 'remove'), 'cli')).not.toEqual([]);
    expect(hardeningProblems(shape('guard', 'settings', 'take', 'secrets', 'next', 'remove'), 'cli')).not.toEqual([]);
    expect(hardeningProblems(shape('guard', 'settings', 'take', 'remove', 'secrets', 'next'), 'cli')).not.toEqual([]);
    expect(hardeningProblems(shape('guard', 'settings', 'take', 'secrets', 'next'), 'cli')).not.toEqual([]);
    // Another deletion, and a write.
    expect(hardeningProblems(`${right}\ndelete process.env.GEMINI_API_KEY;`, 'cli')).not.toEqual([]);
    expect(hardeningProblems(`${right}\nprocess.env.FORMA_GEMINI_KEY = '';`, 'cli')).not.toEqual([]);
    // SEC-W2-1: the guard handed nothing, or Forma's two keys alone (GEMINI_API_KEY's and GOOGLE_API_KEY's values dropped).
    expect(hardeningProblems(right.replace('guard.addSecrets(secrets);', 'guard.addSecrets([]);'), 'cli')).not.toEqual([]);
    expect(hardeningProblems(right.replace('guard.addSecrets(secrets);', 'guard.addSecrets([aiEnv.FORMA_GEMINI_KEY, aiEnv.FORMA_OPENROUTER_KEY]);'), 'cli')).not.toEqual([]);
    expect(hardeningProblems(right.replace('guard.addSecrets(secrets);', 'guard.addSecrets(secrets);\nguard.addSecrets([process.env.X]);'), 'cli')).not.toEqual([]);
    // A list of the entry's own to delete, in place of takeAiEnv's or shadowing it, and a result never destructured.
    expect(hardeningProblems(right.replace('{ aiEnv, secrets, remove }', '{ aiEnv, secrets }').replace('for (const name', "const remove = ['GEMINI_API_KEY'];\nfor (const name"), 'cli')).not.toEqual([]);
    expect(hardeningProblems(right.replace('for (const name', "{ const remove = ['GEMINI_API_KEY']; }\nfor (const name"), 'cli')).not.toEqual([]);
    expect(hardeningProblems(right.replace('const { aiEnv, secrets, remove } = takeAiEnv', 'const taken = takeAiEnv').replace('addSecrets(secrets)', 'addSecrets(taken.secrets)').replace('of remove', 'of taken.remove'), 'cli')).not.toEqual([]);
    // Another entry's voice: stdio.ts's line copied into the command line's entry, or the other way round.
    expect(hardeningProblems(right, 'mcp')).toEqual([expect.stringMatching(/in the voice 'cli', not its own, 'mcp'/)]);
  });

  it.each(Object.keys(ENTRIES))(
    "%s takes the AI's environment through aiSettings.ts, in its own voice, and applies it before anything that can load the Gemini SDK or start a worker: the keys it took to the guard, then the names it took deleted, before its second lazy import",
    (entryPath) => {
      // 2026-11-24, CLI-9 and TEST-2: the hardening was inline in stdio.ts, its foreign names a literal there alone, so a
      // second entry could only have copied it. aiSettings.ts lists them once; each entry applies what it takes, in order.
      expect(hardeningProblems(code(text(join(CLONE, entryPath))), ENTRIES[entryPath])).toEqual([]);
    },
  );

  it('aiSettings.ts, imported before the hardening, loads no package, no Node built-in and nothing that starts a worker, however deep', () => {
    const start = join(CLONE, 'src', 'mcp', 'aiSettings.ts');
    const seen = new Set<string>([start]);
    const queue = [start];
    const problems: string[] = [];
    while (queue.length) {
      const file = queue.shift() as string;
      const source = text(file);
      if (/\bnew\s+Worker\s*\(/.test(code(source))) problems.push(`${rel(file)} starts a worker`);
      for (const spec of runtimeSpecifiersOf(source)) {
        const target = resolveRelative(file, spec);
        if (!target) {
          problems.push(`${rel(file)} -> ${spec}`);
          continue;
        }
        if (!seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
    expect(problems).toEqual([]);
    // What it loads today: the web app's AI settings, which name the Gemini SDK's module only as a type.
    expect([...seen].map(rel).sort()).toEqual(['src/lib/aiProvider.ts', 'src/mcp/aiSettings.ts']);
  });

  it('the guard imports only Node built-ins and the shared key scrubber, and the scrubber imports nothing', () => {
    // Since wave 8 (2026-11-24, SEC-7) the scrubber the web app's error reports share, lib/keyRedact.ts.
    expect(specifiersOf(text(join(CLONE, 'src', 'mcp', 'stdoutGuard.ts'))).filter((s) => !isBuiltin(s))).toEqual(['../lib/keyRedact']);
    expect(specifiersOf(text(join(CLONE, 'src', 'lib', 'keyRedact.ts')))).toEqual([]);
  });

  it.each([
    ['run.mjs', './stdio.ts'],
    ['cli.mjs', './cliEntry.ts'],
  ])("the launcher %s loads only tsx's loader and then its entry, %s", (file, entry) => {
    const launcher = text(join(CLONE, 'src', 'mcp', file));
    expect(staticSpecifiersOf(launcher)).toEqual(['tsx/esm/api']);
    expect(specifiersOf(launcher)).toEqual(['tsx/esm/api', entry]);
  });

  it("the tools' worker threads load only Node's worker module, tsx's loader and their work, and only workerPool.ts and generator.ts start them", () => {
    // The wave-4 review's REV4-3: a Node worker thread, not a browser worker, with its stdout its own (the bypass list above).
    const worker = text(join(CLONE, 'src', 'mcp', 'worker.mjs'));
    expect(specifiersOf(worker)).toEqual(['node:worker_threads', 'tsx/esm/api', './pipeline.ts']);
    // Wave 8 (2026-11-24): the AI tools' thread, the same shape, running genJobs.ts.
    const genWorker = text(join(CLONE, 'src', 'mcp', 'genWorker.mjs'));
    expect(specifiersOf(genWorker)).toEqual(['node:worker_threads', 'tsx/esm/api', './genJobs.ts']);
    const starters = SRC.filter((f) => inMcp(f) && !isTest(f) && /\bnew\s+Worker\s*\(/.test(code(text(f)))).map(rel);
    expect(starters.sort()).toEqual(['src/mcp/generator.ts', 'src/mcp/workerPool.ts']);
    expect(text(join(CLONE, 'src', 'mcp', 'workerPool.ts'))).toContain("new URL('./worker.mjs', import.meta.url)");
    expect(text(join(CLONE, 'src', 'mcp', 'generator.ts'))).toContain("new URL('./genWorker.mjs', import.meta.url)");
  });

  it("every launcher names the clone's own tsconfig.json for tsx, never the working folder's", () => {
    // 2026-11-24, finding CLI-8 of the command line's design audit: tsx given no tsconfig applies the one in the folder the
    // host started in, the user's project. Through import.meta.dirname, so no launcher imports more than the cases above
    // allow, and never through TSX_TSCONFIG_PATH, which the environment case below would refuse. stdio.test.ts starts
    // the server from a folder whose tsconfig.json breaks the thread that answers and the AI tools' thread unless their
    // launchers do this; the report tools' thread names no package on start since the CLI work's wave 2, so no `paths`
    // reaches it, and this case is all that holds worker.mjs's pin (the wave-2 review's EQ-1).
    const launchers = SRC.filter((f) => inMcp(f) && !isTest(f) && specifiersOf(text(f)).includes('tsx/esm/api'));
    expect(launchers.map(rel).sort()).toEqual(['src/mcp/cli.mjs', 'src/mcp/genWorker.mjs', 'src/mcp/run.mjs', 'src/mcp/worker.mjs']);
    for (const file of launchers) {
      const calls = [...code(text(file)).matchAll(/\bregister\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
      expect(calls, rel(file)).toEqual(["{ tsconfig: import.meta.dirname + '/../../tsconfig.json' }"]);
      expect(resolve(dirname(file), '..', '..', 'tsconfig.json')).toBe(join(CLONE, 'tsconfig.json'));
    }
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

  it('within src/mcp only the entries touch the environment, and nothing loads dotenv', () => {
    const mcp = SRC.filter((f) => inMcp(f) && !isTest(f));
    expect(mcp.filter((f) => touchesEnv(text(f))).map(rel).sort()).toEqual(Object.keys(ENTRIES).sort());
    expect(mcp.filter((f) => specifiersOf(text(f)).some((s) => s.startsWith('dotenv'))).map(rel)).toEqual([]);
  });
});
