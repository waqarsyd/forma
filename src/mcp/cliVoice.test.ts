/**
 * The command line's voice (2026-11-24, the CLI and Forma Designer work's
 * wave 2; finding CLI-10 of its design audit,
 * `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`): what Forma's
 * Node side says to a person at a command line, or in a CI log, never names
 * the MCP server's machinery. The audit found the first words a new user of
 * the command line would read, the AI not set up, telling them to edit
 * "your assistant's MCP configuration" and restart it, and a dozen more
 * phrases naming the server, its tools and `fromFile`. Each caller now hands
 * its voice (caller.ts `Voice`) to the layer it shares, which picks the few
 * phrases that differ; the server's own words are held, word for word, by
 * its own tests.
 *
 * In the spirit of lib/workspaceVoice.test.ts, which holds the workspace to
 * plain words, and with its scanner (strings, comments and regular
 * expressions told apart the way a parser tells them). Two halves:
 *
 * - **Read.** Every string literal in the modules of src/mcp the command
 *   line runs, a template's placeholders included, must name none of the
 *   words a host's model is told (`FOR_A_HOST`: MCP, assistant, host, tool,
 *   fromFile, this server, and every MCP tool's name), unless it is the `mcp`
 *   branch of a voice table (`{ mcp: ..., cli: ... }`, the one shape the
 *   caller-specific words are written in), or a hit in `ALLOWED`, with why.
 *   The modules are the ones the command line can load, walked from its
 *   layer as boundaries.test.ts names it (`CLI_LAYER`, read from there, one
 *   list) through every import and every worker thread it starts (the wave-2
 *   review's SEC-W2-4), so a new module the layer loads, or a new phrase in
 *   one, is read without anyone remembering to add it, and nothing is
 *   skipped by name. An entry in ALLOWED that no longer matches a hit fails
 *   the suite.
 * - **Said.** What the command line's voice says, from the real calls made
 *   the way the command line makes them (its working folder, its
 *   voice, its settings with the mock as its flag): the AI not set up in
 *   every way it can be, a Local AI address refused, a reference left
 *   unexpanded, a C# report refused, a login taken out or left in, the
 *   chat's export dropped, a font measured in a stand-in, who answered, a
 *   deadline and a memory bound passed. None names a word of FOR_A_HOST.
 *
 * No key is real and no request leaves the process; every key is built at
 * run time (TST-10).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GenerationDeps } from '../lib/generationCore';
import { FORMA_KEYS, redactorFor } from '../lib/keyRedact';
import { encodeBase64 } from '../lib/repxSqlDataSource';
import { mockAnswer } from '../services/geminiService';
import { localUrlProblem, notReadyMessage, readAiSettings, takeAiEnv, type AiEnv, type AiSettings } from './aiSettings';
import { ToolRefusal } from './caller';
import { STAND_IN_FONTS, standInFontsNotice, type Answerer, type GenEvent } from './genJobs';
import { genTooLong, genTooMuchMemory, type Generator } from './generator';
import { nodeSystem, type IfExists } from './paths';
import { runJob } from './pipeline';
import { answeredBy, planGenerate, planRevise, runGenerate, runRevise, type CallRun, type PathPolicy } from './reportCalls';
import { LOGIN_REMOVED, loginRemovedNotice, openReport } from './reportFile';
import { inThreadGenerator } from './testClient';
import { TOOL_LIST } from './toolList';
import { tooLong, tooMuchMemory } from './workerPool';

const CLONE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MCP_DIR = join(CLONE, 'src', 'mcp');

/** "MCP" as a word, in capitals as Forma writes it (lower-case `mcp` is the voice's own name, never said). */
const MCP_WORD = /\bMCP\b/;
/** The rest of what a host's model is told and a person never is. */
const HOST_WORDS = new RegExp(String.raw`\b(?:assistant|hosts?|tools?)\b|fromFile|this server|${TOOL_LIST.map((t) => t.name).join('|')}`, 'i');
const forAHost = (text: string) => MCP_WORD.test(text) || HOST_WORDS.test(text);


/**
 * Hits that are right, by file and the literal's text, with why. Each entry
 * is a decision; one that no longer matches a hit fails the suite.
 */
const ALLOWED: readonly { file: string; text: RegExp; why: string }[] = [
  {
    file: 'paths.ts',
    text: /is outside the folders this server may use; forma_status lists them/,
    why: "Said only under roots, the server's scope: with a working folder the path is judged and returned before any root is looked at.",
  },
  {
    file: 'paths.ts',
    text: /^No folder is set for this server to use; forma_status says how to set one\.$/,
    why: 'Said only when the server has no roots; the command line hands a working folder, never an empty list of roots.',
  },
  {
    file: 'paths.ts',
    text: /^ this server may use, not a file in it$/,
    why: "The roots' branch of a choice made on the scope (`inFolder(scope) ? ... : ...`); the working folder's branch says ', not a file'.",
  },
  {
    file: 'genJobs.ts',
    text: /^assistant$/,
    why: "A chat turn's role in the history the AI is sent (`{ role: 'assistant' }`), never a word anyone is told.",
  },
];

/** A whole `import type` or `export type` statement, erased by TypeScript and tsx, so the module it names is never loaded through it. */
const TYPE_ONLY = /\b(?:import|export)\s+type\s+(?:[\w*{}\s,$]+?|\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s*['"][^'"]+['"]/g;
/** What loads a module of src/mcp: a static import or re-export, a side-effect import, a lazy import, and a worker thread started from a file beside it. */
const LOADS = [
  /\b(?:import|export)\s+[\w*{}\s,$]+?\s+from\s*['"](\.\/[^'"]+)['"]/g,
  /\bimport\s*['"](\.\/[^'"]+)['"]/g,
  /\bimport\(\s*(?:\/\*[\s\S]*?\*\/\s*)*['"`](\.\/[^'"`]+)['"`]\s*\)/g,
  /\bnew\s+URL\(\s*['"](\.\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
];

/** The file in src/mcp a `./` specifier lands on, as TypeScript and tsx resolve it, or null. */
function inMcp(spec: string): string | null {
  const name = spec.slice(2).split('?')[0];
  for (const candidate of [name, name.replace(/\.js$/, '.ts'), `${name}.ts`, `${name}.mjs`]) if (existsSync(join(MCP_DIR, candidate)) && /\.(ts|mjs)$/.test(candidate)) return candidate;
  return null;
}

/**
 * The modules of src/mcp the command line runs: its layer as
 * boundaries.test.ts names it (`CLI_LAYER`, read from that file's source, so
 * there is one list), and every module of src/mcp the layer reaches, through
 * an import, static or lazy (a whole `import type` aside, which loads
 * nothing), or as a worker thread it starts, however deep (the wave-2
 * review's SEC-W2-4: a list of the server's modules to skip once left out
 * toolList.ts, every MCP tool's name, which the layer could have imported
 * with neither test failing). Nothing it cannot load is skipped by hand, and
 * nothing it loads goes unread.
 */
function cliModules(): string[] {
  const listed = /\bconst CLI_LAYER = \[([^\]]*)\]/.exec(readFileSync(join(MCP_DIR, 'boundaries.test.ts'), 'utf8'));
  if (!listed) throw new Error('boundaries.test.ts no longer names CLI_LAYER, the one list of the command line layer');
  const seen = new Set([...listed[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const queue = [...seen];
  while (queue.length) {
    const source = readFileSync(join(MCP_DIR, queue.shift() as string), 'utf8').replace(TYPE_ONLY, '');
    for (const re of LOADS) {
      for (const m of source.matchAll(re)) {
        const file = inMcp(m[1]);
        if (file && !seen.has(file)) {
          seen.add(file);
          queue.push(file);
        }
      }
    }
  }
  return [...seen].sort();
}

/** The characters after which a "/" starts a regular expression rather than dividing (workspaceVoice.test.ts's rule). */
const BEFORE_REGEX = '(,=:[!&|?{};+-*%~^';

/** Where the string, comment or regular expression that starts at `at` ends, or -1 when none starts there. */
function skipAt(source: string, at: number): number {
  const ch = source[at];
  if (ch === '"' || ch === "'" || ch === '`') return endOfString(source, at);
  if (ch !== '/') return -1;
  if (source[at + 1] === '/') {
    const nl = source.indexOf('\n', at);
    return nl < 0 ? source.length : nl;
  }
  if (source[at + 1] === '*') {
    const end = source.indexOf('*/', at + 2);
    return end < 0 ? source.length : end + 2;
  }
  let j = at - 1;
  while (j >= 0 && /\s/.test(source[j])) j--;
  const regex = j < 0 || BEFORE_REGEX.includes(source[j]) || (source[j] === '>' && source[j - 1] === '=') || /\breturn$/.test(source.slice(Math.max(0, j - 6), j + 1));
  return regex ? endOfRegex(source, at) : -1;
}

/** The index just past the regular expression that starts at `at`, its flags included. */
function endOfRegex(source: string, at: number): number {
  let i = at + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '\n') return at + 1;
    if (inClass) {
      if (ch === ']') inClass = false;
    } else if (ch === '[') inClass = true;
    else if (ch === '/') {
      i++;
      while (/[a-z]/i.test(source[i] ?? '')) i++;
      return i;
    }
    i++;
  }
  return at + 1;
}

/** The index just past the string literal that starts at `at`; a template's `${...}` is skipped whole. */
function endOfString(source: string, at: number): number {
  const quote = source[at];
  let i = at + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (quote === '`' && ch === '$' && source[i + 1] === '{') {
      i = endOfPlaceholder(source, i + 2);
      continue;
    }
    i++;
  }
  return i;
}

/** The index just past the `}` that closes a template's `${`, from just after it. */
function endOfPlaceholder(source: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < source.length && depth > 0) {
    const skip = skipAt(source, i);
    if (skip >= 0) {
      i = skip;
      continue;
    }
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    i++;
  }
  return i;
}

/** The end of a property's value that starts at `start`: the `,` or `;` or closing bracket at its own depth. */
function endOfValue(source: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const skip = skipAt(source, i);
    if (skip >= 0) {
      i = skip;
      continue;
    }
    const ch = source[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return i;
      depth--;
    } else if ((ch === ',' || ch === ';') && depth === 0) return i;
    i++;
  }
  return i;
}

/** True when `mcp:` begins a property at `at`: a key of its own, after `{` or `,`, as a voice table writes it. */
function isMcpKey(source: string, at: number): boolean {
  if (!/^mcp\s*:(?!:)/.test(source.slice(at, at + 12))) return false;
  if (/[\w$.]/.test(source[at - 1] ?? '')) return false;
  let j = at - 1;
  while (j >= 0 && /\s/.test(source[j])) j--;
  return source[j] === '{' || source[j] === ',';
}

/** A template literal's body as literals: its fixed text, placeholders shown as "...", and the literals inside each placeholder. */
function templateLiterals(body: string): string[] {
  const nested: string[] = [];
  let fixed = '';
  let i = 0;
  while (i < body.length) {
    if (body[i] === '\\') {
      fixed += body.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (body[i] === '$' && body[i + 1] === '{') {
      const end = endOfPlaceholder(body, i + 2);
      nested.push(...literalsIn(body.slice(i + 2, end - 1)));
      fixed += '...';
      i = end;
      continue;
    }
    fixed += body[i];
    i++;
  }
  return [fixed, ...nested];
}

/** Every string literal in a piece of source, a template's placeholders read too, the value of every `mcp:` property left out; comments and regular expressions are not literals. */
function literalsIn(code: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < code.length) {
    if (isMcpKey(code, i)) {
      i = endOfValue(code, code.indexOf(':', i) + 1);
      continue;
    }
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = endOfString(code, i);
      const body = code.slice(i + 1, end - 1);
      out.push(...(ch === '`' ? templateLiterals(body) : [body]));
      i = end;
      continue;
    }
    const skip = skipAt(code, i);
    i = skip >= 0 ? skip : i + 1;
  }
  return out;
}

describe("the command line's voice, read from the source", () => {
  it('reads every shape it is meant to: strings, templates and their placeholders, and leaves out comments, regular expressions and the mcp branch of a voice table', () => {
    const sample = [
      "const a = 'plain words'; // a comment about this server",
      '/* the MCP server, in a comment */',
      'const b = `made by ${voice === "cli" ? "the command line" : `nested ${"deep"}`}`;',
      "const c = /this server's ['\"]pattern/g.test(x) ? 'yes' : 'no';",
      "const WORDS = { mcp: { never: 'this server never opens', said: (n) => `${n} for the host` }, cli: { never: 'Forma never opens' } };",
      "const ONE = { mcp: 'one call', cli: 'one report' };",
      "const role = { role: 'assistant' };",
    ].join('\n');
    expect(literalsIn(sample)).toEqual(['plain words', 'made by ...', 'cli', 'the command line', 'nested ...', 'deep', 'yes', 'no', 'Forma never opens', 'one report', 'assistant']);
    expect(literalsIn(sample).filter(forAHost)).toEqual(['assistant']);
    expect(forAHost('FORMA_MCP_MOCK')).toBe(false);
    expect(forAHost('localhost')).toBe(false);
    for (const said of ['your MCP configuration', 'restart your assistant', 'the host', 'no tool reads it', 'fromFile.brief', 'this server', 'repx_pdf draws a draft PDF', 'call generate_report']) expect(forAHost(said), said).toBe(true);
  });

  it("names none of the words a host's model is told, outside the mcp branch of a voice table and the hits ALLOWED says why", () => {
    const modules = cliModules();
    // The walk really reads the layer: the calls, the paths, the files, the settings, the generators and the work.
    expect(modules).toEqual(expect.arrayContaining(['aiSettings.ts', 'caller.ts', 'genJobs.ts', 'generator.ts', 'paths.ts', 'pipeline.ts', 'reportCalls.ts', 'reportFile.ts', 'workerPool.ts', 'genWorker.mjs', 'worker.mjs']));
    const hits = modules.flatMap((file) =>
      literalsIn(readFileSync(join(MCP_DIR, file), 'utf8'))
        .filter(forAHost)
        .map((text) => ({ file, text })),
    );
    const unexplained = hits.filter((hit) => !ALLOWED.some((a) => a.file === hit.file && a.text.test(hit.text)));
    expect(unexplained).toEqual([]);
    const stale = ALLOWED.filter((a) => !hits.some((hit) => hit.file === a.file && a.text.test(hit.text)));
    expect(stale.map((a) => `${a.file}: ${a.text}`)).toEqual([]);
  });
});

const OWNER_WORK = resolve(CLONE, '..', 'forma-model-data-kept-not-in-git', 'forma-model-data', 'work');
const scratch = realpathSync.native(mkdtempSync(join(existsSync(OWNER_WORK) ? OWNER_WORK : tmpdir(), 'cli-voice-')));
const work = join(scratch, 'work');
mkdirSync(work);
const SETUP = { mock: false, userFolder: join(scratch, 'forma-user'), paddleModels: null };

const system = nodeSystem();
const geminiKey = ['AI', 'za', 'Sy'].join('') + 'E'.repeat(33);
/** The settings the command line's entry reads: its environment taken in its voice, the mock its flag. */
const cliSettings = (env: AiEnv, mock = false): AiSettings => readAiSettings(takeAiEnv(env, 'cli').aiEnv, { voice: 'cli', mock });
const redact = redactorFor([geminiKey], FORMA_KEYS);
const policy = <W extends IfExists = 'refuse'>(ifExists: W = 'refuse' as W): PathPolicy<W> => ({ voice: 'cli', sys: system, scope: { base: work }, ifExists });

let mock: Generator;
beforeAll(() => {
  for (const level of ['log', 'info', 'warn', 'debug', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
  mock = inThreadGenerator({ ...SETUP, mock: true }, { log: () => {} });
});
afterAll(async () => {
  await mock.close();
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

function put(name: string, text: string): string {
  const path = join(work, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}
const run = (settings: AiSettings, generator: Generator): CallRun => ({ ai: { settings, generator }, signal: new AbortController().signal, tell: (_e: GenEvent) => {}, redact });
const refusal = async (p: Promise<unknown>): Promise<string> => {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ToolRefusal);
  return (error as Error).message;
};

const SECRET = 'Secret123';
const sqlSource = (connection: string) =>
  `<SqlDataSource Name="sqlDataSource1">${connection}<Query Type="SelectQuery" Name="Orders"><Tables><Table Name="Orders" /></Tables><Columns><AllColumns /></Columns></Query></SqlDataSource>`;
const LOGIN = `<Connection Name="Sales" ProviderKey="MSSqlServer"><Parameters><Parameter Name="server" Value="db01" /><Parameter Name="userid" Value="sa" /><Parameter Name="password" Value="${SECRET}" /></Parameters></Connection>`;
/** A connection left open, whose login cannot be taken out with certainty. */
const LEFT_OPEN = `<Connection Name="Sales"><Parameters><Parameter Name="userid" Value="sa" /><Parameter Name="password" Value="${SECRET}" /></Parameters>`;

/** A small invoice, its title in Arial; with `connection`, a SQL data source that keeps it. */
function invoice(connection?: string): string {
  const storage = connection
    ? `<ComponentStorage><Item1 Ref="9" ObjectType="DevExpress.DataAccess.Sql.SqlDataSource,DevExpress.DataAccess.v20.1" Name="sqlDataSource1" Base64="${encodeBase64(sqlSource(connection))}" /></ComponentStorage>`
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Invoice" Margins="100, 100, 100, 100" PageWidth="850" PageHeight="1100" Version="20.1"${connection ? ' DataMember="Orders" DataSource="#Ref-9"' : ''}>
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="100" />
    <Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="60">
      <Controls>
        <Item1 Ref="4" ControlType="XRLabel" Name="title" Text="Invoice" LocationFloat="0, 10" SizeF="300, 30" Font="Arial, 14pt" Padding="2,2,0,0,100" />
      </Controls>
    </Item2>
    <Item3 Ref="5" ControlType="DetailBand" Name="Detail" HeightF="25" />
    <Item4 Ref="6" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="100" />
  </Bands>
  ${storage}
</XtraReportsLayoutSerializer>
`;
}

/** Every word said here, kept to be read once more at the end. */
const said: { where: string; text: string }[] = [];
const hear = (where: string, ...texts: string[]) => {
  for (const text of texts) said.push({ where, text });
  return texts;
};

describe("the command line's voice, as its calls say it", () => {
  it('says the AI is not set up, in every way it can be, with where the settings go and how to start again in its own words', () => {
    const cases: AiEnv[] = [
      {},
      { FORMA_GEMINI_KEY: geminiKey, FORMA_LOCAL_MODEL: 'q' },
      { FORMA_PROVIDER: 'openrouter' },
      { FORMA_PROVIDER: 'local' },
      { FORMA_PROVIDER: 'gemini' },
      { FORMA_PROVIDER: 'claude', FORMA_GEMINI_KEY: geminiKey },
      { FORMA_GEMINI_KEY: '${FORMA_GEMINI_KEY}' },
      { FORMA_LOCAL_URL: 'not a url', FORMA_LOCAL_MODEL: 'q' },
      { FORMA_LOCAL_URL: 'ftp://localhost/v1', FORMA_LOCAL_MODEL: 'q' },
      { FORMA_LOCAL_URL: 'http://user:pw@localhost:1234/v1', FORMA_LOCAL_MODEL: 'q' },
      { FORMA_LOCAL_URL: 'http://192.168.1.20:11434/v1', FORMA_LOCAL_MODEL: 'q' },
    ];
    for (const env of cases) {
      const settings = cliSettings(env);
      expect(settings.ready, JSON.stringify(Object.keys(env))).toBe(false);
      const [message] = hear(`not ready: ${Object.keys(env).join(', ') || 'nothing set'}`, notReadyMessage(settings));
      expect(message).toContain('Here, Settings are the environment the command runs in');
    }
    hear('a Local AI address', localUrlProblem('http://192.168.1.20:11434/v1', 'cli') ?? '', localUrlProblem('http://user:pw@localhost/v1', 'cli') ?? '');
  });

  it("refuses a C# report with how to give a .repx, and names the .vsrepx beside it as a file to give", async () => {
    put(join('code', 'Invoice.cs'), 'public class Invoice {}');
    const alone = await refusal(planGenerate({ files: [join('code', 'Invoice.cs')] }, policy()));
    expect(alone).toContain('Give a .repx of it instead.');
    put(join('code', 'Shop.cs'), 'public class Shop {}');
    put(join('code', 'Shop.vsrepx'), invoice());
    const beside = await refusal(planRevise({ path: join('code', 'Shop.cs'), request: 'bold' }, policy()));
    expect(beside).toMatch(/which Forma reads: give that path instead\.$/);
    hear('a C# report', alone, beside);
  });

  it('says a login was taken out, and refuses one it cannot take out, in its own words, in both threads', { timeout: 60_000 }, async () => {
    const opened = openReport(invoice(LOGIN), 'r.repx', 'cli');
    expect(opened.notices).toEqual([loginRemovedNotice('cli')]);
    expect(loginRemovedNotice('mcp')).toBe(LOGIN_REMOVED);
    const audited = await runJob({ tool: 'audit', voice: 'cli', name: 'r.repx', text: invoice(LOGIN) });
    expect(audited.report.notices).toEqual([loginRemovedNotice('cli')]);
    let left = '';
    try {
      openReport(invoice(LEFT_OPEN), 'left.repx', 'cli');
    } catch (error) {
      left = (error as Error).message;
    }
    expect(left).toMatch(/so Forma does not read it and writes nothing from it\. .* then run the command again\.$/);
    hear('a login', ...opened.notices, ...audited.report.notices, left);

    // Through a revise, as the command line makes one: the notice in the result, and the refusal from the work's thread.
    put(join('login', 'kept.repx'), invoice(LOGIN));
    const revised = await runRevise(await planRevise({ path: join('login', 'kept.repx'), request: 'Make the title bold' }, policy()), run(cliSettings({ FORMA_GEMINI_KEY: geminiKey }, true), mock));
    expect(revised.data.notices).toContain(loginRemovedNotice('cli'));
    put(join('login', 'open.repx'), invoice(LEFT_OPEN));
    const refused = await refusal(runRevise(await planRevise({ path: join('login', 'open.repx'), request: 'Make the title bold' }, policy()), run(cliSettings({ FORMA_GEMINI_KEY: geminiKey }, true), mock)));
    expect(refused).toContain('then run the command again');
    hear('a login, through revise', ...revised.data.notices, refused);
  });

  it("says what the chat would have done that the command line does not, naming its own pdf command", { timeout: 60_000 }, async () => {
    put(join('export', 'inv.repx'), invoice());
    const exported = await runRevise(await planRevise({ path: join('export', 'inv.repx'), request: 'Export it as PDF' }, policy()), run(cliSettings({ FORMA_GEMINI_KEY: geminiKey }, true), mock));
    expect(exported.data).toMatchObject({ action: 'answer', written: null });
    expect(exported.data.notices.join(' ')).toContain('Exporting it as PDF is not done here: the pdf command draws a draft PDF');
    expect(readdirSync(join(work, 'export'))).toEqual(['inv.repx']);
    hear('the chat export', ...exported.data.notices);
  });

  it('says a font was measured in a stand-in with the label its output gives the families, never fromFile', { timeout: 60_000 }, async () => {
    const missing = 'Forma Absent Family';
    const ask: NonNullable<GenerationDeps['ask']> = async (_prompt, _parts, _config, previous, _signal, _onProgress, options) => {
      const answer = mockAnswer('true', previous, options);
      return { ...answer, repxContent: answer.repxContent.replaceAll('Font="Arial, 12.24pt, style=Bold"', `Font="${missing}, 12.24pt, style=Bold"`) };
    };
    const generator = inThreadGenerator(SETUP, { ask, log: () => {} });
    try {
      const made = await runGenerate(await planGenerate({ description: 'An invoice with a title.', output: join('fonts', 'invoice.repx') }, policy()), run(cliSettings({ FORMA_GEMINI_KEY: geminiKey }), generator));
      expect(readFileSync(join(work, 'fonts', 'invoice.repx'), 'utf8')).toContain(`Font="${missing}, 12.24pt, style=Bold"`);
      expect(made.data.notices).toContain(standInFontsNotice('cli'));
      expect(made.data.notices).not.toContain(STAND_IN_FONTS);
      expect(made.fromFile.standInFonts).toEqual([missing]);
      expect(standInFontsNotice('cli')).toContain('(listed as stand-in fonts)');
      hear('the stand-in fonts', ...made.data.notices);
    } finally {
      await generator.close();
    }
  });

  it('says who answered, and when the work passed a bound, in its own words', () => {
    for (const by of ['gemini', 'openrouter', 'local', 'mock', null] as Answerer[]) hear(`answered by ${by}`, answeredBy(by, 'cli'));
    expect(answeredBy('mock', 'cli')).toBe('the mock invoice (--mock), with no AI asked');
    expect(answeredBy('mock', 'mcp')).toBe('the mock invoice (FORMA_MCP_MOCK is on), with no AI asked');
    hear('the bounds', genTooLong(15 * 60_000, 'cli'), genTooMuchMemory(2048, 'cli'), tooLong(30_000, 'cli'), tooMuchMemory(512, 'cli'));
    expect(tooLong(30_000, 'cli')).toContain('the longest one report may take');
    expect(tooLong(30_000)).toContain('the longest one call may take');
  });

  it("names none of the words a host's model is told, in anything said above", () => {
    // Every case above ran first (a file's cases run in order), so this reads all they heard.
    expect(said.length).toBeGreaterThan(25);
    expect(said.filter((s) => forAHost(s.text)).map((s) => `${s.where}: ${s.text}`)).toEqual([]);
  });
});
